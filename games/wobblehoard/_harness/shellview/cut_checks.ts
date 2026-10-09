// CUT checks of the SHELL lane (CUT2.md section 12; every NEW cut row lives in this file and in _harness/cut_browser.mjs, task S4 / S4-0).
// Plain node, exits 1 on any failure:   node _harness/shellview/cut_checks.ts            (X18 runs 100 000 sequences, the spec's number: about 1 to 5
//                                                                                        minutes, split over 3 worker threads; --workers=1 for one thread)
//                                       node _harness/shellview/cut_checks.ts --seqs=2000  (a quick run, a few seconds)
//
// X18, "cut-tree algebra" (node, cutRegion.ts alone): random operation sequences of cut(piece), join(a, b), undoCut (and the rollback of a cut
// that never took effect), up to 4, 6, 24 and 64 pieces (CUT3: the safety ceiling is 64; the owner removed the limit of 6 on 2026-10-09: RE-SPECIFIED, the sequences with 64 leaves are 1 in 10). After EVERY operation the tree is checked against an INDEPENDENT model: the live pieces as a
// set of path strings ("" = the whole, "AB" = side B of the cut of side A of the first cut; a join of P and Q is "their longest common prefix" and
// takes every piece under it), plus twelve fixed sample points that carry the model's own path and that the real planes route through the tree:
//   * every piece is exactly one leaf, the leaves are exactly the model's pieces, never more than the sequence's bound of live leaves (4, 6, 24 or 64) and 2 L - 1 live nodes for L leaves;
//   * the literals of every node are the path from the root; the plane table is exactly the live cuts; ids are unique;
//   * the cut stack is exactly the internal nodes in cut order, newest last, and its top always has two LEAF kids;
//   * group(P, Q) is the node at the common prefix and its members are exactly the pieces under it; twins iff the group is the two;
//   * a join returns the SAME node with the SAME literals and the SAME region it had as the target of the join (a twin join is the parent's cell
//     literal for literal), removes exactly the stack entries under and at it, kills what was under it, and the sample points inside the group
//     now all lie in that one piece while every other point stays where it was;
//   * undoCut is an exact twin join of the top of the stack; rollbackCut restores the whole state (ids too);
//   * joining the rest of the pieces in a random order always ends at the root, and the root is then a fresh whole (ids start over);
//   * a node that was joined away is dead: every function answers null for it and nothing changes.
// A second row replays EVERY tree shape up to 6 pieces (64 shapes) x EVERY pair of pieces against the same model.
//
// THE ROW MAP of the shell's cut rows (CUT2.md 12 + CUT3.md 5; this file stays the pure tree: no physics, no DOM). Run each with node <file> [--only=section]:
//   X18 / the tree, any count to 64 leaves ........ this file
//   U01 20 presses, both styles, any count ......... shellview/cut_mock_checks.ts (mock bodies); shellview/cutter_checks.ts --only=u01 (real bodies; 20 presses on 12 species, green since the physics lifted its 1/8 clamp)
//   U05 Minis to 24 ................................ cut_mock_checks.ts; cutter_checks.ts --only=u05 (real bodies); cut_browser.mjs --only=u05 (every mini draws both eyes)
//   U07 the meter, the Hoard, the leave paths ...... node_checks.ts (24 pieces); cut_mock_checks.ts; cut_browser.mjs --only=u07 (real stack)
//   X03' eyes on both halves ....................... cutter_checks.ts --only=x03 (--full = 50 species); cut_browser.mjs --only=x03
//   X04 Reconnect all is the original .............. cutter_checks.ts --only=nested; cut_browser.mjs --only=x04
//   X05 leave paths reconnect first ................ cutter_checks.ts --only=x05; browser_shell.mjs --only=cut-real; cut_browser.mjs --only=u07
//   X06 the meter .................................. cutter_checks.ts --only=x06; cut_browser.mjs --only=x04 (leg 1), browser_shell.mjs --only=cut-real (the squeeze)
//   X10 keyboard only .............................. cutter_checks.ts --only=nested / x06 (the lines); browser_shell.mjs --only=cut-x
//   X11 a cut through a feature .................... cutter_checks.ts --only=x11; cut_browser.mjs --only=x11
//   X12 nested cuts ................................ cutter_checks.ts --only=nested; cut_browser.mjs --only=x12
//   X15 the join gesture / the resting gap ......... cutter_checks.ts --only=joins,x15gap; cut_browser.mjs --only=join (REAL drags: a group of 3, the root, 4 pieces); browser_shell.mjs --only=cut-x
//   X19 the scripted parting ....................... cutter_checks.ts --only=parting,slope; cut_browser.mjs --only=level,part
// --full runs the cutter_checks sections on all 50 species (default: the 12 family representatives).
import { createCutTree, cutPiece, cutStack, group, isLeaf, isLive, isWhole, joinGroup, lca, leaves, planeById, regionOf, rollbackCut, undoCut } from '../../src/shell/cutRegion.ts';
import type { CutNode, CutTree } from '../../src/shell/cutRegion.ts';
import type { PieceRegion } from '../../src/contracts.ts';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

let bad = 0, total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };

const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const SEQS = Math.max(1, Number(arg('seqs') ?? 100_000));

/* ───────────────────────── helpers ───────────────────────── */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
interface V { x: number; y: number; z: number }
const unitV = (r: () => number): V => {
  for (;;) { const x = r() * 2 - 1, y = r() * 2 - 1, z = r() * 2 - 1, l = Math.hypot(x, y, z); if (l > 0.1 && l <= 1) return { x: x / l, y: y / l, z: z / l }; }
};
const dotV = (a: V, b: V): number => a.x * b.x + a.y * b.y + a.z * b.z;
const sameArr = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** a node's path from the root by its parent links: "" = root, then A / B per step */
function pathOf(n: CutNode): string {
  let s = '', x = n;
  while (x.parent) { s = (x.parent.kids && x.parent.kids[0] === x ? 'A' : 'B') + s; x = x.parent; }
  return s;
}
function nodeAt(t: CutTree, path: string): CutNode | null {
  let x = t.root;
  for (let i = 0; i < path.length; i++) { if (!x.kids) return null; x = x.kids[path[i] === 'A' ? 0 : 1]; }
  return x;
}
function sameRegion(a: PieceRegion, b: PieceRegion): boolean {
  if (a.cells.length !== b.cells.length || a.planes.length !== b.planes.length) return false;
  for (let i = 0; i < a.cells.length; i++) if (!sameArr(a.cells[i], b.cells[i])) return false;
  for (let i = 0; i < a.planes.length; i++) { const p = a.planes[i], q = b.planes[i]; if (p.id !== q.id || p.d !== q.d || p.n.x !== q.n.x || p.n.y !== q.n.y || p.n.z !== q.n.z) return false; }
  return true;
}
const lcp = (a: string, b: string): string => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return a.slice(0, i); };
/** a canonical string of the WHOLE state of a tree (structure, literals, planes, stack, counters): equal strings = identical state */
function canon(t: CutTree): string {
  const parts: string[] = [];
  const walk = (n: CutNode): void => {
    parts.push(`${n.id}:${n.lits.join(',')}:${n.cutId}:${n.kids ? '2' : '0'}`);
    if (n.kids) { walk(n.kids[0]); walk(n.kids[1]); }
  };
  walk(t.root);
  parts.push('P' + t.planes.map((p) => `${p.id},${p.n.x},${p.n.y},${p.n.z},${p.d}`).join(';'));
  parts.push('S' + t.stack.map((n) => n.id).join(','));
  parts.push(`N${t.nextPlane},${t.nextNode}`);
  return parts.join('|');
}

/* ───────────────────────── the independent model and the full check ───────────────────────── */
interface Model { pieces: string[]; pts: V[]; ptPath: string[] }
const NPTS = 12;
const newModel = (r: () => number): Model => {
  const pts: V[] = [];
  for (let i = 0; i < NPTS; i++) { const u = unitV(r), k = Math.cbrt(r()); pts.push({ x: u.x * k, y: u.y * k, z: u.z * k }); }
  return { pieces: [''], pts, ptPath: pts.map(() => '') };
};
const sorted = (a: readonly string[]): string => [...a].sort().join('|');

/** child.lits = parent.lits + [signed], without allocating */
function extendsBy(child: CutNode, parent: CutNode, signed: number): boolean {
  const c = child.lits, p = parent.lits;
  if (c.length !== p.length + 1 || c[p.length] !== signed) return false;
  for (let i = 0; i < p.length; i++) if (c[i] !== p[i]) return false;
  return true;
}
const planeA = new Float64Array(4096), planeB = new Float64Array(4096), planeC = new Float64Array(4096), planeD = new Float64Array(4096);

/** the whole check of the tree against the model; null = fine, else the first thing that is wrong */
function verify(t: CutTree, m: Model, max: number): string | null {
  const root = t.root;
  if (root.parent !== null || root.id !== 0 || root.lits.length !== 0) return 'the root is not the root';
  const ids = new Set<number>(), cuts: CutNode[] = [], leafNode: CutNode[] = [], leafPath: string[] = [], byPath = new Map<string, CutNode>();
  let nodes = 0, maxId = 0;
  const walk = (n: CutNode, path: string): string | null => {
    nodes++;
    if (ids.has(n.id)) return `node id ${n.id} twice`;
    ids.add(n.id);
    if (n.id > maxId) maxId = n.id;
    if (n.kids === null) {
      if (n.cutId !== 0) return `leaf ${path} has cutId ${n.cutId}`;
      leafNode.push(n); leafPath.push(path); byPath.set(path, n);
      return null;
    }
    if (!(n.cutId >= 1) || n.cutId >= t.nextPlane) return `node ${path || 'root'} has cutId ${n.cutId} (next ${t.nextPlane})`;
    cuts.push(n);
    const [a, b] = n.kids;
    if (a.parent !== n || b.parent !== n) return `kid of ${path || 'root'} has a wrong parent`;
    if (!extendsBy(a, n, n.cutId) || !extendsBy(b, n, -n.cutId)) return `kid literals of ${path || 'root'} are not parent + signed cut id`;
    return walk(a, path + 'A') ?? walk(b, path + 'B');
  };
  const w = walk(root, '');
  if (w) return w;
  // pieces = leaves, bounds
  const L = leafNode.length;
  if (L !== m.pieces.length || byPath.size !== L) return `${L} leaves, the model has ${m.pieces.length} pieces`;
  for (const p of m.pieces) if (!byPath.has(p)) return `the model's piece ${p || 'root'} is not a leaf`;
  if (L > max) return `${L} live leaves, more than ${max}`;
  if (nodes !== 2 * L - 1) return `${nodes} nodes for ${L} leaves`;
  if (nodes > 2 * max - 1) return `${nodes} live nodes, more than ${2 * max - 1}`;
  if (isWhole(t) !== (L === 1)) return 'isWhole disagrees with the leaf count';
  // the plane table is exactly the live cuts
  if (t.planes.length !== cuts.length) return `${t.planes.length} planes for ${cuts.length} live cuts`;
  for (let i = 0; i < t.planes.length; i++) {
    const p = t.planes[i];
    if (i > 0 && !(t.planes[i - 1].id < p.id)) return 'planes are not oldest first';
    if (![p.n.x, p.n.y, p.n.z, p.d].every(Number.isFinite)) return 'a plane is not finite';
    if (!(p.id >= 1 && p.id < 4096)) return 'a plane id is out of range';
    if (!cuts.some((c) => c.cutId === p.id)) return `plane ${p.id} has no live cut`;
    planeA[p.id] = p.n.x; planeB[p.id] = p.n.y; planeC[p.id] = p.n.z; planeD[p.id] = p.d;
  }
  for (let i = 0; i < cuts.length; i++) for (let j = i + 1; j < cuts.length; j++) if (cuts[i].cutId === cuts[j].cutId) return 'a cut id is used twice';
  // the stack is the internal nodes in cut order, newest last; the top has two leaf kids
  if (t.stack.length !== cuts.length || t.stack.some((e) => !cuts.includes(e))) return 'the cut stack is not the live cuts';
  for (let i = 1; i < t.stack.length; i++) if (!(t.stack[i - 1].cutId < t.stack[i].cutId)) return 'the cut stack is not in cut order';
  if (cutStack(t) !== t.stack) return 'cutStack is not the stack';
  const top = t.stack[t.stack.length - 1];
  if (top && (!top.kids || !isLeaf(top.kids[0]) || !isLeaf(top.kids[1]))) return 'the top of the cut stack has an internal kid';
  if (L === 1 && (t.nextPlane !== 1 || t.nextNode !== 1 || t.planes.length || t.stack.length)) return 'whole, but the ids / table / stack did not start over';
  if (t.nextNode <= maxId) return 'nextNode is not above every node id';
  // geometry: the sample points, routed by the real planes through the tree, are where the model says
  for (let i = 0; i < m.pts.length; i++) {
    const p = m.pts[i], want = byPath.get(m.ptPath[i]);
    let x = root;
    while (x.kids) { const c = x.cutId; x = x.kids[planeA[c] * p.x + planeB[c] * p.y + planeC[c] * p.z >= planeD[c] ? 0 : 1]; }
    if (x !== want) return `point ${i} routes to ${pathOf(x) || 'root'}, the model says ${m.ptPath[i] || 'root'}`;
    let inside = 0;
    for (let k = 0; k < L; k++) {
      const lits = leafNode[k].lits;
      let all = true;
      for (let q = 0; q < lits.length; q++) { const s = lits[q], c = s < 0 ? -s : s; if ((planeA[c] * p.x + planeB[c] * p.y + planeC[c] * p.z >= planeD[c]) !== (s > 0)) { all = false; break; } }
      if (all) { inside++; if (leafNode[k] !== want) return `point ${i} lies in the cell ${leafPath[k] || 'root'}, the model says ${m.ptPath[i] || 'root'}`; }
    }
    if (inside !== 1) return `point ${i} lies in ${inside} cells`;
  }
  return null;
}

/* ───────────────────────── operations (tree + model, with the operation's own claims checked) ───────────────────────── */
/** nodes that died, for the refused-call checks (set by runSequence) */
let sink: CutNode[] | null = null;
const stats = { seqs: 0, ops: 0, cuts: 0, twinJoins: 0, groupJoins: 0, rootJoins: 0, undos: 0, rollbacks: 0, invalid: 0, wholes: 0, maxLeaves: 0, maxNodes: 0, drained: 0 };

function doCut(t: CutTree, m: Model, r: () => number, path: string): string | null {
  const node = nodeAt(t, path);
  if (!node) return `no node at ${path}`;
  const n = unitV(r), d = r() * 1.2 - 0.6;
  const kids = cutPiece(t, node, n, d);
  if (!kids) return `cutPiece refused the live leaf ${path || 'root'}`;
  const pl = t.planes[t.planes.length - 1];
  n.x = 9; n.y = 9; n.z = 9;                                    // the table holds a COPY: changing the caller's vector changes nothing
  if (pl.id !== node.cutId || pl.n.x === 9 || kids[0].parent !== node || kids[1].parent !== node) return 'the new plane / kids are wrong';
  if (pathOf(kids[0]) !== path + 'A' || pathOf(kids[1]) !== path + 'B' || t.stack[t.stack.length - 1] !== node) return 'the kids / stack top are wrong';
  if (!sameArr(kids[0].lits, [...node.lits, pl.id]) || !sameArr(kids[1].lits, [...node.lits, -pl.id])) return 'the kids\' literals are wrong';
  m.pieces = m.pieces.filter((x) => x !== path).concat([path + 'A', path + 'B']);
  for (let i = 0; i < m.pts.length; i++) if (m.ptPath[i] === path) m.ptPath[i] = path + (dotV(pl.n, m.pts[i]) >= pl.d ? 'A' : 'B');
  stats.cuts++;
  return null;
}

/** join the pieces at P and Q (both leaf paths in the model) */
function doJoin(t: CutTree, m: Model, P: string, Q: string): string | null {
  const nP = nodeAt(t, P), nQ = nodeAt(t, Q);
  if (!nP || !nQ) return 'a piece has no node';
  const prefix = lcp(P, Q), want = m.pieces.filter((x) => x.startsWith(prefix));
  const g = group(t, nP, nQ), g2 = group(t, nQ, nP);
  if (!g || !g2) return 'group() is null for two live pieces';
  if (pathOf(g.node) !== prefix || g2.node !== g.node) return `group node ${pathOf(g.node) || 'root'} is not the common prefix ${prefix || 'root'}`;
  if (lca(nP, nQ) !== g.node || lca(nQ, nP) !== g.node) return 'lca disagrees with group';
  for (const gm of [g.members, g2.members]) {
    if (gm.length !== want.length) return `group members [${gm.map(pathOf).join(' ')}] are not the pieces under ${prefix || 'root'} [${want.join(' ')}]`;
    for (const x of gm) if (!want.includes(pathOf(x))) return `group member ${pathOf(x)} is not under ${prefix || 'root'}`;
  }
  if (g.twins !== (want.length === 2)) return 'twins disagrees with the group size';
  if (g.members.some((x) => !isLeaf(x))) return 'a group member is not a leaf';
  const node = g.node, litsBefore = node.lits.slice(), regBefore = regionOf(t, node);
  if (!regBefore || regBefore.cells.length !== 1 || !sameArr(regBefore.cells[0], litsBefore) || regBefore.planes.length !== litsBefore.length) return 'the join target\'s region is not its one cell';
  const stackBefore = t.stack.slice(), keep = stackBefore.filter((e) => !pathOf(e).startsWith(prefix));
  const keepPaths = keep.map(pathOf);
  const kidsBefore = node.kids as [CutNode, CutNode];
  const rootJoin = prefix === '';
  const dropped: number[] = [];
  const gather = (x: CutNode): void => { if (x.kids) { dropped.push(x.cutId); gather(x.kids[0]); gather(x.kids[1]); } };
  gather(node);
  const res = joinGroup(t, node);
  if (res !== node || node.kids !== null || node.cutId !== 0) return 'joinGroup did not turn the node back into a leaf';
  if (!sameArr(node.lits, litsBefore)) return 'the merged piece\'s literals changed';
  if (t.stack.length !== keep.length || t.stack.some((e, i) => e !== keep[i]) || t.stack.map(pathOf).join('|') !== keepPaths.join('|')) return 'the stack is not "before, less everything under and at the node"';
  for (const mem of g.members) if (isLive(t, mem) || group(t, mem, node) !== null || cutPiece(t, mem, { x: 1, y: 0, z: 0 }, 0) !== null) return 'a joined-away piece is not dead';
  if (isLive(t, kidsBefore[0]) || isLive(t, kidsBefore[1])) return 'a kid of the merged node is still live';
  const regAfter = regionOf(t, node);
  if (!regAfter || JSON.stringify(regAfter) !== JSON.stringify(regBefore)) return 'the merged piece\'s region is not the region of the join target';
  for (const p of regAfter.planes) if (dropped.includes(p.id)) return 'a dropped plane is still in the region';
  for (const id of dropped) if (planeById(t, id)) return 'a dropped plane is still in the table';
  if (sink) { for (const x of g.members) sink.push(x); sink.push(kidsBefore[0], kidsBefore[1]); while (sink.length > 24) sink.shift(); }
  m.pieces = m.pieces.filter((x) => !x.startsWith(prefix)).concat([prefix]);
  for (let i = 0; i < m.pts.length; i++) if (m.ptPath[i].startsWith(prefix)) m.ptPath[i] = prefix;
  if (rootJoin) stats.rootJoins++;
  if (want.length === 2) stats.twinJoins++; else stats.groupJoins++;
  return null;
}

function doUndo(t: CutTree, m: Model): string | null {
  const top = t.stack[t.stack.length - 1];
  if (!top) {
    if (undoCut(t) !== null || !isWhole(t) || t.planes.length || t.stack.length) return 'undoCut on a whole squishy did something';
    return null;
  }
  const prefix = pathOf(top), lits = top.lits.slice(), rest = t.stack.slice(0, -1);
  if (!top.kids || !isLeaf(top.kids[0]) || !isLeaf(top.kids[1])) return 'the top of the stack has an internal kid';
  const res = undoCut(t);
  if (res !== top || top.kids !== null || !sameArr(top.lits, lits)) return 'undoCut did not restore the same node';
  if (t.stack.length !== rest.length || t.stack.some((e, i) => e !== rest[i])) return 'undoCut removed more or less than the top entry';
  m.pieces = m.pieces.filter((x) => x !== prefix + 'A' && x !== prefix + 'B').concat([prefix]);
  for (let i = 0; i < m.pts.length; i++) if (m.ptPath[i].startsWith(prefix)) m.ptPath[i] = prefix;
  stats.undos++;
  return null;
}

function doRollback(t: CutTree, m: Model, r: () => number, path: string): string | null {
  const before = canon(t), node = nodeAt(t, path);
  if (!node) return 'no node';
  const kids = cutPiece(t, node, unitV(r), r() * 1.2 - 0.6);
  if (!kids) return 'cutPiece refused (rollback test)';
  // an older cut, a kid and a stranger cannot be rolled back; the state does not change
  const mid = canon(t);
  for (const other of [kids[0], ...t.stack.slice(0, -1)]) if (rollbackCut(t, other) || canon(t) !== mid) return 'rollbackCut accepted a node that is not the newest cut';
  if (!rollbackCut(t, node)) return 'rollbackCut refused the newest cut';
  if (canon(t) !== before) return 'rollbackCut did not restore the whole state';
  if (isLive(t, kids[0]) || isLive(t, kids[1])) return 'a rolled-back kid is still live';
  if (rollbackCut(t, node)) return 'rollbackCut twice';
  stats.rollbacks++;
  return null;
}

/** things that must be refused / answered with null, and must change nothing */
function doInvalid(t: CutTree, graveyard: CutNode[], r: () => number): string | null {
  const before = canon(t), other = createCutTree();
  const internal = t.stack.length ? t.stack[Math.floor(r() * t.stack.length)] : null;
  const dead = graveyard.length ? graveyard[Math.floor(r() * graveyard.length)] : null;
  const live = leaves(t)[0];
  const refused: Array<[string, unknown]> = [
    ['cutPiece on a node of another tree', cutPiece(t, other.root, { x: 1, y: 0, z: 0 }, 0)],
    ['cutPiece with a NaN plane', cutPiece(t, live, { x: NaN, y: 0, z: 0 }, 0)],
    ['cutPiece with an infinite offset', cutPiece(t, live, { x: 1, y: 0, z: 0 }, Infinity)],
    ['joinGroup of a leaf', joinGroup(t, live)],
    ['group with a node of another tree', group(t, live, other.root)],
    ['lca of nodes of two trees', lca(live, other.root)],
    ['regionOf a node of another tree', regionOf(t, other.root)],
    ['rollbackCut of a leaf', rollbackCut(t, live) ? 'accepted' : null],
  ];
  if (internal) refused.push(['cutPiece on an internal node', cutPiece(t, internal, { x: 1, y: 0, z: 0 }, 0)], ['group with an internal node', group(t, internal, live)]);
  if (dead) refused.push(['cutPiece on a dead node', cutPiece(t, dead, { x: 1, y: 0, z: 0 }, 0)], ['joinGroup of a dead node', joinGroup(t, dead)], ['group with a dead node', group(t, dead, live)],
    ['regionOf a dead node', regionOf(t, dead)], ['lca with a dead node', lca(dead, live)], ['rollbackCut of a dead node', rollbackCut(t, dead) ? 'accepted' : null]);
  for (const [what, v] of refused) if (v !== null) return `${what} was not refused`;
  if (canon(t) !== before) return 'a refused call changed the tree';
  stats.invalid++;
  return null;
}

/* ───────────────────────── one random sequence ───────────────────────── */
function runSequence(seed: number, log?: string[]): string | null {
  const r = rng(seed), k10 = seed % 10, max = k10 === 7 ? 64 : k10 === 3 ? 24 : seed % 3 === 0 ? 4 : 6;      // RE-SPECIFIED 2026-10-09: the bound is 4, 6, 24 or 64 leaves (the safety ceiling), 1 sequence in 10 grows to 64
  const big = max >= 24;
  const t = createCutTree(), m = newModel(r), graveyard: CutNode[] = [];
  sink = graveyard;
  const say = (s: string): void => { log?.push(s); };
  const fail = (what: string, why: string): string => `${what}: ${why}`;
  const step = (what: string, f: () => string | null): string | null => {
    stats.ops++;
    say(what);
    const wasWhole = isWhole(t);
    const e = f() ?? verify(t, m, max);
    if (!e) {
      if (!wasWhole && isWhole(t)) stats.wholes++;
      const L = m.pieces.length; if (L > stats.maxLeaves) stats.maxLeaves = L;
      if (2 * L - 1 > stats.maxNodes) stats.maxNodes = 2 * L - 1;
    }
    return e ? fail(what, e) : null;
  };
  const e0 = verify(t, m, max);
  if (e0) return fail('start', e0);
  const nOps = big ? 2 * max + Math.floor(r() * 3 * max) : 4 + Math.floor(r() * 36);
  for (let i = 0; i < nOps; i++) {
    const grow = big && i < nOps * 0.5;   // the big trees first grow (cuts, with undo / rollback / refused calls but no join, which would swallow the tree at the root), then churn
    const rawPick = r(), pick = grow ? (rawPick < 0.94 ? rawPick * 0.38 : 0.76 + (rawPick - 0.94) * 3.3) : rawPick, L = m.pieces.length;
    let e: string | null;
    if (pick < 0.36 && L < max) { const P = m.pieces[Math.floor(r() * L)]; e = step(`cut ${P || 'root'}`, () => doCut(t, m, r, P)); }
    else if (pick < 0.74 && L >= 2) {
      const a = Math.floor(r() * L); let b = Math.floor(r() * (L - 1)); if (b >= a) b++;
      const P = m.pieces[a], Q = m.pieces[b];
      e = step(`join ${P || 'root'} ${Q || 'root'}`, () => doJoin(t, m, P, Q));
    }
    else if (pick < 0.84) e = step('undo', () => doUndo(t, m));
    else if (pick < 0.90 && L < max) { const P = m.pieces[Math.floor(r() * L)]; e = step(`rollback ${P || 'root'}`, () => doRollback(t, m, r, P)); }
    else if (pick < 0.96) e = step('invalid', () => doInvalid(t, graveyard, r));
    else if (L < max) { const P = m.pieces[Math.floor(r() * L)]; e = step(`cut ${P || 'root'}`, () => doCut(t, m, r, P)); }
    else e = step('undo', () => doUndo(t, m));
    if (e) return e;
  }
  // "joining all pieces in any order ends at the root"
  while (m.pieces.length > 1) {
    const L = m.pieces.length, a = Math.floor(r() * L); let b = Math.floor(r() * (L - 1)); if (b >= a) b++;
    const P = m.pieces[a], Q = m.pieces[b];
    const e = step(`drain ${P || 'root'} ${Q || 'root'}`, () => doJoin(t, m, P, Q));
    if (e) return e;
  }
  stats.drained++;
  if (!isWhole(t) || t.root.kids !== null || leaves(t).length !== 1 || leaves(t)[0] !== t.root || t.planes.length || t.stack.length || t.nextPlane !== 1 || t.nextNode !== 1) return fail('end', 'all joined did not end at a fresh root');
  const reg = regionOf(t, t.root);
  if (!reg || reg.cells.length !== 1 || reg.cells[0].length !== 0 || reg.planes.length !== 0) return fail('end', 'the whole\'s region is not { planes: [], cells: [[]] }');
  return null;
}

const seedOf = (i: number): number => (Math.imul(i + 1, 0x9e3779b1) ^ 0x1badf00d) >>> 0;
type Stats = typeof stats;
interface Fail { seed: number; msg: string }
/** run the sequences [from, to) in this thread; stops after 3 failures */
function runRange(from: number, to: number): { stats: Stats; failures: Fail[] } {
  const failures: Fail[] = [];
  for (let i = from; i < to; i++) {
    stats.seqs++;
    const e = runSequence(seedOf(i));
    if (e) { failures.push({ seed: seedOf(i), msg: e }); if (failures.length >= 3) break; }
  }
  return { stats, failures };
}

// a worker thread runs one slice of X18 and reports back; everything from `main` on belongs to the main thread
if (!isMainThread) {
  const w = workerData as { from: number; to: number };
  parentPort!.postMessage(runRange(w.from, w.to));
} else await main();

async function main(): Promise<void> {
/* ───────────────────────── unit rows (the worked examples of CUT2.md 7.2 and the API's edges) ───────────────────────── */
{
  const t = createCutTree();
  const reg = regionOf(t, t.root);
  check('tree: a fresh tree is whole: one leaf (the root), no planes, no cuts, region { planes: [], cells: [[]] }',
    isWhole(t) && isLeaf(t.root) && leaves(t).length === 1 && t.planes.length === 0 && cutStack(t).length === 0 && !!reg && reg.cells.length === 1 && reg.cells[0].length === 0 && reg.planes.length === 0 && undoCut(t) === null && joinGroup(t, t.root) === null);
  const k = cutPiece(t, t.root, { x: 1, y: 0, z: 0 }, 0.25)!;
  check('tree: a cut splits the one leaf into side A (+1) and side B (-1); the table holds the plane; the root is on the stack; ids 1 and 2 are next',
    !!k && sameArr(k[0].lits, [1]) && sameArr(k[1].lits, [-1]) && t.root.cutId === 1 && cutStack(t)[0] === t.root && t.planes.length === 1 && t.planes[0].d === 0.25 && t.nextPlane === 2 && !isWhole(t) && leaves(t).length === 2 && leaves(t)[0] === k[0]);
  // 7.2: after a cut into A and B and a second cut of B into B1 and B2: B1 + B2 gives B; A + B1 gives A, B1 and B2, which is the whole
  const [A, B] = k;
  const [B1, B2] = cutPiece(t, B, { x: 0, y: 1, z: 0 }, 0)!;
  const gt = group(t, B1, B2)!, gn = group(t, A, B1)!;
  check('tree 7.2: twins (B1, B2) -> the group is the two and the node is B; (A, B1) -> A, B1 and B2 and the node is the root; the cut stack is [root, B]',
    gt.node === B && gt.twins && gt.members.length === 2 && gn.node === t.root && !gn.twins && gn.members.length === 3 && gn.members[0] === A && cutStack(t).length === 2 && cutStack(t)[0] === t.root && cutStack(t)[1] === B);
  const regB = regionOf(t, B)!, regB1 = regionOf(t, B1)!;
  check('tree: regionOf is ONE cell of the literals with copies of exactly the planes it names (B1 = -1, +2 names planes 1 and 2; B = -1 names plane 1); the internal node B has a region too',
    regB1.cells.length === 1 && sameArr(regB1.cells[0], [-1, 2]) && regB1.planes.map((p) => p.id).join() === '1,2' && sameArr(regB.cells[0], [-1]) && regB.planes.length === 1 && regB.planes[0].id === 1);
  regB1.planes[0].n.x = 42; regB1.cells[0].push(7);
  check('tree: the region is a COPY: changing it changes nothing in the tree', t.planes[0].n.x === 1 && sameArr(B1.lits, [-1, 2]));
  check('tree: undoCut joins the two kids of the top of the cut stack (B1 + B2): the same node B, one entry fewer, plane 2 dropped; the next cut gets id 3 (ids are not reused)',
    undoCut(t) === B && B.kids === null && cutStack(t).length === 1 && t.planes.length === 1 && t.nextPlane === 3 && !isLive(t, B1) && !isLive(t, B2) && cutPiece(t, B1, { x: 1, y: 0, z: 0 }, 0) === null);
  const canon0 = canon(t);
  check('tree: after that undo the top of the stack (the first cut) is NOT the newest cut id, so rollbackCut says false and changes nothing', rollbackCut(t, t.root) === false && canon(t) === canon0);
  const [B3] = cutPiece(t, B, { x: 0, y: 0, z: 1 }, 0)!;
  check('tree: after that undo the next cut has plane id 3 and its kid\'s literals are [-1, 3]', sameArr(B3.lits, [-1, 3]) && t.planes.map((p) => p.id).join() === '1,3');
  const g = group(t, A, B3)!;
  check('tree: joinGroup at the root (the group of A and B3 swallows everything) ends whole: the root is a leaf again, planes and stack empty, ids start over',
    g.node === t.root && g.members.length === 3 && joinGroup(t, g.node) === t.root && isWhole(t) && t.planes.length === 0 && cutStack(t).length === 0 && t.nextPlane === 1 && t.nextNode === 1 && !isLive(t, A) && !isLive(t, B));
  const k2 = cutPiece(t, t.root, { x: 0, y: 0, z: 1 }, 0.1)!;
  check('tree: the next cut after being whole starts over (plane 1, node ids 1 and 2)', sameArr(k2[0].lits, [1]) && k2[0].id === 1 && k2[1].id === 2 && t.planes[0].id === 1);
  check('tree: rollbackCut takes back the cut that never took effect and gives the ids back; a second call and a call for a node that is not the newest cut say false',
    rollbackCut(t, t.root) === true && isWhole(t) && t.nextPlane === 1 && t.nextNode === 1 && t.planes.length === 0 && cutStack(t).length === 0 && rollbackCut(t, t.root) === false);
}

/* ───────────────────────── X18: random sequences ───────────────────────── */
{
  const t0 = performance.now();
  const W = Math.max(1, Math.min(Number(arg('workers') ?? 3), Math.max(1, Math.floor(availableParallelism() / 2)), Math.floor(SEQS / 1000) || 1));
  const failures: Fail[] = [];
  if (W === 1) failures.push(...runRange(0, SEQS).failures);
  else {
    const parts = await Promise.all(Array.from({ length: W }, (_, k) => new Promise<{ stats: Stats; failures: Fail[] }>((res, rej) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { from: Math.floor(SEQS * k / W), to: Math.floor(SEQS * (k + 1) / W) } });
      w.once('message', res);
      w.once('error', rej);
      w.once('exit', (c) => { if (c !== 0) rej(new Error(`worker exited with ${c}`)); });
    })));
    for (const part of parts) {
      for (const key of Object.keys(stats) as Array<keyof Stats>) {
        if (key === 'maxLeaves' || key === 'maxNodes') stats[key] = Math.max(stats[key], part.stats[key]);
        else stats[key] += part.stats[key];
      }
      failures.push(...part.failures);
    }
  }
  const secs = (performance.now() - t0) / 1000;
  const seen = { ...stats };
  for (const f of failures.slice(0, 3)) {
    const log: string[] = [];
    runSequence(f.seed, log);
    console.log(`  seed ${f.seed}: ${f.msg}\n    ops: ${log.join(' ; ')}`);
  }
  Object.assign(stats, seen);
  check(`X18: ${stats.seqs} random sequences of cut / join / undoCut / rollback / refused calls (up to 4, 6, 24 and 64 pieces), the whole tree checked against the independent model after every one of ${stats.ops} operations: no failure`,
    failures.length === 0 && stats.seqs === SEQS,
    `${secs.toFixed(1)} s on ${W} thread${W > 1 ? 's' : ''}; cuts ${stats.cuts}, twin joins ${stats.twinJoins}, group joins ${stats.groupJoins} (of which to the root ${stats.rootJoins}), undos ${stats.undos}, rollbacks ${stats.rollbacks}, refused calls ${stats.invalid}, whole again mid-sequence ${stats.wholes}, drained to the root ${stats.drained}, most leaves ${stats.maxLeaves}, most nodes ${stats.maxNodes}`);
  check('X18 bounds (RE-SPECIFIED 2026-10-09, no limit of 6): never more than the sequence bound of live leaves (4, 6, 24, 64) and 2 L - 1 nodes (checked on every operation above); the counters show the 64-leaf ceiling was reached: 64 leaves, 127 nodes', stats.maxLeaves === 64 && stats.maxNodes === 127, `max leaves ${stats.maxLeaves}, max nodes ${stats.maxNodes}`);
  check('X18 coverage: every kind of join happened (twin, group of 3 or more, to the root, mid-sequence whole again), undo, rollback and refusals each many times',
    stats.twinJoins > SEQS && stats.groupJoins > SEQS && stats.rootJoins >= SEQS && stats.wholes >= SEQS / 2 && stats.undos > SEQS / 4 && stats.rollbacks > SEQS / 8 && stats.invalid > SEQS / 4,
    `twin ${stats.twinJoins}, group ${stats.groupJoins}, root ${stats.rootJoins}, wholes ${stats.wholes}, undos ${stats.undos}, rollbacks ${stats.rollbacks}, refused ${stats.invalid}`);
}

/* ───────────────────────── X18: every tree shape up to 6 pieces x every pair ───────────────────────── */
{
  const shapes: string[][][] = [[['']]];                       // shapes[L-1] = every shape with L leaves, as leaf-path lists
  for (let L = 2; L <= 6; L++) {
    const out: string[][] = [];
    for (let k = 1; k < L; k++) for (const a of shapes[k - 1]) for (const b of shapes[L - k - 1]) out.push([...a.map((p) => 'A' + p), ...b.map((p) => 'B' + p)]);
    shapes.push(out);
  }
  const counts = shapes.map((s) => s.length);
  let pairs = 0, fails = 0, first = '';
  for (const list of shapes) for (const leafPaths of list) {
    const L = leafPaths.length;
    for (let i = 0; i < L; i++) for (let j = i + 1; j < L; j++) {
      const r = rng(1000 + pairs), t = createCutTree(), m = newModel(r);
      // build the shape by cutting every internal path, shortest first (the cut stack order is then breadth first)
      const internal = new Set<string>();
      for (const p of leafPaths) for (let k = 0; k < p.length; k++) internal.add(p.slice(0, k));
      let e: string | null = null;
      for (const p of [...internal].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))) { e = doCut(t, m, r, p); if (e) break; }
      e = e ?? verify(t, m, 6);
      if (!e && sorted(m.pieces) !== sorted(leafPaths)) e = 'the built shape is not the requested one';
      e = e ?? doJoin(t, m, leafPaths[i], leafPaths[j]) ?? verify(t, m, 6);
      while (!e && m.pieces.length > 1) { const a = Math.floor(r() * m.pieces.length); let b = Math.floor(r() * (m.pieces.length - 1)); if (b >= a) b++; e = doJoin(t, m, m.pieces[a], m.pieces[b]) ?? verify(t, m, 6); }
      if (!e && !(isWhole(t) && t.nextPlane === 1)) e = 'did not end whole';
      pairs++;
      if (e) { fails++; if (!first) first = `${leafPaths.join(',')} pair ${leafPaths[i]},${leafPaths[j]}: ${e}`; }
    }
  }
  check(`X18 exhaustive: all ${counts.reduce((s, c) => s + c, 0)} tree shapes up to 6 pieces (${counts.join(', ')} with 1 to 6 pieces) x every pair of pieces (${pairs}): group, join, region, stack and "drain to the root" all agree with the model`,
    fails === 0 && counts.join() === '1,1,2,5,14,42', fails ? first : '');
}

console.log(`\n${total - bad}/${total} cut checks passed`);
process.exit(bad ? 1 : 0);
}
