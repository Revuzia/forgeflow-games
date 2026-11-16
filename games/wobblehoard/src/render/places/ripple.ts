// PLAYGROUND: Ripple Shore's look (PLACES.md 4.3; PLAYGROUND_BUILD.md 9 and 13: one lazy chunk, at most 45 KB with PG_AUDIO's
// src/audio/places/ripple.ts and PG_DATA's src/data/place_ripple.ts). A sandy cove in late-afternoon gold: a lagoon sky lifted toward cream at the
// horizon (the zenith at or under L 0.55), a deep lagoon sea band at the back with slow cream surf lines, amber-cream sand that turns dark where
// it is wet (the Wet Sand band and everything seaward of it), a few dark rocks; the low sun is the cream-amber key, the sea light the lagoon rim;
// a few warm spray motes (additive, 20 / 14 / 8 by tier, x0.3 in Calm, none with reduced motion). The Rock Pool (r 1.3, surface 0.28) with its
// rock and foam edge ring, the Bob Ring (a coral and cream life ring floating in it), the Driftwood Log, the Shell Chimes on a driftwood frame,
// the Pebble Ball and the Sand Mound; the Surf Edge's shallow water at the back. BOTH layouts from the same kit; every position is the data
// module's (PlaceDef = wide, PlaceDef.tall = tall). Token colours only (OKLCH mixes of the eight). Mean luminance about 0.32 (RD-13).
import * as THREE from 'three';
import { type PlaceLook, type PlaceBuilt, type PropKit, type PlaceLight, Emitter, Batch, tok, col, sp, yawQ } from '../place.ts';
import type { PanelDef } from '../env.ts';
import PLACE from '../../data/place_ripple.ts';

const UP = new THREE.Vector3(0, 1, 0);
/** The chime frame's bar height (the shells hang `hang` below it; the physics poses each shell, this is its frame). */
const BAR_Y = 0.95;

// the sand: band-limited ripples and grain, dark where it is wet (the Wet Sand band, the sea side of it, the Rock Pool's bed)
const SAND = /* glsl */`
  vec2 p = vWP.xz;
  float fw = max(length(fwidth(p)), 1e-5);
  float n = pFbm(p * 2.3);
  float rip = sin(p.y * 9.0 + pN(p * 0.8) * 5.0) * (1.0 - smoothstep(0.02, 0.07, fw));
  vec3 c = uSand * (0.86 + 0.18 * n + 0.05 * rip);
  float wb = 1.0 - smoothstep(0.0, 0.3, max(abs(p.x - uWet.x) - uWet.z, abs(p.y - uWet.y) - uWet.w));
  wb = max(wb, smoothstep(uWet.y - uWet.w + 0.1, uWet.y - uWet.w - 0.25, p.y));
  wb = max(wb, 1.0 - smoothstep(uPool.z - 0.2, uPool.z + 0.15, length(p - uPool.xy)));
  diffuseColor.rgb = mix(c, uWetC * (0.9 + 0.2 * n), wb * 0.9);
`;
// the sea beyond the surf: shallow to deep lagoon, slow cream surf lines rolling in, the sky's glow on the far water
const SEA = /* glsl */`
void main() {
  float d = max(0.0, uShore - vWP.z);
  vec3 c = mix(uShallow, uDeep, smoothstep(0.0, 7.0, d));
  float w = fract(d * 0.33 + uTime * uMotion * 0.09 + pN(vec2(vWP.x * 0.12, d * 0.15)) * 0.7);
  float line = smoothstep(0.0, 0.04, w) * (1.0 - smoothstep(0.04, 0.12, w)) * (1.0 - smoothstep(3.0, 12.0, d));
  c = mix(c, uFoam, line * 0.6);
  c += uGlint * pow(pN(vec2(vWP.x * 1.3, d * 0.9) + uTime * uMotion * 0.05), 6.0) * smoothstep(3.0, 20.0, d);
  c = mix(c, uHaze, smoothstep(12.0, 38.0, d));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
// far headlands: two low dark-dusk silhouettes at the horizon, either side of the cove
const HEADLAND = /* glsl */`
void main() {
  float x = vUv.x;
  float h = 0.18 + 0.5 * smoothstep(0.62, 1.0, x) * (0.75 + 0.25 * pN(vec2(x * 9.0, 0.0))) + 0.32 * smoothstep(0.3, 0.0, x) * (0.8 + 0.2 * pN(vec2(x * 7.0, 3.0)));
  if (vUv.y > h) discard;
  gl_FragColor = vec4(mix(uLand, uHaze, 0.35 + 0.35 * vUv.y / max(h, 1e-3)), 1.0);
  #include <colorspace_fragment>
}`;

const LOOK: PlaceLook = {
  id: 'ripple',
  ceremonyDim: PLACE.ceremonyDim,
  skyBand: tok('lagoon', 'cream', 0.35, 0.85),
  sky: {
    uZenith: tok('lagoon', 'dusk', 0.45, 0.7), uInk: tok('lagoon', 'dusk', 0.3, 0.82), uPlum: tok('lagoon', 'cream', 0.4, 0.92), uHorizon: tok('cream', 'amber', 0.3, 0.95),
    uGlowWarm: tok('amber', 'cream', 0.25, 0.55), uGlowCool: tok('lagoon', 'lagoon', 0, 0.25), uBase: tok('lagoon', 'dusk', 0.3, 0.7), uWarm: tok('amber', 'amber', 0, 0.06),
    uFogNear: 10, uFogFar: 40,
  },
  light(layout: 0 | 1): PlaceLight {
    void layout;
    return {
      // the low gold sun from the front right, a wide soft cone over the whole cove
      key: tok('cream', 'amber', 0.45), keyI: 640, keyPos: [5.5, 5.0, 6.5], keyAim: [0, 0, -0.5], keyAngle: 1.2,
      rim: tok('lagoon', 'cream', 0.2), rimI: 2.4, rimDir: [-0.35, 0.45, -0.82],
      fillSky: tok('lagoon', 'cream', 0.45), fillGround: tok('amber', 'cream', 0.5, 0.8), fillI: 2.6,
      keyTint: [1.0, 0.86, 0.62],
    };
  },
  panels: [
    { dir: new THREE.Vector3(0.55, 0.45, 0.7).normalize(), dist: 4.5, w: 2.6, h: 1.6, color: [1.0, 0.86, 0.6], k: 6.5, soft: 0.6, radius: 0.7 },    // the sun, gold
    { dir: new THREE.Vector3(0.0, 1, 0.1).normalize(), dist: 4.5, w: 4.4, h: 1.2, color: [0.62, 0.86, 0.95], k: 3.2, soft: 0.4, radius: 0.5 },     // the open sky
    { dir: new THREE.Vector3(-0.3, 0.25, -0.92).normalize(), dist: 4.5, w: 3.6, h: 0.9, color: [0.36, 0.8, 0.9], k: 5.0, soft: 0.3, radius: 0.3 },  // the sea light
    { dir: new THREE.Vector3(-0.8, 0.2, 0.55).normalize(), dist: 4.5, w: 2.4, h: 2.4, color: [0.95, 0.82, 0.62], k: 1.2, soft: 1.0, radius: 1.0 },  // warm sand bounce
  ] satisfies PanelDef[],

  build(kit: PropKit, layout: 0 | 1): PlaceBuilt {
    const tall = layout === 1, T = PLACE.tall;
    const g = new THREE.Group(); g.name = `ripple-${tall ? 'tall' : 'wide'}`;
    const B = new Batch();
    const th = (i: number): { x: number; z: number; yaw: number } => (tall ? T.things[i] : PLACE.things[i]);
    const zn = (i: number): { x: number; z: number; r?: number; hx?: number; hz?: number } => (tall ? T.zones[i] : PLACE.zones[i]);
    const pool = zn(0), surf = zn(1), wet = tall ? T.patches[0] : PLACE.patches[0];
    const shore = surf.z - (surf.hz ?? 0.25);
    // ---- materials ----
    const sandU = { uSand: { value: col(tok('amber', 'cream', 0.55, 0.63)) }, uWetC: { value: col(tok('amber', 'cream', 0.45, 0.5)) },
      uWet: { value: new THREE.Vector4(wet.x, wet.z, wet.hx ?? 3.4, wet.hz ?? 0.35) }, uPool: { value: new THREE.Vector4(pool.x, pool.z, pool.r ?? 1.3, 0) } };
    const sand = kit.surface('sand', [1, 1, 1], 0.95, SAND, sandU, 0.25);
    const rock = kit.mat('rock', tok('ink', 'dusk', 0.35, 1.05), 0.9, 0.25), drift = kit.mat('drift', tok('amber', 'cream', 0.7, 0.66), 0.9, 0.2);
    const coral = kit.mat('ring', tok('coral', 'amber', 0.15), 0.6, 0.35), cream = kit.mat('cream', tok('cream', 'amber', 0.15, 0.95), 0.6, 0.35);
    const shellM = kit.mat('shell', tok('cream', 'coral', 0.3), 0.5, 0.4), stringM = kit.mat('string', tok('cream', 'amber', 0.2, 0.8), 0.9, 0.1);
    const pebble = kit.mat('pebble', tok('ink', 'cream', 0.5, 0.9), 0.55, 0.35);
    const unitIco = kit.geo('ico', () => new THREE.IcosahedronGeometry(1, 1)), unitCyl = kit.cyl(1, 1, 1, 12);
    const unitCylX = kit.geo('cylX', () => new THREE.CylinderGeometry(1, 1, 1, 12).rotateZ(Math.PI / 2));

    // ---- the ground (sand), the sea, the far headlands ----
    g.add(kit.ground(sand));
    const seaU = { uShore: { value: shore }, uShallow: { value: col(tok('lagoon', 'cream', 0.25, 0.85)) }, uDeep: { value: col(tok('lagoon', 'dusk', 0.45, 0.62)) },
      uFoam: { value: col(tok('cream')) }, uGlint: { value: col(tok('amber', 'cream', 0.5, 0.5)) }, uHaze: { value: col(tok('cream', 'lagoon', 0.35, 0.9)) } };
    const sea = kit.card(SEA, seaU, 120, 60, 0, 0.01, shore - 30, 0, -60);
    sea.rotation.x = -Math.PI / 2; g.add(sea);
    const seaM = sea.material as THREE.ShaderMaterial;
    const headU = { uLand: { value: col(tok('dusk', 'lagoon', 0.3, 0.75)) }, uHaze: { value: col(tok('cream', 'lagoon', 0.35, 0.9)) } };
    g.add(kit.card(HEADLAND, headU, 90, 7, 0, 3.2, shore - 46, 0, -70));

    // ---- the Surf Edge (shallow water at the back; its surface rises 0.06 -> 0.12 on a wave every 7 to 10 s) ----
    const surfW = kit.water('box', surf.x, surf.z, 0, (surf.hx ?? 3.4) + 4, (surf.hz ?? 0.25) + 0.1, 0.06, tok('lagoon', 'dusk', 0.25, 0.8), tok('lagoon', 'cream', 0.3), tok('lagoon', 'cream', 0.4, 0.95), tok('cream'), 1, 0.45);
    g.add(surfW.mesh);

    // ---- the Rock Pool: water (r 1.3, surface 0.28), a ring of dark rocks hiding its side, a foam band ----
    const pr = pool.r ?? 1.3, poolW = kit.water('disc', pool.x, pool.z, pr + 0.06, 0, 0, 0.28, tok('lagoon', 'dusk', 0.35, 0.72), tok('lagoon', 'cream', 0.2, 0.9), tok('lagoon', 'cream', 0.45, 0.95), tok('cream'), 0.7, 0.5);
    g.add(poolW.mesh);
    const nR = 18;
    for (let i = 0; i < nR; i++) {
      const a = (i / nR) * Math.PI * 2 + 0.17 * Math.sin(i * 2.3), rr = 0.17 + 0.06 * Math.abs(Math.sin(i * 1.7));
      B.add('rock', unitIco, rock, pool.x + Math.cos(a) * (pr + 0.05), 0.17 + 0.04 * Math.sin(i * 3.1), pool.z + Math.sin(a) * (pr + 0.05), rr * 1.25, rr * 0.95, rr * 1.1, yawQ(i * 1.3));
    }
    // a few rocks on the sand, outside the bounds at the back corners and the sides
    for (const [x, z, r] of tall ? [[-2.0, -3.3, 0.35], [2.05, 1.2, 0.3], [-2.1, 2.6, 0.26]] : [[-3.85, -2.0, 0.4], [3.9, 0.8, 0.32], [-3.95, 1.9, 0.28]]) {
      B.add('rock', unitIco, rock, x, r * 0.55, z, r * 1.3, r, r * 1.15, yawQ(x * 2.1));
      kit.shadow(x, z, r * 1.2, r * 1.1, 0.35);
    }

    // ---- the Bob Ring: a coral life ring with four cream bands, floating in the pool (a mover: part 0) ----
    const br = th(1), bd = PLACE.things[1], ringR = bd.size[0], segR = bd.size[1];
    const bob = new THREE.Group(); bob.position.set(br.x, 0.28, br.z);
    const torus = kit.mesh(kit.geo('bring', () => new THREE.TorusGeometry(ringR, segR, 10, 36).rotateX(Math.PI / 2)), coral, 0, 0, 0, 3); bob.add(torus);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4, b = kit.mesh(kit.cyl(segR * 1.12, segR * 1.12, 0.09, 12), cream, Math.cos(a) * ringR, 0, Math.sin(a) * ringR, 3);
      b.quaternion.setFromUnitVectors(UP, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))); bob.add(b);
    }
    g.add(bob);

    // ---- the Driftwood Log (lying along its yaw) with two broken branch stubs ----
    const dl = th(2), dd = PLACE.things[2], logR = dd.size[0], logL = dd.size[1];
    const lq = yawQ(-dl.yaw);
    B.add('drift', unitCylX, drift, dl.x, logR, dl.z, logL - 0.1, logR, logR, lq);
    const ax = Math.cos(dl.yaw), az = Math.sin(dl.yaw);
    B.add('drift', unitCyl, drift, dl.x + ax * 0.45 - az * 0.12, logR + 0.14, dl.z + az * 0.45 + ax * 0.12, 0.05, 0.3, 0.05, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax, 0, az), 0.6));
    B.add('drift', unitCyl, drift, dl.x - ax * 0.55 + az * 0.1, logR + 0.1, dl.z - az * 0.55 - ax * 0.1, 0.04, 0.22, 0.04, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax, 0, az), -0.7));
    kit.shadow(dl.x, dl.z, Math.abs(ax) * logL * 0.55 + 0.25, Math.abs(az) * logL * 0.55 + 0.25, 0.4);

    // ---- the Shell Chimes: a driftwood frame, five shells on strings (movers: one per part, PropWorldLike's part order) ----
    const sc = th(3), sd = PLACE.things[3], n = sd.p.n ?? 5, span = sd.p.span ?? 1.2, hang = sd.p.hang ?? 0.5, shR = sd.size[0], shL = sd.size[1];
    const cx = Math.cos(sc.yaw), cz = Math.sin(sc.yaw), half = span / 2 + 0.18, postR = sd.p.postR ?? 0.08;
    for (const s of [-1, 1]) B.add('drift', unitCyl, drift, sc.x + cx * half * s, (BAR_Y + 0.06) / 2, sc.z + cz * half * s, postR, BAR_Y + 0.06, postR);
    B.add('drift', unitCylX, drift, sc.x, BAR_Y + 0.04, sc.z, 2 * half + 0.12, 0.05, 0.05, yawQ(-sc.yaw));
    kit.shadow(sc.x, sc.z, Math.abs(cx) * half + 0.2, Math.abs(cz) * half + 0.2, 0.3);
    const shells: THREE.Object3D[] = [];
    for (let k = 0; k < n; k++) {
      const o = (n > 1 ? k / (n - 1) - 0.5 : 0) * span, sg = new THREE.Group();
      sg.position.set(sc.x + cx * o, BAR_Y - hang, sc.z + cz * o);
      const shell = kit.mesh(kit.geo('shell', () => new THREE.ConeGeometry(shR * 1.25, shL + 2 * shR, 7, 1)), shellM, 0, 0, 0, 3); shell.rotation.x = Math.PI; sg.add(shell);
      sg.add(kit.mesh(kit.cyl(0.006, 0.006, hang - shL / 2, 4), stringM, 0, (hang + shL / 2) / 2, 0, 3));
      g.add(sg); shells.push(sg);
    }

    // ---- the Pebble Ball (a mover) ----
    const pb = th(4), pR = PLACE.things[4].size[0];
    const ball = new THREE.Group(); ball.position.set(pb.x, pR, pb.z);
    ball.add(kit.mesh(kit.sphere(pR, 20, 14), pebble, 0, 0, 0, 2));
    const band = kit.mesh(kit.geo('pband', () => new THREE.TorusGeometry(pR * 0.995, 0.014, 6, 28)), cream, 0, 0, 0, 2); band.rotation.set(0.5, 0.2, 0); ball.add(band);
    g.add(ball);

    // ---- the Sand Mound: a spherical cap of sand (r 0.9, its top 0.25 m up) ----
    const sm = th(5), mr = PLACE.things[5].size[0], mt = PLACE.things[5].size[1];
    const capT = Math.acos((mr - mt) / mr);
    g.add(kit.mesh(kit.geo(`mound${mr},${mt}`, () => new THREE.SphereGeometry(mr, 32, 10, 0, Math.PI * 2, 0, capT)), sand, sm.x, mt - mr, sm.z, 1));
    kit.shadow(sm.x, sm.z + 0.1, mr * 0.95, mr * 0.8, 0.22);

    B.flush(kit, g);
    const shm = kit.shadowMesh(); if (shm) g.add(shm);

    // ---- warm spray motes over the surf (additive) ----
    const SPR: [number, number, number] = [1.0, 0.86, 0.6];
    const spray = new Emitter([20, 14, 8], false, (p, r) => {
      p.emit(sp((r() - 0.5) * (tall ? 4.6 : 7.5), 0.1 + r() * 0.2, shore + 0.1 + r() * 0.5, (r() - 0.5) * 0.15, 0.25 + r() * 0.25, 0.1 + r() * 0.1, 1.2 + r() * 1.0, 0.01 + r() * 0.008, SPR, 0.65, 0.6));
    }, 6);
    g.add(spray.particles.mesh); kit.own(spray);

    const movers: (THREE.Object3D | readonly THREE.Object3D[] | null)[] = [null, bob, null, shells, ball, null];
    let t = 0;
    return {
      group: g, movers, moverKind: [0, 1, 0, 1, 1, 0], heat: null,
      update(dt, time, quiet, reduced, tier) {
        t += dt;
        const m = reduced ? 0 : quiet ? 0.3 : 1;
        seaM.uniforms.uTime.value = t; seaM.uniforms.uMotion.value = m;
        poolW.u.uTime.value = t; poolW.u.uMotion.value = m; surfW.u.uTime.value = t; surfW.u.uMotion.value = m;
        // the surf's swell (render only: a slow rise and fall of the shallow water, 0.06 to 0.12 m, about every 8.5 s; still with reduced motion)
        const sw = 0.5 - 0.5 * Math.cos((t / 8.5) * Math.PI * 2);
        surfW.mesh.position.y = 0.06 + 0.06 * sw * sw * m;
        spray.update(dt, time, quiet, reduced, tier);
      },
      dispose() { g.removeFromParent(); },
    };
  },
};
export default LOOK;
