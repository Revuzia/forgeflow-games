// GENESIS — window.__GENESIS__ (CONTRACT.md §18): the automation surface used by _harness/shots.mjs, perf probes and
// integration tests. Everything a player can do is reachable here as a Command, a camera action or a UI action.
//
//   ready                      Promise<void>  (resolves after the first rendered frames)
//   state()                    tick, speed, achieved speed, fps, scenario, seed, camera, planets[...], render stats, ui
//   cmd(c) / freeform(text) / parse(text)   → CommandResult
//   setSpeed(x), step(ticks)   → Promise<number> (tick after stepping)
//   camera(spec)               { mode, planet, lat, lon, alt, yaw, pitch, dist, tilt, poi, hour, turn, fov, blend }
//   quality(name), ui(visible)
//   shot(name)                 canvas → POST /__shot/<name> (vite dev server writes _shots/<name>.png) → path
//   frames(n)                  resolves after n rendered frames (let streaming / exposure settle)
//   exposure(ev)               exposure compensation in stops (photo)
//   query(q, args)             sim.query (inspector data: 'agent', 'settlement', 'building', 'herds', 'cell', ...)
//   poi(name)                  a point of interest on the primary world: { lat, lon, heading, cell, pos, planet }
//                              ('homestead' = a good place to set a people down; 'newest'; 'settlement:<id>'; ...)
//   select(ref | null)         select a thing ({ kind: 'agent'|'building'|'settlement'|'animal'|'creature'|'disaster'|
//                              'weather'|'ship'|'cell'|'planet'|'species', id }) → inspector
//   follow(ref | null)         keep the camera on a thing
//   pickAt(x, y)               what is drawn under a screen point (CSS px): { kind, id, planet, dist } or null
//   click(x, y)                a left click there (selects what is drawn, or recentres)
//   agents(n?) / buildings(n?) ids of people / buildings drawn well inside the view right now, nearest first
//   toastLife(ms)              how long toasts stay (a software-rendered capture takes seconds per frame)
//   ui_                        the interface (src/ui/shell.ts): open(panel, arg) / closeAll() / action(id) / arm(power,
//                              values) / cast(power, values, [x, y]) / pointer(x, y) / key(code, mods) / gesture(name |
//                              points, [x, y], size) / overlay(mode) / state() / pref(path, value)

import type { App, CameraSpec } from './app.ts';
import type { Command, CommandResult, EntityRef, UnitVec } from './sim/types.ts';
import type { InspectRef } from './ui/host.ts';
import { isQualityName } from './render/quality.ts';
import { SHAPES, type Pt } from './ui/unistroke.ts';

export interface UiSurface {
  open(panel: string, arg?: unknown): Promise<void>;
  closeAll(): void;
  action(id: string): void;
  arm(power: string, values?: Record<string, unknown>): boolean;
  cast(power: string, values?: Record<string, unknown>, at?: [number, number]): Promise<CommandResult | null>;
  pointer(x: number, y: number): void;
  key(code: string, mods?: { shift?: boolean; ctrl?: boolean; alt?: boolean; up?: boolean }): void;
  gesture(shape: string | [number, number][], at?: [number, number], size?: number): { name: string; score: number; power: string | null } | null;
  overlay(mode: string | null): void;
  state(): Record<string, unknown>;
  palette(): { kind: string; title: string; sub: string }[];
  /** set a preference ('ui.scale', 'ui.palette', 'audio.master', 'gfx.bloom' …) as the settings panel does */
  pref(path: string, value: unknown): void;
}

export interface GenesisTestSurface {
  ready: Promise<void>;
  state(): Record<string, unknown>;
  cmd(c: Command): Promise<CommandResult>;
  freeform(text: string): Promise<CommandResult>;
  parse(text: string): Promise<CommandResult>;
  setSpeed(x: number): void;
  step(ticks: number): Promise<number>;
  camera(spec: CameraSpec): Promise<void>;
  quality(name: string): void;
  ui(visible: boolean): void;
  shot(name: string): Promise<string>;
  frames(n: number): Promise<void>;
  exposure(ev: number): void;
  query(q: string, args?: Record<string, unknown>): Promise<unknown>;
  poi(name: string, planet?: number): { lat: number; lon: number; heading: number; cell: number; pos: UnitVec; planet: number } | null;
  select(ref: InspectRef | null): void;
  follow(ref: EntityRef | null): void;
  pickAt(x: number, y: number): (EntityRef & { dist: number }) | null;
  click(x: number, y: number): void;
  agents(n?: number): { id: number; dist: number; screen: [number, number] | null }[];
  buildings(n?: number): { id: number; dist: number; screen: [number, number] | null }[];
  toastLife(ms: number): void;
  ui_: UiSurface;
}

declare global {
  interface Window { __GENESIS__?: GenesisTestSurface }
}

export function installTestSurface(getApp: () => App | null, ready: Promise<void>): GenesisTestSurface {
  const need = (): App => {
    const a = getApp();
    if (!a) throw new Error('GENESIS is not running yet (await __GENESIS__.ready)');
    return a;
  };
  const ui: UiSurface = {
    async open(panel, arg) {
      const s = need().ui;
      switch (panel) {
        case 'palette': s.palette.open(typeof arg === 'string' ? arg : ''); break;
        case 'freeform': s.openFreeform(typeof arg === 'string' ? arg : ''); break;
        case 'radial': if (typeof arg === 'string') s.radial.openCategory(arg); else s.radial.open(window.innerWidth / 2, window.innerHeight / 2, 'click'); break;
        case 'chronicle': s.chronicle.open(); if (typeof arg === 'string') s.chronicle.setSearch(arg); break;
        case 'settings': s.settings.open(typeof arg === 'string' ? arg as 'graphics' : undefined); break;
        case 'saves': s.saves.open(); break;
        case 'help': s.help.open(); break;
        case 'menu': s.menu.open(); break;
        case 'laws': s.openLaws(typeof arg === 'string' ? arg : undefined); break;
        case 'overlay': s.overlays.set(typeof arg === 'string' ? arg : 'temperature'); break;
        case 'gesture': s.gestures.begin(window.innerWidth / 2, window.innerHeight / 2); break;
        default: throw new Error(`unknown panel '${panel}'`);
      }
      await need().waitFrames(1);
    },
    closeAll() {
      const s = need().ui;
      s.palette.close(); s.radial.close(); s.freeform.close(); s.gestures.cancel();
      for (const p of [s.chronicle, s.settings, s.saves, s.help, s.menu]) p.close();
      s.tools.disarm();
    },
    action: (id) => need().ui.action(id),
    arm(power, values) {
      const a = need();
      const p = a.powers.get(power);
      if (!p) return false;
      a.ui.arm(p, values ?? {});
      return true;
    },
    async cast(power, values, at) {
      const a = need();
      const p = a.powers.get(power);
      if (!p) return { ok: false, msg: `no power '${power}'` };
      a.ui.arm(p, values ?? {});
      if (at) { a.ui.pointerMove(at[0], at[1], 0, 0, 0); await a.waitFrames(2); }
      return a.ui.tools.castHere(p, values);
    },
    pointer(x, y) { need().ui.pointerMove(x, y, 0, 0, 0); },
    key(code, mods = {}) {
      const init = { code, key: code, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, bubbles: true, cancelable: true };
      window.dispatchEvent(new KeyboardEvent(mods.up ? 'keyup' : 'keydown', init));
    },
    gesture(shape, at, size = 220) {
      const s = need().ui;
      const raw: Pt[] = typeof shape === 'string' ? SHAPES[shape] ?? [] : shape.map((p) => [p[0], p[1]] as Pt);
      if (!raw.length) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of raw) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      const k = size / Math.max(x1 - x0, y1 - y0, 1);
      const c = at ?? [window.innerWidth / 2, window.innerHeight / 2];
      const pts = raw.map((p) => [c[0] + (p[0] - (x0 + x1) / 2) * k, c[1] + (p[1] - (y0 + y1) / 2) * k] as [number, number]);
      s.gestures.begin(pts[0][0], pts[0][1]);
      for (const p of pts) s.gestures.point(p[0], p[1]);
      s.gestures.end();
      return s.gestures.last;
    },
    overlay: (mode) => need().ui.overlays.set(mode),
    state: () => need().ui.state(),
    palette: () => need().ui.palette.rowsText(),
    pref: (path, value) => need().prefs.set(path, value),
  };
  const surface: GenesisTestSurface = {
    ready,
    state: () => need().state(),
    cmd: (c) => need().cmd(c, { quiet: false }),
    freeform: (text) => need().sim.freeform(text),
    parse: (text) => need().sim.parse(text),
    setSpeed: (x) => need().setSpeed(x),
    step: (ticks) => need().step(ticks),
    camera: (spec) => need().camera(spec),
    quality: (name) => { if (isQualityName(name)) need().setQuality(name); else throw new Error(`unknown quality '${name}'`); },
    ui: (v) => need().setUi(v),
    async shot(name) {
      const app = need();
      const url = await app.capture();
      const res = await fetch(`/__shot/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: url });
      if (!res.ok) throw new Error(`shot upload failed: HTTP ${res.status}`);
      const j = await res.json() as { path?: string };
      return j.path ?? name;
    },
    frames: (n) => need().waitFrames(n),
    exposure: (ev) => { need().renderer.settings.exposureBias = ev; },
    query: (q, args) => need().sim.query(q, args ?? {}),
    poi: (name, planet) => need().poi(name, planet),
    select: (ref) => need().select(ref),
    follow: (ref) => need().follow(ref),
    pickAt: (x, y) => need().pickEntity(x, y),
    click: (x, y) => need().clickAt(x, y),
    agents: (n) => need().drawnAgents(n ?? 20),
    buildings: (n) => need().drawnAgents(n ?? 20, 'building'),
    toastLife: (ms) => { need().ui.hud.toasts.life = Math.max(1000, ms); },
    ui_: ui,
  };
  window.__GENESIS__ = surface;
  return surface;
}
