// PLAYGROUND round 6 (R6_RENDER item 4): the Places sheet's postcard pictures. A tiny procedural 2D-canvas drawing per place of D-96's seven
// (Home, Hearthlog Cabin, Ripple Shore, Frostbell Ridge, Rainleaf Garden, Lanternroof, Cloudloft): its sky, its ground and one or two of its
// things, with a little squishy in front, in the eight theme tokens. No WebGL, no three, no assets: the shell's Travel sheet (a later-* chunk)
// imports it lazily and draws into a <canvas> where the blank `.jn-sky` band was:
//   const { drawPostcard } = await import('../render/postcard.ts');  drawPostcard(canvasEl, place.id);   // false for an unknown or dropped id
// The canvas takes its CSS box (clientWidth x clientHeight, or the width / height given) times the device pixel ratio; the same id always
// draws the same picture (seeded). Calm / reduced motion change nothing: it is a still.

/** The eight theme tokens (src/ui/theme.ts PALETTE). */
const T = { ink: '#14102a', plum: '#2a1744', dusk: '#5b3a86', felt: '#2a2150', amber: '#ffb347', lagoon: '#59d6e6', coral: '#ff5a4d', cream: '#fff1d6' } as const;
type Tk = keyof typeof T;
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** A mix of two tokens (t 0 = a, 1 = b) times a lightness k, as a CSS colour (sRGB mix: a postcard needs no OKLCH). */
function mix(a: Tk, b: Tk, t = 0, k = 1, al = 1): string {
  const A = rgb(T[a]), B = rgb(T[b]);
  const c = A.map((v, i) => Math.max(0, Math.min(255, Math.round((v + (B[i] - v) * t) * k))));
  return `rgba(${c[0]},${c[1]},${c[2]},${al})`;
}

/** The places that have a postcard (Home and the six to travel to). */
export const POSTCARDS = ['home', 'hearthlog', 'ripple', 'frostbell', 'rainleaf', 'lanternroof', 'cloudloft'] as const;

type C2 = CanvasRenderingContext2D;
function grad(c: C2, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const [o, s] of stops) g.addColorStop(o, s);
  return g;
}
function ell(c: C2, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient): void {
  c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
}
function glow(c: C2, x: number, y: number, r: number, col: string): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
}
/** A little squishy: a soft jelly dome with a highlight, two eyes and their sparkles, standing at (x, y = its foot), height h. */
function squishy(c: C2, x: number, y: number, h: number, body: Tk, shade: Tk): void {
  const w = h * 1.25;
  ell(c, x, y + h * 0.04, w * 0.55, h * 0.1, 'rgba(10,6,24,0.35)');
  c.beginPath();
  c.moveTo(x - w / 2, y);
  c.bezierCurveTo(x - w / 2, y - h * 1.05, x + w / 2, y - h * 1.05, x + w / 2, y);
  c.closePath();
  const g = c.createLinearGradient(x - w / 2, y - h, x + w / 2, y);
  g.addColorStop(0, mix(body, 'cream', 0.35)); g.addColorStop(0.55, mix(body, body)); g.addColorStop(1, mix(body, shade, 0.45, 0.85));
  c.fillStyle = g; c.fill();
  ell(c, x - w * 0.2, y - h * 0.62, w * 0.12, h * 0.09, 'rgba(255,248,236,0.65)');
  for (const s of [-1, 1]) { ell(c, x + s * w * 0.14, y - h * 0.4, h * 0.075, h * 0.09, T.ink); ell(c, x + s * w * 0.14 - h * 0.02, y - h * 0.43, h * 0.025, h * 0.025, T.cream); }
}
/** A seeded 0..1 sequence (the same picture every time). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const DRAW: Record<string, (c: C2, w: number, h: number, r: () => number) => void> = {
  home(c, w, h) {   // the felt mat under the warm lamp
    c.fillStyle = grad(c, 0, h, [[0, mix('ink', 'dusk', 0.25)], [1, mix('plum', 'dusk', 0.3)]]); c.fillRect(0, 0, w, h);
    glow(c, w * 0.3, h * 0.15, h * 1.3, mix('amber', 'amber', 0, 1, 0.4));
    ell(c, w * 0.5, h * 0.82, w * 0.46, h * 0.24, mix('felt', 'dusk', 0.35));
    ell(c, w * 0.5, h * 0.8, w * 0.42, h * 0.19, mix('felt', 'dusk', 0.15, 1.1));
    squishy(c, w * 0.5, h * 0.84, h * 0.5, 'coral', 'plum');
  },
  hearthlog(c, w, h) {   // log walls, the window with snow, the fire's glow, the braided rug
    c.fillStyle = mix('ink', 'plum', 0.5); c.fillRect(0, 0, w, h);   // the dark between the logs
    for (let y = 0; y < h; y += h / 7) { c.fillStyle = mix('plum', 'dusk', (y / h) * 0.6 + 0.2, 1.1); c.fillRect(0, y, w, h / 7 - 1); }
    c.fillStyle = mix('ink', 'dusk', 0.35); c.fillRect(w * 0.62, h * 0.12, w * 0.2, h * 0.4);
    c.strokeStyle = mix('plum', 'amber', 0.3, 0.9); c.lineWidth = Math.max(1, h * 0.04); c.strokeRect(w * 0.62, h * 0.12, w * 0.2, h * 0.4);
    c.fillStyle = mix('cream', 'lagoon', 0.2, 1, 0.9); for (let k = 0; k < 6; k++) ell(c, w * (0.64 + 0.03 * k), h * (0.18 + ((k * 7) % 5) * 0.06), h * 0.018, h * 0.018, mix('cream', 'lagoon', 0.2));
    glow(c, w * 0.18, h * 0.75, h * 0.9, mix('amber', 'coral', 0.2, 1, 0.75));
    c.fillStyle = mix('ink', 'cream', 0.4); c.fillRect(w * 0.06, h * 0.45, w * 0.24, h * 0.55);
    glow(c, w * 0.18, h * 0.85, h * 0.25, mix('amber', 'cream', 0.3));
    c.fillStyle = mix('amber', 'cream', 0.4, 0.55); c.fillRect(0, h * 0.86, w, h * 0.14);
    for (let k = 3; k >= 1; k--) ell(c, w * 0.55, h * 0.93, w * 0.1 * k, h * 0.05 * k, mix(k % 2 ? 'coral' : 'cream', 'plum', 0.2));
    squishy(c, w * 0.48, h * 0.92, h * 0.46, 'lagoon', 'dusk');
  },
  ripple(c, w, h) {   // a lagoon sky, the low sun, the sea and its surf, sand, a shell
    c.fillStyle = grad(c, 0, h * 0.55, [[0, mix('lagoon', 'dusk', 0.4, 0.75)], [1, mix('cream', 'coral', 0.3)]]); c.fillRect(0, 0, w, h * 0.55);
    glow(c, w * 0.78, h * 0.42, h * 0.6, mix('cream', 'amber', 0.3, 1, 0.8)); ell(c, w * 0.78, h * 0.44, h * 0.13, h * 0.13, mix('cream', 'amber', 0.2));
    c.fillStyle = grad(c, h * 0.5, h * 0.72, [[0, mix('lagoon', 'dusk', 0.4, 0.7)], [1, mix('lagoon', 'cream', 0.25, 0.9)]]); c.fillRect(0, h * 0.5, w, h * 0.22);
    c.strokeStyle = mix('cream', 'cream', 0, 1, 0.85); c.lineWidth = Math.max(1, h * 0.03);
    for (const y of [0.6, 0.69]) { c.beginPath(); for (let x = 0; x <= w; x += 4) c.lineTo(x, h * y + Math.sin(x * 0.12 + y * 9) * h * 0.012); c.stroke(); }
    c.fillStyle = mix('amber', 'cream', 0.55, 0.92); c.fillRect(0, h * 0.72, w, h * 0.28);
    ell(c, w * 0.2, h * 0.86, h * 0.09, h * 0.06, mix('coral', 'cream', 0.4));
    squishy(c, w * 0.5, h * 0.95, h * 0.44, 'amber', 'coral');
  },
  frostbell(c, w, h, r) {   // a clear sky, plum ranges with snow caps, snow, the ice pond
    c.fillStyle = grad(c, 0, h * 0.6, [[0, mix('lagoon', 'dusk', 0.4, 0.7)], [1, mix('lagoon', 'dusk', 0.15, 0.95)]]); c.fillRect(0, 0, w, h * 0.6);
    for (let l = 0; l < 2; l++) {
      c.beginPath(); c.moveTo(0, h * 0.62);
      let x = 0; while (x < w) { const pw = h * (0.35 + r() * 0.3); c.lineTo(x + pw / 2, h * (0.18 + l * 0.12 + r() * 0.12)); c.lineTo(x + pw, h * 0.62); x += pw; }
      c.closePath(); c.fillStyle = l ? mix('dusk', 'plum', 0.3, 1.05) : mix('dusk', 'lagoon', 0.4, 1.1); c.fill();
    }
    c.fillStyle = grad(c, h * 0.58, h, [[0, mix('cream', 'lagoon', 0.15, 0.95)], [1, mix('cream', 'lagoon', 0.3, 0.82)]]); c.fillRect(0, h * 0.58, w, h * 0.42);
    ell(c, w * 0.72, h * 0.82, w * 0.18, h * 0.08, mix('dusk', 'lagoon', 0.45, 0.85));
    c.strokeStyle = mix('cream', 'lagoon', 0.2, 1, 0.8); c.lineWidth = 1; c.beginPath(); c.moveTo(w * 0.62, h * 0.82); c.lineTo(w * 0.78, h * 0.8); c.stroke();
    squishy(c, w * 0.38, h * 0.93, h * 0.46, 'lagoon', 'dusk');
  },
  rainleaf(c, w, h, r) {   // dusk, giant teal leaves, rain, a puddle on dark loam
    c.fillStyle = grad(c, 0, h, [[0, mix('plum', 'ink', 0.3)], [1, mix('dusk', 'plum', 0.4)]]); c.fillRect(0, 0, w, h);
    for (let k = 0; k < 6; k++) {
      const x = w * (k / 5) + (r() - 0.5) * h * 0.4, lh = h * (0.55 + r() * 0.35);
      c.beginPath(); c.moveTo(x, h * 0.78); c.quadraticCurveTo(x - lh * 0.45, h * 0.78 - lh * 0.5, x, h * 0.78 - lh); c.quadraticCurveTo(x + lh * 0.45, h * 0.78 - lh * 0.5, x, h * 0.78);
      c.fillStyle = mix('lagoon', 'amber', 0.3, 0.55 + 0.15 * r()); c.fill();
      c.strokeStyle = mix('lagoon', 'cream', 0.35, 0.8, 0.7); c.lineWidth = 1; c.beginPath(); c.moveTo(x, h * 0.78); c.lineTo(x, h * 0.78 - lh * 0.95); c.stroke();
    }
    c.fillStyle = mix('coral', 'amber', 0.45, 0.33); c.fillRect(0, h * 0.78, w, h * 0.22);
    ell(c, w * 0.7, h * 0.88, w * 0.15, h * 0.05, mix('dusk', 'lagoon', 0.35, 0.95));
    c.strokeStyle = mix('lagoon', 'cream', 0.4, 1, 0.45); c.lineWidth = 1;
    for (let k = 0; k < 26; k++) { const x = r() * w, y = r() * h * 0.8; c.beginPath(); c.moveTo(x, y); c.lineTo(x + h * 0.03, y + h * 0.12); c.stroke(); }
    squishy(c, w * 0.42, h * 0.95, h * 0.46, 'coral', 'plum');
  },
  lanternroof(c, w, h, r) {   // an ink night, stars, the big moon, the city's skyline, the lantern line, the parapet
    c.fillStyle = grad(c, 0, h, [[0, mix('ink', 'ink', 0, 0.8)], [0.55, mix('dusk', 'ink', 0.5)], [0.75, mix('dusk', 'coral', 0.3, 0.7)]]); c.fillRect(0, 0, w, h);
    for (let k = 0; k < 30; k++) ell(c, r() * w, r() * h * 0.55, 0.6, 0.6, mix('cream', 'lagoon', 0.2, 1, 0.5 + 0.5 * r()));
    glow(c, w * 0.74, h * 0.3, h * 0.45, mix('cream', 'lagoon', 0.3, 1, 0.35)); ell(c, w * 0.74, h * 0.3, h * 0.16, h * 0.16, mix('cream', 'cream'));
    ell(c, w * 0.71, h * 0.27, h * 0.04, h * 0.035, mix('cream', 'lagoon', 0.35, 0.85)); ell(c, w * 0.77, h * 0.34, h * 0.03, h * 0.025, mix('cream', 'lagoon', 0.35, 0.85));
    let x = 0; while (x < w) { const bw = h * (0.15 + r() * 0.25), bh = h * (0.12 + r() * 0.2); c.fillStyle = mix('ink', 'dusk', 0.35, 0.85); c.fillRect(x, h * 0.66 - bh, bw - 1, bh); x += bw; }
    c.fillStyle = mix('coral', 'plum', 0.45, 0.8); c.fillRect(0, h * 0.66, w, h * 0.34);
    c.fillStyle = mix('plum', 'dusk', 0.3, 1.2); c.fillRect(0, h * 0.6, w, h * 0.08);
    c.strokeStyle = mix('cream', 'dusk', 0.4, 0.8); c.lineWidth = 1; c.beginPath(); c.moveTo(w * 0.05, h * 0.42); c.quadraticCurveTo(w * 0.3, h * 0.55, w * 0.55, h * 0.42); c.stroke();
    for (let k = 0; k < 5; k++) { const t = (k + 0.5) / 5, lx = w * (0.05 + 0.5 * t), ly = h * (0.42 + 0.13 * 4 * t * (1 - t)) + h * 0.07; glow(c, lx, ly, h * 0.13, mix(k % 2 ? 'coral' : 'amber', 'cream', 0.2, 1, 0.55)); ell(c, lx, ly, h * 0.04, h * 0.05, mix(k % 2 ? 'coral' : 'amber', 'cream', 0.25)); }
    squishy(c, w * 0.62, h * 0.95, h * 0.44, 'amber', 'coral');
  },
  cloudloft(c, w, h, r) {   // dusk-violet to amber, the rising sun, a sea of cloud, the Sunbow
    c.fillStyle = grad(c, 0, h * 0.6, [[0, mix('dusk', 'plum', 0.3, 1.1)], [0.6, mix('coral', 'amber', 0.5)], [1, mix('amber', 'cream', 0.3)]]); c.fillRect(0, 0, w, h * 0.6);
    glow(c, w * 0.72, h * 0.55, h * 0.7, mix('cream', 'amber', 0.3, 1, 0.8)); ell(c, w * 0.72, h * 0.56, h * 0.14, h * 0.14, mix('cream', 'amber', 0.2));
    for (let l = 0; l < 3; l++) for (let k = 0; k < 9; k++) { const cx = (k / 8) * w + (r() - 0.5) * h * 0.3, cy = h * (0.6 + l * 0.14), cr = h * (0.12 + r() * 0.1);
      ell(c, cx, cy, cr * 1.3, cr, l === 0 ? mix('cream', 'dusk', 0.35, 0.92) : mix('cream', 'dusk', 0.08 + l * 0.08, 1 - l * 0.03)); }
    c.lineWidth = Math.max(2, h * 0.07);
    for (const [k, tkn] of [[0, 'amber'], [1, 'coral'], [2, 'lagoon']] as const) { c.strokeStyle = mix(tkn, 'cream', 0.15); c.beginPath(); c.arc(w * 0.28, h * 0.85, h * (0.34 - k * 0.07), Math.PI, 0); c.stroke(); }
    squishy(c, w * 0.52, h * 0.95, h * 0.44, 'coral', 'dusk');
  },
};

/** Draw place `id`'s postcard into `canvas` (its CSS box times the pixel ratio unless width / height are given). False for an id without one. */
export function drawPostcard(canvas: HTMLCanvasElement, id: string, opts: { width?: number; height?: number; dpr?: number } = {}): boolean {
  const fn = DRAW[id];
  if (!fn) return false;
  const dpr = Math.max(1, Math.min(3, opts.dpr ?? (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
  const cw = Math.max(16, Math.round(opts.width ?? (canvas.clientWidth || 240))), ch = Math.max(12, Math.round(opts.height ?? (canvas.clientHeight || 56)));
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  const c = canvas.getContext('2d');
  if (!c) return false;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, cw, ch);
  let seed = 0; for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  fn(c, cw, ch, seeded(seed));
  return true;
}
