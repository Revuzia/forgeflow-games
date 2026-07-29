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
  attribute float aVariant;  // which baked person this seat is (impostors)
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

/**
 * Impostor material for the mid/far tiers: an UNLIT textured quad per person,
 * billboarded in view space, sampling one column of the baked atlas by viewing
 * angle and one row by wave state. Unlit (MeshBasicMaterial base) because the
 * atlas is BAKED LIT — lighting a photograph of a lit body double-lights it.
 * Keeps every crowd behaviour: the same CROWD_PARS/VERT drive idle bob,
 * excitement bounce, the travelling wave (rise + row select) and the lean
 * shear; per-instance colour still multiplies for palette variety and row-AO.
 */
function makeImpostorMaterial(atlas, { rows = 2, pairs = 1 } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, map: atlas, alphaTest: 0.35, side: THREE.DoubleSide,
  });
  mat.name = "crowd_impostor";
  mat.userData.uniforms = {
    uTime: { value: 0 },
    uExcitement: { value: 0.25 },
    uWavePos: { value: -1 },
    uWaveWidth: { value: 0.5 },
    uWaveStrength: { value: 0 },
    uFocus: { value: new THREE.Vector3(0, 0, 0) },
    // Atlas layout: `uRows` cells tall, the first `uPairs` rows are the calm
    // people and the next `uPairs` are the same people cheering, so standing
    // is row + uPairs and a spectator never changes identity mid-wave.
    uRows: { value: rows },
    uPairs: { value: pairs },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + CROWD_PARS +
        "\nuniform float uRows;\nuniform float uPairs;\nvarying vec2 vAtlasUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + CROWD_VERT + `
  // --- atlas frame select ---------------------------------------------------
  // Column: the viewing azimuth of THIS person from the camera, quantised to
  // the 8 baked yaws. Row: standing (wave/excitement) switches to the arms-up
  // bake. uv is the quad's 0..1 corner uv.
  vec3 iwp = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 mwp = (modelMatrix * vec4(iwp, 1.0)).xyz;
  float viewAz = atan(cameraPosition.x - mwp.x, cameraPosition.z - mwp.z);
  float faceAz = atan(-iwp.x, -iwp.z);            // they face the arena centre
  float rel = viewAz - faceAz;
  float col = floor(mod(rel + 3.14159265 + 0.3926991, 6.2831853) / 6.2831853 * 8.0);
  // WHICH PERSON: aVariant picks one of the calm rows; standing shifts to
  // that same person's cheering row (uPairs below).
  float baseRow = (uPairs > 1.0) ? mod(floor(aVariant), uPairs) : 0.0;
  float row = baseRow + ((vStand > 0.5) ? uPairs : 0.0);
  vAtlasUv = (uv + vec2(col, row)) / vec2(8.0, uRows);
`)
      .replace("#include <project_vertex>", `
  // Billboard: the instance's translation, then the (already wave-displaced)
  // quad corner applied in VIEW space so every card faces the camera.
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xyz += vec3(transformed.x, transformed.y, 0.0);
  gl_Position = projectionMatrix * mvPosition;
`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vStand;\nvarying vec2 vAtlasUv;")
      .replace("#include <map_fragment>", `
  vec4 sampledDiffuseColor = texture2D(map, vAtlasUv);
  diffuseColor *= sampledDiffuseColor;
`)
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n" + CROWD_FRAG);
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => "colosseum_crowd_impostor_v1";
  return mat;
}

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
        rowsMeta.push({ a, b, y, cap, tierIndex: ti, tier, rowFrac: tier.rows > 1 ? r / (tier.rows - 1) : 0 });
        wanted += cap;
      }
    });

    // Scale every row down proportionally to hit the budget.
    const scale = Math.min(1, this.budget / Math.max(1, wanted));
    // NEAR = the podium only (tier 0). It was the first TWO tiers, which put
    // 4,714 people on the 150-triangle figure — 707k of the frame's 1.43M
    // triangles, for bodies the player never gets closer than 20 m to. Tier 1
    // moves to the MID bucket, which after bakeImpostors is a photographic
    // card of the real gladiator body: cheaper AND better-looking than the
    // low-poly figure it replaces.
    const NEAR_TIERS = 1;
    // Tiers past NEAR that still get a recognisable figure (LOD1) instead of
    // dropping straight to the cheapest silhouette.
    const MID_TIERS = 2;

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
          rowFrac: row.rowFrac,
        });
      }
    }

    // SECTOR SPLIT — the single biggest frame-time win in the game.
    //
    // One InstancedMesh per tier meant one draw call per tier, which sounds
    // optimal and is a trap: an InstancedMesh is culled as ONE object, and a
    // ring around the camera is never off-screen, so `frustumCulled = false`
    // was the only honest setting and all 17,974 spectators were submitted
    // every frame from every angle. Measured on this machine at DPR 1: the
    // crowd cost 5.1 of the frame's 6.9 ms — 73% of the entire budget, with
    // the near tier alone pushing 707k of the 1.43M triangles per frame.
    //
    // Splitting each tier into angular wedges lets the GPU skip the ~two
    // thirds of the bowl behind the camera: each wedge is its own cullable
    // object with an instance-aware bounding sphere. The cost is a handful
    // of extra draw calls (24 total, of which ~8-10 survive culling) — which
    // is nothing next to the vertex and fill work it removes.
    this.parts = {};
    this.parts.near = this._makeSectors(spectatorLOD(0), nearSeats, palette, "crowd_near");
    this.parts.mid = this._makeSectors(spectatorLOD(1), midSeats, palette, "crowd_mid");
    this.parts.far = this._makeSectors(spectatorLOD(2), farSeats, palette, "crowd_far");
    this.count = nearSeats.length + midSeats.length + farSeats.length;
  }

  /** Split one tier's seats into angular wedges, each independently cullable. */
  _makeSectors(geo, seats, palette, name) {
    if (!seats.length) return [];
    // 16 wedges of 22.5 deg. At 8 the spheres were wide enough that 16 of 24
    // still passed the frustum from a floor-level camera (measured); halving
    // the arc tightens the test. Draw calls are free next to the vertex and
    // fill work each rejected wedge removes.
    const SECTORS = 16;
    const buckets = Array.from({ length: SECTORS }, () => []);
    for (const s of seats) {
      const a = Math.atan2(s.z, s.x);                 // -PI..PI
      const k = Math.min(SECTORS - 1, Math.floor(((a + Math.PI) / TAU) * SECTORS));
      buckets[k].push(s);
    }
    const out = [];
    buckets.forEach((b, i) => {
      if (!b.length) return;
      const inst = this._makeInstanced(geo, b, palette, `${name}_s${i}`);
      if (inst) out.push(inst);
    });
    return out;
  }

  _makeInstanced(sharedGeo, seats, palette, name) {
    if (!seats.length) return null;
    const rnd = this.rnd;
    // PER-SECTOR GEOMETRY. The instance attributes (phase, scale, theta,
    // eager, colour) are set ON THE GEOMETRY, so sectors sharing one geometry
    // object would each overwrite the last one's people — every wedge would
    // animate and be coloured with the final wedge's data, and the instance
    // counts would mismatch the attribute lengths. One clone per wedge; a
    // 150-triangle figure copied eight times is nothing.
    const geo = sharedGeo.clone();
    const inst = new THREE.InstancedMesh(geo, this.mat, seats.length);
    inst.name = name;
    inst.castShadow = false;      // 20k shadow casters is an instant framerate death
    inst.receiveShadow = false;
    // Each WEDGE is cullable (see the sector-split note above). The bounding
    // sphere is computed from the instance matrices after they are written,
    // then padded for the wave/bounce displacement the vertex shader adds.
    inst.frustumCulled = true;
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const phase = new Float32Array(seats.length);
    const sscale = new Float32Array(seats.length);
    const theta = new Float32Array(seats.length);
    const eager = new Float32Array(seats.length);
    const variant = new Float32Array(seats.length);
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
      // Which baked Roman sits here. 8 is the ceiling the shader modulos
      // against the real row count at bake time, so this is stable whether
      // the atlas ends up with two people or six.
      variant[i] = (rnd() * 8) | 0;

      const c = palette[(rnd() * palette.length) | 0];
      // slight per-person value jitter so the palette doesn't band
      const j = 0.86 + rnd() * 0.28;
      // ROW AO: the back of every tier sits under the next tier's overhang, so
      // spectators darken toward the rear of their section. Costs nothing (it
      // rides the existing per-instance color) and breaks the uniform-
      // brightness wall that made the crowd read as flat confetti — depth cues
      // come from occlusion gradients, not from triangle count.
      const ao = 1 - (s.rowFrac || 0) * 0.32 - (s.tierIndex >= 3 ? 0.06 : 0);
      color[i * 3] = c.r * j * ao;
      color[i * 3 + 1] = c.g * j * ao;
      color[i * 3 + 2] = c.b * j * ao;
    });

    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute("aScale", new THREE.InstancedBufferAttribute(sscale, 1));
    geo.setAttribute("aTheta", new THREE.InstancedBufferAttribute(theta, 1));
    geo.setAttribute("aEager", new THREE.InstancedBufferAttribute(eager, 1));
    geo.setAttribute("aVariant", new THREE.InstancedBufferAttribute(variant, 1));
    geo.setAttribute("color", new THREE.InstancedBufferAttribute(color, 3));

    inst.instanceMatrix.needsUpdate = true;
    // Cullable bounds, padded for what the vertex shader adds on top of the
    // instance matrix: the idle bob, the excitement bounce, the standing
    // rise of the travelling wave, and the impostor card's own height.
    inst.computeBoundingSphere();
    if (inst.boundingSphere) inst.boundingSphere.radius += 2.0;
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

    const mats = this._impostorMat ? [this.mat, this._impostorMat] : [this.mat];
    for (const m of mats) {
      const u = m.userData.uniforms;
      u.uTime.value = this._t;
      u.uExcitement.value = this.excitement;
      u.uWavePos.value = this.wave.active ? this.wave.pos : -1;
      u.uWaveWidth.value = this.wave.width || 0.6;
      u.uWaveStrength.value = this.wave.active ? this.wave.strength : 0;
      u.uFocus.value.copy(this.focus);
    }
  }

  /**
   * Bake the impostor atlas from the REAL fighter body and swap the mid/far
   * tiers to billboarded cards sampling it.
   *
   * The audit's finding: ~74% of the crowd rendered as vertex-coloured slabs
   * with a nub head — the loudest "not a real game" signal on screen, and no
   * amount of triangle budget at these instance counts fixes it. The industry
   * answer at stadium scale (FIFA/NBA 2K lineage) is textured impostors:
   * VARIETY AND SILHOUETTE come from a texture of a real body, not geometry.
   *
   * 8 yaw columns x 2 pose rows (seated-idle, arms-up) rendered once at load
   * into a 1024x512 target from the actual Meshy gladiator body — so the crowd
   * is made of the same humanity as the fighters. Near tier keeps its mesh.
   * Called from boot AFTER the fighter library loads; failure leaves the
   * geometric crowd in place (honest fallback, logged).
   */
  /**
   * @param {object} opts
   *   makeBody  () => Actor — the fallback body (the player's own gladiator)
   *   people    [{ scene, cheer }] — Meshy-generated civilians. When present
   *             they REPLACE the gladiator bake: one atlas row per person,
   *             calm rows first, cheering rows second, so the stands hold six
   *             different Romans in two poses instead of 18,000 clones.
   */
  bakeImpostors(renderer, fighterLib, { makeBody = null, people = null } = {}) {
    if (this._impostorMat) return false;
    const civilians = (people || []).filter((p) => p && p.scene);
    const calm = civilians.filter((p) => !p.cheer);
    const cheer = civilians.filter((p) => p.cheer);
    // Pair them up: every calm person needs a cheering counterpart row, so the
    // wave can stand a specific individual up without changing who they are.
    const PAIRS = Math.min(calm.length, cheer.length);
    const useCivilians = PAIRS >= 2;
    if (!useCivilians && (!fighterLib || !fighterLib.scene || !makeBody)) return false;

    const COLS = 8;
    const ROWS = useCivilians ? PAIRS * 2 : 2;
    // A person is twice as tall as wide, and the ortho frustum below is 1.1 x
    // 2.0 — the cell has to match that aspect or every spectator is squashed.
    // Cell doubled to 256x512 (was 128x256): these cards now carry the whole
    // near tier, where the camera gets within a few metres.
    const CELL_W = 256, CELL_H = 512;
    const W = COLS * CELL_W, H = ROWS * CELL_H;

    // The body comes from a REAL Actor, not a raw scene clone. A raw clone
    // renders in the glTF BIND pose, and on these Meshy rigs the bind pose is
    // DEGENERATE — the same collapsed-joint mess Skeleton.pose() produced in
    // the equipment work — so the first version of this bake photographed a
    // crumpled blob and the cards came out empty. Actor normalises height
    // under a RUNNING clip (its constructor steps the mixer), which is the
    // only pose these rigs are trustworthy in.
    const stage = new THREE.Scene();
    stage.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(2, 4, 3);
    stage.add(sun);

    // Every subject is normalised to the same seated-eye height and centred,
    // so a card from row 0 and a card from row 5 sit at the same scale in the
    // stands regardless of what scale Meshy exported them at.
    const NORM_H = 1.72;
    const stageSubject = (obj) => {
      const g = new THREE.Group();
      g.add(obj);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const h = Math.max(0.05, box.max.y - box.min.y);
      const s = NORM_H / h;
      obj.scale.setScalar(s);
      obj.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(obj);
      obj.position.x -= (b2.min.x + b2.max.x) / 2;
      obj.position.z -= (b2.min.z + b2.max.z) / 2;
      obj.position.y -= b2.min.y;                 // feet on the origin plane
      return g;
    };

    let actorBody = null, body = null;
    const subjects = [];
    if (useCivilians) {
      // Rows: [calm0..calmN-1, cheer0..cheerN-1] — the standing row of person
      // i is i + PAIRS, which is exactly what the shader adds on vStand.
      for (let i = 0; i < PAIRS; i++) subjects.push(stageSubject(calm[i].scene));
      for (let i = 0; i < PAIRS; i++) subjects.push(stageSubject(cheer[i].scene));
    } else {
      actorBody = makeBody();                     // an Actor, ~1.75 m, idling
      body = actorBody.root;
      stage.add(body);
    }

    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 0 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.OrthographicCamera(-0.55, 0.55, 1.95, -0.05, 0.1, 20);

    const armsUp = () => {
      // Crude but effective: throw both arms overhead for the wave row.
      body.traverse((o) => {
        if (o.isBone && /^(Left|Right)Arm$/.test(o.name)) {
          o.rotation.z += o.name[0] === "L" ? 2.4 : -2.4;
        }
      });
    };

    const prevRT = renderer.getRenderTarget();
    const prevClear = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    // AUTOCLEAR OFF, SCISSOR PER CELL. render() auto-clears the whole target
    // by default, so the first version of this loop erased every cell except
    // the last — 15 of 16 atlas frames came out empty, alphaTest culled the
    // cards sampling them, and the upper bowl went sparse. The capture caught
    // it immediately.
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    cam.position.set(0, 0.95, 6);
    cam.lookAt(0, 0.95, 0);
    for (let row = 0; row < ROWS; row++) {
      // One subject on the stage at a time: the civilians swap per row, the
      // single gladiator fallback just raises its arms for row 1.
      let subject = body;
      if (useCivilians) {
        subject = subjects[row];
        stage.add(subject);
      } else if (row === 1) {
        armsUp();
      }
      for (let col = 0; col < COLS; col++) {
        subject.rotation.y = (col / COLS) * TAU;
        const vx = col * CELL_W, vy = row * CELL_H;
        renderer.setViewport(vx, vy, CELL_W, CELL_H);
        renderer.setScissor(vx, vy, CELL_W, CELL_H);
        renderer.render(stage, cam);
      }
      if (useCivilians) subject.removeFromParent();
    }
    renderer.setScissorTest(false);
    renderer.autoClear = prevAuto;
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(0x000000, prevClear);

    // Swap the two cheap tiers onto cards.
    this._impostorMat = makeImpostorMaterial(rt.texture, { rows: ROWS, pairs: useCivilians ? PAIRS : 1 });
    // WITH REAL PEOPLE BAKED, EVERY TIER GOES ON CARDS — including the podium
    // the camera walks past. A 256x512 photograph of a Meshy Roman beats a
    // 150-triangle abstraction at any distance the player ever sees, and it
    // costs two triangles instead of a hundred and fifty. Without civilians
    // the near tier keeps its mesh (one gladiator cloned 900 times at arm's
    // reach would read worse than the abstraction).
    const tiers = useCivilians ? ["near", "mid", "far"] : ["mid", "far"];
    let swapped = 0;
    for (const tier of tiers) {
      const sectors = this.parts[tier] || [];
      if (!sectors.length) continue;
      // Every WEDGE swaps its own geometry — each carries its own instance
      // attributes (see the clone note in _makeInstanced), so the quad has to
      // inherit that wedge's arrays, not the tier's.
      for (const inst of sectors) {
        const old = inst.geometry;
        const quad = new THREE.PlaneGeometry(0.85, 1.9);
        quad.translate(0, 0.95, 0);                  // feet at the seat point
        for (const name of ["aPhase", "aScale", "aTheta", "aEager", "aVariant", "color"]) {
          const attr = old.getAttribute(name);
          if (attr) quad.setAttribute(name, attr);
        }
        inst.geometry = quad;
        inst.material = this._impostorMat;
        old.dispose();
        inst.computeBoundingSphere();
        if (inst.boundingSphere) inst.boundingSphere.radius += 2.0;
      }
      swapped++;
    }
    this._atlas = rt;
    this._people = useCivilians ? PAIRS * 2 : 1;
    return swapped === tiers.length;
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
    const tierCount = (k) => (this.parts[k] || []).reduce((n, m) => n + m.count, 0);
    const sectors = ["near", "mid", "far"].reduce((n, k) => n + (this.parts[k] || []).length, 0);
    const visible = ["near", "mid", "far"].reduce(
      (n, k) => n + (this.parts[k] || []).filter((m) => m.visible).length, 0);
    return {
      instances: this.count,
      count: this.count,
      budget: this.budget,
      near: tierCount("near"),
      mid: tierCount("mid"),
      far: tierCount("far"),
      // Sectors SUBMITTED, not sectors drawn — the GPU-side frustum cull
      // happens after this, and typically keeps a third of them.
      drawCalls: sectors,
      sectors, visibleSectors: visible,
      tris: tierCount("near") * 150 + tierCount("mid") * 52 + tierCount("far") * 15,
      excitement: +this.excitement.toFixed(3),
      wave: this.wave.active,
    };
  }

  dispose() {
    for (const k of ["near", "mid", "far"]) {
      for (const p of this.parts[k] || []) { p.geometry.dispose(); this.group.remove(p); }
    }
    this.mat.dispose();
    this.parent.remove(this.group);
  }
}
