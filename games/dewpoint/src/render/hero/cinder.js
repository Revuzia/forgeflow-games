// Cinder: living fire with two bright eyes, and four different fires.
//   ember - a small bright coal, dark crust cracked with light, and ONE dancing flame standing on
//           it that is taller the more heat it holds
//   blaze - a roaring bonfire: a broad red-rimmed flame behind, a hot one in front of it, a thin
//           tongue above, and in the middle a white-yellow heart the eyes ride on
//   smoke - dark curling volumes with ember flecks drifting in them, the eyes glowing out
//   spark - a crackling white-gold star throwing arcs
// The flames are instances in the level's flame batch (flame.js): they lick upward, trail behind
// Cinder when it moves, shrink as its heat runs out. Sparks and smoke are particles, the heat
// shimmer above it is a ripple in the ink pass (shimmer()), the light on the walls is the
// renderer's one hero light taking Cinder's colour and flicker (light()), the pool of light on the
// floor below is the jump mark (groundMark()), and the glowing scorch it leaves is the print trail.
// The face, gaze and morphing are HeroView's (base.js). Cost: no draw call of its own beyond the
// body showing (one or two meshes) and the shared eyes.

import * as THREE from '../../../vendor/three.module.min.js';
import { HeroView, bodyMaterial, BODY_VERT } from './base.js';
import { Flames, FLAME } from '../flame.js';
import { INK } from '../geo.js';
import fireDef from '../../sim/elements/fire.js';

const C_EMBER = [1.0, 0.56, 0.2], C_BLAZE = [1.0, 0.74, 0.3], C_SMOKE = [0.62, 0.52, 0.62], C_SPARK = [1.0, 0.95, 0.6];
export const FORM_COLORS = { ember: C_EMBER, blaze: C_BLAZE, smoke: C_SMOKE, spark: C_SPARK };
const LIGHT_COLORS = { ember: [1.0, 0.42, 0.1], blaze: [1.0, 0.5, 0.13], smoke: [0.7, 0.3, 0.25], spark: [1.0, 0.72, 0.3] };
const HOT = [1.0, 0.8, 0.4], WHITE_HOT = [1.0, 0.96, 0.7], SOOT = [0.13, 0.1, 0.13], STEAMC = [0.95, 0.97, 1.0];
const HEAT_MAX = fireDef.gauge.max;

// The coal: faceted (normals from screen-space derivatives), a dark crust in two flat tones, and
// cracks of light that breathe - orange where they are thin, yellow where they run together.
// uHeat (0..1) is how much heat Cinder holds: a cold coal is duller.
const COAL_FRAG = /* glsl */`
  uniform vec3 uLightDir;
  uniform float uTime;
  uniform float uHeight;
  uniform float uFlash;
  uniform float uHeat;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    vec3 n = normalize(cross(dFdx(vV), dFdy(vV))) * -1.0;
    vec3 v = normalize(vV);
    if (dot(n, v) < 0.0) n = -n;
    float ndl = dot(n, uLightDir);
    vec3 col = mix(vec3(0.05, 0.022, 0.04), vec3(0.2, 0.075, 0.07), step(0.05, ndl));
    // cracks: where a wobbly field crosses zero
    vec3 q = vObj * 8.5;
    float f = sin(q.x + sin(q.y * 1.3) * 1.6) * sin(q.y * 1.1 + sin(q.z * 0.9) * 1.8) + 0.45 * sin(q.z * 1.7 + q.x * 0.6);
    float breath = 0.7 + 0.3 * sin(uTime * 2.6 + vObj.y * 5.0);
    float low = 1.0 - clamp(vObj.y / uHeight, 0.0, 1.0);
    float wide = (0.1 + 0.07 * low) * (0.5 + 0.5 * uHeat) * breath;
    col = mix(col, vec3(1.0, 0.36, 0.03), 1.0 - step(wide, abs(f)));
    col = mix(col, vec3(1.0, 0.86, 0.3), 1.0 - step(wide * 0.42, abs(f)));
    // the belly glows
    col = mix(col, vec3(1.0, 0.5, 0.06), step(0.82, low) * uHeat * 0.85);
    col = mix(col, vec3(1.0, 0.95, 0.8), uFlash);
    gl_FragColor = vec4(col, ${INK.hero.toFixed(3)});
    #include <colorspace_fragment>
  }`;

// The heart of the blaze: a teardrop that sways with the flames round it, white-yellow in the
// middle, yellow, then orange at its edge. It writes ink id 0: fire is never outlined in black.
const HEART_VERT = /* glsl */`
  uniform float uTime;
  uniform vec2 uLean;
  uniform float uHeight;
  uniform float uSway;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    vec3 p = position;
    float t = clamp(p.y / uHeight, 0.0, 1.0);
    float k = t * t;
    p.x += (sin(p.y * 7.0 - uTime * 9.0) * 0.06 + sin(p.y * 13.0 - uTime * 15.0 + 1.7) * 0.025) * k * uSway;
    p.z += (cos(p.y * 6.0 - uTime * 7.5 + 0.8) * 0.05) * k * uSway;
    p.xz += uLean * k;
    vObj = vec3(position.x, p.y, position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const HEART_FRAG = /* glsl */`
  uniform float uHeight;
  uniform float uFlash;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    float t = clamp(vObj.y / uHeight, 0.0, 1.0);
    float core = max(dot(normalize(vN), normalize(vV)), 0.0) - t * 0.25;
    vec3 col = mix(vec3(1.0, 0.5, 0.06), vec3(1.0, 0.8, 0.2), step(0.3, core));
    col = mix(col, vec3(1.0, 0.95, 0.62), step(0.72, core));
    col = mix(col, vec3(1.0), uFlash * 0.7);
    gl_FragColor = vec4(col, 0.0);
    #include <colorspace_fragment>
  }`;

function lathe(profile, seg, rings) {
  // resample the profile so the shape has enough rings to bend
  const pts = [];
  for (let i = 0; i < rings; i++) {
    const u = i / (rings - 1) * (profile.length - 1), k = Math.min(profile.length - 2, Math.floor(u)), f = u - k;
    pts.push(new THREE.Vector2(profile[k][0] + (profile[k + 1][0] - profile[k][0]) * f, profile[k][1] + (profile[k + 1][1] - profile[k][1]) * f));
  }
  return new THREE.LatheGeometry(pts, seg);
}

const FACE = { ey: 0, ez: 0, ex: 0, tilt: 0, es: 1, toe: 0.4 };
const MOOD = { frozen: false, lowGauge: false, low: 0, order: 16 };
const MARK = { size: 2.6, alpha: 0.3 };
const LIGHT = { color: C_EMBER, power: 20, range: 10 };
const SHIM = { y: 1, r: 1, k: 0 };

export class CinderView extends HeroView {
  constructor(particles, prints, flames) {
    super(particles, prints, {
      forms: ['ember', 'blaze', 'smoke', 'spark'],
      formColors: FORM_COLORS,
      lid: { ember: 0x7a2c0e, blaze: 0xffb62e, smoke: 0x3c3048, spark: 0xffe488 },
      // warm whites, an orange rim round a soot pupil, a soot ring round the eye so it reads inside the flames
      eye: { w: 0.114, h: 0.146, d: 0.07, white: [1.0, 0.99, 0.9], iris: [0.82, 0.3, 0.04], dark: [0.07, 0.022, 0.01], outline: [0.09, 0.028, 0.012] },
      ghost: 0xffb060,
      mark: { color: [1.0, 0.5, 0.16], additive: true },
      // the scorch it leaves: soot with an ember edge that glows as it cools
      print: { inner: [0.05, 0.03, 0.035], rim: [1.0, 0.42, 0.08], glow: 0.85 },
    }, flames || new Flames(12));
    const Fl = this.flames;

    // --- ember: a craggy coal, and a single flame standing on it
    const coalGeo = new THREE.IcosahedronGeometry(1, 2);
    {
      const p = coalGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        // deterministic lumps by direction, so the shared corners of neighbouring faces stay together
        const n = Math.sin(x * 5.1 + y * 3.3) * Math.sin(y * 4.7 + z * 2.9) * Math.sin(z * 5.3 + x * 2.1);
        const k = 1 + n * 0.16 + (y < -0.55 ? (y + 0.55) * 0.5 : 0);        // lumpy, with a flattened foot
        p.setXYZ(i, x * k * 0.335, (y * k + 0.86) * 0.305, z * k * 0.315);
      }
      coalGeo.computeVertexNormals();
    }
    this.matCoal = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uWobble: { value: 0 }, uLean: { value: new THREE.Vector2() }, uHeight: { value: 0.56 }, uRipple: { value: 0 },
        uLightDir: { value: new THREE.Vector3(0.3, 0.8, 0.5) }, uFlash: { value: 0 }, uHeat: { value: 1 },
      },
      vertexShader: BODY_VERT, fragmentShader: COAL_FRAG, fog: false, toneMapped: false,
    });
    const ember = new THREE.Group();
    this.coal = new THREE.Mesh(coalGeo, this.matCoal);
    ember.add(this.coal);
    this.fEmber = Fl.add(0, 0, 0, 0.4, 0.66, FLAME.fire, { k: 0, heart: 0.75 });
    this.fEmber2 = Fl.add(0, 0, 0, 0.2, 0.3, FLAME.hot, { k: 0, heart: 1, minor: true });

    // --- blaze: the heart (a mesh, for the eyes to ride on) inside three flames
    this.matHeart = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLean: { value: new THREE.Vector2() }, uHeight: { value: 0.92 }, uSway: { value: 1 }, uFlash: { value: 0 } },
      vertexShader: HEART_VERT, fragmentShader: HEART_FRAG, fog: false, toneMapped: false,
    });
    const heart = new THREE.Mesh(lathe([[0, 0], [0.19, 0.02], [0.3, 0.13], [0.33, 0.3], [0.29, 0.48], [0.21, 0.64], [0.11, 0.8], [0, 0.92]], 16, 14), this.matHeart);
    const blaze = new THREE.Group();
    blaze.add(heart);
    this.fBlaze = [
      Fl.add(0, 0, 0, 1.35, 1.95, FLAME.fire, { k: 0, heart: 0.2 }),
      Fl.add(0, 0, 0, 1.0, 1.55, FLAME.hot, { k: 0, heart: 0.9 }),
      Fl.add(0, 0, 0, 0.55, 2.3, FLAME.fire, { k: 0, heart: 0.3, minor: true }),
    ];

    // --- smoke: dark curling volumes (one instanced draw)
    const puffGeo = new THREE.SphereGeometry(1, 12, 9);
    this.matSmoke = bodyMaterial({ a: 0x1c1524, b: 0x3e3350, c: 0x6a5c80, puff: true });
    const smoke = new THREE.Group();
    this.puffs = [[0, 0.34, 0, 0.29], [0.19, 0.24, 0.07, 0.19], [-0.18, 0.27, -0.05, 0.2], [0.04, 0.54, -0.12, 0.19], [-0.07, 0.16, 0.16, 0.16], [0.12, 0.44, 0.16, 0.15], [-0.1, 0.7, 0.04, 0.13]]
      .map(([x, y, z, r], i) => ({ x, y, z, r, ph: i * 2.3 }));
    this.puffInst = new THREE.InstancedMesh(puffGeo, this.matSmoke, this.puffs.length);
    this.puffInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffO = new THREE.Object3D();
    const smokeGhost = new THREE.Mesh(puffGeo, this.ghostMat);
    smokeGhost.scale.setScalar(0.42); smokeGhost.position.y = 0.36; smokeGhost.renderOrder = 30; smokeGhost.userData.noGhost = true; smokeGhost.userData.noShadow = true;
    smoke.add(this.puffInst, smokeGhost);

    // --- spark: a white-gold star (three spikes, one geometry) and the arcs it throws
    const s1 = new THREE.OctahedronGeometry(1, 0); s1.scale(0.1, 0.25, 0.1);
    const s2 = new THREE.OctahedronGeometry(1, 0); s2.scale(0.25, 0.09, 0.09);
    const s3 = new THREE.OctahedronGeometry(1, 0); s3.scale(0.09, 0.09, 0.25);
    const starGeo = new THREE.BufferGeometry();
    {
      const parts = [s1, s2, s3].map((g) => g.attributes.position.array), all = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
      let o = 0;
      for (const a of parts) { all.set(a, o); o += a.length; }
      starGeo.setAttribute('position', new THREE.BufferAttribute(all, 3));
      starGeo.computeVertexNormals();
      for (const g of [s1, s2, s3]) g.dispose();
    }
    const glowOnly = (m) => { m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n\tgl_FragColor.a = 0.0;'); }; m.customProgramCacheKey = () => 'dewCinderGlow'; return m; };
    this.matSpark = glowOnly(new THREE.MeshBasicMaterial({ color: 0xfff6c0, fog: false, toneMapped: false }));
    const spark = new THREE.Group();
    this.star = new THREE.Mesh(starGeo, this.matSpark);
    this.star.position.y = 0.17;
    this.arcPos = new Float32Array(3 * 4 * 2 * 3);            // 3 arcs x 4 segments x 2 ends
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.arcs = new THREE.LineSegments(arcGeo, glowOnly(new THREE.LineBasicMaterial({ color: 0xfff2a0, fog: false, toneMapped: false })));
    this.arcs.userData.noGhost = true;
    spark.add(this.star, this.arcs);
    this.fSpark = Fl.add(0, 0, 0, 0.42, 0.56, FLAME.spark, { k: 0, heart: 1 });

    this.addBody('ember', ember);
    this.addBody('blaze', blaze, { shadow: false, ghostScale: 1.1 });
    this.addBody('smoke', smoke, { shadow: false, ghost: 'none' });
    this.addBody('spark', spark, { shadow: false, ghost: 'first', ghostScale: 1.6 });
    this.timed.push(this.matCoal, this.matHeart, this.matSmoke);
    this.heat = 1; this.flare = 0; this.jit = 0;
    this.trail = new THREE.Vector2();        // which way, and how far, the flames are dragged back by its motion
    this.finish();
  }

  /** Fold the flames away (another hero is on screen). */
  hide() { for (const f of [this.fEmber, this.fEmber2, this.fSpark, ...this.fBlaze]) f.k = 0; }

  /** Things a coal likes to look at: what it could light, and what could put it out. */
  interests(L, consider) {
    if (L.lanterns) for (const q of L.lanterns) if (!q.lit) consider(q.pos);
    if (L.braziers) for (const q of L.braziers) if (!q.current) consider([q.pos[0], q.pos[1] + 0.6, q.pos[2]]);
    if (L.fuses) for (const f of L.fuses) if (f.state === 0) consider(f.pts[0]);
    if (L.coals) for (const q of L.coals) if (!q.taken) consider(q.pos);
  }

  heroEvent(e, sim, P, p) {
    const rm = this.reduced;
    if (e.type === 'form') {
      const col = FORM_COLORS[e.to];
      if (e.cause !== 'respawn') {
        const n = rm ? 8 : 22, x = p.x, y = p.y, z = p.z;
        if (e.to === 'blaze') {
          // a whoosh upward: sparks and a ring of them along the floor
          for (let i = 0; i < n; i++) P.spawn({ x: x + (P.rnd() - 0.5) * 0.5, y: y + 0.1 + P.rnd() * 0.5, z: z + (P.rnd() - 0.5) * 0.5, vx: (P.rnd() - 0.5) * 1.6, vy: 2.8 + P.rnd() * 3.2, vz: (P.rnd() - 0.5) * 1.6, life: 0.5 + P.rnd() * 0.4, size: 0.09, color: P.rnd() < 0.4 ? WHITE_HOT : HOT, drag: 1.2, solid: 0.3 });
          P.burst(x, y + 0.05, z, rm ? 6 : 14, { flat: true, speed: 3, life: 0.4, size: 0.1, color: C_EMBER, drag: 3, solid: 0.3 });
        } else if (e.to === 'smoke') {
          for (let i = 0; i < (rm ? 5 : 10); i++) P.spawn({ x: x + (P.rnd() - 0.5) * 0.6, y: y + 0.2 + P.rnd() * 0.5, z: z + (P.rnd() - 0.5) * 0.6, vx: (P.rnd() - 0.5) * 0.8, vy: 0.7 + P.rnd(), vz: (P.rnd() - 0.5) * 0.8, life: 1.0, size: 0.45, grow: 0.5, color: SOOT, alpha: 0.55, drag: 1, solid: 1 });
          P.burst(x, y + 0.3, z, 8, { speed: 1.6, life: 0.6, size: 0.07, color: C_EMBER, gravity: 3, drag: 2, solid: 0.2 });
        } else if (e.to === 'spark') {
          P.burst(x, y + 0.2, z, n, { speed: 5.5, life: 0.28, size: 0.08, color: C_SPARK, drag: 6, solid: 0.2 });
          P.burst(x, y + 0.2, z, 6, { speed: 1.2, life: 0.4, size: 0.3, color: [1, 1, 0.85], drag: 4, alpha: 0.6, solid: 0.1 });
        } else {
          // settling back into a coal: embers shaken loose
          P.burst(x, y + 0.35, z, n, { speed: 2.8, life: 0.6, size: 0.1, color: C_EMBER, gravity: 7, drag: 2, up: 1.2, solid: 0.3 });
        }
        this.flash = rm ? 0.3 : 0.7;
        this.startRing(col);
      }
      this.spring = e.to === 'spark' ? -0.3 : 0.3;
      this.squint = 0.6;
    } else if (e.type === 'special') {
      // the flare: a ring of fire downward, a rush upward
      this.flare = 1; this.spring = 0.45; this.wide = 0.8;
      this.flash = Math.max(this.flash, rm ? 0.25 : 0.6);
      for (let i = 0; i < (rm ? 8 : 20); i++) { const a = P.rnd() * Math.PI * 2; P.spawn({ x: e.x + Math.cos(a) * 0.25, y: e.y + 0.15, z: e.z + Math.sin(a) * 0.25, vx: Math.cos(a) * 1.6, vy: -1.2 - P.rnd() * 1.5, vz: Math.sin(a) * 1.6, life: 0.45, size: 0.2, grow: -0.3, color: P.rnd() < 0.5 ? WHITE_HOT : C_EMBER, alpha: 0.9, drag: 1.5, solid: 0.4 }); }
      this.startRing(C_BLAZE);
    } else if (e.type === 'burst') {
      if (e.kind === 'jump') {
        this.spring = -0.2; this.springV = 7.5; this.squint = 0.5;
        P.burst(e.x, e.y + 0.05, e.z, 6, { flat: true, speed: 1.9, life: 0.4, size: 0.07, color: C_EMBER, drag: 3, up: 0.8, solid: 0.3 });
      } else if (e.kind === 'land') {
        const hard = Math.min(1, e.speed / 14);
        this.springV -= Math.min(10, e.speed * 0.75);
        P.burst(e.x, e.y + 0.05, e.z, Math.min(18, 3 + e.speed | 0), { flat: true, speed: 1.4 + e.speed * 0.2, life: 0.5, size: 0.07, color: hard > 0.3 ? HOT : C_EMBER, gravity: 5, drag: 2, up: 1.6, solid: 0.3 });
        if (hard > 0.25) this.prints.add(e.x, e.y, e.z, 0.6 + hard * 0.8, true);
        if (hard > 0.35) this.squint = 0.8;
      } else if (e.kind === 'douse_hero') {
        // put out: a gasp of white steam and grey ash
        for (let i = 0; i < 14; i++) P.spawn({ x: e.x + (P.rnd() - 0.5) * 0.5, y: e.y + 0.1 + P.rnd() * 0.4, z: e.z + (P.rnd() - 0.5) * 0.5, vx: (P.rnd() - 0.5) * 0.8, vy: 1.2 + P.rnd() * 1.6, vz: (P.rnd() - 0.5) * 0.8, life: 1.1, size: 0.5, grow: 0.7, color: STEAMC, alpha: 0.6, drag: 1, solid: 1 });
        P.burst(e.x, e.y + 0.2, e.z, 10, { speed: 1.4, life: 0.8, size: 0.09, color: [0.4, 0.38, 0.42], gravity: 4, solid: 1 });
      } else if (e.kind === 'launch') {
        this.wide = 1; this.spring = 0.4;
      } else if (e.kind === 'wirestart' || e.kind === 'wireend') {
        P.burst(e.x, e.y, e.z, 16, { speed: 4, life: 0.3, size: 0.08, color: C_SPARK, drag: 5, solid: 0.2 });
        this.flash = Math.max(this.flash, rm ? 0.2 : 0.5);
      }
    } else if (e.type === 'fuel') {
      // heat coming in: a warm blink and motes drawn up into Cinder
      this.flash = Math.max(this.flash, rm ? 0.15 : 0.35); this.wide = Math.max(this.wide, 0.6);
      for (let i = 0; i < 8; i++) P.spawn({ x: p.x + (P.rnd() - 0.5) * 0.8, y: p.y + P.rnd() * 0.3, z: p.z + (P.rnd() - 0.5) * 0.8, vy: 1.4 + P.rnd(), life: 0.5, size: 0.09, color: HOT, drag: 1, solid: 0.3 });
    } else if (e.type === 'respawn' && e.cause !== 'water') {
      P.burst(e.from[0], e.from[1] + 0.3, e.from[2], 14, { speed: 2.5, life: 0.5, size: 0.11, color: C_EMBER, gravity: 4, solid: 0.3 });
    }
  }

  poseBody(k, body, s, target, b, c) {
    const { p, idle, rm, time } = c;
    if (k === 'ember') {
      // a coal is stiffer than a drop: a little squash and stretch, a little breathing
      const breathe = idle && !rm ? Math.sin(time * 2.4) * 0.025 : 0;
      const st = 1 + Math.max(-0.2, Math.min(0.24, p.vy * 0.02)) + this.spring * 0.8 + breathe;
      const w = 1 / Math.sqrt(Math.max(0.5, st));
      body.scale.set(s * w, s * st, s * w);
      body.rotation.z = idle && !rm ? Math.sin(time * 1.5) * 0.04 : 0;
      // rolls a touch into its run
      body.rotation.x = Math.min(0.22, c.sp * 0.03);
    } else if (k === 'blaze') {
      const st = 1 + this.spring * 0.6 + this.flare * 0.25 + (rm ? 0 : Math.sin(time * 7.3) * 0.03);
      // with the camera squeezed right up to it (backed into a corner) the heart draws in, so it never fills the picture
      const near = 0.62 + 0.38 * Math.max(0, Math.min(1, (this.camDist - 1.3) / 2.2));
      body.scale.set(s * near * (1 - this.spring * 0.2), s * st * near, s * near * (1 - this.spring * 0.2));
    } else if (k === 'spark') {
      body.scale.setScalar(s * (1 + this.spring * 0.5));
    } else {
      body.scale.setScalar(s);
    }
  }

  afterBodies(c) {
    const { p, form, dt, time, rm, lvx, lvz, P, x, y, z } = c;
    // how much heat Cinder holds shows on the coal and in the height of every flame
    this.heat += (Math.max(0, Math.min(1, p.gauge / HEAT_MAX)) - this.heat) * Math.min(1, dt * 6);
    this.flare = Math.max(0, this.flare - dt * 2.2);
    const km = rm ? 0.3 : 1;
    this.lean.x += (-lvx * 0.05 * km - this.lean.x) * Math.min(1, dt * 7);
    this.lean.y += (-lvz * 0.05 * km - this.lean.y) * Math.min(1, dt * 7);
    // the flames are dragged back along the way it came (world space: they are upright billboards)
    const tx = Math.max(-0.9, Math.min(0.9, -p.vx * 0.11 * km)), tz = Math.max(-0.9, Math.min(0.9, -p.vz * 0.11 * km));
    this.trail.x += (tx - this.trail.x) * Math.min(1, dt * 6); this.trail.y += (tz - this.trail.y) * Math.min(1, dt * 6);
    this.matCoal.uniforms.uHeat.value = this.heat;
    this.matHeart.uniforms.uLean.value.copy(this.lean).multiplyScalar(1.6); this.matHeart.uniforms.uSway.value = rm ? 0.25 : 1;

    const pop = Math.min(1, this.pop), B = this.blend;
    const place = (f, yy, k, lean = 1) => { f.x = x; f.y = yy; f.z = z; f.k = k; f.lx = this.trail.x * lean; f.lz = this.trail.y * lean; };
    // ember: one flame on the coal, taller with heat, ducking as it lands
    const es = this.bodies.ember.scale.y;
    const dance = rm ? 1 : 1 + 0.12 * Math.sin(time * 9) + 0.06 * Math.sin(time * 23.7);
    place(this.fEmber, y + 0.5 * es, B.ember * pop * (0.5 + 0.7 * this.heat) * dance);
    place(this.fEmber2, y + 0.46 * es, B.ember * pop * (0.6 + 0.5 * this.heat), 0.6);
    this.fEmber2.x += 0.09; this.fEmber2.z += 0.05;
    // blaze: the roar; it gutters when the heat is nearly gone
    const gutter = form === 'blaze' && p.gauge < 2 && !rm ? 0.78 + 0.22 * Math.sin(time * 22) : 1;
    const roar = (1 + this.flare * 0.35 + this.spring * 0.4) * gutter * (0.75 + 0.25 * this.heat) * (0.6 + 0.4 * Math.max(0, Math.min(1, (this.camDist - 1.3) / 2.2)));
    place(this.fBlaze[0], y + 0.0, B.blaze * pop * roar, 1.25);
    place(this.fBlaze[1], y + 0.02, B.blaze * pop * roar * (rm ? 1 : 1 + 0.05 * Math.sin(time * 13)), 1);
    place(this.fBlaze[2], y + 0.25, B.blaze * pop * roar * (rm ? 0.9 : 0.85 + 0.2 * Math.sin(time * 5.3)), 1.6);
    // spark: a white-gold flicker round the star
    place(this.fSpark, y - 0.02, B.spark * pop * (rm ? 1 : 0.8 + P.rnd() * 0.5) * (form === 'spark' && p.gauge < 1.5 ? 0.7 : 1), 1.4);

    if (this.bodies.smoke.visible) {
      const low = form === 'smoke' ? Math.min(1, p.gauge / 1.5) : 1;
      const flick = low < 1 && !rm ? 0.86 + 0.14 * Math.sin(time * 26) : 1;
      const gather = rm ? 1 : 1 + (1 - this.blend.smoke) * 1.4;
      const o = this.puffO;
      this.puffs.forEach((u, i) => {
        // each volume circles slowly: the cloud curls
        const t = time * 1.1 + u.ph, cr = rm ? 0 : 0.05;
        o.position.set((u.x + Math.sin(t) * cr + Math.cos(t * 0.6) * cr - lvx * 0.03 * u.y) * gather, u.y + Math.sin(t * 1.2) * 0.05, (u.z + Math.cos(t) * cr - Math.sin(t * 0.6) * cr - lvz * 0.03 * u.y) * gather);
        o.scale.setScalar(u.r * (0.9 + 0.14 * Math.sin(t * 1.5)) * (0.55 + 0.45 * low) * flick);
        o.updateMatrix();
        this.puffInst.setMatrixAt(i, o.matrix);
      });
      this.puffInst.instanceMatrix.needsUpdate = true;
    }
    if (this.bodies.spark.visible) {
      // a spark never sits still (unless motion is reduced: then it turns slowly); it throws three arcs
      this.jit -= dt;
      if (rm) { this.star.rotation.set(0, time * 1.2, 0); this.star.scale.setScalar(1); }
      if (this.jit <= 0) {
        this.jit = rm ? 0.2 : 0.05;
        if (!rm) { this.star.rotation.set(P.rnd() * 6.3, P.rnd() * 6.3, P.rnd() * 6.3); this.star.scale.setScalar(0.8 + P.rnd() * 0.55); }
        const a = this.arcPos;
        let n = 0;
        for (let k = 0; k < 3; k++) {
          const az = P.rnd() * 6.283, el = (P.rnd() - 0.3) * 1.6, len = 0.3 + P.rnd() * 0.32;
          const dx = Math.cos(az) * Math.cos(el), dy = Math.sin(el), dz = Math.sin(az) * Math.cos(el);
          let px = 0, py = 0.17, pz = 0;
          for (let sgm = 1; sgm <= 4; sgm++) {
            const u = sgm / 4, j = sgm < 4 ? 0.07 : 0.02;
            const qx = dx * len * u + (P.rnd() - 0.5) * j, qy = 0.17 + dy * len * u + (P.rnd() - 0.5) * j, qz = dz * len * u + (P.rnd() - 0.5) * j;
            a[n++] = px; a[n++] = py; a[n++] = pz; a[n++] = qx; a[n++] = qy; a[n++] = qz;
            px = qx; py = qy; pz = qz;
          }
        }
        this.arcs.geometry.attributes.position.needsUpdate = true;
      }
    }
  }

  mood(form, p) {
    MOOD.frozen = false;
    // nearly out of heat while spending it: worried
    MOOD.lowGauge = fireDef.formDefs[form].drain > 0 && p.gauge < HEAT_MAX * 0.2;
    MOOD.low = 0;
    MOOD.order = 16;
    return MOOD;
  }

  face(form, c) {
    const F = FACE;
    if (form === 'blaze') { F.ey = 0.36 + (c.rm ? 0 : Math.sin(c.time * 3.1) * 0.015) + this.flare * 0.06; F.ez = 0.3; F.ex = 0.13; F.tilt = 0; F.es = 1.08; F.toe = 0.42; }
    else if (form === 'smoke') { F.ey = 0.37 + Math.sin(c.time * 1.7) * 0.025; F.ez = 0.27; F.ex = 0.118; F.tilt = 0; F.es = 0.95; F.toe = 0.4; }
    else if (form === 'spark') { F.ey = 0.17; F.ez = 0.1; F.ex = 0.066; F.tilt = 0; F.es = 0.66; F.toe = 0.3; }
    else {
      const st = this.bodies.ember.scale.y / Math.max(0.01, this.pop), wd = this.bodies.ember.scale.x / Math.max(0.01, this.pop);
      F.ey = 0.265 * st; F.ez = 0.285 * wd; F.ex = 0.118 * wd; F.tilt = 0; F.es = 1; F.toe = 0.3;
    }
    return F;
  }

  trails(c) {
    const { p, form, sp, x, y, z, P, rm } = c;
    // the scorch: glowing marks behind a coal or a blaze as it crosses a floor
    if ((form === 'ember' || form === 'blaze') && p.grounded && p.ground && p.ground.kind !== 'ramp') {
      if (Math.hypot(x - this.lastPrint.x, z - this.lastPrint.z) > (form === 'blaze' ? 0.45 : 0.6) || Math.abs(y - this.lastPrint.y) > 0.2) {
        this.prints.add(x, y, z, form === 'blaze' ? 0.75 + P.rnd() * 0.2 : 0.42 + P.rnd() * 0.14);
        this.lastPrint.set(x, y, z);
      }
    }
    if (this.emitAcc <= 0.04) return;
    this.emitAcc = 0;
    if (form === 'blaze') {
      // sparks torn off the top, embers that fall back, a rag of smoke above
      P.spawn({ x: x + (P.rnd() - 0.5) * 0.5, y: y + 0.9 + P.rnd() * 0.7, z: z + (P.rnd() - 0.5) * 0.5, vx: (P.rnd() - 0.5) * 1.2 - p.vx * 0.2, vy: 1.8 + P.rnd() * 2.4, vz: (P.rnd() - 0.5) * 1.2 - p.vz * 0.2, life: 0.5 + P.rnd() * 0.5, size: 0.05 + P.rnd() * 0.04, color: P.rnd() < 0.4 ? WHITE_HOT : HOT, drag: 0.6, solid: 0.25 });
      if (!rm && P.rnd() < 0.3) P.spawn({ x: x + (P.rnd() - 0.5) * 0.6, y: y + 0.5, z: z + (P.rnd() - 0.5) * 0.6, vx: (P.rnd() - 0.5) * 2, vy: 1.5 + P.rnd() * 1.5, vz: (P.rnd() - 0.5) * 2, life: 0.9, size: 0.06, color: C_EMBER, gravity: 5, solid: 0.3 });
      if (P.rnd() < 0.22) P.spawn({ x: x + this.trail.x * 1.2, y: y + 1.9, z: z + this.trail.y * 1.2, vx: (P.rnd() - 0.5) * 0.3, vy: 0.9, vz: (P.rnd() - 0.5) * 0.3, life: 1.1, size: 0.3, grow: 0.4, color: SOOT, alpha: 0.4, drag: 0.5, solid: 1 });
    } else if (form === 'smoke') {
      // wisps peeling away below, ember flecks adrift inside
      P.spawn({ x: x + (P.rnd() - 0.5) * 0.4, y: y + 0.05 + P.rnd() * 0.25, z: z + (P.rnd() - 0.5) * 0.4, vy: -0.25, life: 0.9, size: 0.3, grow: 0.3, color: SOOT, alpha: 0.45, drag: 1, solid: 1 });
      if (P.rnd() < 0.4) P.spawn({ x: x + (P.rnd() - 0.5) * 0.5, y: y + 0.15 + P.rnd() * 0.5, z: z + (P.rnd() - 0.5) * 0.5, vx: (P.rnd() - 0.5) * 0.3, vy: 0.2 + P.rnd() * 0.3, vz: (P.rnd() - 0.5) * 0.3, life: 0.7, size: 0.055, color: P.rnd() < 0.5 ? HOT : C_EMBER, solid: 0.2 });
    } else if (form === 'spark') {
      if (!rm || P.rnd() < 0.3) P.spawn({ x: x + (P.rnd() - 0.5) * 0.25, y: y + 0.05 + P.rnd() * 0.25, z: z + (P.rnd() - 0.5) * 0.25, vx: (P.rnd() - 0.5) * 3 - p.vx * 0.1, vy: (P.rnd() - 0.3) * 3, vz: (P.rnd() - 0.5) * 3 - p.vz * 0.1, life: 0.18, size: 0.06, color: C_SPARK, drag: 4, solid: 0.2 });
    } else if (p.grounded && sp > 3.5 && P.rnd() < 0.45) {
      // an ember running: sparks kicked up behind
      P.spawn({ x: x + (P.rnd() - 0.5) * 0.2, y: y + 0.05, z: z + (P.rnd() - 0.5) * 0.2, vx: -p.vx * 0.2, vy: 1 + P.rnd() * 1.2, vz: -p.vz * 0.2, life: 0.4, size: 0.055, color: C_EMBER, gravity: 6, solid: 0.3 });
    } else if (P.rnd() < 0.16) {
      // at rest: a spark off the flame, a thread of smoke
      if (P.rnd() < 0.5) P.spawn({ x, y: y + 0.95, z, vx: (P.rnd() - 0.5) * 0.15, vy: 0.5, life: 0.9, size: 0.12, grow: 0.2, color: SOOT, alpha: 0.35, drag: 0.5, solid: 1 });
      else P.spawn({ x: x + (P.rnd() - 0.5) * 0.1, y: y + 0.8, z: z + (P.rnd() - 0.5) * 0.1, vx: (P.rnd() - 0.5) * 0.5, vy: 1.2 + P.rnd(), vz: (P.rnd() - 0.5) * 0.5, life: 0.6, size: 0.045, color: HOT, solid: 0.2 });
    }
  }

  /** Not a shadow: the pool of light Cinder throws on the ground below (bigger and brighter as a blaze). */
  groundMark(form, h, c) {
    const fl = c.rm ? 1 : 0.94 + 0.06 * Math.sin(c.time * 13.0) * Math.sin(c.time * 7.3);
    const base = form === 'blaze' ? 4.4 : form === 'smoke' ? 1.8 : form === 'spark' ? 2.2 : 2.8;
    const a = form === 'blaze' ? 0.2 : form === 'smoke' ? 0.06 : form === 'spark' ? 0.2 : 0.16;
    MARK.size = base * (1 + Math.min(0.5, h * 0.08)) * fl;
    MARK.alpha = a * (0.55 + 0.45 * this.heat) * (1 - Math.min(0.75, h * 0.1)) * fl + this.flash * 0.3;
    return MARK;
  }

  /** The glow Cinder throws on the world: the renderer's one hero light takes this colour and power, flicker and all. */
  light(form, p, c) {
    const fl = c && !c.rm ? 0.9 + 0.1 * Math.sin(c.time * 11.0) * Math.sin(c.time * 5.7) + 0.04 * Math.sin(c.time * 31.0) : 1;
    // a deep orange, and modest: it tints the walls and floor round Cinder, it must never bleach them
    LIGHT.color = LIGHT_COLORS[form];
    LIGHT.power = (form === 'blaze' ? 15 : form === 'smoke' ? 3 : form === 'spark' ? 9 : 6 + 5 * this.heat) * fl;
    LIGHT.range = form === 'blaze' ? 13 : 9;
    return LIGHT;
  }

  /** Heat shimmer above the flames (none over smoke, a little over a spark). */
  shimmer(form) {
    if (form === 'smoke') return null;
    SHIM.y = form === 'blaze' ? 1.5 : 0.9; SHIM.r = form === 'blaze' ? 1.2 : form === 'spark' ? 0.5 : 0.7;
    SHIM.k = (form === 'blaze' ? 1 : form === 'spark' ? 0.35 : 0.55) * (0.5 + 0.5 * this.heat);
    return SHIM;
  }
}
