// GENESIS — PERF s14 GPU MEMORY AUDIT (owner's M5 round 3: swap grew 8.6 -> 11.8 GB in a session, every pass stalls:
// a working set the unified memory cannot hold). A live, GL-level account of every buffer, texture and renderbuffer
// the page holds (sizes from the allocation calls themselves, so nothing three.js or our code keeps out of sight is
// missed), kept from the moment the context is attached; the perf report prints it (`gpu mem` lines).
// Cost: a Map update per allocation / delete call; nothing per draw.

interface Obj { kind: 'buf' | 'tex2d' | 'tex3d' | 'cube' | 'rb'; bytes: number; desc: string; levels?: Map<string, number> }

/** bytes per texel of a (sized or unsized) internal format; unsized formats by their type */
function bpp(gl: WebGL2RenderingContext, internal: number, format?: number, type?: number): number {
  const G = gl as unknown as Record<string, number>;
  const t: Record<number, number> = {
    [G.R8]: 1, [G.RG8]: 2, [G.RGB8]: 4, [G.RGBA8]: 4, [G.SRGB8_ALPHA8]: 4, [G.R16F]: 2, [G.RG16F]: 4, [G.RGB16F]: 8,
    [G.RGBA16F]: 8, [G.R32F]: 4, [G.RG32F]: 8, [G.RGB32F]: 16, [G.RGBA32F]: 16, [G.R11F_G11F_B10F]: 4, [G.RGB10_A2]: 4,
    [G.DEPTH_COMPONENT16]: 2, [G.DEPTH_COMPONENT24]: 4, [G.DEPTH_COMPONENT32F]: 4, [G.DEPTH24_STENCIL8]: 4,
    [G.DEPTH32F_STENCIL8]: 8, [G.R8UI]: 1, [G.R16UI]: 2, [G.R32UI]: 4, [G.RGBA8UI]: 4, [G.RGBA16UI]: 8, [G.RGBA32UI]: 16,
    [G.R8I]: 1, [G.R16I]: 2, [G.R32I]: 4, [G.RG16F]: 4, [G.RGB565]: 2, [G.RGBA4]: 2, [G.RGB5_A1]: 2,
  };
  if (t[internal] != null) return t[internal];
  // unsized (RGBA / RGB / LUMINANCE ...): channels x type size
  const ch = format === G.RGBA || internal === G.RGBA ? 4 : format === G.RGB || internal === G.RGB ? 4 : format === G.RG ? 2 : 1;
  const ts = type === G.FLOAT ? 4 : type === G.HALF_FLOAT ? 2 : type === G.UNSIGNED_SHORT || type === G.SHORT ? 2 : type === G.UNSIGNED_INT || type === G.INT ? 4 : 1;
  return ch * ts;
}

const fmtName = (gl: WebGL2RenderingContext, v: number): string => {
  for (const k of ['R8', 'RG8', 'RGBA8', 'SRGB8_ALPHA8', 'R16F', 'RG16F', 'RGBA16F', 'R32F', 'RG32F', 'RGBA32F', 'R11F_G11F_B10F', 'DEPTH_COMPONENT24', 'DEPTH_COMPONENT32F', 'DEPTH24_STENCIL8', 'RGBA', 'RGB', 'R32UI', 'RGBA32UI']) {
    if ((gl as unknown as Record<string, number>)[k] === v) return k.toLowerCase();
  }
  return '0x' + v.toString(16);
};

export class GpuMemAudit {
  private readonly live = new Map<object, Obj>();
  private boundBuf = new Map<number, object | null>();
  private boundTex = new Map<string, object | null>();
  private unit = 0;
  private rb: object | null = null;
  private installed: WebGL2RenderingContext | null = null;
  /** peak total over the page's life */
  peak = 0;
  total = 0;

  install(gl: WebGL2RenderingContext): void {
    if (this.installed === gl) return;
    this.installed = gl;
    const self = this;
    const g = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
    const wrap = (name: string, after: (args: unknown[], ret: unknown) => void): void => {
      const orig = g[name];
      if (typeof orig !== 'function') return;
      g[name] = function (this: unknown, ...args: unknown[]) { const r = orig.apply(gl, args); try { after(args, r); } catch { /* never break GL */ } return r; };
    };
    const set = (o: object | null | undefined, kind: Obj['kind'], key: string, bytes: number, desc: string) => {
      if (!o) return;
      let e = self.live.get(o);
      if (!e || e.kind !== kind) { e = { kind, bytes: 0, desc, levels: new Map() }; self.live.set(o, e); }
      const prev = e.levels!.get(key) ?? 0;
      e.levels!.set(key, bytes);
      e.bytes += bytes - prev;
      if (key === '0' || key.startsWith('0:') || kind === 'buf' || kind === 'rb') e.desc = desc;
      self.total += bytes - prev;
      if (self.total > self.peak) self.peak = self.total;
    };
    const texTarget = (t: number): string => (t >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && t <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ? String(gl.TEXTURE_CUBE_MAP) : String(t));
    const boundT = (t: number) => self.boundTex.get(`${self.unit}:${texTarget(t)}`) ?? null;
    wrap('activeTexture', (a) => { self.unit = (a[0] as number) - gl.TEXTURE0; });
    wrap('bindTexture', (a) => { self.boundTex.set(`${self.unit}:${a[0]}`, (a[1] as object) ?? null); });
    wrap('bindBuffer', (a) => { self.boundBuf.set(a[0] as number, (a[1] as object) ?? null); });
    wrap('bindBufferBase', (a) => { self.boundBuf.set(a[0] as number, (a[2] as object) ?? null); });
    wrap('bindRenderbuffer', (a) => { self.rb = (a[1] as object) ?? null; });
    wrap('bufferData', (a) => {
      const s = a[1];
      const bytes = typeof s === 'number' ? s : s && typeof (s as ArrayBufferView).byteLength === 'number' ? (a[4] != null ? Number(a[4]) * ((s as Float32Array).BYTES_PER_ELEMENT ?? 1) : (s as ArrayBufferView).byteLength - (a[3] != null ? Number(a[3]) * ((s as Float32Array).BYTES_PER_ELEMENT ?? 1) : 0)) : 0;
      set(self.boundBuf.get(a[0] as number), 'buf', 'b', bytes, a[0] === gl.ELEMENT_ARRAY_BUFFER ? 'index' : a[0] === gl.UNIFORM_BUFFER ? 'uniform' : 'vertex');
    });
    const tex2d = (target: number, level: number, internal: number, w: number, h: number, format?: number, type?: number) => {
      const cube = texTarget(target) === String(gl.TEXTURE_CUBE_MAP);
      const key = `${level}:${target}`;
      set(boundT(target), cube ? 'cube' : 'tex2d', key, w * h * bpp(gl, internal, format, type), `${w}x${h} ${fmtName(gl, internal)}${cube ? ' cube' : ''}`);
    };
    wrap('texImage2D', (a) => {
      if (a.length >= 8 && typeof a[3] === 'number') tex2d(a[0] as number, a[1] as number, a[2] as number, a[3] as number, a[4] as number, a[6] as number, a[7] as number);
      else if (a.length === 6) { const src = a[5] as { width?: number; height?: number; videoWidth?: number; naturalWidth?: number }; tex2d(a[0] as number, a[1] as number, a[2] as number, src.width ?? 0, src.height ?? 0, a[3] as number, a[4] as number); }
    });
    wrap('texStorage2D', (a) => {
      const [target, levels, internal, w, h] = a as number[];
      for (let l = 0; l < levels; l++) {
        const ww = Math.max(1, w >> l), hh = Math.max(1, h >> l);
        if (target === gl.TEXTURE_CUBE_MAP) for (let f = 0; f < 6; f++) tex2d(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, l, internal, ww, hh);
        else tex2d(target, l, internal, ww, hh);
      }
    });
    const tex3d = (target: number, level: number, internal: number, w: number, h: number, d: number, format?: number, type?: number) =>
      set(boundT(target), 'tex3d', `${level}`, w * h * d * bpp(gl, internal, format, type), `${w}x${h}x${d} ${fmtName(gl, internal)}`);
    wrap('texImage3D', (a) => { tex3d(a[0] as number, a[1] as number, a[2] as number, a[3] as number, a[4] as number, a[5] as number, a[7] as number, a[8] as number); });
    wrap('texStorage3D', (a) => {
      const [target, levels, internal, w, h, d] = a as number[];
      for (let l = 0; l < levels; l++) tex3d(target, l, internal, Math.max(1, w >> l), Math.max(1, h >> l), target === gl.TEXTURE_2D_ARRAY ? d : Math.max(1, d >> l));
    });
    wrap('generateMipmap', (a) => {
      const o = boundT(a[0] as number);
      const e = o ? self.live.get(o) : null;
      if (!e || e.kind === 'tex3d') return;
      const base = e.levels!.get(`0:${a[0]}`) ?? [...e.levels!.entries()].filter(([k]) => k.startsWith('0:')).reduce((s, [, v]) => s + v, 0);
      // the mip chain adds about a third
      set(o, e.kind, 'mips', Math.round(base / 3), e.desc);
    });
    wrap('renderbufferStorage', (a) => { const [, internal, w, h] = a as number[]; set(self.rb, 'rb', 'r', w * h * bpp(gl, internal), `${w}x${h} ${fmtName(gl, internal)}`); });
    wrap('renderbufferStorageMultisample', (a) => { const [, s, internal, w, h] = a as number[]; set(self.rb, 'rb', 'r', w * h * bpp(gl, internal) * Math.max(1, s), `${w}x${h} ${fmtName(gl, internal)} msaa${s}`); });
    const drop = (a: unknown[]) => { const o = a[0] as object; const e = o ? self.live.get(o) : null; if (e) { self.total -= e.bytes; self.live.delete(o); } };
    wrap('deleteBuffer', drop);
    wrap('deleteTexture', drop);
    wrap('deleteRenderbuffer', drop);
  }

  /** the report lines: MB by kind (count), the largest objects, the peak */
  lines(cpuCopiesMB?: number): string[] {
    const by = new Map<string, { b: number; n: number }>();
    for (const e of this.live.values()) { const k = e.kind === 'buf' ? `buffers(${e.desc})` : e.kind; const s = by.get(k) ?? { b: 0, n: 0 }; s.b += e.bytes; s.n++; by.set(k, s); }
    const mb = (b: number) => (Math.round(b / 1048576 * 10) / 10).toString();
    const parts = [...by.entries()].sort((a, b) => b[1].b - a[1].b).map(([k, s]) => `${k} ${mb(s.b)} MB x${s.n}`);
    const big = [...this.live.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map((e) => `${e.kind} ${e.desc} ${mb(e.bytes)}`);
    const L = [`gpu mem (est., live GL allocations): total ${mb(this.total)} MB (peak ${mb(this.peak)}) | ${parts.join(' · ')}${cpuCopiesMB != null ? ` | cpu copies of geometry ${mb(cpuCopiesMB * 1048576)} MB` : ''}`];
    L.push(`gpu mem largest: ${big.join(' · ')}`);
    // buffers by size class (patch pages, instance pools ...): how many of each size
    const sizes = new Map<number, number>();
    for (const e of this.live.values()) if (e.kind === 'buf' && e.bytes >= 65536) sizes.set(e.bytes, (sizes.get(e.bytes) ?? 0) + 1);
    const sz = [...sizes.entries()].sort((a, b) => b[0] * b[1] - a[0] * a[1]).slice(0, 8).map(([b, n]) => `${n}x${mb(b)}MB`);
    if (sz.length) L.push(`gpu mem buffer sizes (count x size, >= 64 kB): ${sz.join(' · ')}`);
    return L;
  }
}

export const gpuMem = new GpuMemAudit();
