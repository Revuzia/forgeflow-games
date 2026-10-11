// GENESIS — render quality presets (CONTRACT.md §15.9). Quality never removes a power and never changes the sim:
// it only trades pixels, samples and ranges. `detectQuality` picks a starting preset from a quick GPU probe.

export type QualityName = 'low' | 'medium' | 'high' | 'ultra' | 'cinematic';
export const QUALITY_NAMES: QualityName[] = ['low', 'medium', 'high', 'ultra', 'cinematic'];

export interface Quality {
  name: QualityName;
  /** internal resolution relative to the canvas (after the DPR cap) */
  renderScale: number;
  maxDpr: number;
  msaa: number;
  /** terrain screen-space error target in pixels (smaller = more triangles) */
  terrainPixelError: number;
  /** terrain patches built per frame while streaming */
  patchBudget: number;
  shadowCascades: number;
  shadowMapSize: number;
  /** view depth covered by shadows near the surface (m) */
  shadowDistance: number;
  atmoSteps: number;
  cloudSteps: number;
  cloudLightSteps: number;
  /** cloud buffer resolution relative to the render resolution */
  cloudScale: number;
  bloom: number;
  godRays: boolean;
  flare: number;
  fxaa: boolean;
  grain: number;
  /** reserved for the life phase: vegetation density / range, grass, particles, lights, SSAO, DOF */
  vegetationDensity: number;
  vegetationRange: number;
  grass: boolean;
  particleBudget: number;
  lightBudget: number;
  ssao: boolean;
  dof: boolean;
}

const BASE: Omit<Quality, 'name'> = {
  renderScale: 1, maxDpr: 1.5, msaa: 0, terrainPixelError: 6, patchBudget: 16, shadowCascades: 3, shadowMapSize: 2048,
  shadowDistance: 3000, atmoSteps: 16, cloudSteps: 48, cloudLightSteps: 5, cloudScale: 0.5, bloom: 0.045, godRays: true,
  flare: 1, fxaa: true, grain: 0.02, vegetationDensity: 1, vegetationRange: 1, grass: true, particleBudget: 20000,
  // ssao: GTAO contact shadows on Medium and up (post/gtao.ts has the per-preset cost)
  lightBudget: 8, ssao: true, dof: false,
};

export const QUALITY: Record<QualityName, Quality> = {
  low: { ...BASE, name: 'low', renderScale: 0.75, maxDpr: 1, terrainPixelError: 14, patchBudget: 8, shadowCascades: 0, shadowMapSize: 1024, atmoSteps: 10, cloudSteps: 24, cloudLightSteps: 3, cloudScale: 0.25, bloom: 0.035, godRays: false, flare: 0.6, grain: 0.015, vegetationDensity: 0.35, vegetationRange: 0.5, grass: false, particleBudget: 4000, lightBudget: 2, ssao: false },
  medium: { ...BASE, name: 'medium', renderScale: 0.9, maxDpr: 1.25, terrainPixelError: 9, patchBudget: 12, shadowCascades: 2, shadowMapSize: 2048, atmoSteps: 12, cloudSteps: 32, cloudLightSteps: 4, cloudScale: 0.35, vegetationDensity: 0.65, vegetationRange: 0.75, particleBudget: 10000, lightBudget: 4 },
  // (terrain pixel error 7, not BASE's 6: ~25 % fewer terrain patches and draws at settlement views for detail the
  // shading — analytic micro normals, bump — carries anyway)
  high: { ...BASE, name: 'high', terrainPixelError: 7 },
  ultra: { ...BASE, name: 'ultra', maxDpr: 2, msaa: 4, terrainPixelError: 4, patchBudget: 24, shadowCascades: 4, shadowMapSize: 4096, shadowDistance: 4500, atmoSteps: 24, cloudSteps: 72, cloudLightSteps: 6, cloudScale: 0.5, vegetationDensity: 1.3, vegetationRange: 1.4, particleBudget: 40000, lightBudget: 12, ssao: true },
  // (cinematic clouds: k = 2 with 96 steps — every pixel marched each frame cost ~4× High; vegetation capped near Ultra:
  // 1.6 × 2.0² drew ~6× High's triangles)
  cinematic: { ...BASE, name: 'cinematic', maxDpr: 2, msaa: 4, terrainPixelError: 3, patchBudget: 48, shadowCascades: 4, shadowMapSize: 4096, shadowDistance: 6000, atmoSteps: 32, cloudSteps: 96, cloudLightSteps: 8, cloudScale: 0.5, vegetationDensity: 1.35, vegetationRange: 1.5, particleBudget: 80000, lightBudget: 16, ssao: true, dof: true },
};

export function isQualityName(s: string | null | undefined): s is QualityName {
  return !!s && (QUALITY_NAMES as string[]).includes(s);
}

/** what the probe found (the dev HUD and the settings panel can show it) */
export const GPU_PROBE: { renderer: string; msPerMP: number; pick: QualityName | '' } = { renderer: '', msPerMP: -1, pick: '' };

const PROBE_VS = `#version 300 es
in vec2 aP;
void main() { gl_Position = vec4(aP, 0.0, 1.0); }`;
// a reference load: a dependent chain of transcendental math per pixel, about what one atmosphere / cloud march step
// costs, so the time per megapixel ranks GPUs by the work the expensive passes actually do
const PROBE_FS = `#version 300 es
precision highp float;
uniform float uK;
out vec4 oC;
void main() {
  vec2 q = gl_FragCoord.xy * 0.0013 + uK;
  float a = 0.0;
  for (int i = 0; i < 64; i++) { q = vec2(sin(q.y * 1.7 + a), cos(q.x * 1.3 - a)); a += dot(q, q) * 0.01; }
  oC = vec4(fract(a), q * 0.5 + 0.5, 1.0);
}`;

/**
 * A timed fill-rate probe on the renderer's own context: milliseconds to shade one megapixel of the reference shader
 * (the best of three runs of four 1024² passes, each run closed by a 1-pixel read so the GPU really finished), or null
 * when it cannot be measured. Every piece of GL state it touches is put back (three.js caches that state).
 */
export function probeGpu(gl: WebGL2RenderingContext): number | null {
  const S = 1024, PASSES = 4;
  const prev = {
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    fb: gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    rb: gl.getParameter(gl.RENDERBUFFER_BINDING) as WebGLRenderbuffer | null,
    vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
    buf: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
    caps: [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.STENCIL_TEST].map((c) => [c, gl.isEnabled(c)] as const),
    colorMask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
  };
  let vs: WebGLShader | null = null, fs: WebGLShader | null = null, prog: WebGLProgram | null = null;
  let fbo: WebGLFramebuffer | null = null, rbo: WebGLRenderbuffer | null = null, vao: WebGLVertexArrayObject | null = null, vbo: WebGLBuffer | null = null;
  try {
    vs = gl.createShader(gl.VERTEX_SHADER); fs = gl.createShader(gl.FRAGMENT_SHADER); prog = gl.createProgram();
    if (!vs || !fs || !prog) return null;
    gl.shaderSource(vs, PROBE_VS); gl.compileShader(vs);
    gl.shaderSource(fs, PROBE_FS); gl.compileShader(fs);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aP');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    rbo = gl.createRenderbuffer(); fbo = gl.createFramebuffer(); vao = gl.createVertexArray(); vbo = gl.createBuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, S, S);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rbo);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const [c] of prev.caps) gl.disable(c);
    gl.colorMask(true, true, true, true);
    gl.useProgram(prog);
    const uK = gl.getUniformLocation(prog, 'uK');
    const px = new Uint8Array(4);
    // warm up (the driver finishes compiling on the first draw) on a small patch
    gl.viewport(0, 0, 32, 32);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.viewport(0, 0, S, S);
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      for (let k = 0; k < PASSES; k++) { gl.uniform1f(uK, run * 0.37 + k * 0.11); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ms = performance.now() - t0;
      best = Math.min(best, ms);
      // a slow GPU has said enough after one run (no long stall at start-up)
      if (ms > 150) break;
    }
    return best / ((PASSES * S * S) / 1e6);
  } catch {
    return null;
  } finally {
    gl.useProgram(prev.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev.fb);
    gl.bindRenderbuffer(gl.RENDERBUFFER, prev.rb);
    gl.bindVertexArray(prev.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, prev.buf);
    gl.viewport(prev.viewport[0], prev.viewport[1], prev.viewport[2], prev.viewport[3]);
    for (const [c, on] of prev.caps) { if (on) gl.enable(c); else gl.disable(c); }
    gl.colorMask(prev.colorMask[0], prev.colorMask[1], prev.colorMask[2], prev.colorMask[3]);
    if (vbo) gl.deleteBuffer(vbo);
    if (vao) gl.deleteVertexArray(vao);
    if (fbo) gl.deleteFramebuffer(fbo);
    if (rbo) gl.deleteRenderbuffer(rbo);
    if (prog) gl.deleteProgram(prog);
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
  }
}

/**
 * The starting preset: software rasterisers → low; otherwise the timed probe ranks the GPU by milliseconds per
 * megapixel of the reference load (≲ 1 ultra · ≲ 4 high · ≲ 18 medium · else low); without a measurement, names and
 * limits decide (integrated / mobile → medium, everything else → high). Cinematic is never picked automatically.
 */
export function detectQuality(gl: WebGL2RenderingContext | null): QualityName {
  if (!gl) return 'low';
  let name = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  } catch { /* privacy-hardened browsers */ }
  GPU_PROBE.renderer = name;
  const pick = (q: QualityName): QualityName => { GPU_PROBE.pick = q; return q; };
  if (/swiftshader|llvmpipe|software|basic render/.test(name)) return pick('low');
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const mobile = /mali|adreno|powervr/.test(name);
  const ms = probeGpu(gl);
  if (ms != null && Number.isFinite(ms)) {
    GPU_PROBE.msPerMP = ms;
    if (ms > 18) return pick('low');
    if (ms > 4 || mobile) return pick('medium');
    if (ms > 1 || maxTex < 16384) return pick('high');
    return pick('ultra');
  }
  if (/intel|mali|adreno|powervr|apple gpu|iris/.test(name)) return pick('medium');
  if (maxTex < 8192) return pick('medium');
  return pick('high');
}
