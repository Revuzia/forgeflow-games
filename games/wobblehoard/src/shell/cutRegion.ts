// THE CUT TREE (_spec/CUT2.md 3.3 and 7.2, task S1): which part of the squishy each piece is, as the shell keeps it. Pure: no DOM, no physics, no
// clock, no randomness, no imports but types (it runs under plain node, and _harness/shellview/cut_checks.ts hammers it, row X18).
//
//   * The tree is binary and explicit. The root is the whole squishy (a leaf while nothing is cut). A cut splits ONE LEAF into two kids, side A
//     (+id of the cut plane) and side B (-id). Every live piece is exactly one leaf; its region is exactly ONE convex cell: the literals on the
//     path from the root to it. There are no leaf sets and no unions (the first design let a piece be a set of leaves and needed a union
//     builder, a leaf-count bound and a classifier: none of that exists any more; RT: PF3, PF13).
//   * A join of pieces P and Q takes N = lca(P, Q) and joins EVERY piece under N (twins: just the two). N turns back into a leaf, the SAME
//     node with the SAME literals, whatever happened in between. Joining all the pieces in any order therefore ends at the root.
//   * The planes (RestPlane, in the whole's rest frame W) live in the tree: one per live cut. A plane is dropped when its node becomes a leaf
//     again, and the table, the ids and the cut stack all start over when the squishy is whole. Plane ids start at 1 and are not reused until then
//     (rollbackCut, for a cut that never happened, is the one exception). Planes are floats that are never compared.
//   * `cutStack` is the cut nodes still alive, newest last. A join at N removes every entry under and at N. The top entry always has two LEAF
//     kids (an internal kid's own cut is newer and would sit above it): undoCut is therefore always an exact twin join.
//   * A node that has been joined away (or rolled back) is DEAD: its links are cut, and every function here answers null for it.
import type { PieceRegion, RestPlane, V3 } from '../contracts.ts';

export interface CutNode {
  /** unique inside one tree's life (a counter that starts over when the squishy is whole); the root is 0 */
  readonly id: number;
  /** the signed plane ids from the root to this node: +id = side A of that cut, -id = side B. This IS the node's cell. Never changes. */
  readonly lits: readonly number[];
  /** null for the root and for a dead node */
  parent: CutNode | null;
  /** [side A, side B], or null for a leaf (a live piece, or a dead node) */
  kids: [CutNode, CutNode] | null;
  /** the id of the plane that cut this node into its kids; 0 for a leaf */
  cutId: number;
}

export interface CutTree {
  readonly root: CutNode;
  /** the planes of the live cuts, oldest first (what PieceRegion.planes copies from) */
  readonly planes: RestPlane[];
  /** the cut stack: the internal nodes in the order they were cut, newest last */
  readonly stack: CutNode[];
  /** the next plane id and the next node id */
  nextPlane: number;
  nextNode: number;
}

/** What a join of two pieces brings together (7.2). `members` are the leaves under `node`, side A before side B, depth first. */
export interface Group {
  readonly node: CutNode;
  readonly members: CutNode[];
  /** P and Q are the two kids of `node`: the group is just the two and the cut between them disappears */
  readonly twins: boolean;
}

export function createCutTree(): CutTree {
  return { root: { id: 0, lits: Object.freeze([]) as readonly number[], parent: null, kids: null, cutId: 0 }, planes: [], stack: [], nextPlane: 1, nextNode: 1 };
}

/** nothing is cut */
export const isWhole = (t: CutTree): boolean => t.root.kids === null;
export const isLeaf = (n: CutNode): boolean => n.kids === null;
/** the cut nodes still alive, newest last (the live array: copy it before keeping it) */
export const cutStack = (t: CutTree): readonly CutNode[] => t.stack;

/** `n` is a node of this tree (not dead) */
export function isLive(t: CutTree, n: CutNode): boolean {
  let x = n;
  while (x.parent) {
    const k = x.parent.kids;
    if (!k || (k[0] !== x && k[1] !== x)) return false;
    x = x.parent;
  }
  return x === t.root;
}

/** the leaves under `n` (n itself when it is a leaf), side A before side B, appended to `out` */
export function leavesUnder(n: CutNode, out: CutNode[] = []): CutNode[] {
  if (!n.kids) out.push(n);
  else { leavesUnder(n.kids[0], out); leavesUnder(n.kids[1], out); }
  return out;
}
/** the live pieces */
export const leaves = (t: CutTree, out: CutNode[] = []): CutNode[] => leavesUnder(t.root, out);

/** the plane with this id, or null (the id of a dropped cut) */
export function planeById(t: CutTree, id: number): RestPlane | null {
  for (const p of t.planes) if (p.id === id) return p;
  return null;
}

/** The lowest common ancestor of two nodes of one tree (a node is its own ancestor); null for nodes of different trees or a dead node. */
export function lca(a: CutNode, b: CutNode): CutNode | null {
  let x = a, y = b;
  while (x.lits.length > y.lits.length) { if (!x.parent) return null; x = x.parent; }
  while (y.lits.length > x.lits.length) { if (!y.parent) return null; y = y.parent; }
  while (x !== y) { if (!x.parent || !y.parent) return null; x = x.parent; y = y.parent; }
  return x;
}

/** Cut the live leaf `leaf` by the plane (unit n, d) of the whole's rest frame W (side A: n . p >= d). Allocates the plane id, stores a COPY of the
 *  plane and returns the two kids [side A, side B]. null, and nothing changes, for a node that is not a live leaf or a plane that is not finite. */
export function cutPiece(t: CutTree, leaf: CutNode, n: V3, d: number): [CutNode, CutNode] | null {
  if (leaf.kids !== null || !isLive(t, leaf)) return null;
  if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z) || !Number.isFinite(d)) return null;
  const id = t.nextPlane++;
  t.planes.push({ id, n: { x: n.x, y: n.y, z: n.z }, d });
  const a: CutNode = { id: t.nextNode++, lits: Object.freeze([...leaf.lits, id]) as readonly number[], parent: leaf, kids: null, cutId: 0 };
  const b: CutNode = { id: t.nextNode++, lits: Object.freeze([...leaf.lits, -id]) as readonly number[], parent: leaf, kids: null, cutId: 0 };
  leaf.kids = [a, b];
  leaf.cutId = id;
  t.stack.push(leaf);
  return [a, b];
}

/** Take back the cut that was JUST made at `node` and never took effect (the builder refused it during the neck, 6.3): the two kids are dropped, the
 *  plane id and the node ids are given back, the stack is as it was. false, and nothing changes, unless `node` is the newest cut and its kids are
 *  still leaves. (This is not Undo cut: the player never saw this cut.) */
export function rollbackCut(t: CutTree, node: CutNode): boolean {
  const top = t.stack[t.stack.length - 1], k = node.kids, last = t.planes[t.planes.length - 1];
  if (!top || top !== node || !k || k[0].kids || k[1].kids || !isLive(t, node)) return false;
  if (node.cutId !== t.nextPlane - 1 || !last || last.id !== node.cutId || k[0].id !== t.nextNode - 2 || k[1].id !== t.nextNode - 1) return false;
  t.stack.pop();
  t.planes.pop();
  t.nextPlane--;
  t.nextNode -= 2;
  for (const x of k) { x.parent = null; x.cutId = 0; }
  node.kids = null;
  node.cutId = 0;
  return true;
}

/** The group of two live pieces (7.2): N = lca(P, Q) and every piece under N. `out` receives the members (reused when given). null when P or Q is not a
 *  live leaf. A piece with itself is a group of one (twins false). */
export function group(t: CutTree, p: CutNode, q: CutNode, out: CutNode[] = []): Group | null {
  if (p.kids !== null || q.kids !== null || !isLive(t, p) || !isLive(t, q)) return null;
  const node = lca(p, q);
  if (!node) return null;
  out.length = 0;
  leavesUnder(node, out);
  const k = node.kids;
  return { node, members: out, twins: !!k && p !== q && ((k[0] === p && k[1] === q) || (k[0] === q && k[1] === p)) };
}

/** Join: `node` (a live node with kids, normally group().node) turns back into a leaf, the same node with the same literals. Every cut under and at
 *  it leaves the stack and the plane table; everything under it dies. When `node` is the root the squishy is whole and the ids start over.
 *  Returns `node`, or null (nothing changes) for a leaf or a dead node. */
export function joinGroup(t: CutTree, node: CutNode): CutNode | null {
  if (node.kids === null || !isLive(t, node)) return null;
  const cuts: CutNode[] = [];
  const collect = (n: CutNode): void => { if (n.kids) { cuts.push(n); collect(n.kids[0]); collect(n.kids[1]); } };
  collect(node);
  let w = 0;
  for (const e of t.stack) if (!cuts.includes(e)) t.stack[w++] = e;
  t.stack.length = w;
  w = 0;
  for (const p of t.planes) if (!cuts.some((c) => c.cutId === p.id)) t.planes[w++] = p;
  t.planes.length = w;
  const kill = (n: CutNode): void => { if (n.kids) { kill(n.kids[0]); kill(n.kids[1]); } n.parent = null; n.kids = null; n.cutId = 0; };
  kill(node.kids[0]);
  kill(node.kids[1]);
  node.kids = null;
  node.cutId = 0;
  if (node === t.root) { t.nextPlane = 1; t.nextNode = 1; }
  return node;
}

/** Undo cut (task S5 later): the twin join of the two kids of the newest cut, always exact. Returns the restored leaf, or null when nothing is cut. */
export function undoCut(t: CutTree): CutNode | null {
  const top = t.stack[t.stack.length - 1];
  return top ? joinGroup(t, top) : null;
}

/** A node's cell as the contract's PieceRegion for the physics: ONE cell (the node's literals) and COPIES of the planes it names. Works for a leaf and for
 *  an internal node (the target of a join that is still armed). The root is `{ planes: [], cells: [[]] }`. null for a dead node. */
export function regionOf(t: CutTree, node: CutNode): PieceRegion | null {
  if (!isLive(t, node)) return null;
  const planes: RestPlane[] = [];
  for (const s of node.lits) {
    const p = planeById(t, s < 0 ? -s : s);
    if (!p) return null;
    planes.push({ id: p.id, n: { x: p.n.x, y: p.n.y, z: p.n.z }, d: p.d });
  }
  return { planes, cells: [node.lits.slice()] };
}
