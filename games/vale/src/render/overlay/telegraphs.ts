// VALE render — telegraph decals and the aim indicator (STYLE_BIBLE "HUD density" telegraph row;
// tokens.json `hud.telegraph`). Shader decals in the overlay pass, after the grade.
//
//   enemy     fill 16 % → 30 % as the area lands, edge 90 % at 3 px
//   ally      edge 45 % at 2 px, no fill (heals: Sap edge 50 %)
//   own aim   fill 12 %, edge 90 % at 2.5 px, keyline 55 %; dashed range ring 45 % (keyline 45 %): it must
//             read on pale lane stone, where a 60 % Noonwhite edge alone measured ≈ 1.5:1 (r12 B2 review)
//   neutral   fill 12 %, edge 80 % at 2 px
//   every telegraph has a 1 px dark keyline OUTSIDE the edge (#000 at 35 % unless the spec raises it)
// Delayed areas sweep clockwise from 12 o'clock and land as the circle closes; lines and cones fill
// origin → tip. On landing a 150 ms impact flash raises the fill (never to white, never pulsing above
// 2 Hz); an area wider than 4 m (combat m-3) never washes its whole shape: its fill holds ≤ 22 % while the flash
// lights a 0.35 m band inside the edge and one inner contour (half the shape's inscribed depth). Overlaps never stack: telegraphs render into their own target with MAX blending (premultiplied)
// and are composited once, so a stack of fills stays ≤ 40 %. Identical on every quality tier. FRAY:
// telegraphs stay HARM with the caster's seat colour as a 6 px tick at the origin.

import {
  type Color, CustomBlending, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, MaxEquation, Mesh,
  OneFactor, PlaneGeometry, ShaderMaterial,
} from 'three';
import { DEPTH_TEST_GLSL } from './depth.ts';
import { overlayAttrs, overlayMaterial } from './program.ts';

export const TELE_SHAPE = { circle: 0, ring: 1, cone: 2, rect: 3 } as const;

export interface TeleSpec {
  x: number; z: number;               // anchor (world)
  dir: number;                        // aim direction (sim radians)
  shape: number;                      // TELE_SHAPE
  radius: number; inner: number; halfAngle: number; length: number; width: number;
  color: Color;
  fill: number; edge: number; edgePx: number;
  /** sweep progress 0..1 (delayed areas); ≥ 1 = full */
  sweep: number;
  /** dashed edge (range ring) */
  dashed: boolean;
  /** FRAY caster tick colour (null = none) */
  tick: Color | null;
  /** keyline alpha (default 0.35) */
  key?: number;
  /** combat m-3: a large area's landing flash, the alpha of its edge band and inner contour (0 = none) */
  ringFlash?: number;
  /** the inner contour's depth inside the edge (m) */
  ringDepth?: number;
}

/** combat m-3: a landing flash over an area wider than this (m: circle, ring or cone radius, half a rect's longer
 *  side) lights the edge band and an inner contour instead of the whole fill */
export const FLASH_RING_OVER_M = 4;
/** the depth of a shape's inner contour: half its inscribed radius (circle r/2, ring half its width, cone half the
 *  inscribed circle of the sector, rect a quarter of its width) */
export function flashContourDepth(shape: number, radius: number, inner: number, halfAngle: number, width: number): number {
  if (shape === TELE_SHAPE.circle) return radius * 0.5;
  if (shape === TELE_SHAPE.ring) return Math.max(0.1, (radius - inner) * 0.5);
  if (shape === TELE_SHAPE.cone) { const s = Math.sin(Math.min(Math.PI / 2, halfAngle)); return (radius * s) / (1 + s) * 0.5; }
  return width * 0.25;
}

const MAX = 128;

export const TELE_VERT = /* glsl */`
attribute vec4 aA;      // x, z, dir, shape
attribute vec4 aB;      // radius, inner, halfAngle, length
attribute vec4 aC;      // width, fill, edge, edgePx
attribute vec4 aD;      // sweep, dashed, tick on, keyline alpha
attribute vec4 aColor;     // rgb, landing ring flash alpha (combat m-3)
attribute vec4 aTick;      // FRAY tick rgb, inner contour depth (m)
varying vec2 vLocal; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vColor; varying vec4 vTick;
void main() {
  float shape = aA.w;
  // bounds in the shape's local frame (u along dir, v across)
  vec2 lo, hi;
  if ( shape < 1.5 ) { lo = vec2( -aB.x ); hi = vec2( aB.x ); }
  else if ( shape < 2.5 ) { lo = vec2( -0.2, -aB.x ); hi = vec2( aB.x, aB.x ); }
  else { lo = vec2( -0.2, -aC.x * 0.5 ); hi = vec2( aB.w, aC.x * 0.5 ); }
  lo -= 0.5; hi += 0.5;
  vec2 uv = mix( lo, hi, position.xy + 0.5 );
  vec2 f = vec2( cos( aA.z ), sin( aA.z ) );
  vec2 s = vec2( -f.y, f.x );
  vec2 w = aA.xy + f * uv.x + s * uv.y;
  vLocal = uv;
  vA = aA; vB = aB; vC = aC; vD = aD; vColor = aColor; vTick = aTick;
  gl_Position = projectionMatrix * viewMatrix * vec4( w.x, 0.04, w.y, 1.0 );
}`;

export const TELE_FRAG = /* glsl */`
${DEPTH_TEST_GLSL}
varying vec2 vLocal; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vColor; varying vec4 vTick;
float sdBox( vec2 p, vec2 b ) { vec2 d = abs( p ) - b; return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 ); }
// signed distance to a circular sector (apex at the origin, axis +x, half-angle ha); < 0 inside. The side
// test is the 2D cross c × p: negative while p lies between the axis and the edge ray c = (cos ha, sin ha),
// positive beside or behind the apex (combat F1: the old operand order painted the cone inside-out)
float sdSector( vec2 p, float r, float ha ) {
  p.y = abs( p.y );
  vec2 c = vec2( cos( ha ), sin( ha ) );
  float l = length( p ) - r;
  float m = length( p - c * clamp( dot( p, c ), 0.0, r ) );
  return max( l, m * sign( c.x * p.y - c.y * p.x ) );
}
void main() {
  float shape = vA.w;
  vec2 p = vLocal;
  float d;            // signed distance to the edge (m), < 0 inside
  float prog;         // 0..1 position along the sweep
  if ( shape < 0.5 ) {
    d = length( p ) - vB.x;
    // clockwise from 12 o'clock on SCREEN: rebuild the world offset from the local frame
    vec2 f = vec2( cos( vA.z ), sin( vA.z ) ); vec2 s = vec2( -f.y, f.x );
    vec2 wo = f * p.x + s * p.y;
    prog = atan( wo.x, -wo.y ) / 6.2831853 + 0.5;
    prog = fract( prog + 0.5 );
  } else if ( shape < 1.5 ) {
    float l = length( p );
    d = max( l - vB.x, vB.y - l );
    vec2 f = vec2( cos( vA.z ), sin( vA.z ) ); vec2 s = vec2( -f.y, f.x );
    vec2 wo = f * p.x + s * p.y;
    prog = fract( atan( wo.x, -wo.y ) / 6.2831853 + 1.0 );
  } else if ( shape < 2.5 ) {
    d = sdSector( p, vB.x, vB.z );
    prog = length( p ) / max( vB.x, 1e-3 );
  } else {
    d = sdBox( p - vec2( vB.w * 0.5, 0.0 ), vec2( vB.w * 0.5, vC.x * 0.5 ) );
    prog = p.x / max( vB.w, 1e-3 );
  }
  float px = max( fwidth( d ), 1e-4 );
  float edgeW = vC.w * px;
  // edge band just inside the boundary, keyline 1 px just outside
  float inside = 1.0 - smoothstep( -0.75 * px, 0.75 * px, d );
  float edge = ( 1.0 - smoothstep( edgeW - 0.75 * px, edgeW + 0.75 * px, -d ) ) * inside;
  float key = ( 1.0 - smoothstep( 0.75 * px, 1.75 * px, d ) ) * ( 1.0 - inside );
  if ( vD.y > 0.5 ) {
    vec2 f = vec2( cos( vA.z ), sin( vA.z ) ); vec2 s = vec2( -f.y, f.x );
    vec2 wo = f * p.x + s * p.y;
    float a01 = atan( wo.x, -wo.y ) / 6.2831853 + 0.5;
    float k = fract( a01 * max( 24.0, floor( vB.x * 5.0 ) ) );
    float dash = smoothstep( 0.0, 0.05, k ) * ( 1.0 - smoothstep( 0.5, 0.55, k ) );
    edge *= dash; key *= dash;
  }
  float sweep = vD.x;
  float swept = sweep >= 1.0 ? 1.0 : 1.0 - smoothstep( sweep - 0.004, sweep + 0.004, prog );
  float fillA = vC.y * inside * ( 1.0 - edge ) * swept;
  float edgeA = vC.z * edge;
  float a = max( fillA, edgeA );
  // combat m-3: a large area lands as its edge band (0.35 m) and one inner contour, never a whole-shape wash
  if ( vColor.w > 0.001 ) {
    float depth = -d;
    float band = inside * ( 1.0 - smoothstep( 0.35 - px, 0.35 + px, depth ) );
    float rw = max( 1.5 * px, 0.08 );
    float ring = inside * ( 1.0 - smoothstep( rw - px, rw + px, abs( depth - vTick.w ) ) );
    a = max( a, vColor.w * max( band, ring ) );
  }
  vec3 col = vColor.rgb;
  // the sweep's leading hand: a slim brighter spoke on circles (still the relationship colour)
  if ( sweep < 1.0 && shape < 1.5 ) {
    float lead = ( 1.0 - smoothstep( 0.0, 0.012, abs( prog - sweep ) ) ) * inside;
    a = max( a, lead * min( 1.0, vC.z * 0.7 ) );
  }
  // FRAY: caster seat tick at the origin (6 px)
  if ( vD.z > 0.5 ) {
    float t = 1.0 - smoothstep( 3.0 * px - 0.75 * px, 3.0 * px + 0.75 * px, length( p ) );
    if ( t > 0.0 ) { col = mix( col, vTick.rgb, t ); a = max( a, t ); }
  }
  float k35 = key * vD.w;
  float vis = valeVisible( 0.2 );
  // premultiplied; the keyline is black (rgb 0)
  float outA = max( a, k35 ) * vis;
  if ( outA <= 0.002 ) discard;
  gl_FragColor = vec4( col * a * vis, outA );
}`;

export class TelegraphLayer {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly attrs: InstancedBufferAttribute[];
  private readonly aA: InstancedBufferAttribute;
  private readonly aB: InstancedBufferAttribute;
  private readonly aC: InstancedBufferAttribute;
  private readonly aD: InstancedBufferAttribute;
  private readonly aColor: InstancedBufferAttribute;
  private readonly aTick: InstancedBufferAttribute;
  private count = 0;

  constructor() {
    const quad = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    const mk = (size: number): InstancedBufferAttribute => { const a = new InstancedBufferAttribute(new Float32Array(MAX * size), size); a.setUsage(DynamicDrawUsage); return a; };
    this.aA = mk(4); this.aB = mk(4); this.aC = mk(4); this.aD = mk(4); this.aColor = mk(4); this.aTick = mk(4);
    this.attrs = [this.aA, this.aB, this.aC, this.aD, this.aColor, this.aTick];
    overlayAttrs(this.geo, 'tele', { aA: this.aA, aB: this.aB, aC: this.aC, aD: this.aD, aColor: this.aColor, aTick: this.aTick });
    this.geo.instanceCount = 0;
    const mat = overlayMaterial('tele', {}, {
      // the quad's local (u, v) maps onto world (x, z) without the y flip rings.ts applies, which mirrors
      // the winding: seen from above it is a back face. The shapes are SDFs in world space, so both faces
      // draw the same decal; DoubleSide keeps any aim direction from culling it (r12 B2: 0 px drawn).
      side: DoubleSide,
      transparent: true, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendEquation: MaxEquation, blendSrc: OneFactor, blendDst: OneFactor,
      blendEquationAlpha: MaxEquation, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  begin(): void { this.count = 0; }

  push(t: TeleSpec): void {
    if (this.count >= MAX) return;
    const i = this.count++;
    this.aA.setXYZW(i, t.x, t.z, t.dir, t.shape);
    this.aB.setXYZW(i, t.radius, t.inner, t.halfAngle, t.length);
    this.aC.setXYZW(i, t.width, t.fill, t.edge, t.edgePx);
    this.aD.setXYZW(i, t.sweep, t.dashed ? 1 : 0, t.tick ? 1 : 0, t.key ?? 0.35);
    this.aColor.setXYZW(i, t.color.r, t.color.g, t.color.b, t.ringFlash ?? 0);
    if (t.tick) this.aTick.setXYZW(i, t.tick.r, t.tick.g, t.tick.b, t.ringDepth ?? 0); else this.aTick.setW(i, t.ringDepth ?? 0);
  }

  end(): void {
    this.geo.instanceCount = this.count;
    for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.count * a.itemSize); a.needsUpdate = true; }
    this.mesh.visible = this.count > 0;
  }

  get size(): number { return this.count; }

  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}
