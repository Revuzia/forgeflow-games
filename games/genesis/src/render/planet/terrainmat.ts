// GENESIS — the terrain material (CONTRACT.md §15.4): MeshStandardMaterial + onBeforeCompile.
//
// Vertex: displacement and geomorph from the field textures (terrainvert.glsl.ts); the per-cell normal plus the baked
// detail gradient gives the shading normal; the cell fields are interpolated into varyings.
//
// Fragment — LAYERED procedural PBR, evaluated in the planet body frame in metres (3D noise needs no UVs; patterns
// with an orientation — strata, rows, ripples — are built from body-frame planes, i.e. triplanar-free projections):
//   rock (height strata, Voronoi cracks, grain, lichen) · regolith · soil · grass (moisture / temperature / season) ·
//   dry grass · shrubs · forest canopy (Voronoi crowns with height bump and crown-gap occlusion, conifer vs broadleaf
//   by climate, autumn colour) · farm fields where crop > 0 (per-field crop, rows, hedgerows) · sand with ripples ·
//   snow with sparkle · ice · ash · mud / wetness (darker, glossier) · lava crust with emissive cracks · burnt ground ·
//   worn paths (trodden dirt; paved roads are ribbon meshes) · beaches · rock on ridges and peaks · sea floor with
//   filament caustics · close-up micro relief from analytic noise gradients · night city lights (`light` channel).
// Every high-frequency term fades by the pixel footprint (no shimmer from orbit).
//
// Lighting: three's physical BRDF, but the star is injected per planet (IncidentLight with this planet's sun
// direction, coloured by the atmosphere's transmittance LUT at the fragment, × cascaded shadow × cloud shadow) and
// ambient is the sky's SH irradiance + sky-LUT reflections — so sunsets redden the ground, the night side is dark,
// and every planet in a system view is lit from its own side.

import {
  Matrix3, Matrix4, MeshStandardMaterial, ShaderMaterial, Vector2, Vector3, Vector4, Color, type IUniform, type Texture,
} from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { SHADOW_GLSL } from './lights.ts';
import { TERRAIN_VERT_CORE, TERRAIN_VERT_PARS } from './terrainvert.glsl.ts';
import { GROUND_FRAG_PARS, GROUND_UNIFORMS, GROUND_VERT_MAIN, GROUND_VERT_PARS } from './groundfloor.ts';

/** planet kind → palette / behaviour code used by the shaders */
export function kindCode(kind: string): number {
  switch (kind) {
    case 'barren': return 1;
    case 'moon': return 2;
    case 'desert': return 3;
    case 'ice': return 4;
    case 'volcanic': case 'lava': return 5;
    case 'methane': return 6;
    default: return 0;
  }
}

export interface Palette { rockA: Color; rockB: Color; sand: Color; regolith: Color }
export function paletteFor(kind: string): Palette {
  const c = (r: number, g: number, b: number) => new Color(r, g, b);
  switch (kind) {
    case 'barren': return { rockA: c(0.105, 0.1, 0.095), rockB: c(0.19, 0.18, 0.165), sand: c(0.3, 0.27, 0.23), regolith: c(0.16, 0.15, 0.14) };
    case 'moon': return { rockA: c(0.12, 0.12, 0.12), rockB: c(0.21, 0.21, 0.205), sand: c(0.25, 0.25, 0.24), regolith: c(0.19, 0.19, 0.185) };
    case 'desert': return { rockA: c(0.26, 0.105, 0.05), rockB: c(0.44, 0.22, 0.1), sand: c(0.5, 0.25, 0.11), regolith: c(0.36, 0.17, 0.08) };
    case 'ice': return { rockA: c(0.16, 0.17, 0.19), rockB: c(0.26, 0.27, 0.3), sand: c(0.45, 0.47, 0.5), regolith: c(0.3, 0.31, 0.33) };
    case 'volcanic': case 'lava': return { rockA: c(0.04, 0.035, 0.035), rockB: c(0.1, 0.085, 0.08), sand: c(0.12, 0.11, 0.1), regolith: c(0.08, 0.07, 0.065) };
    case 'methane': return { rockA: c(0.2, 0.15, 0.1), rockB: c(0.32, 0.24, 0.15), sand: c(0.36, 0.26, 0.14), regolith: c(0.25, 0.18, 0.1) };
    default: return { rockA: c(0.17, 0.16, 0.15), rockB: c(0.29, 0.265, 0.235), sand: c(0.58, 0.47, 0.31), regolith: c(0.2, 0.17, 0.13) };
  }
}

const TERRAIN_FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${CLOUD_DENSITY_GLSL}
${SHADOW_GLSL}
varying vec3 vBodyPos;
varying vec3 vBodyN;
varying vec4 vF0;  // snow sand soil ash
varying vec4 vF1;  // lava wetness ice burnt
varying vec4 vF2;  // grass shrub tree crop
varying vec4 vF3;  // temperature moisture road fire
varying vec4 vF4;  // surface (curved) waterLevel waterDepth groundHeight
varying vec4 vF5;  // treeSpecies cropSpecies light biome
varying float vCurv; // concavity (m), field N.w
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
uniform float uKind;
uniform float uSeaLevel;
uniform float uYearFrac;
uniform float uSeasonAmp;
uniform float uTime;
uniform vec3 uRockA;
uniform vec3 uRockB;
uniform vec3 uSandCol;
uniform vec3 uRegolith;
uniform vec3 uNightAmbient;
uniform float uCityLights;
uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform vec4 uBrush;
uniform vec3 uBrushColor;
uniform float uBrushOn;
uniform vec2 uVegFade;  // instanced-tree hand-over band (m from the camera): canopy shading only beyond it
uniform float uDebug;   // 0 off, 1 body normal, 2 albedo, 3 no bump, 4 macro normal only
${GROUND_FRAG_PARS}

// sky: ambient-only occlusion (forest canopy over its floor); ao darkens ambient and, partly, the sun
struct TSurf { vec3 albedo; float rough; float bump; float ao; vec3 emis; float glint; vec3 microG; float sky; };

// fade a pattern out before it is resolved by fewer than ~6 pixels per feature (no speckle at distance)
float aaF(float fw, float feature) { return 1.0 - smoothstep(0.12, 0.45, fw / feature); }

float cloudShadowAt(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = texture(uCloudCov, normalize(q)).rg;
  float dens = cloudDensityAt(q, 0.35, cs.x, cs.y, false);
  float thick = (uCloudShell.y - uCloudShell.x) * 0.55;
  // (skylight still reaches a cloud's shadow, and the crisp cell edges of the clouds blur in their shadows)
  return max(exp(-dens * thick * 0.7), 0.3);
}

// perturb a view-space normal by the screen-space gradient of a height field (metres)
vec3 bumpNormal(vec3 surfPos, vec3 n, float h) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  // edge-on pixels (the horizon) can have degenerate screen derivatives: never normalise a zero vector into NaN
  vec3 b = abs(det) * n - g;
  float bl = length(b);
  return (bl > 1e-20 && !isnan(bl)) ? b / bl : n;
}

TSurf evalTerrain(vec3 P, vec3 Nb, float fw, float camDist) {
  TSurf s;
  s.glint = 0.0;
  s.sky = 1.0;
  FFloor ffl; float ffW = 0.0;
  vec3 up = normalize(P);
  float slope = 1.0 - clamp(dot(Nb, up), 0.0, 1.0);
  float steep = smoothstep(0.1, 0.32, slope);
  float snow = vF0.x, sand = vF0.y, soil = vF0.z, ash = vF0.w;
  float lava = vF1.x, wetF = vF1.y, ice = vF1.z, burnt = vF1.w;
  float grass = vF2.x, shrub = vF2.y, tree = vF2.z, crop = vF2.w;
  float temp = vF3.x, moist = vF3.y, road = vF3.z, fire = vF3.w;
  float hG = vF4.w;
  float uw = vF4.y - hG;   // water above this ground point (m), negative on land
  // airless follows the actual air (a barren world the player breathed on grows soil and lichen), the palette the kind
  bool airless = uHasAtmo < 0.5;
  bool fine = fw < 6.0;
  bool veryFine = fw < 0.6;

  // season: autumn in each hemisphere (yearFrac 0.5..0.75 north, 0..0.25 south)
  // (the tropics barely have seasons and a planet without axial tilt has none: the swing fades toward the equator and
  // scales with the tilt, uSeasonAmp — switching hemispheres at lat 0 drew a hard line round the equator)
  float lat = up.y;
  float yf = lat >= 0.0 ? uYearFrac : fract(uYearFrac + 0.5); // the local year (crop calendars below)
  float yfS = fract(uYearFrac + 0.5);
  float autumnN = smoothstep(0.48, 0.58, uYearFrac) * (1.0 - smoothstep(0.72, 0.8, uYearFrac));
  float autumnS = smoothstep(0.48, 0.58, yfS) * (1.0 - smoothstep(0.72, 0.8, yfS));
  float winterN = smoothstep(0.7, 0.8, uYearFrac) + (1.0 - smoothstep(0.0, 0.08, uYearFrac));
  float winterS = smoothstep(0.7, 0.8, yfS) + (1.0 - smoothstep(0.0, 0.08, yfS));
  float seasonK = uSeasonAmp * smoothstep(0.06, 0.32, abs(lat));
  float hemi = smoothstep(-0.12, 0.12, lat);
  float autumn = mix(autumnS, autumnN, hemi) * seasonK;
  float winter = mix(winterS, winterN, hemi) * seasonK;

  // macro variation (tens of metres) — keeps every layer from looking tiled
  float m1 = fbm3(P * 0.013);
  float m2 = snoise(P * 0.061);
  // concavity of the ground at the cell scale (field N.w, metres: > 0 hollows and valleys, < 0 ridges and peaks):
  // where snow drifts in, where rock breaks through
  // (land is broadly convex: on the lookdev world the median cell sits ~3 m above its neighbours' mean, the sharpest
  // 5 % of ridges 12 m and more — the scale keeps rock to those)
  float concave = clamp(vCurv / 15.0, -1.0, 1.0);

  // ── rock: tonal masses and weathering streaks in the albedo; structure (ledges, fractures) in the bump ──
  vec3 warpV = vec3(snoise(P * 0.045), snoise(P * 0.045 + 7.3), snoise(P * 0.045 + 13.1));
  float big = fbm3(P * 0.022 + warpV * 0.3);
  float strata = (hG + warpV.x * 4.0 + m2 * 1.5) / (uKind > 2.5 && uKind < 3.5 ? 3.2 : 7.0);
  float band = 0.5 + 0.5 * sin(strata * 6.2831853);
  vec3 rock = mix(uRockA, uRockB, clamp(0.5 + 0.6 * big + 0.2 * (band - 0.5) + 0.12 * m1, 0.0, 1.0));
  float rockBump = big * 0.9 + m2 * 0.35;
  if (fine) {
    // triplanar (body axes) vertical streaks: water and lichen run down steep faces
    vec3 tpw = pow(abs(up), vec3(8.0));
    tpw /= tpw.x + tpw.y + tpw.z;
    float streak = 0.0;
    if (tpw.x > 0.02) streak += tpw.x * snoise(vec3(P.y * 0.3, hG * 0.035, P.z * 0.3));
    if (tpw.y > 0.02) streak += tpw.y * snoise(vec3(P.x * 0.3, hG * 0.035, P.z * 0.3));
    if (tpw.z > 0.02) streak += tpw.z * snoise(vec3(P.x * 0.3, hG * 0.035, P.y * 0.3));
    rock *= 1.0 - 0.2 * smoothstep(0.1, 0.8, streak) * steep * aaF(fw, 3.0);
    // ledges: a sawtooth in height (steep riser, gentle tread), only where the face is steep
    float ledge = (hG + warpV.y * 2.5 + big * 3.0) / 2.4;
    float lf = fract(ledge);
    float cliff = smoothstep(0.42, 0.62, slope);
    float ledgeB = smoothstep(0.0, 0.12, lf) * (1.0 - lf) * cliff * aaF(fw, 2.0);
    // fractures: thin ridged-noise seams
    float fr = 1.0 - abs(snoise((P + warpV * 2.0) * 0.16));
    float seam = pow(fr, 10.0) * aaF(fw, 1.2);
    float mid = snoise(P * 0.21 + warpV) * aaF(fw, 4.0);
    float grain = snoise(P * 3.1) * aaF(fw, 0.32);
    rock *= (1.0 - 0.12 * seam * steep) * (0.94 + 0.08 * mid + 0.05 * grain) * (1.0 + 0.08 * ledgeB);
    rockBump += ledgeB * 0.45 + mid * 0.22 + grain * 0.02;
    // lichen / moss on damp, gentler rock (terran only)
    if (!airless) {
      float lich = smoothstep(0.35, 0.8, moist) * smoothstep(0.2, 0.7, snoise(P * 0.33) * 0.5 + 0.5) * (1.0 - steep * 0.6);
      rock = mix(rock, vec3(0.08, 0.095, 0.05), lich * 0.4);
    }
  }
  vec3 col = rock;
  float rough = 0.84;
  float bump = rockBump;
  // strength of the close-up micro relief (0.2–2 m: grain, clods, tufts), blended through the layers like the bump
  float mk = 0.22;
  float ao = 1.0;
  float spec = 0.5;
  vec3 emis = vec3(0.0);

  // ── regolith (airless) / soil ──
  // noise-broken thresholds: per-cell fields change linearly across 50 m triangles, the noise hides those edges
  float soilW = smoothstep(0.1, 0.9, soil + m1 * 0.45 + m2 * 0.25) * (1.0 - steep * 0.85);
  if (soilW > 0.001) {
    vec3 sc;
    float sb;
    if (airless || uKind > 2.5) {
      sc = uRegolith * (0.9 + 0.2 * m1);
      float pits = 0.0;
      if (fine) pits = snoise(P * 1.3) * aaF(fw, 0.8);
      sc *= 0.95 + 0.08 * pits;
      sb = pits * 0.08 + m2 * 0.3;
    } else {
      float dark = smoothstep(0.2, 0.9, moist);
      sc = mix(vec3(0.2, 0.14, 0.09), vec3(0.11, 0.075, 0.05), dark) * (0.9 + 0.2 * m1);
      float clod = fine ? snoise(P * 1.7) * aaF(fw, 0.6) : 0.0;
      sc *= 0.92 + 0.12 * clod;
      sb = clod * 0.05;
    }
    col = mix(col, sc, soilW);
    bump = mix(bump, sb, soilW);
    rough = mix(rough, 0.92, soilW);
    mk = mix(mk, 0.3, soilW);
  }

  // ── maria (dark basalt on moons, mapped from 'ash' on airless worlds) / volcanic ash ──
  if (ash > 0.005) {
    float aw = smoothstep(0.02, 0.3, ash + m2 * 0.05);
    vec3 ac = airless ? uRegolith * 0.42 : vec3(0.075, 0.072, 0.07);
    col = mix(col, ac * (0.9 + 0.2 * m1), aw);
    rough = mix(rough, 0.95, aw);
  }

  // ── vegetation: grass / dry grass, shrubs, forest canopy, farm fields ──
  float vegTotal = grass + shrub + tree + crop;
  // farmland's own weight: a sown field shows as tilled rows even where little else grows (and covers the sand)
  float fieldW = 0.0;
  if (vegTotal > 0.01) {
    float cold = smoothstep(9.0, -3.0, temp);
    // grass
    vec3 lush = vec3(0.06, 0.115, 0.03);
    vec3 dry = vec3(0.23, 0.205, 0.12);
    vec3 gcol = mix(dry, lush, smoothstep(0.22, 0.62, moist + m1 * 0.12));
    gcol = mix(gcol, vec3(0.12, 0.125, 0.065), cold * 0.7);
    gcol = mix(gcol, vec3(0.2, 0.17, 0.08), autumn * 0.35);
    gcol = mix(gcol, vec3(0.16, 0.14, 0.09), winter * 0.35 * (1.0 - cold));
    float clump = fine ? snoise(P * 0.27 + warpV) * aaF(fw, 3.5) : 0.0;
    float blades = veryFine ? snoise(P * 4.3) * aaF(fw, 0.23) : 0.0;
    // broad, gentle drifts of greener / yellower sward at ~100 m (narrow, strong bands at 30 m read as camouflage);
    // sun-facing slopes dry out first
    float patchy = fbm3(P * 0.008 + 11.0);
    float sunny = clamp(dot(Nb - up * dot(Nb, up), normalize(uSunDirBody - up * dot(uSunDirBody, up) + 1e-5)) * 3.0, -1.0, 1.0);
    gcol = mix(gcol, dry, clamp(0.12 * sunny, 0.0, 0.12) * smoothstep(0.7, 0.3, moist));
    gcol = mix(gcol, gcol * vec3(1.12, 1.06, 0.82), smoothstep(-0.6, 0.8, patchy) * 0.12);
    gcol = mix(gcol, gcol * vec3(0.86, 0.96, 0.9), smoothstep(0.6, -0.8, patchy) * 0.10);
    gcol *= 0.88 + 0.16 * clump + 0.12 * blades + 0.1 * m2;
    gcol = meadowTint(gcol, P, fw, moist, autumn, winter, cold, warpV);
    float gBump = clump * 0.05 + blades * 0.02;

    vec3 vcol = gcol;
    float vb = gBump;
    float vao = 1.0;
    // shrubs: clumpy blobs over grass
    if (shrub > 0.01) {
      float sw = smoothstep(0.15, 0.7, shrub + m2 * 0.3);
      vec3 sv = fine ? voronoi3((P + warpV * 2.5) * 0.36) : vec3(0.5, 0.8, 0.5);
      float blob = (1.0 - smoothstep(0.15, 0.75, sv.x)) * aaF(fw, 2.0);
      vec3 shc = mix(vec3(0.045, 0.07, 0.025), vec3(0.09, 0.09, 0.04), cold * 0.5 + sv.z * 0.4);
      float cover = sw * mix(0.65, 1.0, blob);
      vcol = mix(vcol, shc, cover * mix(0.55, 1.0, blob));
      vb += blob * 0.18 * sw;
      vao *= mix(1.0, 0.85 + 0.15 * blob, sw);
    }
    // forest canopy: crowns as Voronoi domes, gaps dark (where trees are not instanced)
    if (tree > 0.01) {
      // woods break up at the scale of groves (m1, ~80 m), not in 16 m blotches against the sward (camouflage)
      float tw = smoothstep(0.08, 0.55, tree + m1 * 0.3 + m2 * 0.03);
      float conifer = cold;
      float scale = mix(0.15, 0.24, conifer);
      vec3 tv = fine ? voronoi3((P + warpV * 4.0) * scale) : vec3(0.45, 0.8, 0.5);
      float crownAA = aaF(fw, 1.0 / scale);
      // crowns vary in size; clearings open where the canopy thins
      float rad = 0.75 + 0.35 * tv.z;
      float clearing = smoothstep(0.62, 0.3, tree + snoise(P * 0.03) * 0.25);
      float crown = mix(0.55, (1.0 - smoothstep(0.0, rad, tv.x)) * (1.0 - clearing * 0.8), crownAA);
      // crown to crown the canopy varies in value by about ±8 %, not in hue (wider swings read as camouflage)
      vec3 broad = vec3(0.038, 0.071, 0.021) * (0.92 + 0.16 * tv.z);
      vec3 conif = vec3(0.022, 0.047, 0.027) * (0.92 + 0.16 * tv.z);
      vec3 tc = mix(broad, conif, conifer);
      // autumn: broadleaf crowns turn individually
      float turn = autumn * (1.0 - conifer) * smoothstep(0.25, 0.75, gn_hash13(vec3(tv.z * 97.0, 1.0, 2.0)));
      tc = mix(tc, mix(vec3(0.17, 0.075, 0.02), vec3(0.24, 0.17, 0.04), tv.z), turn * 0.75);
      tc = mix(tc, tc * vec3(0.85, 0.8, 0.75), winter * (1.0 - conifer) * 0.6);
      float leaf = veryFine ? snoise(P * 2.1) * aaF(fw, 0.45) : 0.0;
      tc *= 0.62 + 0.55 * crown + 0.1 * leaf;
      // within the instanced-tree range the real trees stand here: show their floor (litter, shade), not canopy
      // (no trees instanced at all — the planet view parks the band at 1e9 — means canopy everywhere, not floor)
      float inst = uVegFade.x > 1e8 ? 0.0 : 1.0 - smoothstep(uVegFade.x, uVegFade.y, camDist);
      float cover = tw * mix(0.8, 1.0, crown) * (1.0 - inst);
      vcol = mix(vcol, tc, cover);
      vb = mix(vb, crown * 1.8 * crownAA + leaf * 0.15, tw * (1.0 - inst));
      vao *= mix(1.0, mix(0.45, 1.0, crown), tw * crownAA * (1.0 - inst));
      if (inst > 0.0) {
        // the forest floor (groundfloor.ts): litter / duff, twigs, roots, stones, moss, canopy sky occlusion — wherever
        // the instanced trees really shade the ground (ff_canopy), not only where the cell's tree field is high
        float shadeK = ff_canopy(P, up, Nb, dot(up, uSunDirBody)) * smoothstep(0.01, 0.05, tree);
        float twc = max(tw, shadeK);
        ffl = forestFloor(P, up, fw, twc, shrub, moist, autumn, winter, concave, m1, m2, warpV, uRockB);
        ffW = twc * inst;
        vcol = mix(vcol, ffl.col, ffW);
        vb = mix(vb, ffl.bump, ffW);
        vao *= mix(1.0, ffl.ao, ffW);
      }
    }
    // farm fields
    if (crop > 0.01) {
      // a field reads as a field from the day it is sown (the live sim's crops start at a few hundredths and fill in)
      float cw = smoothstep(0.015, 0.14, crop);
      fieldW = cw * (1.0 - steep * 0.8);
      vec3 fv = voronoi3(P * 0.019 + vec3(3.7));
      float fid = fv.z;
      vec3 rnd = normalize(gn_hash33(vec3(fid * 91.7, 7.3, 3.1)) - 0.5);
      vec3 rd = normalize(cross(up, rnd));
      float rows = sin(dot(P, rd) * 6.2831853 / 1.5) * aaF(fw, 1.5);
      // crop by field & season: tilled → green → ripe/canola → stubble
      float k = floor(fid * 5.0);
      vec3 tilled = vec3(0.13, 0.085, 0.05);
      vec3 young = vec3(0.07, 0.13, 0.03);
      vec3 ripe = vec3(0.36, 0.27, 0.085);
      vec3 canola = vec3(0.42, 0.35, 0.02);
      vec3 hay = vec3(0.24, 0.21, 0.09);
      float ph = fract(yf + fid * 0.15);
      vec3 cc = ph < 0.15 ? tilled : ph < 0.45 ? young : ph < 0.7 ? (k < 1.5 ? canola : ripe) : (k < 2.5 ? hay : tilled);
      cc = k > 3.5 ? mix(young, vec3(0.05, 0.1, 0.03), 0.4) : cc; // pasture
      // the sim's own growth wins while it is young: rows of green on tilled soil, the green widening as the crop fills
      // in (far away the rows average to that mix); the season colours a full field
      float rowMask = smoothstep(-0.3, 0.7, rows);
      float cover = smoothstep(0.04, 0.45, crop);
      vec3 youngField = mix(tilled, young, clamp(mix(rowMask * 0.85, 1.0, cover * cover) * smoothstep(0.02, 0.1, crop), 0.0, 1.0));
      cc = mix(youngField, cc, smoothstep(0.35, 0.6, crop));
      cc *= 0.9 + 0.1 * rows + 0.12 * m2;
      // hedgerows grow round old farmland: a first season's plots are bare strips with grass between them
      float mature = smoothstep(0.25, 0.5, crop);
      float hedge = (1.0 - smoothstep(0.0, 0.035 + fw * 0.004, fv.y - fv.x)) * aaF(fw, 20.0) * mature;
      cw *= mix(smoothstep(0.0, 0.06 + fw * 0.004, fv.y - fv.x), 1.0, mature);
      cc = mix(cc, vec3(0.025, 0.05, 0.018), hedge * 0.85);
      vcol = mix(vcol, cc, cw);
      vb = mix(vb, rows * 0.06 + hedge * 1.2, cw);
      vao *= mix(1.0, 1.0 - hedge * 0.35, cw);
    }
    // per-cell cover is linear across 50 m triangles: noise in the threshold turns those edges into organic margins
    float vegW = max(smoothstep(0.05, 0.6, vegTotal + m1 * 0.32 + m2 * 0.06) * (1.0 - steep * 0.8), fieldW);
    col = mix(col, vcol, vegW);
    bump = mix(bump, vb, vegW);
    mk = mix(mk, 0.45, vegW);
    rough = mix(rough, 0.88, vegW);
    ao = mix(ao, vao, vegW);
    spec = mix(spec, 0.35, vegW);
    if (ffW > 0.0) {
      rough = mix(rough, ffl.rough, ffW * vegW);
      mk = mix(mk, ffl.mk, ffW * vegW);
      // (the canopy hides the sky whatever the ground is: not weighted by the ground's vegetation cover, which drops on
      // slopes and left shaded forest hillsides lit by the full blue sky — slate grey)
      s.sky = mix(1.0, ffl.sky, ffW);
    }
  }

  // ── sand: beaches and dune seas, wind ripples ──
  if (sand > 0.01) {
    // plants root in sand too: cover hides the sand beneath it (dune grass, a meadow on regolith)
    float sw = smoothstep(0.05, 0.5, sand + m2 * 0.18) * (1.0 - steep * 0.6) * (1.0 - clamp(vegTotal * 1.4 + m1 * 0.2, 0.0, 0.9)) * (1.0 - fieldW);
    vec3 scl = uSandCol * (0.9 + 0.16 * m1 + 0.06 * m2);
    // ripples, finer ripples and wind streaks + sun glints (groundfloor.ts sandDetail)
    vec3 sdt = fine ? sandDetail(P, up, fw) : vec3(1.0, 0.0, 0.0);
    scl *= sdt.x;
    if (veryFine && sw > 0.5) s.glint = max(s.glint, sdt.z);
    col = mix(col, scl, sw);
    bump = mix(bump, sdt.y + m2 * 0.25, sw);
    rough = mix(rough, 0.9, sw);
    mk = mix(mk, 0.07, sw);
  }

  // ── beaches and bare rock (worlds with air): a noise-broken band of sand at the waterline of seas and lakes on
  // gentle ground; rock breaking through the turf on sharp ridges and on the high peaks (no green domes at 400 m)
  if (!airless) {
    float above = -uw; // height above the nearby water (m); inland cells read several metres
    float beach = (1.0 - smoothstep(0.8 + m2 * 0.45, 1.7 + m2 * 0.45, above)) * smoothstep(-0.2, 0.05, above)
      * (1.0 - smoothstep(0.08, 0.18, slope)) * (1.0 - smoothstep(0.25, 0.6, tree));
    if (beach > 0.001) {
      vec3 bs = mix(uSandCol, uSandCol * vec3(0.92, 0.9, 0.86), smoothstep(-0.3, 0.6, m1)) * (0.94 + 0.06 * m2);
      col = mix(col, bs, beach);
      bump = mix(bump, m2 * 0.15, beach);
      rough = mix(rough, 0.9, beach);
      mk = mix(mk, 0.07, beach);
    }
    float ridge = smoothstep(0.75, 1.1, -concave + m2 * 0.15);
    float alpine = smoothstep(210.0, 290.0, hG - uSeaLevel + m1 * 35.0);
    float bare = clamp(max(ridge * 0.65, alpine * 0.8) * (0.75 + 0.25 * smoothstep(-0.2, 0.5, m2)), 0.0, 0.88);
    if (bare > 0.001) {
      col = mix(col, rock, bare);
      bump = mix(bump, rockBump, bare);
      rough = mix(rough, 0.84, bare);
      mk = mix(mk, 0.22, bare);
      ao = mix(ao, 1.0, bare);
    }
  }

  // ── road / path wear ──
  if (road > 0.05) {
    // trodden ground only: the worn track is the narrow crest of the interpolated wear field, the shoulder faintly
    // trodden. Paved surfaces (cobble, stone) belong to the ribbon meshes along the most-worn edges (render/life/
    // roads, with the peoples): an area fill of cobbles over the field's blobs read as stains, not paths
    // (only a soft, domain-warped trodden tint: the tracks themselves are the roadnet's curved ribbons, render/life/
    // roads.ts, down to footpaths. A crest band of the interpolated field ran in straight lines between the sim cells
    // and covered the land round a settlement with a triangulated wireframe)
    float rwarp = 0.15 * snoise(P * 0.05) + 0.08 * snoise(P * 0.21);
    float rw = 0.3 * smoothstep(0.35, 0.95, road + rwarp);
    vec3 dirt = vec3(0.17, 0.125, 0.085) * (0.9 + 0.15 * m1);
    float rb = 0.0;
    if (fine) {
      // ruts and compacted grit along the track, not paving
      float grit = snoise(P * 2.3) * aaF(fw, 0.4);
      dirt *= 0.92 + 0.12 * grit;
      rb = grit * 0.015;
    }
    col = mix(col, dirt, rw * 0.9);
    bump = mix(bump, rb, rw);
    mk = mix(mk, 0.12, rw);
    rough = mix(rough, 0.8, rw);
    ao = mix(ao, 1.0, rw);
  }

  // ── burnt ground and ash fall ──
  if (burnt > 0.01) {
    float bw = smoothstep(0.02, 0.5, burnt + m2 * 0.1);
    col = mix(col, vec3(0.028, 0.025, 0.022) * (0.8 + 0.4 * m1), bw);
    rough = mix(rough, 0.95, bw);
  }

  // ── snow ──
  if (snow > 0.005) {
    // snow does not hold on cliffs: faces past ~45° show their rock (white walls read as spikes on the limb). Partial
    // cover follows the land, not noise: shaded (pole-facing / away from the sun) slopes and hollows keep it, sunny
    // convex ground melts out first — a gentle, wide transition with little noise (no dalmatian spots)
    vec3 tanN = Nb - up * dot(Nb, up);
    vec3 sunT = uSunDirBody - up * dot(uSunDirBody, up);
    float aspectSun = dot(tanN, normalize(sunT + 1e-5)) * 2.5;
    float hollow = clamp(concave * 2.5, -1.0, 1.0) * 0.3;
    float sw = smoothstep(0.0, 0.4, snow * 1.6 - 0.04 + m2 * 0.04 + m1 * 0.04 - aspectSun * 0.12 + hollow * 0.2) * (1.0 - smoothstep(0.3, 0.55, slope));
    // under a canopy (the forest floor's weight) the crowns catch part of the snow, and litter, twigs and stones poke
    // through a thin cover; the floor keeps its canopy occlusion (ao below)
    // (a wide ramp: the litter's leaf-scale height on a narrow one made a dithered snow edge up close)
    if (ffW > 0.0) sw *= (1.0 - 0.5 * ffW) * (1.0 - ffW * smoothstep(0.005, 0.085, ffl.bump) * (1.0 - smoothstep(0.4, 0.9, snow)));
    vec3 sc = vec3(0.78, 0.81, 0.86) * (0.93 + 0.08 * m1);
    // wind-packed crust is greyer, fresh drifts whiter; sastrugi and drifts give the shading its grain
    sc *= mix(0.9, 1.04, smoothstep(-0.4, 0.5, m2));
    float drift = fine ? snoise(P * 0.17) * 0.5 + snoise(P * 0.9) * 0.08 * aaF(fw, 1.0) + m2 * 0.6 : m2 * 0.6;
    col = mix(col, sc, sw);
    bump = mix(bump, drift, sw);
    rough = mix(rough, 0.55, sw);
    mk = mix(mk, 0.05, sw);
    ao = mix(ao, 1.0, sw * (1.0 - ffW));
    spec = mix(spec, 0.6, sw);
    // sparkle: rare facets that mirror the sun (lit in the sun term)
    if (veryFine && sw > 0.5) s.glint = gn_hash13(floor(P * 22.0));
  }

  // ── ice ──
  if (ice > 0.02) {
    // glacier ice drapes slopes but breaks off cliffs, where the rock beneath shows (on dry ground only: floating ice
    // is drawn by the water surface)
    // noise in the threshold breaks the iso-contours of a field that varies linearly over 50 m triangles (no diamonds)
    float iw = smoothstep(0.05, 0.4, ice + m1 * 0.3 + m2 * 0.15) * (1.0 - smoothstep(0.35, 0.6, slope) * 0.9);
    vec3 icc = vec3(0.5, 0.66, 0.8) * (0.9 + 0.1 * m1);
    float cr = 0.0;
    if (fine) {
      vec3 iv = voronoi3((P + warpV * 9.0) * 0.05);
      cr = (1.0 - smoothstep(0.0, 0.02 + fw * 0.01, iv.y - iv.x)) * smoothstep(-0.1, 0.5, snoise(P * 0.02)) * aaF(fw, 4.0);
      // pressure ridges and snow-dusted floes
      float dust = smoothstep(0.0, 0.6, snoise(P * 0.08 + warpV) * 0.5 + 0.5);
      icc = mix(icc, vec3(0.78, 0.82, 0.86), dust * 0.6);
      icc = mix(icc, vec3(0.25, 0.4, 0.5), cr * 0.5);
    }
    col = mix(col, icc, iw);
    rough = mix(rough, 0.12, iw);
    mk = mix(mk, 0.02, iw);
    bump = mix(bump, cr * 0.1, iw);
    spec = mix(spec, 0.8, iw);
  }

  // ── wetness: rain, flood, mud, the wet band above the waterline ──
  // the wet band above the waterline is narrow (a few tens of cm) and noise-broken; on flat shores a vertical band of
  // 1.5 m covered whole low islands in mud
  // On a steep rim that band is thinner than a pixel and aliases into a dotted outline: it fades out as the height
  // above water changes by more than ~0.15 m per pixel.
  float uwPx = fwidth(uw);
  // (no hard edges: the band rises smoothly from dry ground and runs on under the water's edge, so where the water
  // mesh ends along a sim triangle there is no seam of dry-then-wet pixels to trace it in dashes)
  float shoreWet = smoothstep(-0.36 + m2 * 0.1, -0.04, uw) * (1.0 - smoothstep(0.1, 0.5, uw));
  shoreWet *= (1.0 - smoothstep(0.2, 0.45, vegTotal)) * (1.0 - smoothstep(0.04, 0.3, uwPx));
  float wet = clamp(max(wetF * 0.85, shoreWet), 0.0, 1.0) * (1.0 - smoothstep(0.1, 0.4, snow));
  // forest floors and meadows are not wet mirrors: the canopy and the sward take the water
  wet *= 1.0 - 0.75 * clamp(tree + 0.5 * grass, 0.0, 1.0);
  col *= mix(1.0, 0.55, wet * (1.0 - clamp(vegTotal, 0.0, 1.0) * 0.6));
  // wet soil and litter stay rough (0.35); only bare rock and sand film over glossy
  float wetFloor = mix(0.18, 0.35, clamp(soil * 2.0 + vegTotal, 0.0, 1.0));
  rough = mix(rough, wetFloor, wet * 0.85);

  // ── under water: silt and sand floor ──
  if (uw > 0.0) {
    float d = smoothstep(0.0, 6.0, uw);
    vec3 floorC = mix(uSandCol * 0.5, vec3(0.09, 0.085, 0.065), smoothstep(1.0, 12.0, uw)) * (0.85 + 0.25 * m1);
    col = mix(col, floorC, max(d, 0.6) * (1.0 - steep * 0.5));
    rough = mix(rough, 0.35, 0.7);
    mk = mix(mk, 0.05, max(d, 0.6));
  }

  // ── lava: dark crust, glowing cracks (emissive, animated) ──
  if (lava > 0.01) {
    float lw = smoothstep(0.02, 0.4, lava);
    vec3 lv = voronoi3(P * 0.25 + vec3(0.0, uTime * 0.01, 0.0));
    float glow = 1.0 - smoothstep(0.0, 0.18, lv.y - lv.x);
    float hot = clamp(lava * 0.6, 0.0, 1.0);
    col = mix(col, vec3(0.03, 0.025, 0.022), lw);
    rough = mix(rough, 0.7, lw);
    float pulse = 0.75 + 0.25 * sin(uTime * 1.3 + lv.z * 20.0);
    emis += vec3(4.0, 1.1, 0.18) * glow * lw * (0.25 + hot) * pulse * 6.0;
    bump = mix(bump, (1.0 - glow) * 0.4, lw);
  }
  // fire: a FRONT — a ragged band of burning litter where the fire field crosses the edge of the burning ground (its
  // level warped by noise, so the band wanders instead of following the 50 m sim triangles), ash and a sparse scatter
  // of embers behind it, untouched ground ahead (the flames themselves are particles). Not a glowing net over every
  // burning cell, which read as a lava field from above.
  // (the fire field's gradient per metre, taken outside the branch: derivatives in divergent flow are undefined)
  float fireDW = fwidth(fire) / max(fw, 1e-4);
  if (fire > 0.01) {
    float warp = snoise(P * 0.045 + vec3(0.0, uTime * 0.01, 0.0)) * 0.6 + snoise(P * 0.17) * 0.3 + snoise(P * 0.6) * 0.1;
    float level = fire + warp * 0.2;
    // the front is a LINE of constant width on the ground (~1.5 m) along the level-0.25 contour, found from the field's
    // own gradient — a band of field values covered whole hillsides where the fire field is smooth, glowing peach
    float perM = min(fireDW + 0.025, 1.0);
    float band = 1.0 - smoothstep(0.0, max(perM * 1.5, 0.004), abs(level - 0.25));
    float behind = smoothstep(0.22, 0.4, level);
    float fl = 0.55 + 0.45 * snoise(P * 0.7 + vec3(0.0, uTime * 1.3, 0.0));
    float lick = smoothstep(0.1, 0.7, snoise(P * vec3(1.6, 0.4, 1.6) + vec3(uTime * 0.6)) * 0.5 + 0.5);
    // embers behind the front: a few hot specks, faded where they would be smaller than a pixel
    vec3 cellE = floor(P * 2.2);
    float eh = fract(sin(dot(cellE, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    // (round specks set off-centre in their cell, not square tiles)
    vec3 eo = fract(P * 2.2) - 0.5 - (vec3(fract(eh * 13.7), fract(eh * 7.3), fract(eh * 3.1)) - 0.5) * 0.5;
    float ember = step(0.95, eh) * smoothstep(0.22, 0.08, length(eo)) * (0.6 + 0.4 * sin(uTime * 3.0 + eh * 60.0)) * (1.0 - smoothstep(0.15, 0.5, fw));
    // and patches of glowing coals, not a uniform glow: an even 5 % emission over every burning cell lit whole
    // hillsides peach at night and the auto-exposure blacked out the rest of the view
    float coals = smoothstep(0.64, 0.9, snoise(P * 0.3 + 4.0) * 0.5 + 0.5);
    emis += vec3(2.4, 0.62, 0.09) * (band * (0.6 + 0.9 * lick) * fl * 2.6 + ember * behind * 1.6 + behind * coals * 0.12 * fl);
    // the ground: charred where the fire has passed, dark ash with grey bloom
    float ashK = min(1.0, max(behind, band * 0.7) * 1.1);
    col = mix(col, mix(vec3(0.03, 0.028, 0.026), vec3(0.11, 0.105, 0.1), smoothstep(0.3, 0.8, snoise(P * 0.9) * 0.5 + 0.5) * 0.7), ashK * 0.9);
  }

  // macro relief in the shading only (gullies and swells at 10–60 m): reads at a distance, leaves the ground
  // height — the contract's groundHeight — untouched
  float macro = (fbm3(P * 0.017) * 1.4 + fbm3(P * 0.047 + 5.0) * 0.45) * (1.0 - smoothstep(0.5, 6.0, ash + snow * 4.0));
  // close-up micro relief (0.3 m and 1.1 m octaves) from ANALYTIC noise gradients: smooth per pixel at any mesh
  // density (screen-space derivatives of the bump facet per triangle), with a matching albedo grain
  s.microG = vec3(0.0);
  if (veryFine && mk > 0.01) {
    float aa1 = aaF(fw, 0.35), aa2 = aaF(fw, 1.1);
    vec3 g1 = vec3(0.0), g2 = vec3(0.0);
    float n1 = aa1 > 0.0 ? snoiseGrad(P * 2.9, g1) : 0.0;
    float n2 = snoiseGrad(P * 0.9 + 13.7, g2);
    vec3 g = g1 * (2.9 * 0.05 * aa1) + g2 * (0.9 * 0.12 * aa2);
    s.microG = (g - up * dot(g, up)) * mk;
    col *= 1.0 + (0.12 * n1 * aa1 + 0.08 * n2 * aa2) * mk * 2.0;
  }
  s.albedo = col;
  s.rough = clamp(rough, 0.04, 1.0);
  s.bump = bump + macro * (uw > 0.0 ? 0.3 : 1.0);
  s.ao = ao;
  s.emis = emis;
  return s;
}
`;

const VERT_PARS = /* glsl */ `
${TERRAIN_VERT_PARS}
uniform highp sampler2D uFieldM0;
uniform highp sampler2D uFieldM1;
uniform highp sampler2D uFieldV;
uniform highp sampler2D uFieldC;
uniform highp sampler2D uFieldS;
varying vec3 vBodyPos;
varying vec3 vBodyN;
varying vec4 vF0;
varying vec4 vF1;
varying vec4 vF2;
varying vec4 vF3;
varying vec4 vF4;
varying vec4 vF5;
varying float vCurv;
${GROUND_VERT_PARS}
`;

const VERT_MAIN = /* glsl */ `
${TERRAIN_VERT_CORE}
  vBodyPos = tPos;
  vBodyN = tNrm;
  vF0 = tfInterp(uFieldM0, aCells, aMisc.x);
  vF1 = tfInterp(uFieldM1, aCells, aMisc.x);
  vF2 = tfInterp(uFieldV, aCells, aMisc.x);
  vF3 = tfInterp(uFieldC, aCells, aMisc.x);
  vF4 = vec4(tS, tA.z, tA.w, tH);
  vF5 = tfInterp(uFieldS, aCells, aMisc.x);
  vCurv = tfInterp(uFieldN, aCells, aMisc.x).w;
${GROUND_VERT_MAIN}
  vec3 objectNormal = tNrm;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;

const FRAG_SURFACE = /* glsl */ `
  float tFw = length(fwidth(vBodyPos));
  TSurf ts = evalTerrain(vBodyPos, normalize(vBodyN), tFw, length(vViewPosition));
  diffuseColor.rgb = ts.albedo;
`;

const FRAG_LIGHT = /* glsl */ `
  {
    vec3 Pb = vBodyPos;
    float rP = length(Pb);
    vec3 upB = Pb / rP;
    float muS = dot(upB, uSunDirBody);
    vec3 nView = normal;
    float sh = sunShadow(-vViewPosition, nView);
    float csh = cloudShadowAt(Pb, uSunDirBody);
    vec3 sunCol = uSunE * sunTransmittance(rP, muS) * sh * csh;
    // underwater: caustics — the light focused by the waves into thin wandering filaments on a shallow floor. Only
    // in shallows (0.2-3 m: deeper the focus blurs out) and near the camera (they are a close-up detail: from 60 m a
    // net of bright lines over every pool read as a swimming pool), soft (±30 %), as ridged noise — curved filaments,
    // not the polygon cells of a Voronoi edge net.
    float uwD = vF4.y - vF4.w;
    if (uwD > 0.15) {
      float camD = length(vViewPosition);
      float k = (1.0 - smoothstep(10.0, 24.0, camD)) * smoothstep(0.15, 0.4, uwD) * (1.0 - smoothstep(1.6, 3.2, uwD));
      float cfw = length(fwidth(Pb));
      k *= 1.0 - smoothstep(0.08, 0.3, cfw);
      if (k > 0.001) {
        vec3 q1 = Pb * 0.55 + vec3(uTime * 0.16, uTime * 0.1, -uTime * 0.07);
        vec3 q2 = Pb * 0.83 - vec3(uTime * 0.05, uTime * 0.14, uTime * 0.09);
        vec3 wq = vec3(snoise(q1 * 0.5), snoise(q1 * 0.5 + 4.1), snoise(q1 * 0.5 + 8.3)) * 0.6;
        float r1 = 1.0 - abs(snoise(q1 + wq));
        float r2 = 1.0 - abs(snoise(q2 - wq * 0.7));
        float caus = pow(r1, 9.0) + pow(r2, 9.0) * 0.8;
        sunCol *= 1.0 + (caus * 1.6 - 0.3) * 0.3 * k;
      }
    }
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = sunCol * mix(1.0, ts.ao, 0.45);
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    // snow sparkle: rare facets mirror the sun
    if (ts.glint > 0.997) {
      float gl = pow(max(dot(reflect(-geometryViewDir, geometryNormal), uSunDirView), 0.0), 64.0);
      reflectedLight.directSpecular += sunCol * gl * 6.0;
    }
    // moonlight (renderer.ts: the brightest moon in the sky, art-directed): a second directional light, no shadow maps
    if (dot(uMoonE, uMoonE) > 0.0) {
      IncidentLight moonL;
      moonL.direction = uMoonDirView;
      moonL.color = uMoonE * smoothstep(-0.03, 0.06, dot(upB, uMoonDirBody)) * cloudShadowAt(Pb, uMoonDirBody) * mix(1.0, ts.ao, 0.45);
      moonL.visible = true;
      RE_Direct(moonL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    }
  }
`;

const FRAG_AMBIENT = /* glsl */ `
  {
    vec3 upB = normalize(vBodyPos);
    mat3 viewToBody = transpose(uBodyToView);
    vec3 nB = normalize(viewToBody * normal);
    vec3 vB = normalize(viewToBody * geometryViewDir);
    vec3 skyE = skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient * (0.6 + 0.4 * max(dot(nB, upB), 0.0));
    // the sky enters ONCE: three r186's RE_IndirectSpecular adds a full Lambert term from iblIrradiance itself, so
    // adding skyE to 'irradiance' as well (RE_IndirectDiffuse) doubled the ambient — milky, shadowless ground
    // under a canopy the sky light arrives through leaves: less of it, and neutral-green rather than sky blue
    skyE = mix(skyE, vec3(dot(skyE, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.86, 1.06, 0.78), clamp((1.0 - ts.sky) * 1.6, 0.0, 1.0));
    iblIrradiance += skyE * ts.ao * ts.sky;
    vec3 rBraw = reflect(-vB, nB);
    // reflections of the sky need an open sky: a ray that dives below the horizon sees ground, not sky (horizon
    // occlusion, measured BEFORE the ray is lifted above it), and creases / AO hide it too (Lagarde specular occlusion)
    float horizonK = smoothstep(-0.05, 0.3, dot(rBraw, upB));
    float NdVs = clamp(dot(nB, vB), 0.0, 1.0);
    float rgh = material.roughness;
    float specOcc = clamp(pow(NdVs + ts.ao, exp2(-16.0 * rgh - 1.0)) - 1.0 + ts.ao, 0.0, 1.0) * ts.sky;
    vec3 rB = normalize(rBraw + upB * max(0.0, -dot(rBraw, upB)) * 1.05);
    // (three applies the environment BRDF — Fresnel and roughness — to this radiance itself)
    radiance += skyRadiance(upB, rB, uSunDirBody) * specOcc * horizonK;
  }
`;

const FRAG_EMISSIVE = /* glsl */ `
  totalEmissiveRadiance = ts.emis;
  if (uDebug > 0.5 && uDebug < 1.5) { totalEmissiveRadiance = (normalize(transpose(uBodyToView) * normal) * 0.5 + 0.5) * 2.0; diffuseColor.rgb = vec3(0.0); }
  if (uDebug > 1.5 && uDebug < 2.5) { totalEmissiveRadiance = ts.albedo * 4.0; diffuseColor.rgb = vec3(0.0); }
  if (uDebug > 3.5) { totalEmissiveRadiance = (normalize(vBodyN) * 0.5 + 0.5) * 2.0; diffuseColor.rgb = vec3(0.0); }
  {
    // night-side lights of settlements: the life layer's per-cell light (lit buildings: hearth → lamps → electric;
    // render/life/buildings.ts) as clusters of lamp-lit spots that average into a soft glow from orbit; close up the
    // buildings' own windows and point lights take over, so the ground glow fades out near the camera
    float night = smoothstep(0.05, -0.12, dot(normalize(vBodyPos), uSunDirBody));
    float cityL = vF5.z;
    if (cityL > 0.002 && night > 0.0) {
      float cd = length(vViewPosition);
      vec3 lv = voronoi3(vBodyPos * 0.11);
      float lamp = exp(-lv.x * lv.x * 22.0) * step(0.3, lv.z);
      float lampAA = aaF(tFw, 9.0);
      // seen from high up the lamps merge: lit blocks (~35 m cells, some dark) strung along the worn streets, with
      // dark gaps between — a city reads as a speckled web of light, not a smooth blob; their own mean beyond that
      vec3 bv = voronoi3(vBodyPos * 0.016);
      float block = smoothstep(0.62, 0.1, bv.x) * step(0.3, bv.z) * (0.4 + 0.6 * bv.z);
      float street = smoothstep(0.1, 0.55, vF3.z);
      float blockAA = aaF(tFw, 60.0);
      // (beyond the blocks' scale the glow still follows the worn streets: a web along the roads, not a flat disc)
      float far = mix(0.05 + 0.3 * street, block * (0.2 + 1.0 * street) * 0.6, blockAA);
      float pattern = mix(far, lamp * 1.4 + 0.05, lampAA);
      // within a couple of km the settlement's own lit windows and street lamps are drawn (render/life): the ground
      // keeps only a faint warm spill there instead of a field of spots — light FALLING on the ground (its own colour,
      // saturating with the cell's sum of houses), not light glowing out of it: a self-lit spill read as a glaring disc
      // round every town once the night exposure adapted to it, brighter than the windows that cast it
      float nearK = smoothstep(900.0, 2500.0, cd);
      vec3 lc = mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.72, 0.42), smoothstep(1.5, 3.5, cityL));
      totalEmissiveRadiance += lc * cityL * pattern * night * uCityLights * 1.4 * nearK;
      float spillL = cityL / (1.0 + 0.6 * cityL);
      totalEmissiveRadiance += lc * spillL * diffuseColor.rgb * 0.035 * night * uCityLights * (1.0 - nearK);
    }
    // brush preview ring (projected on the ground, so it hugs every slope)
    if (uBrushOn > 0.5) {
      float ang = acos(clamp(dot(normalize(vBodyPos), uBrush.xyz), -1.0, 1.0));
      float px = max(tFw / max(uRadius, 1.0), 1e-6);
      float w = max(px * 2.0, uBrush.w * 0.025);
      float ring = 1.0 - smoothstep(0.0, w, abs(ang - uBrush.w));
      float fill = (1.0 - smoothstep(uBrush.w - w, uBrush.w, ang)) * 0.06;
      totalEmissiveRadiance += uBrushColor * (ring * 1.2 + fill);
    }
  }
`;

/** uniforms shared by every LOD material (and the depth / water materials) of one planet */
export interface PlanetShaderUniforms {
  [k: string]: IUniform;
}

export function makePlanetUniforms(): PlanetShaderUniforms {
  return {
    uFieldA: { value: null }, uFieldN: { value: null }, uFieldM0: { value: null }, uFieldM1: { value: null },
    uFieldV: { value: null }, uFieldC: { value: null }, uFieldS: { value: null }, uFieldF: { value: null }, uFieldG: { value: null },
    uFieldD: { value: null },
    uRadius: { value: 3000 }, uCamBody: { value: new Vector3() },
    uBodyToView: { value: new Matrix3() }, uSunDirBody: { value: new Vector3(1, 0, 0) }, uSunDirView: { value: new Vector3(1, 0, 0) },
    uKind: { value: 0 }, uSeaLevel: { value: 0 }, uYearFrac: { value: 0 }, uSeasonAmp: { value: 1 }, uTime: { value: 0 },
    uRockA: { value: new Color() }, uRockB: { value: new Color() }, uSandCol: { value: new Color() }, uRegolith: { value: new Color() },
    uNightAmbient: { value: new Vector3(0.004, 0.006, 0.012) }, uCityLights: { value: 1 },
    // moonlight (set per frame by the renderer for the primary planet; zero elsewhere)
    uMoonE: { value: new Vector3() }, uMoonDirBody: { value: new Vector3(0, 1, 0) }, uMoonDirView: { value: new Vector3(0, 1, 0) },
    uCloudCov: { value: null }, uCloudShell: { value: new Vector2(3180, 3420) }, uCloudOn: { value: 0 },
    uBrush: { value: new Vector4(0, 1, 0, 0.02) }, uBrushColor: { value: new Vector3(1.2, 0.95, 0.55) }, uBrushOn: { value: 0 },
    uDebug: { value: 0 }, uVegFade: { value: new Vector2(1e9, 1e9 + 1) }, uWindDir: { value: new Vector3(1, 0, 0.3).normalize() },
    // this frame's view space → last frame's clip space through the planet body frame (water SSR reprojection)
    uViewToPrevClip: { value: new Matrix4() },
  };
}

/** Terrain material for one LOD level. `shared` holds planet / atmosphere / cloud / shadow uniforms by reference. */
export function makeTerrainMaterial(shared: Record<string, IUniform>, level: number): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  const morph: IUniform<Vector4> = { value: new Vector4(1e30, 1e30, 0, 0) };
  mat.userData.uMorph = morph;
  mat.userData.level = level;
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
    Object.assign(shader.uniforms, GROUND_UNIFORMS);
    shader.uniforms.uMorph = morph;
    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', VERT_MAIN)
      .replace('#include <begin_vertex>', 'vec3 transformed = tPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\nuniform float uRadius;\n${TERRAIN_FRAG_PARS}`)
      .replace('#include <map_fragment>', FRAG_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = ts.rough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'if (uDebug < 2.5 || uDebug > 3.5) { normal = bumpNormal(-vViewPosition, normal, ts.bump); normal = normalize(normal - uBodyToView * ts.microG); }')
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${FRAG_LIGHT}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_AMBIENT}`);
  };
  mat.customProgramCacheKey = () => 'genesis-terrain-v3';
  return mat;
}

const DEPTH_VERT = /* glsl */ `
#include <common>
${TERRAIN_VERT_PARS}
#include <logdepthbuf_pars_vertex>
void main() {
${TERRAIN_VERT_CORE}
  gl_Position = projectionMatrix * modelViewMatrix * vec4(tPos, 1.0);
#include <logdepthbuf_vertex>
}
`;
const DEPTH_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
void main() {
#include <logdepthbuf_fragment>
  gl_FragColor = vec4(1.0);
}
`;

/** shadow-caster material for one LOD level (same displacement + morph) */
export function makeTerrainDepthMaterial(shared: Record<string, IUniform>, terrain: MeshStandardMaterial): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: DEPTH_VERT,
    fragmentShader: DEPTH_FRAG,
    uniforms: {
      uFieldA: shared.uFieldA, uFieldN: shared.uFieldN, uFieldG: shared.uFieldG, uFieldD: shared.uFieldD, uRadius: shared.uRadius, uCamBody: shared.uCamBody,
      uMorph: terrain.userData.uMorph as IUniform<Vector4>,
    },
    colorWrite: false,
  });
}

export type { Texture };
