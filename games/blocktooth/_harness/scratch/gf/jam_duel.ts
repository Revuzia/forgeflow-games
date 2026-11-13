// Gate F scratch: PARKADE-6 JAM reachability — the probe_boss3 D policy with and without till-seeking
// ("real-key" = approach/strafe only, what a player who has not read the HUD marker does), non-god, no adds.
// usage: node _harness/scratch/gf/jam_duel.ts [seconds=160]

import type { BiomeId, Shape, TitanId, TitanInput, World } from "../../../src/core/types.ts";
import { createWorld, stepWorld } from "../../../src/core/world.ts";
import { gainGrowth } from "../../../src/titans/titansim.ts";
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botPickUpgrade } from '../../bot.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import * as P6 from '../../../src/ai/bosses/parkade6.ts';
const SECS = Number(process.argv[2] ?? 160);
const LV = Number(process.argv[3] ?? 37);
const NO: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
const DEG = Math.PI / 180;
const PIN = { x: 0, z: 0, bumpTier: -1 };

// ─────────────────────────────── setup helpers ───────────────────────────────
function drafts(w: World): void {
  let g = 0;
  while (hasPendingDraft(w) && g++ < 200) {
    const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0);
    if (!o.length) break;
    pickUpgrade(w, botPickUpgrade(w, o));
  }
}
/** A titan grown through the sim's own level-ups (one level per gainGrowth(1)), every draft bot-picked. */
function grownWorld(titan: TitanId, seed: number, level: number, god: boolean): World {
  const w = createWorld({ titan, biome: 'grideast' as BiomeId, seed });
  w.cheats.god = god; w.cheats.noSpawns = true;
  for (let g = 0; g < 200 && w.titan.level < level; g++) { gainGrowth(w, 1); drafts(w); }
  for (let i = 0; i < 150; i++) { drafts(w); stepWorld(w, NO); }   // let the grow tween settle
  w.enemies.length = 0;
  return w;
}
function inside(s: Shape, x: number, z: number, r: number): boolean {
  switch (s.k) {
    case 'circle': return Math.hypot(x - s.x, z - s.z) <= s.r + r;
    case 'ring': { const d = Math.hypot(x - s.x, z - s.z); return d + r >= s.r0 && d - r <= s.r1; }
    case 'cone': {
      const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
      if (d - r > s.r) return false; if (d <= r) return true;
      let a = Math.atan2(dx, dz) - s.dir; a = Math.atan2(Math.sin(a), Math.cos(a));
      return Math.abs(a) <= s.half + Math.asin(Math.min(1, r / d));
    }
    case 'lane': {
      const fx = Math.sin(s.dir), fz = Math.cos(s.dir), dx = x - s.x, dz = z - s.z;
      const al = dx * fx + dz * fz, sd = dx * fz - dz * fx;
      return al >= -r && al <= s.len + r && Math.abs(sd) <= s.w / 2 + r;
    }
    case 'oval': {
      const fx = Math.sin(s.rot), fz = Math.cos(s.rot), dx = x - s.x, dz = z - s.z;
      const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx, ex = lx / (s.rx + r), ez = lz / (s.rz + r);
      return ex * ex + ez * ez <= 1;
    }
    case 'capsule': {
      const vx = s.x1 - s.x0, vz = s.z1 - s.z0, L2 = vx * vx + vz * vz;
      let t = L2 > 1e-9 ? ((x - s.x0) * vx + (z - s.z0) * vz) / L2 : 0; t = Math.max(0, Math.min(1, t));
      return Math.hypot(x - (s.x0 + vx * t), z - (s.z0 + vz * t)) <= s.r + r;
    }
  }
  return false;
}
function esc(s: Shape, x: number, z: number): [number, number] {
  if (s.k === 'lane') { const fx = Math.sin(s.dir), fz = Math.cos(s.dir); const sd = (x - s.x) * fz - (z - s.z) * fx; const g = sd >= 0 ? 1 : -1; return [fz * g, -fx * g]; }
  if (s.k === 'cone') { const th = Math.atan2(x - s.x, z - s.z); let a = th - s.dir; a = Math.atan2(Math.sin(a), Math.cos(a)); const g = a >= 0 ? 1 : -1; return [Math.cos(th) * g, -Math.sin(th) * g]; }
  if (s.k === 'capsule') {
    // sideways off the segment (the boss_threat port pushed +X only, which walks along an X-aligned chain)
    const vx = s.x1 - s.x0, vz = s.z1 - s.z0, L = Math.hypot(vx, vz) || 1;
    const sd = ((x - s.x0) * vz - (z - s.z0) * vx) / L, g = sd >= 0 ? 1 : -1;
    return [(vz / L) * g, (-vx / L) * g];
  }
  const sx = (s as { x: number }).x, sz = (s as { z: number }).z;
  const dx = x - sx, dz = z - sz, d = Math.hypot(dx, dz);
  if (d < 1e-6) return [1, 0];
  if (s.k === 'ring' && s.r0 > 0 && d - s.r0 < s.r1 - d) return [-dx / d, -dz / d];
  return [dx / d, dz / d];
}
function keys(dx: number, dz: number): [number, number] {
  const m = Math.hypot(dx, dz); if (m < 1e-9) return [0, 0];
  dx /= m; dz /= m;
  const ix0 = C * dx - C * dz, iy0 = -C * dx - C * dz;
  const ix = ix0 > 0.38 ? 1 : ix0 < -0.38 ? -1 : 0, iy = iy0 > 0.38 ? 1 : iy0 < -0.38 ? -1 : 0;
  if (!ix && !iy) return [-C, -C];
  const mx = C * ix - C * iy, mz = -C * ix - C * iy, l = Math.hypot(mx, mz);
  return [mx / l, mz / l];
}
const REACH: Record<string, number> = { molo: 0.75, voltkite: 2.6, hearthback: 2.0, briarwick: 2.1 };
const C = Math.SQRT1_2;
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function run(titan: TitanId, seed: number, level: number, seek: boolean, god: boolean, kite = false) {
  const w = grownWorld(titan, seed, level, god);
  spawnBoss(w, 'parkade6');
  const b = w.boss!;
  const seen = new Map<number, number>();
  let lastDash = -9, lastSpace = -9, mx = 0, mz = -1, jams = 0, peak = 0, bled = 0, prevM = 0, firstJam = NaN;
  const t0 = w.t;
  for (let i = 0; i < 30 * SECS && b.alive && w.titan.alive; i++) {
    const T = w.titan, t = w.t;
    let dash = false, ability = false;
    if (i % 3 === 0) {
      let sx = 0, sz = 0, tMin = Infinity, n = 0;
      const rr = T.radius * 1.3 + 1;
      for (const tg of w.telegraphs) {
        if (!tg.alive || tg.owner === 'titan') continue;
        if (!seen.has(tg.id)) seen.set(tg.id, t + 0.25 + 0.1 * hash01(tg.id, seed));
        if (t < seen.get(tg.id)!) continue;
        let tl: number;
        if (!tg.fired) tl = tg.windup - tg.t; else if (tg.active > 0 && tg.t < tg.windup + tg.active) tl = 0; else continue;
        if (tl > 3 || !inside(tg.shape, T.x, T.z, rr)) continue;
        const [ex, ez] = esc(tg.shape, T.x, T.z); const wt = 1 / (0.2 + tl);
        sx += ex * wt; sz += ez * wt; n++; tMin = Math.min(tMin, tl);
      }
      let dx = 0, dz = 0;
      if (n) { dx = sx; dz = sz; }
      else if (b.introT <= 0) {
        const bx = b.x - T.x, bz = b.z - T.z, d = Math.hypot(bx, bz) || 1;
        const want = Math.max((REACH[T.id] ?? 1.5) * T.height + 18, P6.keepOutM(w) + 2);
        if (seek && b.data.tillOpen > 0) {
          const fx = b.x + Math.sin(b.heading) * want, fz = b.z + Math.cos(b.heading) * want;
          const gx = fx - T.x, gz = fz - T.z, g = Math.hypot(gx, gz);
          if (g > 0.25 * T.height) { dx = gx / g; dz = gz / g; }
          else { dx = -bz / d * 0.3 + bx / d * 0.1; dz = bx / d * 0.3 + bz / d * 0.1; }
        }
        else if (kite && d < want * 2.2) { dx = -bx / d + 0.5 * (-bz / d); dz = -bz / d + 0.5 * (bx / d); }
        else if (kite && d > want * 2.6) { dx = bx / d; dz = bz / d; }
        else if (kite) { dx = -bz / d; dz = bx / d; }
        else if (d > want * 1.15) { dx = bx / d; dz = bz / d; }
        else if (d < want * 0.7) { dx = -bx / d + 0.6 * (-bz / d); dz = -bz / d + 0.6 * (bx / d); }
        else { dx = -bz / d + 0.25 * bx / d; dz = bx / d + 0.25 * bz / d; }
      } else { dx = b.x - T.x; dz = b.z - T.z; }
      const B = w.city.bounds, edge = Math.max(4, 2 * T.height);
      if (T.x < B.minX + edge) dx = Math.abs(dx) + 0.5;
      if (T.x > B.maxX - edge) dx = -Math.abs(dx) - 0.5;
      if (T.z < B.minZ + edge) dz = Math.abs(dz) + 0.5;
      if (T.z > B.maxZ - edge) dz = -Math.abs(dz) - 0.5;
      [mx, mz] = keys(dx, dz);
      if (T.abilityCd <= 0 && t - lastSpace > 1 && (T.id !== 'voltkite' || t - lastDash < 1.2)) { ability = true; lastSpace = t; }
      const urgent = n > 0 && tMin < 0.45;
      const periodic = t - lastDash > (T.id === 'voltkite' ? 2.5 : 6);
      if ((urgent || periodic) && T.dashCharges >= 1 && t - lastDash > 0.35) { dash = true; lastDash = t; }
    }
    stepWorld(w, { mx, mz, ability, abilityHeld: false, dash });
    for (const ev of w.events) if (ev.type === 'bossStagger') { jams++; if (!Number.isFinite(firstJam)) firstJam = w.t - t0; }
    if (b.meter < prevM && b.staggerT <= 0 && !w.events.some((e) => e.type === 'bossStagger')) bled += prevM - b.meter;
    prevM = b.meter; peak = Math.max(peak, b.meter);
  }
  return { jams, peak, bled, firstJam, fight: w.t - t0, tillOpens: b.data.tillOpens ?? 0, ramps: b.data.ramps ?? 0, hpLeft: b.hp / b.maxHp, dead: !w.titan.alive };
}
const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const MODES = (process.argv[4] ?? 'plain,seek').split(',');
for (const mode of MODES) {
  const seek = mode !== 'plain', kite = mode === 'kite';
  let J = 0, S = 0;
  for (const titan of ['voltkite', 'molo', 'hearthback', 'briarwick'] as TitanId[]) for (const seed of [1, 2, 3]) {
    const r = run(titan, seed, LV, seek, true, kite);
    J += r.jams; S += r.fight;
    console.log(`${mode.toUpperCase().padEnd(5)} ${titan.padEnd(10)} s${seed} fight ${f(r.fight, 0)} s · JAMMED ${r.jams} (first @ ${f(r.firstJam)} s) · peak JAM ${f(r.peak, 2)} · bled ${f(r.bled, 2)} · ramps ${r.ramps} · tillOpens ${r.tillOpens} · boss hp left ${f(100 * r.hpLeft, 0)} %`);
  }
  console.log(`${mode.toUpperCase().padEnd(5)} TOTAL JAMMED ${J} in ${f(S, 0)} s = ${f(J / S * 150, 2)} per 150 s`);
}
