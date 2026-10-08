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

import type { App, CameraSpec } from './app.ts';
import type { Command, CommandResult } from './sim/types.ts';
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
  };
  window.__GENESIS__ = surface;
  return surface;
}
