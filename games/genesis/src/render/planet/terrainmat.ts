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
varying vec4 vOre; // ore outcrops: the ore's colour × richness (rgb), richness (a) — fieldtex.ts O
varying float vCurv; // concavity (m), field N.w
varying vec3 vFireWind; // the surface wind (m/s, body frame) where the fire field is non-zero (fire fronts run downwind)
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
uniform float uNightRim;       // 0 near the ground .. 1 from orbit: the night floor's rim on the limb (renderer.ts)
uniform float uNightEdge;      // irradiance of the thin starlit edge on the night limb seen from orbit (renderer.ts)
uniform vec4 uAurora;          // (additive, world-events lane) the auroral ovals' light: magnetic axis (xyz), strength (w)
uniform float uCityLights;
uniform samplerCube uCityTex;  // night lights from afar (citylights.ts), bound by the renderer
uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform vec4 uBrush;
uniform vec3 uBrushColor;
uniform float uBrushOn;
// map overlay (UI lane, src/render/planet/overlaytex.ts): equirectangular RGBA per-cell colours; x = on, y = albedo
// mix, z = glow
uniform sampler2D uOverlay;
uniform vec3 uOverlayK;
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


// Jointed bedrock: three joint sets — two steep ones ~73° apart in fixed body-frame directions (a region's joints run
// one way, as real ones do) and the bedding as level courses — as a warped 3D lattice, each bed's blocks staggered
// against the next like masonry. The ground cuts the lattice into quadrilateral blocks; each block is ONE planar face
// with its own tilt, returned as an analytic height gradient (crisp facets per pixel, no screen-derivative stair-steps),
// its edges rounded over a narrow bevel; the joints between blocks are thin dark lines, most of them tight, a few open.
// (Soft noise relief read as grey fur; a Voronoi net of polygons with a dark seam round every cell read as a dried
// mud flat.) A joint plane lying nearly in the ground's own plane draws no line (its trace would flood the face).
//   sp: joint spacing (m); fw: the pixel footprint (m); tiltK: how far the faces tilt; Nb: the ground's normal.
//   Returns x = albedo factor (per-block tone, dark joints), y = joint openness 0..1 (for AO), z = the block's id;
//   g = the facets' height gradient (body frame, tangent), already faded by the footprint.
vec3 rk_joints(vec3 P, vec3 up, vec3 Nb, float sp, float fw, float tiltK, float layered, out vec3 g) {
  // two steep joint sets in fixed body-frame directions (~73° apart), and the BEDDING as level courses: its coordinate
  // is the height itself with a gentle regional dip, so beds run along the contours everywhere on the sphere (ledges
  // on a cliff, not stripes)
  const vec3 J1 = vec3(0.788, 0.0, 0.616);
  const vec3 J2 = vec3(-0.35, 0.21, 0.913);
  const vec3 DIP = vec3(0.37, -0.55, 0.75);
  vec3 inv = vec3(1.0, 1.25, 2.1) / sp;
  // a gentle warp (about a fifth of a block): joints wander instead of ruling straight lines
  vec3 wp = P * (0.55 / sp);
  vec3 Q = P + vec3(snoise(wp + 3.1), snoise(wp + 7.7), snoise(wp + 12.9)) * (0.2 * sp);
  vec3 J3 = normalize(up + DIP * 0.12);
  vec3 q = vec3(dot(Q, J1), dot(Q, J2), length(Q) + dot(Q, DIP) * 0.12) * inv;
  // courses: each bed's blocks staggered against the next bed's, each column of a bed too
  float bed = floor(q.z);
  q.x += gn_hash13(vec3(bed, 1.7, 3.3));
  float colm = floor(q.x);
  q.y += gn_hash13(vec3(bed, colm, 9.1));
  vec3 cell = floor(q);
  vec3 f = fract(q);
  vec3 dj = min(f, 1.0 - f) / inv;                       // metres to the nearest joint plane of each set
  // each set's trace on the ground: distance along the ground = plane distance ÷ the plane normal's tangent share
  vec3 Ns = vec3(length(J1 - Nb * dot(J1, Nb)), length(J2 - Nb * dot(J2, Nb)), length(J3 - Nb * dot(J3, Nb)));
  vec3 dl = dj / max(Ns, vec3(0.2));
  vec3 vis = smoothstep(vec3(0.18), vec3(0.4), Ns);
  // the joints' widths: most are tight hairlines, a few gape (each joint face its own); never under ~1.5 pixels, and
  // faded out as the blocks shrink toward a few pixels (from afar the rock is its facets' tone)
  vec3 jh = vec3(gn_hash13(vec3(floor(q.x + 0.5), cell.y, cell.z) + 0.13), gn_hash13(vec3(cell.x, floor(q.y + 0.5), cell.z) + 0.57), gn_hash13(vec3(cell.x, cell.y, floor(q.z + 0.5)) + 0.91));
  vec3 jOpen = smoothstep(0.55, 0.95, jh);
  vec3 jw = sp * (0.004 + 0.022 * jOpen) + fw * 0.75;
  float blockPx = sp / max(fw, 1e-4);
  float lineK = smoothstep(5.0, 14.0, blockPx);
  vec3 line = (1.0 - smoothstep(jw, jw + fw * 1.2, dl)) * vis * mix(vec3(0.35), vec3(1.0), jOpen) * min(vec3(1.0), (sp * (0.004 + 0.022 * jOpen) + fw * 0.4) / jw) * lineK;
  float open = max(max(line.x, line.y), line.z);
  // the face: a random tilt per block in the ground's plane, plus a rounded bevel down into each joint (the gradient
  // points from the joint into the block, strongest a little way in)
  float id = gn_hash13(cell + 0.29);
  vec3 tilt = gn_hash33(cell * 1.37 + 3.1) - 0.5;
  tilt -= Nb * dot(tilt, Nb);
  vec3 bw = vec3(0.1 * sp);
  vec3 bev = (1.0 - smoothstep(vec3(0.0), bw, dl)) * smoothstep(vec3(0.0), bw * 0.3 + fw, dl) * vis;
  vec3 sgn = sign(f - 0.5) * -1.0;                         // +1: the nearer joint is the lower plane (the block lies above it)
  vec3 T1 = (J1 - Nb * dot(J1, Nb)), T2 = (J2 - Nb * dot(J2, Nb)), T3 = (J3 - Nb * dot(J3, Nb));
  // In LAYERED rock (layered → 1) a block's face is not a random facet but the bedding itself: a TREAD parallel to the
  // beds (flatter than the slope) over a RISER, the steep step up from the course below — a hillside of ledges and
  // steps, the way bedded stone weathers. (Random facets alone, however strong, read as crumpled paper.) The shading
  // normal: the beds' normal J3 on the tread, tilted the other way on the riser so the two average to the slope.
  vec3 tread = Nb - J3;
  tread -= Nb * dot(tread, Nb);
  float bedW = (1.0 / inv.z) / max(Ns.z, 0.2);
  const float RF = 0.24;
  float rz = smoothstep(RF - 0.04 - fw / bedW, RF + 0.04 + fw / bedW, f.z);
  vec3 stepG = mix(-tread * ((1.0 - RF) / RF), tread, rz);
  float sgl = length(stepG);
  stepG *= min(1.0, 1.2 / max(sgl, 1e-5));
  g = mix(tilt * tiltK, stepG * 0.9 + tilt * (tiltK * 0.3), layered) + (T1 * sgn.x * bev.x + T2 * sgn.y * bev.y + T3 * sgn.z * bev.z) * 0.9;
  // the facets read while a block holds a dozen pixels, then hand over to the tone alone
  g *= smoothstep(4.0, 12.0, blockPx);
  // (bedded rock: each COURSE its own tone — harder, paler beds and softer, darker ones, banding every step and face —
  // the plainest sign of stone from 50 m to a kilometre; massive rock: each block its own)
  float tone = mix(0.88 + 0.24 * fract(id * 7.31), 0.74 + 0.4 * gn_hash13(vec3(cell.z, 5.3, 2.9)) + 0.06 * (fract(id * 7.31) - 0.5), layered);
  return vec3(mix(mix(1.0, tone, smoothstep(2.0, 6.0, blockPx)), 0.55, open * 0.85), open, id);
}

// 0..1: this fragment is coarse ground under open water seen from afar, standing in for the water's surface (evalTerrain)
float uwFar = 0.0;
TSurf evalTerrain(vec3 P, vec3 Nb, float fw, float camDist) {
  TSurf s;
  uwFar = 0.0;
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
  // OUTCROPS: on ground no plants hold, rock breaks through the soil on crests and ridges — where soil is thinnest in
  // nature — in ragged patches (~30–100 m, broken at ~10 m), more where the soil is thin. (A barren world's mountains
  // are the sim's soil from the summit down — 0.9 m of it on a fresh sandbox's highest peak — and drawn as soil
  // alone every height read as one grey-brown felt from a few hundred metres.)
  float vegC = vF2.x + vF2.y + vF2.z + vF2.w;
  float outc = 0.0;
  if (fw < 12.0) {
    float oN = snoise(P * 0.028 + 5.0) * 0.6 + snoise(P * 0.1 + 9.0) * 0.4 * aaF(fw, 4.0);
    float crestK = smoothstep(0.1, 0.65, -concave);
    outc = smoothstep(0.0, 0.18 + fw * 0.01, crestK * 0.85 + oN * 0.45 - 0.42 + 0.35 * (1.0 - smoothstep(0.25, 1.1, soil)))
      * (1.0 - smoothstep(0.12, 0.45, vegC)) * (uKind > 2.5 && uKind < 3.5 ? 0.5 : 1.0) * (1.0 - smoothstep(7.0, 12.0, fw));
  }

  // ── rock: tonal masses and weathering streaks in the albedo; structure (ledges, fractures) in the bump ──
  vec3 warpV = vec3(snoise(P * 0.045), snoise(P * 0.045 + 7.3), snoise(P * 0.045 + 13.1));
  float big = fbm3(P * 0.022 + warpV * 0.3);
  float strata = (hG + warpV.x * 4.0 + m2 * 1.5) / (uKind > 2.5 && uKind < 3.5 ? 3.2 : 7.0);
  float band = 0.5 + 0.5 * sin(strata * 6.2831853);
  vec3 rock = mix(uRockA, uRockB, clamp(0.5 + 0.6 * big + 0.2 * (band - 0.5) + 0.12 * m1, 0.0, 1.0));
  float rockBump = big * 0.9 + m2 * 0.35;
  float rockJoint = 0.0;
  vec3 rockG = vec3(0.0);
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
    // jointed bedrock (rk_joints): blocks of ~5 m in courses, each a planar facet, split into fragments of ~1.3 m up
    // close — stone, not fur. The facets tilt more on steep faces (blocky cliffs). Only where rock can show — steep
    // faces, ridges, the heights, thin cover, ore outcrops: a closed meadow or wood pays nothing for it
    // (about half the ranges are bedded rock — steps and ledges — the rest massive: the same regional field draws the
    // beds' bands in the albedo below)
    float rkLayered = smoothstep(-0.15, 0.25, snoise(P * 0.004 + 61.0));
    float rockLikely = max(max(steep, smoothstep(0.5, 0.9, -concave)), max(1.0 - smoothstep(0.25, 0.6, soil + vF2.x + vF2.y + vF2.z + vF2.w), smoothstep(0.25, 0.4, vOre.a)));
    rockLikely = max(max(rockLikely, smoothstep(180.0, 220.0, hG - uSeaLevel)), outc);
    // the same three joint sets at the scale of SLABS and ledges (~17 m, beds ~8 m): what bare rock reads by from
    // 100 m to a kilometre — blocky masses, each its own tilt and tone, split by dark open fissures. (With the 5 m
    // blocks alone, which fade out past ~150 m, a bald peak from 130 m was a smooth grey dome: clay, not stone.)
    if (rockLikely > 0.01 && fw < 4.0) {
      vec3 g0;
      // (the facets tilt 10–25°: at 4–8° — a tenth of a radian — the slabs only tinted the light, and soft relief under
      // them still read as grey felt; a real outcrop's slabs and ledges face the sun or turn from it)
      vec3 B0 = rk_joints(P + vec3(41.7, 13.1, 27.9), up, Nb, 17.0, fw, mix(0.55, 0.9, steep), rkLayered, g0);
      rock *= mix(1.0, B0.x, 0.85);
      // (each slab its own tone, ±25 %: weathered, stained, fresh — at ±18 % a crag read as one grey sheet)
      rock *= mix(1.0, mix(0.7, 1.22, fract(B0.z * 9.13)), 0.8 * aaF(fw, 5.0));
      rockG += g0 * 0.8;
      rockJoint = max(rockJoint, B0.y * 0.8);
    }
    if (rockLikely > 0.01 && fw < 1.2) {
      vec3 g1;
      vec3 B1 = rk_joints(P, up, Nb, 5.2, fw, mix(0.4, 0.7, steep), rkLayered, g1);
      rock *= B1.x;
      rockG += g1;
      rockJoint = max(rockJoint, B1.y);
      // per-block weathering: some blocks fresher (paler), some stained darker, a few with a lichen bloom
      float bt = fract(B1.z * 13.7);
      rock *= mix(1.0, mix(0.76, 1.15, bt), 0.7 * aaF(fw, 1.5));
      if (fw < 0.3) {
        vec3 g2;
        vec3 B2 = rk_joints(P * 1.0 + 17.3, up, Nb, 1.35, fw, 0.3, rkLayered * 0.4, g2);
        rock *= mix(1.0, B2.x, 0.6);
        rockG += g2 * 0.6;
        rockJoint = max(rockJoint, B2.y * 0.5);
      }
      // (the facets carry the form now: the soft 5 m relief stays only faintly, or it smears them into fur)
      rockBump -= mid * 0.16;
    }
    // From a few hundred metres to kilometres a mountainside reads by its GULLIES: couloirs scoring the steep faces
    // down the fall line (~18 m wide, drawn out ~5:1 along it), shaded and darker with wet rock and debris, the ribs
    // between them catching the light — not by an even noise relief, which reads as grey fur. The fall line is followed
    // by three ridged noises each stretched along one BODY axis, cross-faded by how well that axis runs down the slope
    // here (a frame turned to the local fall line would make its coordinates P·D(P) race by cycles per metre on a 3 km
    // world: noise, not couloirs). The gully's flanks tilt the shading normal (the noises' own analytic gradients).
    float gullyK = steep * aaF(fw, 16.0);
    if (gullyK > 0.01) {
      vec3 tanG = Nb - up * dot(Nb, up);
      float tlG = length(tanG);
      if (tlG > 1e-3) {
        vec3 wk = pow(abs(tanG / tlG), vec3(4.0));
        wk /= wk.x + wk.y + wk.z;
        vec3 Pw = P + warpV * 6.0;
        float gq = 0.0;
        vec3 dgq = vec3(0.0), g3;
        const vec3 SX = vec3(1.0 / 90.0, 1.0 / 18.0, 1.0 / 18.0), SY = vec3(1.0 / 18.0, 1.0 / 90.0, 1.0 / 18.0), SZ = vec3(1.0 / 18.0, 1.0 / 18.0, 1.0 / 90.0);
        if (wk.x > 0.05) { gq += snoiseGrad(Pw * SX + 7.3, g3) * wk.x; dgq += g3 * SX * wk.x; }
        if (wk.y > 0.05) { gq += snoiseGrad(Pw * SY + 3.1, g3) * wk.y; dgq += g3 * SY * wk.y; }
        if (wk.z > 0.05) { gq += snoiseGrad(Pw * SZ + 5.9, g3) * wk.z; dgq += g3 * SZ * wk.z; }
        float rq = 1.0 - abs(gq);
        float tq = clamp((rq - 0.55) / 0.4, 0.0, 1.0);
        float gully = tq * tq * (3.0 - 2.0 * tq);
        rock *= 1.0 - 0.38 * gully * gullyK;
        dgq -= up * dot(dgq, up);
        // (the couloirs' flanks shade only from a few hundred metres out, where they ARE the mountainside's texture:
        // nearer, their crests drew a net of soft creases over every crag — crumpled paper, not stone)
        rockG += dgq * (2.4 * 6.0 * tq * (1.0 - tq) / 0.4 * sign(gq)) * gullyK * 0.5 * smoothstep(220.0, 520.0, camDist);
      }
    }
    // weathering in the albedo at 4–30 m, what bare rock reads by from 50 m to a kilometre besides its joints: rust
    // stains bleeding from iron in the stone (warm ochre-brown, in runs down steep faces), dark wet / organic streaks
    // and patches, paler freshly broken faces (where blocks fell: on the steepest ground) — value and a little hue, so
    // a mountainside is mottled stone, not one even grey. (Soft grey alone read as fur, then as crumpled paper.)
    {
      float stN = snoise(P * vec3(0.07, 0.07, 0.07) + warpV * 1.5 + 23.0) * 0.6 + snoise(P * 0.19 + 41.0) * 0.4 * aaF(fw, 5.0);
      float rust = smoothstep(0.15, 0.75, stN) * (0.6 + 0.4 * steep);
      rock = mix(rock, rock * vec3(1.32, 1.0, 0.72) + vec3(0.025, 0.008, 0.0), rust * 0.55 * (uKind < 0.5 ? 1.0 : uKind < 2.5 ? 0.12 : 0.5));
      float darkS = smoothstep(0.2, 0.7, -stN + 0.3 * snoise(P * 0.5 + 9.0) * aaF(fw, 2.0));
      rock *= 1.0 - 0.32 * darkS;
      float fresh = smoothstep(0.4, 0.75, snoise(P * 0.11 + 77.0)) * smoothstep(0.25, 0.5, slope);
      rock = mix(rock, rock * 1.25 + 0.015, fresh * 0.6);
    }
    // lichen on damp, gentler rock (terran only): grey-green crusts and, on the drier sunny faces, orange ones, in
    // patches of a metre or two
    if (!airless) {
      float lichN = snoise(P * 0.33) * 0.5 + 0.5;
      float lich = smoothstep(0.35, 0.8, moist) * smoothstep(0.2, 0.7, lichN) * (1.0 - steep * 0.6);
      rock = mix(rock, vec3(0.08, 0.095, 0.05), lich * 0.4);
      float lichO = smoothstep(0.62, 0.85, snoise(P * 0.71 + 13.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.5, 0.9, moist)) * aaF(fw, 1.5);
      rock = mix(rock, vec3(0.3, 0.16, 0.05), lichO * 0.45);
    }
  }
  vec3 col = rock;
  float rough = 0.84;
  float bump = rockBump;
  // how much of what shows is still the bare rock (its joints darken the ambient at the end)
  float rockW = 1.0;
  // strength of the close-up micro relief (0.2–2 m: grain, clods, tufts), blended through the layers like the bump
  // (on bare rock only a little: the blocks' facets carry its form, and a strong soft micro noise read as fur)
  float mk = 0.1;
  float ao = 1.0;
  float spec = 0.5;
  vec3 emis = vec3(0.0);

  // ── regolith (airless) / soil ──
  // noise-broken thresholds: per-cell fields change linearly across 50 m triangles, the noise hides those edges
  float soilW = smoothstep(0.1, 0.9, soil + m1 * 0.45 + m2 * 0.25) * (1.0 - steep * 0.85) * (1.0 - outc);
  // where plants grow there is earth under them: the gaps of a thin sward show soil, not the bedrock grey (partial
  // cover on uplands read as blue-grey rock blotches between the grass); rock stays on steep faces and ridges
  if (!airless) soilW = max(soilW, smoothstep(0.04, 0.3, vF2.x + vF2.y + vF2.z + vF2.w) * (1.0 - steep * 0.9) * 0.9);
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
      // RILLS: on bare slopes the rain cuts the soil into runnels down the fall line (~7 m apart, drawn out ~6:1 along
      // it), damp and darker in their beds, the ribs between them paler and drier — what bare earth reads by from a
      // few hundred metres (an even soft noise there read as felt). The fall line by three ridged noises each stretched
      // along one body axis, cross-faded by how well that axis runs downhill here (as the rock's gullies).
      float bareS = (1.0 - smoothstep(0.05, 0.35, vegC)) * smoothstep(0.025, 0.1, slope) * aaF(fw, 6.0);
      if (bareS > 0.01) {
        vec3 tanR = Nb - up * dot(Nb, up);
        float tlR = length(tanR);
        if (tlR > 1e-4) {
          vec3 wr = pow(abs(tanR / tlR), vec3(4.0));
          wr /= wr.x + wr.y + wr.z;
          vec3 Pr = P + warpV * 5.0;
          float rq = 0.0;
          if (wr.x > 0.05) rq += snoise(Pr * vec3(1.0 / 42.0, 1.0 / 7.0, 1.0 / 7.0) + 2.3) * wr.x;
          if (wr.y > 0.05) rq += snoise(Pr * vec3(1.0 / 7.0, 1.0 / 42.0, 1.0 / 7.0) + 6.1) * wr.y;
          if (wr.z > 0.05) rq += snoise(Pr * vec3(1.0 / 7.0, 1.0 / 7.0, 1.0 / 42.0) + 9.7) * wr.z;
          float rill = smoothstep(0.62, 0.95, 1.0 - abs(rq));
          sc *= 1.0 - 0.28 * rill * bareS;
          sc *= 1.0 + 0.14 * smoothstep(0.15, 0.65, abs(rq)) * bareS;
          sb -= rill * 0.18 * bareS;
        }
      }
      // clods, cracks, damp patches and pebbles at 1 cm–2 m (groundfloor.ts soilDetail)
      if (fw < 0.12 && soilW > 0.05) {
        vec3 sd = soilDetail(P, fw);
        sc *= sd.x;
        sc = mix(sc, vec3(0.18, 0.165, 0.14) * (0.8 + 0.4 * fract(sd.z * 37.0 + m2)), sd.z);
        sb += sd.y;
      }
    }
    col = mix(col, sc, soilW);
    bump = mix(bump, sb, soilW);
    rockW *= 1.0 - soilW;
    rough = mix(rough, 0.92, soilW);
    mk = mix(mk, 0.3, soilW);
  }

  // ── maria (dark basalt on moons, mapped from 'ash' on airless worlds) / volcanic ash ──
  if (ash > 0.005) {
    float aw = smoothstep(0.02, 0.3, ash + m2 * 0.05);
    vec3 ac = airless ? uRegolith * 0.42 : vec3(0.075, 0.072, 0.07);
    col = mix(col, ac * (0.9 + 0.2 * m1), aw);
    rockW *= 1.0 - aw;
    rough = mix(rough, 0.95, aw);
  }

  // ── vegetation: grass / dry grass, shrubs, forest canopy, farm fields ──
  float vegTotal = grass + shrub + tree + crop;
  // the far canopy's weight and crown shape here (snow lies in the gaps and on the crowns' tops, the crowns' flanks
  // stay dark)
  float canopyW = 0.0, canopyCrown = 0.0;
  // how tall the sward stands here (0 the gaps between the tufts .. 1 the tips of the tussocks; its mean where the
  // tufts are finer than a pixel): a thin snow fills the gaps first and the tips show through it
  float swardTop = 0.5;
  // the shrubs' crowns here (their share where a crown is finer than a pixel): a thin snow lies between them, not on them
  float shrubLocal = 0.0;
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
    // tufts, tips and gaps (groundfloor.ts swardDetail): the sward's own texture at 3–60 m
    vec3 vEye = normalize(transpose(uBodyToView) * normalize(vViewPosition));
    vec4 swd = swardDetail(P, fw, dot(up, vEye));
    swardTop = clamp(0.45 + 0.75 * swd.y - 0.6 * swd.w, 0.0, 1.0);
    gcol *= swd.x;
    gcol = mix(gcol, gcol * vec3(1.24, 1.13, 0.7), swd.y * 0.32 * (1.0 - cold * 0.5));
    // (the ~4 m clumps only faintly in the relief: at ±5 cm their slopes, raked by a low sun, printed an even field of
    // lit and shaded dimples a few metres apart — a quilted felt over every meadow at dusk; they show in the colour)
    float gBump = clump * 0.012 + blades * 0.02 + swd.z;

    vec3 vcol = gcol;
    float vb = gBump;
    float vao = 1.0 - 0.32 * swd.w;
    // shrubs: clumpy blobs over grass
    if (shrub > 0.01) {
      float sw = smoothstep(0.15, 0.7, shrub + m2 * 0.3);
      vec3 sv = fine ? voronoi3((P + warpV * 2.5) * 0.36) : vec3(0.5, 0.8, 0.5);
      // (thin cover: only some cells hold a bush — by the cell's own id against the cover — and each crown's outline is
      // broken by a little noise: a bush in every 2.8 m cell, every one round, spread a regular dot grid over the land
      // that a dusting of snow turned into a dalmatian print)
      float keepS = fine ? smoothstep(sv.z - 0.12, sv.z + 0.12, mix(0.3, 1.1, sw)) : 1.0;
      float edgeS = fine ? snoise(P * 0.9 + 3.7) * 0.12 * aaF(fw, 0.6) : 0.0;
      float blobRaw = (1.0 - smoothstep(0.15, 0.75, sv.x + edgeS)) * keepS;
      float blob = blobRaw * aaF(fw, 2.0);
      shrubLocal = sw * mix(0.45 * mix(0.3, 1.1, sw), blobRaw, aaF(fw, 2.0));
      vec3 shc = mix(vec3(0.045, 0.07, 0.025), vec3(0.09, 0.09, 0.04), cold * 0.5 + sv.z * 0.4);
      float cover = sw * mix(0.65, 1.0, blob);
      vcol = mix(vcol, shc, cover * mix(0.55, 1.0, blob));
      vb += blob * 0.18 * sw;
      vao *= mix(1.0, 0.85 + 0.15 * blob, sw);
    }
    // forest canopy: crowns as Voronoi domes, gaps dark (where trees are not instanced)
    if (tree > 0.01) {
      // woods break up at the scale of groves (m1, ~80 m), not in 16 m blotches against the sward (camouflage)
      // settled land (lit houses — the per-cell light — or worn ways) is cleared: the scatter draws its few trees,
      // the ground between them is the town's sward, not a forest floor (a dry tropical floor of laterite and leaf
      // litter laid an orange-brown carpet under a whole town wherever the cell's tree cover was high)
      float settled = max(smoothstep(0.05, 0.5, vF5.z), smoothstep(0.25, 0.6, road));
      float tw = smoothstep(0.08, 0.55, tree + m1 * 0.3 + m2 * 0.03) * (1.0 - 0.85 * settled);
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
      canopyW = cover; canopyCrown = crown;
      // (additive, quality pass) the crowns' relief rounds off into the gaps between them (the border distance's
      // smoothstep has no slope at the border: no crease for the screen-derivative normals to turn into dotted black
      // seams), and both the relief and the gaps' shade fade out while a crown is still several pixels across — at
      // distance the canopy is a soft texture, not quilted scales
      float crownH = (1.0 - smoothstep(0.0, rad, tv.x)) * smoothstep(0.0, 0.3, tv.y - tv.x);
      float reliefAA = aaF(fw * 2.5, 1.0 / scale);
      vb = mix(vb, crownH * 1.6 * reliefAA + leaf * 0.15, tw * (1.0 - inst));
      vao *= mix(1.0, mix(0.62, 1.0, crown), tw * reliefAA * (1.0 - inst));
      if (inst > 0.0) {
        // the forest floor (groundfloor.ts): litter / duff, twigs, roots, stones, moss, canopy sky occlusion — wherever
        // the instanced trees really shade the ground (ff_canopy), not only where the cell's tree field is high
        float shadeK = ff_canopy(P, up, Nb, dot(up, uSunDirBody)) * smoothstep(0.01, 0.05, tree);
        // (in a town the shade is mostly the houses': it makes no forest floor there)
        float twc = max(tw, shadeK * (1.0 - settled));
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
      // rows run across a FIXED direction per field (P·rnd: a direction tangent at P itself gives P·d ≡ 0 — every field
      // was a flat sheet with no rows at all)
      float rows = sin(dot(P, rnd) * 6.2831853 / 1.5) * aaF(fw, 1.5);
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
      // close up, the standing crop (render/life instanced stalks) is the field's colour: the ground between the stalks
      // is shaded soil with straw litter, not the field's gold painted on as a sheet (a sandy dune under the wheat)
      if (k < 3.5) {
        float under = (1.0 - smoothstep(14.0, 45.0, camDist)) * smoothstep(0.35, 0.6, crop);
        // (litter is a scatter in the soil's own value range, domain-warped: pale straw blotches at 3× the soil's
        // brightness read as a desert-camouflage print at 15 m)
        vec3 sq = P * 3.1 + vec3(snoise(P * 0.8 + 1.0), snoise(P * 0.8 + 4.0), snoise(P * 0.8 + 7.0)) * 0.9;
        float straw = smoothstep(0.45, 0.9, snoise(sq + 2.0) * 0.5 + 0.5 + 0.2 * snoise(P * 9.0) * aaF(fw, 0.11)) * aaF(fw, 0.25);
        cc = mix(cc, mix(vec3(0.085, 0.062, 0.04), vec3(0.135, 0.108, 0.062), straw), under * 0.8);
      }
      // hedgerows grow round old farmland: a first season's plots are bare strips with grass between them
      float mature = smoothstep(0.25, 0.5, crop);
      float hedge = (1.0 - smoothstep(0.0, 0.035 + fw * 0.004, fv.y - fv.x)) * aaF(fw, 20.0) * mature;
      cw *= mix(smoothstep(0.0, 0.06 + fw * 0.004, fv.y - fv.x), 1.0, mature);
      cc = mix(cc, vec3(0.025, 0.05, 0.018), hedge * 0.85);
      vcol = mix(vcol, cc, cw);
      vb = mix(vb, rows * 0.06 + hedge * 1.2, cw);
      vao *= mix(1.0, 1.0 - hedge * 0.35, cw);
    }
    // per-cell cover is linear across 50 m triangles: noise in the threshold turns those edges into organic margins.
    // Partial cover is turf broken by small outcrops and bare scars (~5–16 m, crisp-edged), not half the hillside in
    // soft 80 m blotches of rock grey against green — that read as camouflage from 30–60 m up
    float vegN = m1 * 0.16 + m2 * 0.12 + snoise(P * 0.21 + warpV) * 0.14;
    float vegW = max(smoothstep(0.1, 0.42, vegTotal + vegN) * (1.0 - steep * 0.8), fieldW);
    col = mix(col, vcol, vegW);
    bump = mix(bump, vb, vegW);
    rockW *= 1.0 - vegW;
    // (turf is a mat of blades, not a dimpled skin: at 0.45 a low sun drew a hammered-metal egg-crate over every meadow;
    // the tufts' own relief, swardDetail, carries the close-up grain now)
    mk = mix(mk, 0.08, vegW);
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
    rockW *= 1.0 - sw;
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
      rockW *= 1.0 - beach;
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
      mk = mix(mk, 0.1, bare);
      rockW = mix(rockW, 1.0, bare);
      ao = mix(ao, 1.0, bare);
    }
  }

  // ── ore outcrops (LIVING H12): where the sim's ore field is rich the bedrock breaks through its cover in ledges and
  // boulder fields stained by what it carries — malachite green over copper, rust-red gossan over iron, black seams of
  // coal and obsidian, white and yellow crusts of salt, saltpetre and sulfur, quartz veins with metal glints over gold
  // and silver — while soft deposits (clay banks, glass sand) show as bare coloured earth. Patches of 5–30 m, broken by
  // noise, so a prospector and the god can read the hills; from afar they average into a faint tint of the deposit.
  float oreA = vOre.a;
  if (oreA > 0.04 && uw < 0.4) {
    vec3 oreC = vOre.rgb / max(oreA, 1e-4);
    float oLum = dot(oreC, vec3(0.2126, 0.7152, 0.0722));
    float oMax = max(oreC.r, max(oreC.g, oreC.b));
    float oSat = (oMax - min(oreC.r, min(oreC.g, oreC.b))) / max(oMax, 1e-3);
    // the deposit's character from its colour: dark (coal, obsidian, oil), pale (salt, saltpetre, glass sand), earthy
    // orange (clay) — the soft ones are not bedrock
    float darkO = 1.0 - smoothstep(0.015, 0.05, oLum);
    float paleO = smoothstep(0.4, 0.7, oLum) * (1.0 - smoothstep(0.35, 0.6, oSat));
    float clayO = smoothstep(0.12, 0.2, oLum) * smoothstep(0.55, 0.75, oSat) * step(oreC.b * 1.8, oreC.g) * (1.0 - paleO);
    float softO = max(paleO, clayO);
    float pn = snoise(P * 0.045 + 31.0) * 0.32 + snoise(P * 0.17 + 7.0) * 0.16 * aaF(fw, 6.0) + snoise(P * 0.6 + 3.0) * 0.06 * aaF(fw, 1.6);
    // (outcrops in patches even over the richest deposit — about half the ground there, a fifth at middling richness,
    // a few boulders over a poor one — with the land's own cover between them)
    float pq = pn * 0.95 + 0.5;
    // (a crisp, ragged rim: rock breaks through the turf along a line, it does not fade into it — at a ramp of 0.08 the
    // outcrops were soft blue-grey blotches, puddles rather than stone)
    // (the ramp keeps at least ~a pixel's worth of the noise's change: a step under a pixel drew the rim in jaggies)
    float outW = smoothstep(1.0 - 0.5 * oreA, 1.025 + fw * 0.12 - 0.5 * oreA, pq) * (1.0 - smoothstep(0.0, 0.4, uw));
    // the turf round an outcrop is thin: browner, with loose stones weathered off the rock scattered in it (a uniformly
    // darker band round every patch read as an outline drawn on the map)
    float rim = smoothstep(0.93 - 0.5 * oreA, 1.0 - 0.5 * oreA, pq) * (1.0 - outW) * (1.0 - smoothstep(0.0, 0.4, uw)) * (1.0 - softO);
    if (rim > 0.001) {
      col = mix(col, col * vec3(1.08, 0.97, 0.82), rim * 0.5);
      float sAA = aaF(fw, 1.8);
      if (sAA > 0.0) {
        vec3 sv = voronoi3(P * 1.1 + 5.3);
        float stone = (1.0 - smoothstep(0.18, 0.3 + fw * 0.3, sv.x)) * step(0.55, sv.z) * rim * sAA;
        col = mix(col, rock * (0.85 + 0.35 * fract(sv.z * 13.1)), stone);
        bump += stone * 0.12 * (1.0 - smoothstep(0.0, 0.3, sv.x));
      }
    }
    // (from afar: the deposit's colour faintly in the ground, where single outcrops are too small to draw)
    float farK = 1.0 - aaF(fw, 8.0);
    col = mix(col, col * mix(vec3(1.0), oreC / max(oLum, 0.02) * 0.5 + 0.5, 0.25), smoothstep(0.25, 0.7, oreA) * farK * 0.6);
    if (outW > 0.001) {
      // the outcrop: a jumble of weathered blocks and boulders (~2.5 m) breaking through — each a rounded mass of its own
      // tone with shadowed gaps between them, on the planet's jointed rock (rock already carries the joints) — or bare
      // earth for a soft deposit. (A flat patch of rock colour, however stained, read as a puddle in the grass.)
      vec3 oc = rock * vec3(0.9, 0.85, 0.8);
      float ob = rockBump;
      // (the boulders break up the outcrop's MARGIN — its heart is the jointed bedrock the rock layer already draws: a
      // jumble of equal boulders over the whole patch read as a tiled mosaic)
      float bAA = aaF(fw, 2.5) * (1.0 - softO) * (1.0 - smoothstep(0.25, 0.75, outW) * 0.7);
      if (bAA > 0.0) {
        vec3 bv = voronoi3(P * 0.4 + warpV * 0.6);
        float be = bv.y - bv.x;
        float dome = smoothstep(0.0, 0.45, be);
        float gap = (1.0 - smoothstep(0.015, 0.07 + fw * 0.25, be)) * bAA;
        oc *= mix(1.0, (0.82 + 0.32 * bv.z) * (1.0 - 0.6 * gap), bAA);
        ob = mix(ob, dome * 0.9 + bv.z * 0.4, bAA);
      }
      oc = mix(oc, mix(uRegolith, oreC, 0.55) * (0.85 + 0.3 * m1), softO);
      ob = mix(ob, m2 * 0.2, softO);
      // metal ores weather to GOSSAN: rust-brown iron oxides over most of the surface, in runs and blotches (~3 m); the
      // ore's own colour — malachite and azurite over copper, sulfur yellow, gold's quartz — blooms in patches through it,
      // the rock showing between (a wash of the ore's colour over the whole outcrop read as a pale puddle)
      float stainN = snoise(P * 0.33 + warpV * 2.0 + 17.0) * 0.6 + snoise(P * 1.3 + 5.0) * 0.4 * aaF(fw, 0.8);
      // (the gossan held back on a strongly coloured ore and its own stain spread wider and stronger: a copper outcrop
      // from a god's 100 m read as one more grey-brown crag — its malachite green has to tell it from iron's rust and
      // tin's grey, or the player cannot read the hills)
      float gossan = smoothstep(-0.35, 0.25, snoise(P * 0.21 + warpV + 3.3)) * (1.0 - softO) * (1.0 - darkO) * (1.0 - paleO);
      oc = mix(oc, oc * vec3(1.2, 0.86, 0.62) + vec3(0.022, 0.006, 0.0), gossan * 0.55 * (1.0 - 0.5 * oSat));
      float stain = smoothstep(0.02, 0.5, stainN) * (0.45 + 0.55 * oSat);
      oc = mix(oc, oc * 0.25 + oreC * 0.95, stain * 0.85 * (1.0 - darkO * 0.5));
      // veins along the fractures (thin ridged noise), faded to their share where a pixel cannot hold them
      float vr = 1.0 - abs(snoise((P + warpV * 3.0) * 0.32 + 5.0));
      float vein = smoothstep(0.88, 0.97, vr) * aaF(fw, 0.5);
      float veinMean = 0.06 * (1.0 - aaF(fw, 0.5));
      oc = mix(oc, oreC * 1.1, (vein + veinMean) * (1.0 - softO) * 0.9);
      // dark seams in bands along the strata (coal, obsidian)
      float seamB = smoothstep(0.35, 0.65, sin((hG + warpV.x * 3.0 + m1 * 2.0) * 1.9) * 0.5 + 0.5);
      oc = mix(oc, oreC * 0.9 + 0.01, darkO * mix(0.5, seamB, aaF(fw, 1.5)) * 0.9);
      // crusts of efflorescence on pale deposits, patchy
      float crustP = smoothstep(0.35, 0.7, snoise(P * 0.42 + 3.0) * 0.5 + 0.5 + 0.2 * snoise(P * 1.7) * aaF(fw, 0.6));
      oc = mix(oc, oreC * 0.95, paleO * crustP * 0.85);
      col = mix(col, oc, outW);
      bump = mix(bump, ob + vein * 0.03, outW);
      rough = mix(rough, mix(0.8, 0.55, vein), outW);
      mk = mix(mk, 0.1, outW);
      rockW = mix(rockW, 1.0 - softO, outW);
      // metal glints in the veins (bright, saturated ores: gold, copper, silver)
      if (veryFine && vein > 0.4 && oLum > 0.1) s.glint = max(s.glint, gn_hash13(floor(P * 30.0)));
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
  float snowW = 0.0;
  if (snow > 0.002) {
    // the sim's snow is a depth (m: 1 mm of water ≈ 1 cm). A dusting of 1–2 cm already whitens the bare ground and the
    // gaps of the sward in patches; ~6 cm is a white field through which only tussocks show; deep snow buries the
    // shrubs (it needs ~0.3 m more where they stand). Snow does not hold on cliffs: faces past ~45° show their rock.
    // Partial cover follows the land, not noise: shaded (pole-facing / away from the sun) slopes and hollows keep it,
    // sunny convex ground melts out first; drifts pile in the lee of the wind.
    vec3 tanN = Nb - up * dot(Nb, up);
    vec3 sunT = uSunDirBody - up * dot(uSunDirBody, up);
    float aspectSun = dot(tanN, normalize(sunT + 1e-5)) * 2.5;
    float hollow = clamp(concave * 2.5, -1.0, 1.0);
    float thin = 1.0 - smoothstep(0.08, 0.4, snow);
    float sd = snow * (1.0 + 0.35 * hollow * thin - 0.25 * clamp(aspectSun, -1.0, 1.0) * thin) + (m2 * 0.007 + m1 * 0.006) * thin * smoothstep(0.0, 0.03, snow);
    // a thin cover melts out first in broad, irregular patches (~15–30 m) where it is thinnest
    float meltN = snoise(P * 0.045 + warpV * 0.6) * 0.7 + snoise(P * 0.13 + 3.0) * 0.3 * aaF(fw, 4.0);
    float keep = smoothstep(-0.45, 0.25, meltN + (sd - 0.02) * 25.0);
    sd *= mix(mix(0.55, 1.0, keep), 1.0, 1.0 - thin);
    // The snow lies AMONG the plants: on bare ground a centimetre whitens it; in a meadow it fills the gaps between the
    // tufts first and the tips of the tussocks show through it (swardTop: the sward's own tufts, tips and gaps — so a
    // dusting is white ground stippled by the grass that stands out of it, not a camouflage of blotches), and the
    // meadow is white once the snow is deeper than the sward (~8 cm). Where the tufts are finer than a pixel the
    // threshold's spread stands for them (the same mean coverage, no speckle); shrubs need ~0.4 m to be buried.
    float grassK = smoothstep(0.05, 0.6, grass + crop * 0.5) * (1.0 - fieldW * 0.5);
    // (the sward's tips and gaps move the local threshold by ±1.5 cm: at ±3.5 cm a 3–4 cm cover over a meadow came out
    // as a grey-green camouflage of half-buried tussocks from 30–60 m — a dirty fog — where a real meadow under that much
    // snow is a white field stippled by the tallest tufts)
    float swA = 0.03 * grassK;
    float swRes = aaF(fw, 0.45);
    float sOff = (0.5 - swardTop) * swA * swRes;
    float sWid = 0.5 * swA * (1.0 - swRes);
    // (half the sward is buried at ~1.8 cm, over a narrow ramp: where the tufts are drawn their tips and gaps make a
    // crisp stipple, not a grey veil)
    float sC = 0.006 + 0.012 * grassK, sW = 0.004 + 0.004 * grassK + sWid;
    float full = smoothstep(sC - sW, sC + sW, sd + sOff);
    // (the shrubs stand out of a thin cover where they grow — crown by crown — until it is deep enough to bury them: a
    // uniform share taken off the cover laid a grey veil over every shrubby meadow instead of white ground and dark bushes)
    // (a crown catches some of the snow on its top — in patches of a few decimetres — so a bush in a dusting is dark
    // green flecked white, not a clean dark spot)
    float crownSnow = 0.55 + 0.35 * smoothstep(-0.3, 0.5, snoise(P * 2.3 + 11.0)) * aaF(fw, 0.3);
    full *= 1.0 - shrubLocal * (1.0 - smoothstep(0.12, 0.42, sd)) * crownSnow;
    float sw = full * (1.0 - smoothstep(0.3, 0.55, slope));
    // under a canopy (the forest floor's weight) the crowns catch part of the snow, and litter, twigs and stones poke
    // through a thin cover; the floor keeps its canopy occlusion (ao below)
    // (a wide ramp: the litter's leaf-scale height on a narrow one made a dithered snow edge up close)
    if (ffW > 0.0) sw *= (1.0 - 0.5 * ffW) * (1.0 - ffW * smoothstep(0.005, 0.085, ffl.bump) * (1.0 - smoothstep(0.4, 0.9, snow)));
    // the far canopy: snow on the crowns' tops and in the clearings, dark flanks between (a snowy forest from afar is
    // grey-white and speckled, not a white sheet)
    sw *= 1.0 - canopyW * mix(0.7, 0.35, canopyCrown) * (1.0 - 0.4 * smoothstep(0.3, 1.0, snow));
    vec3 sc = vec3(0.78, 0.81, 0.86) * (0.93 + 0.08 * m1);
    // wind-packed crust is greyer, fresh drifts whiter; sastrugi and drifts give the shading its grain
    sc *= mix(0.9, 1.04, smoothstep(-0.4, 0.5, m2));
    // the snow's own relief: broad, gentle drifts (~6 and ~16 m) and, up close, sastrugi — low ridges drawn out across
    // the wind (two fixed body-frame directions stand in for it) — never an even field of dimples (at ±0.5 m on 6 m and
    // ±0.08 m on 1 m a snowfield read as dimpled foam from 30–100 m)
    float sast = 0.0;
    if (veryFine) {
      const vec3 WS = vec3(0.62, 0.15, -0.77), WT = vec3(0.47, 0.75, 0.47);
      sast = snoise(vec3(dot(P, WS) * 0.3, dot(P, WT) * 2.4, 5.1) + warpV * 0.8) * aaF(fw, 0.45);
    }
    float drift = fine ? snoise(P * 0.17) * 0.2 + sast * 0.035 + m2 * 0.35 : m2 * 0.35;
    // (a thin cover keeps the ground's relief under it)
    col = mix(col, sc, sw);
    snowW = sw;
    bump = mix(bump, mix(bump * 0.6 + drift * 0.3, drift, 1.0 - thin), sw);
    rough = mix(rough, 0.55, sw);
    mk = mix(mk, 0.05, sw);
    ao = mix(ao, 1.0, sw * (1.0 - ffW));
    spec = mix(spec, 0.6, sw);
    rockW *= 1.0 - sw;
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
  // On a steep rim, or seen from 50 m up, that band is thinner than a pixel and would alias into a dotted outline: it
  // widens to at least ~1.5 pixels (in height above the water) and softens instead — a continuous wet line along every
  // shore, never dashes (fading it out instead left only the water's own specks of film: a dotted shoreline)
  float uwPx = fwidth(uw);
  // (no hard edges: the band rises smoothly from dry ground and runs on under the water's edge, so where the water
  // mesh ends along a sim triangle there is no seam of dry-then-wet pixels to trace it in dashes)
  float wLo = min(-0.36 + m2 * 0.1, -0.04 - uwPx * 1.5);
  float shoreWet = smoothstep(wLo, -0.04, uw) * (1.0 - smoothstep(0.1 + uwPx, 0.5 + uwPx * 2.0, uw));
  shoreWet *= (1.0 - smoothstep(0.2, 0.45, vegTotal)) * mix(1.0, 0.6, smoothstep(0.04, 0.4, uwPx));
  // (snow lying on wet ground is white: the darkening follows what the snow leaves uncovered, not its depth alone)
  float wet = clamp(max(wetF * 0.85, shoreWet), 0.0, 1.0) * (1.0 - smoothstep(0.1, 0.4, snow)) * (1.0 - snowW);
  // forest floors and meadows are not wet mirrors: the canopy and the sward take the water
  wet *= 1.0 - 0.75 * clamp(tree + 0.5 * grass, 0.0, 1.0);
  col *= mix(1.0, 0.55, wet * (1.0 - clamp(vegTotal, 0.0, 1.0) * 0.6));
  // wet soil and litter stay rough (0.35); only bare rock and sand film over glossy
  float wetFloor = mix(0.18, 0.35, clamp(soil * 2.0 + vegTotal, 0.0, 1.0));
  rough = mix(rough, wetFloor, wet * 0.85);

  // ── under water: silt and sand floor ──
  // (every change at the waterline ramps in over ~25 cm of depth: a step at uw = 0 in the colour, and above all in the
  // bump height — whose screen derivative spikes along the contour, quad by quad — drew a dotted black line along
  // every shore, with or without the water sheet)
  if (uw > 0.0) {
    float d = smoothstep(0.0, 6.0, uw);
    float inW = smoothstep(0.0, 0.25, uw);
    vec3 floorC = mix(uSandCol * 0.5, vec3(0.09, 0.085, 0.065), smoothstep(1.0, 12.0, uw)) * (0.85 + 0.25 * m1);
    col = mix(col, floorC, max(d, 0.6) * (1.0 - steep * 0.5) * inW);
    rough = mix(rough, 0.35, 0.7 * inW);
    mk = mix(mk, 0.05, max(d, 0.6) * inW);
    // seen from afar a coarse patch's ground and the water sheet over it meet within the depth buffer's reach, and the
    // ground's own fragments can stand in front of the water: they take the open water's look (a dark blue body, a
    // glossy mirror of the sky — FRAG_AMBIENT lets them reflect) instead of a dark silt bed, so no lake is ever a black
    // hole in the land (uwFar, shared with the ambient)
    uwFar = smoothstep(0.6, 2.5, fw) * smoothstep(0.3, 1.5, uw);
    col = mix(col, vec3(0.012, 0.028, 0.04), uwFar);
    rough = mix(rough, 0.07, uwFar);
    spec = mix(spec, 1.0, uwFar);
    bump *= 1.0 - uwFar;
  }

  // ── lava (the mesh stands on its depth: VERT_MAIN) ──
  // A flow is mostly CRUST: plates (~7 m) of black glassy basalt riding on the melt, with ropy folds across the flow.
  // It glows only where the crust tears — the tears between plates, wider and hotter where the flow is deep and young
  // (thin sheets have crusted over: black margins) — in a few winding channels of open melt on its deepest ground
  // (carrying rafts of crust), and at the toe where it advances and breaks open in lobes. A finer set of shrinkage
  // cracks (~2 m) only darkens the crust, glowing on the hottest ground alone. Cracks fade to their share of glow by the
  // pixel footprint (from afar a flow is a dark body veined with red, never a glitter). (Every crack of both sets
  // glowing over the whole flow read as red crushed gravel by day and a leopard print at dusk.)
  if (lava > 0.01) {
    vec3 tanD = Nb - up * dot(Nb, up);
    float tl = length(tanD);
    vec3 downD = tl > 1e-4 ? tanD / tl : vec3(0.0);
    float lobe = snoise(P * 0.08 + 3.0) * 0.6 + snoise(P * 0.27 + 9.0) * 0.3 * aaF(fw, 3.0);
    float lw = smoothstep(0.03, 0.12, lava + lobe * 0.05);
    float heat = smoothstep(0.25, 2.5, lava + lobe * 0.3);
    // (the crust stands still: offset along the local fall line by time, its pattern sheared apart as a game ran on —
    // the offset grows without bound while the fall line turns from pixel to pixel; the melt's life is in its flicker)
    vec3 lp = P;
    float k1 = aaF(fw, 3.5), k2 = aaF(fw, 1.0);
    float crack1 = 0.0, crack2 = 0.0, plate = 0.5, edge1 = 1.0;
    if (k1 > 0.0) {
      // (the plates' cells warped by ~half a plate: an unwarped Voronoi is a tiling of convex polygons — crazy paving,
      // a 'floor is lava' tile — where a real crust breaks into irregular, bent and drawn-out slabs)
      vec3 lpw = lp + vec3(snoise(lp * 0.055 + 1.3), snoise(lp * 0.055 + 5.1), snoise(lp * 0.055 + 9.7)) * 3.6;
      vec3 v1 = voronoi3(lpw * 0.14);
      edge1 = v1.y - v1.x;
      // each tear its own width: centimetres on cooling crust, ~0.4 m on a young deep flow
      float w = mix(0.006, 0.05, heat) * (0.6 + 0.8 * fract(v1.z * 91.7));
      crack1 = (1.0 - smoothstep(w, w + fw * 0.21 + 0.004, edge1)) * k1;
      plate = mix(plate, v1.z, k1);
    }
    if (k2 > 0.0) {
      vec3 v2 = voronoi3(lp * 0.5 + 7.3);
      crack2 = (1.0 - smoothstep(0.015, 0.019 + fw * 0.75, v2.y - v2.x)) * k2;
    }
    // what a pixel too coarse for the tears still sees: their share of glow
    float crackMean = mix(0.02, 0.08, heat) * (1.0 - k1);
    // open melt in a few winding channels on the deepest ground, with rafts of crust
    float chR = 1.0 - abs(snoise(lp * 0.025 + vec3(5.0, 1.0, 3.0)) + 0.25 * snoise(lp * 0.08 + 2.0));
    float chan = smoothstep(0.92, 0.975, chR) * smoothstep(1.6, 2.8, lava + lobe * 0.3);
    if (chan > 0.001) {
      vec3 vr = voronoi3(lp * 0.45 + 2.0);
      // (a raft: the inside of every fourth cell, its rim melting into the stream)
      float raft = step(0.72, vr.z) * smoothstep(0.1, 0.3, vr.y - vr.x);
      chan *= 1.0 - 0.8 * raft * aaF(fw, 1.2);
    }
    // the toe: where the flow advances it breaks open in glowing lobes
    // (a few breakouts ~10–20 m apart along the front, each a lobe of melt: a fine noise there drew the whole margin as a
    // dotted 'leopard print' band at night)
    float toe = lw * (1.0 - smoothstep(0.1, 0.4, lava + lobe * 0.06)) * smoothstep(0.62, 0.86, snoise(P * 0.075 + vec3(0.0, uTime * 0.02, 0.0)) * 0.5 + 0.5 + 0.15 * snoise(P * 0.3 + 4.0) * aaF(fw, 2.0));
    // only part of a flow is active at a time: tears glow in broad, irregular zones (~20–40 m) where the melt is pushing
    // through, the rest has crusted over (its tears dark seams); the fine shrinkage cracks glow only on the very hottest
    // ground. (Every tear and crack of the whole flow alight read as red crushed gravel.)
    // (a third of a deep, young flow at a time: with half or more of it alight the whole flow read as one glowing net)
    float lavaAct = smoothstep(0.2, 0.55, snoise(P * 0.035 + vec3(3.7, 1.1, 8.3)) * 0.75 + snoise(P * 0.11 + 2.0) * 0.25 + (heat - 0.75) * 0.5);
    // (and tear by tear the melt shows more or less: some tears gape bright, most are a dull red line, many have
    // crusted shut — an even net of equally bright cracks read as a mosaic, a 'floor is lava' tile)
    float tearV = 0.25 + 0.75 * smoothstep(-0.35, 0.55, snoise(lp * 0.19 + 31.0) * 0.7 + snoise(lp * 0.6 + 7.0) * 0.3 * k1);
    float glowT = clamp((crack1 * tearV + crackMean) * smoothstep(0.12, 0.55, heat) * lavaAct + crack2 * 0.2 * smoothstep(0.92, 1.0, heat) * lavaAct + chan + toe * 0.7, 0.0, 1.0);
    // a crusted-over seam is a dark line only where it gapes (most have closed): the crust between reads as one sheet
    float seamVis = smoothstep(0.35, 0.8, tearV);
    // incandescence: deep red at a tear's cooling lips → orange → yellow-white in the open channels
    vec3 hotC = mix(vec3(0.9, 0.07, 0.006), vec3(1.0, 0.32, 0.035), smoothstep(0.2, 0.7, glowT) * (0.4 + 0.6 * heat));
    hotC = mix(hotC, vec3(1.0, 0.62, 0.22), chan * heat);
    float flick = 0.85 + 0.15 * snoise(lp * 0.5 + vec3(0.0, uTime * 0.6, 0.0));
    // the same light by day and by night (the exposure changes, not the lava), a little restrained by day, when the eye
    // reads the sunlit ground first
    float dayL = mix(1.0, 0.45, smoothstep(-0.05, 0.25, dot(up, uSunDirBody)));
    emis += hotC * glowT * mix(1.2, 5.0, max(heat, chan)) * flick * dayL * lw;
    // the crust: fresh glassy basalt, near black with a faint sheen, older plates a little greyer, ropy folds across the
    // flow, the lips of a tear warmed red by the melt beneath, the shrinkage cracks dark
    // (ropes lie across the flow: a noise stretched along each body axis, cross-faded by how well that axis follows the
    // flow here — a frame turned to the local flow would make its coordinates race on a 3 km world)
    float rope = 0.0;
    float aR = aaF(fw, 0.5);
    if (aR > 0.0 && tl > 1e-4) {
      vec3 wr = pow(abs(downD), vec3(4.0));
      wr /= wr.x + wr.y + wr.z;
      if (wr.x > 0.05) rope += snoise(lp * vec3(2.2, 0.45, 0.45) + 3.1) * wr.x;
      if (wr.y > 0.05) rope += snoise(lp * vec3(0.45, 2.2, 0.45) + 6.7) * wr.y;
      if (wr.z > 0.05) rope += snoise(lp * vec3(0.45, 0.45, 2.2) + 9.2) * wr.z;
      rope *= aR;
    }
    // (fresh basalt is near black: at a 0.6 specular and roughness 0.38 the plates mirrored the bright sky as grey paving)
    // (older crust — the thin, cooled margins — weathers to a dull charcoal grey; the young crust over the deep melt is
    // glassy black; plates differ only a little in tone, or each one read as a paving slab)
    vec3 crustC = mix(vec3(0.05, 0.047, 0.045), vec3(0.02, 0.018, 0.018), smoothstep(0.1, 0.7, heat)) * (0.85 + 0.3 * plate) * (0.92 + 0.12 * rope);
    crustC += vec3(0.05, 0.008, 0.0) * (1.0 - smoothstep(0.0, 0.25, edge1)) * heat * k1 * lavaAct;
    crustC *= 1.0 - 0.55 * crack1 * seamVis * (1.0 - lavaAct);
    crustC *= 1.0 - 0.5 * crack2 * (1.0 - heat);
    col = mix(col, crustC, lw);
    rough = mix(rough, mix(0.82, 0.55, heat), lw);
    spec = mix(spec, 0.35, lw);
    // pillowy plates: each slab bulges a little between its seams (pahoehoe's lobes), the seams sink in
    float pillow = smoothstep(0.0, 0.45, edge1) * k1;
    bump = mix(bump, pillow * 0.1 + plate * 0.04 + rope * 0.05 - crack1 * 0.12 * seamVis - chan * 0.25, lw);
    mk = mix(mk, 0.1, lw);
    rockW *= 1.0 - lw;
  }
  // fire: a FRONT — a ragged band of burning litter where the fire field crosses the edge of the burning ground (its
  // level warped by noise, so the band wanders instead of following the 50 m sim triangles), ash and a sparse scatter
  // of embers behind it, untouched ground ahead (the flames themselves are particles). Not a glowing net over every
  // burning cell, which read as a lava field from above.
  // (the fire field's gradient per metre, taken outside the branch: derivatives in divergent flow are undefined)
  float fireDW = fwidth(fire) / max(fw, 1e-4);
  // ... and its direction on the tangent plane (screen derivatives solved against the surface's own), so the front can
  // run ahead downwind: g·dPdx = dfire/dx, g·dPdy = dfire/dy
  vec3 fSx = dFdx(P), fSy = dFdy(P);
  vec3 fR1 = cross(fSy, up), fR2 = cross(up, fSx);
  float fDet = dot(fSx, fR1);
  vec3 fireG = abs(fDet) > 1e-14 ? (dFdx(fire) * fR1 + dFdy(fire) * fR2) / fDet : vec3(0.0);
  // (everything else only where something burns: the rest of the planet pays for none of it)
  if (abs(fire) > 0.01) {
  float fireFl = 0.55 + 0.45 * snoise(P * 0.7 + vec3(0.0, uTime * 1.3, 0.0));
  // sparse embers (front margin, lone fires), round specks off-centre in their cells, faded before they shrink under a pixel
  vec3 cellE = floor(P * 2.2);
  float eh = fract(sin(dot(cellE, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 eo = fract(P * 2.2) - 0.5 - (vec3(fract(eh * 13.7), fract(eh * 7.3), fract(eh * 3.1)) - 0.5) * 0.5;
  float ember = step(0.975, eh) * smoothstep(0.22, 0.08, length(eo)) * (0.6 + 0.4 * sin(uTime * 3.0 + eh * 60.0)) * (1.0 - smoothstep(0.06, 0.2, fw));
  // small coals, clustered where a log or a tussock burned down (0.5–1 m grains inside 4–8 m patches)
  float coals = smoothstep(0.84, 0.97, snoise(P * 2.3 + 4.0) * 0.5 + 0.5 + 0.15 * snoise(P * 6.1))
    * smoothstep(0.5, 0.8, snoise(P * 0.25 + 11.0) * 0.5 + 0.5) * 0.35 * aaF(fw, 0.4);
  float dayFire = mix(1.0, 0.3, smoothstep(-0.05, 0.25, dot(up, uSunDirBody)));
  float dayCoal = mix(1.0, 0.15, smoothstep(-0.05, 0.25, dot(up, uSunDirBody)));
  if (fire < -0.01) {
    // a LONE burning cell (fieldtex.ts packs it −1: a cone falling to 0 at its neighbours ~50 m away). No front
    // contour — round a single peak of the field that is a perfect glowing ring about a black disc, a portal — but a
    // ragged burnt patch ~10–20 m across: char and ash, a scorched margin, clusters of glowing coals and embers; the
    // flames are the particles standing on it
    float iso = -fire;
    float n1 = snoise(P * 0.12 + 31.0) * 0.55 + snoise(P * 0.37 + 7.0) * 0.3 * aaF(fw, 2.0) + snoise(P * 1.1 + 2.0) * 0.12 * aaF(fw, 0.7);
    float burnK = smoothstep(0.62, 0.8, iso + n1 * 0.32);
    float scorch = smoothstep(0.45, 0.66, iso + n1 * 0.32) * (1.0 - burnK);
    col = mix(col, col * vec3(0.55, 0.45, 0.35), scorch * 0.6);
    float ashB = smoothstep(0.3, 0.8, snoise(P * 0.9) * 0.5 + 0.5);
    col = mix(col, mix(vec3(0.022, 0.02, 0.018), vec3(0.12, 0.115, 0.11), ashB * 0.6), burnK * 0.92);
    rough = mix(rough, 0.97, burnK);
    // (beds of coals, not a glow over the bed: a 0.12 base lit soft orange blobs on the ground under the night exposure)
    float cz = burnK * smoothstep(0.42, 0.72, snoise(P * 0.45 + 13.0) * 0.5 + 0.5) * (0.006 + 2.6 * coals);
    emis += vec3(2.4, 0.55, 0.07) * (cz * fireFl + ember * burnK * 1.2) * dayCoal;
  }
  if (fire > 0.01) {
    // the level is warped by noise so the front wanders instead of following the sim triangles; its gradient per metre
    // comes from the field's screen derivative and the noise's ANALYTIC gradient, so the front has the same width in
    // metres everywhere (with a floor-only gradient it ballooned into peach blobs wherever the noise was flat)
    // (the warp is small against the field: at ±0.2 a smooth fire field crossed 0.25 in curly loops all over the
    // burning ground — orange swirls by day, scattered petals at night — instead of along ONE wandering front)
    // (one broad octave only: a finer one made little closed islands of the contour beside the front — orange rings
    // and flecks scattered over the grass)
    vec3 gw1;
    float warp = snoiseGrad(P * 0.045 + vec3(0.0, uTime * 0.01, 0.0), gw1);
    vec3 gW = gw1 * 0.045 * 0.06;
    gW -= up * dot(gW, up);
    float level = fire + warp * 0.06;
    float gradF = fireDW * 0.7;
    float gradL = max(sqrt(gradF * gradF + dot(gW, gW)), 0.004);
    // signed distance (m) behind the front (> 0: inside the burning ground)
    float dB = (level - 0.25) / gradL;
    // the front wanders 2–6 m off the field's contour (a domain warp in metres, ~30 % of a burning cell's reach: the
    // contour alone kept one constant-width curve) and runs ahead DOWNWIND (the side whose outward normal faces the
    // local surface wind is pushed out by up to ~3 m, the upwind side backs off a little)
    float wM = snoise(P * 0.17 + vec3(0.0, uTime * 0.03, 0.0)) * 2.4 + snoise(P * 0.5 + 5.0) * 0.9 * aaF(fw, 2.0);
    vec3 wT = vFireWind - up * dot(vFireWind, up);
    float wS = length(wT);
    float downW = wS > 0.3 && dot(fireG, fireG) > 1e-12 ? dot(-normalize(fireG), wT / wS) * smoothstep(0.5, 4.0, wS) : 0.0;
    dB += wM + 3.0 * max(downW, 0.0) - 0.8 * max(-downW, 0.0);
    // the front: a line of burning litter ~2 m wide, at least ~1.5 pixels (dimmed by the excess, so it never thickens
    // into a glowing area from far away); only where the fire field itself carries the contour — where the noise
    // dominates (a flat field near 0.25) the contour would only draw islands, not a front
    float halfW = max(1.0, fw * 0.75);
    float frontK = smoothstep(0.35, 0.75, gradF / (gradF + length(gW) + 1e-5));
    float band = (1.0 - smoothstep(0.0, halfW, abs(dB + 0.3))) * min(1.0, 1.0 / halfW) * frontK;
    float fl = fireFl;
    float lick = smoothstep(0.1, 0.7, snoise(P * vec3(1.6, 0.4, 1.6) + vec3(uTime * 0.6)) * 0.5 + 0.5);
    // behind it: a smouldering margin a few metres deep (glowing coals in sparse patches, dying back), then char and
    // ash (with the small warp, dB is a fair distance near the front; a margin defined in field values covered most of
    // a smooth burning field with coals — orange flecks everywhere, even by day)
    float smoulder = smoothstep(0.3, 1.5, dB) * (1.0 - smoothstep(3.0, 7.0 + 3.0 * fl, dB));
    // (by day the front and the coals are a smouldering line under the flames, not a lava worm: about half the glow
    // the night shows — the exposure, not the fire, changes, but the eye reads the sunlit ground first)
    // The line is BROKEN: 30–50 % of its length is out (burnt through, or not yet caught: two drifting noises at
    // ~6 m and ~2 m: burning stretches a few metres long), what burns flickers; a gap keeps only a dim red residue
    float gateN = snoise(P * 0.17 + vec3(uTime * 0.02, 0.0, -uTime * 0.015)) * 0.65 + snoise(P * 0.45 + 9.0) * 0.35;
    float broken = (0.05 + 0.95 * smoothstep(-0.08, 0.08, gateN)) * (0.45 + 0.55 * smoothstep(0.35, 0.75, lick * 0.6 + 0.4 * (snoise(P * 0.18 + vec3(0.0, uTime * 0.2, 0.0)) * 0.5 + 0.5)));
    // the burnt ground inside is not a void: irregular 2–6 m beds of glowing coals and embers (smouldering tussocks)
    // while the field still burns there, dark char between and around them. (A dull glow over whole patches read as
    // orange-and-black camouflage under the night exposure: the beds are clusters of coals, the char stays dark)
    float inner = smoothstep(2.0, 6.0, dB) * smoothstep(0.3, 0.8, fire);
    float patches = smoothstep(0.55, 0.7, snoise(P * 0.3 + 21.0) * 0.5 + 0.5 + 0.18 * snoise(P * 0.95 + 3.0) * aaF(fw, 1.0)) * inner;
    emis += vec3(2.4, 0.55, 0.07) * (band * broken * (0.5 + 0.9 * lick) * fl * 1.1 * dayFire
      + (smoulder * (coals + 0.004) * fl + ember * smoulder * 1.2) * dayCoal
      + patches * (0.003 + 2.2 * coals + ember * 1.2) * (0.7 + 0.3 * fl) * dayCoal);
    // the ground: scorched brown just ahead of the front (heat), charred black right behind it, grey ash further back
    float ahead = smoothstep(0.1, 0.24, level) * (1.0 - step(0.0, dB));
    col = mix(col, col * vec3(0.55, 0.45, 0.35), ahead * 0.6);
    float charK = smoothstep(-0.8, 0.6, dB);
    float ashBloom = smoothstep(0.5, 0.9, level) * smoothstep(0.3, 0.8, snoise(P * 0.9) * 0.5 + 0.5);
    col = mix(col, mix(vec3(0.022, 0.02, 0.018), vec3(0.12, 0.115, 0.11), ashBloom * 0.75), charK * 0.95);
    rough = mix(rough, 0.97, charK);
  }
  }

  // macro relief in the shading only (gullies and swells at 10–60 m): reads at a distance, leaves the ground
  // height — the contract's groundHeight — untouched
  float macro = (fbm3(P * 0.017) * 1.4 + fbm3(P * 0.047 + 5.0) * 0.45) * (1.0 - smoothstep(0.5, 6.0, ash + snow * 4.0));
  // (halved under turf on gentle ground: with the mesh's own 12 m relief, a low sun raked meadows into hummocks)
  // (… and down to a quarter under a closed sward: its tussocks carry the ground's texture, and the broad swells
  // raked by a low sun read as a hammered felt from 30–60 m)
  macro *= 1.0 - 0.75 * smoothstep(0.2, 0.6, vegTotal) * (1.0 - steep);
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
  // the rock's open joints shade the ambient (and a little of the sun) where the rock shows, and its facets tilt the
  // shading normal (analytic: rk_joints)
  ao *= 1.0 - 0.35 * rockJoint * rockW;
  s.microG += rockG * rockW;
  s.albedo = col;
  s.rough = clamp(rough, 0.04, 1.0);
  s.bump = bump + macro * mix(1.0, 0.3, smoothstep(0.0, 0.25, uw));
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
uniform highp sampler2D uFieldO;
varying vec3 vBodyPos;
varying vec3 vBodyN;
varying vec4 vF0;
varying vec4 vF1;
varying vec4 vOre;
varying vec4 vF2;
varying vec4 vF3;
varying vec4 vF4;
varying vec4 vF5;
varying float vCurv;
varying vec3 vFireWind;
${GROUND_VERT_PARS}
`;

const VERT_MAIN = /* glsl */ `
${TERRAIN_VERT_CORE}
  vF0 = tfInterp(uFieldM0, aCells, aMisc.x);
  vF1 = tfInterp(uFieldM1, aCells, aMisc.x);
  // lava lies ON the ground (types.ts: lava top = surface + lava), as water does: the mesh stands on its depth, so a
  // flow is a body with a front that fills hollows and buries what it overran; a molten surface is smoother than the
  // ground it flows over (the shading normal leans toward the vertical as it deepens)
  {
    float lavaH = max(vF1.x, 0.0);
    if (lavaH > 0.0) {
      vec3 upV = normalize(position);
      tPos += upV * lavaH;
      tNrm = normalize(mix(tNrm, upV, smoothstep(0.15, 1.5, lavaH) * 0.65));
    }
  }
  vF2 = tfInterp(uFieldV, aCells, aMisc.x);
  vF3 = tfInterp(uFieldC, aCells, aMisc.x);
  // material-aware relief in the SHADING (the heights are the contract's ground and stay as they are): the 12 m and
  // 3 m detail octaves shade at full strength on bare rock, at under a third on soil and meadow, and barely on sown
  // fields, roads and streets — the same ±0.6 m humps lit everywhere read as a quilted mattress (and their shadows are
  // left out of the shadow maps: DEPTH_VERT)
  {
    float rockK = smoothstep(0.55, 0.9, tA.y);
    float flatK = max(smoothstep(0.04, 0.3, vF2.w), smoothstep(0.1, 0.45, vF3.z)) * (1.0 - rockK);
    // (soil and turf at 0.06: at 0.12 a low sun still raked every 12 m hump of the full-detail mesh into an even field
    // of dimples — a hammered, quilted felt over every meadow and hillside at dusk; the sward's own tussocks and the
    // macro swells carry the ground's texture)
    // Near the camera bare rock shades with about half its noise relief: its jointed facets (rk_joints) carry the form,
    // and the full isotropic 12 m / 3 m noise under them read as soft grey fur; far away (where the facets are under a
    // few pixels) the relief is the mountains' texture. Snow drapes the ground and smooths it.
    float camDv = length(tPos - uCamBody);
    // (0.3 near the camera: at half, the mesh's soft noise humps still folded every crag like cloth)
    float reliefK = mix(mix(0.06, mix(0.3, 1.0, smoothstep(250.0, 900.0, camDv)), rockK), 0.05, flatK);
    reliefK *= mix(1.0, 0.45, smoothstep(0.06, 0.5, vF0.x));
    // (the detail gradient taken back out follows the geomorph — toward the coarse level's gradient, aGradM — so the
    // two sides of an LOD border shade alike: with the own level's gradient faded by the morph, every patch border
    // drew a straight seam across the meadow)
    tNrm = normalize(tNrm + mix(aGrad, aGradM, tMorph) * tA.y * (1.0 - reliefK));
  }
  vBodyPos = tPos;
  vBodyN = tNrm;
  vF4 = vec4(tS, tA.z, tA.w, tH);
  vF5 = tfInterp(uFieldS, aCells, aMisc.x);
  vOre = tfInterp(uFieldO, aCells, aMisc.x);
  vCurv = tfInterp(uFieldN, aCells, aMisc.x).w;
  // (fetched only near fire: the rest of the planet pays nothing for it)
  vFireWind = abs(vF3.w) > 0.001 ? tfInterp(uFieldD, aCells, aMisc.x).yzw : vec3(0.0);
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
        // (the zero-crossings of one noise form a connected net — it still read as pool tiles; where two warped ridge
        // sets overlap only broken, wandering filaments and knots stay bright, like light focused by real swell)
        float caus = pow(r1 * r2, 7.0) * 2.2 + pow(r1, 14.0) * 0.25;
        sunCol *= 1.0 + (caus * 1.5 - 0.15) * 0.3 * k;
      }
    }
    // under water the floor is lit THROUGH the surface: the sun refracts down steeper (Snell), loses its Fresnel share
    // there (most of a 2° sun is reflected) and is absorbed along its slant path to the floor — a low sun barely reaches
    // a shallow bed. (Lit as in open air, a dusk-lit bank under half a metre of water glowed neon green through the
    // water's red absorption, brighter than the land.) Energy through the flat surface: cos i · T / cos t across the beam
    vec3 sunDirV = uSunDirView;
    // (from ~0.25 m of water: the first decimetres are the shore film the water sheet fades out over — and where a
    // sheet leans on a bank it shows the ground behind it — which stays lit as wet ground)
    float uwK = smoothstep(0.25, 0.9, uwD) * (1.0 - uwFar);
    if (uwK > 0.0) {
      float ci = clamp(muS, 0.0, 1.0);
      float st = sqrt(1.0 - ci * ci) / 1.333;
      float ct = sqrt(1.0 - st * st);
      vec3 sT = uSunDirBody - upB * muS;
      float sTl = length(sT);
      vec3 Lw = upB * ct + (sTl > 1e-5 ? sT / sTl : vec3(0.0)) * st;
      float Tf = 1.0 - (0.02 + 0.98 * pow(1.0 - ci, 5.0));
      // (the absorption path is capped at ~1.5 m: deeper floors are hidden by the water's own view-path absorption
      // anyway, and where the interpolated level stands over ground the sheet does not cover — a steep bank, a culled
      // or paper-thin edge — an uncapped path turned the exposed ground pitch black along the far shores)
      vec3 uwSun = sunCol * (ci * Tf / ct) * exp(-vec3(0.5, 0.2, 0.16) * min(max(uwD, 0.0), 1.5) / ct);
      sunCol = mix(sunCol, uwSun, uwK);
      sunDirV = normalize(mix(uSunDirView, uBodyToView * Lw, uwK));
    }
    IncidentLight sunL;
    sunL.direction = sunDirV;
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
    // (the night floor where the sun is down: in daylight it would only grey the shadows — an airless world's must stay
    // black, CONTRACT §16.1)
    float nightSide = mix(0.15, 1.0, smoothstep(0.08, -0.12, dot(upB, uSunDirBody)));
    vec3 skyE = skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient * ((0.6 + 0.4 * max(dot(nB, upB), 0.0)) * nightSide);
    // seen from orbit, the limb of the night side catches more of the starlit floor (a long grazing path of faintly lit
    // ground and air): the silhouette reads against space on every world, with or without air
    float rimV = 1.0 - clamp(dot(upB, vB), 0.0, 1.0);
    skyE += uNightAmbient * (uNightRim * 2.5 * rimV * rimV * rimV * nightSide);
    // ... and a thin edge of starlight right on the silhouette (renderer.ts uNightEdge, from orbit): the night half of a
    // half-lit world — seen under the day side's exposure, where any physical starlight is black — still shows its
    // outline against space, a faint grey rim, instead of ending at the terminator
    float rim4 = rimV * rimV * rimV * rimV;
    skyE += vec3(0.85, 0.9, 1.0) * (uNightEdge * rim4 * rim4 * nightSide);
    // the aurora overhead lights the ground under its ovals green (snow and ice show it most) where the sun is down
    if (uAurora.w > 0.0) {
      float ca = abs(dot(upB, uAurora.xyz));
      float colat = acos(clamp(ca, 0.0, 1.0));
      float under = exp(-pow((colat - 0.39) / 0.13, 2.0)) + 0.35 * exp(-pow((colat - 0.25) / 0.16, 2.0));
      float nightA = smoothstep(0.06, -0.14, dot(upB, uSunDirBody));
      skyE += vec3(0.1, 0.62, 0.3) * 0.006 * uAurora.w * under * nightA * (0.55 + 0.45 * max(dot(nB, upB), 0.0));
    }
    // the sky enters ONCE: three r186's RE_IndirectSpecular adds a full Lambert term from iblIrradiance itself, so
    // adding skyE to 'irradiance' as well (RE_IndirectDiffuse) doubled the ambient — milky, shadowless ground
    // under a canopy the sky light arrives through leaves: less of it, and neutral-green rather than sky blue
    skyE = mix(skyE, vec3(dot(skyE, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.86, 1.06, 0.78), clamp((1.0 - ts.sky) * 1.6, 0.0, 1.0));
    // under water the sky light too comes through the surface and the water above the floor (and the floor mirrors no sky)
    float uwA = vF4.y - vF4.w;
    float uwAK = smoothstep(0.25, 0.9, uwA) * (1.0 - uwFar);
    skyE *= mix(vec3(1.0), 0.92 * exp(-vec3(0.5, 0.2, 0.16) * min(max(uwA, 0.0), 1.5) * 1.2), uwAK);
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
    radiance += skyRadiance(upB, rB, uSunDirBody) * specOcc * horizonK * (1.0 - uwAK);
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
    float cd = length(vViewPosition);
    // within a couple of km the settlement's own lit windows and street lamps are drawn (render/life): the far glow
    // hands over to them
    float nearK = smoothstep(900.0, 2500.0, cd);
    // (fetched outside the branch: its mip level comes from screen derivatives; dithered by half a code value — the 8-bit
    // steps of a big town's smooth aura read as contour rings round an orange blob once the night exposure lifted it)
    vec4 cs = texture(uCityTex, normalize(vBodyPos));
    cs = max(cs + (gn_hash12(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0) * smoothstep(0.0, 0.02, cs), 0.0);
    if (night > 0.0 && nearK > 0.0) {
      // From afar a night town is its HOUSES strung along its STREETS: the light cube (citylights.ts) is splatted from
      // the real lit buildings (warm hearths and oil lamps / cool gas and electric) and the real road chains (lamp-lit
      // streets in the lamp eras, dim lines along the roads between towns), plus a broad aura so a hamlet's few hearths
      // still read from orbit. (Zero lines of domain-warped noise inside the settled patch read as a maze, brain coral.)
      // The texture stores s = sqrt(v / VMAX) (citylights.ts); it is shown as s itself, compressed (a city core against
      // a hamlet: linear, it saturated to a white disc), so the mip filtering averages exactly what is displayed, and
      // kept warm: gas and electric light a sodium-yellow from afar (AgX pales anything less saturated to cream)
      vec3 warmC = vec3(1.0, 0.44, 0.12), coolC = vec3(1.0, 0.56, 0.2), streetC = mix(vec3(1.0, 0.48, 0.14), vec3(1.0, 0.58, 0.2), cs.y / (cs.x + cs.y + 1e-3));
      // (and compressed once more, ^0.6: a hamlet's few hearths and its aura still read from orbit while a city core
      // stays orange instead of bleaching to cream)
      vec4 csc = pow(cs, vec4(0.6));
      // From orbit (a pixel ~10 m and more) a town is many small lights, not one lamp: its aura is weighted down and
      // broken into districts (a smooth ~30 m noise, stable as the world turns), and the whole is dimmer, so a city
      // core reads as warm sodium yellow over orange streets instead of clipping to one cream blob with contour rings
      // under the night exposure (which is set by the starlit ground, two hundred times darker)
      float farC = smoothstep(2500.0, 8000.0, cd);
      float districts = 0.3 + 1.2 * smoothstep(-0.45, 0.6, snoise(vBodyPos * 0.035 + 17.0) * 0.7 + snoise(vBodyPos * 0.11 + 5.0) * 0.3);
      // (and a deeper sodium orange from afar: AgX pales a bright orange toward cream)
      vec3 farW = vec3(1.0, 0.36, 0.08);
      vec3 lights = (mix(warmC, farW, farC) * csc.x + coolC * csc.y + streetC * csc.z * 1.25 + mix(warmC, farW, farC) * csc.w * mix(1.2, 0.35, farC)) * districts * 1.3;
      lights *= mix(1.0, 0.26, farC);
      totalEmissiveRadiance += lights * night * uCityLights * nearK;
    }
    if (cityL > 0.002 && night > 0.0) {
      vec3 lc = mix(vec3(1.0, 0.46, 0.14), vec3(1.0, 0.6, 0.26), smoothstep(1.5, 3.5, cityL));
      // near: light FALLING on the ground (its own colour, saturating with the cell's sum of houses), not light glowing
      // out of it: a self-lit spill read as a glaring disc round every town once the night exposure adapted to it
      float spillL = cityL / (1.0 + 0.6 * cityL);
      // the spill is a whisper (about the moonlight's level at a town's heart): at 0.035 it was ~6× the moonlight and
      // floodlit the whole village ground orange-brown at night (the road ribbons, which do not take it, then read as
      // black bars); the pools under windows and lamps are the point lights'
      totalEmissiveRadiance += lc * spillL * diffuseColor.rgb * 0.006 * night * uCityLights * (1.0 - nearK);
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
    // map overlay (temperature, belief, territory, ... — the UI's O key): the ground takes the map's colour in its
    // albedo (relief and light still read through it) and a little of it glows, so the map stays legible at night
    if (uOverlayK.x > 0.5) {
      vec3 od = normalize(vBodyPos);
      vec2 ouv = vec2(atan(od.x, od.z) * 0.15915494 + 0.5, asin(clamp(od.y, -1.0, 1.0)) * 0.31830989 + 0.5);
      vec4 ov = textureLod(uOverlay, ouv, 0.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb * 0.6, ov.a * uOverlayK.y);
      totalEmissiveRadiance += ov.rgb * ov.a * uOverlayK.z;
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
    uFieldD: { value: null }, uFieldO: { value: null },
    uRadius: { value: 3000 }, uCamBody: { value: new Vector3() },
    uBodyToView: { value: new Matrix3() }, uSunDirBody: { value: new Vector3(1, 0, 0) }, uSunDirView: { value: new Vector3(1, 0, 0) },
    uKind: { value: 0 }, uSeaLevel: { value: 0 }, uYearFrac: { value: 0 }, uSeasonAmp: { value: 1 }, uTime: { value: 0 },
    uRockA: { value: new Color() }, uRockB: { value: new Color() }, uSandCol: { value: new Color() }, uRegolith: { value: new Color() },
    uNightAmbient: { value: new Vector3(0.004, 0.006, 0.012) }, uNightRim: { value: 1 }, uNightEdge: { value: 0 }, uCityLights: { value: 1 }, uCityTex: { value: null },
    // moonlight (set per frame by the renderer for the primary planet; zero elsewhere)
    uMoonE: { value: new Vector3() }, uMoonDirBody: { value: new Vector3(0, 1, 0) }, uMoonDirView: { value: new Vector3(0, 1, 0) },
    uCloudCov: { value: null }, uCloudShell: { value: new Vector2(3180, 3420) }, uCloudOn: { value: 0 },
    uBrush: { value: new Vector4(0, 1, 0, 0.02) }, uBrushColor: { value: new Vector3(1.2, 0.95, 0.55) }, uBrushOn: { value: 0 },
    // map overlay (UI lane: planet/overlaytex.ts applyOverlay); off by default
    uOverlay: { value: null }, uOverlayK: { value: new Vector3(0, 0.8, 0.3) },
    uDebug: { value: 0 }, uVegFade: { value: new Vector2(1e9, 1e9 + 1) }, uWindDir: { value: new Vector3(1, 0, 0.3).normalize() },
    // this frame's view space → last frame's clip space through the planet body frame (water SSR reprojection)
    uViewToPrevClip: { value: new Matrix4() },
    // additive (render lane, phase 4b: a falling moon): the tidal bulge on the water — body-frame direction to the moon
    // (xyz) and the bulge's height in metres (w); render/fx/worlds.ts sets it, planet/ocean.ts raises the sea by it
    uTide: { value: new Vector4(0, 1, 0, 0) },
    // additive (world-events lane): the aurora's light on the ground under its ovals (render/sky/aurora.ts sets it)
    uAurora: { value: new Vector4(0, 1, 0, 0) },
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
uniform highp sampler2D uFieldM1;
#include <logdepthbuf_pars_vertex>
void main() {
${TERRAIN_VERT_CORE}
  // soil, turf, sand and snow cast their shadows from just under their own detail relief (the 3–12 m humps, ±~0.8 m):
  // every hump shadowing the next at a low sun drew an egg-crate of light and shade over every meadow and street.
  // Hills and valleys (the cell surface) still cast theirs, ~1.5 m shorter; bare rock keeps its own relief's shadows
  tPos -= normalize(tPos) * (3.0 * tA.y * (1.0 - smoothstep(0.55, 0.9, tA.y)));
  // (lava stands on the ground: terrainmat VERT_MAIN)
  tPos += normalize(position) * max(tfInterp(uFieldM1, aCells, aMisc.x).x, 0.0);
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
      uFieldA: shared.uFieldA, uFieldN: shared.uFieldN, uFieldG: shared.uFieldG, uFieldD: shared.uFieldD, uFieldM1: shared.uFieldM1, uRadius: shared.uRadius, uCamBody: shared.uCamBody,
      uMorph: terrain.userData.uMorph as IUniform<Vector4>,
    },
    colorWrite: false,
  });
}

export type { Texture };
