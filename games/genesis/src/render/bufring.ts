// GENESIS — PERF s16: RINGS OF INSTANCE BUFFERS (owner's M5, ANGLE-Metal). A gl.bufferSubData into a buffer the GPU
// may still read (drawn in the last ~3 frames) makes ANGLE take a new Metal buffer of the WHOLE buffer's size and copy
// the rest across (BufferMtl putDataInNewBufferAndStartUsingNewBuffer); every 64 MB of such fresh buffers is a wait for
// the whole GPU queue. The life pools (people, animals, crowds, boats, carts) rewrite their instance data every frame
// into buffers drawn every frame: a whole-buffer copy per attribute per frame.
// A ringed attribute keeps N (3) BufferAttributes over ONE shared CPU array (so the owner's writes, setXYZ /
// setMatrixAt / .array, reach all of them) and each GPU buffer remembers the element span written since its own last
// upload. A frame that uploads swaps the NEXT member into the geometry (or the mesh's instanceMatrix / instanceColor)
// and sends it that span: its buffer was last drawn >= 3 frames ago (members rotate at most once a frame), so ANGLE
// writes it in place. three re-points the vertex array when the attribute object changes (WebGLBindingStates), and the
// draw reads exactly the bytes the single buffer held (same array, same draw range): the same image.
// Cost: N-1 more GPU buffers per ringed attribute. `?bufring=0` = one buffer per attribute (as before).
import { BufferAttribute, InstancedBufferAttribute } from 'three';
import type { BufferGeometry, InstancedMesh, Mesh } from 'three';
import { perfSwitch } from './perfswitch.ts';

export const BUF_RING = perfSwitch('bufring', true);
/** GPU buffers per ringed attribute: the members rotate at most once a frame, so one written now was last drawn N frames ago */
export const RING_N = 3;

let frame = 0;
let gl: WebGL2RenderingContext | null = null;
/** the renderer's context (to free the extra members' buffers when their mesh goes) */
export function setRingGL(g: WebGL2RenderingContext | null): void { gl = g; }
/** a frame begins (the renderer) */
export function ringTick(): void { frame++; }
/** the frame counter (ticked at the start of every renderer frame) */
export function ringFrame(): number { return frame; }

type Attr = BufferAttribute;
class Ring {
  readonly members: Attr[];
  /** element ranges [s0, e0, s1, e1, ...] (sorted, disjoint) written since each member's last upload */
  readonly dirty: number[][];
  readonly bufs: (WebGLBuffer | null)[];
  cur = 0;
  lastFlip = -1;
  /** the instanced mesh (instanceMatrix / instanceColor) or null; the geometry holding the other attributes / index */
  readonly mesh: Mesh | null;
  readonly geo: BufferGeometry;
  readonly name: string;
  constructor(mesh: Mesh | null, geo: BufferGeometry, name: string, first: Attr) {
    this.mesh = mesh;
    this.geo = geo;
    this.name = name;
    this.members = [first];
    const Ctor = first.constructor as new (arr: ArrayLike<number>, size: number, norm?: boolean, mpa?: number) => Attr;
    for (let i = 1; i < RING_N; i++) {
      const inst = first as unknown as InstancedBufferAttribute;
      const m = inst.isInstancedBufferAttribute ? new InstancedBufferAttribute(first.array as Float32Array, first.itemSize, first.normalized, inst.meshPerAttribute) : new Ctor(first.array, first.itemSize, first.normalized);
      m.setUsage(first.usage);
      m.name = first.name;
      this.members.push(m);
    }
    this.dirty = this.members.map(() => []);
    this.bufs = this.members.map(() => null);
    this.members.forEach((m, i) => {
      m.onUploadCallback = () => {
        // (three calls this right after its bufferData / bufferSubData, the member's buffer still bound)
        if (!this.bufs[i] && gl) this.bufs[i] = gl.getParameter(name === 'index' ? gl.ELEMENT_ARRAY_BUFFER_BINDING : gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
        this.dirty[i].length = 0;
      };
    });
  }
  private installed(): Attr | undefined {
    const n = this.name;
    if (n === 'instanceMatrix') return (this.mesh as InstancedMesh).instanceMatrix;
    if (n === 'instanceColor') return ((this.mesh as InstancedMesh).instanceColor ?? undefined) as Attr | undefined;
    if (n === 'index') return (this.geo.index ?? undefined) as Attr | undefined;
    return this.geo.attributes[n] as Attr | undefined;
  }
  private install(m: Attr): void {
    const n = this.name;
    if (n === 'instanceMatrix') (this.mesh as InstancedMesh).instanceMatrix = m as InstancedBufferAttribute;
    else if (n === 'instanceColor') (this.mesh as InstancedMesh).instanceColor = m as InstancedBufferAttribute;
    else if (n === 'index') this.geo.setIndex(m);
    else this.geo.setAttribute(n, m);
  }
  /** elements [start, start + count) of the shared array were written: upload them through the next member */
  mark(start: number, count: number): void {
    if (count <= 0) return;
    // (another owner replaced the attribute: this ring no longer draws; leave it)
    if (this.members.indexOf(this.installed() as Attr) < 0) return;
    for (const d of this.dirty) addRange(d, start, start + count);
    if (this.lastFlip !== frame) { this.lastFlip = frame; this.cur = (this.cur + 1) % this.members.length; this.install(this.members[this.cur]); }
    const m = this.members[this.cur];
    const d = this.dirty[this.cur];
    m.clearUpdateRanges();
    for (let k = 0; k < d.length; k += 2) m.addUpdateRange(d[k], d[k + 1] - d[k]);
    m.needsUpdate = true;
  }
  /** the mesh went: free the members three does not know to free (all but the one installed; `all`: every one) */
  free(all = false): void {
    const at = all ? null : this.installed();
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i] === at) continue;
      const b = this.bufs[i];
      if (b && gl) gl.deleteBuffer(b);
      this.bufs[i] = null;
      RINGS.delete(this.members[i]);
    }
  }
}

/** ranges a member keeps apart before the closest two are merged (each is one bufferSubData) */
const MAX_RANGES = 24;
/** add [s, e) to a sorted disjoint range list (touching / overlapping ranges merge; past MAX_RANGES the closest pair) */
export function addRange(d: number[], s: number, e: number): void {
  let i = 0;
  while (i < d.length && d[i + 1] < s) i += 2;
  // d[i..] ends at or after s: merge every range that starts at or before e
  let j = i;
  while (j < d.length && d[j] <= e) { s = Math.min(s, d[j]); e = Math.max(e, d[j + 1]); j += 2; }
  d.splice(i, j - i, s, e);
  while (d.length > MAX_RANGES * 2) {
    let best = 2, gap = Infinity;
    for (let k = 2; k < d.length; k += 2) { const g = d[k] - d[k - 1]; if (g < gap) { gap = g; best = k; } }
    d.splice(best - 1, 2);
  }
}

const RINGS = new WeakMap<object, Ring>();

/**
 * ring the named attributes of a mesh ('instanceMatrix', 'instanceColor' or geometry attribute names) — call right
 * after the mesh and its attributes are made, before any write; then upload them only through uploadPrefix /
 * ringMark (a plain needsUpdate would reach one member only)
 */
export function ringify(mesh: Mesh, names: string[]): void {
  if (!BUF_RING) return;
  const rings: Ring[] = [];
  for (const n of names) {
    const a = (n === 'instanceMatrix' ? (mesh as InstancedMesh).instanceMatrix : n === 'instanceColor' ? (mesh as InstancedMesh).instanceColor : mesh.geometry.attributes[n]) as Attr | null | undefined;
    if (!a || RINGS.has(a)) continue;
    const r = new Ring(n === 'instanceMatrix' || n === 'instanceColor' ? mesh : null, mesh.geometry as BufferGeometry, n, a);
    for (const m of r.members) RINGS.set(m, r);
    rings.push(r);
  }
  if (!rings.length) return;
  const free = () => { for (const r of rings) r.free(); mesh.removeEventListener('dispose', free); };
  mesh.addEventListener('dispose', free);
}

/** a ringed attribute's upload of elements [start, start + count); false when `a` is not ringed */
export function ringMark(a: object | null | undefined, start: number, count: number): boolean {
  const r = a ? RINGS.get(a) : undefined;
  if (!r) return false;
  r.mark(start, count);
  return true;
}

/** (tests) the ring an attribute belongs to: its members and which one is installed */
export function ringOf(a: object): { members: readonly object[]; cur: number } | null {
  const r = RINGS.get(a);
  return r ? { members: r.members, cur: r.cur } : null;
}

/**
 * ring a geometry's attribute (or 'index') in place — putGrowable's buffers, rewritten whole at each rebuild; the
 * geometry's dispose frees the extra members
 */
export function ringGeo(geo: BufferGeometry, name: string): void {
  if (!BUF_RING) return;
  const a = (name === 'index' ? geo.index : geo.attributes[name]) as Attr | null | undefined;
  if (!a || RINGS.has(a) || (a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return;
  const r = new Ring(null, geo, name, a);
  for (const m of r.members) RINGS.set(m, r);
  const free = () => { r.free(); geo.removeEventListener('dispose', free); };
  geo.addEventListener('dispose', free);
}

/** the ringed attribute `a` is being replaced by a new one: delete all its members' buffers */
export function ringDrop(a: object | null | undefined): void {
  const r = a ? RINGS.get(a) : undefined;
  if (r) r.free(true);
}
