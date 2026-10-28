// VALE render — foliage motion (r12 M11): the Needlegrass's reaction to units and the Dialwood's sway.
// Presentation only: nothing here reads or writes the sim; it is fed the interpolated actor positions the
// renderer already draws.
//
//   brush   a field of ≤ 16 unit discs (one vec4 uniform array: x, z, body radius, bend; a second packs the fade
//           of each slot four to a vec4) that the renderer fills every frame with the units the VIEWER SEES
//           (renderer.feedBrush: the actors' own visibility — the sim's visibleMask, i.e. vision, thickets and
//           invisibility already applied), so a blade never moves for a unit the viewer could not see: an enemy
//           in brush you have no vision of leaves the grass exactly as it was. Blades within 0.8 m of a unit's
//           body bend away from it, eased in over 120 ms and out over 400 ms (a unit that walks on drops a short
//           wake of discs that settle back the same way); within 1.2 m of your own fighter or an allied fighter
//           they fade to 35 % (alpha), back to full by 1.6 m. Only units near a thicket take a slot: your fighter
//           first, then allied fighters, then every other unit by strength, then the wakes.
//           One instanced draw per 24 m chunk, as before (the bend runs in the vertex shader). On a tier without
//           screen-space AO (Low) the clump bakes its own occlusion (× 0.55 at the foot → × 0.8 at the tip), so the
//           brush keeps the dark band it has with AO on.
//   sway    Dialwood crowns: the tip moves ≤ 4 cm at 0.2–0.4 Hz (three partials at 0.21, 0.29 and 0.37 Hz),
//           each tree its own phase (a hash of its position), weighted by the vertex's height (the root flare
//           stays put), one wind direction for the map. The trees' shadow depth material runs the same code,
//           so the shadows sway with the crowns.

import { Vector4 } from 'three';

export const BRUSH_SLOTS = 16;
/** r12 M11 brush numbers: metres, seconds, alpha */
export const BRUSH = {
  reach: 0.8,          // a blade bends when it is within this far of a unit's body
  fadeIn: 1.2,         // ... fades to `fadeAlpha` within this far of your fighter / an allied fighter's centre
  fadeOut: 1.6,        // ... and is back to full by here
  fadeAlpha: 0.35,
  easeIn: 0.12,        // bend / fade eased in over 120 ms
  easeOut: 0.4,        // and out over 400 ms
  bend: 0.7,           // horizontal lean of a blade's tip at full bend (m)
  wakeStep: 0.45,      // a moving unit drops a wake disc every this many metres
  maxWakes: 32,
} as const;

interface Track { x: number; y: number; r: number; prio: number; s: number; on: boolean; wx: number; wy: number }
interface Wake { x: number; y: number; r: number; s: number }
export interface BrushSlot { x: number; y: number; r: number; bend: number; fade: number }

const ease = (s: number): number => s * s * (3 - 2 * s);

export class BrushField {
  /** shared by reference with the Needlegrass material (and its shadow depth material) */
  readonly uniforms = {
    uBrush: { value: Array.from({ length: BRUSH_SLOTS }, () => new Vector4()) },
    uBrushFade: { value: Array.from({ length: BRUSH_SLOTS / 4 }, () => new Vector4()) },
    uBrushN: { value: 0 },
  };
  private readonly tracks = new Map<number, Track>();
  private wakes: Wake[] = [];
  private readonly near: (x: number, y: number, reach: number) => boolean;

  /** `near(x, y, reach)`: is a thicket within `reach` of the point (only those units take a slot) */
  constructor(near: (x: number, y: number, reach: number) => boolean) {
    this.near = near;
  }

  begin(): void {
    for (const t of this.tracks.values()) t.on = false;
  }

  /** a unit the viewer SEES this frame (sim x, y; body radius); prio 2 your fighter and 1 an allied fighter
   *  (both also fade the blades round them), 0 any other unit (bend only) */
  push(id: number, x: number, y: number, r: number, prio: number): void {
    if (!this.near(x, y, r + BRUSH.fadeOut)) return;
    let t = this.tracks.get(id);
    if (!t) { t = { x, y, r, prio, s: 0, on: true, wx: x, wy: y }; this.tracks.set(id, t); }
    t.on = true; t.r = r; t.prio = prio;
    if (Math.hypot(x - t.wx, y - t.wy) > BRUSH.wakeStep) {
      if (t.s > 0.05) this.wakes.push({ x: t.wx, y: t.wy, r: t.r, s: t.s });
      t.wx = x; t.wy = y;
    }
    t.x = x; t.y = y;
  }

  /** advance the envelopes by dt seconds and pack the slots. A unit no longer pushed (left the brush, died, or
   *  left the viewer's vision) eases out where it was last SEEN: the field never learns where it went. */
  end(dt: number): void {
    const up = dt / BRUSH.easeIn, down = dt / BRUSH.easeOut;
    for (const [id, t] of this.tracks) {
      t.s = t.on ? Math.min(1, t.s + up) : Math.max(0, t.s - down);
      if (!t.on && t.s <= 0) this.tracks.delete(id);
    }
    if (this.wakes.length) {
      for (const w of this.wakes) w.s -= down;
      this.wakes = this.wakes.filter((w) => w.s > 0);
      if (this.wakes.length > BRUSH.maxWakes) this.wakes.splice(0, this.wakes.length - BRUSH.maxWakes);
    }
    const ts = [...this.tracks.values()].filter((t) => t.s > 0).sort((a, b) => b.prio - a.prio || b.s - a.s);
    const ws = this.wakes.length > BRUSH_SLOTS ? this.wakes.slice().sort((a, b) => b.s - a.s) : this.wakes;
    const U = this.uniforms.uBrush.value, F = this.uniforms.uBrushFade.value;
    for (const f of F) f.set(0, 0, 0, 0);
    let n = 0;
    for (const t of ts) {
      if (n >= BRUSH_SLOTS) break;
      const e = ease(t.s);
      U[n].set(t.x, t.y, t.r, e);
      if (t.prio > 0) F[n >> 2].setComponent(n & 3, e);
      n++;
    }
    for (const w of ws) {
      if (n >= BRUSH_SLOTS) break;
      U[n].set(w.x, w.y, w.r, ease(Math.min(1, w.s)));
      n++;
    }
    this.uniforms.uBrushN.value = n;
  }

  /** the packed slots (harness: shot_foliage.mjs reads them to show which units the grass reacts to) */
  snapshot(): BrushSlot[] {
    const U = this.uniforms.uBrush.value, F = this.uniforms.uBrushFade.value;
    const out: BrushSlot[] = [];
    for (let i = 0; i < this.uniforms.uBrushN.value; i++) {
      out.push({ x: +U[i].x.toFixed(2), y: +U[i].y.toFixed(2), r: +U[i].z.toFixed(2), bend: +U[i].w.toFixed(3), fade: +F[i >> 2].getComponent(i & 3).toFixed(3) });
    }
    return out;
  }

  clear(): void {
    this.tracks.clear(); this.wakes = []; this.uniforms.uBrushN.value = 0;
  }
}

const f = (x: number): string => x.toFixed(4);
/** the Needlegrass's baked occlusion when the tier has no screen-space AO: × foot → × tip (linear) */
const GRASS_NO_AO = [0.55, 0.8] as const;

/** Needlegrass vertex code (after #include <begin_vertex>): the T0 wind sway, then the brush's bend and fade.
 *  `position.y / 1.25` is the blade's height fraction (the clump is authored ≤ 1.3 m). */
export const GRASS_VERT_PARS = /* glsl */`
uniform float uWindT;
uniform float uGrassAO;
uniform vec4 uBrush[ ${BRUSH_SLOTS} ];
uniform vec4 uBrushFade[ ${BRUSH_SLOTS / 4} ];
uniform int uBrushN;
varying float vBrushA;`;

export const GRASS_VERT_MAIN = /* glsl */`
{
  #ifdef USE_INSTANCING
  vec2 base = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
  vec3 wp0 = ( instanceMatrix * vec4( position, 1.0 ) ).xyz;
  float ksx = max( length( instanceMatrix[0].xyz ), 1e-3 ), ksy = max( length( instanceMatrix[1].xyz ), 1e-3 );
  #else
  vec2 base = vec2( 0.0 );
  vec3 wp0 = position;
  float ksx = 1.0, ksy = 1.0;
  #endif
  float hf = clamp( position.y / 1.25, 0.0, 1.0 );
  #ifdef USE_COLOR
  // no screen-space AO on this tier (Low): the clump's own occlusion, deepest at the foot, so the brush keeps the
  // dark band it has with AO on (r12 M11)
  vColor.rgb *= mix( mix( ${f(GRASS_NO_AO[0])}, ${f(GRASS_NO_AO[1])}, hf ), 1.0, uGrassAO );
  #endif
  float ph = base.x * 0.37 + base.y * 0.53;
  // T0 ambient: slow sway, at most 0.5 Hz
  float sway = sin( uWindT * 2.2 + ph ) * 0.05 + sin( uWindT * 1.3 + ph * 1.7 ) * 0.03;
  transformed.x += sway * hf * hf;
  transformed.z += sway * 0.6 * hf * hf;
  // r12 M11: lean away from the units the viewer sees, fade round your own and allied fighters
  vec2 push = vec2( 0.0 );
  float fade = 0.0;
  for ( int i = 0; i < ${BRUSH_SLOTS}; i ++ ) {
    if ( i >= uBrushN ) break;
    vec4 u = uBrush[ i ];
    vec2 d = wp0.xz - u.xy;
    float l = length( d ) + 1e-4;
    push += d / l * ( ( 1.0 - smoothstep( u.z * 0.5, u.z + ${f(BRUSH.reach)}, l ) ) * u.w );
    vec4 fq = uBrushFade[ i / 4 ];
    int c = i - ( i / 4 ) * 4;
    float fa = c == 0 ? fq.x : c == 1 ? fq.y : c == 2 ? fq.z : fq.w;
    fade = max( fade, fa * ( 1.0 - smoothstep( ${f(BRUSH.fadeIn)}, ${f(BRUSH.fadeOut)}, l ) ) );
  }
  float pl = length( push );
  if ( pl > 1.0 ) { push /= pl; pl = 1.0; }
  float lean = ${f(BRUSH.bend)} * pl * pow( hf, 1.4 );
  vec2 off = pl > 1e-4 ? push / pl * lean : vec2( 0.0 );
  #ifdef USE_INSTANCING
  // world offset → the instance's frame (turned about the vertical, scaled ksx across, ksy up)
  vec3 lo = ( vec3( off.x, 0.0, off.y ) * mat3( instanceMatrix ) ) / ( ksx * ksx );
  #else
  vec3 lo = vec3( off.x, 0.0, off.y );
  #endif
  transformed.xz += lo.xz;
  // the blade keeps its length as it leans: the tip comes down
  transformed.y -= min( lean * lean / ( 2.0 * max( wp0.y, 0.25 ) ), wp0.y * 0.6 ) / ksy;
  vBrushA = mix( 1.0, ${f(BRUSH.fadeAlpha)}, fade );
}`;

/** Dialwood sway (r12 M11): the numbers the shader is built from (the harness checks the bound) */
export const SWAY = {
  tip: 0.046,                                   // m; the partials' weights below sum (as a vector) to ≤ 0.863 → ≤ 4.0 cm
  hz: [0.21, 0.29, 0.37] as const,
  w: [0.6, 0.15, 0.25] as const,                // 0.21 Hz and 0.37 Hz along the wind, 0.29 Hz across it
  wind: [0.86, 0.51] as const,                  // the map's wind direction (x, z)
  h0: 0.3, h1: 3.0,                             // the height weight: 0 at the root flare (authored m) → 1 at 3 m
} as const;

export const TREE_SWAY_PARS = /* glsl */`uniform float uSwayT;`;

export const TREE_SWAY_MAIN = /* glsl */`
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float isc = max( length( instanceMatrix[0].xyz ), 1e-3 );
  float ph = 6.2831853 * fract( sin( dot( ip.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  float hw = smoothstep( ${f(SWAY.h0)}, ${f(SWAY.h1)}, position.y );
  float t = uSwayT * 6.2831853;
  float a = ${f(SWAY.w[0])} * sin( ${f(SWAY.hz[0])} * t + ph ) + ${f(SWAY.w[2])} * sin( ${f(SWAY.hz[2])} * t + ph * 1.9 + 1.3 );
  float b = ${f(SWAY.w[1])} * sin( ${f(SWAY.hz[1])} * t + ph * 2.7 + 0.4 );
  vec2 wd = vec2( ${f(SWAY.wind[0])}, ${f(SWAY.wind[1])} );
  vec2 off = ( wd * a + vec2( -wd.y, wd.x ) * b ) * ( ${f(SWAY.tip)} * hw );
  // a world offset (the tip moves the same few centimetres on a sapling and a giant)
  transformed += ( vec3( off.x, 0.0, off.y ) * mat3( instanceMatrix ) ) / ( isc * isc );
}
#endif`;

// ── ambient props: cloth sway (ambient.ts; here so the ink shadow program can run it too) ─────────────────────────
/** the cloth sway's constants (≤ 0.5 Hz, tokens vfx.tiers.T0): two partials, the free edge lags the attached one */
export const CLOTH = { hz: [0.23, 0.41] as const, w: [0.75, 0.25] as const, lag: 2.1, across: 0.3 } as const;
export const CLOTH_PARS = /* glsl */`
attribute float _sway;
uniform float uAmbT;
uniform float uSwayAmp;`;
export const CLOTH_MAIN = /* glsl */`
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float ph = 6.2831853 * fract( sin( dot( ip.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  float w = _sway;
  float t = uAmbT * 6.2831853;
  float a = ${f(CLOTH.w[0])} * sin( ${f(CLOTH.hz[0])} * t + ph - ${f(CLOTH.lag)} * w ) + ${f(CLOTH.w[1])} * sin( ${f(CLOTH.hz[1])} * t + ph * 1.7 - ${f(CLOTH.lag * 1.6)} * w );
  float b = sin( ${f(CLOTH.hz[1])} * t + ph * 2.3 - ${f(CLOTH.lag)} * w );
  float amp = uSwayAmp * w;
  // the cloth swings out of its plane (local z), a little across it, and lifts as it swings
  transformed += vec3( ${f(CLOTH.across)} * b * amp, -0.35 * a * a * amp * w, a * amp );
}
#endif`;
// (the shadow depth of the swaying casters is the ink program's rigid path with uSway set: ink.ts swayDepth)
