// core/render/weather.js [A6] — atmosphere + rain per LD §5.2/§5.3 and
// VT §4. BOOT SEAM (A0, changelog v2.1b): createWeather(ctx) export name is
// frozen; boot constructs it and calls update(dt) every frame; prewarmables()
// feeds the prewarm extras list.
//
// 1. HEIGHT FOG (LD §5.2) — global THREE.ShaderChunk fog override + scene
//    FogExp2, so EVERY material with fog:true (all of A3's, A8's bodies, the
//    sky rings) gets analytic exp height fog with aerial perspective (VT §4:
//    distant geometry loses contrast and saturates toward sky) at zero
//    per-material wiring. Constants: density 0.010/m (the FogExp2 uniform),
//    height falloff 0.06/m, start 18 m, reference height 1.5 m (eye level —
//    LD's own transmittance arithmetic e^-0.78 ≈ 0.46 at 78 m ignores height
//    attenuation, so the falloff is referenced to eye height to honour the
//    FROZEN ≈0.46 check; driftwake's subtractive fogStart would give 0.55
//    and is deliberately not used — documented deviation from the driftwake
//    convention, not from LD's numbers). Fog colour #232a3a warmed toward
//    #2e2a26 looking S/SE (sodium skyglow) + brightened toward the moon
//    azimuth (cheap in-scatter).
// 2. RAIN STREAKS — 2,800 instanced quads (quality-scaled via settings
//    QUALITY_PRESETS), GPU-wrapped in a camera-following 24×16×24 m box,
//    velocity 9–13 m/s down + 1.2 m/s west shear, stretched 0.4–0.7 m along
//    velocity, NormalBlending low opacity, per-instance brightness boost near
//    the 8 practicals (computed per-frame in the vertex shader — same visual
//    as LD's compute-on-spawn, cheaper than CPU respawn bookkeeping).
// 3. INDOOR OCCLUSION — 4 AABBs (arcade both floors, gallery, gatehouse,
//    platform canopy; extents from A3's wave-1 hints). Box check in-shader:
//    an occluded instance collapses to zero area (no fragments render inside
//    — the LD probe is a screenshot/render test).
// 4. SPLASHES — 220 ring sprites cycling on ground points within 12 m,
//    biased ~3:1 toward puddle masks + drip bases, 0.25 s life.
// 5. DRIP COLUMNS — 6 emitters (arcade skylight hole, gallery leaks ×2,
//    plaza awning edges ×3).
// 6. DUST MOTES (VT §4) — ~200-point slow drift near the camera, additive.
//
// Determinism (R21): all motion derives from an internal phase clock;
// freeze(on)/setPhase(t)/reset(seed) are exposed for A11's scenarios.
// Also drives ctx.lights._tick(dt) (blackout timeline + god-ray flicker) —
// boot has no lighting update seam and weather is constructed after lights.

import * as THREE from "three";
import { mulberry32 } from "../rng.js";          // pure fn — dual-instance safe
import { QUALITY_PRESETS } from "../settings.js"; // const table — dual-instance safe

// ---------------------------------------------------------------- fog maths
export const FOG = {
  density: 0.010,   // 1/m — the FogExp2 uniform (LD §5.2)
  falloff: 0.06,    // 1/m height falloff
  start: 18,        // m — near ramp (smoothstep 6→18, non-subtractive)
  refY: 1.5,        // m — falloff reference height (eye level; see header)
  // MUST track sky.js's uHorizon exactly: the fog is what distant geometry
  // fades INTO, so if the two drift the horizon shows a seam and aerial
  // perspective stops resolving to the sky. Lifted ×1.7 with the sky ramp
  // when lighting.js's key came up (see sky.js's note).
  color: 0x2e384d,
};

// JS mirror of the shader integral — probe-able (the frozen ≈0.46 check).
export function fogTransmittance(dist, camY = 1.7, targetY = 1.5) {
  const k = FOG.falloff;
  const h0 = Math.max(0, camY - FOG.refY);
  const h1 = Math.max(0, targetY - FOG.refY);
  const dh = h1 - h0;
  const att = Math.abs(dh) < 0.02
    ? Math.exp(-k * h0)
    : (Math.exp(-k * h0) - Math.exp(-k * h1)) / (k * dh);
  return Math.exp(-FOG.density * att * dist);
}

// ------------------------------------------------- analytic light in-scatter
// lane_env (2026-11-13). The practicals lit SURFACES but not the AIR: in the
// before captures (_shots/lane_env/before_long.png) a sodium lamp in driving
// rain is a hard orange box with a pool under it and nothing around it — the
// single strongest "this is a game, not a photograph" cue in a night-rain
// frame. Real rain-laden air scatters a lamp into a halo and a visible cone.
//
// This integrates single scattering from every light ALREADY in the fixed pool
// along the eye ray, in closed form, inside the shared fog chunk:
//     ∫0..D dt / ((t - b)^2 + h^2) = ( atan((D - b)/h) + atan(b/h) ) / h
// (b = projection of the light on the ray, h = its distance from the ray,
// D = the depth of the fragment the ray hits — so a lamp BEHIND a wall does
// not glow over that wall). The spot cone is evaluated at the ray's closest
// point to the light, which turns the same integral into a visible SHAFT under
// a lamp, with a small floor so the fixture itself keeps a halo. The three
// dynamic point slots (muzzle grants + explosion) run through the same
// integral, so a muzzle flash lights the rain-filled air and a blast glows
// in its own smoke instead of only on the walls.
//
// DOCTRINE: no light is created, no count changes, no new program. The chunk
// reads three's own spotLights[] / pointLights[] uniforms (view space), so it
// only compiles into materials that HAVE lights — guarded by RE_Direct, which
// three defines exactly in the lit material families. Unlit / basic / sprite
// materials compile byte-identical to before this edit. The scale rides
// fogDensity, so scene.fog.density (dev tools, a future quality knob) moves
// the in-scatter with the fog it physically belongs to.
// COST (measured, 1280x720 med, EXT_disjoint_timer_query_webgl2, interleaved
// in-page A/B by recompiling every material with and without this block): see
// the lane_env report; the unrolled form below is the one that shipped.
const INSCATTER_GLSL = /* glsl */ `
  #if defined( RE_Direct ) && ( NUM_SPOT_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 )
    {
      vec3 brVP = - vViewPosition;
      float brLen = length( brVP );
      vec3 brDir = brVP / max( brLen, 1e-4 );
      vec3 brIns = vec3( 0.0 );
      // UNROLLED (three's unroll_loop pragma): constant uniform indices, and
      // no continue/break, so the compiler can schedule every light freely.
      // Measured: the rolled loop with continue cost 0.41-0.43 ms at 1280x720.
      #if NUM_SPOT_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
        {
          vec3 brL = spotLights[ i ].position;
          float brB = dot( brL, brDir );
          float brH2 = max( dot( brL, brL ) - brB * brB, 0.0625 );
          // past 10 m from the ray the term is < 0.005 linear: skip (spatially
          // coherent, so warps take one side; faded 10 -> 7 m, no seam). A
          // parked / blacked-out practical (colour 0) skips on the same test.
          if ( brH2 < 100.0 && dot( spotLights[ i ].color, vec3( 1.0 ) ) > 1e-3 ) {
            float brH = sqrt( brH2 );
            float brI = ( atan( ( brLen - brB ) / brH ) + atan( brB / brH ) ) / brH;
            vec3 brQ = brDir * clamp( brB, 0.0, brLen );
            float brC = dot( normalize( brL - brQ ), spotLights[ i ].direction );
            float brCone = smoothstep( spotLights[ i ].coneCos, spotLights[ i ].penumbraCos, brC );
            // shaft (cone-gated, slow falloff) + halo (round, tight, cone-free:
            // the fixture's own glare in wet air)
            brIns += spotLights[ i ].color * ( brI * ( ( 0.10 + 0.90 * brCone ) * exp( - 0.14 * brH ) + 0.45 * exp( - 0.9 * brH ) ) * smoothstep( 10.0, 7.0, brH ) );
          }
        }
      }
      #pragma unroll_loop_end
      #endif
      #if NUM_POINT_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
        {
          // the three dynamic slots are parked at intensity 0 almost all the
          // time — uniform branch, so they cost nothing until a flash fires
          if ( dot( pointLights[ i ].color, vec3( 1.0 ) ) > 1e-3 ) {
            vec3 brL = pointLights[ i ].position;
            float brB = dot( brL, brDir );
            // h floored at 1 m: a muzzle grant sits ~0.6 m from the eye, and an
            // unfloored 1/h would white out the frame for its 110 ms
            float brH = sqrt( max( dot( brL, brL ) - brB * brB, 1.0 ) );
            float brI = ( atan( ( brLen - brB ) / brH ) + atan( brB / brH ) ) / brH;
            brIns += pointLights[ i ].color * ( brI * 0.55 * exp( - 0.10 * brH ) );
          }
        }
      }
      #pragma unroll_loop_end
      #endif
      gl_FragColor.rgb += brIns * ( fogDensity * ${(0.24).toFixed(3)} );
    }
  #endif`;

function installHeightFog(THREE_, scene, withInscatter = true) {
  scene.fog = new THREE.FogExp2(FOG.color, FOG.density);

  THREE_.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vBRFogWorld;
#endif`;

  // World position from mvPosition — the ONE variable every fog_vertex call
  // site has in scope (SpriteMaterial has no `transformed`; instanced and
  // skinned paths are already folded into mvPosition). inverse(viewMatrix)
  // is a uniform-valued expression — GLSL ES 3.00, WebGL2-gated.
  THREE_.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vBRFogWorld = ( inverse( viewMatrix ) * mvPosition ).xyz;
#endif`;

  THREE_.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vBRFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;

  // Meridian Ward height fog (LD §5.2). Constants baked into the chunk so no
  // per-material uniform injection is needed; fogDensity rides the FogExp2
  // uniform so quality/dev tools can still tune density live via scene.fog.
  THREE_.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    {
      float brD = length( vBRFogWorld - cameraPosition );
      const float brK = ${FOG.falloff.toFixed(4)};
      const float brRef = ${FOG.refY.toFixed(2)};
      float brH0 = max( 0.0, cameraPosition.y - brRef );
      float brH1 = max( 0.0, vBRFogWorld.y - brRef );
      float brDh = brH1 - brH0;
      float brAtt = ( abs( brDh ) < 0.02 )
        ? exp( - brK * brH0 )
        : ( exp( - brK * brH0 ) - exp( - brK * brH1 ) ) / ( brK * brDh );
      float brT = exp( - fogDensity * brAtt * brD );
      float brFog = ( 1.0 - brT ) * smoothstep( 6.0, ${FOG.start.toFixed(1)}, brD );
      vec3 brHV = normalize( vec3( vBRFogWorld.x - cameraPosition.x, 0.0, vBRFogWorld.z - cameraPosition.z ) + vec3( 1e-5 ) );
      // sodium skyglow warm toward S/SE (linear #2e2a26)
      float brWarm = smoothstep( 0.25, 0.9, dot( brHV, normalize( vec3( 0.45, 0.0, 0.89 ) ) ) );
      vec3 brFogCol = mix( fogColor, vec3( 0.0464, 0.0393, 0.0318 ), brWarm * 0.55 );
      // cheap in-scatter toward the moon azimuth (NW)
      float brNW = pow( max( dot( brHV, vec3( -0.766, 0.0, -0.643 ) ), 0.0 ), 2.0 );
      brFogCol *= 1.0 + 0.18 * brNW;
      gl_FragColor.rgb = mix( gl_FragColor.rgb, brFogCol, brFog );
    }
    ${withInscatter ? INSCATTER_GLSL : ""}
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif`;
}

// ------------------------------------------------------- occlusion volumes
// From A3's wave-1 handoff (rain must NOT fall indoors — LD §5.3).
const OCCL = [
  { min: [-41, 0, -20], max: [-25, 8.6, 6] },   // arcade shell, both floors
  { min: [15.5, 0, -34], max: [24.5, 7.0, 14] }, // storm gallery
  { min: [5, 0, -55], max: [11, 4.0, -50] },     // gatehouse
  { min: [30, 0, -52], max: [44, 8.2, -48] },    // platform canopy
];

const inOccl = (x, y, z) => {
  for (const b of OCCL) {
    if (x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] &&
        y > b.min[1] && y < b.max[1]) return true;
  }
  return false;
};

// Drip emitters (LD §5.3: gallery leaks ×2, arcade skylight ×1, awning
// edges ×3). Arcade skylight hole x[-35,-29] z[-11,-5] per A3's note — the
// drip column IS the rain through the hole.
const DRIPS = [
  { top: [-32, 7.2, -8], fall: 7.2 },
  { top: [19, 6.0, -12], fall: 6.0 },
  { top: [22.5, 6.0, 2], fall: 6.0 },
  { top: [-12, 2.7, 7], fall: 2.7 },
  { top: [6, 2.7, 13], fall: 2.7 },
  { top: [-2, 2.7, -6], fall: 2.7 },
];

const RAIN_MAX = 2800;
const SPLASH_MAX = 220;
const MOTE_COUNT = 200;
const BOX = [24, 16, 24]; // camera-following rain box (LD §5.3)

export function createWeather(ctx) {
  const { scene, camera } = ctx;
  // In-scatter is a BOOT-TIME choice (it lives in the shared fog chunk, and
  // every program is compiled + prewarmed at boot): measured 0.2-0.45 ms at
  // 1280x720 on med, so the 'low' preset — whose whole contract is "tonemap
  // only, no film stages" — boots without it. Switching preset live keeps the
  // boot choice until the next load (same as the planar-reflection RT).
  const inscatter = (ctx.settings && ctx.settings.quality) !== "low";
  installHeightFog(THREE, scene, inscatter);
  scene.userData.brInscatter = inscatter; // sky.js reads this for its shell

  // The frozen LD §5.2 readability check, computed from the shipped formula:
  const t78 = fogTransmittance(78, 1.7, 1.5);
  console.log(`[weather] fog T(78 m, street) = ${t78.toFixed(3)} (LD §5.2 target ≈0.46)`);

  const group = new THREE.Group();
  group.name = "weather";
  scene.add(group);

  let rng = mulberry32(20260819);

  // ------------------------------------------------------------- practicals
  // vertex-shader brightness boost sources (the 8 real key spots).
  const practPos = [];
  const practCol = [];
  {
    const poles = ((ctx.layout && ctx.layout.lightPoles) || []).filter((p) => p.real);
    for (let i = 0; i < 8; i++) {
      const p = poles[i];
      if (p) {
        practPos.push(new THREE.Vector4(p.pos[0], p.pos[1], p.pos[2], p.kind === "flood" || p.kind === "neon_bounce" ? 1.4 : 1.0));
        practCol.push(new THREE.Color(p.color));
      } else {
        practPos.push(new THREE.Vector4(0, -100, 0, 0));
        practCol.push(new THREE.Color(0, 0, 0));
      }
    }
  }

  const occlBoxA = OCCL.map((b) => new THREE.Vector4(b.min[0], b.min[2], b.max[0], b.max[2]));
  const occlBoxY = OCCL.map((b) => new THREE.Vector2(b.min[1], b.max[1]));

  const shared = {
    uTime: { value: 0 },
    uBoxMin: { value: new THREE.Vector3() },
    uBoxSize: { value: new THREE.Vector3(BOX[0], BOX[1], BOX[2]) },
  };

  // ------------------------------------------------------------ rain streaks
  function buildRain() {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;

    const seed = new Float32Array(RAIN_MAX * 3);
    const vel = new Float32Array(RAIN_MAX * 3);
    const len = new Float32Array(RAIN_MAX);
    for (let i = 0; i < RAIN_MAX; i++) {
      seed[i * 3] = rng(); seed[i * 3 + 1] = rng(); seed[i * 3 + 2] = rng();
      vel[i * 3] = -1.2;                        // west wind shear (LD §5.3)
      vel[i * 3 + 1] = -(9 + rng() * 4);        // 9–13 m/s down
      vel[i * 3 + 2] = (rng() - 0.5) * 0.4;
      len[i] = 0.4 + rng() * 0.3;
    }
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 3));
    geo.setAttribute("aVel", new THREE.InstancedBufferAttribute(vel, 3));
    geo.setAttribute("aLen", new THREE.InstancedBufferAttribute(len, 1));
    geo.instanceCount = RAIN_MAX;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...shared,
        uOccl: { value: occlBoxA },
        uOcclY: { value: occlBoxY },
        uPract: { value: practPos },
        uPractCol: { value: practCol },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed; attribute vec3 aVel; attribute float aLen;
        uniform float uTime; uniform vec3 uBoxMin; uniform vec3 uBoxSize;
        uniform vec4 uOccl[4]; uniform vec2 uOcclY[4];
        uniform vec4 uPract[8]; uniform vec3 uPractCol[8];
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vUv = uv;
          vec3 p = uBoxMin + mod(aSeed * uBoxSize + aVel * uTime, uBoxSize);
          float kill = 0.0;
          for (int i = 0; i < 4; i++) {
            vec4 b = uOccl[i]; vec2 yr = uOcclY[i];
            if (p.x > b.x && p.x < b.z && p.z > b.y && p.z < b.w &&
                p.y > yr.x && p.y < yr.y) kill = 1.0;
          }
          vec3 boost = vec3(0.0);
          for (int i = 0; i < 8; i++) {
            vec4 pr = uPract[i];
            float d2 = dot(p - pr.xyz, p - pr.xyz);
            boost += uPractCol[i] * (pr.w / (1.0 + d2 * 0.09));
          }
          vCol = vec4(vec3(0.045, 0.050, 0.062) + boost * 0.065, 0.30);
          vec3 dir = normalize(aVel);
          vec3 side = normalize(cross(dir, cameraPosition - p) + vec3(1e-5));
          vec3 vert = p + dir * (uv.y - 0.5) * aLen + side * (uv.x - 0.5) * 0.028;
          vert = mix(vert, p, kill); // occluded → zero-area, no fragments
          gl_Position = projectionMatrix * viewMatrix * vec4(vert, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          float a = vCol.a * sin(vUv.y * 3.14159) * (1.0 - abs(vUv.x - 0.5) * 1.2);
          gl_FragColor = vec4(vCol.rgb, a);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    group.add(mesh);
    return mesh;
  }
  const rain = buildRain();

  // --------------------------------------------------------------- splashes
  // CPU-cycled ring sprites; spawn ~3:1 biased toward puddles + drip bases.
  const splashBias = [];
  {
    const hp = (ctx.layout && ctx.layout.terrain && ctx.layout.terrain.heroPuddles) || [];
    for (const p of hp) splashBias.push([p.pos[0], p.pos[1], p.r]);
    for (const d of DRIPS) splashBias.push([d.top[0], d.top[2], 0.5]);
  }
  const groundY = (x, z) =>
    (ctx.colliders && ctx.colliders.groundY) ? ctx.colliders.groundY(x, z) : 0;

  let splash;
  const splashAge = new Float32Array(SPLASH_MAX);
  const splashLife = new Float32Array(SPLASH_MAX);
  function respawnSplash(i, posAttr) {
    let x, z, tries = 0;
    do {
      // lane_env: 0.75 -> 0.40 toward the authored puddles/drips. At 0.75 only
      // ~55 of 220 splashes ever landed near the PLAYER, so outside the hero
      // puddles the street at your feet showed no rain hitting it at all.
      // Near-camera ring tightened (1.2..9 m) — splashes are 10-20 cm events
      // and are invisible past ~10 m anyway.
      if (splashBias.length && rng() < 0.40) {
        const b = splashBias[(rng() * splashBias.length) | 0];
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * b[2];
        x = b[0] + Math.cos(a) * r; z = b[1] + Math.sin(a) * r;
      } else {
        const a = rng() * Math.PI * 2, r = 1.2 + Math.sqrt(rng()) * 7.8;
        x = camera.position.x + Math.cos(a) * r;
        z = camera.position.z + Math.sin(a) * r;
      }
      tries++;
    } while (inOccl(x, 0.5, z) && tries < 6);
    const y = groundY(x, z) + 0.015;
    posAttr.setXYZ(i, x, y, z);
    splashAge[i] = 0;
    splashLife[i] = 0.22 + rng() * 0.08; // ~0.25 s (LD §5.3)
  }

  function buildSplash() {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(SPLASH_MAX * 3), 3);
    const age = new THREE.InstancedBufferAttribute(new Float32Array(SPLASH_MAX), 1);
    pos.setUsage(THREE.DynamicDrawUsage);
    age.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPos", pos);
    geo.setAttribute("aAge", age);
    geo.instanceCount = SPLASH_MAX;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute float aAge;
        varying vec2 vUv; varying float vA;
        void main() {
          vUv = uv;
          // W2/iter02 S9: at 0.34 m the ring grew to ~0.7 m across and, held
          // in a paused beauty frame, read as a floating white marker ring on
          // the cobbles. A real rain crown is 10-20 cm and dies fast, so the
          // ring must be gone before it is big enough to be read as a shape.
          float r = mix(0.03, 0.17, aAge);
          vA = (1.0 - aAge) * (1.0 - aAge);
          vec3 vert = aPos + vec3(position.x * 2.0 * r, 0.0, position.z * 2.0 * r);
          gl_Position = projectionMatrix * viewMatrix * vec4(vert, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vA;
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float d = length(q);
          // thinner wall + a fraction of the old opacity: a wet-stone sheen
          // disturbance, not a drawn circle. 0.16 linear at alpha 0.5 sat ~8x
          // above the surrounding ground after AgX, which is what made it
          // read white rather than wet.
          float ring = smoothstep(0.70, 0.88, d) * smoothstep(1.0, 0.91, d);
          gl_FragColor = vec4(vec3(0.055, 0.060, 0.074), ring * vA * 0.17);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 19;
    group.add(mesh);
    for (let i = 0; i < SPLASH_MAX; i++) {
      respawnSplash(i, pos);
      splashAge[i] = rng() * splashLife[i]; // desync the first cycle
    }
    pos.needsUpdate = true;
    return mesh;
  }
  splash = buildSplash();

  // ------------------------------------------------------------ splash crowns
  // lane_env. The ring above is a FLAT disturbance; what the eye actually
  // catches of a raindrop hitting a wet street at night is the crown — a tiny
  // vertical jet of droplets that catches the light for ~0.1 s. Same instances
  // as the rings (the aPos/aAge attributes are SHARED objects, so the CPU
  // cycling above drives both and there is no second bookkeeping loop), drawn
  // as a camera-facing vertical streak in the first 45% of each splash's life.
  // One extra draw call; instance count follows the ring's.
  const crown = (() => {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    geo.setAttribute("aPos", splash.geometry.getAttribute("aPos"));
    geo.setAttribute("aAge", splash.geometry.getAttribute("aAge"));
    geo.instanceCount = splash.geometry.instanceCount;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uPract: { value: practPos }, uPractCol: { value: practCol } },
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute float aAge;
        uniform vec4 uPract[8]; uniform vec3 uPractCol[8];
        varying vec2 vUv; varying float vA; varying vec3 vCol;
        void main() {
          vUv = uv;
          float u = aAge / 0.45;
          // dead outside the crown phase, or too far to resolve (> 9 m)
          float far = distance(aPos, cameraPosition);
          if (u > 1.0 || far > 9.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float h = 0.075 * sin(u * 3.14159);
          vA = (1.0 - u) * smoothstep(9.0, 5.0, far);
          vec3 toCam = cameraPosition - aPos;
          vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + vec3(1e-5));
          vec3 vert = aPos + vec3(0.0, uv.y * h, 0.0) + side * (uv.x - 0.5) * (0.018 + 0.03 * u);
          // lit by the nearby practicals, like the rain streaks
          vec3 boost = vec3(0.0);
          for (int i = 0; i < 8; i++) {
            vec4 pr = uPract[i];
            float d2 = dot(aPos - pr.xyz, aPos - pr.xyz);
            boost += uPractCol[i] * (pr.w / (1.0 + d2 * 0.06));
          }
          vCol = vec3(0.07, 0.078, 0.095) + boost * 0.10;
          gl_Position = projectionMatrix * viewMatrix * vec4(vert, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vA; varying vec3 vCol;
        void main() {
          // a few droplets up the jet, not a solid bar
          float x = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float beads = 0.55 + 0.45 * sin(vUv.y * 18.0);
          float a = x * x * beads * (1.0 - vUv.y * 0.6) * vA * 0.55;
          gl_FragColor = vec4(vCol, a);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 19;
    group.add(mesh);
    return mesh;
  })();

  // ------------------------------------------------------------ drip columns
  function buildDrips() {
    const PER = 8;
    const n = DRIPS.length * PER;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    const top = new Float32Array(n * 3);
    const fall = new Float32Array(n);
    const off = new Float32Array(n);
    let k = 0;
    for (const d of DRIPS) {
      for (let j = 0; j < PER; j++, k++) {
        top[k * 3] = d.top[0] + (rng() - 0.5) * 0.35;
        top[k * 3 + 1] = d.top[1];
        top[k * 3 + 2] = d.top[2] + (rng() - 0.5) * 0.35;
        fall[k] = d.fall;
        off[k] = rng();
      }
    }
    geo.setAttribute("aTop", new THREE.InstancedBufferAttribute(top, 3));
    geo.setAttribute("aFall", new THREE.InstancedBufferAttribute(fall, 1));
    geo.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 1));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: shared.uTime },
      vertexShader: /* glsl */ `
        attribute vec3 aTop; attribute float aFall; attribute float aOff;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          float y = aTop.y - mod(aOff * aFall + uTime * 5.5, aFall);
          vec3 p = vec3(aTop.x, y, aTop.z);
          vec3 toCam = cameraPosition - p;
          vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + vec3(1e-5));
          vec3 vert = p + vec3(0.0, (uv.y - 0.5) * 0.35, 0.0) + side * (uv.x - 0.5) * 0.02;
          gl_Position = projectionMatrix * viewMatrix * vec4(vert, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          float a = sin(vUv.y * 3.14159) * (1.0 - abs(vUv.x - 0.5) * 1.4) * 0.5;
          gl_FragColor = vec4(vec3(0.09, 0.10, 0.12), a);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 18;
    group.add(mesh);
    return mesh;
  }
  buildDrips();

  // -------------------------------------------------------------- dust motes
  function buildMotes() {
    const geo = new THREE.BufferGeometry();
    const seed = new Float32Array(MOTE_COUNT * 3);
    for (let i = 0; i < MOTE_COUNT * 3; i++) seed[i] = rng();
    geo.setAttribute("position", new THREE.BufferAttribute(seed, 3)); // seeds, not positions
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: shared.uTime, uBoxMin: shared.uBoxMin },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uBoxMin;
        void main() {
          vec3 box = vec3(16.0, 8.0, 16.0);
          vec3 drift = vec3(0.11, -0.045, 0.07) * uTime
                     + 0.35 * sin(uTime * 0.35 + position * 17.0);
          vec3 p = uBoxMin + vec3(4.0) + mod(position * box + drift, box);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(26.0 / max(1.0, -mv.z), 1.0, 3.2);
        }`,
      fragmentShader: /* glsl */ `
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float a = exp(-dot(q, q) * 3.0) * 0.055;
          gl_FragColor = vec4(vec3(0.5, 0.52, 0.56), a);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 17;
    group.add(pts);
    return pts;
  }
  buildMotes();

  // ------------------------------------------------------------ quality tier
  function applyQuality(q) {
    const preset = QUALITY_PRESETS[q] || QUALITY_PRESETS.med;
    // [lane settings] rain density slider: × the preset's counts (1 = preset)
    const dens = Math.max(0, Math.min(1, Number(ctx.settings.rainDensity ?? 1)));
    rain.geometry.instanceCount = Math.round(Math.min(RAIN_MAX, preset.rainCount) * dens);
    splash.geometry.instanceCount = Math.round(Math.min(SPLASH_MAX, preset.splashCount) * dens);
    crown.geometry.instanceCount = splash.geometry.instanceCount;
  }
  applyQuality(ctx.settings.quality);
  ctx.onChange("quality", (q) => applyQuality(q));
  ctx.onChange("rainDensity", () => applyQuality(ctx.settings.quality)); // [lane settings]

  // ------------------------------------------------------------------ update
  let t = 0;
  let frozen = false;

  const api = {
    update(dt) {
      if (!frozen) t += dt;
      shared.uTime.value = t;
      shared.uBoxMin.value.set(
        camera.position.x - BOX[0] / 2,
        camera.position.y - 4,
        camera.position.z - BOX[2] / 2,
      );

      // splash cycling (CPU, zero alloc)
      if (!frozen && dt > 0) {
        const posAttr = splash.geometry.getAttribute("aPos");
        const ageAttr = splash.geometry.getAttribute("aAge");
        const n = splash.geometry.instanceCount;
        for (let i = 0; i < n; i++) {
          splashAge[i] += dt;
          if (splashAge[i] >= splashLife[i]) respawnSplash(i, posAttr);
          ageAttr.array[i] = splashAge[i] / splashLife[i];
        }
        posAttr.needsUpdate = true;
        ageAttr.needsUpdate = true;
      }

      // A6-internal seam: lighting has no boot update slot — drive it here
      // (blackout set-piece timeline, god-ray flicker, fluorescent flicker).
      if (ctx.lights && ctx.lights._tick) ctx.lights._tick(dt);
    },

    prewarmables() {
      // every weather material lives IN the scene (frustumCulled=false), so
      // the prewarm scene pass compiles + draws them already.
      return [];
    },

    // ---- private additions (R21 determinism, flagged to A11) ----
    freeze(on) { frozen = !!on; },
    setPhase(sec) { t = +sec || 0; shared.uTime.value = t; },
    phase() { return t; },
    reset(seed) {
      rng = mulberry32((seed >>> 0) || 20260819);
      t = 0;
      shared.uTime.value = 0;
      const posAttr = splash.geometry.getAttribute("aPos");
      for (let i = 0; i < SPLASH_MAX; i++) {
        respawnSplash(i, posAttr);
        splashAge[i] = rng() * splashLife[i];
      }
      posAttr.needsUpdate = true;
    },
    fogTransmittance,
    occlusionVolumes: OCCL,
  };

  ctx.weather = api;
  return api;
}
