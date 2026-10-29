// VALE harness — Wick sensitivity sweep + hood value (closing CW4: originality GW-1, the critic's sensitivity-sweep
// gap, r12 M8 value half). The real client (render bench, real RIFT match, the crowd path, real post chain, real Chrome
// GPU) at the gameplay camera (28.5 m, pitch 52°), VFX, UI and fog of war off.
//
//   sweep   every Wick kind × both team models (+ the Hooded Lamp ward when one is out) at 8 headings (the unit turned
//           in place, every other unit hidden), each in BOTH relationship tints (the viewer's team flipped), cropped at
//           1:1 display px and blown up 3×. An eye-pair detector runs on each 1× crop: the lit pixels of the tint hue
//           (HSV S >= 0.40, V >= 0.55, hue within 30° of the tint) as 8-connected blobs; a FLAGGED pair is two blobs of
//           >= 5 px, area ratio <= 1.7, both round (bbox aspect <= 2.0, >= 55 % of the bbox filled), side by side (centre
//           dy <= 0.5 × their mean height, centre dx 1.5-4.5 × their mean width: closer is one lamp split by a bar) with
//           no third comparable blob (>= 0.4 × the smaller) in the same row or within one pair span of the middle, and
//           fewer than two within 2.5 spans (a ring or row of lamps): a lone pair of equal round lights, the thing a face
//           reads from. Flags are for review, not a verdict; every sheet is looked at.
//   lane    every live Greatwick on its own lane heading (no override), both tints, 1× and 3× crops (the HUD verifier's
//           read: closing_hud_verify_04z_wicks_1x.png)
//   hood    r12 M8 value half: a class pass (every material's fragment output replaced by an id; the crowd's own vertex
//           skinning kept) marks each Wick body pixel with its template and its DOMINANT JOINT; the hood = the body
//           pixels skinned mostly to the 'head' bone (the cowl; the hood light and seam are the accent part, apart).
//           Display L* (sRGB → CIE L*) per template over 1-px-eroded masks at the live Wick clusters, against the
//           fighters' L* (pooled fighter pixels at one spot per live fighter, as value_probe does).
//           Gate: Wick hood L* top-25 % (mean of the pixels at or above p75) <= 65 for every template, and below the
//           fighters' top-25 %.
//
//   node _harness/probe_wick_sweep.mjs [--t 975] [--q high] [--tag before] [--seed 7] [--parts sweep,lane,hood]
//
// Shots: _harness/_shots/fw_CW4_<tag>_sweep_<def>_<model>_{1x,3x}.png, fw_CW4_<tag>_lane_<def>_<n>_{1x,3x}.png.
// Report: _harness/_reports/fw_CW4_<tag>_wick_sweep.json. Exit 1 when the hood gate fails or a pair is flagged on a
// Greatwick (the GW-1 blocker); other flags are listed for review.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 975));
const Q = opt('q', 'high');
const TAG = opt('tag', 'run');
const SEED = Number(opt('seed', 7));
const PARTS = new Set(opt('parts', 'sweep,lane,hood').split(','));
const KINDS = ['shieldwick', 'glimwick', 'greatwick', 'brightwick', 'hooded_lamp'];
const SHOTS = join(HERE, '_shots');
const REPORTS = join(HERE, '_reports');
mkdirSync(SHOTS, { recursive: true }); mkdirSync(REPORTS, { recursive: true });

// ── in-page probe (window.__WS__) ──────────────────────────────────────────────────────────────────────
function install(HEAD) {
  const b = window.__VALE_BENCH__, R = b.renderer, gl = R.gl, ctx = gl.getContext();
  const RT = R.warmRT.constructor;
  R.vfx.draw = () => {}; R.vfx.group.visible = false; R.overlay.draw = () => {}; R.vfx.clear();
  const fx = R.vfx.screen.fx; fx.setDead = () => {}; fx.reset();
  R.fog.enabled = false;
  let only = null;                                   // null: every entity drawn (no fog); id: that one + structures
  R.entityVisible = (v) => (only === null ? true : v.id === only || v.kind === 'structure');
  const settle = (n = 12) => { for (let i = 0; i < n; i++) R.render(1 / 60); };
  const TINT = { ally: 212, enemy: 32 };              // hue of TEAM_HEX ally #3F9CFF / enemy #FF9A1F
  const view = () => b.host.view;
  const modelOf = (a) => a.view ? (b.catalog.units.find((u) => u.id === a.def)?.art?.teamModels?.[a.view.team] ?? b.catalog.units.find((u) => u.id === a.def)?.art?.model ?? '') : '';
  const modelName = (a) => (modelOf(a).split('/').pop() || a.def).replace(/^[0-9a-f]{12}-/, '').replace(/\.glb$/, '');

  // ── crops ──
  const crop = (cx, cy, W, H) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d');
    c2.drawImage(gl.domElement, Math.round(cx - W / 2), Math.round(cy - H / 2), W, H, 0, 0, W, H);
    return cv;
  };
  const sheet = (cells, cols, k) => {
    const W = cells[0].width * k, H = cells[0].height * k, rows = Math.ceil(cells.length / cols);
    const cv = document.createElement('canvas'); cv.width = W * cols; cv.height = H * rows;
    const c2 = cv.getContext('2d'); c2.imageSmoothingEnabled = false;
    c2.fillStyle = '#000'; c2.fillRect(0, 0, cv.width, cv.height);
    cells.forEach((c, i) => c2.drawImage(c, 0, 0, c.width, c.height, (i % cols) * W, Math.floor(i / cols) * H, W - (k > 1 ? 3 : 1), H - (k > 1 ? 3 : 1)));
    return cv.toDataURL('image/png');
  };

  // ── eye-pair detector ──
  const blobsOf = (cv, hue) => {
    const W = cv.width, H = cv.height, d = cv.getContext('2d').getImageData(0, 0, W, H).data;
    const lit = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, bb = d[i * 4 + 2] / 255;
      const mx = Math.max(r, g, bb), mn = Math.min(r, g, bb), c = mx - mn;
      if (mx < 0.55 || c / mx < 0.40) continue;
      let h = mx === r ? ((g - bb) / c) % 6 : mx === g ? (bb - r) / c + 2 : (r - g) / c + 4;
      h = (h * 60 + 360) % 360;
      const dh = Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue));
      if (dh <= 30) lit[i] = 1;
    }
    const seen = new Int32Array(W * H).fill(-1), blobs = [];
    for (let s = 0; s < W * H; s++) {
      if (!lit[s] || seen[s] >= 0) continue;
      const st = [s]; seen[s] = blobs.length;
      let n = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      while (st.length) {
        const p = st.pop(), x = p % W, y = (p / W) | 0;
        n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (lit[q] && seen[q] < 0) { seen[q] = blobs.length; st.push(q); }
        }
      }
      blobs.push({ n, cx: +(sx / n).toFixed(1), cy: +(sy / n).toFixed(1), w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
    return blobs.filter((q) => q.n >= 3).sort((p, q) => q.n - p.n);
  };
  const pairsOf = (blobs) => {
    const big = blobs.filter((q) => q.n >= 5), out = [];
    // round: a compact blob (bbox aspect <= 2.0 and >= 55 % of its bbox filled: an ellipse fills 79 %, a diagonal
    // stripe or an arc segment far less)
    const round = (q) => Math.max(q.w, q.h) / Math.max(1, Math.min(q.w, q.h)) <= 2.0 && q.n / (q.w * q.h) >= 0.55;
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
      const A = big[i], B = big[j];
      if (Math.max(A.n, B.n) / Math.min(A.n, B.n) > 1.7 || !round(A) || !round(B)) continue;
      const mh = (A.h + B.h) / 2, mw = (A.w + B.w) / 2, dx = Math.abs(A.cx - B.cx), dy = Math.abs(A.cy - B.cy);
      // dx < 1.5 x their width: a gap under half a light wide, one lamp split by a cage bar or a mullion
      if (dy > 0.5 * mh || dx < 1.5 * mw || dx > 4.5 * mw) continue;
      // a third comparable light in the same row, or anywhere within one pair span of the pair's middle, makes it a
      // row or a cluster of lights (a lamp row, a studded circlet), not a pair
      const lo = Math.min(A.cx, B.cx) - 1.5 * mw, hi = Math.max(A.cx, B.cx) + 1.5 * mw, cyy = (A.cy + B.cy) / 2, cxx = (A.cx + B.cx) / 2;
      const comp = blobs.filter((q) => q !== A && q !== B && q.n >= 0.4 * Math.min(A.n, B.n));
      const third = comp.some((q) => (Math.abs(q.cy - cyy) <= mh && q.cx >= lo && q.cx <= hi) || Math.hypot(q.cx - cxx, q.cy - cyy) <= dx);
      // two or more comparable lights within 2.5 pair spans: a ring or a row of lamps (the Brightwick's ten-lamp
      // circlet, a lantern's slits), never a lone pair
      const ring = comp.filter((q) => Math.hypot(q.cx - cxx, q.cy - cyy) <= 2.5 * dx).length >= 2;
      if (ring) continue;
      if (third) continue;
      out.push({ a: A, b: B });
    }
    return out;
  };

  // ── subjects ──
  const actorsOf = (def, team) => [...R.actors.values()].filter((a) => a.def === def && a.view?.alive && (team === undefined || a.view.team === team));
  const clearance = (a) => {
    let m = Infinity;
    for (const e of view().entities) if (e.alive && e.id !== a.id && e.kind !== 'structure') m = Math.min(m, Math.hypot(e.x - a.x, e.y - a.y));
    return m;
  };
  const shoot = (a, tintRel, k1) => {
    const H = a.artHeight || 1.2;
    const s = R.worldToScreen(a.x, a.y, H * 0.55);
    const W = Math.round(Math.max(130, H * 125)), Hh = Math.round(Math.max(120, H * 112));
    const cv = crop(s.x, s.y, W, Hh);
    const blobs = blobsOf(cv, TINT[tintRel]);
    return { cv, blobs, pairs: pairsOf(blobs) };
  };
  const api = {
    inventory: () => {
      const o = {};
      for (const a of R.actors.values()) if (a.view?.alive && (a.view.kind === 'minion' || a.view.kind === 'ward')) {
        const k = `${a.def}|${a.view.team}`; o[k] = (o[k] ?? 0) + 1;
      }
      return o;
    },
    ff: (s) => { b.ff(s); settle(4); return b.time(); },
    /** 8 headings × 2 tints of the cleanest live unit of (def, team) */
    sweep: (def, team) => {
      const cands = actorsOf(def, team);
      if (!cands.length) return null;
      cands.sort((p, q) => clearance(q) - clearance(p));
      const a = cands[0], save = [a.pf, a.cf];
      only = a.id;
      const pal = R.palette.viewer, myTeam = pal.team;
      const cells = [], rows = [];
      for (const rel of ['ally', 'enemy']) {
        pal.team = rel === 'ally' ? team : 1 - team;
        for (let k = 0; k < 8; k++) {
          const f = (k * Math.PI) / 4;
          a.pf = a.cf = f;
          b.focus(a.x, a.y); b.zoom(28.5);
          settle(14);
          const r = shoot(a, rel);
          cells.push(r.cv);
          rows.push({ rel, headingDeg: k * 45, blobs: r.blobs.slice(0, 8), pairs: r.pairs });
        }
      }
      pal.team = myTeam; a.pf = save[0]; a.cf = save[1]; only = null;
      return { id: a.id, def, team, model: modelName(a), at: [+a.x.toFixed(1), +a.y.toFixed(1)], clearance: +clearance(a).toFixed(1), rows, png1: sheet(cells, 8, 1), png3: sheet(cells, 8, 3) };
    },
    /** every live unit of def on its own heading, both tints */
    lane: (def) => {
      const out = [];
      const pal = R.palette.viewer, myTeam = pal.team;
      only = null;
      for (const a of actorsOf(def)) {
        const cells = [], rows = [];
        for (const rel of ['ally', 'enemy']) {
          pal.team = rel === 'ally' ? a.view.team : 1 - a.view.team;
          b.focus(a.x, a.y); b.zoom(28.5);
          settle(14);
          const r = shoot(a, rel);
          cells.push(r.cv);
          rows.push({ rel, headingDeg: +((a.facing * 180) / Math.PI).toFixed(0), blobs: r.blobs.slice(0, 8), pairs: r.pairs });
        }
        out.push({ id: a.id, team: a.view.team, model: modelName(a), at: [+a.x.toFixed(1), +a.y.toFixed(1)], rows, png1: sheet(cells, 2, 1), png3: sheet(cells, 2, 3) });
      }
      pal.team = myTeam;
      return out;
    },
    /** M8: hood / body / accent L* per Wick template at the live Wick clusters; fighters at one spot each */
    hood: () => {
      only = null;
      // templates: one slot per (def, team model)
      const slots = new Map(), head = [0], names = [''];
      const slotOf = (a) => {
        const k = modelName(a);
        if (!slots.has(k)) {
          slots.set(k, slots.size + 1);
          head.push(HEAD[k] ?? 255); names.push(k);
        }
        return slots.get(k);
      };
      const bakeSlot = new Map();
      for (const a of R.actors.values()) if (a.view && (a.view.kind === 'minion' || a.view.kind === 'ward')) { const s = slotOf(a); if (a.crowdBake) bakeSlot.set(a.crowdBake.id, s); }
      const cache = new Map();
      const classMat = (m, cls, slot, skinned) => {
        const key = `${m.uuid}|${cls}|${slot}|${skinned}`;
        let c = cache.get(key);
        if (c) return c;
        c = m.clone();
        const ob = m.onBeforeCompile, ck = m.customProgramCacheKey;
        c.onBeforeCompile = (sh, r) => {
          ob.call(m, sh, r);
          if (skinned) {
            sh.vertexShader = sh.vertexShader.replace('void main() {', 'flat varying float vqJ;\nvoid main() {\n{ float qj = skinIndex.x, qw = skinWeight.x; if (skinWeight.y > qw) { qw = skinWeight.y; qj = skinIndex.y; } if (skinWeight.z > qw) { qw = skinWeight.z; qj = skinIndex.z; } if (skinWeight.w > qw) { qj = skinIndex.w; } vqJ = qj; }');
            sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'flat varying float vqJ;\nvoid main() {');
          }
          const g = skinned ? 'vqJ / 255.0' : '1.0';
          sh.fragmentShader = sh.fragmentShader.replace(/\}\s*$/, `\ngl_FragColor = vec4( ${cls}.0 / 255.0, ${g}, ${slot}.0 / 255.0, 1.0 );\n}\n`);
        };
        c.customProgramCacheKey = () => `${ck.call(m)}|ws:${cls}:${slot}:${skinned}`;
        c.blending = 1; c.premultipliedAlpha = false; c.transparent = false;
        cache.set(key, c);
        return c;
      };
      const classPass = () => {
        const w = gl.domElement.width, h = gl.domElement.height;
        const rt = new RT(w, h, { depthBuffer: true });
        const undo = [];
        R.scene.traverse((o) => {
          if (!o.isMesh) return;
          const names_ = [];
          for (let p = o; p && p !== R.scene; p = p.parent) names_.push(p.name || '');
          const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
          const hideIt = () => { const vis = o.visible; undo.push(() => { o.visible = vis; }); o.visible = false; };
          if (['vale_outline', 'vale_flash', 'vale_veil_depth'].includes(o.name) || m0?.isShaderMaterial || (m0?.isMeshBasicMaterial && m0.transparent)) return hideIt();
          let cls = 0, slot = 0, skinned = false;
          const crowd = names_.find((n) => /^crowd_\d+$/.test(n));
          const actor = names_.find((n) => n.startsWith('actor_'));
          if (crowd) {
            if (o.name !== 'crowd_part_body' && o.name !== 'crowd_part_accent') return hideIt();
            slot = bakeSlot.get(Number(crowd.split('_')[1])) ?? 0;
            cls = o.name === 'crowd_part_accent' ? 22 : 21; skinned = cls === 21;
          } else if (actor) {
            const [, kind, id] = actor.split('_');
            const a = R.actors.get(Number(id));
            const acc = m0?.name === 'accent';
            if (kind === 'fighter') cls = 20;
            else if (kind === 'minion' || kind === 'ward') { slot = a ? slotOf(a) : 0; cls = acc ? 22 : 21; skinned = !acc && !!o.isSkinnedMesh; }
            else cls = 30;
          }
          const prev = o.material;
          const map = (m) => classMat(m, cls, slot, skinned);
          o.material = Array.isArray(prev) ? prev.map(map) : map(prev);
          undo.push(() => { o.material = prev; });
        });
        const bg = R.scene.background;
        R.scene.background = null;
        const au = gl.shadowMap.autoUpdate; gl.shadowMap.autoUpdate = false;
        const prevRT = gl.getRenderTarget();
        gl.setRenderTarget(rt); gl.setClearColor(0x000000, 1); gl.clear(true, true, true);
        gl.render(R.scene, R.rig.camera);
        const buf = new Uint8Array(w * h * 4);
        gl.readRenderTargetPixels(rt, 0, 0, w, h, buf);
        gl.setRenderTarget(prevRT); gl.shadowMap.autoUpdate = au; R.scene.background = bg;
        for (const u of undo) u();
        rt.dispose();
        settle(2);
        return { w, h, buf };
      };
      const readFrame = () => {
        const w = gl.domElement.width, h = gl.domElement.height;
        gl.setRenderTarget(null);
        const buf = new Uint8Array(w * h * 4);
        ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
        return { w, h, buf };
      };
      const lin8 = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const v = i / 255; lin8[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      const lstarOf = (r, g, bb) => { const Y = 0.2126 * lin8[r] + 0.7152 * lin8[g] + 0.0722 * lin8[bb]; return Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : Y * (24389 / 27); };
      const H = {};
      const add = (k, ls) => { (H[k] ??= new Float64Array(201))[Math.min(200, Math.max(0, Math.round(ls * 2)))]++; };
      const measure = (wantWicks) => {
        settle(14);
        const F = readFrame(), K = classPass();
        const { w, h } = F, A = F.buf, B = K.buf;
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = (y * w + x) * 4, c = B[i];
          if (c < 20 || c === 30) continue;
          let same = true;
          for (const j of [i - 4, i + 4, i - w * 4, i + w * 4]) if (B[j] !== c || B[j + 1] !== B[i + 1] || B[j + 2] !== B[i + 2]) { same = false; break; }
          if (!same) continue;
          const ls = lstarOf(A[i], A[i + 1], A[i + 2]);
          if (c === 20) { if (!wantWicks) add('fighter', ls); continue; }
          if (!wantWicks) continue;
          const slot = B[i + 2], nm = names[slot] ?? `slot${slot}`;
          if (c === 22) add(`accent:${nm}`, ls);
          else if (B[i + 1] === head[slot]) add(`hood:${nm}`, ls);
          else add(`body:${nm}`, ls);
        }
      };
      // Wick clusters (12 m), every cluster with a unit of a template not yet sampled 3 times
      const units = [...R.actors.values()].filter((a) => a.view?.alive && (a.view.kind === 'minion' || a.view.kind === 'ward'));
      const used = new Set(), spots = [];
      for (const a of units) {
        if (used.has(a.id)) continue;
        const near = units.filter((q) => !used.has(q.id) && Math.hypot(q.x - a.x, q.y - a.y) < 6);
        near.forEach((q) => used.add(q.id));
        spots.push({ x: near.reduce((s, q) => s + q.x, 0) / near.length, y: near.reduce((s, q) => s + q.y, 0) / near.length, n: near.length, models: [...new Set(near.map(modelName))] });
      }
      const count = {};
      const wickSpots = [];
      for (const s of spots.sort((p, q) => q.n - p.n)) {
        if (!s.models.some((m) => (count[m] ?? 0) < 3)) continue;
        s.models.forEach((m) => { count[m] = (count[m] ?? 0) + 1; });
        wickSpots.push(s);
        if (wickSpots.length >= 14) break;
      }
      for (const s of wickSpots) { b.focus(s.x, s.y); b.zoom(28.5); measure(true); }
      const figs = [...R.actors.values()].filter((a) => a.view?.kind === 'fighter' && a.view.alive && !a.dev);
      for (const a of figs) { b.focus(a.x, a.y); b.zoom(28.5); measure(false); }
      const stat = (hst) => {
        const n = hst.reduce((s, v) => s + v, 0);
        if (!n) return null;
        const pct = (p) => { let c = 0; for (let i = 0; i < 201; i++) { c += hst[i]; if (c >= p * n) return i / 2; } return 100; };
        const p75 = pct(0.75);
        let s = 0, m = 0; for (let i = Math.round(p75 * 2); i < 201; i++) { s += hst[i] * (i / 2); m += hst[i]; }
        return { px: n, p50: pct(0.5), p75, p95: pct(0.95), top25: +(s / Math.max(1, m)).toFixed(1) };
      };
      const out = {};
      for (const [k, v] of Object.entries(H)) out[k] = stat(v);
      return { stats: out, spots: wickSpots.map((s) => ({ at: [+s.x.toFixed(1), +s.y.toFixed(1)], n: s.n, models: s.models })), fighters: figs.map((a) => a.def), head: Object.fromEntries(names.map((n, i) => [n, head[i]]).slice(1)) };
    },
  };
  window.__WS__ = api;
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────────
// the 'head' joint's index per Wick model (the GLB skin's joint order is the skeleton's bone order in three.js and
// the crowd bake's bone rows)
const HEAD = {};
{
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const units = JSON.parse(readFileSync(join(HERE, '..', 'content', 'units.json'), 'utf8')).units;
  for (const u of units) for (const m of u.art?.teamModels ?? (u.art?.model ? [u.art.model] : [])) {
    if (!KINDS.includes(u.id)) continue;
    const f = join(HERE, '..', 'art', 'out', m.replace(/^assets\//, ''));
    const doc = await io.read(f);
    const sk = doc.getRoot().listSkins()[0];
    const j = sk ? sk.listJoints().findIndex((n) => n.getName() === 'head') : -1;
    HEAD[m.split('/').pop().replace(/\.glb$/, '')] = j >= 0 ? j : 255;
  }
}
const dataUrl = (p, u) => writeFileSync(p, Buffer.from(u.split(',')[1], 'base64'));
const report = { tool: '_harness/probe_wick_sweep.mjs', tag: TAG, q: Q, t: T, seed: SEED, sweep: [], lane: [], hood: null, verdict: {} };
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=${Q}&t=${T}&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false, width: 1920, height: 1080 });
let fail = false;
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__VALE_BENCH__?.error);
  if (err) throw new Error(err);
  const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
  await B((b) => b.frames(60, 1 / 30));
  await page.waitForTimeout(5000);
  await B((b) => b.frames(6, 1 / 30));
  await page.evaluate(`(${install.toString()})(${JSON.stringify(HEAD)})`);
  const W = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__WS__, x), [fn.toString(), a]);
  // every Wick kind of both teams on the field (ff in 10 s steps, at most 120 s)
  let inv = await W((w) => w.inventory());
  for (let i = 0; i < 12; i++) {
    const missing = KINDS.slice(0, 4).flatMap((k) => [0, 1].filter((t) => !inv[`${k}|${t}`]).map((t) => `${k}|${t}`));
    if (!missing.length) break;
    console.log(`  missing ${missing.join(' ')} at t=${await W((w) => w.ff(0))} -> ff 10 s`);
    await W((w) => w.ff(10));
    inv = await W((w) => w.inventory());
  }
  report.inventory = inv;
  report.time = await B((b) => b.time());
  console.log(`t=${report.time} inventory ${JSON.stringify(inv)}`);
  if (PARTS.has('hood')) {
    report.hood = await W((w) => w.hood());
    const st = report.hood.stats, fig = st.fighter;
    const v = {};
    for (const [k, s] of Object.entries(st)) if (k.startsWith('hood:') && s) v[k] = { top25: s.top25, p50: s.p50, px: s.px, pass: s.top25 <= 65 && (!fig || s.top25 < fig.top25) };
    report.verdict.hood = { fighterTop25: fig?.top25 ?? null, fighterP50: fig?.p50 ?? null, perTemplate: v, pass: Object.values(v).length > 0 && Object.values(v).every((x) => x.pass) };
    if (!report.verdict.hood.pass) fail = true;
    console.log('\nM8 hood L* (top-25 % / p50 / px) vs fighters top-25', fig?.top25, 'p50', fig?.p50);
    for (const [k, x] of Object.entries(v)) console.log(`  ${k.padEnd(28)} ${x.top25} / ${x.p50} / ${x.px}  ${x.pass ? 'PASS' : 'FAIL'}`);
    for (const [k, s] of Object.entries(st)) if (!k.startsWith('hood:') && s) console.log(`  (info) ${k.padEnd(28)} top25 ${s.top25} p50 ${s.p50} px ${s.px}`);
  }
  if (PARTS.has('sweep')) {
    for (const def of KINDS) for (const team of [0, 1]) {
      const r = await W((w, a) => w.sweep(a[0], a[1]), [def, team]);
      if (!r) { console.log(`  sweep ${def} team ${team}: none live`); continue; }
      const base = `fw_CW4_${TAG}_sweep_${def}_${r.model}`;
      dataUrl(join(SHOTS, `${base}_1x.png`), r.png1); dataUrl(join(SHOTS, `${base}_3x.png`), r.png3);
      delete r.png1; delete r.png3;
      r.shots = [`_harness/_shots/${base}_1x.png`, `_harness/_shots/${base}_3x.png`];
      r.flagged = r.rows.filter((x) => x.pairs.length).map((x) => `${x.rel}@${x.headingDeg}`);
      report.sweep.push(r);
      console.log(`  sweep ${def.padEnd(12)} ${r.model.padEnd(20)} clearance ${r.clearance} m  flagged pairs: ${r.flagged.length ? r.flagged.join(' ') : 'none'}`);
      if (def === 'greatwick' && r.flagged.length) fail = true;
    }
  }
  if (PARTS.has('lane')) {
    const rs = await W((w) => w.lane('greatwick'));
    rs.forEach((r, i) => {
      const base = `fw_CW4_${TAG}_lane_greatwick_${i}`;
      dataUrl(join(SHOTS, `${base}_1x.png`), r.png1); dataUrl(join(SHOTS, `${base}_3x.png`), r.png3);
      delete r.png1; delete r.png3;
      r.shots = [`_harness/_shots/${base}_1x.png`, `_harness/_shots/${base}_3x.png`];
      r.flagged = r.rows.filter((x) => x.pairs.length).map((x) => `${x.rel}@${x.headingDeg}`);
      report.lane.push(r);
      console.log(`  lane greatwick ${r.model} at ${r.at} heading ${r.rows[0].headingDeg}: flagged ${r.flagged.length ? r.flagged.join(' ') : 'none'}`);
      if (r.flagged.length) fail = true;
    });
  }
  report.verdict.greatwickPairs = report.sweep.filter((r) => r.def === 'greatwick').reduce((s, r) => s + r.flagged.length, 0) + report.lane.reduce((s, r) => s + r.flagged.length, 0);
  report.verdict.otherPairs = report.sweep.filter((r) => r.def !== 'greatwick').map((r) => `${r.model}: ${r.flagged.join(' ') || 'none'}`);
} catch (e) {
  console.error('probe_wick_sweep failed:', e?.message ?? e);
  fail = true;
  report.error = String(e?.message ?? e);
} finally {
  report.logs = logs.slice(0, 40);
  writeFileSync(join(REPORTS, `fw_CW4_${TAG}_wick_sweep.json`), JSON.stringify(report, null, 1));
  console.log(`report _harness/_reports/fw_CW4_${TAG}_wick_sweep.json`);
  await browser.close();
}
process.exit(fail ? 1 : 0);
