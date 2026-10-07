// VALE UI — slider (role=slider). Pointer drag, ←/→ ↑/↓ step, PageUp/PageDown ×10, Home/End. The value
// is a live number, so it prints in the Mono face with tabular figures.

import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';

export function Slider(p: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string; id?: string;
  format?: (v: number) => string; disabled?: string; class?: string; marks?: number[];
}): JSX.Element {
  const { sound } = useApp();
  const track = useRef<HTMLDivElement>(null);
  const fmt = p.format ?? ((v: number) => String(v));
  const clamp = (v: number): number => {
    const s = Math.round((v - p.min) / p.step) * p.step + p.min;
    return Math.min(p.max, Math.max(p.min, +s.toFixed(4)));
  };
  const set = (v: number): void => {
    const c = clamp(v);
    if (c !== p.value) { p.onChange(c); sound.play('slider', 60); }
  };
  const fromX = (x: number): void => {
    const r = track.current!.getBoundingClientRect();
    set(p.min + ((x - r.left) / r.width) * (p.max - p.min));
  };
  const onDown = (e: PointerEvent): void => {
    if (p.disabled || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    fromX(e.clientX);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (p.disabled) return;
    const big = p.step * 10;
    const m: Record<string, number> = { ArrowRight: p.step, ArrowUp: p.step, ArrowLeft: -p.step, ArrowDown: -p.step, PageUp: big, PageDown: -big };
    if (e.key in m) { e.preventDefault(); e.stopPropagation(); set(p.value + m[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); set(p.min); }
    else if (e.key === 'End') { e.preventDefault(); set(p.max); }
  };
  const pct = ((p.value - p.min) / (p.max - p.min)) * 100;
  return (
    <div class={`slider ${p.disabled ? 'is-disabled' : ''} ${p.class ?? ''}`}>
      <div ref={track} class="slider__hit" role="slider" tabIndex={0} id={p.id} aria-label={p.label}
        aria-valuemin={p.min} aria-valuemax={p.max} aria-valuenow={p.value} aria-valuetext={fmt(p.value)} aria-disabled={p.disabled ? 'true' : undefined}
        title={p.disabled}
        onPointerDown={onDown} onPointerMove={(e) => { if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fromX(e.clientX); }}
        onKeyDown={onKey} style={{ '--pct': `${pct}%` } as JSX.CSSProperties}>
        <span class="slider__track"><span class="slider__fill" />{(p.marks ?? []).map((m) => <i class="slider__mark" style={{ left: `${((m - p.min) / (p.max - p.min)) * 100}%` }} />)}</span>
        <span class="slider__thumb" />
      </div>
      <span class="slider__value num">{fmt(p.value)}</span>
    </div>
  );
}
