"""Fill lane: give ROUGH materials the free IBL-specular path.

`getIBLRadiance()` is a second `textureCubeUV()` — two PMREM mip fetches plus
the whole cube-UV address chain — per fragment, on top of the one
`getIBLIrradiance()` already paid.  But read three r172's own definitions:

    getIBLRadiance(v, n, r):  reflectVec = normalize( mix( reflect(-v,n), n, r*r ) )
                              return textureCubeUV( envMap, reflectVec, r ) * I
    getIBLIrradiance(n):      return PI * textureCubeUV( envMap, n, 1.0 ) * I

At r = 0.9 the reflection vector has already been lerped 81 % of the way to the
normal and the lookup is already at the roughest mip, so the two calls converge:
`getIBLRadiance -> getIBLIrradiance * RECIPROCAL_PI`.  For every material whose
authored roughness is at or above IBL_ROUGH_CUT the second fetch therefore buys
nothing that the first has not already computed, and it is replaced by that
identity — no branch, no fetch, no distance dependence, and it works indoors
where the distance LOD never engages.

Smooth keys (marble, metal, copper, gold, glass, ice, crystal, obsidian, neon,
water) keep the real call: that is where a reflection is the look.
"""
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'runtime', 'world', 'materials.js')
s = io.open(P, encoding='utf-8').read()

# 1 -- the cut, next to the LOD constants -------------------------------------
old = "const LOD_U = { value: new THREE.Vector2(LOD_START, 1 / LOD_FADE) };"
new = old + """

/**
 * Authored roughness at or above which a material takes the free IBL-specular
 * path (see `_harness/_iblrough.py` for the derivation from three's own
 * `getIBLRadiance` / `getIBLIrradiance`). 0.72 keeps every polished key -
 * marble, metal, copper, gold, glass, ice, crystal, obsidian, neon - on the
 * real lookup, and puts stone, plaster, brick, wood, bark, moss, cloth, rope,
 * dirt, grass, snow and sand, which are most of the screen, on the identity.
 * MEASURED (`_harness/_fillab.py`, keep/cp3/quality medium, 1382x777): the
 * environment map as a whole is -2.74 ms of a 22.56 ms frame.
 */
const IBL_ROUGH_CUT = 0.72;"""
assert old in s, '1'
s = s.replace(old, new, 1)

# 2 -- decide per material, in assemble() -------------------------------------
old = """  const io = Object.assign({ box: BOX_KEYS.has(key), uvScale }, inject || {});
  if (io.box || io.uniforms || io.defines) injectShader(mat, key, io);"""
new = """  const io = Object.assign({ box: BOX_KEYS.has(key), uvScale }, inject || {});
  /* A rough material's specular IBL is its diffuse IBL scaled by 1/PI (see the
     IBL_ROUGH_CUT note); the injection reads this and drops the second
     textureCubeUV. Decided from the AUTHORED roughness, so it is a compile-time
     choice per material, not a per-fragment branch, and every material still
     resolves to exactly one program. */
  if (io.iblRough === undefined) io.iblRough = numOrAniso(mat.roughness, 1) >= IBL_ROUGH_CUT;
  injectShader(mat, key, io);"""
assert old in s, '2'
s = s.replace(old, new, 1)

# 3 -- read it in injectShader -------------------------------------------------
old = """  let box = opts.box !== false;
  let lod = opts.lod !== false;"""
new = """  let box = opts.box !== false;
  let lod = opts.lod !== false;
  const iblRough = !!opts.iblRough;"""
assert old in s, '3'
s = s.replace(old, new, 1)

# 4 -- emit the cheap path -----------------------------------------------------
old = """  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    if ( cbLodT < 0.999 ) {
      float cbIblW = 1.0 - cbLodT;
      #ifdef USE_ANISOTROPY
        radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy ) * cbIblW;
      #else
        radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * cbIblW;
      #endif
      #ifdef USE_CLEARCOAT
        clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * cbIblW;
      #endif
    }
  #endif`);"""
new = """  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    ${iblRough ? `
    /* ROUGH PATH: no second textureCubeUV. See IBL_ROUGH_CUT. */
    #if defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
      radiance += iblIrradiance * RECIPROCAL_PI * ( 1.0 - cbLodT );
    #else
      radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * ( 1.0 - cbLodT );
    #endif
    #ifdef USE_CLEARCOAT
      if ( cbLodT < 0.999 ) clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * ( 1.0 - cbLodT );
    #endif` : `
    if ( cbLodT < 0.999 ) {
      float cbIblW = 1.0 - cbLodT;
      #ifdef USE_ANISOTROPY
        radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy ) * cbIblW;
      #else
        radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * cbIblW;
      #endif
      #ifdef USE_CLEARCOAT
        clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * cbIblW;
      #endif
    }`}
  #endif`);"""
assert old in s, '4'
s = s.replace(old, new, 1)

# 5 -- shape key ---------------------------------------------------------------
old = "  const shapeKey = 'cb#' + (box ? 'b' : '-') + (lod ? 'D' : '') +"
new = "  const shapeKey = 'cb#' + (box ? 'b' : '-') + (lod ? 'D' : '') + (iblRough ? 'Q' : '') +"
assert old in s, '5'
s = s.replace(old, new, 1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('iblRough wired')
