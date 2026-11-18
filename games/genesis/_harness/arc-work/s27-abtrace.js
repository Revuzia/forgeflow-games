// (PERF s27) init script: counts typed-array / ArrayBuffer allocations >= 16 kB by call site (main thread). window.__AB__()
(() => {
  const sites = new Map(); let total = 0, count = 0;
  const note = (bytes) => {
    if (bytes < 16384) return; total += bytes; count++;
    const st = (new Error().stack || '').split('\n').slice(3, 6).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '')).join(' < ');
    const e = sites.get(st) ?? [0, 0]; e[0] += bytes; e[1]++; sites.set(st, e);
  };
  for (const name of ['Float32Array', 'Float64Array', 'Uint32Array', 'Int32Array', 'Uint16Array', 'Uint8Array', 'Int16Array']) {
    const O = globalThis[name];
    const W = new Proxy(O, { construct(t, a, nt) { const r = Reflect.construct(t, a, nt === W ? t : nt); if (typeof a[0] === 'number') note(a[0] * t.BYTES_PER_ELEMENT); else if (a[0] && typeof a[0] === 'object' && !(a[0] instanceof ArrayBuffer) && a[0].length != null && a.length === 1) note(a[0].length * t.BYTES_PER_ELEMENT); return r; } });
    globalThis[name] = W;
  }
  const TA = Object.getPrototypeOf(Float32Array.prototype ? Object.getPrototypeOf(Float32Array.prototype) : {});
  const proto = Object.getPrototypeOf(Float32Array.prototype);
  for (const m of ['slice']) { const o = proto[m]; proto[m] = function (...a) { const r = o.apply(this, a); note(r.byteLength); return r; }; }
  const AO = globalThis.ArrayBuffer; const oSlice = AO.prototype.slice; AO.prototype.slice = function (...a) { const r = oSlice.apply(this, a); note(r.byteLength); return r; };
  window.__AB__ = (reset) => { const out = { total, count, top: [...sites].sort((a, b) => b[1][0] - a[1][0]).slice(0, 14).map(([k, v]) => `${(v[0] / 1048576).toFixed(1)}MB x${v[1]} ${k}`) }; if (reset) { sites.clear(); total = 0; count = 0; } return out; };
})();
