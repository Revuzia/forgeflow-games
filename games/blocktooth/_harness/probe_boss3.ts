// BLOCKTOOTH v2 — PARKADE-6 acceptance probe (FEATURES_V2 §10.2, §15.3; lane L3). Node, THREE-free.
//
//   node _harness/probe_boss3.ts            # everything below; exit 0 = every assertion holds
//   node _harness/probe_boss3.ts --quick    # 2 seeds per duel instead of 5 (dev loop only)
//
// A. Data: BOSSES.parkade6 (name, title, meter, hp, height, attack ids/phases), default subtitle, the
//    GRID-EAST assignment (BIOMES.grideast.boss === 'parkade6').
// B. Geometry unit test (exact targeting.ts findTarget): the titan at the keep-out wall straight ahead of
//    the booth → the TILL when open, the BOOTH when closed; prints the open-till window (± degrees off the
//    booth's facing where findTarget still picks the till) at the wall, 90 m and 130 m.
// C. Unit checks of the module: rampLaunch opens the till; the stagger (JAMMED) forces it open with the
//    open-till geometry (hp ×2, strain ×4); UPROAR (bossUltHit 6 %, meter +0.30) adds exactly +0.30 JAM;
//    resisting the tow fills JAM 0.10/s; an `ultFire` snaps the tow; tillOpens counts every opening;
//    JAM holds while the till is shut and bleeds only while it is out (Gate F).
// D. Policy duels — the node port of fullrun.py's human-like policy used by _harness/scratch/boss_threat.ts
//    (0.25–0.35 s reaction, 0.1 s decision loop, 8-way WASD quantised movement, escape vectors summed, dash
//    when < 0.45 s left, the same approach/strafe distances), PLUS the one thing a competent player does on
//    this rig: while the till is out (the HUD's HIT THE TILL marker) it walks to the front of the booth.
//    God mode, no adds, phases forced every 45 s (as boss_threat / critic_shots). VOLT-KITE and MOLO × 5
//    seeds at Size V (a bot-drafted LV 37 kit), + one Size IV spawn each (LV 30). Asserts per titan:
//    tells landed 4–16 % · every attack fires in its phases and never outside them · every rampLaunch opens
//    the till · ≥ 1 JAMMED per 150 s · no single hit > 55 % max HP · every windup ≥ 0.9 s · the titan is
//    never inside the keep-out on open ground (ticks where bosses/index.ts's city settle pushes a titan pinned
//    against an unflattenable building back through the wall are counted and printed separately — an L0
//    toolkit ordering, reported as a contract gap) · the till takes ≥ 35 % of the titan's boss damage while open.
// E. Gate-bot fights: full fresh-profile GRID-EAST runs exactly as GATE 2 drives them (bot.ts botInput,
//    non-god, the director's adds and boss spawn, UPROAR through bot_ult.ts): 4 titans × seeds 1337 and 7;
//    median fight (bossSpawn → clear) 70–170 s. (Needs the GRID-EAST flip; before it this measures CAISSON-4.)
// F. Determinism: one duel re-run → identical state hash.
// Exit: 0 = pass · 1 = violations (listed).

import type { BiomeId, Shape, Tier, TitanId, TitanInput, World } from '../src/core/types.ts';
import { EMPTY_RUN_META } from '../src/core/types.ts';
import { createWorld, stepWorld } from '../src/core/world.ts';
import { BOSS_HP_SCALE, RANKS } from '../src/core/config.ts';
import { BIOMES } from '../src/data/biomes.ts';
import { BOSSES, BOSS_DEFAULT_SUBTITLE } from '../src/data/bosses.ts';
import { gainGrowth } from '../src/titans/titansim.ts';
import { bossUltHit, spawnBoss, stepBoss } from '../src/ai/bosses/index.ts';
import * as P6 from '../src/ai/bosses/parkade6.ts';
import { findTarget } from '../src/combat/targeting.ts';
import { resolveCircleVsCity } from '../src/city/citysim.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from './bot.ts';

const QUICK = process.argv.includes('--quick');
const SEEDS = QUICK ? [1, 2] : [1, 2, 3, 4, 5];
const fails: string[] = [];
function check(ok: boolean, msg: string): void { if (!ok) { fails.push(msg); console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); }
const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const NO: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
const DEG = Math.PI / 180;
const PIN = { x: 0, z: 0, bumpTier: -1 };
const TILL_S1 = P6.TILL_OPEN_S[1];

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
function tillIndex(w: World): number { return w.boss ? w.boss.parts.findIndex((p) => p.name === 'till') : -1; }
function boothIndex(w: World): number { return w.boss ? w.boss.parts.findIndex((p) => p.name === 'booth') : -1; }
/** Re-run the module's till sync now (it is idempotent per tick; the probe forces a fresh pass). */
function resync(w: World): void { const b = w.boss!; b.data.tillTick = -1; P6.keepOut(w, b); }

// ─────────────────────────────── A: data ───────────────────────────────
console.log('\n══ A. data ══');
{
  const d = BOSSES.parkade6;
  check(d.id === 'parkade6' && d.name === 'PARKADE-6' && d.title === 'HALVARD MOBILE PARKING STRUCTURE' && d.meterName === 'JAM', `def: ${d.name} / ${d.title} / meter ${d.meterName}`);
  check(d.hp === 180000 && d.height === 64, `hp ${d.hp} (× Size V ${BOSS_HP_SCALE[4]} = ${fmt(d.hp * BOSS_HP_SCALE[4])}) · height ${d.height} m`);
  const want = [['rampLaunch', 1], ['barrierSwing', 1], ['towChain', 2], ['deckDrop', 2], ['levelCollapse', 3]];
  check(JSON.stringify(d.attacks.map((a) => [a.id, a.phase])) === JSON.stringify(want), `attacks ${d.attacks.map((a) => a.id + '@P' + a.phase).join(' · ')}`);
  check(BOSS_DEFAULT_SUBTITLE.parkade6 === 'HIT THE TILL WHEN THE DECK OPENS — BUILD JAM', `default subtitle "${BOSS_DEFAULT_SUBTITLE.parkade6}"`);
  check(BIOMES.grideast.boss === 'parkade6', `GRID-EAST boss = ${BIOMES.grideast.boss}`);
  check(BIOMES.whitestacks.boss === 'irongully' && BIOMES.lockwater.boss === 'caisson4', `WHITE STACKS ${BIOMES.whitestacks.boss} · LOCKWATER ${BIOMES.lockwater.boss}`);
}

// ─────────────────────────────── B: geometry unit test ───────────────────────────────
console.log('\n══ B. till reachability (findTarget, Size V VOLT-KITE) ══');
{
  const w = grownWorld('voltkite', 11, 37, true);
  spawnBoss(w, 'parkade6');
  for (let i = 0; i < 4 * 30 + 2; i++) stepWorld(w, NO);
  const b = w.boss!, T = w.titan;
  b.cd = 999;                                          // no attack starts while we place things
  const ti = tillIndex(w), bi = boothIndex(w);
  const keep = P6.keepOutM(w);
  const place = (dCentre: number, off: number) => {
    const a = b.heading + off;
    T.x = b.x + Math.sin(a) * dCentre; T.z = b.z + Math.cos(a) * dCentre;
    T.heading = Math.atan2(b.x - T.x, b.z - T.z);
  };
  const tgt = () => { const t = findTarget(w, T.x, T.z, 1000, true); return t && t.kind === 'boss' ? t.part : -1; };
  console.log(`  titan H ${fmt(T.height, 1)} r ${fmt(T.radius, 1)} · keep-out ${fmt(keep, 1)} m · RIG_R ${P6.RIG_R}`);
  b.data.tillOpen = 3; resync(w); place(keep, 0);
  const open = tgt();
  const tp = b.parts[ti];
  check(open === ti, `wall straight ahead, till OPEN → findTarget = ${b.parts[open]?.name ?? open} (till at ox ${tp.ox} oz ${tp.oz} r ${tp.r}, hp ×${tp.hpMul}, strain ×${tp.strainMul})`);
  b.data.tillOpen = 0; resync(w); place(keep, 0);
  const closed = tgt();
  check(closed === bi, `wall straight ahead, till CLOSED → findTarget = ${b.parts[closed]?.name ?? closed} (till stowed ox ${b.parts[ti].ox} oz ${b.parts[ti].oz} r ${b.parts[ti].r}, strain ×${b.parts[ti].strainMul})`);
  b.data.tillOpen = 3; resync(w);
  const win: string[] = [];
  let wallWin = 0;
  for (const d of [keep, 90, 130]) {
    let lo = 0, hi = 0;
    for (let a = 0; a <= 90; a++) { place(d, a * DEG); if (tgt() === ti) hi = a; else break; }
    for (let a = 0; a <= 90; a++) { place(d, -a * DEG); if (tgt() === ti) lo = a; else break; }
    win.push(`${fmt(d)} m −${lo}°/+${hi}°`);
    if (d === keep) wallWin = Math.min(lo, hi);
  }
  console.log(`  open-till window (off the booth's facing): ${win.join(' · ')}`);
  check(wallWin >= 20, `open till is the target within ±${wallWin}° at the keep-out wall (need ≥ 20°)`);
}

// ─────────────────────────────── C: module unit checks ───────────────────────────────
console.log('\n══ C. module unit checks ══');
{
  const w = grownWorld('molo', 12, 37, true);
  spawnBoss(w, 'parkade6');
  for (let i = 0; i < 4 * 30 + 2; i++) stepWorld(w, NO);
  const b = w.boss!, T = w.titan;
  check(b.introT === 0 && b.alive, `intro over after 4 s (introT ${b.introT})`);
  // UPROAR on the rig: body-only 6 %, meter exactly +0.30
  b.meter = 0.2; b.staggerT = 0;
  const hp0 = b.hp, m0 = b.meter, pt0 = b.data.part_till;
  const got = bossUltHit(w, 0.06, 0.3);
  check(Math.abs(got - 0.06 * b.maxHp) < 1e-6 && Math.abs(hp0 - b.hp - 0.06 * b.maxHp) < 1e-6 && Math.abs(b.meter - m0 - 0.3) < 1e-9 && b.data.part_till === pt0,
    `bossUltHit(6 %, 0.30): hp −${fmt((hp0 - b.hp) / b.maxHp * 100, 3)} %, JAM ${fmt(m0, 2)} → ${fmt(b.meter, 2)} (exactly +0.30), no part_* credit`);
  // stagger → till forced open with the open geometry for the whole stagger
  b.meter = 0.999; b.data.tillOpen = 0;
  bossUltHit(w, 0.001, 0.01);
  check(b.staggerT > 0, `meter full → JAMMED (staggerT ${fmt(b.staggerT, 2)})`);
  stepWorld(w, NO);
  const tp = b.parts[tillIndex(w)];
  check(b.data.tillOpen > 0 && tp.oz === 43 && tp.r === 8 && tp.hpMul === 2 && tp.strainMul === 4, `JAMMED: till open ${fmt(b.data.tillOpen, 2)} s · part oz ${tp.oz} r ${tp.r} hp ×${tp.hpMul} strain ×${tp.strainMul}`);
  let openAll = true;
  while (b.staggerT > 0) { stepWorld(w, NO); if (b.staggerT > 0 && !(b.data.tillOpen > 0)) openAll = false; }
  check(openAll, 'the till stays open for the whole stagger');
  for (let i = 0; i < 3; i++) stepWorld(w, NO);
  // Gate F: tillOpens counts every closed → open edge (openTill runs before the tick's sync)
  {
    b.attack = null; b.cd = 999;
    b.data.tillOpen = 0; resync(w);
    const o0 = b.data.tillOpens ?? 0;
    b.data.tillOpen = TILL_S1; resync(w); resync(w);
    const o1 = b.data.tillOpens ?? 0;
    b.data.tillOpen = 0; resync(w); b.data.tillOpen = TILL_S1; resync(w);
    check(o1 === o0 + 1 && (b.data.tillOpens ?? 0) === o0 + 2, `tillOpens counts openings: ${o0} → ${o1} (one opening, synced twice) → ${b.data.tillOpens} (closed, reopened)`);
    // JAM holds while the till is shut, bleeds (index.ts: 4 s idle, then 0.03/s) only while it is out.
    // stepBoss alone (a full stepWorld would add the titan's own hits on the open till to the meter)
    const bossTick = () => { w.tick++; w.t += w.dt; stepBoss(w); };
    const far = P6.keepOutM(w) + 220;
    const park = () => { T.x = b.x + Math.sin(b.heading) * far; T.z = b.z + Math.cos(b.heading) * far; };
    park(); b.data.tillOpen = 0; resync(w); b.meter = 0.5;
    for (let i = 0; i < 8 * 30; i++) { b.cd = 999; b.attack = null; b.data.tillOpen = 0; park(); bossTick(); }
    const shut = b.meter;
    b.meter = 0.5;
    for (let i = 0; i < 8 * 30; i++) { b.cd = 999; b.attack = null; b.data.tillOpen = 1; park(); bossTick(); }
    const out = b.meter;
    check(Math.abs(shut - 0.5) < 1e-9 && out < 0.45, `JAM 0.50 after 8 s idle: till shut → ${fmt(shut, 3)} (holds) · till out → ${fmt(out, 3)} (bleeds)`);
    b.data.tillOpen = 0; resync(w);
  }
  // tow: resist fills JAM 0.10/s; ultFire snaps it
  b.meter = 0; b.attack = null; b.cd = 999;
  const far = P6.keepOutM(w) + 60;
  T.x = b.x + Math.sin(b.heading) * far; T.z = b.z + Math.cos(b.heading) * far;
  T.leash = { t: 2, lx: b.x, lz: b.z, strength: 10 };
  b.data.tow = 1; b.data.leash = 1;
  const away = Math.atan2(T.x - b.x, T.z - b.z);
  const RES: TitanInput = { mx: Math.sin(away), mz: Math.cos(away), ability: false, abilityHeld: false, dash: false };
  // the module step alone (a full stepWorld would add the titan's own hits on the rig to the meter)
  w.input = RES; T.moving = true;
  const jm0 = b.meter;
  let ticks = 0;
  for (; ticks < 30 && T.leash; ticks++) P6.step(w, b);
  const perS = (b.meter - jm0) / (ticks * w.dt);
  check(ticks === 30 && Math.abs(perS - 0.1) < 1e-6, `resisting the tow: JAM +${fmt(b.meter - jm0, 4)} over ${ticks} ticks = ${fmt(perS, 4)}/s (0.10/s)`);
  if (!T.leash) { T.leash = { t: 2, lx: b.x, lz: b.z, strength: 10 }; b.data.tow = 1; b.data.leash = 1; }
  w.events.push({ type: 'ultFire', titan: T.id, x: T.x, z: T.z, r: 100 });
  P6.step(w, b);
  check(!T.leash && b.data.tow === 0, `an ultFire snaps the tow (leash ${T.leash ? 'still on' : 'off'}, tow ${b.data.tow})`);
}

// ─────────────────────────────── D: policy duels ───────────────────────────────
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

interface Duel {
  titan: TitanId; seed: number; lv: number; fightS: number; fired: number; landed: number; byTag: Record<string, [number, number]>;
  attacks: Record<number, Record<string, number>>; ramps: number; rampOpened: number; jams: number; maxHit: number; minWindup: number;
  keepViol: number; keepPinned: number; minKeepGap: number; minKeepGapFree: number; open: Record<string, number>; all: Record<string, number>; tows: number; hash: string; nan: boolean;
}

function stateHash(w: World): string {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => { const s = Number.isFinite(v) ? v.toFixed(4) : 'x'; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  mix(w.tick); mix(w.titan.x); mix(w.titan.z); mix(w.titan.hp);
  if (w.boss) { mix(w.boss.x); mix(w.boss.z); mix(w.boss.hp); mix(w.boss.meter); mix(w.boss.heading); mix(w.boss.data.tillOpen ?? 0); }
  mix(w.telegraphs.length); mix(w.projectiles.length);
  return h.toString(16);
}

function duel(titan: TitanId, seed: number, level: number, phaseS = 45): Duel {
  const w = grownWorld(titan, seed, level, true);
  spawnBoss(w, 'parkade6');
  const b = w.boss!;
  const D: Duel = {
    titan, seed, lv: w.titan.level, fightS: 0, fired: 0, landed: 0, byTag: {}, attacks: { 1: {}, 2: {}, 3: {} }, ramps: 0, rampOpened: 0, jams: 0,
    maxHit: 0, minWindup: Infinity, keepViol: 0, keepPinned: 0, minKeepGap: Infinity, minKeepGapFree: Infinity, open: {}, all: {}, tows: 0, hash: '', nan: false,
  };
  const seen = new Map<number, number>(), tagOf = new Map<number, string>(), seenP = new Set<number>();
  let lastDash = -9, lastSpace = -9, mx = 0, mz = -1, phaseT = 0, lastPhase = 1;
  for (let i = 0; i < 30 * (phaseS * 3 + 30) && b.alive; i++) {
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
        if (b.data.tillOpen > 0) {
          // HIT THE TILL: walk to the front of the booth (the spot `want` m out along its facing)
          const fx = b.x + Math.sin(b.heading) * want, fz = b.z + Math.cos(b.heading) * want;
          const gx = fx - T.x, gz = fz - T.z, g = Math.hypot(gx, gz);
          if (g > 0.25 * T.height) { dx = gx / g; dz = gz / g; }
          else { dx = -bz / d * 0.3 + bx / d * 0.1; dz = bx / d * 0.3 + bz / d * 0.1; }
        }
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
    // bookkeeping
    for (const ev of w.events) {
      if (ev.type === 'bossAttack') {
        D.attacks[b.phase][ev.attack] = (D.attacks[b.phase][ev.attack] ?? 0) + 1;
        if (ev.attack === 'rampLaunch') { D.ramps++; if (b.data.tillOpen > 0) D.rampOpened++; }
      } else if (ev.type === 'bossStagger') D.jams++;
      else if (ev.type === 'leash' && ev.on) D.tows++;
    }
    for (const tg of w.telegraphs) if (tg.owner === 'boss' && !tagOf.has(tg.id)) {
      const sh = tg.shape as { x?: number; z?: number };
      const fol = sh.x !== undefined && b.data.followX === sh.x && b.data.followZ === sh.z;
      tagOf.set(tg.id, `P${b.phase}:${fol ? 'dashAnswer' : (tg.tag || tg.style)}`);
      D.minWindup = Math.min(D.minWindup, tg.windup);
      D.maxHit = Math.max(D.maxHit, tg.dmg / Math.max(1, w.titan.maxHp));
    }
    for (const p of w.projectiles) if (p.owner === 'boss' && !seenP.has(p.id)) { seenP.add(p.id); D.maxHit = Math.max(D.maxHit, p.dmg / Math.max(1, w.titan.maxHp)); }
    for (const ev of w.events) if (ev.type === 'telegraphFire' && ev.owner === 'boss') {
      const k = tagOf.get(ev.id) ?? '?'; const a = D.byTag[k] ?? (D.byTag[k] = [0, 0]); a[0]++; D.fired++;
      if (ev.hit) { a[1]++; D.landed++; }
    }
    if (b.alive && w.titan.alive) {
      const gap = Math.hypot(w.titan.x - b.x, w.titan.z - b.z) - P6.keepOutM(w);
      D.minKeepGap = Math.min(D.minKeepGap, gap);
      if (gap < -0.5) {
        // bosses/index.ts settles the titan against the CITY after the wall: a titan pinned between the wall
        // and a building it cannot flatten is pushed back inside (an L0 toolkit order, reported as a gap).
        // Classified here: pinned = the wall position itself is inside a blocking building.
        const T = w.titan, dd = Math.hypot(T.x - b.x, T.z - b.z) || 1, k = P6.keepOutM(w);
        const wx = b.x + ((T.x - b.x) / dd) * k, wz = b.z + ((T.z - b.z) / dd) * k;
        const pinned = resolveCircleVsCity(w.city, wx, wz, T.radius, RANKS[T.rank].canFlatten as Tier, PIN);
        if (pinned) D.keepPinned++; else D.keepViol++;
        D.minKeepGapFree = pinned ? D.minKeepGapFree : Math.min(D.minKeepGapFree, gap);
        if (process.env.DIAG) console.log(`    DIAG keep ${titan} s${seed} t ${w.t.toFixed(2)} gap ${gap.toFixed(2)} pinned ${pinned} rank ${T.rank} dashT ${T.dashT.toFixed(2)} att ${b.attack} stag ${b.staggerT.toFixed(2)} bspeed ${b.data.speed.toFixed(1)}`);
      }
    }
    if (![b.x, b.z, b.hp, b.heading, w.titan.x, w.titan.z].every(Number.isFinite)) D.nan = true;
    if (b.phase !== lastPhase) { lastPhase = b.phase; phaseT = 0; }
    if (b.introT <= 0) { phaseT += w.dt; D.fightS += w.dt; }
    if (phaseT > phaseS && b.introT <= 0) {
      if (b.phase === 1) b.hp = Math.min(b.hp, b.maxHp * 0.6);
      else if (b.phase === 2) b.hp = Math.min(b.hp, b.maxHp * 0.3);
      else break;
    }
  }
  for (const g of ['till', 'booth', 'body', 'legs']) { D.open[g] = b.data['open_' + g] ?? 0; D.all[g] = b.data['part_' + g] ?? 0; }
  D.hash = stateHash(w);
  return D;
}

const ALLOWED: Record<number, string[]> = { 1: ['rampLaunch', 'barrierSwing'], 2: ['rampLaunch', 'barrierSwing', 'towChain', 'deckDrop'], 3: ['rampLaunch', 'barrierSwing', 'towChain', 'deckDrop', 'levelCollapse'] };
const NEED: [number, string][] = [[1, 'rampLaunch'], [1, 'barrierSwing'], [2, 'towChain'], [2, 'deckDrop'], [3, 'levelCollapse']];
const share = (o: Record<string, number>) => { const s = o.till + o.booth + o.body + o.legs; return s > 0 ? o.till / s : 0; };

console.log('\n══ D. policy duels (god, no adds, phases forced every 45 s) ══');
const duelsByTitan: Record<string, Duel[]> = {};
for (const titan of ['voltkite', 'molo'] as TitanId[]) {
  const list: Duel[] = [];
  for (const seed of SEEDS) list.push(duel(titan, seed, 37));
  list.push(duel(titan, 6, 30));   // one Size IV spawn
  duelsByTitan[titan] = list;
  for (const D of list) {
    console.log(`  ${titan.padEnd(8)} seed ${D.seed} LV ${D.lv} · fight ${fmt(D.fightS)} s · tells ${D.landed}/${D.fired} (${fmt(100 * D.landed / Math.max(1, D.fired), 1)} %) · JAMMED ${D.jams} · ramps ${D.ramps} (till opened ${D.rampOpened}) · tows ${D.tows} · till share open ${fmt(100 * share(D.open), 1)} % (all ${fmt(100 * share(D.all), 1)} %) · max hit ${fmt(100 * D.maxHit, 1)} % · min windup ${fmt(D.minWindup, 2)} s · keep gap min ${fmt(D.minKeepGap, 1)} m`);
    console.log(`      by tell: ${Object.entries(D.byTag).sort().map(([k, [a, h]]) => `${k} ${h}/${a}`).join(' · ')}`);
    console.log(`      attacks: ${[1, 2, 3].map((p) => `P${p} ` + (Object.entries(D.attacks[p]).map(([k, n]) => `${k} ${n}`).join(',') || '—')).join(' | ')}`);
  }
  const fired = list.reduce((a, D) => a + D.fired, 0), landed = list.reduce((a, D) => a + D.landed, 0);
  const pct = 100 * landed / Math.max(1, fired);
  check(pct >= 4 && pct <= 16, `${titan}: tells landed ${landed}/${fired} = ${fmt(pct, 1)} % (band 4–16 %)`);
  const agg: Record<number, Record<string, number>> = { 1: {}, 2: {}, 3: {} };
  for (const D of list) for (const p of [1, 2, 3]) for (const [k, n] of Object.entries(D.attacks[p])) agg[p][k] = (agg[p][k] ?? 0) + n;
  const bad: string[] = [];
  for (const p of [1, 2, 3]) for (const k of Object.keys(agg[p])) if (!ALLOWED[p].includes(k)) bad.push(`${k}@P${p}`);
  check(bad.length === 0, `${titan}: no attack outside its phases${bad.length ? ' — ' + bad.join(', ') : ''}`);
  const missing = NEED.filter(([p, k]) => ![1, 2, 3].some((q) => q >= p && (agg[q][k] ?? 0) > 0)).map(([p, k]) => k + '@P' + p + '+');
  check(missing.length === 0, `${titan}: every attack fires in its phases (${NEED.map(([p, k]) => `${k} ${[1, 2, 3].filter((q) => q >= p).reduce((a, q) => a + (agg[q][k] ?? 0), 0)}`).join(' · ')})${missing.length ? ' — missing ' + missing.join(', ') : ''}`);
  const ramps = list.reduce((a, D) => a + D.ramps, 0), opened = list.reduce((a, D) => a + D.rampOpened, 0);
  check(ramps > 0 && opened === ramps, `${titan}: every rampLaunch opens the till (${opened}/${ramps})`);
  const jams = list.reduce((a, D) => a + D.jams, 0), fightS = list.reduce((a, D) => a + D.fightS, 0);
  check(jams / fightS * 150 >= 1, `${titan}: JAMMED ${jams} in ${fmt(fightS)} s of fight = ${fmt(jams / fightS * 150, 2)} per 150 s (need ≥ 1)`);
  const maxHit = Math.max(...list.map((D) => D.maxHit));
  check(maxHit <= 0.55 + 1e-9, `${titan}: max single hit ${fmt(100 * maxHit, 1)} % of max HP (≤ 55 %)`);
  const minWu = Math.min(...list.map((D) => D.minWindup));
  check(minWu >= 0.9 - 1e-9, `${titan}: every windup ≥ 0.9 s (min ${fmt(minWu, 3)} s)`);
  const viol = list.reduce((a, D) => a + D.keepViol, 0), pin = list.reduce((a, D) => a + D.keepPinned, 0);
  const gap = Math.min(...list.map((D) => D.minKeepGap)), gapFree = Math.min(...list.map((D) => D.minKeepGapFree));
  check(viol === 0, `${titan}: never inside the keep-out on open ground (${viol} ticks, closest ${Number.isFinite(gapFree) ? fmt(gapFree, 2) : '≥ −0.5'} m) · pinned against an unflattenable building by the index.ts city settle: ${pin} ticks (closest ${fmt(gap, 2)} m) — reported as a contract gap`);
  const open = { till: 0, booth: 0, body: 0, legs: 0 };
  for (const D of list) for (const g of Object.keys(open) as (keyof typeof open)[]) open[g] += D.open[g];
  const sh = share(open);
  check(sh >= 0.35, `${titan}: while the till is open it takes ${fmt(100 * sh, 1)} % of the titan's boss damage (till ${fmt(open.till)} · booth ${fmt(open.booth)} · body ${fmt(open.body)} · legs ${fmt(open.legs)}; need ≥ 35 %)`);
  check(!list.some((D) => D.nan), `${titan}: no NaN in boss/titan state`);
}

// ─────────────────────────────── E: gate-bot fights (non-god) ───────────────────────────────
// The GATE 2 path itself: a fresh-profile GRID-EAST run driven by bot.ts botInput (drafts through
// rollOffer → botPickUpgrade → pickUpgrade, exactly as probe_sim.ts), the director's own boss spawn, adds,
// UPROAR through bot_ult.ts. Fight = bossSpawn → the run's clear.
console.log('\n══ E. gate-bot fights (full GRID-EAST runs, bot.ts, non-god, UPROAR in use) ══');
{
  const lens: number[] = [];
  let deaths = 0, runs = 0;
  for (const seed of QUICK ? [1337] : [1337, 7]) {
    for (const titan of ['molo', 'voltkite', 'hearthback', 'briarwick'] as TitanId[]) {
      const w = createWorld({ titan, biome: 'grideast' as BiomeId, seed, meta: { ...EMPTY_RUN_META, unlocked: [] } });
      let bossT = NaN, jams = 0, ults = 0, tows = 0;
      for (let i = 0; i < 780 * 30 && !w.run.result; i++) {
        drafts(w);
        stepWorld(w, botInput(w));
        for (const ev of w.events) {
          if (ev.type === 'bossSpawn') bossT = w.t;
          else if (ev.type === 'bossStagger') jams++; else if (ev.type === 'ultFire' && w.boss && w.boss.alive) ults++; else if (ev.type === 'leash' && ev.on) tows++;
        }
      }
      runs++;
      const b = w.boss, res = w.run.result ?? 'timeout', fight = w.t - bossT;
      if (res === 'clear' && Number.isFinite(fight)) lens.push(fight); else if (res === 'dead') deaths++;
      const sh = b ? share({ till: b.data.part_till ?? 0, booth: b.data.part_booth ?? 0, body: b.data.part_body ?? 0, legs: b.data.part_legs ?? 0 }) : 0;
      console.log(`  ${titan.padEnd(10)} seed ${String(seed).padEnd(4)} · boss ${b?.id ?? '—'} @ ${fmt(bossT)} s · ${res.padEnd(7)} @ ${fmt(w.t)} s · fight ${fmt(fight)} s · boss hp left ${b ? fmt(100 * b.hp / b.maxHp) : '—'} % · JAMMED ${jams} · UPROAR in the fight ${ults} · tows ${tows} · till share ${fmt(100 * sh, 1)} %`);
    }
  }
  const s = lens.slice().sort((a, c) => a - c);
  const med = s.length ? s[s.length >> 1] : NaN;
  check(s.length > 0 && med >= 70 && med <= 170, `median fight ${fmt(med)} s over ${s.length} clears of ${runs} runs (band 70–170 s; ${deaths} deaths)`);
}

// ─────────────────────────────── F: determinism ───────────────────────────────
console.log('\n══ F. determinism ══');
{
  const a = duel('voltkite', 3, 37, 20), c = duel('voltkite', 3, 37, 20);
  check(a.hash === c.hash, `same seed → same state hash (${a.hash} / ${c.hash})`);
}

console.log(`\nprobe_boss3: ${fails.length ? 'FAIL (' + fails.length + ')' : 'PASS'}`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
