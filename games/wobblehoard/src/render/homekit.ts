// PLAYGROUND: Home's things (PLACES.md 4.1, PLAYGROUND_BUILD.md 9 and 11.13, D-67, D-88), all tiny, in the stage chunk: the Felt Ball, the
// Music Box, the Snooze Rug (a darker stitched felt disc), the Warm Lamp (a 0.36 m base, its shade reaching 0.6 m) with its glow (r 1.2), and the
// Keepsake Shelf (1.2 x 0.45 x 0.30 m, two rows of ten) with the 20 small procedural keepsakes of QUESTS 10. The Bounce Pad waits for S2.
// The shell decides when each shows (its event happened and the party is at least its spot's fromN: StageLike.setHomeThing) and where (its
// spot x bodyScale for the frame in use); a bound prop's pose (bindProps: the Felt Ball rolling) moves it after that. A thing arrives with a
// little scale-in (Calm or reduced motion: a fade); a parked thing is not drawn. With no thing shown nothing here draws: Home is today's frame.
// Opaque props at renderOrder 0..9 (before the jellies, so the transmission pass refracts them); the lamp's glow is an additive floor pool that
// keeps the canvas alpha (halo.ts ADD_KEEP_ALPHA). Token colours only (OKLCH mixes of src/ui/theme.ts's eight). Zero allocation per frame.
import * as THREE from 'three';
import type { EnvHub } from './env.ts';
import { ADD_KEEP_ALPHA } from './halo.ts';
import { linearToOklch, oklchToLinear, type Rgb } from './oklch.ts';
import { PALETTE } from './table.ts';

/** D-96 (round 6): keepsake bits retired with the dropped places (5, 6, 8; data/quests.ts KEEPSAKE_MASK keeps the rest). */
const RETIRED_KEEPSAKES = (1 << 5) | (1 << 6) | (1 << 8);
/** Home's THING_IDS indices (src/data/places.ts; copied so the stage chunk never imports the data module). */
export const HOME_BALL = 0, HOME_MUSICBOX = 1, HOME_RUG = 2, HOME_LAMP = 3, HOME_SHELF = 4, HOME_PAD = 5;
export const HOME_THINGS = 6;

const lin = (h: number): Rgb => [16, 8, 0].map((sh) => { const v = ((h >> sh) & 255) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }) as Rgb;
/** An OKLCH mix of two tokens (t = 0 -> a, 1 -> b), hue taken the short way round. */
function mix(a: number, b: number, t: number): THREE.Color {
  const A = linearToOklch(lin(a)), B = linearToOklch(lin(b));
  let dh = B[2] - A[2]; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
  const c = oklchToLinear(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + dh * t);
  return new THREE.Color().setRGB(Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2]), THREE.LinearSRGBColorSpace);
}

const ARRIVE_S = 0.4;
type Part = { mesh: THREE.Mesh; mat: THREE.Material & { opacity: number; transparent: boolean } };

class Thing {
  readonly group = new THREE.Group();
  readonly parts: Part[] = [];
  shown = false;
  age = 0;
  x = 0; z = 0; yaw = 0;
  /** A bound prop drives it (pose index), or -1. */
  prop = -1;
  readonly kind: number;
  constructor(kind: number) { this.kind = kind; this.group.visible = false; }
}

export class HomeKit {
  readonly group = new THREE.Group();
  readonly things: Thing[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly hub: EnvHub;
  /** Keepsakes: one instanced draw per shape kind; per-instance colour (a calm drop fades in from the shelf's back colour). */
  private readonly keep: THREE.InstancedMesh[] = [];
  private readonly keepKind = new Uint8Array(20);
  private readonly keepIdx = new Uint8Array(20);
  private readonly keepCol: THREE.Color[] = [];
  private readonly keepAge = new Float32Array(20).fill(-1);
  private keepMask = 0;
  private readonly backCol: THREE.Color;
  private readonly glowMat: THREE.ShaderMaterial;
  private poses: Float32Array | null = null;
  private propCount = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly cTmp = new THREE.Color();

  constructor(hub: EnvHub) {
    this.hub = hub;
    this.group.name = 'homekit';
    const std = (c: THREE.Color, rough: number, env = 0.5): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0 });
      hub.apply(m, env); this.mats.push(m); return m;
    };
    const geo = <G extends THREE.BufferGeometry>(g: G): G => { this.geos.push(g); return g; };
    const add = (t: Thing, g: THREE.BufferGeometry, m: THREE.MeshStandardMaterial, x: number, y: number, z: number, order = 2): THREE.Mesh => {
      const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.renderOrder = order; t.group.add(mesh); t.parts.push({ mesh, mat: m }); return mesh;
    };
    for (let k = 0; k < HOME_THINGS; k++) { const t = new Thing(k); this.things.push(t); this.group.add(t.group); }
    // the Felt Ball: r 0.22, a soft coral felt with a plum seam band (its pose's y is its centre)
    {
      const t = this.things[HOME_BALL];
      add(t, geo(new THREE.SphereGeometry(0.22, 24, 16)), std(mix(PALETTE.ember, PALETTE.plum, 0.3), 0.92, 0.35), 0, 0, 0);
      const seam = add(t, geo(new THREE.TorusGeometry(0.221, 0.012, 6, 32)), std(mix(PALETTE.plum, PALETTE.dusk, 0.3), 0.85, 0.3), 0, 0, 0);
      seam.rotation.x = Math.PI / 2 - 0.5;
    }
    // the Music Box: 0.40 x 0.30 x 0.30, an amber-plum box, a lid line, a little crank
    {
      const t = this.things[HOME_MUSICBOX];
      add(t, geo(new THREE.BoxGeometry(0.4, 0.24, 0.3)), std(mix(PALETTE.amber, PALETTE.plum, 0.55), 0.6), 0, 0.12, 0);
      add(t, geo(new THREE.BoxGeometry(0.42, 0.06, 0.32)), std(mix(PALETTE.amber, PALETTE.plum, 0.35), 0.55), 0, 0.27, 0);
      const crank = add(t, geo(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8)), std(mix(PALETTE.amber, PALETTE.cream, 0.3), 0.4), 0.26, 0.14, 0);
      crank.rotation.z = Math.PI / 2;
    }
    // the Snooze Rug: a darker stitched felt disc r 0.7 (a ground patch: no collider, no pose), a dusk stitch ring
    {
      const t = this.things[HOME_RUG];
      const disc = add(t, geo(new THREE.CircleGeometry(0.7, 48)), std(mix(PALETTE.felt, PALETTE.ink, 0.35), 0.97, 0.15), 0, 0.004, 0, -48);
      disc.rotation.x = -Math.PI / 2;
      const stitch = add(t, geo(new THREE.RingGeometry(0.6, 0.62, 48, 1)), std(mix(PALETTE.dusk, PALETTE.felt, 0.35), 0.95, 0.15), 0, 0.006, 0, -47);
      stitch.rotation.x = -Math.PI / 2;
    }
    // the Warm Lamp: base 0.36 x 0.20 x 0.36, a stem, a shade reaching 0.6 m, a warm inner glow; Lamp Warmth's floor pool r 1.2
    {
      const t = this.things[HOME_LAMP];
      add(t, geo(new THREE.CylinderGeometry(0.15, 0.18, 0.2, 20)), std(mix(PALETTE.plum, PALETTE.dusk, 0.4), 0.7), 0, 0.1, 0);
      add(t, geo(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 8)), std(mix(PALETTE.amber, PALETTE.plum, 0.5), 0.5), 0, 0.33, 0);
      const shadeMat = std(mix(PALETTE.amber, PALETTE.ember, 0.25), 0.8, 0.3);
      shadeMat.emissive = mix(PALETTE.amber, PALETTE.cream, 0.2); shadeMat.emissiveIntensity = 0.55;
      add(t, geo(new THREE.CylinderGeometry(0.11, 0.2, 0.17, 24, 1, true)), shadeMat, 0, 0.515, 0);
      this.glowMat = new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying vec2 vP; uniform vec3 uCol; uniform float uAmt; void main(){ float r = length(vP) / 1.6; float a = (1.0 - smoothstep(0.0, 1.0, r)) * (1.0 - smoothstep(0.0, 1.0, r)) * uAmt; gl_FragColor = vec4(uCol * a, 1.0);\n#include <colorspace_fragment>\n}',
        uniforms: { uCol: { value: mix(PALETTE.amber, PALETTE.ember, 0.15) }, uAmt: { value: 0.16 } },
        transparent: false, depthWrite: false, depthTest: true, toneMapped: false, fog: false, ...ADD_KEEP_ALPHA,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      this.mats.push(this.glowMat);
      const glow = new THREE.Mesh(geo(new THREE.PlaneGeometry(3.2, 3.2)), this.glowMat);   // (round 14: the Lamp Warmth is r 1.6 m in the bigger Home, was 1.2)
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.005; glow.renderOrder = -38;
      t.group.add(glow); t.parts.push({ mesh: glow, mat: this.glowMat });
    }
    // the Keepsake Shelf: 1.2 x 0.45 x 0.30, two rows of ten; its parts as boxes (back, two sides, three boards)
    {
      const t = this.things[HOME_SHELF];
      const wood = std(mix(PALETTE.plum, PALETTE.amber, 0.28), 0.75);
      const box = geo(new THREE.BoxGeometry(1, 1, 1));
      const part = (x: number, y: number, z: number, w: number, h: number, d: number): void => { const m = add(t, box, wood, x, y, z); m.scale.set(w, h, d); };
      this.backCol = mix(PALETTE.plum, PALETTE.ink, 0.25);
      const back = std(this.backCol.clone(), 0.85);
      const bm = add(t, box, back, 0, 0.225, -0.13); bm.scale.set(1.2, 0.45, 0.04);
      part(-0.585, 0.225, 0, 0.03, 0.45, 0.3); part(0.585, 0.225, 0, 0.03, 0.45, 0.3);
      part(0, 0.01, 0, 1.2, 0.02, 0.3); part(0, 0.225, 0, 1.17, 0.02, 0.28); part(0, 0.44, 0, 1.2, 0.02, 0.3);
      // the 20 keepsakes (QUESTS 10, bit order), each a little shape in its own token mix, two rows of ten 0.11 m apart
      const KINDS = [
        geo(new THREE.OctahedronGeometry(0.04, 0)),          // 0 star-ish / crystal
        geo(new THREE.ConeGeometry(0.035, 0.09, 8)),          // 1 pinecone, bell, lantern
        geo(new THREE.SphereGeometry(0.038, 10, 8)),          // 2 pebble, bead, cloud puff
        geo(new THREE.TorusGeometry(0.03, 0.01, 6, 16)),      // 3 ring, charm, garland
        geo(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12)), // 4 cog, button, thimble, jar
        geo(new THREE.BoxGeometry(0.07, 0.08, 0.02)),         // 5 frame, book, map, quilt, ribbon
      ];
      const KEEP: [number, number, number, number][] = [   // kind, token a, token b, mix
        [0, PALETTE.amber, PALETTE.cream, 0.2], [1, PALETTE.ember, PALETTE.plum, 0.4], [2, PALETTE.lagoon, PALETTE.cream, 0.3], [1, PALETTE.lagoon, PALETTE.cream, 0.5],
        [2, PALETTE.lagoon, PALETTE.dusk, 0.3], [3, PALETTE.lagoon, PALETTE.cream, 0.6], [4, PALETTE.amber, PALETTE.plum, 0.35], [1, PALETTE.ember, PALETTE.amber, 0.5],
        [0, PALETTE.lagoon, PALETTE.dusk, 0.2], [2, PALETTE.cream, PALETTE.dusk, 0.15], [5, PALETTE.amber, PALETTE.plum, 0.3], [3, PALETTE.ember, PALETTE.cream, 0.3],
        [5, PALETTE.ember, PALETTE.amber, 0.3], [3, PALETTE.lagoon, PALETTE.ember, 0.5], [5, PALETTE.dusk, PALETTE.cream, 0.3], [4, PALETTE.lagoon, PALETTE.cream, 0.55],
        [4, PALETTE.ember, PALETTE.dusk, 0.3], [4, PALETTE.cream, PALETTE.dusk, 0.3], [5, PALETTE.amber, PALETTE.lagoon, 0.45], [5, PALETTE.ember, PALETTE.lagoon, 0.5],
      ];
      const per = new Uint8Array(KINDS.length);
      for (let i = 0; i < 20; i++) { this.keepKind[i] = KEEP[i][0]; this.keepIdx[i] = per[KEEP[i][0]]++; this.keepCol.push(mix(KEEP[i][1], KEEP[i][2], KEEP[i][3])); }
      for (let k = 0; k < KINDS.length; k++) {
        const m = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 });
        hub.apply(m, 0.8); this.mats.push(m);
        const im = new THREE.InstancedMesh(KINDS[k], m, Math.max(1, per[k]));
        im.count = 0; im.renderOrder = 3; im.frustumCulled = false;
        for (let i = 0; i < per[k]; i++) im.setColorAt(i, this.backCol);
        this.keep.push(im); t.group.add(im);
      }
    }
    // (the Bounce Pad waits for the flush pad, S2: nothing is drawn for it yet)
  }

  /** Show (it arrives) or park (not drawn) a thing at its spot (metres; the spot x bodyScale for the frame in use) and yaw. */
  setThing(k: number, shown: boolean, x: number, z: number, yaw: number): void {
    const t = this.things[k];
    if (!t || k === HOME_PAD) return;
    if (Number.isFinite(x)) t.x = x; if (Number.isFinite(z)) t.z = z; if (Number.isFinite(yaw)) t.yaw = yaw;
    if (shown && !t.shown) t.age = 0;
    t.shown = shown;
    if (!shown) t.group.visible = false;
  }
  /** The keepsakes on the shelf: a 20-bit set (QUESTS 10); a newly set bit drops into its place (Calm or reduced motion: a fade). */
  setKeepsakes(mask: number): void {
    // (round 6, D-96: bits 5 Bubble Ring, 6 Little Brass Cog and 8 Glow Crystal are retired with their dropped places (R6_DATA 1); an old save
    // that holds one shows nothing in its slot: those three slots stay empty)
    const m = (mask >>> 0) & 0xfffff & ~RETIRED_KEEPSAKES;
    for (let i = 0; i < 20; i++) {
      const on = (m >> i) & 1, was = (this.keepMask >> i) & 1;
      if (on && !was) this.keepAge[i] = 0;
      if (!on) this.keepAge[i] = -1;
    }
    this.keepMask = m;
  }
  /** The bound prop poses (8 floats a prop; PropWorldLike order) and which thing each drives (propThing; -1 a wall). */
  bind(poses: Float32Array | null, count: number, propThing: Int16Array | null): void {
    this.poses = poses; this.propCount = poses ? Math.max(0, Math.min(count | 0, (poses.length / 8) | 0)) : 0;
    for (const t of this.things) t.prop = -1;
    if (!poses || !propThing) return;
    for (let p = 0; p < this.propCount && p < propThing.length; p++) { const k = propThing[p]; const t = this.things[k]; if (t && t.prop < 0) t.prop = p; }
  }

  /** One frame. `quiet`: Calm or reduced motion (arrivals and drops fade, never grow). Returns true when anything is drawn. */
  update(dt: number, quiet: boolean): boolean {
    let any = false;
    for (const t of this.things) {
      if (!t.shown) continue;
      any = true;
      t.age += dt;
      const g = t.group;
      g.visible = true;
      // where: the bound pose (the ball rolls), else its spot
      const P = this.poses, p = t.prop;
      if (P && p >= 0 && p < this.propCount && Number.isFinite(P[p * 8])) {
        const o = p * 8;
        g.position.set(P[o], t.kind === HOME_BALL ? P[o + 1] : 0, P[o + 2]);
        if (t.kind === HOME_BALL) g.quaternion.set(P[o + 3], P[o + 4], P[o + 5], P[o + 6]); else g.rotation.set(0, t.yaw, 0);
      } else {
        g.position.set(t.x, t.kind === HOME_BALL ? 0.22 : 0, t.z);
        g.rotation.set(0, t.yaw, 0);
      }
      // arrival: a little scale-in with a soft overshoot; Calm or reduced motion: a fade at full size
      const u = Math.min(1, t.age / ARRIVE_S);
      if (quiet) {
        g.scale.setScalar(1);
        for (const part of t.parts) {
          if (part.mat === this.glowMat) { this.glowMat.uniforms.uAmt.value = 0.16 * u; continue; }
          const fading = u < 1;
          if (part.mat.transparent !== fading) part.mat.transparent = fading;
          part.mat.opacity = u;
        }
      } else {
        const k = 1.70158 * 0.5, e = 1 + (k + 1) * Math.pow(u - 1, 3) + k * Math.pow(u - 1, 2);
        g.scale.setScalar(Math.max(0.001, e));
        for (const part of t.parts) {
          if (part.mat === this.glowMat) { this.glowMat.uniforms.uAmt.value = 0.16 * u; continue; }
          if (part.mat.transparent) { part.mat.transparent = false; part.mat.opacity = 1; }
        }
      }
    }
    // keepsakes: each found one stands in its place; a new one drops 0.2 m with a small bounce (quiet: fades in from the shelf's back colour)
    if (this.things[HOME_SHELF].shown) {
      for (const im of this.keep) im.count = 0;
      for (let i = 0; i < 20; i++) {
        if (this.keepAge[i] < 0) continue;
        this.keepAge[i] += dt;
        const k = this.keepKind[i], im = this.keep[k], slot = this.keepIdx[i];
        const row = i < 10 ? 0 : 1, col = i % 10;
        const x = -0.495 + col * 0.11, y = (row === 0 ? 0.02 : 0.235) + 0.045, z = 0.02;
        const u = Math.min(1, this.keepAge[i] / 0.45);
        const drop = quiet ? 0 : 0.2 * (1 - u) * (1 - u) - 0.012 * Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.7) / 0.3)));
        this.v.set(x, y + drop, z);
        this.q.identity();
        this.s.setScalar(1);
        this.m4.compose(this.v, this.q, this.s);
        im.setMatrixAt(slot, this.m4);
        this.cTmp.copy(this.backCol).lerp(this.keepCol[i], quiet ? u : 1);
        im.setColorAt(slot, this.cTmp);
        im.count = Math.max(im.count, slot + 1);
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    return any;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) { this.hub.release(m); m.dispose(); }
    for (const im of this.keep) im.dispose();
    this.group.removeFromParent();
  }
}
