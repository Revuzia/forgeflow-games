// BLOCKTOOTH ONLINE VS — B-WORLD lane probe (node _harness/probe_vsworld.ts [--only S3,S7] [--quiet]).
//
// Targeted, deterministic scenarios for the WORLD systems of a 1..4-titan VS match (src/combat/*, src/ai/enemies.ts,
// director.ts, bosses/index.ts, meta/tender.ts objectives.ts powerups.ts, city/citysim.ts). Each scenario builds its own
// VS world, sets the situation up as plain data (positions / hp / the VS clock), steps the real sim and asserts the
// effect. Bind asserts (core/players.ts setBindAsserts) are ON for the whole probe. Exit 0 = all pass, 1 = a failure,
// 2 = the sim could not be loaded.
//
//   S1  per-seat director: every unit is assigned (tslot), each seat spawns its own, hostile events carry the seat
//   S2  hostile shapes test EVERY titan: both overlapped seats hurt AS themselves (titanHurt p = victim); spawn protection skips;
//       a boss hit is capped at VS.tender.hitCapFrac of the victim's max HP
//   S3  owner credit + the PvP hook: kills credit the bound seat; titan-side areas queue PvpHit for rivals only; findTarget
//       returns a rival only from HOSTILE TAKEOVER on
//   S4  pickups: private to the owner seat, collected only by it; shared (chest) goes to the nearest titan
//   S5  projectiles: a titan shot is stepped as its owner; a hostile shot hits the FIRST titan on its path
//   S6  units hold while their owner is KO'd and re-pick the nearest live titan once it is eliminated
//   S7  PUBLIC TENDER: marker (last-place quadrant) -> spawn -> HP by crowd -> shared DPS window + per-seat shares ->
//       retarget -> payout by share (XP lump, UPROAR, chest to the top bidder, no breach) and BID WITHDRAWN
//   S8  objectives: a private board per seat
//   S9  power-ups: shared token to the nearest seat, RED LIGHT freezes only the collector's units
//   S10 FINAL NOTICE: demolition crews bring the condemned city down (no loot / credit); no rebuild outside the ring
//   S11 determinism: two identical 4-seat worlds stay identical over 1500 ticks
//   S12 solo guard: a solo world never produces a tslot / oslot / pslot / PvP hit and every event has p = 0

import type { BiomeId, PlayerSeat, SimEvent, TitanId, World } from '../src/core/types.ts';

const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
const quiet = args.includes('--quiet');

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; if (!quiet) console.log('  PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function section(id: string, title: string): boolean {
  if (only && !only.has(id)) return false;
  console.log(`\n${id}  ${title}`);
  return true;
}

// ─────────────────────────── sim loading ───────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any;
async function load(): Promise<string | null> {
  try {
    M = {
      world: await import('../src/core/world.ts'),
      players: await import('../src/core/players.ts'),
      cfg: await import('../src/core/config.ts'),
      enemies: await import('../src/ai/enemies.ts'),
      dmg: await import('../src/combat/damage.ts'),
      tg: await import('../src/combat/targeting.ts'),
      pvp: await import('../src/combat/pvp.ts'),
      tgt: await import('../src/combat/targets.ts'),
      proj: await import('../src/combat/projectiles.ts'),
      tele: await import('../src/combat/telegraphs.ts'),
      pick: await import('../src/combat/pickups.ts'),
      pu: await import('../src/meta/powerups.ts'),
      obj: await import('../src/meta/objectives.ts'),
      tender: await import('../src/meta/tender.ts'),
      boss: await import('../src/ai/bosses/index.ts'),
      city: await import('../src/city/citysim.ts'),
      spatial: await import('../src/combat/spatial.ts'),
    };
    return null;
  } catch (e) { return (e as Error)?.stack ?? String(e); }
}

const TITANS4: TitanId[] = ['molo', 'voltkite', 'hearthback', 'briarwick'];
function mk(n: number, opts: { seed?: number; biome?: BiomeId; noSpawns?: boolean; settle?: boolean } = {}): World {
  const seats: PlayerSeat[] = [];
  for (let i = 0; i < n; i++) seats.push({ titan: TITANS4[i % 4] });
  const w: World = M.world.createWorld({ mode: 'vs', players: seats, biome: opts.biome ?? 'grideast', seed: opts.seed ?? 1337, view: 0 });
  if (opts.noSpawns) w.cheats.noSpawns = true;
  if (opts.settle !== false) step(w, 165);   // past the 5 s COUNTDOWN
  return w;
}
function step(w: World, n: number, evs?: SimEvent[]): void {
  for (let i = 0; i < n; i++) {
    M.world.stepWorldN(w, []);
    if (evs) for (let k = 0; k < w.events.length; k++) evs.push(w.events[k]);
    if (w.run.result) break;
  }
}
function place(w: World, i: number, x: number, z: number): void {
  const T = w.players[i].titan;
  T.x = T.px = x; T.z = T.pz = z; T.vx = T.vz = 0;
}
/** a point inside the city, `k` road pitches from its centre along +X */
function cityPt(w: World, dx = 0, dz = 0): { x: number; z: number } {
  const B = w.city.bounds;
  return { x: (B.minX + B.maxX) / 2 + dx, z: (B.minZ + B.maxZ) / 2 + dz };
}
function jumpClock(w: World, clockS: number): void { w.t = (w.vs as any).startT + clockS; }
function evOf(evs: SimEvent[], type: string): any[] { return evs.filter((e) => e.type === type); }
function hpOf(w: World, i: number): number { return w.players[i].titan.hp; }
const circle = (x: number, z: number, r: number) => ({ k: 'circle' as const, x, z, r });

function allEvents(w: World): SimEvent[] { return Array.from(w.events); }

async function main(): Promise<number> {
  const err = await load();
  if (err) { console.log('probe_vsworld: SIM LOAD FAILED\n' + err); return 2; }
  M.players.setBindAsserts(true);
  console.log('BLOCKTOOTH probe_vsworld — VS world systems (B-WORLD)');

  // ───────────── S1 ─────────────
  if (section('S1', 'per-seat director: assignment, own units, hostile events carry the seat')) {
    const w = mk(3);
    const byId = new Map<number, number>();
    let evTagged = 0, evBad = 0, waveSeats = new Set<number>();
    // each titan chases the nearest unit assigned to it (short-reach kits never bite what stands off at range)
    const chase = (): any[] => w.players.map((p, i) => {
      let best: any = null, bd = Infinity;
      for (const e of w.enemies) { if (!e.alive || e.tslot !== i) continue; const d = Math.hypot(e.x - p.titan.x, e.z - p.titan.z); if (d < bd) { bd = d; best = e; } }
      if (!best || bd < 1e-6) return { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
      return { mx: (best.x - p.titan.x) / bd, mz: (best.z - p.titan.z) / bd, ability: false, abilityHeld: false, dash: false };
    });
    for (let t = 0; t < 1500; t++) {
      M.world.stepWorldN(w, chase());
      for (const e of w.enemies) if (e.alive) byId.set(e.id, e.tslot as number);
      for (const ev of w.events) {
        if (ev.type === 'enemyFire') { const own = byId.get(ev.id); if (own !== undefined) { evTagged++; if (ev.p !== own) evBad++; } }
        if (ev.type === 'waveStart') waveSeats.add(ev.p as number);
      }
    }
    const alive = w.enemies.filter((e) => e.alive);
    const unassigned = alive.filter((e) => e.tslot === undefined || e.tslot < 0 || e.tslot >= 3);
    const perSeat = [0, 1, 2].map((s) => alive.filter((e) => e.tslot === s).length);
    check('S1.1 every live unit is assigned to a seat', alive.length > 0 && unassigned.length === 0, `${alive.length} units, per seat ${perSeat.join('/')}`);
    check('S1.2 every seat fields its own units', perSeat.every((n) => n > 0));
    check('S1.3 each seat ran its own waves (waveStart p)', waveSeats.size === 3, `seats ${[...waveSeats].sort().join(',')}`);
    check('S1.4 enemyFire events are stamped with the shooter\'s target seat', evTagged > 0 && evBad === 0, `${evTagged} tagged, ${evBad} wrong`);
    // squad ids unique across seats
    const squads = new Map<number, Set<number>>();
    for (const e of alive) if (e.squad >= 0) { let s = squads.get(e.squad); if (!s) { s = new Set(); squads.set(e.squad, s); } s.add(e.tslot as number); }
    let mixed = 0; for (const s of squads.values()) if (s.size > 1) mixed++;
    check('S1.5 a squad id never spans two seats', mixed === 0, `${squads.size} squads`);
    check('S1.6 every seat killed units and grew (XP reaches every seat)', w.players.every((p) => p.titan.kills > 0 && (p.titan.level > 1 || p.titan.xp > 0)), `kills/level/xp ${w.players.map((p) => p.titan.kills + '/' + p.titan.level + '/' + Math.round(p.titan.xp)).join(' ')}`);
  }

  // ───────────── S2 ─────────────
  if (section('S2', 'hostile shapes hit EVERY titan, as that titan')) {
    const w = mk(3, { noSpawns: true });
    const c = cityPt(w);
    place(w, 0, c.x, c.z); place(w, 1, c.x + 14, c.z); place(w, 2, c.x + 600, c.z);
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.titan.iframeT = 0; p.ult.invulnT = 0; p.vs.spawnProtT = 0; }
    const dmg = 20;
    M.tele.spawnTelegraph(w, { owner: 'enemy', style: 'circle', shape: circle(c.x + 7, c.z, 30), windup: 0.05, dmg, kind: 'bullet' });
    const evs: SimEvent[] = [];
    step(w, 6, evs);
    const hurt = evOf(evs, 'titanHurt');
    check('S2.1 both overlapped titans lost HP', hpOf(w, 0) < w.players[0].titan.maxHp && hpOf(w, 1) < w.players[1].titan.maxHp);
    check('S2.2 the far titan did not', hpOf(w, 2) === w.players[2].titan.maxHp);
    check('S2.3 titanHurt events are stamped with the VICTIM slot', hurt.length >= 2 && hurt.every((e) => e.p === 0 || e.p === 1) && hurt.some((e) => e.p === 0) && hurt.some((e) => e.p === 1), `p = ${hurt.map((e) => e.p).join(',')}`);
    // spawn protection
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.titan.iframeT = 0; }
    w.players[1].vs.spawnProtT = 5;
    M.tele.spawnTelegraph(w, { owner: 'enemy', style: 'circle', shape: circle(c.x + 7, c.z, 30), windup: 0.05, dmg, kind: 'bullet' });
    step(w, 6);
    check('S2.4 a spawn-protected seat is skipped, its neighbour is not', hpOf(w, 1) === w.players[1].titan.maxHp && hpOf(w, 0) < w.players[0].titan.maxHp);
    // boss hit cap
    w.players[1].vs.spawnProtT = 0;
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.titan.iframeT = 0; p.ult.invulnT = 0; }
    M.dmg.hurtTitanByShape(w, circle(c.x + 14, c.z, 5), 1e9, 'slam', { kind: 'boss' });
    const capHp = M.cfg.VS.tender.hitCapFrac * w.players[1].titan.maxHp;
    const lost = w.players[1].titan.maxHp - hpOf(w, 1);
    check('S2.5 a boss hit is capped at hitCapFrac of the victim\'s max HP', lost > 0 && lost <= capHp * 1.0001 + 1e-6, `lost ${lost.toFixed(1)} cap ${capHp.toFixed(1)} (armor/shield may reduce it)`);
    // hostile damage baked for seat 0 (a Size IV target) is rescaled for a rival of another rank caught in the blast
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.titan.iframeT = 0; p.ult.invulnT = 0; }
    (w.players[0].titan as any).rank = 3;
    M.players.withPlayer(w, 0, () => M.dmg.hurtTitanByShape(w, circle(c.x + 7, c.z, 30), 100, 'bullet', null));
    (w.players[0].titan as any).rank = 0;
    const l0 = w.players[0].titan.maxHp - hpOf(w, 0), l1 = w.players[1].titan.maxHp - hpOf(w, 1);
    check("S2.6 collateral is rescaled to the VICTIM's rank (a Size I beside a Size IV target takes a small fraction)", l0 > 0 && l1 > 0 && l1 < l0 * 0.2, `target lost ${l0.toFixed(1)}, bystander ${l1.toFixed(2)}`);
  }

  // ───────────── S3 ─────────────
  if (section('S3', 'owner credit + the PvP hook')) {
    const w = mk(3, { noSpawns: true });
    const c = cityPt(w);
    place(w, 0, c.x, c.z); place(w, 1, c.x + 25, c.z); place(w, 2, c.x + 900, c.z);
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.vs.spawnProtT = 0; p.ult.invulnT = 0; }
    // kill credit: an enemy next to seat 0, killed by an area dealt while seat 1 is bound
    const en = M.players.withPlayer(w, 0, () => M.enemies.spawnEnemy(w, 'android', c.x + 4, c.z + 4));
    M.spatial.rebuildEnemyGrid(w);
    const k0 = w.players[0].titan.kills, k1 = w.players[1].titan.kills;
    w.events.length = 0;
    M.players.withPlayer(w, 1, () => M.dmg.damageArea(w, circle(en.x, en.z, 6), 1e6, { src: 'titan', kind: 'bite', noCity: true }));
    const killed = evOf(allEvents(w), 'enemyKilled');
    check('S3.1 the kill is credited to the BOUND seat', killed.length === 1 && killed[0].p === 1 && w.players[1].titan.kills === k1 + 1 && w.players[0].titan.kills === k0, `p=${killed[0]?.p}`);
    const hits = evOf(allEvents(w), 'enemyHit');
    check('S3.2 the aggregated enemyHit carries the hitter\'s slot', hits.length >= 1 && hits.every((h) => h.p === 1));
    // PvP queue
    M.pvp.clearPvp(w);
    M.players.withPlayer(w, 0, () => M.dmg.damageArea(w, circle(c.x + 25, c.z, 10), 10, { src: 'titan', kind: 'bite', noCity: true }));
    let q = Array.from(M.pvp.peekPvp(w)) as any[];
    check('S3.3 a titan-side area over a rival queues exactly one PvpHit from -> to', q.length === 1 && q[0].from === 0 && q[0].to === 1 && q[0].kind === 'bite', JSON.stringify(q.map((h) => [h.from, h.to, h.kind])));
    M.pvp.clearPvp(w);
    M.players.withPlayer(w, 0, () => M.dmg.damageArea(w, circle(c.x, c.z, 10), 10, { src: 'titan', kind: 'bite', noCity: true }));
    check('S3.4 never the attacker itself', Array.from(M.pvp.peekPvp(w)).length === 0);
    M.players.withPlayer(w, 0, () => M.dmg.damageArea(w, circle(c.x + 25, c.z, 10), 10, { src: 'titan', kind: 'thorns', noCity: true }));
    check('S3.5 thorns reflections are not PvP', Array.from(M.pvp.peekPvp(w)).length === 0);
    w.players[1].vs.spawnProtT = 3;
    M.players.withPlayer(w, 0, () => M.dmg.damageArea(w, circle(c.x + 25, c.z, 10), 10, { src: 'titan', kind: 'bite', noCity: true }));
    check('S3.6 a spawn-protected rival is not queued', Array.from(M.pvp.peekPvp(w)).length === 0);
    w.players[1].vs.spawnProtT = 0;
    M.players.withPlayer(w, 0, () => M.dmg.damageArea(w, circle(c.x + 25, c.z, 10), 10, { src: 'hazard', kind: 'wire', noCrit: true, noCity: true }));
    q = Array.from(M.pvp.peekPvp(w)) as any[];
    check('S3.7 a hazard tick is queued as a DoT', q.length === 1 && q[0].dot === true && q[0].kind === 'wire');
    const taken = M.pvp.takePvp(w);
    check('S3.8 takePvp drains the queue', taken.length === 1 && Array.from(M.pvp.peekPvp(w)).length === 0);
    // findTarget: rival priority only after OPEN HOUSE
    const w2 = mk(2);
    const d = cityPt(w2);
    place(w2, 0, d.x, d.z); place(w2, 1, d.x + 20, d.z);
    M.players.withPlayer(w2, 0, () => M.enemies.spawnEnemy(w2, 'android', d.x - 3, d.z));
    jumpClock(w2, 100);
    step(w2, 2);
    const t1 = M.players.withPlayer(w2, 0, () => M.tg.findTarget(w2, d.x, d.z, 40, true));
    check('S3.9 OPEN HOUSE: a rival in reach is NOT auto-targeted', t1 !== null && t1.kind !== 'titan', `kind ${t1?.kind}`);
    jumpClock(w2, 250);
    step(w2, 2);
    const t2 = M.players.withPlayer(w2, 0, () => M.tg.findTarget(w2, d.x, d.z, 40, true));
    check('S3.10 HOSTILE TAKEOVER: a rival in reach beats the enemy next to you', t2 !== null && t2.kind === 'titan' && t2.slot === 1, `kind ${t2?.kind} slot ${t2?.slot}`);
    const pos = M.tg.targetPos(w2, t2);
    check('S3.11 targetPos resolves a titan target to its position', Math.abs(pos.x - w2.players[1].titan.x) < 1e-9);
    M.pvp.clearPvp(w2);
    M.players.withPlayer(w2, 0, () => M.tg.hitTarget(w2, t2, 7, { src: 'titan', kind: 'bite' }));
    check('S3.12 hitTarget on a titan target queues a PvpHit', Array.from(M.pvp.peekPvp(w2)).length === 1);
    const t3 = M.players.withPlayer(w2, 1, () => M.tg.findTarget(w2, w2.players[1].titan.x, w2.players[1].titan.z, 40, true));
    check('S3.13 the seat never targets itself', t3 === null || t3.kind !== 'titan' || t3.slot !== 1);
  }

  // ───────────── S4 ─────────────
  if (section('S4', 'pickups: private to the owner seat')) {
    const w = mk(2, { noSpawns: true });
    const c = cityPt(w);
    place(w, 0, c.x, c.z); place(w, 1, c.x + 700, c.z);
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.vs.spawnProtT = 0; }
    const xp0 = w.players.map((p) => p.titan.xp + p.titan.level * 1e6);
    // seat 1's pickup lands next to seat 0
    M.players.withPlayer(w, 1, () => M.pick.spawnPickup(w, 'rubble', c.x + 2, c.z + 2, 50, 1));
    const pk = w.pickups[w.pickups.length - 1];
    check('S4.1 a pickup records its owner seat', pk.pslot === 1, `pslot ${pk.pslot}`);
    step(w, 90);
    check('S4.2 the owner\'s titan is far: another seat standing on it does not collect it', pk.alive && w.players[0].titan.xp + w.players[0].titan.level * 1e6 === xp0[0]);
    place(w, 1, pk.x, pk.z);
    step(w, 60);
    check('S4.3 once its owner is there it is collected by the owner only', !pk.alive && w.players[1].titan.xp + w.players[1].titan.level * 1e6 > xp0[1] && w.players[0].titan.xp + w.players[0].titan.level * 1e6 === xp0[0]);
    // an unbound drop belongs to the nearest seat
    place(w, 0, c.x, c.z); place(w, 1, c.x + 700, c.z);
    M.pick.spawnPickup(w, 'scrap', c.x + 3, c.z, 10, 1);
    const pk2 = w.pickups[w.pickups.length - 1];
    check('S4.4 an unbound scrap drop belongs to the NEAREST seat', pk2.pslot === 0, `pslot ${pk2.pslot}`);
    // chest: shared, nearest live titan
    place(w, 0, c.x - 40, c.z); place(w, 1, c.x + 10, c.z);
    M.pick.spawnPickup(w, 'chest', c.x, c.z, 0, 0);
    const ch = w.pickups[w.pickups.length - 1];
    const d0 = w.players[0].upgrades.chestDrafts, d1 = w.players[1].upgrades.chestDrafts;
    check('S4.5 a chest is shared (pslot -1)', ch.pslot === -1);
    place(w, 1, c.x + 4, c.z);
    step(w, 120);
    check('S4.6 a shared chest goes to the nearest titan', !ch.alive && w.players[1].upgrades.chestDrafts === d1 + 1 && w.players[0].upgrades.chestDrafts === d0, `chestDrafts ${w.players.map((p) => p.upgrades.chestDrafts).join('/')}`);
  }

  // ───────────── S5 ─────────────
  if (section('S5', 'projectiles: owner binding and first-titan-on-path')) {
    const w = mk(3, { noSpawns: true });
    const c = cityPt(w);
    place(w, 0, c.x + 175, c.z); place(w, 1, c.x + 80, c.z); place(w, 2, c.x + 400, c.z + 400);
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.vs.spawnProtT = 0; p.ult.invulnT = 0; p.titan.iframeT = 0; }
    // a titan shot of seat 1 kills an enemy (seat 0's unit, standing between them): credited to seat 1
    const en = M.players.withPlayer(w, 0, () => M.enemies.spawnEnemy(w, 'android', c.x + 150, c.z));
    M.spatial.rebuildEnemyGrid(w);
    const k = w.players.map((p) => p.titan.kills);
    M.players.withPlayer(w, 1, () => M.proj.spawnProjectile(w, { owner: 'titan', kind: 'seed', x: c.x + 100, z: c.z, vx: 60, vz: 0, dmg: 1e6, life: 3, crit: false }));
    const pr = w.projectiles[w.projectiles.length - 1];
    const evs: SimEvent[] = [];
    step(w, 40, evs);
    const killed = evOf(evs, 'enemyKilled');
    check('S5.1 a titan shot remembers its seat', pr.oslot === 1);
    check('S5.2 the kill it lands credits the owner (event p, tally)', killed.length >= 1 && killed.every((e) => e.p === 1) && w.players[1].titan.kills === k[1] + 1 && w.players[0].titan.kills === k[0] && !en.alive, `kills ${w.players.map((p) => p.titan.kills).join('/')}`);
    // hostile pellet fired from the east: seat 0 (x+175) is struck first, seat 1 (x+80) never
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.titan.iframeT = 0; }
    place(w, 0, c.x + 175, c.z); place(w, 1, c.x + 80, c.z);
    M.proj.spawnProjectile(w, { owner: 'enemy', kind: 'pellet', x: c.x + 230, z: c.z, vx: -80, vz: 0, dmg: 30, life: 6 });
    step(w, 60);
    check('S5.3 a hostile shot hits the FIRST titan on its path only', hpOf(w, 0) < w.players[0].titan.maxHp && hpOf(w, 1) === w.players[1].titan.maxHp, `hp ${w.players.map((p) => p.titan.hp.toFixed(0)).join('/')}`);
    // a titan-owned shot over a rival: queued, not applied
    M.pvp.clearPvp(w);
    place(w, 0, c.x + 20, c.z); place(w, 1, c.x + 80, c.z);
    M.players.withPlayer(w, 0, () => M.proj.spawnProjectile(w, { owner: 'titan', kind: 'seed', x: c.x + 24, z: c.z, y: 8, vx: 60, vz: 0, dmg: 5, life: 3, crit: false }));
    const hp1 = hpOf(w, 1);
    // the VS lane drains the queue at the top of the next tick: watch the queue at every tick end + the rivalHit it raises
    let sawQueued = false;
    const evs5: SimEvent[] = [];
    for (let i = 0; i < 40; i++) {
      step(w, 1, evs5);
      if ((Array.from(M.pvp.peekPvp(w)) as any[]).some((h) => h.from === 0 && h.to === 1)) sawQueued = true;
    }
    const rh = evOf(evs5, 'rivalHit').filter((e) => e.from === 0 && e.to === 1);
    check('S5.4 a titan shot that reaches a rival queues a PvpHit (the VS lane turns it into rivalHit); the shot applies nothing itself', (sawQueued || rh.length > 0) && hpOf(w, 1) >= hp1 - 1e-9, `queued seen ${sawQueued} rivalHit ${rh.length} (OPEN HOUSE: no HP)`);
  }

  // ───────────── S6 ─────────────
  if (section('S6', 'units hold while their owner is KO\'d, re-pick once it is eliminated')) {
    const w = mk(3, { noSpawns: true });
    const c = cityPt(w);
    place(w, 0, c.x, c.z); place(w, 1, c.x + 300, c.z); place(w, 2, c.x - 600, c.z - 600);
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.vs.spawnProtT = 0; }
    const en = M.players.withPlayer(w, 1, () => M.enemies.spawnEnemy(w, 'android', c.x + 340, c.z + 10));
    step(w, 45);
    const moved0 = Math.hypot(en.x - (c.x + 340), en.z - (c.z + 10));
    check('S6.1 a unit hunts its assigned seat (walks toward it)', en.tslot === 1 && Math.hypot(en.x - w.players[1].titan.x, en.z - w.players[1].titan.z) < Math.hypot(c.x + 340 - w.players[1].titan.x, c.z + 10 - w.players[1].titan.z) + 1e-6, `moved ${moved0.toFixed(1)} m`);
    // KO the owner (not eliminated): the unit holds
    const T1 = w.players[1].titan;
    T1.alive = false; T1.hp = 0;
    w.players[1].vs.respawnT = w.t + 100;
    const ex = en.x, ez = en.z;
    step(w, 30);
    check('S6.2 owner KO\'d: the unit holds (no move, still assigned)', en.alive && en.tslot === 1 && Math.hypot(en.x - ex, en.z - ez) < 0.5, `moved ${Math.hypot(en.x - ex, en.z - ez).toFixed(2)} m`);
    // eliminate it: the unit re-picks seat 0
    w.players[1].vs.eliminated = true; w.vs!.order.push(1);
    const d0 = Math.hypot(en.x - w.players[0].titan.x, en.z - w.players[0].titan.z);
    step(w, 90);
    const d1 = Math.hypot(en.x - w.players[0].titan.x, en.z - w.players[0].titan.z);
    check('S6.3 owner eliminated: the unit re-picks the nearest live titan and closes on it', en.tslot === 0 && d1 < d0 - 5, `d ${d0.toFixed(0)} -> ${d1.toFixed(0)}`);
  }

  // ───────────── S7 ─────────────
  if (section('S7', 'PUBLIC TENDER')) {
    const w = mk(4, { noSpawns: true });
    const c = cityPt(w);
    const VS = M.cfg.VS;
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.vs.spawnProtT = 0; p.ult.invulnT = 0; }
    // levels: seat 2 is last place
    [9, 8, 3, 7].forEach((lv, i) => { const T = w.players[i].titan; T.level = lv; T.xp = 0; T.xpToNext = M.cfg.xpToNextFor('vs', lv); });
    // keep titans where they spawned
    const evs: SimEvent[] = [];
    const tender = w.vs!.tenders[0];
    jumpClock(w, VS.tender.gates[0].atS - VS.tender.markerLeadS - 2);
    step(w, 1, evs);
    check('S7.1 before the lead time the tender is still pending', tender.state === 'pending');
    jumpClock(w, VS.tender.gates[0].atS - VS.tender.markerLeadS + 0.1);
    step(w, 1, evs);
    const mk1 = evOf(evs, 'tenderMarker');
    check('S7.2 the marker goes up VS.tender.markerLeadS ahead, for the LAST-PLACE titan', tender.state === 'marker' && tender.spawnSlot === 2 && mk1.length === 1, `slot ${tender.spawnSlot}`);
    const T2 = w.players[2].titan;
    const quad = (x: number, z: number) => (x >= c.x ? 1 : 0) + (z >= c.z ? 2 : 0);
    check('S7.3 it is placed in the trailing titan\'s quadrant', quad(tender.x, tender.z) === quad(T2.x, T2.z), `marker ${tender.x.toFixed(0)},${tender.z.toFixed(0)} titan ${T2.x.toFixed(0)},${T2.z.toFixed(0)}`);
    let minD = Infinity;
    for (const p of w.players) minD = Math.min(minD, Math.hypot(p.titan.x - tender.x, p.titan.z - tender.z));
    const ring = M.players.withPlayer(w, 2, () => M.enemies.ringRadius(w));
    check('S7.4 it is >= spawnRingMul x the trailing titan\'s spawn ring from EVERY titan', minD >= VS.tender.spawnRingMul * ring - 1e-6, `min ${minD.toFixed(0)} need ${(VS.tender.spawnRingMul * ring).toFixed(0)}`);
    // arrival
    jumpClock(w, VS.tender.gates[0].atS + 0.05);
    step(w, 1, evs);
    const b0 = w.boss;
    check('S7.5 at atS the rig walks in (role gate, one rig, tenderSpawn)', tender.state === 'live' && !!b0 && b0.alive && b0.role === 'gate' && b0.id === 'stencil1' && evOf(evs, 'tenderSpawn').length === 1);
    const base = M.tender; void base;
    const intro = b0!.introT;
    const hpIntro = b0!.hp;
    check('S7.6 in the intro the rig is untouchable', intro > 0 && (() => { M.players.withPlayer(w, 0, () => M.boss.damageBoss(w, 0, 1e6, { src: 'titan', kind: 'bite' })); return b0!.hp === hpIntro; })());
    // finish the intro
    step(w, Math.ceil((intro + 0.2) * 30), evs);
    const nearCount = w.players.filter((p) => Math.hypot(p.titan.x - b0!.x, p.titan.z - b0!.z) <= VS.tender.nearRingMul * (b0!.data.ringR || 14)).length;
    const base0 = M.boss.gateHpFor ? 0 : 0; void base0;
    check('S7.7 the HP is re-scaled once when the intro ends (crowd head-count)', Math.abs(b0!.maxHp - b0!.data.baseHp * (1 + VS.tender.hpPerExtraTitan * Math.max(0, Math.max(1, nearCount) - 1))) < 1, `maxHp ${b0!.maxHp.toFixed(0)} base ${b0!.data.baseHp} near ${nearCount}`);
    // DPS window: one attacker is capped at 6 %/s, two at 9 %
    w.gates.dpsWin = 0; w.gates.dpsWinT = -1; b0!.data.winMask = 0;
    const maxHp = b0!.maxHp;
    const hpA = b0!.hp;
    M.players.withPlayer(w, 0, () => M.boss.damageBoss(w, 0, maxHp, { src: 'titan', kind: 'bite' }));
    const lost1 = hpA - b0!.hp;
    check('S7.8 one attacker is capped at dpsCapBaseFrac x maxHp per 1 s window', Math.abs(lost1 - VS.tender.dpsCapBaseFrac * maxHp) < 1e-6 * maxHp + 1e-3, `lost ${(lost1 / maxHp * 100).toFixed(2)} %`);
    M.players.withPlayer(w, 1, () => M.boss.damageBoss(w, 0, maxHp, { src: 'titan', kind: 'bite' }));
    const lost2 = hpA - b0!.hp;
    const want2 = Math.min(VS.tender.dpsCapMaxFrac, VS.tender.dpsCapBaseFrac * (1 + VS.tender.dpsCapPerAttacker)) * maxHp;
    check('S7.9 a second attacker lifts the shared window to base x (1 + 0.5), not double', Math.abs(lost2 - want2) < 1e-6 * maxHp + 1e-3, `lost ${(lost2 / maxHp * 100).toFixed(2)} % want ${(want2 / maxHp * 100).toFixed(2)} %`);
    check('S7.10 the bids are recorded per seat', M.boss.rigDamageBy(b0!, 0) > 0 && M.boss.rigDamageBy(b0!, 1) > 0 && M.boss.rigDamageBy(b0!, 0) > M.boss.rigDamageBy(b0!, 1) && M.boss.rigDamageBy(b0!, 2) === 0);
    // retarget: seat 1 keeps hitting; after retargetS the rig switches to the most recent damage dealer
    const tgt0 = b0!.data.tslot;
    for (let s = 0; s < 6 * 30; s++) {
      if (s % 30 === 0) M.players.withPlayer(w, 3, () => M.boss.damageBoss(w, 0, maxHp * 0.01, { src: 'titan', kind: 'bite' }));
      step(w, 1, evs);
    }
    check('S7.11 the rig switches to the titan with the most recent damage (<= every retargetS)', b0!.data.tslot === 3 && tgt0 !== 3, `target ${tgt0} -> ${b0!.data.tslot}`);
    // rig events carry its target
    check('S7.12 the tender mirror follows the rig (t.dmg / t.targetSlot)', tender.dmg[3] > 0 && tender.targetSlot === 3, `dmg ${tender.dmg.map((v: number) => v.toFixed(0)).join('/')} target ${tender.targetSlot}`);
    // payout
    const cumOf = (p: any): number => M.cfg.cumXpAtFor('vs', p.titan.level) + p.titan.xp;
    for (const pk of w.pickups) pk.alive = false;   // no stray rubble from the rig's footsteps may pay anyone in the measured window
    const lvl = w.players.map(cumOf);
    const chest = w.players.map((p) => p.upgrades.chestDrafts);
    b0!.hp = 1;
    w.gates.dpsWin = 0; w.gates.dpsWinT = -1;
    M.players.withPlayer(w, 0, () => M.boss.damageBoss(w, 0, 1e6, { src: 'titan', kind: 'bite' }));
    step(w, 2, evs);
    const paid = evOf(evs, 'tenderPaid');
    check('S7.13 the kill pays: tenderPaid with shares that sum to 1, state paid', tender.state === 'paid' && paid.length === 1 && Math.abs(paid[0].shares.reduce((a: number, b: number) => a + b, 0) - 1) < 1e-9, `shares ${paid[0]?.shares?.map((s: number) => s.toFixed(2)).join('/')}`);
    check('S7.14 no size breach / lock in VS', w.gates.breachDue === 0 && w.gates.unlocked === 4);
    const top = paid[0]?.top;
    check('S7.15 the top bidder alone gets the wreck chest', top >= 0 && w.players.every((p, i) => p.upgrades.chestDrafts === chest[i] + (i === top ? 1 : 0)), `top ${top}`);
    check('S7.16 XP lump by share (a bidder gains XP, a non-bidder gains none)', w.players.every((p, i) => {
      const gain = cumOf(p) - lvl[i];
      return paid[0].shares[i] > 0 ? gain > 0 : Math.abs(gain) < 1e-9;
    }), `cum XP gain ${w.players.map((p, i) => (cumOf(p) - lvl[i]).toFixed(1)).join('/')} shares ${paid[0].shares.map((v: number) => v.toFixed(2)).join('/')}`);
    check('S7.17 bookkeeping: tenderBids / tenderTop / tenderShare', w.players[0].vs.tenderBids >= 1 && w.players[top].vs.tenderTop === 1 && (w.players[0].vs.data.tenderShare ?? 0) > 0);
    // FIXHIGH: the leader's cap on the XP lump (VS.tender.leaderShareCap): a seat at / above the top level of the others banks at most
    // the cap; the excess goes to the live seats below it, weighted 1 + level deficit; a trailing top bidder is not capped
    {
      const wc = mk(4, { noSpawns: true });
      [9, 8, 3, 7].forEach((lv, i) => { const T = wc.players[i].titan; T.level = lv; T.xp = 0; T.xpToNext = M.cfg.xpToNextFor('vs', lv); });
      const cap = VS.tender.leaderShareCap;
      const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
      const x1 = M.tender.xpSharesOf(wc, [0.9, 0.1, 0, 0]);
      const ex = 0.9 - cap;
      check('S7.19 leader cap: a leader that bid 90 % banks the cap, the sum is conserved', Math.abs(x1[0] - cap) < 1e-12 && Math.abs(sum(x1) - 1) < 1e-12, x1.map((v: number) => v.toFixed(3)).join('/'));
      check('S7.20 leader cap: the excess goes to the seats below, weighted 1 + level deficit (8 / 3 / 7 -> 2 / 7 / 3)', Math.abs(x1[1] - (0.1 + ex * 2 / 12)) < 1e-12 && Math.abs(x1[2] - ex * 7 / 12) < 1e-12 && Math.abs(x1[3] - ex * 3 / 12) < 1e-12, x1.map((v: number) => v.toFixed(3)).join('/'));
      const x2 = M.tender.xpSharesOf(wc, [0.05, 0.05, 0.9, 0]);
      check('S7.21 leader cap: a trailing top bidder is NOT capped (the tender is the catch-up)', x2[0] === 0.05 && x2[1] === 0.05 && x2[2] === 0.9 && x2[3] === 0, x2.join('/'));
      const x3 = M.tender.xpSharesOf(wc, [0.4, 0.3, 0.2, 0.1]);
      check('S7.22 leader cap: a leader under the cap changes nothing', x3.join('/') === '0.4/0.3/0.2/0.1', x3.join('/'));
      wc.players[2].vs.eliminated = true;
      const x4 = M.tender.xpSharesOf(wc, [0.9, 0.1, 0, 0]);
      check('S7.23 leader cap: an eliminated seat gets none of the excess', x4[2] === 0 && Math.abs(x4[1] - (0.1 + ex * 2 / 5)) < 1e-12 && Math.abs(x4[3] - ex * 3 / 5) < 1e-12, x4.map((v: number) => v.toFixed(3)).join('/'));
      wc.players[2].vs.eliminated = false;
      wc.players[1].titan.level = 9;
      const x5 = M.tender.xpSharesOf(wc, [0.8, 0.2, 0, 0]);
      check('S7.24 leader cap: a co-leader (equal top level) is capped too', Math.abs(x5[0] - cap) < 1e-12 && Math.abs(sum(x5) - 1) < 1e-12 && x5[2] > 0 && x5[3] > 0, x5.map((v: number) => v.toFixed(3)).join('/'));
      const tv = VS.tender as unknown as { leaderShareCap: number };
      const was = tv.leaderShareCap;
      tv.leaderShareCap = 1;
      const x6 = M.tender.xpSharesOf(wc, [0.9, 0.1, 0, 0]);
      tv.leaderShareCap = was;
      check('S7.25 leader cap: leaderShareCap 1 = off (the shares come back unchanged)', x6.join('/') === '0.9/0.1/0/0', x6.join('/'));
    }
    // BID WITHDRAWN: the second tender with every titan far away
    const t2 = w.vs!.tenders[1];
    jumpClock(w, VS.tender.gates[1].atS - VS.tender.markerLeadS + 0.1);
    step(w, 1);
    jumpClock(w, VS.tender.gates[1].atS + 0.05);
    for (const p of w.players) place(w, w.players.indexOf(p), w.city.bounds.minX + 30, w.city.bounds.minZ + 30 + 40 * w.players.indexOf(p));
    step(w, 1);
    // the tender spawns at its marker; move every titan away from it, then run 61 s
    const b1 = w.boss;
    if (t2.state === 'live' && b1) {
      b1.introT = 0; b1.x = b1.px = w.city.bounds.maxX - 30; b1.z = b1.pz = w.city.bounds.maxZ - 30;
      for (const p of w.players) place(w, w.players.indexOf(p), w.city.bounds.minX + 30, w.city.bounds.minZ + 30 + 40 * w.players.indexOf(p));
      let seen = false;
      for (let s = 0; s < 62 * 30 && !seen; s++) { step(w, 1); if ((t2.state as string) === 'withdrawn') seen = true; }
      const wd = evOf(evs, 'tenderPaid');
      check('S7.26 an unattended rig leaves after ignoredWithdrawS (BID WITHDRAWN, nobody paid)', seen && !b1.alive && w.players.every((p) => p.vs.tenderTop <= 1), `state ${t2.state}`);
      void wd;
    } else check('S7.26 an unattended rig leaves after ignoredWithdrawS', false, `second tender state ${t2.state}`);
  }

  // ───────────── S8 ─────────────
  if (section('S8', 'objectives: a private board per seat')) {
    const w = mk(3, { noSpawns: true });
    step(w, 60 * 30);   // past the first OVERLOAD SITE time
    const objs = w.map.objectives.filter((o) => o.alive);
    const seats = new Set(objs.map((o) => o.oslot));
    check('S8.1 every objective belongs to a seat', objs.length > 0 && objs.every((o) => o.oslot !== undefined && o.oslot >= 0 && o.oslot < 3), `${objs.length} live, seats ${[...seats].join(',')}`);
    check('S8.2 each seat got its own board', seats.size >= 2, `seats ${[...seats].join(',')}`);
    const nearOwn = objs.every((o) => {
      const own = Math.hypot(w.players[o.oslot as number].titan.x - o.x, w.players[o.oslot as number].titan.z - o.z);
      return own < 700;
    });
    check('S8.3 objectives sit near their own titan', nearOwn);
  }

  // ───────────── S9 ─────────────
  if (section('S9', 'power-ups: shared token, per-collector RED LIGHT')) {
    const w = mk(2, { noSpawns: true });
    const c = cityPt(w);
    place(w, 0, c.x, c.z); place(w, 1, c.x + 500, c.z);
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.vs.spawnProtT = 0; }
    const pu = M.pu.spawnPowerup(w, 'redLight', c.x + 0.4, c.z, true);
    const evs: SimEvent[] = [];
    step(w, 3, evs);
    const got = evOf(evs, 'powerup');
    check('S9.1 the token goes to the nearest seat, as that seat', !!pu && !pu.alive && got.length === 1 && got[0].p === 0, `p ${got[0]?.p}`);
    check('S9.2 RED LIGHT is per collector (seat 0 on, seat 1 off)', M.tgt.redLightFor(w, 0) && !M.tgt.redLightFor(w, 1));
    // units: one of each seat, far from their titans so they walk
    const e0 = M.players.withPlayer(w, 0, () => M.enemies.spawnEnemy(w, 'android', c.x - 200, c.z));
    const e1 = M.players.withPlayer(w, 1, () => M.enemies.spawnEnemy(w, 'android', c.x + 700, c.z));
    step(w, 30);
    check('S9.3 only the collector\'s own units freeze', e0.t === 0 && e1.t > 0.5, `t0 ${e0.t.toFixed(2)} t1 ${e1.t.toFixed(2)}`);
    step(w, 8 * 30);
    check('S9.4 the freeze ends (powerupEnd, units move again)', !M.tgt.redLightFor(w, 0) && e0.t > 0);
  }

  // ───────────── S10 ─────────────
  if (section('S10', 'FINAL NOTICE: demolition crews, no rebuild outside the ring')) {
    const w = mk(2, { noSpawns: true });
    for (const p of w.players) { p.titan.hp = p.titan.maxHp; p.titan.autoCd = 1e9; p.titan.abilityCd = 1e9; }   // idle jaws: only the crews may bring buildings down
    const stand0 = w.city.buildings.filter((b) => !b.collapsed).length;
    const ton0 = w.run.tonnage, pk0 = w.pickups.filter((p) => p.alive).length;
    jumpClock(w, 421);       // FINAL NOTICE: the ring starts to close on the next tick
    const evs: SimEvent[] = [];
    const id0 = w.nextId;
    step(w, 12 * 30, evs);
    const R = w.vs!.ring;
    const down = evs.filter((e) => e.type === 'buildingCollapse') as any[];
    check('S10.1 condemned buildings come down', down.length > 20, `${down.length} collapses in 12 s`);
    check('S10.2 every demolished building was outside the ring when it fell', down.every((e) => Math.hypot(e.x - R.cx, e.z - R.cz) > R.r - 80), `ring r ${R.r.toFixed(0)}`);
    check('S10.3 tagged noCredit (no trigger / objective pays for it)', down.length > 0 && down.every((e) => e.noCredit === true));
    // no loot: nothing spawned after the jump lies on a demolished footprint; no player was credited a building / floor
    let loot = 0;
    for (const e of down) {
      const bd = w.city.buildings[e.id];
      for (const p of w.pickups) if (p.alive && p.id > id0 && Math.abs(p.x - bd.x) < bd.w / 2 + 2 && Math.abs(p.z - bd.z) < bd.d / 2 + 2) loot++;
    }
    check('S10.4 no loot drops where a condemned building fell', loot === 0, `${loot} pickups on ${down.length} footprints`);
    check('S10.5 no player was credited a building or a floor', w.players.every((p) => p.titan.buildingsLeveled === 0 && p.titan.floorsEaten === 0), w.players.map((p) => `${p.titan.buildingsLeveled}/${p.titan.floorsEaten}`).join(' '));
    // no crew on a condemned lot
    const bk = M.city.rebuildBook(w.city);
    let bad = 0; for (const id of bk.crews) { const b = w.city.buildings[id]; if (Math.hypot(b.x - R.cx, b.z - R.cz) > R.r) bad++; }
    check('S10.6 no repair crew works a condemned lot', bad === 0);
    void stand0;
  }

  // ───────────── S11 ─────────────
  if (section('S11', 'determinism: two identical 4-seat worlds')) {
    const a = mk(4, { settle: false }), b = mk(4, { settle: false });
    const H = (w: World): string => {
      let h = 2166136261 >>> 0;
      const mix = (x: number): void => { h = Math.imul(h ^ (Math.round(x * 1000) | 0), 16777619) >>> 0; };
      mix(w.tick); mix(w.t);
      for (const p of w.players) { mix(p.titan.x); mix(p.titan.z); mix(p.titan.hp); mix(p.titan.xp); mix(p.titan.level); mix(p.titan.kills); }
      for (const e of w.enemies) { if (!e.alive) continue; mix(e.id); mix(e.x); mix(e.z); mix(e.hp); mix(e.tslot ?? -9); }
      for (const p of w.pickups) { if (p.alive) { mix(p.id); mix(p.x); mix(p.pslot ?? -9); } }
      for (const o of w.map.objectives) if (o.alive) { mix(o.id); mix(o.oslot ?? -9); }
      return h.toString(16);
    };
    let same = true, firstBad = -1;
    for (let i = 0; i < 1500 && same; i++) { M.world.stepWorldN(a, []); M.world.stepWorldN(b, []); if (i % 50 === 0 && H(a) !== H(b)) { same = false; firstBad = i; } }
    check('S11.1 identical over 1500 ticks (units, pickups, objectives, titans)', same && H(a) === H(b), `hash ${H(a)}${firstBad >= 0 ? ' diverged @' + firstBad : ''}`);
  }

  // ───────────── S12 ─────────────
  if (section('S12', 'solo guard: no VS field, no PvP, every event p = 0')) {
    const w: World = M.world.createWorld({ titan: 'molo', biome: 'grideast', seed: 7 });
    let badP = 0, vsFields = 0;
    for (let i = 0; i < 2400; i++) {
      M.world.stepWorldN(w, [{ mx: 0.3, mz: 0.2, ability: false, abilityHeld: false, dash: false }]);
      for (const ev of w.events) if (ev.p !== 0) badP++;
    }
    for (const e of w.enemies) if (e.tslot !== undefined) vsFields++;
    for (const p of w.pickups) if (p.pslot !== undefined) vsFields++;
    for (const p of w.projectiles) if (p.oslot !== undefined) vsFields++;
    for (const t of w.telegraphs) if (t.oslot !== undefined) vsFields++;
    for (const o of w.map.objectives) if (o.oslot !== undefined) vsFields++;
    check('S12.1 a solo world stamps no owner field and queues no PvP', vsFields === 0 && Array.from(M.pvp.peekPvp(w)).length === 0, `${vsFields} fields`);
    check('S12.2 every solo event carries p = 0', badP === 0, `${badP} bad`);
  }

  // ───────────── S13 ─────────────
  if (section('S13', 'an eliminated seat leaves no litter')) {
    const w = mk(3, { noSpawns: true });
    const c = cityPt(w);
    M.players.withPlayer(w, 1, () => M.obj.placeObjectiveNear(w, 'reliefDepot', w.players[1].titan.x + 30, w.players[1].titan.z));
    M.players.withPlayer(w, 0, () => M.obj.placeObjectiveNear(w, 'reliefDepot', w.players[0].titan.x + 30, w.players[0].titan.z));
    M.players.withPlayer(w, 1, () => M.pick.spawnPickup(w, 'rubble', c.x, c.z, 20, 1));
    const own1 = w.map.objectives.filter((o) => o.alive && o.oslot === 1).length;
    const pk1 = w.pickups.filter((p) => p.alive && p.pslot === 1).length;
    check('S13.0 setup: seat 1 has objectives and pickups', own1 > 0 && pk1 > 0, `${own1} objectives, ${pk1} pickups`);
    w.players[1].titan.alive = false; w.players[1].titan.hp = 0;
    w.players[1].vs.eliminated = true; w.vs!.order.push(1);
    step(w, 3);
    check('S13.1 its objectives expire', w.map.objectives.filter((o) => o.alive && o.oslot === 1).length === 0);
    check('S13.2 its pickups vanish', w.pickups.filter((p) => p.alive && p.pslot === 1).length === 0);
    check('S13.3 the other seats keep theirs', w.map.objectives.some((o) => o.alive && o.oslot !== 1));
  }

  console.log(`\nprobe_vsworld: ${pass} passed, ${fail} failed`);
  if (fail > 0) console.log('FAILED: ' + failures.join(' | '));
  return fail > 0 ? 1 : 0;
}

main().then((rc) => { process.exitCode = rc; }, (e) => { console.log('probe_vsworld crashed: ' + ((e as Error)?.stack ?? e)); process.exitCode = 1; });
