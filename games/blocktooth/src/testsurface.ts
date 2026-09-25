// BLOCKTOOTH — the in-page test surface `window.__BT__` + the portal contract `window.__PAUSE__`
// (CONTRACT.md §14). app lane.
//
//   __BT__.version                 build marker
//   __BT__.world                   the live World (READ-ONLY by convention; null outside a run)
//   __BT__.state()                 flat snapshot for gates (screen, titan pose, progress, drafts, boss, run, fps, draws…)
//   __BT__.newRun({titan, biome, seed, skipSlate?})   resolves when the slate is up (or play began)
//   __BT__.step(n, input?)         n sim ticks synchronously — ONLY while frozen (freeze(true) first)
//   __BT__.freeze(on)              freeze / unfreeze the sim in play (views keep idling)
//   __BT__.dismiss()               close the slate / draft / tabloid / pause through its own path
//   __BT__.cheat.*                 dev only (?dev=1): xp mass rank level god spawn boss killAll noSpawns heal time
//   __BT__.shot(name)              render a frame, POST the PNG to /__shot/<name>, resolve the saved path
//   __BT__.perf()                  frame-time ring stats {fps, p50, p99, max, simMs}
//   __BT__.events(n)               the last n sim events (ring of 400)
//   v2 (FEATURES_V2 §13.3, pre-wired by L0 against the stubs):
//   __BT__.state().v2              UPROAR, objectives, power-ups, endless, tally, map, meta, cine, draft, profile
//   __BT__.state().v2dom           read-only DOM snapshot of the v2 HUD (fixed data-v2 hooks lane L8 puts on)
//   __BT__.newRun({…, meta?})      explicit RunMeta for the run
//   __BT__.cheat.{ult, powerup, objective, endless, evolveReady, bossSpawn, tillOpen}   dev only
//   __PAUSE__.{pause, resume, toggle}
//
// Cheats mutate the world between ticks through app.mutate(), which routes any events they emit
// (rankUp, levelUp, enemySpawn, alert, bossSpawn, enemyKilled…) to the views/HUD/audio exactly like
// a tick's events — so e.g. cheat.rank() still gets the camera punch, MASS BREACH and hit-stop.

import type { App, Screen } from './game.ts';
import type {
  BiomeId, BossId, EndlessState, EnemyKind, ObjectiveKind, ObjectiveTarget, PowerUpKind, RunMeta, RunStats, SimEvent,
  TitanId, TitanInput, UltPhase, World,
} from './core/types.ts';
import { BIOME_IDS, BOSS_IDS, ENEMY_KINDS, OBJECTIVE_KINDS, POWERUP_KINDS, TITAN_IDS } from './core/types.ts';
import { CAMERA, CITY, cameraDistance, rankForLevel } from './core/config.ts';
import { frameStats } from './core/loop.ts';
import type * as THREE from 'three';
import type { RenderCore } from './render/renderer.ts';
import { gainGrowth, gainXp, growToRank, healTitan } from './titans/titansim.ts';
import { spawnEnemy } from './ai/enemies.ts';
import { spawnBoss } from './ai/bosses/index.ts';
import { killEnemy } from './combat/damage.ts';
import { BIOMES } from './data/biomes.ts';
// v2 (L0 stubs; lanes fill them)
import { UPGRADE_BY_ID } from './data/upgrades.ts';
import { applyUpgrade } from './upgrades/engine.ts';
import { bossUltHit } from './ai/bosses/index.ts';
import { addUproar } from './meta/ultimate.ts';
import { spawnObjective } from './meta/objectives.ts';
import { spawnPowerup } from './meta/powerups.ts';
import { sanitizeRunMeta } from './meta/perks.ts';

export const BT_VERSION = 'blocktooth-0.1.0';

export interface BtBossState {
  id: string; phase: number; hp: number; maxHp: number; meter: number; attack: string | null;
  alive: boolean; introT: number; staggerT: number; x: number; z: number;
}

export interface BtState {
  screen: Screen;
  titan: TitanId; biome: BiomeId; seed: number;
  t: number | null; tick: number | null;
  rank: number | null; height: number | null; level: number | null; xp: number | null;
  hp: number | null; maxHp: number | null; mass: number | null;
  x: number | null; z: number | null; heading: number | null;
  alive: boolean | null; abilityCd: number | null; dashCharges: number | null;
  enemies: number | null; pickups: number | null;
  floorsEaten: number | null; buildingsLeveled: number | null; propsEaten: number | null;
  kills: number | null; crushed: number | null;
  drafts: { pending: number; levelUps: number; chests: number; rerolls: number; offer: string[] | null };
  owned: Record<string, number>;
  boss: BtBossState | null;
  run: RunStats | null;
  frozen: boolean; testFrozen: boolean; ending: boolean;
  fps: number; draws: number; tris: number; programs: number;
  /** adaptive render scale applied to the quality DPR (1 = full resolution) */
  renderScale: number;
  /** DynRes internals: estimated display interval (ms), last live window's missed-frame %, steps taken */
  dynres: { intervalMs: number; lastMissPct: number; down: number; up: number };
  /** v2 (FEATURES_V2 §13.3). World-derived parts are null outside a run. */
  v2: BtV2State;
  /** v2 read-only DOM snapshot for real-input checks (every count 0 with the L0 stubs). */
  v2dom: BtV2Dom;
}

export interface BtV2State {
  ult: { charge: number; phase: UltPhase; fired: number; ready: boolean; r: number; invulnT: number } | null;
  objectives: { id: number; kind: ObjectiveKind; x: number; z: number; t: number; life: number; target: ObjectiveTarget; targetId: number }[];
  powerups: { id: number; kind: PowerUpKind; x: number; z: number; t: number }[];
  power: { redLightT: number; rushHourT: number } | null;
  endless: EndlessState | null;
  tally: {
    ults: number; objectives: Record<ObjectiveKind, number>; powerups: Record<PowerUpKind, number>;
    evolutions: number; banishes: number; locks: number; rerolls: number;
  } | null;
  map: { overloadsDone: number; reliefsDone: number; annexesDone: number } | null;
  meta: RunMeta | null;
  cine: { shot: string; t: number } | null;
  draft: { banishLeft: number; lockLeft: number; locked: string | null; banished: string[] } | null;
  profile: { done: string[]; newUnlocks: string[] };
}

export interface BtV2Dom {
  barSlots: number; barBadges: string[]; activeCdText: string; meterPct: number;
  trackerRows: number; markers: number; toasts: number;
}

export interface BtPerf { fps: number; p50: number; p99: number; max: number; simMs: number; simTickMs: number; samples: number }

export interface BtCheats {
  xp(n?: number): number;
  /** @deprecated SIZE comes from LEVEL now: grows by n % of the current level's XP bar (gainGrowth). */
  mass(n?: number): number;
  rank(r: number | string): number;
  /** jump to LEVEL n (and the Size it implies) — real level/rank-ups, no drafts queued. */
  level(n: number): number;
  god(on?: boolean): boolean;
  spawn(kind: EnemyKind, n?: number): number;
  boss(): string | null;
  killAll(): number;
  noSpawns(on?: boolean): boolean;
  heal(): number;
  time(sec: number): number;
  // ── v2 (FEATURES_V2 §13.3) — cheats only SET UP state; acceptance actions are real keys / walks ──
  /** add UPROAR points (raw, not × the ultCharge stat); returns the charge */
  ult(points?: number): number;
  /** spawn a power-up of `kind` 3 H straight ahead of the titan; returns its id or null */
  powerup(kind: PowerUpKind): number | null;
  /** place an objective now; `ahead` (m) moves a free-standing one (RELIEF DEPOT) straight ahead of the titan */
  objective(kind: ObjectiveKind, ahead?: number): number | null;
  /** field + kill the city's boss so the run clears, and let the clear tabloid pick KEEP GOING */
  endless(): boolean;
  /** set owned stacks so the evolution's recipe is ready (base maxed, `with` ≥ 1) */
  evolveReady(evoId: string): boolean;
  /** field any boss id (incl. parkade6) */
  bossSpawn(id: BossId): string | null;
  /** PARKADE-6 only: open the TILL for `s` seconds */
  tillOpen(s: number): number;
}

export interface BtSurface {
  readonly version: string;
  readonly world: World | null;
  state(): BtState;
  newRun(opts: { titan?: TitanId; biome?: BiomeId; seed?: number; skipSlate?: boolean; meta?: RunMeta }): Promise<void>;
  step(n: number, input?: Partial<TitanInput>): number;
  freeze(on: boolean): void;
  dismiss(): Promise<boolean>;
  cheat: BtCheats;
  shot(name: string): Promise<string>;
  perf(): BtPerf;
  events(n?: number): SimEvent[];
  /** dev only: per-object triangle/draw breakdown of the visible scene (main pass, no shadows) */
  renderBreakdown?(top?: number): BtRenderBreakdown;
  /** dev only: the live render core (scene / renderer / camera) for perf attribution probes */
  readonly debugCore?: RenderCore;
}

export interface BtRenderBreakdown {
  totalTris: number;
  totalDraws: number;
  /** grouped by the scene's top-level child (view roots) */
  groups: { name: string; tris: number; draws: number }[];
  /** the heaviest single meshes */
  meshes: { path: string; tris: number; instances: number; castShadow: boolean }[];
}

export interface PauseSurface { pause(): void; resume(): void; toggle(): void }

declare global {
  interface Window {
    __BT__?: BtSurface;
    __PAUSE__?: PauseSurface;
  }
}

const ROMAN: Record<string, number> = { I: 0, II: 1, III: 2, IV: 3, V: 4 };

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function toInput(inp: Partial<TitanInput> | null | undefined): TitanInput {
  let mx = num(inp?.mx, 0), mz = num(inp?.mz, 0);
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  return { mx, mz, ability: !!inp?.ability, abilityHeld: !!inp?.abilityHeld, dash: !!inp?.dash };
}

export function installTestSurface(app: App): BtSurface {
  const dev = app.params.dev;

  const need = (what: string): World => {
    const w = app.world;
    if (!w) throw new Error(`${what}: no live run (screen=${app.screen})`);
    return w;
  };
  const devOnly = (what: string): World => {
    if (!dev) throw new Error(`cheat.${what}: cheats are disabled — open the page with ?dev=1`);
    return need(`cheat.${what}`);
  };

  /** Visible nodes carrying a fixed data-v2 hook (lane L8 puts them on its nodes, §13.3). */
  const v2nodes = (tag: string): HTMLElement[] => {
    try {
      return Array.from(document.querySelectorAll<HTMLElement>(`[data-v2="${tag}"]`)).filter((n) => n.getClientRects().length > 0);
    } catch { return []; }
  };
  const v2dom = (): BtV2Dom => {
    const meter = v2nodes('meter')[0];
    const pct = meter ? Number(meter.dataset.pct) : 0;
    const cd = v2nodes('active-cd')[0];
    return {
      barSlots: v2nodes('bar-slot').length,
      barBadges: v2nodes('badge').map((n) => (n.textContent || '').trim()),
      activeCdText: cd ? (cd.textContent || '').trim() : '',
      meterPct: Number.isFinite(pct) ? pct : 0,
      trackerRows: v2nodes('tracker-row').length,
      markers: v2nodes('marker').length,
      toasts: v2nodes('toast').length,
    };
  };
  const v2state = (w: World | null): BtV2State => {
    const P = app.profile;
    const profile = { done: Object.keys(P.done), newUnlocks: P.newUnlocks.slice() };
    if (!w) {
      return {
        ult: null, objectives: [], powerups: [], power: null, endless: null, tally: null, map: null, meta: null,
        cine: app.cineShot, draft: null, profile,
      };
    }
    const u = w.ult, m = w.map, t = w.tally, U = w.upgrades;
    return {
      ult: { charge: u.charge, phase: u.phase, fired: u.fired, ready: u.ready, r: u.r, invulnT: u.invulnT },
      objectives: m.objectives.filter((o) => o.alive).map((o) => ({ id: o.id, kind: o.kind, x: o.x, z: o.z, t: o.t, life: o.life, target: o.target, targetId: o.targetId })),
      powerups: m.powerups.filter((o) => o.alive).map((o) => ({ id: o.id, kind: o.kind, x: o.x, z: o.z, t: o.t })),
      power: { redLightT: m.redLightT, rushHourT: m.rushHourT },
      endless: w.endless ? { ...w.endless } : null,
      tally: {
        ults: t.ults, objectives: { ...t.objectives }, powerups: { ...t.powerups },
        evolutions: t.evolutions, banishes: t.banishes, locks: t.locks, rerolls: t.rerolls,
      },
      map: { overloadsDone: m.overloadsDone, reliefsDone: m.reliefsDone, annexesDone: m.annexesDone },
      meta: { ...w.meta, unlocked: w.meta.unlocked.slice() },
      cine: app.cineShot,
      draft: { banishLeft: U.banishLeft, lockLeft: U.lockLeft, locked: U.locked, banished: U.banished.slice() },
      profile,
    };
  };

  const state = (): BtState => {
    const w = app.world;
    const c = app.choice;
    const fs = frameStats();
    const rs = app.renderStats();
    const base = {
      screen: app.screen,
      frozen: !app.loop.simEnabled,
      testFrozen: app.testFrozen,
      ending: app.isEnding,
      fps: Math.round(fs.fps * 10) / 10,
      draws: rs.draws, tris: rs.tris, programs: rs.programs,
      renderScale: app.dynres.scale,
      dynres: {
        intervalMs: Math.round(app.dynres.displayInterval * 10000) / 10,
        lastMissPct: app.dynres.lastMiss < 0 ? -1 : Math.round(app.dynres.lastMiss * 1000) / 10,
        down: app.dynres.steps.down, up: app.dynres.steps.up,
      },
      v2: v2state(w),
      v2dom: v2dom(),
    };
    if (!w) {
      return {
        ...base,
        titan: c.titan, biome: c.biome, seed: c.seed,
        t: null, tick: null, rank: null, height: null, level: null, xp: null, hp: null, maxHp: null, mass: null,
        x: null, z: null, heading: null, alive: null, abilityCd: null, dashCharges: null,
        enemies: null, pickups: null, floorsEaten: null, buildingsLeveled: null, propsEaten: null, kills: null, crushed: null,
        drafts: { pending: 0, levelUps: 0, chests: 0, rerolls: 0, offer: null },
        owned: {}, boss: null, run: null,
      };
    }
    const T = w.titan, U = w.upgrades, b = w.boss;
    let enemies = 0, pickups = 0;
    for (const e of w.enemies) if (e.alive) enemies++;
    for (const p of w.pickups) if (p.alive) pickups++;
    return {
      ...base,
      titan: w.titanId, biome: w.biomeId, seed: w.seed,
      t: w.t, tick: w.tick,
      rank: T.rank, height: T.height, level: T.level, xp: T.xp, hp: T.hp, maxHp: T.maxHp, mass: T.mass,
      x: T.x, z: T.z, heading: T.heading, alive: T.alive, abilityCd: T.abilityCd, dashCharges: T.dashCharges,
      enemies, pickups,
      floorsEaten: T.floorsEaten, buildingsLeveled: T.buildingsLeveled, propsEaten: T.propsEaten,
      kills: T.kills, crushed: T.crushed,
      drafts: {
        pending: U.pendingDrafts + U.chestDrafts,
        levelUps: U.pendingDrafts,
        chests: U.chestDrafts,
        rerolls: U.rerolls,
        offer: U.offer ? U.offer.slice() : null,
      },
      owned: { ...U.owned },
      boss: b ? {
        id: b.id, phase: b.phase, hp: b.hp, maxHp: b.maxHp, meter: b.meter, attack: b.attack,
        alive: b.alive, introT: b.introT, staggerT: b.staggerT, x: b.x, z: b.z,
      } : null,
      run: { ...w.run },
    };
  };

  const cheat: BtCheats = {
    xp(n = 100) {
      const w = devOnly('xp');
      const amount = Math.max(0, num(n, 100));
      app.mutate((ww) => gainXp(ww, amount));
      return w.titan.level;
    },
    /** @deprecated (SIZE is level-driven): n % of the current level's XP bar via the sim's own
     *  gainGrowth (the 'grow' upgrade action) — may level/rank up and owes drafts like real XP. */
    mass(n = 100) {
      const w = devOnly('mass');
      const frac = Math.max(0, num(n, 100)) / 100;
      app.mutate((ww) => gainGrowth(ww, frac));
      return w.titan.level;
    },
    /** Grow to RankIndex r (0..4; a roman numeral string also works). Never shrinks. Goes through
     *  the sim's own rank-up (growToRank: level = RANK_LEVELS[r], stats, rankUp events, the MASS
     *  BREACH tween) and queues NO drafts. */
    rank(r) {
      const w = devOnly('rank');
      const key = typeof r === 'string' ? r.trim().toUpperCase() : '';
      const target = Object.prototype.hasOwnProperty.call(ROMAN, key) ? ROMAN[key] : Math.floor(num(r, 0));
      const want = Math.max(0, Math.min(4, target));
      const T = w.titan;
      if (want <= T.rank || !T.alive) return T.rank;
      app.mutate((ww) => { growToRank(ww, want); });
      return T.rank;
    },
    /** Jump to LEVEL n (never down): the Size it implies (rankForLevel) through the real rank-ups,
     *  then the per-level grow tween; empty XP bar; NO drafts queued. */
    level(n) {
      const w = devOnly('level');
      const L = Math.max(1, Math.min(200, Math.floor(num(n, 1))));
      if (!w.titan.alive || L <= w.titan.level) return w.titan.level;
      app.mutate((ww) => { growToRank(ww, rankForLevel(L), L); });
      return w.titan.level;
    },
    god(on = true) {
      const w = devOnly('god');
      w.cheats.god = !!on;
      return w.cheats.god;
    },
    spawn(kind, n = 1) {
      const w = devOnly('spawn');
      if (!(ENEMY_KINDS as readonly string[]).includes(kind)) throw new Error(`cheat.spawn: unknown kind '${String(kind)}' (${ENEMY_KINDS.join(', ')})`);
      const count = Math.max(1, Math.min(400, Math.floor(num(n, 1))));
      const T = w.titan;
      let alive = 0;
      for (const e of w.enemies) if (e.alive) alive++;
      let made = 0;
      app.mutate((ww) => {
        // 0.55 × the AUTO view height: inside the frame (the perf gate's "250 enemies in view"
        // load; the sim's own spawn ring sits past the screen edge — enemies.ts ringPoint)
        const R = Math.max(14, 0.55 * cameraDistance(T.height, T.rank) * 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360));
        for (let i = 0; i < count && alive < CITY.maxEnemies; i++) {
          // cosmetic placement randomness is app-side; spawnEnemy clamps + pushes out of buildings
          const a = Math.random() * Math.PI * 2;
          const rr = R * (0.85 + Math.random() * 0.3);
          spawnEnemy(ww, kind, T.x + Math.sin(a) * rr, T.z + Math.cos(a) * rr, kind === 'elite' ? { elite: true } : undefined);
          alive++; made++;
        }
      });
      return made;
    },
    boss() {
      const w = devOnly('boss');
      app.mutate((ww) => spawnBoss(ww, BIOMES[ww.biomeId].boss));
      return w.boss && w.boss.alive ? w.boss.id : null;
    },
    killAll() {
      devOnly('killAll');
      let n = 0;
      app.mutate((ww) => {
        for (const e of ww.enemies) if (e.alive) { killEnemy(ww, e, false); n++; }
      });
      return n;
    },
    noSpawns(on = true) {
      const w = devOnly('noSpawns');
      w.cheats.noSpawns = !!on;
      return w.cheats.noSpawns;
    },
    heal() {
      const w = devOnly('heal');
      app.mutate((ww) => healTitan(ww, ww.titan.maxHp));
      return w.titan.hp;
    },
    /** Set the run clock to `sec` sim seconds (jumps the director's schedule: waves, elite, boss). */
    time(sec) {
      const w = devOnly('time');
      const s = num(sec, w.t);
      w.t = Math.max(0, s);
      return w.t;
    },
    // ── v2 (FEATURES_V2 §13.3) ──
    ult(points = 100) {
      const w = devOnly('ult');
      const n = Math.max(0, num(points, 100));
      app.mutate((ww) => addUproar(ww, n, true));
      return w.ult.charge;
    },
    powerup(kind) {
      devOnly('powerup');
      if (!(POWERUP_KINDS as readonly string[]).includes(kind)) throw new Error(`cheat.powerup: unknown kind '${String(kind)}' (${POWERUP_KINDS.join(', ')})`);
      return app.mutate((ww) => {
        const T = ww.titan, d = 3 * T.height;
        const p = spawnPowerup(ww, kind, T.x + Math.sin(T.heading) * d, T.z + Math.cos(T.heading) * d, true);
        return p ? p.id : null;
      });
    },
    objective(kind, ahead) {
      devOnly('objective');
      if (!(OBJECTIVE_KINDS as readonly string[]).includes(kind)) throw new Error(`cheat.objective: unknown kind '${String(kind)}' (${OBJECTIVE_KINDS.join(', ')})`);
      return app.mutate((ww) => {
        const o = spawnObjective(ww, kind);
        if (!o) return null;
        const a = num(ahead, NaN);
        if (Number.isFinite(a) && o.target === 'none') {
          const T = ww.titan;
          o.x = T.x + Math.sin(T.heading) * a;
          o.z = T.z + Math.cos(T.heading) * a;
        }
        return o.id;
      });
    },
    endless() {
      const w = devOnly('endless');
      app.autoEndlessOnce = true;
      app.mutate((ww) => {
        if (!ww.boss || !ww.boss.alive) spawnBoss(ww, BIOMES[ww.biomeId].boss);
        const b = ww.boss;
        if (b && b.alive) { b.introT = 0; bossUltHit(ww, 1, 0); }
      });
      return !!w.boss && !w.boss.alive;
    },
    evolveReady(evoId) {
      const w = devOnly('evolveReady');
      const def = UPGRADE_BY_ID[evoId];
      if (!def || !def.evo) throw new Error(`cheat.evolveReady: '${String(evoId)}' is not an evolution`);
      const base = UPGRADE_BY_ID[def.evo.base], withC = UPGRADE_BY_ID[def.evo.with];
      if (!base || !withC) throw new Error(`cheat.evolveReady: recipe of '${evoId}' names an unknown card`);
      app.mutate((ww) => {
        for (let i = 0; i < 64 && (ww.upgrades.owned[base.id] ?? 0) < base.maxStacks; i++) applyUpgrade(ww, base.id);
        if ((ww.upgrades.owned[withC.id] ?? 0) < 1) applyUpgrade(ww, withC.id);
      });
      return (w.upgrades.owned[base.id] ?? 0) >= base.maxStacks && (w.upgrades.owned[withC.id] ?? 0) >= 1;
    },
    bossSpawn(id) {
      const w = devOnly('bossSpawn');
      if (!(BOSS_IDS as readonly string[]).includes(id)) throw new Error(`cheat.bossSpawn: unknown boss '${String(id)}' (${BOSS_IDS.join(', ')})`);
      app.mutate((ww) => spawnBoss(ww, id));
      return w.boss && w.boss.alive ? w.boss.id : null;
    },
    tillOpen(sec) {
      const w = devOnly('tillOpen');
      const b = w.boss;
      if (!b || !b.alive || b.id !== 'parkade6') throw new Error('cheat.tillOpen: needs a live PARKADE-6 (cheat.bossSpawn(\'parkade6\'))');
      b.data.tillOpen = Math.max(0, num(sec, 3));
      return b.data.tillOpen;
    },
  };

  const surface: BtSurface = {
    version: BT_VERSION,
    get world() { return app.world; },
    state,
    async newRun(opts) {
      const o = opts || {};
      const c = app.choice;
      const titan = typeof o.titan === 'string' && (TITAN_IDS as readonly string[]).includes(o.titan) ? o.titan : c.titan;
      const biome = typeof o.biome === 'string' && (BIOME_IDS as readonly string[]).includes(o.biome) ? o.biome : c.biome;
      const seed = Math.abs(Math.floor(num(o.seed, Math.floor(Math.random() * 0x7fffffff)))) >>> 0;
      const meta = o.meta !== undefined ? sanitizeRunMeta(o.meta) : undefined;   // v2
      await app.startRun({ titan, biome, seed, skipSlate: !!o.skipSlate, meta });
    },
    step(n, input) {
      need('step');
      return app.stepFrozen(num(n, 1), toInput(input));
    },
    freeze(on) { app.freeze(!!on); },
    dismiss() { return app.dismiss(); },
    cheat,
    async shot(name) {
      const nm = String(name ?? 'shot') || 'shot';
      const url = app.captureFrame('image/png');
      const res = await fetch('/__shot/' + encodeURIComponent(nm), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: url,
      });
      let body: { ok?: boolean; path?: string; error?: string } = {};
      try { body = await res.json() as typeof body; } catch { /* non-JSON reply */ }
      if (!res.ok || !body.ok || typeof body.path !== 'string') {
        throw new Error(`shot(${nm}) failed: HTTP ${res.status} ${body.error ?? ''}`.trim());
      }
      return body.path;
    },
    perf() {
      const f = frameStats();
      return { fps: f.fps, p50: f.p50, p99: f.p99, max: f.max, simMs: f.simMs, simTickMs: f.simTickMs, samples: f.samples };
    },
    events(n = 50) {
      return app.recentEvents(num(n, 50)).map((e) => ({ ...e }) as SimEvent);
    },
  };

  if (dev) {
    Object.defineProperty(surface, 'debugCore', { get: () => app.core, enumerable: false });
    surface.renderBreakdown = (top = 25): BtRenderBreakdown => {
      const scene = app.core.scene;
      const groups = new Map<string, { tris: number; draws: number }>();
      const meshes: BtRenderBreakdown['meshes'] = [];
      let totalTris = 0, totalDraws = 0;
      const visit = (o: THREE.Object3D, group: string, path: string): void => {
        if (!o.visible) return;
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) {
          const g = m.geometry;
          const pos = g.getAttribute('position');
          let n = g.index ? g.index.count : (pos ? pos.count : 0);
          if (g.drawRange && Number.isFinite(g.drawRange.count)) n = Math.min(n, g.drawRange.count);
          const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
          const tris = Math.floor(n / 3) * inst;
          if (inst > 0 && n > 0) {
            totalTris += tris; totalDraws++;
            const gr = groups.get(group) ?? { tris: 0, draws: 0 };
            gr.tris += tris; gr.draws++; groups.set(group, gr);
            meshes.push({ path, tris, instances: inst, castShadow: m.castShadow });
          }
        }
        for (let i = 0; i < o.children.length; i++) {
          const c = o.children[i];
          visit(c, group, path + '/' + (c.name || c.type) + '#' + i);
        }
      };
      for (let i = 0; i < scene.children.length; i++) {
        const c = scene.children[i];
        const name = (c.name || c.type) + '#' + i;
        visit(c, name, name);
      }
      meshes.sort((a, b) => b.tris - a.tris);
      return {
        totalTris, totalDraws,
        groups: [...groups.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.tris - a.tris),
        meshes: meshes.slice(0, Math.max(1, top | 0)),
      };
    };
  }

  const pauseSurface: PauseSurface = {
    pause: () => app.pause(),
    resume: () => app.resume(),
    toggle: () => app.togglePause(),
  };

  window.__BT__ = surface;
  window.__PAUSE__ = pauseSurface;
  return surface;
}
