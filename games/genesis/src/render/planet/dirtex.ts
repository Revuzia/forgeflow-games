// GENESIS — per-cell fields resampled into a cube texture indexed by BODY-FRAME DIRECTION.
//
// Fragment shaders that march through space (clouds) or look up a field away from the terrain mesh (cloud shadows on
// the ground) cannot ask "which three cells contain this direction?" cheaply. The mapping texel → (3 cells, weights)
// is static for a grid, so it is located once on the CPU (IcoGrid.locate, exact) and every field update is just a
// weighted gather per texel. Four channels (RGBA8, 0..1 each) per cube.

import { CubeTexture, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, ClampToEdgeWrapping } from 'three';
import type { IcoGrid } from '../../sim/grid/icogrid.ts';
import { newHit } from '../../sim/grid/icogrid.ts';

export class DirFieldCube {
  readonly size: number;
  readonly texture: CubeTexture;
  private faces: DataTexture[] = [];
  private cells: Int32Array;
  private weights: Float32Array;

  constructor(grid: IcoGrid, size = 96) {
    this.size = size;
    const n = size * size * 6;
    this.cells = new Int32Array(n * 3);
    this.weights = new Float32Array(n * 3);
    const hit = newHit();
    let k = 0;
    for (let face = 0; face < 6; face++) {
      const data = new Uint8Array(size * size * 4);
      const dt = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
      this.faces.push(dt);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const sc = (2 * (x + 0.5)) / size - 1;
          const tc = (2 * (y + 0.5)) / size - 1;
          // GL cube-map face orientation (texel row 0 is tc = -1)
          let dx: number, dy: number, dz: number;
          switch (face) {
            case 0: dx = 1; dy = -tc; dz = -sc; break;
            case 1: dx = -1; dy = -tc; dz = sc; break;
            case 2: dx = sc; dy = 1; dz = tc; break;
            case 3: dx = sc; dy = -1; dz = -tc; break;
            case 4: dx = sc; dy = -tc; dz = 1; break;
            default: dx = -sc; dy = -tc; dz = -1; break;
          }
          const l = Math.hypot(dx, dy, dz);
          grid.locate(dx / l, dy / l, dz / l, hit);
          this.cells[k * 3] = hit.a; this.cells[k * 3 + 1] = hit.b; this.cells[k * 3 + 2] = hit.c;
          this.weights[k * 3] = hit.wa; this.weights[k * 3 + 1] = hit.wb; this.weights[k * 3 + 2] = hit.wc;
          k++;
        }
      }
    }
    this.texture = new CubeTexture(this.faces as unknown as HTMLImageElement[]);
    this.texture.format = RGBAFormat;
    this.texture.type = UnsignedByteType;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
  }

  /**
   * Resample up to four fields into the RGBA channels. Each channel maps value v to clamp(v * scale + bias, 0, 1).
   * A null field leaves the channel at `fallback`.
   */
  update(fields: (ArrayLike<number> | null)[], scale: number[] = [1, 1, 1, 1], bias: number[] = [0, 0, 0, 0], fallback: number[] = [0, 0, 0, 0]): void {
    const per = this.size * this.size;
    const cells = this.cells, w = this.weights;
    for (let face = 0; face < 6; face++) {
      const data = this.faces[face].image.data as Uint8Array;
      for (let i = 0; i < per; i++) {
        const k = face * per + i;
        const a = cells[k * 3], b = cells[k * 3 + 1], c = cells[k * 3 + 2];
        const wa = w[k * 3], wb = w[k * 3 + 1], wc = w[k * 3 + 2];
        for (let ch = 0; ch < 4; ch++) {
          const f = fields[ch];
          let v: number;
          if (f) v = (f[a] * wa + f[b] * wb + f[c] * wc) * scale[ch] + bias[ch];
          else v = fallback[ch];
          data[i * 4 + ch] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
        }
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
