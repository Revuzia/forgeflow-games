// VALE UI — the ring: time and state. A sweep runs CLOCKWISE from 12 o'clock and is LINEAR (time is
// linear). Timer mode interpolates between session updates (ready check 4 Hz, draft 10 Hz) on its
// own rAF and turns HARM (relationship enemy colour, --team-enemy) in the last 5 s. Shape codes from
// the bible: `dash12` (ally), `notch4` (enemy), `solid` (self / neutral state).

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { reducedMotion } from '../motion.ts';

export const HARM_LAST_S = 5;

export interface RingProps {
  size: number;               // px at 1080p (× --k)
  stroke?: number;
  /** 0..1 filled share (state rings: XP, progress) */
  value?: number;
  /** timer mode: seconds left of `max`, counting down locally between updates */
  timer?: { left: number; max: number; paused?: boolean };
  tone?: 'chalk' | 'ally' | 'enemy' | 'self' | 'gloam' | 'ok' | string;
  kind?: 'solid' | 'dash12' | 'notch4';
  /** show the remaining whole seconds in the centre (timer mode) */
  showSeconds?: boolean;
  label?: string;
  class?: string;
  children?: ComponentChildren;
}

const R = 50;
const C = 2 * Math.PI * R;

function toneVar(t: RingProps['tone']): string {
  switch (t) {
    case undefined: case 'chalk': return 'var(--chalk)';
    case 'ally': return 'var(--team-ally)';
    case 'enemy': return 'var(--team-enemy)';
    case 'self': return 'var(--team-self)';
    case 'gloam': return 'var(--brand-gloam)';
    case 'ok': return 'var(--ok)';
    default: return t;
  }
}

export function Ring(p: RingProps): JSX.Element {
  const arc = useRef<SVGCircleElement>(null);
  const num = useRef<HTMLSpanElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef({ left: p.timer?.left ?? 0, at: performance.now() });
  const sw = p.stroke ?? Math.max(2, Math.round(p.size / 24));
  const vbStroke = (sw / p.size) * 100 * 1.0;

  // re-anchor on every session update
  useEffect(() => {
    if (p.timer) anchor.current = { left: p.timer.left, at: performance.now() };
  }, [p.timer?.left, p.timer?.max]);

  useEffect(() => {
    let raf = 0;
    const draw = (): void => {
      let frac: number, harm = false, secs = 0;
      if (p.timer) {
        const el = p.timer.paused ? 0 : (performance.now() - anchor.current.at) / 1000;
        const left = Math.max(0, anchor.current.left - el);
        frac = p.timer.max > 0 ? left / p.timer.max : 0;
        harm = left <= HARM_LAST_S && p.timer.max > 0;
        secs = Math.ceil(left - 0.001);
      } else frac = Math.max(0, Math.min(1, p.value ?? 0));
      const elapsed = 1 - frac;
      if (arc.current) {
        arc.current.style.strokeDasharray = `${C * frac} ${C}`;
        arc.current.style.strokeDashoffset = p.timer ? `${-C * elapsed}` : '0';
      }
      if (root.current) root.current.classList.toggle('is-harm', harm);
      if (num.current) num.current.textContent = String(secs);
      if (p.timer && !p.timer.paused) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [p.timer?.left, p.timer?.max, p.timer?.paused, p.value, reducedMotion.value]);

  const color = toneVar(p.tone);
  const dashes = p.kind === 'dash12';
  return (
    <div ref={root} class={`ring ${p.class ?? ''}`} style={{ '--ring-size': p.size, '--ring-color': color } as JSX.CSSProperties}
      role={p.label ? 'img' : undefined} aria-label={p.label}>
      <svg viewBox="-56 -56 112 112" class="ring__svg" aria-hidden="true">
        <circle r={R} class="ring__track" stroke-width={vbStroke} />
        <circle ref={arc} r={R} class="ring__arc" stroke-width={vbStroke} transform="rotate(-90)"
          stroke-dasharray={dashes ? undefined : `${C} ${C}`} />
        {dashes ? <circle r={R} class="ring__dash" stroke-width={vbStroke + 1} stroke-dasharray={`${C / 24} ${C / 24}`} transform="rotate(-90)" /> : null}
        {p.kind === 'notch4' ? [0, 90, 180, 270].map((a) => <rect x={-vbStroke} y={-R - vbStroke} width={vbStroke * 2} height={vbStroke * 2.6} class="ring__notch" transform={`rotate(${a})`} />) : null}
      </svg>
      <div class="ring__inner">
        {p.showSeconds && p.timer ? <span ref={num} class="ring__secs num" /> : p.children}
      </div>
    </div>
  );
}
