// PARTY probe (R10_PLAYUX item 2; owner 2026-11-19: "there needs to be an easier way to take out squishies for them to play together"): the Friends strip's
// choices (src/ui/partyPick.ts) on a mat with mat.ts's own refusals ('full' at the cap, 'already'), no DOM. The browser half is _harness/browser_party.mjs.
// Usage: node _harness/probe_party.ts   (exits 1 on a failure)
import type { HoardItem } from '../src/collection/types.ts';
import type { MatItem, MatRefusal } from '../src/shell/mat.ts';
import { bringCandidates, bringFriends, joinNames, pickOrder, refusalLine, toggleOut } from '../src/ui/partyPick.ts';
import type { PartyGame } from '../src/ui/partyPick.ts';

let bad = 0, total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const item = (id: string, species: string, fav = false): HoardItem => ({ id, species, name: species[0].toUpperCase() + species.slice(1), fav, genome: {}, tier: 'common' } as unknown as HoardItem);
/** a party game: the play squishy, the shelf (oldest first), the recently played (newest first), the mat's cap */
function world(o: { play: string; items: HoardItem[]; recent: string[]; limit: number; busyAfter?: number }): PartyGame & { added: string[] } {
  const out: string[] = [];
  const added: string[] = [];
  const g = {
    added,
    identity: { itemId: o.play },
    hoard: { items: () => o.items, item: (id: string) => o.items.find((x) => x.id === id) ?? null },
    history: { recent: () => o.recent },
    mat: {
      get count() { return 1 + out.length; },
      get limit() { return o.limit; },
      get itemIds() { return out; },
      has: (id: string | null) => !!id && out.includes(id),
      add(it: MatItem): MatRefusal | null {
        if (it.itemId && (out.includes(it.itemId) || it.itemId === o.play)) return 'already';
        if (1 + out.length >= o.limit) return 'full';
        if (o.busyAfter !== undefined && out.length >= o.busyAfter) return 'busy';
        out.push(it.itemId!); added.push(it.itemId!); return null;
      },
      remove(id: string): boolean { const i = out.indexOf(id); if (i < 0) return false; out.splice(i, 1); return true; },
    },
  };
  return g;
}
const shelf = [item('d1', 'dollop'), item('c1', 'crimpo'), item('c2', 'crimpo'), item('p1', 'capnap', true), item('g1', 'glimglop'), item('w1', 'wisplet'), item('t1', 'taffelin')];

// P1 the picker's order: one per species; the play squishy first, then the recently played, the hearted, the newest
{
  const g = world({ play: 'd1', items: shelf, recent: ['d1', 'g1', 'c1'], limit: 5 });
  const ord = pickOrder(g).map((x) => x.id);
  check('P1 the picker lists one face per owned species: the one you play with first, then the most recently played, the hearted, the newest (a second copy of a species is not a second face)',
    ord.join() === 'd1,g1,c1,p1,t1,w1', ord.join());
}
// P2 Bring friends fills to the cap with the most recently played first
{
  const g = world({ play: 'd1', items: shelf, recent: ['d1', 'g1', 'c1'], limit: 3 });
  const r = bringFriends(g);
  check('P2 "Bring friends" at the low tier (cap 3) takes out the two played with most recently (Glimglop, Crimpo) and stops at the cap', r.came.join() === 'Glimglop,Crimpo' && g.mat.count === 3 && r.why === null, JSON.stringify(r));
  const r2 = bringFriends(g);
  check('P2 at the cap "Bring friends" brings nobody and says why (the mat\'s "full", in words: "3 can play at once on this device. Send one back first.")', r2.came.length === 0 && r2.why === 'full' && refusalLine(r2.why, 3) === '3 can play at once on this device. Send one back first.', JSON.stringify(r2));
  const g5 = world({ play: 'd1', items: shelf, recent: ['d1'], limit: 5 });
  const r5 = bringFriends(g5);
  check('P2 on high (cap 5) with nothing played lately: the hearted first (Capnap), then the newest; never a second Crimpo', r5.came.join() === 'Capnap,Taffelin,Wisplet,Glimglop' && g5.mat.count === 5, JSON.stringify(r5));
  check('P2 the names are said as one line ("Capnap, Taffelin, Wisplet and Glimglop came out to play.")', `${joinNames(r5.came)} came out to play.` === 'Capnap, Taffelin, Wisplet and Glimglop came out to play.');
}
// P3 a face tapped: out / back / the one you play with / the cap / the frame-time guard
{
  const g = world({ play: 'd1', items: shelf, recent: ['d1'], limit: 3 });
  const a = toggleOut(g, shelf[1]), b = toggleOut(g, shelf[3]), c = toggleOut(g, shelf[4]);
  check('P3 a face on the shelf comes out; at the cap (3) the next is refused by the mat ("full"), never a silent no-op', a.out && b.out && !c.out && c.refused === 'full' && g.mat.count === 3, JSON.stringify({ a, b, c }));
  const d = toggleOut(g, shelf[1]);
  check('P3 a face that is out, tapped, goes back to the shelf (and the room is free again)', !d.out && d.refused === null && g.mat.count === 2 && !g.mat.has('c1'));
  const e = toggleOut(g, shelf[0]);
  check('P3 the one you play with stays out (a tap only says so)', e.play && e.out && g.mat.count === 2);
  const gb = world({ play: 'd1', items: shelf, recent: ['d1'], limit: 5, busyAfter: 1 });
  const r = bringFriends(gb);
  check('P3 the frame-time guard (mat "busy") stops "Bring friends" with its words', r.came.length === 1 && r.why === 'busy' && /busy enough/.test(refusalLine('busy', 5)), JSON.stringify(r));
}
// P4 candidates never repeat a species that is out (a Crimpo out: the other Crimpo is not brought)
{
  const g = world({ play: 'd1', items: shelf, recent: ['c2', 'd1'], limit: 5 });
  toggleOut(g, shelf[1]);
  const c = bringCandidates(g).map((x) => x.species);
  check('P4 with a Crimpo out, Bring friends never brings the second Crimpo, nor the play squishy\'s species', !c.includes('crimpo') && !c.includes('dollop') && c.length === 4, c.join());
}
console.log(`\n${total - bad}/${total} party checks passed`);
process.exit(bad ? 1 : 0);
