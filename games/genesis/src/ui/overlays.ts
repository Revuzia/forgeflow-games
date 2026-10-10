// GENESIS — map overlays (CONTRACT.md §16.8; O cycles, ⇧O back, Alt+O off): temperature, moisture, biome, belief,
// territory, era (knowledge), ore, population, trade routes and wars, pollution — and fertility and radiation, since a
// list is a floor. Each overlay turns the WorldView's per-cell fields and settlements into a colour per cell; the
// renderer's terrain draws them through a map texture (src/render/planet/overlaytex.ts, terrainmat.ts uOverlay), so
// the colours hug every slope at every distance. Trade routes and wars are lines between settlements drawn over the
// screen. The ramps follow the colour-blind palette chosen in the settings (standard, deuteranopia, protanopia,
// tritanopia, monochrome). A legend card says what the colours mean and switches overlays with a click.
//
// While a map is on, the cloud shell thins away (the renderer's coverage bias, through the App) so the map is not
// half hidden, the sea takes the map's colour too (the water material reads the same overlay texture), and a chip at
// the cursor reads the value under it ("14.2 °C", "Isobar · 62 % believe, loved"). Belief is a diverging map: gold
// where they love you, red where they fear you, grey where nobody believes.

import type { IUniform } from 'three';
import type { FieldName } from '../sim/types.ts';
import type { PlanetView } from '../client/worldview.ts';
import type { UiHost } from './host.ts';
import type { CvdPalette } from './prefs.ts';
import { OverlayMap, applyOverlay } from '../render/planet/overlaytex.ts';
import { BASE_PACK } from '../data/index.ts';
import { h, clear, fmtNum, fmtDist } from './dom.ts';
import { icon } from './icons.ts';

type RGB = [number, number, number];

export const ERAS = ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space'];

interface Legend { kind: 'ramp'; stops: string[]; min: string; max: string; note?: string }
interface Cats { kind: 'cats'; items: { label: string; color: string }[]; note?: string }

export interface OverlayDef {
  id: string;
  label: string;
  icon: string;
  /** fields whose change recomputes the overlay (settlement-based overlays recompute on every snapshot, throttled) */
  fields: FieldName[];
  live?: boolean;
}

export const OVERLAYS: OverlayDef[] = [
  { id: 'temperature', label: 'Temperature', icon: 'thermometer', fields: ['temperature'] },
  { id: 'moisture', label: 'Moisture', icon: 'water', fields: ['moisture', 'water'] },
  { id: 'biome', label: 'Biomes', icon: 'biome', fields: ['biome'] },
  { id: 'belief', label: 'Belief', icon: 'worship', fields: ['territory'], live: true },
  { id: 'territory', label: 'Territory', icon: 'sign', fields: ['territory'], live: true },
  { id: 'era', label: 'Knowledge (era)', icon: 'book', fields: ['territory'], live: true },
  { id: 'ore', label: 'Ore', icon: 'rock', fields: ['ore', 'oreType'] },
  { id: 'population', label: 'Population', icon: 'people', fields: ['territory'], live: true },
  { id: 'trade', label: 'Trade and war', icon: 'dove', fields: ['territory'], live: true },
  { id: 'pollution', label: 'Pollution', icon: 'flask', fields: ['pollution'] },
  { id: 'fertility', label: 'Fertility', icon: 'sprout', fields: ['fertility'] },
  { id: 'radiation', label: 'Radiation', icon: 'd-solar-flare', fields: ['radiation'] },
];

// ───────────────────────────── palettes ─────────────────────────────

/** what the belief overlay's love and fear hues are called in each palette (the legend says it in words) */
const HUE_NAMES: Record<CvdPalette, [string, string]> = {
  standard: ['Gold', 'red'], deuteranopia: ['Orange', 'blue'], protanopia: ['Orange', 'blue'], tritanopia: ['Pink', 'green'], monochrome: ['White', 'dark grey'],
};

const hex = (s: string): RGB => s.length === 4
  ? [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16)]
  : [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

const RAMPS: Record<CvdPalette, { diverge: string[]; seq: string[]; wet: string[]; heat: string[]; era: string[]; good: string; bad: string; war: string; trade: string }> = {
  standard: {
    diverge: ['#2c4f9e', '#4f9ac8', '#cfe6e0', '#f2efe2', '#f2c46a', '#e0703a', '#b3222f'],
    seq: ['#1d1a3a', '#5b2a6e', '#b03d63', '#ec7b47', '#fdd79a'],
    wet: ['#7a4a22', '#c9a35a', '#d9d6a0', '#6fb08a', '#2f7fb8', '#1d3f8a'],
    heat: ['#22301e', '#59702a', '#b8a83a', '#e08a2a', '#c23a2a', '#6a1a3a'],
    era: ['#6e6152', '#a0703c', '#c98a4a', '#d8a956', '#c9c27a', '#8fbf8a', '#5fae9e', '#4f8fbf', '#6f6fcf', '#a46fd9', '#e9e6ff'],
    good: '#f0cf86', bad: '#c0392b', war: '#e8573c', trade: '#f3dfae',
  },
  deuteranopia: {
    // blue ↔ orange (PuOr-like): no red–green axis
    diverge: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fdb863', '#e08214', '#b35806'],
    seq: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    wet: ['#8c510a', '#d8b365', '#f6e8c3', '#c7eae5', '#5ab4ac', '#01665e'],
    heat: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
    era: ['#00204d', '#00336f', '#39486b', '#575c6d', '#707173', '#8a8779', '#a69d75', '#c4b56c', '#e4cf5b', '#ffe945', '#ffffb0'],
    good: '#fdb863', bad: '#2166ac', war: '#e08214', trade: '#f7f7f7',
  },
  protanopia: {
    diverge: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fdb863', '#e08214', '#b35806'],
    seq: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    wet: ['#8c510a', '#d8b365', '#f6e8c3', '#c7eae5', '#5ab4ac', '#01665e'],
    heat: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
    era: ['#00204d', '#00336f', '#39486b', '#575c6d', '#707173', '#8a8779', '#a69d75', '#c4b56c', '#e4cf5b', '#ffe945', '#ffffb0'],
    good: '#fdb863', bad: '#2166ac', war: '#e08214', trade: '#f7f7f7',
  },
  tritanopia: {
    diverge: ['#4dac26', '#b8e186', '#e6f5d0', '#f7f7f7', '#fde0ef', '#f1b6da', '#d01c8b'],
    seq: ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
    wet: ['#a6611a', '#dfc27d', '#f5f5f5', '#c2a5cf', '#7b3294', '#40004b'],
    heat: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
    era: ['#0d0887', '#41049d', '#6a00a8', '#8f0da4', '#b12a90', '#cc4778', '#e16462', '#f2844b', '#fca636', '#fcce25', '#f0f921'],
    good: '#f1b6da', bad: '#4dac26', war: '#d01c8b', trade: '#f7f7f7',
  },
  monochrome: {
    diverge: ['#1a1a1a', '#4a4a4a', '#7a7a7a', '#a8a8a8', '#c8c8c8', '#e2e2e2', '#ffffff'],
    seq: ['#141414', '#4a4a4a', '#808080', '#b8b8b8', '#f2f2f2'],
    wet: ['#1a1a1a', '#444', '#6e6e6e', '#999', '#c4c4c4', '#f0f0f0'],
    heat: ['#141414', '#3a3a3a', '#666', '#929292', '#c0c0c0', '#eee'],
    era: ['#111', '#222', '#333', '#444', '#555', '#777', '#999', '#aaa', '#ccc', '#ddd', '#fff'],
    good: '#ffffff', bad: '#555555', war: '#dddddd', trade: '#aaaaaa',
  },
};

function ramp(stops: string[]): (t: number) => RGB {
  const cs = stops.map(hex);
  return (t: number) => {
    const x = Math.max(0, Math.min(1, t)) * (cs.length - 1);
    const i = Math.min(cs.length - 2, Math.floor(x));
    const f = x - i;
    const a = cs[i], b = cs[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
}

const BIOMES = (BASE_PACK.biomes ?? []) as unknown as { id: string; name: string; color: string }[];
const ORES = (BASE_PACK.ores ?? []) as unknown as { id: string; name: string; color: string }[];

export interface OverlayDeps {
  host: UiHost;
  /** the planet's shared terrain uniforms (null when it is not drawn) */
  uniformsOf(planet: number): Record<string, IUniform> | null;
  palette(): CvdPalette;
  /** thin the clouds while a map is on (0 = the weather's own, 1 = none) */
  cloudFade?(k: number): void;
}

export class Overlays {
  readonly legend: HTMLDivElement;
  readonly svg: SVGSVGElement;
  private deps: OverlayDeps;
  mode: string | null = null;
  private maps = new Map<number, OverlayMap>();
  private rgba = new Map<number, Uint8Array>();
  /** what each planet's map was last computed from */
  private stamp = new Map<number, string>();
  private computedAt = new Map<number, number>();
  private applied = new Set<number>();
  private legendKey = '';
  /** the value under the cursor */
  readonly chip: HTMLDivElement;
  private chipAt = 0;
  private fade = 0;
  private fadeAt = performance.now();
  /** when the previous frame ran (the map build's budget follows the frame time) */
  private lastFrameAt = performance.now();
  onChange: (() => void) | null = null;

  constructor(parent: HTMLElement, worldLayer: HTMLElement, deps: OverlayDeps) {
    this.deps = deps;
    this.legend = h('div', { class: 'gn-panel gn-legend', role: 'region', aria: { label: 'Map overlay' } });
    this.legend.hidden = true;
    parent.appendChild(this.legend);
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'gn-routes');
    worldLayer.appendChild(this.svg);
    this.chip = h('div', { class: 'gn-ovchip' });
    this.chip.hidden = true;
    worldLayer.appendChild(this.chip);
  }

  set(id: string | null): void {
    const next = id && OVERLAYS.some((o) => o.id === id) ? id : null;
    if (next === this.mode) return;
    this.mode = next;
    this.stamp.clear();
    this.legendKey = '';
    if (!next) {
      for (const pid of this.applied) { const u = this.deps.uniformsOf(pid); if (u) applyOverlay(u, null); }
      this.applied.clear();
      this.legend.hidden = true;
      this.chip.hidden = true;
      clear(this.svg);
    } else this.legend.hidden = false;
    this.onChange?.();
  }

  cycle(d: number): void {
    const i = this.mode ? OVERLAYS.findIndex((o) => o.id === this.mode) : -1;
    const n = OVERLAYS.length + 1; // + off
    const j = (((i + 1 + d) % n) + n) % n;
    this.set(j === 0 ? null : OVERLAYS[j - 1].id);
  }

  /** per frame: keep the primary world's overlay current; draw routes */
  frame(): void {
    const host = this.deps.host;
    const pid = host.primary();
    const pv = host.view.planet(pid);
    // the clouds thin away while a map is shown (eased over ~0.7 s of real time, so the sky does not jump and a slow
    // frame does not stretch it)
    const want = this.mode ? 1 : 0;
    const tNow = performance.now();
    if (this.fade !== want) {
      const step = Math.min(1, (tNow - this.fadeAt) / 700);
      this.fade = want > this.fade ? Math.min(1, this.fade + step) : Math.max(0, this.fade - step);
      this.deps.cloudFade?.(this.fade);
    }
    this.fadeAt = tNow;
    const lastFrame = this.lastFrameAt;
    this.lastFrameAt = tNow;
    // worlds no longer primary drop the overlay (one map is computed at a time)
    for (const id of [...this.applied]) if (id !== pid || !this.mode) { const u = this.deps.uniformsOf(id); if (u) applyOverlay(u, null); this.applied.delete(id); }
    if (!this.mode || !pv) { if (this.mode) this.renderLegend(null); return; }
    const def = OVERLAYS.find((o) => o.id === this.mode)!;
    let map = this.maps.get(pv.id);
    if (!map || map.grid !== pv.grid) { map?.dispose(); map = new OverlayMap(pv.grid); this.maps.set(pv.id, map); this.stamp.delete(pv.id); }
    const building = !map.ready;
    // the texel → cells table: as many rows as ~6 ms allow this frame (a tenth of the frame when frames are slow, so a
    // software-rendered page is not left with half a map for minutes)
    if (building) {
      const t0 = performance.now();
      const budget = Math.min(150, Math.max(6, (t0 - lastFrame) * 0.1));
      do map.build(16); while (!map.ready && performance.now() - t0 < budget);
    }
    // recompute when the inputs changed (fields) or, for settlement overlays, at most every 0.8 s
    const st = `${this.mode}|${this.deps.palette()}|${def.fields.map((f) => host.view.fieldVersionOf(pv, f)).join(',')}|${building ? Math.random() : ''}`;
    const now = performance.now();
    const due = def.live ? now - (this.computedAt.get(pv.id) ?? -1e9) > 800 : false;
    if (this.stamp.get(pv.id) !== st || due) {
      this.stamp.set(pv.id, st);
      this.computedAt.set(pv.id, now);
      const rgba = this.compute(def, pv);
      map.fill(rgba);
    }
    const u = this.deps.uniformsOf(pv.id);
    if (u) { applyOverlay(u, map, 0.84, def.id === 'territory' || def.id === 'trade' ? 0.26 : 0.32); this.applied.add(pv.id); }
    this.renderLegend(pv);
    if (def.id === 'trade' || def.id === 'territory') this.routes(pv, def.id === 'trade'); else clear(this.svg);
    this.valueChip(def, pv);
  }

  /** the value under the cursor, beside it */
  private valueChip(def: OverlayDef, pv: PlanetView): void {
    const now = performance.now();
    if (now - this.chipAt < 100) return;
    this.chipAt = now;
    const host = this.deps.host;
    const g = host.cursorGround();
    if (!g || g.planet !== pv.id) { this.chip.hidden = true; return; }
    const text = this.valueAt(def.id, pv, g.cell);
    const s = host.screenOf(g.planet, g.dir, 1);
    if (!text || !s) { this.chip.hidden = true; return; }
    this.chip.hidden = false;
    if (this.chip.textContent !== text) this.chip.textContent = text;
    this.chip.style.transform = `translate(${(s[0] + 16).toFixed(1)}px, ${(s[1] + 14).toFixed(1)}px)`;
  }

  /** an overlay's value at a cell, in words */
  valueAt(id: string, pv: PlanetView, c: number): string {
    const F = (f: FieldName) => pv.fields.get(f);
    const water = F('water')?.[c] ?? 0;
    const sea = water > 1.5 ? ` · under ${fmtDist(water)} of water` : '';
    const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)} %`;
    const terr = F('territory');
    const sid = terr ? Math.round(terr[c]) : -1;
    const st = sid >= 0 ? pv.settlements.find((q) => q.id === sid && !(q.flags & 2)) : undefined;
    switch (id) {
      case 'temperature': { const t = F('temperature'); return t ? `${t[c].toFixed(1)} °C${sea}` : ''; }
      case 'moisture': { const m = F('moisture'); return m ? `soil ${pct(m[c])} wet${sea}` : ''; }
      case 'biome': { const b = F('biome'); return b ? BIOMES[Math.round(b[c])]?.name ?? '' : ''; }
      case 'ore': {
        const o = F('ore'), t = F('oreType');
        if (!o || !t) return '';
        const i = Math.round(t[c]) - 1;
        return i >= 0 && o[c] > 0.02 ? `${ORES[i]?.name ?? 'ore'} · ${o[c] > 0.6 ? 'rich' : o[c] > 0.25 ? 'fair' : 'poor'} (${pct(o[c])})` : 'no ore';
      }
      case 'pollution': case 'fertility': case 'radiation': { const f = F(id as FieldName); return f ? `${id} ${pct(f[c])}` : ''; }
      case 'territory': return st ? `${st.name} · ${st.population} souls` : "nobody's land";
      case 'era': return st ? `${st.name} · ${st.era} age` : "nobody's land";
      case 'belief': return st ? `${st.name} · ${Math.round(st.belief * 100)} % believe, ${st.alignment > 0.25 ? 'loved' : st.alignment < -0.25 ? 'feared' : 'loved and feared'}` : 'nobody lives here';
      case 'trade': return st ? `${st.name}${st.trade?.length ? ` · trades with ${st.trade.length}` : ''}${st.war?.length ? ` · at war with ${st.war.length}` : ''}${!st.trade?.length && !st.war?.length ? ' · keeps to itself' : ''}` : "nobody's land";
      case 'population': return st ? `${st.name} · ${st.population} souls` : 'empty land';
    }
    return '';
  }

  // ───────────────────────────── per-cell colours ─────────────────────────────

  private compute(def: OverlayDef, pv: PlanetView): Uint8Array {
    const n = pv.grid.count;
    let out = this.rgba.get(pv.id);
    if (!out || out.length !== n * 4) { out = new Uint8Array(n * 4); this.rgba.set(pv.id, out); }
    out.fill(0);
    const pal = RAMPS[this.deps.palette()];
    const F = (f: FieldName) => pv.fields.get(f);
    const put = (c: number, rgb: RGB, a: number) => { out![c * 4] = rgb[0]; out![c * 4 + 1] = rgb[1]; out![c * 4 + 2] = rgb[2]; out![c * 4 + 3] = Math.max(0, Math.min(255, a * 255)); };
    const water = F('water');
    const wet = (c: number) => (water ? water[c] > 1.5 : false);
    switch (def.id) {
      case 'temperature': {
        const t = F('temperature'); if (!t) break;
        const r = ramp(pal.diverge);
        for (let c = 0; c < n; c++) put(c, r((t[c] + 30) / 75), wet(c) ? 0.55 : 0.92);
        break;
      }
      case 'moisture': {
        const m = F('moisture'); if (!m) break;
        const r = ramp(pal.wet);
        for (let c = 0; c < n; c++) put(c, r(wet(c) ? 1 : m[c]), wet(c) ? 0.35 : 0.9);
        break;
      }
      case 'biome': {
        const b = F('biome'); if (!b) break;
        const cols = BIOMES.map((x) => hex(x.color));
        for (let c = 0; c < n; c++) { const i = Math.round(b[c]); if (cols[i]) put(c, cols[i], 0.9); }
        break;
      }
      case 'ore': {
        const o = F('ore'), ot = F('oreType'); if (!o || !ot) break;
        const cols = ORES.map((x) => hex(x.color));
        for (let c = 0; c < n; c++) { const i = Math.round(ot[c]) - 1; if (i >= 0 && cols[i] && o[c] > 0.02) put(c, cols[i], 0.35 + Math.min(1, o[c]) * 0.6); }
        break;
      }
      case 'pollution': case 'fertility': case 'radiation': {
        const f = F(def.id as FieldName); if (!f) break;
        const r = ramp(def.id === 'fertility' ? pal.wet : pal.heat);
        for (let c = 0; c < n; c++) { const v = Math.max(0, Math.min(1, f[c])); if (def.id === 'fertility' || v > 0.004) put(c, r(def.id === 'fertility' ? v : Math.sqrt(v)), def.id === 'fertility' ? (wet(c) ? 0.2 : 0.85) : 0.25 + v * 0.7); }
        break;
      }
      case 'territory': case 'belief': case 'era': case 'trade': this.territorial(def.id, pv, put, pal); break;
      case 'population': this.population(pv, put, pal); break;
    }
    return out;
  }

  private territorial(id: string, pv: PlanetView, put: (c: number, rgb: RGB, a: number) => void, pal: (typeof RAMPS)['standard']): void {
    const terr = pv.fields.get('territory');
    if (!terr) return;
    const byId = new Map(pv.settlements.map((s) => [s.id, s]));
    const eraR = ramp(pal.era);
    const grey: RGB = [120, 118, 112];
    const beliefR = ramp(beliefStops(pal));
    const g = pv.grid;
    for (let c = 0; c < g.count; c++) {
      const sid = Math.round(terr[c]);
      if (sid < 0) continue;
      const s = byId.get(sid);
      if (!s || (s.flags & 2)) continue;
      // borders: a cell next to another settlement's land (or none) is drawn stronger
      let edge = false;
      for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) if (Math.round(terr[g.nbr[k]]) !== sid) { edge = true; break; }
      let rgb: RGB;
      let a = edge ? 0.95 : 0.55;
      if (id === 'territory') rgb = [(s.color >> 16) & 255, (s.color >> 8) & 255, s.color & 255];
      else if (id === 'era') rgb = eraR(Math.max(0, ERAS.indexOf(s.era)) / (ERAS.length - 1));
      else if (id === 'belief') {
        // belief in the player god on a diverging ramp: −1 all fear (red) … 0 nobody believes (grey) … +1 all love (gold)
        const b = Math.max(0, Math.min(1, s.belief));
        const v = Math.max(-1, Math.min(1, b * Math.sign(s.alignment || 0) * Math.max(0.35, Math.abs(s.alignment))));
        rgb = beliefR((v + 1) / 2);
        a = edge ? 0.95 : 0.4 + Math.abs(v) * 0.45;
      } else {
        // trade: towns that trade glow, towns at war burn; others dim
        const tr = s.trade?.length ?? 0, wr = s.war?.length ?? 0;
        rgb = wr ? hex(pal.war) : tr ? hex(pal.trade) : grey;
        a = edge ? 0.9 : wr || tr ? 0.5 : 0.25;
      }
      put(c, rgb, a);
    }
  }

  private population(pv: PlanetView, put: (c: number, rgb: RGB, a: number) => void, pal: (typeof RAMPS)['standard']): void {
    const g = pv.grid;
    const dens = new Float32Array(g.count);
    const A = pv.agents;
    if (A) for (let i = 0; i < A.count; i++) dens[g.nearestCell(A.pos[i * 3], A.pos[i * 3 + 1], A.pos[i * 3 + 2])] += 1;
    // cohort members live around their town: spread over its land
    const terr = pv.fields.get('territory');
    if (terr) {
      const cells = new Map<number, number[]>();
      for (let c = 0; c < g.count; c++) { const s = Math.round(terr[c]); if (s >= 0) { const l = cells.get(s) ?? []; l.push(c); cells.set(s, l); } }
      for (const s of pv.settlements) { const l = cells.get(s.id); if (l && s.cohort > 0) for (const c of l) dens[c] += s.cohort / l.length; }
    }
    // two passes of neighbour smoothing: people are a cloud, not a cell
    let a = dens, b = new Float32Array(g.count);
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < g.count; c++) {
        let s = a[c] * 2, w = 2;
        for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) { s += a[g.nbr[k]]; w++; }
        b[c] = s / w;
      }
      [a, b] = [b, a];
    }
    const r = ramp(pal.seq);
    for (let c = 0; c < g.count; c++) if (a[c] > 0.02) put(c, r(Math.log10(1 + a[c] * 3) / 2), Math.min(0.95, 0.3 + Math.log10(1 + a[c] * 8) * 0.4));
  }

  /** trade routes and wars: lines between settlements on screen */
  private routes(pv: PlanetView, all: boolean): void {
    clear(this.svg);
    const host = this.deps.host;
    const pal = RAMPS[this.deps.palette()];
    const seen = new Set<string>();
    const byId = new Map(pv.settlements.map((s) => [s.id, s]));
    for (const s of pv.settlements) {
      const a = host.screenOf(pv.id, s.pos, 8);
      for (const [list, war] of [[s.trade ?? [], false], [s.war ?? [], true]] as const) {
        if (!all && !war) continue;
        for (const o of list) {
          const key = `${Math.min(s.id, o)}:${Math.max(s.id, o)}:${war}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const t = byId.get(o);
          if (!t) continue;
          const b = host.screenOf(pv.id, t.pos, 8);
          if (!a || !b) continue;
          // a gentle arc so two-way routes and wars between the same towns do not overlap
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const k = war ? -0.16 : 0.16;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M${a[0]} ${a[1]}Q${mx - dy * k} ${my + dx * k} ${b[0]} ${b[1]}`);
          path.setAttribute('class', war ? 'gn-route gn-war' : 'gn-route');
          path.setAttribute('stroke', war ? pal.war : pal.trade);
          this.svg.append(path);
        }
      }
    }
  }

  // ───────────────────────────── legend ─────────────────────────────

  private renderLegend(pv: PlanetView | null): void {
    const def = OVERLAYS.find((o) => o.id === this.mode);
    if (!def) return;
    const key = `${def.id}|${this.deps.palette()}|${pv?.id ?? -1}|${def.id === 'ore' || def.id === 'territory' || def.id === 'era' ? pv?.settlements.length ?? 0 : ''}`;
    if (key === this.legendKey) return;
    this.legendKey = key;
    clear(this.legend);
    const pal = RAMPS[this.deps.palette()];
    const head = h('div', { class: 'gn-legend-h' }, h('span', { class: 'gn-legend-i', html: icon(def.icon) }), h('span', { class: 'gn-legend-t', text: def.label }),
      h('button', { class: 'gn-btn gn-legend-x', title: `Overlay off${this.deps.host.keybinds.hint('ui.overlayOff') ? ` (${this.deps.host.keybinds.hint('ui.overlayOff')})` : ''}`, html: icon('close'), on: { click: () => this.set(null) } }));
    this.legend.append(head);
    const L = this.legendFor(def.id, pal, pv);
    if (L.kind === 'ramp') {
      this.legend.append(h('div', { class: 'gn-legend-bar', style: `background: linear-gradient(90deg, ${L.stops.join(', ')})` }),
        h('div', { class: 'gn-legend-scale' }, h('span', { text: L.min }), h('span', { text: L.max })));
    } else {
      const wrap = h('div', { class: 'gn-legend-cats' });
      for (const it of L.items) wrap.append(h('span', { class: 'gn-legend-cat' }, h('i', { style: `background:${it.color}` }), it.label));
      this.legend.append(wrap);
    }
    if (L.note) this.legend.append(h('div', { class: 'gn-legend-note', text: L.note }));
    const chips = h('div', { class: 'gn-legend-chips' });
    for (const o of OVERLAYS) {
      const b = h('button', { class: `gn-legend-chip${o.id === def.id ? ' gn-on' : ''}`, title: o.label, html: icon(o.icon) });
      b.addEventListener('click', () => this.set(o.id));
      chips.append(b);
    }
    this.legend.append(chips);
  }

  private legendFor(id: string, pal: (typeof RAMPS)['standard'], pv: PlanetView | null): Legend | Cats {
    switch (id) {
      case 'temperature': return { kind: 'ramp', stops: pal.diverge, min: '−30 °C', max: '45 °C' };
      case 'moisture': return { kind: 'ramp', stops: pal.wet, min: 'dry', max: 'soaked' };
      case 'fertility': return { kind: 'ramp', stops: pal.wet, min: 'barren', max: 'rich' };
      case 'pollution': return { kind: 'ramp', stops: pal.heat, min: 'clean', max: 'fouled' };
      case 'radiation': return { kind: 'ramp', stops: pal.heat, min: 'none', max: 'lethal' };
      case 'population': return { kind: 'ramp', stops: pal.seq, min: 'few', max: 'crowded', note: 'People and the households around each town.' };
      case 'era': return { kind: 'ramp', stops: pal.era, min: 'stone', max: 'space', note: pv ? eraNote(pv) : undefined };
      case 'belief': {
        const hue = HUE_NAMES[this.deps.palette()];
        return { kind: 'ramp', stops: beliefStops(pal), min: 'fear', max: 'love', note: `${hue[0]}: they love you · ${hue[1]}: they fear you · grey: nobody believes.` };
      }
      case 'biome': {
        const seen = new Set<number>();
        const b = pv?.fields.get('biome');
        if (b) for (let c = 0; c < b.length; c += 7) seen.add(Math.round(b[c]));
        return { kind: 'cats', items: BIOMES.filter((_, i) => seen.has(i)).map((x) => ({ label: x.name, color: x.color })) };
      }
      case 'ore': {
        const seen = new Set<number>();
        const t = pv?.fields.get('oreType');
        if (t) for (let c = 0; c < t.length; c++) if (t[c] > 0) seen.add(Math.round(t[c]) - 1);
        return { kind: 'cats', items: ORES.filter((_, i) => seen.has(i)).map((x) => ({ label: x.name, color: x.color })), note: 'Brighter: richer deposits.' };
      }
      case 'territory': {
        const items = (pv?.settlements ?? []).filter((s) => !(s.flags & 2)).slice(0, 12).map((s) => ({ label: s.name, color: `#${s.color.toString(16).padStart(6, '0')}` }));
        return { kind: 'cats', items, note: items.length ? undefined : 'No one has claimed land here yet.' };
      }
      case 'trade': return { kind: 'cats', items: [{ label: 'trade route', color: pal.trade }, { label: 'war', color: pal.war }], note: tradeNote(pv) };
    }
    return { kind: 'cats', items: [] };
  }

  /** test surface */
  state(): { mode: string | null; ready: boolean } {
    const m = this.maps.get(this.deps.host.primary());
    return { mode: this.mode, ready: !!m?.ready };
  }
}

/** belief's diverging stops: fear (the palette's "bad") through grey (no belief) to love (its "good") */
function beliefStops(pal: (typeof RAMPS)['standard']): string[] {
  return [pal.bad, mix(pal.bad, '#787670', 0.5), '#787670', mix(pal.good, '#787670', 0.5), pal.good];
}

function mix(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b);
  return `#${[0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0')).join('')}`;
}

function eraNote(pv: PlanetView): string {
  const counts = new Map<string, number>();
  for (const s of pv.settlements) if (!(s.flags & 2)) counts.set(s.era, (counts.get(s.era) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => ERAS.indexOf(b[0]) - ERAS.indexOf(a[0])).slice(0, 3);
  return top.length ? `Here: ${top.map(([e, n]) => `${e} ×${n}`).join(' · ')}` : 'No peoples on this world.';
}

function tradeNote(pv: PlanetView | null): string {
  if (!pv) return '';
  let tr = 0, wr = 0;
  for (const s of pv.settlements) { tr += s.trade?.length ?? 0; wr += s.war?.length ?? 0; }
  return `${fmtNum(tr / 2)} routes · ${fmtNum(wr / 2)} wars on this world`;
}
