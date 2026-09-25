// BLOCKTOOTH v2 — the DOM marker layer: on-screen label chips and off-screen edge arrows for objectives,
// power-ups and the TILL (FEATURES_V2 §5.4). Lane L8. UI.
//
// Input: render/markerview.ts (L6) `frame()` → ≤ 12 MarkerItems in CSS px (`dist` in blocks). This layer
// draws them: on-screen → a label chip under the anchor (`OVERLOAD SITE  2.4 BLK`); off-screen → a disc
// with the kind's glyph + a pointer toward the target + the distance, clamped to a 3u inset of the
// screen edge (clamped here too, so the arrow never leaves the view whatever the projector returns).
// The bottom inset is 15u, not 3u: the bottom HUD band (status card, ability bar, UPROAR meter, ACTIVE
// panel) reaches 14.7u up and draws over this layer, so an arrow clamped at 3u would be hidden under it
// (seen at 1920×1080: a RELIEF DEPOT arrow behind the status card).
// `angle` is read as RADIANS in screen space (0 = +x / right, +π/2 = down: Math.atan2(dy, dx) in CSS px).
// 12 nodes pooled at mount; each frame writes one transform per live node (only when it moved ≥ 0.5 px)
// and text at ≤ 4 Hz per node. No layout reads (the viewport size is cached on resize).
// Test hook (§13.3): [data-v2="marker"] on visible markers.

import './hud_v2.css';
import type { PowerUpKind } from '../core/types.ts';
import { POWERUP_KINDS } from '../core/types.ts';
import type { GlyphId, MarkerFrame, MarkerItem, MarkerKind, MarkersApi } from '../v2types.ts';
import { OBJECTIVE_NAMES } from '../data/objectives.ts';
import { POWERUP_NAMES } from '../data/powerups.ts';
import { HUD2 } from '../data/strings_hud.ts';
import { div } from './dom.ts';
import { glyphSvg } from './icons.ts';
import { OBJECTIVE_COLOR, OBJECTIVE_GLYPH, POWERUP_COLOR, POWERUP_GLYPH } from './tracker.ts';

const MAX = 12;
const INSET_U = 3;
const INSET_BOTTOM_U = 15;
const TEXT_PERIOD_MS = 250;

interface MNode {
  root: HTMLDivElement;
  chipN: HTMLDivElement;
  chipD: HTMLDivElement;
  disc: HTMLDivElement;
  ptr: HTMLDivElement;
  ad: HTMLDivElement;
  on: boolean;
  edge: boolean;
  lookKind: string;         // kind + sub whose glyph / colour / name are written
  lookSub: string;
  x: number; y: number; r: number;
  textT: number;
  distTxt: string;
}

function unitPx(): number { return Math.max(8, Math.min(window.innerWidth / 100, (window.innerHeight * 1.7778) / 100)); }

function powerupOf(sub: string): PowerUpKind | null {
  const s = sub.toUpperCase();
  for (const k of POWERUP_KINDS) if (s.includes(POWERUP_NAMES[k])) return k;
  for (const k of POWERUP_KINDS) if (sub === k) return k;
  return null;
}

function lookOf(it: MarkerItem): { glyph: GlyphId; color: string; name: string } {
  switch (it.kind as MarkerKind) {
    case 'overloadSite': case 'reliefDepot': case 'recordsAnnex':
      return { glyph: OBJECTIVE_GLYPH[it.kind as 'overloadSite'], color: OBJECTIVE_COLOR[it.kind as 'overloadSite'], name: it.sub || OBJECTIVE_NAMES[it.kind as 'overloadSite'] };
    case 'till':
      return { glyph: 'till', color: '#ffc53d', name: it.sub || 'HIT THE TILL' };
    case 'powerup': default: {
      const k = powerupOf(it.sub);
      return { glyph: k ? POWERUP_GLYPH[k] : 'star', color: k ? POWERUP_COLOR[k] : '#f4ecd8', name: k ? POWERUP_NAMES[k] : (it.sub || '') };
    }
  }
}

export class ScreenMarkers implements MarkersApi {
  private readonly layer: HTMLDivElement;
  private readonly nodes: MNode[] = [];
  private shown = false;
  private vw = window.innerWidth;
  private vh = window.innerHeight;
  private u = unitPx();

  constructor(root: HTMLElement) {
    const L = this.layer = div('bt-layer bt-v2marks bt-hidden', root);
    for (let i = 0; i < MAX; i++) {
      const r = div('bt-mk off', L);
      const chip = div('bt-mk-chip', r);
      const chipN = div('bt-mk-n', chip);
      const chipD = div('bt-mk-d', chip);
      const arrow = div('bt-mk-arrow', r);
      const ptr = div('bt-mk-ptr', arrow);
      const disc = div('bt-mk-disc', arrow);
      const ad = div('bt-mk-ad', arrow);
      this.nodes.push({ root: r, chipN, chipD, disc, ptr, ad, on: false, edge: false, lookKind: '', lookSub: '', x: NaN, y: NaN, r: NaN, textT: 0, distTxt: '' });
    }
    window.addEventListener('resize', () => { this.vw = window.innerWidth; this.vh = window.innerHeight; this.u = unitPx(); });
  }

  show(on: boolean): void {
    this.shown = on;
    this.layer.classList.toggle('bt-hidden', !on);
    if (!on) for (const n of this.nodes) this.hide(n);
  }

  update(f: MarkerFrame): void {
    if (!this.shown) return;
    const items = f && f.items ? f.items : [];
    const now = performance.now();
    const inset = INSET_U * this.u;
    const n = Math.min(MAX, items.length);
    for (let i = 0; i < n; i++) {
      const it = items[i], m = this.nodes[i];
      if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) { this.hide(m); continue; }
      if (m.lookKind !== it.kind || m.lookSub !== it.sub) {
        m.lookKind = it.kind; m.lookSub = it.sub;
        const L = lookOf(it);
        m.root.style.setProperty('--kc', L.color);
        m.disc.innerHTML = glyphSvg(L.glyph, L.color);
        m.chipN.textContent = L.name;
        m.textT = 0;
      }
      if (!m.on) { m.on = true; m.root.classList.remove('off'); m.root.dataset.v2 = 'marker'; }
      const edge = !it.onScreen;
      if (edge !== m.edge) { m.edge = edge; m.root.classList.toggle('edge', edge); m.x = NaN; }
      let x = it.x, y = it.y;
      if (edge) {
        x = Math.max(inset, Math.min(this.vw - inset, x));
        y = Math.max(inset, Math.min(this.vh - INSET_BOTTOM_U * this.u, y));
        const a = Number.isFinite(it.angle) ? it.angle : 0;
        if (Math.abs(a - m.r) > 0.01 || !Number.isFinite(m.r)) { m.r = a; m.ptr.style.transform = `rotate(${a.toFixed(3)}rad)`; }
      }
      if (!(Math.abs(x - m.x) < 0.5 && Math.abs(y - m.y) < 0.5)) {
        m.x = x; m.y = y;
        m.root.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      }
      if (now - m.textT >= TEXT_PERIOD_MS) {
        m.textT = now;
        const d = Number.isFinite(it.dist) ? Math.max(0, it.dist).toFixed(1) + ' ' + HUD2.blk : '';
        if (d !== m.distTxt) { m.distTxt = d; m.chipD.textContent = d; m.ad.textContent = d; }
      }
    }
    for (let i = n; i < MAX; i++) this.hide(this.nodes[i]);
  }

  private hide(m: MNode): void {
    if (!m.on) return;
    m.on = false;
    m.root.classList.add('off');
    delete m.root.dataset.v2;
  }
}
