// SCRATCH ONLY (netcode lane): per-tick entity counts, snapshot-size estimates, step cost, event volume,
// serialization cost. Runs one bot-played run per (titan, biome) and prints JSON.
// node _harness/measure_net.ts molo grideast 1337
import type { World, TitanInput } from '../src/core/types.ts';
import { SIM_HZ, cameraDistance, CAMERA } from '../src/core/config.ts';

const titan = (process.argv[2] ?? 'molo') as any;
const biome = (process.argv[3] ?? 'grideast') as any;
const seed = Number(process.argv[4] ?? 1337);

const wm = await import('../src/core/world.ts');
const dm = await import('../src/upgrades/draft.ts');
const bm = await import('./bot.ts');
const tm = await import('../src/core/types.ts');

const w: World = wm.createWorld({ titan, biome, seed, meta: { ...tm.EMPTY_RUN_META, unlocked: [] } as any });

// ---- byte model (quantized binary, documented in netcode.md §6) ----
const B_TITAN = 24, B_ENEMY = 12, B_PROJ = 14, B_PICKUP = 9, B_TG = 16, B_HAZ = 14, B_PROP = 9, B_BOSS = 48, B_PART = 6;
const B_HDR = 8;  // tick u32 + counts/flags

function pct(a: number[], p: number): number { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; }

const rows: any = { enemies: [], proj: [], pickups: [], tg: [], haz: [], propsMoving: [], events: [], evJson: [],
  snapFull: [], snapNear: [], snapNear4: [], stepMs: [], height: [], viewR: [], bldgChanged: [], serMs: [], serBytes: [], enemiesNear: [] };

let prevFloors = new Int32Array(w.city.buildings.length);
for (let i = 0; i < w.city.buildings.length; i++) prevFloors[i] = (w.city.buildings[i] as any).alive;

const maxTicks = 26 * 60 * SIM_HZ;
let i = 0;
for (; i < maxTicks && !w.run.result; i++) {
  let guard = 0;
  while (dm.hasPendingDraft(w) && guard++ < 200) {
    const chest = w.upgrades.chestDrafts > 0;
    const offer = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : dm.rollOffer(w, chest);
    if (!offer || !offer.length) break;
    dm.pickUpgrade(w, bm.botPickUpgrade(w, offer));
  }
  const inp: TitanInput = bm.botInput(w);
  const t0 = performance.now();
  wm.stepWorld(w, inp);
  rows.stepMs.push(performance.now() - t0);

  // per-tick counts
  let ne = 0, np = 0, nk = 0, nt = 0, nh = 0, nm = 0;
  for (const e of w.enemies) if (e.alive) ne++;
  for (const p of w.projectiles) if (p.alive) np++;
  for (const p of w.pickups) if (p.alive) nk++;
  for (const t of w.telegraphs) if (t.alive) nt++;
  for (const h of w.hazards) if (h.alive) nh++;
  for (const p of w.city.props) if ((p as any).lane >= 0 && (p as any).alive !== false) nm++;
  rows.enemies.push(ne); rows.proj.push(np); rows.pickups.push(nk); rows.tg.push(nt); rows.haz.push(nh); rows.propsMoving.push(nm);
  rows.events.push(w.events.length);

  if (i % 10 === 0) {
    // event JSON size this tick (what a host would forward for FX/audio)
    rows.evJson.push(JSON.stringify(w.events).length);
    // view radius: camera distance * tan(fov/2) * aspect-ish (ground footprint half-width, generous 1.6x for 16:9 + pitch)
    const H = w.titan.height;
    const D = cameraDistance(H);
    const R = D * Math.tan((CAMERA.fovDeg * Math.PI / 180) / 2) * 1.78 * 1.4;
    rows.height.push(H); rows.viewR.push(R);
    const T = w.titan;
    let eNear = 0, pNear = 0, kNear = 0, tNear = 0, hNear = 0, mNear = 0;
    const R2 = R * R;
    const near = (x: number, z: number) => (x - T.x) * (x - T.x) + (z - T.z) * (z - T.z) <= R2;
    for (const e of w.enemies) if (e.alive && near(e.x, e.z)) eNear++;
    for (const p of w.projectiles) if (p.alive && near(p.x, p.z)) pNear++;
    for (const p of w.pickups) if (p.alive && near(p.x, p.z)) kNear++;
    for (const t of w.telegraphs) if (t.alive) tNear++;
    for (const h of w.hazards) if (h.alive) hNear++;
    for (const p of w.city.props) if ((p as any).lane >= 0 && near(p.x, p.z)) mNear++;
    rows.enemiesNear.push(eNear);
    const boss = w.boss && w.boss.alive ? B_BOSS + B_PART * (w.boss.parts?.length ?? 0) : 0;
    // building deltas since the last sample (floors changed)
    let bc = 0;
    for (let b = 0; b < w.city.buildings.length; b++) { const a = (w.city.buildings[b] as any).alive; if (a !== prevFloors[b]) { bc++; prevFloors[b] = a; } }
    rows.bldgChanged.push(bc);
    const full = B_HDR + B_TITAN + ne * B_ENEMY + np * B_PROJ + nk * B_PICKUP + nt * B_TG + nh * B_HAZ + nm * B_PROP + boss;
    const nearB = B_HDR + B_TITAN + eNear * B_ENEMY + pNear * B_PROJ + kNear * B_PICKUP + tNear * B_TG + hNear * B_HAZ + mNear * B_PROP + boss;
    rows.snapFull.push(full); rows.snapNear.push(nearB);
    // 4-player estimate: 4 titans; enemies scale with titans (assume director budget x 2.5 for 4 players, documented)
    rows.snapNear4.push(B_HDR + 4 * B_TITAN + Math.round((eNear * B_ENEMY + pNear * B_PROJ + tNear * B_TG + hNear * B_HAZ) * 2.5) + kNear * B_PICKUP + mNear * B_PROP + boss);
  }
  if (i % 1800 === 900) {
    // serialization cost of the dynamic state (what a full-state resync / late join would ship)
    const t1 = performance.now();
    const s = JSON.stringify({ titan: w.titan, enemies: w.enemies.filter(e => e.alive), projectiles: w.projectiles, pickups: w.pickups,
      telegraphs: w.telegraphs, hazards: w.hazards, boss: w.boss, director: w.director, upgrades: w.upgrades, run: w.run,
      ult: w.ult, map: w.map, tally: w.tally, gates: w.gates, props: w.city.props.map(p => [p.x, p.z, (p as any).alive, (p as any).lane]),
      bld: w.city.buildings.map(b => (b as any).alive), tick: w.tick, nextId: w.nextId });
    rows.serMs.push(+(performance.now() - t1).toFixed(2)); rows.serBytes.push(s.length);
  }
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const st = (a: number[]) => ({ avg: +(sum(a) / Math.max(1, a.length)).toFixed(2), p50: +pct(a, 0.5).toFixed(2), p95: +pct(a, 0.95).toFixed(2), p99: +pct(a, 0.99).toFixed(2), max: +Math.max(...a).toFixed(2) });
const out = {
  titan, biome, seed, ticks: i, result: w.run.result, endT: w.t, level: w.titan.level,
  cityBounds: w.city.bounds, buildings: w.city.buildings.length, props: w.city.props.length,
  stepMs: st(rows.stepMs), enemies: st(rows.enemies), enemiesNear: st(rows.enemiesNear), projectiles: st(rows.proj), pickups: st(rows.pickups),
  telegraphs: st(rows.tg), hazards: st(rows.haz), propsMoving: st(rows.propsMoving), eventsPerTick: st(rows.events),
  eventJsonBytesPerTick: st(rows.evJson), viewR: st(rows.viewR), bldgChangedPer10Ticks: st(rows.bldgChanged),
  snapFullBytes: st(rows.snapFull), snapNearBytes: st(rows.snapNear), snapNear4Bytes: st(rows.snapNear4),
  fullStateJson: { bytes: rows.serBytes, ms: rows.serMs }, nextId: w.nextId,
};
console.log(JSON.stringify(out));
