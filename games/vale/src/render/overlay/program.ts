// VALE render — the overlay pass as ONE program (r12 B4 "≤ 40 shader programs"; uber.ts): the telegraph composite, the
// ground rings, the overhead bars, their labels and the telegraphs keep their own GLSL (context.ts, rings.ts,
// bars.ts, telegraphs.ts) and draw through one RawShaderMaterial source, the kind picked by uUberKind.
// Every overlay material carries every sampler the program declares (the scene depth, the label atlas, the telegraph
// target; null binds three's empty texture), so no sampler of a kind that does not read it can point at the target
// the pass draws into. Built on first use (the layers' modules import this one).

import { GLSL3, RawShaderMaterial, type ShaderMaterialParameters } from 'three';
import { type UberKind, uberAttrs, uberProgram } from '../uber.ts';
import { DEPTH_TEST_GLSL, overlayUniforms } from './depth.ts';
import { BAR_FRAG, BAR_VERT, LABEL_FRAG, LABEL_VERT } from './bars.ts';
import { RING_FRAG, RING_VERT } from './rings.ts';
import { TELE_FRAG, TELE_VERT } from './telegraphs.ts';

/** the telegraph target composited over the graded buffer (premultiplied) */
export const COMPOSITE_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
export const COMPOSITE_FRAG = 'uniform sampler2D tTele; varying vec2 vUv; void main(){ gl_FragColor = texture2D( tTele, vUv ); }';

export const OVERLAY_KIND = { composite: 0, ring: 1, bar: 2, label: 3, tele: 4 } as const;
type Kind = keyof typeof OVERLAY_KIND;

let kinds: Record<Kind, UberKind> | null = null;
let prog: { vert: string; frag: string } | null = null;
function kindsOf(): Record<Kind, UberKind> {
  return (kinds ??= {
    composite: { vert: COMPOSITE_VERT, frag: COMPOSITE_FRAG, attrs: [] },
    ring: { vert: RING_VERT, frag: RING_FRAG, attrs: ['aRing', 'aStyle', 'aColor'] },
    bar: { vert: BAR_VERT, frag: BAR_FRAG, attrs: ['aAnchor', 'aBox', 'aHp', 'aRes', 'aCol', 'aResCol', 'aSeat', 'aMisc'] },
    label: { vert: LABEL_VERT, frag: LABEL_FRAG, attrs: ['aAnchor', 'aRect', 'aUv', 'aTint'] },
    tele: { vert: TELE_VERT, frag: TELE_FRAG, attrs: ['aA', 'aB', 'aC', 'aD', 'aColor', 'aTick'] },
  });
}
/** the one overlay program's source */
export function overlayProgram(): { vert: string; frag: string } {
  if (!prog) { const k = kindsOf(); prog = uberProgram((Object.keys(OVERLAY_KIND) as Kind[]).map((n) => k[n]), [DEPTH_TEST_GLSL]); }
  return prog;
}

/** an overlay draw's material: `uniforms` its own (by reference), `state` its blending, sides and depth */
export function overlayMaterial(kind: Kind, uniforms: Record<string, { value: unknown }>, state: Partial<ShaderMaterialParameters>): RawShaderMaterial {
  const p = overlayProgram();
  return new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: p.vert, fragmentShader: p.frag,
    uniforms: {
      uSceneDepth: overlayUniforms.uSceneDepth, uHasDepth: overlayUniforms.uHasDepth, uResolution: overlayUniforms.uResolution,
      uNear: overlayUniforms.uNear, uFar: overlayUniforms.uFar, uAtlas: { value: null }, tTele: { value: null },
      ...uniforms, uUberKind: { value: OVERLAY_KIND[kind] },
    },
    ...state,
  });
}

/** name a draw's attributes the way its kind reads them */
export function overlayAttrs(geo: Parameters<typeof uberAttrs>[0], kind: Kind, attrs: Parameters<typeof uberAttrs>[2]): void {
  uberAttrs(geo, kindsOf()[kind], attrs);
}
