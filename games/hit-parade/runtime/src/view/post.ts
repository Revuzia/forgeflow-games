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
//   * CHANGED(fix_view) D5 (CONTRACT §35.23 fix_view) - bloom that never washes a fighter: (1) the toon bodies write alpha 0
//     into the HDR target while `BLOOM_MASK.uMaskOn` is 1 (set around the composer render only); (2) the bloom's
//     high-pass keeps alpha-0 pixels out (a lit body never blooms) and CAPS the luminance of what blooms (`BLOOM.cap`: a
//     floor under a 320-cd spot or a furnace window is not a 5-10x halo) over a soft knee from `BLOOM.threshold`;
//     (3) UnrealBloomPass no longer adds itself over the frame - GradePass composites its result (`tBloom`) weighted
//     by the pixel's alpha, so no glow (furnace / beacon flare, a spot's halo) lands ON a body. Measured: control_room at
//     the desktop default (high + bloom) blew both fighters out orange-white (verifier ver3d_crlight).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Renderer } from './renderer.ts';
import { BLOOM_MASK } from './toon.ts';

/** CHANGED(fix_view) D5: bloom numbers (linear HDR luminance) */
export const BLOOM = { strength: 0.45, radius: 0.5, threshold: 1.0, knee: 0.35, cap: 2.4 };

/** the bloom high-pass: a soft knee from the threshold, the luminance capped, alpha-0 (masked body) pixels excluded */
const HIGH_PASS_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec3 defaultColor;
  uniform float defaultOpacity;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  uniform float uCap;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D( tDiffuse, vUv );
    float v = luminance( texel.xyz );
    float k = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );
    vec3 c = texel.rgb * min( 1.0, uCap / max( v, 1e-4 ) );
    gl_FragColor = vec4( c * ( k * clamp( texel.a, 0.0, 1.0 ) ), 1.0 );
  }
`;

const GradeShader = {
  name: 'HPGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    // CHANGED(fix_view) D5: the bloom result composited here, weighted by the pixel's alpha (bodies: 0)
    tBloom: { value: null as THREE.Texture | null },
    uBloom: { value: 0 },
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
    // P2 PRIME TIME: letterbox bars (fraction of the height per bar) and the name slate (an sRGB canvas texture in a uv rect)
    uLetterbox: { value: 0 },
    tSlate: { value: null as THREE.Texture | null },
    uSlateRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSlateA: { value: 0 },
    // P2 PRIME TIME `freeze_frame`: a TV freeze-frame still (white inset border, a touch desaturated, red REC dot)
    uBorder: { value: 0 },
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
    uniform float uLetterbox; uniform sampler2D tSlate; uniform vec4 uSlateRect; uniform float uSlateA; uniform float uBorder;
    uniform sampler2D tBloom; uniform float uBloom;
    varying vec2 vUv;
    float h11( float n ) { return fract( sin( n * 91.3458 ) * 47453.5453 ); }
    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      if ( uBloom > 0.0 ) c.rgb += texture2D( tBloom, vUv ).rgb * ( uBloom * clamp( c.a, 0.0, 1.0 ) );
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
      if ( uBorder > 0.001 ) {
        float l = dot( c.rgb, vec3( 0.299, 0.587, 0.114 ) );
        c.rgb = mix( c.rgb, vec3( l ) * vec3( 1.04, 1.0, 0.94 ), 0.45 * uBorder );
        vec2 q = abs( vUv - 0.5 ) * vec2( uAspect, 1.0 );
        vec2 lim = vec2( 0.5 * uAspect - 0.035, 0.5 - 0.035 - uLetterbox );
        // a clean inset rectangle: inside the outer rect AND outside the inner one (the old per-axis sum let each line
        // run on past the corners into a '#')
        float outerR = step( q.x, lim.x ) * step( q.y, lim.y );
        float innerR = step( q.x, lim.x - 0.012 ) * step( q.y, lim.y - 0.012 );
        c.rgb = mix( c.rgb, vec3( 1.0 ), clamp( outerR - innerR, 0.0, 1.0 ) * uBorder );
        vec2 dp = ( vUv - vec2( 0.06, 0.86 - uLetterbox ) ) * vec2( uAspect, 1.0 );
        c.rgb = mix( c.rgb, vec3( 1.0, 0.05, 0.05 ), ( 1.0 - smoothstep( 0.012, 0.016, length( dp ) ) ) * uBorder );
      }
      if ( uLetterbox > 0.0005 ) {
        float bar = step( vUv.y, uLetterbox ) + step( 1.0 - uLetterbox, vUv.y );
        c.rgb *= 1.0 - clamp( bar, 0.0, 1.0 );
      }
      if ( uSlateA > 0.001 ) {
        vec2 su = ( vUv - uSlateRect.xy ) / max( uSlateRect.zw, vec2( 1e-4 ) );
        if ( su.x >= 0.0 && su.x <= 1.0 && su.y >= 0.0 && su.y <= 1.0 ) {
          vec4 sl = texture2D( tSlate, su );
          vec3 lin = pow( sl.rgb, vec3( 2.2 ) );
          c.rgb = mix( c.rgb, lin, sl.a * uSlateA );
        }
      }
      // CHANGED(fix_view) D5: the body mask (alpha 0) ends here - SMAA / OutputPass / the canvas get an opaque frame
      gl_FragColor = vec4( c.rgb, 1.0 );
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
  /** CHANGED(fix_view) D5: harness A/B - true = the pre-fix bloom (threshold 0.92, hard knee, no cap, no body mask) */
  legacyBloom = false;

  constructor(r: Renderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.r = r;
    const three = r.three;
    const rt = new THREE.WebGLRenderTarget(r.buffer.x, r.buffer.y, { type: THREE.HalfFloatType, depthBuffer: true });
    rt.texture.name = 'hp-post-rt';
    this.composer = new EffectComposer(three, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(r.buffer.x, r.buffer.y), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.bloom.enabled = false;
    // CHANGED(fix_view) D5: the masked / capped high-pass, and no additive blend of its own (GradePass composites tBloom)
    {
      const hp = this.bloom.materialHighPassFilter;
      const hu = this.bloom.highPassUniforms as unknown as Record<string, THREE.IUniform>;
      hu.uCap = { value: BLOOM.cap };
      hu.smoothWidth.value = BLOOM.knee;
      hp.uniforms = hu;
      hp.fragmentShader = HIGH_PASS_FRAG;
      hp.needsUpdate = true;
      this.bloom.blendMaterial.visible = false;
    }
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.tBloom.value = (this.bloom as unknown as { renderTargetsHorizontal: THREE.WebGLRenderTarget[] }).renderTargetsHorizontal[0].texture;
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

  /** P2 PRIME TIME freeze-frame border (0..1) */
  setBorder(a: number): void { this.grade.uniforms.uBorder.value = Math.max(0, Math.min(1, a)); }

  /** P2 PRIME TIME letterbox: bar height as a fraction of the frame (0 = off) */
  setLetterbox(f: number): void { this.grade.uniforms.uLetterbox.value = Math.max(0, Math.min(0.2, f)); }

  /** P2 PRIME TIME name slate: an sRGB texture shown in uv rect (x0, y0 from the bottom-left, w, h) at alpha `a` */
  setSlate(tex: THREE.Texture | null, x: number, y: number, w: number, h: number, a: number): void {
    const u = this.grade.uniforms;
    if (tex) u.tSlate.value = tex;
    (u.uSlateRect.value as THREE.Vector4).set(x, y, w, h);
    u.uSlateA.value = tex || u.tSlate.value ? Math.max(0, Math.min(1, a)) : 0;
  }
  setGain(g: number): void { this.grade.uniforms.uGain.value = g; }

  render(dt = 1 / 60): void {
    this.sync();
    if (!this.enabled) {
      this.r.three.setRenderTarget(null);
      this.r.three.render(this.renderPass.scene, this.renderPass.camera);
      return;
    }
    // CHANGED(fix_view) D5: bodies write alpha 0 (the bloom mask) only inside this composer render
    this.grade.uniforms.uBloom.value = this.bloom.enabled ? 1 : 0;
    const hu = this.bloom.highPassUniforms as unknown as Record<string, THREE.IUniform>;
    const legacy = this.legacyBloom;
    this.bloom.threshold = legacy ? 0.92 : BLOOM.threshold;
    hu.smoothWidth.value = legacy ? 0.01 : BLOOM.knee;
    hu.uCap.value = legacy ? 1e6 : BLOOM.cap;
    BLOOM_MASK.uMaskOn.value = legacy ? 0 : 1;
    try { this.composer.render(dt); } finally { BLOOM_MASK.uMaskOn.value = 0; }
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
    this.smaa.dispose();
    this.grade.dispose();
    this.output.dispose();
  }
}
