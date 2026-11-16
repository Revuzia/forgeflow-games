// PLAYGROUND economy probe (PG_QUESTS): EC-01 to EC-03 of _spec/PLAYGROUND_BUILD.md 18. Plain node:  node _harness/probe_pg_economy.ts
// (exit 1 on any failure; about 35 s: EC-01 runs probe_economy.ts unchanged as a child process).
// EC-02 and EC-03 need the real shell rig (PG_SHELL's LIFE host and quest host, PG_LIFE's lifeStep, build order step 3): until then they print
// NOT RUN, never PASS. What runs now is their collection half (EC-02a, EC-03a): the Journal and the reducer fed an hour of LIFE's own records pay
// nothing, and `auto` / prop SoftEvents fed to collection.feed by mistake pay nothing either. QUESTS 11: nothing new feeds the meter.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PlayEventRing, SoftEvent } from '../src/contracts.ts';
import type { StorageLike } from '../src/core/settings.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { createCollection } from '../src/collection/index.ts';
import type { CollectionEvent } from '../src/collection/index.ts';
import { attachJournal } from '../src/collection/journal_store.ts';
import { EV, BY, WISH_STATE, PIECES_USE } from '../src/data/quests.ts';
import { SOCIAL_KIND as S, REACT_KIND as R, USE_VERB as U, WISH_KIND } from '../src/data/life.ts';
import { THING_IDS } from '../src/data/places.ts';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '..');
let bad = 0, notRun = 0;
const row = (id: string, what: string, ok: boolean, extra = ''): void => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${extra ? '  ' + extra : ''}`); };
const skip = (id: string, what: string, why: string): void => { notRun++; console.log(`NOT RUN ${id} ${what}  (${why})`); };

/* ═══════════════════════════════ EC-01: probe_economy unchanged ═══════════════════════════════ */
const SKIP_EC01 = process.argv.includes("--no-ec01");
if (!SKIP_EC01) {
  const r = spawnSync(process.execPath, [resolve(HERE, 'probe_economy.ts')], { encoding: 'utf8', cwd: ROOT, timeout: 300_000 });
  const outText = r.stdout ?? '';
  const m = /mean ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+), median ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) min/.exec(outText);
  const vals = m ? m.slice(1).map(Number) : [];
  const fails = outText.split('\n').filter((l) => l.startsWith('FAIL')).length;
  row('EC-01', 'probe_economy passes unchanged (exit 0, no FAIL) and every paying style needs 3.0 to 3.8 active minutes a capsule (mean and median: squeezer / puller / mixed / holder)',
    r.status === 0 && fails === 0 && vals.length === 8 && vals.every((v) => v >= 3.0 && v <= 3.8), m ? `mean ${vals.slice(0, 4).join('/')}, median ${vals.slice(4).join('/')} min` : `exit ${r.status}, no pace line`);
}

/* ═══════════════════════════════ EC-02a: an hour of LIFE's records through the Journal pays nothing ═══════════════════════════════ */
{
  const map = new Map<string, string>();
  const storage: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
  let T = 20407 * 86_400_000 + 3_600_000;
  const timers: (() => void)[] = [];
  const setTimer = (fn: () => void): unknown => { timers.push(fn); return fn; };
  const clearTimer = (h: unknown): void => { const i = timers.indexOf(h as () => void); if (i >= 0) timers.splice(i, 1); };
  const c = createCollection({ storage, now: () => T, random: mulberry32(4), setTimer, clearTimer });
  const evs: CollectionEvent[] = [];
  c.onEvent((e) => evs.push(e));
  const rt = attachJournal(c, { storage, setTimer, clearTimer })!;
  c.setJournalParty!(c.items().map((it) => it.id));
  const m0 = c.meter(), t0 = JSON.stringify(c.tasks().map((t) => t.progress));
  const cap = 64;
  const ring: PlayEventRing = { n: 0, dropped: 0, kind: new Uint8Array(cap), sub: new Uint8Array(cap), place: new Uint8Array(cap), thing: new Int16Array(cap), a: new Uint8Array(cap),
    b: new Uint8Array(cap), fam: new Uint8Array(cap), n2: new Uint8Array(cap), by: new Uint8Array(cap), flag: new Uint8Array(cap), v: new Float32Array(cap) };
  const push = (k: number, sub: number, place: number, thing: number, a: number, b: number, n2: number, v = 0): void => {
    if (ring.n >= cap) return;
    const i = ring.n++; ring.kind[i] = k; ring.sub[i] = sub; ring.place[i] = place; ring.thing[i] = thing; ring.a[i] = a; ring.b[i] = b; ring.fam[i] = 3; ring.n2[i] = n2; ring.by[i] = BY.SELF; ring.flag[i] = 0; ring.v[i] = v;
  };
  const T0 = (id: string): number => THING_IDS.indexOf(id as typeof THING_IDS[number]);
  // 60 sim minutes, one LIFE record a second (4 squishies out: species 0, 1, 5, 10), travelling Home -> Hearthlog -> Home every 15 minutes
  let place = 0, records = 0;
  for (let s = 0; s < 3600; s++) {
    T += 1000;
    if (s === 30) push(EV.WISH, WISH_STATE.SHOWN, place, 1, 0, 255, 0, WISH_KIND.PLACE);                    // LIFE's scripted first wish
    if (s % 900 === 450) { place = place === 0 ? 1 : 0; push(EV.VISIT, 0, place, -1, 255, 255, 4); }       // the rig's travel (dev hook): not the player
    const k = s % 12, a = [0, 1, 5, 10][s % 4], b = [1, 5, 10, 0][s % 4];
    if (k === 0) push(EV.SOCIAL, S.GREET, place, -1, a, b, 2);
    else if (k === 1) push(EV.SOCIAL, S.SING, place, -1, a, b, 3);
    else if (k === 2) push(EV.SOCIAL, S.PILE, place, place === 0 ? T0('snoozerug') : T0('snugbasket'), a, b, 3);
    else if (k === 3) push(EV.USE, place === 0 ? U.ROLL : U.LISTEN, place, place === 0 ? T0('feltball') : T0('kettle'), a, 255, 1);
    else if (k === 4 && place === 1) push(EV.REACT, R.WARM, 1, T0('hearth'), a, 255, 1);
    else if (k === 5 && place === 1) push(EV.REACT, R.LOVE, 1, -1, a, 255, 1);
    else if (k === 6) push(EV.WISH, WISH_STATE.GRANTED, place, -1, a, 255, 0, WISH_KIND.NAP);              // LIFE alone: a nap wish came true
    else if (k === 7 && place === 1) push(EV.SOCIAL, S.TEETER, 1, T0('rockerboard'), a, b, 2);
    else if (k === 8) push(EV.SIGNATURE, 0, place, -1, a, 255, 1);
    else if (k === 9 && place === 1) push(EV.PIECES, PIECES_USE + U.NAP, 1, T0('snugbasket'), a, 255, 3);
    else if (k === 10) push(EV.SOCIAL, S.NUZZLE, place, -1, a, b, 2);
    records += ring.n;
    c.feedPlay!(ring, T); ring.n = 0;
    if (s % 2 === 0) for (const fn of timers.splice(0)) fn();
  }
  const v = c.journal!()!;
  const quests = evs.filter((e) => e.type === 'quest') as Extract<CollectionEvent, { type: 'quest' }>[];
  const byPlayer = quests.filter((e) => e.byPlayer).length;
  const m1 = c.meter();
  const ready = v.gifts.filter((g) => g.state === 'ready').length;
  const ok = m1.sp === m0.sp && m1.sp === 0 && m1.credits === m0.credits && JSON.stringify(c.tasks().map((t) => t.progress)) === t0 && ready === 0 && quests.length > 0 && byPlayer === 0
    && evs.every((e) => e.type !== 'capsule');
  row('EC-02a', 'the collection half of EC-02: 60 sim minutes of LIFE\'s own records (greets, songs, naps, uses, warmth, love, wishes LIFE granted, signatures, pieces; the rig\'s travel) through feedPlay: 0 SP, 0 task progress, 0 capsules, 0 gifts claimable, while quest moments played, none of them by the player (so 0 haptics by D-84)',
    ok, `${records} records, ${quests.length} quest moments (${byPlayer} by the player), ${v.stamps} stamps, SP ${m1.sp}, credits ${m1.credits}, gifts ready ${ready}`);
  rt.dispose();
  skip('EC-02', 'the real shell rig with LIFE on, 4 moving mock bodies, 60 sim minutes travelling to every place (0 SP, tasks, capsules, gifts, haptics, camera moves), plus 2 minutes on real SoftBodies booping',
    'needs PG_SHELL\'s LIFE host and quest host and PG_LIFE\'s lifeStep (build order step 3)');
}

/* ═══════════════════════════════ EC-03a: auto and prop events pay nothing even if they reach collection.feed ═══════════════════════════════ */
{
  let T = 1_700_000_000_000;
  const c = createCollection({ storage: null, now: () => T, random: mulberry32(5) });
  const before = JSON.stringify(c.meter());
  const evs: SoftEvent[] = [];
  for (const kind of ['land', 'bump'] as const) for (let k = 0; k < 200; k++) {
    evs.push({ kind, at: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, intensity: 0.1 + (k % 9) / 10, heldFor: 0, finger: kind === 'land' ? -1 : 0, auto: true, ...(kind === 'bump' ? (k % 2 ? { prop: k % 5 } : { other: 1 }) : {}) });
  }
  for (const e of evs) { T += 250; c.feed(e, T); }
  row('EC-03a', 'the collection half of EC-03: 400 auto lands and prop / body bumps fed to collection.feed by mistake move nothing (the meter view is unchanged)', JSON.stringify(c.meter()) === before, `${evs.length} events`);
  skip('EC-03', 'a spy on the shell sees every auto or prop event dropped before collection.feed', 'needs PG_SHELL\'s attention wiring (src/shell/attention.ts) and its routing');
}

console.log(`\n${bad === 0 ? 'all run checks passed' : `${bad} FAILED`}; ${notRun} NOT RUN (other lanes' code not there yet)`);
process.exit(bad ? 1 : 0);
