// GENESIS — the forest floor and meadow layers of the terrain material (CONTRACT.md §15.4), hooked into
// terrainmat.ts (which keeps its own layers): what the ground looks like UNDER the instanced trees, and how open
// grassland varies at 1–50 m.
//
// Forest floor (inside the instanced-tree range, weighted by tree cover), driven by the cells' tree species kind
// (needle-leaf / broadleaf / dry tropical, from plants.json forms via a per-species lookup in the vertex shader),
// moisture, concavity and season:
//   * litter at the leaf scale (~8–12 cm): four overlapping layers of broad ovate leaves (every leaf of the 2×2×2
//     neighbouring cells is tested, so leaves overlap instead of being clipped into Voronoi pills; ~85 % cover, ~93 % in
//     autumn; each lower layer ~10 % darker; edges anti-aliased by the pixel footprint) in ochres, browns, red-browns,
//     decayed dark (autumn adds fresh yellows and oranges; winter greys them), or needle duff (rust / orange-brown
//     streaks in random mats);
//   * twigs and bark flakes (~0.7 m cells), stones half-buried in the litter (~1.8 m cells, sparse), exposed roots
//     (meandering ridges in patches);
//   * moss cushions where it is wet, shaded and in hollows (rich greens, also over stones and roots);
//   * macro colour variation at 1 m, 2–6 m and 15–50 m (fresher vs decomposed litter, humus, moss, leaf drifts) in
//     value more than hue (±25 %);
//   * a height field (metres) for the bump normal, roughness by component, and canopy SKY occlusion (ambient only:
//     sun flecks through the crowns stay as bright as the shadow maps make them).
// Every detail term fades to its mean by the pixel footprint, so the floor reads the same at 3 m and at 30 m.
// Where the floor applies is driven by the instanced canopy's real shade (ff_canopy: five single taps of the cascaded
// sun shadow over ~4.4 m around the point, gated by tree presence and a sun well above the horizon), not only by the
// per-cell tree field — trees standing on a cell of low tree cover still get litter and canopy sky occlusion.
// Sand (sandDetail): wind ripples at ~0.6 m and ~0.13 m and wind streaks in the bump, independent of the sand's depth,
// and sun glints.
//
// Meadow: broad dry / lush sward patches at 10–50 m (domain-warped, soft), and wildflowers in spring and summer —
// coloured flecks in patches that average into a soft tint where they are too small to resolve.

import { BASE_PACK } from '../../data/index.ts';
import type { IUniform } from 'three';

/** floor kind per plants.json form: 0 broadleaf litter, 1 needle duff, 2 dry tropical litter, 3 not a tree */
function floorKind(form: string, type: string): number {
  if (/conifer|spruce|pine|fir|larch|cedar/.test(form)) return 1;
  if (/palm|acacia|baobab|cactus/.test(form)) return 2;
  if (type === 'tree' || /broadleaf|birch|willow|mangrove|kapok|oak|beech/.test(form)) return 0;
  return 3;
}

const KINDS = new Float32Array(64).fill(3);
(BASE_PACK.plants ?? []).forEach((p, i) => { if (i < 64) KINDS[i] = floorKind(String(p.form ?? ''), String(p.type ?? '')); });

/** uniforms the terrain material adds for these layers (module-wide: plants.json is the same for every planet) */
export const GROUND_UNIFORMS: Record<string, IUniform> = { uSpeciesKind: { value: KINDS } };

export const GROUND_VERT_PARS = /* glsl */ `
uniform float uSpeciesKind[64];
varying vec2 vFloorK;   // x = needle-leaf share of the trees here, y = dry tropical share
vec2 ff_kindOf(float sp) {
  int i = int(sp + 0.5);
  if (i < 0 || i >= 64) return vec2(0.0);
  float k = uSpeciesKind[i];
  return vec2(abs(k - 1.0) < 0.5 ? 1.0 : 0.0, abs(k - 2.0) < 0.5 ? 1.0 : 0.0);
}
`;

/** vertex main: per-cell species kind interpolated like every other field (needs uFieldS, aCells, aMisc, tfUV) */
export const GROUND_VERT_MAIN = /* glsl */ `
  {
    float fkB = aCells.w, fkC = aMisc.x, fkA = 1.0 - fkB - fkC;
    vFloorK = ff_kindOf(texelFetch(uFieldS, tfUV(aCells.x), 0).x) * fkA + ff_kindOf(texelFetch(uFieldS, tfUV(aCells.y), 0).x) * fkB
      + ff_kindOf(texelFetch(uFieldS, tfUV(aCells.z), 0).x) * fkC;
  }
`;

export const GROUND_FRAG_PARS = /* glsl */ `
varying vec2 vFloorK;
// moonlight (terrainmat FRAG_LIGHT; values per planet from the renderer)
uniform vec3 uMoonE;
uniform vec3 uMoonDirBody;
uniform vec3 uMoonDirView;

// fade a pattern before fewer than ~6 pixels resolve it (same rule as the terrain's aaF)
float ff_aa(float fw, float feature) { return 1.0 - smoothstep(0.12, 0.45, fw / feature); }

// 2×2×2 cellular noise: the nearest feature point (jittered inside [0.15, 0.85] of its cell) and its id. Exact for any
// mask of radius < 0.5 cell around its point, which is all the scatter below needs.
void ff_cells(vec3 p, out vec3 fp, out float f1, out float id) {
  vec3 b = floor(p - 0.5);
  f1 = 9.0; fp = b; id = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 c = b + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 q = c + 0.15 + 0.7 * gn_hash33(c);
    vec3 r = q - p;
    float d = dot(r, r);
    if (d < f1) { f1 = d; fp = q; id = gn_hash13(c + 0.37); }
  }
  f1 = sqrt(f1);
}

// tangent frame of the ground at up
void ff_frame(vec3 up, out vec3 t1, out vec3 t2) {
  t1 = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  t2 = cross(up, t1);
}

// one layer of broad ovate leaves: every feature point of the 2×2×2 neighbouring cells carries a leaf, and the
// topmost leaf covering P wins (leaves overlap instead of being clipped at cell borders). size: leaf scale (autumn
// litter is fuller). x = coverage (0..1, edge anti-aliased by the footprint), y = leaf id, z = along-blade (-1..1),
// w = midrib
vec4 ff_leaves(vec3 P, vec3 up, vec3 t1, vec3 t2, float scale, vec3 seed, float fw, float size) {
  vec3 p = P * scale + seed;
  vec3 b = floor(p - 0.5);
  vec4 best = vec4(0.0);
  float bestZ = -1.0;
  float aw = max(0.02, fw * scale * 0.8);
  for (int k = 0; k < 8; k++) {
    vec3 c = b + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 h = gn_hash33(c + seed * 0.13);
    vec3 r = p - (c + 0.15 + 0.7 * h);
    r -= up * dot(r, up);
    float id = gn_hash13(c + 0.37 + seed * 0.07);
    float a = id * 6.2831853;
    vec2 q = vec2(dot(r, t1), dot(r, t2));
    q = vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y);
    float len = (0.4 + 0.12 * fract(id * 7.13)) * size;
    float u = q.x / len;
    if (abs(u) > 1.2) continue;
    // ovate blade, widest toward the stalk end, width ~0.55 of its length
    float halfW = 0.29 * len * sqrt(max(0.0, 1.0 - u * u)) * (1.0 + 0.25 * u);
    float e = max(abs(q.y) - halfW, (abs(u) - 1.0) * len);
    float m = 1.0 - smoothstep(-aw, aw, e);
    float z = fract(id * 13.7);
    if (m > 0.0 && z > bestZ) {
      bestZ = z;
      float rib = (1.0 - smoothstep(0.0, max(0.012, aw), abs(q.y))) * m;
      best = vec4(m, id, u, rib);
    }
  }
  return best;
}

// leaf colour by id and season (broadleaf litter)
vec3 ff_leafCol(float id, float autumn, float winter) {
  vec3 c = id < 0.22 ? vec3(0.24, 0.14, 0.05)      // ochre
         : id < 0.45 ? vec3(0.12, 0.066, 0.03)     // brown
         : id < 0.62 ? vec3(0.16, 0.058, 0.026)    // red-brown
         : id < 0.82 ? vec3(0.06, 0.04, 0.024)     // decayed
         : vec3(0.21, 0.17, 0.1);                  // pale, sun-bleached
  // fresh fall: yellows, oranges, crimson on top of the old litter
  float fresh = autumn * step(0.45, fract(id * 3.71));
  vec3 freshC = fract(id * 5.3) < 0.4 ? vec3(0.45, 0.3, 0.03) : fract(id * 5.3) < 0.75 ? vec3(0.42, 0.14, 0.02) : vec3(0.3, 0.035, 0.02);
  c = mix(c, freshC, fresh);
  // winter: rain-darkened, greyed
  c = mix(c, c * vec3(0.72, 0.72, 0.78) + 0.01, winter * 0.6);
  return c;
}
// the mean of ff_leafCol over ids (what the litter averages to where single leaves are unresolved)
vec3 ff_leafMean(float autumn, float winter) {
  vec3 c = vec3(0.24, 0.14, 0.05) * 0.22 + vec3(0.12, 0.066, 0.03) * 0.23 + vec3(0.16, 0.058, 0.026) * 0.17
         + vec3(0.06, 0.04, 0.024) * 0.2 + vec3(0.21, 0.17, 0.1) * 0.18;
  vec3 freshC = vec3(0.45, 0.3, 0.03) * 0.4 + vec3(0.42, 0.14, 0.02) * 0.35 + vec3(0.3, 0.035, 0.02) * 0.25;
  c = mix(c, freshC, autumn * 0.55);
  return mix(c, c * vec3(0.72, 0.72, 0.78) + 0.01, winter * 0.6);
}

struct FFloor { vec3 col; float bump; float rough; float ao; float sky; float mk; };

FFloor forestFloor(vec3 P, vec3 up, float fw, float cover, float shrub, float moist, float autumn, float winter,
                   float concave, float m1, float m2, vec3 warpV, vec3 rockCol) {
  FFloor f;
  float needle = clamp(vFloorK.x, 0.0, 1.0);
  float tropic = clamp(vFloorK.y, 0.0, 1.0) * (1.0 - needle);
  vec3 t1, t2;
  ff_frame(up, t1, t2);
  // ── macro: fresher vs decomposed litter, humus, at 15–50 m and 2–6 m (value more than hue) ──
  float macA = fbm3(P * 0.035 + warpV * 0.5 + 4.2);
  float macB = snoise(P * 0.27 + warpV * 0.8 + 9.1);
  float decomp = clamp(0.5 + 0.45 * macA + 0.3 * macB, 0.0, 1.0);
  // ── moss: wet, shaded, hollows; cushions at ~0.5 m ──
  float mossN = snoise(P * 0.55 + warpV * 1.3 + 2.0) * 0.6 + snoise(P * 1.9 + 5.0) * 0.25 * ff_aa(fw, 0.5);
  // (patches, not a carpet: even a wet wood is mostly litter, moss in the hollows and on stones and logs)
  float mossW = smoothstep(0.58, 0.84, 0.5 * moist + 0.36 * (0.5 + 0.5 * mossN) + 0.25 * clamp(concave, 0.0, 1.0) + 0.1 * macA + 0.06 * cover - 0.1 * tropic);
  // ── base litter colour (resolved mean), by kind ──
  vec3 broad = ff_leafMean(autumn, winter);
  vec3 duff = mix(vec3(0.14, 0.06, 0.026), vec3(0.21, 0.1, 0.042), 0.5 + 0.5 * macB);   // rust / orange-brown
  vec3 dryT = vec3(0.2, 0.14, 0.08);                                                      // bleached tropical litter
  vec3 litMean = mix(mix(broad, duff, needle), dryT, tropic);
  vec3 humus = vec3(0.04, 0.028, 0.018);
  // decomposed patches darken toward humus; fresh mats are lighter
  // (the resolved mean of the layered litter below: leaves over leaves, each lower layer darker, humus in the gaps —
  // a single leaf's albedo read as orange-brown sand from 8 m out)
  vec3 litFar = mix(litMean * 0.8, humus, 0.12);
  vec3 col = mix(litFar * 1.1, mix(litFar, humus, 0.55), decomp);
  col *= 0.9 + 0.12 * m1;
  // ── mid-scale mosaic that still reads at 30 m: dry leaf drifts (~1.3 m), wet dark humus, and ~35 cm clusters of
  // litter, each with its own tint (a drift of yellow beech, a mat of red oak, a dark rotten patch) ──
  float drift = smoothstep(0.1, 0.7, snoise(P * 0.75 + warpV * 0.9 + 13.0)) * (1.0 - decomp * 0.5);
  float wetDark = smoothstep(0.35, 0.85, snoise(P * 1.3 + 27.0) * 0.6 + macB * 0.45 + (moist - 0.5) * 0.4);
  vec3 cfp; float cf1, cid;
  ff_cells(P * 2.8, cfp, cf1, cid);
  vec3 clusterC = mix(ff_leafCol(cid, autumn, winter), duff * (0.75 + 0.5 * cid), needle);
  clusterC = mix(clusterC, dryT * (0.8 + 0.4 * cid), tropic);
  // soft round mats around each cell's point (Voronoi polygons with hard borders read as a patchwork)
  float aCl = ff_aa(fw, 0.35) * (1.0 - smoothstep(0.18, 0.47, cf1 + 0.08 * snoise(P * 6.0 + 1.7)));
  col = mix(col, mix(col, clusterC, 0.6), aCl);
  col = mix(col, mix(litMean, ff_leafCol(0.1, autumn, winter), 0.5) * 1.15, drift * 0.45);
  col = mix(col, humus * 1.1, wetDark * 0.6);
  // value mosaic at ~1 m and ~3 m (mats and drifts lighter, trodden / rotting patches darker): ±25 % — the floor
  // between 8 and 40 m no longer reads as one smooth sheet
  float mosaic = snoise(P * 0.95 + warpV * 0.6 + 61.0) * 0.6 + snoise(P * 0.33 + 77.0) * 0.4;
  col *= 0.72 + 0.58 * smoothstep(-0.7, 0.7, mosaic) * mix(0.6, 1.0, ff_aa(fw, 0.6));
  // and at 6–15 m: dark damp humus hollows against drifts of fresh, lighter litter (what still separates the floor
  // into patches from 15–40 m away)
  float patches = snoise(P * 0.11 + warpV * 0.8 + 91.0) + 0.35 * concave;
  col = mix(col, humus * 1.25, smoothstep(0.15, 0.75, patches) * 0.5);
  col = mix(col, litMean * vec3(1.3, 1.2, 1.05), smoothstep(-0.25, -0.75, patches) * 0.4);
  float h = 0.0;
  float rough = 0.86;
  // ── leaves (four overlapping layers, ~8–12 cm) / needles ──
  float aLeaf = ff_aa(fw, 0.1);
  if (aLeaf > 0.0 && needle < 0.95) {
    float lsz = 1.0 + 0.15 * autumn;
    // bottom to top: each layer covers the ones below, which are ~10 % darker each (shade between leaves)
    vec3 under = mix(humus, litMean * 0.7, 0.5);
    vec3 lc = under;
    float leafH = 0.0;
    for (int li = 0; li < 4; li++) {
      float fl = float(li);
      vec4 Lk = ff_leaves(P, up, t1, t2, 5.4 + 1.15 * fl, vec3(17.3, 5.1, 9.7) * fl, fw, lsz);
      vec3 ck = ff_leafCol(Lk.y, autumn, winter) * (0.85 + 0.3 * (0.5 + 0.5 * Lk.z)) * (1.0 - 0.18 * Lk.w);
      ck = mix(ck, dryT * (0.8 + 0.4 * Lk.y), tropic);
      ck *= 0.7 + 0.1 * fl;
      lc = mix(lc, ck, Lk.x);
      leafH = max(leafH * (1.0 - Lk.x * 0.5), Lk.x * (0.004 + 0.003 * fl + 0.003 * (1.0 - Lk.z * Lk.z)));
    }
    // decomposition keeps the leaves but darkens them
    lc = mix(lc, lc * 0.6 + humus * 0.3, decomp * 0.6);
    float k = aLeaf * (1.0 - needle);
    lc = mix(lc, lc * (clusterC / max(litMean, vec3(0.01))), 0.35);
    lc = mix(lc, humus * 1.1, wetDark * 0.5);
    col = mix(col, lc * (0.9 + 0.12 * m1), k);
    h += leafH * k;
  }
  float aNeedle = ff_aa(fw, 0.02);
  if (needle > 0.05) {
    // needle duff: mats of streaks with random orientation per ~25 cm mat
    vec3 fp; float f1, id;
    ff_cells(P * 4.0, fp, f1, id);
    float a = id * 6.2831853;
    vec3 dir = t1 * cos(a) + t2 * sin(a);
    vec3 side = cross(up, dir);
    // (measured from the mat's own centre: P·dir with dir tangent at P is identically zero)
    vec3 q = P - fp * 0.25;
    float st = snoise(vec3(dot(q, side) * 70.0, dot(q, dir) * 6.0, id * 13.0));
    float st2 = snoise(vec3(dot(q, side) * 120.0 + 3.0, dot(q, dir) * 9.0, id * 7.0));
    float streak = clamp(0.5 + 0.5 * st + 0.25 * st2, 0.0, 1.0);
    vec3 nc = mix(duff * 0.55, duff * 1.35 + vec3(0.02, 0.008, 0.0), streak);
    float matV = 0.85 + 0.3 * id;
    float k = needle * aNeedle;
    col = mix(col, mix(col, nc * matV, 0.85), k);
    h += (streak - 0.5) * 0.004 * k;
    // the mat's own value shows further out than the needles
    col *= mix(1.0, matV, needle * ff_aa(fw, 0.25) * 0.5);
  }
  // ── twigs and bark flakes (~0.7 m cells) ──
  float aTwig = ff_aa(fw, 0.04);
  if (aTwig > 0.0) {
    vec3 fp; float f1, id;
    ff_cells(P * 1.4, fp, f1, id);
    if (id > 0.35 && f1 < 0.5) {
      vec3 r = P * 1.4 - fp;
      r -= up * dot(r, up);
      float a = id * 31.0;
      vec3 dir = t1 * cos(a) + t2 * sin(a);
      float along = clamp(dot(r, dir), -0.46, 0.46);
      float dist = length(r - dir * along) / 1.4;   // metres
      float wdt = 0.007 + 0.016 * fract(id * 9.7) * fract(id * 3.3);
      float tw = (1.0 - smoothstep(wdt, wdt + max(fw * 0.7, 0.002), dist)) * aTwig;
      vec3 bark = fract(id * 4.3) < 0.15 ? vec3(0.32, 0.3, 0.27) : vec3(0.075, 0.05, 0.034) * (0.8 + 0.5 * fract(id * 2.9));
      col = mix(col, bark, tw);
      h += tw * wdt * 1.2;
      rough = mix(rough, 0.8, tw);
    }
  }
  // ── fallen branches (~2.5 m cells, a third occupied): 0.6–1.6 m sticks, 3–7 cm thick, bark-dark with a lit top —
  // the debris that reads from 8–20 m where single leaves no longer do ──
  float aBr = ff_aa(fw, 0.1);
  if (aBr > 0.0) {
    vec3 fp; float f1, id;
    ff_cells(P * 0.4, fp, f1, id);
    if (id < 0.33) {
      vec3 r = (P * 0.4 - fp) / 0.4;
      r -= up * dot(r, up);
      float a = id * 97.0;
      vec3 dir = t1 * cos(a) + t2 * sin(a);
      float hl = 0.3 + 0.5 * fract(id * 17.3);
      float along = dot(r, dir);
      float bend = 0.06 * sin(along * 3.0 + id * 40.0);
      float dist = abs(dot(r, cross(up, dir)) - bend);
      float wdt = 0.015 + 0.02 * fract(id * 5.1);
      float br = (1.0 - smoothstep(wdt, wdt + max(fw * 0.8, 0.004), dist)) * (1.0 - smoothstep(hl - 0.05, hl, abs(along))) * aBr;
      vec3 bark = vec3(0.07, 0.05, 0.035) * (0.8 + 0.5 * fract(id * 2.9));
      bark *= 0.8 + 0.5 * (1.0 - dist / max(wdt, 1e-3));
      col = mix(col, bark, br);
      h += br * wdt * 1.5;
      rough = mix(rough, 0.8, br);
    }
  }
  // ── exposed roots: meandering ridges in patches ──
  float aRoot = ff_aa(fw, 0.12);
  if (aRoot > 0.0 && tropic < 0.9) {
    // short runs of root (a ridge line of noise, cut into segments), only in some patches: long continuous ridges
    // read as cracks
    float rp = smoothstep(0.62, 0.85, snoise(P * 0.13 + 31.0) * 0.5 + 0.5 + 0.15 * cover);
    if (rp > 0.0) {
      float rr = 1.0 - abs(snoise(P * vec3(0.9) + warpV * 1.7 + 11.0));
      float seg = smoothstep(0.1, 0.45, snoise(P * 1.7 + 5.0));
      float root = smoothstep(0.9, 0.97, rr) * seg * rp * aRoot;
      col = mix(col, vec3(0.13, 0.095, 0.07) * (0.85 + 0.3 * m2), root * 0.85);
      h += root * 0.035;
    }
  }
  // ── stones, half buried (~1.8 m cells, sparse) ──
  float aStone = ff_aa(fw, 0.25);
  float stoneW = 0.0;
  if (aStone > 0.0) {
    vec3 fp; float f1, id;
    ff_cells(P * 0.55, fp, f1, id);
    if (id > 0.8) {
      float rad = 0.1 + 0.22 * fract(id * 5.7);
      float edge = f1 + 0.025 * snoise(P * 5.0 + id * 40.0);
      float sm = (1.0 - smoothstep(rad - 0.012 - fw * 0.6, rad, edge)) * aStone;
      float dome = sqrt(max(0.0, 1.0 - (edge / rad) * (edge / rad)));
      // weathered stone: the planet's rock, darker in its pits, a little lichen
      vec3 sc = rockCol * (0.7 + 0.35 * fract(id * 3.1)) * (0.88 + 0.16 * snoise(P * 11.0));
      sc = mix(sc, vec3(0.16, 0.16, 0.11), smoothstep(0.3, 0.8, snoise(P * 4.0 + 2.0)) * 0.35);
      col = mix(col, sc, sm);
      h += sm * dome * (0.05 + 0.1 * fract(id * 2.3));
      rough = mix(rough, 0.72, sm);
      stoneW = sm;
    }
  }
  // ── herb layer: patches of seedlings, sorrel and ivy where it is moist and the canopy lets light through ──
  float herbs = smoothstep(0.5, 0.78, snoise(P * 0.42 + warpV * 0.7 + 50.0) * 0.5 + 0.5 + (moist - 0.5) * 0.3 - (cover - 0.6) * 0.2) * (1.0 - tropic * 0.6) * (1.0 - winter * 0.5);
  if (herbs > 0.0) {
    float hv = snoise(P * 7.0 + 3.0) * ff_aa(fw, 0.12);
    float leafy = smoothstep(-0.2, 0.5, snoise(P * 3.2 + 8.0)) * mix(0.8, 1.0, ff_aa(fw, 0.25));
    vec3 herbC = mix(vec3(0.032, 0.06, 0.016), vec3(0.06, 0.1, 0.022), 0.5 + 0.5 * hv);
    herbC = mix(herbC, vec3(0.1, 0.075, 0.03), autumn * 0.6 + winter * 0.4);
    col = mix(col, herbC, herbs * leafy * 0.85);
    h += herbs * leafy * 0.025;
  }
  // ── moss over everything it likes (litter, the tops of stones and roots) ──
  if (mossW > 0.0) {
    float mv = snoise(P * 3.1 + 7.0) * ff_aa(fw, 0.3);
    vec3 mossC = mix(vec3(0.03, 0.062, 0.014), vec3(0.075, 0.125, 0.022), 0.5 + 0.5 * mv) * (0.9 + 0.2 * macB);
    // dried moss on dry ground is olive
    mossC = mix(mossC, vec3(0.085, 0.085, 0.03), clamp(0.7 - moist, 0.0, 1.0) * 0.6);
    float cushion = snoise(P * 11.0 + 3.0) * ff_aa(fw, 0.08);
    float mw = mossW * (1.0 - stoneW * 0.4);
    col = mix(col, mossC * (0.92 + 0.12 * cushion), mw);
    h = mix(h, h * 0.5 + 0.02 + 0.006 * cushion, mw);
    rough = mix(rough, 0.95, mw);
  }
  // hummocks of the floor at 1–3 m
  h += snoise(P * 0.45 + warpV) * 0.06 * ff_aa(fw, 1.0);
  f.col = col;
  f.bump = h;
  f.rough = rough;
  // the floor between trunks: crown shade takes the sky (ambient) — the sun flecks are the shadow maps' business
  f.sky = mix(1.0, 0.45, clamp(cover * 1.1, 0.0, 1.0)) * (1.0 - 0.08 * clamp(shrub, 0.0, 1.0));
  f.ao = 1.0 - 0.1 * decomp;
  f.mk = mix(0.35, 0.18, mossW);
  return f;
}

// one PCF-free tap of the cascaded sun shadow at a view-space point (the cascade by its depth)
float ff_shadow1(vec3 posView, vec3 nView) {
  float z = -posView.z;
  int k = z < uShadowSplits.x ? 0 : z < uShadowSplits.y ? 1 : z < uShadowSplits.z ? 2 : 3;
  if (float(k) >= uShadowCount) return 1.0;
  float bias = k == 0 ? uShadowBias.x : k == 1 ? uShadowBias.y : k == 2 ? uShadowBias.z : uShadowBias.w;
  mat4 M = k == 0 ? uShadowMat[0] : k == 1 ? uShadowMat[1] : k == 2 ? uShadowMat[2] : uShadowMat[3];
  vec4 sc4 = M * vec4(posView + nView * bias * 2.0, 1.0);
  vec3 sc = sc4.xyz / sc4.w;
  if (sc.z >= 1.0 || sc.z <= 0.0) return 1.0;
  vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2)) * 0.5;
  vec4 tile = vec4(o + uShadowTexel * 1.5, o + 0.5 - uShadowTexel * 1.5);
  return shadowTap(sc, tile);
}
// the instanced canopy's shade around a ground point (P, up in the body frame): five taps over ~4.4 m; -1 when
// unknown (no shadow maps here, the sun low or down)
float ff_canopy(vec3 P, vec3 up, vec3 Nb, float muS) {
  if (uShadowOn < 0.5 || muS < 0.15) return -1.0;
  vec3 pv = -vViewPosition;
  vec3 nv = normalize(uBodyToView * Nb);
  vec3 t1, t2;
  ff_frame(up, t1, t2);
  vec3 a = uBodyToView * t1 * 2.2, b = uBodyToView * t2 * 2.2;
  float s = ff_shadow1(pv, nv) + ff_shadow1(pv + a, nv) + ff_shadow1(pv - a, nv) + ff_shadow1(pv + b, nv) + ff_shadow1(pv - b, nv);
  return clamp((1.0 - s * 0.2) * 1.25, 0.0, 1.0) * smoothstep(0.15, 0.3, muS);
}

// bare earth at 1 cm–2 m (soil, a trodden street, the ground between crops): clods with shaded cracks between them
// (~0.12 m and ~0.45 m), damp and dry patches (~1.5 m) and scattered pebbles (2–4 cm) — x = albedo factor
// (mean-preserving), y = bump (m), z = pebble cover; every term fades to its mean by the footprint. (Plain noise at
// ±6 % left streets and fields a smooth, out-of-focus smear at eye level.)
vec3 soilDetail(vec3 P, float fw) {
  vec3 fp; float f1, id;
  float alb = 1.0, bump = 0.0;
  ff_cells(P * 8.0, fp, f1, id);
  float k1 = ff_aa(fw, 0.12);
  float c1 = smoothstep(0.55, 0.15, f1) - 0.45;
  alb += (0.24 * c1 + 0.1 * (id - 0.5)) * k1;
  bump += c1 * 0.012 * k1;
  ff_cells(P * 2.2 + 3.0, fp, f1, id);
  float k2 = ff_aa(fw, 0.45);
  float c2 = smoothstep(0.6, 0.2, f1) - 0.42;
  alb += (0.16 * c2 + 0.08 * (id - 0.5)) * k2;
  bump += c2 * 0.03 * k2;
  alb *= 1.0 + 0.1 * snoise(P * 0.65 + 9.0) * ff_aa(fw, 1.5);
  ff_cells(P * 14.0 + 7.0, fp, f1, id);
  float pr = 0.2 + 0.12 * fract(id * 13.7);
  float peb = step(0.8, id) * (1.0 - smoothstep(pr * 0.75, pr, f1)) * ff_aa(fw, 0.07);
  bump += peb * 0.015;
  return vec3(alb, bump, peb);
}

// sand micro relief, independent of the sand's depth: wind ripples (~0.6 m, gentle stoss / steep lee) with a finer
// ~0.13 m set across them, and streaks along the wind; x = albedo factor, y = bump (m), z = glint id (rare sun facets)
vec3 sandDetail(vec3 P, vec3 up, float fw) {
  // ripple coordinates along FIXED directions (P·D; measured along the local tangent wind itself, P·wind ≡ 0 and the
  // sand had no ripples at all — only the warp noise): crests run across D's tangent projection, and a second direction
  // takes over where the first stands near the vertical
  vec3 D1 = normalize(vec3(0.83, 0.12, 0.55));
  vec3 Dw = length(D1 - up * dot(D1, up)) > 0.45 ? D1 : normalize(vec3(-0.21, 0.9, 0.38));
  vec3 Ds = normalize(cross(Dw, vec3(0.37, -0.29, 0.88)));
  vec3 wind = Dw;
  vec3 side = Ds;
  float warp = snoise(P * 0.35) * 3.0;
  float ph1 = fract(dot(P, wind) / 0.6 + warp * 0.16);
  float r1 = (smoothstep(0.0, 0.8, ph1) - smoothstep(0.8, 1.0, ph1)) * 2.0 - 1.0;
  r1 *= ff_aa(fw, 0.6);
  float r2 = sin(dot(P, wind + side * 0.3) * 6.2831853 / 0.13 + warp * 2.0 + snoise(P * 2.1) * 2.0) * ff_aa(fw, 0.13);
  float streak = snoise(vec3(dot(P, side) * 1.8, dot(P, wind) * 0.12, 3.7)) * ff_aa(fw, 0.5);
  // megaripples (~2.5 m) and long wind streaks (~4 m wide, tens of metres long): what still reads from 30–150 m
  float ph3 = fract(dot(P, wind) / 2.5 + warp * 0.05 + snoise(P * 0.08) * 0.6);
  float r3 = ((smoothstep(0.0, 0.75, ph3) - smoothstep(0.75, 1.0, ph3)) * 2.0 - 1.0) * ff_aa(fw, 2.5);
  float st2 = snoise(vec3(dot(P, side) * 0.25, dot(P, wind) * 0.02, 9.1));
  float bump = r1 * 0.018 + r2 * 0.0035 + streak * 0.006 + r3 * 0.06 + st2 * 0.05;
  float alb = 1.0 + 0.05 * r1 + 0.06 * streak + 0.04 * r3 + 0.07 * st2;
  float glint = fw < 0.06 ? gn_hash13(floor(P * 45.0)) : 0.0;
  return vec3(alb, bump, glint);
}

// open grassland variation: dry / lush sward at 10–50 m, wildflowers in spring and summer
vec3 meadowTint(vec3 g, vec3 P, float fw, float moist, float autumn, float winter, float cold, vec3 warpV) {
  float pA = fbm3(P * 0.045 + warpV * 0.6 + 3.1);
  float pB = snoise(P * 0.11 + warpV * 0.4 + 7.7);
  float dryness = clamp(0.5 + 0.6 * pA + 0.22 * pB - (moist - 0.45) * 0.9, 0.0, 1.0);
  vec3 dryC = g * vec3(1.42, 1.24, 0.76) + vec3(0.014, 0.01, 0.0);
  vec3 lushC = g * vec3(0.8, 1.08, 0.7);
  // (softer than before: strong 10–50 m swings between straw and deep green read as blurry blotches from 60 m up)
  g = mix(g, mix(lushC, dryC, smoothstep(0.32, 0.82, dryness)), 0.45);
  // what gives the sward its focus at 3–100 m: tussocks and their shaded gaps (~0.7 m and ~2.2 m), trampled and
  // thin patches (~6 m) — value, not hue, so it never turns into camouflage; each fades to its mean by footprint
  float tus = snoise(P * 1.45 + warpV * 0.6 + 33.0) * ff_aa(fw, 0.7) * 0.6 + snoise(P * 0.45 + 51.0) * ff_aa(fw, 2.2) * 0.4;
  float thin = smoothstep(0.35, 0.85, snoise(P * 0.16 + warpV * 0.5 + 71.0) * 0.5 + 0.5) * ff_aa(fw, 6.0);
  g *= 0.84 + 0.32 * smoothstep(-0.8, 0.8, tus);
  g = mix(g, g * vec3(1.2, 1.12, 0.86) + vec3(0.012, 0.008, 0.002), thin * 0.45);
  // the sward's own grain: clumps (~0.35 m) and tussocks (~1.1 m), each a lit crown with a shaded gap round it —
  // rounded and anti-aliased by the footprint, mean-preserving. Soft noise alone left the turf out of focus at 10–80 m
  // next to crisp houses and trees (a smeared, low-resolution look)
  if (fw < 0.5) {
    vec3 fp; float f1, id;
    ff_cells(P * 2.8 + warpV * 0.3 + 5.0, fp, f1, id);
    float c1 = smoothstep(0.62, 0.18, f1) - 0.42;
    g *= 1.0 + (0.34 * c1 + 0.08 * (id - 0.5)) * ff_aa(fw, 0.36);
    ff_cells(P * 0.9 + warpV * 0.2 + 17.0, fp, f1, id);
    float c2 = smoothstep(0.66, 0.2, f1) - 0.42;
    g *= 1.0 + (0.22 * c2 + 0.1 * (id - 0.5)) * ff_aa(fw, 1.1);
  }
  float season = (1.0 - autumn) * (1.0 - winter) * (1.0 - cold);
  float patchF = smoothstep(0.55, 0.8, snoise(P * 0.19 + warpV + 21.0) * 0.5 + 0.5) * season * smoothstep(0.3, 0.55, moist) * (1.0 - dryness * 0.5);
  if (patchF > 0.01) {
    float hsel = snoise(P * 0.04 + 40.0) * 0.5 + 0.5;
    vec3 fl = hsel < 0.3 ? vec3(0.62, 0.45, 0.02) : hsel < 0.55 ? vec3(0.62, 0.62, 0.57) : hsel < 0.8 ? vec3(0.28, 0.12, 0.45) : vec3(0.55, 0.05, 0.03);
    vec3 fp; float f1, id;
    ff_cells(P * 6.0, fp, f1, id);
    float fleck = (1.0 - smoothstep(0.1, 0.17, f1)) * step(0.4, id);
    float aa = ff_aa(fw, 0.06);
    // (unresolved, the flecks average to a faint tint only: their full mean laid pale washes over whole meadows)
    float cover = mix(0.035, fleck, aa) * patchF;
    g = mix(g, fl, cover);
  }
  return g;
}
`;
