// BLOCKTOOTH — NO-BOT-TEXT static gate (owner request 2026-10-06: "make sure blocktooth doesn't say anything about BOTS, it should
// seem like we are playing against other players"). Part of the checks; node only, no browser.
//
//   node _harness/vs/probe_nobot_text.ts
//
// Walks EVERY string reachable from every export of src/data/strings*.ts, src/data/goals.ts, src/data/vsgoals.ts (the files that hold
// player-visible copy), plus every string value of public/game_meta.json (the portal-facing title / description / tags /
// controls), and asserts none of them matches /\bbots?\b/i. NO allowlist: a word-boundary hit anywhere fails the gate. It also
// walks the other src/data modules (upgrades, perks, titans, bosses ...), the VS player-handle pool, and the lobby / notice
// formatters' filled-in output, so a new line cannot reintroduce the word through a back door. Internal identifiers
// (kind: 'bot', field names, CSS classes, window.__BT__ keys) are not text and are not scanned; the live-DOM half of the gate is
// _harness/vs/nobot_text.py (real Chrome, every screen a player sees).

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOT = /\bbots?\b/i;

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, detail = ''): void {
  if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

/** every string (and every object key) reachable from `v`, with its path; cycles and functions are skipped */
function walk(v: unknown, path: string, out: { path: string; text: string }[], seen: Set<unknown>): void {
  if (typeof v === 'string') { out.push({ path, text: v }); return; }
  if (v === null || typeof v !== 'object' || seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + '[' + i + ']', out, seen)); return; }
  if (v instanceof Map) { for (const [k, x] of v) walk(x, path + '.get(' + String(k) + ')', out, seen); return; }
  if (v instanceof Set) { let i = 0; for (const x of v) walk(x, path + '{' + i++ + '}', out, seen); return; }
  for (const k of Object.keys(v as object)) {
    out.push({ path: path + '.<key ' + k + '>', text: k });
    walk((v as Record<string, unknown>)[k], path + '.' + k, out, seen);
  }
}

// the scanner catches what it must (and not a word that merely contains the letters)
{
  const probe: { path: string; text: string }[] = [];
  walk({ a: ['RIVAL BOTS'], b: { c: 'A Bot took your seat' } }, 'self', probe, new Set());
  ok(probe.filter((x) => BOT.test(x.text)).length === 2, 'selftest: BOTS / Bot are caught');
  ok(!BOT.test('BOTTOM') && !BOT.test('ROBOTIC') && BOT.test('START NOW WITH BOTS') && BOT.test('bot'), 'selftest: word boundary (BOTTOM / ROBOTIC are not hits)');
}

const dataDir = join(ROOT, 'src', 'data');
const required = readdirSync(dataDir).filter((f) => /^strings.*\.ts$/.test(f)).concat(['goals.ts', 'vsgoals.ts']);
const extra = readdirSync(dataDir).filter((f) => f.endsWith('.ts') && !required.includes(f));

async function scanModule(file: string, label: string): Promise<number> {
  const mod = (await import(pathToFileURL(join(dataDir, file)).href)) as Record<string, unknown>;
  const found: { path: string; text: string }[] = [];
  for (const name of Object.keys(mod)) walk(mod[name], file + '#' + name, found, new Set());
  const hits = found.filter((f) => BOT.test(f.text));
  ok(hits.length === 0, `${label}: ${file} (${found.length} strings) has no BOT/BOTS`, hits.slice(0, 5).map((h) => h.path + ' = ' + JSON.stringify(h.text.slice(0, 80))).join(' | '));
  return found.length;
}

let total = 0;
console.log('required copy files: ' + required.join(', '));
for (const f of required) total += await scanModule(f, 'copy');
for (const f of extra) total += await scanModule(f, 'data');

// the portal-facing game_meta.json (title / descriptions / tags / controls / art direction)
{
  const meta = JSON.parse(readFileSync(join(ROOT, 'public', 'game_meta.json'), 'utf8')) as unknown;
  const found: { path: string; text: string }[] = [];
  walk(meta, 'game_meta', found, new Set());
  const hits = found.filter((f) => BOT.test(f.text));
  ok(found.length > 5 && hits.length === 0, `game_meta.json (${found.length} strings) has no BOT/BOTS`, hits.map((h) => h.path + ' = ' + JSON.stringify(h.text.slice(0, 80))).join(' | '));
  total += found.length;
  const tags = (meta as { tags?: unknown }).tags;
  ok(Array.isArray(tags) && !tags.some((t) => /bot/i.test(String(t))), 'game_meta tags carry no bot tag');
}

// the rendered output of the formatters a player's screen is built from (templates are strings above; this fills the {slots})
{
  const S = await import(pathToFileURL(join(dataDir, 'strings_vs.ts')).href) as typeof import('../../src/data/strings_vs.ts');
  const filled: string[] = [];
  const fill = (tpl: string): void => { filled.push(S.vsFmt(tpl, { name: 'KAIJU_KEV', a: 'KAIJU_KEV', b: 'MOLO', n: 2, s: 12, m: 4, t: 30, ms: 220, titan: 'MOLO', who: 'PLAYERS', code: 'ABCD', place: '2ND', lv: ' · −1 LV' })); };
  const walkTpl = (o: unknown): void => { if (typeof o === 'string') fill(o); else if (o && typeof o === 'object') for (const v of Object.values(o)) walkTpl(v); };
  walkTpl(S.VS);
  walkTpl(S.VS_BANNER); walkTpl(S.VS_RULE); walkTpl(S.VS_NEXT);
  const bad = filled.filter((t) => BOT.test(t));
  ok(filled.length > 150 && bad.length === 0, `formatted notices / lobby / HUD lines (${filled.length}) have no BOT/BOTS`, bad.slice(0, 3).join(' | '));
  // the seat handle pool is itself player-visible text
  ok(S.RIVAL_HANDLES.length >= 60 && S.RIVAL_HANDLES.every((h) => !/bot/i.test(h)), `player-handle pool (${S.RIVAL_HANDLES.length}) has no BOT anywhere`);
  let handleHits = 0;
  for (let seed = 0; seed < 2000; seed++) for (const h of Object.values(S.rivalHandles(seed, [1, 2, 3]))) if (BOT.test(h)) handleHits++;
  ok(handleHits === 0, 'generated seat names never read BOT');
  total += filled.length;
  // the replaced copy really is gone / present (the exact player-facing strings the owner asked for)
  ok(S.VS.online.startNow === 'START NOW', 'lobby: START NOW (was START NOW WITH BOTS)');
  ok(S.VS.menu.skillLabel === 'RIVAL SKILL' && S.VS.menu.skillHint === 'THE OTHER THREE TITANS', 'VS PRACTICE row: RIVAL SKILL / THE OTHER THREE TITANS');
  ok(S.VS.menu.levels.rookie === 'EASY' && S.VS.menu.levels.regular === 'REGULAR' && S.VS.menu.levels.veteran === 'HARD', 'VS PRACTICE levels: EASY / REGULAR / HARD');
  ok(S.vsFmt(S.VS.notice.botTook, { name: 'KAIJU_KEV' }) === 'KAIJU_KEV LEFT THE MATCH', 'notice: a leaver reads "{name} LEFT THE MATCH"');
  ok(/AUTOPILOT/.test(S.VS.notice.botTookYours) && /JOINED THE MATCH/.test(S.VS.notice.youTookOver), 'notices: you are away -> autopilot; you take a free seat -> JOINED THE MATCH');
}

console.log(`probe_nobot_text: scanned ${total} strings · ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
