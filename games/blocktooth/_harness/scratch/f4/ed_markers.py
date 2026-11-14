import sys
p = 'src/ui/markers.ts'
s = open(p, encoding='utf-8').read()
def rep(a, b):
    global s
    if a not in s:
        print('MISSING:', a[:80]); sys.exit(1)
    s = s.replace(a, b)

rep("""// The bottom inset is 15u, not 3u: the bottom HUD band (status card, ability bar, UPROAR meter, ACTIVE
// panel) reaches 14.7u up and draws over this layer, so an arrow clamped at 3u would be hidden under it
// (seen at 1920×1080: a RELIEF DEPOT arrow behind the status card).
""", """// HUD keep-out (F4 critic fix): markers never sit on a HUD panel. The panels' boxes are known in `u`
// from their CSS anchors (styles.css / hud_v2.css, measured in Chrome at 1280×720 by
// _harness/scratch/l8/hudcheck.py): WARD-7 bug, top-right counters + the live objective-tracker rows,
// the boss nameplate while it is up, the status card, the bottom-centre UPROAR meter + ability bar, the
// zoom hint + ACTIVE panel and the ticker. They are rebuilt in px on resize and when the tracker row
// count / boss plate changes (class-only DOM queries at 4 Hz, never a layout read). Every marker box
// (edge arrow: disc + pointer + distance; on-screen: the label chip, width estimated from its text) that
// meets a panel is moved by the smallest displacement that clears every panel and stays in view.
""")
rep("""const MAX = 12;
const INSET_U = 3;
const INSET_BOTTOM_U = 15;
const TEXT_PERIOD_MS = 250;
""", """const MAX = 12;
const INSET_U = 3;
const INSET_BOTTOM_U = 4.6;       // clear of the ticker (2.35u); the panels above it are keep-out boxes
const TEXT_PERIOD_MS = 250;
const HUD_PERIOD_MS = 250;
const PAD_U = 0.45;               // breathing room around each HUD panel

/** A HUD panel box in u: x from the left edge (ax 'l'), the right edge ('r') or the centre ('c'); y from the top ('t') or the bottom ('b'). */
export interface HudBox { ax: 'l' | 'r' | 'c'; x0: number; x1: number; ay: 't' | 'b'; y0: number; y1: number }
/** Static panels (on whenever the HUD is). */
export const HUD_BOXES: readonly HudBox[] = [
  { ax: 'l', x0: 1.6, x1: 23.1, ay: 't', y0: 1.4, y1: 3.7 },          // WARD-7 bug + clock
  { ax: 'r', x0: 1.6, x1: 21.2, ay: 't', y0: 1.4, y1: 5.1 },          // TONNAGE / BLOCKS / CRUSHED
  { ax: 'l', x0: 1.6, x1: 24.7, ay: 'b', y0: 3.9, y1: 14.8 },         // status card
  { ax: 'c', x0: -20.4, x1: 20.4, ay: 'b', y0: 3.3, y1: 10.0 },       // UPROAR meter (+ tab) + ability bar
  { ax: 'r', x0: 1.6, x1: 18.7, ay: 'b', y0: 3.3, y1: 11.0 },         // ACTIVE panel + zoom hint
  { ax: 'l', x0: 0, x1: 1000, ay: 'b', y0: 0, y1: 2.4 },              // ticker
];
/** objective tracker: right 1.6u, 17.1u wide, first row top 6.4u, 2.42u pitch per live row */
const TRACK = { x1: 17.2, top: 6.3, pitch: 2.42 };
/** boss nameplate: centred 44u, top 1.3u, ≈ 6.5u tall */
const BOSS = { half: 22.2, top: 1.2, h: 6.6 };

/**
 * Pure keep-out solver (exported for the probe): move the box [x-l, y-t, x+r, y+b] off every rect with
 * the smallest displacement that keeps the anchor inside [minX, maxX] × [minY, maxY]; a candidate that
 * clears every rect beats one that lands on a neighbour. Rects are [x0, y0, x1, y1] px. ≤ 3 passes.
 */
export function keepOut(x: number, y: number, l: number, t: number, r: number, b: number, rects: readonly (readonly number[])[],
  minX: number, maxX: number, minY: number, maxY: number, out: { x: number; y: number }): { x: number; y: number } {
  const hit = (px: number, py: number): number => {
    for (let i = 0; i < rects.length; i++) {
      const R = rects[i];
      if (px + r > R[0] && px - l < R[2] && py + b > R[1] && py - t < R[3]) return i;
    }
    return -1;
  };
  let cx = x, cy = y;
  for (let pass = 0; pass < 3; pass++) {
    const i = hit(cx, cy);
    if (i < 0) break;
    const R = rects[i];
    let bx = NaN, by = NaN, bd = Infinity, bestFree = false;
    for (let k = 0; k < 4; k++) {
      // just left / right / above / below the rect
      const px = k === 0 ? R[0] - r - 0.5 : k === 1 ? R[2] + l + 0.5 : cx;
      const py = k === 2 ? R[1] - b - 0.5 : k === 3 ? R[3] + t + 0.5 : cy;
      if (px < minX - 0.5 || px > maxX + 0.5 || py < minY - 0.5 || py > maxY + 0.5) continue;
      const free = hit(px, py) < 0;
      const d = Math.abs(px - cx) + Math.abs(py - cy);
      if ((free && !bestFree) || (free === bestFree && d < bd)) { bx = px; by = py; bd = d; bestFree = free; }
    }
    if (!Number.isFinite(bx)) break;
    cx = bx; cy = by;
  }
  out.x = cx; out.y = cy;
  return out;
}
const _ko = { x: 0, y: 0 };
""")
rep("""  textT: number;
  distTxt: string;
}""", """  textT: number;
  distTxt: string;
  nameLen: number;          // label length (chars) for the chip-width estimate
}""")
rep("""  private u = unitPx();

  constructor(root: HTMLElement) {
    const L = this.layer""", """  private u = unitPx();
  private readonly root: HTMLElement;
  private rects: number[][] = [];
  private hudT = -1e9;
  private trackRows = -1;
  private bossOn = false;

  constructor(root: HTMLElement) {
    this.root = root;
    const L = this.layer""")
rep("""textT: 0, distTxt: '' });
    }
    window.addEventListener('resize', () => { this.vw = window.innerWidth; this.vh = window.innerHeight; this.u = unitPx(); });
  }""", """textT: 0, distTxt: '', nameLen: 8 });
    }
    window.addEventListener('resize', () => { this.vw = window.innerWidth; this.vh = window.innerHeight; this.u = unitPx(); this.rects = []; this.hudT = -1e9; });
  }

  /** ≤ 4 Hz: live tracker rows + boss plate (class-only DOM queries), then the keep-out rects in px. */
  private refreshHud(now: number): void {
    if (now - this.hudT < HUD_PERIOD_MS) return;
    this.hudT = now;
    let rows = 0;
    const trk = this.root.querySelector('.bt-v2track');
    if (trk && !trk.classList.contains('bt-hidden')) rows = trk.querySelectorAll('.bt-trow:not(.off)').length;
    const bl = this.root.querySelector('.bt-bossbar');
    const boss = !!bl && !bl.classList.contains('bt-hidden');
    if (rows === this.trackRows && boss === this.bossOn && this.rects.length) return;
    this.trackRows = rows; this.bossOn = boss;
    const u = this.u, W = this.vw, H = this.vh, p = PAD_U * u;
    const out: number[][] = [];
    for (const B of HUD_BOXES) {
      const x0 = B.ax === 'l' ? B.x0 * u : B.ax === 'r' ? W - B.x1 * u : W / 2 + B.x0 * u;
      const x1 = B.ax === 'l' ? Math.min(W, B.x1 * u) : B.ax === 'r' ? W - B.x0 * u : W / 2 + B.x1 * u;
      const y0 = B.ay === 't' ? B.y0 * u : H - B.y1 * u;
      const y1 = B.ay === 't' ? B.y1 * u : H - B.y0 * u;
      out.push([x0 - p, y0 - p, x1 + p, y1 + p]);
    }
    if (rows > 0) out.push([W - TRACK.x1 * u - p, TRACK.top * u - p, W - 1.6 * u + p, (TRACK.top + rows * TRACK.pitch) * u + p]);
    if (boss) out.push([W / 2 - BOSS.half * u - p, BOSS.top * u - p, W / 2 + BOSS.half * u + p, (BOSS.top + BOSS.h) * u + p]);
    this.rects = out;
  }

  /** The keep-out rects in px (test hook: window.__BT__ can read them through the app). */
  hudRects(): readonly (readonly number[])[] { return this.rects; }""")
rep("""    const now = performance.now();
    const inset = INSET_U * this.u;""", """    const now = performance.now();
    this.refreshHud(now);
    const u = this.u;
    const inset = INSET_U * u;
    const minY = inset, maxY = this.vh - INSET_BOTTOM_U * u;""")
rep("""        m.chipN.textContent = L.name;
        m.textT = 0;""", """        m.chipN.textContent = L.name;
        m.nameLen = L.name.length;
        m.textT = 0;""")
rep("""      if (edge) {
        x = Math.max(inset, Math.min(this.vw - inset, x));
        y = Math.max(inset, Math.min(this.vh - INSET_BOTTOM_U * this.u, y));
        const a = Number.isFinite(it.angle) ? it.angle : 0;
        if (Math.abs(a - m.r) > 0.01 || !Number.isFinite(m.r)) { m.r = a; m.ptr.style.transform = `rotate(${a.toFixed(3)}rad)`; }
      }""", """      if (edge) {
        x = Math.max(inset, Math.min(this.vw - inset, x));
        y = Math.max(minY, Math.min(maxY, y));
        const a = Number.isFinite(it.angle) ? it.angle : 0;
        if (Math.abs(a - m.r) > 0.01 || !Number.isFinite(m.r)) { m.r = a; m.ptr.style.transform = `rotate(${a.toFixed(3)}rad)`; }
        // disc r 1.3u + pointer to 2.3u in any direction; the distance tag reaches 2.5u below
        keepOut(x, y, 2.4 * u, 2.4 * u, 2.4 * u, 2.6 * u, this.rects, inset, this.vw - inset, minY, maxY, _ko);
        x = _ko.x; y = _ko.y;
      } else {
        // the chip hangs 0.9u under the anchor and is ≈ 1.7u tall; width from the label + distance text
        const hw = 0.5 * (m.nameLen * 0.62 + 7.5) * u;
        keepOut(x, y, hw, 0, hw, 2.7 * u, this.rects, hw, this.vw - hw, 0, this.vh - 2.7 * u, _ko);
        x = _ko.x; y = _ko.y;
      }""")
open(p, 'w', encoding='utf-8').write(s)
print('ok')
