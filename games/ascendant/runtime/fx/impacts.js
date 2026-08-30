/**
 * ASCENDANT — runtime/fx/impacts.js
 * CONTRACT §19 (Impacts), §21 (death -> respawn budget).
 *
 * The single place where a GAME EVENT becomes a felt effect. Player and Stage raise
 * semantic events ("landed at 21 m/s on ice", "died to lava"); this module turns each
 * one into the exact combination of particles, sound, camera work, post-processing and
 * decals that sells it — and, for death, owns the whole 620 ms timeline as a state
 * machine the Game polls. Timing lives HERE, in one place, so it can never drift.
 *
 *   death timeline (contract §21, 620 ms total)
 *   ┌── flash 90 ms ──┬── hold 180 ms ──┬── fade 140 ms ──┬── restore 210 ms ──┐
 *   pulse + slow-mo    death cam drop    fade to black     fade back in
 *                                        ^ respawn fires at 410 ms, input unlocks
 *
 * The Game loop is expected to do:
 *     impacts.update(realDt);                 // REAL dt, never scaled
 *     const dt = realDt * impacts.timeScale;  // gameplay dt
 *     if (impacts.consumeRespawn()) this.respawn();
 *
 * Art-direction law for everything in this file: an effect must READ in a single
 * frame at 60 fps and must never sit between the player and the next platform.
 * Brightness is information. Smoke is small, dark and low.
 */

import * as THREE from 'three';
import { clamp, lerp, smoothstep, easeOutCubic } from '../core/util.js';

/* ------------------------------------------------------------------ *
 *  timeline + tables
 * ------------------------------------------------------------------ */

export const DEATH_TIMELINE = Object.freeze({
  flash: 0.09,
  hold: 0.18,
  fade: 0.14,
  restore: 0.21,
  flashEnd: 0.09,
  holdEnd: 0.27,
  fadeEnd: 0.41,     // respawn happens here — screen is fully black
  total: 0.62,
});

/**
 * Per-cause presentation. `color` drives the post pulse, the particle burst and the
 * scorch tint, so a player learns "violet = void, cyan = laser" without being told.
 */
export const CAUSE_STYLE = Object.freeze({
  lava: { color: 0xff7a1a, pulse: 0.90, shake: 1.00, sound: null, decal: 'splat', decalColor: 0xff5a0c },
  laser: { color: 0x35f0ff, pulse: 1.00, shake: 0.75, sound: 'laser', decal: 'scorch', decalColor: 0x0d1b22 },
  saw: { color: 0xfff2d2, pulse: 0.95, shake: 1.10, sound: null, decal: 'scorch', decalColor: 0x241d18 },
  void: { color: 0xa86bff, pulse: 0.70, shake: 0.55, sound: null, decal: null, decalColor: 0x160f24 },
  crush: { color: 0xff4a4a, pulse: 1.00, shake: 1.25, sound: 'crush', decal: 'crack', decalColor: 0x14161b },
  spike: { color: 0xff5c3a, pulse: 0.85, shake: 0.95, sound: null, decal: 'scorch', decalColor: 0x1d1412 },
  manual: { color: 0x9fb6cc, pulse: 0.45, shake: 0.40, sound: null, decal: null, decalColor: 0x14181e },
  fall: { color: 0x8fa6c0, pulse: 0.55, shake: 0.50, sound: null, decal: null, decalColor: 0x14181e },
});

const STEP_SOUND = {
  metal: 'step_metal', panel: 'step_metal', grate: 'step_metal',
  conveyor: 'step_metal', speed: 'step_metal', neon: 'step_metal',
  ice: 'step_ice', glass: 'step_ice', snow: 'step_ice', crystal: 'step_ice',
};

/* landing bands, derived from TUNE (gravFall 54, jumpV 12.6 -> a clean jump lands ~15 m/s) */
const LAND_MIN = 5.0;      // below this it is a footstep, not a landing
const LAND_SOFT = 9.0;     // strength ramp starts here
const LAND_RANGE = 24.0;   // ...and saturates 24 m/s above it
const LAND_SHAKE_AT = 26.0;
const LAND_DECAL_AT = 24.0;

const EMPTY = Object.freeze({});

/* module scratch — no per-frame allocation */
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function readVec(v, out) {
  if (!v) return false;
  if (typeof v.x === 'number') { out.set(v.x, v.y || 0, v.z || 0); return true; }
  if (Array.isArray(v) && v.length >= 3) { out.set(v[0], v[1], v[2]); return true; }
  return false;
}

function stepSoundFor(surface) {
  if (!surface) return 'step_stone';
  return STEP_SOUND[surface] || 'step_stone';
}

function styleFor(cause) {
  return CAUSE_STYLE[cause] || CAUSE_STYLE.manual;
}

/* ------------------------------------------------------------------ *
 *  Impacts
 * ------------------------------------------------------------------ */

export class Impacts {
  /**
   * @param {import('./particles.js').ParticleSystem} ps
   * @param {object} audio  Audio (core/audio.js)
   * @param {object} camera FPCamera (player/camera.js) — dip/shake/setDeathCam
   * @param {object} [opts] {post, decals, enabled}
   */
  constructor(ps, audio, camera, opts = EMPTY) {
    this.ps = ps || null;
    this.audio = audio || null;
    this.camera = camera || null;
    this.post = opts.post || null;
    this.decals = opts.decals || null;
    this.enabled = opts.enabled !== false;

    /** hook the Game can set to mirror events into the HUD: (name, payload) => void */
    this.onEvent = null;

    /* ---- polled death state machine ---- */
    this.timeScale = 1;
    this.deathActive = false;
    this.deathPhase = 'none';
    this.deathCause = 'manual';
    this.deathT = 0;
    this._respawnPending = false;
    this._respawnFired = false;
    this._deathPos = new THREE.Vector3();

    /* ---- slow-motion hitch ---- */
    this._hitchScale = 1;
    this._hitchT = 0;
    this._hitchDur = 0;

    /* ---- throttles (seconds) ---- */
    this._clock = 0;
    this._landCd = 0;
    this._stepCd = 0;
    this._scrapeCd = 0;
    this._coinCd = 0;
    this._coinStreak = 0;
    this._laserCd = 0;
    this._decalCd = 0;

    /* ---- last known solid ground, so a death scorch lands on a real surface ---- */
    this._ground = new THREE.Vector3();
    this._groundT = -999;
    this._groundValid = false;

    this.theme = null;
    this.palette = {
      checkpoint: 0x7ef0ff,
      finish: 0xffd76a,
      coin: 0xffcf4d,
      bounce: 0xffd27a,
      accent: 0x7ec8ff,
    };
  }

  /* ------------------------------------------------------------------ *
   *  wiring
   * ------------------------------------------------------------------ */

  /** attach parts that are constructed after Impacts (Post, Decals, FPCamera) */
  attach(parts = EMPTY) {
    if (parts.ps) this.ps = parts.ps;
    if (parts.audio) this.audio = parts.audio;
    if (parts.camera) this.camera = parts.camera;
    if (parts.post) this.post = parts.post;
    if (parts.decals) this.decals = parts.decals;
    return this;
  }

  setPost(post) { this.post = post || null; return this; }
  setDecals(decals) { this.decals = decals || null; return this; }
  setCamera(camera) { this.camera = camera || null; return this; }

  /** adopt a ThemeDef's palette for checkpoint/finish/coin tints */
  setTheme(theme) {
    this.theme = theme || null;
    if (this.ps && typeof this.ps.setTheme === 'function') this.ps.setTheme(theme);
    const pal = theme && theme.palette;
    if (!pal) return;
    if (pal.checkpointOn !== undefined) this.palette.checkpoint = pal.checkpointOn;
    else if (pal.checkpoint !== undefined) this.palette.checkpoint = pal.checkpoint;
    if (pal.finish !== undefined) this.palette.finish = pal.finish;
    if (pal.accent !== undefined) this.palette.accent = pal.accent;
    if (pal.safeEdge !== undefined) this.palette.bounce = pal.safeEdge;
  }

  /* ------------------------------------------------------------------ *
   *  safe adapters — every collaborator is built by a different module,
   *  so nothing here assumes a method exists.
   * ------------------------------------------------------------------ */

  _sfx(name, volume, rate) {
    const a = this.audio;
    if (!a || typeof a.sfx !== 'function') return;
    try {
      a.sfx(name, { volume: clamp(volume === undefined ? 1 : volume, 0, 2), rate: rate || 1 });
    } catch (e) { /* audio must never take a frame down */ }
  }

  _duck(ms) {
    const a = this.audio;
    if (a && typeof a.duck === 'function') { try { a.duck(ms); } catch (e) { /* ignore */ } }
  }

  _dip(amount) {
    const c = this.camera;
    if (c && typeof c.dip === 'function') c.dip(clamp(amount, 0, 1));
  }

  _shake(amount, ms) {
    const c = this.camera;
    if (c && typeof c.shake === 'function') c.shake(amount, ms);
  }

  _deathCam(on) {
    const c = this.camera;
    if (c && typeof c.setDeathCam === 'function') c.setDeathCam(!!on);
  }

  _pulse(amount, ms, color) {
    const p = this.post;
    if (p && typeof p.pulse === 'function') p.pulse(amount, ms, color);
  }

  _damage(v) {
    const p = this.post;
    if (p && typeof p.setDamage === 'function') p.setDamage(clamp(v, 0, 1));
  }

  _burst(preset, pos, opts) {
    const ps = this.ps;
    if (ps && typeof ps.burst === 'function') ps.burst(preset, pos, opts);
  }

  _emit(name, payload) {
    const fn = this.onEvent;
    if (typeof fn === 'function') { try { fn(name, payload); } catch (e) { /* ignore */ } }
  }

  /* ------------------------------------------------------------------ *
   *  events
   * ------------------------------------------------------------------ */

  /**
   * Landing. `impactSpeed` is the downward speed absorbed by the ground, in m/s.
   * Bands (gravFall 54): step-off ~10, clean jump ~15, 4 m drop ~21, 8 m drop ~29.
   * @param {number} impactSpeed
   * @param {string} surface  Collider.surface ('normal'|'ice'|'metal'|...)
   * @param {THREE.Vector3|number[]} pos  contact point
   * @param {THREE.Vector3|number[]} [normal]
   */
  land(impactSpeed, surface, pos, normal) {
    if (!this.enabled) return 0;
    const v = Math.abs(impactSpeed || 0);
    if (!readVec(pos, _p)) return 0;

    // remember where solid ground was — a death scorch will be placed here
    this._ground.copy(_p);
    this._groundT = this._clock;
    this._groundValid = true;

    if (v < LAND_MIN) {
      // a step down, not a landing: a quiet surface tick and nothing else
      if (this._stepCd <= 0) {
        this._stepCd = 0.09;
        this._sfx(stepSoundFor(surface), 0.22, 0.96 + Math.random() * 0.08);
      }
      return 0;
    }
    if (this._landCd > 0) return 0;
    this._landCd = 0.06;

    const s = clamp((v - LAND_SOFT) / LAND_RANGE, 0, 1);

    this._burst('land', _p, { strength: s, surface, normal });

    // camera: a short, impact-scaled dip. FPCamera caps this at 120 ms.
    this._dip(clamp((v - 8) / 22, 0.08, 1));
    if (v > LAND_SHAKE_AT) this._shake(0.10 + 0.22 * s, 130);

    // audio: the generic land thump plus a surface-coloured tick on top
    this._sfx('land', 0.28 + 0.72 * s, 1.06 - 0.16 * s);
    this._sfx(stepSoundFor(surface), 0.20 + 0.35 * s, 0.92 + 0.1 * (1 - s));

    // a scuff only for landings that genuinely hurt, and never more than one per 1.2 s
    if (v > LAND_DECAL_AT && this._decalCd <= 0 && this.decals) {
      this._decalCd = 1.2;
      if (!readVec(normal, _n)) _n.copy(_up);
      this.decals.add('scuff', _p, _n, {
        size: 0.55 + 0.5 * s,
        alpha: 0.13 + 0.16 * s,
        aspect: 1.25 + 0.5 * s,
        jitter: 0.06,
      });
    }

    this._emit('land', { speed: v, surface, strength: s });
    return s;
  }

  /**
   * Jump — a tight foot-level puff, so a jump has weight without any visual noise.
   */
  jump(pos, surface) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('jump', _p, { surface });
    this._sfx('jump', 0.55, 0.97 + Math.random() * 0.07);
    this._emit('jump', { surface });
  }

  /** Footstep. The Player drives the cadence; this only guards against spam. */
  step(surface, pos) {
    if (!this.enabled) return;
    if (this._stepCd > 0) return;
    this._stepCd = 0.11;
    this._sfx(stepSoundFor(surface), 0.34, 0.93 + Math.random() * 0.14);
    if (pos && readVec(pos, _p) && Math.random() < 0.28) {
      this._burst('dust', _p, { surface, count: 2, scale: 0.5 });
    }
  }

  /**
   * DEATH — starts the 620 ms sequence and returns immediately. Everything after
   * this point is driven by update(); the Game polls timeScale / consumeRespawn().
   * @param {string} cause 'lava'|'void'|'spike'|'laser'|'crush'|'saw'|'manual'
   * @param {THREE.Vector3|number[]} pos
   * @param {THREE.Vector3|number[]} [dir] direction of the blow (hazard -> player)
   */
  death(cause, pos, dir) {
    if (!this.enabled) return;
    if (this.deathActive) return;              // one death sequence at a time

    const st = styleFor(cause);
    this.deathActive = true;
    this.deathPhase = 'flash';
    this.deathCause = cause || 'manual';
    this.deathT = 0;
    this._respawnPending = false;
    this._respawnFired = false;

    if (readVec(pos, _p)) this._deathPos.copy(_p); else _p.copy(this._deathPos);
    const hasDir = readVec(dir, _d);

    // 1. the flash, coloured by cause — the single fastest read of "what killed me"
    this._pulse(st.pulse, 90, st.color);
    this._damage(0.35);

    // 2. camera hands over to the death cam and takes a hard knock
    this._deathCam(true);
    this._shake(0.55 * st.shake, 260);

    // 3. particles
    this._burst('death', _p, { cause: this.deathCause, color: st.color, dir: hasDir ? _d : null });

    // 4. audio: duck the bed for the whole sequence, cause layer, then the death hit
    this._duck(700);
    if (st.sound) this._sfx(st.sound, 0.85);
    this._sfx('death', 1.0);

    // 5. a mark on the last known ground, if the player died anywhere near it
    this._placeDeathDecal(st);

    // 6. the 90 ms slow-motion hitch
    this.slowmo(0.06, 0.09);

    this._emit('death', { cause: this.deathCause, color: st.color });
  }

  _placeDeathDecal(st) {
    if (!this.decals || !st.decal) return;
    if (!this._groundValid) return;
    if (this._clock - this._groundT > 6) return;      // ground memory is stale
    const dx = this._deathPos.x - this._ground.x;
    const dz = this._deathPos.z - this._ground.z;
    const dy = this._deathPos.y - this._ground.y;
    if (dx * dx + dz * dz > 9 || dy < -0.6 || dy > 3.2) return;
    this.decals.add(st.decal, this._ground, _up, {
      color: st.decalColor,
      size: st.decal === 'splat' ? 0.55 : 0.85,
      alpha: st.decal === 'splat' ? 0.6 : 0.45,
      jitter: 0.1,
    });
  }

  /** Abort an in-flight death sequence (restart / stage change). */
  cancelDeath() {
    if (!this.deathActive) return;
    this.deathActive = false;
    this.deathPhase = 'none';
    this.deathT = 0;
    this._respawnPending = false;
    this._respawnFired = false;
    this.timeScale = 1;
    this._hitchDur = 0;
    this._deathCam(false);
    this._damage(0);
  }

  /** Checkpoint reached. */
  checkpoint(pos, idx) {
    if (!this.enabled) return;
    const c = this.palette.checkpoint;
    if (readVec(pos, _p)) this._burst('checkpoint', _p, { color: c });
    this._sfx('checkpoint', 0.9);
    this._pulse(0.20, 220, c);
    this._shake(0.10, 150);
    this._emit('checkpoint', { idx: idx | 0, color: c });
  }

  /** Coin pickup — frequent, so no camera work at all. */
  coin(pos, idx) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('coin', _p, { color: this.palette.coin });
    // a rising pitch ladder makes a run of coins feel like a phrase, not a repeat
    if (this._coinCd > 0) this._coinStreak = Math.min((this._coinStreak || 0) + 1, 7);
    else this._coinStreak = 0;
    this._coinCd = 0.55;
    this._sfx('coin', 0.75, 1 + this._coinStreak * 0.045);
    this._emit('coin', { idx: idx | 0 });
  }

  /** Stage cleared. */
  finish(pos) {
    if (!this.enabled) return;
    const c = this.palette.finish;
    if (readVec(pos, _p)) this._burst('finish', _p, { color: c });
    this._sfx('finish', 1.0);
    this._duck(1100);
    this._pulse(0.45, 320, c);
    this._shake(0.18, 320);
    this.slowmo(0.35, 0.22);
    this._emit('finish', { color: c });
  }

  /**
   * Bounce pad launch. FPCamera owns the FOV kick; this is the pad's own reaction.
   * @param {THREE.Vector3|number[]} pos
   * @param {number} power apex height in metres (ObjectDef.power)
   * @param {THREE.Vector3|number[]} [normal]
   */
  bounce(pos, power, normal) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) {
      this._burst('bounce', _p, { power: power || 4, color: this.palette.bounce, normal });
    }
    this._sfx('bounce', 0.85, 0.94 + clamp((power || 4) / 18, 0, 0.22));
    this._shake(0.12, 120);
    this._emit('bounce', { power: power || 4 });
  }

  /**
   * Wall slide contact. Called every frame while sliding — internally throttled to
   * ~18 Hz so it never floods the particle pool or the audio graph.
   */
  wallScrape(pos, normal, speed) {
    if (!this.enabled) return;
    if (this._scrapeCd > 0) return;
    this._scrapeCd = 0.055;
    if (!readVec(pos, _p)) return;
    const v = Math.abs(speed || 0);
    this._burst('wallScrape', _p, { normal, speed: v });
    this._sfx('step_metal', 0.10 + clamp(v / 30, 0, 0.16), 1.45 + Math.random() * 0.2);
  }

  /**
   * A crusher slamming shut / heavy geometry impact. This is the IMPACT only —
   * if it also kills the player, the Game calls death('crush') separately.
   */
  crush(pos, dir) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('crush', _p, { dir });
    this._sfx('crush', 0.9, 0.95 + Math.random() * 0.1);
    this._shake(0.30, 220);
    this._emit('crush', {});
  }

  /**
   * Laser contact sizzle (non-fatal grazes and the moment of a fatal hit alike).
   */
  laserHit(pos, dir, color) {
    if (!this.enabled) return;
    if (this._laserCd > 0) return;
    this._laserCd = 0.07;
    const c = color !== undefined ? color : CAUSE_STYLE.laser.color;
    if (readVec(pos, _p)) this._burst('laserHit', _p, { dir, color: c });
    this._sfx('laser', 0.55, 1 + Math.random() * 0.08);
    this._pulse(0.10, 90, c);
  }

  /** A vanishing platform blinking out from under the player. */
  vanish(pos, size) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) {
      this._burst('vanish', _p, {
        sx: size && size[0] ? size[0] * 0.5 : 1.2,
        sz: size && size[2] ? size[2] * 0.5 : 1.2,
        color: this.palette.accent,
      });
    }
    this._sfx('vanish', 0.6);
  }

  /** A lava surface bubbling — driven by the lava hazard, cheap and ambient. */
  lavaPop(pos, power) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('lavaPop', _p, { power: power || 1 });
  }

  /** Ice cracking / a shard hazard shattering. */
  iceShard(pos, color) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('iceShard', _p, { color });
  }

  /* ------------------------------------------------------------------ *
   *  slow motion
   * ------------------------------------------------------------------ */

  /**
   * Ease gameplay time from `scale` back to 1 over `dur` seconds.
   * The Game must multiply its gameplay dt by `impacts.timeScale`.
   */
  slowmo(scale, dur) {
    const s = clamp(scale, 0.01, 1);
    const d = Math.max(dur || 0, 0.001);
    // never let a new, weaker hitch cancel a stronger one already running
    if (this._hitchDur > 0 && this._hitchScale < s) return;
    this._hitchScale = s;
    this._hitchDur = d;
    this._hitchT = 0;
    this.timeScale = s;
  }

  /* ------------------------------------------------------------------ *
   *  frame — call with REAL (unscaled) dt, once per frame, before the Game
   *  applies timeScale.
   * ------------------------------------------------------------------ */

  update(dt) {
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);
    this._clock += d;

    // throttles
    if (this._landCd > 0) this._landCd -= d;
    if (this._stepCd > 0) this._stepCd -= d;
    if (this._scrapeCd > 0) this._scrapeCd -= d;
    if (this._coinCd > 0) this._coinCd -= d;
    if (this._laserCd > 0) this._laserCd -= d;
    if (this._decalCd > 0) this._decalCd -= d;

    // slow-motion hitch
    if (this._hitchDur > 0) {
      this._hitchT += d;
      const u = clamp(this._hitchT / this._hitchDur, 0, 1);
      this.timeScale = lerp(this._hitchScale, 1, easeOutCubic(u));
      if (u >= 1) { this._hitchDur = 0; this.timeScale = 1; }
    } else if (this.timeScale !== 1) {
      this.timeScale = 1;
    }

    if (!this.deathActive) return;

    // ---- death state machine ------------------------------------------
    const T = DEATH_TIMELINE;
    const t = (this.deathT += d);

    if (t < T.flashEnd) {
      this.deathPhase = 'flash';
      this._damage(0.35 + 0.65 * easeOutCubic(t / T.flashEnd));
    } else if (t < T.holdEnd) {
      this.deathPhase = 'hold';
      this._damage(lerp(1, 0.9, (t - T.flashEnd) / T.hold));
    } else if (t < T.fadeEnd) {
      this.deathPhase = 'fade';
      this._damage(lerp(0.9, 0.7, (t - T.holdEnd) / T.fade));
    } else {
      if (!this._respawnFired) {
        // screen is fully black: hand the world back to the Game, release the camera
        this._respawnFired = true;
        this._respawnPending = true;
        this._deathCam(false);
      }
      if (t < T.total) {
        this.deathPhase = 'restore';
        this._damage(0.7 * (1 - smoothstep(T.fadeEnd, T.total, t)));
      } else {
        this.deathPhase = 'none';
        this.deathActive = false;
        this.deathT = 0;
        this._damage(0);
        this._emit('respawned', { cause: this.deathCause });
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  polled state (the Game reads these)
   * ------------------------------------------------------------------ */

  /** true exactly once per death, at the fade-to-black low point (410 ms) */
  consumeRespawn() {
    if (!this._respawnPending) return false;
    this._respawnPending = false;
    return true;
  }

  /** 0..1 screen-black amount — feed the HUD's death overlay with this */
  get fadeAlpha() {
    if (!this.deathActive) return 0;
    const T = DEATH_TIMELINE;
    const t = this.deathT;
    if (t <= T.holdEnd) return 0;
    if (t < T.fadeEnd) return smoothstep(T.holdEnd, T.fadeEnd, t);
    return 1 - smoothstep(T.fadeEnd, T.total, t);
  }

  /** input is dead from the moment of death until the respawn snap */
  get inputLocked() {
    return this.deathActive && this.deathT < DEATH_TIMELINE.fadeEnd;
  }

  /** 0..1 across the whole sequence */
  get deathProgress() {
    return this.deathActive ? clamp(this.deathT / DEATH_TIMELINE.total, 0, 1) : 0;
  }

  /** true while any timeline (death or a finish flourish) is running */
  get busy() {
    return this.deathActive || this._hitchDur > 0;
  }

  /* ------------------------------------------------------------------ *
   *  lifecycle
   * ------------------------------------------------------------------ */

  /** full reset — stage load, restart, or returning to the hub */
  reset() {
    this.cancelDeath();
    this.timeScale = 1;
    this._hitchDur = 0;
    this._hitchT = 0;
    this._hitchScale = 1;
    this._clock = 0;
    this._landCd = 0;
    this._stepCd = 0;
    this._scrapeCd = 0;
    this._coinCd = 0;
    this._coinStreak = 0;
    this._laserCd = 0;
    this._decalCd = 0;
    this._groundValid = false;
    this._groundT = -999;
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (!v) this.cancelDeath();
  }

  dispose() {
    this.cancelDeath();
    this.onEvent = null;
    this.ps = null;
    this.audio = null;
    this.camera = null;
    this.post = null;
    this.decals = null;
  }
}

export default Impacts;
