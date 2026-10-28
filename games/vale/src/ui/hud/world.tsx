// VALE HUD — the world-anchored layer and the ping wheel.
//
// WorldLayer: DOM marks projected through the renderer's worldToScreen every frame (imperative: no
// re-render per frame). Bible "HUD density": damage numbers only for YOUR outgoing hits and heals
// ≥ 5 % max HP (the model filters), merged per 0.5 s per target and type, at most 8 on screen;
// physical upright Chalkstone, magic Orchid-rose with the oval chip, true as dark numerals with a
// Noonwhite halo, heals Sap with "+" and always rising, crits larger. Gleam pops rise in chalk with the
// glint. Move / attack-move / attack markers (a ground ring that closes, HARM for attacks). Team pings
// at their ground point: the kind's silhouette over a ripple, 4 s.
// PingWheel: the radial menu while the ping key is held (client_hud §5): nine kinds clockwise from 12
// o'clock, a dead zone in the middle (a release there pings "Look here").

import type { CSSProperties, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import type { EntityId } from '../../contracts/sim.ts';
import { PING_ORDER, type Marker } from '../../input/index.ts';
import { useApp } from '../app_ctx.ts';
import { fmtInt } from '../format.ts';
import { useHud } from './ctx.ts';
import { PingGlyph } from './glyphs.tsx';
import type { NumberPop } from './model.ts';

export interface MarkerMark extends Marker { id: number; at: number }
export interface WorldMarks { markers: Signal<MarkerMark[]> }

const MERGE_MS = 500;
const MAX_POPS = 8;
const POP_MS = { damage: 900, heal: 1100, gold: 1100 } as const;
const MARKER_MS = 520;
const PING_MS = 4000;
/** overhead anchor for numbers (metres above the ground) */
const HEAD_M = 2.3;
/** the camera pitch squashes ground circles (52°: sin ≈ 0.79) */
const GROUND_SQUASH = 0.79;

interface Pop { el: HTMLElement; n: NumberPop; total: number; born: number; last: number; jitter: number; key: string }
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
      if (pops.length >= MAX_POPS) { const old = pops.shift(); old?.el.remove(); }
      const el = document.createElement('span');
      const pop: Pop = { el, n, total: n.amount, born: now, last: now, jitter: ((seq++ * 0.61803) % 1) * 2 - 1, key };
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
    };

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const v = model.view;
      // numbers
      for (let i = pops.length - 1; i >= 0; i--) {
        const x = pops[i];
        const life = POP_MS[x.n.kind];
        const t = (now - x.born) / life;
        if (t >= 1) { x.el.remove(); pops.splice(i, 1); continue; }
        const e = x.n.dst >= 0 ? v.entity(x.n.dst as EntityId) : undefined;
        const wx = e && e.alive ? e.x : x.n.x, wy = e && e.alive ? e.y : x.n.y;
        const s = toScreen(wx, wy, x.n.kind === 'gold' ? 1.2 : HEAD_M);
        if (!s.visible) { x.el.style.opacity = '0'; continue; }
        const rise = x.n.kind === 'damage' ? 26 * easeOut(t) : 44 * easeOut(t);
        const dx = x.jitter * (x.n.kind === 'damage' ? 22 : 8);
        const pop = t < 0.12 ? 1 + (x.n.crit ? 0.5 : 0.25) * (1 - t / 0.12) : 1;
        x.el.style.transform = `translate(${(s.x + dx).toFixed(1)}px, ${(s.y - rise).toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
        x.el.style.opacity = t > 0.7 ? String(Math.max(0, 1 - (t - 0.7) / 0.3)) : '1';
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
        const k = mk.m.kind === 'attack' ? 1.25 - 0.35 * easeOut(t) : 1 - 0.55 * easeOut(t);
        mk.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%) scale(${k.toFixed(3)}, ${(k * GROUND_SQUASH).toFixed(3)})`;
        mk.el.style.opacity = String(1 - t * t);
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

// ── ping wheel ───────────────────────────────────────────────────────────────────────────────────
const WHEEL_R = 92;

export function PingWheel(): JSX.Element | null {
  const { cv } = useApp();
  const { input } = useHud();
  const w = input.wheel.value;
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
      <span class="pwheel__label t-label">{cv.t(`ping.${sel ?? 'alert'}.name`, sel ?? 'alert')}</span>
    </div>
  );
}
