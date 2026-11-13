// GENESIS — PERF s14 GPU MEMORY AUDIT (owner's M5 round 3: swap grew 8.6 -> 11.8 GB in a session, every pass stalls:
// a working set the unified memory cannot hold). A live, GL-level account of every buffer, texture and renderbuffer
// the page holds (sizes from the allocation calls themselves, so nothing three.js or our code keeps out of sight is
// missed), kept from the moment the context is attached; the perf report prints it (`gpu mem` lines).
// Cost: a Map update per allocation / delete call; nothing per draw.

interface Obj {
  kind: 'buf' | 'tex2d' | 'tex3d' | 'cube' | 'rb'; bytes: number; desc: string; levels?: Map<string, number>;
  /** (PERF s15 ownership) a buffer's source array (its owner: the scene walk's), a texture's / target's three object */
  src?: WeakRef<object>;
  /** (PERF s15 ANGLE transients) the frame a whole-buffer copy was last counted, and the bytes copied in all */
  copyFrame?: number; copied?: number;
}

/** frames a buffer counts as still read by the GPU after a draw (ANGLE-Metal: the GPU runs ~2-3 frames behind) */
const IN_USE_FRAMES = 3;
/** ANGLE-Metal's BufferManager waits for the whole GPU queue every this many bytes of fresh buffer allocations */
const ANGLE_GC_BYTES = 64 * 1048576;
/** frames the transient means are taken over */
const WINDOW = 120;
const mkRef = (o: object | null | undefined): WeakRef<object> | undefined => (o && typeof WeakRef !== 'undefined' ? new WeakRef(o) : undefined);

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
  /** (total, time) when installed: growth per minute over the page's life */
  private t0 = 0;
  private total0 = 0;
  /** retained CPU copies by owner (bytes), set by the renderer (scene walk at report time) */
  cpuProbe: (() => Map<string, number>) | null = null;
  /**
   * (PERF s15) who owns what, set by the renderer (scene walk at report time): typed arrays' ArrayBuffers and three
   * textures -> owner name ('planet-0/vegetation' ...)
   */
  ownerProbe: (() => Map<object, string>) | null = null;
  /** the three texture / render target whose GL storage is being allocated (three's properties.get, see attach) */
  private lastTex: object | null = null;
  private lastRT: object | null = null;
  // ── ANGLE-Metal transients (always on): which buffers the GPU may still read, and what sub-updates cost ──
  frame = 0;
  private vao: object | null = null;
  private vaoFrame = new Map<object, number>();
  private bufVaos = new Map<object, Set<object>>();
  private vaoBufs = new Map<object, Set<object>>();
  /** (PERF s16) each vertex array's CURRENT buffer per attribute slot (-1 = its index buffer): a slot re-pointed to
   * another buffer (a ring of instance buffers, BufferAttribute swaps) no longer makes the old buffer 'in use' through
   * the vertex array's later draws; the old buffer keeps the frame it was last drawn through it (bufFrame) */
  private vaoSlots = new Map<object, Map<number, object>>();
  private bufFrame = new Map<object, number>();
  /** this frame: bufferSubData calls / data bytes, whole-buffer copies (n / bytes), bufferData bytes, texSubImage bytes */
  private cur = { subN: 0, subB: 0, copyN: 0, copyB: 0, dataB: 0, texB: 0 };
  private hist: { subN: number; subB: number; copyN: number; copyB: number; dataB: number; texB: number }[] = [];
  /** fresh Metal buffer bytes (copies + bufferData) since install: every ANGLE_GC_BYTES of them one full GPU wait */
  freshTotal = 0;

  install(gl: WebGL2RenderingContext): void {
    if (this.installed === gl) return;
    this.installed = gl;
    this.t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.total0 = this.total;
    try { (globalThis as { __GENESIS_GPUMEM__?: GpuMemAudit }).__GENESIS_GPUMEM__ = this; } catch { /* none */ }
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
      if (kind === 'rb') { if (self.lastRT) e.src = mkRef(self.lastRT); }
      else if (kind !== 'buf' && self.lastTex) e.src = mkRef(self.lastTex);
      self.total += bytes - prev;
      if (self.total > self.peak) self.peak = self.total;
    };
    const texTarget = (t: number): string => (t >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && t <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ? String(gl.TEXTURE_CUBE_MAP) : String(t));
    const boundT = (t: number) => self.boundTex.get(`${self.unit}:${texTarget(t)}`) ?? null;
    wrap('activeTexture', (a) => { self.unit = (a[0] as number) - gl.TEXTURE0; });
    wrap('bindTexture', (a) => { self.boundTex.set(`${self.unit}:${a[0]}`, (a[1] as object) ?? null); });
    wrap('bindBuffer', (a) => {
      self.boundBuf.set(a[0] as number, (a[1] as object) ?? null);
      // (an index buffer bound while a vertex array is bound belongs to that vertex array)
      if (a[0] === gl.ELEMENT_ARRAY_BUFFER) self.link(a[1] as object, -1);
    });
    wrap('bindBufferBase', (a) => { self.boundBuf.set(a[0] as number, (a[2] as object) ?? null); });
    wrap('bindRenderbuffer', (a) => { self.rb = (a[1] as object) ?? null; });
    wrap('bufferData', (a) => {
      const s = a[1];
      const bytes = typeof s === 'number' ? s : s && typeof (s as ArrayBufferView).byteLength === 'number' ? (a[4] != null ? Number(a[4]) * ((s as Float32Array).BYTES_PER_ELEMENT ?? 1) : (s as ArrayBufferView).byteLength - (a[3] != null ? Number(a[3]) * ((s as Float32Array).BYTES_PER_ELEMENT ?? 1) : 0)) : 0;
      const o = self.boundBuf.get(a[0] as number);
      set(o, 'buf', 'b', bytes, a[0] === gl.ELEMENT_ARRAY_BUFFER ? 'index' : a[0] === gl.UNIFORM_BUFFER ? 'uniform' : 'vertex');
      const e = o ? self.live.get(o) : null;
      if (e) e.src = mkRef(s && typeof s === 'object' ? (s as ArrayBufferView).buffer : undefined);
      self.cur.dataB += bytes;
      self.freshTotal += bytes;
    });
    // (PERF s15) ANGLE-Metal: a bufferSubData into a buffer the GPU may still read takes a new Metal buffer of the WHOLE
    // buffer's size and copies the rest across (BufferMtl putDataInNewBufferAndStartUsingNewBuffer); counted once per
    // buffer per frame (the copy is not in use until its next draw)
    wrap('bufferSubData', (a) => {
      const o = self.boundBuf.get(a[0] as number);
      const src = a[2] as ArrayBufferView | undefined;
      const el = (src as Float32Array | undefined)?.BYTES_PER_ELEMENT ?? 1;
      const b = src ? (a[4] != null ? Number(a[4]) * el : src.byteLength - (a[3] != null ? Number(a[3]) * el : 0)) : 0;
      self.cur.subN++; self.cur.subB += b;
      const e = o ? self.live.get(o) : null;
      if (!o || !e || e.copyFrame === self.frame || !self.inUse(o)) return;
      e.copyFrame = self.frame;
      e.copied = (e.copied ?? 0) + e.bytes;
      self.cur.copyN++; self.cur.copyB += e.bytes;
      self.freshTotal += e.bytes;
    });
    const texSub = (bytes: number) => { self.cur.texB += bytes; };
    wrap('texSubImage2D', (a) => { if (a.length >= 9 && typeof a[4] === 'number') { const t = a[7] as number; texSub((a[4] as number) * (a[5] as number) * bpp(gl, 0, a[6] as number, t)); } });
    wrap('texSubImage3D', (a) => { if (a.length >= 11 && typeof a[5] === 'number') texSub((a[5] as number) * (a[6] as number) * (a[7] as number) * bpp(gl, 0, a[8] as number, a[9] as number)); });
    // which buffers each vertex array reads (its attribute pointers and its index buffer), and when it was last drawn
    wrap('bindVertexArray', (a) => { self.vao = (a[0] as object) ?? null; });
    const vaoUses = (buf: object | null | undefined, slot: number) => self.link(buf, slot);
    wrap('vertexAttribPointer', (a) => { vaoUses(self.boundBuf.get(gl.ARRAY_BUFFER), a[0] as number); });
    wrap('vertexAttribIPointer', (a) => { vaoUses(self.boundBuf.get(gl.ARRAY_BUFFER), a[0] as number); });
    wrap('deleteVertexArray', (a) => {
      const v = a[0] as object;
      const f = self.vaoFrame.get(v);
      self.vaoFrame.delete(v);
      self.vaoSlots.delete(v);
      for (const b of self.vaoBufs.get(v) ?? []) { self.bufVaos.get(b)?.delete(v); if (f != null && (self.bufFrame.get(b) ?? -1) < f) self.bufFrame.set(b, f); }
      self.vaoBufs.delete(v);
    });
    const drew = () => { if (self.vao) self.vaoFrame.set(self.vao, self.frame); };
    for (const n of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) wrap(n, drew);
    try {
      const md = gl.getExtension?.('WEBGL_multi_draw') as Record<string, (...a: unknown[]) => unknown> | null;
      if (md) for (const n of ['multiDrawElementsWEBGL', 'multiDrawArraysWEBGL', 'multiDrawElementsInstancedWEBGL', 'multiDrawArraysInstancedWEBGL']) {
        const orig = md[n];
        if (typeof orig === 'function') md[n] = function (this: unknown, ...args: unknown[]) { const r = orig.apply(md, args); drew(); return r; };
      }
    } catch { /* none */ }
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
    const drop = (a: unknown[]) => {
      const o = a[0] as object; const e = o ? self.live.get(o) : null; if (e) { self.total -= e.bytes; self.live.delete(o); }
      if (o) { for (const v of self.bufVaos.get(o) ?? []) self.vaoBufs.get(v)?.delete(o); self.bufVaos.delete(o); self.bufFrame.delete(o); }
    };
    wrap('deleteBuffer', drop);
    wrap('deleteTexture', drop);
    wrap('deleteRenderbuffer', drop);
  }

  /**
   * (PERF s15 ownership) follow three's property lookups, so a texture or render-target allocation knows which three
   * object it is for (WebGLTextures looks the texture / target up right before allocating its storage)
   */
  attach(renderer: { properties: { get(o: object): unknown } }): void {
    const p = renderer.properties as { get(o: object): unknown; __gpumem?: boolean };
    if (p.__gpumem) return;
    p.__gpumem = true;
    const orig = p.get.bind(p);
    const self = this;
    p.get = function (o: object) {
      const t = o as { isTexture?: boolean; isRenderTarget?: boolean };
      if (t && t.isTexture) self.lastTex = o; else if (t && t.isRenderTarget) self.lastRT = o;
      return orig(o);
    };
  }

  /** the bound vertex array reads `buf` */
  private link(buf: object | null | undefined, slot: number): void {
    const v = this.vao;
    if (!v || !buf) return;
    let sl = this.vaoSlots.get(v);
    if (!sl) { sl = new Map(); this.vaoSlots.set(v, sl); }
    const old = sl.get(slot);
    sl.set(slot, buf);
    if (old && old !== buf) {
      // the old buffer was read through this vertex array until now: it keeps that draw's frame
      const f = this.vaoFrame.get(v);
      if (f != null && (this.bufFrame.get(old) ?? -1) < f) this.bufFrame.set(old, f);
      let still = false;
      for (const b of sl.values()) if (b === old) { still = true; break; }
      if (!still) { this.bufVaos.get(old)?.delete(v); this.vaoBufs.get(v)?.delete(old); }
    }
    let s = this.bufVaos.get(buf);
    if (!s) { s = new Set(); this.bufVaos.set(buf, s); }
    s.add(v);
    let t = this.vaoBufs.get(v);
    if (!t) { t = new Set(); this.vaoBufs.set(v, t); }
    t.add(buf);
  }
  /** bookkeeping sizes (the growth soak: none of these may only climb) */
  get trackSizes(): { live: number; bufVaos: number; vaoBufs: number; vaoFrame: number } {
    return { live: this.live.size, bufVaos: this.bufVaos.size, vaoBufs: this.vaoBufs.size, vaoFrame: this.vaoFrame.size };
  }

  /** a buffer some vertex array drawn in the last IN_USE_FRAMES frames reads */
  private inUse(buf: object): boolean {
    const bf = this.bufFrame.get(buf);
    if (bf != null && this.frame - bf < IN_USE_FRAMES) return true;
    const s = this.bufVaos.get(buf);
    if (!s) return false;
    for (const v of s) { const f = this.vaoFrame.get(v); if (f != null && this.frame - f < IN_USE_FRAMES) return true; }
    return false;
  }

  /** a frame begins (the renderer): closes the last frame's transient counts */
  tick(): void {
    this.hist.push(this.cur);
    if (this.hist.length > WINDOW) this.hist.shift();
    this.cur = { subN: 0, subB: 0, copyN: 0, copyB: 0, dataB: 0, texB: 0 };
    this.frame++;
  }

  /** the transient means over the last frames (MB / frame) and the ANGLE GC waits so far (probes, tests) */
  transients(): { frames: number; subN: number; subMB: number; copyN: number; copyMB: number; dataMB: number; texMB: number; maxCopyMB: number; inFlightMB: number; gcWaits: number } {
    const H = this.hist, n = Math.max(1, H.length), MB = 1048576;
    const sum = (k: 'subN' | 'subB' | 'copyN' | 'copyB' | 'dataB' | 'texB') => H.reduce((s, x) => s + x[k], 0);
    const last = H.slice(-IN_USE_FRAMES).reduce((s, x) => s + x.copyB + x.dataB, 0);
    return {
      frames: H.length, subN: sum('subN') / n, subMB: sum('subB') / n / MB, copyN: sum('copyN') / n, copyMB: sum('copyB') / n / MB,
      dataMB: sum('dataB') / n / MB, texMB: sum('texB') / n / MB, maxCopyMB: H.reduce((m, x) => Math.max(m, x.copyB + x.dataB), 0) / MB,
      inFlightMB: last / MB, gcWaits: Math.floor(this.freshTotal / ANGLE_GC_BYTES),
    };
  }

  /** live GPU bytes by owner (the scene walk's owner of a buffer's array / a texture; else the target's or texture's name) */
  byOwner(): Map<string, { b: number; n: number; copied: number }> {
    let own: Map<object, string> | null = null;
    try { own = this.ownerProbe?.() ?? null; } catch { own = null; }
    const out = new Map<string, { b: number; n: number; copied: number }>();
    for (const e of this.live.values()) {
      const o = e.src?.deref();
      let k = o ? own?.get(o) : undefined;
      if (!k) {
        const t = o as { name?: string; texture?: { name?: string }; textures?: { name?: string }[]; isRenderTarget?: boolean } | undefined;
        const nm = t ? (t.isRenderTarget ? (t.textures?.[0]?.name || t.texture?.name) : t.name) : '';
        k = nm ? `${e.kind === 'rb' ? 'rb' : 'tex'}:${nm}` : e.kind === 'buf' ? (o ? 'buffers (not in the scene)' : 'buffers (source gone)') : `${e.kind} (unnamed)`;
      }
      const s = out.get(k) ?? { b: 0, n: 0, copied: 0 };
      s.b += e.bytes; s.n++; s.copied += e.copied ?? 0;
      out.set(k, s);
    }
    return out;
  }

  /** the report lines: MB by kind (count), the largest objects, the peak */
  lines(cpuCopiesMB?: number): string[] {
    const by = new Map<string, { b: number; n: number }>();
    for (const e of this.live.values()) { const k = e.kind === 'buf' ? `buffers(${e.desc})` : e.kind; const s = by.get(k) ?? { b: 0, n: 0 }; s.b += e.bytes; s.n++; by.set(k, s); }
    const mb = (b: number) => (Math.round(b / 1048576 * 10) / 10).toString();
    const parts = [...by.entries()].sort((a, b) => b[1].b - a[1].b).map(([k, s]) => `${k} ${mb(s.b)} MB x${s.n}`);
    const big = [...this.live.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map((e) => `${e.kind} ${e.desc} ${mb(e.bytes)}`);
    const mins = Math.max(1e-3, ((typeof performance !== 'undefined' ? performance.now() : 0) - this.t0) / 60000);
    const growth = (this.total - this.total0) / mins;
    // (the canvas itself: back buffer + depth-stencil + ~2 compositor buffers, not visible to GL calls)
    const L = [`gpu mem (est., live GL allocations): total ${mb(this.total)} MB (peak ${mb(this.peak)}, ${mb(growth)} MB/min over ${Math.round(mins)} min) | ${parts.join(' · ')}${cpuCopiesMB != null ? ` | cpu copies of geometry ${mb(cpuCopiesMB * 1048576)} MB` : ''}`];
    try {
      const own = this.cpuProbe?.();
      if (own && own.size) {
        let t = 0; for (const v of own.values()) t += v;
        L.push(`cpu retained (typed arrays of live geometry / data textures, by owner): total ${mb(t)} MB | ${[...own.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${mb(v)}`).join(' · ')}`);
      }
      const pm = (globalThis.performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
      if (pm) L.push(`js heap: used ${mb(pm.usedJSHeapSize)} MB of ${mb(pm.totalJSHeapSize)} MB`);
    } catch { /* none */ }
    L.splice(1, 0, `gpu mem largest: ${big.join(' · ')}`);
    // (PERF s15) by owner, and the ANGLE-Metal transients (always counted)
    try {
      const own = [...this.byOwner().entries()].sort((a, b) => b[1].b - a[1].b);
      L.push(`gpu mem by owner (MB x objects): ${own.slice(0, 16).map(([k, s]) => `${k} ${mb(s.b)} x${s.n}`).join(' · ')}`);
      const t = this.transients();
      const cop = own.filter(([, s]) => s.copied > 0).sort((a, b) => b[1].copied - a[1].copied).slice(0, 8);
      const r1 = (x: number) => (Math.round(x * 10) / 10).toString(), r2 = (x: number) => (Math.round(x * 100) / 100).toString();
      L.push(`angle transients (est., ANGLE-Metal; mean over ${t.frames} frames): whole-buffer copies ${r2(t.copyMB)} MB/frame x${r1(t.copyN)} (max ${r1(t.maxCopyMB)} MB in a frame with bufferData) for ${r1(t.subN)} bufferSubData/frame of ${r2(t.subMB)} MB | bufferData ${r2(t.dataMB)} MB/frame | texSubImage ${r2(t.texMB)} MB/frame | in flight ~${r1(t.inFlightMB)} MB | ${t.gcWaits} full GPU waits so far (one per 64 MB fresh: ${r1(this.freshTotal / 1048576)} MB, ${r1(this.freshTotal / 1048576 / mins)} MB/min)${cop.length ? ` | copied by owner since load: ${cop.map(([k, s]) => `${k} ${mb(s.copied)} MB`).join(' · ')}` : ''}`);
    } catch { /* none */ }
    // buffers by size class (patch pages, instance pools ...): how many of each size
    const sizes = new Map<number, number>();
    for (const e of this.live.values()) if (e.kind === 'buf' && e.bytes >= 65536) sizes.set(e.bytes, (sizes.get(e.bytes) ?? 0) + 1);
    const sz = [...sizes.entries()].sort((a, b) => b[0] * b[1] - a[0] * a[1]).slice(0, 8).map(([b, n]) => `${n}x${mb(b)}MB`);
    if (sz.length) L.push(`gpu mem buffer sizes (count x size, >= 64 kB): ${sz.join(' · ')}`);
    return L;
  }
}

export const gpuMem = new GpuMemAudit();
