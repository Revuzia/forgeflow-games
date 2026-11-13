"""Fill lane: track WHAT SIZE the buffers are actually allocated at.

The free path in `setRenderScale` divides by the TIER scale, which is only the
right divisor while the buffers are still allocated at the tier. The perf
gate's native-1.0 INFO pass reallocates them UP to 1.0 and then asks for the
tier value back; without this, that second call would take the free path, leave
the buffers at native, and every later sample would run its whole post chain at
1920x1080 while reporting the tier. `_allocScale` is the truth the fraction is
measured against, and coming back down below the tier re-allocates to the tier
first.
"""
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'runtime', 'core', 'engine.js')
s = io.open(P, encoding='utf-8').read()

# 1 -- field ------------------------------------------------------------------
old = """    this._scaleAccum = 0;
    this._aboveT = 0;
    this.renderer.setPixelRatio(this._pr * this.renderScale);
    this.renderer.setSize(size.w, size.h, true);"""
new = """    this._scaleAccum = 0;
    this._aboveT = 0;
    /** @private the scale the drawing buffer and composer targets are SIZED at.
     *  Equal to the tier scale except while something has forced them larger
     *  (a quality change, the perf gate's native-1.0 INFO pass). */
    this._allocScale = this._tierScale;
    this.renderer.setPixelRatio(this._pr * this.renderScale);
    this.renderer.setSize(size.w, size.h, true);"""
assert old in s, '1'
s = s.replace(old, new, 1)

# 2 -- setter -----------------------------------------------------------------
old = """    /* FREE PATH. At or below the tier scale the buffers are already big enough:
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
    return this;"""
new = """    const subrect = !!(this.post && typeof this.post.setRenderFraction === 'function');
    /* FREE PATH. At or below the tier scale the buffers are already big enough:
     * the SCENE moves into a sub-rectangle of them and one blit brings it back
     * up (Post.setRenderFraction). Nothing is allocated, so a step costs a
     * uniform write instead of the measured 141-646 ms of
     * EffectComposer.setSize() -- which is what made this controller
     * unshippable and what made camcheck's long jump drop a queued input. */
    if (subrect && next <= this._tierScale + 0.004) {
      /* If something forced the buffers ABOVE the tier (a quality change, the
       * perf gate's native-1.0 pass), come back to the tier allocation first,
       * or the fraction would be measured against a size nobody ships. */
      if (Math.abs(this._allocScale - this._tierScale) > 0.004) {
        this._allocScale = this._tierScale;
        this.renderer.setPixelRatio(this._pr * this._tierScale);
        this.renderer.setSize(this.size.w, this.size.h, true);
        this.post.resize(this.size.w, this.size.h);
      }
      this.post.setRenderFraction(next / this._tierScale);
      this.events.emit('renderscale', next);
      return this;
    }
    /* ABOVE the tier: the buffers really do have to grow. Reallocating path,
     * kept for quality changes and for the perf gate's native-1.0 INFO pass. */
    if (subrect) this.post.setRenderFraction(1);
    this._allocScale = next;
    this.renderer.setPixelRatio(this._pr * next);
    this.renderer.setSize(this.size.w, this.size.h, true);
    if (this.post) this.post.resize(this.size.w, this.size.h);
    this.events.emit('renderscale', next);
    return this;"""
assert old in s, '2'
s = s.replace(old, new, 1)

# 3 -- quality change ---------------------------------------------------------
old = """    this.renderScale = this._tierScale;
    this._scaleAccum = 0;
    this._aboveT = 0;
    this.renderer.setPixelRatio(this._pr * this.renderScale);
    this.renderer.setSize(this.size.w, this.size.h, true);

    if (this.post) this.post.setQuality(preset);"""
new = """    this.renderScale = this._tierScale;
    this._scaleAccum = 0;
    this._aboveT = 0;
    this._allocScale = this._tierScale;
    this.renderer.setPixelRatio(this._pr * this.renderScale);
    this.renderer.setSize(this.size.w, this.size.h, true);

    if (this.post) {
      this.post.setRenderFraction(1);
      this.post.setQuality(preset);
    }"""
assert old in s, '3'
s = s.replace(old, new, 1)

# 4 -- window resize keeps the allocation at the tier -------------------------
old = """    this.renderer.setPixelRatio(pr * this.renderScale);
    this.renderer.setSize(s.w, s.h, true);"""
new = """    this.renderer.setPixelRatio(pr * this._allocScale);
    this.renderer.setSize(s.w, s.h, true);"""
assert old in s, '4'
s = s.replace(old, new, 1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('allocScale wired')
