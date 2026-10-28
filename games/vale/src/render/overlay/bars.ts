// VALE render — overhead bars + labels (STYLE_BIBLE "HUD density" overhead row; tokens.json
// `hud.overheadBar`). Drawn in the overlay pass (after the grade), so every hex is the pixel.
//
// ONE instanced draw for every bar, ONE for every label (names, level numbers). Sizes: tokens.json
// hud.overheadBar (r12 M7, raised to read at LoL's gauge in VALE's own shapes):
//   fighter    HP 104×10 over resource 104×4 (1 px gap) on an 80 % ink-1 plate, level chip 22 px on
//              the left, name 14/15 600 with a 2 px ink outline above, 2 px CC bar under the plate
//   minion     58×5: enemies always (on screen), allies when damaged or targeted
//   structure  220×16 with ticks every 25 % and the team glyph (▲ spire = side a, ◠ dome = side b)
//   monster    104×8, Dialstone, no ring until aggro
// HP ticks every 100 (1 px, ink 35 %, hidden when closer than 4 px) and heavy every 1,000 (2 px, ink
// 70 %); lost HP flashes white for ~4 frames (L* 100, the span stands 1 px proud), then the Noonwhite
// damage trail holds 150 ms and shrinks over 450 ms; the shield as a hatched Dawnglass segment (45°,
// 1 px line, 3 px gap) after HP. Your own fill is Sap (#63D88B, the Dial Bar's HP) so your trail
// reads. End shapes per relationship: self double frame, ally rounded, enemy chevron, neutral square. FRAY: other seats in their seat colour (+ 1 px chalk /
// ink keyline where the bible asks), your own seat colour as a 2 px line on top of your plate.
// Bars are a fixed screen size: 1 reference px = max(0.8, height / 1080) × hudScale CSS px.

import {
  CanvasTexture, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter,
  LinearMipmapLinearFilter, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, SRGBColorSpace,
} from 'three';
import { overlayUniforms } from './context.ts';

export const BAR_KIND = { fighter: 0, minion: 1, structure: 2, monster: 3 } as const;
export const SHAPE = { self: 0, ally: 1, enemy: 2, neutral: 3 } as const;
export const GLYPH = { none: 0, spire: 1, dome: 2, chip: 3 } as const;

export interface BarSpec {
  x: number; y: number; z: number;           // world anchor (head + 0.35 m)
  kind: number;                               // BAR_KIND
  shape: number;                              // SHAPE
  hp: number; trail: number; shieldEnd: number; total: number;
  res: number; showRes: boolean; resHatch: boolean; cc: number;
  color: Color; resColor: Color;
  glyph: number;                              // GLYPH
  keyline: 0 | 1 | 2;                         // none, chalk, ink
  seatLine: Color | null;
  alpha: number;
  /** label slot (names) and level */
  nameSlot: number; level: number;
  /** 0..1: the lost-HP flash (1 on the hit, 0 after ~66 ms) */
  flash?: number;
}

/** bar sizes in 1080p reference px (tokens.json hud.overheadBar) */
export const BAR_SIZE = {
  fighter: { w: 104, hp: 10, res: 4 }, minion: { w: 58, hp: 5 }, structure: { w: 220, hp: 16 }, monster: { w: 104, hp: 8 },
  levelChip: 22, nameFontPx: 14, nameLinePx: 15,
} as const;

const MAX = 320;
const NAME_ROWS = 24;
const ATLAS_W = 1024, ATLAS_H = 1024;
const ROW_H = 36;          // atlas px per name row (2× of 14 + outline room)
const DIGIT_ROW_Y = NAME_ROWS * ROW_H;
const DIGIT_W = 28, DIGIT_H = 36;

export const BAR_VERT = /* glsl */`
attribute vec3 aAnchor;
attribute vec4 aBox;      // quad w, quad h (ref px), y offset (ref px), kind
attribute vec4 aHp;       // hp, trail, shieldEnd, total hp (for ticks)
attribute vec4 aRes;      // res, cc, showRes, resHatch
attribute vec4 aCol;      // rgb, shape
attribute vec4 aResCol;   // rgb, alpha
attribute vec4 aSeat;     // rgb, seat line on
attribute vec4 aMisc;     // glyph, keyline, lost-HP flash, -
uniform vec2 uResolution;
uniform float uPxScale;
varying vec2 vP;
varying vec4 vBox; varying vec4 vHp; varying vec4 vRes; varying vec4 vCol; varying vec4 vResCol; varying vec4 vSeat; varying vec4 vMisc;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4( aAnchor, 1.0 );
  if ( clip.w <= 0.0 || aResCol.a <= 0.001 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  vec2 ndc = clip.xy / clip.w;
  vec2 px = floor( ( ndc * 0.5 + 0.5 ) * uResolution ) + 0.5 * mod( vec2( floor( aBox.x * uPxScale + 0.5 ), floor( aBox.y * uPxScale + 0.5 ) ), 2.0 );
  vec2 local = position.xy * aBox.xy;
  vec2 p = px + ( local + vec2( 0.0, aBox.z ) ) * uPxScale;
  gl_Position = vec4( p / uResolution * 2.0 - 1.0, 0.0, 1.0 );
  vP = local;
  vBox = aBox; vHp = aHp; vRes = aRes; vCol = aCol; vResCol = aResCol; vSeat = aSeat; vMisc = aMisc;
}`;

export const BAR_FRAG = /* glsl */`
uniform float uPxScale;
varying vec2 vP;
varying vec4 vBox; varying vec4 vHp; varying vec4 vRes; varying vec4 vCol; varying vec4 vResCol; varying vec4 vSeat; varying vec4 vMisc;
const vec3 INK1 = vec3( 0.005605, 0.006995, 0.010330 );   // #11141A linear
const vec3 NOON = vec3( 0.904661, 0.863157, 0.760525 );   // #F4EFE2
const vec3 GLASS = vec3( 0.715694, 0.799103, 0.854993 );  // #DCE8EE
const vec3 CHALK = vec3( 0.846873, 0.791298, 0.672443 );  // #EDE6D6
const vec3 INK0 = vec3( 0.003347, 0.004025, 0.005605 );   // #0B0D11
const vec3 SAP = vec3( 0.124772, 0.686685, 0.258216 );    // #63D88B (your own fill)
float sdBox( vec2 p, vec2 b ) { vec2 d = abs( p ) - b; return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 ); }
// bar silhouette with the relationship end shape; c = centre, hb = half size
float sdBar( vec2 p, vec2 c, vec2 hb, float shape ) {
  vec2 q = p - c;
  if ( shape > 0.5 && shape < 1.5 ) { float r = hb.y; return sdBox( q, vec2( max( hb.x - r, 0.0 ), 0.0 ) ) - r; }        // ally: rounded
  if ( shape > 1.5 && shape < 2.5 ) {                                                                                    // enemy: chevron
    float k = hb.y * 0.9;
    float d1 = abs( q.y ) - hb.y;
    float d2 = ( abs( q.x ) - ( hb.x - k ) - k * ( 1.0 - abs( q.y ) / hb.y ) ) * hb.y / length( vec2( hb.y, k ) );
    return max( d1, d2 );
  }
  return sdBox( q, hb );
}
float cover( float d ) { float aa = 0.5 / uPxScale; return 1.0 - smoothstep( -aa, aa, d ); }
void over( inout vec4 acc, vec3 c, float a ) { acc.rgb = mix( acc.rgb, c, a ); acc.a = a + acc.a * ( 1.0 - a ); }
void main() {
  float kind = vBox.w, shape = vCol.w;
  float barW = kind < 0.5 ? 104.0 : kind < 1.5 ? 58.0 : kind < 2.5 ? 220.0 : 104.0;
  float hpH = kind < 0.5 ? 10.0 : kind < 1.5 ? 5.0 : kind < 2.5 ? 16.0 : 8.0;
  float showRes = vRes.z;
  float resH = showRes > 0.5 ? 4.0 : 0.0, gap = showRes > 0.5 ? 1.0 : 0.0;
  float pad = kind > 0.5 && kind < 1.5 ? 1.0 : 2.0;
  float bodyH = hpH + gap + resH;
  float hpTop = bodyH * 0.5, hpBot = hpTop - hpH;
  float resTop = hpBot - gap, resBot = resTop - resH;
  vec2 plateC = vec2( 0.0, 0.0 );
  vec2 plateHB = vec2( barW * 0.5 + pad, bodyH * 0.5 + pad );
  vec4 acc = vec4( 0.0 );
  float sh = shape > 2.5 ? 3.0 : shape;               // neutral: square ends
  float plateShape = sh < 0.5 ? 3.0 : sh;              // self: square plate inside a double frame
  float dPlate = sdBar( vP, plateC, plateHB, plateShape );
  // self: double frame (outer 1 px Noonwhite line 2 px outside the plate)
  if ( sh < 0.5 ) {
    float dOuter = sdBox( vP - plateC, plateHB + 2.0 );
    float frame = cover( abs( dOuter + 0.5 ) - 0.5 );
    over( acc, INK0, cover( dOuter ) * ( 1.0 - cover( dPlate ) ) * 0.55 );
    over( acc, NOON, frame );
  }
  over( acc, INK1, cover( dPlate ) * 0.8 );
  // FRAY: your seat colour lines the top of your plate
  if ( vSeat.w > 0.5 ) {
    float top = plateHB.y;
    float line = cover( sdBox( vP - vec2( 0.0, top - 1.0 ), vec2( plateHB.x, 1.0 ) ) );
    over( acc, vSeat.rgb, line );
  }
  // HP row
  vec2 hpC = vec2( 0.0, ( hpTop + hpBot ) * 0.5 );
  vec2 hpHB = vec2( barW * 0.5, hpH * 0.5 );
  float dRow = sdBar( vP, hpC, hpHB, sh < 0.5 ? 3.0 : sh );
  float inRow = cover( dRow );
  float u = ( vP.x + barW * 0.5 ) / barW;             // 0..1 across the bar
  float aa = 0.5 / ( uPxScale * barW );
  float hp = clamp( vHp.x, 0.0, 1.0 ), trail = clamp( vHp.y, 0.0, 1.0 ), shEnd = clamp( vHp.z, 0.0, 1.0 );
  float fHp = 1.0 - smoothstep( hp - aa, hp + aa, u );
  float fTrail = ( 1.0 - smoothstep( trail - aa, trail + aa, u ) ) * ( 1.0 - fHp );
  float fShield = ( 1.0 - smoothstep( shEnd - aa, shEnd + aa, u ) ) * smoothstep( hp - aa, hp + aa, u );
  over( acc, sh < 0.5 ? SAP : vCol.rgb, inRow * fHp );
  // lost HP: a white flash that stands 1 px proud for ~4 frames, then the Noonwhite trail
  float fl = clamp( vMisc.z, 0.0, 1.0 );
  float inPop = fl > 0.001 ? cover( sdBox( vP - hpC, hpHB + vec2( 0.0, 1.0 ) ) ) : inRow;
  over( acc, mix( NOON, vec3( 1.0 ), fl ), inPop * fTrail );
  if ( shEnd > hp + 0.001 ) {
    float hatch = mod( ( vP.x + vP.y ) / 1.41421, 4.0 / 1.41421 * 1.41421 );
    float line = 1.0 - smoothstep( 0.5, 1.0 + 0.5 / uPxScale, abs( hatch - 0.5 ) );
    over( acc, GLASS, inRow * fShield * ( 0.38 + 0.62 * line ) );
  }
  // FRAY keyline around the HP fill (1 px chalk or ink)
  if ( vMisc.y > 0.5 ) {
    vec3 kc = vMisc.y < 1.5 ? CHALK : INK0;
    float edge = cover( abs( dRow + 0.5 ) - 0.5 ) * ( 1.0 - smoothstep( hp, hp + aa * 2.0, u ) );
    over( acc, kc, edge );
  }
  // ticks: light every 100, heavy every 1000 (HP row only); structures: every 25 %
  float total = max( vHp.w, 1.0 );
  if ( kind > 1.5 && kind < 2.5 ) {
    float q = u * 4.0;
    float dq = abs( q - floor( q + 0.5 ) ) * barW * 0.25;
    float notEdgeQ = step( 2.0, vP.x + barW * 0.5 ) * step( 2.0, barW * 0.5 - vP.x );
    over( acc, INK0, inRow * ( 1.0 - smoothstep( 1.0 - 0.25 / uPxScale, 1.0 + 0.25 / uPxScale, dq ) ) * 0.75 * notEdgeQ );
  } else if ( kind < 0.5 || kind > 2.5 ) {
    float spacing = barW * 100.0 / total;
    float t100 = u * total / 100.0;
    float dl = abs( t100 - floor( t100 + 0.5 ) ) * spacing;
    float t1k = u * total / 1000.0;
    float dh = abs( t1k - floor( t1k + 0.5 ) ) * spacing * 10.0;
    float notEdge = step( 0.6, vP.x + barW * 0.5 ) * step( 0.6, barW * 0.5 - vP.x );
    float light = spacing >= 4.0 ? ( 1.0 - smoothstep( 0.5 - 0.25 / uPxScale, 0.5 + 0.25 / uPxScale, dl ) ) * 0.35 : 0.0;
    float heavy = ( 1.0 - smoothstep( 1.0 - 0.25 / uPxScale, 1.0 + 0.25 / uPxScale, dh ) ) * 0.7;
    over( acc, INK0, inRow * max( light, heavy ) * notEdge );
  }
  // resource row
  if ( showRes > 0.5 ) {
    vec2 rC = vec2( 0.0, ( resTop + resBot ) * 0.5 );
    float inRes = cover( sdBox( vP - rC, vec2( barW * 0.5, resH * 0.5 ) ) );
    float fRes = 1.0 - smoothstep( vRes.x - aa, vRes.x + aa, u );
    float a = inRes * fRes;
    if ( vRes.w > 0.5 ) { float hh = mod( vP.x - vP.y, 3.0 ); a *= 0.55 + 0.45 * step( 1.5, hh ); }
    over( acc, vResCol.rgb, a );
  }
  // CC bar: 2 px under the plate
  if ( vRes.y > 0.001 ) {
    float y0 = -plateHB.y - 2.0;
    float ccW = barW * clamp( vRes.y, 0.0, 1.0 );
    float a = cover( sdBox( vP - vec2( -barW * 0.5 + ccW * 0.5, y0 ), vec2( ccW * 0.5, 1.0 ) ) );
    over( acc, INK0, cover( sdBox( vP - vec2( 0.0, y0 ), vec2( barW * 0.5 + 1.0, 2.0 ) ) ) * 0.6 );
    over( acc, CHALK, a );
  }
  // left marks: level chip (fighters) or the side glyph (structures)
  float g = vMisc.x;
  if ( g > 0.5 ) {
    vec2 cc = vec2( -plateHB.x - 3.0 - 11.0, 0.0 );
    if ( g > 2.5 ) {
      float dc = sdBox( vP - cc, vec2( 11.0 ) );
      over( acc, INK1, cover( dc ) * 0.9 );
      over( acc, vCol.rgb, cover( abs( dc + 0.5 ) - 0.5 ) );
    } else if ( g < 1.5 ) {
      // ▲ spire
      vec2 q = vP - cc; q.y += 1.0;
      float k = 1.7320508;
      q.x = abs( q.x ) - 8.0; q.y = q.y + 8.0 / k;
      if ( q.x + k * q.y > 0.0 ) q = vec2( q.x - k * q.y, -k * q.x - q.y ) / 2.0;
      q.x -= clamp( q.x, -16.0, 0.0 );
      float dt = -length( q ) * sign( q.y );
      over( acc, INK1, cover( dt - 1.5 ) * 0.8 );
      over( acc, vCol.rgb, cover( dt ) );
    } else {
      // ◠ dome
      vec2 q = vP - cc + vec2( 0.0, 4.0 );
      float dd = max( length( q ) - 9.0, -q.y );
      over( acc, INK1, cover( dd - 1.5 ) * 0.8 );
      over( acc, vCol.rgb, cover( dd ) );
    }
  }
  if ( acc.a <= 0.002 ) discard;
  gl_FragColor = vec4( acc.rgb, acc.a * vResCol.a );
}`;

export const LABEL_VERT = /* glsl */`
attribute vec3 aAnchor;
attribute vec4 aRect;     // offset x, offset y (ref px, centre), w, h (ref px)
attribute vec4 aUv;       // u0, v0, u1, v1
attribute vec4 aTint;     // rgb, alpha
uniform vec2 uResolution;
uniform float uPxScale;
varying vec2 vUv; varying vec4 vTint;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4( aAnchor, 1.0 );
  if ( clip.w <= 0.0 || aTint.a <= 0.001 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  vec2 px = floor( ( clip.xy / clip.w * 0.5 + 0.5 ) * uResolution );
  vec2 p = px + ( aRect.xy + position.xy * aRect.zw ) * uPxScale;
  gl_Position = vec4( p / uResolution * 2.0 - 1.0, 0.0, 1.0 );
  vUv = mix( aUv.xy, aUv.zw, position.xy + 0.5 );
  vTint = aTint;
}`;
export const LABEL_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vUv; varying vec4 vTint;
void main() {
  vec4 t = texture2D( uAtlas, vUv );
  if ( t.a < 0.01 ) discard;
  gl_FragColor = vec4( t.rgb * vTint.rgb, t.a * vTint.a );
}`;

function attr(n: number, size: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(n * size), size);
  a.setUsage(DynamicDrawUsage);
  return a;
}

export class BarLayer {
  readonly mesh: Mesh;
  readonly labels: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly lgeo: InstancedBufferGeometry;
  private readonly a: Record<string, InstancedBufferAttribute>;
  private readonly la: Record<string, InstancedBufferAttribute>;
  private count = 0;
  private lcount = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlas: CanvasTexture;
  private readonly slots = new Map<string, number>();
  private readonly slotWidth: number[] = [];
  private nextSlot = 0;
  private fontsReady = false;
  readonly uniforms = { uPxScale: { value: 1 }, uResolution: overlayUniforms.uResolution };

  constructor() {
    const quad = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.a = {
      aAnchor: attr(MAX, 3), aBox: attr(MAX, 4), aHp: attr(MAX, 4), aRes: attr(MAX, 4), aCol: attr(MAX, 4),
      aResCol: attr(MAX, 4), aSeat: attr(MAX, 4), aMisc: attr(MAX, 4),
    };
    overlayAttrs(this.geo, 'bar', this.a);
    this.geo.instanceCount = 0;
    const mat = overlayMaterial('bar', this.uniforms, { transparent: true, depthTest: false, depthWrite: false, blending: NormalBlending });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;

    // label atlas (names + level numbers)
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W; this.canvas.height = ATLAS_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.atlas = new CanvasTexture(this.canvas);
    this.atlas.colorSpace = SRGBColorSpace;
    this.atlas.minFilter = LinearMipmapLinearFilter;
    this.atlas.magFilter = LinearFilter;
    this.atlas.generateMipmaps = true;
    this.atlas.premultiplyAlpha = false;
    this.drawDigits();
    this.lgeo = new InstancedBufferGeometry();
    this.lgeo.index = quad.index;
    this.lgeo.setAttribute('position', quad.getAttribute('position'));
    this.la = { aAnchor: attr(MAX, 3), aRect: attr(MAX, 4), aUv: attr(MAX, 4), aTint: attr(MAX, 4) };
    overlayAttrs(this.lgeo, 'label', this.la);
    this.lgeo.instanceCount = 0;
    const lmat = overlayMaterial('label', { uPxScale: this.uniforms.uPxScale, uAtlas: { value: this.atlas } }, { transparent: true, depthTest: false, depthWrite: false, blending: NormalBlending });
    this.labels = new Mesh(this.lgeo, lmat);
    this.labels.frustumCulled = false;
    this.labels.renderOrder = 21;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      Promise.all([
        fonts.load('600 28px "Atkinson Hyperlegible Next"').catch(() => []),
        fonts.load('700 26px "Atkinson Hyperlegible Mono"').catch(() => []),
      ]).then(() => { this.fontsReady = true; this.redrawAll(); });
    }
  }

  /** names at 2× the 14 px overhead size (bible: overhead name 14/15 600, 2 px ink outline) */
  private nameFont(): string { return '600 28px "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif'; }

  private drawDigits(): void {
    const c = this.ctx;
    c.clearRect(0, DIGIT_ROW_Y, ATLAS_W, ATLAS_H - DIGIT_ROW_Y);
    c.font = '700 25px "Atkinson Hyperlegible Mono", ui-monospace, monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let n = 1; n <= 60; n++) {
      const col = (n - 1) % 36, row = Math.floor((n - 1) / 36);
      const cx = col * DIGIT_W + DIGIT_W / 2, cy = DIGIT_ROW_Y + row * DIGIT_H + DIGIT_H / 2 + 1;
      c.fillStyle = '#EDE6D6';
      c.save();
      if (n >= 10) { c.translate(cx, cy); c.scale(0.78, 1); c.fillText(String(n), 0, 0); } else c.fillText(String(n), cx, cy);
      c.restore();
    }
    this.atlas.needsUpdate = true;
  }

  private drawName(slot: number, text: string): void {
    const c = this.ctx;
    const y = slot * ROW_H;
    c.clearRect(0, y, ATLAS_W, ROW_H);
    c.font = this.nameFont();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 4;   // 2 px outline at 1×
    c.strokeStyle = 'rgba(11,13,17,0.92)';
    const w = Math.min(ATLAS_W - 8, Math.ceil(c.measureText(text).width) + 8);
    c.strokeText(text, ATLAS_W / 2, y + ROW_H / 2 + 1, ATLAS_W - 12);
    c.fillStyle = '#EDE6D6';
    c.fillText(text, ATLAS_W / 2, y + ROW_H / 2 + 1, ATLAS_W - 12);
    this.slotWidth[slot] = w;
    this.atlas.needsUpdate = true;
  }

  private redrawAll(): void {
    for (const [text, slot] of this.slots) this.drawName(slot, text);
    this.drawDigits();
  }

  /** a stable atlas slot for a name (−1 when the atlas is full) */
  nameSlot(text: string): number {
    if (!text) return -1;
    let s = this.slots.get(text);
    if (s !== undefined) return s;
    if (this.nextSlot >= NAME_ROWS) return -1;
    s = this.nextSlot++;
    this.slots.set(text, s);
    this.drawName(s, text);
    return s;
  }

  get ready(): boolean { return this.fontsReady; }

  begin(pxScale: number): void {
    this.count = 0; this.lcount = 0;
    this.uniforms.uPxScale.value = pxScale;
  }

  push(b: BarSpec): void {
    if (this.count >= MAX) return;
    const i = this.count++;
    const isF = b.kind === BAR_KIND.fighter;
    const barW = isF ? BAR_SIZE.fighter.w : b.kind === BAR_KIND.minion ? BAR_SIZE.minion.w : b.kind === BAR_KIND.structure ? BAR_SIZE.structure.w : BAR_SIZE.monster.w;
    const quadW = barW + 2 * (2 + 3 + BAR_SIZE.levelChip + 4) + 8;
    const quadH = 44;
    const A = this.a;
    A.aAnchor.setXYZ(i, b.x, b.y, b.z);
    A.aBox.setXYZW(i, quadW, quadH, 0, b.kind);
    A.aHp.setXYZW(i, b.hp, b.trail, b.shieldEnd, b.total);
    A.aRes.setXYZW(i, b.res, b.cc, b.showRes ? 1 : 0, b.resHatch ? 1 : 0);
    A.aCol.setXYZW(i, b.color.r, b.color.g, b.color.b, b.shape);
    A.aResCol.setXYZW(i, b.resColor.r, b.resColor.g, b.resColor.b, b.alpha);
    if (b.seatLine) A.aSeat.setXYZW(i, b.seatLine.r, b.seatLine.g, b.seatLine.b, 1); else A.aSeat.setXYZW(i, 0, 0, 0, 0);
    A.aMisc.setXYZW(i, b.glyph, b.keyline, b.flash ?? 0, 0);
    if (isF) {
      const bodyH = BAR_SIZE.fighter.hp + (b.showRes ? BAR_SIZE.fighter.res + 1 : 0);
      const plateTop = bodyH / 2 + 2 + (b.shape === SHAPE.self ? 2 : 0);
      if (b.nameSlot >= 0) this.pushLabel(b, 0, plateTop + 2 + BAR_SIZE.nameLinePx / 2, (this.slotWidth[b.nameSlot] ?? 200) / 2, ROW_H / 2,
        (ATLAS_W / 2 - (this.slotWidth[b.nameSlot] ?? 200) / 2) / ATLAS_W, 1 - (b.nameSlot * ROW_H + ROW_H) / ATLAS_H,
        (ATLAS_W / 2 + (this.slotWidth[b.nameSlot] ?? 200) / 2) / ATLAS_W, 1 - (b.nameSlot * ROW_H) / ATLAS_H, 1, 1, 1);
      if (b.level > 0) {
        const n = Math.min(60, Math.max(1, Math.round(b.level)));
        const col = (n - 1) % 36, row = Math.floor((n - 1) / 36);
        const u0 = (col * DIGIT_W) / ATLAS_W, u1 = ((col + 1) * DIGIT_W) / ATLAS_W;
        const v1 = 1 - (DIGIT_ROW_Y + row * DIGIT_H) / ATLAS_H, v0 = 1 - (DIGIT_ROW_Y + (row + 1) * DIGIT_H) / ATLAS_H;
        const cx = -(barW / 2 + 2) - 3 - BAR_SIZE.levelChip / 2;
        this.pushLabel(b, cx, 0.5, DIGIT_W * 0.58, DIGIT_H * 0.58, u0, v0, u1, v1, 1, 1, 1);
      }
    }
  }

  private pushLabel(b: BarSpec, ox: number, oy: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number, r: number, g: number, bl: number): void {
    if (this.lcount >= MAX) return;
    const j = this.lcount++;
    const L = this.la;
    L.aAnchor.setXYZ(j, b.x, b.y, b.z);
    L.aRect.setXYZW(j, ox, oy, w, h);
    L.aUv.setXYZW(j, u0, v0, u1, v1);
    L.aTint.setXYZW(j, r, g, bl, b.alpha);
  }

  end(): void {
    this.geo.instanceCount = this.count;
    for (const v of Object.values(this.a)) { v.clearUpdateRanges(); v.addUpdateRange(0, this.count * v.itemSize); v.needsUpdate = true; }
    this.lgeo.instanceCount = this.lcount;
    for (const v of Object.values(this.la)) { v.clearUpdateRanges(); v.addUpdateRange(0, this.lcount * v.itemSize); v.needsUpdate = true; }
    this.mesh.visible = this.count > 0;
    this.labels.visible = this.lcount > 0;
  }

  dispose(): void {
    this.geo.dispose(); this.lgeo.dispose(); this.atlas.dispose();
    (this.mesh.material as ShaderMaterial).dispose(); (this.labels.material as ShaderMaterial).dispose();
  }
}

export const _barColor = Color;
