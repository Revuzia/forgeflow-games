// probe (lane SIM, movement): moves through live Wick waves and held moves through late lane fights (orch1 verify r2 on
// ruling 39, the waves repro rerun and the late held sweep). Runs the controls verifier's own sweeps
// (_harness/verify_controls_sim_orch.ts: `waves`, 3 seeds x 16 fighters x 17 clicks on RIFT and BRIDGE; `held` with the
// enemy seats played and the held button re-sent every 15 ticks, from 8:00, 2 seeds x 16 x 12) and gates them:
//   waves  0 moves that end > 2 m short of an uncrowded point; 0 arrivals that walk over 1.3 x the reference way through
//          the bodies + 1 m (lisvel s3 t1147: a lane in front of a Wick column crossing the click walked 10.8 m against
//          6.6 m; vashil s3 t1665: 11.4 m round a wave that stopped, against 7.7 m); 0 moves that walk over 1 m away
//          from the goal while a way through the bodies exists (a hero boxed in by a wave, the reference finding no way,
//          may back out: marund s3 t1887); 0 moves with > 4 reversals
//   held   0 held moves that regress > 1 m from their best distance with no forced movement (crowd control on the hero,
//          or a step faster than it walks: an enemy's knock or dash pushing it); 0 that end > 2 m short of an uncrowded
//          point; 0 with 5+ reversals
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, finish, section } from './fixtures/sim_fixture.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'vale_click_waves_'));
function run(section: string, env: Record<string, string>): Promise<Record<string, Record<string, unknown>>> {
  const out = join(dir, `${section}.json`);
  return new Promise((res, rej) => {
    const c = spawn(process.execPath, [join(ROOT, '_harness/verify_controls_sim_orch.ts'), section, out], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let err = '';
    c.stdout.on('data', () => {});
    c.stderr.on('data', (d) => { err += String(d); });
    c.on('exit', (code) => {
      if (code !== 0) { rej(new Error(`${section} exited ${code}: ${err.slice(-800)}`)); return; }
      res((JSON.parse(readFileSync(out, 'utf8')) as { res: Record<string, Record<string, unknown>> }).res);
    });
  });
}
const [waves0, wavesFresh, held] = await Promise.all([run('waves', {}), run('waves', { WAVES_SEEDS: '41,57,83' }), run('held', { HELD_BOTS: '1', HELD_T0: '480' })]);
// the verifier's fresh seeds (orch1 r3: odrum s41 t2701, an enemy wave crossing and stalling the hero, 10.46 m against a
// 6.56 m lane) are gated with the original three
const waves: Record<string, Record<string, unknown>> = {};
for (const m of ['rift', 'bridge']) {
  const a0 = waves0[m], a1 = wavesFresh[m];
  waves[m] = { ...a0 };
  for (const k of Object.keys(a0)) if (typeof a0[k] === 'number' && typeof a1[k] === 'number' && !/Max|P50|P95|worst|Pct/.test(k)) waves[m][k] = (a0[k] as number) + (a1[k] as number);
  for (const k of Object.keys(a0)) if (/Max$|^worst/.test(k) && typeof a0[k] === 'number') waves[m][k] = Math.max(a0[k] as number, a1[k] as number);
  waves[m].bad = [...(a0.bad as string[] ?? []), ...(a1.bad as string[] ?? [])];
}
rmSync(dir, { recursive: true, force: true });
const n = (o: Record<string, unknown>, k: string): number => Number(o[k]);

for (const m of ['rift', 'bridge']) {
  const r = waves[m];
  console.log(`waves ${m}`);
  section(`waves ${m}: ${n(r, 'n')} moves through live Wick waves`, () => {
    check('enough moves (>= 700)', n(r, 'n') >= 700, r.n);
    check('0 end > 2 m short of an uncrowded point', n(r, 'endedOver2mShortUncrowded') === 0, r.bad);
    check('0 arrive over 1.3 x the way through the bodies + 1 m', n(r, 'arrivedDetourOverLane1_3p1') === 0, r.bad);
    check('0 walk over 1 m away from the goal while a way through exists', n(r, 'walkedOver1mAwayWithAWayThrough') === 0, r.bad);
    check('0 moves with > 4 reversals', n(r, 'movesOver4Reversals') === 0, r.bad);
    check('0 dither (5 side flips in 1 s)', n(r, 'dither5in1s') === 0, r.bad);
    console.log(`  ${m}: away (boxed in) ${r.walkedOver1mAwayFromGoal}, worst ${r.worstAwayFromGoal}; vs-lane p95 ${r.vsLaneP95} max ${r.vsLaneMax}; reversals ${r.reversals}`);
  });
  const h = held[m];
  section(`held late ${m}: ${n(h, 'n')} held moves through lane fights from 8:00, enemy seats played`, () => {
    check('enough moves (>= 300)', n(h, 'n') >= 300, h.n);
    check('0 regress > 1 m with no forced movement', n(h, 'regressOver1mUnforced') === 0, h.bad);
    check('0 end > 2 m short of an uncrowded point', n(h, 'endedOver2mShortUncrowded') === 0, h.bad);
    check('0 with 5+ reversals', n(h, 'reversals5plus') === 0, h.bad);
    console.log(`  ${m}: boxed in by bodies (no way through, ruling 42) ${h.boxedInShort ?? 0}`);
    console.log(`  ${m}: forced ${h.forcedMoves} (regress > 1 m all moves ${h.regressOver1m}, worst unforced ${h.worstRegressUnforced}); 3+ reversals ${h.reversals3plus}; arrive p95 ${h.arriveP95s} s`);
  });
}
finish('probe_sim_click_waves');
