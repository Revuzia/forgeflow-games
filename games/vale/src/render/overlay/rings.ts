// VALE render — ground rings (STYLE_BIBLE "Palette" shape codes; tokens.json `team.shape.*.ring`,
// `hud.groundRing`). Overlay pass: after the grade, depth-tested by hand against the scene depth, with
// a 1 px dark keyline so the ring reads on lit stone and in shadow alike.
//
//   self     solid ring + a gnomon wedge at your facing
//   ally     12-dash ring
//   enemy    solid ring with 4 inward notches
//   neutral  none until aggro, then a plain ring
//   range    dashed ring at a structure's attack range ("stay outside the ring"; client_hud §4.6),
//            shown while your fighter is within 4 m of it
// One instanced draw for every ring. Widths are in screen pixels (2.5 px band) so the code reads the
// same at every zoom.

import {
  type Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending,
  PlaneGeometry, ShaderMaterial,
} from 'three';
import { DEPTH_TEST_GLSL } from './depth.ts';
import { overlayAttrs, overlayMaterial } from './program.ts';

export const RING = { self: 0, ally: 1, enemy: 2, neutral: 3, range: 4 } as const;

const MAX = 256;

export const RING_VERT = /* glsl */`
attribute vec4 aRing;     // x, z, radius, facing (radians, sim convention)
attribute vec4 aStyle;    // code, alpha, emphasis, y
attribute vec3 aColor;
varying vec2 vLocal; varying float vR; varying vec4 vStyle; varying vec3 vColor; varying float vFacing;
void main() {
  float ext = aRing.z + 0.6;
  vec3 wp = vec3( aRing.x + position.x * ext * 2.0, aStyle.w, aRing.y - position.y * ext * 2.0 );
  vLocal = vec2( wp.x - aRing.x, wp.z - aRing.y );
  vR = aRing.z; vStyle = aStyle; vColor = aColor; vFacing = aRing.w;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;

export const RING_FRAG = /* glsl */`
${DEPTH_TEST_GLSL}
varying vec2 vLocal; varying float vR; varying vec4 vStyle; varying vec3 vColor; varying float vFacing;
void main() {
  float code = vStyle.x;
  float d = length( vLocal );
  float px = max( fwidth( d ), 1e-4 );           // metres per pixel here
  float hw = ( 1.25 + vStyle.z * 0.5 ) * px;  // 2.5 px band (3.5 when emphasised)
  float band = d - vR;
  float ring = 1.0 - smoothstep( hw - 0.6 * px, hw + 0.6 * px, abs( band ) );
  float ang = atan( vLocal.x, -vLocal.y );       // 0 at screen-up (−Z), clockwise
  float a01 = ang / 6.2831853 + 0.5;
  float mask = 1.0;
  if ( code > 0.5 && code < 1.5 ) {              // ally: 12 dashes
    float s = fract( a01 * 12.0 );
    mask = smoothstep( 0.0, 0.04, s ) * ( 1.0 - smoothstep( 0.62, 0.66, s ) );
  } else if ( code > 3.5 ) {                     // range: 36 short dashes
    float s = fract( a01 * 36.0 );
    mask = smoothstep( 0.0, 0.06, s ) * ( 1.0 - smoothstep( 0.5, 0.56, s ) );
  }
  float fill = ring * mask;
  // enemy: 4 inward notches (cardinal points), a 0.18 m wedge cut into the inner side
  if ( code > 1.5 && code < 2.5 ) {
    float t4 = fract( a01 * 4.0 );
    float q = min( t4, 1.0 - t4 ) * 6.2831853 / 4.0 * d;                       // arc distance to the nearest cardinal
    float depth = 0.2 - q * 1.4;                                                 // wedge profile
    float notch = ( 1.0 - smoothstep( -0.5 * px, 0.5 * px, -band - depth ) ) * step( band, 0.0 ) * step( 0.0, depth );
    fill = max( fill, notch );
  }
  // self: gnomon wedge at the facing (outside the ring)
  if ( code < 0.5 ) {
    vec2 f = vec2( cos( vFacing ), sin( vFacing ) );
    vec2 sd = vec2( -f.y, f.x );
    float along = dot( vLocal, f ) - vR;
    float across = abs( dot( vLocal, sd ) );
    float len = 0.42, wid = 0.2;
    float inW = step( -hw, along ) * ( 1.0 - smoothstep( len - px, len + px, along ) );
    float edge = across - wid * ( 1.0 - clamp( along / len, 0.0, 1.0 ) );
    fill = max( fill, inW * ( 1.0 - smoothstep( -0.6 * px, 0.6 * px, edge ) ) );
  }
  // 1 px dark keyline outside the band
  float key = ( 1.0 - smoothstep( hw + 0.4 * px, hw + 1.6 * px, abs( band ) ) ) * ( 1.0 - ring ) * mask;
  float vis = valeVisible( 0.18 );
  float a = ( fill + key * 0.35 * ( 1.0 - fill ) ) * vStyle.y * vis;
  if ( a <= 0.003 ) discard;
  vec3 c = mix( vec3( 0.0 ), vColor, fill / max( fill + key * 0.35 * ( 1.0 - fill ), 1e-4 ) );
  gl_FragColor = vec4( c, a );
}`;

export class RingLayer {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly aRing: InstancedBufferAttribute;
  private readonly aStyle: InstancedBufferAttribute;
  private readonly aColor: InstancedBufferAttribute;
  private count = 0;

  constructor() {
    const quad = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    const mk = (size: number): InstancedBufferAttribute => { const a = new InstancedBufferAttribute(new Float32Array(MAX * size), size); a.setUsage(DynamicDrawUsage); return a; };
    this.aRing = mk(4); this.aStyle = mk(4); this.aColor = mk(3);
    overlayAttrs(this.geo, 'ring', { aRing: this.aRing, aStyle: this.aStyle, aColor: this.aColor });
    this.geo.instanceCount = 0;
    // the overlay pass' one program (program.ts); the scene-depth uniforms are every overlay material's
    const mat = overlayMaterial('ring', {}, { transparent: true, depthTest: false, depthWrite: false, blending: NormalBlending });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  begin(): void { this.count = 0; }

  push(x: number, z: number, radius: number, facing: number, code: number, color: Color, alpha: number, emphasis = 0, y = 0.03): void {
    if (this.count >= MAX) return;
    const i = this.count++;
    this.aRing.setXYZW(i, x, z, radius, facing);
    this.aStyle.setXYZW(i, code, alpha, emphasis, y);
    this.aColor.setXYZ(i, color.r, color.g, color.b);
  }

  end(): void {
    this.geo.instanceCount = this.count;
    for (const a of [this.aRing, this.aStyle, this.aColor]) { a.clearUpdateRanges(); a.addUpdateRange(0, this.count * a.itemSize); a.needsUpdate = true; }
    this.mesh.visible = this.count > 0;
  }

  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}
