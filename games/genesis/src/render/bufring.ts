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

type Attr = BufferAttribute;
class Ring {
  readonly members: Attr[];
  /** element span [lo, hi) written since each member's last upload (lo >= hi: none) */
  readonly lo: number[];
  readonly hi: number[];
  readonly bufs: (WebGLBuffer | null)[];
  cur = 0;
  lastFlip = -1;
  constructor(readonly mesh: Mesh, readonly name: string, first: Attr) {
    this.members = [first];
    const Ctor = first.constructor as new (arr: ArrayLike<number>, size: number, norm?: boolean, mpa?: number) => Attr;
    for (let i = 1; i < RING_N; i++) {
      const inst = first as unknown as InstancedBufferAttribute;
      const m = inst.isInstancedBufferAttribute ? new InstancedBufferAttribute(first.array as Float32Array, first.itemSize, first.normalized, inst.meshPerAttribute) : new Ctor(first.array, first.itemSize, first.normalized);
      m.setUsage(first.usage);
      m.name = first.name;
      this.members.push(m);
    }
    this.lo = this.members.map(() => 0);
    this.hi = this.members.map(() => 0);
    this.bufs = this.members.map(() => null);
    this.members.forEach((m, i) => {
      m.onUploadCallback = () => {
        // (three calls this right after its bufferData / bufferSubData, the member's buffer still bound)
        if (!this.bufs[i] && gl) this.bufs[i] = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
        this.lo[i] = 0; this.hi[i] = 0;
      };
    });
  }
  private installed(): Attr | undefined {
    const n = this.name;
    if (n === 'instanceMatrix') return (this.mesh as InstancedMesh).instanceMatrix;
    if (n === 'instanceColor') return ((this.mesh as InstancedMesh).instanceColor ?? undefined) as Attr | undefined;
    return this.mesh.geometry.attributes[n] as Attr | undefined;
  }
  private install(m: Attr): void {
    const n = this.name;
    if (n === 'instanceMatrix') (this.mesh as InstancedMesh).instanceMatrix = m as InstancedBufferAttribute;
    else if (n === 'instanceColor') (this.mesh as InstancedMesh).instanceColor = m as InstancedBufferAttribute;
    else (this.mesh.geometry as BufferGeometry).setAttribute(n, m);
  }
  /** elements [start, start + count) of the shared array were written: upload them through the next member */
  mark(start: number, count: number): void {
    if (count <= 0) return;
    // (another owner replaced the attribute: this ring no longer draws; leave it)
    if (this.members.indexOf(this.installed() as Attr) < 0) return;
    const end = start + count;
    for (let i = 0; i < this.members.length; i++) {
      if (this.lo[i] >= this.hi[i]) { this.lo[i] = start; this.hi[i] = end; } else { this.lo[i] = Math.min(this.lo[i], start); this.hi[i] = Math.max(this.hi[i], end); }
    }
    if (this.lastFlip !== frame) { this.lastFlip = frame; this.cur = (this.cur + 1) % this.members.length; this.install(this.members[this.cur]); }
    const m = this.members[this.cur];
    m.clearUpdateRanges();
    m.addUpdateRange(this.lo[this.cur], this.hi[this.cur] - this.lo[this.cur]);
    m.needsUpdate = true;
  }
  /** the mesh went: free the members three does not know to free (all but the one installed) */
  free(): void {
    const at = this.installed();
    for (let i = 0; i < this.members.length; i++) {
      if (this.members[i] === at) continue;
      const b = this.bufs[i];
      if (b && gl) gl.deleteBuffer(b);
      this.bufs[i] = null;
      RINGS.delete(this.members[i]);
    }
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
    const r = new Ring(mesh, n, a);
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
