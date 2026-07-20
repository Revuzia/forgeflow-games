/**
 * CHROMA HIDE — runtime/sim/paint_buffer.js
 * PURE brush-stamping math over a raw RGBA byte buffer. No three, no canvas, no
 * DOM — so the paint pipeline is deterministic and node-testable (the M1 gate:
 * "replay a stroke list -> reproduce a texture hash"). The browser PaintSystem
 * wraps three of these (albedo / metalness / roughness) and blits each into a
 * CanvasTexture; node replays strokes into one and hashes it.
 *
 * UV convention: stamp takes (u,v) in [0,1] from a raycast hit. Texture space is
 * top-left origin with a Y flip to match a CanvasTexture's default flipY=true, so
 * px = u*size, py = (1-v)*size.
 */

export class PaintBuffer {
  constructor(size, fill) {
    this.size = size | 0;
    this.data = new Uint8ClampedArray(this.size * this.size * 4);
    this.fillAll(fill || { r: 255, g: 255, b: 255 });
  }

  fillAll(c) {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
    }
  }

  /**
   * Stamp a soft radial brush. u,v in [0,1]; radiusPx in pixels; color {r,g,b};
   * hardness 0..1 (fraction of the radius at full opacity before falloff).
   * Returns the dirty rect {x,y,w,h} (clamped) so the caller can do a partial
   * canvas putImageData. Alpha-composites onto whatever is there.
   */
  stamp(u, v, radiusPx, color, hardness = 0.5, flow = 1) {
    const size = this.size;
    const cx = u * size;
    const cy = (1 - v) * size;
    const r = Math.max(0.5, radiusPx);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(size - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(size - 1, Math.ceil(cy + r));
    if (x1 < x0 || y1 < y0) return { x: 0, y: 0, w: 0, h: 0 };

    const core = r * Math.min(0.999, hardness);
    const d = this.data;
    const cr = color.r, cg = color.g, cb = color.b;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;
        // full opacity within `core`, linear falloff to 0 at r
        let a = dist <= core ? 1 : 1 - (dist - core) / (r - core || 1);
        a *= flow;
        if (a <= 0) continue;
        const i = (y * size + x) * 4;
        const ia = 1 - a;
        d[i] = cr * a + d[i] * ia;
        d[i + 1] = cg * a + d[i + 1] * ia;
        d[i + 2] = cb * a + d[i + 2] * ia;
        d[i + 3] = 255;
      }
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** FNV-1a over the whole buffer — a stable content fingerprint. */
  hash() {
    let h = 0x811c9dc5;
    const d = this.data;
    for (let i = 0; i < d.length; i++) {
      h ^= d[i];
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
}

/**
 * A stroke record is the network + replay unit:
 *   { u, v, size, r, g, b, metal, rough }  (metal/rough 0..1)
 * Replays a stroke list into three buffers (albedo/metal/rough). Deterministic:
 * same list -> same hashes. Used by the selftest and by chromanet late-join.
 */
export function replayStrokes(strokes, albedo, metal, rough, hardness = 0.5) {
  for (const s of strokes) {
    albedo.stamp(s.u, s.v, s.size, { r: s.r, g: s.g, b: s.b }, hardness);
    const mv = Math.round((s.metal ?? 0) * 255);
    const rv = Math.round((s.rough ?? 0.8) * 255);
    metal.stamp(s.u, s.v, s.size, { r: mv, g: mv, b: mv }, hardness);
    rough.stamp(s.u, s.v, s.size, { r: rv, g: rv, b: rv }, hardness);
  }
  return { albedo: albedo.hash(), metal: metal.hash(), rough: rough.hash() };
}

/** Default fills for the three maps (blank white body, non-metal, semi-rough). */
export const PAINT_FILLS = Object.freeze({
  albedo: { r: 255, g: 255, b: 255 },
  metal: { r: 0, g: 0, b: 0 },       // metalness 0
  rough: { r: 204, g: 204, b: 204 }, // roughness ~0.8
});
