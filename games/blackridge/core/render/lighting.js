// core/render/lighting.js [A6] — THE fixed light pool + lease API.
// architecture §3.13 as amended R3: 1 DirectionalLight (moon, SOLE shadow
// caster, 1024 map) + 1 HemisphereLight + 8 SpotLight (static practicals) +
// 4 PointLight (dynamic fx leases: 3 muzzle grants + 1 explosion). ALL
// created at boot `visible:true, intensity:0`, NEVER added/removed at
// runtime (light count is a shader-permutation key — doctrine §3). Nobody
// else creates a THREE.Light.
//
// Also owned here (LD §3): the 8 practical binds (zone contrast baked into
// per-kind intensities), the 5 god-ray cone cards (LD §3.5 — additive fakes,
// view-angle + near-camera fade, ±5% flicker), sodium fog-disc cards
// (LD §5.2), head-glow sprites for every light pole, and the Market
// Blackout set-piece (LD §6 beat 3) — implemented as INTENSITY/EMISSIVE
// animation ONLY; the pool never resizes.
//
// Blackout trigger paths (all three wired, first one that fires wins):
//   1. lights.setPiece('transformer_blackout')  — public API (A11 scenarios)
//   2. sim.mission.drainSetPieces() polled in _tick — live the moment A0
//      adopts sim.mission (A1's offered simplification) or exposes the
//      started mission on ctx.
//   3. a 'setpiece' bridge event once A0 lands A1's freeze-amendment
//      (re-registered lazily since bridge.clear() wipes handlers).
//
// Relight data single source: layout.lightPoles L_PLAZA_KEY.blackout
// ({relight:'#4adcd6', level:0.4}) — LD §6's "35%" prose superseded (A2 flag).
//
// Frozen exports: createLights(ctx) → { bindStatic, lease, dynamicFree,
// moon, hemi }. Private additions: _tick(dt), setPiece(id), byId,
// keyAmbientRatio(), blackout state.

import * as THREE from "three";

const SPOT_COUNT = 8;
const POINT_COUNT = 4;

// Per-kind defaults for practical binds (candela-ish, three r172 physical
// units, decay 1.8). Zone contrast per LD §3.4: plaza = 100%, floods ~80%,
// sodium pockets 10–40%, arcade shaft 25%.
const KIND_DEFAULTS = {
  sodium:      { intensity: 46,  distance: 20, penumbra: 0.45, decay: 1.8 },
  // neon_bounce is a CAP, not just a default — see bindOne. 130 (level.js's
  // ask) painted the whole plaza instead of pooling it (iter02 S9).
  neon_bounce: { intensity: 58,  distance: 30, penumbra: 0.55, decay: 1.8 },
  skylight:    { intensity: 38,  distance: 16, penumbra: 0.35, decay: 1.8 },
  flood:       { intensity: 140, distance: 46, penumbra: 0.28, decay: 1.8 },
  default:     { intensity: 40,  distance: 18, penumbra: 0.4,  decay: 1.8 },
};

// ---------------------------------------------------------- bounce aggregate
// The plaza practical (kind 'neon_bounce', L_PLAZA_KEY) is an ABSTRACT
// aggregate: ONE 85 deg spot from 9 m standing in for the whole signage wall
// bouncing off wet stone. layout.js hands it the CLUB sign's own violet
// (#c86ee0), so iter02 S9 came back with mean RGB 40.5 / 38.3 / 58.4 — green
// BELOW red, the magenta signature — a uniform purple film over the frame.
// That breaks VT §1's colour script outright ("warm sodium / cool fluorescent
// practicals against the blue-hour key"; the cool-ambient vs warm-practical
// separation IS the night look).
//
// Two physical facts fix it, both derived from the SAME single source rather
// than a new magic constant: bounce light is (a) the SUM of every sign on the
// wall, not one of them, and (b) markedly less saturated than its source, so
// re-tinting or adding a sign in layout.js moves the plaza bounce with it.
const BOUNCE_SAT = 0.55; // chroma retained relative to the aggregate's own luma

function aggregateBounceColor(poles) {
  const acc = new THREE.Color(0, 0, 0);
  const c = new THREE.Color();
  let n = 0;
  for (const p of poles || []) {
    if (p.kind !== "neon" || !p.color) continue;
    c.set(p.color); // hex is sRGB; Color.set lands it in the linear working space
    acc.r += c.r; acc.g += c.g; acc.b += c.b;
    n++;
  }
  if (!n) return new THREE.Color(0xffd8b4); // warm fallback — never violet
  acc.multiplyScalar(1 / n);
  const luma = 0.2126 * acc.r + 0.7152 * acc.g + 0.0722 * acc.b;
  acc.r = luma + (acc.r - luma) * BOUNCE_SAT;
  acc.g = luma + (acc.g - luma) * BOUNCE_SAT;
  acc.b = luma + (acc.b - luma) * BOUNCE_SAT;
  // a light COLOUR is a tint; `intensity` carries the level. Normalise so
  // desaturating never doubles as a dimmer.
  acc.multiplyScalar(1 / Math.max(acc.r, acc.g, acc.b, 1e-5));
  return acc;
}

// God-ray cone opacity by kind (LD §3.5 — exactly the 5 godRay:true poles).
// DoubleSide sums both cylinder walls, and the cones stack on the ground
// pools + fog discs + the real spot — iter01 S4 read as orange paint at the
// old 0.13/0.17; fog is atmosphere, not paint (VT §4 / LD §3.4 zone plan).
const CONE_OPACITY = { sodium: 0.075, skylight: 0.14, flood: 0.11, default: 0.09 };

// ------------------------------------------------------- exposure constants
// VT §1 prescribes the key at "#a8c4e0 region". These are TINTS: each is close
// enough to unit luminance that `intensity` is the only level knob, which is
// what makes keyAmbientRatio() a meaningful number.
const MOON_TINT = 0xa8c0e0;   // relative luminance ~0.514
const HEMI_SKY = 0x4c6486;    // cold storm skylight,   ~0.124
const HEMI_GROUND = 0x2e2a20; // sodium-polluted asphalt bounce, ~0.023

// Relative luminance of a THREE.Color already in the linear working space.
const lumOf = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export function createLights(ctx) {
  const scene = ctx.scene;

  // ------------------------------------------------------------ the pool
  // Moon — the ONE shadow caster. Azimuth 310° (NW), elevation 38°,
  // #5a6b8c storm-filtered (LD §3.2). +X east, -Z north.
  // 0.42/0.085 (was 0.32/0.07): iter01 read as underexposed slabs — this
  // lifts material legibility while keeping key:ambient ≥4:1 (VT §1) and
  // the LD §3.4 zone-contrast ordering intact.
  //
  // W2/iter04 EXPOSURE FIX — the single cause of the "flat black slab" facades.
  // keyAmbientRatio() below used to compare RAW intensities and ignore each
  // light's COLOUR, so 0.42/0.085 reported "5.9:1 — passes VT §1". Measured in
  // real luminance the pool was 0.42*lum(#5a6b8c)=0.0613 key vs 0.085*lum of
  // the sky/ground mix = 0.00106 ambient — 57.6:1. Every surface not facing the
  // moon received ~1e-4 radiance, i.e. NOTHING: iter03 S3's foreground wall
  // measured RGB 6/7/10 with std 3.5, and that value is entirely post.js's
  // shadow-tint constant (vec3(0.0016,0.0020,0.0034)) — the geometry itself
  // contributed nothing at all. Fix is at the generator: colours are TINTS at
  // ~unit luminance, `intensity` carries the level, and the probe measures
  // luminance so the gate cannot pass on a lie again.
  //
  // W-LaneC / iter05 ATMOSPHERE RESTORE — iter04's exposure fix over-corrected.
  // Measured on the iter04 battery (PIL, luma = Rec.709 on the shipped PNGs):
  //   S9 ground-band mean 103.3 / sky-band mean 53.6 — the WET ASPHALT was
  //   twice as bright as the storm sky, which is the signature of an ambient
  //   term doing the lighting. Frame medians sat at 37-61/255 (a mid-grey
  //   median is an overcast DAY frame; a CoD night frame's median is 20-32)
  //   and only 0.4-2% of pixels fell below 8/255, i.e. nothing in the ward
  //   was allowed to be dark. Against iter03: S5 median 13, ground 12.1.
  // The cause is the hemisphere, not the key. A HemisphereLight is pure
  // directionless diffuse: it cannot cast, cannot separate zones, and an
  // UP-facing surface (all the ground) receives its full sky term. At
  // 6.1 x lum(#5c7290) = 0.996 the road was getting more radiance from the
  // ambient than from the moon (3.8 x 0.514 x sin 38 deg = 1.20) — hence flat.
  // Fix keeps iter04's legibility win and takes back the night in three
  // coordinated moves, all at the generator:
  //   (a) hemi 6.1 -> 4.6 and both terms re-tinted colder/darker: ambient
  //       luminance 0.623 -> 0.338 (-46%), the up-facing sky term 0.996 ->
  //       0.569 (-43%).
  //   (b) key 3.8 -> 4.4 so absolute legibility on moon-facing surfaces does
  //       not move while the RATIO opens up: 4.14:1 -> 7.9:1 (VT §1 needs
  //       >= 4:1; 4.14 was sitting on the floor, which is why the delete-the-
  //       key test nearly failed in S7).
  //   (c) scene.environment stays where it is (reflect.js, intensity 0.5):
  //       the IBL is the half of the ambient that carries SPECULAR, i.e. the
  //       wet-surface payoff. Cutting the hemisphere removes flat fill and
  //       keeps reflection — that split is the whole point.
  // level.js separately bakes wet-asphalt albedo into aowet.r; the two are
  // measured together (ground band must land BELOW the sky band).
  const moon = new THREE.DirectionalLight(MOON_TINT, 4.4);
  {
    const az = (310 * Math.PI) / 180;
    const el = (38 * Math.PI) / 180;
    // compass: dir = sin(az)*east + cos(az)*north; north = (0,0,-1)
    const hx = Math.sin(az), hz = -Math.cos(az);
    const ch = Math.cos(el), sv = Math.sin(el);
    moon.position.set(hx * ch * 140, sv * 140, hz * ch * 140);
  }
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024); // doctrine cap
  moon.shadow.camera.left = -85;
  moon.shadow.camera.right = 85;
  moon.shadow.camera.top = 85;
  moon.shadow.camera.bottom = -85;
  moon.shadow.camera.near = 20;
  moon.shadow.camera.far = 340;
  moon.shadow.bias = -0.00035;
  moon.shadow.normalBias = 0.03;
  moon.shadow.radius = 4; // soft (PCF radius 4, LD §3.2)
  moon.target.position.set(0, 0, 0);
  moon.layers.enableAll(); // v2.2: lights must reach EVERY camera's layer —
  // the viewmodel camera renders only layer 2; without this the gun draws
  // pitch-black in-mission (A4 needsElsewhere, VT amateur tell #9).
  scene.add(moon);
  scene.add(moon.target);

  // Hemisphere — the darkness floor. Sky #1a2030 / ground #0a0c10 with the
  // sodium-pollution tint #2a2418 mixed into the ground term (LD §3.2).
  // A VERTICAL surface sees the 50/50 sky/ground mix, so that mix — not the sky
  // term — is what the ratio must be measured against: it is the light every
  // facade in the frame actually gets. 4.6 * lum(mix 0.0735) = 0.338 vs the
  // key's 4.4 * 0.514 = 2.263 ⇒ 7.7:1, comfortably clear of VT §1's "≥ 4:1"
  // (iter04 sat at 4.14, ON the floor) with enough absolute level for shadowed
  // brick to carry its window grid, sills and grime. See the moon note above.
  const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, 4.6);
  hemi.layers.enableAll(); // v2.2: reach the viewmodel camera's layer (A4)
  scene.add(hemi);

  // 8 spots — static practical leases. Parked at intensity 0 until bound.
  const spots = [];
  for (let i = 0; i < SPOT_COUNT; i++) {
    const s = new THREE.SpotLight(0xffffff, 0, 18, 0.5, 0.4, 1.8);
    s.visible = true;
    s.castShadow = false; // moon is the sole shadow caster
    s.layers.enableAll(); // v2.2: reach the viewmodel camera's layer (A4)
    s.position.set(0, 40 + i, 0);
    s.target.position.set(0, 0, 0);
    scene.add(s);
    scene.add(s.target);
    spots.push(s);
  }

  // 4 points — dynamic fx leases (3 muzzle grants + 1 explosion).
  const points = [];
  const pointBusy = [false, false, false, false];
  for (let i = 0; i < POINT_COUNT; i++) {
    const p = new THREE.PointLight(0xffffff, 0, 10, 2.0);
    p.visible = true;
    p.layers.enableAll(); // v2.2: muzzle-flash leases must light the gun/hands (A4)
    p.position.set(0, -50 - i, 0); // parked below the map, intensity 0
    scene.add(p);
    points.push(p);
  }

  // ---------------------------------------------------------- decorations
  // Built at bindStatic time from layout.lightPoles (the single source).
  const decor = {
    built: false,
    cones: [],        // {mesh, mat, baseOpacity, phase, plaza:boolean}
    glowMesh: null,   // InstancedMesh — head glows, ALL poles
    glowMeta: [],     // {baseColor:THREE.Color, plaza, flicker, phase}
    discMesh: null,   // InstancedMesh — sodium fog-disc pools
    discMeta: [],
  };

  const byId = {}; // practical id → { spot, spec }

  // memoised bounce tint (layout.lightPoles is static for the level's life)
  let _bounce = null;
  function bounceColor() {
    if (!_bounce) {
      _bounce = aggregateBounceColor(
        (ctx.layout && ctx.layout.lightPoles) || [],
      );
    }
    return _bounce;
  }

  // ------------------------------------------------------------- blackout
  // State machine ticked by _tick(dt). Phases: idle → fading (0.4 s) →
  // dark (2.0 s) → relight (0.5 s ramp) → done. Intensity/emissive ONLY.
  const blackout = {
    phase: "idle", t: 0,
    fadeS: 0.4, darkS: 2.0, relightS: 0.5,
    spot: null, spec: null,
    origIntensity: 0, origColor: new THREE.Color(),
    relightColor: new THREE.Color(0x4adcd6), relightLevel: 0.4,
    emissives: null, // lazily collected [{mat, orig}]
    level: null,     // v2.2: A3's registry handles (level.js blackout registry)
    plazaGlowIdx: [], plazaDiscIdx: [], plazaConeIdx: [],
  };

  function collectBlackoutEmissives() {
    // Materials A3/A7 tag with userData.blackout = true (mesh or material)
    // die with the grid. Collected once, at trigger time.
    const out = [];
    const seen = new Set();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const flagged = o.userData && o.userData.blackout;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || seen.has(m)) continue;
        if (flagged || (m.userData && m.userData.blackout)) {
          seen.add(m);
          out.push({ mat: m, orig: m.emissiveIntensity !== undefined ? m.emissiveIntensity : 1 });
        }
      }
    });
    return out;
  }

  // v2.2 integration: level.js registers its plaza-circuit emissive mats,
  // glow sprites, and merged pool-decal mesh at group.userData.level
  // .practicals.blackout (A3's handles) rather than via userData.blackout
  // tags — consume that registry so the neon wall actually dies with the
  // grid (A6→A3 needsElsewhere, both halves now meet here). Collected ONCE
  // so a re-fired set-piece never captures dimmed values as originals.
  function collectLevelBlackout() {
    let reg = null;
    scene.traverse((o) => {
      if (!reg && o.userData && o.userData.level && o.userData.level.practicals) {
        reg = o.userData.level.practicals;
      }
    });
    const b = reg && reg.blackout;
    if (!b) return null;
    return {
      mats: (b.emissiveMats || []).map((m) => ({
        mat: m, orig: m.emissiveIntensity !== undefined ? m.emissiveIntensity : 1,
      })),
      sprites: (b.sprites || []).map((s) => {
        const m = (s && s.material) ? s.material : s;
        return { mat: m, orig: (m && m.opacity !== undefined) ? m.opacity : 1 };
      }),
      pool: (b.poolMesh && b.poolMesh.material)
        ? { mat: b.poolMesh.material, orig: b.poolMesh.material.opacity }
        : null,
    };
  }

  function startBlackout() {
    if (blackout.phase !== "idle" && blackout.phase !== "done") return;
    const entry = byId.L_PLAZA_KEY;
    blackout.spot = entry ? entry.spot : null;
    blackout.spec = entry ? entry.spec : null;
    if (blackout.spot) {
      blackout.origIntensity = blackout.spot.intensity;
      blackout.origColor.copy(blackout.spot.color);
    }
    const bd = blackout.spec && blackout.spec.blackout;
    if (bd) {
      if (bd.relight) blackout.relightColor.set(bd.relight);
      if (typeof bd.level === "number") blackout.relightLevel = bd.level;
    }
    if (!blackout.emissives) blackout.emissives = collectBlackoutEmissives();
    if (!blackout.level) blackout.level = collectLevelBlackout();
    blackout.phase = "fading";
    blackout.t = 0;
  }

  const _c = new THREE.Color(); // scratch (no per-frame allocs)

  function applyBlackoutDim(f) {
    // f: 1 → fully lit, 0 → dark. Applied to the key spot, tagged
    // emissives, and this module's own plaza glow/disc/cone instances.
    if (blackout.spot) blackout.spot.intensity = blackout.origIntensity * f;
    if (blackout.emissives) {
      for (const e of blackout.emissives) {
        if (e.mat.emissiveIntensity !== undefined) e.mat.emissiveIntensity = e.orig * f;
      }
    }
    if (blackout.level) { // v2.2: level.js plaza-circuit handles (see collect)
      for (const e of blackout.level.mats) {
        if (e.mat && e.mat.emissiveIntensity !== undefined) e.mat.emissiveIntensity = e.orig * f;
      }
      for (const e of blackout.level.sprites) {
        if (e.mat && e.mat.opacity !== undefined) e.mat.opacity = e.orig * f;
      }
      if (blackout.level.pool) blackout.level.pool.mat.opacity = blackout.level.pool.orig * f;
    }
    if (decor.glowMesh) {
      for (const i of blackout.plazaGlowIdx) {
        _c.copy(decor.glowMeta[i].baseColor).multiplyScalar(f);
        decor.glowMesh.setColorAt(i, _c);
      }
      decor.glowMesh.instanceColor.needsUpdate = true;
    }
    if (decor.discMesh) {
      for (const i of blackout.plazaDiscIdx) {
        _c.copy(decor.discMeta[i].baseColor).multiplyScalar(f);
        decor.discMesh.setColorAt(i, _c);
      }
      decor.discMesh.instanceColor.needsUpdate = true;
    }
    for (const i of blackout.plazaConeIdx) {
      const c = decor.cones[i];
      c.mat.uniforms.uOpacity.value = c.baseOpacity * f;
    }
  }

  function tickBlackout(dt) {
    if (blackout.phase === "idle" || blackout.phase === "done") return;
    blackout.t += dt;
    if (blackout.phase === "fading") {
      const f = Math.max(0, 1 - blackout.t / blackout.fadeS);
      applyBlackoutDim(f);
      if (blackout.t >= blackout.fadeS) { blackout.phase = "dark"; blackout.t = 0; }
    } else if (blackout.phase === "dark") {
      if (blackout.t >= blackout.darkS) {
        blackout.phase = "relight"; blackout.t = 0;
        if (blackout.spot) blackout.spot.color.copy(blackout.relightColor);
      }
    } else if (blackout.phase === "relight") {
      // Emergency circuit: ONLY the key light returns, at relightLevel,
      // cyan. Neon emissives stay dead (wave B pushes in the dark).
      const k = Math.min(1, blackout.t / blackout.relightS);
      if (blackout.spot) {
        blackout.spot.intensity = blackout.origIntensity * blackout.relightLevel * k;
      }
      if (blackout.t >= blackout.relightS) blackout.phase = "done";
    }
  }

  // ------------------------------------------------------- decoration build
  // One shared billboard-glow shader; per-instance color via instanceColor.
  function makeGlowMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vXY; varying vec3 vCol;
        void main() {
          vXY = position.xy * 2.0;
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(1.0);
          #endif
          vec4 c = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float size = length(vec3(instanceMatrix[0].x, instanceMatrix[0].y, instanceMatrix[0].z));
          vec4 mv = viewMatrix * modelMatrix * c;
          mv.xy += position.xy * size;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vXY; varying vec3 vCol;
        void main() {
          float d = length(vXY);
          // soft haze halo, hot pinprick core — reads as a lamp head in rain,
          // never a floating ball (S5 iteration-1 tell)
          float halo = exp(-d * d * 5.5) * 0.38;
          float core = exp(-d * d * 60.0) * 1.4;
          gl_FragColor = vec4(vCol * 1.7, (halo + core) * smoothstep(1.0, 0.7, d));
        }`,
    });
  }

  function makeDiscMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // LD §5.2: FAINT fog discs (0.10 stacked into the S4 wash).
      // 0.06 -> 0.036 (LaneC/iter05): the disc is the second half of the
      // "round blob" tell — it is a hard-coded CIRCLE, so however faint it is
      // it argues against the elongated reflection now doing the real work in
      // level.js's wet-specular layer. It stays because glare through falling
      // rain genuinely is round; it just no longer out-votes the reflection.
      uniforms: { uOp: { value: 0.036 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vCol;
        void main() {
          vUv = uv * 2.0 - 1.0;
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOp; varying vec2 vUv; varying vec3 vCol;
        void main() {
          float d = length(vUv);
          float a = uOp * exp(-d * d * 3.4) * smoothstep(1.0, 0.55, d);
          gl_FragColor = vec4(vCol, a);
        }`,
    });
  }

  // W4 (iter04) NaN GUARD — THE BLACK RECTANGLE, root-caused this session.
  // GLSL leaves pow(x, y) UNDEFINED at x == 0 with a fractional y, and
  // ANGLE/D3D11 (the capture path, and every Chrome-on-Windows player)
  // returns a non-finite value there. CylinderGeometry's side UVs are EXACTLY
  // 0.0 along the bottom ring, so the shaft gradient's pow(vUv.y, 1.6)
  // poisoned the alpha of that whole edge; the additive blend wrote the poison
  // into the HDR target and the bloom mip chain smeared it into a hard,
  // AXIS-ALIGNED BLACK RECTANGLE (the separable blur's support region) that ate
  // 30-55% of iter04 S1/S3/S6/S9 and blanked the S8 hero beam. It was NOT the
  // viewmodel: an ID probe named arms_L_warden, but hide-one-child bisection on
  // the real post-processed capture named scene.children[27], the L_QUAY god-ray
  // cone at (-30, 3.25, 47). Measured on the S3 pose, 640x360 capture, mean
  // luma of the affected box (frame full mean in brackets):
  //   raw shader .................. 7.12  [7.10]
  //   that one cone hidden ........ 84.02 [59.92]
  //   all cone cards hidden ....... 84.06 [59.81]
  //   constant alpha, no math ..... 88.18 [60.98]
  //   guard the facing pow only ... 7.15  [7.11]  still broken
  //   guard the grad pow only ..... 86.37 [60.54]  FIXED — this term is it
  //   guard both (shipped) ........ 86.00 [60.46]
  // Both pow bases are clamped: the facing term's base is exactly 0 on the
  // silhouette ring for the same reason, it simply was not the term that fired
  // here. 1e-4 ^ 1.5 = 1e-6, so the clamp is visually a no-op.
  // KEEP THE COMMENTARY OUT OF THE TEMPLATE LITERAL — a backtick inside the
  // shader string terminates it and the module dies with "Unexpected identifier".
  const coneMatProto = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.13 },
      uFlick: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
      void main() {
        vUv = uv;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; uniform float uFlick;
      varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
      void main() {
        vec3 V = normalize(cameraPosition - vPosW);
        // silhouette-edge fade (avoid edge-on billboard reveal, LD 3.5).
        // pow bases clamped away from 0 — see the NaN-guard note above main().
        vec3 N = vNormalW; float nl = length(N);
        N = nl > 1e-5 ? N / nl : vec3(0.0, 1.0, 0.0);
        float facing = pow(max(1e-4, abs(dot(N, V))), 1.5);
        // bright at the source (uv.y=1 is the cylinder top = the lamp)
        float grad = 0.18 + 0.82 * pow(max(vUv.y, 1e-4), 1.6);
        // fade the shaft when the camera is inside/near it (<2 m)
        float nf = smoothstep(0.9, 2.2, distance(cameraPosition, vPosW));
        float a = uOpacity * uFlick * facing * grad * nf;
        gl_FragColor = vec4(uColor, a);
      }`,
  });

  // ------------------------------------------- sourceless-reflection retirement
  // iter05 ranked defect #1 ("a magenta light column with no emitter dominates
  // the lower-centre of every C1 frame"), diagnosed by live bisect rather than
  // by reading the code: at the C1_06 camera pose the magenta-signature pixel
  // fraction was 1.963%; zeroing ONE wet-specular reflection slot took it to
  // 0.121% (-94%), while zeroing all twelve only reached 0.074%. The slot was
  // uLPos[2] = (-5, 9, 0) reach 26 — L_PLAZA_KEY — carrying uLCol (0.251,
  // 0.116, 0.304), i.e. the club sign's raw violet #c86ee0.
  //
  // THIS MODULE ALREADY OWNS THE RULE THE REFLECTION BREAKS. kind
  // 'neon_bounce' is an ABSTRACT AGGREGATE: one 85 deg spot from 9 m standing
  // in for the whole signage wall bouncing off wet stone. It has NO physical
  // fixture, which is exactly why the head-glow pass below excludes it ("a head
  // glow there reads as a floating ball") and why its spot and its fog disc are
  // both re-tinted through bounceColor() instead of using p.color. A mirror
  // image is a stronger emitter claim than a head glow: level.js's wet-specular
  // sheet was drawing the streak, halo and lamp-image of a lamp that does not
  // exist, in the one hue the aggregate is explicitly forbidden to wear. Every
  // bright pixel must trace to a source (VT D1); this one traced to nothing.
  //
  // Fix at the rule, not at the pixel: a pole is REFLECTABLE iff a viewer could
  // see the fixture whose mirror image the reflection would be. Abstract
  // aggregates are not, so their reflection slots are retired here — parked
  // exactly the way the sheet parks an unused slot (y -500, reach 1, black), so
  // the shader's `dl > LP.w` guard drops them on the first branch. Matching is
  // by kind + world position and the pass no-ops when nothing matches, so it
  // stays correct if the sheet is rebuilt, renamed, or fixed at its own end.
  //
  // The five neon SIGNS keep their reflections: they are lit cabinets bolted to
  // a wall the player can see, which is what makes those streaks motivated.
  const ABSTRACT_AGGREGATE = { neon_bounce: 1 };
  const hasFixture = (p) => !!p && !ABSTRACT_AGGREGATE[p.kind];

  function retireSourcelessReflections(poles) {
    const ghosts = (poles || []).filter((p) => !hasFixture(p) && Array.isArray(p.pos));
    if (!ghosts.length) return;
    let retired = 0;
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        const u = m && m.uniforms;
        if (!u || !u.uLPos || !u.uLCol) continue;
        const P = u.uLPos.value, C = u.uLCol.value;
        if (!Array.isArray(P) || !Array.isArray(C)) continue;
        for (let i = 0; i < P.length && i < C.length; i++) {
          const near = ghosts.some((g) =>
            Math.abs(P[i].x - g.pos[0]) < 0.25 &&
            Math.abs(P[i].y - g.pos[1]) < 0.25 &&
            Math.abs(P[i].z - g.pos[2]) < 0.25);
          if (!near) continue;
          P[i].set(0, -500, 0, 1);
          C[i].setRGB(0, 0, 0);
          retired++;
        }
      }
    });
    if (retired) {
      console.info(`[lights] retired ${retired} sourceless reflection slot(s) — ` +
        `abstract aggregates (${ghosts.map((g) => g.id).join(", ")}) have no fixture to mirror`);
    }
  }

  function buildDecor(poles) {
    if (decor.built) return;
    decor.built = true;

    // --- god-ray cones: exactly the godRay:true poles (5 per LD §3.5)
    const rays = poles.filter((p) => p.godRay);
    for (const p of rays) {
      const from = new THREE.Vector3().fromArray(p.pos);
      const to = new THREE.Vector3().fromArray(p.aim || [p.pos[0], 0, p.pos[2]]);
      const h = from.distanceTo(to);
      const halfAngle = ((p.cone || 45) * Math.PI) / 360;
      const rBottom = Math.tan(halfAngle) * h * 0.85;
      const geo = new THREE.CylinderGeometry(Math.max(0.12, rBottom * 0.12), rBottom, h, 20, 1, true);
      const mat = coneMatProto.clone();
      mat.uniforms.uColor.value = new THREE.Color(p.color);
      mat.uniforms.uOpacity.value = CONE_OPACITY[p.kind] ?? CONE_OPACITY.default;
      mat.uniforms.uFlick.value = 1.0;
      const mesh = new THREE.Mesh(geo, mat);
      const axis = to.clone().sub(from).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().negate());
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.renderOrder = 10;
      mesh.frustumCulled = false;
      if (mesh.layers) mesh.layers.enable(3); // visible in the planar reflection
      scene.add(mesh);
      decor.cones.push({
        mesh, mat,
        baseOpacity: mat.uniforms.uOpacity.value,
        phase: Math.abs(p.pos[0] * 7.13 + p.pos[2] * 3.7) % 6.28,
        plaza: false,
      });
    }

    // --- head glows: every pole with a PHYSICAL fixture (real + fake + neon
    // signs). kind 'neon_bounce' (L_PLAZA_KEY) is an ABSTRACT aggregate light
    // standing in for the signage sum — a head glow there reads as a floating
    // ball (caught in the S1-pose review); it gets pool + spot only.
    {
      const glowPoles = poles.filter((p) => p.kind !== "neon_bounce");
      const geo = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.InstancedMesh(geo, makeGlowMaterial(), glowPoles.length);
      mesh.frustumCulled = false;
      mesh.renderOrder = 11;
      const m4 = new THREE.Matrix4();
      glowPoles.forEach((p, i) => {
        const size =
          p.kind === "neon" ? 0.85 :
          p.kind === "flood" ? 0.75 :
          p.kind === "neon_bounce" ? 1.0 :
          p.kind === "fluorescent" ? 0.7 :
          p.kind === "interior" ? 0.45 : 0.6;
        m4.makeScale(size, size, size).setPosition(p.pos[0], p.pos[1], p.pos[2]);
        mesh.setMatrixAt(i, m4);
        const col = new THREE.Color(p.color);
        mesh.setColorAt(i, col);
        const plaza = p.id === "L_PLAZA_KEY" || p.kind === "neon";
        decor.glowMeta.push({
          baseColor: col.clone(), plaza,
          flicker: !!p.flicker, phase: (i * 1.7) % 6.28,
        });
        if (plaza) blackout.plazaGlowIdx.push(i);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (mesh.layers) mesh.layers.enable(3);
      scene.add(mesh);
      decor.glowMesh = mesh;
    }

    // --- sodium fog-disc pools (LD §5.2) + the plaza key pool
    {
      const discs = poles.filter((p) => p.kind === "sodium" || p.kind === "neon_bounce");
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, makeDiscMaterial(), discs.length);
      mesh.frustumCulled = false;
      mesh.renderOrder = 9;
      const m4 = new THREE.Matrix4();
      discs.forEach((p, i) => {
        const r = p.kind === "neon_bounce" ? 4.2 : 2.5;
        m4.makeScale(r, 1, r).setPosition(p.pos[0], 0.07, p.pos[2]);
        mesh.setMatrixAt(i, m4);
        // the plaza aggregate's disc must carry the SAME conditioned tint as
        // its spot — a violet 5.5 m additive disc is the same magenta film
        const col = p.kind === "neon_bounce"
          ? bounceColor().clone()
          : new THREE.Color(p.color);
        mesh.setColorAt(i, col);
        const plaza = p.id === "L_PLAZA_KEY";
        decor.discMeta.push({ baseColor: col.clone(), plaza, phase: (i * 2.3) % 6.28 });
        if (plaza) blackout.plazaDiscIdx.push(i);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      decor.discMesh = mesh;
    }
  }

  // ---------------------------------------------------------------- binds
  function bindOne(spot, spec) {
    // If level.js emits minimal {kind:'spot', pos, color, intensity, distance}
    // specs, backfill aim/cone/blackout/practical-kind from the SAME single
    // source (layout.lightPoles) by id so zone contrast never degrades.
    if (spec.id && ctx.layout && Array.isArray(ctx.layout.lightPoles)) {
      const pole = ctx.layout.lightPoles.find((p) => p.id === spec.id);
      if (pole) {
        spec = {
          ...pole, ...spec,
          kind: KIND_DEFAULTS[spec.kind] ? spec.kind : pole.kind,
          aim: spec.aim || pole.aim,
          cone: spec.cone ?? pole.cone,
          blackout: spec.blackout || pole.blackout,
        };
      }
    }
    const d = KIND_DEFAULTS[spec.kind] || KIND_DEFAULTS.default;
    spot.position.fromArray(spec.pos);
    spot.target.position.fromArray(spec.aim || [spec.pos[0], 0, spec.pos[2]]);
    spot.color.set(spec.color || "#ffffff");
    spot.intensity = spec.intensity ?? d.intensity;
    spot.distance = spec.distance ?? d.distance;
    spot.angle = ((spec.cone ?? 50) * Math.PI) / 360; // cone = FULL angle
    spot.penumbra = spec.penumbra ?? d.penumbra;
    spot.decay = spec.decay ?? d.decay;
    if (spec.kind === "neon_bounce") {
      // aggregate, not a sign: warm-neutral sum of the wall (see above), and
      // intensity CAPPED — level.js asks 130, which from 9 m through an 85 deg
      // cone is a wash across the whole plaza, not a pool. The cap keeps the
      // plaza the brightest zone (LD §3.4 = 100%) while leaving the moon/hemi
      // cool visible in the cobble shadows, which is the warm/cool contrast.
      spot.color.copy(bounceColor());
      spot.intensity = Math.min(spot.intensity, d.intensity);
    }
    if (spec.id) byId[spec.id] = { spot, spec };
  }

  function bindStatic(specs) {
    // level.js (A3 wave 2) emits staticLightSpecs from layout.lightPoles.
    // Until it lands (wave-1 stub emits []), fall back to the SAME single
    // source directly — layout.lightPoles real:true (A3 flag: "do not source
    // practical placements from anywhere else").
    let list = Array.isArray(specs) ? specs.filter((s) => s && (s.kind === "spot" || s.real)) : [];
    if (!list.length && ctx.layout && Array.isArray(ctx.layout.lightPoles)) {
      list = ctx.layout.lightPoles.filter((p) => p.real);
      console.info("[lights] staticLightSpecs empty — bound from layout.lightPoles (single source), " +
        list.length + " practicals");
    }
    if (list.length > SPOT_COUNT) {
      console.warn(`[lights] ${list.length} static specs for ${SPOT_COUNT} spot slots — extra IGNORED (fixed pool, R3)`);
      list = list.slice(0, SPOT_COUNT);
    }
    list.forEach((spec, i) => bindOne(spots[i], spec));

    const poles = (ctx.layout && ctx.layout.lightPoles) || list;
    buildDecor(poles);
    // after the level sheet exists (boot builds the level before createLights)
    retireSourcelessReflections(poles);

    const ratio = api.keyAmbientRatio();
    console.log(`[lights] pool 1 dir + 1 hemi + ${SPOT_COUNT} spot + ${POINT_COUNT} point; ` +
      `${list.length} practicals bound; key:ambient ${ratio.toFixed(1)}:1 (>=4 required, VT §1)`);
  }

  // ---------------------------------------------------------------- leases
  function lease(kind) {
    if (kind !== "point") return null; // all 8 spots are static practicals
    for (let i = 0; i < POINT_COUNT; i++) {
      if (!pointBusy[i]) {
        pointBusy[i] = true;
        const p = points[i];
        return {
          light: p,
          set(pos, color, intensity, distance) {
            if (pos) { pos.isVector3 ? p.position.copy(pos) : p.position.fromArray(pos); }
            if (color !== undefined && color !== null) p.color.set(color);
            if (intensity !== undefined) p.intensity = intensity;
            if (distance !== undefined) p.distance = distance;
          },
          release() {
            pointBusy[i] = false;
            p.intensity = 0;
            p.position.set(0, -50 - i, 0);
          },
        };
      }
    }
    return null;
  }

  function dynamicFree() {
    let n = 0;
    for (let i = 0; i < POINT_COUNT; i++) if (!pointBusy[i]) n++;
    return n;
  }

  // ------------------------------------------------------------------ tick
  // boot has no lights.update seam — weather.update (A6-owned, called every
  // frame by boot) drives this via ctx.lights._tick(dt).
  let t = 0;
  let setpieceHooked = false;

  function _tick(dt) {
    t += dt;

    // set-piece drains: live once A0 adopts sim.mission / exposes mission
    const sim = ctx.sim && ctx.sim();
    const mis = sim && sim.mission;
    if (mis && typeof mis.drainSetPieces === "function") {
      const sps = mis.drainSetPieces();
      if (sps && sps.length) {
        for (const sp of sps) if (sp && sp.id === "transformer_blackout") startBlackout();
      }
    }
    // bridge path (post-amendment): re-register lazily, clear()-proof
    if (!setpieceHooked && ctx.bridge && typeof ctx.bridge.register === "function") {
      try {
        ctx.bridge.register("setpiece", (d) => {
          if (d && d.id === "transformer_blackout") startBlackout();
        });
        setpieceHooked = true;
      } catch (e) { setpieceHooked = true; }
    }

    tickBlackout(dt);

    // god-ray density flicker ±5% (LD §3.5)
    for (const c of decor.cones) {
      c.mat.uniforms.uFlick.value = 1.0 + 0.05 * Math.sin(t * 2.1 + c.phase) * Math.sin(t * 5.7 + c.phase * 1.3);
    }

    // platform fluorescent flicker (layout flicker:true)
    if (decor.glowMesh) {
      let dirty = false;
      for (let i = 0; i < decor.glowMeta.length; i++) {
        const g = decor.glowMeta[i];
        if (!g.flicker) continue;
        const on = Math.sin(t * 13.0 + g.phase) + Math.sin(t * 31.7) > -0.85 ? 1.0 : 0.25;
        _c.copy(g.baseColor).multiplyScalar(on);
        decor.glowMesh.setColorAt(i, _c);
        dirty = true;
      }
      if (dirty) decor.glowMesh.instanceColor.needsUpdate = true;
    }
  }

  const api = {
    bindStatic,
    lease,
    dynamicFree,
    moon,
    hemi,
    // ---- private additions (allowed by the freeze) ----
    _tick,
    setPiece(id) { if (id === "transformer_blackout") startBlackout(); },
    blackoutPhase() { return blackout.phase; },
    byId,
    spots,
    points,
    keyAmbientRatio() {
      // VT §1 probe intent: white card facing the key vs facing away. This has
      // to be measured in LUMINANCE — the old raw-intensity form ignored each
      // light's colour and reported 5.9:1 on a pool that was really 57.6:1,
      // which is how iter03 shipped featureless black facades through a gate
      // whose whole job was to catch exactly that.
      const key = moon.intensity * lumOf(moon.color);
      // a vertical facade — the surface the tell actually appears on — sees the
      // 50/50 sky/ground hemisphere mix.
      const amb = hemi.intensity
        * 0.5 * (lumOf(hemi.color) + lumOf(hemi.groundColor));
      // card facing the key sees key+ambient; facing away sees ambient alone.
      return (key + amb) / Math.max(1e-6, amb);
    },
  };

  ctx.lights = api; // A6-internal seam: weather.update drives _tick
  return api;
}
