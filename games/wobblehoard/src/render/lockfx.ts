// LOCK markers (_spec/LOCK.md sections 2.5 and 3): a thin ring at each locked lobe, so a lobe that is held in place reads as LOCKED and not just stretched.
//   * StageLike.setLockMarkers(points): the shell hands the world point of every locked patch (at most 6) every sim step while there are locks, and once with
//     an empty list when the last one goes. The array is the shell's own and is rewritten in place: it is read here, never kept.
//   * One pooled camera-facing sprite per marker (6), one shared canvas texture (a dark soft halo under a pale ring, so it reads on a light jelly and on a dark one),
//     no allocation per frame. The ring is small (a finger's width on the lobe), drawn over the jelly (no depth test: a locked lobe is one the player just
//     pulled, it faces the camera), and it never moves with the lobe's wobble faster than the lobe itself does (it IS the lobe's patch).
//   * It is a GLOW, never a flash (DESIGN 6.6): eased in over 0.15 s and out over 0.25 s, a fixed opacity (it breathes by 6 % at 0.8 Hz, far below any flash
//     threshold), and calm effects draw it still and softer (no breathing, 60 % opacity). For a second after a granted ceremony flash it stays low (the stage's
//     govK, as the cut glows).
import * as THREE from 'three';
import type { V3 } from '../contracts.ts';

export const MAX_LOCK_MARKERS = 6;
const IN_S = 0.15;
const OUT_S = 0.25;
const OPACITY = 0.9;
const CALM_OPACITY = 0.55;
const BREATH = 0.06;
const BREATH_HZ = 0.8;
/** ring diameter as a share of the body's rest radius */
const SIZE_R = 0.42;

/** The ring texture: a soft dark halo, a pale ring, a tiny centre dot. 64 x 64, made once. */
function ringTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, 64, 64);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(40,24,64,0.34)'; g.lineWidth = 8; g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,248,236,0.96)'; g.lineWidth = 3.4; g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,248,236,0.9)'; g.beginPath(); g.arc(32, 32, 3.2, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export class LockFx {
  readonly group = new THREE.Group();
  /** CSS-independent: how many markers are visible now (eased amount above a hair); the dev readout */
  shown = 0;
  /** how many points the shell asked for in its last call */
  wanted = 0;
  private readonly tex: THREE.Texture | null;
  private readonly sprites: THREE.Sprite[] = [];
  private readonly mats: THREE.SpriteMaterial[] = [];
  private readonly amt = new Float32Array(MAX_LOCK_MARKERS);
  private readonly want = new Uint8Array(MAX_LOCK_MARKERS);
  private clock = 0;

  constructor() {
    this.tex = ringTexture();
    this.group.visible = false;
    for (let i = 0; i < MAX_LOCK_MARKERS; i++) {
      const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0, toneMapped: false });
      const s = new THREE.Sprite(m);
      s.renderOrder = 40 + i * 0.01;
      s.visible = false;
      s.frustumCulled = false;
      this.mats.push(m); this.sprites.push(s);
      this.group.add(s);
    }
  }

  /** The shell's call: the world points of the locked patches (the first `wanted` are drawn, the rest fade out where they were). */
  set(points: ArrayLike<V3> | null | undefined): void {
    const n = points ? Math.min(MAX_LOCK_MARKERS, points.length) : 0;
    this.wanted = n;
    for (let i = 0; i < MAX_LOCK_MARKERS; i++) {
      if (i < n) {
        const p = points![i];
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) { this.sprites[i].position.set(p.x, p.y, p.z); this.want[i] = 1; } else this.want[i] = 0;
      } else this.want[i] = 0;
    }
  }

  /** Per frame. `rest` = the play body's rest radius; `govK` the stage's glow factor (0.35 for a second after a granted flash); `calm` = calm effects. */
  update(dt: number, rest: number, govK: number, calm: boolean): void {
    if (!(dt > 0) || !Number.isFinite(dt)) dt = 0;
    this.clock += dt;
    const breath = calm ? 1 : 1 + BREATH * Math.sin(this.clock * Math.PI * 2 * BREATH_HZ);
    const size = SIZE_R * (Number.isFinite(rest) && rest > 0 ? rest : 0.5) * breath;
    const cap = (calm ? CALM_OPACITY : OPACITY) * Math.min(1, Math.max(0, Number.isFinite(govK) ? govK : 1));
    let shown = 0;
    for (let i = 0; i < MAX_LOCK_MARKERS; i++) {
      const goal = this.want[i];
      let a = this.amt[i];
      if (goal > a) a += Math.min(goal - a, dt / IN_S); else if (goal < a) a -= Math.min(a - goal, dt / OUT_S);
      this.amt[i] = a;
      const s = this.sprites[i];
      if (a <= 0.004) { if (s.visible) s.visible = false; continue; }
      shown++;
      s.visible = true;
      // eased: smoothstep of the amount; the ring grows from 0.7 to 1 as it appears
      const e = a * a * (3 - 2 * a);
      s.scale.setScalar(size * (0.7 + 0.3 * e));
      this.mats[i].opacity = cap * e;
    }
    this.shown = shown;
    this.group.visible = shown > 0;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    this.tex?.dispose();
    this.group.clear();
  }
}
