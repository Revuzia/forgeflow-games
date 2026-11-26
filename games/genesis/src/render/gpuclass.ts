// GENESIS — what kind of graphics hardware the browser is drawing with, from the unmasked renderer string (LOADTIME
// ledger, task 5). Pure: no DOM, no GL. The page cannot know whether the machine ALSO has a separate graphics card,
// so 'integrated' only ever leads to an "if your computer has one" hint (ui/gpunotice.ts).

export type GpuClass = 'software' | 'integrated' | 'ok' | 'unknown';

/**
 * 'software': the browser draws on the CPU (SwiftShader, llvmpipe, Microsoft Basic Render Driver / WARP) — hardware
 * acceleration is off or the driver is blocked. 'integrated': graphics built into the processor (Intel HD / UHD / Iris,
 * AMD "Radeon(TM) Graphics" / Vega). 'ok': anything else that names a GPU (NVIDIA, AMD RX, Intel Arc, Apple).
 */
export function classifyGpu(renderer: string): GpuClass {
  const s = renderer.toLowerCase();
  if (!s.trim() || s === '?') return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|\bwarp\b/.test(s)) return 'software';
  if (/apple|nvidia|geforce|quadro|\brtx\b|\bgtx\b|\barc\b|radeon (rx|pro|hd [5-9]\d{3}|r[579])|firepro/.test(s)) return 'ok';
  if (/intel|\biris\b|uhd graphics|hd graphics/.test(s)) return 'integrated';
  if (/radeon\(tm\) graphics|radeon graphics|\bvega\b|radeon\(tm\) \d{3}m/.test(s)) return 'integrated';
  return 'unknown';
}

/** the short name inside "ANGLE (Vendor, Name Direct3D11 vs_5_0 ps_5_0, D3D11)" for a sentence */
export function gpuShortName(renderer: string): string {
  const m = /ANGLE \([^,]*,\s*([^,()]+(?:\([^)]*\))?[^,()]*)/.exec(renderer);
  return (m ? m[1] : renderer).replace(/\s*Direct3D.*$/i, '').replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}
