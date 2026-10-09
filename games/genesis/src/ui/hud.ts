// GENESIS — the HUD (CONTRACT.md §16.1): world name + calendar (year, season, day, local hour from the planet's
// params) + time controls (pause, 1×, 10×, 100×, 1000×, step) with the achieved multiplier and fps; the worlds strip
// (click to fly) with the peoples' count on each world; system-view markers; toasts (src/ui/toasts.ts); a controls
// hint; and the dev overlay (?dev=1) with draw calls, triangles, patches, frame time and the life layer's counts.
// Plain DOM; every action calls back into the App.

/// <reference types="vite/client" />
import './styles.css';
import { Vector2 } from 'three';
import type { WorldView, PlanetView } from '../client/worldview.ts';
import type { RenderStats } from '../render/renderer.ts';
import type { CameraPose } from '../render/frame.ts';
import type { UnitVec } from '../sim/types.ts';
import { SPEED_PRESETS } from '../sim/types.ts';
import { qRotate, qRotateInv } from '../client/orbits.ts';
import { Toasts, type ToastSpec } from './toasts.ts';

export interface HudActions {
  setSpeed(x: number): void;
  step(ticks: number): void;
  flyTo(planet: number): void;
  /** fly the camera to a place on a world (a toast was clicked) */
  lookAt(planet: number, pos: UnitVec): void;
  /** select a settlement (its label was clicked) */
  selectSettlement(planet: number, id: number): void;
}

export interface HudFrame {
  view: WorldView;
  pose: CameraPose;
  stats: RenderStats;
  fps: number;
  primary: number;
  systemView: boolean;
  project(sys: ArrayLike<number>, out: Vector2): Vector2 | null;
  source: string;
  snapshotHz: number;
  /** camera altitude above the ground (m): settlement labels show between a hamlet's roofs and orbit */
  altitude: number;
  /** the selected thing: its own marker names it, so its label steps aside */
  selected?: { kind: string; id: number; planet?: number } | null;
  /** body-frame ground radius at a unit vector of a planet (labels stand on the ground) */
  groundRadius(planet: number, u: ArrayLike<number>): number;
  /** life layer counts for the dev overlay */
  life?: { people: number; ambient: number; animals: number; buildings: number; variants: number; pending: number; roads: number } | null;
}

const ICON_PAUSE = '<svg viewBox="0 0 12 12"><rect x="2" y="1.5" width="2.8" height="9" rx=".6"/><rect x="7.2" y="1.5" width="2.8" height="9" rx=".6"/></svg>';
const ICON_STEP = '<svg viewBox="0 0 12 12"><path d="M2 1.8v8.4L7.6 6z"/><rect x="8.4" y="1.8" width="1.8" height="8.4" rx=".5"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function planetColor(kind: string): string {
  switch (kind) {
    case 'terran': return 'radial-gradient(circle at 35% 30%, #bfe0ff, #3a7fc4 40%, #2d6b3a 62%, #0b1d33)';
    case 'desert': return 'radial-gradient(circle at 35% 30%, #ffd2a8, #c46a3a 50%, #4a1d0c)';
    case 'moon': return 'radial-gradient(circle at 35% 30%, #f0f0f0, #8d8d8d 55%, #232323)';
    case 'ice': return 'radial-gradient(circle at 35% 30%, #fff, #a6d2ef 55%, #29475e)';
    default: return 'radial-gradient(circle at 35% 30%, #d8d0c8, #6f665e 55%, #1b1815)';
  }
}

export class Hud {
  readonly root: HTMLDivElement;
  private worldName: HTMLSpanElement;
  private worldKind: HTMLSpanElement;
  private calText: HTMLSpanElement;
  private clock: HTMLSpanElement;
  private skyDot: HTMLSpanElement;
  private speedBtns = new Map<number, HTMLButtonElement>();
  private achieved: HTMLDivElement;
  private worlds: HTMLDivElement;
  private worldBtns = new Map<number, HTMLButtonElement>();
  private markers: HTMLDivElement;
  private markerEls = new Map<number, HTMLDivElement>();
  private labels: HTMLDivElement;
  private labelEls = new Map<string, { el: HTMLDivElement; text: string }>();
  readonly toasts: Toasts;
  private dev: HTMLDivElement | null = null;
  private hint: HTMLDivElement;
  private lastText = '';
  private v2 = new Vector2();
  private actions: HudActions;

  constructor(parent: HTMLElement, actions: HudActions, devOverlay: boolean) {
    this.actions = actions;
    this.root = el('div', 'gn-ui');
    parent.appendChild(this.root);
    // time panel
    const time = el('div', 'gn-panel gn-time');
    const world = el('div', 'gn-world');
    this.worldName = el('span', 'gn-world-name');
    this.worldKind = el('span', 'gn-world-kind');
    world.append(this.worldName, this.worldKind);
    const cal = el('div', 'gn-cal');
    this.skyDot = el('span', 'gn-sky');
    this.calText = el('span');
    this.clock = el('span', 'gn-clock');
    cal.append(this.skyDot, this.calText, this.clock);
    const speeds = el('div', 'gn-speeds');
    for (const s of SPEED_PRESETS) {
      const b = el('button', 'gn-btn', s === 0 ? ICON_PAUSE : `${s}×`) as HTMLButtonElement;
      b.type = 'button';
      b.title = s === 0 ? 'Pause (P)' : `Speed ${s}×`;
      b.setAttribute('aria-label', s === 0 ? 'Pause' : `Speed ${s} times`);
      b.addEventListener('click', () => actions.setSpeed(s));
      this.speedBtns.set(s, b);
      speeds.appendChild(b);
    }
    const step = el('button', 'gn-btn', ICON_STEP) as HTMLButtonElement;
    step.type = 'button';
    step.title = 'Step one hour (shift: one day)';
    step.setAttribute('aria-label', 'Step');
    step.addEventListener('click', (e) => actions.step(e.shiftKey ? 1440 : 60));
    speeds.appendChild(step);
    this.achieved = el('div', 'gn-achieved');
    speeds.appendChild(this.achieved);
    time.append(world, cal, speeds);
    this.root.appendChild(time);
    // worlds strip
    this.worlds = el('div', 'gn-panel gn-worlds');
    this.root.appendChild(this.worlds);
    // markers
    this.markers = el('div', 'gn-markers');
    this.root.appendChild(this.markers);
    this.labels = el('div', 'gn-markers gn-labels');
    this.root.appendChild(this.labels);
    // toasts + hint
    this.toasts = new Toasts(this.root, { lookAt: (planet, pos) => actions.lookAt(planet, pos) });
    this.hint = el('div', 'gn-panel gn-hint',
      '<kbd>drag</kbd> turn the world · <kbd>wheel</kbd> descend · <kbd>click</kbd> inspect · <kbd>right-drag</kbd> tilt · <kbd>G</kbd> system · <kbd>V</kbd> fly · <kbd>P</kbd> pause');
    this.root.appendChild(this.hint);
    if (devOverlay) {
      this.dev = el('div', 'gn-panel gn-dev');
      this.root.appendChild(this.dev);
    }
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('gn-hidden', !v);
  }

  /** a plain message (command results, warnings) */
  toast(text: string, ms = 4200, kind: ToastSpec['kind'] = 'info'): void {
    this.toasts.show({ text, ms, kind });
  }

  private syncWorlds(view: WorldView, primary: number): void {
    for (const pv of view.planets) {
      let b = this.worldBtns.get(pv.id);
      if (!b) {
        b = el('button', 'gn-btn gn-worldbtn') as HTMLButtonElement;
        b.type = 'button';
        const i = el('i');
        i.style.background = planetColor(pv.params.kind);
        const s = el('span');
        s.textContent = pv.name;
        const n = el('small', 'gn-pop');
        b.append(i, s, n);
        b.title = `Fly to ${pv.name}`;
        const id = pv.id;
        b.addEventListener('click', () => this.actions.flyTo(id));
        this.worldBtns.set(pv.id, b);
        this.worlds.appendChild(b);
      }
      b.classList.toggle('gn-here', pv.id === primary);
      // the peoples on each world (sum over species, cohorts included)
      let pop = 0;
      for (const v of pv.population) pop += v;
      const badge = b.lastElementChild as HTMLElement;
      const txt = pop > 0 ? (pop >= 10000 ? `${Math.round(pop / 1000)}k` : String(pop)) : '';
      if (badge.textContent !== txt) { badge.textContent = txt; b.title = `Fly to ${pv.name}${pop ? ` — ${pop} living` : ''}`; }
    }
    for (const [id, b] of this.worldBtns) if (!view.planet(id)) { b.remove(); this.worldBtns.delete(id); }
  }

  private syncMarkers(f: HudFrame): void {
    const show = f.systemView;
    for (const pv of f.view.planets) {
      let m = this.markerEls.get(pv.id);
      if (!m) {
        m = el('div', 'gn-marker' + (pv.params.orbit.parent >= 0 ? ' gn-moon' : ''));
        m.append(el('div', 'gn-ring'), el('div', 'gn-label'));
        const id = pv.id;
        m.addEventListener('click', () => this.actions.flyTo(id));
        this.markerEls.set(pv.id, m);
        this.markers.appendChild(m);
      }
      const p = show ? f.project(pv.center, this.v2) : null;
      if (!p) { m.style.opacity = '0'; m.style.pointerEvents = 'none'; continue; }
      m.style.opacity = '1';
      m.style.pointerEvents = 'auto';
      m.style.left = `${p.x.toFixed(1)}px`;
      m.style.top = `${p.y.toFixed(1)}px`;
      const label = m.lastElementChild as HTMLDivElement;
      const txt = `${pv.name}<small>${pv.params.kind}</small>`;
      if (label.innerHTML !== txt) label.innerHTML = txt;
    }
  }

  /**
   * Settlement names over the primary world, from a few hundred metres up to low orbit: name, people and age (the
   * nearest dozen, fading with distance; a band's label follows its people). Click: select the settlement.
   */
  private syncLabels(f: HudFrame, pv: PlanetView | undefined): void {
    const seen = new Set<string>();
    const alt = f.altitude;
    if (pv && !f.systemView && alt > 70 && alt < 9000 && pv.settlements.length) {
      const R = pv.params.radius;
      const cam = f.pose.pos;
      const rel: [number, number, number] = [cam[0] - pv.center[0], cam[1] - pv.center[1], cam[2] - pv.center[2]];
      const cb = qRotateInv(pv.quat, rel);
      const cl = Math.hypot(cb[0], cb[1], cb[2]) || 1;
      const near = pv.settlements
        .filter((s) => !(s.flags & 2))
        .map((s) => ({ s, d: Math.acos(Math.min(1, (s.pos[0] * cb[0] + s.pos[1] * cb[1] + s.pos[2] * cb[2]) / cl)) * R }))
        .filter((q) => q.d < Math.max(900, alt * 2.2))
        .sort((a, b) => a.d - b.d)
        .slice(0, 12);
      const sel = f.selected && f.selected.kind === 'settlement' ? f.selected.id : -1;
      for (const { s, d } of near) {
        if (s.id === sel) continue;
        const key = `${pv.id}:${s.id}`;
        const g = f.groundRadius(pv.id, s.pos) + Math.min(40, 12 + alt * 0.02);
        const w = qRotate(pv.quat, [s.pos[0] * g, s.pos[1] * g, s.pos[2] * g]);
        const sys = [pv.center[0] + w[0], pv.center[1] + w[1], pv.center[2] + w[2]];
        const p = f.project(sys, this.v2);
        if (!p || p.x < -80 || p.y < -40 || p.x > window.innerWidth + 80 || p.y > window.innerHeight + 40) continue;
        // behind the planet's limb from orbit: the label's point is farther than the horizon
        const eye = Math.hypot(rel[0], rel[1], rel[2]);
        const toLabel = Math.hypot(sys[0] - cam[0], sys[1] - cam[1], sys[2] - cam[2]);
        if (toLabel > Math.sqrt(Math.max(0, eye * eye - R * R)) + 200) continue;
        seen.add(key);
        let rec = this.labelEls.get(key);
        if (!rec) {
          const e = el('div', 'gn-slabel');
          e.append(el('div', 'gn-slabel-name'), el('div', 'gn-slabel-sub'));
          const id = s.id, planet = pv.id;
          e.addEventListener('click', () => this.actions.selectSettlement(planet, id));
          this.labels.appendChild(e);
          rec = { el: e, text: '' };
          this.labelEls.set(key, rec);
        }
        const sub = `${s.population} · ${s.flags & 1 ? 'wandering' : `${s.era} age`}`;
        const text = `${s.name}|${sub}`;
        if (rec.text !== text) {
          rec.text = text;
          (rec.el.firstElementChild as HTMLElement).textContent = s.name;
          (rec.el.lastElementChild as HTMLElement).textContent = sub;
        }
        const fade = Math.max(0.25, Math.min(1, 1.4 - d / Math.max(900, alt * 2.2)));
        rec.el.style.opacity = fade.toFixed(2);
        rec.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    for (const [k, r] of this.labelEls) if (!seen.has(k)) { r.el.remove(); this.labelEls.delete(k); }
  }

  update(f: HudFrame): void {
    const view = f.view;
    const pv: PlanetView | undefined = view.planet(f.primary) ?? view.planets[0];
    this.syncWorlds(view, f.primary);
    this.syncMarkers(f);
    this.syncLabels(f, view.planet(f.primary));
    if (pv) {
      const cal = view.calendar(pv);
      // local hour at the camera's longitude (the HUD shows the time where you are looking)
      const lonHours = this.cameraLonHours(f, pv);
      let hour = cal.hour + lonHours;
      hour = ((hour % pv.params.dayHours) + pv.params.dayHours) % pv.params.dayHours;
      const hh = Math.floor(hour);
      const mm = Math.floor((hour - hh) * 60);
      const text = `Year ${cal.year}<span class="gn-sep">·</span>${cal.season}<span class="gn-sep">·</span>Day ${cal.day}`;
      if (text !== this.lastText) { this.calText.innerHTML = text; this.lastText = text; }
      this.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      const day = hour > 6 && hour < 18;
      const dusk = (hour > 5 && hour <= 7) || (hour >= 17 && hour < 19.5);
      this.skyDot.style.color = dusk ? '#f0a46b' : day ? '#f3dfae' : '#7d9cd6';
      this.skyDot.style.background = this.skyDot.style.color;
      if (this.worldName.textContent !== pv.name) this.worldName.textContent = pv.name;
      const kind = pv.params.atmosphere.pressure > 0 ? pv.params.kind : `${pv.params.kind} · airless`;
      if (this.worldKind.textContent !== kind) this.worldKind.textContent = kind;
    }
    for (const [s, b] of this.speedBtns) b.classList.toggle('gn-on', view.speed === s);
    const behind = view.speed > 0 && view.achievedSpeed < view.speed * 0.9;
    this.achieved.classList.toggle('gn-behind', behind);
    this.achieved.innerHTML = `<b>${view.speed === 0 ? 'paused' : '×' + fmtSpeed(view.achievedSpeed)}</b> · ${f.fps.toFixed(0)} fps`;
    if (this.dev) {
      const st = f.stats;
      this.dev.innerHTML = [
        ['draw calls', st.drawCalls.toLocaleString()],
        ['triangles', st.triangles.toLocaleString()],
        ['frame', `${st.frameMs.toFixed(1)} ms cpu`],
        ['patches', `${st.gpuPatches} (+${st.waterPatches} water)`],
        ['render', `${st.renderW}×${st.renderH}`],
        ['altitude', st.altitude < 1e5 ? `${st.altitude.toFixed(1)} m` : `${(st.altitude / 1000).toFixed(0)} km`],
        ['world', st.primary],
        ['tick', view.renderTick.toFixed(1)],
        ['sim', `${f.source} · ${f.snapshotHz.toFixed(0)} Hz · ${view.msPerTick.toFixed(2)} ms/tick`],
        ...(f.life ? [
          ['people', `${f.life.people} drawn${f.life.ambient ? ` + ${f.life.ambient} ambient` : ''}`],
          ['animals', `${f.life.animals}`],
          ['buildings', `${f.life.buildings} · ${f.life.variants} variants${f.life.pending ? ` (${f.life.pending} pending)` : ''}`],
          ['roads', `${f.life.roads} chains`],
        ] : []),
      ].map(([k, v]) => `<div class="gn-row"><span>${k}</span><b>${v}</b></div>`).join('');
    }
  }

  private cameraLonHours(f: HudFrame, pv: PlanetView): number {
    // camera position in the body frame → longitude (0 at +Z, east positive) → hours east of the meridian
    const b = qRotateInv(pv.quat, [f.pose.pos[0] - pv.center[0], f.pose.pos[1] - pv.center[1], f.pose.pos[2] - pv.center[2]]);
    return (Math.atan2(b[0], b[2]) / (2 * Math.PI)) * pv.params.dayHours;
  }
}

function fmtSpeed(x: number): string {
  if (x >= 100) return x.toFixed(0);
  if (x >= 10) return x.toFixed(1);
  return x.toFixed(2);
}
