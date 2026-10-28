// VALE HUD — the minimap (client_hud §4.3; bible HUD density: RIFT 352 × 198, BRIDGE 384 × 96, FRAY a
// 232 px disc; bottom right, swappable left; access.minimapScale). A 2D canvas: the map's painted
// minimap.png when the art exists, else drawn FROM THE MAP JSON (walls, thickets, roads, bases, shops,
// the noon line; FRAY's plate with ten hour-marks on the rim). Fog of war from your team's vision grid
// (unseen cells darkened). Marks keep their shape in every palette: structures by side (▲ spire, ◠
// dome) in relationship colour, Wicks as 2.2·k dots on a 1 px ink keyline (HUD-3), monsters and objectives as neutral squares with their
// return timers, fighters as round portraits (r12 m3: the fighter's icon clipped to a 13·k radius circle,
// ≈ 26 px on the 352 px map, preloaded with the match; the palette disc only when no icon exists) in
// their relationship ring (ally plain, enemy notched + heading wedge, you a Noonwhite ring + gnomon
// wedge; FRAY: seat colours), pings, and the camera's ground trapezoid.
// Input: left click / drag moves the camera (it unlocks; a locked camera scouts and snaps back), right
// click moves your fighter, Alt + click (or the ping key held) pings "Look here".

import type { CSSProperties, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { MapDefT } from '../../contracts/catalog.ts';
import type { Settings } from '../../contracts/session.ts';
import type { EntityView } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import { cdText, useHud } from './ctx.ts';
import { FRAME } from './frame_layout.ts';
import MM_RECT from '../art/hud/minimap_rect.webp?url';
import MM_STRIP from '../art/hud/minimap_strip.webp?url';
import MM_DISC from '../art/hud/minimap_disc.webp?url';

const SIZES = { rect: FRAME.minimap.rect, strip: FRAME.minimap.strip, disc: FRAME.minimap.disc } as const;
const FRAME_ART = { rect: MM_RECT, strip: MM_STRIP, disc: MM_DISC } as const;
const DRAW_MS = 50;
const FOG_MS = 250;

/** relationship + terrain colours read from the CSS tokens (colourblind palettes swap them) */
function readColours(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const g = (n: string, d: string): string => cs.getPropertyValue(n).trim() || d;
  return {
    self: g('--team-self', '#F4EFE2'), ally: g('--team-ally', '#3F9CFF'), enemy: g('--team-enemy', '#FF9A1F'), neutral: g('--team-neutral', '#A9A49A'),
    lane: g('--terrain-lane', '#9A927F'), jungle: g('--terrain-jungle', '#4E5547'), river: g('--terrain-river', '#5F6E73'),
    floor: g('--terrain-fray-floor', '#4A4744'), band: g('--terrain-inscription-band', '#B7B0A0'), chalk: g('--chalk', '#EDE6D6'),
    ink0: g('--ink-0', '#0B0D11'), ink1: g('--ink-1', '#11141A'), ink2: g('--ink-2', '#171B22'), line1: g('--line-1', '#2C333F'), line2: g('--line-2', '#3D4656'),
  };
}
const SEATS = ['#B2354A', '#767305', '#D9FF17', '#20A04E', '#26F3FF', '#19AFFE', '#7273F5', '#8121FC', '#993F94', '#DC6294'];

const PING_PATHS: Record<string, string> = {
  alert: 'M12 8a4 4 0 1 0 0.01 0M12 3.5a8.5 8.5 0 1 0 0.01 0',
  danger: 'M4 5h16L12 20z',
  onMyWay: 'M4 18L12 4l8 14-8-4z',
  missing: 'M17.6 6.4A8 8 0 1 0 20 12',
  assist: 'M3 7l6 5-6 5M21 7l-6 5 6 5',
  push: 'M4 7l4 5-4 5M10 7l4 5-4 5M16 7l4 5-4 5',
  vision: 'M9 8h6l-1 8h-4z',
  objective: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  retreat: 'M20 7l-4 5 4 5M14 7l-4 5 4 5M8 7l-4 5 4 5',
};

interface Fit { s: number; ox: number; oy: number; w: number; h: number; dpr: number }
/** the minimap's size factor (Settings.access.minimapScale, clamped); the target plate docks on its frame by it */
export const minimapScale = (s: Settings): number => Math.min(1.3, Math.max(0.8, s.access.minimapScale || 1));

export function Minimap(): JSX.Element {
  const { cv, state } = useApp();
  const { client, model, input, r, mapShape } = useHud();
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = cv.map(client.setup.map);
  const [bw, bh] = SIZES[mapShape];
  const settings = state.settings.value;
  const mk = minimapScale(settings);
  const cvd = settings.access.colorblind;
  const drag = useRef<{ scouting: boolean } | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !map) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0, lastDraw = 0, lastFog = 0, stopped = false;
    let fit: Fit = { s: 1, ox: 0, oy: 0, w: 1, h: 1, dpr: 1 };
    let stat: HTMLCanvasElement | null = null;
    let col = readColours();
    const fog = document.createElement('canvas');
    const icons = loadIcons(model);
    let dirty = true;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { dirty = true; }) : null;
    ro?.observe(el);
    let img: HTMLImageElement | null = null;
    const src = cv.asset(map.art.minimap);
    if (src) { img = new Image(); img.src = src; img.onload = () => { stat = null; }; img.onerror = () => { img = null; stat = null; }; }

    const size = (): void => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      const W = Math.max(1, Math.round(rect.width * dpr)), H = Math.max(1, Math.round(rect.height * dpr));
      if (el.width !== W || el.height !== H) { el.width = W; el.height = H; stat = null; }
      const pad = mapShape === 'disc' ? 0.02 * W : 0;
      const s = Math.min((W - 2 * pad) / map.size[0], (H - 2 * pad) / map.size[1]);
      fit = { s, ox: (W - map.size[0] * s) / 2, oy: (H - map.size[1] * s) / 2, w: W, h: H, dpr: W / Math.max(1, rect.width) };
    };
    const draw = (now: number): void => {
      if (stopped) return;
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < DRAW_MS) return;
      lastDraw = now;
      if (dirty || !ro) { size(); dirty = false; }
      if (!stat) { col = readColours(); stat = buildStatic(map, fit, col, mapShape, model.myTeam, img); }
      if (now - lastFog > FOG_MS) { lastFog = now; drawFog(fog, model.view.visionGrid(model.myTeam)); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, fit.w, fit.h);
      ctx.drawImage(stat, 0, 0);
      ctx.save();
      clipShape(ctx, fit, mapShape);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fog, fit.ox, fit.oy, map.size[0] * fit.s, map.size[1] * fit.s);
      drawDynamic(ctx, fit, col, model, now, icons);
      drawCamera(ctx, fit, col, r);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [map?.id, mapShape, mk, cvd]);

  const toSim = (e: PointerEvent): { x: number; y: number } | null => {
    const el = canvas.current;
    if (!el || !map) return null;
    const rect = el.getBoundingClientRect();
    const dpr = el.width / Math.max(1, rect.width);
    const pad = mapShape === 'disc' ? 0.02 * el.width : 0;
    const s = Math.min((el.width - 2 * pad) / map.size[0], (el.height - 2 * pad) / map.size[1]);
    const ox = (el.width - map.size[0] * s) / 2, oy = (el.height - map.size[1] * s) / 2;
    const x = ((e.clientX - rect.left) * dpr - ox) / s, y = ((e.clientY - rect.top) * dpr - oy) / s;
    return { x: Math.max(0, Math.min(map.size[0], x)), y: Math.max(0, Math.min(map.size[1], y)) };
  };
  const focus = (e: PointerEvent): void => {
    const p = toSim(e);
    if (p) r.camera?.focusOn(p.x, p.y);
  };
  const onDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const p = toSim(e);
    if (!p) return;
    const pingHeld = !!input.keymap.code('ping') && input.held.has(input.keymap.code('ping')!);
    if (e.button === 0 && (e.altKey || pingHeld)) { input.sendPing('alert', p.x, p.y); return; }
    if (e.button === 0) {
      const cam = r.camera;
      if (!cam) return;
      const scouting = cam.mode === 'locked';
      if (scouting) cam.scout(true); else if (cam.mode !== 'free') cam.setMode('free');
      drag.current = { scouting };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      focus(e);
    } else if (e.button === 2) {
      input.moveTo(p, state.settings.value.controls.attackMoveOnClick, true);
    }
  };
  const onMove = (e: PointerEvent): void => { if (drag.current) focus(e); };
  const onUp = (e: PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    if (d?.scouting) r.camera?.scout(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };

  return (
    <section class={`mmap mmap--${mapShape}`} style={{ '--mw': bw, '--mh': bh, '--mk': mk, '--mb': FRAME.minimap.border } as CSSProperties}
      aria-label={cv.t('hud.minimap', 'Minimap')} title={cv.t('hud.minimap_hint', 'Click to move the camera. Right-click to move your fighter.')}>
      <canvas ref={canvas} class="mmap__canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onContextMenu={(e) => e.preventDefault()} />
      <img class="mmap__frame" src={FRAME_ART[mapShape]} alt="" draggable={false} />
    </section>
  );
}

const fmtTimer = (s: number): string => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : cdText(s));

// ── fighter portraits ────────────────────────────────────────────────────────────────────────────
interface Icon { img: HTMLImageElement; ok: boolean; circ: HTMLCanvasElement | null; d: number }
/** every seat's fighter icon (else its skin's portrait), requested when the map mounts */
function loadIcons(model: import('./model.ts').HudModel): Map<number, Icon> {
  const out = new Map<number, Icon>();
  const cv = model.cv;
  for (const p of model.view.players) {
    const f = cv.fighter(p.fighter);
    const sk = cv.skin(p.skin);
    const src = cv.asset(f?.art.icon) ?? cv.asset(sk?.portrait) ?? cv.asset(f?.art.portrait);
    if (!src) continue;
    const img = new Image();
    const ic: Icon = { img, ok: false, circ: null, d: 0 };
    img.decoding = 'async';
    img.onload = () => { ic.ok = img.naturalWidth > 0; };
    img.onerror = () => { ic.ok = false; };
    img.src = src;
    out.set(p.player, ic);
  }
  return out;
}
/** the icon clipped to a circle of diameter d (device px), rebuilt only when d changes */
function circleOf(ic: Icon, d: number): HTMLCanvasElement | null {
  if (!ic.ok) return null;
  const D = Math.max(4, Math.round(d));
  if (ic.circ && ic.d === D) return ic.circ;
  const c = document.createElement('canvas');
  c.width = c.height = D;
  const g = c.getContext('2d');
  if (!g) return null;
  g.beginPath(); g.arc(D / 2, D / 2, D / 2, 0, Math.PI * 2); g.clip();
  const iw = ic.img.naturalWidth, ih = ic.img.naturalHeight;
  const sc = Math.max(D / iw, D / ih);
  g.imageSmoothingQuality = 'high';
  g.drawImage(ic.img, (D - iw * sc) / 2, (D - ih * sc) * 0.2, iw * sc, ih * sc);
  ic.circ = c; ic.d = D;
  return c;
}

// ── drawing ──────────────────────────────────────────────────────────────────────────────────────
function clipShape(ctx: CanvasRenderingContext2D, f: Fit, shape: 'rect' | 'strip' | 'disc'): void {
  ctx.beginPath();
  if (shape === 'disc') ctx.arc(f.w / 2, f.h / 2, Math.max(0, Math.min(f.w, f.h) / 2 - 1), 0, Math.PI * 2);
  else ctx.rect(0, 0, f.w, f.h);
  ctx.clip();
}
const X = (f: Fit, x: number): number => f.ox + x * f.s;
const Y = (f: Fit, y: number): number => f.oy + y * f.s;
function poly(ctx: CanvasRenderingContext2D, f: Fit, pts: readonly (readonly number[])[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(f, p[0]), Y(f, p[1])) : ctx.moveTo(X(f, p[0]), Y(f, p[1]))));
  ctx.closePath();
}

function buildStatic(map: MapDefT, f: Fit, c: Record<string, string>, shape: 'rect' | 'strip' | 'disc', myTeam: number, img: HTMLImageElement | null): HTMLCanvasElement {
  const cnv = document.createElement('canvas');
  cnv.width = f.w; cnv.height = f.h;
  const ctx = cnv.getContext('2d')!;
  ctx.save();
  clipShape(ctx, f, shape);
  ctx.fillStyle = c.ink0;
  ctx.fillRect(0, 0, f.w, f.h);
  const mw = map.size[0] * f.s, mh = map.size[1] * f.s;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, f.ox, f.oy, mw, mh);
  } else {
    // ground
    ctx.globalAlpha = 1;
    ctx.fillStyle = shape === 'disc' ? c.floor : shape === 'strip' ? c.ink1 : c.jungle;
    if (shape === 'disc') { ctx.beginPath(); ctx.arc(f.w / 2, f.h / 2, Math.max(0, Math.min(mw, mh) / 2), 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(f.ox, f.oy, mw, mh);
    if (shape === 'rect') { const g = ctx.createLinearGradient(f.ox, 0, f.ox + mw, 0); g.addColorStop(0, 'rgba(184,198,217,0.10)'); g.addColorStop(1, 'rgba(217,194,160,0.10)'); ctx.fillStyle = g; ctx.fillRect(f.ox, f.oy, mw, mh); }
    // the inscription band and the hour-marks on the rim (FRAY)
    if (shape === 'disc') {
      const R = Math.min(mw, mh) / 2;
      ctx.strokeStyle = c.band; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(2, R * 0.05);
      ctx.beginPath(); ctx.arc(f.w / 2, f.h / 2, Math.max(0, R * 0.9), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.lineWidth = Math.max(1.5, R * 0.02); ctx.strokeStyle = c.chalk;
      const cx = map.size[0] / 2, cy = map.size[1] / 2;
      for (const sp of map.spawns) {
        const a = Math.atan2(sp[1] - cy, sp[0] - cx);
        ctx.beginPath(); ctx.moveTo(f.w / 2 + Math.cos(a) * R * 0.84, f.h / 2 + Math.sin(a) * R * 0.84); ctx.lineTo(f.w / 2 + Math.cos(a) * R * 0.97, f.h / 2 + Math.sin(a) * R * 0.97); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // roads
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const lane of map.lanes) {
      ctx.strokeStyle = c.lane;
      ctx.globalAlpha = shape === 'strip' ? 0.75 : 0.5;
      ctx.lineWidth = Math.max(3, (shape === 'strip' ? 9 : 5) * f.s);
      ctx.beginPath();
      lane.path.forEach((p, i) => (i ? ctx.lineTo(X(f, p[0]), Y(f, p[1])) : ctx.moveTo(X(f, p[0]), Y(f, p[1]))));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // thickets, then walls
    ctx.fillStyle = '#2E3A2C';
    ctx.globalAlpha = 0.85;
    for (const t of map.thickets) { poly(ctx, f, t); ctx.fill(); }
    ctx.globalAlpha = 1;
    for (const w of map.walls) { poly(ctx, f, w); ctx.fillStyle = c.ink1; ctx.fill(); ctx.strokeStyle = c.line2; ctx.lineWidth = 1; ctx.stroke(); }
    // the noon line (team maps mirror across it)
    if (shape !== 'disc') {
      ctx.strokeStyle = c.chalk; ctx.globalAlpha = 0.16; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(X(f, map.size[0] / 2), f.oy); ctx.lineTo(X(f, map.size[0] / 2), f.oy + mh); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }
  // bases (team modes): the fountain in relationship colour
  for (const b of map.bases) {
    ctx.fillStyle = b.team === myTeam ? c.ally : c.enemy;
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.arc(X(f, b.fountain.at[0]), Y(f, b.fountain.at[1]), Math.max(4, b.fountain.radius * f.s), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // shops: a small lamp
  for (const sh of map.shops) lamp(ctx, X(f, sh.at[0]), Y(f, sh.at[1]), Math.max(3, f.w / 90), c.chalk);
  ctx.restore();
  // frame
  ctx.strokeStyle = c.line2; ctx.lineWidth = Math.max(1, f.w / 400);
  if (shape === 'disc') { ctx.beginPath(); ctx.arc(f.w / 2, f.h / 2, Math.max(0, Math.min(f.w, f.h) / 2 - 1), 0, Math.PI * 2); ctx.stroke(); }
  return cnv;
}

function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.moveTo(x - r * 0.7, y - r * 0.6); ctx.lineTo(x + r * 0.7, y - r * 0.6); ctx.lineTo(x + r * 0.5, y + r * 0.8); ctx.lineTo(x - r * 0.5, y + r * 0.8); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawFog(cnv: HTMLCanvasElement, g: { width: number; height: number; data: Uint8Array }): void {
  if (!g.width || !g.height) return;
  if (cnv.width !== g.width || cnv.height !== g.height) { cnv.width = g.width; cnv.height = g.height; }
  const ctx = cnv.getContext('2d');
  if (!ctx) return;
  const id = ctx.createImageData(g.width, g.height);
  const d = id.data;
  for (let i = 0; i < g.width * g.height; i++) {
    const seen = (g.data[i] ?? 0) / 255;
    d[i * 4] = 11; d[i * 4 + 1] = 13; d[i * 4 + 2] = 17;
    d[i * 4 + 3] = Math.round((1 - seen) * 140);
  }
  ctx.putImageData(id, 0, 0);
}

function drawDynamic(ctx: CanvasRenderingContext2D, f: Fit, c: Record<string, string>, model: import('./model.ts').HudModel, now: number, icons: Map<number, Icon>): void {
  const v = model.view;
  const my = model.myTeam;
  const k = Math.max(0.7, f.w / 352);
  const seen = (e: EntityView): boolean => e.team === my || (e.visibleMask & (1 << my)) !== 0;
  const rel = (e: EntityView): string => (e.kind === 'monster' || e.kind === 'pickup' ? c.neutral : e.team === my ? c.ally : c.enemy);
  const fighters: EntityView[] = [];
  // objectives that are up (neutral squares)
  for (const o of v.objectives) {
    if (!o.alive) {
      if (o.respawnIn > 0) {
        const fs = Math.round(12 * f.dpr);
        ctx.font = `700 ${fs}px "Atkinson Hyperlegible Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 * f.dpr; ctx.strokeStyle = c.ink0; ctx.fillStyle = c.neutral;
        const t = fmtTimer(o.respawnIn);
        ctx.strokeText(t, X(f, o.at[0]), Y(f, o.at[1])); ctx.fillText(t, X(f, o.at[0]), Y(f, o.at[1]));
      }
      continue;
    }
    const x = X(f, o.at[0]), y = Y(f, o.at[1]), s = 4.5 * k;
    ctx.fillStyle = c.ink0; ctx.fillRect(x - s - 1, y - s - 1, 2 * s + 2, 2 * s + 2);
    ctx.strokeStyle = c.neutral; ctx.lineWidth = 1.5 * k; ctx.strokeRect(x - s, y - s, 2 * s, 2 * s);
  }
  for (const e of v.entities) {
    if (!e.alive || !seen(e)) continue;
    const x = X(f, e.x), y = Y(f, e.y);
    switch (e.kind) {
      case 'fighter': fighters.push(e); break;
      case 'structure': {
        const s = 5.2 * k;
        ctx.fillStyle = rel(e); ctx.strokeStyle = c.ink0; ctx.lineWidth = 1.2 * k;
        ctx.beginPath();
        if (e.team === 0) { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s * 0.8); ctx.lineTo(x - s, y + s * 0.8); ctx.closePath(); }
        else { ctx.moveTo(x - s, y + s * 0.5); ctx.arc(x, y + s * 0.5, s, Math.PI, 0); ctx.closePath(); }
        ctx.fill(); ctx.stroke();
        break;
      }
      // HUD-3: Wicks are 2.2·k dots (≈ 4.4 px across at 352 px) on a 1 px ink keyline, so a wave reads over the light road
      // band and in fog
      case 'minion': {
        const s = 2.2 * k;
        ctx.fillStyle = c.ink0; ctx.beginPath(); ctx.arc(x, y, s + f.dpr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rel(e); ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'monster': { const s = 2.6 * k; ctx.fillStyle = c.neutral; ctx.fillRect(x - s, y - s, 2 * s, 2 * s); break; }
      case 'ward': case 'summon': { const s = 2.4 * k; ctx.fillStyle = rel(e); ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); break; }
      case 'pickup': { const s = 2 * k; ctx.strokeStyle = c.chalk; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.stroke(); break; }
      default: break;
    }
  }
  // fighters on top; you last
  const me = model.body;
  fighters.sort((a, b) => (a.id === me?.id ? 1 : b.id === me?.id ? -1 : 0));
  // portraits: 13·k radius on the strip / rect maps (≈ 26 px at 352 px), a little smaller on the FRAY disc
  const PR = (model.ffa ? 11 : 13) * k;
  for (const e of fighters) {
    const x = X(f, e.x), y = Y(f, e.y);
    const self = e.id === me?.id;
    const pv = e.owner >= 0 ? v.players[e.owner] : undefined;
    const ic = pv ? icons.get(pv.player) : undefined;
    const circ = ic ? circleOf(ic, 2 * PR) : null;
    const R = circ ? PR : 6.4 * k;
    const ring = self ? c.self : model.ffa ? SEATS[(pv?.colorIndex ?? 0) % 10] : rel(e);
    if (circ) {
      ctx.fillStyle = c.ink0;
      ctx.beginPath(); ctx.arc(x, y, R + 2.4 * k, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(circ, x - R, y - R, 2 * R, 2 * R);
      ctx.strokeStyle = ring; ctx.lineWidth = (self ? 2.6 : 2) * k;
      ctx.beginPath(); ctx.arc(x, y, R + 0.6 * k, 0, Math.PI * 2); ctx.stroke();
    } else {
      const fd = pv ? model.cv.fighter(pv.fighter) : undefined;
      ctx.fillStyle = fd?.palette.primary ?? c.ink2;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(11,13,17,0.35)'; ctx.beginPath(); ctx.arc(x, y + R * 0.25, R * 0.7, 0, Math.PI); ctx.fill();
      ctx.lineWidth = (self ? 2.4 : 2) * k; ctx.strokeStyle = c.ink0;
      ctx.beginPath(); ctx.arc(x, y, R + 1.2 * k, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = ring; ctx.lineWidth = (self ? 2.2 : 1.7) * k;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
    }
    const enemy = !self && (model.ffa || e.team !== my);
    if (enemy) {
      // four inward notches on the ring + a heading wedge
      ctx.fillStyle = c.ink0;
      const rr = circ ? R + 0.6 * k : R;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, (circ ? 1.7 : 1.2) * k, 0, Math.PI * 2); ctx.fill(); }
    }
    if (self || enemy) {
      const a = e.facing, tip = R + (circ ? 7 : 5) * k;
      ctx.fillStyle = ring; ctx.strokeStyle = c.ink0; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * tip, y + Math.sin(a) * tip);
      ctx.lineTo(x + Math.cos(a + 0.42) * (R + 0.5), y + Math.sin(a + 0.42) * (R + 0.5));
      ctx.lineTo(x + Math.cos(a - 0.42) * (R + 0.5), y + Math.sin(a - 0.42) * (R + 0.5));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  // pings: a ripple and the kind's shape
  for (const p of model.pings.value) {
    const age = (performance.now() - p.at) / 1000;
    const x = X(f, p.x), y = Y(f, p.y);
    const col = p.kind === 'danger' || p.kind === 'retreat' ? c.enemy : c.ally;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5 * k;
    const rip = (age % 1) * 14 * k;
    ctx.globalAlpha = Math.max(0, 1 - (age % 1));
    ctx.beginPath(); ctx.arc(x, y, 4 * k + rip, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = Math.max(0, Math.min(1, (4 - age) / 0.5));
    const path = PING_PATHS[p.kind];
    if (path) {
      ctx.save(); ctx.translate(x - 7 * k, y - 7 * k); ctx.scale(14 * k / 24, 14 * k / 24);
      ctx.lineWidth = 3; ctx.strokeStyle = c.ink0; ctx.stroke(new Path2D(path));
      ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(new Path2D(path));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  void now;
}

function drawCamera(ctx: CanvasRenderingContext2D, f: Fit, c: Record<string, string>, r: { pickGround?(x: number, y: number): { x: number; y: number } | null }): void {
  if (!r.pickGround) return;
  const W = innerWidth, H = innerHeight;
  const pts = [r.pickGround(0, 0), r.pickGround(W, 0), r.pickGround(W, H), r.pickGround(0, H)];
  if (pts.some((p) => !p)) return;
  ctx.strokeStyle = c.chalk; ctx.globalAlpha = 0.85; ctx.lineWidth = Math.max(1, f.w / 300);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(f, p!.x), Y(f, p!.y)) : ctx.moveTo(X(f, p!.x), Y(f, p!.y))));
  ctx.closePath(); ctx.stroke();
  ctx.globalAlpha = 1;
}
