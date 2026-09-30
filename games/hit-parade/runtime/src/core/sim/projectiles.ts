// HIT PARADE — projectiles (CONTRACT §4.3.12): per-move spawn (speed, life, hits, box), movement,
// clash (opposing projectiles each lose a hit; 0 hits = destroyed), screen-edge / wall despawn,
// per-fighter limit (checked at input time). Projectile vs fighter hits are resolved in hits.ts.
//
// CHANGED(SIM) P2 (CONTRACT §28.2 `ball`, §28.4): the slot block also holds GAZZA'S BALL (kind 1: one slot while the
// ball is out, integer physics - kicked flight, wall rebound, keepy-uppy hover, loose fall, rest, pickup, knock-away,
// respawn; its state is mirrored into the owner's unique[0..3]) and the HECKLER TOSS objects (kind 2, owner 2; moved by
// brawl.ts). Per-instance gravity / mode / aux live in the slot (P.g, P.mode, P.aux, P.ground).

import { BALL, F, FL, P, PROJ_CAP, PROJ_INTS, ST, projBase } from './layout.ts';
import { EV, BALL_EV, EVX } from './events.ts';
import { BACT, UK } from './compile.ts';
import type { CMove } from './compile.ts';
import { emit, fb } from './state.ts';
import type { Match } from './state.ts';
import { hitRect, rectsOverlap } from './boxes.ts';

export const PK = { PROJ: 0, BALL: 1, HECKLE: 2 } as const;

function cm(u: number): number {
  return Math.trunc(u / 1000);
}

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
    s[pb + P.kind] = PK.PROJ;
    s[pb + P.str] = mv.str;
    s[pb + P.inst] = s[b + F.mvInst];
    s[pb + P.flags] = s[b + F.mvFlags];
    s[pb + P.vy] = pj.vy;
    s[pb + P.g] = pj.g;
    s[pb + P.mode] = 0;
    s[pb + P.aux] = 0;
    s[pb + P.ground] = pj.ground ? 1 : 0;
    emit(m, EV.PROJ_SPAWN, i, k, mv.snapId, 0);
    return k;
  }
  return -1;
}

/** Zeroes a slot (the object leaves the game: despawn, pickup, respawn). */
export function freeProjectile(m: Match, k: number): void {
  const pb = projBase(k);
  const s = m.s;
  for (let j = 0; j < PROJ_INTS; j++) s[pb + j] = 0;
}

/** Gameplay destroyed the projectile (hits used up, perfect parry, catch, clash). The ball is never destroyed: it goes loose. */
export function killProjectile(m: Match, k: number): void {
  const s = m.s;
  const pb = projBase(k);
  if (s[pb + P.act] !== 0 && s[pb + P.kind] === PK.BALL) {
    ballLoose(m, k, true);
    return;
  }
  freeProjectile(m, k);
}

// ------------------------------------------------------------------ Gazza's ball (CONTRACT §28.2)
function ballOwnerOk(m: Match, i: number): boolean {
  return (i === 0 || i === 1) && m.cf[i].uk === UK.BALL;
}

/** The owner's ball slot, or -1. */
export function ballSlot(m: Match, i: number): number {
  const s = m.s;
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] !== 0 && s[pb + P.kind] === PK.BALL && s[pb + P.owner] === i) return k;
  }
  return -1;
}

/** Can fighter `i` start ball move `mv` now (the ball at his feet, or a slow ball within kick range in front)? */
export function ballReady(m: Match, i: number, mv: CMove): boolean {
  if (mv.ballAct !== BACT.SHOOT && mv.ballAct !== BACT.HOVER) return true;
  if (!ballOwnerOk(m, i)) return true;
  const s = m.s;
  const b = fb(i);
  const st = s[b + F.uniq];
  if (st === BALL.FEET) return true;
  if (st !== BALL.HOVER && st !== BALL.REST && st !== BALL.LOOSE) return false;
  const k = ballSlot(m, i);
  if (k < 0) return false;
  const u = m.cf[i].u;
  const dxF = (s[projBase(k) + P.x] - s[b + F.x]) * s[b + F.facing];
  return dxF >= -u.kickBack && dxF <= u.kickRange;
}

/** A ball move's launch frame (mv.startup): kick / flick the ball, or re-kick it from where it is. */
export function ballLaunch(m: Match, i: number, mv: CMove): void {
  const pj = mv.proj;
  if (!pj || !ballOwnerOk(m, i)) {
    spawnProjectile(m, i, mv);
    return;
  }
  const s = m.s;
  const b = fb(i);
  const u = m.cf[i].u;
  const fc = s[b + F.facing];
  let k = -1;
  if (s[b + F.uniq] === BALL.FEET) {
    k = spawnProjectile(m, i, mv);
    if (k < 0) return;
  } else {
    if (!ballReady(m, i, mv)) return;
    k = ballSlot(m, i);
    if (k < 0) return;
    emit(m, EV.PROJ_SPAWN, i, k, mv.snapId, 0);
  }
  const pb = projBase(k);
  s[pb + P.kind] = PK.BALL;
  s[pb + P.owner] = i;
  s[pb + P.mv] = mv.idx;
  s[pb + P.str] = mv.str;
  s[pb + P.inst] = s[b + F.mvInst];
  s[pb + P.flags] = s[b + F.mvFlags];
  s[pb + P.hits] = pj.hits;
  s[pb + P.hitCd] = 0;
  s[pb + P.life] = pj.life;
  s[pb + P.w] = pj.w;
  s[pb + P.h] = pj.h;
  s[pb + P.aux] = u.bounces;
  if (mv.ballAct === BACT.HOVER) {
    // keepy-uppy: parked in the air above his toe at the move's height
    s[pb + P.x] = s[b + F.x] + fc * pj.x;
    s[pb + P.y] = pj.y;
    s[pb + P.vx] = 0;
    s[pb + P.vy] = 0;
    s[pb + P.g] = 0;
    s[pb + P.ground] = 0;
    s[pb + P.mode] = BALL.HOVER;
    emit(m, EVX.BALL, i, BALL_EV.HOVER, cm(s[pb + P.x]), cm(s[pb + P.y]));
  } else {
    // shoot (from his feet it spawned at projectile.x / y; a re-kick keeps the ball where it is)
    const floor = pj.h >> 1;
    if (pj.ground) s[pb + P.y] = floor;
    else if (s[pb + P.y] < floor) s[pb + P.y] = floor;
    s[pb + P.vx] = fc * pj.vx;
    s[pb + P.vy] = pj.vy;
    s[pb + P.g] = pj.g;
    s[pb + P.ground] = pj.ground ? 1 : 0;
    s[pb + P.mode] = BALL.FLYING;
    emit(m, EVX.BALL, i, BALL_EV.KICK, cm(s[pb + P.x]), cm(s[pb + P.y]));
  }
  s[pb + P.age] = 0; // a re-kick moves from the next frame like a fresh spawn
  s[b + F.uniq] = s[pb + P.mode];
}

/** The ball stops being dangerous: bounce off (deflect) and fall; `deflect` = it just hit something. */
export function ballLoose(m: Match, k: number, deflect: boolean): void {
  const s = m.s;
  const pb = projBase(k);
  const o = s[pb + P.owner];
  if (!ballOwnerOk(m, o)) {
    freeProjectile(m, k);
    return;
  }
  const u = m.cf[o].u;
  if (deflect) {
    s[pb + P.vx] = Math.trunc((s[pb + P.vx] * u.deflectVxPct) / 100);
    s[pb + P.vy] = u.deflectVy;
  }
  s[pb + P.hits] = 0;
  s[pb + P.g] = u.looseG;
  s[pb + P.ground] = 0;
  s[pb + P.mode] = BALL.LOOSE;
  s[fb(o) + F.uniq] = BALL.LOOSE;
  emit(m, EVX.BALL, o, BALL_EV.LOOSE, cm(s[pb + P.x]), cm(s[pb + P.y]));
}

function ballRest(m: Match, k: number): void {
  const s = m.s;
  const pb = projBase(k);
  const o = s[pb + P.owner];
  s[pb + P.y] = s[pb + P.h] >> 1;
  s[pb + P.vx] = 0;
  s[pb + P.vy] = 0;
  s[pb + P.hits] = 0;
  s[pb + P.mode] = BALL.REST;
  s[pb + P.life] = ballOwnerOk(m, o) ? m.cf[o].u.restF : 240;
  if (ballOwnerOk(m, o)) s[fb(o) + F.uniq] = BALL.REST;
  emit(m, EVX.BALL, o, BALL_EV.REST, cm(s[pb + P.x]), cm(s[pb + P.y]));
}

/** One frame of the ball in slot k (movement only; hits in hits.ts, pickup / knock-away in ballPost). */
function ballTick(m: Match, k: number): void {
  const s = m.s;
  const pb = projBase(k);
  const o = s[pb + P.owner];
  const mode = s[pb + P.mode];
  const floor = s[pb + P.h] >> 1;
  const xr = m.sys.wall - (s[pb + P.w] >> 1);
  if (s[pb + P.hitCd] > 0) s[pb + P.hitCd]--;
  if (mode === BALL.FLYING) {
    s[pb + P.x] += s[pb + P.vx];
    if (s[pb + P.g] !== 0 || s[pb + P.vy] !== 0) {
      s[pb + P.y] += s[pb + P.vy];
      s[pb + P.vy] -= s[pb + P.g];
      if (s[pb + P.y] <= floor) {
        if (s[pb + P.ground] !== 0) {
          s[pb + P.y] = floor;
          s[pb + P.vy] = 0;
          s[pb + P.g] = 0;
        } else {
          ballRest(m, k);
          return;
        }
      }
    }
    const x = s[pb + P.x];
    if (x > xr || x < -xr) {
      const side = x > xr ? 1 : -1;
      if (s[pb + P.aux] > 0) {
        s[pb + P.x] = side * xr - (x - side * xr);
        const r = ballOwnerOk(m, o) ? m.cf[o].u.wallRest : 70;
        s[pb + P.vx] = -Math.trunc((s[pb + P.vx] * r) / 100);
        s[pb + P.aux]--;
        emit(m, EVX.BALL, o, BALL_EV.REBOUND, cm(s[pb + P.x]), cm(s[pb + P.y]));
      } else {
        s[pb + P.x] = side * xr;
        ballLoose(m, k, true);
        return;
      }
    }
    if (--s[pb + P.life] <= 0) ballLoose(m, k, false);
    return;
  }
  if (mode === BALL.HOVER) {
    if (--s[pb + P.life] <= 0) ballLoose(m, k, false);
    return;
  }
  if (mode === BALL.LOOSE) {
    const fr = ballOwnerOk(m, o) ? m.cf[o].u.looseFriction : 94;
    s[pb + P.x] += s[pb + P.vx];
    s[pb + P.vx] = Math.trunc((s[pb + P.vx] * fr) / 100);
    s[pb + P.y] += s[pb + P.vy];
    s[pb + P.vy] -= s[pb + P.g];
    if (s[pb + P.x] > xr) {
      s[pb + P.x] = xr;
      s[pb + P.vx] = -(s[pb + P.vx] >> 1);
    } else if (s[pb + P.x] < -xr) {
      s[pb + P.x] = -xr;
      s[pb + P.vx] = -Math.trunc(s[pb + P.vx] / 2);
    }
    if (s[pb + P.y] <= floor && s[pb + P.vy] <= 0) ballRest(m, k);
    return;
  }
  if (mode === BALL.REST) {
    if (--s[pb + P.life] <= 0) {
      freeProjectile(m, k);
      if (ballOwnerOk(m, o)) s[fb(o) + F.uniq] = BALL.FEET;
      emit(m, EVX.BALL, o, BALL_EV.RESPAWN, cm(s[fb(o) + F.x]), 0);
    }
  }
}

const BR4 = new Int32Array(4);
const HR4 = new Int32Array(4);

/**
 * Per-frame ball upkeep after hits (CONTRACT §28.2): an opponent strike box touching the ball knocks it away; a resting
 * ball within pickupM of a free Gazza is trapped back at his feet; a knocked-away ball respawns after respawnF; the
 * owner's unique[0..3] mirror the ball.
 */
export function ballPost(m: Match): void {
  const s = m.s;
  for (let i = 0; i < 2; i++) {
    if (!ballOwnerOk(m, i)) continue;
    const b = fb(i);
    const k = ballSlot(m, i);
    if (k >= 0) {
      const pb = projBase(k);
      // knock-away by an opponent strike
      const o = 1 - i;
      const bo = fb(o);
      if (s[bo + F.st] === ST.ATTACK && s[bo + F.mv] >= 0) {
        const mv = m.cf[o].moves[s[bo + F.mv]];
        if (mv.isStrike) {
          const f = s[bo + F.mvF];
          const w2 = s[pb + P.w] >> 1;
          const h2 = s[pb + P.h] >> 1;
          BR4[0] = s[pb + P.x] - w2;
          BR4[1] = s[pb + P.x] + w2;
          BR4[2] = s[pb + P.y] - h2;
          BR4[3] = s[pb + P.y] + h2;
          for (let j = 0; j < mv.nBox; j++) {
            if (f < mv.boxes[j * 7] || f > mv.boxes[j * 7 + 1]) continue;
            hitRect(m, o, mv, j, HR4, 0);
            if (!rectsOverlap(HR4, 0, BR4, 0)) continue;
            emit(m, EVX.BALL, i, BALL_EV.KNOCKED, cm(s[pb + P.x]), cm(s[pb + P.y]));
            freeProjectile(m, k);
            s[b + F.uniq] = BALL.GONE;
            s[b + F.uniq + 1] = m.cf[i].u.respawnF;
            break;
          }
        }
      }
    }
    const k2 = ballSlot(m, i);
    if (k2 >= 0) {
      const pb = projBase(k2);
      const st = s[b + F.st];
      const free = st === ST.IDLE || st === ST.WALK_F || st === ST.WALK_B || st === ST.CROUCH;
      if (s[pb + P.mode] === BALL.REST && free && (s[b + F.flags] & FL.AIRBORNE) === 0 && Math.abs(s[pb + P.x] - s[b + F.x]) <= m.cf[i].u.pickup) {
        emit(m, EVX.BALL, i, BALL_EV.PICKUP, cm(s[pb + P.x]), 0);
        freeProjectile(m, k2);
        s[b + F.uniq] = BALL.FEET;
      } else {
        s[b + F.uniq] = s[pb + P.mode];
        s[b + F.uniq + 1] = s[pb + P.mode] === BALL.HOVER || s[pb + P.mode] === BALL.REST ? s[pb + P.life] : 0;
        s[b + F.uniq + 2] = k2;
        s[b + F.uniq + 3] = s[pb + P.aux];
        continue;
      }
    }
    // no ball out: at his feet, or gone (respawning)
    if (s[b + F.uniq] === BALL.GONE) {
      if (--s[b + F.uniq + 1] <= 0) {
        s[b + F.uniq] = BALL.FEET;
        s[b + F.uniq + 1] = 0;
        emit(m, EVX.BALL, i, BALL_EV.RESPAWN, cm(s[b + F.x]), 0);
      }
    } else {
      s[b + F.uniq] = BALL.FEET;
      s[b + F.uniq + 1] = 0;
    }
    s[b + F.uniq + 2] = -1;
    s[b + F.uniq + 3] = 0;
  }
}

/** Moves every projectile one frame; despawns on life end, walls and the screen edge. Kind 2 (heckle) moves in brawl.ts. */
export function projectilesTick(m: Match): void {
  const s = m.s;
  const b0 = fb(0);
  const b1 = fb(1);
  // CHANGED(SIM) P2: in bonus rounds fighter 1 is absent - the screen follows the player
  const mid = s[b1 + F.st] === ST.ABSENT ? s[b0 + F.x] : (s[b0 + F.x] + s[b1 + F.x]) >> 1;
  const half = m.sys.projScreenHalf;
  const wall = m.sys.wall;
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] === 0) continue;
    const kind = s[pb + P.kind];
    if (kind === PK.HECKLE) continue;
    // the spawn frame shows the projectile at its authored offset; it moves and ages from the next
    if (s[pb + P.age]++ === 0) continue;
    if (kind === PK.BALL) {
      ballTick(m, k);
      continue;
    }
    s[pb + P.x] += s[pb + P.vx];
    if (s[pb + P.g] !== 0 || s[pb + P.vy] !== 0) {
      s[pb + P.y] += s[pb + P.vy];
      s[pb + P.vy] -= s[pb + P.g];
      const floor = s[pb + P.h] >> 1;
      if (s[pb + P.y] <= floor) {
        if (s[pb + P.ground] !== 0) {
          s[pb + P.y] = floor;
          s[pb + P.vy] = 0;
        } else {
          freeProjectile(m, k);
          continue;
        }
      }
    }
    if (s[pb + P.hitCd] > 0) s[pb + P.hitCd]--;
    const x = s[pb + P.x];
    if (--s[pb + P.life] <= 0 || x > wall || x < -wall || x > mid + half || x < mid - half) freeProjectile(m, k);
  }
  // clashes: opposing owners, overlapping boxes, both still dangerous; each loses one hit
  for (let a = 0; a < PROJ_CAP; a++) {
    const pa = projBase(a);
    if (s[pa + P.act] === 0 || s[pa + P.kind] === PK.HECKLE || s[pa + P.hits] <= 0) continue;
    for (let c = a + 1; c < PROJ_CAP; c++) {
      const pc = projBase(c);
      if (s[pc + P.act] === 0 || s[pc + P.kind] === PK.HECKLE || s[pc + P.hits] <= 0 || s[pc + P.owner] === s[pa + P.owner]) continue;
      const dx = Math.abs(s[pa + P.x] - s[pc + P.x]);
      const dy = Math.abs(s[pa + P.y] - s[pc + P.y]);
      if (dx * 2 >= s[pa + P.w] + s[pc + P.w] || dy * 2 >= s[pa + P.h] + s[pc + P.h]) continue;
      emit(m, EV.PROJ_CLASH, s[pa + P.owner], a, m.cf[s[pa + P.owner]].moves[s[pa + P.mv]].snapId, 0);
      emit(m, EV.PROJ_CLASH, s[pc + P.owner], c, m.cf[s[pc + P.owner]].moves[s[pc + P.mv]].snapId, 0);
      if (--s[pa + P.hits] <= 0) killProjectile(m, a);
      if (--s[pc + P.hits] <= 0) killProjectile(m, c);
      if (s[pa + P.act] === 0 || s[pa + P.hits] <= 0) break;
    }
  }
}
