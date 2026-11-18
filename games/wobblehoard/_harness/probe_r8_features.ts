// ROUND 8 (R8_SHELL 4): node rows for the three designed features built in round 8 (plain node, light; exits 1 on a failure). The DOM half of each is a browser check
// (browser_shell.mjs section `r8-features`, desktop and phone).
//   FR  the Friendship Frame's photo (QUESTS 6.10 / 10, PLAYGROUND_BUILD 11.15): ui/later-frame.ts (the thumbnail, written once under its own key, at most 12 000
//       characters) and the life host's wiring (shell/later-life.ts createFrameWatch: the last photo, at X8's stamp)
//   GS  Journal gifts in the trophies (PG_QUESTS round 3's "trophies' gift sweep"): a gift squishy that lands on the shelf is counted by the trophies at once
//   WC  "Who's coming?" on the Places sheet (QUESTS 15): the code's structure (the DOM is the browser check's)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorageLike } from '../src/core/settings.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { createCollection } from '../src/collection/index.ts';
import type { Collection } from '../src/collection/index.ts';
import { JOURNAL_FRAME_KEY, JOURNAL_FRAME_MAX_CHARS, journalDefs } from '../src/collection/journal.ts';
import { attachJournal } from '../src/collection/journal_store.ts';
import type { JournalRuntime } from '../src/collection/journal_store.ts';
import { applyEventFields, createQuestOut, markDone, setQuestDay } from '../src/core/quests.ts';
import { QUESTS, EV, BY, WISH_STATE } from '../src/data/quests.ts';
import { WISH_KIND } from '../src/data/life.ts';
import { createAchievements } from '../src/shell/achievementsBinding.ts';
import type { AchGameLike } from '../src/shell/achievementsBinding.ts';
import type { PortalEnv } from '../src/portal/bridge.ts';
import { FRAME_H, FRAME_QUALITY, FRAME_W, coverRect, makeFrameThumb, readFrame, storeFrame, validFrame } from '../src/ui/later-frame.ts';
import type { FrameCanvas, FrameMakers } from '../src/ui/later-frame.ts';
import { createFrameWatch } from '../src/shell/later-life.ts';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '..');
let bad = 0, total = 0;
const row = (id: string, what: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${extra ? '  ' + extra : ''}`); };
const DAY = 86_400_000;
const T = 20407 * DAY + 3_600_000;
const now = (): number => T;
const fakeTimers = { setTimer: (): unknown => 0, clearTimer: (): void => undefined };
interface Mem extends StorageLike { map: Map<string, string>; sets: string[]; quota: boolean }
const mem = (): Mem => {
  const map = new Map<string, string>();
  const s: Mem = { map, sets: [], quota: false, getItem: (k) => (map.has(k) ? map.get(k)! : null), setItem: (k, v) => { s.sets.push(k); if (s.quota) throw new Error('QuotaExceededError'); map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
  return s;
};
const JPEG = (n: number): string => 'data:image/jpeg;base64,' + 'A'.repeat(Math.max(0, n - 'data:image/jpeg;base64,'.length));

/* ═══════════════ FR: the Friendship Frame's photo ═══════════════ */
{
  // FR-01: the photo fills the 4:3 thumbnail (cropped about its centre) for a wide (1280 x 800) and a tall (390 x 844 x 2) shot
  const fills = (w: number, h: number): boolean => { const [x, y, dw, dh] = coverRect(w, h); return x <= 1e-9 && y <= 1e-9 && x + dw >= FRAME_W - 1e-9 && y + dh >= FRAME_H - 1e-9 && Math.abs(dw / dh - w / h) < 1e-9; };
  row('FR-01', `a photo FILLS the ${FRAME_W} x ${FRAME_H} thumbnail, cropped about its centre, its shape kept (a desktop shot and a phone shot)`, fills(1280, 800) && fills(780, 1688) && fills(160, 120),
    JSON.stringify([coverRect(1280, 800).map((v) => +v.toFixed(1)), coverRect(780, 1688).map((v) => +v.toFixed(1))]));
  // FR-02: the thumbnail is the best quality that fits the 12 000 characters (the qualities tried in order), drawn once onto a 160 x 120 canvas; the bitmap is closed
  const mk = (lenAt: (q: number) => number, fail = false): { makers: FrameMakers; drawn: number[][]; tried: number[]; closed: () => number } => {
    const drawn: number[][] = [], tried: number[] = [];
    let closed = 0;
    const canvas = (): FrameCanvas => {
      const cv: FrameCanvas = { width: 0, height: 0,
        getContext: () => ({ fillStyle: '', fillRect: () => undefined, drawImage: (_i: unknown, x: number, y: number, w: number, h: number) => { drawn.push([cv.width, cv.height, x, y, w, h]); } }),
        toDataURL: (_t: string, q?: number) => { tried.push(q ?? -1); return JPEG(lenAt(q ?? 1)); } };
      return cv;
    };
    return { makers: { decode: async () => { if (fail) throw new Error('decode'); return { width: 1280, height: 800, close: () => { closed++; } }; }, canvas }, drawn, tried, closed: () => closed };
  };
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const a = mk((q) => Math.round(30000 * q));   // 0.82 -> 24600, 0.68 -> 20400, 0.54 -> 16200, 0.4 -> 12000 (fits), ...
  const ua = await makeFrameThumb(blob, a.makers);
  const b = mk(() => 20000), ub = await makeFrameThumb(blob, b.makers);
  const c = mk(() => 900, true), uc = await makeFrameThumb(blob, c.makers);
  row('FR-02', 'the thumbnail is a JPEG data URL of the best quality that fits 12 000 characters (qualities tried in order), drawn once onto a 160 x 120 canvas, the decoded photo closed; null when none fits or the photo cannot be decoded',
    !!ua && ua.length <= JOURNAL_FRAME_MAX_CHARS && a.tried.join() === FRAME_QUALITY.slice(0, 4).join() && a.drawn.length === 1 && a.drawn[0][0] === FRAME_W && a.drawn[0][1] === FRAME_H && a.closed() === 1
      && ub === null && b.tried.length === FRAME_QUALITY.length && uc === null,
    JSON.stringify({ len: ua?.length, tried: a.tried, drawn: a.drawn[0]?.map((v) => +v.toFixed(1)), none: ub, undecodable: uc }));
  // FR-03: written ONCE: the first valid thumbnail goes under the key; a second never replaces it; an oversize or non-JPEG one is refused; a quota failure leaves nothing
  const s1 = mem();
  const w1 = await storeFrame(s1, blob, async () => JPEG(9000));
  const w2 = await storeFrame(s1, blob, async () => JPEG(5000));
  const s2 = mem();
  const big = await storeFrame(s2, blob, async () => JPEG(JOURNAL_FRAME_MAX_CHARS + 1)), png = await storeFrame(s2, blob, async () => 'data:image/png;base64,AAAA');
  const s3 = mem(); s3.quota = true;
  const q = await storeFrame(s3, blob, async () => JPEG(9000));
  row('FR-03', `the frame is written ONCE under ${JOURNAL_FRAME_KEY} (a second photo never replaces it); a thumbnail over 12 000 characters or not a JPEG is refused; a full storage leaves nothing (false)`,
    w1 && !w2 && (s1.map.get(JOURNAL_FRAME_KEY)?.length ?? 0) === 9000 && !big && !png && s2.map.size === 0 && !q && s3.map.size === 0 && readFrame(s1) === s1.map.get(JOURNAL_FRAME_KEY) && readFrame(s2) === null,
    JSON.stringify({ w1, w2, big, png, quota: q }));
  // FR-04: the host's wiring: the last photo is kept; at X8's stamp its thumbnail is stored once and the Journal told; any other stamp, X8 without a photo, or a second
  // X8 do nothing; read() shows only a valid frame
  const s4 = mem(), x8 = QUESTS.findIndex((x) => x.id === 'X8'), h1 = QUESTS.findIndex((x) => x.id === 'H1');
  let stored = 0, told = 0;
  const fw = createFrameWatch(s4, () => { told++; }, async (s, bl) => { stored++; return storeFrame(s, bl, async () => JPEG(8000)); });
  const n0 = await fw.quest(x8);                 // X8 with no photo: nothing
  fw.photo(blob);
  const nH = await fw.quest(h1);                 // another stamp: nothing (the photo is kept)
  const nX = await fw.quest(x8);                 // X8: stored
  fw.photo(blob);
  const nX2 = await fw.quest(x8);                // a frame is there already: never replaced
  fw.photo('not a blob');
  const s5 = mem(); s5.map.set(JOURNAL_FRAME_KEY, 'data:image/png;base64,AAAA');
  row('FR-04', 'the life host keeps the last photo and stores its thumbnail at X8\'s stamp, once (the Journal told); another stamp, X8 with no photo, or a second X8 store nothing; only a valid frame is read back',
    x8 >= 0 && !n0 && !nH && nX && !nX2 && stored === 1 && told === 1 && validFrame(fw.read()) && createFrameWatch(s5).read() === null,
    JSON.stringify({ n0, nH, nX, nX2, stored, told }));
  // FR-05: the pieces are where the spec puts them: the module is a later-* one imported only by the host's X8 path (never statically: it is not in the first download or
  // the life chunk), the photo reaches the host from Snap's Save (note('photo', blob)), and the Journal's Keepsakes page draws the frame from the host's read
  const life = readFileSync(resolve(ROOT, 'src/shell/later-life.ts'), 'utf8'), hud = readFileSync(resolve(ROOT, 'src/shell/hudBinding.ts'), 'utf8'), jn = readFileSync(resolve(ROOT, 'src/ui/later-journal.ts'), 'utf8');
  const staticImports = [life, hud, jn, readFileSync(resolve(ROOT, 'src/shell/boot.ts'), 'utf8')].some((t) => /^import [^;]*later-frame/m.test(t));
  row('FR-05', 'later-frame.ts is imported only dynamically (the host\'s X8 path); Snap\'s Save hands the photo to the host (note(\'photo\', blob)); the Keepsakes page shows the Friendship Frame\'s photo from the host (frameThumb) in an <img>',
    !staticImports && /import\('\.\.\/ui\/later-frame\.ts'\)/.test(life) && /note\('photo', blob\)/.test(hud) && /frameThumb\?\.\(\)/.test(jn) && /h\('img', \{ class: 'jn-frame'/.test(jn));
}

/* ═══════════════ GS: a Journal gift counted by the trophies at once ═══════════════ */
{
  const d = journalDefs();
  const qIdx = (id: string): number => QUESTS.findIndex((x) => x.id === id);
  const giftReady = (rt: JournalRuntime): void => {
    const st = rt.store.journal.st, out = createQuestOut(256);
    setQuestDay(st, Math.floor(T / DAY));
    applyEventFields(st, d, out, EV.WISH, WISH_STATE.SHOWN, 0, 1, 0, 255, 0, 0, BY.SELF, 0, WISH_KIND.PLACE);
    applyEventFields(st, d, out, EV.VISIT, 0, 1, -1, 255, 255, 255, 1, BY.PLAYER, 0, 0);
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5']) markDone(st, d, qIdx(id), out);
    markDone(st, d, qIdx('C8'), out);
  };
  const fenv = (): PortalEnv => ({ now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined, framed: false, post: () => undefined, onMessage: () => () => undefined });
  const m = mem();
  const hoard = createCollection({ storage: m, now, random: mulberry32(31), ...fakeTimers, throttleMs: 2000 });
  const ach = createAchievements({ storage: m, now, env: fenv() });
  const c: Collection = ach.observe(hoard);
  const g = { phase: 'play', simTime: 0, body: { metrics: { carried: false } }, bodies: { extras: [] }, cut: { pieces: 1, busy: false }, ceremonies: { active: false, pending: false }, hoard: c, onStep: () => () => undefined };
  const off = ach.attach(g as unknown as AchGameLike, { announce: () => undefined });
  const rt = attachJournal(c, { storage: m, ...fakeTimers, throttleMs: 2000 })!;
  giftReady(rt);
  const owned = (): number => hoard.stacks().filter((s) => s.copies > 0).length;
  const before = ach.save.counters.species, ownedBefore = owned();
  const r = await c.claimGift!(1, 'puddlo');
  const after = ach.save.counters.species, ownedAfter = owned();
  row('GS-01', 'a Journal gift of a new species is counted by the trophies at once (their species counter equals the species owned right after the grant, as a restock is; round 7 counted it only at the next open or merge)',
    !!r.ok && ownedAfter === ownedBefore + 1 && after === ownedAfter && after === before + 1, JSON.stringify({ ok: r.ok, species: [before, after], owned: [ownedBefore, ownedAfter] }));
  off(); ach.dispose(); hoard.dispose();
}

/* ═══════════════ WC: "Who's coming?" on the Places sheet (the structure; the DOM is the browser check's) ═══════════════ */
{
  const jn = readFileSync(resolve(ROOT, 'src/ui/later-journal.ts'), 'utf8'), css = readFileSync(resolve(ROOT, 'src/ui/journal.css'), 'utf8');
  const travel = jn.slice(jn.indexOf('export function openTravel'));
  row('WC-01', '"Who\'s coming?" follows the postcards on the Places sheet: a chip per squishy out now (the host\'s partyNow), its tier\'s gem, its colour (the Hoard\'s swatch) and its name under it, all preselected (aria-pressed), the squishy in hand aria-disabled (it always comes)',
    /const who = whoSection\(\);\s*if \(who\) kids\.push\(who\);/.test(travel) && /o\.host\.partyNow\?\.\(\)/.test(travel) && /gemSvg\(/.test(travel) && /class: 'swatch jn-who-sw'/.test(travel)
      && /'aria-pressed': String\(on\)/.test(travel) && /if \(p\.play\) b\.setAttribute\('aria-disabled', 'true'\)/.test(travel) && /jn-who-name/.test(travel));
  row('WC-02', 'the chips are 56 px tall at least (QUESTS 15) and a squishy left at Home reads so (dimmed, its swatch greyed, its name kept); the group is labelled "Who\'s coming?"',
    /\.k-btn\.jn-who-chip \{[^}]*min-height: 56px/.test(css) && /\.jn-who-chip\[aria-pressed="false"\] \{ opacity/.test(css) && /const WHO = "Who's coming\?"/.test(jn));
  row('WC-03', 'the trip puts back on the shelf ONLY the squishies whose chips were unpressed (mat.remove, before the host\'s travel path), never the one in hand; "Change" closes the sheet and opens the Hoard (its shelf picks who comes)',
    /function leaveBehind\(\): void \{\s*for \(const id of staying\) \{ try \{ o\.game\.mat\.remove\(id\)/.test(travel) && /leaveBehind\(\);\s*const slow = window\.setTimeout/.test(travel)
      && /if \(p\.play\) b\.setAttribute/.test(travel) && /document\.querySelector<HTMLElement>\('\.dock-hoard'\)\?\.click\(\)/.test(travel));
}

console.log(`\n${total - bad}/${total} round-8 feature checks passed`);
process.exit(bad ? 1 : 0);
