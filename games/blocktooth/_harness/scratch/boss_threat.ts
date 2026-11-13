// Boss-duel probe (harness scratch, not gate code): Size V titan vs the biome boss, god mode, no
// adds, driven by a node port of fullrun.py's human-like policy (0.25–0.35 s reaction, 0.1 s
// decision loop, 8-way WASD quantised movement, radial/side escapes summed, dash when < 0.45 s
// left, the same boss approach/strafe distances). Phases are forced after `phaseS` sim seconds
// each (hp set under the threshold, as critic_shots.py does). One JSON line per run.
//   node _harness/scratch/boss_duel.ts voltkite lockwater [seed] [phaseS] [policy=human|bot]
import type { BiomeId, Shape, TitanId, TitanInput, World } from '../../src/core/types.ts';
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { RANKS } from '../../src/core/config.ts';
import { BIOMES } from '../../src/data/biomes.ts';
import { gainMass, gainXp, titanMaxSpeed } from '../../src/titans/titansim.ts';
import { stat } from '../../src/upgrades/stats.ts';
import { spawnBoss } from '../../src/ai/bosses/index.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { BOT_TUNE, botInput, botPickUpgrade } from '../bot.ts';

const [titan, biome, seedS, phaseSS, policy] = process.argv.slice(2);
const seed = Number(seedS ?? 7), phaseS = Number(phaseSS ?? 45);
const w: World = createWorld({ titan: titan as TitanId, biome: biome as BiomeId, seed });
w.cheats.god = !process.env.NOGOD; w.cheats.noSpawns = !process.env.ADDS;
if (policy === 'bot') { BOT_TUNE.lapseP = 0; BOT_TUNE.reactionScale = 0.6; }

const drafts = () => { let g = 0; while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); if (!o.length) break; pickUpgrade(w, botPickUpgrade(w, o)); } };
// grow to Size V through the sim's own rank-ups; feed xp so the kit has some cards (~LV 30)
let start = 0; for (let i = 0; i < 4; i++) start += RANKS[i].massToNext;
w.titan.mass = start - 1e-6; gainMass(w, 1);
const NO: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
const LV = Number(process.env.LV ?? 0);
for (let g = 0; g < 400 && w.titan.level < LV; g++) { gainXp(w, 50); drafts(); }
for (let i = 0; i < 60; i++) { drafts(); stepWorld(w, NO); }
if (process.env.STATS) { const st = (k: string) => +(stat(w, k as never) as number).toFixed(2); console.error(JSON.stringify({ lv: w.titan.level, H: +w.titan.height.toFixed(1), maxSp: +titanMaxSpeed(w).toFixed(1), moveSpeed: st('moveSpeed'), dashCharges: st('dashCharges'), dashCooldown: st('dashCooldown'), dashDistance: st('dashDistance'), maxHp: Math.round(w.titan.maxHp), cards: Object.keys(w.upgrades.owned ?? {}).length })); }
if (process.env.CARDS) console.error('CARDS ' + JSON.stringify(w.upgrades.owned));
spawnBoss(w, BIOMES[biome as BiomeId].boss);

const REACH: Record<string, number> = { molo: 0.75, voltkite: 2.6, hearthback: 2.0, briarwick: 2.1 };
const C = Math.SQRT1_2;
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
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
  if (s.k === 'capsule') return [1, 0];
  const sx = (s as { x: number }).x, sz = (s as { z: number }).z;
  const dx = x - sx, dz = z - sz, d = Math.hypot(dx, dz);
  if (d < 1e-6) return [1, 0];
  if (s.k === 'ring' && s.r0 > 0 && d - s.r0 < s.r1 - d) return [-dx / d, -dz / d];
  return [dx / d, dz / d];
}
/** world dir → the WASD set (common.world_to_keys) → the world direction that set actually drives. */
function keys(dx: number, dz: number): [number, number] {
  const m = Math.hypot(dx, dz); if (m < 1e-9) return [0, 0];
  dx /= m; dz /= m;
  const ix0 = C * dx - C * dz, iy0 = -C * dx - C * dz;
  const ix = ix0 > 0.38 ? 1 : ix0 < -0.38 ? -1 : 0, iy = iy0 > 0.38 ? 1 : iy0 < -0.38 ? -1 : 0;
  if (!ix && !iy) return [-C, -C];   // "or {KeyW}"
  const mx = C * ix - C * iy, mz = -C * ix - C * iy, l = Math.hypot(mx, mz);
  return [mx / l, mz / l];
}

const seen = new Map<number, number>();
const tagOf = new Map<number, string>();
const res: Record<string, [number, number]> = {};
// DIAG: per boss tell, did the titan dash between the paint appearing and the fire? (hit/miss × dashed/walked)
let dashN = 0; const dashAt = new Map<number, number>(); const diag = { hitDash: 0, hitWalk: 0, missDash: 0, missWalk: 0, landed: 0 };
let lastDash = -9, lastSpace = -9, strafeT = 0, mx = 0, mz = -1;
let phaseT = 0, lastPhase = 1, fights = 0;
for (let i = 0; i < 30 * phaseS * 3.6 && w.boss && w.boss.alive; i++) {
  drafts();
  const T = w.titan, b = w.boss, t = w.t;
  let inp: TitanInput;
  if (policy === 'bot') inp = botInput(w);
  else {
    let dash = false, ability = false;
    if (i % 3 === 0) {
      let sx = 0, sz = 0, tMin = Infinity, n = 0;
      const rr = T.radius * 1.3 + 1;
      for (const tg of w.telegraphs) {
        if (!tg.alive || tg.owner === 'titan') continue;
        if (!seen.has(tg.id)) seen.set(tg.id, t + Number(process.env.REACT ?? 0.25) + 0.1 * hash01(tg.id, seed));
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
        const want = (REACH[T.id] ?? 1.5) * T.height + 18;
        if (d > want * 1.15) { dx = bx / d; dz = bz / d; }
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
      const urgent = !process.env.NOURGENT && n > 0 && tMin < 0.45;
      const periodic = !process.env.NOPERIODIC && t - lastDash > (T.id === 'voltkite' ? 2.5 : 6);
      if ((urgent || periodic) && T.dashCharges >= 1 && t - lastDash > 0.35) { dash = true; lastDash = t; }
    }
    strafeT++;
    inp = { mx, mz, ability, abilityHeld: false, dash };
  }
  stepWorld(w, inp);
  for (const tg of w.telegraphs) if (tg.owner === 'boss' && !tagOf.has(tg.id)) {
    const B2 = w.boss; const sh = tg.shape as { x?: number; z?: number };
    const fol = B2 && sh.x !== undefined && B2.data.followX === sh.x && B2.data.followZ === sh.z;
    tagOf.set(tg.id, `P${B2 ? B2.phase : 0}:${fol ? 'dashFollow' : (tg.tag || tg.style)}`);
  }
  if (process.env.TRACE) for (const tg of w.telegraphs) if (tg.owner === 'boss' && tg.alive && (tagOf.get(tg.id) ?? '').includes(process.env.TRACE)) {
    const sh = tg.shape as { x: number; z: number; r?: number }; const T2 = w.titan;
    if (Math.round(tg.t * 30) % 6 === 0 || tg.t + w.dt >= tg.windup) console.log(`  #${tg.id} t ${tg.t.toFixed(2)}/${tg.windup.toFixed(2)} d ${Math.hypot(T2.x - sh.x, T2.z - sh.z).toFixed(0)} reach ${((sh.r ?? 0) + T2.radius).toFixed(0)} sp ${T2.speed.toFixed(0)} dashT ${T2.dashT.toFixed(2)} ch ${T2.dashCharges} mv ${mx.toFixed(2)},${mz.toFixed(2)} vx ${T2.vx.toFixed(0)},${T2.vz.toFixed(0)}`);
  }
  for (const ev of w.events) if (ev.type === 'dash') dashN++;
  for (const tg of w.telegraphs) if (tg.owner === 'boss' && !dashAt.has(tg.id)) dashAt.set(tg.id, dashN);
  for (const ev of w.events) if (ev.type === 'telegraphFire' && ev.owner === 'boss') {
    const k = tagOf.get(ev.id) ?? '?'; const a = res[k] ?? (res[k] = [0, 0]); a[0]++; if (ev.hit) a[1]++;
    const dashed = dashN > (dashAt.get(ev.id) ?? dashN);
    if (ev.hit) { if (dashed) diag.hitDash++; else diag.hitWalk++; if (w.titan.iframeT <= 0) diag.landed++; }
    else if (dashed) diag.missDash++; else diag.missWalk++;
  }
  if (!w.boss) break;
  if (w.boss.phase !== lastPhase) { lastPhase = w.boss.phase; phaseT = 0; }
  phaseT += w.dt;
  if (phaseT > phaseS && w.boss.introT <= 0) {
    if (w.boss.phase === 1) w.boss.hp = Math.min(w.boss.hp, w.boss.maxHp * 0.6);
    else if (w.boss.phase === 2) w.boss.hp = Math.min(w.boss.hp, w.boss.maxHp * 0.3);
    else break;
    fights++;
  }
}
let n = 0, h = 0; const out: Record<string, string> = {};
for (const [k, [a, b]] of Object.entries(res).sort()) { n += a; h += b; out[k] = `${b}/${a}`; }
console.log(JSON.stringify({ titan, biome, seed, policy: policy ?? 'human', t: Math.round(w.t), alive: w.titan.alive, hp: Math.round(w.titan.hp) + '/' + Math.round(w.titan.maxHp), lv: w.titan.level, total: `${h}/${n} (${Math.round(100 * h / Math.max(1, n))}%)`, by: out, diag, dashes: dashN, dmgTaken: Math.round(w.titan.damageTaken) }));
