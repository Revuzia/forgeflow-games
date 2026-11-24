// Geometry helpers: a merging builder (so a whole area's static geometry is ONE draw call) and the
// shared cel material factory.
//
// Every opaque material writes an "ink id" into the alpha channel of the scene buffer. The ink pass
// (ink.js) draws a line wherever neighbouring pixels carry different ids (a crease: the top of a
// box meeting its side, a pot in front of another) and wherever depth jumps (a silhouette). Ids:
//   0            unlit / glowing things: never inked
//   INK.top...   the faces of boxes, by which way they point - so two blocks laid side by side to
//                make one floor share an id and show no seam, while every real corner gets a line
//   INK.prop(i)  round props: one id each, so a prop is outlined but its facets are not

import * as THREE from '../../vendor/three.module.min.js';
import { getTextures, surfaceArray, SWATCH_M } from './textures.js';
import { resolveTheme, surfaceFor, DEFAULT_THEME } from './themes.js';

const _c = new THREE.Color();

const PROP_IDS = [0.1, 0.16, 0.22, 0.54, 0.7, 0.86];
export const INK = {
  none: 0, sky: 4 / 255, top: 0.3, slope: 0.38, x: 0.46, z: 0.62, bottom: 0.78, hero: 0.94, eye: 1,
  prop: (i) => PROP_IDS[((i % PROP_IDS.length) + PROP_IDS.length) % PROP_IDS.length],
};

export class GeoBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.si = []; this.idx = []; this.n = 0;
    this.layer = 0;          // surface-array layer for quads that do not say (0 = plain, vertex colour only)
    this.inkId = null;       // when set, every quad takes this ink id (a prop built from several shapes)
    this.props = 0;          // running count of round shapes, for their ink ids
  }

  get empty() { return this.n === 0; }

  /**
   * A view of this builder that adds UNLIT paint (layer -1, ink id 0): zone outlines, lamp glass,
   * glowing mouths. Same box / quad / tri / cylinder calls; the colour given is the colour shown.
   */
  get glow() {
    if (this._glow) return this._glow;
    const b = this;
    const wrap = (fn) => function glowAdd(...a) { const L = b.layer, I = b.inkId; b.layer = -1; b.inkId = 0; fn.apply(b, a); b.layer = L; b.inkId = I; return b._glow; };
    this._glow = { box: wrap(b.box), quad: wrap(b.quad), tri: wrap(b.tri), cylinder: wrap(b.cylinder) };
    return this._glow;
  }

  /**
   * Quad a-b-c-d (counter-clockwise seen from outside), flat normal, per-quad colour (or `colors`:
   * one [r,g,b] per corner). `uvs` is accepted and ignored (surfaces are textured by world position).
   * si: [layer, ink id, glaze] - by default plain, an id from the way the face points, no glaze.
   */
  quad(a, b, c, d, color, uvs, colors, si) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i = this.n;
    const pts = [a, b, c, d];
    const s0 = this.layer < 0 ? -1 : (si ? si[0] : this.layer), s1 = this.inkId !== null ? this.inkId : (si && si[1] !== undefined ? si[1] : inkOfNormal(nx, ny, nz)), s2 = si ? si[2] || 0 : 0;
    for (let k = 0; k < 4; k++) {
      const p = pts[k], col = colors ? colors[k] : color;
      this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz); this.col.push(col[0], col[1], col[2]); this.si.push(s0, s1, s2);
    }
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    this.n += 4;
    return this;
  }

  tri(a, b, c, color, uvs, si) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i = this.n;
    const s0 = this.layer < 0 ? -1 : (si ? si[0] : this.layer), s1 = this.inkId !== null ? this.inkId : (si && si[1] !== undefined ? si[1] : inkOfNormal(nx, ny, nz)), s2 = si ? si[2] || 0 : 0;
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz); this.col.push(color[0], color[1], color[2]); this.si.push(s0, s1, s2); }
    this.idx.push(i, i + 1, i + 2);
    this.n += 3;
    return this;
  }

  /**
   * Axis-aligned box. tint: [top, side, bottom] brightness multipliers. color: hex or [r,g,b]
   * (linear, multiplies the paint). top / side: surface-array layers for the walkable face and the
   * walls (default plain). glaze: highlight strength of the top face. ao: darkening at the foot of
   * the walls. skip: faces to leave out ('t' 'b' 'x' 'X' 'z' 'Z').
   */
  box(x0, y0, z0, x1, y1, z1, { color = 0xffffff, tint = [1, 1, 0.8], skip = '', ao = 0, aoH = 0.8, top = 0, side = 0, glaze = 0, ink } = {}) {
    const c = rgb(color);
    const m = (k) => [c[0] * k, c[1] * k, c[2] * k];
    const T = m(tint[0]), S = m(tint[1]), B = m(tint[2]);
    const sT = [top, ink, glaze], sS = [side, ink, 0];
    if (!skip.includes('t')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], T, null, null, sT);
    if (!skip.includes('b')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], B, null, null, sS);
    // Sides. With `ao`, a band at the foot of each wall darkens toward the floor (a painted contact
    // tone), so walls sit on the ground instead of floating on it.
    const band = ao > 0 ? Math.min(aoH, (y1 - y0) * 0.5) : 0;
    const sideQ = (P, col) => {
      if (band <= 0.001) { this.quad(P(y0, 0), P(y0, 1), P(y1, 1), P(y1, 0), col, null, null, sS); return; }
      const yb = y0 + band, dk = [col[0] * (1 - ao), col[1] * (1 - ao), col[2] * (1 - ao)];
      this.quad(P(y0, 0), P(y0, 1), P(yb, 1), P(yb, 0), col, null, [dk, dk, col, col], sS);
      this.quad(P(yb, 0), P(yb, 1), P(y1, 1), P(y1, 0), col, null, null, sS);
    };
    if (!skip.includes('z')) sideQ((y, e) => [e ? x1 : x0, y, z1], S);       // +z
    if (!skip.includes('Z')) sideQ((y, e) => [e ? x0 : x1, y, z0], S);       // -z
    if (!skip.includes('x')) sideQ((y, e) => [x1, y, e ? z0 : z1], S);       // +x
    if (!skip.includes('X')) sideQ((y, e) => [x0, y, e ? z1 : z0], S);       // -x
    return this;
  }

  /** Wedge filling the box under a plane rising in direction `up` ('+x','-x','+z','-z'). */
  wedge(x0, y0, z0, x1, y1, z1, up, { color = 0xffffff, tint = [1, 1, 0.8], top = 0, side = 0, glaze = 0 } = {}) {
    const c = rgb(color);
    const m = (k) => [c[0] * k, c[1] * k, c[2] * k];
    const T = m(tint[0]), S = m(tint[1]), B = m(tint[2]);
    const sT = [top, INK.slope, glaze], sS = [side, undefined, 0];
    // Work in a local frame where the slope rises along +u; map (u,w) back to x/z.
    const alongX = up[1] === 'x', pos = up[0] === '+';
    const P = (u, y, w) => (alongX ? [pos ? x0 + u * (x1 - x0) : x1 - u * (x1 - x0), y, w] : [w, y, pos ? z0 + u * (z1 - z0) : z1 - u * (z1 - z0)]);
    const w0 = alongX ? z0 : x0, w1 = alongX ? z1 : x1;
    // which winding is outward depends on handedness of the mapping
    const flip = alongX ? !pos : pos;
    const Q = (a, b, c2, d, col, si) => (flip ? this.quad(a, d, c2, b, col, null, null, si) : this.quad(a, b, c2, d, col, null, null, si));
    const Tr = (a, b, c2, col, si) => (flip ? this.tri(a, c2, b, col, null, si) : this.tri(a, b, c2, col, null, si));
    Q(P(0, y0, w1), P(1, y1, w1), P(1, y1, w0), P(0, y0, w0), T, sT);       // slope
    Q(P(1, y0, w1), P(1, y0, w0), P(1, y1, w0), P(1, y1, w1), S, sS);       // back (tall) face
    Q(P(0, y0, w0), P(1, y0, w0), P(1, y0, w1), P(0, y0, w1), B, sS);       // bottom
    Tr(P(0, y0, w1), P(1, y0, w1), P(1, y1, w1), S, sS);
    Tr(P(1, y0, w0), P(0, y0, w0), P(1, y1, w0), S, sS);
    return this;
  }

  /**
   * Vertical cylinder / cone frustum (per-face flat normals keep the chunky look). One ink id for
   * the whole shape, so it is outlined but its facets are not.
   * caps: true (both ends) | 'top' | 'bottom' | false.
   */
  cylinder(cx, y0, cz, r0, r1, h, seg = 10, color = 0xffffff, { caps = true, tint = [1, 1, 0.8], ink } = {}) {
    const capTop = caps === true || caps === 'top', capBot = caps === true || caps === 'bottom';
    const c = rgb(color);
    const m = (k) => [c[0] * k, c[1] * k, c[2] * k];
    const id = ink !== undefined ? ink : INK.prop(this.props++);
    const si = [0, id, 0];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad([cx + c1 * r0, y0, cz + s1 * r0], [cx + c0 * r0, y0, cz + s0 * r0], [cx + c0 * r1, y0 + h, cz + s0 * r1], [cx + c1 * r1, y0 + h, cz + s1 * r1], m(tint[1]), null, null, si);
      if (capTop && r1 > 0.001) this.tri([cx, y0 + h, cz], [cx + c1 * r1, y0 + h, cz + s1 * r1], [cx + c0 * r1, y0 + h, cz + s0 * r1], m(tint[0]), null, si);
      if (capBot && r0 > 0.001) this.tri([cx, y0, cz], [cx + c0 * r0, y0, cz + s0 * r0], [cx + c1 * r0, y0, cz + s1 * r0], m(tint[2]), null, si);
    }
    return this;
  }

  /** Surface of revolution around the vertical axis through (cx, cz). profile: [[radius, y], ...] bottom to top. */
  lathe(cx, y0, cz, profile, seg = 10, color = 0xffffff, scale = 1, ink) {
    const id = ink !== undefined ? ink : INK.prop(this.props++);
    for (let i = 0; i < profile.length - 1; i++) {
      const [ra, ya] = profile[i], [rb, yb] = profile[i + 1];
      this.cylinder(cx, y0 + ya * scale, cz, ra * scale, rb * scale, (yb - ya) * scale, seg, color, { caps: i === profile.length - 2 ? 'top' : false, tint: [1, 1, 0.8], ink: id });
    }
    return this;
  }

  /** Copy another builder's geometry into this one under a Matrix4 (lets a posed prop join a merged mesh). */
  append(o, m) {
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m), base = this.n;
    for (let i = 0; i < o.n; i++) {
      v.set(o.pos[i * 3], o.pos[i * 3 + 1], o.pos[i * 3 + 2]).applyMatrix4(m); this.pos.push(v.x, v.y, v.z);
      v.set(o.nrm[i * 3], o.nrm[i * 3 + 1], o.nrm[i * 3 + 2]).applyMatrix3(nm).normalize(); this.nrm.push(v.x, v.y, v.z);
      this.col.push(o.col[i * 3], o.col[i * 3 + 1], o.col[i * 3 + 2]);
      // a box face that was turned keeps a face id, but the one of the way it points now
      const id = o.si[i * 3 + 1], axis = id === INK.top || id === INK.x || id === INK.z || id === INK.bottom;
      this.si.push(o.si[i * 3], axis ? inkOfNormal(v.x, v.y, v.z) : id, o.si[i * 3 + 2]);
    }
    for (const k of o.idx) this.idx.push(k + base);
    this.n += o.n;
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSI', new THREE.Float32BufferAttribute(this.si, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** The ink id of a flat face from its normal: top, bottom, the two wall directions, or a slope. */
export function inkOfNormal(nx, ny, nz) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay > 0.97) return ny > 0 ? INK.top : INK.bottom;
  if (ay > 0.3) return INK.slope;
  return ax >= az ? INK.x : INK.z;
}

export function rgb(color) {
  if (Array.isArray(color)) return color;
  _c.set(color);
  return [_c.r, _c.g, _c.b];
}

// ---------------------------------------------------------------------------- the cel material

let patched = false;
/**
 * Give MeshToonMaterial an optional glaze highlight drawn as a shape (define DEW_GLAZE): a
 * hard-edged Blinn blob in the key light's colour, which is what makes tile read as glazed.
 */
function patchToon() {
  if (patched) return;
  patched = true;
  const key = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
  const chunk = THREE.ShaderChunk.lights_toon_pars_fragment;
  if (!chunk || !chunk.includes(key)) return; // unknown three build: fall back to plain toon
  THREE.ShaderChunk.lights_toon_pars_fragment = chunk.replace(key, `${key}
	#ifdef DEW_GLAZE
		vec3 glazeH = normalize( directLight.direction + geometryViewDir );
		float glazeS = pow( max( dot( geometryNormal, glazeH ), 0.0 ), 420.0 );
		reflectedLight.directDiffuse += min( directLight.color, vec3( 1.2 ) ) * smoothstep( 0.46, 0.54, glazeS ) * dewGlaze * 0.22;
	#endif`);
}

// ---------------------------------------------------------------------------- the cut-away
// A thin wall that stands between the camera and the hero is not a reason to haul the camera in:
// the renderer cuts a round window through it instead (renderer.js picks the walls and fills
// FADE.uniforms every frame). The window is a clean hole with a slightly wobbly edge, opening from
// nothing - the ink pass then outlines it like any other edge, so the cut reads as drawn. Up to
// FADE_N walls at once. The chunk is NOT in the normal materials (it fattens the fragment shader of
// every wall pixel): each wall-drawing material has a second "fade" variant that carries it, and
// the world swaps its meshes to those variants only while something is actually being cut
// (world.setFade), having compiled them when the level loaded.
export const FADE_N = 6;
export const FADE = {
  uniforms: {
    uFadeN: { value: 0 },
    uFade: { value: Array.from({ length: FADE_N * 2 }, () => new THREE.Vector4()) },   // per wall: (min xyz, how open), (max xyz, 0)
    uFadeA: { value: new THREE.Vector4() },                                              // camera
    uFadeB: { value: new THREE.Vector4() },                                              // the hero
  },
};
const FADE_VERT_PARS = 'varying vec3 vFadeW;';
const FADE_VERT = `
	#ifdef USE_INSTANCING
		vFadeW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
	#else
		vFadeW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	#endif`;
const FADE_FRAG_PARS = `varying vec3 vFadeW;
uniform float uFadeN;
uniform vec4 uFade[${FADE_N * 2}];
uniform vec4 uFadeA, uFadeB;`;
const FADE_FRAG = `
	if ( uFadeN > 0.5 ) {
		float fk = 0.0;
		for ( int i = 0; i < ${FADE_N}; i ++ ) {
			if ( float( i ) >= uFadeN ) break;
			vec4 lo = uFade[ i * 2 ], hi = uFade[ i * 2 + 1 ];
			if ( vFadeW.x > lo.x - 0.07 && vFadeW.y > lo.y - 0.07 && vFadeW.z > lo.z - 0.07 && vFadeW.x < hi.x + 0.07 && vFadeW.y < hi.y + 0.07 && vFadeW.z < hi.z + 0.07 ) fk = max( fk, lo.w );
		}
		if ( fk > 0.0 ) {
			vec3 ab = uFadeB.xyz - uFadeA.xyz;
			float tt = dot( vFadeW - uFadeA.xyz, ab ) / max( dot( ab, ab ), 1e-4 );
			if ( tt > 0.0 && tt < 1.0 ) {
				vec3 off = vFadeW - ( uFadeA.xyz + ab * tt );
				float R = ( 0.55 + 0.75 * tt ) * fk;
				R *= 1.0 + 0.07 * sin( atan( off.y, off.x + off.z ) * 5.0 + vFadeW.y * 3.0 );
				if ( length( off ) < R ) discard;
			}
		}
	}`;

const INK_VERT_PARS = { attr: 'attribute vec3 aSI;\nvarying float vInk;', axis: 'varying float vInk;' };
const INK_VERT = {
  attr: '\tvInk = aSI.y;',
  // a box-shaped mesh without ids of its own: read the id off the way each face points
  axis: `\t{ vec3 an_ = abs( normal ); vInk = an_.y > 0.9 ? ( normal.y > 0.0 ? ${INK.top.toFixed(3)} : ${INK.bottom.toFixed(3)} ) : ( an_.x >= an_.z ? ${INK.x.toFixed(3)} : ${INK.z.toFixed(3)} ); }`,
};

/**
 * Shared cel material (MeshToonMaterial with the three-band ramp).
 * opts: { color, vertexColors, emissive, emissiveIntensity, side, glaze (0..1),
 *         ink: 'attr' (geometry carries aSI) | 'axis' (box faces, from the normal) | number (one id; default a prop id),
 *         fade: true (the cut-away variant), key: extra program-cache key,
 *         vertPars / vert / fragPars / frag: GLSL added to the declarations and to the body of each shader
 *         (frag runs just before lighting, with diffuseColor and totalEmissiveRadiance to hand),
 *         uniforms: { name: { value } } for that GLSL }
 */
export function toon(opts = {}) {
  patchToon();
  const m = new THREE.MeshToonMaterial({
    gradientMap: getTextures().ramp,
    color: opts.color === undefined ? 0xffffff : opts.color,
    vertexColors: !!opts.vertexColors,
    emissive: opts.emissive === undefined ? 0x000000 : opts.emissive,
    emissiveIntensity: opts.emissiveIntensity === undefined ? 1 : opts.emissiveIntensity,
    side: opts.side === undefined ? THREE.FrontSide : opts.side,
  });
  const mode = opts.ink === 'attr' || opts.ink === 'axis' ? opts.ink : 'const';
  const inkU = { value: mode === 'const' ? (opts.ink === undefined ? INK.prop(0) : opts.ink) : 0 };
  m.userData.ink = inkU;
  const glaze = opts.glaze ? Number(opts.glaze) : 0;
  if (glaze || opts.surface) m.defines = { DEW_GLAZE: 1 };
  const fade = !!opts.fade, S = opts.surface || null;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uInk: inkU }, fade ? FADE.uniforms : {}, S ? S.uniforms : {}, opts.uniforms || {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${mode === 'const' ? '' : INK_VERT_PARS[mode]}\n${fade ? FADE_VERT_PARS : ''}\n${S ? 'varying vec3 vSurfW;\nvarying vec3 vSurfN;\nvarying vec2 vSurfLG;' : ''}\n${opts.vertPars || ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${mode === 'const' ? '' : INK_VERT[mode]}\n${fade ? FADE_VERT : ''}\n${S ? '\tvSurfW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; vSurfN = normal; vSurfLG = aSI.xz;' : ''}\n${opts.vert || ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nfloat dewGlaze = ${glaze.toFixed(3)};\n${mode === 'const' ? 'uniform float uInk;' : 'varying float vInk;'}\n${fade ? FADE_FRAG_PARS : ''}\n${S ? 'uniform mediump sampler2DArray uSurf;\nvarying vec3 vSurfW;\nvarying vec3 vSurfN;\nvarying vec2 vSurfLG;' : ''}\n${opts.fragPars || ''}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${fade ? FADE_FRAG : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${S ? SURFACE_FRAG : ''}\n${opts.frag || ''}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n\tgl_FragColor.a = ${mode === 'const' ? 'uInk' : 'vInk'};`);
  };
  m.customProgramCacheKey = () => `dewCel:${mode}:${fade ? 1 : 0}:${S ? 1 : 0}:${glaze ? 1 : 0}:${opts.key || ''}`;
  return m;
}

// The paint of a static surface: one layer of the theme's array texture, laid on by world position
// (2 m per swatch) on whichever plane the face lies in - so neighbouring blocks tile seamlessly and
// the geometry needs no texture coordinates.
const SURFACE_FRAG = `
	{
		vec3 an_ = abs( vSurfN );
		vec3 wx_ = dFdx( vSurfW ), wy_ = dFdy( vSurfW );
		vec2 uv_, gx_, gy_;
		if ( an_.y > 0.6 ) { uv_ = vSurfW.xz; gx_ = wx_.xz; gy_ = wy_.xz; }
		else if ( an_.x > an_.z ) { uv_ = vSurfW.zy; gx_ = wx_.zy; gy_ = wy_.zy; }
		else { uv_ = vSurfW.xy; gx_ = wx_.xy; gy_ = wy_.xy; }
		float k_ = ${(1 / SWATCH_M).toFixed(4)};
		if ( vSurfLG.x < -0.5 ) {
			// layer -1: unlit paint (zone outlines, lamp glass, glowing mouths) - shown as it is, never shaded
			totalEmissiveRadiance += diffuseColor.rgb;
			diffuseColor.rgb = vec3( 0.0 );
		} else {
			diffuseColor *= textureGrad( uSurf, vec3( uv_ * k_, floor( vSurfLG.x + 0.5 ) ), gx_ * k_, gy_ * k_ );
			dewGlaze = vSurfLG.y;
		}
	}`;

const matCache = new Map();

/**
 * The one material that paints all static geometry of a level in a theme (blocks, ramps, merged
 * props and trim): vertex colour times the paint layer each face names, cel lit, ids from the
 * geometry. Cached per theme; `fade` gives its cut-away variant.
 */
export function surfaceMaterial(themeOrName = DEFAULT_THEME, fade = false) {
  const theme = typeof themeOrName === 'string' ? resolveTheme(themeOrName) : themeOrName;
  const key = `${theme.name}${fade ? ':fade' : ''}`;
  if (matCache.has(key)) { const m = matCache.get(key); m.userData.surf.value = surfaceArray(theme).tex; return m; }
  const surf = { value: surfaceArray(theme).tex };
  const m = toon({ vertexColors: true, ink: 'attr', fade, surface: { uniforms: { uSurf: surf } } });
  m.userData.surf = surf;
  matCache.set(key, m);
  return m;
}

/** Layers and tints of a block material in a theme: { top, side, topTint, sideTint, glaze } with top/side as array layers. */
export function surfaceLayers(theme, mat) {
  const s = surfaceFor(theme, mat), a = surfaceArray(theme);
  return { top: a.layer(s.top), side: a.layer(s.side), topTint: s.topTint, sideTint: s.sideTint, glaze: s.glaze || 0 };
}

/**
 * Make an unlit material (MeshBasicMaterial and friends) write an ink id: 0 by default, so things
 * that glow are never inked over.
 */
export function inkless(m, id = 0) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n\tgl_FragColor.a = ${id.toFixed(4)};`);
  };
  m.customProgramCacheKey = () => `dewInkless:${id.toFixed(4)}`;
  return m;
}

// ---------------------------------------------------------------------------- inverted hull
// The outline technique that was measured against the ink pass and not chosen (ink.js has the
// numbers). Kept, switched off, behind Renderer.outlineMode = 'hull' so the comparison can be re-run.

/** Add `aOut` (normals averaged across every vertex at the same position) so a hull has no gaps at hard corners. */
export function withOutlineNormals(g) {
  if (g.attributes.aOut) return g;
  const p = g.attributes.position, n = g.attributes.normal, map = new Map(), out = new Float32Array(p.count * 3);
  const key = (i) => `${Math.round(p.getX(i) * 500)},${Math.round(p.getY(i) * 500)},${Math.round(p.getZ(i) * 500)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i); let a = map.get(k);
    if (!a) { a = [0, 0, 0, new Set()]; map.set(k, a); }
    const nk = `${Math.round(n.getX(i) * 20)},${Math.round(n.getY(i) * 20)},${Math.round(n.getZ(i) * 20)}`;
    if (!a[3].has(nk)) { a[3].add(nk); a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); }
  }
  for (let i = 0; i < p.count; i++) {
    const a = map.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
  }
  g.setAttribute('aOut', new THREE.BufferAttribute(out, 3));
  return g;
}

let hullMat = null;
/** Back faces pushed out along aOut by a fixed number of pixels, in flat ink. */
export function hullMaterial() {
  if (hullMat) return hullMat;
  hullMat = new THREE.ShaderMaterial({
    uniforms: { uInkCol: { value: new THREE.Color(0x143244) }, uPx: { value: new THREE.Vector2(2 / 1280, 2 / 720) } },
    vertexShader: /* glsl */`
      attribute vec3 aOut; uniform vec2 uPx;
      void main() {
        #ifdef USE_INSTANCING
          mat4 mm = modelMatrix * instanceMatrix;
        #else
          mat4 mm = modelMatrix;
        #endif
        vec4 c = projectionMatrix * viewMatrix * mm * vec4(position, 1.0);
        vec3 n = normalize(mat3(viewMatrix) * mat3(mm) * aOut);
        vec4 cn = projectionMatrix * vec4(n, 0.0);
        c.xy += normalize(cn.xy + 1e-6) * uPx * 2.0 * c.w;
        gl_Position = c;
      }`,
    fragmentShader: 'uniform vec3 uInkCol; void main(){ gl_FragColor = vec4(uInkCol, 0.0); }',
    side: THREE.BackSide, fog: false, toneMapped: false,
  });
  return hullMat;
}
