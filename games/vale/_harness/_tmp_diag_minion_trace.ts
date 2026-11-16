// DIAGNOSTIC: second-by-second trace of minions in a window round one tower (no src edits).
//   node _harness/_tmp_diag_minion_trace.ts --seed 3 --map rift --x0 90 --x1 130 --y0 44 --y1 66 --from 240 --to 330 --kill "s_seat_needle_outer@240"
import { createSim, worldOf } from '../src/sim/sim.ts';
import { killEntity } from '../src/sim/combat.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import type { SeatSetup } from '../src/contracts/sim.ts';
const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const seed = Number(opt('seed', '3')), modeId = opt('map', 'rift');
const X0 = Number(opt('x0', '90')), X1 = Number(opt('x1', '130')), Y0 = Number(opt('y0', '44')), Y1 = Number(opt('y1', '66'));
const FROM = Number(opt('from', '240')), TO = Number(opt('to', '330'));
const STEP = Number(opt('step', '30'));
const STILLMIN = Number(opt('stillmin', '0'));
const kills = opt('kill', '').split(',').filter(Boolean).map((k) => { const [id, t] = k.split('@'); return { id, t: Number(t), done: false }; });
const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
const catalog = r.catalog!;
const mode = catalog.modes.find((m) => m.id === modeId)!;
const queue = catalog.queues.find((q) => q.mode === mode.id)!;
const all = catalog.fighters.map((f) => f.id).sort();
const seats: SeatSetup[] = [];
for (let i = 0; i < mode.teams * mode.perTeam; i++) {
  const fighter = all[(seed + i) % all.length];
  seats.push({ player: i, team: Math.floor(i / mode.perTeam), name: 'x' + i, fighter, skin: catalog.skins.find((s) => s.fighter === fighter)!.id, loadout: pickLoadout(catalog, fighter, mode.rules.itemPool ?? '', undefined), controller: 'bot', botDifficulty: 'adept', colorIndex: i } as SeatSetup);
}
const setup = { matchId: 't', seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
const sim = createSim(catalog, setup, { bots: opt('bots', '0') === '1' ? createBots(catalog, setup) : () => null, pregameSeconds: 0 });
const prev = new Map<number, { x: number; y: number; still: number }>();
for (let tick = 0; tick < TO * 30; tick++) {
  sim.step();
  const w = worldOf(sim);
  for (const k of kills) if (!k.done && w.time >= k.t) { k.done = true; const s = structuresOf(w).find((q) => q.def.id === k.id); if (s) { killEntity(w, s.ent, null); console.log(`-- ${w.time.toFixed(1)} s killed ${k.id}`); } }
  if (tick % STEP !== 0 || w.time < FROM) continue;
  const rows: string[] = [];
  for (const e of w.entities) {
    if (e.kind !== 'minion' || !e.alive || e.x < X0 || e.x > X1 || e.y < Y0 || e.y > Y1) continue;
    const p = prev.get(e.id);
    const sp = p ? Math.hypot(e.x - p.x, e.y - p.y) : 0;
    const still = p ? (sp < 0.3 ? p.still + 1 : 0) : 0;
    prev.set(e.id, { x: e.x, y: e.y, still });
    if (still < STILLMIN) continue;
    const tg = e.atkTarget >= 0 ? w.live(e.atkTarget) : null;
    const m = minionState(e)!;
    const ot = e.order === 3 ? w.live(e.orderTarget) : null;
    const od = ot ? `OT:${ot.kind}#${ot.id}${ot.alive ? '' : '+dead'} gap${(Math.hypot(ot.x - e.x, ot.y - e.y) - e.radius - ot.radius - e.stats.range).toFixed(1)} tx(${ot.x.toFixed(1)},${ot.y.toFixed(1)})` : '';
    rows.push(`  #${e.id} t${e.team} ${e.def.slice(0, 5)} (${e.x.toFixed(1)},${e.y.toFixed(1)}) v${sp.toFixed(1)} still${still} ord${e.order} wp${m.wp} ${m.chasing ? 'CH' : '  '} tg:${tg ? tg.kind + (tg.alive ? '' : '+dead') + Math.hypot(tg.x - e.x, tg.y - e.y).toFixed(1) : '-'} pl${e.path.length >> 1}/${e.pathIdx} np${e.noProgress} ${od}`);
  }
  if (rows.length) console.log(`t=${w.time.toFixed(0)}s\n` + rows.join('\n'));
}
