// GENESIS — the GPU probe (ROADMAP-60FPS step 2, `?gpuprobe=1`; off by default).
//
// The owner's M5 runs a one-draw tonemap at ~170 ms under passsync with the queue drained: is that the machine (memory
// pressure / residency / a contended GPU process: H1) or Genesis' own frame (H2)? The probe times passes whose cost is
// known to be trivial, each batch inside one gl.finish():
//   fresh WxH   32 copies A->B->A between two NEW rgba16f targets at the render size (made for the probe, freed after)
//   fresh 64    the same at 64x64 (no bandwidth to speak of: a pure per-pass cost)
//   hdr->new    8 copies that SAMPLE the existing post.hdr colour texture (resolved MSAA) into a fresh target
//   atlas->new  8 copies that sample the existing shadow atlas (depth, compare sampler) into a fresh target
// Milliseconds per pass at a few us-ms on a healthy GPU; 5-50 ms per pass in-world (fresh targets too) means H1.
// The first batch of each set is 4 passes; when those already took > 30 ms a pass the rest is skipped (the probe must
// not stall the page for seconds), and the line says how many passes ran. Every target is made, cleared and its
// program linked BEFORE the timed batches (allocation and compile are not timed). Runs once at boot (the renderer's
// 3rd frame) and, while the perf report records, at its start and every 5 s (perfreport.ts leaves those frames out).

import {
  HalfFloatType, LinearFilter, RGBAFormat, ShaderMaterial, WebGLRenderTarget, NoBlending,
  type Texture, type WebGLRenderer,
} from 'three';
import { perfSwitch } from './perfswitch.ts';
import { FS_VERT, type FullscreenQuad } from './post/fsquad.ts';

export const GPU_PROBE = perfSwitch('gpuprobe', false);

export interface ProbeSet { name: string; passes: number; ms: number }
export interface ProbeResult {
  tag: string;
  /** seconds into the recording (boot: since page load) */
  t: number;
  w: number; h: number;
  /** wall ms of an empty gl.finish() right after another (the sync's own floor) */
  finishMs: number;
  sets: ProbeSet[];
  /** wall ms the whole probe took, set-up included */
  totalMs: number;
}

/** probes taken outside a recording (boot) */
export const BOOT_PROBES: ProbeResult[] = [];

const f2 = (x: number) => (Math.round(x * 100) / 100).toString();
export function probeLine(p: ProbeResult): string {
  return `gpuprobe ${p.tag} t ${f2(p.t)}s ${p.w}x${p.h} (ms per pass, passes): ` + p.sets.map((s) => `${s.name} ${f2(s.passes ? s.ms / s.passes : 0)} (${s.passes})`).join(' · ')
    + ` | empty finish ${f2(p.finishMs)} ms | probe total ${Math.round(p.totalMs)} ms`;
}

let copyMat: ShaderMaterial | null = null;
let shadowMat: ShaderMaterial | null = null;
function mats(): { copy: ShaderMaterial; shadow: ShaderMaterial } {
  if (!copyMat) {
    const common = { vertexShader: FS_VERT, depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false };
    copyMat = new ShaderMaterial({
      ...common, uniforms: { tSrc: { value: null } },
      fragmentShader: /* glsl */ `uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vUv); }`,
    });
    shadowMat = new ShaderMaterial({
      ...common, uniforms: { tSrc: { value: null } },
      fragmentShader: /* glsl */ `uniform sampler2DShadow tSrc; varying vec2 vUv; void main() { gl_FragColor = vec4(texture(tSrc, vec3(vUv, 0.5))); }`,
    });
  }
  return { copy: copyMat, shadow: shadowMat! };
}

function target(w: number, h: number): WebGLRenderTarget {
  const t = new WebGLRenderTarget(w, h, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  t.texture.name = 'gpuprobe';
  return t;
}

/**
 * Time trivial copies (see the file comment). Call between frames' passes (the renderer does, at the top of render()):
 * it binds its own targets and puts the previous one back.
 */
export function probeGpu(r: WebGLRenderer, fsq: FullscreenQuad, w: number, h: number, existing: { name: string; tex: Texture | null; shadow?: boolean }[], tag: string): ProbeResult {
  const T0 = performance.now();
  const gl = r.getContext() as WebGL2RenderingContext;
  const prev = r.getRenderTarget();
  const prevAuto = r.autoClear;
  r.autoClear = false;
  w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
  const { copy, shadow } = mats();
  const A = target(w, h), B = target(w, h), a = target(64, 64), b = target(64, 64);
  const sets: ProbeSet[] = [];
  let finishMs = 0;
  try {
    // set-up, untimed: allocate and clear every target, link both programs
    for (const t of [A, B, a, b]) { r.setRenderTarget(t); r.clear(true, false, false); }
    copy.uniforms.tSrc.value = A.texture; fsq.render(r, copy, B);
    copy.uniforms.tSrc.value = a.texture; fsq.render(r, copy, b);
    for (const e of existing) if (e.tex) { const m = e.shadow ? shadow : copy; m.uniforms.tSrc.value = e.tex; fsq.render(r, m, b); }
    gl.finish();
    { const t = performance.now(); gl.finish(); finishMs = performance.now() - t; }
    // a timed set: `n` passes, the first 4 in one finish; the rest (in one more) only while a pass costs < 30 ms
    const run = (name: string, n: number, pass: (i: number) => void) => {
      let done = 0, ms = 0;
      const batch = (k: number) => { const t = performance.now(); for (let i = 0; i < k; i++) pass(done + i); gl.finish(); ms += performance.now() - t; done += k; };
      batch(Math.min(4, n));
      if (done < n && ms / done < 30) batch(n - done);
      sets.push({ name, passes: done, ms });
    };
    run('fresh-full', 32, (i) => { copy.uniforms.tSrc.value = (i & 1 ? B : A).texture; fsq.render(r, copy, i & 1 ? A : B); });
    run('fresh-64', 32, (i) => { copy.uniforms.tSrc.value = (i & 1 ? b : a).texture; fsq.render(r, copy, i & 1 ? a : b); });
    for (const e of existing) {
      if (!e.tex) { sets.push({ name: `${e.name}(none)`, passes: 0, ms: 0 }); continue; }
      const m = e.shadow ? shadow : copy;
      run(`${e.name}->fresh`, 8, (i) => { m.uniforms.tSrc.value = e.tex; fsq.render(r, m, i & 1 ? A : B); });
    }
  } finally {
    copy.uniforms.tSrc.value = null; shadow.uniforms.tSrc.value = null;
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    for (const t of [A, B, a, b]) t.dispose();
  }
  return { tag, t: performance.now() / 1000, w, h, finishMs, sets, totalMs: performance.now() - T0 };
}
