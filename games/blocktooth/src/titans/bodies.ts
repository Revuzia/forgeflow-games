// BLOCKTOOTH — titan-vs-titan body contact (lane B-TITAN, online VS; vs_design.md §6.3). THREE-free, deterministic.
//
//   BODY COLLISION  two titans never overlap: they push apart, the push split by height² (the bigger body moves less).
//                   No damage. Both bodies stay out of buildings they cannot flatten.
//   STOMPED         a titan under CRUSH_RATIO (0.45) × the other's height that the bigger one walks / dashes through takes
//                   VS.contact.stompMaxHpFrac (6 %) of its max HP and a 1.5 H shove, then the SAME pair cannot stomp again
//                   for stompPairCdS (1.5 s). Never an instant crush. In OPEN HOUSE it is a shove only ("NO CONTEST"):
//                   the hit goes through pvpHit, which owns that rule.
//
// B-VS calls `resolveTitanBodies(w)` from vsAfterTitans (CORE_CONTRACT §4: after every seat's titan step, unbound).
// It reads / writes every PlayerState directly, in slot order (pairs i < j), so it is identical on every peer.

import type { World } from '../core/types.ts';
import { RANKS, VS, CRUSH_RATIO, titanSpeed } from '../core/config.ts';
import { hypot } from '../core/detmath.ts';
import { withPlayer } from '../core/players.ts';
import { resolveCircleVsCity } from '../city/citysim.ts';
import { rivalHit } from './rivals.ts';

/** a stomp needs the big titan moving at least this fraction of its walk speed (or dashing): standing still it just stands there */
const STOMP_MIN_SPEED_FRAC = 0.15;
const out = { x: 0, z: 0, bumpTier: -1 };

function inMatch(w: World, i: number): boolean {
  const p = w.players[i];
  return !p.vs.eliminated && p.titan.alive;
}

/** Keep titan `i` out of buildings it cannot flatten and inside the city bounds after a push. */
function settle(w: World, i: number): void {
  const T = w.players[i].titan;
  out.x = T.x; out.z = T.z; out.bumpTier = -1;
  if (resolveCircleVsCity(w.city, T.x, T.z, T.radius, RANKS[T.rank].canFlatten, out)) {
    if (Number.isFinite(out.x) && Number.isFinite(out.z)) { T.x = out.x; T.z = out.z; }
  }
  const B = w.city.bounds;
  T.x = Math.min(B.maxX, Math.max(B.minX, T.x));
  T.z = Math.min(B.maxZ, Math.max(B.minZ, T.z));
}

/** Push apart + STOMPED for every pair of live seats. VS only (no-op in solo). Call unbound, once per tick. */
export function resolveTitanBodies(w: World): void {
  if (w.mode !== 'vs') return;
  const ps = w.players;
  const n = ps.length;
  const dt = w.dt;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // pair stomp cooldowns count down every tick, whoever is alive
      const ki = ps[i].titan.kit, kj = ps[j].titan.kit;
      const keyIJ = 'sim_stompCd' + j, keyJI = 'sim_stompCd' + i;
      if (ki[keyIJ] !== undefined && ki[keyIJ] > 0) ki[keyIJ] = Math.max(0, ki[keyIJ] - dt);
      if (kj[keyJI] !== undefined && kj[keyJI] > 0) kj[keyJI] = Math.max(0, kj[keyJI] - dt);
      if (!inMatch(w, i) || !inMatch(w, j)) continue;
      const a = ps[i].titan, b = ps[j].titan;
      let dx = b.x - a.x, dz = b.z - a.z;
      let d = hypot(dx, dz);
      const minD = a.radius + b.radius;
      if (d >= minD) continue;
      // STOMPED is judged on the contact as it happened (before the push): the bigger body moving through the smaller one
      stompCheck(w, i, j, ki, keyIJ);
      stompCheck(w, j, i, kj, keyJI);
      // push apart, split by height²
      const over = minD - d;                // the real overlap (before the stacked-case axis below)
      if (d < 1e-6) {                       // exactly stacked: separate along a fixed axis by pair (deterministic)
        dx = ((i + j) & 1) === 0 ? 1 : 0; dz = ((i + j) & 1) === 0 ? 0 : 1; d = 1;
      }
      const nx = dx / d, nz = dz / d;
      const ha = a.height * a.height, hb = b.height * b.height;
      const sum = ha + hb;
      const moveA = over * (hb / sum), moveB = over * (ha / sum);
      a.x -= nx * moveA; a.z -= nz * moveA;
      b.x += nx * moveB; b.z += nz * moveB;
      settle(w, i); settle(w, j);
    }
  }
}

/** If `big` (seat bi) is walking / dashing through the much smaller `small` (seat si): one stomp, then the pair cooldown. */
function stompCheck(w: World, bi: number, si: number, kitBig: Record<string, number>, key: string): void {
  const big = w.players[bi].titan, small = w.players[si].titan;
  if (!(small.height < big.height * CRUSH_RATIO)) return;
  if (!(big.dashT > 0 || big.speed >= STOMP_MIN_SPEED_FRAC * titanSpeed(big.height))) return;
  if ((kitBig[key] ?? 0) > 0) return;
  kitBig[key] = VS.contact.stompPairCdS;
  withPlayer(w, bi, () => {
    rivalHit(w, si, VS.contact.stompMaxHpFrac, 'stomp', 'stomp', big.x, big.z, VS.contact.stompKnockH);
  });
}
