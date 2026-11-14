"""Fill lane: the LOD must lose COST, not ENERGY.

`_lodvisible.py` (verdant-1, quality high, radius 32 m) caught the first cut
doing both: mean absolute difference 1.179/255 against the LOD-disabled frame,
10.51 % of pixels off by more than 4/255 and a worst pixel of 125. Two bugs,
both of them "faded the term to zero" where zero was not the cheap answer:

  1. The ROUGH path already replaces `getIBLRadiance` with
     `iblIrradiance * RECIPROCAL_PI`, which costs nothing extra - and then
     multiplied it by `1 - t`, so every rough surface past the radius lost its
     specular for no saving whatsoever. Rough materials are most of the screen.
  2. The SMOOTH path faded to nothing, so a distant highlight vanished
     (worst = 125). The cheap approximation is the right destination there too:
     past the radius a smooth surface keeps the same ENERGY and loses only the
     SHARPNESS of the reflection, which at 40+ m under fog is sub-pixel.

Both now blend toward the cheap term instead of toward zero, so the far field
is shaded more cheaply and not more darkly, and the radius moves out to 40 m
with a 25 m fade.
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, '..', 'runtime', 'world', 'materials.js')
s = io.open(P, encoding='utf-8').read()

old = """const LOD_START = 32;      // metres - full quality inside this
const LOD_FADE = 20;       // metres - gated terms reach zero at START + FADE"""
if old not in s:
    old = """const LOD_START = 32;      // metres — full quality inside this
const LOD_FADE = 20;       // metres — gated terms reach zero at START + FADE"""
new = """const LOD_START = 40;      // metres: full quality inside this
const LOD_FADE = 25;       // metres of fade; the gate is fully in at START + FADE"""
assert old in s, 'consts'
s = s.replace(old, new, 1)

old = """    #if defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
      radiance += iblIrradiance * RECIPROCAL_PI * ( 1.0 - cbLodT );
    #else
      radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * ( 1.0 - cbLodT );
    #endif"""
new = """    #if defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
      /* No distance term: this IS the cheap answer, and fading it would cost
         energy for no saving (see _harness/_lodcontinuous.py). */
      radiance += iblIrradiance * RECIPROCAL_PI;
    #else
      radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
    #endif"""
assert old in s, 'rough'
s = s.replace(old, new, 1)

old = """    if ( cbLodT < 0.999 ) {
      float cbIblW = 1.0 - cbLodT;
      #ifdef USE_ANISOTROPY
        radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy ) * cbIblW;
      #else
        radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * cbIblW;
      #endif
      #ifdef USE_CLEARCOAT
        clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * cbIblW;
      #endif
    }"""
new = """    /* SMOOTH path. Near: the real lookup. Far: the same cheap term the rough
       materials use, so the surface keeps its ENERGY and loses only the
       SHARPNESS of the reflection. Blended across the fade, so the radius is
       continuous. */
    if ( cbLodT < 0.999 ) {
      vec3 cbIblCheap = iblIrradiance * RECIPROCAL_PI;
      #ifdef USE_ANISOTROPY
        radiance += mix( getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy ), cbIblCheap, cbLodT );
      #else
        radiance += mix( getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ), cbIblCheap, cbLodT );
      #endif
      #ifdef USE_CLEARCOAT
        clearcoatRadiance += mix( getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ), cbIblCheap, cbLodT );
      #endif
    } else {
      radiance += iblIrradiance * RECIPROCAL_PI;
      #ifdef USE_CLEARCOAT
        clearcoatRadiance += iblIrradiance * RECIPROCAL_PI;
      #endif
    }"""
assert old in s, 'smooth'
s = s.replace(old, new, 1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('LOD is now continuous in energy')

# tiers move out with the constant
P2 = os.path.join(HERE, '..', 'runtime', 'core', 'settings.js')
s2 = io.open(P2, encoding='utf-8').read()
for a, b in (("lodDistance: 24,", "lodDistance: 30,"),
             ("lodDistance: 28,", "lodDistance: 35,"),
             ("lodDistance: 32,", "lodDistance: 40,")):
    assert a in s2, a
    s2 = s2.replace(a, b, 1)
io.open(P2, 'w', encoding='utf-8', newline='\n').write(s2)
print('settings.js radii: low 30 / medium 35 / high 40 / ultra off')
