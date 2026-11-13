// probe (lane SIM): move and attack-move orders end where the player meant and never leave the hero
// wandering (owner report 2026-11-12: "it starts to run around on its own"; ruling 33).
//   fixture map: a click into a wall / the border snaps to an open point near the click and the order ENDS
//   (no slide-in-place livelock, the hero fights back afterwards); a crowd on the clicked spot ends the move
//   near it; a plain move never chases after arrival; an attack-move with a picked enemy walks past nearer
//   in-range minions to it, and falls back to a plain attack-move once it dies; determinism (two runs equal).
//   real RIFT catalog (content build): clicks into a pillar, a jungle wall, an allied tower's footprint and
//   200 random clicks around lanes and jungle all finish with 0 drift and 0 heading flips afterwards.
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, section } from './fixtures/sim_fixture.ts';
import { issueMove } from '../src/sim/movement.ts';
import { killEntity } from '../src/sim/combat.ts';
import { ORDER_ATTACK_MOVE, ORDER_MOVE, ORDER_NONE, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';

const cat = buildCatalog({
  fighters: [
    fighter('fx_slinger', { base: { ad: 1, attackSpeed: 1, moveSpeed: 3.35 }, attack: { range: 5.6, windup: 0.2, projectileSpeed: 20 } }),
    fighter('fx_foe', { base: { ad: 0, attackSpeed: 0.1, moveSpeed: 3.35 }, attack: { range: 1.5, windup: 0.3 } }),
  ],
});

interface Walk { len: number; flips: number; net: number }
/** path length, heading reversals (> 90°) and net displacement of a run of positions */
function walk(pts: { x: number; y: number }[]): Walk {
  let len = 0, flips = 0, last: number | null = null;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y, d = Math.hypot(dx, dy);
    len += d;
    if (d > 1e-4) {
      const h = Math.atan2(dy, dx);
      if (last !== null) { let a = Math.abs(h - last); if (a > Math.PI) a = 2 * Math.PI - a; if (a > Math.PI / 2) flips++; }
      last = h;
    }
  }
  const net = pts.length > 1 ? Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) : 0;
  return { len, flips, net };
}
function trace(w: World, e: Entity, ticks: number, each?: (k: number) => void): { x: number; y: number; order: number }[] {
  const out: { x: number; y: number; order: number }[] = [];
  for (let k = 0; k < ticks; k++) { each?.(k); w.step(); out.push({ x: e.x, y: e.y, order: e.order }); }
  return out;
}
const f2 = (n: number): string => n.toFixed(2);

// ── fixture map: the wall slab is x 28..32, y 0..45 (clearance 0.25), map 60 × 60 ──
section('click into a wall: the goal snaps to the near side and the order ends', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 20, y: 20 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  issueMove(w, h, 30, 20, false);
  check('the order point is open ground', w.nav.walkable(h.orderX, h.orderY), [h.orderX, h.orderY]);
  check('…on the hero\'s side of the wall, next to the click', h.orderX < 28 && Math.hypot(h.orderX - 30, h.orderY - 20) < 3, [f2(h.orderX), f2(h.orderY)]);
  const tr = trace(w, h, 150);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('the move ends (no slide-in-place livelock)', end >= 0 && end < 120, end);
  const after = walk(tr.slice(end));
  check('0 drift and 0 heading flips after it ends', after.len < 1e-6 && after.flips === 0, after);
});

section('click deep into the map border: walks toward the click and stops at the edge', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 10, y: 50 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  issueMove(w, h, -20, 50, false);
  check('the goal is open, at the west edge on the click line', w.nav.walkable(h.orderX, h.orderY) && h.orderX < 1.5 && Math.abs(h.orderY - 50) < 1, [f2(h.orderX), f2(h.orderY)]);
  const tr = trace(w, h, 150);
  check('the move ends', h.order === ORDER_NONE);
  check('no flips while walking there', walk(tr).flips === 0, walk(tr));
});

section('a click into the middle of a thick wall stops on the hero\'s side (no detour round the wall)', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 20, y: 10 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  issueMove(w, h, 30.6, 10, false);   // inside the slab, a little past its middle
  check('the order point is open ground on the hero\'s side', w.nav.walkable(h.orderX, h.orderY) && h.orderX < 28, [f2(h.orderX), f2(h.orderY)]);
  const tr = trace(w, h, 150);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('the move ends', end >= 0, end);
  check('0 drift after it ends', walk(tr.slice(end)).len < 1e-6, walk(tr.slice(end)));
});
section('a click just inside the far face goes to that face (clearly nearer) and still ends', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 20, y: 10 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  issueMove(w, h, 31.9, 10, false);
  check('the order point is open ground beside the click', w.nav.walkable(h.orderX, h.orderY) && Math.hypot(h.orderX - 31.9, h.orderY - 10) < 1.5, [f2(h.orderX), f2(h.orderY)]);
  const tr = trace(w, h, 900);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('the move ends (round the wall through the gap)', end >= 0, end);
  check('0 drift after it ends', end >= 0 && walk(tr.slice(end)).len < 1e-6);
});

section('a shallow click just inside a wall face slides along the face to beside the click (no sticky walls)', () => {
  // verifier r2: B (the first open point on the click→hero line) was the hero's own cell for a diagonal click into
  // the face it stands at, so the order ended where the hero stood
  for (const [inX, ahead, minMove] of [[0.3, 3, 2.4], [0.4, 1.2, 0.9], [1.5, 2, 1.5], [0.6, 4, 3.4]] as const) {
    const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 27.4, y: 20 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
    const h = fighterEnt(w, 0);
    const x0 = h.x, y0 = h.y;
    issueMove(w, h, 28 + inX, 20 + ahead, false);
    check(`click ${inX} m in, ${ahead} m ahead: the goal is beside the click on the face`, h.orderX < 28 && Math.abs(h.orderY - (20 + ahead)) < 0.6, [f2(h.orderX), f2(h.orderY)]);
    const tr = trace(w, h, 120);
    const moved = Math.hypot(h.x - x0, h.y - y0);
    check(`click ${inX} m in, ${ahead} m ahead: the hero moves ≥ ${minMove} m along the face and the order ends`, moved >= minMove && tr[tr.length - 1].order === ORDER_NONE, f2(moved));
  }
});
section('hold-steer with the cursor kept just inside a wall face: the hero keeps sliding along it', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 27.4, y: 10 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  const y0 = h.y;
  // re-issue every ~140 ms (4 ticks) to a point 1.2–2 m ahead and 0.3–0.8 m inside the face, like a held right button
  trace(w, h, 90, (k) => { if (k % 4 === 0) issueMove(w, h, 28.3 + (k % 3) * 0.25, h.y + 1.2 + (k % 5) * 0.2, false); });
  check('3 s of hold-steer slides ≥ 8 m along the face', h.y - y0 >= 8, f2(h.y - y0));
});

section('wall click while an enemy is adjacent: the hero fights back after arriving', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 22, y: 20 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  h.autoAttack = true;
  const m = addUnit(w, 'fx_dummy', 1, 25, 23);
  issueMove(w, h, 30, 20, false);
  let attacks = 0;
  for (let k = 0; k < 150; k++) for (const ev of w.step()) if (ev.e === 'attack' && ev.src === h.id && ev.dst === m.id) attacks++;
  check('it auto-attacks the adjacent minion once the move ended', h.order === ORDER_NONE && attacks >= 2, { order: h.order, attacks });
});

section('a crowd standing on the clicked spot: the move ends near it within a second', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 10, y: 55 }, { fighter: 'fx_foe', team: 1, x: 55, y: 20 }]);
  const h = fighterEnt(w, 0);
  const crowd: Entity[] = [];
  for (let i = 0; i < 6; i++) crowd.push(addUnit(w, 'fx_dummy', 0, 14 + (i % 3) * 0.9, 54.5 + Math.floor(i / 3)));
  issueMove(w, h, 15, 55, false);
  const tr = trace(w, h, 150);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('the move ends within 3 s', end >= 0 && end < 90, end);
  check('…near the click', Math.hypot(h.x - 15, h.y - 55) < h.radius + 1.6, f2(Math.hypot(h.x - 15, h.y - 55)));
  check('0 drift after it ends', walk(tr.slice(end + 1)).len < 0.05, walk(tr.slice(end + 1)));
});

section('a move to open ground past a dense minion clump walks round it (no grinding through the blob)', () => {
  // verifier r2: a right-click past ~20 stacked minions took 9–12 s and often never arrived (body-blocked, crawling);
  // ruling 35: a walking fighter steers round units standing on its line
  for (const [n, team] of [[20, 1], [20, 0], [12, 1]] as const) {
    const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 10, y: 40 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
    const h = fighterEnt(w, 0);
    for (let i = 0; i < n; i++) addUnit(w, 'fx_dummy', team, 15 + (i % 5) * 0.75, 38.5 + Math.floor(i / 5) * 0.75);
    issueMove(w, h, 21.5, 40, false);
    const tr = trace(w, h, 300);
    const end = tr.findIndex((p) => p.order === ORDER_NONE);
    const wk = walk(tr.slice(0, end < 0 ? tr.length : end));
    check(`${n} ${team ? 'enemy' : 'allied'} minions in the way: arrives inside 5 s (11.5 m straight), no back-and-forth`, end >= 0 && end < 150 && wk.flips === 0 && Math.hypot(h.x - 21.5, h.y - 40) < 0.2, { end, len: f2(wk.len), flips: wk.flips });
  }
});
section('a plain move never chases after arrival', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 10, y: 55 }, { fighter: 'fx_foe', team: 1, x: 55, y: 20 }]);
  const h = fighterEnt(w, 0);
  h.autoAttack = true;
  addUnit(w, 'fx_dummy', 1, 24, 56); addUnit(w, 'fx_dummy', 1, 24.8, 54);
  issueMove(w, h, 16, 55, false);
  const tr = trace(w, h, 240);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('arrives', end >= 0);
  check('stays put afterwards (attacks in place only)', walk(tr.slice(end)).len < 1e-6, walk(tr.slice(end)));
});

// attack-move with a picked enemy (prefer): ranged hero, minion wave in front, the enemy fighter behind it
function wave(hx: number): { w: World; h: Entity; f: Entity; m: Entity[] } {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: hx, y: 50 }, { fighter: 'fx_foe', team: 1, x: 19, y: 52 }], { seed: 7 });
  const h = fighterEnt(w, 0), f = fighterEnt(w, 1);
  f.hp = f.maxHp = 1e6;
  const m = [addUnit(w, 'fx_dummy', 1, 14, 50), addUnit(w, 'fx_dummy', 1, 15, 53), addUnit(w, 'fx_dummy', 1, 17, 48)];
  w.hashDirty = true; w.vision.update(w.entities, w.tick);
  return { w, h, f, m };
}
function attacks(w: World, h: Entity, ticks: number, each?: (k: number) => void): number[] {
  const seq: number[] = [];
  for (let k = 0; k < ticks; k++) { each?.(k); for (const ev of w.step()) if (ev.e === 'attack' && ev.src === h.id) seq.push(ev.dst); }
  return seq;
}
section('attack-move with a picked enemy walks past in-range minions to it', () => {
  const { w, h, f, m } = wave(10);
  issueMove(w, h, f.x, f.y, true, f.id);
  const seq = attacks(w, h, 180);
  check('the picked fighter is the first and only target', seq.length > 0 && seq.every((id) => id === f.id), seq.map((id) => (id === f.id ? 'F' : `M${m.findIndex((x) => x.id === id) + 1}`)));
  check('the order is still a committed attack-move', h.order === ORDER_ATTACK_MOVE && h.orderTarget === f.id);
});
section('the picked enemy dies: the order falls back to a plain attack-move to its point', () => {
  const { w, h, f, m } = wave(10);
  issueMove(w, h, 21, 50, true, f.id);
  const seq = attacks(w, h, 120, (k) => { if (k === 40) killEntity(w, f, h); });
  check('it attacked the picked fighter first', seq[0] === f.id, seq);
  check('then the nearest minion in range (plain attack-move)', seq.slice(1).some((id) => m.some((x) => x.id === id)) && h.orderTarget === -1, { seq, orderTarget: h.orderTarget });
});
section('attack-move without a pick: walks and attacks the first enemy in range', () => {
  const { w, h, m } = wave(3);
  issueMove(w, h, 18, 51, true);
  const seq = attacks(w, h, 150);
  check('first target is the minion that came into range first', seq[0] === m[0].id, seq);
  check('stopped walking to attack (never chases)', h.order === ORDER_ATTACK_MOVE && h.x < 9, f2(h.x));
});
section('orders are deterministic (two runs, identical positions and orders)', () => {
  const run = (): string => {
    const { w, h, f } = wave(10);
    issueMove(w, h, f.x, f.y, true, f.id);
    const tr = trace(w, h, 90, (k) => { if (k === 30) issueMove(w, h, 30, 20, false); });
    return tr.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.order}`).join(';');
  };
  check('identical', run() === run());
});

// ── real RIFT catalog ──
async function rift(): Promise<void> {
  const { buildContent, defaultOptions } = await import('../tools/build_content.ts');
  const { createSim } = await import('../src/sim/sim.ts');
  const { pickLoadout } = await import('../src/sim/bots/index.ts');
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) { console.log('SKIP RIFT section: content build failed'); return; }
  const rc = r.catalog;
  const mode = rc.modes.find((m) => m.id === 'rift');
  const queue = rc.queues.find((q) => q.mode === 'rift');
  if (!mode || !queue) { console.log('SKIP RIFT section: no rift mode'); return; }
  const fs = rc.fighters.map((f) => f.id).sort();
  const hero = fs.includes('lisvel') ? 'lisvel' : fs[0];
  const fresh = () => {
    const seats = Array.from({ length: 10 }, (_, i) => {
      const fighter = i === 0 ? hero : fs[(i * 3) % fs.length];
      return { player: i, team: i < 5 ? 0 : 1, name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)?.id ?? '', controller: 'human' as const,
        loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i };
    });
    const sim = createSim(rc, { matchId: 'probe_orders', seed: 1, queue: queue.id, mode: 'rift', map: mode.map, seats, catalogVersion: rc.version } as never, { pregameSeconds: 0 });
    sim.step();
    return { sim, me: sim.world.players[0].ent! };
  };
  const place = (w: World, e: Entity, x: number, y: number): void => {
    e.x = x; e.y = y; e.path.length = 0; e.pathGoalX = NaN; w.hashDirty = true;
    if (!w.nav.walkable(x, y)) { const o = { x: 0, y: 0 }; if (w.nav.nearestWalkable(x, y, o)) { e.x = o.x; e.y = o.y; } }
  };
  const runTo = (sim: ReturnType<typeof fresh>['sim'], me: Entity, gx: number, gy: number, ticks: number) => {
    const tr: { x: number; y: number; order: number }[] = [];
    for (let k = 0; k < ticks; k++) { if (k === 0) sim.command(0, { type: 'move', x: gx, y: gy }); sim.step(); tr.push({ x: me.x, y: me.y, order: me.order }); }
    return tr;
  };
  for (const [name, gx, gy, sx, sy] of [['pillar centre', 85, 66.6, 85, 58], ['pillar far side', 85, 66.6, 85, 76], ['jungle wall', 70, 64.5, 70, 58], ['map border', 1, 30, 12, 45]] as const) {
    const { sim, me } = fresh(); place(sim.world, me, sx, sy);
    const tr = runTo(sim, me, gx, gy, 300);
    const end = tr.findIndex((p) => p.order === ORDER_NONE);
    const after = walk(tr.slice(Math.max(0, end)));
    check(`RIFT ${name}: the move ends with 0 drift and 0 flips afterwards`, end >= 0 && after.len < 0.05 && after.flips === 0, { end, after, at: [f2(me.x), f2(me.y)] });
  }
  {
    const { sim, me } = fresh();
    const w = sim.world;
    const tower = w.entities.filter((e) => e.kind === 'structure' && e.team === 0 && e.alive && e.radius > 0.5).sort((a, b) => a.id - b.id)[0];
    if (tower) {
      place(w, me, tower.x - 6, tower.y + 2);
      const tr = runTo(sim, me, tower.x + 0.2, tower.y + 0.3, 300);
      const end = tr.findIndex((p) => p.order === ORDER_NONE);
      check('RIFT allied tower footprint click: the move ends beside it, no drift', end >= 0 && walk(tr.slice(end)).len < 0.05, { end, after: walk(tr.slice(Math.max(0, end))) });
    }
  }
  {
    let s = 12345;
    const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const spots: [number, number][] = [[70, 55], [72, 40], [95, 75], [75, 12], [22, 55]];
    let n = 0, stuck = 0, open = 0;
    const bad: string[] = [];
    for (const [hx, hy] of spots) {
      const { sim } = fresh();
      for (let i = 0; i < 40; i++) {
        const me = sim.world.players[0].ent!;
        place(sim.world, me, hx, hy);
        const a = rnd() * Math.PI * 2, d = 2 + rnd() * 12;
        const gx = hx + Math.cos(a) * d, gy = hy + Math.sin(a) * d;
        const tr = runTo(sim, me, gx, gy, 300);
        sim.command(0, { type: 'stop' }); sim.step();
        n++;
        if (me.order === ORDER_NONE || tr[tr.length - 1].order === ORDER_NONE) open++;
        const tail = walk(tr.slice(-60));
        if (tr[tr.length - 1].order === ORDER_MOVE || tail.flips > 0) { stuck++; if (bad.length < 4) bad.push(`(${f2(hx)},${f2(hy)})→(${f2(gx)},${f2(gy)}) ${JSON.stringify(tail)}`); }
      }
    }
    check(`RIFT 200 random clicks 2–14 m away: every move ends inside 10 s, no flips at the end (${n - stuck}/${n})`, stuck === 0, bad);
    void open;
  }
  {
    // verifier r2 (bots): the sim snaps a blocked move point, so a bot that de-duplicates its moves against the snapped
    // orderX/Y re-sent a move to the same thicket point every tick (each one resetting the path and the windup)
    const { createBots } = await import('../src/sim/bots/index.ts');
    const seats = Array.from({ length: 10 }, (_, i) => {
      const fighter = fs[(i * 3 + 1) % fs.length];
      return { player: i, team: i < 5 ? 0 : 1, name: `b${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)?.id ?? '', controller: 'bot' as const,
        loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i, difficulty: 'adept' };
    });
    const setup = { matchId: 'probe_orders_bots', seed: 21, queue: queue.id, mode: 'rift', map: mode.map, seats, catalogVersion: rc.version } as never;
    const real = createBots(rc, setup);
    let moves = 0, redundant = 0, longest = 0;
    const runs = new Map<number, { x: number; y: number; n: number }>();
    let simRef: ReturnType<typeof createSim> | null = null;
    const bots = (seat: never, host: never) => {
      const c = real(seat, host);
      if (!c) return c;
      const pl = (seat as { player: number }).player;
      return { think: (w: World, p: never) => {
        const out = c.think(w as never, p);
        for (const cmd of out as { type: string; x?: number; y?: number }[]) {
          if (cmd.type !== 'move') continue;
          moves++;
          const blocked = !w.nav.walkable(cmd.x!, cmd.y!);
          const r = runs.get(pl);
          if (blocked && r && Math.abs(r.x - cmd.x!) + Math.abs(r.y - cmd.y!) < 0.6) { redundant++; r.n++; longest = Math.max(longest, r.n); }
          else runs.set(pl, { x: cmd.x!, y: cmd.y!, n: 0 });
        }
        return out;
      } };
    };
    simRef = createSim(rc, setup, { bots: bots as never, pregameSeconds: 0 });
    for (let k = 0; k < 30 * 240; k++) simRef.step();
    check(`RIFT 10 bots, 240 s: no bot re-sends a move to the same blocked point tick after tick (${redundant} repeats / ${moves} moves, longest run ${longest})`,
      longest < 10 && redundant < moves * 0.02, { moves, redundant, longest, faults: simRef.faults.slice(0, 2) });
  }

}

try { await rift(); } catch (err) { check(`RIFT section threw: ${(err as Error).stack ?? err}`, false); }
finish('probe_sim_core_orders');
