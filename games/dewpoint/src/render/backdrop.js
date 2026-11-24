// The world beyond the playable pieces: a big painted sky (stepped bands of colour, flat cel
// clouds with a shaded side, a sun or a moon with drawn halo rings, crisp stars), the floor far
// below (painted swirls: mist, a furnace bed, the night) and a skyline of the works around the level -
//   works: bottle kilns, chimneys and saw-tooth sheds, their windows lit when it is dark
//   loft:  roof trusses overhead against the sky, gable walls with tall windows, racks of ware
//   kiln:  a ring of brick wall with fire-mouths at its foot, stacks of saggars
// in flat colour that pales toward the horizon (aerial perspective is painted in, not fogged: the
// level's haze ends long before the skyline does). The ink pass thins its lines to nothing over
// that distance, so the skyline reads as background paint and the level as foreground drawing.
// The skyline is cut into a few sector meshes so the half behind the camera is never drawn:
// sky 1 + floor 1 + two or three sectors in view.

import * as THREE from '../../vendor/three.module.min.js';
import { GeoBuilder, inkless, INK } from './geo.js';
import { abyssFor } from './textures.js';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uTop, uMid, uHorizon, uGlow, uSunCol, uCloud, uCloudShade, uMoonCol, uHaze, uSunDir;
  uniform float uStars, uTime, uSunSize, uMoonSize, uClouds;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // the sky in painted bands: a smooth ramp, stepped, with soft edges that undulate a little
    float t = clamp(h, 0.0, 1.0);
    float tt = t + 0.012 * sin(d.x * 5.0 + d.z * 3.0) + 0.008 * sin(d.z * 9.0 - d.x * 4.0);
    float st = (floor(tt * 9.0) + smoothstep(0.4, 0.6, fract(tt * 9.0))) / 9.0;
    st = mix(tt, st, 0.7);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.3, st));
    col = mix(col, uTop, smoothstep(0.26, 0.9, st));
    float sd = dot(d, uSunDir);
    // stars: one per lucky cell, crisp, twinkling, out of the haze
    if (uStars > 0.0) {
      vec3 p = d * 120.0;
      float r = hash3(floor(p));
      float star = step(0.988, r) * (1.0 - smoothstep(0.12, 0.3, length(fract(p) - 0.5)));
      star *= (0.6 + 0.4 * sin(uTime * (1.5 + r * 3.0) + r * 60.0)) * smoothstep(0.1, 0.4, h);
      col += vec3(1.0, 0.97, 0.86) * star * uStars;
    }
    // the sun: a flat disc and two drawn halo rings
    if (uSunSize > 0.0) {
      float a = acos(clamp(sd, -1.0, 1.0));
      col = mix(col, uGlow, 0.22 * (1.0 - smoothstep(uSunSize * 5.0, uSunSize * 5.2, a)));
      col = mix(col, uGlow, 0.4 * (1.0 - smoothstep(uSunSize * 2.4, uSunSize * 2.52, a)));
      col = mix(col, uSunCol, 1.0 - smoothstep(uSunSize, uSunSize * 1.05, a));
    }
    // the moon: a disc with a bite out of it, and one ring
    if (uMoonSize > 0.0) {
      float a = acos(clamp(sd, -1.0, 1.0));
      vec3 side = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
      float bite = acos(clamp(dot(d, normalize(uSunDir + side * uMoonSize * 0.55 + vec3(0.0, uMoonSize * 0.3, 0.0))), -1.0, 1.0));
      col = mix(col, uGlow, 0.16 * (1.0 - smoothstep(uMoonSize * 2.6, uMoonSize * 2.75, a)));
      col = mix(col, uMoonCol, (1.0 - smoothstep(uMoonSize, uMoonSize * 1.06, a)) * smoothstep(uMoonSize * 0.86, uMoonSize * 0.92, bite));
    }
    // clouds: flat shapes on a plane overhead (so they bunch toward the horizon), lit on the side toward the light
    if (uClouds > 0.0 && h > 0.015) {
      vec2 uv = d.xz / (h + 0.2) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
      float n = vnoise(uv) * 0.64 + vnoise(uv * 2.3 + 7.1) * 0.36;
      float th = mix(0.76, 0.5, uClouds);
      float m = smoothstep(th, th + 0.025, n) * smoothstep(0.015, 0.11, h);
      if (m > 0.001) {
        vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.16;
        float n2 = vnoise(uv + toSun) * 0.64 + vnoise((uv + toSun) * 2.3 + 7.1) * 0.36;
        vec3 cc = mix(uCloudShade, uCloud, smoothstep(-0.02, 0.02, n - n2 + 0.05));
        cc = mix(cc, uHaze, (1.0 - smoothstep(0.0, 0.3, h)) * 0.55);     // paler toward the horizon
        col = mix(col, cc, m);
      }
    }
    // the haze the level's own distance fades into: horizon and everything below it
    col = mix(uHaze, col, smoothstep(-0.02, 0.1, h));
    gl_FragColor = vec4(col, ${INK.sky.toFixed(5)});
    #include <colorspace_fragment>
  }`;

const C = (v) => new THREE.Color(v);
const lin = (v) => { const c = new THREE.Color(v); return [c.r, c.g, c.b]; };

/**
 * @param {object} bounds level bounds
 * @param {object} theme  from themes.js
 * @param {THREE.Vector3} sunDir direction toward the sun or moon (the key light's direction)
 */
export function buildBackdrop(bounds, theme, sunDir) {
  const group = new THREE.Group();
  const disposables = [];
  const sk = theme.sky;

  // ---------------------------------------------------------------- sky
  const skyGeo = new THREE.SphereGeometry(380, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: C(sk.top) }, uMid: { value: C(sk.mid) }, uHorizon: { value: C(sk.horizon) }, uGlow: { value: C(sk.glow) },
      uSunCol: { value: C(sk.sun) }, uCloud: { value: C(sk.cloud) }, uCloudShade: { value: C(sk.cloudShade) }, uMoonCol: { value: C(sk.moonCol || '#ffffff') },
      uHaze: { value: C(theme.fog) }, uSunDir: { value: sunDir.clone().normalize() },
      uStars: { value: sk.stars }, uTime: { value: 0 }, uSunSize: { value: sk.sunSize || 0 }, uMoonSize: { value: sk.moon || 0 }, uClouds: { value: sk.clouds || 0 },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  // Drawn AFTER the opaque world (depth-tested against it), so the sky shader only runs on pixels
  // that really show sky instead of shading the whole screen and being painted over.
  sky.renderOrder = 50; sky.frustumCulled = false;
  group.add(sky);
  disposables.push(skyGeo, skyMat);

  const cx = (bounds.x0 + bounds.x1) / 2, cz = (bounds.z0 + bounds.z1) / 2;
  const sx = bounds.x1 - bounds.x0, sz = bounds.z1 - bounds.z0;
  const span = Math.max(sx, sz);

  // ---------------------------------------------------------------- the floor far below
  const at = abyssFor(theme).clone(); at.needsUpdate = true; at.repeat.set((span + 420) / 26, (span + 420) / 26);
  const abyssMat = inkless(new THREE.MeshBasicMaterial({ map: at, fog: true, toneMapped: false }), INK.prop(2));
  const abyssGeo = new THREE.PlaneGeometry(span + 420, span + 420).rotateX(-Math.PI / 2);
  const abyss = new THREE.Mesh(abyssGeo, abyssMat);
  abyss.position.set(cx, bounds.y0 - 16, cz);
  abyss.renderOrder = 42;
  group.add(abyss);
  disposables.push(abyssGeo, abyssMat, at);

  // ---------------------------------------------------------------- the skyline, in sectors
  const alongX = sx >= sz;
  const NS = Math.max(2, Math.min(5, Math.round(span / 55)));
  const sectors = Array.from({ length: NS }, () => new GeoBuilder());
  const sectorOf = (x, z) => sectors[Math.max(0, Math.min(NS - 1, Math.floor(((alongX ? x - bounds.x0 : z - bounds.z0) / Math.max(1, span)) * NS)))];
  let dark = sectors[0], lit = sectors[0].glow;
  const pick = (x, z) => { dark = sectorOf(x, z); lit = dark.glow; };
  let seed = Math.floor(Math.abs(bounds.x1 * 13.7 + bounds.z1 * 7.3 + bounds.y1 * 3.1)) + 17;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const base = bounds.y0 - 16;
  const nearC = lin(theme.silhouette), farC = lin(theme.silhouetteFar);
  // flat colour: its own near, paling toward the horizon colour with distance; `k` shades a face
  const sil = (dist, k = 1) => {
    const t = Math.min(1, Math.max(0, (dist - 20) / 90));
    return [(nearC[0] + (farC[0] - nearC[0]) * t) * k, (nearC[1] + (farC[1] - nearC[1]) * t) * k, (nearC[2] + (farC[2] - nearC[2]) * t) * k];
  };
  const win = theme.window, night = theme.dark;
  // windows: lit at night, pale panes that catch the sky by day
  const glowCol = (k) => (night > 0.3 ? [win[0] * k * 1.6, win[1] * k * 1.6, win[2] * k * 1.6] : [0.55 + win[0] * 0.4 * k, 0.6 + win[1] * 0.35 * k, 0.66 + win[2] * 0.3 * k]);
  const fireCol = [1.0, 0.46, 0.1];
  const per = 2 * (sx + sz) + 240;
  const ringPos = (a, dist) => [cx + Math.cos(a) * (dist + sx * 0.5 * Math.abs(Math.cos(a))), cz + Math.sin(a) * (dist + sz * 0.5 * Math.abs(Math.sin(a)))];
  const T1 = [1, 1, 1];

  // shapes ------------------------------------------------------------
  const bottleKiln = (x, z, s, dist, y0 = base) => {
    pick(x, z);
    const c = sil(dist);
    const prof = [[1.0, 0], [1.02, 0.3], [0.9, 0.8], [0.6, 1.2], [0.38, 1.6], [0.44, 1.76]];
    const h0 = Math.max(0, (bounds.y0 - y0) + 3);
    const id = INK.prop(dark.props++);
    dark.box(x - s * 1.2, y0, z - s * 1.2, x + s * 1.2, y0 + h0, z + s * 1.2, { color: c, tint: [1.08, 0.9, 0.8], ink: id });
    const yb = y0 + h0;
    for (let i = 0; i < prof.length - 1; i++) {
      const [ra, ya] = prof[i], [rb, yb2] = prof[i + 1];
      dark.cylinder(x, yb + ya * s * 2, z, ra * s, rb * s, (yb2 - ya) * s * 2, 8, c, { tint: [1.12, i % 2 ? 0.94 : 1, 0.8], caps: i === prof.length - 2 ? 'top' : false, ink: id });
    }
    // a band of trim and three fire-mouth arches at the foot, facing the level
    const ma = Math.atan2(cz - z, cx - x);
    for (const off of [-0.5, 0, 0.5]) {
      const a = ma + off, mx = x + Math.cos(a) * s * 1.03, mz = z + Math.sin(a) * s * 1.03, px = -Math.sin(a) * 0.2 * s, pz = Math.cos(a) * 0.2 * s;
      lit.quad([mx - px, yb + 0.05 * s, mz - pz], [mx + px, yb + 0.05 * s, mz + pz], [mx + px, yb + 0.46 * s, mz + pz], [mx - px, yb + 0.46 * s, mz - pz], fireCol);
    }
  };
  const chimney = (x, z, r, h, dist) => {
    pick(x, z);
    const c = sil(dist), id = INK.prop(dark.props++);
    dark.cylinder(x, base, z, r * 1.35, r, h, 7, c, { tint: T1, ink: id, caps: false });
    dark.cylinder(x, base + h * 0.86, z, r * 1.16, r * 1.16, h * 0.03, 7, sil(dist, 1.18), { tint: T1, ink: id });
    dark.cylinder(x, base + h, z, r * 1.1, r * 1.1, 0.6, 7, sil(dist, 0.82), { tint: T1, ink: id });
  };
  const shed = (x, z, a, len, depth, h, dist, teeth = 4) => {
    // saw-tooth roofed workshop, long axis along angle a, windows facing the level
    pick(x, z);
    const c = sil(dist), roof = sil(dist, 0.8), ca = Math.cos(a), sa = Math.sin(a), id = INK.prop(dark.props++);
    const P = (u, y, v) => [x + ca * u - sa * v, y, z + sa * u + ca * v];
    const facing = (Math.cos(a + Math.PI / 2) * (cx - x) + Math.sin(a + Math.PI / 2) * (cz - z)) > 0 ? 1 : -1;
    const v = facing * depth / 2;
    const si = [0, id, 0];
    // only the wall that faces the level and the two gable ends are ever seen
    dark.quad(P(-len / 2, base, v), P(len / 2, base, v), P(len / 2, base + h, v), P(-len / 2, base + h, v), c, null, null, si);
    dark.quad(P(len / 2, base, v), P(-len / 2, base, v), P(-len / 2, base + h, v), P(len / 2, base + h, v), c, null, null, si);
    for (const u of [-len / 2, len / 2]) {
      dark.quad(P(u, base, -depth / 2), P(u, base, depth / 2), P(u, base + h, depth / 2), P(u, base + h, -depth / 2), sil(dist, 0.9), null, null, si);
      dark.quad(P(u, base, depth / 2), P(u, base, -depth / 2), P(u, base + h, -depth / 2), P(u, base + h, depth / 2), sil(dist, 0.9), null, null, si);
    }
    const tw = len / teeth;
    for (let i = 0; i < teeth; i++) {
      const u0 = -len / 2 + i * tw, u1 = u0 + tw, yt = base + h, ytop = yt + tw * 0.55;
      dark.tri(P(u0, yt, v), P(u1, yt, v), P(u1, ytop, v), c, null, si); dark.tri(P(u1, yt, v), P(u0, yt, v), P(u1, ytop, v), c, null, si);
      const sl = [P(u0, yt, -depth / 2), P(u0, yt, depth / 2), P(u1, ytop, depth / 2), P(u1, ytop, -depth / 2)];
      dark.quad(sl[0], sl[1], sl[2], sl[3], roof, null, null, si); dark.quad(sl[1], sl[0], sl[3], sl[2], roof, null, null, si);
    }
    // a row of tall windows on the side that faces the level
    const vw = v + facing * 0.06;
    const nW = Math.max(3, Math.round(len / 4.5));
    const wh = Math.min(2.6, h * 0.12);
    for (let i = 0; i < nW; i++) {
      if (rnd() < 0.3) continue;
      const u = -len / 2 + (i + 0.5) * len / nW, yw = base + h * 0.62;
      const g = glowCol(0.5 + rnd() * 0.5);
      const q = [P(u - 0.62, yw, vw), P(u + 0.62, yw, vw), P(u + 0.62, yw + wh, vw), P(u - 0.62, yw + wh, vw)];
      if (facing > 0) lit.quad(q[1], q[0], q[3], q[2], g); else lit.quad(q[0], q[1], q[2], q[3], g);
      lit.quad(q[0], q[1], q[2], q[3], g); lit.quad(q[1], q[0], q[3], q[2], g);
    }
  };

  if (theme.backdrop === 'kiln') {
    // inside the great kiln: a curved brick wall all round, fire-mouths at its foot, saggar stacks
    const R = span * 0.5 + 34, H = 46, seg = Math.max(28, Math.min(64, Math.round(per / 16)));
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = [cx + Math.cos(a0) * R * 1.15, cz + Math.sin(a0) * R], p1 = [cx + Math.cos(a1) * R * 1.15, cz + Math.sin(a1) * R];
      pick(cx + Math.cos(am) * R * 1.15, cz + Math.sin(am) * R);
      const c = sil(70, i % 2 ? 1 : 0.94), cTop = sil(70, 1.16), warm = [Math.min(1, c[0] * 1.5 + 0.12), c[1] * 1.05, c[2] * 0.8];
      const si = [0, INK.prop(2), 0];
      // the wall in two bands: warmer near the fire-mouths at its foot, a paler coping at the top
      const yA = base, yB = bounds.y0 + 4, yC = base + H;
      dark.quad([p1[0], yA, p1[1]], [p0[0], yA, p0[1]], [p0[0], yB, p0[1]], [p1[0], yB, p1[1]], c, null, [warm, warm, c, c], si);
      dark.quad([p1[0], yB, p1[1]], [p0[0], yB, p0[1]], [p0[0], yC, p0[1]], [p1[0], yC, p1[1]], c, null, null, si);
      dark.quad([p1[0], yC, p1[1]], [p0[0], yC, p0[1]], [p0[0], yC + 2.4, p0[1]], [p1[0], yC + 2.4, p1[1]], cTop, null, null, si);
      if (i % 3 === 0) {
        // a glowing fire-mouth arch down at the kiln's floor
        const mx = cx + Math.cos(am) * R * 1.15 * 0.992, mz = cz + Math.sin(am) * R * 0.992;
        const tx = -Math.sin(am), tz = Math.cos(am), w = 3, y0 = base + 3, y1 = y0 + 6;
        lit.quad([mx + tx * w, y0, mz + tz * w], [mx - tx * w, y0, mz - tz * w], [mx - tx * w * 0.6, y1, mz - tz * w * 0.6], [mx + tx * w * 0.6, y1, mz + tz * w * 0.6], fireCol);
      }
    }
    // saggar stacks: columns of stacked fireclay boxes standing in the kiln
    const ns = Math.max(16, Math.min(34, Math.round(per / 28)));
    for (let i = 0; i < ns; i++) {
      const a = (i / ns) * Math.PI * 2 + rnd() * 0.2, d = 12 + rnd() * 16;
      const [x, z] = ringPos(a, d);
      pick(x, z);
      const r = 0.9 + rnd() * 0.5, n = 5 + Math.floor(rnd() * 8), hh = r * 0.9;
      const id = INK.prop(dark.props++);
      for (let k = 0; k < n; k++) {
        const y = bounds.y0 - 4 + k * hh, w = k % 2 ? 1 : 0.94;
        dark.cylinder(x, y, z, r * w, r * w, hh * 0.92, 6, sil(d + 10, k % 2 ? 1.08 : 0.96), { tint: [1.1, 1, 0.8], caps: k === n - 1 ? 'top' : false, ink: id });
      }
    }
  } else if (theme.backdrop === 'loft') {
    // roof trusses spanning the level, high overhead, along its long axis
    const len = alongX ? sx : sz, wid = (alongX ? sz : sx) + 40;
    const yE = bounds.y1 + 9, yR = yE + wid * 0.32;
    const c = sil(20, 1), cR = sil(20, 1.2);
    const beam = (a, b, t, col) => {
      // a squared timber between two points in the vertical plane of the truss
      const qa = alongX ? a[2] : a[0], qb = alongX ? b[2] : b[0];
      const dq = qb - qa, dy = b[1] - a[1], l = Math.hypot(dq, dy) || 1;
      const nq = -dy / l, ny = dq / l, w = 0.25;
      const off = (p, s, ww) => {
        const q = (alongX ? p[2] : p[0]) + nq * s * t, y = p[1] + ny * s * t;
        return alongX ? [p[0] + ww, y, q] : [q, y, p[2] + ww];
      };
      const A0 = off(a, -1, -w), A1 = off(a, 1, -w), B0 = off(b, -1, -w), B1 = off(b, 1, -w);
      const A2 = off(a, -1, w), A3 = off(a, 1, w), B2 = off(b, -1, w), B3 = off(b, 1, w);
      const si = [0, INK.prop(3), 0];
      // seen from below and from either side: two faces and the underside, both windings
      dark.quad(A0, B0, B1, A1, col, null, null, si); dark.quad(A1, B1, B0, A0, col, null, null, si);
      dark.quad(A2, B2, B3, A3, col, null, null, si); dark.quad(A3, B3, B2, A2, col, null, null, si);
      dark.quad(A0, B0, B2, A2, cR, null, null, si); dark.quad(A2, B2, B0, A0, cR, null, null, si);
    };
    const step = 7;
    for (let u = -7; u <= len + 7; u += step) {
      const mid = (alongX ? bounds.x0 : bounds.z0) + u;
      const Lp = (w, y) => (alongX ? [mid, y, cz + w] : [cx + w, y, mid]);
      pick(alongX ? mid : cx, alongX ? cz : mid);
      const hw = wid / 2;
      beam(Lp(-hw, yE), Lp(0, yR), 0.4, c); beam(Lp(0, yR), Lp(hw, yE), 0.4, c);              // rafters
      beam(Lp(-hw * 0.7, yE + (yR - yE) * 0.3), Lp(hw * 0.7, yE + (yR - yE) * 0.3), 0.28, c); // collar tie
      beam(Lp(0, yE + (yR - yE) * 0.3), Lp(0, yR), 0.2, c);                                    // king post
    }
    // far walls with tall windows, and racks of drying ware between them and the level
    const nw = Math.max(24, Math.min(56, Math.round(per / 14)));
    for (let i = 0; i < nw; i++) {
      const a = (i / nw) * Math.PI * 2, d = 28 + rnd() * 10;
      const [x, z] = ringPos(a, d);
      pick(x, z);
      const cc = sil(d + 20, i % 2 ? 1 : 0.93);
      const fx = -Math.sin(a), fz = Math.cos(a), w = (per / nw) * 0.56;
      const si = [0, INK.prop(4), 0];
      dark.quad([x + fx * w, base, z + fz * w], [x - fx * w, base, z - fz * w], [x - fx * w, bounds.y1 + 12, z - fz * w], [x + fx * w, bounds.y1 + 12, z + fz * w], cc, null, null, si);
      if (i % 2 === 0) {
        const y0 = bounds.y1 + 1.5, y1 = y0 + 7, ww = 1.3, inx = Math.cos(a) * -0.25, inz = Math.sin(a) * -0.25;
        const g = glowCol(0.9);
        lit.quad([x + fx * ww + inx, y0, z + fz * ww + inz], [x - fx * ww + inx, y0, z - fz * ww + inz], [x - fx * ww + inx, y1, z - fz * ww + inz], [x + fx * ww + inx, y1, z + fz * ww + inz], g);
      }
    }
    const nr = Math.max(8, Math.min(12, Math.round(per / 60)));
    for (let i = 0; i < nr; i++) {
      const a = (i / nr) * Math.PI * 2 + rnd() * 0.1, d = 12 + rnd() * 10;
      const [x, z] = ringPos(a, d);
      pick(x, z);
      const cc = sil(d + 6, 1.1), fx = -Math.sin(a), fz = Math.cos(a), w = 2.4, id = INK.prop(dark.props++);
      for (let k = 0; k < 3; k++) {
        const y = bounds.y0 - 1 + k * 1.8;
        dark.box(Math.min(x - fx * w, x + fx * w) - 0.25, y, Math.min(z - fz * w, z + fz * w) - 0.25, Math.max(x - fx * w, x + fx * w) + 0.25, y + 0.1, Math.max(z - fz * w, z + fz * w) + 0.25, { color: cc, tint: [1.2, 1, 0.7], ink: id });
        for (const j of [-1.2, 1.2]) dark.lathe(x + fx * j, y + 0.1, z + fz * j, [[0.24, 0], [0.36, 0.26], [0.2, 0.6]], 5, sil(d + 6, k % 2 ? 1.3 : 0.86), 1, id);
      }
      dark.box(x - 0.1, bounds.y0 - 1, z - 0.1, x + 0.1, bounds.y0 + 5, z + 0.1, { color: cc, ink: id });
    }
  } else {
    // the works: a near ring of kilns, chimneys and sheds, and a far ring of lower, paler rooftops
    const n = Math.max(24, Math.min(44, Math.round(per / 19)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.12, d = 34 + rnd() * 30;
      const [x, z] = ringPos(a, d);
      const kind = rnd();
      if (kind < 0.42) bottleKiln(x, z, 3.6 + rnd() * 2.6, d, bounds.y0 - 8 - rnd() * 6);
      else if (kind < 0.6) chimney(x, z, 1.0 + rnd() * 0.6, 30 + rnd() * 26 + (bounds.y0 - base), d);
      else shed(x, z, a + Math.PI / 2, 12 + rnd() * 10, 7 + rnd() * 3, 6 + rnd() * 6 + (bounds.y0 - base), d, 3 + Math.floor(rnd() * 3));
    }
    const nf = Math.max(18, Math.min(30, Math.round(per / 30)));
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2 + rnd() * 0.2, d = 92 + rnd() * 30;
      const [x, z] = ringPos(a, d);
      if (rnd() < 0.4) bottleKiln(x, z, 4 + rnd() * 3, d, bounds.y0 - 10);
      else shed(x, z, a + Math.PI / 2, 22 + rnd() * 16, 9, 14 + rnd() * 10 + (bounds.y0 - base), d, 4);
    }
  }

  // one material for the whole skyline: flat vertex colour, no light, no fog (the paling is painted in)
  const mat = inkless(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, side: THREE.DoubleSide }), INK.prop(2));
  disposables.push(mat);
  for (const b of sectors) {
    if (b.empty) continue;
    const m = new THREE.Mesh(b.build(), mat);
    // drawn after the level: early depth rejection skips every pixel the level already covers
    m.renderOrder = 40;
    group.add(m);
    disposables.push(m.geometry);
  }
  return {
    group, sky,
    update(time) { skyMat.uniforms.uTime.value = time; },
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
