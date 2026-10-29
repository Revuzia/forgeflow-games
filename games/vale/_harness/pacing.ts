// VALE harness — match pacing: all-bot matches on the REAL catalog (built in memory from content/, the source of
// truth; --dist reads dist-catalog instead), several seeds per mode, headless at full sim speed. Prints each match's
// end reason and length, and per mode the mean, median, p90 and max.
// Seats are what players face: in role modes each seat plays its role with a native fighter of it
// (rotated by seed) and the bots' own pickLoadout for that role; bots play at the queue's difficulty — adept for
// RIFT's standard queue, the default queue difficulty (--diff overrides). Every seat is driven once, by the sim's
// own bot controllers.
// Gate (W4 gameplay g2): RIFT at adept must have p90 ≤ 32 min (exit 1 otherwise; reported, not gated, under 10 seeds).
// The full soak (probe_sim_bot_soak.ts --full, 20 seeds a difficulty) carries the same gate.
//   node _harness/pacing.ts [--seeds 6] [--modes rift,bridge,fray] [--rules '<json>'] [--diff adept] [--dist]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog, type CatalogT } from '../src/contracts/catalog.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import type { MatchSetup, SeatSetup } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { LocalMatchHost } from '../src/session/match_host.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEEDS = Number(opt('seeds', '6'));
const MODES = opt('modes', 'rift,bridge,fray').split(',');
const DIFF = opt('diff', '');

function loadCatalog(): CatalogT {
  if (args.includes('--dist')) {
    const root = join(HERE, '..', 'dist-catalog', 'schema-1');
    const ver = readdirSync(root).sort().pop()!;
    return Catalog.parse(JSON.parse(readFileSync(join(root, ver, 'catalog.json'), 'utf8')));
  }
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) { console.error('content build failed:', r.errors.slice(0, 5).map((d) => `${d.file} ${d.path}: ${d.msg}`).join('\n')); process.exit(77); }
  return r.catalog;
}
const catalog: CatalogT = loadCatalog();
const P90_GATE_MIN = 32;
const GATE_MIN_SEEDS = 10;
let failed = false;
// balance experiments without touching content: --rules '<json>' deep-merges into every probed mode's rules
const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
      ? deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
};
const RULES = opt('rules', '');
if (RULES) for (const m of catalog.modes) if (MODES.includes(m.id)) m.rules = deepMerge(m.rules as unknown as Record<string, unknown>, JSON.parse(RULES)) as unknown as typeof m.rules;

function setupFor(modeId: string, seed: number): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam;
  const ffa = mode.rules.end.kind === 'last_standing_or_score' || mode.pick === 'ffa_pick';
  const fighters = catalog.fighters.map((f) => f.id).sort();
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  const qd = queue.bots?.difficulty;
  const diff = (DIFF || (qd === 'novice' || qd === 'adept' || qd === 'veteran' ? qd : 'adept')) as SeatSetup['botDifficulty'];
  const pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  for (let i = 0; i < n; i++) {
    const team = ffa ? i : Math.floor(i / mode.perTeam);
    const slot = i % mode.perTeam;
    const role = mode.roles ? roles[slot % roles.length]?.id : undefined;
    const pl = role ? natives.get(role) : undefined;
    const fighter = pl && pl.length ? pl[(seed + slot + team) % pl.length] : fighters[(i * 7 + 3 + seed * 5) % fighters.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '';
    seats.push({
      player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role,
      loadout: pickLoadout(catalog, fighter, pool, role),
      controller: 'bot', botDifficulty: diff, colorIndex: i,
    });
  }
  return { matchId: `pace-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

for (const m of MODES) {
  const lens: number[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    const setup = setupFor(m, s);
    const got: { end: { reason: string; duration: number; winningTeam: number } | null } = { end: null };
    // no autopilot: every seat is already a bot seat (autopilot would attach a second controller to seat 0)
    const host = new LocalMatchHost(catalog, setup, 0, { bots: createBots(catalog, setup), maxTimeScale: 64, pregameSeconds: 0,
      onEnd: (r) => { got.end = r; } });
    host.start();
    host.setTimeScale(64);
    const t0 = Date.now();
    let guard = 0;
    while (!host.ended && guard++ < 400000) host.pump(1);
    const end = got.end;
    const d = end?.duration ?? NaN;
    lens.push(d);
    console.log(`${m} seed ${s}: ${end ? `${end.reason} at ${(d / 60).toFixed(1)} min, winner ${end.winningTeam}` : 'no end in 60 min'}  (${((Date.now() - t0) / 1000).toFixed(1)} s wall)`);
  }
  const ok = lens.filter((x) => Number.isFinite(x)).map((x) => x / 60).sort((a, b) => a - b);
  const q = (p: number): number => ok[Math.min(ok.length - 1, Math.max(0, Math.ceil(p * ok.length) - 1))];
  const diff = setupFor(m, 1).seats[0].botDifficulty;
  console.log(`${m} (${diff}): mean ${(ok.reduce((a, b) => a + b, 0) / ok.length).toFixed(1)} min, median ${q(0.5).toFixed(1)}, p90 ${q(0.9).toFixed(1)}, min ${ok[0].toFixed(1)}, max ${ok[ok.length - 1].toFixed(1)}`);
  if (m === 'rift' && diff === 'adept') {
    const pass = q(0.9) <= P90_GATE_MIN;
    const gated = ok.length >= GATE_MIN_SEEDS;
    console.log(`  ${pass ? 'PASS' : gated ? 'FAIL' : 'open'} RIFT adept p90 ${q(0.9).toFixed(1)} min (target <= ${P90_GATE_MIN}${gated ? '' : `; ${ok.length} seeds < ${GATE_MIN_SEEDS}: report only`})`);
    if (!pass && gated) failed = true;
  }
  console.log('');
}
if (failed) process.exit(1);
