// Screen-space helpers for the ceremonies, drawn last: the single additive LIGHT RAMP of a burst (screen alpha capped at 0.25 by
// the FlashGovernor) and the 120 ms CROSSFADE used by skip() (a snapshot of the last frame fading out over the new one).
import * as THREE from 'three';

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

  /** Grab the framebuffer as it is RIGHT NOW (call right after a render to the screen) and start fading it out. */
  beginCrossfade(renderer: THREE.WebGLRenderer, seconds: number): boolean {
    try {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!this.snapshot || this.snapshot.image.width !== size.x || this.snapshot.image.height !== size.y) {
        this.snapshot?.dispose();
        this.snapshot = new THREE.FramebufferTexture(size.x, size.y);
      }
      renderer.copyFramebufferToTexture(this.snapshot);
      this.fadeMat.uniforms.uTex.value = this.snapshot;
      this.fadeLen = Math.max(0.02, seconds); this.fadeT = this.fadeLen;
      this.fadeMat.uniforms.uAlpha.value = 1; this.fade.visible = true;
      return true;
    } catch { this.fade.visible = false; return false; }
  }

  get crossfading(): boolean { return this.fade.visible; }

  update(dt: number): void {
    if (this.fade.visible) {
      this.fadeT -= dt;
      const a = Math.max(0, this.fadeT / this.fadeLen);
      this.fadeMat.uniforms.uAlpha.value = a;
      if (a <= 0) this.fade.visible = false;
    }
  }

  dispose(): void { this.geo.dispose(); this.lightMat.dispose(); this.fadeMat.dispose(); this.snapshot?.dispose(); }
}
