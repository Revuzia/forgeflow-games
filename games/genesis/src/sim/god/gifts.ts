// GENESIS — gifts (CONTRACT.md §11.2, §11.4): food, wood or anything else dropped into a settlement by the hand (or
// sent by a miracle) goes to its store — unless they REFUSE it: a thing their taboos forbid, or a gift from a god they
// fear more than they love, is left outside to rot (and the chronicle says so). Accepted gifts are loved.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import { makeCtx } from '../people/ctx.ts';
import { MEMK } from '../people/defs.ts';
import { dropItem } from '../people/people.ts';
import { storeAdd } from '../people/store.ts';
import { spotInCell } from '../people/world.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { godAct } from './belief.ts';

export interface GiftResult {
  accepted: boolean;
  why: string;
}

/** would this settlement refuse `item` from god `god`? ('' = it accepts) */
export function refusesGift(u: Universe, p: Planet, st: Settlement, item: number, god = 0): string {
  const x = makeCtx(u, p);
  const taboo = (x.rt.producers[item] ?? []).some((k) => st.culture.taboos.includes(k));
  if (taboo) return 'taboo';
  const love = god === 0 ? st.belief : st.faith[god] ?? 0;
  const fear = god === 0 ? st.fearGod : 0;
  if (fear > love + 0.3) return 'fear';
  // the god of their enemies: a settlement devoted to another god will not take this one's gifts
  if (st.god > 0 && st.god !== god && (st.faith[st.god] ?? 0) > love + 0.25) return 'faith';
  return '';
}

/** give `qty` of item to a settlement's store; refused gifts lie outside the settlement to rot */
export function giveTo(u: Universe, p: Planet, st: Settlement, item: number, qty: number, at: ArrayLike<number> | null, god = 0): GiftResult {
  const x = makeCtx(u, p);
  const name = x.c.items.list[item]?.name.toLowerCase() ?? 'thing';
  const why = refusesGift(u, p, st, item, god);
  const members = x.ps.members.get(st.id) ?? [];
  st.gifts++;
  if (why) {
    const spot = spotInCell(p, st.cell, item, 0x91f8, [0, 0, 0]);
    dropItem(x, item, qty, [spot[0], spot[1], spot[2]], p.cellAt(spot), false);
    tell(u, p, 'refusal.gift', vars(x, st, -1, { item: name }), st, [settlementRef(x, st)]);
    for (const m of members) x.A.remember(m, MEMK.refused, u.tick, item);
    godAct(u, p, at ?? st.pos, st.territory + 100, { wonder: 0.05 }, god);
    u.emit({ t: 'gift', planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], a: item, b: 0, text: `refused: ${why}`, ref: settlementRef(x, st), data: { item: x.c.items.list[item]?.id, qty, refused: why } });
    return { accepted: false, why };
  }
  storeAdd(x, st, item, qty);
  for (const m of members) x.A.remember(m, MEMK.gift, u.tick, item);
  tell(u, p, 'gift.accepted', vars(x, st, -1, { item: `${Math.round(qty * 10) / 10} ${name}` }), st, [settlementRef(x, st)], 1);
  godAct(u, p, at ?? st.pos, st.territory + 100, { help: Math.min(0.7, 0.15 + Math.sqrt(qty) * 0.05) }, god);
  u.emit({ t: 'gift', planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], a: item, b: qty, text: 'accepted', ref: settlementRef(x, st), data: { item: x.c.items.list[item]?.id, qty } });
  return { accepted: true, why: '' };
}
