// PLAYGROUND: Rainleaf Garden's look (PLACES.md 4.5; PLAYGROUND_BUILD.md 9 and 13: one lazy chunk, at most 45 KB with PG_AUDIO's
// src/audio/places/rainleaf.ts and PG_DATA's src/data/place_rainleaf.ts). A corner of a garden in soft rain at dusk: giant leaves overhead and
// behind (backdrop cards, with coral mushroom caps at their feet), dark loam with a wet sheen, three shallow Splash Spots that mirror the plum
// sky (puddles: no edge ring), flat grey-dusk Stepping Stones set into the loam, rain streaks (normal blend, 120 / 80 / 40 by tier, x0.3 in
// Calm, none with reduced motion) in showers that come and go (40 s on, 30 s off), a dim cream key and a lagoon rim. The Leaf Teeter (a leaf
// board on a pebble pivot), the Moss Bouncer, the Drip Leaf (its stalk and its big leaf, drips from the tip into the Leaf Drip zone;
// thingFx: the shower when it is tapped) and the Seed Pod. BOTH layouts from the same kit, every position the data module's. Token colours.
import * as THREE from 'three';
import { type PlaceLook, type PlaceBuilt, type PropKit, type PlaceLight, Emitter, Batch, tok, col, sp, yawQ } from '../place.ts';
import type { PanelDef } from '../env.ts';
import PLACE from '../../data/place_rainleaf.ts';

// dark loam: fine crumbs, damp patches with a sheen, a few fallen leaf flecks
const LOAM = /* glsl */`
  vec2 p = vWP.xz;
  float fw = max(length(fwidth(p)), 1e-5);
  float n = pFbm(p * 2.6), d = pN(p * 0.55);
  float crumb = pN(p * 23.0) * (1.0 - smoothstep(0.01, 0.04, fw));
  vec3 c = uLoam * (0.8 + 0.3 * n + 0.12 * crumb);
  c = mix(c, uDamp, smoothstep(0.45, 0.7, d) * 0.6);
  float fl = step(0.93, pH(floor(p * 4.0))) * (1.0 - smoothstep(0.18, 0.3, length(fract(p * 4.0) - 0.5))) * (1.0 - smoothstep(0.03, 0.08, fw));
  diffuseColor.rgb = mix(c, uFleck, fl * 0.7);
`;
// the leaf (a teeter board, the drip leaf): a teal leaf with a paler midrib and veins, its outline cut by the uv (alpha test)
const LEAF = /* glsl */`
  vec2 q = vLeaf;
  float w = 0.5 * sin(3.14159 * clamp(q.x, 0.0, 1.0)) * (1.0 - 0.25 * q.x);
  if (abs(q.y) > w) discard;
  float rib = 1.0 - smoothstep(0.0, 0.025, abs(q.y));
  float vein = (1.0 - smoothstep(0.0, 0.05, abs(fract(q.x * 7.0 - abs(q.y) * 3.0) - 0.5) - 0.42)) * 0.5;
  diffuseColor.rgb = mix(diffuseColor.rgb * (0.85 + 0.25 * (1.0 - abs(q.y) / max(w, 1e-3))), uRib, max(rib, vein * 0.6));
`;
// the garden behind: giant teal leaves against the dusk, coral mushroom caps at their feet, a soft mist low down
const GARDEN = /* glsl */`
void main() {
  vec2 p = vec2(vUv.x * 9.0, vUv.y);
  vec3 c = vec3(0.0); float a = 0.0;
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float x = p.x * (1.0 + fl * 0.6) + fl * 3.7, i = floor(x), f = fract(x) - 0.5;
    float h = 0.55 + 0.4 * pH(vec2(i, fl)) - fl * 0.12;
    float lean = (pH(vec2(i, 9.0 + fl)) - 0.5) * 0.5;
    float yy = p.y / h, xx = f - lean * yy;
    float w = 0.42 * sin(3.14159 * clamp(yy, 0.0, 1.0));
    if (yy < 1.0 && abs(xx) < w && a < 0.5) {
      float rib = 1.0 - smoothstep(0.0, 0.03, abs(xx));
      c = mix(mix(uLeaf, uLeafFar, fl), uRib, rib * 0.5) * (0.8 + 0.3 * yy); a = 1.0;
    }
  }
  // mushrooms at the feet of the leaves
  float mx = fract(p.x * 1.3) - 0.5, mi = floor(p.x * 1.3);
  if (pH(vec2(mi, 4.0)) > 0.45) {
    float capY = 0.09 + 0.05 * pH(vec2(mi, 5.0)), capR = 0.16 + 0.06 * pH(vec2(mi, 6.0));
    if (abs(mx) < 0.04 && p.y < capY) { c = uStem; a = 1.0; }
    float e = length(vec2(mx / capR, (p.y - capY) / (capR * 0.5)));
    if (e < 1.0 && p.y > capY - 0.01) { c = mix(uCap, uStem, step(0.75, pN(vec2(mx * 30.0, p.y * 30.0))) * 0.6); a = 1.0; }
  }
  if (a < 0.5) discard;
  c = mix(c, uMist, (1.0 - smoothstep(0.0, 0.25, p.y)) * 0.45);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const LOOK: PlaceLook = {
  id: 'rainleaf',
  ceremonyDim: PLACE.ceremonyDim,
  skyBand: tok('plum', 'dusk', 0.5, 1.2),
  sky: {
    uZenith: tok('ink', 'plum', 0.6, 0.9), uInk: tok('plum', 'ink', 0.3), uPlum: tok('plum', 'dusk', 0.45, 1.05), uHorizon: tok('dusk', 'lagoon', 0.3, 0.85),
    uGlowWarm: tok('coral', 'amber', 0.4, 0.3), uGlowCool: tok('lagoon', 'lagoon', 0, 0.22), uBase: tok('ink', 'dusk', 0.4, 0.9), uWarm: tok('coral', 'coral', 0, 0.04),
    uFogNear: 8, uFogFar: 32,
  },
  light(layout: 0 | 1): PlaceLight {
    void layout;
    return {
      // a dim cream key through the rain from the front left, a lagoon rim off the wet leaves behind
      key: tok('cream', 'amber', 0.15), keyI: 520, keyPos: [-4.5, 6.0, 5.5], keyAim: [0.3, 0, -0.5], keyAngle: 1.15,
      rim: tok('lagoon', 'cream', 0.15), rimI: 2.8, rimDir: [0.4, 0.45, -0.8],
      fillSky: tok('dusk', 'lagoon', 0.35), fillGround: tok('plum', 'dusk', 0.4), fillI: 2.8,
      keyTint: [1.0, 0.92, 0.78],
    };
  },
  panels: [
    { dir: new THREE.Vector3(-0.55, 0.6, 0.58).normalize(), dist: 4.5, w: 2.6, h: 1.8, color: [1.0, 0.92, 0.8], k: 4.5, soft: 0.7, radius: 0.8 },     // the soft key
    { dir: new THREE.Vector3(0.0, 1, 0.1).normalize(), dist: 4.5, w: 4.0, h: 1.4, color: [0.5, 0.42, 0.75], k: 2.4, soft: 0.5, radius: 0.6 },      // the dusk sky
    { dir: new THREE.Vector3(0.4, 0.35, -0.85).normalize(), dist: 4.5, w: 1.2, h: 3.0, color: [0.36, 0.82, 0.92], k: 7.0, soft: 0.2, radius: 0.3 }, // the wet leaves' rim
    { dir: new THREE.Vector3(0.8, 0.1, 0.55).normalize(), dist: 4.5, w: 2.4, h: 2.4, color: [0.42, 0.3, 0.62], k: 0.8, soft: 1.0, radius: 1.0 },   // violet fill
  ] satisfies PanelDef[],

  build(kit: PropKit, layout: 0 | 1): PlaceBuilt {
    const tall = layout === 1, T = PLACE.tall;
    const g = new THREE.Group(); g.name = `rainleaf-${tall ? 'tall' : 'wide'}`;
    const B = new Batch();
    const th = (i: number): { x: number; z: number; yaw: number } => (tall ? T.things[i] : PLACE.things[i]);
    const zn = (i: number): { x: number; z: number; r?: number } => (tall ? T.zones[i] : PLACE.zones[i]);
    const stonesP = tall ? T.patches[0] : PLACE.patches[0];
    // ---- materials ----
    const loamU = { uLoam: { value: col(tok('plum', 'ink', 0.35, 1.05)) }, uDamp: { value: col(tok('dusk', 'ink', 0.5, 0.95)) }, uFleck: { value: col(tok('coral', 'amber', 0.4, 0.62)) } };
    const loam = kit.surface('loam', [1, 1, 1], 0.55, LOAM, loamU, 0.55);
    const stone = kit.mat('stone', tok('dusk', 'cream', 0.3, 0.72), 0.7, 0.4), pebble = kit.mat('pebble', tok('ink', 'cream', 0.45, 0.85), 0.6, 0.35);
    const moss = kit.surface('moss', [1, 1, 1], 0.95, '  float n = pFbm(vWP.xz * 9.0); diffuseColor.rgb = mix(uM1, uM2, n);', { uM1: { value: col(tok('lagoon', 'ink', 0.55)) }, uM2: { value: col(tok('lagoon', 'felt', 0.35, 1.05)) } }, 0.15);
    const stalkM = kit.mat('stalk', tok('lagoon', 'ink', 0.5, 1.05), 0.7, 0.3), pod = kit.mat('pod', tok('coral', 'amber', 0.45, 0.82), 0.55, 0.35), podRib = kit.mat('podRib', tok('amber', 'cream', 0.4, 0.62), 0.6, 0.3);
    const leafU = { uRib: { value: col(tok('lagoon', 'cream', 0.4, 0.95)) } };
    const leafMat = (key: string): THREE.MeshStandardMaterial => {
      const m = kit.mat(key, tok('lagoon', 'ink', 0.4, 1.05), 0.45, 0.6);
      m.side = THREE.DoubleSide;
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, leafU);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLeaf;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeaf = vec2(uv.x, uv.y - 0.5);');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vLeaf; uniform vec3 uRib;').replace('#include <color_fragment>', `#include <color_fragment>\n{${LEAF}}`);
      };
      m.customProgramCacheKey = () => 'wh-pl-leaf';
      return m;
    };
    const leafM = leafMat('leaf');
    const unitCyl = kit.cyl(1, 1, 1, 14);

    // ---- the ground (loam) and the garden behind ----
    g.add(kit.ground(loam));
    const gU = { uLeaf: { value: col(tok('lagoon', 'ink', 0.5, 0.95)) }, uLeafFar: { value: col(tok('lagoon', 'dusk', 0.55, 0.8)) }, uRib: { value: col(tok('lagoon', 'cream', 0.3, 0.75)) },
      uStem: { value: col(tok('cream', 'dusk', 0.3, 0.8)) }, uCap: { value: col(tok('coral', 'plum', 0.2, 0.95)) }, uMist: { value: col(tok('dusk', 'lagoon', 0.35, 0.75)) } };
    const backZ = tall ? -5.4 : -4.4;
    g.add(kit.card(GARDEN, gU, 30, 4.5, 0, 2.2, backZ, 0, -70));
    g.add(kit.card(GARDEN, gU, 30, 4.5, tall ? -3.6 : -5.6, 2.2, 0, Math.PI / 2, -69));
    g.add(kit.card(GARDEN, gU, 30, 4.5, tall ? 3.6 : 5.6, 2.2, 0, -Math.PI / 2, -68));

    // ---- the Splash Spots: three shallow puddles mirroring the plum sky (no edge ring) ----
    const puddles: { u: Record<string, { value: number }> }[] = [];
    for (let k = 1; k <= 3; k++) {
      const z = zn(k), sy = PLACE.zones[k].surfaceY ?? 0.07;
      const w = kit.water('disc', z.x, z.z, z.r ?? 0.6, 0, 0, sy, tok('plum', 'ink', 0.4), tok('dusk', 'plum', 0.4, 0.9), tok('plum', 'dusk', 0.5, 1.2), tok('lagoon', 'cream', 0.4), 0.25, 0.62);
      g.add(w.mesh); puddles.push(w);
    }

    // ---- the Stepping Stones: six flush stones along a gentle curve inside their patch ----
    const shx = stonesP.hx ?? 0.9, shz = stonesP.hz ?? 0.3;
    for (let k = 0; k < 6; k++) {
      const u = k / 5 - 0.5, x = stonesP.x + u * 2 * shx * 0.92, z = stonesP.z + (0.5 - 2 * u * u) * shz * 0.9;
      B.add('stone', unitCyl, stone, x, 0.006, z, 0.15 + 0.03 * Math.sin(k * 2.1), 0.012, 0.13 + 0.03 * Math.cos(k * 1.7), yawQ(k * 0.9));
    }

    // ---- the Leaf Teeter: a leaf board on a pebble pivot (a mover: the board on its pivot) ----
    const lt = th(1), ld = PLACE.things[1], piv = ld.p.pivot ?? 0.24, lhx = ld.size[0], lhz = ld.size[2];
    B.add('pebble', kit.sphere(1, 16, 10), pebble, lt.x, piv * 0.5, lt.z, 0.2, piv * 0.62, 0.24);
    const board = new THREE.Group(); board.position.set(lt.x, piv, lt.z); board.rotation.y = -lt.yaw;
    const leafG = kit.geo(`leafb${lhx},${lhz}`, () => new THREE.PlaneGeometry(2 * lhx + 0.12, 2 * lhz + 0.2).rotateX(-Math.PI / 2));
    board.add(kit.mesh(leafG, leafM, 0, ld.size[1], 0, 2));
    board.add(kit.mesh(kit.box(2 * lhx * 0.92, ld.size[1] * 1.6, 2 * lhz * 0.55), stalkM, 0, 0, 0, 2));
    g.add(board);
    kit.shadow(lt.x, lt.z, lhx * 1.05, lhz * 1.1, 0.35);

    // ---- the Moss Bouncer: a soft moss cushion, flush (a mover: the pad's travel) ----
    const mb = th(2), md = PLACE.things[2], mr = md.size[0], mh = md.size[1];
    const pad = new THREE.Group(); pad.position.set(mb.x, mh, mb.z);
    const cush = kit.mesh(kit.geo(`moss${mr}`, () => new THREE.SphereGeometry(mr, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1)), moss, 0, -mh, 0, 2);
    pad.add(cush);
    g.add(pad);

    // ---- the Drip Leaf: a stalk, its big leaf arching over the Leaf Drip zone; drips from the tip ----
    const dl = th(3), dd = PLACE.things[3], drip = zn(4), stH = dd.size[1] * 2, stR = dd.size[0];
    B.add('stalk', unitCyl, stalkM, dl.x, stH / 2, dl.z, stR * 0.8, stH, stR * 0.8);
    const toDrip = new THREE.Vector2(drip.x - dl.x, drip.z - dl.z), dLen = Math.max(0.3, toDrip.length());
    const bigLeaf = kit.mesh(kit.geo('bigleaf', () => new THREE.PlaneGeometry(1.0, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0)), leafMat('leafBig'), dl.x, stH - 0.02, dl.z, 3);
    bigLeaf.scale.set(dLen + 0.35, 1, 0.95);
    bigLeaf.quaternion.copy(yawQ(-Math.atan2(toDrip.y, toDrip.x))).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.32));
    g.add(bigLeaf);
    kit.shadow(drip.x, drip.z, 0.55, 0.5, 0.25);
    const tipY = stH - Math.sin(0.32) * (dLen + 0.35) * 0.75;
    const DRP: [number, number, number] = [0.6, 0.84, 0.94];
    const drips = new Emitter([16, 12, 6], true, (p, r) => {
      p.emit(sp(drip.x + (r() - 0.5) * 0.35, tipY, drip.z + (r() - 0.5) * 0.3, 0, -0.4, 0, 0.6, 0.016, DRP, 0.85, 0, 7, 2, 2));
    }, 2.5);
    g.add(drips.particles.mesh); kit.own(drips);

    // ---- the Seed Pod (a mover): a coral pod with amber ribs ----
    const sp0 = th(5), pR = PLACE.things[5].size[0];
    const podG = new THREE.Group(); podG.position.set(sp0.x, pR, sp0.z);
    const body = kit.mesh(kit.sphere(pR, 18, 12), pod, 0, 0, 0, 2); body.scale.set(1, 1, 1.12); podG.add(body);
    for (let k = 0; k < 3; k++) { const rib = kit.mesh(kit.geo('prib', () => new THREE.TorusGeometry(pR * 1.0, 0.012, 5, 24)), podRib, 0, 0, 0, 2); rib.rotation.set(0, (k * Math.PI) / 3, 0); rib.scale.set(1, 1, 1.12); podG.add(rib); }
    g.add(podG);

    B.flush(kit, g);
    const shm = kit.shadowMesh(); if (shm) g.add(shm);

    // ---- the rain (normal-blend streaks) in showers: 40 s on, 30 s off, eased over 4 s ----
    const RAIN: [number, number, number] = [0.72, 0.8, 0.9];
    const W = tall ? 3.0 : 5.0, D = tall ? 4.2 : 3.4;
    const rain = new Emitter([120, 80, 40], true, (p, r) => {
      p.emit(sp((r() - 0.5) * 2 * W, 2.8 + r() * 0.8, (r() - 0.5) * 2 * D, 0.25, -5.5 - r(), 0.1, 0.62, 0.009, RAIN, 0.5, 0, 0, 2, 2));
    }, 120);
    g.add(rain.particles.mesh); kit.own(rain);
    let t = 0, shower = 1, shK = 0, finale = 0, q = false, rm = false, tr = 1;
    const movers: (THREE.Object3D | readonly THREE.Object3D[] | null)[] = [null, board, pad, null, null, podG];
    return {
      group: g, movers, moverKind: [0, 1, 0, 0, 0, 1], heat: null,
      update(dt, time, quiet, reduced, tier) {
        t += dt; q = quiet; rm = reduced; tr = tier;
        const m = reduced ? 0 : quiet ? 0.3 : 1;
        for (const w of puddles) { w.u.uTime.value = t; w.u.uMotion.value = m; }
        const on = (t % 70) < 40 ? 1 : 0;
        shower += (on * (1 - finale) - shower) * Math.min(1, dt / 4);
        rain.update(dt, time, quiet, reduced, tier, shower);
        shK = Math.max(0, shK - dt);
        drips.update(dt, time, quiet, reduced, tier, shK > 0 ? 6 : 0.4 + shower);
      },
      thingFx(thing, kind, amount) {
        if (kind === 2 && thing === -1) { finale = amount; return true; }   // the rain stops (the drips stay)
        if (kind !== 1 || thing !== 3) return false;
        shK = 2.5 * amount; drips.burst(Math.round(10 * amount), q, rm, tr);   // the leaf tips its shower
        return true;
      },
      dispose() { g.removeFromParent(); },
    };
  },
};
export default LOOK;
