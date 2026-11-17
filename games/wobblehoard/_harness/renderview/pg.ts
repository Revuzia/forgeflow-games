/// <reference types="vite/client" />
// PLAYGROUND render scenarios for the render viewer (PG_RENDER; window.__RV__.pg). Each returns plain numbers (and PNGs as data URLs) for
// _harness/browser_render.mjs's sections `emote`, `pose`, `homeview` (RD-04, RD-05, RD-06, RD-09, RD-10, RD-11, RD-12, RD-14, RD-16).
// Deterministic: bodies are stepped by the caller's fixed dt; nothing reads wall time except the two cost rows (RD-05, RD-06).
import * as THREE from 'three';
import type { StageDev } from '../../src/render/stageDev.ts';
import type { SoftBodyLike } from '../../src/contracts.ts';
import type { Genome } from '../../src/core/genome.ts';
import { CATALOG, speciesBaseGenome as baseGenome, type SpeciesId } from '../../src/data/catalog.ts';
const speciesBaseGenome = (id: string, seed: number): Genome => baseGenome(id as SpeciesId, seed);
import { Emotes, type EmoteFrame } from '../../src/render/emotes.ts';
import { StubBody } from '../../src/render/stubBody.ts';
import HOME from '../../src/data/place_home.ts';
import CABIN from '../../src/data/place_hearthlog.ts';
import RIPPLE from '../../src/data/place_ripple.ts';
import FROST from '../../src/data/place_frostbell.ts';
import RAIN from '../../src/data/place_rainleaf.ts';
import type { PlaceDef } from '../../src/data/places.ts';
import { physPieces, type PhysPieces } from './physPieces.ts';
import { wholeRefFor } from '../../src/render/wholeRef.ts';
import { placeBand } from '../../src/render/placeview.ts';
/** The shipped and S2 places the render chunks draw (their data modules: both layouts). */
const PLACES: Record<string, PlaceDef> = { hearthlog: CABIN, ripple: RIPPLE, frostbell: FROST, rainleaf: RAIN };

export interface PgEnv {
  stage: StageDev;
  canvas: HTMLCanvasElement;
  makeBody(g: Genome): SoftBodyLike;
  /** Step these bodies n times (drain their events), advance the viewer's clock and update the stage; render the last frame when asked. */
  tick(bodies: SoftBodyLike[], n: number, dt?: number, render?: boolean): void;
  snapshot(): string;
  timeRender(n: number): number;
}

/** The HUD insets the Home spots were laid with (PLAYGROUND_BUILD 11.13): 390 x 844 and 1280 x 800. */
export const PG_INSETS = { phone: { top: 151, right: 60, bottom: 170, left: 16 }, desktop: { top: 120, right: 24, bottom: 150, left: 24 } };

export function makePg(E: PgEnv) {
  const S = E.stage;
  let PP: PhysPieces | null = null;   // (round 3: PHYS's pure piece builder, made on first use)
  let bodies: SoftBodyLike[] = [];
  let ids: number[] = [];
  const W = (): number => E.canvas.clientWidth || E.canvas.width, H = (): number => E.canvas.clientHeight || E.canvas.height;
  const pv = new THREE.Vector3();
  const toPx = (x: number, y: number, z: number): [number, number] => { pv.set(x, y, z).project(S.camera); return [(pv.x * 0.5 + 0.5) * W(), (1 - (pv.y * 0.5 + 0.5)) * H()]; };
  /** A species whose base genome's body has a rest radius nearest r (scale = r / 0.5). */
  const bySize = new Map<number, string>();
  function speciesOfRadius(r: number): string {
    if (bySize.has(r)) return bySize.get(r)!;
    let best = CATALOG[0].id, bd = Infinity;
    for (const d of CATALOG) { const b = new StubBody(speciesBaseGenome(d.id, 1)); const e = Math.abs(b.restRadius - r); if (e < bd) { bd = e; best = d.id; } }
    bySize.set(r, best); return best;
  }
  const familyOf = (fam: string): string => (CATALOG.find((d) => d.family === fam) ?? CATALOG[0]).id;

  const pg = {
    /** Load the lazy LIFE look (bubbles, Home's things). */
    async load(): Promise<boolean> { await S.loadLifeLook(); return !!S.emotes && !!S.homeKit; },
    insets(kind: 'phone' | 'desktop'): void { S.setSafeInsets(PG_INSETS[kind]); },
    /** n bodies out on the mat at matLayout(n), the first species sets the body scale; settled. Returns the view ids. */
    party(species: string[], n: number, settle = 150): number[] {
      S.clearBodies();
      bodies = []; ids = [];
      const g0 = speciesBaseGenome(species[0], 1);
      const b0 = E.makeBody(g0);
      S.addBody!(b0, g0, { tier: 'common' });
      bodies.push(b0); ids.push(S.primaryBodyId()!);
      const pos = S.matLayout(n);
      for (let k = 1; k < n; k++) {
        const g = speciesBaseGenome(species[k % species.length], 1 + k), b = E.makeBody(g);
        ids.push(S.addBody!(b, g, { tier: 'common', position: pos[k] }));
        bodies.push(b);
      }
      E.tick(bodies, settle, 1 / 60, false);
      return ids.slice();
    },
    /** RD-14: with the autonomy framing on, a body that moves by itself (a slide with no finger) never moves the camera; off, it does. */
    cameraAutonomy(species: string[], n = 3, kind?: 'phone' | 'desktop'): { onMax: number; offMax: number; onLens: number; onScale: number; offLens: number; offScale: number } {
      // (round 3: with the shell's HUD rows reported the PC's SR2 band framer runs too; its lens shift and camera scale are part of "the camera")
      if (kind) pg.insets(kind);
      const run = (on: boolean): number[] => {
        pg.party(species, n, 60);
        S.setAutonomyFraming!(on);
        E.tick(bodies, 240, 1 / 60, false);
        const p0 = S.camera.position.clone(), i0 = S.info, l0x = i0.lens.x, l0y = i0.lens.y, c0 = i0.camScale;
        const b = bodies[n > 1 ? 1 : 0];
        let mx = 0, ml = 0, ms = 0;
        // the body slides and hops by itself (no finger, no grab: LIFE's kind of motion)
        for (let i = 0; i < 180; i++) {
          if (i % 30 === 0) b.nudge({ x: 0.9, y: i % 60 === 0 ? 0.8 : 0, z: 0.5 });
          E.tick(bodies, 1, 1 / 60, false);
          const inf = S.info;
          mx = Math.max(mx, S.camera.position.distanceTo(p0)); ml = Math.max(ml, Math.abs(inf.lens.x - l0x), Math.abs(inf.lens.y - l0y)); ms = Math.max(ms, Math.abs(inf.camScale - c0));
        }
        S.setAutonomyFraming!(false);
        return [mx, ml, ms];
      };
      const on = run(true), off = run(false);
      return { onMax: on[0], onLens: on[1], onScale: on[2], offMax: off[0], offLens: off[1], offScale: off[2] };
    },
    /**
     * Round 3 (MERGE_PC doubt 3): a party of two wholes and a third squishy cut in two TRUE pieces (PHYS's builder through the stub), the
     * autonomy framing on, the HUD rows of `kind`: (a) the slots the views count at (the two pieces share one), (b) visibleTable's box against
     * the same party uncut (the group takes the place of the whole: the rest framing is the same), (c) a piece that moves by itself (no finger)
     * moves neither the camera, the lens shift nor the camera scale; (d) a party of ONE cut squishy whose pieces move by themselves (the PC's
     * piece-group framing at its slot). Pieces are added after the wholes, as the shell does at a cut (it removes the whole and adds them).
     */
    pieceSlots(kind: 'phone' | 'desktop'): { slots: number[]; boxUncut: number[]; boxCut: number[]; boxErr: number; move: number[]; solo: number[]; soloOff: number[]; png: string } {
      pg.insets(kind);
      PP ??= physPieces();
      const sp = ['dollop', 'twangle', 'chunkle'];
      const g2 = speciesBaseGenome(sp[2], 3);
      const pos = S.matLayout(3);
      const build = (cut: boolean, others: boolean): { ids: number[]; pieces: SoftBodyLike[] } => {
        S.clearBodies(); bodies = [];
        const out: number[] = [], pieces: SoftBodyLike[] = [];
        if (others) for (let k = 0; k < 2; k++) { const g = speciesBaseGenome(sp[k], 1 + k), b = E.makeBody(g); out.push(S.addBody!(b, g, { tier: 'common', position: k ? pos[1] : undefined })); bodies.push(b); }
        const at = others ? pos[2] : { x: 0, y: 0, z: 0 };
        if (!cut) { const b = new StubBody(g2, { rest: PP!, piece: { frac: 1, chunk: false, at: { x: 0, y: 0, z: 0 } } }); out.push(S.addBody!(b, g2, { tier: 'common', position: at })); bodies.push(b); }
        else {
          const c = PP!.cut(g2, { x: 1, y: 0, z: 0 }, 0);
          if ('refused' in c) throw new Error('cut refused: ' + c.refused);
          for (const sd of [c.a, c.b]) { const b = new StubBody(g2, { rest: PP!, piece: { frac: sd.frac, region: sd.region, at: { x: sd.rest.offset.x, y: sd.rest.offset.y, z: sd.rest.offset.z } } }); out.push(S.addBody!(b, g2, { tier: 'common', position: at })); bodies.push(b); pieces.push(b); }
        }
        S.setAutonomyFraming!(true);
        E.tick(bodies, 150, 1 / 60, false);
        return { ids: out, pieces };
      };
      const box = new Float32Array(4);
      build(false, true); S.visibleTable!(box); const boxUncut = Array.from(box);
      const cut = build(true, true); S.visibleTable!(box); const boxCut = Array.from(box);
      const slots = cut.ids.map((id) => S.views.find((v) => v.id === id)!.slotK);
      const boxErr = Math.max(...boxCut.map((v, i) => Math.abs(v - boxUncut[i])));
      const nudge = (ps: SoftBodyLike[]): number[] => {
        const p0 = S.camera.position.clone(), i0 = S.info, lx = i0.lens.x, ly = i0.lens.y, c0 = i0.camScale;
        let mx = 0, ml = 0, ms = 0;
        for (let i = 0; i < 180; i++) {
          if (i % 30 === 0) ps.forEach((b, k) => b.nudge({ x: k ? -0.9 : 0.9, y: i % 60 === 0 ? 0.8 : 0, z: 0.6 }));
          E.tick(bodies, 1, 1 / 60, false);
          const inf = S.info; mx = Math.max(mx, S.camera.position.distanceTo(p0)); ml = Math.max(ml, Math.abs(inf.lens.x - lx), Math.abs(inf.lens.y - ly)); ms = Math.max(ms, Math.abs(inf.camScale - c0));
        }
        return [mx, ml, ms];
      };
      const move = nudge(cut.pieces);
      const png = E.snapshot();
      const solo = build(true, false); const soloMove = nudge(solo.pieces);
      S.setAutonomyFraming!(false);
      const solo2 = build(true, false); S.setAutonomyFraming!(false); E.tick(bodies, 60, 1 / 60, false); const soloOff = nudge(solo2.pieces);
      S.clearBodies(); bodies = [];
      return { slots, boxUncut, boxCut, boxErr, move, solo: soloMove, soloOff, png };
    },
    /**
     * Round 3 (MERGE_PC doubts 1 and 7): the merged jelly program (wh-jelly-v6: the render pose + the cut face) on a whole and on a TRUE piece
     * whose eye straddles the cut (its bead clipped at the live cut face), both leaning and swaying. Measured on the piece: every cut-face vertex
     * of the jelly, posed by the CPU twin of the vertex stage, against the clip plane the bead uses (eFix), against the unposed cut plane HEAD
     * used (eOld), and the unposed vertices against the unposed plane (eUn: the face's own flatness). Screenshots of both.
     */
    posedPiece(species = 'dollop'): { eUn: number; eFix: number; eOld: number; eyes: number; clipped: number; pngWhole: string; pngPiece: string; pngPieceOff: string } {
      PP ??= physPieces();
      const g = speciesBaseGenome(species, 1), wh = PP.whole(g), ref = wholeRefFor({ vertexCount: (wh.restLocal.length / 3) | 0, indices: wh.indices, restLocal: wh.restLocal }, wh.radius, g);
      const ec = ref.eyes[0].centre, n = { x: 1, y: 0, z: 0 }, d = ec.x;   // a plane through the left eye's centre: the bead straddles it
      S.clearBodies(); bodies = [];
      const w = new StubBody(g, { rest: PP, piece: { frac: 1, chunk: false, at: { x: 0, y: 0, z: 0 } } });
      const iw = S.addBody!(w, g, { tier: 'common' }); bodies.push(w);
      S.setBodyPose!(iw, 0.1, 0, 0.05, 1.5, 0); S.setBodyLook!(iw, 0, 0, 0, 0.5, 0);
      E.tick(bodies, 90, 1 / 60, true);
      const pngWhole = E.snapshot();
      const c = PP.cut(g, n, d);
      if ('refused' in c) throw new Error('cut refused: ' + c.refused);
      S.clearBodies(); bodies = [];
      const sd = c.a.frac >= c.b.frac ? c.a : c.b;
      const b = new StubBody(g, { rest: PP, piece: { frac: sd.frac, region: sd.region, at: { x: sd.rest.offset.x, y: sd.rest.offset.y, z: sd.rest.offset.z } } });
      const ip = S.addBody!(b, g, { tier: 'common' }); bodies.push(b);
      E.tick(bodies, 60, 1 / 60, false);
      const pngPieceOff = E.snapshot();
      S.setBodyPose!(ip, 0.1, 0, 0, 0, 0);   // a full lean across the cut face (the largest tilt of its plane)
      E.tick(bodies, 90, 1 / 60, true);
      const pngPiece = E.snapshot();
      const v = S.views.find((x) => x.id === ip)!;
      const eyes = (v.face as unknown as { eyes: { clipCaps: number[]; clipPlanes: THREE.Plane[] }[] }).eyes;
      const eye = eyes.find((e) => e.clipCaps.length > 0);
      const geo = v.jelly.mesh.geometry, P = geo.getAttribute('position'), C = geo.getAttribute('aCap');
      let eUn = 0, eFix = 0, eOld = 0;
      const q = [0, 0, 0];
      if (eye) {
        const cap = v.jelly.caps[eye.clipCaps[0]], pl = eye.clipPlanes[0];
        for (let i = 0; i < P.count; i++) {
          if (C.getX(i) < 0.5) continue;
          const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
          eUn = Math.max(eUn, Math.abs(cap.nx * x + cap.ny * y + cap.nz * z - cap.d));
          v.pose.apply(x, y, z, q, 0);
          eFix = Math.max(eFix, Math.abs(pl.normal.x * q[0] + pl.normal.y * q[1] + pl.normal.z * q[2] + pl.constant));
          eOld = Math.max(eOld, Math.abs(cap.nx * q[0] + cap.ny * q[1] + cap.nz * q[2] - cap.d));
        }
      }
      S.clearBodies(); bodies = [];
      return { eUn, eFix, eOld, eyes: eyes.length, clipped: eye ? 1 : 0, pngWhole, pngPiece, pngPieceOff };
    },
    /**
     * Round 3 (MERGE_PC doubt 4): a place respects Home's HUD band. In `id` with the rows of `kind`: every corner column (ground and 1.25 m top
     * of a body centre at each corner of the bounds) inside the band (rows + Home's margin); then the Cut bar (+90 px on the bottom row, as the
     * shell reports it while the Cut tool is in hand): the camera eases (largest per-frame move of the camera and of its lens), and after 2 s
     * every corner column is inside the NEW band; the bar goes away and the framing comes back to the first one.
     */
    async placeBandRefit(kind: 'phone' | 'desktop', id = 'ripple'): Promise<{ before: number; after: number; back: number; fov: number[]; stepM: number; stepFov: number; png: string }> {
      pg.insets(kind);
      const D = PLACES[id];
      await S.loadPlace!(id); S.setPlace!(id, 0.05);
      const tall = S.camera.aspect < 0.9, b = (tall ? D.tall : D).bounds, hx = b.hx ?? 3, hz = b.hz ?? 2;
      S.setPlayBounds!(b.x, b.z, hx, hz);
      S.clearBodies(); bodies = [];
      E.tick([], 150, 1 / 60, false);
      const worst = (ins: { top: number; right: number; bottom: number; left: number }): number => {
        const B = placeBand(ins, W(), H(), new Float64Array(4));
        let m = Infinity;
        for (const x of [b.x - hx, b.x + hx]) for (const z of [b.z - hz, b.z + hz]) for (const y of [0, 1.25]) { const p = toPx(x, y, z); m = Math.min(m, p[0] - B[3], W() - B[1] - p[0], p[1] - B[0], H() - B[2] - p[1]); }
        return m;
      };
      const ins0 = PG_INSETS[kind], ins1 = { ...ins0, bottom: ins0.bottom + 90 };
      const before = worst(ins0), fov0 = S.camera.fov;
      S.setSafeInsets(ins1);
      let stepM = 0, stepFov = 0, prev = S.camera.position.clone(), pf = S.camera.fov;
      for (let i = 0; i < 120; i++) { E.tick([], 1, 1 / 60, false); stepM = Math.max(stepM, S.camera.position.distanceTo(prev)); stepFov = Math.max(stepFov, Math.abs(S.camera.fov - pf)); prev.copy(S.camera.position); pf = S.camera.fov; }
      const after = worst(ins1), fov1 = S.camera.fov;
      E.tick([], 1, 1 / 60, true);
      const png = E.snapshot();
      S.setSafeInsets(ins0); E.tick([], 150, 1 / 60, false);
      const back = worst(ins0), fov2 = S.camera.fov;
      return { before, after, back, fov: [fov0, fov1, fov2], stepM, stepFov, png };
    },
    /**
     * RD-16: Home in view, at this frame (the page's viewport) with n bodies of body scale `scale`, the autonomy framing on and the given
     * insets: (a) visibleTable's box against the rendered frame (the live camera's ground rows under the inset lines, within 0.05 m),
     * (b) every Home thing whose fromN <= n at its spot (x bodyScale) inside the frame and the insets (its footprint corners at y 0 and at its
     * top), (c) every slot centre inside the corral rectangle (visibleTable united with each slot's body + 0.05 m). Returns a screenshot too.
     */
    homeView(n: number, scale: number, kind: 'phone' | 'desktop', shotIt = false): {
      box: number[]; boxErr: number; things: { id: string; shown: boolean; inView: boolean; worstPx: number }[]; slotsIn: boolean; png: string | null; species: string;
    } {
      pg.insets(kind);
      const sp = speciesOfRadius(0.5 * scale);
      pg.party([sp], n, 30);
      S.setAutonomyFraming!(true);
      E.tick(bodies, 300, 1 / 60, false);   // the camera settles at the rest framing
      const out = new Float32Array(4);
      const ok = S.visibleTable!(out);
      // (a) the rendered frame's ground rows under the inset lines (the live camera at rest, yaw 0)
      S.camera.updateMatrixWorld();
      const ins = PG_INSETS[kind], w = W(), h = H();
      const ground = (sx: number, sy: number): THREE.Vector3 => {
        const v = new THREE.Vector3((sx / w) * 2 - 1, 1 - (sy / h) * 2, 0.5).unproject(S.camera), o = S.camera.position;
        v.sub(o); const t = -o.y / v.y; return t > 0 ? o.clone().addScaledVector(v, t) : new THREE.Vector3(0, 0, -99);
      };
      const nearL = ground(ins.left, h - ins.bottom), nearR = ground(w - ins.right, h - ins.bottom), far = ground(w / 2, ins.top);
      const cl = (v: number): number => Math.max(-3.4, Math.min(3.4, v));
      const boxErr = ok ? Math.max(Math.abs(cl(nearL.x) - out[0]), Math.abs(cl(nearR.x) - out[2]), Math.abs(cl(nearL.z) - out[3]), Math.abs(cl(far.z) - out[1])) : 99;
      // (b) Home's things at their spots for this frame
      const bs = bodies[0].restRadius / 0.5;
      const tall = S.camera.aspect < 0.9;
      const sizes: Record<string, [number, number, number]> = { feltball: [0.22, 0.44, 0.22], musicbox: [0.2, 0.3, 0.15], snoozerug: [0.7, 0.01, 0.7], warmlamp: [0.2, 0.6, 0.2], keepsakeshelf: [0.6, 0.45, 0.15] };
      const things: { id: string; shown: boolean; inView: boolean; worstPx: number }[] = [];
      HOME.things.forEach((t, i) => {
        if (t.id === 'bouncepad') return;
        const spot = tall ? HOME.tall.things[i] : t;
        const fromN = (tall ? HOME.tall.things[i].fromN : t.fromN) ?? 1;
        const shown = n >= fromN;
        const x = spot.x * bs, z = spot.z * bs;
        S.setHomeThing!(i, shown, x, z, spot.yaw);
        if (!shown) { things.push({ id: t.id, shown, inView: true, worstPx: 0 }); return; }
        const [hx, hy, hz] = sizes[t.id];
        let worst = 0;
        for (const cx of [-hx, hx]) for (const cz of [-hz, hz]) for (const cy of [0, hy]) {
          const [px, py] = toPx(x + cx, cy, z + cz);
          worst = Math.max(worst, ins.left - px, px - (w - ins.right), ins.top - py, py - (h - ins.bottom));
        }
        things.push({ id: t.id, shown, inView: worst <= 0, worstPx: worst });
      });
      // (c) the slots inside the corral rectangle
      const pos = S.matLayout(n);
      let x0 = out[0], z0 = out[1], x1 = out[2], z1 = out[3];
      for (const p of pos) { const r = 0.5 * bs + 0.05; x0 = Math.min(x0, p.x - r); x1 = Math.max(x1, p.x + r); z0 = Math.min(z0, p.z - r); z1 = Math.max(z1, p.z + r); }
      const slotsIn = pos.every((p) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1);
      E.tick(bodies, 30, 1 / 60, false);
      const png = shotIt ? E.snapshot() : null;
      for (let i = 0; i < 6; i++) S.setHomeThing!(i, false, 0, 0, 0);
      S.setAutonomyFraming!(false);
      return { box: Array.from(out), boxErr, things, slotsIn, png, species: sp };
    },
    /** RD-04 / RD-09: a sheet of 8 icons (page 0..2), or the styles (page 3: say, think, group with dots, the badge, the still dot), over the table. */
    iconSheet(page: number, calm: boolean, kind: 'phone' | 'desktop'): { png: string; drawn: number; draws: number } {
      S.clearBodies(); bodies = [];
      pg.insets(kind);
      E.tick([], 2, 1 / 60, false);
      const em = new Emotes();
      S.scene.add(em.mesh);
      const anchors: number[][] = [];
      const cam = S.camera; cam.updateMatrixWorld();
      for (let i = 0; i < 8; i++) {
        const col = i % 4, row = (i / 4) | 0;
        const sx = 0.2 + 0.2 * col, sy = 0.38 + 0.2 * row;
        const v = new THREE.Vector3(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(cam), o = cam.position;
        v.sub(o); const t = -o.z / v.z; anchors.push([o.x + v.x * t, o.y + v.y * t, 0]);
      }
      const f: EmoteFrame = {
        camera: cam, cssW: W(), cssH: H(), dpr: window.devicePixelRatio || 1, safe: PG_INSETS[kind], capX: 0, capY: 0, capR: 0, ceremony: false, quiet: calm,
        phone: kind === 'phone', anchor(id, out) { const a = anchors[id]; if (!a) return false; out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return true; },
      };
      for (let i = 0; i < 8; i++) {
        if (page < 3) em.show(i, i, page * 8 + i + 1, 0, 9, 0, 0);
        else em.show(i, i, [1, 9, 8, 4, 22, 15, 1, 12][i], [0, 1, 2, 2, 1, 0, 0, 1][i], 9, [0, 0, 3, 1, 0, 0, 0, 0][i], [1, 0, 0, 0, 2, 0, 1, 0][i]);
      }
      for (let i = 0; i < 30; i++) em.update(1 / 60, f);
      S.render();
      const draws = S.stats().drawCalls;
      em.mesh.visible = false; S.render();
      const without = S.stats().drawCalls;
      em.mesh.visible = true;
      const png = E.snapshot();
      const drawn = em.count;
      S.scene.remove(em.mesh); em.dispose();
      return { png, drawn, draws: draws - without };
    },
    /** RD-10: five bodies, one expression each (happy, sleepy, surprised, shy, proud), one gazing at the next; eyes only. */
    faces(species: string[]): { png: string } {
      const ids5 = pg.party(species, 5, 60);
      for (let k = 0; k < 5; k++) S.setBodyExpression!(ids5[k], k + 1, 1);
      E.tick(bodies, 30, 1 / 60, false);
      return { png: E.snapshot() };
    },
    /** RD-12: a clear jelly in front of another body: the back body's eyes fade where the front body covers them. */
    eyesThrough(): { alphas: number[]; png: string; frontFamily: string } {
      const front = familyOf('jellygel'), back = familyOf('gummy');
      S.clearBodies(); bodies = [];
      const gb = speciesBaseGenome(back, 2), bb = E.makeBody(gb);
      const gf = speciesBaseGenome(front, 1), bf = E.makeBody(gf);
      const idB = S.addBody!(bb, gb, { tier: 'common', position: { x: 0.12, y: 0, z: -0.85 } });
      S.addBody!(bf, gf, { tier: 'common', position: { x: 0, y: 0, z: 0 } });
      bodies = [bb, bf];
      E.tick(bodies, 120, 1 / 60, false);
      const v = S.views.find((x) => x.id === idB)!;
      return { alphas: Array.from(v.face.eyeAlpha), png: E.snapshot(), frontFamily: front };
    },
    /** RD-11: a swaying, leaning sleeper: the eye beads' projected centres against the posed skin point under them (the vertex stage's formula). */
    poseProbe(): { pngA: string; pngB: string; maxPx: number } {
      const sp = familyOf('jellygel');
      pg.party([sp], 1, 60);
      const id = ids[0], v = S.views.find((x) => x.id === id)!;
      S.setBodyAsleep!(id, true);
      S.setBodyPose!(id, 0.1, 0, 0.05, 1, 0);
      let maxPx = 0, pngA = '', pngB = '';
      for (let i = 0; i < 120; i++) {
        E.tick(bodies, 1, 1 / 60, false);
        // the eye anchor (posed on the CPU) against the same skin point posed by the vertex-stage formula: identical by construction; the check
        // here is that the drawn bead (its matrix) is where the anchor is
        const e = v.face.eyeWorld;
        const dome = (v.face.group.children[0] as THREE.Mesh).matrix.elements;
        const [ax, ay] = toPx(e[0], e[1], e[2]), [bx, by] = toPx(dome[12], dome[13], dome[14]);
        maxPx = Math.max(maxPx, Math.hypot(ax - bx, ay - by));
        if (i === 40) pngA = E.snapshot();
        if (i === 70) pngB = E.snapshot();
      }
      S.setBodyPose!(id, 0, 0, 0, 0, 0); S.setBodyAsleep!(id, false);
      return { pngA, pngB, maxPx };
    },
    /** RD-05: the stage's CPU update for 4 bodies awake against 4 asleep (no physics step: the same frozen bodies), and fine-mesh updates asleep. */
    sleepCost(species: string[]): { awakeMs: number; asleepMs: number; ratio: number; fineWhileAsleep: number } {
      pg.party(species, 4, 60);
      const time = (): number => { const t0 = performance.now(); for (let i = 0; i < 60; i++) S.update(1 / 60, { time: i / 60, pointerNdc: null }); return (performance.now() - t0) / 60; };
      time();
      const awake = Math.min(time(), time(), time());
      for (const id of ids) S.setBodyAsleep!(id, true);
      const f0 = S.views.reduce((a, v) => a + v.fineUpdates, 0);
      const asleep = Math.min(time(), time(), time());
      const f1 = S.views.reduce((a, v) => a + v.fineUpdates, 0);
      for (const id of ids) S.setBodyAsleep!(id, false);
      return { awakeMs: awake, asleepMs: asleep, ratio: asleep / awake, fineWhileAsleep: f1 - f0 };
    },
    /** RD-06: 6 pieces (chunks lite) against 2 wholes, frame ms; and the same with the chunks NOT lite (today's x1.32..1.45). */
    liteCost(rounds = 3): { two: number[]; sixLite: number[]; sixFull: number[]; liteVerts: number; fullVerts: number; simVerts: number; tierFreq: number; calls: number[] } {
      const g = speciesBaseGenome(CATALOG[0].id, 1);
      const out = { two: [] as number[], sixLite: [] as number[], sixFull: [] as number[], liteVerts: 0, fullVerts: 0, simVerts: 0, tierFreq: 0, calls: [0, 0, 0] };
      const build = (six: boolean, lite: boolean): void => {
        S.clearBodies();
        const bs: StubBody[] = [];
        const n = six ? 6 : 2;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2, rr = six ? 0.55 : 0.6;
          const b = six ? new StubBody(g, { piece: { frac: 1 / 6, chunk: k > 0, cutNormal: { x: Math.cos(a), y: 0, z: Math.sin(a) }, at: { x: Math.cos(a) * rr, y: 0, z: Math.sin(a) * rr } } })
            : new StubBody(g, { piece: { frac: 1, chunk: false, at: { x: (k ? 1 : -1) * rr, y: 0, z: 0 } } });
          S.addBody!(b, g, { tier: 'common', chunk: six && k > 0, lite: six && k > 0 && lite });
          bs.push(b);
        }
        E.tick(bs, 40, 1 / 60, false);
        if (six && lite) { out.liteVerts = S.views[1].jelly.fineCount; out.simVerts = S.views[1].proxy.vertexCount; out.tierFreq = S.views[0].jelly.freq; }
        if (six && !lite) out.fullVerts = S.views[1].jelly.fineCount;
      };
      for (let r = 0; r < rounds; r++) for (const [six, lite] of [[false, false], [true, true], [true, false]] as const) {
        build(six, lite); S.render();
        out.calls[six ? (lite ? 1 : 2) : 0] = S.stats().drawCalls;
        const ms = E.timeRender(3);
        (six ? (lite ? out.sixLite : out.sixFull) : out.two).push(ms);
      }
      S.clearBodies();
      return out;
    },
    /**
     * A place (the cabin, S1; Ripple, Frostbell, Rainleaf, S2): load, set (the layout follows the frame: tall under aspect 0.9), frame its
     * bounds (setPlayBounds), n bodies at the layout's spawn spots; returns a screenshot, the set's draw calls (no body out), the play area's
     * mean linear luminance (inside the insets), a 1 m squishy's measured width in CSS px at the front edge and the middle of the bounds
     * (RD-17), the lens, and RD-17's round-2 model on the live camera: every corner centre's ground point and top (2 x 0.625 m) inside the
     * insets (the worst margin in px).
     */
    async placeShot(kind: 'phone' | 'desktop', n = 4, species: string[] = ['dollop', 'twangle', 'chunkle', 'wisplet', 'kneadle'], id = 'hearthlog'): Promise<{
      ok: boolean; png: string; setCalls: number; setTris: number; luma: number; frontPx: number; midPx: number; layout: string; fov: number; margin: number; info: Record<string, unknown>;
    }> {
      pg.insets(kind);
      const D = PLACES[id];
      const ok = (await S.loadPlace!(id)) && S.setPlace!(id, 0.05);
      const tall = S.camera.aspect < 0.9, L = tall ? D.tall : D;
      const b = L.bounds;
      S.setPlayBounds!(b.x, b.z, b.hx ?? 3, b.hz ?? 2);
      S.clearBodies(); bodies = [];
      E.tick([], 90, 1 / 60, false);
      S.render(); const st0 = S.stats();
      const spawn = L.spawn as readonly (readonly [number, number])[];
      const pid: number[] = [];
      for (let k = 0; k < n; k++) {
        const g = speciesBaseGenome(species[k % species.length], 1 + k), bb = E.makeBody(g);
        pid.push(S.addBody!(bb, g, { tier: 'common', position: { x: spawn[k][0], y: 0, z: spawn[k][1] } }));
        bodies.push(bb);
      }
      // the place's looks on two bodies (S2: sand and wet at the shore, snow and frost on the ridge, wet in the garden)
      if (id === 'ripple') { S.setBodyLook!(pid[1], 0, 0, 0.85, 0, 0); S.setBodyLook!(pid[2], 0, 0.7, 0, 0, 0); }
      if (id === 'frostbell') { S.setBodyLook!(pid[1], 0, 0, 0, 0, 0.85); S.setBodyLook!(pid[2], 0.6, 0, 0, 0, 0); }
      if (id === 'rainleaf') S.setBodyLook!(pid[1], 0, 0.8, 0, 0, 0);
      E.tick(bodies, 120, 1 / 60, false);
      // measured size of a 1 m squishy (1 m across, at half a metre up) at the front edge and the middle of the bounds
      const w1 = (z: number): number => { const a = toPx(b.x - 0.5, 0.5, z), c = toPx(b.x + 0.5, 0.5, z); return c[0] - a[0]; };
      const frontPx = w1(b.z + (b.hz ?? 2)), midPx = w1(b.z);
      const ins = PG_INSETS[kind];
      let margin = Infinity;
      for (const x of [b.x - (b.hx ?? 3), b.x + (b.hx ?? 3)]) for (const z of [b.z - (b.hz ?? 2), b.z + (b.hz ?? 2)]) for (const y of [0, 1.25]) {
        const q = toPx(x, y, z); margin = Math.min(margin, q[0] - ins.left, W() - ins.right - q[0], q[1] - ins.top, H() - ins.bottom - q[1]);
      }
      const png = E.snapshot();
      // mean linear luminance of the frame inside the insets
      const cv = document.createElement('canvas'), w = 96, h = Math.round(96 * H() / W());
      cv.width = w; cv.height = h; const cx = cv.getContext('2d')!; cx.drawImage(E.canvas, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h).data; let sum = 0, cnt = 0;
      const toLin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const px = (x + 0.5) * W() / w, py = (y + 0.5) * H() / h;
        if (px < ins.left || px > W() - ins.right || py < ins.top || py > H() - ins.bottom) continue;
        const i = (y * w + x) * 4; sum += 0.2126 * toLin(d[i]) + 0.7152 * toLin(d[i + 1]) + 0.0722 * toLin(d[i + 2]); cnt++;
      }
      return { ok, png, setCalls: st0.drawCalls, setTris: st0.triangles, luma: sum / Math.max(1, cnt), frontPx, midPx, layout: tall ? 'tall' : 'wide', fov: S.camera.fov, margin,
        info: { pitch: S.camera.rotation.x, cam: S.camera.position.toArray() } };
    },
    /**
     * D-80's reaction presets and the things' own effects in the cabin (wide): steam on one body, drips on another, a bubble cling on a third,
     * embers on the fourth, the kettle's steam puff and the hearth's fire puff; then the budget: 8 presets at full amount for 2 s, the
     * particles emitted per second against LIFE 10.1's cap (48 desktop, 16 in Calm). Screenshots of the presets in flight.
     */
    async presets(): Promise<{ png: string; pngThings: string; started: boolean[]; perS: number; perSCalm: number; home: boolean; started2: boolean[]; png2: string; perS2: number; perS2Calm: number }> {
      pg.insets('desktop');
      pg.home(); E.tick([], 2, 1 / 60, false);
      const home = S.reactFx!(1, 0, 0, 0, 0, 1, 2);   // at Home: false (only in a place)
      await S.loadPlace!('hearthlog'); S.setPlace!('hearthlog', 0.05);
      const b = CABIN.bounds; S.setPlayBounds!(b.x, b.z, b.hx ?? 3, b.hz ?? 2);
      S.clearBodies(); bodies = [];
      const fams = ['marshmallow', 'jellygel', 'slimegoo', 'mochidough'], ids4: number[] = [];
      fams.forEach((f, k) => {
        const g = speciesBaseGenome(familyOf(f), 1 + k), bb = E.makeBody(g);
        ids4.push(S.addBody!(bb, g, { tier: 'common', position: { x: -1.6 + k * 1.15, y: 0, z: 0.3 + (k % 2) * 0.4 } }));
        bodies.push(bb);
      });
      E.tick(bodies, 60, 1 / 60, false);
      const started = [S.reactFx!(1, ids4[0], 0, 0, 0, 1, 6), S.reactFx!(4, ids4[1], 0, 0, 0, 1, 6), S.reactFx!(5, ids4[2], 0, 0, 0, 1, 6), S.reactFx!(2, ids4[3], 0, 0, 0, 1, 6)];
      E.tick(bodies, 50, 1 / 60, false);
      const png = E.snapshot();
      started.push(S.thingFx!(5, 1, 1), S.thingFx!(0, 1, 1));
      E.tick(bodies, 30, 1 / 60, false);
      const pngThings = E.snapshot();
      // the budget: 8 presets at full amount, 2 s; emitted per second (after the first second's bucket fill)
      const fx = S.placeHost!.fx;
      const rate = async (calm: boolean): Promise<number> => {
        S.setCalmEffects(calm);
        fx.clear(); E.tick(bodies, 60, 1 / 60, false);
        for (let k = 0; k < 8; k++) S.reactFx!([1, 4, 5, 2][k % 4], ids4[k % 4], 0, 0, 0, 1, 10);
        E.tick(bodies, 60, 1 / 60, false);
        const e0 = fx.soft.emitted + fx.glow.emitted + fx.soft.dropped + fx.glow.dropped;
        E.tick(bodies, 120, 1 / 60, false);
        const e1 = fx.soft.emitted + fx.glow.emitted + fx.soft.dropped + fx.glow.dropped;
        return (e1 - e0) / 2;   // (a sliding 1 s window: any second holds at most the cap, so two seconds hold at most twice it)
      };
      const perS = await rate(false), perSCalm = await rate(true);
      S.setCalmEffects(false); fx.clear();
      // round 3: the two presets the S1 / S2 cells still lacked: 6 strands (a tacky body leaving the Snug Basket) and 8 ripple (rings on a pop
      // dome's top in the Rock Pool); then their own budget at full amount (8 sources), against the same caps
      E.tick(bodies, 30, 1 / 60, false);
      const started2 = [S.reactFx!(6, ids4[2], 0, 0, 0, 1, 6), S.reactFx!(8, ids4[1], 0, 0, 0, 1, 6), S.reactFx!(3, ids4[0], 0, 0, 0, 1, 2) === false, S.reactFx!(7, ids4[0], 0, 0, 0, 1, 2) === false];
      E.tick(bodies, 50, 1 / 60, false);
      const png2 = E.snapshot();
      const rate2 = async (calm: boolean): Promise<number> => {
        S.setCalmEffects(calm);
        fx.clear(); E.tick(bodies, 60, 1 / 60, false);
        for (let k = 0; k < 8; k++) S.reactFx!(k % 2 ? 8 : 6, ids4[k % 4], 0, 0, 0, 1, 10);
        E.tick(bodies, 60, 1 / 60, false);
        const e0 = fx.soft.emitted + fx.glow.emitted + fx.soft.dropped + fx.glow.dropped;
        E.tick(bodies, 120, 1 / 60, false);
        return (fx.soft.emitted + fx.glow.emitted + fx.soft.dropped + fx.glow.dropped - e0) / 2;
      };
      const perS2 = await rate2(false), perS2Calm = await rate2(true);
      S.setCalmEffects(false); fx.clear();
      return { png, pngThings, started, perS, perSCalm, home, started2, png2, perS2, perS2Calm };
    },
    /** RD-17's bubble clamp in a place (tall, phone): a say bubble over a body at the back-right corner of the bounds stays inside the safe
     *  frame; returns the bubble's circle, the safe frame and a screenshot. */
    async bubbleClamp(id = 'ripple'): Promise<{ png: string; inside: boolean; tail: number; at: number[] }> {
      pg.insets('phone');
      await S.loadLifeLook();
      const D = PLACES[id];
      await S.loadPlace!(id); S.setPlace!(id, 0.05);
      const L = D.tall, b = L.bounds; S.setPlayBounds!(b.x, b.z, b.hx ?? 1.25, b.hz ?? 3);
      S.clearBodies(); bodies = [];
      const spots = [[b.x + (b.hx ?? 1.25), b.z - (b.hz ?? 3)], [b.x - (b.hx ?? 1.25), b.z - (b.hz ?? 3) + 0.4], [0, 0]];
      const ids3: number[] = [];
      spots.forEach((p, k) => { const g = speciesBaseGenome([speciesOfRadius(0.625), 'chunkle', 'dollop'][k], 2 + k), bb = E.makeBody(g); ids3.push(S.addBody!(bb, g, { tier: 'common', position: { x: p[0], y: 0, z: p[1] } })); bodies.push(bb); });
      E.tick(bodies, 60, 1 / 60, false);
      S.emote!(0, ids3[0], 6, 0, 5, 0, 1); S.emote!(1, ids3[1], 22, 1, 0, 0, 0); S.emote!(2, ids3[2], 2, 0, 5, 0, 0);
      E.tick(bodies, 40, 1 / 60, false);
      const out = new Float32Array(3); S.emoteScreen!(0, out);
      const ins = PG_INSETS.phone, inside = out[0] - out[2] >= ins.left - 0.5 && out[0] + out[2] <= W() - ins.right + 0.5 && out[1] - out[2] >= ins.top - 0.5 && out[1] + out[2] <= H() - ins.bottom + 0.5;
      const png = E.snapshot();
      for (let k = 0; k < 3; k++) S.clearEmote!(k);
      return { png, inside, tail: S.emotes ? S.emotes.slots[0].tail : NaN, at: [out[0], out[1], out[2]] };
    },
    /** FN-02's scene: jelly, marshmallow, mochi dough and slime by the fireplace (wide layout), the marshmallow toasted 0.6 and posed (render). */
    async fireplace(): Promise<{ png: string }> {
      pg.insets('desktop');
      await S.loadPlace!('hearthlog'); S.setPlace!('hearthlog', 0.05);
      const b = CABIN.bounds; S.setPlayBounds!(b.x, b.z, b.hx ?? 3, b.hz ?? 2);
      S.clearBodies(); bodies = [];
      const fire = CABIN.zones[0];
      const fams = ['jellygel', 'marshmallow', 'mochidough', 'slimegoo'];
      const ids4: number[] = [];
      fams.forEach((f, k) => {
        const g = speciesBaseGenome(familyOf(f), 1 + k), bb = E.makeBody(g);
        ids4.push(S.addBody!(bb, g, { tier: 'common', position: { x: fire.x + 0.2 + k * 1.05, y: 0, z: fire.z + 0.9 + (k % 2) * 0.3 } }));
        bodies.push(bb);
      });
      S.setBodyLook!(ids4[1], 0, 0, 0, 0.6, 0);
      S.setBodyPose!(ids4[0], 0, 0, 0.03, 0.5, 0);
      S.setBodyBreath!(ids4[3], 1);
      E.tick(bodies, 150, 1 / 60, false);
      return { png: E.snapshot() };
    },
    /** RD-07: n swaps Home -> cabin -> Home; the renderer's programs, textures and geometries against Home's baseline. */
    async placeSwaps(n = 10): Promise<{ base: number[]; after: number[] }> {
      const ids = Object.keys(PLACES);
      for (const id of ids) await S.loadPlace!(id);
      S.setPlace!(null, 0.05); E.tick([], 4, 1 / 60, true);
      const m0 = S.memory(); const base = [m0.programs, m0.textures, m0.geometries];
      for (let i = 0; i < n; i++) { const id = ids[i % ids.length]; S.setPlace!(id, 0.05); E.tick([], 3, 1 / 60, true); S.setPlace!(null, 0.05); E.tick([], 3, 1 / 60, true); }
      const m1 = S.memory();
      return { base, after: [m1.programs, m1.textures, m1.geometries] };
    },
    /**
     * RD-03 (round 3): the ceremony dim of a place (PLACES 2.3: a bright place dims its lights while a ceremony plays, easing in and out over
     * at least 1.0 s). Puts the place up (wide, desktop insets), plays a capsule reveal of `tier`, steps at 1/30 s and records the place host's
     * dim every frame, then 3 s after the end. Returns the trace and the ease times (first frame above 0 to the first at the full dim; last
     * frame at the full dim to the first back at 0) and the largest per-frame step.
     */
    async placeDim(id: string, tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' = 'mythic'): Promise<{ full: number; peak: number; inS: number; outS: number; maxStep: number; ended: boolean; frames: number }> {
      pg.insets('desktop');
      await S.loadPlace!(id); S.setPlace!(id, 0.05);
      const b = PLACES[id].bounds; S.setPlayBounds!(b.x, b.z, b.hx ?? 3, b.hz ?? 2);
      S.clearBodies(); bodies = [];
      const g = speciesBaseGenome('dollop', 3), bb = E.makeBody(g); S.addBody!(bb, g, { tier: 'common' }); bodies.push(bb);
      E.tick(bodies, 30, 1 / 30, false);
      const ph = (S as unknown as { placeHost: { dimNow: number; look(id: string): { ceremonyDim?: number } | null } | null }).placeHost;
      if (!ph) return { full: NaN, peak: NaN, inS: NaN, outS: NaN, maxStep: NaN, ended: false, frames: 0 };
      const full = ph.look(id)?.ceremonyDim ?? 0;
      const h = S.playCapsuleReveal({ result: { genome: speciesBaseGenome('twangle', 7), tier, isNew: true }, createBody: (gg: Genome) => E.makeBody(gg) });
      const tr: number[] = [ph.dimNow];
      let f = 0;
      while (h.active && f < 1500) { E.tick(bodies, 1, 1 / 30, false); tr.push(ph.dimNow); f++; }
      const ended = !h.active;
      for (let k = 0; k < 90; k++) { E.tick(bodies, 1, 1 / 30, false); tr.push(ph.dimNow); }
      const peak = Math.max(...tr);
      let maxStep = 0; for (let k = 1; k < tr.length; k++) maxStep = Math.max(maxStep, Math.abs(tr[k] - tr[k - 1]));
      const i0 = tr.findIndex((v) => v > 1e-6), i1 = tr.findIndex((v) => v >= peak - 1e-6);
      let j0 = -1; for (let k = tr.length - 1; k >= 0; k--) if (tr[k] >= peak - 1e-6) { j0 = k; break; }
      const j1 = j0 < 0 ? -1 : tr.findIndex((v, k) => k > j0 && v <= 1e-6);
      S.clearBodies(); bodies = [];
      return { full, peak, inS: i0 < 0 ? 0 : (i1 - i0 + 1) / 30, outS: j1 < 0 ? (peak > 0 ? NaN : 0) : (j1 - j0) / 30, maxStep, ended, frames: f };
    },
    /** RD-14 in a place (round 3): 3 bodies at the layout's spawn points, the HUD rows of `kind`; a body slides and hops by itself (no finger);
     *  the camera position, lens shift, camera scale and fov must not move, with the autonomy framing off (what the shell sets in a place) and on. */
    async placeAutonomy(kind: 'phone' | 'desktop', id: string): Promise<{ off: number[]; on: number[] }> {
      pg.insets(kind);
      await pg.enterPlace(id);
      const D = PLACES[id], L = S.camera.aspect < 0.9 ? D.tall : D, spawn = L.spawn as readonly (readonly [number, number])[];
      const run = (on: boolean): number[] => {
        S.clearBodies(); bodies = [];
        for (let k = 0; k < 3; k++) { const g = speciesBaseGenome(['dollop', 'twangle', 'chunkle'][k], 1 + k), bb = E.makeBody(g); S.addBody!(bb, g, { tier: 'common', position: { x: spawn[k][0], y: 0, z: spawn[k][1] } }); bodies.push(bb); }
        S.setAutonomyFraming!(on);
        E.tick(bodies, 240, 1 / 60, false);
        const p0 = S.camera.position.clone(), i0 = S.info, l0x = i0.lens.x, l0y = i0.lens.y, c0 = i0.camScale, f0 = S.camera.fov;
        let mx = 0, ml = 0, ms = 0, mf = 0;
        for (let i = 0; i < 180; i++) {
          if (i % 30 === 0) bodies[1].nudge({ x: 0.9, y: i % 60 === 0 ? 0.8 : 0, z: 0.5 });
          E.tick(bodies, 1, 1 / 60, false);
          const inf = S.info;
          mx = Math.max(mx, S.camera.position.distanceTo(p0)); ml = Math.max(ml, Math.abs(inf.lens.x - l0x), Math.abs(inf.lens.y - l0y)); ms = Math.max(ms, Math.abs(inf.camScale - c0)); mf = Math.max(mf, Math.abs(S.camera.fov - f0));
        }
        S.setAutonomyFraming!(false);
        return [mx, ml, ms, mf];
      };
      const off = run(false), on = run(true);
      S.clearBodies(); bodies = [];
      return { off, on };
    },
    /**
     * The finale spectacle (PLACES P13, round 3): `placeShot`'s scene in place `id`, then thingFx(-1, 2, 1) and 4.5 s at 1/30 s (Calm: 7.5 s),
     * the frame's mean linear luminance every 3rd frame; then thingFx(-1, 2, 0) and the way back. Returns whether the place took it, the host's
     * eased amount trace (its time to 1), the luminance trace's largest reversal (a flicker; a fade only goes one way) and the two shots.
     */
    async placeFinale(id: string, calm = false): Promise<{ took: boolean; toOneS: number; backS: number; lumaA: number; lumaB: number; reversal: number; pngA: string; pngB: string }> {
      const r0 = await pg.placeShot('desktop', 4, undefined, id);
      const ph = (S as unknown as { placeHost: { finNow?: number } | null }).placeHost;
      S.setCalmEffects(calm);
      const luma = (): number => {
        const cv = document.createElement('canvas'), w = 64, h = 40; cv.width = w; cv.height = h; const cx = cv.getContext('2d')!; cx.drawImage(E.canvas, 0, 0, w, h);
        const d = cx.getImageData(0, 0, w, h).data, L = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * L(d[i]) + 0.7152 * L(d[i + 1]) + 0.0722 * L(d[i + 2]);
        return s / (w * h);
      };
      E.tick(bodies, 1, 1 / 30, true);
      const lumaA = luma();
      const took = S.thingFx!(-1, 2, 1);
      const tr: number[] = [], lt: number[] = [lumaA];
      const n = Math.round((calm ? 7.5 : 4.5) * 30);
      for (let f = 0; f < n; f++) { const k = f % 3 === 2; E.tick(bodies, 1, 1 / 30, k); tr.push(ph?.finNow ?? NaN); if (k) lt.push(luma()); }
      const pngB = E.snapshot();
      let rev = 0, dir = 0, piv = lt[0];
      for (const v of lt) { if (dir === 0) { if (Math.abs(v - piv) > 1e-4) dir = Math.sign(v - piv); piv = v; } else if ((v - piv) * dir >= 0) piv = v; else rev = Math.max(rev, Math.abs(v - piv)); }
      const i1 = tr.findIndex((v) => v >= 1 - 1e-6);
      S.thingFx!(-1, 2, 0);
      let back = 0; for (; back < 600 && (ph?.finNow ?? 0) > 1e-6; back++) E.tick(bodies, 1, 1 / 30, false);
      S.setCalmEffects(false);
      S.clearBodies(); bodies = [];
      return { took, toOneS: i1 < 0 ? NaN : (i1 + 1) / 30, backS: back / 30, lumaA, lumaB: lt[lt.length - 1], reversal: rev, pngA: r0.png, pngB };
    },
    /** Put a place up with its layout's bounds for this frame's aspect, the insets left as they are (RD-03's flash rows run R.runCeremony in it). */
    async enterPlace(id: string): Promise<boolean> {
      const ok = (await S.loadPlace!(id)) && S.setPlace!(id, 0.05);
      const D = PLACES[id], b = (S.camera.aspect < 0.9 ? D.tall : D).bounds;
      S.setPlayBounds!(b.x, b.z, b.hx ?? 3, b.hz ?? 2);
      return ok;
    },
    home(): void { S.setPlace!(null, 0.05); S.setPlayBounds!(NaN, NaN, NaN, NaN); },
  };
  return pg;
}
