// GENESIS — id allocation for sim entities (weather systems, springs, disasters, agents, settlements, ships, ...).
//
// Ids are small positive integers, monotonically increasing per KIND and never reused (a dead agent's id stays dead,
// so references in memories, chronicle entries and the command log never point at a newcomer). The allocator is part of
// the saved state, so a loaded game continues the same sequence (determinism across save/load).

export type IdKind =
  | 'weather' | 'spring' | 'disaster' | 'agent' | 'animal' | 'herd' | 'settlement' | 'polity' | 'building' | 'ship'
  | 'creature' | 'item' | 'planet' | 'god' | 'projectile' | (string & {});

export class IdAllocator {
  private next: Record<string, number> = {};

  /** a fresh id for `kind` (1-based) */
  alloc(kind: IdKind): number {
    const n = (this.next[kind] ?? 0) + 1;
    this.next[kind] = n;
    return n;
  }

  /** the last id handed out for `kind` (0 = none yet) */
  peek(kind: IdKind): number {
    return this.next[kind] ?? 0;
  }

  /** make sure later allocations for `kind` are above `id` (when importing entities with fixed ids) */
  reserve(kind: IdKind, id: number): void {
    if ((this.next[kind] ?? 0) < id) this.next[kind] = id;
  }

  save(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of Object.keys(this.next).sort()) out[k] = this.next[k];
    return out;
  }

  static load(s: Record<string, number> | undefined): IdAllocator {
    const a = new IdAllocator();
    if (s) for (const k of Object.keys(s).sort()) a.next[k] = s[k] | 0;
    return a;
  }
}
