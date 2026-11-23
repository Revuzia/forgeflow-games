// PLAYGROUND: Cloudloft's look (PLACES.md 4.10; PLAYGROUND_BUILD.md 9 and 13: one lazy chunk, at most 45 KB with PG_AUDIO's
// src/audio/places/cloudloft.ts and PG_DATA's src/data/place_cloudloft.ts). Round 6 (R6_RENDER, D-96). On top of the clouds at sunrise: a sky
// from dusk-violet down to amber at the horizon, a low warm sun half risen behind the far cloud banks (the amber key from the right), a cream
// rim; a soft cloud floor (cream mixed with dusk, held under L 0.80, billows with violet hollows and a sheen at grazing angles) that DENTS
// where a squishy sits or lands (the bodies feed; each dent fades in 6 s, PLACES 4.10's markLifeS); drifting wisps (normal blend); the
// Updraft made visible (a slow swirl on the floor, wisps rising and turning in it); the three Puff Pads (cloud cushions with a sunny
// swirl, movers); the Kite Swing (its seat on two ropes from a crossbar that a big kite holds up: the kite bobs a little); the banded Sunbow
// Arch (amber, coral and lagoon bands along a tube that follows physics' two posts and top bar, its corners rounded); the Cloud Nest (cloud
// puffs on the ring) and the Cloud Ball. The finale (thingFx(-1, 2)): the sun rises (the host eases light and sky; the sun card climbs) and a
// soft bow of light arcs over the parade. BOTH layouts from the same kit, every position the data module's. Token colours only.
import * as THREE from 'three';
import { type PlaceLook, type PlaceBuilt, type PropKit, type PlaceLight, Emitter, Batch, tok, col, sp, yawQ } from '../place.ts';
import type { PanelDef } from '../env.ts';
import PLACE from '../../data/place_cloudloft.ts';

/** Dents the floor remembers (a live one under each grounded body, the ones left behind fade over DENT_S). */
const DENTS = 16, DENT_S = PLACE.ground.markLifeS || 6;

// the cloud floor: big soft billows (violet in the hollows, sunlit cream on the tops), a fine fluff, a sheen toward the low sun at grazing
// angles, and the dents (a darker hollow with a lit rim on the sun's side)
const CLOUD = /* glsl */`
  vec2 p = vWP.xz;
  float fw = max(length(fwidth(p)), 1e-5);
  float big = pFbm(p * 0.42 + 1.7), mid = pFbm(p * 1.25 - 3.1), fine = pN(p * 7.0) * (1.0 - smoothstep(0.01, 0.05, fw));
  float b = smoothstep(0.2, 0.85, big * 0.65 + mid * 0.35);
  ${/* (round 6, first shots: a flat noise read as a dusty plain; the billows are a height now, lit by the low sun through the bump) */ ''}
  pBH = (big * 0.65 + mid * 0.35) * 0.55 + fine * 0.015;
  vec3 c = mix(uHollow, uTop, 0.3 + 0.7 * b) * (0.96 + 0.06 * fine);
  float dent = 0.0, rim = 0.0, tint = 0.0;
  for (int i = 0; i < ${DENTS}; i++) {
    vec4 d = uDent[i];
    if (d.w <= 0.0) continue;
    ${/* (round 14, R14_ROOMS: the clear, see-through families were hard to see against the near-white cloud tops) under each body that STANDS on the cloud (its live */ ''}
    ${/* dent, w > 1) the floor is tinted a deeper lavender-blue: a soft pool under it that reaches the way the camera looks, so the whole silhouette has it behind */ ''}
    if (d.w > 1.2) {
      vec2 vd = normalize(d.xy - cameraPosition.xz + 1e-4), q2 = p - (d.xy + vd * d.z * 1.3);
      tint = max(tint, 1.0 - smoothstep(0.45, 1.0, length(vec2(dot(q2, vd) / (d.z * 3.0), dot(q2, vec2(-vd.y, vd.x)) / (d.z * 1.8)))));
    }
    d.w = min(d.w, 1.0);
    vec2 q = p - d.xy; float r = length(q) / d.z;
    dent = max(dent, d.w * (1.0 - smoothstep(0.55, 1.0, r)));
    rim = max(rim, d.w * smoothstep(0.75, 1.0, r) * (1.0 - smoothstep(1.0, 1.25, r)) * (0.5 + 0.5 * dot(normalize(q + 1e-4), vec2(0.8, 0.6))));
  }
  c = mix(c, uHollow * 0.86, dent * 0.55) + uTop * rim * 0.18;
  c = mix(c, uTint, tint * 0.62);
  vec3 V = normalize(cameraPosition - vWP);
  c += uSheen * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0) * (0.5 + 0.5 * b);
  diffuseColor.rgb = c;
`;
// far cloud banks: cumulus tops (a union of round bumps, no seams), the sun's side gilded, lavender at their feet in the haze
const BANK = /* glsl */`
void main() {
  float x = vUv.x * uN, h = 0.0, lit = 0.0;
  for (int k = -1; k <= 1; k++) {
    float i = floor(x) + float(k), c = i + 0.5 + (pH(vec2(i, uSeed)) - 0.5) * 0.5, r = 0.45 + 0.4 * pH(vec2(i, uSeed + 1.0));
    float dx = (x - c) / r, y = 0.5 + 0.18 * pH(vec2(i, uSeed + 2.0)) + 0.32 * sqrt(max(0.0, 1.0 - dx * dx)) * r;
    if (y > h) { h = y; lit = dx; }
    float c2 = c + (pH(vec2(i, uSeed + 3.0)) - 0.5) * 0.8, r2 = 0.25 + 0.2 * pH(vec2(i, uSeed + 4.0)), dx2 = (x - c2) / r2;
    float y2 = y - 0.04 + 0.3 * sqrt(max(0.0, 1.0 - dx2 * dx2)) * r2;
    if (y2 > h) { h = y2; lit = dx2; }
  }
  if (vUv.y > h) discard;
  float t = vUv.y / max(h, 1e-3);
  vec3 c = mix(uFoot, uTop, smoothstep(0.55, 0.95, t));
  c = mix(c, uGild, smoothstep(0.86, 1.0, t) * smoothstep(-0.3, 0.8, lit));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
// the sun: a cream-amber disc low over the cloud banks, a wide warm glow (additive)
const SUN = /* glsl */`
void main() {
  vec2 q = (vUv - 0.5) * 8.0;
  float r = length(q), win = 1.0 - smoothstep(2.6, 4.0, r);
  float disc = 1.0 - smoothstep(0.95, 1.05, r);
  float glow = (exp(-r * 0.9) * 0.4 + exp(-r * 2.4) * 0.35) * win;
  gl_FragColor = vec4(uCore * disc * (0.9 + 0.1 * (1.0 - r * r)) + uGlow * glow * (1.0 - disc * 0.7), 1.0);
  #include <colorspace_fragment>
}`;
// the finale's bow of light: a soft spectral band on an arc (additive, faint)
const BOW = /* glsl */`
void main() {
  vec2 q = (vUv - vec2(0.5, 0.0)) * vec2(34.0, 17.0);
  float band = (length(q) / 12.3 - 1.0) / 0.075;
  float a = (1.0 - smoothstep(0.6, 1.0, abs(band))) * smoothstep(0.1, 0.45, vUv.y);
  vec3 c = band < -0.33 ? uC3 : band < 0.33 ? uC2 : uC1;
  gl_FragColor = vec4(c * a * uAmt * 0.45, 1.0);
  #include <colorspace_fragment>
}`;
// the Updraft on the floor: three slow spiral arms of pale light turning inward (normal-blend look, additive here and faint)
const SWIRL = /* glsl */`
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q), a = atan(q.y, q.x);
  float arms = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0 - uTime * uMotion * 0.8);
  float k = smoothstep(0.55, 1.0, arms) * (1.0 - smoothstep(0.7, 1.0, r)) * smoothstep(0.05, 0.3, r);
  gl_FragColor = vec4(uCol * (k * 0.32 + (1.0 - smoothstep(0.0, 1.0, r)) * 0.08), 1.0);
  #include <colorspace_fragment>
}`;
// the Puff Pads: a cloud cushion with a sunny swirl painted on its top and a soft amber rim
const PAD = /* glsl */`
  vec2 q = vLP.xz / uR;
  float r = length(q), a = atan(q.y, q.x);
  float sw = smoothstep(0.6, 0.95, 0.5 + 0.5 * sin(a * 2.0 + r * 7.0));
  diffuseColor.rgb = mix(uP1, uP2, sw * (1.0 - smoothstep(0.75, 0.95, r)) * 0.6 + smoothstep(0.8, 1.0, r) * 0.5) * (0.92 + 0.1 * pN(vLP.xz * 14.0));
`;
// the Sunbow: three bands along the tube (amber outside, coral in the middle, lagoon inside), by the local normal against the arch's outward
// direction at that point of its (rounded rectangle) centre line
const SUNBOW = /* glsl */`
  vec2 p = vLP.xy, o;
  if (p.y < uTop - uCr) o = vec2(sign(p.x), 0.0);
  else if (abs(p.x) > uHw - uCr) o = normalize(p - vec2(sign(p.x) * (uHw - uCr), uTop - uCr));
  else o = vec2(0.0, 1.0);
  float s = dot(normalize(vLN).xy, o);
  vec3 c = s > 0.3 ? uB1 : s > -0.3 ? uB2 : uB3;
  float fw = max(fwidth(s), 1e-3);
  c = mix(c, uB2, (1.0 - smoothstep(0.0, fw * 1.5, abs(s - 0.3))) * 0.3 + (1.0 - smoothstep(0.0, fw * 1.5, abs(s + 0.3))) * 0.3);
  diffuseColor.rgb = c;
`;
// the kite: a diamond in four panels (coral, amber, lagoon, cream) with its spars
const KITE = /* glsl */`
  vec2 q = vLP.xy;
  float d = abs(q.x) / 0.5 + abs(q.y - (q.y > 0.0 ? 0.0 : 0.0)) / (q.y > 0.0 ? 0.5 : 0.8);
  if (d > 1.0) discard;
  vec3 c = q.x < 0.0 ? (q.y > 0.0 ? uK1 : uK3) : (q.y > 0.0 ? uK2 : uK4);
  float spar = (1.0 - smoothstep(0.012, 0.022, abs(q.x))) + (1.0 - smoothstep(0.012, 0.022, abs(q.y)));
  diffuseColor.rgb = mix(c, uSpar, min(1.0, spar) * 0.8);
`;
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const;

const LOOK: PlaceLook = {
  id: 'cloudloft',
  ceremonyDim: PLACE.ceremonyDim,
  skyBand: tok('dusk', 'amber', 0.45, 0.95),
  sky: {
    // (round 6, first shots: the low sky a flat orange; violet up high, coral lower, amber only at the horizon)
    uZenith: tok('dusk', 'ink', 0.35, 0.85), uInk: tok('dusk', 'plum', 0.25, 0.92), uPlum: tok('dusk', 'coral', 0.4, 0.84), uHorizon: tok('amber', 'coral', 0.35, 0.86),
    uGlowWarm: tok('amber', 'cream', 0.3, 0.55), uGlowCool: tok('dusk', 'lagoon', 0.35, 0.3), uBase: tok('cream', 'dusk', 0.45, 0.72), uWarm: tok('amber', 'amber', 0, 0.04),
    uFogNear: 12, uFogFar: 44,
  },
  light(layout: 0 | 1): PlaceLight {
    void layout;
    return {
      // the low warm sun from the right (it stands in the sky at the back right), a long gold light across the cloud
      key: tok('amber', 'cream', 0.45), keyI: 330, keyPos: [7.0, 3.0, 2.5], keyAim: [-0.5, 0, -0.3], keyAngle: 1.2,
      rim: tok('cream', 'coral', 0.15), rimI: 2.6, rimDir: [-0.45, 0.45, -0.78],
      fillSky: tok('dusk', 'lagoon', 0.4, 0.95), fillGround: tok('cream', 'coral', 0.35, 0.72), fillI: 3.0,
      keyTint: [1.0, 0.84, 0.6],
    };
  },
  // the finale spectacle (PLACES 4.10, P13): the sun rises: a brighter gold key, the violet lifts toward a clearer morning sky; the build
  // raises the sun card and fades in a soft bow of light over the play area
  finale: {
    // (round 6, the place run's finale shot: a lagoon fill turned the cloud sea grey-green and the frame went 0.29 -> 0.41: a rose-violet fill, a softer key)
    light: { key: tok('cream', 'amber', 0.3), keyI: 400, rim: tok('cream', 'amber', 0.2), fillSky: tok('dusk', 'coral', 0.3, 0.9), fillI: 2.8 },
    sky: { uHorizon: tok('cream', 'amber', 0.45, 0.95), uGlowWarm: tok('cream', 'amber', 0.25, 0.65), uPlum: tok('amber', 'coral', 0.4, 0.85), uInk: tok('dusk', 'lagoon', 0.4, 0.85), uZenith: tok('dusk', 'lagoon', 0.3, 0.72) },
  },
  panels: [
    { dir: new THREE.Vector3(0.88, 0.32, 0.35).normalize(), dist: 4.5, w: 2.6, h: 1.4, color: [1.0, 0.82, 0.52], k: 6.5, soft: 0.6, radius: 0.7 },     // the low sun
    { dir: new THREE.Vector3(0.0, 1, 0.1).normalize(), dist: 4.5, w: 4.4, h: 1.4, color: [0.62, 0.5, 0.86], k: 2.6, soft: 0.5, radius: 0.6 },       // the violet sky
    { dir: new THREE.Vector3(-0.45, 0.4, -0.8).normalize(), dist: 4.5, w: 1.2, h: 3.0, color: [1.0, 0.9, 0.78], k: 6.0, soft: 0.2, radius: 0.3 },   // the cream rim
    { dir: new THREE.Vector3(-0.2, -0.3, 0.93).normalize(), dist: 4.5, w: 3.4, h: 2.0, color: [0.96, 0.86, 0.78], k: 1.8, soft: 1.0, radius: 1.0 }, // the cloud's bounce
  ] satisfies PanelDef[],

  build(kit: PropKit, layout: 0 | 1): PlaceBuilt {
    const tall = layout === 1, T = PLACE.tall;
    const g = new THREE.Group(); g.name = `cloudloft-${tall ? 'tall' : 'wide'}`;
    const B = new Batch();
    const th = (i: number): { x: number; z: number; yaw: number } => (tall ? T.things[i] : PLACE.things[i]);
    const zn = (i: number): { x: number; z: number; r?: number; hx?: number; hz?: number } => (tall ? T.zones[i] : PLACE.zones[i]);
    // ---- the cloud floor (with its dents) ----
    const dent = Array.from({ length: DENTS }, () => new THREE.Vector4(0, 0, 1, 0));
    // (round 6, first shots: cream-dusk read as pink-brown dust; a cream-amber top in the sun and lavender hollows read as cloud)
    // (round 6, second shots: beige under the amber sun read as sand: near-white tops and blue-lavender hollows, the light gives the gold)
    const cloudU = { uTop: { value: col(tok('cream', 'lagoon', 0.1, 0.81)) }, uHollow: { value: col(tok('dusk', 'lagoon', 0.4, 0.63)) }, uSheen: { value: col(tok('amber', 'cream', 0.45, 0.1)) }, uDent: { value: dent },
      uTint: { value: col(tok('dusk', 'lagoon', 0.42, 0.5)) } };   // (round 14: the tint under a standing body)
    const cloud = kit.surface('cloud', [1, 1, 1], 0.95, CLOUD, cloudU, 0.3, 1.0);
    // (round 6, first shots: a flat floor to the horizon read as a sandy plain from the place camera's low view) the cloud sea billows up
    // outside the play area, behind it and at its sides (never in front of it: the front band stays clear to the frame's foot); the bounds
    // plus 0.6 m stay flat (the physics floor; the corral and the guard keep bodies and the ball inside them)
    const bd = tall ? T.bounds : PLACE.bounds, bhx = (bd.hx ?? 3.4) + 0.6, bz0 = bd.z - (bd.hz ?? 2.4) - 0.6;
    const vh = (x: number, z: number): number => { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return h - Math.floor(h); };
    const vn = (x: number, z: number): number => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
      return (vh(ix, iz) * (1 - ux) + vh(ix + 1, iz) * ux) * (1 - uz) + (vh(ix, iz + 1) * (1 - ux) + vh(ix + 1, iz + 1) * ux) * uz; };
    g.add(kit.mesh(kit.geo(`cfloor${tall ? 1 : 0}`, () => {
      const q = new THREE.PlaneGeometry(44, 44, 120, 120).rotateX(-Math.PI / 2), P = q.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), z = P.getZ(i), out = Math.max(Math.abs(x) - bhx, bz0 - z, 0) * (z < bz0 || Math.abs(x) > bhx ? 1 : 0), side = z > bz0 ? Math.min(1, Math.max(0, (bd.z + (bd.hz ?? 2.4) + 2 - z) / 2)) : 1;
        // (round 6, second shots: value noise made sharp dunes; round domes (cumulus tops) on a jittered 2 m grid, a few small ones on them)
        let hgt = 0;
        for (let gx = Math.floor(x / 2) - 1; gx <= Math.floor(x / 2) + 1; gx++) for (let gz = Math.floor(z / 2) - 1; gz <= Math.floor(z / 2) + 1; gz++) {
          const cx = gx * 2 + 0.4 + 1.2 * vh(gx, gz), cz = gz * 2 + 0.4 + 1.2 * vh(gz + 17, gx), r = 0.9 + 0.7 * vh(gx + 5, gz + 3), d2 = (x - cx) ** 2 + (z - cz) ** 2;
          if (d2 < r * r) hgt = Math.max(hgt, Math.sqrt(r * r - d2) * 0.72 + 0.1 * vn(x * 2.2, z * 2.2));
        }
        const ramp = Math.min(1, out / 2.2) * side;
        P.setY(i, ramp * ramp * (3 - 2 * ramp) * hgt);
      }
      q.computeVertexNormals(); return q;
    }), cloud, 0, 0, 0, -50));
    // the puffs (the nest, the arch's feet): cloud-white with lavender shade, a little light of their own (light passes through cloud)
    const puffM = kit.mat('puff', tok('cream', 'lagoon', 0.08, 0.95), 0.95, 0.35, tok('dusk', 'lagoon', 0.4, 0.62), 0.22);
    // ---- the sky's far side: the sun behind two cloud banks ----
    // (round 6, first shots: a 4-degree sun on a 26 m card was a flat yellow plate cut by the card's edge; the place camera looks 8.6 degrees
    // down from far back, so the sun stands 4.4 degrees under the eye line, 4 degrees right: inside every frame, its foot in the near bank)
    const sunU = { uCore: { value: col(tok('cream', 'amber', 0.3, 1.0)) }, uGlow: { value: col(tok('amber', 'coral', 0.3, 0.7)) } };
    const SUN_Y = -5.9;
    const sun = kit.card(SUN, sunU, 27, 27, 10.3, SUN_Y, -130, -0.07, -79, true);
    Object.assign(sun.material as THREE.ShaderMaterial, ADD); g.add(sun);
    const bank = (z: number, y: number, h: number, seed: number, foot: THREE.Color, order: number): void => {
      const u = { uN: { value: 16 }, uSeed: { value: seed }, uTop: { value: col(tok('cream', 'dusk', 0.25, 0.86)) }, uFoot: { value: foot }, uGild: { value: col(tok('amber', 'cream', 0.3, 0.98)) } };
      g.add(kit.card(BANK, u, -z * 2.6, h, 0, y, z, 0, order));
    };
    bank(-95, -8.2, 14, 3, col(tok('dusk', 'coral', 0.4, 0.78)), -74);
    bank(-60, -6.4, 10, 8, col(tok('dusk', 'cream', 0.5, 0.74)), -73);
    const bowU = { uAmt: { value: 0 }, uC1: { value: col(tok('amber', 'cream', 0.2)) }, uC2: { value: col(tok('coral', 'cream', 0.2)) }, uC3: { value: col(tok('lagoon', 'cream', 0.25)) } };
    const bow = kit.card(BOW, bowU, 34, 17, 0, -3.5, -40, 0, -60, true);   // its arc (r 12.3 m about y -12) tops out 3 degrees under the eye line
    Object.assign(bow.material as THREE.ShaderMaterial, ADD); (bow.material as THREE.ShaderMaterial).depthTest = true; bow.visible = false; g.add(bow);

    // ---- materials ----
    const wood = kit.mat('wood', tok('amber', 'cream', 0.45, 0.5), 0.8, 0.2), rope = kit.mat('rope', tok('cream', 'amber', 0.3, 0.85), 0.9, 0.1);
    const seatM = kit.mat('kseat', tok('coral', 'amber', 0.3, 0.85), 0.7, 0.3), ballM = kit.mat('cball', tok('cream', 'coral', 0.18, 0.95), 0.9, 0.3, tok('dusk', 'cream', 0.6, 0.5), 0.14);
    const unitCyl = kit.cyl(1, 1, 1, 10), unitCylX = kit.geo('cylX', () => new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2));

    // ---- the Puff Pads: three cloud cushions (movers: one per part, at the pads' rest just under the floor) ----
    const pd = PLACE.things[0], pr = pd.size[0], restY = -Math.max(0.01, pd.size[1]) - 0.002, p0 = th(0);
    const padAt: [number, number][] = [[p0.x, p0.z]];
    for (let i = 1; i < (pd.p.n ?? 1); i++) {
      const tx = pd.p['tx' + i], tz = pd.p['tz' + i], wx = pd.p['x' + i], wz = pd.p['z' + i];
      if (tall && tx !== undefined && tz !== undefined) padAt.push([tx, tz]);
      else if (wx !== undefined && wz !== undefined) padAt.push(tall ? [p0.x + (wx - pd.x), p0.z + (wz - pd.z)] : [wx, wz]);
    }
    const padU = { uR: { value: pr }, uP1: { value: col(tok('cream', 'amber', 0.25, 0.88)) }, uP2: { value: col(tok('amber', 'coral', 0.3, 0.85)) } };
    const padM = kit.local('pad', [1, 1, 1], 0.9, PAD, padU, 0.35);
    const padG = kit.geo(`pad${pr}`, () => new THREE.SphereGeometry(pr, 28, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.12, 1));
    const pads: THREE.Object3D[] = padAt.map(([x, z]) => {
      const o = new THREE.Group(); o.position.set(x, restY, z);
      o.add(kit.mesh(padG, padM, 0, -restY, 0, 2)); g.add(o);
      kit.shadow(x, z, pr * 1.05, pr * 1.05, 0.18);
      return o;
    });

    // ---- the Updraft: a swirl on the floor, wisps rising in it ----
    const ud = zn(0), uR = ud.r ?? 1;
    const swU = { uCol: { value: col(tok('cream', 'lagoon', 0.3, 0.5)) } };
    const swirl = kit.card(SWIRL, swU, 2 * uR, 2 * uR, ud.x, 0.007, ud.z, 0, -44, true);
    swirl.rotation.x = -Math.PI / 2; Object.assign(swirl.material as THREE.ShaderMaterial, ADD); g.add(swirl);
    const WSP: [number, number, number] = [0.97, 0.93, 0.9];
    // (round 6, second shots: a streaked column read as a glass tube; the wisps alone show the rising air, turning as they climb)
    const rise = new Emitter([30, 20, 10], true, (p, r) => {
      const a = r() * 6.2832, d = Math.sqrt(r()) * uR * 0.85;
      p.emit(sp(ud.x + Math.cos(a) * d, 0.08, ud.z + Math.sin(a) * d, -Math.sin(a) * 0.22, 0.5 + 0.3 * r(), Math.cos(a) * 0.22, 3.0 + r(), 0.08 + 0.07 * r(), WSP, 0.42, 0.12));
    }, 9);
    g.add(rise.particles.mesh); kit.own(rise);

    // ---- the Kite Swing: a seat on two ropes from a crossbar, which a big kite holds up (movers: the seat) ----
    const ks = th(2), kd = PLACE.things[2], ropeL = kd.p.rope ?? 1.4, pivY = kd.p.pivotY ?? 1.62, seatR = kd.size[0], seatL = kd.size[1];
    const ax = -Math.sin(ks.yaw), az = Math.cos(ks.yaw);
    B.add('wood', unitCylX, wood, ks.x, pivY + 0.03, ks.z, seatL + 0.2, 0.03, 0.03, yawQ(-ks.yaw - Math.PI / 2));
    const seat = new THREE.Group(); seat.position.set(ks.x, pivY - ropeL, ks.z); seat.rotation.y = -ks.yaw;
    const sm = kit.mesh(kit.capsule(seatR, seatL), seatM, 0, 0, 0, 2); sm.rotation.x = Math.PI / 2; seat.add(sm);
    for (const side of [-1, 1]) {
      const o = side * (seatL / 2 - 0.04), len = Math.hypot(o, ropeL);
      const r = kit.mesh(kit.cyl(0.01, 0.01, len, 6), rope, 0, ropeL / 2, o / 2, 2); r.rotation.x = Math.atan2(-o, ropeL); seat.add(r);
    }
    g.add(seat);
    kit.shadow(ks.x, ks.z, Math.abs(az) * seatL * 0.6 + 0.2, Math.abs(ax) * seatL * 0.6 + 0.2, 0.22);
    // the kite: high above and a little behind, facing the camera's side; its two lines run to the crossbar's ends
    const kU = { uK1: { value: col(tok('coral', 'amber', 0.15)) }, uK2: { value: col(tok('amber', 'cream', 0.2)) }, uK3: { value: col(tok('lagoon', 'cream', 0.25)) }, uK4: { value: col(tok('cream', 'coral', 0.25)) }, uSpar: { value: col(tok('plum', 'amber', 0.3, 0.8)) } };
    const kiteM = kit.local('kite', [1, 1, 1], 0.7, KITE, kU, 0.3); kiteM.side = THREE.DoubleSide;
    // (round 6, first shots: a kite 2 m over the swing stood above every desktop frame; far behind it climbs the sky by perspective, and
    // its two lines rise from the crossbar to it)
    const kite = new THREE.Group(), kBase = new THREE.Vector3(ks.x + 1.0, 2.1, ks.z - 7.5);
    kite.position.copy(kBase);
    const kpl = kit.mesh(kit.geo('kitepl', () => new THREE.PlaneGeometry(1, 1.3).translate(0, -0.15, 0)), kiteM, 0, 0, 0, 3); kite.add(kpl);
    for (let k = 0; k < 5; k++) { const bw = kit.mesh(kit.geo('bow', () => new THREE.OctahedronGeometry(0.06, 0)), seatM, 0.06 * Math.sin(k * 1.3), -0.95 - k * 0.22, 0, 3); bw.scale.set(1.5, 0.6, 0.4); kite.add(bw); }
    kite.scale.setScalar(1.35); kite.rotation.set(-0.2, 0.1, 0.12);
    g.add(kite);
    const lines = [-1, 1].map(() => { const m = kit.mesh(kit.cyl(0.005, 0.005, 1, 4), rope, 0, 0, 0, 3); g.add(m); return m; });
    const lineEnd = [-1, 1].map((s) => new THREE.Vector3(ks.x + ax * (seatL / 2 + 0.08) * s, pivY + 0.03, ks.z + az * (seatL / 2 + 0.08) * s));
    const kTie = new THREE.Vector3(), tmpV = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
    const placeLines = (): void => {
      kTie.set(0, -0.3, 0); kite.localToWorld(kTie);
      for (let i = 0; i < 2; i++) {
        const a = lineEnd[i], m = lines[i];
        tmpV.subVectors(kTie, a); const L = tmpV.length();
        m.position.copy(a).addScaledVector(tmpV, 0.5); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(UPV, tmpV.normalize());
      }
    };
    kite.updateMatrixWorld(); placeLines();

    // ---- the Sunbow Arch: a banded tube along physics' posts and top bar (static) ----
    const sa = th(3), sd = PLACE.things[3], aR = sd.size[0], aW = sd.p.width ?? 1.6, aH = sd.p.height ?? 1.3;
    const hw = Math.max(aR, aW / 2 - aR), top = Math.max(2 * aR, aH - aR), cr = Math.min(0.32, hw * 0.5);
    const bowBand = { uTop: { value: top }, uHw: { value: hw }, uCr: { value: cr }, uB1: { value: col(tok('amber', 'coral', 0.12, 0.95)) }, uB2: { value: col(tok('coral', 'amber', 0.15, 0.92)) }, uB3: { value: col(tok('lagoon', 'dusk', 0.15, 0.95)) } };
    const arch = kit.mesh(kit.geo(`arch${hw},${top}`, () => archTube(hw, top, cr, aR, 72, 14)), kit.local('sunbow', [1, 1, 1], 0.45, SUNBOW, bowBand, 0.45), sa.x, 0, sa.z, 2);
    arch.quaternion.copy(yawQ(-sa.yaw)); g.add(arch);
    for (const s of [-1, 1]) {
      B.add('puff', kit.sphere(1, 16, 12), puffM, sa.x + Math.cos(sa.yaw) * hw * s, 0.06, sa.z + Math.sin(sa.yaw) * hw * s, aR * 1.9, 0.16, aR * 1.9);   // a cloud puff at each foot
      kit.shadow(sa.x + Math.cos(sa.yaw) * hw * s, sa.z + Math.sin(sa.yaw) * hw * s, 0.3, 0.3, 0.3);
    }

    // ---- the Cloud Nest: cloud puffs along the ring's segments, the gap toward its yaw ----
    const cn = th(4), cd = PLACE.things[4], ringR = cd.size[0], segR = cd.size[1], gap = (cd.size[2] * Math.PI) / 180, nSeg = cd.p.segments ?? 5;
    const span = 2 * Math.PI - gap;
    for (let i = 0; i < nSeg * 3; i++) {
      const a = cn.yaw + gap / 2 + span * ((i + 0.5) / (nSeg * 3)), r = segR * (1.35 + 0.45 * Math.abs(Math.sin(i * 2.7))), rr = ringR + 0.05 * Math.sin(i * 1.9);
      B.add('puff', kit.sphere(1, 16, 12), puffM, cn.x + Math.cos(a) * rr, r * 0.75, cn.z + Math.sin(a) * rr, r * 1.15, r, r * 1.15);
    }
    kit.shadow(cn.x, cn.z, ringR * 0.95, ringR * 0.95, 0.18);

    // ---- the Cloud Ball (a mover): a lumpy cloud ----
    const cb = th(5), bR = PLACE.things[5].size[0];
    const ballG = kit.geo('cball', () => {
      const q = new THREE.SphereGeometry(bR, 28, 20), P = q.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).normalize(); const k = 1 + 0.07 * Math.sin(v.x * 7.1 + 1.3) * Math.sin(v.y * 6.3 + 0.4) * Math.sin(v.z * 6.7 + 2.1); P.setXYZ(i, v.x * bR * k, v.y * bR * k, v.z * bR * k); }
      q.computeVertexNormals(); return q;
    });
    const ball = new THREE.Group(); ball.position.set(cb.x, bR, cb.z);
    ball.add(kit.mesh(ballG, ballM, 0, 0, 0, 2)); g.add(ball);
    kit.shadow(cb.x, cb.z, bR * 1.1, bR * 1.1, 0.3);

    B.flush(kit, g);
    const shm = kit.shadowMesh(); if (shm) g.add(shm);

    // ---- drifting wisps over the cloud (normal blend, slow) ----
    const W = tall ? 2.6 : 5.0, D = tall ? 4.0 : 3.2;
    const drift = new Emitter([12, 9, 5], true, (p, r) => {
      p.emit(sp(-W - 0.5 + r() * 2 * W * 0.5, 0.06 + r() * 0.25, (r() - 0.5) * 2 * D, 0.16 + 0.1 * r(), 0.01, 0.02 * (r() - 0.5), 7 + 3 * r(), 0.22 + 0.16 * r(), WSP, 0.13, 0));
    }, 1.4);
    g.add(drift.particles.mesh); kit.own(drift);

    // dents: a live one under each grounded body; when it walks on (0.35 of its radius) the old one stays and fades over DENT_S
    const live = new Int16Array(64).fill(-1), liveId = new Int32Array(64).fill(-1);
    let dHead = 0;
    const stepDents = (dt: number, Bf: Float32Array | undefined, nB: number): void => {
      for (const d of dent) if (d.w > 0 && d.w < 1.5) d.w = Math.max(0, d.w - dt / DENT_S);
      for (let i = 0; i < 64; i++) liveId[i] = -1;
      for (let b = 0; b < nB && Bf; b++) {
        const o = b * 5, x = Bf[o], y = Bf[o + 1], z = Bf[o + 2], R = Bf[o + 3], id = Bf[o + 4] & 63;
        let s = live[id];
        const grounded = y < R * 1.35;
        if (!grounded) { if (s >= 0) { dent[s].w = Math.min(1, dent[s].w); live[id] = -1; } continue; }
        if (s >= 0 && Math.hypot(dent[s].x - x, dent[s].y - z) > R * 0.35) { dent[s].w = 0.999; s = -1; }   // left behind: it fades
        if (s < 0) { s = dHead; dHead = (dHead + 1) % DENTS; for (let k = 0; k < 64; k++) if (live[k] === s) live[k] = -1; live[id] = s; dent[s].set(x, z, R * 0.95, 1.6); }
        liveId[id] = 1;
      }
      for (let k = 0; k < 64; k++) if (live[k] >= 0 && liveId[k] < 0) { dent[live[k]].w = 0.999; live[k] = -1; }   // a body gone: its dent fades
    };

    const movers: (THREE.Object3D | readonly THREE.Object3D[] | null)[] = [pads, null, seat, null, null, ball];
    let t = 0, finNow = 0;
    return {
      group: g, movers, moverKind: [0, 0, 1, 0, 0, 1], heat: null, bodies: true,
      stats: () => ({ dents: dent.filter((v) => v.w > 0).length, live: dent.filter((v) => v.w > 1.5).length }),
      update(dt, time, quiet, reduced, tier, finale = 0, Bf, nB = 0) {
        t += dt;
        const m = reduced ? 0 : quiet ? 0.3 : 1;
        { const u = (swirl.material as THREE.ShaderMaterial).uniforms; u.uTime.value = t; u.uMotion.value = m; }
        rise.update(dt, time, quiet, reduced, tier);
        drift.update(dt, time, quiet, reduced, tier);
        stepDents(dt, Bf, nB);
        // the kite bobs a little on the wind (still with reduced motion)
        kite.position.set(kBase.x + 0.06 * Math.sin(t * 0.7) * m, kBase.y + 0.08 * Math.sin(t * 0.9 + 1) * m, kBase.z);
        kite.rotation.z = 0.12 + 0.06 * Math.sin(t * 0.8) * m;
        kite.updateMatrixWorld(); placeLines();
        // the finale: the sun climbs and the bow of light fades in (the host eases the light and sky; the amount arrives eased)
        finNow = finale;
        sun.position.y = SUN_Y + 6.5 * finNow;
        bowU.uAmt.value = finNow; bow.visible = finNow > 0.001;
      },
      dispose() { g.removeFromParent(); },
    };
  },
};
export default LOOK;

/** (round 10, R10_FIX 3; VERDICT_R9 A1) the Sunbow Arch's tube, built here the way THREE.TubeGeometry(path, tub, r, rad, false) builds it along round 8's path (the
 *  left post up, a quadratic bend of radius cr, the top bar, a bend, the right post down; in the arch's own x-y plane): TubeGeometry and its curve classes (CurvePath,
 *  LineCurve3, QuadraticBezierCurve3) had no other user, and three.js ships as ONE module, so this lazy place's one mesh grew the FIRST-PLAY three.core chunk by
 *  14.9 KB. Same vertex grid, order, normals and uvs: the points spaced by arc length (getPointAt), and the frames of a planar path (TubeGeometry's Frenet frames
 *  for it: N = (0, 0, -1) throughout, B = T x N), the ring vertex P + r (-cos v N + sin v B), uv (i / tub, j / rad). */
function archTube(hw: number, top: number, cr: number, r: number, tub: number, rad: number): THREE.BufferGeometry {
  // the path as a dense polyline (by each piece's own parameter), its cumulative length and its tangent (each piece's derivative)
  const segs: ReadonlyArray<readonly number[]> = [[0, -hw, 0, 0, 0, -hw, top - cr], [1, -hw, top - cr, -hw, top, -hw + cr, top], [0, -hw + cr, top, 0, 0, hw - cr, top],
    [1, hw - cr, top, hw, top, hw, top - cr], [0, hw, top - cr, 0, 0, hw, 0]];
  const PER = 400, M = segs.length * PER + 1, X = new Float64Array(M), Y = new Float64Array(M), TX = new Float64Array(M), TY = new Float64Array(M), C = new Float64Array(M);
  let n = 0;
  for (let q = 0; q < segs.length; q++) {
    const [k, x0, y0, cx, cy, x1, y1] = segs[q];
    for (let h = q === 0 ? 0 : 1; h <= PER; h++) {
      const t = h / PER, u = 1 - t;
      if (k === 0) { X[n] = x0 + (x1 - x0) * t; Y[n] = y0 + (y1 - y0) * t; TX[n] = x1 - x0; TY[n] = y1 - y0; }
      else { X[n] = u * u * x0 + 2 * u * t * cx + t * t * x1; Y[n] = u * u * y0 + 2 * u * t * cy + t * t * y1; TX[n] = 2 * u * (cx - x0) + 2 * t * (x1 - cx); TY[n] = 2 * u * (cy - y0) + 2 * t * (y1 - cy); }
      const tl = Math.hypot(TX[n], TY[n]) || 1; TX[n] /= tl; TY[n] /= tl;
      C[n] = n === 0 ? 0 : C[n - 1] + Math.hypot(X[n] - X[n - 1], Y[n] - Y[n - 1]);
      n++;
    }
  }
  const L = C[n - 1], pos = new Float32Array((tub + 1) * (rad + 1) * 3), nor = new Float32Array(pos.length), uv = new Float32Array((tub + 1) * (rad + 1) * 2);
  let a = 0;
  for (let i = 0; i <= tub; i++) {
    const want = L * i / tub;
    while (a < n - 2 && C[a + 1] < want) a++;
    const f = C[a + 1] > C[a] ? Math.min(1, Math.max(0, (want - C[a]) / (C[a + 1] - C[a]))) : 0;
    const px = X[a] + (X[a + 1] - X[a]) * f, py = Y[a] + (Y[a + 1] - Y[a]) * f;
    let tx = TX[a] + (TX[a + 1] - TX[a]) * f, ty = TY[a] + (TY[a + 1] - TY[a]) * f;
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    for (let j = 0; j <= rad; j++) {
      const v = j / rad * Math.PI * 2, sn = Math.sin(v), cs = -Math.cos(v);
      // N = (0, 0, -1), B = T x N = (-ty, tx, 0): normal = cs N + sn B
      const nx = -sn * ty, ny = sn * tx, nz = -cs, o = (i * (rad + 1) + j) * 3;
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
      pos[o] = px + r * nx; pos[o + 1] = py + r * ny; pos[o + 2] = r * nz;
      const w = (i * (rad + 1) + j) * 2; uv[w] = i / tub; uv[w + 1] = j / rad;
    }
  }
  const idx: number[] = [];
  for (let j = 1; j <= tub; j++) for (let i = 1; i <= rad; i++) {
    const p0 = (rad + 1) * (j - 1) + (i - 1), p1 = (rad + 1) * j + (i - 1), p2 = (rad + 1) * j + i, p3 = (rad + 1) * (j - 1) + i;
    idx.push(p0, p1, p3, p1, p2, p3);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
