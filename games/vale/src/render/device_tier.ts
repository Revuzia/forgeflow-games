// VALE render — which quality a device may START at, decided before any heavy work (ruling 67, W4-C "never freeze a
// machine"). Pure (no DOM in classifyDevice), so _harness/probe_device_tier.ts holds it under node.
//
// Why: the owner's tester froze a 16 GB Windows laptop in Chrome. Chrome on Windows draws WebGL through ANGLE on
// Direct3D 11, and most Windows laptops run the browser on the integrated GPU (Intel UHD / Iris Xe, AMD Radeon
// graphics) with shared video memory. The old first run started every such device at High and only stepped down if the
// 3 s Home sample drew >= 30 frames (calibration.ts had a "too few frames keeps High" rule: a stalled machine stayed on
// High). The device's own GPU string, read through WEBGL_debug_renderer_info, now sets a ceiling first:
//
//   software renderer (SwiftShader, llvmpipe, Microsoft Basic Render Driver, a context that fails
//   failIfMajorPerformanceCaveat)                                                        low, and the "this device" plate
//   Intel UHD / HD / other Intel integrated                                               low
//   Intel Iris (Xe, Plus, Pro), Intel Arc integrated ("Arc(TM) Graphics")                 medium
//   AMD integrated (Radeon(TM) Graphics, Vega N, 680M/780M/880M/890M ...)                 medium
//   NVIDIA MX, Qualcomm Adreno / ARM Mali / PowerVR                                       medium / low
//   NVIDIA GeForce / RTX / Quadro, AMD RX / Pro, Intel Arc A/B, Apple                     high (calibration decides)
//   unknown string (masked)                                                               high (calibration decides)
// then the machine:  deviceMemory <= 2 GB or <= 2 cores -> low; <= 4 GB or <= 4 cores -> at most medium;
//                    MAX_TEXTURE_SIZE < 4096 -> low.
// The ceiling only applies to a profile still on the untouched default; any preset the player picks in Settings > Video
// is theirs (a manual override). ?tier=low|medium|high|ultra forces a start tier for QA.

export type StartTier = 'low' | 'medium' | 'high';
export type GpuClass = 'software' | 'integrated' | 'discrete' | 'apple' | 'mobile' | 'unknown';

export interface GpuFacts {
  /** UNMASKED_RENDERER_WEBGL, else RENDERER ('' when nothing could be read) */
  renderer: string;
  vendor: string;
  /** getContext('webgl2', { failIfMajorPerformanceCaveat: true }) returned null while a plain context worked */
  caveat: boolean;
  /** navigator.deviceMemory (GB, Chrome caps it at 8; undefined elsewhere) */
  deviceMemory?: number | undefined;
  /** navigator.hardwareConcurrency */
  cores?: number | undefined;
  maxTextureSize?: number | undefined;
  /** KHR_parallel_shader_compile is offered (programs can compile off the main thread) */
  parallelCompile?: boolean | undefined;
}

export interface DeviceClass {
  gpu: GpuClass;
  /** the highest preset a first run starts at */
  cap: StartTier;
  software: boolean;
  /** the rules that set the cap, for the device report */
  reasons: string[];
}

const ORDER: Record<StartTier, number> = { low: 0, medium: 1, high: 2 };
export const minTier = (a: StartTier, b: StartTier): StartTier => (ORDER[a] <= ORDER[b] ? a : b);

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|microsoft basic|mesa offscreen|gdi generic/i;

/** the GPU's class and the start ceiling it alone gives */
export function gpuClass(renderer: string): { gpu: GpuClass; cap: StartTier; why: string } {
  const r = renderer || '';
  if (!r.trim()) return { gpu: 'unknown', cap: 'high', why: 'no renderer string' };
  if (SOFTWARE.test(r)) return { gpu: 'software', cap: 'low', why: 'software renderer' };
  if (/direct3d9|d3d9/i.test(r)) return { gpu: 'integrated', cap: 'low', why: 'Direct3D 9 driver' };
  if (/apple/i.test(r) && !/intel|amd|radeon|nvidia/i.test(r)) return { gpu: 'apple', cap: 'high', why: 'Apple GPU' };
  if (/nvidia|geforce|quadro|rtx|gtx|tesla/i.test(r)) {
    if (/\bmx\s?\d{3}\b/i.test(r)) return { gpu: 'integrated', cap: 'medium', why: 'NVIDIA MX (entry laptop GPU)' };
    return { gpu: 'discrete', cap: 'high', why: 'NVIDIA GPU' };
  }
  if (/intel/i.test(r)) {
    if (/arc\(tm\)\s*[ab]\d|arc\s+[ab]\d{3}/i.test(r)) return { gpu: 'discrete', cap: 'high', why: 'Intel Arc discrete' };
    if (/iris|arc/i.test(r)) return { gpu: 'integrated', cap: 'medium', why: 'Intel Iris / Arc integrated' };
    return { gpu: 'integrated', cap: 'low', why: 'Intel UHD / HD integrated' };
  }
  if (/amd|radeon|ati\b/i.test(r)) {
    // integrated: "AMD Radeon(TM) Graphics", "Radeon(TM) Vega 8 Graphics", "Radeon 780M", "Radeon(TM) 610M"
    if (/vega\s*\d|\b\d{3}m\b|radeon\(tm\)\s*graphics|radeon graphics|\bradeon\(tm\)\s*r\d\b/i.test(r) && !/\brx\b|pro\s*w|radeon pro/i.test(r)) {
      return { gpu: 'integrated', cap: 'medium', why: 'AMD integrated' };
    }
    return { gpu: 'discrete', cap: 'high', why: 'AMD GPU' };
  }
  if (/adreno|qualcomm|snapdragon/i.test(r)) return { gpu: 'mobile', cap: 'medium', why: 'Qualcomm Adreno' };
  if (/mali|powervr|imagination|vivante|videocore/i.test(r)) return { gpu: 'mobile', cap: 'low', why: 'mobile GPU' };
  return { gpu: 'unknown', cap: 'high', why: 'unrecognised GPU' };
}

export function classifyDevice(f: GpuFacts): DeviceClass {
  const g = gpuClass(f.renderer);
  const reasons = [g.why];
  let cap = g.cap;
  let software = g.gpu === 'software';
  if (f.caveat && !software) { software = true; cap = 'low'; reasons.push('major performance caveat (no GPU acceleration)'); }
  const mem = f.deviceMemory, cores = f.cores;
  if (typeof mem === 'number' && mem > 0) {
    if (mem <= 2) { cap = 'low'; reasons.push(`deviceMemory ${mem} GB`); }
    else if (mem <= 4 && cap !== 'low') { cap = minTier(cap, 'medium'); reasons.push(`deviceMemory ${mem} GB`); }
  }
  if (typeof cores === 'number' && cores > 0) {
    if (cores <= 2) { cap = 'low'; reasons.push(`${cores} cores`); }
    else if (cores <= 4 && cap !== 'low') { cap = minTier(cap, 'medium'); reasons.push(`${cores} cores`); }
  }
  if (typeof f.maxTextureSize === 'number' && f.maxTextureSize > 0 && f.maxTextureSize < 4096) { cap = 'low'; reasons.push(`MAX_TEXTURE_SIZE ${f.maxTextureSize}`); }
  return { gpu: software ? 'software' : g.gpu, cap, software, reasons };
}

/**
 * ruling 67: the largest texture edge a tier uploads from a model (GLB images; tiling ground textures too). High and
 * Ultra are unchanged (0 = no cap, the live look). A 2048² RGBA8 image with mips is 22 MB of GPU memory; 1024² is 5.6 MB.
 */
export const TEXTURE_CAP: Record<'low' | 'medium' | 'high' | 'ultra', number> = { low: 512, medium: 1024, high: 0, ultra: 0 };

/** the browser's facts (call in a page only; never throws). One throwaway WebGL2 context, released at once. */
export function readGpuFacts(): GpuFacts {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number };
  const out: GpuFacts = { renderer: '', vendor: '', caveat: false, deviceMemory: nav.deviceMemory, cores: nav.hardwareConcurrency };
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false, powerPreference: 'high-performance' } as WebGLContextAttributes) as WebGL2RenderingContext | null;
    if (!gl) return out;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number } | null;
    out.renderer = String((dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null) ?? gl.getParameter(gl.RENDERER) ?? '');
    out.vendor = String((dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null) ?? gl.getParameter(gl.VENDOR) ?? '');
    out.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || undefined;
    out.parallelCompile = !!gl.getExtension('KHR_parallel_shader_compile');
    (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    try {
      const c2 = document.createElement('canvas');
      const strict = c2.getContext('webgl2', { failIfMajorPerformanceCaveat: true } as WebGLContextAttributes) as WebGL2RenderingContext | null;
      out.caveat = !strict;
      (strict?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    } catch { /* no verdict */ }
  } catch { /* nothing readable */ }
  return out;
}
