// VALE UI — tooltips. One layer for the whole client (Overlay.tip). Shown on hover AND keyboard focus
// (hover = focus, bible §States), 160 ms in, positioned against the anchor and kept on screen.
// Rich tooltips resolve {placeholders} (format.ts richText): magic numbers sit in a 1 px oval chip,
// physical numbers are upright chalkstone, true damage is value-inverted, heals carry "+".

import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { useApp, type TipSpec } from '../app_ctx.ts';
import { rankParts, richText, type Seg, type ValueSeg } from '../format.ts';
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

// ── rank-aware numbers (HUD-5) ─────────────────────────────────────────────────────────────────
/** where a ranked tooltip stands: the rank you have (0 = not learned) and whether a point can go into it now */
export interface RankView { rank: number; canLevel?: boolean }
/** held Shift opens every rank's numbers in a ranked tooltip (the tooltip layer re-renders on it) */
export const tipAllRanks = signal(false);
let shiftHooked = false;
function hookShift(): void {
  if (shiftHooked || typeof window === 'undefined') return;
  shiftHooked = true;
  const set = (on: boolean): void => { if (tipAllRanks.peek() !== on) tipAllRanks.value = on; };
  addEventListener('keydown', (e) => { if (e.key === 'Shift') set(true); }, true);
  addEventListener('keyup', (e) => { if (e.key === 'Shift') set(false); }, true);
  addEventListener('blur', () => set(false));
}

/** a per-rank number: the rank you have leads (rank 0 shows rank 1, the one you would learn); when a point can go
 *  in, the next rank follows an arrow; held Shift shows the whole row with yours lit and the others dimmed */
function RankedNum(p: { ranks: string[]; unit: string; rv: RankView; all: boolean }): JSX.Element {
  const n = p.ranks.length;
  const cur = Math.max(0, Math.min(n - 1, p.rv.rank - 1));
  if (p.all) {
    return <span class="rk rk--all">{p.ranks.map((x, i) => <>{i ? <span class="rk__sep">/</span> : null}<span class={i === cur ? 'rk__cur' : 'rk__dim'}>{x}</span></>)}{p.unit}</span>;
  }
  const next = p.rv.canLevel && p.rv.rank >= 1 && cur + 1 < n ? p.ranks[cur + 1] : null;
  return <span class="rk"><span class="rk__cur">{p.ranks[cur]}{p.unit}</span>{next ? <span class="rk__next"> → {next}{p.unit}</span> : null}</span>;
}

// ── rich text ──────────────────────────────────────────────────────────────────────────────────
export function RichSegs(p: { segs: Seg[]; rv?: RankView; all?: boolean }): JSX.Element {
  const num = (s: ValueSeg): JSX.Element | string => (p.rv && s.ranks ? <RankedNum ranks={s.ranks} unit={s.unit ?? ''} rv={p.rv} all={!!p.all} /> : s.text);
  return (
    <span class="rich">
      {p.segs.map((s) => s.kind === 'text' ? s.text : s.kind === 'kw' ? <span class={`rich__k rich__k--${s.tone}`}>{s.text}</span> : (
        <span class={`rich__v rich__v--${s.tone} ${s.missing ? 'rich__v--missing' : ''}`}>
          <span class="rich__n">{s.tone === 'heal' ? '+' : ''}{num(s)}</span>
          {s.ratios.length ? <span class="rich__r"> ({s.ratios.map((r, i) => <span class={`rich__ratio rich__ratio--${r.tone}`}>{i ? ', ' : ''}{r.text}</span>)})</span> : null}
        </span>
      ))}
    </span>
  );
}
export function RichDesc(p: { record: unknown; desc: string; rv?: RankView; all?: boolean }): JSX.Element {
  const { cv } = useApp();
  return <RichSegs segs={richText(cv, p.record, p.desc)} rv={p.rv} all={p.all} />;
}

type AbilityLike = { name: string; desc: string; cooldown?: number | number[]; cost?: number | number[]; costKind?: string; icon?: string; targeting?: { range?: number } };
/** a cooldown / cost line: one number, or (with a rank view) the rank you have first */
function statNum(v: number | number[] | undefined, unit: string, rv: RankView | undefined, all: boolean): JSX.Element | string | null {
  if (v === undefined) return null;
  const a = Array.isArray(v) ? v : [v];
  if (a.every((x) => x === 0)) return null;
  if (a.every((x) => x === a[0])) return fmtNum(a[0]) + unit;
  const rp = rankParts(a, '');
  if (rv && rp) return <RankedNum ranks={rp.ranks} unit={unit} rv={rv} all={all} />;
  return a.map(fmtNum).join('/') + unit;
}

/** ability / spell / passive / boon tooltip body. `rank` (the HUD's own slots) makes every per-rank number lead
 *  with the rank you have; held Shift shows the whole row (HUD-5) */
export function AbilityTip(p: { record: AbilityLike; slotLabel?: string; keyLabel?: string; kind?: string; resourceName?: string; cv?: CatalogView; rank?: RankView }): JSX.Element {
  const { cv } = useApp();
  const r = p.record;
  if (p.rank) hookShift();
  const all = !!p.rank && tipAllRanks.value;
  const cd = statNum(r.cooldown, ' s', p.rank, all);
  const cost = r.costKind === 'none' ? null : statNum(r.cost, r.costKind === 'hp' ? ' Health' : p.resourceName ? ` ${p.resourceName}` : '', p.rank, all);
  const range = r.targeting?.range ? `${fmtNum(r.targeting.range)} m` : null;
  const segs = richText(cv, r, r.desc);
  const ranked = !!p.rank && (segs.some((s) => s.kind === 'value' && !!s.ranks) || [r.cooldown, r.costKind === 'none' ? undefined : r.cost].some((v) => Array.isArray(v) && !!rankParts(v, '')));
  return (
    <div class="tipx">
      <div class="tipx__head">
        <span class="t-h2 tipx__name">{r.name}</span>
        {p.keyLabel ? <span class="keycap">{p.keyLabel}</span> : null}
      </div>
      {p.slotLabel || p.kind ? <div class="t-caption tipx__kind">{p.slotLabel ?? p.kind}</div> : null}
      {(cd || cost || range) ? (
        <div class="tipx__stats">
          {cd ? <span><span class="t-caption">{cv.t('tip.cooldown', 'Cooldown')}</span> <span class="num">{cd}</span></span> : null}
          {cost ? <span><span class="t-caption">{cv.t('tip.cost', 'Cost')}</span> <span class="num">{cost}</span></span> : null}
          {range ? <span><span class="t-caption">{cv.t('tip.range', 'Range')}</span> <span class="num">{range}</span></span> : null}
        </div>
      ) : null}
      <p class="t-body-s tipx__desc"><RichSegs segs={segs} rv={p.rank} all={all} /></p>
      {ranked ? <p class="t-caption tipx__ranks">{all ? cv.t('tip.ranks_all', 'Every rank, yours lit.') : cv.t('tip.ranks_hint', 'Hold Shift for every rank.')}</p> : null}
    </div>
  );
}

/** plain one-line tooltip (disabled reasons, icon buttons) */
export function TipText(p: { text: string; sub?: string }): JSX.Element {
  return <div class="tipx tipx--plain"><span class="t-body-s">{p.text}</span>{p.sub ? <span class="t-caption tipx__sub">{p.sub}</span> : null}</div>;
}
