// HIT PARADE - the audio router (CONTRACT s9, s9.1, s9.2): SimEvents + snapshots -> sound commands. Adapted from dyefield
// audio/router.ts. THREE-free, DOM-free and deterministic (its own seeded PRNG, its own clock advanced by the caller),
// so _harness/probe_audio.ts drives it with a real node match and checks what it asks for. engine.ts only executes the
// commands: one-shots, keyed loops (the crowd beds, the stage ambience), music cues, ducks.
//
// Mixing model: every sprite sound carries its measured level (manifest ldb); its base gain levels it to its category
// target (CAT_TARGET_DB), then the event scales it. A fighting game is heard from the broadcast position: sounds are
// panned by the fighter's x against the midpoint (StereoPanner), never 3D. Priorities decide who wins when the voice
// limit bites (announcer > KO/super > hits > crowd > foley).
//
// Every EV type is listed in EVENT_SOUNDS (a mapped type over `keyof typeof EV`, so a new EV type fails typecheck until
// it is handled here); the SIM P2 extra types (EVX, CONTRACT s28.3) in EXTRA_EVENT_SOUNDS the same way. Round flow
// (intro / FIGHT / round end / match end) plays from the events when the sim emits them and from MatchSnap.phase
// transitions otherwise - guarded per round so it never plays twice.
//
// P2 (CONTRACT s9.2): the bout context (boutContext(): the fighters' move tables + the stage's music / ambient from
// GameData) makes the routing move-aware: projectiles by `projectile.clip` (wind-up / release / impact), weapon layers by
// the attacker's move, PRIME TIME beats by `cinematic.cue`; bonus rounds (goons 8 + slot, crowd objects 2) per s28.4.

import { EV, EVX, SC } from '../core/sim/events.ts';
import { mulberry32 } from '../core/rng.ts';
import type { FighterSnap, MatchSnap, SimEvent } from '../core/types.ts';
import { MUSIC, SFX, type MusicCueId, type SfxCategory, type SfxId } from './manifest.ts';
import type { AnnounceLine, AudioBout, AudioGameData, AudioMoveData, Splatter } from './types.ts';

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
 * -15.5..-17 LUFS and its bus defaults to 0.55, so hits sit above it, the announcer on top, beds and the stage ambience
 * under everything.
 */
export const CAT_TARGET_DB: { readonly [K in SfxCategory]: number } = {
  amb: -35, ann: -14, bed: -30, bell: -17, block: -19, body: -17, crowd: -21, foley: -28, hit: -16, impact: -18, layer: -20,
  splat: -21, sting: -18, super: -14, ui: -22, voice: -20, whiff: -24,
};

export function baseGain(id: SfxId): number {
  const e = SFX[id];
  return Math.min(4, Math.pow(10, (CAT_TARGET_DB[e.cat] - e.ldb) / 20));
}

// ------------------------------------------------------------------------------------------------- fighters / vocabulary
type Bank = 'm1' | 'm2' | 'm3' | 'f1' | 'f2' | 'mon' | 'goon';
type VoiceKind = 'atk' | 'hurt' | 'ko';
const VO: { readonly [B in Bank]: { readonly [K in VoiceKind]: SfxId } } = {
  m1: { atk: 'vo_m1_atk', hurt: 'vo_m1_hurt', ko: 'vo_m1_ko' },
  m2: { atk: 'vo_m2_atk', hurt: 'vo_m2_hurt', ko: 'vo_m2_ko' },
  m3: { atk: 'vo_m3_atk', hurt: 'vo_m3_hurt', ko: 'vo_m3_ko' },
  f1: { atk: 'vo_f1_atk', hurt: 'vo_f1_hurt', ko: 'vo_f1_ko' },
  f2: { atk: 'vo_f2_atk', hurt: 'vo_f2_hurt', ko: 'vo_f2_ko' },
  mon: { atk: 'vo_mon_atk', hurt: 'vo_mon_hurt', ko: 'vo_mon_ko' },
  goon: { atk: 'vo_goon_atk', hurt: 'vo_goon_hurt', ko: 'vo_goon_down' },
};
/** roster (CONTRACT s5.4) -> voice bank + playback rate (bigger bodies lower). Unknown ids use m1. */
export const FIGHTER_VOICE: Readonly<Record<string, { bank: Bank; rate: number }>> = {
  johnny: { bank: 'm1', rate: 1.0 }, patch: { bank: 'f1', rate: 1.0 }, bruno: { bank: 'm3', rate: 0.86 },
  zambini: { bank: 'm2', rate: 1.06 }, krane: { bank: 'm3', rate: 1.0 }, lotus: { bank: 'f2', rate: 1.0 },
  boneyard: { bank: 'm2', rate: 0.88 }, spin: { bank: 'm1', rate: 1.1 }, gazza: { bank: 'm2', rate: 1.0 },
  rerun: { bank: 'mon', rate: 1.14 }, freak: { bank: 'mon', rate: 0.9 }, ricky: { bank: 'm1', rate: 0.94 },
};
/** BRAWL BREAK goon kinds -> pitch of the shared goon bank. Keys = the final goon ids (CONTRACT s32.1, the GLB stems SIM
 *  mirrors into system.json brawl.kinds). Any other id (e.g. a pre-rename system.json) is pitched by its kind index, so
 *  routing never depends on an id spelling: index 0 hardhat (big), 1 security (heaviest), 2 medic (lightest). */
export const GOON_VOICE_RATE: Readonly<Record<string, number>> = { goon_hardhat: 0.96, goon_security: 0.84, goon_medic: 1.14 };
const GOON_RATE_BY_INDEX = [0.96, 0.84, 1.14];
/** the goon bank pitch for a kind id / kind index (named id first, else by index; never undefined) */
export function goonVoiceRate(id: string | undefined, kindIdx: number): number {
  return (id !== undefined ? GOON_VOICE_RATE[id] : undefined) ?? GOON_RATE_BY_INDEX[((kindIdx % 3) + 3) % 3] ?? 1;
}
/** projectile spawn sound per fighter when the move table is unknown (fallback of PROJ_SOUNDS) */
export const PROJ_BY_FIGHTER: Readonly<Record<string, SfxId>> = {
  johnny: 'proj_throw', zambini: 'proj_card', gazza: 'proj_ball', krane: 'proj_zap', ricky: 'proj_fire', lotus: 'proj_flame_breath',
};

/**
 * Projectiles by `projectile.clip` (data/fighters/<id>.json; CONTRACT s9.2.3): wind-up = a frame-0 SFX_CUE with a projectile
 * verb on that move, spawn = PROJ_SPAWN (the release), hit = PROJ_HIT (the object's impact, on hit and on block).
 */
export const PROJ_SOUNDS: Readonly<Record<string, { readonly wind: SfxId | null; readonly spawn: SfxId; readonly hit: SfxId }>> = {
  brick: { wind: null, spawn: 'proj_throw', hit: 'brick_smash' },
  card: { wind: 'card_riffle', spawn: 'proj_card', hit: 'card_hit' },
  saw_card: { wind: 'card_riffle', spawn: 'proj_card_saw', hit: 'card_hit' },
  flame: { wind: 'flame_ignite', spawn: 'proj_flame', hit: 'flame_hit' },
  flame_breath: { wind: 'gourd_swig', spawn: 'proj_flame_breath', hit: 'flame_hit' },
  football: { wind: 'ball_bounce', spawn: 'proj_ball', hit: 'ball_hit' },
  fireball_football: { wind: 'ball_bounce', spawn: 'proj_ball_fire', hit: 'flame_hit' },
  taser_bolt: { wind: 'taser_charge', spawn: 'proj_zap', hit: 'taser_hit' },
  pyro_line: { wind: 'pyro_fuse', spawn: 'proj_pyro', hit: 'pyro_hit' },
  spotlight_beam: { wind: 'spot_on', spawn: 'proj_spot', hit: 'spot_hit' },
};
/** SFX_CUE targets that count as "a projectile verb" (the move's wind-up plays instead when the move has a projectile) */
const PROJ_VERB_TARGETS: ReadonlySet<string> = new Set(['proj_throw', 'proj_card', 'proj_ball', 'proj_zap', 'proj_fire', 'explosion', 'proj_flame']);

export type WeaponKind = 'cleaver' | 'baton' | 'shield' | 'cane';
/** weapon / prop per fighter: the first rule whose regex matches the move's `name` or id (supers are excluded) */
export const WEAPON_RULES: Readonly<Record<string, ReadonlyArray<readonly [RegExp, WeaponKind]>>> = {
  boneyard: [[/cleaver|tenderi|meat hook|meat_hook|three cuts/i, 'cleaver']],
  krane: [[/shield|backup|perp walk/i, 'shield'], [/baton|nightstick|poke|chop|swing|knee rap|book 'em|throw_f/i, 'baton']],
  ricky: [[/cane|showstopper|sledgehammer|hook|mic drop|mic_drop|air thrust|air chop|three-act/i, 'cane']],
};
export const WEAPON_SOUNDS: { readonly [K in WeaponKind]: SfxId } = { cleaver: 'wpn_cleaver', baton: 'wpn_baton', shield: 'wpn_shield', cane: 'wpn_cane' };

/** HECKLER TOSS objects (system.json heckler.objects[].id, CONTRACT s28.4) -> the landing sound */
export const HECKLE_OBJ_SOUNDS: Readonly<Record<string, SfxId>> = { tomato: 'splat_tomato', bottle: 'heckle_smash', shoe: 'heckle_thud', chair: 'chair_crash' };
const HECKLE_OBJ_ORDER = ['tomato', 'bottle', 'shoe', 'chair'];

/** stage id -> ambience loop (data/stages.json `ambient` wins when it names one of these; CONTRACT s9.2.2) */
export const AMBIENT_BY_STAGE: Readonly<Record<string, SfxId>> = {
  rust_theater: 'amb_rust_theater', butcher_block: 'amb_butcher_block', wheel_of_pain: 'amb_wheel_of_pain', rooftop: 'amb_rooftop',
  control_room: 'amb_control_room',
};
const AMBIENT_ALIASES: Readonly<Record<string, SfxId>> = { amb_theater_crowd: 'amb_rust_theater' };

/** a cinematic beat: [cinematic frame, sound, gain] */
export type CineBeat = readonly [number, SfxId, number];
/**
 * PRIME TIME beats per `cinematic.cue` (the beats of _spec/ROSTER.md "Lv3 PRIME TIME cinematic" blocks; the hits sound
 * through their own HIT events). The last authored hit frame also gets `cine_finish` (see cineFinish()).
 */
export const CINE_BEATS: Readonly<Record<string, readonly CineBeat[]>> = {
  johnny_main_event: [[34, 'crowd_ooh', 1], [114, 'whiff_h', 1], [140, 'crowd_roar', 1]],
  patch_on_air: [[0, 'cine_cut', 0.8], [102, 'whiff_h', 1], [146, 'tv_static', 0.7], [148, 'crowd_applause', 1]],
  bruno_final_delivery: [[40, 'whiff_h', 1], [56, 'whiff_h', 1], [100, 'vo_m3_atk', 1], [150, 'crowd_cheer', 1]],
  zambini_prestige: [[20, 'spot_on', 1], [40, 'magic_poof', 1], [60, 'proj_flame', 1], [100, 'trapdoor', 1], [104, 'magic_poof', 0.8], [135, 'magic_tada', 1]],
  krane_riot_act: [[0, 'wpn_shield', 1], [110, 'taser_charge', 1], [118, 'taser_hit', 1], [126, 'taser_hit', 0.7], [140, 'crowd_laugh', 1]],
  lotus_happy_hour: [[22, 'gourd_swig', 1], [30, 'dizzy', 0.8], [115, 'proj_flame_breath', 1], [140, 'crowd_laugh', 1]],
  boneyard_sunday_roast: [[60, 'wpn_cleaver', 0.8], [100, 'whiff_h', 1], [145, 'order_up', 1]],
  spin_battle: [[128, 'whiff_h', 1], [148, 'crowd_applause', 1]],
  gazza_hat_trick: [[90, 'ball_bounce', 0.8], [96, 'ball_bounce', 0.8], [102, 'ball_bounce', 0.8], [108, 'ball_bounce', 0.8], [112, 'proj_ball', 1],
    [148, 'horn', 1], [150, 'crowd_roar', 1]],
  rerun_series_finale: [[80, 'trapdoor', 1], [130, 'wood_crack', 1], [140, 'trapdoor', 0.7], [144, 'vo_mon_atk', 1]],
  freak_specimen_13: [[120, 'roar', 1], [122, 'light_flicker', 1], [152, 'crowd_ooh', 1]],
  ricky_prime_time: [[0, 'host_laugh', 1], [110, 'spot_on', 1], [150, 'host_fanfare', 0.9], [152, 'crowd_roar', 1]],
  ricky_season_finale: [[0, 'wpn_cane', 1], [4, 'pyro_hit', 1], [12, 'pyro_hit', 0.8], [96, 'spot_hit', 1], [100, 'light_flicker', 1], [120, 'host_laugh', 1],
    [142, 'clang', 1], [160, 'confetti', 1], [162, 'crowd_roar', 1]],
};

type CueTarget = SfxId | 'voice:atk' | 'voice:hurt' | 'voice:ko';
/**
 * SFX_CUE vocabulary (move data `sfx: [[frame, name]]`, CONTRACT s5.2 / s9.1 / s9.2.5 / s19.8): the audio research role
 * names (_research/audio/AUDIO_KIT.md, what the fighter generator uses) + every sprite id by its own name + verbs.
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
  // P2 (CONTRACT s9.2.5)
  brick_throw: 'proj_throw', brick_smash: 'brick_smash', card_fan: 'proj_card', card_riffle: 'card_riffle', card_whoosh: 'proj_card',
  card_saw: 'proj_card_saw', flame: 'proj_flame', flame_burst: 'flame_hit', fire_burst: 'flame_hit', flash_paper: 'flame_ignite',
  fire_breath: 'proj_flame_breath', swig: 'gourd_swig', gourd: 'gourd_swig', bottle: 'heckle_smash', bottle_smash: 'heckle_smash',
  taser: 'proj_zap', taser_zap: 'taser_hit', taser_charge: 'taser_charge', spotlight: 'proj_spot', spotlight_hum: 'proj_spot',
  spot_on: 'spot_on', pyro: 'proj_pyro', pyro_burst: 'pyro_hit', fuse: 'pyro_fuse', ball_bounce: 'ball_bounce', ball_hit: 'ball_hit',
  shield_bash: 'wpn_shield', shield: 'wpn_shield', cleaver: 'wpn_cleaver', cleaver_chop: 'wpn_cleaver', baton: 'wpn_baton',
  cane: 'wpn_cane', camera_flash: 'cine_cut', tv_static: 'tv_static', magic_poof: 'magic_poof', vanish: 'magic_poof',
  tada: 'magic_tada', trapdoor: 'trapdoor', lid_slam: 'wood_crack', light_flicker: 'light_flicker', thunder: 'amb_thunder',
};

export function resolveCue(name: string): CueTarget | null {
  const a = SFX_CUE_ALIASES[name];
  if (a) return a;
  return Object.prototype.hasOwnProperty.call(SFX, name) ? (name as SfxId) : null;
}

export const UI_ALIASES: Readonly<Record<string, SfxId>> = {
  move: 'ui_move', hover: 'ui_move', confirm: 'ui_confirm', select: 'ui_confirm', click: 'ui_confirm', back: 'ui_back',
  cancel: 'ui_back', error: 'ui_error', deny: 'ui_error', toggle: 'ui_toggle', start: 'ui_start', lock: 'ui_lock', vs: 'ui_vs',
  pause: 'ui_pause', resume: 'ui_resume', tick: 'ui_tick', cash: 'ui_cash', unlock: 'ui_unlock', ladder: 'ui_ladder',
  // P2 online lobby (CONTRACT s9.2.6)
  search: 'ui_search', searching: 'ui_search', found: 'ui_found', matchfound: 'ui_found', join: 'ui_join', joined: 'ui_join',
  leave: 'ui_leave', left: 'ui_leave', ready: 'ui_ready', opponentlocked: 'ui_ready', reveal: 'ui_reveal', code: 'ui_code',
  copy: 'ui_code', rematch: 'ui_rematch', disconnect: 'ui_disconnect', lost: 'ui_disconnect', countdown: 'ui_countdown',
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

// ------------------------------------------------------------------------------------------------------ bout context
/** what audio knows about one move (by moveId, CONTRACT s17 rule 1) */
export interface AudioMove { readonly id: string; readonly name: string; readonly kind: string; readonly proj: string | null;
  readonly weapon: WeaponKind | null; readonly cine: string | null; readonly cineHits: readonly number[] }
/** the per-bout lookups (boutContext() builds them from GameData; the probe builds them the same way) */
export interface BoutCtx {
  readonly moves: readonly [readonly AudioMove[], readonly AudioMove[]];
  /** the stage's stages.json `music` resolved to a loop cue, else null */
  readonly stageMusic: MusicCueId | null;
  /** the stage ambience loop, else null */
  readonly ambient: SfxId | null;
  /** HECKLER TOSS object ids by type index (system.json heckler.objects) */
  readonly heckleObjects: readonly string[];
  /** BRAWL BREAK goon ids by kind index (system.json brawl.kinds) */
  readonly goonKinds: readonly string[];
}

export function weaponFor(fighter: string, key: string, name: string, kind: string): WeaponKind | null {
  if (kind === 'super1' || kind === 'super3') return null;
  for (const [rx, w] of WEAPON_RULES[fighter] ?? []) if (rx.test(name) || rx.test(key)) return w;
  return null;
}

/** data/stages.json entry by id, read defensively (GameData types stages.json as Record<string, unknown>) */
function stageEntry(stages: unknown, id: string): { music?: string; ambient?: string } | null {
  const list = stages && typeof stages === 'object' ? (stages as { stages?: unknown }).stages : undefined;
  if (!Array.isArray(list)) return null;
  for (const s of list) {
    if (s && typeof s === 'object' && (s as { id?: unknown }).id === id) {
      const o = s as { music?: unknown; ambient?: unknown };
      return { music: typeof o.music === 'string' ? o.music : undefined, ambient: typeof o.ambient === 'string' ? o.ambient : undefined };
    }
  }
  return null;
}

export function audioMoves(fighter: string, moves: Record<string, AudioMoveData> | undefined): AudioMove[] {
  const out: AudioMove[] = [];
  if (!moves) return out;
  for (const key of Object.keys(moves)) {                 // JSON text order = moveId (CONTRACT s17 rule 1)
    const m = moves[key];
    const name = typeof m.name === 'string' ? m.name : key;
    const hits = (m.cinematic?.hits ?? []).map((h) => Number(h[0])).filter((f) => Number.isFinite(f));
    out.push({ id: key, name, kind: m.kind, proj: m.projectile?.clip ?? null, weapon: weaponFor(fighter, key, name, m.kind),
      cine: m.cinematic?.cue ?? null, cineHits: hits });
  }
  return out;
}

export function boutContext(b: AudioBout, data: AudioGameData | null | undefined): BoutCtx {
  const moves: [AudioMove[], AudioMove[]] = [audioMoves(b.fighters[0], data?.fighters[b.fighters[0]]?.moves),
    audioMoves(b.fighters[1], data?.fighters[b.fighters[1]]?.moves)];
  const st = stageEntry(data?.stages, b.stage);
  let stageMusic: MusicCueId | null = null;
  if (st?.music) {
    const req = st.music.startsWith('music_stage_') ? st.music.slice(12) : st.music.startsWith('music_') ? st.music.slice(6) : st.music;
    if (Object.prototype.hasOwnProperty.call(MUSIC, req) && MUSIC[req as MusicCueId].loop) stageMusic = req as MusicCueId;
  }
  let ambient: SfxId | null = null;
  const amb = st?.ambient;
  if (amb && AMBIENT_ALIASES[amb]) ambient = AMBIENT_ALIASES[amb];
  else if (amb && Object.prototype.hasOwnProperty.call(SFX, amb) && SFX[amb as SfxId].cat === 'amb' && SFX[amb as SfxId].loop) ambient = amb as SfxId;
  else ambient = AMBIENT_BY_STAGE[b.stage] ?? null;
  const heckleObjects = (data?.system?.heckler?.objects ?? []).map((o) => o.id);
  const goonKinds = (data?.system?.brawl?.kinds ?? []).map((k) => k.id);
  return { moves, stageMusic, ambient, heckleObjects: heckleObjects.length ? heckleObjects : HECKLE_OBJ_ORDER, goonKinds };
}

// ------------------------------------------------------------------------------------------------------ the event map
export interface EventSoundSpec { readonly ids: readonly CueTarget[]; readonly note: string }
/** every EV type -> the sounds it can play (typecheck forces every key of EV to be present) */
export const EVENT_SOUNDS: { readonly [K in keyof typeof EV]: EventSoundSpec } = {
  ROUND_INTRO: { ids: ['bell_round', 'ann_ready', 'ann_bonus', 'crowd_cheer'], note: 'bell, Dee-Dee "Get ready." ("BONUS" in bonus rounds); the stage music starts if none plays (also from phase intro)' },
  FIGHT: { ids: ['ann_fight', 'ann_begin', 'horn', 'crowd_cheer'], note: '"Fight!" ("BEGIN" in bonus rounds) + air-horn stand-in + cheer (also from phase fight)' },
  HIT: { ids: ['hit_l', 'hit_m', 'hit_h', 'hit_sp', 'throw_slam', 'splat', 'sparks', 'confetti', 'wpn_cleaver', 'wpn_baton', 'wpn_shield', 'wpn_cane',
    'goon_hit', 'splat_tomato', 'heckle_smash', 'heckle_thud', 'chair_crash', 'crowd_laugh', 'voice:hurt', 'voice:atk'],
  note: 'by strength class c; weapon layer from the attacker\'s move; throws land their slam here (c = THROW); splatter on heavies by the gore setting; goon victims (8+slot) squish + grunt; a crowd object (a = 2) lands its splat' },
  BLOCK: { ids: ['block_l', 'block_h', 'wpn_shield'], note: 'L/M/projectile light guard, H/special/super/IMPACT heavy guard; weapon layer; Krane standing guard = riot shield' },
  PARRY: { ids: ['parry', 'heckle_deflect'], note: 'metal cling + pad; a parried crowd object is batted away' },
  PERFECT_PARRY: { ids: ['parry_perfect', 'crowd_ooh', 'host_pos'], note: 'sting + crowd ooh + host brass (the freeze)' },
  THROW: { ids: ['throw_grab', 'hit_pun'], note: 'the grab (the slam is the HIT c=THROW); punish-counter throws add the punish layer' },
  THROW_TECH: { ids: ['throw_tech', 'crowd_claps'], note: 'hands slap apart + quick claps' },
  WHIFF: { ids: ['whiff_l', 'whiff_m', 'whiff_h', 'voice:atk'], note: 'by weight (c); heavies may kiai; goons bark' },
  COUNTER: { ids: ['hit_ctr'], note: 'bright crack layer over the hit' },
  PUNISH: { ids: ['hit_pun', 'crowd_ooh'], note: 'crunch + low boom layer; the crowd reacts to a heavy punish' },
  KNOCKDOWN: { ids: ['knockdown'], note: 'body fall at the victim' },
  WAKEUP: { ids: ['wakeup'], note: 'cloth rustle (quiet)' },
  WALL_SPLAT: { ids: ['wall_splat', 'splat', 'sparks', 'confetti', 'crowd_ooh'], note: 'brick + thud + comic splatter by the gore setting + crowd' },
  GROUND_BOUNCE: { ids: ['ground_bounce', 'crowd_ouch'], note: 'thud + brick + a tiny spring; the crowd winces' },
  CRUMPLE: { ids: ['crumple', 'dizzy', 'crowd_ouch'], note: 'slow fold + cartoon wobble + crowd "ouch"' },
  PROJ_SPAWN: { ids: ['proj_throw', 'proj_card', 'proj_card_saw', 'proj_flame', 'proj_flame_breath', 'proj_ball', 'proj_ball_fire', 'proj_zap', 'proj_pyro', 'proj_spot', 'proj_fire'],
    note: 'the release by the move\'s projectile.clip (PROJ_SOUNDS); PROJ_BY_FIGHTER without a move table' },
  PROJ_HIT: { ids: ['proj_hit', 'brick_smash', 'card_hit', 'flame_hit', 'ball_hit', 'taser_hit', 'pyro_hit', 'spot_hit'], note: 'the object\'s impact (on hit and block), layered over the HIT / BLOCK the sim emits with it' },
  PROJ_CLASH: { ids: ['proj_clash'], note: 'the clash once per pair + each object breaking (PROJ_SOUNDS hit, quieter)' },
  IMPACT_START: { ids: ['impact_start'], note: 'charge-up + deep whoosh' },
  IMPACT_ARMOR: { ids: ['impact_armor'], note: 'metal + pad on each armoured hit' },
  IMPACT_CLASH: { ids: ['impact_clash', 'crowd_ooh'], note: 'big metallic bang' },
  SHOVE: { ids: ['shove'], note: 'breath whoosh + pad' },
  SUPER_FREEZE: { ids: ['super_freeze', 'voice:atk'], note: 'brass stab + reverse zap; the fighter shouts; Lv3 ducks the music' },
  SUPER_HIT: { ids: ['super_hit'], note: 'explosive layer over the HIT' },
  CINEMATIC_START: { ids: ['cine_open', 'crowd_roar'], note: 'PRIME TIME: open stinger + crowd roar, music ducked for the cinematic; then the CINE_BEATS of its cue + cine_finish on the last authored hit' },
  CINEMATIC_END: { ids: ['cine_end', 'crowd_applause'], note: 'close stinger + applause as the cinematic ends' },
  STAGE_FRIGHT_ON: { ids: ['stage_fright', 'crowd_boo', 'crowd_laugh'], note: 'brass "wah" + ringing; the crowd boos or laughs' },
  STAGE_FRIGHT_OFF: { ids: [], note: 'deliberately silent (the meter refilling is the cue)' },
  KO: { ids: ['ko_hit', 'bell_ko', 'crowd_roar', 'voice:ko'], note: 'KO blow + triple bell + roar + the loser\'s KO voice; music ducked' },
  TIMEOVER: { ids: ['buzzer', 'ann_timeup'], note: 'game-show buzzer + "Time\'s up."' },
  ROUND_END: { ids: ['crowd_applause', 'ann_wow', 'host_fanfare'], note: 'applause; a perfect round (winner at full HP) gets "WOAH!" + fanfare (no PERFECT line exists)' },
  MATCH_END: { ids: ['bell_end', 'ann_win', 'ann_lose', 'ann_victory', 'ann_ohyeah', 'crowd_roar'], note: 'bell + YOU WIN / YOU LOSE for the local player (VICTORY in local 2P, "Oh yeah!" + fanfare after a bonus round); the stage music fades' },
  METER_BAR: { ids: ['meter_bar', 'meter_full', 'crowd_cheer'], note: 'a SHOWTIME bar filled; the third bar gets the fanfare + cheer' },
  TAUNT: { ids: ['taunt', 'host_laugh', 'roar', 'crowd_laugh', 'crowd_boo'], note: 'whistle (THE FREAK roars, RICKY laughs) + crowd' },
  CAMERA_CUE: { ids: [], note: 'deliberately silent: each cue already sounds through its own event' },
  SFX_CUE: { ids: ['whiff_l', 'whiff_h', 'proj_fire', 'throw_grab', 'slap', 'crowd_cheer', 'card_riffle', 'flame_ignite', 'gourd_swig', 'ball_bounce', 'taser_charge', 'pyro_fuse', 'spot_on'],
    note: 'move-authored cue: Match.tab.sfx[b] resolved through SFX_CUE_ALIASES; a projectile verb on a projectile move = that object\'s wind-up' },
  GOON_SPAWN: { ids: ['goon_spawn', 'vo_goon_taunt', 'crowd_ooh'], note: 'BRAWL BREAK: a stage-door bang where the goon steps in + a bark (rate limited)' },
  GOON_DOWN: { ids: ['goon_down', 'vo_goon_down', 'crowd_cheer'], note: 'BRAWL BREAK: body fall + groan + cheer' },
  HECKLE_THROW: { ids: ['heckle_throw', 'vo_heckle'], note: 'HECKLER TOSS: the throw + a shout from the stands (the landing sound is the object\'s)' },
  SCORE: { ids: ['score'], note: 'bonus-round points on a positive delta (rate limited; a combo cash-out louder)' },
};

/** the SIM P2 extra event types (EVX, CONTRACT s28.3) - typecheck forces every key of EVX to be present */
export const EXTRA_EVENT_SOUNDS: { readonly [K in keyof typeof EVX]: EventSoundSpec } = {
  CATCH: { ids: ['parry', 'tv_static', 'host_laugh', 'voice:atk', 'crowd_ooh'], note: 'a counter catches a hit: Ricky COMMERCIAL BREAK = TV static + laugh, Rerun PLAY DEAD = growl' },
  TELEPORT: { ids: ['trapdoor', 'magic_poof'], note: 'Zambini drops through the trapdoor and pops up at the new x' },
  PHASE: { ids: ['tv_static', 'host_laugh', 'crowd_roar'], note: 'Ricky phase 2: broadcast glitch + host laugh + roar, music ducked' },
  BALL: { ids: ['proj_ball', 'ball_bounce', 'ball_hit'], note: 'Gazza\'s ball: kick / wall rebound / rest / pickup / knocked away / respawn / hover / loose' },
  INSTALL: { ids: ['impact_start'], note: 'an install starts (charge-up)' },
};

/** sounds driven by state or the API rather than an event */
export const STATE_SOUNDS: ReadonlyArray<{ readonly ids: readonly SfxId[]; readonly note: string }> = [
  { ids: ['bed_low', 'bed_high', 'bed_stomp'], note: 'crowd beds: intensity = SHOWTIME (both fighters) + recent excitement' },
  { ids: [...Object.values(AMBIENT_BY_STAGE), 'amb_thunder'], note: 'stage ambience loop from bout() (thunder one-shots on the rooftop)' },
  { ids: ['ann_combo_quad', 'ann_combo_super', 'ann_combo_mega', 'ann_combo_ultra', 'ann_combo_monster'], note: 'combo calls from FighterSnap.combo' },
  { ids: [...new Set(Object.values(UI_ALIASES))], note: 'GameAudio.ui() (menus + the online lobby)' },
  { ids: ['ann_1', 'ann_2', 'ann_3', 'ann_go', 'ann_bonus', 'ann_begin', 'ann_gameover', 'ann_ohyeah'], note: 'GameAudio.announce() (online start sync, bonus rounds); ohyeah = a big comeback / Lv3 finish / bonus round end' },
  { ids: ['clang', 'wood_crack', 'glass_break', 'explosion'], note: 'move-authored SFX_CUE only (weapons, bottles, pyro)' },
  { ids: [...new Set(Object.values(PROJ_SOUNDS).flatMap((p) => (p.wind ? [p.wind, p.spawn, p.hit] : [p.spawn, p.hit])))], note: 'projectiles by clip (PROJ_SOUNDS)' },
  { ids: Object.values(WEAPON_SOUNDS), note: 'weapon / prop layers (WEAPON_RULES)' },
  { ids: Object.values(HECKLE_OBJ_SOUNDS), note: 'HECKLER TOSS object landings' },
  { ids: [...new Set(Object.values(CINE_BEATS).flatMap((b) => b.map((x) => x[1]))), 'cine_finish'], note: 'PRIME TIME beats (CINE_BEATS) + the finish stinger' },
];

// ------------------------------------------------------------------------------------------------------------ router
const DEDUPE_KEEP = 240;             // frames of (frame,type,a,b) keys kept
const GOON_BASE = 8;                 // CONTRACT s28.4: goon index = 8 + slot; 2 = a crowd object
const CROWD_OBJ = 2;

interface HeckleObj { type: string; t: number; resolved: boolean; seen: boolean; x: number }

export class AudioRouter {
  /** router clock (s): advanced by update(dt), frozen while paused */
  t = 0;
  paused = false;
  bout: AudioBout | null = null;
  ctx: BoutCtx | null = null;
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
  private readonly evxNames: Record<number, keyof typeof EVX>;
  private readonly lastVariant: Record<string, number> = {};
  private readonly seen = new Map<string, number>();
  private readonly lastVoice: Record<number, number> = {};
  private lastClashT = -1e9;
  private readonly comboTier = [0, 0];
  private lastCrowdT = -1e9;
  private lastCrowdPri = 0;
  private lastSplatT = -1e9;
  private lastScoreT = -1e9;
  private lastGoonT = -1e9;
  private lastHeckleVoT = -1e9;
  private readonly lastProjSnd = [-1e9, -1e9];
  private readonly projKind: [string | null, string | null] = [null, null];
  private readonly heckle = new Map<number, HeckleObj>();
  private readonly projHitKeys = new Set<string>();
  private cineKey = '';
  private cineLast = -1;
  private thunderAt = 0;
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
  private match: MatchSnap | null = null;
  private readonly active = new Set<string>();

  constructor(seed: number = 0x4a17) {
    this.rnd = mulberry32(seed);
    const names = {} as Record<number, keyof typeof EV>;
    for (const k of Object.keys(EV) as (keyof typeof EV)[]) names[EV[k]] = k;
    this.evNames = names;
    const xn = {} as Record<number, keyof typeof EVX>;
    for (const k of Object.keys(EVX) as (keyof typeof EVX)[]) xn[EVX[k]] = k;
    this.evxNames = xn;
  }

  // ---------------------------------------------------------------------------------------------------- API side
  /** the bout (null = left); ctx = boutContext(b, data) (index.ts builds it from loadGameData(); omitted = no move tables) */
  setBout(b: AudioBout | null, sink: AudioSink, ctx?: BoutCtx | null): void {
    this.bout = b;
    this.ctx = b ? (ctx ?? boutContext(b, null)) : null;
    this.resetBout();
    this.stopBeds(sink);
  }

  get bonus(): boolean {
    const m = this.bout?.mode;
    return m === 'brawl' || m === 'heckler';
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
      case 'bonus_brawl': return 'brawl';
      case 'bonus_heckler': return 'heckler';
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
    if (b.mode === 'brawl') return 'brawl';
    if (b.mode === 'heckler') return 'heckler';
    if (b.fighters[0] === 'ricky' || b.fighters[1] === 'ricky') return 'boss';
    if (b.fighters[0] === 'freak' || b.fighters[1] === 'freak') return 'miniboss';
    if (this.ctx?.stageMusic) return this.ctx.stageMusic;
    return Object.prototype.hasOwnProperty.call(MUSIC, b.stage) && MUSIC[b.stage as MusicCueId].loop ? (b.stage as MusicCueId) : 'rust_theater';
  }

  ui(cue: string, sink: AudioSink): void {
    const id = UI_ALIASES[cue] ?? UI_ALIASES[cue.toLowerCase()];
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
    this.match = m;
    this.watchPhase(m, sink);
    if (this.paused) return;
    // a projectile's HIT comes with a PROJ_HIT of the same (frame, a, b): no weapon layer from the thrower's current move
    this.projHitKeys.clear();
    for (let i = 0; i < events.length; i++) if (events[i].type === EV.PROJ_HIT) this.projHitKeys.add(`${events[i].frame}|${events[i].a}|${events[i].b}`);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const key = `${e.frame}|${e.type}|${e.a}|${e.b}`;
      if (this.seen.has(key)) { this.cull('dedupe'); continue; }
      this.seen.set(key, e.frame);
      this.handle(e, m, sink);
    }
    if (this.seen.size > 512) for (const [k, fr] of this.seen) if (fr < m.frame - DEDUPE_KEEP) this.seen.delete(k);
    if (f) this.combos(f, sink);
    this.cinematic(m, sink);
    this.heckleWatch(m, sink);
  }

  private handle(e: SimEvent, m: MatchSnap, sink: AudioSink): void {
    const name = this.evNames[e.type];
    if (!name) {
      const x = this.evxNames[e.type];
      if (x) { this.events[x] = (this.events[x] ?? 0) + 1; this.extra(x, e, sink); return; }
      this.note(`ev:${e.type}`);
      return;
    }
    this.events[name] = (this.events[name] ?? 0) + 1;
    switch (name) {
      case 'ROUND_INTRO': this.roundIntro(m, sink); break;
      case 'FIGHT': this.fight(m, sink); break;
      case 'HIT': this.hit(e, sink); break;
      case 'BLOCK': {
        const heavy = e.c === SC.H || e.c === SC.SPECIAL || e.c === SC.SUPER || e.c === SC.IMPACT;
        this.play(sink, heavy ? 'block_h' : 'block_l', 1, this.jit(0.05), this.pan(e.b), 5);
        if (e.a === CROWD_OBJ && this.bonus) { const o = this.resolveHeckle(); if (o) this.play(sink, HECKLE_OBJ_SOUNDS[o.type] ?? 'heckle_thud', 0.6, this.jit(0.05), this.pan(e.b), 5); break; }
        const w = e.c === SC.PROJECTILE ? null : this.weapon(e.a);
        if (w) this.play(sink, WEAPON_SOUNDS[w], 0.6, this.jit(0.04), this.pan(e.b), 5);
        if (this.fighterId(e.b) === 'krane' && !(this.fighters?.[e.b]?.crouching ?? false) && w !== 'shield') this.play(sink, 'wpn_shield', 0.5, this.jit(0.04), this.pan(e.b), 4);
        this.excite += 0.02;
        break;
      }
      case 'PARRY':
        this.play(sink, 'parry', 1, this.jit(0.04), this.pan(e.b), 6);
        if (e.a === CROWD_OBJ && this.bonus) { this.resolveHeckle(); this.play(sink, 'heckle_deflect', 1, this.jit(0.05), this.pan(e.b), 6); this.crowdShot(sink, 'crowd_cheer', 3, 0.1); }
        this.excite += 0.05;
        break;
      case 'PERFECT_PARRY':
        this.play(sink, 'parry_perfect', 1, 1, this.pan(e.b), 8);
        if (e.a === CROWD_OBJ && this.bonus) { this.resolveHeckle(); this.play(sink, 'heckle_deflect', 1, 1.05, this.pan(e.b), 7); }
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
        if (e.a >= GOON_BASE) this.voice(sink, e.a, 'atk', 0.35);
        else if (e.c >= SC.H && e.c !== SC.PROJECTILE && e.c !== SC.THROW) this.voice(sink, e.a, 'atk', 0.45);
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
      case 'PROJ_SPAWN': this.projSpawn(e, sink); break;
      case 'PROJ_HIT': {
        if (e.a === CROWD_OBJ && this.bonus) break;          // the object's landing plays from its HIT / BLOCK
        const k = e.a === 0 || e.a === 1 ? this.projKind[e.a] : null;
        const ps = k ? PROJ_SOUNDS[k] : undefined;
        if (ps) this.play(sink, ps.hit, e.c === SC.PROJECTILE ? 0.75 : 0.9, this.jit(0.05), this.pan(e.b), 6);
        else this.play(sink, 'proj_hit', 0.8, this.jit(0.05), this.pan(e.b), 4);
        break;
      }
      case 'PROJ_CLASH': {
        const mv = this.move(e.a, e.c);
        const ps = mv?.proj ? PROJ_SOUNDS[mv.proj] : undefined;
        if (this.t - this.lastClashT >= 0.03) {
          this.lastClashT = this.t;
          this.play(sink, 'proj_clash', 1, this.jit(0.03), 0, 5);
        } else this.cull('proj_clash:pair');
        if (ps) this.play(sink, ps.hit, 0.55, this.jit(0.05), this.pan(e.a), 4, 'sfx', 0.01);
        break;
      }
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
        this.play(sink, 'cine_open', 1, 1, 0, 8);
        this.crowdShot(sink, 'crowd_roar', 9, 0.1);
        sink.duck(2.5, 0.45, 1);
        this.excite += 0.4;
        break;
      case 'CINEMATIC_END':
        this.play(sink, 'cine_end', 0.9, 1, 0, 7);
        this.crowdShot(sink, 'crowd_applause', 6, 0.15);
        break;
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
        const who = this.fighterId(e.a);
        if (who === 'freak') this.play(sink, 'roar', 1, 1, this.pan(e.a), 7);
        else if (who === 'ricky') this.play(sink, 'host_laugh', 1, 1, this.pan(e.a), 7);
        else this.play(sink, 'taunt', 1, 1, this.pan(e.a), 6);
        this.crowdShot(sink, this.rnd() < 0.5 ? 'crowd_laugh' : 'crowd_boo', 4, 0.35);
        break;
      }
      case 'CAMERA_CUE': this.cull('camera_cue:silent'); break;
      case 'SFX_CUE': this.sfxCue(e, sink); break;
      case 'GOON_SPAWN': {
        const pan = this.panX(e.d / 100);
        this.play(sink, 'goon_spawn', 0.8, this.jit(0.05), pan, 4);
        if (this.t - this.lastGoonT < 2.5) { this.cull('goon_spawn:gap'); break; }
        this.lastGoonT = this.t;
        if (this.rnd() < 0.45) this.play(sink, 'vo_goon_taunt', 1, this.goonRate(e.b), pan, 5, 'voice', 0.12);
        this.crowdShot(sink, 'crowd_ooh', 3, 0.1);
        break;
      }
      case 'GOON_DOWN': {
        const pan = this.panX(e.d / 100);
        this.play(sink, 'goon_down', 1, this.jit(0.05), pan, 5);
        this.play(sink, 'vo_goon_down', 0.9, this.goonRate(e.b) * this.jit(0.03), pan, 5, 'voice', 0.03);
        this.crowdShot(sink, 'crowd_cheer', 3, 0.15);
        this.excite += 0.1;
        break;
      }
      case 'HECKLE_THROW': {
        const type = this.heckleType(e.b);
        this.heckle.set(e.a, { type, t: this.t, resolved: false, seen: false, x: e.c / 100 });
        this.play(sink, 'heckle_throw', 1, this.jit(0.06), this.panX(e.c / 100), 4);
        if (this.t - this.lastHeckleVoT > 3.0 && this.rnd() < 0.5) {       // ~1 throw/s: a shout every few throws, not each one
          this.lastHeckleVoT = this.t;
          this.play(sink, 'vo_heckle', 0.9, this.jit(0.05), this.panX(e.c / 100) * 0.8, 4, 'crowd', 0);
        }
        break;
      }
      case 'SCORE':
        if (e.b <= 0) { this.cull('score:not-positive'); break; }
        if (this.t - this.lastScoreT < 0.12) { this.cull('score:gap'); break; }
        this.lastScoreT = this.t;
        this.play(sink, 'score', e.d === 3 ? 1 : 0.7, e.d === 3 ? 1 : 1.04, 0, 4, 'ui');
        if (e.d === 3 && e.b >= 300) this.crowdShot(sink, 'crowd_cheer', 4, 0.1);
        break;
      default: {
        const never: never = name;
        void never;
      }
    }
  }

  /** the SIM P2 extra events (CONTRACT s28.3) */
  private extra(name: keyof typeof EVX, e: SimEvent, sink: AudioSink): void {
    switch (name) {
      case 'CATCH': {
        this.play(sink, 'parry', 0.8, 0.9, this.pan(e.a), 6);
        if (this.fighterId(e.a) === 'ricky') { this.play(sink, 'tv_static', 0.8, 1, this.pan(e.a), 6); this.play(sink, 'host_laugh', 1, 1, this.pan(e.a), 7, 'sfx', 0.25); }
        else this.voice(sink, e.a, 'atk', 1);
        this.crowdShot(sink, 'crowd_ooh', 5, 0.1);
        this.excite += 0.15;
        break;
      }
      case 'TELEPORT':
        this.play(sink, 'trapdoor', 0.8, this.jit(0.04), this.panX(e.b / 100), 5);
        this.play(sink, 'magic_poof', 1, this.jit(0.04), this.panX(e.c / 100), 6, 'sfx', 0.06);
        break;
      case 'PHASE':
        this.play(sink, 'tv_static', 1, 1, 0, 8);
        this.play(sink, 'host_laugh', 1, 0.94, this.pan(e.a), 8, 'sfx', 0.35);
        this.crowdShot(sink, 'crowd_roar', 8, 0.2);
        sink.duck(1.0, 0.4, 1);
        this.excite += 0.4;
        break;
      case 'BALL': {
        const pan = this.panX(e.c / 100);
        if (e.b === 0) {                                      // kick (a hover / resting ball re-kicked; a fresh kick also spawns)
          if (this.t - this.lastProjSnd[e.a === 1 ? 1 : 0] < 0.08) { this.cull('ball:kick-dup'); break; }
          this.lastProjSnd[e.a === 1 ? 1 : 0] = this.t;
          this.play(sink, 'proj_ball', 1, this.jit(0.04), pan, 5);
        } else if (e.b === 1) this.play(sink, 'ball_bounce', 1, this.jit(0.05), pan, 5);          // wall rebound
        else if (e.b === 4) { this.play(sink, 'ball_hit', 0.8, this.jit(0.05), pan, 5); this.crowdShot(sink, 'crowd_ooh', 3, 0.1); }  // knocked away
        else if (e.b === 5) this.play(sink, 'ball_bounce', 0.4, 1.1, pan, 2);                      // respawn at his feet
        else this.play(sink, 'ball_bounce', e.b === 6 ? 0.75 : 0.6, this.jit(0.06), pan, 3);      // rest / pickup / hover / loose
        break;
      }
      case 'INSTALL': this.play(sink, 'impact_start', 0.9, 1.1, this.pan(e.a), 6); break;
      default: {
        const never: never = name;
        void never;
      }
    }
  }

  private hit(e: SimEvent, sink: AudioSink): void {
    const pan = this.pan(e.b);
    const sc = e.c;
    if (e.a === CROWD_OBJ && this.bonus) {                   // HECKLER TOSS: an object hits the player
      const o = this.resolveHeckle();
      this.play(sink, o ? HECKLE_OBJ_SOUNDS[o.type] ?? 'splat_tomato' : 'splat_tomato', 1, this.jit(0.05), pan, 7);
      // the body takes it too: a light hit under a tomato, a medium one under a bottle / shoe / chair
      this.play(sink, !o || o.type === 'tomato' ? 'hit_l' : 'hit_m', !o || o.type === 'tomato' ? 0.45 : 0.7, this.jit(0.05), pan, 6);
      this.voice(sink, e.b, 'hurt', 0.8, 1, 0.04);
      this.crowdShot(sink, 'crowd_laugh', 4, 0.15);
      return;
    }
    if (sc === SC.THROW) {
      this.play(sink, 'throw_slam', 1, this.jit(0.03), pan, 8);
      const w = this.weapon(e.a);
      if (w) this.play(sink, WEAPON_SOUNDS[w], 0.8, this.jit(0.04), pan, 7);
      this.voice(sink, e.b, 'hurt', 0.9);
      this.excite += 0.08;
      return;
    }
    const id: SfxId = sc === SC.L ? 'hit_l' : sc === SC.M || sc === SC.PROJECTILE ? 'hit_m' : sc === SC.H ? 'hit_h' : 'hit_sp';
    const gain = sc === SC.SUPER ? 0.8 : 1;             // SUPER_HIT adds its own explosive layer
    this.play(sink, id, gain, this.jit(0.05), pan, sc >= SC.H ? 8 : 7);
    if (sc !== SC.PROJECTILE && !this.projHitKeys.has(`${e.frame}|${e.a}|${e.b}`)) {
      const w = this.weapon(e.a);
      if (w) this.play(sink, WEAPON_SOUNDS[w], sc === SC.L ? 0.75 : sc === SC.M ? 0.85 : 1, this.jit(0.04), pan, 7);
    }
    if (e.b >= GOON_BASE) this.play(sink, 'goon_hit', sc >= SC.H ? 0.9 : 0.6, this.jit(0.05), pan, 5);
    if (sc >= SC.H && sc !== SC.PROJECTILE) {
      sink.duck(0.15, 0.6, 1);                          // research: duck music 3-6 dB for 150 ms on heavies
      this.splat(sink, pan, false);
      this.voice(sink, e.a, 'atk', sc >= SC.SPECIAL ? 0.5 : 0.3);
    }
    if (e.b >= GOON_BASE) this.voice(sink, e.b, 'hurt', sc >= SC.H ? 0.8 : 0.5, 1, 0.03);
    else if (sc >= SC.M) this.voice(sink, e.b, 'hurt', sc >= SC.H ? 0.75 : 0.4, 1, 0.04);
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

  private projSpawn(e: SimEvent, sink: AudioSink): void {
    if (e.a !== 0 && e.a !== 1) { this.play(sink, 'proj_throw', 0.8, this.jit(0.05), 0, 3); return; }
    const mv = this.move(e.a, e.c);
    const ps = mv?.proj ? PROJ_SOUNDS[mv.proj] : undefined;
    this.projKind[e.a] = mv?.proj ?? null;
    if (this.t - this.lastProjSnd[e.a] < 0.05) { this.cull('proj_spawn:dup'); return; }
    this.lastProjSnd[e.a] = this.t;
    this.play(sink, ps ? ps.spawn : (PROJ_BY_FIGHTER[this.fighterId(e.a)] ?? 'proj_throw'), 1, this.jit(0.04), this.pan(e.a), 5);
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
    // a projectile verb on a projectile move = that object's wind-up (CONTRACT s9.2.3); the release is PROJ_SPAWN
    const mv = this.move(e.a, e.c);
    const ps = mv?.proj ? PROJ_SOUNDS[mv.proj] : undefined;
    if (ps && PROJ_VERB_TARGETS.has(target)) {
      if (ps.wind) this.play(sink, ps.wind, 1.25, this.jit(0.04), this.pan(e.a), 4);
      else this.cull('sfx_cue:no-windup');
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
    this.say(sink, this.bonus ? 'ann_bonus' : 'ann_ready', 0.7, 10);
    this.crowdShot(sink, 'crowd_cheer', 4, 0.1);
  }

  private fight(m: MatchSnap, sink: AudioSink): void {
    if (this.fightRound === m.round) return;
    this.fightRound = m.round;
    this.say(sink, this.bonus ? 'ann_begin' : 'ann_fight', 0, 10);
    this.play(sink, 'horn', 0.8, 1, 0, 8, 'sfx', 0.05);
    this.crowdShot(sink, 'crowd_cheer', 7, 0.15);
    this.excite += 0.2;
  }

  private roundEnd(m: MatchSnap, sink: AudioSink): void {
    if (this.endRound === m.round) return;
    this.endRound = m.round;
    const w = m.roundWinner;
    const f = this.fighters;
    const perfect = !this.bonus && f !== null && (w === 0 || w === 1) && f[w].hp >= f[w].hpMax;
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
    if (this.bonus) { line = 'ann_ohyeah'; this.play(sink, 'host_fanfare', 0.9, 1, 0, 7, 'sfx', 0.6); }
    else if (m.draw || m.winner < 0) line = 'ann_gameover';
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

  // ------------------------------------------------------------------------------------------- PRIME TIME beats
  /** plays the cue's beats as MatchSnap.cinematic.frame passes them; once per cinematic instance (rollback-safe: a frame
   *  that goes backwards replays nothing) */
  private cinematic(m: MatchSnap, sink: AudioSink): void {
    const c = m.cinematic;
    if (!c || !c.active || (c.fighter !== 0 && c.fighter !== 1)) {
      if (this.cineKey && (!c || !c.active)) this.cineKey = '';
      return;
    }
    const key = `${m.round}|${c.fighter}|${c.cueId}`;
    if (key !== this.cineKey) { this.cineKey = key; this.cineLast = -1; }
    if (c.frame <= this.cineLast) return;
    const mv = this.move(c.fighter, c.cueId);
    const beats = mv?.cine ? CINE_BEATS[mv.cine] : undefined;
    const from = this.cineLast, to = c.frame;
    this.cineLast = c.frame;
    if (beats) {
      for (const [f, id, g] of beats) {
        if (f > from && f <= to) {
          // authored beats bypass the crowd one-at-a-time gap (the cinematic is the show); they still set it
          if (SFX[id].cat === 'crowd') { this.lastCrowdT = this.t; this.lastCrowdPri = 8; this.play(sink, id, g, this.jit(0.03), 0, 8, 'crowd'); }
          else this.play(sink, id, g, 1, 0, 7, SFX[id].cat === 'voice' ? 'voice' : 'sfx');
        }
      }
    }
    const last = mv && mv.cineHits.length ? mv.cineHits[mv.cineHits.length - 1] : -1;
    if (last >= 0 && last > from && last <= to) {
      this.play(sink, 'cine_finish', 1, 1, 0, 9);
      this.lastCrowdT = this.t;
      this.lastCrowdPri = 9;
      this.play(sink, 'crowd_roar', 1, 1, 0, 8, 'crowd', 0.3);
      this.excite += 0.4;
    }
  }

  // ------------------------------------------------------------------------------------------- HECKLER TOSS objects
  private heckleType(b: number): string {
    const list = this.ctx?.heckleObjects ?? HECKLE_OBJ_ORDER;
    const id = b >= 0 && b < list.length ? list[b] : HECKLE_OBJ_ORDER[((b % 4) + 4) % 4];
    return Object.prototype.hasOwnProperty.call(HECKLE_OBJ_SOUNDS, id) ? id : 'shoe';
  }

  /** the oldest unresolved object in flight (contact events do not name the slot) */
  private resolveHeckle(): HeckleObj | null {
    let best: HeckleObj | null = null;
    for (const o of this.heckle.values()) if (!o.resolved && (!best || o.t < best.t)) best = o;
    if (best) best.resolved = true;
    return best;
  }

  /** an object that leaves MatchSnap.proj without a contact event broke on the floor: its landing sound, panned */
  private heckleWatch(m: MatchSnap, sink: AudioSink): void {
    if (!this.bonus || this.heckle.size === 0 || !m.proj) return;
    const live = new Map<number, number>();
    for (const p of m.proj) if (p.kind === 2 && p.alive !== false) live.set(p.slot, p.x);
    for (const [slot, o] of this.heckle) {
      const x = live.get(slot);
      if (x !== undefined) { o.x = x; o.seen = true; continue; }
      if (!o.seen) { if (this.t - o.t > 0.5) this.heckle.delete(slot); continue; }   // never saw it fly: forget it quietly
      this.heckle.delete(slot);
      if (!o.resolved) this.play(sink, HECKLE_OBJ_SOUNDS[o.type] ?? 'heckle_thud', 0.75, this.jit(0.05), this.panX(o.x), 4);
    }
  }

  // ---------------------------------------------------------------------------------------------- state loops
  /** every rendered frame (dt in seconds, 0 while paused): crowd beds, the stage ambience, excitement decay */
  update(dt: number, sink: AudioSink): void {
    if (this.paused) return;
    const step = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    this.t += step;
    this.excite = Math.min(1.5, this.excite) * Math.exp(-step / 3);
    const f = this.fighters;
    if (f) this.showtime = Math.max(f[0].showtime, f[1].showtime) / 30000;
    const bz = this.match?.brawl;
    const target = bz
      ? Math.max(0, Math.min(1, 0.2 + 0.5 * Math.min(1, bz.ratings / 699) + 0.45 * Math.min(1, this.excite)))
      : Math.max(0, Math.min(1, 0.12 + 0.55 * Math.min(1, this.showtime) + 0.45 * Math.min(1, this.excite)));
    this.crowd += (target - this.crowd) * Math.min(1, step * 2.5);
    if (!this.bout) return;
    const I = this.crowd;
    this.want(sink, 'bed_low', { id: 'bed_low', gain: baseGain('bed_low') * (1 - 0.55 * I), rate: 1, bus: 'crowd' });
    this.want(sink, 'bed_high', { id: 'bed_high', gain: baseGain('bed_high') * Math.pow(0.15 + 0.85 * I, 1.2), rate: 1, bus: 'crowd' });
    // stomp-stomp-clap at peak ratings, with hysteresis (starts above 0.82, stops below 0.7) so it never flaps
    const stomping = this.active.has('bed_stomp');
    if (I > 0.82 || (stomping && I > 0.7)) this.want(sink, 'bed_stomp', { id: 'bed_stomp', gain: baseGain('bed_stomp') * Math.min(1, Math.max(0.05, (I - 0.7) / 0.3)), rate: 1, bus: 'crowd' });
    else if (stomping) { sink.loop('bed_stomp', null); this.active.delete('bed_stomp'); }
    // the stage ambience recedes as the crowd gets loud; rooftop thunder every 18-40 s
    const amb = this.ctx?.ambient;
    if (amb) {
      this.want(sink, 'amb', { id: amb, gain: baseGain(amb) * (1 - 0.4 * I), rate: 1, bus: 'crowd' });
      if (amb === 'amb_rooftop') {
        if (this.thunderAt <= 0) this.thunderAt = this.t + 8 + 10 * this.rnd();
        else if (this.t >= this.thunderAt) {
          this.thunderAt = this.t + 18 + 22 * this.rnd();
          this.play(sink, 'amb_thunder', 0.9 + 0.2 * this.rnd(), this.jit(0.06), (this.rnd() * 2 - 1) * 0.5, 2, 'crowd');
        }
      }
    }
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
    this.match = null;
    this.projKind[0] = this.projKind[1] = null;
    this.heckle.clear();
    this.cineKey = '';
    this.cineLast = -1;
    this.thunderAt = 0;
  }

  private stopBeds(sink: AudioSink): void {
    for (const k of [...this.active]) { sink.loop(k, null); this.active.delete(k); }
  }

  private want(sink: AudioSink, key: string, c: LoopCmd): void {
    if (!this.active.has(key)) { this.loopStarts[c.id] = (this.loopStarts[c.id] ?? 0) + 1; this.active.add(key); }
    sink.loop(key, c);
  }

  private fighterId(i: number): string {
    return i === 0 || i === 1 ? this.bout?.fighters[i] ?? '' : '';
  }

  /** the move a fighter index + moveId names (null when unknown) */
  private move(i: number, moveId: number): AudioMove | null {
    if (i !== 0 && i !== 1) return null;
    const t = this.ctx?.moves[i];
    return t && moveId >= 0 && moveId < t.length ? t[moveId] : null;
  }

  /** the weapon of the attacker's running move (FighterSnap.moveId at the event) */
  private weapon(i: number): WeaponKind | null {
    if (i !== 0 && i !== 1) return null;
    const f = this.fighters?.[i];
    return f ? this.move(i, f.moveId)?.weapon ?? null : null;
  }

  private goonSnap(i: number): { x: number; kind: string; kindIdx: number } | null {
    const gs = this.match?.brawl?.goons;
    if (!gs) return null;
    const slot = i - GOON_BASE;
    for (const g of gs) if (g.slot === slot) return g;
    return null;
  }

  private goonRate(kindIdx: number): number {
    return goonVoiceRate(this.ctx?.goonKinds[kindIdx], kindIdx);
  }

  /** a fighter's (or goon's) voice line (per-voice gap, probability p) */
  private voice(sink: AudioSink, who: number, kind: VoiceKind, p: number, gainMul = 1, delay = 0): void {
    const goon = who >= GOON_BASE;
    if (!goon && who !== 0 && who !== 1) return;
    const gap = kind === 'ko' ? 0 : goon ? 0.5 : 0.38;
    if (this.t - (this.lastVoice[who] ?? -1e9) < gap) { this.cull(`voice:${kind}:gap`); return; }
    if (p < 1 && this.rnd() >= p) { this.cull(`voice:${kind}:chance`); return; }
    this.lastVoice[who] = this.t;
    let bank: Bank = 'm1';
    let rate = 1;
    if (goon) {
      const g = this.goonSnap(who);
      bank = 'goon';
      rate = g ? goonVoiceRate(g.kind, g.kindIdx) : 1;
    } else {
      const v = FIGHTER_VOICE[this.fighterId(who)] ?? { bank: 'm1' as Bank, rate: 1 };
      bank = v.bank;
      rate = v.rate;
    }
    this.play(sink, VO[bank][kind], gainMul, rate * this.jit(0.03), this.pan(who), kind === 'ko' ? 9 : 5, 'voice', delay);
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

  /** the listener's x: the fighters' midpoint (bonus rounds: the player) */
  private centreX(): number {
    const f = this.fighters;
    if (!f) return 0;
    return this.bonus || f[1].absent ? f[0].x : (f[0].x + f[1].x) / 2;
  }

  private panX(x: number): number {
    if (!Number.isFinite(x) || !this.fighters) return 0;
    return Math.max(-0.6, Math.min(0.6, (x - this.centreX()) * 0.18));
  }

  private pan(i: number): number {
    const f = this.fighters;
    if (!f) return 0;
    if (i === 0 || i === 1) return this.panX(f[i].x);
    if (i >= GOON_BASE) { const g = this.goonSnap(i); return g ? this.panX(g.x) : 0; }
    return 0;
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
