// GENESIS — the ships (CONTRACT.md §12, §15.6, §15.7): every ShipView of the snapshot drawn where the sim says it is,
// in every phase, with the launch VFX it makes (render/fx/launch.ts).
//
//   building   the hull rises at the pad course by course (a clip line with welding sparks)
//   fuelling   frost creeps over the tanks, vapour boils off the vents
//   boarding   venting; the crew walk to the pad (they are agents, drawn by the crowds)
//   pad        the countdown: venting thickens; the engines light in its last tenth (an ignition flash, the plume
//              held down, the ground cloud pouring out of the flame trench)
//   ascent     the analytic climb of the sim (transit.ts: up, bending east to orbit height) with the plume, Mach
//              diamonds, the smoke column and trail, the exhaust's light on the ground; stages separate and tumble away,
//              the escape tower and the payload fairing are jettisoned, strap-on boosters peel off
//   orbit      the upper stage's insertion burn; the orbiter's satellite unfolds its wings; the ark's ring opens and turns
//   transfer   a departure burn, the coast, an arrival burn; drawn in the system frame; its path (flown bright,
//              ahead dim) and a glint in the system view
//   descent    the lander: legs unfold, the descent burn, dust blown off the ground at the end
//   landed     standing on its legs, scorched
//   lost       an explosion where it failed; a burning wreck on the ground
//   stranded   adrift between the worlds, tumbling slowly, a red lamp blinking
// Airships moor nose-on to their mast, rise, cruise with their propellers turning and come down; a gate's horizon
// shimmers in its ring. Sea vessels (raft, boat, sailship) ride the water with their cloth sails billowing.
//
// Positions are interpolated at the render tick from the sim's own formulas (pad, ascent and descent are analytic in
// the phase's progress; an orbit turns at the sim's rate about the plane its last two samples span; a transfer
// extrapolates the system-frame velocity), so a ship moves smoothly between 30 Hz snapshots and at any speed.
// The ship material is MeshStandardMaterial + onBeforeCompile lit like the buildings (this planet's sun through the
// transmittance LUT, cascaded and cloud shadows, sky irradiance and reflections, the moon) with procedural surfaces:
// painted panels, brushed and stainless metal, heat-shield tiles, insulation foam, crinkled gold foil, solar cells,
// a roll pattern, riveted plates, doped airship fabric, canvas, planks and rope.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, Matrix3, Matrix4, Mesh, MeshStandardMaterial, Points,
  Quaternion, ShaderMaterial, Vector2, Vector3, Vector4, type IUniform, type Object3D, type Scene,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { PlanetView, WorldView } from '../../client/worldview.ts';
import type { ShipView } from '../../sim/types.ts';
import { BASE_PACK } from '../../data/index.ts';
import { orbitOffset, spinAt, type D3 } from '../../client/orbits.ts';
import { hashFloat } from '../../sim/core/rng.ts';
import { tangentBasis } from '../../sim/core/vec3.ts';
import { ASCENT_TICKS, DESCENT_TICKS, ORBIT_PERIOD, PAD_TICKS, DAY } from '../../sim/space/transit.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { SHADOW_GLSL } from '../planet/lights.ts';
import { MOON_PARS, moonDirect } from '../shaders/moon.glsl.ts';
import { SPART, SS, eraRank, ERA, shipModel, type ShipModel, type ShipPart } from '../gen/shipgen.ts';
import { KitBuilder } from '../gen/meshkit.ts';
import { groundHeight as groundHeightOf } from '../../sim/grid/surface.ts';
import { buildingAt } from './catalog.ts';
import { LaunchFx, type LaunchPlanetCtx, type Propellant } from '../fx/launch.ts';
import type { CameraPose } from '../frame.ts';
import { Avatar, AVATAR_STATE } from '../camera/avatar.ts';
import { sunIlluminance } from '../frame.ts';
import { blackbody } from '../../client/orbits.ts';

// ───────────────────────────── the ship material ─────────────────────────────

const VERT_PARS = /* glsl */ `
attribute vec4 aKit;
uniform mat4 uWorldToBody;
uniform float uClothT;
uniform vec4 uWind;
varying vec3 vBodyPos;
varying vec3 vLocal;
varying vec2 vKUv;
varying vec4 vKit;
`;

/** sails billow: the cloth bellies out along its normal by its depth (aKit.w × 4 m), breathing and fluttering */
const CLOTH_GLSL = /* glsl */ `
vec3 clothOffset(vec3 p, vec3 n, vec2 uvv, vec4 kit) {
  float u = uvv.x, v = uvv.y;
  float depth = kit.w * 4.0;
  // the belly: deepest in the middle, held at the yard (top) and pulled in at the clews (bottom corners)
  float shape = (1.0 - u * u) * sin(3.14159 * clamp(0.06 + 0.94 * v, 0.0, 1.0)) * (1.0 - 0.25 * v);
  float breathe = 0.86 + 0.14 * sin(uClothT * 1.1 + kit.z * 17.0);
  float flutter = (sin(uClothT * 5.3 + u * 4.1 + v * 6.3 + kit.z * 40.0) * 0.05 + sin(uClothT * 9.1 + u * 9.0 - v * 3.0) * 0.02) * (0.4 + 0.6 * (1.0 - u * u));
  return n * depth * uWind.w * (shape * breathe + flutter);
}
`;

const FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
#ifndef SHIP_SPACE
${CLOUD_DENSITY_GLSL}
#endif
${SHADOW_GLSL}
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
${MOON_PARS}
#ifndef SHIP_SPACE
uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
#endif
uniform vec3 uNightAmbient;
uniform float uClothT;
uniform vec4 uShip;   // x scorch, y frost, z build clip height (local y; 1e9 = whole), w seed
uniform vec4 uShip2;  // x engine heat (firing), y windows lit at night, z portal power, w re-entry char
varying vec3 vBodyPos;
varying vec3 vLocal;
varying vec2 vKUv;
varying vec4 vKit;

float sCloudShadow(vec3 P, vec3 sunB) {
#ifdef SHIP_SPACE
  return 1.0;
#else
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = texture(uCloudCov, normalize(q)).rg;
  return max(exp(-cloudDensityAt(q, 0.35, cs.x, cs.y, false) * (uCloudShell.y - uCloudShell.x) * 0.4), 0.3);
#endif
}
float sh12(vec2 p) { return gn_hash12(p); }
float aaK(float fw, float feature) { return 1.0 - smoothstep(0.15, 0.6, fw / feature); }
// a grid of lines (panel seams): 1 on the panel, darker on the seam, faded to its mean when under a pixel
float seams(vec2 uv, vec2 size, float w, float fw, out vec2 cell) {
  vec2 p = uv / size;
  cell = floor(p);
  vec2 f = abs(fract(p) - 0.5) * size;
  vec2 d = 0.5 * size - f;
  float m = smoothstep(0.0, w, min(d.x, d.y));
  float k = 1.0 - smoothstep(w * 0.4, w * 1.6, fw);
  return mix(1.0 - w * (1.0 / size.x + 1.0 / size.y), m, k);
}
`;

const FRAG_SURFACE = /* glsl */ `
  int code = int(vKit.x + 0.5);
  float part = vKit.y;
  float seed = vKit.z;
  vec2 uvv = vKUv;
  float fw = max(fwidth(uvv.x), fwidth(uvv.y));
  vec3 alb = diffuseColor.rgb;
  float sRough = 0.5, sMetal = 0.0;
  float bumpH = 0.0;
  vec3 sEm = vec3(0.0);
  float night = smoothstep(0.1, -0.08, dot(normalize(vBodyPos), uSunDirBody));
#ifdef SHIP_SPACE
  night = 0.0;
#endif
  // building: the hull rises; nothing above the course being made
  if (vLocal.y > uShip.z) discard;
  vec2 cell;
  if (code == 40) {
    // painted panels: seams on a 1.6 × 2.4 m grid, each panel its own tone, a little gloss
    float m = seams(uvv, vec2(1.6, 2.4), 0.025, fw, cell);
    alb *= mix(0.62, 1.0, m) * (0.95 + 0.08 * sh12(cell + seed * 13.0));
    sRough = 0.36 + 0.12 * vnoise(vec3(uvv * 0.6, seed * 9.0));
    bumpH = (m - 1.0) * 0.4;
  } else if (code == 41) {
    // brushed aluminium
    alb *= 0.9 + 0.12 * vnoise(vec3(uvv.x * 30.0, uvv.y * 0.6, seed));
    sMetal = 0.9; sRough = 0.3 + 0.15 * vnoise(vec3(uvv.x * 60.0, uvv.y * 3.0, 7.0));
  } else if (code == 42) {
    // heat-shield tiles: 0.2 m squares, each a slightly different charcoal
    float m = seams(uvv, vec2(0.2, 0.2), 0.008, fw, cell);
    alb = mix(vec3(0.11, 0.11, 0.115), alb, 0.5) * (0.75 + 0.5 * sh12(cell + seed)) * mix(1.6, 1.0, m);
    sRough = 0.78;
    bumpH = (m - 1.0) * 0.3;
  } else if (code == 43) {
    // spray-on insulation foam: mottled rust-orange
    float n = snoise(vLocal * 2.2) * 0.5 + snoise(vLocal * 7.0) * 0.25;
    alb *= 0.85 + 0.3 * n;
    sRough = 0.92;
    bumpH = n * 0.3;
  } else if (code == 44) {
    // multilayer insulation: crinkled gold foil
    float n = snoise(vLocal * 5.3 + seed) + 0.5 * snoise(vLocal * 13.0);
    alb *= 0.8 + 0.35 * n;
    sMetal = 1.0; sRough = 0.16 + 0.22 * abs(n);
    bumpH = n * 1.6;
  } else if (code == 45) {
    // solar cells: deep blue squares with silver bus bars
    float m = seams(uvv, vec2(0.16, 0.16), 0.01, fw, cell);
    alb = mix(vec3(0.5, 0.5, 0.52), alb * (0.9 + 0.2 * sh12(cell)), m);
    sRough = mix(0.35, 0.1, m); sMetal = mix(0.8, 0.25, m);
  } else if (code == 46) {
    alb = vec3(0.02, 0.025, 0.03); sRough = 0.05; sMetal = 0.0;
    sEm += vec3(1.0, 0.78, 0.5) * 2.2 * uShip2.y * max(night, 0.25) * (0.75 + 0.25 * sh12(vec2(seed * 31.0, 1.0)));
  } else if (code == 47) {
    // nozzle: dark metal, heat-blued and straw-gold toward the throat; it glows while the engine burns
    float t = clamp(uvv.y / 2.5, 0.0, 1.0);
    alb = mix(alb, mix(vec3(0.2, 0.15, 0.08), vec3(0.08, 0.09, 0.14), smoothstep(0.3, 0.8, t)), 0.6);
    sMetal = 0.75; sRough = 0.38;
    float inner = 1.0 - smoothstep(0.5, 0.9, vKit.w);
    sEm += vec3(5.0, 2.0, 0.55) * uShip2.x * (0.25 + 0.75 * inner) * (0.6 + 0.4 * t);
  } else if (code == 48) {
    // doped airship fabric over girders: a seam every girder (16 round), rings every 6 m, a silvery sheen
    float gird = abs(fract(uvv.x / (6.2832 * 7.2 / 16.0)) - 0.5) * (6.2832 * 7.2 / 16.0);
    float ring = abs(fract(uvv.y / 6.0) - 0.5) * 6.0;
    float m = smoothstep(0.0, 0.05, min(gird, ring) - 0.0);
    float k = 1.0 - smoothstep(0.02, 0.12, fw);
    alb *= mix(1.0, mix(0.78, 1.0, m), k) * (0.95 + 0.06 * vnoise(vec3(uvv * 0.4, 3.0)));
    sMetal = 0.35; sRough = 0.45;
  } else if (code == 49) {
    // the roll pattern: black and white quarters in bands, for telling the rocket's spin from the ground
    float ang = atan(vLocal.z, vLocal.x);
    float q = floor((ang + 3.14159) / 1.570796);
    float band = floor(vLocal.y / 2.6);
    float black = mod(q + band, 2.0);
    alb = mix(alb, vec3(0.03), black);
    sRough = 0.4;
  } else if (code == 50) {
    // riveted plates: rows of rivets along the plate edges, tones per plate
    float m = seams(uvv, vec2(1.2, 0.9), 0.012, fw, cell);
    vec2 fr = fract(uvv / vec2(1.2, 0.9)) * vec2(1.2, 0.9);
    vec2 rv = abs(fract(uvv / 0.15) - 0.5) * 0.15;
    float edgeBand = min(min(fr.x, 1.2 - fr.x), min(fr.y, 0.9 - fr.y));
    float rivet = (1.0 - smoothstep(0.012, 0.022, length(rv))) * (1.0 - smoothstep(0.04, 0.06, edgeBand)) * aaK(fw, 0.03);
    alb *= mix(0.75, 1.0, m) * (0.9 + 0.15 * sh12(cell + seed * 7.0)) * (1.0 + 0.4 * rivet);
    sMetal = 0.45; sRough = 0.5 - 0.15 * rivet;
    bumpH = rivet * 0.6 + (m - 1.0) * 0.3;
  } else if (code == 51) { sRough = 0.75; }
  else if (code == 52) { sMetal = 1.0; sRough = 0.28; }
  else if (code == 53) {
    // bamboo, paper and lacquer: fibres along the tube
    alb *= 0.85 + 0.25 * vnoise(vec3(uvv.x * 40.0, uvv.y * 2.0, seed));
    sRough = 0.7;
  } else if (code == 54) {
    // navigation / beacon lamps: blinking red
    float on = step(0.55, fract(uClothT * 0.7 + seed * 3.0));
    sEm += vec3(6.0, 0.4, 0.15) * (0.25 + 0.75 * on) * (0.3 + 0.7 * night) * 2.0;
    alb = vec3(0.3, 0.05, 0.04);
  } else if (code == 55) { sRough = 0.55; }
  else if (code == 56) {
    // canvas: vertical cloth seams, a weave, the foot dirtier and patched
    float seamC = abs(fract(uvv.x * 7.0) - 0.5);
    float m = smoothstep(0.0, 0.06, seamC);
    alb *= mix(0.8, 1.0, m) * (0.92 + 0.1 * vnoise(vec3(uvv * vec2(30.0, 40.0), seed))) * mix(1.0, 0.8, smoothstep(0.6, 1.0, uvv.y));
    float patch = step(0.86, sh12(floor(vec2(uvv.x * 4.0, uvv.y * 5.0)) + seed * 11.0));
    alb *= mix(1.0, 0.82, patch);
    sRough = 0.85;
  } else if (code == 57) {
    // stainless steel: bright, faint weld lines, streaks of soot
    float ring = abs(fract(vLocal.y / 1.8) - 0.5);
    alb *= 0.92 + 0.08 * smoothstep(0.0, 0.02, ring) + 0.05 * vnoise(vec3(uvv * vec2(4.0, 0.3), seed));
    sMetal = 0.95; sRough = 0.22 + 0.1 * vnoise(vec3(uvv.x * 20.0, uvv.y * 0.5, 1.0));
  } else if (code == 58) {
    // a gate's event horizon: a sheet of rippling light, darker at the centre (a well), rings running inward
    float r = uvv.x;
    float ang = uvv.y * 6.2832;
    float w = sin(r * 26.0 + uClothT * 4.0 + snoise(vec3(cos(ang) * 2.0, sin(ang) * 2.0, uClothT * 0.4)) * 2.5);
    float swirl = snoise(vec3(r * 3.0 - uClothT * 0.5, cos(ang + r * 4.0 + uClothT * 0.3) * 1.5, sin(ang + r * 4.0) * 1.5));
    vec3 c = mix(vec3(0.25, 0.55, 1.4), vec3(0.8, 0.95, 1.6), 0.5 + 0.5 * w) * (0.55 + 0.45 * swirl);
    c *= 0.4 + 0.8 * smoothstep(0.0, 0.85, r);
    if (uShip2.z < 0.01) discard;
    if (r > uShip2.z * 1.02 + 0.02) discard;
    alb = vec3(0.01);
    sEm += c * 6.0 * uShip2.z;
    sRough = 0.1;
  } else if (code == 5) {
    // planks along the hull: strakes with dark seams (caulking), grain
    float m = seams(vec2(uvv.x * 0.25, uvv.y), vec2(1.4, 0.22), 0.01, fw, cell);
    alb *= mix(0.55, 1.0, m) * (0.85 + 0.25 * sh12(cell + seed * 5.0)) * (0.92 + 0.12 * vnoise(vec3(uvv.x * 3.0, uvv.y * 40.0, seed)));
    sRough = 0.82;
    bumpH = (m - 1.0) * 0.5;
  } else if (code == 16 || code == 21) {
    alb *= 0.85 + 0.25 * vnoise(vec3(uvv.x * 8.0, uvv.y * 1.5, seed * 3.0));
    sRough = 0.85;
  } else if (code == 23) {
    alb *= 0.8 + 0.3 * sin(uvv.y * 60.0 + uvv.x * 10.0) * 0.5 + 0.1;
    sRough = 0.9;
  } else if (code == 24) { sMetal = 0.6; sRough = 0.6; }
  else if (code == 12) { sRough = 0.85; }
  // soot from the engines low on the hull, frost on the tanks, the char of coming down
  float soot = uShip.x * (1.0 - smoothstep(0.0, 7.0, vLocal.y)) * (0.6 + 0.4 * snoise(vLocal * 1.3));
  alb *= 1.0 - 0.7 * clamp(soot, 0.0, 1.0);
  if (uShip.y > 0.0 && (code == 40 || code == 43 || code == 57 || code == 49)) {
    float fr = smoothstep(0.35, 0.75, snoise(vec3(vLocal.x * 1.5, vLocal.y * 0.4, vLocal.z * 1.5)) * 0.5 + 0.5 + uShip.y * 0.6 - 0.3);
    alb = mix(alb, vec3(0.78, 0.82, 0.86), fr * uShip.y);
    sRough = mix(sRough, 0.9, fr * uShip.y);
    sMetal *= 1.0 - fr * uShip.y;
  }
  if (uShip2.w > 0.0) {
    float ch = uShip2.w * (0.6 + 0.4 * snoise(vLocal * 2.0));
    alb = mix(alb, vec3(0.06, 0.05, 0.045), clamp(ch, 0.0, 0.85));
    sRough = mix(sRough, 0.8, uShip2.w);
  }
  // the weld line at a rising hull's top
  if (uShip.z < 1e8) sEm += vec3(4.0, 2.6, 1.4) * (1.0 - smoothstep(0.0, 0.25, uShip.z - vLocal.y)) * (0.6 + 0.4 * sin(uClothT * 31.0 + vLocal.x * 7.0));
  diffuseColor.rgb = alb;
`;

const FRAG_NORMAL = /* glsl */ `
{
#ifdef SHIP_SAIL
  // cloth: the billowed sheet's own normal from the screen derivatives of its position, facing the camera
  vec3 dn = normalize(cross(dFdx(-vViewPosition), dFdy(-vViewPosition)));
  if (dot(dn, vViewPosition) < 0.0) dn = -dn;
  normal = normalize(mix(normal * (dot(normal, vViewPosition) < 0.0 ? -1.0 : 1.0), dn, 0.75));
#else
  vec3 sx = dFdx(-vViewPosition); vec3 sy = dFdy(-vViewPosition);
  float hb = bumpH * 0.02 * (1.0 - smoothstep(0.01, 0.05, fw));
  vec2 dh = vec2(dFdx(hb), dFdy(hb));
  vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1);
  vec3 bn = abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2);
  float bl = length(bn);
  if (bl > 1e-20 && !isnan(bl)) normal = bn / bl;
#endif
}
`;

const FRAG_LIGHT = /* glsl */ `
  {
    float sh = sunShadow(-vViewPosition, normal);
#ifdef SHIP_SPACE
    vec3 sunCol = uSunE;
#else
    float rP = length(vBodyPos);
    vec3 upB = vBodyPos / rP;
    vec3 sunCol = uSunE * sunTransmittance(rP, dot(upB, uSunDirBody)) * sh * sCloudShadow(vBodyPos, uSunDirBody);
#endif
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = sunCol;
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
#ifdef SHIP_SAIL
    // sunlight through the canvas (seen from the shaded side, a sail glows)
    float back = max(0.0, -dot(geometryNormal, uSunDirView));
    reflectedLight.directDiffuse += sunCol * back * 0.28 * diffuseColor.rgb;
#endif
#ifndef SHIP_SPACE
    ${moonDirect('vBodyPos', '1.0')}
#endif
  }
`;

const FRAG_AMBIENT = /* glsl */ `
  {
#ifdef SHIP_SPACE
    // starlight and the glow of nearby worlds: a faint fill so the shadow side is not a void
    iblIrradiance += vec3(0.004, 0.0045, 0.006) + uNightAmbient;
#else
    vec3 upB = normalize(vBodyPos);
    mat3 viewToBody = transpose(uBodyToView);
    vec3 nB = normalize(viewToBody * normal);
    vec3 vB = normalize(viewToBody * geometryViewDir);
    float ao = clamp(vKit.w, 0.3, 1.0);
#ifdef SHIP_SAIL
    ao = 1.0;
#endif
    iblIrradiance += (skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient) * ao;
    vec3 rB = reflect(-vB, nB);
    float horizonK = smoothstep(-0.05, 0.3, dot(rB, upB));
    rB = normalize(rB + upB * max(0.0, -dot(rB, upB)) * 1.05);
    radiance += skyRadiance(upB, rB, uSunDirBody) * horizonK * ao;
#endif
  }
`;

type ShipVariant = 'hull' | 'sail';

function makeShipMaterial(shared: Record<string, IUniform>, own: Record<string, IUniform>, variant: ShipVariant, space: boolean): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, side: variant === 'sail' ? DoubleSide : DoubleSide });
  mat.defines = {};
  if (variant === 'sail') mat.defines.SHIP_SAIL = '';
  if (space) mat.defines.SHIP_SPACE = '';
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
    for (const k of Object.keys(own)) shader.uniforms[k] = own[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${VERT_PARS}\n${CLOTH_GLSL}`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
#ifdef SHIP_SAIL
  transformed += clothOffset(position, normal, uv, aKit);
#endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  vBodyPos = (uWorldToBody * modelMatrix * vec4(transformed, 1.0)).xyz;
  vLocal = transformed;
  vKUv = uv;
  vKit = aKit;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = sMetal;')
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = sEm;')
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${FRAG_LIGHT}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_AMBIENT}`);
  };
  mat.customProgramCacheKey = () => `genesis-ship-v1-${variant}-${space ? 's' : 'p'}`;
  return mat;
}

const DEPTH_VERT = /* glsl */ `
#include <common>
attribute vec4 aKit;
uniform float uClothT;
uniform vec4 uWind;
uniform vec4 uShip;
varying float vY;
${CLOTH_GLSL}
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 transformed = position;
#ifdef SHIP_SAIL
  transformed += clothOffset(position, normal, uv, aKit);
#endif
  vY = transformed.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
#include <logdepthbuf_vertex>
}
`;
const DEPTH_FRAG = /* glsl */ `
uniform vec4 uShip;
varying float vY;
#include <logdepthbuf_pars_fragment>
void main() {
#include <logdepthbuf_fragment>
  if (vY > uShip.z) discard;
  gl_FragColor = vec4(1.0);
}
`;

function makeShipDepth(own: Record<string, IUniform>, variant: ShipVariant): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, uniforms: { uClothT: own.uClothT, uWind: own.uWind, uShip: own.uShip },
    defines: variant === 'sail' ? { SHIP_SAIL: '' } : {}, side: DoubleSide, colorWrite: false,
  });
}

// ───────────────────────────── kinds, eras, frames ─────────────────────────────

interface KindInfo { cls: string; altitude: number; orbitHours: number; days: [number, number] }
const KINDS = new Map<string, KindInfo>(((BASE_PACK as unknown as { ships?: { id: string; class: string; altitude: number; orbitHours: number; days: [number, number] }[] }).ships ?? [])
  .map((s) => [s.id, { cls: s.class, altitude: s.altitude, orbitHours: s.orbitHours, days: s.days }]));
function kindInfo(kind: string): KindInfo {
  return KINDS.get(kind) ?? (kind === 'raft' || kind === 'boat' || kind === 'sailship' ? { cls: 'sea', altitude: 0, orbitHours: 0, days: [1, 3] } : { cls: 'interplanetary', altitude: 1500, orbitHours: 2, days: [2.5, 6] });
}

/** the sim's ascent arc (space/transit.ts ASCENT_ARC): how far east the climb bends before orbit (rad) */
const ASCENT_ARC = 0.35;

function rotY(v: ArrayLike<number>, a: number, out: D3 = [0, 0, 0]): D3 {
  const c = Math.cos(a), s = Math.sin(a);
  const x = v[0] * c + v[2] * s, z = -v[0] * s + v[2] * c;
  out[0] = x; out[1] = v[1]; out[2] = z;
  return out;
}
function norm(v: D3): D3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
function slerpU(a: ArrayLike<number>, b: ArrayLike<number>, t: number): D3 {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  if (d > 0.99999) return norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  const th = Math.acos(d), s = Math.sin(th);
  const k0 = Math.sin((1 - t) * th) / s, k1 = Math.sin(t * th) / s;
  return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
}
const smooth01 = (f: number) => { const t = Math.max(0, Math.min(1, f)); return t * t * (3 - 2 * t); };

/** the era the owner's people are at (their settlement on the world the ship left), or the kind's natural era */
function eraOf(view: WorldView, s: ShipView): string {
  for (const pv of view.planets) for (const st of pv.settlements) if (st.id === s.owner && (pv.id === s.from || pv.id === s.planet)) return st.era;
  return s.kind === 'airship' ? 'steam' : s.kind === 'raft' ? 'stone' : s.kind === 'boat' ? 'bronze' : s.kind === 'sailship' ? 'medieval' : 'space';
}

function propellant(model: ShipModel, stage: number): Propellant {
  if (model.shape === 'rocket' && eraRank(model.era) < ERA.electric) return 'powder';
  if (model.shape === 'generation-ship' || model.shape === 'ark' || model.shape === 'ark-lander') return 'methalox';
  return stage >= 1 ? 'hydrolox' : 'kerolox';
}

// ───────────────────────────── per-ship state ─────────────────────────────

interface PartNode {
  part: ShipPart;
  pivot: Group;
  mesh: Mesh;
  /** detached (a separated stage, a fairing half, a tower, a booster): its own analytic flight */
  detached: null | { t0: number; p: Vector3; v: Vector3; q: Quaternion; axis: Vector3; spin: number; up: Vector3 };
}

interface Sample { tick: number; planet: number; pos: D3; alt: number; sys: D3; progress: number; phase: string }

interface Track {
  id: number;
  view: ShipView;
  kind: string;
  info: KindInfo;
  era: string;
  form: 'launch' | 'space' | 'lander';
  model: ShipModel;
  root: Group;
  nodes: PartNode[];
  own: Record<string, IUniform>;
  hullMat: MeshStandardMaterial | null;
  sailMat: MeshStandardMaterial | null;
  hullDepth: ShaderMaterial;
  sailDepth: ShaderMaterial;
  matPlanet: number;
  samples: Sample[];
  phase: string;
  /** tick the current phase began (estimated) and its length in ticks */
  phaseT0: number;
  phaseLen: number;
  /** pad: body-frame unit vector, yaw of its pad building (rad), ground radius there, deck height */
  padDir: D3 | null;
  padYaw: number;
  padGround: number;
  deck: number;
  /** the pad rig (umbilicals, mount) while on the pad */
  rig: Group | null;
  /** state of the separations already done (part name → true) */
  fired: Set<string>;
  lastLost: boolean;
  seenAt: number;
  /** system-view trail */
  trail: Line2 | null;
  trailAhead: Line2 | null;
  trailKey: string;
  /** interpolated pose this frame */
  pose: ShipPose;
  ignited: boolean;
  /** render tick the current phase was first seen (open-ended phases animate from it), when it was lost */
  phaseSeen: number;
  lostAt: number;
  /** the pad point last searched for (findPad runs when it changes) */
  padKey: string;
}

/** where every ship is drawn this frame (for the follow camera and picking): body frame of `planet` or system frame */
export interface ShipPose {
  id: number;
  kind: string;
  phase: string;
  planet: number;
  /** body-frame position (m) when planet ≥ 0 */
  body: Vector3;
  /** system-frame position (m) */
  sys: D3;
  /** the ship's axis (+Y of the model) and bow (+Z) in that frame */
  up: Vector3;
  fwd: Vector3;
  /** size (m): height / length */
  size: number;
  visible: boolean;
}

export const SHIP_POSES = new Map<number, ShipPose>();

const _m4 = new Matrix4();
const _m4b = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();

/** quaternion from a basis: +Y = up, +Z = fwd (orthonormalised) */
function basisQ(up: Vector3, fwd: Vector3, out: Quaternion): Quaternion {
  _y.copy(up).normalize();
  _z.copy(fwd).addScaledVector(_y, -_y.dot(fwd));
  if (_z.lengthSq() < 1e-10) { _z.set(1, 0, 0).addScaledVector(_y, -_y.x); if (_z.lengthSq() < 1e-10) _z.set(0, 0, 1); }
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m4.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m4);
}

// ───────────────────────────── the layer ─────────────────────────────

/** what the layer needs of a planet's visual (render/planet/planetview.ts PlanetVisual) */
export interface ShipPlanetRef {
  group: Group;
  uniforms: Record<string, IUniform>;
  camBody: Vector3;
  pv: PlanetView;
  hasAir: boolean;
  airTop: number;
  shadows: boolean;
}

export class ShipLayer {
  readonly fx = new LaunchFx();
  /** ships between the worlds, in the system frame (placed each frame relative to the camera) */
  readonly spaceGroup = new Group();
  /** the system view's overlay: glints and trails */
  readonly overlay = new Group();
  private tracks = new Map<number, Track>();
  private spaceUniforms: Record<string, IUniform>;
  private glints: Points;
  private glintMat: ShaderMaterial;
  private glintPos = new Float32Array(3 * 64);
  private glintCol = new Float32Array(3 * 64);
  private glintIds: number[] = [];
  private resolution = new Vector2(1280, 720);
  private lastTick = -1;
  /** 0..1: how much of the system view's overlay is shown (the orbit lines' visibility) */
  overlayVis = 0;
  /** drawn this frame */
  stats = { ships: 0, parts: 0 };
  /** the god's body while walking (render/camera/avatar.ts, posed by camera/walk.ts) */
  private avatar: Avatar | null = null;

  constructor() {
    this.spaceGroup.name = 'ships-space';
    this.overlay.name = 'ships-overlay';
    this.spaceUniforms = {
      uSunE: { value: new Vector3(4, 4, 4) }, uSunDirView: { value: new Vector3(1, 0, 0) }, uSunDirBody: { value: new Vector3(1, 0, 0) },
      uBodyToView: { value: new Matrix3() }, uNightAmbient: { value: new Vector3(0.001, 0.0012, 0.0016) }, uMoonE: { value: new Vector3() },
      uMoonDirBody: { value: new Vector3(0, 1, 0) }, uMoonDirView: { value: new Vector3(0, 1, 0) }, uShadowOn: { value: 0 }, uHasAtmo: { value: 0 },
      uRg: { value: 1 }, uRt: { value: 2 },
    };
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.glintPos, 3));
    g.setAttribute('aColor', new BufferAttribute(this.glintCol, 3));
    this.glintMat = new ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 aColor; varying vec3 vColor; uniform float uPixelRatio;
        void main() { vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_Position.z = 0.0; gl_PointSize = 11.0 * uPixelRatio; }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; varying vec3 vColor;
        void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
          // a diamond with a soft halo: ships read apart from the round planet glints
          float dia = 1.0 - smoothstep(0.3, 0.38, abs(d.x) + abs(d.y));
          float glow = exp(-r * r * 4.0) * 0.4;
          gl_FragColor = vec4(vColor * (dia + glow) * uOpacity, 1.0); }`,
      uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
    });
    this.glints = new Points(g, this.glintMat);
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 21;
    this.overlay.add(this.glints);
  }

  setResolution(w: number, h: number, pixelRatio: number): void {
    this.resolution.set(w, h);
    this.glintMat.uniforms.uPixelRatio.value = pixelRatio;
    for (const t of this.tracks.values()) for (const l of [t.trail, t.trailAhead]) if (l) (l.material as LineMaterial).resolution.set(w, h);
  }

  // ── models and materials ──

  private build(t: Track): void {
    // forget the old meshes
    for (const n of t.nodes) { n.pivot.parent?.remove(n.pivot); }
    t.nodes = [];
    t.root.clear();
    for (const part of t.model.parts) {
      const pivot = new Group();
      pivot.position.set(part.pivot[0], part.pivot[1], part.pivot[2]);
      const mesh = new Mesh(part.geo, part.cloth ? t.sailMat ?? undefined : t.hullMat ?? undefined);
      mesh.position.set(-part.pivot[0], -part.pivot[1], -part.pivot[2]);
      mesh.frustumCulled = false;
      mesh.userData.cloth = part.cloth;
      pivot.add(mesh);
      t.root.add(pivot);
      t.nodes.push({ part, pivot, mesh, detached: null });
    }
    t.fired.clear();
  }

  private bindMaterials(t: Track, planet: number, ref: ShipPlanetRef | null): void {
    if (t.matPlanet === planet && t.hullMat) return;
    t.hullMat?.dispose();
    t.sailMat?.dispose();
    const space = planet < 0 || !ref;
    const shared = space ? this.spaceUniforms : ref!.uniforms;
    t.hullMat = makeShipMaterial(shared, t.own, 'hull', space);
    t.sailMat = makeShipMaterial(shared, t.own, 'sail', space);
    t.matPlanet = planet;
    for (const n of t.nodes) n.mesh.material = n.part.cloth ? t.sailMat : t.hullMat;
  }

  private setForm(t: Track, form: 'launch' | 'space' | 'lander'): void {
    if (t.form === form && t.nodes.length) return;
    t.form = form;
    t.model = shipModel(t.kind, t.era, form, t.id);
    this.build(t);
  }

  private newTrack(view: WorldView, s: ShipView): Track {
    const info = kindInfo(s.kind);
    const era = eraOf(view, s);
    const own: Record<string, IUniform> = {
      uWorldToBody: { value: new Matrix4() }, uClothT: { value: 0 }, uWind: { value: new Vector4(1, 0, 0, 1) },
      uShip: { value: new Vector4(0, 0, 1e9, (s.id % 97) / 97) }, uShip2: { value: new Vector4(0, 1, 0, 0) },
    };
    const root = new Group();
    root.name = `ship-${s.id}`;
    const t: Track = {
      id: s.id, view: s, kind: s.kind, info, era, form: 'launch', model: shipModel(s.kind, era, 'launch', s.id), root, nodes: [], own,
      hullMat: null, sailMat: null, hullDepth: makeShipDepth(own, 'hull'), sailDepth: makeShipDepth(own, 'sail'), matPlanet: -99,
      samples: [], phase: s.phase, phaseT0: 0, phaseLen: 1, padDir: null, padYaw: 0, padGround: 0, deck: 0, rig: null, fired: new Set(),
      lastLost: s.phase === 'lost', seenAt: 0, trail: null, trailAhead: null, trailKey: '', ignited: s.phase !== 'building' && s.phase !== 'fuelling' && s.phase !== 'boarding' && s.phase !== 'pad',
      phaseSeen: view.renderTick, lostAt: -1e9, padKey: '',
      pose: { id: s.id, kind: s.kind, phase: s.phase, planet: s.planet, body: new Vector3(), sys: [0, 0, 0], up: new Vector3(0, 1, 0), fwd: new Vector3(0, 0, 1), size: 10, visible: false },
    };
    this.build(t);
    return t;
  }

  // ── sampling and timing ──

  private sample(t: Track, s: ShipView, snapTick: number): void {
    const last = t.samples[t.samples.length - 1];
    if (last && last.tick === snapTick && last.phase === s.phase) { last.pos = [...s.pos]; last.alt = s.alt; last.sys = [...s.sysPos]; last.progress = s.progress; last.planet = s.planet; return; }
    t.samples.push({ tick: snapTick, planet: s.planet, pos: [s.pos[0], s.pos[1], s.pos[2]], alt: s.alt, sys: [s.sysPos[0], s.sysPos[1], s.sysPos[2]], progress: s.progress, phase: s.phase });
    if (t.samples.length > 3) t.samples.shift();
  }

  /** the phase's length (ticks): the sim's constants where it has them, else from the progress rate */
  private phaseLength(t: Track, s: ShipView, view: WorldView): number {
    const air = t.info.cls === 'air';
    switch (s.phase) {
      case 'pad': return PAD_TICKS;
      case 'ascent': return air ? 30 : ASCENT_TICKS;
      case 'descent': return DESCENT_TICKS;
      case 'orbit': if (t.info.orbitHours > 0) return t.info.orbitHours * 60; break;
    }
    // from two samples in the same phase
    const a = t.samples[t.samples.length - 2], b = t.samples[t.samples.length - 1];
    if (a && b && a.phase === b.phase && b.tick > a.tick && b.progress > a.progress) return (b.tick - a.tick) / (b.progress - a.progress);
    if (s.phase === 'transfer') return this.estimateTransfer(t, s, view);
    return t.phaseLen > 1 ? t.phaseLen : 600;
  }

  /** the sim's transfer length (transit.ts transferTicks) from the worlds' distance at departure (two fixed-point passes) */
  private estimateTransfer(t: Track, s: ShipView, view: WorldView): number {
    const from = view.planet(s.from), to = view.planet(s.to);
    if (!from || !to) return 3 * DAY;
    if (t.info.cls === 'gate') return 3;
    let T = t.info.days[0] * DAY;
    const now = view.snapTick;
    const a: D3 = [0, 0, 0], b: D3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const t0 = now - s.progress * T;
      centerAt(view, from, t0, a);
      centerAt(view, to, t0, b);
      const au = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 1.5e6;
      const kk = Math.max(0, Math.min(1, (au - 0.15) / 2.5));
      T = Math.max(30, Math.round((t.info.days[0] + (t.info.days[1] - t.info.days[0]) * kk) * DAY));
    }
    return T;
  }

  // ── per frame ──

  /**
   * Place, animate and light every ship for this frame; feed the launch FX; draw the system overlay.
   * `planets` maps planet id → its visual (the primary planet and any other drawn).
   */
  update(view: WorldView, pose: CameraPose, planets: Map<number, ShipPlanetRef>, scene: Scene, time: number, dt: number, primary: number, shadows: boolean): void {
    const tick = view.renderTick;
    if (this.lastTick >= 0 && tick < this.lastTick - 5) {
      // a rewind: separations and wrecks of the undone future go
      for (const t of this.tracks.values()) { t.fired.clear(); this.build(t); t.samples.length = 0; }
    }
    this.lastTick = tick;
    if (this.spaceGroup.parent !== scene) scene.add(this.spaceGroup);
    if (this.overlay.parent !== scene) scene.add(this.overlay);
    this.fx.begin(tick);
    // space lighting: the star from where the camera is
    this.spaceLight(view, pose, planets);
    const seen = new Set<number>();
    let parts = 0;
    for (const s of view.ships) {
      seen.add(s.id);
      let t = this.tracks.get(s.id);
      if (!t) { t = this.newTrack(view, s); this.tracks.set(s.id, t); }
      t.view = s;
      t.seenAt = time;
      this.sample(t, s, view.snapTick);
      if (s.phase !== t.phase) this.phaseChange(t, s, view, planets);
      t.phase = s.phase;
      const len = this.phaseLength(t, s, view);
      t.phaseLen = len;
      // phase start, re-estimated from each snapshot (the progress is exact at the snapshot tick)
      t.phaseT0 = view.snapTick - s.progress * len;
      this.place(t, s, view, pose, planets, time, dt, primary, shadows);
      if (t.pose.visible) parts += t.nodes.length;
    }
    for (const [id, t] of this.tracks) {
      if (seen.has(id)) continue;
      this.disposeTrack(t);
      this.tracks.delete(id);
      SHIP_POSES.delete(id);
    }
    this.stats.ships = this.tracks.size;
    this.stats.parts = parts;
    // the launch FX
    const ctxOf = (planet: number): LaunchPlanetCtx | null => {
      const r = planets.get(planet);
      if (!r) return null;
      return { group: r.group, uniforms: r.uniforms, camBody: r.camBody, wind: this.windAt(r.pv), airTop: r.airTop, radius: r.pv.params.radius, hasAir: r.hasAir };
    };
    this.placeAvatar(planets, time);
    this.fx.update(ctxOf, pose.pos, primary, time, dt);
    this.updateOverlay(view, pose);
    this.spaceGroup.position.set(0, 0, 0);
  }

  /** the god's body: on its world's group, standing on the ground, its light on what is around it */
  private placeAvatar(planets: Map<number, ShipPlanetRef>, time: number): void {
    const s = AVATAR_STATE;
    const ref = s.active ? planets.get(s.planet) : undefined;
    if (!ref) { if (this.avatar) this.avatar.group.visible = false; return; }
    if (!this.avatar) this.avatar = new Avatar();
    const a = this.avatar;
    if (a.group.parent !== ref.group) ref.group.add(a.group);
    a.group.position.copy(s.pos);
    basisQ(s.up, s.fwd, a.group.quaternion);
    a.pose(time, ref.uniforms.uSunDirView ? (ref.uniforms.uSunDirView.value as Vector3) : null);
    // its light on the ground and the people (kind: gold; feared: ember red)
    const good = Math.max(0, Math.min(1, s.alignment * 0.5 + 0.5));
    const I = 2.2e4;
    const c = good > 0.5 ? [1, 0.82 + 0.1 * (1 - good), 0.55 + 0.25 * (1 - good)] : [1, 0.25 + 0.5 * good, 0.12 + 0.6 * good];
    _v3.copy(s.up).multiplyScalar(1.4).add(s.pos);
    this.fx.light(s.planet, this.ctx(ref), _v3.x, _v3.y, _v3.z, 26, c[0] * I, c[1] * I, c[2] * I);
  }

  /** wind for the smoke (the sim's wind field near the pad, or a light easterly) */
  private windCache = new Map<number, { v: Vector3; at: number }>();
  private windAt(pv: PlanetView): Vector3 {
    let w = this.windCache.get(pv.id);
    if (!w) { w = { v: new Vector3(), at: -1 }; this.windCache.set(pv.id, w); }
    const ver = (pv.fieldVersion.get('windX') ?? 0) + this.tracks.size * 1000;
    if (w.at === ver) return w.v;
    w.at = ver;
    let ref: D3 | null = null;
    for (const t of this.tracks.values()) if (t.view.planet === pv.id || t.view.from === pv.id) { ref = t.padDir ?? [t.view.pos[0], t.view.pos[1], t.view.pos[2]]; break; }
    if (!ref) { w.v.set(0, 0, 0); return w.v; }
    const d = norm([ref[0], ref[1], ref[2]]);
    const wX = pv.fields.get('windX'), wY = pv.fields.get('windY'), wZ = pv.fields.get('windZ');
    if (wX && wY && wZ) w.v.set(pv.grid.sample(wX, d[0], d[1], d[2]), pv.grid.sample(wY, d[0], d[1], d[2]), pv.grid.sample(wZ, d[0], d[1], d[2]));
    else { const e: D3 = [0, 0, 0], n: D3 = [0, 0, 0]; tangentBasis(e, n, d); w.v.set(e[0] * 2.4, e[1] * 2.4, e[2] * 2.4); }
    return w.v;
  }

  private spaceLight(view: WorldView, pose: CameraPose, planets: Map<number, ShipPlanetRef>): void {
    const u = this.spaceUniforms;
    const d = Math.hypot(pose.pos[0], pose.pos[1], pose.pos[2]) || 1;
    const E = sunIlluminance(view.star.luminosity, d);
    const c = blackbody(view.star.temperature || 5800);
    (u.uSunE.value as Vector3).set(c[0] * E, c[1] * E, c[2] * E);
    // toward the star, in the system frame (the space material's "body" frame) and in view space
    const sb = (u.uSunDirBody.value as Vector3).set(-pose.pos[0] / d, -pose.pos[1] / d, -pose.pos[2] / d);
    _q.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]).invert();
    (u.uSunDirView.value as Vector3).copy(sb).applyQuaternion(_q);
    // the shadow sampler must be bound to the real depth atlas (a shadow sampler on a colour texture is a GL error);
    // its switch stays off in space
    for (const r of planets.values()) {
      for (const k of ['uShadowMap', 'uShadowMat', 'uShadowSplits', 'uShadowBias', 'uShadowCount', 'uShadowTexel', 'uSkyLUT', 'uIrrSH', 'uTransLUT', 'uMsLUT']) if (r.uniforms[k] && !u[k]) u[k] = r.uniforms[k];
      break;
    }
  }

  private phaseChange(t: Track, s: ShipView, view: WorldView, planets: Map<number, ShipPlanetRef>): void {
    if (s.phase === 'lost' && !t.lastLost) {
      // it failed: an explosion where it was drawn last
      const p = t.pose;
      const ref = p.planet >= 0 ? planets.get(p.planet) : undefined;
      const ctx = ref ? this.ctx(ref) : null;
      this.fx.explode(p.planet, ctx, p.body, Math.max(0.7, t.model.height / 22), p.planet < 0, p.sys);
      t.lostAt = view.renderTick;
    }
    t.lastLost = s.phase === 'lost';
    if (s.phase === 'ascent') t.ignited = true;
    t.phaseSeen = view.renderTick;
  }

  /** the launchpad (or mast, or gate) building nearest the pad point: its yaw and the deck height */
  private findPad(t: Track, pv: PlanetView, dir: D3): void {
    const B = pv.buildings;
    let best = -1, bd = 60 / pv.params.radius;
    if (B) for (let i = 0; i < B.count; i++) {
      const look = buildingAt(B.type[i]);
      if (look.kind !== 'launchpad' && look.id !== 'airship-mast' && look.id !== 'star-gate') continue;
      const d = Math.acos(Math.min(1, B.pos[i * 3] * dir[0] + B.pos[i * 3 + 1] * dir[1] + B.pos[i * 3 + 2] * dir[2]));
      if (d < bd) { bd = d; best = i; }
    }
    t.padDir = [dir[0], dir[1], dir[2]];
    t.padGround = pv.ground ? groundR(pv, dir) : pv.params.radius;
    if (best >= 0 && B) {
      t.padYaw = B.rot[best];
      // pad the rocket on the building's own centre (the sim's pad point is the same cell)
      t.padDir = norm([B.pos[best * 3], B.pos[best * 3 + 1], B.pos[best * 3 + 2]]);
      t.padGround = groundR(pv, t.padDir);
    } else t.padYaw = hashFloat(t.id, 3) * Math.PI * 2;
    const shape = t.model.shape;
    // the launch deck (concrete 0.5 m) and the launch mount under the engines
    t.deck = shape === 'airship' ? 30.5 : shape === 'gate' ? 0 : shape === 'rocket' && eraRank(t.era) < ERA.electric ? 0.3 : best >= 0 ? 0.5 + 2.0 : 1.5;
  }

  /** a frame for a body-frame point: up = radial, fwd = the pad yaw's heading */
  private padFrame(dir: D3, yaw: number, up: Vector3, fwd: Vector3): void {
    const e: D3 = [0, 0, 0], n: D3 = [0, 0, 0];
    tangentBasis(e, n, dir);
    up.set(dir[0], dir[1], dir[2]);
    // building yaw: the kit's +Z turned by rot about local up (north = 0 toward east)
    fwd.set(n[0] * Math.cos(yaw) + e[0] * Math.sin(yaw), n[1] * Math.cos(yaw) + e[1] * Math.sin(yaw), n[2] * Math.cos(yaw) + e[2] * Math.sin(yaw));
  }

  private place(t: Track, s: ShipView, view: WorldView, pose: CameraPose, planets: Map<number, ShipPlanetRef>, time: number, dt: number, primary: number, shadows: boolean): void {
    const tick = view.renderTick;
    const P = t.pose;
    P.phase = s.phase;
    const cls = t.info.cls;
    // (an open-ended phase — an orbiter's orbit — reports no progress: it animates from when it was first seen)
    const open = s.progress === 0 && (s.phase === 'orbit' || s.phase === 'landed' || s.phase === 'stranded') && t.samples.length >= 2 && t.samples.every((q) => q.progress === 0);
    const elapsed = Math.max(0, tick - (open ? t.phaseSeen : t.phaseT0));
    const f = Math.max(0, Math.min(1, elapsed / Math.max(1, open ? 240 : t.phaseLen)));
    const ph = s.phase;
    // form by phase
    const form: 'launch' | 'space' | 'lander' = cls === 'air' || cls === 'sea' || cls === 'gate' ? 'launch'
      : ph === 'descent' || ph === 'landed' ? 'lander'
        : ph === 'orbit' || ph === 'transfer' || ph === 'stranded' ? (t.kind === 'rocket' ? 'launch' : 'space')
          : ph === 'lost' ? (t.form) : 'launch';
    this.setForm(t, form);
    const planet = ph === 'transfer' || ph === 'stranded' || (ph === 'lost' && s.planet < 0) ? -1 : s.planet;
    const ref = planet >= 0 ? planets.get(planet) : undefined;
    const pv = planet >= 0 ? view.planet(planet) : undefined;
    const own = t.own;
    const u2 = own.uShip2.value as Vector4;
    const u1 = own.uShip.value as Vector4;
    u2.x = 0; u2.z = 0; u2.w = 0; u1.y = 0; u1.z = 1e9;
    (own.uClothT as IUniform<number>).value = time % 3600;
    const wind = own.uWind.value as Vector4;
    wind.w = cls === 'sea' ? 1 : 0;
    P.visible = true;
    // ── where (frame of the planet or the system) ──
    const up = _v.set(0, 1, 0), fwd = _v2.set(0, 0, 1);
    const pos = P.body;
    let firing: { stages: number[]; thrust: number; vacuum?: boolean } | null = null;
    let trail = false;
    if (planet >= 0 && pv) {
      const R = pv.params.radius;
      if (ph === 'building' || ph === 'fuelling' || ph === 'boarding' || ph === 'pad') {
        const key = `${planet}|${s.pos[0].toFixed(6)}|${s.pos[1].toFixed(6)}|${s.pos[2].toFixed(6)}|${pv.buildings?.count ?? 0}`;
        if (key !== t.padKey) { t.padKey = key; this.findPad(t, pv, norm([s.pos[0], s.pos[1], s.pos[2]])); }
      }
      const A = t.info.altitude;
      if (ph === 'building' || ph === 'fuelling' || ph === 'boarding' || ph === 'pad' || (ph === 'lost' && s.alt < 1 && t.padDir)) {
        const d = t.padDir!;
        this.padFrame(d, t.padYaw, up, fwd);
        pos.set(d[0], d[1], d[2]).multiplyScalar(t.padGround + t.deck);
        if (cls === 'air') this.moored(t, pv, d, up, fwd, pos, 0);
        if (ph === 'building') u1.z = Math.max(0.2, s.progress) * t.model.height * (t.model.shape === 'airship' ? 2 : 1) - (t.model.shape === 'airship' ? t.model.height * 0.5 : 0);
        if (ph === 'fuelling') u1.y = smooth01(s.progress);
        if (ph === 'boarding' || ph === 'pad') u1.y = 1;
        if (ph === 'pad' && f > 0.86 && cls !== 'air' && cls !== 'gate') firing = { stages: this.firstStages(t), thrust: 0.55 + 0.45 * smooth01((f - 0.86) / 0.14) };
        if (ph === 'pad' && f > 0.86 && !t.ignited && ref && cls !== 'air' && cls !== 'gate') {
          t.ignited = true;
          this.fx.ignite(planet, this.ctx(ref), pos, Math.max(0.6, t.model.baseRadius / 2));
        }
      } else if (ph === 'ascent') {
        if (!t.padDir) this.findPad(t, pv, rotY(s.pos, -ASCENT_ARC * s.progress * s.progress));
        const pathAt = (ff: number, out: Vector3): Vector3 => {
          ff = Math.max(0, Math.min(1, ff));
          if (cls === 'air') { const d = t.padDir!; return out.set(d[0], d[1], d[2]).multiplyScalar(t.padGround + t.deck + A * smooth01(ff)); }
          const dir = rotY(t.padDir!, ASCENT_ARC * ff * ff);
          return out.set(dir[0], dir[1], dir[2]).multiplyScalar(t.padGround + t.deck * (1 - Math.min(1, ff * 8)) + A * Math.pow(ff, 1.4));
        };
        pathAt(f, pos);
        if (cls === 'air') {
          this.padFrame(t.padDir!, t.padYaw, up, fwd);
          this.moored(t, pv, t.padDir!, up, fwd, pos, smooth01(f / 0.35));
        } else {
          // the axis along the velocity (vertical at lift-off, pitching east toward orbit)
          pathAt(Math.min(1, f + 0.01), _v3).sub(pos);
          if (f < 0.002 || _v3.lengthSq() < 1e-8) up.copy(pos).normalize(); else up.copy(_v3).normalize();
          this.padFrame(t.padDir!, t.padYaw, _v3, fwd);
          const nozzleAt = (tk: number, out: Vector3) => {
            const ff = (tk - t.phaseT0) / Math.max(1, t.phaseLen);
            pathAt(ff, out);
            const ax = pathAt(Math.min(1, ff + 0.01), _x).sub(out);
            const axn = ff < 0.002 || ax.lengthSq() < 1e-8 ? _y.copy(out).normalize() : ax.normalize();
            return out.addScaledVector(axn, this.nozzleY(t, ff));
          };
          firing = { stages: this.stagesAt(t, f), thrust: 1 };
          trail = true;
          this.ascentEvents(t, f, pos, up, fwd, planet, ref, tick);
          if (firing.stages.length && ref) this.reportEngines(t, firing, planet, ref, pos, up, fwd, nozzleAt, trail, 'ascent');
          firing = null;
        }
      } else if (ph === 'orbit') {
        // a great circle in the equatorial frame at the sim's rate, about the plane the samples span
        const spinNow = pv.spin;
        const smp = t.samples.filter((q) => q.phase === 'orbit' && q.planet === planet);
        const last = smp[smp.length - 1];
        const lastSpin = last ? spinAt(pv.params, pv.paramsTick, last.tick) : spinNow;
        const e1 = rotY(last ? last.pos : s.pos, lastSpin);
        let axis: D3 = [0, 1, 0];
        if (smp.length >= 2) {
          const a0 = smp[smp.length - 2];
          const e0 = rotY(a0.pos, spinAt(pv.params, pv.paramsTick, a0.tick));
          axis = norm([e0[1] * e1[2] - e0[2] * e1[1], e0[2] * e1[0] - e0[0] * e1[2], e0[0] * e1[1] - e0[1] * e1[0]]);
          if (!Number.isFinite(axis[0]) || Math.hypot(axis[0], axis[1], axis[2]) < 0.5) axis = [0, 1, 0];
        } else {
          // an eastward great circle (the sim's orbitB = east of the start)
          const east: D3 = [e1[2], 0, -e1[0]];
          norm(east);
          axis = norm([e1[1] * east[2] - e1[2] * east[1], e1[2] * east[0] - e1[0] * east[2], e1[0] * east[1] - e1[1] * east[0]]);
        }
        const ang = ((2 * Math.PI) / ORBIT_PERIOD) * (tick - (last ? last.tick : view.snapTick));
        _q.setFromAxisAngle(_v3.set(axis[0], axis[1], axis[2]), ang);
        const eNow = _v3.set(e1[0], e1[1], e1[2]).applyQuaternion(_q);
        const vel = _x.set(axis[0], axis[1], axis[2]).cross(eNow);
        const b = rotY([eNow.x, eNow.y, eNow.z], -spinNow);
        const vb = rotY([vel.x, vel.y, vel.z], -spinNow);
        pos.set(b[0], b[1], b[2]).multiplyScalar(R + A);
        up.set(vb[0], vb[1], vb[2]).normalize();
        fwd.set(b[0], b[1], b[2]);
        // insertion burn / the ark's ring opening / the satellite's wings
        if (f < 0.1 && t.kind === 'rocket') firing = { stages: [1], thrust: 0.8, vacuum: true };
        if (f < 0.06 && t.kind === 'generation-ship') firing = { stages: [0], thrust: 0.7, vacuum: true };
      } else if (ph === 'descent' || ph === 'landed') {
        // straight down onto the landing site (or gliding from where it circled), legs out at the end
        const smp = t.samples.filter((q) => q.phase === ph && q.planet === planet);
        const a1 = smp[smp.length - 1], a0 = smp[smp.length - 2];
        let dir: D3 = norm([s.pos[0], s.pos[1], s.pos[2]]);
        if (ph === 'descent' && a1 && a0 && a1.tick > a0.tick) {
          const k = Math.min(3, (tick - a1.tick) / (a1.tick - a0.tick));
          dir = norm([a1.pos[0] + (a1.pos[0] - a0.pos[0]) * k, a1.pos[1] + (a1.pos[1] - a0.pos[1]) * k, a1.pos[2] + (a1.pos[2] - a0.pos[2]) * k]);
        }
        const g = groundR(pv, dir);
        const alt = ph === 'landed' ? 0 : (cls === 'air' ? A : A) * Math.pow(1 - f, 1.3);
        pos.set(dir[0], dir[1], dir[2]).multiplyScalar(g + (cls === 'air' ? 30 * (1 - smooth01(f)) : 0) + alt + (t.model.shape === 'airship' ? 6 : 0));
        if (!t.padDir || t.padDir[0] !== dir[0]) { /* the landing site has no pad: face along the approach */ }
        this.padFrame(dir, (s.heading || 0), up, fwd);
        if (ph === 'descent' && cls !== 'air') {
          // the descent burn from a third of the way down; thrust grows near the ground
          if (f > 0.3) firing = { stages: [0], thrust: 0.55 + 0.45 * smooth01((f - 0.3) / 0.6) };
          if (f > 0.75 && alt < 60 && ref) {
            const ground = _v3.set(dir[0], dir[1], dir[2]).multiplyScalar(g);
            this.fx.dust(planet, this.ctx(ref), ground, Math.max(0, 1 - alt / 60) * (firing ? firing.thrust : 0), Math.max(0.7, t.model.baseRadius / 3.5));
          }
        }
        if (ph === 'landed') u1.x = 0.8;
      } else if (ph === 'lost') {
        // gone: the explosion was at the moment of failure; on the ground a wreck smoulders for a while
        const dir = norm([s.pos[0], s.pos[1], s.pos[2]]);
        const g = groundR(pv, dir);
        pos.set(dir[0], dir[1], dir[2]).multiplyScalar(Math.max(g, R + s.alt));
        P.visible = false;
        const age = tick - t.lostAt;
        if (ref && s.alt < 1 && age >= 0 && age < 900) this.fx.smolder(planet, this.ctx(ref), _v3.set(dir[0], dir[1], dir[2]).multiplyScalar(g + 0.5), 1 - age / 900, Math.max(0.8, t.model.baseRadius / 2.5));
      } else if (ph === 'transfer' && cls === 'air') {
        // an airship cruising over its own world
        const smp = t.samples.filter((q) => q.phase === ph && q.planet === planet);
        const a1 = smp[smp.length - 1], a0 = smp[smp.length - 2];
        let dir: D3 = norm([s.pos[0], s.pos[1], s.pos[2]]);
        if (a1 && a0 && a1.tick > a0.tick) {
          const k = Math.min(3, (tick - a1.tick) / (a1.tick - a0.tick));
          dir = norm([a1.pos[0] + (a1.pos[0] - a0.pos[0]) * k, a1.pos[1] + (a1.pos[1] - a0.pos[1]) * k, a1.pos[2] + (a1.pos[2] - a0.pos[2]) * k]);
        }
        pos.set(dir[0], dir[1], dir[2]).multiplyScalar(groundR(pv, dir) + 30 + A);
        this.padFrame(dir, s.heading || 0, up, fwd);
      } else if (cls === 'sea') {
        const dir = norm([s.pos[0], s.pos[1], s.pos[2]]);
        const w = pv.fields.get('water');
        let r = groundR(pv, dir);
        if (w) r = Math.max(r, pv.params.radius + pv.params.seaLevel);
        pos.set(dir[0], dir[1], dir[2]).multiplyScalar(r + 0.02 * Math.sin(time * 1.3 + t.id));
        this.padFrame(dir, s.heading || 0, up, fwd);
        // a gentle roll and pitch on the swell
        _q2.setFromAxisAngle(fwd, 0.035 * Math.sin(time * 0.9 + t.id));
        up.applyQuaternion(_q2);
      } else {
        const dir = norm([s.pos[0], s.pos[1], s.pos[2]]);
        pos.set(dir[0], dir[1], dir[2]).multiplyScalar(groundR(pv, dir) + s.alt);
        this.padFrame(dir, s.heading || 0, up, fwd);
      }
      P.planet = planet;
      _v3.copy(pos).applyQuaternion(_q.set(pv.quat[0], pv.quat[1], pv.quat[2], pv.quat[3]));
      P.sys = [pv.center[0] + _v3.x, pv.center[1] + _v3.y, pv.center[2] + _v3.z];
    } else {
      // between the worlds: the system frame, extrapolated along the velocity of the last two samples
      const smp = t.samples;
      const a1 = smp[smp.length - 1], a0 = smp[smp.length - 2];
      let sys: D3 = [s.sysPos[0], s.sysPos[1], s.sysPos[2]];
      let vel: D3 = [0, 0, 0];
      if (a1 && a0 && a1.tick > a0.tick && a0.phase === a1.phase) {
        const k = 1 / (a1.tick - a0.tick);
        vel = [(a1.sys[0] - a0.sys[0]) * k, (a1.sys[1] - a0.sys[1]) * k, (a1.sys[2] - a0.sys[2]) * k];
        const dtk = Math.max(-2, Math.min(3 * (a1.tick - a0.tick), tick - a1.tick));
        sys = [a1.sys[0] + vel[0] * dtk, a1.sys[1] + vel[1] * dtk, a1.sys[2] + vel[2] * dtk];
      } else if (ph === 'transfer') {
        // one sample (paused): the curve's tangent from the reconstructed transfer
        const bz = this.transferCurve(t, s, view);
        if (bz) { const p1 = bezier(bz, Math.min(1, s.progress + 0.002)), p0 = bezier(bz, Math.max(0, s.progress - 0.002)); vel = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]; }
      }
      P.planet = -1;
      P.sys = sys;
      pos.set(sys[0], sys[1], sys[2]);
      const vl = Math.hypot(vel[0], vel[1], vel[2]);
      if (vl > 1e-9) up.set(vel[0] / vl, vel[1] / vl, vel[2] / vl); else up.set(0, 1, 0);
      fwd.set(-sys[0], -sys[1], -sys[2]).normalize();
      if (ph === 'transfer') {
        if (t.kind === 'rocket' || t.kind === 'generation-ship') {
          if (f < 0.05) firing = { stages: [t.kind === 'rocket' ? 1 : 0], thrust: 0.9, vacuum: true };
          if (f > 0.95) { firing = { stages: [t.kind === 'rocket' ? 2 : 0], thrust: 0.8, vacuum: true }; up.negate(); }
        }
      }
      if (ph === 'stranded') {
        // tumbling, dark
        _q.setFromAxisAngle(_v3.set(0.3, 1, 0.2).normalize(), (tick * 0.004 + t.id) % (Math.PI * 2));
        up.applyQuaternion(_q); fwd.applyQuaternion(_q);
        u2.y = 0;
      }
      if (ph === 'lost') P.visible = false;
    }
    if (ph === 'lost') P.visible = false;
    // ── the frame and the parts ──
    P.up.copy(up);
    P.fwd.copy(fwd);
    P.size = t.model.height;
    P.kind = t.kind;
    P.id = t.id;
    basisQ(up, fwd, _q2);
    const root = t.root;
    const space = planet < 0;
    this.bindMaterials(t, space ? -1 : planet, ref ?? null);
    const parent: Object3D = space ? this.spaceGroup : ref ? ref.group : this.spaceGroup;
    if (!space && !ref) { P.visible = false; }
    if (root.parent !== parent) parent.add(root);
    root.visible = P.visible;
    if (space) {
      root.position.set(pos.x - pose.pos[0], pos.y - pose.pos[1], pos.z - pose.pos[2]);
    } else root.position.copy(pos);
    root.quaternion.copy(_q2);
    root.updateMatrixWorld(true);
    // uWorldToBody: world (camera-relative) → the planet's body frame, or → the system frame in space
    const w2b = own.uWorldToBody.value as Matrix4;
    if (space) w2b.makeTranslation(pose.pos[0], pose.pos[1], pose.pos[2]);
    else if (ref) w2b.copy(ref.group.matrixWorld).invert();
    // the parts: separations, fairings, legs, ring, props, wings
    this.animate(t, s, f, tick, time, planet, ref ?? null, pos, up);
    // engines
    if (firing && P.visible) {
      const fr = firing;
      u2.x = fr.thrust;
      const ref2 = planet >= 0 ? ref : undefined;
      this.reportEngines(t, fr, planet, ref2 ?? null, pos, up, fwd, undefined, false, ph);
    } else if (ph === 'ascent') u2.x = 1;
    // vents on the pad
    if (ref && (ph === 'fuelling' || ph === 'boarding' || ph === 'pad') && t.info.cls !== 'air' && t.info.cls !== 'gate' && P.visible) {
      const rate = ph === 'pad' ? 14 + 20 * f : ph === 'boarding' ? 10 : 6 * s.progress;
      for (const h of t.model.stageTops) {
        const r = t.model.baseRadius * 0.9;
        const side = _v3.copy(fwd).cross(up).normalize();
        const vp = _x.copy(pos).addScaledVector(up, h - 1.2).addScaledVector(side, r);
        this.fx.vent(planet, this.ctx(ref), vp, side, rate, 0.7 + r * 0.3);
      }
    }
    // the gate: its horizon
    if (t.model.shape === 'gate') {
      u2.z = ph === 'pad' ? 0.3 + 0.7 * smooth01(f) : ph === 'boarding' ? 0.3 : ph === 'transfer' ? 1 : ph === 'landed' ? Math.max(0, 1 - f * 3) : ph === 'fuelling' ? 0.15 * s.progress : 0;
      P.visible = u2.z > 0.01;
      root.visible = P.visible;
    }
    // night windows lit while crewed
    u2.y = ph === 'stranded' || ph === 'lost' ? 0 : s.crew > 0 ? 1 : 0.3;
    // scorch after the climb, char after coming down
    if (ph === 'orbit' || ph === 'transfer') u1.x = 0.5;
    if (ph === 'landed') u2.w = 0.55;
    if (ph === 'descent') u2.w = 0.55 * smooth01(f * 2);
    // shadows: ships cast on the pad and the town
    const castShadow = shadows && !space;
    for (const n of t.nodes) {
      if (castShadow) n.mesh.layers.enable(1); else n.mesh.layers.disable(1);
      n.mesh.userData.depthMat = n.part.cloth ? t.sailDepth : t.hullDepth;
    }
    if (t.rig) { t.rig.visible = P.visible && (ph === 'fuelling' || ph === 'boarding' || ph === 'pad' || ph === 'building' || (ph === 'ascent' && f < 0.15)); }
    this.padRig(t, s, ref ?? null, ph, f);
    SHIP_POSES.set(t.id, P);
    void dt; void primary;
  }

  private ctx(ref: ShipPlanetRef): LaunchPlanetCtx {
    return { group: ref.group, uniforms: ref.uniforms, camBody: ref.camBody, wind: this.windAt(ref.pv), airTop: ref.airTop, radius: ref.pv.params.radius, hasAir: ref.hasAir };
  }

  /** an airship moored nose-on to its mast head (blend 0) slipping its mooring as it rises (blend → 1) */
  private moored(t: Track, pv: PlanetView, dir: D3, up: Vector3, fwd: Vector3, pos: Vector3, release: number): void {
    // nose into the wind
    const w = this.windAt(pv);
    if (w.lengthSq() > 1e-6) fwd.copy(w).negate().addScaledVector(up, -up.dot(_v3.copy(w).negate())).normalize();
    const L = t.model.height;
    const off = (L / 2 + 0.6) * (1 - release);
    pos.addScaledVector(fwd, -off);
    void dir;
  }

  /** the stages whose engines light first (first stage, and the boosters on a super-heavy) */
  private firstStages(t: Track): number[] {
    const st = new Set<number>();
    for (const e of t.model.engines) if (e.stage === 0 || e.stage <= -2) st.add(e.stage);
    return [...st];
  }

  /** the separations of a climb, as fractions of the ascent */
  private sepAt(t: Track): { stage1: number; boosters: number; tower: number; fairing: number } {
    const shape = t.model.shape;
    if (shape === 'generation-ship') return { stage1: 0.55, boosters: 0.28, tower: 2, fairing: 0.68 };
    if (shape === 'orbiter') return { stage1: 0.45, boosters: 2, tower: 2, fairing: 0.62 };
    if (shape === 'rocket' && eraRank(t.era) < ERA.space) return { stage1: eraRank(t.era) < ERA.electric ? 2 : 0.5, boosters: 2, tower: 2, fairing: 2 };
    return { stage1: 0.42, boosters: 2, tower: 0.5, fairing: 2 };
  }

  /** engines burning at ascent fraction f */
  private stagesAt(t: Track, f: number): number[] {
    const s = this.sepAt(t);
    const out: number[] = [];
    if (f < s.stage1) { out.push(0); if (f < s.boosters) for (const e of t.model.engines) if (e.stage <= -2 && !out.includes(e.stage)) out.push(e.stage); }
    else if (f > s.stage1 + 0.02) out.push(1);
    return out;
  }

  /** the exhaust leaves this far below the ship's origin (local y of the burning stage's nozzle exits) */
  private nozzleY(t: Track, f: number): number {
    const st = this.stagesAt(t, f);
    let y = 0, n = 0;
    for (const e of t.model.engines) if (st.includes(e.stage)) { y += e.pos[1]; n++; }
    return n ? y / n : 0;
  }

  private reportEngines(t: Track, firing: { stages: number[]; thrust: number; vacuum?: boolean }, planet: number, ref: ShipPlanetRef | null, pos: Vector3, up: Vector3, fwd: Vector3, path: ((tick: number, out: Vector3) => Vector3) | undefined, trail: boolean, phase: string): void {
    const groups = new Map<string, { x: number; y: number; z: number; r: number; n: number; vac: boolean; st: number }>();
    for (const e of t.model.engines) {
      if (!firing.stages.includes(e.stage)) continue;
      const key = e.stage <= -2 ? 'b' : String(e.stage);
      let g = groups.get(key);
      if (!g) { g = { x: 0, y: 0, z: 0, r: e.radius, n: 0, vac: e.vacuum || !!firing.vacuum, st: e.stage }; groups.set(key, g); }
      g.x += e.pos[0]; g.y += e.pos[1]; g.z += e.pos[2]; g.n++;
    }
    basisQ(up, fwd, _q);
    const alt = ref ? pos.length() - ref.pv.params.radius : 1e9;
    for (const [key, g] of groups) {
      const local = _v3.set(g.x / g.n, g.y / g.n, g.z / g.n);
      // boosters: a ring of plumes around the core; drawn as one wide cluster
      const world = local.applyQuaternion(_q).add(pos);
      const dir = _x.copy(up).negate();
      const space = planet < 0;
      const since = phase === 'ascent' ? (g.st === 1 ? t.phaseT0 + this.sepAt(t).stage1 * t.phaseLen : t.phaseT0 - 0.14 * PAD_TICKS) : undefined;
      this.fx.engine({
        key: `${t.id}:${key}`, planet: space ? -1 : planet, pos: world.clone(), dir: dir.clone(), radius: g.r, count: g.n, thrust: firing.thrust,
        vacuum: g.vac, fuel: propellant(t.model, g.st), alt: space ? 1e9 : alt, trail: trail && key !== 'b' ? true : trail,
        path: path ? (tk: number, out: Vector3) => { path(tk, out); return; } : undefined, since,
      });
    }
    void phase;
  }

  /** separations at their moments (spawned as detached parts flying their own analytic arcs) */
  private ascentEvents(t: Track, f: number, pos: Vector3, up: Vector3, fwd: Vector3, planet: number, ref: ShipPlanetRef | undefined, tick: number): void {
    const s = this.sepAt(t);
    const detach = (name: (n: PartNode) => boolean, at: number, kick: number, spin: number) => {
      for (const n of t.nodes) {
        if (!name(n) || n.detached) continue;
        const sepTick = t.phaseT0 + at * t.phaseLen;
        // the ship's state at separation (analytic): position, axis, velocity
        const ff = at;
        const dirA = rotY(t.padDir!, ASCENT_ARC * ff * ff);
        const A = t.info.altitude;
        const p = new Vector3(dirA[0], dirA[1], dirA[2]).multiplyScalar(t.padGround + A * Math.pow(ff, 1.4));
        const dirB = rotY(t.padDir!, ASCENT_ARC * (ff + 0.01) * (ff + 0.01));
        const p2 = new Vector3(dirB[0], dirB[1], dirB[2]).multiplyScalar(t.padGround + A * Math.pow(ff + 0.01, 1.4));
        const v = p2.clone().sub(p).multiplyScalar(1 / (0.01 * t.phaseLen));
        const ax = v.clone().normalize();
        const q = basisQ(ax, fwd, new Quaternion());
        // the part's own offset from the ship origin (its pivot), outward kick sideways
        const off = new Vector3(n.part.pivot[0], n.part.pivot[1], n.part.pivot[2]).applyQuaternion(q);
        const side = new Vector3(n.part.pivot[0], 0, n.part.pivot[2]);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize().applyQuaternion(q);
        n.detached = {
          t0: sepTick, p: p.add(off), v: v.multiplyScalar(0.92).addScaledVector(side, kick), q,
          axis: new Vector3(n.part.axis[0], n.part.axis[1], n.part.axis[2]).applyQuaternion(q).normalize(), spin, up: p.clone().normalize(),
        };
        if (ref) { if (n.pivot.parent !== ref.group) ref.group.add(n.pivot); }
      }
    };
    if (f >= s.boosters) detach((n) => n.part.role === 'booster', s.boosters, 2.5, 0.02);
    if (f >= s.stage1) detach((n) => n.part.role === 'stage' && n.part.stage === 0, s.stage1, 0.3, 0.012);
    if (f >= s.tower) detach((n) => n.part.role === 'tower', s.tower, 3, 0.08);
    if (f >= s.fairing) detach((n) => n.part.role === 'fairing', s.fairing, 4, 0.03);
    void pos; void up; void planet; void tick;
  }

  /** per-frame part motion */
  private animate(t: Track, s: ShipView, f: number, tick: number, time: number, planet: number, ref: ShipPlanetRef | null, pos: Vector3, up: Vector3): void {
    const ph = s.phase;
    const inFlightOrLater = ph === 'orbit' || ph === 'transfer' || ph === 'stranded' || ph === 'descent' || ph === 'landed' || ph === 'lost';
    for (const n of t.nodes) {
      const role = n.part.role;
      n.mesh.visible = true;
      // parts already gone in this form
      if (t.form === 'launch' && inFlightOrLater && (role === 'stage' && n.part.stage === 0 || role === 'booster' || role === 'tower' || role === 'fairing')) { n.mesh.visible = false; n.detached = null; if (n.pivot.parent !== t.root) t.root.add(n.pivot); continue; }
      if (t.form === 'launch' && ph === 'transfer' && t.kind === 'rocket' && role === 'stage' && n.part.stage === 1 && f > 0.06) { n.mesh.visible = false; continue; }
      if (n.detached && ph === 'ascent') {
        // a separated part: its own ballistic arc in the body frame, tumbling
        const d = n.detached;
        const tau = Math.max(0, tick - d.t0);
        const g = 1.6; // m per tick² (art-directed: stages fall away visibly within seconds at 1×)
        const p = _v3.copy(d.p).addScaledVector(d.v, tau).addScaledVector(d.up, -0.5 * g * tau * tau);
        n.pivot.position.copy(p);
        _q.setFromAxisAngle(d.axis, Math.min(2.4, d.spin * tau * tau * 0.5 + d.spin * tau * 6));
        n.pivot.quaternion.copy(_q).multiply(d.q);
        n.mesh.visible = tau < 60;
        // the separated stage's dying engines glow for a moment; a puff of separation
        continue;
      }
      if (!n.detached && n.pivot.parent !== t.root) t.root.add(n.pivot);
      if (!n.detached) n.pivot.position.set(n.part.pivot[0], n.part.pivot[1], n.part.pivot[2]);
      let ang = 0;
      if (role === 'leg') {
        // stowed against the hull until the last third of the descent
        const stowed = t.model.shape === 'ark-lander' ? 2.44 : 2.6;
        ang = ph === 'descent' ? stowed * (1 - smooth01((f - 0.55) / 0.25)) : ph === 'landed' ? 0 : stowed;
      } else if (role === 'ring') {
        // the habitat ring turns (a slow, steady spin for gravity); folded small until it opens in orbit
        n.pivot.quaternion.setFromAxisAngle(_v3.set(0, 1, 0), (time * 0.18) % (Math.PI * 2));
        const open = ph === 'orbit' ? smooth01((f - 0.05) / 0.25) : ph === 'transfer' || ph === 'stranded' ? 1 : 0.2;
        n.pivot.scale.set(0.2 + 0.8 * open, 1, 0.2 + 0.8 * open);
        continue;
      } else if (role === 'prop') {
        const spinning = ph === 'transfer' || ph === 'ascent' || ph === 'descent' ? 1 : ph === 'pad' ? 0.25 : 0;
        n.pivot.quaternion.setFromAxisAngle(_v3.set(n.part.axis[0], n.part.axis[1], n.part.axis[2]), (time * 22 * spinning + n.part.pivot[0]) % (Math.PI * 2));
        continue;
      } else if (role === 'wing') {
        ang = ph === 'orbit' ? (Math.PI / 2) * (1 - smooth01((f - 0.03) / 0.12)) : t.form === 'space' ? 0 : Math.PI / 2;
      }
      n.pivot.quaternion.setFromAxisAngle(_v3.set(n.part.axis[0], n.part.axis[1], n.part.axis[2]), ang);
      n.pivot.scale.set(1, 1, 1);
    }
    // the rising ark's ring and the orbiter's payload are inside the fairing on the pad
    void planet; void ref; void pos; void up;
  }

  /** umbilical hoses from the gantry arms and the launch mount, while the ship stands on its pad */
  private padRig(t: Track, s: ShipView, ref: ShipPlanetRef | null, ph: string, f: number): void {
    const want = !!ref && !!t.padDir && t.model.umbilicals.length > 0 && (ph === 'building' || ph === 'fuelling' || ph === 'boarding' || ph === 'pad' || (ph === 'ascent' && f < 0.15));
    if (!want) { if (t.rig) t.rig.visible = false; return; }
    const released = ph === 'ascent' || (ph === 'pad' && f > 0.9);
    const key = released ? 'r' : 'h';
    if (!t.rig || t.rig.userData.key !== key || t.rig.parent !== ref!.group) {
      if (t.rig) { t.rig.parent?.remove(t.rig); for (const c of t.rig.children) (c as Mesh).geometry?.dispose(); }
      t.rig = buildPadRig(t.model, released);
      t.rig.userData.key = key;
      ref!.group.add(t.rig);
    }
    const rig = t.rig;
    for (const c of rig.children) { const m = c as Mesh; m.material = t.hullMat!; m.frustumCulled = false; }
    const d = t.padDir!;
    this.padFrame(d, t.padYaw, _v, _v2);
    basisQ(_v, _v2, _q);
    rig.position.set(d[0], d[1], d[2]).multiplyScalar(t.padGround + t.deck);
    rig.quaternion.copy(_q);
    rig.visible = true;
    void s;
  }

  // ── the system view: glints, trails, labels ──

  /** reconstruct the sim's transfer curve (transit.ts planTransfer): P0 at the world left, P3 at the target's
   * predicted place, P1 / P2 along each world's motion, the per-ship bow */
  private transferCurve(t: Track, s: ShipView, view: WorldView): D3[] | null {
    const from = view.planet(s.from), to = view.planet(s.to);
    if (!from || !to) return null;
    const T = t.phaseLen > 1 ? t.phaseLen : this.estimateTransfer(t, s, view);
    const t0 = view.snapTick - s.progress * T, t1 = t0 + T;
    const p0 = centerAt(view, from, t0, [0, 0, 0]);
    const p3 = centerAt(view, to, t1, [0, 0, 0]);
    const v0 = velAt(view, from, t0), v1 = velAt(view, to, t1);
    const k = T / 3;
    const bow = (hashFloat(s.id, 0xb0e) - 0.5) * 0.06 * Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
    return [p0, [p0[0] + v0[0] * k, p0[1] + v0[1] * k + bow, p0[2] + v0[2] * k], [p3[0] - v1[0] * k, p3[1] - v1[1] * k + bow, p3[2] - v1[2] * k], p3];
  }

  private updateOverlay(view: WorldView, pose: CameraPose): void {
    const vis = this.overlayVis;
    this.overlay.visible = vis > 0.01;
    let n = 0;
    this.glintIds.length = 0;
    for (const t of this.tracks.values()) {
      const s = t.view;
      const P = t.pose;
      // glints for every ship off the ground
      const flying = s.phase === 'ascent' || s.phase === 'orbit' || s.phase === 'transfer' || s.phase === 'descent' || s.phase === 'stranded';
      if (vis > 0.01 && n < 64 && (flying || s.phase === 'lost')) {
        this.glintPos[n * 3] = P.sys[0] - pose.pos[0]; this.glintPos[n * 3 + 1] = P.sys[1] - pose.pos[1]; this.glintPos[n * 3 + 2] = P.sys[2] - pose.pos[2];
        const c = s.phase === 'stranded' || s.phase === 'lost' ? [3, 0.5, 0.35] : s.phase === 'transfer' ? [3.2, 2.2, 0.8] : [1.2, 2.6, 3.2];
        this.glintCol[n * 3] = c[0]; this.glintCol[n * 3 + 1] = c[1]; this.glintCol[n * 3 + 2] = c[2];
        this.glintIds.push(t.id);
        n++;
      }
      // the transfer's path: flown (bright) and ahead (dim)
      const showTrail = vis > 0.01 && s.phase === 'transfer' && t.info.cls !== 'air';
      if (!showTrail) { if (t.trail) t.trail.visible = false; if (t.trailAhead) t.trailAhead.visible = false; continue; }
      const bz = this.transferCurve(t, s, view);
      if (!bz) continue;
      const key = `${bz[0][0].toFixed(0)}|${bz[3][0].toFixed(0)}|${Math.round(s.progress * 400)}`;
      if (!t.trail || t.trailKey !== key) {
        t.trailKey = key;
        const p = Math.max(0.001, Math.min(0.999, s.progress));
        // the curve through the ship's true place: an offset that grows from 0 at departure to the miss at the ship
        const bp = bezier(bz, p);
        const miss: D3 = [P.sys[0] - bp[0], P.sys[1] - bp[1], P.sys[2] - bp[2]];
        const anchor = bz[0];
        const done: number[] = [], ahead: number[] = [];
        const N = 96;
        for (let i = 0; i <= N; i++) {
          const g = (i / N) * p;
          const q = bezier(bz, g);
          const w = g / p;
          done.push(q[0] + miss[0] * w - anchor[0], q[1] + miss[1] * w - anchor[1], q[2] + miss[2] * w - anchor[2]);
        }
        for (let i = 0; i <= N; i++) {
          const g = p + ((1 - p) * i) / N;
          const q = bezier(bz, g);
          const w = 1 - (g - p) / Math.max(1e-6, 1 - p);
          ahead.push(q[0] + miss[0] * w - anchor[0], q[1] + miss[1] * w - anchor[1], q[2] + miss[2] * w - anchor[2]);
        }
        for (const [which, pts] of [['trail', done], ['ahead', ahead]] as const) {
          let line = which === 'trail' ? t.trail : t.trailAhead;
          if (!line) {
            const m = new LineMaterial({ color: 0xffffff, linewidth: which === 'trail' ? 2.2 : 1.2, transparent: true, opacity: 1, depthWrite: false, worldUnits: false, dashed: which === 'ahead', dashSize: 3e4, gapSize: 2.4e4 });
            m.resolution.copy(this.resolution);
            line = new Line2(new LineGeometry(), m);
            line.frustumCulled = false;
            line.renderOrder = 6;
            this.overlay.add(line);
            if (which === 'trail') t.trail = line; else t.trailAhead = line;
          }
          const geo = new LineGeometry();
          geo.setPositions(pts);
          line.geometry.dispose();
          line.geometry = geo;
          if (which === 'ahead') line.computeLineDistances();
          line.userData.anchor = anchor;
        }
      }
      for (const line of [t.trail, t.trailAhead]) {
        if (!line) continue;
        const a = line.userData.anchor as D3;
        line.position.set(a[0] - pose.pos[0], a[1] - pose.pos[1], a[2] - pose.pos[2]);
        line.visible = true;
        const m = line.material as LineMaterial;
        const bright = line === t.trail;
        m.color.setRGB(bright ? 3.4 : 1.6, bright ? 2.3 : 1.2, bright ? 0.9 : 0.55);
        m.opacity = vis * (bright ? 0.95 : 0.55);
      }
    }
    const geo = this.glints.geometry;
    geo.setDrawRange(0, n);
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('aColor').needsUpdate = true;
    this.glintMat.uniforms.uOpacity.value = vis;
  }

  /** the ship drawn nearest a screen point (system view clicks), given a projector to CSS pixels */
  pickScreen(x: number, y: number, project: (sys: D3) => [number, number] | null, radius = 22): number | null {
    let best: number | null = null, bd = radius;
    for (const t of this.tracks.values()) {
      if (!t.pose.visible && t.view.phase !== 'transfer') continue;
      const p = project(t.pose.sys);
      if (!p) continue;
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bd) { bd = d; best = t.id; }
    }
    return best;
  }

  /** the shadow pass: casters to their depth materials and back */
  swapDepth(depth: boolean): void {
    for (const t of this.tracks.values()) {
      for (const n of t.nodes) {
        if (depth) { n.mesh.userData.colorMat = n.mesh.material; n.mesh.material = n.mesh.userData.depthMat ?? t.hullDepth; }
        else if (n.mesh.userData.colorMat) n.mesh.material = n.mesh.userData.colorMat;
      }
    }
  }

  private disposeTrack(t: Track): void {
    t.root.parent?.remove(t.root);
    for (const n of t.nodes) n.pivot.parent?.remove(n.pivot);
    t.hullMat?.dispose(); t.sailMat?.dispose(); t.hullDepth.dispose(); t.sailDepth.dispose();
    if (t.rig) { t.rig.parent?.remove(t.rig); for (const c of t.rig.children) (c as Mesh).geometry?.dispose(); }
    for (const l of [t.trail, t.trailAhead]) if (l) { l.parent?.remove(l); l.geometry.dispose(); (l.material as LineMaterial).dispose(); }
  }

  /** ships the layer draws (tests, the HUD) */
  list(): { id: number; kind: string; phase: string; planet: number; visible: boolean; form: string; parts: number }[] {
    return [...this.tracks.values()].map((t) => ({ id: t.id, kind: t.kind, phase: t.view.phase, planet: t.pose.planet, visible: t.pose.visible, form: t.form, parts: t.nodes.length }));
  }

  dispose(): void {
    for (const t of this.tracks.values()) this.disposeTrack(t);
    this.tracks.clear();
    this.fx.dispose();
    this.glints.geometry.dispose();
    this.glintMat.dispose();
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function groundR(pv: PlanetView, dir: ArrayLike<number>): number {
  try {
    const g = pv.ground;
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const x = dir[0] / l, y = dir[1] / l, z = dir[2] / l;
    // lazily import-free: WorldView.groundRadius is groundHeight(pv.ground, ...)
    return groundHeightOf(g, x, y, z);
  } catch { return pv.params.radius; }
}

function centerAt(view: WorldView, pv: PlanetView, tick: number, out: D3): D3 {
  orbitOffset(pv.params.orbit, tick, out);
  const par = pv.params.orbit.parent;
  if (par >= 0) {
    const pp = view.planet(par);
    if (pp) { const o = centerAt(view, pp, tick, [0, 0, 0]); out[0] += o[0]; out[1] += o[1]; out[2] += o[2]; }
  }
  return out;
}

function velAt(view: WorldView, pv: PlanetView, tick: number): D3 {
  const a = centerAt(view, pv, tick - 30, [0, 0, 0]), b = centerAt(view, pv, tick + 30, [0, 0, 0]);
  return [(b[0] - a[0]) / 60, (b[1] - a[1]) / 60, (b[2] - a[2]) / 60];
}

function bezier(P: D3[], f: number): D3 {
  const g = 1 - f;
  const a = g * g * g, b = 3 * g * g * f, c = 3 * g * f * f, d = f * f * f;
  return [a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1], a * P[0][2] + b * P[1][2] + c * P[2][2] + d * P[3][2]];
}

/**
 * The pad rig of a launcher: umbilical hoses draped from the gantry's service arms (render/gen/buildinggen.ts
 * launchpad: the tower at local x = −6.5, arms at 12, 22 and 30 m reaching to x = −1.4) to the rocket's skin, and a
 * launch mount — a ring pedestal with four hold-down arms over the flame trench. Released hoses hang from the arms.
 * Local frame: the pad's (y = 0 the top of the mount, where the rocket's base stands).
 */
function buildPadRig(model: ShipModel, released: boolean): Group {
  const g = new Group();
  const k = new KitBuilder();
  const hose: [number, number, number] = [0.06, 0.055, 0.05];
  const deckY = -2.0;
  for (const u of model.umbilicals) {
    const y = u.y - 2.5;
    const armX = -2.4;
    if (released) {
      k.tube([[armX, y, 0.2], [armX - 0.1, y - 3, 0.25], [armX - 0.15, y - 5.5, 0.3]], [hose[0], hose[1], hose[2]], 6, SS.rubber, SPART.hull, [0.03, 0.03, 0.03], {});
      continue;
    }
    // a catenary from the arm tip to the skin (two hoses)
    for (const dz of [-0.25, 0.25]) {
      const a: [number, number, number] = [armX, y, dz], b: [number, number, number] = [-u.r, y - 1.2, dz * 0.6];
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * 0.9, a[2] + (b[2] - a[2]) * t]);
      }
      k.tube(pts, new Array(7).fill(hose[0]), 6, SS.rubber, SPART.hull, [0.035, 0.035, 0.035], {});
    }
    // the swing arm's plate at the skin
    k.box(-u.r - 0.35, y - 1.6, -0.5, -u.r + 0.05, y - 0.7, 0.5, SS.metal, SPART.hull, [0.4, 0.4, 0.42], {});
  }
  // launch mount: a ring on four legs over the trench, four hold-down clamps
  const r = model.baseRadius + 0.5;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    k.box(x - 0.45, deckY, z - 0.45, x + 0.45, 0.0, z + 0.45, SS.metal, SPART.hull, [0.32, 0.31, 0.3], { skip: ['bottom'] });
    if (!released) k.beam([x, 0.0, z], [Math.cos(a) * (model.baseRadius - 0.1), 0.6, Math.sin(a) * (model.baseRadius - 0.1)], 0.3, 0.3, SS.metal, SPART.hull, [0.4, 0.38, 0.35], 0.9);
  }
  const ring: [number, number, number][] = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; ring.push([Math.cos(a) * r, -0.2, Math.sin(a) * r]); }
  k.tube(ring, new Array(25).fill(0.32), 6, SS.metal, SPART.hull, [0.3, 0.29, 0.28], {});
  const m = new Mesh(k.build());
  m.frustumCulled = false;
  g.add(m);
  return g;
}

export type { Vector3 };
