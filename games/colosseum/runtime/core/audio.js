// Colosseum — the audio system.
//
// One AudioContext, four mixer buses (music / sfx / crowd / voice) so the
// settings screen can move each independently, and a pooled decode cache so a
// clash of steel never allocates mid-fight.
//
// AUTOPLAY: browsers refuse to start an AudioContext without a user gesture.
// Rather than fight it, everything queued before the first gesture is held and
// released on unlock — so a horn cued during the loading screen still sounds,
// just at the right moment.
//
// SPATIALISATION is deliberately cheap: a stereo pan and a distance rolloff
// computed from the listener, not a PannerNode per source. At the ranges a
// gladiator fight happens over, full HRTF costs CPU for something nobody can
// hear, and the panning is what actually helps the player locate a second
// attacker.

import { CrowdVoice, playCall } from "./synth.js";
import { clamp } from "./util.js";

const MUSIC = ["menu", "ludus", "prematch", "combat", "combat2", "boss", "victory", "defeat"];

const SFX = [
  "sword_swing_1", "sword_swing_2", "sword_swing_3",
  "sword_hit_1", "sword_hit_2", "sword_hit_3",
  "block_1", "block_2", "block_3", "shield_break",
  "step_sand_1", "step_sand_2", "step_sand_3", "step_sand_4",
  "beast_roar_1", "beast_roar_2",
  "gate_iron", "stone_grind",
  "ui_click", "ui_confirm", "ui_back", "coin", "equip",
  "vo_effort_1", "vo_effort_2", "vo_effort_3", "vo_effort_4",
  "vo_hurt_1", "vo_hurt_2", "vo_hurt_3", "vo_hurt_4",
  "vo_death_1", "vo_death_2", "vo_death_3", "vo_death_4",
];

/** Named cues -> the variants they may pick from. */
const CUE = {
  swing: ["sword_swing_1", "sword_swing_2", "sword_swing_3"],
  hit: ["sword_hit_1", "sword_hit_2", "sword_hit_3"],
  block: ["block_1", "block_2", "block_3"],
  parry: ["block_1", "block_2"],
  shield_break: ["shield_break"],
  step: ["step_sand_1", "step_sand_2", "step_sand_3", "step_sand_4"],
  beast: ["beast_roar_1", "beast_roar_2"],
  gate: ["gate_iron"],
  trapdoor: ["stone_grind"],
  click: ["ui_click"],
  confirm: ["ui_confirm"],
  back: ["ui_back"],
  coin: ["coin"],
  equip: ["equip"],
  effort: ["vo_effort_1", "vo_effort_2", "vo_effort_3", "vo_effort_4"],
  hurt: ["vo_hurt_1", "vo_hurt_2", "vo_hurt_3", "vo_hurt_4"],
  death: ["vo_death_1", "vo_death_2", "vo_death_3", "vo_death_4"],
};

export class Audio {
  constructor({ base = "assets/audio", volumes = null } = {}) {
    this.base = base;
    this.ctx = null;
    this.unlocked = false;
    this.buffers = new Map();
    this.pending = [];
    this.crowd = null;
    this.currentMusic = null;
    this.musicEl = null;
    this._musicPool = new Map();
    this.listener = { x: 0, z: 0, yaw: 0 };
    this._lastStep = 0;

    this.volumes = Object.assign(
      { master: 0.8, music: 0.5, sfx: 0.9, crowd: 0.7, voice: 0.85 },
      volumes || {}
    );

    // The first gesture anywhere unlocks audio.
    this._unlock = () => this.unlock();
    for (const ev of ["pointerdown", "keydown", "touchstart"]) {
      window.addEventListener(ev, this._unlock, { once: false, passive: true });
    }
  }

  // -- lifecycle -----------------------------------------------------------

  unlock() {
    if (this.unlocked) return true;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return false; }
    if (this.ctx.state === "suspended") this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.ctx.destination);

    this.bus = {};
    for (const b of ["music", "sfx", "crowd", "voice"]) {
      const g = this.ctx.createGain();
      g.gain.value = this.volumes[b];
      g.connect(this.master);
      this.bus[b] = g;
    }

    this.crowd = new CrowdVoice(this.ctx, this.bus.crowd);
    this.unlocked = true;

    for (const ev of ["pointerdown", "keydown", "touchstart"]) {
      window.removeEventListener(ev, this._unlock);
    }

    // Release anything that was cued before the gesture.
    const q = this.pending.splice(0);
    for (const fn of q) { try { fn(); } catch (e) { /* a stale cue is harmless */ } }
    return true;
  }

  /** Decode every SFX. Music streams via <audio> and is not decoded. */
  async preload(onProgress = null) {
    if (!this.unlocked) this.unlock();
    if (!this.ctx) return { loaded: 0, failed: SFX.length };
    let loaded = 0, failed = 0;
    await Promise.all(SFX.map(async (name) => {
      try {
        const r = await fetch(`${this.base}/sfx/${name}.ogg`);
        if (!r.ok) throw new Error(`${r.status}`);
        const ab = await r.arrayBuffer();
        this.buffers.set(name, await this.ctx.decodeAudioData(ab));
        loaded++;
      } catch (e) {
        failed++;
      }
      if (onProgress) onProgress((loaded + failed) / SFX.length);
    }));
    return { loaded, failed };
  }

  setVolume(bus, v) {
    this.volumes[bus] = clamp(v, 0, 1);
    if (!this.unlocked) return;
    if (bus === "master") this.master.gain.value = this.volumes.master;
    else if (this.bus[bus]) this.bus[bus].gain.value = this.volumes[bus];
    if (bus === "music" && this.musicEl) this.musicEl.volume = this.volumes.music * this.volumes.master;
  }

  // -- sfx -----------------------------------------------------------------

  /**
   * Fire a cue.
   * @param {string} cue  a key of CUE
   * @param {object} opts { x, z, gain, rate, bus }
   */
  play(cue, opts = {}) {
    if (!this.unlocked) {
      if (this.pending.length < 40) this.pending.push(() => this.play(cue, opts));
      return null;
    }
    const names = CUE[cue];
    if (!names || !names.length) return null;
    const name = names[(Math.random() * names.length) | 0];
    const buf = this.buffers.get(name);
    if (!buf) return null;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // Pitch variation keeps a flurry of blows from sounding like one sample on
    // repeat — the single cheapest fix for "why does this sound so fake".
    src.playbackRate.value = opts.rate ?? (0.92 + Math.random() * 0.16);

    const g = this.ctx.createGain();
    let gain = opts.gain ?? 1;

    // Cheap spatialisation: pan + distance rolloff relative to the listener.
    let node = g;
    if (opts.x !== undefined && opts.z !== undefined && this.ctx.createStereoPanner) {
      const dx = opts.x - this.listener.x;
      const dz = opts.z - this.listener.z;
      const dist = Math.hypot(dx, dz);
      gain *= 1 / (1 + dist * dist * 0.012);
      const rel = Math.atan2(dx, dz) - this.listener.yaw;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = clamp(Math.sin(rel), -1, 1) * 0.8;
      g.connect(pan);
      node = pan;
    }

    g.gain.value = clamp(gain, 0, 2);
    src.connect(g);
    node.connect(this.bus[opts.bus || (cue.startsWith("vo_") || ["effort", "hurt", "death"].includes(cue) ? "voice" : "sfx")]);
    src.start();
    return src;
  }

  /** Footsteps, rate-limited by distance travelled rather than by timer. */
  step(x, z, speed) {
    if (speed < 0.4) return;
    const now = this.ctx ? this.ctx.currentTime : 0;
    const interval = clamp(0.62 - speed * 0.07, 0.26, 0.62);
    if (now - this._lastStep < interval) return;
    this._lastStep = now;
    this.play("step", { x, z, gain: clamp(speed / 4, 0.15, 0.6) });
  }

  // -- horns ---------------------------------------------------------------

  /** Sound a cornu call. Returns its length in seconds. */
  horn(call = "fanfare", gain = 0.42) {
    if (!this.unlocked) {
      this.pending.push(() => this.horn(call, gain));
      return 0;
    }
    return playCall(this.ctx, this.bus.music, call, { gain });
  }

  // -- crowd ---------------------------------------------------------------

  crowdStart() { if (this.unlocked) this.crowd.start(); }
  crowdStop() { if (this.unlocked) this.crowd.stop(); }
  crowdExcitement(v) { if (this.unlocked) this.crowd.setExcitement(v); }
  crowdSurge(s, attack) { if (this.unlocked) this.crowd.surge(s, attack); }
  crowdHush(d, hold) { if (this.unlocked) this.crowd.hush(d, hold); }

  // -- music ---------------------------------------------------------------

  /**
   * Music streams through <audio> rather than the graph: these are 1.5-2 MB
   * tracks and decoding them all into memory would cost ~100 MB for no benefit.
   */
  music(name, { loop = true, fade = 1.4 } = {}) {
    if (!MUSIC.includes(name)) return;
    if (this.currentMusic === name) return;
    const prev = this.musicEl;
    let el = this._musicPool.get(name);
    if (!el) {
      el = new window.Audio(`${this.base}/music/${name}.mp3`);
      el.preload = "auto";
      this._musicPool.set(name, el);
    }
    el.loop = loop;
    el.currentTime = 0;
    el.volume = 0;
    el.play().catch(() => { /* pre-gesture; the next call retries */ });
    this.musicEl = el;
    this.currentMusic = name;

    const target = this.volumes.music * this.volumes.master;
    const t0 = performance.now();
    const prevV = prev ? prev.volume : 0;
    const step = () => {
      const f = Math.min(1, (performance.now() - t0) / (fade * 1000));
      el.volume = target * f;
      if (prev && prev !== el) prev.volume = prevV * (1 - f);
      if (f < 1) requestAnimationFrame(step);
      else if (prev && prev !== el) prev.pause();
    };
    requestAnimationFrame(step);
  }

  stopMusic(fade = 1.0) {
    const el = this.musicEl;
    if (!el) return;
    const t0 = performance.now();
    const v0 = el.volume;
    this.currentMusic = null;
    const step = () => {
      const f = Math.min(1, (performance.now() - t0) / (fade * 1000));
      el.volume = v0 * (1 - f);
      if (f < 1) requestAnimationFrame(step);
      else el.pause();
    };
    requestAnimationFrame(step);
  }

  /** Where the player is, for panning. */
  setListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  stats() {
    return {
      unlocked: this.unlocked,
      buffers: this.buffers.size,
      of: SFX.length,
      music: this.currentMusic,
      pending: this.pending.length,
      volumes: { ...this.volumes },
    };
  }
}
