// VALE HUD — the in-match shop, the Lampwright (CONTRACT §10 HUD "items + gold + in-match shop";
// §5.6 economy). Opens with the shop key or the Gleam button; Esc or the key again closes it.
//   header   title, your Gleam, search, the access line when you cannot shop where you stand
//   left     filters by item tag (from the records' tags: code vocabulary, not content ids)
//   middle   Suggested (by the fighter's ai.style) then every item of the mode's pool by tier, each
//            with its price AFTER the components you own (a client mirror of the sim's quote; the
//            sim decides). Click selects, double-click or right-click buys.
//   right    the selected item: hour-ticks, price, stats, passives and active, builds from (owned
//            parts ticked) and builds into, Buy (chalk CTA; disabled says why), Sell, and your six
//            slots (right-click sells). Undo returns your last purchase while you stay in the shop.

import type { CSSProperties, JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { FighterDefT, ItemDefT } from '../../contracts/catalog.ts';
import type { PlayerView } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import type { CatalogView } from '../catalog_view.ts';
import { RichDesc } from '../components/Tooltip.tsx';
import { fmtInt } from '../format.ts';
import { useHud } from './ctx.ts';
import { GleamGlyph, HOUR_COLOR, ItemGlyph, itemHour } from './glyphs.tsx';
import { statLines } from './itemtip.tsx';

type Tier = ItemDefT['tier'];
type Tag = ItemDefT['tags'][number];
const TIER_ORDER: readonly Tier[] = ['starter', 'consumable', 'boots', 'basic', 'core', 'apex'];
const TIER_LABEL: Record<Tier, string> = { starter: 'Starters', consumable: 'Consumables', boots: 'Boots', basic: 'Basic', core: 'Core', apex: 'Apex' };
const TAG_ORDER: readonly Tag[] = ['attack', 'crit', 'onhit', 'magic', 'haste', 'defense', 'sustain', 'speed', 'support', 'vision', 'utility', 'jungle'];
const TAG_LABEL: Record<Tag, string> = {
  attack: 'Attack', crit: 'Critical', onhit: 'On hit', magic: 'Magic', haste: 'Haste', defense: 'Defense', sustain: 'Sustain',
  speed: 'Speed', support: 'Support', vision: 'Vision', utility: 'Utility', jungle: 'Jungle',
};
/** what each fighter style buys first (bots use the same idea in their build paths) */
const STYLE_TAGS: Record<FighterDefT['ai']['style'], readonly Tag[]> = {
  frontline: ['defense', 'sustain'], warden: ['defense', 'support'], diver: ['attack', 'defense'], skirmisher: ['attack', 'onhit'],
  burst: ['attack', 'magic'], artillery: ['magic', 'haste'], sustain: ['sustain', 'support'], marksman: ['crit', 'attack'],
};
const SLOTS = 6;

export type Denial = 'access' | 'gold' | 'slots' | 'unique' | null;
export interface Quote { price: number; consumes: number[]; why: Denial }

/** a client mirror of the sim's quoteBuy (CONTRACT §5.6): recipe price after owned components */
export function quoteItem(cv: CatalogView, me: PlayerView, item: ItemDefT): Quote {
  const items = me.items;
  const claimed = new Array<boolean>(SLOTS).fill(false);
  const claim = (it: ItemDefT, depth: number): number => {
    if (depth > 8) return 0;
    let value = 0;
    for (const cid of it.components) {
      let k = -1;
      for (let i = 0; i < items.length; i++) if (!claimed[i] && items[i] === cid) { k = i; break; }
      const sub = cv.item(cid);
      if (k >= 0) { claimed[k] = true; value += sub?.cost ?? 0; continue; }
      if (sub) value += claim(sub, depth + 1);
    }
    return value;
  };
  if (item.consumable && items.includes(item.id)) {
    return { price: item.cost, consumes: [], why: !me.canShop ? 'access' : me.gold + 1e-9 < item.cost ? 'gold' : null };
  }
  const price = Math.max(0, item.cost - claim(item, 0));
  const consumes: number[] = [];
  for (let i = 0; i < SLOTS; i++) if (claimed[i]) consumes.push(i);
  const free = consumes.length > 0 || items.slice(0, SLOTS).some((x) => !x) || items.length < SLOTS;
  let why: Denial = null;
  if (!me.canShop) why = 'access';
  else if (!free) why = 'slots';
  else if (item.uniqueGroup && items.some((id, i) => id && !claimed[i] && cv.item(id)?.uniqueGroup === item.uniqueGroup)) why = 'unique';
  else if (me.gold + 1e-9 < price) why = 'gold';
  return { price, consumes, why };
}

export function ShopPanel(): JSX.Element | null {
  const { cv, sound } = useApp();
  const { client, model, shopOpen, key } = useHud();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<Tag | 'all'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const q = cv.queue(client.setup.queue);
  const rules = q ? cv.rulesOf(q) : cv.mode(client.setup.mode)?.rules;
  const pool = rules?.itemPool;
  const items = useMemo(() => cv.c.items.filter((it) => cv.inPool(it.pools, pool)), [pool]);
  const tags = useMemo(() => TAG_ORDER.filter((t) => items.some((it) => it.tags.includes(t))), [items]);
  if (!shopOpen.value) return null;
  model.frame.value;
  const me = model.me;
  if (!me) return null;
  const fighter = cv.fighter(me.fighter);

  const needle = query.trim().toLowerCase();
  const shown = items.filter((it) => (tag === 'all' || it.tags.includes(tag)) && (!needle || it.name.toLowerCase().includes(needle) || statLines(cv, it.stats).some((l) => l.text.toLowerCase().includes(needle))));
  const want = fighter ? STYLE_TAGS[fighter.ai.style] : [];
  const suggested = !needle && tag === 'all'
    ? items.filter((it) => (it.tier === 'core' || it.tier === 'apex' || it.tier === 'boots' || it.tier === 'starter') && it.tags.some((t) => want.includes(t)) && !me.items.includes(it.id))
      .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.cost - b.cost).slice(0, 6)
    : [];
  const selected = cv.item(sel) ?? suggested[0] ?? shown[0];

  const buy = (it: ItemDefT): void => {
    const qt = quoteItem(cv, me, it);
    if (qt.why) { sound.play('error'); model.denied.value = { n: model.denied.peek().n + 1, slot: 'shop', why: qt.why }; return; }
    sound.play('confirm');
    client.send({ type: 'buy', item: it.id });
  };
  const sellSlot = (i: number): void => { if (!me.items[i]) return; sound.play('back'); client.send({ type: 'sell', slot: i }); };

  return (
    <section class="lshop plate plate--raised" role="dialog" aria-label={cv.t('hud.shopui.title', 'Lampwright')} onContextMenu={(e) => e.preventDefault()}>
      <header class="lshop__head">
        <span class="t-h1">{cv.t('hud.shopui.title', 'Lampwright')}</span>
        <span class="lshop__gold num t-num-gold"><GleamGlyph size={16} /> {fmtInt(me.gold)}</span>
        {!me.canShop ? <span class="lshop__access t-caption" role="status">{accessLine(cv, client.setup.mode)}</span> : null}
        <span class="lshop__spacer" />
        <label class="lshop__search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg>
          <input type="search" value={query} placeholder={cv.t('hud.shopui.search', 'Search items')} aria-label={cv.t('hud.shopui.search', 'Search items')}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (query) setQuery(''); else shopOpen.value = false; } }} />
        </label>
        <button type="button" class="hbtn" onClick={() => { shopOpen.value = false; sound.play('back'); }}>{cv.t('hud.shopui.close', 'Close')} <span class="keycap keycap--quiet">{key('shop')}</span></button>
      </header>
      <div class="lshop__body">
        <nav class="lshop__tags" aria-label={cv.t('hud.shopui.filter', 'Filter')}>
          <button type="button" class={`lshop__tag t-label ${tag === 'all' ? 'is-on' : ''}`} aria-pressed={tag === 'all'} onClick={() => setTag('all')}>{cv.t('hud.shopui.all', 'All items')}</button>
          {tags.map((t) => (
            <button type="button" class={`lshop__tag t-label ${tag === t ? 'is-on' : ''}`} aria-pressed={tag === t} onClick={() => { setTag(t); sound.play('tab'); }}>
              {cv.t(`hud.shopui.tag.${t}`, TAG_LABEL[t])}
            </button>
          ))}
        </nav>
        <div class="lshop__grid">
          {suggested.length ? (
            <section class="lshop__sec lshop__sec--suggest">
              <h3 class="lshop__sech t-label">{cv.t('hud.shopui.recommended', 'Suggested')}{fighter ? <span class="t-caption muted"> · {fighter.name}</span> : null}</h3>
              <div class="lshop__tiles">{suggested.map((it) => <Tile it={it} me={me} sel={selected?.id === it.id} onSel={() => setSel(it.id)} onBuy={() => buy(it)} />)}</div>
            </section>
          ) : null}
          {TIER_ORDER.map((tier) => {
            const list = shown.filter((it) => it.tier === tier).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
            if (!list.length) return null;
            const hour = itemHour(tier);
            return (
              <section class="lshop__sec">
                <h3 class="lshop__sech t-label">
                  <span class="hourticks" style={{ color: HOUR_COLOR[hour] }}>{Array.from({ length: hour }, () => <i />)}</span>
                  {cv.t(`hud.shopui.tier.${tier}`, TIER_LABEL[tier])}
                </h3>
                <div class="lshop__tiles">{list.map((it) => <Tile it={it} me={me} sel={selected?.id === it.id} onSel={() => setSel(it.id)} onBuy={() => buy(it)} />)}</div>
              </section>
            );
          })}
          {!shown.length ? <p class="empty empty--compact t-body-s">{cv.t('hud.shopui.none', 'No items match.')}</p> : null}
        </div>
        <aside class="lshop__detail">
          {selected ? <Detail it={selected} me={me} onBuy={() => buy(selected)} onSel={setSel} onSell={sellSlot} /> : null}
          <div class="lshop__inv">
            <span class="t-caption muted">{cv.t('hud.shopui.inventory', 'Your items')} · {cv.t('hud.shopui.sell_hint', 'Right-click an item to sell it.')}</span>
            <div class="lshop__invrow">
              {Array.from({ length: SLOTS }, (_, i) => {
                const it = cv.item(me.items[i]);
                return (
                  <button type="button" class={`islot ${it ? '' : 'is-empty'}`} aria-label={it ? it.name : cv.t('hud.item.empty', 'Empty slot')}
                    onClick={() => { if (it) setSel(it.id); }} onContextMenu={(e) => { e.preventDefault(); sellSlot(i); }}>
                    {it ? <ItemGlyph item={it} src={cv.asset(it.icon)} /> : null}
                  </button>
                );
              })}
            </div>
            <button type="button" class="hbtn lshop__undo" title={cv.t('hud.shopui.undo_hint', 'Undo returns your last purchase for the full price.')}
              onClick={() => { sound.play('back'); client.send({ type: 'undo' }); }}>{cv.t('hud.item.undo', 'Undo purchase')}</button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function accessLine(cv: CatalogView, mode: string): string {
  const k = `announce.shop_denied.access_${mode}`;
  return k in cv.c.strings ? cv.t(k, '') : cv.t('announce.shop_denied.access', 'You can only shop at home.');
}

function Tile(p: { it: ItemDefT; me: PlayerView; sel: boolean; onSel(): void; onBuy(): void }): JSX.Element {
  const { cv } = useApp();
  useHud().model.frame.value;
  const qt = quoteItem(cv, p.me, p.it);
  const owned = p.me.items.filter((x) => x === p.it.id).length;
  return (
    <button type="button" class={`istile ${p.sel ? 'is-selected' : ''} ${qt.why === 'gold' ? 'is-short' : ''} ${qt.why && qt.why !== 'gold' ? 'is-blocked' : ''}`}
      aria-label={`${p.it.name}, ${fmtInt(qt.price)} Gleam`} aria-pressed={p.sel}
      onClick={p.onSel} onDblClick={p.onBuy} onContextMenu={(e) => { e.preventDefault(); p.onSel(); p.onBuy(); }}>
      <ItemGlyph item={p.it} src={cv.asset(p.it.icon)} />
      <span class="istile__price num">{fmtInt(qt.price)}</span>
      {owned ? <span class="istile__owned num" title={cv.t('hud.item.owned', 'Owned')}>{owned > 1 ? `×${owned}` : '✓'}</span> : null}
    </button>
  );
}

function Detail(p: { it: ItemDefT; me: PlayerView; onBuy(): void; onSel(id: string): void; onSell(slot: number): void }): JSX.Element {
  const { cv } = useApp();
  useHud().model.frame.value;
  const it = p.it;
  const qt = quoteItem(cv, p.me, it);
  const hour = itemHour(it.tier);
  const lines = statLines(cv, it.stats);
  const into = cv.c.items.filter((x) => x.components.includes(it.id));
  const ownedAt = p.me.items.findIndex((x) => x === it.id);
  const why = qt.why;
  const whyText = why === 'gold' ? cv.t('hud.shopui.need', 'You need {n} more Gleam.', { n: fmtInt(Math.ceil(qt.price - p.me.gold)) })
    : why === 'slots' ? cv.t('announce.shop_denied.slots', 'Your item slots are full.')
      : why === 'unique' ? cv.t('announce.shop_denied.unique', 'You already carry an item of that kind.')
        : why === 'access' ? cv.t('hud.shopui.away', 'Return to a shop to buy.') : '';
  const owned = new Set<number>();
  return (
    <div class="sdet">
      <div class="sdet__head">
        <ItemGlyph item={it} src={cv.asset(it.icon)} />
        <span class="sdet__titles">
          <span class="t-h2">{it.name}</span>
          <span class="t-caption sdet__kind">
            <span class="hourticks" style={{ color: HOUR_COLOR[hour] }}>{Array.from({ length: hour }, () => <i />)}</span>
            {cv.t(`hud.shopui.tier.${it.tier}`, TIER_LABEL[it.tier])}
            {it.tags.length ? ` · ${it.tags.map((t) => cv.t(`hud.shopui.tag.${t}`, TAG_LABEL[t])).join(', ')}` : ''}
          </span>
        </span>
      </div>
      {lines.length ? <ul class="sdet__stats">{lines.map((l) => <li class="t-body-s num">{l.text}</li>)}</ul> : null}
      {it.passives.map((ps) => <p class="t-body-s sdet__desc"><b>{ps.name}.</b> <RichDesc record={ps} desc={ps.desc} /></p>)}
      {it.active ? <p class="t-body-s sdet__desc"><b>{cv.t('hud.item.active', 'Active')} · {it.active.name}.</b> <RichDesc record={it.active} desc={it.active.desc} /></p> : null}
      {!it.passives.length && !it.active ? <p class="t-body-s sdet__desc muted">{it.desc}</p> : null}
      {it.components.length ? (
        <div class="sdet__tree">
          <span class="t-caption muted">{cv.t('hud.item.builds_from', 'Builds from')}</span>
          <div class="sdet__parts">
            {it.components.map((cid) => {
              const c = cv.item(cid);
              const slot = p.me.items.findIndex((x, i) => x === cid && !owned.has(i));
              if (slot >= 0) owned.add(slot);
              return (
                <button type="button" class={`sdet__part ${slot >= 0 ? 'is-owned' : ''}`} onClick={() => c && p.onSel(c.id)} aria-label={c?.name ?? cid}>
                  <ItemGlyph item={c} src={cv.asset(c?.icon)} />
                  <span class="num t-caption">{slot >= 0 ? '✓' : fmtInt(c?.cost ?? 0)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {into.length ? (
        <div class="sdet__tree">
          <span class="t-caption muted">{cv.t('hud.item.builds_into', 'Builds into')}</span>
          <div class="sdet__parts">
            {into.slice(0, 6).map((c) => (
              <button type="button" class="sdet__part" onClick={() => p.onSel(c.id)} aria-label={c.name}>
                <ItemGlyph item={c} src={cv.asset(c.icon)} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div class="sdet__act">
        <button type="button" class={`hbtn hbtn--chalk sdet__buy ${why ? 'is-disabled' : ''}`} aria-disabled={why ? 'true' : undefined} onClick={p.onBuy}>
          {cv.t('hud.shopui.buy', 'Buy')} <GleamGlyph size={13} /> <span class="num">{fmtInt(qt.price)}</span>
        </button>
        {ownedAt >= 0 ? (
          <button type="button" class="hbtn" onClick={() => p.onSell(ownedAt)}>
            {cv.t('hud.item.sell', 'Sell for {n} Gleam', { n: fmtInt(Math.floor(it.cost * it.sellRatio)) })}
          </button>
        ) : null}
      </div>
      {whyText ? <p class={`t-caption sdet__why ${why === 'gold' ? 'is-gold' : ''}`} style={{ '--c': why === 'gold' ? 'var(--team-enemy)' : 'var(--text-2)' } as CSSProperties}>{whyText}</p> : null}
    </div>
  );
}
