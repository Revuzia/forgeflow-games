// VALE harness — match pacing: all-bot matches on the REAL built catalog (dist-catalog), several seeds per
// mode, headless at full sim speed. Prints each match's end reason and length, and the mean per mode.
//   node tools/build_content.ts --allow-missing-assets && node _harness/pacing.ts [--seeds 6] [--modes rift,bridge,fray] [--rules '<json>']
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog, type CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../src/contracts/sim.ts';
import { createBots } from '../src/sim/bots/index.ts';
import { LocalMatchHost } from '../src/session/match_host.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEEDS = Number(opt('seeds', '6'));
const MODES = opt('modes', 'rift,bridge,fray').split(',');

const root = join(HERE, '..', 'dist-catalog', 'schema-1');
const ver = readdirSync(root).sort().pop()!;
const catalog: CatalogT = Catalog.parse(JSON.parse(readFileSync(join(root, ver, 'catalog.json'), 'utf8')));
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
  const fighters = catalog.fighters.map((f) => f.id);
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
  const seats: SeatSetup[] = [];
  for (let i = 0; i < n; i++) {
    const fighter = fighters[(i * 7 + 3 + seed * 5) % fighters.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '';
    seats.push({
      player: i, team: ffa ? i : Math.floor(i / mode.perTeam), name: catalog.botNames[i % catalog.botNames.length], fighter, skin,
      role: mode.roles ? roles[i % mode.perTeam]?.id : undefined,
      loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
      controller: 'bot', botDifficulty: 'veteran', colorIndex: i,
    });
  }
  return { matchId: `pace-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

for (const m of MODES) {
  const lens: number[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    const setup = setupFor(m, s);
    const got: { end: { reason: string; duration: number; winningTeam: number } | null } = { end: null };
    const host = new LocalMatchHost(catalog, setup, 0, { bots: createBots(catalog, setup), autopilot: true, maxTimeScale: 64, pregameSeconds: 0,
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
  const ok = lens.filter((x) => Number.isFinite(x));
  console.log(`${m}: mean ${(ok.reduce((a, b) => a + b, 0) / ok.length / 60).toFixed(1)} min, min ${(Math.min(...ok) / 60).toFixed(1)}, max ${(Math.max(...ok) / 60).toFixed(1)}\n`);
}
