// orch1 adversarial verifier (sim / probe lens) for ruling 38 (clicks and pathing round 4). Read only on src/.
//   node _harness/_tmp_vfy_orch1_ctl.ts <walls|waves|hold|pick|det> <outJson>
import { writeFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { ORDER_NONE, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';

const SECTION = process.argv[2];
const OUT = process.argv[3];
const f2 = (n: number): number => Math.round(n * 100) / 100;
interface Walk { len: number; flips: number; net: number }
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
/** independent reference: shortest walk for a body of radius r0 round discs, 0.1 m grid, 16-neighbour Dijkstra */
function refPath(x0: number, y0: number, x1: number, y1: number, discs: { x: number; y: number; r: number }[], r0: number, ok: (x: number, y: number) => boolean): number {
  const h = 0.1, pad = 4;
  const minX = Math.min(x0, x1) - pad, minY = Math.min(y0, y1) - pad;
  const W = Math.ceil((Math.abs(x1 - x0) + 2 * pad) / h), H = Math.ceil((Math.abs(y1 - y0) + 2 * pad) / h);
  const blocked = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = minX + (i + 0.5) * h, y = minY + (j + 0.5) * h;
    if (!ok(x, y)) { blocked[j * W + i] = 1; continue; }
    for (const d of discs) { const rr = d.r + r0; if ((x - d.x) ** 2 + (y - d.y) ** 2 < rr * rr) { blocked[j * W + i] = 1; break; } }
  }
  const si = Math.floor((x0 - minX) / h), sj = Math.floor((y0 - minY) / h), gi = Math.floor((x1 - minX) / h), gj = Math.floor((y1 - minY) / h);
  for (const [ci, cj] of [[si, sj], [gi, gj]]) for (let dj = -7; dj <= 7; dj++) for (let di = -7; di <= 7; di++) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < W && j < H) blocked[j * W + i] = 0; }
  const dist = new Float64Array(W * H).fill(Infinity);
  const N: [number, number][] = [];
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if ((di || dj) && (Math.abs(di) !== 2 || Math.abs(dj) !== 2) && !(Math.abs(di) === 2 && dj === 0) && !(Math.abs(dj) === 2 && di === 0)) N.push([di, dj]);
  const heap: [number, number][] = [];
  const push = (d: number, k: number) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0]; const l = heap.pop()!; if (heap.length) { heap[0] = l; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[i][0] <= heap[c][0]) break; [heap[i], heap[c]] = [heap[c], heap[i]]; i = c; } } return t; };
  const s = sj * W + si, g = gj * W + gi;
  if (s < 0 || g < 0 || s >= W * H || g >= W * H) return Infinity;
  dist[s] = 0; push(0, s);
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    if (k === g) return d * h;
    const i = k % W, j = (k / W) | 0;
    for (const [di, dj] of N) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const m = nj * W + ni;
      if (blocked[m]) continue;
      if (Math.abs(di) + Math.abs(dj) > 1) { if (blocked[j * W + i + Math.sign(di)] && blocked[(j + Math.sign(dj)) * W + i]) continue; }
      const nd = d + Math.hypot(di, dj);
      if (nd < dist[m]) { dist[m] = nd; push(nd, m); }
    }
  }
  return Infinity;
}
const lcg = (seed: number) => { let s = seed; return (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

async function load() {
  const { buildContent, defaultOptions } = await import('../tools/build_content.ts');
  const { createSim } = await import('../src/sim/sim.ts');
  const { pickLoadout, createBots } = await import('../src/sim/bots/index.ts');
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) throw new Error('content build failed');
  const rc = r.catalog;
  const fs = rc.fighters.map((f) => f.id).sort();
  const fresh = (modeId: string, first: string, seed: number, humans = true) => {
    const mode = rc.modes.find((m) => m.id === modeId)!, queue = rc.queues.find((q) => q.mode === modeId)!;
    const seats = Array.from({ length: 10 }, (_, i) => {
      const fighter = i === 0 ? first : fs[(i * 5 + seed) % fs.length];
      return { player: i, team: i < 5 ? 0 : 1, name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)?.id ?? '', controller: (i === 0 || humans ? 'human' : 'bot') as never,
        loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i, difficulty: 'veteran' };
    });
    const setup = { matchId: 'vfy_orch1', seed, queue: queue.id, mode: modeId, map: mode.map, seats, catalogVersion: rc.version } as never;
    const sim = createSim(rc, setup, humans ? { pregameSeconds: 0 } : { bots: createBots(rc, setup) as never, pregameSeconds: 0 });
    sim.step();
    return { sim, me: sim.world.players[0].ent! };
  };
  return { rc, fs, fresh, createSim, createBots, pickLoadout };
}
type L = Awaited<ReturnType<typeof load>>;
const place = (w: World, e: Entity, x: number, y: number): void => { e.x = x; e.y = y; e.path.length = 0; e.pathGoalX = NaN; e.order = ORDER_NONE; w.hashDirty = true; };
const zeroTowers = (w: World): void => { for (const e of w.entities) if (e.kind === 'structure') e.stats.ad = 0; };

// ── A. wall clicks: shallow + deep, RIFT and BRIDGE, one fighter per distinct collision radius ──
async function walls(L: L) {
  const byR = new Map<number, string>();
  for (const f of L.rc.fighters) { const r = (f as { collisionRadius: number }).collisionRadius; if (!byR.has(r)) byR.set(r, f.id); }
  const out: Record<string, unknown> = { radii: [...byR.entries()] };
  for (const modeId of ['rift', 'bridge']) for (const [rad, who] of byR) for (const kind of ['shallow', 'deep'] as const) {
    const N = kind === 'shallow' ? 320 : 120;
    let { sim, me } = L.fresh(modeId, who, 5);
    let w = sim.world; const nav = w.nav; zeroTowers(w);
    const [W, H] = w.mapDef.size;
    let notLive = 0;
    const main = nav.componentAt(me.x, me.y);
    const rnd = lcg(31337 + Math.round(rad * 1000) + (modeId === 'bridge' ? 7 : 0) + (kind === 'deep' ? 99 : 0));
    const t = { x: 0, y: 0 }, route: number[] = [];
    let n = 0, far = 0, long = 0, away1 = 0, open = 0, worstFar = 0, worstAway = 0, worstLong = 0, tries = 0, farFromClick = 0;
    const bad: string[] = [];
    while (n < N && tries++ < 400000) {
      const hx = 3 + rnd() * (W - 6), hy = 3 + rnd() * (H - 6);
      if (!nav.walkable(hx, hy) || nav.componentAt(hx, hy) !== main) continue;
      let cx: number, cy: number;
      const a = rnd() * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
      if (kind === 'shallow') {
        if (n % 2 === 0) {
          let hit = -1;
          for (let d = 0.1; d < 7; d += 0.05) if (!nav.walkable(hx + ux * d, hy + uy * d)) { hit = d; break; }
          if (hit < 0) continue;
          const depth = 0.1 + rnd() * 1.4, lat = (rnd() - 0.5) * 1.5;
          cx = hx + ux * (hit + depth) - uy * lat; cy = hy + uy * (hit + depth) + ux * lat;
        } else { const d = 0.8 + rnd() * 8; cx = hx + ux * d; cy = hy + uy * d; }
        if (cx < 0 || cy < 0 || cx >= W || cy >= H || nav.walkable(cx, cy)) continue;
        if (!nav.nearestWalkable(cx, cy, t, 6) || Math.hypot(t.x - cx, t.y - cy) > 1.5) continue;
      } else {
        const d = 3 + rnd() * 10; cx = hx + ux * d; cy = hy + uy * d;
        if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1 || nav.walkable(cx, cy)) continue;
        if (nav.nearestWalkable(cx, cy, t, 16) && Math.hypot(t.x - cx, t.y - cy) < 1.5) continue;
      }
      if (w.phase !== 'live' || w.tick > 30 * 600) { ({ sim, me } = L.fresh(modeId, who, 5)); w = sim.world; zeroTowers(w); }
      if (w.entities.some((e) => e !== me && e.alive && !e.static && e.kind !== 'projectile' && e.kind !== 'zone' && (Math.hypot(e.x - hx, e.y - hy) < 14 || Math.hypot(e.x - cx, e.y - cy) < 10))) continue;
      place(w, me, hx, hy); sim.step();
      if (Math.hypot(me.x - hx, me.y - hy) > 0.3) continue;
      const x0 = me.x, y0 = me.y, d0 = Math.hypot(x0 - cx, y0 - cy);
      const tr = [{ x: x0, y: y0 }];
      for (let q = 0; q < 300; q++) { if (q === 0) sim.command(0, { type: 'move', x: cx, y: cy }); me.hp = me.maxHp; sim.step(); tr.push({ x: me.x, y: me.y }); if (q > 2 && me.order === ORDER_NONE) break; }
      if (w.phase !== 'live') { notLive++; continue; }
      n++;
      const wk = walk(tr);
      // best reachable end: open cells nearer the click, the walker's planner reaches at ≤ 1.3 × + 0.5 m never > 0.5 m further from the click
      nav.raycast(x0, y0, cx, cy, t);
      let ref = Math.hypot(t.x - cx, t.y - cy);
      const c = nav.cell, R = Math.min(ref, 16);
      const cells: [number, number, number][] = [];
      for (let gy = Math.floor((cy - R) / c); gy <= Math.floor((cy + R) / c); gy++) for (let gx = Math.floor((cx - R) / c); gx <= Math.floor((cx + R) / c); gx++) {
        const px = (gx + 0.5) * c, py = (gy + 0.5) * c, dd = Math.hypot(px - cx, py - cy);
        if (dd < ref && nav.walkable(px, py) && nav.componentAt(px, py) === main) cells.push([dd, px, py]);
      }
      cells.sort((p, q) => p[0] - q[0]);
      let tried = 0;
      for (const [dd, px, py] of cells) {
        if (tried++ > 60) break;
        if (!nav.findPath(x0, y0, px, py, route, me.radius)) continue;
        let l = 0, qx = x0, qy = y0, aw = 0;
        for (let i = 0; i < route.length; i += 2) {
          for (const f of [0.25, 0.5, 0.75, 1]) { const ix = qx + (route[i] - qx) * f, iy = qy + (route[i + 1] - qy) * f; aw = Math.max(aw, Math.hypot(ix - cx, iy - cy) - d0); }
          l += Math.hypot(route[i] - qx, route[i + 1] - qy); qx = route[i]; qy = route[i + 1];
        }
        if (Math.hypot(qx - px, qy - py) < 1e-3 && l <= Math.hypot(px - x0, py - y0) * 1.3 + 0.5 && aw <= 0.5) { ref = dd; break; }
      }
      const dEnd = Math.hypot(me.x - cx, me.y - cy);
      const exc = dEnd - ref;
      let away = 0; for (const p of tr) away = Math.max(away, Math.hypot(p.x - cx, p.y - cy) - d0);
      worstFar = Math.max(worstFar, exc); worstAway = Math.max(worstAway, away); worstLong = Math.max(worstLong, wk.len - (1.6 * wk.net + 1));
      if (kind === 'shallow' && dEnd > 2.5) farFromClick++;
      const tags: string[] = [];
      if (exc > 1) { far++; tags.push(`far +${f2(exc)}`); }
      if (wk.len > 1.6 * wk.net + 1) { long++; tags.push(`long ${f2(wk.len)}/${f2(wk.net)}`); }
      if (away > 1) { away1++; tags.push(`away ${f2(away)}`); }
      if (me.order !== ORDER_NONE) { open++; tags.push('open'); }
      if (tags.length && bad.length < 8) bad.push(`${who} ${tags.join('+')} (${f2(x0)},${f2(y0)})→(${f2(cx)},${f2(cy)}) end (${f2(me.x)},${f2(me.y)}) ref ${f2(ref)} walked ${f2(wk.len)} net ${f2(wk.net)}`);
    }
    const key = `${modeId}_${kind}_r${rad}_${who}`;
    out[key] = { n, far, long, away1, open, worstFar: f2(worstFar), worstAway: f2(worstAway), worstLongOver: f2(worstLong), shallowEndsOver2_5mFromClick: farFromClick, notLiveDiscarded: notLive, bad };
    console.log(key, JSON.stringify(out[key]));
  }
  return out;
}

// ── B. moves through live waves ──
async function waves(L: L) {
  const out: Record<string, unknown> = {};
  const bodies = (w: World, me: Entity, x: number, y: number, R: number) => w.entities
    .filter((o) => o !== me && o.alive && !o.static && (o.kind === 'minion' || o.kind === 'fighter' || o.kind === 'monster') && Math.hypot(o.x - x, o.y - y) < R)
    .map((o) => ({ x: o.x, y: o.y, r: o.radius }));
  const crowdAt = (w: World, me: Entity, x: number, y: number) => w.entities
    .filter((o) => o !== me && o.alive && !o.static && (o.kind === 'minion' || o.kind === 'fighter' || o.kind === 'monster') && Math.hypot(o.x - x, o.y - y) < o.radius + me.radius + 0.6).length;
  for (const modeId of ['rift', 'bridge']) {
    let n = 0, dither = 0, ditherMax = 0, shortLane = 0, shortAny = 0, reversals = 0, revMax = 0, rev5 = 0, clear = 0, over15 = 0, worstClear = 0, awayGoal = 0, worstAwayGoal = 0, detVsLane = 0, postDrift = 0, awayGoalLane = 0;
    const ratios: number[] = [], laneRatios: number[] = [];
    const bad: string[] = [];
    for (const seed of [3, 13, 29]) for (const who of L.fs) {
      const { sim, me } = L.fresh(modeId, who, seed);
      const w = sim.world, nav = w.nav;
      zeroTowers(w);
      const main = nav.componentAt(me.x, me.y);
      const rnd = lcg(55001 + 7919 * L.fs.indexOf(who) + seed * 104729);
      let k = 0;
      for (let t = 0; t < 30 * 420 && k < 17; t++) {
        me.hp = me.maxHp; sim.step();
        if (t < 30 * 35 || t % 37) continue;
        const ms = w.entities.filter((e) => e.kind === 'minion' && e.alive);
        if (ms.length < 6) continue;
        const m = ms[Math.floor(rnd() * ms.length)];
        if (ms.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) < 4).length < 3) continue;
        const a = rnd() * Math.PI * 2;
        const back = 1.5 + rnd() * 4;
        const hx = m.x - Math.cos(a) * back, hy = m.y - Math.sin(a) * back;
        const d = 5 + rnd() * 10, gx = hx + Math.cos(a) * d, gy = hy + Math.sin(a) * d;
        if (!nav.walkable(hx, hy) || !nav.walkable(gx, gy) || nav.componentAt(gx, gy) !== main || nav.componentAt(hx, hy) !== main || !nav.lineOfWalk(hx, hy, gx, gy, me.radius)) continue;
        place(w, me, hx, hy); sim.step();
        const x0 = me.x, y0 = me.y, straight = Math.hypot(gx - x0, gy - y0), dg0 = straight;
        const lane = refPath(x0, y0, gx, gy, bodies(w, me, x0, y0, 18), me.radius, (x, y) => nav.walkable(x, y));
        const tr = [{ x: x0, y: y0 }];
        let last = 0, ag = 0;
        const flipAt: number[] = [];
        let endQ = -1;
        const wdiag = process.env.WDIAG === `${modeId}:${who}:${seed}:${t}`;
        if (wdiag) console.log(`WDIAG start (${f2(x0)},${f2(y0)}) goal (${f2(gx)},${f2(gy)}) straight ${f2(straight)} refLane ${f2(lane)} r${me.radius} tick ${w.tick}`);
        for (let q = 0; q < 360; q++) {
          if (q === 0) sim.command(0, { type: 'move', x: gx, y: gy });
          me.hp = me.maxHp; sim.step(); tr.push({ x: me.x, y: me.y });
          if (wdiag && q % 3 === 0) {
            const ex = me as unknown as Record<string, unknown>;
            const nb = w.entities.filter((o) => o !== me && o.alive && (o.kind === 'minion' || o.kind === 'fighter' || o.kind === 'structure') && Math.hypot(o.x - me.x, o.y - me.y) < o.radius + me.radius + 1.5)
              .map((o) => `${o.kind[0]}${o.team}@${f2(o.x)},${f2(o.y)}r${f2(o.radius)}v${f2(Math.hypot(o.vx ?? 0, o.vy ?? 0))}`).join(' ');
            console.log(`q${q} (${f2(me.x)},${f2(me.y)}) d${f2(Math.hypot(me.x - gx, me.y - gy))} order ${me.order} oxy ${f2(me.orderX)},${f2(me.orderY)} lane ${me.lane.length / 2} side ${me.steerSide} path ${me.path.length / 2} wt ${ex.watchTicks} ws ${ex.watchStage} wf ${ex.watchFails} lp ${ex.lanePlanned} st ${ex.arriveStall}/${ex.arrivePinned} | ${nb}`);
          }
          if (me.steerSide !== 0 && last !== 0 && me.steerSide !== last) flipAt.push(q);
          if (me.steerSide !== 0) last = me.steerSide;
          ag = Math.max(ag, Math.hypot(me.x - gx, me.y - gy) - dg0);
          if (q > 1 && me.order === ORDER_NONE) { endQ = q; break; }
        }
        // after the order ends: does the hero move on its own (beyond being shoved)? 20 ticks
        const ex = me.x, ey = me.y; let selfOrder = 0;
        for (let q = 0; q < 20; q++) { me.hp = me.maxHp; sim.step(); if (me.order !== ORDER_NONE) selfOrder++; }
        if (selfOrder > 0 && endQ >= 0) postDrift++;
        void ex; void ey;
        k++; n++;
        let dith = 0; for (let i = 0; i < flipAt.length; i++) { let c = 0; for (let j = i; j < flipAt.length && flipAt[j] - flipAt[i] <= 30; j++) c++; dith = Math.max(dith, c); }
        if (dith >= 5) dither++;
        ditherMax = Math.max(ditherMax, dith);
        const wk = walk(tr), dEnd = Math.hypot(tr[tr.length - 1].x - gx, tr[tr.length - 1].y - gy);
        reversals += wk.flips; revMax = Math.max(revMax, wk.flips); if (wk.flips > 4) rev5++;
        if (ag > 1) awayGoal++;
        if (ag > 1 && isFinite(lane)) awayGoalLane++;
        worstAwayGoal = Math.max(worstAwayGoal, ag);
        const crowd = crowdAt(w, me, gx, gy);
        const tags: string[] = [];
        if (dEnd > 0.5 && crowd === 0 && lane <= straight * 1.3) { shortLane++; tags.push(`short ${f2(dEnd)} (lane ${f2(lane / straight)}x)`); }
        if (dEnd > 2 && crowd === 0) shortAny++;
        if (dEnd < 0.3) { ratios.push(wk.len / straight); if (isFinite(lane)) { laneRatios.push(wk.len / lane); if (wk.len > lane * 1.3 + 1) { detVsLane++; tags.push(`detour ${f2(wk.len)} vs lane ${f2(lane)}`); } } }
        if (dEnd < 0.3 && lane <= straight * 1.05) {
          clear++; worstClear = Math.max(worstClear, wk.len / straight);
          if (wk.len > straight * 1.15) over15++;
        }
        if (dith >= 5) tags.push(`dither ${dith}`);
        if (ag > 1) tags.push(`awayFromGoal ${f2(ag)}${isFinite(lane) ? '' : ' (boxed in: no way through the bodies)'}`);
        if (wk.flips > 4) tags.push(`reversals ${wk.flips}`);
        if (tags.length && bad.length < 14) bad.push(`${who} s${seed} t${t} (${f2(x0)},${f2(y0)})→(${f2(gx)},${f2(gy)}) ${tags.join(' ')}`);
      }
    }
    const pct = (arr: number[], p: number) => { const s = [...arr].sort((a, b) => a - b); return s.length ? f2(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null; };
    out[modeId] = { n, dither5in1s: dither, ditherMax, shortOfOpenGoalWithLane: shortLane, endedOver2mShortUncrowded: shortAny, reversals, revMax, movesOver4Reversals: rev5,
      walkedOver1mAwayFromGoal: awayGoal, walkedOver1mAwayWithAWayThrough: awayGoalLane, worstAwayFromGoal: f2(worstAwayGoal), arrivedDetourOverLane1_3p1: detVsLane, orderRestartedAfterEnd: postDrift,
      clearLane: clear, clearOver1_15: over15, clearOver1_15Pct: f2(100 * over15 / Math.max(1, clear)), worstClear: f2(worstClear),
      ratioP50: pct(ratios, 0.5), ratioP95: pct(ratios, 0.95), ratioMax: pct(ratios, 0.9999), vsLaneP95: pct(laneRatios, 0.95), vsLaneMax: pct(laneRatios, 0.9999), bad };
    console.log(modeId, JSON.stringify(out[modeId]));
  }
  return out;
}

// ── C. hold-steer into faces and concave corners ──
async function hold(L: L) {
  const out: Record<string, unknown> = {};
  for (const modeId of ['rift', 'bridge']) for (const who of ['ulkro', 'ardit', 'sukri', 'lisvel'].filter((x) => L.fs.includes(x))) {
    const { sim, me } = L.fresh(modeId, who, 1);
    const w = sim.world, nav = w.nav; zeroTowers(w);
    const [W, H] = w.mapDef.size;
    const main = nav.componentAt(me.x, me.y);
    const rnd = lcg(808 + who.length * 31 + (modeId === 'bridge' ? 5 : 0));
    let nf = 0, nc = 0, tries = 0, faceBackWorst = 0, faceBack = 0, faceJitter = 0, cornerBackWorst = 0, cornerBack = 0, cornerJitter = 0, cornerRevWorst = 0;
    const bad: string[] = [];
    while ((nf < 40 || nc < 40) && tries++ < 600000) {
      const hx = 3 + rnd() * (W - 6), hy = 3 + rnd() * (H - 6);
      if (!nav.walkable(hx, hy) || nav.componentAt(hx, hy) !== main) continue;
      if (w.entities.some((e) => e !== me && e.alive && !e.static && e.kind !== 'projectile' && e.kind !== 'zone' && Math.hypot(e.x - hx, e.y - hy) < 12)) continue;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const hits = dirs.map(([nx, ny]) => { for (let d = 0.05; d < 2.5; d += 0.05) if (!nav.walkable(hx + nx * d, hy + ny * d)) return d; return -1; });
      let corner: number[] | null = null;
      for (const [i, j] of [[0, 2], [0, 3], [1, 2], [1, 3]]) if (hits[i] > 0 && hits[j] > 0) corner = [i, j];
      let cx: number, cy: number, isCorner: boolean;
      if (corner && nc < 40) {
        const [i, j] = corner;
        cx = hx + dirs[i][0] * (hits[i] + 0.7) + dirs[j][0] * (hits[j] + 0.7);
        cy = hy + dirs[i][1] * (hits[i] + 0.7) + dirs[j][1] * (hits[j] + 0.7);
        if (nav.walkable(cx, cy)) continue;
        isCorner = true;
      } else if (!corner && nf < 40) {
        const k = hits.findIndex((h) => h > 0);
        if (k < 0) continue;
        const lat = (rnd() - 0.5) * 1.6;
        cx = hx + dirs[k][0] * (hits[k] + 0.8) - dirs[k][1] * lat; cy = hy + dirs[k][1] * (hits[k] + 0.8) + dirs[k][0] * lat;
        if (nav.walkable(cx, cy)) continue;
        isCorner = false;
      } else continue;
      place(w, me, hx, hy); sim.step();
      if (Math.hypot(me.x - hx, me.y - hy) > 0.3) continue;
      const tr = [{ x: me.x, y: me.y }];
      let minD = Math.hypot(me.x - cx, me.y - cy), back = 0;
      for (let q = 0; q < 120; q++) {
        if (q % 4 === 0) sim.command(0, { type: 'move', x: cx, y: cy });
        me.hp = me.maxHp; sim.step(); tr.push({ x: me.x, y: me.y });
        const d = Math.hypot(me.x - cx, me.y - cy);
        back = Math.max(back, d - minD); minD = Math.min(minD, d);
      }
      const tail = walk(tr.slice(-45));
      const all = walk(tr);
      if (isCorner) { nc++; cornerBackWorst = Math.max(cornerBackWorst, back); if (back > 0.1) cornerBack++; if (tail.len > 0.15) cornerJitter++; cornerRevWorst = Math.max(cornerRevWorst, all.flips); }
      else { nf++; faceBackWorst = Math.max(faceBackWorst, back); if (back > 0.1) faceBack++; if (tail.len > 0.15) faceJitter++; }
      if ((back > 0.1 || tail.len > 0.15 || all.flips > 2) && bad.length < 8) bad.push(`${isCorner ? 'corner' : 'face'} (${f2(hx)},${f2(hy)})→(${f2(cx)},${f2(cy)}) back ${f2(back)} tailMove ${f2(tail.len)} flips ${all.flips} end (${f2(me.x)},${f2(me.y)})`);
    }
    out[`${modeId}_${who}`] = { faces: nf, faceBack: faceBack, faceBackWorst: f2(faceBackWorst), faceTailJitter: faceJitter, corners: nc, cornerBack, cornerBackWorst: f2(cornerBackWorst), cornerTailJitter: cornerJitter, cornerReversalsWorst: cornerRevWorst, bad };
    console.log(modeId, who, JSON.stringify(out[`${modeId}_${who}`]));
  }
  return out;
}

// ── D. pick occlusion: real pick.ts against an independent truth (first ray hit on body cylinders) ──
async function pick(L: L) {
  (globalThis as { document?: unknown }).document ??= { elementFromPoint: () => null };
  const { pickUnit } = await import('../src/render/pick.ts');
  const { CAMERA } = await import('../src/render/camera.ts');
  const fighters = L.rc.fighters.map((f) => ({ id: f.id, H: (f as { art: { height: number; scale: number } }).art.height * (f as { art: { scale: number } }).art.scale, r: (f as { collisionRadius: number }).collisionRadius }));
  const mins = (L.rc as unknown as { units: { id: string; kind: string; collisionRadius: number; art: { height: number; scale: number } }[] }).units.filter((u) => u.kind === 'minion' && u.id !== 'sparring_post').map((u) => ({ id: u.id, H: u.art.height * u.art.scale, r: u.collisionRadius }));
  const view = (id: number, kind: string, x: number, y: number, radius: number) => ({ id, kind, team: 1, x, y, radius, alive: true, targetable: true, visibleMask: 3, statuses: [], vx: 0, vy: 0 }) as never;
  // body cylinder for the truth: half the collision radius (the rule's "drawn body"), heights 0..H
  const rayHit = (o: Vector3, d: Vector3, x: number, y: number, rr: number, H: number): number => {
    // vertical cylinder axis (x, *, y) radius rr, y in [0,H]; returns t or Infinity
    const ox = o.x - x, oz = o.z - y, a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - rr * rr;
    const disc = b * b - 4 * a * c; if (disc < 0) return Infinity;
    const s = Math.sqrt(disc);
    for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) { if (t <= 0) continue; const hy = o.y + d.y * t; if (hy >= 0 && hy <= H) return t; }
    // top cap
    const tc = (H - o.y) / d.y; if (tc > 0) { const px = o.x + d.x * tc - x, pz = o.z + d.z * tc - y; if (px * px + pz * pz <= rr * rr) return tc; }
    return Infinity;
  };
  let total = 0, wrong = 0, wrongF = 0, wrongM = 0, totF = 0, totM = 0, clumpTot = 0, clumpWrong = 0;
  const bad: string[] = [], clumpBad: string[] = [];
  const rnd = lcg(4711);
  for (const [w, h] of [[1920, 1080], [1280, 720]]) for (const dist of [CAMERA.minDistance, CAMERA.distance, CAMERA.maxDistance]) {
    const cm = new PerspectiveCamera(CAMERA.fovDeg, w / h, 1, 400);
    const p = (CAMERA.pitchDeg * Math.PI) / 180;
    cm.position.set(50, Math.sin(p) * dist, 50 + Math.cos(p) * dist); cm.rotation.set(-p, 0, 0); cm.updateMatrixWorld(true); cm.updateProjectionMatrix();
    const ray = (sx: number, sy: number) => new Vector3((sx / w) * 2 - 1, -(sy / h) * 2 + 1, 0.5).unproject(cm).sub(cm.position).normalize();
    const scr = (x: number, y: number, hh: number) => { const v = new Vector3(x, hh, y).project(cm); return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h }; };
    for (const [u, vv] of [[0.5, 0.5], [0.08, 0.5], [0.92, 0.5], [0.5, 0.12], [0.5, 0.9], [0.1, 0.12], [0.9, 0.12], [0.1, 0.9], [0.9, 0.9], [0.3, 0.3], [0.7, 0.7]]) {
      const dir = new Vector3(u * 2 - 1, -(vv * 2 - 1), 0.5).unproject(cm).sub(cm.position).normalize();
      const t0 = -cm.position.y / dir.y, gx = cm.position.x + dir.x * t0, gy = cm.position.z + dir.z * t0;
      // pairs: a fighter and a minion touching it at every bearing (behind, beside, in front)
      for (const f of fighters) for (const m of mins) for (let ang = -180; ang < 180; ang += 22.5) {
        const a = (ang * Math.PI) / 180, D = f.r + m.r, mx = gx + Math.sin(a) * D, my = gy - Math.cos(a) * D;
        const units = [
          { id: 1, x: gx, y: gy, h: 0, artHeight: f.H, view: view(1, 'fighter', gx, gy, f.r) },
          { id: 2, x: mx, y: my, h: 0, artHeight: m.H, view: view(2, 'minion', mx, my, m.r) },
        ];
        // click samples on each body's cylinder surface facing the camera (inside by 15 %)
        for (const [tid, ux, uy, uH, ur] of [[1, gx, gy, f.H, f.r], [2, mx, my, m.H, m.r]] as const) {
          for (const hf of [0.15, 0.4, 0.65, 0.85, 0.95]) for (const lat of [-0.7, -0.35, 0, 0.35, 0.7]) {
            const c = scr(ux + lat * ur * 0.5, uy + ur * 0.5 * 0.0, uH * hf);
            if (c.x < 0 || c.x > w || c.y < 0 || c.y > h) continue;
            const d = ray(c.x, c.y);
            const tf = rayHit(cm.position, d, gx, gy, f.r * 0.5, f.H), tm = rayHit(cm.position, d, mx, my, m.r * 0.5, m.H);
            if (!isFinite(tf) && !isFinite(tm)) continue;
            const truth = tf <= tm ? 1 : 2;
            // only clear cases: the ray hits the truth well before the other (or misses the other)
            if (Math.abs(tf - tm) < 0.08) continue;
            if (truth !== tid) continue;   // sample belongs to the visible body
            total++; if (truth === 1) totF++; else totM++;
            const got = pickUnit(cm, w, h, units as never, c.x, c.y, { slop: 14 });
            if (got !== truth) { wrong++; if (truth === 1) wrongF++; else wrongM++; if (bad.length < 12) bad.push(`${w}x${h} d${dist} (${u},${vv}) ${f.id}+${m.id} ${ang}° click on ${truth === 1 ? 'fighter' : 'minion'} h${hf} lat${lat} got ${got}`); }
          }
        }
      }
      // minion clumps: 5-8 touching minions, click the visible part of each (owner: "hard to target specific minions")
      for (let rep = 0; rep < 60; rep++) {
        const units: { id: number; x: number; y: number; h: number; artHeight: number; view: never; r: number }[] = [];
        let tries = 0;
        const cnt = 5 + Math.floor(rnd() * 4);
        while (units.length < cnt && tries++ < 400) {
          const m = mins[Math.floor(rnd() * mins.length)];
          const x = gx + (rnd() - 0.5) * 3.5, y = gy + (rnd() - 0.5) * 3.5;
          if (units.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + m.r - 0.05)) continue;
          units.push({ id: 10 + units.length, x, y, h: 0, artHeight: m.H, view: view(10 + units.length, 'minion', x, y, m.r), r: m.r });
        }
        for (const tgt of units) for (const hf of [0.3, 0.6, 0.85]) for (const lat of [-0.5, 0, 0.5]) {
          const c = scr(tgt.x + lat * tgt.r * 0.5, tgt.y, tgt.artHeight * hf);
          if (c.x < 0 || c.x > w || c.y < 0 || c.y > h) continue;
          const d = ray(c.x, c.y);
          let bestT = Infinity, bestId = -1, second = Infinity;
          for (const o of units) { const t = rayHit(cm.position, d, o.x, o.y, o.r * 0.5, o.artHeight); if (t < bestT) { second = bestT; bestT = t; bestId = o.id; } else if (t < second) second = t; }
          if (bestId !== tgt.id || second - bestT < 0.08) continue;
          clumpTot++;
          const got = pickUnit(cm, w, h, units as never, c.x, c.y, { slop: 14 });
          if (got !== tgt.id) { clumpWrong++; if (clumpBad.length < 10) clumpBad.push(`${w}x${h} d${dist} (${u},${vv}) clump ${units.length} click visible ${tgt.id} h${hf} lat${lat} got ${got}`); }
        }
      }
    }
  }
  const o = { pairs: { total, wrong, fighterClicks: totF, fighterWrong: wrongF, minionClicks: totM, minionWrong: wrongM, bad }, clumps: { total: clumpTot, wrong: clumpWrong, bad: clumpBad } };
  console.log(JSON.stringify(o));
  return o;
}

// ── E. determinism: the same command stream (human seat: wave moves, wall clicks, held re-sends) twice ──
async function det(L: L) {
  const { matchDigest } = await import('../src/sim/modes/match.ts');
  const { hashString } = await import('../src/sim/rng.ts');
  const out: Record<string, unknown> = {};
  for (const modeId of ['rift', 'bridge']) {
    const run = () => {
      const { sim, me } = L.fresh(modeId, 'ulkro', 17, false);
      const rnd = lcg(9001);
      let h = 0x811c9dc5, last: { x: number; y: number } | null = null;
      for (let t = 0; t < 30 * 420; t++) {
        if (t % 15 === 0) {
          const r = rnd();
          if (r < 0.15 || !last) last = { x: me.x + (rnd() - 0.5) * 24, y: me.y + (rnd() - 0.5) * 24 };   // new click (anywhere: walls, waves)
          sim.command(0, { type: 'move', x: last.x, y: last.y });                                      // held re-send of the same point
        }
        if (t % 211 === 5) sim.command(0, { type: 'move', x: me.x + 3, y: me.y + 1, attackMove: true });
        for (const e of sim.step()) h = hashString(JSON.stringify(e), h);
        if (t % 30 === 0) h = hashString(`${me.x.toFixed(6)},${me.y.toFixed(6)},${me.order},${me.lane.length}`, h);
      }
      return { digest: matchDigest(sim.world, null), events: h.toString(16), x: me.x, y: me.y };
    };
    const a = run(), b = run();
    out[modeId] = { a, b, same: a.digest === b.digest && a.events === b.events && a.x === b.x && a.y === b.y };
    console.log(modeId, JSON.stringify(out[modeId]));
  }
  return out;
}

// ── F. held button through packed lane fights after 4:00 (the live HOLD-DITHER repro shape): the controller's held
//      re-send (same point every 500 ms = 15 ticks while > 2 m short), 9 s held. Reversals are counted like the live
//      lens: turning points of the projection on the start→goal axis that swing >= 0.5 m (zigzag filter).
const HELD_T0 = Number(process.env.HELD_T0 ?? '240');
const DIAG = process.env.DIAG ?? '';
async function held(L: L) {
  const out: Record<string, unknown> = {};
  const crowdAt = (w: World, me: Entity, x: number, y: number) => w.entities
    .filter((o) => o !== me && o.alive && !o.static && (o.kind === 'minion' || o.kind === 'fighter' || o.kind === 'monster') && Math.hypot(o.x - x, o.y - y) < o.radius + me.radius + 0.6).length;
  for (const modeId of ['rift', 'bridge']) {
    let deadOrDisplaced = 0, n = 0, rev3 = 0, rev5 = 0, revMax = 0, shortUncrowded = 0, shortAny = 0, regress1 = 0, worstRegress = 0, nearTower = 0, worstShort = 0, forcedN = 0, regress1Free = 0, worstRegressFree = 0;
    const tArrive: number[] = [];
    const bad: string[] = [];
    for (const seed of [7, 19]) for (const who of L.fs) {
      const { sim, me } = L.fresh(modeId, who, seed, process.env.HELD_BOTS !== '1');
      const w = sim.world, nav = w.nav;
      if (process.env.HELD_BOTS !== '1') zeroTowers(w);
      const main = nav.componentAt(me.x, me.y);
      const rnd = lcg(77003 + 7919 * L.fs.indexOf(who) + seed * 104729 + (modeId === 'bridge' ? 13 : 0));
      let k = 0;
      for (let t = 0; t < 30 * 800 && k < 12; t++) {
        me.hp = me.maxHp; sim.step();
        if (w.phase !== 'live') break;
        if (t < 30 * HELD_T0 || t % 41) continue;
        const ms = w.entities.filter((e) => e.kind === 'minion' && e.alive);
        if (ms.length < 8) continue;
        const m = ms[Math.floor(rnd() * ms.length)];
        const near = ms.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) < 4);
        if (near.length < 5) continue;
        const a = rnd() * Math.PI * 2, back = 1.5 + rnd() * 2.5;
        const hx = m.x - Math.cos(a) * back, hy = m.y - Math.sin(a) * back;
        const d = 6 + rnd() * 6, gx = hx + Math.cos(a) * d, gy = hy + Math.sin(a) * d;
        if (!nav.walkable(hx, hy) || !nav.walkable(gx, gy) || nav.componentAt(gx, gy) !== main || nav.componentAt(hx, hy) !== main || !nav.lineOfWalk(hx, hy, gx, gy, me.radius)) continue;
        place(w, me, hx, hy); sim.step();
        if (Math.hypot(me.x - hx, me.y - hy) > 0.6 || !me.alive) continue;
        const x0 = me.x, y0 = me.y, ux = (gx - x0) / Math.hypot(gx - x0, gy - y0), uy = (gy - y0) / Math.hypot(gx - x0, gy - y0);
        const tw = Math.min(...w.entities.filter((e) => e.kind === 'structure' && e.alive).map((e) => Math.hypot(e.x - x0, e.y - y0)));
        if (tw < 12) nearTower++;
        let minD = Math.hypot(gx - x0, gy - y0), regress = 0, arrivedAt = -1;
        let ext = 0, dirSign = 0, revs = 0;
        const diag = DIAG === `${modeId}:${who}:${seed}:${k}`;
        let displaced = false, px = me.x, py = me.y, forced = false;
        const dtr: string[] = [];
        for (let q = 0; q < 270; q++) {
          const dg = Math.hypot(me.x - gx, me.y - gy);
          if (q === 0 || (q % 15 === 0 && dg > 2 && !(diag && process.env.DIAG_NORESEND === '1'))) sim.command(0, { type: 'move', x: gx, y: gy });
          me.hp = me.maxHp; sim.step();
          const p = (me.x - x0) * ux + (me.y - y0) * uy;
          if (dirSign === 0) { if (p - ext >= 0.5) { dirSign = 1; ext = p; } else if (ext - p >= 0.5) { dirSign = -1; ext = p; } }
          else if (dirSign > 0) { if (p > ext) ext = p; else if (ext - p >= 0.5) { revs++; dirSign = -1; ext = p; } }
          else { if (p < ext) ext = p; else if (p - ext >= 0.5) { revs++; dirSign = 1; ext = p; } }
          const d2 = Math.hypot(me.x - gx, me.y - gy);
          if (Math.hypot(me.x - px, me.y - py) > 1.2) displaced = true;
          // forced movement (orch1 r2 late-held repro: an enemy's knock moved the hero 1.4 m off its goal): crowd control
          // on the hero, or a step faster than it walks (a dash or knock pushed it)
          if ((me as unknown as { ccMask: number }).ccMask !== 0 || Math.hypot(me.x - px, me.y - py) > me.stats.moveSpeed / 30 * 1.5 + 0.02) forced = true;
          px = me.x; py = me.y;
          regress = Math.max(regress, d2 - minD); minD = Math.min(minD, d2);
          if (arrivedAt < 0 && d2 < 0.5) arrivedAt = q;
          if (diag && q % 3 === 0) {
            const nb = w.entities.filter((o) => o !== me && o.alive && (o.kind === 'minion' || o.kind === 'fighter' || o.kind === 'structure') && Math.hypot(o.x - me.x, o.y - me.y) < o.radius + me.radius + 1.2)
              .map((o) => `${o.kind[0]}${o.team}@${f2(o.x)},${f2(o.y)}r${f2(o.radius)}${o.static ? 'S' : ''}v${f2(Math.hypot(o.vx ?? 0, o.vy ?? 0))}`).join(' ');
            const ex = me as unknown as Record<string, unknown>; dtr.push(`q${q} (${f2(me.x)},${f2(me.y)}) wk ${nav.walkable(me.x, me.y) ? 1 : 0} ms ${f2(me.stats.moveSpeed)} wt ${ex.watchTicks} ws ${ex.watchStage} wf ${ex.watchFails} np ${ex.noProgress} lp ${ex.lanePlanned} aw ${ex.atkWindup} cast ${me.cast ? 1 : 0} cc ${ex.ccMask} pc ${ex.pathCheck} st ${ex.arriveStall}/${ex.arrivePinned} d${f2(d2)} order ${me.order} lane ${me.lane.length / 2} side ${me.steerSide} path ${me.path.length / 2} | ${nb}`);
          }
          if (d2 < 0.3 && me.order === ORDER_NONE) break;
        }
        if (diag) { console.log(`DIAG ${modeId} ${who} s${seed} k${k} t${f2(w.tick / 30)} start (${f2(x0)},${f2(y0)}) goal (${f2(gx)},${f2(gy)}) r${me.radius}`); for (const l of dtr) console.log(l); }
        k++; n++;
        const dEnd = Math.hypot(me.x - gx, me.y - gy), crowd = crowdAt(w, me, gx, gy);
        if (!me.alive || displaced) { k--; n--; deadOrDisplaced++; continue; }
        revMax = Math.max(revMax, revs); if (revs >= 3) rev3++; if (revs >= 5) rev5++;
        if (regress > 1) regress1++; worstRegress = Math.max(worstRegress, regress);
        if (forced) forcedN++;
        else { if (regress > 1) regress1Free++; worstRegressFree = Math.max(worstRegressFree, regress); }
        if (dEnd > 2) shortAny++;
        if (dEnd > 2 && crowd === 0) { shortUncrowded++; worstShort = Math.max(worstShort, dEnd); }
        if (arrivedAt >= 0) tArrive.push(arrivedAt / 30);
        const tags: string[] = [];
        if (revs >= 3) tags.push(`reversals ${revs}`);
        if (regress > 1) tags.push(`regress ${f2(regress)}${forced ? ' (forced)' : ''}`);
        if (dEnd > 2) tags.push(`short ${f2(dEnd)} crowd ${crowd}`);
        if (tags.length && (bad.length < 16 || revs >= 3 || (dEnd > 2 && crowd === 0)) && bad.length < 40) bad.push(`${who} s${seed} k${k - 1} t${f2(w.tick / 30)}s (${f2(x0)},${f2(y0)})→(${f2(gx)},${f2(gy)}) tower ${f2(tw)} m ${tags.join(' ')}`);
      }
    }
    const s = [...tArrive].sort((a, b) => a - b);
    out[modeId] = { n, excludedDeadOrDisplaced: deadOrDisplaced, reversals3plus: rev3, reversals5plus: rev5, revMax, regressOver1m: regress1, worstRegress: f2(worstRegress), forcedMoves: forcedN, regressOver1mUnforced: regress1Free, worstRegressUnforced: f2(worstRegressFree), endedOver2mShort: shortAny, endedOver2mShortUncrowded: shortUncrowded,
      worstShortUncrowded: f2(worstShort), startsWithin12mOfStructure: nearTower, arrived: s.length, arriveP50s: s.length ? f2(s[s.length >> 1]) : null, arriveP95s: s.length ? f2(s[Math.floor(s.length * 0.95)]) : null, bad };
    console.log(modeId, JSON.stringify(out[modeId]));
  }
  return out;
}

const L = await load();
const t0 = Date.now();
const res = SECTION === 'walls' ? await walls(L) : SECTION === 'waves' ? await waves(L) : SECTION === 'hold' ? await hold(L) : SECTION === 'pick' ? await pick(L) : SECTION === 'held' ? await held(L) : await det(L);
writeFileSync(OUT, JSON.stringify({ section: SECTION, seconds: Math.round((Date.now() - t0) / 1000), res }, null, 1));
console.log('done', SECTION, Math.round((Date.now() - t0) / 1000), 's');
