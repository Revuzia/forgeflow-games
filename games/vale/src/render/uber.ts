// VALE render — uber programs (r12 B4 "≤ 40 shader programs"): several small shaders of one pass (the VFX pass, the
// overlay pass) folded into ONE RawShaderMaterial source, the kind a draw is chosen by a uniform (uUberKind).
//
// Each kind keeps its own GLSL exactly as written (a `void main()` vertex and fragment with attribute / varying /
// uniform declarations); uberProgram() turns them into functions of one program:
//   * attributes   a kind's own attributes ride the generic vec4 slots ua0 … uaN in the order its `attrs` lists them
//                  (the draw's geometry names them so: uberAttrs); position, normal, uv and instanceMatrix stay
//   * varyings     packed first-fit into generic vec4 varyings (uv0 …), the same packing on both sides
//   * uniforms     declared once (a name must keep one type across kinds); `shared` GLSL blocks (the manual depth tests)
//                  are stripped from each kind and declared once
//   * helpers      every other global (functions, consts) is kept once
// A RawShaderMaterial's program key is its source and defines only, so every material of the pass shares the one
// program whatever its side, blending or kind. The numbers each kind computes are its own code's, unchanged: the
// packing only moves values between interpolators.

import { type BufferAttribute, type BufferGeometry, type InterleavedBufferAttribute } from 'three';

export interface UberKind {
  /** the kind's vertex and fragment shader (ShaderMaterial style: `attribute`, `varying`, gl_FragColor, texture2D) */
  vert: string;
  frag: string;
  /** the kind's own attributes, in generic-slot order (ua0, ua1 …) */
  attrs: readonly string[];
}

const BUILTIN_ATTRS: Record<string, string> = { position: 'vec3', normal: 'vec3', uv: 'vec2', instanceMatrix: 'mat4' };
const BUILTIN_UNIFORMS = /* glsl */`
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
`;
const DECL = /\b(attribute|varying|uniform)\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);/g;
const SIZE: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
const SWZ = ['x', 'y', 'z', 'w'];

interface Parsed { decls: { kind: string; type: string; name: string }[]; helpers: string; body: string }

function parse(src: string, strip: readonly string[]): Parsed {
  let s = src;
  for (const x of strip) s = s.split(x).join('\n');
  const at = s.indexOf('void main()');
  if (at < 0) throw new Error('uber: no main()');
  const open = s.indexOf('{', at), close = s.lastIndexOf('}');
  const body = s.slice(open + 1, close);
  const decls: Parsed['decls'] = [];
  const helpers = s.slice(0, at).replace(DECL, (_m, kind: string, type: string, names: string) => {
    for (const n of names.split(',')) { const name = n.trim(); if (name) decls.push({ kind, type, name }); }
    return '';
  });
  return { decls, helpers, body };
}

/** a header's top-level items (functions, consts, preprocessor lines), comments dropped */
function items(src: string): string[] {
  const t = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const out: string[] = [];
  let cur = '', depth = 0;
  for (const line of t.split('\n')) {
    if (depth === 0 && line.trim().startsWith('#')) { if (cur.trim()) out.push(cur.trim()); cur = ''; out.push(line.trim()); continue; }
    for (const ch of line + '\n') {
      cur += ch;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { out.push(cur.trim()); cur = ''; } }
      else if (ch === ';' && depth === 0) { out.push(cur.trim()); cur = ''; }
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((x) => x.length > 0);
}
const itemName = (x: string): string => /^(?:const\s+)?\w+\s+(\w+)/.exec(x)?.[1] ?? x;

/** add a header's items to `into` once each (the same name with another body is an error) */
function addItems(into: Map<string, string>, src: string): void {
  const norm = (x: string): string => x.replace(/\s+/g, ' ');
  for (const x of items(src)) {
    const n = itemName(x);
    const was = into.get(n);
    if (was === undefined) into.set(n, x);
    else if (norm(was) !== norm(x)) throw new Error(`uber: ${n} is defined twice differently`);
  }
}

/** first-fit packing of a kind's varyings into vec4 slots: name → [slot, first component] */
function pack(vs: { type: string; name: string }[]): Map<string, [number, number]> {
  const free: number[] = [];
  const out = new Map<string, [number, number]>();
  for (const v of vs) {
    const n = SIZE[v.type];
    if (!n) throw new Error(`uber: varying type ${v.type}`);
    let slot = free.findIndex((f) => 4 - f >= n);
    if (slot < 0) { slot = free.length; free.push(0); }
    out.set(v.name, [slot, free[slot]]);
    free[slot] += n;
  }
  return out;
}
const sw = (c0: number, n: number): string => SWZ.slice(c0, c0 + n).join('');

/** the one vertex and fragment source of `kinds` (uUberKind = the kind's index); `shared`: GLSL blocks (uniforms +
 *  functions) a kind's fragment includes, stripped there and declared once */
export function uberProgram(kinds: readonly UberKind[], shared: readonly string[] = []): { vert: string; frag: string; slots: number } {
  const uniforms = new Map<string, string>();
  const addU = (type: string, name: string): void => {
    const was = uniforms.get(name);
    if (was && was !== type) throw new Error(`uber: uniform ${name} is ${was} and ${type}`);
    uniforms.set(name, type);
  };
  const vHelp = new Map<string, string>(), fHelp = new Map<string, string>();
  const vFns: string[] = [], fFns: string[] = [];
  const builtins = new Set<string>();
  let slots = 0, vary = 0;
  kinds.forEach((k, i) => {
    const v = parse(k.vert, shared), f = parse(k.frag, shared);
    const vv = v.decls.filter((d) => d.kind === 'varying');
    const packing = pack(vv);
    vary = Math.max(vary, ...[...packing.values()].map(([s]) => s + 1), 0);
    for (const d of [...v.decls, ...f.decls]) if (d.kind === 'uniform') addU(d.type, d.name);
    addItems(vHelp, v.helpers);
    addItems(fHelp, f.helpers);
    // vertex: the kind's attributes from the generic slots, its varyings as locals packed at the end
    const loc: string[] = [];
    for (const d of v.decls) {
      if (d.kind !== 'attribute') continue;
      if (BUILTIN_ATTRS[d.name]) { builtins.add(d.name); continue; }
      const slot = k.attrs.indexOf(d.name);
      if (slot < 0) throw new Error(`uber: attribute ${d.name} has no slot`);
      slots = Math.max(slots, slot + 1);
      const n = SIZE[d.type];
      loc.push(`  ${d.type} ${d.name} = ua${slot}${n === 4 ? '' : '.' + sw(0, n)};`);
    }
    for (const d of vv) loc.push(`  ${d.type} ${d.name} = ${d.type}( 0.0 );`);
    const packOut = vv.map((d) => { const [s, c] = packing.get(d.name)!; return `  ux${s}.${sw(c, SIZE[d.type])} = ${d.name};`; });
    vFns.push(`void uber${i}() {\n${loc.join('\n')}\n${v.body}\n${packOut.join('\n')}\n}`);
    // fragment: its varyings unpacked
    const unpack: string[] = [];
    for (const d of f.decls) {
      if (d.kind !== 'varying') continue;
      const p = packing.get(d.name);
      if (!p) throw new Error(`uber: fragment varying ${d.name} not written by the vertex`);
      unpack.push(`  ${d.type} ${d.name} = ux${p[0]}.${sw(p[1], SIZE[d.type])};`);
    }
    fFns.push(`void uber${i}() {\n${unpack.join('\n')}\n${f.body}\n}`);
  });
  for (const k of kinds) for (const b of Object.keys(BUILTIN_ATTRS)) if (new RegExp(`\\b${b}\\b`).test(parse(k.vert, shared).body)) builtins.add(b);
  // a shared block declares its own uniforms (fragment: the whole block; vertex: its declarations only)
  const sharedDecl = shared.map((b) => (b.match(/uniform\s+[^;]+;/g) ?? []).join('\n')).join('\n');
  const own = [...uniforms].filter(([n]) => !new RegExp(`uniform\\s+\\w+\\s+${n}\\s*;`).test(sharedDecl)).map(([n, t]) => `uniform ${t} ${n};`).join('\n');
  const head = 'precision highp float;\nprecision highp int;\nprecision highp sampler2D;\n#define texture2D texture\n';
  const dispatch = kinds.map((_k, i) => `${i ? 'else ' : ''}if ( uUberKind == ${i} ) uber${i}();`).join('\n  ');
  const vary0 = (q: string): string => Array.from({ length: vary }, (_, i) => `${q} vec4 ux${i};`).join('\n');
  const vert = `${head}${BUILTIN_UNIFORMS}uniform int uUberKind;
${[...builtins].map((b) => `in ${BUILTIN_ATTRS[b]} ${b};`).join('\n')}
${Array.from({ length: slots }, (_, i) => `in vec4 ua${i};`).join('\n')}
${vary0('out')}
${sharedDecl}
${own}
${[...vHelp.values()].join('\n')}
${vFns.join('\n')}
void main() {
  gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
  ${dispatch}
}
`;
  const frag = `${head}${BUILTIN_UNIFORMS}uniform int uUberKind;
${vary0('in')}
layout( location = 0 ) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
${shared.join('\n')}
${own}
${[...fHelp.values()].join('\n')}
${fFns.join('\n')}
void main() {
  pc_fragColor = vec4( 0.0 );
  ${dispatch}
}
`;
  return { vert, frag, slots };
}

/** name a draw's own attributes the way its kind's program reads them (generic slots ua0 …) */
export function uberAttrs(geo: BufferGeometry, kind: UberKind, attrs: Record<string, BufferAttribute | InterleavedBufferAttribute>): void {
  kind.attrs.forEach((n, i) => {
    const a = attrs[n];
    if (!a) throw new Error(`uber: no attribute ${n}`);
    geo.setAttribute(`ua${i}`, a);
  });
}
