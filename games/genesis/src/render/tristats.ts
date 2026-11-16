// GENESIS — PERF s19: triangles drawn per frame BY LAYER and PASS (scene / shadow), and per pixel / shadow texel.
// The perf report prints the means over the recording (perfreport.ts). Why: rounds 2-5 on the owner's Mac drew
// 22-40 M triangles a frame onto 1.6 MP; a fragment shader runs once per triangle per 2x2 quad it touches (and with
// MSAA once per triangle touching any sample of a pixel), so triangles per pixel is the multiplier of every shader.
// Counting: WebGLRenderer.renderBufferDirect is wrapped once; the triangles three's own counter gains in a draw go to
// the layer of the drawn object (the nearest ancestor with a known name) under the current pass.
import type { Object3D, WebGLRenderer } from 'three';

const LAYERS: [RegExp, string][] = [[/^terrain/, 'terrain'], [/^water/, 'water'], [/^vegetation-near/, 'trees'], [/^vegetation-far/, 'fartrees'],
  [/^groundcover/, 'cover'], [/^buildings/, 'buildings'], [/^crowds/, 'people'], [/^animals/, 'animals'], [/^roads/, 'roads'], [/^life/, 'life']];
const cache = new WeakMap<Object3D, string>();
function layerOf(o: Object3D): string {
  let l = cache.get(o);
  if (l) return l;
  l = 'other';
  for (let p: Object3D | null = o; p && l === 'other'; p = p.parent) for (const [re, name] of LAYERS) if (re.test(p.name)) { l = name; break; }
  cache.set(o, l);
  return l;
}

class TriStats {
  pass: 'scene' | 'shadow' | 'none' = 'none';
  /** this frame so far / the last whole frame: 'scene:terrain' -> triangles */
  private cur = new Map<string, number>();
  last = new Map<string, number>();
  private sum = new Map<string, number>();
  private frames = 0;
  pixels = 1; shadowTexels = 1;
  install(r: WebGLRenderer): void {
    (globalThis as { __GENESIS_TRI__?: unknown }).__GENESIS_TRI__ = this;
    const orig = r.renderBufferDirect.bind(r);
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      const t0 = r.info.render.triangles;
      orig(camera, scene, geometry, material, object, group);
      const d = r.info.render.triangles - t0;
      if (d > 0 && this.pass !== 'none') { const k = `${this.pass}:${layerOf(object)}`; this.cur.set(k, (this.cur.get(k) ?? 0) + d); }
    };
  }
  endFrame(pixels: number, shadowTexels: number): void {
    this.pixels = Math.max(1, pixels); this.shadowTexels = Math.max(1, shadowTexels);
    for (const [k, v] of this.cur) this.sum.set(k, (this.sum.get(k) ?? 0) + v);
    this.frames++;
    this.last = this.cur; this.cur = new Map();
    this.pass = 'none';
  }
  reset(): void { this.sum.clear(); this.frames = 0; }
  /** two report lines: per pass, each layer's mean triangles (M) and triangles per pixel / per shadow texel */
  lines(): string[] {
    const n = Math.max(1, this.frames), out: string[] = [];
    for (const [pass, area, unit] of [['scene', this.pixels, 'px'], ['shadow', this.shadowTexels, 'shadow texel']] as const) {
      const rows = [...this.sum].filter(([k]) => k.startsWith(`${pass}:`)).map(([k, v]) => [k.slice(pass.length + 1), v / n] as const).sort((a, b) => b[1] - a[1]);
      const tot = rows.reduce((a, r) => a + r[1], 0);
      out.push(`tris by layer, ${pass} (${(tot / 1e6).toFixed(2)}M = ${(tot / area).toFixed(2)} per ${unit}): ${rows.map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)}M (${(v / area).toFixed(2)})`).join(' · ') || 'none'}`);
    }
    return out;
  }
}
export const triStats = new TriStats();
