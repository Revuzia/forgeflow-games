// PLAYGROUND: Hearthlog Cabin's look (PLACES.md 4.2; PLAYGROUND_BUILD.md 9 and 13: one lazy chunk, at most 45 KB with PG_AUDIO's
// src/audio/places/hearthlog.ts and PG_DATA's src/data/place_hearthlog.ts). Inside a small log cabin on an evening deep in the woods: round-log
// walls in plum and dusk, a stone fireplace whose firelight is the amber key (warmer than Home) with embers rising (additive, 24 / 16 / 8 by
// tier, x0.3 in Calm, none with reduced motion), a window at the back where snow falls past dark pines (a card: the flakes stay behind the
// pane) giving the lagoon rim, a braided coral and cream rug on dusk-dark floorboards, the 2.2 m Rocker Board, the Yarn Ball, the Pillow
// Swing under a ceiling beam, the Snug Basket, the Singing Kettle. BOTH layouts (wide 0, tall 1) from the same kit; every position is the
// data module's (PlaceDef = wide, PlaceDef.tall = tall). Statics are batched per material into instanced draws (RD-08: at most 60 calls).
// Token colours only (place.ts tok(): OKLCH mixes of the eight). Mean luminance about 0.20 (RD-13 measures it).
import * as THREE from 'three';
import { type PlaceLook, type PlaceBuilt, type PropKit, type PlaceLight, Emitter, tok, col, sp } from '../place.ts';
import { Particles } from '../particles.ts';
import type { PanelDef } from '../env.ts';
import PLACE from '../../data/place_hearthlog.ts';

const WALL_H = 2.4, LOG_R = 0.15;
const UP = new THREE.Vector3(0, 1, 0);

// the floor boards: dusk-dark planks along x, band-limited grain (no shimmer at grazing angles), top at y = 0
const BOARDS = /* glsl */`
#include <color_fragment>
{
  vec2 p = vWP.xz;
  float fw = max(length(fwidth(p)), 1e-5);
  float row = floor(p.y / 0.19);
  float seam = 1.0 - smoothstep(0.0, max(0.008, fw * 1.2), min(fract(p.y / 0.19), 1.0 - fract(p.y / 0.19)) * 0.19);
  float endSeam = 1.0 - smoothstep(0.0, max(0.008, fw * 1.2), abs(fract(p.x / 1.7 + fract(row * 0.618)) - 0.5) * 1.7 - 0.84);
  float grain = 0.5 + 0.5 * sin(p.x * 23.0 + sin(p.x * 3.1 + row) * 2.0) * (1.0 - smoothstep(0.02, 0.06, fw));
  float tone = 0.85 + 0.25 * fract(sin(row * 12.9898) * 43758.5453);
  diffuseColor.rgb *= tone * (0.9 + 0.12 * grain) * (1.0 - 0.3 * max(seam, endSeam * (1.0 - smoothstep(0.004, 0.012, fw))));
}
`;
// the braided rug: concentric bands of coral, cream and dusk with a braid twist
const RUG = /* glsl */`
#include <color_fragment>
{
  vec2 p = vLP;
  float r = length(p) / uR;
  float band = r * 7.0;
  float k = mod(floor(band), 3.0);
  vec3 c = k < 0.5 ? uA : k < 1.5 ? uB : uC;
  float tw = 0.5 + 0.5 * sin(atan(p.y, p.x) * (28.0 + floor(band) * 6.0) + fract(band) * 6.2832);
  float fw = max(fwidth(band), 1e-4);
  float edge = smoothstep(0.0, fw * 1.5, fract(band)) * smoothstep(0.0, fw * 1.5, 1.0 - fract(band));
  diffuseColor.rgb = c * (0.78 + 0.22 * tw) * (0.7 + 0.3 * edge) * (1.0 - smoothstep(0.96, 1.0, r) * 0.4);
}
`;
// the back window: night blue, dark pines, snow falling behind the pane (uMotion 1, 0.3 in Calm, 0 with reduced motion: still flakes)
const WINDOW_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uTime, uMotion;
uniform vec3 uNight, uDeep, uPine, uSnow, uFrame;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  vec3 c = mix(uDeep, uNight, smoothstep(0.0, 1.0, uv.y));
  // three rows of pines (triangles by hash), the far ones lighter
  for (int l = 0; l < 2; l++) {
    float fl = float(l), sc = 7.0 + fl * 5.0, base = 0.18 + fl * 0.1;
    float cell = floor(uv.x * sc), fx = fract(uv.x * sc) - 0.5;
    float hgt = base + 0.25 * h21(vec2(cell, fl));
    float tri = step(abs(fx) * 1.6 * hgt * 2.0, hgt - uv.y);
    c = mix(c, mix(uPine, uDeep, 0.5 - fl * 0.3), tri * step(0.0, uv.y));
  }
  // snow: two layers of flakes drifting down
  for (int l = 0; l < 2; l++) {
    float fl = float(l), sc = 9.0 + fl * 7.0;
    vec2 q = uv * sc + vec2(0.0, uTime * uMotion * (0.6 + fl * 0.4));
    vec2 id = floor(q), f = fract(q) - 0.5;
    vec2 o = vec2(h21(id) - 0.5, h21(id + 7.1) - 0.5) * 0.6 + vec2(0.12 * sin(uTime * uMotion + id.y), 0.0);
    float d = length(f - o);
    c = mix(c, uSnow, (1.0 - smoothstep(0.035 + fl * 0.02, 0.07 + fl * 0.03, d)) * step(0.5, h21(id + 3.3)) * (0.55 + fl * 0.3));
  }
  // the frame and the cross bars
  float fr = max(step(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)), 0.06), step(abs(uv.x - 0.5), 0.02) + step(abs(uv.y - 0.52), 0.02));
  c = mix(c, uFrame, min(1.0, fr));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;
const FIRE_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uTime, uAmt, uMotion;
uniform vec3 uCore, uEdge;
void main() {
  vec2 p = vUv - vec2(0.5, 0.0);
  float flick = 0.85 + 0.15 * sin(uTime * 7.0 * uMotion) * sin(uTime * 3.3 * uMotion + 1.7);
  float h = (1.0 - smoothstep(0.0, 0.95, vUv.y)) * (1.0 - smoothstep(0.0, 0.5, abs(p.x) * (1.4 + vUv.y * 2.2)));
  float a = h * flick * uAmt;
  gl_FragColor = vec4(mix(uEdge, uCore, h) * a, 1.0);
  #include <colorspace_fragment>
}
`;
const UV_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

/** Static parts batched by geometry kind and material into one InstancedMesh each (fewer draw calls). */
class Batch {
  private readonly lists = new Map<string, { g: THREE.BufferGeometry; m: THREE.Material; mats: THREE.Matrix4[]; order: number }>();
  add(key: string, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, q?: THREE.Quaternion, order = 1): void {
    let l = this.lists.get(key);
    if (!l) { l = { g, m, mats: [], order }; this.lists.set(key, l); }
    l.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q ?? new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
  }
  flush(kit: PropKit, into: THREE.Group): void { for (const l of this.lists.values()) into.add(kit.instanced(l.g, l.m, l.mats, l.order)); }
}

const LOOK: PlaceLook = {
  id: 'hearthlog',
  skyBand: tok('dusk', 'lagoon', 0.35, 0.8),
  sky: {
    uZenith: tok('ink', 'ink', 0, 0.8), uInk: tok('ink'), uPlum: tok('plum', 'ink', 0.4), uHorizon: tok('dusk', 'ink', 0.6),
    uGlowWarm: tok('amber', 'amber', 0, 0.3), uGlowCool: tok('lagoon', 'lagoon', 0, 0.2), uBase: tok('ink', 'plum', 0.3, 0.8), uWarm: tok('amber', 'amber', 0, 0.12),
    uFogNear: 6, uFogFar: 30,
  },
  light(layout: 0 | 1): PlaceLight {
    const fire = layout === 0 ? PLACE.zones[0] : PLACE.tall.zones[0];
    return {
      // the firelight: low at the hearth, spreading across the room (a wide soft cone, not a pool on the floor)
      key: tok('amber', 'coral', 0.18), keyI: 140, keyPos: [fire.x, 1.0, fire.z - 0.1], keyAim: [fire.x * 0.15, 0.0, fire.z + 3.0], keyAngle: 1.35,
      rim: tok('lagoon', 'cream', 0.15), rimI: 1.6, rimDir: layout === 0 ? [0.55, 0.35, -0.76] : [-0.3, 0.4, -0.87],
      fillSky: tok('amber', 'cream', 0.5, 0.9), fillGround: tok('dusk', 'amber', 0.5), fillI: 4.2,
      keyTint: [1.0, 0.66, 0.36],
    };
  },
  panels: [
    { dir: new THREE.Vector3(-0.72, 0.38, 0.58).normalize(), dist: 4.5, w: 2.2, h: 1.4, color: [1.0, 0.62, 0.3], k: 6.0, soft: 0.6, radius: 0.6 },   // the fire, low and warm
    { dir: new THREE.Vector3(0.12, 1, 0.2).normalize(), dist: 4.5, w: 3.6, h: 0.6, color: [1.0, 0.78, 0.55], k: 2.6, soft: 0.25, radius: 0.3 },       // the warm room overhead
    { dir: new THREE.Vector3(0.55, 0.3, -0.78).normalize(), dist: 4.5, w: 1.0, h: 1.4, color: [0.32, 0.78, 0.92], k: 7.5, soft: 0.2, radius: 0.2 },    // the window, cool
    { dir: new THREE.Vector3(0.78, 0.18, 0.6).normalize(), dist: 4.5, w: 2.4, h: 2.4, color: [0.48, 0.34, 0.86], k: 0.5, soft: 1.1, radius: 1.0 },     // dim violet fill
  ] satisfies PanelDef[],

  build(kit: PropKit, layout: 0 | 1): PlaceBuilt {
    const tall = layout === 1;
    const g = new THREE.Group(); g.name = `hearthlog-${tall ? 'tall' : 'wide'}`;
    const B = new Batch();
    const spot = (i: number): { x: number; z: number; yaw: number } => (tall ? PLACE.tall.things[i] : PLACE.things[i]);
    const walls = tall ? PLACE.tall.walls : PLACE.walls;
    // materials (token mixes)
    // (warm browns are amber-cream mixes taken deeper: an amber-plum mix slides through red in OKLCH and read pink)
    const logA = kit.mat('logA', tok('plum', 'dusk', 0.3, 1.45), 0.85), logB = kit.mat('logB', tok('dusk', 'plum', 0.3, 1.1), 0.85);
    const stone = kit.mat('stone', tok('ink', 'cream', 0.5), 0.95, 0.3), stoneDark = kit.mat('stoneDark', tok('ink'), 1.0, 0.05);
    const wood = kit.mat('wood', tok('amber', 'cream', 0.45, 0.5), 0.7), woodLight = kit.mat('woodLight', tok('amber', 'cream', 0.5, 0.66), 0.6);
    const cushion = kit.mat('cushion', tok('coral', 'plum', 0.45, 0.9), 0.95, 0.15), pillow = kit.mat('pillow', tok('cream', 'coral', 0.2), 0.9, 0.2);
    const yarn = kit.mat('yarn', tok('coral', 'plum', 0.15), 0.95, 0.15), metal = kit.mat('metal', tok('dusk', 'cream', 0.35), 0.35, 0.9);
    const rope = kit.mat('rope', tok('amber', 'cream', 0.5, 0.85), 0.95, 0.1);
    const unitBox = kit.box(1, 1, 1), unitCylX = kit.geo('cylX', () => new THREE.CylinderGeometry(1, 1, 1, 12).rotateZ(Math.PI / 2)), unitCyl = kit.cyl(1, 1, 1, 12);

    // ---- the floor boards (one big plane, top at y = 0) ----
    // (round 2: warm honey boards, an amber-cream mix taken deeper: the dusk-amber boards read magenta and held the room at 0.07 luminance)
    const floorMat = kit.mat('floor', tok('amber', 'cream', 0.5, 0.6), 0.75, 0.3);
    floorMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <color_fragment>', BOARDS);
    };
    floorMat.customProgramCacheKey = () => 'wh-boards-v1';
    const floor = kit.mesh(kit.geo('floor', () => new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2)), floorMat, 0, 0, 0, -50);
    g.add(floor);

    // ---- the rug (a patch: no collider) ----
    const rp = tall ? PLACE.tall.patches[0] : PLACE.patches[0], rr = rp.r ?? 1;
    const rugMat = kit.mat(`rug${rr}`, [1, 1, 1], 0.97, 0.12);
    const ru = { uR: { value: rr }, uA: { value: col(tok('coral', 'plum', 0.2)) }, uB: { value: col(tok('cream', 'amber', 0.2, 0.9)) }, uC: { value: col(tok('dusk', 'plum', 0.3)) } };
    rugMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, ru);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position.xy;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vLP;\nuniform float uR; uniform vec3 uA, uB, uC;').replace('#include <color_fragment>', RUG);
    };
    rugMat.customProgramCacheKey = () => 'wh-rug-v1';
    const rug = kit.mesh(kit.geo(`rug${rr}`, () => new THREE.CircleGeometry(rr, 64)), rugMat, rp.x, 0.004, rp.z, -48);
    rug.rotation.x = -Math.PI / 2;
    g.add(rug);

    // ---- the log walls (back and both sides), plum and dusk logs alternating, one instanced draw per colour ----
    for (let wi = 0; wi < walls.length; wi++) {
      const w = walls[wi], hx = w.hx ?? 0.15, hz = w.hz ?? 0.15, alongX = hx > hz;
      const len = 2 * (alongX ? hx : hz), inner = alongX ? w.z + (w.z < 0 ? hz : -hz) : w.x + (w.x < 0 ? hx : -hx);
      for (let k = 0; k < Math.round(WALL_H / (2 * LOG_R)); k++) {
        const y = LOG_R + k * 2 * LOG_R, key = (k + wi) % 2 ? 'logA' : 'logB';
        const m = key === 'logA' ? logA : logB;
        if (alongX) B.add(key, unitCylX, m, w.x, y, inner + (w.z < 0 ? -LOG_R : LOG_R), len, LOG_R, LOG_R);
        else B.add(key + 'z', unitCyl, m, inner + (w.x < 0 ? -LOG_R : LOG_R), y, w.z, LOG_R, len, LOG_R, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      }
    }
    const back = walls.find((w) => (w.hx ?? 0) > (w.hz ?? 0))!, backZ = back.z + (back.hz ?? 0.15);
    // backdrop cards: the dark under-roof above and behind the walls (low poly, renderOrder -99..-51)
    const cardMat = kit.mat('card', tok('plum', 'dusk', 0.3, 0.9), 1.0, 0.0);
    const card = (x: number, y: number, z: number, w: number, h: number, ry: number, order: number): void => {
      const c = kit.mesh(kit.geo(`card${w},${h}`, () => new THREE.PlaneGeometry(w, h)), cardMat, x, y, z, order); c.rotation.y = ry; g.add(c);
    };
    card(0, WALL_H + 2.2, backZ - 0.32, 2 * (back.hx ?? 3) + 1.2, 4.4, 0, -60);
    const sideX = Math.abs(walls.find((w) => (w.hz ?? 0) > (w.hx ?? 0))!.x) + 0.32;
    card(-sideX, WALL_H + 2.2, 0, 10, 4.4, Math.PI / 2, -59); card(sideX, WALL_H + 2.2, 0, 10, 4.4, -Math.PI / 2, -58);

    // ---- the back window: night, pines, snow behind the pane ----
    const wz = tall ? PLACE.tall.zones[1] : PLACE.zones[1];
    const winU = { uTime: { value: 0 }, uMotion: { value: 1 }, uNight: { value: col(tok('dusk', 'lagoon', 0.35, 0.55)) }, uDeep: { value: col(tok('ink', 'dusk', 0.3)) },
      uPine: { value: col(tok('ink', 'ink', 0, 0.7)) }, uSnow: { value: col(tok('cream', 'lagoon', 0.15)) }, uFrame: { value: col(tok('plum', 'amber', 0.25, 0.8)) } };
    const winMat = kit.own(new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: WINDOW_FRAG, uniforms: winU, toneMapped: false }));
    const win = kit.mesh(kit.geo('win', () => new THREE.PlaneGeometry(1.15, 0.95)), winMat, Math.max(-(back.hx ?? 3) + 0.8, Math.min((back.hx ?? 3) - 0.8, wz.x)), 1.08, backZ + 0.03, 3);
    g.add(win);

    // ---- the fireplace: stone body, mantel, dark opening, two logs, the fire glow, embers ----
    const h = spot(0), hd = PLACE.things[0];
    const [fw, fh, fd] = [hd.size[0] * 2, hd.size[1] * 2, hd.size[2] * 2];
    B.add('stone', unitBox, stone, h.x, fh / 2, h.z, fw, fh, fd);
    B.add('stone', unitBox, stone, h.x, fh + 0.05, h.z + 0.04, fw + 0.2, 0.1, fd + 0.12);
    B.add('dark', unitBox, stoneDark, h.x, 0.3, h.z + fd / 2 - 0.04, 0.8, 0.56, 0.1);
    B.add('wood', unitCylX, wood, h.x - 0.08, 0.1, h.z + fd / 2 + 0.03, 0.6, 0.06, 0.06);
    B.add('wood', unitCylX, wood, h.x + 0.1, 0.17, h.z + fd / 2 + 0.06, 0.55, 0.055, 0.055, new THREE.Quaternion().setFromAxisAngle(UP, 0.35));
    const fireU = { uTime: { value: 0 }, uAmt: { value: 1 }, uMotion: { value: 1 }, uCore: { value: col(tok('amber', 'cream', 0.35)) }, uEdge: { value: col(tok('coral', 'amber', 0.3)) } };
    const fireMat = kit.own(new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: FIRE_FRAG, uniforms: fireU, toneMapped: false, transparent: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }));
    const fire = kit.mesh(kit.geo('fire', () => new THREE.PlaneGeometry(0.7, 0.5).translate(0, 0.25, 0)), fireMat, h.x, 0.04, h.z + fd / 2 + 0.1, 5);
    g.add(fire);
    const fz = tall ? PLACE.tall.zones[0] : PLACE.zones[0];
    const fireP = [fz.x, 0.25, fz.z - 0.35] as const;
    const EMB: [number, number, number] = [1, 0.55, 0.12];
    const embers = new Emitter([24, 16, 8], false, (p, r) => {
      EMB[1] = 0.45 + r() * 0.25;
      p.emit(sp(h.x + (r() - 0.5) * 0.5, 0.35, h.z + fd / 2 + 0.12, (r() - 0.5) * 0.12, 0.45 + r() * 0.35, 0.05 + r() * 0.08, 1.4 + r() * 1.2, 0.012 + r() * 0.01, EMB, 0.9, 0.4));
    }, 9);
    g.add(embers.particles.mesh);
    kit.own(embers);
    // the firelight on the floorboards in front of the hearth (additive, follows the fire's strength)
    const glowU = { uAmt: { value: 1 }, uCol: { value: col(tok('amber', 'coral', 0.25, 0.75)) } };
    const glowMat = kit.own(new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: 'varying vec2 vUv; uniform float uAmt; uniform vec3 uCol; void main(){ vec2 q = vUv * 2.0 - 1.0; float r = length(q); float a = (1.0 - smoothstep(0.0, 1.0, r)) * (1.0 - smoothstep(0.0, 1.0, r)) * uAmt; gl_FragColor = vec4(uCol * a * 0.5, 1.0); }',
      uniforms: glowU, toneMapped: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }));
    const fglow = kit.mesh(kit.geo('fglow', () => new THREE.PlaneGeometry(3.2, 2.2).rotateX(-Math.PI / 2)), glowMat, h.x, 0.006, h.z + fd / 2 + 1.0, -45);
    g.add(fglow);

    // ---- the Rocker Board (a mover: the board on its pivot; a static wedge under it) ----
    const rk = spot(1), rd = PLACE.things[1], piv = rd.p.pivot ?? 0.24;
    B.add('wood', unitBox, wood, rk.x, (piv - 0.09) / 2, rk.z, 0.3, piv - 0.09, 0.4);
    const board = new THREE.Group(); board.position.set(rk.x, piv, rk.z); board.rotation.y = -rk.yaw;
    board.add(kit.mesh(kit.box(rd.size[0] * 2, rd.size[1] * 2, rd.size[2] * 2), woodLight, 0, 0, 0, 2));
    g.add(board);
    kit.shadow(rk.x, rk.z, rd.size[0] * 1.05, rd.size[2] * 1.2, 0.35);

    // ---- the Yarn Ball (a mover) ----
    const yb = spot(2), yr = PLACE.things[2].size[0];
    const ball = new THREE.Group(); ball.position.set(yb.x, yr, yb.z);
    ball.add(kit.mesh(kit.sphere(yr, 22, 16), yarn, 0, 0, 0, 2));
    const band = kit.mesh(kit.geo('yband', () => new THREE.TorusGeometry(yr * 0.99, 0.018, 6, 28)), kit.mat('yarnBand', tok('cream', 'coral', 0.3), 0.9, 0.1), 0, 0, 0, 2);
    band.rotation.set(0.6, 0.3, 0); ball.add(band);
    g.add(ball);

    // ---- the Pillow Swing: a ceiling beam (render only), ropes and a seat (a mover: the seat, its ropes ride with it up to the pivot) ----
    const sw = spot(3), sd = PLACE.things[3], ropeL = sd.p.rope ?? 1.4, pivY = sd.p.pivotY ?? 1.62, seatR = sd.size[0], seatL = sd.size[1];
    const across = new THREE.Vector3(Math.cos(sw.yaw), 0, Math.sin(sw.yaw));   // the swing's direction of travel
    // the ceiling beam spans the room wall to wall along x (the ropes hang under it: a wide plank where the seat lies along z)
    const inX = Math.abs(walls.find((w) => (w.hz ?? 0) > (w.hx ?? 0))!.x) - (walls.find((w) => (w.hz ?? 0) > (w.hx ?? 0))!.hx ?? 0.15);
    B.add('logB', unitCylX, logB, 0, pivY + 0.1, sw.z, 2 * inX, 0.11, 0.11);
    const seat = new THREE.Group(); seat.position.set(sw.x, pivY - ropeL, sw.z); seat.rotation.y = -sw.yaw;
    const seatMesh = kit.mesh(kit.capsule(seatR, seatL), wood, 0, 0, 0, 2); seatMesh.rotation.x = Math.PI / 2; seat.add(seatMesh);   // the seat lies across the swing's travel
    const pil = kit.mesh(kit.sphere(0.2, 16, 10), pillow, 0, 0.12, 0, 2); pil.scale.set(1.15, 0.55, 1.7); seat.add(pil);   // a fat cushion that reads end-on
    // two ropes from the seat's ends up to the one pivot under the beam (a V: the hinge is a single axis)
    for (const side of [-1, 1]) {
      const o = side * (seatL / 2 - 0.05), len = Math.hypot(o, ropeL);
      const r = kit.mesh(kit.cyl(0.012, 0.012, len, 6), rope, 0, ropeL / 2, o / 2, 2);
      r.rotation.x = Math.atan2(-o, ropeL); seat.add(r);
    }
    g.add(seat);
    void across;

    // ---- the Snug Basket: a ring of 6 segments with a 120 degree gap toward the room, a cushion inside ----
    const bk = spot(4), bd = PLACE.things[4], ringR = bd.size[0], segR = bd.size[1], gap = (bd.size[2] * Math.PI) / 180, nSeg = bd.p.segments ?? 6;
    const arc = 2 * Math.PI - gap, segArc = arc / nSeg;
    for (let i = 0; i < nSeg; i++) {
      const a = gap / 2 + segArc * (i + 0.5) + bk.yaw, len = 2 * ringR * Math.sin(segArc / 2) + segR;
      const x = bk.x + Math.cos(a) * ringR, z = bk.z + Math.sin(a) * ringR;
      B.add('basket', unitCylX, woodLight, x, segR, z, len, segR, segR, new THREE.Quaternion().setFromAxisAngle(UP, -a + Math.PI / 2));
    }
    const cush = kit.mesh(kit.cyl(ringR - segR - 0.04, ringR - segR - 0.02, 0.06, 28), cushion, bk.x, 0.03, bk.z, 1);
    g.add(cush);
    kit.shadow(bk.x, bk.z, ringR * 1.05, ringR * 1.05, 0.3);

    // ---- the Singing Kettle: a stove block, the kettle, its spout and handle ----
    const kt = spot(5), kd = PLACE.things[5], [sx, sy, sz] = [kd.size[0] * 2, kd.size[1] * 2, kd.size[2] * 2], kr = kd.p.kettleR ?? 0.22;
    B.add('stone', unitBox, stone, kt.x, sy / 2, kt.z, sx, sy, sz);
    g.add(kit.mesh(kit.sphere(kr, 20, 14), metal, kt.x, sy + kr * 0.85, kt.z, 2));
    const spout = kit.mesh(kit.cyl(0.025, 0.045, 0.2, 8), metal, kt.x + kr * 0.95, sy + kr * 0.95, kt.z, 2); spout.rotation.z = -0.9; g.add(spout);
    const handle = kit.mesh(kit.geo('khandle', () => new THREE.TorusGeometry(kr * 0.75, 0.018, 6, 20, Math.PI)), metal, kt.x, sy + kr * 1.55, kt.z, 2); g.add(handle);
    kit.shadow(kt.x, kt.z, sx * 0.7, sz * 0.7, 0.3);
    kit.shadow(h.x, h.z, fw * 0.6, fd * 0.8, 0.35);

    B.flush(kit, g);
    const sh = kit.shadowMesh(); if (sh) g.add(sh);

    // the kettle's steam puff when it whistles (thingFx 5): wisps out of the spout, normal blend
    const steam = kit.own(new Particles(40, 34, true)); g.add(steam.mesh);
    const spoutX = kt.x + kr * 1.05 + 0.08, spoutY = sy + kr * 1.05 + 0.06;
    const STM: [number, number, number] = [0.93, 0.92, 0.9];
    let puffK = 0, puffAcc = 0, fireK = 0, finale = 0, finaleNow = 0;
    const movers: (THREE.Object3D | null)[] = [null, board, ball, seat, null, null];
    let t = 0, q = false, rm = false;
    return {
      group: g, movers, moverKind: [0, 1, 1, 1, 0, 0], heat: [fireP[0], fireP[1], fireP[2]],
      update(dt, time, quiet, reduced, tier) {
        t += dt; q = quiet; rm = reduced;
        const m = reduced ? 0 : quiet ? 0.3 : 1;
        winU.uTime.value = t; winU.uMotion.value = m;
        fireU.uTime.value = t; fireU.uMotion.value = m;
        // the finale (a slow glow in Calm or with reduced motion: eased over 3 s, no extra embers) and the fire puff (0.7 s)
        finaleNow += (finale - finaleNow) * (1 - Math.exp(-dt * (quiet || reduced ? 0.7 : 2.5)));
        fireK = Math.max(0, fireK - dt / (quiet || reduced ? 2.0 : 0.7));
        const swell = 1 + 0.6 * finaleNow + 0.5 * fireK;
        fireU.uAmt.value = swell; glowU.uAmt.value = 0.85 + 0.15 * Math.sin(t * 5.3 * m) * Math.sin(t * 2.1 * m + 1) * m + 0.6 * finaleNow + 0.4 * fireK;
        embers.update(dt, time, quiet, reduced, tier, quiet || reduced ? 1 : 1 + 2.5 * finaleNow + 4 * fireK);
        if (puffK > 0 && !reduced) {
          puffAcc += dt * (puffK > 3.2 ? 40 : 6) * (quiet ? 0.3 : 1);
          while (puffAcc >= 1) { puffAcc -= 1; const r1 = embers.rnd(), r2 = embers.rnd(); steam.emit(sp(spoutX, spoutY, kt.z + (r1 - 0.5) * 0.04, 0.18 + 0.1 * r2, 0.25 + 0.2 * r1, (r2 - 0.5) * 0.08, 1.2 + 0.6 * r1, 0.05 + 0.04 * r2, STM, 0.4, 0.8)); }
        }
        puffK = Math.max(0, puffK - dt);
        steam.update(dt, time);
      },
      thingFx(thing, kind, amount) {
        if (kind === 2 && thing === -1) { finale = amount; return true; }
        if (kind !== 1) return false;
        if (thing === 5) { puffK = 3.6; puffAcc = 0; return true; }   // the whistle's bar: a burst, then a thin trail
        if (thing === 0) { fireK = Math.max(fireK, q || rm ? 0.5 : 1) * amount + (1 - amount) * fireK; return true; }
        return false;
      },
      dispose() { g.removeFromParent(); },
    };
  },
};
export default LOOK;
