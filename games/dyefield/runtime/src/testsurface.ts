// DYEFIELD — window.__DF__ test surface (CONTRACT §6 + §11). Installed at boot (before the game
// exists), so the harness can poll state().phase through boot → loading → ready → play.
//
//   version · state() · teamUnderFeet() · paintHash() · flips() · shot(name)
//   §11: match() — phase, timeLeft, countdown, runners[] {id, name, team, state, hp, tank, alive, x, y, z,
//        hidden, …}, result, coverage, event counts · events(n) — the last n drained sim events
//   dev-only (?dev=1): teleport(x, y, z, yaw?) · splat(x, y, z, r, team) · start()
//        §11: setTimeLeft(s) · damage(pid, n) · setTank(pid, v)
//   extra (harness read-backs, not in the contract): minimapPixel() — the DOM minimap canvas pixel
//   under the runner plus the team colors; render() — renderer counters, the adaptive render scale and
//   the static map merge report; hud() — the visible HUD text (timer, toast, kill feed, slates, crests);
//   aim() — the camera yaw / pitch and the reticle's world point.
//   phase 6: kit() — the human's kit read-outs (charge, rolling, special meter, sub cooldown, layer summary,
//   the left-hand → grip_L distance of a two-handed kit) · fx() — live FX counts (drops, jelly, puddles,
//   cells, raining cells, glint lines, beam flashes)
//   dev-only phase 6: fillSpecial(pid = 0) — fills the special meter and arms it (sets the Runner's public
//   `special` = 1 and `specialReady` = true; MatchWorld has no dev hook for it, and the 'ready' event is
//   NOT emitted) · freeze(on) — stops the sim AND the visual clock while rendering continues, so a
//   screenshot can catch an exact moment (the harness unfreezes right after).

import type { AppStatus } from './game.ts';
import type { Coverage, MoveState, TeamId } from './core/types.ts';
import { teamById, hexToRgb01 } from './core/data.ts';

export interface DFState {
  phase: AppStatus['phase'];
  mapId: string;
  tick: number;
  fps: number;
  player: { x: number; y: number; z: number; yaw: number; state: MoveState; grounded: boolean; tank: number; team: TeamId; hp: number; alive: boolean; slickForm: boolean };
  coverage: Coverage;
  atlas: { size: number; count: number; overlaps: number };
  match?: { phase: string; timeLeft: number; countdown: number };
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
  const need = (name: string) => {
    const game = g();
    if (!game) throw new Error(`__DF__.${name}: game not loaded (phase ${app.phase})`);
    return game;
  };
  const api = {
    version: app.version,
    state(): DFState {
      const game = g();
      const p = game?.human;
      const s: DFState = {
        phase: app.phase,
        mapId: app.mapId,
        tick: game?.tick ?? 0,
        fps: game ? Math.round(game.fps * 10) / 10 : 0,
        player: p
          ? { x: p.x, y: p.y, z: p.z, yaw: p.yaw, state: p.state, grounded: p.grounded, tank: p.tank, team: p.team, hp: p.hp, alive: p.alive, slickForm: p.slickForm }
          : { x: 0, y: 0, z: 0, yaw: 0, state: 'walk', grounded: false, tank: 0, team: 1, hp: 0, alive: false, slickForm: false },
        coverage: game ? game.p.painter.coverage() : { sun: 0, gulf: 0, neutral: 1 },
        atlas: game ? { size: game.p.atlas.size, count: game.p.atlas.count, overlaps: game.p.atlas.overlaps } : { size: 0, count: 0, overlaps: 0 },
        startedBy: app.startedBy,
        pointerLocked: !!document.pointerLockElement,
      };
      if (game) s.match = { phase: game.world.phase, timeLeft: game.world.timeLeft, countdown: game.world.countdown };
      if (app.error) s.error = app.error;
      return s;
    },
    teamUnderFeet(): TeamId | null {
      const game = g();
      if (!game) return null;
      const p = game.human;
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
    // ── §11 match read-backs
    match(): Record<string, unknown> | null {
      const game = g();
      return game ? game.matchInfo() : null;
    },
    events(n = 50): unknown[] {
      const game = g();
      return game ? game.events(n) : [];
    },
    // ── dev-only
    teleport(x: number, y: number, z: number, yaw?: number): void {
      devOnly('teleport');
      need('teleport').world.devTeleport(0, x, y, z, yaw);
    },
    splat(x: number, y: number, z: number, r: number, team: TeamId): number {
      devOnly('splat');
      return need('splat').p.painter.splat(x, y, z, { radius: r, team });
    },
    start(): void {
      devOnly('start');
      need('start').devStart();
    },
    setTimeLeft(s: number): void {
      devOnly('setTimeLeft');
      need('setTimeLeft').world.devSetTimeLeft(s);
    },
    damage(pid: number, n: number): void {
      devOnly('damage');
      need('damage').world.devDamage(pid, n);
    },
    setTank(pid: number, v: number): void {
      devOnly('setTank');
      need('setTank').world.devSetTank(pid, v);
    },
    fillSpecial(pid = 0): boolean {
      devOnly('fillSpecial');
      const r = need('fillSpecial').world.runners[pid];
      if (!r) return false;
      r.special = 1;
      r.specialReady = true;
      return true;
    },
    freeze(on: boolean): boolean {
      devOnly('freeze');
      const game = need('freeze');
      game.frozen = !!on;
      return game.frozen;
    },
    // ── harness read-backs (additive)
    kit(): Record<string, unknown> | null {
      const game = g();
      if (!game) return null;
      const r = game.human;
      const rv = game.p.players.view(0);
      const grip = game.p.players.gripError(0);
      return {
        kit: r.kit, charge: r.charge, rolling: r.rolling, flicking: r.flicking, leaping: r.leaping, special: r.special,
        specialReady: r.specialReady, specialActive: r.specialActive, specialT: r.specialT, subCooldown: r.subCooldown, tank: r.tank,
        subs: r.subs, flicks: r.flicks, beams: r.beams, bursts: r.bursts, shots: r.shots, firing: r.firing,
        anim: rv ? rv.describe() : null, gripError: grip === null ? null : Math.round(grip * 1000) / 1000,
      };
    },
    fx(): Record<string, unknown> | null {
      const game = g();
      return game ? { ...game.p.fx.live, emitted: game.p.fx.emitted } : null;
    },
    minimapPixel(): { px: number; py: number; rgba: number[]; sun: number[]; gulf: number[] } | null {
      const game = g();
      if (!game) return null;
      const p = game.human;
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
        quality: ad.quality, scale: ad.scale, scaleMin: ad.min, scaleMax: ad.max, buffer: [c.width, c.height],
        targetMs: ad.targetMs, p90: ad.p90, clockMs: ad.clockMs, scaleChanges: ad.changes, scaleLast: ad.last,
        mapMerge: game.p.map.merge, runnerTris: game.p.players.stats().bodyTris, particles: game.p.fx.emitted,
        projectiles: game.world.projectiles.count,
      };
    },
    hud(): Record<string, unknown> | null {
      const game = g();
      return game ? game.p.hud.readback() : null;
    },
    aim(): Record<string, unknown> | null {
      const game = g();
      if (!game) return null;
      const c = game.p.cam;
      return { yaw: c.yaw, pitch: c.pitch, boom: c.boom, slickBlend: c.slickBlend };
    },
    /** dev-only live handles for console debugging (renderer, scene, game parts) */
    get dev(): Record<string, unknown> | null {
      const game = g();
      if (!app.dev || !game) return null;
      return { game, renderer: game.p.rig.renderer, scene: game.p.scene, camera: game.p.cam.camera, parts: game.p, world: game.world };
    },
  };
  (window as unknown as { __DF__: typeof api }).__DF__ = api;
}
