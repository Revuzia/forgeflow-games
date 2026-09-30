// HIT PARADE - post chain (CONTRACT §7): RenderPass -> [UnrealBloomPass] -> GradePass -> SMAAPass -> OutputPass.
//
//   * The composer's targets are HalfFloat with NO samples (EffectComposer.js creates them without `samples`), so the
//     canvas' MSAA would be lost anyway (TECH_REUSE E36): AA is SMAAPass, which "operates in linear-srgb so this pass
//     must be executed before OutputPass" (its own doc). OutputPass applies the renderer's tone mapping + sRGB.
//   * Bloom is optional (quality 'high' AND the setting); toggling only flips `enabled` - no pass is added or
//     removed after warm-up, so no program links mid-bout.
//   * GradePass (one full-screen pass, linear HDR): screen flash (counter / parry / super / KO; reduceFlashing caps it),
//     a vignette, and procedural manga SPEED LINES / FINISH-ZOOM lines around a screen point (fx.ts drives them).
//     The background dim of a super freeze is NOT here: fx.ts dims with an in-scene plane behind the fighters so the
//     fighters stay lit (a post pass cannot tell them from the set without a depth / mask pass).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Renderer } from './renderer.ts';

const GradeShader = {
  name: 'HPGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uFlash: { value: 0 },
    uVignette: { value: 0.28 },
    uLines: { value: 0 },
    uLinesCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uLinesColor: { value: new THREE.Color(1, 1, 1) },
    uLinesInner: { value: 0.22 },
    uLinesSeed: { value: 0 },
    uAspect: { value: 16 / 9 },
    uGain: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uFlashColor; uniform float uFlash; uniform float uVignette;
    uniform float uLines; uniform vec2 uLinesCenter; uniform vec3 uLinesColor; uniform float uLinesInner;
    uniform float uLinesSeed; uniform float uAspect; uniform float uGain;
    varying vec2 vUv;
    float h11( float n ) { return fract( sin( n * 91.3458 ) * 47453.5453 ); }
    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      c.rgb *= uGain;
      vec2 p = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
      float vig = 1.0 - uVignette * smoothstep( 0.35, 1.05, length( p ) );
      c.rgb *= vig;
      if ( uLines > 0.001 ) {
        vec2 d = ( vUv - uLinesCenter ) * vec2( uAspect, 1.0 );
        float r = length( d );
        float a = atan( d.y, d.x );
        float N = 180.0;
        float cell = floor( ( a + 3.14159265 ) / 6.2831853 * N );
        float rnd = h11( cell + uLinesSeed * 13.0 );
        float wid = 0.18 + 0.5 * h11( cell * 1.7 + uLinesSeed );
        float f = fract( ( a + 3.14159265 ) / 6.2831853 * N );
        float lineMask = step( 0.58, rnd ) * ( 1.0 - smoothstep( wid * 0.5, wid * 0.5 + 0.12, abs( f - 0.5 ) ) );
        float inner = uLinesInner * ( 0.75 + 0.5 * h11( cell * 3.1 + uLinesSeed * 5.0 ) );
        float radial = smoothstep( inner, inner + 0.25, r );
        c.rgb = mix( c.rgb, uLinesColor, clamp( lineMask * radial * uLines, 0.0, 1.0 ) );
      }
      c.rgb = mix( c.rgb, uFlashColor, clamp( uFlash, 0.0, 1.0 ) );
      gl_FragColor = c;
    }
  `,
};

export class Post {
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  readonly smaa: SMAAPass;
  readonly output: OutputPass;
  private readonly r: Renderer;
  private sizeVersion = -1;
  /** false = render straight to the canvas (debug `?post=0`) */
  enabled = true;
  reduceFlashing = false;

  constructor(r: Renderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.r = r;
    const three = r.three;
    const rt = new THREE.WebGLRenderTarget(r.buffer.x, r.buffer.y, { type: THREE.HalfFloatType, depthBuffer: true });
    rt.texture.name = 'hp-post-rt';
    this.composer = new EffectComposer(three, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(r.buffer.x, r.buffer.y), 0.45, 0.5, 0.92);
    this.bloom.enabled = false;
    this.grade = new ShaderPass(GradeShader);
    this.smaa = new SMAAPass();
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.smaa);
    this.composer.addPass(this.output);
    this.sync();
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  setBloom(on: boolean): void { this.bloom.enabled = on && this.r.bloomAllowed(); }

  /** resize the composer when the renderer's drawing buffer changed */
  sync(): void {
    if (this.sizeVersion === this.r.sizeVersion) return;
    this.sizeVersion = this.r.sizeVersion;
    this.composer.setPixelRatio(this.r.three.getPixelRatio());
    this.composer.setSize(this.r.css.x, this.r.css.y);
    this.grade.uniforms.uAspect.value = this.r.css.x / Math.max(1, this.r.css.y);
  }

  /** screen flash 0..1 toward a colour (reduceFlashing caps it at 0.25) */
  setFlash(amount: number, color?: THREE.ColorRepresentation): void {
    const a = this.reduceFlashing ? Math.min(0.25, amount) : amount;
    this.grade.uniforms.uFlash.value = Math.max(0, a);
    if (color !== undefined) (this.grade.uniforms.uFlashColor.value as THREE.Color).set(color);
  }

  /** speed / finish-zoom lines around a screen point (uv 0..1, y up) */
  setLines(amount: number, cx = 0.5, cy = 0.5, color: THREE.ColorRepresentation = 0xffffff, inner = 0.22, seed = 0): void {
    const u = this.grade.uniforms;
    u.uLines.value = Math.max(0, amount);
    (u.uLinesCenter.value as THREE.Vector2).set(cx, cy);
    (u.uLinesColor.value as THREE.Color).set(color);
    u.uLinesInner.value = inner;
    u.uLinesSeed.value = seed;
  }

  setVignette(v: number): void { this.grade.uniforms.uVignette.value = v; }
  setGain(g: number): void { this.grade.uniforms.uGain.value = g; }

  render(dt = 1 / 60): void {
    this.sync();
    if (!this.enabled) {
      this.r.three.setRenderTarget(null);
      this.r.three.render(this.renderPass.scene, this.renderPass.camera);
      return;
    }
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
    this.smaa.dispose();
    this.grade.dispose();
    this.output.dispose();
  }
}
