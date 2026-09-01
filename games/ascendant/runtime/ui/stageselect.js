/* ============================================================================
 * ASCENDANT — runtime/ui/stageselect.js
 * World cards -> stage grid.  Contract §20:
 *   export class StageSelect { constructor(root, game); open(); close(); }
 *
 * Every stage tile draws a real top-down mini-map from that stage's own
 * ObjectDef list (§18) — platforms, hazards, the checkpoint route, coins.
 * Nothing here is a placeholder image.
 * ==========================================================================*/

import { clamp } from '../core/util.js';
import { Save } from '../core/save.js';
import { WORLDS, getStage, loadStageNumbering, stageNumbering, worldStageRange } from '../data/index.js';
import { THEMES } from '../world/themes.js';
import {
  injectStyles, UI_TOKENS, UIRegistry, el, icon, fmtMs, medalFor, makeDots, makeMedal,
  makeButton, animateOnce, uiAction, uiSfx, pushCapture, popCapture, cssColor,
  mixColor, alphaColor, diffBand,
} from './style.js';

/* Which ObjectDef kinds read as landable vs lethal on the mini-map. */
const SAFE_KINDS = new Set(['platform', 'beam', 'mover', 'vanish', 'ice', 'conveyor',
  'jumppad', 'speedpad', 'wind']);
const KILL_KINDS = new Set(['lava', 'spikes', 'crusher', 'saw', 'chase']);
const PREVIEW_H = 104;

/* Preview scale clamps (px per world metre). Whole-bounds fitting shrank a
   long gauntlet into a ~4 px strip of specks; instead the route is
   straightened (rotated so spawn->finish runs along the canvas) and the
   scale never drops below K_MIN — a stage longer than the window is CROPPED
   to a centred window around the route (with edge fades) rather than shrunk
   into illegibility. */
const K_MIN = 1.35;
const K_MAX = 4.5;

/* ---------------------------------------------------------------------------
 * Mini-map renderer — pure function of the stage def.
 * `s` is treated as full size (w,h,d) centred on `p`, per §18 builders.
 * -------------------------------------------------------------------------*/
function drawPreview(cv, def, pal) {
  const g = cv.getContext ? cv.getContext('2d') : null;
  if (!g || !def) return false;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(140, cv.clientWidth || 232);
  const h = PREVIEW_H;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cSafe = cssColor(pal.safe || '#7cf0c4');
  const cEdge = cssColor(pal.safeEdge || mixColor(cSafe, '#ffffff', 0.5));
  const cKill = cssColor(pal.kill || '#ff5546');
  const cCp = cssColor(pal.checkpointOn || pal.checkpoint || '#67f0a8');
  const cFin = cssColor(pal.finish || '#ffcf5c');
  const cAcc = cssColor(pal.accent || '#4fd7ff');

  /* ---- gather ------------------------------------------------------ */
  const rects = [];
  const segs = [];
  const circles = [];
  const pts = [];                     // every extreme point, flat [x,z, x,z, …]
  let minY = Infinity, maxY = -Infinity;

  const acc = (x, z, y) => {
    pts.push(x, z);
    if (y != null) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  };

  const objs = Array.isArray(def.objects) ? def.objects : [];
  for (const o of objs) {
    if (!o || !o.kind) continue;
    if (o.kind === 'deco' || o.kind === 'light' || o.kind === 'text') continue;

    if (o.kind === 'laser') {
      const a = o.a, b = o.b;
      if (Array.isArray(a) && Array.isArray(b)) {
        segs.push({ a, b, c: cKill });
        acc(a[0], a[2], a[1]); acc(b[0], b[2], b[1]);
      }
      continue;
    }
    if (o.kind === 'rotor' || o.kind === 'pendulum') {
      const p = o.p;
      if (Array.isArray(p)) {
        const r = Math.max(0.8, Number(o.len) || 2.4);
        circles.push({ x: p[0], z: p[2], r, c: cKill });
        acc(p[0] - r, p[2] - r, p[1]); acc(p[0] + r, p[2] + r, p[1]);
      }
      continue;
    }

    const p = o.p;
    if (!Array.isArray(p)) continue;
    const s = Array.isArray(o.s) ? o.s : null;
    const hx = s ? Math.abs(s[0]) / 2 : 0.9;
    const hz = s ? Math.abs(s[2]) / 2 : 0.9;
    const kill = KILL_KINDS.has(o.kind);
    if (!kill && !SAFE_KINDS.has(o.kind)) continue;
    rects.push({ x: p[0] - hx, z: p[2] - hz, w: hx * 2, d: hz * 2, y: p[1], kill, kind: o.kind });
    acc(p[0] - hx, p[2] - hz, p[1]);
    acc(p[0] + hx, p[2] + hz, p[1]);

    /* movers sweep — include the destination so the map shows the reach */
    if (o.kind === 'mover' && o.motion && Array.isArray(o.motion.to)) {
      const t = o.motion.to;
      acc(t[0] - hx, t[2] - hz, t[1]); acc(t[0] + hx, t[2] + hz, t[1]);
      segs.push({ a: p, b: t, c: alphaColor(cAcc, 0.5), dash: true });
    }
  }

  const route = [];
  if (def.spawn && Array.isArray(def.spawn.p)) { route.push(def.spawn.p); acc(def.spawn.p[0], def.spawn.p[2], def.spawn.p[1]); }
  for (const c of (def.checkpoints || [])) {
    if (c && Array.isArray(c.p)) { route.push(c.p); acc(c.p[0], c.p[2], c.p[1]); }
  }
  if (def.finish && Array.isArray(def.finish.p)) { route.push(def.finish.p); acc(def.finish.p[0], def.finish.p[2], def.finish.p[1]); }
  const coins = (def.coins || []).filter((c) => c && Array.isArray(c.p));
  for (const c of coins) acc(c.p[0], c.p[2], c.p[1]);

  if (pts.length < 2) return false;
  if (!isFinite(minY)) { minY = 0; maxY = 1; }

  /* ---- route-aligned frame ----------------------------------------- */
  /* Straighten the route: rotate the world so spawn->finish runs along the
     drawing x-axis (falls back to +X, the §18 authoring convention). */
  let th = 0;
  if (route.length > 1) {
    const a0 = route[0], a1 = route[route.length - 1];
    const dx = a1[0] - a0[0], dz = a1[2] - a0[2];
    if (Math.hypot(dx, dz) > 4) th = Math.atan2(dz, dx);
  }
  const cosT = Math.cos(th), sinT = Math.sin(th);

  /* spans in route space: u along the route, v across it */
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const u = pts[i] * cosT + pts[i + 1] * sinT;
    const v = -pts[i] * sinT + pts[i + 1] * cosT;
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const spanU = Math.max(maxU - minU, 2);
  const spanV = Math.max(maxV - minV, 2);
  const uMid = (minU + maxU) / 2, vMid = (minV + maxV) / 2;

  /* Frame angle + scale. kFor(phi) = the largest px-per-metre that still
     contains the route box at canvas angle phi. When even the level fit
     lands under K_MIN the stage is cropped anyway, so stage it climbing the
     canvas diagonal (up-right — this game ascends); otherwise take whichever
     candidate angle contains it at the larger scale. */
  const pad = 9;
  const iw = w - pad * 2, ih = h - pad * 2;
  const diag = Math.atan2(ih, iw);
  const kFor = (phi) => {
    const c = Math.cos(phi), s = Math.sin(phi);
    return Math.min(iw / (spanU * c + spanV * s), ih / (spanU * s + spanV * c));
  };
  let phi = 0;
  let kFit = kFor(0);
  if (kFit < K_MIN) {
    phi = diag * 0.55;
    kFit = kFor(phi);
  } else {
    for (const cand of [diag * 0.55, diag]) {
      const kc = kFor(cand);
      if (kc > kFit + 0.02) { kFit = kc; phi = cand; }
    }
  }
  const k = clamp(kFit, K_MIN, K_MAX);
  const cropped = k > kFit + 1e-6;

  /* the world point that lands on the canvas centre */
  const cx = uMid * cosT - vMid * sinT;
  const cz = uMid * sinT + vMid * cosT;
  const ySpan = Math.max(maxY - minY, 0.001);
  const lift = (y) => clamp((y - minY) / ySpan, 0, 1);

  /* ---- ground (screen space) ---------------------------------------- */
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0b1422');
  bg.addColorStop(1, '#04070d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  g.strokeStyle = 'rgba(255,255,255,.045)';
  g.lineWidth = 1;
  g.beginPath();
  const step = clamp(10 * k, 9, 44);
  for (let x = (w / 2) % step; x < w; x += step) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); }
  for (let y = (h / 2) % step; y < h; y += step) { g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); }
  g.stroke();

  /* ---- content (route-aligned world space) --------------------------- */
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(-phi);                 /* drawing +x -> up the canvas diagonal */
  g.scale(k, k);
  g.rotate(-th);                  /* world route direction -> drawing +x  */
  g.translate(-cx, -cz);

  const px = (v) => v / k;        /* "n screen px" expressed in world units */
  const mn = px(1.6);             /* minimum feature size on screen */

  /* hazards under, platforms over */
  g.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    for (const r of rects) {
      if ((pass === 0) !== r.kill) continue;
      const rw = Math.max(mn, r.w), rh = Math.max(mn, r.d);
      if (r.kill) {
        g.fillStyle = alphaColor(cKill, 0.42);
        g.fillRect(r.x, r.z, rw, rh);
        g.strokeStyle = alphaColor(cKill, 0.85);
        g.lineWidth = px(1);
        g.strokeRect(r.x, r.z, rw, rh);
      } else {
        const t = lift(r.y);
        g.fillStyle = alphaColor(mixColor('#2a4056', cSafe, 0.25 + t * 0.45), 0.55 + t * 0.35);
        g.fillRect(r.x, r.z, rw, rh);
        g.strokeStyle = alphaColor(cEdge, 0.30 + t * 0.45);
        g.lineWidth = px(0.9);
        g.strokeRect(r.x, r.z, rw, rh);
      }
    }
  }

  for (const c of circles) {
    g.beginPath();
    g.arc(c.x, c.z, Math.max(px(2), c.r), 0, Math.PI * 2);
    g.strokeStyle = alphaColor(c.c, 0.7);
    g.lineWidth = px(1);
    g.stroke();
    g.fillStyle = alphaColor(c.c, 0.12);
    g.fill();
  }

  for (const s of segs) {
    g.beginPath();
    g.moveTo(s.a[0], s.a[2]);
    g.lineTo(s.b[0], s.b[2]);
    g.strokeStyle = s.c;
    g.lineWidth = s.dash ? px(1) : px(1.4);
    if (s.dash) g.setLineDash([px(2.5), px(3)]); else g.setLineDash([]);
    g.stroke();
    g.setLineDash([]);
  }

  /* ---- route: soft glow underlay + dashed spine ---------------------- */
  if (route.length > 1) {
    g.beginPath();
    g.moveTo(route[0][0], route[0][2]);
    for (let i = 1; i < route.length; i++) g.lineTo(route[i][0], route[i][2]);
    g.strokeStyle = alphaColor(cAcc, 0.16);
    g.lineWidth = px(3.4);
    g.stroke();
    g.strokeStyle = alphaColor(cAcc, 0.6);
    g.lineWidth = px(1.3);
    g.setLineDash([px(4.5), px(3.5)]);
    g.stroke();
    g.setLineDash([]);
  }

  /* ---- coins ------------------------------------------------------- */
  for (const c of coins) {
    g.beginPath();
    g.arc(c.p[0], c.p[2], px(1.7), 0, Math.PI * 2);
    g.fillStyle = alphaColor(cFin, 0.9);
    g.fill();
  }

  /* ---- markers ----------------------------------------------------- */
  const diamond = (x, y, r, fill, stroke) => {
    g.beginPath();
    g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
    g.closePath();
    g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = px(1); g.stroke(); }
  };

  if (def.spawn && Array.isArray(def.spawn.p)) {
    const x = def.spawn.p[0], y = def.spawn.p[2];
    g.beginPath(); g.arc(x, y, px(3.4), 0, Math.PI * 2);
    g.strokeStyle = alphaColor('#ffffff', 0.85); g.lineWidth = px(1.4); g.stroke();
    g.beginPath(); g.arc(x, y, px(1.2), 0, Math.PI * 2);
    g.fillStyle = '#ffffff'; g.fill();
  }
  for (const c of (def.checkpoints || [])) {
    if (!c || !Array.isArray(c.p)) continue;
    diamond(c.p[0], c.p[2], px(3), alphaColor(cCp, 0.95), alphaColor('#000', 0.5));
  }
  if (def.finish && Array.isArray(def.finish.p)) {
    g.shadowColor = cFin; g.shadowBlur = 8;
    diamond(def.finish.p[0], def.finish.p[2], px(4.6), cFin, alphaColor('#000', 0.5));
    g.shadowBlur = 0;
  }

  g.restore();

  /* ---- cropped-window edge fades ------------------------------------ */
  if (cropped) {
    const fw = 26;
    let lg = g.createLinearGradient(0, 0, fw, 0);
    lg.addColorStop(0, 'rgba(4,7,13,.85)'); lg.addColorStop(1, 'rgba(4,7,13,0)');
    g.fillStyle = lg; g.fillRect(0, 0, fw, h);
    lg = g.createLinearGradient(w, 0, w - fw, 0);
    lg.addColorStop(0, 'rgba(4,7,13,.85)'); lg.addColorStop(1, 'rgba(4,7,13,0)');
    g.fillStyle = lg; g.fillRect(w - fw, 0, fw, h);
  }

  /* ---- vignette ---------------------------------------------------- */
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  return true;
}

/* ==========================================================================*/

export class StageSelect {
  constructor(root, game) {
    injectStyles();
    this.game = game || null;
    this.root = root || document.getElementById('ui') || document.body;

    this._open = false;
    this._defs = new Map();          // stageId -> def (null when the import failed)
    this._loading = null;
    this._worlds = [];               // view models
    this._openWorld = null;
    this._mode = 'worlds';
    this._wIndex = 0;
    this._tIndex = 0;
    this._resizeTimer = 0;

    this.el = el('div', 'asc-select asc-ui');
    this.el.appendChild(el('div', 'as-scrim'));

    const wrap = el('div', 'as-wrap');
    const head = el('div', 'as-head');
    const hl = el('div');
    const eb = el('div', 'eyebrow'); eb.textContent = 'SELECT A TRIAL';
    const h2 = el('h2'); h2.textContent = 'STAGE SELECT';
    hl.appendChild(eb); hl.appendChild(h2);
    const tot = el('div', 'totals');
    this.totals = {};
    for (const k of ['CLEARED', 'MEDALS', 'DEATHS', 'TIME']) {
      const t = el('div', 'as-tot');
      const kk = el('div', 'k'); kk.textContent = k;
      const vv = el('div', 'v'); vv.textContent = '—';
      t.appendChild(kk); t.appendChild(vv);
      tot.appendChild(t);
      this.totals[k] = vv;
    }
    head.appendChild(hl); head.appendChild(tot);

    this.body = el('div', 'as-body');

    const foot = el('div', 'as-foot');
    const keys = el('div', 'keys');
    keys.innerHTML =
      '<span><b class="asc-kbd">↑</b><b class="asc-kbd">↓</b>WORLD</span>' +
      '<span><b class="asc-kbd">ENTER</b>OPEN</span>' +
      '<span><b class="asc-kbd">←</b><b class="asc-kbd">→</b>STAGE</span>' +
      '<span><b class="asc-kbd">ESC</b>BACK</span>';
    const backBtn = makeButton('BACK', { cls: 'compact', onClick: () => this.close() });
    foot.appendChild(keys); foot.appendChild(backBtn);

    wrap.appendChild(head); wrap.appendChild(this.body); wrap.appendChild(foot);
    this.el.appendChild(wrap);
    this.root.appendChild(this.el);

    this._onKey = (e) => this._handleKey(e);
    this._onResize = () => {
      if (!this._open) return;
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._redrawPreviews(), 220);
    };

    this._buildWorlds();
    UIRegistry.stageSelect = this;
  }

  get isOpen() { return this._open; }

  /* ======================================================================
   * BUILD
   * ====================================================================*/

  _buildWorlds() {
    this.body.textContent = '';
    this._worlds.length = 0;

    const list = Array.isArray(WORLDS) ? WORLDS : [];
    for (let wi = 0; wi < list.length; wi++) {
      const w = list[wi];
      if (!w) continue;
      const theme = (THEMES && THEMES[w.theme]) || null;
      const pal = (theme && theme.palette) || {};
      const accent = cssColor(pal.accent || pal.checkpointOn || '#4fd7ff');

      const card = el('div', 'as-world');
      card.style.setProperty('--wc', accent);
      card.style.setProperty('--wg', alphaColor(accent, 0.55));

      const head = el('div', 'as-whead');
      head.setAttribute('data-nav', '1');
      const glyph = el('div', 'glyph');
      glyph.textContent = String(wi + 1).padStart(2, '0');
      const wt = el('div', 'wt');
      const wname = el('div', 'wname');
      wname.textContent = w.name || String(w.id || '').toUpperCase();
      const wmeta = el('div', 'wmeta');
      wt.appendChild(wname); wt.appendChild(wmeta);
      const prog = el('div', 'as-wprog');
      const bar = el('div', 'bar');
      const barFill = el('i');
      bar.appendChild(barFill);
      const lbl = el('div', 'lbl');
      prog.appendChild(bar); prog.appendChild(lbl);
      const caret = el('div', 'caret');
      caret.innerHTML = icon('chevron');
      head.appendChild(glyph); head.appendChild(wt); head.appendChild(prog); head.appendChild(caret);

      const gwrap = el('div', 'as-grid-wrap');
      const ginner = el('div', 'as-grid-inner');
      const grid = el('div', 'as-grid');
      ginner.appendChild(grid); gwrap.appendChild(ginner);

      card.appendChild(head); card.appendChild(gwrap);
      this.body.appendChild(card);

      const vm = {
        world: w, index: wi, card, head, glyph, wmeta, barFill, lbl, grid,
        accent, pal, tiles: [], built: false, locked: false,
      };
      head.addEventListener('click', () => this._toggleWorld(vm, true));
      this._worlds.push(vm);
    }
  }

  _buildTiles(vm) {
    if (vm.built) return;
    vm.built = true;
    const ids = vm.world.stages || [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const tile = el('div', 'as-tile');
      tile.setAttribute('data-nav', '1');
      tile.tabIndex = -1;
      tile.style.animationDelay = (i * 45) + 'ms';

      const cv = el('canvas');
      cv.height = PREVIEW_H;
      const load = el('div', 'tload');
      load.appendChild(el('i'));
      const no = el('div', 'tno');
      no.textContent = String(i + 1).padStart(2, '0');
      const tick = el('div', 'tclear');
      tick.innerHTML = icon('tick');
      tick.style.display = 'none';

      const bodyEl = el('div', 'tbody');
      const nm = el('div', 'tname');
      nm.textContent = id;
      /* global stage range for this level (obby convention) — filled on refresh */
      const stagesLine = el('div', 'tstages');
      const row = el('div', 'trow');
      const dotWrap = el('span');
      dotWrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const dots = makeDots(0);
      const band = el('span', 'asc-dband');
      band.style.display = 'none';
      dotWrap.appendChild(dots); dotWrap.appendChild(band);
      const bestWrap = el('div', 'tbest none');
      row.appendChild(dotWrap); row.appendChild(bestWrap);
      const stats = el('div', 'tstats');
      const sd = el('span'); sd.innerHTML = icon('skull');
      const sdT = document.createTextNode('0');
      sd.appendChild(sdT);
      const sc = el('span'); sc.innerHTML = icon('coin');
      const scT = document.createTextNode('0');
      sc.appendChild(scT);
      const sp = el('span'); sp.innerHTML = icon('clock');
      const spT = document.createTextNode('—');
      sp.appendChild(spT);
      stats.appendChild(sd); stats.appendChild(sc); stats.appendChild(sp);

      bodyEl.appendChild(nm); bodyEl.appendChild(stagesLine); bodyEl.appendChild(row); bodyEl.appendChild(stats);
      tile.appendChild(cv); tile.appendChild(load); tile.appendChild(no);
      tile.appendChild(tick); tile.appendChild(bodyEl);
      vm.grid.appendChild(tile);

      const rec = {
        id, tile, cv, load, nm, stagesLine, dots, band, bestWrap, tick,
        deaths: sdT, coins: scT, par: spT,
        drawn: false, vm,
      };
      tile.__activate = () => this._pick(rec);
      tile.addEventListener('click', () => this._pick(rec));
      vm.tiles.push(rec);
    }
  }

  /* ======================================================================
   * DATA
   * ====================================================================*/

  /** Import every stage def once — previews and medal counts need real data. */
  _ensureDefs() {
    if (this._loading) return this._loading;
    const ids = [];
    for (const w of (WORLDS || [])) for (const id of (w.stages || [])) ids.push(id);
    const jobs = ids.map((id) => {
      if (this._defs.has(id)) return Promise.resolve();
      return Promise.resolve()
        .then(() => (typeof getStage === 'function' ? getStage(id) : null))
        .then((m) => {
          const def = m && m.default ? m.default : m;
          this._defs.set(id, def && typeof def === 'object' ? def : null);
        })
        .catch(() => { this._defs.set(id, null); });
    });
    /* The global stage numbering derives from the same defs — resolve it inside
       the same load so refresh() always sees ranges once the defs are in. */
    this._loading = Promise.all(jobs)
      .then(() => loadStageNumbering().catch(() => {}))
      .then(() => { this._loading = null; });
    return this._loading;
  }

  /** Warm the stage-def cache (used by the title menu for real names). */
  preload() { return this._ensureDefs(); }

  /** Display name for a stage id, or null when its def is not cached yet. */
  stageName(id) {
    const d = this._defs.get(id);
    return d && d.name ? d.name : null;
  }

  /**
   * Medals earned across every level (gold/silver/bronze vs each def's par).
   * Null until the defs are cached — the title menu shows an em dash and
   * re-refreshes when its preload() resolves. Shared with the title so both
   * surfaces speak the same stat vocabulary from the same data.
   */
  medalCount() {
    if (!this._defs.size) return null;
    let m = 0;
    for (const w of (WORLDS || [])) {
      for (const id of (w.stages || [])) {
        const def = this._defs.get(id);
        const r = this._rec(id);
        if (r && r.best != null && def && def.par && medalFor(r.best, def.par)) m++;
      }
    }
    return m;
  }

  _rec(stageId) {
    try {
      if (Save && typeof Save.stage === 'function') return Save.stage(stageId) || null;
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * Global stages (checkpoint segments) cleared in one level. Reaching pad k
   * means segments 0..k-1 are done — k segments; a cleared level counts all of
   * them. Returns 0 when the numbering has not loaded.
   */
  _clearedSegments(stageId, rec) {
    const num = stageNumbering();
    const e = num ? num.perStage.get(stageId) : null;
    if (!e) return 0;
    if (rec && rec.cleared) return e.segments;
    const k = rec ? Math.max(0, rec.cpIndex | 0) : 0;
    return Math.min(k, e.segments - 1);
  }

  refresh() {
    let unlocked = null;
    try {
      if (Save && typeof Save.unlockedWorlds === 'function') {
        const u = Save.unlockedWorlds();
        if (Array.isArray(u) && u.length) unlocked = new Set(u);
      }
    } catch (e) { unlocked = null; }

    let medals = 0;
    let clearedAll = 0;
    let stageTotal = 0;
    let clearedSegAll = 0;
    const numbering = stageNumbering();

    for (let i = 0; i < this._worlds.length; i++) {
      const vm = this._worlds[i];
      const ids = vm.world.stages || [];
      stageTotal += ids.length;
      const locked = !!(unlocked && !unlocked.has(vm.world.id)) && i > 0;
      vm.locked = locked;
      vm.card.classList.toggle('is-locked', locked);

      let cleared = 0;
      let clearedSeg = 0;
      for (const id of ids) {
        const r = this._rec(id);
        if (r && r.cleared) cleared++;
        clearedSeg += this._clearedSegments(id, r);
        const def = this._defs.get(id);
        if (r && r.best != null && def && def.par && medalFor(r.best, def.par)) medals++;
      }
      clearedAll += cleared;
      clearedSegAll += clearedSeg;

      /* Progress in global-stage units (obby convention: one checkpoint segment
         = one stage) once the numbering is in; level units until then. */
      const range = numbering ? worldStageRange(vm.world.id) : null;
      const pct = range && range.segments
        ? clearedSeg / range.segments
        : (ids.length ? cleared / ids.length : 0);
      vm.barFill.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
      vm.lbl.textContent = range && range.segments
        ? clearedSeg + ' / ' + range.segments
        : cleared + ' / ' + ids.length;

      if (locked) {
        const prev = this._worlds[i - 1];
        const req = prev ? 'CLEAR ' + (prev.world.name || prev.world.id) + ' TO UNLOCK' : 'LOCKED';
        vm.wmeta.innerHTML = '';
        const rq = el('span', 'req');
        rq.textContent = req;
        vm.wmeta.appendChild(rq);
        vm.glyph.innerHTML = icon('lock');
      } else {
        vm.wmeta.textContent = range
          ? 'STAGES ' + range.first + ' – ' + range.last + '  ·  ' + clearedSeg + ' CLEARED'
          : ids.length + ' STAGES  ·  ' + cleared + ' CLEARED';
        vm.glyph.textContent = String(i + 1).padStart(2, '0');
      }

      if (vm.built) this._refreshTiles(vm);
    }

    let totals = null;
    try { totals = Save && typeof Save.totals === 'function' ? Save.totals() : null; } catch (e) { totals = null; }
    this.totals.CLEARED.textContent = numbering
      ? clearedSegAll + ' / ' + numbering.total
      : clearedAll + ' / ' + stageTotal;
    this.totals.MEDALS.textContent = String(medals);
    this.totals.DEATHS.textContent = totals ? String(totals.deaths | 0) : '—';
    this.totals.TIME.textContent = totals && totals.timeMs ? fmtMs(totals.timeMs) : '—';
  }

  _refreshTiles(vm) {
    for (const rec of vm.tiles) {
      const def = this._defs.get(rec.id);
      const r = this._rec(rec.id);

      rec.nm.textContent = def && def.name ? def.name : String(rec.id).toUpperCase();
      rec.tile.classList.toggle('locked', vm.locked);

      /* global stage range for this level (obby convention) */
      const num = stageNumbering();
      const e = num ? num.perStage.get(rec.id) : null;
      if (e) {
        rec.stagesLine.innerHTML = '';
        const b = el('b');
        b.textContent = e.segments > 1 ? 'STAGES ' + e.first + ' – ' + e.last : 'STAGE ' + e.first;
        rec.stagesLine.appendChild(b);
        const done = this._clearedSegments(rec.id, r);
        rec.stagesLine.appendChild(document.createTextNode('  ·  ' + done + ' / ' + e.segments + ' CLEARED'));
        rec.stagesLine.style.display = '';
      } else {
        rec.stagesLine.style.display = 'none';
      }

      /* difficulty */
      const lv = def && def.difficulty != null ? clamp(def.difficulty | 0, 0, 10) : 0;
      const kids = rec.dots.children;
      for (let i = 0; i < kids.length; i++) {
        kids[i].className = i < lv ? (i >= 7 ? 'hot' : 'on') : '';
      }
      /* named difficulty band (chart-obby convention) */
      const band = diffBand(lv);
      if (band) {
        rec.band.textContent = band.label;
        rec.band.className = 'asc-dband db-' + band.cls;
        rec.band.style.display = '';
      } else {
        rec.band.style.display = 'none';
      }

      /* best time + medal */
      rec.bestWrap.textContent = '';
      const best = r && r.best != null && isFinite(r.best) ? r.best : null;
      if (best != null) {
        const medal = def && def.par ? medalFor(best, def.par) : null;
        rec.bestWrap.className = 'tbest';
        if (medal) rec.bestWrap.appendChild(makeMedal(medal));
        rec.bestWrap.appendChild(document.createTextNode(fmtMs(best)));
      } else {
        rec.bestWrap.className = 'tbest none';
        rec.bestWrap.appendChild(document.createTextNode('NO TIME'));
      }

      rec.deaths.nodeValue = String(r ? (r.deaths | 0) : 0);
      const coinsGot = r && Array.isArray(r.coins) ? r.coins.length : 0;
      const coinsTot = def && Array.isArray(def.coins) ? def.coins.length : 0;
      rec.coins.nodeValue = coinsGot + '/' + coinsTot;
      rec.par.nodeValue = def && def.par ? fmtMs(def.par) : '—';
      rec.tick.style.display = r && r.cleared ? '' : 'none';

      if (!rec.drawn && def) {
        rec.drawn = drawPreview(rec.cv, def, vm.pal);
        if (rec.drawn) rec.load.style.display = 'none';
      } else if (!def) {
        rec.load.style.display = 'none';
      }
    }
  }

  _redrawPreviews() {
    for (const vm of this._worlds) {
      if (!vm.built) continue;
      for (const rec of vm.tiles) {
        const def = this._defs.get(rec.id);
        if (def) rec.drawn = drawPreview(rec.cv, def, vm.pal);
      }
    }
  }

  /* ======================================================================
   * INTERACTION
   * ====================================================================*/

  _toggleWorld(vm, fromClick) {
    if (vm.locked) {
      uiSfx(this.game, 'ui_move');
      vm.card.classList.remove('is-locked-shake');
      animateOnce(vm.head, [
        { transform: 'translateX(0)' }, { transform: 'translateX(-6px)', offset: 0.25 },
        { transform: 'translateX(6px)', offset: 0.55 }, { transform: 'translateX(0)' },
      ], { duration: 340 });
      return;
    }
    const opening = this._openWorld !== vm;
    for (const w of this._worlds) {
      const on = opening && w === vm;
      w.card.classList.toggle('is-open', on);
    }
    this._openWorld = opening ? vm : null;
    this._wIndex = vm.index;

    if (opening) {
      this._buildTiles(vm);
      this._refreshTiles(vm);
      this._mode = fromClick ? 'worlds' : 'stages';
      this._tIndex = 0;
      if (!fromClick) this._paintFocus();
      uiSfx(this.game, 'ui_ok');
      setTimeout(() => {
        if (this._openWorld === vm) {
          try { vm.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
        }
      }, 260);
    } else {
      this._mode = 'worlds';
      uiSfx(this.game, 'ui_move');
    }
    this._paintFocus();
  }

  /** Step into a world's stage grid (expanding it first when collapsed). */
  _enterWorld(vm) {
    if (!vm) return;
    if (vm.locked) { this._toggleWorld(vm, true); return; }
    if (this._openWorld === vm && vm.built && vm.tiles.length) {
      this._mode = 'stages';
      this._tIndex = clamp(this._tIndex, 0, vm.tiles.length - 1);
      uiSfx(this.game, 'ui_ok');
      this._paintFocus();
      return;
    }
    this._toggleWorld(vm, false);
  }

  _pick(rec) {
    if (rec.vm.locked) { this._toggleWorld(rec.vm, true); return; }
    uiSfx(this.game, 'ui_ok');
    const tile = rec.tile;
    animateOnce(tile, [
      { transform: 'translateY(-3px) scale(1)' },
      { transform: 'translateY(-3px) scale(.96)', offset: 0.4 },
      { transform: 'translateY(-3px) scale(1)' },
    ], { duration: 220 });
    this.close(true);
    uiAction(this.game, 'loadStage', rec.id);
  }

  _paintFocus() {
    for (const vm of this._worlds) {
      vm.card.classList.toggle('is-focus', this._mode === 'worlds' && vm.index === this._wIndex);
      if (!vm.built) continue;
      for (let i = 0; i < vm.tiles.length; i++) {
        const on = this._mode === 'stages' && this._openWorld === vm && i === this._tIndex;
        vm.tiles[i].tile.classList.toggle('is-focus', on);
      }
    }
    const vm = this._worlds[this._wIndex];
    const node = this._mode === 'stages' && vm && vm.built && vm.tiles[this._tIndex]
      ? vm.tiles[this._tIndex].tile
      : (vm ? vm.head : null);
    if (node) { try { node.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  }

  _columns(vm) {
    if (!vm || !vm.tiles.length) return 1;
    const top = vm.tiles[0].tile.offsetTop;
    let n = 0;
    for (const t of vm.tiles) { if (t.tile.offsetTop === top) n++; else break; }
    return Math.max(1, n);
  }

  _handleKey(e) {
    if (!this._open) return;
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };

    if (k === 'Escape') {
      stop();
      if (this._mode === 'stages') {
        this._mode = 'worlds';
        uiSfx(this.game, 'ui_move');
        this._paintFocus();
      } else {
        this.close();
      }
      return;
    }

    if (this._mode === 'worlds') {
      if (k === 'ArrowDown' || k === 'Tab' || k === 's' || k === 'S') {
        stop();
        const dir = (k === 'Tab' && e.shiftKey) ? -1 : 1;
        this._wIndex = clamp(this._wIndex + dir, 0, this._worlds.length - 1);
        uiSfx(this.game, 'ui_move');
        this._paintFocus();
        return;
      }
      if (k === 'ArrowUp' || k === 'w' || k === 'W') {
        stop();
        this._wIndex = clamp(this._wIndex - 1, 0, this._worlds.length - 1);
        uiSfx(this.game, 'ui_move');
        this._paintFocus();
        return;
      }
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        stop();
        const vm = this._worlds[this._wIndex];
        if (vm && this._openWorld === vm) this._toggleWorld(vm, false);
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'ArrowRight' || k === 'd' || k === 'D') {
        stop();
        this._enterWorld(this._worlds[this._wIndex]);
        return;
      }
      return;
    }

    /* stage grid */
    const vm = this._openWorld;
    if (!vm || !vm.tiles.length) return;
    const cols = this._columns(vm);
    const n = vm.tiles.length;
    let idx = this._tIndex;
    let moved = false;

    if (k === 'ArrowRight' || k === 'd' || k === 'D') { idx = Math.min(n - 1, idx + 1); moved = true; }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      if (idx === 0) { stop(); this._mode = 'worlds'; uiSfx(this.game, 'ui_move'); this._paintFocus(); return; }
      idx = Math.max(0, idx - 1); moved = true;
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
      if (idx + cols >= n) { stop(); this._mode = 'worlds'; uiSfx(this.game, 'ui_move'); this._paintFocus(); return; }
      idx = Math.min(n - 1, idx + cols); moved = true;
    } else if (k === 'ArrowUp' || k === 'w' || k === 'W') {
      if (idx - cols < 0) { stop(); this._mode = 'worlds'; uiSfx(this.game, 'ui_move'); this._paintFocus(); return; }
      idx = Math.max(0, idx - cols); moved = true;
    } else if (k === 'Tab') {
      idx = (idx + (e.shiftKey ? -1 : 1) + n) % n; moved = true;
    } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      stop();
      this._pick(vm.tiles[idx]);
      return;
    }

    if (moved) {
      stop();
      if (idx !== this._tIndex) { this._tIndex = idx; uiSfx(this.game, 'ui_move'); this._paintFocus(); }
    }
  }

  /* ======================================================================
   * OPEN / CLOSE
   * ====================================================================*/

  /** @param {{worldId?:string}} [opts] optionally auto-expand one world */
  open(opts) {
    if (this._open) return;
    this._open = true;
    pushCapture(this.game);
    if (UIRegistry.hud) UIRegistry.hud.hideFor('select');

    this.el.classList.add('on');
    animateOnce(this.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    window.addEventListener('keydown', this._onKey, true);
    window.addEventListener('resize', this._onResize);

    this.refresh();

    /* pick a sensible starting world: the one in play, or the first unlocked */
    let startIdx = 0;
    const wantId = (opts && opts.worldId) ||
      (this.game && this.game.stage && this.game.stage.def ? this.game.stage.def.world : null);
    if (wantId) {
      const i = this._worlds.findIndex((v) => v.world.id === wantId);
      if (i >= 0) startIdx = i;
    } else {
      const i = this._worlds.findIndex((v) => !v.locked);
      if (i >= 0) startIdx = i;
    }
    this._wIndex = startIdx;
    this._mode = 'worlds';

    const cards = this.body.children;
    for (let i = 0; i < cards.length; i++) {
      animateOnce(cards[i], [
        { opacity: 0, transform: 'translateY(18px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 380, delay: 60 + i * 70, easing: UI_TOKENS.ease.out });
    }

    const vm = this._worlds[startIdx];
    if (vm && !vm.locked) {
      this._buildTiles(vm);
      this._refreshTiles(vm);
      for (const w of this._worlds) w.card.classList.toggle('is-open', w === vm);
      this._openWorld = vm;
      this._tIndex = 0;
    }
    this._paintFocus();

    /* real stage data lands a moment later; redraw everything when it does */
    this._ensureDefs().then(() => {
      if (!this._open) return;
      this.refresh();
      if (this._openWorld) this._refreshTiles(this._openWorld);
    });

    uiSfx(this.game, 'ui_ok');
  }

  /** @param {boolean} [silent] skip the relock (a stage load follows) */
  close(silent) {
    if (!this._open) return;
    this._open = false;
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('resize', this._onResize);
    clearTimeout(this._resizeTimer);

    const a = animateOnce(this.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 190 });
    const done = () => { if (!this._open) this.el.classList.remove('on'); };
    if (a) a.onfinish = done; else done();

    if (UIRegistry.hud) UIRegistry.hud.showFor('select');
    const menuOpen = !!(UIRegistry.menu && UIRegistry.menu.isOpen);
    popCapture(this.game, !silent && !menuOpen);
    if (menuOpen && UIRegistry.menu) {
      const nav = UIRegistry.menu.nav ? UIRegistry.menu.nav[UIRegistry.menu.page] : null;
      if (nav) nav.refresh(true);
    }

    /* TELL THE GAME.
     *
     * Game.openStageSelect() moves the state machine into 'select' and raises
     * `_selectOpen`, and Game derives input.suspended from exactly those. This
     * close — which is what ESC and the BACK button call, and they are the only
     * two ways out, because _handleKey eats Tab for list navigation — used to
     * take the overlay down and tell Game nothing. The result was a game frozen
     * in state 'select' with input suspended and no UI on the screen at all.
     *
     * Game.closeStageSelect() is the reconciler and is guarded against the
     * round trip back into here; it is also safe when Game never owned this
     * open (uiAction('stageSelect') calls open() directly). */
    const g = this.game;
    if (g && typeof g.closeStageSelect === 'function') {
      try { g.closeStageSelect(); } catch (e) { console.warn('[ascendant.ui] closeStageSelect threw', e); }
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('resize', this._onResize);
    clearTimeout(this._resizeTimer);
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (UIRegistry.stageSelect === this) UIRegistry.stageSelect = null;
  }
}

export default StageSelect;
