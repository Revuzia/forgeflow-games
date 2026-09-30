// HIT PARADE — projectiles (CONTRACT §4.3.12): per-move spawn (speed, life, hits, box), movement,
// clash (opposing projectiles each lose a hit; 0 hits = destroyed), screen-edge / wall despawn,
// per-fighter limit (checked at input time). Projectile vs fighter hits are resolved in hits.ts.

import { F, P, PROJ_CAP, PROJ_INTS, projBase } from './layout.ts';
import { EV } from './events.ts';
import type { CMove } from './compile.ts';
import { emit, fb } from './state.ts';
import type { Match } from './state.ts';

export function spawnProjectile(m: Match, i: number, mv: CMove): number {
  const pj = mv.proj;
  if (!pj) return -1;
  const s = m.s;
  const b = fb(i);
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] !== 0) continue;
    const fc = s[b + F.facing];
    s[pb + P.act] = 1;
    s[pb + P.owner] = i;
    s[pb + P.mv] = mv.idx;
    s[pb + P.x] = s[b + F.x] + fc * pj.x;
    s[pb + P.y] = s[b + F.y] + pj.y;
    s[pb + P.vx] = fc * pj.vx;
    s[pb + P.life] = pj.life;
    s[pb + P.hits] = pj.hits;
    s[pb + P.w] = pj.w;
    s[pb + P.h] = pj.h;
    s[pb + P.age] = 0;
    s[pb + P.hitCd] = 0;
    s[pb + P.kind] = 0;
    s[pb + P.str] = mv.str;
    s[pb + P.inst] = s[b + F.mvInst];
    s[pb + P.flags] = s[b + F.mvFlags];
    s[pb + P.vy] = pj.vy;
    emit(m, EV.PROJ_SPAWN, i, k, mv.snapId, 0);
    return k;
  }
  return -1;
}

export function killProjectile(m: Match, k: number): void {
  const pb = projBase(k);
  const s = m.s;
  for (let j = 0; j < PROJ_INTS; j++) s[pb + j] = 0;
}

/** Moves every projectile one frame; despawns on life end, walls and the screen edge. */
export function projectilesTick(m: Match): void {
  const s = m.s;
  const b0 = fb(0);
  const b1 = fb(1);
  const mid = (s[b0 + F.x] + s[b1 + F.x]) >> 1;
  const half = m.sys.projScreenHalf;
  const wall = m.sys.wall;
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] === 0) continue;
    // the spawn frame shows the projectile at its authored offset; it moves and ages from the next
    if (s[pb + P.age]++ === 0) continue;
    s[pb + P.x] += s[pb + P.vx];
    const pj = m.cf[s[pb + P.owner]].moves[s[pb + P.mv]].proj;
    if (pj && (pj.g !== 0 || s[pb + P.vy] !== 0)) {
      s[pb + P.y] += s[pb + P.vy];
      s[pb + P.vy] -= pj.g;
      const floor = s[pb + P.h] >> 1;
      if (s[pb + P.y] <= floor) {
        if (pj.ground) {
          s[pb + P.y] = floor;
          s[pb + P.vy] = 0;
        } else {
          killProjectile(m, k);
          continue;
        }
      }
    }
    if (s[pb + P.hitCd] > 0) s[pb + P.hitCd]--;
    const x = s[pb + P.x];
    if (--s[pb + P.life] <= 0 || x > wall || x < -wall || x > mid + half || x < mid - half) killProjectile(m, k);
  }
  // clashes: opposing owners, overlapping boxes; each loses one hit
  for (let a = 0; a < PROJ_CAP; a++) {
    const pa = projBase(a);
    if (s[pa + P.act] === 0) continue;
    for (let c = a + 1; c < PROJ_CAP; c++) {
      const pc = projBase(c);
      if (s[pc + P.act] === 0 || s[pc + P.owner] === s[pa + P.owner]) continue;
      const dx = Math.abs(s[pa + P.x] - s[pc + P.x]);
      const dy = Math.abs(s[pa + P.y] - s[pc + P.y]);
      if (dx * 2 >= s[pa + P.w] + s[pc + P.w] || dy * 2 >= s[pa + P.h] + s[pc + P.h]) continue;
      emit(m, EV.PROJ_CLASH, s[pa + P.owner], a, m.cf[s[pa + P.owner]].moves[s[pa + P.mv]].snapId, 0);
      emit(m, EV.PROJ_CLASH, s[pc + P.owner], c, m.cf[s[pc + P.owner]].moves[s[pc + P.mv]].snapId, 0);
      if (--s[pa + P.hits] <= 0) killProjectile(m, a);
      if (--s[pc + P.hits] <= 0) killProjectile(m, c);
      if (s[pa + P.act] === 0) break;
    }
  }
}
