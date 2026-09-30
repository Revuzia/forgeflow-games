// HIT PARADE - the audio router (CONTRACT s9): SimEvents + snapshots -> sound commands. Adapted from dyefield
// audio/router.ts. THREE-free, DOM-free and deterministic (its own seeded PRNG, its own clock advanced by the caller),
// so _harness/probe_audio.ts drives it with a real node match and checks what it asks for. engine.ts only executes the
// commands: one-shots, keyed loops (the crowd beds), music cues, ducks.
//
// Mixing model: every sprite sound carries its measured level (manifest ldb); its base gain levels it to its category
// target (CAT_TARGET_DB), then the event scales it. A fighting game is heard from the broadcast position: sounds are
// panned by the fighter's x against the midpoint (StereoPanner), never 3D. Priorities decide who wins when the voice
// limit bites (announcer > KO/super > hits > crowd > foley).
//
// Every EV type is listed in EVENT_SOUNDS (a mapped type over `keyof typeof EV`, so a new EV type fails typecheck until
// it is handled here). Round flow (intro / FIGHT / round end / match end) plays from the events when the sim emits them
// and from MatchSnap.phase transitions otherwise - guarded per round so it never plays twice.

import { EV, SC } from '../core/sim/events.ts';
import { mulberry32 } from '../core/rng.ts';
import type { FighterSnap, MatchSnap, SimEvent } from '../core/types.ts';
import { MUSIC, SFX, type MusicCueId, type SfxCategory, type SfxId } from './manifest.ts';
import type { AnnounceLine, AudioBout, Splatter } from './types.ts';

export type Bus = 'sfx' | 'ui' | 'voice' | 'crowd';

export interface PlayCmd {
  id: SfxId;
  /** linear gain (base level x event scale) */
  gain: number;
  rate: number;
  /** -1 left .. +1 right (StereoPanner); 0 = centre */
  pan: number;
  /** voice priority (0 lowest .. 10 announcer) */
  pri: number;
  bus: Bus;
  /** index into the sound's variants */
  variant: number;
  /** seconds from now (sequenced lines: bell, then the announcer) */
  delay: number;
}

export interface LoopCmd { id: SfxId; gain: number; rate: number; bus: Bus }

export type MusicCmd = { t: 'play'; cue: MusicCueId; fade: number } | { t: 'stop'; fade: number };

export interface AudioSink {
  play(c: PlayCmd): void;
  /** start / update a keyed loop; null stops it */
  loop(key: string, c: LoopCmd | null): void;
  music(c: MusicCmd): void;
  /** duck to `music` / `sfx` (0..1) for `seconds`, then recover */
  duck(seconds: number, music: number, sfx: number): void;
}

// ---------------------------------------------------------------------------------------------------------------- levels
/**
 * Perceived-level targets per category (dBFS RMS of the loudest 400 ms, before the buses). Music is mastered to
 * -15.5..-17 LUFS and its bus defaults to 0.55, so hits sit above it, the announcer on top, beds under everything.
 */
export const CAT_TARGET_DB: { readonly [K in SfxCategory]: number } = {
  ann: -14, bed: -30, bell: -17, block: -19, body: -17, crowd: -21, foley: -28, hit: -16, impact: -18, layer: -20,
  splat: -21, sting: -18, super: -14, ui: -22, voice: -20, whiff: -24,
};

export function baseGain(id: SfxId): number {
  const e = SFX[id];
  return Math.min(4, Math.pow(10, (CAT_TARGET_DB[e.cat] - e.ldb) / 20));
}

// ------------------------------------------------------------------------------------------------- fighters / vocabulary
type Bank = 'm1' | 'm2' | 'm3' | 'f1' | 'f2' | 'mon';
type VoiceKind = 'atk' | 'hurt' | 'ko';
const VO: { readonly [B in Bank]: { readonly [K in VoiceKind]: SfxId } } = {
  m1: { atk: 'vo_m1_atk', hurt: 'vo_m1_hurt', ko: 'vo_m1_ko' },
  m2: { atk: 'vo_m2_atk', hurt: 'vo_m2_hurt', ko: 'vo_m2_ko' },
  m3: { atk: 'vo_m3_atk', hurt: 'vo_m3_hurt', ko: 'vo_m3_ko' },
  f1: { atk: 'vo_f1_atk', hurt: 'vo_f1_hurt', ko: 'vo_f1_ko' },
  f2: { atk: 'vo_f2_atk', hurt: 'vo_f2_hurt', ko: 'vo_f2_ko' },
  mon: { atk: 'vo_mon_atk', hurt: 'vo_mon_hurt', ko: 'vo_mon_ko' },
};
/** roster (CONTRACT s5.4) -> voice bank + playback rate (bigger bodies lower). Unknown ids use m1. */
export const FIGHTER_VOICE: Readonly<Record<string, { bank: Bank; rate: number }>> = {
  johnny: { bank: 'm1', rate: 1.0 }, patch: { bank: 'f1', rate: 1.0 }, bruno: { bank: 'm3', rate: 0.86 },
  zambini: { bank: 'm2', rate: 1.06 }, krane: { bank: 'm3', rate: 1.0 }, lotus: { bank: 'f2', rate: 1.0 },
  boneyard: { bank: 'm2', rate: 0.88 }, spin: { bank: 'm1', rate: 1.1 }, gazza: { bank: 'm2', rate: 1.0 },
  rerun: { bank: 'mon', rate: 1.14 }, freak: { bank: 'mon', rate: 0.9 }, ricky: { bank: 'm1', rate: 0.94 },
};
/** projectile spawn sound per fighter (a brick, cards, the ball, the taser, the host's pyro) */
export const PROJ_BY_FIGHTER: Readonly<Record<string, SfxId>> = {
  johnny: 'proj_throw', zambini: 'proj_card', gazza: 'proj_ball', krane: 'proj_zap', ricky: 'proj_fire', freak: 'proj_throw',
};

type CueTarget = SfxId | 'voice:atk' | 'voice:hurt' | 'voice:ko';
/**
 * SFX_CUE vocabulary (move data `sfx: [[frame, name]]`, CONTRACT s5.2 / s19.8): the audio research role names
 * (_research/audio/AUDIO_KIT.md, what the fighter generator uses) + every sprite id by its own name + a few verbs.
 * `voice:*` = the acting fighter's voice bank.
 */
export const SFX_CUE_ALIASES: Readonly<Record<string, CueTarget>> = {
  punch_light: 'hit_l', punch_heavy: 'hit_h', kick: 'hit_m', body_blow_thud: 'hit_m', bone_crunch: 'hit_pun', slap: 'slap',
  whoosh_light: 'whiff_l', whoosh_heavy: 'whiff_h', whoosh: 'whiff_m', grab_cloth: 'throw_grab', body_fall: 'knockdown',
  wall_slam: 'wall_splat', wet_splat: 'splat', glass_break: 'glass_break', metal_pipe_clang: 'clang', wooden_bat_crack: 'wood_crack',
  electric_zap: 'proj_zap', fire_whoosh: 'proj_fire', explosion: 'explosion', air_horn: 'horn', bell_ding: 'bell_round',
  drum_roll: 'host_pos', rimshot: 'taunt', cash_register: 'score', buzzer: 'buzzer', jingle_sting: 'host_pos',
  commercial_break_sting: 'host_neg', crowd_cheer_burst: 'crowd_cheer', crowd_cheer_loop: 'crowd_roar', crowd_boo: 'crowd_boo',
  crowd_gasp_ooh: 'crowd_ooh', crowd_applause: 'crowd_applause', crowd_laugh: 'crowd_laugh', voice_host_lines: 'host_laugh',
  voice_fighter_barks: 'voice:atk', voice_efforts: 'voice:atk', kiai: 'voice:atk', grunt: 'voice:hurt', scream: 'voice:ko',
  laugh: 'host_laugh', whistle: 'taunt', card_throw: 'proj_card', ball_kick: 'proj_ball', zap: 'proj_zap', stomp: 'ground_bounce',
  step_heavy: 'knockdown', clang: 'clang', chop: 'wood_crack', smash: 'glass_break',
};

export function resolveCue(name: string): CueTarget | null {
  const a = SFX_CUE_ALIASES[name];
  if (a) return a;
  return Object.prototype.hasOwnProperty.call(SFX, name) ? (name as SfxId) : null;
}

const UI_ALIASES: Readonly<Record<string, SfxId>> = {
  move: 'ui_move', hover: 'ui_move', confirm: 'ui_confirm', select: 'ui_confirm', click: 'ui_confirm', back: 'ui_back',
  cancel: 'ui_back', error: 'ui_error', deny: 'ui_error', toggle: 'ui_toggle', start: 'ui_start', lock: 'ui_lock', vs: 'ui_vs',
  pause: 'ui_pause', resume: 'ui_resume', tick: 'ui_tick', cash: 'ui_cash', unlock: 'ui_unlock', ladder: 'ui_ladder',
};
const ANNOUNCE: Readonly<Record<AnnounceLine, SfxId>> = {
  '3': 'ann_3', '2': 'ann_2', '1': 'ann_1', go: 'ann_go', ready: 'ann_ready', fight: 'ann_fight', bonus: 'ann_bonus', begin: 'ann_begin',
  gameover: 'ann_gameover', victory: 'ann_victory', win: 'ann_win', lose: 'ann_lose',
};
const SPLAT_BY_MODE: { readonly [K in Splatter]: SfxId } = { splatter: 'splat', sparks: 'sparks', confetti: 'confetti' };
/** combo tiers the announcer calls (FighterSnap.combo crossing each threshold, once per combo) */
const COMBO_TIERS: ReadonlyArray<readonly [number, SfxId]> = [
  [4, 'ann_combo_quad'], [6, 'ann_combo_super'], [8, 'ann_combo_mega'], [10, 'ann_combo_ultra'], [13, 'ann_combo_monster'],
];

// ------------------------------------------------------------------------------------------------------ the event map
export interface EventSoundSpec { readonly ids: readonly CueTarget[]; readonly note: string }
/** every EV type -> the sounds it can play (typecheck forces every key of EV to be present) */
export const EVENT_SOUNDS: { readonly [K in keyof typeof EV]: EventSoundSpec } = {
  ROUND_INTRO: { ids: ['bell_round', 'ann_ready', 'crowd_cheer'], note: 'bell, Dee-Dee "Get ready."; the stage music starts if none plays (also from phase intro)' },
  FIGHT: { ids: ['ann_fight', 'horn', 'crowd_cheer'], note: '"Fight!" + air-horn stand-in + cheer (also from phase fight)' },
  HIT: { ids: ['hit_l', 'hit_m', 'hit_h', 'hit_sp', 'throw_slam', 'splat', 'sparks', 'confetti', 'voice:hurt', 'voice:atk'], note: 'by strength class c; throws land their slam here (c = THROW); splatter on heavies by the gore setting; victim grunts on M+' },
  BLOCK: { ids: ['block_l', 'block_h'], note: 'L/M/projectile light guard, H/special/super/IMPACT heavy guard' },
  PARRY: { ids: ['parry'], note: 'metal cling + pad' },
  PERFECT_PARRY: { ids: ['parry_perfect', 'crowd_ooh', 'host_pos'], note: 'sting + crowd ooh + host brass (the freeze)' },
  THROW: { ids: ['throw_grab', 'hit_pun'], note: 'the grab (the slam is the HIT c=THROW); punish-counter throws add the punish layer' },
  THROW_TECH: { ids: ['throw_tech', 'crowd_claps'], note: 'hands slap apart + quick claps' },
  WHIFF: { ids: ['whiff_l', 'whiff_m', 'whiff_h', 'voice:atk'], note: 'by weight (c); heavies may kiai' },
  COUNTER: { ids: ['hit_ctr'], note: 'bright crack layer over the hit' },
  PUNISH: { ids: ['hit_pun', 'crowd_ooh'], note: 'crunch + low boom layer; the crowd reacts to a heavy punish' },
  KNOCKDOWN: { ids: ['knockdown'], note: 'body fall at the victim' },
  WAKEUP: { ids: ['wakeup'], note: 'cloth rustle (quiet)' },
  WALL_SPLAT: { ids: ['wall_splat', 'splat', 'sparks', 'confetti', 'crowd_ooh'], note: 'brick + thud + comic splatter by the gore setting + crowd' },
  GROUND_BOUNCE: { ids: ['ground_bounce', 'crowd_ouch'], note: 'thud + brick + a tiny spring; the crowd winces' },
  CRUMPLE: { ids: ['crumple', 'dizzy', 'crowd_ouch'], note: 'slow fold + cartoon wobble + crowd "ouch"' },
  PROJ_SPAWN: { ids: ['proj_throw', 'proj_card', 'proj_ball', 'proj_zap', 'proj_fire'], note: 'per owner fighter (PROJ_BY_FIGHTER)' },
  PROJ_HIT: { ids: ['proj_hit'], note: 'layer over the HIT / BLOCK the sim emits with it' },
  PROJ_CLASH: { ids: ['proj_clash'], note: 'once per clash (the sim emits one event per projectile)' },
  IMPACT_START: { ids: ['impact_start'], note: 'charge-up + deep whoosh' },
  IMPACT_ARMOR: { ids: ['impact_armor'], note: 'metal + pad on each armoured hit' },
  IMPACT_CLASH: { ids: ['impact_clash', 'crowd_ooh'], note: 'big metallic bang' },
  SHOVE: { ids: ['shove'], note: 'breath whoosh + pad' },
  SUPER_FREEZE: { ids: ['super_freeze', 'voice:atk'], note: 'brass stab + reverse zap; the fighter shouts; Lv3 ducks the music' },
  SUPER_HIT: { ids: ['super_hit'], note: 'explosive layer over the HIT' },
  CINEMATIC_START: { ids: ['host_fanfare', 'crowd_roar'], note: 'PRIME TIME: host fanfare + crowd roar, music ducked for the cinematic' },
  CINEMATIC_END: { ids: ['crowd_applause'], note: 'applause as the cinematic ends' },
  STAGE_FRIGHT_ON: { ids: ['stage_fright', 'crowd_boo', 'crowd_laugh'], note: 'brass "wah" + ringing; the crowd boos or laughs' },
  STAGE_FRIGHT_OFF: { ids: [], note: 'deliberately silent (the meter refilling is the cue)' },
  KO: { ids: ['ko_hit', 'bell_ko', 'crowd_roar', 'voice:ko'], note: 'KO blow + triple bell + roar + the loser\'s KO voice; music ducked' },
  TIMEOVER: { ids: ['buzzer', 'ann_timeup'], note: 'game-show buzzer + "Time\'s up."' },
  ROUND_END: { ids: ['crowd_applause', 'ann_wow', 'host_fanfare'], note: 'applause; a perfect round (winner at full HP) gets "WOAH!" + fanfare (no PERFECT line exists)' },
  MATCH_END: { ids: ['bell_end', 'ann_win', 'ann_lose', 'ann_victory', 'crowd_roar'], note: 'bell + YOU WIN / YOU LOSE for the local player (VICTORY in local 2P); the stage music fades' },
  METER_BAR: { ids: ['meter_bar', 'meter_full', 'crowd_cheer'], note: 'a SHOWTIME bar filled; the third bar gets the fanfare + cheer' },
  TAUNT: { ids: ['taunt', 'host_laugh', 'roar', 'crowd_laugh', 'crowd_boo'], note: 'whistle (THE FREAK roars, RICKY laughs) + crowd' },
  CAMERA_CUE: { ids: [], note: 'deliberately silent: each cue already sounds through its own event' },
  SFX_CUE: { ids: ['whiff_l', 'whiff_h', 'proj_fire', 'throw_grab', 'slap', 'crowd_cheer'], note: 'move-authored cue: Match.tab.sfx[b] resolved through SFX_CUE_ALIASES' },
  GOON_SPAWN: { ids: ['crowd_ooh'], note: 'BRAWL BREAK: a goon steps in (rate limited)' },
  GOON_DOWN: { ids: ['goon_down', 'crowd_cheer'], note: 'BRAWL BREAK: body fall + cheer' },
  HECKLE_THROW: { ids: ['heckle_throw', 'heckle_smash'], note: 'HECKLER TOSS: the throw (the smash follows when it lands)' },
  SCORE: { ids: ['score'], note: 'bonus-round points (rate limited)' },
};

/** sounds driven by state or the API rather than an event */
export const STATE_SOUNDS: ReadonlyArray<{ readonly ids: readonly SfxId[]; readonly note: string }> = [
  { ids: ['bed_low', 'bed_high', 'bed_stomp'], note: 'crowd beds: intensity = SHOWTIME (both fighters) + recent excitement' },
  { ids: ['ann_combo_quad', 'ann_combo_super', 'ann_combo_mega', 'ann_combo_ultra', 'ann_combo_monster'], note: 'combo calls from FighterSnap.combo' },
  { ids: ['ui_move', 'ui_confirm', 'ui_back', 'ui_error', 'ui_toggle', 'ui_start', 'ui_lock', 'ui_vs', 'ui_pause', 'ui_resume', 'ui_tick', 'ui_cash', 'ui_unlock', 'ui_ladder'], note: 'GameAudio.ui()' },
  { ids: ['ann_1', 'ann_2', 'ann_3', 'ann_go', 'ann_bonus', 'ann_begin', 'ann_gameover', 'ann_ohyeah'], note: 'GameAudio.announce() (online start sync, bonus rounds); ohyeah = a big comeback / Lv3 finish' },
  { ids: ['clang', 'wood_crack', 'glass_break', 'explosion'], note: 'move-authored SFX_CUE only (weapons, bottles, pyro)' },
];

// ------------------------------------------------------------------------------------------------------------ router
const DEDUPE_KEEP = 240;             // frames of (frame,type,a,b) keys kept

export class AudioRouter {
  /** router clock (s): advanced by update(dt), frozen while paused */
  t = 0;
  paused = false;
  bout: AudioBout | null = null;
  splatter: Splatter = 'splatter';
  /** plays per sound id, events per EV name, culls per reason (stats + the probe) */
  readonly counts: Record<string, number> = {};
  readonly events: Record<string, number> = {};
  readonly culled: Record<string, number> = {};
  readonly loopStarts: Record<string, number> = {};
  readonly unknown: string[] = [];
  cue: MusicCueId | null = null;
  /** crowd intensity 0..1 */
  crowd = 0;
  private readonly rnd: () => number;
  private readonly evNames: Record<number, keyof typeof EV>;
  private readonly lastVariant: Record<string, number> = {};
  private readonly seen = new Map<string, number>();
  private readonly lastVoice = [-1e9, -1e9];
  private lastClashT = -1e9;
  private readonly comboTier = [0, 0];
  private lastCrowdT = -1e9;
  private lastCrowdPri = 0;
  private lastSplatT = -1e9;
  private lastScoreT = -1e9;
  private lastGoonT = -1e9;
  private annBusyUntil = 0;
  private annPri = 0;
  private excite = 0;
  private showtime = 0;
  private phase = '';
  private round = 0;
  private introRound = 0;
  private fightRound = 0;
  private endRound = 0;
  private matchEnded = false;
  private winner = -1;
  private fighters: readonly [FighterSnap, FighterSnap] | null = null;
  private readonly active = new Set<string>();

  constructor(seed: number = 0x4a17) {
    this.rnd = mulberry32(seed);
    const names = {} as Record<number, keyof typeof EV>;
    for (const k of Object.keys(EV) as (keyof typeof EV)[]) names[EV[k]] = k;
    this.evNames = names;
  }

  // ---------------------------------------------------------------------------------------------------- API side
  setBout(b: AudioBout | null, sink: AudioSink): void {
    this.bout = b;
    this.resetBout();
    if (!b) this.stopBeds(sink);
  }

  /** resolve a music(cue) request (aliases, 'stage', 'results') and send it; returns the manifest cue or null */
  music(req: string | null, sink: AudioSink): MusicCueId | null {
    const cue = req === null ? null : this.resolveMusic(req);
    if (req !== null && cue === null) { this.note(`music:${req}`); return null; }
    if (cue === null) { this.cue = null; sink.music({ t: 'stop', fade: 0.8 }); return null; }
    if (cue === this.cue && MUSIC[cue].loop) return cue;
    this.cue = cue;
    sink.music({ t: 'play', cue, fade: MUSIC[cue].loop ? 0.6 : 0.05 });
    if (!MUSIC[cue].loop) sink.duck(0.1, 1, 1);
    return cue;
  }

  resolveMusic(req0: string): MusicCueId | null {
    const b = this.bout;
    // data/stages.json `music` ids (CONTRACT s21): 'music_stage_<stageId>' / 'music_<cue>' name the same cues
    const req = req0.startsWith('music_stage_') ? req0.slice(12) : req0.startsWith('music_') ? req0.slice(6) : req0;
    switch (req) {
      case 'title': return 'menu';
      case 'charselect': case 'vs': case 'ladder': return 'select';
      case 'stage': return this.stageCue();
      case 'results': case 'ending': {
        const local = b?.local ?? -1;
        return local >= 0 && this.winner >= 0 && local !== this.winner ? 'lose' : 'win';
      }
      default: return Object.prototype.hasOwnProperty.call(MUSIC, req) ? (req as MusicCueId) : null;
    }
  }

  stageCue(): MusicCueId {
    const b = this.bout;
    if (!b) return 'rust_theater';
    if (b.fighters[0] === 'ricky' || b.fighters[1] === 'ricky') return 'boss';
    if (b.fighters[0] === 'freak' || b.fighters[1] === 'freak') return 'miniboss';
    return Object.prototype.hasOwnProperty.call(MUSIC, b.stage) && MUSIC[b.stage as MusicCueId].loop ? (b.stage as MusicCueId) : 'rust_theater';
  }

  ui(cue: string, sink: AudioSink): void {
    const id = UI_ALIASES[cue];
    if (!id) { this.note(`ui:${cue}`); this.play(sink, 'ui_move', 1, 1, 0, 9, 'ui'); return; }
    this.play(sink, id, 1, cue === 'move' || cue === 'hover' ? this.jit(0.03) : 1, 0, 9, 'ui');
  }

  announce(line: AnnounceLine, sink: AudioSink): void {
    const id = ANNOUNCE[line];
    if (id) this.say(sink, id, 0, 10);
  }

  setPaused(p: boolean): void { this.paused = p; }

  // ------------------------------------------------------------------------------------------------------- events
  onEvents(events: readonly SimEvent[], m: MatchSnap, f: readonly [FighterSnap, FighterSnap] | undefined, sink: AudioSink): void {
    if (f) this.fighters = f;
    this.watchPhase(m, sink);
    if (this.paused) return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const key = `${e.frame}|${e.type}|${e.a}|${e.b}`;
      if (this.seen.has(key)) { this.cull('dedupe'); continue; }
      this.seen.set(key, e.frame);
      this.handle(e, m, sink);
    }
    if (this.seen.size > 512) for (const [k, fr] of this.seen) if (fr < m.frame - DEDUPE_KEEP) this.seen.delete(k);
    if (f) this.combos(f, sink);
  }

  private handle(e: SimEvent, m: MatchSnap, sink: AudioSink): void {
    const name = this.evNames[e.type];
    if (!name) { this.note(`ev:${e.type}`); return; }
    this.events[name] = (this.events[name] ?? 0) + 1;
    switch (name) {
      case 'ROUND_INTRO': this.roundIntro(m, sink); break;
      case 'FIGHT': this.fight(m, sink); break;
      case 'HIT': this.hit(e, sink); break;
      case 'BLOCK': {
        const heavy = e.c === SC.H || e.c === SC.SPECIAL || e.c === SC.SUPER || e.c === SC.IMPACT;
        this.play(sink, heavy ? 'block_h' : 'block_l', 1, this.jit(0.05), this.pan(e.b), 5);
        this.excite += 0.02;
        break;
      }
      case 'PARRY': this.play(sink, 'parry', 1, this.jit(0.04), this.pan(e.b), 6); this.excite += 0.05; break;
      case 'PERFECT_PARRY':
        this.play(sink, 'parry_perfect', 1, 1, this.pan(e.b), 8);
        this.crowdShot(sink, 'crowd_ooh', 6, 0.12);
        this.play(sink, 'host_pos', 0.8, 1, 0, 6, 'sfx', 0.45);
        sink.duck(0.9, 0.5, 1);
        this.excite += 0.35;
        break;
      case 'THROW':
        this.play(sink, 'throw_grab', 1, this.jit(0.04), this.pan(e.b), 6);
        if (e.c === 1) this.play(sink, 'hit_pun', 0.8, 1, this.pan(e.b), 6, 'sfx', 0.05);
        this.excite += 0.06;
        break;
      case 'THROW_TECH':
        this.play(sink, 'throw_tech', 1, this.jit(0.04), 0, 6);
        this.crowdShot(sink, 'crowd_claps', 3, 0.05);
        break;
      case 'WHIFF': {
        const id: SfxId = e.c === SC.L || e.c === SC.THROW ? 'whiff_l' : e.c === SC.M ? 'whiff_m' : 'whiff_h';
        this.play(sink, id, 1, this.jit(0.06), this.pan(e.a), 3);
        if (e.c >= SC.H && e.c !== SC.PROJECTILE && e.c !== SC.THROW) this.voice(sink, e.a, 'atk', 0.45);
        break;
      }
      case 'COUNTER': this.play(sink, 'hit_ctr', 0.9, this.jit(0.04), this.pan(e.b), 7); this.excite += 0.05; break;
      case 'PUNISH':
        this.play(sink, 'hit_pun', 0.9, this.jit(0.03), this.pan(e.b), 7);
        if (e.c >= SC.H) this.crowdShot(sink, 'crowd_ooh', 5, 0.1);
        this.excite += 0.1;
        break;
      case 'KNOCKDOWN': this.play(sink, 'knockdown', 1, this.jit(0.05), this.pan(e.a), 5); break;
      case 'WAKEUP': this.play(sink, 'wakeup', 0.8, this.jit(0.06), this.pan(e.a), 1); break;
      case 'WALL_SPLAT':
        this.play(sink, 'wall_splat', 1, this.jit(0.04), this.pan(e.a), 8);
        this.splat(sink, this.pan(e.a), true);
        this.crowdShot(sink, 'crowd_ooh', 6, 0.08);
        sink.duck(0.25, 0.6, 1);
        this.excite += 0.25;
        break;
      case 'GROUND_BOUNCE':
        this.play(sink, 'ground_bounce', 1, this.jit(0.04), this.pan(e.a), 6);
        this.crowdShot(sink, 'crowd_ouch', 3, 0.12);
        this.excite += 0.08;
        break;
      case 'CRUMPLE':
        this.play(sink, 'crumple', 1, 1, this.pan(e.a), 6);
        this.play(sink, 'dizzy', 0.8, 1, this.pan(e.a), 4, 'sfx', 0.3);
        this.crowdShot(sink, 'crowd_ouch', 5, 0.2);
        this.excite += 0.2;
        break;
      case 'PROJ_SPAWN': {
        const who = this.bout?.fighters[e.a] ?? '';
        this.play(sink, PROJ_BY_FIGHTER[who] ?? 'proj_throw', 1, this.jit(0.04), this.pan(e.a), 4);
        break;
      }
      case 'PROJ_HIT': this.play(sink, 'proj_hit', 0.8, this.jit(0.05), this.pan(e.b), 4); break;
      case 'PROJ_CLASH':
        if (this.t - this.lastClashT < 0.03) { this.cull('proj_clash:pair'); break; }
        this.lastClashT = this.t;
        this.play(sink, 'proj_clash', 1, this.jit(0.03), 0, 5);
        break;
      case 'IMPACT_START': this.play(sink, 'impact_start', 1, 1, this.pan(e.a), 6); break;
      case 'IMPACT_ARMOR': this.play(sink, 'impact_armor', 1, this.jit(0.04), this.pan(e.a), 7); this.excite += 0.06; break;
      case 'IMPACT_CLASH':
        this.play(sink, 'impact_clash', 1, 1, 0, 8);
        this.crowdShot(sink, 'crowd_ooh', 6, 0.1);
        this.excite += 0.2;
        break;
      case 'SHOVE': this.play(sink, 'shove', 1, this.jit(0.04), this.pan(e.a), 5); break;
      case 'SUPER_FREEZE':
        this.play(sink, 'super_freeze', 1, 1, this.pan(e.a), 9);
        this.voice(sink, e.a, 'atk', 1, 1.2);
        sink.duck(e.b >= 3 ? 1.2 : 0.6, e.b >= 3 ? 0.35 : 0.6, 1);
        this.excite += e.b >= 3 ? 0.3 : 0.15;
        break;
      case 'SUPER_HIT': this.play(sink, 'super_hit', 1, this.jit(0.03), this.pan(e.b), 9); this.excite += 0.15; break;
      case 'CINEMATIC_START':
        this.play(sink, 'host_fanfare', 1, 1, 0, 8);
        this.crowdShot(sink, 'crowd_roar', 9, 0.1);
        sink.duck(2.5, 0.45, 1);
        this.excite += 0.4;
        break;
      case 'CINEMATIC_END': this.crowdShot(sink, 'crowd_applause', 6, 0.05); break;
      case 'STAGE_FRIGHT_ON':
        this.play(sink, 'stage_fright', 1, 1, this.pan(e.a), 7);
        this.crowdShot(sink, this.rnd() < 0.5 ? 'crowd_boo' : 'crowd_laugh', 5, 0.4);
        break;
      case 'STAGE_FRIGHT_OFF': this.cull('stage_fright_off:silent'); break;
      case 'KO': this.ko(e, sink); break;
      case 'TIMEOVER':
        this.play(sink, 'buzzer', 1, 1, 0, 9);
        this.say(sink, 'ann_timeup', 0.55, 10);
        sink.duck(1.6, 0.4, 1);
        this.winner = e.a >= 0 && e.a <= 1 ? e.a : this.winner;
        break;
      case 'ROUND_END': this.roundEnd(m, sink); break;
      case 'MATCH_END': this.matchEnd(m, sink); break;
      case 'METER_BAR':
        if (e.b >= 3) {
          this.play(sink, 'meter_full', 0.9, 1, this.pan(e.a), 6);
          this.crowdShot(sink, 'crowd_cheer', 4, 0.2);
        } else this.play(sink, 'meter_bar', 0.9, 1 + 0.06 * Math.max(0, e.b - 1), this.pan(e.a), 5);
        break;
      case 'TAUNT': {
        const who = this.bout?.fighters[e.a] ?? '';
        if (who === 'freak') this.play(sink, 'roar', 1, 1, this.pan(e.a), 7);
        else if (who === 'ricky') this.play(sink, 'host_laugh', 1, 1, this.pan(e.a), 7);
        else this.play(sink, 'taunt', 1, 1, this.pan(e.a), 6);
        this.crowdShot(sink, this.rnd() < 0.5 ? 'crowd_laugh' : 'crowd_boo', 4, 0.35);
        break;
      }
      case 'CAMERA_CUE': this.cull('camera_cue:silent'); break;
      case 'SFX_CUE': this.sfxCue(e, sink); break;
      case 'GOON_SPAWN':
        if (this.t - this.lastGoonT < 2.5) { this.cull('goon_spawn:gap'); break; }
        this.lastGoonT = this.t;
        this.crowdShot(sink, 'crowd_ooh', 3, 0.1);
        break;
      case 'GOON_DOWN':
        this.play(sink, 'goon_down', 1, this.jit(0.05), this.pan(e.a), 5);
        this.crowdShot(sink, 'crowd_cheer', 3, 0.15);
        this.excite += 0.1;
        break;
      case 'HECKLE_THROW': this.play(sink, 'heckle_throw', 1, this.jit(0.06), 0, 4); break;
      case 'SCORE':
        if (this.t - this.lastScoreT < 0.12) { this.cull('score:gap'); break; }
        this.lastScoreT = this.t;
        this.play(sink, 'score', 0.8, 1, 0, 4, 'ui');
        break;
      default: {
        const never: never = name;
        void never;
      }
    }
  }

  private hit(e: SimEvent, sink: AudioSink): void {
    const pan = this.pan(e.b);
    const sc = e.c;
    if (sc === SC.THROW) {
      this.play(sink, 'throw_slam', 1, this.jit(0.03), pan, 8);
      this.voice(sink, e.b, 'hurt', 0.9);
      this.excite += 0.08;
      return;
    }
    const id: SfxId = sc === SC.L ? 'hit_l' : sc === SC.M || sc === SC.PROJECTILE ? 'hit_m' : sc === SC.H ? 'hit_h' : 'hit_sp';
    const gain = sc === SC.SUPER ? 0.8 : 1;             // SUPER_HIT adds its own explosive layer
    this.play(sink, id, gain, this.jit(0.05), pan, sc >= SC.H ? 8 : 7);
    if (sc >= SC.H && sc !== SC.PROJECTILE) {
      sink.duck(0.15, 0.6, 1);                          // research: duck music 3-6 dB for 150 ms on heavies
      this.splat(sink, pan, false);
      this.voice(sink, e.a, 'atk', sc >= SC.SPECIAL ? 0.5 : 0.3);
    }
    if (sc >= SC.M) this.voice(sink, e.b, 'hurt', sc >= SC.H ? 0.75 : 0.4, 1, 0.04);
    this.excite += sc === SC.L ? 0.03 : sc === SC.M ? 0.05 : sc === SC.H ? 0.09 : 0.12;
  }

  private ko(e: SimEvent, sink: AudioSink): void {
    const loser = e.b;
    this.play(sink, 'ko_hit', 1, 1, loser >= 0 ? this.pan(loser) : 0, 10);
    this.play(sink, 'bell_ko', 1, 1, 0, 9, 'sfx', 0.35);
    if (loser >= 0) this.voice(sink, loser, 'ko', 1, 1, 0.08);
    else { this.voice(sink, 0, 'ko', 1, 1, 0.08); this.voice(sink, 1, 'ko', 1, 1, 0.12); }
    this.crowdShot(sink, 'crowd_roar', 10, 0.25);
    this.splat(sink, loser >= 0 ? this.pan(loser) : 0, true);
    sink.duck(2.4, 0.3, 1);
    this.excite += 0.6;
    if (e.a >= 0 && e.a <= 1) this.winner = e.a;
  }

  private sfxCue(e: SimEvent, sink: AudioSink): void {
    const names = this.bout?.sfxNames;
    const nm = names && e.b >= 0 && e.b < names.length ? names[e.b] : null;
    if (!nm) { this.note(`sfx_cue#${e.b}`); return; }
    const target = resolveCue(nm);
    if (!target) { this.note(`sfx:${nm}`); return; }
    if (target === 'voice:atk' || target === 'voice:hurt' || target === 'voice:ko') {
      this.voice(sink, e.a, target === 'voice:atk' ? 'atk' : target === 'voice:hurt' ? 'hurt' : 'ko', 1);
      return;
    }
    if (SFX[target].cat === 'crowd') { this.crowdShot(sink, target, 4, 0); return; }
    this.play(sink, target, 0.9, this.jit(0.05), this.pan(e.a), 4);
  }

  // ------------------------------------------------------------------------------------------------- round flow
  private watchPhase(m: MatchSnap, sink: AudioSink): void {
    if (m.round !== this.round) { this.round = m.round; this.comboTier[0] = this.comboTier[1] = 0; }
    if (m.phase !== this.phase) {
      const prev = this.phase;
      this.phase = m.phase;
      if (this.paused) return;
      if (m.phase === 'intro') this.roundIntro(m, sink);
      else if (m.phase === 'fight' && (prev === 'intro' || prev === '')) this.fight(m, sink);
      else if (m.phase === 'roundEnd') this.roundEnd(m, sink);
      else if (m.phase === 'matchEnd') this.matchEnd(m, sink);
    }
  }

  private roundIntro(m: MatchSnap, sink: AudioSink): void {
    if (this.introRound === m.round) return;
    this.introRound = m.round;
    if (m.round <= 1) { this.matchEnded = false; this.winner = -1; this.endRound = 0; this.fightRound = 0; }
    if (this.bout && (this.cue === null || !MUSIC[this.cue].loop)) this.music('stage', sink);
    this.play(sink, 'bell_round', 1, 1, 0, 9);
    this.say(sink, 'ann_ready', 0.7, 10);
    this.crowdShot(sink, 'crowd_cheer', 4, 0.1);
  }

  private fight(m: MatchSnap, sink: AudioSink): void {
    if (this.fightRound === m.round) return;
    this.fightRound = m.round;
    this.say(sink, 'ann_fight', 0, 10);
    this.play(sink, 'horn', 0.8, 1, 0, 8, 'sfx', 0.05);
    this.crowdShot(sink, 'crowd_cheer', 7, 0.15);
    this.excite += 0.2;
  }

  private roundEnd(m: MatchSnap, sink: AudioSink): void {
    if (this.endRound === m.round) return;
    this.endRound = m.round;
    const w = m.roundWinner;
    const f = this.fighters;
    const perfect = f !== null && (w === 0 || w === 1) && f[w].hp >= f[w].hpMax;
    if (perfect) {
      this.say(sink, 'ann_wow', 0.3, 10);
      this.play(sink, 'host_fanfare', 0.9, 1, 0, 7, 'sfx', 0.5);
    }
    this.crowdShot(sink, 'crowd_applause', 6, 0.2);
  }

  private matchEnd(m: MatchSnap, sink: AudioSink): void {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.winner = m.winner;
    const local = this.bout?.local ?? -1;
    this.play(sink, 'bell_end', 1, 1, 0, 9, 'sfx', 0.2);
    let line: SfxId = 'ann_victory';
    if (m.draw || m.winner < 0) line = 'ann_gameover';
    else if (local === 0 || local === 1) line = local === m.winner ? 'ann_win' : 'ann_lose';
    this.say(sink, line, 0.9, 10);
    this.crowdShot(sink, 'crowd_roar', 8, 0.4);
    this.cue = null;
    sink.music({ t: 'stop', fade: 1.5 });
  }

  private combos(f: readonly [FighterSnap, FighterSnap], sink: AudioSink): void {
    for (let i = 0; i < 2; i++) {
      const n = f[i].combo | 0;
      if (n <= 1) { this.comboTier[i] = 0; continue; }
      let tier = 0;
      for (let k = 0; k < COMBO_TIERS.length; k++) if (n >= COMBO_TIERS[k][0]) tier = k + 1;
      if (tier > this.comboTier[i]) {
        this.comboTier[i] = tier;
        this.say(sink, COMBO_TIERS[tier - 1][1], 0.1, 7);
        if (tier >= 3) this.crowdShot(sink, 'crowd_cheer', 5, 0.3);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- state loops
  /** every rendered frame (dt in seconds, 0 while paused): crowd beds + excitement decay */
  update(dt: number, sink: AudioSink): void {
    if (this.paused) return;
    const step = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    this.t += step;
    this.excite = Math.min(1.5, this.excite) * Math.exp(-step / 3);
    const f = this.fighters;
    if (f) this.showtime = Math.max(f[0].showtime, f[1].showtime) / 30000;
    const target = Math.max(0, Math.min(1, 0.12 + 0.55 * Math.min(1, this.showtime) + 0.45 * Math.min(1, this.excite)));
    this.crowd += (target - this.crowd) * Math.min(1, step * 2.5);
    if (!this.bout) return;
    const I = this.crowd;
    this.want(sink, 'bed_low', { id: 'bed_low', gain: baseGain('bed_low') * (1 - 0.55 * I), rate: 1, bus: 'crowd' });
    this.want(sink, 'bed_high', { id: 'bed_high', gain: baseGain('bed_high') * Math.pow(0.15 + 0.85 * I, 1.2), rate: 1, bus: 'crowd' });
    // stomp-stomp-clap at peak ratings, with hysteresis (starts above 0.82, stops below 0.7) so it never flaps
    const stomping = this.active.has('bed_stomp');
    if (I > 0.82 || (stomping && I > 0.7)) this.want(sink, 'bed_stomp', { id: 'bed_stomp', gain: baseGain('bed_stomp') * Math.min(1, Math.max(0.05, (I - 0.7) / 0.3)), rate: 1, bus: 'crowd' });
    else if (stomping) { sink.loop('bed_stomp', null); this.active.delete('bed_stomp'); }
  }

  // --------------------------------------------------------------------------------------------------- internals
  private resetBout(): void {
    this.phase = '';
    this.round = 0;
    this.introRound = this.fightRound = this.endRound = 0;
    this.matchEnded = false;
    this.winner = -1;
    this.excite = 0;
    this.comboTier[0] = this.comboTier[1] = 0;
    this.seen.clear();
    this.fighters = null;
  }

  private stopBeds(sink: AudioSink): void {
    for (const k of [...this.active]) { sink.loop(k, null); this.active.delete(k); }
  }

  private want(sink: AudioSink, key: string, c: LoopCmd): void {
    if (!this.active.has(key)) { this.loopStarts[c.id] = (this.loopStarts[c.id] ?? 0) + 1; this.active.add(key); }
    sink.loop(key, c);
  }

  /** a fighter's voice line (per-fighter gap, probability p) */
  private voice(sink: AudioSink, who: number, kind: VoiceKind, p: number, gainMul = 1, delay = 0): void {
    if (who < 0 || who > 1) return;
    const gap = kind === 'ko' ? 0 : 0.38;
    if (this.t - this.lastVoice[who] < gap) { this.cull(`voice:${kind}:gap`); return; }
    if (p < 1 && this.rnd() >= p) { this.cull(`voice:${kind}:chance`); return; }
    this.lastVoice[who] = this.t;
    const v = FIGHTER_VOICE[this.bout?.fighters[who] ?? ''] ?? { bank: 'm1' as Bank, rate: 1 };
    this.play(sink, VO[v.bank][kind], gainMul, v.rate * this.jit(0.03), this.pan(who), kind === 'ko' ? 9 : 5, 'voice', delay);
  }

  /** the announcer: one line at a time; a new line waits for the current one (dropped if it would wait > 1 s) */
  private say(sink: AudioSink, id: SfxId, delay: number, pri: number): void {
    let at = this.t + delay;
    if (at < this.annBusyUntil) {
      if (pri < this.annPri && this.annBusyUntil - at > 1.0) { this.cull(`${id}:busy`); return; }
      at = this.annBusyUntil + 0.05;
    }
    const len = SFX[id].v[0][1];
    this.annBusyUntil = at + len;
    this.annPri = pri;
    this.play(sink, id, 1, 1, 0, pri, 'voice', at - this.t);
  }

  /** a crowd reaction one-shot (one at a time: min gap 1.1 s unless it outranks the last one) */
  private crowdShot(sink: AudioSink, id: SfxId, pri: number, delay: number): void {
    if (this.t - this.lastCrowdT < 1.1 && pri <= this.lastCrowdPri) { this.cull(`${id}:crowd-gap`); return; }
    this.lastCrowdT = this.t;
    this.lastCrowdPri = pri;
    this.play(sink, id, 0.6 + 0.4 * Math.min(1, 0.5 + this.crowd), this.jit(0.03), 0, Math.min(8, pri), 'crowd', delay);
  }

  /** the comic splatter layer (the gore setting picks splatter / sparks / confetti) */
  private splat(sink: AudioSink, pan: number, big: boolean): void {
    if (this.t - this.lastSplatT < 0.12) { this.cull('splat:gap'); return; }
    if (!big && this.rnd() >= 0.5) { this.cull('splat:chance'); return; }
    this.lastSplatT = this.t;
    this.play(sink, SPLAT_BY_MODE[this.splatter], big ? 1 : 0.75, this.jit(0.08), pan, 3, 'sfx', 0.01);
  }

  private pan(i: number): number {
    const f = this.fighters;
    if (!f || i < 0 || i > 1) return 0;
    const mid = (f[0].x + f[1].x) / 2;
    return Math.max(-0.6, Math.min(0.6, (f[i].x - mid) * 0.18));
  }

  private play(sink: AudioSink, id: SfxId, gainMul: number, rate: number, pan: number, pri: number, bus: Bus = 'sfx', delay = 0): void {
    const n = SFX[id].v.length;
    let v = 0;
    if (n > 1) {
      v = Math.floor(this.rnd() * n) % n;
      if (v === this.lastVariant[id]) v = (v + 1) % n;
      this.lastVariant[id] = v;
    }
    sink.play({ id, gain: baseGain(id) * gainMul, rate, pan, pri, bus, variant: v, delay: Math.max(0, delay) });
    this.counts[id] = (this.counts[id] ?? 0) + 1;
  }

  private cull(reason: string): void {
    this.culled[reason] = (this.culled[reason] ?? 0) + 1;
  }

  private note(what: string): void {
    if (this.unknown.length < 64 && !this.unknown.includes(what)) this.unknown.push(what);
  }

  private jit(j: number): number {
    return 1 + (this.rnd() * 2 - 1) * j;
  }
}
