"""Fill lane: engine.setRenderScale takes the free path, and the controller ships ON.

See `_harness/_subrect.py` for the post-chain half. Here:

  * `setRenderScale(v)` for any v AT OR BELOW the tier scale is now a pure
    `post.setRenderFraction(v / tierScale)`: two numbers and a boolean, no
    target allocated, no `renderer.setSize`, no stall. Above the tier (a
    quality change, the perf gate's native-1.0 INFO pass) it still takes the
    old reallocating path, because that genuinely needs bigger buffers.
  * The dynamic controller therefore defaults ON, and moves within
    [tier - RENDER_SCALE_BAND, tier] rather than +/- the band. `?autoscale=0`
    turns it off.
"""
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'runtime', 'core', 'engine.js')
s = io.open(P, encoding='utf-8').read()

# ------------------------------------------------------------------ 1. setter
old = """  setRenderScale(v) {
    const next = clamp(numOr(v, this.renderScale), MIN_RENDER_SCALE, 1);
    if (Math.abs(next - this.renderScale) < 0.004) return this;
    this.renderScale = next;
    this.renderer.setPixelRatio(this._pr * next);
    this.renderer.setSize(this.size.w, this.size.h, true);
    if (this.post) this.post.resize(this.size.w, this.size.h);
    this.events.emit('renderscale', next);
    return this;
  }"""
new = """  setRenderScale(v) {
    const next = clamp(numOr(v, this.renderScale), MIN_RENDER_SCALE, 1);
    if (Math.abs(next - this.renderScale) < 0.004) return this;
    this.renderScale = next;
    /* FREE PATH. At or below the tier scale the buffers are already big enough:
     * the SCENE moves into a sub-rectangle of them and one blit brings it back
     * up (Post.setRenderFraction). Nothing is allocated, so a step costs a
     * uniform write instead of the measured 141-646 ms of
     * EffectComposer.setSize() -- which is what made this controller
     * unshippable and what made camcheck's long jump drop a queued input. */
    if (this.post && typeof this.post.setRenderFraction === 'function'
        && next <= this._tierScale + 0.004) {
      this.post.setRenderFraction(next / this._tierScale);
      this.events.emit('renderscale', next);
      return this;
    }
    /* ABOVE the tier: the buffers really do have to grow. Reallocating path,
     * kept for quality changes and for the perf gate's native-1.0 INFO pass. */
    if (this.post && typeof this.post.setRenderFraction === 'function') {
      this.post.setRenderFraction(1);
    }
    this.renderer.setPixelRatio(this._pr * next);
    this.renderer.setSize(this.size.w, this.size.h, true);
    if (this.post) this.post.resize(this.size.w, this.size.h);
    this.events.emit('renderscale', next);
    return this;
  }"""
assert old in s, 'setter'
s = s.replace(old, new, 1)

# --------------------------------------------------------------- 2. band down
old = """    const lo = Math.max(MIN_RENDER_SCALE, this._tierScale - RENDER_SCALE_BAND);
    const hi = Math.min(1, this._tierScale + RENDER_SCALE_BAND);"""
new = """    /* The band runs DOWNWARD from the tier only. Rendering ABOVE the tier would
       mean allocating every composer target larger than the tier needs and
       paying that in the post chain on every frame at the tier value -- the one
       case that has to stay free (see setRenderScale). */
    const lo = Math.max(MIN_RENDER_SCALE, this._tierScale - RENDER_SCALE_BAND);
    const hi = this._tierScale;"""
assert old in s, 'band'
s = s.replace(old, new, 1)

# ------------------------------------------------------------------ 3. default
old = """    this.renderScaleAuto = /[?&]autoscale=1/.test(
      typeof location !== 'undefined' && location.search ? location.search : '');"""
new = """    this.renderScaleAuto = !/[?&]autoscale=0/.test(
      typeof location !== 'undefined' && location.search ? location.search : '');"""
assert old in s, 'default'
s = s.replace(old, new, 1)

# ------------------------------------------------------- 4. rewrite the reason
old_a = "     * Let the DYNAMIC controller move the scale."
new_a = ("     * Let the DYNAMIC controller move the scale. DEFAULT ON;\n"
         "     * `?autoscale=0` turns it off. It shipped OFF until 2026-09-03,\n"
         "     * for a measured reason that has now been fixed rather than lived with.")
assert old_a in s, 'reason-a'
s = s.replace(old_a, new_a, 1)

old_b = "     * DEFAULT OFF, and the reason is measured, not preferred. `setRenderScale`"
new_b = "     * `setRenderScale`"
assert old_b in s, 'reason-b'
s = s.replace(old_b, new_b, 1)

# replace the tail of that comment (from "The controller itself" to the "*/")
k = s.index("     * The controller itself is correct and stays here, tuned exactly as")
end = s.index("     */", k)
tail = ("     * The fix the old comment asked for has landed: the composer targets are\n"
        "     * allocated ONCE at the tier's size and the SCENE is rendered into a\n"
        "     * sub-rectangle of them with viewport/scissor, brought back to full size by\n"
        "     * one blit whose sampling UVs are scaled to match\n"
        "     * (`Post.setRenderFraction`, `_harness/_subrect.py`). A step is now a\n"
        "     * uniform write, so the controller ships on. The band runs from the tier\n"
        "     * DOWNWARD only: above the tier the buffers really would have to grow, and\n"
        "     * that case still takes the old reallocating path.\n")
s = s[:k] + tail + s[end:]

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('engine.js wired')
