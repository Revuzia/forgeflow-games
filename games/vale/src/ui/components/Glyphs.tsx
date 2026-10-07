// VALE UI — the glyph set, all original SVG (no text-in-images, no icon font). Bible: FRAY seat glyphs
// ● ▲ ○ ✚ ■ ⧗ ☾ ✖ ▬ ◆ with their keylines; team marks ▲ spire / ◠ dome; mode marks (three roads
// crossed by the noon line · one line over an arc · a ring of ticks · the uncarved hour); fighter
// class mass glyphs (Plinth block, Breaker inverted wedge, Striker forward diagonal, Slinger
// horizontal, Caster line + disc, Tender round with a light vessel); the gnomon wedge; utility icons.

import type { JSX } from 'preact';
import { TOKENS } from '../tokens.ts';
import type { ModeMark } from '../catalog_view.ts';

type SvgProps = { size?: number | string; class?: string; title?: string; style?: JSX.CSSProperties };
const sz = (s: number | string | undefined, d: string): string => (s === undefined ? d : typeof s === 'number' ? `calc(${s}px * var(--k))` : s);

function Svg(p: SvgProps & { vb?: string; children: JSX.Element | JSX.Element[] | (JSX.Element | null | false)[]; fill?: string }): JSX.Element {
  const s = sz(p.size, '1em');
  return (
    <svg viewBox={p.vb ?? '0 0 24 24'} width={s} height={s} class={`glyph ${p.class ?? ''}`} style={{ width: s, height: s, ...p.style }}
      aria-hidden={p.title ? undefined : 'true'} role={p.title ? 'img' : undefined} fill={p.fill ?? 'currentColor'}>
      {p.title ? <title>{p.title}</title> : null}
      {p.children}
    </svg>
  );
}

// ── FRAY seat glyphs ───────────────────────────────────────────────────────────────────────────
export type SeatGlyphName = (typeof TOKENS.fray)[number]['glyph'];
const SEAT_SHAPES: Record<string, (fill: string, key: string) => JSX.Element> = {
  disc: (f, k) => <circle cx="12" cy="12" r="7" fill={f} stroke={k} stroke-width="1.5" paint-order="stroke" />,
  peak: (f, k) => <polygon points="12,4.5 19.5,18.5 4.5,18.5" fill={f} stroke={k} stroke-width="1.5" stroke-linejoin="round" paint-order="stroke" />,
  ring: (f, k) => (<g fill="none"><circle cx="12" cy="12" r="6.3" stroke={k} stroke-width="5" /><circle cx="12" cy="12" r="6.3" stroke={f} stroke-width="3" /></g>),
  cross: (f, k) => <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" fill={f} stroke={k} stroke-width="1.5" stroke-linejoin="round" paint-order="stroke" />,
  block: (f, k) => <rect x="5.5" y="5.5" width="13" height="13" fill={f} stroke={k} stroke-width="1.5" paint-order="stroke" />,
  sandglass: (f, k) => <path d="M5.5 4.5h13L12 12l6.5 7.5h-13L12 12z" fill={f} stroke={k} stroke-width="1.5" stroke-linejoin="round" paint-order="stroke" />,
  crescent: (f, k) => <path d="M14 4.25A8 8 0 1 0 14 19.75A8.92 8.92 0 0 1 14 4.25Z" fill={f} stroke={k} stroke-width="1.5" stroke-linejoin="round" paint-order="stroke" />,
  saltire: (f, k) => <path d="M10 3.5h4v6.5h6.5v4H14v6.5h-4V14H3.5v-4H10z" transform="rotate(45 12 12)" fill={f} stroke={k} stroke-width="1.5" stroke-linejoin="round" paint-order="stroke" />,
  bar: (f, k) => <rect x="3.5" y="9" width="17" height="6" fill={f} stroke={k} stroke-width="1.5" paint-order="stroke" />,
  lozenge: (f, k) => <polygon points="12,3.5 20,12 12,20.5 4,12" fill={f} stroke={k} stroke-width="1.5" stroke-linejoin="round" paint-order="stroke" />,
};

/** seat 1..10 (colorIndex + 1). `color` overrides the fill (self = Noonwhite, simple colours = HARM). */
export function SeatGlyph(p: { seat: number; size?: number | string; color?: string; keyline?: boolean; title?: string; class?: string }): JSX.Element {
  const s = TOKENS.fray[(Math.max(1, p.seat) - 1) % TOKENS.fray.length];
  const fill = p.color ?? s.color;
  const key = p.keyline === false ? 'none' : s.keyline === 'chalk' ? TOKENS.colors.chalk : s.keyline === 'ink' ? TOKENS.colors['ink-0'] : 'none';
  return <Svg size={p.size} title={p.title} class={p.class}>{SEAT_SHAPES[s.glyph](fill, key)}</Svg>;
}
export const seatToken = (seat: number) => TOKENS.fray[(Math.max(1, seat) - 1) % TOKENS.fray.length];

// ── team marks ─────────────────────────────────────────────────────────────────────────────────
export function TeamMark(p: { team: number; size?: number | string; title?: string; class?: string }): JSX.Element {
  return p.team === 0
    ? <Svg size={p.size} title={p.title} class={p.class}><polygon points="12,2.5 16.5,21 7.5,21" /></Svg>
    : <Svg size={p.size} title={p.title} class={p.class} fill="none"><path d="M3.5 18.5a8.5 8.5 0 0 1 17 0" stroke="currentColor" stroke-width="3.2" stroke-linecap="butt" /></Svg>;
}

// ── mode marks ─────────────────────────────────────────────────────────────────────────────────
export function ModeMarkGlyph(p: { mark: ModeMark; lanes?: number; ticks?: number; size?: number | string; class?: string; title?: string }): JSX.Element {
  const stroke = { stroke: 'currentColor', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'square' } as const;
  let body: JSX.Element;
  if (p.mark === 'roads') {
    const n = Math.max(1, Math.min(5, p.lanes ?? 3));
    const ys = Array.from({ length: n }, (_, i) => 24 + (i - (n - 1) / 2) * 8);
    body = <g {...stroke}>{ys.map((y) => <line x1="9" y1={y} x2="39" y2={y} />)}<line x1="24" y1="7" x2="24" y2="41" stroke-dasharray="2.5 2.5" /></g>;
  } else if (p.mark === 'span') {
    body = <g {...stroke}><line x1="6" y1="21" x2="42" y2="21" /><path d="M9 39A15 13 0 0 1 39 39" /></g>;
  } else if (p.mark === 'ring') {
    const n = Math.max(3, Math.min(16, p.ticks ?? 10));
    body = <g {...stroke}>{Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return <line x1={24 + Math.cos(a) * 12} y1={24 + Math.sin(a) * 12} x2={24 + Math.cos(a) * 17} y2={24 + Math.sin(a) * 17} />;
    })}</g>;
  } else {
    body = <g {...stroke}><circle cx="24" cy="24" r="15" stroke-dasharray="1.5 4" /><line x1="24" y1="6" x2="24" y2="11" /></g>;
  }
  return <Svg size={p.size} vb="0 0 48 48" class={p.class} title={p.title} fill="none">{body}</Svg>;
}

// ── fighter class (mass) glyphs ────────────────────────────────────────────────────────────────
export type ClassShape = 'block' | 'wedge' | 'diagonal' | 'horizontal' | 'linedisc' | 'round';
export function classShapeOf(shape: string | undefined, name?: string): ClassShape | null {
  const s = `${shape ?? ''} ${name ?? ''}`.toLowerCase();
  if (/block|plinth|square/.test(s)) return 'block';
  if (/wedge|breaker|inverted/.test(s)) return 'wedge';
  if (/diag|striker|lean/.test(s)) return 'diagonal';
  if (/horiz|slinger|across/.test(s)) return 'horizontal';
  if (/disc|caster|line/.test(s)) return 'linedisc';
  if (/round|vessel|tender|circle/.test(s)) return 'round';
  return null;
}
export function ClassGlyph(p: { shape: ClassShape; size?: number | string; title?: string; class?: string }): JSX.Element {
  const b: Record<ClassShape, JSX.Element> = {
    block: <polygon points="4,6 20,6 18,20 6,20" />,
    wedge: <polygon points="3.5,5 20.5,5 12,21" />,
    diagonal: <polygon points="6,21 10.5,21 18.5,3.5 14,3.5" />,
    horizontal: <g><rect x="2.5" y="10" width="19" height="4" /><rect x="5" y="7" width="2" height="10" /></g>,
    linedisc: <g><circle cx="12" cy="6" r="3.6" /><rect x="10.8" y="10.5" width="2.4" height="11" /></g>,
    round: <g><circle cx="12" cy="12.5" r="8" fill="none" stroke="currentColor" stroke-width="2.2" /><circle cx="12" cy="12.5" r="3" /></g>,
  };
  return <Svg size={p.size} title={p.title} class={p.class}>{b[p.shape]}</Svg>;
}

// ── the gnomon wedge (act · chosen · facing) ───────────────────────────────────────────────────
export function Wedge(p: { size?: number | string; dir?: 'right' | 'left' | 'up' | 'down'; class?: string }): JSX.Element {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[p.dir ?? 'right'];
  return <Svg size={p.size} class={p.class}><polygon points="6,4.5 19,12 6,19.5" transform={`rotate(${rot} 12 12)`} /></Svg>;
}

// ── utility icons (1.6 px strokes on a 24 grid, square caps) ───────────────────────────────────
export type IconName = 'lock' | 'check' | 'warn' | 'danger' | 'back' | 'close' | 'search' | 'chevron' | 'plus' | 'minus'
  | 'swap' | 'reroll' | 'edit' | 'bot' | 'user' | 'open' | 'gear' | 'info' | 'arrow';
export function Icon(p: { name: IconName; size?: number | string; class?: string; title?: string }): JSX.Element {
  const st = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' } as const;
  const d: Record<IconName, JSX.Element> = {
    lock: <g {...st}><rect x="5.5" y="10.5" width="13" height="9.5" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></g>,
    check: <g {...st}><path d="M5 12.5l4.5 4.5L19 7.5" /></g>,
    warn: <g><polygon points="12,3.5 21.5,20 2.5,20" fill="currentColor" /><rect x="11" y="9" width="2" height="6" fill="var(--ink-0)" /><rect x="11" y="16.5" width="2" height="2" fill="var(--ink-0)" /></g>,
    danger: <g><polygon points="4,4 20,12 4,20" fill="currentColor" /><rect x="6.5" y="8.5" width="2" height="5" fill="var(--ink-0)" /><rect x="6.5" y="14.5" width="2" height="1.8" fill="var(--ink-0)" /></g>,
    back: <g {...st}><path d="M19 12H6M11 6.5L5.5 12l5.5 5.5" /></g>,
    arrow: <g {...st}><path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" /></g>,
    close: <g {...st}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></g>,
    search: <g {...st}><circle cx="10.5" cy="10.5" r="5.5" /><path d="M14.5 14.5l5 5" /></g>,
    chevron: <g {...st}><path d="M7 9.5l5 5 5-5" /></g>,
    plus: <g {...st}><path d="M12 5.5v13M5.5 12h13" /></g>,
    minus: <g {...st}><path d="M5.5 12h13" /></g>,
    swap: <g {...st}><path d="M5 8.5h13l-3.5-3.5M19 15.5H6l3.5 3.5" /></g>,
    reroll: <g {...st}><path d="M18.5 12a6.5 6.5 0 1 1-2-4.7" /><path d="M17.5 3.8v4h-4" /></g>,
    edit: <g {...st}><path d="M5 19l1-4L15.5 5.5l3 3L9 18z" /></g>,
    bot: <g {...st}><rect x="5.5" y="8" width="13" height="10" /><path d="M12 8V5M9.5 12.5h.01M14.5 12.5h.01" /></g>,
    user: <g {...st}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></g>,
    open: <g {...st}><circle cx="12" cy="12" r="7" stroke-dasharray="2 3" /></g>,
    gear: <g {...st}><circle cx="12" cy="12" r="3" /></g>,
    info: <g {...st}><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8h.01" /></g>,
  };
  return <Svg size={p.size} class={p.class} title={p.title}>{d[p.name]}</Svg>;
}

// ── currency glyphs (drawn fallback when the catalog icon is missing) ───────────────────────────
export function CandleGlyph(p: { size?: number | string; class?: string }): JSX.Element {
  return <Svg size={p.size} class={p.class}><path d="M12 2.5c2 2.6 2.6 4.1 2.6 5.3a2.6 2.6 0 0 1-5.2 0c0-1.2.6-2.7 2.6-5.3z" /><rect x="9.6" y="11.5" width="4.8" height="10" /></Svg>;
}
export function PrismGlyph(p: { size?: number | string; class?: string }): JSX.Element {
  return <Svg size={p.size} class={p.class} fill="none"><polygon points="12,3.5 20.5,19.5 3.5,19.5" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" /><path d="M12 9.5v10" stroke="currentColor" stroke-width="1.4" /></Svg>;
}
