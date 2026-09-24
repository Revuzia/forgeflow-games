// DYEFIELD — GPU mirror of the paint atlas (CONTRACT §5.0 / §5.1, DESIGN §4). LOOK lane.
//
// The CPU atlas (core/paint/atlas.ts → PaintAtlas.team) is the single source of truth. This
// module mirrors it into one RGBA8 DataTexture of the same S×S size, sampled by the dye layer
// (view/surfaces.ts) at the mesh's `uv1` (glTF TEXCOORD_1):
//
//   R = 255 when the texel's source surface is SUNCREW (team 1), else 0
//   G = 255 when it is GULF CREW (team 2), else 0
//   B = atlas.noise[src]        (stable per-texel hash → organic dye edges in the shader)
//   A = 255 on surface AND gutter texels (atlas.srcOf ≥ 0), 0 elsewhere
//
// Gutter texels (srcOf ≠ self) copy their nearest surface texel, so bilinear sampling at an
// island border never bleeds unpainted/foreign colour in. The texture is data, not colour:
// NoColorSpace, LinearFilter, no mipmaps, flipY = false (CONTRACT §2: data row r is sampled at
// v = (r + 0.5) / S).
//
// Upload strategy (three r186, verified in node_modules/three/src/renderers/webgl/WebGLTextures.js
// `updateTexture`): `updateRanges` are in ARRAY ELEMENTS with componentStride 4 (RGBA only), so a
// span (row, x0..x1) is { start: (row·S + x0)·4, count: (x1 − x0 + 1)·4 }. Ranges in the same row
// are merged, each surviving range becomes one texSubImage2D(x, y, width, 1) via
// UNPACK_ROW_LENGTH / SKIP_PIXELS / SKIP_ROWS, then the list is cleared. With an EMPTY list the
// whole image is uploaded. On the very first upload three allocates storage (texStorage2D) and
// then calls the same updateTexture(), so any ranges queued before that first upload would leave
// the rest of the freshly allocated texture undefined. `fullPending` guards that: until
// `texture.onUpdate` reports a completed upload after a full rebuild, spans only update the CPU
// buffer and no ranges are queued, so the pending upload is a whole-image one.

import * as THREE from 'three';
import type { PaintAtlas } from '../core/paint/atlas.ts';
import type { Painter } from '../core/paint/painter.ts';

export class PaintTexture {
  readonly texture: THREE.DataTexture;
  readonly size: number;

  private readonly atlas: PaintAtlas;
  private readonly data: Uint8Array;
  /** true from a full rebuild until three has uploaded the whole image once */
  private fullPending = true;
  /** per-row stamp so upload() can count distinct rows without allocating */
  private readonly rowStamp: Uint32Array;
  private stamp = 0;

  constructor(atlas: PaintAtlas) {
    const S = atlas.size | 0;
    if (!(S > 0) || atlas.srcOf.length !== S * S) {
      throw new Error(`PaintTexture: atlas size ${atlas.size} does not match srcOf length ${atlas.srcOf.length}`);
    }
    this.atlas = atlas;
    this.size = S;
    this.data = new Uint8Array(S * S * 4);
    this.rowStamp = new Uint32Array(S);

    const tex = new THREE.DataTexture(this.data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = 'df_paint_atlas';
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.premultiplyAlpha = false;
    tex.unpackAlignment = 4;
    tex.anisotropy = 1;
    tex.colorSpace = THREE.NoColorSpace;
    // three calls onUpdate right after every GPU upload of this texture
    tex.onUpdate = () => { this.fullPending = false; };
    this.texture = tex;

    this.rebuildAll();
  }

  /** Full RGBA rebuild from atlas.team (first frame / after Painter.reset()). Queues ONE whole-image upload. */
  rebuildAll(): void {
    const n = this.size * this.size;
    for (let lin = 0; lin < n; lin++) this.writeTexel(lin);
    this.texture.clearUpdateRanges();
    this.fullPending = true;
    this.texture.needsUpdate = true;
  }

  /**
   * Drain painter.takeDirty() into the CPU buffer + per-row update ranges (no whole-atlas
   * re-upload after the first frame). Returns the number of distinct rows touched.
   */
  upload(painter: Painter): number {
    const S = this.size;
    const tex = this.texture;
    let rows = 0;
    let spans = 0;
    const stamp = this.nextStamp();
    const queueRanges = !this.fullPending;

    painter.takeDirty((row: number, x0: number, x1: number) => {
      row |= 0;
      if (row < 0 || row >= S) return;
      let a = x0 | 0, b = x1 | 0;
      if (a > b) { const t = a; a = b; b = t; }
      if (a < 0) a = 0;
      if (b > S - 1) b = S - 1;
      if (b < a) return;
      const base = row * S;
      for (let x = a; x <= b; x++) this.writeTexel(base + x);
      if (queueRanges) tex.addUpdateRange((base + a) * 4, (b - a + 1) * 4);
      if (this.rowStamp[row] !== stamp) { this.rowStamp[row] = stamp; rows++; }
      spans++;
    });

    if (spans > 0) tex.needsUpdate = true;
    return rows;
  }

  /** Release the GPU texture. */
  dispose(): void {
    this.texture.dispose();
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────

  private writeTexel(lin: number): void {
    const o = lin * 4;
    const d = this.data;
    const src = this.atlas.srcOf[lin];
    if (src < 0) {
      d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0;
      return;
    }
    const t = this.atlas.team[src];
    d[o] = t === 1 ? 255 : 0;
    d[o + 1] = t === 2 ? 255 : 0;
    d[o + 2] = this.atlas.noise[src];
    d[o + 3] = 255;
  }

  private nextStamp(): number {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) { this.rowStamp.fill(0); this.stamp = 1; }
    return this.stamp;
  }
}
