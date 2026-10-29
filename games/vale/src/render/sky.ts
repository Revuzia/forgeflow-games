// VALE render — sky: the map's equirect HDR → PMREM environment (IBL) + scene background
// (CONTRACT §9 "Sky"; STYLE_BIBLE "Look rules": Multiple Scattering bakes, sun disc off).
//
// The HDR is the only ambient light: `map.art.lighting.ambient` sets scene.environmentIntensity.
// While the sky loads (or when the art lane has not exported it yet) a small procedural gradient
// stands in (cool zenith, warm haze at the horizon, in the map's sun colour), so the world is never
// lit by black. No camera-distance fog: the background is a plain equirect.
// perf PERF-m4: the PMREM environment is drawn on the GPU, so a lost-and-restored WebGL context would come back with an
// empty one (the world lit by nothing but the sun): each Sky bakes its last sky again when the context returns (after
// three's own handler, registered first, rebuilt the renderer's state).

import {
  type Color, DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, LinearSRGBColorSpace,
  PMREMGenerator, RGBAFormat, type Scene, type Texture, Vector3, type WebGLRenderer,
} from 'three';

export class Sky {
  private readonly renderer: WebGLRenderer;
  private envRT: ReturnType<PMREMGenerator['fromEquirectangular']> | null = null;
  private background: Texture | null = null;
  private fallback: DataTexture | null = null;
  /** r12 B4: draw no sky box, clear to this colour instead (the lane camera never sees the horizon: measured 0 px of
   *  sky at every map's edges and corners at the widest zoom); the HDR still lights the world. null = the sky box */
  solid: Color | null = null;
  /** the last apply(), baked again on a restored context */
  private last: { scene: Scene; hdr: Texture | null; env: number; bg: number } | null = null;
  private readonly onRestored = (): void => {
    const l = this.last;
    // the old target's GL objects died with the context: drop it undisposed (its dispose would ask the restored context
    // to delete objects it never had, a warning per object)
    this.envRT = null;
    if (l) this.apply(l.scene, l.hdr, l.env, l.bg);
  };

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    renderer.domElement.addEventListener('webglcontextrestored', this.onRestored, false);
  }

  /** a soft procedural sky in the sun's direction and colour (used until / unless the HDR exists) */
  makeFallback(sunDir: readonly [number, number, number], sunColor: Color, zenith: Color, horizon: Color): DataTexture {
    const W = 128, H = 64;
    const data = new Float32Array(W * H * 4);
    const sd = new Vector3(sunDir[0], sunDir[1], sunDir[2]).normalize();
    const d = new Vector3();
    for (let j = 0; j < H; j++) {
      const v = (j + 0.5) / H;                 // 0 = top row in flipY=false data → we write bottom-up
      const phi = (1 - v) * Math.PI;           // 0 at zenith
      for (let i = 0; i < W; i++) {
        const u = (i + 0.5) / W;
        const theta = u * Math.PI * 2 - Math.PI;
        d.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta));
        const up = Math.max(0, d.y);
        const t = Math.pow(1 - up, 3);
        let r = zenith.r + (horizon.r - zenith.r) * t;
        let g = zenith.g + (horizon.g - zenith.g) * t;
        let b = zenith.b + (horizon.b - zenith.b) * t;
        if (d.y < 0) { const k = 0.55 + 0.45 * (1 + d.y); r *= k * 0.8; g *= k * 0.8; b *= k * 0.78; }
        const s = Math.max(0, d.dot(sd));
        const glow = Math.pow(s, 24) * 2.0 + Math.pow(s, 4) * 0.35;
        r += sunColor.r * glow; g += sunColor.g * glow; b += sunColor.b * glow;
        const o = (j * W + i) * 4;
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 1;
      }
    }
    const tex = new DataTexture(data, W, H, RGBAFormat, FloatType);
    tex.colorSpace = LinearSRGBColorSpace;
    tex.mapping = EquirectangularReflectionMapping;
    tex.magFilter = LinearFilter; tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.fallback?.dispose();
    this.fallback = tex;
    return tex;
  }

  /** set (or replace) the sky; `hdr` null keeps the fallback */
  apply(scene: Scene, hdr: Texture | null, envIntensity: number, backgroundIntensity = 1): void {
    const src = hdr ?? this.fallback;
    if (!src) return;
    this.last = { scene, hdr, env: envIntensity, bg: backgroundIntensity };
    src.mapping = EquirectangularReflectionMapping;
    // r12 B4: a generator per bake, disposed right after: its two programs (equirect → cube UV, GGX convolution)
    // are released instead of staying live for the whole match
    const pmrem = new PMREMGenerator(this.renderer);
    const rt = pmrem.fromEquirectangular(src);
    pmrem.dispose();
    this.envRT?.dispose();
    this.envRT = rt;
    this.background = src;
    scene.environment = rt.texture;
    scene.environmentIntensity = envIntensity;
    scene.background = this.solid ?? src;
    scene.backgroundIntensity = backgroundIntensity;
    scene.backgroundBlurriness = 0;
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onRestored, false);
    this.last = null;
    this.envRT?.dispose();
    this.fallback?.dispose();
    this.envRT = null; this.background = null; this.fallback = null;
  }
}
