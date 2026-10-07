// VALE UI — currency amount: glyph + Mono tabular number. When the amount changes it ticks up (or
// down) over the reward duration (1200 ms, ease-out) with a rate-limited ui_currency_tick.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import { fmtInt } from '../format.ts';
import { dur, tween } from '../motion.ts';
import { CandleGlyph, PrismGlyph } from './Glyphs.tsx';
import { AssetImg } from './Portrait.tsx';

export function CurrencyGlyph(p: { id: string; size?: number }): JSX.Element {
  const { cv } = useApp();
  const c = cv.currency(p.id);
  const earned = c?.earnedOnly ?? true;
  const fallback = earned ? <CandleGlyph size={p.size ?? 18} class="cur__glyph cur__glyph--earned" /> : <PrismGlyph size={p.size ?? 18} class="cur__glyph cur__glyph--premium" />;
  return <AssetImg src={cv.asset(c?.icon)} class="cur__img" style={{ width: `calc(${p.size ?? 18}px * var(--k))`, height: `calc(${p.size ?? 18}px * var(--k))` }} fallback={fallback} alt="" />;
}

export function Currency(p: { id: string; amount: number; tick?: boolean; size?: 's' | 'm' | 'l'; showName?: boolean; class?: string; signed?: boolean }): JSX.Element {
  const { cv, sound } = useApp();
  const [shown, setShown] = useState(p.amount);
  const prev = useRef(p.amount);
  useEffect(() => {
    if (prev.current === p.amount) return;
    const from = prev.current;
    prev.current = p.amount;
    if (p.tick === false) { setShown(p.amount); return; }
    return tween(from, p.amount, dur('reward'), (v, done) => {
      setShown(Math.round(v));
      if (!done) sound.play('currency_tick', 70);
    });
  }, [p.amount]);
  const c = cv.currency(p.id);
  const name = c?.name ?? p.id;
  const glyph = { s: 14, m: 18, l: 24 }[p.size ?? 'm'];
  return (
    <span class={`cur cur--${p.size ?? 'm'} ${p.class ?? ''}`} aria-label={`${fmtInt(p.amount)} ${name}`}>
      <CurrencyGlyph id={p.id} size={glyph} />
      <span class="cur__n num" aria-hidden="true">{p.signed && shown > 0 ? '+' : ''}{fmtInt(shown)}</span>
      {p.showName ? <span class="cur__name t-caption" aria-hidden="true">{name}</span> : null}
    </span>
  );
}
