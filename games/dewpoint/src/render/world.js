// Builds the three.js view of a level from the sim's runtime pieces, and animates it from sim
// state every frame.
//
// Economy (levels are long journeys of named areas; a view must cost what a short level did):
//   - static geometry - blocks, ramps, edge trim, props, metalwork, unlit paint - is merged PER AREA
//     into one mesh with one material (a paint layer per face, geo.js), so an area is one draw
//     (two with its shadow pass), and areas out of sight are not drawn at all;
//   - everything box-shaped that moves or changes is one instanced batch for the whole level
//     (batches.js), little lumps another, every flame another (flame.js), every sheet of water or
//     fire on a floor another;
//   - baked light, beams, zone volumes, airflow and contact shades are one mesh per area (fx.js);
//   - each mechanism keeps a small "view" with update(dt, alpha, time); views far from the camera
//     are skipped.
// Readability first: what the player can do something with is drawn bolder than what is scenery.

import * as THREE from '../../vendor/three.module.min.js';
import { GeoBuilder, toon, surfaceMaterial, surfaceLayers, inkless, INK, rgb } from './geo.js';
import { getTextures } from './textures.js';
import { FxBuilder, FX } from './fx.js';
import { resolveTheme } from './themes.js';
import { BoxBatch, BOX, Bits } from './batches.js';
import { FLAME } from './flame.js';
import { levelAreas, chunkPlan, chunkOf, distToRect } from './areas.js';
import { buildFireViews } from './world-fire.js';

// Pieces that belong to one element's packs draw themselves: each entry gets the build context and
// returns at once when the level has none of its pieces. Add a new element's module here.
const PACK_VIEWS = [buildFireViews];

// Per-element looks: the three collectibles (water: a glaze shard; fire: a glow-stone; clay: a maker's mark) and the colour of a low-gap hint.
const ELEMENT_LOOK = {
  water: { geo: () => new THREE.OctahedronGeometry(0.3, 0), color: 0xfff6dc, emissive: 0x1fa7b8, scale: [0.75, 1.25, 0.38], glow: null, spark: [0.6, 1, 1], gap: null },
  fire: { geo: () => new THREE.IcosahedronGeometry(0.3, 0), color: 0xffe2a0, emissive: 0xff8a1c, scale: [0.8, 0.8, 0.8], glow: [1.0, 0.72, 0.3], spark: [1, 0.85, 0.5], gap: [1.0, 0.92, 0.5] },
  clay: { geo: () => new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10), color: 0xf3ead8, emissive: 0xb5613a, scale: [1, 1, 1], glow: [1.0, 0.8, 0.6], spark: [1, 0.9, 0.75], gap: [0.9, 1.0, 0.7] },
};

export { buildBackdrop } from './backdrop.js';

const EMBER = [1.0, 0.48, 0.18], EMBER_HOT = [1.0, 0.78, 0.4], CYAN = [0.37, 0.9, 1.0], FROST = [0.6, 0.85, 1.0],
  COLD = [0.62, 0.66, 1.0], LEAF = [0.3, 0.85, 0.5], CREAM_W = [1.0, 0.94, 0.78], STEAMC = [0.86, 0.9, 1.0], WATER_FILMC = [0.4, 1.0, 0.85];

const lerp = (a, b, t) => a + (b - a) * t;
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Thin unlit strips around the base of a zone so its footprint reads at a glance. */
function outline(glow, box, color, k = 1, t = 0.09) {
  const [x0, y0, z0, x1, , z1] = box, h = 0.035, y = y0 + 0.01;
  const c = [color[0] * k, color[1] * k, color[2] * k], o = { color: c, tint: [1, 1, 1] };
  glow.box(x0, y, z0, x1, y + h, z0 + t, o); glow.box(x0, y, z1 - t, x1, y + h, z1, o);
  glow.box(x0, y, z0, x0 + t, y + h, z1, o); glow.box(x1 - t, y, z0, x1, y + h, z1, o);
}

// ---------------------------------------------------------------------------- sheets of liquid and fire
// Water currents, the pools that put a fire out, the kiln fire under a gap and hot floors are ONE
// mesh of flat quads; what each is rides in an attribute and is drawn in the shader. They are
// hazards (or rides), so they are the loudest things on the floor: flat saturated colour, a bold
// rim, and they light themselves - water shows cold and bright in the dark Fire themes, fire
// shows hot in the bright Water ones.
const LIQ = { current: 0, pool: 1, fire: 2, hot: 3 };
const LIQ_VERT = 'attribute vec4 aUv; attribute vec4 aKF; varying vec3 vW; varying vec4 vUv; varying vec4 vKF; varying float vDepth; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vUv = aUv; vKF = aKF; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }';
const LIQ_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime; uniform vec2 uFogNF; uniform vec3 uFogCol;
  varying vec3 vW; varying vec4 vUv; varying vec4 vKF; varying float vDepth;
  void main(){
    float kind = vKF.x, on = vKF.w;
    float edge = min(min(vUv.x, vUv.z - vUv.x), min(vUv.y, vUv.w - vUv.y));      // metres in from the rim
    vec3 col; float a;
    if (kind < 0.5) {
      // a current: two flat blues in bands that run with the flow, white dashes riding it
      vec2 f = vKF.yz; float l = length(f) + 0.001; vec2 d = f / l; vec2 n = vec2(-d.y, d.x);
      vec2 p = vW.xz - f * uTime * on;
      float al = dot(p, d), s = dot(p, n);
      float band = step(0.5, fract(al * 0.42 + sin(s * 2.2) * 0.16));
      col = mix(vec3(0.03, 0.42, 0.62), vec3(0.08, 0.56, 0.74), band);
      float dash = step(0.9, fract(s * 1.3 + 0.2 * sin(al * 0.7))) * step(0.45, fract(al * 0.33 + s * 0.71));
      col = mix(col, vec3(0.86, 0.98, 1.0), dash * 0.9);
      col = mix(col, vec3(0.9, 1.0, 1.0), 1.0 - smoothstep(0.05, 0.09, edge));
      a = 0.9;
    } else if (kind < 1.5) {
      // still water that puts a fire out: loud cyan, slow rings, glints, and a broad white rim - the line not to cross
      float rip = step(0.55, fract(length(vW.xz * vec2(1.0, 1.3) + vec2(sin(vW.z * 0.9), 0.0)) * 0.7 - uTime * 0.22));
      col = mix(vec3(0.0, 0.5, 0.86), vec3(0.06, 0.66, 0.95), rip);
      float glint = step(0.93, sin(vW.x * 5.3 - uTime * 0.9 + sin(vW.z * 3.7 + uTime * 0.6) * 2.0) * 0.5 + 0.5);
      col = mix(col, vec3(1.0), glint * 0.85);
      float rim = 1.0 - smoothstep(0.1, 0.14, edge);
      float rim2 = (1.0 - smoothstep(0.24, 0.27, edge)) * step(0.5, fract(uTime * 0.25 + edge * 2.0));
      col = mix(col, vec3(0.75, 0.96, 1.0), rim2 * 0.6);
      col = mix(col, vec3(1.0), rim);
      // boiled off: the basin shows through until the water comes back
      col = mix(vec3(0.55, 0.62, 0.7), col, on);
      a = mix(0.18, 0.94, on);
    } else if (kind < 2.5) {
      // kiln fire: molten yellow and orange in slow cells, a dark-red crust between them
      vec2 p = vW.xz * 1.1 + vec2(sin(vW.z * 0.8 + uTime * 0.4), cos(vW.x * 0.7 - uTime * 0.3)) * 0.35;
      float cell = sin(p.x * 2.1 + sin(p.y * 1.7 + uTime * 0.6)) * sin(p.y * 2.3 + sin(p.x * 1.3 - uTime * 0.5));
      col = mix(vec3(1.0, 0.36, 0.03), vec3(1.0, 0.8, 0.16), smoothstep(0.1, 0.16, cell));
      col = mix(col, vec3(1.0, 0.98, 0.7), smoothstep(0.62, 0.68, cell));
      col = mix(col, vec3(0.5, 0.04, 0.02), 1.0 - smoothstep(0.03, 0.09, abs(cell + 0.12)));
      col = mix(vec3(0.16, 0.04, 0.04), col, on);
      a = 1.0;
    } else {
      // hot floor: glowing stripes creeping across the tile, a hard edge
      float s = step(0.5, fract((vW.x + vW.z) * 1.1 - uTime * 0.35));
      col = mix(vec3(1.0, 0.3, 0.03), vec3(1.0, 0.66, 0.1), s);
      col = mix(col, vec3(1.0, 0.9, 0.5), 1.0 - smoothstep(0.05, 0.09, edge));
      a = mix(0.06, 0.62 + 0.14 * sin(uTime * 2.3 + vW.x), on);
    }
    float fogF = smoothstep(uFogNF.x, uFogNF.y, vDepth);
    col = mix(col, uFogCol, fogF);
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }`;

class Liquids {
  constructor() { this.pos = []; this.uv = []; this.kf = []; this.idx = []; this.n = 0; this.mesh = null; }
  /** A sheet covering box [x0, z0, x1, z1] at height y. Returns its index for setOn(). */
  add(kind, x0, z0, x1, z1, y, flow = [0, 0]) {
    const i = this.n++, w = x1 - x0, d = z1 - z0;
    this.pos.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    this.uv.push(0, 0, w, d, w, 0, w, d, 0, d, w, d, w, d, w, d);
    for (let k = 0; k < 4; k++) this.kf.push(kind, flow[0], flow[1], 1);
    this.idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 2, i * 4 + 3, i * 4 + 1);
    return i;
  }
  build(theme) {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 4));
    this.attr = new THREE.Float32BufferAttribute(this.kf, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aKF', this.attr);
    g.setIndex(this.idx);
    const fog = new THREE.Color(theme.fog);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFogNF: { value: new THREE.Vector2(theme.fogNear, theme.fogFar) }, uFogCol: { value: new THREE.Vector3(fog.r, fog.g, fog.b) } },
      vertexShader: LIQ_VERT, fragmentShader: LIQ_FRAG, transparent: true, depthWrite: false, premultipliedAlpha: true, fog: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = 8; this.mesh.frustumCulled = false;
    this.geo = g;
    return this.mesh;
  }
  setOn(i, v) {
    const a = this.attr;
    if (a.getW(i * 4) === v) return;
    for (let k = 0; k < 4; k++) a.setW(i * 4 + k, v);
    a.needsUpdate = true;
  }
  dispose() { if (this.mesh) { this.geo.dispose(); this.mat.dispose(); } }
}

/** Colours props and metalwork take from a theme, so the same pot is teal in the slip room and charcoal in the flue. */
function propPalette(theme) {
  const P = theme.paints, m = P.metal;
  const mix = (a, b, t) => { const A = rgb(new THREE.Color(a).getHex()), B = rgb(new THREE.Color(b).getHex()); return mixc(A, B, t); };
  return {
    iron: mix(m.line, m.tones[0], 0.3), steel: rgb(new THREE.Color(m.tones[0]).getHex()), bright: mix(m.tones[0], '#ffffff', 0.45),
    wood: mix('#c98a4a', P.dark.tones[0], 0.25), woodDark: mix('#7a4a26', P.dark.tones[0], 0.35),
    potA: rgb(new THREE.Color(theme.trim).getHex()), potB: rgb(new THREE.Color(P.floor.tones[0]).getHex()), potC: rgb(new THREE.Color(P.floorAlt.tones[0]).getHex()),
    dome: rgb(new THREE.Color(P.brick.tones[0]).getHex()), domeDark: rgb(new THREE.Color(P.dark.tones[0]).getHex()),
    trim: rgb(new THREE.Color(theme.trim).getHex()), cream: rgb(new THREE.Color('#fff3dc').getHex()), brass: rgb(new THREE.Color('#e8b04a').getHex()),
    ink: rgb(new THREE.Color(theme.ink).getHex()),
  };
}

export function buildWorld(sim, ctx) {
  const L = sim.level, T = getTextures();
  const theme = ctx.theme || resolveTheme(L);
  const { particles: P, glows: G, flames: F } = ctx;
  const group = new THREE.Group();
  const views = [];
  const disposables = [];
  const own = (obj) => { disposables.push(obj); return obj; };
  const blocks = L.blocks;
  const lamp = theme.lamp;
  const pal = propPalette(theme);
  const dark = theme.dark, poolK = theme.poolK;
  const time = { value: 0 };
  const shimmers = [];
  const shimmer = (x, y, z, r, k = 1) => { const s = { x, y, z, r, k }; shimmers.push(s); return s; };

  // ------------------------------------------------------------------ areas -> chunks
  const plan = chunkPlan(L.bounds, levelAreas(L));
  const chunks = plan.map((rect) => ({ rect, stat: new GeoBuilder(), fx: new FxBuilder(), meshes: [], box: null, vis: true }));
  const at = (x, z) => chunks[chunkOf(plan, x, z)];
  const decorAt = (x, z) => at(x, z).stat;
  const glowAt = (x, z) => at(x, z).stat.glow;
  const fxAt = (x, z) => at(x, z).fx;
  /** A brightness slot in the baked-light mesh of the area round (x, z): { fx, i, set(v), get() }. */
  const slot = (x, z, v = 1) => { const fx = fxAt(x, z), i = fx.slot(v); return { fx, i, set(val) { fx.dyn[i] = val; }, get() { return fx.dyn[i]; } }; };

  // A light can only paint faces it can see: test against static blocks only.
  const solidBlock = (s) => s.owner && s.owner.type === 'block';
  const seen = (c) => (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2], d = Math.hypot(dx, dy, dz);
    if (d < 0.05) return true;
    return sim.raycast(c[0], c[1], c[2], dx / d, dy / d, dz / d, d, solidBlock) >= d - 0.08;
  };
  /** A pool of baked light at c. By day most are too faint to be worth their fill: those are not built at all. */
  const pool = (c, r, col, k = 1, s = null) => {
    const kk = k * poolK;
    if (kk < 0.14) return;
    (s ? s.fx : fxAt(c[0], c[2])).pool(c, r, mul(col, kk), blocks, s ? s.i : 0, seen(c));
  };

  // every block's near neighbours, found once: the trim, the contact shades and the low-gap marks all ask "what touches this?"
  const near = new Map();
  {
    const cell = 8, grid = new Map();
    const key = (i, j) => i * 4096 + j;
    blocks.forEach((p) => {
      const b = p.box;
      for (let i = Math.floor((b[0] - 1) / cell); i <= Math.floor((b[3] + 1) / cell); i++) for (let j = Math.floor((b[2] - 1) / cell); j <= Math.floor((b[5] + 1) / cell); j++) {
        const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p);
      }
    });
    for (const p of blocks) {
      const b = p.box, set = new Set();
      for (let i = Math.floor((b[0] - 1) / cell); i <= Math.floor((b[3] + 1) / cell); i++) for (let j = Math.floor((b[2] - 1) / cell); j <= Math.floor((b[5] + 1) / cell); j++) {
        for (const q of grid.get(key(i, j)) || []) {
          const c = q.box;
          if (q !== p && c[0] <= b[3] + 0.7 && c[3] >= b[0] - 0.7 && c[2] <= b[5] + 0.7 && c[5] >= b[2] - 0.7) set.add(q);
        }
      }
      near.set(p, [...set]);
    }
  }

  // ------------------------------------------------------------------ static surfaces
  const ao = theme.ao;
  const mid = (b) => [(b[0] + b[3]) / 2, (b[2] + b[5]) / 2];
  for (const p of L.blocks) {
    const b = p.box, s = surfaceLayers(theme, p.mat), [cx, cz] = mid(b);
    at(cx, cz).stat.box(b[0], b[1], b[2], b[3], b[4], b[5], { top: s.top, side: s.side, glaze: s.glaze, ao, aoH: 0.9, tint: [s.topTint, s.sideTint, 0.72] });
  }
  for (const p of L.ramps) {
    const b = p.box, s = surfaceLayers(theme, p.mat), [cx, cz] = mid(b);
    at(cx, cz).stat.wedge(b[0], b[1], b[2], b[3], b[4], b[5], p.up, { top: s.top, side: s.side, glaze: s.glaze, tint: [s.topTint, s.sideTint, 0.72] });
  }

  // ------------------------------------------------------------------ edge trim
  // A pale bullnose lip along every exposed top edge: "this is an edge you can stand on / fall
  // off" reads at a glance, from any distance, and the ink pass outlines it.
  {
    const trimTop = theme.trim;
    const STEP = 0.2, OUT = 0.04, IN = 0.09, UP = 0.02, DOWN = 0.11;
    const o = { color: trimTop, tint: [1, 0.9, 0.7], skip: 'b' };     // the underside of a lip is never seen
    for (const p of blocks) {
      const b = p.box, y = b[4], nb = near.get(p);
      if (b[3] - b[0] < 0.12 || b[5] - b[2] < 0.12) continue;
      const covered = (x, z) => {
        for (const q of nb) { const c = q.box; if (x > c[0] && x < c[3] && z > c[2] && z < c[5] && c[1] <= y + 0.02 && c[4] >= y - 0.02) return true; }
        return false;
      };
      const tb = at(...mid(b)).stat;
      const edges = [
        // [fixed axis, value, outward sign, from, to]
        ['z', b[2], -1, b[0], b[3]], ['z', b[5], 1, b[0], b[3]],
        ['x', b[0], -1, b[2], b[5]], ['x', b[3], 1, b[2], b[5]],
      ];
      for (const [ax, atv, sg, from, to] of edges) {
        const n = Math.max(1, Math.round((to - from) / STEP));
        let runStart = null;
        const flush = (endU) => {
          if (runStart === null) return;
          const u0 = runStart, u1 = endU;
          if (u1 - u0 > 0.05) {
            if (ax === 'z') { const z0 = sg < 0 ? atv - OUT : atv - IN, z1 = sg < 0 ? atv + IN : atv + OUT; tb.box(u0, y - DOWN, z0, u1, y + UP, z1, o); }
            else { const x0 = sg < 0 ? atv - OUT : atv - IN, x1 = sg < 0 ? atv + IN : atv + OUT; tb.box(x0, y - DOWN, u0, x1, y + UP, u1, o); }
          }
          runStart = null;
        };
        for (let i = 0; i < n; i++) {
          const u0 = from + (to - from) * (i / n), u1 = from + (to - from) * ((i + 1) / n), um = (u0 + u1) / 2;
          const px = ax === 'z' ? um : atv + sg * 0.06, pz = ax === 'z' ? atv + sg * 0.06 : um;
          const cov = covered(px, pz);
          if (!cov && runStart === null) runStart = u0;
          if (cov) flush(u0);
          if (i === n - 1) flush(u1);
        }
      }
    }
  }

  // ------------------------------------------------------------------ contact shades (in the baked-light mesh, pool band)
  for (const p of blocks) at(...mid(p.box)).fx.contact(p, near.get(p), pal.ink);

  // ------------------------------------------------------------------ low gaps (the flattest form only)
  // A block hovering just above a floor, too low for the default form but roomy enough for the
  // element's lowest one (film; a spark), gets a bright painted lip along its underside:
  // "squeeze through here".
  {
    const E = sim.element, hs = E.forms.map((f) => E.formDefs[f].h);
    const lo = Math.min(...hs) + 0.01, hi = E.formDefs[E.defaultForm].h, tall = Math.max(...hs);
    const FILMC = (ELEMENT_LOOK[E.id] || ELEMENT_LOOK.water).gap || WATER_FILMC;
    const DUCK = [1.0, 0.62, 0.12], DUCK2 = [0.1, 0.05, 0.05];
    for (const B of blocks) {
      const b = B.box;
      for (const Fl of near.get(B)) {
        const f = Fl.box, gap = b[1] - f[4];
        if (gap < lo || gap >= tall + 0.02) continue;
        const x0 = Math.max(b[0], f[0]), x1 = Math.min(b[3], f[3]), z0 = Math.max(b[2], f[2]), z1 = Math.min(b[5], f[5]);
        if (x1 - x0 < 0.3 || z1 - z0 < 0.3) continue;
        const glow = glowAt((x0 + x1) / 2, (z0 + z1) / 2);
        if (gap <= hi) {
          // only the flattest form fits: a bright lip
          const y = b[1] - 0.05, t = 0.07;
          const col = { color: mul(FILMC, 0.95), tint: [1, 1, 1] };
          glow.box(x0, y, z0 - 0.015, x1, y + 0.05, z0 + t, col); glow.box(x0, y, z1 - t, x1, y + 0.05, z1 + 0.015, col);
          glow.box(x0 - 0.015, y, z0, x0 + t, y + 0.05, z1, col); glow.box(x1 - t, y, z0, x1 + 0.015, y + 0.05, z1, col);
          pool([(x0 + x1) / 2, f[4] + gap * 0.6, (z0 + z1) / 2], Math.min(2.2, Math.max(x1 - x0, z1 - z0) * 0.6 + 0.6), FILMC, 0.5);
        } else {
          // the default form fits, a taller one does not (an ember's tunnel that stops a blaze): a
          // warning beam along each open mouth - fat amber and black stripes on its lower edge and a
          // row of teeth below it, the height of the taller form marked on the floor in front
          const lip = (u0, u1, at, alongX, out) => {
            if (u1 - u0 < 0.3) return;
            const n = Math.max(2, Math.round((u1 - u0) / 0.42));
            for (let i = 0; i < n; i++) {
              const a = u0 + (u1 - u0) * i / n, c = u0 + (u1 - u0) * (i + 1) / n, o = { color: i % 2 ? DUCK2 : DUCK, tint: [1, 1, 1] };
              const w0 = out < 0 ? at - 0.05 : at - 0.01, w1 = out < 0 ? at + 0.01 : at + 0.05;
              if (alongX) glow.box(a, b[1], w0, c, b[1] + 0.2, w1, o); else glow.box(w0, b[1], a, w1, b[1] + 0.2, c, o);
              if (i % 2 === 0) {
                // a tooth hanging into the gap: "duck"
                const m = (a + c) / 2, tw = (c - a) * 0.32;
                if (alongX) glow.box(m - tw, b[1] - 0.1, w0, m + tw, b[1], w1, { color: DUCK, tint: [1, 1, 1] }); else glow.box(w0, b[1] - 0.1, m - tw, w1, b[1], m + tw, { color: DUCK, tint: [1, 1, 1] });
              }
            }
            // a dashed line on the floor under the mouth
            for (let i = 0; i < n; i += 2) {
              const a = u0 + (u1 - u0) * i / n, c = u0 + (u1 - u0) * (i + 1) / n, o = { color: mul(DUCK, 0.9), tint: [1, 1, 1] };
              const w0 = at + out * 0.06, w1 = at + out * 0.2;
              if (alongX) glow.box(a, f[4] + 0.005, Math.min(w0, w1), c, f[4] + 0.02, Math.max(w0, w1), o); else glow.box(Math.min(w0, w1), f[4] + 0.005, a, Math.max(w0, w1), f[4] + 0.02, c, o);
            }
          };
          // a mouth is an edge of the low block that the floor carries on past
          if (f[2] < b[2] - 0.4) lip(x0, x1, b[2], true, -1);
          if (f[5] > b[5] + 0.4) lip(x0, x1, b[5], true, 1);
          if (f[0] < b[0] - 0.4) lip(z0, z1, b[0], false, -1);
          if (f[3] > b[3] + 0.4) lip(z0, z1, b[3], false, 1);
        }
      }
    }
  }

  // ------------------------------------------------------------------ the batches
  const packBoxes = (L.woods ? L.woods.length : 0) + (L.iceblocks ? L.iceblocks.length : 0) + (L.waxes ? L.waxes.length : 0) + (L.weakwalls ? L.weakwalls.length : 0);
  const boxes = new BoxBatch(L.plates.length + L.doors.length + L.movers.length + L.crates.length + L.exits.length + packBoxes + 1,
    { metal: theme.paints.metal.tones[0], metalLine: theme.paints.metal.line, accent: theme.trim }, time);
  const bits = new Bits();
  const liquids = new Liquids();
  const fadeSwap = [];

  // ------------------------------------------------------------------ plates
  for (const pl of L.plates) {
    const b = pl.box, w = b[3] - b[0], d = b[5] - b[2];
    const col = pl.heavy ? EMBER : CYAN;
    const th = pl.heavy ? 0.1 : 0.07, rim = pl.heavy ? 0.12 : 0.08;
    const bi = boxes.add(pl.heavy ? BOX.heavy : BOX.plate);
    const gh = G.add(pl.pos[0], pl.pos[1] + 0.25, pl.pos[2], col, 2.4, 0.1);
    const sl = slot(pl.pos[0], pl.pos[2], 0.35);
    pool([pl.pos[0], pl.pos[1] + 0.9, pl.pos[2]], 2.0, col, 0.5, sl);
    let k = 0, wig = 0, was = pl.pressed;
    const cx = pl.pos[0], cz = pl.pos[2];
    views.push({
      at: [cx, cz],
      update(dt) {
        k += ((pl.pressed ? 1 : 0) - k) * Math.min(1, dt * 16);
        wig = pl.refused ? wig + dt * 30 : 0;
        boxes.place(bi, cx + (pl.refused ? Math.sin(wig) * 0.012 : 0), pl.pos[1] - k * (pl.heavy ? 0.07 : 0.045), cz, w + rim * 2, th, d + rim * 2);
        boxes.state(bi, Math.round(k * 20) / 20);
        gh.alpha = 0.08 + k * 0.35;
        sl.set(0.3 + k * 1.3);
        if (pl.pressed !== was) {
          was = pl.pressed;
          if (was) {
            for (let i = 0; i < 20; i++) {
              const a = (i / 20) * Math.PI * 2;
              P.spawn({ x: cx + Math.cos(a) * w * 0.55, y: pl.pos[1] + 0.08, z: cz + Math.sin(a) * d * 0.55, vx: Math.cos(a) * 1.6, vy: 0.6 + P.rnd() * 0.6, vz: Math.sin(a) * 1.6, life: 0.45, size: 0.1, color: col, drag: 3 });
            }
          }
        }
      },
    });
  }

  // ------------------------------------------------------------------ doors
  for (const d of L.doors) {
    const b = d.box, w = b[3] - b[0], h = b[4] - b[1], dp = b[5] - b[2];
    const bi = boxes.add(BOX.door);
    const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, alongZ = dp > w;
    let lastO = d.open, moving = false, bounce = 0, lit = 0;
    const dust = (y) => {
      for (let i = 0; i < 14; i++) {
        const u = P.rnd() - 0.5;
        P.spawn({ x: cx + (alongZ ? (P.rnd() - 0.5) * 0.6 : u * w), y: y + 0.05, z: cz + (alongZ ? u * dp : (P.rnd() - 0.5) * 0.6), vx: (P.rnd() - 0.5) * 1.4, vy: 0.4 + P.rnd() * 0.6, vz: (P.rnd() - 0.5) * 1.4, life: 0.7, size: 0.3, grow: 0.4, color: [0.93, 0.9, 0.84], alpha: 0.5, drag: 2.5, solid: 1 });
      }
    };
    views.push({
      at: [cx, cz],
      update(dt, alpha) {
        const o = lerp(d.popen, d.open, alpha);
        const nowMoving = Math.abs(d.open - lastO) > 1e-5;
        if (moving && !nowMoving) {
          // came to rest: a heavy little settle and a puff of dust where it landed
          bounce = 1;
          dust(d.open < 0.5 ? b[1] : b[1] + d.travel[1]);
        }
        if (!moving && nowMoving) dust(b[1] + d.travel[1] * o);
        moving = nowMoving; lastO = d.open;
        bounce = Math.max(0, bounce - dt * 5);
        const settle = Math.sin(bounce * Math.PI * 3) * bounce * 0.035;
        if (d.buried && o > 0.995) boxes.hide(bi);
        else boxes.place(bi, cx + d.travel[0] * o, b[1] + d.travel[1] * o + settle, cz + d.travel[2] * o, w, h, dp);
        lit += ((d.target ? 1 : 0) - lit) * Math.min(1, dt * 6);          // its chevrons light while its signal holds it open
        boxes.state(bi, Math.round(lit * 20) / 20);
      },
    });
  }

  // ------------------------------------------------------------------ movers
  for (const mv of L.movers) {
    const b = mv.box, w = b[3] - b[0], h = b[4] - b[1], dp = b[5] - b[2];
    const bi = boxes.add(BOX.mover);
    const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    let k = 0;
    views.push({
      update(dt, alpha) {
        const tt = lerp(mv.pt, mv.t, alpha);
        boxes.place(bi, cx + mv.to[0] * tt, b[1] + mv.to[1] * tt, cz + mv.to[2] * tt, w, h, dp);
        k += ((mv.moving ? 1 : 0.2) - k) * Math.min(1, dt * 5);
        boxes.state(bi, Math.round(k * 20) / 20);
      },
    });
  }

  // ------------------------------------------------------------------ crates
  for (const c of L.crates) {
    const bi = boxes.add(BOX.crate);
    views.push({
      update(dt, alpha) {
        const q = c.body;
        boxes.place(bi, lerp(c.px, q.x, alpha), lerp(c.py, q.y, alpha), lerp(c.pz, q.z, alpha), c.size[0], c.size[1], c.size[2]);
      },
    });
  }

  // ------------------------------------------------------------------ panes (fast ice only)
  // Every pane is ONE instanced draw (a unit box scaled to each pane; a broken pane scales to nothing),
  // and single-pass: a double-sided transparent material would otherwise cost two calls per pane.
  if (L.panes.length) {
    const paneMat = own(new THREE.MeshBasicMaterial({ map: T.pane, transparent: true, opacity: 0.96, side: THREE.DoubleSide, depthWrite: false, color: 0xffffff, forceSinglePass: true, toneMapped: false }));
    const paneInst = new THREE.InstancedMesh(own(new THREE.BoxGeometry(1, 1, 1)), paneMat, L.panes.length);
    paneInst.renderOrder = 10; paneInst.frustumCulled = false;
    paneInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(paneInst);
    const NONE = new THREE.Matrix4().makeScale(0, 0, 0);
    L.panes.forEach((pn, pi) => {
      const b = pn.box, pc = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const live = new THREE.Matrix4().compose(new THREE.Vector3(pc[0], pc[1], pc[2]), new THREE.Quaternion(), new THREE.Vector3(b[3] - b[0], b[4] - b[1], b[5] - b[2]));
      paneInst.setMatrixAt(pi, live);
      // an icy frame, so "glass you can break as ice" reads apart from a grate or a wall
      const thinX = b[3] - b[0] < b[5] - b[2], e = 0.04, fw = 0.09;
      const frame = { color: [0.82, 0.95, 1.0], tint: [1, 1, 1] }, glow = glowAt(pc[0], pc[2]);
      if (thinX) {
        glow.box(b[0] - e, b[1], b[2], b[3] + e, b[1] + fw, b[5], frame); glow.box(b[0] - e, b[4] - fw, b[2], b[3] + e, b[4], b[5], frame);
        glow.box(b[0] - e, b[1], b[2], b[3] + e, b[4], b[2] + fw, frame); glow.box(b[0] - e, b[1], b[5] - fw, b[3] + e, b[4], b[5], frame);
      } else {
        glow.box(b[0], b[1], b[2] - e, b[3], b[1] + fw, b[5] + e, frame); glow.box(b[0], b[4] - fw, b[2] - e, b[3], b[4], b[5] + e, frame);
        glow.box(b[0], b[1], b[2] - e, b[0] + fw, b[4], b[5] + e, frame); glow.box(b[3] - fw, b[1], b[2] - e, b[3], b[4], b[5] + e, frame);
      }
      const sl = slot(pc[0], pc[2], 1);
      pool([pc[0], b[1] + 1.2, pc[2]], 2.2, FROST, 0.4, sl);
      const gh = G.add(pc[0], pc[1], pc[2], FROST, 5, 0.12);
      let acc = 0, was = false;
      views.push({
        at: [pc[0], pc[2]],
        update(dt) {
          if (pn.broken !== was) { was = pn.broken; paneInst.setMatrixAt(pi, was ? NONE : live); paneInst.instanceMatrix.needsUpdate = true; }
          sl.set(pn.broken ? 0 : 1); gh.alpha = pn.broken ? 0 : 0.12;
          if (pn.broken) return;
          acc += dt * 2.5;
          if (acc > 1) {
            acc = 0;
            P.spawn({ x: lerp(b[0], b[3], P.rnd()), y: lerp(b[1], b[4], P.rnd()), z: lerp(b[2], b[5], P.rnd()), life: 0.5, size: 0.12, color: [0.95, 1, 1], alpha: 0.9 });
          }
        },
      });
    });
  }

  // ------------------------------------------------------------------ embers (liquid douses)
  // A pile of live coals with flames standing on it: in the bright Water levels it is the hottest
  // thing in the picture, and it goes grey and steams when a drop puts it out.
  for (const e of L.embers) {
    const b = e.box, w = b[3] - b[0], h = b[4] - b[1], dp = b[5] - b[2];
    const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    const n = Math.max(3, Math.min(12, Math.round(w * dp * 2.2 + h)));
    let heat = 1;
    for (let i = 0; i < n; i++) {
      const u = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1), v = Math.abs((Math.sin(i * 78.233) * 12543.123) % 1);
      const r = Math.min(w, dp) * (0.22 + 0.16 * u);
      const x = b[0] + r + u * Math.max(0, w - 2 * r), y = b[1] + (i % 3) * Math.min(h - r, 0.35) * 0.9, z = b[2] + r + v * Math.max(0, dp - 2 * r);
      const hot = i % 3 === 2;
      bits.add((set, dt, t) => {
        const g = heat * (0.8 + 0.2 * Math.sin(t * 4 + i * 1.3));
        set(x, y, z, r, r * 0.8, r, lerp(0.3, hot ? 1.0 : 0.82, g), lerp(0.3, hot ? 0.62 : 0.2, g), lerp(0.34, hot ? 0.16 : 0.05, g));
      }, [cx, cz]);
    }
    const nf = Math.max(2, Math.min(5, Math.round(Math.max(w, dp) * 1.3)));
    const fl = [];
    for (let i = 0; i < nf; i++) {
      const u = (i + 0.5) / nf, alongX = w >= dp;
      fl.push(F.add(alongX ? lerp(b[0], b[3], u) : cx + (i % 2 ? 0.2 : -0.2) * w, b[1] + Math.min(h, 0.5) * 0.6, alongX ? cz + (i % 2 ? 0.2 : -0.2) * dp : lerp(b[2], b[5], u), 0.75, 1.1 + (i % 2) * 0.35, FLAME.fire, { minor: i % 2 === 1 }));
    }
    const gh = G.add(cx, b[1] + Math.min(h, 1) * 0.6, cz, EMBER, 5 + Math.max(w, dp) * 1.5, 0.5, 0.25);
    const sl = slot(cx, cz, 1);
    pool([cx, b[1] + Math.min(h, 1) + 0.4, cz], 2.4 + Math.max(w, dp) * 0.6, EMBER, 0.55, sl);
    outline(glowAt(cx, cz), b, [1.0, 0.36, 0.08], 1, 0.07);
    const sh = shimmer(cx, b[1] + 0.8, cz, 1.6, 1);
    let acc = 0;
    views.push({
      at: [cx, cz],
      update(dt, alpha, t) {
        heat += ((e.doused ? 0 : 1) - heat) * Math.min(1, dt * 3);
        for (const f of fl) f.k = heat;
        gh.alpha = 0.5 * heat; sh.k = heat;
        sl.set(heat * (0.85 + 0.15 * Math.sin(t * 7 + cz)));
        if (e.doused) return;
        acc += dt * (4 + w * dp * 3);
        while (acc > 1) {
          acc -= 1;
          P.spawn({ x: b[0] + P.rnd() * w, y: b[1] + h * 0.5 + P.rnd() * 0.3, z: b[2] + P.rnd() * dp, vx: (P.rnd() - 0.5) * 0.4, vy: 0.8 + P.rnd() * 1.4, vz: (P.rnd() - 0.5) * 0.4, life: 0.9 + P.rnd() * 0.8, size: 0.08, color: EMBER_HOT, drag: 0.4, solid: 0.4 });
        }
      },
    });
  }

  // ------------------------------------------------------------------ grates & slots (static metalwork)
  const bars = (b, color, pitch, barT, rail, glowCol) => {
    const sx = b[3] - b[0], sy = b[4] - b[1], sz = b[5] - b[2];
    const [cx, cz] = mid(b), decor = decorAt(cx, cz), glow = glowAt(cx, cz);
    const id = INK.prop(decor.props++);
    const o = { color, tint: [1, 0.86, 0.66], ink: id };
    const thin = sx <= sy && sx <= sz ? 0 : (sy <= sz ? 1 : 2);
    const gl = { color: glowCol, tint: [1, 1, 1] }, e = 0.02;
    if (thin === 1) {
      // horizontal: bars run along the longer of x/z. Drawn as shallow slats at the top of the
      // piece (not the full collision depth), so from a low angle you still see down between them.
      const alongX = sx >= sz, span = alongX ? sz : sx, n = Math.max(2, Math.round(span / pitch));
      const y0 = Math.max(b[1], b[4] - 0.09);
      for (let i = 0; i <= n; i++) {
        const c = (alongX ? b[2] : b[0]) + (i / n) * (span - barT) + barT / 2;
        if (alongX) decor.box(b[0], y0, c - barT / 2, b[3], b[4], c + barT / 2, o);
        else decor.box(c - barT / 2, y0, b[2], c + barT / 2, b[4], b[5], o);
      }
      if (rail) { if (alongX) { decor.box(b[0], b[1], b[2], b[0] + rail, b[4], b[5], o); decor.box(b[3] - rail, b[1], b[2], b[3], b[4], b[5], o); } else { decor.box(b[0], b[1], b[2], b[3], b[4], b[2] + rail, o); decor.box(b[0], b[1], b[5] - rail, b[3], b[4], b[5], o); } }
      outline(glow, [b[0], b[4] - 0.03, b[2], b[3], 0, b[5]], glowCol, 1, 0.06);
    } else {
      // vertical panel: upright bars, rails top and bottom, a bright frame
      const alongX = thin === 2, span = alongX ? sx : sz, n = Math.max(2, Math.round(span / pitch));
      for (let i = 0; i <= n; i++) {
        const c = (alongX ? b[0] : b[2]) + (i / n) * (span - barT) + barT / 2;
        if (alongX) decor.box(c - barT / 2, b[1], b[2], c + barT / 2, b[4], b[5], o);
        else decor.box(b[0], b[1], c - barT / 2, b[3], b[4], c + barT / 2, o);
      }
      if (rail) { decor.box(b[0], b[1], b[2], b[3], b[1] + rail, b[5], o); decor.box(b[0], b[4] - rail, b[2], b[3], b[4], b[5], o); }
      if (alongX) { glow.box(b[0], b[1] - e, b[2] - e, b[3], b[1] + 0.05, b[5] + e, gl); glow.box(b[0], b[4] - 0.05, b[2] - e, b[3], b[4] + e, b[5] + e, gl); }
      else { glow.box(b[0] - e, b[1] - e, b[2], b[3] + e, b[1] + 0.05, b[5], gl); glow.box(b[0] - e, b[4] - 0.05, b[2], b[3] + e, b[4] + e, b[5], gl); }
    }
  };
  for (const g of L.grates) {
    bars(g.box, pal.steel, 0.3, 0.085, 0.1, mul(STEAMC, 1.0));
    const b = g.box, c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    G.add(c[0], c[1], c[2], STEAMC, 4.5, 0.1);
    pool(c, 2.4, STEAMC, 0.3);
  }
  // floor slots: thin slats (visual only; the sim's collision box is unchanged) so the player can
  // see down through them into whatever lies below
  for (const s of L.slots) {
    bars(s.box, pal.wood, 0.2, 0.075, 0.1, mul(WATER_FILMC, 0.95));
    const b = s.box;
    pool([(b[0] + b[3]) / 2, b[4] + 0.6, (b[2] + b[5]) / 2], 1.8, WATER_FILMC, 0.4);
  }

  // ------------------------------------------------------------------ sprouts
  if (L.sprouts.length) {
    const mat = own(toon({ vertexColors: true, ink: 'attr', emissive: 0x0b3a22, emissiveIntensity: 0.5 }));
    for (const sp of L.sprouts) {
      const bud = new GeoBuilder();
      bud.inkId = INK.prop(3);
      bud.cylinder(0, 0, 0, 0.06, 0.04, 0.24, 6, 0x35b56e);
      bud.box(-0.26, 0.2, -0.09, 0, 0.26, 0.09, { color: 0x58e08e, tint: [1, 0.86, 0.7] }); bud.box(0, 0.22, -0.09, 0.26, 0.28, 0.09, { color: 0x58e08e, tint: [1, 0.86, 0.7] });
      const budM = new THREE.Mesh(own(bud.build()), mat);
      budM.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
      budM.castShadow = true;
      const pb = new GeoBuilder();
      pb.inkId = INK.prop(4);
      pb.cylinder(0, 0, 0, 0.15, 0.1, sp.height - 0.1, 7, 0x2c9c5e);
      pb.inkId = null;
      for (const lf of sp.leaves) {
        const b = lf.box, cx = (b[0] + b[3]) / 2 - sp.pos[0], cz = (b[2] + b[5]) / 2 - sp.pos[2], r = (b[3] - b[0]) / 2;
        const y = b[1] - sp.pos[1];
        pb.cylinder(cx, y, cz, r * 0.82, r * 1.05, 0.18, 9, lf.top ? 0x6aec9e : 0x4cd486, { tint: [1.05, 0.8, 0.6] });
      }
      const plant = new THREE.Mesh(own(pb.build()), mat);
      plant.position.copy(budM.position);
      plant.castShadow = true; plant.receiveShadow = true;
      const sprout = new THREE.Group();
      sprout.add(budM, plant);
      group.add(sprout);
      const gh = G.add(sp.pos[0], sp.pos[1] + 0.3, sp.pos[2], LEAF, 2.2, 0.18);
      const sl = slot(sp.pos[0], sp.pos[2], 1);
      pool([sp.pos[0], sp.pos[1] + 0.6, sp.pos[2]], 1.6, LEAF, 0.5, sl);
      // a ring on the floor round a thirsty bud: "water me"
      outline(glowAt(sp.pos[0], sp.pos[2]), [sp.pos[0] - 0.5, sp.pos[1], sp.pos[2] - 0.5, sp.pos[0] + 0.5, 0, sp.pos[2] + 0.5], [0.36, 0.95, 0.56], 1, 0.06);
      views.push({
        at: [sp.pos[0], sp.pos[2]], obj: sprout,
        update(dt, alpha, t) {
          const g = lerp(sp.pgrowth, sp.growth, alpha);
          plant.visible = g > 0.001;
          const e = g < 1 ? 1 - Math.pow(1 - g, 3) : 1;
          plant.scale.set(0.2 + 0.8 * e, e, 0.2 + 0.8 * e);
          budM.visible = g < 0.5;
          budM.rotation.z = Math.sin(t * 2 + sp.pos[0]) * 0.12;
          budM.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
          gh.y = sp.pos[1] + 0.3 + sp.height * e; gh.alpha = sp.state === 0 ? 0.16 + 0.06 * Math.sin(t * 3) : 0.1;
          sl.set(sp.state === 0 ? 0.7 + 0.3 * Math.sin(t * 3) : 0.4);
        },
      });
    }
  }

  // ------------------------------------------------------------------ electrodes
  if (L.electrodes.length) {
    const lineMat = own(inkless(new THREE.LineBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false })));
    for (const el of L.electrodes) {
      const b = el.box, ax = el.axis === 'x';
      const cy = b[1], cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
      const a = ax ? [b[0], cz] : [cx, b[2]], c = ax ? [b[3], cz] : [cx, b[5]];
      const tips = [], decor = decorAt(cx, cz), glow = glowAt(cx, cz);
      for (const [px, pz] of [a, c]) {
        decor.cylinder(px, cy, pz, 0.16, 0.12, 0.42, 8, pal.woodDark);
        decor.cylinder(px, cy + 0.42, pz, 0.1, 0.1, 0.1, 8, pal.brass);
        glow.cylinder(px, cy + 0.52, pz, 0.07, 0.035, 0.1, 6, [0.75, 0.97, 1.0], { tint: [1, 1, 1] });
        tips.push(G.add(px, cy + 0.56, pz, CYAN, 1.6, 0.25, 0.3));
      }
      // a dashed line painted on the floor between the posts: "bridge this"
      const steps = Math.max(3, Math.round(Math.hypot(c[0] - a[0], c[1] - a[1]) / 0.35));
      for (let i = 1; i < steps; i += 2) {
        const u0 = i / steps, u1 = (i + 0.6) / steps;
        const x0 = lerp(a[0], c[0], u0), z0 = lerp(a[1], c[1], u0), x1 = lerp(a[0], c[0], u1), z1 = lerp(a[1], c[1], u1);
        glow.box(Math.min(x0, x1) - 0.04, cy + 0.005, Math.min(z0, z1) - 0.04, Math.max(x0, x1) + 0.04, cy + 0.02, Math.max(z0, z1) + 0.04, { color: mul(CYAN, 0.9), tint: [1, 1, 1] });
      }
      const N = 9;
      const pos = new Float32Array(N * 3);
      const lg = own(new THREE.BufferGeometry());
      lg.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(lg, lineMat);
      line.frustumCulled = false; line.visible = false;
      group.add(line);
      const sl = slot(cx, cz, 0.2);
      pool([cx, cy + 0.6, cz], 2.0, CYAN, 0.5, sl);
      let acc = 0;
      views.push({
        at: [cx, cz],
        update(dt) {
          line.visible = el.live;
          sl.set(el.live ? 0.9 + 0.3 * Math.sin(time.value * 40) : 0.15);
          for (const t of tips) { t.alpha = el.live ? 0.8 : 0.22; t.size = el.live ? 2.6 : 1.6; }
          if (!el.live) return;
          for (let i = 0; i < N; i++) {
            const u = i / (N - 1), j = (i === 0 || i === N - 1) ? 0 : 1;
            pos[i * 3] = lerp(a[0], c[0], u) + (P.rnd() - 0.5) * 0.12 * j;
            pos[i * 3 + 1] = cy + 0.56 - Math.sin(u * Math.PI) * 0.4 + (P.rnd() - 0.5) * 0.14 * j;
            pos[i * 3 + 2] = lerp(a[1], c[1], u) + (P.rnd() - 0.5) * 0.12 * j;
          }
          lg.attributes.position.needsUpdate = true;
          acc += dt * 14;
          while (acc > 1) { acc -= 1; const u = P.rnd(); P.spawn({ x: lerp(a[0], c[0], u), y: cy + 0.2, z: lerp(a[1], c[1], u), vx: (P.rnd() - 0.5) * 2, vy: 1 + P.rnd() * 2, vz: (P.rnd() - 0.5) * 2, life: 0.3, size: 0.07, color: [0.85, 1, 1], gravity: 6 }); }
        },
      });
    }
  }

  // ------------------------------------------------------------------ sensors (optional floor mark)
  for (const s of L.sensors) if (s.visible) outline(glowAt(...mid(s.box)), s.box, [0.72, 0.7, 1.0], 1);

  // ------------------------------------------------------------------ fans
  if (L.fans.length) {
    const rotorMat = own(toon({ vertexColors: true, ink: INK.prop(5) }));
    for (const f of L.fans) {
      const b = f.box, d = f.dir;
      const ext = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
      const axis = d[0] ? 0 : d[1] ? 1 : 2;
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const up = d[axis] > 0 ? b[axis] : b[axis + 3];           // upstream face coordinate
      const size = Math.min(3.4, ext[u], ext[v]);
      const hub = c.slice(); hub[axis] = up + d[axis] * 0.12;
      const decor = decorAt(hub[0], hub[2]);
      // housing: a square frame around the rotor, in the accent colour so a fan is never mistaken for a wall
      const fr = (du0, dv0, du1, dv1) => {
        const lo = [0, 0, 0], hi = [0, 0, 0];
        lo[axis] = up - 0.1 * d[axis]; hi[axis] = up + 0.3 * d[axis];
        lo[u] = hub[u] + du0; hi[u] = hub[u] + du1; lo[v] = hub[v] + dv0; hi[v] = hub[v] + dv1;
        decor.box(Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), Math.min(lo[2], hi[2]), Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), Math.max(lo[2], hi[2]), { color: pal.trim, tint: [1, 0.86, 0.7] });
      };
      const hs = size / 2, tk = 0.16;
      fr(-hs - tk, -hs - tk, hs + tk, -hs); fr(-hs - tk, hs, hs + tk, hs + tk); fr(-hs - tk, -hs, -hs, hs); fr(hs, -hs, hs + tk, hs);
      // rotor
      const rb = new GeoBuilder();
      rb.cylinder(0, -0.09, 0, 0.18, 0.18, 0.18, 8, pal.iron);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), r0 = 0.12, r1 = hs * 0.92, wv = 0.24;
        const p = (r, w, y) => [ca * r - sa * w, y, sa * r + ca * w];
        rb.quad(p(r0, -wv * 0.5, -0.03), p(r1, -wv, -0.06), p(r1, wv, 0.06), p(r0, wv * 0.5, 0.03), pal.bright);
        rb.quad(p(r0, wv * 0.5, 0.03), p(r1, wv, 0.06), p(r1, -wv, -0.06), p(r0, -wv * 0.5, -0.03), pal.steel);
      }
      const rotor = new THREE.Mesh(own(rb.build()), rotorMat);
      const pivot = new THREE.Group(); pivot.position.set(hub[0], hub[1], hub[2]);
      if (axis === 0) pivot.rotation.z = -Math.PI / 2 * d[0]; else if (axis === 2) pivot.rotation.x = Math.PI / 2 * d[2]; else if (d[1] < 0) pivot.rotation.x = Math.PI;
      pivot.add(rotor); group.add(pivot);
      // airflow: crossed ribbons of chevrons marching downstream through the whole column
      const sl = slot(c[0], c[2], f.active ? 1 : 0);
      const len = ext[axis];
      {
        const col = mul([0.92, 0.97, 1.0], 0.34 + 0.2 * dark), wU = ext[u] * 0.9, wV = ext[v] * 0.9;
        const P0 = (du, dv, along) => { const q = c.slice(); q[axis] = up + d[axis] * along; q[u] += du; q[v] += dv; return q; };
        const nU = [0, 0, 0]; nU[v] = 1; const nV = [0, 0, 0]; nV[u] = 1;
        sl.fx.quad(P0(-wU / 2, 0, 0), P0(wU / 2, 0, 0), P0(wU / 2, 0, len), P0(-wU / 2, 0, len), nU, col, FX.WIND, sl.i, len, f.strength, undefined, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        sl.fx.quad(P0(0, -wV / 2, 0), P0(0, wV / 2, 0), P0(0, wV / 2, len), P0(0, -wV / 2, len), nV, col, FX.WIND, sl.i, len, f.strength, undefined, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      let spin = f.active ? 1 : 0, acc = 0;
      const life = Math.min(1.6, len / f.strength);
      views.push({
        at: [c[0], c[2]], obj: pivot,
        update(dt) {
          spin += ((f.active ? 1 : 0) - spin) * Math.min(1, dt * 1.6);
          rotor.rotation.y += dt * (3 + f.strength * 2.2) * spin;
          sl.set(spin);
          if (spin < 0.3) return;
          acc += dt * Math.min(46, 5 + ext[u] * ext[v] * 2.4) * spin;
          while (acc > 1) {
            acc -= 1;
            const q = [0, 0, 0];
            q[axis] = up + d[axis] * P.rnd() * len * 0.5;
            q[u] = b[u] + P.rnd() * ext[u]; q[v] = b[v] + P.rnd() * ext[v];
            P.spawn({ x: q[0], y: q[1], z: q[2], vx: d[0] * f.strength, vy: d[1] * f.strength, vz: d[2] * f.strength, life: life * (0.5 + P.rnd() * 0.5), size: 0.07, color: [1, 1, 1], alpha: 0.85 });
          }
        },
      });
    }
  }

  // ------------------------------------------------------------------ zones (forced states)
  for (const z of L.zones) {
    const b = z.box, w = b[3] - b[0], h = b[4] - b[1], dp = b[5] - b[2], cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    const decor = decorAt(cx, cz), glow = glowAt(cx, cz);
    let acc = 0;
    if (z.type === 'heatvent') {
      decor.box(b[0], b[1], b[2], b[3], b[1] + 0.05, b[5], { color: pal.iron, tint: [1, 0.8, 0.5] });
      const n = Math.max(2, Math.round(w / 0.4));
      for (let i = 0; i < n; i++) { const x = b[0] + (i + 0.5) * w / n; glow.box(x - 0.08, b[1] + 0.05, b[2] + 0.15, x + 0.08, b[1] + 0.07, b[5] - 0.15, { color: [1.0, 0.5, 0.12], tint: [1, 1, 1] }); }
      outline(glow, b, [1.0, 0.45, 0.1], 1);
      const gh = G.add(cx, b[1] + 0.4, cz, EMBER, 4 + Math.max(w, dp), 0.4, 0.15);
      const sl = slot(cx, cz, 1);
      sl.fx.volume([b[0], b[1], b[2], b[3], b[1] + Math.min(h, 3.5), b[5]], mul(EMBER, 0.22), FX.HEAT, sl.i);
      pool([cx, b[1] + 0.8, cz], 2.2 + Math.max(w, dp) * 0.6, EMBER, 0.45, sl);
      const sh = shimmer(cx, b[1] + 0.6, cz, 1.2 + Math.max(w, dp) * 0.4, 1);
      views.push({
        at: [cx, cz],
        update(dt) {
          gh.alpha = z.active ? 0.4 : 0.05; sh.k = z.active ? 1 : 0;
          sl.set(sl.get() + ((z.active ? 1 : 0.05) - sl.get()) * Math.min(1, dt * 4));
          if (!z.active) return;
          acc += dt * Math.min(30, 6 + w * dp * 5);
          while (acc > 1) {
            acc -= 1;
            const hot = P.rnd() < 0.4;
            P.spawn({ x: b[0] + P.rnd() * w, y: b[1] + 0.1, z: b[2] + P.rnd() * dp, vx: (P.rnd() - 0.5) * 0.3, vy: 1.4 + P.rnd() * 1.6, vz: (P.rnd() - 0.5) * 0.3, life: Math.min(1.6, h / 2.2), size: hot ? 0.08 : 0.4, grow: hot ? 0 : 0.5, color: hot ? EMBER_HOT : [1, 0.86, 0.72], alpha: hot ? 1 : 0.2, drag: 0.3, solid: hot ? 0.4 : 0.9 });
          }
        },
      });
    } else if (z.type === 'frost' || z.type === 'cold') {
      const col = z.type === 'frost' ? FROST : COLD;
      outline(glow, b, z.type === 'frost' ? [0.7, 0.92, 1.0] : [0.72, 0.74, 1.0], 1);
      if (z.type === 'frost') {
        // icicle posts at the corners
        for (const [px, pz] of [[b[0], b[2]], [b[3], b[2]], [b[0], b[5]], [b[3], b[5]]]) glow.cylinder(px, b[1], pz, 0.1, 0.0, 0.75, 5, [0.8, 0.95, 1.0], { tint: [1, 0.86, 1] });
      }
      const gh = G.add(cx, b[1] + Math.min(h, 2) * 0.5, cz, col, 5 + Math.max(w, dp), 0.16);
      const sl = slot(cx, cz, 1);
      sl.fx.volume([b[0], b[1], b[2], b[3], b[1] + Math.min(h, 4), b[5]], mul(col, 0.2), FX.COLD, sl.i);
      pool([cx, b[1] + 1.2, cz], 2.2 + Math.max(w, dp) * 0.6, col, 0.35, sl);
      views.push({
        at: [cx, cz],
        update(dt) {
          gh.alpha = z.active ? 0.16 : 0.03;
          sl.set(sl.get() + ((z.active ? 1 : 0.05) - sl.get()) * Math.min(1, dt * 4));
          if (!z.active) return;
          acc += dt * Math.min(z.type === 'frost' ? 34 : 20, 4 + w * dp * (z.type === 'frost' ? 1.6 : 0.8));
          while (acc > 1) {
            acc -= 1;
            if (z.type === 'frost') P.spawn({ x: b[0] + P.rnd() * w, y: b[1] + Math.min(h, 3.2) * (0.5 + P.rnd() * 0.5), z: b[2] + P.rnd() * dp, vx: (P.rnd() - 0.5) * 0.3, vy: -0.7 - P.rnd() * 0.5, vz: (P.rnd() - 0.5) * 0.3, life: 1.6, size: 0.075, color: [1, 1, 1], alpha: 0.95, solid: 1 });
            else P.spawn({ x: b[0] + P.rnd() * w, y: b[1] + P.rnd() * Math.min(h, 4), z: b[2] + P.rnd() * dp, vx: (P.rnd() - 0.5) * 0.5, vy: -0.15, vz: (P.rnd() - 0.5) * 0.5, life: 2.0, size: 0.3, grow: 0.12, color: [0.8, 0.84, 1.0], alpha: 0.22, solid: 1 });
          }
        },
      });
    } else if (z.type === 'hotfloor') {
      const li = liquids.add(LIQ.hot, b[0], b[2], b[3], b[5], b[1] + 0.012);
      outline(glow, b, [1.0, 0.5, 0.1], 1);
      const gh = G.add(cx, b[1] + 0.3, cz, EMBER, 4 + Math.max(w, dp) * 0.8, 0.22, 0.1);
      const sl = slot(cx, cz, 1);
      sl.fx.volume([b[0], b[1], b[2], b[3], b[1] + 1.2, b[5]], mul(EMBER, 0.16), FX.HEAT, sl.i);
      pool([cx, b[1] + 1.0, cz], 2 + Math.max(w, dp) * 0.5, EMBER, 0.4, sl);
      views.push({
        at: [cx, cz],
        update(dt) {
          liquids.setOn(li, z.active ? 1 : 0);
          gh.alpha = z.active ? 0.22 : 0.02;
          sl.set(sl.get() + ((z.active ? 1 : 0.03) - sl.get()) * Math.min(1, dt * 4));
          if (!z.active) return;
          acc += dt * Math.min(16, 2 + w * dp * 0.7);
          while (acc > 1) { acc -= 1; P.spawn({ x: b[0] + P.rnd() * w, y: b[1] + 0.05, z: b[2] + P.rnd() * dp, vy: 0.5 + P.rnd() * 0.8, life: 1.0, size: 0.06, color: EMBER_HOT, drag: 0.5, solid: 0.4 }); }
        },
      });
    }
  }

  // ------------------------------------------------------------------ kiln fire
  // A molten floor with a wall of flame standing on it: the one thing in a Water level that must
  // never be missed, by day or in a pit far below a gap.
  L.fires.forEach((f) => {
    const b = f.box, w = b[3] - b[0], dp = b[5] - b[2], cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    const li = liquids.add(LIQ.fire, b[0], b[2], b[3], b[5], b[1] + 0.05);
    const gh = G.add(cx, b[1] + 0.8, cz, EMBER, 10 + Math.max(w, dp) * 2, 0.6, 0.2);
    const sl = slot(cx, cz, 1);
    pool([cx, b[1] + 1.4, cz], 3.5 + Math.max(w, dp) * 0.5, EMBER, 0.7, sl);
    sl.fx.crossed(cx, b[1], cz, Math.max(w, dp) * 0.9, 3.5, mul(EMBER, 0.12), FX.HAZE, sl.i);
    // flames in a staggered grid over the fire, capped so a long trench does not cost a hundred
    const nx = Math.max(1, Math.min(6, Math.round(w / 1.3))), nz = Math.max(1, Math.min(6, Math.round(dp / 1.3)));
    const stepK = Math.max(1, Math.ceil(nx * nz / 12));
    const fl = [];
    for (let i = 0, q = 0; i < nx; i++) for (let j = 0; j < nz; j++, q++) {
      if (q % stepK) continue;
      const fx0 = b[0] + (i + 0.5 + ((j % 2) - 0.5) * 0.4) * w / nx, fz0 = b[2] + (j + 0.5) * dp / nz;
      fl.push(F.add(fx0, b[1] + 0.02, fz0, 1.25 + (q % 3) * 0.2, 1.9 + (q % 4) * 0.4, q % 3 === 0 ? FLAME.hot : FLAME.fire, { minor: (q / stepK) % 2 === 1 }));
    }
    const sh = shimmer(cx, b[1] + 1.4, cz, 1.6 + Math.max(w, dp) * 0.35, 1);
    let acc = 0, k = 1;
    views.push({
      at: [cx, cz],
      update(dt, alpha, t) {
        k += ((f.active ? 1 : 0) - k) * Math.min(1, dt * 4);
        liquids.setOn(li, f.active ? 1 : 0);
        for (const q of fl) q.k = k;
        gh.alpha = 0.6 * k; sh.k = k;
        sl.set(Math.max(0.05, k) * (0.85 + 0.15 * Math.sin(t * 6 + cx)));
        if (!f.active) return;
        acc += dt * Math.min(30, 6 + w * dp * 2);
        while (acc > 1) {
          acc -= 1;
          P.spawn({ x: b[0] + P.rnd() * w, y: b[1] + 0.6 + P.rnd(), z: b[2] + P.rnd() * dp, vx: (P.rnd() - 0.5) * 0.8, vy: 1.8 + P.rnd() * 2.4, vz: (P.rnd() - 0.5) * 0.8, life: 0.8 + P.rnd() * 0.7, size: 0.07 + P.rnd() * 0.05, color: P.rnd() < 0.4 ? [1, 0.9, 0.4] : [1, 0.45, 0.1], drag: 0.5, solid: 0.5 });
        }
      },
    });
  });

  // ------------------------------------------------------------------ water currents
  if (L.currents.length) {
    const ids = L.currents.map((c) => {
      const b = c.box;
      pool([(b[0] + b[3]) / 2, b[4] + 0.8, (b[2] + b[5]) / 2], 1.5 + Math.max(b[3] - b[0], b[5] - b[2]) * 0.4, CYAN, 0.4);
      return liquids.add(LIQ.current, b[0], b[2], b[3], b[5], b[4] - 0.03, c.flow);
    });
    views.push({ update() { L.currents.forEach((c, i) => liquids.setOn(ids[i], c.active ? 1 : 0)); } });
  }

  // ------------------------------------------------------------------ checkpoints: lantern posts
  L.checkpoints.forEach((cp) => {
    const [x, y, z] = cp.pos, decor = decorAt(x, z);
    decor.cylinder(x, y, z, 0.5, 0.42, 0.12, 10, pal.iron, { caps: 'top' });
    decor.cylinder(x, y + 0.12, z, 0.34, 0.32, 0.06, 10, pal.trim, { caps: 'top' });
    decor.cylinder(x, y + 0.18, z, 0.075, 0.06, 0.9, 6, pal.steel, { caps: false });
    decor.cylinder(x, y + 1.06, z, 0.26, 0.26, 0.05, 8, pal.iron);
    decor.cylinder(x, y + 1.47, z, 0.07, 0.22, 0.09, 8, pal.iron, { caps: 'top' });
    const gh = G.add(x, y + 1.27, z, CYAN, 3.4, 0.05);
    const sl = slot(x, z, 0.1), beam = slot(x, z, 0);
    pool([x, y + 1.3, z], 3.2, CYAN, 0.55, sl);
    beam.fx.tube([x, y + 1.5, z], [0, 1, 0], 7, 0.32, 0.5, mul(CYAN, 0.35), FX.BEACON, beam.i, x);
    let k = 0;
    cp._burst = () => {
      P.burst(x, y + 1.2, z, 26, { speed: 3, life: 0.8, size: 0.14, color: CYAN, drag: 2, up: 1 });
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; P.spawn({ x: x + Math.cos(a) * 0.5, y: y + 0.1, z: z + Math.sin(a) * 0.5, vx: Math.cos(a) * 3, vy: 0.3, vz: Math.sin(a) * 3, life: 0.6, size: 0.11, color: CYAN, drag: 3 }); }
    };
    // the bulb: one lump among the level's bits - dull glass until lit, then the brightest cyan on the post
    bits.add((set, dt, t) => {
      k += ((cp.lit ? 1 : 0) - k) * Math.min(1, dt * 5);
      const cur = cp.current ? 1 : 0.7;
      set(x, y + 1.06 + (cp.current ? Math.sin(t * 2) * 0.03 : 0), z, 0.19, 0.21, 0.19, lerp(0.5, 0.42, k) * cur, lerp(0.56, 1.0, k) * cur, lerp(0.62, 1.0, k) * cur);
      gh.alpha = 0.06 + k * (0.45 + 0.08 * Math.sin(t * 3)) * cur;
      sl.set(0.12 + k * 0.9 * cur);
      // unlit posts still show a faint beam so they can be found from across the level
      beam.set(0.18 + k * (cp.current ? 0.9 : 0.35));
    }, [x, z]);
  });

  // ------------------------------------------------------------------ collectibles (one instanced draw)
  if (L.shards.length) {
    const look = ELEMENT_LOOK[sim.element.id] || ELEMENT_LOOK.water;
    const CREAM = look.glow || CREAM_W;
    const sg = own(look.geo());
    const mat = own(toon({ color: look.color, emissive: look.emissive, emissiveIntensity: 0.55, glaze: 1, ink: INK.prop(6) }));
    mat.flatShading = true;
    const inst = new THREE.InstancedMesh(sg, mat, L.shards.length);
    inst.frustumCulled = false;
    group.add(inst);
    const o = new THREE.Object3D();
    L.shards.forEach((sh, i) => {
      const gh = G.add(sh.pos[0], sh.pos[1], sh.pos[2], CREAM, 3.4, 0.4);
      const beam = slot(sh.pos[0], sh.pos[2], 1), pl = slot(sh.pos[0], sh.pos[2], 1);
      beam.fx.tube([sh.pos[0], sh.pos[1] - 0.2, sh.pos[2]], [0, 1, 0], 4.5, 0.12, 0.3, mul(CREAM, 0.3), FX.BEACON, beam.i, sh.pos[0] * 3);
      pool([sh.pos[0], sh.pos[1], sh.pos[2]], 1.6, CREAM, 0.5, pl);
      let acc = 0, gone = 0;
      views.push({
        update(dt, alpha, t) {
          if (sh.taken) gone = Math.min(1, gone + dt * 5);
          const vis = 1 - gone;
          beam.set(vis * (0.7 + 0.3 * Math.sin(t * 2.4 + i))); pl.set(vis);
          gh.alpha = vis * (0.36 + 0.12 * Math.sin(t * 4 + sh.pos[0]));
          const bob = Math.sin(t * 2 + sh.pos[0] * 1.3) * 0.1;
          const beckon = 1 + 0.12 * Math.max(0, Math.sin(t * 3.1 + i)) ** 6;   // a little "look at me" pulse
          o.position.set(sh.pos[0], sh.pos[1] + bob + gone * 0.6, sh.pos[2]);
          o.rotation.set(0, t * 1.6 + sh.pos[0], 0.3);
          o.scale.set(look.scale[0] * beckon * vis, look.scale[1] * beckon * vis, look.scale[2] * beckon * vis);
          o.updateMatrix();
          inst.setMatrixAt(i, o.matrix);
          inst.instanceMatrix.needsUpdate = true;
          gh.y = sh.pos[1] + bob;
          if (sh.taken) return;
          acc += dt * 4;
          if (acc > 1) {
            acc = 0;
            const a = P.rnd() * Math.PI * 2, r = 0.35 + P.rnd() * 0.25;
            P.spawn({ x: sh.pos[0] + Math.cos(a) * r, y: sh.pos[1] + (P.rnd() - 0.5) * 0.7, z: sh.pos[2] + Math.sin(a) * r, vy: 0.35, life: 0.8, size: 0.1, color: P.rnd() < 0.5 ? CREAM : look.spark });
          }
        },
      });
    });
  }

  // ------------------------------------------------------------------ the exit: a kiln door
  // Shut: a brick kiln with a slatted shutter and a band of orange chevrons. Open: the shutter is up
  // and a fire roars in the mouth - the goal of every level, and the biggest flame in it.
  for (const x of L.exits) {
    const f = x.face, fx0 = f === '+x' ? 1 : f === '-x' ? -1 : 0, fz = f === '+z' ? 1 : f === '-z' ? -1 : 0;
    const g2 = new THREE.Object3D();
    g2.position.set(x.pos[0], x.pos[1], x.pos[2]);
    g2.rotation.y = Math.atan2(fx0, fz);                    // local +z = the way the mouth faces
    g2.updateMatrix();
    // local frame: mouth plane at z = -0.75, body behind it, a stepped arch and a chimney stub
    const br = surfaceLayers(theme, 'brick');
    const kb = new GeoBuilder(), o = { top: br.top, side: br.side, tint: [1, 1, 0.72] };
    kb.box(-1.25, 0, -1.45, -0.75, 2.5, -0.72, o); kb.box(0.75, 0, -1.45, 1.25, 2.5, -0.72, o);
    kb.box(-0.75, 2.0, -1.45, 0.75, 2.5, -0.72, o); kb.box(-0.75, 0, -1.45, 0.75, 2.0, -1.28, o);
    kb.box(-1.35, 2.5, -1.5, 1.35, 2.74, -0.66, o);
    kb.box(-1.0, 2.74, -1.4, 1.0, 3.3, -0.8, o);
    kb.box(-0.4, 3.3, -1.25, 0.4, 4.6, -0.85, o);
    // arch trim in the accent colour
    const tr = { color: theme.trim, tint: [1, 0.86, 0.7] };
    kb.box(-0.86, 0, -0.78, -0.75, 2.05, -0.67, tr); kb.box(0.75, 0, -0.78, 0.86, 2.05, -0.67, tr); kb.box(-0.86, 2.0, -0.78, 0.86, 2.11, -0.67, tr);
    // the glowing mouth and the hot chimney lip (unlit paint)
    kb.glow.quad([-0.75, 0, -1.27], [0.75, 0, -1.27], [0.75, 2.0, -1.27], [-0.75, 2.0, -1.27], [1.0, 0.5, 0.1]);
    kb.glow.quad([-0.35, 4.61, -0.9], [0.35, 4.61, -0.9], [0.35, 4.61, -1.2], [-0.35, 4.61, -1.2], [1.0, 0.62, 0.16]);
    decorAt(x.pos[0], x.pos[2]).append(kb, g2.matrix);
    const bi = boxes.add(BOX.shutter);
    const sxw = fz !== 0 ? 1.5 : 0.12, szw = fz !== 0 ? 0.12 : 1.5;
    const scx = x.pos[0] - fx0 * 0.8, scz = x.pos[2] - fz * 0.8;
    const wx = x.pos[0] - fx0 * 0.9, wz = x.pos[2] - fz * 0.9;
    const mouth = [-0.38, 0, 0.38].map((s, i) => F.add(x.pos[0] - fx0 * 1.05 - fz * s, x.pos[1] + 0.02, x.pos[2] - fz * 1.05 + fx0 * s, 0.85, i === 1 ? 1.9 : 1.5, FLAME.hot, { k: 0, heart: 0.9, minor: i !== 1 }));
    const top = F.add(x.pos[0] - fx0 * 1.05, x.pos[1] + 4.6, x.pos[2] - fz * 1.05, 0.7, 1.3, FLAME.fire, { k: 0 });
    const gh = G.add(wx, x.pos[1] + 1.1, wz, EMBER, 9, 0.6, 0.12);
    const gh2 = G.add(x.pos[0] - fx0 * 1.05, x.pos[1] + 4.8, x.pos[2] - fz * 1.05, EMBER, 4, 0.3, 0.2);
    const poolS = slot(x.pos[0], x.pos[2], 0.3), beam = slot(x.pos[0], x.pos[2], 0.2);
    pool([x.pos[0] + fx0 * 0.6, x.pos[1] + 1.3, x.pos[2] + fz * 0.6], 5.5, EMBER, 0.9, poolS);
    beam.fx.tube([x.pos[0] - fx0 * 1.05, x.pos[1] + 4.6, x.pos[2] - fz * 1.05], [0, 1, 0], 14, 0.45, 1.1, mul(EMBER_HOT, 0.4), FX.BEACON, beam.i, 1.7);
    poolS.fx.crossed(wx + fx0 * 0.3, x.pos[1], wz + fz * 0.3, 1.8, 3.2, mul(EMBER, 0.1), FX.HAZE, poolS.i);
    const sh = shimmer(wx, x.pos[1] + 1.6, wz, 1.5, 0);
    let k = x.open ? 1 : 0, acc = 0, flare = 0;
    x._flare = () => { flare = 1; };
    views.push({
      update(dt, alpha, t) {
        k += ((x.open ? 1 : 0) - k) * Math.min(1, dt * 2.5);
        flare = Math.max(0, flare - dt * 0.6);
        if (k < 0.98) boxes.place(bi, scx, x.pos[1] + k * 2.05, scz, sxw, 2.0, szw); else boxes.hide(bi);
        boxes.state(bi, 0.35);
        const pulse = 0.85 + 0.15 * Math.sin(t * 3.1);
        for (const m of mouth) m.k = k * (1 + flare * 0.5);
        top.k = k * (0.8 + flare);
        gh.alpha = (0.12 + 0.5 * k) * pulse + flare * 0.6; gh.size = 9 + flare * 10;
        gh2.alpha = (0.1 + 0.3 * k) * pulse; sh.k = k;
        poolS.set((0.25 + 0.75 * k) * pulse + flare);
        beam.set(0.15 + 0.85 * k + flare);
        if (k < 0.5) return;
        acc += dt * (9 + flare * 40);
        while (acc > 1) {
          acc -= 1;
          const s = (P.rnd() - 0.5) * 1.3;
          P.spawn({ x: wx - fz * s, y: x.pos[1] + 0.2 + P.rnd() * 1.6, z: wz + fx0 * s, vx: fx0 * (0.4 + P.rnd()), vy: 0.8 + P.rnd() * 1.2, vz: fz * (0.4 + P.rnd()), life: 1 + P.rnd(), size: 0.08, color: EMBER_HOT, drag: 0.5, solid: 0.4 });
        }
      },
    });
  }

  // ------------------------------------------------------------------ props (decoration only)
  for (const pr of L.props) {
    const [x, y, z] = pr.pos, s = pr.scale;
    const decor = decorAt(x, z), glow = glowAt(x, z);
    if (pr.kind === 'lamp') {
      decor.inkId = INK.prop(decor.props++);
      decor.cylinder(x, y, z, 0.22 * s, 0.16 * s, 0.12 * s, 8, pal.iron, { caps: 'top' });
      decor.cylinder(x, y + 0.12 * s, z, 0.055 * s, 0.045 * s, 1.5 * s, 6, pal.steel, { caps: false });
      decor.box(x - 0.19 * s, y + 1.62 * s, z - 0.19 * s, x + 0.19 * s, y + 1.67 * s, z + 0.19 * s, { color: pal.iron });
      decor.cylinder(x, y + 2.0 * s, z, 0.22 * s, 0.03 * s, 0.14 * s, 6, pal.iron, { caps: 'top' });
      decor.inkId = null;
      glow.box(x - 0.13 * s, y + 1.67 * s, z - 0.13 * s, x + 0.13 * s, y + 2.0 * s, z + 0.13 * s, { color: [1.0, 0.86, 0.5], tint: [1, 1, 1] });
      G.add(x, y + 1.85 * s, z, lamp, 5.5 * s, 0.5, 0.06);
      // the warm pool the lantern throws on the floor and walls around it
      pool([x, y + 1.85 * s, z], 5.4 * s, lamp, 1.5);
    } else if (pr.kind === 'pots') {
      const vase = [[0.0, 0], [0.16, 0], [0.25, 0.12], [0.27, 0.3], [0.2, 0.48], [0.1, 0.58], [0.12, 0.68], [0.14, 0.7]];
      const bowl = [[0.0, 0], [0.12, 0], [0.26, 0.1], [0.32, 0.24], [0.3, 0.27]];
      decor.lathe(x, y, z, vase, 9, pal.potB, s * 1.15);
      decor.lathe(x + 0.62 * s, y, z + 0.25 * s, vase, 9, pal.potC, s * 0.8);
      decor.lathe(x - 0.2 * s, y, z + 0.62 * s, bowl, 9, pal.potA, s);
      decor.lathe(x + 0.45 * s, y, z - 0.5 * s, bowl, 9, pal.dome, s * 0.75);
    } else if (pr.kind === 'kiln') {
      const a = pr.rot * Math.PI / 180, fxk = Math.sin(a), fzk = Math.cos(a);
      const dome = [[1.05, 0], [1.1, 0.5], [1.0, 1.0], [0.78, 1.45], [0.45, 1.75], [0.24, 1.86], [0.22, 2.5], [0.27, 2.55]];
      const id = INK.prop(decor.props++);
      decor.lathe(x, y, z, dome, 14, pal.dome, s, id);
      decor.cylinder(x, y, z, 1.18 * s, 1.18 * s, 0.14 * s, 14, pal.domeDark, { ink: id });
      // iron hoops round the dome
      decor.cylinder(x, y + 0.5 * s, z, 1.13 * s, 1.13 * s, 0.07 * s, 14, pal.iron);
      decor.cylinder(x, y + 1.0 * s, z, 1.03 * s, 1.03 * s, 0.07 * s, 14, pal.iron);
      // glowing mouth on the facing side
      const mx = x + fxk * 1.07 * s, mz = z + fzk * 1.07 * s, hw = 0.36 * s;
      const px = fzk, pz = -fxk; // sideways
      glow.quad([mx - px * hw, y + 0.16 * s, mz - pz * hw], [mx + px * hw, y + 0.16 * s, mz + pz * hw], [mx + px * hw, y + 0.82 * s, mz + pz * hw], [mx - px * hw, y + 0.82 * s, mz - pz * hw], [1.0, 0.56, 0.14]);
      glow.quad([mx + px * hw, y + 0.16 * s, mz + pz * hw], [mx - px * hw, y + 0.16 * s, mz - pz * hw], [mx - px * hw, y + 0.82 * s, mz - pz * hw], [mx + px * hw, y + 0.82 * s, mz + pz * hw], [1.0, 0.56, 0.14]);
      F.add(mx + fxk * 0.06, y + 0.16 * s, mz + fzk * 0.06, 0.6 * s, 0.75 * s, FLAME.fire, { minor: true });
      G.add(mx + fxk * 0.2, y + 0.5 * s, mz + fzk * 0.2, EMBER, 6 * s, 0.55, 0.14);
      const sl = slot(x, z, 1);
      pool([mx + fxk * 0.6, y + 0.7 * s, mz + fzk * 0.6], 4.2 * s, EMBER, 0.75, sl);
      if (theme.backdrop === 'kiln') sl.fx.crossed(x, y + 2.4 * s, z, 1.2 * s, 3 * s, mul(EMBER, 0.08), FX.HAZE, sl.i);
      views.push({ at: [x, z], update(dt, alpha, t) { sl.set(0.88 + 0.12 * Math.sin(t * 5.3 + x) * Math.sin(t * 2.1)); } });
    } else if (pr.kind === 'pipe') {
      const a = pr.rot * Math.PI / 180, len = 3 * s, dx = Math.cos(a) * len / 2, dz = Math.sin(a) * len / 2;
      decor.box(Math.min(x - dx, x + dx) - 0.15, y + 0.3, Math.min(z - dz, z + dz) - 0.15, Math.max(x - dx, x + dx) + 0.15, y + 0.6, Math.max(z - dz, z + dz) + 0.15, { color: pal.steel, tint: [1.1, 0.86, 0.6] });
      decor.box(x - 0.21, y, z - 0.21, x + 0.21, y + 0.3, z + 0.21, { color: pal.iron });
    } else if (pr.kind === 'shelf') {
      const a = pr.rot * Math.PI / 180, alongX = Math.abs(Math.cos(a)) > 0.5, hl = 1.1 * s, hd = 0.28 * s;
      const ex = alongX ? hl : hd, ez = alongX ? hd : hl;
      for (const sy of [0.5, 1.1, 1.7]) decor.box(x - ex, y + sy * s, z - ez, x + ex, y + (sy + 0.07) * s, z + ez, { color: pal.wood });
      for (const k of [-1, 1]) decor.box(x + (alongX ? k * (hl - 0.05) : -hd) - (alongX ? 0.05 : 0), y, z + (alongX ? -hd : k * (hl - 0.05)) - (alongX ? 0 : 0.05), x + (alongX ? k * (hl - 0.05) : hd) + (alongX ? 0.05 : 0), y + 1.8 * s, z + (alongX ? hd : k * (hl - 0.05)) + (alongX ? 0 : 0.05), { color: pal.woodDark });
      const cup = [[0.0, 0], [0.08, 0], [0.13, 0.1], [0.12, 0.2]];
      for (let i = 0; i < 6; i++) {
        const t = (i % 3 - 1) * 0.6 * hl, sy = i < 3 ? 0.57 : 1.17;
        decor.lathe(x + (alongX ? t : 0), y + sy * s, z + (alongX ? 0 : t), cup, 7, i % 3 === 0 ? pal.potA : i % 3 === 1 ? pal.potC : pal.potB, s);
      }
    } else if (pr.kind === 'chimney') {
      const id = INK.prop(decor.props++);
      decor.cylinder(x, y, z, 0.7 * s, 0.5 * s, 6 * s, 8, pal.dome, { ink: id });
      decor.cylinder(x, y + 6 * s, z, 0.58 * s, 0.58 * s, 0.25 * s, 8, pal.domeDark, { ink: id });
      G.add(x, y + 6.4 * s, z, EMBER, 5 * s, 0.25, 0.2);
    }
  }

  // ------------------------------------------------------------------ theme dressing
  const B = L.bounds;
  if (theme.backdrop === 'loft' && ctx.sunDir && dark < 0.5) {
    // sun shafts slanting down through the roof onto the level
    const md = ctx.sunDir, alongX = (B.x1 - B.x0) >= (B.z1 - B.z0);
    const len = alongX ? B.x1 - B.x0 : B.z1 - B.z0, n = Math.max(2, Math.round(len / 15));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, side = (i % 2 ? 0.25 : -0.2);
      const fxp = alongX ? lerp(B.x0, B.x1, t) : lerp(B.x0, B.x1, 0.5 + side), fzp = alongX ? lerp(B.z0, B.z1, 0.5 + side) : lerp(B.z0, B.z1, t);
      // find the floor under that point
      const top = sim.raycast(fxp, B.y1 + 20, fzp, 0, -1, 0, 60, solidBlock);
      const fy = B.y1 + 20 - top;
      const lenS = 22;
      const base = [fxp + md.x * lenS, fy + md.y * lenS, fzp + md.z * lenS];
      fxAt(fxp, fzp).tube(base, [-md.x, -md.y, -md.z], lenS + 0.5, 1.0, 1.5, [0.32, 0.29, 0.18], FX.SHAFT, 0, 0, 8);
    }
  }

  // ------------------------------------------------------------------ element-only pieces
  const handlers = [];
  for (const add of PACK_VIEWS) add({ sim, L, T, theme, pal, P, G, F, pool, slot, decorAt, glowAt, fxAt, group, views, own, handlers, outline, blocks, boxes, bits, liquids, LIQ, time, shimmer });

  // ------------------------------------------------------------------ build the meshes
  const surfMat = surfaceMaterial(theme), surfFade = surfaceMaterial(theme, true);
  const outlined = [];
  for (const c of chunks) {
    const bb = new THREE.Box3();
    if (!c.stat.empty) {
      const m = new THREE.Mesh(own(c.stat.build()), surfMat);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m); c.meshes.push(m); fadeSwap.push({ mesh: m, plain: surfMat, fade: surfFade }); outlined.push(m);
      bb.union(m.geometry.boundingBox);
    }
    if (!c.fx.empty) {
      const m = c.fx.build([theme.fogNear, theme.fogFar], 1 - dark);
      own(m.geometry); own(m.material);
      m.geometry.computeBoundingBox();
      group.add(m); c.meshes.push(m); c.fxMesh = m;
      bb.union(m.geometry.boundingBox);
    }
    c.box = bb.isEmpty() ? null : { x0: bb.min.x, z0: bb.min.z, x1: bb.max.x, z1: bb.max.z };
  }
  boxes.mesh.count = boxes.n;
  if (boxes.n) { group.add(boxes.mesh); fadeSwap.push({ mesh: boxes.mesh, plain: boxes.plain, fade: boxes.fade }); outlined.push(boxes.mesh); }
  const bitMesh = bits.build();
  if (bitMesh) group.add(bitMesh);
  const liqMesh = liquids.build(theme);
  if (liqMesh) group.add(liqMesh);

  const cullR = theme.fogFar + 2, viewR2 = (theme.fogFar * 0.8) * (theme.fogFar * 0.8);
  let fading = false, drawn = chunks.length;
  return {
    group, shimmers, outlined,
    chunkCount: chunks.length,
    get chunksDrawn() { return drawn; },
    /** Every mesh that has a cut-away material variant: [{ mesh, plain, fade }]. */
    fadeVariants: fadeSwap,
    /** Swap the wall-drawing meshes to their cut-away materials (true) or back to the plain ones (false). */
    setFade(on) {
      if (on === fading) return;
      fading = on;
      for (const s of fadeSwap) s.mesh.material = on ? s.fade : s.plain;
    },
    /** Quality: how much of the baked light to draw (0 essentials, 1 + pools and contact shades, 2 everything). */
    setTier(fx) { for (const c of chunks) if (c.fxMesh) c.fxMesh.geometry.setDrawRange(0, c.fxMesh.userData.fxRanges[fx]); },
    /**
     * (cx, cz): where the camera is looking - mechanisms far from it are not animated.
     * (ex, ez): where the camera is - areas further from it than the haze reaches are not drawn.
     */
    update(dt, alpha, t, cx = 0, cz = 0, ex = cx, ez = cz) {
      time.value = t;
      drawn = 0;
      for (const c of chunks) {
        const vis = !c.box || distToRect(c.box, ex, ez) < cullR;
        if (vis) drawn++;
        if (vis !== c.vis) { c.vis = vis; for (const m of c.meshes) m.visible = vis; }
      }
      for (let i = 0; i < views.length; i++) {
        const v = views[i];
        // a mechanism far from the action is neither animated nor (if it has a mesh of its own) drawn
        if (v.at && (v.at[0] - cx) * (v.at[0] - cx) + (v.at[1] - cz) * (v.at[1] - cz) > viewR2) { if (v.obj && v.obj.visible) v.obj.visible = false; continue; }
        if (v.obj && !v.obj.visible) v.obj.visible = true;
        v.update(dt, alpha, t);
      }
      bits.update(dt, t, alpha, cx, cz, viewR2);
      for (const c of chunks) if (c.fxMesh && c.vis) c.fxMesh.material.uniforms.uTime.value = t;
      if (liquids.mat) liquids.mat.uniforms.uTime.value = t;
    },
    onEvent(e) {
      for (let i = 0; i < handlers.length; i++) handlers[i](e);
      const CREAM = (ELEMENT_LOOK[sim.element.id] || ELEMENT_LOOK.water).glow || CREAM_W;
      if (e.type === 'burst') {
        if (e.kind === 'pane') {
          P.burst(e.x, e.y, e.z, 46, { speed: 6, life: 0.9, size: 0.15, color: [0.85, 0.97, 1], gravity: 10, spread: 1.6, up: 1, solid: 0.9 });
          P.burst(e.x, e.y, e.z, 12, { speed: 2, life: 0.4, size: 0.35, color: [1, 1, 1], drag: 4 });
        } else if (e.kind === 'douse') {
          for (let i = 0; i < 16; i++) P.spawn({ x: e.x + (P.rnd() - 0.5), y: e.y + P.rnd() * 0.5, z: e.z + (P.rnd() - 0.5), vy: 1 + P.rnd() * 1.5, life: 1.2, size: 0.6, grow: 0.6, color: [0.96, 0.97, 1.0], alpha: 0.6, drag: 0.8, solid: 1 });
        } else if (e.kind === 'sprout') {
          P.burst(e.x, e.y + 0.3, e.z, 18, { speed: 2.2, life: 0.8, size: 0.11, color: LEAF, up: 2, gravity: 3, solid: 0.9 });
        }
      } else if (e.type === 'shard') {
        P.burst(e.x, e.y, e.z, 30, { speed: 3.6, life: 0.8, size: 0.14, color: CREAM, drag: 2.5 });
        P.burst(e.x, e.y, e.z, 12, { speed: 1.4, life: 1.0, size: 0.22, color: CYAN, drag: 2 });
        P.burst(e.x, e.y, e.z, 8, { speed: 0.5, life: 0.5, size: 0.6, color: CREAM, drag: 3, alpha: 0.6 });
      } else if (e.type === 'checkpoint') {
        const cp = L.pieces[e.index]; if (cp && cp._burst) cp._burst();
      } else if (e.type === 'complete') {
        P.burst(e.x, e.y + 0.5, e.z, 60, { speed: 4.5, life: 1.4, size: 0.16, color: EMBER_HOT, drag: 1.5, up: 2.5 });
        P.burst(e.x, e.y + 0.5, e.z, 30, { speed: 3, life: 1.2, size: 0.18, color: CYAN, drag: 1.5, up: 2 });
        P.burst(e.x, e.y + 0.5, e.z, 24, { speed: 2.2, life: 1.6, size: 0.15, color: CREAM, drag: 1.2, up: 3, gravity: -0.5 });
        for (const x of L.exits) if (x._flare) x._flare();
      }
    },
    dispose() {
      for (const d of disposables) if (d && d.dispose) d.dispose();
      boxes.dispose(); bits.dispose(); liquids.dispose();
    },
  };
}
