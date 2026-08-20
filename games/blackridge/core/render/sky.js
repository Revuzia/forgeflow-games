// core/render/sky.js [A6] — night-STORM sky per LD §5.1 (Part 8 #14, R2):
//   1. fragment-shader dome gradient — zenith #05070d → mid #0d1220 →
//      horizon #232a3a, sodium-pollution band #3a2f1e blended into the S/SE
//      horizon quadrant (toward the port), NO stars above the storm.
//   2. two broken-cloud shells (canvas-generated alpha, seeded/deterministic)
//      scrolling wind-driven from the west at parallax speeds, underlit
//      #1c1a22 and brighter near the horizon (vertex colors).
//   3. three billboard silhouette rings — building cutouts with emissive
//      window dots (density falls with distance) + landmarks: 2 container
//      cranes + freighter on the S horizon (the fiction's ship), TV tower NW,
//      aviation-warning red blink dots ×3 (2 s pulse).
//
// DOCUMENTED DEVIATION (flagged in the lane report): LD prescribes ring radii
// 300/600/1000 m but boot's camera far plane is 600 (A0's boot.js) — rings at
// 280/400/500 m instead (worst-case camera at a map corner keeps every ring
// inside the frustum), heights scaled to keep the designed ~0.1 rad angular
// size per ring, so parallax ordering and subtended silhouettes match intent.
// If A0 raises far to ≥1100 the radii can be restored verbatim.
//
// sky.env() → PMREM env baked ONCE at boot; scene.environment is set here
// (ARCH §3.13 / R18 — the plaza-baked CUBE for puddles/glass is reflect.js's).
// Determinism (R21): update() advances an internal phase; setPhase(t) /
// freeze(on) let scenarios pin the sky exactly (flagged to A11).
//
// Frozen exports: createSky(ctx) → { mesh, update(dt), env() } (+ private
// setTimeOfDay/freeze/setPhase — testsurface reads ctx.sky.setTimeOfDay).

import * as THREE from "three";
import { mulberry32 } from "../rng.js"; // pure fn — dual-instance safe

const DOME_R = 520;

// ring spec: [radius, height, windowDotDensity]
const RINGS = [
  [280, 28, 0.32],
  [400, 40, 0.20],
  [500, 50, 0.11],
];

// ---------------------------------------------------------------- textures
function makeCloudTexture(seed) {
  const N = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const g = cv.getContext("2d");
  const img = g.createImageData(N, N);
  const rng = mulberry32(seed);

  // tileable value noise: 4 octaves off a 64×64 wrap grid
  const G = 64;
  const grid = new Float32Array(G * G);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const sample = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i00 = grid[(yi % G) * G + (xi % G)];
    const i10 = grid[(yi % G) * G + ((xi + 1) % G)];
    const i01 = grid[((yi + 1) % G) * G + (xi % G)];
    const i11 = grid[((yi + 1) % G) * G + ((xi + 1) % G)];
    return i00 + (i10 - i00) * sx + (i01 - i00) * sy + (i00 - i10 - i01 + i11) * sx * sy;
  };

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0, amp = 0.5, f = 4 / N;
      for (let o = 0; o < 4; o++) {
        v += sample(x * f * G / 4, y * f * G / 4) * amp;
        amp *= 0.55; f *= 2.1;
      }
      // broken storm deck: coverage ~0.6, soft edges
      const a = Math.min(1, Math.max(0, (v - 0.42) * 3.4));
      const i = (y * N + x) * 4;
      // underlit tint #1c1a22, brighter in the thick parts (city underlight)
      const lum = 0.75 + 0.5 * v;
      img.data[i] = 0x1c * lum;
      img.data[i + 1] = 0x1a * lum;
      img.data[i + 2] = 0x22 * lum;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ring silhouettes: black building cutouts + warm window dots + landmarks.
// Returns { texture, blinkSpots:[{u, vTopFrac}] } — blink world positions
// are derived by the caller from u.
function makeRingTexture(seed, ringIndex, dotDensity, landmarks) {
  const W = 2048, H = 256;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.clearRect(0, 0, W, H);
  const rng = mulberry32(seed);
  const blinkSpots = [];

  const ground = H; // buildings rise from the bottom edge
  g.fillStyle = "#000000";

  // mid-rise blocks all the way around (skyline density varies)
  let x = 0;
  while (x < W) {
    const w = 26 + rng() * 70;
    const h = H * (0.18 + rng() * (ringIndex === 0 ? 0.55 : ringIndex === 1 ? 0.45 : 0.38));
    if (rng() > 0.18) { // gaps between blocks
      g.fillStyle = "#000";
      g.fillRect(x, ground - h, w, h);
      // rooftop clutter
      if (rng() > 0.5) g.fillRect(x + w * 0.2, ground - h - 6 - rng() * 8, 4 + rng() * 8, 14);
      // window dots — density falls with ring distance (LD §5.1)
      const cols = Math.floor(w / 7), rows = Math.floor(h / 9);
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (rng() < dotDensity) {
            g.fillStyle = rng() < 0.75 ? "#ffc88a" : "#cfe0d8";
            g.fillRect(x + 4 + cx * 7, ground - h + 5 + cy * 9, 2, 2);
            g.fillStyle = "#000";
          }
        }
      }
    }
    x += w + rng() * 30;
  }

  // landmarks (drawn last, solid black over everything)
  g.fillStyle = "#000";
  for (const lm of landmarks || []) {
    const cx = lm.u * W;
    if (lm.kind === "crane") {
      const h = H * 0.78, jib = 130;
      g.fillRect(cx - 3, ground - h, 6, h);                    // mast
      g.fillRect(cx - jib * 0.35, ground - h, jib, 5);         // jib
      g.fillRect(cx + jib * 0.45, ground - h + 5, 3, 26);      // hoist cable
      g.fillRect(cx - jib * 0.3, ground - h + 5, 3, 16);       // counter cable
      blinkSpots.push({ u: lm.u, vTopFrac: h / H });
    } else if (lm.kind === "freighter") {
      const h = H * 0.2;
      g.fillRect(cx - 120, ground - h, 240, h);                // hull
      g.fillRect(cx + 55, ground - h - 26, 34, 26);            // bridge block
      g.fillRect(cx - 60, ground - h - 12, 8, 12);             // mast
    } else if (lm.kind === "tower") {
      const h = H * 0.92;
      // tapering TV mast
      for (let s = 0; s < 8; s++) {
        const w0 = 14 - s * 1.5;
        g.fillRect(cx - w0 / 2, ground - (h * (s + 1)) / 8, w0, h / 8 + 1);
      }
      g.fillRect(cx - 5, ground - h * 0.62, 10, 8);            // pod
      blinkSpots.push({ u: lm.u, vTopFrac: h / H });
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { texture: tex, blinkSpots };
}

// ------------------------------------------------------------------- main
export function createSky(ctx) {
  const scene = ctx.scene;
  const group = new THREE.Group();
  group.name = "sky";

  // ---------------------------------------------------------------- dome
  // W2/iter04: the whole ramp lifted ×1.7 in LINEAR radiance (hex values are
  // the converted result, not a hand-picked palette). The dome is unlit
  // MeshBasic-class output, so it does NOT scale with the light pool — when
  // lighting.js took the key from 0.061 to 1.94 luminance the old ramp left
  // the sky DARKER than the buildings in front of it, which inverts aerial
  // perspective: distant geometry gains contrast with distance instead of
  // losing it, and the city reads as flat cutouts (VT §4 amateur tell #6,
  // D4 hard cap). weather.js FOG.color carries the same new horizon value —
  // the fog and the sky it fades into have to be the same colour.
  const domeUniforms = {
    uZenith: { value: new THREE.Color(0x080c15) },
    uMid: { value: new THREE.Color(0x192335) },
    uHorizon: { value: new THREE.Color(0x2e384d) },
    uSodium: { value: new THREE.Color(0x4c3c28) },
    uMoonGlow: { value: new THREE.Color(0x5d6f90) },
    uDusk: { value: 0 }, // setTimeOfDay('dusk') lerps horizon warmth
  };
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: domeUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon;
      uniform vec3 uSodium; uniform vec3 uMoonGlow; uniform float uDusk;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.02, 0.30, y));
        col = mix(col, uZenith, smoothstep(0.30, 0.75, y));
        // below the horizon: fall to near-black (the canal / fog floor)
        col = mix(col, uZenith * 0.6, smoothstep(0.0, -0.25, y));
        vec3 h = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5));
        // sodium-pollution band, S/SE quadrant toward the port (LD §5.1) —
        // narrow (sits BEHIND the silhouette rings so cranes read against it)
        float sse = smoothstep(0.05, 0.85, dot(h, normalize(vec3(0.45, 0.0, 0.89))));
        float band = sse * exp(-max(y, 0.0) * 16.0) * smoothstep(-0.10, -0.02, y);
        col = mix(col, uSodium, band * (0.55 + 0.3 * uDusk));
        // faint cool skyglow toward the moon azimuth (NW)
        float nw = smoothstep(0.3, 0.95, dot(h, normalize(vec3(-0.766, 0.0, -0.643))));
        col += uMoonGlow * nw * exp(-max(y, 0.0) * 5.0) * 0.10;
        // dusk variant: horizon lifts warm
        col = mix(col, col * 1.6 + uSodium * 0.25 * exp(-max(y, 0.0) * 4.0), uDusk * 0.5);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 40, 24), domeMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.userData.br_sky = true;
  dome.layers.enable(3); // planar reflection sees the sky
  group.add(dome);

  // --------------------------------------------------------------- clouds
  const cloudTexA = makeCloudTexture(90210);
  const cloudTexB = cloudTexA.clone();
  cloudTexB.needsUpdate = true;
  cloudTexB.repeat.set(1.7, 1.7);

  function cloudShell(radius, tex, opacity) {
    // top hemisphere only, vertex colors brighten toward the horizon; the
    // shell reaches below the horizon so its rim hides behind fog + rings
    const geo = new THREE.SphereGeometry(radius, 36, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / radius;
      const b = 0.55 + 0.55 * Math.pow(Math.max(0, 1 - y), 1.5); // brighter low, dark zenith
      colors[i * 3] = b; colors[i * 3 + 1] = b; colors[i * 3 + 2] = b * 1.05;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.BackSide,
      vertexColors: true, fog: false, opacity,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -9;
    m.frustumCulled = false;
    m.userData.br_sky = true;
    m.layers.enable(3);
    return m;
  }
  const shellA = cloudShell(470, cloudTexA, 0.62);
  const shellB = cloudShell(432, cloudTexB, 0.42);
  group.add(shellA, shellB);

  // ---------------------------------------------------- silhouette rings
  // world azimuth φ: dir = (sinφ, 0, cosφ); φ=0 → +Z = SOUTH (the canal).
  const LANDMARKS = [
    [], // ring 0: anonymous blocks only
    [ // ring 1 (mid): the port — cranes + the fiction's freighter
      { kind: "crane", phi: -0.14 },
      { kind: "crane", phi: 0.12 },
      { kind: "freighter", phi: 0.30 },
    ],
    [ // ring 2 (far): TV tower NW
      { kind: "tower", phi: 3.93 },
    ],
  ];
  const phiToU = (phi) => {
    // mesh.rotation.y = PI puts canvas u=0.5 at world φ=0 (south)
    let u = phi / (Math.PI * 2) + 0.5;
    return u - Math.floor(u);
  };

  const blinkWorld = []; // Vector3 tops for the aviation blinkers
  RINGS.forEach(([radius, height, dots], ri) => {
    const lms = LANDMARKS[ri].map((l) => ({ kind: l.kind, u: phiToU(l.phi), phi: l.phi }));
    const { texture, blinkSpots } = makeRingTexture(7700 + ri * 131, ri, dots, lms);
    const geo = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, side: THREE.BackSide,
      fog: true, // height fog blends the bases (weather.js chunk override)
      // Window dots authored well above 1.0: at 280–500 m the height fog
      // transmits only ~3–8%, and real city lights are orders brighter than
      // surfaces — HDR punch is what lets them read through the haze (and
      // bloom picks them up). Black silhouettes stay 0 × anything.
      color: new THREE.Color(3.2, 2.95, 2.7),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = height / 2 - 4; // sink the base below the horizon line
    mesh.rotation.y = Math.PI;
    mesh.renderOrder = -8 + ri;
    mesh.frustumCulled = false;
    mesh.userData.br_sky = true;
    mesh.layers.enable(3);
    group.add(mesh);

    for (const b of blinkSpots) {
      const lm = lms.find((l) => Math.abs(l.u - b.u) < 1e-6);
      const phi = lm ? lm.phi : 0;
      blinkWorld.push(new THREE.Vector3(
        Math.sin(phi) * radius * 0.995,
        b.vTopFrac * height - 4,
        Math.cos(phi) * radius * 0.995,
      ));
    }
  });

  // aviation-warning blinkers ×3 (slow 2 s pulse, emissive only — LD §5.1)
  let blinkPts = null, blinkMat = null;
  if (blinkWorld.length) {
    const geo = new THREE.BufferGeometry().setFromPoints(blinkWorld.slice(0, 3));
    blinkMat = new THREE.PointsMaterial({
      color: 0xff2a22, size: 5, sizeAttenuation: false, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    blinkPts = new THREE.Points(geo, blinkMat);
    blinkPts.renderOrder = -5;
    blinkPts.frustumCulled = false;
    blinkPts.userData.br_sky = true;
    blinkPts.layers.enable(3);
    group.add(blinkPts);
  }

  // ------------------------------------------------------------------ env
  // PMREM baked ONCE from the dome (ARCH §3.13). Standard materials get their
  // night ambient IBL from this; the plaza cube (reflect.js) feeds puddles.
  let envTex = null;
  let envRT = null;
  function bakeEnv() {
    const pmrem = new THREE.PMREMGenerator(ctx.renderer);
    const tmp = new THREE.Scene();
    const domeClone = new THREE.Mesh(dome.geometry, domeMat);
    tmp.add(domeClone);
    const rt = pmrem.fromScene(tmp, 0, 1, 700);
    pmrem.dispose();
    if (envRT) envRT.dispose(); // setTimeOfDay rebake must not leak the old RT
    envRT = rt;
    envTex = rt.texture;
    // reflect.js publishes a PMREM of the plaza-baked SCENE cube (R18) — it
    // carries the practicals/neon and is the wet-streak source, so it wins
    // as scene.environment once present; the dome PMREM is boot-time cover
    // (scenarios re-call setTimeOfDay every pose — never clobber the cube).
    const pub = globalThis.__BR_REFLECT__;
    if (pub && pub.envPMREM) {
      scene.environment = pub.envPMREM;
      if ("environmentIntensity" in scene) scene.environmentIntensity = 0.5;
    } else {
      scene.environment = envTex;
      if ("environmentIntensity" in scene) scene.environmentIntensity = 0.3;
    }
  }
  try { bakeEnv(); } catch (e) {
    console.warn("[sky] env bake failed:", e && e.message);
  }

  // ----------------------------------------------------------------- state
  let t = 0;
  let frozen = false;

  function applyPhase() {
    // deterministic: everything time-driven derives from `t` (R21)
    cloudTexA.offset.x = -t * 0.004;          // LD §5.1: ~0.004 uv/s, from W
    cloudTexA.offset.y = t * 0.0007;
    cloudTexB.offset.x = -t * 0.0026;
    cloudTexB.offset.y = -t * 0.0005;
    if (blinkMat) {
      const p = Math.sin(t * Math.PI); // 2 s period
      blinkMat.opacity = Math.pow(Math.max(0, p), 3) * 0.9 + 0.05;
    }
  }
  applyPhase();

  const api = {
    mesh: group,
    update(dt) {
      if (!frozen) { t += dt; applyPhase(); }
      // camera-follow: the sky is "at infinity" — keep it centred so the
      // dome never parallaxes but the RINGS do (they're offset from centre
      // by their own radii; group follows camera XZ, rings keep world pose).
      // LD wants TRUE ring parallax from camera translation — so the group
      // stays at origin and the dome alone follows the camera:
      dome.position.copy(ctx.camera.position);
      shellA.position.x = ctx.camera.position.x;
      shellA.position.z = ctx.camera.position.z;
      shellB.position.x = ctx.camera.position.x;
      shellB.position.z = ctx.camera.position.z;
    },
    env() { return envTex; },
    // ---- private additions ----
    setTimeOfDay(k) {
      domeUniforms.uDusk.value = k === "dusk" ? 1 : 0;
      try { bakeEnv(); } catch (e) { /* keep old env */ }
    },
    freeze(on) { frozen = !!on; },
    setPhase(sec) { t = +sec || 0; applyPhase(); },
    phase() { return t; },
  };

  ctx.sky = api; // testsurface reads ctx.sky.setTimeOfDay (A11 wave-2)
  return api;
}
