// HIT PARADE - the shared cel material for fighters (CONTRACT §7 "Toon look").
//
// One look for every body, so the realistic 4K Ch-series bodies and the painted 2K game bodies sit together
// (research ROSTER.md "Style caveat": in lineups the visible difference is detail density; "one shared cel/rim
// shader driven by albedo only ... should hide most of it"). Per fighter material:
//   * MeshToonMaterial driven by the ALBEDO only: normal / specular / roughness maps are dropped (that is where the
//     realistic bodies carry their extra detail), lit through a shared 3-band ramp (NearestFilter DataTexture).
//   * albedo grade in the shader: a mip BIAS (`detailBias`, the realistic profile samples a softer mip), saturation
//     and value, and an optional hue shift that leaves the skin band alone (colour alternates, §5.2 `colors[].tint`).
//   * a stepped (cel) rim light tinted by the albedo, plus hit-flash and IMPACT-armour glow uniforms (fx drives them).
//   * hair / lashes (glTF BLEND or MASK, or a material named *_cutout, §6.1) become alphaTest cutouts (no sorting).
//   * an inverted-hull OUTLINE on every skinned mesh: a BackSide SkinnedMesh sharing the geometry AND the skeleton,
//     pushed out along a SMOOTHED normal after skinning (onBeforeCompile), by a constant width in SCREEN pixels
//     (independent of distance and resolution). Cutout meshes pass their map + alphaTest to the hull.
// All toon materials share one program family (customProgramCacheKey); the per-fighter state lives in uniforms.

import * as THREE from 'three';

export interface ToonProfile {
  /** texture LOD bias for the albedo (+ = softer; realistic bodies use more) */
  detailBias: number;
  saturation: number;
  value: number;
  /** rim strength */
  rim: number;
}

export const TOON_PROFILES: Record<'realistic' | 'painted', ToonProfile> = {
  // the Ch-series 4K bodies: soften the photographic detail, push colour so they read painted
  realistic: { detailBias: 1.6, saturation: 1.28, value: 1.1, rim: 0.55 },
  // painted game bodies: already soft; a small push so both land on the same palette
  painted: { detailBias: 0.4, saturation: 1.12, value: 1.04, rim: 0.55 },
};

/** Ch-series bodies are the realistic family (research ROSTER "[R] realistic 4K Ch-series") */
export function profileForBody(body: string | undefined, override?: Partial<ToonProfile> & { profile?: string }): ToonProfile {
  const fam = override?.profile === 'realistic' || override?.profile === 'painted'
    ? override.profile : (/^ch\d+/i.test(body ?? '') ? 'realistic' : 'painted');
  const base = TOON_PROFILES[fam];
  return {
    detailBias: override?.detailBias ?? base.detailBias,
    saturation: override?.saturation ?? base.saturation,
    value: override?.value ?? base.value,
    rim: override?.rim ?? base.rim,
  };
}

// ─────────────────────────────────────────── shared state ───────────────────────────────────────────

let RAMP: THREE.DataTexture | null = null;
/** the 3-band ramp: shadow / mid / lit (values tuned so the shadow band keeps albedo readable) */
export function toonRamp(): THREE.DataTexture {
  if (RAMP) return RAMP;
  const bands = [96, 178, 255];
  const data = new Uint8Array(bands.length * 4);
  bands.forEach((v, i) => { data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; });
  RAMP = new THREE.DataTexture(data, bands.length, 1, THREE.RGBAFormat);
  RAMP.minFilter = THREE.NearestFilter;
  RAMP.magFilter = THREE.NearestFilter;
  RAMP.generateMipmaps = false;
  RAMP.colorSpace = THREE.NoColorSpace;
  RAMP.needsUpdate = true;
  return RAMP;
}

/** outline uniforms shared by every hull: width in px at 900 px of drawing-buffer height, the viewport, a master switch */
export const OUTLINE = {
  uOutlinePx: { value: 2.4 },
  uViewport: { value: new THREE.Vector2(1600, 900) },
  uOutlineOn: { value: 1.0 },
  /** px at a 900-px-tall drawing buffer; scaled with the buffer height by setOutlineViewport */
  basePx: 2.4,
};

/** call on resize with the drawing-buffer size (px) */
export function setOutlineViewport(w: number, h: number): void {
  OUTLINE.uViewport.value.set(Math.max(1, w), Math.max(1, h));
  OUTLINE.uOutlinePx.value = Math.max(1.0, OUTLINE.basePx * (h / 900));
}

// ─────────────────────────────────────────── the cel material ───────────────────────────────────────────

export interface ToonUniforms {
  uDetailBias: { value: number };
  uSat: { value: number };
  uValue: { value: number };
  uHue: { value: number };
  uRim: { value: number };
  uRimColor: { value: THREE.Color };
  uFlash: { value: number };
  uFlashColor: { value: THREE.Color };
  uGlow: { value: number };
  uGlowColor: { value: THREE.Color };
}

const FRAG_HEAD = /* glsl */`
uniform float uDetailBias; uniform float uSat; uniform float uValue; uniform float uHue;
uniform float uRim; uniform vec3 uRimColor;
uniform float uFlash; uniform vec3 uFlashColor;
uniform float uGlow; uniform vec3 uGlowColor;
vec3 hpHueRotate( vec3 c, float a ) {
  // rotation about the grey axis (Rodrigues), keeps luminance roughly
  const vec3 k = vec3( 0.57735 );
  float ca = cos( a ), sa = sin( a );
  return c * ca + cross( k, c ) * sa + k * dot( k, c ) * ( 1.0 - ca );
}
float hpSkin( vec3 c ) {
  // skin band by HSV: hue 0..50 deg (a little past red either side), saturation 0.08..0.8; 1 = skin (left alone)
  float mx = max( c.r, max( c.g, c.b ) ), mn = min( c.r, min( c.g, c.b ) );
  float d = mx - mn;
  float sat = mx > 1e-4 ? d / mx : 0.0;
  float h = 0.0;
  if ( d > 1e-5 ) {
    if ( mx == c.r ) h = mod( ( c.g - c.b ) / d, 6.0 );
    else if ( mx == c.g ) h = ( c.b - c.r ) / d + 2.0;
    else h = ( c.r - c.g ) / d + 4.0;
    h /= 6.0;
  }
  float hd = min( abs( h - 0.07 ), abs( h - 1.07 ) );         // distance from ~25 deg, wrapping at red
  float hueOk = 1.0 - smoothstep( 0.08, 0.13, hd );
  float satOk = smoothstep( 0.05, 0.1, sat ) * ( 1.0 - smoothstep( 0.8, 0.9, sat ) );
  return hueOk * satOk;
}
`;

const MAP_FRAG = /* glsl */`
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv, uDetailBias );
  vec3 hpC = sampledDiffuseColor.rgb;
  if ( uHue != 0.0 ) hpC = mix( hpHueRotate( hpC, uHue ), hpC, hpSkin( hpC ) );
  float hpL = dot( hpC, vec3( 0.2126, 0.7152, 0.0722 ) );
  hpC = max( mix( vec3( hpL ), hpC, uSat ) * uValue, 0.0 );
  diffuseColor *= vec4( hpC, sampledDiffuseColor.a );
#else
  if ( uHue != 0.0 ) diffuseColor.rgb = hpHueRotate( diffuseColor.rgb, uHue );
#endif
`;

const RIM_FRAG = /* glsl */`
#include <lights_fragment_end>
  vec3 hpView = normalize( vViewPosition );
  float hpNdV = max( dot( normal, hpView ), 0.0 );
  float hpRimMask = smoothstep( 0.60, 0.68, 1.0 - hpNdV );
  // stronger on the upper / camera-far side: a key-from-above cel rim
  float hpRimDir = clamp( 0.55 + 0.6 * normal.y, 0.0, 1.0 );
  reflectedLight.directDiffuse += uRimColor * ( uRim * hpRimMask * hpRimDir ) * ( 0.35 + 0.65 * diffuseColor.rgb );
`;

const OUT_FRAG = /* glsl */`
  outgoingLight += uGlowColor * uGlow * ( 0.35 + 0.65 * hpRimMask );
  outgoingLight = mix( outgoingLight, uFlashColor, clamp( uFlash, 0.0, 1.0 ) );
#include <opaque_fragment>
`;

function patchToon(shader: THREE.WebGLProgramParametersWithUniforms, u: ToonUniforms): void {
  Object.assign(shader.uniforms, u);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
    .replace('#include <map_fragment>', MAP_FRAG)
    .replace('#include <lights_fragment_end>', RIM_FRAG)
    .replace('#include <opaque_fragment>', OUT_FRAG);
}

export type ToonMaterial = THREE.MeshToonMaterial & { userData: { hp: ToonUniforms; cutout: boolean } };

function isCutout(src: THREE.Material): boolean {
  const name = src.name || '';
  if (/_cutout$/i.test(name)) return true;
  if (/hair|lash|brow|moustache|beard/i.test(name) && (src.transparent || src.alphaTest > 0)) return true;
  return src.alphaTest > 0 || (src.transparent && !!(src as THREE.MeshStandardMaterial).map);
}

/** Build the toon replacement for one source (glTF) material. */
export function makeToonMaterial(src: THREE.Material, prof: ToonProfile, hueShift = 0): ToonMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const cut = isCutout(src);
  const m = new THREE.MeshToonMaterial({
    name: 'toon:' + (src.name || 'mat'),
    color: s.color ? s.color.clone() : new THREE.Color(1, 1, 1),
    map: s.map ?? null,
    gradientMap: toonRamp(),
    side: cut ? THREE.DoubleSide : THREE.FrontSide,
    transparent: false,
    alphaTest: cut ? 0.5 : 0,
    depthWrite: true,
  }) as ToonMaterial;
  if (m.map) m.map.anisotropy = Math.max(m.map.anisotropy, 4);
  const u: ToonUniforms = {
    uDetailBias: { value: prof.detailBias },
    uSat: { value: prof.saturation },
    uValue: { value: prof.value },
    uHue: { value: hueShift },
    uRim: { value: prof.rim },
    uRimColor: { value: new THREE.Color(1.0, 0.93, 0.82) },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uGlow: { value: 0 },
    uGlowColor: { value: new THREE.Color(1.0, 0.35, 0.08) },
  };
  m.userData = { hp: u, cutout: cut };
  m.onBeforeCompile = (shader) => patchToon(shader, u);
  m.customProgramCacheKey = () => 'hp-toon-1';
  return m;
}

// ─────────────────────────────────────────── the outline hull ───────────────────────────────────────────

const HULL_VERT_HEAD = /* glsl */`
attribute vec3 hpOutlineNormal;
uniform float uOutlinePx; uniform vec2 uViewport; uniform float uOutlineOn;
`;
const HULL_BEGIN_NORMAL = /* glsl */`
vec3 objectNormal = vec3( hpOutlineNormal );
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`;
const HULL_PROJECT = /* glsl */`
#include <project_vertex>
{
#ifdef USE_SKINNING
  vec3 hpN = objectNormal;
#else
  vec3 hpN = hpOutlineNormal;
#endif
  vec3 hpNV = normalize( normalMatrix * hpN );
  vec4 hpNC = projectionMatrix * vec4( hpNV, 0.0 );
  vec2 hpPx = hpNC.xy * uViewport;
  float hpLen = length( hpPx );
  vec2 hpDir = hpLen > 1e-6 ? hpPx / hpLen : vec2( 0.0 );
  gl_Position.xy += hpDir * ( uOutlinePx * uOutlineOn ) * 2.0 / uViewport * gl_Position.w;
}
`;

function makeHullMaterial(color: THREE.Color, cutoutFrom: ToonMaterial | null): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    name: 'toon-outline',
    color,
    side: THREE.BackSide,
    map: cutoutFrom?.map ?? null,
    alphaTest: cutoutFrom ? 0.5 : 0,
    fog: true,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uOutlinePx: OUTLINE.uOutlinePx, uViewport: OUTLINE.uViewport, uOutlineOn: OUTLINE.uOutlineOn });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + HULL_VERT_HEAD)
      .replace('#include <beginnormal_vertex>', HULL_BEGIN_NORMAL)
      .replace('#include <project_vertex>', HULL_PROJECT);
  };
  m.customProgramCacheKey = () => 'hp-outline-1';
  return m;
}

/** Smoothed normals (averaged over vertices sharing a position) so hard edges do not split the hull. Cached per geometry. */
export function ensureOutlineNormals(g: THREE.BufferGeometry): void {
  if (g.getAttribute('hpOutlineNormal')) return;
  const pos = g.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!pos) return;
  const n = pos.count;
  const out = new Float32Array(n * 3);
  if (!nor) {
    g.setAttribute('hpOutlineNormal', new THREE.BufferAttribute(out, 3));
    return;
  }
  // quantise positions to ~0.1 mm (in the geometry's own units) for the weld key
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z, 1e-6);
  const q = 2e5 / span;
  const acc = new Map<string, number[]>();
  const keys: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * q) + ',' + Math.round(pos.getY(i) * q) + ',' + Math.round(pos.getZ(i) * q);
    keys[i] = k;
    let a = acc.get(k);
    if (!a) { a = [0, 0, 0]; acc.set(k, a); }
    a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
  }
  for (let i = 0; i < n; i++) {
    const a = acc.get(keys[i])!;
    let x = a[0], y = a[1], z = a[2];
    let l = Math.hypot(x, y, z);
    if (l < 1e-8) { x = nor.getX(i); y = nor.getY(i); z = nor.getZ(i); l = Math.hypot(x, y, z) || 1; }
    out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  g.setAttribute('hpOutlineNormal', new THREE.BufferAttribute(out, 3));
}

// ─────────────────────────────────────────── apply to a fighter ───────────────────────────────────────────

export interface ToonHandle {
  materials: ToonMaterial[];
  hulls: THREE.Mesh[];
  /** 0..1 whole-body flash toward `color` */
  setFlash(amount: number, color?: THREE.ColorRepresentation): void;
  /** 0..1 emissive glow (IMPACT armour) */
  setGlow(amount: number, color?: THREE.ColorRepresentation): void;
  setOutline(on: boolean): void;
  setHue(rad: number): void;
  dispose(): void;
}

export interface ToonOptions {
  profile: ToonProfile;
  hueShift?: number;
  outline?: boolean;
  outlineColor?: THREE.ColorRepresentation;
  /** mesh-name test for meshes that get no hull (eyes, lashes: tiny, noisy outlines) */
  noHull?: RegExp;
  castShadow?: boolean;
}

/** Replace every mesh material under `root` by a toon material and add outline hulls to skinned meshes. */
export function toonify(root: THREE.Object3D, o: ToonOptions): ToonHandle {
  const mats: ToonMaterial[] = [];
  const hulls: THREE.Mesh[] = [];
  const noHull = o.noHull ?? /eye|lash|teeth|tongue/i;
  const lineColor = new THREE.Color(o.outlineColor ?? 0x120c16);
  const cache = new Map<THREE.Material, ToonMaterial>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((ob) => { if ((ob as THREE.Mesh).isMesh && !ob.userData.hpHull) meshes.push(ob as THREE.Mesh); });
  for (const mesh of meshes) {
    const conv = (m: THREE.Material): ToonMaterial => {
      let t = cache.get(m);
      if (!t) { t = makeToonMaterial(m, o.profile, o.hueShift ?? 0); cache.set(m, t); mats.push(t); }
      return t;
    };
    const srcMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const newMats = srcMats.map(conv);
    mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0];
    mesh.castShadow = o.castShadow !== false;
    mesh.receiveShadow = false;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;   // E38: bind-pose bounds lie
    if (o.outline === false || noHull.test(mesh.name) || !mesh.parent) continue;
    ensureOutlineNormals(mesh.geometry);
    const cutFrom = newMats.find((m) => m.userData.cutout) ?? null;
    const hullMats = newMats.map((m) => makeHullMaterial(lineColor, m.userData.cutout ? m : (cutFrom && newMats.length === 1 ? cutFrom : null)));
    let hull: THREE.Mesh;
    const sk = mesh as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      const h = new THREE.SkinnedMesh(sk.geometry, hullMats.length > 1 ? hullMats : hullMats[0]);
      h.bindMode = sk.bindMode;
      h.bind(sk.skeleton, sk.bindMatrix);
      hull = h;
    } else {
      hull = new THREE.Mesh(mesh.geometry, hullMats.length > 1 ? hullMats : hullMats[0]);
    }
    hull.name = mesh.name + '_hull';
    hull.userData.hpHull = true;
    hull.position.copy(mesh.position);
    hull.quaternion.copy(mesh.quaternion);
    hull.scale.copy(mesh.scale);
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.frustumCulled = false;
    hull.renderOrder = mesh.renderOrder;
    mesh.parent.add(hull);
    hulls.push(hull);
  }
  const tmp = new THREE.Color();
  return {
    materials: mats,
    hulls,
    setFlash(a, c) {
      if (c !== undefined) tmp.set(c);
      for (const m of mats) { m.userData.hp.uFlash.value = a; if (c !== undefined) m.userData.hp.uFlashColor.value.copy(tmp); }
    },
    setGlow(a, c) {
      if (c !== undefined) tmp.set(c);
      for (const m of mats) { m.userData.hp.uGlow.value = a; if (c !== undefined) m.userData.hp.uGlowColor.value.copy(tmp); }
    },
    setOutline(on) { for (const h of hulls) h.visible = on; },
    setHue(rad) { for (const m of mats) m.userData.hp.uHue.value = rad; },
    dispose() {
      for (const m of mats) m.dispose();
      for (const h of hulls) {
        const hm = h.material;
        (Array.isArray(hm) ? hm : [hm]).forEach((x) => x.dispose());
        h.removeFromParent();
      }
    },
  };
}

/** hue shift (radians) for a colour alternate `tint` ("#rrggbb" or null); 0 = the original costume */
export function hueForTint(tint: string | null | undefined): number {
  if (!tint) return 0;
  const c = new THREE.Color();
  try { c.set(tint); } catch { return 0; }
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.h * Math.PI * 2;
}
