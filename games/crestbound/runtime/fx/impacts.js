/**
 * CRESTBOUND — runtime/fx/impacts.js
 * CONTRACT §8 (fx package), §11 (the player events this listens to),
 * §28 (death → respawn budget: median ≤ 700 ms, ceiling 950 ms).
 *
 * The single place where a GAME EVENT becomes a FELT EFFECT. The Player and the
 * Course raise semantic events ("landed at 24 m/s on snow", "collected the sigils
 * crest", "died to lava"); this module turns each one into the exact combination of
 * particles, sound, camera work, post-processing and decals that sells it. Nothing
 * upstream of here knows what a burst preset is called; nothing downstream of here
 * knows what a wall kick is.
 *
 * Ported from `games/ascendant/runtime/fx/impacts.js` and re-aimed at the
 * third-person moveset:
 *   - the first-person `dip()` camera call is gone; the third-person FollowCamera
 *     exposes `punch(amount)` and `shake(amount, ms)` (CONTRACT §12) and this
 *     module drives those instead.
 *   - the whole jump family has its own reaction (single/double/triple, long jump,
 *     backflip, sideflip, wall kick, dive, slide, pound hang, pound land).
 *   - death is a FIVE-phase timeline with a REWIND, not Ascendant's four-phase fade.
 *
 * ── THE DEATH TIMELINE (CONTRACT §28) ────────────────────────────────────────
 *
 *   0        60ms            280ms        400ms      540ms          700ms
 *   ├─flash──┼────rewind─────┼───hold─────┼──fade────┼───restore─────┤
 *   │ 60     │ 220           │ 120        │ 140      │ 160           │
 *   pulse +  ghost of the    desaturated  fade to    fade back in,
 *   hitstop  last 0.4 s      beat at the  black      saturation and
 *            played BACK     rewind's     ▲          the death cam
 *            over 220 ms     end point    │          released
 *                                         └ respawn fires here (screen is black)
 *
 * `DEATH_TIMELINE` below is exported in MILLISECONDS and is the shared clock:
 * `runtime/game.js` reads it to schedule the world swap and the input gate, and
 * `runtime/player/controller.js`'s `history` Ring supplies the ghost that
 * `rewindProgress` indexes. game.js OWNS the gate — it performs the respawn when
 * `consumeRespawn()` returns true — while this module owns the LOOK of the
 * sequence. If you change one of the five numbers, change it HERE; both files read
 * this object, so they cannot drift.
 *
 * The Game loop is expected to do:
 *
 *     impacts.update(realDt);                  // REAL dt, never scaled
 *     const dt = realDt * impacts.timeScale;   // gameplay dt — the hit-stop
 *     if (impacts.consumeRespawn()) this.respawn();
 *
 * ART-DIRECTION LAW for everything in this file: an effect must READ in a single
 * frame at 60 fps and must never sit between the player and the next platform.
 * Brightness is information. Smoke is small, dark and low. A collectible's burst
 * is the only saturated thing on screen when it fires.
 *
 * PERFORMANCE LAW: zero allocation in any method reachable from a frame. Every
 * vector is a module scratch; every collaborator call goes through a guarded
 * adapter so a half-built game (audio not yet unlocked, post not yet attached,
 * decals disabled at low quality) never throws inside the frame.
 */

import * as THREE from 'three';
import { clamp, lerp, smoothstep, easeOutCubic, headingFromYaw } from '../core/util.js';
import { TUNE, LAND_SOFT, LAND_HARD } from '../core/tuning.js';
import { CAUSE_COLOR } from './particles.js';

/* ------------------------------------------------------------------ *
 *  the death timeline (milliseconds — CONTRACT §28)
 * ------------------------------------------------------------------ */

/**
 * Phase durations in MILLISECONDS, plus the cumulative marks derived from them.
 * Total 700 ms — the contract's median budget, deliberately AT it rather than
 * under it, because the rewind is the read: cutting it shorter than 220 ms turns
 * the ghost into a smear and the player stops learning what killed them.
 */
export const DEATH_TIMELINE = Object.freeze({
  flash: 60,
  rewind: 220,
  hold: 120,
  fade: 140,
  restore: 160,
  // cumulative marks (ms from the moment of death)
  flashEnd: 60,
  rewindEnd: 280,
  holdEnd: 400,
  fadeEnd: 540,       // respawn fires here — the screen is fully black
  total: 700,
});

/** The same timeline in SECONDS. Everything inside this file integrates in seconds. */
const T = Object.freeze({
  flashEnd: DEATH_TIMELINE.flashEnd / 1000,
  rewindEnd: DEATH_TIMELINE.rewindEnd / 1000,
  holdEnd: DEATH_TIMELINE.holdEnd / 1000,
  fadeEnd: DEATH_TIMELINE.fadeEnd / 1000,
  total: DEATH_TIMELINE.total / 1000,
  rewind: DEATH_TIMELINE.rewind / 1000,
  hold: DEATH_TIMELINE.hold / 1000,
  fade: DEATH_TIMELINE.fade / 1000,
  restore: DEATH_TIMELINE.restore / 1000,
});

/** Death phase names, in order. `impacts.deathPhase` is always one of these. */
export const DEATH_PHASES = Object.freeze(['none', 'flash', 'rewind', 'hold', 'fade', 'restore']);

/* ------------------------------------------------------------------ *
 *  tables
 * ------------------------------------------------------------------ */

/**
 * Per-cause presentation. `color` drives the post pulse, the particle burst AND
 * the decal tint, so a player learns "violet = void, orange = lava, red = crush"
 * without ever being told. Colours come from `fx/particles.js#CAUSE_COLOR` so the
 * flash and the debris can never disagree.
 */
export const CAUSE_STYLE = Object.freeze({
  lava: { color: CAUSE_COLOR.lava, pulse: 0.90, shake: 1.00, sound: 'lava_bubble', decal: 'splat', decalColor: 0xff5a0c, hitch: 0.06 },
  void: { color: CAUSE_COLOR.void, pulse: 0.70, shake: 0.55, sound: null, decal: null, decalColor: 0x160f24, hitch: 0.10 },
  spike: { color: CAUSE_COLOR.spike, pulse: 0.85, shake: 0.95, sound: null, decal: 'scorch', decalColor: 0x1d1412, hitch: 0.06 },
  crush: { color: CAUSE_COLOR.crush, pulse: 1.00, shake: 1.25, sound: 'crusher_slam', decal: 'crack', decalColor: 0x14161b, hitch: 0.05 },
  saw: { color: CAUSE_COLOR.saw, pulse: 0.95, shake: 1.10, sound: null, decal: 'scorch', decalColor: 0x241d18, hitch: 0.06 },
  toxic: { color: CAUSE_COLOR.toxic, pulse: 0.80, shake: 0.60, sound: null, decal: 'splat', decalColor: 0x3d5a24, hitch: 0.08 },
  gnasher: { color: CAUSE_COLOR.gnasher, pulse: 0.95, shake: 1.05, sound: 'gnasher_bite', decal: 'scuff', decalColor: 0x241a12, hitch: 0.05 },
  warden: { color: CAUSE_COLOR.warden, pulse: 1.00, shake: 1.20, sound: 'warden_hit', decal: 'crack', decalColor: 0x1a1116, hitch: 0.05 },
  water: { color: CAUSE_COLOR.water, pulse: 0.55, shake: 0.45, sound: 'splash', decal: null, decalColor: 0x123240, hitch: 0.12 },
  fall: { color: CAUSE_COLOR.fall, pulse: 0.55, shake: 0.50, sound: null, decal: null, decalColor: 0x14181e, hitch: 0.10 },
  manual: { color: CAUSE_COLOR.manual, pulse: 0.45, shake: 0.40, sound: null, decal: null, decalColor: 0x14181e, hitch: 0.12 },
});

/**
 * Surface → footstep sound (CONTRACT §5 sfx names). Anything not listed falls back
 * to `step_stone`, which is the right guess for architecture.
 */
const STEP_SOUND = Object.freeze({
  grass: 'step_grass', moss: 'step_grass', leaves: 'step_grass', dirt: 'step_grass',
  stone: 'step_stone', marble: 'step_stone', brick: 'step_stone', plaster: 'step_stone',
  obsidian: 'step_stone', crystal: 'step_stone', normal: 'step_stone',
  metal: 'step_metal', panel: 'step_metal', grate: 'step_metal', copper: 'step_metal',
  gold: 'step_metal', conveyor: 'step_metal', speed: 'step_metal', neon: 'step_metal',
  rubber: 'step_metal',
  snow: 'step_snow', cloud: 'step_snow',
  sand: 'step_sand',
  wood: 'step_wood', bark: 'step_wood', rope: 'step_wood', cloth: 'step_wood',
  painting: 'step_wood',
  ice: 'step_ice', glass: 'step_ice',
  water: 'splash',
});

/**
 * Surface → the small puff a footstep or a soft landing throws up. `null` means
 * the surface throws nothing (metal, glass): silence is a texture too.
 */
const STEP_PUFF = Object.freeze({
  snow: 'snowPuff', cloud: 'snowPuff',
  sand: 'sandPuff',
  grass: 'dust', moss: 'dust', dirt: 'dust', leaves: 'dust', stone: 'dust',
  marble: 'dust', brick: 'dust', plaster: 'dust', wood: 'dust', bark: 'dust',
  obsidian: 'dust', normal: 'dust',
  metal: null, panel: null, grate: null, glass: null, ice: null, water: null,
  rubber: null, copper: null, gold: null, rope: null, cloth: null,
});

/** Collect kinds `collect()` understands → {burst, sfx, stinger, pulse, shake}. */
const COLLECT_STYLE = Object.freeze({
  coin: { burst: 'coin', sfx: 'coin', gain: 0.72, stinger: null, pulse: 0, shake: 0, punch: 0, tint: 'coin' },
  sigil: { burst: 'sigil', sfx: 'sigil', gain: 0.85, stinger: null, pulse: 0.16, shake: 0.06, punch: 0, tint: 'sigil' },
  crest: { burst: 'crest', sfx: 'crest', gain: 1.0, stinger: 'crest', pulse: 0.40, shake: 0.18, punch: 0.25, tint: 'crest' },
  crestGrand: { burst: 'crestGrand', sfx: 'crest', gain: 1.0, stinger: 'crest', pulse: 0.62, shake: 0.30, punch: 0.45, tint: 'crest' },
});

/* landing bands — read from tuning.js so "hard" here is the same 22 m/s the
 * controller uses to pick `hardLand` and the 0.20 s landing lag (CONTRACT §0). */
const LAND_MIN = 3.0;                 // below this it is a step-off, not a landing
const LAND_RAMP_LO = LAND_SOFT;       // 8 m/s — the strength ramp starts here
const LAND_RAMP_HI = LAND_HARD;       // 22 m/s — ...and saturates here
const LAND_SHAKE_AT = LAND_HARD;      // shake only on genuinely hard landings
const LAND_DECAL_AT = LAND_HARD * 0.95;

const EMPTY = Object.freeze({});

/* module scratch — no per-frame allocation past this line */
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function readVec(v, out) {
  if (!v) return false;
  if (typeof v.x === 'number') { out.set(v.x, v.y || 0, v.z || 0); return true; }
  if (Array.isArray(v) && v.length >= 3) { out.set(v[0], v[1], v[2]); return true; }
  return false;
}

function stepSoundFor(surface) {
  if (!surface) return 'step_stone';
  const s = STEP_SOUND[surface];
  return s === undefined ? 'step_stone' : s;
}

function puffFor(surface) {
  if (!surface) return 'dust';
  const p = STEP_PUFF[surface];
  return p === undefined ? 'dust' : p;
}

function styleFor(cause) {
  return CAUSE_STYLE[cause] || CAUSE_STYLE.manual;
}

/* ------------------------------------------------------------------ *
 *  Impacts
 * ------------------------------------------------------------------ */

export class Impacts {
  /**
   * CONTRACT §8: `constructor(ps, audio, camera, decals)`. The fifth argument is
   * an optional bag for things built after Impacts (Post in particular, which the
   * Engine owns) — everything in it can also be attached later with `attach()`.
   *
   * @param {import('./particles.js').ParticleSystem} ps
   * @param {object} audio   Audio (core/audio.js) — sfx / stinger / duck
   * @param {object} camera  FollowCamera (player/camera.js) — punch / shake / setDeathCam
   * @param {import('./decals.js').Decals} [decals]
   * @param {object} [opts]  {post, enabled}
   */
  constructor(ps, audio, camera, decals, opts = EMPTY) {
    this.ps = ps || null;
    this.audio = audio || null;
    this.camera = camera || null;
    this.decals = decals || null;
    this.post = opts.post || null;
    this.enabled = opts.enabled !== false;

    /** hook the Game sets to mirror events into the HUD: (name, payload) => void */
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
    this._rewindCd = 0;

    /* ---- slow-motion hitch ---- */
    this._hitchScale = 1;
    this._hitchT = 0;
    this._hitchDur = 0;

    /* ---- eased post drivers we own for the duration of a death ---- */
    this._desat = 0;
    this._baseSaturation = 1;
    this._desatHeld = false;

    /* ---- transient post drivers (speed lines decay on their own) ---- */
    this._speed = 0;
    this._speedDecay = 0;

    /* ---- throttles (seconds) ---- */
    this._clock = 0;
    this._landCd = 0;
    this._stepCd = 0;
    this._slideCd = 0;
    this._scrapeCd = 0;
    this._coinCd = 0;
    this._coinStreak = 0;
    this._decalCd = 0;
    this._printCd = 0;
    this._bubbleCd = 0;
    this._popCd = 0;

    /* ---- last known solid ground, so a death mark lands on a real surface ---- */
    this._ground = new THREE.Vector3();
    this._groundT = -999;
    this._groundValid = false;
    this._groundSurface = 'stone';

    this.theme = null;
    this.palette = {
      checkpoint: 0x7ef0ff,
      crest: 0xffd76a,
      sigil: 0xc07bff,
      coin: 0xffcf4d,
      bounce: 0xffd27a,
      accent: 0x7ec8ff,
      water: 0x7fd0ec,
    };
  }

  /* ------------------------------------------------------------------ *
   *  wiring
   * ------------------------------------------------------------------ */

  /** attach parts constructed after Impacts (Post, Decals, FollowCamera, Audio) */
  attach(parts = EMPTY) {
    if (parts.ps) this.ps = parts.ps;
    if (parts.audio) this.audio = parts.audio;
    if (parts.camera) this.camera = parts.camera;
    if (parts.post) this.setPost(parts.post);
    if (parts.decals) this.decals = parts.decals;
    return this;
  }

  setPost(post) {
    this.post = post || null;
    this._baseSaturation = this._readBaseSaturation();
    return this;
  }

  setDecals(decals) { this.decals = decals || null; return this; }
  setCamera(camera) { this.camera = camera || null; return this; }
  setAudio(audio) { this.audio = audio || null; return this; }
  setParticles(ps) { this.ps = ps || null; return this; }

  /**
   * Adopt a ThemeDef's palette (CONTRACT §15) for the collect / checkpoint tints,
   * and forward it to the particle system so bursts and flashes agree.
   * @param {object} theme ThemeDef
   */
  setTheme(theme) {
    this.theme = theme || null;
    if (this.ps && typeof this.ps.setTheme === 'function') this.ps.setTheme(theme);
    const pal = theme && theme.palette;
    if (pal) {
      if (pal.checkpointOn !== undefined) this.palette.checkpoint = pal.checkpointOn;
      else if (pal.checkpoint !== undefined) this.palette.checkpoint = pal.checkpoint;
      if (pal.crest !== undefined) this.palette.crest = pal.crest;
      if (pal.sigil !== undefined) this.palette.sigil = pal.sigil;
      if (pal.coin !== undefined) this.palette.coin = pal.coin;
      if (pal.accent !== undefined) this.palette.accent = pal.accent;
      if (pal.water !== undefined) this.palette.water = pal.water;
      if (pal.safeEdge !== undefined) this.palette.bounce = pal.safeEdge;
    }
    // the theme's grade owns the resting saturation the death desaturate returns to
    this._baseSaturation = this._readBaseSaturation();
  }

  /* ------------------------------------------------------------------ *
   *  safe adapters — every collaborator is built by a different module, so
   *  nothing here assumes a method exists or that a call cannot throw.
   * ------------------------------------------------------------------ */

  _sfx(name, gain, rate) {
    const a = this.audio;
    if (!a || typeof a.sfx !== 'function' || !name) return;
    try {
      a.sfx(name, { gain: clamp(gain === undefined ? 1 : gain, 0, 2), rate: rate || 1 });
    } catch (e) { /* audio must never take a frame down */ }
  }

  _stinger(name) {
    const a = this.audio;
    if (!a || typeof a.stinger !== 'function' || !name) return;
    try { a.stinger(name); } catch (e) { /* ignore */ }
  }

  _duck(ms) {
    const a = this.audio;
    if (a && typeof a.duck === 'function') { try { a.duck(ms); } catch (e) { /* ignore */ } }
  }

  _mood(m) {
    const a = this.audio;
    if (a && typeof a.setMood === 'function') { try { a.setMood(m); } catch (e) { /* ignore */ } }
  }

  /** third-person impact: distance dips in, FOV kicks, pitch nods (CONTRACT §12) */
  _punch(amount) {
    const c = this.camera;
    if (c && typeof c.punch === 'function') c.punch(clamp(amount, 0, 2));
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
    if (p && typeof p.pulse === 'function' && amount > 0) p.pulse(amount, ms, color);
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

  /** the FinishPass saturation the theme's grade is resting at */
  _readBaseSaturation() {
    const p = this.post;
    if (p && p._grade && typeof p._grade.saturation === 'number') return p._grade.saturation;
    return 1;
  }

  /**
   * Drive the death desaturation directly on the FinishPass uniform. Post owns
   * the grade; we only *bend* it and always put it back (`_desatHeld` guarantees
   * the restore happens even if a death is cancelled mid-phase).
   * @param {number} v01 0 = the theme's grade, 1 = fully monochrome
   */
  _desaturate(v01) {
    const p = this.post;
    const pass = p && p.finishPass;
    const u = pass && pass.uniforms;
    if (!u || !u.uSaturation) return;
    const v = clamp(v01, 0, 1);
    this._desat = v;
    u.uSaturation.value = this._baseSaturation * (1 - v);
    this._desatHeld = v > 0;
  }

  _restoreSaturation() {
    if (!this._desatHeld) return;
    const p = this.post;
    const u = p && p.finishPass && p.finishPass.uniforms;
    if (u && u.uSaturation) u.uSaturation.value = this._baseSaturation;
    this._desat = 0;
    this._desatHeld = false;
  }

  /* ------------------------------------------------------------------ *
   *  post drivers the controller reaches through here
   * ------------------------------------------------------------------ */

  /**
   * Radial speed streaks (CONTRACT §7 `setSpeedLines`). Long jump, dive and speed
   * pads fire this at launch; it decays over `decay` seconds by itself so the
   * controller never has to remember to switch it off.
   * @param {number} v01
   * @param {number} [decay=0.45] seconds back to zero
   */
  speedLines(v01, decay) {
    const v = clamp(v01, 0, 1);
    if (v > this._speed) {
      this._speed = v;
      this._speedDecay = Math.max(0.05, decay === undefined ? 0.45 : decay);
      const p = this.post;
      if (p && typeof p.setSpeedLines === 'function') p.setSpeedLines(this._speed, true);
    }
  }

  /** Underwater grade amount (CONTRACT §7). The camera normally drives this. */
  underwater(v01, immediate) {
    const p = this.post;
    if (p && typeof p.setUnderwater === 'function') p.setUnderwater(clamp(v01, 0, 1), !!immediate);
  }

  /** Heat shimmer amount — Ember Foundry drives it from lava proximity. */
  heat(v01, immediate) {
    const p = this.post;
    if (p && typeof p.setHeat === 'function') p.setHeat(clamp(v01, 0, 1), !!immediate);
  }

  /* ==================================================================== *
   *  MOVEMENT EVENTS  (CONTRACT §11 Player.events)
   * ==================================================================== */

  /**
   * LANDING. `impactSpeed` is the downward speed the ground absorbed, m/s.
   * Bands (gravFall 46): a step-off ~4, a clean single jump ~11.4, a 4 m drop
   * ~19, a hard landing is `TUNE.hardLandSpeed` = 22 and above.
   *
   * @param {number} impactSpeed  m/s, sign ignored
   * @param {string} surface      Collider.surface ('grass'|'stone'|'ice'|…)
   * @param {THREE.Vector3|number[]} pos     contact point (the FEET)
   * @param {THREE.Vector3|number[]} [normal] ground normal
   * @returns {number} 0..1 landing strength, for the caller's own reaction
   */
  land(impactSpeed, surface, pos, normal) {
    if (!this.enabled) return 0;
    const v = Math.abs(impactSpeed || 0);
    if (!readVec(pos, _p)) return 0;

    // remember where solid ground was — a death mark will be placed here
    this._ground.copy(_p);
    this._groundT = this._clock;
    this._groundValid = true;
    this._groundSurface = surface || 'stone';

    if (v < LAND_MIN) {
      // a step down, not a landing: a quiet surface tick and nothing else
      if (this._stepCd <= 0) {
        this._stepCd = 0.09;
        this._sfx(stepSoundFor(surface), 0.20, 0.96 + Math.random() * 0.08);
      }
      return 0;
    }
    if (this._landCd > 0) return 0;
    this._landCd = 0.06;

    const s = clamp((v - LAND_RAMP_LO) / (LAND_RAMP_HI - LAND_RAMP_LO), 0, 1);
    const hard = v >= LAND_HARD;

    if (!readVec(normal, _n)) _n.copy(_up);

    // ---- particles: a soft ring for a normal landing, a full slam for a hard one
    this._burst(hard ? 'hardLand' : 'land', _p, { strength: s, surface, normal: _n });

    // ---- camera: the punch scales with the impact; only a HARD landing shakes
    this._punch(clamp(0.10 + 0.55 * s, 0.08, 0.7));
    if (v >= LAND_SHAKE_AT) this._shake(0.12 + 0.20 * s, 140);

    // ---- audio: the graded land thump plus a surface-coloured tick on top
    this._sfx(hard ? 'land_hard' : 'land_soft', 0.34 + 0.66 * s, 1.06 - 0.16 * s);
    this._sfx(stepSoundFor(surface), 0.20 + 0.35 * s, 0.92 + 0.1 * (1 - s));

    // ---- decal: a scuff only for landings that genuinely hurt, ≤ 1 per 1.2 s
    if (v > LAND_DECAL_AT && this._decalCd <= 0 && this.decals) {
      this._decalCd = 1.2;
      this.decals.add('scuff', _p, _n, {
        size: 0.55 + 0.5 * s,
        alpha: 0.13 + 0.16 * s,
        aspect: 1.25 + 0.5 * s,
        jitter: 0.06,
      });
    }

    // ---- a hard landing takes a sliver of time with it
    if (hard) this.slowmo(0.5, 0.05);

    this._emit('land', { speed: v, surface, strength: s, hard });
    return s;
  }

  /**
   * JUMP. `kind` is the contract's jump identity, so one call covers the whole
   * family and the sound/dust/streak stay in lockstep with the controller state.
   * @param {number|string} kind 1|2|3 or 'longjump'|'backflip'|'sideflip'|'poundjump'|'slidehop'
   * @param {THREE.Vector3|number[]} pos take-off point (the FEET)
   * @param {string} [surface]
   */
  jump(kind, pos, surface) {
    if (!this.enabled) return;
    const has = readVec(pos, _p);

    switch (kind) {
      case 3:
      case '3':
      case 'jump3':
        if (has) this._burst('jump3', _p, { surface });
        this._sfx('jump3', 0.85, 1.0);
        this._punch(0.12);
        break;
      case 2:
      case '2':
      case 'jump2':
        if (has) this._burst('jump', _p, { surface, strength: 0.7 });
        this._sfx('jump2', 0.72, 1.0);
        break;
      case 'longjump':
        if (has) this._burst('longjump', _p, { surface });
        this._sfx('longjump', 0.95, 1.0);
        this.speedLines(0.85, 0.7);
        this._punch(0.18);
        break;
      case 'backflip':
        if (has) this._burst('jump3', _p, { surface, strength: 0.8 });
        this._sfx('backflip', 0.85, 1.0);
        break;
      case 'sideflip':
        if (has) this._burst('jump3', _p, { surface, strength: 0.7 });
        this._sfx('sideflip', 0.85, 1.0);
        break;
      case 'poundjump':
        if (has) this._burst('poundShock', _p, { surface, radius: TUNE.pound.shockRadius * 0.6 });
        this._sfx('jump3', 0.9, 0.92);
        this._punch(0.22);
        break;
      case 'slidehop':
        if (has) this._burst('jump', _p, { surface, strength: 0.5 });
        this._sfx('jump1', 0.6, 1.12);
        break;
      default:
        if (has) this._burst('jump', _p, { surface });
        this._sfx('jump1', 0.6, 0.97 + Math.random() * 0.07);
        break;
    }
    this._emit('jump', { kind, surface });
  }

  /**
   * WALL KICK (CONTRACT §11). Sparks off the wall along its normal, a snappy
   * punch, and a short shake — the kick has to feel like it COST the wall
   * something or the shaft climb reads as floating.
   * @param {THREE.Vector3|number[]} pos contact point on the wall
   * @param {THREE.Vector3|number[]} [normal] wall normal (pointing at the hero)
   */
  wallkick(pos, normal) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) {
      const hasN = readVec(normal, _n);
      this._burst('wallkick', _p, { normal: hasN ? _n : null, color: this.palette.accent });
      this._burst('spark', _p, { dir: hasN ? _n : null, power: 0.8, count: 8 });
    }
    this._sfx('wallkick', 0.85, 1.0 + Math.random() * 0.06);
    this._punch(0.20);
    this._shake(0.10, 110);
    this._emit('wallkick', {});
  }

  /**
   * DIVE (CONTRACT §11). A forward whoosh plus streaks; the belly slide that
   * follows is `slide()`.
   * @param {THREE.Vector3|number[]} pos
   * @param {string} [surface]
   */
  dive(pos, surface) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('dive', _p, { surface });
    this._sfx('dive', 0.8, 1.0);
    this.speedLines(0.7, 0.55);
    this._punch(0.14);
    this._emit('dive', { surface });
  }

  /**
   * BELLY SLIDE / skid. Called every frame while sliding; throttled internally to
   * ~14 Hz so it never floods the pool or the audio graph. Leaves a faint slide
   * mark on surfaces that hold one.
   * @param {THREE.Vector3|number[]} pos
   * @param {string} surface
   * @param {number} speed m/s
   * @param {object} [opts] {dir, normal}
   */
  slide(pos, surface, speed, opts = EMPTY) {
    if (!this.enabled) return;
    if (this._slideCd > 0) return;
    this._slideCd = 0.07;
    if (!readVec(pos, _p)) return;
    const v = Math.abs(speed || 0);
    const f = clamp(v / TUNE.speedRun, 0, 1);

    this._burst('slideDust', _p, { surface, speed: v, count: 2 + ((f * 3) | 0) });
    this._sfx('slide', 0.16 + 0.30 * f, 0.94 + 0.22 * f);

    if (this.decals && this._decalCd <= 0 && f > 0.35) {
      this._decalCd = 0.55;
      if (!readVec(opts.normal, _n)) _n.copy(_up);
      this.decals.add('slideMark', _p, _n, {
        dir: opts.dir,
        size: 0.5 + 0.6 * f,
        alpha: 0.10 + 0.10 * f,
      });
    }
  }

  /**
   * PIVOT SKID — the analog reversal at speed (CONTRACT §11 "reversing at speed
   * produces a `pivot` (skid dust, 0.12 s)"). A tighter, louder cousin of slide().
   * @param {THREE.Vector3|number[]} pos
   * @param {string} surface
   * @param {number} speed
   * @param {object} [opts] {dir, normal}
   */
  pivot(pos, surface, speed, opts = EMPTY) {
    if (!this.enabled) return;
    if (!readVec(pos, _p)) return;
    const f = clamp(Math.abs(speed || 0) / TUNE.speedRun, 0, 1);
    this._burst('slideDust', _p, { surface, speed: Math.abs(speed || 0), count: 4 + ((f * 4) | 0) });
    this._sfx('slide', 0.22 + 0.28 * f, 1.15 + 0.2 * f);
    if (this.decals && this._decalCd <= 0 && f > 0.5) {
      this._decalCd = 0.9;
      if (!readVec(opts.normal, _n)) _n.copy(_up);
      this.decals.add('skid', _p, _n, { dir: opts.dir, size: 0.55 + 0.4 * f, alpha: 0.14 + 0.08 * f });
    }
  }

  /** GROUND POUND, hang phase — the 0.2 s spin before the drop (CONTRACT §11). */
  poundHang(pos) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('pound', _p, {});
    this._sfx('pound_hang', 0.7, 1.0);
    this.slowmo(0.72, 0.10);
    this._emit('poundHang', {});
  }

  /**
   * GROUND POUND, the landing (CONTRACT §8 `pound(pos)`). The single loudest
   * ground effect in the game: a dust ring, an expanding shock sprite, a crack
   * decal, a full camera punch and a hit-stop.
   * @param {THREE.Vector3|number[]} pos
   * @param {string} [surface]
   * @param {THREE.Vector3|number[]} [normal]
   */
  pound(pos, surface, normal) {
    if (!this.enabled) return;
    if (!readVec(pos, _p)) return;
    if (!readVec(normal, _n)) _n.copy(_up);

    this._ground.copy(_p);
    this._groundT = this._clock;
    this._groundValid = true;
    this._groundSurface = surface || this._groundSurface;

    const r = TUNE.pound.shockRadius;
    this._burst('pound', _p, { surface });
    this._burst('poundShock', _p, { surface, radius: r });

    this._sfx('pound_land', 1.0, 0.95 + Math.random() * 0.06);
    this._sfx(stepSoundFor(surface), 0.4, 0.82);

    this._punch(1.0);
    this._shake(0.34, 220);
    this.slowmo(0.35, 0.09);
    this._pulse(0.16, 120, this.palette.accent);

    if (this.decals) {
      this.decals.poundCrack(_p, _n, { radius: r * 0.55, alpha: 0.38 });
    }

    this._emit('pound', { surface, radius: r });
  }

  /**
   * FOOTSTEP. The Hero animator drives the cadence (a foot planted at the bottom
   * of the run cycle); this only guards against spam, picks the surface sound,
   * throws the surface's puff and lays a boot print where the ground holds one.
   *
   * CONTRACT §8 names this `stepDust(pos, surface)`.
   *
   * @param {THREE.Vector3|number[]} pos foot contact point
   * @param {string} surface
   * @param {object} [opts] {dir, yaw, side:-1|1, speed, normal, print}
   */
  stepDust(pos, surface, opts = EMPTY) {
    if (!this.enabled) return;
    if (this._stepCd > 0) return;
    this._stepCd = 0.11;

    const speed = typeof opts.speed === 'number' ? Math.abs(opts.speed) : TUNE.speedRun;
    const f = clamp(speed / TUNE.speedRun, 0.25, 1);

    this._sfx(stepSoundFor(surface), 0.20 + 0.22 * f, 0.93 + Math.random() * 0.14);

    const has = readVec(pos, _p);
    if (!has) return;

    const puff = puffFor(surface);
    if (puff && Math.random() < 0.35 + 0.35 * f) {
      this._burst(puff, _p, { surface, count: 2, scale: 0.45 + 0.25 * f });
    }

    if (this.decals && opts.print !== false && this._printCd <= 0) {
      this._printCd = 0.05;
      // heading: an explicit direction wins, otherwise convert the hero's yaw
      let dir = null;
      if (readVec(opts.dir, _dir)) dir = _dir;
      else if (typeof opts.yaw === 'number') dir = headingFromYaw(opts.yaw, _dir);
      if (!readVec(opts.normal, _n)) _n.copy(_up);
      this.decals.footprint(_p, _n, {
        surface,
        dir,
        side: opts.side,
        scale: 0.9 + 0.2 * f,
      });
    }
  }

  /** Alias kept for callers that speak the Player's `'step'` event name. */
  step(surface, pos, opts) { this.stepDust(pos, surface, opts); }

  /**
   * SPLASH — entering or leaving water (CONTRACT §8 `splash(pos)`).
   * @param {THREE.Vector3|number[]} pos the point where the surface was broken
   * @param {object} [opts] {entering:boolean, speed:number, color}
   */
  splash(pos, opts = EMPTY) {
    if (!this.enabled) return;
    const speed = typeof opts.speed === 'number' ? Math.abs(opts.speed) : 8;
    const s = clamp(speed / 18, 0.25, 1);
    if (readVec(pos, _p)) {
      this._burst('splash', _p, { strength: s, color: opts.color !== undefined ? opts.color : this.palette.water });
    }
    this._sfx('splash', 0.45 + 0.55 * s, opts.entering === false ? 1.12 : 0.96);
    if (opts.entering === false) this._sfx('surface', 0.6, 1.0);
    this._punch(0.12 + 0.2 * s);
    this._emit('splash', { entering: opts.entering !== false, strength: s });
  }

  /** Breaking the surface from below — the gasp + ring. */
  surfaceBreak(pos) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('splash', _p, { strength: 0.45, color: this.palette.water });
    this._sfx('surface', 0.75, 1.0);
  }

  /** A swim stroke. The controller calls this on its stroke cadence. */
  swimStroke(pos) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('bubbles', _p, { count: 4, color: this.palette.water });
    this._sfx('swim_stroke', 0.4, 0.95 + Math.random() * 0.12);
  }

  /**
   * Bubbles trailing the submerged hero. Called every frame while submerged;
   * throttled to ~5 Hz.
   * @param {THREE.Vector3|number[]} pos
   * @param {number} [surfaceY] the water plane, so bubbles pop at the right height
   */
  bubbles(pos, surfaceY) {
    if (!this.enabled) return;
    if (this._bubbleCd > 0) return;
    this._bubbleCd = 0.2;
    if (readVec(pos, _p)) this._burst('bubbles', _p, { count: 3, surfaceY, color: this.palette.water });
  }

  /** Climbing a pole / net / tree: a scuff of bark or rope, no camera work. */
  climb(pos, surface) {
    if (!this.enabled) return;
    if (this._stepCd > 0) return;
    this._stepCd = 0.16;
    this._sfx(stepSoundFor(surface || 'wood'), 0.16, 1.2 + Math.random() * 0.15);
    if (readVec(pos, _p)) this._burst('dust', _p, { surface: surface || 'wood', count: 2, scale: 0.4 });
  }

  /** Wall slide contact — throttled to ~18 Hz. */
  wallScrape(pos, normal, speed) {
    if (!this.enabled) return;
    if (this._scrapeCd > 0) return;
    this._scrapeCd = 0.055;
    if (!readVec(pos, _p)) return;
    const v = Math.abs(speed || 0);
    const hasN = readVec(normal, _n);
    this._burst('spark', _p, { dir: hasN ? _n : null, power: 0.35, count: 2, spread: 0.5 });
    this._sfx('step_stone', 0.10 + clamp(v / 30, 0, 0.16), 1.45 + Math.random() * 0.2);
  }

  /* ==================================================================== *
   *  COLLECTIBLES + PROGRESS
   * ==================================================================== */

  /**
   * COLLECT (CONTRACT §8 `collect(kind, pos)`).
   * @param {string} kind 'coin'|'sigil'|'crest'|'crestGrand'
   * @param {THREE.Vector3|number[]} pos
   * @param {object} [opts] {id, color}
   */
  collect(kind, pos, opts = EMPTY) {
    if (!this.enabled) return;
    const st = COLLECT_STYLE[kind] || COLLECT_STYLE.coin;
    const color = opts.color !== undefined ? opts.color : this.palette[st.tint];

    if (readVec(pos, _p)) this._burst(st.burst, _p, { color });

    if (kind === 'coin') {
      // a rising pitch ladder makes a run of coins feel like a phrase, not a repeat
      if (this._coinCd > 0) this._coinStreak = Math.min((this._coinStreak || 0) + 1, 7);
      else this._coinStreak = 0;
      this._coinCd = 0.55;
      this._sfx('coin', st.gain, 1 + this._coinStreak * 0.045);
    } else {
      this._sfx(st.sfx, st.gain, 1);
    }

    if (st.stinger) this._stinger(st.stinger);
    if (st.pulse > 0) this._pulse(st.pulse, kind === 'crestGrand' ? 420 : 260, color);
    if (st.shake > 0) this._shake(st.shake, kind === 'crestGrand' ? 380 : 200);
    if (st.punch > 0) this._punch(st.punch);
    if (kind === 'crest' || kind === 'crestGrand') {
      this._duck(kind === 'crestGrand' ? 1400 : 900);
      this.slowmo(kind === 'crestGrand' ? 0.3 : 0.45, 0.24);
    }

    this._emit('collect', { kind, id: opts.id, color });
  }

  /** All 8 sigils in — the crest that spawns is announced with its own stinger. */
  sigilsDone(pos) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('sigil', _p, { color: this.palette.sigil });
    this._stinger('sigilsDone');
    this._pulse(0.35, 320, this.palette.sigil);
    this._emit('sigilsDone', {});
  }

  /** The 100th coin. */
  coins100(pos) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('coin', _p, { color: this.palette.coin });
    this._stinger('coins100');
    this._pulse(0.35, 320, this.palette.coin);
    this._emit('coins100', {});
  }

  /** CHECKPOINT reached (CONTRACT §11 'checkpoint'). */
  checkpoint(pos, idx) {
    if (!this.enabled) return;
    const c = this.palette.checkpoint;
    if (readVec(pos, _p)) this._burst('checkpoint', _p, { color: c });
    this._sfx('checkpoint', 0.9);
    this._stinger('checkpoint');
    this._pulse(0.20, 220, c);
    this._shake(0.10, 150);
    this._emit('checkpoint', { idx: idx | 0, color: c });
  }

  /** COURSE CLEAR — the pedestal celebration (CONTRACT §28). */
  courseClear(pos) {
    if (!this.enabled) return;
    const c = this.palette.crest;
    if (readVec(pos, _p)) this._burst('courseClear', _p, { color: c });
    this._stinger('courseClear');
    this._duck(1600);
    this._pulse(0.55, 420, c);
    this._shake(0.20, 380);
    this.slowmo(0.32, 0.3);
    this._mood('clear');
    this._emit('courseClear', { color: c });
  }

  /** A gate / painting opening in the Keep. */
  gateOpen(pos, w, h) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('gateOpen', _p, { color: this.palette.accent, w: w || 3, h: h || 4 });
    this._sfx('gate_open', 0.9);
    this._stinger('unlock');
    this._pulse(0.22, 320, this.palette.accent);
    this._emit('gateOpen', {});
  }

  /** Stepping into a painting — the ripple that precedes the course load. */
  paintingRipple(pos, radius) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('paintingRipple', _p, { color: this.palette.accent, radius: radius || 1.6 });
    this._sfx('painting_enter', 0.85);
    this._pulse(0.30, 380, this.palette.accent);
    this._emit('paintingRipple', {});
  }

  /* ==================================================================== *
   *  HAZARDS + CRITTERS
   * ==================================================================== */

  /** A bounce pad launch. The camera owns the FOV kick; this is the pad's reaction. */
  bounce(pos, power, normal) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) {
      this._burst('bounce', _p, { power: power || TUNE.bounceDefaultApex, color: this.palette.bounce, normal });
    }
    this._sfx('bounce', 0.85, 0.94 + clamp((power || 4) / 18, 0, 0.22));
    this._shake(0.12, 120);
    this._emit('bounce', { power: power || TUNE.bounceDefaultApex });
  }

  /** A crusher slamming shut. If it also kills, the Game calls death('crush'). */
  crush(pos, dir) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('crush', _p, { dir });
    this._sfx('crusher_slam', 0.9, 0.95 + Math.random() * 0.1);
    this._shake(0.30, 220);
    this._emit('crush', {});
  }

  /** A vanishing platform blinking out from under the hero. */
  vanish(pos, size) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) {
      this._burst('vanish', _p, {
        sx: size && size[0] ? size[0] * 0.5 : 1.2,
        sz: size && size[2] ? size[2] * 0.5 : 1.2,
        color: this.palette.accent,
      });
    }
    this._sfx('vanish_warn', 0.6);
  }

  /** Lava bubbling — driven by the lava hazard, throttled, cheap and ambient. */
  lavaPop(pos, power) {
    if (!this.enabled) return;
    if (this._popCd > 0) return;
    this._popCd = 0.06;
    if (readVec(pos, _p)) this._burst('lavaPop', _p, { power: power || 1 });
    if (Math.random() < 0.4) this._sfx('lava_bubble', 0.18 + Math.random() * 0.16, 0.8 + Math.random() * 0.5);
  }

  /** Ice cracking / a shard hazard shattering. */
  iceShard(pos, color) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('iceShard', _p, { color });
  }

  /** A generic spark spray (breakables, metal on metal, cannon ignition). */
  spark(pos, dir, power) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('spark', _p, { dir, power: power || 1 });
  }

  /** A breakable block shattering under a pound. */
  breakBlock(pos, surface) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) {
      this._burst('crush', _p, { surface });
      this._burst('dust', _p, { surface, count: 10, scale: 1.2 });
    }
    this._sfx('crusher_slam', 0.55, 1.25 + Math.random() * 0.12);
    this._shake(0.12, 130);
  }

  /** A cannon firing the hero. */
  cannonFire(pos) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) {
      this._burst('spark', _p, { power: 1.4, count: 16 });
      this._burst('dust', _p, { count: 10, scale: 1.4 });
    }
    this._sfx('cannon_fire', 1.0);
    this._shake(0.28, 240);
    this.speedLines(0.9, 0.8);
  }

  /** Passing through a ring (CONTRACT §11 'ringPass'). */
  ringPass(pos, radius, color) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) {
      this._burst('ringPass', _p, { radius: radius || 1.4, color: color !== undefined ? color : this.palette.accent });
    }
    this._sfx('ring_pass', 0.7, 1 + Math.random() * 0.06);
    this._emit('ringPass', {});
  }

  /** The wing power's downbeat gust. */
  wingGust(pos) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('wingGust', _p, { color: this.palette.accent });
    this._sfx('wind', 0.35, 1.1 + Math.random() * 0.15);
  }

  /** A GNASHER lunging and biting. Fatal contact also calls death('gnasher'). */
  gnasherBite(pos) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('gnasherBite', _p, {});
    this._sfx('gnasher_bite', 0.95, 0.96 + Math.random() * 0.1);
    this._shake(0.18, 180);
  }

  /** A BUMBLER squished by a landing or a pound — 3 coins and a comedy pop. */
  squish(pos, surface) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('squish', _p, { surface });
    this._sfx('bumbler_squish', 0.85, 0.95 + Math.random() * 0.14);
    this._punch(0.3);
    this.slowmo(0.55, 0.06);
    this._emit('squish', {});
  }

  /** A SKITTER swooping past. */
  skitter(pos) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) this._burst('wingGust', _p, { color: this.palette.accent });
    this._sfx('skitter', 0.5, 0.95 + Math.random() * 0.16);
  }

  /** A WARDEN taking a hit. `hp` drives the intensity of the reaction. */
  wardenHit(pos, hp) {
    if (!this.enabled) return;
    if (readVec(pos, _p)) {
      this._burst('crush', _p, { color: CAUSE_COLOR.warden });
      this._burst('spark', _p, { power: 1.2, count: 14, color: CAUSE_COLOR.warden });
    }
    this._sfx('warden_hit', 1.0);
    this._pulse(0.3, 200, CAUSE_COLOR.warden);
    this._shake(0.3, 260);
    this.slowmo(0.3, 0.16);
    this._emit('wardenHit', { hp: hp | 0 });
  }

  /** The WARDEN's roar / telegraph. */
  wardenRoar(pos) {
    if (!this.enabled) return;
    this._sfx('warden_roar', 1.0);
    this._shake(0.16, 420);
    this._mood('boss');
    if (readVec(pos, _p)) this._burst('dust', _p, { count: 12, scale: 1.5 });
  }

  /* ==================================================================== *
   *  DEATH  (CONTRACT §28)
   * ==================================================================== */

  /**
   * DEATH — starts the 700 ms sequence and returns immediately. Everything after
   * this point is driven by `update()`; the Game polls `timeScale`,
   * `rewindProgress`, `fadeAlpha` and `consumeRespawn()`.
   *
   * CONTRACT §8 signature is `death(cause, pos)`; `dir` is an optional third
   * argument (the direction of the blow, hazard → hero) that only colours the
   * debris spray.
   *
   * @param {string} cause 'lava'|'void'|'spike'|'crush'|'saw'|'toxic'|'gnasher'|'warden'|'water'|'fall'|'manual'
   * @param {THREE.Vector3|number[]} pos
   * @param {THREE.Vector3|number[]} [dir]
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
    this._rewindCd = 0;
    this._baseSaturation = this._readBaseSaturation();

    if (readVec(pos, _p)) this._deathPos.copy(_p); else _p.copy(this._deathPos);
    const hasDir = readVec(dir, _d);

    // 1. the flash, coloured by cause — the fastest possible read of "what killed me"
    this._pulse(st.pulse, 90, st.color);
    this._damage(0.4);

    // 2. camera hands over to the death cam and takes a hard knock
    this._deathCam(true);
    this._shake(0.55 * st.shake, 260);

    // 3. particles
    this._burst('death', _p, { cause: this.deathCause, color: st.color, dir: hasDir ? _d : null });

    // 4. audio: duck the bed for the whole sequence, cause layer, then the death hit
    this._duck(900);
    if (st.sound) this._sfx(st.sound, 0.85);
    this._sfx('death', 1.0);
    this._stinger('death');

    // 5. a mark on the last known ground, if the hero died anywhere near it
    this._placeDeathDecal(st);

    // 6. the hit-stop: heavier for a slow death (a void fall) than a sharp one
    this.slowmo(st.hitch, 0.10);

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

  /**
   * One sample of the rewind ghost. `runtime/game.js` walks the Player's
   * `history` Ring backward during the rewind phase and calls this with each
   * ghost position; the sparkle trail is what makes the rewind read as a rewind
   * and not as a teleport. Internally throttled — the ring is 60 Hz, the sparkle
   * only needs ~25 Hz.
   *
   * @param {THREE.Vector3|number[]|object} pos ghost position (or a history entry {x,y,z})
   */
  rewindSample(pos) {
    if (!this.enabled || !this.deathActive) return;
    if (this._rewindCd > 0) return;
    this._rewindCd = 0.04;
    if (!readVec(pos, _p)) return;
    const st = styleFor(this.deathCause);
    this._burst('deathRewind', _p, { color: st.color, count: 3 });
  }

  /** Abort an in-flight death sequence (restart / course change). */
  cancelDeath() {
    if (!this.deathActive) {
      this._restoreSaturation();
      return;
    }
    this.deathActive = false;
    this.deathPhase = 'none';
    this.deathT = 0;
    this._respawnPending = false;
    this._respawnFired = false;
    this.timeScale = 1;
    this._hitchDur = 0;
    this._deathCam(false);
    this._damage(0);
    this._restoreSaturation();
  }

  /* ------------------------------------------------------------------ *
   *  slow motion
   * ------------------------------------------------------------------ */

  /**
   * Ease gameplay time from `scale` back to 1 over `dur` seconds. The Game MUST
   * multiply its gameplay dt by `impacts.timeScale`; `update()` takes real dt.
   * @param {number} scale 0.01..1
   * @param {number} dur seconds
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
   *  frame — call with REAL (unscaled) dt, once per frame, BEFORE the Game
   *  applies timeScale to its own gameplay step.
   * ------------------------------------------------------------------ */

  update(dt) {
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);
    this._clock += d;

    // throttles
    if (this._landCd > 0) this._landCd -= d;
    if (this._stepCd > 0) this._stepCd -= d;
    if (this._slideCd > 0) this._slideCd -= d;
    if (this._scrapeCd > 0) this._scrapeCd -= d;
    if (this._coinCd > 0) this._coinCd -= d;
    if (this._decalCd > 0) this._decalCd -= d;
    if (this._printCd > 0) this._printCd -= d;
    if (this._bubbleCd > 0) this._bubbleCd -= d;
    if (this._popCd > 0) this._popCd -= d;
    if (this._rewindCd > 0) this._rewindCd -= d;

    // speed lines decay on their own so the controller can fire-and-forget
    if (this._speed > 0) {
      this._speed -= d / this._speedDecay;
      if (this._speed < 0) this._speed = 0;
      const p = this.post;
      if (p && typeof p.setSpeedLines === 'function') p.setSpeedLines(this._speed);
    }

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

    /* ---- the death state machine ------------------------------------- */
    const t = (this.deathT += d);

    if (t < T.flashEnd) {
      // FLASH — the vignette slams shut, colour is still intact
      this.deathPhase = 'flash';
      this._damage(0.4 + 0.6 * easeOutCubic(t / T.flashEnd));
      this._desaturate(0.25 * (t / T.flashEnd));
    } else if (t < T.rewindEnd) {
      // REWIND — the ghost runs backward; the frame drains to near-monochrome
      this.deathPhase = 'rewind';
      const u = (t - T.flashEnd) / T.rewind;
      this._damage(lerp(1, 0.86, u));
      this._desaturate(lerp(0.25, 0.85, smoothstep(0, 1, u)));
    } else if (t < T.holdEnd) {
      // HOLD — one desaturated beat at the rewind's end point: the "oh" moment
      this.deathPhase = 'hold';
      this._damage(0.86);
      this._desaturate(0.85);
    } else if (t < T.fadeEnd) {
      // FADE — to black; `fadeAlpha` drives the HUD/Transitions veil
      this.deathPhase = 'fade';
      const u = (t - T.holdEnd) / T.fade;
      this._damage(lerp(0.86, 0.7, u));
      this._desaturate(lerp(0.85, 1, u));
    } else {
      if (!this._respawnFired) {
        // the screen is fully black: hand the world back to the Game, release the cam
        this._respawnFired = true;
        this._respawnPending = true;
        this._deathCam(false);
      }
      if (t < T.total) {
        // RESTORE — fade back in, colour returns before the veil lifts fully so the
        // first frame the player can act on is already the real, saturated world
        this.deathPhase = 'restore';
        const u = smoothstep(T.fadeEnd, T.total, t);
        this._damage(0.7 * (1 - u));
        this._desaturate(1 - Math.min(1, u * 1.35));
      } else {
        this.deathPhase = 'none';
        this.deathActive = false;
        this.deathT = 0;
        this._damage(0);
        this._restoreSaturation();
        this._emit('respawned', { cause: this.deathCause });
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  polled state (the Game and the HUD read these)
   * ------------------------------------------------------------------ */

  /** true exactly once per death, at the fade-to-black low point (540 ms) */
  consumeRespawn() {
    if (!this._respawnPending) return false;
    this._respawnPending = false;
    return true;
  }

  /**
   * 0..1 through the REWIND phase. `runtime/game.js` indexes the Player's
   * `history` Ring with `1 - rewindProgress` to draw the ghost travelling
   * backward along the last 0.4 s of the run. 0 outside the phase.
   */
  get rewindProgress() {
    if (!this.deathActive) return 0;
    const t = this.deathT;
    if (t <= T.flashEnd) return 0;
    if (t >= T.rewindEnd) return 1;
    return (t - T.flashEnd) / T.rewind;
  }

  /** true only while the rewind ghost should be on screen */
  get rewinding() {
    return this.deathActive && this.deathT > T.flashEnd && this.deathT < T.holdEnd;
  }

  /** 0..1 screen-black amount — the HUD's death veil / Transitions iris reads this */
  get fadeAlpha() {
    if (!this.deathActive) return 0;
    const t = this.deathT;
    if (t <= T.holdEnd) return 0;
    if (t < T.fadeEnd) return smoothstep(T.holdEnd, T.fadeEnd, t);
    return 1 - smoothstep(T.fadeEnd, T.total, t);
  }

  /**
   * 0..1 iris closure (CONTRACT §28 "desaturate + iris"). It leads the black fade
   * so the iris is already closing while the rewind finishes.
   */
  get irisAmount() {
    if (!this.deathActive) return 0;
    const t = this.deathT;
    if (t <= T.flashEnd) return 0;
    if (t < T.fadeEnd) return smoothstep(T.flashEnd, T.fadeEnd, t);
    return 1 - smoothstep(T.fadeEnd, T.total, t);
  }

  /** current desaturation 0..1 (harness-visible) */
  get desaturation() { return this._desat; }

  /** input is dead from the moment of death until the respawn snap */
  get inputLocked() {
    return this.deathActive && this.deathT < T.fadeEnd;
  }

  /** 0..1 across the whole sequence */
  get deathProgress() {
    return this.deathActive ? clamp(this.deathT / T.total, 0, 1) : 0;
  }

  /** milliseconds elapsed in the current death (what loopcheck measures) */
  get deathMs() {
    return this.deathActive ? this.deathT * 1000 : 0;
  }

  /** true while any timeline (death or a celebration flourish) is running */
  get busy() {
    return this.deathActive || this._hitchDur > 0;
  }

  /* ------------------------------------------------------------------ *
   *  lifecycle
   * ------------------------------------------------------------------ */

  /** full reset — course load, restart, or returning to the Keep */
  reset() {
    this.cancelDeath();
    this.timeScale = 1;
    this._hitchDur = 0;
    this._hitchT = 0;
    this._hitchScale = 1;
    this._clock = 0;
    this._landCd = 0;
    this._stepCd = 0;
    this._slideCd = 0;
    this._scrapeCd = 0;
    this._coinCd = 0;
    this._coinStreak = 0;
    this._decalCd = 0;
    this._printCd = 0;
    this._bubbleCd = 0;
    this._popCd = 0;
    this._rewindCd = 0;
    this._groundValid = false;
    this._groundT = -999;
    this._speed = 0;
    const p = this.post;
    if (p && typeof p.setSpeedLines === 'function') p.setSpeedLines(0, true);
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
