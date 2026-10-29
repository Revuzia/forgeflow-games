// VALE HUD — the context every HUD widget reads: the match model, the input controller, the renderer
// seam (structural; render/ is not imported), the shop/scoreboard toggles and small helpers.
//
// PER-TICK WORK (r12 B4): a widget re-renders only when a small key of its discrete state changes
// (`useViewKey`), and its continuous values (cooldown sweeps and seconds, bar widths, timers, Gleam) are
// written straight into the DOM by a writer (`useWriter`) that the model runs once per new sim tick from
// the HUD's rAF loop and once after every render of the widget. `put` / `setVar` / `setW` skip the DOM
// write when the value did not change, so a quiet tick costs a few comparisons per widget.

import { Component, createContext, createElement, type ComponentType, type FunctionComponent, type VNode } from 'preact';
import { useContext, useEffect, useLayoutEffect, useReducer, useRef } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import type { MatchClient } from '../../contracts/session.ts';
import type { EntityView } from '../../contracts/sim.ts';
import type { AbilityIndex, InputController, InputRenderer } from '../../input/index.ts';
import type { HudModel } from './model.ts';

export interface HudCtx {
  client: MatchClient;
  model: HudModel;
  input: InputController;
  index: AbilityIndex;
  r: InputRenderer;
  shopOpen: Signal<boolean>;
  board: Signal<boolean>;
  /** the Dial Bar's stats flyout (r12 m1) */
  statsOpen: Signal<boolean>;
  /** shape of the minimap (by the mode's structure: roads → wide, a span → strip, FFA → disc) */
  mapShape: 'rect' | 'strip' | 'disc';
  /** label for an action's key (from the player's binds) */
  key(action: string): string;
}

export const HudContext = createContext<HudCtx>(null as unknown as HudCtx);
export const useHud = (): HudCtx => useContext(HudContext);

/** CSS colour variable for a relationship */
export const REL_VAR = { self: 'var(--team-self)', ally: 'var(--team-ally)', enemy: 'var(--team-enemy)', neutral: 'var(--team-neutral)' } as const;

/** seconds → the cooldown readout: "0.6", "12", and m:ss from a minute up ("3:37"; rounded first, so
 *  never "1:60") */
export function cdText(s: number): string {
  if (s <= 0) return '';
  if (s < 1) return s.toFixed(1);
  const t = Math.ceil(s - 0.001);
  return t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : String(t);
}

export function alive(e: EntityView | undefined): e is EntityView { return !!e && e.alive; }

// ── per-tick plumbing (B4) ───────────────────────────────────────────────────────────────────────
/** re-render this widget only when `key()` changes; checked once per new sim tick (not per frame) */
export function useViewKey(key: () => string | number): void {
  const { model } = useHud();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const fn = useRef(key);
  fn.current = key;
  const last = useRef<string | number>('');
  last.current = key();
  useEffect(() => model.onWrite(() => {
    const k = fn.current();
    if (k !== last.current) { last.current = k; bump(0); }
  }), [model]);
}

/** a prop-less widget that renders only on its own state (its `useViewKey` bumps and the signals it reads),
 *  never because its parent re-rendered: memo() without preact/compat (whose global option hooks would
 *  change every form control in the app). The HUD context value is stable per match (index.tsx), so the
 *  context never forces it either. HUD-4: the sky strip re-renders on its own score key and with the HUD
 *  root (the cursor class); the ledger line inside it must not. */
export function pinned(c: FunctionComponent): ComponentType {
  class Pinned extends Component {
    shouldComponentUpdate(): boolean { return false; }
    render(): VNode { return createElement(c, null); }
  }
  (Pinned as unknown as { displayName: string }).displayName = `Pinned(${c.displayName || c.name})`;
  return Pinned;
}

/** a DOM writer for a widget's continuous values: once per new sim tick, and after each of its renders */
export function useWriter(fn: () => void): void {
  const { model } = useHud();
  const ref = useRef(fn);
  ref.current = fn;
  useLayoutEffect(() => { try { ref.current(); } catch (e) { console.error('[vale] hud writer', e); } });
  useEffect(() => model.onWrite(() => ref.current()), [model]);
}

type Cached = HTMLElement & { __v?: Record<string, string> };
const cache = (el: HTMLElement): Record<string, string> => ((el as Cached).__v ??= {});
/** set an element's text when it changed */
export function put(el: HTMLElement | null | undefined, text: string): void {
  if (!el) return;
  const c = cache(el);
  if (c.t === text) return;
  c.t = text;
  el.textContent = text;
}
/** set a CSS custom property when it changed */
export function setVar(el: HTMLElement | SVGElement | null | undefined, name: string, value: string): void {
  if (!el) return;
  const c = cache(el as HTMLElement);
  if (c[name] === value) return;
  c[name] = value;
  (el as HTMLElement).style.setProperty(name, value);
}
/** set a style property (camelCase) when it changed */
export function setStyle(el: HTMLElement | SVGElement | null | undefined, prop: string, value: string): void {
  if (!el) return;
  const c = cache(el as HTMLElement);
  const k = `s:${prop}`;
  if (c[k] === value) return;
  c[k] = value;
  ((el as HTMLElement).style as unknown as Record<string, string>)[prop] = value;
}
/** a bar fill's width in % (2 decimals: sub-pixel steps at 1080p, no write for a still bar) */
export function setW(el: HTMLElement | null | undefined, frac: number): void {
  setStyle(el, 'width', `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(2)}%`);
}
/** toggle a class when it changed */
export function setCls(el: Element | null | undefined, cls: string, on: boolean): void {
  if (!el || el.classList.contains(cls) === on) return;
  el.classList.toggle(cls, on);
}
