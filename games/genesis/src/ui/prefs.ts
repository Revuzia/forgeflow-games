// GENESIS — player preferences (CONTRACT.md §16.9): graphics preset and toggles, audio volumes, interface scale,
// colour-blind palettes, hints, toast time, autosave, gamepad. Stored in localStorage; every change notifies listeners
// (the App applies graphics and audio, the shell the interface). Quality never changes the sim (§15.9).

import { store } from './dom.ts';

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
    hints: boolean;
    toastSeconds: number;
    ticker: boolean;
    labels: boolean;
    /** the frame rate beside the achieved speed (always with ?dev=1) */
    showFps: boolean;
  };
  game: { autosaveMinutes: number; edgePan: boolean };
  pad: { enabled: boolean; deadzone: number; cursorSpeed: number; invertY: boolean; lookSpeed: number };
}

export const DEFAULT_PREFS: Prefs = {
  quality: 'auto',
  gfx: { renderScale: 1, shadows: true, ssao: true, godRays: true, bloom: 1, flare: true, fxaa: true, grain: true, vignette: true, vegetation: 1, grass: true, orbits: true, exposure: 0 },
  audio: { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.7, muted: false },
  ui: { autoScale: true, scale: 1, palette: 'standard', reduceMotion: false, hints: true, toastSeconds: 8, ticker: true, labels: true, showFps: false },
  game: { autosaveMinutes: 10, edgePan: true },
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

export class PrefsStore {
  value: Prefs;
  private listeners: ((p: Prefs, what: string) => void)[] = [];

  constructor(persist = true) {
    this.value = persist ? merge(structuredClone(DEFAULT_PREFS), store.get<unknown>(KEY, null)) : structuredClone(DEFAULT_PREFS);
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
