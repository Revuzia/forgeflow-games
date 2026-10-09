// GENESIS — spatial indices on the cell graph (CONTRACT.md §3: grid/spatial.ts): which agents, buildings and items are
// in a cell. Two structures:
//   * CellBuckets: intrusive doubly-linked lists over dense slots (agents) — O(1) move, no allocation.
//   * CellIndex: cell -> ascending id list (buildings, ground items) for sparse things that rarely move.
// Both are TRANSIENT (rebuilt from saved state). Queries return canonical orders (ascending key), so the sim never
// depends on insertion order — a loaded game rebuilds the same answers.

export class CellBuckets {
  head: Int32Array;
  next: Int32Array;
  prev: Int32Array;
  at: Int32Array;

  constructor(cells: number, cap = 0) {
    this.head = new Int32Array(cells).fill(-1);
    this.next = new Int32Array(cap).fill(-1);
    this.prev = new Int32Array(cap).fill(-1);
    this.at = new Int32Array(cap).fill(-1);
  }

  /** make room for slots < cap */
  ensure(cap: number): void {
    if (this.at.length >= cap) return;
    let n = Math.max(8, this.at.length);
    while (n < cap) n *= 2;
    const grow = (a: Int32Array) => { const b = new Int32Array(n).fill(-1); b.set(a); return b; };
    this.next = grow(this.next);
    this.prev = grow(this.prev);
    this.at = grow(this.at);
  }

  clear(): void {
    this.head.fill(-1);
    this.next.fill(-1);
    this.prev.fill(-1);
    this.at.fill(-1);
  }

  /** put slot s into cell (-1 removes it) */
  move(s: number, cell: number): void {
    this.ensure(s + 1);
    const old = this.at[s];
    if (old === cell) return;
    if (old >= 0) {
      const p = this.prev[s], n = this.next[s];
      if (p >= 0) this.next[p] = n; else this.head[old] = n;
      if (n >= 0) this.prev[n] = p;
    }
    this.at[s] = cell;
    this.prev[s] = -1;
    this.next[s] = -1;
    if (cell >= 0) {
      const h = this.head[cell];
      this.next[s] = h;
      if (h >= 0) this.prev[h] = s;
      this.head[cell] = s;
    }
  }

  /** slots in a cell sorted by key(slot) ascending */
  list(cell: number, key: (s: number) => number, out: number[] = []): number[] {
    out.length = 0;
    if (cell < 0 || cell >= this.head.length) return out;
    for (let s = this.head[cell]; s >= 0; s = this.next[s]) out.push(s);
    if (out.length > 1) out.sort((a, b) => key(a) - key(b));
    return out;
  }

  /** any slot in the cell */
  any(cell: number): boolean {
    return cell >= 0 && cell < this.head.length && this.head[cell] >= 0;
  }
}

export class CellIndex {
  private m = new Map<number, number[]>();

  clear(): void {
    this.m.clear();
  }

  add(cell: number, id: number): void {
    let l = this.m.get(cell);
    if (!l) this.m.set(cell, (l = []));
    let i = l.length;
    while (i > 0 && l[i - 1] > id) i--;
    if (l[i - 1] !== id) l.splice(i, 0, id);
  }

  remove(cell: number, id: number): void {
    const l = this.m.get(cell);
    if (!l) return;
    const i = l.indexOf(id);
    if (i >= 0) l.splice(i, 1);
    if (!l.length) this.m.delete(cell);
  }

  /** ids in the cell, ascending (do not mutate) */
  get(cell: number): readonly number[] {
    return this.m.get(cell) ?? EMPTY;
  }
}

const EMPTY: readonly number[] = Object.freeze([]) as readonly number[];
