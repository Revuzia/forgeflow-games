// VALE audio — the WebAudio engine (CONTRACT §11; tokens.json `audio`). Implements the UI's AudioPort.
//
//   buses       music · sfx · ui · voice · ambience → master → limiter → out (Settings.audio volumes;
//               `muteInBackground` silences a hidden tab)
//   alert path  the GATE cues — whatever content binds to the UI roles queue_pop / queue_remind and the event
//               roles countdown / matchStart — skip the master and join at the limiter through their own
//               per-bus alert gain: max(ALERT_FLOOR, master × bus). So a match found while the tab is hidden
//               is still heard (a missed ready check costs a re-queue lockout), the UI slider cannot take it
//               below the floor (tokens.audio.motif.queuePop.ownSliderWithFloor), and every other cue stays
//               muted in the background. A master at exactly 0 is the player's explicit full mute and is kept
//   cues        AudioCue: random variant file, ±pitchVar semitones, gain, maxVoices, cooldown (s), loop; files
//               decode lazily on first use, UI cues preload; an unknown or missing cue is silently ignored (art
//               may still be rendering)
//   priority    a voice's priority is its cue's, LIFTED +1 when an enemy aims it at you (or it lands on you) and
//               DROPPED −1 when an ally made it (threat > self > ally, content/audio.json). A cue at its maxVoices,
//               or the sfx pool at MAX_SFX_VOICES, frees the lowest-priority, oldest voice, never one that
//               outranks the newcomer (then the newcomer is the one dropped)
//   threat      every control status has its own cue (content binds 'status.<kind>'; no catch-all, so an unbound
//               kind is silent), played on fighters only, +3 dB (YOU_CC_GAIN) when an enemy controls YOU; every enemy
//               fighter's ultimate wind-up adds the shared shade-breath swell (enemyUltWindup) at the caster
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
//   listener    spatial cues are heard from the CAMERA's ground focus (CONTRACT §11 'listener at the camera
//               target'; listener(): the renderer's focus, wired in boot/main.ts; without one, your fighter):
//               full volume within LISTEN_INNER_M (the whole screen at default zoom), rolled off to silence
//               at LISTEN_HEAR_M by 2D distance, panned at most ±PAN_MAX (screen x is world x: the camera
//               never yaws), and gently low-passed beyond LPF_FROM_M. So a fight you watch while dead or
//               scouting sounds where you look. The AWARENESS pass keeps a threat to your LIVING fighter
//               audible wherever the camera is: an enemy's cast / attack / wind-up within AWARE_M of you, and
//               what lands on you, never drop below AWARE_GAIN and are not low-passed
//   match       attach(client): SimEvents become cues, placed by the listener above; ability cues come from the
//               catalog (`present.sfx` / `hitSfx` / event `sfx`), the rest from the generic set
//               (c_* combat, m_* match events), so content can re-voice any ability without code.
//               Team-private comms stay private: a ping sounds only when a player of YOUR team made it, and a
//               surrender vote / its outcome only for the team voting (the HUD shows neither for the other
//               team; online play is lockstep, so every client receives every seat's commands).
//   procs       every 'proc' (a passive fired) sounds at its subject (dst, else the owner): a fighter's passive
//               plays the per-fighter cue f_<fighter>_passive when content has one, else the passive's own
//               present.sfx / hitSfx; an item / boon / team-buff / unit passive plays its present.sfx / hitSfx,
//               else the role 'proc.<item|boon|team|unit>'. The proc IS the payoff's sound: passive damage dealt
//               without a delivery (no 'hit') is voiced by the proc that follows it in the same tick. A periodic
//               trigger (interval, moveDistance) reminds at most every PROC_PERIODIC_S per owner, the rest at most
//               every PROC_GAP_S per passive and owner. `procStats` counts what became of every proc (dev / probes)
//   ambience    the map's world: content binds 'ambient.<map id>.<source>' → a looping cue on the ambience bus.
//               <source> names an art.ambient group of that map (an effect's vfx, a critter id, a prop's fx vfx
//               or its model's file name): the loop sounds from EVERY point of the group, heard from the
//               listener (full within AMB_INNER_M of a point, silent past AMB_HEAR_M; nearby points add up by
//               energy, capped at full; panned toward them), so the sound sits where the look sits and follows
//               any move of the art. <source> 'bed' is the map-wide bed (not spatial). One voice per emitter,
//               started at a random point of its loop when the match attaches, faded out when it detaches;
//               the whole bus is ducked up to AMB_DUCK_DB as the combat intensity rises
// The context starts suspended (browser autoplay rules) and resumes on the first pointer/key gesture.

import type { MatchClient } from '../contracts/session.ts';
import type { SimEvent } from '../contracts/sim.ts';
import type { AudioPort } from '../ui/audio_port.ts';

type Bus = 'music' | 'sfx' | 'ui' | 'voice' | 'ambience';
interface CueDef { files: string[]; bus: Bus; gain: number; pitchVar: number; maxVoices: number; priority: number; spatial: boolean; loop: boolean; cooldown: number }
interface MusicDefT { file: string; bpm: number; loopStart: number; loopEnd?: number; gain: number; layers: { id: string; file: string }[] }
interface PresentLike { sfx?: string; hitSfx?: string }
interface PassiveLike { id: string; present?: PresentLike }
/** a map's art.ambient (render/ambient.ts draws it; the audio reads its points): [x, y, …] per placement */
interface AmbientLike {
  effects?: { vfx: string; at: number[][] }[];
  critters?: { id: string; spots: number[][] }[];
  props?: { model: string; at: number[][]; fx?: { vfx: string } }[];
}
interface CatalogLike {
  audio: { cues: Record<string, CueDef>; music: Record<string, MusicDefT>; events?: Record<string, string>; ui?: Record<string, string>; m4a?: Record<string, string> };
  fighters: { id: string; attack?: { present?: PresentLike }; kit: Record<string, { id: string; present?: PresentLike } | undefined> }[];
  units?: { id: string; attack?: { present?: PresentLike }; passive?: PassiveLike }[];
  items?: { id: string; passives?: PassiveLike[] }[];
  setup?: { boons?: PassiveLike[] };
  teamBuffs?: { id: string; passives?: PassiveLike[] }[];
  maps?: { id: string; art?: { ambient?: AmbientLike } }[];
}
type PassiveKind = 'fighter' | 'item' | 'boon' | 'team' | 'unit';
/** what became of a proc: played, held back by its owner's window or the cue's own cooldown / voices, out of
 *  earshot, fogged, or `unbound` (no cue anywhere: the one outcome the probes fail on) */
type ProcOutcome = 'played' | 'throttled' | 'cooldown' | 'culled' | 'unseen' | 'unbound' | 'off';
/** one ambience emitter (see `ambience` in the header) */
interface Emitter {
  role: string; cue: string; def: CueDef; pts: { x: number; y: number }[];
  src: AudioBufferSourceNode | null; gain: GainNode; pan: StereoPannerNode; lpf: BiquadFilterNode;
  att: number; panV: number; lpfV: number; started: boolean;
}
interface AudioSettings { master: number; music: number; sfx: number; voice: number; ui: number; ambience: number; muteInBackground: boolean }
interface EntityLike { id: number; kind: string; def?: string; team: number; x: number; y: number; visibleMask?: number; alive?: boolean;
  statuses?: readonly { kind: string; src?: number }[] }
/** a spatial cue's placement around the listener */
interface Place { att: number; pan: number; lpf: number }
/** per-play options: `aware` = a threat to your fighter (the awareness pass applies) */
interface CueOpts { aware?: boolean; lift?: number }

export interface ValeAudioPort extends AudioPort {
  attach(client: MatchClient | null): void;
  /** where spatial cues are heard from: the camera's ground focus in sim units (x, y), or null to hear from your
   *  fighter (no renderer). boot/main.ts passes the renderer's listenerFocus() */
  listener(focus: (() => { x: number; y: number } | null) | null): void;
  settings(s: AudioSettings): void;
  readonly log: string[];
  /** the session's file format: null until the first .ogg decodes (or fails) */
  readonly format: 'ogg' | 'm4a' | null;
}

const BUSES: Bus[] = ['music', 'sfx', 'ui', 'voice', 'ambience'];
const XFADE_S = 1.2;
const LISTEN_INNER_M = 12;   // full volume within this of the camera focus (the screen's half-width at default zoom: 11.7 m)
const LISTEN_HEAR_M = 30;    // silent beyond this (2D distance from the focus), unless the awareness pass keeps it
const PAN_MAX = 0.6;         // moderate panning (r07 §4.4): a cue at the screen edge pans about ±0.58
const PAN_M = 20;            // metres from the focus to PAN_MAX
const LPF_FROM_M = 15;       // beyond this a gentle low-pass: LPF_HI_HZ at LPF_FROM_M falling to LPF_LO_HZ at LISTEN_HEAR_M
const LPF_HI_HZ = 16000;
const LPF_LO_HZ = 3500;
const AWARE_M = 10;          // the awareness pass: threats within this of your living fighter …
const AWARE_GAIN = 0.8;      // … play at least this loud (−2 dB), unfiltered
const NEAR_COMBAT_M = 14;    // fighter damage within this of the listener (or of your living fighter) feeds the combat layer
const MAX_SFX_VOICES = 32;   // the combat pool: past it the lowest-priority, oldest voice yields (see `priority`)
const YOU_CC_GAIN = Math.pow(10, 3 / 20);   // +3 dB: a control status landing on YOU
const LOOP_DEFAULT_S = 2.5;  // a looping cue with no stated life stops after this
const PROC_GAP_S = 0.3;      // one passive of one owner sounds at most this often (an on-hit passive on every attack)
const PROC_PERIODIC_S = 6;   // … and a periodic one (an aura's tick, a run-up stack) only reminds this often
const PERIODIC_ON = new Set(['interval', 'moveDistance']);
const AMB_INNER_M = 10;      // an ambience emitter's point is at full level within this of the listener …
const AMB_HEAR_M = 32;       // … and silent past this
const AMB_DUCK_DB = 6;       // the ambience bus under a fight: full duck at combat intensity AMB_DUCK_FULL
const AMB_DUCK_FROM = 0.2;   // (a minion skirmish, below this, does not duck it)
const AMB_DUCK_FULL = 0.6;
const AMB_FADE_S = 1.5;      // emitters fade in on attach, out on detach
const PROBE_MS = 10000;      // the format-deciding .ogg: other loads wait this long for its request (then the
                             // next one probes: a stalled request), and its decode counts as failed if unsettled
                             // this long after the bytes arrived (a hung decoder); neither may mute the game.
                             // Generous: boot can stall the main thread for seconds
/** the gate roles (see `alert path` in the header): UI roles (audio.ui) and engine event roles (audio.events) */
const ALERT_UI_ROLES = ['queue_pop', 'queue_remind'];
const ALERT_EVENT_ROLES = ['countdown', 'matchStart'];
/** the alert path's lowest gain (linear, −8 dB): the queue pop (−14 LUFS momentary, about −3 dBFS sample peak as
 *  shipped) then still peaks above −12 dBFS at the output whatever the UI slider says */
const ALERT_FLOOR = 0.4;

interface Voice { src: AudioBufferSourceNode; gain: GainNode; cue: string; bus: Bus; priority: number; started: number }

class Engine implements ValeAudioPort {
  readonly log: string[] = [];
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private readonly bus = new Map<Bus, GainNode>();
  /** the alert path, one gain per bus, straight into the limiter (see `alert path` in the header) */
  private readonly alertBus = new Map<Bus, GainNode>();
  /** the cue ids content binds to the gate roles */
  private readonly alertCues: Set<string>;
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
  /** the camera focus provider (listener()); null: hear from your fighter */
  private focus: (() => { x: number; y: number } | null) | null = null;
  /** passive id → what owns it and the cue its proc plays (undefined: the 'proc.<kind>' role decides) */
  private readonly passives = new Map<string, { kind: PassiveKind; cue?: string }>();
  /** `${passive}:${owner}` → ctx time of its last sounding proc */
  private readonly procLast = new Map<string, number>();
  /** dev / probes: every proc's outcome, counted */
  readonly procStats: Record<ProcOutcome, number> = { played: 0, throttled: 0, cooldown: 0, culled: 0, unseen: 0, unbound: 0, off: 0 };
  private readonly maps = new Map<string, AmbientLike | undefined>();
  /** the attached match's ambience emitters (built on attach, voiced once the context runs) */
  private amb: Emitter[] = [];
  /** the attached match's map while its emitters wait for the context */
  private ambMap: string | null = null;
  private ambDuck: GainNode | null = null;

  constructor(cat: CatalogLike, url: (ref: string) => string, settings: AudioSettings) {
    this.cues = cat.audio.cues;
    this.events = cat.audio.events ?? {};
    this.beds = cat.audio.music;
    this.url = url;
    this.alt = cat.audio.m4a ?? {};
    this.alertCues = new Set([
      ...ALERT_UI_ROLES.map((r) => cat.audio.ui?.[r]), ...ALERT_EVENT_ROLES.map((r) => this.events[r]),
    ].filter((id): id is string => !!id));
    this.fmt = initialFormat();
    this.vol = { ...settings };
    for (const f of cat.fighters) {
      for (const a of Object.values(f.kit)) if (a?.present) this.abilitySfx.set(a.id, a.present);
      if (f.attack?.present) this.abilitySfx.set(`attack:${f.id}`, f.attack.present);
    }
    for (const u of cat.units ?? []) if (u.attack?.present) this.abilitySfx.set(`attack:${u.id}`, u.attack.present);   // Needles, Wicks, monsters
    // passives (see `procs` in the header): the per-fighter cue first, then the passive's own present
    const own = (p: PassiveLike | undefined, kind: PassiveKind, fighter?: string): void => {
      if (!p) return;
      const per = fighter ? `f_${fighter}_passive` : undefined;
      this.passives.set(p.id, { kind, cue: (per && this.cues[per] ? per : undefined) ?? p.present?.sfx ?? p.present?.hitSfx });
    };
    for (const f of cat.fighters) own(f.kit.passive, 'fighter', f.id);
    for (const it of cat.items ?? []) for (const p of it.passives ?? []) own(p, 'item');
    for (const b of cat.setup?.boons ?? []) own(b, 'boon');
    for (const tb of cat.teamBuffs ?? []) for (const p of tb.passives ?? []) own(p, 'team');
    for (const u of cat.units ?? []) own(u.passive, 'unit');
    for (const m of cat.maps ?? []) this.maps.set(m.id, m.art?.ambient);
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
    this.limiter = limiter;
    this.master = ctx.createGain();
    this.master.connect(limiter).connect(ctx.destination);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master);
    for (const b of BUSES) {
      const g = ctx.createGain();
      g.connect(b === 'music' ? this.duckGain : this.master);
      this.bus.set(b, g);
    }
    // the alert path joins after the master (the background mute), before the limiter
    for (const b of BUSES) {
      const g = ctx.createGain();
      g.connect(limiter);
      this.alertBus.set(b, g);
    }
    // the ambience emitters' combat duck, into the ambience bus
    this.ambDuck = ctx.createGain();
    this.ambDuck.connect(this.bus.get('ambience')!);
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
    for (const b of BUSES) {
      this.bus.get(b)!.gain.setTargetAtTime(this.vol[b], t, 0.05);
      // never muted in the background; floored; a master at 0 (the player's full mute) is honoured
      const alert = this.vol.master <= 0 ? 0 : Math.max(ALERT_FLOOR, this.vol.master * this.vol[b]);
      this.alertBus.get(b)!.gain.setTargetAtTime(alert, t, 0.05);
    }
  }

  /** dev / harness: the output graph (the probes meter the limiter's output) */
  get graph(): { ctx: AudioContext; limiter: DynamicsCompressorNode; master: GainNode } | null {
    return this.ctx ? { ctx: this.ctx, limiter: this.limiter, master: this.master } : null;
  }

  /** dev / harness: the cue ids on the alert path */
  get alerts(): string[] { return [...this.alertCues]; }

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

  /** play a cue; `pos` (world x, y) makes a spatial cue pan/attenuate around the listener (see `listener` in the
   *  header). A looping cue stops after `hold` seconds (a zone's delay + life), else after LOOP_DEFAULT_S.
   *  Returns what became of it ('none': no such cue; 'off': no running context) */
  private cue(cueId: string | undefined, pos: { x: number; y: number } | null, gainMul = 1, hold = 0, o: CueOpts = {}):
    'played' | 'cooldown' | 'culled' | 'none' | 'off' {
    if (!cueId) return 'none';
    const c = this.cues[cueId];
    if (!c) return 'none';
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return 'off';
    const now = ctx.currentTime;
    if (c.cooldown > 0 && now - (this.lastPlay.get(cueId) ?? -1e9) < c.cooldown) return 'cooldown';
    let pan = 0, att = 1, lpf = 0;
    if (pos && c.spatial) {
      const pl = this.place(pos, !!o.aware);
      if (pl.att <= 0) return 'culled';
      ({ att, pan, lpf } = pl);
    }
    // voice limits (see `priority` in the header): the cue's own maxVoices, then the sfx pool
    const prio = c.priority + (o.lift ?? 0);
    if (!this.makeRoom(this.voices.filter((v) => v.cue === cueId), c.maxVoices, prio)) return 'cooldown';
    if (c.bus === 'sfx' && !this.makeRoom(this.voices.filter((v) => v.bus === 'sfx'), MAX_SFX_VOICES, prio)) return 'cooldown';
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
      if (lpf > 0) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = lpf; f.Q.value = 0.7071;
        node.connect(f); node = f;
      }
      if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
      node.connect(g).connect((this.alertCues.has(cueId) ? this.alertBus : this.bus).get(c.bus)!);
      const v: Voice = { src, gain: g, cue: cueId, bus: c.bus, priority: prio, started: this.ctx.currentTime };
      this.voices.push(v);
      src.onended = () => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
      src.start();
      if (c.loop) this.stopVoice(v, 0.25, Math.max(0.3, hold > 0 ? hold : LOOP_DEFAULT_S));
      if (this.log.length < 400) this.log.push(cueId);
    });
    return 'played';
  }

  /** a full set of voices frees its lowest-priority, oldest one for a newcomer of priority `prio`; false (the
   *  newcomer is dropped) when every voice outranks it */
  private makeRoom(set: Voice[], max: number, prio: number): boolean {
    if (set.length < max) return true;
    let w: Voice | null = null;
    for (const v of set) if (!w || v.priority < w.priority || (v.priority === w.priority && v.started < w.started)) w = v;
    if (!w || w.priority > prio) return false;
    this.stopVoice(w, 0.03);
    const i = this.voices.indexOf(w);
    if (i >= 0) this.voices.splice(i, 1);           // it fades out on its own; it no longer holds a slot
    return true;
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
    this.procLast.clear();
    this.stopAmbience();
    this.ambMap = client?.setup?.map ?? null;
    if (client) {
      this.off = client.onEvents((evs: SimEvent[]) => { for (const e of evs) this.onEvent(e as unknown as Record<string, unknown>); });
      this.syncAmbience();
    }
  }

  listener(focus: (() => { x: number; y: number } | null) | null): void { this.focus = focus; }

  // ── ambience (see `ambience` in the header) ──────────────────────────────────────────────────────
  /** the emitters content binds for a map: 'ambient.<map>.<source>' → a looping ambience cue */
  private emitters(ctx: AudioContext, map: string): Emitter[] {
    const art = this.maps.get(map);
    const out: Emitter[] = [];
    const pre = `ambient.${map}.`;
    for (const [role, cue] of Object.entries(this.events)) {
      if (!role.startsWith(pre)) continue;
      const def = this.cues[cue];
      if (!def || !def.loop || def.bus !== 'ambience') continue;
      const source = role.slice(pre.length);
      const pts = source === 'bed' ? [] : ambientPoints(art, source);
      if (source !== 'bed' && !pts.length) continue;               // a group the map does not have: nothing to place
      const gain = ctx.createGain(); gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 20000; lpf.Q.value = 0.7071;
      lpf.connect(pan).connect(gain).connect(this.ambDuck!);
      out.push({ role, cue, def, pts, src: null, gain, pan, lpf, att: 0, panV: 0, lpfV: 0, started: false });
    }
    return out;
  }

  /** start loops not yet started, place every emitter around the listener, duck the bus under a fight. The
   *  emitters are built once the context exists (a match attached before the first gesture waits for it) */
  private syncAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || !this.client) return;
    if (this.ambMap) { this.amb = this.emitters(ctx, this.ambMap); this.ambMap = null; }
    const t = ctx.currentTime;
    for (const em of this.amb) {
      if (!em.started) {
        em.started = true;
        void this.buffer(em.def.files[Math.floor(Math.random() * em.def.files.length)]).then((buf) => {
          if (!buf || !this.ctx || !this.amb.includes(em)) return;
          const src = this.ctx.createBufferSource();
          src.buffer = buf; src.loop = true;
          if (em.def.pitchVar) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * em.def.pitchVar;
          src.connect(em.lpf);
          src.start(this.ctx.currentTime, Math.random() * buf.duration);   // a random point: emitters sharing a file never phase
          em.src = src;
          if (this.log.length < 400) this.log.push(em.cue);
        });
      }
      const pl = em.pts.length ? this.ambPlace(em.pts) : { att: 1, pan: 0, lpf: 0 };
      em.att = pl.att; em.panV = pl.pan; em.lpfV = pl.lpf;
      em.gain.gain.setTargetAtTime(em.def.gain * pl.att, t, em.src ? 0.35 : AMB_FADE_S / 3);
      em.pan.pan.setTargetAtTime(pl.pan, t, 0.35);
      em.lpf.frequency.setTargetAtTime(pl.lpf || 20000, t, 0.35);
    }
    if (this.ambDuck) {
      const k = Math.max(0, Math.min(1, (this.intensity - AMB_DUCK_FROM) / (AMB_DUCK_FULL - AMB_DUCK_FROM)));
      this.ambDuck.gain.setTargetAtTime(Math.pow(10, -AMB_DUCK_DB * k / 20), t, k > 0 ? 0.4 : 1.5);
    }
  }

  /** an emitter's gain / pan / low-pass from all its points (energy sum, capped at full) */
  private ambPlace(pts: { x: number; y: number }[]): Place {
    const ear = this.ear();
    if (!ear) return { att: 0, pan: 0, lpf: 0 };
    let e2 = 0, panE = 0, near = Infinity;
    for (const p of pts) {
      const dx = p.x - ear.x, d = Math.hypot(dx, p.y - ear.y);
      if (d < near) near = d;
      if (d >= AMB_HEAR_M) continue;
      const a = d <= AMB_INNER_M ? 1 : ((AMB_HEAR_M - d) / (AMB_HEAR_M - AMB_INNER_M)) ** 1.5;
      e2 += a * a;
      panE += a * a * Math.max(-PAN_MAX, Math.min(PAN_MAX, dx / PAN_M));
    }
    const lpf = near <= LPF_FROM_M ? 0 : LPF_HI_HZ * (LPF_LO_HZ / LPF_HI_HZ) ** Math.min(1, (near - LPF_FROM_M) / (AMB_HEAR_M - LPF_FROM_M));
    return { att: Math.min(1, Math.sqrt(e2)), pan: e2 > 0 ? panE / e2 : 0, lpf };
  }

  private stopAmbience(): void {
    const ctx = this.ctx;
    this.ambMap = null;
    for (const em of this.amb) {
      if (!ctx) continue;
      em.gain.gain.cancelScheduledValues(ctx.currentTime);
      em.gain.gain.setTargetAtTime(0, ctx.currentTime, AMB_FADE_S / 3);
      if (em.src) try { em.src.stop(ctx.currentTime + AMB_FADE_S * 1.5); } catch { /* not started */ }
    }
    this.amb = [];
  }

  /** dev / probes: the ambience emitters and where they are heard from now */
  get ambience(): { role: string; cue: string; points: number; playing: boolean; att: number; pan: number; lpf: number }[] {
    return this.amb.map((e) => ({ role: e.role, cue: e.cue, points: e.pts.length, playing: !!e.src, att: e.att, pan: e.panV, lpf: e.lpfV }));
  }

  /** your fighter's entity (alive or not) */
  private you(): EntityLike | undefined {
    const c = this.client;
    if (!c) return undefined;
    const p = c.view.players.find((x) => x.player === c.you);
    return p ? c.view.entity(p.entity) : undefined;
  }

  /** where cues are heard from: the camera focus, else your fighter (no renderer); null outside a match */
  private ear(): { x: number; y: number } | null {
    if (!this.client) return null;
    let f: { x: number; y: number } | null = null;
    try { f = this.focus?.() ?? null; } catch { f = null; }
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) return f;
    const e = this.you();
    return e ? { x: e.x, y: e.y } : null;
  }

  /** your fighter's position while it is alive (the awareness pass); null when dead or not in a match */
  private aliveAt(): { x: number; y: number } | null {
    const e = this.you();
    return e && e.alive !== false ? { x: e.x, y: e.y } : null;
  }

  /** a spatial cue's gain / pan / low-pass around the listener (see `listener` in the header) */
  private place(pos: { x: number; y: number }, aware: boolean): Place {
    const ear = this.ear();
    if (!ear) return { att: 1, pan: 0, lpf: 0 };
    const dx = pos.x - ear.x, d = Math.hypot(dx, pos.y - ear.y);
    let att = d <= LISTEN_INNER_M ? 1 : d >= LISTEN_HEAR_M ? 0 : ((LISTEN_HEAR_M - d) / (LISTEN_HEAR_M - LISTEN_INNER_M)) ** 1.5;
    let lpf = d <= LPF_FROM_M ? 0 : LPF_HI_HZ * (LPF_LO_HZ / LPF_HI_HZ) ** Math.min(1, (d - LPF_FROM_M) / (LISTEN_HEAR_M - LPF_FROM_M));
    const pan = Math.max(-PAN_MAX, Math.min(PAN_MAX, dx / PAN_M));
    if (aware && att < AWARE_GAIN) {
      const me = this.aliveAt();
      if (me && Math.hypot(pos.x - me.x, pos.y - me.y) <= AWARE_M) { att = AWARE_GAIN; lpf = 0; }
    }
    return { att, pan, lpf };
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
      : kind === 'hit' || kind === 'damage' || kind === 'heal' || kind === 'shield' || kind === 'status' || kind === 'death' ? dst
      : kind === 'proc' ? dst ?? src : undefined;
    if (kind === 'proc' && subject && !this.seen(subject)) { this.procStats.unseen++; return; }
    if (subject && !this.seen(subject)) return;
    if (kind === 'area' && !this.seen(src) && !this.seenAt(e.x as number, e.y as number)) return;
    const at = (x: EntityLike | undefined): { x: number; y: number } | null => (x ? { x: x.x, y: x.y } : null);
    const ear = this.ear(), me = this.aliveAt();
    const near = (p: { x: number; y: number } | null): boolean => !!p && (
      (!!ear && Math.hypot(p.x - ear.x, p.y - ear.y) < NEAR_COMBAT_M) || (!!me && Math.hypot(p.x - me.x, p.y - me.y) < AWARE_M));
    // a threat to your fighter (the awareness pass): a non-allied fighter / tower / monster acting, or anything
    // landing on you; Wick swings are not threats worth lifting over the camera's mix
    const youId = this.you()?.id;
    const mine = this.myTeam();
    const onYou = youId !== undefined && (e.dst === youId || e.target === youId);
    // priority: an enemy (or a monster) aiming at you, or anything landing on you, +1; an ally's own action −1
    const lift = src ? (src.team !== mine ? (onYou ? 1 : 0) : src.id !== youId && !onYou ? -1 : 0) : onYou ? 1 : 0;
    const aw: CueOpts = { aware: (!!src && src.team !== mine && src.kind !== 'minion') || onYou, lift };
    switch (kind) {
      case 'cast': {
        const pr = this.abilitySfx.get(e.ability as string);
        this.cue(pr?.sfx ?? this.ev(e.slot === 'ult' ? 'castUlt' : src?.kind === 'monster' ? 'castMonster' : 'cast'), at(src), 1, 0, aw);
        // the shared shade-breath swell for every enemy fighter's ultimate wind-up (its T4 wind-up VFX; STYLE_BIBLE
        // 'enemy T3+ wind-ups share one shade-breath swell'), placed at the caster like any spatial cue
        if (src?.kind === 'fighter' && src.team !== mine && e.slot === 'ult') this.cue(this.ev('enemyUltWindup'), at(src), 1, 0, aw);
        break;
      }
      case 'projectile': this.cue(this.ev('projectile'), at(src), 0.7, 0, aw); break;
      case 'hit': {
        const pr = this.abilitySfx.get(e.ability as string);
        this.cue((e.sfx as string) ?? pr?.hitSfx ?? this.ev('hitAbility'), at(dst), 1, 0, aw);
        break;
      }
      case 'area': if (e.sfx) this.cue(e.sfx as string, { x: e.x as number, y: e.y as number }, 1, ((e.delay as number) || 0) + ((e.life as number) || 0), aw); break;
      case 'attack': this.cue(this.abilitySfx.get(`attack:${src?.def}`)?.sfx ?? this.ev('attack'), at(src), src?.kind === 'fighter' ? 0.6 : src?.kind === 'structure' ? 0.8 : 0.3, 0, aw); break;
      case 'damage': {
        const p = at(dst);
        if (near(p)) this.intensity = Math.min(1, this.intensity + (src?.kind === 'fighter' && dst?.kind === 'fighter' ? 0.12 : 0.02));
        // ability hits voice through `hit`; a passive's damage with no delivery through the `proc` that follows it
        if (e.ability) break;
        if (e.crit) this.cue(this.ev('crit'), p, 1, 0, aw);
        else this.cue(this.abilitySfx.get(`attack:${src?.def}`)?.hitSfx ?? this.ev(e.dtype === 'magic' ? 'hitMagic' : e.dtype === 'true' ? 'hitTrue' : 'hitPhysical'), p, src?.kind === 'fighter' ? 0.8 : 0.45, 0, aw);
        break;
      }
      case 'heal': this.cue(this.ev('heal'), at(dst), 0.7, 0, aw); break;
      case 'shield': this.cue(this.ev('shield'), at(dst), 1, 0, aw); break;
      case 'status': {
        // fighters only (a Wick's slow is noise); no catch-all: an unbound kind (a rider on a hit that sounds) is silent
        if (dst?.kind !== 'fighter') break;
        const k = e.status as string;
        const by = dst.statuses?.filter((x) => x.kind === k).map((x) => this.ent(x.src)) ?? [];
        const hostile = by.some((x) => !!x && x.team !== dst.team);
        this.cue(this.ev(`status.${k}`), at(dst), 0.8 * (hostile && e.dst === youId ? YOU_CC_GAIN : 1), 0, aw);
        break;
      }
      case 'proc': {
        // a passive fired (see `procs` in the header): its payoff's sound at the subject, else at the owner
        const id = e.ability as string;
        const pv = this.passives.get(id);
        const cueId = pv ? pv.cue ?? this.ev(`proc.${pv.kind}`) : undefined;
        if (!cueId || !this.cues[cueId]) { this.procStats.unbound++; break; }
        const now = this.ctx?.currentTime ?? 0;
        const key = `${id}:${e.src as number}`;
        if (now - (this.procLast.get(key) ?? -1e9) < (PERIODIC_ON.has(e.on as string) ? PROC_PERIODIC_S : PROC_GAP_S)) { this.procStats.throttled++; break; }
        const r = this.cue(cueId, at(dst ?? src), 1, 0, aw);
        if (r === 'played') this.procLast.set(key, now);
        this.procStats[r === 'none' ? 'unbound' : r]++;
        break;
      }
      case 'dash': this.cue(this.ev('dash'), at(src), 1, 0, aw); break;
      case 'blink': this.cue(this.ev('blink'), at(src), 1, 0, aw); break;
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
      case 'ping': {
        // team-private: only a ping made by a player of your team sounds (the HUD draws only those)
        const by = this.client?.view.players.find((x) => x.player === e.player);
        if (!by || by.team !== this.myTeam()) break;
        this.cue(this.ev(`ping.${e.kind as string}`), null);
        break;
      }
      case 'pickup': if (e.player === this.client?.you) this.cue(this.ev('pickup'), null); break;
      case 'announce': {
        const key = e.key as string;
        // a personal notice (a denied purchase, a practice reset) is only yours to hear
        if (/^(shop_denied|practice_reset)$/.test(key) && e.player !== undefined && e.player !== this.client?.you) break;
        // a team's own business (a surrender vote, its outcome) is only that team's to hear
        if (/^surrender_/.test(key) && e.team !== this.myTeam()) break;
        this.cue(this.ev(/first|ace|objective|structure|inhib|core/i.test(key) ? 'announceMajor' : 'announceMinor'), null);
        break;
      }
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
    this.syncAmbience();
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

/** the points of one art.ambient group (see `ambience` in the header): an effect by its vfx id, a critter by its
 *  id, a prop by its fx's vfx id or its model's file name (without .glb) */
function ambientPoints(art: AmbientLike | undefined, source: string): { x: number; y: number }[] {
  const at: number[][] = [];
  for (const e of art?.effects ?? []) if (e.vfx === source) at.push(...e.at);
  for (const c of art?.critters ?? []) if (c.id === source) at.push(...c.spots);
  for (const p of art?.props ?? []) {
    const file = p.model.slice(p.model.lastIndexOf('/') + 1).replace(/\.glb$/, '');
    if (p.fx?.vfx === source || file === source) at.push(...p.at);
  }
  return at.filter((a) => Number.isFinite(a[0]) && Number.isFinite(a[1])).map((a) => ({ x: a[0], y: a[1] }));
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
