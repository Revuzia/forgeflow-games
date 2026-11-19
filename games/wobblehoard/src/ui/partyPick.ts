// R10_PLAYUX item 2: the Friends strip's choices, with no DOM (ui/later-party.ts draws them; _harness/probe_party.ts checks them in node).
//   pickOrder       one copy per owned species, in the picker's order: the ones out first (the play squishy first), then the most recently played, the hearted, the newest
//   bringCandidates what "Bring friends" takes out, in that order: never one out, never a second copy of a species that is out
//   bringFriends    take them out until the mat's cap (or its refusal: mat.ts decides, the tier's cap and the frame-time guard)
//   toggleOut       a face tapped in the picker: out -> back to the shelf; on the shelf -> out (or the mat's refusal)
import type { TierName } from '../contracts.ts';
import type { HoardItem } from '../collection/types.ts';
import type { MatItem, MatRefusal } from '../shell/mat.ts';

export interface PartyGame {
  readonly identity: { readonly itemId: string | null };
  readonly mat: { readonly count: number; readonly limit: number; readonly itemIds: readonly string[]; has(id: string | null): boolean; add(item: MatItem): MatRefusal | null; remove(id: string): boolean };
  readonly hoard: { items(): readonly HoardItem[]; item(id: string): HoardItem | null };
  readonly history: { recent(): string[] };
}

/** the mat's refusal in words (hoardEnv's lines, said as the picker says them: "send one back") */
export function refusalLine(r: MatRefusal, limit: number): string {
  switch (r) {
    case 'full': return `${limit} can play at once on this device. Send one back first.`;
    case 'busy': return 'The table is busy enough right now. Send one back first.';
    case 'already': return "It's already out.";
    case 'unsupported': return 'This device shows one squishy at a time.';
    default: return 'That one could not come out. Try another.';
  }
}
export const joinNames = (n: readonly string[]): string => (n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);

const outIds = (g: PartyGame): string[] => { const p = g.identity.itemId; return [...(p ? [p] : []), ...g.mat.itemIds]; };

export function pickOrder(g: PartyGame): HoardItem[] {
  const items = g.hoard.items();
  const byId = new Map(items.map((it) => [it.id, it]));
  const seen = new Set<string>(), out: HoardItem[] = [];
  const add = (it: HoardItem | undefined): void => { if (!it || seen.has(it.species)) return; seen.add(it.species); out.push(it); };
  for (const id of outIds(g)) add(byId.get(id));
  for (const id of g.history.recent()) add(byId.get(id));
  for (const it of items) if (it.fav) add(it);
  for (let i = items.length - 1; i >= 0; i--) add(items[i]);
  return out;
}

export function bringCandidates(g: PartyGame): HoardItem[] {
  const out = new Set(outIds(g)), sp = new Set<string>();
  for (const id of out) { const it = g.hoard.item(id); if (it) sp.add(it.species); }
  return pickOrder(g).filter((it) => !out.has(it.id) && !sp.has(it.species));
}

const matItem = (it: HoardItem): MatItem => ({ genome: it.genome, itemId: it.id, tier: it.tier as TierName, name: it.name });

export function bringFriends(g: PartyGame): { came: string[]; why: MatRefusal | null } {
  const came: string[] = [];
  let why: MatRefusal | null = null;
  for (const it of bringCandidates(g)) {
    if (g.mat.count >= g.mat.limit) break;
    const r = g.mat.add(matItem(it));
    if (r) { why = r; if (r === 'full' || r === 'busy' || r === 'unsupported') break; continue; }
    came.push(it.name);
  }
  if (!came.length && !why && g.mat.count >= g.mat.limit) why = 'full';
  return { came, why };
}

export function toggleOut(g: PartyGame, it: HoardItem): { out: boolean; refused: MatRefusal | null; play: boolean } {
  if (it.id === g.identity.itemId) return { out: true, refused: null, play: true };
  if (g.mat.has(it.id)) { g.mat.remove(it.id); return { out: false, refused: null, play: false }; }
  const r = g.mat.add(matItem(it));
  return { out: !r, refused: r, play: false };
}
