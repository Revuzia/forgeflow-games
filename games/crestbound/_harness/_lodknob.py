"""Fill lane: expose the material-LOD radius so it is a TIER knob and testable.

Two reasons this must not stay a private constant:

  * ULTRA is the tier that is allowed to run under target by design (CONTRACT
    hard rule 4), so it should not be paying for a LOD at all - `lodDistance:
    0` disables the gate entirely by pushing the radius past any course.
  * "confirm the swap is invisible at the swap distance" is only checkable if a
    harness can render the same frame twice with the gate on and off.
    `Mats.setLodDistance(1e6, 1)` is that switch.
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- materials.js
P = os.path.join(HERE, '..', 'runtime', 'world', 'materials.js')
s = io.open(P, encoding='utf-8').read()

old = """  /** true when the key exists (harnesses check every contract name) */
  has(key) { return _base.has(key) || KEYS.indexOf(key) !== -1; },"""
new = """  /** true when the key exists (harnesses check every contract name) */
  has(key) { return _base.has(key) || KEYS.indexOf(key) !== -1; },

  /**
   * The material-LOD radius, in metres. Past `start` the injected extras (macro
   * de-tiler, rim, caustics) and the specular IBL fade out and stop being
   * evaluated; they reach zero at `start + fade`, so the radius itself is not
   * visible. One shared uniform - changing it costs nothing and recompiles
   * nothing.
   *
   * `start <= 0` DISABLES the LOD (the radius is pushed past any course), which
   * is what the ULTRA tier wants: it is the tier the contract allows to run
   * under target.
   *
   * @param {number} start metres, or <= 0 to disable
   * @param {number} [fade] metres of fade, default LOD_FADE
   */
  setLodDistance(start, fade) {
    const st = numOrAniso(start, LOD_START);
    const fd = Math.max(1, numOrAniso(fade, LOD_FADE));
    LOD_U.value.set(st > 0 ? st : 1e6, 1 / fd);
    return LOD_U.value.x;
  },

  /** metres at which the material LOD starts fading in (1e6 = disabled) */
  get lodDistance() { return LOD_U.value.x; },"""
assert old in s, 'mats'
s = s.replace(old, new, 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('materials.js: setLodDistance')

# ------------------------------------------------------------------ settings.js
P2 = os.path.join(HERE, '..', 'runtime', 'core', 'settings.js')
s2 = io.open(P2, encoding='utf-8').read()
rows = [
    ("    anisotropy: 1, maxLights: 2,\n"
     "    shadowFilter: 'basic', shadowCasterRadius: 3.0, renderScale: 0.60,",
     "    anisotropy: 1, maxLights: 2, lodDistance: 24,\n"
     "    shadowFilter: 'basic', shadowCasterRadius: 3.0, renderScale: 0.60,"),
    ("    anisotropy: 2, maxLights: 3,\n"
     "    shadowFilter: 'pcf', shadowCasterRadius: 2.0, renderScale: 0.72,",
     "    anisotropy: 2, maxLights: 3, lodDistance: 28,\n"
     "    shadowFilter: 'pcf', shadowCasterRadius: 2.0, renderScale: 0.72,"),
    ("    anisotropy: 2, maxLights: 4,\n"
     "    shadowFilter: 'pcf', shadowCasterRadius: 1.5, renderScale: 0.85,",
     "    anisotropy: 2, maxLights: 4, lodDistance: 32,\n"
     "    shadowFilter: 'pcf', shadowCasterRadius: 1.5, renderScale: 0.85,"),
    ("    anisotropy: 8, maxLights: 8,\n"
     "    shadowFilter: 'pcfsoft', shadowCasterRadius: 0.9, renderScale: 1.00,",
     "    anisotropy: 8, maxLights: 8, lodDistance: 0,\n"
     "    shadowFilter: 'pcfsoft', shadowCasterRadius: 0.9, renderScale: 1.00,"),
]
for a, b in rows:
    assert a in s2, a[:40]
    s2 = s2.replace(a, b, 1)

old = " *   anisotropy     texture anisotropy cap (materials.js)"
new = (" *   anisotropy     texture anisotropy cap (materials.js). WIRED 2026-09-03:\n"
       " *                  this field existed and nothing read it, so every tier ran\n"
       " *                  at the GPU's 8x cap (see Mats.init).\n"
       " *   lodDistance    metres past which materials drop the injected extras and\n"
       " *                  the specular IBL (materials.js Mats.setLodDistance).\n"
       " *                  0 disables the LOD - ULTRA takes that.")
assert old in s2, 'doc'
s2 = s2.replace(old, new, 1)
io.open(P2, 'w', encoding='utf-8', newline='\n').write(s2)
print('settings.js: lodDistance per tier')

# ---------------------------------------------------------------------- boot.js
P3 = os.path.join(HERE, '..', 'runtime', 'boot.js')
s3 = io.open(P3, encoding='utf-8').read()
old = "await phase(0.26, 'baking materials', () => Mats.init(engine.renderer, quality));"
new = ("await phase(0.26, 'baking materials', () => {\n"
       "    Mats.init(engine.renderer, quality);\n"
       "    Mats.setLodDistance(quality.lodDistance);\n"
       "    return Mats;\n"
       "  });")
assert old in s3, 'boot'
s3 = s3.replace(old, new, 1)
io.open(P3, 'w', encoding='utf-8', newline='\n').write(s3)
print('boot.js: applies the tier lodDistance')
