// The look of the Fire pieces (sim side: src/sim/packs/fire.js and hazards.js). Called by
// buildWorld() with its context; adds to the level's shared batches and "views" that follow sim state.
//
// Everything Cinder touches burns, and nothing here costs a draw call of its own except the cords:
//   wood, ice, wax, rope, weak walls   instances in the level's box batch (batches.js): wood chars
//                                      from its edges in with fire in the cracks, flames stand on
//                                      it and grow, and it sinks into its own sparks; ice sweats
//                                      and steams; wax sags and runs
//   lanterns, braziers, coal, fuses    flames from the level's flame batch (flame.js), lumps from
//                                      its bits; a lit brazier roars, taller still when it is the
//                                      current checkpoint
//   pools                              sheets in the level's liquid mesh: loud cyan with a white
//                                      rim, lit from within - water is death, so it is the
//                                      brightest thing in a dark room
//   fuses and wires                    ONE mesh of cords; the burning point / the current runs
//                                      along it in the shader, a spitting flame rides the fuse
//   gas                                a sour-green volume that shimmers, and blasts in flame
// Housings, posts, nozzles and outlines go into the area's merged static mesh; light, spray and
// volumes use the baked FX mesh and the shared particles.

import * as THREE from '../../vendor/three.module.min.js';
import { FX } from './fx.js';
import { BOX } from './batches.js';
import { FLAME } from './flame.js';
import { pointAlong } from '../sim/packs/fire.js';

const EMBER = [1.0, 0.48, 0.18], HOT = [1.0, 0.78, 0.4], WATER = [0.45, 0.85, 1.0], GASC = [0.78, 0.95, 0.3], SPARKC = [1.0, 0.92, 0.5];
const SMOKE = [0.16, 0.13, 0.16], STEAM = [0.95, 0.97, 1.0];
const lerp = (a, b, t) => a + (b - a) * t;
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const MAX_CORDS = 48;

// ---------------------------------------------------------------------------- cords (fuses, wires)
const CORD_VERT = /* glsl */`
  attribute vec3 aC;          // kind (0 fuse, 1 wire), cord index, metres along
  uniform float uCord[${MAX_CORDS}];
  varying vec3 vC;
  varying float vState;
  varying float vDepth;
  varying float vShade;
  void main() {
    vC = aC;
    vState = uCord[int(aC.y + 0.5)];
    vShade = normal.y > 0.5 ? 1.0 : 0.72;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const CORD_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform vec2 uFogNF;
  uniform vec3 uFogColor;
  varying vec3 vC;
  varying float vState;
  varying float vDepth;
  varying float vShade;
  void main() {
    float along = vC.z;
    vec3 col;
    if (vC.x < 0.5) {
      // fuse: a twist of red and cream - loud, so the line it will burn along can be read at a glance;
      // behind the flame, ash with a dying glow; at the flame, white-hot
      col = mix(vec3(0.95, 0.86, 0.62), vec3(0.8, 0.12, 0.06), step(0.5, fract(along * 5.0))) * vShade;
      if (vState >= 0.0) {
        float burnt = step(along, vState);
        float head = 1.0 - smoothstep(0.0, 0.3, abs(along - vState));
        float tail = burnt * max(0.0, 1.0 - (vState - along) * 1.2);
        col = mix(col, vec3(0.05, 0.04, 0.05), burnt) + vec3(1.0, 0.3, 0.04) * tail * 0.9 + vec3(1.0, 0.8, 0.3) * head * 2.0;
      }
    } else {
      // wire: copper with dark bands; live, light runs along it; with a spark aboard it blazes
      float pulse = smoothstep(0.75, 1.0, sin(along * 2.6 - uTime * 11.0) * 0.5 + 0.5);
      col = mix(vec3(0.62, 0.3, 0.1), vec3(0.3, 0.12, 0.05), step(0.82, fract(along * 2.0))) * vShade;
      col += vec3(1.0, 0.85, 0.36) * (min(vState, 1.0) * (0.14 + pulse * 0.8) + max(0.0, vState - 1.0) * 1.4);
    }
    float fogF = smoothstep(uFogNF.x, uFogNF.y, vDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fogF), 0.0);       // alpha 0: a cord is too thin to be inked
    #include <colorspace_fragment>
  }`;

/** Append a square-section rod from a to b (half-width w) to position / attribute arrays. `along0` is the cord distance at a. */
function rod(pos, nrm, attr, idx, a, b, w, kind, index, along0) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  d[0] /= len; d[1] /= len; d[2] /= len;
  const t = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]];
  const ul = Math.hypot(u[0], u[1], u[2]); u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  // extend each end by w so corners of a polyline join up
  const A = [a[0] - d[0] * w, a[1] - d[1] * w, a[2] - d[2] * w], B = [b[0] + d[0] * w, b[1] + d[1] * w, b[2] + d[2] * w];
  const side = [[u, v], [v, [-u[0], -u[1], -u[2]]], [[-u[0], -u[1], -u[2]], [-v[0], -v[1], -v[2]]], [[-v[0], -v[1], -v[2]], u]];
  for (const [n, s] of side) {
    const base = pos.length / 3;
    for (const [P, al] of [[A, along0], [B, along0 + len]]) {
      for (const sg of [-1, 1]) {
        pos.push(P[0] + n[0] * w + s[0] * w * sg, P[1] + n[1] * w + s[1] * w * sg, P[2] + n[2] * w + s[2] * w * sg);
        nrm.push(n[0], n[1], n[2]); attr.push(kind, index, al);
      }
    }
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base, base + 3, base + 1, base, base + 2, base + 3);
  }
}

export function buildFireViews(ctx) {
  const { sim, L, theme, pal, P, G, F, pool, slot, decorAt, glowAt, group, views, own, handlers, outline, boxes, bits, liquids, LIQ, time, shimmer } = ctx;
  if (!L.woods && !L.pools) return;           // not a level that has these packs
  const piece = (i) => L.pieces[i];
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), quat = new THREE.Quaternion();

  // ------------------------------------------------------------------ boxes: wood, ice, wax, weak walls
  const list = [];
  for (const w of L.woods || []) list.push({ p: w, kind: w.kind === 'rope' ? BOX.rope : BOX.wood });
  for (const q of L.iceblocks || []) list.push({ p: q, kind: BOX.ice });
  for (const q of L.waxes || []) list.push({ p: q, kind: BOX.wax });
  for (const q of L.weakwalls || []) list.push({ p: q, kind: BOX.weak });
  list.forEach((bx, i) => {
    const q = bx.p, b = q.box || null;
    const bi = boxes.add(bx.kind);
    const isWood = bx.kind === BOX.wood || bx.kind === BOX.rope;
    const ext = () => q.box || (q.solid ? [q.solid.x0, q.solid.y0, q.solid.z0, q.solid.x1, q.solid.y1, q.solid.z1] : q.bounds);
    const e0 = ext();
    const cx = (e0[0] + e0[3]) / 2, cz = (e0[2] + e0[5]) / 2;
    // wood carries its flames from the start, folded away: they stand up when it catches
    const fl = [];
    if (isWood) {
      const w = e0[3] - e0[0], d = e0[5] - e0[2], n = bx.kind === BOX.rope ? 1 : Math.max(1, Math.min(4, Math.round(Math.max(w, d) / 0.8)));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, sz = Math.min(1.1, 0.5 + Math.max(w, d) * 0.25);
        fl.push({ h: F.add(cx, e0[4], cz, sz * 0.8, sz * (1.3 + (k % 2) * 0.3), k % 2 ? FLAME.fire : FLAME.hot, { k: 0, minor: k > 0 && k % 2 === 1 }), u, w, d });
      }
    }
    let acc = 0, last = -1, burn = 0;
    views.push({
      at: q.kind === 'crate' ? null : [cx, cz],
      update(dt, alpha) {
        let t = 0, gone = false;
        if (isWood) { t = q.state === 0 ? 0 : lerp(q.pt, q.t, alpha); gone = q.state === 2; }
        else if (bx.kind === BOX.ice) { t = lerp(q.pt, q.t, alpha); gone = q.gone; }
        else if (bx.kind === BOX.wax) t = lerp(q.pt, q.t, alpha);
        else gone = q.broken;
        const active = isWood ? q.state === 1 : (bx.kind === BOX.ice || bx.kind === BOX.wax) ? q.heating : false;
        // flames: up fast when it catches, guttering as it collapses
        burn += ((isWood && q.state === 1 ? Math.min(1, 0.35 + t * 2.2) * (t > 0.8 ? (1 - t) / 0.2 : 1) : 0) - burn) * Math.min(1, dt * 7);
        const e = ext();
        for (const f of fl) {
          f.h.k = burn;
          if (burn > 0.01) {
            f.h.x = f.w >= f.d ? lerp(e[0], e[3], f.u) : (e[0] + e[3]) / 2; f.h.z = f.w >= f.d ? (e[2] + e[5]) / 2 : lerp(e[2], e[5], f.u);
            f.h.y = e[1] + (e[4] - e[1]) * (t > 0.6 ? 1 - (t - 0.6) / 0.4 * 0.75 : 1) - 0.05;
          }
        }
        const moving = q.kind === 'crate' || bx.kind === BOX.wax;
        const key = gone ? 9 : t;
        if (key !== last || moving) {
          last = key;
          boxes.state(bi, Math.round(t * 50) / 50);
          if (gone) boxes.hide(bi);
          else if (bx.kind === BOX.rope) {
            const a = q.a, c = q.b, len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), w = 0.09 * (1 - t * 0.6);
            dir.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
            boxes.place(bi, a[0], a[1], a[2], w, len, w, quat.setFromUnitVectors(up, dir));
          } else if (q.kind === 'crate') {
            const s = q.size, bd = q.body, k = t > 0.6 ? 1 - (t - 0.6) / 0.4 * 0.7 : 1;
            boxes.place(bi, lerp(q.px, bd.x, alpha), lerp(q.py, bd.y, alpha), lerp(q.pz, bd.z, alpha), s[0], s[1] * k, s[2]);
          } else if (bx.kind === BOX.wood) {
            const k = t > 0.6 ? 1 - (t - 0.6) / 0.4 * 0.75 : 1;                 // sinks into its ashes at the end
            boxes.place(bi, (b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2, b[3] - b[0], (b[4] - b[1]) * k, b[5] - b[2]);
          } else if (bx.kind === BOX.ice) {
            boxes.place(bi, (b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2, (b[3] - b[0]) * (1 - 0.3 * t), (b[4] - b[1]) * (1 - 0.6 * t), (b[5] - b[2]) * (1 - 0.3 * t));
          } else if (bx.kind === BOX.wax) {
            const y1 = q.solid.y1;
            boxes.place(bi, (b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2, (b[3] - b[0]) * (1 + 0.1 * t), y1 - b[1], (b[5] - b[2]) * (1 + 0.1 * t));
          } else {
            boxes.place(bi, (b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2, b[3] - b[0], b[4] - b[1], b[5] - b[2]);
          }
        }
        // while it burns or melts: sparks and smoke, steam and drips
        if (!active) return;
        const area = Math.max(0.3, (e[3] - e[0]) * (e[5] - e[2]) + (e[4] - e[1]) * 0.6);
        acc += dt * Math.min(40, 10 + area * 10);
        while (acc > 1) {
          acc -= 1;
          const x = lerp(e[0], e[3], P.rnd()), z = lerp(e[2], e[5], P.rnd()), y = lerp(e[1], e[4], P.rnd());
          if (bx.kind === BOX.ice) {
            // it sweats and steams
            if (P.rnd() < 0.5) P.spawn({ x, y, z, vy: -0.8 - P.rnd(), life: 0.6, size: 0.07, color: WATER, alpha: 0.95, gravity: 6, solid: 0.9 });
            else P.spawn({ x, y: e[4], z, vx: (P.rnd() - 0.5) * 0.3, vy: 0.7 + P.rnd() * 0.8, vz: (P.rnd() - 0.5) * 0.3, life: 1.0, size: 0.3, grow: 0.45, color: STEAM, alpha: 0.5, drag: 0.8, solid: 1 });
          } else if (bx.kind === BOX.wax) {
            // runs: fat drops down its sides
            const sx = P.rnd() < 0.5 ? e[0] : e[3];
            P.spawn({ x: P.rnd() < 0.5 ? sx : x, y: e[4] - 0.05, z, vy: -0.5 - P.rnd() * 0.6, life: 0.7, size: 0.1, color: [1, 0.9, 0.55], alpha: 0.95, gravity: 2, solid: 1 });
          } else {
            // sparks torn off, and a rag of smoke
            P.spawn({ x, y: e[4], z, vx: (P.rnd() - 0.5) * 1.6, vy: 1.6 + P.rnd() * 2.6, vz: (P.rnd() - 0.5) * 1.6, life: 0.5 + P.rnd() * 0.6, size: 0.06 + P.rnd() * 0.05, color: P.rnd() < 0.4 ? [1, 0.95, 0.6] : HOT, gravity: 2, drag: 0.6, solid: 0.3 });
            if (P.rnd() < 0.3) P.spawn({ x, y: e[4] + 0.6, z, vx: (P.rnd() - 0.5) * 0.3, vy: 1 + P.rnd(), vz: (P.rnd() - 0.5) * 0.3, life: 1.3, size: 0.4, grow: 0.5, color: SMOKE, alpha: 0.4, drag: 0.6, solid: 1 });
          }
        }
      },
    });
    // the light a burning plank throws (the level's own baked light, switched by a slot)
    if (bx.kind === BOX.wood && b) {
      const sl = slot(cx, cz, 0);
      pool([cx, b[4] + 0.5, cz], 3.2, EMBER, 0.8, sl);
      const sh = shimmer(cx, b[4] + 0.6, cz, 1.4, 0);
      views.push({ at: [cx, cz], update(dt, alpha, t) { const on = q.state === 1; sl.set(on ? 0.8 + 0.2 * Math.sin(t * 9 + i) : 0); sh.k = on ? 0.8 : 0; } });
    }
    if (bx.kind === BOX.ice && b) {
      const sl = slot(cx, cz, 1);
      pool([cx, b[1] + 1, cz], 2.2, [0.6, 0.85, 1.0], 0.25, sl);
      views.push({ at: [cx, cz], update() { sl.set(q.gone ? 0 : 1 - q.t * 0.6); } });
    }
  });

  // ------------------------------------------------------------------ lanterns: a caged flame on a post, a chain or a bracket
  for (const q of L.lanterns || []) {
    const [x, y, z] = q.pos, decor = decorAt(x, z);
    decor.inkId = null;
    if (q.mount === 'post') {
      const fall = sim.raycast(x, y, z, 0, -1, 0, 3, (s) => s.owner && (s.owner.type === 'block' || s.owner.type === 'ramp'));
      const fy = fall < 3 ? y - fall : y - 0.95;
      decor.cylinder(x, fy, z, 0.22, 0.16, 0.1, 8, pal.iron, { caps: 'top' });
      decor.cylinder(x, fy + 0.1, z, 0.05, 0.045, Math.max(0.1, y - 0.24 - fy - 0.1), 6, pal.steel, { caps: false });
    } else if (q.mount === 'hang') {
      decor.box(x - 0.025, y + 0.3, z - 0.025, x + 0.025, y + 1.6, z + 0.025, { color: pal.iron });
    } else decor.box(x - 0.05, y - 0.05, z - 0.3, x + 0.05, y + 0.05, z, { color: pal.iron });
    // the cage: base, four bars, a cap
    decor.box(x - 0.2, y - 0.27, z - 0.2, x + 0.2, y - 0.21, z + 0.2, { color: pal.iron });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) decor.box(x + dx * 0.17 - 0.022, y - 0.21, z + dz * 0.17 - 0.022, x + dx * 0.17 + 0.022, y + 0.24, z + dz * 0.17 + 0.022, { color: pal.brass });
    decor.cylinder(x, y + 0.24, z, 0.26, 0.04, 0.14, 6, pal.iron, { caps: 'top' });
    const gh = G.add(x, y, z, theme.lamp, 5.5, 0.03, 0.06);
    const sl = slot(x, z, 0);
    pool([x, y + 0.1, z], 5.6, theme.lamp, 1.5, sl);
    const fl = F.add(x, y - 0.2, z, 0.3, 0.46, FLAME.fire, { k: q.lit ? 1 : 0, heart: 0.9 });
    let k = q.lit ? 1 : 0;
    bits.add((set, dt, t) => {
      k += ((q.lit ? 1 : 0) - k) * Math.min(1, dt * 6);
      // unlit: a cold bead of glass, so "this can be lit" still reads; lit: the wick's ember under the flame
      set(x, y - 0.2, z, lerp(0.08, 0.06, k), lerp(0.09, 0.05, k), lerp(0.08, 0.06, k), lerp(0.55, 1.0, k), lerp(0.66, 0.8, k), lerp(0.8, 0.3, k));
      fl.k = k;
      gh.alpha = 0.03 + k * 0.5; sl.set(k * (0.92 + 0.08 * Math.sin(t * 7 + z)));
    }, [x, z]);
    q._burst = () => { P.burst(x, y, z, 18, { speed: 2.4, life: 0.6, size: 0.1, color: HOT, drag: 2, up: 0.8 }); };
  }

  // ------------------------------------------------------------------ braziers: an iron bowl of coals on three legs
  // Lit, it is the checkpoint beacon of Fire levels: it ROARS, and roars taller when it is the current one.
  for (const q of L.braziers || []) {
    const [x, y, z] = q.pos, decor = decorAt(x, z);
    decor.inkId = null;
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; decor.box(x + Math.cos(a) * 0.3 - 0.045, y, z + Math.sin(a) * 0.3 - 0.045, x + Math.cos(a) * 0.3 + 0.045, y + 0.5, z + Math.sin(a) * 0.3 + 0.045, { color: pal.iron }); }
    decor.lathe(x, y + 0.42, z, [[0.12, 0], [0.36, 0.1], [0.48, 0.28], [0.5, 0.33], [0.44, 0.33]], 10, pal.steel);
    decor.cylinder(x, y + 0.66, z, 0.42, 0.4, 0.06, 10, [0.03, 0.02, 0.025], { caps: 'top' });   // the bed of cold coals
    const gh = G.add(x, y + 0.95, z, EMBER, 6, 0.03, 0.2);
    const sl = slot(x, z, 0), beam = slot(x, z, 0);
    pool([x, y + 1.2, z], 4.2, EMBER, 0.9, sl);
    beam.fx.tube([x, y + 1.0, z], [0, 1, 0], 7, 0.3, 0.55, mul(HOT, 0.38), FX.BEACON, beam.i, x);
    const fls = [F.add(x, y + 0.68, z, 0.95, 1.5, FLAME.hot, { k: 0, heart: 0.8 }), F.add(x + 0.2, y + 0.68, z + 0.1, 0.6, 1.05, FLAME.fire, { k: 0, minor: true }), F.add(x - 0.17, y + 0.68, z - 0.13, 0.55, 0.95, FLAME.fire, { k: 0, minor: true })];
    const sh = shimmer(x, y + 1.6, z, 1.3, 0);
    let k = q.lit ? 1 : 0, acc = 0;
    [[0, 0, 0.15], [0.19, 0.09, 0.12], [-0.16, -0.14, 0.11]].forEach(([ox, oz, r], j) => bits.add((set, dt, t) => {
      if (j === 0) k += ((q.lit ? 1 : 0) - k) * Math.min(1, dt * 5);
      const pu = 0.8 + 0.2 * Math.sin(t * (4 + j) + x + j);
      // the coals: dull when cold, glowing through the flames when lit
      set(x + ox, y + 0.66, z + oz, r, r * 0.7, r, lerp(0.16, 1.0 * pu, k), lerp(0.1, 0.5 * pu, k), lerp(0.1, 0.1, k));
      if (j !== 0) return;
      const cur = q.current ? 1.18 : 0.82;
      fls.forEach((f, n) => { f.k = k * cur * (n === 0 ? 1 : 0.95); });
      gh.alpha = 0.03 + k * (0.5 + 0.08 * Math.sin(t * 5)) * cur * 0.8; gh.size = 6 + k * 3;
      sh.k = k * 0.9;
      sl.set(k * cur * (0.8 + 0.15 * Math.sin(t * 6 + x)));
      beam.set(0.16 + k * (q.current ? 0.9 : 0.35));       // an unlit brazier still shows a faint beam, to be found
      if (k < 0.5) return;
      acc += dt * 12;
      while (acc > 1) { acc -= 1; P.spawn({ x: x + (P.rnd() - 0.5) * 0.5, y: y + 1.0 + P.rnd() * 0.5, z: z + (P.rnd() - 0.5) * 0.5, vx: (P.rnd() - 0.5) * 0.7, vy: 1.4 + P.rnd() * 2, vz: (P.rnd() - 0.5) * 0.7, life: 0.8 + P.rnd() * 0.6, size: 0.06, color: P.rnd() < 0.4 ? [1, 0.95, 0.6] : HOT, drag: 0.4, solid: 0.3 }); }
    }, [x, z]));
    q._burst = () => {
      P.burst(x, y + 1.0, z, 30, { speed: 3.2, life: 0.9, size: 0.13, color: HOT, drag: 2, up: 1.4 });
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; P.spawn({ x: x + Math.cos(a) * 0.5, y: y + 0.1, z: z + Math.sin(a) * 0.5, vx: Math.cos(a) * 3, vy: 0.3, vz: Math.sin(a) * 3, life: 0.6, size: 0.1, color: EMBER, drag: 3 }); }
    };
  }

  // ------------------------------------------------------------------ coal: a lump with a lick of flame, waiting to be picked up
  for (const q of L.coals || []) {
    const [x, y, z] = q.pos;
    const gh = G.add(x, y, z, EMBER, 2.6, 0.3, 0.15);
    const fl = F.add(x, y, z, 0.3, 0.42, FLAME.fire, { minor: true });
    let vis = 1;
    bits.add((set, dt, t) => {
      vis += ((q.taken ? 0 : 1) - vis) * Math.min(1, dt * 8);
      const pu = 0.75 + 0.25 * Math.sin(t * 3.2 + x * 2);
      const bob = Math.sin(t * 2 + x) * 0.05;
      set(x, y - 0.2 + bob, z, 0.24 * vis, 0.2 * vis, 0.22 * vis, 1.0 * pu, 0.36 * pu, 0.08 * pu);
      fl.y = y + 0.16 + bob; fl.k = vis;
      gh.alpha = vis * (0.22 + 0.12 * pu); gh.y = y + bob;
    }, [x, z]);
    q._burst = () => P.burst(x, y, z, 22, { speed: 3, life: 0.7, size: 0.12, color: HOT, drag: 2.5 });
  }

  // ------------------------------------------------------------------ drips: a pipe end, a bead that swells, a drop that falls
  for (const d of L.drips || []) {
    const [x, y, z] = d.pos, fy = y - d.drop, decor = decorAt(x, z), glow = glowAt(x, z);
    decor.inkId = null;
    decor.cylinder(x, y, z, 0.08, 0.1, 0.22, 6, pal.steel, { caps: 'bottom' });
    decor.box(x - 0.065, y + 0.2, z - 0.065, x + 0.065, y + 2.2, z + 0.065, { color: pal.iron });
    decor.box(x - 0.12, y + 0.16, z - 0.12, x + 0.12, y + 0.26, z + 0.12, { color: pal.brass });
    // where it lands: a wet ring painted on the floor (always there, so the column can be read before the drop comes)
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a); glow.box(x + c * 0.32 - 0.065, fy + 0.008, z + s * 0.32 - 0.065, x + c * 0.32 + 0.065, fy + 0.022, z + s * 0.32 + 0.065, { color: [0.5, 0.92, 1.0], tint: [1, 1, 1] }); }
    glow.box(x - 0.09, fy + 0.008, z - 0.09, x + 0.09, fy + 0.022, z + 0.09, { color: [0.9, 1.0, 1.0], tint: [1, 1, 1] });
    bits.add((set, dt, t, alpha) => {
      if (d.live) {
        const yy = lerp(d.py, d.y, alpha);
        set(x, yy - 0.14, z, 0.13, 0.24, 0.13, 0.5, 0.92, 1.0);
      } else {
        // the bead swelling at the nozzle: the nearer the next drop, the bigger
        const wait = d.active ? Math.max(0, Math.min(1, (d.clock - d.fallT) / Math.max(0.05, d.period - d.fallT))) : 0;
        const s = 0.03 + 0.09 * wait;
        set(x, y - s * 1.6, z, s, s * 1.3, s, 0.5, 0.9, 1.0);
      }
    }, [x, z]);
  }

  // ------------------------------------------------------------------ cords: fuses and wires
  const cords = [...(L.fuses || []).map((f) => ({ p: f, kind: 0 })), ...(L.wires || []).map((w) => ({ p: w, kind: 1 }))];
  if (cords.length) {
    const pos = [], nrm = [], attr = [], idx = [];
    const state = new Float32Array(MAX_CORDS).fill(-1);
    cords.forEach((c, i) => {
      const q = c.p, ci = Math.min(i, MAX_CORDS - 1);
      let along = 0;
      for (let s = 0; s + 1 < q.pts.length; s++) { rod(pos, nrm, attr, idx, q.pts[s], q.pts[s + 1], c.kind ? 0.035 : 0.05, c.kind, ci, along); along += q.seg[s]; }
      if (c.kind === 0) {
        const a = q.pts[0], e = q.pts[q.pts.length - 1], decor = decorAt(a[0], a[2]);
        decor.inkId = null;
        // the frayed end to touch: three stiff strands and a soft pulse; an eyelet where it ends
        for (const [dx, dz] of [[-0.09, 0.05], [-0.1, -0.03], [-0.06, -0.09]]) decor.box(a[0] + Math.min(0, dx) - 0.014, a[1] - 0.03, a[2] + Math.min(0, dz) - 0.014, a[0] + Math.max(0, dx) + 0.014, a[1] + 0.05, a[2] + Math.max(0, dz) + 0.014, { color: 0xf2dca0 });
        decorAt(e[0], e[2]).cylinder(e[0], e[1] - 0.06, e[2], 0.1, 0.1, 0.12, 6, pal.brass);
        const tip = G.add(a[0], a[1] + 0.1, a[2], HOT, 1.6, 0.25), head = G.add(a[0], a[1], a[2], HOT, 2.4, 0, 0.3);
        const sl = slot(a[0], a[2], 0.5);
        pool([a[0], a[1] + 0.5, a[2]], 1.4, HOT, 0.35, sl);
        const spit = F.add(a[0], a[1], a[2], 0.3, 0.42, FLAME.spark, { k: 0, heart: 1 });
        const out = [0, 0, 0];
        let acc = 0;
        views.push({
          update(dt, alpha, t) {
            const d = lerp(q.pd, q.d, alpha);
            state[ci] = q.state === 0 ? -1 : q.state === 1 ? d : q.len + 9;
            tip.alpha = q.state === 0 ? 0.2 + 0.14 * Math.sin(t * 4) : 0;
            sl.set(q.state === 0 ? 0.6 + 0.4 * Math.sin(t * 4) : 0);
            head.alpha = q.state === 1 ? 0.75 : 0;
            spit.k = q.state === 1 ? 0.8 + 0.3 * Math.sin(t * 31) : 0;
            if (q.state !== 1) return;
            pointAlong(q, d, out);
            head.x = out[0]; head.y = out[1] + 0.05; head.z = out[2];
            spit.x = out[0]; spit.y = out[1]; spit.z = out[2];
            // it spits: a fan of sparks thrown back along the burnt cord and up
            acc += dt * 46;
            while (acc > 1) { acc -= 1; P.spawn({ x: out[0], y: out[1] + 0.04, z: out[2], vx: (P.rnd() - 0.5) * 2.8, vy: 0.6 + P.rnd() * 2.6, vz: (P.rnd() - 0.5) * 2.8, life: 0.25 + P.rnd() * 0.3, size: 0.065, color: P.rnd() < 0.5 ? [1, 1, 0.8] : HOT, gravity: 6, solid: 0.3 }); }
          },
        });
      } else {
        views.push({ update() { const rd = sim.player.ride; state[ci] = rd && rd.w === q ? 2 : q.active ? 1 : 0; } });
      }
    });
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aC', new THREE.Float32BufferAttribute(attr, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const fog = new THREE.Color(theme.fog);
    const mat = own(new THREE.ShaderMaterial({
      uniforms: { uTime: time, uCord: { value: state }, uFogNF: { value: new THREE.Vector2(theme.fogNear, theme.fogFar) }, uFogColor: { value: new THREE.Vector3(fog.r, fog.g, fog.b) } },
      vertexShader: CORD_VERT, fragmentShader: CORD_FRAG, toneMapped: false, fog: false,
    }));
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    group.add(m);
  }
  // terminals: a white insulator with a brass cap that lights when it is powered or ridden
  for (const T of L.terminals || []) {
    const [x, y, z] = T.pos, decor = decorAt(x, z);
    decor.cylinder(x, y, z, 0.22, 0.19, 0.08, 8, pal.woodDark, { caps: 'top' });
    decor.cylinder(x, y + 0.08, z, 0.11, 0.13, 0.09, 8, pal.cream, { caps: false });
    decor.cylinder(x, y + 0.17, z, 0.14, 0.11, 0.09, 8, pal.cream, { caps: false });
    decor.cylinder(x, y + 0.26, z, 0.08, 0.08, 0.07, 8, pal.brass);
    const gh = G.add(x, y + 0.36, z, SPARKC, 1.6, 0.18, 0.3);
    const sl = slot(x, z, 0.2);
    pool([x, y + 0.6, z], 1.8, SPARKC, 0.45, sl);
    views.push({
      at: [x, z],
      update(dt, alpha, t) {
        const w = T.wire, on = T.live || (sim.player.ride && w && sim.player.ride.w === w);
        const ready = w ? w.active : true;
        gh.alpha = on ? 0.85 : ready ? 0.2 + 0.08 * Math.sin(t * 5 + x) : 0.05; gh.size = on ? 2.8 : 1.6;
        sl.set(on ? 1 + 0.3 * Math.sin(t * 40) : ready ? 0.3 : 0.05);
      },
    });
  }

  // ------------------------------------------------------------------ pools: water is death
  (L.pools || []).forEach((q) => {
    const b = q.box, w = b[3] - b[0], dp = b[5] - b[2], cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    const li = liquids.add(LIQ.pool, b[0], b[2], b[3], b[5], b[4] - 0.02);
    const sl = slot(cx, cz, 1);
    pool([cx, b[4] + 0.8, cz], 1.6 + Math.max(w, dp) * 0.35, WATER, 0.5, sl);
    let k = 1, acc = 0;
    views.push({
      at: [cx, cz],
      update(dt) {
        k += ((q.wet ? 1 : 0) - k) * Math.min(1, dt * (q.wet ? 3 : 10));
        liquids.setOn(li, Math.round(k * 50) / 50);
        sl.set(0.15 + 0.85 * k);
        if (q.steamT <= 0) return;
        // boiled: the basin stands full of steam until the water comes back
        acc += dt * Math.min(46, 8 + w * dp * 3);
        while (acc > 1) { acc -= 1; P.spawn({ x: b[0] + P.rnd() * w, y: b[1] + P.rnd() * (b[4] - b[1]), z: b[2] + P.rnd() * dp, vx: (P.rnd() - 0.5) * 0.4, vy: 0.8 + P.rnd() * 1.2, vz: (P.rnd() - 0.5) * 0.4, life: 1.1, size: 0.55, grow: 0.5, color: STEAM, alpha: 0.3 + 0.25 * Math.min(1, q.steamT), drag: 0.6, solid: 1 }); }
      },
    });
  });

  // ------------------------------------------------------------------ sprinklers
  for (const s of L.sprinklers || []) {
    const b = s.box, w = b[3] - b[0], h = b[4] - b[1], dp = b[5] - b[2], cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    const decor = decorAt(cx, cz), glow = glowAt(cx, cz);
    decor.inkId = null;
    // a pipe along the top with rose heads; the footprint is painted on the floor so the danger reads even while it is off
    const alongX = w >= dp, n = Math.max(1, Math.round((alongX ? w : dp) / 1.3));
    if (alongX) decor.box(b[0], b[4], cz - 0.07, b[3], b[4] + 0.14, cz + 0.07, { color: pal.steel });
    else decor.box(cx - 0.07, b[4], b[2], cx + 0.07, b[4] + 0.14, b[5], { color: pal.steel });
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, x = alongX ? lerp(b[0], b[3], u) : cx, z = alongX ? cz : lerp(b[2], b[5], u);
      decor.cylinder(x, b[4] - 0.14, z, 0.17, 0.07, 0.14, 8, pal.brass, { caps: 'bottom' });
    }
    outline(glow, b, [0.55, 0.92, 1.0], 1, 0.1);
    const sl = slot(cx, cz, s.wet ? 1 : 0.05);
    sl.fx.volume([b[0], b[1], b[2], b[3], b[1] + Math.min(h, 4), b[5]], mul(WATER, 0.42), FX.COLD, sl.i);
    pool([cx, b[1] + 1, cz], 2 + Math.max(w, dp) * 0.5, WATER, 0.5, sl);
    let k = s.wet ? 1 : 0, acc = 0;
    views.push({
      at: [cx, cz],
      update(dt) {
        k += ((s.wet ? 1 : 0) - k) * Math.min(1, dt * 8);
        sl.set(0.05 + 0.95 * k);
        if (k < 0.2) { if (s.active === false || k < 0.02) return; }
        acc += dt * Math.min(150, 24 + w * dp * 22) * k;
        while (acc > 1) {
          acc -= 1;
          const x = b[0] + P.rnd() * w, z = b[2] + P.rnd() * dp;
          P.spawn({ x, y: b[4] - 0.1, z, vx: (P.rnd() - 0.5) * 0.6, vy: -4.5 - P.rnd() * 2, vz: (P.rnd() - 0.5) * 0.6, life: Math.min(0.75, h / 6), size: 0.1, color: [0.78, 0.96, 1], alpha: 0.95, gravity: 6, solid: 0.9 });
          if (P.rnd() < 0.35) P.spawn({ x, y: b[1] + 0.05, z, vx: (P.rnd() - 0.5), vy: 0.6 + P.rnd(), vz: (P.rnd() - 0.5), life: 0.3, size: 0.07, color: [0.9, 1, 1], gravity: 5, solid: 0.9 });
          if (P.rnd() < 0.12) P.spawn({ x, y: b[1] + 0.2 + P.rnd() * Math.min(h, 2.4), z, vy: -0.4, life: 0.8, size: 0.7, grow: 0.3, color: [0.8, 0.93, 1.0], alpha: 0.16, solid: 1 });
        }
      },
    });
  }

  // ------------------------------------------------------------------ gas pockets: a sour-green shimmer that blasts
  const blasts = [];
  for (const q of L.gases || []) {
    const b = q.box, w = b[3] - b[0], h = b[4] - b[1], dp = b[5] - b[2], cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    const decor = decorAt(cx, cz), glow = glowAt(cx, cz);
    decor.box(cx - 0.32, b[1], cz - 0.32, cx + 0.32, b[1] + 0.05, cz + 0.32, { color: pal.iron });
    for (let i = 0; i < 3; i++) glow.box(cx - 0.24, b[1] + 0.05, cz - 0.21 + i * 0.16, cx + 0.24, b[1] + 0.068, cz - 0.13 + i * 0.16, { color: [0.8, 1.0, 0.3], tint: [1, 1, 1] });
    outline(glow, b, [0.8, 1.0, 0.3], 1, 0.08);
    const gh = G.add(cx, b[1] + h * 0.5, cz, GASC, 4 + Math.max(w, dp), 0.14, 0.1);
    const sl = slot(cx, cz, 1);
    sl.fx.volume(b, mul(GASC, 0.24), FX.HEAT, sl.i);
    pool([cx, b[1] + 0.8, cz], 1.6 + Math.max(w, dp) * 0.5, GASC, 0.3, sl);
    const sh = shimmer(cx, b[1] + h * 0.4, cz, 0.8 + Math.max(w, dp) * 0.5, 1);
    // three flames kept folded away for the blast
    const bl = [F.add(cx, b[1], cz, Math.max(1.6, w), Math.max(2.4, h * 1.3), FLAME.hot, { k: 0, heart: 1 }), F.add(cx - w * 0.3, b[1], cz + dp * 0.2, 1.2, 2.0, FLAME.gas, { k: 0 }), F.add(cx + w * 0.3, b[1], cz - dp * 0.2, 1.2, 2.2, FLAME.fire, { k: 0 })];
    const rec = { q, k: 0 }; blasts.push(rec);
    let k = 1, acc = 0;
    views.push({
      at: [cx, cz],
      update(dt) {
        k += ((q.full ? 1 : 0) - k) * Math.min(1, dt * (q.full ? 2 : 14));
        rec.k = Math.max(0, rec.k - dt * 2.6);
        for (const f of bl) f.k = rec.k > 0.02 ? Math.min(1.5, rec.k * 1.7) : 0;
        sl.set(k); gh.alpha = 0.14 * k; sh.k = k * 0.8 + rec.k;
        if (k < 0.3) return;
        acc += dt * Math.min(18, 3 + w * dp * 2.5);
        while (acc > 1) { acc -= 1; P.spawn({ x: b[0] + P.rnd() * w, y: b[1] + P.rnd() * h * 0.6, z: b[2] + P.rnd() * dp, vx: (P.rnd() - 0.5) * 0.3, vy: 0.3 + P.rnd() * 0.4, vz: (P.rnd() - 0.5) * 0.3, life: 1.4, size: 0.3, grow: 0.25, color: [0.72, 0.95, 0.3], alpha: 0.22, drag: 0.4, solid: 0.6 }); }
      },
    });
  }

  // ------------------------------------------------------------------ heat sensors
  for (const q of L.heatsensors || []) {
    const b = q.box, cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, decor = decorAt(cx, cz), glow = glowAt(cx, cz);
    outline(glow, b, [1.0, 0.55, 0.16], 0.9, 0.07);
    // an iron plate in the floor with an eye in the middle (flat: nothing to walk into)
    decor.box(cx - 0.44, b[1], cz - 0.44, cx + 0.44, b[1] + 0.035, cz + 0.44, { color: pal.iron, tint: [1, 0.8, 0.5] });
    glow.cylinder(cx, b[1] + 0.035, cz, 0.22, 0.18, 0.03, 10, [1.0, 0.5, 0.12], { tint: [1, 1, 1], caps: 'top' });
    const gh = G.add(cx, b[1] + 0.2, cz, EMBER, 1.8, 0.2, 0.1);
    const sl = slot(cx, cz, 0.2);
    pool([cx, b[1] + 0.8, cz], 2.4, EMBER, 0.5, sl);
    let k = 0;
    views.push({
      at: [cx, cz],
      update(dt, alpha, t) {
        k += ((q.live ? 1 : 0) - k) * Math.min(1, dt * 8);
        gh.alpha = 0.16 + 0.06 * Math.sin(t * 3 + cx) + k * 0.7; gh.size = 1.6 + k * 1.6;
        sl.set(0.2 + k * 1.1);
      },
    });
  }

  // ------------------------------------------------------------------ events
  handlers.push((e) => {
    if (e.type !== 'burst') return;
    const q = e.piece !== undefined ? piece(e.piece) : null;
    switch (e.kind) {
      case 'ignite':
        if (q && q._burst && q.type === 'lantern') q._burst();
        else P.burst(e.x, e.y + 0.1, e.z, 14, { speed: 2.2, life: 0.5, size: 0.09, color: HOT, drag: 2, up: 1 });
        break;
      case 'woodlight':
        P.burst(e.x, e.y, e.z, 20, { speed: 2.8, life: 0.6, size: 0.12, color: HOT, drag: 2, up: 1.6, solid: 0.3 });
        break;
      case 'woodgone': {
        // it collapses in sparks: a fountain of them, embers skittering out, a ball of smoke
        const b = e.box;
        for (let i = 0; i < 40; i++) P.spawn({ x: lerp(b[0], b[3], P.rnd()), y: lerp(b[1], b[4], P.rnd()), z: lerp(b[2], b[5], P.rnd()), vx: (P.rnd() - 0.5) * 3.4, vy: 0.8 + P.rnd() * 3.6, vz: (P.rnd() - 0.5) * 3.4, life: 0.8 + P.rnd() * 0.7, size: 0.09, color: P.rnd() < 0.5 ? [1, 0.95, 0.6] : EMBER, gravity: 6, drag: 0.6, solid: 0.3 });
        for (let i = 0; i < 10; i++) P.spawn({ x: lerp(b[0], b[3], P.rnd()), y: b[1] + 0.1, z: lerp(b[2], b[5], P.rnd()), vx: (P.rnd() - 0.5), vy: 0.6 + P.rnd(), vz: (P.rnd() - 0.5), life: 1.5, size: 0.75, grow: 0.6, color: SMOKE, alpha: 0.5, drag: 0.8, solid: 1 });
        break;
      }
      case 'icegone':
        P.burst(e.x, e.y + 0.3, e.z, 26, { speed: 2.4, life: 0.7, size: 0.11, color: WATER, gravity: 8, up: 1.6, solid: 0.9 });
        for (let i = 0; i < 8; i++) P.spawn({ x: e.x + (P.rnd() - 0.5), y: e.y + 0.2, z: e.z + (P.rnd() - 0.5), vy: 0.8, life: 1.0, size: 0.6, grow: 0.5, color: STEAM, alpha: 0.5, drag: 1, solid: 1 });
        break;
      case 'waxdone':
        P.burst(e.x, e.y + 0.1, e.z, 12, { flat: true, speed: 1.2, life: 0.6, size: 0.11, color: [1, 0.9, 0.55], drag: 3, solid: 1 });
        break;
      case 'boil':
        for (let i = 0; i < 30; i++) P.spawn({ x: e.x + (P.rnd() - 0.5) * 3, y: e.y, z: e.z + (P.rnd() - 0.5) * 3, vx: (P.rnd() - 0.5), vy: 1.5 + P.rnd() * 2.5, vz: (P.rnd() - 0.5), life: 1.0, size: 0.7, grow: 0.7, color: STEAM, alpha: 0.55, drag: 0.8, solid: 1 });
        break;
      case 'drip':
        P.burst(e.x, e.y + 0.03, e.z, e.hit ? 14 : 8, { flat: !e.hit, speed: e.hit ? 2.6 : 1.6, life: 0.35, size: 0.08, color: [0.75, 0.96, 1], gravity: 7, up: 1.2, solid: 0.9 });
        break;
      case 'fuseend':
        P.burst(e.x, e.y, e.z, 20, { speed: 3.4, life: 0.4, size: 0.09, color: [1, 1, 0.8], drag: 4 });
        break;
      case 'coal': if (q && q._burst) q._burst(); break;
      case 'blast': {
        // the nearest pocket's folded flames stand up, and the rest is thrown outward
        let best = null, bd = 1e9;
        for (const r of blasts) { const b = r.q.box, d = ((b[0] + b[3]) / 2 - e.x) ** 2 + ((b[2] + b[5]) / 2 - e.z) ** 2; if (d < bd) { bd = d; best = r; } }
        if (best) best.k = 1;
        for (let i = 0; i < 46; i++) {
          const a = P.rnd() * Math.PI * 2, el = (P.rnd() - 0.2) * 1.4, sp = 3 + P.rnd() * 7, ch = Math.cos(el);
          P.spawn({ x: e.x, y: e.y, z: e.z, vx: Math.cos(a) * ch * sp, vy: Math.sin(el) * sp + 1, vz: Math.sin(a) * ch * sp, life: 0.35 + P.rnd() * 0.4, size: 0.3 + P.rnd() * 0.3, grow: -0.5, color: P.rnd() < 0.4 ? [1, 0.95, 0.7] : EMBER, alpha: 0.9, drag: 2.5, solid: 0.5 });
        }
        P.burst(e.x, e.y, e.z, 5, { speed: 0.6, life: 0.25, size: 2.6, color: [1, 0.95, 0.7], alpha: 0.7, drag: 3, solid: 0.2 });
        for (let i = 0; i < 10; i++) P.spawn({ x: e.x + (P.rnd() - 0.5) * 2, y: e.y + P.rnd(), z: e.z + (P.rnd() - 0.5) * 2, vy: 1 + P.rnd(), life: 1.6, size: 0.9, grow: 0.8, color: SMOKE, alpha: 0.45, drag: 0.8, solid: 1 });
        break;
      }
      case 'weakwall':
        P.burst(e.x, e.y, e.z, 40, { speed: 5.5, life: 0.9, size: 0.15, color: [0.86, 0.72, 0.6], gravity: 11, spread: 1.6, up: 1.2, solid: 1 });
        P.burst(e.x, e.y, e.z, 10, { speed: 1.6, life: 0.7, size: 0.7, color: [0.9, 0.86, 0.8], drag: 3, alpha: 0.5, solid: 1 });
        break;
      default: break;
    }
  });
}
