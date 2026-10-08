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
  lightBudget: 8, ssao: false, dof: false,
};

export const QUALITY: Record<QualityName, Quality> = {
  low: { ...BASE, name: 'low', renderScale: 0.75, maxDpr: 1, terrainPixelError: 14, patchBudget: 8, shadowCascades: 0, shadowMapSize: 1024, atmoSteps: 10, cloudSteps: 24, cloudLightSteps: 3, cloudScale: 0.25, bloom: 0.035, godRays: false, flare: 0.6, grain: 0.015, vegetationDensity: 0.35, vegetationRange: 0.5, grass: false, particleBudget: 4000, lightBudget: 2 },
  medium: { ...BASE, name: 'medium', renderScale: 0.9, maxDpr: 1.25, terrainPixelError: 9, patchBudget: 12, shadowCascades: 2, shadowMapSize: 2048, atmoSteps: 12, cloudSteps: 32, cloudLightSteps: 4, cloudScale: 0.35, vegetationDensity: 0.65, vegetationRange: 0.75, particleBudget: 10000, lightBudget: 4 },
  high: { ...BASE, name: 'high' },
  ultra: { ...BASE, name: 'ultra', maxDpr: 2, msaa: 4, terrainPixelError: 4, patchBudget: 24, shadowCascades: 4, shadowMapSize: 4096, shadowDistance: 4500, atmoSteps: 24, cloudSteps: 72, cloudLightSteps: 6, cloudScale: 0.5, vegetationDensity: 1.3, vegetationRange: 1.4, particleBudget: 40000, lightBudget: 12, ssao: true },
  cinematic: { ...BASE, name: 'cinematic', maxDpr: 2, msaa: 4, terrainPixelError: 3, patchBudget: 48, shadowCascades: 4, shadowMapSize: 4096, shadowDistance: 6000, atmoSteps: 32, cloudSteps: 128, cloudLightSteps: 8, cloudScale: 1, vegetationDensity: 1.6, vegetationRange: 2, particleBudget: 80000, lightBudget: 16, ssao: true, dof: true },
};

export function isQualityName(s: string | null | undefined): s is QualityName {
  return !!s && (QUALITY_NAMES as string[]).includes(s);
}

/** quick probe: software rasterisers → low; integrated / mobile GPUs → medium; everything else → high */
export function detectQuality(gl: WebGL2RenderingContext | null): QualityName {
  if (!gl) return 'low';
  let name = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  } catch { /* privacy-hardened browsers */ }
  if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'low';
  if (/intel|mali|adreno|powervr|apple gpu|iris/.test(name)) return 'medium';
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (maxTex < 8192) return 'medium';
  return 'high';
}
