// BLOCKTOOTH v2 — APP-SIDE contract types (FEATURES_V2 §2.6 / §13; the "APP-SIDE" section of
// _spec/features_v2_types.ts, copied verbatim). TYPE-ONLY: nothing here exists at runtime.
//
// The sim never imports this file (it names three / DOM types). Views (render/, titans/, ai/*view),
// UI (ui/) and the app (game.ts, testsurface.ts) import from here, so game.ts is pre-wired once (lane
// L0) against exactly these signatures and no later lane edits game.ts. Owner: L0 / orchestrator.
//
// The one THREE-free data shape a data file needs (CineBiome) lives in data/cine.ts and is re-exported.

import type { BiomeId, PerkId, Profile, SimEvent, TitanId, TitanPalette, World } from './core/types.ts';
import type { Input } from './core/input.ts';
import type { CameraRig } from './render/camera.ts';
import type { PerspectiveCamera, WebGLRenderer } from 'three';
export type { CineBiome } from './data/cine.ts';

// ── HUD / markers / toasts (L8) ──
export type GlyphId =
  | 'heart' | 'plate' | 'drip' | 'thorn' | 'fang' | 'brick' | 'halo' | 'bandage'
  | 'boot' | 'dash' | 'hourglass'
  | 'arrowUp' | 'star' | 'dice' | 'cycle' | 'magnet' | 'reach'
  | 'claw' | 'tempo' | 'reticle' | 'burst' | 'bullseye' | 'exclaim' | 'fist' | 'links' | 'chunk' | 'wreck'
  | 'foot' | 'ripple' | 'bolt'
  | 'hook' | 'megaphone'
  | 'jaw' | 'vortex' | 'fork' | 'wire' | 'dome' | 'lava' | 'turret' | 'spore' | 'vine'
  | 'flame' | 'meteor' | 'snow'
  | 'plus' | 'lock' | 'banish' | 'evo' | 'overload' | 'annex' | 'trafficLight' | 'notice' | 'rush' | 'coin'
  | 'ribbon' | 'swatch' | 'key' | 'till';
export type MarkerKind = 'overloadSite' | 'reliefDepot' | 'recordsAnnex' | 'powerup' | 'till';
export interface MarkerItem { kind: MarkerKind; sub: string; x: number; y: number; onScreen: boolean; angle: number; dist: number }
/** CSS px; `angle` = edge-arrow direction when off-screen; `dist` in blocks (m ÷ CITY pitch). ≤ 12 items. */
export interface MarkerFrame { items: MarkerItem[] }
export interface ToastSpec { kicker: string; title: string; sub: string; glyph: GlyphId }
export interface AbilityBarApi { show(on: boolean): void; update(w: World, dt: number): void; onEvents(w: World, ev: readonly SimEvent[]): void }
export interface TrackerApi { show(on: boolean): void; update(w: World, dt: number): void; onEvents(w: World, ev: readonly SimEvent[]): void }
export interface MarkersApi { show(on: boolean): void; update(f: MarkerFrame): void }
export interface ToastsApi { push(t: ToastSpec): void; clear(): void }
/** render/markerview.ts (L6): a ViewModule that also projects marker anchors. Stub: frame() → {items: []}. */
export interface MarkerViewApi { frame(): MarkerFrame }

// ── cinematic (L10) ──
export type CineVariant = 'full' | 'short' | 'reduced';
export type CineShotId = 'signal' | 'street' | 'closeup' | 'crane' | 'handoff';
/** t = seconds into this shot, k = t / dur (0..1) */
export interface CineShot { id: CineShotId; t: number; dur: number; k: number }
/** a camera pose: position, look target, vertical fov (deg), roll (deg) */
export interface CamPose { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number; roll: number }
/** world position of the titan's head joint + the head's unit forward vector + the titan height (m).
 *  THREE-free on purpose (the cinematic planner is pure maths over it and w.city). */
export interface FaceAnchor { x: number; y: number; z: number; fx: number; fy: number; fz: number; h: number }
/** blend channels 0..1 that TitanAnimator layers over idle (AnimState.cine) */
export interface CineChannels { look: number; blink: number; snarl: number }
export interface CinePlan {
  variant: CineVariant;
  total: number;                                    // s, start of 'signal' to the end of 'handoff'
  shots: { id: CineShotId; start: number; dur: number }[];
  street: CamPose | null;                           // S1; null in 'short' and 'reduced'
  close: CamPose;                                   // S2 (low-angle hero shot, §11.2)
  game: CamPose;                                    // gameplay pose read back after rig.reset(w) + one rig.update
  beats: { look: number; blink: number; snarl: number; lowerThird: number; hudIn: number };   // s from start
  near: number; far: number;                        // clip planes CineCam sets for S1/S2 (restored at hand-back)
}
export interface CineInfo { place: string; sub: string; titanName: string; reduceFlash: boolean; reduceMotion: boolean }
/** render/cinecam.ts (L10). constructor(camera: PerspectiveCamera). Stub: plan() → null (legacy slate). */
export interface CineCamApi {
  readonly active: boolean;
  plan(w: World, rig: CameraRig, face: FaceAnchor, variant: CineVariant): CinePlan | null;   // null → legacy slate
  start(plan: CinePlan): void;                      // takes the camera; sets near/far from the plan
  update(dt: number): boolean;                      // drives pose/fov/roll; false once handed back (camera at plan.game, clip restored)
  skip(): void;                                     // 0.25 s crossfade to plan.game, then hand-back
  stop(): void;                                     // immediate: restore fov/near/far/roll; inactive (abort path)
  readonly shot: CineShot | null;
  channels(): CineChannels | null;
}
export type CineCamCtor = new (camera: PerspectiveCamera) => CineCamApi;
/** ui/cine.ts (L10). constructor(root: HTMLElement, input: Input). */
export interface CineOverlayApi {
  /** mounts the overlay and listens for "any key" (UiKeys, armMs 350). Resolves 'skipped' on a key,
   *  'done' when the app calls setShot(null) after CineCam hands back, 'aborted' on clear(). */
  play(plan: CinePlan, info: CineInfo): Promise<'done' | 'skipped' | 'aborted'>;
  setShot(s: CineShot | null): void;                // per frame from game.ts; null = camera handed back
  skip(): void;                                     // same as a real key (test surface app.dismiss)
  clear(): void;                                    // abort: DOM removed, promise resolves 'aborted'
}
export type CineOverlayCtor = new (root: HTMLElement, input: Input) => CineOverlayApi;
/** titans/titanview.ts additions (L0 stubs, L10 fills). Stub: faceAnchor → false, setCine no-op. */
export interface TitanViewAdd {
  faceAnchor(out: FaceAnchor): boolean;
  setCine(ch: CineChannels | null): void;
}
/** titans/portraits.ts renderPortrait (L0 stub = the canonical portrait for any palette; L10 renders the palette). */
export type RenderPortraitFn = (renderer: WebGLRenderer, id: TitanId, size: number, palette: TitanPalette | null) => Promise<string>;

// ── screens (L9). Constructors unchanged: (root: HTMLElement, input: Input). ──
/** ui/menus.ts TitleScreen.run(): resolves 'goals' on G / pad X or a click on the GOALS & RECORDS chip. */
export interface TitleScreenApi { run(): Promise<'play' | 'goals'> }
export type SelectRow = 'cards' | 'palette' | 'perk';
/** where the select screen resumes after GOALS & RECORDS closes (same step, choice and focused row) */
export interface SelectResume { step: 1 | 2; titan: TitanId; biome: BiomeId; perk: PerkId | null; palette: number; row: SelectRow }
export interface SelectRunOpts {
  portraits: Record<TitanId, string>;               // canonical portraits (palette 0), as today
  /** app-provided (game.ts, cached per titan × palette): the select screen calls it when the palette row changes */
  portraitFor(titan: TitanId, palette: number): Promise<string>;
  profile: Profile;
  bests: Record<string, number>;                    // core/save.ts loadBest()
  initial?: Partial<SelectResume>;
}
export type SelectResultV2 =
  | { kind: 'start'; titan: TitanId; biome: BiomeId; perk: PerkId | null; palette: number }
  | { kind: 'goals'; resume: SelectResume }
  | null;                                           // back to the title
/** ui/select.ts SelectScreen.run — replaces run(portraits, initial). */
export interface SelectScreenApi { run(opts: SelectRunOpts): Promise<SelectResultV2> }
export interface DraftCtx {
  rerollsLeft: number; banishLeft: number; lockLeft: number;
  locked: string | null;                            // w.upgrades.locked (HELD badge on that card if offered)
  newIds: readonly string[];                        // profile.newUnlocks ∩ offer → "NEW" ribbon
}
export type DraftResultV2 = { pick: string } | { reroll: true } | { banish: string } | { lock: string };
/** ui/draft.ts DraftScreen.open — replaces open(w, offer, rerollsLeft). */
export interface DraftScreenApi { open(w: World, offer: string[], ctx: DraftCtx): Promise<DraftResultV2> }
export interface TabloidExtra {
  newGoals: { goal: string; unlock: string }[];     // "NEW ON THE RECORD" sidebar (names, already resolved)
  canContinue: boolean;                             // clear variant only: show KEEP GOING
}
export type TabloidChoiceV2 = 'retry' | 'select' | 'title' | 'endless';
/** ui/broadcast.ts Broadcast.tabloid — replaces tabloid(w, photo). The EXTENDED COVERAGE variant is chosen
 *  by `w.endless !== null`. */
export interface BroadcastAdd { tabloid(w: World, photo: string, extra: TabloidExtra): Promise<TabloidChoiceV2> }
/** ui/menus.ts PauseMenu.open — replaces open(). LOADOUT reads ctx.w.upgrades (+ icons.ts), ctx.w.meta.perk,
 *  banishLeft / lockLeft. null → no LOADOUT tab (defensive). */
export interface PauseCtx { w: World }
export interface PauseMenuApi { open(ctx: PauseCtx | null): Promise<'resume' | 'retry' | 'quit'> }
/** ui/goals.ts */
export interface GoalsScreenApi { open(p: Profile, bests: Record<string, number>): Promise<void> }
/** ui/goals.ts NextUnlockPanel: constructor(host: HTMLElement) */
export interface NextUnlockPanelApi { set(p: Profile, titan: TitanId, biome: BiomeId | null): void }

// keep `Input` referenced for readers (the ctor types above use it)
export type _V2Refs = [Input];
