/**
 * Cosmic Coils — runtime/3d/planet.js
 * Builds a complete biome planet: displaced terrain sphere (triplanar xAI
 * texture, vertex-tinted), inner liquid glow sphere, atmosphere rim, gradient
 * nebula sky, sun/hemi lighting, fog, and 3 kinds of multi-part procedural
 * props per biome (instanced, base+glow passes). Every biome reads distinct.
 *
 * Terrain height MUST match the sim exactly — we import terrainH from the sim
 * so snakes ride the same ground the mesh shows.
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
const S = await import("../sim/serpent.js" + V);
const { terrainH, fbm3, CONST } = S;

export const BIOME_DEFS = {
  verdant: {
    label: "Verdant", icon: "🌿",
    tex: "assets/textures/verdant.jpg", texScale: 0.115,
    glowVec: [-0.7, 0.35, 0.75], glowBias: -0.02,   // teal glow-flowers
    tintLow: 0x2a5c2e, tintHigh: 0x9adf7a,
    emissive: 0x1a3f14, emissiveInt: 0.22,
    liquid: { color: 0x1c8fff, glow: 0.32, depth: 1.05 },
    sky: { horizon: 0x14343c, zenith: 0x03040d, nebula: 0x1f7a5c, nebula2: 0x145544, stars: 1.0 },
    sun: { color: 0xfff2d8, int: 2.0, dir: [0.6, 0.7, 0.35] },
    hemi: { sky: 0x9fd8ff, ground: 0x2c5a30, int: 0.65 },
    fog: 0x0a2321, fogDensity: 0.0018,
    ambientMotes: { color: 0xaaffcc, n: 140, mode: "firefly" },
    clouds: { color: 0xffffff, n: 40, alpha: 0.18, alt: [20, 32] },
    accent: 0x53ffb4,
  },
  ember: {
    label: "Ember", icon: "🌋",
    tex: "assets/textures/ember.jpg", texScale: 0.105,
    glowVec: [1.0, -0.75, -0.75], glowBias: 0.0,    // orange lava veins
    tintLow: 0x6a5a62, tintHigh: 0xcfc0bc,
    emissive: 0xff4a00, emissiveInt: 0.72,
    liquid: { color: 0xff5a00, glow: 1.05, depth: 1.0 },
    sky: { horizon: 0x3a120a, zenith: 0x070308, nebula: 0x8a2c10, nebula2: 0x571c3a, stars: 0.7 },
    sun: { color: 0xffd9b8, int: 2.1, dir: [-0.5, 0.62, 0.5] },
    hemi: { sky: 0xff9a66, ground: 0x4a2418, int: 0.7 },
    fog: 0x1d0c08, fogDensity: 0.002,
    ambientMotes: { color: 0xffa040, n: 170, mode: "ember" },
    clouds: { color: 0x4a3a3c, n: 30, alpha: 0.20, alt: [22, 34] },
    accent: 0xff7b3a,
  },
  glacier: {
    label: "Glacier", icon: "❄️",
    tex: "assets/textures/glacier.jpg", texScale: 0.12,
    glowVec: [-0.9, 0.3, 0.85], glowBias: -0.06,    // cyan ice veins
    tintLow: 0x5b86b8, tintHigh: 0xeafaff,
    emissive: 0x2bd8ff, emissiveInt: 0.28,
    liquid: { color: 0x37e0ff, glow: 0.45, depth: 1.1 },
    sky: { horizon: 0x0e2c46, zenith: 0x020310, nebula: 0x1c5f8a, nebula2: 0x3a2c7a, stars: 1.25 },
    sun: { color: 0xdff2ff, int: 2.2, dir: [0.35, 0.75, -0.55] },
    hemi: { sky: 0xbfe8ff, ground: 0x27435f, int: 0.7 },
    fog: 0x10222e, fogDensity: 0.0016,
    ambientMotes: { color: 0xd8f6ff, n: 120, mode: "sparkle" },
    clouds: { color: 0xeaf6ff, n: 22, alpha: 0.13, alt: [24, 36] },
    accent: 0x6fe3ff,
  },
  dune: {
    label: "Dune", icon: "🏜️",
    tex: "assets/textures/dune.jpg", texScale: 0.11,
    glowVec: [0.55, -0.1, -0.85], glowBias: -0.22,  // rare hot mineral sparks
    tintLow: 0x9a6b34, tintHigh: 0xffe4a8,
    emissive: 0xff9a3c, emissiveInt: 0.12,
    liquid: null,
    sky: { horizon: 0x54301c, zenith: 0x0a0512, nebula: 0x8a5c24, nebula2: 0x6a2c50, stars: 0.9 },
    sun: { color: 0xffe9c4, int: 2.7, dir: [0.72, 0.6, 0.1] },
    hemi: { sky: 0xffd9a0, ground: 0x6a4526, int: 0.7 },
    fog: 0x2e1d10, fogDensity: 0.0017,
    ambientMotes: { color: 0xffe0a0, n: 90, mode: "dust" },
    clouds: { color: 0xe8cf9a, n: 16, alpha: 0.12, alt: [20, 30] },
    accent: 0xffc858,
  },
  abyss: {
    label: "Abyss", icon: "🔮",
    tex: "assets/textures/abyss.jpg", texScale: 0.115,
    glowVec: [0.55, -0.95, 0.65], glowBias: 0.0,    // magenta/cyan spores
    tintLow: 0x271b4a, tintHigh: 0x7a5fd0,
    emissive: 0xb43cff, emissiveInt: 0.38,
    liquid: { color: 0xff2ba6, glow: 0.75, depth: 1.05 },
    sky: { horizon: 0x1c0f3a, zenith: 0x040112, nebula: 0x6a1c8a, nebula2: 0x1c4a8a, stars: 1.4 },
    sun: { color: 0xd0b8ff, int: 1.55, dir: [-0.3, 0.7, -0.62] },
    hemi: { sky: 0x9a7aff, ground: 0x2a1a4a, int: 0.72 },
    fog: 0x150a2e, fogDensity: 0.0019,
    ambientMotes: { color: 0xe27aff, n: 160, mode: "spore" },
    clouds: { color: 0xb88aff, n: 34, alpha: 0.14, alt: [24, 36] },
    accent: 0xe05aff,
  },
};

// ── triplanar injection for the terrain material ─────────────────────────────
// glowVec: per-biome channel weights — dot(tex.rgb, glowVec) > threshold marks
// the texture's VEINS (lava cracks / ice veins / spores / glow flowers) so only
// those parts emit. Plain luminance failed: mid-gray rock lit up planet-wide.
function triplanarize(mat, texScale, glowVec, glowBias) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTexScale = { value: texScale };
    sh.uniforms.uGlowVec = { value: glowVec };
    sh.uniforms.uGlowBias = { value: glowBias };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; uniform float uTexScale; uniform vec3 uGlowVec; uniform float uGlowBias;")
      .replace("#include <map_fragment>", `
        #ifdef USE_MAP
          vec3 tpN = abs(normalize(vWNorm));
          tpN = pow(tpN, vec3(3.0)); tpN /= (tpN.x + tpN.y + tpN.z);
          vec3 sp = vWPos * uTexScale;
          vec4 tx = texture2D(map, sp.zy) * tpN.x + texture2D(map, sp.xz) * tpN.y + texture2D(map, sp.xy) * tpN.z;
          diffuseColor *= tx;
        #endif
      `)
      .replace("#include <emissivemap_fragment>", `
        {
          // vein/crack glow ONLY — kill the uniform emissive wash (it flattened
          // the whole planet into one glowing color on high-emissive biomes)
          #ifdef USE_MAP
            vec3 tpN2 = abs(normalize(vWNorm));
            tpN2 = pow(tpN2, vec3(3.0)); tpN2 /= (tpN2.x + tpN2.y + tpN2.z);
            vec3 sp2 = vWPos * uTexScale;
            vec4 tx2 = texture2D(map, sp2.zy) * tpN2.x + texture2D(map, sp2.xz) * tpN2.y + texture2D(map, sp2.xy) * tpN2.z;
            float vein = smoothstep(0.10, 0.42, dot(tx2.rgb, uGlowVec) + uGlowBias);
            totalEmissiveRadiance = (emissive * vein * 2.4 + emissive * 0.015) * (0.7 + 0.3 * tx2.g + 0.3 * tx2.b);
          #else
            totalEmissiveRadiance = emissive * 0.1;
          #endif
        }
      `);
  };
}

// ── sky shader ───────────────────────────────────────────────────────────────
function makeSky(def, seed) {
  const geo = new THREE.SphereGeometry(1600, 32, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(def.sky.horizon) },
      uZenith: { value: new THREE.Color(def.sky.zenith) },
      uNebula: { value: new THREE.Color(def.sky.nebula) },
      uNebula2: { value: new THREE.Color(def.sky.nebula2) },
      uStars: { value: def.sky.stars },
      uSeed: { value: (seed % 1000) / 1000 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uHorizon,uZenith,uNebula,uNebula2; uniform float uStars,uSeed,uTime,uFlash;
      float hash(vec3 p){ p=fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*noise(p); a*=0.5; p*=2.1; } return s; }
      void main(){
        float up = vDir.y * 0.5 + 0.5;
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.85, up));
        // nebula bands
        float n1 = fbm(vDir * 2.6 + uSeed * 37.0);
        float n2 = fbm(vDir * 4.2 - uSeed * 23.0 + 5.0);
        col += uNebula * smoothstep(0.55, 0.9, n1) * 0.55;
        col += uNebula2 * smoothstep(0.6, 0.95, n2) * 0.45;
        // stars: two layers of round point twinkles (falloff from cell center)
        vec3 sd = vDir * 240.0;
        vec3 c1 = floor(sd); vec3 f1 = fract(sd) - 0.5;
        float on1 = step(0.998, hash(c1));
        float st = on1 * smoothstep(0.045, 0.0, dot(f1, f1)) * uStars;
        vec3 sd2 = vDir * 520.0 + 7.7;
        vec3 c2 = floor(sd2); vec3 f2 = fract(sd2) - 0.5;
        float on2 = step(0.999, hash(c2));
        float st2 = on2 * smoothstep(0.06, 0.0, dot(f2, f2)) * uStars;
        float tw = 0.55 + 0.45 * sin(uTime * 2.0 + hash(c1) * 40.0);
        col += vec3(1.0) * st * tw + vec3(0.8, 0.9, 1.0) * st2 * 0.7;
        col += vec3(0.9, 0.95, 1.0) * uFlash; // lightning
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ── atmosphere fresnel shell ─────────────────────────────────────────────────
function makeAtmosphere(R, colorHex) {
  // thinner, dimmer limb glow — previous rim (α·0.42 + bloom) read as a harsh halo
  const geo = new THREE.SphereGeometry(R * 1.035, 64, 48);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uColor: { value: new THREE.Color(colorHex).multiplyScalar(0.42) } },
    vertexShader: `
      varying vec3 vN; varying vec3 vE;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vE = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }
    `,
    fragmentShader: `
      varying vec3 vN; varying vec3 vE; uniform vec3 uColor;
      void main(){ float f = pow(1.0 - abs(dot(vN, vE)), 4.2); gl_FragColor = vec4(uColor, f * 0.10); }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

// ── procedural multi-part props (merged geo, base+glow instanced pair) ───────
function mergeGeos(parts) {
  // parts: [{geo, x,y,z, rx,ry,rz, s, sy}] — bake transform into cloned geometry, then merge
  const merged = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  for (const p of parts) {
    const g = p.geo.clone();
    E.set(p.rx || 0, p.ry || 0, p.rz || 0);
    Q.setFromEuler(E);
    M.compose(new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0), Q, new THREE.Vector3(p.s || 1, p.sy || p.s || 1, p.s || 1));
    g.applyMatrix4(M);
    merged.push(g);
    p.geo.dispose && merged.push();
  }
  // manual merge (avoid BufferGeometryUtils import): concat attributes
  let vc = 0, ic = 0;
  for (const g of merged) { vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of merged) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const gi = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    io += gi.length; vo += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const G = {
  cone: (r, h, s = 7) => new THREE.ConeGeometry(r, h, s),
  cyl: (r1, r2, h, s = 7) => new THREE.CylinderGeometry(r1, r2, h, s),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  sph: (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h),
  box: (a, b, c) => new THREE.BoxGeometry(a, b, c),
  oct: (r) => new THREE.OctahedronGeometry(r),
};

/** Each prop = { base: mergedGeo, glow: mergedGeo|null, baseColor, glowColor } (y-up, sits on y=0). */
function propDefs(biome, rng) {
  const defs = [];
  if (biome === "verdant") {
    defs.push({
      n: 46, baseColor: 0x3c7a3a, glowColor: 0x7dffb0, s: [0.8, 1.6],
      base: mergeGeos([
        { geo: G.cyl(0.16, 0.24, 1.2, 6), y: 0.6 },
        { geo: G.ico(0.72, 1), y: 1.7, s: 1 },
        { geo: G.ico(0.5, 1), y: 2.3, x: 0.25, s: 0.85 },
        { geo: G.ico(0.42, 1), y: 2.1, x: -0.32, z: 0.1, s: 0.8 },
      ]),
      glow: mergeGeos([
        { geo: G.sph(0.09, 6, 5), y: 1.55, x: 0.5, z: 0.3 },
        { geo: G.sph(0.07, 6, 5), y: 2.2, x: -0.45, z: -0.2 },
        { geo: G.sph(0.08, 6, 5), y: 2.6, x: 0.1, z: 0.35 },
      ]),
    });
    defs.push({
      n: 34, baseColor: 0x8a9f8a, glowColor: 0xcfffe0, s: [0.5, 1.1],
      base: mergeGeos([
        { geo: G.ico(0.6, 0), y: 0.35, s: 1, sy: 0.62 },
        { geo: G.ico(0.34, 0), y: 0.3, x: 0.55, z: 0.2, s: 1, sy: 0.7 },
      ]),
      glow: null,
    });
    defs.push({
      n: 30, baseColor: 0xd8c8ff, glowColor: 0x9a5cff, s: [0.5, 1.0],
      base: mergeGeos([
        { geo: G.cyl(0.08, 0.13, 0.7, 6), y: 0.35 },
        { geo: G.cyl(0.07, 0.11, 0.6, 6), y: 0.3, x: 0.3, rz: 0.3 },
      ]),
      glow: mergeGeos([
        { geo: G.sph(0.3, 8, 6), y: 0.82, s: 1, sy: 0.6 },
        { geo: G.sph(0.22, 8, 6), y: 0.66, x: 0.42, rz: 0.25, s: 1, sy: 0.6 },
      ]),
    });
  } else if (biome === "ember") {
    defs.push({
      n: 40, baseColor: 0x2e2430, glowColor: 0xff6a1a, s: [0.9, 2.0],
      base: mergeGeos([
        { geo: G.cyl(0.12, 0.5, 2.4, 5), y: 1.2, rz: 0.08 },
        { geo: G.cyl(0.08, 0.34, 1.5, 5), y: 0.75, x: 0.5, rz: -0.22 },
        { geo: G.cyl(0.06, 0.28, 1.1, 5), y: 0.55, x: -0.42, z: 0.2, rz: 0.24 },
      ]),
      glow: mergeGeos([
        { geo: G.oct(0.16), y: 2.42 },
      ]),
    });
    defs.push({
      n: 30, baseColor: 0x241d26, glowColor: 0xff3c00, s: [0.6, 1.3],
      base: mergeGeos([
        { geo: G.ico(0.62, 0), y: 0.4, s: 1, sy: 0.7 },
        { geo: G.ico(0.4, 0), y: 0.35, x: 0.6, s: 1, sy: 0.62 },
      ]),
      glow: mergeGeos([
        { geo: G.ico(0.3, 0), y: 0.52, s: 1, sy: 0.5 },
      ]),
    });
    defs.push({
      n: 26, baseColor: 0x1a1420, glowColor: 0xffa03c, s: [0.7, 1.4],
      base: mergeGeos([
        { geo: G.oct(0.5), y: 0.5, sy: 1.6 },
        { geo: G.oct(0.3), y: 0.35, x: 0.5, z: -0.2, sy: 1.3 },
      ]),
      glow: null,
    });
  } else if (biome === "glacier") {
    defs.push({
      n: 44, baseColor: 0xbfe8ff, glowColor: 0x5ce0ff, s: [0.7, 1.8],
      base: mergeGeos([
        { geo: G.oct(0.5), y: 0.8, sy: 2.4, ry: 0.4 },
        { geo: G.oct(0.32), y: 0.5, x: 0.5, z: 0.15, sy: 1.7, ry: 0.9 },
        { geo: G.oct(0.24), y: 0.35, x: -0.4, z: -0.1, sy: 1.3, ry: 1.6 },
      ]),
      glow: mergeGeos([
        { geo: G.oct(0.18), y: 1.15, sy: 1.8 },
      ]),
    });
    defs.push({
      n: 30, baseColor: 0x9fd8e8, glowColor: 0xffffff, s: [0.8, 1.5],
      base: mergeGeos([
        { geo: G.cone(0.5, 1.0, 7), y: 0.5 },
        { geo: G.cone(0.4, 0.8, 7), y: 1.05 },
        { geo: G.cone(0.28, 0.6, 7), y: 1.55 },
      ]),
      glow: null,
    });
    defs.push({
      n: 26, baseColor: 0xd8f2ff, glowColor: 0x9ff2ff, s: [0.5, 1.0],
      base: mergeGeos([
        { geo: G.ico(0.55, 0), y: 0.3, sy: 0.55 },
      ]),
      glow: null,
    });
  } else if (biome === "dune") {
    defs.push({
      n: 36, baseColor: 0x3f8a4a, glowColor: 0xffe07a, s: [0.7, 1.4],
      base: mergeGeos([
        { geo: G.cyl(0.22, 0.28, 1.6, 8), y: 0.8 },
        { geo: G.cyl(0.12, 0.15, 0.7, 7), y: 1.1, x: 0.45, rz: -0.9 },
        { geo: G.cyl(0.12, 0.15, 0.55, 7), y: 1.35, x: 0.62, rz: 0 },
        { geo: G.cyl(0.11, 0.14, 0.6, 7), y: 0.85, x: -0.42, rz: 0.9 },
        { geo: G.cyl(0.11, 0.14, 0.5, 7), y: 1.1, x: -0.58 },
      ]),
      glow: mergeGeos([
        { geo: G.sph(0.12, 7, 5), y: 1.7 },
      ]),
    });
    defs.push({
      n: 26, baseColor: 0xc8a86a, glowColor: 0xffb43c, s: [0.8, 1.6],
      base: mergeGeos([
        { geo: G.cyl(0.3, 0.38, 1.9, 8), y: 0.95, rz: 0.06 },
        { geo: G.box(0.9, 0.28, 0.9), y: 2.0, ry: 0.2 },
        { geo: G.box(0.72, 0.2, 0.72), y: 0.1 },
      ]),
      glow: mergeGeos([
        { geo: G.cyl(0.315, 0.315, 0.14, 8), y: 1.45 },
      ]),
    });
    defs.push({
      n: 30, baseColor: 0xb08a54, glowColor: 0xffd88a, s: [0.6, 1.3],
      base: mergeGeos([
        { geo: G.ico(0.6, 0), y: 0.35, sy: 0.6 },
        { geo: G.ico(0.36, 0), y: 0.3, x: 0.55, z: 0.25, sy: 0.66 },
      ]),
      glow: null,
    });
  } else { // abyss
    defs.push({
      n: 46, baseColor: 0x3a2560, glowColor: 0xe05aff, s: [0.8, 2.0],
      base: mergeGeos([
        { geo: G.oct(0.4), y: 0.7, sy: 2.6, ry: 0.3 },
        { geo: G.oct(0.26), y: 0.45, x: 0.42, sy: 1.8, ry: 1.1 },
      ]),
      glow: mergeGeos([
        { geo: G.oct(0.2), y: 1.5, sy: 2.0 },
        { geo: G.oct(0.12), y: 0.85, x: 0.42, sy: 1.4 },
      ]),
    });
    defs.push({
      n: 32, baseColor: 0x241a44, glowColor: 0x40e8ff, s: [0.6, 1.2],
      base: mergeGeos([
        { geo: G.sph(0.5, 9, 7), y: 0.5, sy: 0.8 },
        { geo: G.cyl(0.05, 0.09, 0.9, 5), y: 1.15, x: 0.2, rz: -0.3 },
        { geo: G.cyl(0.05, 0.09, 1.1, 5), y: 1.2, x: -0.15, z: 0.1, rz: 0.25 },
        { geo: G.cyl(0.04, 0.08, 0.8, 5), y: 1.05, z: -0.2, rx: -0.3 },
      ]),
      glow: mergeGeos([
        { geo: G.sph(0.1, 6, 5), y: 1.62, x: 0.32 },
        { geo: G.sph(0.09, 6, 5), y: 1.78, x: -0.25, z: 0.14 },
        { geo: G.sph(0.08, 6, 5), y: 1.48, z: -0.3 },
      ]),
    });
    defs.push({
      n: 26, baseColor: 0x4a2a70, glowColor: 0xff2ba6, s: [0.6, 1.2],
      base: mergeGeos([
        { geo: G.cyl(0.5, 0.6, 0.2, 9), y: 0.1 },
        { geo: G.sph(0.42, 9, 7), y: 0.5, sy: 1.2 },
      ]),
      glow: mergeGeos([
        { geo: G.sph(0.16, 7, 5), y: 1.05 },
      ]),
    });
  }
  return defs;
}

// ── planet builder ───────────────────────────────────────────────────────────
export class Planet {
  constructor(scene, biome, seed, texLoader) {
    this.scene = scene;
    this.biome = biome;
    this.def = BIOME_DEFS[biome];
    this.seed = seed;
    this.group = new THREE.Group();
    this.R = CONST.R;
    this._time = 0;
    this._build(texLoader);
    scene.add(this.group);
  }

  _build(texLoader) {
    const def = this.def, R = this.R, seed = this.seed;

    // terrain sphere, displaced by the SIM's terrain function
    const geo = new THREE.SphereGeometry(R, 200, 140);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(def.tintLow), cHigh = new THREE.Color(def.tintHigh), cTmp = new THREE.Color();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const h = terrainH(v, seed, CONST.TERRAIN_AMP);
      const r = R + h;
      pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
      const t = THREE.MathUtils.clamp((h / CONST.TERRAIN_AMP) * 0.5 + 0.5, 0, 1);
      // extra macro variation so the tint isn't purely height-banded
      const m = fbm3(v.x * 1.2 + 31, v.y * 1.2 + 17, v.z * 1.2 + 5, seed + 9, 3);
      cTmp.copy(cLow).lerp(cHigh, t * 0.75 + m * 0.25);
      col[i * 3] = cTmp.r; col[i * 3 + 1] = cTmp.g; col[i * 3 + 2] = cTmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();

    const tex = texLoader.load(def.tex);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, vertexColors: true,
      roughness: 0.92, metalness: 0.02,
      emissive: new THREE.Color(def.emissive),
      emissiveIntensity: def.emissiveInt,
    });
    triplanarize(mat, def.texScale, new THREE.Vector3(...def.glowVec), def.glowBias || 0);
    this.terrain = new THREE.Mesh(geo, mat);
    this.group.add(this.terrain);

    // inner liquid glow sphere (peeks through the deepest valleys)
    if (def.liquid) {
      const lg = new THREE.SphereGeometry(R - def.liquid.depth, 96, 64);
      this.liquidMat = new THREE.MeshBasicMaterial({ color: def.liquid.color, fog: true });
      this.liquidGlow = def.liquid.glow;
      this.liquid = new THREE.Mesh(lg, this.liquidMat);
      this.group.add(this.liquid);
    }

    // sky + atmosphere
    this.sky = makeSky(def, seed);
    this.group.add(this.sky);
    this.atmo = makeAtmosphere(R, def.accent);
    this.group.add(this.atmo);

    // lights (created ONCE — never add lights later)
    const sd = def.sun.dir;
    this.sun = new THREE.DirectionalLight(def.sun.color, def.sun.int);
    this.sun.position.set(sd[0] * 600, sd[1] * 600, sd[2] * 600);
    this.group.add(this.sun);
    this.hemi = new THREE.HemisphereLight(def.hemi.sky, def.hemi.ground, def.hemi.int);
    this.group.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, 0.22);
    this.group.add(this.amb);
    this._hemiBase = def.hemi.int;

    // fog
    this.fog = new THREE.FogExp2(def.fog, def.fogDensity);
    this.scene.fog = this.fog;
    this.baseFogDensity = def.fogDensity;

    // props (instanced pairs)
    this.props = [];
    const rng = S.mulberry32(seed ^ 0x9E37);
    const up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
    const m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
    for (const pd of propDefs(this.biome, rng)) {
      const baseMat = new THREE.MeshStandardMaterial({ color: pd.baseColor, roughness: 0.85, metalness: 0.05 });
      const baseIM = new THREE.InstancedMesh(pd.base, baseMat, pd.n);
      let glowIM = null;
      if (pd.glow) {
        const glowMat = new THREE.MeshBasicMaterial({ color: pd.glowColor });
        glowIM = new THREE.InstancedMesh(pd.glow, glowMat, pd.n);
      }
      for (let i = 0; i < pd.n; i++) {
        // random surface point
        let x, y, z, l;
        do { x = rng() * 2 - 1; y = rng() * 2 - 1; z = rng() * 2 - 1; l = x * x + y * y + z * z; } while (l < 0.01 || l > 1);
        n.set(x, y, z).normalize();
        const h = terrainH(n, seed, CONST.TERRAIN_AMP);
        pp.copy(n).multiplyScalar(R + h - 0.06);
        q.setFromUnitVectors(up, n);
        q2.setFromAxisAngle(up, rng() * Math.PI * 2);
        q.multiply(q2);
        const s = pd.s[0] + rng() * (pd.s[1] - pd.s[0]);
        sc.set(s, s * (0.9 + rng() * 0.25), s);
        m4.compose(pp, q, sc);
        baseIM.setMatrixAt(i, m4);
        if (glowIM) glowIM.setMatrixAt(i, m4);
      }
      baseIM.instanceMatrix.needsUpdate = true;
      this.group.add(baseIM);
      this.props.push(baseIM);
      if (glowIM) { glowIM.instanceMatrix.needsUpdate = true; this.group.add(glowIM); this.props.push(glowIM); }
    }
  }

  /** vis: 1 clear … 0.5 stormy; flash: lightning 0..1 */
  update(dt, visMul, flash) {
    this._time += dt;
    this.sky.material.uniforms.uTime.value = this._time;
    this.sky.material.uniforms.uFlash.value = flash || 0;
    const targetD = this.baseFogDensity / Math.max(0.3, visMul * visMul);
    this.fog.density += (targetD - this.fog.density) * Math.min(1, dt * 1.5);
    if (this.liquid) {
      const pulse = 1 + Math.sin(this._time * 1.7) * 0.12;
      this.liquidMat.color.setHex(this.def.liquid.color).multiplyScalar(this.liquidGlow * pulse);
    }
    this.hemi.intensity = this._hemiBase * (0.85 + 0.15 * visMul) + (flash || 0) * 2.2;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }
    });
    if (this.scene.fog === this.fog) this.scene.fog = null;
  }
}
