// VALE UI — tooltips. One layer for the whole client (Overlay.tip). Shown on hover AND keyboard focus
// (hover = focus, bible §States), 160 ms in, positioned against the anchor and kept on screen.
// Rich tooltips resolve {placeholders} (format.ts richText): magic numbers sit in a 1 px oval chip,
// physical numbers are upright chalkstone, true damage is value-inverted, heals carry "+".

import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp, type TipSpec } from '../app_ctx.ts';
import { richText, type Seg } from '../format.ts';
import { fmtNum } from '../format.ts';
import type { CatalogView } from '../catalog_view.ts';

let tipSeq = 1;
const SHOW_MS = 160;

export interface TipHandlers {
  onPointerEnter: (e: PointerEvent) => void;
  onPointerLeave: () => void;
  onFocus: (e: FocusEvent) => void;
  onBlur: () => void;
}

/** spread the returned handlers on any element; `content` null = no tooltip */
export function useTip(content: (() => ComponentChildren) | null, o: { place?: TipSpec['place']; wide?: boolean } = {}): TipHandlers {
  const { overlay } = useApp();
  const key = useRef(`tip${tipSeq++}`).current;
  const timer = useRef(0);
  const show = (el: Element, delay: number): void => {
    if (!content) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!el.isConnected) return;
      overlay.tip.value = { key, rect: el.getBoundingClientRect(), content: content as TipSpec['content'], place: o.place, wide: o.wide };
    }, delay);
  };
  const hide = (): void => { clearTimeout(timer.current); if (overlay.tip.value?.key === key) overlay.tip.value = null; };
  return {
    onPointerEnter: (e) => show(e.currentTarget as Element, SHOW_MS),
    onPointerLeave: hide,
    onFocus: (e) => { if ((e.currentTarget as Element).matches(':focus-visible')) show(e.currentTarget as Element, 0); },
    onBlur: hide,
  };
}

export function TooltipLayer(): JSX.Element | null {
  const { overlay } = useApp();
  const tip = overlay.tip.value;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) { setPos(null); return; }
    const r = tip.rect, w = el.offsetWidth, h = el.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 10;
    const order: NonNullable<TipSpec['place']>[] = tip.place ? [tip.place, 'below', 'above', 'right', 'left'] : ['right', 'below', 'above', 'left'];
    for (const p of order) {
      let x = 0, y = 0;
      if (p === 'right') { x = r.right + gap; y = r.top; }
      if (p === 'left') { x = r.left - gap - w; y = r.top; }
      if (p === 'below') { x = r.left; y = r.bottom + gap; }
      if (p === 'above') { x = r.left; y = r.top - gap - h; }
      const fits = x >= 8 && x + w <= vw - 8 && y >= 8 && y + h <= vh - 8;
      if (fits || p === order[order.length - 1]) {
        setPos({ x: Math.max(8, Math.min(vw - w - 8, x)), y: Math.max(8, Math.min(vh - h - 8, y)) });
        return;
      }
    }
  }, [tip?.key, tip?.rect.x, tip?.rect.y]);
  if (!tip) return null;
  return (
    <div ref={ref} class={`tip ${tip.wide ? 'tip--wide' : ''}`} role="tooltip" style={pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { left: '-9999px', top: '0' }}>
      {tip.content()}
    </div>
  );
}

// ── rich text ──────────────────────────────────────────────────────────────────────────────────
export function RichSegs(p: { segs: Seg[] }): JSX.Element {
  return (
    <span class="rich">
      {p.segs.map((s) => s.kind === 'text' ? s.text : (
        <span class={`rich__v rich__v--${s.tone} ${s.missing ? 'rich__v--missing' : ''}`}>
          <span class="rich__n">{s.tone === 'heal' ? '+' : ''}{s.text}</span>
          {s.ratios.length ? <span class="rich__r"> ({s.ratios.map((r, i) => <span class={`rich__ratio rich__ratio--${r.tone}`}>{i ? ', ' : ''}{r.text}</span>)})</span> : null}
        </span>
      ))}
    </span>
  );
}
export function RichDesc(p: { record: unknown; desc: string }): JSX.Element {
  const { cv } = useApp();
  return <RichSegs segs={richText(cv, p.record, p.desc)} />;
}

type AbilityLike = { name: string; desc: string; cooldown?: number | number[]; cost?: number | number[]; costKind?: string; icon?: string; targeting?: { range?: number } };
const rankedText = (v: number | number[] | undefined, unit: string): string | null => {
  if (v === undefined) return null;
  const a = Array.isArray(v) ? v : [v];
  if (a.every((x) => x === 0)) return null;
  return (a.every((x) => x === a[0]) ? fmtNum(a[0]) : a.map(fmtNum).join('/')) + unit;
};

/** ability / spell / passive / boon tooltip body */
export function AbilityTip(p: { record: AbilityLike; slotLabel?: string; keyLabel?: string; kind?: string; resourceName?: string; cv?: CatalogView }): JSX.Element {
  const r = p.record;
  const cd = rankedText(r.cooldown, ' s');
  const cost = r.costKind === 'none' ? null : rankedText(r.cost, r.costKind === 'hp' ? ' Health' : p.resourceName ? ` ${p.resourceName}` : '');
  const range = r.targeting?.range ? `${fmtNum(r.targeting.range)} m` : null;
  return (
    <div class="tipx">
      <div class="tipx__head">
        <span class="t-h2 tipx__name">{r.name}</span>
        {p.keyLabel ? <span class="keycap">{p.keyLabel}</span> : null}
      </div>
      {p.slotLabel || p.kind ? <div class="t-caption tipx__kind">{p.slotLabel ?? p.kind}</div> : null}
      {(cd || cost || range) ? (
        <div class="tipx__stats">
          {cd ? <span><span class="t-caption">Cooldown</span> <span class="num">{cd}</span></span> : null}
          {cost ? <span><span class="t-caption">Cost</span> <span class="num">{cost}</span></span> : null}
          {range ? <span><span class="t-caption">Range</span> <span class="num">{range}</span></span> : null}
        </div>
      ) : null}
      <p class="t-body-s tipx__desc"><RichDesc record={r} desc={r.desc} /></p>
    </div>
  );
}

/** plain one-line tooltip (disabled reasons, icon buttons) */
export function TipText(p: { text: string; sub?: string }): JSX.Element {
  return <div class="tipx tipx--plain"><span class="t-body-s">{p.text}</span>{p.sub ? <span class="t-caption tipx__sub">{p.sub}</span> : null}</div>;
}
