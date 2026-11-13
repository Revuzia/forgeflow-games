// HIT PARADE - _harness/tool_bodies.ts (lane SIM, CHANGED(SIM) P2, CONTRACT §28.5c). NOT a probe (run_probes only runs
// probe_*.ts). Generates data/bodies.json = the measured, asymmetric hurtbox extents of every fighter from lane ASSETS /
// the fixer's skinned-mesh measurements (tools/measure/<id>.body_all.json, art/blender/measure_body.py):
//   stand  = [max(median idle full_front, median walk_f full_front), max(median idle full_back, median walk_b full_back)]
//   crouch = median crouch_idle full_front / full_back
//   air    = median over jump_up + jump_f + jump_b frames
//   down   = CHANGED(wf6_fixer_core) D1: the WIDEST per-frame extent over kd_fall_f + kd_ground_f + wake_f (the face-down
//            drop off the ring wall after a WALL_SPLAT and its get-up): the sim keeps that much room from the wall behind the
//            body (fighter.ts splatDrop) - a max, not a median: one frame through the wall is visible
// each side never smaller than the fighter's measured push box (fighters/<id>.json `push`), rounded to 1 mm.
// "full" = 98th percentile over ALL skinned vertices (arms / guard hands included - what can be hit), fighter-local, root
// at the origin, x forward. Heights are not touched (fighters/<id>.json `hurt`, FIGHTERS-measured).
//
//   node _harness/tool_bodies.ts           write data/bodies.json
//   node _harness/tool_bodies.ts --check   exit 1 if data/bodies.json differs from what the measurements give (stale)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHECK = process.argv.includes('--check');

interface ClipM { frames: number; full_front: number[]; full_back: number[] }
interface BodyAll { fighter: string; pct: number; clips: Record<string, ClipM> }

function median(a: number[]): number {
  if (a.length === 0) return Number.NaN;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function buildBodies(root: string = ROOT): { json: string; rows: string[]; missing: string[] } {
  const mdir = root + 'tools/measure/';
  const fdir = root + 'data/fighters/';
  const out: Record<string, { stand: [number, number]; crouch: [number, number]; air: [number, number]; down?: [number, number] }> = {};
  const rows: string[] = [];
  const missing: string[] = [];
  const ids = readdirSync(fdir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  for (const id of ids) {
    const mp = `${mdir}${id}.body_all.json`;
    if (!existsSync(mp)) {
      missing.push(id);
      continue;
    }
    const b = JSON.parse(readFileSync(mp, 'utf8')) as BodyAll;
    const fd = JSON.parse(readFileSync(`${fdir}${id}.json`, 'utf8')) as { push?: { front: number; back: number; crouchFront?: number; crouchBack?: number } };
    const med = (clip: string, k: 'full_front' | 'full_back'): number => (b.clips[clip] ? median(b.clips[clip][k]) : Number.NaN);
    const cat = (clips: string[], k: 'full_front' | 'full_back'): number => {
      const a: number[] = [];
      for (const c of clips) if (b.clips[c]) a.push(...b.clips[c][k]);
      return median(a);
    };
    const mx = (...v: number[]): number => Math.max(...v.filter((x) => Number.isFinite(x)));
    const pu = fd.push ?? { front: 0, back: 0 };
    const standF = mx(med('idle', 'full_front'), med('walk_f', 'full_front'), pu.front);
    const standB = mx(med('idle', 'full_back'), med('walk_b', 'full_back'), pu.back);
    const crouchF = mx(med('crouch_idle', 'full_front'), pu.crouchFront ?? pu.front);
    const crouchB = mx(med('crouch_idle', 'full_back'), pu.crouchBack ?? pu.back);
    const air = ['jump_up', 'jump_f', 'jump_b'];
    const airF = mx(cat(air, 'full_front'), pu.front * 0.9);
    const airB = mx(cat(air, 'full_back'), pu.back * 0.9);
    out[id] = { stand: [r3(standF), r3(standB)], crouch: [r3(crouchF), r3(crouchB)], air: [r3(airF), r3(airB)] };
    // CHANGED(wf6_fixer_core) D1: the face-down drop (max over the clips' frames)
    const down = ['kd_fall_f', 'kd_ground_f', 'wake_f'];
    const widest = (k: 'full_front' | 'full_back'): number => {
      let w = Number.NaN;
      for (const c of down) if (b.clips[c]) for (const v of b.clips[c][k]) if (!(v <= w)) w = v;
      return w;
    };
    const downF = widest('full_front');
    const downB = widest('full_back');
    if (Number.isFinite(downF) && Number.isFinite(downB)) out[id].down = [r3(downF), r3(downB)];
    rows.push(`${id.padEnd(9)} stand ${out[id].stand.join('/')}  crouch ${out[id].crouch.join('/')}  air ${out[id].air.join('/')}${out[id].down ? `  down ${out[id].down!.join('/')}` : ''}`);
  }
  const doc = {
    _generated_by: 'node _harness/tool_bodies.ts (lane SIM, CONTRACT 28.5c) from tools/measure/<id>.body_all.json - do not hand-edit',
    _fields: 'fighters.<id>.<posture> = [front, back] metres from the root along the facing (98th-percentile full skinned mesh; median over the posture clips; never smaller than the push box); down = the widest frame of the face-down drop (kd_fall_f / kd_ground_f / wake_f)',
    fighters: out,
  };
  const lines = ['{', `  "_generated_by": ${JSON.stringify(doc._generated_by)},`, `  "_fields": ${JSON.stringify(doc._fields)},`, '  "fighters": {'];
  const keys = Object.keys(out);
  keys.forEach((k, i) => {
    const v = out[k];
    lines.push(`    ${JSON.stringify(k)}: { "stand": [${v.stand.join(', ')}], "crouch": [${v.crouch.join(', ')}], "air": [${v.air.join(', ')}]${v.down ? `, "down": [${v.down.join(', ')}]` : ''} }${i < keys.length - 1 ? ',' : ''}`);
  });
  lines.push('  }', '}', '');
  return { json: lines.join('\n'), rows, missing };
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMain) {
  const r = buildBodies();
  const target = ROOT + 'data/bodies.json';
  for (const row of r.rows) console.log(row);
  if (r.missing.length) console.log(`no measurement (hurtbox stays centred): ${r.missing.join(', ')}`);
  if (CHECK) {
    const cur = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const same = cur.replace(/\r/g, '') === r.json;
    console.log(`${same ? 'PASS' : 'FAIL'} tool_bodies --check: data/bodies.json ${same ? 'matches' : 'is STALE vs'} tools/measure (${r.rows.length} fighters)`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(target, r.json, 'utf8');
  console.log(`wrote data/bodies.json (${r.rows.length} fighters)`);
}
