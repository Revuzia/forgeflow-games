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
  neon_bounce: { intensity: 150, distance: 30, penumbra: 0.55, decay: 1.8 },
  skylight:    { intensity: 38,  distance: 16, penumbra: 0.35, decay: 1.8 },
  flood:       { intensity: 140, distance: 46, penumbra: 0.28, decay: 1.8 },
  default:     { intensity: 40,  distance: 18, penumbra: 0.4,  decay: 1.8 },
};

// God-ray cone opacity by kind (LD §3.5 — exactly the 5 godRay:true poles).
const CONE_OPACITY = { sodium: 0.13, skylight: 0.16, flood: 0.17, default: 0.12 };

export function createLights(ctx) {
  const scene = ctx.scene;

  // ------------------------------------------------------------ the pool
  // Moon — the ONE shadow caster. Azimuth 310° (NW), elevation 38°,
  // #5a6b8c storm-filtered (LD §3.2). +X east, -Z north.
  const moon = new THREE.DirectionalLight(0x5a6b8c, 0.32);
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
  const groundCol = new THREE.Color(0x0a0c10).lerp(new THREE.Color(0x2a2418), 0.35);
  const hemi = new THREE.HemisphereLight(0x1a2030, groundCol, 0.07);
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
      uniforms: { uOp: { value: 0.10 } }, // LD §5.2: faint additive fog discs
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
        // silhouette-edge fade (avoid edge-on billboard reveal, LD §3.5)
        float facing = pow(abs(dot(normalize(vNormalW), V)), 1.5);
        // bright at the source (uv.y=1 is the cylinder top = the lamp)
        float grad = 0.18 + 0.82 * pow(vUv.y, 1.6);
        // fade the shaft when the camera is inside/near it (<2 m)
        float nf = smoothstep(0.9, 2.2, distance(cameraPosition, vPosW));
        float a = uOpacity * uFlick * facing * grad * nf;
        gl_FragColor = vec4(uColor, a);
      }`,
  });

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
        const r = p.kind === "neon_bounce" ? 7.0 : 4.6;
        m4.makeScale(r, 1, r).setPosition(p.pos[0], 0.07, p.pos[2]);
        mesh.setMatrixAt(i, m4);
        const col = new THREE.Color(p.color);
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
      // VT §1 probe intent: white card facing the key vs facing away.
      // Facing key sees moon+hemi; facing away sees hemi only.
      return (moon.intensity + hemi.intensity) / Math.max(1e-5, hemi.intensity);
    },
  };

  ctx.lights = api; // A6-internal seam: weather.update drives _tick
  return api;
}
