// VALE render — the device report (ruling 67): what a tester's laptop can send us when we cannot run it here.
//
// GlProbe wraps a handful of WebGL2 calls on the renderer's own context (instance properties, so nothing else is
// touched) and keeps running totals, cheaply, from boot:
//   * blocking shader time: the time spent in the first query on each linked program (LINK_STATUS or the first
//     reflection call; COMPLETION_STATUS_KHR polls are free) and in getShaderParameter(COMPILE_STATUS), which is where a driver that compiles synchronously (ANGLE on Direct3D 11 without parallel compile, SwiftShader)
//     makes the page wait; the worst program and how many programs were linked
//   * texture memory: every texStorage2D / texImage2D / compressedTexImage2D allocation of the bound texture, by its
//     internal format (mips counted as 4/3), minus deleteTexture: an estimate of what the GPU holds for textures and
//     render targets
// FrameLog keeps the worst frame intervals, the count over 50 / 250 ms, and the longest main-thread tasks
// (PerformanceObserver 'longtask' where the browser has it).
// ?diag=1 draws a small readout in the top-left corner; Settings > Video "Copy device report" copies the whole report.

const GL_TEXTURE_2D = 0x0de1, GL_TEXTURE_CUBE_MAP = 0x8513, GL_TEXTURE_3D = 0x806f, GL_TEXTURE_2D_ARRAY = 0x8c1a;
const GL_COMPILE_STATUS = 0x8b81, GL_COMPLETION_STATUS_KHR = 0x91b1;

/** bytes per texel of a sized internal format (unknown: 4) */
function bpp(fmt: number): number {
  switch (fmt) {
    case 0x8229: return 1;                  // R8
    case 0x822b: return 2;                  // RG8
    case 0x822d: return 2;                  // R16F
    case 0x822f: return 4;                  // RG16F
    case 0x822e: return 4;                  // R32F
    case 0x8230: return 8;                  // RG32F
    case 0x881a: return 8;                  // RGBA16F
    case 0x8814: return 16;                 // RGBA32F
    case 0x881b: return 6;                  // RGB16F
    case 0x8815: return 12;                 // RGB32F
    case 0x8c3a: return 4;                  // R11F_G11F_B10F
    case 0x81a5: return 2;                  // DEPTH_COMPONENT16
    case 0x81a6: case 0x8cac: case 0x88f0: return 4;   // DEPTH24, DEPTH32F, DEPTH24_STENCIL8
    case 0x8cad: return 8;                  // DEPTH32F_STENCIL8
    default: return 4;                      // RGBA8, SRGB8_ALPHA8, RGB8 (padded), unsized RGBA
  }
}

export interface GlProbeStats {
  programs: number; blockingMs: number; worstProgramMs: number; shaders: number;
  textureBytes: number; textureCount: number; peakTextureBytes: number;
}

export class GlProbe {
  programs = 0; blockingMs = 0; worstProgramMs = 0; shaders = 0;
  textureBytes = 0; peakTextureBytes = 0;
  private readonly sizes = new WeakMap<WebGLTexture, number>();
  private live = 0;
  private bound = new Map<number, WebGLTexture | null>();

  constructor(gl: WebGL2RenderingContext) {
    const g = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
    const wrap = (name: string, fn: (orig: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown): void => {
      const orig = g[name];
      if (typeof orig !== 'function') return;
      const bound = orig.bind(gl);
      try { g[name] = fn(bound); } catch { /* a frozen context object: no probe */ }
    };
    // the first reflection call on a just-linked program waits for the driver's compile (three skips LINK_STATUS in
    // production: checkShaderErrors off), so that call's time is the program's blocking compile time
    const fresh = new WeakSet<object>();
    wrap('linkProgram', (o) => (p) => { if (p) { fresh.add(p as object); this.programs++; } return o(p); });
    const firstUse = (name: string): void => wrap(name, (o) => (p, ...rest) => {
      if (!p || !fresh.has(p as object) || (name === 'getProgramParameter' && rest[0] === GL_COMPLETION_STATUS_KHR)) return o(p, ...rest);
      fresh.delete(p as object);
      const t = performance.now();
      const r = o(p, ...rest);
      const ms = performance.now() - t;
      this.blockingMs += ms; if (ms > this.worstProgramMs) this.worstProgramMs = ms;
      return r;
    });
    for (const n of ['getProgramParameter', 'getActiveUniform', 'getActiveAttrib', 'getUniformLocation', 'getAttribLocation', 'getProgramInfoLog', 'getUniformBlockIndex']) firstUse(n);
    wrap('getShaderParameter', (o) => (s, pname) => {
      if (pname !== GL_COMPILE_STATUS) return o(s, pname);
      const t = performance.now();
      const r = o(s, pname);
      this.blockingMs += performance.now() - t; this.shaders++;
      return r;
    });
    void GL_COMPLETION_STATUS_KHR;
    wrap('bindTexture', (o) => (target, tex) => { this.bound.set(target as number, (tex as WebGLTexture | null) ?? null); return o(target, tex); });
    const alloc = (target: number, bytes: number, replace: boolean): void => {
      const key = target >= 0x8515 && target <= 0x851a ? GL_TEXTURE_CUBE_MAP : target;
      const tex = this.bound.get(key);
      if (!tex) return;
      const had = this.sizes.get(tex) ?? 0;
      const next = replace ? bytes : had + bytes;
      if (!had && next) this.live++;
      this.sizes.set(tex, next);
      this.textureBytes += next - had;
      if (this.textureBytes > this.peakTextureBytes) this.peakTextureBytes = this.textureBytes;
    };
    wrap('texStorage2D', (o) => (target, levels, fmt, w, h) => {
      const faces = target === GL_TEXTURE_CUBE_MAP ? 6 : 1;
      const lv = levels as number;
      alloc(target as number, Math.round((w as number) * (h as number) * bpp(fmt as number) * faces * (lv > 1 ? 4 / 3 : 1)), true);
      return o(target, levels, fmt, w, h);
    });
    wrap('texStorage3D', (o) => (target, levels, fmt, w, h, d) => {
      alloc(target as number, Math.round((w as number) * (h as number) * (d as number) * bpp(fmt as number) * ((levels as number) > 1 ? 4 / 3 : 1)), true);
      return o(target, levels, fmt, w, h, d);
    });
    wrap('texImage2D', (o) => (...a) => {
      // (target, level, internalformat, width, height, border, format, type, src) or (target, level, internalformat, format, type, source)
      const target = a[0] as number, level = a[1] as number, fmt = a[2] as number;
      if (level === 0) {
        let w = 0, h = 0;
        if (a.length >= 9 || typeof a[3] === 'number' && typeof a[5] === 'number' && a.length > 6) { w = a[3] as number; h = a[4] as number; }
        else { const src = a[5] as { width?: number; height?: number; videoWidth?: number } | undefined; w = src?.width ?? 0; h = src?.height ?? 0; }
        const isFace = target >= 0x8515 && target <= 0x851a;
        alloc(target, Math.round(w * h * bpp(fmt) * 4 / 3), !isFace || target === 0x8515);
      }
      return o(...a);
    });
    wrap('compressedTexImage2D', (o) => (...a) => {
      const level = a[1] as number;
      const data = a[6] as ArrayBufferView | undefined;
      if (data && typeof data.byteLength === 'number') alloc(a[0] as number, data.byteLength, level === 0);
      return o(...a);
    });
    wrap('deleteTexture', (o) => (tex) => {
      const t = tex as WebGLTexture | null;
      if (t) { const had = this.sizes.get(t) ?? 0; if (had) { this.textureBytes -= had; this.live--; this.sizes.delete(t); } }
      return o(tex);
    });
    void GL_TEXTURE_2D; void GL_TEXTURE_3D; void GL_TEXTURE_2D_ARRAY;
  }

  /** a lost context dropped every texture with it */
  contextLost(): void { this.textureBytes = 0; this.live = 0; this.bound.clear(); }

  stats(): GlProbeStats {
    return {
      programs: this.programs, blockingMs: Math.round(this.blockingMs), worstProgramMs: Math.round(this.worstProgramMs), shaders: this.shaders,
      textureBytes: this.textureBytes, textureCount: this.live, peakTextureBytes: this.peakTextureBytes,
    };
  }
}

export class FrameLog {
  private last = 0;
  readonly worst: { ms: number; at: number }[] = [];
  over50 = 0; over250 = 0; frames = 0;
  readonly longTasks: { ms: number; at: number }[] = [];
  private readonly t0 = typeof performance !== 'undefined' ? performance.now() : 0;

  constructor() {
    try {
      const PO = (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
      if (PO && PO.supportedEntryTypes?.includes('longtask')) {
        new PO((list) => {
          for (const e of list.getEntries()) FrameLog.keep(this.longTasks, { ms: Math.round(e.duration), at: Math.round(e.startTime) }, 8);
        }).observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
      }
    } catch { /* no long-task timing here */ }
  }

  private static keep(list: { ms: number; at: number }[], x: { ms: number; at: number }, n: number): void {
    if (list.length >= n && x.ms <= list[list.length - 1]!.ms) return;
    list.push(x); list.sort((a, b) => b.ms - a.ms); if (list.length > n) list.length = n;
  }

  /** one drawn frame at `now` (performance.now ms) */
  frame(now: number): void {
    if (this.last > 0) {
      const iv = now - this.last;
      this.frames++;
      if (iv > 50) this.over50++;
      if (iv > 250) this.over250++;
      FrameLog.keep(this.worst, { ms: Math.round(iv), at: Math.round(now - this.t0) }, 8);
    }
    this.last = now;
  }

  /** a gap the page did not draw on purpose (a hidden tab) is not a stall */
  skip(): void { this.last = 0; }
}

/** the ?diag=1 corner readout (plain DOM, outside the UI's tree; pointer-events none) */
export function mountDiagOverlay(read: () => string[]): () => void {
  if (typeof document === 'undefined') return () => {};
  const el = document.createElement('pre');
  el.id = 'vale-diag';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: '6px', top: '6px', zIndex: '99999', margin: '0', padding: '6px 8px', maxWidth: '46vw',
    font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#e8e4d8', background: 'rgba(10,12,14,0.78)',
    pointerEvents: 'none', whiteSpace: 'pre-wrap', borderRadius: '4px',
  } as Partial<CSSStyleDeclaration>);
  document.body.append(el);
  const tick = (): void => { try { el.textContent = read().join('\n'); } catch (e) { el.textContent = String(e); } };
  tick();
  const id = setInterval(tick, 1000);
  return () => { clearInterval(id); el.remove(); };
}

export const mb = (b: number): string => `${(b / 1048576).toFixed(0)} MB`;
