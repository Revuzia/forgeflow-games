// Two batches that turn "one mesh per piece" into "one draw per level":
//   BoxBatch  every box-shaped thing that moves or changes - doors, platforms, crates, pressure
//             plates, the exit's shutter, and Fire's wood, ice, wax, rope and weak walls - as
//             instances of one unit box. What an instance is and what state it is in ride in a
//             per-instance attribute; the fragment shader draws it (flat colour, drawn lines).
//   Bits      little unlit lumps - coals, ember piles, lantern glass, drops, checkpoint bulbs -
//             as instances of one faceted ball with a colour each.
// A level three times as long has three times the pieces and exactly the same number of draws.

import * as THREE from '../../vendor/three.module.min.js';
import { toon, inkless, INK } from './geo.js';

export const BOX = { wood: 0, ice: 1, wax: 2, weak: 3, rope: 4, door: 5, mover: 6, crate: 7, plate: 8, heavy: 9, shutter: 10 };

const BOX_VERT_PARS = 'attribute vec4 aKS;\nvarying vec3 vBoxP;\nvarying vec3 vBoxN;\nvarying vec3 vBoxS;\nvarying vec4 vKS;';
const BOX_VERT = `
	#ifdef USE_INSTANCING
		vec3 boxScale = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
	#else
		vec3 boxScale = vec3( 1.0 );
	#endif
	vBoxP = position * boxScale; vBoxN = normal; vBoxS = boxScale; vKS = aKS;`;
const BOX_FRAG_PARS = 'varying vec3 vBoxP;\nvarying vec3 vBoxN;\nvarying vec3 vBoxS;\nvarying vec4 vKS;\nuniform float uBoxTime;\nuniform vec3 uMetal, uMetalLine, uAccent;';
// kind: see BOX. state: 0..1 (burnt / melted / sagged / open / pressed / moving). Colours are linear.
const BOX_FRAG = `
	{
		vec3 an = abs( vBoxN );
		bool topF = vBoxN.y > 0.5;
		vec2 fuv = an.y > 0.5 ? vBoxP.xz : ( an.x > 0.5 ? vBoxP.zy : vBoxP.xy );      // metres on the face (sides: up from the base)
		vec2 fsz = an.y > 0.5 ? vBoxS.xz : ( an.x > 0.5 ? vBoxS.zy : vBoxS.xy );      // the face's size
		vec2 q = an.y > 0.5 ? fuv : vec2( fuv.x, fuv.y - fsz.y * 0.5 );                // the same, centred
		vec2 eb = fsz * 0.5 - abs( q );
		float edge = min( eb.x, eb.y );                                               // metres in from the face's border
		float kind = vKS.x, st = vKS.y;
		vec3 base = vec3( 1.0 ); vec3 lit = vec3( 0.0 );
		if ( kind < 0.5 || ( kind > 3.5 && kind < 4.5 ) ) {
			float seam = 1.0, grain = 0.5;
			if ( kind < 0.5 ) {
				// timber: boards in two honey tones, drawn seams, a grain line, a nail near each end
				float board = fract( fuv.y / 0.27 ), row = floor( fuv.y / 0.27 );
				seam = smoothstep( 0.04, 0.09, board ) * smoothstep( 0.04, 0.09, 1.0 - board );
				float tone = step( 0.5, fract( sin( row * 12.9898 ) * 43758.5453 ) );
				base = mix( vec3( 0.62, 0.29, 0.09 ), vec3( 0.74, 0.38, 0.13 ), tone );
				float g = abs( board - 0.5 - 0.1 * sin( fuv.x * 2.3 + row * 4.7 ) );
				base = mix( base, vec3( 0.36, 0.15, 0.045 ), ( 1.0 - smoothstep( 0.02, 0.05, g ) ) * 0.55 );
				base = mix( vec3( 0.2, 0.075, 0.025 ), base, seam );
				float nail = 1.0 - smoothstep( 0.018, 0.03, length( vec2( fract( fuv.x / 1.1 ) * 1.1 - 0.12, board * 0.27 - 0.135 ) ) );
				base = mix( base, vec3( 0.12, 0.05, 0.03 ), nail );
				base = mix( base, vec3( 0.2, 0.075, 0.025 ), 1.0 - smoothstep( 0.03, 0.055, edge ) );
			} else {
				// rope: a twist of two strands
				grain = step( 0.5, fract( vBoxP.y * 7.0 + ( vBoxP.x + vBoxP.z ) * 9.0 ) );
				base = mix( vec3( 0.5, 0.3, 0.1 ), vec3( 0.8, 0.6, 0.3 ), grain );
			}
			// burning: it chars from the edges in, black with fire running in the cracks
			float ch = smoothstep( 0.0, 0.45, st );
			float crack = 1.0 - smoothstep( 0.0, 0.26, abs( sin( fuv.x * 7.0 + sin( fuv.y * 5.0 ) * 2.0 ) * sin( fuv.y * 6.0 + fuv.x * 1.3 ) ) );
			float creep = smoothstep( 0.0, 0.5, st * 1.6 - edge * 1.5 );
			base = mix( base, vec3( 0.035, 0.02, 0.03 ), max( ch * 0.9, creep * step( 0.001, st ) ) );
			float flick = 0.75 + 0.25 * sin( uBoxTime * 9.0 + fuv.x * 5.0 + fuv.y * 3.0 );
			lit = vec3( 1.0, 0.42, 0.06 ) * ( crack * ch * 1.5 + ( 1.0 - seam ) * ch * 0.8 ) * flick
				+ vec3( 1.0, 0.6, 0.1 ) * step( 0.001, st ) * ( 1.0 - smoothstep( 0.0, 0.08, abs( st * 1.6 - edge * 1.5 - 0.25 ) ) ) * ( 1.0 - st );
		} else if ( kind < 1.5 ) {
			// ice: a drawn block of it - a blue body, a paler block seen inside, two shine strokes, a frosted
			// top, cracks, a deep-blue edge. Mostly its own colour (see below), so no lamp can bleach it.
			vec3 body = topF ? vec3( 0.62, 0.86, 1.0 ) : mix( vec3( 0.2, 0.5, 0.9 ), vec3( 0.3, 0.62, 0.96 ), step( 0.5, fuv.y / max( fsz.y, 0.01 ) ) );
			float inner = smoothstep( 0.2, 0.22, edge ) * ( 1.0 - smoothstep( 0.27, 0.29, edge ) );
			base = mix( body, vec3( 0.58, 0.84, 1.0 ), step( 0.24, edge ) * 0.6 );
			base = mix( base, vec3( 0.86, 0.96, 1.0 ), inner );
			float diag = fract( ( q.x + q.y ) / max( min( fsz.x, fsz.y ), 0.4 ) * 0.9 + 0.3 );
			base = mix( base, vec3( 1.0 ), ( step( 0.1, diag ) * step( diag, 0.2 ) + step( 0.27, diag ) * step( diag, 0.31 ) ) * step( 0.12, edge ) );
			float crack = abs( q.x + 0.18 * sin( q.y * 5.0 + vKS.w ) - 0.12 * fsz.x * sin( vKS.w * 3.0 ) );
			base = mix( base, vec3( 0.1, 0.3, 0.72 ), ( 1.0 - smoothstep( 0.012, 0.03, crack ) ) * step( q.y, 0.1 * fsz.y ) * 0.8 );
			base = mix( vec3( 0.08, 0.26, 0.66 ), base, smoothstep( 0.05, 0.075, edge ) );
			// melting: it darkens and wets from the top down
			base = mix( base, vec3( 0.2, 0.5, 0.9 ), st * 0.45 );
			lit = base * 0.62;
			base *= 0.42;
		} else if ( kind < 2.5 ) {
			// wax: a fat candle block - warm cream, a paler top that has run down its sides in scallops
			// drawn with a brown line, soft bands below; it glows from inside as it softens
			vec3 body = mix( vec3( 0.86, 0.6, 0.2 ), vec3( 0.95, 0.72, 0.28 ), step( 0.5, fract( fuv.y / 0.5 ) ) );
			if ( !topF ) {
				float run = 0.2 + 0.13 * sin( fuv.x * 8.0 + vKS.w ) + 0.07 * sin( fuv.x * 21.0 + 1.3 ) + 0.35 * st;
				float d = fsz.y - fuv.y - run;
				base = mix( body, vec3( 1.0, 0.9, 0.56 ), step( d, 0.0 ) );
				base = mix( base, vec3( 0.5, 0.26, 0.06 ), 1.0 - smoothstep( 0.012, 0.03, abs( d ) ) );
				// a drip or two that got further
				float drip = abs( fract( fuv.x / 0.7 + vKS.w * 0.37 ) - 0.5 ) * 0.7;
				base = mix( base, vec3( 1.0, 0.9, 0.56 ), step( drip, 0.035 ) * step( d, 0.34 ) * step( 0.0, d ) );
			} else {
				base = vec3( 1.0, 0.9, 0.56 );
				base = mix( base, vec3( 0.5, 0.26, 0.06 ), 1.0 - smoothstep( 0.03, 0.05, length( q ) ) );      // the wick
			}
			base = mix( vec3( 0.5, 0.26, 0.06 ), base, smoothstep( 0.04, 0.065, edge ) );
			base = mix( base, vec3( 1.0, 0.72, 0.2 ), st * ( 1.0 - st * 0.5 ) * 0.5 );
			lit = base * 0.6;
			base *= 0.44;
		} else if ( kind < 3.5 ) {
			// weak wall: pale brick, bold cracks with light behind them
			vec2 b = vec2( fuv.x / 0.5 + step( 1.0, mod( fuv.y / 0.25, 2.0 ) ) * 0.5, fuv.y / 0.25 );
			vec2 bf = fract( b );
			float mortar = smoothstep( 0.03, 0.07, bf.x ) * smoothstep( 0.03, 0.07, 1.0 - bf.x ) * smoothstep( 0.06, 0.14, bf.y ) * smoothstep( 0.06, 0.14, 1.0 - bf.y );
			float tone = step( 0.5, fract( sin( dot( floor( b ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) );
			base = mix( vec3( 0.2, 0.13, 0.12 ), mix( vec3( 0.62, 0.48, 0.4 ), vec3( 0.72, 0.58, 0.48 ), tone ), mortar );
			float c1 = abs( fuv.x - sin( fuv.y * 2.6 ) * 0.35 - sin( fuv.y * 9.0 ) * 0.06 );
			float c2 = abs( fuv.y - fsz.y * 0.55 - sin( fuv.x * 3.1 ) * 0.3 - sin( fuv.x * 11.0 ) * 0.05 );
			float crack = 1.0 - smoothstep( 0.03, 0.06, min( c1, c2 ) );
			base = mix( base, vec3( 0.03, 0.015, 0.02 ), crack );
			lit = vec3( 1.0, 0.55, 0.12 ) * crack * ( 0.5 + 0.3 * sin( uBoxTime * 3.0 + fuv.y * 2.0 ) );
		} else if ( kind < 5.5 || kind > 9.5 ) {
			// door / the exit's shutter: slatted metal in a drawn frame, and a band of chevrons in the
			// accent colour ("this opens") that lights up while its signal is on
			float slat = fract( fuv.y / 0.36 );
			base = mix( uMetalLine, uMetal, smoothstep( 0.03, 0.06, min( slat, 1.0 - slat ) ) );
			base = mix( uMetalLine, base, smoothstep( 0.06, 0.09, edge ) );
			if ( !topF ) {
				float band = 1.0 - smoothstep( 0.24, 0.26, abs( q.y ) );
				float u = abs( fract( q.x / 0.5 + 0.5 ) - 0.5 );
				float chev = 1.0 - smoothstep( 0.05, 0.065, abs( q.y - 0.11 + u * 0.44 ) );
				vec3 ac = kind > 9.5 ? vec3( 1.0, 0.42, 0.08 ) : uAccent;
				base = mix( base, uMetalLine, band * 0.75 );
				base = mix( base, ac, band * chev );
				lit = ac * band * chev * st * 0.9;
			}
		} else if ( kind < 6.5 ) {
			// platform: a painted border round its top, warning stripes along its upper edge
			if ( topF ) {
				float b = smoothstep( 0.1, 0.125, edge ) * ( 1.0 - smoothstep( 0.22, 0.245, edge ) );
				base = mix( uMetal, uAccent, b );
				base = mix( uMetalLine, base, smoothstep( 0.03, 0.055, edge ) );
				lit = uAccent * b * st * 0.5;
			} else {
				float band = step( fsz.y - 0.2, fuv.y );
				float s = step( 0.5, fract( ( fuv.x + fuv.y ) / 0.4 ) );
				base = mix( uMetal * 0.82, mix( uAccent, uMetalLine, s ), band );
			}
		} else if ( kind < 7.5 ) {
			// crate: a fired-clay box with a darker frame and a pressed drop, so it reads as "push me"
			base = vec3( 0.72, 0.26, 0.1 );
			base = mix( vec3( 0.4, 0.11, 0.05 ), base, smoothstep( 0.1, 0.125, edge ) );
			float m = min( fsz.x, fsz.y );
			vec2 d = q / m;
			float drop = length( vec2( d.x, d.y + 0.07 ) ) - 0.17;
			drop = min( drop, max( abs( d.x ) * 1.6 + d.y - 0.26, - d.y - 0.05 ) );
			base = mix( base, vec3( 0.98, 0.72, 0.42 ), 1.0 - smoothstep( 0.0, 0.02, drop ) );
			base = mix( base, vec3( 0.4, 0.11, 0.05 ), ( 1.0 - smoothstep( 0.0, 0.02, abs( drop ) - 0.012 ) ) * 0.9 );
		} else {
			// pressure plates: light (a cyan ring, any form) and heavy (an orange block mark with hatching)
			bool heavy = kind > 8.5;
			vec3 ac = heavy ? vec3( 1.0, 0.36, 0.05 ) : vec3( 0.05, 0.72, 0.95 );
			if ( topF ) {
				float m = min( fsz.x, fsz.y ) * 0.5;
				float r = length( q ) / m, sq = max( abs( q.x ), abs( q.y ) ) / m;
				float mark = heavy
					? ( step( sq, 0.3 ) + step( 0.52, sq ) * step( sq, 0.66 ) )
					: ( step( r, 0.2 ) + step( 0.48, r ) * step( r, 0.66 ) );
				if ( heavy ) mark = max( mark, step( 0.8, sq ) * step( 0.5, fract( ( q.x + q.y ) / 0.16 ) ) );
				base = mix( vec3( 0.07, 0.09, 0.15 ), ac, clamp( mark, 0.0, 1.0 ) );
				base = mix( vec3( 0.96, 0.9, 0.74 ), base, smoothstep( 0.05, 0.07, edge ) );      // a pale rim: "something to stand on"
				float pulse = 0.5 + 0.5 * sin( uBoxTime * 3.0 + vBoxP.x );
				lit = ac * mark * ( 0.12 + 0.1 * pulse * ( 1.0 - st ) + st * 0.9 );
			} else base = vec3( 0.96, 0.9, 0.74 );
		}
		diffuseColor.rgb *= base;
		totalEmissiveRadiance += lit;
	}`;

export class BoxBatch {
  /** @param max instances; pal: { metal, metalLine, accent } hex/'#rrggbb' colours from the theme */
  constructor(max, pal, time) {
    this.max = Math.max(1, max); this.n = 0;
    this.time = time || { value: 0 };
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);       // a unit box standing on its base
    this.ks = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aKS', this.ks);
    const uniforms = {
      uBoxTime: this.time, uMetal: { value: new THREE.Color(pal.metal) }, uMetalLine: { value: new THREE.Color(pal.metalLine) }, uAccent: { value: new THREE.Color(pal.accent) },
    };
    const make = (fade) => toon({ ink: 'axis', fade, key: 'box', uniforms, vertPars: BOX_VERT_PARS, vert: BOX_VERT, fragPars: BOX_FRAG_PARS, frag: BOX_FRAG });
    this.plain = make(false); this.fade = make(true);
    this.mesh = new THREE.InstancedMesh(geo, this.plain, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.o = new THREE.Object3D();
    this.geo = geo;
  }

  /** Reserve an instance of a kind; returns its index. */
  add(kind, aux = 0) {
    if (this.n >= this.max) return this.max - 1;
    const i = this.n++;
    this.ks.setXYZW(i, kind, 0, aux, i * 1.618);
    this.place(i, 0, -999, 0, 0, 0, 0);
    this.mesh.count = this.n;
    return i;
  }

  /** Put instance i with the centre of its base at (x, y, z), sized (sx, sy, sz); `quat` turns it (a rope). */
  place(i, x, y, z, sx, sy, sz, quat) {
    const o = this.o;
    o.position.set(x, y, z); o.scale.set(sx, sy, sz);
    if (quat) o.quaternion.copy(quat); else o.quaternion.identity();
    o.updateMatrix();
    this.mesh.setMatrixAt(i, o.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hide(i) { this.place(i, 0, -999, 0, 0, 0, 0); }
  state(i, s) { if (this.ks.getY(i) !== s) { this.ks.setY(i, s); this.ks.needsUpdate = true; } }

  dispose() { this.geo.dispose(); this.plain.dispose(); this.fade.dispose(); }
}

/** Little unlit lumps, each with its own colour. `add(fn)`: fn(set, dt, time, alpha) is called every frame and calls set(x, y, z, sx, sy, sz, r, g, b). */
export class Bits {
  constructor() { this.defs = []; this.mesh = null; }
  add(fn, at) { this.defs.push({ fn, at }); return this.defs.length - 1; }
  build() {
    if (!this.defs.length) return null;
    const geo = new THREE.IcosahedronGeometry(1, 1).translate(0, 1, 0);    // standing on its base
    const mat = inkless(new THREE.MeshBasicMaterial({ toneMapped: false, fog: true }), INK.prop(1));
    const mesh = new THREE.InstancedMesh(geo, mat, this.defs.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
    const o = new THREE.Object3D(), col = new THREE.Color();
    let cur = 0;
    this.set = (x, y, z, sx, sy, sz, r, g, b) => {
      o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.updateMatrix();
      mesh.setMatrixAt(cur, o.matrix); col.setRGB(r, g, b); mesh.setColorAt(cur, col);
    };
    for (cur = 0; cur < this.defs.length; cur++) this.set(0, -999, 0, 0, 0, 0, 0, 0, 0);
    this._cur = (i) => { cur = i; };
    this.mesh = mesh; this.geo = geo; this.mat = mat;
    return mesh;
  }
  /** (cx, cz, r2): only lumps within r of the point are refreshed. */
  update(dt, time, alpha, cx, cz, r2) {
    if (!this.mesh) return;
    for (let i = 0; i < this.defs.length; i++) {
      const d = this.defs[i];
      if (d.at && r2 !== undefined && (d.at[0] - cx) * (d.at[0] - cx) + (d.at[1] - cz) * (d.at[1] - cz) > r2) continue;
      this._cur(i); d.fn(this.set, dt, time, alpha);
    }
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  dispose() { if (this.mesh) { this.geo.dispose(); this.mat.dispose(); } }
}
