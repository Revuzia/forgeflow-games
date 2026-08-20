// core/fx/decals.js [A7] — pooled bullet holes / scorch marks.
// Ring buffer of 256 instanced quads (architecture §3.14), ~20 s lifetime
// (14 s full + 6 s fade — VT §5 "decal ring buffer, ~20 s fade"; permanence
// is D6 hard-cap insurance). One InstancedMesh, one ShaderMaterial, one
// draw call. Fade is GPU-side (aBirth attribute vs uTime uniform) — zero
// per-frame CPU after spawn. Internal to fx.js.
//
// ---- WHY THIS ART IS BI-TONAL (iter07, D6 permanence) ---------------------
// Three consecutive cold-critic rounds reported ZERO impact decals while the
// manifest counted 58-64 of them per posed frame. MEASURED live in the iter06
// S3 pose before this pass: 57 decal instances alive, all 57 on screen, whole
// cluster occupying a 102 x 77 px patch of a 1920x1080 frame, each quad 3.9-7.5
// px across — and the art inside that quad was a near-black hole (rgba 8,8,8)
// whose opaque core covered only the inner ~25% of the cell. So what actually
// reached the frame was a ~2 px dark speck, which on the lamp-lit van it was
// stamped on is indistinguishable from the facade's own grime decals. The
// counter was right and the pixels were not there.
//
// Two changes, both structural:
//  (a) SCALE. A rifle strike on concrete is not a 3 mm hole — it spalls a
//      50-90 mm crater and throws a dust scuff several times wider again. The
//      quad now carries the whole event (crater + halo), so the authored size
//      is 0.36-0.54 m and the DARK CORE inside it is ~0.09 m: physically the
//      same hole, drawn with the damage it actually does around it. MEASURED
//      after: the same S3 cluster renders at 9.4-17.1 px per quad.
//  (b) BI-TONAL, so the mark reads against ANY background. A decal is unlit —
//      one flat RGB against whatever the surface happens to be — so a dark-only
//      decal disappears on night geometry and a bright-only decal glows in a
//      shadowed alley. Every strike cell here pairs a near-black core with a
//      PALE spall rim: on a lit surface the core carries it, in shadow the rim
//      does. Highlights stay in the 0.24-0.35 linear band on purpose — bright
//      enough to separate from a 0.09-0.15 lit night wall, dim enough that it
//      never reads as an emissive dot when the wall behind it is dark.

import * as THREE from "three";

const FULL_S = 14; // opaque window
const OUT_S = 6;   // fade-out window (total ≈ 20 s)
const N = 256;

// ---- atlas layout (frozen; aKind indexes it) -----------------------------
//   0 = concrete/masonry strike A     2 = metal strike (bright gouge)
//   1 = scorch blot (explosions.js)   3 = concrete/masonry strike B
//   4 = wide dust scuff (no core)
// 1 keeps its iter06 meaning so explosions.js needs no edit. Concrete draws
// A or B at random so a shot-up wall is not one stamped shape repeated.
export const KIND_CONCRETE_A = 0;
export const KIND_SCORCH = 1;
export const KIND_METAL = 2;
export const KIND_CONCRETE_B = 3;
export const KIND_SCUFF = 4;
const FRAMES = 5;
const CELL = 256;

function atlasTexture() {
  const cv = document.createElement("canvas");
  cv.width = CELL * FRAMES; cv.height = CELL;
  const g = cv.getContext("2d");
  const R = CELL * 0.5;

  // deterministic local stream — the atlas must be identical every boot
  let s = 0x9e3779b9;
  const rnd = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };

  // ---- cell 0 / 3: CONCRETE STRIKE ---------------------------------------
  // dust halo -> pale spall crater -> inner shadow -> black core -> cracks.
  function concrete(cell, lobes, skew) {
    const cx = cell * CELL + R, cy = R;
    g.save();
    g.beginPath(); g.rect(cell * CELL, 0, CELL, CELL); g.clip();

    // (1) dust scuff halo — pale, very low alpha, irregular
    for (let i = 0; i < 3; i++) {
      const hx = cx + (rnd() - 0.5) * R * 0.30;
      const hy = cy + (rnd() - 0.5) * R * 0.30;
      const hr = R * (0.72 + rnd() * 0.24);
      const hg = g.createRadialGradient(hx, hy, R * 0.10, hx, hy, hr);
      hg.addColorStop(0.00, "rgba(96,92,86,0.20)");
      hg.addColorStop(0.45, "rgba(88,84,79,0.11)");
      hg.addColorStop(1.00, "rgba(80,77,72,0)");
      g.fillStyle = hg;
      g.fillRect(cell * CELL, 0, CELL, CELL);
    }

    // (2) spall crater — irregular pale lobe of freshly exposed aggregate.
    // Sized as a FRACTION OF THE CELL, not in metres: at the 10-17 px a decal
    // occupies at 20 m, what separates a bullet strike from a grime blotch is
    // the pale rim, and a rim drawn at 0.30R survives that minification as
    // about two pixels. 0.38R keeps the same physical crater (the quad also
    // carries the halo) while giving the rim the width it needs to read.
    const craterR = R * 0.38;
    g.beginPath();
    for (let i = 0; i <= lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const r = craterR * (0.68 + 0.52 * rnd()) * (1 + skew * Math.cos(a * 2));
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    const cg = g.createRadialGradient(cx, cy, craterR * 0.15, cx, cy, craterR * 1.25);
    cg.addColorStop(0.00, "rgba(126,121,113,0.90)");
    cg.addColorStop(0.55, "rgba(112,107,100,0.86)");
    cg.addColorStop(1.00, "rgba(92,88,82,0.34)");
    g.fillStyle = cg;
    g.fill();

    // (3) inner shadow — the crater has depth, so its floor is darker
    const ig = g.createRadialGradient(cx, cy, R * 0.02, cx, cy, craterR * 0.72);
    ig.addColorStop(0.00, "rgba(16,15,14,0.92)");
    ig.addColorStop(0.55, "rgba(28,26,24,0.60)");
    ig.addColorStop(1.00, "rgba(40,38,35,0)");
    g.fillStyle = ig;
    g.beginPath(); g.arc(cx, cy, craterR * 0.75, 0, Math.PI * 2); g.fill();

    // (4) the hole itself — near-black, small, hard
    const kg = g.createRadialGradient(cx, cy, 1, cx, cy, R * 0.15);
    kg.addColorStop(0.00, "rgba(5,5,5,0.97)");
    kg.addColorStop(0.62, "rgba(8,8,8,0.92)");
    kg.addColorStop(1.00, "rgba(14,13,12,0)");
    g.fillStyle = kg;
    g.beginPath(); g.arc(cx, cy, R * 0.16, 0, Math.PI * 2); g.fill();

    // (5) radial hairline cracks running out of the crater
    g.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      const len = R * (0.34 + rnd() * 0.34);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * craterR * 0.6, cy + Math.sin(a) * craterR * 0.6);
      const mx = cx + Math.cos(a + 0.18) * len * 0.6, my = cy + Math.sin(a + 0.18) * len * 0.6;
      g.quadraticCurveTo(mx, my, cx + Math.cos(a - 0.10) * len, cy + Math.sin(a - 0.10) * len);
      g.strokeStyle = "rgba(18,17,16,0.55)";
      g.lineWidth = 1 + rnd() * 2.2;
      g.stroke();
    }

    // (6) pale chip flecks knocked off around the crater
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const r = craterR * (1.1 + rnd() * 1.9);
      const w = 2 + rnd() * 5;
      g.fillStyle = `rgba(104,100,94,${(0.24 + rnd() * 0.36).toFixed(2)})`;
      g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, w, w * (0.5 + rnd()));
    }
    g.restore();
  }

  // ---- cell 2: METAL STRIKE ----------------------------------------------
  // A round through sheet steel leaves bare metal, which is the BRIGHTEST
  // thing on a night vehicle, ringed by soot. Same bi-tonal logic, inverted
  // emphasis: bright gouge star dominant, dark punch at the centre.
  function metal(cell) {
    const cx = cell * CELL + R, cy = R;
    g.save();
    g.beginPath(); g.rect(cell * CELL, 0, CELL, CELL); g.clip();

    // soot halo
    const sg = g.createRadialGradient(cx, cy, R * 0.10, cx, cy, R * 0.80);
    sg.addColorStop(0.00, "rgba(14,13,12,0.55)");
    sg.addColorStop(0.50, "rgba(20,19,17,0.26)");
    sg.addColorStop(1.00, "rgba(24,22,20,0)");
    g.fillStyle = sg;
    g.fillRect(cell * CELL, 0, CELL, CELL);

    // bare-metal gouge star — petals of torn bright steel
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rnd() * 0.3;
      const len = R * (0.22 + rnd() * 0.26);
      const w = R * (0.035 + rnd() * 0.045);
      g.save();
      g.translate(cx, cy); g.rotate(a);
      const pg = g.createLinearGradient(0, 0, len, 0);
      pg.addColorStop(0.00, "rgba(150,146,138,0.92)");
      pg.addColorStop(0.45, "rgba(122,118,112,0.68)");
      pg.addColorStop(1.00, "rgba(96,92,88,0)");
      g.fillStyle = pg;
      g.beginPath();
      g.moveTo(0, -w); g.lineTo(len, -w * 0.25); g.lineTo(len, w * 0.25); g.lineTo(0, w);
      g.closePath(); g.fill();
      g.restore();
    }

    // bright torn lip right around the punch
    const lg = g.createRadialGradient(cx, cy, R * 0.07, cx, cy, R * 0.17);
    lg.addColorStop(0.00, "rgba(158,154,146,0)");
    lg.addColorStop(0.42, "rgba(158,154,146,0.85)");
    lg.addColorStop(1.00, "rgba(120,116,110,0)");
    g.fillStyle = lg;
    g.beginPath(); g.arc(cx, cy, R * 0.18, 0, Math.PI * 2); g.fill();

    // the punch
    const kg = g.createRadialGradient(cx, cy, 1, cx, cy, R * 0.095);
    kg.addColorStop(0.00, "rgba(4,4,4,0.98)");
    kg.addColorStop(0.65, "rgba(7,7,7,0.92)");
    kg.addColorStop(1.00, "rgba(12,12,12,0)");
    g.fillStyle = kg;
    g.beginPath(); g.arc(cx, cy, R * 0.10, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ---- cell 1: SCORCH (explosions.js) ------------------------------------
  function scorch(cell) {
    const x0 = cell * CELL;
    const blot = (x, y, r, a) => {
      const s2 = g.createRadialGradient(x, y, 1, x, y, r);
      s2.addColorStop(0, `rgba(6,6,6,${a})`);
      s2.addColorStop(0.6, `rgba(10,9,8,${a * 0.55})`);
      s2.addColorStop(1, "rgba(12,11,10,0)");
      g.fillStyle = s2;
      g.fillRect(x0, 0, CELL, CELL);
    };
    blot(x0 + R, R, R * 0.94, 0.85);
    blot(x0 + R * 0.75, R * 0.80, R * 0.56, 0.6);
    blot(x0 + R * 1.30, R * 1.20, R * 0.50, 0.55);
    // ashy pale rim so the blot still separates from a dark night surface
    const rim = g.createRadialGradient(x0 + R, R, R * 0.60, x0 + R, R, R * 0.98);
    rim.addColorStop(0.00, "rgba(78,74,69,0)");
    rim.addColorStop(0.55, "rgba(78,74,69,0.13)");
    rim.addColorStop(1.00, "rgba(70,67,62,0)");
    g.fillStyle = rim;
    g.fillRect(x0, 0, CELL, CELL);
  }

  // ---- cell 4: WIDE DUST SCUFF -------------------------------------------
  // The thing that makes a shot-up wall read from ACROSS A STREET in reference
  // footage is not the holes — at 20 m they are a dozen pixels — it is the
  // pale wash of pulverised masonry the holes sit in. One of these is laid per
  // strike at 3x the strike's diameter and ~0.14 alpha, so a single round
  // barely marks the surface and eleven overlapping ones dust a whole panel.
  // No dark core on purpose: this layer must never read as a mark of its own,
  // only as the ground the marks sit on.
  function scuff(cell) {
    const x0 = cell * CELL, cx = x0 + R, cy = R;
    g.save();
    g.beginPath(); g.rect(x0, 0, CELL, CELL); g.clip();
    for (let i = 0; i < 5; i++) {
      const hx = cx + (rnd() - 0.5) * R * 0.55;
      const hy = cy + (rnd() - 0.5) * R * 0.55;
      const hr = R * (0.45 + rnd() * 0.48);
      const hg = g.createRadialGradient(hx, hy, R * 0.04, hx, hy, hr);
      // ALPHA IS THE WHOLE RISK HERE. These overlap: n layers at alpha a
      // composite to 1-(1-a)^n, so the 0.15 this started at reached 0.81 over
      // an 11-round burst — a 45 px pale blob on a van at 20 m, which is a
      // rendering artifact, not battle damage. At 0.07, and laid on only some
      // strikes (impacts.js), a burst lands around 0.25: a surface that has
      // clearly been chewed, with nothing on it that reads as a stamped card.
      hg.addColorStop(0.00, "rgba(104,100,94,0.07)");
      hg.addColorStop(0.50, "rgba(96,92,87,0.042)");
      hg.addColorStop(1.00, "rgba(88,85,80,0)");
      g.fillStyle = hg;
      g.fillRect(x0, 0, CELL, CELL);
    }
    // a few dark grit specks so it is dust, not a lens smudge
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2;
      const r = R * rnd() * 0.72;
      g.fillStyle = `rgba(22,21,20,${(0.10 + rnd() * 0.18).toFixed(2)})`;
      g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + rnd() * 4, 2 + rnd() * 4);
    }
    g.restore();
  }

  concrete(KIND_CONCRETE_A, 11, 0.14);
  scorch(KIND_SCORCH);
  metal(KIND_METAL);
  concrete(KIND_CONCRETE_B, 9, -0.18);
  scuff(KIND_SCUFF);

  const t = new THREE.CanvasTexture(cv);
  // Mipmapped: a 0.40 m decal is ~19 px at 20 m against a 256 px cell, i.e.
  // 13x minification — unfiltered that is a sparkling crawl of aliased crack
  // pixels. Every cell fades to alpha 0 well inside its own borders, so the
  // usual atlas mip-bleed does not apply here.
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  return t;
}

const VERT = /* glsl */ `
attribute float aBirth;
attribute float aKind;
uniform float uTime;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = vec2((uv.x + aKind) * ${(1 / FRAMES).toFixed(6)}, uv.y);
  float age = uTime - aBirth;
  vFade = (age < 0.0) ? 0.0
        : clamp(1.0 - (age - ${FULL_S.toFixed(1)}) / ${OUT_S.toFixed(1)}, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vFade;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(t.rgb, a);
}`;

const _q = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _s = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);
const _ZAXIS = new THREE.Vector3(0, 0, 1);

export function makeDecals(env) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const birth = new Float32Array(N).fill(-1e9);
  const kind = new Float32Array(N);
  const birthAttr = new THREE.InstancedBufferAttribute(birth, 1);
  const kindAttr = new THREE.InstancedBufferAttribute(kind, 1);
  birthAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aBirth", birthAttr);
  geo.setAttribute("aKind", kindAttr);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: atlasTexture() }, uTime: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = "fx.decals";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // park every instance at zero scale so nothing flickers pre-spawn
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) mesh.setMatrixAt(i, _m);
  env.root.add(mesh);

  let cursor = 0;
  let spawned = 0;
  const rnd = env.rng;

  let rejected = 0;

  return {
    // kind indexes the atlas (KIND_* above). size = quad edge in metres.
    // `dir` (optional) = the incoming ray direction, used ONLY to reject a
    // decal whose surface normal cannot be trusted.
    //
    // WHY THE REJECT EXISTS (iter07). ballistics' resolveHitPayload falls back
    // to [0,1,0] whenever a world hit arrives without a normal, and the pose
    // battery hits that path: MEASURED in the live iter06 S3 pose, 22 of the
    // 57 live decals sat at exactly (-24.00, 1.63, 46.00) with normal (0,1,0)
    // — inside the q_van collider box [-25.55,0,45.25]..[-22.45,2.4,50.75],
    // at the same height as the eye. A horizontal quad at eye height is edge
    // on to the camera: 22 of 57 decals, 39% of the whole permanence budget,
    // were geometrically incapable of showing a single pixel. A bullet that
    // STOPPED on a surface cannot have arrived parallel to it, so a near-zero
    // dot is proof the normal is a fallback, not a measurement. Dropping them
    // is right twice over: it frees the ring buffer for decals that can be
    // seen, and it refuses to place a mark inside solid geometry.
    //
    // BOTH tests must fail before a decal is dropped. A near-horizontal round
    // scuffing the ground 4 m from the eye is also grazing to the RAY, and
    // that decal is legitimate and highly visible — the camera looks down on
    // it. What is unrecoverable is a quad grazing to the ray AND edge on to
    // the camera, which is the van case exactly. One test alone would have
    // thrown away every long-range ground strike in the level.
    spawn(pos, normal, kindId, size, dir) {
      _n.set(normal[0], normal[1], normal[2]);
      if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
      _n.normalize();
      if (dir) {
        const dl = Math.hypot(dir[0], dir[1], dir[2]);
        if (dl > 1e-6) {
          const dot = (_n.x * dir[0] + _n.y * dir[1] + _n.z * dir[2]) / dl;
          if (Math.abs(dot) < 0.2) {
            const cam = env.cam;
            let seen = false;
            if (cam) {
              const vx = pos[0] - cam.position.x;
              const vy = pos[1] - cam.position.y;
              const vz = pos[2] - cam.position.z;
              const vl = Math.hypot(vx, vy, vz);
              if (vl > 1e-6) {
                seen = Math.abs((_n.x * vx + _n.y * vy + _n.z * vz) / vl) >= 0.2;
              }
            }
            if (!seen) { rejected++; return -1; }
          }
        }
      }
      const i = cursor;
      cursor = (cursor + 1) % N;
      _q.setFromUnitVectors(_Z, _n);
      _qRoll.setFromAxisAngle(_ZAXIS, rnd() * Math.PI * 2);
      _q.multiply(_qRoll);
      // normal-offset with a per-decal jitter so stacked decals never z-fight
      const off = 0.006 + rnd() * 0.006;
      _p.set(pos[0] + _n.x * off, pos[1] + _n.y * off, pos[2] + _n.z * off);
      _s.set(size, size, 1);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      birth[i] = env.now();
      kind[i] = kindId;
      mesh.instanceMatrix.needsUpdate = true;
      birthAttr.needsUpdate = true;
      kindAttr.needsUpdate = true;
      spawned++;
      return i;
    },
    update() { mat.uniforms.uTime.value = env.now(); },
    clear() {
      birth.fill(-1e9);
      birthAttr.needsUpdate = true;
    },
    prewarmables() { return [mesh]; },
    spawnedCount: () => spawned,
    rejectedCount: () => rejected,
  };
}
