// GENESIS — prophets and signs, seen (LIVING §3.4, §3.6, hook H4: "a prophet marker (flags2.prophet) … sacred places
// and the sacred animal on the map"). The creature's place as the god's lever went to people and to the world itself;
// this layer shows them in the world, quietly — the god's marks are light, never icons:
//
//   a prophet        a thread of warm light standing up from their head into the sky (brighter with their
//                    credibility: a discredited prophet's thread is faint), a slow ring of motes over the head and a
//                    little light falling on them, so one person reads in a crowd; from the god's height the thread
//                    and a point of light at its foot still find them when their body is a speck
//   the Called       a single soft glint over the head, near the camera only
//   a sacred place   by its kind (sim god/sacred.ts: spring, grove, mountain, site): a seam of light round it on the
//                    ground with a pulse running round (not under a grove's leaves), motes rising (a spring's pale and
//                    watery, a grove's green-gold from its crowns), rings of light on a spring's water, soft lights
//                    high in a grove's crowns, a light on the peak (a mountain), and a faint beacon thread that reads
//                    on the map from far away and steps back up close; a shrine the people raise there is their
//                    building
//   a sacred animal  the revered species near the town that keeps it: a faint glint over each beast's back and a
//                    little light on it — subtle: it is still a real animal, life-size
//   moments          an omen read in a town (a ring of light spreading through it — warm where they read favour, a
//                    cold violet where they read anger), a lightning strike made a sign (the struck place left glowing,
//                    light lingering over it), a prophet called (a column of light coming down onto them), a prophecy
//                    fulfilled, a place hallowed, a beast taken for holy, a prophet's death (their thread lifting away)
// Data: the agents' `flags2` (AgentFlag2.prophet / called), SettlementView.prophet / .sacred, the sim's events
// (sacred.place, sacred.animal, omen, lightning with data.omen, prophet.called / .fulfilled / .died) and the `sacred`
// query for the places
// that were holy before this view was made (polled now and then: the snapshot does not carry them).

import { Group, Vector3, type IUniform } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import type { SimEvent } from '../../sim/types.ts';
import { AgentFlag2 } from '../../sim/types.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { BASE_PACK } from '../../data/index.ts';
import { DECAL, decal, type DecalPass } from '../fx/decals.ts';
import { SYS, type Vfx } from '../fx/vfx.ts';
import { clamp01, fxHash, smooth } from '../fx/fxcommon.ts';
import { Marks } from './marks.ts';

/** a sacred place as the sim's `sacred` query and `sacred.place` event give it */
export interface SacredPlaceView {
  id: number;
  planet: number;
  pos: [number, number, number];
  /** 'spring' | 'grove' | 'mountain' | 'site' */
  kind: string;
  settlement: number;
  by?: string;
}

export interface SignsFrame {
  pv: PlanetView;
  camBody: Vector3;
  /** the FX clock (with the sim) and real seconds (the marks breathe in real time: a paused world still shows them) */
  now: number;
  real: number;
  decals: DecalPass;
  vfx: Vfx;
  /** ticks since the agents' snapshot (movers extrapolate by it) */
  ticksSinceSnap: number;
  /** a drawn person's feet (body m) and height, or null when the crowds did not draw them this frame */
  personAt: (id: number) => [number, number, number, number] | null;
  /** the sim's queries (the `sacred` places); absent: the events alone */
  query?: (q: string) => Promise<unknown>;
}

/** a sacred place's look by kind: its light, the radius of its seam of light, its motes */
export const PLACE_LOOK: Record<string, { col: [number, number, number]; ring: number; motes: number; lift: number }> = {
  spring: { col: [0.42, 0.82, 1.0], ring: 9, motes: 1, lift: 0.4 },
  grove: { col: [0.86, 0.96, 0.5], ring: 26, motes: 1.4, lift: 10 },
  mountain: { col: [1.0, 0.9, 0.66], ring: 16, motes: 0.6, lift: 4 },
  site: { col: [1.0, 0.84, 0.52], ring: 8, motes: 0.7, lift: 1 },
};

const PROPHET_COL: [number, number, number] = [1.0, 0.8, 0.46];
const FAVOUR_COL: [number, number, number] = [1.0, 0.82, 0.48];
const ANGER_COL: [number, number, number] = [0.62, 0.52, 1.0];
const ANIMAL_COL: [number, number, number] = [1.0, 0.9, 0.62];

/** the animal content index of a sacred animal's id (its own id, or an old id it replaced: `aliases`) — -1 none */
export function animalIndex(id: string | undefined): number {
  if (!id) return -1;
  const list = (BASE_PACK as unknown as { animals?: { id: string; aliases?: string[] }[] }).animals ?? [];
  const i = list.findIndex((a) => a.id === id);
  return i >= 0 ? i : list.findIndex((a) => (a.aliases ?? []).includes(id));
}

/** the prophets and the Called of a mover block: [index, flags2] of each marked person */
export function markedPeople(flags2: ArrayLike<number> | undefined, count: number): [number, number][] {
  const out: [number, number][] = [];
  if (!flags2) return out;
  const want = AgentFlag2.prophet | AgentFlag2.called;
  for (let i = 0; i < count; i++) if (flags2[i] & want) out.push([i, flags2[i]]);
  return out;
}

interface Moment {
  kind: 'hallowed' | 'omen' | 'strike' | 'called' | 'fulfilled' | 'passing';
  p: Vector3;
  t0: number;
  dur: number;
  col: [number, number, number];
  agent: number;
  size: number;
  /** under a canopy (a grove hallowed): no ring on the floor, which would show only as flecks between the leaves */
  canopy?: boolean;
}

const _u = new Vector3(), _g = new Vector3(), _h = new Vector3(), _c = new Vector3(), _e = new Vector3(), _n = new Vector3();

export class SignsLayer {
  readonly group = new Group();
  readonly marks: Marks;
  /** sacred places known (from the query and the events), by id */
  readonly places = new Map<number, SacredPlaceView>();
  /** for probes: what was drawn last frame */
  readonly stats = { prophets: 0, called: 0, places: 0, animals: 0, moments: 0 };
  /** captures: hold every moment (an omen read, a strike, a call) at this age (s) instead of real time; null runs */
  hold: number | null = null;
  private moments: Moment[] = [];
  private motes = new Map<number, number>();
  private polledAt = -1e9;
  private polling = false;

  constructor(fx: Record<string, IUniform>) {
    this.group.name = 'signs';
    this.group.matrixAutoUpdate = false;
    this.marks = new Marks(fx);
    this.group.add(this.marks.group);
  }

  /** the sim's events that are signs (GodFx forwards them) */
  onEvent(e: SimEvent, R: number, real: number): void {
    const p = e.pos ? new Vector3(e.pos[0], e.pos[1], e.pos[2]).normalize().multiplyScalar(R) : null;
    const d = (e.data ?? {}) as Record<string, unknown>;
    switch (e.t) {
      case 'sacred.place': {
        if (typeof d.id === 'number' && e.pos) {
          this.places.set(d.id, { id: d.id, planet: e.planet ?? 0, pos: [e.pos[0], e.pos[1], e.pos[2]], kind: String(d.kind ?? 'site'), settlement: Number(d.settlement ?? -1), by: String(d.by ?? '') });
          const look = PLACE_LOOK[String(d.kind)] ?? PLACE_LOOK.site;
          if (p) this.moments.push({ kind: 'hallowed', p, t0: real, dur: 5, col: look.col, agent: -1, size: look.ring, canopy: d.kind === 'grove' });
        }
        break;
      }
      case 'omen': {
        if (p) this.moments.push({ kind: 'omen', p, t0: real, dur: 6.5, col: d.reading === 'feared' ? ANGER_COL : FAVOUR_COL, agent: -1, size: 220 });
        break;
      }
      case 'lightning': {
        if (p && d.omen) this.moments.push({ kind: 'strike', p, t0: real, dur: 9, col: [1.0, 0.92, 0.78], agent: -1, size: 7 });
        break;
      }
      case 'prophet.called': {
        if (p) this.moments.push({ kind: 'called', p, t0: real, dur: 4.5, col: PROPHET_COL, agent: typeof d.agent === 'number' ? d.agent : -1, size: 3 });
        break;
      }
      case 'prophet.fulfilled': {
        if (p) this.moments.push({ kind: 'fulfilled', p, t0: real, dur: 5, col: FAVOUR_COL, agent: -1, size: 160 });
        break;
      }
      case 'sacred.animal': {
        // a town takes a beast for holy: a soft ring through it, in the sacred animal's own light
        if (p) this.moments.push({ kind: 'fulfilled', p, t0: real, dur: 4.5, col: ANIMAL_COL, agent: -1, size: 120 });
        break;
      }
      case 'prophet.died': {
        // a prophet dies: their thread of light lifts away from the ground and fades into the sky
        if (p) this.moments.push({ kind: 'passing', p, t0: real, dur: 6, col: PROPHET_COL, agent: typeof d.agent === 'number' ? d.agent : -1, size: 3 });
        break;
      }
    }
    if (this.moments.length > 24) this.moments.splice(0, this.moments.length - 24);
  }

  /** the sacred places that were holy before this view (the snapshot does not carry them): asked now and then */
  private poll(f: SignsFrame): void {
    if (!f.query || this.polling || f.real - this.polledAt < 10) return;
    this.polledAt = f.real;
    this.polling = true;
    f.query('sacred').then((r) => {
      const places = (r as { places?: SacredPlaceView[] } | null)?.places;
      if (Array.isArray(places)) {
        const seen = new Set<number>();
        for (const q of places) {
          if (!q || typeof q.id !== 'number' || !Array.isArray(q.pos)) continue;
          seen.add(q.id);
          this.places.set(q.id, { id: q.id, planet: q.planet ?? 0, pos: [q.pos[0], q.pos[1], q.pos[2]], kind: q.kind ?? 'site', settlement: q.settlement ?? -1, by: q.by });
        }
        // (a place the sim no longer lists has lost its holiness: it goes)
        for (const id of [...this.places.keys()]) if (!seen.has(id)) this.places.delete(id);
      }
    }).catch(() => { /* a backend without the query: the events alone */ }).finally(() => { this.polling = false; });
  }

  update(f: SignsFrame): void {
    const pv = f.pv, cam = f.camBody;
    const M = this.marks;
    M.begin();
    this.poll(f);
    const st = this.stats;
    st.prophets = 0; st.called = 0; st.places = 0; st.animals = 0;
    // ── prophets and the Called ──
    const A = pv.agents;
    if (A && A.flags2) {
      for (const [i, fl2] of markedPeople(A.flags2, A.count)) {
        const id = A.id[i];
        const h = this.personFeet(f, i, id, _g);
        const up = _u.copy(_g).normalize();
        const head = _h.copy(_g).addScaledVector(up, h * 1.02);
        const dist = head.distanceTo(cam);
        if (fl2 & AgentFlag2.prophet) {
          st.prophets++;
          let cred = 0.5;
          for (const s of pv.settlements) if (s.prophet && s.prophet.agent === id) { cred = s.prophet.credibility; break; }
          const k = 0.35 + 0.65 * clamp01(cred);
          // the thread: up from the head into the sky, long enough to be found from the god's height
          const len = Math.max(22, Math.min(520, dist * 0.42));
          // (from the god's height a little brighter: it is how they are found among a town's specks)
          M.beams.add(_c.copy(head).addScaledVector(up, 0.15), up, len, 0.14, PROPHET_COL[0], PROPHET_COL[1], PROPHET_COL[2], 1.25 * k * (1 + 0.7 * smooth(120, 400, dist)), cam, id * 0.37);
          // a slow ring of motes over the head (near), a point of light at the head from afar
          if (dist < 220) {
            const e = tangent(up, _e), n = _n.crossVectors(up, e);
            for (let m = 0; m < 6; m++) {
              const a = f.real * 0.7 + (m / 6) * Math.PI * 2;
              const r = 0.32 + 0.04 * Math.sin(f.real * 2 + m);
              const x = head.x + up.x * 0.32 + (e.x * Math.cos(a) + n.x * Math.sin(a)) * r;
              const y = head.y + up.y * 0.32 + (e.y * Math.cos(a) + n.y * Math.sin(a)) * r;
              const z = head.z + up.z * 0.32 + (e.z * Math.cos(a) + n.z * Math.sin(a)) * r;
              M.glints.add(x, y, z, 0.11, PROPHET_COL[0], PROPHET_COL[1], PROPHET_COL[2], (0.45 + 0.25 * Math.sin(f.real * 3 + m * 1.7)) * k);
            }
          }
          // a soft light round the head (near), a point of light marking them from afar
          M.glints.add(head.x + up.x * 0.1, head.y + up.y * 0.1, head.z + up.z * 0.1, Math.max(0.55, dist * 0.007), PROPHET_COL[0], PROPHET_COL[1], PROPHET_COL[2], (0.35 + 0.5 * smooth(120, 300, dist)) * k);
          // a little light falling on them (and on those round them)
          const L = decal(DECAL.light, [_g.x, _g.y, _g.z], 8);
          L.cr = PROPHET_COL[0]; L.cg = PROPHET_COL[1]; L.cb = PROPHET_COL[2]; L.p0 = 8; L.p1 = 140 * k; L.p2 = 3.2; L.p3 = 1.4;
          f.decals.add(L);
        } else if (dist < 160) {
          st.called++;
          const k = 0.35 * (1 - smooth(80, 160, dist)) * (0.75 + 0.25 * Math.sin(f.real * 1.4 + id));
          M.glints.add(head.x + up.x * 0.45, head.y + up.y * 0.45, head.z + up.z * 0.45, Math.max(0.28, dist * 0.004), 0.95, 0.88, 0.7, k);
        }
      }
    }
    // ── sacred places ──
    for (const pl of this.places.values()) {
      if (pl.planet !== pv.id) continue;
      st.places++;
      const look = PLACE_LOOK[pl.kind] ?? PLACE_LOOK.site;
      const g = groundPoint(pv, pl.pos, _g);
      const up = _u.copy(g).normalize();
      const dist = g.distanceTo(cam);
      const [cr, cg, cb] = look.col;
      // the seam of light round it, a pulse running round (the ward's resting seam, in the place's light) — not under a
      // grove's canopy, where a line on the floor shows only as bright flecks in the gaps between the leaves
      if (pl.kind !== 'grove') {
        const ring = decal(DECAL.domeRing, [g.x, g.y, g.z], look.ring * 1.15 + 2);
        ring.cr = cr; ring.cg = cg; ring.cb = cb; ring.p0 = look.ring; ring.p1 = 0.32; ring.p2 = 1; ring.q0 = Math.max(4, look.ring * 0.5);
        f.decals.add(ring);
      }
      // its beacon: faint up close, a thread to find it by from afar
      const kb = 0.12 + 0.78 * smooth(90, 520, dist);
      M.beams.add(_c.copy(g).addScaledVector(up, look.lift * 0.3), up, Math.max(30, Math.min(900, dist * 0.32)), 0.18, cr, cg, cb, kb, cam, pl.id * 1.31);
      if (pl.kind === 'spring') {
        // rings of light spreading on the water, one after another (drawn after the water: a ground decal is under it)
        const lift = _h.copy(g).addScaledVector(up, 0.08);
        for (let j = 0; j < 3; j++) {
          const ph = (f.real / 5 + j / 3) % 1;
          M.ripples.add(lift.x, lift.y, lift.z, look.ring * (0.15 + 1.1 * ph), 0.25 + look.ring * 0.03 * (1 + ph), cr, cg, cb, 0.36 * Math.sin(Math.PI * ph) * (1 - 0.5 * ph));
        }
      } else if (pl.kind === 'mountain') {
        // a light on the peak
        const top = _c.copy(g).addScaledVector(up, look.lift);
        M.glints.add(top.x, top.y, top.z, Math.max(2.2, dist * 0.012), cr, cg, cb, 0.75 + 0.15 * Math.sin(f.real * 0.9 + pl.id));
      } else if (pl.kind === 'grove') {
        // soft lights drifting among the trees, high in the crowns (not a light on the floor: seen through the leaves
        // a lit floor is only a scatter of bright holes)
        const e = tangent(up, _e), n = _n.crossVectors(up, e);
        // (a dozen, each a few pixels at any distance: from the god's height the grove reads as a scatter of lights
        // in one wood, not single lit pixels)
        for (let j = 0; j < 12; j++) {
          const a = fxHash(pl.id, j) * Math.PI * 2 + f.real * 0.05 * (j % 2 ? 1 : -1);
          const rr = look.ring * (0.12 + 0.6 * fxHash(pl.id, j, 1));
          const hh = look.lift * (0.5 + 0.55 * fxHash(pl.id, j, 2)) + Math.sin(f.real * 0.4 + j * 1.9) * 0.8;
          const q = _h.copy(g).addScaledVector(e, Math.cos(a) * rr).addScaledVector(n, Math.sin(a) * rr).addScaledVector(up, hh);
          M.glints.add(q.x, q.y, q.z, Math.max(0.8, dist * 0.0075), cr, cg, cb, 0.55 + 0.2 * Math.sin(f.real * 0.8 + j * 2.3));
        }
      }
      // motes rising there while the camera is near enough to see them
      const want = dist < 1400;
      const em = this.motes.get(pl.id);
      if (want) {
        // (a grove's rise from its crowns: from the floor they would show only through the gaps in the leaves)
        const mo = pl.kind === 'grove' ? _h.copy(g).addScaledVector(up, look.lift) : g;
        const def = {
          sys: SYS.motes, x: mo.x, y: mo.y, z: mo.z, size: pl.kind === 'grove' ? 0.4 : 0.3, life: 7, count: Math.round(70 * look.motes), p0: look.ring * 0.8,
          p1: 0, r: cr, g: cg, b: cb, power: 0.55,
        };
        if (em === undefined || !f.vfx.alive(em)) { const id = f.vfx.emit(def, f.now); if (id) this.motes.set(pl.id, id); }
        else f.vfx.set(em, def);
      } else if (em !== undefined) { f.vfx.stop(em, f.now); this.motes.delete(pl.id); }
    }
    for (const [id, em] of this.motes) if (!this.places.has(id)) { f.vfx.stop(em, f.now); this.motes.delete(id); }
    // ── sacred animals ──
    this.sacredAnimals(f);
    // ── moments ──
    this.stepMoments(f);
    M.end();
  }

  /** a marked person's feet into `out` (drawn where the crowds drew them, else from the snapshot) — returns their height */
  private personFeet(f: SignsFrame, i: number, id: number, out: Vector3): number {
    const d = f.personAt(id);
    if (d) { out.set(d[0], d[1], d[2]); return d[3]; }
    const A = f.pv.agents!;
    const t = f.ticksSinceSnap;
    out.set(A.pos[i * 3] + A.vel[i * 3] * t, A.pos[i * 3 + 1] + A.vel[i * 3 + 1] * t, A.pos[i * 3 + 2] + A.vel[i * 3 + 2] * t).normalize();
    out.multiplyScalar(groundHeight(f.pv.ground, out.x, out.y, out.z) + Math.max(0, A.alt[i]));
    return 1.7 * (A.scale[i] || 1);
  }

  private sacredAnimals(f: SignsFrame): void {
    const pv = f.pv, M = pv.animals, cam = f.camBody;
    if (!M || !M.count) return;
    const R = pv.params.radius;
    const want: { s: number; c: Vector3 }[] = [];
    for (const s of pv.settlements) {
      const k = animalIndex(s.sacred?.animal);
      if (k >= 0) want.push({ s: k, c: new Vector3(s.pos[0], s.pos[1], s.pos[2]).normalize().multiplyScalar(R) });
    }
    if (!want.length) return;
    const near: { i: number; d: number }[] = [];
    const t = f.ticksSinceSnap;
    for (let i = 0; i < M.count; i++) {
      const sp = M.species[i];
      if (!want.some((q) => q.s === sp)) continue;
      _g.set(M.pos[i * 3] + M.vel[i * 3] * t, M.pos[i * 3 + 1] + M.vel[i * 3 + 1] * t, M.pos[i * 3 + 2] + M.vel[i * 3 + 2] * t).normalize().multiplyScalar(R);
      // (near a town that keeps it sacred: the same beast far from them is only a beast)
      if (!want.some((q) => q.s === sp && _g.distanceTo(q.c) <= 2500)) continue;
      const d = _g.distanceTo(cam);
      if (d > 600) continue;
      near.push({ i, d });
    }
    near.sort((a, b) => a.d - b.d);
    const look = (BASE_PACK as unknown as { animals?: { size?: number }[] }).animals ?? [];
    for (const { i, d } of near.slice(0, 12)) {
      const u = _u.set(M.pos[i * 3] + M.vel[i * 3] * t, M.pos[i * 3 + 1] + M.vel[i * 3 + 1] * t, M.pos[i * 3 + 2] + M.vel[i * 3 + 2] * t).normalize();
      const g = groundHeight(pv.ground, u.x, u.y, u.z) + Math.max(0, M.alt[i]);
      const size = (look[M.species[i]]?.size ?? 1) * (M.scale[i] || 1);
      const back = _c.copy(u).multiplyScalar(g + size * 1.05 + 0.25);
      const tw = 0.5 + 0.5 * Math.sin(f.real * 1.1 + fxHash(M.id[i], 3) * 6.28);
      const k = (0.3 + 0.25 * tw) * (1 - smooth(300, 600, d));
      this.marks.glints.add(back.x, back.y, back.z, Math.max(0.3, d * 0.0045), ANIMAL_COL[0], ANIMAL_COL[1], ANIMAL_COL[2], k);
      const L = decal(DECAL.light, [u.x * g, u.y * g, u.z * g], size * 4 + 2);
      L.cr = ANIMAL_COL[0]; L.cg = ANIMAL_COL[1]; L.cb = ANIMAL_COL[2]; L.p0 = size * 4 + 2; L.p1 = 36 * k * (size + 0.5); L.p2 = size + 1.8; L.p3 = 1;
      f.decals.add(L);
      this.stats.animals++;
    }
  }

  private stepMoments(f: SignsFrame): void {
    const cam = f.camBody;
    if (this.hold === null) this.moments = this.moments.filter((m) => f.real - m.t0 < m.dur);
    this.stats.moments = this.moments.length;
    for (const m of this.moments) {
      const age = this.hold !== null ? Math.min(this.hold, m.dur * 0.98) : f.real - m.t0, k = age / m.dur;
      const up = _u.copy(m.p).normalize();
      const g = groundPoint(f.pv, [up.x, up.y, up.z], _g);
      const [cr, cg, cb] = m.col;
      const dist = g.distanceTo(cam);
      const fade = smooth(0, 0.08, k) * (1 - smooth(0.55, 1, k));
      if (m.kind === 'omen' || m.kind === 'fulfilled' || m.kind === 'hallowed') {
        // a ring of light spreading through the place, and a column standing over it for a moment
        if (!m.canopy) {
          const r = m.size * (0.08 + 0.92 * (1 - Math.pow(1 - k, 2)));
          const rp = decal(DECAL.ripple, [g.x, g.y, g.z], r + m.size * 0.2 + 4);
          rp.cr = cr; rp.cg = cg; rp.cb = cb; rp.p0 = r; rp.p1 = Math.max(2, m.size * 0.035); rp.p2 = (m.kind === 'hallowed' ? 0.4 : 0.34) * (1 - k); rp.q0 = Math.max(8, m.size * 0.3);
          f.decals.add(rp);
        }
        this.marks.beams.add(g, up, Math.max(60, Math.min(900, dist * 0.45)), m.size * 0.02 + 0.3, cr, cg, cb, 1.1 * fade, cam, m.t0);
      } else if (m.kind === 'strike') {
        // the struck place glows, light lingers over it and rises (the ring that runs out from it soft and broad: a
        // thin line would show every facet of the ground it crosses when seen low)
        const gl = decal(DECAL.glow, [g.x, g.y, g.z], m.size * 1.6);
        gl.cr = cr; gl.cg = cg; gl.cb = cb; gl.p0 = m.size * 1.4; gl.p1 = 0.5; gl.p2 = 6 * (1 - k) * (1 - k); gl.p3 = m.t0; gl.q0 = m.size;
        f.decals.add(gl);
        const rp = decal(DECAL.ripple, [g.x, g.y, g.z], m.size * 6);
        rp.cr = cr; rp.cg = cg; rp.cb = cb; rp.p0 = m.size * (0.5 + 4.5 * Math.min(1, age / 2.5)); rp.p1 = 3.2; rp.p2 = 0.8 * (1 - smooth(0, 2.5, age)); rp.q0 = 6;
        f.decals.add(rp);
        this.marks.beams.add(g, up, Math.max(40, Math.min(600, dist * 0.4)), 0.5, cr, cg, cb, 1.2 * fade, cam, m.t0);
        for (let j = 0; j < 8; j++) {
          const a = fxHash(m.t0 * 100, j) * Math.PI * 2, rr = fxHash(m.t0 * 100, j, 1) * m.size * 0.8;
          const e = tangent(up, _e), n = _n.crossVectors(up, e);
          const hh = ((age * (1.5 + fxHash(m.t0 * 100, j, 2)) + j * 0.7) % 6);
          const q = _h.copy(g).addScaledVector(e, Math.cos(a) * rr).addScaledVector(n, Math.sin(a) * rr).addScaledVector(up, 1 + hh * 2.5);
          this.marks.glints.add(q.x, q.y, q.z, Math.max(0.25, dist * 0.003), cr, cg, cb, 0.7 * fade * (1 - hh / 6));
        }
      } else if (m.kind === 'called') {
        // a column of light coming down onto the one the god called
        const d = m.agent >= 0 ? f.personAt(m.agent) : null;
        if (d) _g.set(d[0], d[1], d[2]);
        const top = Math.max(80, Math.min(700, dist * 0.5));
        const down = smooth(0, 0.35, age / m.dur);
        const foot = _c.copy(_g).addScaledVector(up, top * (1 - down));
        this.marks.beams.add(foot, up, top * down + top * 0.05, 0.6, cr, cg, cb, 1.0 * fade, cam, m.t0);
        const L = decal(DECAL.light, [_g.x, _g.y, _g.z], 14);
        L.cr = cr; L.cg = cg; L.cb = cb; L.p0 = 14; L.p1 = 260 * fade * down; L.p2 = 6; L.p3 = 2;
        f.decals.add(L);
      } else if (m.kind === 'passing') {
        // the thread lifts off the ground where they fell and rises away, thinning
        const top = Math.max(80, Math.min(700, dist * 0.5));
        const rise = smooth(0.1, 1, k);
        const foot = _c.copy(_g).addScaledVector(up, top * rise * 0.8 + 1.5);
        this.marks.beams.add(foot, up, top * (1 - 0.6 * rise), 0.25, cr, cg, cb, 1.1 * fade, cam, m.t0);
        this.marks.glints.add(foot.x, foot.y, foot.z, Math.max(0.6, dist * 0.006), cr, cg, cb, 0.8 * fade);
      }
    }
  }

  dispose(): void { this.marks.dispose(); }
}

/** the ground under unit vector u (or the water surface over it), body m, into out */
function groundPoint(pv: PlanetView, u: ArrayLike<number>, out: Vector3): Vector3 {
  out.set(u[0], u[1], u[2]).normalize();
  let g = groundHeight(pv.ground, out.x, out.y, out.z);
  const water = pv.fields.get('water'), surf = pv.fields.get('surface');
  if (water && surf) {
    const w = pv.grid.sample(water, out.x, out.y, out.z);
    if (w > 0.02) g = Math.max(g, pv.params.radius + pv.grid.sample(surf, out.x, out.y, out.z) + w);
  }
  return out.multiplyScalar(g);
}

/** a unit tangent at `up` */
function tangent(up: Vector3, out: Vector3): Vector3 {
  out.set(0, 1, 0).cross(up);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0).cross(up);
  return out.normalize();
}
