// VALE audio — the WebAudio engine (CONTRACT §11; tokens.json `audio`). Implements the UI's AudioPort.
//
//   buses       music · sfx · ui · voice · ambience → master → [soften] → limiter → soft clip → out (Settings.audio
//               volumes; `muteInBackground` silences a hidden tab). The limiter (a compressor) can overshoot on a
//               fast transient, so a soft clip after it bends the top CLIP_KNEE..CLIP_CEIL and nothing passes
//               −1 dBFS. Accessibility (final parity AUD-m4): `mono` sums the output to one channel (both speakers
//               carry everything: one-sided hearing, a single earbud); `soften` puts a gentle compressor before
//               the limiter (SOFT_*: about 6 dB off the loudest transients, quiet sounds untouched)
//   ducking     voice > sfx > music (CONTRACT §11): while an announcer line plays, music and ambience sit
//               VOICE_DUCK_DB lower and the sfx bus SFX_DUCK_DB lower, except threats to your fighter (the
//               awareness pass below), which are never ducked (r07 §2.2.7)
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
//               DROPPED −1 when an ally made it (threat > self > ally, content/audio.json). A voice ranks by
//               priority × audibility on a log scale: priority + log10(cue gain × placement × the event's gain), so
//               one priority step outweighs 20 dB and a faint, far voice yields before a loud one of its priority.
//               A cue at its maxVoices, or
//               the whole engine at MAX_VOICES (one global budget over every bus; the gate cues and music beds
//               are outside it), frees its lowest-ranked, oldest voice, never one that outranks the newcomer
//               (then the newcomer is the one dropped)
//   announcer   the voice bus speaks one line at a time (r07 §2.2): a world event becomes at most ONE line, queued
//               by band (0 match flow · 1 a wipe, your elimination · 2 takedown news · 3 structures and
//               objectives · 4 team notices · 5 the rest), merged (a takedown's first / multi / shutdown lines and
//               a later multi by the same player are one line, the best; a structure and the objective it
//               grants in one tick are one line; a wipe swallows that tick's takedown lines), expired after
//               ANN_TTL_S of waiting, and only bands 0-1 cut a playing line short (a short fade). The lines are a
//               bell language bound in content ('announce.<line>'): first takedown one high toll, a multi-takedown
//               n rising tolls, a shutdown falling glass, structures a low hourbell (yours lost over Dsus2,
//               theirs resolving to F#), each named objective its own timbre. The HUD banner carries the words
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
//               whole 1024-sample frame of silence, inaudible). AAC decodes several times slower than Opus in
//               Safari (a 160 s bed ~10-20 s), so a bed's main stem also ships as .m4a PIECES (see `music`)
//   music       MusicDef beds crossfade (1.2 s). The main stem starts as soon as IT decodes (a slow layer never
//               holds the bed back); each layer joins phase-locked to the main stem at the next bar once its own
//               file is in. A layer's id gives its role: 'stem…' loops on its own length, always on (the menu's
//               independent stems, tokens.audio.beds.menu.stemsS); 'phase_<p>' follows musicPhase() (the draft:
//               every phase layer up to and including <p>, in content order, fades in on the next bar);
//               'urgency' follows musicUrgency() (your last seconds to pick, fast in and out); until the client
//               calls musicPhase() for a bed, the bed walks its phases itself on the old through-composed arc
//               (AUTO_PHASE_S: the first phase layer from 16 s, the last from 80 s); any other layer is
//               the combat layer, faded by the match's combat intensity (enter above 0.6, leave below 0.35
//               after 8 s, quantised to the bar). duck() pulls the bed −8 dB under a moment (the ready check).
//               'seg_<s>' layers are the main stem's .m4a pieces, for the .m4a path only (the .ogg path never
//               fetches one): <s> = where the piece starts on the bed's timeline (audio/build_music.py cuts them
//               from the same master: 16 s first, then doubling to 64 s, each running on SEG_OVERLAP_S into the
//               next). There the main stem plays piece by piece, the first starting the bed and each next one
//               cross-fading in over the run-on of the one before; once all are in they are stitched into one
//               buffer (the run-ons cross-faded) that takes over at the last piece's start and loops; only then
//               do the layers start decoding. The stitched stem is kept, so the bed's next start is immediate
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
//               team; online play is lockstep, so every client receives every seat's commands). Heals: a
//               lifesteal / omnivamp heal (a unit healing itself in the tick of its own damage) is not voiced, and
//               one target's heals within HEAL_MERGE_S are one chime.
//   kits        a fighter's own sounds (final parity AUD-1): content names them f_<fighter>_<slot>, slots
//               attack_swing · attack_hit · a1 · a2 · a3 · ult_windup · ult_release · passive · death · call, and
//               the engine resolves them BEFORE the catalog's present.sfx / hitSfx and the generic roles, so a
//               fighter is told apart by ear without touching content/fighters. attack_swing on its 'attack',
//               attack_hit on its basic attack's 'damage' (under the crit cue on a crit), a1-a3 on the slot's
//               'cast' (whatever form the ability is in), ult_windup on the ult's 'cast', ult_release on the
//               cast's first effect (area · projectile · hit · damage of that ultimate, or the caster's dash /
//               blink) at or after its wind-up ends. A release with no effect event (a leap that cannot start)
//               falls back on the sim's own commit, the ult's cooldown starting, at the end of that tick's batch;
//               a wind-up cancelled by CC or death commits nothing and stays silent. An area release sounds where
//               the area lands, the rest at the caster. death replaces the generic fall, passive is the proc (see
//               `procs`), call is the lock-in motif the draft plays through fighterCall(). A slot content has no
//               cue for falls back to the catalog's present and then the generic set, as before
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
//               the whole bus is ducked up to AMB_DUCK_DB under a FIGHT (fighter-vs-fighter damage near the
//               listener or your living fighter; a wave being cleared does not duck the world)
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
/** what became of a proc: played, held back by its owner's window, the cue's own cooldown or its voices, out of
 *  earshot, fogged, or `unbound` (no cue anywhere: the one outcome the probes fail on) */
type ProcOutcome = 'played' | 'throttled' | 'cooldown' | 'voices' | 'culled' | 'unseen' | 'unbound' | 'off';
/** one ambience emitter (see `ambience` in the header) */
interface Emitter {
  role: string; cue: string; def: CueDef; pts: { x: number; y: number }[];
  src: AudioBufferSourceNode | null; gain: GainNode; pan: StereoPannerNode; lpf: BiquadFilterNode;
  att: number; panV: number; lpfV: number; started: boolean;
}
/** Settings.audio; `mono` and `soften` are the accessibility options (absent: off) */
interface AudioSettings { master: number; music: number; sfx: number; voice: number; ui: number; ambience: number; muteInBackground: boolean;
  mono?: boolean; soften?: boolean }
/** one announcer line waiting for the voice bus (see `announcer` in the header) */
interface AnnItem { cue: string; band: number; rank: number; key: string; t: number; born: number }
/** a bed layer (see `music` in the header) */
type LayerRole = 'combat' | 'stem' | 'phase' | 'urgency';
interface BedLayer { id: string; role: LayerRole; file: string; gain: GainNode; src: AudioBufferSourceNode | null; buf: AudioBuffer | null }
/** the playing bed: `t0` = when its main stem started at position 0 (ctx time; null until it decodes), `len` its loop
 *  length; `pieces` = the .m4a path's piece sources until the stitched main stem takes over (see `music`) */
interface Bed { id: string; def: MusicDefT; main: AudioBufferSourceNode | null; t0: number | null; len: number; gain: GainNode;
  layers: BedLayer[]; pieces: { src: AudioBufferSourceNode; gain: GainNode }[] }
/** a main stem's .m4a piece: `at` = where it starts on the bed's timeline (s) */
interface BedPiece { at: number; file: string }
interface EntityLike { id: number; kind: string; def?: string; team: number; x: number; y: number; visibleMask?: number; alive?: boolean;
  statuses?: readonly { kind: string; src?: number }[] }
/** a spatial cue's placement around the listener */
interface Place { att: number; pan: number; lpf: number }
/** per-play options: `aware` = a threat to your fighter (the awareness pass applies, and the voice-bus duck spares
 *  it); `onVoice` hears the voice once its file is decoded and started (the announcer times its line by it) */
interface CueOpts { aware?: boolean; lift?: number; onVoice?: (v: Voice, buf: AudioBuffer) => void }

export interface ValeAudioPort extends AudioPort {
  attach(client: MatchClient | null): void;
  /** the fighter's lock-in call (f_<fighter>_call, see `kits` in the header); false when content has none, and the
   *  UI keeps its generic lock-in alone */
  fighterCall(fighter: string): boolean;
  /** where spatial cues are heard from: the camera's ground focus in sim units (x, y), or null to hear from your
   *  fighter (no renderer). boot/main.ts passes the renderer's listenerFocus() */
  listener(focus: (() => { x: number; y: number } | null) | null): void;
  settings(s: AudioSettings): void;
  /** the draft's phase (the bed's 'phase_<p>' layers, see `music` in the header); null: the main stem alone. Reset
   *  when the bed changes, so call it after music() */
  musicPhase(phase: string | null): void;
  /** your own last seconds to act in the draft (tokens.audio.beds.draft.localUrgencyLastS): the 'urgency' layer */
  musicUrgency(on: boolean): void;
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
const MAX_VOICES = 32;       // the global budget (r07 §4.3: 32-48 in a browser): past it the lowest-ranked voice yields
const HEAL_MERGE_S = 0.25;   // one target's heals within this are one chime
// the mixer (see `buses` / `ducking` in the header)
const CLIP_KNEE = 0.7;       // the soft clip is linear up to −3.1 dBFS …
const CLIP_CEIL = 0.891;     // … and bends everything above into −1 dBFS
const VOICE_DUCK_DB = 6;     // music and ambience under an announcer line …
const SFX_DUCK_DB = 3;       // … and the sfx bus (threats to your fighter excepted)
const DUCK_IN_S = 0.01;      // time constants: in fast (r07 §4.2: 10-30 ms attack), out over a few hundred ms
const DUCK_OUT_S = 0.12;
const SOFT_THRESHOLD_DB = -26;   // `soften`: a gentle compressor before the limiter
const SOFT_RATIO = 3;
const SOFT_KNEE_DB = 12;
// the announcer (see `announcer` in the header)
const ANN_TTL_S = [1.5, 4, 4, 3, 3, 3];   // per band: a line that waited longer is dropped (r07 §2.2.4: 2-4 s)
const ANN_PREEMPT = 1;       // bands up to this cut a playing line of a lower band short …
const ANN_CUT_S = 0.15;      // … with this fade
const ANN_TAIL_S = 0.6;      // the next line may start this long before the playing file ends (its ring-out) …
const ANN_MIN_S = 0.6;       // … but never sooner than this after it started
const AUTO_PHASE_S = [16, 80];   // a bed's phases walk themselves (first, last phase layer) until musicPhase() drives them
const SEG_OVERLAP_S = 0.05;  // a main stem's .m4a piece runs on this far into the next (audio/build_music.py PIECE_OVERLAP_S)
const YOU_CC_GAIN = Math.pow(10, 3 / 20);   // +3 dB: a control status landing on YOU
const LOOP_DEFAULT_S = 2.5;  // a looping cue with no stated life stops after this
const PROC_GAP_S = 0.3;      // one passive of one owner sounds at most this often (an on-hit passive on every attack)
const PROC_PERIODIC_S = 6;   // … and a periodic one (an aura's tick, a run-up stack) only reminds this often
const PERIODIC_ON = new Set(['interval', 'moveDistance']);
/** a fighter's kit slots (see `kits` in the header): content's cue f_<fighter>_<slot> */
const KIT_SLOTS = ['attack_swing', 'attack_hit', 'a1', 'a2', 'a3', 'ult_windup', 'ult_release', 'passive', 'death', 'call'] as const;
type KitSlot = typeof KIT_SLOTS[number];
const CAST_SLOTS = new Set<string>(['a1', 'a2', 'a3']);
const RELEASE_EPS_S = 1.5 / 30;        // the sim counts the wind-up from the cast's own tick: its release lands up to
                                        // one tick before cast.t + castTime (sim time)
const CRIT_KIT_GAIN = 0.6;    // a crit: the fighter's own attack_hit under the crit cue
const AMB_INNER_M = 10;      // an ambience emitter's point is at full level within this of the listener …
const AMB_HEAR_M = 32;       // … and silent past this
const AMB_DUCK_DB = 6;       // the ambience bus under a fight: full duck at fight heat AMB_DUCK_FULL …
const AMB_DUCK_FROM = 0.2;   // … none below this (a lone poke); the heat counts fighter-vs-fighter damage only
const AMB_DUCK_FULL = 0.6;
const FIGHT_HIT = 0.12;      // fight heat per fighter-vs-fighter hit near the listener (or your living fighter) …
const FIGHT_DECAY = 0.15;    // … cooling per second
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

/** a one-shot, from the moment it is admitted (its slot is held while its file decodes: `src` null until it starts;
 *  `dead` when it was freed before starting); `rank` = priority + log10(audibility) (see `priority`); `pooled` false
 *  for the gate cues */
interface Voice { src: AudioBufferSourceNode | null; gain: GainNode | null; cue: string; bus: Bus; priority: number; rank: number; pooled: boolean;
  started: number; dead?: boolean }

class Engine implements ValeAudioPort {
  readonly log: string[] = [];
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  /** `soften`'s compressor (wired between the master and the limiter while it is on) */
  private soft!: DynamicsCompressorNode;
  private softOn = false;
  /** the output stage after the limiter / soft clip: 2 channels, or 1 (summed) under `mono` */
  private out!: GainNode;
  private readonly bus = new Map<Bus, GainNode>();
  /** the voice-bus duck after a bus (music, ambience, sfx; see `ducking` in the header) */
  private readonly vduck = new Map<Bus, GainNode>();
  /** threats to your fighter: the sfx bus's volume, past its duck */
  private threat!: GainNode;
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
  private bed: Bed | null = null;
  private wantBed: string | null = null;
  /** musicPhase() / musicUrgency() (see `music` in the header) */
  private phase: string | null = null;
  private urgent = false;
  /** musicPhase() was called for this bed (else the bed walks its own phases, AUTO_PHASE_S) */
  private phaseDriven = false;
  // the announcer (see `announcer` in the header)
  private annQ: AnnItem[] = [];
  private annNow: { item: AnnItem; voice: Voice | null; until: number } | null = null;
  private annT: ReturnType<typeof setTimeout> | undefined;
  /** entity → the sim time of its last damage dealt (a heal in that same tick to itself is vamp) */
  private readonly dealt = new Map<number, number>();
  /** heal target entity → ctx time of its last voiced heal */
  private readonly healLast = new Map<number, number>();
  /** teams whose every fighter is down (a wipe, announced once until one of them is back) */
  private readonly wiped = new Set<number>();
  private duckGain!: GainNode;
  private hidden = false;
  // match
  private client: MatchClient | null = null;
  /** match time at the last update: the pre-game countdown (negative time) ticks the last 3 s, 0 starts */
  private lastT: number | null = null;
  private off: (() => void) | null = null;
  private readonly abilitySfx = new Map<string, { sfx?: string; hitSfx?: string }>();
  private intensity = 0;
  /** fighter-vs-fighter damage near the listener only (the ambience duck; `intensity` also counts wave fights) */
  private fight = 0;
  private combat = false;
  private calmFor = 0;
  private tick: number | null = null;
  /** the camera focus provider (listener()); null: hear from your fighter */
  private focus: (() => { x: number; y: number } | null) | null = null;
  /** passive id → what owns it and the cue its proc plays (undefined: the 'proc.<kind>' role decides) */
  private readonly passives = new Map<string, { kind: PassiveKind; cue?: string }>();
  /** fighter id → the kit slots content has a cue for (see `kits` in the header) */
  private readonly kits = new Map<string, Partial<Record<KitSlot, string>>>();
  /** caster entity → its ultimate waiting for the wind-up's end (see `kits` in the header) */
  private readonly ults = new Map<number, { cue: string; ability: string; due: number; cd0: number }>();
  /** `${passive}:${owner}` → ctx time of its last sounding proc */
  private readonly procLast = new Map<string, number>();
  /** dev / probes: every proc's outcome, counted */
  readonly procStats: Record<ProcOutcome, number> = { played: 0, throttled: 0, cooldown: 0, voices: 0, culled: 0, unseen: 0, unbound: 0, off: 0 };
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
    for (const f of cat.fighters) {
      const k: Partial<Record<KitSlot, string>> = {};
      for (const s of KIT_SLOTS) if (this.cues[`f_${f.id}_${s}`]) k[s] = `f_${f.id}_${s}`;
      this.kits.set(f.id, k);
    }
    // passives (see `procs` in the header): the per-fighter cue first, then the passive's own present
    const own = (p: PassiveLike | undefined, kind: PassiveKind, fighter?: string): void => {
      if (!p) return;
      this.passives.set(p.id, { kind, cue: (fighter ? this.kits.get(fighter)?.passive : undefined) ?? p.present?.sfx ?? p.present?.hitSfx });
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
    const soft = ctx.createDynamicsCompressor();
    soft.threshold.value = SOFT_THRESHOLD_DB; soft.knee.value = SOFT_KNEE_DB; soft.ratio.value = SOFT_RATIO; soft.attack.value = 0.003; soft.release.value = 0.25;
    this.soft = soft;
    soft.connect(limiter);
    // the output: the limiter, a soft clip where the platform has one (see `buses`), the mono switch, the speakers
    this.out = ctx.createGain();
    this.out.channelCountMode = 'explicit'; this.out.channelInterpretation = 'speakers'; this.out.channelCount = 2;
    let tail: AudioNode = limiter;
    if (typeof ctx.createWaveShaper === 'function') {
      const clip = ctx.createWaveShaper();
      clip.curve = softClipCurve();
      clip.oversample = '4x';
      tail = tail.connect(clip);
    }
    tail.connect(this.out).connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.duckGain = ctx.createGain();
    for (const b of BUSES) {
      const g = ctx.createGain();
      this.bus.set(b, g);
      // music → the ready-check duck → the voice duck; ambience and sfx → their voice duck; ui and voice straight in
      if (b === 'music' || b === 'ambience' || b === 'sfx') {
        const d = ctx.createGain();
        this.vduck.set(b, d);
        d.connect(this.master);
        if (b === 'music') g.connect(this.duckGain).connect(d); else g.connect(d);
      } else g.connect(this.master);
    }
    this.threat = ctx.createGain();
    this.threat.connect(this.master);
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
    this.threat.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    // accessibility (see `buses`): mono sums to one channel the speakers up-mix; soften re-wires its compressor in
    this.out.channelCount = this.vol.mono ? 1 : 2;
    const soften = !!this.vol.soften;
    if (soften !== this.softOn) {
      this.softOn = soften;
      this.master.disconnect();
      this.master.connect(soften ? this.soft : this.limiter);
    }
  }

  /** dev / harness: the accessibility state as wired (mono channels, soften in the chain) */
  get access(): { channels: number; soften: boolean } { return { channels: this.out?.channelCount ?? 2, soften: this.softOn }; }

  /** dev / harness: the output graph (the probes meter `out`: what reaches the speakers, after the soft clip; the
   *  limiter's own output is before it) */
  get graph(): { ctx: AudioContext; limiter: DynamicsCompressorNode; out: GainNode; master: GainNode; bus: Record<Bus, GainNode> } | null {
    return this.ctx ? { ctx: this.ctx, limiter: this.limiter, out: this.out, master: this.master, bus: Object.fromEntries(this.bus) as Record<Bus, GainNode> } : null;
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

  fighterCall(fighter: string): boolean {
    const c = this.kits.get(fighter)?.call;
    if (c) this.cue(c, null);
    return !!c;
  }

  /** a fighter's own cue for a kit slot (see `kits` in the header); undefined when `x` is no fighter or content
   *  has no such cue (the catalog's present and the generic roles then decide) */
  private kit(x: EntityLike | undefined, slot: KitSlot): string | undefined {
    return x?.kind === 'fighter' && x.def ? this.kits.get(x.def)?.[slot] : undefined;
  }

  settings(s: AudioSettings): void { this.vol = { ...s }; this.applyVolumes(); }

  musicPhase(phase: string | null): void { this.phase = phase; this.phaseDriven = true; this.bedRoles(); }

  musicUrgency(on: boolean): void { this.urgent = on; this.bedRoles(); }

  duck(on: boolean): void {
    if (!this.ctx) return;
    this.duckGain.gain.setTargetAtTime(on ? Math.pow(10, -8 / 20) : 1, this.ctx.currentTime, 0.15);
  }

  music(id: string | null): void {
    if (id === this.wantBed) return;
    this.wantBed = id;
    this.phase = null; this.urgent = false; this.phaseDriven = false;
    if (!this.ctx) return;
    this.stopBed();
    if (id) this.startBed(id);
  }

  /** the cue bound to an engine event role, if the catalog binds one */
  private ev(role: string): string | undefined { return this.events[role]; }

  /** play a cue; `pos` (world x, y) makes a spatial cue pan/attenuate around the listener (see `listener` in the
   *  header). A looping cue stops after `hold` seconds (a zone's delay + life), else after LOOP_DEFAULT_S.
   *  Returns what became of it ('none': no such cue; 'off': no running context; 'voices': every voice outranks it) */
  private cue(cueId: string | undefined, pos: { x: number; y: number } | null, gainMul = 1, hold = 0, o: CueOpts = {}):
    'played' | 'cooldown' | 'voices' | 'culled' | 'none' | 'off' {
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
    // voice limits (see `priority` in the header): the cue's own maxVoices, then the global budget
    const prio = c.priority + (o.lift ?? 0);
    const alert = this.alertCues.has(cueId);
    const rank = prio + Math.log10(Math.max(1e-3, c.gain * att * gainMul));
    if (!this.makeRoom(this.voices.filter((v) => v.cue === cueId), c.maxVoices, rank)) return 'voices';
    if (!alert && !this.makeRoom(this.voices.filter((v) => v.pooled), MAX_VOICES, rank)) return 'voices';
    this.lastPlay.set(cueId, now);
    // where it joins the mix: the gate cues' alert path; a threat to your fighter past the sfx duck; else its bus
    const into = alert ? this.alertBus.get(c.bus)! : c.bus === 'sfx' && o.aware ? this.threat : this.bus.get(c.bus)!;
    const file = c.files[Math.floor(Math.random() * c.files.length)];
    // the slot is held from now (a burst of cues decoding at once must not overrun the budget)
    const v: Voice = { src: null, gain: null, cue: cueId, bus: c.bus, priority: prio, rank, pooled: !alert, started: now };
    this.voices.push(v);
    const drop = (): void => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
    void this.buffer(file).then((buf) => {
      if (v.dead) return;
      if (!buf || !this.ctx) { drop(); return; }
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
      node.connect(g).connect(into);
      v.src = src; v.gain = g; v.started = this.ctx.currentTime;
      src.onended = drop;
      src.start();
      if (c.loop) this.stopVoice(v, 0.25, Math.max(0.3, hold > 0 ? hold : LOOP_DEFAULT_S));
      if (this.log.length < 400) this.log.push(cueId);
      o.onVoice?.(v, buf);
    });
    return 'played';
  }

  /** a full set of voices frees its lowest-ranked, oldest one for a newcomer of rank `rank`; false (the newcomer is
   *  dropped) when every voice outranks it */
  private makeRoom(set: Voice[], max: number, rank: number): boolean {
    if (set.length < max) return true;
    let w: Voice | null = null;
    for (const v of set) if (!w || v.rank < w.rank || (v.rank === w.rank && v.started < w.started)) w = v;
    if (!w || w.rank > rank) return false;
    this.stopVoice(w, 0.03);
    const i = this.voices.indexOf(w);
    if (i >= 0) this.voices.splice(i, 1);           // it fades out on its own; it no longer holds a slot
    return true;
  }

  private stopVoice(v: Voice, fade: number, after = 0): void {
    if (!this.ctx) return;
    if (!v.src || !v.gain) { v.dead = true; return; }        // still decoding: it never starts
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
    gain.gain.value = 0;
    gain.connect(this.bus.get('music')!);
    let combat = false;
    const pieces: BedPiece[] = def.layers.filter((l) => l.id.startsWith('seg_'))
      .map((l) => ({ at: Number(l.id.slice('seg_'.length)), file: l.file })).sort((a, b) => a.at - b.at);
    const layers: BedLayer[] = def.layers.filter((l) => !l.id.startsWith('seg_')).map((l) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(gain);
      // the first layer with no other role is the combat layer (see `music` in the header)
      const role: LayerRole = l.id.startsWith('stem') ? 'stem' : l.id.startsWith('phase_') ? 'phase' : l.id === 'urgency' ? 'urgency'
        : combat ? 'stem' : 'combat';
      if (role === 'combat') combat = true;
      return { id: l.id, role, file: l.file, gain: g, src: null, buf: null };
    });
    const bed: Bed = { id, def, main: null, t0: null, len: 0, gain, layers, pieces: [] };
    this.bed = bed;
    // each layer joins when both it and the main stem are in
    const loadLayers = (): void => {
      for (const l of layers) {
        void this.buffer(l.file).then((buf) => {
          if (this.bed !== bed || !buf || !this.ctx) return;
          l.buf = buf;
          if (bed.t0 !== null) this.startLayer(bed, l);
        });
      }
    };
    // the .m4a path plays a main stem it has not decoded yet piece by piece; the layers wait for the decoder
    if (this.fmt === 'm4a' && pieces.length > 1 && pieces[0].at === 0 && !this.buffers.has(def.file)) {
      void this.playPieces(bed, pieces).then(loadLayers);
      return;
    }
    // the main stem starts as soon as it decodes
    void this.buffer(def.file).then((main) => {
      if (this.bed === bed && main) this.loopMain(bed, main);
    });
    loadLayers();
  }

  /** the main stem starts looping now (position 0), the bed fading in */
  private loopMain(bed: Bed, main: AudioBuffer): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const def = bed.def;
    const t0 = ctx.currentTime + 0.05;
    const s = ctx.createBufferSource();
    s.buffer = main; s.loop = true;
    s.loopStart = def.loopStart; s.loopEnd = def.loopEnd ?? main.duration;
    s.connect(bed.gain); s.start(t0);
    bed.main = s; bed.t0 = t0; bed.len = Math.max(0.001, s.loopEnd - s.loopStart);
    bed.gain.gain.setTargetAtTime(def.gain, t0, XFADE_S / 3);
    for (const l of bed.layers) if (l.buf) this.startLayer(bed, l);
  }

  /** the .m4a path's main stem (see `music` in the header): the pieces decode one after another, each plays from its
   *  place on the bed's timeline as soon as it is in (the first starts the bed), and once all are in they are stitched
   *  into one buffer that takes over at the last piece's start and loops. A piece that fails hands over to the
   *  whole .m4a, wherever the bed has got to */
  private async playPieces(bed: Bed, pieces: BedPiece[]): Promise<void> {
    const bufs: AudioBuffer[] = [];
    let prev: GainNode | null = null;
    for (let i = 0; i < pieces.length; i++) {
      const buf = this.ctx ? await this.decode(this.ctx, pieces[i].file) : null;
      if (this.bed !== bed || !this.ctx) return;
      if (!buf) {
        const whole = await this.buffer(bed.def.file);
        if (this.bed === bed && whole) this.takeOver(bed, whole, prev);
        return;
      }
      bufs.push(buf);
      if (i < pieces.length - 1) prev = this.playPiece(bed, buf, pieces[i].at, prev);
    }
    const ctx = this.ctx;
    if (!ctx) return;
    const whole = this.stitch(ctx, bufs, pieces);
    this.buffers.set(bed.def.file, Promise.resolve(whole));
    this.takeOver(bed, whole, prev, pieces[pieces.length - 1].at);
  }

  /** one piece on the bed's timeline at `at` s: it cross-fades in over the run-on of the piece before (`prev`, faded
   *  out under it); a piece decoded after its time joins at once where the timeline is. Returns its gain */
  private playPiece(bed: Bed, buf: AudioBuffer, at: number, prev: GainNode | null): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(bed.gain);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(g);
    const now = ctx.currentTime;
    if (bed.t0 === null) {                                  // the first piece: the bed starts
      bed.t0 = now + 0.05;
      s.start(bed.t0);
      bed.gain.gain.setTargetAtTime(bed.def.gain, bed.t0, XFADE_S / 3);
    } else this.joinAt(g, s, bed.t0 + at, 0, prev);
    bed.pieces.push({ src: s, gain: g });
    return g;
  }

  /** start `s` (gain `g`) at context time `t` from offset `pos` of its buffer, cross-fading in over the run-on of
   *  `prev`; when `t` has passed, at once from where the bed's timeline is (`pos` + the delay; `wrap` folds it into a
   *  loop) with a short fade, `prev` fading out under it */
  private joinAt(g: GainNode, s: AudioBufferSourceNode, t: number, pos: number, prev: GainNode | null, wrap?: (p: number) => number): void {
    const now = this.ctx!.currentTime;
    if (t >= now + 0.02) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + SEG_OVERLAP_S);
      if (prev) { prev.gain.setValueAtTime(1, t); prev.gain.linearRampToValueAtTime(0, t + SEG_OVERLAP_S); }
      s.start(t, pos);
      return;
    }
    const at = now + 0.05;
    const p = pos + (at - t);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + 0.03);
    if (prev) { prev.gain.cancelScheduledValues(at); prev.gain.setValueAtTime(prev.gain.value, at); prev.gain.linearRampToValueAtTime(0, at + 0.03); }
    s.start(at, wrap ? wrap(p) : Math.min(p, Math.max(0, (s.buffer?.duration ?? 0) - 0.001)));
  }

  /** the stitched (or whole) main stem takes over from the pieces and loops: at bed position `at` when that is still
   *  ahead, else at once where the timeline is */
  private takeOver(bed: Bed, buf: AudioBuffer, prev: GainNode | null, at?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (bed.t0 === null) { this.loopMain(bed, buf); return; }        // no piece ever played
    const def = bed.def;
    const g = ctx.createGain();
    g.connect(bed.gain);
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.loopStart = def.loopStart; s.loopEnd = def.loopEnd ?? buf.duration;
    s.connect(g);
    const end = s.loopEnd, len = Math.max(0.001, end - s.loopStart);
    const wrap = (p: number): number => (p < end ? p : def.loopStart + ((p - end) % len));
    const now = ctx.currentTime;
    const t = at === undefined ? now : bed.t0 + at;
    const late = t < now + 0.02;
    this.joinAt(g, s, t, t - bed.t0, late ? null : prev, wrap);
    if (late) {                                             // every piece still sounding (or still to come) yields now
      for (const p of bed.pieces) {
        p.gain.gain.cancelScheduledValues(now);
        p.gain.gain.setTargetAtTime(0, now + 0.05, 0.01);
        try { p.src.stop(now + 0.15); } catch { /* not started */ }
      }
    }
    bed.main = s; bed.len = len;
    for (const l of bed.layers) if (l.buf) this.startLayer(bed, l);
  }

  /** the pieces as one loop, the way audio/build_music.py `stitch` QAs them: each piece's run-on cross-fades
   *  (linear) into the head of the next, the last one's into the loop's head */
  private stitch(ctx: AudioContext, bufs: AudioBuffer[], pieces: BedPiece[]): AudioBuffer {
    const sr = ctx.sampleRate;
    const ov = Math.max(1, Math.round(SEG_OVERLAP_S * sr));
    const starts = pieces.map((p) => Math.round(p.at * sr));
    const last = bufs.length - 1;
    const n = Math.max(starts[last] + 1, starts[last] + bufs[last].length - ov);
    const ch = Math.max(...bufs.map((b) => b.numberOfChannels));
    const out = ctx.createBuffer(ch, n, sr);
    for (let c = 0; c < ch; c++) {
      const o = out.getChannelData(c);
      for (let i = 0; i <= last; i++) {
        const d = bufs[i].getChannelData(Math.min(c, bufs[i].numberOfChannels - 1));
        const s0 = starts[i];
        const m = Math.min(d.length, (i < last ? starts[i + 1] : n) - s0 + ov);    // body + run-on
        const head = i > 0 ? Math.min(ov, m) : 0;
        for (let j = 0; j < head; j++) { const w = (j + 0.5) / ov; o[s0 + j] = o[s0 + j] * (1 - w) + d[j] * w; }
        const inLoop = Math.min(m, n - s0);
        if (inLoop > head) o.set(d.subarray(head, inLoop), s0 + head);
        for (let j = inLoop; j < m; j++) { const k = s0 + j - n; const w = (k + 0.5) / ov; o[k] = d[j] * (1 - w) + o[k] * w; }
      }
    }
    return out;
  }

  /** a layer joins its bed (see `music` in the header): a stem loops on its own from now; a synced layer starts on
   *  the main stem's next bar (or with the main stem, when both decoded together) at the main stem's loop position */
  private startLayer(bed: Bed, l: BedLayer): void {
    const ctx = this.ctx;
    if (!ctx || !l.buf || l.src || bed.t0 === null) return;
    const s = ctx.createBufferSource();
    s.buffer = l.buf; s.loop = true;
    s.connect(l.gain);
    const now = ctx.currentTime;
    if (l.role === 'stem') {
      s.loopStart = 0; s.loopEnd = l.buf.duration;
      s.start(now + 0.05);
      l.gain.gain.setTargetAtTime(1, now + 0.05, XFADE_S / 3);
    } else {
      const def = bed.def;
      s.loopStart = def.loopStart; s.loopEnd = def.loopEnd ?? l.buf.duration;
      const bar = (60 / def.bpm) * 4;
      const at = now + 0.05 <= bed.t0 ? bed.t0 : bed.t0 + Math.ceil((now + 0.05 - bed.t0) / bar) * bar;
      const p = at - bed.t0;
      const end = s.loopEnd;
      const pos = p < end ? p : def.loopStart + ((p - end) % bed.len);
      s.start(at, Math.min(pos, Math.max(0, l.buf.duration - 0.001)));
    }
    l.src = s;
    this.bedRoles();
  }

  /** the phase / urgency / combat layers' gains (see `music` in the header), switched on the main stem's next bar
   *  (urgency at once) */
  private bedRoles(): void {
    const b = this.bed;
    const ctx = this.ctx;
    if (!b || !ctx) return;
    const t = ctx.currentTime;
    const barS = (60 / b.def.bpm) * 4;
    const nextBar = b.t0 !== null && t > b.t0 ? b.t0 + Math.ceil((t - b.t0) / barS) * barS : t;
    const phases = b.layers.filter((l) => l.role === 'phase').map((l) => l.id.slice('phase_'.length));
    const upTo = this.phase === null ? -1 : phases.indexOf(this.phase);
    for (const l of b.layers) {
      if (l.role === 'stem') continue;
      const on = l.role === 'combat' ? this.combat : l.role === 'urgency' ? this.urgent : phases.indexOf(l.id.slice('phase_'.length)) <= upTo;
      const at = l.role === 'urgency' ? t : nextBar;
      l.gain.gain.cancelScheduledValues(t);
      l.gain.gain.setTargetAtTime(on ? 1 : 0, at, l.role === 'urgency' ? 0.12 : 0.6);
    }
  }

  private stopBed(): void {
    const b = this.bed;
    if (!b || !this.ctx) return;
    this.bed = null;
    const t = this.ctx.currentTime;
    b.gain.gain.setTargetAtTime(0, t, XFADE_S / 3);
    for (const s of [b.main, ...b.pieces.map((p) => p.src), ...b.layers.map((l) => l.src)]) if (s) try { s.stop(t + XFADE_S * 1.5); } catch { /* not started */ }
  }

  // ── the announcer (see `announcer` in the header) ─────────────────────────────────────────────────
  /** queue the line bound to `role` (else to `fallback`), merged by `key` (rank decides within a key) */
  private announce(role: string, band: number, rank: number, key: string, t: number, fallback?: string): void {
    const cue = this.ev(role) ?? (fallback ? this.ev(fallback) : undefined);
    if (!cue || !this.cues[cue]) return;
    const now = this.ctx?.currentTime ?? 0;
    const cur = this.annNow && now < this.annNow.until ? this.annNow.item : null;
    // a wipe swallows its own tick's takedown lines
    if (key.startsWith('kill:') && (this.annQ.some((q) => q.key === 'wipe' && q.t === t) || (cur?.key === 'wipe' && cur.t === t))) return;
    if (key === 'wipe') this.annQ = this.annQ.filter((q) => !(q.key.startsWith('kill:') && q.t === t));
    if (cur && cur.key === key && cur.rank >= rank) return;          // already saying it (or better)
    const i = this.annQ.findIndex((q) => q.key === key);
    if (i >= 0) {
      if (this.annQ[i].rank > rank) return;
      this.annQ.splice(i, 1);
    }
    this.annQ.push({ cue, band, rank, key, t, born: now });
  }

  /** speak the best waiting line when the voice bus is free (or cut a lower line for a band 0-1 one) */
  private pumpAnn(): void {
    const ctx = this.ctx;
    if (!ctx || !this.annQ.length) return;
    const now = ctx.currentTime;
    this.annQ = this.annQ.filter((q) => now - q.born <= ANN_TTL_S[Math.min(q.band, ANN_TTL_S.length - 1)]);
    if (!this.annQ.length) return;
    this.annQ.sort((a, b) => a.band - b.band || b.rank - a.rank || a.born - b.born);
    const top = this.annQ[0];
    const cur = this.annNow;
    if (cur && now < cur.until) {
      if (!(top.band <= ANN_PREEMPT && top.band < cur.item.band)) { this.annLater(cur.until - now); return; }
      if (cur.voice) this.stopVoice(cur.voice, ANN_CUT_S);
    }
    this.annQ.shift();
    const slot: { item: AnnItem; voice: Voice | null; until: number } = { item: top, voice: null, until: now + 1 };
    this.annNow = slot;
    const r = this.cue(top.cue, null, 1, 0, {
      onVoice: (v, buf) => {
        if (this.annNow !== slot) { this.stopVoice(v, ANN_CUT_S); return; }    // cut before its file was in
        if (!this.ctx) return;
        slot.voice = v;
        slot.until = v.started + Math.max(ANN_MIN_S, buf.duration - ANN_TAIL_S);
        this.voiceDuck(slot.until);
        this.annLater(slot.until - this.ctx.currentTime);
      },
    });
    if (r !== 'played') { this.annNow = null; this.pumpAnn(); return; }
    this.voiceDuck(slot.until);
    this.annLater(1);
  }

  private annLater(dt: number): void {
    clearTimeout(this.annT);
    this.annT = setTimeout(() => this.pumpAnn(), Math.max(0, dt) * 1000 + 20);
  }

  /** duck music / ambience / sfx under the voice bus until `until` (see `ducking` in the header) */
  private voiceDuck(until: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [b, d] of [['music', VOICE_DUCK_DB], ['ambience', VOICE_DUCK_DB], ['sfx', SFX_DUCK_DB]] as const) {
      const p = this.vduck.get(b)?.gain;
      if (!p) continue;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(Math.pow(10, -d / 20), now, DUCK_IN_S);
      p.setTargetAtTime(1, Math.max(now, until), DUCK_OUT_S);
    }
  }

  /** dev / probes: the announcer's state */
  get announcer(): { playing: string | null; until: number; queued: string[] } {
    const now = this.ctx?.currentTime ?? 0;
    const cur = this.annNow && now < this.annNow.until ? this.annNow : null;
    return { playing: cur?.item.cue ?? null, until: cur?.until ?? 0, queued: this.annQ.map((q) => q.cue) };
  }

  // ── match ─────────────────────────────────────────────────────────────────────────────────────
  attach(client: MatchClient | null): void {
    if (client === this.client) return;
    this.off?.();
    this.off = null;
    this.client = client;
    this.intensity = 0; this.fight = 0; this.combat = false; this.calmFor = 0;
    this.lastT = client ? client.view.time : null;
    this.procLast.clear();
    this.ults.clear();
    this.dealt.clear(); this.healLast.clear(); this.wiped.clear();
    this.annQ = [];
    this.stopAmbience();
    this.ambMap = client?.setup?.map ?? null;
    if (client) {
      this.off = client.onEvents((evs: SimEvent[]) => {
        for (const e of evs) this.onEvent(e as unknown as Record<string, unknown>);
        if (this.ults.size) this.settleUlts();
        // a whole tick's lines are queued (and merged) before the best of them speaks
        if (this.annQ.length) this.pumpAnn();
      });
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
      const k = Math.max(0, Math.min(1, (this.fight - AMB_DUCK_FROM) / (AMB_DUCK_FULL - AMB_DUCK_FROM)));
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

  /** an ultimate's release (see `kits` in the header): the first effect of the cast at or after its wind-up's end
   *  sounds the caster's ult_release (a release with no effect event: settleUlts) */
  private release(kind: string, e: Record<string, unknown>, src: EntityLike | undefined, aw: CueOpts): void {
    const id = e.src;
    const p = typeof id === 'number' ? this.ults.get(id) : undefined;
    if (!p || (e.t as number) + RELEASE_EPS_S < p.due) return;
    if (kind !== 'dash' && kind !== 'blink'
      && !((kind === 'area' || kind === 'projectile' || kind === 'hit' || kind === 'damage') && e.ability === p.ability)) return;
    this.ults.delete(id as number);
    this.cue(p.cue, kind === 'area' ? { x: e.x as number, y: e.y as number } : src ? { x: src.x, y: src.y } : null, 1, 0, aw);
  }

  /** after a whole batch of events: a wind-up whose release committed (the ult's cooldown started) without an effect
   *  event in the batch sounds now, at the caster; one past its release tick with no commit was cancelled */
  private settleUlts(): void {
    const now = this.client?.view.time ?? 0;
    for (const [cid, w] of this.ults) {
      const c = this.ent(cid);
      if (c && c.alive !== false && this.ultCooldown(cid) > w.cd0 + 0.5) {
        this.ults.delete(cid);
        if (this.seen(c)) this.cue(w.cue, { x: c.x, y: c.y }, 1, 0, { aware: c.team !== this.myTeam() });
      } else if (!c || c.alive === false || now > w.due + RELEASE_EPS_S) this.ults.delete(cid);
    }
  }

  /** the ult cooldown of the fighter `entity` (0 when ready or unknown): the sim starts it on a release */
  private ultCooldown(entity: number): number {
    const p = this.client?.view.players.find((x) => x.entity === entity);
    return p?.abilities.find((a) => a.slot === 'ult')?.cooldown ?? 0;
  }

  private onEvent(e: Record<string, unknown>): void {
    const kind = e.e as string;
    const src = this.ent(e.src), dst = this.ent(e.dst);
    // before fog: whose damage this tick was (vamp), and a wipe (the HUD banners both whatever you can see)
    if (kind === 'damage' && typeof e.src === 'number') this.dealt.set(e.src, e.t as number);
    if (kind === 'death' && e.kind === 'fighter' && dst) this.wipeCheck(dst.team, e.t as number);
    if (kind === 'respawn') {
      const p = this.client?.view.players.find((x) => x.player === e.player);
      if (p) this.wiped.delete(p.team);
    }
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
    if (this.ults.size) this.release(kind, e, src, aw);
    switch (kind) {
      case 'cast': {
        const slot = e.slot as string;
        const own = slot === 'ult' ? this.kit(src, 'ult_windup') : CAST_SLOTS.has(slot) ? this.kit(src, slot as KitSlot) : undefined;
        const pr = this.abilitySfx.get(e.ability as string);
        this.cue(own ?? pr?.sfx ?? this.ev(slot === 'ult' ? 'castUlt' : src?.kind === 'monster' ? 'castMonster' : 'cast'), at(src), 1, 0, aw);
        // the shared shade-breath swell for every enemy fighter's ultimate wind-up (its T4 wind-up VFX; STYLE_BIBLE
        // 'enemy T3+ wind-ups share one shade-breath swell'), placed at the caster like any spatial cue
        if (src?.kind === 'fighter' && src.team !== mine && slot === 'ult') this.cue(this.ev('enemyUltWindup'), at(src), 1, 0, aw);
        // the ult's release waits for the wind-up's end (see `kits`); any new cast ends a wait still open
        if (src) {
          const rel = slot === 'ult' ? this.kit(src, 'ult_release') : undefined;
          if (rel) this.ults.set(src.id, { cue: rel, ability: e.ability as string, due: (e.t as number) + ((e.castTime as number) || 0), cd0: this.ultCooldown(src.id) });
          else this.ults.delete(src.id);
        }
        break;
      }
      case 'projectile': this.cue(this.ev('projectile'), at(src), 0.7, 0, aw); break;
      case 'hit': {
        const pr = this.abilitySfx.get(e.ability as string);
        this.cue((e.sfx as string) ?? pr?.hitSfx ?? this.ev('hitAbility'), at(dst), 1, 0, aw);
        break;
      }
      case 'area': if (e.sfx) this.cue(e.sfx as string, { x: e.x as number, y: e.y as number }, 1, ((e.delay as number) || 0) + ((e.life as number) || 0), aw); break;
      case 'attack': this.cue(this.kit(src, 'attack_swing') ?? this.abilitySfx.get(`attack:${src?.def}`)?.sfx ?? this.ev('attack'), at(src), src?.kind === 'fighter' ? 0.6 : src?.kind === 'structure' ? 0.8 : 0.3, 0, aw); break;
      case 'damage': {
        const p = at(dst);
        const duel = src?.kind === 'fighter' && dst?.kind === 'fighter';
        if (near(p)) this.intensity = Math.min(1, this.intensity + (duel ? 0.12 : 0.02));
        if (near(p) && duel) this.fight = Math.min(1, this.fight + FIGHT_HIT);
        // ability hits voice through `hit`; a passive's damage with no delivery through the `proc` that follows it
        if (e.ability) break;
        const own = this.kit(src, 'attack_hit');
        if (e.crit) {
          this.cue(this.ev('crit'), p, 1, 0, aw);
          if (own) this.cue(own, p, CRIT_KIT_GAIN, 0, aw);      // whose crit it was
        } else this.cue(own ?? this.abilitySfx.get(`attack:${src?.def}`)?.hitSfx ?? this.ev(e.dtype === 'magic' ? 'hitMagic' : e.dtype === 'true' ? 'hitTrue' : 'hitPhysical'), p, src?.kind === 'fighter' ? 0.8 : 0.45, 0, aw);
        break;
      }
      case 'heal': {
        // lifesteal / omnivamp (a self-heal in the tick of its own damage) is not voiced; one target's heals merge
        if (e.src === e.dst && this.dealt.get(e.src as number) === e.t) break;
        const now = this.ctx?.currentTime ?? 0;
        if (dst && now - (this.healLast.get(dst.id) ?? -1e9) < HEAL_MERGE_S) break;
        if (this.cue(this.ev('heal'), at(dst), 0.7, 0, aw) === 'played' && dst) this.healLast.set(dst.id, now);
        break;
      }
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
          this.cue(this.kit(dst, 'death') ?? this.ev('fighterDeath'), at(dst));
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
      // the world sound where it fell; the announcer line comes from the 'announce' that follows (one line per event)
      case 'structure': this.cue(this.ev('structureFall'), at(this.ent(e.id))); break;
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
      case 'announce': this.onAnnounce(e); break;
      case 'eliminated': if (e.player === this.client?.you) this.announce('eliminated', 1, 1, 'you', e.t as number); break;
      case 'suddenDeath': this.announce('suddenDeath', 0, 1, 'flow', e.t as number); break;
      default: break;
    }
  }

  /** an 'announce' event → at most one announcer line (see `announcer` in the header). Line roles: 'announce.first',
   *  'announce.multi.<n>' (2-5), 'announce.shutdown', 'announce.structure.<own|foe>' (WHOSE structure fell: own = your
   *  loss), 'announce.objective[.<unit>].<own|foe>' (WHO took it: own = your gain), 'announce.wipe.<own|foe>' (whose team
   *  is down), 'announce.surrender_vote' / '…_failed', 'announce.structure_respawned', 'announce.eliminated', else
   *  'announce.<key>'; an unbound line falls back to announceMajor / announceMinor */
  private onAnnounce(e: Record<string, unknown>): void {
    const key = e.key as string;
    const t = e.t as number;
    const mine = this.myTeam();
    const you = this.client?.you;
    const pl = e.player as number | undefined;
    const p = (e.params ?? {}) as Record<string, unknown>;
    switch (key) {
      // a personal refusal is a UI error, not the announcer's
      case 'shop_denied': if (pl === you) this.cue(this.ev('shopDenied'), null); break;
      case 'practice_reset': case 'practice': if (pl === undefined || pl === you) this.announce('announce.practice', 5, 1, 'practice', t, 'announceMinor'); break;
      // a team's own business (a surrender vote, its outcome) is only that team's to hear
      case 'surrender_vote': if (e.team === mine) this.announce('announce.surrender_vote', 4, 1, 'vote', t, 'announceMinor'); break;
      case 'surrender_failed': if (e.team === mine) this.announce('announce.surrender_failed', 4, 2, 'vote', t, 'announceMinor'); break;
      // these have their own sound: the end sting, matchStart at time 0, the suddenDeath event
      case 'surrender_passed': case 'match_start': case 'sudden_death': break;
      case 'first_blood': this.announce('announce.first', 2, 6, `kill:${pl}`, t, 'announceMajor'); break;
      case 'multikill': {
        const n = Math.max(2, Math.min(5, Math.round(Number(p.n) || 2)));
        this.announce(`announce.multi.${n}`, 2, 10 + n, `kill:${pl}`, t, 'announceMajor');
        break;
      }
      case 'shutdown': this.announce('announce.shutdown', 2, 5, `kill:${pl}`, t, 'announceMinor'); break;
      case 'structure_destroyed': this.announce(`announce.structure.${e.team === mine ? 'own' : 'foe'}`, 3, 5, `obj:${t}`, t, 'announceMajor'); break;
      case 'objective_taken': {
        const side = e.team === mine ? 'own' : 'foe';
        const named = `announce.objective.${String(p.unit ?? '')}.${side}`;
        this.announce(this.ev(named) ? named : `announce.objective.${side}`, 3, 4, `obj:${t}`, t, 'announceMajor');
        break;
      }
      case 'structure_respawned': this.announce('announce.structure_respawned', 4, 1, `resp:${t}`, t, 'announceMinor'); break;
      case 'eliminated': if (pl !== you) this.announce('announce.eliminated', 4, 1, `elim:${pl}`, t, 'announceMinor'); break;
      default: this.announce(`announce.${key}`, 5, 1, key, t, 'announceMinor');
    }
  }

  /** every fighter of `team` down at once (a team of two or more): the wipe line, once until one of them is back */
  private wipeCheck(team: number, t: number): void {
    const v = this.client?.view;
    if (!v || this.wiped.has(team)) return;
    const ps = v.players.filter((p) => p.team === team);
    if (ps.length < 2 || !ps.every((p) => p.respawnIn > 0 || !(v.entity(p.entity)?.alive ?? false))) return;
    this.wiped.add(team);
    this.announce(`announce.wipe.${team === this.myTeam() ? 'own' : 'foe'}`, 1, 20, 'wipe', t);
  }

  /** combat intensity → the bed's combat layer (bar-quantised enter/leave, tokens.audio.beds.match) */
  private update(dt: number): void {
    const view = this.client?.view;
    if (view && this.lastT !== null) {
      const t0 = this.lastT, t1 = view.time;
      for (const s of [-3, -2, -1]) if (t0 < s && t1 >= s) this.announce('countdown', 0, 1, 'flow', s);
      if (t0 < 0 && t1 >= 0) this.announce('matchStart', 0, 2, 'flow', 0);
      if (this.annQ.length) this.pumpAnn();
    }
    this.lastT = view ? view.time : null;
    this.intensity = Math.max(0, this.intensity - dt * 0.12);
    this.fight = Math.max(0, this.fight - dt * FIGHT_DECAY);
    this.syncAmbience();
    const b = this.bed;
    if (!b || !this.ctx) return;
    // phases nobody drives walk themselves (see `music` in the header)
    const phases = b.layers.filter((l) => l.role === 'phase');
    if (!this.phaseDriven && phases.length && b.t0 !== null) {
      const at = this.ctx.currentTime - b.t0;
      const auto = at >= AUTO_PHASE_S[1] ? phases[phases.length - 1].id.slice('phase_'.length)
        : at >= AUTO_PHASE_S[0] ? phases[0].id.slice('phase_'.length) : null;
      if (auto !== this.phase) { this.phase = auto; this.bedRoles(); }
    }
    if (!b.layers.some((l) => l.role === 'combat')) return;
    if (!this.combat && this.intensity > 0.6) { this.combat = true; this.calmFor = 0; }
    else if (this.combat) {
      this.calmFor = this.intensity < 0.35 ? this.calmFor + dt : 0;
      if (this.calmFor > 8) this.combat = false;
    }
    this.bedRoles();
  }
}

/** the points of one art.ambient group (see `ambience` in the header): an effect by its vfx id, a critter by its
 *  id, a prop by its fx's vfx id or its model's file name (without .glb, and without the content build's
 *  content-address prefix: content's assets/props/ambient/bunting.glb ships as assets/<hash>-bunting.glb) */
function ambientPoints(art: AmbientLike | undefined, source: string): { x: number; y: number }[] {
  const at: number[][] = [];
  for (const e of art?.effects ?? []) if (e.vfx === source) at.push(...e.at);
  for (const c of art?.critters ?? []) if (c.id === source) at.push(...c.spots);
  for (const p of art?.props ?? []) {
    const file = p.model.slice(p.model.lastIndexOf('/') + 1).replace(/\.glb$/, '').replace(/^[0-9a-f]{12}-/, '');
    if (p.fx?.vfx === source || file === source) at.push(...p.at);
  }
  return at.filter((a) => Number.isFinite(a[0]) && Number.isFinite(a[1])).map((a) => ({ x: a[0], y: a[1] }));
}

/** the soft clip after the limiter (see `buses` in the header): linear to CLIP_KNEE, then a tanh knee that never
 *  passes CLIP_CEIL (−1 dBFS); odd-symmetric, 4097 points over −1..1 */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const room = CLIP_CEIL - CLIP_KNEE;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= CLIP_KNEE ? a : CLIP_KNEE + room * Math.tanh((a - CLIP_KNEE) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
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
