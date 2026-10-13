// VALE render — procedural VFX textures (CONTRACT §9.5: spark, glow, smoke, shard, ring, streak,
// petal, ember, drop, rune, crack, dust, mote). One 4 × 4 atlas of 128 px cells, drawn once with
// Canvas 2D from a fixed seed (deterministic), white RGB with the shape in alpha; every layer tints it.
//
// Bible notes: Lumen = additive light + glass shards; Shade = ink with a light rim; impacts throw
// OPAQUE chips (shard is hard-edged); no glowing runes — `rune` is a carved hour-tick dial mark.

import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

export const VFX_TEXTURES = ['spark', 'glow', 'smoke', 'shard', 'ring', 'streak', 'petal', 'ember', 'drop', 'rune', 'crack', 'dust', 'mote'] as const;
export type VfxTextureName = (typeof VFX_TEXTURES)[number];
export const ATLAS_GRID = 4;
const CELL = 128;

export function textureIndex(name: unknown): number {
  const i = VFX_TEXTURES.indexOf(name as VfxTextureName);
  return i < 0 ? 1 : i; // unknown → glow
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildVfxAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CELL * ATLAS_GRID;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, canvas.width, canvas.height);
  const r = rng(0x5a1e);
  const cell = (i: number, draw: (cx: number, cy: number, s: number) => void): void => {
    const x = (i % ATLAS_GRID) * CELL, y = Math.floor(i / ATLAS_GRID) * CELL;
    c.save();
    c.beginPath(); c.rect(x, y, CELL, CELL); c.clip();
    draw(x + CELL / 2, y + CELL / 2, CELL / 2 - 4);
    c.restore();
  };
  const radial = (cx: number, cy: number, rad: number, stops: [number, number][]): CanvasGradient => {
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, rad);
    for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
    return g;
  };

  // 0 spark: a bright needle (velocity-stretched by the shader)
  cell(0, (cx, cy, s) => {
    c.fillStyle = radial(cx, cy, s, [[0, 1], [0.15, 0.9], [0.4, 0.25], [1, 0]]);
    c.beginPath(); c.moveTo(cx - s, cy); c.quadraticCurveTo(cx, cy - s * 0.16, cx + s, cy); c.quadraticCurveTo(cx, cy + s * 0.16, cx - s, cy); c.fill();
    c.fillStyle = radial(cx, cy, s * 0.3, [[0, 1], [1, 0]]); c.fillRect(cx - s, cy - s, 2 * s, 2 * s);
  });
  // 1 glow: soft gaussian
  cell(1, (cx, cy, s) => { c.fillStyle = radial(cx, cy, s, [[0, 1], [0.2, 0.62], [0.5, 0.18], [1, 0]]); c.fillRect(cx - s, cy - s, 2 * s, 2 * s); });
  // 2 smoke: lumpy soft blob
  cell(2, (cx, cy, s) => {
    for (let k = 0; k < 14; k++) {
      const a = r() * Math.PI * 2, d = r() * s * 0.42, rr = s * (0.28 + r() * 0.3);
      c.fillStyle = radial(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, [[0, 0.22], [0.6, 0.1], [1, 0]]);
      c.fillRect(cx - s, cy - s, 2 * s, 2 * s);
    }
  });
  // 3 shard: hard-edged faceted chip (opaque)
  cell(3, (cx, cy, s) => {
    const pts = [[0.0, -0.95], [0.42, -0.2], [0.3, 0.7], [-0.12, 0.95], [-0.45, 0.15], [-0.3, -0.5]];
    c.fillStyle = 'rgba(255,255,255,1)';
    c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(cx + px * s, cy + py * s) : c.moveTo(cx + px * s, cy + py * s))); c.closePath(); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath(); c.moveTo(cx, cy - 0.95 * s); c.lineTo(cx + 0.42 * s, cy - 0.2 * s); c.lineTo(cx + 0.3 * s, cy + 0.7 * s); c.lineTo(cx, cy + 0.1 * s); c.closePath();
    c.globalCompositeOperation = 'source-atop'; c.fill(); c.globalCompositeOperation = 'source-over';
  });
  // 4 ring: thin crisp ring
  cell(4, (cx, cy, s) => {
    c.strokeStyle = 'rgba(255,255,255,1)'; c.lineWidth = s * 0.12;
    c.beginPath(); c.arc(cx, cy, s * 0.82, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = s * 0.28;
    c.beginPath(); c.arc(cx, cy, s * 0.82, 0, Math.PI * 2); c.stroke();
  });
  // 5 streak: soft horizontal line tapering both ends
  cell(5, (cx, cy, s) => {
    const g = c.createLinearGradient(cx - s, cy, cx + s, cy);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,0.8)'); g.addColorStop(0.75, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(cx, cy, s, s * 0.22, 0, 0, Math.PI * 2); c.fill();
  });
  // 6 petal: sun-petal (pointed leaf)
  cell(6, (cx, cy, s) => {
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath(); c.moveTo(cx, cy - s * 0.95); c.bezierCurveTo(cx + s * 0.55, cy - s * 0.4, cx + s * 0.45, cy + s * 0.55, cx, cy + s * 0.9);
    c.bezierCurveTo(cx - s * 0.45, cy + s * 0.55, cx - s * 0.55, cy - s * 0.4, cx, cy - s * 0.95); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 3; c.beginPath(); c.moveTo(cx, cy - s * 0.8); c.lineTo(cx, cy + s * 0.75); c.stroke();
  });
  // 7 ember: hot core, flickering edge
  cell(7, (cx, cy, s) => {
    c.fillStyle = radial(cx, cy, s * 0.7, [[0, 1], [0.3, 0.85], [0.7, 0.2], [1, 0]]);
    c.beginPath();
    for (let k = 0; k <= 16; k++) { const a = (k / 16) * Math.PI * 2, rr = s * (0.45 + r() * 0.25); k ? c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : c.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    c.fill();
  });
  // 8 drop: teardrop
  cell(8, (cx, cy, s) => {
    c.fillStyle = radial(cx, cy + s * 0.3, s * 0.7, [[0, 1], [0.7, 0.85], [1, 0.6]]);
    c.beginPath(); c.moveTo(cx, cy - s * 0.9); c.bezierCurveTo(cx + s * 0.15, cy - s * 0.4, cx + s * 0.55, cy + s * 0.05, cx + s * 0.5, cy + s * 0.4);
    c.arc(cx, cy + s * 0.4, s * 0.5, 0, Math.PI); c.bezierCurveTo(cx - s * 0.55, cy + s * 0.05, cx - s * 0.15, cy - s * 0.4, cx, cy - s * 0.9); c.fill();
  });
  // 9 rune → carved hour-tick dial (the Vale tells time; no glowing glyphs)
  cell(9, (cx, cy, s) => {
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = s * 0.06;
    c.beginPath(); c.arc(cx, cy, s * 0.86, 0, Math.PI * 2); c.stroke();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, l = k % 3 === 0 ? 0.3 : 0.16;
      c.lineWidth = k % 3 === 0 ? s * 0.08 : s * 0.05;
      c.beginPath(); c.moveTo(cx + Math.sin(a) * s * 0.84, cy - Math.cos(a) * s * 0.84); c.lineTo(cx + Math.sin(a) * s * (0.84 - l), cy - Math.cos(a) * s * (0.84 - l)); c.stroke();
    }
  });
  // 10 crack: branching fracture lines from the centre
  cell(10, (cx, cy, s) => {
    c.strokeStyle = 'rgba(255,255,255,1)'; c.lineCap = 'round';
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
      let px = x, py = y;
      const steps = 5;
      c.lineWidth = w;
      c.beginPath(); c.moveTo(px, py);
      for (let k = 0; k < steps; k++) { a += (r() - 0.5) * 0.7; px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps; c.lineTo(px, py); }
      c.stroke();
      if (depth > 0) { branch(px, py, a + 0.6, len * 0.55, w * 0.6, depth - 1); branch(px, py, a - 0.5, len * 0.5, w * 0.6, depth - 1); }
    };
    for (let k = 0; k < 7; k++) branch(cx, cy, (k / 7) * Math.PI * 2 + r() * 0.5, s * (0.45 + r() * 0.2), 4.5, 2);
    c.fillStyle = radial(cx, cy, s * 0.3, [[0, 0.9], [1, 0]]); c.fillRect(cx - s, cy - s, 2 * s, 2 * s);
  });
  // 11 dust: soft irregular low-alpha puff
  cell(11, (cx, cy, s) => {
    for (let k = 0; k < 9; k++) {
      const a = r() * Math.PI * 2, d = r() * s * 0.35, rr = s * (0.3 + r() * 0.35);
      c.fillStyle = radial(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, [[0, 0.3], [1, 0]]);
      c.fillRect(cx - s, cy - s, 2 * s, 2 * s);
    }
  });
  // 12 mote: tiny bright dot with a soft halo
  cell(12, (cx, cy, s) => {
    c.fillStyle = radial(cx, cy, s * 0.6, [[0, 1], [0.18, 1], [0.35, 0.35], [1, 0]]);
    c.fillRect(cx - s, cy - s, 2 * s, 2 * s);
  });

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
