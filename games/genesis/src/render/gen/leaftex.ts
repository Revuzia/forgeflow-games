// GENESIS — a procedurally painted leaf-cluster texture (no image assets): a few dozen pointed, veined leaves of
// varied green on a transparent card, denser toward the middle. Tree crowns use it on alpha-tested cards around their
// leaf clusters so silhouettes are leafy instead of faceted. Painted once on a 2D canvas, deterministic (seeded).

import { CanvasTexture, LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../../sim/core/rng.ts';

let cached: Texture | null = null;

export function leafClusterTexture(size = 256): Texture | null {
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const rng = new Rng(4242);
  g.clearRect(0, 0, size, size);
  const leaves = 70;
  for (let i = 0; i < leaves; i++) {
    // denser toward the centre, falling off to the card's rim
    const r = Math.sqrt(rng.float()) * size * 0.42;
    const a = rng.float() * Math.PI * 2;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    const len = size * (0.07 + rng.float() * 0.05);
    const wid = len * (0.38 + rng.float() * 0.14);
    const rot = a + (rng.float() - 0.5) * 1.6;
    const shade = 0.55 + rng.float() * 0.6;
    const hue = 0.85 + rng.float() * 0.3;
    // inner leaves darker (self-shadowing inside the cluster)
    const depth = 1 - (r / (size * 0.42)) * 0.45;
    const k = shade * (1.05 - depth * 0.35);
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    const grad = g.createLinearGradient(-len, 0, len, 0);
    const base = [Math.round(70 * k * hue), Math.round(118 * k), Math.round(44 * k * (2 - hue))];
    grad.addColorStop(0, `rgb(${Math.round(base[0] * 0.75)},${Math.round(base[1] * 0.75)},${Math.round(base[2] * 0.75)})`);
    grad.addColorStop(1, `rgb(${base[0]},${base[1]},${base[2]})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-len, 0);
    g.quadraticCurveTo(-len * 0.2, -wid, len, 0);
    g.quadraticCurveTo(-len * 0.2, wid, -len, 0);
    g.closePath();
    g.fill();
    // midrib
    g.strokeStyle = `rgba(${Math.round(base[0] * 1.25)},${Math.round(base[1] * 1.2)},${Math.round(base[2] * 1.1)},0.6)`;
    g.lineWidth = Math.max(1, size / 256);
    g.beginPath();
    g.moveTo(-len * 0.95, 0);
    g.lineTo(len * 0.9, 0);
    g.stroke();
    g.restore();
  }
  // a few twigs
  g.strokeStyle = 'rgba(52,38,26,0.9)';
  g.lineWidth = Math.max(1.5, size / 170);
  for (let i = 0; i < 6; i++) {
    const a = rng.float() * Math.PI * 2;
    g.beginPath();
    g.moveTo(size / 2, size / 2);
    g.lineTo(size / 2 + Math.cos(a) * size * 0.3, size / 2 + Math.sin(a) * size * 0.3);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  cached = t;
  return t;
}
