// HIT PARADE — compile data (metres, m/s, JSON) into the integer tables the sim step reads
// (NETCODE §4 rule 9: "fighters/moves JSON are converted to Int32 tables at boot").
// Floats are used ONLY here (IEEE multiply + Math.round are exact on every engine); the step never
// sees a float. Results are cached per GameData object.

import type { FighterDef, GameData, Move, System, Vec2 } from '../types.ts';
import { SHARED_CLIPS, animGrabId, animIntroId, animTauntId, animWinId, classicMoveId, exIdFor, moveStrength } from '../data.ts';
import { M, mToU, mpsToUpf, mps2ToUpf2 } from './units.ts';
import { SC } from './events.ts';

// ------------------------------------------------------------------ enums
export const K = { normal: 0, command: 1, special: 2, ex: 3, super1: 4, super3: 5, throw: 6, cmdgrab: 7, projectile: 8, system: 9 } as const;
const KIND_CODE: Record<string, number> = K;

/** Guard bits: blockable standing / crouching. HL = 3, H (overhead) = 1, L (low) = 2, U = 0. */
export const GD = { STAND: 1, CROUCH: 2 } as const;

/** Motion codes. */
export const MO = { QCF: 1, QCB: 2, DP: 3, RDP: 4, HCF: 5, HCB: 6, SPD: 7, DQCF: 8, DQCB: 9, CHG_BF: 10, CHG_DU: 11, DD: 12 } as const;
const MOTION_CODE: Record<string, number> = {
  '236': MO.QCF, '214': MO.QCB, '623': MO.DP, '421': MO.RDP, '41236': MO.HCF, '63214': MO.HCB, '360': MO.SPD,
  '236236': MO.DQCF, '214214': MO.DQCB, '[4]6': MO.CHG_BF, '[2]8': MO.CHG_DU, '22': MO.DD,
};
/** Priority class per motion (lower = checked first). CONTRACT §4.3.9 order, 360 placed after supers. */
const MOTION_PRIO: Record<number, number> = {
  [MO.DQCF]: 0, [MO.DQCB]: 0, [MO.SPD]: 1, [MO.DP]: 2, [MO.RDP]: 2, [MO.QCF]: 3, [MO.QCB]: 3,
  [MO.HCF]: 4, [MO.HCB]: 4, [MO.CHG_BF]: 5, [MO.CHG_DU]: 5, [MO.DD]: 6,
};

// ------------------------------------------------------------------ compiled types
export interface CProj {
  vx: number; // U/frame, forward
  life: number;
  w: number;
  h: number;
  y: number;
  x: number; // spawn offset forward
  hits: number;
  limit: number;
  vy: number; // U/frame (arcing projectiles, CONTRACT 20.2)
  g: number; // U/frame^2
  ground: boolean; // rolls on the floor instead of despawning
}

/** CONTRACT 20.2 grab block, compiled. */
export interface CGrab {
  frames: number;
  adv: number;
  hitF: number;
  swap: boolean;
  air: boolean;
  techable: boolean;
  animId: number;
}

/** CONTRACT 20.2 special rekka trigger: the input that fires this chain-only move in the parent's window. */
export interface CTrigger {
  motion: number; // MO.* or 0 = no motion
  btnMask: number; // bit0 L bit1 M bit2 H bit3 S
  simpleDir: number; // SIMPLE "6S"-style: numpad dir (5 = neutral / any), -1 = buttons form
  simpleBtn: number; // SIMPLE buttons form mask (bit0 L bit1 M bit2 H)
}

export interface CMove {
  id: string;
  idx: number;
  snapId: number; // §17 rule 1 id, -1 for system moves
  kind: number;
  kindStr: string;
  inAir: boolean;
  inDir: number; // numpad digit of the input (5 = none)
  inBtn: number; // 0 L, 1 M, 2 H, -1 none
  chainOnly: boolean;
  throwBack: boolean;
  startup: number;
  active: number;
  recovery: number;
  total: number; // last move frame = startup + active + recovery - 1
  lastActive: number;
  damage: number;
  chipPct: number;
  hitstop: number;
  hitstun: number;
  blockstun: number;
  guard: number;
  str: number; // 0 L 1 M 2 H
  sc: number; // event strength class (§17 rule 6)
  lightStarter: boolean;
  boxes: Int32Array; // [f0, f1, x, y, w, h, hid] * nBox, U
  nBox: number;
  nHid: number;
  maxReach: number;
  hurt: Int32Array; // [f0, f1, x, y, w, h] * nHurt
  nHurt: number;
  curve: Int32Array; // cumulative forward travel (U) at move frame f, index 0..total+1
  pushHit: number;
  pushBlock: number;
  chains: number[];
  cSpecial: boolean;
  cSuper: boolean;
  cWhiff: boolean;
  js: number;
  ji: number;
  jl: number;
  kd: number; // 0 none 1 soft 2 hard
  launchVx: number;
  launchVy: number;
  wallSplat: boolean;
  groundBounce: boolean;
  crumple: boolean;
  gainShow: number;
  nerveDrain: number;
  costShow: number;
  costNerve: number;
  inv: Int32Array; // [s0,s1, t0,t1, a0,a1, p0,p1] (0,0 = none)
  armorHits: number;
  armorF0: number;
  armorF1: number;
  armorBreak: boolean;
  proj: CProj | null;
  cin: { frames: number; hitF: Int32Array; hitD: Int32Array } | null;
  animId: number;
  sfxF: Int32Array;
  sfxI: Int32Array;
  isStrike: boolean;
  isGrab: boolean;
  isSuper: boolean;
  level: number;
  isEx: boolean;
  isSpecialCat: boolean; // special / ex / projectile / cmdgrab (cancel class "special")
  isNormalCat: boolean;
  isImpact: boolean;
  isShove: boolean;
  usableAir: boolean;
  multi: number;
  grabReach: number;
  chainNames: string[];
  // CONTRACT 20.2 extensions
  hidDmg: Int32Array; // damage per hit id
  hidHs: Int32Array; // hitstop per hit id (-1 = the move's rules)
  hidF0: Int32Array; // first frame per hit id
  yCurve: Int32Array | null; // moveY: attacker root height (U) per move frame
  airVelX: number;
  airVelY: number;
  hasAirVel: boolean;
  hurtOv: Int32Array; // [f0, f1, w, h, y] * n
  nHurtOv: number;
  grab: CGrab | null;
  grabGap: number; // >= 0: pushbox-front gap reach (U) for grabs; -1 = centre reach (grabReach)
  trigger: CTrigger | null;
  airOnly: boolean;
  phase2: boolean;
  cinEndAdv: number; // -100000 = system default
  cinEndGap: number; // -1 = keep positions
}

export interface CSpecial {
  motion: number;
  prio: number;
  btnMask: number; // bit0 L bit1 M bit2 H
  idx: [number, number, number, number]; // L, M, H, EX(S)
}

export interface CFighter {
  def: FighterDef;
  id: string;
  nDef: number;
  moves: CMove[];
  hpMax: number;
  walkF: number;
  walkB: number;
  dashF: Int32Array; // cumulative travel per dash frame (index 0..frames)
  dashB: Int32Array;
  dashFFrames: number;
  dashBFrames: number;
  prejump: number;
  airFrames: number;
  landing: number;
  g: number;
  vy0: number;
  vxF: number;
  vxB: number;
  throwRange: number;
  hurtStand: [number, number];
  hurtCrouch: [number, number];
  hurtAir: [number, number];
  pushW: number;
  pushH: number;
  pushHalf: number;
  gTable: Int16Array; // ground normals [dir 0..9][btn 0..2]
  aTable: Int16Array; // air normals
  throwF: number;
  throwB: number;
  impact: number;
  shove: number;
  specials: CSpecial[];
  s5: number; s6: number; s2: number; s4: number;
  e5: number; e6: number; e2: number; e4: number;
  sup1: number;
  sup3: number;
  sAir: number; // SIMPLE jS (CONTRACT 20.4)
  assist: number[];
  animIntro: number;
  animWin: number;
  animTaunt: number;
  tauntFrames: number;
  introFrames: number;
}

export interface CSys {
  raw: System;
  wall: number;
  cap: number;
  startHalf: number;
  proxGuard: number;
  gJuggle: number;
  airResetVx: number;
  airResetVy: number;
  popVx: number;
  popVy: number;
  bounceVy: number;
  rushSpeed: number;
  techPush: number;
  backThrowOff: number;
  backRise: number;
  splatRange: number;
  frightCorner: number;
  impactSplat: number;
  projSpawnX: number;
  projScreenHalf: number;
  hitstopBySc: Int32Array;
  pushBySc: Int32Array;
  gainBySc: Int32Array;
  drainBySc: Int32Array;
  sfx: string[];
  sfxIndex: Record<string, number>;
}

// ------------------------------------------------------------------ helpers
function pwl(pts: Vec2[], f: number): number {
  if (pts.length === 0) return 0;
  if (f <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (f <= pts[i][0]) {
      const [f0, v0] = pts[i - 1];
      const [f1, v1] = pts[i];
      return f1 === f0 ? v1 : v0 + ((v1 - v0) * (f - f0)) / (f1 - f0);
    }
  }
  return pts[pts.length - 1][1];
}

function parseInput(inp: string | undefined): { air: boolean; dir: number; btn: number; chainOnly: boolean; back: boolean } {
  const out = { air: false, dir: 5, btn: -1, chainOnly: false, back: false };
  if (!inp) return out;
  let s = inp.trim();
  if (s.includes('>')) {
    out.chainOnly = true;
    s = s.split('>').pop() ?? '';
  }
  if (s.startsWith('j.')) {
    out.air = true;
    s = s.slice(2);
  }
  const m = /^([1-9])?([A-Z+]+)$/.exec(s);
  if (!m) return out;
  if (m[1]) out.dir = Number(m[1]);
  const b = m[2];
  if (b === 'LM' || b === 'L+M') out.back = out.dir === 4;
  const last = b.charAt(b.length - 1);
  out.btn = last === 'L' ? 0 : last === 'M' ? 1 : last === 'H' ? 2 : -1;
  return out;
}

function scOf(mv: Move, str: number): number {
  switch (mv.kind) {
    case 'normal':
    case 'command':
      return str;
    case 'special':
    case 'ex':
      return mv.projectile ? SC.PROJECTILE : SC.SPECIAL;
    case 'projectile':
      return SC.PROJECTILE;
    case 'super1':
    case 'super3':
      return SC.SUPER;
    case 'throw':
    case 'cmdgrab':
      return SC.THROW;
    default:
      return str;
  }
}

// ------------------------------------------------------------------ system
const sysCache = new WeakMap<System, CSys>();

export function compileSystem(sys: System): CSys {
  const hit = sysCache.get(sys);
  if (hit) return hit;
  const byStr = (t: Record<string, number>, special: number, sup: number, imp: number, proj: number, thr: number): Int32Array =>
    Int32Array.from([t.L, t.M, t.H, special, sup, imp, proj, thr]);
  const c: CSys = {
    raw: sys,
    wall: mToU(sys.stage.wallM),
    cap: mToU(sys.stage.separationCapM),
    startHalf: mToU(sys.round.startDistanceM / 2),
    proxGuard: mToU(sys.movement.proxGuardM),
    gJuggle: mps2ToUpf2(sys.juggle.gravityMps2),
    airResetVx: mpsToUpf(sys.juggle.airReset[0]),
    airResetVy: mpsToUpf(sys.juggle.airReset[1]),
    popVx: mpsToUpf(sys.juggle.pop[0]),
    popVy: mpsToUpf(sys.juggle.pop[1]),
    bounceVy: mpsToUpf(sys.groundBounce.vyMps),
    rushSpeed: mpsToUpf(sys.rush.speedMps),
    techPush: mToU(sys.throw.techPushM),
    backThrowOff: mToU(sys.throw.backThrowOffsetM),
    backRise: mToU(sys.kd.backRiseM),
    splatRange: mToU(sys.wallSplat.rangeM),
    frightCorner: mToU(sys.stageFright.cornerRangeM),
    impactSplat: mToU(sys.impact.splatRangeM),
    projSpawnX: mToU(sys.projectile.spawnXM),
    projScreenHalf: mToU(sys.projectile.screenHalfM),
    hitstopBySc: byStr(sys.hitstop, sys.hitstop.special, sys.hitstop.superHit, sys.hitstop.impact, sys.hitstop.projectile, sys.hitstop.throw),
    pushBySc: Int32Array.from([sys.pushback.L, sys.pushback.M, sys.pushback.H, sys.pushback.special, sys.pushback.super, sys.impact.pushbackBlockM, sys.pushback.projectile, 0].map(mToU)),
    gainBySc: byStr(sys.showtime.gain, sys.showtime.gain.special, 0, 0, sys.showtime.gain.projectile, sys.showtime.gain.throw),
    drainBySc: byStr(sys.nerve.blockDrain, sys.nerve.blockDrain.special, sys.nerve.blockDrain.super, sys.nerve.blockDrain.impact, sys.nerve.blockDrain.projectile, 0),
    sfx: [],
    sfxIndex: {},
  };
  for (const k of Object.keys(c) as (keyof CSys)[]) {
    const v = c[k];
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`system.json: derived value ${String(k)} is not a number (missing field?)`);
  }
  sysCache.set(sys, c);
  return c;
}

function sfxId(cs: CSys, name: string): number {
  let i = cs.sfxIndex[name];
  if (i === undefined) {
    i = cs.sfx.length;
    cs.sfx.push(name);
    cs.sfxIndex[name] = i;
  }
  return i;
}

// ------------------------------------------------------------------ moves
function compileMove(id: string, mv: Move, idx: number, snapId: number, animId: number, cs: CSys, sys: System, throwRange: number, grabAnim = -1): CMove {
  const kind = KIND_CODE[mv.kind] ?? K.normal;
  const inp = parseInput(mv.input);
  const strL = moveStrength(id, mv);
  const str = strL === 'L' ? 0 : strL === 'M' ? 1 : 2;
  const sc = id === '__impact' ? SC.IMPACT : scOf(mv, str);
  const total = mv.startup + mv.active + mv.recovery - 1;
  const isGrab = kind === K.throw || kind === K.cmdgrab;
  const isSuper = kind === K.super1 || kind === K.super3;
  // boxes -> hit ids: with `hits` (CONTRACT 20.2) each entry is one hit id (a box belongs to the entry
  // whose window contains its first frame); otherwise boxes sharing a frame range form one hit id
  const bx = mv.boxes ?? [];
  const hitDefs = mv.hits ?? [];
  const boxes = new Int32Array(bx.length * 7);
  const hidKeys: string[] = hitDefs.map((h) => `${h.f[0]}:${h.f[1]}`);
  let maxReach = 0;
  bx.forEach((b, i) => {
    let hid = -1;
    if (hitDefs.length > 0) hid = hitDefs.findIndex((h) => b.f[0] >= h.f[0] && b.f[0] <= h.f[1]);
    if (hid < 0) {
      const key = `${b.f[0]}:${b.f[1]}`;
      hid = hidKeys.indexOf(key);
      if (hid < 0) {
        hid = hidKeys.length;
        hidKeys.push(key);
      }
    }
    boxes.set([b.f[0], b.f[1], mToU(b.x), mToU(b.y), mToU(b.w), mToU(b.h), hid], i * 7);
    maxReach = Math.max(maxReach, mToU(b.x + b.w / 2));
  });
  const hx = mv.hurtExt ?? [];
  const hurt = new Int32Array(hx.length * 6);
  hx.forEach((b, i) => hurt.set([b.f[0], b.f[1], mToU(b.x), mToU(b.y), mToU(b.w), mToU(b.h)], i * 6));
  const curve = new Int32Array(total + 2);
  if (mv.move && mv.move.length > 0) for (let f = 0; f <= total + 1; f++) curve[f] = mToU(pwl(mv.move, f));
  // defaults by strength class
  const hsDefault = isSuper ? sys.hitstop.superHit : kind === K.throw || kind === K.cmdgrab ? 0 : cs.hitstopBySc[sc];
  const hitstunDefault = kind === K.normal || kind === K.command ? [sys.hitstun.L, sys.hitstun.M, sys.hitstun.H][str] : mv.projectile ? sys.hitstun.projectile : sys.hitstun.special;
  const hitstun = mv.hitstun ?? hitstunDefault;
  const blockstun = mv.blockstun ?? Math.max(0, hitstun - sys.hitstun.blockstunDelta);
  const g = mv.guard ?? (isGrab ? 'U' : 'HL');
  const guard = g === 'HL' ? 3 : g === 'H' ? GD.STAND : g === 'L' ? GD.CROUCH : 0;
  const pushDef = cs.pushBySc[sc] ?? 0;
  const jd = isSuper ? sys.juggle.defaults.super : kind === K.normal || kind === K.command ? sys.juggle.defaults.normal : sys.juggle.defaults.special;
  const chains: string[] = [];
  let cSpecial = false;
  let cSuper = false;
  let cWhiff = false;
  for (const c of mv.cancel ?? []) {
    if (c.startsWith('chain:')) chains.push(c.slice(6));
    else if (c === 'special' || c === 'ex') cSpecial = true;
    else if (c === 'super') cSuper = true;
    else if (c === 'whiff') cWhiff = true;
  }
  const kdS = mv.onHit?.kd ?? 'none';
  const inv = new Int32Array(8);
  const setR = (o: number, r: [number, number] | undefined): void => {
    if (r) {
      inv[o] = r[0];
      inv[o + 1] = r[1];
    }
  };
  setR(0, mv.invuln?.strike);
  setR(2, mv.invuln?.throw);
  setR(4, mv.invuln?.air);
  setR(6, mv.invuln?.proj);
  let proj: CProj | null = null;
  if (mv.projectile) {
    const p = mv.projectile;
    proj = {
      vx: mpsToUpf(p.speed),
      life: p.life,
      w: mToU(p.box[0]),
      h: mToU(p.box[1]),
      y: mToU(p.y),
      x: p.x !== undefined ? mToU(p.x) : cs.projSpawnX,
      hits: Math.max(1, p.hits ?? 1),
      limit: Math.max(1, p.limit ?? 1),
      vy: p.vy !== undefined ? mpsToUpf(p.vy) : 0,
      g: p.g !== undefined ? mps2ToUpf2(p.g) : 0,
      ground: p.ground === true,
    };
  }
  let cin: CMove['cin'] = null;
  if (mv.cinematic) {
    const hs = [...mv.cinematic.hits].sort((a, b) => a[0] - b[0]);
    cin = { frames: mv.cinematic.frames, hitF: Int32Array.from(hs.map((h) => h[0])), hitD: Int32Array.from(hs.map((h) => h[1])) };
  }
  const sfx = mv.sfx ?? [];
  const nHid = hidKeys.length;
  const hidDmg = new Int32Array(nHid);
  const hidHs = new Int32Array(nHid);
  const hidF0 = new Int32Array(nHid);
  for (let k = 0; k < nHid; k++) {
    const h = hitDefs[k];
    hidDmg[k] = h ? h.damage : mv.damage ?? 0;
    hidHs[k] = h && h.hitstop !== undefined ? h.hitstop : -1;
    hidF0[k] = h ? h.f[0] : Number(hidKeys[k].split(':')[0]);
  }
  let yCurve: Int32Array | null = null;
  if (mv.moveY && mv.moveY.some((q) => q[1] > 0)) {
    yCurve = new Int32Array(total + 2);
    for (let f = 0; f <= total + 1; f++) yCurve[f] = Math.max(0, mToU(pwl(mv.moveY, f)));
  }
  const ho = mv.hurtOverride ?? [];
  const hurtOv = new Int32Array(ho.length * 5);
  ho.forEach((h, i) => hurtOv.set([h.f[0], h.f[1], mToU(h.w), mToU(h.h), mToU(h.y ?? 0)], i * 5));
  let grab: CGrab | null = null;
  if (mv.grab) {
    grab = {
      frames: mv.grab.frames,
      adv: mv.grab.adv,
      hitF: mv.grab.hitF,
      swap: mv.grab.swap === true,
      air: mv.grab.air === true,
      techable: mv.grab.techable !== undefined ? mv.grab.techable : kind === K.throw,
      animId: grabAnim,
    };
  }
  let trigger: CTrigger | null = null;
  if (mv.trigger) {
    const tcl = mv.trigger.classic;
    const ts = mv.trigger.simple ?? '';
    const mask = (b: string): number => (b.includes('L') ? 1 : 0) | (b.includes('M') ? 2 : 0) | (b.includes('H') ? 4 : 0) | (b.includes('S') ? 8 : 0);
    const sm = /^([1-9]?)S$/.exec(ts);
    trigger = {
      motion: tcl && tcl.motion ? MOTION_CODE[tcl.motion] ?? 0 : 0,
      btnMask: tcl ? mask(tcl.btn) : 7,
      simpleDir: sm ? Number(sm[1] || '5') : -1,
      simpleBtn: sm ? 0 : mask(ts || 'LMH') & 7,
    };
  }
  const isGrabKind = kind === K.throw || kind === K.cmdgrab || mv.grab !== undefined;
  const lightStarter = mv.starter === 'light' || ((kind === K.normal || kind === K.command) && (str === 0 || (inp.dir <= 3 && str === 1 && !inp.air)));
  const cm: CMove = {
    id,
    idx,
    snapId,
    kind,
    kindStr: mv.kind,
    inAir: inp.air,
    inDir: inp.dir,
    inBtn: inp.btn,
    chainOnly: inp.chainOnly,
    throwBack: kind === K.throw && inp.dir === 4,
    startup: mv.startup,
    active: mv.active,
    recovery: mv.recovery,
    total,
    lastActive: mv.startup + mv.active - 1,
    damage: mv.damage ?? 0,
    chipPct: mv.chipPct ?? 0,
    hitstop: mv.hitstop ?? hsDefault,
    hitstun,
    blockstun,
    guard,
    str,
    sc,
    lightStarter,
    boxes,
    nBox: bx.length,
    nHid: hidKeys.length,
    maxReach,
    hurt,
    nHurt: hx.length,
    curve,
    pushHit: mv.pushback?.hit !== undefined ? mToU(mv.pushback.hit) : pushDef,
    pushBlock: mv.pushback?.block !== undefined ? mToU(mv.pushback.block) : pushDef,
    chains: [],
    cSpecial,
    cSuper,
    cWhiff,
    js: mv.juggle?.js ?? jd.js,
    ji: mv.juggle?.ji ?? jd.ji,
    jl: mv.juggle?.jl ?? jd.jl,
    kd: kdS === 'hard' ? 2 : kdS === 'soft' ? 1 : 0,
    launchVx: mv.onHit?.launch ? mpsToUpf(mv.onHit.launch[0]) : 0,
    launchVy: mv.onHit?.launch ? mpsToUpf(mv.onHit.launch[1]) : 0,
    wallSplat: mv.onHit?.wallSplat === true,
    groundBounce: mv.onHit?.groundBounce === true,
    crumple: mv.onHit?.crumple === true,
    gainShow: mv.gain?.showtime ?? (isSuper || kind === K.system ? 0 : cs.gainBySc[sc]),
    nerveDrain: mv.gain?.nerveCost ?? cs.drainBySc[sc],
    costShow: mv.cost?.showtime ?? (kind === K.super1 ? sys.showtime.super1Cost : kind === K.super3 ? sys.showtime.super3Cost : 0),
    costNerve: mv.cost?.nerve ?? (kind === K.ex ? sys.nerve.exCost : 0),
    inv,
    armorHits: mv.armor?.hits ?? 0,
    armorF0: mv.armor?.f[0] ?? 0,
    armorF1: mv.armor?.f[1] ?? 0,
    armorBreak: mv.armorBreak === true || isSuper,
    proj,
    cin,
    animId,
    sfxF: Int32Array.from(sfx.map((e) => e[0])),
    sfxI: Int32Array.from(sfx.map((e) => sfxId(cs, e[1]))),
    isStrike: bx.length > 0 && !isGrabKind,
    isGrab: isGrabKind,
    isSuper,
    level: kind === K.super1 ? 1 : kind === K.super3 ? 3 : 0,
    isEx: kind === K.ex,
    isSpecialCat: kind === K.special || kind === K.ex || kind === K.projectile || kind === K.cmdgrab,
    isNormalCat: kind === K.normal || kind === K.command,
    isImpact: id === '__impact',
    isShove: id === '__shove',
    usableAir: inp.air || mv.air === true,
    airOnly: inp.air || mv.air === true,
    multi: mv.multi ?? 0,
    grabReach: isGrabKind ? (bx.length > 0 ? maxReach : throwRange) : 0,
    chainNames: chains,
    hidDmg,
    hidHs,
    hidF0,
    yCurve,
    airVelX: mv.airVel ? mpsToUpf(mv.airVel[0]) : 0,
    airVelY: mv.airVel ? mpsToUpf(mv.airVel[1]) : 0,
    hasAirVel: mv.airVel !== undefined,
    hurtOv,
    nHurtOv: ho.length,
    grab,
    grabGap: mv.grab?.rangeM !== undefined ? mToU(mv.grab.rangeM) : kind === K.throw && bx.length === 0 ? throwRange : -1,
    trigger,
    phase2: mv.phase === 2,
    cinEndAdv: mv.cinematic?.endAdv ?? -100000,
    cinEndGap: mv.cinematic?.endGapM !== undefined ? mToU(mv.cinematic.endGapM) : -1,
  };
  cm.chainOnly = cm.chainOnly || mv.tc === true;
  if (grab && grab.swap) cm.throwBack = true;
  return cm;
}

function systemImpact(sys: System): Move {
  const i = sys.impact;
  return {
    kind: 'system', input: 'IMPACT', startup: i.startup, active: i.active, recovery: i.recovery,
    damage: i.damage, hitstop: i.hitstop, hitstun: i.hitstun, blockstun: i.blockstun, guard: 'HL',
    boxes: [{ f: [i.startup, i.startup + i.active - 1], x: i.box.x, y: i.box.y, w: i.box.w, h: i.box.h }],
    move: i.travel, pushback: { hit: i.pushbackHitM, block: i.pushbackBlockM },
    onHit: { kd: 'soft' }, armor: { hits: i.armorHits, f: i.armorFrames }, gain: { showtime: 0 },
    cost: { nerve: sys.nerve.impactCost }, strength: 'H',
  };
}

function systemShove(sys: System): Move {
  const s = sys.shove;
  return {
    kind: 'system', input: 'SHOVE', startup: s.startup, active: s.active, recovery: s.recovery,
    damage: s.damage, hitstop: s.hitstop, hitstun: s.hitstun, blockstun: s.blockstun, guard: 'HL',
    boxes: [{ f: [s.startup, s.startup + s.active - 1], x: s.box.x, y: s.box.y, w: s.box.w, h: s.box.h }],
    pushback: { hit: s.pushbackHitM, block: s.pushbackBlockM }, invuln: { strike: s.invuln, throw: s.invuln },
    gain: { showtime: 0 }, cost: { nerve: sys.nerve.shoveCost }, strength: 'H', armorBreak: true,
  };
}

function systemThrow(sys: System, back: boolean): Move {
  const t = sys.throw;
  return {
    kind: 'throw', input: back ? '4LM' : 'LM', startup: t.startup, active: t.active, recovery: t.recovery,
    damage: t.damage, hitstun: back ? t.hitstunB : t.hitstunF, guard: 'U', onHit: { kd: 'soft' },
  };
}

// ------------------------------------------------------------------ fighters
const fCache = new WeakMap<GameData, Record<string, CFighter>>();

/** Dash travel curve: ease-out over `movePct` of the frames, then stationary. */
function dashCurve(distU: number, frames: number, movePct: number): Int32Array {
  const c = new Int32Array(frames + 1);
  const fm = Math.max(1, Math.round((frames * movePct) / 100));
  for (let f = 0; f <= frames; f++) {
    const t = Math.min(1, f / fm);
    c[f] = Math.round(distU * (1 - (1 - t) * (1 - t)));
  }
  return c;
}

export function compileFighter(data: GameData, id: string): CFighter {
  let cache = fCache.get(data);
  if (!cache) {
    cache = {};
    fCache.set(data, cache);
  }
  const hit = cache[id];
  if (hit) return hit;
  const def = data.fighters[id];
  if (!def) throw new Error(`compileFighter: unknown fighter "${id}" (have: ${Object.keys(data.fighters).join(', ')})`);
  const sys = data.system;
  const cs = compileSystem(sys);
  const throwRange = mToU(def.throwRangeM);
  const ids = Object.keys(def.moves);
  const moves: CMove[] = [];
  ids.forEach((mid, k) => moves.push(compileMove(mid, def.moves[mid], k, k, SHARED_CLIPS.length + k, cs, sys, throwRange, def.moves[mid].grab ? animGrabId(def, mid) : -1)));
  const byName: Record<string, number> = {};
  moves.forEach((m) => (byName[m.id] = m.idx));
  const addSys = (name: string, mv: Move, anim: number): number => {
    const idx = moves.length;
    moves.push(compileMove(name, mv, idx, -1, anim, cs, sys, throwRange));
    return idx;
  };
  // IMPACT / SHOVE: fighter override (move named impact / shove) or system numbers
  const impact = byName['impact'] !== undefined ? byName['impact'] : addSys('__impact', systemImpact(sys), 32);
  moves[impact].isImpact = true;
  moves[impact].sc = SC.IMPACT;
  moves[impact].lightStarter = true; // IMPACT starts combos at the 80% column (FIGHTING_DESIGN 2c)
  if (!moves[impact].armorHits) {
    moves[impact].armorHits = sys.impact.armorHits;
    moves[impact].armorF0 = sys.impact.armorFrames[0];
    moves[impact].armorF1 = sys.impact.armorFrames[1];
  }
  const shove = byName['shove'] !== undefined ? byName['shove'] : addSys('__shove', systemShove(sys), 33);
  moves[shove].isShove = true;
  moves[shove].armorBreak = true;
  // throws
  let throwF = -1;
  let throwB = -1;
  for (const m of moves) {
    if (m.kind !== K.throw || m.snapId < 0) continue;
    if (m.throwBack) {
      if (throwB < 0) throwB = m.idx;
    } else if (throwF < 0) throwF = m.idx;
  }
  if (throwF < 0) throwF = addSys('__throw_f', systemThrow(sys, false), 0);
  if (throwB < 0) throwB = addSys('__throw_b', systemThrow(sys, true), 0);
  // chains
  for (const m of moves) {
    m.chains = m.chainNames.map((n) => byName[n]).filter((x) => x !== undefined);
  }
  // normals tables
  const gTable = new Int16Array(30).fill(-1);
  const aTable = new Int16Array(30).fill(-1);
  const find = (air: boolean, dir: number, btn: number): number => {
    for (const m of moves) {
      if (m.snapId < 0 || m.chainOnly || !m.isNormalCat || m.phase2) continue;
      if (m.inAir === air && m.inDir === dir && m.inBtn === btn) return m.idx;
    }
    return -1;
  };
  for (let d = 1; d <= 9; d++) {
    for (let b = 0; b < 3; b++) {
      let g = find(false, d, b);
      if (g < 0) {
        if (d <= 3) g = find(false, 2, b);
        if (g < 0) g = find(false, 5, b);
      }
      gTable[d * 3 + b] = g;
      let a = find(true, d, b);
      if (a < 0) a = find(true, 5, b);
      aTable[d * 3 + b] = a;
    }
  }
  // classic specials
  const specials: CSpecial[] = [];
  const idOr = (name: string | undefined): number => (name !== undefined && byName[name] !== undefined && !moves[byName[name]].phase2 ? byName[name] : -1);
  for (const e of def.classic ?? []) {
    const code = MOTION_CODE[e.motion];
    if (!code) continue;
    let mask = 0;
    if (e.btn.includes('L')) mask |= 1;
    if (e.btn.includes('M')) mask |= 2;
    if (e.btn.includes('H')) mask |= 4;
    const idx: [number, number, number, number] = [
      idOr(classicMoveId(e, 'L')), idOr(classicMoveId(e, 'M')), idOr(classicMoveId(e, 'H')),
      e.move.includes('{s}') || e.btn.includes('S') ? idOr(classicMoveId(e, 'S')) : -1,
    ];
    specials.push({ motion: code, prio: MOTION_PRIO[code], btnMask: mask, idx });
  }
  const sm = def.simple ?? {};
  const sup1 = idOr(sm['S+H'] as string | undefined);
  const sup3 = idOr(sm['S+H+2'] as string | undefined);
  if (!specials.some((s) => s.motion === MO.DQCF) && sup1 >= 0) specials.push({ motion: MO.DQCF, prio: 0, btnMask: 7, idx: [sup1, sup1, sup1, sup1] });
  if (!specials.some((s) => s.motion === MO.DQCB) && sup3 >= 0) specials.push({ motion: MO.DQCB, prio: 0, btnMask: 7, idx: [sup3, sup3, sup3, sup3] });
  specials.sort((a, b) => a.prio - b.prio);
  const simpleId = (k: string): number => idOr(sm[k] as string | undefined);
  const exOf = (k: string, base: number): number => {
    const explicit = simpleId('A' + k);
    if (explicit >= 0) return explicit;
    if (base < 0) return -1;
    const ex = byName[exIdFor(moves[base].id)];
    return ex !== undefined ? ex : -1;
  };
  const s5 = simpleId('5S');
  const s6 = simpleId('6S');
  const s2 = simpleId('2S');
  const s4 = simpleId('4S');
  // body / movement
  const jump = def.jump;
  const N = jump.air;
  const apexU = mToU(jump.apexM);
  // choose g so the discrete arc's apex ~ apexM; vy0 = floor(g*N/2) touches down on step N+1, so the
  // fighter spends exactly N frames airborne (takeoff frame = step 1)
  const g = Math.max(1, Math.round((8 * apexU) / (N * N)));
  const vy0 = Math.floor((g * N) / 2);
  const introClip = def.intro ? data.clips[id]?.clips[def.intro] : undefined;
  const tauntClip = def.taunt ? data.clips[id]?.clips[def.taunt] : undefined;
  const cf: CFighter = {
    def,
    id,
    nDef: ids.length,
    moves,
    hpMax: def.hp,
    walkF: mpsToUpf(def.walk.fwd),
    walkB: mpsToUpf(def.walk.back),
    dashF: dashCurve(mToU(def.dash.fwd), def.dash.fwdFrames, sys.movement.dashMovePct),
    dashB: dashCurve(mToU(def.dash.back), def.dash.backFrames, sys.movement.dashMovePct),
    dashFFrames: def.dash.fwdFrames,
    dashBFrames: def.dash.backFrames,
    prejump: jump.prejump,
    airFrames: N,
    landing: jump.landing,
    g,
    vy0,
    vxF: Math.round(mToU(jump.fwdM) / N),
    vxB: Math.round(mToU(jump.fwdM) / N),
    throwRange,
    hurtStand: [mToU(def.hurt.stand[0]), mToU(def.hurt.stand[1])],
    hurtCrouch: [mToU(def.hurt.crouch[0]), mToU(def.hurt.crouch[1])],
    hurtAir: [mToU(def.hurt.air[0]), mToU(def.hurt.air[1])],
    pushW: mToU(def.pushbox[0]),
    pushH: mToU(def.pushbox[1]),
    pushHalf: mToU(def.pushbox[0] / 2),
    gTable,
    aTable,
    throwF,
    throwB,
    impact,
    shove,
    specials,
    s5, s6, s2, s4,
    e5: exOf('5S', s5), e6: exOf('6S', s6), e2: exOf('2S', s2), e4: exOf('4S', s4),
    sup1,
    sup3,
    sAir: simpleId('jS'),
    assist: ((sm.assist as string[] | undefined) ?? []).map((n) => idOr(n)).filter((x) => x >= 0),
    animIntro: animIntroId(def),
    animWin: animWinId(def, 0),
    animTaunt: animTauntId(def),
    tauntFrames: tauntClip ? Math.max(30, Math.round(tauntClip.dur * 60)) : 60,
    introFrames: introClip ? Math.round(introClip.dur * 60) : 90,
  };
  void M;
  cache[id] = cf;
  return cf;
}
