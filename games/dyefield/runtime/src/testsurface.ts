// DYEFIELD — window.__DF__ test surface (CONTRACT §6). Installed at boot (before the game exists),
// so the harness can poll state().phase through boot → loading → ready → play.
//
//   version · state() · teamUnderFeet() · paintHash() · flips() · shot(name)
//   dev-only (?dev=1): teleport(x, y, z, yaw?) · splat(x, y, z, r, team) · start()
//   extra (harness read-backs, not in the contract): minimapPixel() — the DOM minimap canvas pixel
//   under the runner plus the team colors to compare against; render() — renderer counters plus the
//   adaptive render scale (quality, scale, floor / cap, drawing buffer, p90 vs target) and the static
//   map merge report.

import type { AppStatus } from './game.ts';
import type { Coverage, MoveState, TeamId } from './core/types.ts';
import { teamById, hexToRgb01 } from './core/data.ts';

export interface DFState {
  phase: AppStatus['phase'];
  mapId: string;
  tick: number;
  fps: number;
  player: { x: number; y: number; z: number; yaw: number; state: MoveState; grounded: boolean; tank: number; team: TeamId };
  coverage: Coverage;
  atlas: { size: number; count: number; overlaps: number };
  error?: string;
  startedBy?: string | null;
  pointerLocked?: boolean;
}

const rgb255 = (hex: string): number[] => hexToRgb01(hex).map((v) => Math.round(v * 255));

export function installTestSurface(app: AppStatus): void {
  const g = () => app.game;
  const devOnly = (name: string): void => {
    if (!app.dev) throw new Error(`__DF__.${name} is dev-only — load with ?dev=1`);
  };
  const api = {
    version: app.version,
    state(): DFState {
      const game = g();
      const p = game?.p.player;
      const s: DFState = {
        phase: app.phase,
        mapId: app.mapId,
        tick: game?.tick ?? 0,
        fps: game ? Math.round(game.fps * 10) / 10 : 0,
        player: p
          ? { x: p.x, y: p.y, z: p.z, yaw: p.yaw, state: p.state, grounded: p.grounded, tank: p.tank, team: p.team }
          : { x: 0, y: 0, z: 0, yaw: 0, state: 'walk', grounded: false, tank: 0, team: 1 },
        coverage: game ? game.p.painter.coverage() : { sun: 0, gulf: 0, neutral: 1 },
        atlas: game ? { size: game.p.atlas.size, count: game.p.atlas.count, overlaps: game.p.atlas.overlaps } : { size: 0, count: 0, overlaps: 0 },
        startedBy: app.startedBy,
        pointerLocked: !!document.pointerLockElement,
      };
      if (app.error) s.error = app.error;
      return s;
    },
    teamUnderFeet(): TeamId | null {
      const game = g();
      if (!game) return null;
      const p = game.p.player;
      return game.p.painter.teamUnder(p.x, p.y, p.z);
    },
    paintHash(): string {
      const game = g();
      return game ? game.p.painter.hash() : '';
    },
    flips(): number {
      const game = g();
      return game ? game.p.painter.flips : 0;
    },
    async shot(name: string): Promise<{ ok: boolean; path?: string }> {
      const game = g();
      if (!game) return { ok: false };
      game.render(0, 1);
      const url = game.p.canvas.toDataURL('image/png');
      try {
        const res = await fetch('/__shot/' + encodeURIComponent(String(name || 'shot')), {
          method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: url,
        });
        const body = await res.json().catch(() => ({})) as { ok?: boolean; path?: string };
        return { ok: res.ok && body.ok !== false, path: body.path };
      } catch {
        return { ok: false };
      }
    },
    // ── dev-only
    teleport(x: number, y: number, z: number, yaw?: number): void {
      devOnly('teleport');
      const game = g();
      if (!game) throw new Error('game not loaded');
      game.p.player.teleport(x, y, z, yaw);
    },
    splat(x: number, y: number, z: number, r: number, team: TeamId): number {
      devOnly('splat');
      const game = g();
      if (!game) throw new Error('game not loaded');
      return game.p.painter.splat(x, y, z, { radius: r, team });
    },
    start(): void {
      devOnly('start');
      const game = g();
      if (!game) throw new Error('game not loaded (phase ' + app.phase + ')');
      game.devStart();
    },
    // ── harness read-backs (additive)
    minimapPixel(): { px: number; py: number; rgba: number[]; sun: number[]; gulf: number[] } | null {
      const game = g();
      if (!game) return null;
      const p = game.p.player;
      const r = game.p.hud.minimapPixel(p.x, p.z);
      if (!r) return null;
      return { ...r, sun: rgb255(teamById(1).dye), gulf: rgb255(teamById(2).dye) };
    },
    render(): Record<string, unknown> | null {
      const game = g();
      if (!game) return null;
      const ad = game.p.rig.adaptive();
      const c = game.p.canvas;
      return {
        ...game.p.rig.stats(), gpu: game.p.rig.gpu(), fps: game.fps, frames: game.frames,
        // adaptive render resolution (view/renderer.ts)
        quality: ad.quality, scale: ad.scale, scaleMin: ad.min, scaleMax: ad.max, buffer: [c.width, c.height],
        targetMs: ad.targetMs, p90: ad.p90, clockMs: ad.clockMs, scaleChanges: ad.changes, scaleLast: ad.last,
        mapMerge: game.p.map.merge,
      };
    },
    /** dev-only live handles for console debugging (renderer, scene, game parts) */
    get dev(): Record<string, unknown> | null {
      const game = g();
      if (!app.dev || !game) return null;
      return { game, renderer: game.p.rig.renderer, scene: game.p.scene, camera: game.p.cam.camera, parts: game.p };
    },
  };
  (window as unknown as { __DF__: typeof api }).__DF__ = api;
}
