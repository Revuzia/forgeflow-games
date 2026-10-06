// Phase-2 attack, part 2 (phys_verify r47): stacks of 5 mixed-family bodies, collide / piece / cut API with NaN and huge inputs, determinism
// replays, and zero allocation per frame (6 pieces with collide, a neck, a setFrac growth, a carried body).
// node phase2misc.ts --root <tree> [--part stack,hostile,alloc]
import v8 from 'node:v8';
import { argOf, v3, makeFoldMeter, foldOf, volumeOf } from '../verify_repair_a/common.ts';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const root = argOf('--root', S + '/c47/games/wobblehoard');
const PARTS = argOf('--part', 'stack,hostile,alloc').split(',');
const { SoftBody } = await import(root + '/src/physics/softbody.ts');
const { CATALOG, speciesTemplateGenome } = await import(root + '/src/data/catalog.ts');
const DT = 1 / 60;
const tg = (id: string): any => speciesTemplateGenome(id);
const finite = (b: any): boolean => { const P = b.positions; for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) return false; return true; };
const minY = (b: any): number => { let m = 1e9; for (let i = 1; i < b.positions.length; i += 3) m = Math.min(m, b.positions[i]); return m; };
const stepAll = (bs: any[], k: number, each?: (i: number) => void): void => { for (let i = 0; i < k; i++) { each?.(i); for (const b of bs) b.collide(bs); for (const b of bs) b.step(DT); } };

// ---------------------------------------------------------------- stacks of 5
if (PARTS.includes('stack')) {
  const combos = [
    ['puddlo', 'plumpet', 'boingle', 'wisplet', 'kneadle'],      // waterfill pancake at the bottom
    ['dollop', 'twangle', 'crumbit', 'chunkle', 'thumbly'],
    ['cushlet', 'dimpla', 'swishel', 'granulo', 'wrigglo'],
    ['caromel', 'ambrosel', 'marigel', 'somnuff', 'skeinara'],
    ['capnap', 'fossilo', 'cindergoo', 'selenuff', 'prismelo'],
    ['glugbean', 'nuzzo', 'tadpolo', 'hooplet', 'gloopsy'],
  ];
  for (const combo of combos) for (const drop of [0.05, 0.4]) {
    const bs: any[] = []; let y = 0;
    for (const id of combo) {
      const probe: any = new SoftBody(tg(id));
      const h = probe.restRadius * 2.6;   // generous height per body
      const b: any = new SoftBody(tg(id), { piece: { frac: 1, chunk: false, at: v3(0.02 * bs.length, y + probe.restRadius + drop, 0.01 * bs.length) } });
      y += h; bs.push(b);
    }
    const meters = bs.map((b) => makeFoldMeter(b)), rv = bs.map((b) => volumeOf(b.restLocal, b.indices));
    let worst = 0, f120 = 0, fails: string[] = [], order = true, nan = false;
    for (let i = 0; i < 8 * 60; i++) {
      for (const b of bs) b.collide(bs); for (const b of bs) b.step(DT);
      for (let k = 0; k < bs.length; k++) {
        const b = bs[k];
        if (!finite(b)) { nan = true; break; }
        const fo = foldOf(b, meters[k]).worst; if (fo > worst) worst = fo; if (fo > 120) f120++;
        if (!(volumeOf(b.positions, b.indices) > 0)) fails.push(`inverted ${combo[k]} f${i}`);
        if (minY(b) < -0.01 * b.restRadius) fails.push(`table penetration ${combo[k]} f${i}`);
      }
      if (nan) break;
    }
    // final: order of centres along y for bodies still on each other's column, each volume, kinetic
    const cy = bs.map((b) => b.center.y), spread = bs.map((b) => Math.hypot(b.center.x, b.center.z));
    const vols = bs.map((b, k) => volumeOf(b.positions, b.indices) / rv[k]);
    const kin = Math.max(...bs.map((b) => b.metrics.kinetic));
    // any pair whose centres are closer than 0.5 x the smaller radius = sunk into each other
    let sunk = '';
    for (let a = 0; a < bs.length; a++) for (let c = a + 1; c < bs.length; c++) {
      const d = Math.hypot(bs[a].center.x - bs[c].center.x, bs[a].center.y - bs[c].center.y, bs[a].center.z - bs[c].center.z);
      if (d < 0.6 * Math.min(bs[a].restRadius, bs[c].restRadius)) sunk += `${combo[a]}/${combo[c]} ${d.toFixed(2)} m; `;
    }
    console.log(`STACK ${combo.join('>')} drop ${drop}: nan ${nan} worst fold ${worst.toFixed(0)} f120 ${f120} kin ${kin.toFixed(3)} centres y ${cy.map((v) => v.toFixed(2)).join(',')} spread max ${Math.max(...spread).toFixed(2)} m vols ${vols.map((v) => v.toFixed(3)).join(',')} sunk ${sunk || 'none'} ${fails.slice(0, 3).join('; ')}`);
  }
}

// ---------------------------------------------------------------- hostile inputs to the phase-2 API
if (PARTS.includes('hostile')) {
  const bad: any[] = [NaN, Infinity, -Infinity, 1e9, -1e9, 1e300, -5, 0, 'x', null, undefined, {}, [], () => 1];
  const fails: string[] = [];
  const g = tg('tadpolo');
  // hostile piece options
  let built = 0, threw = 0;
  for (const f of bad) for (const at of [v3(NaN, 0, 0), v3(1e9, 1e9, 1e9), v3(0.3, 50, 0), null, 'x']) for (const vel of [v3(1e9, -1e9, NaN), v3(0, 0, 0), null]) for (const cn of [v3(0, 0, 0), v3(NaN, 1, 0), v3(1, 0, 0)]) {
    try { const b: any = new SoftBody(g, { piece: { frac: f, chunk: built % 2 === 0, at, vel, cutNormal: cn } as any }); built++; for (let i = 0; i < 20; i++) b.step(DT); if (!finite(b)) fails.push(`piece frac ${String(f)} at ${JSON.stringify(at)} -> NaN`); if (!(b.frac >= 0.125 && b.frac <= 1)) fails.push(`frac ${b.frac}`); } catch (e: any) { threw++; fails.push(`piece threw: frac ${String(f)}: ${e.message}`); }
  }
  for (const pv of [null, undefined, 'x', 5, {}, { frac: 0.5 }, { frac: 0.5, chunk: 'yes' }]) { try { const b: any = new SoftBody(g, { piece: pv as any }); for (let i = 0; i < 20; i++) b.step(DT); if (!finite(b)) fails.push('piece ' + JSON.stringify(pv) + ' NaN'); } catch (e: any) { threw++; fails.push('piece ' + JSON.stringify(pv) + ' threw ' + e.message); } }
  // cut API and collide with junk, on live bodies with fingers down
  const A: any = new SoftBody(g), B: any = new SoftBody(tg('puddlo'), { piece: { frac: 1, chunk: false, at: v3(0.6, 0, 0) } }), C: any = new SoftBody(g, { piece: { frac: 0.3, chunk: true, at: v3(-0.6, 0, 0.2) } });
  const bs = [A, B, C];
  stepAll(bs, 30);
  const hA = A.raycast(v3(A.center.x, 3, A.center.z), v3(0, -1, 0)); if (hA) { A.fingerDown(0, { point: hA.point, normal: hA.normal, dir: v3(0, -1, 0) }); A.fingerPressure(0, 1); }
  const fake = { center: v3(NaN, NaN, NaN), positions: new Float32Array(30).fill(NaN), vertexCount: 10, restRadius: NaN };
  const junkLists: any[] = [null, undefined, 5, 'abc', {}, [null, undefined, 3, 'x', {}, fake, A, A], [fake], new Array(1000).fill(B), [B, B, B, C, C], { length: 1e9 }, { length: NaN }, { length: -1 }];
  for (let r = 0; r < 4; r++) for (const jl of junkLists) {
    try { A.collide(jl); B.collide(jl); } catch (e: any) { threw++; fails.push(`collide(${Array.isArray(jl) ? 'array ' + jl.length : String(jl)}) threw ${e.message}`); }
    for (const v of bad) {
      try {
        A.measureCut({ point: v3(v, v, v), normal: v3(v, 1, 0) }); A.measureCut(v); A.measureCut({ point: A.center, normal: v3(0, 0, 0) });
        A.setNeck({ point: v3(v, 0, 0), normal: v3(1, v, 0) }, v); A.setNeck({ point: A.center, normal: v3(1, 0, 0) }, v); A.setNeck(v, 0.5);
        C.setFrac(v, v); C.setFrac(0.5, v); C.setFrac(v, 0.2);
      } catch (e: any) { threw++; fails.push(`cut API threw on ${String(v)}: ${e.message}`); }
    }
    stepAll(bs, 5);
  }
  // a plane that misses, a plane through nothing, measureCut must stay in [0,1] or null
  const mcs = [A.measureCut({ point: v3(100, 0, 0), normal: v3(1, 0, 0) }), A.measureCut({ point: A.center, normal: v3(1, 0, 0) }), A.measureCut({ point: A.center, normal: v3(1e300, 0, 0) })];
  A.setNeck(null, 0); A.fingerUp(0);
  for (const b of bs) b.setFrac(b.frac, 0);
  stepAll(bs, 8 * 60);
  for (const [k, b] of bs.entries()) { if (!finite(b)) fails.push(`body ${k} NaN at end`); if (b.metrics.kinetic > 0.02) fails.push(`body ${k} not settled kin ${b.metrics.kinetic.toFixed(3)}`); if (b.debug.safetyResets) fails.push(`body ${k} safetyResets ${b.debug.safetyResets}`); }
  // a 12 m/s head-on nudge between two small chunks (thin pieces) and a 6 m/s one: tunnelling (centres crossing)
  for (const sp of [6, 12]) for (const fr of [0.125, 0.3, 1]) {
    const P1: any = new SoftBody(g, { piece: { frac: fr, chunk: true, at: v3(-0.9, 0, 0) } }), P2: any = new SoftBody(tg('boingle'), { piece: { frac: fr, chunk: true, at: v3(0.9, 0, 0) } });
    const two = [P1, P2]; stepAll(two, 20);
    P1.nudge(v3(sp, 0.5, 0)); P2.nudge(v3(-sp, 0.5, 0));
    let crossed = false, minGap = 9;
    stepAll(two, 90, () => { const gap = P2.center.x - P1.center.x; minGap = Math.min(minGap, gap); if (gap < 0) crossed = true; });
    console.log(`HEAD-ON ${sp} m/s each, frac ${fr}: centres crossed ${crossed}, min centre gap ${minGap.toFixed(3)} m (radii ${P1.restRadius.toFixed(2)} + ${P2.restRadius.toFixed(2)}), finite ${finite(P1) && finite(P2)}`);
  }
  console.log(`HOSTILE: built ${built} hostile pieces, threw ${threw}, measureCut miss/centre/huge-normal ${mcs.map((m) => (m === null ? 'null' : m.toFixed(3))).join(' / ')}, fails ${fails.length}: ${fails.slice(0, 8).join(' | ')}`);
}

// ---------------------------------------------------------------- zero allocation per frame
if (PARTS.includes('alloc')) {
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const empty: number[] = []; for (let k = 0; k < 6; k++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
  const base = empty[empty.length - 1];
  const measure = (name: string, frame: () => void, warm: number): void => {
    for (let i = 0; i < warm; i++) frame();
    let best = Infinity;
    for (let w = 0; w < 3; w++) { const u0 = newUsed(); for (let k = 0; k < 120; k++) frame(); const d = newUsed() - u0; if (d >= 0 && d < best) best = d; }
    console.log(`ALLOC ${name}: ${best - base} B per 120 frames`);
  };
  const g = tg('dollop');
  const pcs: any[] = [new SoftBody(g, { piece: { frac: 0.25, chunk: false, at: v3(0, 0, 0) } })];
  for (let k = 0; k < 5; k++) pcs.push(new SoftBody(g, { piece: { frac: 0.15, chunk: true, cutNormal: v3(Math.cos(k), 0, Math.sin(k)), at: v3(0.8 * Math.cos(k * 1.256), 0.1, 0.8 * Math.sin(k * 1.256)) } }));
  for (const b of pcs) b.warmUp?.();
  const ev: any[] = []; for (let i = 0; i < 64; i++) ev.push(null); ev.length = 0;
  let i = 0;
  measure('6 pieces + collide every frame', () => { i++; for (const b of pcs) b.collide(pcs); for (const b of pcs) { b.step(DT); ev.length = 0; b.drainEvents(ev); } }, 3000);
  const W: any = new SoftBody(g); W.warmUp?.();
  const plane = { point: { x: 0, y: 0.4, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
  let t = 0;
  measure('neck in progress (setNeck every frame, t cycling 0..1)', () => { t += DT; plane.point.y = W.center.y; W.setNeck(plane, (t * 2) % 1); W.step(DT); ev.length = 0; W.drainEvents(ev); }, 3000);
  const F: any = new SoftBody(g, { piece: { frac: 0.3, chunk: true, at: v3(0, 0, 0) } }); F.warmUp?.();
  let k2 = 0;
  measure('setFrac growth / shrink in progress', () => { if (k2++ % 40 === 0) F.setFrac(k2 % 80 === 1 ? 0.9 : 0.2, 0.6); F.step(DT); ev.length = 0; F.drainEvents(ev); }, 3000);
  const Cb: any = new SoftBody(g); Cb.warmUp?.();
  const hc = Cb.raycast(v3(0, 3, 0), v3(0, -1, 0)); Cb.grab(0, hc.vertex, hc.point);
  const tgt = { x: hc.point.x, y: hc.point.y + 3, z: hc.point.z };
  let k3 = 0;
  measure('carried (a grab past maxPull, the hand moving)', () => { k3++; tgt.x = Math.sin(k3 * 0.05) * 0.5; Cb.grabMove(0, tgt); Cb.step(DT); ev.length = 0; Cb.drainEvents(ev); }, 3000);
  console.log(`(carried: ${Cb.metrics.carried})`);
}
