// GENESIS — the phase-1 HUD (CONTRACT.md §16.1): world name + calendar (year, season, day, local hour from the
// planet's params) + time controls (pause, 1×, 10×, 100×, 1000×, step) with the achieved multiplier and fps; the
// worlds strip (click to fly); system-view markers; toasts; a controls hint; and the dev overlay (?dev=1) with draw
// calls, triangles, patches and frame time. Plain DOM; every action calls back into the App.

/// <reference types="vite/client" />
import './styles.css';
import { Vector2 } from 'three';
import type { WorldView, PlanetView } from '../client/worldview.ts';
import type { RenderStats } from '../render/renderer.ts';
import type { CameraPose } from '../render/frame.ts';
import { SPEED_PRESETS } from '../sim/types.ts';
import { qRotateInv } from '../client/orbits.ts';

export interface HudActions {
  setSpeed(x: number): void;
  step(ticks: number): void;
  flyTo(planet: number): void;
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
  private toasts: HTMLDivElement;
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
    // toasts + hint
    this.toasts = el('div', 'gn-toasts');
    this.root.appendChild(this.toasts);
    this.hint = el('div', 'gn-panel gn-hint',
      '<kbd>drag</kbd> turn the world · <kbd>wheel</kbd> descend · <kbd>right-drag</kbd> tilt · <kbd>G</kbd> system · <kbd>V</kbd> fly · <kbd>P</kbd> pause');
    this.root.appendChild(this.hint);
    if (devOverlay) {
      this.dev = el('div', 'gn-panel gn-dev');
      this.root.appendChild(this.dev);
    }
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('gn-hidden', !v);
  }

  toast(text: string, ms = 4200): void {
    const t = el('div', 'gn-panel gn-toast');
    t.textContent = text;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => { t.classList.add('gn-out'); setTimeout(() => t.remove(), 520); }, ms);
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
        b.append(i, s);
        b.title = `Fly to ${pv.name}`;
        const id = pv.id;
        b.addEventListener('click', () => this.actions.flyTo(id));
        this.worldBtns.set(pv.id, b);
        this.worlds.appendChild(b);
      }
      b.classList.toggle('gn-here', pv.id === primary);
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

  update(f: HudFrame): void {
    const view = f.view;
    const pv: PlanetView | undefined = view.planet(f.primary) ?? view.planets[0];
    this.syncWorlds(view, f.primary);
    this.syncMarkers(f);
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
