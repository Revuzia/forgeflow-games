// probe_data (G1, lane SIM): data referential integrity + frame-data template arithmetic
// (CONTRACT §13 G1, §5, §6.3, §19).
//   - every move's anim.clip exists in clips/<id>.clips.json AND in art/gltf/fighters/<id>.glb;
//   - every warp maps startup -> the clip's contact time (+-1 frame);
//   - every fighter has all 34 shared clips (clips.json + GLB), plus intro / win / taunt clips;
//   - stage / rival / ladder refs resolve; strings for endings / rival banter exist;
//   - template: advantage arithmetic is consistent (KD hitstun long enough, blockstun <= hitstun),
//     and no ground normal is <= -5 on block except sweeps and anti-airs.
// The fixture kits must be clean (always FAIL on any issue). The real data/ is checked too, but in
// the default run it is REPORT-ONLY (lanes FIGHTERS / ASSETS / UI are still producing it) and the
// summary line carries its counts; `--strict` (the G1 gate) fails on any real-data error or pending
// item. Usage: node _harness/probe_data.ts [--strict] [-v]
import { existsSync, readFileSync } from 'node:fs';
import { fixtureData, tester, ROOT } from './fixtures/simkit.ts';
import { loadGameData, SHARED_CLIPS } from '../runtime/src/core/data.ts';
import type { GameData, Move } from '../runtime/src/core/types.ts';

const STRICT = process.argv.includes('--strict');
const VERBOSE = process.argv.includes('-v');
const t = tester('probe_data');

type Level = 'error' | 'pending' | 'warn';
interface Issue { level: Level; msg: string }

function glbAnimations(path: string): Set<string> | null {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return new Set();
  const len = buf.readUInt32LE(12);
  const type = buf.readUInt32LE(16);
  if (type !== 0x4e4f534a) return new Set();
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { animations?: { name?: string }[] };
  return new Set((json.animations ?? []).map((a) => a.name ?? ''));
}

function pwlInverse(warp: [number, number][], sec: number): number {
  for (let i = 1; i < warp.length; i++) {
    const [f0, v0] = warp[i - 1];
    const [f1, v1] = warp[i];
    if ((sec >= v0 && sec <= v1) || (sec <= v0 && sec >= v1)) return v1 === v0 ? f0 : f0 + ((sec - v0) * (f1 - f0)) / (v1 - v0);
  }
  return Number.NaN;
}

function isAntiAir(id: string, mv: Move): boolean {
  const role = (mv as Move & { role?: unknown }).role;
  const roles = Array.isArray(role) ? role.map(String) : typeof role === 'string' ? [role] : [];
  return mv.input === '2H' || roles.some((r) => /anti[-_ ]?air/i.test(r)) || /anti[-_]?air/i.test(id);
}
function isSweep(mv: Move): boolean {
  const role = (mv as Move & { role?: unknown }).role;
  const roles = Array.isArray(role) ? role.map(String) : typeof role === 'string' ? [role] : [];
  return roles.includes('sweep') || (mv.guard === 'L' && (mv.onHit?.kd === 'soft' || mv.onHit?.kd === 'hard'));
}

function g1(data: GameData, glbDir: string | null): { issues: Issue[]; moves: number; advTable: string[] } {
  const issues: Issue[] = [];
  const advTable: string[] = [];
  const sys = data.system;
  const stages = data.stages as { stages?: unknown };
  const stageIds = new Set<string>();
  const st = stages.stages ?? stages;
  if (Array.isArray(st)) for (const s of st) stageIds.add(typeof s === 'string' ? s : String((s as { id?: string }).id));
  else if (st && typeof st === 'object') for (const k of Object.keys(st)) if (k !== 'version' && k !== 'units' && k !== 'budget') stageIds.add(k);
  let moves = 0;
  const kdMin = sys.kd.fallFrames + sys.kd.wakeupFrames + 1;
  for (const id of Object.keys(data.fighters).sort()) {
    const def = data.fighters[id];
    const w = `${id}`;
    const clips = data.clips[id];
    const glb = glbDir ? glbAnimations(`${glbDir}/${id}.glb`) : null;
    if (!clips) issues.push({ level: 'pending', msg: `${w}: clips/${id}.clips.json not generated yet` });
    if (glbDir && !glb) issues.push({ level: 'pending', msg: `${w}: art/gltf/fighters/${id}.glb not built yet` });
    const needClip = (clip: string, what: string): void => {
      if (!clip) {
        issues.push({ level: 'error', msg: `${w} ${what}: no clip name` });
        return;
      }
      if (clips && !clips.clips[clip]) issues.push({ level: 'pending', msg: `${w} ${what}: clip "${clip}" missing from clips.json` });
      if (glb && !glb.has(clip)) issues.push({ level: 'pending', msg: `${w} ${what}: clip "${clip}" missing from the GLB` });
    };
    for (const c of SHARED_CLIPS) needClip(c, `shared`);
    if (def.intro) needClip(def.intro, 'intro');
    for (const c of def.win ?? []) needClip(c, 'win');
    if (def.taunt) needClip(def.taunt, 'taunt');
    // refs
    if (def.stage && stageIds.size > 0 && !stageIds.has(def.stage)) issues.push({ level: 'error', msg: `${w}: stage "${def.stage}" not in stages.json` });
    if (def.rival && def.rival !== '-' && !(def.rival in data.fighters)) issues.push({ level: 'error', msg: `${w}: rival "${def.rival}" is not a fighter` });
    if (Object.keys(data.strings).length > 0) {
      if (!(`ending.${id}` in data.strings)) issues.push({ level: 'pending', msg: `${w}: strings "ending.${id}" missing` });
      if (def.rival && def.rival !== '-' && !(`banter.${id}.${def.rival}` in data.strings)) issues.push({ level: 'pending', msg: `${w}: strings "banter.${id}.${def.rival}" missing` });
    }
    for (const mid of Object.keys(def.moves)) {
      const mv = def.moves[mid];
      moves++;
      const where = `${w} moves.${mid}`;
      if (mv.anim) needClip(mv.anim.clip, `moves.${mid}`);
      else issues.push({ level: 'error', msg: `${where}: no anim.clip` });
      // warp alignment
      const ci = mv.anim && clips ? clips.clips[mv.anim.clip] : undefined;
      if (mv.anim?.warp && ci && ci.contact !== null && ci.contact > 0) {
        const f = pwlInverse(mv.anim.warp, ci.contact);
        if (!(Math.abs(f - mv.startup) <= 1)) issues.push({ level: 'error', msg: `${where}: warp reaches contact ${ci.contact}s at frame ${f.toFixed(2)}, startup is ${mv.startup} (need +-1)` });
      }
      // template arithmetic
      const total = mv.startup + mv.active + mv.recovery;
      const kd = mv.onHit?.kd === 'soft' || mv.onHit?.kd === 'hard';
      const launch = (mv.onHit?.launch?.[1] ?? 0) > 0;
      const strike = (mv.damage ?? 0) > 0 && mv.kind !== 'throw' && mv.kind !== 'cmdgrab' && !mv.projectile && !mv.cinematic;
      if (strike && mv.hitstun !== undefined && mv.blockstun !== undefined) {
        const onHit = mv.hitstun - (mv.active + mv.recovery);
        const onBlock = mv.blockstun - (mv.active + mv.recovery);
        advTable.push(`${where}: ${mv.startup}/${mv.active}/${mv.recovery} hit ${kd ? 'KD' : ''}${onHit >= 0 ? '+' : ''}${onHit} block ${onBlock >= 0 ? '+' : ''}${onBlock}`);
        if (!kd && mv.blockstun > mv.hitstun) issues.push({ level: 'error', msg: `${where}: blockstun ${mv.blockstun} > hitstun ${mv.hitstun}` });
        const juggleOnly = mv.onHit?.groundBounce === true || mv.onHit?.crumple === true;
        if (kd && !launch && !juggleOnly && mv.hitstun < kdMin) issues.push({ level: 'error', msg: `${where}: KD hitstun ${mv.hitstun} < fall+wakeup ${kdMin} (hitstun = frames to act, §19.3)` });
        const groundNormal = (mv.kind === 'normal' || mv.kind === 'command') && !(mv.input ?? '').startsWith('j.');
        if (groundNormal && onBlock <= -5 && !isSweep(mv) && !isAntiAir(mid, mv)) issues.push({ level: 'warn', msg: `${where}: ground normal ${onBlock} on block (template: only sweeps / anti-airs <= -5)` });
      }
      if (mv.grab) {
        // CONTRACT 20.2: grab arithmetic uses grab.adv
        advTable.push(`${where}: grab lock ${mv.grab.frames} dmg@${mv.grab.hitF} KD +${mv.grab.adv}${mv.grab.swap ? ' swap' : ''}${mv.grab.techable === false ? ' untechable' : ''}`);
        if (mv.grab.adv <= 0) issues.push({ level: 'error', msg: `${where}: grab.adv ${mv.grab.adv} <= 0 (the thrower must be ahead)` });
        if (mv.grab.hitF > mv.grab.frames) issues.push({ level: 'error', msg: `${where}: grab.hitF after the lock ends` });
        if (mv.kind === 'throw' && mv.grab.techable !== false && mv.grab.hitF <= data.system.throw.techWindow) issues.push({ level: 'error', msg: `${where}: throw damage on lock frame ${mv.grab.hitF} lands inside the ${data.system.throw.techWindow}-frame tech window` });
      } else if ((mv.kind === 'throw' || mv.kind === 'cmdgrab') && mv.hitstun !== undefined && mv.hitstun <= mv.active + mv.recovery) {
        issues.push({ level: 'error', msg: `${where}: grab hitstun ${mv.hitstun} <= active+recovery ${mv.active + mv.recovery} (no knockdown advantage; or add a grab block, CONTRACT 20.2)` });
      }
      if (total <= 0) issues.push({ level: 'error', msg: `${where}: empty move` });
    }
  }
  // ladder refs (lane AI) when present
  const ladder = data.ladder as Record<string, unknown>;
  const lj = JSON.stringify(ladder);
  for (const m of lj.matchAll(/"(?:fighter|opponent|boss|miniBoss|rival)"\s*:\s*"([a-z_]+)"/g)) {
    if (!(m[1] in data.fighters)) issues.push({ level: 'error', msg: `ladder.json: fighter "${m[1]}" does not exist` });
  }
  return { issues, moves, advTable };
}

// ------------------------------------------------------------------ fixtures (must be clean)
const fx = fixtureData();
t.eq(fx.warnings.length, 0, `fixture load warnings (${fx.warnings.join(' | ') || 'none'})`);
const fr = g1(fx, null);
for (const i of fr.issues) t.ok(false, `fixture ${i.level}: ${i.msg}`);
t.ok(fr.issues.length === 0, `fixtures: ${Object.keys(fx.fighters).length} fighters, ${fr.moves} moves, 0 issues`);
if (VERBOSE) for (const l of fr.advTable) console.log(`  adv  ${l}`);
// derived warp / box from clips (5M has no boxes and no warp in kit_a)
{
  const m5 = fx.fighters.kit_a.moves['5M'];
  const clip = fx.clips.kit_a.clips['a_5m'];
  t.ok(!!m5.anim?.warp && m5.anim.warp[1][0] === m5.startup && m5.anim.warp[1][1] === clip.contact, 'derived warp maps startup -> clip contact', JSON.stringify(m5.anim?.warp));
  const b = m5.boxes?.[0];
  t.ok(!!b && b.x === clip.effector!.at[0] && b.y === clip.effector!.at[1] && b.w === fx.system.boxes.M[0] && b.f[0] === m5.startup && b.f[1] === m5.startup + m5.active - 1, 'derived box centred on effector.at, M size, active frames', JSON.stringify(b));
  t.eq(fx.anims.kit_a.length, 34 + Object.keys(fx.fighters.kit_a.moves).length + 1 + (fx.fighters.kit_a.win ?? []).length + 1, '§17 anim table: 34 shared + moves + intro + wins + taunt');
  t.ok(fx.anims.kit_a[34].moveId === 0 && fx.anims.kit_a[34].clip === fx.fighters.kit_a.moves['5L'].anim!.clip, '§17 anim id 34 = move 0');
}

// ------------------------------------------------------------------ real data (report-only unless --strict)
let realSummary = '';
try {
  const real = loadGameData();
  const rr = g1(real, `${ROOT}art/gltf/fighters`);
  const errors = rr.issues.filter((i) => i.level === 'error');
  const pending = rr.issues.filter((i) => i.level === 'pending');
  const warns = rr.issues.filter((i) => i.level === 'warn');
  const show = (lvl: string, list: Issue[], max: number): void => {
    for (const i of list.slice(0, VERBOSE ? list.length : max)) console.log(`  ${lvl.padEnd(7)} real ${i.msg}`);
    if (!VERBOSE && list.length > max) console.log(`  ${lvl.padEnd(7)} real ... ${list.length - max} more (-v)`);
  };
  show('ERROR', errors, 20);
  show('WARN', warns, 10);
  show('PENDING', pending, 8);
  if (VERBOSE) for (const l of rr.advTable) console.log(`  adv  real ${l}`);
  const loadWarn = real.warnings.length;
  realSummary = `real data/ ${STRICT ? '(STRICT)' : '(report-only; --strict gates it)'}: ${Object.keys(real.fighters).length} fighters, ${rr.moves} moves, ${errors.length} errors, ${warns.length} template warnings, ${pending.length} pending refs, ${loadWarn} load warnings`;
  if (STRICT) {
    t.eq(errors.length, 0, 'real data: 0 errors');
    t.eq(pending.length, 0, 'real data: 0 pending clip / GLB / string refs');
    t.eq(warns.length, 0, 'real data: 0 template warnings');
  }
} catch (e) {
  const msg = String((e as Error).message);
  console.log(`  ERROR   real data/ failed to load:\n${msg.split('\n').slice(0, 25).map((l) => '    ' + l).join('\n')}`);
  realSummary = `real data/ FAILED TO LOAD: ${msg.split('\n')[0]}`;
  if (STRICT) t.ok(false, 'real data loads');
}

t.done(realSummary);
