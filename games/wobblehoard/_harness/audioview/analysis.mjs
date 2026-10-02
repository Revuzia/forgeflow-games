// Node-side DSP for the audio probe: FFT, STFT, metrics, pitch tracking, spectrogram PNG and WAV writers.
// Plain ESM, no dependencies (zlib is from node:). Used by _harness/probe_audio.mjs; nothing here touches a browser.
import zlib from 'node:zlib';

/* ───────────── FFT ───────────── */

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const hannCache = new Map();
export function hann(n) {
  let w = hannCache.get(n);
  if (!w) { w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); hannCache.set(n, w); }
  return w;
}

/** Power spectrum (|X|^2, bins 0..nfft/2) of x[start .. start+win) with a Hann window, zero-padded to nfft. */
export function frameSpectrum(x, start, win, nfft) {
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  const w = hann(win);
  for (let i = 0; i < win; i++) { const k = start + i; re[i] = k >= 0 && k < x.length ? x[k] * w[i] : 0; }
  fft(re, im);
  const p = new Float64Array(nfft / 2 + 1);
  for (let k = 0; k < p.length; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));

/* ───────────── metrics ───────────── */

/**
 * Everything the probe gates on. `thrDb` is the activity threshold on 5 ms RMS windows (default -45 dBFS).
 * Active span = first..last window above threshold. Active RMS = RMS over the samples of windows above threshold.
 */
export function metrics(x, sr, { thrDb = -45 } = {}) {
  const N = x.length;
  let peak = 0, sum = 0, bad = 0, maxJump = 0, maxJumpAt = 0;
  for (let i = 0; i < N; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) { bad++; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v;
    if (i) { const d = Math.abs(v - x[i - 1]); if (d > maxJump) { maxJump = d; maxJumpAt = i; } }
  }
  const win = Math.round(sr * 0.005);
  const nw = Math.floor(N / win);
  const wr = new Float64Array(nw);
  for (let w = 0; w < nw; w++) { let s = 0; for (let i = w * win; i < (w + 1) * win; i++) s += x[i] * x[i]; wr[w] = Math.sqrt(s / win); }
  const thr = Math.pow(10, thrDb / 20);
  let first = -1, last = -1, actSum = 0, actN = 0;
  for (let w = 0; w < nw; w++) if (wr[w] > thr) { if (first < 0) first = w; last = w; actSum += wr[w] * wr[w] * win; actN += win; }
  const activeDurS = first < 0 ? 0 : (last + 1 - first) * win / sr;
  const activeStartS = first < 0 ? 0 : (first * win) / sr;
  const activeEndS = first < 0 ? 0 : ((last + 1) * win) / sr;
  const activeRmsDb = actN ? db(Math.sqrt(actSum / actN)) : -Infinity;
  const jumpWin = Math.round(sr * 0.002);
  let jumpStart = 0, jumpEnd = 0;
  for (let i = 1; i < Math.min(jumpWin, N); i++) jumpStart = Math.max(jumpStart, Math.abs(x[i] - x[i - 1]));
  for (let i = Math.max(1, N - jumpWin); i < N; i++) jumpEnd = Math.max(jumpEnd, Math.abs(x[i] - x[i - 1]));
  let tailPk = 0;
  for (let i = Math.max(0, N - Math.round(sr * 0.01)); i < N; i++) tailPk = Math.max(tailPk, Math.abs(x[i]));
  // energy above 6 kHz over the whole render
  let nf = 1; while (nf < N) nf <<= 1;
  const P = frameSpectrum(x, 0, N, nf);
  let eTot = 0, eHi = 0;
  const bin6k = Math.floor((6000 / sr) * nf);
  for (let k = 1; k < P.length; k++) { eTot += P[k]; if (k >= bin6k) eHi += P[k]; }
  return {
    n: N, durS: N / sr, badSamples: bad,
    peakDb: db(peak), peak,
    dc: sum / N,
    startSample: Math.abs(x[0]), endSample: Math.abs(x[N - 1]),
    jumpStart, jumpEnd, maxJump, maxJumpAtS: maxJumpAt / sr,
    tailDb: db(tailPk),
    activeDurS, activeStartS, activeEndS, activeRmsDb,
    hfFrac: eTot > 0 ? eHi / eTot : 0,
    winRms: wr, winS: win / sr,
  };
}

/** Welch-averaged power spectrum, smoothed on a log axis; returns the dominant frequency in [fLo, fHi] and the centroid. */
export function dominant(x, sr, { fLo = 60, fHi = 8000, win = 4096, from = 0, to = x.length } = {}) {
  const hop = win / 4;
  const acc = new Float64Array(win / 2 + 1);
  let frames = 0;
  for (let s = from - win / 2; s < to - win / 2; s += hop) {
    const p = frameSpectrum(x, s, win, win);
    let e = 0; for (let k = 0; k < p.length; k++) e += p[k];
    if (e < 1e-9) continue;
    for (let k = 0; k < p.length; k++) acc[k] += p[k];
    frames++;
  }
  const df = sr / win;
  const kLo = Math.max(2, Math.floor(fLo / df)), kHi = Math.min(acc.length - 2, Math.floor(fHi / df));
  // log-axis smoothing: average each bin over +/- 1/10 octave
  const sm = new Float64Array(acc.length);
  for (let k = kLo; k <= kHi; k++) {
    const a = Math.max(kLo, Math.floor(k * 0.93)), b = Math.min(kHi, Math.ceil(k * 1.07));
    let s = 0; for (let j = a; j <= b; j++) s += acc[j];
    sm[k] = s / (b - a + 1);
  }
  let best = kLo; for (let k = kLo; k <= kHi; k++) if (sm[k] > sm[best]) best = k;
  let num = 0, den = 0;
  for (let k = kLo; k <= kHi; k++) { num += acc[k] * k * df; den += acc[k]; }
  return { hz: best * df, centroidHz: den > 0 ? num / den : 0, frames };
}

/** Spectral centroid (Hz) per frame in [fLo, fHi]; frames quieter than `minRmsDb` are NaN. */
export function centroidTrack(x, sr, { win = 1024, hop = 480, fLo = 100, fHi = 12000, minRmsDb = -60 } = {}) {
  const out = [];
  const df = sr / win;
  for (let s = 0; s + win <= x.length; s += hop) {
    let r = 0; for (let i = 0; i < win; i++) r += x[s + i] * x[s + i];
    const rmsDb = db(Math.sqrt(r / win));
    const t = (s + win / 2) / sr;
    if (rmsDb < minRmsDb) { out.push({ t, c: NaN, rmsDb }); continue; }
    const p = frameSpectrum(x, s, win, win);
    let num = 0, den = 0;
    for (let k = Math.floor(fLo / df); k < Math.min(p.length, Math.floor(fHi / df)); k++) { num += p[k] * k * df; den += p[k]; }
    out.push({ t, c: den > 0 ? num / den : NaN, rmsDb });
  }
  return out;
}

/**
 * Track the lowest strong spectral peak in [fLo, fHi] (a sine-like partial): per frame, take local maxima within
 * `relDb` of the band maximum, pick the lowest in frequency, refine with parabolic interpolation on log magnitude.
 * Frames below `floorDb` (absolute, dBFS-ish RMS) are skipped. Returns [{t, f, magDb}].
 */
export function pitchTrack(x, sr, { win = 768, hop = 120, nfft = 8192, fLo = 70, fHi = 1500, relDb = 9, floorDb = -50 } = {}) {
  const out = [];
  const df = sr / nfft;
  const kLo = Math.max(2, Math.floor(fLo / df)), kHi = Math.min(nfft / 2 - 2, Math.floor(fHi / df));
  for (let s = -win / 2; s + win / 2 < x.length; s += hop) {
    let r = 0, cnt = 0;
    for (let i = 0; i < win; i++) { const k = s + i; if (k >= 0 && k < x.length) { r += x[k] * x[k]; cnt++; } }
    if (!cnt || db(Math.sqrt(r / win)) < floorDb) continue;
    const p = frameSpectrum(x, s, win, nfft);
    let mx = 0; for (let k = kLo; k <= kHi; k++) if (p[k] > mx) mx = p[k];
    if (mx <= 0) continue;
    const thr = mx * Math.pow(10, -relDb / 10);
    for (let k = kLo; k <= kHi; k++) {
      if (p[k] >= thr && p[k] >= p[k - 1] && p[k] > p[k + 1]) {
        const a = Math.log(p[k - 1] + 1e-30), b = Math.log(p[k] + 1e-30), c = Math.log(p[k + 1] + 1e-30);
        const d = 0.5 * (a - c) / (a - 2 * b + c);
        out.push({ t: (s + win / 2) / sr, f: (k + (Number.isFinite(d) ? d : 0)) * df, magDb: 10 * Math.log10(p[k]) });
        break;
      }
    }
  }
  return out;
}

export const median = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q); return b.length ? b[b.length >> 1] : NaN; };

/** Median tracked frequency of the points whose time falls in [t0, t1]. */
export function trackAt(track, t0, t1) {
  return median(track.filter((p) => p.t >= t0 && p.t <= t1).map((p) => p.f));
}

/* ───────────── WAV (16-bit PCM mono) ───────────── */

export function wavBuffer(x, sr) {
  const n = x.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, x[i])); buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2); }
  return buf;
}

/* ───────────── PNG ───────────── */

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function pngEncode(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/* 5x7 bitmap font, upper case only (lower case is folded) */
const FONT = {
  '0': '01110/10001/10011/10101/11001/10001/01110', '1': '00100/01100/00100/00100/00100/00100/01110',
  '2': '01110/10001/00001/00010/00100/01000/11111', '3': '11110/00001/00001/01110/00001/00001/11110',
  '4': '00010/00110/01010/10010/11111/00010/00010', '5': '11111/10000/11110/00001/00001/10001/01110',
  '6': '00110/01000/10000/11110/10001/10001/01110', '7': '11111/00001/00010/00100/01000/01000/01000',
  '8': '01110/10001/10001/01110/10001/10001/01110', '9': '01110/10001/10001/01111/00001/00010/01100',
  A: '01110/10001/10001/11111/10001/10001/10001', B: '11110/10001/10001/11110/10001/10001/11110',
  C: '01110/10001/10000/10000/10000/10001/01110', D: '11100/10010/10001/10001/10001/10010/11100',
  E: '11111/10000/10000/11110/10000/10000/11111', F: '11111/10000/10000/11110/10000/10000/10000',
  G: '01110/10001/10000/10111/10001/10001/01111', H: '10001/10001/10001/11111/10001/10001/10001',
  I: '01110/00100/00100/00100/00100/00100/01110', J: '00111/00010/00010/00010/00010/10010/01100',
  K: '10001/10010/10100/11000/10100/10010/10001', L: '10000/10000/10000/10000/10000/10000/11111',
  M: '10001/11011/10101/10101/10001/10001/10001', N: '10001/10001/11001/10101/10011/10001/10001',
  O: '01110/10001/10001/10001/10001/10001/01110', P: '11110/10001/10001/11110/10000/10000/10000',
  Q: '01110/10001/10001/10001/10101/10010/01101', R: '11110/10001/10001/11110/10100/10010/10001',
  S: '01111/10000/10000/01110/00001/00001/11110', T: '11111/00100/00100/00100/00100/00100/00100',
  U: '10001/10001/10001/10001/10001/10001/01110', V: '10001/10001/10001/10001/10001/01010/00100',
  W: '10001/10001/10001/10101/10101/10101/01010', X: '10001/10001/01010/00100/01010/10001/10001',
  Y: '10001/10001/01010/00100/00100/00100/00100', Z: '11111/00001/00010/00100/01000/10000/11111',
  '.': '00000/00000/00000/00000/00000/01100/01100', '-': '00000/00000/00000/11111/00000/00000/00000',
  ':': '00000/01100/01100/00000/01100/01100/00000', '/': '00001/00010/00010/00100/01000/01000/10000',
  '%': '11001/11010/00010/00100/01000/01011/10011', '+': '00000/00100/00100/11111/00100/00100/00000',
  '(': '00010/00100/01000/01000/01000/00100/00010', ')': '01000/00100/00010/00010/00010/00100/01000',
  '=': '00000/00000/11111/00000/11111/00000/00000', ',': '00000/00000/00000/00000/01100/00100/01000',
  ' ': '00000/00000/00000/00000/00000/00000/00000',
};

function drawText(img, w, h, x0, y0, text, rgb, scale = 2) {
  let cx = x0;
  for (const chRaw of text) {
    const g = (FONT[chRaw.toUpperCase()] ?? FONT[' ']).split('/');
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = cx + c * scale + dx, py = y0 + r * scale + dy;
        if (px >= 0 && px < w && py >= 0 && py < h) { const o = (py * w + px) * 3; img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2]; }
      }
    }
    cx += 6 * scale;
  }
  return cx;
}
const textWidth = (t, scale = 2) => t.length * 6 * scale;

const STOPS = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
function inferno(v) {
  const t = Math.min(1, Math.max(0, v)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t)), f = t - i;
  return [0, 1, 2].map((k) => Math.round(STOPS[i][k] * (1 - f) + STOPS[i + 1][k] * f));
}

/**
 * Spectrogram on a log-frequency axis with a waveform strip above it. `track` ([{t,f}]) is drawn as small cyan dots,
 * `marks` ([{t,label}]) as vertical hairlines. dB range = 72 below the loudest cell.
 */
export function spectrogramPng(x, sr, { title = '', win = 1024, fMin = 40, fMax = 14000, width = 1100, track = null, marks = null, rangeDb = 72 } = {}) {
  const margL = 78, margR = 16, margT = 34, waveH = 84, gap = 8, specH = 400, margB = 34;
  const W = width + margL + margR, H = margT + waveH + gap + specH + margB;
  const img = Buffer.alloc(W * H * 3, 14);
  const dur = x.length / sr;
  const nfft = win * 2;
  // spectrogram cells
  const cols = width, spec = new Float32Array(cols * specH);
  let maxDb = -200;
  const logMin = Math.log(fMin), logMax = Math.log(Math.min(fMax, sr / 2 - 100));
  const df = sr / nfft;
  for (let c = 0; c < cols; c++) {
    const centre = Math.round(((c + 0.5) / cols) * x.length);
    const p = frameSpectrum(x, centre - win / 2, win, nfft);
    for (let r = 0; r < specH; r++) {
      const f = Math.exp(logMax - ((r + 0.5) / specH) * (logMax - logMin));
      const kf = f / df, k0 = Math.floor(kf), fr = kf - k0;
      const pw = p[k0] * (1 - fr) + p[Math.min(k0 + 1, p.length - 1)] * fr;
      const d = 10 * Math.log10(pw + 1e-20);
      spec[c * specH + r] = d;
      if (d > maxDb) maxDb = d;
    }
  }
  for (let c = 0; c < cols; c++) for (let r = 0; r < specH; r++) {
    const rgb = inferno((spec[c * specH + r] - (maxDb - rangeDb)) / rangeDb);
    const o = ((margT + waveH + gap + r) * W + margL + c) * 3;
    img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2];
  }
  // waveform strip (min/max per column, dB-ish compressed so tails are visible)
  const wy0 = margT, wmid = wy0 + waveH / 2;
  for (let c = 0; c < cols; c++) {
    let mn = 0, mxv = 0;
    const a = Math.floor((c / cols) * x.length), b = Math.floor(((c + 1) / cols) * x.length);
    for (let i = a; i < b; i++) { if (x[i] < mn) mn = x[i]; if (x[i] > mxv) mxv = x[i]; }
    const comp = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.5);
    const y1 = Math.round(wmid - comp(mxv) * (waveH / 2 - 2)), y2 = Math.round(wmid - comp(mn) * (waveH / 2 - 2));
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2, Math.min(y1, y2)); y++) {
      const o = (y * W + margL + c) * 3; img[o] = 120; img[o + 1] = 210; img[o + 2] = 150;
    }
  }
  const FG = [200, 200, 215];
  // axes: frequency
  const freqTicks = [50, 100, 200, 500, 1000, 2000, 5000, 10000].filter((f) => f >= fMin && f <= fMax);
  for (const f of freqTicks) {
    const y = Math.round(margT + waveH + gap + ((logMax - Math.log(f)) / (logMax - logMin)) * specH);
    for (let c = 0; c < cols; c += 3) { const o = (y * W + margL + c) * 3; img[o] = 255; img[o + 1] = 255; img[o + 2] = 255; }
    const lab = f >= 1000 ? `${f / 1000}K` : `${f}`;
    drawText(img, W, H, margL - 6 - textWidth(lab), y - 7, lab, FG);
  }
  drawText(img, W, H, 6, margT + waveH + gap + specH / 2 - 7, 'HZ', FG);
  // time ticks
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
  const step = steps.find((s) => dur / s <= 14) ?? 1;
  for (let t = 0; t <= dur + 1e-9; t += step) {
    const xx = margL + Math.round((t / dur) * cols);
    for (let y = margT; y < margT + waveH + gap + specH; y += 4) { const o = (y * W + Math.min(xx, W - 1)) * 3; img[o] = 90; img[o + 1] = 90; img[o + 2] = 110; }
    const lab = step < 0.1 ? `${Math.round(t * 1000)}MS` : `${(+t.toFixed(2))}S`;
    drawText(img, W, H, xx - textWidth(lab) / 2, margT + waveH + gap + specH + 8, lab, FG);
  }
  if (marks) for (const m of marks) {
    const xx = margL + Math.round((m.t / dur) * cols);
    for (let y = margT + waveH + gap; y < margT + waveH + gap + specH; y++) { const o = (y * W + Math.min(Math.max(xx, 0), W - 1)) * 3; img[o] = 255; img[o + 1] = 80; img[o + 2] = 80; }
    if (m.label) drawText(img, W, H, xx + 3, margT + waveH + gap + 3, m.label, [255, 140, 140], 1);
  }
  if (track) for (const p of track) {
    const xx = margL + Math.round((p.t / dur) * cols);
    const y = Math.round(margT + waveH + gap + ((logMax - Math.log(p.f)) / (logMax - logMin)) * specH);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px = xx + dx, py = y + dy;
      if (px >= margL && px < W - margR && py >= margT + waveH + gap && py < margT + waveH + gap + specH) { const o = (py * W + px) * 3; img[o] = 80; img[o + 1] = 240; img[o + 2] = 255; }
    }
  }
  drawText(img, W, H, margL, 8, `${title}   (${dur.toFixed(2)} S, WINDOW ${win} = ${(win / sr * 1000).toFixed(1)} MS, ${rangeDb} DB RANGE, TOP = ${maxDb.toFixed(0)} DB)`, [255, 241, 214]);
  return pngEncode(W, H, img);
}

/* ───────────── spectral descriptors used by the ceremony gates ───────────── */

/** Welch-averaged power spectrum (Hann, hop win/4) of x[from..to). */
export function avgSpectrum(x, sr, { win = 16384, from = 0, to = x.length } = {}) {
  const hop = win / 4;
  const acc = new Float64Array(win / 2 + 1);
  let frames = 0;
  for (let s = from - win / 2; s < to - win / 2; s += hop) {
    const p = frameSpectrum(x, s, win, win);
    let e = 0; for (let k = 0; k < p.length; k++) e += p[k];
    if (e < 1e-9) continue;
    for (let k = 0; k < p.length; k++) acc[k] += p[k];
    frames++;
  }
  return { P: acc, df: sr / win, frames };
}

/** Local maxima that stand >= promDb above the local median and within relDb of the strongest peak; peaks closer than 3 bins merge. */
export function spectralPeaks(P, df, { fLo = 60, fHi = 9000, relDb = -38, promDb = 8 } = {}) {
  const kLo = Math.max(4, Math.floor(fLo / df)), kHi = Math.min(P.length - 5, Math.floor(fHi / df));
  let mx = 0; for (let k = kLo; k <= kHi; k++) if (P[k] > mx) mx = P[k];
  const thr = mx * Math.pow(10, relDb / 10), prom = Math.pow(10, promDb / 10);
  const peaks = [];
  const med = (k) => {
    const a = Math.max(2, k - 60), b = Math.min(P.length - 1, k + 60);
    const v = Array.from(P.subarray(a, b + 1)).sort((p, q) => p - q);
    return v[v.length >> 1];
  };
  for (let k = kLo; k <= kHi; k++) {
    if (P[k] < thr) continue;
    if (!(P[k] >= P[k - 1] && P[k] > P[k + 1] && P[k] >= P[k - 2] && P[k] > P[k + 2])) continue;
    if (P[k] < prom * med(k)) continue;
    const a = Math.log(P[k - 1] + 1e-30), b = Math.log(P[k] + 1e-30), c = Math.log(P[k + 1] + 1e-30);
    const d = 0.5 * (a - c) / (a - 2 * b + c);
    const last = peaks[peaks.length - 1];
    if (last && k - last.k < 3) { if (P[k] > last.p) { last.k = k; last.p = P[k]; last.f = (k + (Number.isFinite(d) ? d : 0)) * df; } continue; }
    peaks.push({ k, p: P[k], f: (k + (Number.isFinite(d) ? d : 0)) * df, db: 10 * Math.log10(P[k] / mx) });
  }
  return peaks;
}

/** Low/high cumulative-energy percentiles (default 2% and 98%) in [fLo, fHi] and the width between them in octaves. */
export function spectralSpread(P, df, { fLo = 30, fHi = 12000, lo = 0.02, hi = 0.98 } = {}) {
  const kLo = Math.floor(fLo / df), kHi = Math.min(P.length - 1, Math.floor(fHi / df));
  let tot = 0; for (let k = kLo; k <= kHi; k++) tot += P[k];
  let acc = 0, fa = fLo, fb = fHi, gotLo = false;
  for (let k = kLo; k <= kHi; k++) {
    acc += P[k];
    if (!gotLo && acc >= lo * tot) { fa = k * df; gotLo = true; }
    if (acc >= hi * tot) { fb = k * df; break; }
  }
  return { f05: fa, f95: fb, octaves: Math.log2(fb / Math.max(fa, 1)) };
}
