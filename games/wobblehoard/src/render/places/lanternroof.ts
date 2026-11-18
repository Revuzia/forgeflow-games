// PLAYGROUND: Lanternroof's look (PLACES.md 4.8; PLAYGROUND_BUILD.md 9 and 13: one lazy chunk, at most 45 KB with PG_AUDIO's
// src/audio/places/lanternroof.ts and PG_DATA's src/data/place_lanternroof.ts). Round 6 (R6_RENDER, D-96). A flat rooftop terrace on a clear
// moonlit night: an ink sky with slowly twinkling stars (a card, never a flash), a big cream moon (the cool rim), the city far below in dusk
// (a street-light plane 14 m down and a skyline card), square terracotta roof tiles inside a plum stucco parapet (0.6 m on the back and the
// sides, 0.3 m at the front: the physics walls are 2.4 m, drawn low), the Lantern Line (five paper lanterns in amber and coral, the warm key;
// each glows brighter for 3 s when bumped, sways in the Night Breeze's gusts), the Vane Disc (a flush painted wind rose: physics builds no
// turntable, so it is drawn still), the Clothesline Hammock on two posts, the Chimney (it breathes warm air; its foot the warm nap patch),
// the Moon Dish (shallow water with the moon in it) and the Star Scope (tap: a slow comet crosses the sky, thingFx(5, 1)). Gust streaks
// drift through the Night Breeze while a gust blows (the zone's own clock until the shell drives it with thingFx(-1, 3, level)); the finale
// (thingFx(-1, 2)): the lanterns glow one by one in time with their song (Calm or reduced motion: all together, steady). BOTH layouts from
// the same kit, every position the data module's. Token colours only (place.ts tok()).
import * as THREE from 'three';
import { type PlaceLook, type PlaceBuilt, type PropKit, type PlaceLight, Emitter, Batch, tok, col, sp, yawQ, UV_VERT } from '../place.ts';
import type { PanelDef } from '../env.ts';
import PLACE from '../../data/place_lanternroof.ts';

/** The physics chime rail (props.ts CHIME_RAIL_Y): each lantern hangs `hang` below it. */
const RAIL_Y = 0.95;
/** The drawn parapet heights (PLACES 4.8: 0.6 m back and sides, 0.3 m front) and thickness (the walls' own). */
const PARA_H = 0.6, PARA_FRONT = 0.3;
/** The moon's direction (azimuth right of -z, elevation; radians) and angular radius. The place camera looks 8.6 degrees down from far back
 *  with a long lens, so a frame's top edge lies at -1.1 (desktop) to +8.9 (phone) degrees: the moon sits just above the far skyline, low
 *  enough for every frame (under a desktop's top HUD row, inside a phone's right column). The backdrop draws it at infinity: it stays put
 *  in the sky when the player orbits. */
const MOON_AZ = 0.07, MOON_EL = -0.0803, MOON_R = 0.0218;

// the roof: square terracotta tiles (0.33 m) with grout, a per-tile tone, worn edges, a little dark moss in the grout near the parapet
const TILES = /* glsl */`
  vec2 p = vWP.xz / 0.33;
  float fw = max(length(fwidth(p)), 1e-5);
  vec2 id = floor(p), f = fract(p);
  float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float grout = 1.0 - smoothstep(0.035, 0.035 + max(0.02, fw * 1.4), e);
  float h = pH(id), n = pFbm(vWP.xz * 3.3);
  vec3 c = mix(uTileA, uTileB, h) * (0.86 + 0.22 * n) * (0.92 + 0.1 * smoothstep(0.1, 0.45, e));
  c = mix(c, uGrout, grout * (1.0 - smoothstep(0.08, 0.3, fw)) * 0.85);
  float edge = smoothstep(uIn.x - 0.5, uIn.x, abs(vWP.x)) + smoothstep(uIn.y - 0.5, uIn.y, abs(vWP.z));
  c = mix(c, uMoss, grout * min(1.0, edge) * 0.6);
  diffuseColor.rgb = c;
`;
// the lower roof around the terrace: dark zinc in standing seams running toward the camera, a little sheen variation
const ZINC = /* glsl */`
  vec2 p = vWP.xz;
  float fw = max(length(fwidth(p)), 1e-5);
  float u = fract(p.x / 0.48);
  float seam = 1.0 - smoothstep(0.0, max(0.01, fw * 1.4), min(u, 1.0 - u) * 0.48 - 0.012);
  float near = smoothstep(uFront + 0.8, uFront + 5.5, p.y);   // (round 6: it falls into shadow toward the camera: the eye stays on the terrace)
  diffuseColor.rgb = uZinc * (0.9 + 0.14 * pFbm(p * vec2(0.6, 2.2) + floor(p.x / 0.48) * 3.0)) * (1.0 + 0.35 * seam * (1.0 - smoothstep(0.02, 0.06, fw))) * (1.0 - 0.75 * near);
`;
// stucco with a faint brick course under it (the parapet and the chimney)
const BRICK = /* glsl */`
  vec3 q = vWP;
  float row = floor(q.y / 0.075);
  float u = (abs(uAx) > 0.5 ? q.z : q.x) / 0.21 + 0.5 * mod(row, 2.0);
  float fw = max(length(fwidth(q.xy + q.zy)), 1e-5);
  float jy = 1.0 - smoothstep(0.0, max(0.006, fw), min(fract(q.y / 0.075), 1.0 - fract(q.y / 0.075)) * 0.075);
  float jx = 1.0 - smoothstep(0.0, max(0.006, fw), min(fract(u), 1.0 - fract(u)) * 0.21);
  float b = pH(vec2(floor(u), row));
  vec3 c = uBr * (0.85 + 0.25 * b) * (0.9 + 0.15 * pFbm(q.xz * 6.0 + q.y * 4.0));
  diffuseColor.rgb = mix(c, uJoint, max(jx, jy) * 0.55 * (1.0 - smoothstep(0.01, 0.03, fw)));
`;
// the night sky behind everything (a card 110 m out, drawn by direction like a sky at infinity): the city's warm glow low down, deep dusk
// blue above it, ink higher up; stars twinkling slowly (amplitude 0.25 at 0.2 to 0.6 Hz: never a flash) and the big cream moon with its
// grey-lagoon seas and a wide faint halo; no star over the moon
const BACKDROP = /* glsl */`
void main() {
  vec3 d = normalize(vWP - cameraPosition);
  float el = asin(clamp(d.y, -1.0, 1.0)), az = atan(d.x, -d.z);
  vec3 c = mix(uGlow, uDeep, smoothstep(-0.135, -0.075, el));
  c = mix(c, uInk, smoothstep(-0.06, 0.22, el));
  ${/* (round 6: by the az / el difference, not acos of a dot: acos near 1 is coarse on some GPUs and blurred the disc into a smudge) */ ''}
  vec2 mq = vec2((az - uMoon.x) * cos(uMoon.y), el - uMoon.y) / uMoon.z;
  float r = length(mq);
  vec2 st = vec2(az, el) * 260.0, i = floor(st), f = fract(st) - 0.5 - (vec2(pH(i + 1.0), pH(i + 2.0)) - 0.5) * 0.6;
  float h = pH(i), sr = 0.06 + 0.08 * pH(i + 3.0);
  float star = step(0.955, h) * (1.0 - smoothstep(sr * 0.35, sr, length(f))) + step(0.995, h) * (1.0 - smoothstep(0.0, 0.3, length(f))) * 0.4;
  float tw = 0.75 + 0.25 * sin(uTime * uMotion * (1.2 + 2.6 * pH(i + 5.0)) + h * 40.0);
  c += uStar * star * tw * smoothstep(1.5, 2.2, r) * smoothstep(-0.085, -0.05, el);
  float disc = 1.0 - smoothstep(0.97, 1.03, r);
  float sea = smoothstep(0.45, 0.75, pFbm(mq * 1.4 + 3.1)) * 0.28 + smoothstep(0.6, 0.85, pN(mq * 3.2)) * 0.12;
  vec3 moon = mix(uMoonC, uSea, sea) * (0.9 + 0.1 * sqrt(max(0.0, 1.0 - r * r)));
  c = mix(c, moon, disc) + uHalo * (exp(-max(0.0, r - 1.0) * 1.3) * 0.22 + exp(-max(0.0, r - 1.0) * 5.0) * 0.2) * (1.0 - disc);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
// the far skyline: flat-topped towers and a few spires in dusk, rows of lit windows, haze toward their feet (the city glow below)
const SKYLINE = /* glsl */`
void main() {
  vec3 c = vec3(0.0); float a = 0.0;
  for (int l = 0; l < 2; l++) {
    float fl = float(l), sc = 26.0 + fl * 18.0;
    float x = vUv.x * sc + fl * 5.3, i = floor(x), f = fract(x);
    float hgt = (0.74 + 0.08 * pH(vec2(i, fl)) + 0.05 * step(0.8, pH(vec2(i, fl + 9.0)))) - fl * 0.04;
    float spire = step(0.93, pH(vec2(i, fl + 4.0))) * step(abs(f - 0.5), 0.05) * step(vUv.y, hgt + 0.04);
    float gap = step(0.08, f) * step(f, 0.94);
    if (a < 0.5 && (vUv.y < hgt * (0.97 + 0.03 * gap) || spire > 0.5)) {
      vec3 m = mix(uNear, uFar, fl);
      vec2 wq = vec2(f * 8.0, vUv.y * 60.0), wid = floor(wq);
      float lit = step(0.82, pH(wid + vec2(i * 13.0, fl * 7.0))) * step(0.25, fract(wq.x)) * step(fract(wq.x), 0.75) * step(0.3, fract(wq.y)) * step(fract(wq.y), 0.8);
      m += uWin * lit * (0.55 + 0.45 * pH(wid + 3.0)) * (1.0 - 0.5 * fl) * step(vUv.y, hgt - 0.01);
      c = m; a = 1.0;
    }
  }
  if (a < 0.5) discard;
  c = mix(c, uHaze, (1.0 - smoothstep(0.45, 0.7, vUv.y)) * 0.6);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
// the comet (the Star Scope's): a soft head and a long faint tail across the sky (additive; uK is its 0..1 fade in and out over 6 s)
const COMET = /* glsl */`
void main() {
  vec2 q = vUv - uHead.xy;
  vec2 dv = normalize(vec2(1.0, -0.65));
  float along = dot(q, dv), side = dot(q, vec2(-dv.y, dv.x));
  float tail = (1.0 - smoothstep(0.0, 0.22, -along)) * step(along, 0.0) * exp(-side * side * 9000.0 / (1.0 - along * 3.0));
  float head = exp(-dot(q * vec2(1.0, 3.0), q * vec2(1.0, 3.0)) * 9000.0);
  gl_FragColor = vec4(uCol * (head * 1.2 + tail * 0.55) * uK, 1.0);
  #include <colorspace_fragment>
}`;
// the paper lanterns (instanced, unlit: light through paper): amber or coral, brighter where the paper faces the eye, eight ribs, a hot core
const LANT_VERT = /* glsl */`
attribute float aGlow; attribute float aTone;
varying vec2 vUv; varying float vG, vT; varying vec3 vN, vV;
void main() {
  vUv = uv; vG = aGlow; vT = aTone;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const LANT_FRAG = /* glsl */`
varying vec2 vUv; varying float vG, vT; varying vec3 vN, vV;
uniform vec3 uA, uB, uHot;
void main() {
  float face = clamp(dot(normalize(vN), vV), 0.0, 1.0);
  float rib = 1.0 - smoothstep(0.0, 0.06, abs(fract(vUv.y * 8.0) - 0.5) - 0.38);
  vec3 c = mix(uA, uB, vT) * (0.32 + 0.68 * face) * (1.0 - 0.35 * rib);
  c += uHot * pow(face, 3.0) * (0.55 + 0.75 * vG);
  gl_FragColor = vec4(c * (1.05 + 0.75 * vG), 1.0);
  #include <colorspace_fragment>
}`;
// a soft camera-facing glow around each lantern (instanced billboards, additive)
const HALO_VERT = /* glsl */`
attribute float aGlow; varying vec2 vQ; varying float vG;
uniform float uSize;
void main() {
  vQ = position.xy; vG = aGlow;
  vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += position.xy * uSize;
  gl_Position = projectionMatrix * c;
}`;
const HALO_FRAG = /* glsl */`
varying vec2 vQ; varying float vG; uniform vec3 uCol;
void main() { float r = length(vQ); gl_FragColor = vec4(uCol * (exp(-r * r * 5.0) * 0.8 + exp(-r * r * 18.0) * 0.5) * (0.42 + 0.58 * vG) * (1.0 - smoothstep(0.8, 1.0, r)), 1.0); }`;
// a soft additive pool of light on the tiles (under the lanterns; the chimney's warm foot)
const POOL_FRAG = 'varying vec2 vUv; uniform float uAmt; uniform vec3 uCol; void main(){ vec2 q = vUv * 2.0 - 1.0; float r = length(q); float a = (1.0 - smoothstep(0.0, 1.0, r)); gl_FragColor = vec4(uCol * a * a * uAmt, 1.0); }';
// the Vane Disc: a painted steel wind rose (a ring, an eight-point star, the cardinal points longer) on a dark disc
const VANE = /* glsl */`
  vec2 p = vLP / uR;
  float r = length(p), a = atan(p.y, p.x);
  float fw = max(fwidth(r), 1e-4);
  float ring = (1.0 - smoothstep(0.0, fw * 1.5, abs(r - 0.86) - 0.025)) + (1.0 - smoothstep(0.0, fw * 1.5, abs(r - 0.97) - 0.012));
  float k = abs(cos(a * 4.0)), k2 = abs(cos(a * 2.0));
  float star = 1.0 - smoothstep(-fw * 2.0, fw * 2.0, r - mix(0.22, mix(0.55, 0.8, step(0.5, k2)), pow(k, 6.0)));
  float half1 = step(0.0, sin(a * 8.0));
  vec3 c = mix(uPlate, uPaint, max(min(1.0, ring), 0.0));
  c = mix(c, mix(uPaint, uPaint2, half1), star);
  c *= 0.9 + 0.1 * pFbm(vLP * 9.0);
  diffuseColor.rgb = c;
`;
// the hammock's striped cloth (along the seat)
const STRIPES = /* glsl */`
  float s = step(0.5, fract(vLP.y * 6.5));
  diffuseColor.rgb = mix(uS1, uS2, s) * (0.92 + 0.08 * sin(vLP.x * 40.0 + vLP.z * 40.0));
`;

const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const;

const LOOK: PlaceLook = {
  id: 'lanternroof',
  ceremonyDim: PLACE.ceremonyDim,
  skyBand: tok('dusk', 'ink', 0.45, 0.95),
  sky: {
    // (round 6, first shots: a plum-coral horizon filled the low sky with magenta; the backdrop card covers every frame's sky now, these match it)
    uZenith: tok('ink', 'ink', 0, 0.72), uInk: tok('ink', 'dusk', 0.15), uPlum: tok('ink', 'dusk', 0.4, 0.9), uHorizon: tok('dusk', 'ink', 0.35, 0.85),
    uGlowWarm: tok('coral', 'dusk', 0.5, 0.18), uGlowCool: tok('lagoon', 'dusk', 0.4, 0.1), uBase: tok('ink', 'dusk', 0.3, 0.8), uWarm: tok('amber', 'amber', 0, 0.02),
    uFogNear: 14, uFogFar: 60,
  },
  light(layout: 0 | 1): PlaceLight {
    const L = layout === 0 ? PLACE.things[0] : PLACE.tall.things[0];
    return {
      // the lanterns' warm light, from above the line, spread wide over the terrace; the moon's cool rim from the back right
      key: tok('amber', 'coral', 0.22), keyI: 150, keyPos: [L.x + 0.4, 2.3, L.z + 1.6], keyAim: [0.4, 0, 1.0], keyAngle: 1.35,
      rim: tok('cream', 'lagoon', 0.35), rimI: 3.0, rimDir: [0.25, 0.45, -0.86],
      fillSky: tok('dusk', 'lagoon', 0.35, 0.85), fillGround: tok('plum', 'amber', 0.35, 0.75), fillI: 5.5,
      keyTint: [1.0, 0.7, 0.42],
    };
  },
  panels: [
    { dir: new THREE.Vector3(-0.6, 0.35, -0.72).normalize(), dist: 4.5, w: 3.0, h: 0.8, color: [1.0, 0.62, 0.3], k: 5.0, soft: 0.5, radius: 0.4 },     // the lantern line, warm
    { dir: new THREE.Vector3(0.45, 0.55, -0.7).normalize(), dist: 4.5, w: 1.0, h: 1.0, color: [0.86, 0.9, 1.0], k: 9.0, soft: 0.25, radius: 0.5 },     // the moon
    { dir: new THREE.Vector3(0.05, 1, 0.15).normalize(), dist: 4.5, w: 4.0, h: 1.4, color: [0.32, 0.26, 0.62], k: 1.6, soft: 0.6, radius: 0.6 },      // the night sky
    { dir: new THREE.Vector3(0.4, 0.1, 0.9).normalize(), dist: 4.5, w: 3.0, h: 1.2, color: [0.95, 0.62, 0.4], k: 1.1, soft: 0.9, radius: 0.8 },       // the city glow, low in front
  ] satisfies PanelDef[],

  build(kit: PropKit, layout: 0 | 1): PlaceBuilt {
    const tall = layout === 1, T = PLACE.tall;
    const g = new THREE.Group(); g.name = `lanternroof-${tall ? 'tall' : 'wide'}`;
    const B = new Batch();
    const th = (i: number): { x: number; z: number; yaw: number } => (tall ? T.things[i] : PLACE.things[i]);
    const zn = (i: number): { x: number; z: number; r?: number; hx?: number; hz?: number } => (tall ? T.zones[i] : PLACE.zones[i]);
    const walls = tall ? T.walls : PLACE.walls, bounds = tall ? T.bounds : PLACE.bounds;
    // the parapet's outer rectangle
    let ox = 0, oz0 = 0, oz1 = 0;
    for (const w of walls) { ox = Math.max(ox, Math.abs(w.x) + (w.hx ?? 0)); oz0 = Math.min(oz0, w.z - (w.hz ?? 0)); oz1 = Math.max(oz1, w.z + (w.hz ?? 0)); }
    const ocz = (oz0 + oz1) / 2, ohz = (oz1 - oz0) / 2;
    // ---- materials ----
    const tileU = { uTileA: { value: col(tok('coral', 'plum', 0.42, 0.78)) }, uTileB: { value: col(tok('amber', 'coral', 0.6, 0.62)) }, uGrout: { value: col(tok('ink', 'plum', 0.5, 0.9)) },
      uMoss: { value: col(tok('lagoon', 'ink', 0.6, 0.9)) }, uIn: { value: new THREE.Vector4(ox - 0.3, Math.max(-oz0, oz1) - 0.3, 0, 0) } };
    const tiles = kit.surface('tiles', [1, 1, 1], 0.85, TILES, tileU, 0.25);
    const brU = (ax: number) => ({ uBr: { value: col(tok('plum', 'dusk', 0.3, 1.25)) }, uJoint: { value: col(tok('ink', 'plum', 0.4, 0.9)) }, uAx: { value: ax } });
    const brickX = kit.surface('brickX', [1, 1, 1], 0.92, BRICK, brU(0), 0.2), brickZ = kit.surface('brickZ', [1, 1, 1], 0.92, BRICK, brU(1), 0.2);
    const railM = kit.mat('rail', tok('ink', 'dusk', 0.3, 1.0), 0.45, 0.6);
    const coping = kit.mat('coping', tok('cream', 'dusk', 0.55, 0.78), 0.8, 0.3), facade = kit.mat('facade', tok('ink', 'dusk', 0.4, 0.9), 0.95, 0.1);
    const wood = kit.mat('wood', tok('amber', 'cream', 0.45, 0.42), 0.8, 0.2), cord = kit.mat('cord', tok('cream', 'dusk', 0.35, 0.75), 0.9, 0.1);
    const capM = kit.mat('lcap', tok('ink', 'plum', 0.3, 1.1), 0.6, 0.3), brass = kit.mat('brass', tok('amber', 'cream', 0.35, 0.95), 0.3, 0.9);
    const ceramic = kit.mat('dish', tok('cream', 'dusk', 0.45, 0.85), 0.35, 0.6), pot = kit.mat('pot', tok('coral', 'amber', 0.45, 0.6), 0.85, 0.2);
    const leaf = kit.mat('leaf', tok('lagoon', 'ink', 0.55, 1.0), 0.8, 0.25), cloth = kit.mat('cloth', tok('lagoon', 'cream', 0.4, 0.9), 0.95, 0.1);
    const unitBox = kit.box(1, 1, 1), unitCyl = kit.cyl(1, 1, 1, 12), unitCylX = kit.geo('cylX', () => new THREE.CylinderGeometry(1, 1, 1, 12).rotateZ(Math.PI / 2));

    // ---- the terrace (tiles inside the parapet) on a bigger roof (zinc: the place camera sees 6 to 9 m of floor in front of the front
    // parapet), the night sky behind everything (the moon, the stars, the city glow), the far skyline ----
    // (round 6, first shots: the roof ended at the parapet and the frame's lower third looked down a black facade)
    g.add(kit.mesh(kit.geo(`roof${ox},${ohz}`, () => new THREE.PlaneGeometry(2 * ox, 2 * ohz).rotateX(-Math.PI / 2)), tiles, 0, 0, ocz, -50));
    const zinc = kit.surface('zinc', [1, 1, 1], 0.92, ZINC, { uZinc: { value: col(tok('ink', 'dusk', 0.5, 0.72)) }, uFront: { value: oz1 } }, 0.05);
    // (only in front of and beside the terrace, never under it: a deck under the tiles z-fought them when a ceremony moved the camera,
    // 14 dark-floor flickers in a second, RD-03's flash row)
    const outW = 2 * ox + 16, outD = 14;
    g.add(kit.mesh(kit.geo(`deck${ox}`, () => new THREE.PlaneGeometry(outW, outD).rotateX(-Math.PI / 2)), zinc, 0, -0.012, oz1 + outD / 2, -51));
    const skyU = { uNear: { value: col(tok('ink', 'dusk', 0.35, 0.85)) }, uFar: { value: col(tok('dusk', 'ink', 0.4, 0.8)) }, uWin: { value: col(tok('amber', 'cream', 0.35, 0.75)) }, uHaze: { value: col(tok('dusk', 'coral', 0.35, 0.62)) } };
    g.add(kit.card(SKYLINE, skyU, 220, 21, 0, -13.5, -70, 0, -75));
    const bdU = { uGlow: { value: col(tok('dusk', 'coral', 0.4, 0.62)) }, uDeep: { value: col(tok('dusk', 'ink', 0.55, 0.85)) }, uInk: { value: col(tok('ink', 'ink', 0, 0.8)) },
      uStar: { value: col(tok('cream', 'lagoon', 0.2, 1.0)) }, uMoon: { value: new THREE.Vector3(MOON_AZ, MOON_EL, MOON_R) },
      uMoonC: { value: col(tok('cream', 'cream', 0, 0.98)) }, uSea: { value: col(tok('cream', 'lagoon', 0.35, 0.74)) }, uHalo: { value: col(tok('cream', 'lagoon', 0.35, 0.55)) } };
    const backdrop = kit.card(BACKDROP, bdU, 320, 80, 0, 13, -110, 0, -80);
    g.add(backdrop);
    const cometU = { uHead: { value: new THREE.Vector4(0, 0, 0, 0) }, uCol: { value: col(tok('cream', 'lagoon', 0.3, 1.0)) }, uK: { value: 0 } };
    const cometMat = new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: `varying vec2 vUv; varying vec3 vWP; uniform vec4 uHead; uniform vec3 uCol; uniform float uK;\n${COMET}`, uniforms: cometU, toneMapped: false, transparent: true, depthWrite: false, ...ADD });
    const comet = kit.mesh(kit.geo('comet', () => new THREE.PlaneGeometry(60, 26)), kit.own(cometMat), 0, 0.5, -100, -76); comet.visible = false; g.add(comet);

    // ---- the parapet (stucco over brick: 0.6 m back and sides, 0.3 m front) with a pale coping ----
    // (round 6, first shots: the place camera looks only 8.6 degrees down, so a solid 0.3 m front wall hid 2 m of floor behind it and the
    // front bodies' feet: the front is a low curb under an open iron rail at 0.3 m, which hides almost nothing)
    for (const w of walls) {
      const hx = w.hx ?? 0.15, hz = w.hz ?? 0.15, front = w.z > 0 && hx > hz, hgt = front ? 0.07 : PARA_H;
      B.add(hx > hz ? 'brickX' : 'brickZ', unitBox, hx > hz ? brickX : brickZ, w.x, hgt / 2, w.z, 2 * hx, hgt, 2 * hz);
      B.add('coping', unitBox, coping, w.x, hgt + 0.015, w.z, 2 * hx + 0.04, 0.03, 2 * hz + 0.04);
      if (front) {
        B.add('rail', unitCylX, railM, w.x, PARA_FRONT, w.z, 2 * hx, 0.016, 0.016);
        B.add('rail', unitCylX, railM, w.x, PARA_FRONT * 0.55, w.z, 2 * hx, 0.008, 0.008);
        for (let k = 0, nP = Math.round((2 * hx) / 0.45); k <= nP; k++) B.add('rail', unitCyl, railM, w.x - hx + (2 * hx * k) / nP, (PARA_FRONT + 0.07) / 2, w.z, 0.011, PARA_FRONT - 0.07, 0.011);
      }
    }
    // potted plants on the back parapet's coping (silhouettes against the sky)
    const back = walls.find((w) => w.z < 0 && (w.hx ?? 0) > (w.hz ?? 0))!;
    for (const fx of tall ? [-0.7, 0.85] : [-0.55, 0.12, 0.82]) {
      const x = fx * (back.hx ?? 3), y0 = PARA_H + 0.05;
      B.add('pot', unitCyl, pot, x, y0 + 0.09, back.z, 0.12, 0.18, 0.12);
      for (let k = 0; k < 4; k++) B.add('leaf', kit.geo('ico1', () => new THREE.IcosahedronGeometry(1, 1)), leaf, x + Math.cos(k * 1.9 + x) * 0.07, y0 + 0.24 + 0.05 * (k % 2), back.z + Math.sin(k * 1.9 + x) * 0.05, 0.11, 0.13, 0.11);
    }

    // ---- the Lantern Line: two posts and the line at the rail, five paper lanterns hanging from it (movers: one per part) ----
    const ll = th(0), ld = PLACE.things[0], n = ld.p.n ?? 5, span = ld.p.span ?? 2, hang = ld.p.hang ?? 0.55;
    const lx = Math.cos(ll.yaw), lz = Math.sin(ll.yaw), half = span / 2 + 0.25;
    for (const s of [-1, 1]) B.add('wood', unitCyl, wood, ll.x + lx * half * s, (RAIL_Y + 0.12) / 2, ll.z + lz * half * s, 0.035, RAIL_Y + 0.12, 0.035);
    B.add('cord', unitCylX, cord, ll.x, RAIL_Y, ll.z, 2 * half, 0.006, 0.006, yawQ(-ll.yaw));
    kit.shadow(ll.x, ll.z, Math.abs(lx) * half + 0.25, Math.abs(lz) * half + 0.25, 0.22);
    const LS = [ld.size[0] * 1.12, ld.size[1] * 1.06, ld.size[2] * 1.12];   // the paper (about the collider box, rounded)
    const lantern: THREE.Object3D[] = [];
    for (let k = 0; k < n; k++) {
      const o = (n > 1 ? k / (n - 1) - 0.5 : 0) * span, m = new THREE.Object3D();
      m.position.set(ll.x + lx * o, RAIL_Y - hang, ll.z + lz * o); m.quaternion.copy(yawQ(-ll.yaw));
      lantern.push(m);
    }
    const lGlow = new Float32Array(n), lTone = new Float32Array(n).map((_, k) => (k % 2 ? 1 : 0.15 + 0.1 * k));
    const lantU = { uA: { value: col(tok('amber', 'cream', 0.15, 1.0)) }, uB: { value: col(tok('coral', 'amber', 0.12, 0.92)) }, uHot: { value: col(tok('cream', 'amber', 0.3, 1.0)) } };
    const lantMat = kit.own(new THREE.ShaderMaterial({ vertexShader: LANT_VERT, fragmentShader: LANT_FRAG, uniforms: lantU, toneMapped: false }));
    const lgeo = kit.geo('lantern', () => new THREE.SphereGeometry(1, 16, 12));
    const gA = new THREE.InstancedBufferAttribute(lGlow, 1).setUsage(THREE.DynamicDrawUsage);
    lgeo.setAttribute('aGlow', gA); lgeo.setAttribute('aTone', new THREE.InstancedBufferAttribute(lTone, 1));
    const lBody = kit.instanced(lgeo, lantMat, lantern.map(() => new THREE.Matrix4()), 3);
    const lCap = kit.instanced(kit.cyl(1, 1, 1, 12), capM, [...lantern, ...lantern].map(() => new THREE.Matrix4()), 3);
    const lStr = kit.instanced(kit.cyl(1, 1, 1, 4), cord, lantern.map(() => new THREE.Matrix4()), 3);
    const haloU = { uSize: { value: 0.42 }, uCol: { value: col(tok('amber', 'coral', 0.3, 0.9)) } };
    const halo = kit.instanced(kit.geo('halo', () => { const q = new THREE.PlaneGeometry(2, 2); q.setAttribute('aGlow', gA); return q; }),
      kit.own(new THREE.ShaderMaterial({ vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, uniforms: haloU, toneMapped: false, transparent: true, depthWrite: false, ...ADD })), lantern.map(() => new THREE.Matrix4()), 40);
    g.add(lBody, lCap, lStr, halo);
    const pool = (key: string, w: number, d: number, x: number, z: number, c: THREE.Color): { value: number } => {
      const u = { uAmt: { value: 1 }, uCol: { value: c } };
      const m = kit.own(new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: POOL_FRAG, uniforms: u, toneMapped: false, depthWrite: false, ...ADD }));
      const msh = kit.mesh(kit.geo(key, () => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)), m, x, 0.006, z, -45); g.add(msh);
      return u.uAmt;
    };
    const lPool = pool('lpool', 2 * half + 1.6, 2.2, ll.x, ll.z + 0.35, col(tok('amber', 'coral', 0.3, 0.42)));

    // ---- the Vane Disc: a flush painted wind rose (no prop: drawn still) ----
    const vd = th(1), vr = PLACE.things[1].size[0];
    const vaneU = { uR: { value: vr }, uPlate: { value: col(tok('ink', 'dusk', 0.45, 1.0)) }, uPaint: { value: col(tok('cream', 'amber', 0.3, 0.85)) }, uPaint2: { value: col(tok('coral', 'amber', 0.3, 0.85)) } };
    const vane = kit.mesh(kit.geo(`vane${vr}`, () => new THREE.CircleGeometry(vr, 48)), kit.local('vane', [1, 1, 1], 0.4, VANE.replace(/vLP/g, 'vLP.xy'), vaneU, 0.7), vd.x, 0.005, vd.z, -47);
    vane.rotation.x = -Math.PI / 2; g.add(vane);

    // ---- the Clothesline Hammock: two posts, the line at the pivot, a striped cloth seat on two ropes (a mover: the seat) ----
    const hm = th(2), hd = PLACE.things[2], ropeL = hd.p.rope ?? 1.3, pivY = hd.p.pivotY ?? 1.52, seatR = hd.size[0], seatL = hd.size[1];
    const ax = -Math.sin(hm.yaw), az = Math.cos(hm.yaw), pH2 = seatL / 2 + 0.38;   // the hinge axis (across the travel): local z turned by the yaw
    for (const s of [-1, 1]) B.add('wood', unitCyl, wood, hm.x + ax * pH2 * s, (pivY + 0.1) / 2, hm.z + az * pH2 * s, 0.04, pivY + 0.1, 0.04);
    B.add('cord', unitCylX, cord, hm.x, pivY + 0.02, hm.z, 2 * pH2, 0.008, 0.008, yawQ(-hm.yaw - Math.PI / 2));
    for (const [s, w, hh] of [[-1, 0.2, 0.24], [1, 0.16, 0.2]] as const) {   // two cloths pegged on the line beyond the ropes
      const d = seatL / 2 + 0.16;
      B.add('cloth', kit.geo('clothq', () => new THREE.PlaneGeometry(1, 1)), cloth, hm.x + ax * d * s, pivY - hh / 2, hm.z + az * d * s, w, hh, 1, yawQ(-hm.yaw), 4);
    }
    cloth.side = THREE.DoubleSide;
    const seat = new THREE.Group(); seat.position.set(hm.x, pivY - ropeL, hm.z); seat.rotation.y = -hm.yaw;
    const stU = { uS1: { value: col(tok('coral', 'amber', 0.2, 0.92)) }, uS2: { value: col(tok('cream', 'amber', 0.2, 0.92)) } };
    const seatMesh = kit.mesh(kit.capsule(seatR, seatL), kit.local('hammock', [1, 1, 1], 0.95, STRIPES, stU, 0.15), 0, 0, 0, 2); seatMesh.rotation.x = Math.PI / 2; seat.add(seatMesh);
    for (const side of [-1, 1]) {
      const o = side * (seatL / 2 - 0.04), len = Math.hypot(o, ropeL);
      const r = kit.mesh(kit.cyl(0.01, 0.01, len, 6), cord, 0, ropeL / 2, o / 2, 2); r.rotation.x = Math.atan2(-o, ropeL); seat.add(r);
    }
    g.add(seat);
    kit.shadow(hm.x, hm.z, Math.abs(az) * seatL * 0.6 + 0.2, Math.abs(ax) * seatL * 0.6 + 0.2, 0.3);

    // ---- the Chimney: brick under a slab cap, two pots breathing warm air; its foot the warm nap patch ----
    const ch = th(3), cd = PLACE.things[3], [cw, chH, cdp] = [cd.size[0] * 2, cd.size[1] * 2, cd.size[2] * 2];
    B.add('brickZ', unitBox, brickZ, ch.x, chH / 2, ch.z, cw, chH, cdp);
    B.add('coping', unitBox, coping, ch.x, chH + 0.03, ch.z, cw + 0.12, 0.06, cdp + 0.12);
    const pots: [number, number][] = [[-0.12, -0.05], [0.13, 0.08]];
    for (const [px, pz] of pots) B.add('pot', unitCyl, pot, ch.x + px, chH + 0.06 + 0.11, ch.z + pz, 0.085, 0.22, 0.085);
    kit.shadow(ch.x, ch.z, cw * 0.75, cdp * 0.75, 0.4);
    const patch = tall ? T.patches[0] : PLACE.patches[0];
    const warmPool = pool('wpool', 2 * (patch.r ?? 0.9) * 1.3, 2 * (patch.r ?? 0.9) * 1.3, patch.x, patch.z, col(tok('amber', 'coral', 0.35, 0.3)));
    const AIR: [number, number, number] = [0.96, 0.86, 0.74];
    let breath = 0;
    const air = new Emitter([16, 12, 6], true, (p, r) => {
      const [px, pz] = pots[r() < 0.5 ? 0 : 1];
      p.emit(sp(ch.x + px + (r() - 0.5) * 0.05, chH + 0.3, ch.z + pz + (r() - 0.5) * 0.05, (r() - 0.5) * 0.04, 0.22 + 0.1 * r(), (r() - 0.5) * 0.04, 2.4 + r(), 0.09 + 0.06 * r(), AIR, 0.16, 0.25));
    }, 3);
    g.add(air.particles.mesh); kit.own(air);

    // ---- the Moon Dish: a shallow glazed dish of water with the moon in it ----
    const mz = zn(2), mr = mz.r ?? 0.6;
    g.add(kit.mesh(kit.geo(`dishrim${mr}`, () => new THREE.TorusGeometry(mr, 0.055, 8, 40).rotateX(Math.PI / 2)), ceramic, mz.x, 0.045, mz.z, 2));
    g.add(kit.mesh(kit.cyl(mr, mr * 0.92, 0.04, 32), ceramic, mz.x, 0.02, mz.z, 1));
    const water = kit.water('disc', mz.x, mz.z, mr, 0, 0, 0.062, tok('ink', 'dusk', 0.4, 0.9), tok('dusk', 'lagoon', 0.3, 0.8), tok('cream', 'lagoon', 0.35, 0.7), tok('cream'), 0, 0.6);
    g.add(water.mesh);
    // the moon's reflection: a soft cream ellipse on the water toward the moon
    const glintU = { uAmt: { value: 0.55 }, uCol: { value: col(tok('cream', 'lagoon', 0.25, 0.8)) } };
    const glint = kit.mesh(kit.geo('glint', () => new THREE.PlaneGeometry(0.34, 0.5).rotateX(-Math.PI / 2)), kit.own(new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: POOL_FRAG, uniforms: glintU, toneMapped: false, depthWrite: false, ...ADD })), mz.x + 0.16, 0.064, mz.z - 0.18, 10);
    glint.rotation.y = 0.5; g.add(glint);
    kit.shadow(mz.x, mz.z, mr + 0.1, mr + 0.1, 0.3);

    // ---- the Star Scope: a small wooden stand, a brass telescope aimed at the sky (0.4 m in all: it stands in the front band) ----
    const ss = th(5), sd = PLACE.things[5], sH = sd.size[1] * 2;
    // (round 6, first shots: a box and a thin tube read as a stick: a tripod of three splayed legs under a fat brass tube with a lens ring)
    const legH = sH * 0.6;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4, lean = 0.32;
      B.add('wood', unitCyl, wood, ss.x + Math.cos(a) * Math.sin(lean) * legH * 0.5, legH * 0.5 * Math.cos(lean), ss.z + Math.sin(a) * Math.sin(lean) * legH * 0.5, 0.014, legH / Math.cos(lean) * 0.98, 0.014,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), lean));
    }
    const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.85, 0.45, 0, 'YXZ')), td = new THREE.Vector3(0, 1, 0).applyQuaternion(tq);
    const tc = new THREE.Vector3(ss.x, legH + 0.06, ss.z);
    B.add('brass', unitCyl, brass, tc.x, tc.y, tc.z, 0.05, 0.34, 0.05, tq);
    B.add('lcap', unitCyl, capM, tc.x + td.x * 0.16, tc.y + td.y * 0.16, tc.z + td.z * 0.16, 0.06, 0.04, 0.06, tq);   // the lens ring
    B.add('lcap', unitCyl, capM, tc.x - td.x * 0.19, tc.y - td.y * 0.19, tc.z - td.z * 0.19, 0.022, 0.06, 0.022, tq);   // the eyepiece
    kit.shadow(ss.x, ss.z, 0.25, 0.25, 0.35);

    B.flush(kit, g);
    const shm = kit.shadowMesh(); if (shm) g.add(shm);

    // ---- the Night Breeze: gust streaks through its zone while a gust blows ----
    const wz = zn(0), W = PLACE.zones[0], gd = W.gust ?? { everyS: [6, 10], forS: 2.5 };
    const fl = tall ? [0, 1] : [-1, 0];   // physics' own flow: from the zone's centre toward the play area's middle (props.ts)
    const STK: [number, number, number] = [0.86, 0.84, 0.95];
    let gust = 0;
    const streaks = new Emitter([14, 10, 5], true, (p, r) => {
      const x = wz.x + (r() - 0.5) * 2 * (wz.hx ?? 1), z = wz.z + (r() - 0.5) * 2 * (wz.hz ?? 1), v = 1.8 + r();
      p.emit(sp(x - fl[0] * 0.6, 0.25 + r() * 1.1, z - fl[1] * 0.6, fl[0] * v, 0.05 * (r() - 0.5), fl[1] * v, 0.7 + 0.3 * r(), 0.012, STK, 0.22, 0, 0, 2, 1));
    }, 14);
    g.add(streaks.particles.mesh); kit.own(streaks);
    let seed = 0x51ab, nextGust = 4, gustEnd = 0, driven = false;
    const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };

    // the lanterns' local parts: the paper, the caps (top and bottom), the string up to the line
    const P_BODY = new THREE.Matrix4().makeScale(LS[0], LS[1], LS[2]);
    const P_TOP = new THREE.Matrix4().makeTranslation(0, LS[1] * 0.92, 0).multiply(new THREE.Matrix4().makeScale(LS[0] * 0.55, 0.03, LS[0] * 0.55));
    const P_BOT = new THREE.Matrix4().makeTranslation(0, -LS[1] * 0.92, 0).multiply(new THREE.Matrix4().makeScale(LS[0] * 0.5, 0.025, LS[0] * 0.5));
    const sL = Math.max(0.02, hang - LS[1] * 0.95);
    const P_STR = new THREE.Matrix4().makeTranslation(0, LS[1] * 0.95 + sL / 2, 0).multiply(new THREE.Matrix4().makeScale(0.006, sL, 0.006));
    const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), sway = new THREE.Quaternion(), qq = new THREE.Quaternion(), swAx = new THREE.Vector3(1, 0, 0);
    const lastQ = lantern.map((m) => m.quaternion.clone()), bump = new Float32Array(n);
    let t = 0, finale = 0, finNow = 0, cometT = -1, q = false, rm = false;
    /** The lanterns' instance matrices from their movers (posed by the host), plus the render sway of the gust. */
    const pose = (quiet: boolean, reduced: boolean): void => {
      for (let k = 0; k < n; k++) {
        const o = lantern[k];
        sway.setFromAxisAngle(swAx, (reduced ? 0 : 1) * gust * 0.07 * Math.sin(t * 4.2 + k * 0.9) * (quiet ? 0.5 : 1));
        qq.copy(o.quaternion).multiply(sway);
        M.compose(o.position, qq, one);
        lBody.setMatrixAt(k, M2.multiplyMatrices(M, P_BODY)); halo.setMatrixAt(k, M2);
        lCap.setMatrixAt(k, M2.multiplyMatrices(M, P_TOP)); lCap.setMatrixAt(k + n, M2.multiplyMatrices(M, P_BOT)); lStr.setMatrixAt(k, M2.multiplyMatrices(M, P_STR));
      }
      lBody.instanceMatrix.needsUpdate = true; lCap.instanceMatrix.needsUpdate = true; lStr.instanceMatrix.needsUpdate = true; halo.instanceMatrix.needsUpdate = true;
    };
    pose(false, false);
    const movers: (THREE.Object3D | readonly THREE.Object3D[] | null)[] = [lantern, null, seat, null, null, null];
    return {
      group: g, movers, moverKind: [1, 0, 1, 0, 0, 0], heat: [ch.x, chH * 0.5, ch.z],
      update(dt, time, quiet, reduced, tier, fin = 0) {
        t += dt; q = quiet; rm = reduced;
        const m = reduced ? 0 : quiet ? 0.3 : 1;
        { const u = (backdrop.material as THREE.ShaderMaterial).uniforms; u.uTime.value = t; u.uMotion.value = m; }
        water.u.uTime.value = t; water.u.uMotion.value = m;
        // the gust (its own clock until the shell drives it)
        if (!driven) {
          if (t >= nextGust && gustEnd <= t) { gustEnd = t + gd.forS; nextGust = gustEnd + gd.everyS[0] + (gd.everyS[1] - gd.everyS[0]) * rnd(); }
          const gT = t < gustEnd ? 1 : 0;
          gust += (gT - gust) * Math.min(1, dt / 0.3);
        }
        streaks.update(dt, time, quiet, reduced, tier, gust > 0.1 ? gust : 0);
        // the finale (eased here too: the song's pulse runs on it) and the comet
        finNow += (finale - finNow) * Math.min(1, dt / (quiet || reduced ? 3 : 1.5));
        const fz = Math.max(fin, finNow);
        if (cometT >= 0) {
          cometT += dt;
          const u = cometT / 6;
          if (u >= 1) { cometT = -1; comet.visible = false; }
          else { cometU.uHead.value.set(0.12 + 0.43 * u, 0.42 - 0.12 * u, 0, 0); cometU.uK.value = Math.min(1, u * 5, (1 - u) * 5); }
        }
        // the lanterns: bumped ones glow for 3 s (glowS), the finale's glow runs along the line in time (the song's beat, 0.6 s a lantern)
        let mean = 0;
        for (let k = 0; k < n; k++) {
          const o = lantern[k], dq = lastQ[k].angleTo(o.quaternion) / Math.max(dt, 1e-3);
          lastQ[k].copy(o.quaternion);
          if (dq > 0.8 && dt > 0) bump[k] = ld.p.glowS ?? 3;
          bump[k] = Math.max(0, bump[k] - dt);
          const song = quiet || reduced ? fz : fz * (0.45 + 0.55 * Math.max(0, Math.cos(((t / 0.6 - k) / n) * Math.PI * 2)) ** 3);
          const target = Math.max(Math.min(1, bump[k] / 0.6), song);
          lGlow[k] += (target - lGlow[k]) * Math.min(1, dt / (target > lGlow[k] ? 0.12 : 0.6));
          mean += lGlow[k] / n;
        }
        // (a render sway in the gust: physics sways only the lanterns inside the Night Breeze; it is felt along the whole line)
        pose(quiet, reduced);
        gA.needsUpdate = true;
        lPool.value = 0.75 + 0.5 * mean;
        // the chimney breathes: a slow swell of warm air and of the glow at its foot (still with reduced motion)
        breath = 0.5 + 0.5 * Math.sin(t * 0.8 * (m || 0.5));
        warmPool.value = 0.8 + 0.25 * breath * m;
        air.update(dt, time, quiet, reduced, tier, 0.5 + breath);
      },
      thingFx(thing, kind, amount) {
        if (kind === 2 && thing === -1) { finale = amount; return true; }
        if (kind === 3 && thing === -1) { driven = true; gust = amount; return true; }   // the Night Breeze's gust level, from the shell (world.gustLevel)
        if (kind !== 1) return false;
        if (thing === 5 && !rm) { cometT = 0; comet.visible = true; cometU.uK.value = 0; return true; }   // the Star Scope: a comet (none with reduced motion)
        if (thing === 0) { for (let k = 0; k < n; k++) bump[k] = Math.max(bump[k], (ld.p.glowS ?? 3) * amount); return true; }
        if (thing === 3) { breath = 1; return true; }
        void q;
        return false;
      },
      dispose() { g.removeFromParent(); },
    };
  },
};
export default LOOK;
