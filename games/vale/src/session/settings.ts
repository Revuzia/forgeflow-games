// VALE session — player settings: defaults, the video quality ladder, safe patching.
//
// Settings live in the Profile (persisted with it). The renderer reads `video`, the audio engine
// `audio`, input `controls`, the UI `access` + `gameplay`.
//
// VIDEO LADDER (CONTRACT §9.4) → Settings.video fields:
//   shadows 0 off · 1 = 1024 hard · 2 = 2048 (PCF from High up) · 3 = 4096
//   ao      0 off · 1 = half resolution · 2 = full resolution
//   preset  renderScale shadows ao bloom antialias particles scatter maxDpr
//   low        0.75       1     0  no    off       0         0       1
//   medium     0.9        2     1  yes   smaa      1         1       1
//   high       1.0        2     1  yes   smaa      2         2       1
//   ultra      1.0        3     2  yes   smaa      2         2       2
// ('High: AO' vs 'Ultra: AO full' in §9.4 reads as High = the half-resolution pass.) A preset
// never touches fpsCap or fullscreen. Changing any ladder field by hand turns the preset 'custom'.
//
// KEYBINDS: action → KeyboardEvent.code (layout-independent). Actions: a1 a2 a3 ult spell1 spell2
// item1..item6 recall shop scoreboard ping attackMove stop cameraLock centerCamera selfCastMod.
// There is no chat bind in this slice. Mouse buttons are 'Mouse0'..'Mouse4'.

import type { Settings } from '../contracts/session.ts';

export type VideoPreset = Exclude<Settings['video']['preset'], 'custom'>;
export const VIDEO_PRESETS: readonly VideoPreset[] = ['low', 'medium', 'high', 'ultra'];

type Ladder = Pick<Settings['video'], 'renderScale' | 'shadows' | 'ao' | 'bloom' | 'antialias' | 'particles' | 'scatter' | 'maxDpr'>;
export const VIDEO_LADDER: Readonly<Record<VideoPreset, Readonly<Ladder>>> = {
  low: { renderScale: 0.75, shadows: 1, ao: 0, bloom: false, antialias: 'off', particles: 0, scatter: 0, maxDpr: 1 },
  medium: { renderScale: 0.9, shadows: 2, ao: 1, bloom: true, antialias: 'smaa', particles: 1, scatter: 1, maxDpr: 1 },
  high: { renderScale: 1, shadows: 2, ao: 1, bloom: true, antialias: 'smaa', particles: 2, scatter: 2, maxDpr: 1 },
  ultra: { renderScale: 1, shadows: 3, ao: 2, bloom: true, antialias: 'smaa', particles: 2, scatter: 2, maxDpr: 2 },
};
const LADDER_KEYS = Object.keys(VIDEO_LADDER.high) as (keyof Ladder)[];

export const DEFAULT_BINDS: Readonly<Record<string, string>> = {
  a1: 'KeyQ', a2: 'KeyW', a3: 'KeyE', ult: 'KeyR',
  spell1: 'KeyD', spell2: 'KeyF',
  item1: 'Digit1', item2: 'Digit2', item3: 'Digit3', item4: 'Digit4', item5: 'Digit5', item6: 'Digit6',
  recall: 'KeyB', shop: 'KeyP', scoreboard: 'Tab', ping: 'KeyG',
  attackMove: 'KeyA', stop: 'KeyS', cameraLock: 'KeyY', centerCamera: 'Space', selfCastMod: 'AltLeft',
};

export function defaultSettings(): Settings {
  return {
    video: { preset: 'high', ...VIDEO_LADDER.high, fpsCap: 0, fullscreen: false },
    audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true },
    controls: { binds: { ...DEFAULT_BINDS }, quickCast: false, cameraLock: false, edgePan: true, panSpeed: 0.5, attackMoveOnClick: false, selfCastModifier: 'AltLeft' },
    access: { colorblind: 'off', uiScale: 1, hudScale: 1, minimapScale: 1, reduceMotion: false, screenShake: 1, subtitles: true },
    gameplay: { showDamageNumbers: true, showAllyIndicators: true, healthBarTicks: true, minimapSide: 'right' },
  };
}

/** the video block for a preset (fpsCap/fullscreen kept from `video`); 'custom' keeps the values */
export function applyPreset(video: Settings['video'], preset: Settings['video']['preset']): Settings['video'] {
  if (preset === 'custom') return { ...video, preset: 'custom' };
  return { ...video, ...VIDEO_LADDER[preset], preset };
}

/** the preset a video block matches exactly, else 'custom' */
export function detectPreset(video: Settings['video']): Settings['video']['preset'] {
  for (const p of VIDEO_PRESETS) if (LADDER_KEYS.every((k) => video[k] === VIDEO_LADDER[p][k])) return p;
  return 'custom';
}

// ── validation ──────────────────────────────────────────────────────────────────────────────────
const clamp = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], d: T): T {
  return allowed.includes(v as T) ? (v as T) : d;
}
const str = (v: unknown, d: string): string => (typeof v === 'string' && v.length > 0 && v.length <= 32 ? v : d);

/** a complete, valid Settings from anything (unknown keys dropped, bad values → base values) */
export function normalizeSettings(raw: unknown, base: Settings = defaultSettings()): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, Record<string, unknown>>>;
  const v = r.video ?? {}, a = r.audio ?? {}, c = r.controls ?? {}, x = r.access ?? {}, g = r.gameplay ?? {};
  const bv = base.video, ba = base.audio, bc = base.controls, bx = base.access, bg = base.gameplay;
  const binds: Record<string, string> = { ...DEFAULT_BINDS, ...bc.binds };
  if (c.binds && typeof c.binds === 'object') {
    for (const [k, val] of Object.entries(c.binds as Record<string, unknown>)) if (typeof val === 'string' && val.length <= 32) binds[k] = val;
  }
  const video: Settings['video'] = {
    preset: oneOf(v.preset, ['low', 'medium', 'high', 'ultra', 'custom'] as const, bv.preset),
    renderScale: clamp(v.renderScale, 0.5, 2, bv.renderScale),
    shadows: oneOf(v.shadows, [0, 1, 2, 3] as const, bv.shadows),
    ao: oneOf(v.ao, [0, 1, 2] as const, bv.ao),
    bloom: bool(v.bloom, bv.bloom),
    antialias: oneOf(v.antialias, ['off', 'smaa', 'msaa'] as const, bv.antialias),
    particles: oneOf(v.particles, [0, 1, 2] as const, bv.particles),
    scatter: oneOf(v.scatter, [0, 1, 2] as const, bv.scatter),
    fpsCap: oneOf(v.fpsCap, [0, 30, 60, 120, 144] as const, bv.fpsCap),
    maxDpr: clamp(v.maxDpr, 0.5, 4, bv.maxDpr),
    fullscreen: bool(v.fullscreen, bv.fullscreen),
  };
  return {
    video,
    audio: {
      master: clamp(a.master, 0, 1, ba.master), music: clamp(a.music, 0, 1, ba.music), sfx: clamp(a.sfx, 0, 1, ba.sfx),
      voice: clamp(a.voice, 0, 1, ba.voice), ui: clamp(a.ui, 0, 1, ba.ui), ambience: clamp(a.ambience, 0, 1, ba.ambience),
      muteInBackground: bool(a.muteInBackground, ba.muteInBackground),
    },
    controls: {
      binds, quickCast: bool(c.quickCast, bc.quickCast), cameraLock: bool(c.cameraLock, bc.cameraLock), edgePan: bool(c.edgePan, bc.edgePan),
      panSpeed: clamp(c.panSpeed, 0, 1, bc.panSpeed), attackMoveOnClick: bool(c.attackMoveOnClick, bc.attackMoveOnClick),
      selfCastModifier: str(c.selfCastModifier, bc.selfCastModifier),
    },
    access: {
      colorblind: oneOf(x.colorblind, ['off', 'deutan', 'protan', 'tritan'] as const, bx.colorblind),
      uiScale: clamp(x.uiScale, 0.5, 2, bx.uiScale), hudScale: clamp(x.hudScale, 0.5, 2, bx.hudScale),
      minimapScale: clamp(x.minimapScale, 0.5, 2, bx.minimapScale), reduceMotion: bool(x.reduceMotion, bx.reduceMotion),
      screenShake: clamp(x.screenShake, 0, 1, bx.screenShake), subtitles: bool(x.subtitles, bx.subtitles),
    },
    gameplay: {
      showDamageNumbers: bool(g.showDamageNumbers, bg.showDamageNumbers), showAllyIndicators: bool(g.showAllyIndicators, bg.showAllyIndicators),
      healthBarTicks: bool(g.healthBarTicks, bg.healthBarTicks), minimapSide: oneOf(g.minimapSide, ['right', 'left'] as const, bg.minimapSide),
    },
  };
}

/**
 * Settings after a partial patch (section by section; binds merge key by key). A patch that sets
 * `video.preset` applies that preset first and then any explicit ladder values in the same patch;
 * a patch that only changes ladder values re-detects the preset (usually → 'custom').
 */
export function patchSettings(cur: Settings, patch: Partial<Settings>): Settings {
  const p = (patch ?? {}) as Partial<Settings>;
  let video = cur.video;
  if (p.video) {
    const pv = p.video as Partial<Settings['video']>;
    if (pv.preset && pv.preset !== cur.video.preset) video = applyPreset(video, pv.preset);
    video = { ...video, ...pv, preset: video.preset };
  }
  const merged = {
    video,
    audio: { ...cur.audio, ...(p.audio ?? {}) },
    controls: { ...cur.controls, ...(p.controls ?? {}), binds: { ...cur.controls.binds, ...((p.controls as Partial<Settings['controls']> | undefined)?.binds ?? {}) } },
    access: { ...cur.access, ...(p.access ?? {}) },
    gameplay: { ...cur.gameplay, ...(p.gameplay ?? {}) },
  };
  const out = normalizeSettings(merged, cur);
  if (p.video) {
    const asked = (p.video as Partial<Settings['video']>).preset;
    const ladderTouched = LADDER_KEYS.some((k) => k in (p.video as object));
    if (!asked || ladderTouched) out.video.preset = detectPreset(out.video);
    else out.video.preset = asked;
  }
  return out;
}
