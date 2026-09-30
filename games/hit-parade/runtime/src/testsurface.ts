// HIT PARADE - the test surface `window.__HP__` (CONTRACT §12). Installed at boot, BEFORE the game exists, so a
// harness can poll state().phase through boot -> loading -> title/menu/ready -> bout. Pattern: dyefield
// testsurface.ts (dev functions throw unless ?dev=1).
//
//   version · state() · match() · fighters() · events(n) · shot(name) · perf() · audio() · net() · touch()
//   input(): the SHELL input read-back (words, held codes, pads, bindings) - an extra beyond §12
//   dev (?dev=1 only, else every call throws):
//     startMatch(cfg) · setInputs(p, word, frames) · step(n) · setHp(p, v) · setMeter(p, k, v) · freeze(on) ·
//     goto(screen) · cpu(p, level)
//
// This module never imports game.ts / the sim / the view: main.ts hands it a TestHooks object whose functions
// return null until a bout exists (so the lab page and the shell-only boot entry use the same surface).

import type { Flow } from './app/flow.ts';
import type { GameLoop } from './app/loop.ts';
import type { Input } from './input.ts';
import type { SettingsStore } from './ui/settings.ts';
import type { SaveStore } from './ui/save.ts';

export interface TestHooks {
  version: string;
  dev: boolean;
  flow: Flow;
  loop(): GameLoop | null;
  input(): Input | null;
  settings(): SettingsStore | null;
  save(): SaveStore | null;
  /** readMatch() + frame / checksum extras, null outside a bout */
  match(): Record<string, unknown> | null;
  /** [readFighter(0), readFighter(1)], null outside a bout */
  fighters(): unknown[] | null;
  /** the last n deduped sim events (oldest first) */
  events(n: number): unknown[];
  /** extra state() fields (bout summary, season, ...) */
  extra?(): Record<string, unknown>;
  canvas(): HTMLCanvasElement | null;
  /** render one frame right now (so the canvas holds a fresh picture for toDataURL) */
  render(): void;
  renderInfo(): unknown;
  audio(): unknown;
  net(): unknown;
  touch(): unknown;
  // dev (optional: the lab / shell-only entry leaves the game ones out)
  startMatch?(cfg: unknown): unknown;
  step?(n: number): number;
  setHp?(p: 0 | 1, v: number): void;
  setMeter?(p: 0 | 1, k: string, v: number): void;
  freeze?(on: boolean): void;
  goto?(screen: string): void;
  cpu?(p: 0 | 1, level: number): void;
}

export interface HpSurface {
  version: string;
  state(): Record<string, unknown>;
  match(): Record<string, unknown> | null;
  fighters(): unknown[] | null;
  events(n?: number): unknown[];
  shot(name: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
  perf(): Record<string, unknown>;
  audio(): unknown;
  net(): unknown;
  touch(): unknown;
  input(): Record<string, unknown> | null;
  dev: {
    startMatch(cfg: unknown): unknown;
    setInputs(p: number, word: number, frames: number): void;
    step(n: number): number;
    setHp(p: number, v: number): void;
    setMeter(p: number, k: string, v: number): void;
    freeze(on: boolean): void;
    goto(screen: string): void;
    cpu(p: number, level: number): void;
  };
}

declare global {
  interface Window { __HP__?: HpSurface }
}

const safe = <T>(fn: () => T, d: T): T => {
  try { return fn(); } catch { return d; }
};

const player = (p: number): 0 | 1 => {
  if (p !== 0 && p !== 1) throw new Error(`__HP__: player must be 0 or 1 (got ${String(p)})`);
  return p;
};

export function installTestSurface(h: TestHooks): HpSurface {
  const devOnly = (name: string): void => {
    if (!h.dev) throw new Error(`__HP__.dev.${name} is dev-only - load with ?dev=1`);
  };
  const need = <K extends keyof TestHooks>(name: K): NonNullable<TestHooks[K]> => {
    const f = h[name];
    if (typeof f !== 'function') throw new Error(`__HP__.dev.${String(name)}: not available on this page`);
    return f as NonNullable<TestHooks[K]>;
  };
  const api: HpSurface = {
    version: h.version,
    state() {
      const loop = h.loop();
      const input = h.input();
      const f = h.flow.snapshot();
      const st = loop ? loop.stats() : null;
      const out: Record<string, unknown> = {
        phase: f.phase, mode: f.mode, screen: f.screen, screenBefore: f.screenBefore, flowViolations: f.violations,
        version: h.version, dev: h.dev,
        tick: loop ? loop.ticks : 0,
        fps: st ? Math.round(st.fps * 10) / 10 : 0,
        simEnabled: loop ? loop.simEnabled : false,
        inputMode: input ? input.mode : null,
        live: input ? input.live : false,
      };
      if (f.error) out.error = f.error;
      if (h.extra) Object.assign(out, safe(() => h.extra!(), {}));
      return out;
    },
    match: () => safe(() => h.match(), null),
    fighters: () => safe(() => h.fighters(), null),
    events: (n = 64) => safe(() => h.events(Math.max(1, Math.min(1024, Math.floor(n)))), []),
    async shot(name: string) {
      const c = h.canvas();
      if (!c) return { ok: false, error: 'no canvas' };
      try {
        h.render();
        const url = c.toDataURL('image/png');
        const res = await fetch('/__shot/' + encodeURIComponent(String(name || 'shot')), {
          method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: url,
        });
        const body = await res.json().catch(() => ({})) as { ok?: boolean; path?: string; bytes?: number };
        return { ok: res.ok && body.ok !== false, path: body.path, bytes: body.bytes };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    perf() {
      const loop = h.loop();
      const st = loop ? loop.stats() : null;
      return {
        frame: st, counters: loop ? { ...loop.counters } : null, frameCapMs: loop ? loop.frameCapMs : null,
        renderer: safe(() => h.renderInfo(), null),
        memory: safe(() => {
          const m = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
          return m ? { usedMB: Math.round(m.usedJSHeapSize / 1048576), totalMB: Math.round(m.totalJSHeapSize / 1048576) } : null;
        }, null),
      };
    },
    audio: () => safe(() => h.audio(), null),
    net: () => safe(() => h.net(), null),
    touch: () => safe(() => h.touch(), null),
    input() {
      const i = h.input();
      if (!i) return null;
      return {
        mode: i.mode, pinned: i.pinned, live: i.live, suspended: i.suspended,
        words: [i.word(0), i.word(1)], held: i.heldCodes(), pads: i.padInfo(), samples: i.samples, keyEvents: i.keyEvents,
        devices: [i.lastDevice(0), i.lastDevice(1)], touch: { ...i.touch },
      };
    },
    dev: {
      startMatch(cfg) { devOnly('startMatch'); return need('startMatch')(cfg); },
      setInputs(p, word, frames) {
        devOnly('setInputs');
        const i = h.input();
        if (!i) throw new Error('__HP__.dev.setInputs: input not ready');
        i.force(player(p), Number(word) | 0, Number(frames));
      },
      step(n) { devOnly('step'); return need('step')(Number(n)); },
      setHp(p, v) { devOnly('setHp'); need('setHp')(player(p), Number(v)); },
      setMeter(p, k, v) { devOnly('setMeter'); need('setMeter')(player(p), String(k), Number(v)); },
      freeze(on) { devOnly('freeze'); need('freeze')(!!on); },
      goto(screen) { devOnly('goto'); need('goto')(String(screen)); },
      cpu(p, level) { devOnly('cpu'); need('cpu')(player(p), Number(level)); },
    },
  };
  window.__HP__ = api;
  return api;
}
