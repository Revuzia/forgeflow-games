// RENDER harness, TRUE CUT probes (CUT2.md 12.1 rows RP1, RP2, RP3, RP4; task R1 parts 1 and 2). Loaded by view.ts, driven by browser_render.mjs section `cut2` through window.__RV__.cut2.
// The pieces are REAL (PHYS's pure builder through StubBody's RestProvider, see physPieces.ts) driven by the stub's fake dynamics, so every probe cuts a real species' real rest mesh.
//   rp3  the flat face seen edge-on (camera IN the face plane): line fit RMS of the cut-side silhouette; control = the shipped CHUNK build (real soft body)
//   rp4  whole vs two flush pieces at rest (camera pinned, eyes / ember / table lights off: they are part 2 and R3): mean abs diff outside a 4 px seam band, worst 8 x 8 block,
//        and the same with the outline blocks left out; a post "Reconnect all" frame against the never-cut frame
//   rp1  eyes per piece: dark ink pixels inside each eye's footprint on each piece rendered alone against the whole's, and the dev count of eye meshes (`eyeInk`, part 2)
//   rp2  the straddle sweep: the plane across an eye at -1.0 .. +1.0 rho, ink of A + B against the whole, ink beyond the cut face (`eyeInk` with the camera IN the plane)
//   shots  a whole and its two pieces apart, from three cameras, as PNGs (the cut-face look is READ, not only measured)
import * as THREE from 'three';
import type { StageDev } from '../../src/render/stageDev.ts';
import { StubBody } from '../../src/render/stubBody.ts';
import { CATALOG, speciesBaseGenome } from '../../src/data/catalog.ts';
import type { SoftBodyCtor, SoftBodyLike, SoftEvent, V3 } from '../../src/contracts.ts';
import { PB_TUNING } from '../../src/render/pieceBuild.ts';
import { physPieces } from './physPieces.ts';
import type { CutSide } from './physPieces.ts';
import { wholeRefFor } from '../../src/render/wholeRef.ts';
import { buildPieceEyes } from '../../src/render/pieceEyes.ts';
import { buildPieceMesh } from '../../src/render/pieceBuild.ts';
import { CORE_TUNING } from '../../src/render/core.ts';

/** One piece of an `eyeInk` run: its fraction, eye meshes drawn, remaining width of each, dark ink in each eye's footprint, ink beyond the cut line, which slots are drawn. */
export interface InkPiece { frac: number; meshes: number; shares: number[]; ink: number[]; inkBeyond: number; slotsDrawn: number[]; centres: number[][] }
/** Where the ink of the whole and of the two pieces disagree (diagnostic): whole ink in neither piece (`lost`), piece ink not in the whole (`extra`), in both pieces (`both`), and the mean screen x of the lost pixels relative to the cut line. */
export interface InkDiff { lost: number; extra: number; both: number; lostDx: number; why?: Record<string, number> }

export function makeCut2(stage: StageDev, canvas: HTMLCanvasElement, real: () => SoftBodyCtor | null) {
  const PP = physPieces();
  const c2 = document.createElement('canvas');
  const x2 = c2.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  const tmpEv: SoftEvent[] = [];
  let T = 1000;                                    // the stage clock (monotonic across probes)
  let PTR: { x: number; y: number } | null = null; // the pointer the eyes follow (null = the idle wander; the eye probes fix it so every frame of a comparison looks the same way)
  const genomeOf = (id: string) => speciesBaseGenome(id as never, 1);

  /** The eye / recombination probes hold the stub's dynamics (the bodies are not stepped, only the stage is): a piece and the whole then differ only by what the RENDER does with them. */
  let FREEZE = false;
  function run(bodies: SoftBodyLike[], n: number, dt = 1 / 60): void {
    for (let i = 0; i < n; i++) {
      if (!FREEZE) for (const b of bodies) { b.step(dt); tmpEv.length = 0; b.drainEvents(tmpEv); }
      T += dt;
      stage.update(dt, { time: T, pointerNdc: PTR });
    }
  }
  /** No blink in a comparison (a closed eye is no evidence): push every eye's next blink out of reach. */
  function noBlink(id: number): void { const v = stage.views.find((w) => w.id === id); if (v) (v.face as unknown as { blinkAt: number }).blinkAt = 1e9; }
  function lockLook(): void {
    for (const v of stage.views) for (const e of ((v.face as unknown as { eyes: { uLook: { value: THREE.Vector2 } }[] }).eyes)) e.uLook.value.set(0, 0);
  }
  function grab(): Uint8ClampedArray {
    if (PTR) lockLook();
    stage.render();
    c2.width = canvas.width; c2.height = canvas.height;
    x2.drawImage(canvas, 0, 0);
    return x2.getImageData(0, 0, c2.width, c2.height).data;
  }
  const png = (): string => { if (PTR) lockLook(); stage.render(); return canvas.toDataURL('image/png'); };
  /** Switch off everything that is not skin and cut face (eyes, ember, table lights, fx, tier fx): the probes that compare pictures measure the jelly. */
  function strip(id: number, keep?: { face?: boolean; core?: boolean }): void {
    const v = stage.views.find((w) => w.id === id);
    if (!v) return;
    if (!keep?.face) { v.faceHidden = true; v.face.group.visible = false; }
    if (!keep?.core) { v.core.group.visible = false; v.core.boost = -1; }
    // (decals.update() sets its meshes' visibility every frame: the MATERIALS are switched off)
    for (const m of [v.decals.shadow, v.decals.pool]) (m.material as THREE.Material).visible = false;
    v.fx.group.visible = false; v.rarity.group.visible = false; v.strands.group.visible = false;
  }
  /** The stub does not hold a slab exactly where it was put (it settles a few mm onto the table): move the VIEW by the difference so a flush pair is flush to the stub's own error (a render offset, the body is untouched). */
  function flushFix(id: number, b: StubBody, want: V3): void {
    const v = stage.views.find((w) => w.id === id);
    if (!v) return;
    v.proxy.setOffset(want.x - b.center.x, want.y - b.center.y, want.z - b.center.z);
    run([b], 4);
  }
  const sideOf = (r: ReturnType<typeof PP.cut>): r is { a: CutSide; b: CutSide; d: number; fa: number } => !('refused' in r);
  const minY = (a: Float32Array): number => { let m = Infinity; for (let i = 1; i < a.length; i += 3) if (a[i] < m) m = a[i]; return m; };
  function pieceBody(g: ReturnType<typeof genomeOf>, s: CutSide, at: V3): StubBody {
    return new StubBody(g, { rest: PP, piece: { frac: s.frac, region: s.region, at } });
  }

  /** The left silhouette of the body in a pair of frames (body shown / hidden): per row the sub-pixel x where the difference passes half its plateau; then a least-squares line. */
  function leftEdge(A: Uint8ClampedArray, B: Uint8ClampedArray, W: number, H: number): { rms: number; rows: number; slope: number; x: number; yTop: number; yBot: number; max: number } {
    const D = new Float32Array(W * H);
    let yTop = -1, yBot = -1;
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4, d = Math.max(Math.abs(A[p] - B[p]), Math.abs(A[p + 1] - B[p + 1]), Math.abs(A[p + 2] - B[p + 2]));
        D[y * W + x] = d; if (d > 40) n++;
      }
      if (n >= 3) { if (yTop < 0) yTop = y; yBot = y; }
    }
    const pts: [number, number][] = [];
    if (yTop >= 0) {
      const h = yBot - yTop, y0 = Math.round(yTop + 0.15 * h), y1 = Math.round(yTop + 0.85 * h);
      for (let y = y0; y <= y1; y++) {
        const row = y * W;
        let xe = -1;
        for (let x = 1; x < W - 1; x++) if (D[row + x] > 24 && D[row + x + 1] > 24) { xe = x; break; }
        if (xe < 3) continue;
        let pl = 0; for (let x = xe + 5; x <= xe + 12; x++) pl += D[row + x]; pl /= 8;
        if (pl < 40) continue;
        const half = 0.5 * pl;
        for (let x = xe - 2; x <= xe + 12; x++) {
          if (D[row + x] >= half) { const d0 = D[row + x - 1], d1 = D[row + x]; pts.push([y + 0.5, x - 1 + (d1 > d0 ? (half - d0) / (d1 - d0) : 1) + 0.5]); break; }
        }
      }
    }
    if (pts.length < 8) return { rms: NaN, rows: pts.length, slope: 0, x: 0, yTop, yBot, max: NaN };
    let sy = 0, sx = 0, syy = 0, sxy = 0;
    for (const [y, x] of pts) { sy += y; sx += x; syy += y * y; sxy += y * x; }
    const n = pts.length, den = n * syy - sy * sy, a = den ? (n * sxy - sy * sx) / den : 0, b = (sx - a * sy) / n;
    let ss = 0, mx = 0;
    for (const [y, x] of pts) { const r = x - (a * y + b); ss += r * r; if (Math.abs(r) > mx) mx = Math.abs(r); }
    return { rms: Math.sqrt(ss / n), rows: n, slope: a, x: b + a * ((yTop + yBot) / 2), yTop, yBot, max: mx };
  }

  return {
    /** Probe knob: extra fine subdivisions per piece (src/render/pieceBuild.ts PB_TUNING). */
    setNExtra(n: number): void { PB_TUNING.nExtra = n; },
    /** Probe knob: the floor of a piece's analytic core halo (spec 8.3: 0.35). 1 = a piece lights its jelly exactly as the whole did. */
    setCoreFloor(v: number): void { CORE_TUNING.pieceFloor = v; },
    /** The species the four eye styles are named by. */
    eyeSpecies(): Record<string, string> { const o: Record<string, string> = {}; for (const d of CATALOG) { const s = genomeOf(d.id).eyeStyle; if (!o[s]) o[s] = d.id; } return o; },

    /**
     * RP3: a piece of a vertical cut, alone, with the camera IN the face plane (the piece is placed so that the camera, which follows 0.6 x the body's x, lies in its plane), at the
     * viewport's size. Returns the line fit of the cut-side silhouette. `control`: the shipped CHUNK build (the real soft body with piece { chunk: true, cutNormal }) in the same rig.
     */
    rp3(o: { species: string; off: number; control?: boolean }): { ok: boolean; why?: string; rms: number; rows: number; slope: number; camErrM: number; yTop: number; yBot: number; max: number; frac: number; png: string; protrudeR0: number; protrudeN: number; worstRow?: number[] } {
      const g = genomeOf(o.species), R0 = PP.whole(g).radius, W = canvas.width, H = canvas.height;
      stage.clearBodies();
      let body: SoftBodyLike, planeX: () => number, label: string;
      if (!o.control) {
        const cut = PP.cut(g, { x: 1, y: 0, z: 0 }, o.off * R0);
        if (!sideOf(cut)) return { ok: false, why: cut.refused, rms: NaN, rows: 0, slope: 0, camErrM: NaN, yTop: 0, yBot: 0, max: NaN, frac: 0, png: '', protrudeR0: NaN, protrudeN: 0 };
        const s = cut.a.rest.offset.x - cut.d, Xp = 2.5 * s;   // camera.x = 0.6 X ; the face is at X - s : equal when X = s / 0.4
        body = pieceBody(g, cut.a, { x: Xp, y: -minY(cut.a.rest.restLocal), z: 0 });
        planeX = () => body.center.x - (cut.a.rest.offset.x - cut.d);
        label = 'piece';
        const id = stage.addBody(body, g, { tier: 'common' }); strip(id);
        run([body], 160);
      } else {
        const Real = real();
        if (!Real) return { ok: false, why: 'no real soft body', rms: NaN, rows: 0, slope: 0, camErrM: NaN, yTop: 0, yBot: 0, max: NaN, frac: 0, png: '', protrudeR0: NaN, protrudeN: 0 };
        // the shipped chunk build in the same rig. The physics body drifts while it settles, so the camera-in-plane condition (camera.x = 0.6 x centre = the face's x) is reached by
        // up to three placement passes (each corrects the start x by what the previous pass measured)
        const faceX = (b: SoftBodyLike): number => { let m = Infinity; const P = b.positions; for (let i = 0; i < P.length; i += 3) if (P[i] < m) m = P[i]; return m; };
        let at = 1.0, id = -1, v0: SoftBodyLike | null = null;
        for (let pass = 0; pass < 3; pass++) {
          stage.clearBodies();
          v0 = new Real(g, { piece: { frac: 0.5, chunk: true, cutNormal: { x: -1, y: 0, z: 0 }, at: { x: at, y: 0, z: 0 } } });
          id = stage.addBody(v0, g, { tier: 'common', chunk: true }); strip(id);
          run([v0], 200);
          const m = faceX(v0) - v0.center.x;                // the face's offset from the centre (negative)
          const err = stage.camera.position.x - faceX(v0);
          if (Math.abs(err) < 0.004) break;
          at += -m * 2.5 - v0.center.x;                      // the centre that puts the camera in the plane
        }
        body = v0 as SoftBodyLike;
        planeX = () => faceX(body);
        label = 'chunk';
      }
      const v = stage.views[stage.views.length - 1];
      const A = grab(), pngShown = png();
      v.group.visible = false; const B = grab(); v.group.visible = true;
      const fit = leftEdge(A, B, W, H);
      const camErr = stage.camera.position.x - planeX();
      // how far any drawn skin vertex lies beyond the cut plane (the live cap plane): the face must be the extreme of the piece on its side
      let pro = 0, proN = 0;
      const cap = v.jelly.caps[0];
      if (cap && cap.live) {
        const P = v.jelly.mesh.geometry.getAttribute('position').array as Float32Array, pb = v.jelly.pb;
        const c0 = pb ? pb.classStart[pb.planes.length] : 0;
        for (let k = c0; k < v.jelly.fineCount; k++) { const o2 = (P[k * 3] * cap.nx + P[k * 3 + 1] * cap.ny + P[k * 3 + 2] * cap.nz - cap.d) / PP.whole(g).radius; if (o2 > pro) pro = o2; if (o2 > 1e-4) proN++; }
      }
      return { ok: true, why: label, rms: fit.rms, rows: fit.rows, slope: fit.slope, camErrM: camErr, yTop: fit.yTop, yBot: fit.yBot, max: fit.max, frac: body.frac ?? 0, png: pngShown, protrudeR0: pro, protrudeN: proN };
    },

    /**
     * RP4: the whole against the two flush pieces of a vertical cut through its centre (the camera contains the plane), clock frozen, pointer none, the camera pinned to the whole's.
     * Eyes, ember, table lights, fx and tier fx are off on every view (they belong to part 2 and R3). Then the whole again from a fresh body (a "Reconnect all") against the first.
     */
    rp4(o: { species: string; off?: number; /** the pieces are cut EXACTLY out of the whole's own mesh (physPieces.exactCut): the render's own error floor, without PHYS's re-mesh */ exact?: boolean;
      /** part 2: the eyes and the ember are ON (pointer fixed, no blink); the plane may cross eye `slot` at `dRho` x the widest the bead gets from its centre; `inPlane`: the camera lies in the plane */ faces?: boolean; dRho?: number; slot?: 0 | 1; inPlane?: boolean }): {
      ok: boolean; why?: string; meanAll: number; meanBody: number; maxBlock: number; maxBlockInterior: number; blocksOver6: number; blocksOver6Interior: number; blocksInterior: number; blocks: number;
      reconnectMean: number; reconnectMax: number; seamPx: number; seamProfile: number[]; frac: number[]; pngWhole: string; pngPieces: string; pngDiff: string;
    } {
      const g = genomeOf(o.species), R0 = PP.whole(g).radius;
      const empty = { ok: false, meanAll: NaN, meanBody: NaN, maxBlock: NaN, maxBlockInterior: NaN, blocksOver6: 0, blocksOver6Interior: 0, blocksInterior: 0, blocks: 0, reconnectMean: NaN, reconnectMax: NaN, seamPx: 0, seamProfile: [] as number[], frac: [] as number[], pngWhole: '', pngPieces: '', pngDiff: '' };
      const keep = o.faces ? { face: true, core: true } : undefined;
      let d = (o.off ?? 0) * R0;
      if (o.dRho !== undefined) { const wh = PP.whole(g), ref = wholeRefFor({ vertexCount: (wh.restLocal.length / 3) | 0, indices: wh.indices, restLocal: wh.restLocal }, wh.radius, g); d = ref.eyes[o.slot ?? 0].centre.x + o.dRho * ref.rho; }
      const cut = o.exact ? PP.exactCut(g, { x: 1, y: 0, z: 0 }, d) : PP.cut(g, { x: 1, y: 0, z: 0 }, d);
      if (!sideOf(cut)) return { ...empty, why: cut.refused };
      const W = canvas.width, H = canvas.height;
      const X = o.inPlane ? -2.5 * d : 0;
      PTR = o.faces ? { x: 0, y: 0 } : null; FREEZE = !!o.faces;
      stage.clearBodies();
      let whole = new StubBody(g, { rest: PP, piece: { frac: 1, chunk: false, at: { x: X, y: 0, z: 0 } } });
      let id = stage.addBody(whole, g, { tier: 'common' }); strip(id, keep); noBlink(id);
      run([whole], 180);
      const camP = stage.camera.position.clone(), camQ = stage.camera.quaternion.clone();
      const pin = (): void => { stage.camera.position.copy(camP); stage.camera.quaternion.copy(camQ); stage.camera.updateMatrixWorld(true); };
      pin();
      const I = grab(), pngWhole = png();
      const c0 = { x: whole.center.x, y: whole.center.y, z: whole.center.z };
      // the empty frame (same camera): the silhouette mask and the outline band come from it
      for (const v of stage.views) v.group.visible = false; const BG = grab(); for (const v of stage.views) v.group.visible = true;
      // the two pieces, flush at the whole's pose
      stage.clearBodies();
      const mk = (s: CutSide): StubBody => pieceBody(g, s, { x: c0.x + s.rest.offset.x, y: c0.y + s.rest.offset.y, z: c0.z + s.rest.offset.z });
      const pa = mk(cut.a), pb = mk(cut.b);
      const ia = stage.addBody(pa, g, { tier: 'common' }), ib = stage.addBody(pb, g, { tier: 'common' });
      strip(ia, keep); strip(ib, keep); noBlink(ia); noBlink(ib);
      run([pa, pb], 180);
      for (const [i, b, s] of [[ia, pa, cut.a], [ib, pb, cut.b]] as const) flushFix(i, b, { x: c0.x + s.rest.offset.x, y: c0.y + s.rest.offset.y, z: c0.z + s.rest.offset.z });
      pin();
      const J = grab(), pngPieces = png();
      // seam band: the projected plane (x = c0.x + d) +- 4 px
      const pv = new THREE.Vector3(c0.x + d, c0.y, c0.z).project(stage.camera), seamX = (pv.x * 0.5 + 0.5) * W;
      const inBand = (x: number): boolean => Math.abs(x + 0.5 - seamX) <= 4;
      // the body silhouette (whole against empty): a mask; the outline band = dilate(mask, 6) minus erode(mask, 6)
      const mask = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) { const q = p * 4; if (Math.abs(I[q] - BG[q]) + Math.abs(I[q + 1] - BG[q + 1]) + Math.abs(I[q + 2] - BG[q + 2]) > 18) mask[p] = 1; }
      const dil = (src: Uint8Array, r: number, want: number): Uint8Array => {
        const t1 = new Uint8Array(W * H), out = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let hit = 0; for (let k = -r; k <= r && !hit; k++) { const xx = x + k; if (xx >= 0 && xx < W && src[y * W + xx] === want) hit = 1; } t1[y * W + x] = hit; }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let hit = 0; for (let k = -r; k <= r && !hit; k++) { const yy = y + k; if (yy >= 0 && yy < H && t1[yy * W + x] === 1) hit = 1; } out[y * W + x] = hit; }
        return out;
      };
      const grown = dil(mask, 6, 1), shrunkInv = dil(mask, 6, 0);   // grown = within 6 px of the body; shrunkInv = within 6 px of the outside
      const outline = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) outline[p] = grown[p] === 1 && shrunkInv[p] === 1 ? 1 : 0;
      const dpx = new Float32Array(W * H);
      let sumAll = 0, nAll = 0, sumBody = 0, nBody = 0;
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (mask[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4, d = (Math.abs(I[p] - J[p]) + Math.abs(I[p + 1] - J[p + 1]) + Math.abs(I[p + 2] - J[p + 2])) / 3;
        dpx[y * W + x] = d;
        if (inBand(x)) continue;
        sumAll += d; nAll++;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { sumBody += d; nBody++; }
      }
      let maxBlock = 0, maxInt = 0, over = 0, overInt = 0, nBlocks = 0, nInt = 0;
      for (let by = 0; by + 8 <= H; by += 8) for (let bx = 0; bx + 8 <= W; bx += 8) {
        let s = 0, band = false, ol = false, any = false;
        for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) { s += dpx[y * W + x]; if (inBand(x)) band = true; if (outline[y * W + x]) ol = true; if (grown[y * W + x]) any = true; }
        if (band || !any) continue;
        const m = s / 64; nBlocks++;
        if (m > maxBlock) maxBlock = m;
        if (m > 6) over++;
        if (!ol) { nInt++; if (m > maxInt) maxInt = m; if (m > 6) overInt++; }
      }
      // the profile of the difference across the seam: mean over the body's middle rows of d(x), 40 px either side
      const seamProfile: number[] = [];
      for (let k = -40; k <= 40; k++) { let a = 0, c = 0; for (let y = Math.round(y0 + 0.3 * (y1 - y0)); y <= Math.round(y0 + 0.7 * (y1 - y0)); y++) { a += dpx[y * W + Math.round(seamX - 0.5) + k]; c++; } seamProfile.push(+(a / Math.max(1, c)).toFixed(2)); }
      // the difference picture (x8) for the eye
      const dc = document.createElement('canvas'); dc.width = W; dc.height = H;
      const dx = dc.getContext('2d') as CanvasRenderingContext2D, img = dx.createImageData(W, H);
      for (let p = 0; p < W * H; p++) { const v = Math.min(255, dpx[p] * 8); img.data[p * 4] = v; img.data[p * 4 + 1] = v; img.data[p * 4 + 2] = v; img.data[p * 4 + 3] = 255; if (outline[p]) img.data[p * 4 + 2] = Math.min(255, v + 60); }
      dx.putImageData(img, 0, 0);
      const pngDiff = dc.toDataURL('image/png');
      // "Reconnect all": the pieces go, a fresh whole body comes (what the shell's swapWhole does), the same frames; against the never-cut frame
      stage.clearBodies();
      whole = new StubBody(g, { rest: PP, piece: { frac: 1, chunk: false, at: { x: X, y: 0, z: 0 } } });
      id = stage.addBody(whole, g, { tier: 'common' }); strip(id, keep); noBlink(id);
      run([whole], 180);
      pin();
      const K = grab();
      let rs = 0, rmax = 0;
      for (let p = 0; p < W * H * 4; p += 4) { const d = (Math.abs(I[p] - K[p]) + Math.abs(I[p + 1] - K[p + 1]) + Math.abs(I[p + 2] - K[p + 2])) / 3; rs += d; if (d > rmax) rmax = d; }
      stage.clearBodies();
      PTR = null; FREEZE = false;
      return {
        ok: true, meanAll: sumAll / Math.max(1, nAll), meanBody: sumBody / Math.max(1, nBody), maxBlock, maxBlockInterior: maxInt, blocksOver6: over, blocksOver6Interior: overInt, blocksInterior: nInt, blocks: nBlocks,
        reconnectMean: rs / (W * H), reconnectMax: rmax, seamPx: seamX, seamProfile, frac: [cut.a.frac, cut.b.frac], pngWhole, pngPieces, pngDiff,
      };
    },

    /**
     * RP1 / RP2 (CUT2 12.1): the whole squishy, then each piece ALONE in the whole's flush pose, camera pinned to the whole's, pointer fixed, blink off, same frames. Evidence is DARK INK
     * (luma < 24) inside each eye's footprint (the pixels the whole's eye changes), split into the left (slot 0) and right (slot 1) eye by the screen midline between them; the dev count of eye
     * meshes (`stage.eyeCentres`) is read per view. The plane is n . x = d in W: d given (`dAbs`, metres) or `dRho` x the widest the bead gets away from the centre of eye `slot`.
     * `inPlane`: the whole is placed so that the camera lies IN the plane (the real swipe plane contains the camera), the cut face is then seen edge-on and projects to a straight screen line;
     * ink of a piece on the wrong side of that line is "beyond the cut face".
     */
    eyeInk(o: { species: string; n?: V3; slot?: 0 | 1; dRho?: number; dAbs?: number; exact?: boolean; inPlane?: boolean; shot?: boolean; tier?: string; /** the eye-midline plane: through the midpoint of the two eyes, normal along the line joining them (the first Split in two) */ midline?: boolean }): {
      ok: boolean; why?: string; species: string; style: string; d: number; rho: number; share: number[]; whole: { ink: number[]; mask: number[]; centres: number[][] };
      pieces: InkPiece[]; line: number; camErrM: number; pngs: string[]; diff: InkDiff;
    } {
      const g = genomeOf(o.species), W = canvas.width, H = canvas.height;
      const wh = PP.whole(g), ref = wholeRefFor({ vertexCount: (wh.restLocal.length / 3) | 0, indices: wh.indices, restLocal: wh.restLocal }, wh.radius, g);
      const nl = o.n ? Math.hypot(o.n.x, o.n.y, o.n.z) : 1;
      let n = o.n ? { x: o.n.x / nl, y: o.n.y / nl, z: o.n.z / nl } : { x: 1, y: 0, z: 0 };
      const slot = o.slot ?? 0, ec = ref.eyes[slot].centre;
      let d = o.dRho !== undefined ? n.x * ec.x + n.y * ec.y + n.z * ec.z + o.dRho * ref.rho : (o.dAbs ?? 0);
      if (o.midline) {
        const a = ref.eyes[0].centre, b = ref.eyes[1].centre, l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        n = { x: (b.x - a.x) / l, y: (b.y - a.y) / l, z: (b.z - a.z) / l };
        d = n.x * (a.x + b.x) / 2 + n.y * (a.y + b.y) / 2 + n.z * (a.z + b.z) / 2;
      }
      const empty = { ok: false, species: o.species, style: g.eyeStyle, d, rho: ref.rho, share: [] as number[], whole: { ink: [0, 0], mask: [0, 0], centres: [] as number[][] }, pieces: [] as InkPiece[], line: 0, camErrM: NaN, pngs: [] as string[], diff: { lost: 0, extra: 0, both: 0, lostDx: 0 } };
      const cut = o.exact ? PP.exactCut(g, n, d) : PP.cut(g, n, d);
      if (!sideOf(cut)) return { ...empty, why: cut.refused };
      const X = o.inPlane ? -2.5 * d / (Math.abs(n.x) > 0.5 ? n.x : 1) : 0;
      PTR = { x: 0, y: 0 }; FREEZE = true;
      if (o.tier) stage.setQuality(o.tier as 'med');
      stage.clearBodies();
      const whole = new StubBody(g, { rest: PP, piece: { frac: 1, chunk: false, at: { x: X, y: 0, z: 0 } } });
      const iw = stage.addBody(whole, g, { tier: 'common' }); noBlink(iw);
      run([whole], 100);
      const camP = stage.camera.position.clone(), camQ = stage.camera.quaternion.clone();
      const pin = (): void => { stage.camera.position.copy(camP); stage.camera.quaternion.copy(camQ); stage.camera.updateMatrixWorld(true); };
      pin();
      const scr = (x: number, y: number, z: number): [number, number] => { const v = new THREE.Vector3(x, y, z).project(stage.camera); return [(v.x * 0.5 + 0.5) * W, (0.5 - v.y * 0.5) * H]; };
      const I = grab();
      const c0 = { x: whole.center.x, y: whole.center.y, z: whole.center.z };
      const cw = stage.eyeCentres(iw);
      if (cw.length !== 2) { PTR = null; FREEZE = false; stage.clearBodies(); return { ...empty, why: 'the whole shows ' + cw.length + ' eyes' }; }
      const proj = cw.map((c) => scr(c.x, c.y, c.z));
      const xmid = (proj[0][0] + proj[1][0]) / 2;
      // the footprint of the eyes: where hiding the face changes the whole's frame
      const v0 = stage.views.find((w) => w.id === iw)!;
      v0.face.group.visible = false; const noFace = grab(); v0.face.group.visible = true;
      const mask = new Int8Array(W * H).fill(-1), maskPx = [0, 0];
      for (let p = 0; p < W * H; p++) {
        const q = p * 4;
        if (Math.abs(I[q] - noFace[q]) + Math.abs(I[q + 1] - noFace[q + 1]) + Math.abs(I[q + 2] - noFace[q + 2]) > 45) { const s = (p % W) < xmid ? 0 : 1; mask[p] = s; maskPx[s]++; }
      }
      // ink = a pixel of an eye footprint that is dark WITH the eyes (luma < 24) and was not dark WITHOUT them (luma >= 32): the dark table or the dark sky behind a piece is no evidence
      const lum = (A: Uint8ClampedArray, q: number): number => 0.2126 * A[q] + 0.7152 * A[q + 1] + 0.0722 * A[q + 2];
      const inkMask = (A: Uint8ClampedArray, N: Uint8ClampedArray): Uint8Array => { const m = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) if (mask[p] >= 0 && lum(A, p * 4) < 24 && lum(N, p * 4) >= 32) m[p] = 1; return m; };
      const ink = (A: Uint8ClampedArray, N: Uint8ClampedArray, beyond?: { side: 1 | -1; x: number; slot: number }): { ink: number[]; beyond: number } => {
        const r = [0, 0]; let bey = 0;
        for (let p = 0; p < W * H; p++) {
          const s = mask[p]; if (s < 0) continue;
          const q = p * 4;
          if (lum(A, q) < 24 && lum(N, q) >= 32) {
            r[s]++;
            if (beyond && s === beyond.slot && (((p % W) + 0.5) - beyond.x) * beyond.side < -1.5) bey++;
          }
        }
        return { ink: r, beyond: bey };
      };
      const wi = ink(I, noFace);
      // the cut line on screen (the plane's projection at the eye's height; edge-on when the camera is in the plane)
      const planeX = (n.x !== 0 ? (d - n.y * 0 - n.z * 0) / n.x : 0) + c0.x;
      const L1 = scr(planeX, c0.y + ec.y, c0.z), L2 = scr(planeX, c0.y + ec.y + 0.3, c0.z), line = (L1[0] + L2[0]) / 2;
      const camErr = stage.camera.position.x - planeX;
      const pngs: string[] = [];
      if (o.shot) pngs.push(png());
      const pieces: InkPiece[] = [];
      const wMask = inkMask(I, noFace), pMasks: Uint8Array[] = [], pImgs: Uint8ClampedArray[][] = [];
      for (const [k, s] of [cut.a, cut.b].entries()) {
        stage.clearBodies();
        const b = new StubBody(g, { rest: PP, piece: { frac: s.frac, region: s.region, at: { x: c0.x + s.rest.offset.x, y: c0.y + s.rest.offset.y, z: c0.z + s.rest.offset.z } } });
        const ip = stage.addBody(b, g, { tier: 'common' }); noBlink(ip);
        run([b], 100);
        flushFix(ip, b, { x: c0.x + s.rest.offset.x, y: c0.y + s.rest.offset.y, z: c0.z + s.rest.offset.z });
        pin();
        const A = grab();
        if (o.shot) pngs.push(png());
        const ev = stage.eyeCentres(ip), vv = stage.views.find((w) => w.id === ip)!;
        vv.face.group.visible = false; const AN = grab(); vv.face.group.visible = true;
        const side: 1 | -1 = k === 0 ? 1 : -1;   // piece A is the side n . x >= d (kept to the right of the line for a +x normal)
        const r = ink(A, AN, { side, x: line, slot });
        pMasks.push(inkMask(A, AN)); pImgs.push([A, AN]);
        const mk = vv.face.visibleMask;
        pieces.push({ frac: s.frac, meshes: ev.length, shares: ev.map((e) => e.share), ink: r.ink, inkBeyond: r.beyond, slotsDrawn: [mk & 1, (mk >> 1) & 1], centres: ev.map((e) => [e.x, e.y, e.z]) });
      }
      PTR = null; FREEZE = false;
      stage.clearBodies();
      const diff: InkDiff = { lost: 0, extra: 0, both: 0, lostDx: 0 };
      for (let p = 0; p < W * H; p++) {
        if (mask[p] !== slot) continue;
        const a = pMasks[0][p], b = pMasks[1][p], w = wMask[p];
        if (w && !a && !b) {
          diff.lost++; diff.lostDx += (p % W) + 0.5 - line;
          const why = (diff.why ??= {}), q = p * 4;
          const side = ((p % W) + 0.5 - line) < 0 ? 1 : 0;   // the piece that covers this pixel: B is the left one (index 1) for a +x normal
          const [Ap, An] = pImgs[side];
          const k = lum(Ap, q) >= 24 ? (lum(An, q) >= 32 ? 'pieceBrightWithFace' : 'pieceBgDark') : (lum(An, q) < 32 ? 'noFaceDark' : 'other');
          why[k] = (why[k] ?? 0) + 1;
          if (Math.abs((p % W) + 0.5 - line) <= 2) why.nearLine = (why.nearLine ?? 0) + 1;
        }
        if (!w && (a || b)) diff.extra++;
        if (a && b) diff.both++;
      }
      if (diff.lost) diff.lostDx /= diff.lost;
      return { ok: true, species: o.species, style: g.eyeStyle, d, rho: ref.rho, share: [cut.a.frac, cut.b.frac], whole: { ink: wi.ink, mask: maskPx, centres: cw.map((c) => [c.x, c.y, c.z]) }, pieces, line, camErrM: camErr, pngs, diff };
    },

    /** The left / right eye centre x of the whole in R0 and the bead's reach rho in R0 (planes for the straddle pictures). */
    eyeX(species: string): { x0: number; x1: number; rho: number; r: number } {
      const g = genomeOf(species), wh = PP.whole(g), ref = wholeRefFor({ vertexCount: (wh.restLocal.length / 3) | 0, indices: wh.indices, restLocal: wh.restLocal }, wh.radius, g);
      return { x0: ref.eyes[0].centre.x / wh.radius, x1: ref.eyes[1].centre.x / wh.radius, rho: ref.rho / wh.radius, r: ref.r / wh.radius };
    },

    /**
     * Stage API of part 2: `eyeAnchors` (a whole's two eye centres in its rest frame) against the dev `eyeCentres` of the same body at rest; null for a piece; `addBody` idempotent per body;
     * `setPrimaryBody` and the removal of the old primary; the number of shader programs before / after the first piece view (RP10 in part: the first cut compiles nothing new).
     */
    api(o: { species: string }): { anchorsErrMm: number; anchorsNullForPiece: boolean; idem: boolean; viewsAfterIdem: number; primaryOk: boolean; primaryAfterRemove: boolean; progBefore: number; progAfter: number; progAfterEyes: number; anchorsNullUnknown: boolean } {
      const g = genomeOf(o.species), cut = PP.cut(g, { x: 1, y: 0, z: 0 }, 0);
      if (!sideOf(cut)) throw new Error('refused');
      stage.clearBodies();
      const whole = new StubBody(g, { rest: PP }), iw = stage.addBody(whole, g, { tier: 'common' });
      run([whole], 60); stage.render();
      const an = stage.eyeAnchors?.(iw), ec = stage.eyeCentres(iw), c = whole.center;
      let err = Infinity;
      if (an && ec.length === 2) err = Math.max(...[an.left, an.right].map((a, i) => Math.hypot(ec[i].x - c.x - a.x, ec[i].y - c.y - a.y, ec[i].z - c.z - a.z))) * 1000;
      const idA = stage.addBody(whole, g, { tier: 'common' }), n1 = stage.views.length;
      const progBefore = stage.memory().programs;
      const c0 = whole.center, mk = (s: CutSide): StubBody => pieceBody(g, s, { x: c0.x + s.rest.offset.x, y: c0.y + s.rest.offset.y, z: c0.z + s.rest.offset.z });
      const pa = mk(cut.a), pb = mk(cut.b);
      const ia = stage.addBody(pa, g, { tier: 'common' }), ib = stage.addBody(pb, g, { tier: 'common' });
      run([whole, pa, pb], 6); stage.render();
      const progAfter = stage.memory().programs;
      const nullPiece = stage.eyeAnchors?.(ia) === null && stage.eyeAnchors?.(ib) === null;
      const nullUnknown = stage.eyeAnchors?.(99999) === null;
      const idP = stage.addBody(pa, g, { tier: 'common' });
      stage.setPrimaryBody?.(ib);
      const primaryOk = stage.primaryBodyId?.() === ib;
      stage.removeBody?.(iw); stage.removeBody?.(ia);
      const primaryAfterRemove = stage.primaryBodyId?.() === ib && stage.views.length === 1;
      run([pb], 4); stage.render();
      stage.clearBodies();
      return { anchorsErrMm: err, anchorsNullForPiece: nullPiece, idem: idA === iw && idP === ia, viewsAfterIdem: n1, primaryOk, primaryAfterRemove, progBefore, progAfter, progAfterEyes: stage.memory().programs, anchorsNullUnknown: nullUnknown };
    },

    /**
     * The camera at the swap (CUT2 8.6): the whole alone, settled; then the way the shell will do it (the two pieces added, the primary handed over, the whole removed), settled; the camera
     * position and the framing scale before / after, and the projected size of the squishy's union box. Flush halves must frame exactly like the whole did.
     */
    camSwap(o: { species: string; portrait?: boolean }): { dPosM: number; camScaleBefore: number; camScaleAfter: number; boxBefore: number[]; boxAfter: number[]; dBoxPx: number } {
      const g = genomeOf(o.species), cut = PP.cut(g, { x: 1, y: 0, z: 0 }, 0);
      if (!sideOf(cut)) throw new Error('refused');
      stage.clearBodies();
      const whole = new StubBody(g, { rest: PP }), iw = stage.addBody(whole, g, { tier: 'common' });
      run([whole], 240);
      const box = (): number[] => {
        const W = canvas.width, H = canvas.height; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const v of stage.views) { const P = v.proxy.positions; for (let i = 0; i < P.length; i += 3) { const p = new THREE.Vector3(P[i], P[i + 1], P[i + 2]).project(stage.camera); const sx = (p.x * 0.5 + 0.5) * W, sy = (0.5 - p.y * 0.5) * H; if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy; } }
        return [x0, y0, x1, y1];
      };
      const camB = stage.camera.position.clone(), sB = stage.info.camScale, bB = box();
      const c0 = whole.center, mk = (s: CutSide): StubBody => pieceBody(g, s, { x: c0.x + s.rest.offset.x, y: c0.y + s.rest.offset.y, z: c0.z + s.rest.offset.z });
      const pa = mk(cut.a), pb = mk(cut.b), big = cut.a.frac >= cut.b.frac ? 0 : 1;
      const ia = stage.addBody(pa, g, { tier: 'common' }), ib = stage.addBody(pb, g, { tier: 'common' });
      stage.setPrimaryBody?.(big === 0 ? ia : ib);
      stage.removeBody?.(iw);
      run([pa, pb], 240);
      const camA = stage.camera.position.clone(), sA = stage.info.camScale, bA = box();
      stage.clearBodies();
      return { dPosM: camA.distanceTo(camB), camScaleBefore: sB, camScaleAfter: sA, boxBefore: bB, boxAfter: bA, dBoxPx: Math.max(...bB.map((v, i) => Math.abs(v - bA[i]))) };
    },

    /** Diagnostics of a flush pair: where the stub left the pieces against where they were put, strain / dent readings, mean colour of each half of the picture. */
    diag(o: { species: string }): Record<string, unknown> {
      const g = genomeOf(o.species), R0 = PP.whole(g).radius, W = canvas.width, H = canvas.height;
      const cut = PP.cut(g, { x: 1, y: 0, z: 0 }, 0);
      if (!sideOf(cut)) return { refused: cut.refused };
      stage.clearBodies();
      const whole = new StubBody(g, { rest: PP });
      const iw = stage.addBody(whole, g, { tier: 'common' }); strip(iw);
      run([whole], 120);
      const half = (A: Uint8ClampedArray): { l: number[]; r: number[] } => {
        const acc = { l: [0, 0, 0, 0], r: [0, 0, 0, 0] };
        for (let y = Math.round(H * 0.35); y < Math.round(H * 0.7); y++) for (let x = Math.round(W * 0.37); x < Math.round(W * 0.63); x++) {
          const p = (y * W + x) * 4, o2 = x < W / 2 ? acc.l : acc.r;
          o2[0] += A[p]; o2[1] += A[p + 1]; o2[2] += A[p + 2]; o2[3]++;
        }
        return { l: acc.l.slice(0, 3).map((v) => +(v / acc.l[3]).toFixed(1)), r: acc.r.slice(0, 3).map((v) => +(v / acc.r[3]).toFixed(1)) };
      };
      const imgI = half(grab());
      const c0 = { x: whole.center.x, y: whole.center.y, z: whole.center.z };
      const wmin = (() => { let m = Infinity; for (let i = 1; i < whole.positions.length; i += 3) m = Math.min(m, whole.positions[i]); return m; })();
      stage.clearBodies();
      const want = [cut.a, cut.b].map((sd) => ({ x: c0.x + sd.rest.offset.x, y: c0.y + sd.rest.offset.y, z: c0.z + sd.rest.offset.z }));
      const bodies = [cut.a, cut.b].map((sd, k) => pieceBody(g, sd, want[k]));
      const ids = bodies.map((b) => stage.addBody(b, g, { tier: 'common' })); ids.forEach((i) => strip(i));
      const before = bodies.map((b) => ({ x: b.center.x, y: b.center.y, z: b.center.z }));
      run(bodies, 120);
      const imgJ = half(grab());
      const info = bodies.map((b, k) => {
        const v = stage.views.find((w) => w.id === ids[k])!;
        let smin = 9, smax = 0; for (let i = 0; i < b.strain.length; i++) { smin = Math.min(smin, b.strain[i]); smax = Math.max(smax, b.strain[i]); }
        let lo = Infinity; for (let i = 1; i < b.positions.length; i += 3) lo = Math.min(lo, b.positions[i]);
        return { want: want[k], before: before[k], after: { x: b.center.x, y: b.center.y, z: b.center.z }, lowestY: lo, strain: [smin, smax], press: v.jelly.press, pull: v.jelly.pull, comp: b.metrics.compression, vol: b.metrics.volume, caps: v.jelly.caps.map((c) => ({ id: c.id, n: [c.nx, c.ny, c.nz].map((x) => +x.toFixed(4)), d: +c.d.toFixed(4), area: +c.area.toFixed(4) })), fine: v.jelly.fineCount };
      });
      stage.clearBodies();
      return { R0, wholeLowestY: wmin, imgWhole: imgI, imgPieces: imgJ, pieces: info };
    },

    /**
     * I7 (CUT2 8.1): a merge publishes a NEW PieceInfo object; the view compares body.piece by reference every frame and rebuilds its piece mesh ONCE. Also a quality change with
     * pieces on the stage rebuilds them at the new tier, and a body without a piece never enters the piece path.
     */
    identity(o: { species: string }): { builtSame: boolean; rebuiltOnce: boolean; stableAfter: boolean; sameCountAfter: boolean; tierCounts: Record<string, number[]>; wholeHasPb: boolean } {
      const g = genomeOf(o.species), cut = PP.cut(g, { x: 1, y: 0, z: 0 }, 0);
      if (!sideOf(cut)) throw new Error('refused');
      stage.clearBodies();
      const whole = new StubBody(g, { rest: PP }), iw = stage.addBody(whole, g, { tier: 'common' });
      const wholeHasPb = !!stage.views.find((v) => v.id === iw)!.jelly.pb;
      stage.clearBodies();
      const b = pieceBody(g, cut.a, { x: cut.a.rest.offset.x, y: 0.4, z: 0 });
      const id = stage.addBody(b, g, { tier: 'common' });
      const v = stage.views.find((w) => w.id === id)!;
      run([b], 3);
      const pb0 = v.jelly.pb;
      run([b], 3);
      const builtSame = v.jelly.pb === pb0 && !!pb0;
      const n0 = v.jelly.fineCount;
      // a "merge": same content, a NEW immutable PieceInfo object
      const old = b.piece as NonNullable<typeof b.piece>;
      (b as unknown as { piece: typeof old }).piece = Object.freeze({ whole: old.whole, offset: old.offset, rayOrigin: old.rayOrigin, cells: old.cells });
      run([b], 1);
      const pb1 = v.jelly.pb;
      const rebuiltOnce = pb1 !== pb0 && !!pb1;
      run([b], 3);
      const stableAfter = v.jelly.pb === pb1;
      const sameCountAfter = v.jelly.fineCount === n0;
      const tierCounts: Record<string, number[]> = {};
      for (const q of ['high', 'med', 'low'] as const) {
        stage.setQuality(q); run([b], 2);
        tierCounts[q] = [v.jelly.fineCount, v.jelly.freq];
      }
      stage.setQuality('med');
      stage.clearBodies();
      return { builtSame, rebuiltOnce, stableAfter, sameCountAfter, tierCounts, wholeHasPb };
    },

    /** Fine-vertex totals (the render side of the 6-pieces-cost-2-bodies budget, RP8 in part): a whole against its two halves at each tier. */
    totals(o: { species: string }): Record<string, { whole: number; halves: number[]; ratio: number; drawCalls: { whole: number; halves: number } }> {
      const g = genomeOf(o.species), cut = PP.cut(g, { x: 1, y: 0, z: 0 }, 0);
      if (!sideOf(cut)) throw new Error('refused');
      const out: Record<string, { whole: number; halves: number[]; ratio: number; drawCalls: { whole: number; halves: number } }> = {};
      for (const q of ['high', 'med', 'low'] as const) {
        stage.setQuality(q);
        stage.clearBodies();
        const w = new StubBody(g, { rest: PP }), iw = stage.addBody(w, g, { tier: 'common' });
        run([w], 4); stage.render();
        const wc = stage.views.find((v) => v.id === iw)!.jelly.fineCount, dcw = stage.stats().drawCalls;
        stage.clearBodies();
        const bs = [cut.a, cut.b].map((sd) => pieceBody(g, sd, { x: sd.rest.offset.x, y: 0.4, z: sd.rest.offset.z })), ids = bs.map((b) => stage.addBody(b, g, { tier: 'common' }));
        run(bs, 4); stage.render();
        const hc = ids.map((i) => stage.views.find((v) => v.id === i)!.jelly.fineCount);
        out[q] = { whole: wc, halves: hc, ratio: (hc[0] + hc[1]) / wc, drawCalls: { whole: dcw, halves: stage.stats().drawCalls } };
      }
      stage.setQuality('med');
      stage.clearBodies();
      return out;
    },

    /** RP1 (wiring half): the dev eye count of a whole and of its two halves. Until part 2 gives each eye to the piece that holds it the pieces draw none. */
    rp1(o: { species: string }): { whole: number; pieces: number[]; wholeCentres: number; ok: boolean } {
      const g = genomeOf(o.species), R0 = PP.whole(g).radius;
      const cut = PP.cut(g, { x: 1, y: 0, z: 0 }, 0 * R0);
      stage.clearBodies();
      const whole = new StubBody(g, { rest: PP });
      const id = stage.addBody(whole, g, { tier: 'common' });
      run([whole], 90);
      const out = { whole: stage.eyeCentres(id).length, pieces: [] as number[], wholeCentres: stage.eyeCentres(id).length, ok: true };
      if (!sideOf(cut)) { out.ok = false; return out; }
      stage.clearBodies();
      const c0 = whole.center, bodies = [cut.a, cut.b].map((s) => pieceBody(g, s, { x: c0.x + s.rest.offset.x, y: c0.y + s.rest.offset.y, z: c0.z + s.rest.offset.z }));
      const ids = bodies.map((b) => stage.addBody(b, g, { tier: 'common' }));
      run(bodies, 90);
      out.pieces = ids.map((i) => stage.eyeCentres(i).length);
      stage.clearBodies();
      return out;
    },

    /**
     * Pictures to READ: the whole, then its two pieces apart (flush pose +- `gap` m along the plane normal), from three cameras (front, +60 and -60 degrees: the faces) at the viewport's size.
     * `planes`: [nx, ny, nz, offset in R0] for the cut; the pieces stand where the cut left them, pushed apart along the normal.
     */
    shots(o: { species: string; n: V3; off: number; gap?: number; slide?: number; zoom?: number; yaws?: number[]; tier?: string }): { ok: boolean; why?: string; pngs: string[]; frac: number[]; rimClean: boolean[]; caps: number[] } {
      const g = genomeOf(o.species), R0 = PP.whole(g).radius, gap = o.gap ?? 0.28, slide = o.slide ?? 0;
      const l = Math.hypot(o.n.x, o.n.y, o.n.z), n = { x: o.n.x / l, y: o.n.y / l, z: o.n.z / l };
      const cut = PP.cut(g, n, o.off * R0);
      if (!sideOf(cut)) return { ok: false, why: cut.refused, pngs: [], frac: [], rimClean: [], caps: [] };
      stage.clearBodies();
      const tier = (o.tier ?? 'common') as 'common';
      const bodies = [cut.a, cut.b].map((s, k) => {
        const sgn = k === 0 ? 1 : -1;
        const hl = Math.hypot(n.x, n.z) || 1, px = -n.z / hl, pz = n.x / hl;   // the horizontal direction along the face: `slide` pushes the pieces past each other so a face is seen whole
        return pieceBody(g, s, { x: s.rest.offset.x + sgn * n.x * gap + sgn * px * slide, y: -minY(s.rest.restLocal) + Math.max(0, sgn * n.y * gap), z: s.rest.offset.z + sgn * n.z * gap + sgn * pz * slide });
      });
      // (the stub stands each piece on the table: the lowest rest vertex at y = 0; a tilted plane lets the halves rest at their own height)
      const ids = bodies.map((b) => stage.addBody(b, g, { tier }));
      const pngs: string[] = [];
      if (o.zoom) stage.zoom(o.zoom);
      const yaws = o.yaws ?? [0, 1.05, -1.05];
      let cur = 0;
      for (const yw of yaws) {
        stage.orbit(yw - cur, 0); cur = yw;
        run(bodies, 120);
        pngs.push(png());
      }
      stage.orbit(-cur, 0);
      const views = ids.map((i) => stage.views.find((v) => v.id === i)!);
      const res = { ok: true, pngs, frac: [cut.a.frac, cut.b.frac], rimClean: views.map((v) => v.jelly.rimClean), caps: views.map((v) => v.jelly.caps.filter((c) => c.live).length) };
      stage.clearBodies();
      return res;
    },
  };
}
