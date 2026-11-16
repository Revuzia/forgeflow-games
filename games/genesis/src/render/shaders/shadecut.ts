// GENESIS — PERF s19 bisection: fragment-shader COST CUTS by URL (`?tshade=` terrain, `?vshade=` vegetation,
// `?wshade=` water, `?bshade=` buildings; comma lists, default none; the perf report's header prints each). Debug
// only: they change the picture. Each cut removes ONE cost at compile time, so the owner's Mac names the heavy part
// by frame time. The generic cuts are macros placed after the shared GLSL libraries, so every later call is replaced:
//   nonoise  every arithmetic noise call (snoise, snoiseGrad, fbm3, fbmAA, vnoise, voronoi3) returns a constant
//   novor    voronoi3 (27 hashed cells a call) returns a constant
//   fbm1     fbm3 runs 1 octave instead of 3
//   noshadow sunShadow (5 PCF taps) returns 1
//   all      every cut of that shader together
import { perfList } from '../perfswitch.ts';

export interface ShadeCut { has(k: string): boolean; glsl: string; key: string }

export function shadeCut(param: string): ShadeCut {
  const set = perfList(param);
  const has = (k: string): boolean => set.has(k) || (set.has('all') && k !== 'albedo' && k !== 'nosurf' && k !== 'nolight');
  const L: string[] = [];
  if (has('nonoise')) {
    L.push('float gn_cut0(out vec3 g) { g = vec3(0.0); return 0.0; }');
    L.push('#define snoise(p) 0.0', '#define snoiseGrad(p, g) gn_cut0(g)', '#define fbm3(p) 0.0', '#define fbmAA(p, o, f) 0.0', '#define vnoise(p) 0.5');
  } else if (has('fbm1')) L.push('#define fbm3(p) (0.875 * snoise(p))');
  if (has('nonoise') || has('novor')) L.push('#define voronoi3(p) vec3(0.5, 0.8, 0.5)');
  if (has('noshadow')) L.push('#define sunShadow(a, b) 1.0');
  return { has, glsl: L.join('\n'), key: set.size ? [...set].sort().join('+') : '' };
}
