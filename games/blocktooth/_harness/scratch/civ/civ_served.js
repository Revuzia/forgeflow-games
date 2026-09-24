// BLOCKTOOTH — CivilianView (fx lane, CONTRACT §6 / §6.1 / §1 tone).
//
// Purely cosmetic crowds (Math.random is fine here — views may use it; the sim never sees these).
//   * Civilians are little CARTOON PEOPLE: faceted low-poly figures with a head (hair or a hat),
//     neck, torso, hips, two arms with broad mitten hands and two legs with shoes — chunky comic
//     proportions (head ≈ 1/5.5 of the height), painted colour zones.
//   * Ten archetypes (office, casual, kid, elder, courier, dress, hi-vis worker, parka, raincoat,
//     dock worker); each biome mixes SIX of them. Per-instance colours + option bits (hair A/B,
//     hat A/B, bag, umbrella, balloon, tie/scarf/cane) make every crowd member different.
//   * ONE merged geometry per archetype. Every vertex carries `aTag` = (part, colour slot, option
//     bit) and `aPiv` (its limb pivot). The vertex shader (onBeforeCompile on the toon material,
//     and the SAME code in the ink-hull material so outlines deform with the limbs) swings legs
//     about the hips and arms about the shoulders from per-instance `iAnim` (gait phase, swing
//     amplitude, pose id, head yaw), turns / tilts the head, hides unselected options and picks
//     each vertex's colour from five per-instance colours (`iC0..iC4`). Zero per-vertex CPU work:
//     one instanced draw per archetype (+ its hull at Size I–II).
//   * Far away (Size III+, a figure is < ~26 px tall) every civilian is drawn with ONE ~52-tri
//     LOD figure (same animation + colours, no hull) — one draw for the whole crowd.
//   * They live on the SIDEWALK ring of LIVE blocks (Chebyshev liveRadiusByRank around the titan)
//     inside a window around the camera target; count scales with rank so they read as crowds
//     from far away (and with quality). Out-of-window civilians are recycled to fresh sidewalk spots.
//   * Behaviour: mill along the sidewalk (walk cycle phase-locked to speed, glancing at the titan)
//     / stand and gawk (face the titan, look UP at it, point, film it on a phone, wave) → FLEE away
//     from the titan when it is within ~6H (moving) or ~2.5H (standing): full panic run, arms
//     flung up and flailing → calm down once far away.
//   * A titan footstep that lands on them (Size II+) — or a collapse / explosion on top of them —
//     makes them PUFF: a little cream dust pop. Never gore.
//   * Readability vs the HALVARD androids (off-white + safety orange + navy, visors, carbines):
//     civilians never wear that palette, have hair / hats instead of visors, carry bags, phones,
//     umbrellas and balloons instead of weapons, and behave like a crowd.
import * as THREE from "/node_modules/.vite/deps/three.js?v=8fcbd07d";
import { CITY, PARCEL_HALF } from "/src/core/config.ts";
import { PROP_INFO, harbourWaterZ } from "/src/city/citygen.ts";
import { INK, addOutline, bakeOutlineNormals, facet, makeOutlineMaterial, makeToon } from "/src/render/materials.ts";
const CAP = 640;
/** target crowd size by rank (× quality multiplier) */
const CROWD = [
	70,
	160,
	320,
	520,
	640
];
const Q_MUL = [
	.4,
	.7,
	1
];
/** civilian scale by rank: a touch larger at distance so the figures survive the zoom-out */
const CIV_SCALE = [
	1,
	1.2,
	1.7,
	2.5,
	3.3
];
/** sidewalk band (local offset from the block centre) — parcel edge 26 m … curb 29 m */
const SW_IN = PARCEL_HALF + .45;
const SW_OUT = PARCEL_HALF + 2.6;
/** assumed sidewalk top height (city-view owns the real curb mesh) */
const SIDEWALK_Y = .16;
const PUFF_CAP = 72;
const PUFF_BALLS = 3;
const PUFF_LIFE = .55;
const OUTLINE_W = 1.3;
const ST_EMPTY = 0, ST_MILL = 1, ST_IDLE = 2, ST_FLEE = 3, ST_GONE = 4;
/** pose ids (iAnim.z) */
const P_WALK = 0, P_PANIC = 1, P_POINT = 2, P_PHONE = 3, P_WAVE = 4;
// ─────────────────────────────── option bits (aTag.z / mask) ───────────────────────────────
const O_HAIR_A = 1, O_HAIR_B = 2, O_HAT_A = 3, O_HAT_B = 4, O_BAG = 5, O_PHONE = 6, O_UMB = 7, O_BALLOON = 8, O_EXTRA = 9;
/** option codes decided by the shader from the pose / per-instance style (not by the mask bits):
*  calm vs PANIC face, the mid figure's generic hat / hair, its skirt (bottom colour) / long coat (top) */
const O_CALM = 10, O_PANIC = 11, O_MHAT = 12, O_MHAIR = 13, O_SKIRT_B = 14, O_SKIRT_T = 15;
const bit = (o) => 1 << o - 1;
// ─────────────────────────────── colour slots (aTag.y) ───────────────────────────────
const S_SKIN = 0, S_TOP = 1, S_BOTTOM = 2, S_HAIR = 3, S_ACC = 4, S_SHOE = 5, S_INK = 6, S_WHITE = 7, S_GREY = 8, S_LEATHER = 9;
/** shoe palette (iC0.w index) — no off-white: that is the HALVARD androids' livery */
const SHOES = [
	"#2b2630",
	"#6b4a33",
	"#7fd0bf",
	"#d94a3c",
	"#ffcf3a",
	"#3a3036"
];
// ─────────────────────────────── parts (aTag.x) ───────────────────────────────
// arms: upper arm (shoulder pivot) + forearm/hand (shoulder pivot, then the elbow = aElb);
// legs: thigh (hip) + shin/shoe (hip, then the knee = aElb)
const PT_BODY = 0, PT_LLEG = 1, PT_RLEG = 2, PT_LARM = 3, PT_RARM = 4, PT_HEAD = 5, PT_LFORE = 6, PT_RFORE = 7, PT_LSHIN = 8, PT_RSHIN = 9;
/** fixed arm poses for held props (shader + authoring must agree) */
const UMB_RX = -.55, UMB_RZ = -.12;
const BAL_RX = -.5, BAL_RZ = .25;
function ring(n, rx, rz, y, rot = 0, ox = 0, oz = 0, yf) {
	const out = [];
	for (let i = 0; i < n; i++) {
		const a = rot + i / n * Math.PI * 2;
		out.push([
			ox + Math.sin(a) * rx,
			yf ? yf(a) : y,
			oz + Math.cos(a) * rz
		]);
	}
	return out;
}
function centroid(R) {
	let x = 0, y = 0, z = 0;
	for (const p of R) {
		x += p[0];
		y += p[1];
		z += p[2];
	}
	return [
		x / R.length,
		y / R.length,
		z / R.length
	];
}
/** Lofted shell through rings of equal point count; ends capped (fan to the ring centroid),
*  open, or fanned to an apex point. Consistently wound, then oriented outward. */
function loft(rings, bot = "cap", top = "cap", shellCentre) {
	const t = [];
	const tri = (a, b, c) => {
		t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
	};
	for (let r = 0; r + 1 < rings.length; r++) {
		const A = rings[r], B = rings[r + 1], n = A.length;
		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			tri(A[i], A[j], B[j]);
			tri(A[i], B[j], B[i]);
		}
	}
	const R0 = rings[0], R1 = rings[rings.length - 1];
	if (bot !== "none") {
		const c = bot === "cap" ? centroid(R0) : bot;
		for (let i = 0; i < R0.length; i++) tri(c, R0[(i + 1) % R0.length], R0[i]);
	}
	if (top !== "none") {
		const c = top === "cap" ? centroid(R1) : top;
		for (let i = 0; i < R1.length; i++) tri(c, R1[i], R1[(i + 1) % R1.length]);
	}
	return shellCentre ? orientFrom(t, shellCentre) : orient(t);
}
/** flip every triangle if the (consistently wound) surface encloses negative volume */
function orient(t) {
	let cx = 0, cy = 0, cz = 0;
	const n = t.length / 3;
	for (let i = 0; i < t.length; i += 3) {
		cx += t[i];
		cy += t[i + 1];
		cz += t[i + 2];
	}
	cx /= n;
	cy /= n;
	cz /= n;
	let vol = 0;
	for (let i = 0; i < t.length; i += 9) {
		const ax = t[i] - cx, ay = t[i + 1] - cy, az = t[i + 2] - cz;
		const bx = t[i + 3] - cx, by = t[i + 4] - cy, bz = t[i + 5] - cz;
		const qx = t[i + 6] - cx, qy = t[i + 7] - cy, qz = t[i + 8] - cz;
		vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
	}
	if (vol < 0) flipAll(t);
	return t;
}
/** orient each triangle to face away from a centre point (open shells: hair, hoods) */
function orientFrom(t, c) {
	for (let i = 0; i < t.length; i += 9) {
		const ax = t[i], ay = t[i + 1], az = t[i + 2];
		const e1x = t[i + 3] - ax, e1y = t[i + 4] - ay, e1z = t[i + 5] - az;
		const e2x = t[i + 6] - ax, e2y = t[i + 7] - ay, e2z = t[i + 8] - az;
		const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
		const mx = (ax + t[i + 3] + t[i + 6]) / 3 - c[0], my = (ay + t[i + 4] + t[i + 7]) / 3 - c[1], mz = (az + t[i + 5] + t[i + 8]) / 3 - c[2];
		if (nx * mx + ny * my + nz * mz < 0) swapTri(t, i);
	}
	return t;
}
function flipAll(t) {
	for (let i = 0; i < t.length; i += 9) swapTri(t, i);
}
function swapTri(t, i) {
	for (let k = 0; k < 3; k++) {
		const s = t[i + 3 + k];
		t[i + 3 + k] = t[i + 6 + k];
		t[i + 6 + k] = s;
	}
}
/** n-sided prism / frustum standing on y0 (footprint rx × rz, top scaled by `taper`) */
function prism(n, cx, y0, cz, rx, h, rz, taper = 1, rot = Math.PI / n) {
	return loft([ring(n, rx, rz, y0, rot, cx, cz), ring(n, rx * taper, rz * taper, y0 + h, rot, cx, cz)], "cap", "cap");
}
/** box centred at (cx, cy, cz) with full sizes w × h × d */
function box(cx, cy, cz, w, h, d, taper = 1) {
	return prism(4, cx, cy - h / 2, cz, w / Math.SQRT2, h, d / Math.SQRT2, taper, Math.PI / 4);
}
/** convex polygon (x, y pairs) extruded along z from z0 to z1 */
function extrudeXY(pts, z0, z1) {
	const A = [], B = [];
	for (let i = 0; i < pts.length; i += 2) {
		A.push([
			pts[i],
			pts[i + 1],
			z0
		]);
		B.push([
			pts[i],
			pts[i + 1],
			z1
		]);
	}
	return loft([A, B], "cap", "cap");
}
/** small double pyramid ("gem") — buns, pompoms, balloons' knots */
function gem(cx, cy, cz, r, h = r, n = 5) {
	return loft([ring(n, r, r, cy, 0, cx, cz)], [
		cx,
		cy - h,
		cz
	], [
		cx,
		cy + h,
		cz
	]);
}
function xf(t, m) {
	const e = m.elements;
	const out = new Array(t.length);
	for (let i = 0; i < t.length; i += 3) {
		const x = t[i], y = t[i + 1], z = t[i + 2];
		out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
		out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
		out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
	}
	return out;
}
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
/** T(p) · R · T(−p) */
function about(p, r) {
	return new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]).multiply(r).multiply(_m1.makeTranslation(-p[0], -p[1], -p[2]));
}
function rotX(a) {
	return new THREE.Matrix4().makeRotationX(a);
}
function rotZ(a) {
	return new THREE.Matrix4().makeRotationZ(a);
}
/** geometry authored in a held pose → rest-pose coordinates, so the shader's pose (Rx(rx)·Rz(rz)
*  about the shoulder) lands it exactly where it was authored */
function unpose(t, S, rx, rz) {
	const inv = _m2.makeRotationZ(-rz).multiply(_m3.makeRotationX(-rx));
	return xf(t, about(S, inv));
}
/** one archetype's merged geometry under construction */
class Fig {
	pos = [];
	tag = [];
	piv = [];
	/** second (inner) joint: the elbow of a forearm / the knee of a shin (= pivot elsewhere) */
	elb = [];
	/** current group transform (the elder's stoop), applied to geometry AND pivots */
	mat = null;
	add(t, part, slot, opt = 0, pivot = [
		0,
		0,
		0
	], joint) {
		let tt = t;
		let p = pivot;
		let e = joint ?? pivot;
		if (this.mat) {
			tt = xf(t, this.mat);
			const q = xf([
				p[0],
				p[1],
				p[2],
				e[0],
				e[1],
				e[2]
			], this.mat);
			p = [
				q[0],
				q[1],
				q[2]
			];
			e = [
				q[3],
				q[4],
				q[5]
			];
		}
		for (let i = 0; i < tt.length; i += 3) {
			this.pos.push(tt[i], tt[i + 1], tt[i + 2]);
			this.tag.push(part, slot, opt, 0);
			this.piv.push(p[0], p[1], p[2]);
			this.elb.push(e[0], e[1], e[2]);
		}
	}
	geometry() {
		let g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
		g.setAttribute("aTag", new THREE.Float32BufferAttribute(this.tag, 4));
		g.setAttribute("aPiv", new THREE.Float32BufferAttribute(this.piv, 3));
		g.setAttribute("aElb", new THREE.Float32BufferAttribute(this.elb, 3));
		const f = facet(g);
		g.dispose();
		g = f;
		bakeOutlineNormals(g);
		g.computeBoundingSphere();
		return g;
	}
}
/** heads are drawn a touch larger than life — chunky comic proportions, readable faces */
const HEAD_K = 1.1;
/** default arm splay (rest pose): the arms hang clear of the body */
const SPLAY = .14;
function dims(k, hk = 1, bulk = 1) {
	return {
		k,
		hs: k * hk * HEAD_K,
		bulk,
		hipY: .7 * k,
		hipX: .074 * k,
		kneeY: .38 * k,
		shY: 1.1 * k,
		shX: .19 * k * bulk,
		neckY: 1.15 * k,
		headY: 1.18 * k,
		armLen: .41 * k,
		upLen: .2 * k
	};
}
/** head half-width at height u (head units above the head base) — hair/hat shells follow it */
function headR(u) {
	const P = [
		[0, .07],
		[.06, .118],
		[.15, .128],
		[.235, .112],
		[.285, .02]
	];
	if (u <= P[0][0]) return P[0][1];
	for (let i = 1; i < P.length; i++) {
		if (u <= P[i][0]) {
			const [u0, r0] = P[i - 1], [u1, r1] = P[i];
			return r0 + (r1 - r0) * (u - u0) / (u1 - u0);
		}
	}
	return P[P.length - 1][1];
}
const HEX = Math.PI / 6;
/** flat convex polygon (x, y pairs, either winding) facing +Z at depth z — eyes, brows, mouths */
function flat(pts, z) {
	let area = 0;
	const n = pts.length / 2;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
	}
	const idx = (i) => area >= 0 ? i : n - 1 - i;
	const t = [];
	for (let i = 1; i + 1 < n; i++) {
		for (const v of [
			0,
			i,
			i + 1
		]) {
			const q = idx(v);
			t.push(pts[q * 2], pts[q * 2 + 1], z);
		}
	}
	return t;
}
/** a tapered limb segment along −Y from yA (radius rA) to yB (rB) at x; cloth above `ys`, skin below
*  (a hem ring closes the cloth). `topApex`: rounded top end this far above yA (null = open). */
function limbSeg(f, x, yA, rA, yB, rB, ys, cloth, part, piv, joint, topApex, n = 5) {
	const top = topApex === null ? "none" : [
		x,
		yA + topApex,
		0
	];
	if (ys <= yB || ys >= yA) {
		f.add(loft([ring(n, rA, rA, yA, 0, x), ring(n, rB, rB, yB, 0, x)], top, "none"), part, ys <= yB ? cloth : S_SKIN, 0, piv, joint);
		return;
	}
	const rs = rA + (rB - rA) * (yA - ys) / (yA - yB);
	f.add(loft([ring(n, rA, rA, yA, 0, x), ring(n, rs * 1.14, rs * 1.14, ys, 0, x)], top, "cap"), part, cloth, 0, piv, joint);
	f.add(loft([ring(n, rs, rs, ys + .01, 0, x), ring(n, rB, rB, yB, 0, x)], "none", "none"), part, S_SKIN, 0, piv, joint);
}
/** thigh (swings about the hip) + shin and shoe (also bend about the knee) */
function legs(f, d, o = {}) {
	const k = d.k, slot = o.slot ?? S_BOTTOM, rm = o.r ?? 1;
	for (const side of [1, -1]) {
		const thigh = side > 0 ? PT_LLEG : PT_RLEG, shin = side > 0 ? PT_LSHIN : PT_RSHIN;
		const x = side * d.hipX;
		const piv = [
			x,
			d.hipY,
			0
		], knee = [
			x,
			d.kneeY,
			0
		];
		const r0 = .08 * k * rm, rk = .066 * k * rm, r1 = .058 * k * rm;
		const ankle = (o.shoeH ?? .085) * k;
		const yTop = d.hipY + .03 * k;
		const ys = o.skinFrom ?? -1;
		limbSeg(f, x, yTop, r0, d.kneeY - .012 * k, rk, ys, slot, thigh, piv, undefined, null);
		limbSeg(f, x, d.kneeY + .012 * k, rk * .98, ankle, r1, ys, slot, shin, piv, knee, .03 * k);
		// shoe / boot: pentagon footprint, rounded toe forward
		const sh = o.boots ? .2 * k : ankle + .012 * k;
		const sw = (o.boots ? .076 : .068) * k, sd = .125 * k;
		f.add(loft([ring(5, sw, sd, 0, 0, x, .035 * k), ring(5, sw * .86, sd * .74, sh, 0, x, .012 * k)], "none", "cap"), shin, S_SHOE, 0, piv, knee);
	}
}
function pelvis(f, d, slot, y0 = .6, y1 = .8) {
	const k = d.k, b = d.bulk;
	f.add(loft([ring(6, .135 * k * b, .092 * k, y0 * k, HEX), ring(6, .142 * k * b, .096 * k, y1 * k, HEX)], "cap", "none"), PT_BODY, slot);
}
/** profile rows: [y, rx, rz] (× k; rx × bulk) — open at the bottom (the hips close it) */
const TORSO = [
	[
		.74,
		.14,
		.095
	],
	[
		1.03,
		.168,
		.106
	],
	[
		1.17,
		.118,
		.082
	]
];
function torso(f, d, slot, prof = TORSO, bot = "none") {
	const k = d.k, b = d.bulk;
	f.add(loft(prof.map(([y, rx, rz]) => ring(6, rx * k * b, rz * k, y * k, HEX)), bot, "cap"), PT_BODY, slot);
}
/** rest-pose frame of an arm: shoulder S, the splay tilt, and the elbow E */
function armFrame(d, side, splay) {
	const S = [
		side * d.shX,
		d.shY,
		0
	];
	const m = new THREE.Matrix4().makeTranslation(S[0], S[1], S[2]).multiply(rotZ(side * splay));
	const e = xf([
		0,
		-d.upLen,
		0
	], m);
	return {
		S,
		m,
		E: [
			e[0],
			e[1],
			e[2]
		]
	};
}
/** chunky two-segment cartoon arms: upper arm (swings about the shoulder) + forearm (also bends at
*  the elbow) + a broad rounded mitten hand with a thumb; the right hand holds the phone (phone pose) */
function arms(f, d, o) {
	const k = d.k, rm = o.r ?? 1, slot = o.slot ?? S_TOP, hand = o.hand ?? S_SKIN;
	const L = d.armLen, U = d.upLen;
	for (const side of [1, -1]) {
		const up = side > 0 ? PT_LARM : PT_RARM, fore = side > 0 ? PT_LFORE : PT_RFORE;
		const { S, m, E } = armFrame(d, side, o.splay ?? SPLAY);
		const rs = .074 * k * rm, re = .064 * k * rm, rw = .054 * k * rm;
		const add = (t, part, sl, opt = 0) => f.add(xf(t, m), part, sl, opt, S, part === fore ? E : undefined);
		const sh = [
			0,
			.05 * k,
			0
		];
		if (o.sleeve === "long") {
			add(loft([ring(6, rs, rs, .015 * k, HEX), ring(6, re * 1.04, re * 1.04, -U, HEX)], sh, "cap"), up, slot);
			add(loft([ring(6, re, re, -U + .012 * k, HEX), ring(6, rw * 1.1, rw * 1.1, -L + .012 * k, HEX)], [
				0,
				-U + .045 * k,
				0
			], "cap"), fore, slot);
		} else {
			const ys = -.55 * U;
			add(loft([ring(6, rs * 1.1, rs * 1.1, .015 * k, HEX), ring(6, rs * 1.08, rs * 1.08, ys, HEX)], sh, "cap"), up, slot);
			add(loft([ring(6, rs * .95, rs * .95, ys + .01 * k, HEX), ring(6, re * 1.02, re * 1.02, -U, HEX)], "none", "cap"), up, S_SKIN);
			add(loft([ring(6, re, re, -U + .012 * k, HEX), ring(6, rw, rw, -L + .012 * k, HEX)], [
				0,
				-U + .045 * k,
				0
			], "none"), fore, S_SKIN);
		}
		// broad rounded mitten: thin across x (palm faces the thigh), wide along z, thumb forward
		const hx = .046 * k * rm, hz = .066 * k * rm;
		add(loft([
			ring(6, rw * .92, rw * .92, -L + .02 * k, HEX),
			ring(6, hx, hz, -L - .035 * k, HEX, 0, .004 * k),
			ring(6, hx * .92, hz * .9, -L - .095 * k, HEX, 0, .004 * k)
		], "none", [
			0,
			-L - .132 * k,
			.004 * k
		]), fore, hand);
		add(gem(0, -L - .035 * k, hz * .95, .024 * k * rm, .03 * k * rm, 4), fore, hand);
		if (side < 0) {
			// phone: a slab gripped in front of the palm (only drawn in the phone pose)
			// (held up past the mitten tip so it reads above the hand from the game camera)
			add(box(0, -L - .12 * k, hz * .55, .085 * k, .17 * k, .02 * k), fore, S_INK, O_PHONE);
		}
	}
}
/** hand centre of an arm in the REST pose (for props held in the hand) */
function handAt(d, side, splay = SPLAY) {
	const r = d.armLen + .065 * d.k;
	return [
		side * d.shX + side * Math.sin(splay) * r,
		d.shY - Math.cos(splay) * r,
		0
	];
}
/** elbow of an arm in the REST pose (the forearm's second pivot) */
function elbowAt(d, side, splay = SPLAY) {
	return armFrame(d, side, splay).E;
}
/** neck + head + a cartoon face: whites-and-pupils eyes, ink brows and mouth (calm / PANIC
*  variants picked by the pose in the shader), a little nose */
function head(f, d) {
	const k = d.k, hs = d.hs, y0 = d.headY;
	const piv = [
		0,
		d.neckY,
		0
	];
	f.add(loft([ring(5, .05 * k, .05 * k, d.neckY - .05 * k), ring(5, .048 * k, .048 * k, y0 + .04 * hs)], "none", "none"), PT_HEAD, S_SKIN, 0, piv);
	const rows = [
		[
			.055,
			.116,
			.106
		],
		[
			.15,
			.128,
			.116
		],
		[
			.235,
			.112,
			.102
		]
	];
	f.add(loft(rows.map(([u, rx, rz]) => ring(6, rx * hs, rz * hs, y0 + u * hs, HEX)), [
		0,
		y0 - .012 * hs,
		.014 * hs
	], [
		0,
		y0 + .288 * hs,
		-.006 * hs
	]), PT_HEAD, S_SKIN, 0, piv);
	const fz = .104 * hs;
	/** face feature in head units (x, u pairs) */
	const F = (pts, z, slot, opt = 0) => f.add(flat(pts.map((v, i) => i % 2 ? y0 + v * hs : v * hs), z), PT_HEAD, slot, opt, piv);
	const eu = .146;
	for (const s of [1, -1]) {
		const ex = s * .037, w = .025, h = .033;
		F([
			ex - w,
			eu,
			ex - w * .62,
			eu - h,
			ex + w * .62,
			eu - h,
			ex + w,
			eu,
			ex + w * .62,
			eu + h,
			ex - w * .62,
			eu + h
		], fz, S_WHITE);
		const px = ex - s * .006, py = eu - .004, pw = .0125, ph = .019;
		F([
			px - pw,
			py - ph,
			px + pw,
			py - ph,
			px + pw,
			py + ph,
			px - pw,
			py + ph
		], fz + .0025 * hs, S_INK);
		// brows: calm (level) / PANIC (raised, inner ends up — worried)
		const bt = .0125;
		F([
			s * .012,
			.19,
			s * .064,
			.184,
			s * .064,
			.184 + bt,
			s * .012,
			.19 + bt
		], fz, S_INK, O_CALM);
		F([
			s * .01,
			.214,
			s * .064,
			.196,
			s * .064,
			.196 + bt,
			s * .01,
			.214 + bt
		], fz, S_INK, O_PANIC);
	}
	// mouth: a small smile / a round open "O" when panicking
	const mz = .0985 * hs;
	F([
		-.021,
		.084,
		.021,
		.084,
		.012,
		.073,
		-.012,
		.073
	], mz, S_INK, O_CALM);
	F([
		-.02,
		.074,
		-.013,
		.056,
		.013,
		.056,
		.02,
		.074,
		.013,
		.094,
		-.013,
		.094
	], mz, S_INK, O_PANIC);
	// nose
	f.add(loft([ring(3, .018 * hs, .011 * hs, y0 + .1 * hs, Math.PI, 0, fz - .006 * hs)], [
		0,
		y0 + .088 * hs,
		fz + .01 * hs
	], [
		0,
		y0 + .124 * hs,
		fz - .008 * hs
	]), PT_HEAD, S_SKIN, 0, piv);
}
function headPiv(d) {
	return [
		0,
		d.neckY,
		0
	];
}
function hair(f, d, kind, opt) {
	const hs = d.hs, y0 = d.headY, piv = headPiv(d);
	const front = kind === "crop" ? .205 : .225, back = kind === "long" ? .06 : .1;
	const yf = (a) => y0 + hs * (back + (front - back) * (.5 + .5 * Math.cos(a)));
	const R1 = ring(6, 1, 1, 0, HEX, 0, 0, yf).map(([x, y, z]) => {
		const r = headR((y - y0) / hs) * hs * 1.1 + .004 * hs;
		return [
			x * r,
			y,
			z * r - .004 * hs
		];
	});
	const R2 = ring(6, headR(.25) * hs * 1.16, headR(.25) * hs * 1.1, y0 + .25 * hs, HEX, 0, -.008 * hs);
	f.add(loft([R1, R2], "none", [
		0,
		y0 + (kind === "crop" ? .305 : .32) * hs,
		-.01 * hs
	], [
		0,
		y0 + .15 * hs,
		0
	]), PT_HEAD, S_HAIR, opt, piv);
	if (kind === "long") f.add(box(0, y0 + .13 * hs, -.088 * hs, .235 * hs, .24 * hs, .07 * hs, .95), PT_HEAD, S_HAIR, opt, piv);
	if (kind === "bun") f.add(gem(0, y0 + .3 * hs, -.078 * hs, .058 * hs, .052 * hs, 4), PT_HEAD, S_HAIR, opt, piv);
}
function hat(f, d, kind, opt, slot = S_HAIR) {
	const hs = d.hs, y0 = d.headY, piv = headPiv(d);
	const R = (u, m = 1.12) => headR(u) * hs * m + .004 * hs;
	const c = [
		0,
		y0 + .15 * hs,
		0
	];
	switch (kind) {
		case "cap": {
			f.add(loft([ring(6, R(.2), R(.2), y0 + .2 * hs, HEX, 0, -.006 * hs), ring(6, R(.26, 1.08), R(.26, 1.08), y0 + .27 * hs, HEX, 0, -.01 * hs)], "none", [
				0,
				y0 + .32 * hs,
				-.01 * hs
			], c), PT_HEAD, slot, opt, piv);
			f.add(xf(box(0, 0, 0, .17 * hs, .018 * hs, .1 * hs), new THREE.Matrix4().makeTranslation(0, y0 + .215 * hs, .14 * hs).multiply(rotX(.12))), PT_HEAD, slot, opt, piv);
			break;
		}
		case "flatcap": {
			f.add(loft([ring(6, R(.2), R(.2) * 1.05, y0 + .2 * hs, HEX, 0, .012 * hs), ring(6, R(.2) * .96, R(.2) * 1.02, y0 + .265 * hs, HEX, 0, .03 * hs)], "none", [
				0,
				y0 + .3 * hs,
				0
			], c), PT_HEAD, slot, opt, piv);
			f.add(xf(box(0, 0, 0, .17 * hs, .018 * hs, .07 * hs), new THREE.Matrix4().makeTranslation(0, y0 + .215 * hs, .145 * hs).multiply(rotX(.3))), PT_HEAD, slot, opt, piv);
			break;
		}
		case "hardhat": {
			const rb = .175 * hs, rd = R(.2, 1.14);
			f.add(loft([
				ring(6, rb, rb * 1.08, y0 + .205 * hs, HEX, 0, .014 * hs),
				ring(6, rb, rb * 1.08, y0 + .222 * hs, HEX, 0, .014 * hs),
				ring(6, rd, rd, y0 + .226 * hs, HEX),
				ring(6, rd * .84, rd * .84, y0 + .305 * hs, HEX)
			], "cap", [
				0,
				y0 + .34 * hs,
				0
			]), PT_HEAD, slot, opt, piv);
			break;
		}
		case "beanie": {
			f.add(loft([ring(6, R(.19, 1.14), R(.19, 1.14), y0 + .19 * hs, HEX, 0, -.008 * hs), ring(6, R(.25, 1.1), R(.25, 1.1), y0 + .255 * hs, HEX, 0, -.01 * hs)], "none", [
				0,
				y0 + .34 * hs,
				-.01 * hs
			], c), PT_HEAD, slot, opt, piv);
			f.add(gem(0, y0 + .36 * hs, 0, .042 * hs, .036 * hs, 4), PT_HEAD, S_WHITE, opt, piv);
			break;
		}
		case "sunhat": {
			const rb = .235 * hs;
			f.add(loft([
				ring(6, rb, rb, y0 + .205 * hs, HEX),
				ring(6, R(.22, 1.12), R(.22, 1.12), y0 + .226 * hs, HEX),
				ring(6, R(.22, 1), R(.22, 1), y0 + .315 * hs, HEX)
			], "cap", "cap"), PT_HEAD, slot, opt, piv);
			f.add(loft([ring(6, R(.22, 1.135), R(.22, 1.135), y0 + .226 * hs, HEX), ring(6, R(.22, 1.1), R(.22, 1.1), y0 + .26 * hs, HEX)], "none", "none", c), PT_HEAD, S_ACC, opt, piv);
			break;
		}
		case "hood":
		case "parkahood": {
			// open shell around the face: low at the sides / back, framing the face at the front
			const yf = (a) => {
				const cz = Math.cos(a);
				return y0 + hs * (cz > .55 ? .02 + .24 * (cz - .55) / .45 : -.04 * Math.max(0, -cz));
			};
			const R1 = ring(6, 1, 1, 0, 0, 0, 0, yf).map(([x, y, z]) => {
				const r = headR(Math.max(.06, (y - y0) / hs)) * hs * 1.2 + .012 * hs;
				return [
					x * r,
					y,
					z * r - .012 * hs
				];
			});
			const R2 = ring(6, R(.24, 1.24), R(.24, 1.2), y0 + .24 * hs, 0, 0, -.02 * hs);
			f.add(loft([R1, R2], "none", [
				0,
				y0 + .345 * hs,
				-.03 * hs
			], c), PT_HEAD, S_TOP, opt, piv);
			if (kind === "parkahood") f.add(gem(0, y0 + .27 * hs, .085 * hs, .1 * hs, .035 * hs, 6), PT_HEAD, S_WHITE, opt, piv);
			break;
		}
	}
}
const pick = (a) => a[Math.random() * a.length | 0];
const chance = (p) => Math.random() < p;
const SKIN = [
	"#f3d2b3",
	"#e2b48f",
	"#c98e66",
	"#9c6a48",
	"#6e4a33",
	"#f6dcc4"
];
const HAIR = [
	"#2a2226",
	"#4a3226",
	"#6f4a30",
	"#a0582e",
	"#d9b36a",
	"#2a2226",
	"#3a2a24"
];
const HAIR_OLD = [
	"#bdb8b0",
	"#e6e1d8",
	"#9a948d"
];
const HAIR_FUN = [
	"#ff8fc1",
	"#6fc8ff",
	"#b98bff",
	"#7ad97a"
];
// GRID-EAST city pop (no off-white tops, no safety orange — that is the androids' livery)
const GE_TOP = [
	"#ff6f5e",
	"#ffd166",
	"#3fb8ff",
	"#7ad97a",
	"#b98bff",
	"#ff9ec7",
	"#44d2c2",
	"#e84a3c",
	"#5b7cff",
	"#f7e27a",
	"#9be1ff",
	"#c3f07a"
];
const GE_BOTTOM = [
	"#4a6fa5",
	"#5b84c4",
	"#b5654a",
	"#c8b08a",
	"#4a4550",
	"#2f2b36",
	"#8a6fb0",
	"#6a9a8a"
];
const SUIT = [
	"#4a4550",
	"#5d6b7a",
	"#b89b72",
	"#7a3444",
	"#3e6b55",
	"#8a8f99",
	"#6b5a8a"
];
const TIE = [
	"#e84a3c",
	"#ffd166",
	"#3fb8ff",
	"#ff6f5e",
	"#b98bff",
	"#44d2c2",
	"#ff9ec7"
];
const ACC_GE = [
	"#ff6f5e",
	"#ffd166",
	"#3fb8ff",
	"#7ad97a",
	"#b98bff",
	"#ff9ec7",
	"#44d2c2",
	"#e84a3c"
];
// WHITE STACKS — winter wardrobe
const WS_COAT = [
	"#d9483b",
	"#2f8f8a",
	"#d9a52b",
	"#7b4a7a",
	"#3e6b55",
	"#4f8fd0",
	"#c24d6e",
	"#8a5a3a"
];
const WS_SHIRT = [
	"#8e3b35",
	"#4f6d8f",
	"#6b7a3e",
	"#7a5a3a",
	"#5d6b7a",
	"#a04a5a"
];
const WS_BOTTOM = [
	"#4a4550",
	"#5a4636",
	"#4a6fa5",
	"#2f2b36",
	"#6b6f76",
	"#6a5a48"
];
const WS_KNIT = [
	"#e84a3c",
	"#ffd166",
	"#44d2c2",
	"#b98bff",
	"#ff9ec7",
	"#7ad97a",
	"#3fb8ff"
];
const HIVIS = [
	"#d4f53c",
	"#c6f03a",
	"#e3fa55"
];
const HARDHAT = [
	"#ffd23f",
	"#44d2c2",
	"#e84a3c",
	"#3fb8ff",
	"#7ad97a"
];
// LOCKWATER — night rain: bright slickers read against the dark water
const LW_SLICK = [
	"#ffd23f",
	"#e84a3c",
	"#ff6fae",
	"#36c9c6",
	"#8fd14f",
	"#b98bff",
	"#ffe066"
];
const LW_UMB = [
	"#ff3fa4",
	"#3ff0ff",
	"#ffd23f",
	"#e84a3c",
	"#b98bff",
	"#7ad97a",
	"#36c9c6"
];
const LW_TOP = [
	"#6b7a8a",
	"#8e3b35",
	"#3f5a4a",
	"#5b7cff",
	"#ff6fae",
	"#44d2c2",
	"#9aa4ad",
	"#c24d6e"
];
const LW_BOTTOM = [
	"#4a6fa5",
	"#6b7a3e",
	"#5a4636",
	"#2f2b36",
	"#4a4550"
];
function hairOrHat(pHat, pHatB, pB) {
	const r = Math.random();
	if (r < pHat) return bit(O_HAT_A);
	if (r < pHat + pHatB) return bit(O_HAT_B);
	return chance(pB) ? bit(O_HAIR_B) : bit(O_HAIR_A);
}
const hairCol = () => chance(.08) ? pick(HAIR_FUN) : pick(HAIR);
/** the headwear colour doubles as the hair colour (hair is hidden under a hat) */
function headCol(mask, hatA, hatB, hairC = hairCol) {
	if (mask & bit(O_HAT_A)) return hatA();
	if (mask & bit(O_HAT_B)) return hatB();
	return hairC();
}
/** thin 3-sided rod between two points (canes, shafts, strings) */
function rod(a, b, r) {
	const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
	const len = dir.length();
	dir.normalize();
	const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
	const m = new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), q, new THREE.Vector3(1, 1, 1));
	return xf(loft([ring(3, r, r, 0), ring(3, r, r, len)], "none", "none"), m);
}
/** flat strip (bag straps) from a to b, width w, lying on the z-facing plane at depth z */
function strap(ax, ay, bx, by, w, z0, z1) {
	const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
	const nx = -dy / l * w * .5, ny = dx / l * w * .5;
	return extrudeXY([
		ax + nx,
		ay + ny,
		ax - nx,
		ay - ny,
		bx - nx,
		by - ny,
		bx + nx,
		by + ny
	], z0, z1);
}
const ARCH = {
	office: {
		id: "office",
		stride: .62,
		swing: .9,
		pace: 1.05,
		lod: 1,
		build(f) {
			const d = dims(1);
			legs(f, d, {});
			pelvis(f, d, S_TOP, .6, .8);
			torso(f, d, S_TOP);
			// shirt V + tie
			f.add(extrudeXY([
				-.052,
				1.14,
				.052,
				1.14,
				0,
				.985
			], .066, .094), PT_BODY, S_WHITE);
			f.add(extrudeXY([
				0,
				1.1,
				.028,
				1.05,
				0,
				.82,
				-.028,
				1.05
			], .08, .104), PT_BODY, S_ACC, O_EXTRA);
			arms(f, d, { sleeve: "long" });
			head(f, d);
			hair(f, d, "short", O_HAIR_A);
			hair(f, d, "long", O_HAIR_B);
			// briefcase in the left hand
			const h = handAt(d, 1);
			f.add(box(h[0] + .012, h[1] - .11, h[2], .065, .2, .28), PT_LFORE, S_LEATHER, O_BAG, [
				d.shX,
				d.shY,
				0
			], elbowAt(d, 1));
		},
		look(b) {
			const mask = hairOrHat(0, 0, .35) | (chance(.7) ? bit(O_EXTRA) : 0) | (chance(.45) ? bit(O_BAG) : 0);
			const suit = b === "lockwater" ? pick([
				"#4a4550",
				"#5d6b7a",
				"#6b5a8a",
				"#3e6b55",
				"#7a3444"
			]) : b === "whitestacks" ? pick([
				"#4a4550",
				"#7a3444",
				"#5a4636",
				"#3e6b55"
			]) : pick(SUIT);
			return {
				skin: pick(SKIN),
				top: suit,
				bottom: chance(.7) ? suit : pick([
					"#4a4550",
					"#2f2b36",
					"#c8b08a"
				]),
				hair: hairCol(),
				acc: pick(TIE),
				shoe: pick([
					0,
					1,
					0
				]),
				mask
			};
		}
	},
	casual: {
		id: "casual",
		stride: .62,
		swing: 1,
		pace: 1,
		lod: 1,
		build(f) {
			const d = dims(1);
			legs(f, d, {});
			pelvis(f, d, S_BOTTOM);
			torso(f, d, S_TOP);
			arms(f, d, { sleeve: "short" });
			head(f, d);
			hair(f, d, "short", O_HAIR_A);
			hair(f, d, "long", O_HAIR_B);
			hat(f, d, "cap", O_HAT_A);
			hat(f, d, "beanie", O_HAT_B);
			f.add(box(0, .93, -.135, .22, .27, .1, .9), PT_BODY, S_ACC, O_BAG);
		},
		look(b) {
			const cold = b === "whitestacks";
			const mask = hairOrHat(cold ? .08 : .25, cold ? .4 : .04, .4) | (chance(.35) ? bit(O_BAG) : 0);
			const top = b === "grideast" ? pick(GE_TOP) : cold ? pick(WS_COAT) : pick(LW_TOP);
			const acc = b === "lockwater" ? pick(LW_SLICK) : pick(ACC_GE);
			return {
				skin: pick(SKIN),
				top,
				bottom: pick(b === "grideast" ? GE_BOTTOM : cold ? WS_BOTTOM : LW_BOTTOM),
				hair: headCol(mask, () => pick(ACC_GE), () => pick(WS_KNIT)),
				acc,
				shoe: pick([
					2,
					2,
					0,
					3,
					1
				]),
				mask
			};
		}
	},
	kid: {
		id: "kid",
		stride: .42,
		swing: 1.15,
		pace: 1.1,
		lod: .68,
		build(f) {
			const d = dims(.66, 1.32, 1.05);
			legs(f, d, {
				skinFrom: .33,
				r: 1.1
			});
			pelvis(f, d, S_BOTTOM);
			torso(f, d, S_TOP, [
				[
					.74,
					.142,
					.1
				],
				[
					1.03,
					.16,
					.105
				],
				[
					1.17,
					.115,
					.082
				]
			]);
			arms(f, d, {
				sleeve: "short",
				r: 1.12
			});
			head(f, d);
			hair(f, d, "crop", O_HAIR_A);
			hat(f, d, "cap", O_HAT_A);
			hat(f, d, "beanie", O_HAT_B);
			// balloon on a string, held up in the left hand (authored in the held pose)
			const S = [
				d.shX,
				d.shY,
				0
			];
			const hq = xf([...handAt(d, 1)], about(S, new THREE.Matrix4().makeRotationX(BAL_RX).multiply(rotZ(BAL_RZ))));
			const hp = [
				hq[0],
				hq[1],
				hq[2]
			];
			const top = [
				hp[0] + .05,
				hp[1] + .56,
				hp[2] - .04
			];
			f.add(unpose(rod(hp, top, .006), S, BAL_RX, BAL_RZ), PT_LARM, S_INK, O_BALLOON, S);
			const bal = loft([
				ring(6, .085, .085, top[1] + .06, 0, top[0], top[2]),
				ring(6, .13, .13, top[1] + .16, 0, top[0], top[2]),
				ring(6, .11, .11, top[1] + .27, 0, top[0], top[2])
			], [
				top[0],
				top[1] - .01,
				top[2]
			], [
				top[0],
				top[1] + .335,
				top[2]
			]);
			f.add(unpose(bal, S, BAL_RX, BAL_RZ), PT_LARM, S_ACC, O_BALLOON, S);
		},
		look(b) {
			const mask = hairOrHat(b === "whitestacks" ? .05 : .22, b === "whitestacks" ? .55 : .04, 0) | (chance(b === "grideast" ? .35 : .15) ? bit(O_BALLOON) : 0);
			const top = b === "grideast" ? pick(GE_TOP) : b === "whitestacks" ? pick(WS_COAT) : pick(LW_SLICK);
			return {
				skin: pick(SKIN),
				top,
				bottom: pick(b === "grideast" ? GE_BOTTOM : WS_BOTTOM),
				hair: headCol(mask, () => pick(ACC_GE), () => pick(WS_KNIT)),
				acc: pick(b === "lockwater" ? LW_UMB : ACC_GE),
				shoe: b === "lockwater" ? 4 : pick([
					2,
					3,
					2
				]),
				mask
			};
		}
	},
	elder: {
		id: "elder",
		stride: .42,
		swing: .55,
		pace: .6,
		lod: .95,
		build(f) {
			const d = dims(.97, 1.02, 1.04);
			legs(f, d, {});
			pelvis(f, d, S_BOTTOM);
			f.mat = about([
				0,
				d.hipY,
				0
			], rotX(.2));
			torso(f, d, S_TOP, [
				[
					.74,
					.142,
					.096
				],
				[
					1,
					.162,
					.112
				],
				[
					1.16,
					.115,
					.084
				]
			]);
			f.add(extrudeXY([
				-.045,
				1.12,
				.045,
				1.12,
				0,
				1.01
			], .072, .102), PT_BODY, S_WHITE);
			arms(f, d, {
				sleeve: "long",
				splay: .08
			});
			head(f, d);
			hair(f, d, "crop", O_HAIR_A);
			hair(f, d, "bun", O_HAIR_B);
			hat(f, d, "flatcap", O_HAT_A);
			hat(f, d, "sunhat", O_HAT_B);
			// walking cane in the right hand
			const h = handAt(d, -1, .08);
			f.add(rod([
				h[0],
				h[1] + .02,
				h[2] + .07
			], [
				h[0],
				.02 - .15,
				h[2] + .12
			], .016), PT_RFORE, S_LEATHER, O_EXTRA, [
				-d.shX,
				d.shY,
				0
			], elbowAt(d, -1, .08));
			f.mat = null;
		},
		look(b) {
			const mask = hairOrHat(.35, .15, .3) | (chance(.6) ? bit(O_EXTRA) : 0);
			const top = b === "whitestacks" ? pick(WS_COAT) : pick([
				"#b0785a",
				"#7a8f6a",
				"#8a6fb0",
				"#c9a86a",
				"#6f8fb0",
				"#a05a5a"
			]);
			return {
				skin: pick(SKIN),
				top,
				bottom: pick([
					"#6b6f76",
					"#5a4636",
					"#c8b08a",
					"#4a4550"
				]),
				hair: headCol(mask, () => pick([
					"#6b5a4a",
					"#5d6b7a",
					"#8a6a4a"
				]), () => pick([
					"#e8d9b0",
					"#f0c0c8",
					"#c9e0f0"
				]), () => pick(HAIR_OLD)),
				acc: pick(ACC_GE),
				shoe: pick([1, 0]),
				mask
			};
		}
	},
	courier: {
		id: "courier",
		stride: .64,
		swing: 1.05,
		pace: 1.35,
		lod: 1,
		build(f) {
			const d = dims(1);
			legs(f, d, { skinFrom: .46 });
			pelvis(f, d, S_BOTTOM);
			torso(f, d, S_TOP);
			arms(f, d, { sleeve: "short" });
			head(f, d);
			hat(f, d, "cap", 0, S_ACC);
			// messenger bag on the right hip + strap across the chest
			f.add(box(-.175, .74, .02, .085, .17, .25), PT_BODY, S_ACC);
			f.add(strap(.13, 1.15, -.15, .8, .045, .083, .105), PT_BODY, S_ACC);
		},
		look(b) {
			const acc = pick(b === "lockwater" ? LW_SLICK : [
				"#ffd166",
				"#7ad97a",
				"#3fb8ff",
				"#e84a3c",
				"#b98bff",
				"#44d2c2"
			]);
			const top = b === "whitestacks" ? pick(WS_COAT) : b === "lockwater" ? pick(LW_TOP) : pick([
				"#44d2c2",
				"#5b7cff",
				"#ff9ec7",
				"#7ad97a",
				"#b98bff",
				"#f7e27a",
				"#3fb8ff"
			]);
			// the cap is always worn (bit only drives the far/mid figures' generic hat)
			return {
				skin: pick(SKIN),
				top,
				bottom: pick([
					"#4a4550",
					"#2f2b36",
					"#6b7a3e",
					"#c8b08a"
				]),
				hair: acc,
				acc,
				shoe: pick([
					2,
					0,
					3
				]),
				mask: bit(O_HAT_A)
			};
		}
	},
	dress: {
		id: "dress",
		stride: .56,
		swing: .78,
		pace: .95,
		lod: .98,
		mid: 1,
		build(f) {
			const d = dims(.98, 1.02, .95);
			legs(f, d, {
				skinFrom: .5,
				r: .9
			});
			// A-line skirt from the waist to the knee
			f.add(loft([ring(6, .13, .092, .79, HEX), ring(6, .21, .18, .46, HEX)], "none", "cap"), PT_BODY, S_BOTTOM);
			torso(f, d, S_TOP, [
				[
					.74,
					.125,
					.086
				],
				[
					1.03,
					.152,
					.097
				],
				[
					1.17,
					.11,
					.074
				]
			]);
			arms(f, d, {
				sleeve: "short",
				r: .92
			});
			head(f, d);
			hair(f, d, "long", O_HAIR_A);
			hair(f, d, "bun", O_HAIR_B);
			hat(f, d, "sunhat", O_HAT_A);
			// shoulder bag at the left hip on a strap
			f.add(box(.2, .73, 0, .07, .15, .2, .85), PT_BODY, S_ACC, O_BAG);
			f.add(strap(-.1, 1.15, .19, .8, .03, .078, .098), PT_BODY, S_ACC, O_BAG);
		},
		look(b) {
			const mask = hairOrHat(b === "grideast" ? .25 : .05, 0, .45) | (chance(.6) ? bit(O_BAG) : 0);
			const pal = b === "grideast" ? GE_TOP : b === "whitestacks" ? WS_COAT : LW_TOP;
			const dressC = pick(pal);
			return {
				skin: pick(SKIN),
				top: chance(.5) ? dressC : pick(pal),
				bottom: dressC,
				hair: headCol(mask, () => pick([
					"#f3d98a",
					"#f0c0c8",
					"#ffe8a0",
					"#c9e0f0"
				]), hairCol),
				acc: pick(ACC_GE),
				shoe: pick([
					3,
					0,
					1,
					2
				]),
				mask
			};
		}
	},
	worker: {
		id: "worker",
		stride: .64,
		swing: .95,
		pace: .9,
		lod: 1,
		build(f) {
			const d = dims(1.02, 1, 1.06);
			legs(f, d, {
				boots: true,
				r: 1.08
			});
			pelvis(f, d, S_BOTTOM);
			torso(f, d, S_TOP);
			// hi-vis vest (open tube just outside the torso) + two reflective bands
			const s = 1.02 * 1.06, kz = 1.02;
			f.add(loft([
				ring(6, .148 * s * 1.08, .098 * kz * 1.1, .78 * kz, HEX),
				ring(6, .163 * s * 1.08, .1 * kz * 1.1, 1.03 * kz, HEX),
				ring(6, .128 * s * 1.08, .088 * kz * 1.1, 1.14 * kz, HEX)
			], "none", "none"), PT_BODY, S_ACC);
			for (const [y, rx, rz] of [[
				.85,
				.156,
				.1
			], [
				.96,
				.162,
				.101
			]]) {
				f.add(loft([ring(6, rx * s * 1.1, rz * kz * 1.12, y * kz, HEX), ring(6, rx * s * 1.1, rz * kz * 1.12, (y + .035) * kz, HEX)], "none", "none"), PT_BODY, S_WHITE);
			}
			arms(f, d, {
				sleeve: "long",
				hand: S_LEATHER,
				r: 1.05
			});
			head(f, d);
			hat(f, d, "hardhat", O_HAT_A);
			hat(f, d, "beanie", O_HAT_B);
			hair(f, d, "crop", O_HAIR_A);
		},
		look() {
			const mask = hairOrHat(.72, .22, 0);
			return {
				skin: pick(SKIN),
				top: pick(WS_SHIRT),
				bottom: pick([
					"#5a4636",
					"#4a4550",
					"#4a6fa5",
					"#6b6f76"
				]),
				hair: headCol(mask, () => pick(HARDHAT), () => pick(WS_KNIT)),
				acc: pick(HIVIS),
				shoe: 5,
				mask
			};
		}
	},
	parka: {
		id: "parka",
		stride: .58,
		swing: .8,
		pace: .9,
		lod: 1.05,
		build(f) {
			const d = dims(1, 1, 1.12);
			legs(f, d, {
				r: 1.05,
				boots: true
			});
			// puffy quilted parka from the hips to the collar
			torso(f, d, S_TOP, [
				[
					.56,
					.155,
					.112
				],
				[
					.66,
					.168,
					.122
				],
				[
					.76,
					.152,
					.114
				],
				[
					.9,
					.172,
					.126
				],
				[
					1,
					.158,
					.118
				],
				[
					1.1,
					.172,
					.122
				],
				[
					1.19,
					.11,
					.086
				]
			], "cap");
			arms(f, d, {
				sleeve: "long",
				r: 1.2,
				splay: .2,
				hand: S_ACC
			});
			head(f, d);
			hat(f, d, "parkahood", O_HAT_A);
			hat(f, d, "beanie", O_HAT_B, S_ACC);
			hair(f, d, "short", O_HAIR_A);
			// scarf: a collar ring + a tail hanging down the chest
			f.add(loft([ring(6, .082, .078, 1.13, HEX), ring(6, .078, .074, 1.21, HEX)], "none", "none"), PT_BODY, S_ACC, O_EXTRA);
			f.add(box(.055, 1.04, .118, .065, .18, .03), PT_BODY, S_ACC, O_EXTRA);
		},
		look() {
			const mask = hairOrHat(.4, .38, 0) | (chance(.55) ? bit(O_EXTRA) : 0);
			const top = pick(WS_COAT), acc = pick(WS_KNIT);
			// hood = coat colour, beanie = knit colour (the S_HAIR colour then only feeds the mid figure's hat)
			return {
				skin: pick(SKIN),
				top,
				bottom: pick(WS_BOTTOM),
				hair: headCol(mask, () => top, () => acc),
				acc,
				shoe: pick([
					5,
					1,
					5
				]),
				mask
			};
		}
	},
	raincoat: {
		id: "raincoat",
		stride: .6,
		swing: .78,
		pace: .95,
		lod: 1,
		mid: 2,
		build(f) {
			const d = dims(1);
			legs(f, d, { boots: true });
			// long slicker: torso + a flared skirt to the knee
			torso(f, d, S_TOP);
			f.add(loft([ring(6, .145, .1, .8, HEX), ring(6, .19, .14, .44, HEX)], "none", "cap"), PT_BODY, S_TOP);
			f.add(extrudeXY([
				-.012,
				1.14,
				.012,
				1.14,
				.012,
				.46,
				-.012,
				.46
			], .084, .118), PT_BODY, S_INK);
			arms(f, d, {
				sleeve: "long",
				r: 1.1
			});
			head(f, d);
			hat(f, d, "hood", O_HAT_A);
			hair(f, d, "short", O_HAIR_A);
			hair(f, d, "long", O_HAIR_B);
			// umbrella in the right hand, held up over the head (authored in the held pose)
			const S = [
				-d.shX,
				d.shY,
				0
			];
			const hq = xf([...handAt(d, -1)], about(S, new THREE.Matrix4().makeRotationX(UMB_RX).multiply(rotZ(UMB_RZ))));
			const hp = [
				hq[0],
				hq[1],
				hq[2]
			];
			const top = [
				-.03,
				1.86,
				.03
			];
			f.add(unpose(rod([
				hp[0],
				hp[1] - .06,
				hp[2]
			], top, .012), S, UMB_RX, UMB_RZ), PT_RARM, S_INK, O_UMB, S);
			const cy = top[1] - .12;
			const can = loft([ring(6, .52, .52, cy, 0, top[0], top[2]), ring(6, .3, .3, cy + .12, 0, top[0], top[2])], [
				top[0],
				cy + .05,
				top[2]
			], [
				top[0],
				cy + .2,
				top[2]
			]);
			f.add(unpose(can, S, UMB_RX, UMB_RZ), PT_RARM, S_ACC, O_UMB, S);
		},
		look() {
			const umb = chance(.45);
			const mask = (umb ? chance(.5) ? bit(O_HAIR_A) : bit(O_HAIR_B) : hairOrHat(.6, 0, .4)) | (umb ? bit(O_UMB) : 0);
			const top = pick(LW_SLICK);
			return {
				skin: pick(SKIN),
				top,
				bottom: pick(LW_BOTTOM),
				hair: headCol(mask, () => top, () => top),
				acc: pick(LW_UMB),
				shoe: pick([
					4,
					5,
					3
				]),
				mask
			};
		}
	},
	dock: {
		id: "dock",
		stride: .64,
		swing: .95,
		pace: .85,
		lod: 1.02,
		build(f) {
			const k = 1.03;
			const d = dims(k, .98, 1.1);
			legs(f, d, {
				boots: true,
				r: 1.12
			});
			pelvis(f, d, S_BOTTOM);
			torso(f, d, S_TOP);
			// overall bib + shoulder straps
			f.add(extrudeXY([
				-.085 * k,
				.8 * k,
				.085 * k,
				.8 * k,
				.075 * k,
				1.03 * k,
				-.075 * k,
				1.03 * k
			], .078 * k, .108 * k), PT_BODY, S_BOTTOM);
			for (const s of [1, -1]) f.add(strap(s * .065 * k, 1.02 * k, s * .085 * k, 1.17 * k, .03 * k, .06 * k, .1 * k), PT_BODY, S_BOTTOM);
			arms(f, d, {
				sleeve: "long",
				hand: S_LEATHER,
				r: 1.12
			});
			head(f, d);
			hat(f, d, "beanie", O_HAT_A);
			hair(f, d, "crop", O_HAIR_A);
		},
		look() {
			const mask = hairOrHat(.7, 0, 0);
			return {
				skin: pick(SKIN),
				top: pick([
					"#8e3b35",
					"#6b7a8a",
					"#3f5a4a",
					"#c9a86a",
					"#ffd23f"
				]),
				bottom: pick([
					"#6b7a3e",
					"#4a6fa5",
					"#5a4636",
					"#e84a3c"
				]),
				hair: headCol(mask, () => pick([
					"#e84a3c",
					"#36c9c6",
					"#ffd23f",
					"#7ad97a"
				]), hairCol),
				acc: pick(LW_SLICK),
				shoe: 5,
				mask
			};
		}
	}
};
/** six archetypes per biome with their crowd weights */
const BIOME_MIX = {
	grideast: [
		["office", 22],
		["casual", 26],
		["kid", 13],
		["elder", 10],
		["courier", 12],
		["dress", 17]
	],
	whitestacks: [
		["worker", 26],
		["parka", 28],
		["kid", 11],
		["elder", 9],
		["office", 12],
		["casual", 14]
	],
	lockwater: [
		["raincoat", 32],
		["dock", 20],
		["kid", 11],
		["elder", 9],
		["courier", 12],
		["casual", 16]
	]
};
/** ~52-tri far figure: same parts, pivots and colour slots as the full archetypes */
function buildLod() {
	const f = new Fig();
	const d = dims(1);
	for (const side of [1, -1]) {
		const x = side * d.hipX;
		f.add(loft([ring(3, .07, .07, d.hipY + .03, 0, x), ring(3, .055, .07, 0, 0, x, .03)], "none", "none"), side > 0 ? PT_LLEG : PT_RLEG, S_BOTTOM, 0, [
			x,
			d.hipY,
			0
		]);
		const S = [
			side * d.shX,
			d.shY,
			0
		];
		f.add(loft([ring(3, .06, .06, d.shY + .04, 0, side * (d.shX + .01)), ring(3, .05, .05, d.shY - .5, 0, side * (d.shX + .05))], "none", "none"), side > 0 ? PT_LARM : PT_RARM, S_TOP, 0, S);
	}
	f.add(loft([ring(4, .19, .13, .6, Math.PI / 4), ring(4, .2, .135, .8, Math.PI / 4)], "cap", "none"), PT_BODY, S_BOTTOM);
	f.add(loft([ring(4, .2, .135, .78, Math.PI / 4), ring(4, .22, .13, 1.17, Math.PI / 4)], "none", "cap"), PT_BODY, S_TOP);
	const hp = headPiv(d), y = d.headY;
	f.add(loft([ring(4, .17, .155, y + .14, Math.PI / 4)], [
		0,
		y - .03,
		0
	], "none"), PT_HEAD, S_SKIN, 0, hp);
	f.add(loft([ring(4, .17, .155, y + .14, Math.PI / 4)], "none", [
		0,
		y + .33,
		-.02
	]), PT_HEAD, S_HAIR, 0, hp);
	return f.geometry();
}
/** ~240-tri MID figure (a figure ~12–40 px tall): ONE geometry for every archetype, one draw (+ hull)
*  for the whole crowd. Same parts / pivots / colour slots / poses as the full figures, elbows
*  included; per-instance option bits pick hair / long hair / hat / bag, the style bits (iC3.w) a
*  skirt or a long coat. */
function buildMid() {
	const f = new Fig();
	const d = dims(1, 1.06);
	const Q = Math.PI / 4;
	for (const side of [1, -1]) {
		const part = side > 0 ? PT_LLEG : PT_RLEG, x = side * d.hipX, piv = [
			x,
			d.hipY,
			0
		];
		f.add(loft([ring(4, .082, .082, d.hipY + .03, Q, x), ring(4, .062, .062, .08, Q, x)], "none", "none"), part, S_BOTTOM, 0, piv);
		f.add(loft([ring(4, .072, .125, 0, Q, x, .035), ring(4, .062, .09, .11, Q, x, .015)], "none", "cap"), part, S_SHOE, 0, piv);
	}
	f.add(loft([ring(6, .14, .095, .6, HEX), ring(6, .146, .098, .8, HEX)], "cap", "none"), PT_BODY, S_BOTTOM);
	f.add(loft([
		ring(6, .142, .096, .78, HEX),
		ring(6, .17, .108, 1.03, HEX),
		ring(6, .12, .084, 1.17, HEX)
	], "none", "cap"), PT_BODY, S_TOP);
	const skirt = () => loft([ring(6, .142, .1, .8, HEX), ring(6, .215, .18, .44, HEX)], "none", "none");
	f.add(skirt(), PT_BODY, S_BOTTOM, O_SKIRT_B);
	f.add(skirt(), PT_BODY, S_TOP, O_SKIRT_T);
	f.add(loft([ring(4, .11, .05, .8, Q, 0, -.135), ring(4, .1, .045, 1.07, Q, 0, -.13)], "none", "cap"), PT_BODY, S_ACC, O_BAG);
	for (const side of [1, -1]) {
		const up = side > 0 ? PT_LARM : PT_RARM, fore = side > 0 ? PT_LFORE : PT_RFORE;
		const { S, m, E } = armFrame(d, side, SPLAY);
		const U = d.upLen, L = d.armLen;
		f.add(xf(loft([ring(3, .078, .078, .01), ring(3, .066, .066, -U)], [
			0,
			.05,
			0
		], "none"), m), up, S_TOP, 0, S);
		f.add(xf(loft([ring(3, .066, .066, -U + .01), ring(3, .056, .056, -L + .01)], [
			0,
			-U + .05,
			0
		], "none"), m), fore, S_TOP, 0, S, E);
		f.add(xf(loft([ring(4, .05, .06, -L + .02, Q), ring(4, .052, .07, -L - .06, Q, 0, .004)], "none", [
			0,
			-L - .125,
			.004
		]), m), fore, S_SKIN, 0, S, E);
	}
	const hs = d.hs, y0 = d.headY, hp = headPiv(d);
	f.add(loft([ring(6, .122 * hs, .112 * hs, y0 + .07 * hs, HEX), ring(6, .124 * hs, .112 * hs, y0 + .21 * hs, HEX)], [
		0,
		y0 - .01 * hs,
		.012 * hs
	], [
		0,
		y0 + .29 * hs,
		-.006 * hs
	]), PT_HEAD, S_SKIN, 0, hp);
	const fz = .103 * hs;
	for (const s of [1, -1]) {
		const ex = s * .04 * hs, ey = y0 + .14 * hs, w = .021 * hs, h = .032 * hs;
		f.add(flat([
			ex - w,
			ey - h,
			ex + w,
			ey - h,
			ex + w,
			ey + h,
			ex - w,
			ey + h
		], fz), PT_HEAD, S_INK, 0, hp);
	}
	// generic hair cap (+ a long back for O_HAIR_B) and a generic hat (brim + crown)
	const yf = (a) => y0 + hs * (.1 + .125 * (.5 + .5 * Math.cos(a)));
	const R1 = ring(6, 1, 1, 0, HEX, 0, 0, yf).map(([x, y, z]) => {
		const r = headR((y - y0) / hs) * hs * 1.12 + .004 * hs;
		return [
			x * r,
			y,
			z * r - .004 * hs
		];
	});
	f.add(loft([R1], "none", [
		0,
		y0 + .32 * hs,
		-.01 * hs
	], [
		0,
		y0 + .15 * hs,
		0
	]), PT_HEAD, S_HAIR, O_MHAIR, hp);
	f.add(loft([ring(4, .125 * hs, .045 * hs, y0 + .25 * hs, Q, 0, -.09 * hs), ring(4, .12 * hs, .04 * hs, y0 + .01 * hs, Q, 0, -.085 * hs)], "none", "none"), PT_HEAD, S_HAIR, O_HAIR_B, hp);
	const rd = headR(.22) * hs * 1.14 + .004 * hs;
	f.add(loft([ring(6, .19 * hs, .19 * hs, y0 + .2 * hs, HEX, 0, .02 * hs), ring(6, rd, rd, y0 + .235 * hs, HEX)], "none", [
		0,
		y0 + .35 * hs,
		0
	], [
		0,
		y0 + .15 * hs,
		0
	]), PT_HEAD, S_HAIR, O_MHAT, hp);
	return f.geometry();
}
// ═════════════════════════════════ shaders ═════════════════════════════════
function glslCol(hex) {
	const c = new THREE.Color(hex);
	return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}
const CIV_PARS = `
attribute vec4 aTag;
attribute vec3 aPiv;
attribute vec3 aElb;
attribute vec4 iC1;
attribute vec4 iC2;
attribute vec4 iC3;
attribute vec4 iAnim;
mat3 civR;
mat3 civE;
float civKeep;
mat3 civRx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 civRy(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 civRz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void civSetup() {
  int part = int(aTag.x + 0.5);
  int opt = int(aTag.z + 0.5);
  int mask = int(iC1.w + 0.5);
  int style = int(iC3.w + 0.5);
  float pose = iAnim.z;
  bool panic = abs(pose - ${P_PANIC}.0) < 0.5;
  civKeep = 1.0;
  if (opt == ${O_PHONE}) civKeep = abs(pose - ${P_PHONE}.0) < 0.5 ? 1.0 : 0.0;
  else if (opt == ${O_CALM}) civKeep = panic ? 0.0 : 1.0;
  else if (opt == ${O_PANIC}) civKeep = panic ? 1.0 : 0.0;
  else if (opt == ${O_MHAT}) civKeep = (mask & ${bit(O_HAT_A) | bit(O_HAT_B)}) != 0 ? 1.0 : 0.0;
  else if (opt == ${O_MHAIR}) civKeep = (mask & ${bit(O_HAIR_A) | bit(O_HAIR_B)}) != 0 ? 1.0 : 0.0;
  else if (opt == ${O_SKIRT_B}) civKeep = float(style & 1);
  else if (opt == ${O_SKIRT_T}) civKeep = float((style >> 1) & 1);
  else if (opt > 0) civKeep = float((mask >> (opt - 1)) & 1);
  // a cane (right-hand extra) is dropped the moment its owner stops simply walking
  if (opt == ${O_EXTRA} && (part == ${PT_RARM} || part == ${PT_RFORE}) && pose > 0.5) civKeep = 0.0;
  civR = mat3(1.0);
  civE = mat3(1.0);
  float ph = iAnim.x, amp = iAnim.y;
  float s = sin(ph);
  if (part == ${PT_LLEG} || part == ${PT_RLEG} || part == ${PT_LSHIN} || part == ${PT_RSHIN}) {
    float side = (part == ${PT_LLEG} || part == ${PT_LSHIN}) ? 1.0 : -1.0;
    civR = civRx(side * s * (panic ? 0.95 : 0.55) * amp);
    // the knee folds while the leg swings forward (and a little on the plant)
    if (part == ${PT_LSHIN} || part == ${PT_RSHIN}) civE = civRx(min(amp, 1.4) * (0.08 + 0.95 * max(0.0, -side * cos(ph))) * (panic ? 1.3 : 1.0));
  } else if (part == ${PT_LARM} || part == ${PT_RARM} || part == ${PT_LFORE} || part == ${PT_RFORE}) {
    float side = (part == ${PT_LARM} || part == ${PT_LFORE}) ? 1.0 : -1.0;
    float still = 1.0 - min(amp, 1.0);
    float rx = -side * s * 0.5 * amp;
    float rz = side * (0.03 + 0.03 * abs(s) * amp + 0.04 * still * sin(ph * 0.7 + side));
    // relaxed elbows; more bend on the forward swing; a sprinter's 90 degrees
    float bend = 0.24 + 0.5 * max(0.0, side * s) * min(amp, 1.0) + max(0.0, amp - 1.0) * 2.4 + 0.06 * still * sin(ph * 0.9);
    if (panic) {
      rx = -2.55 + 0.5 * sin(ph * 1.7 + side * 1.9);
      rz = side * (0.5 + 0.32 * sin(ph * 2.3 + side * 0.7));
      bend = 0.62 + 0.45 * sin(ph * 2.9 + side * 1.3);
    } else if (abs(pose - ${P_POINT}.0) < 0.5 && side < 0.0) {
      rx = -1.72 + 0.05 * sin(ph * 2.0); rz = 0.12; bend = 0.06;
    } else if (abs(pose - ${P_PHONE}.0) < 0.5 && side < 0.0) {
      rx = -0.95 + 0.03 * sin(ph); rz = 0.32; bend = 1.5;
    } else if (abs(pose - ${P_WAVE}.0) < 0.5 && side < 0.0) {
      rx = -0.3; rz = -2.2 + 0.08 * sin(ph * 3.0); bend = 0.45 + 0.45 * sin(ph * 3.0);
    }
    if (side < 0.0 && ((mask >> ${O_UMB - 1}) & 1) == 1) { rx = ${UMB_RX} + (panic ? 0.25 * sin(ph * 2.0) : 0.0); rz = ${UMB_RZ}; bend = 0.0; }
    if (side > 0.0 && ((mask >> ${O_BALLOON - 1}) & 1) == 1) { rx = ${BAL_RX} + 0.06 * sin(ph); rz = ${BAL_RZ}; bend = 0.0; }
    civR = civRx(rx) * civRz(rz);
    if (part == ${PT_LFORE} || part == ${PT_RFORE}) civE = civRx(-bend);
  } else if (part == ${PT_HEAD}) {
    civR = civRy(iAnim.w) * civRx(-iC2.w);
  }
}
vec3 civPos(vec3 p) { return (aPiv + civR * (aElb + civE * (p - aElb) - aPiv)) * civKeep; }
`;
// colour-only instance attributes: declared in the toon program only (the ink hull would
// otherwise exceed the 16 vertex-attribute limit on D3D11/ANGLE)
const CIV_COLOR = `
attribute vec4 iC0;
attribute vec4 iC4;
varying vec3 vCivCol;
vec3 civColor() {
  int slot = int(aTag.y + 0.5);
  if (slot == ${S_SKIN}) return iC0.rgb;
  if (slot == ${S_TOP}) return iC1.rgb;
  if (slot == ${S_BOTTOM}) return iC2.rgb;
  if (slot == ${S_HAIR}) return iC3.rgb;
  if (slot == ${S_ACC}) return iC4.rgb;
  if (slot == ${S_SHOE}) {
    int k = int(iC0.w + 0.5);
    ${SHOES.map((h, i) => `if (k == ${i}) return ${glslCol(h)};`).join("\n    ")}
    return ${glslCol(SHOES[0])};
  }
  if (slot == ${S_INK}) return ${glslCol(INK)};
  if (slot == ${S_WHITE}) return ${glslCol("#f4f1e8")};
  if (slot == ${S_GREY}) return ${glslCol("#8f949c")};
  return ${glslCol("#7a5236")};
}
`;
function makeCivToon() {
	const m = makeToon({ color: "#ffffff" });
	m.name = "civToon";
	m.onBeforeCompile = (sh) => {
		sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + CIV_PARS + CIV_COLOR).replace("#include <beginnormal_vertex>", "civSetup();\nvec3 objectNormal = civR * (civE * vec3( normal ));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif").replace("#include <begin_vertex>", "vec3 transformed = civPos( position );\nvCivCol = civColor();");
		sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vCivCol;").replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vCivCol;");
	};
	m.customProgramCacheKey = () => "civToon-v2";
	return m;
}
function makeCivOutline() {
	const m = makeOutlineMaterial({
		widthPx: OUTLINE_W,
		instanced: true
	});
	m.name = "civInk";
	m.vertexShader = m.vertexShader.replace("#include <common>", "#include <common>\n" + CIV_PARS).replace("vec3 objectNormal = outlineNormal;", "civSetup();\n  vec3 objectNormal = civR * (civE * outlineNormal);").replace("#include <begin_vertex>", "vec3 transformed = civPos( position );");
	return m;
}
/** per-archetype triangle counts (debug / tests) */
export function civArchetypeStats() {
	const out = {};
	for (const id of Object.keys(ARCH)) {
		const f = new Fig();
		ARCH[id].build(f);
		out[id] = f.pos.length / 9;
	}
	const g = buildLod();
	out.lod = g.getAttribute("position").count / 3;
	g.dispose();
	const m = buildMid();
	out.mid = m.getAttribute("position").count / 3;
	m.dispose();
	return out;
}
/** Scratch / debug gallery: each archetype (rows) in a line of poses and option sets (columns),
*  plus the MID and LOD figures — same geometry, materials and shader as the live view. */
export function civGallery(biome, rows = Object.keys(ARCH)) {
	const toon = makeCivToon(), ink = makeCivOutline();
	const group = new THREE.Group();
	const disp = [toon, ink];
	const COLS = [
		[
			P_WALK,
			0,
			bit(O_HAIR_A) | bit(O_BAG) | bit(O_EXTRA)
		],
		[
			P_WALK,
			1,
			bit(O_HAIR_B) | bit(O_EXTRA)
		],
		[
			P_PANIC,
			1,
			bit(O_HAT_A) | bit(O_BAG)
		],
		[
			P_POINT,
			0,
			bit(O_HAT_B) | bit(O_EXTRA)
		],
		[
			P_PHONE,
			0,
			bit(O_HAIR_A) | bit(O_BAG)
		],
		[
			P_WAVE,
			0,
			bit(O_HAT_A) | bit(O_EXTRA)
		],
		[
			P_WALK,
			.4,
			bit(O_HAIR_B) | bit(O_UMB) | bit(O_BALLOON)
		]
	];
	const anims = [];
	const all = [
		...rows,
		"mid",
		"lod"
	];
	const ids = Object.keys(ARCH);
	all.forEach((id, r) => {
		let geo;
		if (id === "lod") geo = buildLod();
		else if (id === "mid") geo = buildMid();
		else {
			const f = new Fig();
			ARCH[id].build(f);
			geo = f.geometry();
		}
		const n = COLS.length;
		const arrs = ATTR_NAMES.map(() => new Float32Array(n * 4));
		const ats = arrs.map((a, i) => {
			const at = new THREE.InstancedBufferAttribute(a, 4);
			geo.setAttribute(ATTR_NAMES[i], at);
			return at;
		});
		const mesh = new THREE.InstancedMesh(geo, toon, n);
		mesh.frustumCulled = false;
		mesh.receiveShadow = true;
		if (id !== "lod") {
			const h = addOutline(mesh, OUTLINE_W);
			h.material = ink;
		}
		const c3 = new THREE.Color();
		COLS.forEach(([pose, amp, mask], c) => {
			const arch = id === "lod" || id === "mid" ? ARCH[ids[(c * 3 + r) % ids.length]] : ARCH[id];
			mesh.setMatrixAt(c, new THREE.Matrix4().makeTranslation((c - (n - 1) / 2) * 1.05, 0, -r * 1.7));
			const lk = arch.look(biome);
			const put = (ai, hex, wv) => {
				c3.set(hex);
				arrs[ai].set([
					c3.r,
					c3.g,
					c3.b,
					wv
				], c * 4);
			};
			put(0, lk.skin, lk.shoe);
			put(1, lk.top, id === "courier" ? bit(O_HAT_A) : id === "mid" || id === "lod" ? lk.mask : mask);
			put(2, lk.bottom, pose === P_WALK && amp === 0 ? 0 : .35);
			put(3, lk.hair, arch.mid ?? 0);
			put(4, lk.acc, 0);
			arrs[5].set([
				c * 1.3,
				amp,
				pose,
				0
			], c * 4);
		});
		for (const at of ats) at.needsUpdate = true;
		anims.push({
			arr: arrs[5],
			at: ats[5],
			n
		});
		group.add(mesh);
		disp.push(geo, mesh);
	});
	return {
		group,
		tick(t) {
			for (const a of anims) {
				for (let c = 0; c < a.n; c++) a.arr[c * 4] = c * 1.3 + t * (a.arr[c * 4 + 2] === P_PANIC ? 14 : a.arr[c * 4 + 1] > 0 ? 7 : 3);
				a.at.needsUpdate = true;
			}
		},
		dispose() {
			for (const d of disp) d.dispose();
		}
	};
}
const ATTR_NAMES = [
	"iC0",
	"iC1",
	"iC2",
	"iC3",
	"iC4",
	"iAnim"
];
// ── detail tiers, picked by the on-screen height of a figure standing at the camera target ──
/** figure height (m at scale 1) used for on-screen size estimates */
const FIG_H = 1.5;
/** ≥ this many px tall: full archetype figures (+ hulls) */
const FULL_PX = 44;
/** ≥ this: the MID figure (one draw + hull for everyone); below (Size III+): the 56-tri far figure */
const MID_PX = 26;
/** the MID figure keeps its ink hull while at least this tall */
const HULL_PX = 15;
/** cost ceiling for the MID crowd: the old capsule-pill crowd's triangle count */
const PILL_TRIS = 81920;
// ── personal space (× the rank's civ scale) ──
/** hard minimum centre-to-centre distance */
const SEP_K = .7;
/** soft zone: a gentle push starts here (walkers step around each other) */
const SOFT_K = 1;
/** spawn spacing between any two civilians, and the spacing inside a group */
const SPAWN_SEP_K = .85;
const GROUP_SP_K = .98;
/** a new group's anchor needs this much clear space */
const ANCHOR_CLEAR_K = 1.15;
/** spatial-hash cell (≥ the largest neighbour radius used with a 3×3 query) */
const CELL_K = 1;
const HASH = 2048;
/** body radius for prop avoidance */
const BODY_K = .26;
/** paved forecourt: sidewalk walkers may use up to this many metres of parcel inside the sidewalk */
const PLAZA_DEPTH = 7;
// ── near-camera rules (× the target figure's on-screen height) ──
/** never spawn a figure this much bigger than one at the camera target */
const SPAWN_NEAR = 1.45;
/** never draw one this much bigger (it would be a giant blob right under the lens) */
const DRAW_NEAR = 2.3;
/** still frames (slate / pause): a figure at least this big AND cut by the screen edge is not drawn
*  (and never spawned) — no half figures poking in at the frame edges behind the slate's captions */
const EDGE_NEAR = .8;
/** still frames: NDC y below which the bottom caption band starts (the lowest ~20 % of the frame) */
const STILL_BOTTOM = -.6;
export class CivilianView {
	ctx;
	root = new THREE.Group();
	batches = [];
	mid = null;
	lod = null;
	midTris = 240;
	archs = [];
	archW = [];
	archWSum = 1;
	puffs = null;
	disposables = [];
	// SoA civilian state
	x = new Float32Array(CAP);
	z = new Float32Array(CAP);
	vx = new Float32Array(CAP);
	vz = new Float32Array(CAP);
	t = new Float32Array(CAP);
	spd = new Float32Array(CAP);
	ph = new Float32Array(CAP);
	hd = new Float32Array(CAP);
	hy = new Float32Array(CAP);
	hp = new Float32Array(CAP);
	amp = new Float32Array(CAP);
	hvar = new Float32Array(CAP);
	st = new Uint8Array(CAP);
	arch = new Uint8Array(CAP);
	pose = new Uint8Array(CAP);
	/** group leader (self = on its own); followers copy the leader's walk / stop */
	lead = new Int16Array(CAP);
	/** 1 = strolling inside a park / plaza block instead of on the sidewalk ring */
	inPark = new Uint8Array(CAP);
	/** static per-civilian instance colours: iC0..iC4 (5 × vec4) */
	col = new Float32Array(CAP * 20);
	// spatial hash (linked lists through hNext), rebuilt twice a frame — zero allocation
	hHead = new Int32Array(HASH);
	hNext = new Int32Array(CAP);
	hCell = 1;
	/** per block: 1 = park / plaza (no buildings) */
	parkCell = new Uint8Array(0);
	puffList = [];
	puffCursor = 0;
	waterZ = null;
	live = 0;
	scaleNow = 1;
	/** px of on-screen height per (m of figure / m of camera distance) */
	pxK = 600;
	figPx = 100;
	freeCursor = 0;
	frameNo = 0;
	/** per prop id: footprint half extents (width / length; trees = trunk) and a per-frame heading trig cache */
	propHW = new Float32Array(0);
	propHL = new Float32Array(0);
	propSin = new Float32Array(0);
	propCos = new Float32Array(0);
	propStamp = new Int32Array(0);
	/** debug / tests: the detail tier this frame (0 full, 1 mid, 2 far) and the target figure px */
	dbg = {
		tier: 0,
		figPx: 0,
		hull: true,
		live: 0,
		minGap: 0,
		fleeing: 0,
		propPush: 0,
		inProp: 0,
		inPark: 0,
		forecourt: 0,
		ms: 0,
		msSpawn: 0,
		msSep: 0,
		msLoop: 0,
		culledNear: 0,
		culledEdge: 0,
		pxMax: 0
	};
	// scratch
	m4 = new THREE.Matrix4();
	q = new THREE.Quaternion();
	eul = new THREE.Euler(0, 0, 0, "YXZ");
	p3 = new THREE.Vector3();
	s3 = new THREE.Vector3();
	v3 = new THREE.Vector3();
	c3 = new THREE.Color();
	constructor(ctx) {
		this.ctx = ctx;
		this.root.name = "civilians";
		this.root.userData.civ = this.dbg;
	}
	/** civilians currently on screen (debug / tests) */
	get count() {
		return this.live;
	}
	mount(w) {
		this.waterZ = harbourWaterZ(w.city);
		const toon = makeCivToon();
		const ink = makeCivOutline();
		this.disposables.push(toon, ink);
		const mix = BIOME_MIX[w.biomeId] ?? BIOME_MIX.grideast;
		this.archs = mix.map(([id]) => ARCH[id]);
		this.archW = mix.map(([, wgt]) => wgt);
		this.archWSum = this.archW.reduce((s, v) => s + v, 0);
		this.batches = this.archs.map((a) => {
			const f = new Fig();
			a.build(f);
			return this.makeBatch("civ:" + a.id, f.geometry(), toon, ink);
		});
		const midGeo = buildMid();
		this.midTris = midGeo.getAttribute("position").count / 3;
		this.mid = this.makeBatch("civ:mid", midGeo, toon, ink);
		this.lod = this.makeBatch("civ:lod", buildLod(), toon, null);
		const np0 = w.city.props.length;
		this.propHW = new Float32Array(np0);
		this.propHL = new Float32Array(np0);
		this.propSin = new Float32Array(np0);
		this.propCos = new Float32Array(np0);
		this.propStamp = new Int32Array(np0).fill(-1);
		for (let k = 0; k < np0; k++) {
			const pr = w.city.props[k];
			const info = PROP_INFO[pr.kind];
			const tree = pr.kind === "tree";
			this.propHW[k] = tree ? .3 : info.wid * .5;
			this.propHL[k] = tree ? .3 : info.len * .5;
		}
		// park / plaza blocks: no buildings (the harbour row of a flooded city is water, not a park)
		const city = w.city;
		this.parkCell = new Uint8Array(city.blocksX * city.blocksZ);
		for (let bz = 0; bz < city.blocksZ; bz++) {
			for (let bx = 0; bx < city.blocksX; bx++) {
				const bi = bx + bz * city.blocksX;
				this.parkCell[bi] = city.blockBuildings[bi].length === 0 && !(city.flooded && bz === 0) ? 1 : 0;
			}
		}
		const ico = new THREE.IcosahedronGeometry(.5, 0);
		const puffGeo = facet(ico);
		ico.dispose();
		bakeOutlineNormals(puffGeo);
		puffGeo.computeBoundingSphere();
		const puffMat = makeToon({ color: "#f4ecd8" });
		this.disposables.push(puffGeo, puffMat);
		this.puffs = new THREE.InstancedMesh(puffGeo, puffMat, PUFF_CAP * PUFF_BALLS);
		this.puffs.name = "civ:puffs";
		this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.puffs.frustumCulled = false;
		this.puffs.count = 0;
		addOutline(this.puffs, 1.4);
		this.root.add(this.puffs);
		this.puffList = [];
		for (let i = 0; i < PUFF_CAP; i++) this.puffList.push({
			x: 0,
			y: 0,
			z: 0,
			t: PUFF_LIFE,
			s: 1
		});
		this.st.fill(ST_EMPTY);
		for (let i = 0; i < CAP; i++) this.lead[i] = i;
		this.ctx.scene.add(this.root);
	}
	makeBatch(name, geo, toon, ink) {
		const arrs = [];
		const attrs = [];
		for (const nm of ATTR_NAMES) {
			const a = new Float32Array(CAP * 4);
			const at = new THREE.InstancedBufferAttribute(a, 4);
			at.setUsage(THREE.DynamicDrawUsage);
			geo.setAttribute(nm, at);
			arrs.push(a);
			attrs.push(at);
		}
		const mesh = new THREE.InstancedMesh(geo, toon, CAP);
		mesh.name = name;
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = true;
		mesh.count = 0;
		mesh.visible = false;
		let hull = null;
		if (ink) {
			hull = addOutline(mesh, OUTLINE_W);
			hull.material = ink;
			hull.name = name + ":ink";
		}
		this.root.add(mesh);
		this.disposables.push(geo);
		return {
			mesh,
			hull,
			attrs,
			arrs,
			n: 0
		};
	}
	update(w, f) {
		if (!this.lod || !this.mid || !this.puffs) return;
		const t0 = performance.now();
		const T = w.titan;
		const H = T.height;
		const rank = T.rank;
		const a = f.alpha;
		const tx = T.px + (T.x - T.px) * a, tz = T.pz + (T.z - T.pz) * a;
		const dt = f.frozen ? 0 : f.dt;
		const qm = Q_MUL[this.ctx.quality.level] ?? 1;
		const want = Math.min(CAP, Math.round(CROWD[rank] * qm));
		const scale = CIV_SCALE[rank];
		this.scaleNow = scale;
		const R = Math.max(10, f.camDist * .62);
		const R2out = (f.camDist * .9 + 6) * (f.camDist * .9 + 6);
		const liveR = CITY.liveRadiusByRank[rank] ?? 2;
		const city = w.city;
		const P = city.pitch;
		const tbx = Math.floor((tx - city.originX) / P), tbz = Math.floor((tz - city.originZ) / P);
		const moving = T.moving || T.speed > .5;
		const fleeR = H * (moving ? 6 : 2.5);
		const calmR = H * 8.5;
		const squashR = Math.max(.7, T.radius * 1.15);
		const canSquash = H > 2.4;
		// ── detail tier from the on-screen size of a figure at the camera target ──
		const cam = this.ctx.camera;
		cam.updateMatrixWorld();
		const cssH = Math.max(1, this.ctx.renderer.domElement.clientHeight || 720);
		this.pxK = cssH / (2 * Math.tan(cam.fov * Math.PI / 360));
		const figPx = FIG_H * scale * this.pxK / Math.max(1, f.camDist);
		this.figPx = figPx;
		let tier = figPx >= FULL_PX ? 0 : figPx >= MID_PX ? 1 : 2;
		let midHull = figPx >= HULL_PX;
		if (tier === 1) {
			// the whole MID crowd (+ its hull) must cost no more than the old pill crowd did
			if (want * this.midTris * 2 > PILL_TRIS) midHull = false;
			if (want * this.midTris > PILL_TRIS) tier = 2;
		}
		for (const b of this.batches) if (b.hull) b.hull.visible = tier === 0;
		if (this.mid.hull) this.mid.hull.visible = tier === 1 && midHull;
		this.dbg.tier = tier;
		this.dbg.figPx = Math.round(figPx * 10) / 10;
		this.dbg.hull = tier === 0 || tier === 1 && midHull;
		// ── events: footsteps / collapses / explosions puff whoever is underneath ──
		if (!f.frozen) {
			for (let k = 0; k < f.events.length; k++) {
				const e = f.events[k];
				if (e.type === "footstep" && canSquash) this.squashCircle(e.x, e.z, squashR, scale);
				else if (e.type === "buildingCollapse") this.squashRect(e.x, e.z, e.w / 2 + 2 * scale, e.d / 2 + 2 * scale, scale);
				else if (e.type === "explosion") this.squashCircle(e.x, e.z, e.r * .8, scale);
			}
			// the titan's own body (moving) also flattens whoever it wades through (Size II+)
			if (canSquash && moving) this.squashCircle(tx, tz, T.radius * .85, scale);
		}
		// ── recycle ──
		let alive = 0;
		for (let i = 0; i < CAP; i++) {
			const s = this.st[i];
			if (s === ST_EMPTY) continue;
			if (s === ST_GONE) {
				this.t[i] -= dt;
				if (this.t[i] <= 0) this.st[i] = ST_EMPTY;
				continue;
			}
			const dx = this.x[i] - tx, dz = this.z[i] - tz;
			if (dx * dx + dz * dz > R2out || !this.inLiveBlock(city, this.x[i], this.z[i], tbx, tbz, liveR)) {
				this.st[i] = ST_EMPTY;
				continue;
			}
			alive++;
		}
		// over budget after a quality drop: retire a few calm ones
		if (alive > want) {
			for (let i = CAP - 1; i >= 0 && alive > want; i--) if (this.st[i] === ST_MILL || this.st[i] === ST_IDLE) {
				this.st[i] = ST_EMPTY;
				alive--;
			}
		}
		// ── spawn: small groups (1–5) with personal space, on sidewalks and in parks ──
		const tS = performance.now();
		this.hashBuild(CELL_K * scale);
		let budget = f.frozen ? 0 : Math.max(8, Math.ceil(want / 10));
		if (this.live === 0 && alive === 0) budget = want;
		let attempts = budget * 2 + 12;
		while (alive < want && budget > 0 && attempts-- > 0) {
			const got = this.spawnGroup(w, tx, tz, R, H, tbx, tbz, liveR, scale, Math.min(5, want - alive, budget), f.frozen);
			alive += got;
			budget -= Math.max(1, got);
		}
		// ── behaviour + integration ──
		for (let i = 0; i < CAP; i++) {
			const s = this.st[i];
			if (s === ST_EMPTY || s === ST_GONE) continue;
			const x = this.x[i], z = this.z[i];
			const dx = x - tx, dz = z - tz;
			const d = Math.hypot(dx, dz) || .001;
			this.t[i] -= dt;
			const ar = this.archs[this.arch[i]];
			if (s !== ST_FLEE && d < fleeR) {
				this.st[i] = ST_FLEE;
				const sp = (3.4 + .11 * H) * (.8 + Math.random() * .45) * (ar.id === "elder" ? .7 : 1);
				const jit = (Math.random() - .5) * .9;
				const ux = dx / d, uz = dz / d;
				this.vx[i] = (ux * Math.cos(jit) - uz * Math.sin(jit)) * sp;
				this.vz[i] = (ux * Math.sin(jit) + uz * Math.cos(jit)) * sp;
				this.spd[i] = sp;
				this.t[i] = 2.5 + Math.random() * 2;
				this.pose[i] = Math.random() < .72 ? P_PANIC : P_WALK;
			} else if (s === ST_FLEE) {
				// keep steering away from the titan (with a little panic wobble)
				const sp = this.spd[i];
				const ux = dx / d, uz = dz / d;
				const k = Math.min(1, dt * 3);
				this.vx[i] += (ux * sp - this.vx[i]) * k + (Math.random() - .5) * sp * dt * 2;
				this.vz[i] += (uz * sp - this.vz[i]) * k + (Math.random() - .5) * sp * dt * 2;
				if (d > calmR && this.t[i] <= 0) {
					this.st[i] = ST_MILL;
					this.pose[i] = P_WALK;
					if (!this.followLeader(i)) this.setMill(i, x, z, city, ar);
				}
			} else if (this.t[i] <= 0) {
				// mill ⇄ idle (stand and gawk toward the titan); group members copy their leader
				if (!this.followLeader(i)) {
					if (s === ST_MILL && Math.random() < .45) this.setIdle(i);
					else {
						this.st[i] = ST_MILL;
						this.pose[i] = P_WALK;
						this.setMill(i, x, z, city, ar);
					}
				}
			}
			this.x[i] = x + this.vx[i] * dt;
			this.z[i] = z + this.vz[i] * dt;
		}
		const tP = performance.now();
		// ── personal space: nobody stands inside anybody else ──
		this.separate(scale, dt);
		const tL = performance.now();
		// ── constraints + pose + instances ──
		for (const b of this.batches) b.n = 0;
		this.mid.n = 0;
		this.lod.n = 0;
		let n = 0;
		const glanceR2 = (H * 12 + 8) * (H * 12 + 8);
		const camP = cam.position;
		const body = BODY_K * scale;
		let fleeing = 0, inProp = 0, parkers = 0, forecourt = 0, culledNear = 0, culledEdge = 0, pxMax = 0;
		const audit = (++this.frameNo & 15) === 0;
		this.dbg.propPush = 0;
		for (let i = 0; i < CAP; i++) {
			const s = this.st[i];
			if (s === ST_EMPTY || s === ST_GONE) continue;
			let x = this.x[i], z = this.z[i];
			const ar = this.archs[this.arch[i]];
			// walkable ground only: sidewalks / forecourts / parks — never buildings, water or off the map
			const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
			const cx = city.originX + (bx + .5) * P, cz = city.originZ + (bz + .5) * P;
			let lx = x - cx, lz = z - cz;
			if (s !== ST_FLEE && this.inPark[i]) {
				// strolling in a park / plaza: stay inside it, turn back at its edge
				const lim = PARCEL_HALF - .6;
				if (lx > lim) {
					lx = lim;
					if (this.vx[i] > 0) this.vx[i] = -this.vx[i];
				} else if (lx < -lim) {
					lx = -lim;
					if (this.vx[i] < 0) this.vx[i] = -this.vx[i];
				}
				if (lz > lim) {
					lz = lim;
					if (this.vz[i] > 0) this.vz[i] = -this.vz[i];
				} else if (lz < -lim) {
					lz = -lim;
					if (this.vz[i] < 0) this.vz[i] = -this.vz[i];
				}
			} else if (s !== ST_FLEE) {
				// milling civilians keep to the sidewalk band — or the paved forecourt between it and the
				// facades (never closer than ~0.9 m to a building); at the end of a side they turn the
				// corner onto the adjacent side of the same block (a civilian that fled onto the road walks
				// back to the curb instead of snapping)
				const ax = Math.abs(lx), az = Math.abs(lz);
				const step = 2.2 * dt;
				const vxi = this.vx[i], vzi = this.vz[i];
				const walking = vxi * vxi + vzi * vzi > .0025;
				const xSide = walking ? Math.abs(vzi) >= Math.abs(vxi) : ax >= az;
				if (xSide) {
					const sg = Math.sign(lx || 1);
					const inner = this.innerLimit(city, bx, bz, cx, cz, false, sg, z, vzi, scale);
					const wnt = Math.min(SW_OUT, Math.max(inner, ax));
					lx = sg * (ax + Math.max(-step, Math.min(step, wnt - ax)));
					if (walking && Math.abs(lz) > SW_OUT - .25 && lz * vzi > 0) {
						lz = Math.sign(lz) * (SW_OUT - .25);
						this.turnCorner(i, true, sg);
					}
				} else {
					const sg = Math.sign(lz || 1);
					const inner = this.innerLimit(city, bx, bz, cx, cz, true, sg, x, vxi, scale);
					const wnt = Math.min(SW_OUT, Math.max(inner, az));
					lz = sg * (az + Math.max(-step, Math.min(step, wnt - az)));
					if (walking && Math.abs(lx) > SW_OUT - .25 && lx * vxi > 0) {
						lx = Math.sign(lx) * (SW_OUT - .25);
						this.turnCorner(i, false, sg);
					}
				}
			}
			x = cx + lx;
			z = cz + lz;
			// buildings (never run through one), parked cars, kiosks, benches, lamps, trees: go AROUND
			if (s !== ST_IDLE) {
				this.p3.set(x, 0, z);
				this.avoidBuildings(i, city, bx, bz, body);
				this.avoidProps(i, city, bx, bz, body, s === ST_FLEE);
				x = this.p3.x;
				z = this.p3.z;
			}
			const bb = city.bounds;
			if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ || this.waterZ !== null && z < this.waterZ) {
				this.st[i] = ST_EMPTY;
				continue;
			}
			this.x[i] = x;
			this.z[i] = z;
			lx = x - cx;
			lz = z - cz;
			if (s === ST_FLEE) {
				fleeing++;
				if (audit && this.inProp(city, x, z, 0)) inProp++;
			} else if (this.inPark[i]) parkers++;
			else if (Math.max(Math.abs(lx), Math.abs(lz)) < SW_IN - .3) forecourt++;
			// ── pose ──
			const dx = x - tx, dz = z - tz;
			const d = Math.hypot(dx, dz) || .001;
			const vx = this.vx[i], vz = this.vz[i];
			const v = Math.hypot(vx, vz);
			const toT = Math.atan2(tx - x, tz - z);
			if (v > .05) this.hd[i] = s === ST_FLEE ? Math.atan2(vx, vz) : turnToward(this.hd[i], Math.atan2(vx, vz), dt * 8);
			else if (s === ST_IDLE) this.hd[i] = turnToward(this.hd[i], toT, dt * 3.5);
			const sc = scale * (tier === 0 ? 1 : ar.lod);
			// gait phase locked to ground speed: one leg cycle = two strides
			const stride = ar.stride * scale;
			// swing amplitude: coats / skirts / elders swing less (legs stay inside the hem)
			const targetAmp = (s === ST_FLEE ? (this.pose[i] === P_PANIC ? .85 : 1.2) + .15 * ar.swing : Math.min(1, v / .8)) * ar.swing;
			this.amp[i] += (targetAmp - this.amp[i]) * (dt > 0 ? Math.min(1, dt * 6) : 1);
			this.ph[i] += dt * (v > .05 ? Math.min(20, v / stride * Math.PI) : 3.2);
			// head: gawkers look UP at the titan; walkers glance at it when it is close
			let yawT = 0, pitchT = 0;
			if (s !== ST_FLEE && dx * dx + dz * dz < glanceR2) {
				yawT = wrapPi(toT - this.hd[i]);
				yawT = Math.max(-1.05, Math.min(1.05, yawT));
				const eye = 1.35 * sc;
				pitchT = Math.max(-.1, Math.min(.62, Math.atan2(H * .8 - eye, d)));
				if (s === ST_MILL) {
					yawT *= .8;
					pitchT *= .6;
				}
			} else if (s === ST_FLEE) {
				yawT = .5 * Math.sin(this.ph[i] * .37 + i);
			}
			const hk = dt > 0 ? Math.min(1, dt * 5) : 1;
			this.hy[i] += (yawT - this.hy[i]) * hk;
			this.hp[i] += (pitchT - this.hp[i]) * hk;
			const cellR = Math.max(Math.abs(lx), Math.abs(lz));
			const am = this.amp[i];
			const bob = Math.abs(Math.sin(this.ph[i])) * (s === ST_FLEE ? .075 : .03) * am * sc;
			const y = (cellR <= SW_OUT + .05 ? SIDEWALK_Y : 0) + bob;
			// near-camera rules: no giant figures right under the lens, no big cut-off ones in still frames
			const cdx = x - camP.x, cdy = y + .75 * sc - camP.y, cdz = z - camP.z;
			const px = FIG_H * sc * this.pxK / Math.max(.01, Math.hypot(cdx, cdy, cdz));
			if (px > pxMax) pxMax = px;
			if (px > figPx * DRAW_NEAR) {
				culledNear++;
				continue;
			}
			if (f.frozen && px > figPx * EDGE_NEAR && this.cutByEdge(x, y, z, sc, true)) {
				culledEdge++;
				continue;
			}
			const lean = s === ST_FLEE ? this.pose[i] === P_PANIC ? .12 : .24 : .03 * am;
			this.eul.set(lean, this.hd[i], Math.sin(this.ph[i]) * .035 * am);
			this.q.setFromEuler(this.eul);
			this.p3.set(x, y, z);
			const hv = this.hvar[i];
			this.s3.set(sc * (.96 + .08 * hv), sc * (.92 + .16 * hv), sc * (.96 + .08 * hv));
			this.m4.compose(this.p3, this.q, this.s3);
			const b = tier === 0 ? this.batches[this.arch[i]] : tier === 1 ? this.mid : this.lod;
			const k = b.n++;
			b.mesh.setMatrixAt(k, this.m4);
			const o = i * 20, k4 = k * 4;
			const A = b.arrs, C = this.col;
			for (let c = 0; c < 5; c++) {
				const dst = A[c], so = o + c * 4;
				dst[k4] = C[so];
				dst[k4 + 1] = C[so + 1];
				dst[k4 + 2] = C[so + 2];
				dst[k4 + 3] = C[so + 3];
			}
			A[2][k4 + 3] = this.hp[i];
			const an = A[5];
			an[k4] = this.ph[i];
			an[k4 + 1] = am;
			an[k4 + 2] = this.pose[i];
			an[k4 + 3] = this.hy[i];
			n++;
		}
		const tE = performance.now();
		this.dbg.msSpawn = Math.round((tP - tS) * 100) / 100;
		this.dbg.msSep = Math.round((tL - tP) * 100) / 100;
		this.dbg.msLoop = Math.round((tE - tL) * 100) / 100;
		this.live = n;
		this.dbg.live = n;
		this.dbg.fleeing = fleeing;
		if (audit) this.dbg.inProp = inProp;
		this.dbg.inPark = parkers;
		this.dbg.forecourt = forecourt;
		this.dbg.culledNear = culledNear;
		this.dbg.culledEdge = culledEdge;
		this.dbg.pxMax = Math.round(pxMax);
		for (const b of this.batches) this.flush(b);
		this.flush(this.mid);
		this.flush(this.lod);
		// ── puffs ──
		let np = 0;
		for (let k = 0; k < PUFF_CAP; k++) {
			const p = this.puffList[k];
			if (p.t >= PUFF_LIFE) continue;
			p.t += dt;
			if (p.t >= PUFF_LIFE) continue;
			const u = p.t / PUFF_LIFE;
			const grow = u < .3 ? .4 + u / .3 * .75 : 1.15 * (1 - (u - .3) / .7);
			for (let bb = 0; bb < PUFF_BALLS; bb++) {
				const ang = bb * 2.094 + k;
				const r = p.s * (.25 + u * .5);
				this.p3.set(p.x + Math.cos(ang) * r, p.y + p.s * (.25 + u * .55 + bb * .12), p.z + Math.sin(ang) * r);
				const bs = p.s * grow * (.55 + .2 * bb);
				this.s3.set(bs, bs * .85, bs);
				this.eul.set(k, ang, 0);
				this.q.setFromEuler(this.eul);
				this.m4.compose(this.p3, this.q, this.s3);
				this.puffs.setMatrixAt(np++, this.m4);
			}
		}
		this.puffs.count = np;
		this.puffs.visible = np > 0;
		if (np > 0) this.puffs.instanceMatrix.needsUpdate = true;
		// debug / tests: CPU cost of this update (smoothed)
		this.dbg.ms = Math.round((this.dbg.ms * .9 + (performance.now() - t0) * .1) * 1e3) / 1e3;
	}
	/** upload only the live range of a batch */
	flush(b) {
		const n = b.n;
		b.mesh.count = n;
		b.mesh.visible = n > 0;
		if (n === 0) return;
		const im = b.mesh.instanceMatrix;
		im.clearUpdateRanges();
		im.addUpdateRange(0, n * 16);
		im.needsUpdate = true;
		for (const at of b.attrs) {
			at.clearUpdateRanges();
			at.addUpdateRange(0, n * 4);
			at.needsUpdate = true;
		}
	}
	unmount() {
		this.root.removeFromParent();
		for (const b of this.batches) b.mesh.dispose();
		this.mid?.mesh.dispose();
		this.lod?.mesh.dispose();
		this.puffs?.dispose();
		for (const d of this.disposables) d.dispose();
		this.disposables = [];
		this.root.clear();
		this.batches = [];
		this.mid = null;
		this.lod = null;
		this.puffs = null;
		this.st.fill(ST_EMPTY);
		this.live = 0;
	}
	// ─────────────────────────────── internals ───────────────────────────────
	inLiveBlock(city, x, z, tbx, tbz, liveR) {
		const bx = Math.floor((x - city.originX) / city.pitch), bz = Math.floor((z - city.originZ) / city.pitch);
		return Math.abs(bx - tbx) <= liveR && Math.abs(bz - tbz) <= liveR;
	}
	alive(i) {
		const s = this.st[i];
		return s === ST_MILL || s === ST_IDLE || s === ST_FLEE;
	}
	// ── spatial hash ──
	hashKey(cx, cz) {
		return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & HASH - 1;
	}
	hashBuild(cell) {
		this.hCell = cell;
		this.hHead.fill(-1);
		for (let i = 0; i < CAP; i++) if (this.alive(i)) this.hashInsert(i);
	}
	hashInsert(i) {
		const c = this.hCell;
		const k = this.hashKey(Math.floor(this.x[i] / c), Math.floor(this.z[i] / c));
		this.hNext[i] = this.hHead[k];
		this.hHead[k] = i;
	}
	/** is anybody (alive, in the hash) within r of (x, z)? */
	crowdedAt(x, z, r) {
		const c = this.hCell, r2 = r * r;
		const cx = Math.floor(x / c), cz = Math.floor(z / c), rc = Math.ceil(r / c);
		for (let oz = -rc; oz <= rc; oz++) {
			for (let ox = -rc; ox <= rc; ox++) {
				for (let j = this.hHead[this.hashKey(cx + ox, cz + oz)]; j >= 0; j = this.hNext[j]) {
					if (!this.alive(j)) continue;
					const ddx = this.x[j] - x, ddz = this.z[j] - z;
					if (ddx * ddx + ddz * ddz < r2) return true;
				}
			}
		}
		return false;
	}
	/** separation steering: a hard minimum distance (position projection) plus a soft zone that
	*  makes walkers side-step each other; gawkers standing still give way less. Three passes. */
	separate(scale, dt) {
		const sep = SEP_K * scale, soft = SOFT_K * scale, soft2 = soft * soft;
		const kSoft = Math.min(1, dt * 4);
		const X = this.x, Z = this.z;
		let minD2 = 1e9;
		for (let pass = 0; pass < 3; pass++) {
			this.hashBuild(CELL_K * scale);
			const c = this.hCell;
			for (let i = 0; i < CAP; i++) {
				if (!this.alive(i)) continue;
				const cx = Math.floor(X[i] / c), cz = Math.floor(Z[i] / c);
				const wi = this.st[i] === ST_IDLE ? .35 : 1;
				for (let oz = -1; oz <= 1; oz++) {
					for (let ox = -1; ox <= 1; ox++) {
						for (let j = this.hHead[this.hashKey(cx + ox, cz + oz)]; j >= 0; j = this.hNext[j]) {
							if (j <= i || !this.alive(j)) continue;
							let ddx = X[j] - X[i], ddz = Z[j] - Z[i];
							const d2 = ddx * ddx + ddz * ddz;
							if (pass === 2 && d2 < minD2) minD2 = d2;
							if (d2 >= soft2) continue;
							let dd = Math.sqrt(d2);
							if (dd < 1e-4) {
								const an = (i * 2.399 + j) % 6.2832;
								ddx = Math.cos(an);
								ddz = Math.sin(an);
								dd = 0;
							} else {
								ddx /= dd;
								ddz /= dd;
							}
							const push = dd < sep ? sep - dd + (soft - sep) * kSoft * .5 : (soft - dd) * kSoft * .5;
							if (push <= 0) continue;
							const wj = this.st[j] === ST_IDLE ? .35 : 1;
							const sh = push / (wi + wj);
							X[i] -= ddx * sh * wi;
							Z[i] -= ddz * sh * wi;
							X[j] += ddx * sh * wj;
							Z[j] += ddz * sh * wj;
						}
					}
				}
			}
		}
		// debug / tests: closest pair seen by the last pass (before its correction), in metres ÷ civ scale
		this.dbg.minGap = minD2 < 1e8 ? Math.round(Math.sqrt(minD2) / scale * 1e3) / 1e3 : -1;
	}
	/** push civilian i (position in p3) out of any prop footprint in its block cell; a fleeing one
	*  also looks ahead and swerves around the prop instead of ploughing into it */
	avoidProps(i, city, bx, bz, body, flee) {
		if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return;
		const ids = city.blockProps[bx + bz * city.blocksX];
		let x = this.p3.x, z = this.p3.z;
		let vx = this.vx[i], vz = this.vz[i];
		const sp = Math.hypot(vx, vz);
		const look = flee ? .7 : 0;
		// look-ahead segment midpoint: one circle around it covers the whole swept path
		const hx = vx * look * .5, hz = vz * look * .5, hr = sp * look * .5;
		for (let k = 0; k < ids.length; k++) {
			const id = ids[k];
			const p = city.props[id];
			if (!p || !p.alive || id >= this.propHW.length) continue;
			const hw = this.propHW[id] + body, hl = this.propHL[id] + body;
			const r0 = hw + hl;
			let dx = x - p.x, dz = z - p.z;
			if (dx * dx + dz * dz > r0 * r0) {
				const mx = dx + hx, mz = dz + hz, rm = r0 + hr;
				if (look === 0 || mx * mx + mz * mz > rm * rm) continue;
			}
			this.propTrig(id, p.heading);
			const sn = this.trigS, cs = this.trigC;
			// local frame: u along the prop's width (X), w along its length (+Z)
			let u = dx * cs - dz * sn, wv = dx * sn + dz * cs;
			if (Math.abs(u) < hw && Math.abs(wv) < hl) {
				// inside: out through the nearest side, and drop the inward velocity
				if (hw - Math.abs(u) < hl - Math.abs(wv)) u = Math.sign(u || 1) * hw;
				else wv = Math.sign(wv || 1) * hl;
				const nx0 = x, nz0 = z;
				this.dbg.propPush++;
				x = p.x + u * cs + wv * sn;
				z = p.z - u * sn + wv * cs;
				let nx = x - nx0, nz = z - nz0;
				const nl = Math.hypot(nx, nz);
				if (nl > 1e-5) {
					nx /= nl;
					nz /= nl;
					const vn = vx * nx + vz * nz;
					if (vn < 0) {
						vx -= vn * nx;
						vz -= vn * nz;
					}
				}
				dx = x - p.x;
				dz = z - p.z;
			} else if (look > 0 && sp > .1) {
				const ax = dx + vx * look, az = dz + vz * look;
				const ua = ax * cs - az * sn, wa = ax * sn + az * cs;
				if (Math.abs(ua) < hw && Math.abs(wa) < hl) {
					// about to hit it: swerve to the side of the prop we are already on
					let px = -vz / sp, pz = vx / sp;
					if (px * dx + pz * dz < 0) {
						px = -px;
						pz = -pz;
					}
					vx += px * sp * .9;
					vz += pz * sp * .9;
				}
			}
		}
		if (flee && sp > .1) {
			const nv = Math.hypot(vx, vz);
			if (nv > 1e-4) {
				vx *= sp / nv;
				vz *= sp / nv;
			}
		}
		this.vx[i] = vx;
		this.vz[i] = vz;
		this.p3.x = x;
		this.p3.z = z;
	}
	trigS = 0;
	trigC = 1;
	/** sin / cos of a prop's heading into trigS / trigC, computed once per prop per frame */
	propTrig(id, heading) {
		if (this.propStamp[id] !== this.frameNo) {
			this.propStamp[id] = this.frameNo;
			this.propSin[id] = Math.sin(heading);
			this.propCos[id] = Math.cos(heading);
		}
		this.trigS = this.propSin[id];
		this.trigC = this.propCos[id];
	}
	/** would a civilian standing at (x, z) be inside a prop footprint? */
	inProp(city, x, z, body) {
		const P = city.pitch;
		const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
		if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return false;
		const ids = city.blockProps[bx + bz * city.blocksX];
		for (let k = 0; k < ids.length; k++) {
			const id = ids[k];
			const p = city.props[id];
			if (!p || !p.alive || id >= this.propHW.length) continue;
			const hw = this.propHW[id] + body, hl = this.propHL[id] + body;
			const dx = x - p.x, dz = z - p.z;
			if (dx * dx + dz * dz > (hw + hl) * (hw + hl)) continue;
			this.propTrig(id, p.heading);
			const sn = this.trigS, cs = this.trigC;
			if (Math.abs(dx * cs - dz * sn) < hw && Math.abs(dx * sn + dz * cs) < hl) return true;
		}
		return false;
	}
	/** a figure at (x, y, z) would be partly on screen and partly cut off by the screen edge — or, in
	*  a still frame (`still`), stand in the bottom caption band (slate headline / PRESS ANY KEY) */
	cutByEdge(x, y, z, sc, still = false) {
		const cam = this.ctx.camera;
		const v = this.v3;
		const M = .97;
		v.set(x, y, z).project(cam);
		if (still && v.z < 1 && v.y < STILL_BOTTOM && v.y > -1.3 && Math.abs(v.x) < 1.3) return true;
		const feetIn = v.z < 1 && Math.abs(v.x) < M && Math.abs(v.y) < M;
		v.set(x, y + FIG_H * sc, z).project(cam);
		const headIn = v.z < 1 && Math.abs(v.x) < M && Math.abs(v.y) < M;
		return feetIn !== headIn || !feetIn && !headIn && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3;
	}
	/** a spot is fine for the camera: not a giant right under the lens, not a big figure cut by the edge */
	camOk(x, z, sc, still) {
		const c = this.ctx.camera.position;
		const px = FIG_H * sc * this.pxK / Math.max(.01, Math.hypot(x - c.x, SIDEWALK_Y + .75 * sc - c.y, z - c.z));
		if (px > this.figPx * SPAWN_NEAR) return false;
		return !(px > this.figPx * EDGE_NEAR && this.cutByEdge(x, SIDEWALK_Y, z, sc, still));
	}
	freeSlot() {
		for (let n = 0; n < CAP; n++) {
			const i = (this.freeCursor + n) % CAP;
			if (this.st[i] === ST_EMPTY) {
				this.freeCursor = (i + 1) % CAP;
				return i;
			}
		}
		return -1;
	}
	/**
	* Spawn a small group (1–5) around one anchor spot: strollers walk side by side / in pairs,
	* gawkers stand in a loose staggered arc facing the titan (the ends a step closer to it).
	* Sidewalk groups use the whole sidewalk depth; park / plaza blocks get groups inside them.
	* Every member keeps personal space from everyone already there and from props.
	* Returns how many were placed.
	*/
	spawnGroup(w, tx, tz, R, H, tbx, tbz, liveR, scale, maxN, still) {
		const city = w.city;
		const P = city.pitch;
		const minD = Math.min(R * .7, H * 3);
		const gsp = GROUP_SP_K * scale;
		const body = BODY_K * scale;
		for (let tries = 0; tries < 10; tries++) {
			const ang = Math.random() * Math.PI * 2;
			const rr = Math.sqrt(Math.random()) * R;
			const sx = tx + Math.cos(ang) * rr, sz = tz + Math.sin(ang) * rr;
			const bx = Math.floor((sx - city.originX) / P), bz = Math.floor((sz - city.originZ) / P);
			if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) continue;
			if (Math.abs(bx - tbx) > liveR || Math.abs(bz - tbz) > liveR) continue;
			const cx = city.originX + (bx + .5) * P, cz = city.originZ + (bz + .5) * P;
			let lx = sx - cx, lz = sz - cz;
			const park = this.parkCell[bx + bz * city.blocksX] === 1 && Math.random() < .85;
			const lim = PARCEL_HALF - 1.2;
			let alongX = false, dsgn = 1, inner = SW_IN;
			if (park) {
				if (Math.abs(lx) > lim || Math.abs(lz) > lim) {
					lx = (Math.random() * 2 - 1) * lim;
					lz = (Math.random() * 2 - 1) * lim;
				}
			} else {
				// anywhere across the sidewalk depth — or (40 %) out on the paved forecourt in front of the facades
				alongX = Math.abs(lx) < Math.abs(lz);
				dsgn = Math.sign((alongX ? lz : lx) || 1);
				inner = this.innerLimit(city, bx, bz, cx, cz, alongX, dsgn, alongX ? sx : sz, 0, scale);
				const band = inner < SW_IN - .6 && Math.random() < .4 ? inner + .3 + Math.random() * (SW_IN - inner - .3) : SW_IN + .3 + Math.random() * (SW_OUT - SW_IN - .6);
				if (!alongX) {
					lx = dsgn * band;
					lz = Math.max(-SW_OUT, Math.min(SW_OUT, lz));
				} else {
					lz = dsgn * band;
					lx = Math.max(-SW_OUT, Math.min(SW_OUT, lx));
				}
			}
			const ax0 = cx + lx, az0 = cz + lz;
			if (this.waterZ !== null && az0 < this.waterZ + 2) continue;
			const d0 = Math.hypot(ax0 - tx, az0 - tz);
			if (d0 > R * 1.05 || d0 < minD) continue;
			if (!this.camOk(ax0, az0, scale, still)) continue;
			if (this.crowdedAt(ax0, az0, ANCHOR_CLEAR_K * scale)) continue;
			if (this.inProp(city, ax0, az0, body) || this.inBuilding(city, ax0, az0, .6 * scale)) continue;
			// group formation frame: f = forward (walking direction, or toward the titan), r = right
			const u = Math.random();
			const nWant = Math.min(maxN, u < .26 ? 1 : u < .56 ? 2 : u < .78 ? 3 : u < .92 ? 4 : 5);
			const gawk = Math.random() < .34;
			let fx, fz;
			if (gawk) {
				fx = tx - ax0;
				fz = tz - az0;
				const l = Math.hypot(fx, fz) || 1;
				fx /= l;
				fz /= l;
			} else if (park) {
				const h = Math.random() * Math.PI * 2;
				fx = Math.sin(h);
				fz = Math.cos(h);
			} else {
				const dir = Math.random() < .5 ? -1 : 1;
				fx = alongX ? dir : 0;
				fz = alongX ? 0 : dir;
			}
			const rx = fz, rz = -fx;
			const spd0 = .7 + Math.random() * .8;
			const t0 = 2 + Math.random() * 5;
			let leader = -1, placed = 0;
			for (let m = 0; m < nWant; m++) {
				let ox, oz;
				if (gawk) {
					// loose arc facing the titan: side by side, ends a step closer, alternate rows staggered
					const a = (m - (nWant - 1) / 2) * gsp * 1.05;
					const fwd = .3 * a * a / gsp - m % 2 * .35 * gsp + (Math.random() - .5) * .15 * gsp;
					ox = rx * a + fx * fwd;
					oz = rz * a + fz * fwd;
				} else {
					// pairs side by side, pairs one behind the other
					const row = Math.floor(m / 2), pair = nWant - row * 2 >= 2;
					const side = pair ? (m % 2 - .5) * gsp : 0;
					const back = -row * gsp * 1.15 + (Math.random() - .5) * .12 * gsp;
					ox = rx * side + fx * back;
					oz = rz * side + fz * back;
				}
				let x = ax0 + ox, z = az0 + oz;
				// keep sidewalk members on the band (depth clamped, stays on this block side)
				if (!park) {
					let mlx = x - cx, mlz = z - cz;
					if (alongX) {
						mlz = dsgn * Math.min(SW_OUT - .15, Math.max(inner + .15, dsgn * mlz));
						if (Math.abs(mlx) > SW_OUT) continue;
					} else {
						mlx = dsgn * Math.min(SW_OUT - .15, Math.max(inner + .15, dsgn * mlx));
						if (Math.abs(mlz) > SW_OUT) continue;
					}
					x = cx + mlx;
					z = cz + mlz;
				} else if (Math.abs(x - cx) > lim || Math.abs(z - cz) > lim) continue;
				if (this.waterZ !== null && z < this.waterZ + 2) continue;
				if (Math.hypot(x - tx, z - tz) < minD) continue;
				if (m > 0 && !this.camOk(x, z, scale, still)) continue;
				if (this.crowdedAt(x, z, SPAWN_SEP_K * scale)) continue;
				if (this.inProp(city, x, z, body) || this.inBuilding(city, x, z, .6 * scale)) continue;
				const i = this.freeSlot();
				if (i < 0) break;
				if (leader < 0) leader = i;
				this.initCivilian(i, w.biomeId, x, z, tx, tz, leader, park, gawk, fx, fz, spd0, t0 + (i === leader ? 0 : .2 + Math.random() * .6));
				this.hashInsert(i);
				placed++;
			}
			if (placed > 0) return placed;
		}
		return 0;
	}
	initCivilian(i, biome, x, z, tx, tz, leader, park, gawk, fx, fz, spd, t) {
		// a recycled slot must not keep followers from its previous life
		for (let j = 0; j < CAP; j++) if (this.lead[j] === i && j !== i) this.lead[j] = j;
		this.x[i] = x;
		this.z[i] = z;
		this.dressUp(i, biome);
		this.lead[i] = leader;
		this.inPark[i] = park ? 1 : 0;
		this.ph[i] = Math.random() * 6.28;
		this.hy[i] = 0;
		this.hp[i] = 0;
		this.hvar[i] = Math.random();
		if (gawk) {
			this.setIdle(i);
			this.t[i] = t;
			this.hd[i] = Math.atan2(tx - x, tz - z) + (Math.random() - .5) * .35;
			this.amp[i] = 0;
		} else {
			this.st[i] = ST_MILL;
			this.pose[i] = P_WALK;
			// the leader sets the group's pace; followers keep it (so the group stays together)
			const s = i === leader ? spd * this.archs[this.arch[i]].pace : this.spd[leader];
			this.vx[i] = fx * s;
			this.vz[i] = fz * s;
			this.spd[i] = s;
			this.t[i] = t;
			this.hd[i] = Math.atan2(fx, fz);
			this.amp[i] = 1;
		}
	}
	/** choose an archetype + outfit for civilian i */
	dressUp(i, biome) {
		let r = Math.random() * this.archWSum;
		let a = 0;
		for (; a < this.archW.length - 1; a++) {
			r -= this.archW[a];
			if (r < 0) break;
		}
		this.arch[i] = a;
		const ar = this.archs[a];
		const lk = ar.look(biome);
		const o = i * 20, C = this.col;
		const put = (off, hex, wv) => {
			this.c3.set(hex);
			C[o + off] = this.c3.r;
			C[o + off + 1] = this.c3.g;
			C[o + off + 2] = this.c3.b;
			C[o + off + 3] = wv;
		};
		put(0, lk.skin, lk.shoe);
		put(4, lk.top, lk.mask);
		put(8, lk.bottom, 0);
		put(12, lk.hair, ar.mid ?? 0);
		put(16, lk.acc, 0);
	}
	/** group member whose timer ran out: do what the leader is doing (if it is near and calm) */
	followLeader(i) {
		const L = this.lead[i];
		if (L === i) return false;
		const ls = this.st[L];
		const near = Math.hypot(this.x[L] - this.x[i], this.z[L] - this.z[i]) < 5 * this.scaleNow;
		if (ls !== ST_MILL && ls !== ST_IDLE || !near) {
			this.lead[i] = i;
			return false;
		}
		if (ls === ST_IDLE) this.setIdle(i);
		else {
			this.st[i] = ST_MILL;
			this.pose[i] = P_WALK;
			this.vx[i] = this.vx[L];
			this.vz[i] = this.vz[L];
			this.spd[i] = this.spd[L];
			this.inPark[i] = this.inPark[L];
		}
		this.t[i] = Math.max(.3, this.t[L]) + .2 + Math.random() * .6;
		return true;
	}
	/** stand still and gawk: plain stare, film it, point at it, or wave */
	setIdle(i) {
		this.st[i] = ST_IDLE;
		this.vx[i] = 0;
		this.vz[i] = 0;
		this.t[i] = 1.5 + Math.random() * 3.5;
		const mask = this.col[i * 20 + 7];
		// the right hand is busy holding an umbrella or a cane
		const busyRight = (mask & bit(O_UMB)) !== 0 || this.archs[this.arch[i]].id === "elder" && (mask & bit(O_EXTRA)) !== 0;
		const r = Math.random();
		this.pose[i] = busyRight ? P_WALK : r < .32 ? P_PHONE : r < .55 ? P_POINT : r < .68 ? P_WAVE : P_WALK;
	}
	/** walk along the sidewalk side the civilian is on — or stroll anywhere in a park / plaza */
	setMill(i, x, z, city, ar) {
		const P = city.pitch;
		const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
		const lx = x - (city.originX + (bx + .5) * P), lz = z - (city.originZ + (bz + .5) * P);
		const sp = (.7 + Math.random() * .8) * ar.pace;
		const park = bx >= 0 && bz >= 0 && bx < city.blocksX && bz < city.blocksZ && this.parkCell[bx + bz * city.blocksX] === 1 && Math.abs(lx) < PARCEL_HALF - .3 && Math.abs(lz) < PARCEL_HALF - .3;
		this.inPark[i] = park ? 1 : 0;
		if (park) {
			const h = Math.random() * Math.PI * 2;
			this.vx[i] = Math.sin(h) * sp;
			this.vz[i] = Math.cos(h) * sp;
		} else {
			const dir = Math.random() < .5 ? -1 : 1;
			if (Math.abs(lx) >= Math.abs(lz)) {
				this.vx[i] = 0;
				this.vz[i] = dir * sp;
			} else {
				this.vx[i] = dir * sp;
				this.vz[i] = 0;
			}
		}
		this.spd[i] = sp;
		this.t[i] = 2 + Math.random() * 5;
	}
	/** reached the end of a sidewalk side: continue along the adjacent side of the SAME block
	*  (deterministic, so a walking group turns together) */
	turnCorner(i, wasXSide, depthSign) {
		const sp = this.spd[i] || 1;
		const dir = -depthSign;
		if (wasXSide) {
			this.vx[i] = dir * sp;
			this.vz[i] = 0;
		} else {
			this.vz[i] = dir * sp;
			this.vx[i] = 0;
		}
	}
	/** innermost |local coordinate| a sidewalk walker may use here: the paved forecourt reaches in up
	*  to PLAZA_DEPTH m, but stops ~0.9 m short of any facade covering this spot (or just ahead) */
	innerLimit(city, bx, bz, cx, cz, alongIsX, sideSign, alongW, vAlong, scale) {
		if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return SW_IN;
		let lim = PARCEL_HALF - PLAZA_DEPTH;
		const ids = city.blockBuildings[bx + bz * city.blocksX];
		const ahead = alongW + Math.sign(vAlong) * 1.2 * scale;
		const m = .35 * scale, gap = .9 * scale;
		for (let k = 0; k < ids.length; k++) {
			const b = city.buildings[ids[k]];
			if (!b) continue;
			let lo, hi, face;
			if (alongIsX) {
				lo = b.x - b.w / 2 - m;
				hi = b.x + b.w / 2 + m;
				face = sideSign * (b.z - cz) + b.d / 2;
			} else {
				lo = b.z - b.d / 2 - m;
				hi = b.z + b.d / 2 + m;
				face = sideSign * (b.x - cx) + b.w / 2;
			}
			if (!(alongW > lo && alongW < hi || ahead > lo && ahead < hi)) continue;
			if (face + gap > lim) lim = face + gap;
		}
		return Math.min(lim, SW_IN);
	}
	/** push civilian i (position in p3) out of any building footprint in its block (+ body radius) */
	avoidBuildings(i, city, bx, bz, body) {
		if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return;
		const ids = city.blockBuildings[bx + bz * city.blocksX];
		for (let k = 0; k < ids.length; k++) {
			const b = city.buildings[ids[k]];
			if (!b) continue;
			const hw = b.w / 2 + body, hd = b.d / 2 + body;
			const dx = this.p3.x - b.x, dz = this.p3.z - b.z;
			if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
			if (hw - Math.abs(dx) < hd - Math.abs(dz)) {
				this.p3.x = b.x + Math.sign(dx || 1) * hw;
				if (this.vx[i] * dx < 0) this.vx[i] *= -.3;
			} else {
				this.p3.z = b.z + Math.sign(dz || 1) * hd;
				if (this.vz[i] * dz < 0) this.vz[i] *= -.3;
			}
		}
	}
	/** would a civilian standing at (x, z) be inside a building footprint (+ margin)? */
	inBuilding(city, x, z, margin) {
		const P = city.pitch;
		const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
		if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return false;
		const ids = city.blockBuildings[bx + bz * city.blocksX];
		for (let k = 0; k < ids.length; k++) {
			const b = city.buildings[ids[k]];
			if (b && Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin) return true;
		}
		return false;
	}
	squashCircle(x, z, r, scale) {
		const r2 = r * r;
		for (let i = 0; i < CAP; i++) {
			const s = this.st[i];
			if (s === ST_EMPTY || s === ST_GONE) continue;
			const dx = this.x[i] - x, dz = this.z[i] - z;
			if (dx * dx + dz * dz <= r2) this.puff(i, scale);
		}
	}
	squashRect(x, z, hw, hd, scale) {
		for (let i = 0; i < CAP; i++) {
			const s = this.st[i];
			if (s === ST_EMPTY || s === ST_GONE) continue;
			if (Math.abs(this.x[i] - x) <= hw && Math.abs(this.z[i] - z) <= hd) this.puff(i, scale);
		}
	}
	puff(i, scale) {
		this.st[i] = ST_GONE;
		this.t[i] = 1.5 + Math.random() * 2;
		const p = this.puffList[this.puffCursor];
		this.puffCursor = (this.puffCursor + 1) % PUFF_CAP;
		p.x = this.x[i];
		p.z = this.z[i];
		p.y = SIDEWALK_Y;
		p.t = 0;
		p.s = .9 * scale;
	}
}
function wrapPi(a) {
	a = (a + Math.PI) % (Math.PI * 2);
	if (a < 0) a += Math.PI * 2;
	return a - Math.PI;
}
function turnToward(cur, target, k) {
	return cur + wrapPi(target - cur) * Math.min(1, k);
}

//# sourceMappingURL=data:application/json;base64,eyJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBK0JBLFlBQVksV0FBVztBQUV2QixTQUFTLE1BQU0sbUJBQW1CO0FBQ2xDLFNBQVMsV0FBVyxxQkFBcUI7QUFDekMsU0FBUyxLQUFLLFlBQVksb0JBQW9CLE9BQU8scUJBQXFCLGdCQUFnQjtBQUcxRixNQUFNLE1BQU07O0FBRVosTUFBTSxRQUFRO0NBQUM7Q0FBSTtDQUFLO0NBQUs7Q0FBSztBQUFHO0FBQ3JDLE1BQU0sUUFBUTtDQUFDO0NBQUs7Q0FBSztBQUFDOztBQUUxQixNQUFNLFlBQVk7Q0FBQztDQUFHO0NBQUs7Q0FBSztDQUFLO0FBQUc7O0FBRXhDLE1BQU0sUUFBUSxjQUFjO0FBQzVCLE1BQU0sU0FBUyxjQUFjOztBQUU3QixNQUFNLGFBQWE7QUFDbkIsTUFBTSxXQUFXO0FBQ2pCLE1BQU0sYUFBYTtBQUNuQixNQUFNLFlBQVk7QUFDbEIsTUFBTSxZQUFZO0FBRWxCLE1BQU0sV0FBVyxHQUFHLFVBQVUsR0FBRyxVQUFVLEdBQUcsVUFBVSxHQUFHLFVBQVU7O0FBRXJFLE1BQU0sU0FBUyxHQUFHLFVBQVUsR0FBRyxVQUFVLEdBQUcsVUFBVSxHQUFHLFNBQVM7O0FBR2xFLE1BQU0sV0FBVyxHQUFHLFdBQVcsR0FBRyxVQUFVLEdBQUcsVUFBVSxHQUFHLFFBQVEsR0FBRyxVQUFVLEdBQUcsUUFBUSxHQUFHLFlBQVksR0FBRyxVQUFVOzs7QUFHeEgsTUFBTSxTQUFTLElBQUksVUFBVSxJQUFJLFNBQVMsSUFBSSxVQUFVLElBQUksWUFBWSxJQUFJLFlBQVk7QUFDeEYsTUFBTSxPQUFPLE1BQXNCLEtBQU0sSUFBSTs7QUFHN0MsTUFBTSxTQUFTLEdBQUcsUUFBUSxHQUFHLFdBQVcsR0FBRyxTQUFTLEdBQUcsUUFBUSxHQUFHLFNBQVMsR0FBRyxRQUFRLEdBQUcsVUFBVSxHQUFHLFNBQVMsR0FBRyxZQUFZOztBQUU5SCxNQUFNLFFBQVE7Q0FBQztDQUFXO0NBQVc7Q0FBVztDQUFXO0NBQVc7QUFBUzs7OztBQUsvRSxNQUFNLFVBQVUsR0FBRyxVQUFVLEdBQUcsVUFBVSxHQUFHLFVBQVUsR0FBRyxVQUFVLEdBQUcsVUFBVSxHQUFHLFdBQVcsR0FBRyxXQUFXLEdBQUcsV0FBVyxHQUFHLFdBQVc7O0FBR3pJLE1BQU0sU0FBUyxDQUFDLEtBQU0sU0FBUyxDQUFDO0FBQ2hDLE1BQU0sU0FBUyxDQUFDLElBQUssU0FBUztBQUs5QixTQUFTLEtBQUssR0FBVyxJQUFZLElBQVksR0FBVyxNQUFNLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFrQztDQUNySCxNQUFNLE1BQVksQ0FBQztDQUNuQixLQUFLLElBQUksSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0VBQzFCLE1BQU0sSUFBSSxNQUFPLElBQUksSUFBSyxLQUFLLEtBQUs7RUFDcEMsSUFBSSxLQUFLO0dBQUMsS0FBSyxLQUFLLElBQUksQ0FBQyxJQUFJO0dBQUksS0FBSyxHQUFHLENBQUMsSUFBSTtHQUFHLEtBQUssS0FBSyxJQUFJLENBQUMsSUFBSTtFQUFFLENBQUM7Q0FDekU7Q0FDQSxPQUFPO0FBQ1Q7QUFFQSxTQUFTLFNBQVMsR0FBYTtDQUM3QixJQUFJLElBQUksR0FBRyxJQUFJLEdBQUcsSUFBSTtDQUN0QixLQUFLLE1BQU0sS0FBSyxHQUFHO0VBQUUsS0FBSyxFQUFFO0VBQUksS0FBSyxFQUFFO0VBQUksS0FBSyxFQUFFO0NBQUk7Q0FDdEQsT0FBTztFQUFDLElBQUksRUFBRTtFQUFRLElBQUksRUFBRTtFQUFRLElBQUksRUFBRTtDQUFNO0FBQ2xEOzs7QUFNQSxTQUFTLEtBQUssT0FBZSxNQUFXLE9BQU8sTUFBVyxPQUFPLGFBQTRCO0NBQzNGLE1BQU0sSUFBYyxDQUFDO0NBQ3JCLE1BQU0sT0FBTyxHQUFPLEdBQU8sTUFBZ0I7RUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEVBQUU7Q0FBRztDQUMzRyxLQUFLLElBQUksSUFBSSxHQUFHLElBQUksSUFBSSxNQUFNLFFBQVEsS0FBSztFQUN6QyxNQUFNLElBQUksTUFBTSxJQUFJLElBQUksTUFBTSxJQUFJLElBQUksSUFBSSxFQUFFO0VBQzVDLEtBQUssSUFBSSxJQUFJLEdBQUcsSUFBSSxHQUFHLEtBQUs7R0FDMUIsTUFBTSxLQUFLLElBQUksS0FBSztHQUNwQixJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxFQUFFO0dBQUcsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsRUFBRTtFQUM3QztDQUNGO0NBQ0EsTUFBTSxLQUFLLE1BQU0sSUFBSSxLQUFLLE1BQU0sTUFBTSxTQUFTO0NBQy9DLElBQUksUUFBUSxRQUFRO0VBQUUsTUFBTSxJQUFJLFFBQVEsUUFBUSxTQUFTLEVBQUUsSUFBSTtFQUFLLEtBQUssSUFBSSxJQUFJLEdBQUcsSUFBSSxHQUFHLFFBQVEsS0FBSyxJQUFJLEdBQUcsSUFBSSxJQUFJLEtBQUssR0FBRyxTQUFTLEdBQUcsRUFBRTtDQUFHO0NBQ2hKLElBQUksUUFBUSxRQUFRO0VBQUUsTUFBTSxJQUFJLFFBQVEsUUFBUSxTQUFTLEVBQUUsSUFBSTtFQUFLLEtBQUssSUFBSSxJQUFJLEdBQUcsSUFBSSxHQUFHLFFBQVEsS0FBSyxJQUFJLEdBQUcsR0FBRyxJQUFJLElBQUksSUFBSSxLQUFLLEdBQUcsT0FBTztDQUFHO0NBQ2hKLE9BQU8sY0FBYyxXQUFXLEdBQUcsV0FBVyxJQUFJLE9BQU8sQ0FBQztBQUM1RDs7QUFHQSxTQUFTLE9BQU8sR0FBdUI7Q0FDckMsSUFBSSxLQUFLLEdBQUcsS0FBSyxHQUFHLEtBQUs7Q0FDekIsTUFBTSxJQUFJLEVBQUUsU0FBUztDQUNyQixLQUFLLElBQUksSUFBSSxHQUFHLElBQUksRUFBRSxRQUFRLEtBQUssR0FBRztFQUFFLE1BQU0sRUFBRTtFQUFJLE1BQU0sRUFBRSxJQUFJO0VBQUksTUFBTSxFQUFFLElBQUk7Q0FBSTtDQUNwRixNQUFNO0NBQUcsTUFBTTtDQUFHLE1BQU07Q0FDeEIsSUFBSSxNQUFNO0NBQ1YsS0FBSyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUUsUUFBUSxLQUFLLEdBQUc7RUFDcEMsTUFBTSxLQUFLLEVBQUUsS0FBSyxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLO0VBQzFELE1BQU0sS0FBSyxFQUFFLElBQUksS0FBSyxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLO0VBQzlELE1BQU0sS0FBSyxFQUFFLElBQUksS0FBSyxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLO0VBQzlELE9BQU8sTUFBTSxLQUFLLEtBQUssS0FBSyxNQUFNLE1BQU0sS0FBSyxLQUFLLEtBQUssTUFBTSxNQUFNLEtBQUssS0FBSyxLQUFLO0NBQ3BGO0NBQ0EsSUFBSSxNQUFNLEdBQUcsUUFBUSxDQUFDO0NBQ3RCLE9BQU87QUFDVDs7QUFHQSxTQUFTLFdBQVcsR0FBYSxHQUFpQjtDQUNoRCxLQUFLLElBQUksSUFBSSxHQUFHLElBQUksRUFBRSxRQUFRLEtBQUssR0FBRztFQUNwQyxNQUFNLEtBQUssRUFBRSxJQUFJLEtBQUssRUFBRSxJQUFJLElBQUksS0FBSyxFQUFFLElBQUk7RUFDM0MsTUFBTSxNQUFNLEVBQUUsSUFBSSxLQUFLLElBQUksTUFBTSxFQUFFLElBQUksS0FBSyxJQUFJLE1BQU0sRUFBRSxJQUFJLEtBQUs7RUFDakUsTUFBTSxNQUFNLEVBQUUsSUFBSSxLQUFLLElBQUksTUFBTSxFQUFFLElBQUksS0FBSyxJQUFJLE1BQU0sRUFBRSxJQUFJLEtBQUs7RUFDakUsTUFBTSxLQUFLLE1BQU0sTUFBTSxNQUFNLEtBQUssS0FBSyxNQUFNLE1BQU0sTUFBTSxLQUFLLEtBQUssTUFBTSxNQUFNLE1BQU07RUFDckYsTUFBTSxNQUFNLEtBQUssRUFBRSxJQUFJLEtBQUssRUFBRSxJQUFJLE1BQU0sSUFBSSxFQUFFLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxLQUFLLEVBQUUs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R0FBRyxLQUFLLEdBQUcsTUFBTSxJQUFJO0VBQy9JLE9BQU87R0FDTCxNQUFNLEtBQUssQ0FBQyxNQUFPO0dBQ25CLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFLLEtBQUssS0FBSyxLQUFLLE9BQVEsR0FBRyxHQUFHLEdBQUcsS0FBSyxHQUFHLEtBQUssTUFBTSxLQUFLLE1BQU0sSUFBSSxHQUFHLENBQUMsR0FBRyxJQUFJLEtBQUssR0FBRyxJQUFJLElBQUk7R0FDcEgsSUFBSSxLQUFLLENBQUMsS0FBSyxHQUFHLEtBQUssS0FBTSxLQUFLLEtBQU0sS0FBSyxNQUFPLEdBQUcsR0FBRyxHQUFHLEtBQUssR0FBRyxLQUFLLE1BQU0sS0FBSyxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxRQUFRLEtBQUssR0FBRyxJQUFJLE1BQU07R0FDaEksSUFBSSxLQUFLLENBQUMsS0FBSyxHQUFHLElBQUksSUFBSSxDQUFDLElBQUksT0FBUSxHQUFHLEdBQUcsR0FBRyxLQUFLLEdBQUcsSUFBSSxJQUFJLENBQUMsSUFBSSxPQUFRLEdBQUcsR0FBRyxDQUFDLEdBQUc7SUFBQztJQUFHLENBQUMsSUFBSSxPQUFRO0lBQUc7R0FBQyxHQUFHLE1BQU0sR0FBRyxNQUFNLE1BQU07RUFDdEk7O0VBRUEsTUFBTSxLQUFLLE9BQVEsSUFBSSxJQUFJLEtBQUssT0FBUSxJQUFJO0VBQzVDLElBQUksS0FBSztHQUNQLEtBQUssR0FBRyxLQUFLLEtBQU0sS0FBSyxLQUFNLENBQUMsSUFBSSxNQUFPLEdBQUcsR0FBRztHQUNoRCxLQUFLLEdBQUcsSUFBSSxJQUFJLENBQUMsSUFBSSxPQUFRLEdBQUcsS0FBSyxHQUFHLE9BQVEsQ0FBQztHQUNqRCxLQUFLLEdBQUcsS0FBSyxLQUFNLEtBQUssSUFBSyxDQUFDLElBQUksT0FBUSxHQUFHLEtBQUssR0FBRyxPQUFRLENBQUM7RUFDaEUsR0FBRyxRQUFRO0dBQUM7R0FBRyxDQUFDLElBQUksT0FBUTtHQUFHLE9BQVE7RUFBQyxDQUFDLEdBQUcsTUFBTSxJQUFJO0VBQ3RELElBQUksSUFBSSxHQUFHLENBQUMsSUFBSSxPQUFRLEdBQUcsS0FBSyxLQUFNLE9BQVEsSUFBSSxJQUFJLE1BQU8sSUFBSSxJQUFJLENBQUMsR0FBRyxNQUFNLElBQUk7RUFDbkYsSUFBSSxPQUFPLEdBQUc7OztHQUdaLElBQUksSUFBSSxHQUFHLENBQUMsSUFBSSxNQUFPLEdBQUcsS0FBSyxLQUFNLE9BQVEsR0FBRyxNQUFPLEdBQUcsTUFBTyxDQUFDLEdBQUcsTUFBTSxPQUFPLE9BQU87RUFDM0Y7Q0FDRjtBQUNGOztBQUdBLFNBQVMsT0FBTyxHQUFTLE1BQWMsUUFBUSxPQUFXO0NBQ3hELE1BQU0sSUFBSSxFQUFFLFNBQVMsT0FBUSxFQUFFO0NBQy9CLE9BQU87RUFBQyxPQUFPLEVBQUUsTUFBTSxPQUFPLEtBQUssSUFBSSxLQUFLLElBQUk7RUFBRyxFQUFFLE1BQU0sS0FBSyxJQUFJLEtBQUssSUFBSTtFQUFHO0NBQUM7QUFDbkY7O0FBR0EsU0FBUyxRQUFRLEdBQVMsTUFBYyxRQUFRLE9BQVc7Q0FBRSxPQUFPLFNBQVMsR0FBRyxNQUFNLEtBQUssQ0FBQyxDQUFDO0FBQUc7OztBQUloRyxTQUFTLEtBQUssR0FBUSxHQUFlO0NBQ25DLE1BQU0sSUFBSSxFQUFFLEdBQUcsS0FBSyxFQUFFLElBQUksS0FBSyxFQUFFO0NBQ2pDLE1BQU0sTUFBVTtFQUFDO0VBQUcsRUFBRTtFQUFPO0NBQUM7Q0FDOUIsRUFBRSxJQUFJLEtBQUssQ0FBQyxLQUFLLEdBQUcsTUFBTyxHQUFHLE1BQU8sR0FBRyxFQUFFLFFBQVEsTUFBTyxDQUFDLEdBQUcsS0FBSyxHQUFHLE9BQVEsR0FBRyxPQUFRLEdBQUcsS0FBSyxNQUFPLEVBQUUsQ0FBQyxHQUFHLFFBQVEsTUFBTSxHQUFHLFNBQVMsUUFBUSxHQUFHLEdBQUc7Q0FDckosTUFBTSxPQUFtQztFQUFDO0dBQUM7R0FBTztHQUFPO0VBQUs7RUFBRztHQUFDO0dBQU07R0FBTztFQUFLO0VBQUc7R0FBQztHQUFPO0dBQU87RUFBSztDQUFDO0NBQzVHLEVBQUUsSUFBSSxLQUFLLEtBQUssS0FBSyxDQUFDLEdBQUcsSUFBSSxRQUFRLEtBQUssR0FBRyxLQUFLLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxJQUFJLEdBQUcsQ0FBQyxHQUFHO0VBQUM7RUFBRyxLQUFLLE9BQVE7RUFBSSxPQUFRO0NBQUUsR0FBRztFQUFDO0VBQUcsS0FBSyxPQUFRO0VBQUksQ0FBQyxPQUFRO0NBQUUsQ0FBQyxHQUFHLFNBQVMsUUFBUSxHQUFHLEdBQUc7Q0FDaEwsTUFBTSxLQUFLLE9BQVE7O0NBRW5CLE1BQU0sS0FBSyxLQUFlLEdBQVcsTUFBYyxNQUFNLE1BQVksRUFBRSxJQUFJLEtBQUssSUFBSSxLQUFLLEdBQUcsTUFBTyxJQUFJLElBQUksS0FBSyxJQUFJLEtBQUssSUFBSSxFQUFHLEdBQUcsQ0FBQyxHQUFHLFNBQVMsTUFBTSxLQUFLLEdBQUc7Q0FDOUosTUFBTSxLQUFLO0NBQ1gsS0FBSyxNQUFNLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHO0VBQ3ZCLE1BQU0sS0FBSyxJQUFJLE1BQU8sSUFBSSxNQUFPLElBQUk7RUFDckMsRUFBRTtHQUFDLEtBQUs7R0FBRztHQUFJLEtBQUssSUFBSTtHQUFNLEtBQUs7R0FBRyxLQUFLLElBQUk7R0FBTSxLQUFLO0dBQUcsS0FBSztHQUFHO0dBQUksS0FBSyxJQUFJO0dBQU0sS0FBSztHQUFHLEtBQUssSUFBSTtHQUFNLEtBQUs7RUFBQyxHQUFHLElBQUksT0FBTztFQUNuSSxNQUFNLEtBQUssS0FBSyxJQUFJLE1BQU8sS0FBSyxLQUFLLE1BQU8sS0FBSyxPQUFRLEtBQUs7RUFDOUQsRUFBRTtHQUFDLEtBQUs7R0FBSSxLQUFLO0dBQUksS0FBSztHQUFJLEtBQUs7R0FBSSxLQUFLO0dBQUksS0FBSztHQUFJLEtBQUs7R0FBSSxLQUFLO0VBQUUsR0FBRyxLQUFLLFFBQVMsSUFBSSxLQUFLOztFQUVuRyxNQUFNLEtBQUs7RUFDWCxFQUFFO0dBQUMsSUFBSTtHQUFPO0dBQU0sSUFBSTtHQUFPO0dBQU8sSUFBSTtHQUFPLE9BQVE7R0FBSSxJQUFJO0dBQU8sTUFBTztFQUFFLEdBQUcsSUFBSSxPQUFPLE1BQU07RUFDckcsRUFBRTtHQUFDLElBQUk7R0FBTTtHQUFPLElBQUk7R0FBTztHQUFPLElBQUk7R0FBTyxPQUFRO0dBQUksSUFBSTtHQUFNLE9BQVE7RUFBRSxHQUFHLElBQUksT0FBTyxPQUFPO0NBQ3hHOztDQUVBLE1BQU0sS0FBSyxRQUFTO0NBQ3BCLEVBQUU7RUFBQyxDQUFDO0VBQU87RUFBTztFQUFPO0VBQU87RUFBTztFQUFPLENBQUM7RUFBTztDQUFLLEdBQUcsSUFBSSxPQUFPLE1BQU07Q0FDL0UsRUFBRTtFQUFDLENBQUM7RUFBTTtFQUFPLENBQUM7RUFBTztFQUFPO0VBQU87RUFBTztFQUFNO0VBQU87RUFBTztFQUFPLENBQUM7RUFBTztDQUFLLEdBQUcsSUFBSSxPQUFPLE9BQU87O0NBRTNHLEVBQUUsSUFBSSxLQUFLLENBQUMsS0FBSyxHQUFHLE9BQVEsSUFBSSxPQUFRLElBQUksS0FBSyxLQUFNLElBQUksS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFRLEVBQUUsQ0FBQyxHQUFHO0VBQUM7RUFBRyxLQUFLLE9BQVE7RUFBSSxLQUFLLE1BQU87Q0FBRSxHQUFHO0VBQUM7RUFBRyxLQUFLLE9BQVE7RUFBSSxLQUFLLE9BQVE7Q0FBRSxDQUFDLEdBQUcsU0FBUyxRQUFRLEdBQUcsR0FBRztBQUNqTTtBQUVBLFNBQVMsUUFBUSxHQUFhO0NBQUUsT0FBTztFQUFDO0VBQUcsRUFBRTtFQUFPO0NBQUM7QUFBRztBQUd4RCxTQUFTLEtBQUssR0FBUSxHQUFTLE1BQWdCLEtBQW1CO0NBQ2hFLE1BQU0sS0FBSyxFQUFFLElBQUksS0FBSyxFQUFFLE9BQU8sTUFBTSxRQUFRLENBQUM7Q0FDOUMsTUFBTSxRQUFRLFNBQVMsU0FBUyxPQUFRLE1BQU8sT0FBTyxTQUFTLFNBQVMsTUFBTztDQUMvRSxNQUFNLE1BQU0sTUFBc0IsS0FBSyxNQUFNLFFBQVEsUUFBUSxTQUFTLEtBQU0sS0FBTSxLQUFLLElBQUksQ0FBQztDQUM1RixNQUFNLEtBQUssS0FBSyxHQUFHLEdBQUcsR0FBRyxHQUFHLEtBQUssR0FBRyxHQUFHLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUcsT0FBVztFQUFFLE1BQU0sSUFBSSxPQUFPLElBQUksTUFBTSxFQUFFLElBQUksS0FBSyxNQUFNLE9BQVE7RUFBSSxPQUFPO0dBQUMsSUFBSTtHQUFHO0dBQUcsSUFBSSxJQUFJLE9BQVE7RUFBRTtDQUFHLENBQUM7Q0FDcEssTUFBTSxLQUFLLEtBQUssR0FBRyxNQUFNLEdBQUksSUFBSSxLQUFLLE1BQU0sTUFBTSxHQUFJLElBQUksS0FBSyxLQUFLLEtBQUssTUFBTyxJQUFJLEtBQUssR0FBRyxDQUFDLE9BQVEsRUFBRTtDQUN2RyxFQUFFLElBQUksS0FBSyxDQUFDLElBQUksRUFBRSxHQUFHLFFBQVE7RUFBQztFQUFHLE1BQU0sU0FBUyxTQUFTLE9BQVEsT0FBUTtFQUFJLENBQUMsTUFBTztDQUFFLEdBQUc7RUFBQztFQUFHLEtBQUssTUFBTztFQUFJO0NBQUMsQ0FBQyxHQUFHLFNBQVMsUUFBUSxLQUFLLEdBQUc7Q0FDNUksSUFBSSxTQUFTLFFBQVEsRUFBRSxJQUFJLElBQUksR0FBRyxLQUFLLE1BQU8sSUFBSSxDQUFDLE9BQVEsSUFBSSxPQUFRLElBQUksTUFBTyxJQUFJLE1BQU8sSUFBSSxHQUFJLEdBQUcsU0FBUyxRQUFRLEtBQUssR0FBRztDQUNqSSxJQUFJLFNBQVMsT0FBTyxFQUFFLElBQUksSUFBSSxHQUFHLEtBQUssS0FBTSxJQUFJLENBQUMsT0FBUSxJQUFJLE9BQVEsSUFBSSxPQUFRLElBQUksQ0FBQyxHQUFHLFNBQVMsUUFBUSxLQUFLLEdBQUc7QUFDcEg7QUFHQSxTQUFTLElBQUksR0FBUSxHQUFTLE1BQWUsS0FBYSxPQUFPLFFBQWM7Q0FDN0UsTUFBTSxLQUFLLEVBQUUsSUFBSSxLQUFLLEVBQUUsT0FBTyxNQUFNLFFBQVEsQ0FBQztDQUM5QyxNQUFNLEtBQUssR0FBVyxJQUFJLFNBQWlCLE1BQU0sQ0FBQyxJQUFJLEtBQUssSUFBSSxPQUFRO0NBQ3ZFLE1BQU0sSUFBUTtFQUFDO0VBQUcsS0FBSyxNQUFPO0VBQUk7Q0FBQztDQUNuQyxRQUFRLE1BQVI7RUFDRSxLQUFLLE9BQU87R0FDVixFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxFQUFFLEVBQUcsR0FBRyxFQUFFLEVBQUcsR0FBRyxLQUFLLEtBQU0sSUFBSSxLQUFLLEdBQUcsQ0FBQyxPQUFRLEVBQUUsR0FBRyxLQUFLLEdBQUcsRUFBRSxLQUFNLElBQUksR0FBRyxFQUFFLEtBQU0sSUFBSSxHQUFHLEtBQUssTUFBTyxJQUFJLEtBQUssR0FBRyxDQUFDLE1BQU8sRUFBRSxDQUFDLEdBQUcsUUFBUTtJQUFDO0lBQUcsS0FBSyxNQUFPO0lBQUksQ0FBQyxNQUFPO0dBQUUsR0FBRyxDQUFDLEdBQUcsU0FBUyxNQUFNLEtBQUssR0FBRztHQUN6TixFQUFFLElBQUksR0FBRyxJQUFJLEdBQUcsR0FBRyxHQUFHLE1BQU8sSUFBSSxPQUFRLElBQUksS0FBTSxFQUFFLEdBQUcsSUFBSSxNQUFNLFFBQVEsQ0FBQyxDQUFDLGdCQUFnQixHQUFHLEtBQUssT0FBUSxJQUFJLE1BQU8sRUFBRSxDQUFDLENBQUMsU0FBUyxLQUFLLEdBQUksQ0FBQyxDQUFDLEdBQUcsU0FBUyxNQUFNLEtBQUssR0FBRztHQUN6SztFQUNGO0VBQ0EsS0FBSyxXQUFXO0dBQ2QsRUFBRSxJQUFJLEtBQUssQ0FBQyxLQUFLLEdBQUcsRUFBRSxFQUFHLEdBQUcsRUFBRSxFQUFHLElBQUksTUFBTSxLQUFLLEtBQU0sSUFBSSxLQUFLLEdBQUcsT0FBUSxFQUFFLEdBQUcsS0FBSyxHQUFHLEVBQUUsRUFBRyxJQUFJLEtBQU0sRUFBRSxFQUFHLElBQUksTUFBTSxLQUFLLE9BQVEsSUFBSSxLQUFLLEdBQUcsTUFBTyxFQUFFLENBQUMsR0FBRyxRQUFRO0lBQUM7SUFBRyxLQUFLLEtBQU07SUFBSTtHQUFHLEdBQUcsQ0FBQyxHQUFHLFNBQVMsTUFBTSxLQUFLLEdBQUc7R0FDdk4sRUFBRSxJQUFJLEdBQUcsSUFBSSxHQUFHLEdBQUcsR0FBRyxNQUFPLElBQUksT0FBUSxJQUFJLE1BQU8sRUFBRSxHQUFHLElBQUksTUFBTSxRQUFRLENBQUMsQ0FBQyxnQkFBZ0IsR0FBRyxLQUFLLE9BQVEsSUFBSSxPQUFRLEVBQUUsQ0FBQyxDQUFDLFNBQVMsS0FBSyxFQUFHLENBQUMsQ0FBQyxHQUFHLFNBQVMsTUFBTSxLQUFLLEdBQUc7R0FDMUs7RUFDRjtFQUNBLEtBQUssV0FBVztHQUNkLE1BQU0sS0FBSyxPQUFRLElBQUksS0FBSyxFQUFFLElBQUssSUFBSTtHQUN2QyxFQUFFLElBQUksS0FBSztJQUNULEtBQUssR0FBRyxJQUFJLEtBQUssTUFBTSxLQUFLLE9BQVEsSUFBSSxLQUFLLEdBQUcsT0FBUSxFQUFFO0lBQUcsS0FBSyxHQUFHLElBQUksS0FBSyxNQUFNLEtBQUssT0FBUSxJQUFJLEtBQUssR0FBRyxPQUFRLEVBQUU7SUFDdkgsS0FBSyxHQUFHLElBQUksSUFBSSxLQUFLLE9BQVEsSUFBSSxHQUFHO0lBQUcsS0FBSyxHQUFHLEtBQUssS0FBTSxLQUFLLEtBQU0sS0FBSyxPQUFRLElBQUksR0FBRztHQUMzRixHQUFHLE9BQU87SUFBQztJQUFHLEtBQUssTUFBTztJQUFJO0dBQUMsQ0FBQyxHQUFHLFNBQVMsTUFBTSxLQUFLLEdBQUc7R0FDMUQ7RUFDRjtFQUNBLEtBQUssVUFBVTtHQUNiLEVBQUUsSUFBSSxLQUFLLENBQUMsS0FBSyxHQUFHLEVBQUUsS0FBTSxJQUFJLEdBQUcsRUFBRSxLQUFNLElBQUksR0FBRyxLQUFLLE1BQU8sSUFBSSxLQUFLLEdBQUcsQ0FBQyxPQUFRLEVBQUUsR0FBRyxLQUFLLEdBQUcsRUFBRSxLQUFNLEdBQUcsR0FBRyxFQUFFLEtBQU0sR0FBRyxHQUFHLEtBQUssT0FBUSxJQUFJLEtBQUssR0FBRyxDQUFDLE1BQU8sRUFBRSxDQUFDLEdBQUcsUUFBUTtJQUFDO0lBQUcsS0FBSyxNQUFPO0lBQUksQ0FBQyxNQUFPO0dBQUUsR0FBRyxDQUFDLEdBQUcsU0FBUyxNQUFNLEtBQUssR0FBRztHQUN2TyxFQUFFLElB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RUFDMUIsTUFBTSxJQUFJLE9BQU8sRUFBRTtFQUNuQixFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFNLEtBQU0sRUFBRSxPQUFPLEtBQU0sR0FBRyxDQUFDLEdBQUcsS0FBSyxHQUFHLE1BQU8sS0FBTSxHQUFHLEdBQUcsR0FBRyxHQUFJLENBQUMsR0FBRyxRQUFRLE1BQU0sR0FBRyxPQUFPLElBQUksVUFBVSxTQUFTLFVBQVUsR0FBRztHQUFDO0dBQUcsRUFBRTtHQUFNO0VBQUMsQ0FBQztFQUN0SyxNQUFNLElBQVE7R0FBQyxPQUFPLEVBQUU7R0FBSyxFQUFFO0dBQUs7RUFBQztFQUNyQyxFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFNLEtBQU0sRUFBRSxNQUFNLEtBQU0sR0FBRyxRQUFRLEVBQUUsTUFBTSxJQUFLLEdBQUcsS0FBSyxHQUFHLEtBQU0sS0FBTSxFQUFFLE1BQU0sSUFBSyxHQUFHLFFBQVEsRUFBRSxNQUFNLElBQUssQ0FBQyxHQUFHLFFBQVEsTUFBTSxHQUFHLE9BQU8sSUFBSSxVQUFVLFNBQVMsT0FBTyxHQUFHLENBQUM7Q0FDbE07Q0FDQSxFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFNLEtBQU0sSUFBSyxLQUFLLEtBQUssQ0FBQyxHQUFHLEtBQUssR0FBRyxJQUFLLE1BQU8sSUFBSyxLQUFLLEtBQUssQ0FBQyxDQUFDLEdBQUcsT0FBTyxNQUFNLEdBQUcsU0FBUyxRQUFRO0NBQzVILEVBQUUsSUFBSSxLQUFLLENBQUMsS0FBSyxHQUFHLElBQUssTUFBTyxLQUFNLEtBQUssS0FBSyxDQUFDLEdBQUcsS0FBSyxHQUFHLEtBQU0sS0FBTSxNQUFNLEtBQUssS0FBSyxDQUFDLENBQUMsR0FBRyxRQUFRLEtBQUssR0FBRyxTQUFTLEtBQUs7Q0FDM0gsTUFBTSxLQUFLLFFBQVEsQ0FBQyxHQUFHLElBQUksRUFBRTtDQUM3QixFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFNLE1BQU8sSUFBSSxLQUFNLEtBQUssS0FBSyxDQUFDLENBQUMsR0FBRztFQUFDO0VBQUcsSUFBSTtFQUFNO0NBQUMsR0FBRyxNQUFNLEdBQUcsU0FBUyxRQUFRLEdBQUcsRUFBRTtDQUMzRyxFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFNLE1BQU8sSUFBSSxLQUFNLEtBQUssS0FBSyxDQUFDLENBQUMsR0FBRyxRQUFRO0VBQUM7RUFBRyxJQUFJO0VBQU0sQ0FBQztDQUFJLENBQUMsR0FBRyxTQUFTLFFBQVEsR0FBRyxFQUFFO0NBQy9HLE9BQU8sRUFBRSxTQUFTO0FBQ3BCOzs7OztBQU1BLFNBQVMsV0FBaUM7Q0FDeEMsTUFBTSxJQUFJLElBQUksSUFBSTtDQUNsQixNQUFNLElBQUksS0FBSyxHQUFHLElBQUk7Q0FDdEIsTUFBTSxJQUFJLEtBQUssS0FBSztDQUNwQixLQUFLLE1BQU0sUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUc7RUFDMUIsTUFBTSxPQUFPLE9BQU8sSUFBSSxVQUFVLFNBQVMsSUFBSSxPQUFPLEVBQUUsTUFBTSxNQUFVO0dBQUM7R0FBRyxFQUFFO0dBQU07RUFBQztFQUNyRixFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxNQUFPLE1BQU8sRUFBRSxPQUFPLEtBQU0sR0FBRyxDQUFDLEdBQUcsS0FBSyxHQUFHLE1BQU8sTUFBTyxLQUFNLEdBQUcsQ0FBQyxDQUFDLEdBQUcsUUFBUSxNQUFNLEdBQUcsTUFBTSxVQUFVLEdBQUcsR0FBRztFQUNuSSxFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxNQUFPLE1BQU8sR0FBRyxHQUFHLEdBQUcsSUFBSyxHQUFHLEtBQUssR0FBRyxNQUFPLEtBQU0sS0FBTSxHQUFHLEdBQUcsSUFBSyxDQUFDLEdBQUcsUUFBUSxLQUFLLEdBQUcsTUFBTSxRQUFRLEdBQUcsR0FBRztDQUNuSTtDQUNBLEVBQUUsSUFBSSxLQUFLLENBQUMsS0FBSyxHQUFHLEtBQU0sTUFBTyxJQUFLLEdBQUcsR0FBRyxLQUFLLEdBQUcsTUFBTyxNQUFPLElBQUssR0FBRyxDQUFDLEdBQUcsT0FBTyxNQUFNLEdBQUcsU0FBUyxRQUFRO0NBQy9HLEVBQUUsSUFBSSxLQUFLO0VBQUMsS0FBSyxHQUFHLE1BQU8sTUFBTyxLQUFNLEdBQUc7RUFBRyxLQUFLLEdBQUcsS0FBTSxNQUFPLE1BQU0sR0FBRztFQUFHLEtBQUssR0FBRyxLQUFNLE1BQU8sTUFBTSxHQUFHO0NBQUMsR0FBRyxRQUFRLEtBQUssR0FBRyxTQUFTLEtBQUs7Q0FDL0ksTUFBTSxjQUF3QixLQUFLLENBQUMsS0FBSyxHQUFHLE1BQU8sSUFBSyxJQUFLLEdBQUcsR0FBRyxLQUFLLEdBQUcsTUFBTyxLQUFNLEtBQU0sR0FBRyxDQUFDLEdBQUcsUUFBUSxNQUFNO0NBQ25ILEVBQUUsSUFBSSxNQUFNLEdBQUcsU0FBUyxVQUFVLFNBQVM7Q0FDM0MsRUFBRSxJQUFJLE1BQU0sR0FBRyxTQUFTLE9BQU8sU0FBUztDQUN4QyxFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFNLEtBQU0sSUFBSyxHQUFHLEdBQUcsQ0FBQyxJQUFLLEdBQUcsS0FBSyxHQUFHLElBQUssTUFBTyxNQUFNLEdBQUcsR0FBRyxDQUFDLEdBQUksQ0FBQyxHQUFHLFFBQVEsS0FBSyxHQUFHLFNBQVMsT0FBTyxLQUFLO0NBQ2xJLEtBQUssTUFBTSxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRztFQUMxQixNQUFNLEtBQUssT0FBTyxJQUFJLFVBQVUsU0FBUyxPQUFPLE9BQU8sSUFBSSxXQUFXO0VBQ3RFLE1BQU0sRUFBRSxHQUFHLEdBQUcsTUFBTSxTQUFTLEdBQUcsTUFBTSxLQUFLO0VBQzNDLE1BQU0sSUFBSSxFQUFFLE9BQU8sSUFBSSxFQUFFO0VBQ3pCLEVBQUUsSUFBSSxHQUFHLEtBQUssQ0FBQyxLQUFLLEdBQUcsTUFBTyxNQUFPLEdBQUksR0FBRyxLQUFLLEdBQUcsTUFBTyxNQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUc7R0FBQztHQUFHO0dBQU07RUFBQyxHQUFHLE1BQU0sR0FBRyxDQUFDLEdBQUcsSUFBSSxPQUFPLEdBQUcsQ0FBQztFQUNsSCxFQUFFLElBQUksR0FBRyxLQUFLLENBQUMsS0FBSyxHQUFHLE1BQU8sTUFBTyxDQUFDLElBQUksR0FBSSxHQUFHLEtBQUssR0FBRyxNQUFPLE1BQU8sQ0FBQyxJQUFJLEdBQUksQ0FBQyxHQUFHO0dBQUM7R0FBRyxDQUFDLElBQUk7R0FBTTtFQUFDLEdBQUcsTUFBTSxHQUFHLENBQUMsR0FBRyxNQUFNLE9BQU8sR0FBRyxHQUFHLENBQUM7RUFDeEksRUFBRSxJQUFJLEdBQUcsS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFNLEtBQU0sQ0FBQyxJQUFJLEtBQU0sQ0FBQyxHQUFHLEtBQUssR0FBRyxNQUFPLEtBQU0sQ0FBQyxJQUFJLEtBQU0sR0FBRyxHQUFHLElBQUssQ0FBQyxHQUFHLFFBQVE7R0FBQztHQUFHLENBQUMsSUFBSTtHQUFPO0VBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxNQUFNLFFBQVEsR0FBRyxHQUFHLENBQUM7Q0FDN0o7Q0FDQSxNQUFNLEtBQUssRUFBRSxJQUFJLEtBQUssRUFBRSxPQUFPLEtBQUssUUFBUSxDQUFDO0NBQzdDLEVBQUUsSUFBSSxLQUFLLENBQUMsS0FBSyxHQUFHLE9BQVEsSUFBSSxPQUFRLElBQUksS0FBSyxNQUFPLElBQUksR0FBRyxHQUFHLEtBQUssR0FBRyxPQUFRLElBQUksT0FBUSxJQUFJLEtBQUssTUFBTyxJQUFJLEdBQUcsQ0FBQyxHQUNwSDtFQUFDO0VBQUcsS0FBSyxNQUFPO0VBQUksT0FBUTtDQUFFLEdBQUc7RUFBQztFQUFHLEtBQUssTUFBTztFQUFJLENBQUMsT0FBUTtDQUFFLENBQUMsR0FBRyxTQUFTLFFBQVEsR0FBRyxFQUFFO0NBQzVGLE1BQU0sS0FBSyxPQUFRO0NBQ25CLEtBQUssTUFBTSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRztFQUN2QixNQUFNLEtBQUssSUFBSSxNQUFPLElBQUksS0FBSyxLQUFLLE1BQU8sSUFBSSxJQUFJLE9BQVEsSUFBSSxJQUFJLE9BQVE7RUFDM0UsRUFBRSxJQUFJLEtBQUs7R0FBQyxLQUFLO0dBQUcsS0FBSztHQUFHLEtBQUs7R0FBRyxLQUFLO0dBQUcsS0FBSztHQUFHLEtBQUs7R0FBRyxLQUFLO0dBQUcsS0FBSztFQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsT0FBTyxHQUFHLEVBQUU7Q0FDekc7O0NBRUEsTUFBTSxNQUFNLE1BQXNCLEtBQUssTUFBTSxLQUFNLFFBQVMsS0FBTSxLQUFNLEtBQUssSUFBSSxDQUFDO0NBQ2xGLE1BQU0sS0FBSyxLQUFLLEdBQUcsR0FBRyxHQUFHLEdBQUcsS0FBSyxHQUFHLEdBQUcsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsR0FBRyxPQUFXO0VBQUUsTUFBTSxJQUFJLE9BQU8sSUFBSSxNQUFNLEVBQUUsSUFBSSxLQUFLLE9BQU8sT0FBUTtFQUFJLE9BQU87R0FBQyxJQUFJO0dBQUc7R0FBRyxJQUFJLElBQUksT0FBUTtFQUFFO0NBQUcsQ0FBQztDQUNySyxFQUFFLElBQUksS0FBSyxDQUFDLEVBQUUsR0FBRyxRQUFRO0VBQUM7RUFBRyxLQUFLLE1BQU87RUFBSSxDQUFDLE1BQU87Q0FBRSxHQUFHO0VBQUM7RUFBRyxLQUFLLE1BQU87RUFBSTtDQUFDLENBQUMsR0FBRyxTQUFTLFFBQVEsU0FBUyxFQUFFO0NBQy9HLEVBQUUsSUFBSSxLQUFLLENBQUMsS0FBSyxHQUFHLE9BQVEsSUFBSSxPQUFRLElBQUksS0FBSyxNQUFPLElBQUksR0FBRyxHQUFHLENBQUMsTUFBTyxFQUFFLEdBQUcsS0FBSyxHQUFHLE1BQU8sSUFBSSxNQUFPLElBQUksS0FBSyxNQUFPLElBQUksR0FBRyxHQUFHLENBQUMsT0FBUSxFQUFFLENBQUMsR0FBRyxRQUFRLE1BQU0sR0FBRyxTQUFTLFFBQVEsVUFBVSxFQUFFO0NBQ2hNLE1BQU0sS0FBSyxNQUFNLEdBQUksSUFBSSxLQUFLLE9BQU8sT0FBUTtDQUM3QyxFQUFFLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxNQUFPLElBQUksTUFBTyxJQUFJLEtBQUssS0FBTSxJQUFJLEtBQUssR0FBRyxNQUFPLEVBQUUsR0FBRyxLQUFLLEdBQUcsSUFB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RyxLQUFLLEtBQUssRUFBRSxLQUFLO0dBQzNDLElBQUksS0FBSyxLQUFLLEtBQUssTUFBTSxJQUFJLEtBQUssS0FBSyxHQUFHLEtBQUs7RUFDakQ7Q0FDRjtDQUVBLEFBQVEsV0FBVyxHQUFXLEdBQVcsSUFBWSxJQUFZLE9BQXFCO0VBQ3BGLEtBQUssSUFBSSxJQUFJLEdBQUcsSUFBSSxLQUFLLEtBQUs7R0FDNUIsTUFBTSxJQUFJLEtBQUssR0FBRztHQUNsQixJQUFJLE1BQU0sWUFBWSxNQUFNLFNBQVM7R0FDckMsSUFBSSxLQUFLLElBQUksS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLLE1BQU0sS0FBSyxJQUFJLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSyxJQUFJLEtBQUssS0FBSyxHQUFHLEtBQUs7RUFDeEY7Q0FDRjtDQUVBLEFBQVEsS0FBSyxHQUFXLE9BQXFCO0VBQzNDLEtBQUssR0FBRyxLQUFLO0VBQ2IsS0FBSyxFQUFFLEtBQUssTUFBTSxLQUFLLE9BQU8sSUFBSTtFQUNsQyxNQUFNLElBQUksS0FBSyxTQUFTLEtBQUs7RUFDN0IsS0FBSyxjQUFjLEtBQUssYUFBYSxLQUFLO0VBQzFDLEVBQUUsSUFBSSxLQUFLLEVBQUU7RUFBSSxFQUFFLElBQUksS0FBSyxFQUFFO0VBQUksRUFBRSxJQUFJO0VBQVksRUFBRSxJQUFJO0VBQUcsRUFBRSxJQUFJLEtBQU07Q0FDM0U7QUFDRjtBQUVBLFNBQVMsT0FBTyxHQUFtQjtDQUNqQyxLQUFLLElBQUksS0FBSyxPQUFPLEtBQUssS0FBSztDQUMvQixJQUFJLElBQUksR0FBRyxLQUFLLEtBQUssS0FBSztDQUMxQixPQUFPLElBQUksS0FBSztBQUNsQjtBQUVBLFNBQVMsV0FBVyxLQUFhLFFBQWdCLEdBQW1CO0NBQ2xFLE9BQU8sTUFBTSxPQUFPLFNBQVMsR0FBRyxJQUFJLEtBQUssSUFBSSxHQUFHLENBQUM7QUFDbkQiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiY2l2aWxpYW5zLnRzIl0sInZlcnNpb24iOjMsInNvdXJjZXNDb250ZW50IjpbIi8vIEJMT0NLVE9PVEgg4oCUIENpdmlsaWFuVmlldyAoZnggbGFuZSwgQ09OVFJBQ1Qgwqc2IC8gwqc2LjEgLyDCpzEgdG9uZSkuXG4vL1xuLy8gUHVyZWx5IGNvc21ldGljIGNyb3dkcyAoTWF0aC5yYW5kb20gaXMgZmluZSBoZXJlIOKAlCB2aWV3cyBtYXkgdXNlIGl0OyB0aGUgc2ltIG5ldmVyIHNlZXMgdGhlc2UpLlxuLy8gICAqIENpdmlsaWFucyBhcmUgbGl0dGxlIENBUlRPT04gUEVPUExFOiBmYWNldGVkIGxvdy1wb2x5IGZpZ3VyZXMgd2l0aCBhIGhlYWQgKGhhaXIgb3IgYSBoYXQpLFxuLy8gICAgIG5lY2ssIHRvcnNvLCBoaXBzLCB0d28gYXJtcyB3aXRoIGJyb2FkIG1pdHRlbiBoYW5kcyBhbmQgdHdvIGxlZ3Mgd2l0aCBzaG9lcyDigJQgY2h1bmt5IGNvbWljXG4vLyAgICAgcHJvcG9ydGlvbnMgKGhlYWQg4omIIDEvNS41IG9mIHRoZSBoZWlnaHQpLCBwYWludGVkIGNvbG91ciB6b25lcy5cbi8vICAgKiBUZW4gYXJjaGV0eXBlcyAob2ZmaWNlLCBjYXN1YWwsIGtpZCwgZWxkZXIsIGNvdXJpZXIsIGRyZXNzLCBoaS12aXMgd29ya2VyLCBwYXJrYSwgcmFpbmNvYXQsXG4vLyAgICAgZG9jayB3b3JrZXIpOyBlYWNoIGJpb21lIG1peGVzIFNJWCBvZiB0aGVtLiBQZXItaW5zdGFuY2UgY29sb3VycyArIG9wdGlvbiBiaXRzIChoYWlyIEEvQixcbi8vICAgICBoYXQgQS9CLCBiYWcsIHVtYnJlbGxhLCBiYWxsb29uLCB0aWUvc2NhcmYvY2FuZSkgbWFrZSBldmVyeSBjcm93ZCBtZW1iZXIgZGlmZmVyZW50LlxuLy8gICAqIE9ORSBtZXJnZWQgZ2VvbWV0cnkgcGVyIGFyY2hldHlwZS4gRXZlcnkgdmVydGV4IGNhcnJpZXMgYGFUYWdgID0gKHBhcnQsIGNvbG91ciBzbG90LCBvcHRpb25cbi8vICAgICBiaXQpIGFuZCBgYVBpdmAgKGl0cyBsaW1iIHBpdm90KS4gVGhlIHZlcnRleCBzaGFkZXIgKG9uQmVmb3JlQ29tcGlsZSBvbiB0aGUgdG9vbiBtYXRlcmlhbCxcbi8vICAgICBhbmQgdGhlIFNBTUUgY29kZSBpbiB0aGUgaW5rLWh1bGwgbWF0ZXJpYWwgc28gb3V0bGluZXMgZGVmb3JtIHdpdGggdGhlIGxpbWJzKSBzd2luZ3MgbGVnc1xuLy8gICAgIGFib3V0IHRoZSBoaXBzIGFuZCBhcm1zIGFib3V0IHRoZSBzaG91bGRlcnMgZnJvbSBwZXItaW5zdGFuY2UgYGlBbmltYCAoZ2FpdCBwaGFzZSwgc3dpbmdcbi8vICAgICBhbXBsaXR1ZGUsIHBvc2UgaWQsIGhlYWQgeWF3KSwgdHVybnMgLyB0aWx0cyB0aGUgaGVhZCwgaGlkZXMgdW5zZWxlY3RlZCBvcHRpb25zIGFuZCBwaWNrc1xuLy8gICAgIGVhY2ggdmVydGV4J3MgY29sb3VyIGZyb20gZml2ZSBwZXItaW5zdGFuY2UgY29sb3VycyAoYGlDMC4uaUM0YCkuIFplcm8gcGVyLXZlcnRleCBDUFUgd29yazpcbi8vICAgICBvbmUgaW5zdGFuY2VkIGRyYXcgcGVyIGFyY2hldHlwZSAoKyBpdHMgaHVsbCBhdCBTaXplIEnigJNJSSkuXG4vLyAgICogRmFyIGF3YXkgKFNpemUgSUlJKywgYSBmaWd1cmUgaXMgPCB+MjYgcHggdGFsbCkgZXZlcnkgY2l2aWxpYW4gaXMgZHJhd24gd2l0aCBPTkUgfjUyLXRyaVxuLy8gICAgIExPRCBmaWd1cmUgKHNhbWUgYW5pbWF0aW9uICsgY29sb3Vycywgbm8gaHVsbCkg4oCUIG9uZSBkcmF3IGZvciB0aGUgd2hvbGUgY3Jvd2QuXG4vLyAgICogVGhleSBsaXZlIG9uIHRoZSBTSURFV0FMSyByaW5nIG9mIExJVkUgYmxvY2tzIChDaGVieXNoZXYgbGl2ZVJhZGl1c0J5UmFuayBhcm91bmQgdGhlIHRpdGFuKVxuLy8gICAgIGluc2lkZSBhIHdpbmRvdyBhcm91bmQgdGhlIGNhbWVyYSB0YXJnZXQ7IGNvdW50IHNjYWxlcyB3aXRoIHJhbmsgc28gdGhleSByZWFkIGFzIGNyb3dkc1xuLy8gICAgIGZyb20gZmFyIGF3YXkgKGFuZCB3aXRoIHF1YWxpdHkpLiBPdXQtb2Ytd2luZG93IGNpdmlsaWFucyBhcmUgcmVjeWNsZWQgdG8gZnJlc2ggc2lkZXdhbGsgc3BvdHMuXG4vLyAgICogQmVoYXZpb3VyOiBtaWxsIGFsb25nIHRoZSBzaWRld2FsayAod2FsayBjeWNsZSBwaGFzZS1sb2NrZWQgdG8gc3BlZWQsIGdsYW5jaW5nIGF0IHRoZSB0aXRhbilcbi8vICAgICAvIHN0YW5kIGFuZCBnYXdrIChmYWNlIHRoZSB0aXRhbiwgbG9vayBVUCBhdCBpdCwgcG9pbnQsIGZpbG0gaXQgb24gYSBwaG9uZSwgd2F2ZSkg4oaSIEZMRUUgYXdheVxuLy8gICAgIGZyb20gdGhlIHRpdGFuIHdoZW4gaXQgaXMgd2l0aGluIH42SCAobW92aW5nKSBvciB+Mi41SCAoc3RhbmRpbmcpOiBmdWxsIHBhbmljIHJ1biwgYXJtc1xuLy8gICAgIGZsdW5nIHVwIGFuZCBmbGFpbGluZyDihpIgY2FsbSBkb3duIG9uY2UgZmFyIGF3YXkuXG4vLyAgICogQSB0aXRhbiBmb290c3RlcCB0aGF0IGxhbmRzIG9uIHRoZW0gKFNpemUgSUkrKSDigJQgb3IgYSBjb2xsYXBzZSAvIGV4cGxvc2lvbiBvbiB0b3Agb2YgdGhlbSDigJRcbi8vICAgICBtYWtlcyB0aGVtIFBVRkY6IGEgbGl0dGxlIGNyZWFtIGR1c3QgcG9wLiBOZXZlciBnb3JlLlxuLy8gICAqIFJlYWRhYmlsaXR5IHZzIHRoZSBIQUxWQVJEIGFuZHJvaWRzIChvZmYtd2hpdGUgKyBzYWZldHkgb3JhbmdlICsgbmF2eSwgdmlzb3JzLCBjYXJiaW5lcyk6XG4vLyAgICAgY2l2aWxpYW5zIG5ldmVyIHdlYXIgdGhhdCBwYWxldHRlLCBoYXZlIGhhaXIgLyBoYXRzIGluc3RlYWQgb2Ygdmlzb3JzLCBjYXJyeSBiYWdzLCBwaG9uZXMsXG4vLyAgICAgdW1icmVsbGFzIGFuZCBiYWxsb29ucyBpbnN0ZWFkIG9mIHdlYXBvbnMsIGFuZCBiZWhhdmUgbGlrZSBhIGNyb3dkLlxuXG5pbXBvcnQgKiBhcyBUSFJFRSBmcm9tICd0aHJlZSc7XG5pbXBvcnQgdHlwZSB7IEJpb21lSWQsIFdvcmxkIH0gZnJvbSAnLi4vY29yZS90eXBlcy50cyc7XG5pbXBvcnQgeyBDSVRZLCBQQVJDRUxfSEFMRiB9IGZyb20gJy4uL2NvcmUvY29uZmlnLnRzJztcbmltcG9ydCB7IFBST1BfSU5GTywgaGFyYm91cldhdGVyWiB9IGZyb20gJy4uL2NpdHkvY2l0eWdlbi50cyc7XG5pbXBvcnQgeyBJTkssIGFkZE91dGxpbmUsIGJha2VPdXRsaW5lTm9ybWFscywgZmFjZXQsIG1ha2VPdXRsaW5lTWF0ZXJpYWwsIG1ha2VUb29uIH0gZnJvbSAnLi9tYXRlcmlhbHMudHMnO1xuaW1wb3J0IHR5cGUgeyBGcmFtZUluZm8sIFZpZXdDdHgsIFZpZXdNb2R1bGUgfSBmcm9tICcuL3ZpZXd0eXBlcy50cyc7XG5cbmNvbnN0IENBUCA9IDY0MDtcbi8qKiB0YXJnZXQgY3Jvd2Qgc2l6ZSBieSByYW5rICjDlyBxdWFsaXR5IG11bHRpcGxpZXIpICovXG5jb25zdCBDUk9XRCA9IFs3MCwgMTYwLCAzMjAsIDUyMCwgNjQwXSBhcyBjb25zdDtcbmNvbnN0IFFfTVVMID0gWzAuNCwgMC43LCAxXSBhcyBjb25zdDtcbi8qKiBjaXZpbGlhbiBzY2FsZSBieSByYW5rOiBhIHRvdWNoIGxhcmdlciBhdCBkaXN0YW5jZSBzbyB0aGUgZmlndXJlcyBzdXJ2aXZlIHRoZSB6b29tLW91dCAqL1xuY29uc3QgQ0lWX1NDQUxFID0gWzEsIDEuMiwgMS43LCAyLjUsIDMuM10gYXMgY29uc3Q7XG4vKiogc2lkZXdhbGsgYmFuZCAobG9jYWwgb2Zmc2V0IGZyb20gdGhlIGJsb2NrIGNlbnRyZSkg4oCUIHBhcmNlbCBlZGdlIDI2IG0g4oCmIGN1cmIgMjkgbSAqL1xuY29uc3QgU1dfSU4gPSBQQVJDRUxfSEFMRiArIDAuNDU7XG5jb25zdCBTV19PVVQgPSBQQVJDRUxfSEFMRiArIDIuNjtcbi8qKiBhc3N1bWVkIHNpZGV3YWxrIHRvcCBoZWlnaHQgKGNpdHktdmlldyBvd25zIHRoZSByZWFsIGN1cmIgbWVzaCkgKi9cbmNvbnN0IFNJREVXQUxLX1kgPSAwLjE2O1xuY29uc3QgUFVGRl9DQVAgPSA3MjtcbmNvbnN0IFBVRkZfQkFMTFMgPSAzO1xuY29uc3QgUFVGRl9MSUZFID0gMC41NTtcbmNvbnN0IE9VVExJTkVfVyA9IDEuMztcblxuY29uc3QgU1RfRU1QVFkgPSAwLCBTVF9NSUxMID0gMSwgU1RfSURMRSA9IDIsIFNUX0ZMRUUgPSAzLCBTVF9HT05FID0gNDtcbi8qKiBwb3NlIGlkcyAoaUFuaW0ueikgKi9cbmNvbnN0IFBfV0FMSyA9IDAsIFBfUEFOSUMgPSAxLCBQX1BPSU5UID0gMiwgUF9QSE9ORSA9IDMsIFBfV0FWRSA9IDQ7XG5cbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCBvcHRpb24gYml0cyAoYVRhZy56IC8gbWFzaykg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5jb25zdCBPX0hBSVJfQSA9IDEsIE9fSEFJUl9CID0gMiwgT19IQVRfQSA9IDMsIE9fSEFUX0IgPSA0LCBPX0JBRyA9IDUsIE9fUEhPTkUgPSA2LCBPX1VNQiA9IDcsIE9fQkFMTE9PTiA9IDgsIE9fRVhUUkEgPSA5O1xuLyoqIG9wdGlvbiBjb2RlcyBkZWNpZGVkIGJ5IHRoZSBzaGFkZXIgZnJvbSB0aGUgcG9zZSAvIHBlci1pbnN0YW5jZSBzdHlsZSAobm90IGJ5IHRoZSBtYXNrIGJpdHMpOlxuICogIGNhbG0gdnMgUEFOSUMgZmFjZSwgdGhlIG1pZCBmaWd1cmUncyBnZW5lcmljIGhhdCAvIGhhaXIsIGl0cyBza2lydCAoYm90dG9tIGNvbG91cikgLyBsb25nIGNvYXQgKHRvcCkgKi9cbmNvbnN0IE9fQ0FMTSA9IDEwLCBPX1BBTklDID0gMTEsIE9fTUhBVCA9IDEyLCBPX01IQUlSID0gMTMsIE9fU0tJUlRfQiA9IDE0LCBPX1NLSVJUX1QgPSAxNTtcbmNvbnN0IGJpdCA9IChvOiBudW1iZXIpOiBudW1iZXIgPT4gMSA8PCAobyAtIDEpO1xuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgY29sb3VyIHNsb3RzIChhVGFnLnkpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuY29uc3QgU19TS0lOID0gMCwgU19UT1AgPSAxLCBTX0JPVFRPTSA9IDIsIFNfSEFJUiA9IDMsIFNfQUNDID0gNCwgU19TSE9FID0gNSwgU19JTksgPSA2LCBTX1dISVRFID0gNywgU19HUkVZID0gOCwgU19MRUFUSEVSID0gOTtcbi8qKiBzaG9lIHBhbGV0dGUgKGlDMC53IGluZGV4KSDigJQgbm8gb2ZmLXdoaXRlOiB0aGF0IGlzIHRoZSBIQUxWQVJEIGFuZHJvaWRzJyBsaXZlcnkgKi9cbmNvbnN0IFNIT0VTID0gWycjMmIyNjMwJywgJyM2YjRhMzMnLCAnIzdmZDBiZicsICcjZDk0YTNjJywgJyNmZmNmM2EnLCAnIzNhMzAzNiddO1xuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgcGFydHMgKGFUYWcueCkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBhcm1zOiB1cHBlciBhcm0gKHNob3VsZGVyIHBpdm90KSArIGZvcmVhcm0vaGFuZCAoc2hvdWxkZXIgcGl2b3QsIHRoZW4gdGhlIGVsYm93ID0gYUVsYik7XG4vLyBsZWdzOiB0aGlnaCAoaGlwKSArIHNoaW4vc2hvZSAoaGlwLCB0aGVuIHRoZSBrbmVlID0gYUVsYilcbmNvbnN0IFBUX0JPRFkgPSAwLCBQVF9MTEVHID0gMSwgUFRfUkxFRyA9IDIsIFBUX0xBUk0gPSAzLCBQVF9SQVJNID0gNCwgUFRfSEVBRCA9IDUsIFBUX0xGT1JFID0gNiwgUFRfUkZPUkUgPSA3LCBQVF9MU0hJTiA9IDgsIFBUX1JTSElOID0gOTtcblxuLyoqIGZpeGVkIGFybSBwb3NlcyBmb3IgaGVsZCBwcm9wcyAoc2hhZGVyICsgYXV0aG9yaW5nIG11c3QgYWdyZWUpICovXG5jb25zdCBVTUJfUlggPSAtMC41NSwgVU1CX1JaID0gLTAuMTI7XG5jb25zdCBCQUxfUlggPSAtMC41LCBCQUxfUlogPSAwLjI1O1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAgZ2VvbWV0cnkgdG9vbGtpdCDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbnR5cGUgVjMgPSBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5cbmZ1bmN0aW9uIHJpbmcobjogbnVtYmVyLCByeDogbnVtYmVyLCByejogbnVtYmVyLCB5OiBudW1iZXIsIHJvdCA9IDAsIG94ID0gMCwgb3ogPSAwLCB5Zj86IChhOiBudW1iZXIpID0+IG51bWJlcik6IFYzW10ge1xuICBjb25zdCBvdXQ6IFYzW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHtcbiAgICBjb25zdCBhID0gcm90ICsgKGkgLyBuKSAqIE1hdGguUEkgKiAyO1xuICAgIG91dC5wdXNoKFtveCArIE1hdGguc2luKGEpICogcngsIHlmID8geWYoYSkgOiB5LCBveiArIE1hdGguY29zKGEpICogcnpdKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBjZW50cm9pZChSOiBWM1tdKTogVjMge1xuICBsZXQgeCA9IDAsIHkgPSAwLCB6ID0gMDtcbiAgZm9yIChjb25zdCBwIG9mIFIpIHsgeCArPSBwWzBdOyB5ICs9IHBbMV07IHogKz0gcFsyXTsgfVxuICByZXR1cm4gW3ggLyBSLmxlbmd0aCwgeSAvIFIubGVuZ3RoLCB6IC8gUi5sZW5ndGhdO1xufVxuXG50eXBlIEVuZCA9ICdjYXAnIHwgJ25vbmUnIHwgVjM7XG5cbi8qKiBMb2Z0ZWQgc2hlbGwgdGhyb3VnaCByaW5ncyBvZiBlcXVhbCBwb2ludCBjb3VudDsgZW5kcyBjYXBwZWQgKGZhbiB0byB0aGUgcmluZyBjZW50cm9pZCksXG4gKiAgb3Blbiwgb3IgZmFubmVkIHRvIGFuIGFwZXggcG9pbnQuIENvbnNpc3RlbnRseSB3b3VuZCwgdGhlbiBvcmllbnRlZCBvdXR3YXJkLiAqL1xuZnVuY3Rpb24gbG9mdChyaW5nczogVjNbXVtdLCBib3Q6IEVuZCA9ICdjYXAnLCB0b3A6IEVuZCA9ICdjYXAnLCBzaGVsbENlbnRyZT86IFYzKTogbnVtYmVyW10ge1xuICBjb25zdCB0OiBudW1iZXJbXSA9IFtdO1xuICBjb25zdCB0cmkgPSAoYTogVjMsIGI6IFYzLCBjOiBWMyk6IHZvaWQgPT4geyB0LnB1c2goYVswXSwgYVsxXSwgYVsyXSwgYlswXSwgYlsxXSwgYlsyXSwgY1swXSwgY1sxXSwgY1syXSk7IH07XG4gIGZvciAobGV0IHIgPSAwOyByICsgMSA8IHJpbmdzLmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3QgQSA9IHJpbmdzW3JdLCBCID0gcmluZ3NbciArIDFdLCBuID0gQS5sZW5ndGg7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHtcbiAgICAgIGNvbnN0IGogPSAoaSArIDEpICUgbjtcbiAgICAgIHRyaShBW2ldLCBBW2pdLCBCW2pdKTsgdHJpKEFbaV0sIEJbal0sIEJbaV0pO1xuICAgIH1cbiAgfVxuICBjb25zdCBSMCA9IHJpbmdzWzBdLCBSMSA9IHJpbmdzW3JpbmdzLmxlbmd0aCAtIDFdO1xuICBpZiAoYm90ICE9PSAnbm9uZScpIHsgY29uc3QgYyA9IGJvdCA9PT0gJ2NhcCcgPyBjZW50cm9pZChSMCkgOiBib3Q7IGZvciAobGV0IGkgPSAwOyBpIDwgUjAubGVuZ3RoOyBpKyspIHRyaShjLCBSMFsoaSArIDEpICUgUjAubGVuZ3RoXSwgUjBbaV0pOyB9XG4gIGlmICh0b3AgIT09ICdub25lJykgeyBjb25zdCBjID0gdG9wID09PSAnY2FwJyA/IGNlbnRyb2lkKFIxKSA6IHRvcDsgZm9yIChsZXQgaSA9IDA7IGkgPCBSMS5sZW5ndGg7IGkrKykgdHJpKGMsIFIxW2ldLCBSMVsoaSArIDEpICUgUjEubGVuZ3RoXSk7IH1cbiAgcmV0dXJuIHNoZWxsQ2VudHJlID8gb3JpZW50RnJvbSh0LCBzaGVsbENlbnRyZSkgOiBvcmllbnQodCk7XG59XG5cbi8qKiBmbGlwIGV2ZXJ5IHRyaWFuZ2xlIGlmIHRoZSAoY29uc2lzdGVudGx5IHdvdW5kKSBzdXJmYWNlIGVuY2xvc2VzIG5lZ2F0aXZlIHZvbHVtZSAqL1xuZnVuY3Rpb24gb3JpZW50KHQ6IG51bWJlcltdKTogbnVtYmVyW10ge1xuICBsZXQgY3ggPSAwLCBjeSA9IDAsIGN6ID0gMDtcbiAgY29uc3QgbiA9IHQubGVuZ3RoIC8gMztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0Lmxlbmd0aDsgaSArPSAzKSB7IGN4ICs9IHRbaV07IGN5ICs9IHRbaSArIDFdOyBjeiArPSB0W2kgKyAyXTsgfVxuICBjeCAvPSBuOyBjeSAvPSBuOyBjeiAvPSBuO1xuICBsZXQgdm9sID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0Lmxlbmd0aDsgaSArPSA5KSB7XG4gICAgY29uc3QgYXggPSB0W2ldIC0gY3gsIGF5ID0gdFtpICsgMV0gLSBjeSwgYXogPSB0W2kgKyAyXSAtIGN6O1xuICAgIGNvbnN0IGJ4ID0gdFtpICsgM10gLSBjeCwgYnkgPSB0W2kgKyA0XSAtIGN5LCBieiA9IHRbaSArIDVdIC0gY3o7XG4gICAgY29uc3QgcXggPSB0W2kgKyA2XSAtIGN4LCBxeSA9IHRbaSArIDddIC0gY3ksIHF6ID0gdFtpICsgOF0gLSBjejtcbiAgICB2b2wgKz0gYXggKiAoYnkgKiBxeiAtIGJ6ICogcXkpIC0gYXkgKiAoYnggKiBxeiAtIGJ6ICogcXgpICsgYXogKiAoYnggKiBxeSAtIGJ5ICogcXgpO1xuICB9XG4gIGlmICh2b2wgPCAwKSBmbGlwQWxsKHQpO1xuICByZXR1cm4gdDtcbn1cblxuLyoqIG9yaWVudCBlYWNoIHRyaWFuZ2xlIHRvIGZhY2UgYXdheSBmcm9tIGEgY2VudHJlIHBvaW50IChvcGVuIHNoZWxsczogaGFpciwgaG9vZHMpICovXG5mdW5jdGlvbiBvcmllbnRGcm9tKHQ6IG51bWJlcltdLCBjOiBWMyk6IG51bWJlcltdIHtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0Lmxlbmd0aDsgaSArPSA5KSB7XG4gICAgY29uc3QgYXggPSB0W2ldLCBheSA9IHRbaSArIDFdLCBheiA9IHRbaSArIDJdO1xuICAgIGNvbnN0IGUxeCA9IHRbaSArIDNdIC0gYXgsIGUxeSA9IHRbaSArIDRdIC0gYXksIGUxeiA9IHRbaSArIDVdIC0gYXo7XG4gICAgY29uc3QgZTJ4ID0gdFtpICsgNl0gLSBheCwgZTJ5ID0gdFtpICsgN10gLSBheSwgZTJ6ID0gdFtpICsgOF0gLSBhejtcbiAgICBjb25zdCBueCA9IGUxeSAqIGUyeiAtIGUxeiAqIGUyeSwgbnkgPSBlMXogKiBlMnggLSBlMXggKiBlMnosIG56ID0gZTF4ICogZTJ5IC0gZTF5ICogZTJ4O1xuICAgIGNvbnN0IG14ID0gKGF4ICsgdFtpICsgM10gKyB0W2kgKyA2XSkgLyAzIC0gY1swXSwgbXkgPSAoYXkgKyB0W2kgKyA0XSArIHRbaSArIDddKSAvIDMgLSBjWzFdLCBteiA9IChheiArIHRbaSArIDVdICsgdFtpICsgOF0pIC8gMyAtIGNbMl07XG4gICAgaWYgKG54ICogbXggKyBueSAqIG15ICsgbnogKiBteiA8IDApIHN3YXBUcmkodCwgaSk7XG4gIH1cbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGZsaXBBbGwodDogbnVtYmVyW10pOiB2b2lkIHsgZm9yIChsZXQgaSA9IDA7IGkgPCB0Lmxlbmd0aDsgaSArPSA5KSBzd2FwVHJpKHQsIGkpOyB9XG5mdW5jdGlvbiBzd2FwVHJpKHQ6IG51bWJlcltdLCBpOiBudW1iZXIpOiB2b2lkIHtcbiAgZm9yIChsZXQgayA9IDA7IGsgPCAzOyBrKyspIHsgY29uc3QgcyA9IHRbaSArIDMgKyBrXTsgdFtpICsgMyArIGtdID0gdFtpICsgNiArIGtdOyB0W2kgKyA2ICsga10gPSBzOyB9XG59XG5cbi8qKiBuLXNpZGVkIHByaXNtIC8gZnJ1c3R1bSBzdGFuZGluZyBvbiB5MCAoZm9vdHByaW50IHJ4IMOXIHJ6LCB0b3Agc2NhbGVkIGJ5IGB0YXBlcmApICovXG5mdW5jdGlvbiBwcmlzbShuOiBudW1iZXIsIGN4OiBudW1iZXIsIHkwOiBudW1iZXIsIGN6OiBudW1iZXIsIHJ4OiBudW1iZXIsIGg6IG51bWJlciwgcno6IG51bWJlciwgdGFwZXIgPSAxLCByb3QgPSBNYXRoLlBJIC8gbik6IG51bWJlcltdIHtcbiAgcmV0dXJuIGxvZnQoW3JpbmcobiwgcngsIHJ6LCB5MCwgcm90LCBjeCwgY3opLCByaW5nKG4sIHJ4ICogdGFwZXIsIHJ6ICogdGFwZXIsIHkwICsgaCwgcm90LCBjeCwgY3opXSwgJ2NhcCcsICdjYXAnKTtcbn1cblxuLyoqIGJveCBjZW50cmVkIGF0IChjeCwgY3ksIGN6KSB3aXRoIGZ1bGwgc2l6ZXMgdyDDlyBoIMOXIGQgKi9cbmZ1bmN0aW9uIGJveChjeDogbnVtYmVyLCBjeTogbnVtYmVyLCBjejogbnVtYmVyLCB3OiBudW1iZXIsIGg6IG51bWJlciwgZDogbnVtYmVyLCB0YXBlciA9IDEpOiBudW1iZXJbXSB7XG4gIHJldHVybiBwcmlzbSg0LCBjeCwgY3kgLSBoIC8gMiwgY3osIHcgLyBNYXRoLlNRUlQyLCBoLCBkIC8gTWF0aC5TUVJUMiwgdGFwZXIsIE1hdGguUEkgLyA0KTtcbn1cblxuLyoqIGNvbnZleCBwb2x5Z29uICh4LCB5IHBhaXJzKSBleHRydWRlZCBhbG9uZyB6IGZyb20gejAgdG8gejEgKi9cbmZ1bmN0aW9uIGV4dHJ1ZGVYWShwdHM6IG51bWJlcltdLCB6MDogbnVtYmVyLCB6MTogbnVtYmVyKTogbnVtYmVyW10ge1xuICBjb25zdCBBOiBWM1tdID0gW10sIEI6IFYzW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwdHMubGVuZ3RoOyBpICs9IDIpIHsgQS5wdXNoKFtwdHNbaV0sIHB0c1tpICsgMV0sIHowXSk7IEIucHVzaChbcHRzW2ldLCBwdHNbaSArIDFdLCB6MV0pOyB9XG4gIHJldHVybiBsb2Z0KFtBLCBCXSwgJ2NhcCcsICdjYXAnKTtcbn1cblxuLyoqIHNtYWxsIGRvdWJsZSBweXJhbWlkIChcImdlbVwiKSDigJQgYnVucywgcG9tcG9tcywgYmFsbG9vbnMnIGtub3RzICovXG5mdW5jdGlvbiBnZW0oY3g6IG51bWJlciwgY3k6IG51bWJlciwgY3o6IG51bWJlciwgcjogbnVtYmVyLCBoID0gciwgbiA9IDUpOiBudW1iZXJbXSB7XG4gIHJldHVybiBsb2Z0KFtyaW5nKG4sIHIsIHIsIGN5LCAwLCBjeCwgY3opXSwgW2N4LCBjeSAtIGgsIGN6XSwgW2N4LCBjeSArIGgsIGN6XSk7XG59XG5cbmZ1bmN0aW9uIHhmKHQ6IG51bWJlcltdLCBtOiBUSFJFRS5NYXRyaXg0KTogbnVtYmVyW10ge1xuICBjb25zdCBlID0gbS5lbGVtZW50cztcbiAgY29uc3Qgb3V0ID0gbmV3IEFycmF5PG51bWJlcj4odC5sZW5ndGgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpICs9IDMpIHtcbiAgICBjb25zdCB4ID0gdFtpXSwgeSA9IHRbaSArIDFdLCB6ID0gdFtpICsgMl07XG4gICAgb3V0W2ldID0gZVswXSAqIHggKyBlWzRdICogeSArIGVbOF0gKiB6ICsgZVsxMl07XG4gICAgb3V0W2kgKyAxXSA9IGVbMV0gKiB4ICsgZVs1XSAqIHkgKyBlWzldICogeiArIGVbMTNdO1xuICAgIG91dFtpICsgMl0gPSBlWzJdICogeCArIGVbNl0gKiB5ICsgZVsxMF0gKiB6ICsgZVsxNF07XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuY29uc3QgX20xID0gbmV3IFRIUkVFLk1hdHJpeDQoKSwgX20yID0gbmV3IFRIUkVFLk1hdHJpeDQoKSwgX20zID0gbmV3IFRIUkVFLk1hdHJpeDQoKTtcbi8qKiBUKHApIMK3IFIgwrcgVCjiiJJwKSAqL1xuZnVuY3Rpb24gYWJvdXQocDogVjMsIHI6IFRIUkVFLk1hdHJpeDQpOiBUSFJFRS5NYXRyaXg0IHtcbiAgcmV0dXJuIG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVRyYW5zbGF0aW9uKHBbMF0sIHBbMV0sIHBbMl0pLm11bHRpcGx5KHIpLm11bHRpcGx5KF9tMS5tYWtlVHJhbnNsYXRpb24oLXBbMF0sIC1wWzFdLCAtcFsyXSkpO1xufVxuZnVuY3Rpb24gcm90WChhOiBudW1iZXIpOiBUSFJFRS5NYXRyaXg0IHsgcmV0dXJuIG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWChhKTsgfVxuZnVuY3Rpb24gcm90WihhOiBudW1iZXIpOiBUSFJFRS5NYXRyaXg0IHsgcmV0dXJuIG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWihhKTsgfVxuLyoqIGdlb21ldHJ5IGF1dGhvcmVkIGluIGEgaGVsZCBwb3NlIOKGkiByZXN0LXBvc2UgY29vcmRpbmF0ZXMsIHNvIHRoZSBzaGFkZXIncyBwb3NlIChSeChyeCnCt1J6KHJ6KVxuICogIGFib3V0IHRoZSBzaG91bGRlcikgbGFuZHMgaXQgZXhhY3RseSB3aGVyZSBpdCB3YXMgYXV0aG9yZWQgKi9cbmZ1bmN0aW9uIHVucG9zZSh0OiBudW1iZXJbXSwgUzogVjMsIHJ4OiBudW1iZXIsIHJ6OiBudW1iZXIpOiBudW1iZXJbXSB7XG4gIGNvbnN0IGludiA9IF9tMi5tYWtlUm90YXRpb25aKC1yeikubXVsdGlwbHkoX20zLm1ha2VSb3RhdGlvblgoLXJ4KSk7XG4gIHJldHVybiB4Zih0LCBhYm91dChTLCBpbnYpKTtcbn1cblxuLyoqIG9uZSBhcmNoZXR5cGUncyBtZXJnZWQgZ2VvbWV0cnkgdW5kZXIgY29uc3RydWN0aW9uICovXG5jbGFzcyBGaWcge1xuICByZWFkb25seSBwb3M6IG51bWJlcltdID0gW107XG4gIHJlYWRvbmx5IHRhZzogbnVtYmVyW10gPSBbXTtcbiAgcmVhZG9ubHkgcGl2OiBudW1iZXJbXSA9IFtdO1xuICAvKiogc2Vjb25kIChpbm5lcikgam9pbnQ6IHRoZSBlbGJvdyBvZiBhIGZvcmVhcm0gLyB0aGUga25lZSBvZiBhIHNoaW4gKD0gcGl2b3QgZWxzZXdoZXJlKSAqL1xuICByZWFkb25seSBlbGI6IG51bWJlcltdID0gW107XG4gIC8qKiBjdXJyZW50IGdyb3VwIHRyYW5zZm9ybSAodGhlIGVsZGVyJ3Mgc3Rvb3ApLCBhcHBsaWVkIHRvIGdlb21ldHJ5IEFORCBwaXZvdHMgKi9cbiAgbWF0OiBUSFJFRS5NYXRyaXg0IHwgbnVsbCA9IG51bGw7XG5cbiAgYWRkKHQ6IG51bWJlcltdLCBwYXJ0OiBudW1iZXIsIHNsb3Q6IG51bWJlciwgb3B0ID0gMCwgcGl2b3Q6IFYzID0gWzAsIDAsIDBdLCBqb2ludD86IFYzKTogdm9pZCB7XG4gICAgbGV0IHR0ID0gdDtcbiAgICBsZXQgcCA9IHBpdm90O1xuICAgIGxldCBlID0gam9pbnQgPz8gcGl2b3Q7XG4gICAgaWYgKHRoaXMubWF0KSB7XG4gICAgICB0dCA9IHhmKHQsIHRoaXMubWF0KTtcbiAgICAgIGNvbnN0IHEgPSB4ZihbcFswXSwgcFsxXSwgcFsyXSwgZVswXSwgZVsxXSwgZVsyXV0sIHRoaXMubWF0KTtcbiAgICAgIHAgPSBbcVswXSwgcVsxXSwgcVsyXV07XG4gICAgICBlID0gW3FbM10sIHFbNF0sIHFbNV1dO1xuICAgIH1cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHR0Lmxlbmd0aDsgaSArPSAzKSB7XG4gICAgICB0aGlzLnBvcy5wdXNoKHR0W2ldLCB0dFtpICsgMV0sIHR0W2kgKyAyXSk7XG4gICAgICB0aGlzLnRhZy5wdXNoKHBhcnQsIHNsb3QsIG9wdCwgMCk7XG4gICAgICB0aGlzLnBpdi5wdXNoKHBbMF0sIHBbMV0sIHBbMl0pO1xuICAgICAgdGhpcy5lbGIucHVzaChlWzBdLCBlWzFdLCBlWzJdKTtcbiAgICB9XG4gIH1cblxuICBnZW9tZXRyeSgpOiBUSFJFRS5CdWZmZXJHZW9tZXRyeSB7XG4gICAgbGV0IGcgPSBuZXcgVEhSRUUuQnVmZmVyR2VvbWV0cnkoKTtcbiAgICBnLnNldEF0dHJpYnV0ZSgncG9zaXRpb24nLCBuZXcgVEhSRUUuRmxvYXQzMkJ1ZmZlckF0dHJpYnV0ZSh0aGlzLnBvcywgMykpO1xuICAgIGcuc2V0QXR0cmlidXRlKCdhVGFnJywgbmV3IFRIUkVFLkZsb2F0MzJCdWZmZXJBdHRyaWJ1dGUodGhpcy50YWcsIDQpKTtcbiAgICBnLnNldEF0dHJpYnV0ZSgnYVBpdicsIG5ldyBUSFJFRS5GbG9hdDMyQnVmZmVyQXR0cmlidXRlKHRoaXMucGl2LCAzKSk7XG4gICAgZy5zZXRBdHRyaWJ1dGUoJ2FFbGInLCBuZXcgVEhSRUUuRmxvYXQzMkJ1ZmZlckF0dHJpYnV0ZSh0aGlzLmVsYiwgMykpO1xuICAgIGNvbnN0IGYgPSBmYWNldChnKTtcbiAgICBnLmRpc3Bvc2UoKTtcbiAgICBnID0gZjtcbiAgICBiYWtlT3V0bGluZU5vcm1hbHMoZyk7XG4gICAgZy5jb21wdXRlQm91bmRpbmdTcGhlcmUoKTtcbiAgICByZXR1cm4gZztcbiAgfVxufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAgZmlndXJlIHBhcnRzIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuaW50ZXJmYWNlIERpbXMge1xuICBrOiBudW1iZXI7IGhzOiBudW1iZXI7IGJ1bGs6IG51bWJlcjtcbiAgaGlwWTogbnVtYmVyOyBoaXBYOiBudW1iZXI7IGtuZWVZOiBudW1iZXI7IHNoWTogbnVtYmVyOyBzaFg6IG51bWJlcjsgbmVja1k6IG51bWJlcjsgaGVhZFk6IG51bWJlcjtcbiAgLyoqIHNob3VsZGVyIOKGkiB3cmlzdCwgYW5kIHNob3VsZGVyIOKGkiBlbGJvdyAqL1xuICBhcm1MZW46IG51bWJlcjsgdXBMZW46IG51bWJlcjtcbn1cblxuLyoqIGhlYWRzIGFyZSBkcmF3biBhIHRvdWNoIGxhcmdlciB0aGFuIGxpZmUg4oCUIGNodW5reSBjb21pYyBwcm9wb3J0aW9ucywgcmVhZGFibGUgZmFjZXMgKi9cbmNvbnN0IEhFQURfSyA9IDEuMTtcbi8qKiBkZWZhdWx0IGFybSBzcGxheSAocmVzdCBwb3NlKTogdGhlIGFybXMgaGFuZyBjbGVhciBvZiB0aGUgYm9keSAqL1xuY29uc3QgU1BMQVkgPSAwLjE0O1xuXG5mdW5jdGlvbiBkaW1zKGs6IG51bWJlciwgaGsgPSAxLCBidWxrID0gMSk6IERpbXMge1xuICByZXR1cm4ge1xuICAgIGssIGhzOiBrICogaGsgKiBIRUFEX0ssIGJ1bGssXG4gICAgaGlwWTogMC43MCAqIGssIGhpcFg6IDAuMDc0ICogaywga25lZVk6IDAuMzggKiBrLFxuICAgIHNoWTogMS4xMCAqIGssIHNoWDogMC4xOSAqIGsgKiBidWxrLFxuICAgIG5lY2tZOiAxLjE1ICogaywgaGVhZFk6IDEuMTggKiBrLCBhcm1MZW46IDAuNDEgKiBrLCB1cExlbjogMC4yICogayxcbiAgfTtcbn1cblxuLyoqIGhlYWQgaGFsZi13aWR0aCBhdCBoZWlnaHQgdSAoaGVhZCB1bml0cyBhYm92ZSB0aGUgaGVhZCBiYXNlKSDigJQgaGFpci9oYXQgc2hlbGxzIGZvbGxvdyBpdCAqL1xuZnVuY3Rpb24gaGVhZFIodTogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgUDogW251bWJlciwgbnVtYmVyXVtdID0gW1swLCAwLjA3XSwgWzAuMDYsIDAuMTE4XSwgWzAuMTUsIDAuMTI4XSwgWzAuMjM1LCAwLjExMl0sIFswLjI4NSwgMC4wMl1dO1xuICBpZiAodSA8PSBQWzBdWzBdKSByZXR1cm4gUFswXVsxXTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPCBQLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKHUgPD0gUFtpXVswXSkgeyBjb25zdCBbdTAsIHIwXSA9IFBbaSAtIDFdLCBbdTEsIHIxXSA9IFBbaV07IHJldHVybiByMCArIChyMSAtIHIwKSAqICh1IC0gdTApIC8gKHUxIC0gdTApOyB9XG4gIH1cbiAgcmV0dXJuIFBbUC5sZW5ndGggLSAxXVsxXTtcbn1cbmNvbnN0IEhFWCA9IE1hdGguUEkgLyA2O1xuXG4vKiogZmxhdCBjb252ZXggcG9seWdvbiAoeCwgeSBwYWlycywgZWl0aGVyIHdpbmRpbmcpIGZhY2luZyArWiBhdCBkZXB0aCB6IOKAlCBleWVzLCBicm93cywgbW91dGhzICovXG5mdW5jdGlvbiBmbGF0KHB0czogbnVtYmVyW10sIHo6IG51bWJlcik6IG51bWJlcltdIHtcbiAgbGV0IGFyZWEgPSAwO1xuICBjb25zdCBuID0gcHRzLmxlbmd0aCAvIDI7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7IGNvbnN0IGogPSAoaSArIDEpICUgbjsgYXJlYSArPSBwdHNbaSAqIDJdICogcHRzW2ogKiAyICsgMV0gLSBwdHNbaiAqIDJdICogcHRzW2kgKiAyICsgMV07IH1cbiAgY29uc3QgaWR4ID0gKGk6IG51bWJlcik6IG51bWJlciA9PiAoYXJlYSA+PSAwID8gaSA6IG4gLSAxIC0gaSk7XG4gIGNvbnN0IHQ6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAxOyBpICsgMSA8IG47IGkrKykge1xuICAgIGZvciAoY29uc3QgdiBvZiBbMCwgaSwgaSArIDFdKSB7IGNvbnN0IHEgPSBpZHgodik7IHQucHVzaChwdHNbcSAqIDJdLCBwdHNbcSAqIDIgKyAxXSwgeik7IH1cbiAgfVxuICByZXR1cm4gdDtcbn1cblxuLyoqIGEgdGFwZXJlZCBsaW1iIHNlZ21lbnQgYWxvbmcg4oiSWSBmcm9tIHlBIChyYWRpdXMgckEpIHRvIHlCIChyQikgYXQgeDsgY2xvdGggYWJvdmUgYHlzYCwgc2tpbiBiZWxvd1xuICogIChhIGhlbSByaW5nIGNsb3NlcyB0aGUgY2xvdGgpLiBgdG9wQXBleGA6IHJvdW5kZWQgdG9wIGVuZCB0aGlzIGZhciBhYm92ZSB5QSAobnVsbCA9IG9wZW4pLiAqL1xuZnVuY3Rpb24gbGltYlNlZyhmOiBGaWcsIHg6IG51bWJlciwgeUE6IG51bWJlciwgckE6IG51bWJlciwgeUI6IG51bWJlciwgckI6IG51bWJlciwgeXM6IG51bWJlciwgY2xvdGg6IG51bWJlcixcbiAgcGFydDogbnVtYmVyLCBwaXY6IFYzLCBqb2ludDogVjMgfCB1bmRlZmluZWQsIHRvcEFwZXg6IG51bWJlciB8IG51bGwsIG4gPSA1KTogdm9pZCB7XG4gIGNvbnN0IHRvcDogRW5kID0gdG9wQXBleCA9PT0gbnVsbCA/ICdub25lJyA6IFt4LCB5QSArIHRvcEFwZXgsIDBdO1xuICBpZiAoeXMgPD0geUIgfHwgeXMgPj0geUEpIHtcbiAgICBmLmFkZChsb2Z0KFtyaW5nKG4sIHJBLCByQSwgeUEsIDAsIHgpLCByaW5nKG4sIHJCLCByQiwgeUIsIDAsIHgpXSwgdG9wLCAnbm9uZScpLCBwYXJ0LCB5cyA8PSB5QiA/IGNsb3RoIDogU19TS0lOLCAwLCBwaXYsIGpvaW50KTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcnMgPSByQSArIChyQiAtIHJBKSAqICh5QSAtIHlzKSAvICh5QSAtIHlCKTtcbiAgZi5hZGQobG9mdChbcmluZyhuLCByQSwgckEsIHlBLCAwLCB4KSwgcmluZyhuLCBycyAqIDEuMTQsIHJzICogMS4xNCwgeXMsIDAsIHgpXSwgdG9wLCAnY2FwJyksIHBhcnQsIGNsb3RoLCAwLCBwaXYsIGpvaW50KTtcbiAgZi5hZGQobG9mdChbcmluZyhuLCBycywgcnMsIHlzICsgMC4wMSwgMCwgeCksIHJpbmcobiwgckIsIHJCLCB5QiwgMCwgeCldLCAnbm9uZScsICdub25lJyksIHBhcnQsIFNfU0tJTiwgMCwgcGl2LCBqb2ludCk7XG59XG5cbmludGVyZmFjZSBMZWdPcHRzIHsgc2xvdD86IG51bWJlcjsgc2tpbkZyb20/OiBudW1iZXIgfCBudWxsOyBzaG9lSD86IG51bWJlcjsgcj86IG51bWJlcjsgYm9vdHM/OiBib29sZWFuIH1cbi8qKiB0aGlnaCAoc3dpbmdzIGFib3V0IHRoZSBoaXApICsgc2hpbiBhbmQgc2hvZSAoYWxzbyBiZW5kIGFib3V0IHRoZSBrbmVlKSAqL1xuZnVuY3Rpb24gbGVncyhmOiBGaWcsIGQ6IERpbXMsIG86IExlZ09wdHMgPSB7fSk6IHZvaWQge1xuICBjb25zdCBrID0gZC5rLCBzbG90ID0gby5zbG90ID8/IFNfQk9UVE9NLCBybSA9IG8uciA/PyAxO1xuICBmb3IgKGNvbnN0IHNpZGUgb2YgWzEsIC0xXSkge1xuICAgIGNvbnN0IHRoaWdoID0gc2lkZSA+IDAgPyBQVF9MTEVHIDogUFRfUkxFRywgc2hpbiA9IHNpZGUgPiAwID8gUFRfTFNISU4gOiBQVF9SU0hJTjtcbiAgICBjb25zdCB4ID0gc2lkZSAqIGQuaGlwWDtcbiAgICBjb25zdCBwaXY6IFYzID0gW3gsIGQuaGlwWSwgMF0sIGtuZWU6IFYzID0gW3gsIGQua25lZVksIDBdO1xuICAgIGNvbnN0IHIwID0gMC4wOCAqIGsgKiBybSwgcmsgPSAwLjA2NiAqIGsgKiBybSwgcjEgPSAwLjA1OCAqIGsgKiBybTtcbiAgICBjb25zdCBhbmtsZSA9IChvLnNob2VIID8/IDAuMDg1KSAqIGs7XG4gICAgY29uc3QgeVRvcCA9IGQuaGlwWSArIDAuMDMgKiBrO1xuICAgIGNvbnN0IHlzID0gby5za2luRnJvbSA/PyAtMTtcbiAgICBsaW1iU2VnKGYsIHgsIHlUb3AsIHIwLCBkLmtuZWVZIC0gMC4wMTIgKiBrLCByaywgeXMsIHNsb3QsIHRoaWdoLCBwaXYsIHVuZGVmaW5lZCwgbnVsbCk7XG4gICAgbGltYlNlZyhmLCB4LCBkLmtuZWVZICsgMC4wMTIgKiBrLCByayAqIDAuOTgsIGFua2xlLCByMSwgeXMsIHNsb3QsIHNoaW4sIHBpdiwga25lZSwgMC4wMyAqIGspO1xuICAgIC8vIHNob2UgLyBib290OiBwZW50YWdvbiBmb290cHJpbnQsIHJvdW5kZWQgdG9lIGZvcndhcmRcbiAgICBjb25zdCBzaCA9IG8uYm9vdHMgPyAwLjIgKiBrIDogYW5rbGUgKyAwLjAxMiAqIGs7XG4gICAgY29uc3Qgc3cgPSAoby5ib290cyA/IDAuMDc2IDogMC4wNjgpICogaywgc2QgPSAwLjEyNSAqIGs7XG4gICAgZi5hZGQobG9mdChbcmluZyg1LCBzdywgc2QsIDAsIDAsIHgsIDAuMDM1ICogayksIHJpbmcoNSwgc3cgKiAwLjg2LCBzZCAqIDAuNzQsIHNoLCAwLCB4LCAwLjAxMiAqIGspXSwgJ25vbmUnLCAnY2FwJyksIHNoaW4sIFNfU0hPRSwgMCwgcGl2LCBrbmVlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBwZWx2aXMoZjogRmlnLCBkOiBEaW1zLCBzbG90OiBudW1iZXIsIHkwID0gMC42MCwgeTEgPSAwLjgwKTogdm9pZCB7XG4gIGNvbnN0IGsgPSBkLmssIGIgPSBkLmJ1bGs7XG4gIGYuYWRkKGxvZnQoW3JpbmcoNiwgMC4xMzUgKiBrICogYiwgMC4wOTIgKiBrLCB5MCAqIGssIEhFWCksIHJpbmcoNiwgMC4xNDIgKiBrICogYiwgMC4wOTYgKiBrLCB5MSAqIGssIEhFWCldLCAnY2FwJywgJ25vbmUnKSwgUFRfQk9EWSwgc2xvdCk7XG59XG5cbi8qKiBwcm9maWxlIHJvd3M6IFt5LCByeCwgcnpdICjDlyBrOyByeCDDlyBidWxrKSDigJQgb3BlbiBhdCB0aGUgYm90dG9tICh0aGUgaGlwcyBjbG9zZSBpdCkgKi9cbmNvbnN0IFRPUlNPOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl1bXSA9IFtbMC43NCwgMC4xNCwgMC4wOTVdLCBbMS4wMywgMC4xNjgsIDAuMTA2XSwgWzEuMTcsIDAuMTE4LCAwLjA4Ml1dO1xuZnVuY3Rpb24gdG9yc28oZjogRmlnLCBkOiBEaW1zLCBzbG90OiBudW1iZXIsIHByb2Y6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXVtdID0gVE9SU08sIGJvdDogRW5kID0gJ25vbmUnKTogdm9pZCB7XG4gIGNvbnN0IGsgPSBkLmssIGIgPSBkLmJ1bGs7XG4gIGYuYWRkKGxvZnQocHJvZi5tYXAoKFt5LCByeCwgcnpdKSA9PiByaW5nKDYsIHJ4ICogayAqIGIsIHJ6ICogaywgeSAqIGssIEhFWCkpLCBib3QsICdjYXAnKSwgUFRfQk9EWSwgc2xvdCk7XG59XG5cbi8qKiByZXN0LXBvc2UgZnJhbWUgb2YgYW4gYXJtOiBzaG91bGRlciBTLCB0aGUgc3BsYXkgdGlsdCwgYW5kIHRoZSBlbGJvdyBFICovXG5mdW5jdGlvbiBhcm1GcmFtZShkOiBEaW1zLCBzaWRlOiBudW1iZXIsIHNwbGF5OiBudW1iZXIpOiB7IFM6IFYzOyBtOiBUSFJFRS5NYXRyaXg0OyBFOiBWMyB9IHtcbiAgY29uc3QgUzogVjMgPSBbc2lkZSAqIGQuc2hYLCBkLnNoWSwgMF07XG4gIGNvbnN0IG0gPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VUcmFuc2xhdGlvbihTWzBdLCBTWzFdLCBTWzJdKS5tdWx0aXBseShyb3RaKHNpZGUgKiBzcGxheSkpO1xuICBjb25zdCBlID0geGYoWzAsIC1kLnVwTGVuLCAwXSwgbSk7XG4gIHJldHVybiB7IFMsIG0sIEU6IFtlWzBdLCBlWzFdLCBlWzJdXSB9O1xufVxuXG5pbnRlcmZhY2UgQXJtT3B0cyB7IHNsZWV2ZTogJ2xvbmcnIHwgJ3Nob3J0Jzsgc2xvdD86IG51bWJlcjsgaGFuZD86IG51bWJlcjsgcj86IG51bWJlcjsgc3BsYXk/OiBudW1iZXIgfVxuLyoqIGNodW5reSB0d28tc2VnbWVudCBjYXJ0b29uIGFybXM6IHVwcGVyIGFybSAoc3dpbmdzIGFib3V0IHRoZSBzaG91bGRlcikgKyBmb3JlYXJtIChhbHNvIGJlbmRzIGF0XG4gKiAgdGhlIGVsYm93KSArIGEgYnJvYWQgcm91bmRlZCBtaXR0ZW4gaGFuZCB3aXRoIGEgdGh1bWI7IHRoZSByaWdodCBoYW5kIGhvbGRzIHRoZSBwaG9uZSAocGhvbmUgcG9zZSkgKi9cbmZ1bmN0aW9uIGFybXMoZjogRmlnLCBkOiBEaW1zLCBvOiBBcm1PcHRzKTogdm9pZCB7XG4gIGNvbnN0IGsgPSBkLmssIHJtID0gby5yID8/IDEsIHNsb3QgPSBvLnNsb3QgPz8gU19UT1AsIGhhbmQgPSBvLmhhbmQgPz8gU19TS0lOO1xuICBjb25zdCBMID0gZC5hcm1MZW4sIFUgPSBkLnVwTGVuO1xuICBmb3IgKGNvbnN0IHNpZGUgb2YgWzEsIC0xXSkge1xuICAgIGNvbnN0IHVwID0gc2lkZSA+IDAgPyBQVF9MQVJNIDogUFRfUkFSTSwgZm9yZSA9IHNpZGUgPiAwID8gUFRfTEZPUkUgOiBQVF9SRk9SRTtcbiAgICBjb25zdCB7IFMsIG0sIEUgfSA9IGFybUZyYW1lKGQsIHNpZGUsIG8uc3BsYXkgPz8gU1BMQVkpO1xuICAgIGNvbnN0IHJzID0gMC4wNzQgKiBrICogcm0sIHJlID0gMC4wNjQgKiBrICogcm0sIHJ3ID0gMC4wNTQgKiBrICogcm07XG4gICAgY29uc3QgYWRkID0gKHQ6IG51bWJlcltdLCBwYXJ0OiBudW1iZXIsIHNsOiBudW1iZXIsIG9wdCA9IDApOiB2b2lkID0+IGYuYWRkKHhmKHQsIG0pLCBwYXJ0LCBzbCwgb3B0LCBTLCBwYXJ0ID09PSBmb3JlID8gRSA6IHVuZGVmaW5lZCk7XG4gICAgY29uc3Qgc2g6IEVuZCA9IFswLCAwLjA1ICogaywgMF07XG4gICAgaWYgKG8uc2xlZXZlID09PSAnbG9uZycpIHtcbiAgICAgIGFkZChsb2Z0KFtyaW5nKDYsIHJzLCBycywgMC4wMTUgKiBrLCBIRVgpLCByaW5nKDYsIHJlICogMS4wNCwgcmUgKiAxLjA0LCAtVSwgSEVYKV0sIHNoLCAnY2FwJyksIHVwLCBzbG90KTtcbiAgICAgIGFkZChsb2Z0KFtyaW5nKDYsIHJlLCByZSwgLVUgKyAwLjAxMiAqIGssIEhFWCksIHJpbmcoNiwgcncgKiAxLjEsIHJ3ICogMS4xLCAtTCArIDAuMDEyICogaywgSEVYKV0sIFswLCAtVSArIDAuMDQ1ICogaywgMF0sICdjYXAnKSwgZm9yZSwgc2xvdCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHlzID0gLTAuNTUgKiBVO1xuICAgICAgYWRkKGxvZnQoW3JpbmcoNiwgcnMgKiAxLjEsIHJzICogMS4xLCAwLjAxNSAqIGssIEhFWCksIHJpbmcoNiwgcnMgKiAxLjA4LCBycyAqIDEuMDgsIHlzLCBIRVgpXSwgc2gsICdjYXAnKSwgdXAsIHNsb3QpO1xuICAgICAgYWRkKGxvZnQoW3JpbmcoNiwgcnMgKiAwLjk1LCBycyAqIDAuOTUsIHlzICsgMC4wMSAqIGssIEhFWCksIHJpbmcoNiwgcmUgKiAxLjAyLCByZSAqIDEuMDIsIC1VLCBIRVgpXSwgJ25vbmUnLCAnY2FwJyksIHVwLCBTX1NLSU4pO1xuICAgICAgYWRkKGxvZnQoW3JpbmcoNiwgcmUsIHJlLCAtVSArIDAuMDEyICogaywgSEVYKSwgcmluZyg2LCBydywgcncsIC1MICsgMC4wMTIgKiBrLCBIRVgpXSwgWzAsIC1VICsgMC4wNDUgKiBrLCAwXSwgJ25vbmUnKSwgZm9yZSwgU19TS0lOKTtcbiAgICB9XG4gICAgLy8gYnJvYWQgcm91bmRlZCBtaXR0ZW46IHRoaW4gYWNyb3NzIHggKHBhbG0gZmFjZXMgdGhlIHRoaWdoKSwgd2lkZSBhbG9uZyB6LCB0aHVtYiBmb3J3YXJkXG4gICAgY29uc3QgaHggPSAwLjA0NiAqIGsgKiBybSwgaHogPSAwLjA2NiAqIGsgKiBybTtcbiAgICBhZGQobG9mdChbXG4gICAgICByaW5nKDYsIHJ3ICogMC45MiwgcncgKiAwLjkyLCAtTCArIDAuMDIgKiBrLCBIRVgpLFxuICAgICAgcmluZyg2LCBoeCwgaHosIC1MIC0gMC4wMzUgKiBrLCBIRVgsIDAsIDAuMDA0ICogayksXG4gICAgICByaW5nKDYsIGh4ICogMC45MiwgaHogKiAwLjksIC1MIC0gMC4wOTUgKiBrLCBIRVgsIDAsIDAuMDA0ICogayksXG4gICAgXSwgJ25vbmUnLCBbMCwgLUwgLSAwLjEzMiAqIGssIDAuMDA0ICoga10pLCBmb3JlLCBoYW5kKTtcbiAgICBhZGQoZ2VtKDAsIC1MIC0gMC4wMzUgKiBrLCBoeiAqIDAuOTUsIDAuMDI0ICogayAqIHJtLCAwLjAzICogayAqIHJtLCA0KSwgZm9yZSwgaGFuZCk7XG4gICAgaWYgKHNpZGUgPCAwKSB7XG4gICAgICAvLyBwaG9uZTogYSBzbGFiIGdyaXBwZWQgaW4gZnJvbnQgb2YgdGhlIHBhbG0gKG9ubHkgZHJhd24gaW4gdGhlIHBob25lIHBvc2UpXG4gICAgICAvLyAoaGVsZCB1cCBwYXN0IHRoZSBtaXR0ZW4gdGlwIHNvIGl0IHJlYWRzIGFib3ZlIHRoZSBoYW5kIGZyb20gdGhlIGdhbWUgY2FtZXJhKVxuICAgICAgYWRkKGJveCgwLCAtTCAtIDAuMTIgKiBrLCBoeiAqIDAuNTUsIDAuMDg1ICogaywgMC4xNyAqIGssIDAuMDIgKiBrKSwgZm9yZSwgU19JTkssIE9fUEhPTkUpO1xuICAgIH1cbiAgfVxufVxuXG4vKiogaGFuZCBjZW50cmUgb2YgYW4gYXJtIGluIHRoZSBSRVNUIHBvc2UgKGZvciBwcm9wcyBoZWxkIGluIHRoZSBoYW5kKSAqL1xuZnVuY3Rpb24gaGFuZEF0KGQ6IERpbXMsIHNpZGU6IG51bWJlciwgc3BsYXkgPSBTUExBWSk6IFYzIHtcbiAgY29uc3QgciA9IGQuYXJtTGVuICsgMC4wNjUgKiBkLms7XG4gIHJldHVybiBbc2lkZSAqIGQuc2hYICsgc2lkZSAqIE1hdGguc2luKHNwbGF5KSAqIHIsIGQuc2hZIC0gTWF0aC5jb3Moc3BsYXkpICogciwgMF07XG59XG5cbi8qKiBlbGJvdyBvZiBhbiBhcm0gaW4gdGhlIFJFU1QgcG9zZSAodGhlIGZvcmVhcm0ncyBzZWNvbmQgcGl2b3QpICovXG5mdW5jdGlvbiBlbGJvd0F0KGQ6IERpbXMsIHNpZGU6IG51bWJlciwgc3BsYXkgPSBTUExBWSk6IFYzIHsgcmV0dXJuIGFybUZyYW1lKGQsIHNpZGUsIHNwbGF5KS5FOyB9XG5cbi8qKiBuZWNrICsgaGVhZCArIGEgY2FydG9vbiBmYWNlOiB3aGl0ZXMtYW5kLXB1cGlscyBleWVzLCBpbmsgYnJvd3MgYW5kIG1vdXRoIChjYWxtIC8gUEFOSUNcbiAqICB2YXJpYW50cyBwaWNrZWQgYnkgdGhlIHBvc2UgaW4gdGhlIHNoYWRlciksIGEgbGl0dGxlIG5vc2UgKi9cbmZ1bmN0aW9uIGhlYWQoZjogRmlnLCBkOiBEaW1zKTogdm9pZCB7XG4gIGNvbnN0IGsgPSBkLmssIGhzID0gZC5ocywgeTAgPSBkLmhlYWRZO1xuICBjb25zdCBwaXY6IFYzID0gWzAsIGQubmVja1ksIDBdO1xuICBmLmFkZChsb2Z0KFtyaW5nKDUsIDAuMDUgKiBrLCAwLjA1ICogaywgZC5uZWNrWSAtIDAuMDUgKiBrKSwgcmluZyg1LCAwLjA0OCAqIGssIDAuMDQ4ICogaywgeTAgKyAwLjA0ICogaHMpXSwgJ25vbmUnLCAnbm9uZScpLCBQVF9IRUFELCBTX1NLSU4sIDAsIHBpdik7XG4gIGNvbnN0IHJvd3M6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXVtdID0gW1swLjA1NSwgMC4xMTYsIDAuMTA2XSwgWzAuMTUsIDAuMTI4LCAwLjExNl0sIFswLjIzNSwgMC4xMTIsIDAuMTAyXV07XG4gIGYuYWRkKGxvZnQocm93cy5tYXAoKFt1LCByeCwgcnpdKSA9PiByaW5nKDYsIHJ4ICogaHMsIHJ6ICogaHMsIHkwICsgdSAqIGhzLCBIRVgpKSwgWzAsIHkwIC0gMC4wMTIgKiBocywgMC4wMTQgKiBoc10sIFswLCB5MCArIDAuMjg4ICogaHMsIC0wLjAwNiAqIGhzXSksIFBUX0hFQUQsIFNfU0tJTiwgMCwgcGl2KTtcbiAgY29uc3QgZnogPSAwLjEwNCAqIGhzO1xuICAvKiogZmFjZSBmZWF0dXJlIGluIGhlYWQgdW5pdHMgKHgsIHUgcGFpcnMpICovXG4gIGNvbnN0IEYgPSAocHRzOiBudW1iZXJbXSwgejogbnVtYmVyLCBzbG90OiBudW1iZXIsIG9wdCA9IDApOiB2b2lkID0+IGYuYWRkKGZsYXQocHRzLm1hcCgodiwgaSkgPT4gKGkgJSAyID8geTAgKyB2ICogaHMgOiB2ICogaHMpKSwgeiksIFBUX0hFQUQsIHNsb3QsIG9wdCwgcGl2KTtcbiAgY29uc3QgZXUgPSAwLjE0NjtcbiAgZm9yIChjb25zdCBzIG9mIFsxLCAtMV0pIHtcbiAgICBjb25zdCBleCA9IHMgKiAwLjAzNywgdyA9IDAuMDI1LCBoID0gMC4wMzM7XG4gICAgRihbZXggLSB3LCBldSwgZXggLSB3ICogMC42MiwgZXUgLSBoLCBleCArIHcgKiAwLjYyLCBldSAtIGgsIGV4ICsgdywgZXUsIGV4ICsgdyAqIDAuNjIsIGV1ICsgaCwgZXggLSB3ICogMC42MiwgZXUgKyBoXSwgZnosIFNfV0hJVEUpO1xuICAgIGNvbnN0IHB4ID0gZXggLSBzICogMC4wMDYsIHB5ID0gZXUgLSAwLjAwNCwgcHcgPSAwLjAxMjUsIHBoID0gMC4wMTk7XG4gICAgRihbcHggLSBwdywgcHkgLSBwaCwgcHggKyBwdywgcHkgLSBwaCwgcHggKyBwdywgcHkgKyBwaCwgcHggLSBwdywgcHkgKyBwaF0sIGZ6ICsgMC4wMDI1ICogaHMsIFNfSU5LKTtcbiAgICAvLyBicm93czogY2FsbSAobGV2ZWwpIC8gUEFOSUMgKHJhaXNlZCwgaW5uZXIgZW5kcyB1cCDigJQgd29ycmllZClcbiAgICBjb25zdCBidCA9IDAuMDEyNTtcbiAgICBGKFtzICogMC4wMTIsIDAuMTksIHMgKiAwLjA2NCwgMC4xODQsIHMgKiAwLjA2NCwgMC4xODQgKyBidCwgcyAqIDAuMDEyLCAwLjE5ICsgYnRdLCBmeiwgU19JTkssIE9fQ0FMTSk7XG4gICAgRihbcyAqIDAuMDEsIDAuMjE0LCBzICogMC4wNjQsIDAuMTk2LCBzICogMC4wNjQsIDAuMTk2ICsgYnQsIHMgKiAwLjAxLCAwLjIxNCArIGJ0XSwgZnosIFNfSU5LLCBPX1BBTklDKTtcbiAgfVxuICAvLyBtb3V0aDogYSBzbWFsbCBzbWlsZSAvIGEgcm91bmQgb3BlbiBcIk9cIiB3aGVuIHBhbmlja2luZ1xuICBjb25zdCBteiA9IDAuMDk4NSAqIGhzO1xuICBGKFstMC4wMjEsIDAuMDg0LCAwLjAyMSwgMC4wODQsIDAuMDEyLCAwLjA3MywgLTAuMDEyLCAwLjA3M10sIG16LCBTX0lOSywgT19DQUxNKTtcbiAgRihbLTAuMDIsIDAuMDc0LCAtMC4wMTMsIDAuMDU2LCAwLjAxMywgMC4wNTYsIDAuMDIsIDAuMDc0LCAwLjAxMywgMC4wOTQsIC0wLjAxMywgMC4wOTRdLCBteiwgU19JTkssIE9fUEFOSUMpO1xuICAvLyBub3NlXG4gIGYuYWRkKGxvZnQoW3JpbmcoMywgMC4wMTggKiBocywgMC4wMTEgKiBocywgeTAgKyAwLjEgKiBocywgTWF0aC5QSSwgMCwgZnogLSAwLjAwNiAqIGhzKV0sIFswLCB5MCArIDAuMDg4ICogaHMsIGZ6ICsgMC4wMSAqIGhzXSwgWzAsIHkwICsgMC4xMjQgKiBocywgZnogLSAwLjAwOCAqIGhzXSksIFBUX0hFQUQsIFNfU0tJTiwgMCwgcGl2KTtcbn1cblxuZnVuY3Rpb24gaGVhZFBpdihkOiBEaW1zKTogVjMgeyByZXR1cm4gWzAsIGQubmVja1ksIDBdOyB9XG5cbnR5cGUgSGFpcktpbmQgPSAnc2hvcnQnIHwgJ2xvbmcnIHwgJ2J1bicgfCAnY3JvcCc7XG5mdW5jdGlvbiBoYWlyKGY6IEZpZywgZDogRGltcywga2luZDogSGFpcktpbmQsIG9wdDogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IGhzID0gZC5ocywgeTAgPSBkLmhlYWRZLCBwaXYgPSBoZWFkUGl2KGQpO1xuICBjb25zdCBmcm9udCA9IGtpbmQgPT09ICdjcm9wJyA/IDAuMjA1IDogMC4yMjUsIGJhY2sgPSBraW5kID09PSAnbG9uZycgPyAwLjA2IDogMC4xO1xuICBjb25zdCB5ZiA9IChhOiBudW1iZXIpOiBudW1iZXIgPT4geTAgKyBocyAqIChiYWNrICsgKGZyb250IC0gYmFjaykgKiAoMC41ICsgMC41ICogTWF0aC5jb3MoYSkpKTtcbiAgY29uc3QgUjEgPSByaW5nKDYsIDEsIDEsIDAsIEhFWCwgMCwgMCwgeWYpLm1hcCgoW3gsIHksIHpdKTogVjMgPT4geyBjb25zdCByID0gaGVhZFIoKHkgLSB5MCkgLyBocykgKiBocyAqIDEuMSArIDAuMDA0ICogaHM7IHJldHVybiBbeCAqIHIsIHksIHogKiByIC0gMC4wMDQgKiBoc107IH0pO1xuICBjb25zdCBSMiA9IHJpbmcoNiwgaGVhZFIoMC4yNSkgKiBocyAqIDEuMTYsIGhlYWRSKDAuMjUpICogaHMgKiAxLjEsIHkwICsgMC4yNSAqIGhzLCBIRVgsIDAsIC0wLjAwOCAqIGhzKTtcbiAgZi5hZGQobG9mdChbUjEsIFIyXSwgJ25vbmUnLCBbMCwgeTAgKyAoa2luZCA9PT0gJ2Nyb3AnID8gMC4zMDUgOiAwLjMyKSAqIGhzLCAtMC4wMSAqIGhzXSwgWzAsIHkwICsgMC4xNSAqIGhzLCAwXSksIFBUX0hFQUQsIFNfSEFJUiwgb3B0LCBwaXYpO1xuICBpZiAoa2luZCA9PT0gJ2xvbmcnKSBmLmFkZChib3goMCwgeTAgKyAwLjEzICogaHMsIC0wLjA4OCAqIGhzLCAwLjIzNSAqIGhzLCAwLjI0ICogaHMsIDAuMDcgKiBocywgMC45NSksIFBUX0hFQUQsIFNfSEFJUiwgb3B0LCBwaXYpO1xuICBpZiAoa2luZCA9PT0gJ2J1bicpIGYuYWRkKGdlbSgwLCB5MCArIDAuMyAqIGhzLCAtMC4wNzggKiBocywgMC4wNTggKiBocywgMC4wNTIgKiBocywgNCksIFBUX0hFQUQsIFNfSEFJUiwgb3B0LCBwaXYpO1xufVxuXG50eXBlIEhhdEtpbmQgPSAnY2FwJyB8ICdoYXJkaGF0JyB8ICdiZWFuaWUnIHwgJ2ZsYXRjYXAnIHwgJ3N1bmhhdCcgfCAnaG9vZCcgfCAncGFya2Fob29kJztcbmZ1bmN0aW9uIGhhdChmOiBGaWcsIGQ6IERpbXMsIGtpbmQ6IEhhdEtpbmQsIG9wdDogbnVtYmVyLCBzbG90ID0gU19IQUlSKTogdm9pZCB7XG4gIGNvbnN0IGhzID0gZC5ocywgeTAgPSBkLmhlYWRZLCBwaXYgPSBoZWFkUGl2KGQpO1xuICBjb25zdCBSID0gKHU6IG51bWJlciwgbSA9IDEuMTIpOiBudW1iZXIgPT4gaGVhZFIodSkgKiBocyAqIG0gKyAwLjAwNCAqIGhzO1xuICBjb25zdCBjOiBWMyA9IFswLCB5MCArIDAuMTUgKiBocywgMF07XG4gIHN3aXRjaCAoa2luZCkge1xuICAgIGNhc2UgJ2NhcCc6IHtcbiAgICAgIGYuYWRkKGxvZnQoW3JpbmcoNiwgUigwLjIpLCBSKDAuMiksIHkwICsgMC4yICogaHMsIEhFWCwgMCwgLTAuMDA2ICogaHMpLCByaW5nKDYsIFIoMC4yNiwgMS4wOCksIFIoMC4yNiwgMS4wOCksIHkwICsgMC4yNyAqIGhzLCBIRVgsIDAsIC0wLjAxICogaHMpXSwgJ25vbmUnLCBbMCwgeTAgKyAwLjMyICogaHMsIC0wLjAxICogaHNdLCBjKSwgUFRfSEVBRCwgc2xvdCwgb3B0LCBwaXYpO1xuICAgICAgZi5hZGQoeGYoYm94KDAsIDAsIDAsIDAuMTcgKiBocywgMC4wMTggKiBocywgMC4xICogaHMpLCBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VUcmFuc2xhdGlvbigwLCB5MCArIDAuMjE1ICogaHMsIDAuMTQgKiBocykubXVsdGlwbHkocm90WCgwLjEyKSkpLCBQVF9IRUFELCBzbG90LCBvcHQsIHBpdik7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnZmxhdGNhcCc6IHtcbiAgICAgIGYuYWRkKGxvZnQoW3JpbmcoNiwgUigwLjIpLCBSKDAuMikgKiAxLjA1LCB5MCArIDAuMiAqIGhzLCBIRVgsIDAsIDAuMDEyICogaHMpLCByaW5nKDYsIFIoMC4yKSAqIDAuOTYsIFIoMC4yKSAqIDEuMDIsIHkwICsgMC4yNjUgKiBocywgSEVYLCAwLCAwLjAzICogaHMpXSwgJ25vbmUnLCBbMCwgeTAgKyAwLjMgKiBocywgMC4wXSwgYyksIFBUX0hFQUQsIHNsb3QsIG9wdCwgcGl2KTtcbiAgICAgIGYuYWRkKHhmKGJveCgwLCAwLCAwLCAwLjE3ICogaHMsIDAuMDE4ICogaHMsIDAuMDcgKiBocyksIG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVRyYW5zbGF0aW9uKDAsIHkwICsgMC4yMTUgKiBocywgMC4xNDUgKiBocykubXVsdGlwbHkocm90WCgwLjMpKSksIFBUX0hFQUQsIHNsb3QsIG9wdCwgcGl2KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICdoYXJkaGF0Jzoge1xuICAgICAgY29uc3QgcmIgPSAwLjE3NSAqIGhzLCByZCA9IFIoMC4yLCAxLjE0KTtcbiAgICAgIGYuYWRkKGxvZnQoW1xuICAgICAgICByaW5nKDYsIHJiLCByYiAqIDEuMDgsIHkwICsgMC4yMDUgKiBocywgSEVYLCAwLCAwLjAxNCAqIGhzKSwgcmluZyg2LCByYiwgcmIgKiAxLjA4LCB5MCArIDAuMjIyICogaHMsIEhFWCwgMCwgMC4wMTQgKiBocyksXG4gICAgICAgIHJpbmcoNiwgcmQsIHJkLCB5MCArIDAuMjI2ICogaHMsIEhFWCksIHJpbmcoNiwgcmQgKiAwLjg0LCByZCAqIDAuODQsIHkwICsgMC4zMDUgKiBocywgSEVYKSxcbiAgICAgIF0sICdjYXAnLCBbMCwgeTAgKyAwLjM0ICogaHMsIDBdKSwgUFRfSEVBRCwgc2xvdCwgb3B0LCBwaXYpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNhc2UgJ2JlYW5pZSc6IHtcbiAgICAgIGYuYWRkKGxvZnQoW3JpbmcoNiwgUigwLjE5LCAxLjE0KSwgUigwLjE5LCAxLjE0KSwgeTAgKyAwLjE5ICogaHMsIEhFWCwgMCwgLTAuMDA4ICogaHMpLCByaW5nKDYsIFIoMC4yNSwgMS4xKSwgUigwLjI1LCAxLjEpLCB5MCArIDAuMjU1ICogaHMsIEhFWCwgMCwgLTAuMDEgKiBocyldLCAnbm9uZScsIFswLCB5MCArIDAuMzQgKiBocywgLTAuMDEgKiBoc10sIGMpLCBQVF9IRUFELCBzbG90LCBvcHQsIHBpdik7XG4gICAgICBmLmFkZChnZW0oMCwgeTAgKyAwLjM2ICogaHMsIDAsIDAuMDQyICogaHMsIDAuMDM2ICogaHMsIDQpLCBQVF9IRUFELCBTX1dISVRFLCBvcHQsIHBpdik7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnc3VuaGF0Jzoge1xuICAgICAgY29uc3QgcmIgPSAwLjIzNSAqIGhzO1xuICAgICAgZi5hZGQobG9mdChbcmluZyg2LCByYiwgcmIsIHkwICsgMC4yMDUgKiBocywgSEVYKSwgcmluZyg2LCBSKDAuMjIsIDEuMTIpLCBSKDAuMjIsIDEuMTIpLCB5MCArIDAuMjI2ICogaHMsIEhFWCksIHJpbmcoNiwgUigwLjIyLCAxLjApLCBSKDAuMjIsIDEuMCksIHkwICsgMC4zMTUgKiBocywgSEVYKV0sICdjYXAnLCAnY2FwJyksIFBUX0hFQUQsIHNsb3QsIG9wdCwgcGl2KTtcbiAgICAgIGYuYWRkKGxvZnQoW3JpbmcoNiwgUigwLjIyLCAxLjEzNSksIFIoMC4yMiwgMS4xMzUpLCB5MCArIDAuMjI2ICogaHMsIEhFWCksIHJpbmcoNiwgUigwLjIyLCAxLjEpLCBSKDAuMjIsIDEuMSksIHkwICsgMC4yNiAqIGhzLCBIRVgpXSwgJ25vbmUnLCAnbm9uZScsIGMpLCBQVF9IRUFELCBTX0FDQywgb3B0LCBwaXYpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNhc2UgJ2hvb2QnOlxuICAgIGNhc2UgJ3BhcmthaG9vZCc6IHtcbiAgICAgIC8vIG9wZW4gc2hlbGwgYXJvdW5kIHRoZSBmYWNlOiBsb3cgYXQgdGhlIHNpZGVzIC8gYmFjaywgZnJhbWluZyB0aGUgZmFjZSBhdCB0aGUgZnJvbnRcbiAgICAgIGNvbnN0IHlmID0gKGE6IG51bWJlcik6IG51bWJlciA9PiB7XG4gICAgICAgIGNvbnN0IGN6ID0gTWF0aC5jb3MoYSk7XG4gICAgICAgIHJldHVybiB5MCArIGhzICogKGN6ID4gMC41NSA/IDAuMDIgKyAwLjI0ICogKGN6IC0gMC41NSkgLyAwLjQ1IDogLTAuMDQgKiBNYXRoLm1heCgwLCAtY3opKTtcbiAgICAgIH07XG4gICAgICBjb25zdCBSMSA9IHJpbmcoNiwgMSwgMSwgMCwgMCwgMCwgMCwgeWYpLm1hcCgoW3gsIHksIHpdKTogVjMgPT4geyBjb25zdCByID0gaGVhZFIoTWF0aC5tYXgoMC4wNiwgKHkgLSB5MCkgLyBocykpICogaHMgKiAxLjIgKyAwLjAxMiAqIGhzOyByZXR1cm4gW3ggKiByLCB5LCB6ICogciAtIDAuMDEyICogaHNdOyB9KTtcbiAgICAgIGNvbnN0IFIyID0gcmluZyg2LCBSKDAuMjQsIDEuMjQpLCBSKDAuMjQsIDEuMiksIHkwICsgMC4yNCAqIGhzLCAwLCAwLCAtMC4wMiAqIGhzKTtcbiAgICAgIGYuYWRkKGxvZnQoW1IxLCBSMl0sICdub25lJywgWzAsIHkwICsgMC4zNDUgKiBocywgLTAuMDMgKiBoc10sIGMpLCBQVF9IRUFELCBTX1RPUCwgb3B0LCBwaXYpO1xuICAgICAgaWYgKGtpbmQgPT09ICdwYXJrYWhvb2QnKSBmLmFkZChnZW0oMCwgeTAgKyAwLjI3ICogaHMsIDAuMDg1ICogaHMsIDAuMSAqIGhzLCAwLjAzNSAqIGhzLCA2KSwgUFRfSEVBRCwgU19XSElURSwgb3B0LCBwaXYpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCBhcmNoZXR5cGVzIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuaW50ZXJmYWNlIExvb2sgeyBza2luOiBzdHJpbmc7IHRvcDogc3RyaW5nOyBib3R0b206IHN0cmluZzsgaGFpcjogc3RyaW5nOyBhY2M6IHN0cmluZzsgc2hvZTogbnVtYmVyOyBtYXNrOiBudW1iZXIgfVxuaW50ZXJmYWNlIEFyY2gge1xuICBpZDogc3RyaW5nO1xuICBidWlsZChmOiBGaWcpOiB2b2lkO1xuICAvKiogbWV0cmVzIHBlciBzdGVwIGF0IHNjYWxlIDEgKHBoYXNlIGxvY2tzIHRvIHNwZWVkKSAqL1xuICBzdHJpZGU6IG51bWJlcjtcbiAgLyoqIHdhbGsgc3dpbmcgYW1wbGl0dWRlIG11bHRpcGxpZXIgKi9cbiAgc3dpbmc6IG51bWJlcjtcbiAgLyoqIG1pbGxpbmcgc3BlZWQgbXVsdGlwbGllciAqL1xuICBwYWNlOiBudW1iZXI7XG4gIC8qKiBMT0QgZmlndXJlIHNjYWxlICh0aGUgTE9EIG1lc2ggaXMgYWR1bHQtc2l6ZWQpICovXG4gIGxvZDogbnVtYmVyO1xuICAvKiogbWlkLWZpZ3VyZSBzdHlsZSBiaXRzIChpQzMudyk6IDEgPSBza2lydCBpbiB0aGUgYm90dG9tIGNvbG91ciwgMiA9IGxvbmcgY29hdCBpbiB0aGUgdG9wIGNvbG91ciAqL1xuICBtaWQ/OiBudW1iZXI7XG4gIGxvb2soYjogQmlvbWVJZCk6IExvb2s7XG59XG5cbmNvbnN0IHBpY2sgPSA8VCw+KGE6IHJlYWRvbmx5IFRbXSk6IFQgPT4gYVsoTWF0aC5yYW5kb20oKSAqIGEubGVuZ3RoKSB8IDBdO1xuY29uc3QgY2hhbmNlID0gKHA6IG51bWJlcik6IGJvb2xlYW4gPT4gTWF0aC5yYW5kb20oKSA8IHA7XG5cbmNvbnN0IFNLSU4gPSBbJyNmM2QyYjMnLCAnI2UyYjQ4ZicsICcjYzk4ZTY2JywgJyM5YzZhNDgnLCAnIzZlNGEzMycsICcjZjZkY2M0J107XG5jb25zdCBIQUlSID0gWycjMmEyMjI2JywgJyM0YTMyMjYnLCAnIzZmNGEzMCcsICcjYTA1ODJlJywgJyNkOWIzNmEnLCAnIzJhMjIyNicsICcjM2EyYTI0J107XG5jb25zdCBIQUlSX09MRCA9IFsnI2JkYjhiMCcsICcjZTZlMWQ4JywgJyM5YTk0OGQnXTtcbmNvbnN0IEhBSVJfRlVOID0gWycjZmY4ZmMxJywgJyM2ZmM4ZmYnLCAnI2I5OGJmZicsICcjN2FkOTdhJ107XG4vLyBHUklELUVBU1QgY2l0eSBwb3AgKG5vIG9mZi13aGl0ZSB0b3BzLCBubyBzYWZldHkgb3JhbmdlIOKAlCB0aGF0IGlzIHRoZSBhbmRyb2lkcycgbGl2ZXJ5KVxuY29uc3QgR0VfVE9QID0gWycjZmY2ZjVlJywgJyNmZmQxNjYnLCAnIzNmYjhmZicsICcjN2FkOTdhJywgJyNiOThiZmYnLCAnI2ZmOWVjNycsICcjNDRkMmMyJywgJyNlODRhM2MnLCAnIzViN2NmZicsICcjZjdlMjdhJywgJyM5YmUxZmYnLCAnI2MzZjA3YSddO1xuY29uc3QgR0VfQk9UVE9NID0gWycjNGE2ZmE1JywgJyM1Yjg0YzQnLCAnI2I1NjU0YScsICcjYzhiMDhhJywgJyM0YTQ1NTAnLCAnIzJmMmIzNicsICcjOGE2ZmIwJywgJyM2YTlhOGEnXTtcbmNvbnN0IFNVSVQgPSBbJyM0YTQ1NTAnLCAnIzVkNmI3YScsICcjYjg5YjcyJywgJyM3YTM0NDQnLCAnIzNlNmI1NScsICcjOGE4Zjk5JywgJyM2YjVhOGEnXTtcbmNvbnN0IFRJRSA9IFsnI2U4NGEzYycsICcjZmZkMTY2JywgJyMzZmI4ZmYnLCAnI2ZmNmY1ZScsICcjYjk4YmZmJywgJyM0NGQyYzInLCAnI2ZmOWVjNyddO1xuY29uc3QgQUNDX0dFID0gWycjZmY2ZjVlJywgJyNmZmQxNjYnLCAnIzNmYjhmZicsICcjN2FkOTdhJywgJyNiOThiZmYnLCAnI2ZmOWVjNycsICcjNDRkMmMyJywgJyNlODRhM2MnXTtcbi8vIFdISVRFIFNUQUNLUyDigJQgd2ludGVyIHdhcmRyb2JlXG5jb25zdCBXU19DT0FUID0gWycjZDk0ODNiJywgJyMyZjhmOGEnLCAnI2Q5YTUyYicsICcjN2I0YTdhJywgJyMzZTZiNTUnLCAnIzRmOGZkMCcsICcjYzI0ZDZlJywgJyM4YTVhM2EnXTtcbmNvbnN0IFdTX1NISVJUID0gWycjOGUzYjM1JywgJyM0ZjZkOGYnLCAnIzZiN2EzZScsICcjN2E1YTNhJywgJyM1ZDZiN2EnLCAnI2EwNGE1YSddO1xuY29uc3QgV1NfQk9UVE9NID0gWycjNGE0NTUwJywgJyM1YTQ2MzYnLCAnIzRhNmZhNScsICcjMmYyYjM2JywgJyM2YjZmNzYnLCAnIzZhNWE0OCddO1xuY29uc3QgV1NfS05JVCA9IFsnI2U4NGEzYycsICcjZmZkMTY2JywgJyM0NGQyYzInLCAnI2I5OGJmZicsICcjZmY5ZWM3JywgJyM3YWQ5N2EnLCAnIzNmYjhmZiddO1xuY29uc3QgSElWSVMgPSBbJyNkNGY1M2MnLCAnI2M2ZjAzYScsICcjZTNmYTU1J107XG5jb25zdCBIQVJESEFUID0gWycjZmZkMjNmJywgJyM0NGQyYzInLCAnI2U4NGEzYycsICcjM2ZiOGZmJywgJyM3YWQ5N2EnXTtcbi8vIExPQ0tXQVRFUiDigJQgbmlnaHQgcmFpbjogYnJpZ2h0IHNsaWNrZXJzIHJlYWQgYWdhaW5zdCB0aGUgZGFyayB3YXRlclxuY29uc3QgTFdfU0xJQ0sgPSBbJyNmZmQyM2YnLCAnI2U4NGEzYycsICcjZmY2ZmFlJywgJyMzNmM5YzYnLCAnIzhmZDE0ZicsICcjYjk4YmZmJywgJyNmZmUwNjYnXTtcbmNvbnN0IExXX1VNQiA9IFsnI2ZmM2ZhNCcsICcjM2ZmMGZmJywgJyNmZmQyM2YnLCAnI2U4NGEzYycsICcjYjk4YmZmJywgJyM3YWQ5N2EnLCAnIzM2YzljNiddO1xuY29uc3QgTFdfVE9QID0gWycjNmI3YThhJywgJyM4ZTNiMzUnLCAnIzNmNWE0YScsICcjNWI3Y2ZmJywgJyNmZjZmYWUnLCAnIzQ0ZDJjMicsICcjOWFhNGFkJywgJyNjMjRkNmUnXTtcbmNvbnN0IExXX0JPVFRPTSA9IFsnIzRhNmZhNScsICcjNmI3YTNlJywgJyM1YTQ2MzYnLCAnIzJmMmIzNicsICcjNGE0NTUwJ107XG5cbmZ1bmN0aW9uIGhhaXJPckhhdChwSGF0OiBudW1iZXIsIHBIYXRCOiBudW1iZXIsIHBCOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCByID0gTWF0aC5yYW5kb20oKTtcbiAgaWYgKHIgPCBwSGF0KSByZXR1cm4gYml0KE9fSEFUX0EpO1xuICBpZiAociA8IHBIYXQgKyBwSGF0QikgcmV0dXJuIGJpdChPX0hBVF9CKTtcbiAgcmV0dXJuIGNoYW5jZShwQikgPyBiaXQoT19IQUlSX0IpIDogYml0KE9fSEFJUl9BKTtcbn1cbmNvbnN0IGhhaXJDb2wgPSAoKTogc3RyaW5nID0+IChjaGFuY2UoMC4wOCkgPyBwaWNrKEhBSVJfRlVOKSA6IHBpY2soSEFJUikpO1xuLyoqIHRoZSBoZWFkd2VhciBjb2xvdXIgZG91YmxlcyBhcyB0aGUgaGFpciBjb2xvdXIgKGhhaXIgaXMgaGlkZGVuIHVuZGVyIGEgaGF0KSAqL1xuZnVuY3Rpb24gaGVhZENvbChtYXNrOiBudW1iZXIsIGhhdEE6ICgpID0+IHN0cmluZywgaGF0QjogKCkgPT4gc3RyaW5nLCBoYWlyQzogKCkgPT4gc3RyaW5nID0gaGFpckNvbCk6IHN0cmluZyB7XG4gIGlmIChtYXNrICYgYml0KE9fSEFUX0EpKSByZXR1cm4gaGF0QSgpO1xuICBpZiAobWFzayAmIGJpdChPX0hBVF9CKSkgcmV0dXJuIGhhdEIoKTtcbiAgcmV0dXJuIGhhaXJDKCk7XG59XG5cbi8qKiB0aGluIDMtc2lkZWQgcm9kIGJldHdlZW4gdHdvIHBvaW50cyAoY2FuZXMsIHNoYWZ0cywgc3RyaW5ncykgKi9cbmZ1bmN0aW9uIHJvZChhOiBWMywgYjogVjMsIHI6IG51bWJlcik6IG51bWJlcltdIHtcbiAgY29uc3QgZGlyID0gbmV3IFRIUkVFLlZlY3RvcjMoYlswXSAtIGFbMF0sIGJbMV0gLSBhWzFdLCBiWzJdIC0gYVsyXSk7XG4gIGNvbnN0IGxlbiA9IGRpci5sZW5ndGgoKTsgZGlyLm5vcm1hbGl6ZSgpO1xuICBjb25zdCBxID0gbmV3IFRIUkVFLlF1YXRlcm5pb24oKS5zZXRGcm9tVW5pdFZlY3RvcnMobmV3IFRIUkVFLlZlY3RvcjMoMCwgMSwgMCksIGRpcik7XG4gIGNvbnN0IG0gPSBuZXcgVEhSRUUuTWF0cml4NCgpLmNvbXBvc2UobmV3IFRIUkVFLlZlY3RvcjMoYVswXSwgYVsxXSwgYVsyXSksIHEsIG5ldyBUSFJFRS5WZWN0b3IzKDEsIDEsIDEpKTtcbiAgcmV0dXJuIHhmKGxvZnQoW3JpbmcoMywgciwgciwgMCksIHJpbmcoMywgciwgciwgbGVuKV0sICdub25lJywgJ25vbmUnKSwgbSk7XG59XG5cbi8qKiBmbGF0IHN0cmlwIChiYWcgc3RyYXBzKSBmcm9tIGEgdG8gYiwgd2lkdGggdywgbHlpbmcgb24gdGhlIHotZmFjaW5nIHBsYW5lIGF0IGRlcHRoIHogKi9cbmZ1bmN0aW9uIHN0cmFwKGF4OiBudW1iZXIsIGF5OiBudW1iZXIsIGJ4OiBudW1iZXIsIGJ5OiBudW1iZXIsIHc6IG51bWJlciwgejA6IG51bWJlciwgejE6IG51bWJlcik6IG51bWJlcltdIHtcbiAgY29uc3QgZHggPSBieCAtIGF4LCBkeSA9IGJ5IC0gYXksIGwgPSBNYXRoLmh5cG90KGR4LCBkeSkgfHwgMTtcbiAgY29uc3QgbnggPSAoLWR5IC8gbCkgKiB3ICogMC41LCBueSA9IChkeCAvIGwpICogdyAqIDAuNTtcbiAgcmV0dXJuIGV4dHJ1ZGVYWShbYXggKyBueCwgYXkgKyBueSwgYXggLSBueCwgYXkgLSBueSwgYnggLSBueCwgYnkgLSBueSwgYnggKyBueCwgYnkgKyBueV0sIHowLCB6MSk7XG59XG5cbmNvbnN0IEFSQ0g6IFJlY29yZDxzdHJpbmcsIEFyY2g+ID0ge1xuICBvZmZpY2U6IHtcbiAgICBpZDogJ29mZmljZScsIHN0cmlkZTogMC42Miwgc3dpbmc6IDAuOSwgcGFjZTogMS4wNSwgbG9kOiAxLFxuICAgIGJ1aWxkKGYpIHtcbiAgICAgIGNvbnN0IGQgPSBkaW1zKDEpO1xuICAgICAgbGVncyhmLCBkLCB7fSk7XG4gICAgICBwZWx2aXMoZiwgZCwgU19UT1AsIDAuNiwgMC44KTsgICAgICAgICAgICAvLyBqYWNrZXQgaGVtIG92ZXIgdGhlIGhpcHNcbiAgICAgIHRvcnNvKGYsIGQsIFNfVE9QKTtcbiAgICAgIC8vIHNoaXJ0IFYgKyB0aWVcbiAgICAgIGYuYWRkKGV4dHJ1ZGVYWShbLTAuMDUyLCAxLjE0LCAwLjA1MiwgMS4xNCwgMCwgMC45ODVdLCAwLjA2NiwgMC4wOTQpLCBQVF9CT0RZLCBTX1dISVRFKTtcbiAgICAgIGYuYWRkKGV4dHJ1ZGVYWShbMCwgMS4xLCAwLjAyOCwgMS4wNSwgMCwgMC44MiwgLTAuMDI4LCAxLjA1XSwgMC4wOCwgMC4xMDQpLCBQVF9CT0RZLCBTX0FDQywgT19FWFRSQSk7XG4gICAgICBhcm1zKGYsIGQsIHsgc2xlZXZlOiAnbG9uZycgfSk7XG4gICAgICBoZWFkKGYsIGQpO1xuICAgICAgaGFpcihmLCBkLCAnc2hvcnQnLCBPX0hBSVJfQSk7IGhhaXIoZiwgZCwgJ2xvbmcnLCBPX0hBSVJfQik7XG4gICAgICAvLyBicmllZmNhc2UgaW4gdGhlIGxlZnQgaGFuZFxuICAgICAgY29uc3QgaCA9IGhhbmRBdChkLCAxKTtcbiAgICAgIGYuYWRkKGJveChoWzBdICsgMC4wMTIsIGhbMV0gLSAwLjExLCBoWzJdLCAwLjA2NSwgMC4yLCAwLjI4KSwgUFRfTEZPUkUsIFNfTEVBVEhFUiwgT19CQUcsIFtkLnNoWCwgZC5zaFksIDBdLCBlbGJvd0F0KGQsIDEpKTtcbiAgICB9LFxuICAgIGxvb2soYikge1xuICAgICAgY29uc3QgbWFzayA9IGhhaXJPckhhdCgwLCAwLCAwLjM1KSB8IChjaGFuY2UoMC43KSA/IGJpdChPX0VYVFJBKSA6IDApIHwgKGNoYW5jZSgwLjQ1KSA/IGJpdChPX0JBRykgOiAwKTtcbiAgICAgIGNvbnN0IHN1aXQgPSBiID09PSAnbG9ja3dhdGVyJyA/IHBpY2soWycjNGE0NTUwJywgJyM1ZDZiN2EnLCAnIzZiNWE4YScsICcjM2U2YjU1JywgJyM3YTM0NDQnXSkgOiBiID09PSAnd2hpdGVzdGFja3MnID8gcGljayhbJyM0YTQ1NTAnLCAnIzdhMzQ0NCcsICcjNWE0NjM2JywgJyMzZTZiNTUnXSkgOiBwaWNrKFNVSVQpO1xuICAgICAgcmV0dXJuIHsgc2tpbjogcGljayhTS0lOKSwgdG9wOiBzdWl0LCBib3R0b206IGNoYW5jZSgwLjcpID8gc3VpdCA6IHBpY2soWycjNGE0NTUwJywgJyMyZjJiMzYnLCAnI2M4YjA4YSddKSwgaGFpcjogaGFpckNvbCgpLCBhY2M6IHBpY2soVElFKSwgc2hvZTogcGljayhbMCwgMSwgMF0pLCBtYXNrIH07XG4gICAgfSxcbiAgfSxcbiAgY2FzdWFsOiB7XG4gICAgaWQ6ICdjYXN1YWwnLCBzdHJpZGU6IDAuNjIsIHN3aW5nOiAxLCBwYWNlOiAxLCBsb2Q6IDEsXG4gICAgYnVpbGQoZikge1xuICAgICAgY29uc3QgZCA9IGRpbXMoMSk7XG4gICAgICBsZWdzKGYsIGQsIHt9KTtcbiAgICAgIHBlbHZpcyhmLCBkLCBTX0JPVFRPTSk7XG4gICAgICB0b3JzbyhmLCBkLCBTX1RPUCk7XG4gICAgICBhcm1zKGYsIGQsIHsgc2xlZXZlOiAnc2hvcnQnIH0pO1xuICAgICAgaGVhZChmLCBkKTtcbiAgICAgIGhhaXIoZiwgZCwgJ3Nob3J0JywgT19IQUlSX0EpOyBoYWlyKGYsIGQsICdsb25nJywgT19IQUlSX0IpO1xuICAgICAgaGF0KGYsIGQsICdjYXAnLCBPX0hBVF9BKTsgaGF0KGYsIGQsICdiZWFuaWUnLCBPX0hBVF9CKTtcbiAgICAgIGYuYWRkKGJveCgwLCAwLjkzLCAtMC4xMzUsIDAuMjIsIDAuMjcsIDAuMSwgMC45KSwgUFRfQk9EWSwgU19BQ0MsIE9fQkFHKTsgICAgICAgICAgICAgICAgICAgLy8gYmFja3BhY2tcbiAgICB9LFxuICAgIGxvb2soYikge1xuICAgICAgY29uc3QgY29sZCA9IGIgPT09ICd3aGl0ZXN0YWNrcyc7XG4gICAgICBjb25zdCBtYXNrID0gaGFpck9ySGF0KGNvbGQgPyAwLjA4IDogMC4yNSwgY29sZCA/IDAuNCA6IDAuMDQsIDAuNCkgfCAoY2hhbmNlKDAuMzUpID8gYml0KE9fQkFHKSA6IDApO1xuICAgICAgY29uc3QgdG9wID0gYiA9PT0gJ2dyaWRlYXN0JyA/IHBpY2soR0VfVE9QKSA6IGNvbGQgPyBwaWNrKFdTX0NPQVQpIDogcGljayhMV19UT1ApO1xuICAgICAgY29uc3QgYWNjID0gYiA9PT0gJ2xvY2t3YXRlcicgPyBwaWNrKExXX1NMSUNLKSA6IHBpY2soQUNDX0dFKTtcbiAgICAgIHJldHVybiB7IHNraW46IHBpY2soU0tJTiksIHRvcCwgYm90dG9tOiBwaWNrKGIgPT09ICdncmlkZWFzdCcgPyBHRV9CT1RUT00gOiBjb2xkID8gV1NfQk9UVE9NIDogTFdfQk9UVE9NKSwgaGFpcjogaGVhZENvbChtYXNrLCAoKSA9PiBwaWNrKEFDQ19HRSksICgpID0+IHBpY2soV1NfS05JVCkpLCBhY2MsIHNob2U6IHBpY2soWzIsIDIsIDAsIDMsIDFdKSwgbWFzayB9O1xuICAgIH0sXG4gIH0sXG4gIGtpZDoge1xuICAgIGlkOiAna2lkJywgc3RyaWRlOiAwLjQyLCBzd2luZzogMS4xNSwgcGFjZTogMS4xLCBsb2Q6IDAuNjgsXG4gICAgYnVpbGQoZikge1xuICAgICAgY29uc3QgZCA9IGRpbXMoMC42NiwgMS4zMiwgMS4wNSk7XG4gICAgICBsZWdzKGYsIGQsIHsgc2tpbkZyb206IDAuMzMsIHI6IDEuMSB9KTtcbiAgICAgIHBlbHZpcyhmLCBkLCBTX0JPVFRPTSk7XG4gICAgICB0b3JzbyhmLCBkLCBTX1RPUCwgW1swLjc0LCAwLjE0MiwgMC4xXSwgWzEuMDMsIDAuMTYsIDAuMTA1XSwgWzEuMTcsIDAuMTE1LCAwLjA4Ml1dKTtcbiAgICAgIGFybXMoZiwgZCwgeyBzbGVldmU6ICdzaG9ydCcsIHI6IDEuMTIgfSk7XG4gICAgICBoZWFkKGYsIGQpO1xuICAgICAgaGFpcihmLCBkLCAnY3JvcCcsIE9fSEFJUl9BKTtcbiAgICAgIGhhdChmLCBkLCAnY2FwJywgT19IQVRfQSk7IGhhdChmLCBkLCAnYmVhbmllJywgT19IQVRfQik7XG4gICAgICAvLyBiYWxsb29uIG9uIGEgc3RyaW5nLCBoZWxkIHVwIGluIHRoZSBsZWZ0IGhhbmQgKGF1dGhvcmVkIGluIHRoZSBoZWxkIHBvc2UpXG4gICAgICBjb25zdCBTOiBWMyA9IFtkLnNoWCwgZC5zaFksIDBdO1xuICAgICAgY29uc3QgaHEgPSB4ZihbLi4uaGFuZEF0KGQsIDEpXSwgYWJvdXQoUywgbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25YKEJBTF9SWCkubXVsdGlwbHkocm90WihCQUxfUlopKSkpO1xuICAgICAgY29uc3QgaHA6IFYzID0gW2hxWzBdLCBocVsxXSwgaHFbMl1dO1xuICAgICAgY29uc3QgdG9wOiBWMyA9IFtocFswXSArIDAuMDUsIGhwWzFdICsgMC41NiwgaHBbMl0gLSAwLjA0XTtcbiAgICAgIGYuYWRkKHVucG9zZShyb2QoaHAsIHRvcCwgMC4wMDYpLCBTLCBCQUxfUlgsIEJBTF9SWiksIFBUX0xBUk0sIFNfSU5LLCBPX0JBTExPT04sIFMpO1xuICAgICAgY29uc3QgYmFsID0gbG9mdChbcmluZyg2LCAwLjA4NSwgMC4wODUsIHRvcFsxXSArIDAuMDYsIDAsIHRvcFswXSwgdG9wWzJdKSwgcmluZyg2LCAwLjEzLCAwLjEzLCB0b3BbMV0gKyAwLjE2LCAwLCB0b3BbMF0sIHRvcFsyXSksIHJpbmcoNiwgMC4xMSwgMC4xMSwgdG9wWzFdICsgMC4yNywgMCwgdG9wWzBdLCB0b3BbMl0pXSxcbiAgICAgICAgW3RvcFswXSwgdG9wWzFdIC0gMC4wMSwgdG9wWzJdXSwgW3RvcFswXSwgdG9wWzFdICsgMC4zMzUsIHRvcFsyXV0pO1xuICAgICAgZi5hZGQodW5wb3NlKGJhbCwgUywgQkFMX1JYLCBCQUxfUlopLCBQVF9MQVJNLCBTX0FDQywgT19CQUxMT09OLCBTKTtcbiAgICB9LFxuICAgIGxvb2soYikge1xuICAgICAgY29uc3QgbWFzayA9IGhhaXJPckhhdChiID09PSAnd2hpdGVzdGFja3MnID8gMC4wNSA6IDAuMjIsIGIgPT09ICd3aGl0ZXN0YWNrcycgPyAwLjU1IDogMC4wNCwgMCkgfCAoY2hhbmNlKGIgPT09ICdncmlkZWFzdCcgPyAwLjM1IDogMC4xNSkgPyBiaXQoT19CQUxMT09OKSA6IDApO1xuICAgICAgY29uc3QgdG9wID0gYiA9PT0gJ2dyaWRlYXN0JyA/IHBpY2soR0VfVE9QKSA6IGIgPT09ICd3aGl0ZXN0YWNrcycgPyBwaWNrKFdTX0NPQVQpIDogcGljayhMV19TTElDSyk7XG4gICAgICByZXR1cm4geyBza2luOiBwaWNrKFNLSU4pLCB0b3AsIGJvdHRvbTogcGljayhiID09PSAnZ3JpZGVhc3QnID8gR0VfQk9UVE9NIDogV1NfQk9UVE9NKSwgaGFpcjogaGVhZENvbChtYXNrLCAoKSA9PiBwaWNrKEFDQ19HRSksICgpID0+IHBpY2soV1NfS05JVCkpLCBhY2M6IHBpY2soYiA9PT0gJ2xvY2t3YXRlcicgPyBMV19VTUIgOiBBQ0NfR0UpLCBzaG9lOiBiID09PSAnbG9ja3dhdGVyJyA/IDQgOiBwaWNrKFsyLCAzLCAyXSksIG1hc2sgfTtcbiAgICB9LFxuICB9LFxuICBlbGRlcjoge1xuICAgIGlkOiAnZWxkZXInLCBzdHJpZGU6IDAuNDIsIHN3aW5nOiAwLjU1LCBwYWNlOiAwLjYsIGxvZDogMC45NSxcbiAgICBidWlsZChmKSB7XG4gICAgICBjb25zdCBkID0gZGltcygwLjk3LCAxLjAyLCAxLjA0KTtcbiAgICAgIGxlZ3MoZiwgZCwge30pO1xuICAgICAgcGVsdmlzKGYsIGQsIFNfQk9UVE9NKTtcbiAgICAgIGYubWF0ID0gYWJvdXQoWzAsIGQuaGlwWSwgMF0sIHJvdFgoMC4yKSk7ICAgIC8vIHN0b29wXG4gICAgICB0b3JzbyhmLCBkLCBTX1RPUCwgW1swLjc0LCAwLjE0MiwgMC4wOTZdLCBbMS4wLCAwLjE2MiwgMC4xMTJdLCBbMS4xNiwgMC4xMTUsIDAuMDg0XV0pO1xuICAgICAgZi5hZGQoZXh0cnVkZVhZKFstMC4wNDUsIDEuMTIsIDAuMDQ1LCAxLjEyLCAwLCAxLjAxXSwgMC4wNzIsIDAuMTAyKSwgUFRfQk9EWSwgU19XSElURSk7ICAgLy8gY29sbGFyXG4gICAgICBhcm1zKGYsIGQsIHsgc2xlZXZlOiAnbG9uZycsIHNwbGF5OiAwLjA4IH0pO1xuICAgICAgaGVhZChmLCBkKTtcbiAgICAgIGhhaXIoZiwgZCwgJ2Nyb3AnLCBPX0hBSVJfQSk7IGhhaXIoZiwgZCwgJ2J1bicsIE9fSEFJUl9CKTtcbiAgICAgIGhhdChmLCBkLCAnZmxhdGNhcCcsIE9fSEFUX0EpOyBoYXQoZiwgZCwgJ3N1bmhhdCcsIE9fSEFUX0IpO1xuICAgICAgLy8gd2Fsa2luZyBjYW5lIGluIHRoZSByaWdodCBoYW5kXG4gICAgICBjb25zdCBoID0gaGFuZEF0KGQsIC0xLCAwLjA4KTtcbiAgICAgIGYuYWRkKHJvZChbaFswXSwgaFsxXSArIDAuMDIsIGhbMl0gKyAwLjA3XSwgW2hbMF0sIDAuMDIgLSAwLjE1LCBoWzJdICsgMC4xMl0sIDAuMDE2KSwgUFRfUkZPUkUsIFNfTEVBVEhFUiwgT19FWFRSQSwgWy1kLnNoWCwgZC5zaFksIDBdLCBlbGJvd0F0KGQsIC0xLCAwLjA4KSk7XG4gICAgICBmLm1hdCA9IG51bGw7XG4gICAgfSxcbiAgICBsb29rKGIpIHtcbiAgICAgIGNvbnN0IG1hc2sgPSBoYWlyT3JIYXQoMC4zNSwgMC4xNSwgMC4zKSB8IChjaGFuY2UoMC42KSA/IGJpdChPX0VYVFJBKSA6IDApO1xuICAgICAgY29uc3QgdG9wID0gYiA9PT0gJ3doaXRlc3RhY2tzJyA/IHBpY2soV1NfQ09BVCkgOiBwaWNrKFsnI2IwNzg1YScsICcjN2E4ZjZhJywgJyM4YTZmYjAnLCAnI2M5YTg2YScsICcjNmY4ZmIwJywgJyNhMDVhNWEnXSk7XG4gICAgICByZXR1cm4geyBza2luOiBwaWNrKFNLSU4pLCB0b3AsIGJvdHRvbTogcGljayhbJyM2YjZmNzYnLCAnIzVhNDYzNicsICcjYzhiMDhhJywgJyM0YTQ1NTAnXSksIGhhaXI6IGhlYWRDb2wobWFzaywgKCkgPT4gcGljayhbJyM2YjVhNGEnLCAnIzVkNmI3YScsICcjOGE2YTRhJ10pLCAoKSA9PiBwaWNrKFsnI2U4ZDliMCcsICcjZjBjMGM4JywgJyNjOWUwZjAnXSksICgpID0+IHBpY2soSEFJUl9PTEQpKSwgYWNjOiBwaWNrKEFDQ19HRSksIHNob2U6IHBpY2soWzEsIDBdKSwgbWFzayB9O1xuICAgIH0sXG4gIH0sXG4gIGNvdXJpZXI6IHtcbiAgICBpZDogJ2NvdXJpZXInLCBzdHJpZGU6IDAuNjQsIHN3aW5nOiAxLjA1LCBwYWNlOiAxLjM1LCBsb2Q6IDEsXG4gICAgYnVpbGQoZikge1xuICAgICAgY29uc3QgZCA9IGRpbXMoMSk7XG4gICAgICBsZWdzKGYsIGQsIHsgc2tpbkZyb206IDAuNDYgfSk7XG4gICAgICBwZWx2aXMoZiwgZCwgU19CT1RUT00pO1xuICAgICAgdG9yc28oZiwgZCwgU19UT1ApO1xuICAgICAgYXJtcyhmLCBkLCB7IHNsZWV2ZTogJ3Nob3J0JyB9KTtcbiAgICAgIGhlYWQoZiwgZCk7XG4gICAgICBoYXQoZiwgZCwgJ2NhcCcsIDAsIFNfQUNDKTtcbiAgICAgIC8vIG1lc3NlbmdlciBiYWcgb24gdGhlIHJpZ2h0IGhpcCArIHN0cmFwIGFjcm9zcyB0aGUgY2hlc3RcbiAgICAgIGYuYWRkKGJveCgtMC4xNzUsIDAuNzQsIDAuMDIsIDAuMDg1LCAwLjE3LCAwLjI1KSwgUFRfQk9EWSwgU19BQ0MpO1xuICAgICAgZi5hZGQoc3RyYXAoMC4xMywgMS4xNSwgLTAuMTUsIDAuOCwgMC4wNDUsIDAuMDgzLCAwLjEwNSksIFBUX0JPRFksIFNfQUNDKTtcbiAgICB9LFxuICAgIGxvb2soYikge1xuICAgICAgY29uc3QgYWNjID0gcGljayhiID09PSAnbG9ja3dhdGVyJyA/IExXX1NMSUNLIDogWycjZmZkMTY2JywgJyM3YWQ5N2EnLCAnIzNmYjhmZicsICcjZTg0YTNjJywgJyNiOThiZmYnLCAnIzQ0ZDJjMiddKTtcbiAgICAgIGNvbnN0IHRvcCA9IGIgPT09ICd3aGl0ZXN0YWNrcycgPyBwaWNrKFdTX0NPQVQpIDogYiA9PT0gJ2xvY2t3YXRlcicgPyBwaWNrKExXX1RPUCkgOiBwaWNrKFsnIzQ0ZDJjMicsICcjNWI3Y2ZmJywgJyNmZjllYzcnLCAnIzdhZDk3YScsICcjYjk4YmZmJywgJyNmN2UyN2EnLCAnIzNmYjhmZiddKTtcbiAgICAgIC8vIHRoZSBjYXAgaXMgYWx3YXlzIHdvcm4gKGJpdCBvbmx5IGRyaXZlcyB0aGUgZmFyL21pZCBmaWd1cmVzJyBnZW5lcmljIGhhdClcbiAgICAgIHJldHVybiB7IHNraW46IHBpY2soU0tJTiksIHRvcCwgYm90dG9tOiBwaWNrKFsnIzRhNDU1MCcsICcjMmYyYjM2JywgJyM2YjdhM2UnLCAnI2M4YjA4YSddKSwgaGFpcjogYWNjLCBhY2MsIHNob2U6IHBpY2soWzIsIDAsIDNdKSwgbWFzazogYml0KE9fSEFUX0EpIH07XG4gICAgfSxcbiAgfSxcbiAgZHJlc3M6IHtcbiAgICBpZDogJ2RyZXNzJywgc3RyaWRlOiAwLjU2LCBzd2luZzogMC43OCwgcGFjZTogMC45NSwgbG9kOiAwLjk4LCBtaWQ6IDEsXG4gICAgYnVpbGQoZikge1xuICAgICAgY29uc3QgZCA9IGRpbXMoMC45OCwgMS4wMiwgMC45NSk7XG4gICAgICBsZWdzKGYsIGQsIHsgc2tpbkZyb206IDAuNSwgcjogMC45IH0pO1xuICAgICAgLy8gQS1saW5lIHNraXJ0IGZyb20gdGhlIHdhaXN0IHRvIHRoZSBrbmVlXG4gICAgICBmLmFkZChsb2Z0KFtyaW5nKDYsIDAuMTMsIDAuMDkyLCAwLjc5LCBIRVgpLCByaW5nKDYsIDAuMjEsIDAuMTgsIDAuNDYsIEhFWCldLCAnbm9uZScsICdjYXAnKSwgUFRfQk9EWSwgU19CT1RUT00pO1xuICAgICAgdG9yc28oZiwgZCwgU19UT1AsIFtbMC43NCwgMC4xMjUsIDAuMDg2XSwgWzEuMDMsIDAuMTUyLCAwLjA5N10sIFsxLjE3LCAwLjExLCAwLjA3NF1dKTtcbiAgICAgIGFybXMoZiwgZCwgeyBzbGVldmU6ICdzaG9ydCcsIHI6IDAuOTIgfSk7XG4gICAgICBoZWFkKGYsIGQpO1xuICAgICAgaGFpcihmLCBkLCAnbG9uZycsIE9fSEFJUl9BKTsgaGFpcihmLCBkLCAnYnVuJywgT19IQUlSX0IpO1xuICAgICAgaGF0KGYsIGQsICdzdW5oYXQnLCBPX0hBVF9BKTtcbiAgICAgIC8vIHNob3VsZGVyIGJhZyBhdCB0aGUgbGVmdCBoaXAgb24gYSBzdHJhcFxuICAgICAgZi5hZGQoYm94KDAuMiwgMC43MywgMC4wLCAwLjA3LCAwLjE1LCAwLjIsIDAuODUpLCBQVF9CT0RZLCBTX0FDQywgT19CQUcpO1xuICAgICAgZi5hZGQoc3RyYXAoLTAuMSwgMS4xNSwgMC4xOSwgMC44LCAwLjAzLCAwLjA3OCwgMC4wOTgpLCBQVF9CT0RZLCBTX0FDQywgT19CQUcpO1xuICAgIH0sXG4gICAgbG9vayhiKSB7XG4gICAgICBjb25zdCBtYXNrID0gaGFpck9ySGF0KGIgPT09ICdncmlkZWFzdCcgPyAwLjI1IDogMC4wNSwgMCwgMC40NSkgfCAoY2hhbmNlKDAuNikgPyBiaXQoT19CQUcpIDogMCk7XG4gICAgICBjb25zdCBwYWwgPSBiID09PSAnZ3JpZGVhc3QnID8gR0VfVE9QIDogYiA9PT0gJ3doaXRlc3RhY2tzJyA/IFdTX0NPQVQgOiBMV19UT1A7XG4gICAgICBjb25zdCBkcmVzc0MgPSBwaWNrKHBhbCk7XG4gICAgICByZXR1cm4geyBza2luOiBwaWNrKFNLSU4pLCB0b3A6IGNoYW5jZSgwLjUpID8gZHJlc3NDIDogcGljayhwYWwpLCBib3R0b206IGRyZXNzQywgaGFpcjogaGVhZENvbChtYXNrLCAoKSA9PiBwaWNrKFsnI2YzZDk4YScsICcjZjBjMGM4JywgJyNmZmU4YTAnLCAnI2M5ZTBmMCddKSwgaGFpckNvbCksIGFjYzogcGljayhBQ0NfR0UpLCBzaG9lOiBwaWNrKFszLCAwLCAxLCAyXSksIG1hc2sgfTtcbiAgICB9LFxuICB9LFxuICB3b3JrZXI6IHtcbiAgICBpZDogJ3dvcmtlcicsIHN0cmlkZTogMC42NCwgc3dpbmc6IDAuOTUsIHBhY2U6IDAuOSwgbG9kOiAxLFxuICAgIGJ1aWxkKGYpIHtcbiAgICAgIGNvbnN0IGQgPSBkaW1zKDEuMDIsIDEsIDEuMDYpO1xuICAgICAgbGVncyhmLCBkLCB7IGJvb3RzOiB0cnVlLCByOiAxLjA4IH0pO1xuICAgICAgcGVsdmlzKGYsIGQsIFNfQk9UVE9NKTtcbiAgICAgIHRvcnNvKGYsIGQsIFNfVE9QKTtcbiAgICAgIC8vIGhpLXZpcyB2ZXN0IChvcGVuIHR1YmUganVzdCBvdXRzaWRlIHRoZSB0b3JzbykgKyB0d28gcmVmbGVjdGl2ZSBiYW5kc1xuICAgICAgY29uc3QgcyA9IDEuMDIgKiAxLjA2LCBreiA9IDEuMDI7XG4gICAgICBmLmFkZChsb2Z0KFtyaW5nKDYsIDAuMTQ4ICogcyAqIDEuMDgsIDAuMDk4ICoga3ogKiAxLjEsIDAuNzggKiBreiwgSEVYKSwgcmluZyg2LCAwLjE2MyAqIHMgKiAxLjA4LCAwLjEgKiBreiAqIDEuMSwgMS4wMyAqIGt6LCBIRVgpLCByaW5nKDYsIDAuMTI4ICogcyAqIDEuMDgsIDAuMDg4ICoga3ogKiAxLjEsIDEuMTQgKiBreiwgSEVYKV0sICdub25lJywgJ25vbmUnKSwgUFRfQk9EWSwgU19BQ0MpO1xuICAgICAgZm9yIChjb25zdCBbeSwgcngsIHJ6XSBvZiBbWzAuODUsIDAuMTU2LCAwLjFdLCBbMC45NiwgMC4xNjIsIDAuMTAxXV0gYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXJdW10pIHtcbiAgICAgICAgZi5hZGQobG9mdChbcmluZyg2LCByeCAqIHMgKiAxLjEsIHJ6ICoga3ogKiAxLjEyLCB5ICoga3osIEhFWCksIHJpbmcoNiwgcnggKiBzICogMS4xLCByeiAqIGt6ICogMS4xMiwgKHkgKyAwLjAzNSkgKiBreiwgSEVYKV0sICdub25lJywgJ25vbmUnKSwgUFRfQk9EWSwgU19XSElURSk7XG4gICAgICB9XG4gICAgICBhcm1zKGYsIGQsIHsgc2xlZXZlOiAnbG9uZycsIGhhbmQ6IFNfTEVBVEhFUiwgcjogMS4wNSB9KTtcbiAgICAgIGhlYWQoZiwgZCk7XG4gICAgICBoYXQoZiwgZCwgJ2hhcmRoYXQnLCBPX0hBVF9BKTsgaGF0KGYsIGQsICdiZWFuaWUnLCBPX0hBVF9CKTsgaGFpcihmLCBkLCAnY3JvcCcsIE9fSEFJUl9BKTtcbiAgICB9LFxuICAgIGxvb2soKSB7XG4gICAgICBjb25zdCBtYXNrID0gaGFpck9ySGF0KDAuNzIsIDAuMjIsIDApO1xuICAgICAgcmV0dXJuIHsgc2tpbjogcGljayhTS0lOKSwgdG9wOiBwaWNrKFdTX1NISVJUKSwgYm90dG9tOiBwaWNrKFsnIzVhNDYzNicsICcjNGE0NTUwJywgJyM0YTZmYTUnLCAnIzZiNmY3NiddKSwgaGFpcjogaGVhZENvbChtYXNrLCAoKSA9PiBwaWNrKEhBUkRIQVQpLCAoKSA9PiBwaWNrKFdTX0tOSVQpKSwgYWNjOiBwaWNrKEhJVklTKSwgc2hvZTogNSwgbWFzayB9O1xuICAgIH0sXG4gIH0sXG4gIHBhcmthOiB7XG4gICAgaWQ6ICdwYXJrYScsIHN0cmlkZTogMC41OCwgc3dpbmc6IDAuOCwgcGFjZTogMC45LCBsb2Q6IDEuMDUsXG4gICAgYnVpbGQoZikge1xuICAgICAgY29uc3QgZCA9IGRpbXMoMSwgMSwgMS4xMik7XG4gICAgICBsZWdzKGYsIGQsIHsgcjogMS4wNSwgYm9vdHM6IHRydWUgfSk7XG4gICAgICAvLyBwdWZmeSBxdWlsdGVkIHBhcmthIGZyb20gdGhlIGhpcHMgdG8gdGhlIGNvbGxhclxuICAgICAgdG9yc28oZiwgZCwgU19UT1AsIFtbMC41NiwgMC4xNTUsIDAuMTEyXSwgWzAuNjYsIDAuMTY4LCAwLjEyMl0sIFswLjc2LCAwLjE1MiwgMC4xMTRdLCBbMC45LCAwLjE3MiwgMC4xMjZdLCBbMS4wLCAwLjE1OCwgMC4xMThdLCBbMS4xLCAwLjE3MiwgMC4xMjJdLCBbMS4xOSwgMC4xMSwgMC4wODZdXSwgJ2NhcCcpO1xuICAgICAgYXJtcyhmLCBkLCB7IHNsZWV2ZTogJ2xvbmcnLCByOiAxLjIsIHNwbGF5OiAwLjIsIGhhbmQ6IFNfQUNDIH0pO1xuICAgICAgaGVhZChmLCBkKTtcbiAgICAgIGhhdChmLCBkLCAncGFya2Fob29kJywgT19IQVRfQSk7IGhhdChmLCBkLCAnYmVhbmllJywgT19IQVRfQiwgU19BQ0MpOyBoYWlyKGYsIGQsICdzaG9ydCcsIE9fSEFJUl9BKTtcbiAgICAgIC8vIHNjYXJmOiBhIGNvbGxhciByaW5nICsgYSB0YWlsIGhhbmdpbmcgZG93biB0aGUgY2hlc3RcbiAgICAgIGYuYWRkKGxvZnQoW3JpbmcoNiwgMC4wODIsIDAuMDc4LCAxLjEzLCBIRVgpLCByaW5nKDYsIDAuMDc4LCAwLjA3NCwgMS4yMSwgSEVYKV0sICdub25lJywgJ25vbmUnKSwgUFRfQk9EWSwgU19BQ0MsIE9fRVhUUkEpO1xuICAgICAgZi5hZGQoYm94KDAuMDU1LCAxLjA0LCAwLjExOCwgMC4wNjUsIDAuMTgsIDAuMDMpLCBQVF9CT0RZLCBTX0FDQywgT19FWFRSQSk7XG4gICAgfSxcbiAgICBsb29rKCkge1xuICAgICAgY29uc3QgbWFzayA9IGhhaXJPckhhdCgwLjQsIDAuMzgsIDApIHwgKGNoYW5jZSgwLjU1KSA/IGJpdChPX0VYVFJBKSA6IDApO1xuICAgICAgY29uc3QgdG9wID0gcGljayhXU19DT0FUKSwgYWNjID0gcGljayhXU19LTklUKTtcbiAgICAgIC8vIGhvb2QgPSBjb2F0IGNvbG91ciwgYmVhbmllID0ga25pdCBjb2xvdXIgKHRoZSBTX0hBSVIgY29sb3VyIHRoZW4gb25seSBmZWVkcyB0aGUgbWlkIGZpZ3VyZSdzIGhhdClcbiAgICAgIHJldHVybiB7IHNraW46IHBpY2soU0tJTiksIHRvcCwgYm90dG9tOiBwaWNrKFdTX0JPVFRPTSksIGhhaXI6IGhlYWRDb2wobWFzaywgKCkgPT4gdG9wLCAoKSA9PiBhY2MpLCBhY2MsIHNob2U6IHBpY2soWzUsIDEsIDVdKSwgbWFzayB9O1xuICAgIH0sXG4gIH0sXG4gIHJhaW5jb2F0OiB7XG4gICAgaWQ6ICdyYWluY29hdCcsIHN0cmlkZTogMC42LCBzd2luZzogMC43OCwgcGFjZTogMC45NSwgbG9kOiAxLCBtaWQ6IDIsXG4gICAgYnVpbGQoZikge1xuICAgICAgY29uc3QgZCA9IGRpbXMoMSk7XG4gICAgICBsZWdzKGYsIGQsIHsgYm9vdHM6IHRydWUgfSk7XG4gICAgICAvLyBsb25nIHNsaWNrZXI6IHRvcnNvICsgYSBmbGFyZWQgc2tpcnQgdG8gdGhlIGtuZWVcbiAgICAgIHRvcnNvKGYsIGQsIFNfVE9QKTtcbiAgICAgIGYuYWRkKGxvZnQoW3JpbmcoNiwgMC4xNDUsIDAuMSwgMC44LCBIRVgpLCByaW5nKDYsIDAuMTksIDAuMTQsIDAuNDQsIEhFWCldLCAnbm9uZScsICdjYXAnKSwgUFRfQk9EWSwgU19UT1ApO1xuICAgICAgZi5hZGQoZXh0cnVkZVhZKFstMC4wMTIsIDEuMTQsIDAuMDEyLCAxLjE0LCAwLjAxMiwgMC40NiwgLTAuMDEyLCAwLjQ2XSwgMC4wODQsIDAuMTE4KSwgUFRfQk9EWSwgU19JTkspOyAgLy8gcGxhY2tldFxuICAgICAgYXJtcyhmLCBkLCB7IHNsZWV2ZTogJ2xvbmcnLCByOiAxLjEgfSk7XG4gICAgICBoZWFkKGYsIGQpO1xuICAgICAgaGF0KGYsIGQsICdob29kJywgT19IQVRfQSk7IGhhaXIoZiwgZCwgJ3Nob3J0JywgT19IQUlSX0EpOyBoYWlyKGYsIGQsICdsb25nJywgT19IQUlSX0IpO1xuICAgICAgLy8gdW1icmVsbGEgaW4gdGhlIHJpZ2h0IGhhbmQsIGhlbGQgdXAgb3ZlciB0aGUgaGVhZCAoYXV0aG9yZWQgaW4gdGhlIGhlbGQgcG9zZSlcbiAgICAgIGNvbnN0IFM6IFYzID0gWy1kLnNoWCwgZC5zaFksIDBdO1xuICAgICAgY29uc3QgaHEgPSB4ZihbLi4uaGFuZEF0KGQsIC0xKV0sIGFib3V0KFMsIG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWChVTUJfUlgpLm11bHRpcGx5KHJvdFooVU1CX1JaKSkpKTtcbiAgICAgIGNvbnN0IGhwOiBWMyA9IFtocVswXSwgaHFbMV0sIGhxWzJdXTtcbiAgICAgIGNvbnN0IHRvcDogVjMgPSBbLTAuMDMsIDEuODYsIDAuMDNdO1xuICAgICAgZi5hZGQodW5wb3NlKHJvZChbaHBbMF0sIGhwWzFdIC0gMC4wNiwgaHBbMl1dLCB0b3AsIDAuMDEyKSwgUywgVU1CX1JYLCBVTUJfUlopLCBQVF9SQVJNLCBTX0lOSywgT19VTUIsIFMpO1xuICAgICAgY29uc3QgY3kgPSB0b3BbMV0gLSAwLjEyO1xuICAgICAgY29uc3QgY2FuID0gbG9mdChbcmluZyg2LCAwLjUyLCAwLjUyLCBjeSwgMCwgdG9wWzBdLCB0b3BbMl0pLCByaW5nKDYsIDAuMywgMC4zLCBjeSArIDAuMTIsIDAsIHRvcFswXSwgdG9wWzJdKV0sIFt0b3BbMF0sIGN5ICsgMC4wNSwgdG9wWzJdXSwgW3RvcFswXSwgY3kgKyAwLjIsIHRvcFsyXV0pO1xuICAgICAgZi5hZGQodW5wb3NlKGNhbiwgUywgVU1CX1JYLCBVTUJfUlopLCBQVF9SQVJNLCBTX0FDQywgT19VTUIsIFMpO1xuICAgIH0sXG4gICAgbG9vaygpIHtcbiAgICAgIGNvbnN0IHVtYiA9IGNoYW5jZSgwLjQ1KTtcbiAgICAgIGNvbnN0IG1hc2sgPSAodW1iID8gKGNoYW5jZSgwLjUpID8gYml0KE9fSEFJUl9BKSA6IGJpdChPX0hBSVJfQikpIDogaGFpck9ySGF0KDAuNiwgMCwgMC40KSkgfCAodW1iID8gYml0KE9fVU1CKSA6IDApO1xuICAgICAgY29uc3QgdG9wID0gcGljayhMV19TTElDSyk7XG4gICAgICByZXR1cm4geyBza2luOiBwaWNrKFNLSU4pLCB0b3AsIGJvdHRvbTogcGljayhMV19CT1RUT00pLCBoYWlyOiBoZWFkQ29sKG1hc2ssICgpID0+IHRvcCwgKCkgPT4gdG9wKSwgYWNjOiBwaWNrKExXX1VNQiksIHNob2U6IHBpY2soWzQsIDUsIDNdKSwgbWFzayB9O1xuICAgIH0sXG4gIH0sXG4gIGRvY2s6IHtcbiAgICBpZDogJ2RvY2snLCBzdHJpZGU6IDAuNjQsIHN3aW5nOiAwLjk1LCBwYWNlOiAwLjg1LCBsb2Q6IDEuMDIsXG4gICAgYnVpbGQoZikge1xuICAgICAgY29uc3QgayA9IDEuMDM7XG4gICAgICBjb25zdCBkID0gZGltcyhrLCAwLjk4LCAxLjEpO1xuICAgICAgbGVncyhmLCBkLCB7IGJvb3RzOiB0cnVlLCByOiAxLjEyIH0pO1xuICAgICAgcGVsdmlzKGYsIGQsIFNfQk9UVE9NKTtcbiAgICAgIHRvcnNvKGYsIGQsIFNfVE9QKTtcbiAgICAgIC8vIG92ZXJhbGwgYmliICsgc2hvdWxkZXIgc3RyYXBzXG4gICAgICBmLmFkZChleHRydWRlWFkoWy0wLjA4NSAqIGssIDAuOCAqIGssIDAuMDg1ICogaywgMC44ICogaywgMC4wNzUgKiBrLCAxLjAzICogaywgLTAuMDc1ICogaywgMS4wMyAqIGtdLCAwLjA3OCAqIGssIDAuMTA4ICogayksIFBUX0JPRFksIFNfQk9UVE9NKTtcbiAgICAgIGZvciAoY29uc3QgcyBvZiBbMSwgLTFdKSBmLmFkZChzdHJhcChzICogMC4wNjUgKiBrLCAxLjAyICogaywgcyAqIDAuMDg1ICogaywgMS4xNyAqIGssIDAuMDMgKiBrLCAwLjA2ICogaywgMC4xICogayksIFBUX0JPRFksIFNfQk9UVE9NKTtcbiAgICAgIGFybXMoZiwgZCwgeyBzbGVldmU6ICdsb25nJywgaGFuZDogU19MRUFUSEVSLCByOiAxLjEyIH0pO1xuICAgICAgaGVhZChmLCBkKTtcbiAgICAgIGhhdChmLCBkLCAnYmVhbmllJywgT19IQVRfQSk7IGhhaXIoZiwgZCwgJ2Nyb3AnLCBPX0hBSVJfQSk7XG4gICAgfSxcbiAgICBsb29rKCkge1xuICAgICAgY29uc3QgbWFzayA9IGhhaXJPckhhdCgwLjcsIDAsIDApO1xuICAgICAgcmV0dXJuIHsgc2tpbjogcGljayhTS0lOKSwgdG9wOiBwaWNrKFsnIzhlM2IzNScsICcjNmI3YThhJywgJyMzZjVhNGEnLCAnI2M5YTg2YScsICcjZmZkMjNmJ10pLCBib3R0b206IHBpY2soWycjNmI3YTNlJywgJyM0YTZmYTUnLCAnIzVhNDYzNicsICcjZTg0YTNjJ10pLCBoYWlyOiBoZWFkQ29sKG1hc2ssICgpID0+IHBpY2soWycjZTg0YTNjJywgJyMzNmM5YzYnLCAnI2ZmZDIzZicsICcjN2FkOTdhJ10pLCBoYWlyQ29sKSwgYWNjOiBwaWNrKExXX1NMSUNLKSwgc2hvZTogNSwgbWFzayB9O1xuICAgIH0sXG4gIH0sXG59O1xuXG4vKiogc2l4IGFyY2hldHlwZXMgcGVyIGJpb21lIHdpdGggdGhlaXIgY3Jvd2Qgd2VpZ2h0cyAqL1xuY29uc3QgQklPTUVfTUlYOiBSZWNvcmQ8QmlvbWVJZCwgW3N0cmluZywgbnVtYmVyXVtdPiA9IHtcbiAgZ3JpZGVhc3Q6IFtbJ29mZmljZScsIDIyXSwgWydjYXN1YWwnLCAyNl0sIFsna2lkJywgMTNdLCBbJ2VsZGVyJywgMTBdLCBbJ2NvdXJpZXInLCAxMl0sIFsnZHJlc3MnLCAxN11dLFxuICB3aGl0ZXN0YWNrczogW1snd29ya2VyJywgMjZdLCBbJ3BhcmthJywgMjhdLCBbJ2tpZCcsIDExXSwgWydlbGRlcicsIDldLCBbJ29mZmljZScsIDEyXSwgWydjYXN1YWwnLCAxNF1dLFxuICBsb2Nrd2F0ZXI6IFtbJ3JhaW5jb2F0JywgMzJdLCBbJ2RvY2snLCAyMF0sIFsna2lkJywgMTFdLCBbJ2VsZGVyJywgOV0sIFsnY291cmllcicsIDEyXSwgWydjYXN1YWwnLCAxNl1dLFxufTtcblxuLyoqIH41Mi10cmkgZmFyIGZpZ3VyZTogc2FtZSBwYXJ0cywgcGl2b3RzIGFuZCBjb2xvdXIgc2xvdHMgYXMgdGhlIGZ1bGwgYXJjaGV0eXBlcyAqL1xuZnVuY3Rpb24gYnVpbGRMb2QoKTogVEhSRUUuQnVmZmVyR2VvbWV0cnkge1xuICBjb25zdCBmID0gbmV3IEZpZygpO1xuICBjb25zdCBkID0gZGltcygxKTtcbiAgZm9yIChjb25zdCBzaWRlIG9mIFsxLCAtMV0pIHtcbiAgICBjb25zdCB4ID0gc2lkZSAqIGQuaGlwWDtcbiAgICBmLmFkZChsb2Z0KFtyaW5nKDMsIDAuMDcsIDAuMDcsIGQuaGlwWSArIDAuMDMsIDAsIHgpLCByaW5nKDMsIDAuMDU1LCAwLjA3LCAwLCAwLCB4LCAwLjAzKV0sICdub25lJywgJ25vbmUnKSwgc2lkZSA+IDAgPyBQVF9MTEVHIDogUFRfUkxFRywgU19CT1RUT00sIDAsIFt4LCBkLmhpcFksIDBdKTtcbiAgICBjb25zdCBTOiBWMyA9IFtzaWRlICogZC5zaFgsIGQuc2hZLCAwXTtcbiAgICBmLmFkZChsb2Z0KFtyaW5nKDMsIDAuMDYsIDAuMDYsIGQuc2hZICsgMC4wNCwgMCwgc2lkZSAqIChkLnNoWCArIDAuMDEpKSwgcmluZygzLCAwLjA1LCAwLjA1LCBkLnNoWSAtIDAuNSwgMCwgc2lkZSAqIChkLnNoWCArIDAuMDUpKV0sICdub25lJywgJ25vbmUnKSwgc2lkZSA+IDAgPyBQVF9MQVJNIDogUFRfUkFSTSwgU19UT1AsIDAsIFMpO1xuICB9XG4gIGYuYWRkKGxvZnQoW3JpbmcoNCwgMC4xOSwgMC4xMywgMC42LCBNYXRoLlBJIC8gNCksIHJpbmcoNCwgMC4yLCAwLjEzNSwgMC44LCBNYXRoLlBJIC8gNCldLCAnY2FwJywgJ25vbmUnKSwgUFRfQk9EWSwgU19CT1RUT00pO1xuICBmLmFkZChsb2Z0KFtyaW5nKDQsIDAuMiwgMC4xMzUsIDAuNzgsIE1hdGguUEkgLyA0KSwgcmluZyg0LCAwLjIyLCAwLjEzLCAxLjE3LCBNYXRoLlBJIC8gNCldLCAnbm9uZScsICdjYXAnKSwgUFRfQk9EWSwgU19UT1ApO1xuICBjb25zdCBocCA9IGhlYWRQaXYoZCksIHkgPSBkLmhlYWRZO1xuICBmLmFkZChsb2Z0KFtyaW5nKDQsIDAuMTcsIDAuMTU1LCB5ICsgMC4xNCwgTWF0aC5QSSAvIDQpXSwgWzAsIHkgLSAwLjAzLCAwXSwgJ25vbmUnKSwgUFRfSEVBRCwgU19TS0lOLCAwLCBocCk7XG4gIGYuYWRkKGxvZnQoW3JpbmcoNCwgMC4xNywgMC4xNTUsIHkgKyAwLjE0LCBNYXRoLlBJIC8gNCldLCAnbm9uZScsIFswLCB5ICsgMC4zMywgLTAuMDJdKSwgUFRfSEVBRCwgU19IQUlSLCAwLCBocCk7XG4gIHJldHVybiBmLmdlb21ldHJ5KCk7XG59XG5cbi8qKiB+MjQwLXRyaSBNSUQgZmlndXJlIChhIGZpZ3VyZSB+MTLigJM0MCBweCB0YWxsKTogT05FIGdlb21ldHJ5IGZvciBldmVyeSBhcmNoZXR5cGUsIG9uZSBkcmF3ICgrIGh1bGwpXG4gKiAgZm9yIHRoZSB3aG9sZSBjcm93ZC4gU2FtZSBwYXJ0cyAvIHBpdm90cyAvIGNvbG91ciBzbG90cyAvIHBvc2VzIGFzIHRoZSBmdWxsIGZpZ3VyZXMsIGVsYm93c1xuICogIGluY2x1ZGVkOyBwZXItaW5zdGFuY2Ugb3B0aW9uIGJpdHMgcGljayBoYWlyIC8gbG9uZyBoYWlyIC8gaGF0IC8gYmFnLCB0aGUgc3R5bGUgYml0cyAoaUMzLncpIGFcbiAqICBza2lydCBvciBhIGxvbmcgY29hdC4gKi9cbmZ1bmN0aW9uIGJ1aWxkTWlkKCk6IFRIUkVFLkJ1ZmZlckdlb21ldHJ5IHtcbiAgY29uc3QgZiA9IG5ldyBGaWcoKTtcbiAgY29uc3QgZCA9IGRpbXMoMSwgMS4wNik7XG4gIGNvbnN0IFEgPSBNYXRoLlBJIC8gNDtcbiAgZm9yIChjb25zdCBzaWRlIG9mIFsxLCAtMV0pIHtcbiAgICBjb25zdCBwYXJ0ID0gc2lkZSA+IDAgPyBQVF9MTEVHIDogUFRfUkxFRywgeCA9IHNpZGUgKiBkLmhpcFgsIHBpdjogVjMgPSBbeCwgZC5oaXBZLCAwXTtcbiAgICBmLmFkZChsb2Z0KFtyaW5nKDQsIDAuMDgyLCAwLjA4MiwgZC5oaXBZICsgMC4wMywgUSwgeCksIHJpbmcoNCwgMC4wNjIsIDAuMDYyLCAwLjA4LCBRLCB4KV0sICdub25lJywgJ25vbmUnKSwgcGFydCwgU19CT1RUT00sIDAsIHBpdik7XG4gICAgZi5hZGQobG9mdChbcmluZyg0LCAwLjA3MiwgMC4xMjUsIDAsIFEsIHgsIDAuMDM1KSwgcmluZyg0LCAwLjA2MiwgMC4wOSwgMC4xMSwgUSwgeCwgMC4wMTUpXSwgJ25vbmUnLCAnY2FwJyksIHBhcnQsIFNfU0hPRSwgMCwgcGl2KTtcbiAgfVxuICBmLmFkZChsb2Z0KFtyaW5nKDYsIDAuMTQsIDAuMDk1LCAwLjYsIEhFWCksIHJpbmcoNiwgMC4xNDYsIDAuMDk4LCAwLjgsIEhFWCldLCAnY2FwJywgJ25vbmUnKSwgUFRfQk9EWSwgU19CT1RUT00pO1xuICBmLmFkZChsb2Z0KFtyaW5nKDYsIDAuMTQyLCAwLjA5NiwgMC43OCwgSEVYKSwgcmluZyg2LCAwLjE3LCAwLjEwOCwgMS4wMywgSEVYKSwgcmluZyg2LCAwLjEyLCAwLjA4NCwgMS4xNywgSEVYKV0sICdub25lJywgJ2NhcCcpLCBQVF9CT0RZLCBTX1RPUCk7XG4gIGNvbnN0IHNraXJ0ID0gKCk6IG51bWJlcltdID0+IGxvZnQoW3JpbmcoNiwgMC4xNDIsIDAuMSwgMC44LCBIRVgpLCByaW5nKDYsIDAuMjE1LCAwLjE4LCAwLjQ0LCBIRVgpXSwgJ25vbmUnLCAnbm9uZScpO1xuICBmLmFkZChza2lydCgpLCBQVF9CT0RZLCBTX0JPVFRPTSwgT19TS0lSVF9CKTtcbiAgZi5hZGQoc2tpcnQoKSwgUFRfQk9EWSwgU19UT1AsIE9fU0tJUlRfVCk7XG4gIGYuYWRkKGxvZnQoW3JpbmcoNCwgMC4xMSwgMC4wNSwgMC44LCBRLCAwLCAtMC4xMzUpLCByaW5nKDQsIDAuMSwgMC4wNDUsIDEuMDcsIFEsIDAsIC0wLjEzKV0sICdub25lJywgJ2NhcCcpLCBQVF9CT0RZLCBTX0FDQywgT19CQUcpO1xuICBmb3IgKGNvbnN0IHNpZGUgb2YgWzEsIC0xXSkge1xuICAgIGNvbnN0IHVwID0gc2lkZSA+IDAgPyBQVF9MQVJNIDogUFRfUkFSTSwgZm9yZSA9IHNpZGUgPiAwID8gUFRfTEZPUkUgOiBQVF9SRk9SRTtcbiAgICBjb25zdCB7IFMsIG0sIEUgfSA9IGFybUZyYW1lKGQsIHNpZGUsIFNQTEFZKTtcbiAgICBjb25zdCBVID0gZC51cExlbiwgTCA9IGQuYXJtTGVuO1xuICAgIGYuYWRkKHhmKGxvZnQoW3JpbmcoMywgMC4wNzgsIDAuMDc4LCAwLjAxKSwgcmluZygzLCAwLjA2NiwgMC4wNjYsIC1VKV0sIFswLCAwLjA1LCAwXSwgJ25vbmUnKSwgbSksIHVwLCBTX1RPUCwgMCwgUyk7XG4gICAgZi5hZGQoeGYobG9mdChbcmluZygzLCAwLjA2NiwgMC4wNjYsIC1VICsgMC4wMSksIHJpbmcoMywgMC4wNTYsIDAuMDU2LCAtTCArIDAuMDEpXSwgWzAsIC1VICsgMC4wNSwgMF0sICdub25lJyksIG0pLCBmb3JlLCBTX1RPUCwgMCwgUywgRSk7XG4gICAgZi5hZGQoeGYobG9mdChbcmluZyg0LCAwLjA1LCAwLjA2LCAtTCArIDAuMDIsIFEpLCByaW5nKDQsIDAuMDUyLCAwLjA3LCAtTCAtIDAuMDYsIFEsIDAsIDAuMDA0KV0sICdub25lJywgWzAsIC1MIC0gMC4xMjUsIDAuMDA0XSksIG0pLCBmb3JlLCBTX1NLSU4sIDAsIFMsIEUpO1xuICB9XG4gIGNvbnN0IGhzID0gZC5ocywgeTAgPSBkLmhlYWRZLCBocCA9IGhlYWRQaXYoZCk7XG4gIGYuYWRkKGxvZnQoW3JpbmcoNiwgMC4xMjIgKiBocywgMC4xMTIgKiBocywgeTAgKyAwLjA3ICogaHMsIEhFWCksIHJpbmcoNiwgMC4xMjQgKiBocywgMC4xMTIgKiBocywgeTAgKyAwLjIxICogaHMsIEhFWCldLFxuICAgIFswLCB5MCAtIDAuMDEgKiBocywgMC4wMTIgKiBoc10sIFswLCB5MCArIDAuMjkgKiBocywgLTAuMDA2ICogaHNdKSwgUFRfSEVBRCwgU19TS0lOLCAwLCBocCk7XG4gIGNvbnN0IGZ6ID0gMC4xMDMgKiBocztcbiAgZm9yIChjb25zdCBzIG9mIFsxLCAtMV0pIHtcbiAgICBjb25zdCBleCA9IHMgKiAwLjA0ICogaHMsIGV5ID0geTAgKyAwLjE0ICogaHMsIHcgPSAwLjAyMSAqIGhzLCBoID0gMC4wMzIgKiBocztcbiAgICBmLmFkZChmbGF0KFtleCAtIHcsIGV5IC0gaCwgZXggKyB3LCBleSAtIGgsIGV4ICsgdywgZXkgKyBoLCBleCAtIHcsIGV5ICsgaF0sIGZ6KSwgUFRfSEVBRCwgU19JTkssIDAsIGhwKTtcbiAgfVxuICAvLyBnZW5lcmljIGhhaXIgY2FwICgrIGEgbG9uZyBiYWNrIGZvciBPX0hBSVJfQikgYW5kIGEgZ2VuZXJpYyBoYXQgKGJyaW0gKyBjcm93bilcbiAgY29uc3QgeWYgPSAoYTogbnVtYmVyKTogbnVtYmVyID0+IHkwICsgaHMgKiAoMC4xICsgMC4xMjUgKiAoMC41ICsgMC41ICogTWF0aC5jb3MoYSkpKTtcbiAgY29uc3QgUjEgPSByaW5nKDYsIDEsIDEsIDAsIEhFWCwgMCwgMCwgeWYpLm1hcCgoW3gsIHksIHpdKTogVjMgPT4geyBjb25zdCByID0gaGVhZFIoKHkgLSB5MCkgLyBocykgKiBocyAqIDEuMTIgKyAwLjAwNCAqIGhzOyByZXR1cm4gW3ggKiByLCB5LCB6ICogciAtIDAuMDA0ICogaHNdOyB9KTtcbiAgZi5hZGQobG9mdChbUjFdLCAnbm9uZScsIFswLCB5MCArIDAuMzIgKiBocywgLTAuMDEgKiBoc10sIFswLCB5MCArIDAuMTUgKiBocywgMF0pLCBQVF9IRUFELCBTX0hBSVIsIE9fTUhBSVIsIGhwKTtcbiAgZi5hZGQobG9mdChbcmluZyg0LCAwLjEyNSAqIGhzLCAwLjA0NSAqIGhzLCB5MCArIDAuMjUgKiBocywgUSwgMCwgLTAuMDkgKiBocyksIHJpbmcoNCwgMC4xMiAqIGhzLCAwLjA0ICogaHMsIHkwICsgMC4wMSAqIGhzLCBRLCAwLCAtMC4wODUgKiBocyldLCAnbm9uZScsICdub25lJyksIFBUX0hFQUQsIFNfSEFJUiwgT19IQUlSX0IsIGhwKTtcbiAgY29uc3QgcmQgPSBoZWFkUigwLjIyKSAqIGhzICogMS4xNCArIDAuMDA0ICogaHM7XG4gIGYuYWRkKGxvZnQoW3JpbmcoNiwgMC4xOSAqIGhzLCAwLjE5ICogaHMsIHkwICsgMC4yICogaHMsIEhFWCwgMCwgMC4wMiAqIGhzKSwgcmluZyg2LCByZCwgcmQsIHkwICsgMC4yMzUgKiBocywgSEVYKV0sICdub25lJywgWzAsIHkwICsgMC4zNSAqIGhzLCAwXSwgWzAsIHkwICsgMC4xNSAqIGhzLCAwXSksIFBUX0hFQUQsIFNfSEFJUiwgT19NSEFULCBocCk7XG4gIHJldHVybiBmLmdlb21ldHJ5KCk7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCBzaGFkZXJzIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuZnVuY3Rpb24gZ2xzbENvbChoZXg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGMgPSBuZXcgVEhSRUUuQ29sb3IoaGV4KTsgICAvLyDihpIgbGluZWFyIHdvcmtpbmcgc3BhY2VcbiAgcmV0dXJuIGB2ZWMzKCR7Yy5yLnRvRml4ZWQoNCl9LCAke2MuZy50b0ZpeGVkKDQpfSwgJHtjLmIudG9GaXhlZCg0KX0pYDtcbn1cblxuY29uc3QgQ0lWX1BBUlMgPSAvKiBnbHNsICovIGBcbmF0dHJpYnV0ZSB2ZWM0IGFUYWc7XG5hdHRyaWJ1dGUgdmVjMyBhUGl2O1xuYXR0cmlidXRlIHZlYzMgYUVsYjtcbmF0dHJpYnV0ZSB2ZWM0IGlDMTtcbmF0dHJpYnV0ZSB2ZWM0IGlDMjtcbmF0dHJpYnV0ZSB2ZWM0IGlDMztcbmF0dHJpYnV0ZSB2ZWM0IGlBbmltO1xubWF0MyBjaXZSO1xubWF0MyBjaXZFO1xuZmxvYXQgY2l2S2VlcDtcbm1hdDMgY2l2UngoZmxvYXQgYSkgeyBmbG9hdCBjID0gY29zKGEpLCBzID0gc2luKGEpOyByZXR1cm4gbWF0MygxLjAsIDAuMCwgMC4wLCAwLjAsIGMsIHMsIDAuMCwgLXMsIGMpOyB9XG5tYXQzIGNpdlJ5KGZsb2F0IGEpIHsgZmxvYXQgYyA9IGNvcyhhKSwgcyA9IHNpbihhKTsgcmV0dXJuIG1hdDMoYywgMC4wLCAtcywgMC4wLCAxLjAsIDAuMCwgcywgMC4wLCBjKTsgfVxubWF0MyBjaXZSeihmbG9hdCBhKSB7IGZsb2F0IGMgPSBjb3MoYSksIHMgPSBzaW4oYSk7IHJldHVybiBtYXQzKGMsIHMsIDAuMCwgLXMsIGMsIDAuMCwgMC4wLCAwLjAsIDEuMCk7IH1cbnZvaWQgY2l2U2V0dXAoKSB7XG4gIGludCBwYXJ0ID0gaW50KGFUYWcueCArIDAuNSk7XG4gIGludCBvcHQgPSBpbnQoYVRhZy56ICsgMC41KTtcbiAgaW50IG1hc2sgPSBpbnQoaUMxLncgKyAwLjUpO1xuICBpbnQgc3R5bGUgPSBpbnQoaUMzLncgKyAwLjUpO1xuICBmbG9hdCBwb3NlID0gaUFuaW0uejtcbiAgYm9vbCBwYW5pYyA9IGFicyhwb3NlIC0gJHtQX1BBTklDfS4wKSA8IDAuNTtcbiAgY2l2S2VlcCA9IDEuMDtcbiAgaWYgKG9wdCA9PSAke09fUEhPTkV9KSBjaXZLZWVwID0gYWJzKHBvc2UgLSAke1BfUEhPTkV9LjApIDwgMC41ID8gMS4wIDogMC4wO1xuICBlbHNlIGlmIChvcHQgPT0gJHtPX0NBTE19KSBjaXZLZWVwID0gcGFuaWMgPyAwLjAgOiAxLjA7XG4gIGVsc2UgaWYgKG9wdCA9PSAke09fUEFOSUN9KSBjaXZLZWVwID0gcGFuaWMgPyAxLjAgOiAwLjA7XG4gIGVsc2UgaWYgKG9wdCA9PSAke09fTUhBVH0pIGNpdktlZXAgPSAobWFzayAmICR7Yml0KE9fSEFUX0EpIHwgYml0KE9fSEFUX0IpfSkgIT0gMCA/IDEuMCA6IDAuMDtcbiAgZWxzZSBpZiAob3B0ID09ICR7T19NSEFJUn0pIGNpdktlZXAgPSAobWFzayAmICR7Yml0KE9fSEFJUl9BKSB8IGJpdChPX0hBSVJfQil9KSAhPSAwID8gMS4wIDogMC4wO1xuICBlbHNlIGlmIChvcHQgPT0gJHtPX1NLSVJUX0J9KSBjaXZLZWVwID0gZmxvYXQoc3R5bGUgJiAxKTtcbiAgZWxzZSBpZiAob3B0ID09ICR7T19TS0lSVF9UfSkgY2l2S2VlcCA9IGZsb2F0KChzdHlsZSA+PiAxKSAmIDEpO1xuICBlbHNlIGlmIChvcHQgPiAwKSBjaXZLZWVwID0gZmxvYXQoKG1hc2sgPj4gKG9wdCAtIDEpKSAmIDEpO1xuICAvLyBhIGNhbmUgKHJpZ2h0LWhhbmQgZXh0cmEpIGlzIGRyb3BwZWQgdGhlIG1vbWVudCBpdHMgb3duZXIgc3RvcHMgc2ltcGx5IHdhbGtpbmdcbiAgaWYgKG9wdCA9PSAke09fRVhUUkF9ICYmIChwYXJ0ID09ICR7UFRfUkFSTX0gfHwgcGFydCA9PSAke1BUX1JGT1JFfSkgJiYgcG9zZSA+IDAuNSkgY2l2S2VlcCA9IDAuMDtcbiAgY2l2UiA9IG1hdDMoMS4wKTtcbiAgY2l2RSA9IG1hdDMoMS4wKTtcbiAgZmxvYXQgcGggPSBpQW5pbS54LCBhbXAgPSBpQW5pbS55O1xuICBmbG9hdCBzID0gc2luKHBoKTtcbiAgaWYgKHBhcnQgPT0gJHtQVF9MTEVHfSB8fCBwYXJ0ID09ICR7UFRfUkxFR30gfHwgcGFydCA9PSAke1BUX0xTSElOfSB8fCBwYXJ0ID09ICR7UFRfUlNISU59KSB7XG4gICAgZmxvYXQgc2lkZSA9IChwYXJ0ID09ICR7UFRfTExFR30gfHwgcGFydCA9PSAke1BUX0xTSElOfSkgPyAxLjAgOiAtMS4wO1xuICAgIGNpdlIgPSBjaXZSeChzaWRlICogcyAqIChwYW5pYyA/IDAuOTUgOiAwLjU1KSAqIGFtcCk7XG4gICAgLy8gdGhlIGtuZWUgZm9sZHMgd2hpbGUgdGhlIGxlZyBzd2luZ3MgZm9yd2FyZCAoYW5kIGEgbGl0dGxlIG9uIHRoZSBwbGFudClcbiAgICBpZiAocGFydCA9PSAke1BUX0xTSElOfSB8fCBwYXJ0ID09ICR7UFRfUlNISU59KSBjaXZFID0gY2l2UngobWluKGFtcCwgMS40KSAqICgwLjA4ICsgMC45NSAqIG1heCgwLjAsIC1zaWRlICogY29zKHBoKSkpICogKHBhbmljID8gMS4zIDogMS4wKSk7XG4gIH0gZWxzZSBpZiAocGFydCA9PSAke1BUX0xBUk19IHx8IHBhcnQgPT0gJHtQVF9SQVJNfSB8fCBwYXJ0ID09ICR7UFRfTEZPUkV9IHx8IHBhcnQgPT0gJHtQVF9SRk9SRX0pIHtcbiAgICBmbG9hdCBzaWRlID0gKHBhcnQgPT0gJHtQVF9MQVJNfSB8fCBwYXJ0ID09ICR7UFRfTEZPUkV9KSA/IDEuMCA6IC0xLjA7XG4gICAgZmxvYXQgc3RpbGwgPSAxLjAgLSBtaW4oYW1wLCAxLjApO1xuICAgIGZsb2F0IHJ4ID0gLXNpZGUgKiBzICogMC41ICogYW1wO1xuICAgIGZsb2F0IHJ6ID0gc2lkZSAqICgwLjAzICsgMC4wMyAqIGFicyhzKSAqIGFtcCArIDAuMDQgKiBzdGlsbCAqIHNpbihwaCAqIDAuNyArIHNpZGUpKTtcbiAgICAvLyByZWxheGVkIGVsYm93czsgbW9yZSBiZW5kIG9uIHRoZSBmb3J3YXJkIHN3aW5nOyBhIHNwcmludGVyJ3MgOTAgZGVncmVlc1xuICAgIGZsb2F0IGJlbmQgPSAwLjI0ICsgMC41ICogbWF4KDAuMCwgc2lkZSAqIHMpICogbWluKGFtcCwgMS4wKSArIG1heCgwLjAsIGFtcCAtIDEuMCkgKiAyLjQgKyAwLjA2ICogc3RpbGwgKiBzaW4ocGggKiAwLjkpO1xuICAgIGlmIChwYW5pYykge1xuICAgICAgcnggPSAtMi41NSArIDAuNSAqIHNpbihwaCAqIDEuNyArIHNpZGUgKiAxLjkpO1xuICAgICAgcnogPSBzaWRlICogKDAuNSArIDAuMzIgKiBzaW4ocGggKiAyLjMgKyBzaWRlICogMC43KSk7XG4gICAgICBiZW5kID0gMC42MiArIDAuNDUgKiBzaW4ocGggKiAyLjkgKyBzaWRlICogMS4zKTtcbiAgICB9IGVsc2UgaWYgKGFicyhwb3NlIC0gJHtQX1BPSU5UfS4wKSA8IDAuNSAmJiBzaWRlIDwgMC4wKSB7XG4gICAgICByeCA9IC0xLjcyICsgMC4wNSAqIHNpbihwaCAqIDIuMCk7IHJ6ID0gMC4xMjsgYmVuZCA9IDAuMDY7XG4gICAgfSBlbHNlIGlmIChhYnMocG9zZSAtICR7UF9QSE9ORX0uMCkgPCAwLjUgJiYgc2lkZSA8IDAuMCkge1xuICAgICAgcnggPSAtMC45NSArIDAuMDMgKiBzaW4ocGgpOyByeiA9IDAuMzI7IGJlbmQgPSAxLjU7XG4gICAgfSBlbHNlIGlmIChhYnMocG9zZSAtICR7UF9XQVZFfS4wKSA8IDAuNSAmJiBzaWRlIDwgMC4wKSB7XG4gICAgICByeCA9IC0wLjM7IHJ6ID0gLTIuMiArIDAuMDggKiBzaW4ocGggKiAzLjApOyBiZW5kID0gMC40NSArIDAuNDUgKiBzaW4ocGggKiAzLjApO1xuICAgIH1cbiAgICBpZiAoc2lkZSA8IDAuMCAmJiAoKG1hc2sgPj4gJHtPX1VNQiAtIDF9KSAmIDEpID09IDEpIHsgcnggPSAke1VNQl9SWH0gKyAocGFuaWMgPyAwLjI1ICogc2luKHBoICogMi4wKSA6IDAuMCk7IHJ6ID0gJHtVTUJfUlp9OyBiZW5kID0gMC4wOyB9XG4gICAgaWYgKHNpZGUgPiAwLjAgJiYgKChtYXNrID4+ICR7T19CQUxMT09OIC0gMX0pICYgMSkgPT0gMSkgeyByeCA9ICR7QkFMX1JYfSArIDAuMDYgKiBzaW4ocGgpOyByeiA9ICR7QkFMX1JafTsgYmVuZCA9IDAuMDsgfVxuICAgIGNpdlIgPSBjaXZSeChyeCkgKiBjaXZSeihyeik7XG4gICAgaWYgKHBhcnQgPT0gJHtQVF9MRk9SRX0gfHwgcGFydCA9PSAke1BUX1JGT1JFfSkgY2l2RSA9IGNpdlJ4KC1iZW5kKTtcbiAgfSBlbHNlIGlmIChwYXJ0ID09ICR7UFRfSEVBRH0pIHtcbiAgICBjaXZSID0gY2l2UnkoaUFuaW0udykgKiBjaXZSeCgtaUMyLncpO1xuICB9XG59XG52ZWMzIGNpdlBvcyh2ZWMzIHApIHsgcmV0dXJuIChhUGl2ICsgY2l2UiAqIChhRWxiICsgY2l2RSAqIChwIC0gYUVsYikgLSBhUGl2KSkgKiBjaXZLZWVwOyB9XG5gO1xuXG4vLyBjb2xvdXItb25seSBpbnN0YW5jZSBhdHRyaWJ1dGVzOiBkZWNsYXJlZCBpbiB0aGUgdG9vbiBwcm9ncmFtIG9ubHkgKHRoZSBpbmsgaHVsbCB3b3VsZFxuLy8gb3RoZXJ3aXNlIGV4Y2VlZCB0aGUgMTYgdmVydGV4LWF0dHJpYnV0ZSBsaW1pdCBvbiBEM0QxMS9BTkdMRSlcbmNvbnN0IENJVl9DT0xPUiA9IC8qIGdsc2wgKi8gYFxuYXR0cmlidXRlIHZlYzQgaUMwO1xuYXR0cmlidXRlIHZlYzQgaUM0O1xudmFyeWluZyB2ZWMzIHZDaXZDb2w7XG52ZWMzIGNpdkNvbG9yKCkge1xuICBpbnQgc2xvdCA9IGludChhVGFnLnkgKyAwLjUpO1xuICBpZiAoc2xvdCA9PSAke1NfU0tJTn0pIHJldHVybiBpQzAucmdiO1xuICBpZiAoc2xvdCA9PSAke1NfVE9QfSkgcmV0dXJuIGlDMS5yZ2I7XG4gIGlmIChzbG90ID09ICR7U19CT1RUT019KSByZXR1cm4gaUMyLnJnYjtcbiAgaWYgKHNsb3QgPT0gJHtTX0hBSVJ9KSByZXR1cm4gaUMzLnJnYjtcbiAgaWYgKHNsb3QgPT0gJHtTX0FDQ30pIHJldHVybiBpQzQucmdiO1xuICBpZiAoc2xvdCA9PSAke1NfU0hPRX0pIHtcbiAgICBpbnQgayA9IGludChpQzAudyArIDAuNSk7XG4gICAgJHtTSE9FUy5tYXAoKGgsIGkpID0+IGBpZiAoayA9PSAke2l9KSByZXR1cm4gJHtnbHNsQ29sKGgpfTtgKS5qb2luKCdcXG4gICAgJyl9XG4gICAgcmV0dXJuICR7Z2xzbENvbChTSE9FU1swXSl9O1xuICB9XG4gIGlmIChzbG90ID09ICR7U19JTkt9KSByZXR1cm4gJHtnbHNsQ29sKElOSyl9O1xuICBpZiAoc2xvdCA9PSAke1NfV0hJVEV9KSByZXR1cm4gJHtnbHNsQ29sKCcjZjRmMWU4Jyl9O1xuICBpZiAoc2xvdCA9PSAke1NfR1JFWX0pIHJldHVybiAke2dsc2xDb2woJyM4Zjk0OWMnKX07XG4gIHJldHVybiAke2dsc2xDb2woJyM3YTUyMzYnKX07XG59XG5gO1xuXG5mdW5jdGlvbiBtYWtlQ2l2VG9vbigpOiBUSFJFRS5NZXNoVG9vbk1hdGVyaWFsIHtcbiAgY29uc3QgbSA9IG1ha2VUb29uKHsgY29sb3I6ICcjZmZmZmZmJyB9KTtcbiAgbS5uYW1lID0gJ2NpdlRvb24nO1xuICBtLm9uQmVmb3JlQ29tcGlsZSA9IChzaCkgPT4ge1xuICAgIHNoLnZlcnRleFNoYWRlciA9IHNoLnZlcnRleFNoYWRlclxuICAgICAgLnJlcGxhY2UoJyNpbmNsdWRlIDxjb21tb24+JywgJyNpbmNsdWRlIDxjb21tb24+XFxuJyArIENJVl9QQVJTICsgQ0lWX0NPTE9SKVxuICAgICAgLnJlcGxhY2UoJyNpbmNsdWRlIDxiZWdpbm5vcm1hbF92ZXJ0ZXg+JywgJ2NpdlNldHVwKCk7XFxudmVjMyBvYmplY3ROb3JtYWwgPSBjaXZSICogKGNpdkUgKiB2ZWMzKCBub3JtYWwgKSk7XFxuI2lmZGVmIFVTRV9UQU5HRU5UXFxudmVjMyBvYmplY3RUYW5nZW50ID0gdmVjMyggdGFuZ2VudC54eXogKTtcXG4jZW5kaWYnKVxuICAgICAgLnJlcGxhY2UoJyNpbmNsdWRlIDxiZWdpbl92ZXJ0ZXg+JywgJ3ZlYzMgdHJhbnNmb3JtZWQgPSBjaXZQb3MoIHBvc2l0aW9uICk7XFxudkNpdkNvbCA9IGNpdkNvbG9yKCk7Jyk7XG4gICAgc2guZnJhZ21lbnRTaGFkZXIgPSBzaC5mcmFnbWVudFNoYWRlclxuICAgICAgLnJlcGxhY2UoJyNpbmNsdWRlIDxjb21tb24+JywgJyNpbmNsdWRlIDxjb21tb24+XFxudmFyeWluZyB2ZWMzIHZDaXZDb2w7JylcbiAgICAgIC5yZXBsYWNlKCcjaW5jbHVkZSA8Y29sb3JfZnJhZ21lbnQ+JywgJyNpbmNsdWRlIDxjb2xvcl9mcmFnbWVudD5cXG5kaWZmdXNlQ29sb3IucmdiICo9IHZDaXZDb2w7Jyk7XG4gIH07XG4gIG0uY3VzdG9tUHJvZ3JhbUNhY2hlS2V5ID0gKCkgPT4gJ2NpdlRvb24tdjInO1xuICByZXR1cm4gbTtcbn1cblxuZnVuY3Rpb24gbWFrZUNpdk91dGxpbmUoKTogVEhSRUUuU2hhZGVyTWF0ZXJpYWwge1xuICBjb25zdCBtID0gbWFrZU91dGxpbmVNYXRlcmlhbCh7IHdpZHRoUHg6IE9VVExJTkVfVywgaW5zdGFuY2VkOiB0cnVlIH0pO1xuICBtLm5hbWUgPSAnY2l2SW5rJztcbiAgbS52ZXJ0ZXhTaGFkZXIgPSBtLnZlcnRleFNoYWRlclxuICAgIC5yZXBsYWNlKCcjaW5jbHVkZSA8Y29tbW9uPicsICcjaW5jbHVkZSA8Y29tbW9uPlxcbicgKyBDSVZfUEFSUylcbiAgICAucmVwbGFjZSgndmVjMyBvYmplY3ROb3JtYWwgPSBvdXRsaW5lTm9ybWFsOycsICdjaXZTZXR1cCgpO1xcbiAgdmVjMyBvYmplY3ROb3JtYWwgPSBjaXZSICogKGNpdkUgKiBvdXRsaW5lTm9ybWFsKTsnKVxuICAgIC5yZXBsYWNlKCcjaW5jbHVkZSA8YmVnaW5fdmVydGV4PicsICd2ZWMzIHRyYW5zZm9ybWVkID0gY2l2UG9zKCBwb3NpdGlvbiApOycpO1xuICByZXR1cm4gbTtcbn1cblxuLyoqIHBlci1hcmNoZXR5cGUgdHJpYW5nbGUgY291bnRzIChkZWJ1ZyAvIHRlc3RzKSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNpdkFyY2hldHlwZVN0YXRzKCk6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4ge1xuICBjb25zdCBvdXQ6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgZm9yIChjb25zdCBpZCBvZiBPYmplY3Qua2V5cyhBUkNIKSkge1xuICAgIGNvbnN0IGYgPSBuZXcgRmlnKCk7IEFSQ0hbaWRdLmJ1aWxkKGYpO1xuICAgIG91dFtpZF0gPSBmLnBvcy5sZW5ndGggLyA5O1xuICB9XG4gIGNvbnN0IGcgPSBidWlsZExvZCgpOyBvdXQubG9kID0gZy5nZXRBdHRyaWJ1dGUoJ3Bvc2l0aW9uJykuY291bnQgLyAzOyBnLmRpc3Bvc2UoKTtcbiAgY29uc3QgbSA9IGJ1aWxkTWlkKCk7IG91dC5taWQgPSBtLmdldEF0dHJpYnV0ZSgncG9zaXRpb24nKS5jb3VudCAvIDM7IG0uZGlzcG9zZSgpO1xuICByZXR1cm4gb3V0O1xufVxuXG4vKiogU2NyYXRjaCAvIGRlYnVnIGdhbGxlcnk6IGVhY2ggYXJjaGV0eXBlIChyb3dzKSBpbiBhIGxpbmUgb2YgcG9zZXMgYW5kIG9wdGlvbiBzZXRzIChjb2x1bW5zKSxcbiAqICBwbHVzIHRoZSBNSUQgYW5kIExPRCBmaWd1cmVzIOKAlCBzYW1lIGdlb21ldHJ5LCBtYXRlcmlhbHMgYW5kIHNoYWRlciBhcyB0aGUgbGl2ZSB2aWV3LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNpdkdhbGxlcnkoYmlvbWU6IEJpb21lSWQsIHJvd3M6IHN0cmluZ1tdID0gT2JqZWN0LmtleXMoQVJDSCkpOiB7IGdyb3VwOiBUSFJFRS5Hcm91cDsgdGljayh0OiBudW1iZXIpOiB2b2lkOyBkaXNwb3NlKCk6IHZvaWQgfSB7XG4gIGNvbnN0IHRvb24gPSBtYWtlQ2l2VG9vbigpLCBpbmsgPSBtYWtlQ2l2T3V0bGluZSgpO1xuICBjb25zdCBncm91cCA9IG5ldyBUSFJFRS5Hcm91cCgpO1xuICBjb25zdCBkaXNwOiB7IGRpc3Bvc2UoKTogdm9pZCB9W10gPSBbdG9vbiwgaW5rXTtcbiAgY29uc3QgQ09MUzogW251bWJlciwgbnVtYmVyLCBudW1iZXJdW10gPSBbICAgLy8gcG9zZSwgYW1wLCBvcHRpb24gbWFza1xuICAgIFtQX1dBTEssIDAsIGJpdChPX0hBSVJfQSkgfCBiaXQoT19CQUcpIHwgYml0KE9fRVhUUkEpXSxcbiAgICBbUF9XQUxLLCAxLCBiaXQoT19IQUlSX0IpIHwgYml0KE9fRVhUUkEpXSxcbiAgICBbUF9QQU5JQywgMSwgYml0KE9fSEFUX0EpIHwgYml0KE9fQkFHKV0sXG4gICAgW1BfUE9JTlQsIDAsIGJpdChPX0hBVF9CKSB8IGJpdChPX0VYVFJBKV0sXG4gICAgW1BfUEhPTkUsIDAsIGJpdChPX0hBSVJfQSkgfCBiaXQoT19CQUcpXSxcbiAgICBbUF9XQVZFLCAwLCBiaXQoT19IQVRfQSkgfCBiaXQoT19FWFRSQSldLFxuICAgIFtQX1dBTEssIDAuNCwgYml0KE9fSEFJUl9CKSB8IGJpdChPX1VNQikgfCBiaXQoT19CQUxMT09OKV0sXG4gIF07XG4gIGNvbnN0IGFuaW1zOiB7IGFycjogRmxvYXQzMkFycmF5OyBhdDogVEhSRUUuSW5zdGFuY2VkQnVmZmVyQXR0cmlidXRlOyBuOiBudW1iZXIgfVtdID0gW107XG4gIGNvbnN0IGFsbCA9IFsuLi5yb3dzLCAnbWlkJywgJ2xvZCddO1xuICBjb25zdCBpZHMgPSBPYmplY3Qua2V5cyhBUkNIKTtcbiAgYWxsLmZvckVhY2goKGlkLCByKSA9PiB7XG4gICAgbGV0IGdlbzogVEhSRUUuQnVmZmVyR2VvbWV0cnk7XG4gICAgaWYgKGlkID09PSAnbG9kJykgZ2VvID0gYnVpbGRMb2QoKTtcbiAgICBlbHNlIGlmIChpZCA9PT0gJ21pZCcpIGdlbyA9IGJ1aWxkTWlkKCk7XG4gICAgZWxzZSB7IGNvbnN0IGYgPSBuZXcgRmlnKCk7IEFSQ0hbaWRdLmJ1aWxkKGYpOyBnZW8gPSBmLmdlb21ldHJ5KCk7IH1cbiAgICBjb25zdCBuID0gQ09MUy5sZW5ndGg7XG4gICAgY29uc3QgYXJycyA9IEFUVFJfTkFNRVMubWFwKCgpID0+IG5ldyBGbG9hdDMyQXJyYXkobiAqIDQpKTtcbiAgICBjb25zdCBhdHMgPSBhcnJzLm1hcCgoYSwgaSkgPT4geyBjb25zdCBhdCA9IG5ldyBUSFJFRS5JbnN0YW5jZWRCdWZmZXJBdHRyaWJ1dGUoYSwgNCk7IGdlby5zZXRBdHRyaWJ1dGUoQVRUUl9OQU1FU1tpXSwgYXQpOyByZXR1cm4gYXQ7IH0pO1xuICAgIGNvbnN0IG1lc2ggPSBuZXcgVEhSRUUuSW5zdGFuY2VkTWVzaChnZW8sIHRvb24sIG4pO1xuICAgIG1lc2guZnJ1c3R1bUN1bGxlZCA9IGZhbHNlOyBtZXNoLnJlY2VpdmVTaGFkb3cgPSB0cnVlO1xuICAgIGlmIChpZCAhPT0gJ2xvZCcpIHsgY29uc3QgaCA9IGFkZE91dGxpbmUobWVzaCwgT1VUTElORV9XKTsgaC5tYXRlcmlhbCA9IGluazsgfVxuICAgIGNvbnN0IGMzID0gbmV3IFRIUkVFLkNvbG9yKCk7XG4gICAgQ09MUy5mb3JFYWNoKChbcG9zZSwgYW1wLCBtYXNrXSwgYykgPT4ge1xuICAgICAgY29uc3QgYXJjaCA9IGlkID09PSAnbG9kJyB8fCBpZCA9PT0gJ21pZCcgPyBBUkNIW2lkc1soYyAqIDMgKyByKSAlIGlkcy5sZW5ndGhdXSA6IEFSQ0hbaWRdO1xuICAgICAgbWVzaC5zZXRNYXRyaXhBdChjLCBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VUcmFuc2xhdGlvbigoYyAtIChuIC0gMSkgLyAyKSAqIDEuMDUsIDAsIC1yICogMS43KSk7XG4gICAgICBjb25zdCBsayA9IGFyY2gubG9vayhiaW9tZSk7XG4gICAgICBjb25zdCBwdXQgPSAoYWk6IG51bWJlciwgaGV4OiBzdHJpbmcsIHd2OiBudW1iZXIpOiB2b2lkID0+IHsgYzMuc2V0KGhleCk7IGFycnNbYWldLnNldChbYzMuciwgYzMuZywgYzMuYiwgd3ZdLCBjICogNCk7IH07XG4gICAgICBwdXQoMCwgbGsuc2tpbiwgbGsuc2hvZSk7IHB1dCgxLCBsay50b3AsIGlkID09PSAnY291cmllcicgPyBiaXQoT19IQVRfQSkgOiBpZCA9PT0gJ21pZCcgfHwgaWQgPT09ICdsb2QnID8gbGsubWFzayA6IG1hc2spO1xuICAgICAgcHV0KDIsIGxrLmJvdHRvbSwgcG9zZSA9PT0gUF9XQUxLICYmIGFtcCA9PT0gMCA/IDAgOiAwLjM1KTtcbiAgICAgIHB1dCgzLCBsay5oYWlyLCBhcmNoLm1pZCA/PyAwKTsgcHV0KDQsIGxrLmFjYywgMCk7XG4gICAgICBhcnJzWzVdLnNldChbYyAqIDEuMywgYW1wLCBwb3NlLCAwXSwgYyAqIDQpO1xuICAgIH0pO1xuICAgIGZvciAoY29uc3QgYXQgb2YgYXRzKSBhdC5uZWVkc1VwZGF0ZSA9IHRydWU7XG4gICAgYW5pbXMucHVzaCh7IGFycjogYXJyc1s1XSwgYXQ6IGF0c1s1XSwgbiB9KTtcbiAgICBncm91cC5hZGQobWVzaCk7XG4gICAgZGlzcC5wdXNoKGdlbywgbWVzaCk7XG4gIH0pO1xuICByZXR1cm4ge1xuICAgIGdyb3VwLFxuICAgIHRpY2sodDogbnVtYmVyKTogdm9pZCB7XG4gICAgICBmb3IgKGNvbnN0IGEgb2YgYW5pbXMpIHtcbiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBhLm47IGMrKykgYS5hcnJbYyAqIDRdID0gYyAqIDEuMyArIHQgKiAoYS5hcnJbYyAqIDQgKyAyXSA9PT0gUF9QQU5JQyA/IDE0IDogYS5hcnJbYyAqIDQgKyAxXSA+IDAgPyA3IDogMyk7XG4gICAgICAgIGEuYXQubmVlZHNVcGRhdGUgPSB0cnVlO1xuICAgICAgfVxuICAgIH0sXG4gICAgZGlzcG9zZSgpOiB2b2lkIHsgZm9yIChjb25zdCBkIG9mIGRpc3ApIGQuZGlzcG9zZSgpOyB9LFxuICB9O1xufVxuXG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCB0aGUgdmlldyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbmludGVyZmFjZSBQdWZmIHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHo6IG51bWJlcjsgdDogbnVtYmVyOyBzOiBudW1iZXI7IH1cblxuLyoqIG9uZSBpbnN0YW5jZWQgYmF0Y2ggKGFuIGFyY2hldHlwZSwgdGhlIE1JRCBmaWd1cmUgb3IgdGhlIExPRCBmaWd1cmUpICovXG5pbnRlcmZhY2UgQmF0Y2gge1xuICBtZXNoOiBUSFJFRS5JbnN0YW5jZWRNZXNoO1xuICBodWxsOiBUSFJFRS5NZXNoIHwgbnVsbDtcbiAgYXR0cnM6IFRIUkVFLkluc3RhbmNlZEJ1ZmZlckF0dHJpYnV0ZVtdOyAgIC8vIGlDMC4uaUM0LCBpQW5pbVxuICBhcnJzOiBGbG9hdDMyQXJyYXlbXTtcbiAgbjogbnVtYmVyO1xufVxuXG5jb25zdCBBVFRSX05BTUVTID0gWydpQzAnLCAnaUMxJywgJ2lDMicsICdpQzMnLCAnaUM0JywgJ2lBbmltJ10gYXMgY29uc3Q7XG5cbi8vIOKUgOKUgCBkZXRhaWwgdGllcnMsIHBpY2tlZCBieSB0aGUgb24tc2NyZWVuIGhlaWdodCBvZiBhIGZpZ3VyZSBzdGFuZGluZyBhdCB0aGUgY2FtZXJhIHRhcmdldCDilIDilIBcbi8qKiBmaWd1cmUgaGVpZ2h0IChtIGF0IHNjYWxlIDEpIHVzZWQgZm9yIG9uLXNjcmVlbiBzaXplIGVzdGltYXRlcyAqL1xuY29uc3QgRklHX0ggPSAxLjU7XG4vKiog4omlIHRoaXMgbWFueSBweCB0YWxsOiBmdWxsIGFyY2hldHlwZSBmaWd1cmVzICgrIGh1bGxzKSAqL1xuY29uc3QgRlVMTF9QWCA9IDQ0O1xuLyoqIOKJpSB0aGlzOiB0aGUgTUlEIGZpZ3VyZSAob25lIGRyYXcgKyBodWxsIGZvciBldmVyeW9uZSk7IGJlbG93IChTaXplIElJSSspOiB0aGUgNTYtdHJpIGZhciBmaWd1cmUgKi9cbmNvbnN0IE1JRF9QWCA9IDI2O1xuLyoqIHRoZSBNSUQgZmlndXJlIGtlZXBzIGl0cyBpbmsgaHVsbCB3aGlsZSBhdCBsZWFzdCB0aGlzIHRhbGwgKi9cbmNvbnN0IEhVTExfUFggPSAxNTtcbi8qKiBjb3N0IGNlaWxpbmcgZm9yIHRoZSBNSUQgY3Jvd2Q6IHRoZSBvbGQgY2Fwc3VsZS1waWxsIGNyb3dkJ3MgdHJpYW5nbGUgY291bnQgKi9cbmNvbnN0IFBJTExfVFJJUyA9IDgxOTIwO1xuXG4vLyDilIDilIAgcGVyc29uYWwgc3BhY2UgKMOXIHRoZSByYW5rJ3MgY2l2IHNjYWxlKSDilIDilIBcbi8qKiBoYXJkIG1pbmltdW0gY2VudHJlLXRvLWNlbnRyZSBkaXN0YW5jZSAqL1xuY29uc3QgU0VQX0sgPSAwLjc7XG4vKiogc29mdCB6b25lOiBhIGdlbnRsZSBwdXNoIHN0YXJ0cyBoZXJlICh3YWxrZXJzIHN0ZXAgYXJvdW5kIGVhY2ggb3RoZXIpICovXG5jb25zdCBTT0ZUX0sgPSAxLjA7XG4vKiogc3Bhd24gc3BhY2luZyBiZXR3ZWVuIGFueSB0d28gY2l2aWxpYW5zLCBhbmQgdGhlIHNwYWNpbmcgaW5zaWRlIGEgZ3JvdXAgKi9cbmNvbnN0IFNQQVdOX1NFUF9LID0gMC44NTtcbmNvbnN0IEdST1VQX1NQX0sgPSAwLjk4O1xuLyoqIGEgbmV3IGdyb3VwJ3MgYW5jaG9yIG5lZWRzIHRoaXMgbXVjaCBjbGVhciBzcGFjZSAqL1xuY29uc3QgQU5DSE9SX0NMRUFSX0sgPSAxLjE1O1xuLyoqIHNwYXRpYWwtaGFzaCBjZWxsICjiiaUgdGhlIGxhcmdlc3QgbmVpZ2hib3VyIHJhZGl1cyB1c2VkIHdpdGggYSAzw5czIHF1ZXJ5KSAqL1xuY29uc3QgQ0VMTF9LID0gMS4wO1xuY29uc3QgSEFTSCA9IDIwNDg7XG4vKiogYm9keSByYWRpdXMgZm9yIHByb3AgYXZvaWRhbmNlICovXG5jb25zdCBCT0RZX0sgPSAwLjI2O1xuLyoqIHBhdmVkIGZvcmVjb3VydDogc2lkZXdhbGsgd2Fsa2VycyBtYXkgdXNlIHVwIHRvIHRoaXMgbWFueSBtZXRyZXMgb2YgcGFyY2VsIGluc2lkZSB0aGUgc2lkZXdhbGsgKi9cbmNvbnN0IFBMQVpBX0RFUFRIID0gNztcblxuLy8g4pSA4pSAIG5lYXItY2FtZXJhIHJ1bGVzICjDlyB0aGUgdGFyZ2V0IGZpZ3VyZSdzIG9uLXNjcmVlbiBoZWlnaHQpIOKUgOKUgFxuLyoqIG5ldmVyIHNwYXduIGEgZmlndXJlIHRoaXMgbXVjaCBiaWdnZXIgdGhhbiBvbmUgYXQgdGhlIGNhbWVyYSB0YXJnZXQgKi9cbmNvbnN0IFNQQVdOX05FQVIgPSAxLjQ1O1xuLyoqIG5ldmVyIGRyYXcgb25lIHRoaXMgbXVjaCBiaWdnZXIgKGl0IHdvdWxkIGJlIGEgZ2lhbnQgYmxvYiByaWdodCB1bmRlciB0aGUgbGVucykgKi9cbmNvbnN0IERSQVdfTkVBUiA9IDIuMztcbi8qKiBzdGlsbCBmcmFtZXMgKHNsYXRlIC8gcGF1c2UpOiBhIGZpZ3VyZSBhdCBsZWFzdCB0aGlzIGJpZyBBTkQgY3V0IGJ5IHRoZSBzY3JlZW4gZWRnZSBpcyBub3QgZHJhd25cbiAqICAoYW5kIG5ldmVyIHNwYXduZWQpIOKAlCBubyBoYWxmIGZpZ3VyZXMgcG9raW5nIGluIGF0IHRoZSBmcmFtZSBlZGdlcyBiZWhpbmQgdGhlIHNsYXRlJ3MgY2FwdGlvbnMgKi9cbmNvbnN0IEVER0VfTkVBUiA9IDAuODtcbi8qKiBzdGlsbCBmcmFtZXM6IE5EQyB5IGJlbG93IHdoaWNoIHRoZSBib3R0b20gY2FwdGlvbiBiYW5kIHN0YXJ0cyAodGhlIGxvd2VzdCB+MjAgJSBvZiB0aGUgZnJhbWUpICovXG5jb25zdCBTVElMTF9CT1RUT00gPSAtMC42O1xuXG5leHBvcnQgY2xhc3MgQ2l2aWxpYW5WaWV3IGltcGxlbWVudHMgVmlld01vZHVsZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgY3R4OiBWaWV3Q3R4O1xuICBwcml2YXRlIHJlYWRvbmx5IHJvb3QgPSBuZXcgVEhSRUUuR3JvdXAoKTtcbiAgcHJpdmF0ZSBiYXRjaGVzOiBCYXRjaFtdID0gW107XG4gIHByaXZhdGUgbWlkOiBCYXRjaCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGxvZDogQmF0Y2ggfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBtaWRUcmlzID0gMjQwO1xuICBwcml2YXRlIGFyY2hzOiBBcmNoW10gPSBbXTtcbiAgcHJpdmF0ZSBhcmNoVzogbnVtYmVyW10gPSBbXTtcbiAgcHJpdmF0ZSBhcmNoV1N1bSA9IDE7XG4gIHByaXZhdGUgcHVmZnM6IFRIUkVFLkluc3RhbmNlZE1lc2ggfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBkaXNwb3NhYmxlczogeyBkaXNwb3NlKCk6IHZvaWQgfVtdID0gW107XG4gIC8vIFNvQSBjaXZpbGlhbiBzdGF0ZVxuICBwcml2YXRlIHJlYWRvbmx5IHggPSBuZXcgRmxvYXQzMkFycmF5KENBUCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgeiA9IG5ldyBGbG9hdDMyQXJyYXkoQ0FQKTtcbiAgcHJpdmF0ZSByZWFkb25seSB2eCA9IG5ldyBGbG9hdDMyQXJyYXkoQ0FQKTtcbiAgcHJpdmF0ZSByZWFkb25seSB2eiA9IG5ldyBGbG9hdDMyQXJyYXkoQ0FQKTtcbiAgcHJpdmF0ZSByZWFkb25seSB0ID0gbmV3IEZsb2F0MzJBcnJheShDQVApOyAgICAgICAgICAvLyBzdGF0ZSB0aW1lciAocylcbiAgcHJpdmF0ZSByZWFkb25seSBzcGQgPSBuZXcgRmxvYXQzMkFycmF5KENBUCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGggPSBuZXcgRmxvYXQzMkFycmF5KENBUCk7ICAgICAgICAgLy8gZ2FpdCBwaGFzZVxuICBwcml2YXRlIHJlYWRvbmx5IGhkID0gbmV3IEZsb2F0MzJBcnJheShDQVApOyAgICAgICAgIC8vIGZhY2luZyBoZWFkaW5nXG4gIHByaXZhdGUgcmVhZG9ubHkgaHkgPSBuZXcgRmxvYXQzMkFycmF5KENBUCk7ICAgICAgICAgLy8gaGVhZCB5YXcgKHJlbGF0aXZlIHRvIHRoZSBib2R5KVxuICBwcml2YXRlIHJlYWRvbmx5IGhwID0gbmV3IEZsb2F0MzJBcnJheShDQVApOyAgICAgICAgIC8vIGhlYWQgcGl0Y2ggKGxvb2sgdXApXG4gIHByaXZhdGUgcmVhZG9ubHkgYW1wID0gbmV3IEZsb2F0MzJBcnJheShDQVApOyAgICAgICAgLy8gc21vb3RoZWQgc3dpbmcgYW1wbGl0dWRlXG4gIHByaXZhdGUgcmVhZG9ubHkgaHZhciA9IG5ldyBGbG9hdDMyQXJyYXkoQ0FQKTsgICAgICAgLy8gaGVpZ2h0IHZhcmlhdGlvblxuICBwcml2YXRlIHJlYWRvbmx5IHN0ID0gbmV3IFVpbnQ4QXJyYXkoQ0FQKTtcbiAgcHJpdmF0ZSByZWFkb25seSBhcmNoID0gbmV3IFVpbnQ4QXJyYXkoQ0FQKTtcbiAgcHJpdmF0ZSByZWFkb25seSBwb3NlID0gbmV3IFVpbnQ4QXJyYXkoQ0FQKTtcbiAgLyoqIGdyb3VwIGxlYWRlciAoc2VsZiA9IG9uIGl0cyBvd24pOyBmb2xsb3dlcnMgY29weSB0aGUgbGVhZGVyJ3Mgd2FsayAvIHN0b3AgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBsZWFkID0gbmV3IEludDE2QXJyYXkoQ0FQKTtcbiAgLyoqIDEgPSBzdHJvbGxpbmcgaW5zaWRlIGEgcGFyayAvIHBsYXphIGJsb2NrIGluc3RlYWQgb2Ygb24gdGhlIHNpZGV3YWxrIHJpbmcgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBpblBhcmsgPSBuZXcgVWludDhBcnJheShDQVApO1xuICAvKiogc3RhdGljIHBlci1jaXZpbGlhbiBpbnN0YW5jZSBjb2xvdXJzOiBpQzAuLmlDNCAoNSDDlyB2ZWM0KSAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbCA9IG5ldyBGbG9hdDMyQXJyYXkoQ0FQICogMjApO1xuICAvLyBzcGF0aWFsIGhhc2ggKGxpbmtlZCBsaXN0cyB0aHJvdWdoIGhOZXh0KSwgcmVidWlsdCB0d2ljZSBhIGZyYW1lIOKAlCB6ZXJvIGFsbG9jYXRpb25cbiAgcHJpdmF0ZSByZWFkb25seSBoSGVhZCA9IG5ldyBJbnQzMkFycmF5KEhBU0gpO1xuICBwcml2YXRlIHJlYWRvbmx5IGhOZXh0ID0gbmV3IEludDMyQXJyYXkoQ0FQKTtcbiAgcHJpdmF0ZSBoQ2VsbCA9IDE7XG4gIC8qKiBwZXIgYmxvY2s6IDEgPSBwYXJrIC8gcGxhemEgKG5vIGJ1aWxkaW5ncykgKi9cbiAgcHJpdmF0ZSBwYXJrQ2VsbCA9IG5ldyBVaW50OEFycmF5KDApO1xuICBwcml2YXRlIHB1ZmZMaXN0OiBQdWZmW10gPSBbXTtcbiAgcHJpdmF0ZSBwdWZmQ3Vyc29yID0gMDtcbiAgcHJpdmF0ZSB3YXRlclo6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGxpdmUgPSAwO1xuICBwcml2YXRlIHNjYWxlTm93ID0gMTtcbiAgLyoqIHB4IG9mIG9uLXNjcmVlbiBoZWlnaHQgcGVyIChtIG9mIGZpZ3VyZSAvIG0gb2YgY2FtZXJhIGRpc3RhbmNlKSAqL1xuICBwcml2YXRlIHB4SyA9IDYwMDtcbiAgcHJpdmF0ZSBmaWdQeCA9IDEwMDtcbiAgcHJpdmF0ZSBmcmVlQ3Vyc29yID0gMDtcbiAgcHJpdmF0ZSBmcmFtZU5vID0gMDtcbiAgLyoqIHBlciBwcm9wIGlkOiBmb290cHJpbnQgaGFsZiBleHRlbnRzICh3aWR0aCAvIGxlbmd0aDsgdHJlZXMgPSB0cnVuaykgYW5kIGEgcGVyLWZyYW1lIGhlYWRpbmcgdHJpZyBjYWNoZSAqL1xuICBwcml2YXRlIHByb3BIVyA9IG5ldyBGbG9hdDMyQXJyYXkoMCk7XG4gIHByaXZhdGUgcHJvcEhMID0gbmV3IEZsb2F0MzJBcnJheSgwKTtcbiAgcHJpdmF0ZSBwcm9wU2luID0gbmV3IEZsb2F0MzJBcnJheSgwKTtcbiAgcHJpdmF0ZSBwcm9wQ29zID0gbmV3IEZsb2F0MzJBcnJheSgwKTtcbiAgcHJpdmF0ZSBwcm9wU3RhbXAgPSBuZXcgSW50MzJBcnJheSgwKTtcbiAgLyoqIGRlYnVnIC8gdGVzdHM6IHRoZSBkZXRhaWwgdGllciB0aGlzIGZyYW1lICgwIGZ1bGwsIDEgbWlkLCAyIGZhcikgYW5kIHRoZSB0YXJnZXQgZmlndXJlIHB4ICovXG4gIHByaXZhdGUgcmVhZG9ubHkgZGJnID0geyB0aWVyOiAwLCBmaWdQeDogMCwgaHVsbDogdHJ1ZSwgbGl2ZTogMCwgbWluR2FwOiAwLCBmbGVlaW5nOiAwLCBwcm9wUHVzaDogMCwgaW5Qcm9wOiAwLCBpblBhcms6IDAsIGZvcmVjb3VydDogMCwgbXM6IDAsIG1zU3Bhd246IDAsIG1zU2VwOiAwLCBtc0xvb3A6IDAsIGN1bGxlZE5lYXI6IDAsIGN1bGxlZEVkZ2U6IDAsIHB4TWF4OiAwIH07XG4gIC8vIHNjcmF0Y2hcbiAgcHJpdmF0ZSByZWFkb25seSBtNCA9IG5ldyBUSFJFRS5NYXRyaXg0KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcSA9IG5ldyBUSFJFRS5RdWF0ZXJuaW9uKCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgZXVsID0gbmV3IFRIUkVFLkV1bGVyKDAsIDAsIDAsICdZWFonKTtcbiAgcHJpdmF0ZSByZWFkb25seSBwMyA9IG5ldyBUSFJFRS5WZWN0b3IzKCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgczMgPSBuZXcgVEhSRUUuVmVjdG9yMygpO1xuICBwcml2YXRlIHJlYWRvbmx5IHYzID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcbiAgcHJpdmF0ZSByZWFkb25seSBjMyA9IG5ldyBUSFJFRS5Db2xvcigpO1xuXG4gIGNvbnN0cnVjdG9yKGN0eDogVmlld0N0eCkgeyB0aGlzLmN0eCA9IGN0eDsgdGhpcy5yb290Lm5hbWUgPSAnY2l2aWxpYW5zJzsgdGhpcy5yb290LnVzZXJEYXRhLmNpdiA9IHRoaXMuZGJnOyB9XG5cbiAgLyoqIGNpdmlsaWFucyBjdXJyZW50bHkgb24gc2NyZWVuIChkZWJ1ZyAvIHRlc3RzKSAqL1xuICBnZXQgY291bnQoKTogbnVtYmVyIHsgcmV0dXJuIHRoaXMubGl2ZTsgfVxuXG4gIG1vdW50KHc6IFdvcmxkKTogdm9pZCB7XG4gICAgdGhpcy53YXRlclogPSBoYXJib3VyV2F0ZXJaKHcuY2l0eSk7XG4gICAgY29uc3QgdG9vbiA9IG1ha2VDaXZUb29uKCk7XG4gICAgY29uc3QgaW5rID0gbWFrZUNpdk91dGxpbmUoKTtcbiAgICB0aGlzLmRpc3Bvc2FibGVzLnB1c2godG9vbiwgaW5rKTtcbiAgICBjb25zdCBtaXggPSBCSU9NRV9NSVhbdy5iaW9tZUlkXSA/PyBCSU9NRV9NSVguZ3JpZGVhc3Q7XG4gICAgdGhpcy5hcmNocyA9IG1peC5tYXAoKFtpZF0pID0+IEFSQ0hbaWRdKTtcbiAgICB0aGlzLmFyY2hXID0gbWl4Lm1hcCgoWywgd2d0XSkgPT4gd2d0KTtcbiAgICB0aGlzLmFyY2hXU3VtID0gdGhpcy5hcmNoVy5yZWR1Y2UoKHMsIHYpID0+IHMgKyB2LCAwKTtcbiAgICB0aGlzLmJhdGNoZXMgPSB0aGlzLmFyY2hzLm1hcCgoYSkgPT4ge1xuICAgICAgY29uc3QgZiA9IG5ldyBGaWcoKTsgYS5idWlsZChmKTtcbiAgICAgIHJldHVybiB0aGlzLm1ha2VCYXRjaCgnY2l2OicgKyBhLmlkLCBmLmdlb21ldHJ5KCksIHRvb24sIGluayk7XG4gICAgfSk7XG4gICAgY29uc3QgbWlkR2VvID0gYnVpbGRNaWQoKTtcbiAgICB0aGlzLm1pZFRyaXMgPSBtaWRHZW8uZ2V0QXR0cmlidXRlKCdwb3NpdGlvbicpLmNvdW50IC8gMztcbiAgICB0aGlzLm1pZCA9IHRoaXMubWFrZUJhdGNoKCdjaXY6bWlkJywgbWlkR2VvLCB0b29uLCBpbmspO1xuICAgIHRoaXMubG9kID0gdGhpcy5tYWtlQmF0Y2goJ2Npdjpsb2QnLCBidWlsZExvZCgpLCB0b29uLCBudWxsKTtcblxuICAgIGNvbnN0IG5wMCA9IHcuY2l0eS5wcm9wcy5sZW5ndGg7XG4gICAgdGhpcy5wcm9wSFcgPSBuZXcgRmxvYXQzMkFycmF5KG5wMCk7IHRoaXMucHJvcEhMID0gbmV3IEZsb2F0MzJBcnJheShucDApO1xuICAgIHRoaXMucHJvcFNpbiA9IG5ldyBGbG9hdDMyQXJyYXkobnAwKTsgdGhpcy5wcm9wQ29zID0gbmV3IEZsb2F0MzJBcnJheShucDApOyB0aGlzLnByb3BTdGFtcCA9IG5ldyBJbnQzMkFycmF5KG5wMCkuZmlsbCgtMSk7XG4gICAgZm9yIChsZXQgayA9IDA7IGsgPCBucDA7IGsrKykge1xuICAgICAgY29uc3QgcHIgPSB3LmNpdHkucHJvcHNba107XG4gICAgICBjb25zdCBpbmZvID0gUFJPUF9JTkZPW3ByLmtpbmRdO1xuICAgICAgY29uc3QgdHJlZSA9IHByLmtpbmQgPT09ICd0cmVlJztcbiAgICAgIHRoaXMucHJvcEhXW2tdID0gdHJlZSA/IDAuMyA6IGluZm8ud2lkICogMC41OyB0aGlzLnByb3BITFtrXSA9IHRyZWUgPyAwLjMgOiBpbmZvLmxlbiAqIDAuNTtcbiAgICB9XG4gICAgLy8gcGFyayAvIHBsYXphIGJsb2Nrczogbm8gYnVpbGRpbmdzICh0aGUgaGFyYm91ciByb3cgb2YgYSBmbG9vZGVkIGNpdHkgaXMgd2F0ZXIsIG5vdCBhIHBhcmspXG4gICAgY29uc3QgY2l0eSA9IHcuY2l0eTtcbiAgICB0aGlzLnBhcmtDZWxsID0gbmV3IFVpbnQ4QXJyYXkoY2l0eS5ibG9ja3NYICogY2l0eS5ibG9ja3NaKTtcbiAgICBmb3IgKGxldCBieiA9IDA7IGJ6IDwgY2l0eS5ibG9ja3NaOyBieisrKSB7XG4gICAgICBmb3IgKGxldCBieCA9IDA7IGJ4IDwgY2l0eS5ibG9ja3NYOyBieCsrKSB7XG4gICAgICAgIGNvbnN0IGJpID0gYnggKyBieiAqIGNpdHkuYmxvY2tzWDtcbiAgICAgICAgdGhpcy5wYXJrQ2VsbFtiaV0gPSBjaXR5LmJsb2NrQnVpbGRpbmdzW2JpXS5sZW5ndGggPT09IDAgJiYgIShjaXR5LmZsb29kZWQgJiYgYnogPT09IDApID8gMSA6IDA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgaWNvID0gbmV3IFRIUkVFLkljb3NhaGVkcm9uR2VvbWV0cnkoMC41LCAwKTtcbiAgICBjb25zdCBwdWZmR2VvID0gZmFjZXQoaWNvKTtcbiAgICBpY28uZGlzcG9zZSgpO1xuICAgIGJha2VPdXRsaW5lTm9ybWFscyhwdWZmR2VvKTtcbiAgICBwdWZmR2VvLmNvbXB1dGVCb3VuZGluZ1NwaGVyZSgpO1xuICAgIGNvbnN0IHB1ZmZNYXQgPSBtYWtlVG9vbih7IGNvbG9yOiAnI2Y0ZWNkOCcgfSk7XG4gICAgdGhpcy5kaXNwb3NhYmxlcy5wdXNoKHB1ZmZHZW8sIHB1ZmZNYXQpO1xuICAgIHRoaXMucHVmZnMgPSBuZXcgVEhSRUUuSW5zdGFuY2VkTWVzaChwdWZmR2VvLCBwdWZmTWF0LCBQVUZGX0NBUCAqIFBVRkZfQkFMTFMpO1xuICAgIHRoaXMucHVmZnMubmFtZSA9ICdjaXY6cHVmZnMnO1xuICAgIHRoaXMucHVmZnMuaW5zdGFuY2VNYXRyaXguc2V0VXNhZ2UoVEhSRUUuRHluYW1pY0RyYXdVc2FnZSk7XG4gICAgdGhpcy5wdWZmcy5mcnVzdHVtQ3VsbGVkID0gZmFsc2U7XG4gICAgdGhpcy5wdWZmcy5jb3VudCA9IDA7XG4gICAgYWRkT3V0bGluZSh0aGlzLnB1ZmZzLCAxLjQpO1xuICAgIHRoaXMucm9vdC5hZGQodGhpcy5wdWZmcyk7XG4gICAgdGhpcy5wdWZmTGlzdCA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgUFVGRl9DQVA7IGkrKykgdGhpcy5wdWZmTGlzdC5wdXNoKHsgeDogMCwgeTogMCwgejogMCwgdDogUFVGRl9MSUZFLCBzOiAxIH0pO1xuXG4gICAgdGhpcy5zdC5maWxsKFNUX0VNUFRZKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IENBUDsgaSsrKSB0aGlzLmxlYWRbaV0gPSBpO1xuICAgIHRoaXMuY3R4LnNjZW5lLmFkZCh0aGlzLnJvb3QpO1xuICB9XG5cbiAgcHJpdmF0ZSBtYWtlQmF0Y2gobmFtZTogc3RyaW5nLCBnZW86IFRIUkVFLkJ1ZmZlckdlb21ldHJ5LCB0b29uOiBUSFJFRS5NYXRlcmlhbCwgaW5rOiBUSFJFRS5TaGFkZXJNYXRlcmlhbCB8IG51bGwpOiBCYXRjaCB7XG4gICAgY29uc3QgYXJyczogRmxvYXQzMkFycmF5W10gPSBbXTtcbiAgICBjb25zdCBhdHRyczogVEhSRUUuSW5zdGFuY2VkQnVmZmVyQXR0cmlidXRlW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IG5tIG9mIEFUVFJfTkFNRVMpIHtcbiAgICAgIGNvbnN0IGEgPSBuZXcgRmxvYXQzMkFycmF5KENBUCAqIDQpO1xuICAgICAgY29uc3QgYXQgPSBuZXcgVEhSRUUuSW5zdGFuY2VkQnVmZmVyQXR0cmlidXRlKGEsIDQpO1xuICAgICAgYXQuc2V0VXNhZ2UoVEhSRUUuRHluYW1pY0RyYXdVc2FnZSk7XG4gICAgICBnZW8uc2V0QXR0cmlidXRlKG5tLCBhdCk7XG4gICAgICBhcnJzLnB1c2goYSk7IGF0dHJzLnB1c2goYXQpO1xuICAgIH1cbiAgICBjb25zdCBtZXNoID0gbmV3IFRIUkVFLkluc3RhbmNlZE1lc2goZ2VvLCB0b29uLCBDQVApO1xuICAgIG1lc2gubmFtZSA9IG5hbWU7XG4gICAgbWVzaC5pbnN0YW5jZU1hdHJpeC5zZXRVc2FnZShUSFJFRS5EeW5hbWljRHJhd1VzYWdlKTtcbiAgICBtZXNoLmZydXN0dW1DdWxsZWQgPSBmYWxzZTtcbiAgICBtZXNoLmNhc3RTaGFkb3cgPSBmYWxzZTtcbiAgICBtZXNoLnJlY2VpdmVTaGFkb3cgPSB0cnVlO1xuICAgIG1lc2guY291bnQgPSAwO1xuICAgIG1lc2gudmlzaWJsZSA9IGZhbHNlO1xuICAgIGxldCBodWxsOiBUSFJFRS5NZXNoIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGluaykgeyBodWxsID0gYWRkT3V0bGluZShtZXNoLCBPVVRMSU5FX1cpOyBodWxsLm1hdGVyaWFsID0gaW5rOyBodWxsLm5hbWUgPSBuYW1lICsgJzppbmsnOyB9XG4gICAgdGhpcy5yb290LmFkZChtZXNoKTtcbiAgICB0aGlzLmRpc3Bvc2FibGVzLnB1c2goZ2VvKTtcbiAgICByZXR1cm4geyBtZXNoLCBodWxsLCBhdHRycywgYXJycywgbjogMCB9O1xuICB9XG5cbiAgdXBkYXRlKHc6IFdvcmxkLCBmOiBGcmFtZUluZm8pOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMubG9kIHx8ICF0aGlzLm1pZCB8fCAhdGhpcy5wdWZmcykgcmV0dXJuO1xuICAgIGNvbnN0IHQwID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgY29uc3QgVCA9IHcudGl0YW47XG4gICAgY29uc3QgSCA9IFQuaGVpZ2h0O1xuICAgIGNvbnN0IHJhbmsgPSBULnJhbms7XG4gICAgY29uc3QgYSA9IGYuYWxwaGE7XG4gICAgY29uc3QgdHggPSBULnB4ICsgKFQueCAtIFQucHgpICogYSwgdHogPSBULnB6ICsgKFQueiAtIFQucHopICogYTtcbiAgICBjb25zdCBkdCA9IGYuZnJvemVuID8gMCA6IGYuZHQ7XG4gICAgY29uc3QgcW0gPSBRX01VTFt0aGlzLmN0eC5xdWFsaXR5LmxldmVsXSA/PyAxO1xuICAgIGNvbnN0IHdhbnQgPSBNYXRoLm1pbihDQVAsIE1hdGgucm91bmQoQ1JPV0RbcmFua10gKiBxbSkpO1xuICAgIGNvbnN0IHNjYWxlID0gQ0lWX1NDQUxFW3JhbmtdO1xuICAgIHRoaXMuc2NhbGVOb3cgPSBzY2FsZTtcbiAgICBjb25zdCBSID0gTWF0aC5tYXgoMTAsIGYuY2FtRGlzdCAqIDAuNjIpOyAgICAgICAgICAgIC8vIHNwYXduIHdpbmRvdyBhcm91bmQgdGhlIGNhbWVyYSB0YXJnZXRcbiAgICBjb25zdCBSMm91dCA9IChmLmNhbURpc3QgKiAwLjkgKyA2KSAqIChmLmNhbURpc3QgKiAwLjkgKyA2KTtcbiAgICBjb25zdCBsaXZlUiA9IENJVFkubGl2ZVJhZGl1c0J5UmFua1tyYW5rXSA/PyAyO1xuICAgIGNvbnN0IGNpdHkgPSB3LmNpdHk7XG4gICAgY29uc3QgUCA9IGNpdHkucGl0Y2g7XG4gICAgY29uc3QgdGJ4ID0gTWF0aC5mbG9vcigodHggLSBjaXR5Lm9yaWdpblgpIC8gUCksIHRieiA9IE1hdGguZmxvb3IoKHR6IC0gY2l0eS5vcmlnaW5aKSAvIFApO1xuICAgIGNvbnN0IG1vdmluZyA9IFQubW92aW5nIHx8IFQuc3BlZWQgPiAwLjU7XG4gICAgY29uc3QgZmxlZVIgPSBIICogKG1vdmluZyA/IDYgOiAyLjUpO1xuICAgIGNvbnN0IGNhbG1SID0gSCAqIDguNTtcbiAgICBjb25zdCBzcXVhc2hSID0gTWF0aC5tYXgoMC43LCBULnJhZGl1cyAqIDEuMTUpO1xuICAgIGNvbnN0IGNhblNxdWFzaCA9IEggPiAyLjQ7ICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGEgU2l6ZSBJIHRpdGFuIGlzIHNob3J0ZXIgdGhhbiB0aGV5IGFyZVxuXG4gICAgLy8g4pSA4pSAIGRldGFpbCB0aWVyIGZyb20gdGhlIG9uLXNjcmVlbiBzaXplIG9mIGEgZmlndXJlIGF0IHRoZSBjYW1lcmEgdGFyZ2V0IOKUgOKUgFxuICAgIGNvbnN0IGNhbSA9IHRoaXMuY3R4LmNhbWVyYTtcbiAgICBjYW0udXBkYXRlTWF0cml4V29ybGQoKTtcbiAgICBjb25zdCBjc3NIID0gTWF0aC5tYXgoMSwgdGhpcy5jdHgucmVuZGVyZXIuZG9tRWxlbWVudC5jbGllbnRIZWlnaHQgfHwgNzIwKTtcbiAgICB0aGlzLnB4SyA9IGNzc0ggLyAoMiAqIE1hdGgudGFuKChjYW0uZm92ICogTWF0aC5QSSkgLyAzNjApKTtcbiAgICBjb25zdCBmaWdQeCA9IChGSUdfSCAqIHNjYWxlICogdGhpcy5weEspIC8gTWF0aC5tYXgoMSwgZi5jYW1EaXN0KTtcbiAgICB0aGlzLmZpZ1B4ID0gZmlnUHg7XG4gICAgbGV0IHRpZXIgPSBmaWdQeCA+PSBGVUxMX1BYID8gMCA6IGZpZ1B4ID49IE1JRF9QWCA/IDEgOiAyO1xuICAgIGxldCBtaWRIdWxsID0gZmlnUHggPj0gSFVMTF9QWDtcbiAgICBpZiAodGllciA9PT0gMSkge1xuICAgICAgLy8gdGhlIHdob2xlIE1JRCBjcm93ZCAoKyBpdHMgaHVsbCkgbXVzdCBjb3N0IG5vIG1vcmUgdGhhbiB0aGUgb2xkIHBpbGwgY3Jvd2QgZGlkXG4gICAgICBpZiAod2FudCAqIHRoaXMubWlkVHJpcyAqIDIgPiBQSUxMX1RSSVMpIG1pZEh1bGwgPSBmYWxzZTtcbiAgICAgIGlmICh3YW50ICogdGhpcy5taWRUcmlzID4gUElMTF9UUklTKSB0aWVyID0gMjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBiIG9mIHRoaXMuYmF0Y2hlcykgaWYgKGIuaHVsbCkgYi5odWxsLnZpc2libGUgPSB0aWVyID09PSAwO1xuICAgIGlmICh0aGlzLm1pZC5odWxsKSB0aGlzLm1pZC5odWxsLnZpc2libGUgPSB0aWVyID09PSAxICYmIG1pZEh1bGw7XG4gICAgdGhpcy5kYmcudGllciA9IHRpZXI7IHRoaXMuZGJnLmZpZ1B4ID0gTWF0aC5yb3VuZChmaWdQeCAqIDEwKSAvIDEwOyB0aGlzLmRiZy5odWxsID0gdGllciA9PT0gMCB8fCAodGllciA9PT0gMSAmJiBtaWRIdWxsKTtcblxuICAgIC8vIOKUgOKUgCBldmVudHM6IGZvb3RzdGVwcyAvIGNvbGxhcHNlcyAvIGV4cGxvc2lvbnMgcHVmZiB3aG9ldmVyIGlzIHVuZGVybmVhdGgg4pSA4pSAXG4gICAgaWYgKCFmLmZyb3plbikge1xuICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBmLmV2ZW50cy5sZW5ndGg7IGsrKykge1xuICAgICAgICBjb25zdCBlID0gZi5ldmVudHNba107XG4gICAgICAgIGlmIChlLnR5cGUgPT09ICdmb290c3RlcCcgJiYgY2FuU3F1YXNoKSB0aGlzLnNxdWFzaENpcmNsZShlLngsIGUueiwgc3F1YXNoUiwgc2NhbGUpO1xuICAgICAgICBlbHNlIGlmIChlLnR5cGUgPT09ICdidWlsZGluZ0NvbGxhcHNlJykgdGhpcy5zcXVhc2hSZWN0KGUueCwgZS56LCBlLncgLyAyICsgMiAqIHNjYWxlLCBlLmQgLyAyICsgMiAqIHNjYWxlLCBzY2FsZSk7XG4gICAgICAgIGVsc2UgaWYgKGUudHlwZSA9PT0gJ2V4cGxvc2lvbicpIHRoaXMuc3F1YXNoQ2lyY2xlKGUueCwgZS56LCBlLnIgKiAwLjgsIHNjYWxlKTtcbiAgICAgIH1cbiAgICAgIC8vIHRoZSB0aXRhbidzIG93biBib2R5IChtb3ZpbmcpIGFsc28gZmxhdHRlbnMgd2hvZXZlciBpdCB3YWRlcyB0aHJvdWdoIChTaXplIElJKylcbiAgICAgIGlmIChjYW5TcXVhc2ggJiYgbW92aW5nKSB0aGlzLnNxdWFzaENpcmNsZSh0eCwgdHosIFQucmFkaXVzICogMC44NSwgc2NhbGUpO1xuICAgIH1cblxuICAgIC8vIOKUgOKUgCByZWN5Y2xlIOKUgOKUgFxuICAgIGxldCBhbGl2ZSA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBDQVA7IGkrKykge1xuICAgICAgY29uc3QgcyA9IHRoaXMuc3RbaV07XG4gICAgICBpZiAocyA9PT0gU1RfRU1QVFkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHMgPT09IFNUX0dPTkUpIHtcbiAgICAgICAgdGhpcy50W2ldIC09IGR0O1xuICAgICAgICBpZiAodGhpcy50W2ldIDw9IDApIHRoaXMuc3RbaV0gPSBTVF9FTVBUWTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBkeCA9IHRoaXMueFtpXSAtIHR4LCBkeiA9IHRoaXMueltpXSAtIHR6O1xuICAgICAgaWYgKGR4ICogZHggKyBkeiAqIGR6ID4gUjJvdXQgfHwgIXRoaXMuaW5MaXZlQmxvY2soY2l0eSwgdGhpcy54W2ldLCB0aGlzLnpbaV0sIHRieCwgdGJ6LCBsaXZlUikpIHsgdGhpcy5zdFtpXSA9IFNUX0VNUFRZOyBjb250aW51ZTsgfVxuICAgICAgYWxpdmUrKztcbiAgICB9XG4gICAgLy8gb3ZlciBidWRnZXQgYWZ0ZXIgYSBxdWFsaXR5IGRyb3A6IHJldGlyZSBhIGZldyBjYWxtIG9uZXNcbiAgICBpZiAoYWxpdmUgPiB3YW50KSB7XG4gICAgICBmb3IgKGxldCBpID0gQ0FQIC0gMTsgaSA+PSAwICYmIGFsaXZlID4gd2FudDsgaS0tKSBpZiAodGhpcy5zdFtpXSA9PT0gU1RfTUlMTCB8fCB0aGlzLnN0W2ldID09PSBTVF9JRExFKSB7IHRoaXMuc3RbaV0gPSBTVF9FTVBUWTsgYWxpdmUtLTsgfVxuICAgIH1cblxuICAgIC8vIOKUgOKUgCBzcGF3bjogc21hbGwgZ3JvdXBzICgx4oCTNSkgd2l0aCBwZXJzb25hbCBzcGFjZSwgb24gc2lkZXdhbGtzIGFuZCBpbiBwYXJrcyDilIDilIBcbiAgICBjb25zdCB0UyA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHRoaXMuaGFzaEJ1aWxkKENFTExfSyAqIHNjYWxlKTtcbiAgICBsZXQgYnVkZ2V0ID0gZi5mcm96ZW4gPyAwIDogTWF0aC5tYXgoOCwgTWF0aC5jZWlsKHdhbnQgLyAxMCkpOyAgIC8vIHNwcmVhZCByZWZpbGxzIG92ZXIgZnJhbWVzXG4gICAgaWYgKHRoaXMubGl2ZSA9PT0gMCAmJiBhbGl2ZSA9PT0gMCkgYnVkZ2V0ID0gd2FudDsgICAgICAgICAgICAgICAgIC8vIGZpcnN0IGZyYW1lOiBmaWxsIGF0IG9uY2VcbiAgICBsZXQgYXR0ZW1wdHMgPSBidWRnZXQgKiAyICsgMTI7XG4gICAgd2hpbGUgKGFsaXZlIDwgd2FudCAmJiBidWRnZXQgPiAwICYmIGF0dGVtcHRzLS0gPiAwKSB7XG4gICAgICBjb25zdCBnb3QgPSB0aGlzLnNwYXduR3JvdXAodywgdHgsIHR6LCBSLCBILCB0YngsIHRieiwgbGl2ZVIsIHNjYWxlLCBNYXRoLm1pbig1LCB3YW50IC0gYWxpdmUsIGJ1ZGdldCksIGYuZnJvemVuKTtcbiAgICAgIGFsaXZlICs9IGdvdDsgYnVkZ2V0IC09IE1hdGgubWF4KDEsIGdvdCk7XG4gICAgfVxuXG4gICAgLy8g4pSA4pSAIGJlaGF2aW91ciArIGludGVncmF0aW9uIOKUgOKUgFxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgQ0FQOyBpKyspIHtcbiAgICAgIGNvbnN0IHMgPSB0aGlzLnN0W2ldO1xuICAgICAgaWYgKHMgPT09IFNUX0VNUFRZIHx8IHMgPT09IFNUX0dPTkUpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgeCA9IHRoaXMueFtpXSwgeiA9IHRoaXMueltpXTtcbiAgICAgIGNvbnN0IGR4ID0geCAtIHR4LCBkeiA9IHogLSB0ejtcbiAgICAgIGNvbnN0IGQgPSBNYXRoLmh5cG90KGR4LCBkeikgfHwgMWUtMztcbiAgICAgIHRoaXMudFtpXSAtPSBkdDtcbiAgICAgIGNvbnN0IGFyID0gdGhpcy5hcmNoc1t0aGlzLmFyY2hbaV1dO1xuICAgICAgaWYgKHMgIT09IFNUX0ZMRUUgJiYgZCA8IGZsZWVSKSB7XG4gICAgICAgIHRoaXMuc3RbaV0gPSBTVF9GTEVFO1xuICAgICAgICBjb25zdCBzcCA9ICgzLjQgKyAwLjExICogSCkgKiAoMC44ICsgTWF0aC5yYW5kb20oKSAqIDAuNDUpICogKGFyLmlkID09PSAnZWxkZXInID8gMC43IDogMSk7XG4gICAgICAgIGNvbnN0IGppdCA9IChNYXRoLnJhbmRvbSgpIC0gMC41KSAqIDAuOTtcbiAgICAgICAgY29uc3QgdXggPSBkeCAvIGQsIHV6ID0gZHogLyBkO1xuICAgICAgICB0aGlzLnZ4W2ldID0gKHV4ICogTWF0aC5jb3Moaml0KSAtIHV6ICogTWF0aC5zaW4oaml0KSkgKiBzcDtcbiAgICAgICAgdGhpcy52eltpXSA9ICh1eCAqIE1hdGguc2luKGppdCkgKyB1eiAqIE1hdGguY29zKGppdCkpICogc3A7XG4gICAgICAgIHRoaXMuc3BkW2ldID0gc3A7XG4gICAgICAgIHRoaXMudFtpXSA9IDIuNSArIE1hdGgucmFuZG9tKCkgKiAyO1xuICAgICAgICB0aGlzLnBvc2VbaV0gPSBNYXRoLnJhbmRvbSgpIDwgMC43MiA/IFBfUEFOSUMgOiBQX1dBTEs7ICAgICAgICAgIC8vIG1vc3QgZmxhaWwsIHNvbWUganVzdCBzcHJpbnRcbiAgICAgIH0gZWxzZSBpZiAocyA9PT0gU1RfRkxFRSkge1xuICAgICAgICAvLyBrZWVwIHN0ZWVyaW5nIGF3YXkgZnJvbSB0aGUgdGl0YW4gKHdpdGggYSBsaXR0bGUgcGFuaWMgd29iYmxlKVxuICAgICAgICBjb25zdCBzcCA9IHRoaXMuc3BkW2ldO1xuICAgICAgICBjb25zdCB1eCA9IGR4IC8gZCwgdXogPSBkeiAvIGQ7XG4gICAgICAgIGNvbnN0IGsgPSBNYXRoLm1pbigxLCBkdCAqIDMpO1xuICAgICAgICB0aGlzLnZ4W2ldICs9ICh1eCAqIHNwIC0gdGhpcy52eFtpXSkgKiBrICsgKE1hdGgucmFuZG9tKCkgLSAwLjUpICogc3AgKiBkdCAqIDI7XG4gICAgICAgIHRoaXMudnpbaV0gKz0gKHV6ICogc3AgLSB0aGlzLnZ6W2ldKSAqIGsgKyAoTWF0aC5yYW5kb20oKSAtIDAuNSkgKiBzcCAqIGR0ICogMjtcbiAgICAgICAgaWYgKGQgPiBjYWxtUiAmJiB0aGlzLnRbaV0gPD0gMCkge1xuICAgICAgICAgIHRoaXMuc3RbaV0gPSBTVF9NSUxMOyB0aGlzLnBvc2VbaV0gPSBQX1dBTEs7XG4gICAgICAgICAgaWYgKCF0aGlzLmZvbGxvd0xlYWRlcihpKSkgdGhpcy5zZXRNaWxsKGksIHgsIHosIGNpdHksIGFyKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh0aGlzLnRbaV0gPD0gMCkge1xuICAgICAgICAvLyBtaWxsIOKHhCBpZGxlIChzdGFuZCBhbmQgZ2F3ayB0b3dhcmQgdGhlIHRpdGFuKTsgZ3JvdXAgbWVtYmVycyBjb3B5IHRoZWlyIGxlYWRlclxuICAgICAgICBpZiAoIXRoaXMuZm9sbG93TGVhZGVyKGkpKSB7XG4gICAgICAgICAgaWYgKHMgPT09IFNUX01JTEwgJiYgTWF0aC5yYW5kb20oKSA8IDAuNDUpIHRoaXMuc2V0SWRsZShpKTtcbiAgICAgICAgICBlbHNlIHsgdGhpcy5zdFtpXSA9IFNUX01JTEw7IHRoaXMucG9zZVtpXSA9IFBfV0FMSzsgdGhpcy5zZXRNaWxsKGksIHgsIHosIGNpdHksIGFyKTsgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLnhbaV0gPSB4ICsgdGhpcy52eFtpXSAqIGR0OyB0aGlzLnpbaV0gPSB6ICsgdGhpcy52eltpXSAqIGR0O1xuICAgIH1cblxuICAgIGNvbnN0IHRQID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgLy8g4pSA4pSAIHBlcnNvbmFsIHNwYWNlOiBub2JvZHkgc3RhbmRzIGluc2lkZSBhbnlib2R5IGVsc2Ug4pSA4pSAXG4gICAgdGhpcy5zZXBhcmF0ZShzY2FsZSwgZHQpO1xuICAgIGNvbnN0IHRMID0gcGVyZm9ybWFuY2Uubm93KCk7XG5cbiAgICAvLyDilIDilIAgY29uc3RyYWludHMgKyBwb3NlICsgaW5zdGFuY2VzIOKUgOKUgFxuICAgIGZvciAoY29uc3QgYiBvZiB0aGlzLmJhdGNoZXMpIGIubiA9IDA7XG4gICAgdGhpcy5taWQubiA9IDA7XG4gICAgdGhpcy5sb2QubiA9IDA7XG4gICAgbGV0IG4gPSAwO1xuICAgIGNvbnN0IGdsYW5jZVIyID0gKEggKiAxMiArIDgpICogKEggKiAxMiArIDgpO1xuICAgIGNvbnN0IGNhbVAgPSBjYW0ucG9zaXRpb247XG4gICAgY29uc3QgYm9keSA9IEJPRFlfSyAqIHNjYWxlO1xuICAgIGxldCBmbGVlaW5nID0gMCwgaW5Qcm9wID0gMCwgcGFya2VycyA9IDAsIGZvcmVjb3VydCA9IDAsIGN1bGxlZE5lYXIgPSAwLCBjdWxsZWRFZGdlID0gMCwgcHhNYXggPSAwO1xuICAgIGNvbnN0IGF1ZGl0ID0gKCsrdGhpcy5mcmFtZU5vICYgMTUpID09PSAwOyAgICAgICAgICAvLyBkZWJ1ZyBhdWRpdCAocHJvcCBvdmVybGFwKSBldmVyeSAxNnRoIGZyYW1lXG4gICAgdGhpcy5kYmcucHJvcFB1c2ggPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgQ0FQOyBpKyspIHtcbiAgICAgIGNvbnN0IHMgPSB0aGlzLnN0W2ldO1xuICAgICAgaWYgKHMgPT09IFNUX0VNUFRZIHx8IHMgPT09IFNUX0dPTkUpIGNvbnRpbnVlO1xuICAgICAgbGV0IHggPSB0aGlzLnhbaV0sIHogPSB0aGlzLnpbaV07XG4gICAgICBjb25zdCBhciA9IHRoaXMuYXJjaHNbdGhpcy5hcmNoW2ldXTtcbiAgICAgIC8vIHdhbGthYmxlIGdyb3VuZCBvbmx5OiBzaWRld2Fsa3MgLyBmb3JlY291cnRzIC8gcGFya3Mg4oCUIG5ldmVyIGJ1aWxkaW5ncywgd2F0ZXIgb3Igb2ZmIHRoZSBtYXBcbiAgICAgIGNvbnN0IGJ4ID0gTWF0aC5mbG9vcigoeCAtIGNpdHkub3JpZ2luWCkgLyBQKSwgYnogPSBNYXRoLmZsb29yKCh6IC0gY2l0eS5vcmlnaW5aKSAvIFApO1xuICAgICAgY29uc3QgY3ggPSBjaXR5Lm9yaWdpblggKyAoYnggKyAwLjUpICogUCwgY3ogPSBjaXR5Lm9yaWdpblogKyAoYnogKyAwLjUpICogUDtcbiAgICAgIGxldCBseCA9IHggLSBjeCwgbHogPSB6IC0gY3o7XG4gICAgICBpZiAocyAhPT0gU1RfRkxFRSAmJiB0aGlzLmluUGFya1tpXSkge1xuICAgICAgICAvLyBzdHJvbGxpbmcgaW4gYSBwYXJrIC8gcGxhemE6IHN0YXkgaW5zaWRlIGl0LCB0dXJuIGJhY2sgYXQgaXRzIGVkZ2VcbiAgICAgICAgY29uc3QgbGltID0gUEFSQ0VMX0hBTEYgLSAwLjY7XG4gICAgICAgIGlmIChseCA+IGxpbSkgeyBseCA9IGxpbTsgaWYgKHRoaXMudnhbaV0gPiAwKSB0aGlzLnZ4W2ldID0gLXRoaXMudnhbaV07IH1cbiAgICAgICAgZWxzZSBpZiAobHggPCAtbGltKSB7IGx4ID0gLWxpbTsgaWYgKHRoaXMudnhbaV0gPCAwKSB0aGlzLnZ4W2ldID0gLXRoaXMudnhbaV07IH1cbiAgICAgICAgaWYgKGx6ID4gbGltKSB7IGx6ID0gbGltOyBpZiAodGhpcy52eltpXSA+IDApIHRoaXMudnpbaV0gPSAtdGhpcy52eltpXTsgfVxuICAgICAgICBlbHNlIGlmIChseiA8IC1saW0pIHsgbHogPSAtbGltOyBpZiAodGhpcy52eltpXSA8IDApIHRoaXMudnpbaV0gPSAtdGhpcy52eltpXTsgfVxuICAgICAgfSBlbHNlIGlmIChzICE9PSBTVF9GTEVFKSB7XG4gICAgICAgIC8vIG1pbGxpbmcgY2l2aWxpYW5zIGtlZXAgdG8gdGhlIHNpZGV3YWxrIGJhbmQg4oCUIG9yIHRoZSBwYXZlZCBmb3JlY291cnQgYmV0d2VlbiBpdCBhbmQgdGhlXG4gICAgICAgIC8vIGZhY2FkZXMgKG5ldmVyIGNsb3NlciB0aGFuIH4wLjkgbSB0byBhIGJ1aWxkaW5nKTsgYXQgdGhlIGVuZCBvZiBhIHNpZGUgdGhleSB0dXJuIHRoZVxuICAgICAgICAvLyBjb3JuZXIgb250byB0aGUgYWRqYWNlbnQgc2lkZSBvZiB0aGUgc2FtZSBibG9jayAoYSBjaXZpbGlhbiB0aGF0IGZsZWQgb250byB0aGUgcm9hZCB3YWxrc1xuICAgICAgICAvLyBiYWNrIHRvIHRoZSBjdXJiIGluc3RlYWQgb2Ygc25hcHBpbmcpXG4gICAgICAgIGNvbnN0IGF4ID0gTWF0aC5hYnMobHgpLCBheiA9IE1hdGguYWJzKGx6KTtcbiAgICAgICAgY29uc3Qgc3RlcCA9IDIuMiAqIGR0O1xuICAgICAgICBjb25zdCB2eGkgPSB0aGlzLnZ4W2ldLCB2emkgPSB0aGlzLnZ6W2ldO1xuICAgICAgICBjb25zdCB3YWxraW5nID0gdnhpICogdnhpICsgdnppICogdnppID4gMC4wMDI1O1xuICAgICAgICBjb25zdCB4U2lkZSA9IHdhbGtpbmcgPyBNYXRoLmFicyh2emkpID49IE1hdGguYWJzKHZ4aSkgOiBheCA+PSBhejtcbiAgICAgICAgaWYgKHhTaWRlKSB7XG4gICAgICAgICAgY29uc3Qgc2cgPSBNYXRoLnNpZ24obHggfHwgMSk7XG4gICAgICAgICAgY29uc3QgaW5uZXIgPSB0aGlzLmlubmVyTGltaXQoY2l0eSwgYngsIGJ6LCBjeCwgY3osIGZhbHNlLCBzZywgeiwgdnppLCBzY2FsZSk7XG4gICAgICAgICAgY29uc3Qgd250ID0gTWF0aC5taW4oU1dfT1VULCBNYXRoLm1heChpbm5lciwgYXgpKTtcbiAgICAgICAgICBseCA9IHNnICogKGF4ICsgTWF0aC5tYXgoLXN0ZXAsIE1hdGgubWluKHN0ZXAsIHdudCAtIGF4KSkpO1xuICAgICAgICAgIGlmICh3YWxraW5nICYmIE1hdGguYWJzKGx6KSA+IFNXX09VVCAtIDAuMjUgJiYgbHogKiB2emkgPiAwKSB7IGx6ID0gTWF0aC5zaWduKGx6KSAqIChTV19PVVQgLSAwLjI1KTsgdGhpcy50dXJuQ29ybmVyKGksIHRydWUsIHNnKTsgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHNnID0gTWF0aC5zaWduKGx6IHx8IDEpO1xuICAgICAgICAgIGNvbnN0IGlubmVyID0gdGhpcy5pbm5lckxpbWl0KGNpdHksIGJ4LCBieiwgY3gsIGN6LCB0cnVlLCBzZywgeCwgdnhpLCBzY2FsZSk7XG4gICAgICAgICAgY29uc3Qgd250ID0gTWF0aC5taW4oU1dfT1VULCBNYXRoLm1heChpbm5lciwgYXopKTtcbiAgICAgICAgICBseiA9IHNnICogKGF6ICsgTWF0aC5tYXgoLXN0ZXAsIE1hdGgubWluKHN0ZXAsIHdudCAtIGF6KSkpO1xuICAgICAgICAgIGlmICh3YWxraW5nICYmIE1hdGguYWJzKGx4KSA+IFNXX09VVCAtIDAuMjUgJiYgbHggKiB2eGkgPiAwKSB7IGx4ID0gTWF0aC5zaWduKGx4KSAqIChTV19PVVQgLSAwLjI1KTsgdGhpcy50dXJuQ29ybmVyKGksIGZhbHNlLCBzZyk7IH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgeCA9IGN4ICsgbHg7IHogPSBjeiArIGx6O1xuICAgICAgLy8gYnVpbGRpbmdzIChuZXZlciBydW4gdGhyb3VnaCBvbmUpLCBwYXJrZWQgY2Fycywga2lvc2tzLCBiZW5jaGVzLCBsYW1wcywgdHJlZXM6IGdvIEFST1VORFxuICAgICAgaWYgKHMgIT09IFNUX0lETEUpIHtcbiAgICAgICAgdGhpcy5wMy5zZXQoeCwgMCwgeik7XG4gICAgICAgIHRoaXMuYXZvaWRCdWlsZGluZ3MoaSwgY2l0eSwgYngsIGJ6LCBib2R5KTtcbiAgICAgICAgdGhpcy5hdm9pZFByb3BzKGksIGNpdHksIGJ4LCBieiwgYm9keSwgcyA9PT0gU1RfRkxFRSk7XG4gICAgICAgIHggPSB0aGlzLnAzLng7IHogPSB0aGlzLnAzLno7XG4gICAgICB9XG4gICAgICBjb25zdCBiYiA9IGNpdHkuYm91bmRzO1xuICAgICAgaWYgKHggPCBiYi5taW5YIHx8IHggPiBiYi5tYXhYIHx8IHogPCBiYi5taW5aIHx8IHogPiBiYi5tYXhaIHx8ICh0aGlzLndhdGVyWiAhPT0gbnVsbCAmJiB6IDwgdGhpcy53YXRlclopKSB7XG4gICAgICAgIHRoaXMuc3RbaV0gPSBTVF9FTVBUWTsgY29udGludWU7XG4gICAgICB9XG4gICAgICB0aGlzLnhbaV0gPSB4OyB0aGlzLnpbaV0gPSB6O1xuICAgICAgbHggPSB4IC0gY3g7IGx6ID0geiAtIGN6O1xuICAgICAgaWYgKHMgPT09IFNUX0ZMRUUpIHsgZmxlZWluZysrOyBpZiAoYXVkaXQgJiYgdGhpcy5pblByb3AoY2l0eSwgeCwgeiwgMCkpIGluUHJvcCsrOyB9XG4gICAgICBlbHNlIGlmICh0aGlzLmluUGFya1tpXSkgcGFya2VycysrO1xuICAgICAgZWxzZSBpZiAoTWF0aC5tYXgoTWF0aC5hYnMobHgpLCBNYXRoLmFicyhseikpIDwgU1dfSU4gLSAwLjMpIGZvcmVjb3VydCsrO1xuXG4gICAgICAvLyDilIDilIAgcG9zZSDilIDilIBcbiAgICAgIGNvbnN0IGR4ID0geCAtIHR4LCBkeiA9IHogLSB0ejtcbiAgICAgIGNvbnN0IGQgPSBNYXRoLmh5cG90KGR4LCBkeikgfHwgMWUtMztcbiAgICAgIGNvbnN0IHZ4ID0gdGhpcy52eFtpXSwgdnogPSB0aGlzLnZ6W2ldO1xuICAgICAgY29uc3QgdiA9IE1hdGguaHlwb3QodngsIHZ6KTtcbiAgICAgIGNvbnN0IHRvVCA9IE1hdGguYXRhbjIodHggLSB4LCB0eiAtIHopO1xuICAgICAgaWYgKHYgPiAwLjA1KSB0aGlzLmhkW2ldID0gcyA9PT0gU1RfRkxFRSA/IE1hdGguYXRhbjIodngsIHZ6KSA6IHR1cm5Ub3dhcmQodGhpcy5oZFtpXSwgTWF0aC5hdGFuMih2eCwgdnopLCBkdCAqIDgpO1xuICAgICAgZWxzZSBpZiAocyA9PT0gU1RfSURMRSkgdGhpcy5oZFtpXSA9IHR1cm5Ub3dhcmQodGhpcy5oZFtpXSwgdG9ULCBkdCAqIDMuNSk7ICAgLy8gdHVybiB0byBnYXdrIGF0IHRoZSB0aXRhblxuICAgICAgY29uc3Qgc2MgPSBzY2FsZSAqICh0aWVyID09PSAwID8gMSA6IGFyLmxvZCk7XG4gICAgICAvLyBnYWl0IHBoYXNlIGxvY2tlZCB0byBncm91bmQgc3BlZWQ6IG9uZSBsZWcgY3ljbGUgPSB0d28gc3RyaWRlc1xuICAgICAgY29uc3Qgc3RyaWRlID0gYXIuc3RyaWRlICogc2NhbGU7XG4gICAgICAvLyBzd2luZyBhbXBsaXR1ZGU6IGNvYXRzIC8gc2tpcnRzIC8gZWxkZXJzIHN3aW5nIGxlc3MgKGxlZ3Mgc3RheSBpbnNpZGUgdGhlIGhlbSlcbiAgICAgIGNvbnN0IHRhcmdldEFtcCA9IChzID09PSBTVF9GTEVFID8gKHRoaXMucG9zZVtpXSA9PT0gUF9QQU5JQyA/IDAuODUgOiAxLjIpICsgMC4xNSAqIGFyLnN3aW5nIDogTWF0aC5taW4oMSwgdiAvIDAuOCkpICogYXIuc3dpbmc7XG4gICAgICB0aGlzLmFtcFtpXSArPSAodGFyZ2V0QW1wIC0gdGhpcy5hbXBbaV0pICogKGR0ID4gMCA/IE1hdGgubWluKDEsIGR0ICogNikgOiAxKTtcbiAgICAgIHRoaXMucGhbaV0gKz0gZHQgKiAodiA+IDAuMDUgPyBNYXRoLm1pbigyMCwgKHYgLyBzdHJpZGUpICogTWF0aC5QSSkgOiAzLjIpO1xuICAgICAgLy8gaGVhZDogZ2F3a2VycyBsb29rIFVQIGF0IHRoZSB0aXRhbjsgd2Fsa2VycyBnbGFuY2UgYXQgaXQgd2hlbiBpdCBpcyBjbG9zZVxuICAgICAgbGV0IHlhd1QgPSAwLCBwaXRjaFQgPSAwO1xuICAgICAgaWYgKHMgIT09IFNUX0ZMRUUgJiYgZHggKiBkeCArIGR6ICogZHogPCBnbGFuY2VSMikge1xuICAgICAgICB5YXdUID0gd3JhcFBpKHRvVCAtIHRoaXMuaGRbaV0pO1xuICAgICAgICB5YXdUID0gTWF0aC5tYXgoLTEuMDUsIE1hdGgubWluKDEuMDUsIHlhd1QpKTtcbiAgICAgICAgY29uc3QgZXllID0gMS4zNSAqIHNjO1xuICAgICAgICBwaXRjaFQgPSBNYXRoLm1heCgtMC4xLCBNYXRoLm1pbigwLjYyLCBNYXRoLmF0YW4yKEggKiAwLjggLSBleWUsIGQpKSk7XG4gICAgICAgIGlmIChzID09PSBTVF9NSUxMKSB7IHlhd1QgKj0gMC44OyBwaXRjaFQgKj0gMC42OyB9XG4gICAgICB9IGVsc2UgaWYgKHMgPT09IFNUX0ZMRUUpIHtcbiAgICAgICAgeWF3VCA9IDAuNSAqIE1hdGguc2luKHRoaXMucGhbaV0gKiAwLjM3ICsgaSk7ICAgICAgICAgICAgICAgICAgICAgLy8gYSBwYW5pY2tlZCBsb29rIGJhY2tcbiAgICAgIH1cbiAgICAgIGNvbnN0IGhrID0gZHQgPiAwID8gTWF0aC5taW4oMSwgZHQgKiA1KSA6IDE7ICAgICAgICAgIC8vIGZyb3plbiBmcmFtZXMgKHNsYXRlKSBzbmFwIHRvIHRoZSBwb3NlXG4gICAgICB0aGlzLmh5W2ldICs9ICh5YXdUIC0gdGhpcy5oeVtpXSkgKiBoaztcbiAgICAgIHRoaXMuaHBbaV0gKz0gKHBpdGNoVCAtIHRoaXMuaHBbaV0pICogaGs7XG5cbiAgICAgIGNvbnN0IGNlbGxSID0gTWF0aC5tYXgoTWF0aC5hYnMobHgpLCBNYXRoLmFicyhseikpO1xuICAgICAgY29uc3QgYW0gPSB0aGlzLmFtcFtpXTtcbiAgICAgIGNvbnN0IGJvYiA9IE1hdGguYWJzKE1hdGguc2luKHRoaXMucGhbaV0pKSAqIChzID09PSBTVF9GTEVFID8gMC4wNzUgOiAwLjAzKSAqIGFtICogc2M7XG4gICAgICBjb25zdCB5ID0gKGNlbGxSIDw9IFNXX09VVCArIDAuMDUgPyBTSURFV0FMS19ZIDogMCkgKyBib2I7XG5cbiAgICAgIC8vIG5lYXItY2FtZXJhIHJ1bGVzOiBubyBnaWFudCBmaWd1cmVzIHJpZ2h0IHVuZGVyIHRoZSBsZW5zLCBubyBiaWcgY3V0LW9mZiBvbmVzIGluIHN0aWxsIGZyYW1lc1xuICAgICAgY29uc3QgY2R4ID0geCAtIGNhbVAueCwgY2R5ID0geSArIDAuNzUgKiBzYyAtIGNhbVAueSwgY2R6ID0geiAtIGNhbVAuejtcbiAgICAgIGNvbnN0IHB4ID0gKEZJR19IICogc2MgKiB0aGlzLnB4SykgLyBNYXRoLm1heCgwLjAxLCBNYXRoLmh5cG90KGNkeCwgY2R5LCBjZHopKTtcbiAgICAgIGlmIChweCA+IHB4TWF4KSBweE1heCA9IHB4O1xuICAgICAgaWYgKHB4ID4gZmlnUHggKiBEUkFXX05FQVIpIHsgY3VsbGVkTmVhcisrOyBjb250aW51ZTsgfVxuICAgICAgaWYgKGYuZnJvemVuICYmIHB4ID4gZmlnUHggKiBFREdFX05FQVIgJiYgdGhpcy5jdXRCeUVkZ2UoeCwgeSwgeiwgc2MsIHRydWUpKSB7IGN1bGxlZEVkZ2UrKzsgY29udGludWU7IH1cblxuICAgICAgY29uc3QgbGVhbiA9IHMgPT09IFNUX0ZMRUUgPyAodGhpcy5wb3NlW2ldID09PSBQX1BBTklDID8gMC4xMiA6IDAuMjQpIDogMC4wMyAqIGFtO1xuICAgICAgdGhpcy5ldWwuc2V0KGxlYW4sIHRoaXMuaGRbaV0sIE1hdGguc2luKHRoaXMucGhbaV0pICogMC4wMzUgKiBhbSk7XG4gICAgICB0aGlzLnEuc2V0RnJvbUV1bGVyKHRoaXMuZXVsKTtcbiAgICAgIHRoaXMucDMuc2V0KHgsIHksIHopO1xuICAgICAgY29uc3QgaHYgPSB0aGlzLmh2YXJbaV07XG4gICAgICB0aGlzLnMzLnNldChzYyAqICgwLjk2ICsgMC4wOCAqIGh2KSwgc2MgKiAoMC45MiArIDAuMTYgKiBodiksIHNjICogKDAuOTYgKyAwLjA4ICogaHYpKTtcbiAgICAgIHRoaXMubTQuY29tcG9zZSh0aGlzLnAzLCB0aGlzLnEsIHRoaXMuczMpO1xuXG4gICAgICBjb25zdCBiOiBCYXRjaCA9IHRpZXIgPT09IDAgPyB0aGlzLmJhdGNoZXNbdGhpcy5hcmNoW2ldXSA6IHRpZXIgPT09IDEgPyB0aGlzLm1pZCA6IHRoaXMubG9kO1xuICAgICAgY29uc3QgazogbnVtYmVyID0gYi5uKys7XG4gICAgICBiLm1lc2guc2V0TWF0cml4QXQoaywgdGhpcy5tNCk7XG4gICAgICBjb25zdCBvID0gaSAqIDIwLCBrNCA9IGsgKiA0O1xuICAgICAgY29uc3QgQSA9IGIuYXJycywgQyA9IHRoaXMuY29sO1xuICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA1OyBjKyspIHtcbiAgICAgICAgY29uc3QgZHN0ID0gQVtjXSwgc28gPSBvICsgYyAqIDQ7XG4gICAgICAgIGRzdFtrNF0gPSBDW3NvXTsgZHN0W2s0ICsgMV0gPSBDW3NvICsgMV07IGRzdFtrNCArIDJdID0gQ1tzbyArIDJdOyBkc3RbazQgKyAzXSA9IENbc28gKyAzXTtcbiAgICAgIH1cbiAgICAgIEFbMl1bazQgKyAzXSA9IHRoaXMuaHBbaV07XG4gICAgICBjb25zdCBhbiA9IEFbNV07XG4gICAgICBhbltrNF0gPSB0aGlzLnBoW2ldOyBhbltrNCArIDFdID0gYW07IGFuW2s0ICsgMl0gPSB0aGlzLnBvc2VbaV07IGFuW2s0ICsgM10gPSB0aGlzLmh5W2ldO1xuICAgICAgbisrO1xuICAgIH1cbiAgICBjb25zdCB0RSA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHRoaXMuZGJnLm1zU3Bhd24gPSBNYXRoLnJvdW5kKCh0UCAtIHRTKSAqIDEwMCkgLyAxMDA7IHRoaXMuZGJnLm1zU2VwID0gTWF0aC5yb3VuZCgodEwgLSB0UCkgKiAxMDApIC8gMTAwOyB0aGlzLmRiZy5tc0xvb3AgPSBNYXRoLnJvdW5kKCh0RSAtIHRMKSAqIDEwMCkgLyAxMDA7XG4gICAgdGhpcy5saXZlID0gbjtcbiAgICB0aGlzLmRiZy5saXZlID0gbjsgdGhpcy5kYmcuZmxlZWluZyA9IGZsZWVpbmc7IGlmIChhdWRpdCkgdGhpcy5kYmcuaW5Qcm9wID0gaW5Qcm9wOyB0aGlzLmRiZy5pblBhcmsgPSBwYXJrZXJzOyB0aGlzLmRiZy5mb3JlY291cnQgPSBmb3JlY291cnQ7IHRoaXMuZGJnLmN1bGxlZE5lYXIgPSBjdWxsZWROZWFyOyB0aGlzLmRiZy5jdWxsZWRFZGdlID0gY3VsbGVkRWRnZTsgdGhpcy5kYmcucHhNYXggPSBNYXRoLnJvdW5kKHB4TWF4KTtcbiAgICBmb3IgKGNvbnN0IGIgb2YgdGhpcy5iYXRjaGVzKSB0aGlzLmZsdXNoKGIpO1xuICAgIHRoaXMuZmx1c2godGhpcy5taWQpO1xuICAgIHRoaXMuZmx1c2godGhpcy5sb2QpO1xuXG4gICAgLy8g4pSA4pSAIHB1ZmZzIOKUgOKUgFxuICAgIGxldCBucCA9IDA7XG4gICAgZm9yIChsZXQgayA9IDA7IGsgPCBQVUZGX0NBUDsgaysrKSB7XG4gICAgICBjb25zdCBwID0gdGhpcy5wdWZmTGlzdFtrXTtcbiAgICAgIGlmIChwLnQgPj0gUFVGRl9MSUZFKSBjb250aW51ZTtcbiAgICAgIHAudCArPSBkdDtcbiAgICAgIGlmIChwLnQgPj0gUFVGRl9MSUZFKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHUgPSBwLnQgLyBQVUZGX0xJRkU7XG4gICAgICBjb25zdCBncm93ID0gdSA8IDAuMyA/IDAuNCArICh1IC8gMC4zKSAqIDAuNzUgOiAxLjE1ICogKDEgLSAodSAtIDAuMykgLyAwLjcpO1xuICAgICAgZm9yIChsZXQgYmIgPSAwOyBiYiA8IFBVRkZfQkFMTFM7IGJiKyspIHtcbiAgICAgICAgY29uc3QgYW5nID0gYmIgKiAyLjA5NCArIGs7XG4gICAgICAgIGNvbnN0IHIgPSBwLnMgKiAoMC4yNSArIHUgKiAwLjUpO1xuICAgICAgICB0aGlzLnAzLnNldChwLnggKyBNYXRoLmNvcyhhbmcpICogciwgcC55ICsgcC5zICogKDAuMjUgKyB1ICogMC41NSArIGJiICogMC4xMiksIHAueiArIE1hdGguc2luKGFuZykgKiByKTtcbiAgICAgICAgY29uc3QgYnMgPSBwLnMgKiBncm93ICogKDAuNTUgKyAwLjIgKiBiYik7XG4gICAgICAgIHRoaXMuczMuc2V0KGJzLCBicyAqIDAuODUsIGJzKTtcbiAgICAgICAgdGhpcy5ldWwuc2V0KGssIGFuZywgMCk7XG4gICAgICAgIHRoaXMucS5zZXRGcm9tRXVsZXIodGhpcy5ldWwpO1xuICAgICAgICB0aGlzLm00LmNvbXBvc2UodGhpcy5wMywgdGhpcy5xLCB0aGlzLnMzKTtcbiAgICAgICAgdGhpcy5wdWZmcy5zZXRNYXRyaXhBdChucCsrLCB0aGlzLm00KTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5wdWZmcy5jb3VudCA9IG5wO1xuICAgIHRoaXMucHVmZnMudmlzaWJsZSA9IG5wID4gMDtcbiAgICBpZiAobnAgPiAwKSB0aGlzLnB1ZmZzLmluc3RhbmNlTWF0cml4Lm5lZWRzVXBkYXRlID0gdHJ1ZTtcbiAgICAvLyBkZWJ1ZyAvIHRlc3RzOiBDUFUgY29zdCBvZiB0aGlzIHVwZGF0ZSAoc21vb3RoZWQpXG4gICAgdGhpcy5kYmcubXMgPSBNYXRoLnJvdW5kKCh0aGlzLmRiZy5tcyAqIDAuOSArIChwZXJmb3JtYW5jZS5ub3coKSAtIHQwKSAqIDAuMSkgKiAxMDAwKSAvIDEwMDA7XG4gIH1cblxuICAvKiogdXBsb2FkIG9ubHkgdGhlIGxpdmUgcmFuZ2Ugb2YgYSBiYXRjaCAqL1xuICBwcml2YXRlIGZsdXNoKGI6IEJhdGNoKTogdm9pZCB7XG4gICAgY29uc3QgbiA9IGIubjtcbiAgICBiLm1lc2guY291bnQgPSBuO1xuICAgIGIubWVzaC52aXNpYmxlID0gbiA+IDA7XG4gICAgaWYgKG4gPT09IDApIHJldHVybjtcbiAgICBjb25zdCBpbSA9IGIubWVzaC5pbnN0YW5jZU1hdHJpeDtcbiAgICBpbS5jbGVhclVwZGF0ZVJhbmdlcygpOyBpbS5hZGRVcGRhdGVSYW5nZSgwLCBuICogMTYpOyBpbS5uZWVkc1VwZGF0ZSA9IHRydWU7XG4gICAgZm9yIChjb25zdCBhdCBvZiBiLmF0dHJzKSB7IGF0LmNsZWFyVXBkYXRlUmFuZ2VzKCk7IGF0LmFkZFVwZGF0ZVJhbmdlKDAsIG4gKiA0KTsgYXQubmVlZHNVcGRhdGUgPSB0cnVlOyB9XG4gIH1cblxuICB1bm1vdW50KCk6IHZvaWQge1xuICAgIHRoaXMucm9vdC5yZW1vdmVGcm9tUGFyZW50KCk7XG4gICAgZm9yIChjb25zdCBiIG9mIHRoaXMuYmF0Y2hlcykgYi5tZXNoLmRpc3Bvc2UoKTtcbiAgICB0aGlzLm1pZD8ubWVzaC5kaXNwb3NlKCk7XG4gICAgdGhpcy5sb2Q/Lm1lc2guZGlzcG9zZSgpO1xuICAgIHRoaXMucHVmZnM/LmRpc3Bvc2UoKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgdGhpcy5kaXNwb3NhYmxlcykgZC5kaXNwb3NlKCk7XG4gICAgdGhpcy5kaXNwb3NhYmxlcyA9IFtdO1xuICAgIHRoaXMucm9vdC5jbGVhcigpO1xuICAgIHRoaXMuYmF0Y2hlcyA9IFtdO1xuICAgIHRoaXMubWlkID0gbnVsbDtcbiAgICB0aGlzLmxvZCA9IG51bGw7XG4gICAgdGhpcy5wdWZmcyA9IG51bGw7XG4gICAgdGhpcy5zdC5maWxsKFNUX0VNUFRZKTtcbiAgICB0aGlzLmxpdmUgPSAwO1xuICB9XG5cbiAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAIGludGVybmFscyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgcHJpdmF0ZSBpbkxpdmVCbG9jayhjaXR5OiBXb3JsZFsnY2l0eSddLCB4OiBudW1iZXIsIHo6IG51bWJlciwgdGJ4OiBudW1iZXIsIHRiejogbnVtYmVyLCBsaXZlUjogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgY29uc3QgYnggPSBNYXRoLmZsb29yKCh4IC0gY2l0eS5vcmlnaW5YKSAvIGNpdHkucGl0Y2gpLCBieiA9IE1hdGguZmxvb3IoKHogLSBjaXR5Lm9yaWdpblopIC8gY2l0eS5waXRjaCk7XG4gICAgcmV0dXJuIE1hdGguYWJzKGJ4IC0gdGJ4KSA8PSBsaXZlUiAmJiBNYXRoLmFicyhieiAtIHRieikgPD0gbGl2ZVI7XG4gIH1cblxuICBwcml2YXRlIGFsaXZlKGk6IG51bWJlcik6IGJvb2xlYW4geyBjb25zdCBzID0gdGhpcy5zdFtpXTsgcmV0dXJuIHMgPT09IFNUX01JTEwgfHwgcyA9PT0gU1RfSURMRSB8fCBzID09PSBTVF9GTEVFOyB9XG5cbiAgLy8g4pSA4pSAIHNwYXRpYWwgaGFzaCDilIDilIBcbiAgcHJpdmF0ZSBoYXNoS2V5KGN4OiBudW1iZXIsIGN6OiBudW1iZXIpOiBudW1iZXIgeyByZXR1cm4gKE1hdGguaW11bChjeCwgNzM4NTYwOTMpIF4gTWF0aC5pbXVsKGN6LCAxOTM0OTY2MykpICYgKEhBU0ggLSAxKTsgfVxuXG4gIHByaXZhdGUgaGFzaEJ1aWxkKGNlbGw6IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMuaENlbGwgPSBjZWxsO1xuICAgIHRoaXMuaEhlYWQuZmlsbCgtMSk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBDQVA7IGkrKykgaWYgKHRoaXMuYWxpdmUoaSkpIHRoaXMuaGFzaEluc2VydChpKTtcbiAgfVxuXG4gIHByaXZhdGUgaGFzaEluc2VydChpOiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBjID0gdGhpcy5oQ2VsbDtcbiAgICBjb25zdCBrID0gdGhpcy5oYXNoS2V5KE1hdGguZmxvb3IodGhpcy54W2ldIC8gYyksIE1hdGguZmxvb3IodGhpcy56W2ldIC8gYykpO1xuICAgIHRoaXMuaE5leHRbaV0gPSB0aGlzLmhIZWFkW2tdOyB0aGlzLmhIZWFkW2tdID0gaTtcbiAgfVxuXG4gIC8qKiBpcyBhbnlib2R5IChhbGl2ZSwgaW4gdGhlIGhhc2gpIHdpdGhpbiByIG9mICh4LCB6KT8gKi9cbiAgcHJpdmF0ZSBjcm93ZGVkQXQoeDogbnVtYmVyLCB6OiBudW1iZXIsIHI6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGMgPSB0aGlzLmhDZWxsLCByMiA9IHIgKiByO1xuICAgIGNvbnN0IGN4ID0gTWF0aC5mbG9vcih4IC8gYyksIGN6ID0gTWF0aC5mbG9vcih6IC8gYyksIHJjID0gTWF0aC5jZWlsKHIgLyBjKTtcbiAgICBmb3IgKGxldCBveiA9IC1yYzsgb3ogPD0gcmM7IG96KyspIHtcbiAgICAgIGZvciAobGV0IG94ID0gLXJjOyBveCA8PSByYzsgb3grKykge1xuICAgICAgICBmb3IgKGxldCBqID0gdGhpcy5oSGVhZFt0aGlzLmhhc2hLZXkoY3ggKyBveCwgY3ogKyBveildOyBqID49IDA7IGogPSB0aGlzLmhOZXh0W2pdKSB7XG4gICAgICAgICAgaWYgKCF0aGlzLmFsaXZlKGopKSBjb250aW51ZTtcbiAgICAgICAgICBjb25zdCBkZHggPSB0aGlzLnhbal0gLSB4LCBkZHogPSB0aGlzLnpbal0gLSB6O1xuICAgICAgICAgIGlmIChkZHggKiBkZHggKyBkZHogKiBkZHogPCByMikgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqIHNlcGFyYXRpb24gc3RlZXJpbmc6IGEgaGFyZCBtaW5pbXVtIGRpc3RhbmNlIChwb3NpdGlvbiBwcm9qZWN0aW9uKSBwbHVzIGEgc29mdCB6b25lIHRoYXRcbiAgICogIG1ha2VzIHdhbGtlcnMgc2lkZS1zdGVwIGVhY2ggb3RoZXI7IGdhd2tlcnMgc3RhbmRpbmcgc3RpbGwgZ2l2ZSB3YXkgbGVzcy4gVGhyZWUgcGFzc2VzLiAqL1xuICBwcml2YXRlIHNlcGFyYXRlKHNjYWxlOiBudW1iZXIsIGR0OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBzZXAgPSBTRVBfSyAqIHNjYWxlLCBzb2Z0ID0gU09GVF9LICogc2NhbGUsIHNvZnQyID0gc29mdCAqIHNvZnQ7XG4gICAgY29uc3Qga1NvZnQgPSBNYXRoLm1pbigxLCBkdCAqIDQpO1xuICAgIGNvbnN0IFggPSB0aGlzLngsIFogPSB0aGlzLno7XG4gICAgbGV0IG1pbkQyID0gMWU5O1xuICAgIGZvciAobGV0IHBhc3MgPSAwOyBwYXNzIDwgMzsgcGFzcysrKSB7XG4gICAgICB0aGlzLmhhc2hCdWlsZChDRUxMX0sgKiBzY2FsZSk7XG4gICAgICBjb25zdCBjID0gdGhpcy5oQ2VsbDtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgQ0FQOyBpKyspIHtcbiAgICAgICAgaWYgKCF0aGlzLmFsaXZlKGkpKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgY3ggPSBNYXRoLmZsb29yKFhbaV0gLyBjKSwgY3ogPSBNYXRoLmZsb29yKFpbaV0gLyBjKTtcbiAgICAgICAgY29uc3Qgd2kgPSB0aGlzLnN0W2ldID09PSBTVF9JRExFID8gMC4zNSA6IDE7XG4gICAgICAgIGZvciAobGV0IG96ID0gLTE7IG96IDw9IDE7IG96KyspIHtcbiAgICAgICAgICBmb3IgKGxldCBveCA9IC0xOyBveCA8PSAxOyBveCsrKSB7XG4gICAgICAgICAgICBmb3IgKGxldCBqID0gdGhpcy5oSGVhZFt0aGlzLmhhc2hLZXkoY3ggKyBveCwgY3ogKyBveildOyBqID49IDA7IGogPSB0aGlzLmhOZXh0W2pdKSB7XG4gICAgICAgICAgICAgIGlmIChqIDw9IGkgfHwgIXRoaXMuYWxpdmUoaikpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICBsZXQgZGR4ID0gWFtqXSAtIFhbaV0sIGRkeiA9IFpbal0gLSBaW2ldO1xuICAgICAgICAgICAgICBjb25zdCBkMiA9IGRkeCAqIGRkeCArIGRkeiAqIGRkejtcbiAgICAgICAgICAgICAgaWYgKHBhc3MgPT09IDIgJiYgZDIgPCBtaW5EMikgbWluRDIgPSBkMjtcbiAgICAgICAgICAgICAgaWYgKGQyID49IHNvZnQyKSBjb250aW51ZTtcbiAgICAgICAgICAgICAgbGV0IGRkID0gTWF0aC5zcXJ0KGQyKTtcbiAgICAgICAgICAgICAgaWYgKGRkIDwgMWUtNCkgeyBjb25zdCBhbiA9IChpICogMi4zOTkgKyBqKSAlIDYuMjgzMjsgZGR4ID0gTWF0aC5jb3MoYW4pOyBkZHogPSBNYXRoLnNpbihhbik7IGRkID0gMDsgfVxuICAgICAgICAgICAgICBlbHNlIHsgZGR4IC89IGRkOyBkZHogLz0gZGQ7IH1cbiAgICAgICAgICAgICAgY29uc3QgcHVzaCA9IGRkIDwgc2VwID8gc2VwIC0gZGQgKyAoc29mdCAtIHNlcCkgKiBrU29mdCAqIDAuNSA6IChzb2Z0IC0gZGQpICoga1NvZnQgKiAwLjU7XG4gICAgICAgICAgICAgIGlmIChwdXNoIDw9IDApIGNvbnRpbnVlO1xuICAgICAgICAgICAgICBjb25zdCB3aiA9IHRoaXMuc3Rbal0gPT09IFNUX0lETEUgPyAwLjM1IDogMTtcbiAgICAgICAgICAgICAgY29uc3Qgc2ggPSBwdXNoIC8gKHdpICsgd2opO1xuICAgICAgICAgICAgICBYW2ldIC09IGRkeCAqIHNoICogd2k7IFpbaV0gLT0gZGR6ICogc2ggKiB3aTtcbiAgICAgICAgICAgICAgWFtqXSArPSBkZHggKiBzaCAqIHdqOyBaW2pdICs9IGRkeiAqIHNoICogd2o7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIC8vIGRlYnVnIC8gdGVzdHM6IGNsb3Nlc3QgcGFpciBzZWVuIGJ5IHRoZSBsYXN0IHBhc3MgKGJlZm9yZSBpdHMgY29ycmVjdGlvbiksIGluIG1ldHJlcyDDtyBjaXYgc2NhbGVcbiAgICB0aGlzLmRiZy5taW5HYXAgPSBtaW5EMiA8IDFlOCA/IE1hdGgucm91bmQoKE1hdGguc3FydChtaW5EMikgLyBzY2FsZSkgKiAxMDAwKSAvIDEwMDAgOiAtMTtcbiAgfVxuXG4gIC8qKiBwdXNoIGNpdmlsaWFuIGkgKHBvc2l0aW9uIGluIHAzKSBvdXQgb2YgYW55IHByb3AgZm9vdHByaW50IGluIGl0cyBibG9jayBjZWxsOyBhIGZsZWVpbmcgb25lXG4gICAqICBhbHNvIGxvb2tzIGFoZWFkIGFuZCBzd2VydmVzIGFyb3VuZCB0aGUgcHJvcCBpbnN0ZWFkIG9mIHBsb3VnaGluZyBpbnRvIGl0ICovXG4gIHByaXZhdGUgYXZvaWRQcm9wcyhpOiBudW1iZXIsIGNpdHk6IFdvcmxkWydjaXR5J10sIGJ4OiBudW1iZXIsIGJ6OiBudW1iZXIsIGJvZHk6IG51bWJlciwgZmxlZTogYm9vbGVhbik6IHZvaWQge1xuICAgIGlmIChieCA8IDAgfHwgYnogPCAwIHx8IGJ4ID49IGNpdHkuYmxvY2tzWCB8fCBieiA+PSBjaXR5LmJsb2Nrc1opIHJldHVybjtcbiAgICBjb25zdCBpZHMgPSBjaXR5LmJsb2NrUHJvcHNbYnggKyBieiAqIGNpdHkuYmxvY2tzWF07XG4gICAgbGV0IHggPSB0aGlzLnAzLngsIHogPSB0aGlzLnAzLno7XG4gICAgbGV0IHZ4ID0gdGhpcy52eFtpXSwgdnogPSB0aGlzLnZ6W2ldO1xuICAgIGNvbnN0IHNwID0gTWF0aC5oeXBvdCh2eCwgdnopO1xuICAgIGNvbnN0IGxvb2sgPSBmbGVlID8gMC43IDogMDtcbiAgICAvLyBsb29rLWFoZWFkIHNlZ21lbnQgbWlkcG9pbnQ6IG9uZSBjaXJjbGUgYXJvdW5kIGl0IGNvdmVycyB0aGUgd2hvbGUgc3dlcHQgcGF0aFxuICAgIGNvbnN0IGh4ID0gdnggKiBsb29rICogMC41LCBoeiA9IHZ6ICogbG9vayAqIDAuNSwgaHIgPSBzcCAqIGxvb2sgKiAwLjU7XG4gICAgZm9yIChsZXQgayA9IDA7IGsgPCBpZHMubGVuZ3RoOyBrKyspIHtcbiAgICAgIGNvbnN0IGlkID0gaWRzW2tdO1xuICAgICAgY29uc3QgcCA9IGNpdHkucHJvcHNbaWRdO1xuICAgICAgaWYgKCFwIHx8ICFwLmFsaXZlIHx8IGlkID49IHRoaXMucHJvcEhXLmxlbmd0aCkgY29udGludWU7XG4gICAgICBjb25zdCBodyA9IHRoaXMucHJvcEhXW2lkXSArIGJvZHksIGhsID0gdGhpcy5wcm9wSExbaWRdICsgYm9keTtcbiAgICAgIGNvbnN0IHIwID0gaHcgKyBobDsgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8g4omlIHRoZSBoYWxmLWRpYWdvbmFsOiBjaGVhcCBjaXJjbGUgcmVqZWN0cyBmaXJzdFxuICAgICAgbGV0IGR4ID0geCAtIHAueCwgZHogPSB6IC0gcC56O1xuICAgICAgaWYgKGR4ICogZHggKyBkeiAqIGR6ID4gcjAgKiByMCkge1xuICAgICAgICBjb25zdCBteCA9IGR4ICsgaHgsIG16ID0gZHogKyBoeiwgcm0gPSByMCArIGhyO1xuICAgICAgICBpZiAobG9vayA9PT0gMCB8fCBteCAqIG14ICsgbXogKiBteiA+IHJtICogcm0pIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdGhpcy5wcm9wVHJpZyhpZCwgcC5oZWFkaW5nKTtcbiAgICAgIGNvbnN0IHNuID0gdGhpcy50cmlnUywgY3MgPSB0aGlzLnRyaWdDO1xuICAgICAgLy8gbG9jYWwgZnJhbWU6IHUgYWxvbmcgdGhlIHByb3AncyB3aWR0aCAoWCksIHcgYWxvbmcgaXRzIGxlbmd0aCAoK1opXG4gICAgICBsZXQgdSA9IGR4ICogY3MgLSBkeiAqIHNuLCB3diA9IGR4ICogc24gKyBkeiAqIGNzO1xuICAgICAgaWYgKE1hdGguYWJzKHUpIDwgaHcgJiYgTWF0aC5hYnMod3YpIDwgaGwpIHtcbiAgICAgICAgLy8gaW5zaWRlOiBvdXQgdGhyb3VnaCB0aGUgbmVhcmVzdCBzaWRlLCBhbmQgZHJvcCB0aGUgaW53YXJkIHZlbG9jaXR5XG4gICAgICAgIGlmIChodyAtIE1hdGguYWJzKHUpIDwgaGwgLSBNYXRoLmFicyh3dikpIHUgPSBNYXRoLnNpZ24odSB8fCAxKSAqIGh3OyBlbHNlIHd2ID0gTWF0aC5zaWduKHd2IHx8IDEpICogaGw7XG4gICAgICAgIGNvbnN0IG54MCA9IHgsIG56MCA9IHo7XG4gICAgICAgIHRoaXMuZGJnLnByb3BQdXNoKys7XG4gICAgICAgIHggPSBwLnggKyB1ICogY3MgKyB3diAqIHNuOyB6ID0gcC56IC0gdSAqIHNuICsgd3YgKiBjcztcbiAgICAgICAgbGV0IG54ID0geCAtIG54MCwgbnogPSB6IC0gbnowO1xuICAgICAgICBjb25zdCBubCA9IE1hdGguaHlwb3QobngsIG56KTtcbiAgICAgICAgaWYgKG5sID4gMWUtNSkge1xuICAgICAgICAgIG54IC89IG5sOyBueiAvPSBubDtcbiAgICAgICAgICBjb25zdCB2biA9IHZ4ICogbnggKyB2eiAqIG56O1xuICAgICAgICAgIGlmICh2biA8IDApIHsgdnggLT0gdm4gKiBueDsgdnogLT0gdm4gKiBuejsgfVxuICAgICAgICB9XG4gICAgICAgIGR4ID0geCAtIHAueDsgZHogPSB6IC0gcC56O1xuICAgICAgfSBlbHNlIGlmIChsb29rID4gMCAmJiBzcCA+IDAuMSkge1xuICAgICAgICBjb25zdCBheCA9IGR4ICsgdnggKiBsb29rLCBheiA9IGR6ICsgdnogKiBsb29rO1xuICAgICAgICBjb25zdCB1YSA9IGF4ICogY3MgLSBheiAqIHNuLCB3YSA9IGF4ICogc24gKyBheiAqIGNzO1xuICAgICAgICBpZiAoTWF0aC5hYnModWEpIDwgaHcgJiYgTWF0aC5hYnMod2EpIDwgaGwpIHtcbiAgICAgICAgICAvLyBhYm91dCB0byBoaXQgaXQ6IHN3ZXJ2ZSB0byB0aGUgc2lkZSBvZiB0aGUgcHJvcCB3ZSBhcmUgYWxyZWFkeSBvblxuICAgICAgICAgIGxldCBweCA9IC12eiAvIHNwLCBweiA9IHZ4IC8gc3A7XG4gICAgICAgICAgaWYgKHB4ICogZHggKyBweiAqIGR6IDwgMCkgeyBweCA9IC1weDsgcHogPSAtcHo7IH1cbiAgICAgICAgICB2eCArPSBweCAqIHNwICogMC45OyB2eiArPSBweiAqIHNwICogMC45O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChmbGVlICYmIHNwID4gMC4xKSB7XG4gICAgICBjb25zdCBudiA9IE1hdGguaHlwb3QodngsIHZ6KTtcbiAgICAgIGlmIChudiA+IDFlLTQpIHsgdnggKj0gc3AgLyBudjsgdnogKj0gc3AgLyBudjsgfVxuICAgIH1cbiAgICB0aGlzLnZ4W2ldID0gdng7IHRoaXMudnpbaV0gPSB2ejtcbiAgICB0aGlzLnAzLnggPSB4OyB0aGlzLnAzLnogPSB6O1xuICB9XG5cbiAgcHJpdmF0ZSB0cmlnUyA9IDA7XG4gIHByaXZhdGUgdHJpZ0MgPSAxO1xuICAvKiogc2luIC8gY29zIG9mIGEgcHJvcCdzIGhlYWRpbmcgaW50byB0cmlnUyAvIHRyaWdDLCBjb21wdXRlZCBvbmNlIHBlciBwcm9wIHBlciBmcmFtZSAqL1xuICBwcml2YXRlIHByb3BUcmlnKGlkOiBudW1iZXIsIGhlYWRpbmc6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0aGlzLnByb3BTdGFtcFtpZF0gIT09IHRoaXMuZnJhbWVObykge1xuICAgICAgdGhpcy5wcm9wU3RhbXBbaWRdID0gdGhpcy5mcmFtZU5vO1xuICAgICAgdGhpcy5wcm9wU2luW2lkXSA9IE1hdGguc2luKGhlYWRpbmcpOyB0aGlzLnByb3BDb3NbaWRdID0gTWF0aC5jb3MoaGVhZGluZyk7XG4gICAgfVxuICAgIHRoaXMudHJpZ1MgPSB0aGlzLnByb3BTaW5baWRdOyB0aGlzLnRyaWdDID0gdGhpcy5wcm9wQ29zW2lkXTtcbiAgfVxuXG4gIC8qKiB3b3VsZCBhIGNpdmlsaWFuIHN0YW5kaW5nIGF0ICh4LCB6KSBiZSBpbnNpZGUgYSBwcm9wIGZvb3RwcmludD8gKi9cbiAgcHJpdmF0ZSBpblByb3AoY2l0eTogV29ybGRbJ2NpdHknXSwgeDogbnVtYmVyLCB6OiBudW1iZXIsIGJvZHk6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIGNvbnN0IFAgPSBjaXR5LnBpdGNoO1xuICAgIGNvbnN0IGJ4ID0gTWF0aC5mbG9vcigoeCAtIGNpdHkub3JpZ2luWCkgLyBQKSwgYnogPSBNYXRoLmZsb29yKCh6IC0gY2l0eS5vcmlnaW5aKSAvIFApO1xuICAgIGlmIChieCA8IDAgfHwgYnogPCAwIHx8IGJ4ID49IGNpdHkuYmxvY2tzWCB8fCBieiA+PSBjaXR5LmJsb2Nrc1opIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBpZHMgPSBjaXR5LmJsb2NrUHJvcHNbYnggKyBieiAqIGNpdHkuYmxvY2tzWF07XG4gICAgZm9yIChsZXQgayA9IDA7IGsgPCBpZHMubGVuZ3RoOyBrKyspIHtcbiAgICAgIGNvbnN0IGlkID0gaWRzW2tdO1xuICAgICAgY29uc3QgcCA9IGNpdHkucHJvcHNbaWRdO1xuICAgICAgaWYgKCFwIHx8ICFwLmFsaXZlIHx8IGlkID49IHRoaXMucHJvcEhXLmxlbmd0aCkgY29udGludWU7XG4gICAgICBjb25zdCBodyA9IHRoaXMucHJvcEhXW2lkXSArIGJvZHksIGhsID0gdGhpcy5wcm9wSExbaWRdICsgYm9keTtcbiAgICAgIGNvbnN0IGR4ID0geCAtIHAueCwgZHogPSB6IC0gcC56O1xuICAgICAgaWYgKGR4ICogZHggKyBkeiAqIGR6ID4gKGh3ICsgaGwpICogKGh3ICsgaGwpKSBjb250aW51ZTtcbiAgICAgIHRoaXMucHJvcFRyaWcoaWQsIHAuaGVhZGluZyk7XG4gICAgICBjb25zdCBzbiA9IHRoaXMudHJpZ1MsIGNzID0gdGhpcy50cmlnQztcbiAgICAgIGlmIChNYXRoLmFicyhkeCAqIGNzIC0gZHogKiBzbikgPCBodyAmJiBNYXRoLmFicyhkeCAqIHNuICsgZHogKiBjcykgPCBobCkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKiBhIGZpZ3VyZSBhdCAoeCwgeSwgeikgd291bGQgYmUgcGFydGx5IG9uIHNjcmVlbiBhbmQgcGFydGx5IGN1dCBvZmYgYnkgdGhlIHNjcmVlbiBlZGdlIOKAlCBvciwgaW5cbiAgICogIGEgc3RpbGwgZnJhbWUgKGBzdGlsbGApLCBzdGFuZCBpbiB0aGUgYm90dG9tIGNhcHRpb24gYmFuZCAoc2xhdGUgaGVhZGxpbmUgLyBQUkVTUyBBTlkgS0VZKSAqL1xuICBwcml2YXRlIGN1dEJ5RWRnZSh4OiBudW1iZXIsIHk6IG51bWJlciwgejogbnVtYmVyLCBzYzogbnVtYmVyLCBzdGlsbCA9IGZhbHNlKTogYm9vbGVhbiB7XG4gICAgY29uc3QgY2FtID0gdGhpcy5jdHguY2FtZXJhO1xuICAgIGNvbnN0IHYgPSB0aGlzLnYzO1xuICAgIGNvbnN0IE0gPSAwLjk3O1xuICAgIHYuc2V0KHgsIHksIHopLnByb2plY3QoY2FtKTtcbiAgICBpZiAoc3RpbGwgJiYgdi56IDwgMSAmJiB2LnkgPCBTVElMTF9CT1RUT00gJiYgdi55ID4gLTEuMyAmJiBNYXRoLmFicyh2LngpIDwgMS4zKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCBmZWV0SW4gPSB2LnogPCAxICYmIE1hdGguYWJzKHYueCkgPCBNICYmIE1hdGguYWJzKHYueSkgPCBNO1xuICAgIHYuc2V0KHgsIHkgKyBGSUdfSCAqIHNjLCB6KS5wcm9qZWN0KGNhbSk7XG4gICAgY29uc3QgaGVhZEluID0gdi56IDwgMSAmJiBNYXRoLmFicyh2LngpIDwgTSAmJiBNYXRoLmFicyh2LnkpIDwgTTtcbiAgICByZXR1cm4gZmVldEluICE9PSBoZWFkSW4gfHwgKCFmZWV0SW4gJiYgIWhlYWRJbiAmJiBNYXRoLmFicyh2LngpIDwgMS4zICYmIE1hdGguYWJzKHYueSkgPCAxLjMpO1xuICB9XG5cbiAgLyoqIGEgc3BvdCBpcyBmaW5lIGZvciB0aGUgY2FtZXJhOiBub3QgYSBnaWFudCByaWdodCB1bmRlciB0aGUgbGVucywgbm90IGEgYmlnIGZpZ3VyZSBjdXQgYnkgdGhlIGVkZ2UgKi9cbiAgcHJpdmF0ZSBjYW1Payh4OiBudW1iZXIsIHo6IG51bWJlciwgc2M6IG51bWJlciwgc3RpbGw6IGJvb2xlYW4pOiBib29sZWFuIHtcbiAgICBjb25zdCBjID0gdGhpcy5jdHguY2FtZXJhLnBvc2l0aW9uO1xuICAgIGNvbnN0IHB4ID0gKEZJR19IICogc2MgKiB0aGlzLnB4SykgLyBNYXRoLm1heCgwLjAxLCBNYXRoLmh5cG90KHggLSBjLngsIFNJREVXQUxLX1kgKyAwLjc1ICogc2MgLSBjLnksIHogLSBjLnopKTtcbiAgICBpZiAocHggPiB0aGlzLmZpZ1B4ICogU1BBV05fTkVBUikgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiAhKHB4ID4gdGhpcy5maWdQeCAqIEVER0VfTkVBUiAmJiB0aGlzLmN1dEJ5RWRnZSh4LCBTSURFV0FMS19ZLCB6LCBzYywgc3RpbGwpKTtcbiAgfVxuXG4gIHByaXZhdGUgZnJlZVNsb3QoKTogbnVtYmVyIHtcbiAgICBmb3IgKGxldCBuID0gMDsgbiA8IENBUDsgbisrKSB7XG4gICAgICBjb25zdCBpID0gKHRoaXMuZnJlZUN1cnNvciArIG4pICUgQ0FQO1xuICAgICAgaWYgKHRoaXMuc3RbaV0gPT09IFNUX0VNUFRZKSB7IHRoaXMuZnJlZUN1cnNvciA9IChpICsgMSkgJSBDQVA7IHJldHVybiBpOyB9XG4gICAgfVxuICAgIHJldHVybiAtMTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGF3biBhIHNtYWxsIGdyb3VwICgx4oCTNSkgYXJvdW5kIG9uZSBhbmNob3Igc3BvdDogc3Ryb2xsZXJzIHdhbGsgc2lkZSBieSBzaWRlIC8gaW4gcGFpcnMsXG4gICAqIGdhd2tlcnMgc3RhbmQgaW4gYSBsb29zZSBzdGFnZ2VyZWQgYXJjIGZhY2luZyB0aGUgdGl0YW4gKHRoZSBlbmRzIGEgc3RlcCBjbG9zZXIgdG8gaXQpLlxuICAgKiBTaWRld2FsayBncm91cHMgdXNlIHRoZSB3aG9sZSBzaWRld2FsayBkZXB0aDsgcGFyayAvIHBsYXphIGJsb2NrcyBnZXQgZ3JvdXBzIGluc2lkZSB0aGVtLlxuICAgKiBFdmVyeSBtZW1iZXIga2VlcHMgcGVyc29uYWwgc3BhY2UgZnJvbSBldmVyeW9uZSBhbHJlYWR5IHRoZXJlIGFuZCBmcm9tIHByb3BzLlxuICAgKiBSZXR1cm5zIGhvdyBtYW55IHdlcmUgcGxhY2VkLlxuICAgKi9cbiAgcHJpdmF0ZSBzcGF3bkdyb3VwKHc6IFdvcmxkLCB0eDogbnVtYmVyLCB0ejogbnVtYmVyLCBSOiBudW1iZXIsIEg6IG51bWJlciwgdGJ4OiBudW1iZXIsIHRiejogbnVtYmVyLCBsaXZlUjogbnVtYmVyLCBzY2FsZTogbnVtYmVyLCBtYXhOOiBudW1iZXIsIHN0aWxsOiBib29sZWFuKTogbnVtYmVyIHtcbiAgICBjb25zdCBjaXR5ID0gdy5jaXR5O1xuICAgIGNvbnN0IFAgPSBjaXR5LnBpdGNoO1xuICAgIGNvbnN0IG1pbkQgPSBNYXRoLm1pbihSICogMC43LCBIICogMyk7XG4gICAgY29uc3QgZ3NwID0gR1JPVVBfU1BfSyAqIHNjYWxlO1xuICAgIGNvbnN0IGJvZHkgPSBCT0RZX0sgKiBzY2FsZTtcbiAgICBmb3IgKGxldCB0cmllcyA9IDA7IHRyaWVzIDwgMTA7IHRyaWVzKyspIHtcbiAgICAgIGNvbnN0IGFuZyA9IE1hdGgucmFuZG9tKCkgKiBNYXRoLlBJICogMjtcbiAgICAgIGNvbnN0IHJyID0gTWF0aC5zcXJ0KE1hdGgucmFuZG9tKCkpICogUjtcbiAgICAgIGNvbnN0IHN4ID0gdHggKyBNYXRoLmNvcyhhbmcpICogcnIsIHN6ID0gdHogKyBNYXRoLnNpbihhbmcpICogcnI7XG4gICAgICBjb25zdCBieCA9IE1hdGguZmxvb3IoKHN4IC0gY2l0eS5vcmlnaW5YKSAvIFApLCBieiA9IE1hdGguZmxvb3IoKHN6IC0gY2l0eS5vcmlnaW5aKSAvIFApO1xuICAgICAgaWYgKGJ4IDwgMCB8fCBieiA8IDAgfHwgYnggPj0gY2l0eS5ibG9ja3NYIHx8IGJ6ID49IGNpdHkuYmxvY2tzWikgY29udGludWU7XG4gICAgICBpZiAoTWF0aC5hYnMoYnggLSB0YngpID4gbGl2ZVIgfHwgTWF0aC5hYnMoYnogLSB0YnopID4gbGl2ZVIpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgY3ggPSBjaXR5Lm9yaWdpblggKyAoYnggKyAwLjUpICogUCwgY3ogPSBjaXR5Lm9yaWdpblogKyAoYnogKyAwLjUpICogUDtcbiAgICAgIGxldCBseCA9IHN4IC0gY3gsIGx6ID0gc3ogLSBjejtcbiAgICAgIGNvbnN0IHBhcmsgPSB0aGlzLnBhcmtDZWxsW2J4ICsgYnogKiBjaXR5LmJsb2Nrc1hdID09PSAxICYmIE1hdGgucmFuZG9tKCkgPCAwLjg1O1xuICAgICAgY29uc3QgbGltID0gUEFSQ0VMX0hBTEYgLSAxLjI7XG4gICAgICBsZXQgYWxvbmdYID0gZmFsc2UsIGRzZ24gPSAxLCBpbm5lciA9IFNXX0lOO1xuICAgICAgaWYgKHBhcmspIHtcbiAgICAgICAgaWYgKE1hdGguYWJzKGx4KSA+IGxpbSB8fCBNYXRoLmFicyhseikgPiBsaW0pIHsgbHggPSAoTWF0aC5yYW5kb20oKSAqIDIgLSAxKSAqIGxpbTsgbHogPSAoTWF0aC5yYW5kb20oKSAqIDIgLSAxKSAqIGxpbTsgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gYW55d2hlcmUgYWNyb3NzIHRoZSBzaWRld2FsayBkZXB0aCDigJQgb3IgKDQwICUpIG91dCBvbiB0aGUgcGF2ZWQgZm9yZWNvdXJ0IGluIGZyb250IG9mIHRoZSBmYWNhZGVzXG4gICAgICAgIGFsb25nWCA9IE1hdGguYWJzKGx4KSA8IE1hdGguYWJzKGx6KTtcbiAgICAgICAgZHNnbiA9IE1hdGguc2lnbigoYWxvbmdYID8gbHogOiBseCkgfHwgMSk7XG4gICAgICAgIGlubmVyID0gdGhpcy5pbm5lckxpbWl0KGNpdHksIGJ4LCBieiwgY3gsIGN6LCBhbG9uZ1gsIGRzZ24sIGFsb25nWCA/IHN4IDogc3osIDAsIHNjYWxlKTtcbiAgICAgICAgY29uc3QgYmFuZCA9IGlubmVyIDwgU1dfSU4gLSAwLjYgJiYgTWF0aC5yYW5kb20oKSA8IDAuNFxuICAgICAgICAgID8gaW5uZXIgKyAwLjMgKyBNYXRoLnJhbmRvbSgpICogKFNXX0lOIC0gaW5uZXIgLSAwLjMpXG4gICAgICAgICAgOiBTV19JTiArIDAuMyArIE1hdGgucmFuZG9tKCkgKiAoU1dfT1VUIC0gU1dfSU4gLSAwLjYpO1xuICAgICAgICBpZiAoIWFsb25nWCkgeyBseCA9IGRzZ24gKiBiYW5kOyBseiA9IE1hdGgubWF4KC1TV19PVVQsIE1hdGgubWluKFNXX09VVCwgbHopKTsgfVxuICAgICAgICBlbHNlIHsgbHogPSBkc2duICogYmFuZDsgbHggPSBNYXRoLm1heCgtU1dfT1VULCBNYXRoLm1pbihTV19PVVQsIGx4KSk7IH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IGF4MCA9IGN4ICsgbHgsIGF6MCA9IGN6ICsgbHo7XG4gICAgICBpZiAodGhpcy53YXRlclogIT09IG51bGwgJiYgYXowIDwgdGhpcy53YXRlclogKyAyKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGQwID0gTWF0aC5oeXBvdChheDAgLSB0eCwgYXowIC0gdHopO1xuICAgICAgaWYgKGQwID4gUiAqIDEuMDUgfHwgZDAgPCBtaW5EKSBjb250aW51ZTtcbiAgICAgIGlmICghdGhpcy5jYW1PayhheDAsIGF6MCwgc2NhbGUsIHN0aWxsKSkgY29udGludWU7XG4gICAgICBpZiAodGhpcy5jcm93ZGVkQXQoYXgwLCBhejAsIEFOQ0hPUl9DTEVBUl9LICogc2NhbGUpKSBjb250aW51ZTtcbiAgICAgIGlmICh0aGlzLmluUHJvcChjaXR5LCBheDAsIGF6MCwgYm9keSkgfHwgdGhpcy5pbkJ1aWxkaW5nKGNpdHksIGF4MCwgYXowLCAwLjYgKiBzY2FsZSkpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBncm91cCBmb3JtYXRpb24gZnJhbWU6IGYgPSBmb3J3YXJkICh3YWxraW5nIGRpcmVjdGlvbiwgb3IgdG93YXJkIHRoZSB0aXRhbiksIHIgPSByaWdodFxuICAgICAgY29uc3QgdSA9IE1hdGgucmFuZG9tKCk7XG4gICAgICBjb25zdCBuV2FudCA9IE1hdGgubWluKG1heE4sIHUgPCAwLjI2ID8gMSA6IHUgPCAwLjU2ID8gMiA6IHUgPCAwLjc4ID8gMyA6IHUgPCAwLjkyID8gNCA6IDUpO1xuICAgICAgY29uc3QgZ2F3ayA9IE1hdGgucmFuZG9tKCkgPCAwLjM0O1xuICAgICAgbGV0IGZ4OiBudW1iZXIsIGZ6OiBudW1iZXI7XG4gICAgICBpZiAoZ2F3aykgeyBmeCA9IHR4IC0gYXgwOyBmeiA9IHR6IC0gYXowOyBjb25zdCBsID0gTWF0aC5oeXBvdChmeCwgZnopIHx8IDE7IGZ4IC89IGw7IGZ6IC89IGw7IH1cbiAgICAgIGVsc2UgaWYgKHBhcmspIHsgY29uc3QgaCA9IE1hdGgucmFuZG9tKCkgKiBNYXRoLlBJICogMjsgZnggPSBNYXRoLnNpbihoKTsgZnogPSBNYXRoLmNvcyhoKTsgfVxuICAgICAgZWxzZSB7IGNvbnN0IGRpciA9IE1hdGgucmFuZG9tKCkgPCAwLjUgPyAtMSA6IDE7IGZ4ID0gYWxvbmdYID8gZGlyIDogMDsgZnogPSBhbG9uZ1ggPyAwIDogZGlyOyB9XG4gICAgICBjb25zdCByeCA9IGZ6LCByeiA9IC1meDtcbiAgICAgIGNvbnN0IHNwZDAgPSAwLjcgKyBNYXRoLnJhbmRvbSgpICogMC44O1xuICAgICAgY29uc3QgdDAgPSAyICsgTWF0aC5yYW5kb20oKSAqIDU7XG4gICAgICBsZXQgbGVhZGVyID0gLTEsIHBsYWNlZCA9IDA7XG4gICAgICBmb3IgKGxldCBtID0gMDsgbSA8IG5XYW50OyBtKyspIHtcbiAgICAgICAgbGV0IG94OiBudW1iZXIsIG96OiBudW1iZXI7XG4gICAgICAgIGlmIChnYXdrKSB7XG4gICAgICAgICAgLy8gbG9vc2UgYXJjIGZhY2luZyB0aGUgdGl0YW46IHNpZGUgYnkgc2lkZSwgZW5kcyBhIHN0ZXAgY2xvc2VyLCBhbHRlcm5hdGUgcm93cyBzdGFnZ2VyZWRcbiAgICAgICAgICBjb25zdCBhID0gKG0gLSAobldhbnQgLSAxKSAvIDIpICogZ3NwICogMS4wNTtcbiAgICAgICAgICBjb25zdCBmd2QgPSAoMC4zICogYSAqIGEpIC8gZ3NwIC0gKG0gJSAyKSAqIDAuMzUgKiBnc3AgKyAoTWF0aC5yYW5kb20oKSAtIDAuNSkgKiAwLjE1ICogZ3NwO1xuICAgICAgICAgIG94ID0gcnggKiBhICsgZnggKiBmd2Q7IG96ID0gcnogKiBhICsgZnogKiBmd2Q7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gcGFpcnMgc2lkZSBieSBzaWRlLCBwYWlycyBvbmUgYmVoaW5kIHRoZSBvdGhlclxuICAgICAgICAgIGNvbnN0IHJvdyA9IE1hdGguZmxvb3IobSAvIDIpLCBwYWlyID0gbldhbnQgLSByb3cgKiAyID49IDI7XG4gICAgICAgICAgY29uc3Qgc2lkZSA9IHBhaXIgPyAoKG0gJSAyKSAtIDAuNSkgKiBnc3AgOiAwO1xuICAgICAgICAgIGNvbnN0IGJhY2sgPSAtcm93ICogZ3NwICogMS4xNSArIChNYXRoLnJhbmRvbSgpIC0gMC41KSAqIDAuMTIgKiBnc3A7XG4gICAgICAgICAgb3ggPSByeCAqIHNpZGUgKyBmeCAqIGJhY2s7IG96ID0gcnogKiBzaWRlICsgZnogKiBiYWNrO1xuICAgICAgICB9XG4gICAgICAgIGxldCB4ID0gYXgwICsgb3gsIHogPSBhejAgKyBvejtcbiAgICAgICAgLy8ga2VlcCBzaWRld2FsayBtZW1iZXJzIG9uIHRoZSBiYW5kIChkZXB0aCBjbGFtcGVkLCBzdGF5cyBvbiB0aGlzIGJsb2NrIHNpZGUpXG4gICAgICAgIGlmICghcGFyaykge1xuICAgICAgICAgIGxldCBtbHggPSB4IC0gY3gsIG1seiA9IHogLSBjejtcbiAgICAgICAgICBpZiAoYWxvbmdYKSB7IG1seiA9IGRzZ24gKiBNYXRoLm1pbihTV19PVVQgLSAwLjE1LCBNYXRoLm1heChpbm5lciArIDAuMTUsIGRzZ24gKiBtbHopKTsgaWYgKE1hdGguYWJzKG1seCkgPiBTV19PVVQpIGNvbnRpbnVlOyB9XG4gICAgICAgICAgZWxzZSB7IG1seCA9IGRzZ24gKiBNYXRoLm1pbihTV19PVVQgLSAwLjE1LCBNYXRoLm1heChpbm5lciArIDAuMTUsIGRzZ24gKiBtbHgpKTsgaWYgKE1hdGguYWJzKG1seikgPiBTV19PVVQpIGNvbnRpbnVlOyB9XG4gICAgICAgICAgeCA9IGN4ICsgbWx4OyB6ID0gY3ogKyBtbHo7XG4gICAgICAgIH0gZWxzZSBpZiAoTWF0aC5hYnMoeCAtIGN4KSA+IGxpbSB8fCBNYXRoLmFicyh6IC0gY3opID4gbGltKSBjb250aW51ZTtcbiAgICAgICAgaWYgKHRoaXMud2F0ZXJaICE9PSBudWxsICYmIHogPCB0aGlzLndhdGVyWiArIDIpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoTWF0aC5oeXBvdCh4IC0gdHgsIHogLSB0eikgPCBtaW5EKSBjb250aW51ZTtcbiAgICAgICAgaWYgKG0gPiAwICYmICF0aGlzLmNhbU9rKHgsIHosIHNjYWxlLCBzdGlsbCkpIGNvbnRpbnVlO1xuICAgICAgICBpZiAodGhpcy5jcm93ZGVkQXQoeCwgeiwgU1BBV05fU0VQX0sgKiBzY2FsZSkpIGNvbnRpbnVlO1xuICAgICAgICBpZiAodGhpcy5pblByb3AoY2l0eSwgeCwgeiwgYm9keSkgfHwgdGhpcy5pbkJ1aWxkaW5nKGNpdHksIHgsIHosIDAuNiAqIHNjYWxlKSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IGkgPSB0aGlzLmZyZWVTbG90KCk7XG4gICAgICAgIGlmIChpIDwgMCkgYnJlYWs7XG4gICAgICAgIGlmIChsZWFkZXIgPCAwKSBsZWFkZXIgPSBpO1xuICAgICAgICB0aGlzLmluaXRDaXZpbGlhbihpLCB3LmJpb21lSWQsIHgsIHosIHR4LCB0eiwgbGVhZGVyLCBwYXJrLCBnYXdrLCBmeCwgZnosIHNwZDAsIHQwICsgKGkgPT09IGxlYWRlciA/IDAgOiAwLjIgKyBNYXRoLnJhbmRvbSgpICogMC42KSk7XG4gICAgICAgIHRoaXMuaGFzaEluc2VydChpKTtcbiAgICAgICAgcGxhY2VkKys7XG4gICAgICB9XG4gICAgICBpZiAocGxhY2VkID4gMCkgcmV0dXJuIHBsYWNlZDtcbiAgICB9XG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICBwcml2YXRlIGluaXRDaXZpbGlhbihpOiBudW1iZXIsIGJpb21lOiBCaW9tZUlkLCB4OiBudW1iZXIsIHo6IG51bWJlciwgdHg6IG51bWJlciwgdHo6IG51bWJlciwgbGVhZGVyOiBudW1iZXIsIHBhcms6IGJvb2xlYW4sXG4gICAgZ2F3azogYm9vbGVhbiwgZng6IG51bWJlciwgZno6IG51bWJlciwgc3BkOiBudW1iZXIsIHQ6IG51bWJlcik6IHZvaWQge1xuICAgIC8vIGEgcmVjeWNsZWQgc2xvdCBtdXN0IG5vdCBrZWVwIGZvbGxvd2VycyBmcm9tIGl0cyBwcmV2aW91cyBsaWZlXG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBDQVA7IGorKykgaWYgKHRoaXMubGVhZFtqXSA9PT0gaSAmJiBqICE9PSBpKSB0aGlzLmxlYWRbal0gPSBqO1xuICAgIHRoaXMueFtpXSA9IHg7IHRoaXMueltpXSA9IHo7XG4gICAgdGhpcy5kcmVzc1VwKGksIGJpb21lKTtcbiAgICB0aGlzLmxlYWRbaV0gPSBsZWFkZXI7XG4gICAgdGhpcy5pblBhcmtbaV0gPSBwYXJrID8gMSA6IDA7XG4gICAgdGhpcy5waFtpXSA9IE1hdGgucmFuZG9tKCkgKiA2LjI4O1xuICAgIHRoaXMuaHlbaV0gPSAwOyB0aGlzLmhwW2ldID0gMDtcbiAgICB0aGlzLmh2YXJbaV0gPSBNYXRoLnJhbmRvbSgpO1xuICAgIGlmIChnYXdrKSB7XG4gICAgICB0aGlzLnNldElkbGUoaSk7XG4gICAgICB0aGlzLnRbaV0gPSB0O1xuICAgICAgdGhpcy5oZFtpXSA9IE1hdGguYXRhbjIodHggLSB4LCB0eiAtIHopICsgKE1hdGgucmFuZG9tKCkgLSAwLjUpICogMC4zNTtcbiAgICAgIHRoaXMuYW1wW2ldID0gMDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zdFtpXSA9IFNUX01JTEw7IHRoaXMucG9zZVtpXSA9IFBfV0FMSztcbiAgICAgIC8vIHRoZSBsZWFkZXIgc2V0cyB0aGUgZ3JvdXAncyBwYWNlOyBmb2xsb3dlcnMga2VlcCBpdCAoc28gdGhlIGdyb3VwIHN0YXlzIHRvZ2V0aGVyKVxuICAgICAgY29uc3QgcyA9IGkgPT09IGxlYWRlciA/IHNwZCAqIHRoaXMuYXJjaHNbdGhpcy5hcmNoW2ldXS5wYWNlIDogdGhpcy5zcGRbbGVhZGVyXTtcbiAgICAgIHRoaXMudnhbaV0gPSBmeCAqIHM7IHRoaXMudnpbaV0gPSBmeiAqIHM7IHRoaXMuc3BkW2ldID0gcztcbiAgICAgIHRoaXMudFtpXSA9IHQ7XG4gICAgICB0aGlzLmhkW2ldID0gTWF0aC5hdGFuMihmeCwgZnopO1xuICAgICAgdGhpcy5hbXBbaV0gPSAxO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBjaG9vc2UgYW4gYXJjaGV0eXBlICsgb3V0Zml0IGZvciBjaXZpbGlhbiBpICovXG4gIHByaXZhdGUgZHJlc3NVcChpOiBudW1iZXIsIGJpb21lOiBCaW9tZUlkKTogdm9pZCB7XG4gICAgbGV0IHIgPSBNYXRoLnJhbmRvbSgpICogdGhpcy5hcmNoV1N1bTtcbiAgICBsZXQgYSA9IDA7XG4gICAgZm9yICg7IGEgPCB0aGlzLmFyY2hXLmxlbmd0aCAtIDE7IGErKykgeyByIC09IHRoaXMuYXJjaFdbYV07IGlmIChyIDwgMCkgYnJlYWs7IH1cbiAgICB0aGlzLmFyY2hbaV0gPSBhO1xuICAgIGNvbnN0IGFyID0gdGhpcy5hcmNoc1thXTtcbiAgICBjb25zdCBsayA9IGFyLmxvb2soYmlvbWUpO1xuICAgIGNvbnN0IG8gPSBpICogMjAsIEMgPSB0aGlzLmNvbDtcbiAgICBjb25zdCBwdXQgPSAob2ZmOiBudW1iZXIsIGhleDogc3RyaW5nLCB3djogbnVtYmVyKTogdm9pZCA9PiB7XG4gICAgICB0aGlzLmMzLnNldChoZXgpO1xuICAgICAgQ1tvICsgb2ZmXSA9IHRoaXMuYzMucjsgQ1tvICsgb2ZmICsgMV0gPSB0aGlzLmMzLmc7IENbbyArIG9mZiArIDJdID0gdGhpcy5jMy5iOyBDW28gKyBvZmYgKyAzXSA9IHd2O1xuICAgIH07XG4gICAgcHV0KDAsIGxrLnNraW4sIGxrLnNob2UpO1xuICAgIHB1dCg0LCBsay50b3AsIGxrLm1hc2spO1xuICAgIHB1dCg4LCBsay5ib3R0b20sIDApO1xuICAgIHB1dCgxMiwgbGsuaGFpciwgYXIubWlkID8/IDApO1xuICAgIHB1dCgxNiwgbGsuYWNjLCAwKTtcbiAgfVxuXG4gIC8qKiBncm91cCBtZW1iZXIgd2hvc2UgdGltZXIgcmFuIG91dDogZG8gd2hhdCB0aGUgbGVhZGVyIGlzIGRvaW5nIChpZiBpdCBpcyBuZWFyIGFuZCBjYWxtKSAqL1xuICBwcml2YXRlIGZvbGxvd0xlYWRlcihpOiBudW1iZXIpOiBib29sZWFuIHtcbiAgICBjb25zdCBMID0gdGhpcy5sZWFkW2ldO1xuICAgIGlmIChMID09PSBpKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgbHMgPSB0aGlzLnN0W0xdO1xuICAgIGNvbnN0IG5lYXIgPSBNYXRoLmh5cG90KHRoaXMueFtMXSAtIHRoaXMueFtpXSwgdGhpcy56W0xdIC0gdGhpcy56W2ldKSA8IDUgKiB0aGlzLnNjYWxlTm93O1xuICAgIGlmICgobHMgIT09IFNUX01JTEwgJiYgbHMgIT09IFNUX0lETEUpIHx8ICFuZWFyKSB7IHRoaXMubGVhZFtpXSA9IGk7IHJldHVybiBmYWxzZTsgfVxuICAgIGlmIChscyA9PT0gU1RfSURMRSkgdGhpcy5zZXRJZGxlKGkpO1xuICAgIGVsc2Uge1xuICAgICAgdGhpcy5zdFtpXSA9IFNUX01JTEw7IHRoaXMucG9zZVtpXSA9IFBfV0FMSztcbiAgICAgIHRoaXMudnhbaV0gPSB0aGlzLnZ4W0xdOyB0aGlzLnZ6W2ldID0gdGhpcy52eltMXTsgdGhpcy5zcGRbaV0gPSB0aGlzLnNwZFtMXTtcbiAgICAgIHRoaXMuaW5QYXJrW2ldID0gdGhpcy5pblBhcmtbTF07XG4gICAgfVxuICAgIHRoaXMudFtpXSA9IE1hdGgubWF4KDAuMywgdGhpcy50W0xdKSArIDAuMiArIE1hdGgucmFuZG9tKCkgKiAwLjY7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvKiogc3RhbmQgc3RpbGwgYW5kIGdhd2s6IHBsYWluIHN0YXJlLCBmaWxtIGl0LCBwb2ludCBhdCBpdCwgb3Igd2F2ZSAqL1xuICBwcml2YXRlIHNldElkbGUoaTogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5zdFtpXSA9IFNUX0lETEU7IHRoaXMudnhbaV0gPSAwOyB0aGlzLnZ6W2ldID0gMDsgdGhpcy50W2ldID0gMS41ICsgTWF0aC5yYW5kb20oKSAqIDMuNTtcbiAgICBjb25zdCBtYXNrID0gdGhpcy5jb2xbaSAqIDIwICsgN107XG4gICAgLy8gdGhlIHJpZ2h0IGhhbmQgaXMgYnVzeSBob2xkaW5nIGFuIHVtYnJlbGxhIG9yIGEgY2FuZVxuICAgIGNvbnN0IGJ1c3lSaWdodCA9IChtYXNrICYgYml0KE9fVU1CKSkgIT09IDAgfHwgKHRoaXMuYXJjaHNbdGhpcy5hcmNoW2ldXS5pZCA9PT0gJ2VsZGVyJyAmJiAobWFzayAmIGJpdChPX0VYVFJBKSkgIT09IDApO1xuICAgIGNvbnN0IHIgPSBNYXRoLnJhbmRvbSgpO1xuICAgIHRoaXMucG9zZVtpXSA9IGJ1c3lSaWdodCA/IFBfV0FMSyA6IHIgPCAwLjMyID8gUF9QSE9ORSA6IHIgPCAwLjU1ID8gUF9QT0lOVCA6IHIgPCAwLjY4ID8gUF9XQVZFIDogUF9XQUxLO1xuICB9XG5cbiAgLyoqIHdhbGsgYWxvbmcgdGhlIHNpZGV3YWxrIHNpZGUgdGhlIGNpdmlsaWFuIGlzIG9uIOKAlCBvciBzdHJvbGwgYW55d2hlcmUgaW4gYSBwYXJrIC8gcGxhemEgKi9cbiAgcHJpdmF0ZSBzZXRNaWxsKGk6IG51bWJlciwgeDogbnVtYmVyLCB6OiBudW1iZXIsIGNpdHk6IFdvcmxkWydjaXR5J10sIGFyOiBBcmNoKTogdm9pZCB7XG4gICAgY29uc3QgUCA9IGNpdHkucGl0Y2g7XG4gICAgY29uc3QgYnggPSBNYXRoLmZsb29yKCh4IC0gY2l0eS5vcmlnaW5YKSAvIFApLCBieiA9IE1hdGguZmxvb3IoKHogLSBjaXR5Lm9yaWdpblopIC8gUCk7XG4gICAgY29uc3QgbHggPSB4IC0gKGNpdHkub3JpZ2luWCArIChieCArIDAuNSkgKiBQKSwgbHogPSB6IC0gKGNpdHkub3JpZ2luWiArIChieiArIDAuNSkgKiBQKTtcbiAgICBjb25zdCBzcCA9ICgwLjcgKyBNYXRoLnJhbmRvbSgpICogMC44KSAqIGFyLnBhY2U7XG4gICAgY29uc3QgcGFyayA9IGJ4ID49IDAgJiYgYnogPj0gMCAmJiBieCA8IGNpdHkuYmxvY2tzWCAmJiBieiA8IGNpdHkuYmxvY2tzWiAmJiB0aGlzLnBhcmtDZWxsW2J4ICsgYnogKiBjaXR5LmJsb2Nrc1hdID09PSAxXG4gICAgICAmJiBNYXRoLmFicyhseCkgPCBQQVJDRUxfSEFMRiAtIDAuMyAmJiBNYXRoLmFicyhseikgPCBQQVJDRUxfSEFMRiAtIDAuMztcbiAgICB0aGlzLmluUGFya1tpXSA9IHBhcmsgPyAxIDogMDtcbiAgICBpZiAocGFyaykge1xuICAgICAgY29uc3QgaCA9IE1hdGgucmFuZG9tKCkgKiBNYXRoLlBJICogMjtcbiAgICAgIHRoaXMudnhbaV0gPSBNYXRoLnNpbihoKSAqIHNwOyB0aGlzLnZ6W2ldID0gTWF0aC5jb3MoaCkgKiBzcDtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgZGlyID0gTWF0aC5yYW5kb20oKSA8IDAuNSA/IC0xIDogMTtcbiAgICAgIGlmIChNYXRoLmFicyhseCkgPj0gTWF0aC5hYnMobHopKSB7IHRoaXMudnhbaV0gPSAwOyB0aGlzLnZ6W2ldID0gZGlyICogc3A7IH1cbiAgICAgIGVsc2UgeyB0aGlzLnZ4W2ldID0gZGlyICogc3A7IHRoaXMudnpbaV0gPSAwOyB9XG4gICAgfVxuICAgIHRoaXMuc3BkW2ldID0gc3A7XG4gICAgdGhpcy50W2ldID0gMiArIE1hdGgucmFuZG9tKCkgKiA1O1xuICB9XG5cbiAgLyoqIHJlYWNoZWQgdGhlIGVuZCBvZiBhIHNpZGV3YWxrIHNpZGU6IGNvbnRpbnVlIGFsb25nIHRoZSBhZGphY2VudCBzaWRlIG9mIHRoZSBTQU1FIGJsb2NrXG4gICAqICAoZGV0ZXJtaW5pc3RpYywgc28gYSB3YWxraW5nIGdyb3VwIHR1cm5zIHRvZ2V0aGVyKSAqL1xuICBwcml2YXRlIHR1cm5Db3JuZXIoaTogbnVtYmVyLCB3YXNYU2lkZTogYm9vbGVhbiwgZGVwdGhTaWduOiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBzcCA9IHRoaXMuc3BkW2ldIHx8IDE7XG4gICAgY29uc3QgZGlyID0gLWRlcHRoU2lnbjtcbiAgICBpZiAod2FzWFNpZGUpIHsgdGhpcy52eFtpXSA9IGRpciAqIHNwOyB0aGlzLnZ6W2ldID0gMDsgfSBlbHNlIHsgdGhpcy52eltpXSA9IGRpciAqIHNwOyB0aGlzLnZ4W2ldID0gMDsgfVxuICB9XG5cbiAgLyoqIGlubmVybW9zdCB8bG9jYWwgY29vcmRpbmF0ZXwgYSBzaWRld2FsayB3YWxrZXIgbWF5IHVzZSBoZXJlOiB0aGUgcGF2ZWQgZm9yZWNvdXJ0IHJlYWNoZXMgaW4gdXBcbiAgICogIHRvIFBMQVpBX0RFUFRIIG0sIGJ1dCBzdG9wcyB+MC45IG0gc2hvcnQgb2YgYW55IGZhY2FkZSBjb3ZlcmluZyB0aGlzIHNwb3QgKG9yIGp1c3QgYWhlYWQpICovXG4gIHByaXZhdGUgaW5uZXJMaW1pdChjaXR5OiBXb3JsZFsnY2l0eSddLCBieDogbnVtYmVyLCBiejogbnVtYmVyLCBjeDogbnVtYmVyLCBjejogbnVtYmVyLCBhbG9uZ0lzWDogYm9vbGVhbiwgc2lkZVNpZ246IG51bWJlcixcbiAgICBhbG9uZ1c6IG51bWJlciwgdkFsb25nOiBudW1iZXIsIHNjYWxlOiBudW1iZXIpOiBudW1iZXIge1xuICAgIGlmIChieCA8IDAgfHwgYnogPCAwIHx8IGJ4ID49IGNpdHkuYmxvY2tzWCB8fCBieiA+PSBjaXR5LmJsb2Nrc1opIHJldHVybiBTV19JTjtcbiAgICBsZXQgbGltID0gUEFSQ0VMX0hBTEYgLSBQTEFaQV9ERVBUSDtcbiAgICBjb25zdCBpZHMgPSBjaXR5LmJsb2NrQnVpbGRpbmdzW2J4ICsgYnogKiBjaXR5LmJsb2Nrc1hdO1xuICAgIGNvbnN0IGFoZWFkID0gYWxvbmdXICsgTWF0aC5zaWduKHZBbG9uZykgKiAxLjIgKiBzY2FsZTtcbiAgICBjb25zdCBtID0gMC4zNSAqIHNjYWxlLCBnYXAgPSAwLjkgKiBzY2FsZTtcbiAgICBmb3IgKGxldCBrID0gMDsgayA8IGlkcy5sZW5ndGg7IGsrKykge1xuICAgICAgY29uc3QgYiA9IGNpdHkuYnVpbGRpbmdzW2lkc1trXV07XG4gICAgICBpZiAoIWIpIGNvbnRpbnVlO1xuICAgICAgbGV0IGxvOiBudW1iZXIsIGhpOiBudW1iZXIsIGZhY2U6IG51bWJlcjtcbiAgICAgIGlmIChhbG9uZ0lzWCkgeyBsbyA9IGIueCAtIGIudyAvIDIgLSBtOyBoaSA9IGIueCArIGIudyAvIDIgKyBtOyBmYWNlID0gc2lkZVNpZ24gKiAoYi56IC0gY3opICsgYi5kIC8gMjsgfVxuICAgICAgZWxzZSB7IGxvID0gYi56IC0gYi5kIC8gMiAtIG07IGhpID0gYi56ICsgYi5kIC8gMiArIG07IGZhY2UgPSBzaWRlU2lnbiAqIChiLnggLSBjeCkgKyBiLncgLyAyOyB9XG4gICAgICBpZiAoISgoYWxvbmdXID4gbG8gJiYgYWxvbmdXIDwgaGkpIHx8IChhaGVhZCA+IGxvICYmIGFoZWFkIDwgaGkpKSkgY29udGludWU7XG4gICAgICBpZiAoZmFjZSArIGdhcCA+IGxpbSkgbGltID0gZmFjZSArIGdhcDtcbiAgICB9XG4gICAgcmV0dXJuIE1hdGgubWluKGxpbSwgU1dfSU4pO1xuICB9XG5cbiAgLyoqIHB1c2ggY2l2aWxpYW4gaSAocG9zaXRpb24gaW4gcDMpIG91dCBvZiBhbnkgYnVpbGRpbmcgZm9vdHByaW50IGluIGl0cyBibG9jayAoKyBib2R5IHJhZGl1cykgKi9cbiAgcHJpdmF0ZSBhdm9pZEJ1aWxkaW5ncyhpOiBudW1iZXIsIGNpdHk6IFdvcmxkWydjaXR5J10sIGJ4OiBudW1iZXIsIGJ6OiBudW1iZXIsIGJvZHk6IG51bWJlcik6IHZvaWQge1xuICAgIGlmIChieCA8IDAgfHwgYnogPCAwIHx8IGJ4ID49IGNpdHkuYmxvY2tzWCB8fCBieiA+PSBjaXR5LmJsb2Nrc1opIHJldHVybjtcbiAgICBjb25zdCBpZHMgPSBjaXR5LmJsb2NrQnVpbGRpbmdzW2J4ICsgYnogKiBjaXR5LmJsb2Nrc1hdO1xuICAgIGZvciAobGV0IGsgPSAwOyBrIDwgaWRzLmxlbmd0aDsgaysrKSB7XG4gICAgICBjb25zdCBiID0gY2l0eS5idWlsZGluZ3NbaWRzW2tdXTtcbiAgICAgIGlmICghYikgY29udGludWU7XG4gICAgICBjb25zdCBodyA9IGIudyAvIDIgKyBib2R5LCBoZCA9IGIuZCAvIDIgKyBib2R5O1xuICAgICAgY29uc3QgZHggPSB0aGlzLnAzLnggLSBiLngsIGR6ID0gdGhpcy5wMy56IC0gYi56O1xuICAgICAgaWYgKE1hdGguYWJzKGR4KSA+PSBodyB8fCBNYXRoLmFicyhkeikgPj0gaGQpIGNvbnRpbnVlO1xuICAgICAgaWYgKGh3IC0gTWF0aC5hYnMoZHgpIDwgaGQgLSBNYXRoLmFicyhkeikpIHsgdGhpcy5wMy54ID0gYi54ICsgTWF0aC5zaWduKGR4IHx8IDEpICogaHc7IGlmICh0aGlzLnZ4W2ldICogZHggPCAwKSB0aGlzLnZ4W2ldICo9IC0wLjM7IH1cbiAgICAgIGVsc2UgeyB0aGlzLnAzLnogPSBiLnogKyBNYXRoLnNpZ24oZHogfHwgMSkgKiBoZDsgaWYgKHRoaXMudnpbaV0gKiBkeiA8IDApIHRoaXMudnpbaV0gKj0gLTAuMzsgfVxuICAgIH1cbiAgfVxuXG4gIC8qKiB3b3VsZCBhIGNpdmlsaWFuIHN0YW5kaW5nIGF0ICh4LCB6KSBiZSBpbnNpZGUgYSBidWlsZGluZyBmb290cHJpbnQgKCsgbWFyZ2luKT8gKi9cbiAgcHJpdmF0ZSBpbkJ1aWxkaW5nKGNpdHk6IFdvcmxkWydjaXR5J10sIHg6IG51bWJlciwgejogbnVtYmVyLCBtYXJnaW46IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIGNvbnN0IFAgPSBjaXR5LnBpdGNoO1xuICAgIGNvbnN0IGJ4ID0gTWF0aC5mbG9vcigoeCAtIGNpdHkub3JpZ2luWCkgLyBQKSwgYnogPSBNYXRoLmZsb29yKCh6IC0gY2l0eS5vcmlnaW5aKSAvIFApO1xuICAgIGlmIChieCA8IDAgfHwgYnogPCAwIHx8IGJ4ID49IGNpdHkuYmxvY2tzWCB8fCBieiA+PSBjaXR5LmJsb2Nrc1opIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBpZHMgPSBjaXR5LmJsb2NrQnVpbGRpbmdzW2J4ICsgYnogKiBjaXR5LmJsb2Nrc1hdO1xuICAgIGZvciAobGV0IGsgPSAwOyBrIDwgaWRzLmxlbmd0aDsgaysrKSB7XG4gICAgICBjb25zdCBiID0gY2l0eS5idWlsZGluZ3NbaWRzW2tdXTtcbiAgICAgIGlmIChiICYmIE1hdGguYWJzKHggLSBiLngpIDwgYi53IC8gMiArIG1hcmdpbiAmJiBNYXRoLmFicyh6IC0gYi56KSA8IGIuZCAvIDIgKyBtYXJnaW4pIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwcml2YXRlIHNxdWFzaENpcmNsZSh4OiBudW1iZXIsIHo6IG51bWJlciwgcjogbnVtYmVyLCBzY2FsZTogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3QgcjIgPSByICogcjtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IENBUDsgaSsrKSB7XG4gICAgICBjb25zdCBzID0gdGhpcy5zdFtpXTtcbiAgICAgIGlmIChzID09PSBTVF9FTVBUWSB8fCBzID09PSBTVF9HT05FKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGR4ID0gdGhpcy54W2ldIC0geCwgZHogPSB0aGlzLnpbaV0gLSB6O1xuICAgICAgaWYgKGR4ICogZHggKyBkeiAqIGR6IDw9IHIyKSB0aGlzLnB1ZmYoaSwgc2NhbGUpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc3F1YXNoUmVjdCh4OiBudW1iZXIsIHo6IG51bWJlciwgaHc6IG51bWJlciwgaGQ6IG51bWJlciwgc2NhbGU6IG51bWJlcik6IHZvaWQge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgQ0FQOyBpKyspIHtcbiAgICAgIGNvbnN0IHMgPSB0aGlzLnN0W2ldO1xuICAgICAgaWYgKHMgPT09IFNUX0VNUFRZIHx8IHMgPT09IFNUX0dPTkUpIGNvbnRpbnVlO1xuICAgICAgaWYgKE1hdGguYWJzKHRoaXMueFtpXSAtIHgpIDw9IGh3ICYmIE1hdGguYWJzKHRoaXMueltpXSAtIHopIDw9IGhkKSB0aGlzLnB1ZmYoaSwgc2NhbGUpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcHVmZihpOiBudW1iZXIsIHNjYWxlOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLnN0W2ldID0gU1RfR09ORTtcbiAgICB0aGlzLnRbaV0gPSAxLjUgKyBNYXRoLnJhbmRvbSgpICogMjsgICAgICAgICAgIC8vIHJlc3Bhd24gZGVsYXlcbiAgICBjb25zdCBwID0gdGhpcy5wdWZmTGlzdFt0aGlzLnB1ZmZDdXJzb3JdO1xuICAgIHRoaXMucHVmZkN1cnNvciA9ICh0aGlzLnB1ZmZDdXJzb3IgKyAxKSAlIFBVRkZfQ0FQO1xuICAgIHAueCA9IHRoaXMueFtpXTsgcC56ID0gdGhpcy56W2ldOyBwLnkgPSBTSURFV0FMS19ZOyBwLnQgPSAwOyBwLnMgPSAwLjkgKiBzY2FsZTtcbiAgfVxufVxuXG5mdW5jdGlvbiB3cmFwUGkoYTogbnVtYmVyKTogbnVtYmVyIHtcbiAgYSA9IChhICsgTWF0aC5QSSkgJSAoTWF0aC5QSSAqIDIpO1xuICBpZiAoYSA8IDApIGEgKz0gTWF0aC5QSSAqIDI7XG4gIHJldHVybiBhIC0gTWF0aC5QSTtcbn1cblxuZnVuY3Rpb24gdHVyblRvd2FyZChjdXI6IG51bWJlciwgdGFyZ2V0OiBudW1iZXIsIGs6IG51bWJlcik6IG51bWJlciB7XG4gIHJldHVybiBjdXIgKyB3cmFwUGkodGFyZ2V0IC0gY3VyKSAqIE1hdGgubWluKDEsIGspO1xufVxuIl19