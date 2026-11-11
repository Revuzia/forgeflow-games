// PERF F2 / F2b — the city-lights cube uploads only the tiles a rebuild really changed (src/render/planet/citylights.ts):
// a mock GL keeps a GPU copy of every face from the texSubImage2D calls; after each rebuild it must equal the CPU faces
// byte for byte (nothing changed was missed), and a rebuild that changes one house's light uploads a few tiles only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { CityLights, setCityLightsRenderer } from '../src/render/planet/citylights.ts';
import { BuildingFlag } from '../src/sim/types.ts';
import { buildingAt } from '../src/render/life/catalog.ts';

test('city lights: incremental tile uploads keep the GPU copy identical', () => {
  const grid = getGrid(32);
  const R = 3000;
  const cl = new CityLights(R);
  const s = cl.size;
  const gpu = Array.from({ length: 6 }, () => new Uint8Array(s * s * 4));
  let uploaded = 0;
  let rowLen = 0;
  const gl = {
    TEXTURE_CUBE_MAP: 1, TEXTURE_CUBE_MAP_POSITIVE_X: 100, RGBA: 0, UNSIGNED_BYTE: 0, UNPACK_FLIP_Y_WEBGL: 1, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 2,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 3, NONE: 0, UNPACK_ALIGNMENT: 4, UNPACK_ROW_LENGTH: 5,
    pixelStorei(k: number, v: number) { if (k === 5) rowLen = v; },
    texSubImage2D(target: number, _l: number, x: number, y: number, w: number, h: number, _f: number, _t: number, d: Uint8Array, off: number) {
      const f = target - 100, rl = rowLen || w;
      for (let j = 0; j < h; j++) for (let i = 0; i < w * 4; i++) gpu[f][((y + j) * s + x) * 4 + i] = d[off + j * rl * 4 + i];
      uploaded += w * h * 4;
    },
    generateMipmap() {},
  };
  const props = { __webglTexture: {}, __version: -1 };
  setCityLightsRenderer({ properties: { get: () => props }, getContext: () => gl, state: { bindTexture() {} } } as never);
  const n = 40;
  let type = 0;
  while (['wall', 'gate', 'pen', 'dock', 'tower'].includes(buildingAt(type).kind)) type++;
  const B = {
    count: n, type: new Uint16Array(n).fill(Math.max(0, type)), pos: new Float32Array(n * 3), scale: new Float32Array(n).fill(1),
    progress: new Float32Array(n).fill(1), flags: new Uint16Array(n).fill(BuildingFlag.lit), light: new Uint16Array(n).fill(256 + 200),
    settlement: new Int32Array(n), id: new Int32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const a = i * 2.4, z = -1 + (2 * i + 1) / n, r = Math.sqrt(1 - z * z);
    B.pos.set([Math.cos(a) * r * R, z * R, Math.sin(a) * r * R], i * 3);
  }
  const pv = { grid, params: { radius: R }, buildings: B, settlements: [{ id: 0, nightLight: 1 }], fields: new Map(), fieldVersion: new Map() };
  const faces = (cl as unknown as { faces: { image: { data: Uint8Array } }[] }).faces;
  // first build: three's own upload (needsUpdate); the mock GPU takes the whole faces
  cl.update(pv as never, null, 1);
  for (let f = 0; f < 6; f++) gpu[f].set(faces[f].image.data);
  props.__version = cl.texture.version;
  for (let round = 0; round < 4; round++) {
    uploaded = 0;
    B.light[round * 7] = round % 2 ? 256 + 30 : 4 * 256 + 255;
    (cl as unknown as { builtAt: number }).builtAt = -1e9;
    assert.ok(cl.update(pv as never, null, 2 + round));
    for (let f = 0; f < 6; f++) assert.ok(Buffer.compare(Buffer.from(gpu[f]), Buffer.from(faces[f].image.data)) === 0, `round ${round}: face ${f} differs on the GPU`);
    assert.ok(uploaded > 0 && uploaded <= 6 * 32 * 32 * 4 * 4, `round ${round}: one house's change uploaded ${uploaded} bytes`);
  }
  setCityLightsRenderer(null);
});
