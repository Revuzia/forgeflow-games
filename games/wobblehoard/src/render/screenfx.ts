// Screen-space helpers for the ceremonies, drawn last: the single additive LIGHT RAMP of a burst (screen alpha capped at 0.25 by
// the FlashGovernor) and the 120 ms CROSSFADE used by skip() (a snapshot of the last frame fading out over the new one).
import * as THREE from 'three';
import { FLASH_ATTACK_S, FLASH_DECAY_S, rampEnvelope } from './flash.ts';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const LIGHT_FRAG = /* glsl */`
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  // a soft vignette-shaped wash: brighter toward the centre of the frame, so the burst reads as light from the body, not a white-out
  vec2 p = vUv * 2.0 - 1.0;
  float k = 0.55 + 0.45 * (1.0 - smoothstep(0.0, 1.4, length(p)));
  gl_FragColor = vec4(uColor * uAlpha * k, 1.0);
}
`;
const FADE_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
void main() { gl_FragColor = vec4(texture2D(uTex, vUv).rgb, uAlpha); }
`;

export class ScreenFx {
  readonly light: THREE.Mesh;
  readonly fade: THREE.Mesh;
  private readonly geo = new THREE.PlaneGeometry(2, 2);
  private readonly lightMat: THREE.ShaderMaterial;
  private readonly fadeMat: THREE.ShaderMaterial;
  private snapshot: THREE.FramebufferTexture | null = null;
  private fadeT = 0;
  private fadeLen = 0.12;
  /** 'linear' (the plain 120 ms skip) or 'decay' (a skip inside a burst: the snapshot fades like the burst light, (1 - t)^2). */
  private fadeShape: 'linear' | 'decay' = 'linear';
  // the ONE light ramp of a burst runs here, on its own clock, so a skip, an abort or the next ceremony never cuts its 400 ms decay short
  private rampAge = -1;
  private rampAmp = 0;
  private readonly rampCol = new THREE.Color();
  /** Current additive screen alpha (for the probe). */
  lightAlpha = 0;

  constructor() {
    this.lightMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: LIGHT_FRAG, uniforms: { uColor: { value: new THREE.Color(1, 0.8, 0.5) }, uAlpha: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    });
    this.light = new THREE.Mesh(this.geo, this.lightMat);
    this.light.renderOrder = 1000; this.light.frustumCulled = false; this.light.visible = false;
    this.fadeMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FADE_FRAG, uniforms: { uTex: { value: null }, uAlpha: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending, toneMapped: false, fog: false,
    });
    this.fade = new THREE.Mesh(this.geo, this.fadeMat);
    this.fade.renderOrder = 1001; this.fade.frustumCulled = false; this.fade.visible = false;
  }

  /** Display-space colour (0..1) and alpha of the additive ramp. alpha 0 hides it. */
  setLight(r: number, g: number, b: number, alpha: number): void {
    this.lightAlpha = alpha;
    this.lightMat.uniforms.uColor.value.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    this.lightMat.uniforms.uAlpha.value = alpha;
    this.light.visible = alpha > 0.002;
  }

  /** Start the burst's light ramp (attack 80 ms, decay 400 ms): `alpha` is what the FlashGovernor granted; display-space colour. */
  startRamp(alpha: number, r: number, g: number, b: number): void {
    this.rampAge = 0; this.rampAmp = alpha; this.rampCol.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    this.setLight(r, g, b, 0);
  }
  /** Cut the ramp (calm switched on, dispose). */
  stopRamp(): void { this.rampAge = -1; this.setLight(0, 0, 0, 0); }
  get ramping(): boolean { return this.rampAge >= 0; }

  /** Grab the framebuffer as it is RIGHT NOW (call right after a render to the screen) and start fading it out. */
  beginCrossfade(renderer: THREE.WebGLRenderer, seconds: number, shape: 'linear' | 'decay' = 'linear'): boolean {
    try {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!this.snapshot || this.snapshot.image.width !== size.x || this.snapshot.image.height !== size.y) {
        this.snapshot?.dispose();
        this.snapshot = new THREE.FramebufferTexture(size.x, size.y);
      }
      renderer.copyFramebufferToTexture(this.snapshot);
      this.fadeMat.uniforms.uTex.value = this.snapshot;
      this.fadeLen = Math.max(0.02, seconds); this.fadeT = this.fadeLen; this.fadeShape = shape;
      this.fadeMat.uniforms.uAlpha.value = 1; this.fade.visible = true;
      return true;
    } catch { this.fade.visible = false; return false; }
  }

  get crossfading(): boolean { return this.fade.visible; }

  update(dt: number): void {
    if (this.fade.visible) {
      this.fadeT -= dt;
      const lin = Math.max(0, this.fadeT / this.fadeLen);
      this.fadeMat.uniforms.uAlpha.value = this.fadeShape === 'decay' ? lin * lin : lin;
      if (lin <= 0) this.fade.visible = false;
    }
    if (this.rampAge >= 0) {
      this.rampAge += dt;
      if (this.rampAge >= FLASH_ATTACK_S + FLASH_DECAY_S) this.stopRamp();
      else { const c = this.rampCol; this.setLight(c.r, c.g, c.b, this.rampAmp * rampEnvelope(this.rampAge)); }
    }
  }

  dispose(): void { this.geo.dispose(); this.lightMat.dispose(); this.fadeMat.dispose(); this.snapshot?.dispose(); }
}
