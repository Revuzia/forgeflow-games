// VALE HUD — the world-anchored layer and the ping wheel.
//
// WorldLayer: DOM marks projected through the renderer's worldToScreen every frame (imperative: no
// re-render per frame). Bible "HUD density": damage numbers only for YOUR outgoing hits and heals
// ≥ 5 % max HP (the model filters). W2-E CUX-8: hits on one target within 120 ms of each other merge; at most 4 numbers per
// target (16 on screen); each stands BESIDE its target's bar plate (alternating sides, newest lowest, older ones pushed up),
// sized by its amount, and drops to 60 % alpha while it crosses any bar plate;
// physical upright Chalkstone, magic Orchid-rose with the oval chip, true as dark numerals with a
// Noonwhite halo, heals Sap with "+" and always rising, crits larger. Gleam pops rise in chalk with the
// glint. Move / attack-move / attack markers (a ground ring that closes, HARM for attacks). Team pings
// at their ground point: the kind's silhouette over a ripple, 4 s.
// PingWheel: the radial menu while the ping key is held (client_hud §5): nine kinds clockwise from 12
// o'clock, a dead zone in the middle (a release there pings "Look here").
// ViewPlate (perf PERF-m4): while the renderer's GPU context is lost (the 3D view is blank) or its programs rebuild
// (~0.4-0.8 s), a centred plate says the view is being restored; the match itself runs on.

import type { CSSProperties, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import type { EntityId } from '../../contracts/sim.ts';
import { PING_ORDER, type Marker } from '../../input/index.ts';
import { useApp } from '../app_ctx.ts';
import type { ViewState } from '../state.ts';
import { fmtInt } from '../format.ts';
import { useHud } from './ctx.ts';
import { PingGlyph } from './glyphs.tsx';
import type { NumberPop } from './model.ts';

export interface MarkerMark extends Marker { id: number; at: number }
export interface WorldMarks { markers: Signal<MarkerMark[]> }

const MERGE_MS = 120;
const MAX_POPS = 16;
const MAX_PER_TARGET = 4;
/** damage numbers by amount: 15 px (a graze) to 26 px (350+), a crit a third larger (1080p reference px) */
const popPx = (amount: number, crit: boolean): number => (15 + 11 * Math.min(1, Math.sqrt(Math.max(0, amount) / 350))) * (crit ? 1.3 : 1);
const POP_MS = { damage: 900, heal: 1100, gold: 1100 } as const;
const MARKER_MS = 900;
const PING_MS = 4000;
/** overhead anchor for numbers (metres above the ground) */
const HEAD_M = 2.3;
/** the camera pitch squashes ground circles (52°: sin ≈ 0.79) */
const GROUND_SQUASH = 0.79;

interface Pop { el: HTMLElement; n: NumberPop; total: number; born: number; last: number; jitter: number; key: string; side: 1 | -1; w: number; h: number; rank: number }
interface PlateRect { l: number; t: number; r: number; b: number; x: number; z: number }
interface BarPlates { n: number; d: Float32Array }
interface Mark { el: HTMLElement; m: MarkerMark }
interface PingEl { el: HTMLElement; id: number }

export function WorldLayer(p: { marks: WorldMarks }): JSX.Element {
  const { state, cv } = useApp();
  const { model, r } = useHud();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = root.current;
    if (!host || !r.worldToScreen) return;
    const toScreen = r.worldToScreen.bind(r);
    const pops: Pop[] = [];
    const marks = new Map<number, Mark>();
    const pings = new Map<number, PingEl>();
    let raf = 0;
    let seq = 0;
    let plateRects: PlateRect[] = [];
    (globalThis as unknown as { __valeHudPlates?: unknown }).__valeHudPlates = { rects: () => plateRects };

    const sides = new Map<number, number>();
    const offNumbers = model.onNumber((n) => {
      if (!state.settings.peek().gameplay.showDamageNumbers && n.kind !== 'gold') return;
      const now = performance.now();
      const key = n.kind === 'gold' ? `g${seq}` : `${n.kind}:${n.dtype ?? ''}:${n.dst}`;
      const same = pops.find((x) => x.key === key && now - x.last < MERGE_MS);
      if (same) {
        same.total += n.amount; same.last = now; same.born = now;
        same.n = { ...same.n, crit: same.n.crit || n.crit };
        paintPop(same);
        same.el.animate([{ transform: `${same.el.style.transform} scale(1.18)` }, { transform: same.el.style.transform }], { duration: 120 });
        return;
      }
      if (n.kind !== 'gold') {
        // at most 4 per target: the oldest of this target makes room
        const mine = pops.filter((x) => x.n.kind !== 'gold' && x.n.dst === n.dst);
        if (mine.length >= MAX_PER_TARGET) { const old = mine.sort((a, b) => a.born - b.born)[0]; old.el.remove(); pops.splice(pops.indexOf(old), 1); }
      }
      if (pops.length >= MAX_POPS) { const old = pops.shift(); old?.el.remove(); }
      const el = document.createElement('span');
      const sd = (sides.get(n.dst) ?? 0) + 1; sides.set(n.dst, sd);
      if (sides.size > 96) sides.clear();
      const pop: Pop = { el, n, total: n.amount, born: now, last: now, jitter: ((seq++ * 0.61803) % 1) * 2 - 1, key, side: sd % 2 ? 1 : -1, w: 0, h: 0, rank: 0 };
      el.dataset.dst = String(n.dst);
      paintPop(pop);
      host.appendChild(el);
      pops.push(pop);
    });

    const paintPop = (x: Pop): void => {
      const n = x.n;
      const cls = n.kind === 'gold' ? 'wpop wpop--gold' : n.kind === 'heal' ? 'wpop wpop--heal' : `wpop wpop--${n.dtype ?? 'phys'}`;
      x.el.className = `${cls} num ${n.crit ? 'is-crit' : ''}`;
      const amt = fmtInt(x.total);
      x.el.textContent = n.kind === 'heal' ? `+${amt}` : n.kind === 'gold' ? `+${amt}` : amt;
      if (n.kind !== 'gold') {
        const ps = popPx(x.total, n.crit);
        x.el.style.setProperty('--ps', ps.toFixed(1));
        x.w = (x.el.textContent?.length ?? 2) * ps * 0.64 + 4; x.h = ps * 1.1;
      }
    };

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const v = model.view;
      // numbers
      const bp = (globalThis as unknown as { __valeBarPlates?: BarPlates }).__valeBarPlates;
      const pxc = Math.max(0.8, host.clientHeight / 1080) * (state.settings.peek().access.hudScale || 1);
      const rects: PlateRect[] = [];
      if (pops.length && bp) {
        for (let k = 0; k < bp.n; k++) {
          const o = k * 8, d = bp.d;
          const sc = toScreen(d[o], d[o + 2], d[o + 1]);
          if (!sc.visible) continue;
          rects.push({ l: sc.x - d[o + 3] * pxc, r: sc.x + d[o + 4] * pxc, t: sc.y - d[o + 5] * pxc, b: sc.y + d[o + 6] * pxc, x: d[o], z: d[o + 2] });
        }
      }
      plateRects = rects;
      // stack ranks: per target and side, the newest stands lowest and the older ones are pushed up
      const order = pops.filter((x) => x.n.kind !== 'gold').sort((a, b) => b.born - a.born);
      const seen = new Map<string, number>();
      for (const x of order) { const k = `${x.n.dst}:${x.side}`; const r = seen.get(k) ?? 0; seen.set(k, r + 1); x.rank = r; }
      for (let i = pops.length - 1; i >= 0; i--) {
        const x = pops[i];
        const life = POP_MS[x.n.kind];
        const t = (now - x.born) / life;
        if (t >= 1) { x.el.remove(); pops.splice(i, 1); continue; }
        const e = x.n.dst >= 0 ? v.entity(x.n.dst as EntityId) : undefined;
        const wx = e && e.alive ? e.x : x.n.x, wy = e && e.alive ? e.y : x.n.y;
        const pop = t < 0.12 ? 1 + (x.n.crit ? 0.5 : 0.25) * (1 - t / 0.12) : 1;
        let px: number, py: number, vis: boolean;
        if (x.n.kind === 'gold') {
          const s = toScreen(wx, wy, 1.2);
          const rise = 44 * easeOut(t);
          px = s.x + x.jitter * 8; py = s.y - rise; vis = s.visible;
        } else {
          // beside the target's bar plate (the nearest plate to the target); with no plate, over the head as before
          let pl: PlateRect | undefined, best = 1.5 * 1.5;
          for (const q of rects) { const dd = (q.x - wx) ** 2 + (q.z - wy) ** 2; if (dd < best) { best = dd; pl = q; } }
          const rise = (x.n.kind === 'damage' ? 14 : 26) * pxc * easeOut(t);
          const lift = x.rank * x.h * 1.05;
          if (pl) {
            const gap = 8 * pxc;
            px = x.side > 0 ? pl.r + gap + x.w / 2 : pl.l - gap - x.w / 2;
            py = (pl.t + pl.b) / 2 - rise - lift; vis = true;
          } else {
            const s = toScreen(wx, wy, HEAD_M);
            px = s.x + x.side * (36 * pxc + x.w / 2); py = s.y - rise - lift; vis = s.visible;
          }
        }
        if (!vis) { x.el.style.opacity = '0'; continue; }
        x.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
        let op = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
        // CUX-8: a number crossing ANY bar plate drops to 60 % alpha for as long as it does
        if (x.n.kind !== 'gold' && op > 0.6) {
          const hw = x.w / 2, hh = x.h / 2;
          for (const q of rects) if (px + hw > q.l && px - hw < q.r && py + hh > q.t && py - hh < q.b) { op = 0.6; break; }
        }
        x.el.style.opacity = String(op);
      }
      // move / attack markers
      const list = p.marks.markers.peek();
      for (const m of list) {
        if (marks.has(m.id) || now - m.at > MARKER_MS) continue;
        const el = document.createElement('span');
        el.className = `wmark wmark--${m.kind}`;
        host.appendChild(el);
        marks.set(m.id, { el, m });
      }
      for (const [id, mk] of marks) {
        const t = (now - mk.m.at) / MARKER_MS;
        if (t >= 1) { mk.el.remove(); marks.delete(id); continue; }
        const e = mk.m.target !== undefined ? v.entity(mk.m.target) : undefined;
        const s = toScreen(e ? e.x : mk.m.x, e ? e.y : mk.m.y, 0);
        const k = mk.m.kind === 'attack' ? 1.25 - 0.3 * easeOut(t) : 1.15 - 0.4 * easeOut(t);
        mk.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%) scale(${k.toFixed(3)}, ${(k * GROUND_SQUASH).toFixed(3)})`;
        mk.el.style.opacity = String(t < 0.55 ? 1 : 1 - ((t - 0.55) / 0.45) ** 2);
      }
      // team pings
      const live = model.pings.peek();
      const ids = new Set(live.map((x) => x.id));
      for (const [id, pe] of pings) if (!ids.has(id)) { pe.el.remove(); pings.delete(id); }
      for (const pg of live) {
        let pe = pings.get(pg.id);
        if (!pe) {
          const el = document.createElement('span');
          const harm = pg.kind === 'danger' || pg.kind === 'retreat';
          el.className = `wping ${harm ? 'is-harm' : ''} ${pg.self ? 'is-self' : ''}`;
          // HUD-11: two ground rings that open outward, a stem, and the glyph lifted on a 56 px chalk-ringed disc
          el.innerHTML = `<span class="wping__ring"></span><span class="wping__ring wping__ring--late"></span><span class="wping__stem"></span><span class="wping__glyph">${PING_SVG[pg.kind] ?? ''}</span>${pg.self ? '' : `<span class="wping__who t-caption"></span>`}`;
          const who = el.querySelector('.wping__who');
          if (who) who.textContent = v.players[pg.player]?.name ?? '';
          host.appendChild(el);
          pe = { el, id: pg.id };
          pings.set(pg.id, pe);
        }
        const t = (now - pg.at) / PING_MS;
        const e = pg.target !== undefined ? v.entity(pg.target) : undefined;
        const s = toScreen(e && e.alive ? e.x : pg.x, e && e.alive ? e.y : pg.y, 0);
        pe.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
        pe.el.style.opacity = s.visible ? String(t > 0.85 ? Math.max(0, (1 - t) / 0.15) : 1) : '0';
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); offNumbers();
      for (const x of pops) x.el.remove();
      for (const m of marks.values()) m.el.remove();
      for (const pe of pings.values()) pe.el.remove();
    };
  }, [model]);

  void cv;
  return <div ref={root} class="hudworld" aria-hidden="true" />;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/** the nine ping silhouettes as markup for the imperative layer (same shapes as PingGlyph) */
const PING_SVG: Record<string, string> = (() => {
  const st = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const g: Record<string, string> = {
    alert: '<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8.5" opacity="0.7"/>',
    danger: '<path d="M4 5h16L12 20z"/><path d="M12 8.5v5" stroke-width="2.4"/><circle cx="12" cy="16.2" r="0.6" fill="currentColor"/>',
    onMyWay: '<path d="M4 18L12 4l8 14-8-4z"/>',
    missing: '<path d="M17.6 6.4A8 8 0 1 0 20 12" stroke-dasharray="3 2.4"/><path d="M12 9v3.5"/>',
    assist: '<path d="M3 7l6 5-6 5"/><path d="M21 7l-6 5 6 5"/>',
    push: '<path d="M4 7l4 5-4 5M10 7l4 5-4 5M16 7l4 5-4 5"/>',
    vision: '<path d="M9 8h6l-1 8h-4z"/><path d="M10.5 8V6h3v2"/><circle cx="12" cy="12" r="10" stroke-dasharray="2 2.6" opacity="0.7"/>',
    objective: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    retreat: '<path d="M20 7l-4 5 4 5M14 7l-4 5 4 5M8 7l-4 5 4 5"/>',
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(g)) out[k] = `<svg viewBox="0 0 24 24" width="28" height="28" ${st}>${v}</svg>`;
  return out;
})();

// ── view plate (perf PERF-m4) ────────────────────────────────────────────────────────────────────
export function ViewPlate(): JSX.Element | null {
  const { state, cv } = useApp();
  const r = state.renderer;
  const [view, setView] = useState<ViewState>(() => r?.viewState ?? 'ok');
  useEffect(() => {
    if (!r?.onViewState) return undefined;
    setView(r.viewState ?? 'ok');     // a change between the first render and this subscription
    const off = r.onViewState((s) => setView(s));
    return off;
  }, [r]);
  if (view === 'ok') return null;
  return (
    <div class={`viewplate is-${view}`} role="status" aria-live="polite">
      <span class="viewplate__rule" aria-hidden="true" />
      <span class="viewplate__dial" aria-hidden="true" />
      <span class="viewplate__title t-h3">{cv.t('hud.view.restoring', 'Restoring the view')}</span>
      <span class="viewplate__sub t-body-s">{cv.t('hud.view.restoring_sub', 'The match carries on while the picture returns.')}</span>
    </div>
  );
}

// ── ping wheel ───────────────────────────────────────────────────────────────────────────────────
const WHEEL_R = 92;
/** W2-E CUX-15: every wedge carries its short name just outside the rim, shown after a 200 ms hold */
const TAG_R = 140;

export function PingWheel(): JSX.Element | null {
  const { cv, sound } = useApp();
  const { input } = useHud();
  const w = input.wheel.value;
  const open = !!w;
  useEffect(() => { if (open) sound.play('ping_wheel'); }, [open]);   // max2 SFX-10: the wheel catching under the cursor
  if (!w) return null;
  const sel = w.sel;
  return (
    <div class="pwheel" style={{ left: `${w.x}px`, top: `${w.y}px` } as CSSProperties} role="menu" aria-label={cv.t('ping.title', 'Ping')}>
      <svg class="pwheel__dial" viewBox="-120 -120 240 240" aria-hidden="true">
        <circle r="116" class="pwheel__rim" />
        <circle r="26" class="pwheel__hub" />
        {PING_ORDER.map((k, i) => {
          const a0 = ((i - 0.5) / PING_ORDER.length) * Math.PI * 2, a1 = ((i + 0.5) / PING_ORDER.length) * Math.PI * 2;
          const p = (a: number, rr: number): string => `${(Math.sin(a) * rr).toFixed(2)} ${(-Math.cos(a) * rr).toFixed(2)}`;
          return <path class={`pwheel__wedge ${sel === k ? 'is-on' : ''}`} d={`M${p(a0, 30)} L${p(a0, 114)} A114 114 0 0 1 ${p(a1, 114)} L${p(a1, 30)} A30 30 0 0 0 ${p(a0, 30)} Z`} />;
        })}
      </svg>
      {PING_ORDER.map((k, i) => {
        const a = (i / PING_ORDER.length) * Math.PI * 2;
        const harm = k === 'danger' || k === 'retreat';
        return (
          <span role="menuitem" aria-checked={sel === k} class={`pwheel__item ${sel === k ? 'is-on' : ''} ${harm ? 'is-harm' : ''}`}
            style={{ transform: `translate(${(Math.sin(a) * WHEEL_R).toFixed(1)}px, ${(-Math.cos(a) * WHEEL_R).toFixed(1)}px) translate(-50%, -50%)` } as CSSProperties}>
            <PingGlyph kind={k} size={26} />
          </span>
        );
      })}
      {PING_ORDER.map((k, i) => {
        const a = (i / PING_ORDER.length) * Math.PI * 2;
        return (
          <span aria-hidden="true" class={`pwheel__tag ${sel === k ? 'is-on' : ''} ${k === 'danger' || k === 'retreat' ? 'is-harm' : ''}`}
            style={{ transform: `translate(${(Math.sin(a) * TAG_R).toFixed(1)}px, ${(-Math.cos(a) * TAG_R).toFixed(1)}px) translate(-50%, -50%)` } as CSSProperties}>{cv.t(`ping.${k}.name`, k)}</span>
        );
      })}
      <span class="pwheel__label t-label">{cv.t(`ping.${sel ?? 'alert'}.name`, sel ?? 'alert')}</span>
    </div>
  );
}
