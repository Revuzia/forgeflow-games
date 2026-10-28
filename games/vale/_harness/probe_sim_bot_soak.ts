// probe (lane SIM, wave W4): the bot soak — all-bot matches on ROLE-CORRECT lineups (each seat a
// native fighter of its role, with the bots' own pickLoadout, exactly as the real draft seats bots),
// headless at full sim speed, measured against the W4 done-list (_design/reviews/final_parity_review.md):
//
//   laning     (gameplay:G1)  Wicks dying before 14:00 last-hit by fighters ≥ 50 % · solo-laner cs at
//                             10:00 ≥ 45 · laners' in-lane share (lane+trade+push+allin over alive time
//                             1:00–14:00) ≥ 65 % · fighter deaths to Wicks or monsters with no enemy
//                             fighter involved (no credit, no assist) ≤ 5 %          — per difficulty
//   jungle     (gameplay:G2)  jungler level gap to the solo laners at 15:00 ≤ 1.5 (mean) · the grovehunter
//                             is not the role that dies most (deaths per game ≤ the laner roles' highest; like the
//                             structures median, enforced only with ≥ 16 RIFT games per difficulty)
//   structures (gameplay:G4)  median first structure on RIFT 9–12 min (a game with none by its end or the cut
//                             counts as later than all; enforced only with ≥ 16 RIFT games per difficulty —
//                             the 8-seed quick run reports it)
//   difficulty (gameplay:G3)  veteran beats novice ≥ 85 %, adept ≥ 65 % of mirrored games (each seed
//                             played twice with the sides swapped)
//   bridge     (gameplay:G5)  ≤ 25 % of games end in sudden death · 0 cores fall with a structure they
//                             require still standing · median length 15–18 min
//   items      (gameplay:G7)  finished (core/apex) items held per player at min(25:00, end) ≥ 2.5 ·
//                             ≥ 80 % of the finished items bought at least once · ≥ 1 anti-heal family
//                             (an item that applies 'grievous') · builds vary (a fighter's first two
//                             finished items differ between its games)
//
// Only the groups in ENFORCED fail the probe; the others are reported as "open" until the W4 package
// that owns them lands (and adds its group here).
//
//   node _harness/probe_sim_bot_soak.ts                 quick regression gate (npm run probe): RIFT,
//                                                       8 seeds × adept + veteran, cut at 15:00
//   node _harness/probe_sim_bot_soak.ts --full          the soak: RIFT 20 seeds × adept + veteran (full
//                                                       games), BRIDGE 20 × adept + veteran, mirrored
//                                                       veteran-vs-novice and veteran-vs-adept (10 seeds
//                                                       × 2 sides each), 3 worker processes
//   flags: --seeds N · --seed0 N · --diffs adept,veteran · --suites rift,bridge,mirror · --cut <s>
//          --jobs N (≤ 3) · --rules '<json>' (deep-merged into every probed mode's rules)
//          --label <name> (report: _harness/_reports/fw_W4_soak_<label>.json + .txt)
//
// The catalog is built in memory from content/ (the source of truth; dist-catalog may be stale).
// Determinism: every match is a pure function of (catalog, setup); the seat lineup is a pure function
// of the seed.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent, WorldView, PlayerView } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { fighterProfile, itemRole } from '../src/sim/bots/knowledge.ts';
import type { Player } from '../src/sim/entity.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const REPORTS = join(HERE, '_reports');

/** gate groups that fail the probe (the rest are reported as open) */
const ENFORCED = new Set<string>(['laning', 'items', 'jungle', 'structures']); // items: W4 G7 package; jungle + structures: W4 tempo-jungle package (2026-10-28)
/** the first-structure median and the role-deaths comparison need this many RIFT games per difficulty before
 *  they fail the probe (the 8-seed quick run is too few for either: it reports them) */
const STRUCT_MIN_GAMES = 16;

// ── args ────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (k: string): boolean => argv.includes(`--${k}`);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const FULL = has('full');
const WORKER = opt('worker', '');
const SEEDS = Number(opt('seeds', FULL ? '20' : '8'));
const SEED0 = Number(opt('seed0', '1'));
const DIFFS = opt('diffs', 'adept,veteran').split(',');
const SUITES = opt('suites', FULL ? 'rift,bridge,mirror' : 'rift').split(',');
const CUT = Number(opt('cut', FULL ? '0' : '900')) || 0;
const JOBS = Math.max(1, Math.min(3, Number(opt('jobs', FULL ? '3' : '1'))));
const RULES = opt('rules', '');
/** diagnostics only: deep-merge patches into catalog entries by id, e.g. '{"spells":{"glint_step":{...}},"items":{"notched_blade":{...}}}'
 *  (families: spells = setup.spells, items, units, teamBuffs). A patched run is never a gate result. */
const PATCH = opt('patch', '');
const LABEL = opt('label', FULL ? 'full' : 'quick');
const MIRROR_SEEDS = Number(opt('mirror-seeds', '10'));

// ── catalog ─────────────────────────────────────────────────────────────────────────────────────
function loadCatalog(): CatalogT {
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) {
    console.error('content build failed:', r.errors.slice(0, 5).map((d) => `${d.file} ${d.path}: ${d.msg}`).join('\n'));
    process.exit(77);
  }
  const c = r.catalog;
  if (PATCH) {
    const pt = JSON.parse(PATCH) as Record<string, Record<string, Record<string, unknown>>>;
    const fam: Record<string, { id: string }[]> = { spells: c.setup.spells, items: c.items, units: c.units, teamBuffs: c.teamBuffs };
    for (const [f, byId] of Object.entries(pt)) for (const [id, patch] of Object.entries(byId)) {
      const list = fam[f];
      const k = list ? list.findIndex((x) => x.id === id) : -1;
      if (k >= 0) list[k] = deepMerge(list[k] as unknown as Record<string, unknown>, patch) as unknown as { id: string };
    }
  }
  if (RULES) {
    const patch = JSON.parse(RULES) as Record<string, unknown>;
    for (const m of c.modes) m.rules = deepMerge(m.rules as unknown as Record<string, unknown>, patch) as unknown as typeof m.rules;
  }
  return c;
}
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
      ? deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
}

// ── lineups ─────────────────────────────────────────────────────────────────────────────────────
/** role-correct seats: seat i plays role i % perTeam with a native fighter of it (rotated by seed, the
 *  two teams offset by one), loadout from the bots' own pickLoadout for that role and the mode's pool */
export function roleLineup(catalog: CatalogT, modeId: string, seed: number, diffs: readonly [string, string]): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId);
  if (!mode) throw new Error(`no mode ${modeId}`);
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id);
  if (!queue) throw new Error(`no queue for ${modeId}`);
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  const all = catalog.fighters.map((f) => f.id).sort();
  const n = mode.teams * mode.perTeam;
  const pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  for (let i = 0; i < n; i++) {
    const team = Math.floor(i / mode.perTeam);
    const slot = i % mode.perTeam;
    const role = roles[slot % roles.length];
    const pl = natives.get(role) ?? all;
    const fighter = pl[(seed + slot + team) % pl.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({
      player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role,
      loadout: pickLoadout(catalog, fighter, pool, role),
      controller: 'bot', botDifficulty: (team === 0 ? diffs[0] : diffs[1]) as SeatSetup['botDifficulty'], colorIndex: i,
    });
  }
  return { matchId: `soak-${modeId}-${seed}-${diffs.join('-')}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

// ── one match ───────────────────────────────────────────────────────────────────────────────────
interface Job { suite: string; mode: string; seed: number; diffs: [string, string]; cut: number }
type KillerKind = 'fighter' | 'minion' | 'monster' | 'structure' | 'summon' | 'none' | 'other';
interface FDeath { t: number; p: number; role: string; mode: string; killer: KillerKind; killerDef: string; assists: number; involved: boolean }
interface GameRec {
  job: Job; reason: string; dur: number; winner: number; sudden: number; faults: string[];
  seats: { p: number; team: number; fighter: string; role: string; spells: string[] }[];
  wick14: Record<string, number>;
  cs10: number[]; cs14: number[]; lvl10: number[]; lvl15: number[];
  modeTicks: Record<string, number>[];
  recalls: number[];
  fdeaths: FDeath[];
  structs: { t: number; def: string; team: number }[];
  coreFalls: { t: number; team: number; standing: string[] }[];
  objs: { t: number; unit: string; team: number }[];
  buys: { t: number; p: number; item: string }[];
  fin25: number[];
  /** Gleam earned by play (Player.goldEarned) at min(25:00, end), and Gleam spent on finished items by then */
  gold25: number[];
  finSpent25: number[];
  /** Gleam unspent at min(25:00, end), and Gleam spent on consumables by then */
  bank25: number[];
  cons25: number[];
  finalItems: string[][];
  goldGraph: number[];
  kills: number[]; deaths: number[]; cs: number[]; levels: number[];
}

const LANE_MODES = new Set(['lane', 'trade', 'push', 'allin']);
const LANING_FROM = 60, LANING_TO = 840;

function runGame(catalog: CatalogT, job: Job): GameRec {
  const setup = roleLineup(catalog, job.mode, job.seed, job.diffs);
  const n = setup.seats.length;
  const finished = new Set(catalog.items.filter((i) => i.tier === 'core' || i.tier === 'apex').map((i) => i.id));
  const modeTicks: Record<string, number>[] = setup.seats.map(() => ({}));
  const ctrls: (BotController | null)[] = setup.seats.map(() => null);
  const modeOf = (p: number): string => (ctrls[p] as unknown as { mode?: string } | null)?.mode ?? '?';
  const factory = createBots(catalog, setup);
  const bots = (seat: SeatSetup, host: Parameters<typeof factory>[1]): BotController | null => {
    const c = factory(seat, host);
    if (!c) return null;
    const think = c.think.bind(c);
    const p = seat.player;
    ctrls[p] = c;
    c.think = (view: WorldView, pv: PlayerView) => {
      const r = think(view, pv);
      const t = view.time;
      if (view.phase === 'live' && t >= LANING_FROM && t <= LANING_TO) {
        const e = (pv as Player).ent;
        if (e && e.alive) { const md = (c as unknown as { mode?: string }).mode ?? '?'; modeTicks[p][md] = (modeTicks[p][md] ?? 0) + 1; }
      }
      return r;
    };
    return c;
  };
  const sim = createSim(catalog, setup, { bots, pregameSeconds: 0 });
  const rec: GameRec = {
    job, reason: 'cut', dur: 0, winner: -1, sudden: -1, faults: [],
    seats: setup.seats.map((s) => ({ p: s.player, team: s.team, fighter: s.fighter, role: s.role ?? '', spells: s.loadout.spells.slice() })),
    wick14: {}, cs10: [], cs14: [], lvl10: [], lvl15: [], modeTicks, recalls: new Array<number>(n).fill(0), fdeaths: [], structs: [], coreFalls: [], objs: [],
    buys: [], fin25: [], gold25: [], finSpent25: [], bank25: [], cons25: [], finalItems: [], goldGraph: [], kills: [], deaths: [], cs: [], levels: [],
  };
  const csNow = new Array<number>(n).fill(0);
  const world = () => sim.world;
  const coreUnit = catalog.modes.find((m) => m.id === job.mode)?.rules.end.coreStructure;
  const levels = () => world().players.map((p) => p.ent?.level ?? 0);
  const finHeld = () => world().players.map((p) => p.items.filter((x) => x && finished.has(x)).length);
  const costOf = new Map(catalog.items.map((i) => [i.id, i.cost] as const));
  const at25 = (): void => {
    rec.fin25 = finHeld();
    rec.gold25 = world().players.map((p) => p.goldEarned);
    rec.finSpent25 = world().players.map((p) => p.items.reduce((a, x) => a + (x && finished.has(x) ? costOf.get(x) ?? 0 : 0), 0));
    rec.bank25 = world().players.map((p) => p.gold);
    rec.cons25 = consSpent.slice();
  };
  const consumables = new Set(catalog.items.filter((i) => i.tier === 'consumable').map((i) => i.id));
  const consSpent = new Array<number>(n).fill(0);
  const killerKind = (killerId: number, victimTeam: number): { kind: KillerKind; def: string; credited: boolean } => {
    const w = world();
    const k = killerId >= 0 ? w.entity(killerId) ?? null : null;
    if (!k) return { kind: 'none', def: '', credited: false };
    const cf = w.creditFighter(k);
    if (cf && cf.team !== victimTeam) return { kind: 'fighter', def: cf.def, credited: true };
    const kind = k.kind === 'minion' || k.kind === 'monster' || k.kind === 'structure' || k.kind === 'summon' ? k.kind : 'other';
    return { kind, def: k.def, credited: false };
  };
  const samples: [number, () => void][] = [
    [600, () => { rec.cs10 = csNow.slice(); rec.lvl10 = levels(); }],
    [840, () => { rec.cs14 = csNow.slice(); }],
    [900, () => { rec.lvl15 = levels(); }],
    [1500, at25],
  ];
  let si = 0;
  const limit = job.cut > 0 ? job.cut : 3600;
  let guard = 0;
  while (sim.view.phase !== 'ended' && guard++ < 30 * 3700) {
    const evs: SimEvent[] = sim.step();
    for (const e of evs) {
      switch (e.e) {
        case 'death': {
          if (e.kind === 'minion' && e.t <= LANING_TO) {
            const victim = world().entity(e.dst);
            const kk = killerKind(e.killer, victim ? victim.team : -1).kind;
            rec.wick14[kk] = (rec.wick14[kk] ?? 0) + 1;
          } else if (e.kind === 'fighter') {
            const w = world();
            const pi = w.players.findIndex((p) => p.entity === e.dst);
            const vt = pi >= 0 ? w.players[pi].team : -1;
            const k = killerKind(e.killer, vt);
            rec.fdeaths.push({ t: e.t, p: pi, role: setup.seats[pi]?.role ?? '', mode: pi >= 0 ? modeOf(pi) : '?', killer: k.kind, killerDef: k.def, assists: e.assists.length, involved: k.credited || e.assists.length > 0 });
          }
          break;
        }
        case 'gold': if (e.reason === 'cs') csNow[e.player]++; break;
        case 'structure': {
          rec.structs.push({ t: e.t, def: e.def, team: e.team });
          const ent = world().entity(e.id);
          if (ent && coreUnit && (e.def === coreUnit || e.final)) {
            const list = structuresOf(world());
            const me = list.find((s) => s.ent === ent || (s.def.team === e.team && s.def.unit === e.def));
            const standing = (me?.def.requires ?? []).filter((id) => list.find((s) => s.def.id === id)?.ent.alive);
            rec.coreFalls.push({ t: e.t, team: e.team, standing });
          }
          break;
        }
        case 'objective': rec.objs.push({ t: e.t, unit: e.unit, team: e.team }); break;
        case 'recall': if (e.state === 'done') rec.recalls[e.player]++; break;
        case 'suddenDeath': rec.sudden = e.t; break;
        case 'buy':
          if (finished.has(e.item)) rec.buys.push({ t: e.t, p: e.player, item: e.item });
          else if (consumables.has(e.item) && e.t < 1500) consSpent[e.player] += costOf.get(e.item) ?? 0;
          break;
        default: break;
      }
    }
    const t = sim.view.time;
    while (si < samples.length && t >= samples[si][0]) { samples[si][1](); si++; }
    if (t >= limit) break;
  }
  const w = world();
  const res = sim.view.result;
  rec.dur = res ? res.duration : w.time;
  rec.reason = res ? res.reason : 'cut';
  rec.winner = res ? res.winningTeam : -1;
  rec.goldGraph = res ? res.goldGraph.slice() : [];
  rec.faults = sim.faults.slice(0, 3);
  if (rec.fin25.length === 0) at25();
  rec.finalItems = w.players.map((p) => p.items.filter((x): x is string => !!x));
  rec.kills = w.players.map((p) => p.kills); rec.deaths = w.players.map((p) => p.deaths);
  rec.cs = w.players.map((p) => p.cs); rec.levels = levels();
  return rec;
}

// ── jobs ────────────────────────────────────────────────────────────────────────────────────────
function planJobs(): Job[] {
  const jobs: Job[] = [];
  for (const suite of SUITES) {
    if (suite === 'rift' || suite === 'bridge') {
      for (const d of DIFFS) for (let s = SEED0; s < SEED0 + SEEDS; s++) jobs.push({ suite, mode: suite, seed: s, diffs: [d, d], cut: suite === 'rift' ? CUT : 0 });
    } else if (suite === 'mirror') {
      for (const weak of ['novice', 'adept']) for (let s = SEED0; s < SEED0 + MIRROR_SEEDS; s++) {
        jobs.push({ suite: `mirror_${weak}`, mode: 'rift', seed: s, diffs: ['veteran', weak], cut: 0 });
        jobs.push({ suite: `mirror_${weak}`, mode: 'rift', seed: s, diffs: [weak, 'veteran'], cut: 0 });
      }
    } else throw new Error(`unknown suite ${suite}`);
  }
  return jobs;
}

function runWorker(jobs: Job[]): void {
  const catalog = loadCatalog();
  for (const j of jobs) {
    const r = runGame(catalog, j);
    process.stdout.write(`@@GAME ${JSON.stringify(r)}\n`);
  }
}

function runParallel(jobs: Job[], nJobs: number): Promise<GameRec[]> {
  if (nJobs <= 1) {
    const catalog = loadCatalog();
    const out: GameRec[] = [];
    for (const j of jobs) { const r = runGame(catalog, j); out.push(r); progress(r); }
    return Promise.resolve(out);
  }
  const chunks: Job[][] = Array.from({ length: nJobs }, () => []);
  jobs.forEach((j, i) => chunks[i % nJobs].push(j));
  return Promise.all(chunks.filter((c) => c.length).map((chunk) => new Promise<GameRec[]>((done, fail) => {
    const pass = [...(RULES ? ['--rules', RULES] : []), ...(PATCH ? ['--patch', PATCH] : [])];
    const child = spawn(process.execPath, [SELF, '--worker', JSON.stringify(chunk), ...pass], { stdio: ['ignore', 'pipe', 'inherit'] });
    const got: GameRec[] = [];
    let buf = '';
    child.stdout.on('data', (b: Buffer) => {
      buf += b.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (line.startsWith('@@GAME ')) { const r = JSON.parse(line.slice(7)) as GameRec; got.push(r); progress(r); }
      }
    });
    child.on('close', (code) => (code === 0 ? done(got) : fail(new Error(`worker exited ${code}`))));
  }))).then((parts) => parts.flat());
}

function progress(r: GameRec): void {
  const fs0 = r.structs[0];
  console.log(`  ${r.job.suite.padEnd(14)} s${String(r.job.seed).padStart(2)} ${r.job.diffs.join('/').padEnd(15)} ${r.reason.padEnd(9)} ${(r.dur / 60).toFixed(1).padStart(5)}m w${r.winner}`
    + `  first struct ${fs0 ? (fs0.t / 60).toFixed(1) + 'm' : '-'}${r.sudden >= 0 ? `  sudden ${(r.sudden / 60).toFixed(1)}m` : ''}${r.faults.length ? `  FAULTS ${r.faults.length}` : ''}`);
}

// ── analysis ────────────────────────────────────────────────────────────────────────────────────
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a: number[]): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;

interface Gate { group: string; item: string; label: string; value: string; target: string; pass: boolean; n: number; reportOnly?: boolean }

function laningStats(games: GameRec[]): { lastHit: number; soloCs10: number; inLane: number; noFighter: number; nDeaths: number; byRole: Record<string, Record<string, number>>; modeShare: Record<string, Record<string, number>>; recalls25: Record<string, number>; wick: Record<string, number> } {
  const wick: Record<string, number> = {};
  for (const g of games) for (const [k, v] of Object.entries(g.wick14)) wick[k] = (wick[k] ?? 0) + v;
  const wTot = Object.values(wick).reduce((a, b) => a + b, 0) || 1;
  const solo: number[] = [];
  const laneTicks = { in: 0, all: 0 };
  const byRole: Record<string, Record<string, number[]>> = {};
  const modeAgg: Record<string, Record<string, number>> = {};
  const rec25: Record<string, number[]> = {};
  let dAll = 0, dNo = 0;
  for (const g of games) {
    for (const s of g.seats) {
      const r = (byRole[s.role] ??= { cs10: [], cs14: [], lvl10: [], lvl15: [], deaths: [] });
      if (g.cs10.length) r.cs10.push(g.cs10[s.p]);
      if (g.cs14.length) r.cs14.push(g.cs14[s.p]);
      if (g.lvl10.length) r.lvl10.push(g.lvl10[s.p]);
      if (g.lvl15.length) r.lvl15.push(g.lvl15[s.p]);
      r.deaths.push(g.deaths[s.p]);
      if ((s.role === 'shadehold' || s.role === 'dialcross') && g.cs10.length) solo.push(g.cs10[s.p]);
      const mt = g.modeTicks[s.p] ?? {};
      const ma = (modeAgg[s.role] ??= {});
      let tot = 0, inl = 0;
      for (const [m, c] of Object.entries(mt)) { tot += c; if (LANE_MODES.has(m)) inl += c; ma[m] = (ma[m] ?? 0) + c; }
      if (s.role !== 'grovehunter') { laneTicks.in += inl; laneTicks.all += tot; }
      (rec25[s.role] ??= []).push(g.recalls[s.p] / Math.max(1, Math.min(g.dur, g.job.cut || g.dur) / 60) * 25);
    }
    for (const d of g.fdeaths) { dAll++; if (!d.involved && (d.killer === 'minion' || d.killer === 'monster')) dNo++; }
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [r, v] of Object.entries(byRole)) out[r] = Object.fromEntries(Object.entries(v).map(([k, a]) => [k, mean(a)]));
  const modeShare: Record<string, Record<string, number>> = {};
  for (const [r, m] of Object.entries(modeAgg)) {
    const tot = Object.values(m).reduce((a, b) => a + b, 0) || 1;
    modeShare[r] = Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, c]) => [k, Math.round((c / tot) * 1000) / 10]));
  }
  return {
    lastHit: (wick.fighter ?? 0) / wTot, soloCs10: mean(solo), inLane: laneTicks.in / Math.max(1, laneTicks.all), noFighter: dAll ? dNo / dAll : 0, nDeaths: dAll,
    byRole: out, modeShare, recalls25: Object.fromEntries(Object.entries(rec25).map(([k, a]) => [k, mean(a)])), wick,
  };
}

function analyse(games: GameRec[], catalog: CatalogT): { gates: Gate[]; text: string[]; detail: Record<string, unknown> } {
  const gates: Gate[] = [];
  const text: string[] = [];
  const detail: Record<string, unknown> = {};
  const faults = games.reduce((a, g) => a + g.faults.length, 0);
  text.push(`games ${games.length}; bot faults ${faults}`);
  // ── RIFT per difficulty ──
  const rift = games.filter((g) => g.job.suite === 'rift');
  const diffs = [...new Set(rift.map((g) => g.job.diffs[0]))];
  const lan: Record<string, ReturnType<typeof laningStats>> = {};
  for (const d of diffs) {
    const gs = rift.filter((g) => g.job.diffs[0] === d);
    const L = laningStats(gs);
    lan[d] = L;
    text.push('', `RIFT ${d}: ${gs.length} games${gs[0]?.job.cut ? ` (cut at ${(gs[0].job.cut / 60).toFixed(0)}:00)` : ''}`);
    const durs = gs.filter((g) => g.reason !== 'cut').map((g) => g.dur / 60);
    if (durs.length) text.push(`  length median ${median(durs).toFixed(1)} min (mean ${mean(durs).toFixed(1)}, ${Math.min(...durs).toFixed(1)}–${Math.max(...durs).toFixed(1)}); sudden ${gs.filter((g) => g.sudden >= 0).length}`);
    text.push(`  Wicks dying ≤ 14:00: ${Object.values(L.wick).reduce((a, b) => a + b, 0)} — ${Object.entries(L.wick).map(([k, v]) => `${k} ${v}`).join(', ')}; fighters last-hit ${pct(L.lastHit)}`);
    text.push(`  solo-laner cs@10 ${L.soloCs10.toFixed(1)}; laners in lane ${pct(L.inLane)} of alive time 1:00–14:00; fighter deaths ${L.nDeaths}, to Wicks/monsters with no enemy fighter ${pct(L.noFighter)}`);
    for (const r of ['shadehold', 'grovehunter', 'dialcross', 'shaftlight', 'lampglass']) {
      const b = L.byRole[r]; if (!b) continue;
      text.push(`   ${r.padEnd(11)} cs@10 ${b.cs10.toFixed(1).padStart(5)} cs@14 ${(b.cs14 ?? NaN).toFixed(1).padStart(5)} lvl@10 ${b.lvl10.toFixed(1)} lvl@15 ${(b.lvl15 ?? NaN).toFixed(1)} deaths ${b.deaths.toFixed(1)} recalls/25m ${(L.recalls25[r] ?? 0).toFixed(1)}`);
      text.push(`   ${''.padEnd(11)} modes ${Object.entries(L.modeShare[r] ?? {}).slice(0, 9).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    }
    const dk: Record<string, number> = {};
    for (const g of gs) for (const x of g.fdeaths) { const key = `${x.killer}${x.involved ? '' : '(alone)'}`; dk[key] = (dk[key] ?? 0) + 1; }
    text.push(`  fighter deaths by final blow: ${Object.entries(dk).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const mon: Record<string, number> = {};
    for (const g of gs) for (const x of g.fdeaths) if (!x.involved && x.killer === 'monster') mon[x.killerDef] = (mon[x.killerDef] ?? 0) + 1;
    if (Object.keys(mon).length) text.push(`  monster-alone deaths: ${Object.entries(mon).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const alone: Record<string, number> = {};
    for (const g of gs) for (const x of g.fdeaths) if (!x.involved && (x.killer === 'minion' || x.killer === 'monster')) {
      const key = `${x.role}/${x.mode}/${x.t < 840 ? 'lane' : x.t < 1500 ? 'mid' : 'late'}`; alone[key] = (alone[key] ?? 0) + 1;
    }
    if (Object.keys(alone).length) text.push(`  alone deaths by role/mode/phase: ${Object.entries(alone).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  detail.laning = lan;
  const both = (f: (L: ReturnType<typeof laningStats>) => boolean): boolean => diffs.length > 0 && diffs.every((d) => f(lan[d]));
  const vals = (f: (L: ReturnType<typeof laningStats>) => string): string => diffs.map((d) => `${d} ${f(lan[d])}`).join(' / ');
  if (rift.length) {
    gates.push({ group: 'laning', item: 'gameplay:G1', label: 'Wicks dying ≤ 14:00 last-hit by fighters', value: vals((L) => pct(L.lastHit)), target: '≥ 50 %', pass: both((L) => L.lastHit >= 0.5), n: rift.length });
    gates.push({ group: 'laning', item: 'gameplay:G1', label: 'solo-laner cs at 10:00', value: vals((L) => L.soloCs10.toFixed(1)), target: '≥ 45', pass: both((L) => L.soloCs10 >= 45), n: rift.length });
    gates.push({ group: 'laning', item: 'gameplay:G1', label: 'laners in lane, 1:00–14:00', value: vals((L) => pct(L.inLane)), target: '≥ 65 %', pass: both((L) => L.inLane >= 0.65), n: rift.length });
    const cut = rift[0]?.job.cut ?? 0;
    gates.push({ group: 'laning', item: 'gameplay:G1', label: `fighter deaths to Wicks/monsters, no enemy fighter${cut ? ` (deaths before ${(cut / 60).toFixed(0)}:00 only — the whole-game gate is --full)` : ''}`, value: vals((L) => pct(L.noFighter)), target: '≤ 5 %', pass: both((L) => L.noFighter <= 0.05), n: rift.length });
    // jungle
    const gaps: Record<string, number> = {};
    for (const d of diffs) {
      const gs: number[] = [];
      for (const g of rift.filter((x) => x.job.diffs[0] === d && x.lvl15.length)) for (const t of [0, 1]) {
        const ss = g.seats.filter((s) => s.team === t);
        const j = ss.find((s) => s.role === 'grovehunter');
        const sl = ss.filter((s) => s.role === 'shadehold' || s.role === 'dialcross');
        if (j && sl.length) gs.push(mean(sl.map((s) => g.lvl15[s.p])) - g.lvl15[j.p]);
      }
      gaps[d] = mean(gs);
    }
    gates.push({ group: 'jungle', item: 'gameplay:G2', label: 'jungler level gap to solo laners at 15:00', value: diffs.map((d) => `${d} ${gaps[d].toFixed(2)}`).join(' / '), target: '≤ 1.5', pass: diffs.every((d) => gaps[d] <= 1.5), n: rift.length });
    // (the grovehunter used to be the role that died most: per-game deaths against the laner roles')
    const laneRoles = ['shadehold', 'dialcross', 'shaftlight', 'lampglass'];
    const jd = (L: ReturnType<typeof laningStats>): { j: number; top: number } => ({ j: L.byRole.grovehunter?.deaths ?? 0, top: Math.max(...laneRoles.map((r) => L.byRole[r]?.deaths ?? 0)) });
    const fewD = diffs.some((d) => rift.filter((g) => g.job.diffs[0] === d).length < STRUCT_MIN_GAMES);
    gates.push({ group: 'jungle', item: 'gameplay:G2', label: `grovehunter deaths per game vs the laner roles' highest${cut ? ` (by ${(cut / 60).toFixed(0)}:00)` : ''}${fewD ? ` (fewer than ${STRUCT_MIN_GAMES} games per difficulty: report only)` : ''}`,
      value: vals((L) => `${jd(L).j.toFixed(1)} vs ${jd(L).top.toFixed(1)}`), target: '≤', pass: both((L) => jd(L).j <= jd(L).top), n: rift.length, reportOnly: fewD });
    // structures (a game with no structure down by its end or the cut counts as later than every other)
    const fsd: Record<string, number> = {};
    const fsn: Record<string, number> = {};
    for (const d of diffs) {
      const gs = rift.filter((g) => g.job.diffs[0] === d);
      fsn[d] = gs.length;
      fsd[d] = median(gs.map((g) => (g.structs.length ? g.structs[0].t / 60 : Infinity)));
    }
    const few = diffs.some((d) => fsn[d] < STRUCT_MIN_GAMES);
    gates.push({ group: 'structures', item: 'gameplay:G4', label: `median first structure (RIFT)${few ? ` (fewer than ${STRUCT_MIN_GAMES} games per difficulty: report only, the gate is --full)` : ''}`,
      value: diffs.map((d) => `${d} ${Number.isFinite(fsd[d]) ? fsd[d].toFixed(1) + ' min' : '> cut'}`).join(' / '), target: '9–12 min', pass: diffs.every((d) => fsd[d] >= 9 && fsd[d] <= 12), n: rift.length, reportOnly: few });
  }
  // ── items (full RIFT games) ──
  const fullRift = rift.filter((g) => !g.job.cut);
  if (fullRift.length) {
    const finIds = catalog.items.filter((i) => i.tier === 'core' || i.tier === 'apex').map((i) => i.id);
    const per: number[] = [];
    const bought = new Map<string, number>();
    for (const g of fullRift) { for (const x of g.fin25) per.push(x); for (const b of g.buys) bought.set(b.item, (bought.get(b.item) ?? 0) + 1); }
    const cover = finIds.filter((id) => bought.has(id)).length / Math.max(1, finIds.length);
    const antiHeal = catalog.items.filter((i) => JSON.stringify(i).includes('"grievous"')).map((i) => i.id);
    // build variety: per fighter with ≥ 3 games, distinct first-two-finished sets
    const builds = new Map<string, Set<string>>();
    const games = new Map<string, number>();
    for (const g of fullRift) for (const s of g.seats) {
      const first = g.buys.filter((b) => b.p === s.p).map((b) => b.item).slice(0, 2).join('>');
      if (!first) continue;
      const set = builds.get(s.fighter) ?? new Set<string>(); set.add(first); builds.set(s.fighter, set);
      games.set(s.fighter, (games.get(s.fighter) ?? 0) + 1);
    }
    const eligible = [...games.entries()].filter(([, c]) => c >= 3).map(([f]) => f);
    const varied = eligible.filter((f) => (builds.get(f)?.size ?? 0) > 1).length / Math.max(1, eligible.length);
    gates.push({ group: 'items', item: 'gameplay:G7', label: 'finished items held per player at min(25:00, end)', value: mean(per).toFixed(2), target: '≥ 2.5', pass: mean(per) >= 2.5, n: fullRift.length });
    gates.push({ group: 'items', item: 'gameplay:G7', label: 'finished items bought at least once', value: `${pct(cover)} (${finIds.filter((id) => bought.has(id)).length}/${finIds.length})`, target: '≥ 80 %', pass: cover >= 0.8, n: fullRift.length });
    gates.push({ group: 'items', item: 'gameplay:G7', label: 'anti-heal item families', value: `${antiHeal.length}${antiHeal.length ? ` (${antiHeal.join(', ')})` : ''}`, target: '≥ 1', pass: antiHeal.length >= 1, n: 0 });
    // builds answer the enemy team: anti-heal pieces bought against two or more enemy healers vs against fewer
    const heals = new Map(catalog.fighters.map((f) => [f.id, fighterProfile(f).heals] as const));
    const antiIds = new Set(catalog.items.filter((i) => itemRole(i).antiHeal).map((i) => i.id));
    const resp = { many: { n: 0, ah: 0 }, few: { n: 0, ah: 0 } };
    for (const g of fullRift) for (const s of g.seats) {
      const h = g.seats.filter((o) => o.team !== s.team && heals.get(o.fighter)).length;
      const r = h >= 2 ? resp.many : resp.few;
      r.n++; if (g.buys.some((b) => b.p === s.p && antiIds.has(b.item))) r.ah++;
    }
    const rMany = resp.many.n ? resp.many.ah / resp.many.n : 0, rFew = resp.few.n ? resp.few.ah / resp.few.n : 0;
    detail.antiHealResponse = resp;
    gates.push({ group: 'items', item: 'gameplay:G7', label: 'builds answer the enemy team: players buying an anti-heal piece, ≥ 2 enemy healers vs fewer', value: `${pct(rMany)} of ${resp.many.n} vs ${pct(rFew)} of ${resp.few.n}`, target: 'more than twice as often', pass: resp.many.n > 0 && rMany > 2 * rFew, n: fullRift.length });
    gates.push({ group: 'items', item: 'gameplay:G7', label: 'fighters whose first two finished items vary', value: `${pct(varied)} of ${eligible.length}`, target: '≥ 50 %', pass: varied >= 0.5, n: fullRift.length });
    const byRole: Record<string, { fin: number[]; gold: number[]; spent: number[]; bank: number[]; cons: number[] }> = {};
    for (const g of fullRift) for (const s of g.seats) {
      const r = (byRole[`${g.job.diffs[0]} ${s.role}`] ??= { fin: [], gold: [], spent: [], bank: [], cons: [] });
      r.fin.push(g.fin25[s.p] ?? 0); r.gold.push(g.gold25?.[s.p] ?? NaN); r.spent.push(g.finSpent25?.[s.p] ?? NaN);
      r.bank.push(g.bank25?.[s.p] ?? NaN); r.cons.push(g.cons25?.[s.p] ?? NaN);
    }
    text.push('', 'items by role at min(25:00, end): finished held · Gleam earned by play · in finished items · unspent · spent on consumables');
    for (const [k, v] of Object.entries(byRole).sort()) text.push(`   ${k.padEnd(20)} ${mean(v.fin).toFixed(2)} · ${mean(v.gold).toFixed(0).padStart(5)} · ${mean(v.spent).toFixed(0).padStart(5)} · ${mean(v.bank).toFixed(0).padStart(5)} · ${mean(v.cons).toFixed(0).padStart(4)}`);
    detail.itemsByRole = Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, { fin: mean(v.fin), gold: mean(v.gold), spent: mean(v.spent), bank: mean(v.bank), cons: mean(v.cons) }]));
    const long = fullRift.filter((g) => g.dur >= 1500);
    if (long.length) text.push(`   games reaching 25:00: ${long.length}/${fullRift.length}, finished held at 25:00 ${mean(long.flatMap((g) => g.fin25)).toFixed(2)}`);
    text.push('', `items: finished bought ${[...bought.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}; never: ${finIds.filter((id) => !bought.has(id)).join(', ') || '-'}`);
  }
  // ── mirrored difficulty ──
  for (const weak of ['novice', 'adept']) {
    const gs = games.filter((g) => g.job.suite === `mirror_${weak}`);
    if (!gs.length) continue;
    const vetWins = gs.filter((g) => g.winner >= 0 && g.job.diffs[g.winner] === 'veteran').length;
    const k = { vet: 0, weak: 0 };
    for (const g of gs) for (const s of g.seats) { if (g.job.diffs[s.team] === 'veteran') k.vet += g.kills[s.p]; else k.weak += g.kills[s.p]; }
    text.push('', `mirror veteran vs ${weak}: veteran wins ${vetWins}/${gs.length}; kills per game ${(k.vet / gs.length).toFixed(1)} vs ${(k.weak / gs.length).toFixed(1)}; median length ${median(gs.map((g) => g.dur / 60)).toFixed(1)} min`);
    const target = weak === 'novice' ? 0.85 : 0.65;
    gates.push({ group: 'difficulty', item: 'gameplay:G3', label: `veteran beats ${weak} (mirrored)`, value: `${vetWins}/${gs.length} (${pct(vetWins / gs.length)})`, target: `≥ ${target * 100} %`, pass: vetWins / gs.length >= target, n: gs.length });
  }
  // ── BRIDGE ──
  const br = games.filter((g) => g.job.suite === 'bridge');
  if (br.length) {
    const sd = br.filter((g) => g.reason === 'core' && g.sudden >= 0 && g.sudden < g.dur).length;
    const skips = br.reduce((a, g) => a + g.coreFalls.filter((c) => c.standing.length > 0).length, 0);
    const len = median(br.map((g) => g.dur / 60));
    text.push('', `BRIDGE: ${br.length} games; length median ${len.toFixed(1)} min (${Math.min(...br.map((g) => g.dur / 60)).toFixed(1)}–${Math.max(...br.map((g) => g.dur / 60)).toFixed(1)}); ended in sudden death ${sd}; cores fallen with chain standing ${skips}; reasons ${JSON.stringify(br.reduce((o: Record<string, number>, g) => { o[g.reason] = (o[g.reason] ?? 0) + 1; return o; }, {}))}`);
    gates.push({ group: 'bridge', item: 'gameplay:G5', label: 'BRIDGE games ending in sudden death', value: `${sd}/${br.length} (${pct(sd / br.length)})`, target: '≤ 25 %', pass: sd / br.length <= 0.25, n: br.length });
    gates.push({ group: 'bridge', item: 'gameplay:G5', label: 'BRIDGE cores fallen with their chain standing', value: String(skips), target: '0', pass: skips === 0, n: br.length });
    gates.push({ group: 'bridge', item: 'gameplay:G5', label: 'BRIDGE median length', value: `${len.toFixed(1)} min`, target: '15–18 min', pass: len >= 15 && len <= 18, n: br.length });
  }
  return { gates, text, detail };
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (WORKER) { runWorker(JSON.parse(WORKER) as Job[]); return; }
  const jobs = planJobs();
  const t0 = Date.now();
  console.log(`bot soak (${FULL ? 'full' : 'quick'}): ${jobs.length} matches, suites ${SUITES.join(',')}, ${JOBS} worker${JOBS > 1 ? 's' : ''}${CUT ? `, RIFT cut at ${CUT}s` : ''}${RULES ? `, rules ${RULES}` : ''}`);
  const games = await runParallel(jobs, JOBS);
  games.sort((a, b) => (a.job.suite < b.job.suite ? -1 : a.job.suite > b.job.suite ? 1 : 0) || a.job.diffs.join().localeCompare(b.job.diffs.join()) || a.job.seed - b.job.seed);
  const catalog = loadCatalog();
  const { gates, text, detail } = analyse(games, catalog);
  const lines: string[] = [`bot soak ${LABEL}: ${games.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)} s`, ...text, '', 'gates:'];
  let failed = 0;
  for (const g of gates) {
    const enforced = ENFORCED.has(g.group) && !g.reportOnly;
    const tag = g.pass ? 'PASS' : enforced ? 'FAIL' : 'open';
    if (!g.pass && enforced) failed++;
    lines.push(`  ${tag.padEnd(4)} [${g.group}${enforced ? '' : ', report only'}] ${g.label}: ${g.value} (target ${g.target})`);
  }
  console.log(lines.join('\n'));
  mkdirSync(REPORTS, { recursive: true });
  const base = resolve(REPORTS, `fw_W4_soak_${LABEL}`);
  writeFileSync(`${base}.json`, JSON.stringify({ label: LABEL, full: FULL, suites: SUITES, seeds: SEEDS, diffs: DIFFS, cut: CUT, rules: RULES || null, gates, detail, games }, null, 1));
  writeFileSync(`${base}.txt`, lines.join('\n') + '\n');
  console.log(`\nreport: ${base}.json / .txt`);
  if (games.some((g) => g.faults.length)) { console.log('FAIL: bot faults'); process.exit(1); }
  if (failed) { console.log(`FAIL: ${failed} enforced gate${failed > 1 ? 's' : ''}`); process.exit(1); }
  console.log('PASS');
}

await main();
