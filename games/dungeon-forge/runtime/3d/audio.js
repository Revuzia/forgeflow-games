/**
 * Dungeon Forge — runtime/3d/audio.js
 * Music (OGG loops per mode/theme) + SFX. File-based where the pack has a
 * good sound; procedural WebAudio blips fill the gaps. Everything lazy —
 * nothing plays until the first user gesture.
 */

const REL = new URL("../../", import.meta.url).href;

const MUSIC = {
  menu: "music_menu.ogg",
  build: "music_build.ogg",
  fantasy: "music_fantasy.ogg",
  scifi: "music_scifi.ogg",
  victory: "music_victory.ogg",
  gameover: "music_gameover.ogg",
};

const FILES = {
  door_open: "sfx_door_open.ogg",
  door_close: "sfx_door_close.ogg",
  chest: "sfx_creak.ogg",
  swing: "sfx_knife.ogg",
  step1: "sfx_step1.ogg",
  step2: "sfx_step2.ogg",
  ui: "sfx_ui_click.ogg",
  confirm: "sfx_ui_confirm.ogg",
  error: "sfx_ui_error.ogg",
  hit: "sfx_punch.ogg",
  hurt: "sfx_hit_soft.ogg",
  place: "sfx_ui_click.ogg",
  cloth: "sfx_cloth.ogg",
};

export class GameAudio {
  constructor(game) {
    this.g = game;
    this.enabled = true;
    this.musicOn = true;
    this.cur = null;
    this.curName = null;
    this.buffers = new Map();
    this.ctx = null;
    this._stepFlip = false;
    document.addEventListener("pointerdown", () => this._ensureCtx(), { once: true });
    document.addEventListener("keydown", () => this._ensureCtx(), { once: true });
  }

  _ensureCtx() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5 * (this._sfxVol != null ? this._sfxVol : 1);
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (this._wantMusic) { const w = this._wantMusic; this._wantMusic = null; this.music(w); }
  }

  /** Settings hook: 0..1 for each channel. */
  setVolumes(music, sfx) {
    this._musicVol = music; this._sfxVol = sfx;
    if (this.master) this.master.gain.value = 0.5 * sfx;
    if (this.cur && this.cur.el) this.cur.el.volume = (this.cur.base || 0.3) * music;
  }

  music(name) {
    if (!MUSIC[name]) return;
    if (this.curName === name) return;
    if (!this.ctx) { this._wantMusic = name; return; }
    this.curName = name;
    if (this.cur) { try { const c = this.cur; c.el.pause(); } catch (e) {} this.cur = null; }
    if (!this.musicOn) return;
    const el = new Audio(REL + "assets/audio/" + MUSIC[name]);
    el.loop = name !== "victory" && name !== "gameover";
    const base = name === "build" || name === "menu" ? 0.32 : 0.28;
    el.volume = base * (this._musicVol != null ? this._musicVol : 1);
    el.play().catch(() => {});
    this.cur = { el, base };
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (!this.musicOn && this.cur) { this.cur.el.pause(); this.cur = null; const n = this.curName; this.curName = null; this._wantMusic = n; }
    else if (this.musicOn) { const n = this.curName || this._wantMusic; this.curName = null; if (n) this.music(n); }
    return this.musicOn;
  }

  async _buffer(file) {
    if (this.buffers.has(file)) return this.buffers.get(file);
    const p = fetch(REL + "assets/audio/" + file)
      .then((r) => r.arrayBuffer())
      .then((ab) => this.ctx.decodeAudioData(ab))
      .catch(() => null);
    this.buffers.set(file, p);
    return p;
  }

  async _playFile(file, vol = 0.7, rate = 1) {
    if (!this.ctx || !this.enabled) return;
    const buf = await this._buffer(file);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(this.master);
    src.start();
  }

  _blip(freq, dur = 0.12, type = "square", vol = 0.2, slide = 0) {
    if (!this.ctx || !this.enabled) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), this.ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + dur + 0.02);
  }

  step() {
    this._stepFlip = !this._stepFlip;
    this._playFile(this._stepFlip ? FILES.step1 : FILES.step2, 0.32);
  }

  sfx(name) {
    this._ensureCtx();
    switch (name) {
      case "door_open": return this._playFile(FILES.door_open, 0.8);
      case "door_close": return this._playFile(FILES.door_close, 0.8);
      case "chest": return this._playFile(FILES.chest, 0.8);
      case "swing": this._blip(340, 0.1, "sine", 0.1, -180); return this._playFile(FILES.swing, 0.9, 1.15);
      case "hit": this._blip(95, 0.12, "square", 0.16, -40); return this._playFile(FILES.hit, 1.0);
      case "hurt": this._playFile(FILES.hurt, 1.0); return this._blip(160, 0.2, "sawtooth", 0.16, -80);
      case "eattack": this._blip(150, 0.14, "sawtooth", 0.12, -60); return this._playFile(FILES.swing, 0.5, 0.8);
      case "fire": this._blip(200, 0.3, "sawtooth", 0.16, -140); return this._blip(90, 0.34, "sine", 0.2, -50);
      case "frost": this._blip(1350, 0.16, "triangle", 0.16, -420); return this._blip(880, 0.2, "sine", 0.1, 320);
      case "explosion": this._blip(60, 0.5, "sawtooth", 0.3, -30); this._blip(140, 0.3, "square", 0.2, -100); return this._playFile(FILES.hit, 1.0, 0.6);
      case "javelin": this._blip(900, 0.12, "sine", 0.14, -500); return this._playFile(FILES.swing, 0.8, 1.5);
      case "rumble": this._blip(48, 0.6, "sawtooth", 0.26, -14); return this._blip(85, 0.45, "triangle", 0.2, -40);
      case "die": return this._blip(220, 0.7, "sawtooth", 0.22, -170);
      case "edie": return this._blip(300, 0.4, "square", 0.14, -220);
      case "key": this._blip(880, 0.09, "triangle", 0.2); return setTimeout(() => this._blip(1320, 0.14, "triangle", 0.2), 90);
      case "unlock": this._playFile(FILES.confirm, 0.7); return this._blip(660, 0.16, "triangle", 0.16, 220);
      case "lock": return this._blip(440, 0.14, "triangle", 0.16, -120);
      case "denied": case "error": return this._playFile(FILES.error, 0.6);
      case "place": return this._playFile(FILES.place, 0.4, 1.3);
      case "erase": return this._blip(240, 0.1, "square", 0.12, -80);
      case "bolt": return this._blip(720, 0.16, "sawtooth", 0.12, -320);
      case "potion": return this._blip(520, 0.25, "sine", 0.2, 260);
      case "aggro": return this._blip(180, 0.3, "sawtooth", 0.1, 60);
      case "stairs": return this._playFile(FILES.cloth, 0.7);
      case "win": this._blip(523, 0.18, "triangle", 0.22); setTimeout(() => this._blip(659, 0.18, "triangle", 0.22), 140); return setTimeout(() => this._blip(784, 0.4, "triangle", 0.24), 300);
      case "ui": return this._playFile(FILES.ui, 0.4);
      case "confirm": return this._playFile(FILES.confirm, 0.6);
      default: return this._blip(500, 0.08, "square", 0.1);
    }
  }
}
