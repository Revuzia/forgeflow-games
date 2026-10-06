// Phase-2 attack (phys_verify r47): cut every species at random planes and fractions (pieces down to 1/8, up to 6 pieces), the shell's own
// sequence (measureCut -> setNeck eased over NECK_S by family + NECK_HOLD_S at t = 1 -> two pieces at the lobe centres with a 0.35 m/s push),
// collide every frame; toss pieces into each other (6 m/s each) and into the rim (6 m/s), a carry-toss (grab past 1.15 maxPull); then
// reconnect in a random order (receiver setFrac up, giver setFrac to 1/8 + moveTo the receiver, ghost: no contact between the two), until one
// piece is left: frac must be 1, its rest goal the original's, its volume the whole's. Checks every frame: NaN, inversion, table penetration,
// folds; tunnelling (a sampled particle of one body inside another deeper than 0.3 R) every 3rd frame; volume ledger at every rest point.
// node cutattack.ts --root <tree> [--shard k/n] [--only id,..] [--genomes tmpl,soft] [--seed 1] [--replay]
import { argOf, v3, makeFoldMeter, foldOf, volumeOf } from '../verify_repair_a/common.ts';
import type { V3 } from '../verify_repair_a/common.ts';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const root = argOf('--root', S + '/c47/games/wobblehoard');
const [shk, shn] = argOf('--shard', '0/1').split('/').map(Number);
const ONLY = argOf('--only', '') ? argOf('--only', '').split(',') : null;
const GS = argOf('--genomes', 'tmpl,soft').split(',');
const SEED = Number(argOf('--seed', '1'));
const REPLAY = process.argv.includes('--replay');
const { SoftBody } = await import(root + '/src/physics/softbody.ts');
const { CATALOG, speciesTemplateGenome } = await import(root + '/src/data/catalog.ts');
const { MATERIAL_FAMILIES, recoverySeconds95 } = await import(root + '/src/data/materials.ts');
const { quantizeGenome } = await import(root + '/src/core/genome.ts');
const { mulberry32 } = await import(root + '/src/core/rng.ts');
const DT = 1 / 60;
const NECK_S: Record<string, number> = { firmsilicone: 0.4, popdome: 0.4, putty: 0.34, mochidough: 0.34, slowrise: 0.3, marshmallow: 0.3, stickystretch: 0.3, slimegoo: 0.3 };
const NECK_HOLD_S = 0.1, JOIN_S = 0.5, PIECE_MIN = 1 / 8;
const smooth = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
const slowOrPlastic = (fam: string): boolean => { const ph = MATERIAL_FAMILIES[fam].physics; return ph.yieldStrain > 0 || recoverySeconds95(ph) > 3; };
const BLEED: Record<string, number> = {};
for (const k of Object.keys(MATERIAL_FAMILIES)) BLEED[k] = MATERIAL_FAMILIES[k].physics.volBleedMax;

function inside(P: ArrayLike<number>, tris: ArrayLike<number>, x: number, y: number, z: number): boolean {
  const dx = 1, dy = 1e-4, dz = 2.3e-4;
  let c = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, cc = tris[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[cc] - P[a], e2y = P[cc + 1] - P[a + 1], e2z = P[cc + 2] - P[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const id = 1 / det, tx = x - P[a], ty = y - P[a + 1], tz = z - P[a + 2], u = (tx * px + ty * py + tz * pz) * id;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * id;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * id > 0) c++;
  }
  return (c & 1) === 1;
}
interface Pc { b: any; frac: number; chunk: boolean; m: any; ghost: boolean; tag: string }

function runJob(id: string, gn: string, seed: number): any {
  const d = CATALOG.find((x: any) => x.id === id), t = speciesTemplateGenome(id);
  const g = gn === 'soft' ? quantizeGenome({ ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 }) : t;
  const rng = mulberry32(seed);
  const W: any = new SoftBody(g);
  const fam = W.family, R = W.restRadius, wholeRestVol = W.restVolume as number;
  const res: any = { id, g: gn, fam, cuts: 0, refused: 0, misses: 0, fails: [] as string[], worstFold: 0, worstAt: '', f120: 0, tunnels: 0, tunnelAt: '', ledger: [] as number[], pieceVolErr: 0, pieceVolAt: '', events: 0, bumps: 0, hashes: [] as number[] };
  const pcs: Pc[] = [{ b: W, frac: 1, chunk: false, m: makeFoldMeter(W), ghost: false, tag: 'whole' }];
  let frame = 0, phase = 'settle';
  const fail = (s: string): void => { if (res.fails.length < 12) res.fails.push(`${phase} f${frame}: ${s}`); };
  const ev: any[] = [];
  const step = (k: number, each?: (i: number) => void): void => {
    for (let i = 0; i < k; i++) {
      each?.(i);
      const live = pcs.map((p) => p.b);
      for (const p of pcs) p.b.collide(p.ghost ? [] : pcs.filter((q) => q !== p && !q.ghost).map((q) => q.b));
      for (const b of live) b.step(DT);
      frame++;
      for (const p of pcs) {
        ev.length = 0; p.b.drainEvents(ev); res.events += ev.length; for (const e of ev) if (e.kind === 'bump') res.bumps++;
        const P = p.b.positions;
        for (let j = 0; j < P.length; j++) if (!Number.isFinite(P[j])) { fail(`NaN in ${p.tag}`); throw new Error('nan'); }
        const v = volumeOf(P, p.b.indices);
        if (!(v > 0)) { fail(`inverted ${p.tag}`); throw new Error('inv'); }
        let my = 1e9; for (let j = 1; j < P.length; j += 3) if (P[j] < my) my = P[j];
        if (my < -0.01 * p.b.restRadius) fail(`table penetration ${p.tag} ${(my / p.b.restRadius * 100).toFixed(1)}% R`);
        const fo = foldOf(p.b, p.m).worst;
        if (fo > res.worstFold) { res.worstFold = fo; res.worstAt = `${phase} f${frame} ${p.tag} frac ${p.frac.toFixed(3)}`; }
        if (fo > 120) res.f120++;
      }
      if (frame % 3 === 0 && pcs.length > 1) for (const p of pcs) for (const q of pcs) {
        if (p === q || p.ghost || q.ghost) continue;
        const dc = Math.hypot(p.b.center.x - q.b.center.x, p.b.center.y - q.b.center.y, p.b.center.z - q.b.center.z);
        if (dc > 2.5 * (p.b.restRadius + q.b.restRadius)) continue;
        const P = p.b.positions, Qp = q.b.positions, rq = q.b.restRadius;
        for (let j = 0; j < P.length; j += 3 * 4) {
          const x = P[j], y = P[j + 1], z = P[j + 2];
          if (Math.hypot(x - q.b.center.x, y - q.b.center.y, z - q.b.center.z) > 2 * rq) continue;
          if (!inside(Qp, q.b.indices, x, y, z)) continue;
          let md = 1e9; for (let k2 = 0; k2 < Qp.length; k2 += 3) md = Math.min(md, Math.hypot(x - Qp[k2], y - Qp[k2 + 1], z - Qp[k2 + 2]));
          if (md > 0.3 * rq) { res.tunnels++; if (!res.tunnelAt) res.tunnelAt = `${phase} f${frame}: ${p.tag} particle ${(md / rq).toFixed(2)} R inside ${q.tag}`; break; }
        }
      }
    }
  };
  const ledger = (label: string): void => {
    let sum = 0;
    for (const p of pcs) {
      const v = volumeOf(p.b.positions, p.b.indices) / wholeRestVol;
      sum += v;
      const err = Math.abs(v / p.frac - 1);
      if (err > res.pieceVolErr) { res.pieceVolErr = err; res.pieceVolAt = `${label} ${p.tag} frac ${p.frac.toFixed(3)} vol ${v.toFixed(3)}`; }
    }
    res.ledger.push(Number(sum.toFixed(4)));
    res.hashes.push(pcs.reduce((h, p) => (Math.imul(h, 31) + p.b.stateHash()) >>> 0, 7));
  };
  try {
    step(30); ledger('whole');
    // ---- cuts
    phase = 'cut';
    let attempts = 0;
    while (pcs.length < 6 && attempts < 60) {
      attempts++;
      const p = pcs[Math.floor(rng() * pcs.length)], b = p.b, r = b.restRadius;
      const a = rng() * Math.PI * 2, e = Math.acos(2 * rng() - 1), off = 0.5 * r * rng();
      const nrm = v3(Math.sin(e) * Math.cos(a), Math.cos(e), Math.sin(e) * Math.sin(a));
      const plane = { point: v3(b.center.x + nrm.x * off * (rng() - 0.5) * 2, b.center.y + nrm.y * off * (rng() - 0.5) * 2, b.center.z + nrm.z * off * (rng() - 0.5) * 2), normal: nrm };
      const fa = b.measureCut(plane);
      if (fa === null || !(fa > 0 && fa < 1)) { res.misses++; continue; }
      if (Math.min(fa, 1 - fa) * p.frac < PIECE_MIN - 1e-6) { res.refused++; continue; }
      const neckS = NECK_S[fam] ?? 0.25, nk = Math.round((neckS + NECK_HOLD_S) / DT);
      step(nk, (i) => b.setNeck(plane, smooth((i * DT) / neckS)));
      b.setNeck(null, 0);
      // lobe centres (the shell's lobeCentres)
      const P = b.positions; let ax = 0, ay = 0, az = 0, na = 0, bx = 0, by = 0, bz = 0, nb = 0;
      for (let i = 0; i < b.vertexCount; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if ((x - plane.point.x) * nrm.x + (y - plane.point.y) * nrm.y + (z - plane.point.z) * nrm.z >= 0) { ax += x; ay += y; az += z; na++; } else { bx += x; by += y; bz += z; nb++; } }
      const ca = na ? v3(ax / na, ay / na, az / na) : b.center, cb = nb ? v3(bx / nb, by / nb, bz / nb) : b.center;
      const faceA = fa >= 0.5, fA = p.frac * fa, fB = p.frac * (1 - fa), push = 0.35;
      const pa = new SoftBody(g, { piece: { frac: fA, chunk: !(faceA && !p.chunk), cutNormal: v3(-nrm.x, -nrm.y, -nrm.z), at: ca, vel: v3(nrm.x * push, 0, nrm.z * push) } });
      const pb = new SoftBody(g, { piece: { frac: fB, chunk: !(!faceA && !p.chunk), cutNormal: v3(nrm.x, nrm.y, nrm.z), at: cb, vel: v3(-nrm.x * push, 0, -nrm.z * push) } });
      const k = pcs.indexOf(p); pcs.splice(k, 1);
      const A: Pc = { b: pa, frac: fA, chunk: !(faceA && !p.chunk), m: makeFoldMeter(pa), ghost: false, tag: `p${res.cuts}a` }, B: Pc = { b: pb, frac: fB, chunk: !(!faceA && !p.chunk), m: makeFoldMeter(pb), ghost: false, tag: `p${res.cuts}b` };
      // the face piece stays first (the shell's pieces[0])
      if (!A.chunk) pcs.unshift(A); else pcs.push(A);
      if (!B.chunk) pcs.unshift(B); else pcs.push(B);
      res.cuts++;
      step(36);
    }
    step(90); ledger('after cuts');
    res.fracs = pcs.map((p) => Number(p.frac.toFixed(4)));
    // ---- tosses: pairs at each other at 6 m/s each, one into the rim at 6 m/s, one carry-toss
    phase = 'toss';
    for (let k = 0; k < 3 && pcs.length > 1; k++) {
      const i = Math.floor(rng() * pcs.length); let j = Math.floor(rng() * (pcs.length - 1)); if (j >= i) j++;
      const A = pcs[i].b, B = pcs[j].b, dx = B.center.x - A.center.x, dz = B.center.z - A.center.z, l = Math.hypot(dx, dz) || 1;
      A.nudge(v3((6 * dx) / l, 1.5, (6 * dz) / l)); B.nudge(v3((-6 * dx) / l, 1.5, (-6 * dz) / l));
      step(60);
    }
    { const A = pcs[Math.floor(rng() * pcs.length)].b, l = Math.hypot(A.center.x, A.center.z) || 1; A.nudge(v3((6 * A.center.x) / l, 2, (6 * A.center.z) / l)); step(120); }
    {
      const p = pcs[Math.floor(rng() * pcs.length)], b = p.b, Rb = b.restRadius;
      const h = b.raycast(v3(b.center.x, b.center.y + 4 * Rb, b.center.z), v3(0, -1, 0));
      if (h) {
        b.grab(0, h.vertex, h.point);
        const D = 1.6 * b.params.maxPull * Rb;
        const tgt = (s: number): V3 => v3(h.point.x + s * 1.2, h.point.y + D * Math.min(1, s * 3), h.point.z - s * 0.8);
        step(40, (i) => b.grabMove(0, tgt(i / 40)));
        res.carried = !!b.metrics.carried;
        b.grabRelease(0);
        step(120);
      }
    }
    step(60); ledger('after tosses');
    // ---- reconnect in a random order
    phase = 'join';
    while (pcs.length > 1) {
      const i = Math.floor(rng() * pcs.length); let j = Math.floor(rng() * (pcs.length - 1)); if (j >= i) j++;
      const a = pcs[i], b2 = pcs[j];
      const recv = a === pcs[0] ? a : b2 === pcs[0] ? b2 : a.frac >= b2.frac ? a : b2, giver = recv === a ? b2 : a;
      recv.b.setFrac(Math.min(1, recv.frac + giver.frac), JOIN_S); giver.b.setFrac(PIECE_MIN, JOIN_S); giver.ghost = true;
      step(Math.round(JOIN_S / DT), () => giver.b.moveTo(recv.b.center, 1.4));
      giver.b.moveTo(null);
      recv.frac = Math.min(1, recv.frac + giver.frac);
      pcs.splice(pcs.indexOf(giver), 1);
      step(30);
    }
    phase = 'whole again';
    step(150); ledger('final');
    const face = pcs[0];
    res.final = { frac: face.b.frac, fracExact: face.b.frac === 1, chunk: face.chunk, n: face.b.vertexCount };
    // the rest goal against the original rest shape at the piece's mesh detail (probe_cut X04's measure)
    const ref: any = new SoftBody(g, { detail: face.b.vertexCount === 162 ? 2 : face.b.vertexCount === 2562 ? 4 : 3 }), Qr = ref.Q, GB = face.b.GB;
    const ks = Math.cbrt(wholeRestVol / ref.restVolume);
    let s2 = 0; for (let i = 0; i < Qr.length; i++) s2 += (GB[i] - Qr[i] * ks) ** 2;
    res.final.goalRms = Math.sqrt(s2 / (Qr.length / 3)) / R;
    res.final.vol = volumeOf(face.b.positions, face.b.indices) / wholeRestVol;
    res.final.kin = face.b.metrics.kinetic;
    const fo = foldOf(face.b, face.m); res.final.restFold = fo.worst; res.final.n90 = fo.n90;
    res.final.restLimit = slowOrPlastic(fam) ? 90 : 60;
  } catch (e: any) { if (!String(e.message).match(/nan|inv/)) fail('THROW ' + String(e.stack).slice(0, 200)); }
  return res;
}

const jobs: Array<[string, string]> = [];
for (const d of CATALOG) if (!ONLY || ONLY.includes(d.id)) for (const gn of GS) jobs.push([d.id, gn]);
for (let j = 0; j < jobs.length; j++) {
  if (j % shn !== shk) continue;
  const [id, gn] = jobs[j], sd = (SEED * 7919 + j * 104729) >>> 0, t0 = performance.now();
  const r = runJob(id, gn, sd);
  if (REPLAY) { const r2 = runJob(id, gn, sd); r.det = JSON.stringify(r2.hashes) === JSON.stringify(r.hashes) && r2.events === r.events && r2.bumps === r.bumps; }
  r.sec = Number(((performance.now() - t0) / 1000).toFixed(1));
  process.stdout.write(JSON.stringify(r) + '\n');
}
