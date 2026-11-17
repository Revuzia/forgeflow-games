// PLAYGROUND: Frostbell Ridge's look (PLACES.md 4.4; PLAYGROUND_BUILD.md 9 and 13: one lazy chunk, at most 45 KB with PG_AUDIO's
// src/audio/places/frostbell.ts and PG_DATA's src/data/place_frostbell.ts). A high snowy ledge on a clear, cold morning: a lagoon sky fading
// to cream at the horizon, a low cream sun with long light (the key, low from the left), dusk-blue shadows, plum mountain silhouettes with
// snow caps (backdrop cards), packed snow (cream with lagoon and dusk, held under L 0.80 so the jellies still read) with a band-limited
// sparkle, the Ice Pond (a dark gloss), the little Steam Pool (water, a snow edge ring hiding its side, wisps rising), drifting flakes (normal
// blend, 80 / 60 / 30 by tier, x0.3 in Calm, none with reduced motion). The Glide Ramp (ice, rails), the Icicle Bells on a rail, the Snowdrift
// Nest, the Snowball and the Shake Pine (its branch a mover; thingFx: the snow puff off the branch). BOTH layouts from the same kit, every
// position the data module's. Token colours only.
import * as THREE from 'three';
import { type PlaceLook, type PlaceBuilt, type PropKit, type PlaceLight, Emitter, Batch, tok, col, sp, yawQ } from '../place.ts';
import type { PanelDef } from '../env.ts';
import PLACE from '../../data/place_frostbell.ts';

/** The bells' rail height (each bell hangs `hang` below it; the physics poses each bell). */
const BAR_Y = 0.95;

// packed snow: cream with lagoon and dusk shading, soft drift ridges, a sparse sparkle that fades before it aliases
const SNOW = /* glsl */`
  vec2 p = vWP.xz;
  float fw = max(length(fwidth(p)), 1e-5);
  // (round 3: broad wind-shaped drifts with blue hollows, then a little fine texture: the round-2 fine mottle (0.6 m) read as dirty concrete)
  float big = pFbm(p * 0.42), n = pFbm(p * 2.2);
  vec3 c = mix(uShade, uSnow, 0.6 + 0.32 * smoothstep(0.2, 0.8, big) + 0.08 * n) * (0.985 + 0.03 * pN(p * vec2(0.7, 2.4)));
  vec2 q = p * 34.0;
  float s = step(0.982, pH(floor(q))) * (1.0 - smoothstep(0.2, 0.42, length(fract(q) - 0.5))) * (1.0 - smoothstep(0.004, 0.014, fw));
  diffuseColor.rgb = c + uSpark * s;
`;
// the Ice Pond: dark glossy ice with pale crack lines and frost at its rim
const ICE = /* glsl */`
  vec2 p = vWP.xz - uC.xy;
  float r = length(p) / uC.z;
  float fw = max(length(fwidth(vWP.xz)), 1e-5);
  float st = smoothstep(0.55, 1.0, sin((p.x + p.y * 0.6) * 2.4 + pN(p * 1.5) * 2.0)) * 0.3;
  vec3 c = mix(uDeep, uPale, 0.12 * pFbm(p * 3.0) + st);
  diffuseColor.rgb = mix(c, uPale, smoothstep(0.82, 1.0, r) * 0.8);
`;
// the mountains: three ranges of plum and dusk peaks, the far ones hazier, snow on their tops
const MOUNTAINS = /* glsl */`
void main() {
  vec3 c = vec3(0.0); float a = 0.0;
  for (int l = 0; l < 3; l++) {
    float fl = float(l), sc = 16.0 + fl * 9.0;
    float x = vUv.x * sc + fl * 4.7;
    float i = floor(x), f = fract(x);
    float hp = 0.45 + 0.55 * pH(vec2(i, fl)), sk = 0.3 + 0.4 * pH(vec2(i, fl + 7.0));
    float f2 = fract(x * 2.6 + 0.3 * fl);   // (round 3: a lower ridge on each slope, so a range is not one clean triangle per peak)
    float pk = hp * (f < sk ? f / sk : (1.0 - f) / (1.0 - sk)) + 0.1 * hp * (1.0 - abs(2.0 * f2 - 1.0)) + 0.04 * (pN(vec2(x * 6.0, fl)) - 0.5);
    pk = pk * (0.36 - 0.07 * fl) + 0.1 + 0.06 * fl;   // (round 3: low ranges on the horizon; round 2's filled the tall frame's sky like icicles)
    float pkS = 0.13 + (pk - 0.13) * uH;              // (the heights above the horizon line, per layout: the wide frame's long lens magnifies them)
    if (vUv.y < pkS && a < 0.5) {
      vec3 m = mix(uNear, uFar, fl / 2.0);
      float cl = pkS - (0.03 + 0.03 * pN(vec2(x * 13.0, fl + 2.0))) * uH;   // (a crisp, jagged snow line under the tallest peaks; a soft one read as light beams)
      m = mix(m, uCap, smoothstep(cl - 0.004, cl + 0.004, vUv.y) * step(0.3, pk));
      // (round 3: the low sun is on the left: each peak's left face lit, its right face in shade, less so in the haze; flat cut-outs read as paper)
      m *= mix(1.0, mix(1.14, 0.8, smoothstep(sk - 0.015, sk + 0.015, f)), 1.0 - 0.45 * fl / 2.0);
      c = m; a = 1.0;
    }
  }
  if (a < 0.5) discard;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const LOOK: PlaceLook = {
  id: 'frostbell',
  ceremonyDim: PLACE.ceremonyDim,
  // (round 3: cream-lagoon mixes pass through green in OKLCH: the horizon, the band and the snow's fill are lagoon-dusk blues or a cream-amber now)
  skyBand: tok('lagoon', 'dusk', 0.2, 1.0),
  sky: {
    uZenith: tok('lagoon', 'dusk', 0.4, 0.68), uInk: tok('lagoon', 'dusk', 0.25, 0.8), uPlum: tok('lagoon', 'dusk', 0.12, 0.88), uHorizon: tok('cream', 'amber', 0.12, 0.84),
    uGlowWarm: tok('cream', 'amber', 0.3, 0.45), uGlowCool: tok('lagoon', 'lagoon', 0, 0.2), uBase: tok('lagoon', 'dusk', 0.25, 0.95), uWarm: tok('cream', 'cream', 0, 0.04),
    uFogNear: 10, uFogFar: 40,
  },
  light(layout: 0 | 1): PlaceLight {
    void layout;
    return {
      // the low cream sun from the left, long light across the snow
      key: tok('cream'), keyI: 470, keyPos: [-7.5, 3.6, 4.0], keyAim: [0.5, 0, -0.5], keyAngle: 1.1,
      rim: tok('lagoon', 'cream', 0.3), rimI: 2.2, rimDir: [0.45, 0.5, -0.75],
      fillSky: tok('lagoon', 'dusk', 0.35), fillGround: tok('lagoon', 'dusk', 0.2, 0.9), fillI: 2.0,
      keyTint: [1.0, 0.97, 0.9],
    };
  },
  panels: [
    { dir: new THREE.Vector3(-0.8, 0.35, 0.45).normalize(), dist: 4.5, w: 2.4, h: 1.2, color: [1.0, 0.93, 0.8], k: 6.0, soft: 0.5, radius: 0.6 },     // the low sun
    { dir: new THREE.Vector3(0.0, 1, 0.1).normalize(), dist: 4.5, w: 4.4, h: 1.4, color: [0.6, 0.86, 0.96], k: 3.0, soft: 0.4, radius: 0.5 },      // the clear sky
    { dir: new THREE.Vector3(0.45, 0.3, -0.84).normalize(), dist: 4.5, w: 1.0, h: 3.0, color: [0.4, 0.82, 0.94], k: 6.5, soft: 0.2, radius: 0.3 },  // the cold rim
    { dir: new THREE.Vector3(0.7, -0.1, 0.7).normalize(), dist: 4.5, w: 3.0, h: 2.0, color: [0.86, 0.9, 0.95], k: 1.6, soft: 1.0, radius: 1.0 },   // snow bounce
  ] satisfies PanelDef[],

  build(kit: PropKit, layout: 0 | 1): PlaceBuilt {
    const tall = layout === 1, T = PLACE.tall;
    const g = new THREE.Group(); g.name = `frostbell-${tall ? 'tall' : 'wide'}`;
    const B = new Batch();
    const th = (i: number): { x: number; z: number; yaw: number } => (tall ? T.things[i] : PLACE.things[i]);
    const pond = tall ? T.patches[0] : PLACE.patches[0], steamZ = tall ? T.zones[1] : PLACE.zones[1];
    // ---- materials ----
    const snowU = { uSnow: { value: col(tok('cream', 'cream', 0, 0.66)) }, uShade: { value: col(tok('lagoon', 'dusk', 0.45, 1.08)) }, uSpark: { value: col(tok('cream', 'cream', 0, 0.7)) } };
    const snow = kit.surface('snow', [1, 1, 1], 0.9, SNOW, snowU, 0.3);
    const snowPlain = snow;   // (round 3: every snowy part in the ground's own snow: the plain cream bank, wedge and ball read beige against it)
    // (round 3: the ramp's ice a deeper glossy lagoon-dusk: the pale cyan slab read as a sheet of card)
    const ice = kit.mat('iceProp', tok('lagoon', 'dusk', 0.22, 1.02), 0.08, 0.95), wood = kit.mat('wood', tok('amber', 'cream', 0.45, 0.42), 0.85, 0.2);
    const pine = kit.mat('pine', tok('lagoon', 'ink', 0.62), 0.9, 0.2), stringM = kit.mat('string', tok('cream', 'dusk', 0.3, 0.8), 0.9, 0.1);
    const unitCyl = kit.cyl(1, 1, 1, 12), unitCylX = kit.geo('cylX', () => new THREE.CylinderGeometry(1, 1, 1, 12).rotateZ(Math.PI / 2)), unitBox = kit.box(1, 1, 1);

    // ---- the ground (snow) and the mountains ----
    g.add(kit.ground(snow));
    const mU = { uNear: { value: col(tok('dusk', 'plum', 0.2, 1.05)) }, uFar: { value: col(tok('dusk', 'lagoon', 0.4, 1.1)) }, uCap: { value: col(tok('dusk', 'lagoon', 0.62, 1.15)) }, uH: { value: tall ? 1 : 0.45 } };   // (caps an icy light blue: cream ones were the sky's own colour and read as cut-off peaks)
    g.add(kit.card(MOUNTAINS, mU, 80, 14, 0, 5.2, tall ? -15 : -13, 0, -70));

    // ---- the Ice Pond: dark gloss with cracks and a frosted rim (flush: no collider, y 0.004) ----
    const iceU = { uC: { value: new THREE.Vector4(pond.x, pond.z, pond.r ?? 1.4, 0) }, uDeep: { value: col(tok('dusk', 'lagoon', 0.45, 0.62)) }, uPale: { value: col(tok('cream', 'lagoon', 0.3, 0.85)) } };
    const pondM = kit.surface('icepond', [1, 1, 1], 0.08, ICE, iceU, 0.95);
    const pr = pond.r ?? 1.4;
    g.add(kit.mesh(kit.geo(`pond${pr}`, () => new THREE.CircleGeometry(pr, 56).rotateX(-Math.PI / 2)), pondM, pond.x, 0.004, pond.z, -48));

    // ---- the Steam Pool: water (surface 0.26) inside a snow bank ring, wisps rising ----
    const sr = steamZ.r ?? 1.0;
    const pool = kit.water('disc', steamZ.x, steamZ.z, sr + 0.05, 0, 0, 0.26, tok('lagoon', 'dusk', 0.3, 0.7), tok('lagoon', 'cream', 0.25, 0.9), tok('cream', 'lagoon', 0.3, 0.92), tok('cream'), 0.45, 0.55);
    g.add(pool.mesh);
    g.add(kit.mesh(kit.geo(`bank${sr}`, () => new THREE.TorusGeometry(sr + 0.06, 0.16, 8, 40).rotateX(Math.PI / 2).scale(1, 1.3, 1)), snowPlain, steamZ.x, 0.17, steamZ.z, 2));
    kit.shadow(steamZ.x, steamZ.z, sr + 0.2, sr + 0.2, 0.25);
    const STM: [number, number, number] = [0.94, 0.95, 0.97];
    const wisps = new Emitter([18, 12, 6], true, (p, r) => {
      const a = r() * 6.2832, d = Math.sqrt(r()) * sr * 0.9;
      p.emit(sp(steamZ.x + Math.cos(a) * d, 0.3, steamZ.z + Math.sin(a) * d, 0.02, 0.16 + 0.1 * r(), -0.01, 2.2 + r(), 0.12 + 0.08 * r(), STM, 0.22, 0.3));
    }, 5);
    g.add(wisps.particles.mesh); kit.own(wisps);

    // ---- the Glide Ramp: an ice slab sloping down toward its local +x (14 degrees, its top 0.5 m), rails, a snow wedge under the top ----
    const rp = th(1), rd = PLACE.things[1], hl = rd.size[0], ht = rd.size[1], hw = rd.size[2], ang = ((rd.p.angle ?? 14) * Math.PI) / 180, top = rd.p.top ?? 0.5;
    const rq = yawQ(-rp.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang));
    const cy = top - hl * Math.sin(ang) - ht * Math.cos(ang);
    B.add('ice', unitBox, ice, rp.x, cy, rp.z, 2 * hl, 2 * ht, 2 * hw, rq);
    const ox = Math.cos(rp.yaw), oz = Math.sin(rp.yaw), px = -oz, pz = ox;
    for (const s of [-1, 1]) B.add('rail', unitCylX, wood, rp.x + px * hw * s, cy + ht + 0.07, rp.z + pz * hw * s, 2 * hl, 0.03, 0.03, rq);
    // the wedge under the high end (snow), from the ground to the slab's underside
    B.add('snowp', unitBox, snowPlain, rp.x - ox * hl * 0.6, (top - 0.2) / 2, rp.z - oz * hl * 0.6, hl * 0.8, top - 0.2, 2 * hw * 0.92, yawQ(-rp.yaw));
    kit.shadow(rp.x, rp.z, Math.abs(ox) * hl + Math.abs(px) * hw + 0.1, Math.abs(oz) * hl + Math.abs(pz) * hw + 0.1, 0.3);

    // ---- the Icicle Bells: a rail on two posts, four icicles on strings (movers: one per part) ----
    const ib = th(3), idf = PLACE.things[3], n = idf.p.n ?? 4, span = idf.p.span ?? 1.0, hang = idf.p.hang ?? 0.5, iR = idf.size[0], iL = idf.size[1];
    const cx = Math.cos(ib.yaw), cz = Math.sin(ib.yaw), half = span / 2 + 0.18;
    for (const s of [-1, 1]) B.add('wood', unitCyl, wood, ib.x + cx * half * s, (BAR_Y + 0.06) / 2, ib.z + cz * half * s, 0.08, BAR_Y + 0.06, 0.08);
    B.add('wood', unitCylX, wood, ib.x, BAR_Y + 0.04, ib.z, 2 * half + 0.12, idf.p.railR ?? 0.08, idf.p.railR ?? 0.08, yawQ(-ib.yaw));
    B.add('snowp', unitCylX, snowPlain, ib.x, BAR_Y + 0.11, ib.z, 2 * half + 0.1, 0.06, 0.07, yawQ(-ib.yaw));
    kit.shadow(ib.x, ib.z, Math.abs(cx) * half + 0.2, Math.abs(cz) * half + 0.2, 0.25);
    const bells: THREE.Object3D[] = [];
    for (let k = 0; k < n; k++) {
      const o = (n > 1 ? k / (n - 1) - 0.5 : 0) * span, bg = new THREE.Group();
      bg.position.set(ib.x + cx * o, BAR_Y - hang, ib.z + cz * o);
      const ic = kit.mesh(kit.geo('icicle', () => new THREE.ConeGeometry(iR * 1.1, iL + 2 * iR, 8, 1)), ice, 0, 0, 0, 3); ic.rotation.x = Math.PI; bg.add(ic);
      bg.add(kit.mesh(kit.cyl(0.006, 0.006, hang - iL / 2, 4), stringM, 0, (hang + iL / 2) / 2, 0, 3));
      g.add(bg); bells.push(bg);
    }

    // ---- the Snowdrift Nest: a ring of snow drifts with its gap toward its yaw, a soft hollow inside ----
    const sn = th(4), sd = PLACE.things[4], ringR = sd.size[0], segR = sd.size[1], gap = (sd.size[2] * Math.PI) / 180, nSeg = sd.p.segments ?? 5;
    const arc = 2 * Math.PI - gap, segArc = arc / nSeg;
    for (let i = 0; i < nSeg; i++) {
      const a = gap / 2 + segArc * (i + 0.5) + sn.yaw, len = 2 * ringR * Math.sin(segArc / 2) + segR * 1.6;
      // (round 3: low overlapping mounds in the ground's own snow (top at the collider's 2 x segR), so the nest reads as drifts, not separate sausages)
      B.add('drift', kit.sphere(1, 18, 10), snow, sn.x + Math.cos(a) * ringR, segR * 0.3, sn.z + Math.sin(a) * ringR, len * 0.72, segR * 1.7, segR * 2.2, yawQ(-a + Math.PI / 2));
    }
    kit.shadow(sn.x, sn.z, ringR * 0.9, ringR * 0.9, 0.22);

    // ---- the Snowball (a mover) ----
    const sb = th(5), bR = PLACE.things[5].size[0];
    const ball = new THREE.Group(); ball.position.set(sb.x, bR, sb.z);
    ball.add(kit.mesh(kit.geo('sball', () => new THREE.IcosahedronGeometry(bR, 2)), snowPlain, 0, 0, 0, 2));
    g.add(ball);

    // ---- the Shake Pine: a trunk, three snowy tiers above body height, the low branch on its hinge (a mover: part 1; part 0 the trunk) ----
    const sp0 = th(6), pd = PLACE.things[6], trR = pd.size[0], trH = pd.size[1], pivY = pd.p.pivotY ?? 0.95, brR = pd.p.branchR ?? 0.08, brL = pd.p.branchL ?? 0.5;
    B.add('trunk', unitCyl, wood, sp0.x, trH / 2 + 0.25, sp0.z, trR, trH + 0.5, trR);
    for (const [y, r, h] of [[1.25, 0.5, 0.75], [1.7, 0.4, 0.65], [2.1, 0.28, 0.55]] as const) {
      B.add('pine', kit.geo('cone', () => new THREE.ConeGeometry(1, 1, 9, 1)), pine, sp0.x, y + h / 2, sp0.z, r, h, r, yawQ(y * 2));
      B.add('snowc', kit.geo('cone', () => new THREE.ConeGeometry(1, 1, 9, 1)), snowPlain, sp0.x, y + h * 0.72, sp0.z, r * 0.62, h * 0.45, r * 0.62, yawQ(y * 2));
    }
    kit.shadow(sp0.x, sp0.z, 0.5, 0.45, 0.3);
    const branch = new THREE.Group(); branch.position.set(sp0.x + brL / 2 + trR, pivY, sp0.z);
    const bm = kit.mesh(kit.capsule(brR, brL), wood, 0, 0, 0, 2); bm.rotation.z = Math.PI / 2; branch.add(bm);
    const tuft = kit.mesh(kit.geo('cone', () => new THREE.ConeGeometry(1, 1, 9, 1)), pine, brL * 0.2, 0.12, 0, 2); tuft.scale.set(0.2, 0.3, 0.2); branch.add(tuft);
    const cap = kit.mesh(kit.sphere(1, 12, 8), snowPlain, brL * 0.1, brR + 0.03, 0, 2); cap.scale.set(brL * 0.42, 0.05, 0.11); branch.add(cap);
    g.add(branch);
    const trunkPart = new THREE.Object3D();

    B.flush(kit, g);
    const shm = kit.shadowMesh(); if (shm) g.add(shm);

    // ---- flakes drifting (normal blend), and the pine's snow puff (thingFx 6) ----
    const FLK: [number, number, number] = [0.95, 0.96, 0.98];
    const W = tall ? 3.2 : 5.2, D = tall ? 4.4 : 3.6;
    const flakes = new Emitter([80, 60, 30], true, (p, r) => {
      p.emit(sp((r() - 0.5) * 2 * W, 2.6 + r() * 1.2, (r() - 0.5) * 2 * D, 0.12 + (r() - 0.5) * 0.1, -0.35 - 0.2 * r(), (r() - 0.5) * 0.08, 8 + 3 * r(), 0.014 + 0.012 * r(), FLK, 0.85, 0.05, 0, 0, 2));
    }, 9);
    g.add(flakes.particles.mesh); kit.own(flakes);
    const puff = new Emitter([40, 30, 16], true, (p, r) => {
      const bx = branch.position.x, bz = branch.position.z;
      p.emit(sp(bx + (r() - 0.5) * 0.5, pivY - 0.05, bz + (r() - 0.5) * 0.4, (r() - 0.5) * 0.4, -0.2 - 0.3 * r(), (r() - 0.5) * 0.4, 0.9 + 0.5 * r(), 0.03 + 0.03 * r(), FLK, 0.75, 1.5, 1.2));
    }, 0);
    g.add(puff.particles.mesh); kit.own(puff);
    let q = false, rm = false, tr = 1;

    const movers: (THREE.Object3D | readonly THREE.Object3D[] | null)[] = [null, null, null, bells, null, ball, [trunkPart, branch]];
    let t = 0;
    return {
      group: g, movers, moverKind: [0, 0, 0, 1, 0, 1, 1], heat: null,
      update(dt, time, quiet, reduced, tier) {
        t += dt;
        const m = reduced ? 0 : quiet ? 0.3 : 1;
        pool.u.uTime.value = t; pool.u.uMotion.value = m;
        wisps.update(dt, time, quiet, reduced, tier);
        flakes.update(dt, time, quiet, reduced, tier);
        puff.update(dt, time, quiet, reduced, tier);
        q = quiet; rm = reduced; tr = tier;
      },
      thingFx(thing, kind, amount) {
        if (kind !== 1 || thing !== 6) return false;
        puff.burst(Math.round(24 * amount), q, rm, tr);   // the snow puff off the branch, through the emitter's caps
        return true;
      },
      dispose() { g.removeFromParent(); },
    };
  },
};
export default LOOK;
