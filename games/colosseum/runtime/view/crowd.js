// Colosseum — the crowd.
//
// ~50,000 Romans watched from the cavea and the crowd IS the spectacle: the
// arena is dead without it. The constraint is that a crowd cannot cost more
// than a couple of draw calls, so:
//
//   * TWO InstancedMeshes, split by distance-from-arena, not by frustum:
//       near  (podium + maenianum primum)  — a readable seated figure, ~30 tris
//       far   (secundum + summum)          — a 3-quad blob, ~12 tris
//     Everything else about them is identical, so the split costs 1 extra call
//     and buys a ~4x triangle saving on the 75% of the crowd nobody looks at.
//
//   * ALL animation happens in the vertex shader. Zero per-instance CPU work
//     per frame — the matrices are uploaded once at build time and never
//     touched again. The crowd reacts through *uniforms*:
//         uExcitement  0..1   global arousal — bob amplitude, stand-up chance
//         uWave        travelling Mexican wave (position + width + strength)
//         uFocus       where the action is; spectators lean toward it
//     A uniform write is free, so "24,000 people leap to their feet when the
//     lion hits the sand" costs exactly nothing.
//
//   * Per-instance variation (phase, height, colour, row) rides in instanced
//     attributes so no two neighbours move alike — the single biggest thing
//     separating a crowd from a texture.

import * as THREE from "three";
import { SPECTATOR_LODS } from "./spectator_geo.js";
import { ARENA, caveaLayout } from "../data/arena_spec.js";
import { TAU, mulberry32, ellipsePerimeter } from "../core/util.js";

// ---------------------------------------------------------------------------
// Spectator geometry
// ---------------------------------------------------------------------------

/**
 * Seated-spectator geometry, one of three LODs.
 *
 * Authored in Blender (tools/gen_spectator.py) and baked to a JS module
 * (tools/bake_spectator.mjs) so the crowd builds synchronously at boot with no
 * fetch — an amphitheatre that visibly populates late looks far worse than a
 * slightly cruder figure that is simply there from the first frame.
 *
 * These replace two hand-stacked primitive figures. The old near figure was a
 * box thigh + 5-gon cylinder torso + octahedron head (~30 tris); the old far
 * figure — 73.8% of all 17,974 spectators — was a single 4-sided tapered
 * cylinder. A 4-gon prism has no head break, no shoulder line and no lap, so
 * the far cavea read as coloured confetti rather than as people.
 *
 * Silhouette is the only thing that survives to this distance, and all three
 * LODs keep the three cues that make one: a head separated by a real neck gap,
 * shoulders clearly wider than the head, and a lap projecting forward.
 *
 * Flat-shaded and non-indexed, matching the instanced vertex-colour material
 * and keeping the attribute layout identical across all three meshes.
 */
function spectatorLOD(level) {
  const src = SPECTATOR_LODS[level];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(src.position.slice(), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(src.normal.slice(), 3));
  return g;
}

// ---------------------------------------------------------------------------
// Shader injection
// ---------------------------------------------------------------------------

const CROWD_PARS = /* glsl */ `
  attribute float aPhase;    // 0..TAU personal animation offset
  attribute float aScale;    // 0.86..1.14 body size variation
  attribute float aTheta;    // angular position on the ellipse (for the wave)
  attribute float aEager;    // 0..1 how readily this one stands up
  uniform float uTime;
  uniform float uExcitement; // 0..1
  uniform float uWavePos;    // travelling wave centre, radians; <0 = no wave
  uniform float uWaveWidth;
  uniform float uWaveStrength;
  uniform vec3  uFocus;      // world point the crowd is watching
  varying float vStand;
`;

const CROWD_VERT = /* glsl */ `
  // --- per-person idle: a small, slow, desynchronised bob ------------------
  float idle = sin(uTime * 1.7 + aPhase) * 0.018
             + sin(uTime * 0.9 + aPhase * 1.7) * 0.012;

  // --- excitement: bounce harder and more often ----------------------------
  float ex = uExcitement * aEager;
  float bounce = abs(sin(uTime * (3.2 + aEager * 2.4) + aPhase)) * 0.085 * ex;

  // --- the wave: a gaussian band sweeping round the ellipse ----------------
  float stand = 0.0;
  if (uWavePos >= 0.0) {
    float d = aTheta - uWavePos;
    d = atan(sin(d), cos(d));                 // wrap to [-PI, PI]
    float w = exp(-(d * d) / (uWaveWidth * uWaveWidth));
    stand = w * uWaveStrength;
  }
  // sustained excitement makes the eager ones stand on their own
  stand = max(stand, smoothstep(0.55, 1.0, ex) * step(0.45, aEager));
  vStand = stand;

  // Standing = rise off the seat and straighten (scale up along y).
  float rise = stand * 0.42;
  float stretch = 1.0 + stand * 0.55;

  transformed.y *= (aScale * stretch);
  transformed.xz *= aScale;
  transformed.y += idle + bounce + rise;

  // --- lean toward the action ----------------------------------------------
  // Rotating each instance properly would need a matrix per person; a shear
  // toward the focus point is one add and visually indistinguishable at range.
  vec3 wp = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 toFocus = normalize(uFocus.xz - wp.xz + vec2(1e-5));
  float lean = (0.10 + 0.16 * ex) * transformed.y;
  // instanceMatrix has no rotation for the crowd (they all face inward via the
  // matrix), so shear in local space along the focus direction projected in.
  transformed.x += toFocus.x * lean * 0.35;
  transformed.z += toFocus.y * lean * 0.35;
`;

const CROWD_FRAG = /* glsl */ `
  // Standing spectators read slightly brighter — they have caught the light
  // by lifting out of the row's self-shadow. Cheap, and it makes the wave pop.
  gl_FragColor.rgb *= (1.0 + vStand * 0.22);
`;

function makeCrowdMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.name = "crowd";
  mat.userData.uniforms = {
    uTime: { value: 0 },
    uExcitement: { value: 0.25 },
    uWavePos: { value: -1 },
    uWaveWidth: { value: 0.5 },
    uWaveStrength: { value: 0 },
    uFocus: { value: new THREE.Vector3(0, 0, 0) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + CROWD_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + CROWD_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vStand;")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n" + CROWD_FRAG);
    mat.userData.shader = shader;
  };
  // Force a distinct program from any other Lambert material in the scene.
  mat.customProgramCacheKey = () => "colosseum_crowd_v1";
  return mat;
}

// ---------------------------------------------------------------------------
// Crowd
// ---------------------------------------------------------------------------

export class Crowd {
  /**
   * @param {THREE.Scene|THREE.Group} parent
   * @param {object} opts  { quality, seed, spec }
   */
  constructor(parent, { quality = "high", seed = 4242, spec = ARENA } = {}) {
    this.parent = parent;
    this.spec = spec;
    this.rnd = mulberry32(seed);
    this.quality = quality;

    // Population scales with quality. Even 'low' keeps a full ring of people —
    // an empty Colosseum is worse than a coarse one — it just thins the rows.
    this.budget = {
      low: 5000, medium: 11000, high: 18000, ultra: 26000,
    }[quality] || 18000;

    this.mat = makeCrowdMaterial();
    this.group = new THREE.Group();
    this.group.name = "crowd";
    parent.add(this.group);

    // Reactive state, all driven into uniforms.
    this.excitement = 0.25;
    this.targetExcitement = 0.25;
    this.wave = { active: false, pos: 0, speed: 2.4, laps: 0, maxLaps: 1, strength: 0 };
    this.focus = new THREE.Vector3(0, 0, 0);
    this._t = 0;

    this._build();
  }

  _build() {
    const layout = caveaLayout(this.spec);
    const rnd = this.rnd;
    const pitch = this.spec.crowd.seatPitch;
    const palette = this.spec.crowd.palette.map((h) => new THREE.Color(h));

    // -- decide how many people sit in each row -----------------------------
    // Row capacity is arc-length / seat pitch, scaled by the tier's density
    // (the podium was sparse and grand; the upper tiers were packed).
    const rowsMeta = [];
    let wanted = 0;
    layout.forEach((tier, ti) => {
      for (let r = 0; r < tier.rows; r++) {
        const a = tier.startA + r * tier.run + tier.run * 0.5;
        const b = tier.startB + r * tier.run + tier.run * 0.5;
        const y = tier.startY + r * tier.rise + tier.rise;
        const perim = ellipsePerimeter(a, b);
        const cap = Math.floor((perim / pitch) * tier.density);
        rowsMeta.push({ a, b, y, cap, tierIndex: ti, tier });
        wanted += cap;
      }
    });

    // Scale every row down proportionally to hit the budget.
    const scale = Math.min(1, this.budget / Math.max(1, wanted));
    // Near tiers = first two; they get the detailed mesh.
    const NEAR_TIERS = 2;
    // Tiers past NEAR that still get a recognisable figure (LOD1) instead of
    // dropping straight to the cheapest silhouette.
    const MID_TIERS = 1;

    const nearSeats = [];
    const midSeats = [];
    const farSeats = [];
    for (const row of rowsMeta) {
      const n = Math.max(0, Math.floor(row.cap * scale));
      // THREE tiers, not two. The old split put 73.8% of the crowd on a
      // 4-gon prism, which has no head break and no shoulder line and so read
      // as coloured confetti from the sand. The middle tier costs one extra
      // draw call and moves the confetti back to where nobody can resolve it.
      const bucket = row.tierIndex < NEAR_TIERS ? nearSeats
        : row.tierIndex < NEAR_TIERS + MID_TIERS ? midSeats
        : farSeats;
      // Random angular offset per row so columns of people don't line up.
      const off = rnd() * TAU;
      for (let i = 0; i < n; i++) {
        // Jitter within the seat slot — perfectly regular spacing reads fake.
        const t = off + ((i + (rnd() - 0.5) * 0.55) / n) * TAU;
        bucket.push({
          x: row.a * Math.cos(t),
          y: row.y,
          z: row.b * Math.sin(t),
          theta: Math.atan2(Math.sin(t), Math.cos(t)),
          tierIndex: row.tierIndex,
        });
      }
    }

    this.parts = {};
    this.parts.near = this._makeInstanced(spectatorLOD(0), nearSeats, palette, "crowd_near");
    this.parts.mid = this._makeInstanced(spectatorLOD(1), midSeats, palette, "crowd_mid");
    this.parts.far = this._makeInstanced(spectatorLOD(2), farSeats, palette, "crowd_far");
    this.count = nearSeats.length + midSeats.length + farSeats.length;
  }

  _makeInstanced(geo, seats, palette, name) {
    if (!seats.length) return null;
    const rnd = this.rnd;
    const inst = new THREE.InstancedMesh(geo, this.mat, seats.length);
    inst.name = name;
    inst.castShadow = false;      // 20k shadow casters is an instant framerate death
    inst.receiveShadow = false;
    inst.frustumCulled = false;   // the ring always straddles the frustum
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const phase = new Float32Array(seats.length);
    const sscale = new Float32Array(seats.length);
    const theta = new Float32Array(seats.length);
    const eager = new Float32Array(seats.length);
    const color = new Float32Array(seats.length * 3);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);

    seats.forEach((s, i) => {
      // Face inward toward the arena centre.
      const yaw = Math.atan2(-s.x, -s.z);
      q.setFromAxisAngle(up, yaw);
      pos.set(s.x, s.y, s.z);
      m.compose(pos, q, one);
      inst.setMatrixAt(i, m);

      phase[i] = rnd() * TAU;
      sscale[i] = 0.86 + rnd() * 0.28;
      theta[i] = s.theta;
      // Upper tiers were the rowdy cheap seats — they stand more readily.
      eager[i] = Math.min(1, 0.25 + rnd() * 0.75 + s.tierIndex * 0.06);

      const c = palette[(rnd() * palette.length) | 0];
      // slight per-person value jitter so the palette doesn't band
      const j = 0.86 + rnd() * 0.28;
      color[i * 3] = c.r * j;
      color[i * 3 + 1] = c.g * j;
      color[i * 3 + 2] = c.b * j;
    });

    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute("aScale", new THREE.InstancedBufferAttribute(sscale, 1));
    geo.setAttribute("aTheta", new THREE.InstancedBufferAttribute(theta, 1));
    geo.setAttribute("aEager", new THREE.InstancedBufferAttribute(eager, 1));
    geo.setAttribute("color", new THREE.InstancedBufferAttribute(color, 3));

    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
    return inst;
  }

  // -- reactions ------------------------------------------------------------

  /**
   * Set the crowd's arousal. The crowd does not snap — it swells and settles,
   * which is most of what makes it feel alive.
   * @param {number} v 0..1
   * @param {boolean} instant skip the ramp (e.g. a kill)
   */
  setExcitement(v, instant = false) {
    this.targetExcitement = Math.max(0, Math.min(1, v));
    if (instant) this.excitement = this.targetExcitement;
  }

  /** Bump excitement by a delta that decays back down over time. */
  react(amount) {
    this.targetExcitement = Math.min(1, this.targetExcitement + amount);
  }

  /** Kick off a Mexican wave travelling round the bowl. */
  startWave({ laps = 1, speed = 2.6, strength = 1, width = 0.6 } = {}) {
    this.wave.active = true;
    this.wave.pos = -Math.PI;
    this.wave.laps = 0;
    this.wave.maxLaps = laps;
    this.wave.speed = speed;
    this.wave.strength = strength;
    this.wave.width = width;
  }

  /** Point the crowd's attention at a world position (usually the player). */
  lookAt(v3) {
    this.focus.copy(v3);
  }

  update(dt) {
    this._t += dt;

    // Excitement eases toward target, and target bleeds back to a baseline
    // so a single hit doesn't leave the crowd permanently screaming.
    const rate = this.targetExcitement > this.excitement ? 4.5 : 1.1;
    this.excitement += (this.targetExcitement - this.excitement) * Math.min(1, rate * dt);
    this.targetExcitement += (0.22 - this.targetExcitement) * Math.min(1, 0.35 * dt);

    // Wave travel
    if (this.wave.active) {
      this.wave.pos += this.wave.speed * dt;
      if (this.wave.pos > Math.PI) {
        this.wave.pos -= TAU;
        this.wave.laps++;
        if (this.wave.laps >= this.wave.maxLaps) this.wave.active = false;
      }
    }

    const u = this.mat.userData.uniforms;
    u.uTime.value = this._t;
    u.uExcitement.value = this.excitement;
    u.uWavePos.value = this.wave.active ? this.wave.pos : -1;
    u.uWaveWidth.value = this.wave.width || 0.6;
    u.uWaveStrength.value = this.wave.active ? this.wave.strength : 0;
    u.uFocus.value.copy(this.focus);
  }

  /**
   * Live stats for the perf HUD / verification hooks.
   *
   * `instances` is the ACTUAL seated population, which is not the same as
   * ARENA.crowd.maxInstances — that value is only an upper clamp, and the real
   * figure comes out of row capacity x tier density x seat pitch (~18k at the
   * 'high' budget, not the 24k ceiling). Acceptance checks must assert against
   * this number, never against the config ceiling.
   */
  stats() {
    return {
      instances: this.count,
      count: this.count,
      budget: this.budget,
      near: this.parts.near ? this.parts.near.count : 0,
      mid: this.parts.mid ? this.parts.mid.count : 0,
      far: this.parts.far ? this.parts.far.count : 0,
      drawCalls: (this.parts.near ? 1 : 0) + (this.parts.mid ? 1 : 0) + (this.parts.far ? 1 : 0),
      tris: (this.parts.near ? this.parts.near.count * 150 : 0)
          + (this.parts.mid ? this.parts.mid.count * 52 : 0)
          + (this.parts.far ? this.parts.far.count * 15 : 0),
      excitement: +this.excitement.toFixed(3),
      wave: this.wave.active,
    };
  }

  dispose() {
    for (const k of ["near", "mid", "far"]) {
      const p = this.parts[k];
      if (p) { p.geometry.dispose(); this.group.remove(p); }
    }
    this.mat.dispose();
    this.parent.remove(this.group);
  }
}
