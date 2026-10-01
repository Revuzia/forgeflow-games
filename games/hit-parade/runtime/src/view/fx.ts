// HIT PARADE - impact FX (CONTRACT §7 "FX"; DESIGN pillar 1 "every hit is a show"; owner rule: comic red splatter with a
// settings toggle to sparks / confetti, NO realistic gore).
//
// Everything is pooled and allocated at construction (no program links or buffer growth mid-bout):
//   * Particles: two GPU-animated InstancedMeshes (additive light: sparks, flashes, rings, fire, electricity / alpha:
//     splatter, confetti, dust, smoke, doves, debris). A spawn writes one instance's start state (position, velocity,
//     birth time, life, sizes, spin, colour, atlas cell, gravity, drag, velocity-stretch); the vertex shader integrates
//     the ballistic path and billboards the quad (or stretches it along its screen-space velocity), so the CPU cost is
//     the spawn only. Dead instances collapse to zero size. FX time runs at the slow-mo rate (KO x0.25, PRIME TIME holds).
//   * Decals: one InstancedMesh of oriented quads (wall-splat splats on the ring wall at the sim's contact point, floor
//     splats, floor cracks) that fade out; polygon offset against z-fighting.
//   * CHANGED(VIEW3D) the FX BASIS: every particle velocity and every authored offset is written in a local basis
//     (x = the "hit direction" axis, y up, z = toward the camera) and rotated to world at spawn. BoutView sets it each
//     frame to the camera's screen-right R / normal N (the 1D look of every spray holds at any fight-line angle); a hit /
//     projectile / wall splat may set its own axis for one call (setBasis + restore). Positions given by callers are WORLD.
//   * Screen layer (view/post.ts GradePass): flash, speed lines / finish-zoom lines around the impact's screen point.
//   * Background dim for super freezes / cinematics: a camera-facing black plane parked just behind the fighters' depth,
//     so the set darkens and the fighters stay lit (no mask pass needed).
//   * Spotlight: one additive cone (+ floor pool) for PRIME TIME `spotlight` beats (set dimmed, one light on the star).
//   * Projectile visuals live in view/projectiles.ts (meshes per fighter) and use this system for trails / destroy FX.
// The sprite atlas is procedural (canvas, 8 x 4 cells of 256 px): FX sprites are not hero assets.
// P2 (CHANGED VIEW): atlas 4x4 -> 8x4 (fire, smoke, bolt, card, dove, feather, chunk, star, dashed ring, beam, soft glow,
// crack, swirl, cross sparkle, shard, ember) and the PRIME TIME / projectile verbs below `koFinish`.

import * as THREE from 'three';
import type { Post } from './post.ts';
import type { FightCamera } from './camera.ts';

export type GoreMode = 'splatter' | 'sparks' | 'confetti';
export type HitKind = 'hit' | 'counter' | 'punish' | 'block' | 'parry' | 'perfect' | 'armor' | 'throw' | 'clash';

/** atlas cells (8 columns x 4 rows) */
export const C = {
  STAR: 0, GLOW: 1, STREAK: 2, BLOB_A: 3, BLOB_B: 4, DROP: 5, RING: 6, CHEVRON: 7,
  CONF_RECT: 8, CONF_RIB: 9, DUST: 10, POW: 11, RING_THICK: 12, TWINKLE: 13, WALL_SPLAT: 14, SCORCH: 15,
  FLAME: 16, SMOKE: 17, BOLT: 18, CARD: 19, DOVE: 20, FEATHER: 21, CHUNK: 22, STAR5: 23,
  RING_DASH: 24, BEAM: 25, GLOW_SOFT: 26, CRACK: 27, SWIRL: 28, SPARK_X: 29, SHARD: 30, EMBER: 31,
} as const;
const ATLAS_COLS = 8, ATLAS_ROWS = 4;

// ───────────────────────────────────────── procedural sprite atlas ─────────────────────────────────────────

function drawAtlas(): HTMLCanvasElement {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = ATLAS_COLS * S;
  cv.height = ATLAS_ROWS * S;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cell = (i: number, fn: (cx: number, cy: number) => void) => {
    const x = (i % ATLAS_COLS) * S, y = Math.floor(i / ATLAS_COLS) * S;
    g.save(); g.beginPath(); g.rect(x, y, S, S); g.clip();
    fn(x + S / 2, y + S / 2);
    g.restore();
  };
  const star = (cx: number, cy: number, spikes: number, r0: number, r1: number, jitter: number) => {
    g.beginPath();
    for (let k = 0; k < spikes * 2; k++) {
      const a = (k / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = (k % 2 === 0 ? r1 * (1 - jitter * rnd()) : r0);
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  };
  const blob = (cx: number, cy: number, r: number, lobes: number, amp: number) => {
    g.beginPath();
    const n = 64;
    const ph = rnd() * 6.28, ph2 = rnd() * 6.28;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (1 + amp * Math.sin(a * lobes + ph) * 0.6 + amp * 0.4 * Math.sin(a * (lobes + 3) + ph2));
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  };
  const radial = (cx: number, cy: number, r: number, stops: Array<[number, number]>) => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [o, a] of stops) gr.addColorStop(o, `rgba(255,255,255,${a})`);
    return gr;
  };
  g.clearRect(0, 0, cv.width, cv.height);
  // 0 STAR: sharp comic hit star, white with soft core
  cell(C.STAR, (cx, cy) => { star(cx, cy, 12, 26, 122, 0.45); g.fillStyle = radial(cx, cy, 120, [[0, 1], [0.35, 0.9], [1, 0]]); g.fill(); });
  // 1 GLOW
  cell(C.GLOW, (cx, cy) => { g.fillStyle = radial(cx, cy, 124, [[0, 1], [0.25, 0.55], [1, 0]]); g.fillRect(cx - 128, cy - 128, 256, 256); });
  // 2 STREAK: horizontal spark line (stretched along velocity in the shader)
  cell(C.STREAK, (cx, cy) => {
    const gr = g.createLinearGradient(cx - 120, cy, cx + 120, cy);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.2)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, 120, 14, 0, 0, Math.PI * 2); g.fill();
  });
  // 3/4 BLOB: comic paint splat blobs (flat colour; the shader tints)
  cell(C.BLOB_A, (cx, cy) => { blob(cx, cy, 78, 7, 0.28); g.fillStyle = '#fff'; g.fill(); g.beginPath(); g.arc(cx + 70, cy - 60, 16, 0, 7); g.arc(cx - 84, cy + 40, 11, 0, 7); g.fill(); });
  cell(C.BLOB_B, (cx, cy) => { blob(cx, cy, 70, 5, 0.38); g.fillStyle = '#fff'; g.fill(); g.beginPath(); g.arc(cx - 60, cy - 72, 13, 0, 7); g.arc(cx + 88, cy + 20, 9, 0, 7); g.arc(cx + 30, cy + 92, 12, 0, 7); g.fill(); });
  // 5 DROP: teardrop pointing +x (velocity-stretched)
  cell(C.DROP, (cx, cy) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + 40, cy, 46, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(cx - 110, cy); g.quadraticCurveTo(cx - 10, cy - 46, cx + 40, cy - 46); g.lineTo(cx + 40, cy + 46);
    g.quadraticCurveTo(cx - 10, cy + 46, cx - 110, cy); g.fill();
  });
  // 6 RING thin
  cell(C.RING, (cx, cy) => { g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, 110, 0, Math.PI * 2); g.stroke(); });
  // 7 CHEVRON: block spark (a bright arc)
  cell(C.CHEVRON, (cx, cy) => {
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { g.lineWidth = 16 - k * 4; g.beginPath(); g.arc(cx - 40 - k * 18, cy, 90 + k * 12, -0.9, 0.9); g.stroke(); }
  });
  // 8 CONFETTI rect, 9 ribbon
  cell(C.CONF_RECT, (cx, cy) => { g.fillStyle = '#fff'; g.fillRect(cx - 70, cy - 42, 140, 84); });
  cell(C.CONF_RIB, (cx, cy) => {
    g.strokeStyle = '#fff'; g.lineWidth = 26; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - 100, cy);
    g.bezierCurveTo(cx - 40, cy - 80, cx + 40, cy + 80, cx + 100, cy); g.stroke();
  });
  // 10 DUST: noisy soft puff
  cell(C.DUST, (cx, cy) => {
    for (let k = 0; k < 26; k++) {
      const a = rnd() * 6.28, r = rnd() * 60, rr = 30 + rnd() * 40;
      g.fillStyle = radial(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rr, [[0, 0.28], [1, 0]]);
      g.fillRect(cx - 128, cy - 128, 256, 256);
    }
  });
  // 11 POW: chunky comic starburst
  cell(C.POW, (cx, cy) => { star(cx, cy, 11, 60, 124, 0.3); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.stroke(); });
  // 12 RING thick (shock wave)
  cell(C.RING_THICK, (cx, cy) => {
    const gr = g.createRadialGradient(cx, cy, 70, cx, cy, 124);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(cx - 128, cy - 128, 256, 256);
  });
  // 13 TWINKLE: 4-point sparkle
  cell(C.TWINKLE, (cx, cy) => { star(cx, cy, 4, 14, 124, 0); g.fillStyle = radial(cx, cy, 120, [[0, 1], [1, 0]]); g.fill(); });
  // 14 WALL_SPLAT: a big multi-blob comic splat with drips
  cell(C.WALL_SPLAT, (cx, cy) => {
    g.fillStyle = '#fff';
    blob(cx, cy - 10, 62, 9, 0.35); g.fill();
    for (let k = 0; k < 9; k++) { const a = rnd() * 6.28, d = 70 + rnd() * 40, r = 6 + rnd() * 14; g.beginPath(); g.arc(cx + Math.cos(a) * d, cy - 10 + Math.sin(a) * d * 0.9, r, 0, 7); g.fill(); }
    for (let k = 0; k < 4; k++) { const x = cx - 40 + k * 26 + rnd() * 10, len = 40 + rnd() * 60; g.fillRect(x - 5, cy + 20, 10, len); g.beginPath(); g.arc(x, cy + 20 + len, 8, 0, 7); g.fill(); }
  });
  // 15 SCORCH: dark star burst (sparks-mode wall mark)
  cell(C.SCORCH, (cx, cy) => { star(cx, cy, 16, 40, 122, 0.5); g.fillStyle = radial(cx, cy, 120, [[0, 0.95], [0.6, 0.5], [1, 0]]); g.fill(); });
  // 16 FLAME: a flame tongue (tip up), hot core low
  cell(C.FLAME, (cx, cy) => {
    g.beginPath(); g.moveTo(cx, cy - 122);
    g.bezierCurveTo(cx + 30, cy - 70, cx + 92, cy - 10, cx + 70, cy + 60);
    g.bezierCurveTo(cx + 52, cy + 112, cx - 52, cy + 112, cx - 70, cy + 60);
    g.bezierCurveTo(cx - 92, cy - 10, cx - 30, cy - 70, cx, cy - 122);
    g.fillStyle = radial(cx, cy + 45, 150, [[0, 1], [0.45, 0.85], [0.8, 0.35], [1, 0]]); g.fill();
    g.beginPath(); g.moveTo(cx + 18, cy - 40); g.bezierCurveTo(cx + 40, cy, cx + 30, cy + 40, cx + 8, cy + 50); g.bezierCurveTo(cx + 20, cy + 10, cx + 10, cy - 10, cx + 18, cy - 40);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill();
  });
  // 17 SMOKE: lumpy dense cloud
  cell(C.SMOKE, (cx, cy) => {
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * 6.28 + rnd(), r = 38 + rnd() * 26, rr = 46 + rnd() * 26;
      g.fillStyle = radial(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, rr, [[0, 0.75], [0.6, 0.45], [1, 0]]);
      g.fillRect(cx - 128, cy - 128, 256, 256);
    }
    g.fillStyle = radial(cx, cy, 70, [[0, 0.8], [1, 0]]); g.fillRect(cx - 128, cy - 128, 256, 256);
  });
  // 18 BOLT: zigzag lightning (drawn along x so the velocity stretch aligns it)
  cell(C.BOLT, (cx, cy) => {
    const pts: Array<[number, number]> = [[cx - 120, cy]];
    for (let k = 1; k < 8; k++) pts.push([cx - 120 + k * 30, cy + (rnd() - 0.5) * 70]);
    pts.push([cx + 120, cy]);
    for (const [w, a] of [[26, 0.25], [12, 0.6], [5, 1]] as const) {
      g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.lineJoin = 'miter'; g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    }
  });
  // 19 CARD: a playing card (white face, crimson border + pips); tinted white in use
  cell(C.CARD, (cx, cy) => {
    const w = 132, h = 188, r = 14, x0 = cx - w / 2, y0 = cy - h / 2;
    g.beginPath(); g.moveTo(x0 + r, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + h, r); g.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    g.arcTo(x0, y0 + h, x0, y0, r); g.arcTo(x0, y0, x0 + w, y0, r); g.closePath();
    g.fillStyle = '#fff'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#c81432'; g.stroke();
    const pip = (px: number, py: number, s: number) => { g.beginPath(); g.moveTo(px, py - s); g.lineTo(px + s * 0.7, py); g.lineTo(px, py + s); g.lineTo(px - s * 0.7, py); g.closePath(); g.fill(); };
    g.fillStyle = '#c81432'; pip(cx, cy, 36); pip(x0 + 22, y0 + 30, 11); pip(x0 + w - 22, y0 + h - 30, 11);
  });
  // 20 DOVE: a white dove in flight, side view, both wings raised in a V (faces +x)
  cell(C.DOVE, (cx, cy) => {
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(cx - 4, cy + 24, 58, 24, -0.12, 0, Math.PI * 2); g.fill();        // body
    g.beginPath(); g.arc(cx + 56, cy + 8, 19, 0, 7); g.fill();                                // head
    g.beginPath(); g.moveTo(cx + 72, cy + 4); g.lineTo(cx + 96, cy + 12); g.lineTo(cx + 72, cy + 16); g.fill();  // beak
    g.beginPath(); g.moveTo(cx - 52, cy + 18); g.lineTo(cx - 116, cy - 2); g.lineTo(cx - 108, cy + 22); g.lineTo(cx - 118, cy + 44); g.lineTo(cx - 50, cy + 36); g.closePath(); g.fill();  // fan tail
    // far wing (behind, a little shorter) and near wing: long feathered blades sweeping up and back
    const wing = (bx: number, by: number, tipx: number, tipy: number, a: number) => {
      g.globalAlpha = a;
      g.beginPath(); g.moveTo(bx - 18, by); g.bezierCurveTo(bx - 30, by - 50, tipx - 40, tipy + 10, tipx, tipy);
      g.lineTo(tipx + 10, tipy + 14); g.lineTo(tipx - 2, tipy + 22); g.lineTo(tipx + 8, tipy + 34);
      g.bezierCurveTo(bx + 10, by - 40, bx + 22, by - 10, bx + 24, by + 4); g.closePath(); g.fill();
      g.globalAlpha = 1;
    };
    wing(cx + 4, cy + 10, cx - 58, cy - 104, 0.75);
    wing(cx + 12, cy + 14, cx - 12, cy - 118, 1);
  });
  // 21 FEATHER
  cell(C.FEATHER, (cx, cy) => {
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx - 110, cy + 8); g.bezierCurveTo(cx - 40, cy - 52, cx + 60, cy - 46, cx + 112, cy);
    g.bezierCurveTo(cx + 60, cy + 40, cx - 40, cy + 46, cx - 110, cy + 8); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 120, cy + 9); g.lineTo(cx + 110, cy); g.stroke();
  });
  // 22 CHUNK: an irregular broken piece (brick / rock / wood chips; tinted)
  cell(C.CHUNK, (cx, cy) => {
    g.beginPath();
    const n = 7;
    for (let k = 0; k < n; k++) { const a = (k / n) * 6.28 + rnd() * 0.5, r = 70 + rnd() * 45; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.8; if (k) g.lineTo(px, py); else g.moveTo(px, py); }
    g.closePath(); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.stroke();
  });
  // 23 STAR5: a five-point star
  cell(C.STAR5, (cx, cy) => { star(cx, cy, 5, 50, 118, 0); g.fillStyle = '#fff'; g.fill(); });
  // 24 RING_DASH: electric dashed ring
  cell(C.RING_DASH, (cx, cy) => { g.strokeStyle = '#fff'; g.lineWidth = 12; g.setLineDash([28, 18]); g.beginPath(); g.arc(cx, cy, 104, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); });
  // 25 BEAM: a soft vertical light column (spotlight shaft / pyro column)
  cell(C.BEAM, (cx, cy) => {
    const gx = g.createLinearGradient(cx - 128, 0, cx + 128, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.3, 'rgba(255,255,255,0.55)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)');
    gx.addColorStop(0.7, 'rgba(255,255,255,0.55)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gx; g.fillRect(cx - 128, cy - 128, 256, 256);
    const gy = g.createLinearGradient(0, cy - 128, 0, cy + 128);
    gy.addColorStop(0, 'rgba(0,0,0,1)'); gy.addColorStop(0.15, 'rgba(0,0,0,0)'); gy.addColorStop(0.85, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = gy; g.fillRect(cx - 128, cy - 128, 256, 256); g.globalCompositeOperation = 'source-over';
  });
  // 26 GLOW_SOFT: very soft wide bloom
  cell(C.GLOW_SOFT, (cx, cy) => { g.fillStyle = radial(cx, cy, 128, [[0, 0.7], [0.3, 0.35], [0.65, 0.1], [1, 0]]); g.fillRect(cx - 128, cy - 128, 256, 256); });
  // 27 CRACK: floor crack (decal; radiating jagged lines)
  cell(C.CRACK, (cx, cy) => {
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      let x = cx, y = cy, a = (k / 9) * 6.28 + rnd() * 0.4;
      g.lineWidth = 9; g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 5; s++) { a += (rnd() - 0.5) * 0.9; const l = 14 + rnd() * 16; x += Math.cos(a) * l; y += Math.sin(a) * l; g.lineWidth = Math.max(2, 9 - s * 1.6); g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = radial(cx, cy, 40, [[0, 0.9], [1, 0]]); g.fillRect(cx - 60, cy - 60, 120, 120);
  });
  // 28 SWIRL: a magic spiral
  cell(C.SWIRL, (cx, cy) => {
    g.strokeStyle = '#fff'; g.lineCap = 'round'; g.beginPath();
    for (let k = 0; k <= 120; k++) { const t = k / 120, a = t * Math.PI * 5, r = 8 + t * 108; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; g.lineWidth = 3 + 12 * t; if (k) g.lineTo(px, py); else g.moveTo(px, py); }
    g.stroke();
  });
  // 29 SPARK_X: long thin four-point sparkle
  cell(C.SPARK_X, (cx, cy) => { star(cx, cy, 4, 6, 126, 0); g.fillStyle = radial(cx, cy, 124, [[0, 1], [0.2, 0.8], [1, 0]]); g.fill(); g.fillStyle = radial(cx, cy, 30, [[0, 1], [1, 0]]); g.fillRect(cx - 40, cy - 40, 80, 80); });
  // 30 SHARD: a thin broken shard
  cell(C.SHARD, (cx, cy) => { g.beginPath(); g.moveTo(cx - 110, cy - 10); g.lineTo(cx + 116, cy - 24); g.lineTo(cx + 40, cy + 30); g.closePath(); g.fillStyle = '#fff'; g.fill(); });
  // 31 EMBER: a small hot point with a halo
  cell(C.EMBER, (cx, cy) => { g.fillStyle = radial(cx, cy, 90, [[0, 1], [0.18, 1], [0.35, 0.35], [1, 0]]); g.fillRect(cx - 128, cy - 128, 256, 256); });
  return cv;
}

// ───────────────────────────────────────── GPU particles ─────────────────────────────────────────

const P_VERT = /* glsl */`
attribute vec4 aP0;   // start xyz, birth time
attribute vec4 aV;    // velocity xyz, life
attribute vec4 aS;    // size0, size1, rot0, spin
attribute vec4 aC;    // rgb, alpha
attribute vec4 aX;    // cell, gravity, drag, stretch
uniform float uTime;
varying vec2 vUv;
varying vec4 vC;
varying float vAge;
void main() {
  float t = uTime - aP0.w;
  float life = max( aV.w, 1e-3 );
  float age = t / life;
  if ( t < 0.0 || age > 1.0 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); vC = vec4( 0.0 ); vUv = vec2( 0.0 ); vAge = 1.0; return; }
  float drag = aX.z;
  float k = drag > 0.0 ? ( 1.0 - exp( -drag * t ) ) / drag : t;
  vec3 vel = aV.xyz * ( drag > 0.0 ? exp( -drag * t ) : 1.0 ) + vec3( 0.0, -aX.y * t, 0.0 );
  vec3 wp = aP0.xyz + aV.xyz * k + vec3( 0.0, -0.5 * aX.y * t * t, 0.0 );
  float size = mix( aS.x, aS.y, age );
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  vec2 q = position.xy;
  float ang = aS.z + aS.w * t;
  vec2 axisX = vec2( cos( ang ), sin( ang ) );
  float len = 1.0;
  if ( aX.w > 0.0 ) {
    vec3 vv = ( viewMatrix * vec4( vel, 0.0 ) ).xyz;
    vec2 sv = vv.xy; float sl = length( sv );
    if ( sl > 1e-4 ) { axisX = sv / sl; len = 1.0 + aX.w * sl; }
  }
  vec2 axisY = vec2( -axisX.y, axisX.x );
  mv.xy += ( axisX * q.x * len + axisY * q.y ) * size;
  gl_Position = projectionMatrix * mv;
  float cell = aX.x;
  vUv = ( vec2( mod( cell, ${ATLAS_COLS}.0 ), ${ATLAS_ROWS - 1}.0 - floor( cell / ${ATLAS_COLS}.0 ) ) + uv ) * vec2( ${1 / ATLAS_COLS}, ${1 / ATLAS_ROWS} );
  vC = aC;
  vAge = age;
}
`;
const P_FRAG = /* glsl */`
uniform sampler2D uAtlas;
uniform float uAdd;
varying vec2 vUv;
varying vec4 vC;
varying float vAge;
void main() {
  vec4 tx = texture2D( uAtlas, vUv );
  float fade = 1.0 - smoothstep( 0.55, 1.0, vAge );
  float a = tx.a * vC.a * fade;
  if ( a < 0.02 ) discard;
  vec3 col = vC.rgb * tx.rgb;
  gl_FragColor = uAdd > 0.5 ? vec4( col * a, 1.0 ) : vec4( col, a );
}
`;

/** CHANGED(VIEW3D): the FX basis shared by the pools: X = (rx, 0, rz) unit, Y up, Z = (-rz, 0, rx) */
interface Basis { rx: number; rz: number }

class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  /** CHANGED(VIEW3D): velocities are LOCAL to this basis (set by FxSystem) */
  basis: Basis = { rx: 1, rz: 0 };
  private readonly cap: number;
  private next = 0;
  private readonly aP0: THREE.InstancedBufferAttribute;
  private readonly aV: THREE.InstancedBufferAttribute;
  private readonly aS: THREE.InstancedBufferAttribute;
  private readonly aC: THREE.InstancedBufferAttribute;
  private readonly aX: THREE.InstancedBufferAttribute;
  private lo = Infinity;
  private hi = -1;
  readonly uniforms: { uTime: { value: number }; uAtlas: { value: THREE.Texture }; uAdd: { value: number } };
  spawned = 0;

  constructor(cap: number, atlas: THREE.Texture, additive: boolean, name: string) {
    this.cap = cap;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aP0 = mk(); this.aV = mk(); this.aS = mk(); this.aC = mk(); this.aX = mk();
    for (let i = 0; i < cap; i++) { this.aP0.setW(i, -1e6); this.aV.setW(i, 0.001); }
    geo.setAttribute('aP0', this.aP0); geo.setAttribute('aV', this.aV); geo.setAttribute('aS', this.aS);
    geo.setAttribute('aC', this.aC); geo.setAttribute('aX', this.aX);
    geo.instanceCount = cap;
    this.uniforms = { uTime: { value: 0 }, uAtlas: { value: atlas }, uAdd: { value: additive ? 1 : 0 } };
    const mat = new THREE.ShaderMaterial({
      name, uniforms: this.uniforms, vertexShader: P_VERT, fragmentShader: P_FRAG,
      // additive sparks / flashes / rings draw on top (fighting-game convention: a hit spark is never hidden by the
      // victim's own head in a close cinematic shot); splatter / confetti / dust keep the depth test
      transparent: true, depthWrite: false, depthTest: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
  }

  spawn(time: number, p: THREE.Vector3, v: THREE.Vector3, life: number, s0: number, s1: number, rot: number, spin: number,
    col: THREE.Color, alpha: number, cell: number, grav: number, drag: number, stretch: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.aP0.setXYZW(i, p.x, p.y, p.z, time);
    const b = this.basis;
    this.aV.setXYZW(i, b.rx * v.x - b.rz * v.z, v.y, b.rz * v.x + b.rx * v.z, life);
    this.aS.setXYZW(i, s0, s1, rot, spin);
    this.aC.setXYZW(i, col.r, col.g, col.b, alpha);
    this.aX.setXYZW(i, cell, grav, drag, stretch);
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
    this.spawned++;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
    if (this.hi >= 0) {
      // upload only the written range (a spawn burst touches a few dozen of the 2048 slots)
      for (const a of [this.aP0, this.aV, this.aS, this.aC, this.aX]) {
        a.clearUpdateRanges();
        a.addUpdateRange(this.lo * 4, (this.hi - this.lo + 1) * 4);
        a.needsUpdate = true;
      }
      this.lo = Infinity; this.hi = -1;
    }
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ───────────────────────────────────────── decals ─────────────────────────────────────────

const D_VERT = /* glsl */`
attribute vec4 aD;   // cell, birth, life, unused
attribute vec4 aDC;  // rgb, alpha
uniform float uTime;
varying vec2 vUv; varying vec4 vC;
void main() {
  float t = uTime - aD.y;
  float fade = ( t < 0.0 || t > aD.z ) ? 0.0 : 1.0 - smoothstep( aD.z - 1.2, aD.z, t );
  float grow = 0.55 + 0.45 * smoothstep( 0.0, 0.08, t );
  vec3 p = position * grow;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4( p, 1.0 );
  vUv = ( vec2( mod( aD.x, ${ATLAS_COLS}.0 ), ${ATLAS_ROWS - 1}.0 - floor( aD.x / ${ATLAS_COLS}.0 ) ) + uv ) * vec2( ${1 / ATLAS_COLS}, ${1 / ATLAS_ROWS} );
  vC = vec4( aDC.rgb, aDC.a * fade );
}
`;
const D_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vUv; varying vec4 vC;
void main() {
  vec4 tx = texture2D( uAtlas, vUv );
  float a = tx.a * vC.a;
  if ( a < 0.03 ) discard;
  gl_FragColor = vec4( vC.rgb * tx.rgb, a );
}
`;

class DecalPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private next = 0;
  private readonly aD: THREE.InstancedBufferAttribute;
  private readonly aDC: THREE.InstancedBufferAttribute;
  readonly uniforms: { uTime: { value: number }; uAtlas: { value: THREE.Texture } };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private static readonly Z = new THREE.Vector3(0, 0, 1);
  count = 0;

  constructor(cap: number, atlas: THREE.Texture) {
    this.cap = cap;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aD = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aDC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.aD.setXYZW(i, 0, -1e6, 0.001, 0);
    geo.setAttribute('aD', this.aD);
    geo.setAttribute('aDC', this.aDC);
    this.uniforms = { uTime: { value: 0 }, uAtlas: { value: atlas } };
    const mat = new THREE.ShaderMaterial({
      name: 'fx-decal', uniforms: this.uniforms, vertexShader: D_VERT, fragmentShader: D_FRAG,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = 'fx-decals';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
  }

  add(time: number, pos: THREE.Vector3, normal: THREE.Vector3, size: number, rot: number, cell: number, col: THREE.Color,
    alpha: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.q.setFromUnitVectors(DecalPool.Z, this.n.copy(normal).normalize());
    this.q.multiply(this.q2.setFromAxisAngle(DecalPool.Z, rot));
    this.m.compose(pos, this.q, this.s.set(size, size, size));
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aD.setXYZW(i, cell, time, life, 0);
    this.aDC.setXYZW(i, col.r, col.g, col.b, alpha);
    this.aD.needsUpdate = true;
    this.aDC.needsUpdate = true;
    this.count++;
  }

  update(time: number): void { this.uniforms.uTime.value = time; }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ───────────────────────────────────────── spotlight cone ─────────────────────────────────────────

const SPOT_VERT = /* glsl */`
varying float vY; varying vec3 vN; varying vec3 vV;
void main() {
  vY = uv.y;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vN = normalize( mat3( modelMatrix ) * normal );
  vV = normalize( cameraPosition - wp.xyz );
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const SPOT_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uAlpha;
varying float vY; varying vec3 vN; varying vec3 vV;
void main() {
  float rim = abs( dot( normalize( vN ), normalize( vV ) ) );        // bright through the middle of the shaft, soft edges
  float a = uAlpha * pow( rim, 1.6 ) * ( 0.25 + 0.75 * vY ) * smoothstep( 0.0, 0.12, vY );
  gl_FragColor = vec4( uColor * a, 1.0 );
}
`;

// ───────────────────────────────────────── the system ─────────────────────────────────────────

/** colours per strength / kind (linear values; the post chain tone-maps) */
const COL = {
  hitCore: new THREE.Color(1.0, 0.95, 0.8),
  hitSpark: new THREE.Color(1.0, 0.62, 0.18),
  counter: new THREE.Color(1.0, 0.25, 0.08),
  punish: new THREE.Color(1.0, 0.1, 0.45),
  punishCore: new THREE.Color(1.0, 0.85, 0.1),
  block: new THREE.Color(0.35, 0.8, 1.0),
  parry: new THREE.Color(0.55, 0.9, 1.0),
  armor: new THREE.Color(1.0, 0.4, 0.05),
  red: new THREE.Color(0.78, 0.02, 0.06),
  redDark: new THREE.Color(0.42, 0.0, 0.03),
  redHi: new THREE.Color(0.95, 0.1, 0.12),
  dust: new THREE.Color(0.62, 0.56, 0.5),
  white: new THREE.Color(1, 1, 1),
  fireCore: new THREE.Color(1.0, 0.86, 0.45),
  fire: new THREE.Color(1.0, 0.42, 0.06),
  fireDeep: new THREE.Color(0.9, 0.12, 0.02),
  smoke: new THREE.Color(0.24, 0.22, 0.24),
  magicSmoke: new THREE.Color(0.55, 0.42, 0.72),
  elec: new THREE.Color(0.55, 0.85, 1.0),
  elecCore: new THREE.Color(0.9, 0.97, 1.0),
  gold: new THREE.Color(1.0, 0.78, 0.25),
  steel: new THREE.Color(0.85, 0.88, 0.95),
  brick: new THREE.Color(0.55, 0.2, 0.12),
  spot: new THREE.Color(1.0, 0.93, 0.78),
};
export const CONFETTI = [0xff2d55, 0xffd400, 0x00d9ff, 0x7cff4f, 0xff7a00, 0xb266ff, 0xffffff].map((c) => new THREE.Color(c));

export class FxSystem {
  readonly group = new THREE.Group();
  mode: GoreMode = 'splatter';
  reduceFlashing = false;
  time = 0;
  private readonly atlas: THREE.CanvasTexture;
  readonly add: ParticlePool;
  readonly alpha: ParticlePool;
  private readonly decals: DecalPool;
  private readonly dim: THREE.Mesh;
  private dimNow = 0;
  dimTarget = 0;
  /** metres along the camera's forward to park the dim plane (BoutView: just behind the farther fighter) */
  dimDepth = 0;
  private flash = 0;
  private flashColor = new THREE.Color(1, 1, 1);
  private flashHold = 0;
  private lines = 0;
  private linesHold = 0;
  private linesDecay = 3;
  private linesAt = new THREE.Vector2(0.5, 0.5);
  private linesColor = new THREE.Color(1, 1, 1);
  private linesInner = 0.22;
  private linesSeed = 0;
  private readonly post: Post;
  private readonly cam: FightCamera;
  private readonly spot: THREE.Mesh;
  private readonly spotPool: THREE.Mesh;
  private spotNow = 0;
  /** spotlight target (0 = off): world x of the lit fighter + strength 0..1 (BoutView sets it each frame) */
  spotTarget = 0;
  spotX = 0;
  /** CHANGED(VIEW3D): world z of the spotlight */
  spotZ = 0;
  /** CHANGED(VIEW3D): the FX basis (X axis on the ground; Z = toward the camera), shared with both particle pools */
  readonly basis: Basis = { rx: 1, rz: 0 };
  private seed = 12345;
  private readonly v0 = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly c0 = new THREE.Color();
  private readonly c1 = new THREE.Color();
  /** counters for the lab / harness */
  readonly stats = { hits: 0, splats: 0, wall: 0, rings: 0, beats: 0 };

  constructor(scene: THREE.Scene, post: Post, cam: FightCamera) {
    this.post = post;
    this.cam = cam;
    this.group.name = 'fx';
    this.atlas = new THREE.CanvasTexture(drawAtlas());
    this.atlas.colorSpace = THREE.NoColorSpace;
    this.atlas.generateMipmaps = true;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.add = new ParticlePool(2048, this.atlas, true, 'fx-add');
    this.alpha = new ParticlePool(2048, this.atlas, false, 'fx-alpha');
    this.decals = new DecalPool(64, this.atlas);
    this.add.basis = this.basis; this.alpha.basis = this.basis;
    this.group.add(this.add.mesh, this.alpha.mesh, this.decals.mesh);
    const dm = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, fog: false });
    dm.name = 'fx-dim';
    this.dim = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), dm);
    this.dim.name = 'fx-dim';
    this.dim.frustumCulled = false;
    this.dim.renderOrder = 2;
    this.dim.visible = true;
    this.group.add(this.dim);
    // spotlight shaft: an open cone from a rig 6.5 m up to a 1.1 m pool on the floor (uv.y = 1 at the top)
    const cone = new THREE.CylinderGeometry(0.12, 1.1, 6.5, 40, 1, true);
    cone.translate(0, 3.25, 0);
    const sm = new THREE.ShaderMaterial({
      name: 'fx-spot', uniforms: { uColor: { value: COL.spot.clone() }, uAlpha: { value: 0 } }, vertexShader: SPOT_VERT, fragmentShader: SPOT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.spot = new THREE.Mesh(cone, sm);
    this.spot.name = 'fx-spot';
    this.spot.frustumCulled = false;
    this.spot.renderOrder = 18;
    this.spot.visible = false;
    const poolTex = this.atlas.clone();
    poolTex.repeat.set(1 / ATLAS_COLS, 1 / ATLAS_ROWS);
    poolTex.offset.set((C.GLOW_SOFT % ATLAS_COLS) / ATLAS_COLS, (ATLAS_ROWS - 1 - Math.floor(C.GLOW_SOFT / ATLAS_COLS)) / ATLAS_ROWS);
    const pm = new THREE.MeshBasicMaterial({ map: poolTex, color: COL.spot, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    pm.name = 'fx-spot-pool';
    this.spotPool = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), pm);
    this.spotPool.rotation.x = -Math.PI / 2;
    this.spotPool.position.y = 0.01;
    this.spotPool.name = 'fx-spot-pool';
    this.spotPool.renderOrder = 6;
    this.spotPool.visible = false;
    this.group.add(this.spot, this.spotPool);
    scene.add(this.group);
  }

  private rnd(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  /** CHANGED(VIEW3D): set the FX basis X axis (planar, normalised here); Z = toward the camera = (-X.z, X.x) */
  setBasis(rx: number, rz: number): void {
    const l = Math.hypot(rx, rz);
    if (l < 1e-6) return;
    this.basis.rx = rx / l; this.basis.rz = rz / l;
  }
  /** a LOCAL offset (x along the basis X, y up, z toward the camera) added to a world point -> out */
  offset(at: THREE.Vector3, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const b = this.basis;
    return out.set(at.x + b.rx * x - b.rz * z, at.y + y, at.z + b.rz * x + b.rx * z);
  }
  rr(a: number, b: number): number { return a + (b - a) * this.rnd(); }

  private burst(pool: ParticlePool, at: THREE.Vector3, n: number, speed: [number, number], dirX: number, spread: number,
    life: [number, number], size: [number, number], sizeEnd: number, col: THREE.Color, alpha: number, cell: number,
    grav: number, drag: number, stretch: number, spin = 0): void {
    for (let i = 0; i < n; i++) {
      // a cone around +x*dirX (the hit's travel), with `spread` (0..1) toward a full sphere
      const a = this.rr(-Math.PI, Math.PI) * spread;
      const e = this.rr(-0.9, 0.9) * spread;
      const sp = this.rr(speed[0], speed[1]);
      this.v0.set(Math.cos(a) * Math.cos(e) * dirX, Math.sin(e) + 0.25 * spread, Math.sin(a) * Math.cos(e) * 0.6).normalize().multiplyScalar(sp);
      const s = this.rr(size[0], size[1]);
      pool.spawn(this.time, at, this.v0, this.rr(life[0], life[1]), s, s * sizeEnd, this.rr(0, 6.28), spin * this.rr(-1, 1),
        col, alpha, cell, grav, drag, stretch);
    }
  }

  private one(pool: ParticlePool, at: THREE.Vector3, life: number, s0: number, s1: number, col: THREE.Color, alpha: number,
    cell: number, rot = 0): void {
    pool.spawn(this.time, at, this.v1.set(0, 0, 0), life, s0, s1, rot, 0, col, alpha, cell, 0, 0, 0);
  }

  screenFlash(amount: number, color: THREE.ColorRepresentation, hold = 0.03): void {
    const a = this.reduceFlashing ? Math.min(amount, 0.2) : amount;
    if (a >= this.flash) { this.flash = a; this.flashColor.set(color); this.flashHold = hold; }
  }

  speedLines(at: THREE.Vector3, amount: number, color: THREE.ColorRepresentation, hold: number, decay: number, inner: number): void {
    if (amount < this.lines) return;
    this.cam.toScreen(at, this.linesAt);
    this.lines = amount; this.linesHold = hold; this.linesDecay = decay;
    this.linesColor.set(color); this.linesInner = inner; this.linesSeed = Math.floor(this.rnd() * 1000);
  }

  /**
   * A strike connected / was blocked / parried. `strength`: §17 rule 6 class (0 L .. 7 throw); `dir` = +1 when the
   * blow travels toward +x.
   */
  hit(kind: HitKind, strength: number, at: THREE.Vector3, dir: number): void {
    this.stats.hits++;
    const heavy = strength >= 2 && strength !== 6 && strength !== 7;
    const k = strength === 0 ? 0.6 : strength === 1 ? 0.85 : strength === 2 ? 1.1 : strength === 4 ? 1.35 : strength === 5 ? 1.25 : 1.0;
    const d = dir >= 0 ? 1 : -1;
    if (kind === 'block') {
      this.one(this.add, at, 0.16, 0.45 * k, 0.75 * k, COL.block, 1, C.CHEVRON, d > 0 ? Math.PI : 0);
      this.burst(this.add, at, Math.round(6 * k), [3, 6], -d, 0.9, [0.1, 0.22], [0.06, 0.1], 0.3, COL.block, 1, C.STREAK, 4, 3, 0.08);
      this.one(this.add, at, 0.1, 0.25, 0.55, COL.white, 0.9, C.GLOW);
      return;
    }
    if (kind === 'parry' || kind === 'perfect') {
      const big = kind === 'perfect';
      this.one(this.add, at, big ? 0.5 : 0.25, 0.2, big ? 3.2 : 1.4, COL.parry, 1, C.RING_THICK);
      this.one(this.add, at, big ? 0.35 : 0.18, 0.3, big ? 1.4 : 0.8, COL.white, 1, C.TWINKLE, 0.4);
      if (big) {
        this.one(this.add, at, 0.7, 0.4, 4.5, COL.white, 0.8, C.RING);
        this.screenFlash(0.55, 0xbfefff, 0.05);
        this.speedLines(at, 0.8, 0xffffff, 0.2, 2.2, 0.28);
        this.stats.rings++;
      } else this.screenFlash(0.18, 0xbfefff);
      this.burst(this.add, at, big ? 18 : 8, [3, 7], -d, 1, [0.15, 0.35], [0.05, 0.09], 0.3, COL.parry, 1, C.STREAK, 2, 2, 0.1);
      return;
    }
    if (kind === 'armor') {
      this.one(this.add, at, 0.2, 0.4, 0.9, COL.armor, 1, C.STAR, this.rr(0, 6));
      this.burst(this.add, at, 10, [3, 6], -d, 0.9, [0.12, 0.3], [0.05, 0.09], 0.3, COL.armor, 1, C.STREAK, 3, 2, 0.1);
      return;
    }
    // strikes that connected: hit / counter / punish / throw / clash
    const core = kind === 'punish' ? COL.punishCore : COL.hitCore;
    const spark = kind === 'counter' ? COL.counter : kind === 'punish' ? COL.punish : COL.hitSpark;
    this.one(this.add, at, 0.13 + 0.05 * k, 0.3 * k, 0.75 * k, core, 1, C.STAR, this.rr(0, 6.28));
    this.one(this.add, at, 0.09, 0.4 * k, 0.85 * k, spark, 0.9, C.GLOW);
    this.burst(this.add, at, Math.round(8 + 10 * k), [4, 9 * k], d, 0.75, [0.12, 0.3], [0.05, 0.1], 0.2, spark, 1, C.STREAK, 6, 2.5, 0.09);
    if (heavy || kind !== 'hit') {
      this.one(this.add, at, 0.16, 0.45 * k, 1.0 * k, spark, 0.85, C.POW, this.rr(0, 6.28));
      this.one(this.add, at, 0.22, 0.3, 1.2 * k, core, 0.8, C.RING);
    }
    if (kind === 'counter') { this.screenFlash(0.16, 0xff5a1f); this.speedLines(at, 0.55, 0xffffff, 0.08, 4, 0.2); }
    else if (kind === 'punish') { this.screenFlash(0.2, 0xffd400); this.speedLines(at, 0.75, 0xfff2b0, 0.12, 3.5, 0.18); }
    else if (heavy) this.speedLines(at, 0.32 + 0.08 * (strength - 2), 0xffffff, 0.05, 5, 0.3);
    if (strength >= 1 && kind !== 'clash') this.splatter(at, d, heavy ? 1 + 0.25 * (strength - 2) : 0.4);
  }

  /** comic splatter per the setting (splatter | sparks | confetti); amount ~0.4 light .. 2 KO */
  splatter(at: THREE.Vector3, dir: number, amount: number): void {
    this.stats.splats++;
    const n = Math.round(10 * amount);
    if (this.mode === 'sparks') {
      this.burst(this.add, at, n + 4, [3, 8], dir, 0.8, [0.25, 0.6], [0.04, 0.08], 0.2, COL.hitSpark, 1, C.STREAK, 9, 0.8, 0.12);
      this.burst(this.add, at, Math.round(n / 2), [1, 3], dir, 1, [0.3, 0.6], [0.05, 0.1], 0.1, COL.punishCore, 1, C.TWINKLE, 6, 1, 0, 6);
      return;
    }
    if (this.mode === 'confetti') {
      for (let i = 0; i < n + 6; i++) {
        const col = CONFETTI[Math.floor(this.rnd() * CONFETTI.length)];
        this.v0.set(dir * this.rr(0.5, 3.5), this.rr(1.5, 4.5), this.rr(-1, 1));
        const s = this.rr(0.08, 0.15);
        this.alpha.spawn(this.time, at, this.v0, this.rr(0.9, 1.6), s, s, this.rr(0, 6), this.rr(-12, 12), col, 1,
          this.rnd() < 0.7 ? C.CONF_RECT : C.CONF_RIB, 4.5, 1.6, 0);
      }
      return;
    }
    // splatter: comic red paint - blobs + stretched drops, floor stains when it lands
    for (let i = 0; i < n; i++) {
      const col = this.rnd() < 0.25 ? COL.redDark : this.rnd() < 0.2 ? COL.redHi : COL.red;
      this.v0.set(dir * this.rr(1, 4.5), this.rr(0.5, 3.5), this.rr(-0.8, 0.8));
      const s = this.rr(0.05, 0.12) * (0.8 + 0.3 * amount);
      this.alpha.spawn(this.time, at, this.v0, this.rr(0.45, 0.8), s, s * 0.8, this.rr(0, 6), 0, col, 1,
        this.rnd() < 0.5 ? C.DROP : (this.rnd() < 0.5 ? C.BLOB_A : C.BLOB_B), 9.8, 0.5, this.rnd() < 0.5 ? 0.12 : 0);
    }
    this.one(this.alpha, at, 0.18, 0.25 * amount, 0.55 * amount, COL.red, 0.95, C.BLOB_A, this.rr(0, 6.28));
    if (amount >= 0.9) {                                   // a few floor stains where the paint lands
      const m = Math.min(4, Math.round(amount * 2));
      for (let i = 0; i < m; i++) {
        this.offset(at, dir * this.rr(0.3, 1.3), 0, this.rr(-0.5, 0.5), this.v0).y = 0.004;
        this.decals.add(this.time + 0.25, this.v0, this.v1.set(0, 1, 0), this.rr(0.25, 0.5) * amount, this.rr(0, 6.28),
          this.rnd() < 0.5 ? C.BLOB_A : C.BLOB_B, COL.red, 0.9, 7);
      }
    }
  }

  /**
   * CHANGED(VIEW3D): a wall splat on the RING boundary. (px, pz) = the contact point on the wall's inner face (the sim's
   * WALL_SPLAT c / d), (nx, nz) = the wall's INWARD normal, y = the victim's chest height, solidTop = the height of the
   * paintable wall (ring3d.ringSolidTop: brick / tile / panel = the wall top, the control room's kick panels 0.42 m, a cable
   * railing 0 = the paint lands on the floor at its foot). The splat sprays back into the ring along the normal.
   */
  wallSplat(px: number, pz: number, nx: number, nz: number, y: number, solidTop: number, dustColor?: THREE.Color | null): void {
    this.stats.wall++;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const cell = this.mode === 'sparks' ? C.SCORCH : C.WALL_SPLAT;
    const col = this.mode === 'splatter' ? COL.red : this.mode === 'sparks' ? new THREE.Color(0.08, 0.05, 0.04) : CONFETTI[Math.floor(this.rnd() * 6)];
    const nrm = new THREE.Vector3(nx, 0, nz);
    const tx = -nz, tz = nx;                                // along the wall
    if (solidTop > 0.25) {
      const size = Math.min(1.35, solidTop * 0.95);
      const cy = Math.max(size * 0.45, Math.min(solidTop - size * 0.42, y));
      this.decals.add(this.time, new THREE.Vector3(px + nx * 0.02, cy, pz + nz * 0.02), nrm, size, this.rr(-0.4, 0.4), cell, col, 0.95, 9);
      if (this.mode === 'confetti') {
        for (let i = 0; i < 3; i++) {
          const a = this.rr(-0.5, 0.5);
          this.decals.add(this.time, new THREE.Vector3(px + nx * 0.025 + tx * a, Math.max(0.2, Math.min(solidTop - 0.2, cy + this.rr(-0.3, 0.3))), pz + nz * 0.025 + tz * a), nrm,
            0.4, this.rr(0, 6), C.CONF_RECT, CONFETTI[Math.floor(this.rnd() * CONFETTI.length)], 0.9, 9);
        }
      }
    }
    // the floor at the wall's foot catches paint too (all of it on a railing)
    const solid = solidTop > 0.25;
    this.decals.add(this.time + 0.2, new THREE.Vector3(px + nx * (solid ? 0.35 : 0.5), 0.006, pz + nz * (solid ? 0.35 : 0.5)), new THREE.Vector3(0, 1, 0),
      solid ? 0.55 : 1.15, this.rr(0, 6.28), this.rnd() < 0.5 ? C.BLOB_A : C.BLOB_B, this.mode === 'splatter' ? COL.red : col, 0.9, 8);
    // spray + dust + POW leave the wall along the inward normal (one-call basis)
    const sx = this.basis.rx, sz = this.basis.rz;
    this.setBasis(nx, nz);
    const at = new THREE.Vector3(px + nx * 0.2, y, pz + nz * 0.2);
    this.dust(at, 1.2, dustColor ?? undefined);
    this.splatter(at.set(px + nx * 0.15, y, pz + nz * 0.15), 1, 1.4);
    this.one(this.add, at.set(px + nx * 0.1, y, pz + nz * 0.1), 0.2, 0.6, 1.8, COL.hitCore, 0.9, C.POW, this.rr(0, 6));
    this.basis.rx = sx; this.basis.rz = sz;
  }

  /** dust puffs (wall hits, knockdowns, ground bounces); `color` overrides the stage-neutral grey-brown */
  dust(at: THREE.Vector3, amount: number, color?: THREE.Color): void {
    const n = Math.round(6 * amount);
    for (let i = 0; i < n; i++) {
      this.v0.set(this.rr(-1.2, 1.2), this.rr(0.2, 1.0), this.rr(-0.6, 0.6));
      const s = this.rr(0.3, 0.6) * amount;
      this.alpha.spawn(this.time, at, this.v0, this.rr(0.5, 0.9), s * 0.6, s * 1.6, this.rr(0, 6), this.rr(-1, 1), color ?? COL.dust, 0.55,
        C.DUST, -0.4, 2.5, 0);
    }
  }

  /** knockdown landing */
  land(at: THREE.Vector3): void { this.dust(at, 1); }

  /** super freeze start: flash + lines around the user + background dim (BoutView holds dimTarget) */
  superFlash(at: THREE.Vector3, level: number): void {
    this.screenFlash(level >= 3 ? 0.7 : 0.5, 0xffffff, 0.04);
    this.speedLines(at, 1.0, 0xffffff, 0.35, 2.5, 0.3);
    this.one(this.add, at, 0.5, 0.4, 3.0, COL.punishCore, 0.9, C.RING_THICK);
    this.one(this.add, at, 0.35, 1.0, 2.2, COL.hitCore, 0.8, C.STAR, this.rr(0, 6));
    this.burst(this.add, at, 24, [2, 6], 1, 1, [0.3, 0.7], [0.05, 0.1], 0.3, COL.punishCore, 1, C.TWINKLE, 1, 1.5, 0, 4);
  }

  /** IMPACT start: an orange shock ring at the fighter */
  impactStart(at: THREE.Vector3): void {
    this.one(this.add, at, 0.3, 0.3, 2.0, COL.armor, 0.9, C.RING_THICK);
  }

  /** KO: big flash; the match-deciding KO adds the finish-zoom lines */
  koFinish(at: THREE.Vector3, matchPoint: boolean): void {
    this.screenFlash(matchPoint ? 0.72 : 0.55, 0xffffff, matchPoint ? 0.06 : 0.03);
    this.speedLines(at, matchPoint ? 1.2 : 0.8, matchPoint ? 0xffe14a : 0xffffff, matchPoint ? 0.9 : 0.35, 1.5, 0.16);
    this.one(this.add, at, 0.35, 0.8, 3.2, COL.hitCore, 1, C.POW, this.rr(0, 6));
    this.one(this.add, at, 0.6, 0.3, 4.0, COL.white, 0.9, C.RING_THICK);
    this.splatter(at, 1, 1.6);
    this.splatter(at, -1, 1.0);
  }

  // ───────────────────────── P2: PRIME TIME / projectile verbs (CHANGED VIEW) ─────────────────────────

  /** an extra comic impact on a body (PRIME TIME `impact_*` beats): star, POW, ring, sparks, a little paint - no flash */
  impactBurst(at: THREE.Vector3, dir: number, k = 1): void {
    this.stats.beats++;
    this.one(this.add, at, 0.14, 0.3 * k, 0.9 * k, COL.hitCore, 1, C.STAR, this.rr(0, 6.28));
    this.one(this.add, at, 0.16, 0.4 * k, 1.1 * k, COL.hitSpark, 0.8, C.POW, this.rr(0, 6.28));
    if (k >= 1) this.one(this.add, at, 0.22, 0.3, 1.3 * k, COL.hitCore, 0.7, C.RING);
    this.burst(this.add, at, Math.round(10 * k), [4, 8 * k], dir, 0.75, [0.12, 0.28], [0.05, 0.09], 0.2, COL.hitSpark, 1, C.STREAK, 6, 2.5, 0.09);
    if (k >= 1) this.splatter(at, dir, 0.5 * k);
  }

  /** one frame of a flame jet from `at` along +x*dir (call every rendered frame while it burns); `len` ~ reach in m */
  flameJet(at: THREE.Vector3, dir: number, len: number, amount = 1, dt = 1 / 60): void {
    const n = Math.max(1, Math.round(90 * amount * Math.min(0.05, dt)));
    const sp = len * 2.2;
    for (let i = 0; i < n; i++) {
      this.v0.set(dir * this.rr(sp * 0.7, sp * 1.1), this.rr(-0.5, 0.9), this.rr(-0.5, 0.5));
      const s = this.rr(0.12, 0.2);
      const hot = this.rnd() < 0.35;
      this.add.spawn(this.time, at, this.v0, this.rr(0.28, 0.45), s, s * this.rr(3.5, 5), this.rr(-0.4, 0.4) + (dir > 0 ? -1.57 : 1.57), this.rr(-2, 2),
        hot ? COL.fireCore : this.rnd() < 0.5 ? COL.fire : COL.fireDeep, hot ? 0.9 : 0.8, C.FLAME, -1.5, 2.4, 0);
    }
    if (this.rnd() < 0.6 * amount) {
      this.offset(at, dir * len * this.rr(0.6, 1.0), this.rr(0, 0.3), 0, this.v2);
      this.v0.set(dir * this.rr(0.5, 1.5), this.rr(0.6, 1.4), this.rr(-0.3, 0.3));
      const s = this.rr(0.35, 0.6);
      this.alpha.spawn(this.time, this.v2, this.v0, this.rr(0.8, 1.3), s, s * 2.4, this.rr(0, 6), this.rr(-0.6, 0.6), COL.smoke, 0.45, C.SMOKE, -0.6, 1.2, 0);
    }
  }

  /** a ball of fire exploding outward (fireball impact, Zambini's flourish, pyro pop) */
  fireBurst(at: THREE.Vector3, amount = 1): void {
    this.stats.beats++;
    this.one(this.add, at, 0.25, 0.4 * amount, 1.8 * amount, COL.fireCore, 1, C.GLOW);
    for (let i = 0; i < Math.round(26 * amount); i++) {
      const a = this.rr(0, 6.28), e = this.rr(-0.3, 1.2);
      this.v0.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e) * 0.6).multiplyScalar(this.rr(1.5, 4.5) * amount);
      const s = this.rr(0.18, 0.32) * amount;
      this.add.spawn(this.time, at, this.v0, this.rr(0.35, 0.65), s, s * 2.6, this.rr(0, 6), this.rr(-3, 3),
        this.rnd() < 0.3 ? COL.fireCore : COL.fire, 0.85, C.FLAME, -2, 2.8, 0);
    }
    for (let i = 0; i < Math.round(8 * amount); i++) {
      this.v0.set(this.rr(-1.2, 1.2), this.rr(0.8, 2.0), this.rr(-0.4, 0.4));
      const s = this.rr(0.4, 0.7) * amount;
      this.alpha.spawn(this.time + this.rr(0.05, 0.2), at, this.v0, this.rr(0.9, 1.5), s, s * 2.2, this.rr(0, 6), this.rr(-0.5, 0.5), COL.smoke, 0.5, C.SMOKE, -0.8, 1.4, 0);
    }
    this.burst(this.add, at, Math.round(14 * amount), [3, 8], 1, 1, [0.4, 0.9], [0.04, 0.07], 0.3, COL.fireCore, 1, C.EMBER, 4, 1, 0.06);
  }

  /** one frame of a rising fire column at (x, z): Ricky's pyro, pyro_line pops */
  fireColumn(x: number, z: number, height: number, dt = 1 / 60, amount = 1): void {
    const n = Math.max(1, Math.round(70 * amount * Math.min(0.05, dt)));
    this.v2.set(x, 0.05, z);
    for (let i = 0; i < n; i++) {
      this.v2.set(x + this.rr(-0.15, 0.15), 0.05, z + this.rr(-0.15, 0.15));
      this.v0.set(this.rr(-0.3, 0.3), this.rr(height * 2.4, height * 3.2), this.rr(-0.2, 0.2));
      const s = this.rr(0.18, 0.3);
      this.add.spawn(this.time, this.v2, this.v0, this.rr(0.3, 0.45), s, s * 3.2, this.rr(-0.3, 0.3), this.rr(-1.5, 1.5),
        this.rnd() < 0.3 ? COL.fireCore : COL.fire, 0.85, C.FLAME, 2.5, 1.6, 0);
    }
    if (this.rnd() < 0.3) this.burst(this.add, this.v2.set(x, height * 0.6, z), 2, [1, 3], 1, 1, [0.5, 1.0], [0.03, 0.06], 0.2, COL.fireCore, 1, C.EMBER, -1, 1, 0.05);
  }

  /** one frame of electricity arcing from `a` to `b` (taser wire / jolt); `amount` 0..1 */
  arc(a: THREE.Vector3, b: THREE.Vector3, amount = 1): void {
    const n = Math.max(1, Math.round(3 * amount));
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.max(0.05, Math.hypot(dx, dy, dz));
    const sx = dx * this.basis.rx + dz * this.basis.rz;      // the screen-horizontal part (the bolt sprite's roll)
    for (let i = 0; i < n; i++) {
      const t = (i + this.rnd()) / n;
      this.v2.set(a.x + dx * t + this.rr(-0.06, 0.06), a.y + dy * t + this.rr(-0.08, 0.08), a.z + dz * t);
      this.add.spawn(this.time, this.v2, this.v0.set(sx / len * 0.01, dy / len * 0.01, 0), 0.06, len / n * 1.3, len / n * 1.1,
        Math.atan2(dy, sx) + this.rr(-0.3, 0.3), 0, this.rnd() < 0.5 ? COL.elecCore : COL.elec, 1, C.BOLT, 0, 0, 0);
    }
  }

  /** an electric burst (taser hit, jolt beats) */
  electric(at: THREE.Vector3, amount = 1): void {
    this.stats.beats++;
    this.one(this.add, at, 0.14, 0.3 * amount, 1.0 * amount, COL.elecCore, 1, C.SPARK_X, this.rr(0, 6));
    this.one(this.add, at, 0.2, 0.3, 1.3 * amount, COL.elec, 0.9, C.RING_DASH, this.rr(0, 6));
    for (let i = 0; i < Math.round(6 * amount); i++) {
      this.offset(at, this.rr(-0.35, 0.35), this.rr(-0.5, 0.5), 0.05, this.v2);
      this.add.spawn(this.time, this.v2, this.v0.set(0, 0, 0), this.rr(0.05, 0.1), this.rr(0.25, 0.45), this.rr(0.2, 0.35), this.rr(0, 6.28), 0,
        this.rnd() < 0.5 ? COL.elecCore : COL.elec, 1, C.BOLT, 0, 0, 0);
    }
    this.burst(this.add, at, Math.round(10 * amount), [3, 7], 1, 1, [0.12, 0.3], [0.03, 0.06], 0.2, COL.elecCore, 1, C.STREAK, 6, 2, 0.1);
  }

  /** a flock of doves bursting out of `at` (Zambini) with falling feathers */
  doves(at: THREE.Vector3, n = 10): void {
    this.stats.beats++;
    for (let i = 0; i < n; i++) {
      const a = this.rr(0, 6.28);
      this.v0.set(Math.cos(a) * this.rr(0.8, 2.2), this.rr(2.0, 3.6), Math.sin(a) * this.rr(0.3, 1.0));
      const s = this.rr(0.28, 0.4);
      this.alpha.spawn(this.time + i * 0.012, at, this.v0, this.rr(1.6, 2.4), s, s * 0.9, this.v0.x < 0 ? Math.PI : 0, this.rr(-0.8, 0.8), COL.white, 1, C.DOVE, -0.6, 0.6, 0);
    }
    for (let i = 0; i < n * 2; i++) {
      this.v0.set(this.rr(-1.5, 1.5), this.rr(0.5, 2.0), this.rr(-0.6, 0.6));
      const s = this.rr(0.06, 0.1);
      this.alpha.spawn(this.time + this.rr(0, 0.3), at, this.v0, this.rr(1.8, 2.8), s, s, this.rr(0, 6), this.rr(-4, 4), COL.white, 1, C.FEATHER, 1.2, 2.2, 0);
    }
    this.one(this.add, at, 0.3, 0.5, 2.0, COL.white, 0.8, C.GLOW_SOFT);
  }

  /** a stage-magic smoke puff (purple-grey) with sparkles */
  smokePuff(at: THREE.Vector3, amount = 1, magic = true): void {
    this.stats.beats++;
    for (let i = 0; i < Math.round(14 * amount); i++) {
      const a = this.rr(0, 6.28);
      this.v0.set(Math.cos(a) * this.rr(0.4, 1.6), this.rr(0.2, 1.4), Math.sin(a) * this.rr(0.2, 0.6));
      const s = this.rr(0.22, 0.42) * amount;
      this.alpha.spawn(this.time, this.v2.set(at.x, at.y + this.rr(-0.3, 0.5), at.z), this.v0, this.rr(0.8, 1.3), s, s * 2.0, this.rr(0, 6), this.rr(-0.8, 0.8),
        magic ? COL.magicSmoke : COL.smoke, 0.55, C.SMOKE, -0.5, 1.8, 0);
    }
    if (magic) this.burst(this.add, at, Math.round(16 * amount), [1, 3], 1, 1, [0.5, 1.0], [0.06, 0.12], 0.2, COL.gold, 1, C.STAR5, -0.5, 1, 0, 4);
  }

  /** a floor slam: dust ring, crack decal, debris chunks, a ground shock ring */
  slam(at: THREE.Vector3, amount = 1, dustColor?: THREE.Color): void {
    this.stats.beats++;
    const p = this.v2.set(at.x, 0.05, at.z);
    for (let i = 0; i < Math.round(18 * amount); i++) {
      const a = (i / Math.round(18 * amount)) * 6.28 + this.rr(-0.1, 0.1);
      this.v0.set(Math.cos(a) * this.rr(2.5, 4.5) * amount, this.rr(0.2, 0.8), Math.sin(a) * this.rr(1.2, 2.2) * amount);
      const s = this.rr(0.35, 0.6) * amount;
      this.alpha.spawn(this.time, p, this.v0, this.rr(0.6, 1.0), s * 0.6, s * 1.9, this.rr(0, 6), this.rr(-1, 1), dustColor ?? COL.dust, 0.6, C.DUST, -0.3, 3.2, 0);
    }
    for (let i = 0; i < Math.round(10 * amount); i++) {
      this.v0.set(this.rr(-2.5, 2.5), this.rr(2.5, 5.0), this.rr(-1.0, 1.0));
      const s = this.rr(0.05, 0.11);
      this.alpha.spawn(this.time, p, this.v0, this.rr(0.7, 1.1), s, s, this.rr(0, 6), this.rr(-10, 10), this.c0.copy(dustColor ?? COL.dust).multiplyScalar(0.6), 1, C.CHUNK, 9.8, 0.4, 0);
    }
    this.decals.add(this.time, this.v1.set(at.x, 0.006, at.z), new THREE.Vector3(0, 1, 0), 1.6 * amount, this.rr(0, 6.28), C.CRACK, new THREE.Color(0.05, 0.04, 0.04), 0.85, 6);
    this.one(this.add, this.v1.set(at.x, 0.3, at.z), 0.35, 0.5, 3.4 * amount, COL.hitCore, 0.7, C.RING_THICK);
    this.one(this.add, this.v1.set(at.x, 0.6, at.z), 0.18, 0.8, 2.2 * amount, COL.hitCore, 1, C.POW, this.rr(0, 6));
  }

  /** an expanding shock wave (roar, power-up, finisher) */
  shockwave(at: THREE.Vector3, amount = 1, color: THREE.ColorRepresentation = 0xffffff): void {
    this.stats.beats++;
    // (sizes read in close PRIME TIME shots too: a 6 m dashed ring filled the frame like a UI element - verifier strip)
    this.c0.set(color);
    this.one(this.add, at, 0.45, 0.4, 3.0 * amount, this.c0, 0.55, C.RING_THICK);
    this.one(this.add, at, 0.6, 0.2, 4.0 * amount, this.c0, 0.3, C.RING, this.rr(0, 6));
    this.one(this.add, at, 0.3, 0.5, 1.8 * amount, this.c0, 0.4, C.GLOW_SOFT);
    this.burst(this.add, at, Math.round(14 * amount), [3, 6], 1, 1, [0.2, 0.4], [0.04, 0.07], 0.3, this.c0, 0.9, C.STREAK, 0, 2.5, 0.12);
  }

  /** confetti raining over the set around a floor point (finishers, crowd pops, season finale); CHANGED(VIEW3D): a world
   *  point, the spread along the FX basis (width across the screen, -2.5 .. +1.2 m in depth) */
  confettiRain(at: THREE.Vector3, width = 7, n = 90): void {
    this.stats.beats++;
    for (let i = 0; i < n; i++) {
      this.offset(at, this.rr(-width / 2, width / 2), 0, this.rr(-2.5, 1.2), this.v2).y = this.rr(4.2, 6.0);
      this.v0.set(this.rr(-0.8, 0.8), this.rr(-1.5, 0.5), this.rr(-0.3, 0.3));
      const s = this.rr(0.07, 0.13);
      const cell = this.rnd() < 0.5 ? C.CONF_RECT : this.rnd() < 0.6 ? C.CONF_RIB : C.STAR5;
      this.alpha.spawn(this.time + this.rr(0, 0.6), this.v2, this.v0, this.rr(2.8, 4.0), s, s, this.rr(0, 6), this.rr(-9, 9),
        CONFETTI[Math.floor(this.rnd() * CONFETTI.length)], 1, cell, 1.6, 1.4, 0);
    }
  }

  /** a shower of sparks falling from a world point (lighting-rig hit, overhead pyro); CHANGED(VIEW3D): world point */
  sparkShower(at: THREE.Vector3, width = 2, n = 50): void {
    this.stats.beats++;
    for (let i = 0; i < n; i++) {
      this.offset(at, this.rr(-width / 2, width / 2), this.rr(-0.2, 0.2), this.rr(-0.8, 0.5), this.v2);
      this.v0.set(this.rr(-1.5, 1.5), this.rr(-1, 2.5), this.rr(-0.5, 0.5));
      this.add.spawn(this.time + this.rr(0, 0.25), this.v2, this.v0, this.rr(0.6, 1.2), this.rr(0.03, 0.06), 0.02, 0, 0,
        this.rnd() < 0.4 ? COL.fireCore : COL.gold, 1, C.STREAK, 9.8, 0.3, 0.12);
    }
  }

  /** metal-on-body clang: bright white-gold streak sparks + a cross flare (cleaver, baton, cane) */
  metalSparks(at: THREE.Vector3, dir: number, amount = 1): void {
    this.one(this.add, at, 0.12, 0.3, 1.1 * amount, COL.steel, 1, C.SPARK_X, this.rr(0, 6));
    this.burst(this.add, at, Math.round(16 * amount), [5, 11], dir, 0.8, [0.15, 0.35], [0.03, 0.05], 0.3, COL.gold, 1, C.STREAK, 9.8, 1.5, 0.14);
  }

  /** broken pieces (brick / wood / glass): chunks of `color` flying off `at` */
  debris(at: THREE.Vector3, color: THREE.ColorRepresentation, n = 12, dir = 0, cell: number = C.CHUNK): void {
    this.c0.set(color);
    for (let i = 0; i < n; i++) {
      this.v0.set((dir || this.rr(-1, 1)) * this.rr(0.5, 3.0) + this.rr(-0.8, 0.8), this.rr(1.0, 3.8), this.rr(-0.8, 0.8));
      const s = this.rr(0.05, 0.11);
      const shade = this.rr(0.7, 1.15);
      this.alpha.spawn(this.time, at, this.v0, this.rr(0.6, 1.0), s, s * 0.9, this.rr(0, 6), this.rr(-14, 14),
        this.c1.setRGB(this.c0.r * shade, this.c0.g * shade, this.c0.b * shade), 1, cell, 9.8, 0.5, 0);
    }
  }

  /** playing cards scattering (card fan destroy, card flourishes) */
  cards(at: THREE.Vector3, n = 10, dir = 0): void {
    for (let i = 0; i < n; i++) {
      this.v0.set((dir || this.rr(-1, 1)) * this.rr(0.3, 2.2), this.rr(1.0, 3.2), this.rr(-0.6, 0.6));
      const s = this.rr(0.1, 0.14);
      this.alpha.spawn(this.time, at, this.v0, this.rr(1.0, 1.6), s, s, this.rr(0, 6), this.rr(-12, 12), COL.white, 1, C.CARD, 3.5, 1.8, 0);
    }
  }

  /** a glittering sparkle burst (magic, spotlight flash, power-up) */
  sparkle(at: THREE.Vector3, n = 16, color: THREE.ColorRepresentation = 0xffd65a): void {
    this.c0.set(color);
    this.burst(this.add, at, n, [0.8, 2.6], 1, 1, [0.4, 0.9], [0.05, 0.11], 0.2, this.c0, 1, this.rnd() < 0.5 ? C.STAR5 : C.TWINKLE, -0.4, 1.2, 0, 5);
  }

  /** a soft glow flare at `at` (projectile cores, power-ups); `life` seconds */
  glowAt(at: THREE.Vector3, size: number, color: THREE.ColorRepresentation, life = 0.05, alpha = 0.9): void {
    this.c0.set(color);
    this.one(this.add, at, life, size, size, this.c0, alpha, C.GLOW_SOFT);
  }

  /** a single trail particle behind a moving thing (projectile trails) */
  trail(at: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.ColorRepresentation, cell: number, life = 0.25, additive = true,
    sizeEnd = 0.2, grav = 0, drag = 1, alpha = 0.9): void {
    this.c0.set(color);
    (additive ? this.add : this.alpha).spawn(this.time, at, vel, life, size, size * sizeEnd, this.rr(0, 6.28), this.rr(-2, 2), this.c0, alpha, cell, grav, drag, 0);
  }

  /** a floor decal (scorch / stain / crack) */
  floorMark(x: number, z: number, size: number, cell: number, color: THREE.ColorRepresentation, life = 6, alpha = 0.8): void {
    this.decals.add(this.time, this.v1.set(x, 0.006, z), new THREE.Vector3(0, 1, 0), size, this.rr(0, 6.28), cell, new THREE.Color(color), alpha, life);
  }

  /** per rendered frame. `timeScale` = 0.25 in the KO slow-mo. */
  update(dt: number, timeScale: number): void {
    const sdt = Math.max(0, dt) * timeScale;
    this.time += sdt;
    this.add.update(this.time);
    this.alpha.update(this.time);
    this.decals.update(this.time);
    // flash / lines decay (real time: a flash must not linger in slow-mo)
    if (this.flashHold > 0) this.flashHold -= dt; else this.flash = Math.max(0, this.flash - dt * 6);
    if (this.linesHold > 0) this.linesHold -= dt; else this.lines = Math.max(0, this.lines - dt * this.linesDecay);
    this.post.setFlash(this.flash, this.flashColor);
    this.post.setLines(Math.min(1, this.lines), this.linesAt.x, this.linesAt.y, this.linesColor, this.linesInner, this.linesSeed);
    // background dim plane: camera-facing, just behind the fighters' depth
    this.dimNow += (this.dimTarget - this.dimNow) * (1 - Math.exp(-dt * 18));
    const cam = this.cam.camera;
    const mat = this.dim.material as THREE.MeshBasicMaterial;
    mat.opacity = this.dimNow;
    this.dim.visible = this.dimNow > 0.005;
    if (this.dim.visible) {
      cam.getWorldDirection(this.v0);
      const depth = this.dimDepth > 0.5 ? this.dimDepth : Math.max(1.5, Math.abs(cam.position.z) + 1.3);
      this.dim.position.copy(cam.position).addScaledVector(this.v0, depth);
      this.dim.quaternion.copy(cam.quaternion);
    }
    // spotlight shaft + floor pool
    this.spotNow += (this.spotTarget - this.spotNow) * (1 - Math.exp(-dt * 10));
    const on = this.spotNow > 0.01;
    this.spot.visible = on; this.spotPool.visible = on;
    if (on) {
      this.spot.position.set(this.spotX, 0, this.spotZ);
      (this.spot.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.55 * this.spotNow;
      this.spotPool.position.set(this.spotX, 0.012, this.spotZ);
      (this.spotPool.material as THREE.MeshBasicMaterial).opacity = 0.7 * this.spotNow;
    }
  }

  /** drop every live particle / decal / flash (FX are time-based: a +100 s jump expires them all) */
  reset(): void {
    this.time += 100;
    this.flash = 0; this.flashHold = 0; this.lines = 0; this.linesHold = 0; this.dimNow = 0; this.dimTarget = 0;
    this.spotNow = 0; this.spotTarget = 0;
    this.update(0, 1);
  }

  /** warm-up helper: make every FX program draw once (spawn invisible-in-time particles) */
  primeForWarmup(): void {
    const at = new THREE.Vector3(0, 1, 0);
    this.add.spawn(this.time, at, this.v1.set(0, 0, 0), 0.01, 0.01, 0.01, 0, 0, COL.white, 0.01, C.GLOW, 0, 0, 0);
    this.alpha.spawn(this.time, at, this.v1, 0.01, 0.01, 0.01, 0, 0, COL.white, 0.01, C.GLOW, 0, 0, 0);
    this.decals.add(this.time, at, this.v1.set(0, 0, 1), 0.001, 0, C.GLOW, COL.white, 0.001, 0.01);
    this.dim.visible = true;
    this.spot.visible = true; this.spotPool.visible = true;
    (this.spot.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.001;
    (this.spotPool.material as THREE.MeshBasicMaterial).opacity = 0.001;
  }

  dispose(): void {
    this.add.dispose(); this.alpha.dispose(); this.decals.dispose();
    this.dim.geometry.dispose(); (this.dim.material as THREE.Material).dispose();
    this.spot.geometry.dispose(); (this.spot.material as THREE.Material).dispose();
    this.spotPool.geometry.dispose(); ((this.spotPool.material as THREE.MeshBasicMaterial).map)?.dispose(); (this.spotPool.material as THREE.Material).dispose();
    this.atlas.dispose();
    this.group.removeFromParent();
  }
}
