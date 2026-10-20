// VALE audio — the WebAudio engine (CONTRACT §11; tokens.json `audio`). Implements the UI's AudioPort.
//
//   buses       music · sfx · ui · voice · ambience → master → limiter → out (Settings.audio volumes;
//               `muteInBackground` silences a hidden tab)
//   cues        AudioCue: random variant file, ±pitchVar semitones, gain, maxVoices (the quietest-
//               priority oldest voice is stolen), cooldown (s), loop; files decode lazily on first use,
//               UI cues preload; an unknown or missing cue is silently ignored (art may still be rendering)
//   format      every cue / bed ships as Ogg Opus with an AAC .m4a sibling (catalog audio.m4a). The session
//               decodes .ogg; the first .ogg that fails to decode (or canPlayType saying no Ogg Opus, or the
//               dev-build switch ?audio=m4a) switches the whole session to .m4a and that file is retried. While
//               the format is undecided only one .ogg is in flight (others wait for it, at most PROBE_MS), so a
//               browser never fetches both formats of a cue unless its .ogg failed. MP4 edit lists trim the AAC
//               priming, so a .m4a starts sample-aligned with its .ogg and loops / beds decode to its exact
//               length: loop points are format-independent (audio/aac.py; Safari pads a one-shot's end to a
//               whole 1024-sample frame of silence, inaudible)
//   music       MusicDef beds crossfade (1.2 s); `layers` start sample-aligned with the main stem and
//               fade by the match's combat intensity (enter above 0.6, leave below 0.35 after 8 s,
//               quantised to the bar); duck() pulls the bed −8 dB under a moment (the ready check)
//   match       attach(client): SimEvents become cues. Spatial cues pan and attenuate by their world
//               position relative to YOUR fighter (the camera's subject); ability cues come from the
//               catalog (`present.sfx` / `hitSfx` / event `sfx`), the rest from the generic set
//               (c_* combat, m_* match events), so content can re-voice any ability without code.
// The context starts suspended (browser autoplay rules) and resumes on the first pointer/key gesture.

import type { MatchClient } from '../contracts/session.ts';
import type { SimEvent } from '../contracts/sim.ts';
import type { AudioPort } from '../ui/audio_port.ts';

type Bus = 'music' | 'sfx' | 'ui' | 'voice' | 'ambience';
interface CueDef { files: string[]; bus: Bus; gain: number; pitchVar: number; maxVoices: number; priority: number; spatial: boolean; loop: boolean; cooldown: number }
interface MusicDefT { file: string; bpm: number; loopStart: number; loopEnd?: number; gain: number; layers: { id: string; file: string }[] }
interface CatalogLike {
  audio: { cues: Record<string, CueDef>; music: Record<string, MusicDefT>; events?: Record<string, string>; m4a?: Record<string, string> };
  fighters: { id: string; attack?: { present?: { sfx?: string; hitSfx?: string } }; kit: Record<string, { id: string; present?: { sfx?: string; hitSfx?: string } } | undefined> }[];
  units?: { id: string; attack?: { present?: { sfx?: string; hitSfx?: string } } }[];
}
interface AudioSettings { master: number; music: number; sfx: number; voice: number; ui: number; ambience: number; muteInBackground: boolean }
interface EntityLike { id: number; kind: string; def?: string; team: number; x: number; y: number; visibleMask?: number }

export interface ValeAudioPort extends AudioPort {
  attach(client: MatchClient | null): void;
  settings(s: AudioSettings): void;
  readonly log: string[];
  /** the session's file format: null until the first .ogg decodes (or fails) */
  readonly format: 'ogg' | 'm4a' | null;
}

const BUSES: Bus[] = ['music', 'sfx', 'ui', 'voice', 'ambience'];
const XFADE_S = 1.2;
const HEAR_M = 26;           // beyond this a spatial cue is silent
const NEAR_M = 6;            // inside this it is full volume
const LOOP_DEFAULT_S = 2.5;  // a looping cue with no stated life stops after this
const PROBE_MS = 10000;      // the format-deciding .ogg: other loads wait this long for its request (then the
                             // next one probes: a stalled request), and its decode counts as failed if unsettled
                             // this long after the bytes arrived (a hung decoder); neither may mute the game.
                             // Generous: boot can stall the main thread for seconds

interface Voice { src: AudioBufferSourceNode; gain: GainNode; cue: string; priority: number; started: number }

class Engine implements ValeAudioPort {
  readonly log: string[] = [];
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private readonly bus = new Map<Bus, GainNode>();
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly voices: Voice[] = [];
  private readonly lastPlay = new Map<string, number>();
  private vol: AudioSettings;
  private readonly cues: Record<string, CueDef>;
  /** engine event role → cue id (content/audio.json `events`) */
  private readonly events: Record<string, string>;
  private readonly beds: Record<string, MusicDefT>;
  private readonly url: (ref: string) => string;
  /** .ogg ref → its .m4a sibling (catalog audio.m4a, written by the content build) */
  private readonly alt: Record<string, string>;
  private fmt: 'ogg' | 'm4a' | null;
  /** the first .ogg decode while the format is undecided; other loads wait for it */
  private probe: Promise<void> | null = null;
  private bed: { id: string; main: AudioBufferSourceNode | null; layer: AudioBufferSourceNode | null; gain: GainNode; layerGain: GainNode } | null = null;
  private wantBed: string | null = null;
  private duckGain!: GainNode;
  private hidden = false;
  // match
  private client: MatchClient | null = null;
  /** match time at the last update: the pre-game countdown (negative time) ticks the last 3 s, 0 starts */
  private lastT: number | null = null;
  private off: (() => void) | null = null;
  private readonly abilitySfx = new Map<string, { sfx?: string; hitSfx?: string }>();
  private intensity = 0;
  private combat = false;
  private calmFor = 0;
  private tick: number | null = null;

  constructor(cat: CatalogLike, url: (ref: string) => string, settings: AudioSettings) {
    this.cues = cat.audio.cues;
    this.events = cat.audio.events ?? {};
    this.beds = cat.audio.music;
    this.url = url;
    this.alt = cat.audio.m4a ?? {};
    this.fmt = initialFormat();
    this.vol = { ...settings };
    for (const f of cat.fighters) {
      for (const a of Object.values(f.kit)) if (a?.present) this.abilitySfx.set(a.id, a.present);
      if (f.attack?.present) this.abilitySfx.set(`attack:${f.id}`, f.attack.present);
    }
    for (const u of cat.units ?? []) if (u.attack?.present) this.abilitySfx.set(`attack:${u.id}`, u.attack.present);   // Needles, Wicks, monsters
    const resume = (): void => { this.ensure(); void this.ctx?.resume(); };
    addEventListener('pointerdown', resume, { capture: true });
    addEventListener('keydown', resume, { capture: true });
    document.addEventListener('visibilitychange', () => { this.hidden = document.hidden; this.applyVolumes(); });
  }

  // ── setup ──────────────────────────────────────────────────────────────────────────────────────
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return null;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.connect(limiter).connect(ctx.destination);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master);
    for (const b of BUSES) {
      const g = ctx.createGain();
      g.connect(b === 'music' ? this.duckGain : this.master);
      this.bus.set(b, g);
    }
    this.applyVolumes();
    // preload the UI set (they must answer the first click)
    for (const c of Object.values(this.cues)) if (c.bus === 'ui') for (const f of c.files) void this.buffer(f);
    if (this.wantBed) this.startBed(this.wantBed);
    if (this.tick === null) this.tick = window.setInterval(() => this.update(0.25), 250);
    return ctx;
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mute = this.hidden && this.vol.muteInBackground;
    this.master.gain.setTargetAtTime(mute ? 0 : this.vol.master, t, 0.05);
    for (const b of BUSES) this.bus.get(b)!.gain.setTargetAtTime(this.vol[b], t, 0.05);
  }

  get format(): 'ogg' | 'm4a' | null { return this.fmt; }

  private buffer(ref: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(ref);
    if (!p) {
      const ctx = this.ctx;
      p = ctx ? this.load(ctx, ref).catch(() => null) : Promise.resolve(null);   // never a rejected promise
      if (ctx) this.buffers.set(ref, p);
    }
    return p;
  }

  /** one file's bytes; null when it could not be fetched (HTTP error, or the network failing before or during
   *  the body). Never rejects */
  private async bytes(ref: string): Promise<ArrayBuffer | null> {
    try {
      const r = await fetch(this.url(ref));
      return r.ok ? await r.arrayBuffer() : null;
    } catch { return null; }
  }

  /** decodeAudioData; undefined when it fails (or is still unsettled after `limitMs`, when given). Never rejects */
  private async decodeBytes(ctx: AudioContext, bytes: ArrayBuffer, limitMs = 0): Promise<AudioBuffer | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const buf = ctx.decodeAudioData(bytes);
      return await (limitMs ? Promise.race([buf, new Promise<undefined>((r) => { timer = setTimeout(r, limitMs, undefined); })]) : buf);
    } catch { return undefined; } finally { clearTimeout(timer); }
  }

  private async decode(ctx: AudioContext, ref: string): Promise<AudioBuffer | null> {
    const b = await this.bytes(ref);
    return b ? (await this.decodeBytes(ctx, b)) ?? null : null;
  }

  /** a cue / bed file in the session's format (see `format` in the header) */
  private async load(ctx: AudioContext, ref: string): Promise<AudioBuffer | null> {
    const alt = this.alt[ref];
    if (!alt) return this.decode(ctx, ref);
    while (this.fmt === null && this.probe) await this.probe;       // undecided: one .ogg at a time decides
    if (this.fmt === 'm4a') return this.decode(ctx, alt);
    const probing = this.fmt === null;
    let free = (): void => {};
    let stalled: ReturnType<typeof setTimeout> | undefined;
    if (probing) {
      // this load decides and the others wait for it; a request that stalls without erroring stops holding
      // them after PROBE_MS (the next waiter probes) and keeps loading for its own cue
      let release = (): void => {};
      const mine = new Promise<void>((r) => { release = r; });
      free = () => { clearTimeout(stalled); if (this.probe === mine) this.probe = null; release(); };
      stalled = setTimeout(free, PROBE_MS);
      this.probe = mine;
    }
    try {
      const bytes = await this.bytes(ref);
      if (!bytes) return null;                       // not fetched (404, offline): the format stays open
      clearTimeout(stalled);                         // the bytes are here: hold the others for the decode
      const buf = await this.decodeBytes(ctx, bytes, probing ? PROBE_MS : 0);
      if (buf) { this.fmt ??= 'ogg'; return buf; }
      this.fmt = 'm4a';                              // this browser cannot decode the .ogg: switch the session
    } finally { free(); }
    return this.decode(ctx, alt);
  }

  // ── AudioPort ─────────────────────────────────────────────────────────────────────────────────
  play(cueId: string): void { this.cue(cueId, null); }

  settings(s: AudioSettings): void { this.vol = { ...s }; this.applyVolumes(); }

  duck(on: boolean): void {
    if (!this.ctx) return;
    this.duckGain.gain.setTargetAtTime(on ? Math.pow(10, -8 / 20) : 1, this.ctx.currentTime, 0.15);
  }

  music(id: string | null): void {
    if (id === this.wantBed) return;
    this.wantBed = id;
    if (!this.ctx) return;
    this.stopBed();
    if (id) this.startBed(id);
  }

  /** the cue bound to an engine event role, if the catalog binds one */
  private ev(role: string): string | undefined { return this.events[role]; }

  /** play a cue; `pos` (world x, y) makes a spatial cue pan/attenuate around your fighter. A looping cue
   *  stops after `hold` seconds (a zone's delay + life), else after LOOP_DEFAULT_S. */
  private cue(cueId: string | undefined, pos: { x: number; y: number } | null, gainMul = 1, hold = 0): void {
    if (!cueId) return;
    const c = this.cues[cueId];
    if (!c) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (c.cooldown > 0 && now - (this.lastPlay.get(cueId) ?? -1e9) < c.cooldown) return;
    let pan = 0, att = 1;
    if (pos && c.spatial) {
      const me = this.youPos();
      if (me) {
        const dx = pos.x - me.x, dy = pos.y - me.y, d = Math.hypot(dx, dy);
        if (d > HEAR_M) return;
        att = d <= NEAR_M ? 1 : Math.max(0, 1 - (d - NEAR_M) / (HEAR_M - NEAR_M)) ** 1.5;
        pan = Math.max(-0.85, Math.min(0.85, dx / 14));
      }
    }
    // voice limit: steal the oldest voice of the lowest priority
    const mine = this.voices.filter((v) => v.cue === cueId);
    if (mine.length >= c.maxVoices) {
      const v = mine.sort((a, b) => a.started - b.started)[0];
      this.stopVoice(v, 0.03);
    }
    this.lastPlay.set(cueId, now);
    const file = c.files[Math.floor(Math.random() * c.files.length)];
    void this.buffer(file).then((buf) => {
      if (!buf || !this.ctx) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = c.loop;
      if (c.pitchVar) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * c.pitchVar;   // a playback-rate fraction
      const g = this.ctx.createGain();
      g.gain.value = c.gain * att * gainMul;
      let node: AudioNode = src;
      if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
      node.connect(g).connect(this.bus.get(c.bus)!);
      const v: Voice = { src, gain: g, cue: cueId, priority: c.priority, started: this.ctx.currentTime };
      this.voices.push(v);
      src.onended = () => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
      src.start();
      if (c.loop) this.stopVoice(v, 0.25, Math.max(0.3, hold > 0 ? hold : LOOP_DEFAULT_S));
      if (this.log.length < 400) this.log.push(cueId);
    });
  }

  private stopVoice(v: Voice, fade: number, after = 0): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + after;
    v.gain.gain.setTargetAtTime(0, t, fade / 3);
    try { v.src.stop(t + fade + 0.02); } catch { /* already stopped */ }
  }

  // ── music beds ────────────────────────────────────────────────────────────────────────────────
  private startBed(id: string): void {
    const def = this.beds[id];
    const ctx = this.ctx;
    if (!def || !ctx) return;
    const gain = ctx.createGain();
    const layerGain = ctx.createGain();
    gain.gain.value = 0;
    layerGain.gain.value = 0;
    gain.connect(this.bus.get('music')!);
    layerGain.connect(gain);
    const bed = { id, main: null as AudioBufferSourceNode | null, layer: null as AudioBufferSourceNode | null, gain, layerGain };
    this.bed = bed;
    const layerRef = def.layers[0]?.file;
    void Promise.all([this.buffer(def.file), layerRef ? this.buffer(layerRef) : Promise.resolve(null)]).then(([main, layer]) => {
      if (this.bed !== bed || !main || !this.ctx) return;
      const t0 = this.ctx.currentTime + 0.05;
      const mk = (buf: AudioBuffer, out: AudioNode): AudioBufferSourceNode => {
        const s = this.ctx!.createBufferSource();
        s.buffer = buf; s.loop = true;
        s.loopStart = def.loopStart; s.loopEnd = def.loopEnd ?? buf.duration;
        s.connect(out); s.start(t0);
        return s;
      };
      bed.main = mk(main, gain);
      if (layer) bed.layer = mk(layer, layerGain);
      gain.gain.setTargetAtTime(def.gain, t0, XFADE_S / 3);
    });
  }

  private stopBed(): void {
    const b = this.bed;
    if (!b || !this.ctx) return;
    this.bed = null;
    const t = this.ctx.currentTime;
    b.gain.gain.setTargetAtTime(0, t, XFADE_S / 3);
    for (const s of [b.main, b.layer]) if (s) try { s.stop(t + XFADE_S * 1.5); } catch { /* not started */ }
  }

  // ── match ─────────────────────────────────────────────────────────────────────────────────────
  attach(client: MatchClient | null): void {
    if (client === this.client) return;
    this.off?.();
    this.off = null;
    this.client = client;
    this.intensity = 0; this.combat = false; this.calmFor = 0;
    this.lastT = client ? client.view.time : null;
    if (client) this.off = client.onEvents((evs: SimEvent[]) => { for (const e of evs) this.onEvent(e as unknown as Record<string, unknown>); });
  }

  private youPos(): { x: number; y: number } | null {
    const c = this.client;
    if (!c) return null;
    const p = c.view.players.find((x) => x.player === c.you);
    const e = p ? c.view.entity(p.entity) : undefined;
    return e ? { x: e.x, y: e.y } : null;
  }

  private ent(id: unknown): EntityLike | undefined {
    return typeof id === 'number' ? this.client?.view.entity(id) : undefined;
  }

  private myTeam(): number {
    const c = this.client;
    return c?.view.players.find((x) => x.player === c.you)?.team ?? -1;
  }

  /** fog: you hear only what your team can see (your own team always), like the renderer draws it */
  private seen(x: EntityLike | undefined): boolean {
    const team = this.myTeam();
    if (!x || team < 0 || x.team === team) return true;
    return (((x.visibleMask ?? 0) >>> team) & 1) === 1;
  }

  private seenAt(x: number, y: number): boolean {
    const team = this.myTeam();
    const v = this.client?.view as unknown as { visionGrid?: (t: number) => { cell: number; width: number; height: number; data: ArrayLike<number> } } | undefined;
    if (team < 0 || !v?.visionGrid) return true;
    try {
      const g = v.visionGrid(team);
      const i = Math.floor(x / g.cell), j = Math.floor(y / g.cell);
      return i >= 0 && j >= 0 && i < g.width && j < g.height && g.data[j * g.width + i] > 0;
    } catch { return true; }
  }

  private onEvent(e: Record<string, unknown>): void {
    const kind = e.e as string;
    const src = this.ent(e.src), dst = this.ent(e.dst);
    // events about a unit your team cannot see stay silent (a panned sound would give the unit away)
    const subject = kind === 'cast' || kind === 'projectile' || kind === 'attack' || kind === 'dash' || kind === 'blink' ? src
      : kind === 'hit' || kind === 'damage' || kind === 'heal' || kind === 'shield' || kind === 'status' || kind === 'death' ? dst : undefined;
    if (subject && !this.seen(subject)) return;
    if (kind === 'area' && !this.seen(src) && !this.seenAt(e.x as number, e.y as number)) return;
    const at = (x: EntityLike | undefined): { x: number; y: number } | null => (x ? { x: x.x, y: x.y } : null);
    const me = this.youPos();
    const near = (p: { x: number; y: number } | null): boolean => !!p && !!me && Math.hypot(p.x - me.x, p.y - me.y) < 14;
    switch (kind) {
      case 'cast': {
        const pr = this.abilitySfx.get(e.ability as string);
        this.cue(pr?.sfx ?? this.ev(e.slot === 'ult' ? 'castUlt' : src?.kind === 'monster' ? 'castMonster' : 'cast'), at(src));
        if (src && src.team !== this.myTeam() && e.slot === 'ult' && near(at(src))) this.cue(this.ev('enemyUltWindup'), null);
        break;
      }
      case 'projectile': this.cue(this.ev('projectile'), at(src), 0.7); break;
      case 'hit': {
        const pr = this.abilitySfx.get(e.ability as string);
        this.cue((e.sfx as string) ?? pr?.hitSfx ?? this.ev('hitAbility'), at(dst));
        break;
      }
      case 'area': if (e.sfx) this.cue(e.sfx as string, { x: e.x as number, y: e.y as number }, 1, ((e.delay as number) || 0) + ((e.life as number) || 0)); break;
      case 'attack': this.cue(this.abilitySfx.get(`attack:${src?.def}`)?.sfx ?? this.ev('attack'), at(src), src?.kind === 'fighter' ? 0.6 : src?.kind === 'structure' ? 0.8 : 0.3); break;
      case 'damage': {
        const p = at(dst);
        if (near(p)) this.intensity = Math.min(1, this.intensity + (src?.kind === 'fighter' && dst?.kind === 'fighter' ? 0.12 : 0.02));
        if (e.ability) break;                         // ability hits voice through `hit`
        if (e.crit) this.cue(this.ev('crit'), p);
        else this.cue(this.abilitySfx.get(`attack:${src?.def}`)?.hitSfx ?? this.ev(e.dtype === 'magic' ? 'hitMagic' : e.dtype === 'true' ? 'hitTrue' : 'hitPhysical'), p, src?.kind === 'fighter' ? 0.8 : 0.45);
        break;
      }
      case 'heal': this.cue(this.ev('heal'), at(dst), 0.7); break;
      case 'shield': this.cue(this.ev('shield'), at(dst)); break;
      case 'status': {
        const s = e.status as string;
        this.cue(this.ev(`status.${s}`) ?? this.ev('status'), at(dst), 0.8);
        break;
      }
      case 'dash': this.cue(this.ev('dash'), at(src)); break;
      case 'blink': this.cue(this.ev('blink'), at(src)); break;
      case 'death': {
        const k = e.kind as string;
        if (k === 'fighter') {
          this.cue(this.ev('fighterDeath'), at(dst));
          const youEnt = this.client?.view.players.find((x) => x.player === this.client?.you)?.entity;
          if (e.dst === youEnt) this.cue(this.ev('selfDown'), null);
          else if (dst && dst.team === this.myTeam()) this.cue(this.ev('allyDown'), null);
        } else if (k === 'minion') this.cue(this.ev('minionDeath'), at(dst), 0.6);
        else if (k === 'monster') this.cue(this.ev('monsterDeath'), at(dst));
        break;
      }
      case 'takedown': if (e.killer === this.client?.you) this.cue(this.ev('takedown'), null); break;
      case 'respawn': if (e.player === this.client?.you) this.cue(this.ev('respawn'), null); break;
      case 'levelUp': if (e.player === this.client?.you) this.cue(this.ev('levelUp'), null); break;
      case 'gold': if (e.player === this.client?.you && (e.reason === 'cs' || e.reason === 'kill')) this.cue(this.ev('gold'), null, 0.6); break;
      case 'structure': {
        const p = this.ent(e.id);
        this.cue(this.ev('structureFall'), at(p));
        this.cue(this.ev(e.team === this.myTeam() ? 'structureAllyFall' : 'structureEnemyFall'), null);
        break;
      }
      case 'objective': this.cue(this.ev(e.team === this.myTeam() ? 'objectiveAlly' : 'objectiveEnemy'), null); break;
      case 'wave': if ((e.n as number) <= 1) this.cue(this.ev('waveSpawn'), null); break;
      case 'recall': if (e.player === this.client?.you) this.cue(this.ev(e.state === 'done' ? 'recallDone' : e.state === 'start' ? 'recallStart' : 'recallCancel'), null); break;
      case 'ping': this.cue(this.ev(`ping.${e.kind as string}`), null); break;
      case 'pickup': if (e.player === this.client?.you) this.cue(this.ev('pickup'), null); break;
      case 'announce':
        // a personal notice (a denied purchase, a practice reset) is only yours to hear
        if (/^(shop_denied|practice_reset)$/.test(e.key as string) && e.player !== undefined && e.player !== this.client?.you) break;
        this.cue(this.ev(/first|ace|objective|structure|inhib|core/i.test(e.key as string) ? 'announceMajor' : 'announceMinor'), null); break;
      case 'eliminated': if (e.player === this.client?.you) this.cue(this.ev('eliminated'), null); break;
      case 'suddenDeath': this.cue(this.ev('suddenDeath'), null); break;
      default: break;
    }
  }

  /** combat intensity → the bed's combat layer (bar-quantised enter/leave, tokens.audio.beds.match) */
  private update(dt: number): void {
    const view = this.client?.view;
    if (view && this.lastT !== null) {
      const t0 = this.lastT, t1 = view.time;
      for (const s of [-3, -2, -1]) if (t0 < s && t1 >= s) this.cue(this.ev('countdown'), null);
      if (t0 < 0 && t1 >= 0) this.cue(this.ev('matchStart'), null);
    }
    this.lastT = view ? view.time : null;
    this.intensity = Math.max(0, this.intensity - dt * 0.12);
    const b = this.bed;
    if (!b || !this.ctx || !b.layer) return;
    if (!this.combat && this.intensity > 0.6) { this.combat = true; this.calmFor = 0; }
    else if (this.combat) {
      this.calmFor = this.intensity < 0.35 ? this.calmFor + dt : 0;
      if (this.calmFor > 8) this.combat = false;
    }
    const def = this.beds[b.id];
    const bar = def ? (60 / def.bpm) * 4 : 2;
    const t = this.ctx.currentTime;
    const at = Math.ceil(t / bar) * bar;
    b.layerGain.gain.cancelScheduledValues(t);
    b.layerGain.gain.setTargetAtTime(this.combat ? 1 : 0, at, 0.6);
  }
}

/** the dev switch ?audio=m4a forces the fallback (to test it in any browser; dev builds only, like ?dev=1); a
 *  browser whose media stack says it cannot play Ogg Opus starts on .m4a; otherwise the first .ogg decode decides */
function initialFormat(): 'ogg' | 'm4a' | null {
  let devBuild = false;
  try { devBuild = !!import.meta.env?.DEV; } catch { devBuild = false; }
  try {
    if (devBuild && new URLSearchParams(location.search).get('audio') === 'm4a') return 'm4a';
    if (document.createElement('audio').canPlayType('audio/ogg; codecs=opus') === '') return 'm4a';
  } catch { /* no DOM: decide on the first decode */ }
  return null;
}

export function createAudioEngine(o: { catalog: unknown; assetUrl: (ref: string) => string; settings: unknown }): ValeAudioPort {
  const s = (o.settings as { audio?: AudioSettings }).audio ?? { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true };
  return new Engine(o.catalog as CatalogLike, o.assetUrl, s);
}
