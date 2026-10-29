// VALE HUD — the item tooltip (and the stat lines the shop reuses): name, tier hour-ticks, price,
// stats with units ("+60 Armor", "+25% Attack speed"), passives and the active by name and desc, and
// the sell value. Numbers carry units; at most two sentences per effect come from the record's desc.

import type { JSX } from 'preact';
import type { ItemDefT } from '../../contracts/catalog.ts';
import { useApp } from '../app_ctx.ts';
import type { CatalogView } from '../catalog_view.ts';
import { RichDesc } from '../components/Tooltip.tsx';
import { fmtInt, fmtNum } from '../format.ts';
import { DialMark, GleamGlyph, HOUR_COLOR, itemHour } from './glyphs.tsx';

const PCT = new Set(['crit', 'critDamage', 'lifesteal', 'omnivamp', 'armorPenPct', 'magicPenPct', 'tenacity', 'healShieldPower', 'moveSpeedPct', 'attackSpeed']);

/** "+60 Armor" lines for a stat block */
export function statLines(cv: CatalogView, stats: ItemDefT['stats'] | undefined): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const [k, v] of Object.entries(stats ?? {})) {
    if (typeof v !== 'number' || v === 0) continue;
    const val = PCT.has(k) ? `${fmtNum(Math.round(v * 1000) / 10)}%` : fmtNum(v);
    out.push({ key: k, text: `${v > 0 ? '+' : ''}${val} ${cv.t(`stat.${k}.name`, k)}` });
  }
  return out;
}

export function ItemTip(p: { item: ItemDefT; keyLabel?: string; sell?: boolean; price?: number }): JSX.Element {
  const { cv } = useApp();
  const it = p.item;
  const hour = itemHour(it.tier);
  const lines = statLines(cv, it.stats);
  const sellFor = Math.floor(it.cost * it.sellRatio);
  return (
    <div class="tipx tipx--item">
      <div class="tipx__head">
        <span class="t-h2 tipx__name">{it.name}</span>
        {p.keyLabel ? <span class="keycap">{p.keyLabel}</span> : null}
      </div>
      <div class="tipx__kind t-caption">
        <span class="hourticks" style={{ color: HOUR_COLOR[hour] }}>{Array.from({ length: hour }, () => <i />)}</span>
        <span class="num"><GleamGlyph size={12} /> {fmtInt(p.price ?? it.cost)}</span>
        {it.dial ? <span class="tipx__dial"><DialMark hour={it.dial.hour} size={12} />{cv.t('hud.item.dial', 'Hour {h} on the dial', { h: it.dial.hour })}</span> : null}
      </div>
      {it.dial ? <p class="t-caption tipx__sub">{cv.t('hud.item.dial_rule', 'No other item on the dial may stand within {n} hours of it.', { n: it.dial.apart - 1 })}</p> : null}
      {lines.length ? <ul class="tipx__statlist">{lines.map((l) => <li class="t-body-s num">{l.text}</li>)}</ul> : null}
      {it.passives.map((ps) => <p class="t-body-s tipx__desc"><b>{ps.name}.</b> <RichDesc record={ps} desc={ps.desc} /></p>)}
      {it.active ? <p class="t-body-s tipx__desc"><b>{cv.t('hud.item.active', 'Active')} · {it.active.name}.</b> <RichDesc record={it.active} desc={it.active.desc} /></p> : null}
      {!it.passives.length && !it.active && it.desc ? <p class="t-body-s tipx__desc">{it.desc}</p> : null}
      {p.sell ? <p class="t-caption tipx__hint">{cv.t('hud.item.sell', 'Sell for {n} Gleam', { n: fmtInt(sellFor) })} · {cv.t('hud.shopui.sell_hint', 'Right-click an item to sell it.')}</p> : null}
    </div>
  );
}
