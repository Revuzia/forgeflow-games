// DYEFIELD — WebGL2 renderer setup (CONTRACT §5.1): antialias, DPR ≤ 1.5, Neutral tone mapping
// (CHANGED(integrator) from AgX, see CONTRACT §5.1), sRGB output,
// PCF shadows, honest per-frame counters (info.autoReset = false; reset once per frame).
// three r186 removed PCFSoftShadowMap (it warns and falls back); PCFShadowMap is the soft PCF path
// (the sun's shadow.radius sets the softness).

import * as THREE from 'three';

export const MAX_DPR = 1.5;

export interface RendererRig {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  /** call once per rendered frame before the first render() */
  beginFrame(): void;
  /** fit the drawing buffer to the canvas' CSS size (DPR-capped); returns true when it changed */
  resize(camera: THREE.PerspectiveCamera): boolean;
  stats(): { calls: number; triangles: number; programs: number; textures: number; geometries: number };
  gpu(): string;
}

/** true when this browser can create a WebGL2 context at all */
export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** tone-mapping operators selectable with the dev query param ?tonemap= (default Neutral, CONTRACT §5.1) */
export const TONE_MAPS: Record<string, THREE.ToneMapping> = {
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  none: THREE.NoToneMapping,
};

export function createRenderer(canvas: HTMLCanvasElement, toneMap: string = 'neutral'): RendererRig {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required (this context is WebGL 1)');
  renderer.setPixelRatio(Math.min(MAX_DPR, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_MAPS[toneMap] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x9cd3ff, 1);

  let lastW = 0, lastH = 0, lastDpr = 0;
  const rig: RendererRig = {
    renderer,
    canvas,
    beginFrame() {
      renderer.info.reset();
    },
    resize(camera) {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(canvas.clientWidth || window.innerWidth));
      const h = Math.max(1, Math.floor(canvas.clientHeight || window.innerHeight));
      if (w === lastW && h === lastH && dpr === lastDpr) return false;
      lastW = w; lastH = h; lastDpr = dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      return true;
    },
    stats() {
      const i = renderer.info;
      return {
        calls: i.render.calls,
        triangles: i.render.triangles,
        programs: i.programs ? i.programs.length : 0,
        textures: i.memory.textures,
        geometries: i.memory.geometries,
      };
    },
    gpu() {
      try {
        const gl = renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      } catch {
        return 'unknown';
      }
    },
  };
  return rig;
}
