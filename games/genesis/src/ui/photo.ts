// GENESIS — photo mode (CONTRACT.md §15.8 "photo (free camera, UI hidden, DOF/exposure/filters/frame, capture PNG)";
// P, or the camera modes menu). The camera flies free, the interface and the portal's control bar go away, time stands
// still (unless let run), and a small panel holds the lens: focal length, focus (click the world to focus there), depth
// blur, exposure, bloom, vignette, grain, roll; a colour filter; a frame (screen, 16:9, cinema 2.39:1, portrait 4:5,
// square, tall 9:16) with composition guides; the sun's hour; and the shutter. H hides the panel for a clean look.
//
// The picture is the rendered frame (no interface), cropped to the frame, graded by the filter, and — where the renderer
// draws no depth of field yet (src/ui/host.ts RenderCameraModes.dof) — given a tilt-shift band of focus at the focus
// distance's row, the same band the screen previews with a backdrop blur. It is saved as a PNG named for the world and
// its date, and the last few stay in a strip on the panel.

import type { PhotoLens, UiHost } from './host.ts';
import { h, clear, download } from './dom.ts';
import { icon } from './icons.ts';
import { slider, toggle } from './panel.ts';

export const FILTERS: { id: string; name: string; css: string }[] = [
  { id: 'none', name: 'None', css: '' },
  { id: 'warm', name: 'Warm', css: 'sepia(0.16) saturate(1.12) hue-rotate(-5deg)' },
  { id: 'cool', name: 'Cool', css: 'saturate(0.9) hue-rotate(9deg) brightness(1.02)' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.35) contrast(1.08)' },
  { id: 'faded', name: 'Faded', css: 'contrast(0.84) saturate(0.76) brightness(1.07)' },
  { id: 'moon', name: 'Moonlight', css: 'saturate(0.5) hue-rotate(16deg) brightness(0.92) contrast(1.12)' },
  { id: 'sepia', name: 'Old print', css: 'sepia(0.78) contrast(1.06) brightness(0.96)' },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.3) brightness(0.95)' },
];

export const FRAMES: { id: string; name: string; ratio: number | null }[] = [
  { id: 'free', name: 'Screen', ratio: null },
  { id: '16:9', name: '16:9', ratio: 16 / 9 },
  { id: '2.39:1', name: 'Cinema', ratio: 2.39 },
  { id: '4:5', name: 'Portrait', ratio: 4 / 5 },
  { id: '1:1', name: 'Square', ratio: 1 },
  { id: '9:16', name: 'Tall', ratio: 9 / 16 },
];

export const GUIDES: { id: string; name: string }[] = [
  { id: 'none', name: 'None' }, { id: 'thirds', name: 'Thirds' }, { id: 'golden', name: 'Golden' }, { id: 'centre', name: 'Centre' },
];

export function defaultLens(fov = 50): PhotoLens {
  return { exposure: 0, fov, focus: 220, blur: 0, filter: 'none', frame: 'free', guides: 'thirds', bloom: 1, vignette: 0.22, grain: 0.02, roll: 0 };
}

/** 35 mm-equivalent focal length of a vertical field of view (a 24 mm-tall frame) */
const focal = (fovDeg: number): number => 12 / Math.tan((fovDeg * Math.PI) / 360);
const fovOf = (mm: number): number => (2 * Math.atan(12 / mm) * 180) / Math.PI;

export interface PhotoDeps {
  host: UiHost;
  /** the game's canvas (the filter previews on it) */
  canvas: HTMLCanvasElement;
  /** the sun's hour at the camera now, and set it (the world's clock: time.set-hour) */
  hour(): number;
  dayHours(): number;
  setHour(h: number): void;
}

interface Shot { blob: Blob; thumb: string; name: string }

export class Photo {
  readonly layer: HTMLDivElement;
  readonly panel: HTMLDivElement;
  private deps: PhotoDeps;
  private host: UiHost;
  private mask: HTMLDivElement[];
  private guides: SVGSVGElement;
  private dof: HTMLDivElement;
  private flash: HTMLDivElement;
  private mark: HTMLDivElement;
  private hint: HTMLDivElement;
  private body: HTMLDivElement;
  private strip: HTMLDivElement;
  private status: HTMLDivElement;
  private shots: Shot[] = [];
  private active = false;
  private panelOn = true;
  private bandY = -1;
  private bandAt = 0;
  private bandFocus = -1;
  private pinUntil = 0;
  private hintUntil = 0;
  private sliders = new Map<string, HTMLDivElement & { setValue?: (v: number) => void }>();
  private busy = false;
  /** the last picture (test surface): its file name, size in pixels, bytes */
  last: { name: string; w: number; h: number; bytes: number } | null = null;

  constructor(parent: HTMLElement, deps: PhotoDeps) {
    this.deps = deps;
    this.host = deps.host;
    this.layer = h('div', { class: 'gn-ui gn-photo-layer' });
    this.layer.hidden = true;
    this.mask = [0, 1, 2, 3].map(() => h('div', { class: 'gn-ph-mask' }));
    this.guides = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.guides.setAttribute('class', 'gn-ph-guides');
    this.dof = h('div', { class: 'gn-ph-dof' });
    this.flash = h('div', { class: 'gn-ph-flash' });
    this.mark = h('div', { class: 'gn-ph-mark' });
    this.hint = h('div', { class: 'gn-ph-hint' });
    this.body = h('div', { class: 'gn-ph-body' });
    this.strip = h('div', { class: 'gn-ph-strip' });
    this.status = h('div', { class: 'gn-ph-status', role: 'status', aria: { live: 'polite' } });
    const shutter = h('button', { class: 'gn-btn gn-btn-gold gn-ph-shutter', on: { click: () => void this.capture() } }, h('span', { html: icon('camera') }), 'Take the picture');
    const close = h('button', { class: 'gn-btn gn-win-close', title: 'Leave photo mode', aria: { label: 'Leave photo mode' }, html: icon('close'), on: { click: () => this.host.cam?.photo(false) } });
    this.panel = h('div', { class: 'gn-panel gn-ph-panel', role: 'dialog', aria: { label: 'Photo mode' } },
      h('div', { class: 'gn-ph-head' }, h('span', { class: 'gn-ph-icon', html: icon('camera') }), h('div', { class: 'gn-ph-title', text: 'Photo' }), close),
      this.body, h('div', { class: 'gn-ph-foot' }, shutter, this.status, this.strip));
    this.panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.layer.append(...this.mask, this.dof, this.guides, this.mark, this.flash, this.hint, this.panel);
    parent.appendChild(this.layer);
  }

  get isActive(): boolean { return this.active; }
  private lens(): PhotoLens { return this.host.cam!.lens(); }
  private set(p: Partial<PhotoLens>): void { this.host.cam!.setLens(p); this.sync(); }

  /** the camera entered photo mode */
  enter(): void {
    this.active = true;
    this.layer.hidden = false;
    this.panelOn = true;
    this.panel.hidden = false;
    this.bandY = -1;
    this.bandFocus = -1;
    this.render();
    this.sync();
    this.showHint(5000);
  }

  /** the camera left photo mode */
  leave(): void {
    this.active = false;
    this.layer.hidden = true;
    this.deps.canvas.style.filter = '';
  }

  private showHint(ms: number): void {
    const kb = this.host.keybinds;
    const k = (id: string, d: string) => kb.hint(id) || d;
    this.hint.textContent = `drag to look · W A S D move · ${k('cam.tiltUp', 'R')} ${k('cam.tiltDown', 'F')} rise and sink · wheel zoom · click to focus · ${k('photo.capture', 'Space')} take the picture · ${k('photo.panel', 'H')} ${this.panelOn ? 'hide' : 'show'} the panel · ${k('photo.exit', 'P')} leave`;
    this.hintUntil = performance.now() + ms;
  }

  /** a photo-mode action (keys and the pad, src/ui/keybinds.ts context 'photo'); true when handled */
  action(id: string): boolean {
    const L = this.lens();
    const fi = (list: { id: string }[], cur: string) => list[(list.findIndex((x) => x.id === cur) + 1) % list.length].id;
    switch (id) {
      case 'photo.capture': void this.capture(); return true;
      case 'photo.exit': this.host.cam?.photo(false); return true;
      case 'photo.focusNear': this.set({ focus: Math.max(0.5, L.focus / 1.25) }); return true;
      case 'photo.focusFar': this.set({ focus: Math.min(20000, L.focus * 1.25) }); return true;
      case 'photo.blurLess': this.set({ blur: Math.max(0, Math.round((L.blur - 0.1) * 10) / 10) }); return true;
      case 'photo.blurMore': this.set({ blur: Math.min(1, Math.round((L.blur + 0.1) * 10) / 10) }); return true;
      case 'photo.exposureDown': this.set({ exposure: Math.max(-3, Math.round((L.exposure - 0.2) * 10) / 10) }); return true;
      case 'photo.exposureUp': this.set({ exposure: Math.min(3, Math.round((L.exposure + 0.2) * 10) / 10) }); return true;
      case 'photo.zoomIn': this.set({ fov: Math.max(6, L.fov / 1.15) }); return true;
      case 'photo.zoomOut': this.set({ fov: Math.min(100, L.fov * 1.15) }); return true;
      case 'photo.filter': this.set({ filter: fi(FILTERS, L.filter) }); this.render(); this.say(`Filter: ${FILTERS.find((f) => f.id === this.lens().filter)?.name}`); return true;
      case 'photo.frame': this.set({ frame: fi(FRAMES, L.frame) }); this.render(); this.say(`Frame: ${FRAMES.find((f) => f.id === this.lens().frame)?.name}`); return true;
      case 'photo.panel': this.panelOn = !this.panelOn; this.panel.hidden = !this.panelOn; this.showHint(this.panelOn ? 2500 : 4000); return true;
      case 'photo.time': this.host.cam?.freeze(!this.host.cam.frozen()); this.render(); this.say(this.host.cam?.frozen() ? 'Time stands still.' : 'Time runs.'); return true;
    }
    return false;
  }

  /** a click on the world in photo mode: focus there */
  focusAt(x: number, y: number): void {
    const d = this.host.cam?.depthAt(x, y);
    if (d == null) { this.say('The sky: nothing there to focus on.'); return; }
    this.set({ focus: Math.max(0.5, d) });
    this.bandY = y;
    this.bandFocus = this.lens().focus;
    this.bandAt = performance.now();
    this.pinUntil = this.bandAt + 1200;
    this.mark.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -50%)`;
    this.mark.classList.remove('gn-on');
    void this.mark.offsetWidth;
    this.mark.classList.add('gn-on');
  }

  private say(t: string): void {
    this.status.textContent = t;
  }

  // ───────────────────────────── the panel ─────────────────────────────

  private render(): void {
    const L = this.lens();
    const cam = this.host.cam;
    clear(this.body);
    this.sliders.clear();
    const row = (label: string, key: string, el: HTMLElement) => {
      if (key) this.sliders.set(key, el as HTMLDivElement);
      return h('div', { class: 'gn-ph-row' }, h('span', { class: 'gn-ph-l', text: label }), el);
    };
    const chips = (list: { id: string; name: string }[], cur: string, on: (id: string) => void) => {
      const w = h('div', { class: 'gn-ph-chips' });
      for (const x of list) w.append(h('button', { class: `gn-ph-chip${x.id === cur ? ' gn-on' : ''}`, text: x.name, on: { click: () => { on(x.id); this.host.sound('ui.tick'); this.render(); } } }));
      return w;
    };
    const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m >= 10 ? Math.round(m) : m.toFixed(1)} m`);
    const day = this.deps.dayHours();
    this.body.append(
      h('div', { class: 'gn-ph-sec', text: 'Lens' }),
      row('Focal length', 'fov', slider({ min: 14, max: 400, step: 1, log: true, value: focal(L.fov), fmt: (v) => `${Math.round(v)} mm`, on: (v) => this.set({ fov: fovOf(v) }) })),
      row('Focus', 'focus', slider({ min: 0.5, max: 20000, step: 0, log: true, value: L.focus, fmt: fmtDist, on: (v) => this.set({ focus: v }) })),
      row('Depth blur', 'blur', slider({ min: 0, max: 1, step: 0.05, value: L.blur, fmt: (v) => (v ? `${Math.round(v * 100)}%` : 'off'), on: (v) => this.set({ blur: v }) })),
      h('div', { class: 'gn-ph-note', text: cam?.realDof() ? 'Click the world to focus there.' : 'Click the world to focus there: a band of sharpness at that distance.' }),
      h('div', { class: 'gn-ph-sec', text: 'Light' }),
      row('Exposure', 'exposure', slider({ min: -3, max: 3, step: 0.1, value: L.exposure, fmt: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} EV`, on: (v) => this.set({ exposure: v }) })),
      row('Bloom', 'bloom', slider({ min: 0, max: 3, step: 0.05, value: L.bloom, fmt: (v) => `${Math.round(v * 100)}%`, on: (v) => this.set({ bloom: v }) })),
      row('Vignette', 'vignette', slider({ min: 0, max: 0.8, step: 0.02, value: L.vignette, fmt: (v) => `${Math.round(v * 125)}%`, on: (v) => this.set({ vignette: v }) })),
      row('Grain', 'grain', slider({ min: 0, max: 0.12, step: 0.005, value: L.grain, fmt: (v) => `${Math.round(v * 833)}%`, on: (v) => this.set({ grain: v }) })),
      row('Roll', 'roll', slider({ min: -35, max: 35, step: 0.5, value: L.roll, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`, on: (v) => this.set({ roll: v }) })),
      h('div', { class: 'gn-ph-sec', text: 'Look' }),
      chips(FILTERS, L.filter, (id) => this.set({ filter: id })),
      h('div', { class: 'gn-ph-sec', text: 'Frame' }),
      chips(FRAMES, L.frame, (id) => this.set({ frame: id })),
      chips(GUIDES, L.guides, (id) => this.set({ guides: id })),
      h('div', { class: 'gn-ph-sec', text: 'Time' }),
      h('div', { class: 'gn-ph-row' }, h('span', { class: 'gn-ph-l', text: 'Freeze time' }), toggle(!!cam?.frozen(), (on) => cam?.freeze(on), 'Freeze time')),
      row('Sun', 'hour', slider({ min: 0, max: day, step: day / 288, value: this.deps.hour(), fmt: (v) => { const hh = Math.floor(v), mm = Math.floor((v - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }, on: (v) => this.deps.setHour(v) })),
      h('div', { class: 'gn-ph-note', text: 'The sun moves the world\'s own clock.' }));
  }

  /** the panel's sliders follow the lens (keys and the pad change it too), the screen follows the look */
  private sync(): void {
    const L = this.lens();
    const s = this.sliders;
    s.get('fov')?.setValue?.(focal(L.fov));
    s.get('focus')?.setValue?.(L.focus);
    s.get('blur')?.setValue?.(L.blur);
    s.get('exposure')?.setValue?.(L.exposure);
    s.get('bloom')?.setValue?.(L.bloom);
    s.get('vignette')?.setValue?.(L.vignette);
    s.get('grain')?.setValue?.(L.grain);
    s.get('roll')?.setValue?.(L.roll);
    this.deps.canvas.style.filter = FILTERS.find((f) => f.id === L.filter)?.css ?? '';
  }

  // ───────────────────────────── per frame ─────────────────────────────

  /** the frame's rectangle on screen (CSS px) */
  frameRect(W = window.innerWidth, H = window.innerHeight): { x: number; y: number; w: number; h: number } {
    const r = FRAMES.find((f) => f.id === this.lens().frame)?.ratio ?? null;
    if (!r) return { x: 0, y: 0, w: W, h: H };
    if (W / H > r) { const w = H * r; return { x: (W - w) / 2, y: 0, w, h: H }; }
    const hh = W / r;
    return { x: 0, y: (H - hh) / 2, w: W, h: hh };
  }

  /** the screen row where the ground is at the focus distance (down the middle of the frame); −1 for none */
  private focusRow(): number {
    const cam = this.host.cam;
    if (!cam) return -1;
    const L = this.lens();
    const f = this.frameRect();
    const x = f.x + f.w / 2;
    let prevY = -1, prevD = -1, horizon = -1;
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const y = f.y + (f.h * i) / N;
      const d = cam.depthAt(x, y);
      if (d == null) continue;
      if (horizon < 0) horizon = y;
      // the ground comes nearer down the frame: the focus lies between the row before (farther) and this one
      if (prevD >= 0 && prevD >= L.focus && d <= L.focus) {
        const t = (prevD - L.focus) / Math.max(1e-6, prevD - d);
        return prevY + (y - prevY) * t;
      }
      prevY = y; prevD = d;
    }
    if (horizon < 0) return f.y + f.h * 0.5;
    // nearer than the nearest ground in view: the bottom; farther than the farthest: the horizon
    return prevD >= 0 && L.focus < prevD ? f.y + f.h : horizon;
  }

  frame(): void {
    if (!this.active) return;
    const L = this.lens();
    const W = window.innerWidth, H = window.innerHeight;
    const f = this.frameRect(W, H);
    // the frame: dim bars outside it
    const [t, b, l, r] = this.mask;
    const set = (e: HTMLElement, x: number, y: number, w: number, hh: number) => { e.style.left = `${x}px`; e.style.top = `${y}px`; e.style.width = `${Math.max(0, w)}px`; e.style.height = `${Math.max(0, hh)}px`; };
    set(t, 0, 0, W, f.y); set(b, 0, f.y + f.h, W, H - f.y - f.h); set(l, 0, f.y, f.x, f.h); set(r, f.x + f.w, f.y, W - f.x - f.w, f.h);
    // the guides
    const g = this.guides;
    g.style.left = `${f.x}px`; g.style.top = `${f.y}px`; g.style.width = `${f.w}px`; g.style.height = `${f.h}px`;
    g.setAttribute('viewBox', `0 0 ${f.w.toFixed(0)} ${f.h.toFixed(0)}`);
    const key = `${L.guides}|${f.w.toFixed(0)}|${f.h.toFixed(0)}`;
    if (g.dataset.key !== key) {
      g.dataset.key = key;
      const lines: string[] = [];
      const v = (x: number) => lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${f.h}"/>`);
      const hz = (y: number) => lines.push(`<line x1="0" y1="${y}" x2="${f.w}" y2="${y}"/>`);
      if (L.guides === 'thirds') { v(f.w / 3); v((2 * f.w) / 3); hz(f.h / 3); hz((2 * f.h) / 3); }
      if (L.guides === 'golden') { v(f.w * 0.382); v(f.w * 0.618); hz(f.h * 0.382); hz(f.h * 0.618); }
      if (L.guides === 'centre') { const c = Math.min(f.w, f.h) * 0.04; lines.push(`<line x1="${f.w / 2 - c}" y1="${f.h / 2}" x2="${f.w / 2 + c}" y2="${f.h / 2}"/>`, `<line x1="${f.w / 2}" y1="${f.h / 2 - c}" x2="${f.w / 2}" y2="${f.h / 2 + c}"/>`); }
      g.innerHTML = lines.join('');
    }
    // the depth of field the renderer cannot draw yet: a tilt-shift band of focus at the focus distance's row
    const fallback = L.blur > 0.001 && !this.host.cam?.realDof();
    this.dof.hidden = !fallback;
    if (fallback) {
      // the band follows the camera (re-found every ~⅓ s and whenever the focus changes); a click holds it where it
      // was clicked for a moment
      const now = performance.now();
      if (now > this.pinUntil && (this.bandY < 0 || now - this.bandAt > 350 || this.bandFocus !== L.focus)) {
        this.bandY = this.focusRow();
        this.bandAt = now;
        this.bandFocus = L.focus;
      }
      const band = this.band(f.h, H);
      const y = (this.bandY - f.y) / f.h;
      const pct = (v: number) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(2)}%`;
      const grad = `linear-gradient(to bottom, #000 0%, #000 ${pct(y - band.w - band.f)}, transparent ${pct(y - band.w)}, transparent ${pct(y + band.w)}, #000 ${pct(y + band.w + band.f)}, #000 100%)`;
      const d = this.dof.style;
      d.left = `${f.x}px`; d.top = `${f.y}px`; d.width = `${f.w}px`; d.height = `${f.h}px`;
      d.setProperty('backdrop-filter', `blur(${band.px.toFixed(1)}px)`);
      d.setProperty('-webkit-backdrop-filter', `blur(${band.px.toFixed(1)}px)`);
      d.setProperty('mask-image', grad);
      d.setProperty('-webkit-mask-image', grad);
    }
    this.hint.hidden = performance.now() > this.hintUntil;
  }

  /** the tilt-shift band: half-width and feather as fractions of the frame, blur radius in px for a frame `fh` tall */
  private band(fh: number, screenH: number): { w: number; f: number; px: number } {
    const b = this.lens().blur;
    const w = 0.3 - 0.23 * b;
    return { w, f: w * 0.85 + 0.03, px: b * 11 * (fh / Math.max(1, screenH)) * (screenH / 720) };
  }

  // ───────────────────────────── the picture ─────────────────────────────

  /** take the picture: the raw frame, cropped, graded, focused; saved as a PNG; returns its file name */
  async capture(): Promise<string | null> {
    const cam = this.host.cam;
    if (!cam || this.busy) return null;
    this.busy = true;
    this.say('…');
    try {
      const url = await cam.grab();
      const img = await loadImage(url);
      const L = this.lens();
      const W = window.innerWidth, H = window.innerHeight;
      const f = this.frameRect(W, H);
      // CSS px → canvas pixels
      const sx = img.width / W, sy = img.height / H;
      const cx = Math.round(f.x * sx), cy = Math.round(f.y * sy), cw = Math.round(f.w * sx), ch = Math.round(f.h * sy);
      const out = document.createElement('canvas');
      out.width = cw; out.height = ch;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('no 2D canvas');
      const css = FILTERS.find((x) => x.id === L.filter)?.css || 'none';
      ctx.filter = css;
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
      if (L.blur > 0.001 && !cam.realDof()) {
        if (this.bandY < 0) this.bandY = this.focusRow();
        const band = this.band(f.h, H);
        const px = band.px * sy;
        const m = Math.ceil(px * 2.5);
        // the blurred picture, drawn with a margin (no dark edge from the blur's border), kept outside the band
        const bl = document.createElement('canvas');
        bl.width = cw + 2 * m; bl.height = ch + 2 * m;
        const b = bl.getContext('2d')!;
        b.filter = `${css === 'none' ? '' : `${css} `}blur(${px.toFixed(1)}px)`;
        const x0 = Math.max(0, cx - m), y0 = Math.max(0, cy - m), x1 = Math.min(img.width, cx + cw + m), y1 = Math.min(img.height, cy + ch + m);
        b.drawImage(img, x0, y0, x1 - x0, y1 - y0, m - (cx - x0), m - (cy - y0), x1 - x0, y1 - y0);
        b.filter = 'none';
        b.globalCompositeOperation = 'destination-in';
        const y = (this.bandY - f.y) / f.h;
        const gr = b.createLinearGradient(0, m, 0, m + ch);
        const stop = (v: number, a: number) => gr.addColorStop(Math.max(0, Math.min(1, v)), `rgba(0,0,0,${a})`);
        stop(0, 1); stop(y - band.w - band.f, 1); stop(y - band.w, 0); stop(y + band.w, 0); stop(y + band.w + band.f, 1); stop(1, 1);
        b.fillStyle = gr;
        b.fillRect(0, 0, bl.width, bl.height);
        ctx.filter = 'none';
        ctx.drawImage(bl, m, m, cw, ch, 0, 0, cw, ch);
      }
      const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, 'image/png'));
      if (!blob) throw new Error('the picture could not be encoded');
      const name = this.fileName();
      download(name, blob, 'image/png');
      this.last = { name, w: cw, h: ch, bytes: blob.size };
      // the strip: a small copy, the full picture kept for another download
      const th = document.createElement('canvas');
      th.height = 54; th.width = Math.round((54 * cw) / ch);
      th.getContext('2d')?.drawImage(out, 0, 0, th.width, th.height);
      this.shots.unshift({ blob, thumb: th.toDataURL('image/jpeg', 0.8), name });
      this.shots.splice(6);
      this.renderStrip();
      // the shutter: a flash and its sound
      this.flash.classList.remove('gn-on');
      void this.flash.offsetWidth;
      this.flash.classList.add('gn-on');
      this.host.sound('photo.shutter');
      this.say(`Saved ${name}`);
      return name;
    } catch (e) {
      this.say(`The picture could not be taken: ${e instanceof Error ? e.message : String(e)}`);
      this.host.sound('ui.error');
      return null;
    } finally { this.busy = false; }
  }

  private renderStrip(): void {
    clear(this.strip);
    for (const s of this.shots) {
      const b = h('button', { class: 'gn-ph-shot', title: `Download ${s.name} again` }, h('img', { src: s.thumb, alt: s.name }));
      b.addEventListener('click', () => download(s.name, s.blob, 'image/png'));
      this.strip.append(b);
    }
  }

  private fileName(): string {
    const v = this.host.view;
    const pv = v.planet(this.host.primary());
    const c = pv ? v.calendar(pv) : null;
    const hh = c ? Math.floor(c.hour) : 0, mm = c ? Math.floor((c.hour - hh) * 60) : 0;
    const when = c ? ` - Year ${c.year} day ${c.day} ${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}` : '';
    return `GENESIS - ${pv?.name ?? 'world'}${when}${this.shots.length ? ` (${this.shots.length + 1})` : ''}.png`.replace(/[^\w\- ().]+/g, '');
  }

  state(): Record<string, unknown> {
    return { active: this.active, panel: this.panelOn, lens: { ...this.lens() }, band: this.bandY, shots: this.shots.length, last: this.last };
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error('the frame could not be read'));
    i.src = url;
  });
}
