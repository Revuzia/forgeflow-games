// UI B6a probe: the 20 trophies, their evaluator, the earned-set save and the portal bridge client, measured from OUTSIDE the code under test (plain node, exits 1 on failure).
//   P  the data file against the publication memo (read from _handoff/design) and against the economy's own constants
//   R  every trophy is reachable from a scripted sequence of REAL game events: a real Collection (createCollection, injected clock and dice) wrapped by the real
//      observer, fed real SoftEvent shapes through collection.feed and real openCapsule / merge / tidy / completeTask calls; the fake game only supplies the per-step
//      samples (Cutter.pieces / busy, SoftMetrics.carried). Boundaries are measured (0.39 s no, 0.4 s yes), and each scenario's unlocked set is compared EXACTLY.
//   U  none unlocks twice (replay in the same page, and after a reload from the saved key)
//   B  the bridge client against a fake window with a fake clock: standalone posts nothing, guest only whoami, silent after 3 tries 4 s apart, paced catch-up,
//      once per slug per account, sender / origin / reqId checks, and every message it can post has exactly the memo's shape
//   S  the save key: its own key, nothing else written, unreadable parked, newer left alone, two tabs merged, no storage
//   T  the toast hook (held until play, held for a ceremony, the announcer fallback), the privacy line against what is really sent, static CSP-style scans
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SoftEvent } from '../src/contracts.ts';
import type { Collection, MergeResult, OpenResult } from '../src/collection/types.ts';
import { createCollection } from '../src/collection/index.ts';
import { findGhostIds } from '../src/collection/ghost.ts';
import { RELEASE_SQUEEZE_MIN_S, SNAP_TASK_INTENSITY, STRETCH_FULL_INTENSITY } from '../src/collection/constants.ts';
import {
  ACHIEVEMENTS, ACH_BY_SLUG, ACH_TOTAL_POINTS, TIER_POINTS, createEvaluator, emptyAchSave, mergeAchSaves, parseAchievements, sanitizeAchSave,
} from '../src/core/achievements.ts';
import type { AchievementDef } from '../src/core/achievements.ts';
import { ACH_BACKUP_KEY, ACH_KEY, createAchStore } from '../src/core/achStore.ts';
import { MEDLEY_WINDOW_MS, PAY } from '../src/core/meter.ts';
import { MERGE_COST } from '../src/core/merge.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { TIERS, TIER_ODDS, tierIndex } from '../src/core/rarity.ts';
import { memoryStorage } from '../src/core/settings.ts';
import { CATALOG, SPECIES_BY_TIER } from '../src/data/catalog.ts';
import { HOARD_KEY } from '../src/collection/constants.ts';
import { createAchievements, observeCollection } from '../src/shell/achievementsBinding.ts';
import type { AchGameLike } from '../src/shell/achievementsBinding.ts';
import { setTrophyToastSink } from '../src/shell/trophyToast.ts';
import type { TrophyToast } from '../src/shell/trophyToast.ts';
import { ACH_GAP_MS, WHOAMI_TRIES, WHOAMI_WAIT_MS, createPortalBridge, portalOriginAllowed } from '../src/portal/bridge.ts';
import type { OutMsg, PortalEnv } from '../src/portal/bridge.ts';
import { PRIVACY_LINE, accountLine, trophyLine } from '../src/portal/copy.ts';
import { PIECE_CEILING } from '../src/shell/cut.ts';   // (re-specified: the owner removed the piece limits on 2026-10-09; the safety ceiling replaces the old MAX_PIECES record)

let bad = 0, total = 0;
const check = (id: string, name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${name}${extra ? '  ' + extra : ''}`); };
const eqSet = (a: Iterable<string>, b: Iterable<string>): boolean => { const x = [...new Set(a)].sort().join(','), y = [...new Set(b)].sort().join(','); return x === y; };
const fmt = (a: Iterable<string>): string => [...a].sort().join(',');

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const SRC = join(ROOT, 'src');
const slugs = ACHIEVEMENTS.map((d) => d.slug);

/* ═════════════════════════════════════════ P: the data ═════════════════════════════════════════ */
const rawFile = JSON.parse(readFileSync(join(SRC, 'data/achievements.json'), 'utf8')) as { achievements: Array<Record<string, unknown>> };
check('P01', '20 rows in the file and all 20 parsed (none left out as malformed)', rawFile.achievements.length === 20 && ACHIEVEMENTS.length === 20, `${rawFile.achievements.length} raw, ${ACHIEVEMENTS.length} parsed`);
const tierCount = (t: string): number => ACHIEVEMENTS.filter((d) => d.tier === t).length;
check('P02', 'tiers 8 bronze / 7 silver / 3 gold / 2 diamond; points are the pipeline defaults 5 / 15 / 30 / 60; total 355 XP',
  tierCount('bronze') === 8 && tierCount('silver') === 7 && tierCount('gold') === 3 && tierCount('diamond') === 2 && ACHIEVEMENTS.every((d) => d.points === TIER_POINTS[d.tier]) && ACH_TOTAL_POINTS === 355,
  `${tierCount('bronze')}/${tierCount('silver')}/${tierCount('gold')}/${tierCount('diamond')} = ${ACH_TOTAL_POINTS} XP`);
check('P03', 'slugs unique, a-z0-9_ and at most 64; names at most 80; descriptions at most 240 (the portal seeder caps)',
  new Set(slugs).size === 20 && slugs.every((s) => /^[a-z][a-z0-9_]{1,63}$/.test(s)) && ACHIEVEMENTS.every((d) => d.name.length <= 80 && d.description.length <= 240));
check('P04', 'exactly two hidden rows: lift_toss and mythic_find', eqSet(ACHIEVEMENTS.filter((d) => d.hidden).map((d) => d.slug), ['lift_toss', 'mythic_find']));

// the publication memo, read from outside: slug, name, tier letter, description and the (H) flag must be what it proposes, verbatim
const MEMO = join(ROOT, '_handoff/design/PUBLISH_CHECKLIST_SHORT.md');
if (existsSync(MEMO)) {
  const memo = readFileSync(MEMO, 'utf8');
  const rows: Array<{ slug: string; hidden: boolean; name: string; tier: string; desc: string }> = [];
  for (const line of memo.split(/\r?\n/)) {
    const m = /^\| ([a-z_0-9]+)( \(H\))? \| (.+?) \| ([BSGD]) \| (.+?) \| (.+) \|$/.exec(line);
    if (m) rows.push({ slug: m[1], hidden: !!m[2], name: m[3], tier: m[4], desc: m[5] });
  }
  const L: Record<string, string> = { bronze: 'B', silver: 'S', gold: 'G', diamond: 'D' };
  const same = rows.length === 20 && rows.every((r, i) => { const d = ACHIEVEMENTS[i]; return d && d.slug === r.slug && d.hidden === r.hidden && d.name === r.name && L[d.tier] === r.tier && d.description === r.desc; });
  check('P05', 'the 20 rows equal PUBLISH_CHECKLIST_SHORT section 3 verbatim (slug, name, tier, description, hidden flag, order)', same, `${rows.length} memo rows`);
  check('P06', 'the memo still says the bridge shapes this client sends: whoami {_reqId}, achievement {achievementSlug}, identity {signedIn, id}',
    /forgeflow:whoami', _reqId/.test(memo) && /forgeflow:achievement', achievementSlug/.test(memo) && /forgeflow:identity', _reqId\?, signedIn, id/.test(memo));
} else check('P05', 'memo present (skipped: _handoff/design/PUBLISH_CHECKLIST_SHORT.md not in this tree)', true, 'SKIP');

// thresholds are data; they must equal the economy's own numbers so the trophies and the meter can never disagree
const trig = (slug: string) => ACH_BY_SLUG.get(slug)!.trigger;
check('P07', 'first_squish asks for the meter\'s squeeze hold (PAY.minSqueezeHoldSeconds = collection RELEASE_SQUEEZE_MIN_S)', trig('first_squish').min === PAY.minSqueezeHoldSeconds && PAY.minSqueezeHoldSeconds === RELEASE_SQUEEZE_MIN_S, `${trig('first_squish').min}`);
check('P08', 'first_stretch asks for the meter\'s stretched-pull level (PAY.pullFullIntensity = SNAP_TASK_INTENSITY); full_stretch for STRETCH_FULL_INTENSITY',
  trig('first_stretch').min === PAY.pullFullIntensity && PAY.pullFullIntensity === SNAP_TASK_INTENSITY && trig('full_stretch').min === STRETCH_FULL_INTENSITY, `${trig('first_stretch').min} / ${trig('full_stretch').min}`);
check('P09', 'the medley window is the meter\'s (MEDLEY_WINDOW_MS) and the description says twelve seconds', trig('medley').windowMs === MEDLEY_WINDOW_MS && MEDLEY_WINDOW_MS === 12000 && /twelve seconds/.test(ACH_BY_SLUG.get('medley')!.description));
check('P10', 'tier finds are the catalog\'s tier indices: rare 2, epic 3, legendary 4, mythic 5; all_fifty = the catalog size; the species rows say 10 / 25 / 40',
  trig('rare_find').min === tierIndex('rare') && trig('epic_find').min === tierIndex('epic') && trig('legendary_find').min === tierIndex('legendary') && trig('mythic_find').min === tierIndex('mythic')
  && trig('all_fifty').min === CATALOG.length && trig('species_10').min === 10 && trig('species_25').min === 25 && trig('species_40').min === 40, `catalog ${CATALOG.length}`);
const numWord = MERGE_COST === 2 ? 'two' : MERGE_COST === 3 ? 'three' : '?';
check('P11', 'first_merge says the merge cost in words (MERGE_COST), so the text cannot go stale when the cost flips', new RegExp(`\\b${numWord}\\b`, 'i').test(ACH_BY_SLUG.get('first_merge')!.description), `MERGE_COST ${MERGE_COST}`);
check('P12', 'four_pieces is reachable: the safety ceiling (cut.ts PIECE_CEILING, the same at every quality tier; re-specified, the owner removed the old limits on 2026-10-09) is at least 4 pieces', trig('four_pieces').min! <= PIECE_CEILING, `ceiling ${PIECE_CEILING}`);
const LOSS = /\b(lose|lost|losing|miss|missed|fail|failed|failure|streak|expire|expires|expired|penalty|punish|hurry|rush|only \d+ left|last chance|never)\b/i;
check('P13', 'kind wording: no loss, miss, streak, expiry or pressure words in any name or description', ACHIEVEMENTS.every((d) => !LOSS.test(d.name) && !LOSS.test(d.description)), ACHIEVEMENTS.filter((d) => LOSS.test(d.name + ' ' + d.description)).map((d) => d.slug).join(','));
const bad1 = parseAchievements({ achievements: [{ slug: 'Bad Slug', name: 'x', description: 'y', tier: 'bronze', points: 5, hidden: false, trigger: { on: 'task' } }, { slug: 'ok_one', name: 'x', description: 'y', tier: 'platinum', points: 5, hidden: false, trigger: { on: 'task' } },
  { slug: 'ok_two', name: 'x', description: 'y', tier: 'bronze', points: 5, hidden: false, trigger: { on: 'warp' } }, { slug: 'good_row', name: 'x', description: 'y', tier: 'bronze', points: 5, hidden: false, trigger: { on: 'task' } }, { slug: 'good_row', name: 'dup', description: 'y', tier: 'bronze', points: 5, hidden: false, trigger: { on: 'task' } }] });
check('P14', 'the data parser drops a bad slug, an unknown tier, an unknown trigger and a duplicate, keeping the one good row', bad1.length === 1 && bad1[0].slug === 'good_row' && parseAchievements(null).length === 0 && parseAchievements({ achievements: 'x' }).length === 0);

/* ═════════════════════════════════════════ the rig: a real Collection, the real observer, a scripted game ═════════════════════════════════════════ */
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);
const bandCentre = (t: number): number => TIER_ODDS.slice(0, t).reduce((a, b) => a + b, 0) + TIER_ODDS[t] / 2;

/** A fake window for the bridge: a manual clock and timers, the posts it received, and delivery of messages from "the parent". */
function fakeEnv(framed: boolean) {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const posts: Array<{ t: number; msg: OutMsg }> = [];
  const listeners = new Set<(data: unknown, origin: string, fromParent: boolean) => void>();
  const env: PortalEnv = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ at: t + ms, fn, id }); return id; },
    clearTimeout: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    framed,
    post: (msg) => { posts.push({ t, msg: JSON.parse(JSON.stringify(msg)) as OutMsg }); },
    onMessage: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
  return {
    env, posts, listeners,
    get t() { return t; },
    advance(ms: number): void {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const nxt = timers[0];
        if (!nxt || nxt.at > end) break;
        timers.shift();
        t = Math.max(t, nxt.at);
        nxt.fn();
      }
      t = end;
    },
    deliver(data: unknown, origin = 'https://forgeflowgames.com', fromParent = true): void { for (const f of [...listeners]) f(data, origin, fromParent); },
    identity(signedIn: boolean, id = 'u-1111', reqId?: string): void {
      const m: Record<string, unknown> = { type: 'forgeflow:identity', signedIn, id: signedIn ? id : null, username: signedIn ? 'someone' : null, avatar_url: null, level: 3 };
      if (reqId !== undefined) m._reqId = reqId;
      this.deliver(m);
    },
    get pendingTimers() { return timers.length; },
  };
}
type FakeEnv = ReturnType<typeof fakeEnv>;

const ev = (kind: SoftEvent['kind'], intensity: number, heldFor: number): SoftEvent => ({ kind, at: { x: 0, y: 0.5, z: 0.5 }, normal: { x: 0, y: 0, z: 1 }, intensity, heldFor, finger: 0 });

interface RigOpts { env?: FakeEnv; achStorage?: ReturnType<typeof memoryStorage>; hoardStorage?: ReturnType<typeof memoryStorage>; start?: number }
function makeRig(o: RigOpts = {}) {
  let T = o.start ?? T0;
  const now = (): number => T;
  const dice: number[] = [];
  const base = mulberry32(0xace5);
  const random = (): number => (dice.length ? dice.shift()! : base());
  const hoardStorage = o.hoardStorage ?? memoryStorage();
  const achStorage = o.achStorage ?? memoryStorage();
  const fe = o.env ?? fakeEnv(false);
  const hoard = createCollection({ storage: hoardStorage, now, random, setTimer: () => 0, clearTimer: () => undefined });
  const ach = createAchievements({ storage: achStorage, now, env: fe.env });
  const c: Collection = ach.observe(hoard);
  const hooks = new Set<(dt: number, t: number) => void>();
  const g = {
    phase: 'play', simTime: 0,
    body: { metrics: { carried: false } },
    bodies: { extras: [] as Array<{ body: { metrics: { carried: boolean } } }> },
    cut: { pieces: 1, busy: false },
    ceremonies: { active: false, pending: false },
    hoard: c,
    onStep(fn: (dt: number, t: number) => void) { hooks.add(fn); return () => { hooks.delete(fn); }; },
    step(dt = 1 / 60) { g.simTime += dt; for (const f of [...hooks]) f(dt, g.simTime); },
  };
  const said: string[] = [];
  const events: Array<{ slug: string; owned: number; at: number }> = [];
  const owned = (): number => hoard.stacks().filter((s) => s.copies > 0).length;
  ach.onUnlock((d) => events.push({ slug: d.slug, owned: owned(), at: T }));   // before attach: a trophy found at attach (retro) must be seen too
  const detach = ach.attach(g as unknown as AchGameLike, { announce: (t) => said.push(t) });
  const r = {
    ach, c, hoard, g, fe, events, said, hoardStorage, achStorage, detach, dice,
    get T() { return T; }, set T(v: number) { T = v; },
    unlocked: (): string[] => events.map((e) => e.slug),
    squeeze(held = 1, gapMs = 20_000): void { T += gapMs; c.feed(ev('release', 0.5, held), T); },
    stretch(level = 0.6, held = 0.6, gapMs = 20_000): void { T += gapMs; c.feed(ev('snap', level, held), T); },
    poke(): void { T += 1000; c.feed(ev('poke', 0.5, 0), T); },
    toss(): void { g.body.metrics.carried = true; g.step(); T += 2000; c.feed(ev('snap', 1, 0.8), T); g.body.metrics.carried = false; g.step(); },
    pieces(n: number, busy = false): void { g.cut.pieces = n; g.cut.busy = busy; g.step(); },
    /** earn a play capsule through the real meter (squeezes 20 s apart on the injected clock; a new day when the day's stop is reached) */
    earn(): void {
      for (let i = 0; i < 20_000; i++) {
        const m = c.meter();
        if (m.playCredits >= 1) return;
        if (m.doneToday) T += DAY;
        r.squeeze(3);
      }
      throw new Error('could not earn a capsule');
    },
    /** earn and open one capsule with the dice forced to a tier and a species slot inside it */
    async capsule(tier: number, slot = 0): Promise<OpenResult> {
      r.earn();
      dice.push(bandCentre(tier), (slot + 0.5) / SPECIES_BY_TIER[tier].length, 0.5);
      return c.openCapsule();
    },
    async mergeSpecies(species: string, u1: number): Promise<MergeResult> {
      const ids = c.mergeInputs(species as never);
      if (!ids) throw new Error(`no mergeable pair of ${species}`);
      const pv = c.previewMerge(ids);
      if (!pv.ok) throw new Error(`preview refused: ${pv.error}`);
      dice.push(u1, 0.5, 0.5);
      return c.merge(ids, pv.digest);
    },
    async task(): Promise<boolean> {
      for (let i = 0; i < 600; i++) {
        const rows = c.tasks();
        const done = rows.find((x) => x.done && !x.claimed);
        if (done) { const res = await c.completeTask(done.def.id); return res.ok; }
        const open = rows.find((x) => !x.done && !x.claimed);
        if (!open) return false;
        const m = open.def.metric;
        if (m === 'squeezes') r.squeeze(Math.max(open.def.param ?? 0.4, 0.4) + 0.2);
        else if (m === 'softPops') r.squeeze(2.2);
        else if (m === 'stretch') r.stretch(1, 0.6);
        else if (m === 'snaps') r.stretch(0.6, 0.6);
        else if (m === 'medleys') { r.squeeze(1); r.stretch(0.6, 0.6, 5000); }
        else r.squeeze(1);
      }
      return false;
    },
  };
  return r;
}
type Rig = ReturnType<typeof makeRig>;

/* ═════════════════════════════════════════ R: every trophy, reachable, exact ═════════════════════════════════════════ */
async function scenario(id: string, name: string, run: (r: Rig) => Promise<string[] | void>, expect: string[]): Promise<Rig> {
  const r = makeRig();
  let got: string[];
  try { await run(r); got = r.unlocked(); } catch (e) { got = [`THREW ${(e as Error).message}`]; }
  check(id, name, eqSet(got, expect) && got.length === new Set(got).size, `unlocked [${fmt(got)}] expected [${fmt(expect)}]`);
  return r;
}

await scenario('R01', 'squeeze: 0.39 s held pays nothing, 0.4 s earns first_squish (a poke and a press never do)', async (r) => {
  r.poke(); r.c.feed(ev('press', 0.5, 0), r.T); r.squeeze(0.39);
  if (r.unlocked().length) throw new Error(`early: ${fmt(r.unlocked())}`);
  r.squeeze(0.4);
}, ['first_squish']);
await scenario('R02', 'stretch: a pull to 0.34 pays nothing, 0.35 earns first_stretch only (not full_stretch)', async (r) => {
  r.stretch(0.34);
  if (r.unlocked().length) throw new Error(`early: ${fmt(r.unlocked())}`);
  r.stretch(0.35);
}, ['first_stretch']);
await scenario('R03', 'full stretch: 0.94 is first_stretch only, 0.95 adds full_stretch', async (r) => {
  r.stretch(0.94);
  if (fmt(r.unlocked()) !== 'first_stretch') throw new Error(`at 0.94: ${fmt(r.unlocked())}`);
  r.stretch(0.95);
}, ['first_stretch', 'full_stretch']);
await scenario('R04', 'medley: a squeeze and a stretch 13 s apart is none; 11.9 s apart earns it; a 0.2 pull is not a stretch', async (r) => {
  r.squeeze(1.0); r.stretch(0.6, 0.6, 13_000);
  if (r.unlocked().includes('medley')) throw new Error('medley at 13 s');
  r.squeeze(1.0, 60_000); r.stretch(0.2, 0.6, 3000);
  if (r.unlocked().includes('medley')) throw new Error('medley from a pull that never stretched');
  r.squeeze(1.0, 60_000); r.stretch(0.6, 0.6, 11_900);
}, ['first_squish', 'first_stretch', 'medley']);
await scenario('R05', 'medley either order: a stretch then a squeeze 5 s later counts (the meter\'s medley and the Today task are order-free)', async (r) => { r.stretch(0.6); r.squeeze(1.0, 5000); },
  ['first_squish', 'first_stretch', 'medley']);
await scenario('R06', 'lift_toss: a plain full pull does not count; carried then let go does; put down without a throw does not', async (r) => {
  r.stretch(1, 0.6);
  if (r.unlocked().includes('lift_toss')) throw new Error('toss without a carry');
  r.g.body.metrics.carried = true; r.g.step(); r.g.body.metrics.carried = false; r.g.step();   // lifted, then put down: no snap
  r.T += 5000; r.c.feed(ev('snap', 1, 0.8), r.T);
  if (r.unlocked().includes('lift_toss')) throw new Error('toss after a put-down');
  r.toss();
}, ['first_stretch', 'full_stretch', 'lift_toss']);
await scenario('R07', 'lift_toss also from a squishy on the mat (an extra body carried)', async (r) => {
  r.g.bodies.extras.push({ body: { metrics: { carried: true } } }); r.g.step(); r.T += 1000; r.c.feed(ev('snap', 1, 0.5), r.T);
}, ['lift_toss', 'first_stretch', 'full_stretch']);
await scenario('R08', 'cuts: 1 -> 2 is first_cut; an instant reconnect (leaving) is not whole_again; 3 pieces is not four; 4 earns four_pieces', async (r) => {
  r.pieces(1, true); r.pieces(2, false);
  if (fmt(r.unlocked()) !== 'first_cut') throw new Error(`after the cut: ${fmt(r.unlocked())}`);
  r.pieces(1, false);   // forced whole by leaving: busy was false
  if (r.unlocked().includes('whole_again')) throw new Error('whole_again from an instant reconnect');
  r.pieces(3, false);
  if (r.unlocked().includes('four_pieces')) throw new Error('four at 3');
  r.pieces(4, false);
}, ['first_cut', 'four_pieces']);
await scenario('R09', 'whole_again: pieces back to ONE while a join was playing; 3 -> 2 is not enough', async (r) => {
  r.pieces(3, false); r.pieces(2, true); r.pieces(2, false);
  if (r.unlocked().includes('whole_again')) throw new Error('whole_again at 2 pieces');
  r.pieces(2, true); r.pieces(1, false);
}, ['first_cut', 'whole_again']);
await scenario('R10', 'a first capsule (common) earns first_capsule; earning it through the real meter took squeezes, so first_squish comes with it, and nothing else', async (r) => { const o = await r.capsule(0); if (!o.ok) throw new Error('open failed'); }, ['first_capsule', 'first_squish']);
for (const [tier, extra] of [[2, ['rare_find']], [3, ['rare_find', 'epic_find']], [4, ['rare_find', 'epic_find', 'legendary_find']], [5, ['rare_find', 'epic_find', 'legendary_find', 'mythic_find']]] as Array<[number, string[]]>) {
  await scenario(`R${tier + 9}`, `an opened ${TIERS[tier]} earns first_capsule and every find up to its tier (${extra.join(', ')}), plus first_squish from the squeezes that earned the capsule`, async (r) => { const o = await r.capsule(tier); if (!o.ok || o.tier_idx !== tier) throw new Error(`rolled tier ${o.ok ? o.tier_idx : o.error}`); }, ['first_capsule', 'first_squish', ...extra]);
}
{
  const r = makeRig();
  const done = await r.task();
  const u = r.unlocked();
  check('R16', 'a task claimed through the real call earns first_task (the touches that finished it may earn the squeeze or stretch rows, never a capsule or merge row)', done && u.includes('first_task') && !u.includes('first_capsule') && !u.includes('first_merge') && r.ach.save.counters.tasks === 1, `[${fmt(u)}]`);
}

// merges: a 'stay' merge is first_merge only; a lifted rarity adds tier_up; Tidy-up merges count; a Mythic by merge earns mythic_find
{
  const r = makeRig();
  const A = SPECIES_BY_TIER[0][0].id;
  for (let i = 0; i < 3; i++) { const o = await r.capsule(0, 0); if (!o.ok) throw new Error('open'); }
  const before = r.unlocked();
  const m1 = await r.mergeSpecies(A, 0.999999);
  check('R17', 'a merge that stays at its rarity earns first_merge and not tier_up', m1.ok && !m1.tier_up && eqSet(r.unlocked().filter((s) => !before.includes(s)), ['first_merge']), `new [${fmt(r.unlocked().filter((s) => !before.includes(s)))}] tier_up ${m1.ok ? m1.tier_up : '?'}`);
  for (let i = 0; i < 2; i++) await r.capsule(0, 0);
  const m2 = await r.mergeSpecies(A, 0.0001);
  check('R18', 'a merge that lifts the rarity earns tier_up', m2.ok && m2.tier_up && r.unlocked().includes('tier_up'), `${m2.ok ? 'tier_idx ' + m2.tier_idx : m2.error}`);
}
{
  const r = makeRig();
  const A = SPECIES_BY_TIER[0][1].id;
  for (let i = 0; i < 3; i++) await r.capsule(0, 1);
  const plan = r.c.tidyPlan({ includeRare: false });
  r.dice.push(0.999999, 0.5, 0.5);
  const t = await r.c.tidy(plan);
  check('R19', 'a Tidy-up merge counts as a merge (first_merge), through the observer\'s tidy hook', t.ok && t.done >= 1 && r.unlocked().includes('first_merge') && !r.unlocked().includes('tier_up'), `plan ${JSON.stringify(plan.length)} done ${t.done}; ${A}`);
}
{
  const r = makeRig();
  const L = SPECIES_BY_TIER[4][0].id;
  for (let i = 0; i < 3; i++) await r.capsule(4, 0);
  const pre = r.unlocked();
  const m = await r.mergeSpecies(L, 0.0001);
  check('R20', 'a Legendary merged up to a Mythic earns mythic_find through MergeOk (not only OpenOk)', m.ok && m.tier_idx === 5 && r.unlocked().includes('mythic_find') && !pre.includes('mythic_find'), m.ok ? `tier_idx ${m.tier_idx}` : m.error);
}

// species counts, measured at the moment each trophy fires: 10, 25, 40 and 50 different squishies
{
  const r = makeRig();
  for (let t = 0; t < TIERS.length; t++) for (let k = 0; k < SPECIES_BY_TIER[t].length; k++) {
    const have = r.hoard.stacks().find((s) => s.species === SPECIES_BY_TIER[t][k].id)!.copies > 0;
    if (!have) await r.capsule(t, k);
  }
  const at = (slug: string): number | null => { const e = r.events.find((x) => x.slug === slug); return e ? e.owned : null; };
  check('R21', 'species_10 / species_25 / species_40 / all_fifty fire at exactly 10 / 25 / 40 / 50 species owned', at('species_10') === 10 && at('species_25') === 25 && at('species_40') === 40 && at('all_fifty') === 50, `at ${at('species_10')}/${at('species_25')}/${at('species_40')}/${at('all_fifty')}`);
  check('R22', 'owning all 50 by capsule also found every tier up to Mythic, each trophy once', ['first_capsule', 'rare_find', 'epic_find', 'legendary_find', 'mythic_find'].every((s) => r.unlocked().includes(s)) && new Set(r.unlocked()).size === r.unlocked().length);
  check('R23', 'progress for the species rows reads 50 of 50 and counters keep the lifetime numbers', r.ach.evaluator.progress('all_fifty')?.value === 50 && r.ach.evaluator.progress('species_10')?.target === 10 && r.ach.evaluator.progress('first_squish') === null && r.ach.save.counters.capsules >= 49);
}
// a player who already owns 12 species when counting starts: species_10 is found at attach (retro), nothing else
{
  const hs = memoryStorage();
  const pre = makeRig({ hoardStorage: hs });
  for (let k = 0; k < 11; k++) await pre.capsule(0, k);
  pre.hoard.flush();
  const r = makeRig({ hoardStorage: hs, start: pre.T });
  check('R24', 'a Hoard that already holds 10+ species earns species_10 when counting starts (and only that)', eqSet(r.unlocked(), ['species_10']) && r.ach.save.counters.species >= 10, `[${fmt(r.unlocked())}]`);
}

/* ═════════════════════════════════════════ the master run: all 20, signed in, then replay ═════════════════════════════════════════ */
async function master(r: Rig): Promise<void> {
  r.squeeze(0.4); r.stretch(0.35); r.stretch(0.95);
  r.squeeze(1.0, 60_000); r.stretch(0.6, 0.6, 4000);
  r.toss();
  r.pieces(1, true); r.pieces(2); r.pieces(2, true); r.pieces(1, false); r.pieces(3); r.pieces(4); r.pieces(1, false);
  await r.task();
  const A = SPECIES_BY_TIER[0][2].id;
  for (let i = 0; i < 3; i++) await r.capsule(0, 2);
  await r.mergeSpecies(A, 0.999999);
  for (let i = 0; i < 2; i++) await r.capsule(0, 2);
  await r.mergeSpecies(A, 0.0001);
  for (let t = 0; t < TIERS.length; t++) for (let k = 0; k < SPECIES_BY_TIER[t].length; k++) {
    if (r.hoard.stacks().find((s) => s.species === SPECIES_BY_TIER[t][k].id)!.copies === 0) await r.capsule(t, k);
  }
}
const sk = fakeEnv(true);
const M = makeRig({ env: sk });
M.ach.bridge.start();
sk.identity(true, 'acct-A', 'sk1');
check('R25', 'the master run in a signed-in portal frame: whoami asked once, the answer is taken (state signedIn)', M.ach.bridge.state === 'signedIn' && sk.posts.filter((p) => p.msg.type === 'forgeflow:whoami').length === 1);
await master(M);
sk.advance(60_000);
const earnedM = M.unlocked();
check('R26', 'EVERY one of the 20 trophies was earned by the scripted real events, each exactly once', eqSet(earnedM, slugs) && earnedM.length === 20, `${new Set(earnedM).size}/20 [missing: ${slugs.filter((s) => !earnedM.includes(s)).join(',') || 'none'}]`);
const achPosts = sk.posts.filter((p) => p.msg.type === 'forgeflow:achievement');
const postedSlugs = achPosts.map((p) => (p.msg as { achievementSlug: string }).achievementSlug);
check('R27', 'all 20 were posted to the portal, once each, with no other kind of message but the one whoami', eqSet(postedSlugs, slugs) && postedSlugs.length === 20 && sk.posts.length === 21, `${postedSlugs.length} achievement posts of ${sk.posts.length}`);
let minGap = Infinity;
for (let i = 1; i < achPosts.length; i++) minGap = Math.min(minGap, achPosts[i].t - achPosts[i - 1].t);
check('R28', 'consecutive achievement posts are at least 1 s apart (measured on the bridge clock)', minGap >= 1000, `min gap ${minGap} ms over ${achPosts.length} posts (ACH_GAP_MS ${ACH_GAP_MS})`);
const ghostIds = new Set(M.hoard.items().map((i) => i.id));
check('R29', 'no ghost item id (nor any Hoard data) is in anything posted (the memo\'s C09 outbound guard)', findGhostIds(sk.posts.map((p) => p.msg), ghostIds).length === 0 && ghostIds.size > 40, `${ghostIds.size} ghost ids checked`);
const savedText = M.achStorage.getItem(ACH_KEY) ?? '';
const saved = JSON.parse(savedText || 'null');
check('R30', 'the trophies were written to wobblehoard:v1:ach: 20 earned, counters from the real events, and nothing else (no name, no id, no username)',
  !!saved && Object.keys(saved.earned).length === 20 && saved.counters.squeezes >= 1 && saved.counters.stretches >= 2 && saved.counters.tosses === 1 && saved.counters.cuts >= 1 && saved.counters.joins >= 1 && saved.counters.merges === 2 && saved.counters.tasks === 1 && saved.counters.species === 50
  && eqSet(Object.keys(saved), ['v', 'since', 'earned', 'counters']) && !/acct-A|someone|username|avatar/.test(savedText), JSON.stringify(saved?.counters));
check('R31', 'the Hoard row was never touched: only the hoard keys sit in the Hoard storage, only wobblehoard:v1:ach in the trophy storage',
  !Object.keys(M.hoardStorage.dump()).includes(ACH_KEY) && Object.keys(M.achStorage.dump()).join() === ACH_KEY && (ACH_KEY as string) !== (HOARD_KEY as string) && Object.keys(M.hoardStorage.dump()).every((k) => k.startsWith('wobblehoard:v')), Object.keys(M.hoardStorage.dump()).join());

// U: none unlocks twice. Same page: the whole script again. After a reload: a new rig on the saved key.
const evBefore = M.events.length;
await master(M);
check('U01', 'the same script replayed in the same page unlocks nothing and posts nothing more (counters keep counting)', M.events.length === evBefore && M.ach.save.counters.merges >= 4 && sk.posts.length === 21, `${M.events.length - evBefore} new unlocks, ${sk.posts.length} posts`);
{
  M.ach.store.flush();
  const r2 = makeRig({ achStorage: M.achStorage, start: M.T + DAY });
  const s0 = M.achStorage.getItem(ACH_KEY);
  await master(r2);
  r2.ach.store.flush();
  check('U02', 'after a reload (a new page on the saved key) the script unlocks nothing, and the saved earned set is unchanged', r2.events.length === 0 && Object.keys(r2.ach.save.earned).length === 20 && JSON.stringify(JSON.parse(M.achStorage.getItem(ACH_KEY)!).earned) === JSON.stringify(JSON.parse(s0!).earned) && JSON.parse(M.achStorage.getItem(ACH_KEY)!).counters.merges > JSON.parse(s0!).counters.merges);
}
// determinism: the same script twice from the same start gives the same earned set, order and stamps
{
  const a = makeRig(), b = makeRig();
  await master(a); await master(b);
  check('U03', 'deterministic: two runs of the script from the same clock and dice give the same trophies in the same order with the same stamps', JSON.stringify(a.events) === JSON.stringify(b.events) && JSON.stringify(a.ach.save) === JSON.stringify(b.ach.save), `${a.events.length} unlocks each`);
}

/* ═════════════════════════════════════════ B: the bridge client ═════════════════════════════════════════ */
const knownSlug = (s: string): boolean => ACH_BY_SLUG.has(s);
const bridgeOn = (fe: FakeEnv, earned: string[] = []) => createPortalBridge({ env: fe.env, known: knownSlug, earned: () => earned });
{
  const fe = fakeEnv(false);
  const b = bridgeOn(fe, ['first_squish']);
  b.start(); b.achievement('first_squish'); fe.advance(120_000);
  check('B01', 'standalone (no parent frame): nothing is posted in two minutes, no message listener is installed, state standalone', fe.posts.length === 0 && fe.listeners.size === 0 && b.state === 'standalone' && !b.signedIn && fe.pendingTimers === 0, `${fe.posts.length} posts, ${fe.listeners.size} listeners`);
}
{
  const fe = fakeEnv(true);
  const b = bridgeOn(fe, ['first_squish']);
  b.start(); b.start();
  const w0 = fe.posts.filter((p) => p.msg.type === 'forgeflow:whoami');
  fe.advance(WHOAMI_WAIT_MS - 1);
  const midCount = fe.posts.length;
  fe.advance(WHOAMI_WAIT_MS * 3);
  const who = fe.posts.filter((p) => p.msg.type === 'forgeflow:whoami');
  b.achievement('first_squish'); fe.advance(60_000);
  check('B02', 'a silent parent: exactly 3 whoami probes, 4 s apart, then silent for good (start() twice changes nothing; no achievement is sent)',
    w0.length === 1 && midCount === 1 && who.length === WHOAMI_TRIES && who[1].t - who[0].t === WHOAMI_WAIT_MS && who[2].t - who[1].t === WHOAMI_WAIT_MS && fe.posts.length === 3 && b.state === 'silent', `probes at ${who.map((p) => p.t).join(', ')} ms, state ${b.state}`);
  fe.identity(true, 'late-1');
  fe.advance(5000);
  check('B03', 'a silent client still takes a pushed identity later (portal sign-in mid-game) and then catches up', b.state === 'signedIn' && fe.posts.some((p) => p.msg.type === 'forgeflow:achievement'));
}
{
  const fe = fakeEnv(true);
  const b = bridgeOn(fe, ['first_squish', 'first_stretch']);
  const changes: string[] = [];
  b.onChange(() => changes.push(b.state));
  b.start();
  const rid = (fe.posts[0].msg as { _reqId: string })._reqId;
  fe.identity(false, '', rid);
  b.achievement('first_squish'); b.achievement('first_capsule');
  fe.advance(60_000);
  check('B04', 'a guest: one whoami and nothing else, however many trophies are earned; the change is announced to the screen', fe.posts.length === 1 && b.state === 'guest' && changes.join() === 'guest', `${fe.posts.length} posts, changes ${changes.join()}`);
  check('B05', 'the account lines: guest / signed in / standalone, silent and waiting all say what is true (kept on this device)',
    /guest/i.test(accountLine('guest')) && /forgeflowgames\.com/.test(accountLine('guest')) && accountLine('signedIn') === 'Saved to your ForgeFlow account.' && accountLine('standalone') === 'Saved on this device.' && accountLine('silent') === 'Saved on this device.' && accountLine('waiting') === 'Saved on this device.');
}
{
  const fe = fakeEnv(true);
  const earned = ['first_squish', 'first_stretch', 'first_capsule'];
  const b = bridgeOn(fe, earned);
  b.start();
  fe.identity(true, 'acct-1', (fe.posts[0].msg as { _reqId: string })._reqId);
  fe.advance(300);
  const at300 = fe.posts.filter((p) => p.msg.type === 'forgeflow:achievement').length;
  b.achievement('first_task');                       // a live unlock while the catch-up is still running
  b.achievement('first_squish');                     // a duplicate
  fe.advance(30_000);
  const ach = fe.posts.filter((p) => p.msg.type === 'forgeflow:achievement');
  const order = ach.map((p) => (p.msg as { achievementSlug: string }).achievementSlug);
  const gaps = ach.slice(1).map((p, i) => p.t - ach[i].t);
  check('B06', 'signed in: the first identity posts every earned slug, oldest first, one at once and the rest >= 1 s apart; a live unlock joins the queue; a duplicate is dropped',
    at300 === 1 && order.join() === 'first_squish,first_stretch,first_capsule,first_task' && gaps.every((g) => g >= 1000), `${order.join()} gaps ${gaps.join(',')}`);
  const n = fe.posts.length;
  fe.identity(true, 'acct-1'); fe.advance(10_000);
  check('B07', 'the same account pushed again (token refresh) posts nothing new', fe.posts.length === n);
  b.achievement('first_cut'); fe.advance(2000);
  const afterLive = fe.posts.length;
  b.achievement('first_cut'); b.achievement('first_cut'); fe.advance(5000);
  check('B08', 'a live unlock while idle is posted at once, and never twice', afterLive === n + 1 && fe.posts.length === afterLive, `${afterLive - n} new, then ${fe.posts.length - afterLive}`);
  // sign-out mid-queue, back in: only what was never posted goes out; another account gets its own full catch-up
  const fe2 = fakeEnv(true);
  const b2 = bridgeOn(fe2, earned);
  b2.start(); fe2.identity(true, 'acct-1'); fe2.advance(100);       // first slug out, two queued
  fe2.identity(false); fe2.advance(20_000);
  const afterOut = fe2.posts.filter((p) => p.msg.type === 'forgeflow:achievement').length;
  fe2.identity(true, 'acct-1'); fe2.advance(20_000);
  const slugs1 = fe2.posts.filter((p) => p.msg.type === 'forgeflow:achievement').map((p) => (p.msg as { achievementSlug: string }).achievementSlug);
  fe2.identity(true, 'acct-2'); fe2.advance(20_000);
  const slugs2 = fe2.posts.filter((p) => p.msg.type === 'forgeflow:achievement').map((p) => (p.msg as { achievementSlug: string }).achievementSlug);
  check('B09', 'sign-out drops the waiting posts; signing back in posts only what never went out (3 total, none twice); another account is caught up in full (6 total)',
    afterOut === 1 && slugs1.length === 3 && new Set(slugs1).size === 3 && slugs2.length === 6, `out ${afterOut}, same account ${slugs1.length}, then second account ${slugs2.length}`);
}
{
  const fe = fakeEnv(true);
  const b = bridgeOn(fe, ['first_squish']);
  b.start();
  const rid = (fe.posts[0].msg as { _reqId: string })._reqId;
  const idMsg = { type: 'forgeflow:identity', _reqId: rid, signedIn: true, id: 'acct-9', username: 'someone', avatar_url: 'x', level: 4 };
  fe.deliver(idMsg, 'https://forgeflowgames.com', false);                 // not from the parent window
  const s1 = b.state;
  fe.deliver(idMsg, 'https://evil.example');                               // a parent we do not know
  const s2 = b.state;
  fe.deliver({ ...idMsg, _reqId: 'sk999' });                               // a reply to a question we never asked
  const s3 = b.state;
  fe.deliver({ type: 'forgeflow:identity', _reqId: rid, signedIn: true, id: '', username: 'x' });   // signed in with no id: a guest
  const s4 = b.state;
  fe.deliver('forgeflow:identity'); fe.deliver(null); fe.deliver({ type: 7 });
  fe.advance(10_000);
  check('B10', 'an identity is ignored from a non-parent source, from an unknown origin, or with a _reqId we never issued; one without an id is a guest; junk is harmless',
    s1 === 'waiting' && s2 === 'waiting' && s3 === 'waiting' && s4 === 'guest' && fe.posts.every((p) => p.msg.type === 'forgeflow:whoami') && b.stats.ignored >= 2, `states ${s1},${s2},${s3},${s4}; ignored ${b.stats.ignored}`);
  check('B11', 'origins: the portal, www, the pages.dev host and its previews, and localhost / 127.0.0.1 with a port pass; look-alikes and http portals do not',
    ['https://forgeflowgames.com', 'https://www.forgeflowgames.com', 'https://forgeflow-games.pages.dev', 'https://abc123.forgeflow-games.pages.dev', 'http://localhost:5440', 'http://127.0.0.1:5441'].every(portalOriginAllowed)
    && ['https://forgeflowgames.com.evil.example', 'http://forgeflowgames.com', 'https://evilforgeflowgames.com', 'null', 'https://forgeflow-games.pages.dev.evil.io', 'https://localhost.evil.com', ''].every((o) => !portalOriginAllowed(o)));
  const fe2 = fakeEnv(true);
  const b3 = bridgeOn(fe2, []);
  b3.start(); fe2.identity(true, 'acct-5', (fe2.posts[0].msg as { _reqId: string })._reqId);
  b3.achievement('not_a_trophy'); b3.achievement('first_squish; DROP'); b3.achievement('g-abcdefghijkl'); fe2.advance(10_000);
  check('B12', 'only the 20 known slugs can be posted: an unknown slug, an injected string and a ghost-style id are all dropped', fe2.posts.filter((p) => p.msg.type === 'forgeflow:achievement').length === 0);
  const pub = JSON.stringify({ state: b3.state, stats: b3.stats, signedIn: b3.signedIn });
  check('B13', 'the client exposes no username, avatar or account id (state, stats and flags only)', !/someone|acct-5|avatar|username/.test(pub), pub);
}
{
  // every message the client can emit across all scenarios has exactly the memo's keys
  const all: OutMsg[] = [...sk.posts.map((p) => p.msg)];
  const keysOf = (m: OutMsg): string => Object.keys(m).sort().join();
  const okShapes = all.every((m) => (m.type === 'forgeflow:whoami' && keysOf(m) === '_reqId,type' && /^sk\d+$/.test((m as { _reqId: string })._reqId)) || (m.type === 'forgeflow:achievement' && keysOf(m) === 'achievementSlug,type' && ACH_BY_SLUG.has((m as { achievementSlug: string }).achievementSlug)));
  check('B14', 'every message posted in the master run has exactly the memo\'s shape: whoami {type, _reqId}, achievement {type, achievementSlug}; no score, save, load or game_over', okShapes && all.length === 21, `${all.length} messages`);
}

/* ═════════════════════════════════════════ S: the save key ═════════════════════════════════════════ */
{
  const garbage = '{"v":1,"earned":';
  const st = memoryStorage({ [ACH_KEY]: garbage });
  const s = createAchStore(st, { now: () => T0, setTimer: () => 0, clearTimer: () => undefined });
  const dump = st.dump();
  check('S01', 'an unreadable blob is parked under wobblehoard:v1:ach.unreadable and counting starts again on a fresh key', s.status === 'unreadable' && dump[ACH_BACKUP_KEY] === garbage && JSON.parse(dump[ACH_KEY]).v === 1 && Object.keys(s.save.earned).length === 0);
  const newer = JSON.stringify({ v: 2, since: 5, earned: { first_squish: 99, future_trophy: 100 }, counters: { squeezes: 7 }, extra: true });
  const st2 = memoryStorage({ [ACH_KEY]: newer });
  const s2 = createAchStore(st2, { now: () => T0, setTimer: () => 0, clearTimer: () => undefined });
  const ev2 = createEvaluator({ save: s2.save, now: () => T0, onUnlock: () => undefined, onDirty: () => s2.markDirty() });
  ev2.touch({ kind: 'snap', intensity: 0.5, heldFor: 1 }, 1); s2.flush(); s2.dispose();
  check('S02', 'a blob from a NEWER build is read for what is known and never overwritten (byte for byte), and its trophy is not earned again', s2.status === 'newer' && !s2.writable && st2.getItem(ACH_KEY) === newer && s2.save.earned.first_squish === 99 && ev2.isEarned('first_squish'));
  const san = sanitizeAchSave({ v: 1, since: -4, earned: { first_squish: 'x', Bad: 1, ok_one: 12.7, huge: 1e300 }, counters: { squeezes: -5, stretches: NaN, tosses: 'a', cuts: 3.9, merges: 1e12 } }, 77).save;
  check('S03', 'the sanitizer repairs garbage: negative, NaN, text and huge numbers become 0 or the cap, bad keys are dropped, since falls back to now',
    san.since === 77 && san.counters.squeezes === 0 && san.counters.stretches === 0 && san.counters.tosses === 0 && san.counters.cuts === 3 && san.counters.merges === 1_000_000_000 && eqSet(Object.keys(san.earned), ['ok_one']) && san.earned.ok_one === 12);
  check('S04', 'not an object, an array or a missing version is unreadable; null is fresh', sanitizeAchSave([], 1).status === 'unreadable' && sanitizeAchSave('x', 1).status === 'unreadable' && sanitizeAchSave({}, 1).status === 'unreadable' && sanitizeAchSave(null, 1).status === 'fresh');
  // two tabs
  const shared = memoryStorage();
  let sub: ((k: string | null) => void) | null = null;
  const tabA = createAchStore(shared, { now: () => T0, setTimer: () => 0, clearTimer: () => undefined, subscribe: (fn) => { sub = fn; return () => undefined; } });
  const tabB = createAchStore(shared, { now: () => T0 + 5, setTimer: () => 0, clearTimer: () => undefined });
  const evA = createEvaluator({ save: tabA.save, now: () => 1000, onUnlock: () => undefined, onDirty: () => tabA.markDirty() });
  const evB = createEvaluator({ save: tabB.save, now: () => 2000, onUnlock: () => undefined, onDirty: () => tabB.markDirty() });
  evA.touch({ kind: 'release', intensity: 0.5, heldFor: 1 }, 1); tabA.flush();
  evB.touch({ kind: 'snap', intensity: 0.5, heldFor: 1 }, 2); tabB.flush();
  const disk = JSON.parse(shared.getItem(ACH_KEY)!);
  sub!(ACH_KEY);
  let again = 0;
  const evA2 = createEvaluator({ save: tabA.save, now: () => 3000, onUnlock: () => { again++; }, onDirty: () => undefined });
  evA2.touch({ kind: 'snap', intensity: 0.5, heldFor: 1 }, 3);
  check('S05', 'two tabs: B\'s write folds in A\'s trophy (the union is on disk), A adopts B\'s on the storage event and does not earn it a second time, the since is the earlier one',
    eqSet(Object.keys(disk.earned), ['first_squish', 'first_stretch']) && tabA.save.earned.first_stretch === 2000 && again === 0 && disk.since === T0, `disk ${Object.keys(disk.earned).join(',')}`);
  const none = createAchStore(null, { now: () => T0 });
  const evN = createEvaluator({ save: none.save, now: () => 1, onUnlock: () => undefined, onDirty: () => none.markDirty() });
  evN.touch({ kind: 'release', intensity: 0.5, heldFor: 1 }, 1); none.flush(); none.dispose();
  check('S06', 'no storage at all: trophies still work in memory and nothing throws', none.status === 'fresh' && !none.writable && evN.isEarned('first_squish'));
  // throttle: counters wait for the timer, a trophy is flushed at once by the binding
  const timers: Array<() => void> = [];
  const st3 = memoryStorage();
  const s3 = createAchStore(st3, { now: () => T0, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => undefined });
  const e3 = createEvaluator({ save: s3.save, now: () => 9, onUnlock: () => undefined, onDirty: () => s3.markDirty() });
  e3.touch({ kind: 'release', intensity: 0.5, heldFor: 1 }, 1);
  const beforeTimer = JSON.parse(st3.getItem(ACH_KEY)!).counters.squeezes;
  timers.splice(0).forEach((f) => f());
  check('S07', 'writes are throttled: a squeeze is on disk only after the timer fires; the very first run writes at once so `since` is fixed', beforeTimer === 0 && JSON.parse(st3.getItem(ACH_KEY)!).counters.squeezes === 1 && JSON.parse(st3.getItem(ACH_KEY)!).since === T0);
  const m1 = emptyAchSave(10); m1.earned.a_1 = 50; m1.counters.squeezes = 3;
  const m2 = emptyAchSave(5); m2.earned.a_1 = 40; m2.earned.b_2 = 9; m2.counters.squeezes = 2; m2.counters.merges = 8;
  mergeAchSaves(m1, m2);
  check('S08', 'merge rule: union of trophies with the earlier stamp, the larger of each counter, the earlier since', m1.earned.a_1 === 40 && m1.earned.b_2 === 9 && m1.counters.squeezes === 3 && m1.counters.merges === 8 && m1.since === 5);
}

/* ═════════════════════════════════════════ T: toast hook, privacy line, static scans ═════════════════════════════════════════ */
{
  const toasts: TrophyToast[] = [];
  setTrophyToastSink((t) => toasts.push(t));
  const fe = fakeEnv(true);
  const r = makeRig({ env: fe });
  r.ach.bridge.start();
  r.g.phase = 'title';
  r.squeeze(1);
  const heldInTitle = toasts.length;
  r.g.phase = 'play'; r.g.step();
  check('T01', 'a trophy earned during the title waits for play, then the registered toast gets it once, with its tier, XP, hidden flag and signedIn false', heldInTitle === 0 && toasts.length === 1 && toasts[0].slug === 'first_squish' && toasts[0].tier === 'bronze' && toasts[0].points === 5 && toasts[0].signedIn === false && toasts[0].hidden === false, JSON.stringify(toasts[0]));
  fe.identity(true, 'acct-t', (fe.posts[0].msg as { _reqId: string })._reqId);
  r.g.ceremonies.active = true;
  r.stretch(0.5);
  const heldInCeremony = toasts.length;
  r.g.ceremonies.active = false; r.g.step();
  check('T02', 'a trophy earned during a ceremony waits until it ends; signed in, the toast says signedIn true (that is when "+N XP" shows)', heldInCeremony === 1 && toasts.length === 2 && toasts[1].slug === 'first_stretch' && toasts[1].signedIn === true);
  const o = await r.capsule(2);
  const n0 = toasts.length;
  for (let i = 0; i < 30; i++) r.g.step();   // 0.5 s of game time: the capsule's ceremony has not started yet
  const heldForReveal = toasts.length === n0 && o.ok;
  for (let i = 0; i < 300; i++) r.g.step();  // past the grace
  check('T03', 'after a capsule result the unlock toast holds back (the reveal comes first), then shows once the grace has passed with no ceremony', heldForReveal && toasts.length > n0 && toasts.some((t) => t.slug === 'rare_find'), `${n0} -> ${toasts.length}`);
  setTrophyToastSink(null);
  const r2 = makeRig();
  r2.squeeze(1); r2.g.step();
  check('T04', 'with no toast renderer registered the live region says the unlock in kind words, once', r2.said.length === 1 && r2.said[0] === 'Bronze trophy: Hello, Squishy.' && trophyLine({ name: 'x', tier: 'diamond' }) === 'Diamond trophy: x.', r2.said.join('|'));
  const r3 = makeRig();
  const rr3 = r3.hoard.stacks().filter((s) => s.copies > 0).length;
  check('T05', 'a fresh Hoard (the starter only) unlocks nothing at attach', r3.unlocked().length === 0 && rr3 === 1);
}
check('T06', 'the privacy line is pinned: it says squishies stay in this browser and only trophies are shared when signed in, and names no score, save or personal data',
  PRIVACY_LINE === 'Your squishies live in this browser. Signed in to ForgeFlow Games, only your trophies are shared with the site.' && !/score|save|name|email|avatar/i.test(PRIVACY_LINE));

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|mts|js|mjs)$/.test(n) ? [p] : []; });
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const mine = [...walk(join(SRC, 'portal')), join(SRC, 'shell/achievementsBinding.ts'), join(SRC, 'shell/trophyToast.ts'), join(SRC, 'core/achievements.ts'), join(SRC, 'core/achStore.ts')];
const code = mine.map((f) => ({ f: relative(SRC, f).split(sep).join('/'), s: stripComments(readFileSync(f, 'utf8')) }));
const fwTypes = new Set<string>();
for (const { s } of code) for (const m of s.matchAll(/forgeflow:[a-z_]+/g)) fwTypes.add(m[0]);
check('T07', 'the only forgeflow: message names anywhere in the trophy code are whoami, achievement (sent) and identity (read): no score, save, load, game_over or level_complete', eqSet(fwTypes, ['forgeflow:whoami', 'forgeflow:achievement', 'forgeflow:identity']), fmt(fwTypes));
const pm = code.filter((x) => /\bpostMessage\b/.test(x.s)).map((x) => x.f);
const collectionPm = walk(join(SRC, 'collection')).filter((f) => /\bpostMessage\b/.test(stripComments(readFileSync(f, 'utf8'))));
check('T08', 'postMessage appears only in src/portal/bridge.ts, and never in src/collection', eqSet(pm, ['portal/bridge.ts']) && collectionPm.length === 0, pm.join(','));
const FORBID = /\b(eval\s*\(|new Function\s*\(|document\.write|innerHTML|outerHTML|insertAdjacentHTML|setAttribute\(\s*['"]style|\.cssText|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|importScripts)/;
check('T09', 'strict-CSP and no-network hygiene: no eval, Function, inline style or script, innerHTML, fetch, XHR, beacon or socket in the trophy code', code.every((x) => !FORBID.test(x.s)), code.filter((x) => FORBID.test(x.s)).map((x) => x.f).join(','));
check('T10', 'the client lives outside src/collection and imports nothing from the game but types (contracts, collection types), core and its own folder', code.filter((x) => x.f.startsWith('portal/')).every((x) => [...x.s.matchAll(/from\s+'([^']+)'/g)].every((m) => /^\.\/[a-z]+\.ts$|^\.\.\/core\/[A-Za-z]+\.ts$/.test(m[1]))));
const store = mine.filter((f) => /core[\\/]ach/.test(f));
check('T11', 'the pure core (achievements.ts, achStore.ts) touches no DOM, clock, random or network global', store.every((f) => !/\b(window|document|localStorage|navigator|Date\.now|new Date|Math\.random|performance|fetch|postMessage)\b/.test(stripComments(readFileSync(f, 'utf8')))), store.map((f) => relative(SRC, f)).join(','));

{
  // T12 (found by B4a's hoard-offline row, B6b): the observing wrapper must follow a member that is REPLACED on the Collection after it was first read. The dev hook's forceOffline does
  // exactly that (c.__meter = c.meter; c.meter = () => ({ ...orig(), offline: true }); then c.meter = orig), and a bound-function cache keyed by the member NAME returned the stale original.
  const target = { meter: () => 'orig', other: () => 'x', n: 5 };
  const nothing = { touch() {}, opened() {}, merged() {}, task() {}, itemsChanged() {} };
  const p = observeCollection(target as unknown as Collection, nothing) as unknown as { meter: () => string; __orig?: () => string; other: () => string; n: number };
  const stable = p.meter === p.meter && p.other === p.other;
  const first = p.meter();
  p.__orig = p.meter;
  p.meter = () => 'forced';
  const second = p.meter();
  p.meter = p.__orig;
  const third = p.meter();
  check('T12', 'the observing wrapper follows a member replaced after its first read (the dev hook\'s forceOffline) and back again, and a member keeps one identity while it is not replaced', stable && first === 'orig' && second === 'forced' && third === 'orig' && p.n === 5, [first, second, third].join(' -> '));
}

{
  // T13 (found 2026-10-10 by the hoard-loop merge row): the same replace-and-restore, but on a member the wrapper HOOKS (merge). The dev hook's failNextMerge reads `orig` through the wrapper (the
  // HOOK), assigns a one-shot fake, and the fake puts `orig` back. Written to the raw target, that put the hook ON the target and the hook then called itself (stack overflow: "Something went
  // wrong. Reload and try again." on the next real hold). The fake must answer once; the next call must reach the real member and be watched.
  let reached = 0, watched = 0;
  const target = { merge: (): Promise<MergeResult> => { reached++; return Promise.resolve({ ok: false, ledger: 'practice', error: 'wrong_count' } as unknown as MergeResult); } };
  const w = { touch() {}, opened() {}, merged() { watched++; }, task() {}, itemsChanged() {} };
  const p = observeCollection(target as unknown as Collection, w) as unknown as { merge: (ids: string[], d: string) => Promise<{ ok: boolean; error?: string }> };
  const orig = p.merge;
  p.merge = () => { p.merge = orig; return Promise.resolve({ ok: false, error: 'odds_changed' }); };
  const a = await p.merge([], '');
  let b: { ok: boolean; error?: string } | null = null, threw = '';
  try { b = await p.merge([], ''); } catch (e) { threw = String(e instanceof Error ? e.message : e); }
  check('T13', 'a hooked member (merge) replaced by a one-shot fake and put back (the dev hook\'s failNextMerge) answers the fake once, then the REAL member again (no self-call), without touching the target while faked', a.error === 'odds_changed' && b?.error === 'wrong_count' && reached === 1 && !threw && watched === 0, `${a.error} -> ${b?.error ?? threw}, real member reached ${reached}x`);
}

console.log(`\n${total - bad}/${total} checks passed`);
process.exit(bad ? 1 : 0);
