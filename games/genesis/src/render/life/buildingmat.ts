// GENESIS — the building material (CONTRACT.md §15.6, §15.7): MeshStandardMaterial + onBeforeCompile for the kit
// meshes of render/gen/buildinggen.ts, instanced per variant.
//
// Surfaces are procedural, laid out in the per-face uv (metres) the kit bakes: ashlar, fieldstone, brick and mudbrick
// courses with mortar, planks, logs, wattle-and-daub with exposed weave, thatch courses with strands, pantiles,
// slate, shingles, hide with stitching, woven cloth with stripes, corrugated metal, concrete formwork, chitin plates,
// ice blocks — each with per-element tone, a height for bump shading, roughness, and a pixel-footprint fade so
// nothing shimmers from afar. Walls get ground splash and rain streaks.
//
// Per instance (iState = progress, damage, flags, packed light; iInfo = height, half-width, half-depth, seed):
//   * construction: everything above a rising, slightly uneven course line is cut away, the newest course is fresh
//     and pale, the roof appears last (the scaffold is its own instanced mesh);
//   * damage chars the surfaces; ruins cut the walls to a jagged line and drop the roof, and the broken wall cores
//     (back faces) read as rubble;
//   * burning: embers glow and crawl in the charred cracks;
//   * night: glass glows by the settlement's light technology (hearth flicker → oil lamps → gas → electric), window by
//     window (some dark), forge / kiln mouths glow whenever the building works, beacons and mast lights shine.
// Lighting matches the vegetation / terrain: this planet's sun through the transmittance LUT, cascaded and cloud
// shadows, sky irradiance and sky reflections (windows mirror the sky by day), plus three's point lights (fires).

import { BackSide, DoubleSide, FrontSide, MeshStandardMaterial, ShaderMaterial, type IUniform } from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { SHADOW_GLSL } from '../planet/lights.ts';
import { MOON_PARS, moonDirect } from '../shaders/moon.glsl.ts';

const VERT_PARS = /* glsl */ `
attribute vec4 aKit;
attribute vec4 iState;   // progress, damage, flags, light (kind*256 + level*255)
attribute vec4 iInfo;    // height, half x, half z, seed
attribute vec3 iFade;    // x: 1 − the LOD cross-fade f (f ≥ 0 keeps the pixels whose dither < f, f < 0 those whose dither ≥ 1 + f;
                         //    a mesh without the attribute reads 0: whole); yz: ground slope
uniform float uTime;
varying float vFade;
varying vec3 vBodyPos;
varying vec3 vLocal;
varying vec2 vKUv;
varying vec4 vKit;
varying vec4 vState;
varying vec4 vInfo;
`;

/** windmill sails turn about the local Z axis through (0, uv.x); everything else is static */
const VERT_BEGIN = /* glsl */ `
  vec3 transformed = vec3(position);
  // open works follow the ground's slope: a shear (verticals stay plumb)
  transformed.y += iFade.y * transformed.x + iFade.z * transformed.z;
  if (abs(aKit.y - 9.0) < 0.5) {
    float a = uTime * 0.7 + iInfo.w * 6.28;
    float ca = cos(a), sa = sin(a);
    vec2 r = vec2(transformed.x, transformed.y - uv.x);
    transformed.xy = vec2(ca * r.x - sa * r.y, sa * r.x + ca * r.y + uv.x);
  }
`;

/**
 * Where a building under construction or in ruins has no fabric (true = discard). Shared by the colour material and the
 * shadow caster: the caster drew the whole intact building, so a ruin lay in the shadow of its fallen roof and its
 * broken walls were speckled with self-shadowing, and a rising house cast the shadow of the finished one.
 */
const CUT_GLSL = /* glsl */ `
bool bldCut(vec3 cp, float cprt, float cprog, float cdmg, bool cruin, float cH, vec2 cinf, float cseed, float croof) {
  // construction: the walls rise course by course; the roof comes last
  if (cprog < 0.999) {
    // a ragged top: courses laid unevenly along each wall, not a cut by a plane
    float course = cH * 1.02 * clamp(cprog / 0.9, 0.0, 1.0) - 0.25 + 0.14 * gn_hash12(floor(cp.xz * 1.6) + 3.0)
      + 0.16 * vnoise(vec3(cp.x * 2.7, cp.z * 2.7, cseed * 3.0));
    if (cp.y > course || (croof > 0.5 && cprog < 0.92)) return true;
    // the openings stay raw holes until the walls are up: glass, frames, doors, shutters and sills go in last
    if (cprog < 0.9 && (abs(cprt - 2.0) < 0.5 || abs(cprt - 7.0) < 0.5 || abs(cprt - 3.0) < 0.5 || (abs(cprt - 6.0) < 0.5 && cp.y > 0.6))) return true;
  }
  // ruins: a collapse, not a cut-away. Each wall breaks off at its own height (0.3-1.5 m; a hut's ring of posts and
  // daub to knee height) with a ragged top, one wall in five keeps its gable; the roof is down (on the rubble heap) and
  // no beam, rafter or frame stands above the knee
  float broken = cruin ? 1.0 : smoothstep(0.62, 0.9, cdmg);
  if (broken > 0.0) {
    vec2 hxz = max(cinf, vec2(0.5));
    vec2 q = cp.xz / hxz;
    bool xSide = abs(q.x) > abs(q.y);
    float wallId = xSide ? (q.x > 0.0 ? 0.0 : 1.0) : (q.y > 0.0 ? 2.0 : 3.0);
    float along = xSide ? cp.z : cp.x;
    float wh = gn_hash12(vec2(wallId + 1.0, cseed * 7.0));
    float small = cH < 4.2 ? 0.45 : 1.0;
    float jag = abs(fract(along * 0.9 + wh * 3.7) - 0.5) * 0.7 + 0.45 * vnoise(vec3(along * 2.3, wallId * 3.1, cseed * 5.0)) - 0.25;
    float ruinH = (mix(0.3, 1.5, wh) + jag) * small;
    // a gable left standing: a ragged triangle on its wall
    if (wh > 0.8 && !xSide && small > 0.5) ruinH = max(ruinH, cH * 0.78 - abs(along) * 0.95 + jag);
    ruinH = mix(cH * 1.2, ruinH, broken);
    bool structural = cprt < 0.5 || abs(cprt - 4.0) < 0.5 || abs(cprt - 3.0) < 0.5;
    float outside = max(abs(q.x), abs(q.y));
    if (cp.y > ruinH || (croof > 0.5 && broken > 0.5) || (broken > 0.5 && !structural && cp.y > 0.45) || (broken > 0.5 && outside > 1.08 && cp.y > 0.3)) return true;
  }
  return false;
}
`;

const FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
${CUT_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${CLOUD_DENSITY_GLSL}
${SHADOW_GLSL}
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
${MOON_PARS}uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform vec3 uNightAmbient;
uniform float uTime;
uniform float uBldDebug;  // dev: 1 no bump, 2 flat albedo + no bump, 3 back faces red
varying float vFade;
varying vec3 vBodyPos;
varying vec3 vLocal;
varying vec2 vKUv;
varying vec4 vKit;
varying vec4 vState;
varying vec4 vInfo;

float bCloudShadow(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = texture(uCloudCov, normalize(q)).rg;
  return max(exp(-cloudDensityAt(q, 0.35, cs.x, cs.y, false) * (uCloudShell.y - uCloudShell.x) * 0.4), 0.3);
}

float aaK(float fw, float feature) { return 1.0 - smoothstep(0.15, 0.6, fw / feature); }
// a LINE of width w (m) — a joint, a seam, an overlap shadow — is drawn while it covers about a pixel or more; thinner
// than that it is replaced by its average darkening (point-sampled, sub-pixel lines alias into dark dashes, and their
// bump into black specks)
float aaL(float fw, float w) { return 1.0 - smoothstep(w * 0.3, w * 1.2, fw); }

// running-bond courses: returns 1 on the unit face, 0 in the joint (antialiased: the joint fades to its mean cover as
// it thins below a pixel; la = how much of the joint is still drawn, for the bump); id = per-unit hash
float courses(vec2 uv, vec2 size, float joint, float offset, float salt, float fw, out float id, out vec2 f, out float la) {
  vec2 p = uv / size;
  float row = floor(p.y);
  p.x += fract(row * offset);
  vec2 cell = floor(p);
  f = fract(p);
  id = gn_hash12(cell + vec2(salt * 17.0, salt * 3.0));
  vec2 e = min(f, 1.0 - f) * size;
  float m = smoothstep(0.0, joint, min(e.x, e.y));
  float cover = clamp(joint * (1.0 / size.x + 1.0 / size.y), 0.0, 0.5);
  la = aaL(fw, joint * 2.0);
  return mix(1.0 - cover, m, la);
}
// an overlap shadow along the bottom of each course (fraction w of the course height h): antialiased the same way
float overlapAA(float fy, float w, float h, float fw) { return mix(1.0 - w * 0.5, smoothstep(0.0, w, fy), aaL(fw, w * h)); }

struct BSurf { vec3 col; float h; float rough; float metal; };

BSurf surfaceOf(int s, vec2 uv, vec3 base, float seed, float fw, float isRoof) {
  BSurf o;
  o.col = base; o.h = 0.0; o.rough = 0.85; o.metal = 0.0;
  float id; vec2 f;
  float n1 = snoise(vec3(uv * 0.9, seed * 13.0));
  if (s == 0) {
    // plaster: broad stains, a little trowel texture
    float st = fbm3(vec3(uv * 0.35, seed * 7.0));
    o.col *= 0.9 + 0.14 * st + 0.04 * n1 * aaK(fw, 1.0);
    o.h = snoise(vec3(uv * 6.0, seed)) * 0.02 * aaK(fw, 0.15);
    o.rough = 0.9;
  } else if (s == 1) {
    // ashlar: dressed blocks
    float la;
    float m = courses(uv, vec2(0.62, 0.34), 0.014, 0.5, seed, fw, id, f, la);
    float k = aaK(fw, 0.12);
    o.col *= mix(1.0, (0.86 + 0.24 * id) * mix(0.62, 1.0, m), k);
    o.h = (m * 0.8 * la + snoise(vec3(uv * 4.0, seed)) * 0.06) * k;
    o.rough = 0.8;
  } else if (s == 2) {
    // fieldstone / rubble: irregular stones in mortar
    vec3 v = voronoi3(vec3(uv * vec2(2.4, 3.2), seed * 3.0));
    float la = aaL(fw, 0.035);
    float m = mix(0.85, smoothstep(0.02, 0.09, v.y - v.x), la);
    float k = aaK(fw, 0.18);
    o.col *= mix(1.0, mix(0.55, 0.78 + 0.42 * v.z, m), k);
    o.h = (m * (0.7 + 0.3 * v.z) * la + n1 * 0.1) * k;
    o.rough = 0.9;
  } else if (s == 3) {
    // fired brick: running bond, light mortar, tone per brick, a few dark headers
    float la;
    float m = courses(uv, vec2(0.23, 0.077), 0.011, 0.5, seed, fw, id, f, la);
    float k = aaK(fw, 0.05);
    vec3 bc = base * (0.82 + 0.3 * id) * (id > 0.93 ? 0.55 : 1.0);
    o.col = mix(base * 0.95, mix(vec3(0.38, 0.36, 0.33) * (0.9 + 0.1 * n1), bc, m), k);
    o.h = m * 0.6 * k * la;
    o.rough = 0.85;
  } else if (s == 4) {
    // mudbrick: big soft bricks, eroded joints, patches of plaster
    float la;
    float m = courses(uv, vec2(0.42, 0.13), 0.025, 0.5, seed, fw, id, f, la);
    float k = aaK(fw, 0.08) * mix(0.5, 1.0, la);
    float plaster = smoothstep(0.1, 0.35, fbm3(vec3(uv * 0.6, seed * 5.0)));
    vec3 bc = base * (0.85 + 0.25 * id);
    o.col = mix(base, mix(mix(base * 0.7, bc, m), base * 1.12, plaster), k);
    o.h = mix(m * 0.5, 0.25, plaster) * k;
    o.rough = 0.95;
  } else if (s == 5) {
    // planks: boards 0.2 m wide with dark gaps and grain along them
    float w = 0.2;
    float b = floor(uv.x / w);
    float fx = fract(uv.x / w);
    float pid = gn_hash12(vec2(b, seed * 9.0));
    float laP = aaL(fw, 0.024);
    float gap = mix(0.94, smoothstep(0.0, 0.06, min(fx, 1.0 - fx)), laP);
    float grain = snoise(vec3(uv.x * 30.0, uv.y * 1.2 + pid * 9.0, seed)) * aaK(fw, 0.03);
    float k = aaK(fw, 0.05);
    o.col *= mix(1.0, (0.78 + 0.34 * pid) * mix(0.35, 1.0, gap) * (0.92 + 0.1 * grain), k);
    o.h = gap * 0.5 * k * laP + grain * 0.03;
    o.rough = 0.8;
  } else if (s == 6) {
    // logs: horizontal rounded logs with dark seams
    float d = 0.3;
    float r = fract(uv.y / d);
    float lid = gn_hash12(vec2(floor(uv.y / d), seed * 5.0));
    float round_ = sqrt(max(0.0, 1.0 - pow(r * 2.0 - 1.0, 2.0)));
    float k = aaK(fw, 0.06);
    float grain = snoise(vec3(uv.x * 1.5 + lid * 20.0, uv.y * 25.0, seed)) * aaK(fw, 0.03);
    o.col *= mix(1.0, (0.75 + 0.35 * lid) * mix(0.3, 1.0, smoothstep(0.0, 0.35, round_)) * (0.92 + 0.08 * grain), k);
    o.h = round_ * 0.9 * k;
    o.rough = 0.85;
  } else if (s == 7) {
    // wattle and daub: rough clay plaster; where it has fallen away the woven withies show
    float fall = smoothstep(0.42, 0.55, fbm3(vec3(uv * 0.8, seed * 11.0)) + 0.15 * n1);
    float weave = sin(uv.x * 31.4) * sin(uv.y * 9.0 + floor(uv.x * 10.0) * 3.14);
    vec3 withy = vec3(0.17, 0.12, 0.07) * (0.8 + 0.3 * weave);
    float k = aaK(fw, 0.08);
    o.col = mix(base * (0.88 + 0.16 * fbm3(vec3(uv * 1.3, seed))), withy, fall * k);
    o.h = (snoise(vec3(uv * 3.0, seed)) * 0.08 + fall * (-0.3 + 0.2 * weave)) * k;
    o.rough = 0.95;
  } else if (s == 8) {
    // thatch: courses down the slope — uneven (0.22–0.43 m) and wavy, not machined bands — strands along them, a soft
    // shadow under each course's lip, weathering (grey patches, golden mended ones) and moss
    float c = 0.3;
    float yv = uv.y + 0.06 * sin(uv.x * 1.7 + seed * 6.3) + 0.04 * snoise(vec3(uv.x * 0.9, seed, 1.0));
    yv += 0.5 * sin(0.6 * yv + seed * 7.0);
    float cr = fract(yv / c);
    float cid = gn_hash12(vec2(floor(yv / c), seed));
    float strands = snoise(vec3(uv.x * 38.0, yv * 2.0 + cid * 5.0, seed)) * 0.5 + snoise(vec3(uv.x * 90.0, yv * 4.0, seed + 3.0)) * 0.5;
    float k1 = aaK(fw, 0.02), k2 = aaK(fw, 0.1);
    float lip = overlapAA(cr, 0.22 + 0.06 * cid, 0.32, fw);
    float moss = smoothstep(0.2, 0.6, fbm3(vec3(uv * 0.5, seed * 3.0))) * 0.5 * isRoof;
    vec3 tc = base * (0.85 + 0.3 * cid) * mix(0.8, 1.04, lip * k2 + (1.0 - k2) * 0.85) * (0.85 + 0.25 * strands * k1);
    float aged = smoothstep(0.45, 0.8, fbm3(vec3(uv * 0.28, seed * 5.0)));
    float mended = smoothstep(0.62, 0.85, fbm3(vec3(uv * 0.35 + 7.0, seed * 2.0)));
    tc = mix(tc, vec3(dot(tc, vec3(0.33))) * vec3(0.95, 0.95, 0.92), aged * 0.55);
    tc = mix(tc, base * vec3(1.3, 1.18, 0.85), mended * 0.45);
    o.col = mix(tc, vec3(0.07, 0.09, 0.035), moss * k2);
    // (the lip's bump eases back to zero before the course wraps: a step there in one pixel row made the bump's screen
    // derivatives spike per 2×2 quad — a dashed line of white seams along every course)
    o.h = (lip * 0.3 * (1.0 - smoothstep(0.86, 1.0, cr)) + strands * 0.2 * k1) * k2;
    o.rough = 0.95;
  } else if (s == 9) {
    // clay pantiles: courses with rounded waves, a dark overlap line, tone per tile
    float la;
    float m = courses(uv, vec2(0.24, 0.3), 0.01, 0.0, seed, fw, id, f, la);
    float wave = sin(f.x * 6.2831853) * 0.5 + 0.5;
    float over = overlapAA(f.y, 0.18, 0.3, fw);
    float k = aaK(fw, 0.06);
    o.col *= mix(1.0, (0.82 + 0.3 * id) * mix(0.5, 1.0, over) * (0.82 + 0.25 * wave), k);
    o.h = (wave * 0.6 + over * 0.4) * k * aaL(fw, 0.054);
    o.rough = 0.65;
  } else if (s == 10) {
    // slate: overlapping dark rectangles
    float la;
    float m = courses(uv, vec2(0.3, 0.2), 0.008, 0.5, seed, fw, id, f, la);
    float k = aaK(fw, 0.05);
    float over = overlapAA(f.y, 0.25, 0.2, fw);
    o.col *= mix(1.0, (0.75 + 0.45 * id) * mix(0.5, 1.0, over * m), k);
    o.h = over * m * 0.5 * k * aaL(fw, 0.05);
    o.rough = 0.55;
  } else if (s == 11) {
    // hide: mottled leather with stitched seams
    float mott = fbm3(vec3(uv * 1.6, seed * 4.0));
    vec2 g = abs(fract(uv / vec2(1.1, 0.9)) - 0.5);
    float seam = smoothstep(0.03, 0.0, min(0.5 - g.x, 0.5 - g.y) * 1.0);
    float stitch = step(0.5, fract((uv.x + uv.y) * 12.0));
    float k = aaK(fw, 0.08);
    o.col *= (0.82 + 0.3 * mott) * (1.0 - seam * 0.45 * k * (0.6 + 0.4 * stitch));
    o.h = (mott * 0.15 - seam * 0.3) * k;
    o.rough = 0.75;
  } else if (s == 12) {
    // woven cloth: fine weave, stripes on awnings
    float weave = (sin(uv.x * 220.0) * sin(uv.y * 220.0)) * aaK(fw, 0.01);
    // awnings in two colours: the dye and undyed cream, in stripes
    float stripe = fract(seed * 3.7) > 0.45 ? mix(1.0, step(0.5, fract(uv.x / 0.5)), aaK(fw, 0.12)) : 1.0;
    // (the undyed stripes are weathered linen, not a white: and stains and sun-fade over the whole cloth)
    o.col = mix(vec3(0.42, 0.39, 0.33), base, stripe) * (0.92 + 0.08 * weave) * (0.82 + 0.2 * fbm3(vec3(uv * 0.8, seed)));
    o.h = weave * 0.02;
    o.rough = 0.9;
  } else if (s == 13) {
    // metal: corrugation or standing seams, a little rust
    float cor = sin(uv.x * 6.2831853 / 0.09);
    float rust = smoothstep(0.35, 0.75, fbm3(vec3(uv * 0.4, seed * 2.0)) + 0.3 * (1.0 - smoothstep(0.0, 1.5, uv.y)));
    float k = aaK(fw, 0.03);
    o.col = mix(base * (0.95 + 0.06 * cor * k), vec3(0.2, 0.07, 0.02), rust * 0.5);
    o.h = cor * 0.25 * k;
    o.rough = mix(0.42, 0.8, rust);
    o.metal = mix(0.55, 0.1, rust);
  } else if (s == 14) {
    // concrete: formwork lines, pores, water stains
    float board = mix(0.96, smoothstep(0.0, 0.012, abs(fract(uv.y / 0.3) - 0.5) - 0.48), aaL(fw, 0.012));
    float stain = smoothstep(0.2, 0.7, fbm3(vec3(uv.x * 0.6, uv.y * 0.15, seed)));
    float k = aaK(fw, 0.05);
    o.col *= (0.94 + 0.08 * n1) * mix(1.0, 0.86, stain) * mix(1.0, 0.85, (1.0 - board) * k * 0.6);
    o.h = snoise(vec3(uv * 8.0, seed)) * 0.03 * aaK(fw, 0.08);
    o.rough = 0.9;
  } else if (s == 16) {
    // dark beams: grain along the length
    float grain = snoise(vec3(uv * vec2(3.0, 18.0), seed)) * aaK(fw, 0.03);
    o.col *= 0.88 + 0.16 * grain + 0.06 * n1;
    o.h = grain * 0.1;
    o.rough = 0.8;
  } else if (s == 17) {
    o.col *= 0.8 + 0.3 * fbm3(vec3(uv * 2.0, seed));
    o.h = snoise(vec3(uv * 5.0, seed)) * 0.1;
    o.rough = 0.95;
  } else if (s == 18) {
    // chitin / resin: glossy plates
    vec3 v = voronoi3(vec3(uv * 1.6, seed * 2.0));
    float la = aaL(fw, 0.05);
    float m = mix(0.8, smoothstep(0.02, 0.12, v.y - v.x), la);
    o.col *= (0.75 + 0.4 * v.z) * mix(0.5, 1.0, m);
    o.h = m * (0.6 + 0.4 * (1.0 - v.x)) * la;
    o.rough = 0.3;
  } else if (s == 19) {
    // ice blocks
    float la;
    float m = courses(uv, vec2(0.55, 0.36), 0.02, 0.5, seed, fw, id, f, la);
    o.col *= mix(0.8, 0.95 + 0.1 * id, m);
    o.h = m * 0.4 * la;
    o.rough = 0.18;
  } else if (s == 21) {
    // bark: furrows along the pole
    float fur = abs(snoise(vec3(uv.x * 9.0, uv.y * 1.4, seed)));
    o.col *= 0.7 + 0.45 * fur;
    o.h = fur * 0.6 * aaK(fw, 0.04);
    o.rough = 0.9;
  } else if (s == 22) {
    // shingles
    float la;
    float m = courses(uv, vec2(0.16, 0.24), 0.008, 0.5, seed, fw, id, f, la);
    float over = overlapAA(f.y, 0.2, 0.24, fw);
    float k = aaK(fw, 0.04);
    o.col *= mix(1.0, (0.7 + 0.5 * id) * mix(0.45, 1.0, over * m), k);
    o.h = over * m * 0.5 * k * aaL(fw, 0.048);
    o.rough = 0.85;
  } else if (s == 24) {
    o.col *= 0.9 + 0.15 * n1;
    o.rough = 0.5;
    o.metal = 0.7;
  } else {
    o.col *= 0.9 + 0.1 * n1;
  }
  return o;
}

// night light colour by kind (1 hearth, 2 oil, 3 gas, 4 electric)
vec3 lightTint(float kind) {
  return kind < 1.5 ? vec3(1.0, 0.42, 0.11) : kind < 2.5 ? vec3(1.0, 0.6, 0.22) : kind < 3.5 ? vec3(1.0, 0.78, 0.48) : vec3(0.95, 0.9, 0.8);
}
`;

const FRAG_SURFACE = /* glsl */ `
  // LOD cross-fade (buildings.ts): the near and far meshes share the pixels of a screen-space dither in the band
  if (vFade < 0.999) {
    float hd = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vFade >= 0.0 ? hd >= vFade : hd < 1.0 + vFade) discard;
  }
  float part = vKit.y;
  float surfId = vKit.x;
  float seed = vKit.z + vInfo.w * 7.13;
  // the per-instance state reaches the fragment through interpolation: 160.0 can arrive as 159.99998, and a bit test
  // on that reads "ruined" and "burning" in scattered pixels (holes and embers all over a sound roof) — round first
  float progress = vState.x, damage = vState.y, flags = floor(vState.z + 0.5);
  bool burning = mod(flags, 2.0) > 0.5;
  bool ruined = mod(floor(flags / 2.0), 2.0) > 0.5;
  // a ruin carries its age in the light slot (2000 + 0..999: fresh char -> weathered over ~6 days); others their light
  float weather = vState.w >= 1999.5 ? clamp((vState.w - 2000.0) / 999.0, 0.0, 1.0) : 0.0;
  float lightPacked = vState.w >= 1999.5 ? 0.0 : floor(vState.w + 0.5);
  float lightKind = floor(lightPacked / 256.0 + 0.001);
  float lightLevel = mod(lightPacked, 256.0) / 255.0;
  bool working = mod(floor(flags / 64.0), 2.0) > 0.5;
  bool lit = mod(floor(flags / 128.0), 2.0) > 0.5 || lightLevel > 0.01;
  float isRoof = abs(part - 1.0) < 0.5 ? 1.0 : 0.0;
  float H = max(vInfo.x, 0.5);
  // construction and ruin cut-aways (CUT_GLSL: the shadow pass cuts the same, so a ruin casts no shadow of its roof)
  if (bldCut(vLocal, part, progress, damage, ruined, H, vInfo.yz, seed, isRoof)) discard;
  float fwUv = length(fwidth(vKUv));
  BSurf bs = surfaceOf(int(surfId + 0.5), vKUv, vColor.rgb, seed, fwUv, isRoof);
  vec3 alb = bs.col;
  // weathered roofs (tiles, slate, shingles): lichen and grime in broad patches and streaks down the slope, darker and
  // greyer toward the eaves — no roof is a fresh, even colour
  if (isRoof > 0.5 && (surfId > 8.5 && surfId < 10.5 || abs(surfId - 22.0) < 0.5)) {
    float wz = fbm3(vec3(vKUv.x * 0.22, vKUv.y * 0.08, seed * 3.0)) * 0.5 + 0.5;
    float lich = smoothstep(0.55, 0.85, fbm3(vec3(vKUv * 0.6, seed * 7.0)) * 0.5 + 0.5);
    alb = mix(alb, vec3(dot(alb, vec3(0.33))) * vec3(0.95, 0.93, 0.85), 0.1 + 0.3 * wz);
    alb *= 0.82 + 0.25 * wz;
    alb = mix(alb, alb * 0.62 + vec3(0.025, 0.032, 0.012), lich * 0.45);
  }
  // weathering: ground splash on walls, rain streaks, fresh courses during construction
  if (part < 0.5 || abs(part - 4.0) < 0.5) {
    alb *= mix(0.72, 1.0, smoothstep(-0.2, 0.9, vLocal.y));
    float streak = snoise(vec3(vKUv.x * 2.2, vKUv.y * 0.12, seed * 5.0));
    alb *= 1.0 - 0.08 * smoothstep(0.2, 0.8, streak) * aaK(fwUv, 0.4);
  }
  if (progress < 0.999) alb = mix(alb, alb * 1.25 + 0.03, smoothstep(0.6, 0.0, abs(vLocal.y - H * progress / 0.9)) * 0.5);
  // a wall still rising has no roof: its inner faces are daylit raw wall (rough core, unplastered), not the dark of a
  // closed room (the open top read as a black hole); the kit's inner faces are dark plaster
  if (progress < 0.999 && part < 0.5 && (int(surfId + 0.5) == 0 || int(surfId + 0.5) == 5) && dot(vColor.rgb, vec3(1.0)) < 0.16) {
    alb = (int(surfId + 0.5) == 5 ? vec3(0.2, 0.15, 0.1) : vec3(0.3, 0.28, 0.25)) * (0.78 + 0.3 * vnoise(vec3(vLocal * 3.0 + seed)));
  }
  // broken wall cores (seen through the cut) read as rubble: the wall's own stuff, darker and broken up
  // (a wall still rising shows its fresh core in its own material; only a ruin's broken core is dark)
  if (!gl_FrontFacing) alb = bs.col * (progress < 0.999 && !ruined ? 0.78 : 0.45) * (0.75 + 0.5 * snoise(vLocal * 3.0)) + 0.02;
  if (uBldDebug > 1.5) alb = uBldDebug > 2.5 ? (gl_FrontFacing ? vec3(0.5) : vec3(1.0, 0.0, 0.0)) : vec3(0.5);
  // fire: a burn front (buildings.ts: damage climbs while it burns) — what it has passed is charred, the front itself
  // an ember band; fresh char is soot-black with ash-grey bloom, and over days it weathers to grey-brown
  float burnB = burning ? clamp(damage * 1.35 + 0.12, 0.0, 1.0) : 0.0;
  float eave = H * 0.58;
  float fnoise = vnoise(vec3(vLocal.xz * 0.7, vLocal.y * 0.5 + seed * 3.0)) * 1.1 + 0.4 * vnoise(vec3(vLocal * 2.3));
  // distance from the eave line, where a roof fire starts: up the roof and down the walls as the burn goes on
  float fd = abs(vLocal.y - eave) + fnoise * 0.8;
  float reach = burnB * (H * 0.75 + 1.0);
  float burnt = burning ? 1.0 - smoothstep(reach - 0.35, reach + 0.05, fd) : 0.0;
  float front = burning ? smoothstep(reach - 0.65, reach - 0.25, fd) * (1.0 - smoothstep(reach - 0.05, reach + 0.3, fd)) : 0.0;
  // late in the burn the thatch and boards fall in: holes open behind the front
  if (burning && isRoof > 0.5 && burnB > 0.55 && burnt > 0.9 && vnoise(vec3(vLocal * 0.9 + seed)) > 1.35 - burnB * 0.85) discard;
  float charOld = ruined ? 1.0 : smoothstep(0.35, 0.8, fbm3(vLocal * 0.35 + seed) * 0.5 + 0.5 + damage * 0.9 - 0.55) * damage * 1.4;
  float charK = clamp(max(charOld, burnt), 0.0, 1.0) * (ruined ? 0.92 : 1.0);
  float ash = smoothstep(0.35, 0.85, snoise(vLocal * 1.7 + seed * 2.0) * 0.5 + 0.5);
  vec3 charCol = mix(vec3(0.055, 0.05, 0.045), vec3(0.17, 0.165, 0.155), ash * 0.6);
  // weathered: rain washes the soot to grey-brown, the stuff of the wall shows again in places
  charCol = mix(charCol, mix(vec3(0.2, 0.18, 0.15), bs.col * 0.75, 0.4) * (0.85 + 0.3 * ash), weather);
  alb = mix(alb, charCol, charK);
  // and a ruin greens over: moss and grass creep up the stumps and over the heap
  if (ruined && weather > 0.05) {
    vec3 ln = normalize(cross(dFdx(vLocal), dFdy(vLocal)));
    float upward = smoothstep(0.35, 0.85, abs(ln.y)) * (1.0 - smoothstep(0.2, 1.6, vLocal.y));
    // (patchy and earthy: moss, dead grass and soil, broken up at a hand's scale — not a green coat of paint)
    float creep = smoothstep(0.5, 0.85, vnoise(vec3(vLocal.xz * 1.3, seed)) * 0.75 + weather * 0.45);
    float fine = vnoise(vec3(vLocal * 7.0 + seed));
    vec3 growth = mix(vec3(0.045, 0.06, 0.028), vec3(0.075, 0.065, 0.04), smoothstep(0.3, 0.7, fine)) * (0.8 + 0.4 * ash);
    alb = mix(alb, growth, creep * upward * weather * smoothstep(0.2, 0.55, fine + 0.25) * 0.8);
  }
  float bRough = mix(bs.rough, 0.95, charK);
  float bMetal = bs.metal * (1.0 - charK);
  // glass by day: dark, smooth, reflective
  if (abs(part - 2.0) < 0.5) { alb = vec3(0.02, 0.025, 0.03); bRough = 0.06; bMetal = 0.0; }
  // street-lamp glass: frosted, faintly warm by day
  if (abs(part - 12.0) < 0.5) { alb = vec3(0.5, 0.45, 0.36); bRough = 0.3; bMetal = 0.0; }
  diffuseColor.rgb = alb;
`;

const FRAG_LIGHT = /* glsl */ `
  {
    float rP = length(vBodyPos);
    vec3 upB = vBodyPos / rP;
    float sh = sunShadow(-vViewPosition, normal);
    vec3 sunCol = uSunE * sunTransmittance(rP, dot(upB, uSunDirBody)) * sh * bCloudShadow(vBodyPos, uSunDirBody);
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = sunCol;
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    ${moonDirect('vBodyPos', '1.0')}
  }
`;

const FRAG_AMBIENT = /* glsl */ `
  {
    vec3 upB = normalize(vBodyPos);
    mat3 viewToBody = transpose(uBodyToView);
    vec3 nB = normalize(viewToBody * normal);
    vec3 vB = normalize(viewToBody * geometryViewDir);
    // ambient occlusion: the kit's baked AO, darker low on the walls and inside openings
    float ao = vKit.w * mix(0.65, 1.0, smoothstep(-0.3, 1.2, vLocal.y));
    iblIrradiance += (skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient) * ao;
    vec3 rB = reflect(-vB, nB);
    float horizonK = smoothstep(-0.05, 0.3, dot(rB, upB));
    rB = normalize(rB + upB * max(0.0, -dot(rB, upB)) * 1.05);
    radiance += skyRadiance(upB, rB, uSunDirBody) * horizonK * ao;
  }
`;

const FRAG_EMISSIVE = /* glsl */ `
  {
    float night = smoothstep(0.1, -0.08, dot(normalize(vBodyPos), uSunDirBody));
    vec3 em = vec3(0.0);
    // windows: lit by the settlement's light technology, window by window (some stay dark, they change slowly)
    if (abs(part - 2.0) < 0.5 && lit && progress > 0.999 && !ruined) {
      float slot = floor(uTime / 240.0 + seed * 5.0);
      float on = step(0.32, gn_hash12(vec2(seed * 97.0, slot)));
      float flick = lightKind < 1.5 ? 0.8 + 0.2 * sin(uTime * 7.0 + seed * 40.0) * sin(uTime * 2.3 + seed * 9.0) : lightKind < 2.5 ? 0.94 + 0.06 * sin(uTime * 3.0 + seed * 20.0) : 1.0;
      float lvl = max(lightLevel, 0.45);
      // a warm room behind the glass: brighter toward the bottom of the pane, curtains darken some
      float pane = 0.75 + 0.25 * smoothstep(1.0, 0.0, fract(vKUv.y * 0.8));
      em += lightTint(lightKind) * (lightKind > 3.5 ? 3.2 : 2.2) * lvl * on * flick * pane * night * (0.6 + 0.4 * gn_hash12(vec2(seed, 7.0)));
    }
    // lamp-lit streets: the lower walls of lit houses catch the warm light of the street lamps and the windows of
    // the houses opposite (gas and electric eras, where the streets are lit)
    if (lit && lightKind > 2.5 && !ruined && part < 0.5 && progress > 0.999) {
      float low = 1.0 - smoothstep(0.0, 6.0, vLocal.y);
      em += lightTint(lightKind) * diffuseColor.rgb * low * night * (0.35 + 0.25 * gn_hash12(vec2(seed, 3.0)));
    }
    // fire mouths / embers: whenever the building works or is lit, day and night
    if (abs(part - 5.0) < 0.5 && (working || lit || burning)) {
      float fl = 0.75 + 0.25 * sin(uTime * 9.0 + seed * 30.0) * sin(uTime * 3.7 + vLocal.x * 4.0);
      float ember = 0.6 + 0.4 * snoise(vec3(vLocal * 6.0 + vec3(0.0, uTime * 0.6, 0.0)));
      em += vec3(4.5, 1.3, 0.25) * fl * ember * 2.2;
    }
    // lighthouse beacon: a slow sweeping lamp
    if (abs(part - 10.0) < 0.5 && lit) {
      vec2 dir = normalize(vLocal.xz + 1e-4);
      float sweep = pow(max(0.0, cos(atan(dir.y, dir.x) - uTime * 0.9)), 6.0);
      em += vec3(6.0, 5.2, 3.6) * (0.25 + 0.75 * sweep) * (0.15 + 0.85 * night) * 3.0;
    }
    // street lamps: lit from dusk to dawn in the settlement's light (oil, gas, electric)
    if (abs(part - 12.0) < 0.5 && lit) em += lightTint(lightKind) * (lightKind > 3.5 ? 16.0 : 9.0) * smoothstep(0.0, 0.6, night);
    // mast lights: blinking red
    if (abs(part - 8.0) < 0.5) em += vec3(5.0, 0.25, 0.1) * step(0.5, fract(uTime * 0.6 + seed)) * (0.2 + 0.8 * night) * 2.0;
    // burning: the front glows (a band of embers, flickering, hottest at its leading edge) and behind it a few embers
    // still speckle the char (a sparse ~5 % — not a glowing crack net over the whole building)
    if (burning) {
      float fl = 0.65 + 0.35 * sin(uTime * 7.0 + vLocal.x * 3.0 + seed * 20.0) * sin(uTime * 3.1 + vLocal.z * 2.0);
      float lick = 0.7 + 0.3 * vnoise(vec3(vLocal * 3.0 + vec3(0.0, -uTime * 1.2, 0.0)));
      em += vec3(4.2, 1.15, 0.18) * front * fl * lick * 2.4;
      float speck = step(0.95, gn_hash12(floor(vLocal.xz * 7.0 + vLocal.y * 3.0) + floor(uTime * 0.7 + seed)));
      em += vec3(3.0, 0.75, 0.1) * speck * burnt * (1.0 - front) * (0.5 + 0.5 * sin(uTime * 4.0 + vLocal.y * 9.0));
    }
    totalEmissiveRadiance = em;
  }
`;

/** the instanced building material (one shared by every variant mesh of a planet) */
/** doubleSided: for buildings cut open (construction, ruin, fire) — their back faces read as broken wall cores */
export function makeBuildingMaterial(shared: Record<string, IUniform>, doubleSided = false): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: doubleSided ? DoubleSide : FrontSide });
  const debug: IUniform<number> = { value: 0 };
  mat.userData.debug = debug;
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
    shader.uniforms.uBldDebug = debug;
    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  {\n    vec3 nRot = objectNormal;\n    if (abs(aKit.y - 9.0) < 0.5) { float a = uTime * 0.7 + iInfo.w * 6.28; nRot.xy = vec2(cos(a) * nRot.x - sin(a) * nRot.y, sin(a) * nRot.x + cos(a) * nRot.y); }\n    objectNormal = nRot;\n  }')
      .replace('#include <begin_vertex>', VERT_BEGIN)
      .replace('#include <project_vertex>', `#include <project_vertex>
  // the building meshes sit at the identity inside the planet's body-frame group: instance space IS the body frame
  vBodyPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  vLocal = transformed;
  vKUv = uv;
  vKit = aKit;
  vState = iState;
  vInfo = iInfo;
  vFade = 1.0 - iFade.x;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = bMetal;')
      .replace('#include <normal_fragment_maps>', `{
    vec3 sx = dFdx(-vViewPosition); vec3 sy = dFdy(-vViewPosition);
    // bump only where its relief is resolved (within ~20 m): further out the derivatives of course steps and joints
    // between neighbouring pixels tilt the normal wildly — dark and bright specks — and the colour carries the pattern
    float hb = uBldDebug > 0.5 ? 0.0 : bs.h * 0.03 * (1.0 - smoothstep(0.008, 0.03, fwUv));
    vec2 dh = vec2(dFdx(hb), dFdy(hb));
    vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 bn = abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2);
    float bl = length(bn);
    if (bl > 1e-20 && !isnan(bl)) normal = bn / bl;
  }`)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${FRAG_LIGHT}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_AMBIENT}`);
  };
  mat.customProgramCacheKey = () => 'genesis-building-v2';
  return mat;
}

const DEPTH_VERT = /* glsl */ `
#include <common>
attribute vec4 aKit;
attribute vec4 iInfo;
attribute vec4 iState;
attribute vec3 iFade;
uniform float uTime;
varying vec3 vLocal;
varying vec4 vKit;
varying vec4 vState;
varying vec4 vInfo;
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 transformed = position;
  transformed.y += iFade.y * transformed.x + iFade.z * transformed.z;
  vLocal = transformed; vKit = aKit; vState = iState; vInfo = iInfo;
  if (abs(aKit.y - 9.0) < 0.5) {
    float a = uTime * 0.7 + iInfo.w * 6.28;
    vec2 r = vec2(transformed.x, transformed.y - uv.x);
    transformed.xy = vec2(cos(a) * r.x - sin(a) * r.y, sin(a) * r.x + cos(a) * r.y + uv.x);
  }
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;
const DEPTH_FRAG = /* glsl */ `
${NOISE_GLSL}
${CUT_GLSL}
varying vec3 vLocal;
varying vec4 vKit;
varying vec4 vState;
varying vec4 vInfo;
#include <logdepthbuf_pars_fragment>
void main() {
#include <logdepthbuf_fragment>
  float flags = floor(vState.z + 0.5);
  bool ruined = mod(floor(flags / 2.0), 2.0) > 0.5;
  float part = vKit.y;
  if (bldCut(vLocal, part, vState.x, vState.y, ruined, max(vInfo.x, 0.5), vInfo.yz, vKit.z + vInfo.w * 7.13, abs(part - 1.0) < 0.5 ? 1.0 : 0.0)) discard;
  gl_FragColor = vec4(1.0);
}
`;

/**
 * Shadow-caster material for the building variants (sails turn in the shadows too). Kit walls and roofs are closed
 * shells (outer face, inner face, slab undersides), so only their BACK faces cast: a sunlit wall then compares
 * against its own inner face 0.3–0.6 m behind it instead of itself (no acne on lit facades and roofs).
 */
export function makeBuildingDepthMaterial(shared: Record<string, IUniform>): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, uniforms: { uTime: shared.uTime }, colorWrite: false, side: BackSide });
}
