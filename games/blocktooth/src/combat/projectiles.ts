// BLOCKTOOTH — projectiles (CONTRACT §5.3, §9, §10, combat lane). THREE-free, DOM-free, deterministic.
//
// Two flight models:
//   * straight — x += v·dt; hit-tested with the swept segment of the tick (no tunnelling).
//       titan-owned: enemies → boss parts → low props, nearest along the path first, `pierce` extra
//       targets; aoe > 0 = explode on first contact. hostile: the titan circle.
//       Expires after `life` (aoe > 0 → explodes where it is).
//   * lobbed (`lob`) — lands EXACTLY at (tx, tz) after `life` seconds along a parabola
//       (y = y0·(1−u) + 4·apex·u·(1−u)); a circle telegraph (style 'circle', r = aoe) is painted under
//       it automatically and fires on the landing tick; landing damages the circle `aoe`.
// Events: projectileHit (direct hits), explosion (aoe detonations / lob landings).
// CITY.maxProjectiles: at the cap the oldest hostile pellet/volley is dropped first, then the oldest
// hostile straight shot, then the oldest titan straight shot, then the oldest of anything.

import type { DamageKind, DamageOpts, Enemy, Owner, Projectile, ProjectileKind, World } from '../core/types.ts';
import { CITY } from '../core/config.ts';
import { circleInShape, clamp } from '../core/math.ts';
import type { Attacker } from './damage.ts';
import { damageArea, damageEnemyFrom, hurtTitanByShape, lifestealFromBoss, propRadius, rollCrit } from './damage.ts';
import { enemiesInShape, nearestEnemy } from './spatial.ts';
import { spawnTelegraph } from './telegraphs.ts';
import { damageBoss } from '../ai/bosses/index.ts';
import { damageProp, propsInRect } from '../city/citysim.ts';
import { redLightActive } from '../meta/powerups.ts';

export type ProjectileSpawn = Partial<Projectile> & {
  owner: Owner; kind: ProjectileKind; x: number; z: number; vx: number; vz: number; dmg: number;
  /** optional (superset of the contract): upgrade id that fired it, so its hits cannot re-trigger it */
  fromUpgrade?: string;
};

const EPS = 1e-6;
/** Titan projectiles only clip props while flying lower than this (m) — cars/kiosks/buses. */
const PROP_HIT_MAX_Y = 4.5;
/** Straight shots this far outside the city bounds are culled (m). */
const OOB_PAD = 120;

function defaultRadius(k: ProjectileKind): number {
  switch (k) {
    case 'pellet': return 0.35;
    case 'volley': return 0.3;
    case 'rocket': return 0.6;
    case 'shell': return 0.8;
    case 'mortar': return 1.0;
    case 'plate': return 2.5;
    case 'hookDrop': return 3;
    case 'seed': return 0.5;
    case 'rubbleShot': return 0.8;
    case 'spark': return 0.5;
  }
  return 0.5;
}

export function projectileDamageKind(k: ProjectileKind): DamageKind {
  switch (k) {
    case 'pellet': case 'volley': return 'bullet';
    case 'rocket': return 'rocket';
    case 'shell': return 'shell';
    case 'mortar': return 'mortar';
    case 'plate': return 'plate';
    case 'hookDrop': return 'hook';
    case 'seed': return 'seed';
    case 'rubbleShot': return 'rubble';
    case 'spark': return 'spark';
  }
  return 'generic';
}

interface ProjExtra {
  // lob flight
  x0: number; z0: number; y0: number; T: number; apex: number;
  // hostile: who thorns go to
  attacker: Attacker;
  // piercing titan shots: ids already hit (enemies: id, boss parts: −1 − partIndex, props: 1e9 + id)
  hitIds: number[] | null;
  fromUpgrade: string | undefined;
}
const extras = new WeakMap<Projectile, ProjExtra>();

function extraOf(p: Projectile): ProjExtra {
  let x = extras.get(p);
  if (!x) {
    // a projectile pushed without spawnProjectile: fly the lob from where it is now
    x = { x0: p.x, z0: p.z, y0: p.y, T: Math.max(EPS, p.life), apex: lobApex(p.x, p.z, p.tx, p.tz, p.y),
      attacker: p.owner === 'boss' ? { kind: 'boss' } : null, hitIds: null, fromUpgrade: undefined };
    extras.set(p, x);
  }
  return x;
}

function lobApex(x0: number, z0: number, tx: number, tz: number, y0: number): number {
  return Math.max(y0 + 2, clamp(0.3 * Math.hypot(tx - x0, tz - z0), 3, 60));
}

const isPelletKind = (k: ProjectileKind) => k === 'pellet' || k === 'volley';

function killTelegraph(w: World, id: number): void {
  if (id < 0) return;
  const ts = w.telegraphs;
  for (let i = 0; i < ts.length; i++) if (ts[i].id === id) { ts[i].alive = false; return; }
}

/** Make room under CITY.maxProjectiles (drop order in the header). */
function enforceCap(w: World): void {
  const ps = w.projectiles;
  let alive = 0;
  for (let i = 0; i < ps.length; i++) if (ps[i].alive) alive++;
  while (alive >= CITY.maxProjectiles) {
    let victim: Projectile | null = null;
    for (let pass = 0; pass < 4 && !victim; pass++) {
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (!p.alive) continue;
        const hostile = p.owner !== 'titan';
        if (pass === 0 && !(hostile && isPelletKind(p.kind))) continue;
        if (pass === 1 && !(hostile && !p.lob)) continue;
        if (pass === 2 && !(!hostile && !p.lob)) continue;
        victim = p; break;
      }
    }
    if (!victim) return;
    victim.alive = false;
    if (victim.lob) killTelegraph(w, victim.tg);
    alive--;
  }
}

/** Spawn a projectile. Titan-owned shots roll their crit here (unless `crit` is given). */
export function spawnProjectile(w: World, p: ProjectileSpawn): Projectile {
  enforceCap(w);
  const T = w.titan;
  const titan = p.owner === 'titan';
  let dmg = Number.isFinite(p.dmg) && p.dmg > 0 ? p.dmg : 0;
  let crit = p.crit ?? false;
  if (titan && p.crit === undefined && dmg > 0) { const c = rollCrit(w, dmg); dmg = c.dmg; crit = c.crit; }
  const lob = p.lob === true;
  const y = p.y ?? (titan ? Math.max(0.6, T.height * 0.55) : 1.2);
  const tx = p.tx ?? p.x, tz = p.tz ?? p.z;
  const life = p.life !== undefined && Number.isFinite(p.life) && p.life > 0 ? p.life : (lob ? 1.5 : 4);
  const aoe = p.aoe !== undefined && Number.isFinite(p.aoe) && p.aoe > 0 ? p.aoe : 0;
  const pr: Projectile = {
    id: w.nextId++,   // same semantics as core/world.ts newId
    alive: true,
    owner: p.owner,
    kind: p.kind,
    x: p.x, z: p.z, y,
    px: p.x, pz: p.z, py: y,
    vx: p.vx, vz: p.vz, vy: p.vy ?? 0,
    r: p.r !== undefined && p.r > 0 ? p.r : defaultRadius(p.kind),
    dmg,
    life,
    pierce: p.pierce !== undefined && p.pierce > 0 ? Math.floor(p.pierce) : 0,
    crit,
    lob,
    tx, tz, aoe,
    tg: p.tg ?? -1,
  };
  const ex: ProjExtra = {
    x0: pr.x, z0: pr.z, y0: y, T: life, apex: lobApex(pr.x, pr.z, tx, tz, y),
    attacker: null, hitIds: null, fromUpgrade: p.fromUpgrade,
  };
  if (lob) {
    pr.vx = (tx - pr.x) / life;
    pr.vz = (tz - pr.z) / life;
    pr.vy = (-ex.y0 + 4 * ex.apex) / life;
    if (pr.tg < 0) {
      pr.tg = spawnTelegraph(w, {
        owner: pr.owner, style: 'circle',
        shape: { k: 'circle', x: tx, z: tz, r: Math.max(aoe, pr.r) },
        windup: life, dmg: 0, kind: projectileDamageKind(pr.kind), tag: 'lob:' + pr.kind,
      }).id;
    }
  }
  if (!titan) {
    if (p.owner === 'boss') ex.attacker = { kind: 'boss' };
    else {
      // the shooter stands at the muzzle — remember it so thorns can reflect
      const e = nearestEnemy(w, pr.x, pr.z, 3);
      ex.attacker = e ? { kind: 'enemy', id: e.id } : null;
    }
  } else if (pr.pierce > 0) {
    ex.hitIds = [];
  }
  extras.set(pr, ex);
  w.projectiles.push(pr);
  return pr;
}

// ─────────────────────────────── stepping ───────────────────────────────
const seg = { k: 'capsule' as const, x0: 0, z0: 0, x1: 0, z1: 0, r: 0 };
const hitEnemies: Enemy[] = [];
const idScratch: number[] = [];

interface Cand { t: number; type: 0 | 1 | 2; ref: number; e: Enemy | null; }
const cands: Cand[] = [];
let candN = 0;
function addCand(t: number, type: 0 | 1 | 2, ref: number, e: Enemy | null): void {
  if (candN >= cands.length) cands.push({ t: 0, type: 0, ref: 0, e: null });
  const c = cands[candN++];
  c.t = t; c.type = type; c.ref = ref; c.e = e;
}
const candOrder = (a: Cand, b: Cand) => a.t - b.t || a.type - b.type || a.ref - b.ref;
const candView: Cand[] = [];

function alongSeg(x: number, z: number): number {
  const vx = seg.x1 - seg.x0, vz = seg.z1 - seg.z0;
  const L2 = vx * vx + vz * vz;
  return L2 > 1e-9 ? ((x - seg.x0) * vx + (z - seg.z0) * vz) / L2 : 0;
}

function titanOpts(p: Projectile, ex: ProjExtra): DamageOpts {
  const o: DamageOpts = { src: 'titan', kind: projectileDamageKind(p.kind), crit: p.crit };
  if (ex.fromUpgrade !== undefined) o.fromUpgrade = ex.fromUpgrade;
  return o;
}

function explode(w: World, p: Projectile, ex: ProjExtra, x: number, z: number, r: number): void {
  const kind = projectileDamageKind(p.kind);
  const circle = { k: 'circle' as const, x, z, r };
  if (p.owner === 'titan') {
    if (p.dmg > 0) damageArea(w, circle, p.dmg, titanOpts(p, ex));
  } else if (p.dmg > 0) {
    hurtTitanByShape(w, circle, p.dmg, kind, ex.attacker);
  }
  w.events.push({ type: 'explosion', x, z, r, kind });
}

function stepLob(w: World, p: Projectile, ex: ProjExtra): void {
  p.life -= w.dt;
  if (p.life <= EPS) {
    p.x = p.tx; p.z = p.tz; p.y = 0; p.vy = 0;
    p.alive = false;
    // keep the painted circle in lock-step: it must fire on this tick's stepTelegraphs
    if (p.tg >= 0) {
      const ts = w.telegraphs;
      for (let i = 0; i < ts.length; i++) {
        const tg = ts[i];
        if (tg.id === p.tg) { if (tg.alive && !tg.fired) tg.windup = Math.min(tg.windup, tg.t + w.dt); break; }
      }
    }
    explode(w, p, ex, p.tx, p.tz, p.aoe > 0 ? p.aoe : p.r);
    return;
  }
  const u = clamp(1 - p.life / ex.T, 0, 1);
  p.x = ex.x0 + (p.tx - ex.x0) * u;
  p.z = ex.z0 + (p.tz - ex.z0) * u;
  p.y = ex.y0 * (1 - u) + 4 * ex.apex * u * (1 - u);
  p.vy = (-ex.y0 + 4 * ex.apex * (1 - 2 * u)) / ex.T;
}

function stepTitanShot(w: World, p: Projectile, ex: ProjExtra): void {
  candN = 0;
  // enemies
  enemiesInShape(w, seg, hitEnemies);
  for (let i = 0; i < hitEnemies.length; i++) {
    const e = hitEnemies[i];
    if (!e.alive) continue;
    if (ex.hitIds && ex.hitIds.indexOf(e.id) >= 0) continue;
    addCand(alongSeg(e.x, e.z), 0, e.id, e);
  }
  hitEnemies.length = 0;
  // boss parts
  const B = w.boss;
  if (B && B.alive) {
    for (let i = 0; i < B.parts.length; i++) {
      const bp = B.parts[i];
      if (ex.hitIds && ex.hitIds.indexOf(-1 - i) >= 0) continue;
      if (circleInShape(seg, bp.x, bp.z, bp.r)) addCand(alongSeg(bp.x, bp.z), 1, i, null);
    }
  }
  // low props
  if (p.y < PROP_HIT_MAX_Y && w.city) {
    const minX = Math.min(seg.x0, seg.x1) - seg.r - 5.5, maxX = Math.max(seg.x0, seg.x1) + seg.r + 5.5;
    const minZ = Math.min(seg.z0, seg.z1) - seg.r - 5.5, maxZ = Math.max(seg.z0, seg.z1) + seg.r + 5.5;
    idScratch.length = 0;
    const ids = propsInRect(w.city, minX, minZ, maxX, maxZ, idScratch);
    for (let i = 0; i < ids.length; i++) {
      const pp = w.city.props[ids[i]];
      if (!pp || !pp.alive) continue;
      if (ex.hitIds && ex.hitIds.indexOf(1e9 + pp.id) >= 0) continue;
      if (circleInShape(seg, pp.x, pp.z, propRadius(pp))) addCand(alongSeg(pp.x, pp.z), 2, pp.id, null);
    }
    idScratch.length = 0;
  }
  if (candN === 0) return;
  candView.length = candN;
  for (let i = 0; i < candN; i++) candView[i] = cands[i];
  if (candN > 1) candView.sort(candOrder);
  const opts = titanOpts(p, ex);
  for (let i = 0; i < candView.length && p.alive; i++) {
    const c = candView[i];
    const hx = seg.x0 + (seg.x1 - seg.x0) * clamp(c.t, 0, 1);
    const hz = seg.z0 + (seg.z1 - seg.z0) * clamp(c.t, 0, 1);
    if (p.aoe > 0) {
      // splash shots detonate on first contact
      p.alive = false; p.x = hx; p.z = hz;
      explode(w, p, ex, hx, hz, p.aoe);
      break;
    }
    if (c.type === 0 && c.e) {
      damageEnemyFrom(w, c.e, p.dmg, opts, hx - p.vx * 0.05, hz - p.vz * 0.05);
      if (ex.hitIds) ex.hitIds.push(c.e.id);
    } else if (c.type === 1) {
      if (B && B.alive) { const before = B.hp; damageBoss(w, c.ref, p.dmg, opts); lifestealFromBoss(w, before); }
      if (ex.hitIds) ex.hitIds.push(-1 - c.ref);
    } else {
      damageProp(w, c.ref, p.dmg, opts);
      if (ex.hitIds) ex.hitIds.push(1e9 + c.ref);
    }
    w.events.push({ type: 'projectileHit', x: hx, z: hz, kind: p.kind });
    if (p.pierce > 0) p.pierce--;
    else { p.alive = false; p.x = hx; p.z = hz; }
  }
  candView.length = 0;
}

function stepHostileShot(w: World, p: Projectile, ex: ProjExtra): void {
  const T = w.titan;
  if (!T.alive || !circleInShape(seg, T.x, T.z, T.radius)) return;
  const t = clamp(alongSeg(T.x, T.z), 0, 1);
  const hx = seg.x0 + (seg.x1 - seg.x0) * t, hz = seg.z0 + (seg.z1 - seg.z0) * t;
  p.alive = false; p.x = hx; p.z = hz;
  if (p.aoe > 0) { explode(w, p, ex, hx, hz, p.aoe); return; }
  if (p.dmg > 0) hurtTitanByShape(w, { k: 'circle', x: hx, z: hz, r: p.r }, p.dmg, projectileDamageKind(p.kind), ex.attacker);
  w.events.push({ type: 'projectileHit', x: hx, z: hz, kind: p.kind });
}

/** Advance every projectile one tick: flight, hits, expiry. */
export function stepProjectiles(w: World): void {
  const ps = w.projectiles;
  const dt = w.dt;
  const n = ps.length;   // shots spawned during this pass start next tick
  const b = w.city ? w.city.bounds : null;
  // v2 RED LIGHT (FEATURES_V2 §6.1, pre-wired): enemy-owned shots hang in the air (no move, no aging);
  // boss- and titan-owned shots are unaffected
  const red = redLightActive(w);
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    if (!p.alive) continue;
    if (red && p.owner === 'enemy') continue;
    const ex = extraOf(p);
    if (p.lob) { stepLob(w, p, ex); continue; }
    const x0 = p.x, z0 = p.z;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.y += p.vy * dt;
    if (p.y < 0) p.y = 0;
    seg.x0 = x0; seg.z0 = z0; seg.x1 = p.x; seg.z1 = p.z; seg.r = p.r;
    if (p.owner === 'titan') stepTitanShot(w, p, ex);
    else stepHostileShot(w, p, ex);
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= EPS) {
      p.alive = false;
      if (p.aoe > 0) explode(w, p, ex, p.x, p.z, p.aoe);
      continue;
    }
    if (b && (p.x < b.minX - OOB_PAD || p.x > b.maxX + OOB_PAD || p.z < b.minZ - OOB_PAD || p.z > b.maxZ + OOB_PAD)) p.alive = false;
  }
}
