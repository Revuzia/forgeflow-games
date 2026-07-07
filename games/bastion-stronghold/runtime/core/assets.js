// Minimal canvas-texture helpers (this game loads no external models).
import * as THREE from 'three';

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function spriteTexture(color = '#ffffff', inner = 0.0, size = 64) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, inner * w / 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.4, color + 'cc');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}
