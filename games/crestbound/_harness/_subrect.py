"""Fill lane: make a render-scale change cost NOTHING.

engine.js shipped the dynamic render-scale controller DEFAULT OFF, with the
reason written down: `setRenderScale` had to call `renderer.setSize` and
`Post.resize`, `EffectComposer.setSize()` reallocates every target it owns
(two ping-pong RGBA16F targets plus the bloom mip chain plus the AA pass), and
one step measured 141 / 151 / 179 / 179 / 646 ms on the reference machine -
long enough to swallow a queued input, which is how camcheck's long jump failed
with the controller on and passed with it off.

The fix is the standard dynamic-resolution technique, and it is what the
engine.js comment already asked for: allocate every target ONCE at the tier's
size and render the SCENE into a sub-rectangle of it, then bring it back up to
the target's full size with one blit whose sampling UVs are scaled to match.
Concretely:

  * `ScaledRenderPass` sets `readBuffer.viewport` / `.scissor` to the sub-rect
    (and `scissorTest`, so the clear does not touch the rest of the target)
    around the scene render, and restores them straight afterwards - every
    later pass still writes the target at its full size.
  * `UpscalePass` is a one-draw ShaderPass that samples that sub-rect with
    `vUv * uFrac`, inset by half a texel so bilinear filtering never reaches
    into the stale region outside it, and writes the full-size buffer. It is
    DISABLED at fraction 1, so the shipping default pays exactly what it paid
    before.
  * `Post.setRenderFraction(f)` therefore writes two numbers and one boolean.
    No target is allocated, nothing is disposed, and the stall is gone.

Direction: the fraction is <= 1 by construction, so the controller moves the
scale DOWN from the tier and back up to it, never above it - going above would
mean allocating every target larger than the tier needs and paying that in the
post chain on every frame at the tier value, which is the case that has to stay
free. A scale ABOVE the tier (the harness's native-1.0 INFO pass, a quality
change) still takes the old reallocating path in engine.js.
"""
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'runtime', 'fx', 'post.js')
s = io.open(P, encoding='utf-8').read()

# ---------------------------------------------------------------- 1. classes
anchor = "class FXAAPass extends ShaderPass {"
assert anchor in s, 'anchor'
klass = '''/* ==========================================================================
 * DYNAMIC RESOLUTION - sub-rectangle rendering (see _harness/_subrect.py)
 * ======================================================================== */

/**
 * RenderPass that draws the scene into the bottom-left `frac x frac` corner of
 * the buffer instead of all of it. `frac === 1` is byte-for-byte the stock
 * behaviour: no viewport is touched and no scissor is enabled.
 */
class ScaledRenderPass extends RenderPass {
  constructor(scene, camera) {
    super(scene, camera);
    /** fraction of the buffer the scene is rendered into, 0..1 */
    this.frac = 1;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const t = this.renderToScreen ? null : readBuffer;
    const f = this.frac;
    if (t && f < 0.999) {
      const w = Math.max(2, Math.round(t.width * f));
      const h = Math.max(2, Math.round(t.height * f));
      t.viewport.set(0, 0, w, h);
      t.scissor.set(0, 0, w, h);
      t.scissorTest = true;
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      t.viewport.set(0, 0, t.width, t.height);
      t.scissor.set(0, 0, t.width, t.height);
      t.scissorTest = false;
      return;
    }
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

const UpscaleShader = {
  name: 'CrestboundUpscale',
  uniforms: {
    tDiffuse: { value: null },
    /** x,y = the sub-rect as a fraction of the buffer; z,w = half a texel */
    uRect: { value: new THREE.Vector4(1, 1, 0, 0) },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform vec4 uRect;
varying vec2 vUv;
void main() {
  // map 0..1 onto the sub-rect's TEXEL CENTRES: sampling the outer edge would
  // let the bilinear tap reach the stale pixels outside the rendered region.
  vec2 st = vUv * ( uRect.xy - uRect.zw * 2.0 ) + uRect.zw;
  gl_FragColor = texture2D( tDiffuse, st );
}`,
};

/** One full-screen blit that brings the sub-rect back to full buffer size. */
class UpscalePass extends ShaderPass {
  constructor() {
    super(UpscaleShader);
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.toneMapped = false;
    this.enabled = false;
    this._w = 2;
    this._h = 2;
  }

  setBufferSize(w, h) {
    this._w = Math.max(2, Math.round(w));
    this._h = Math.max(2, Math.round(h));
  }

  /** @param {number} f 0..1 */
  setFraction(f) {
    const frac = clamp(numOr(f, 1), 0.1, 1);
    const w = Math.max(2, Math.round(this._w * frac));
    const h = Math.max(2, Math.round(this._h * frac));
    this.uniforms.uRect.value.set(w / this._w, h / this._h,
                                  0.5 / this._w, 0.5 / this._h);
    this.enabled = frac < 0.999;
  }
}

'''
s = s.replace(anchor, klass + anchor, 1)

# ---------------------------------------------------------------- 2. _build
old = """    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);"""
new = """    this.renderPass = new ScaledRenderPass(this.scene, this.camera);
    this.renderPass.frac = this._frac;
    composer.addPass(this.renderPass);

    // 1.2 - dynamic resolution: bring the scene's sub-rect back to full buffer
    //       size. Disabled (zero draws) whenever the fraction is 1, which is
    //       every frame the dynamic controller has not stepped down.
    this.upscalePass = new UpscalePass();
    this.upscalePass.setBufferSize(w * pr, h * pr);
    this.upscalePass.setFraction(this._frac);
    composer.addPass(this.upscalePass);"""
assert old in s, 'build'
s = s.replace(old, new, 1)

# ---------------------------------------------------------------- 3. fields
old = """    /** @type {FinishPass|null} */      this.finishPass = null;"""
new = """    /** @type {UpscalePass|null} */     this.upscalePass = null;
    /** @type {FinishPass|null} */      this.finishPass = null;"""
assert old in s, 'field'
s = s.replace(old, new, 1)

old = """    this.time = 0;
    this._pulseAmt = 0;"""
new = """    /** fraction of the composer buffer the SCENE is rendered into (0.1..1) */
    this._frac = 1;
    this.time = 0;
    this._pulseAmt = 0;"""
assert old in s, 'frac field'
s = s.replace(old, new, 1)

# ---------------------------------------------------------------- 4. teardown
old = """    this.composer = null;
    this.renderPass = null;
    this.aoPass = null;"""
new = """    this.composer = null;
    this.renderPass = null;
    this.upscalePass = null;
    this.aoPass = null;"""
assert old in s, 'teardown'
s = s.replace(old, new, 1)

# ---------------------------------------------------------------- 5. resize
old = """    if (this.finishPass) this.finishPass.setResolution(this.width * pr, this.height * pr);
    if (this.fxaaPass) this.fxaaPass.setResolution(this.width * pr, this.height * pr);
  }"""
new = """    if (this.finishPass) this.finishPass.setResolution(this.width * pr, this.height * pr);
    if (this.fxaaPass) this.fxaaPass.setResolution(this.width * pr, this.height * pr);
    if (this.upscalePass) {
      this.upscalePass.setBufferSize(this.width * pr, this.height * pr);
      this.upscalePass.setFraction(this._frac);
    }
  }

  /**
   * DYNAMIC RESOLUTION. `f` is the fraction of the composer's buffer the SCENE
   * is rendered into; the post chain always runs at full buffer size, so the
   * grade, the bloom and the AA never change resolution underneath the player.
   *
   * This allocates nothing and disposes nothing - that is the whole point. See
   * `_harness/_subrect.py` and `Engine.setRenderScale`.
   *
   * @param {number} f 0.1..1
   * @returns {number} the fraction actually in effect
   */
  setRenderFraction(f) {
    const frac = clamp(numOr(f, 1), 0.1, 1);
    this._frac = frac;
    if (this.renderPass) this.renderPass.frac = frac;
    if (this.upscalePass) this.upscalePass.setFraction(frac);
    return frac;
  }

  /** the fraction of the buffer the scene is currently rendered into */
  get renderFraction() { return this._frac; }"""
assert old in s, 'resize'
s = s.replace(old, new, 1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('post.js sub-rect wired')
