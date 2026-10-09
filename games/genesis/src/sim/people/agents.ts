// GENESIS — AgentStore: every individual person on a planet as a structure of typed arrays (CONTRACT.md §6.4).
//
// One slot per agent; dead agents' slots go on a free list and are reused (ids are never reused: `id[slot]` is the
// global id from IdAllocator('agent'), `idToSlot` maps back). Arrays grow by doubling up to the planet cap. Every array
// is listed by `arrays()` in a fixed order: save, load, hash and the rewind keyframes walk that list, so a loaded store
// continues bit-identically. Object-shaped meta (capacity, free list, custom names) is JSON (`toJson`).
//
// Movement is a segment (from -> to) between ticks t0 and t1: the position at any tick is analytic (`posAt`), so the
// sim only touches an agent when a segment or a task ends (the planet's TimeWheel holds `next` per agent id).

import type { TypedArray } from '../core/hash.ts';
import { GODS, INV, MEM, NN, NS, NT, PATH_MAX } from './defs.ts';

export interface AgentStoreJson {
  cap: number;
  kw: number;
  hi: number;
  count: number;
  free: number[];
}

type ArrCtor = new (n: number) => TypedArray;

/** array name -> [constructor, elements per agent] (the KW-dependent knowledge array is added at construction) */
const LAYOUT: [string, ArrCtor, number][] = [
  ['id', Uint32Array, 1], ['alive', Uint8Array, 1], ['species', Uint16Array, 1], ['settlement', Int32Array, 1],
  ['household', Int32Array, 1], ['home', Int32Array, 1], ['sex', Uint8Array, 1], ['caste', Uint8Array, 1],
  ['role', Uint8Array, 1], ['flags', Uint16Array, 1], ['birth', Int32Array, 1], ['health', Float32Array, 1],
  ['mood', Float32Array, 1], ['fx', Float32Array, 1], ['fy', Float32Array, 1], ['fz', Float32Array, 1],
  ['tx', Float32Array, 1], ['ty', Float32Array, 1], ['tz', Float32Array, 1], ['t0', Int32Array, 1], ['t1', Int32Array, 1],
  ['cell', Int32Array, 1], ['path', Int32Array, PATH_MAX], ['pathLen', Uint8Array, 1], ['pathPos', Uint8Array, 1],
  ['gx', Float32Array, 1], ['gy', Float32Array, 1], ['gz', Float32Array, 1], ['gcell', Int32Array, 1], ['task', Uint8Array, 1],
  ['phase', Uint8Array, 1], ['tTarget', Int32Array, 1], ['tData', Int32Array, 1], ['tData2', Int32Array, 1],
  ['tWork', Int32Array, 1], ['next', Int32Array, 1], ['invItem', Int16Array, INV], ['invQty', Float32Array, INV],
  ['needs', Float32Array, NN], ['needT', Int32Array, 1], ['skills', Float32Array, NS], ['traits', Float32Array, NT],
  ['memKind', Uint8Array, MEM], ['memTick', Int32Array, MEM], ['memA', Int32Array, MEM], ['memHead', Uint8Array, 1],
  ['love', Float32Array, GODS], ['fear', Float32Array, GODS], ['name', Uint32Array, 1], ['mother', Int32Array, 1],
  ['father', Int32Array, 1], ['partner', Int32Array, 1], ['disease', Int16Array, 1], ['sickEnd', Int32Array, 1],
  ['immune', Uint32Array, 1], ['anim', Uint8Array, 1], ['heading', Float32Array, 1], ['dmg', Float32Array, 1],
  ['cause', Uint8Array, 1], ['gear', Int16Array, 1], ['tool', Int16Array, 1], ['tAir', Float32Array, 1],
  // societies & plagues (phase 2b): the boat in use, the mission joined, the tick an exposed agent turns infectious
  ['boat', Int16Array, 1], ['mission', Int32Array, 1], ['infectT', Int32Array, 1],
  // fix pass: the building the agent is inside (sleeping, warming up), -1 outside — occupancy is kept against it
  ['inside', Int32Array, 1],
  // fix pass: discoveries this agent made by experiment (each one makes the next less likely: no lone genius races eras)
  ['found', Uint8Array, 1],
];

/** arrays whose empty value is -1 */
const NEG = new Set(['invItem', 'disease', 'gear', 'tool', 'gcell', 'boat', 'inside']);

export class AgentStore {
  cap: number;
  /** knowledge words per agent (32 knowledge bits each) */
  kw: number;
  /** slots in use or freed (iteration bound) */
  hi = 0;
  /** living agents */
  count = 0;
  free: number[] = [];
  /** agent id -> slot (living agents only); rebuilt on load */
  readonly idToSlot = new Map<number, number>();

  id!: Uint32Array; alive!: Uint8Array; species!: Uint16Array; settlement!: Int32Array; household!: Int32Array;
  home!: Int32Array; sex!: Uint8Array; caste!: Uint8Array; role!: Uint8Array; flags!: Uint16Array; birth!: Int32Array;
  health!: Float32Array; mood!: Float32Array;
  fx!: Float32Array; fy!: Float32Array; fz!: Float32Array; tx!: Float32Array; ty!: Float32Array; tz!: Float32Array;
  t0!: Int32Array; t1!: Int32Array; cell!: Int32Array;
  path!: Int32Array; pathLen!: Uint8Array; pathPos!: Uint8Array; gx!: Float32Array; gy!: Float32Array; gz!: Float32Array;
  /** the cell of the goal point (set with it) */
  gcell!: Int32Array;
  task!: Uint8Array; phase!: Uint8Array; tTarget!: Int32Array; tData!: Int32Array; tData2!: Int32Array; tWork!: Int32Array;
  next!: Int32Array;
  invItem!: Int16Array; invQty!: Float32Array;
  needs!: Float32Array; needT!: Int32Array; skills!: Float32Array; traits!: Float32Array;
  memKind!: Uint8Array; memTick!: Int32Array; memA!: Int32Array; memHead!: Uint8Array;
  love!: Float32Array; fear!: Float32Array;
  name!: Uint32Array; mother!: Int32Array; father!: Int32Array; partner!: Int32Array;
  disease!: Int16Array; sickEnd!: Int32Array; immune!: Uint32Array;
  anim!: Uint8Array; heading!: Float32Array;
  /** accumulated damage by cause this decision interval (diagnostics), and the dominant cause of harm */
  dmg!: Float32Array; cause!: Uint8Array;
  /** worn clothing item (-1 none) and the tool in hand (-1 none) */
  gear!: Int16Array; tool!: Int16Array;
  /** air temperature at the last needs update (the interval's warmth averages it with now) */
  tAir!: Float32Array;
  /** boat item in use (-1 on foot): water is passable at the boat's speed */
  boat!: Int16Array;
  /** mission id the agent belongs to (0 none) */
  mission!: Int32Array;
  /** while infected: the tick the incubation ends and the agent turns sick and infectious (SEIR E -> I) */
  infectT!: Int32Array;
  /** building id the agent is inside (-1 none): the shelter it entered, whatever its home is now */
  inside!: Int32Array;
  /** experiments this agent has turned into discoveries */
  found!: Uint8Array;
  know!: Uint32Array;

  constructor(cap: number, kw: number) {
    this.cap = Math.max(8, cap);
    this.kw = Math.max(1, kw);
    const self = this as unknown as Record<string, TypedArray>;
    for (const [name, C, per] of LAYOUT) self[name] = new C(this.cap * per);
    this.know = new Uint32Array(this.cap * this.kw);
    this.invItem.fill(-1);
    this.disease.fill(-1);
    this.gear.fill(-1);
    this.tool.fill(-1);
    this.boat.fill(-1);
    this.inside.fill(-1);
  }

  /** every saved / hashed array, in a fixed order */
  arrays(): [string, TypedArray][] {
    const self = this as unknown as Record<string, TypedArray>;
    const out: [string, TypedArray][] = LAYOUT.map(([n]) => [n, self[n]]);
    out.push(['know', this.know]);
    return out;
  }

  private grow(minCap: number): void {
    let cap = this.cap;
    while (cap < minCap) cap *= 2;
    const self = this as unknown as Record<string, TypedArray>;
    for (const [name, C, per] of LAYOUT) {
      const a = new C(cap * per);
      a.set(self[name] as unknown as ArrayLike<number>);
      if (NEG.has(name)) (a as Int16Array).fill(-1, this.cap * per);
      self[name] = a;
    }
    const k = new Uint32Array(cap * this.kw);
    k.set(this.know);
    this.know = k;
    this.cap = cap;
  }

  /** widen the knowledge bitset (content gained recipes at runtime) */
  growKnowledge(kw: number): void {
    if (kw <= this.kw) return;
    const k = new Uint32Array(this.cap * kw);
    for (let s = 0; s < this.cap; s++) for (let w = 0; w < this.kw; w++) k[s * kw + w] = this.know[s * this.kw + w];
    this.know = k;
    this.kw = kw;
  }

  /** a free slot (cleared), registered under `id` */
  alloc(id: number): number {
    let s: number;
    if (this.free.length) s = this.free.pop()!;
    else {
      if (this.hi >= this.cap) this.grow(this.hi + 1);
      s = this.hi++;
    }
    this.clear(s);
    this.id[s] = id;
    this.alive[s] = 1;
    this.count++;
    this.idToSlot.set(id, s);
    return s;
  }

  /** release a slot (the agent died or became a cohort member) */
  release(s: number): void {
    if (!this.alive[s]) return;
    this.alive[s] = 0;
    this.idToSlot.delete(this.id[s]);
    this.count--;
    this.free.push(s);
  }

  private clear(s: number): void {
    const self = this as unknown as Record<string, TypedArray>;
    for (const [name, , per] of LAYOUT) {
      const a = self[name];
      const v = NEG.has(name) ? -1 : 0;
      for (let k = s * per; k < (s + 1) * per; k++) a[k] = v;
    }
    for (let w = 0; w < this.kw; w++) this.know[s * this.kw + w] = 0;
  }

  slotOf(id: number): number {
    const s = this.idToSlot.get(id);
    return s === undefined ? -1 : s;
  }

  // ───────────── knowledge bits ─────────────

  knows(s: number, k: number): boolean {
    const w = k >>> 5;
    return w < this.kw && (this.know[s * this.kw + w] & (1 << (k & 31))) !== 0;
  }

  setKnows(s: number, k: number, on: boolean): void {
    const w = k >>> 5;
    if (w >= this.kw) this.growKnowledge(w + 1);
    const i = s * this.kw + w;
    if (on) this.know[i] |= 1 << (k & 31);
    else this.know[i] &= ~(1 << (k & 31));
  }

  knowCount(s: number): number {
    let n = 0;
    for (let w = 0; w < this.kw; w++) n += popcount(this.know[s * this.kw + w]);
    return n;
  }

  // ───────────── inventory ─────────────

  /** quantity of an item carried */
  carried(s: number, item: number): number {
    let q = 0;
    for (let k = 0; k < INV; k++) if (this.invItem[s * INV + k] === item) q += this.invQty[s * INV + k];
    return q;
  }

  /** add to the inventory; returns what did not fit */
  give(s: number, item: number, qty: number): number {
    if (qty <= 0) return 0;
    const b = s * INV;
    for (let k = 0; k < INV; k++) if (this.invItem[b + k] === item) { this.invQty[b + k] += qty; return 0; }
    for (let k = 0; k < INV; k++) if (this.invItem[b + k] < 0) { this.invItem[b + k] = item; this.invQty[b + k] = qty; return 0; }
    return qty;
  }

  /** remove up to qty; returns what was taken */
  take(s: number, item: number, qty: number): number {
    const b = s * INV;
    let got = 0;
    for (let k = 0; k < INV && got < qty; k++) {
      if (this.invItem[b + k] !== item) continue;
      const m = Math.min(qty - got, this.invQty[b + k]);
      this.invQty[b + k] -= m;
      got += m;
      if (this.invQty[b + k] <= 1e-6) { this.invItem[b + k] = -1; this.invQty[b + k] = 0; }
    }
    return got;
  }

  /** the item shown in hand (first non-empty slot; -1 none) */
  carryItem(s: number): number {
    const b = s * INV;
    for (let k = 0; k < INV; k++) if (this.invItem[b + k] >= 0) return this.invItem[b + k];
    return -1;
  }

  // ───────────── memories ─────────────

  remember(s: number, kind: number, tick: number, a = 0): void {
    const h = this.memHead[s] % MEM;
    this.memKind[s * MEM + h] = kind;
    this.memTick[s * MEM + h] = tick;
    this.memA[s * MEM + h] = a;
    this.memHead[s] = (h + 1) % MEM;
  }

  // ───────────── movement ─────────────

  /** position at tick t (unit vector, written into out) */
  posAt(s: number, t: number, out: number[] | Float32Array | Float64Array): void {
    const t0 = this.t0[s], t1 = this.t1[s];
    let u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
    const ax = this.fx[s], ay = this.fy[s], az = this.fz[s];
    let x = ax + (this.tx[s] - ax) * u;
    let y = ay + (this.ty[s] - ay) * u;
    let z = az + (this.tz[s] - az) * u;
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= l; y /= l; z /= l;
    out[0] = x; out[1] = y; out[2] = z;
  }

  /** set a stationary position */
  place(s: number, x: number, y: number, z: number, t: number): void {
    this.fx[s] = x; this.fy[s] = y; this.fz[s] = z;
    this.tx[s] = x; this.ty[s] = y; this.tz[s] = z;
    this.t0[s] = t; this.t1[s] = t;
  }

  toJson(): AgentStoreJson {
    return { cap: this.cap, kw: this.kw, hi: this.hi, count: this.count, free: this.free.slice() };
  }

  static fromJson(j: AgentStoreJson): AgentStore {
    const st = new AgentStore(j.cap, j.kw);
    st.hi = j.hi;
    st.count = j.count;
    st.free = j.free.slice();
    return st;
  }

  /** after the arrays were loaded: rebuild the id map */
  reindex(): void {
    this.idToSlot.clear();
    for (let s = 0; s < this.hi; s++) if (this.alive[s]) this.idToSlot.set(this.id[s], s);
  }
}

export function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
