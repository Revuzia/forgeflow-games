/// <reference types="vite/client" />
// HIT PARADE - the sidestep clip played BY THE SIM'S STEP PROGRESS (CHANGED(fix_view) D6). Presentation only.
//
// The sim moves a SIDESTEP along the §35.15 quadratic ease-out (13 / 25 / 36 / 46 / 56 / 64 % of the arc at step frames
// 1-6, all 15 frames) while the baked `sidestep_*` clip's legs travel on their own S-curve (clips.json `rootLat`:
// 6 / 12 / 19 / 26 / 34 / 42 % at the same frames when sampled at animFrame / 60). Sampled linearly, the planted foot
// skates up to ~0.19 m in the first six frames. Here the clip time for step frame k is the time at which the clip's OWN
// lateral travel reaches the sim's progress p(k) (inverse of the rootLat curve), so the stride lands where the root does.
// The stride LENGTH differs too (clip rootLat end = 0.90 m x the body's hip ratio: johnny 0.824, bruno 0.962, freak 1.028
// vs the sim arc: system.json step.distM 0.85 or the fighter's own `step.distM`, CONTRACT §35.20 fix_core): `strideScale`
// = sim arc / clip travel feeds the leg IK (view/legik.ts) that scales the feet's lateral offsets so planted feet stay put.
// data/clips/*.clips.json are read RAW here (core/data.ts normalises clips without `rootLat`); same modules as the sim's
// own import.meta.glob, so nothing is bundled twice.

const RAW = import.meta.glob('../../../data/clips/*.clips.json', { eager: true, import: 'default' }) as Record<string, unknown>;

/** the shared bake's normalised lateral curve (every body: 8 frames at 30 fps, measured from clips.json) - fallback only */
const SHAPE_T = [0, 1 / 30, 2 / 30, 3 / 30, 4 / 30, 5 / 30, 6 / 30, 7 / 30];
const SHAPE_Q = [0, 0.1229, 0.2611, 0.4156, 0.5958, 0.7514, 0.8808, 1];

export interface LatCurve { t: number[]; q: number[]; len: number }
export interface StepFacts {
  frames: number;
  /** frames the ease-out runs over (round(frames x movePct / 100)) */
  fm: number;
  /** this fighter's sim arc (m) */
  distM: number;
  lat: Record<string, LatCurve>;
}

function rawClips(id: string): Record<string, unknown> | null {
  for (const k of Object.keys(RAW)) {
    if (!k.endsWith('/' + id + '.clips.json')) continue;
    const f = RAW[k] as { clips?: Record<string, unknown> } | null;
    if (!f || typeof f !== 'object') return null;
    return (f.clips && typeof f.clips === 'object' ? f.clips : f) as Record<string, unknown>;
  }
  return null;
}

function num(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }

/** the step facts for one fighter: system.json `step` + the fighter's own `step.distM` + its clips' lateral curves */
export function stepFactsFor(id: string, def: unknown, system: unknown): StepFacts {
  const st = ((system as { step?: Record<string, unknown> } | null)?.step ?? {}) as Record<string, unknown>;
  const frames = Math.max(2, Math.trunc(num(st.frames, 15)));
  const fm = Math.max(1, Math.round((frames * num(st.movePct, 100)) / 100));
  const own = (def as { step?: { distM?: unknown } } | null)?.step?.distM;
  const distM = num(own, num(st.distM, 0.85));
  const lat: Record<string, LatCurve> = {};
  const rc = rawClips(id);
  for (const c of ['sidestep_l', 'sidestep_r']) {
    const rows = (rc?.[c] as { rootLat?: unknown } | undefined)?.rootLat;
    if (Array.isArray(rows) && rows.length >= 2) {
      const t: number[] = [], d: number[] = [];
      for (const r of rows) if (Array.isArray(r) && r.length >= 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1]))) { t.push(Number(r[0])); d.push(Math.abs(Number(r[1]))); }
      const len = d.length ? d[d.length - 1] : 0;
      if (t.length >= 2 && len > 0.05) {
        // monotone (a bake may wobble by a millimetre): running max, normalised
        let m = 0;
        lat[c] = { t, q: d.map((x) => (m = Math.max(m, x)) / len), len };
        continue;
      }
    }
    lat[c] = { t: SHAPE_T, q: SHAPE_Q, len: 0 };
  }
  return { frames, fm, distM, lat };
}

/** the sim's arc progress 0..1 at step frame k (snapshot `step.frame`, 1 = the entry frame) - compile.ts stepCurveOf */
export function stepProgress(f: StepFacts, k: number): number {
  const t = Math.min(1, Math.max(0, k) / f.fm);
  return 1 - (1 - t) * (1 - t);
}

/** clip seconds at which the clip's own lateral travel reaches progress p (0..1), clamped to [0, dur] */
export function clipTimeAt(f: StepFacts, clip: string, p: number, dur: number): number {
  const c = f.lat[clip];
  if (!c) return Math.max(0, Math.min(dur, p * dur));
  const { t, q } = c;
  if (p <= 0) return 0;
  let out = t[t.length - 1];
  for (let i = 1; i < q.length; i++) {
    if (p <= q[i]) {
      const span = q[i] - q[i - 1];
      out = span > 1e-6 ? t[i - 1] + (t[i] - t[i - 1]) * ((p - q[i - 1]) / span) : t[i];
      break;
    }
  }
  // the clip's rows are baked to `dur`; rescale if the GLB's clip is a little longer / shorter
  const end = t[t.length - 1];
  return Math.max(0, Math.min(dur, end > 0 ? out * (dur / end) : out));
}

/** sim arc / clip travel for a sidestep clip (1 = unknown: no stride correction) */
export function strideScale(f: StepFacts, clip: string): number {
  const c = f.lat[clip];
  if (!c || !(c.len > 0.05) || !(f.distM > 0.05)) return 1;
  return f.distM / c.len;
}
