// probe_projectiles (G2, lane SIM): projectiles (CONTRACT §4.3.12). Spawn on the startup frame at
// the authored offset, speed per strength (4.5 / 6.0 / 7.5 m/s), life, screen-edge despawn, clash
// (both lose a hit; EX 2-hit survives a 1-hit), per-fighter limit 1 (the input falls through),
// hit / block (chip) through the move data, the thrower is not frozen by projectile hitstop,
// projectile invulnerability.
import { readFileSync } from 'node:fs';
import { fixtureData, newMatch, place, run, fs, evs, I, tester, dirBits, sb, ROOT } from './fixtures/simkit.ts';
import { step } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { buildGameData } from '../runtime/src/core/data.ts';
import { EV } from '../runtime/src/core/sim/events.ts';
import { F, P, PROJ_CAP, projBase } from '../runtime/src/core/sim/layout.ts';

const t = tester('probe_projectiles');
const data = fixtureData();
const A = data.fighters.kit_a.moves;

function at(x0: number, x1: number, o = {}): Match {
  const m = newMatch(o);
  place(m, x0, x1);
  run(m, 2, 0, 0);
  return m;
}
function fire(m: Match, i: number, btn: number): number {
  const seq = [2, 3, 6].map((d) => dirBits(m, i, d));
  seq[2] |= btn;
  const from = m.frame() + 1;
  for (const w of seq) step(m, i === 0 ? w : 0, i === 1 ? w : 0);
  return from;
}
function active(m: Match): number[] {
  const out: number[] = [];
  for (let k = 0; k < PROJ_CAP; k++) if (m.s[projBase(k) + P.act] !== 0) out.push(k);
  return out;
}

// ------------------------------------------------------------------ spawn + speed
for (const [id, btn] of [['brickbat_l', I.L], ['brickbat_m', I.M], ['brickbat_h', I.H]] as const) {
  const m = at(-3, 3);
  const x0 = m.s[sb(0) + F.x];
  fire(m, 0, btn);
  let spawnX = 0;
  let xs: number[] = [];
  for (let k = 0; k < 30; k++) {
    step(m, 0, 0);
    const a = active(m);
    if (a.length) {
      const x = m.s[projBase(a[0]) + P.x];
      if (!xs.length) spawnX = x;
      xs.push(x);
    }
  }
  const pj = A[id].projectile!;
  t.eq(spawnX - x0, Math.round(pj.x! * 100000), `${id}: spawns ${pj.x} m in front`);
  t.eq(xs[1] - xs[0], Math.round((pj.speed * 100000) / 60), `${id}: ${pj.speed} m/s = ${Math.round((pj.speed * 100000) / 60)} U/frame`);
}
// ------------------------------------------------------------------ life (variant data with life 20) + screen edge
{
  const raw = (p: string): unknown => JSON.parse(readFileSync(ROOT + p, 'utf8'));
  const ka = raw('_harness/fixtures/kit_a.json') as { moves: Record<string, { projectile?: { life: number } }> };
  ka.moves['brickbat_m'].projectile!.life = 20;
  const d2 = buildGameData({
    system: raw('data/system.json'),
    fighters: { kit_a: ka, kit_b: raw('_harness/fixtures/kit_b.json') },
    clips: { kit_a: raw('_harness/fixtures/kit_a.clips.json'), kit_b: raw('_harness/fixtures/kit_b.clips.json') },
  });
  const m = newMatch({ data: d2 });
  place(m, -3, 3);
  run(m, 2, 0, 0);
  fire(m, 0, I.M);
  let alive = 0;
  for (let k = 0; k < 60; k++) {
    step(m, 0, 0);
    if (active(m).length) alive++;
  }
  t.eq(alive, 20, 'projectile despawns after its life (20 frames in the variant)');
}
{
  const m = at(-0.5, 0.5);
  m.s[sb(1) + F.invP] = 999; // P2 ignores projectiles: the brick flies on to the screen edge
  fire(m, 0, I.H);
  let lastX = 0;
  let gone = -1;
  for (let k = 0; k < 120 && gone < 0; k++) {
    step(m, 0, 0);
    const a = active(m);
    if (a.length) lastX = m.s[projBase(a[0]) + P.x];
    else if (lastX !== 0) gone = k;
  }
  const mid = (m.s[sb(0) + F.x] + m.s[sb(1) + F.x]) / 2;
  t.ok(gone > 0 && Math.abs(lastX - mid) <= data.system.projectile.screenHalfM * 100000 + 12500, 'projectile despawns at the screen edge (mid +-4.5 m)', `last x ${(lastX / 1e5).toFixed(2)} m`);
}
// ------------------------------------------------------------------ clash (mirror match)
{
  const m = at(-3, 3, { p2: 'kit_a' });
  const seqA = [2, 3, 6].map((d) => dirBits(m, 0, d));
  const seqB = [2, 3, 6].map((d) => dirBits(m, 1, d));
  seqA[2] |= I.M;
  seqB[2] |= I.M;
  const from = m.frame() + 1;
  for (let k = 0; k < 3; k++) step(m, seqA[k], seqB[k]);
  run(m, 60, 0, 0);
  t.eq(evs(m, from).filter((e) => e.type === EV.PROJ_CLASH).length, 2, 'equal projectiles clash (PROJ_CLASH x2)');
  t.eq(active(m).length, 0, 'clash destroys both');
  t.ok(fs(m, 0).hp === 10000 && fs(m, 1).hp === 10000, 'clash: nobody hit');
}
{
  const m = at(-3, 3, { p2: 'kit_a' });
  const seqA = [2, 3, 6].map((d) => dirBits(m, 0, d));
  const seqB = [2, 3, 6].map((d) => dirBits(m, 1, d));
  seqA[2] |= I.S; // EX (2 hits)
  seqB[2] |= I.M;
  for (let k = 0; k < 3; k++) step(m, seqA[k], seqB[k]);
  run(m, 90, 0, 0);
  t.ok(fs(m, 1).hp < 10000 && fs(m, 0).hp === 10000, 'EX 2-hit projectile survives a clash and hits', `p1 ${fs(m, 0).hp} p2 ${fs(m, 1).hp}`);
}
// ------------------------------------------------------------------ per-fighter limit
{
  const m = at(-3.5, 3.5);
  const from = fire(m, 0, I.M);
  run(m, 50, 0, 0);
  fire(m, 0, I.M);
  const name = fs(m, 0).moveName;
  run(m, 5, 0, 0);
  t.eq(evs(m, from).filter((e) => e.type === EV.PROJ_SPAWN).length, 1, 'one projectile on screen per fighter');
  t.ok(name === '5M', 'with one on screen, 236M falls through to 5M', name);
}
// ------------------------------------------------------------------ hit / block through move data; thrower not frozen
{
  const m = at(-1.5, 1.5);
  const from = fire(m, 0, I.M);
  let hitF = -1;
  let mvfAtHit = -1;
  let mvfAfter = -1;
  for (let k = 0; k < 60; k++) {
    step(m, 0, 0);
    if (hitF < 0 && evs(m, m.frame()).some((e) => e.type === EV.PROJ_HIT)) {
      hitF = m.frame();
      mvfAtHit = m.s[sb(0) + F.mvF];
    } else if (hitF > 0 && m.frame() === hitF + 3) mvfAfter = m.s[sb(0) + F.mvF];
  }
  t.eq(11000 - fs(m, 1).hp, A['brickbat_m'].damage!, 'projectile hit: move damage');
  t.ok(evs(m, from).some((e) => e.type === EV.HIT && e.c === 6), 'HIT event with strength class 6 (projectile)');
  t.ok(mvfAfter === mvfAtHit + 3 || mvfAfter === -1 || mvfAtHit === 0, 'thrower keeps moving during the victim\'s projectile hitstop', `${mvfAtHit} -> ${mvfAfter}`);
  t.eq(m.s[sb(1) + F.lastStun], A['brickbat_m'].hitstun!, 'projectile hitstun from the move (33)');
}
{
  const m = at(-1.5, 1.5);
  const hold = dirBits(m, 1, 4);
  run(m, 2, 0, hold);
  const seq = [2, 3, 6].map((d) => dirBits(m, 0, d));
  seq[2] |= I.M;
  const from = m.frame() + 1;
  for (let k = 0; k < 60; k++) step(m, k < 3 ? seq[k] : 0, hold);
  t.ok(evs(m, from).some((e) => e.type === EV.BLOCK && e.c === 6), 'blocked projectile: BLOCK event (class 6)');
  t.eq(fs(m, 1).greyHp, Math.trunc((A['brickbat_m'].damage! * A['brickbat_m'].chipPct!) / 100), 'blocked projectile chips grey HP (10%)');
}
// ------------------------------------------------------------------ projectile invulnerability (lariat 1-20)
{
  // find when the brick reaches P2, then start lariat 5 frames earlier
  const m0 = at(-2, 2);
  const f0 = fire(m0, 0, I.M);
  run(m0, 60, 0, 0);
  const hit = evs(m0, f0).find((e) => e.type === EV.PROJ_HIT);
  const arrive = hit ? hit.frame - f0 : 30;
  const m = at(-2, 2);
  const seqA = [2, 3, 6].map((d) => dirBits(m, 0, d));
  seqA[2] |= I.M;
  const seqB = [6, 2, 3].map((d) => dirBits(m, 1, d));
  seqB[2] |= I.L;
  const from = m.frame() + 1;
  for (let k = 0; k < 70; k++) {
    const b = k - (arrive - 5 - 2);
    step(m, k < 3 ? seqA[k] : 0, b >= 0 && b < 3 ? seqB[b] : 0);
  }
  t.eq(evs(m, from).filter((e) => e.type === EV.PROJ_HIT).length, 0, 'lariat (projectile-invulnerable 1-20) passes through the brick');
}

// ------------------------------------------------------------------ CONTRACT 20.2 arcing / rolling projectile (kit_b toss_l, 421L)
{
  const m = newMatch({ p1: 'kit_b', p2: 'kit_a' });
  place(m, -4, 4);
  run(m, 2, 0, 0);
  m.s[sb(1) + F.invP] = 999;
  const seq = [4, 2, 1].map((d) => dirBits(m, 0, d));
  seq[2] |= I.L;
  for (const w of seq) step(m, w, 0);
  const ys: number[] = [];
  for (let k = 0; k < 70; k++) {
    step(m, 0, 0);
    const a = active(m);
    if (a.length) ys.push(m.s[projBase(a[0]) + P.y]);
  }
  const top = Math.max(...ys);
  const floor = Math.round((0.4 * 100000) / 2);
  const rolled = ys.filter((y) => y === floor).length;
  t.ok(ys.length > 20 && top > ys[0], 'arcing projectile rises (vy 5 m/s)', `start ${ys[0]} top ${top}`);
  t.ok(rolled > 5, 'ground: true -> it lands and rolls on the floor', `${rolled} frames at the floor`);
}

t.done();
