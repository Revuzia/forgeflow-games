// VALE render — the shared world shading chunk (STYLE_BIBLE "Look rules", tokens.json `grade`).
//
// Every WORLD material (terrain, cliffs, scatter, map-scene GLB materials, units) is patched once
// with onBeforeCompile so it reads the same uniforms:
//   * fog of war: the local team's vision grid (R8, smoothed over time by fog.ts) — outside vision
//     value ×0.55, saturation ×0.4 and a 15 % shift toward the fog tint #2A3140, with a crisp edge.
//     Identical on every quality tier (it is competitive information).
//     ×0.55 is what the DISPLAY shows (tokens grade.fogOfWar.valueMul; env F3). The fog is applied here, in the linear
//     HDR working space, but the post chain then tone-maps (Khronos PBR Neutral, whose toe is quadratic below 0.08) and
//     grades (the map's LUT), so no constant linear factor lands on ×0.55: the old ×0.268 (0.55^2.2) displayed
//     ×0.21-0.32. valeFogShade() solves the factor per fragment instead: the lit colour's display luma through a mirror
//     of the post chain's tone map, sRGB and the LUT's grey-axis response (valeFogGrade, setFogGrade() from post.ts
//     whenever the LUT changes), × 0.55, back through the inverse grade, then the Neutral toe solved exactly for the
//     scale of the desaturated, tinted colour. Every patched material (ground, walls, scatter, landmarks, the cart,
//     ambient props, units) and the ambient particles run that one function; a material may set its own display
//     multiplier for unseen ground through `valeFogLocal` (the gorge drop ×0.75, the Standing Shadow ×0.9).
//   * map-edge haze: outside the playable bounds only (world space, NEVER camera distance — the
//     bible bans camera-distance fog), fading to the map's fog colour.
// FIGHTER materials replace the sun's direction with their own key (view-space azimuth 225°, elevation
// 45°, `valeCharKey` × the sun's colour and intensity), so every fighter reads the same on every map, and
// take a shadow floor (the sun's shadow removes at most 25 % of the key: ≥ 75 % brightness in shadow, bible
// `shadow = mix(1.0, s, 0.25)`).
//
// THE CHARACTER LIGHT (r12 B5 round 2, tokens `grade.fighterLight.rig`; lighting.ts sets it per map): the
// environment was rebased down, so characters carry their own light instead of the world getting brighter.
// It is a shading term, not a three.js light: no extra light in any program's key, no shadow map, a few ALU
// on character fragments only, the world's pixels untouched. Both parts follow the camera (view space):
//   * the noon crown: a Fresnel rim on the silhouette weighted to its top and back (the side above and away
//     from the camera), so a character's upper outline lifts off the ground under it. Its albedo carries a
//     value floor (hue kept), so a dark kit's edge reads as well as a pale one's;
//   * the eye fill: a soft fill from the camera that lifts the mid-tones the key leaves in its shadow side.
// A knee fades both out where the world's own light (key, sky, specular) already lights the surface brightly, so
// pale kits never blow out. Fighters take all of it; wicks and monsters (`unit`) keep the sun as their key and
// take only a share of the crown, on their darker cloth. Jungle monsters (`monster`) take the world's light and show
// their own glow at their own share (`valeCharMonster`, lighting.ts CHAR_LIGHT.monsterLight), so their pale hides
// sit at or just below the fighters' top-25 L* (characters own the top of the value range; a camp never outshines
// the fighters fighting in it).
//
// Overlay materials (bars, rings, telegraphs) and VFX are NOT patched: they draw after the grade.

import {
  ClampToEdgeWrapping, Color, DataTexture, DataUtils, HalfFloatType, LinearFilter, type Material, NoBlending, NormalBlending, RGBAFormat,
  ShaderChunk, Texture, Vector2, Vector3, Vector4, type WebGLProgramParametersWithUniforms,
} from 'three';

/** knots of the grade response table (valeFogGrade): the LUT's own grid (33³) */
const GRADE_KNOTS = 33;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** the grade's grey-axis response, 33 × 1 RGBA half float: rgb = the LUT's output per channel at grey input i / 32
 *  (display in → display out); a = the inverse of its grey display luma (display luma i / 32 → the grey input giving
 *  it). Identity until setFogGrade() sees the map's LUT. */
const fogGrade = (() => {
  const t = new DataTexture(new Uint16Array(GRADE_KNOTS * 4), GRADE_KNOTS, 1, RGBAFormat, HalfFloatType);
  t.magFilter = LinearFilter; t.minFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.name = 'vale_fog_grade';
  return t;
})();

/**
 * env F3: calibrate the fog of war against the grade the post chain applies (post.ts calls it whenever its LUT
 * changes; null = the identity LUT). Reads the LUT's grey diagonal (the nodes a tetrahedral lookup interpolates
 * between on that axis), per channel, and inverts its grey display luma, into valeFogGrade.
 */
export function setFogGrade(lut: Texture | null): void {
  const N = GRADE_KNOTS;
  const img = (lut?.image ?? null) as { data?: ArrayLike<number>; width?: number; height?: number; depth?: number } | null;
  const n = img?.width ?? 0;
  const data = img?.data;
  const lutDomain = lut as (Texture & { domainMin?: Vector3; domainMax?: Vector3 }) | null;
  const ok = !!data && n >= 2 && img?.height === n && (img?.depth ?? n) === n && data.length >= n * n * n * 3;
  const ch = ok ? Math.round(data.length / (n * n * n)) : 4;
  const scale = ok && data instanceof Uint8Array ? 1 / 255 : 1;
  const dMin = lutDomain?.domainMin?.x ?? 0, dMax = lutDomain?.domainMax?.x ?? 1;
  /** the LUT's output channel c at grey input v (display, 0-1) */
  const grey = (v: number, c: number): number => {
    if (!ok) return v;
    const u = Math.min(1, Math.max(0, (v - dMin) / Math.max(1e-6, dMax - dMin))) * (n - 1);
    const i = Math.min(n - 2, Math.floor(u)), f = u - i;
    const at = (k: number): number => Number(data[((k * n + k) * n + k) * ch + c]) * scale;
    return at(i) * (1 - f) + at(i + 1) * f;
  };
  const lumaAt = (v: number): number => LUMA[0] * grey(v, 0) + LUMA[1] * grey(v, 1) + LUMA[2] * grey(v, 2);
  // the forward grey display luma on a fine grid, inverted by a monotone walk (a LUT is monotone on its grey axis;
  // any flat or folded stretch is skipped, so the inverse never steps back)
  const FINE = 1024;
  const xs: number[] = [], ys: number[] = [];
  for (let k = 0; k <= FINE; k++) {
    const v = k / FINE, y = lumaAt(v);
    if (!ys.length || y > ys[ys.length - 1] + 1e-7) { xs.push(v); ys.push(y); }
  }
  const inv = (d: number): number => {
    if (d <= ys[0]) return xs[0] * (ys[0] > 0 ? d / ys[0] : 0);
    if (d >= ys[ys.length - 1]) return xs[xs.length - 1];
    let lo = 0, hi = ys.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ys[m] <= d) lo = m; else hi = m; }
    return xs[lo] + ((d - ys[lo]) / (ys[hi] - ys[lo])) * (xs[hi] - xs[lo]);
  };
  const out = fogGrade.image.data as Uint16Array;
  for (let i = 0; i < N; i++) {
    const v = i / (N - 1);
    out[i * 4] = DataUtils.toHalfFloat(grey(v, 0));
    out[i * 4 + 1] = DataUtils.toHalfFloat(grey(v, 1));
    out[i * 4 + 2] = DataUtils.toHalfFloat(grey(v, 2));
    out[i * 4 + 3] = DataUtils.toHalfFloat(inv(v));
  }
  fogGrade.needsUpdate = true;
}
setFogGrade(null);

/** uniforms shared (by reference) by every patched material */
export const worldUniforms = {
  valeFogTex: { value: new Texture() as Texture | DataTexture },
  valeFogScale: { value: new Vector2(0.01, 0.01) },   // 1 / grid extent in metres
  valeFogTexel: { value: new Vector2(0.02, 0.02) },   // one grid cell in uv
  valeFogOn: { value: 0 },
  valeFogTint: { value: new Color().setStyle('#2A3140') },
  // env F3: the display value multiplier for unseen ground (tokens grade.fogOfWar.valueMul) and the grade response
  // the fog solves against (setFogGrade)
  valeFogValue: { value: 0.55 },
  valeFogGrade: { value: fogGrade as Texture },
  valeBounds: { value: new Vector4(0, 0, 100, 100) }, // minX, minZ, maxX, maxZ (playable)
  valeEdgeColor: { value: new Color().setStyle('#8E9AA6') },
  valeEdgeRange: { value: new Vector2(4, 18) },       // haze starts / is full this far outside the bounds
  valeEdgeOn: { value: 1 },
  valeTime: { value: 0 },
  // the fighter key (view space) and its share of the sun
  valeKeyDir: { value: new Vector3(-0.5, 0.7071, 0.5).normalize() },
  valeCharKey: { value: 0.9 },
  // the character light (lighting.ts CHAR_LIGHT): crown direction (view space), crown radiance (rgb, linear) and
  // Fresnel power (a), eye-fill radiance, and x = the crown's albedo value floor, y = the wick/monster share,
  // zw = the knee (linear luminance of the world's light on the surface where the character light starts / ends fading)
  valeCharRimDir: { value: new Vector3(0, 0.8, -0.6).normalize() },
  valeCharRim: { value: new Vector4(0, 0, 0, 3) },
  valeCharFill: { value: new Color(0, 0, 0) },
  valeCharShape: { value: new Vector4(0.3, 0.35, 0.25, 0.75) },
  // a jungle monster's share of the world's light and of its own glow (wicks keep 1)
  valeCharMonster: { value: 1 },
};

/** GLSL: the fog-of-war + edge haze functions (shared with custom ShaderMaterials) */
export const WORLD_FOG_PARS = /* glsl */`
uniform sampler2D valeFogTex;
uniform vec2 valeFogScale;
uniform vec2 valeFogTexel;
uniform float valeFogOn;
uniform vec3 valeFogTint;
uniform float valeFogValue;
uniform sampler2D valeFogGrade;
uniform vec4 valeBounds;
uniform vec3 valeEdgeColor;
uniform vec2 valeEdgeRange;
uniform float valeEdgeOn;
// a material's own display multiplier for its unseen fragments (>= 0 replaces valeFogValue; set before the fog runs)
float valeFogLocal = -1.0;
float valeVision( vec2 xz ) {
  if ( valeFogOn < 0.5 ) return 1.0;
  vec2 uv = xz * valeFogScale;
  vec2 o = valeFogTexel * 0.45;
  float v = texture( valeFogTex, uv ).r * 0.36
    + ( texture( valeFogTex, uv + vec2( o.x, o.y ) ).r + texture( valeFogTex, uv + vec2( -o.x, o.y ) ).r
      + texture( valeFogTex, uv + vec2( o.x, -o.y ) ).r + texture( valeFogTex, uv + vec2( -o.x, -o.y ) ).r ) * 0.16;
  // crisp, but not blocky: the grid is 2 m; the edge resolves over ~0.6 m
  return smoothstep( 0.38, 0.62, v );
}
// the post chain's tone map (post.ts: ToneMappingEffect NEUTRAL, Khronos PBR Neutral, exposure 1), mirrored
vec3 valeToneNeutral( vec3 c ) {
  float x = min( c.r, min( c.g, c.b ) );
  c -= x < 0.08 ? x - 6.25 * x * x : 0.04;
  float peak = max( c.r, max( c.g, c.b ) );
  if ( peak < 0.76 ) return c;
  float np = 1.0 - 0.0576 / ( peak - 0.52 );
  c *= np / peak;
  return mix( c, vec3( np ), 1.0 - 1.0 / ( 0.15 * ( peak - np ) + 1.0 ) );
}
vec4 valeGradeAt( float e ) { return texture( valeFogGrade, vec2( clamp( e, 0.0, 1.0 ) * ( 32.0 / 33.0 ) + 0.5 / 33.0, 0.5 ) ); }
// the scale k with tone-mapped luma( ( 1 - ta ) k g + ta tint ) = Lf, (gj, tj) the darkest channel: below the Neutral's
// compression the tone map subtracts that channel's toe offset (x - 6.25 x^2 under 0.08, else 0.04) from every
// channel, so the luma is a quadratic in k (a linear one above the toe)
float valeFogSolve( float lum, float gj, float tj, float ta, float lt, float Lf ) {
  float A = ( 1.0 - ta ) * gj, B = ta * tj;
  float a = 6.25 * A * A, b = ( 1.0 - ta ) * lum - A + 12.5 * A * B, c0 = lt - B + 6.25 * B * B - Lf;
  float kt = a > 1e-10 ? ( -b + sqrt( max( b * b - 4.0 * a * c0, 0.0 ) ) ) / ( 2.0 * a ) : -c0 / max( b, 1e-8 );
  float kl = ( Lf - lt + 0.04 ) / max( ( 1.0 - ta ) * lum, 1e-8 );
  return A * kt + B < 0.08 ? kt : kl;
}
// the unseen colour of a lit linear colour c: saturation x sat, ta of the way toward the fog tint, its scale solved so
// the DISPLAY luma (after tone map, sRGB and the grade) is mul x the lit one's (env F3; the header)
vec3 valeFogShade( vec3 c, float mul, float sat, float ta ) {
  const vec3 W = vec3( 0.2126, 0.7152, 0.0722 );
  c = max( c, vec3( 0.0 ) );
  float lum = dot( c, W );
  vec3 g = mix( vec3( lum ), c, sat );
  vec3 t = clamp( valeToneNeutral( c ), 0.0, 1.0 );
  vec3 e = mix( t * 12.92, 1.055 * pow( t, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, t ) );
  float dC = dot( vec3( valeGradeAt( e.r ).r, valeGradeAt( e.g ).g, valeGradeAt( e.b ).b ), W );
  float ef = valeGradeAt( mul * dC ).a;
  float Lf = ef <= 0.04045 ? ef / 12.92 : pow( ( ef + 0.055 ) / 1.055, 2.4 );
  float lt = ta * dot( valeFogTint, W );
  // the darkest channel: the lit colour's first, then the tinted result's own (the tint is bluest, it can reorder them)
  int j = c.r <= c.g && c.r <= c.b ? 0 : ( c.g <= c.b ? 1 : 2 );
  float k = valeFogSolve( lum, g[ j ], valeFogTint[ j ], ta, lt, Lf );
  vec3 h = ( 1.0 - ta ) * max( k, 0.0 ) * g + ta * valeFogTint;
  int j2 = h.r <= h.g && h.r <= h.b ? 0 : ( h.g <= h.b ? 1 : 2 );
  if ( j2 != j ) k = valeFogSolve( lum, g[ j2 ], valeFogTint[ j2 ], ta, lt, Lf );
  // never brighter than lit
  return ( 1.0 - ta ) * clamp( k, 0.0, 1.0 ) * g + ta * valeFogTint;
}
vec3 valeApplyWorldFog( vec3 c, vec3 wp ) {
  float vis = valeVision( wp.xz );
  if ( vis < 0.999 ) {
    float mul = valeFogLocal >= 0.0 ? valeFogLocal : valeFogValue;
    #ifdef VALE_KEEP_COLOR
    vec3 fogged = valeFogShade( c, mul, 1.0, 0.0 );
    #else
    // saturation x0.4, 15 % toward the fog tint (absolute, so the darkest stone keeps a readable floor)
    vec3 fogged = valeFogShade( c, mul, 0.4, 0.15 );
    #endif
    c = mix( fogged, c, vis );
  }
  if ( valeEdgeOn > 0.5 ) {
    vec2 d2 = max( valeBounds.xy - wp.xz, wp.xz - valeBounds.zw );
    float d = max( max( d2.x, d2.y ), 0.0 );
    float f = smoothstep( valeEdgeRange.x, valeEdgeRange.y, d );
    c = mix( c, valeEdgeColor, f );
  }
  return c;
}
`;

const VERT_PARS = /* glsl */`
varying vec3 vValeWorld;
`;
const VERT_MAIN = /* glsl */`
{
  vec4 valeWP = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    valeWP = batchingMatrix * valeWP;
  #endif
  #ifdef USE_INSTANCING
    valeWP = instanceMatrix * valeWP;
  #endif
  valeWP = modelMatrix * valeWP;
  vValeWorld = valeWP.xyz;
}
`;

const CHAR_PARS = /* glsl */`
uniform float valeCharMode;
uniform vec3 valeKeyDir;
uniform float valeCharKey;
uniform vec3 valeCharRimDir;
uniform vec4 valeCharRim;
uniform vec3 valeCharFill;
uniform vec4 valeCharShape;
uniform float valeCharMonster;
`;
/** after the material's lights (direct and sky): the character light (noon crown + eye fill), see the header */
const CHAR_LIGHT = /* glsl */`
#if defined( RE_Direct )
{
  float valeNdV = saturate( dot( geometryNormal, geometryViewDir ) );
  float valeUp = saturate( dot( geometryNormal, valeCharRimDir ) * 0.5 + 0.5 );
  float valeRim = pow( 1.0 - valeNdV, valeCharRim.a ) * valeUp * valeUp;
  float valeLa = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 valeAlb = min( diffuseColor.rgb * ( max( valeLa, valeCharShape.x ) / max( valeLa, 0.02 ) ), vec3( 1.0 ) );
  vec3 valeAdd;
  if ( valeCharMode < 1.5 ) {
    // wicks and monsters keep the sun as their key: a share of the crown, on their darker cloth only (a pale hood takes none)
    valeAdd = valeCharShape.y * ( 1.0 - smoothstep( 0.05, 0.16, valeLa ) ) * valeCharRim.rgb * valeRim * valeAlb;
  } else {
    valeAdd = valeCharRim.rgb * valeRim * valeAlb + valeCharFill * ( 0.4 + 0.6 * valeNdV ) * material.diffuseColor;
  }
  // the knee: the character light fades where the world's light (key, sky, specular) already lights the surface
  // brightly, so a pale kit never blows out and the lift goes to the mid-tones and the shadow side
  float valeLit = dot( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( 0.2126, 0.7152, 0.0722 ) );
  reflectedLight.directDiffuse += valeAdd * ( 1.0 - smoothstep( valeCharShape.z, valeCharShape.w, valeLit ) );
  // a jungle monster takes the world's light (sun, sky, its crown share) and shows its own glow (a gloamoth's wing,
  // a glasshorn's dawnglass) at its own share: its whole value scales, its painted contrast kept
  if ( valeCharMode > 1.1 && valeCharMode < 1.5 ) {
    reflectedLight.directDiffuse *= valeCharMonster; reflectedLight.indirectDiffuse *= valeCharMonster;
    reflectedLight.directSpecular *= valeCharMonster; reflectedLight.indirectSpecular *= valeCharMonster;
    totalEmissiveRadiance *= valeCharMonster;
  }
}
#endif
`;

export interface WorldPatchOptions {
  /** fog of war + edge haze (default true) */
  fog?: boolean;
  /** fighter shading: own key light, shadow floor, the character light */
  fighter?: boolean;
  /** wick / monster shading: the sun stays the key; a share of the character light (`valeCharShape.y`) */
  unit?: boolean;
  /** a jungle monster: unit shading, the world's light and its glow at the monster's share (`valeCharMonster`);
   *  implies `unit` */
  monster?: boolean;
  /** fog of war darkens but does not desaturate (the Standing Shadow keeps its colour) */
  keepColor?: boolean;
}

const PATCHED = Symbol('valePatched');

/** the fighter key light and its shadow floor, applied where valeCharMode says fighter (2); a wick (1) or a jungle
 *  monster (1.25) keeps the sun exactly (× 1.0; the monster's share of the world's light applies in CHAR_LIGHT) */
const CHAR_LIGHTS_BEGIN = ShaderChunk.lights_fragment_begin
  .split('getDirectionalLightInfo( directionalLight, directLight );')
  .join('getDirectionalLightInfo( directionalLight, directLight );\n\t\tif ( valeCharMode > 1.5 ) { directLight.direction = normalize( valeKeyDir ); directLight.color *= valeCharKey; }')
  .split('directionalLightShadow.shadowIntensity').join('( directionalLightShadow.shadowIntensity * ( valeCharMode > 1.5 ? 0.25 : 1.0 ) )');

/**
 * r12 B4 programs: a material that can turn see-through (the veils, actors.ts; the structure fade, structures.ts) draws
 * opaque WITHOUT three's OPAQUE define: NoBlending (no blend, the alpha written as is: nothing downstream reads the
 * scene's alpha), so its see-through state (veilOn: NormalBlending, transparent, both sides in one pass over the depth
 * prepass) keys the very same program. Only opaque, normally blended materials change.
 */
export function opaqueVeilable(m: Material): void {
  if (!m.transparent && m.blending === NormalBlending) m.blending = NoBlending;
}
/** see-through at `opacity` (a material opaqueVeilable made: one pass for both sides, the same program) */
export function veilOn(m: Material, opacity: number, depthWrite: boolean): void {
  if (m.blending === NoBlending) { m.blending = NormalBlending; m.forceSinglePass = true; }
  m.transparent = true; m.opacity = opacity; m.depthWrite = depthWrite;
}
/** back to opaque */
export function veilOff(m: Material): void {
  if (m.forceSinglePass && m.blending === NormalBlending) m.blending = NoBlending;
  m.transparent = false; m.opacity = 1; m.depthWrite = true;
}

/** Patch a material in place (idempotent). Keeps any existing onBeforeCompile. */
export function patchWorldMaterial(material: Material, opts: WorldPatchOptions = {}): void {
  const m = material as Material & { [PATCHED]?: string };
  const fog = opts.fog !== false;
  const fighter = opts.fighter === true;
  const unit = !fighter && (opts.unit === true || opts.monster === true);
  const monster = unit && opts.monster === true;
  const keep = opts.keepColor === true;
  const key = `${fog ? 'f' : ''}${fighter ? 'k' : ''}${unit ? 'u' : ''}${monster ? 'm' : ''}${keep ? 'c' : ''}`;
  if (m[PATCHED] === key) return;
  m[PATCHED] = key;
  if (!fog && !fighter && !unit) return;
  // fighters and wicks / monsters share one program: which light they take is a uniform (r12 B4 programs)
  const charMode = { value: fighter ? 2 : monster ? 1.25 : unit ? 1 : 0 };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, worldUniforms);
    shader.uniforms.valeCharMode = charMode;
    if (fog) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${keep ? '#define VALE_KEEP_COLOR\n' : ''}varying vec3 vValeWorld;\n${WORLD_FOG_PARS}`)
        .replace('#include <opaque_fragment>', `outgoingLight = valeApplyWorldFog( outgoingLight, vValeWorld );\n#include <opaque_fragment>`);
    }
    if (fighter || unit) {
      // a fighter's one directional light (the sun) becomes its view-space key at valeCharKey × its colour, its shadow
      // keeping ≥ 75 % of the key; wicks and monsters keep the sun (CHAR_LIGHTS_BEGIN). Both take the character light.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${CHAR_PARS}`)
        .replace('#include <lights_fragment_begin>', CHAR_LIGHTS_BEGIN)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${CHAR_LIGHT}`);
    }
  };
  const prevKey = material.customProgramCacheKey;
  const progKey = `${fog ? 'f' : ''}${fighter || unit ? 'x' : ''}${keep ? 'c' : ''}`;
  material.customProgramCacheKey = () => `${prevKey.call(material)}|vale:${progKey}`;
  material.needsUpdate = true;
}
