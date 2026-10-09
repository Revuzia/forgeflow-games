// GENESIS — window.__GENESIS__ (CONTRACT.md §18): the automation surface used by _harness/shots.mjs, perf probes and
// integration tests. Everything a player can do is reachable here as a Command or a camera action.
//
//   ready                      Promise<void>  (resolves after the first rendered frames)
//   state()                    tick, speed, achieved speed, fps, scenario, seed, camera, planets[...], render stats
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
//   select(ref | null)         select a thing ({ kind: 'agent'|'building'|'settlement'|'animal', id }) → inspector
//   follow(ref | null)         keep the camera on a thing
//   pickAt(x, y)               what is drawn under a screen point (CSS px): { kind, id, planet, dist } or null
//   click(x, y)                a left click there (selects what is drawn, or recentres)
//   agents(n?) / buildings(n?) ids of people / buildings drawn well inside the view right now, nearest first
//   toastLife(ms)              how long toasts stay (a software-rendered capture takes seconds per frame)

import type { App, CameraSpec } from './app.ts';
import type { Command, CommandResult, EntityRef, UnitVec } from './sim/types.ts';
import { isQualityName } from './render/quality.ts';

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
  select(ref: EntityRef | null): void;
  follow(ref: EntityRef | null): void;
  pickAt(x: number, y: number): (EntityRef & { dist: number }) | null;
  click(x: number, y: number): void;
  agents(n?: number): { id: number; dist: number; screen: [number, number] | null }[];
  buildings(n?: number): { id: number; dist: number; screen: [number, number] | null }[];
  toastLife(ms: number): void;
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
  const surface: GenesisTestSurface = {
    ready,
    state: () => need().state(),
    cmd: (c) => need().cmd(c),
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
    toastLife: (ms) => { need().hud.toasts.life = Math.max(1000, ms); },
  };
  window.__GENESIS__ = surface;
  return surface;
}
