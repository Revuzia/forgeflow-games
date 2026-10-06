// Independent robustness attack (phys_verify). Every species x 2 genome corners x a dense press matrix (top, flanks, feature tips,
// feature bases, valleys between thin features; hold / shove / rub / tap), pinches, a grab of each feature, the ceremony drivers driven
// hard with fingers down, and NaN / huge inputs. One JSON line per body.
// Usage: node attack.ts [--root <tree>] [--shard k/n] [--only id,id] [--genomes soft,hard] [--quick]
import { argOf, v3, makeFoldMeter, foldOf, minY, volumeOf, shapeFit, bitsHash } from '../verify_repair_a/common.ts';
import type { V3 } from '../verify_repair_a/common.ts';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const root = argOf('--root', S + '/head/games/wobblehoard');
const [shk, shn] = argOf('--shard', '0/1').split('/').map(Number);
const ONLY = argOf('--only', '') ? argOf('--only', '').split(',') : null;
const GSEL = argOf('--genomes', 'soft,hard').split(',');
const QUICK = process.argv.includes('--quick');
const { SoftBody } = await import(root + '/src/physics/softbody.ts');
const { CATALOG, speciesTemplateGenome } = await import(root + '/src/data/catalog.ts');
const { MATERIAL_FAMILIES, recoverySeconds95 } = await import(root + '/src/data/materials.ts');
const { evalShape } = await import(root + '/src/data/shapes.ts');
const { quantizeGenome } = await import(root + '/src/core/genome.ts');
const DT = 1 / 60;
const shellP = (t: number, rub = false): number => { const x = Math.min(1, Math.max(0, (t - 0.18) / 0.9)), p = 0.55 + 0.45 * x * x * (3 - 2 * x); return rub && t > 0.15 ? Math.min(p, 0.7) : p; };
const norm = (x: number, y: number, z: number): V3 => { const l = Math.hypot(x, y, z) || 1; return v3(x / l, y / l, z / l); };
const cross = (a: V3, b: V3): V3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const rotToward = (u: V3, t: V3, ang: number): V3 => norm(u.x * Math.cos(ang) + t.x * Math.sin(ang), u.y * Math.cos(ang) + t.y * Math.sin(ang), u.z * Math.cos(ang) + t.z * Math.sin(ang));
const tangents = (u: V3): [V3, V3] => { const a = Math.abs(u.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0); const t1 = norm(...(Object.values(cross(u, a)) as [number, number, number])); const t2 = cross(u, t1); return [t1, t2]; };

interface Pt { label: string; u: V3; kind: 'top' | 'flank' | 'low' | 'tip' | 'base' | 'valley' | 'peak' }
export function pointsOf(d: any): Pt[] {
  const out: Pt[] = [{ label: 'top', u: v3(0.03, 1, 0.05), kind: 'top' }];
  for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; out.push({ label: `flank${k * 45}`, u: v3(Math.cos(a), 0, Math.sin(a)), kind: 'flank' }); }
  for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2 + 0.4; out.push({ label: `low${Math.round((a * 180) / Math.PI)}`, u: norm(Math.cos(a), -0.45, Math.sin(a)), kind: 'low' }); }
  const thin: V3[] = [];
  const pk = d.shape.peak;
  if (pk) {
    const u = v3(pk.dir[0], pk.dir[1], pk.dir[2]);
    out.push({ label: 'peak tip', u, kind: 'peak' });
    const [t1, t2] = tangents(u);
    for (const [n, t] of [['+t1', t1], ['-t1', v3(-t1.x, -t1.y, -t1.z)], ['+t2', t2]] as Array<[string, V3]>) out.push({ label: `peak base ${n}`, u: rotToward(u, t, pk.width), kind: 'base' });
  }
  d.shape.features.forEach((f: any, k: number) => {
    if (f.kind === 'dent') return;
    for (const sx of f.mirrorX ? [1, -1] : [1]) {
      const u = v3(f.dir[0] * sx, f.dir[1], f.dir[2]);
      if (u.y < -0.3) continue;
      const lab = `f${k}${sx < 0 ? "'" : ''}`;
      out.push({ label: `${lab} tip (${f.kind} w${f.width} a${f.amp})`, u, kind: 'tip' });
      thin.push(u);
      let [t1, t2] = tangents(u);
      if (f.kind === 'ridge' && f.n) { t1 = v3(f.n[0] * sx, f.n[1], f.n[2]); t2 = cross(u, t1); }
      for (const [n, t] of [['+a', t1], ['-a', v3(-t1.x, -t1.y, -t1.z)]] as Array<[string, V3]>) {
        const b = rotToward(u, t, f.width * 1.0);
        if (b.y >= -0.3) out.push({ label: `${lab} base ${n}`, u: b, kind: 'base' });
      }
    }
  });
  // valleys: midpoints of pairs of feature tips closer than 1.3 rad
  for (let i = 0; i < thin.length; i++) for (let j = i + 1; j < thin.length; j++) {
    const a = thin[i], b = thin[j], dot = a.x * b.x + a.y * b.y + a.z * b.z;
    if (dot > Math.cos(1.3) && dot < 0.995) { const m = norm(a.x + b.x, a.y + b.y, a.z + b.z); if (m.y >= -0.3) out.push({ label: `valley ${i}-${j}`, u: m, kind: 'valley' }); }
  }
  return out;
}

interface Rec { sc: string; worst: number; f120: number; f115: number; rest: number; restN90: number; missed?: boolean; volMin: number; volMax: number; nan?: boolean; inv?: boolean; pen: number; extra?: any }
const slowOrPlastic = (fam: string): boolean => { const ph = MATERIAL_FAMILIES[fam].physics; return ph.yieldStrain > 0 || recoverySeconds95(ph) > 3; };

export function runBody(id: string, gname: string): any {
  const tmpl = speciesTemplateGenome(id);
  const g = quantizeGenome(gname === 'soft' ? { ...tmpl, firmness: 0, bounce: 1, stretch: 1, size: 1 } : gname === 'hard' ? { ...tmpl, firmness: 1, bounce: 0, stretch: 0, size: 0 } : tmpl);
  const d = CATALOG.find((x: any) => x.id === id);
  const mk = (): any => { const b = new SoftBody(g); for (let i = 0; i < 30; i++) b.step(DT); return b; };
  const b0 = mk();
  const fam = b0.family, R = b0.restRadius, m = makeFoldMeter(b0), rv0 = volumeOf(b0.restLocal, b0.indices);
  for (let i = 0; i < 150; i++) b0.step(DT);
  const restFold0 = foldOf(b0, m).worst;
  const restLimit = slowOrPlastic(fam) ? 90 : 60;
  const recs: Rec[] = [];
  const watch = (b: any, r: Rec): boolean => {
    const f = foldOf(b, m);
    if (!Number.isFinite(f.worst)) { r.nan = true; return false; }
    for (let i = 0; i < b.positions.length; i++) if (!Number.isFinite(b.positions[i])) { r.nan = true; return false; }
    if (f.worst > r.worst) r.worst = f.worst;
    if (f.worst > 120) r.f120++;
    if (f.worst > 115) r.f115++;
    const v = volumeOf(b.positions, b.indices) / rv0;
    if (!(v > 0)) { r.inv = true; return false; }
    if (v < r.volMin) r.volMin = v; if (v > r.volMax) r.volMax = v;
    const my = minY(b) / R; if (my < r.pen) r.pen = my;
    return true;
  };
  const newRec = (sc: string): Rec => ({ sc, worst: 0, f120: 0, f115: 0, rest: 0, restN90: 0, volMin: 9, volMax: 0, pen: 0 });
  const ray = (b: any, u: V3): any => {
    const c = b.center, r = Math.min(1.9, evalShape(d.shape, u.x, u.y, u.z)) + 3;
    const o = v3(c.x + u.x * r * R, Math.max(0.02, c.y + u.y * r * R), c.z + u.z * r * R);
    // aim through the surface point of u (relative to the body centre), not the centre itself
    const tgt = v3(c.x + u.x * 0.5 * R, c.y + u.y * 0.5 * R, c.z + u.z * 0.5 * R);
    const dir = norm(tgt.x - o.x, tgt.y - o.y, tgt.z - o.z);
    const h = b.raycast(o, dir);
    return h ? { h, dir, o } : null;
  };
  const pts = pointsOf(d);
  const modes = QUICK ? ['hold'] : ['hold', 'shove', 'rub', 'tap'];
  for (const p of pts) for (const mode of modes) {
    if (mode === 'tap' && !(p.kind === 'top' || p.kind === 'tip' || p.kind === 'peak')) continue;
    if (mode === 'rub' && (p.kind === 'base' || p.kind === 'low')) continue;
    if (mode !== 'hold' && p.kind === 'flank' && /flank(45|135|225|315)$/.test(p.label)) continue;
    const b = mk(), r = newRec(`${mode} ${p.label}`), hit = ray(b, p.u);
    if (!hit) { r.missed = true; recs.push(r); continue; }
    b.fingerDown(0, { point: hit.h.point, normal: hit.h.normal, dir: hit.dir });
    const [t1] = tangents(p.u);
    const T = mode === 'hold' || mode === 'rub' ? 1.2 : mode === 'shove' ? 0.3 : 0.12;
    let ok = true;
    for (let s = 0, t = 0; t < T + 1.5 && ok; s++) {
      if (t < T) {
        b.fingerPressure(0, mode === 'hold' ? shellP(t) : mode === 'rub' ? shellP(t, true) : mode === 'shove' ? 1 : 0.6);
        if (mode === 'rub' && t > 0.15) {
          const k = 1.5 * (t - 0.15) * Math.cos(t * 2.5), q = v3(hit.h.point.x + t1.x * k, hit.h.point.y + t1.y * k, hit.h.point.z + t1.z * k);
          const hq = b.raycast(v3(q.x - hit.dir.x * 3, q.y - hit.dir.y * 3, q.z - hit.dir.z * 3), hit.dir);
          if (hq) b.fingerMove(0, hq.point);
        }
      } else if (t < T + DT) b.fingerUp(0);
      b.step(DT); t = (s + 1) * DT;
      ok = watch(b, r);
    }
    const f = foldOf(b, m); r.rest = f.worst; r.restN90 = f.n90;
    recs.push(r);
  }
  // pinches: mid-height across x and z, and across every thin feature (two fingers on its two bases)
  const pinches: Array<[string, V3, V3]> = [['pinch x', v3(1, 0, 0), v3(-1, 0, 0)], ['pinch z', v3(0, 0.1, 1), v3(0, 0.1, -1)], ['pinch top-diag', norm(0.7, 0.7, 0), norm(-0.7, 0.7, 0)]];
  for (const p of pts) if (p.kind === 'tip' || p.kind === 'peak') { const [t1] = tangents(p.u); pinches.push([`pinch ${p.label}`, rotToward(p.u, t1, 0.35), rotToward(p.u, v3(-t1.x, -t1.y, -t1.z), 0.35)]); }
  for (const [lab, ua, ub] of pinches) {
    const b = mk(), r = newRec(lab), ha = ray(b, ua), hb = ray(b, ub);
    if (!ha || !hb) { r.missed = true; recs.push(r); continue; }
    b.fingerDown(0, { point: ha.h.point, normal: ha.h.normal, dir: ha.dir }); b.fingerDown(1, { point: hb.h.point, normal: hb.h.normal, dir: hb.dir });
    let ok = true;
    for (let s = 0, t = 0; t < 2.7 && ok; s++) {
      if (t < 1.2) { b.fingerPressure(0, shellP(t)); b.fingerPressure(1, shellP(t)); } else if (t < 1.2 + DT) { b.fingerUp(0); b.fingerUp(1); }
      b.step(DT); t = (s + 1) * DT; ok = watch(b, r);
    }
    const f = foldOf(b, m); r.rest = f.worst; r.restN90 = f.n90; recs.push(r);
  }
  // grab of every feature tip (and the top, and a flank): pull out 3 R along the feature (clamped at maxPull), then 1 R sideways, release
  for (const p of pts) if (p.kind === 'tip' || p.kind === 'peak' || p.kind === 'top' || p.label === 'flank0') {
    const b = mk(), r = newRec(`grab ${p.label}`), hit = ray(b, p.u);
    if (!hit) { r.missed = true; recs.push(r); continue; }
    const P0 = hit.h.point, [t1] = tangents(p.u);
    b.grab(0, hit.h.vertex, P0);
    let ok = true, snap = -1;
    for (let s = 0, t = 0; t < 4.2 && ok; s++) {
      if (t < 0.6) { const k = 3 * R * (t / 0.6); b.grabMove(0, v3(P0.x + p.u.x * k, Math.max(0.05, P0.y + p.u.y * k), P0.z + p.u.z * k)); }
      else if (t < 1.0) { const k = 3 * R, e = R * ((t - 0.6) / 0.4); b.grabMove(0, v3(P0.x + p.u.x * k + t1.x * e, Math.max(0.05, P0.y + p.u.y * k + t1.y * e), P0.z + p.u.z * k + t1.z * e)); }
      else if (t < 1.3) { /* hold */ } else if (t < 1.3 + DT) b.grabRelease(0);
      b.step(DT); t = (s + 1) * DT; ok = watch(b, r);
      const ev: any[] = []; b.drainEvents(ev); for (const e of ev) if (e.kind === 'snap') snap = e.intensity;
    }
    const f = foldOf(b, m); r.rest = f.worst; r.restN90 = f.n90; r.extra = { snap: Number(snap.toFixed(3)) }; recs.push(r);
  }
  // ceremony drivers, hard, with two fingers down; then NaN / huge inputs; then release and settle. Twice, for determinism.
  const ceremony = (): { r: Rec; hash: number; bits: number; settleT: number; shape: number; vol: number; kin: number; restFold: number; safety: number; far: number; cx: number; cz: number } => {
    const b = mk(), r = newRec('ceremony+hostile');
    const ht = ray(b, v3(0.03, 1, 0.05)), hf = ray(b, v3(1, 0, 0));
    if (ht) b.fingerDown(0, { point: ht.h.point, normal: ht.h.normal, dir: ht.dir });
    if (hf) b.fingerDown(1, { point: hf.h.point, normal: hf.h.normal, dir: hf.dir });
    b.fingerPressure(0, 1); b.fingerPressure(1, 1);
    let ok = true, far = 0, i = 0;
    const fr = (f?: () => void): void => { f?.(); b.step(DT); i++; ok = ok && watch(b, r); far = Math.max(far, Math.hypot(b.center.x, b.center.z)); };
    b.tremble(1);
    for (let k = 0; k < 180 && ok; k++) fr(() => { if (k % 5 === 0) b.setFold((k / 5) % 2 === 0 ? 1 : 0); if (k % 10 === 0) b.burstOpen(1); });
    b.moveTo(v3(6, 0.5, -4), 4);
    for (let k = 0; k < 90 && ok; k++) fr(() => { if (k % 5 === 0) b.setFold((k / 5) % 2 === 0 ? 1 : 0); if (k % 10 === 0) b.burstOpen(1); });
    b.moveTo(v3(999, 0, 999), 4); for (let k = 0; k < 30 && ok; k++) fr();
    b.moveTo(v3(0, 0.5, 0), 4);
    for (let k = 0; k < 600 && ok && Math.hypot(b.center.x, b.center.z) > 0.05; k++) fr(() => { if (k % 5 === 0) b.setFold((k / 5) % 2 === 0 ? 1 : 0); });
    // NaN / huge inputs with the fingers still down
    const bad: any[] = [NaN, Infinity, -Infinity, 1e9, -1e9, 1e300, -5, 'x', null, undefined, {}];
    for (const v of bad) {
      fr(() => {
        b.fingerPressure(0, v); b.fingerPressure(1, v); b.setFold(v); b.tremble(v); b.burstOpen(v); b.moveTo({ x: v, y: v, z: v }, v); b.moveTo(v, v);
        b.fingerMove(0, { x: v, y: v, z: v }); b.fingerMove(1, v3(1e9, 1e9, 1e9));
        b.grabMove(0, { x: v, y: 0, z: 0 }); b.nudge({ x: v, y: v, z: v });
        b.grab(1, v, { x: v, y: v, z: v }); b.grab(1, 1e9, v3(0, 1, 0)); b.grab(1, -3, v3(0, 1, 0)); b.grabRelease(1);
        b.fingerDown(1, { point: { x: v, y: v, z: v }, normal: { x: v, y: 0, z: 0 }, dir: v3(0, 0, 0) });
      });
      b.step(v); b.step(v);
      ok = ok && watch(b, r);
    }
    b.step(1e9); b.step(-1); b.step(0); ok = ok && watch(b, r);
    for (let k = 0; k < 20 && ok; k++) fr(() => b.burstOpen(1));        // burst every frame
    b.nudge(v3(40, 3, -40)); for (let k = 0; k < 10 && ok; k++) fr();
    b.fingerPressure(0, 1); b.fingerPressure(1, 1);
    for (let k = 0; k < 30 && ok; k++) fr(() => b.setFold(k & 1));       // fold toggled every frame
    // release everything and settle
    b.setFold(0); b.tremble(0); b.moveTo(null); b.fingerUp(0); b.fingerUp(1); b.grabRelease(0); b.grabRelease(1);
    let settleT = -1;
    for (let k = 0; k < 12 * 60 && ok; k++) { fr(); if (settleT < 0 && k > 30 && b.metrics.kinetic < 0.02) settleT = k * DT; }
    const f = foldOf(b, m); r.rest = f.worst; r.restN90 = f.n90;
    return { r, hash: b.stateHash(), bits: bitsHash(b.positions), settleT, shape: shapeFit(b), vol: b.metrics.volume, kin: b.metrics.kinetic, restFold: f.worst, safety: b.debug.safetyResets, far, cx: b.center.x, cz: b.center.z };
  };
  const c1 = ceremony(), c2 = ceremony();
  // a long-rest check after heavy squeezes for every family (foam / putty / mochi must come back to a sane rest)
  const longRest = (): any => {
    const b = mk(), r = newRec('squeeze x3 then 15 s');
    const ht = ray(b, v3(0.03, 1, 0.05)), ha = ray(b, v3(1, 0, 0)), hb = ray(b, v3(-1, 0, 0));
    let ok = true;
    for (let rep = 0; rep < 3 && ok; rep++) {
      if (ht) b.fingerDown(0, { point: ht.h.point, normal: ht.h.normal, dir: ht.dir });
      for (let k = 0; k < 90 && ok; k++) { b.fingerPressure(0, 1); b.step(DT); ok = watch(b, r); }
      b.fingerUp(0);
      if (ha && hb) { b.fingerDown(0, { point: ha.h.point, normal: ha.h.normal, dir: ha.dir }); b.fingerDown(1, { point: hb.h.point, normal: hb.h.normal, dir: hb.dir }); }
      for (let k = 0; k < 90 && ok; k++) { b.fingerPressure(0, 1); b.fingerPressure(1, 1); b.step(DT); ok = watch(b, r); }
      b.fingerUp(0); b.fingerUp(1);
      for (let k = 0; k < 10 && ok; k++) { b.step(DT); ok = watch(b, r); }
    }
    const sh: number[] = [];
    for (let k = 0; k < 15 * 60 && ok; k++) { b.step(DT); ok = watch(b, r); if (k % 60 === 59) sh.push(Number(shapeFit(b).toFixed(4))); }
    const f = foldOf(b, m); r.rest = f.worst; r.restN90 = f.n90;
    return { r, shape: sh, vol: b.metrics.volume, kin: b.metrics.kinetic };
  };
  const lr = longRest();
  return { id, g: gname, fam, restFold0, restLimit, n: pts.length, recs, cer: { ...c1, r: c1.r }, det: c1.hash === c2.hash && c1.bits === c2.bits, longRest: lr };
}


export { SoftBody, CATALOG, speciesTemplateGenome, MATERIAL_FAMILIES, evalShape, quantizeGenome, shellP, tangents, rotToward, norm };
