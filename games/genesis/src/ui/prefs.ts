// GENESIS — player preferences (CONTRACT.md §16.9): graphics preset and toggles, audio volumes, interface scale,
// colour-blind palettes, hints, toast time, autosave, gamepad. Stored in localStorage; every change notifies listeners
// (the App applies graphics and audio, the shell the interface). Quality never changes the sim (§15.9).

import { store } from './dom.ts';

export type TextSize = 'normal' | 'large' | 'larger';
export const TEXT_SIZE_MULT: Record<TextSize, number> = { normal: 1, large: 1.15, larger: 1.3 };

export type CvdPalette = 'standard' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'monochrome';

export interface Prefs {
  quality: 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'cinematic';
  gfx: {
    renderScale: number;
    shadows: boolean;
    ssao: boolean;
    godRays: boolean;
    bloom: number;
    flare: boolean;
    fxaa: boolean;
    grain: boolean;
    vignette: boolean;
    vegetation: number;
    grass: boolean;
    orbits: boolean;
    exposure: number;
  };
  audio: { master: number; music: number; sfx: number; ambience: number; muted: boolean };
  ui: {
    /** follow the window's size (×1 at 820 px tall, up to ×2); off: `scale` holds */
    autoScale: boolean;
    scale: number;
    palette: CvdPalette;
    reduceMotion: boolean;
    /** text size: the interface grows by this step on top of its scale (normal, large, larger) */
    textSize: TextSize;
    /** stronger text, lines and panels (never changes the world's look) */
    highContrast: boolean;
    hints: boolean;
    toastSeconds: number;
    ticker: boolean;
    labels: boolean;
    /** the frame rate beside the achieved speed (always with ?dev=1) */
    showFps: boolean;
  };
  /** pauseHidden: stop time while the page is hidden — 'auto' (on inside the site's frame), 'on', 'off' */
  /** autosaveChosen: the player picked the cadence (an old default, 10 minutes, kept without being chosen moves to the new one) */
  /** slowGreat (ARC §2.5): a Decision card opening above 30x eases the speed to 10x until it is answered or put off */
  game: { autosaveMinutes: number; autosaveChosen: boolean; edgePan: boolean; pauseHidden: 'auto' | 'on' | 'off'; slowGreat: boolean };
  pad: { enabled: boolean; deadzone: number; cursorSpeed: number; invertY: boolean; lookSpeed: number };
}

export const DEFAULT_PREFS: Prefs = {
  quality: 'auto',
  gfx: { renderScale: 1, shadows: true, ssao: true, godRays: true, bloom: 1, flare: true, fxaa: true, grain: true, vignette: true, vegetation: 1, grass: true, orbits: true, exposure: 0 },
  audio: { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.7, muted: false },
  ui: { autoScale: true, scale: 1, palette: 'standard', reduceMotion: false, textSize: 'normal', highContrast: false, hints: true, toastSeconds: 8, ticker: true, labels: true, showFps: false },
  game: { autosaveMinutes: 2, autosaveChosen: false, edgePan: true, pauseHidden: 'auto', slowGreat: true },
  pad: { enabled: true, deadzone: 0.18, cursorSpeed: 900, invertY: false, lookSpeed: 1 },
};

const KEY = 'genesis.prefs.v1';

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    if (b === undefined) continue; // an old or foreign key
    if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, v);
    else if (typeof v === typeof b) out[k] = v;
  }
  return out as T;
}

/** the interface scale with the text-size step on top (an unknown step counts as normal; the result stays within 0.8 … 2.5) */
export function effectiveScale(base: number, size: TextSize): number {
  return Math.min(2.5, Math.max(0.8, base * (TEXT_SIZE_MULT[size] ?? 1)));
}

/** does the system ask for reduced motion (false where matchMedia is missing or throws) */
export function systemPrefersReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** first-run defaults that follow the system: reduce motion starts on when the system asks for it */
export function seedFirstRun(p: Prefs, reducedMotion: boolean): Prefs {
  if (reducedMotion) p.ui.reduceMotion = true;
  return p;
}

export class PrefsStore {
  value: Prefs;
  private listeners: ((p: Prefs, what: string) => void)[] = [];

  constructor(persist = true) {
    const saved = persist ? store.get<unknown>(KEY, null) : null;
    this.value = persist ? merge(structuredClone(DEFAULT_PREFS), saved) : structuredClone(DEFAULT_PREFS);
    // first run (nothing stored yet): the system's own "reduce motion" request seeds ours; after that the player's choice stands
    if (persist && saved === null) this.value = seedFirstRun(this.value, systemPrefersReducedMotion());
    // (a world left behind lost up to ten minutes of play: the cadence an earlier build kept by default, never chosen,
    // gives way to today's)
    if (!this.value.game.autosaveChosen && this.value.game.autosaveMinutes === 10) this.value.game.autosaveMinutes = DEFAULT_PREFS.game.autosaveMinutes;
  }

  /** set a value by path ("gfx.bloom", "ui.scale") */
  set(path: string, v: unknown): void {
    const parts = path.split('.');
    let o = this.value as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] as Record<string, unknown>;
    o[parts[parts.length - 1]] = v;
    store.set(KEY, this.value);
    for (const l of this.listeners) l(this.value, path);
  }

  get(path: string): unknown {
    let o: unknown = this.value;
    for (const k of path.split('.')) o = (o as Record<string, unknown>)?.[k];
    return o;
  }

  reset(section?: keyof Prefs): void {
    if (section) (this.value as unknown as Record<string, unknown>)[section] = structuredClone(DEFAULT_PREFS[section]);
    else this.value = structuredClone(DEFAULT_PREFS);
    store.set(KEY, this.value);
    for (const l of this.listeners) l(this.value, section ?? '*');
  }

  onChange(fn: (p: Prefs, what: string) => void): void { this.listeners.push(fn); }
}
