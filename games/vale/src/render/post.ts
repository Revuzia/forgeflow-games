// VALE render — the post chain (STYLE_BIBLE "Grade": N8AO → bloom (threshold 1.0) → tone map →
// LUT → vignette → overlay → SMAA; tokens.json `grade.passOrder`).
//
//   RenderPass(world)                       HalfFloat buffers, renderer.toneMapping = NoToneMapping
//   N8AOPostPass                            ao 1 = half resolution "Medium", ao 2 = full "High"; off on Low
//   EffectPass(Bloom?, ToneMapping NEUTRAL, LUT3D vale_grade_01, Vignette)
//                                           bloom: mipmap, threshold 1.0, smoothing 0.05, intensity 0.6,
//                                           radius 0.7 (off when video.bloom is false); exposure 1.0;
//                                           tetrahedral LUT on Ultra; vignette offset 0.35 darkness 0.25
//   OverlayPass                             bars, rings, telegraphs, aim — drawn into the GRADED linear
//                                           buffer (no tone map, no LUT), manually depth-tested against
//                                           the scene's stable depth texture, so their hex is the pixel
//   EffectPass(SMAA) | CopyPass             SMAA preset by tier; antialias 'off' ends with a plain copy
//
// The grade (tone map + LUT + vignette) and the overlay are identical on every tier; tiers only
// change AO, bloom, AA and resolution. The identity LUT stands in until `map.art.lut` loads.

import {
  type Camera, Color, HalfFloatType, type Scene, type Texture, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import {
  BloomEffect, CopyPass, EffectComposer, EffectPass, LookupTexture, LUT3DEffect, Pass, RenderPass, SMAAEffect,
  SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export interface PostQuality {
  ao: 0 | 1 | 2;
  bloom: boolean;
  aa: 'off' | 'smaa' | 'msaa';
  tier: 'low' | 'medium' | 'high' | 'ultra';
}

export type OverlayDraw = (renderer: WebGLRenderer, target: WebGLRenderTarget | null, sceneDepth: Texture | null) => void;

/** draws the overlay scene into the graded buffer (no swap); receives the composer's stable depth */
class OverlayPass extends Pass {
  private depth: Texture | null = null;
  constructor(private readonly draw: OverlayDraw) {
    super('OverlayPass');
    this.needsSwap = false;
    this.needsDepthTexture = true;
  }
  override setDepthTexture(depthTexture: Texture): void { this.depth = depthTexture; }
  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    this.draw(renderer, this.renderToScreen ? null : inputBuffer, this.depth);
  }
}

export class PostChain {
  readonly composer: EffectComposer;
  private scene: Scene;
  private camera: Camera;
  private readonly overlay: OverlayPass;
  private lutTex: Texture;
  private readonly identity: LookupTexture;
  private lutEffect: LUT3DEffect | null = null;
  private quality: PostQuality = { ao: 1, bloom: true, aa: 'smaa', tier: 'high' };
  aoPass: N8AOPostPass | null = null;
  private width = 1;
  private height = 1;

  constructor(private readonly renderer: WebGLRenderer, scene: Scene, camera: Camera, overlayDraw: OverlayDraw) {
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, depthBuffer: true, stencilBuffer: false, multisampling: 0 });
    this.overlay = new OverlayPass(overlayDraw);
    this.identity = LookupTexture.createNeutral(33);
    this.lutTex = this.identity;
    this.build();
  }

  setScene(scene: Scene, camera: Camera): void {
    this.scene = scene;
    this.camera = camera;
    this.build();
  }

  /** the locked grade; null = identity until the art lane's .cube exists */
  setLUT(lut: Texture | null): void {
    this.lutTex = lut ?? this.identity;
    if (this.lutEffect) this.lutEffect.lut = this.lutTex;
  }

  setQuality(q: PostQuality): void {
    const same = q.ao === this.quality.ao && q.bloom === this.quality.bloom && q.aa === this.quality.aa && q.tier === this.quality.tier;
    this.quality = { ...q };
    if (!same) this.build();
  }

  setSize(cssWidth: number, cssHeight: number): void {
    this.width = cssWidth; this.height = cssHeight;
    this.composer.setSize(cssWidth, cssHeight, false);
  }

  render(dt: number): void { this.composer.render(dt); }

  private build(): void {
    const c = this.composer;
    c.removeAllPasses();
    const q = this.quality;
    c.addPass(new RenderPass(this.scene, this.camera));
    this.aoPass = null;
    if (q.ao > 0) {
      const ao = new N8AOPostPass(this.scene, this.camera, this.width, this.height);
      ao.autoDetectTransparency = false;
      ao.configuration.transparencyAware = false;
      ao.setQualityMode(q.ao === 2 ? 'High' : 'Medium');
      ao.configuration.halfRes = q.ao === 1;
      ao.configuration.aoRadius = 1.4;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.5;
      ao.configuration.color = new Color().setStyle('#1A1C22');
      ao.configuration.gammaCorrection = false;
      c.addPass(ao);
      this.aoPass = ao;
    }
    const effects = [];
    if (q.bloom) {
      effects.push(new BloomEffect({
        mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.05, intensity: 0.6, radius: 0.7,
        levels: q.tier === 'medium' ? 6 : 8,
      }));
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }));
    this.lutEffect = new LUT3DEffect(this.lutTex, { tetrahedralInterpolation: q.tier === 'ultra' || q.tier === 'high' });
    effects.push(this.lutEffect);
    effects.push(new VignetteEffect({ offset: 0.35, darkness: 0.25 }));
    c.addPass(new EffectPass(this.camera, ...effects));
    c.addPass(this.overlay);
    if (q.aa === 'off') {
      c.addPass(new CopyPass());
    } else {
      const preset = q.tier === 'ultra' ? SMAAPreset.ULTRA : q.tier === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM;
      c.addPass(new EffectPass(this.camera, new SMAAEffect({ preset })));
    }
  }

  dispose(): void { this.composer.dispose(); this.identity.dispose(); }
}
