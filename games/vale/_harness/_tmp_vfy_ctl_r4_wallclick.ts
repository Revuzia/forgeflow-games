// orch1 controls r4 VERIFIER (fresh seeds: SIMSEED / RSEED env; fails classed body-blocked or not): independent wall / structure click sweep (ruling 41 snap). Every fighter (all radii), heroes
// on open cells within 9 m of a structure (alive, structures ON) or anywhere against a wall, clicks on blocked cells 1-14 m
// away. Reference: the open cell nearest the click (same component) and its nav route length from the hero's start.
// Gate A (no dead click): when such a cell is within 2.5 m of the click and its route is <= 2 x straight + 2 m, the hero
// ends within (that cell's distance to the click) + 1.2 m.  Gate B: never ends further from the click than it started (+0.3).
//   node _harness/_tmp_vfy_ctl_r3_wallclick.ts [--n 250]
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createSim } from '../src/sim/sim.ts';
import { pickLoadout } from '../src/sim/bots/index.ts';
import { ORDER_NONE } from '../src/sim/entity.ts';

const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf('--n') + 1] ?? 250) || 250;
const SIMSEED = Number(process.env.SIMSEED ?? 41), RSEED = Number(process.env.RSEED ?? 4243);
let failAbody = 0;
const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
const rc = r.catalog!;
const f2 = (n: number): string => n.toFixed(2);
function fresh(first: string, modeId: string) {
  const mode = rc.modes.find((m) => m.id === modeId)!, queue = rc.queues.find((q) => q.mode === modeId)!;
  const fs = rc.fighters.map((f) => f.id).sort();
  const seats = Array.from({ length: mode.teams * mode.perTeam }, (_, i) => { const fighter = i === 0 ? first : fs[(i * 3) % fs.length];
    return { player: i, team: Math.floor(i / mode.perTeam), name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)!.id, controller: 'human', loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i }; });
  const sim = createSim(rc, { matchId: 'vfy4wc', seed: SIMSEED, queue: queue.id, mode: modeId, map: mode.map, seats, catalogVersion: rc.version } as never, { pregameSeconds: 0 });
  sim.step();
  return sim;
}
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; }
let nearDead = 0, info = 0, failA = 0, failB = 0, total = 0, gated = 0, dead = 0;
const bad: string[] = [];
for (const modeId of ['rift', 'bridge']) for (const f of rc.fighters.map((x) => x.id).sort()) {
  let sim = fresh(f, modeId);
  const rnd = rng(RSEED + f.length * 131 + (modeId === 'bridge' ? 17 : 0) + f.charCodeAt(0) * 7);
  let n = 0, tries = 0;
  while (n < N / 10 && tries++ < 200000) {
    if (sim.world.tick > 30 * 500 || sim.world.phase !== 'live') sim = fresh(f, modeId);
    const w = sim.world, nav = w.nav, me = w.players[0].ent!;
    for (const p of w.players) if (p.ent && p.ent !== me) { const b = w.mapDef.bases.find((q) => q.team === p.team); if (b) { p.ent.x = b.spawn[0]; p.ent.y = b.spawn[1]; p.ent.path.length = 0; } }
    for (const e of w.entities) if (e.kind === 'structure') e.stats.ad = 0;
    const structs = w.entities.filter((e) => e.kind === 'structure' && e.alive);
    const [W, H] = w.mapDef.size;
    const near = rnd() < 0.6;
    let hx: number, hy: number;
    if (near) { const s = structs[Math.floor(rnd() * structs.length)]; const a = rnd() * 6.283, d = s.radius + 0.5 + rnd() * 8; hx = s.x + Math.cos(a) * d; hy = s.y + Math.sin(a) * d; }
    else { hx = 2 + rnd() * (W - 4); hy = 2 + rnd() * (H - 4); }
    const main = nav.componentAt(w.mapDef.bases[0].spawn[0], w.mapDef.bases[0].spawn[1]);
    if (!nav.walkable(hx, hy) || nav.componentAt(hx, hy) !== main) continue;
    const a = rnd() * 6.283, d = 1 + rnd() * 13, cx = hx + Math.cos(a) * d, cy = hy + Math.sin(a) * d;
    if (cx < 0.5 || cy < 0.5 || cx > W - 0.5 || cy > H - 0.5 || nav.walkable(cx, cy)) continue;
    // reference: nearest open cell of the main component to the click
    const c = nav.cell; let best = Infinity, bx = 0, by = 0;
    for (let gy = Math.floor((cy - 3) / c); gy <= Math.floor((cy + 3) / c); gy++) for (let gx = Math.floor((cx - 3) / c); gx <= Math.floor((cx + 3) / c); gx++) {
      const px = (gx + 0.5) * c, py = (gy + 0.5) * c, dd = Math.hypot(px - cx, py - cy);
      if (dd < best && nav.walkable(px, py) && nav.componentAt(px, py) === main && nav.walkable(px + me.radius * 0.7, py) && nav.walkable(px - me.radius * 0.7, py) && nav.walkable(px, py + me.radius * 0.7) && nav.walkable(px, py - me.radius * 0.7)) { best = dd; bx = px; by = py; }
    }
    if (!isFinite(best) || best > 2.5) continue;
    me.x = hx; me.y = hy; me.path.length = 0; me.order = ORDER_NONE; w.hashDirty = true; sim.step();
    if (Math.hypot(me.x - hx, me.y - hy) > 0.3) continue;
    const x0 = me.x, y0 = me.y, d0 = Math.hypot(cx - x0, cy - y0);
    const route: number[] = [];
    let rl = Infinity;
    if (nav.findPath(x0, y0, bx, by, route, me.radius)) { rl = 0; let qx = x0, qy = y0; for (let i = 0; i < route.length; i += 2) { rl += Math.hypot(route[i] - qx, route[i + 1] - qy); qx = route[i]; qy = route[i + 1]; } }
    const straight = Math.hypot(bx - x0, by - y0);
    sim.command(0, { type: 'move', x: cx, y: cy } as never);
    let moved = 0, px = me.x, py = me.y;
    for (let q = 0; q < 30 * 12; q++) { me.hp = me.maxHp; sim.step(); moved += Math.hypot(me.x - px, me.y - py); px = me.x; py = me.y; if (q > 3 && me.order === ORDER_NONE) break; }
    n++; total++;
    const dEnd = Math.hypot(me.x - cx, me.y - cy);
    const rt = { x: 0, y: 0 }; nav.raycast(x0, y0, cx, cy, rt); const gain = d0 - Math.hypot(rt.x - cx, rt.y - cy);
    const isGated = gain < 1 && rl <= 2 * straight + 2 && d0 > best + 0.6;
    if (!isGated && rl <= 2 * straight + 2 && dEnd > best + 1.2) info++;
    if (isGated) gated++;
    if (moved < 0.05 && d0 > best + 1.2) dead++;
    if (isGated && moved < 1.0 && dEnd > best + 2 && rl <= 0.9 * (2 * straight + 2)) { nearDead++; if (bad.length < 30) bad.push(`NEARDEAD ${modeId} ${f} r${me.radius} (${f2(x0)},${f2(y0)})->(${f2(cx)},${f2(cy)}) open ${f2(best)} route ${f2(rl)}/${f2(straight)} end ${f2(dEnd)} moved ${f2(moved)}`); }
    const bodyNear = w.entities.some((o) => o !== me && o.alive && !o.static && (o.kind === 'minion' || o.kind === 'fighter' || o.kind === 'monster') && Math.hypot(o.x - me.x, o.y - me.y) < me.radius + o.radius + 0.6);
    if (isGated && dEnd > best + 1.2 && bodyNear) { failAbody++; if (bad.length < 30) bad.push(`A(body) ${modeId} ${f} (${f2(x0)},${f2(y0)})->(${f2(cx)},${f2(cy)}) open ${f2(best)} end ${f2(dEnd)} moved ${f2(moved)}`); }
    else if (isGated && dEnd > best + 1.2) { failA++; if (bad.length < 12) bad.push(`A gain ${f2(gain)} ${modeId} ${f} r${me.radius} (${f2(x0)},${f2(y0)})->(${f2(cx)},${f2(cy)}) open ${f2(best)} route ${f2(rl)}/${f2(straight)} end ${f2(dEnd)} moved ${f2(moved)}${near ? ' nearStruct' : ''}`); }
    if (dEnd > d0 + 0.3) { failB++; if (bad.length < 12) bad.push(`B ${modeId} ${f} (${f2(x0)},${f2(y0)})->(${f2(cx)},${f2(cy)}) start ${f2(d0)} end ${f2(dEnd)}`); }
  }
}
console.log(`clicks ${total}, gated (straight walk gains < 1 m) ${gated}, info: ended > 1.2 m past an open point reachable at <= 2x+2 m while the straight walk gained >= 1 m ${info}, A fails ${failA}, B fails ${failB}, near-dead (gated, moved < 1 m, ended > 2 m past the open point, route <= 0.9 cap) ${nearDead}, dead clicks (moved < 5 cm while > 1.2 m from the open point) ${dead}, A fails with a body touching the hero at its end ${failAbody}`);
for (const b of bad) console.log('  ', b);
console.log(failA + failB === 0 ? 'PASS' : 'FAIL');
