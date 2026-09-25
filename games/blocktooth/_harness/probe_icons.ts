// BLOCKTOOTH v2 — icon + ability-bar probe (lane L8, FEATURES_V2 §4.2 / §4.3 / §15.3). Node, THREE-free.
//
//   node _harness/probe_icons.ts
//
// Asserts: the 58-glyph set exists and every glyph is a non-empty, well-formed path inside the 24×24
// box; every UPGRADES entry resolves (iconFor) to an existing glyph, an evolution to its base card's
// glyph; every action/stat table value exists; every StatKey and TriggerAction has a glyph; every
// tags[0] / tags[1] value used by UPGRADES maps to a family colour (evolutions read tags[1]); the
// rarity frame class; the §4.2 bar ordering rule on synthetic owned sets (≤ 10 all in pick order,
// > 10 top-9 by score in pick order + `+N`, ties by pick order, perk cards and duplicates excluded);
// the §4.3 badge rule. F4 adds: (6) bar glyphs — every card has ≥ 10 distinct candidates, and barGlyphs
// never repeats a glyph across 10 slots (every pick-order window of the card list + 400 seeded random
// sets, titan kits included); every card's bar fill separates from the cream slot face (contrast ≥
// SLOT_MIN_CONTRAST) without going dark (luminance ≥ 0.12); (7) the HP readout never shows hp > max.
// Exits non-zero on any failure.

import type { StatKey, TriggerAction, UpgradeDef } from '../src/core/types.ts';
import type { GlyphId } from '../src/v2types.ts';
import { UPGRADES, UPGRADE_BY_ID } from '../src/data/upgrades.ts';
import { STAT_KEYS } from '../src/upgrades/stats.ts';
import {
  BAR_SLOTS, FAMILY_COLORS, GLYPHS, GLYPH_DETAIL, GLYPH_IDS, ICON_TABLES, badgeFor, barScore, barSlots,
  familyColor, glyphSvg, iconFor, rarityFrameClass,
  SLOT_BG, SLOT_MIN_CONTRAST, barFill, barGlyphs, contrast, glyphCandidates, luminance,
} from '../src/ui/icons.ts';
import { hpReadout } from '../src/data/strings_hud.ts';

let fails = 0, checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) { fails++; console.log('  FAIL ' + msg); }
}

// ── 1. glyph set ──
const EXPECTED: GlyphId[] = [
  'heart', 'plate', 'drip', 'thorn', 'fang', 'brick', 'halo', 'bandage', 'boot', 'dash', 'hourglass',
  'arrowUp', 'star', 'dice', 'cycle', 'magnet', 'reach', 'claw', 'tempo', 'reticle', 'burst', 'bullseye',
  'exclaim', 'fist', 'links', 'chunk', 'wreck', 'foot', 'ripple', 'bolt', 'hook', 'megaphone', 'jaw',
  'vortex', 'fork', 'wire', 'dome', 'lava', 'turret', 'spore', 'vine', 'flame', 'meteor', 'snow', 'plus',
  'lock', 'banish', 'evo', 'overload', 'annex', 'trafficLight', 'notice', 'rush', 'coin', 'ribbon', 'swatch',
  'key', 'till',
];
ok(EXPECTED.length === 58, `expected list has 58 ids (${EXPECTED.length})`);
ok(GLYPH_IDS.length === 58, `GLYPHS has 58 ids (${GLYPH_IDS.length})`);
for (const id of EXPECTED) ok(typeof GLYPHS[id] === 'string' && GLYPHS[id].length > 0, `glyph ${id} exists and is non-empty`);

/** parse absolute M/L/H/V/C/Q/A/Z path data → end points; returns an error string or '' */
function checkPath(d: string, label: string): string {
  const toks = d.match(/[MLHVCQAZ]|-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!toks || toks[0] !== 'M') return `${label}: must start with M`;
  if (/[a-y]/.test(d.replace(/e-?\d/g, ''))) return `${label}: relative / unknown commands present`;
  const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, A: 7, Z: 0 };
  let i = 0, cmd = '', subpaths = 0, closed = 0, x = 0, y = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (t in ARGS) { cmd = t; i++; if (cmd === 'Z') { closed++; continue; } if (cmd === 'M') subpaths++; }
    const n = ARGS[cmd];
    if (!n) return `${label}: stray number after ${cmd}`;
    const a = toks.slice(i, i + n).map(Number);
    if (a.length < n || a.some((v) => !Number.isFinite(v))) return `${label}: bad args for ${cmd}`;
    i += n;
    if (cmd === 'H') x = a[0];
    else if (cmd === 'V') y = a[0];
    else if (cmd === 'A') { if (a[0] <= 0 || a[1] <= 0 || a[0] > 24 || a[1] > 24) return `${label}: arc radius out of range`; x = a[5]; y = a[6]; }
    else { x = a[n - 2]; y = a[n - 1]; }
    if (cmd === 'C' || cmd === 'Q') for (let k = 0; k < n; k++) if (a[k] < -1 || a[k] > 25) return `${label}: control point out of box`;
    if (x < -0.5 || x > 24.5 || y < -0.5 || y > 24.5) return `${label}: point (${x}, ${y}) outside the 24×24 box`;
    if (cmd === 'M') cmd = 'L';            // implicit lineto after moveto
  }
  if (closed !== subpaths) return `${label}: ${subpaths} subpaths but ${closed} closes (every shape must be closed)`;
  return '';
}
for (const id of GLYPH_IDS) {
  const e = checkPath(GLYPHS[id], id);
  ok(e === '', e || id);
  if (GLYPH_DETAIL[id]) { const e2 = checkPath(GLYPH_DETAIL[id], id + ' detail'); ok(e2 === '', e2 || id); }
  const svg = glyphSvg(id, '#123456', 30);
  ok(svg.startsWith('<svg') && svg.includes('viewBox="0 0 24 24"') && svg.includes('width="30"'), `glyphSvg ${id} renders an svg`);
  ok(svg.includes('fill="#123456"') && svg.includes('vector-effect="non-scaling-stroke"') && svg.includes('stroke="#1b1426"'), `glyphSvg ${id}: family fill + ink non-scaling stroke`);
  ok((svg.match(/<path /g) || []).length === (GLYPH_DETAIL[id] ? 2 : 1), `glyphSvg ${id}: path count`);
}
// no two glyphs identical (each shape distinct)
const seen = new Map<string, string>();
for (const id of GLYPH_IDS) { const k = GLYPHS[id] + '|' + GLYPH_DETAIL[id]; ok(!seen.has(k), `glyph ${id} duplicates ${seen.get(k)}`); seen.set(k, id); }

// ── 2. tables + iconFor ──
const inSet = (g: string): boolean => (GLYPH_IDS as readonly string[]).includes(g);
for (const [k, g] of Object.entries(ICON_TABLES.action)) ok(inSet(g), `action ${k} → ${g} exists`);
for (const [k, g] of Object.entries(ICON_TABLES.stat)) ok(inSet(g), `stat ${k} → ${g} exists`);
for (const k of STAT_KEYS) ok(!!(ICON_TABLES.stat as Record<string, string>)[k], `StatKey ${k} has a glyph`);
const ACTIONS: TriggerAction[] = ['spark', 'shockwave', 'heal', 'shield', 'mass', 'xp', 'magnet', 'rubbleShot', 'frenzy',
  'cdReduce', 'dashRefund', 'meteor', 'arc', 'magma', 'bloom', 'slowField', 'ultCharge'];
for (const a of ACTIONS) ok(!!(ICON_TABLES.action as Record<string, string>)[a], `TriggerAction ${a} has a glyph`);
const usedActions = new Set<string>();
for (const u of UPGRADES) for (const e of u.effects) if (e.trigger) usedActions.add(e.trigger.action);
for (const a of usedActions) ok(!!(ICON_TABLES.action as Record<string, string>)[a], `used action ${a} has a glyph`);

const histo: Record<string, number> = {};
let evos = 0;
for (const u of UPGRADES) {
  const g = iconFor(u);
  ok(inSet(g), `${u.id} → ${g} exists`);
  histo[g] = (histo[g] ?? 0) + 1;
  // rule 2 / 3
  if (!u.evo) {
    const trig = u.effects.find((e) => !!e.trigger);
    const want = trig ? (ICON_TABLES.action as Record<string, GlyphId>)[trig.trigger!.action]
      : (ICON_TABLES.stat as Record<string, GlyphId>)[u.effects.find((e) => !!e.stat)?.stat as StatKey];
    ok(g === want, `${u.id}: iconFor ${g} follows the §4.3 rule (${want})`);
  } else {
    evos++;
    const base = UPGRADE_BY_ID[u.evo.base];
    ok(!!base, `${u.id}: evolution base ${u.evo.base} exists`);
    if (base) ok(g === iconFor(base), `${u.id}: evolution uses its base's glyph (${iconFor(base)})`);
    ok(rarityFrameClass(u) === 'bt-frame-evolution', `${u.id}: evolution frame`);
  }
  if (!u.evo) ok(rarityFrameClass(u) === 'bt-frame-' + u.rarity, `${u.id}: rarity frame`);
}

// ── 3. family colours ──
const tags0 = new Set<string>(), tags1 = new Set<string>();
for (const u of UPGRADES) { tags0.add(u.tags[0]); if (u.tags[0] === 'evolution') tags1.add(u.tags[1]); }
for (const t of tags0) if (t !== 'evolution') ok(t in FAMILY_COLORS, `tags[0] '${t}' maps to a colour`);
for (const t of tags1) ok(!!t && t in FAMILY_COLORS && t !== 'evolution', `evolution tags[1] '${t}' maps to a colour`);
for (const u of UPGRADES) {
  const c = familyColor(u);
  ok(/^#[0-9a-f]{6}$/i.test(c), `${u.id}: familyColor ${c} is a hex colour`);
  if (u.evo) { const b = UPGRADE_BY_ID[u.evo.base]; if (b && !(b.tags[0] === 'kit' || b.tags[0] === 'hook')) ok(c === familyColor(b), `${u.id}: evolution keeps the base family colour`); }
}

// ── 4. bar ordering (§4.2) on synthetic owned sets ──
const defs = new Map<string, UpgradeDef>();
function D(id: string, rarity: UpgradeDef['rarity'], maxStacks: number, opt: { trig?: boolean; evo?: boolean; perk?: boolean } = {}): string {
  const d: UpgradeDef = {
    id, name: id, desc: '', rarity, maxStacks, tags: ['offense'],
    effects: opt.trig ? [{ trigger: { on: 'hit', chance: 1, icd: 1, action: 'spark', p: {} } }] : [{ stat: 'damage', mul: 0.1 }],
  };
  if (opt.evo) d.evo = { base: 'x', with: 'y' };
  if (opt.perk) d.perk = true;
  defs.set(id, d);
  return id;
}
const look = (id: string): UpgradeDef | undefined => defs.get(id);
// a) ≤ 10: all, pick order, perk excluded, duplicates ignored, 0-stack ignored
{
  const ids = ['a', 'b', 'c', 'p', 'd', 'z'].map((x) => D(x, 'common', 5, { perk: x === 'p' }));
  const owned: Record<string, number> = { a: 1, b: 2, c: 1, p: 1, d: 3, z: 0 };
  const s = barSlots([...ids, 'a', 'b'], owned, look);
  ok(s.map((x) => x.id).join(',') === 'a,b,c,d', `≤10: pick order, perk/dup/0-stack excluded (${s.map((x) => x.id).join(',')})`);
  ok(s.every((x) => x.more === 0), '≤10: no +N slot');
}
// b) exactly 10: all shown
{
  const ids: string[] = []; const owned: Record<string, number> = {};
  for (let i = 0; i < 10; i++) { ids.push(D('t' + i, 'common', 5)); owned['t' + i] = 1; }
  const s = barSlots(ids, owned, look);
  ok(s.length === 10 && s.every((x, i) => x.id === 't' + i), '=10: all 10 in pick order');
}
// c) > 10: top 9 by score in pick order + '+N'
{
  const order: string[] = []; const owned: Record<string, number> = {};
  const add = (id: string, r: UpgradeDef['rarity'], max: number, st: number, o: { trig?: boolean; evo?: boolean } = {}): void => { order.push(D(id, r, max, o)); owned[id] = st; };
  add('c1', 'common', 5, 1);            // 10
  add('c2', 'common', 5, 1);            // 10
  add('lg', 'legendary', 1, 1);         // 500 + 50 + 10
  add('c3', 'common', 5, 5);            // 50 + 50
  add('ev', 'legendary', 1, 1, { evo: true });   // 1000 + 50 + 10
  add('ep', 'epic', 3, 1);              // 310
  add('tr', 'common', 5, 1, { trig: true });      // 210
  add('ra', 'rare', 3, 1);              // 110
  add('c4', 'common', 5, 2);            // 20
  add('c5', 'common', 5, 1);            // 10
  add('c6', 'common', 5, 1);            // 10
  add('c7', 'common', 5, 1);            // 10
  add('pk', 'epic', 1, 1, {}); defs.get('pk')!.perk = true;   // excluded
  const s = barSlots(order, owned, look);
  const ids = s.map((x) => x.id ?? '+' + x.more).join(',');
  // scores: ev 1060, lg 560, ep 310, tr 210, ra 110, c3 100, c4 20, c1 10, c2 10, c5 10, c6 10, c7 10 → keep 9:
  // ev lg ep tr ra c3 c4 + the first two 10s in pick order (c1, c2); hidden c5 c6 c7 → +3
  ok(s.length === BAR_SLOTS, `>10: exactly ${BAR_SLOTS} slots (${s.length})`);
  ok(ids === 'c1,c2,lg,c3,ev,ep,tr,ra,c4,+3', `>10: top 9 by score, pick order, ties by pick order, +N last (${ids})`);
  ok(barScore(defs.get('ev')!, 1) === 1060 && barScore(defs.get('tr')!, 1) === 210 && barScore(defs.get('c3')!, 5) === 100, 'barScore weights');
}
// d) real catalogue: every owned set of real cards produces ≤ 10 slots with existing glyphs
{
  const order: string[] = []; const owned: Record<string, number> = {};
  for (const u of UPGRADES.slice(0, 25)) { order.push(u.id); owned[u.id] = 1; }
  const s = barSlots(order, owned);
  ok(s.length === 10 && s[9].id === null && s[9].more === 16, `real catalogue 25 owned → 9 + '+16' (${s.length}, +${s[9]?.more})`);
}

// ── 5. badge rule (§4.3) ──
{
  const c = defs.get('c1')!, lg = defs.get('lg')!, ev = defs.get('ev')!;
  ok(badgeFor(c, 1) === '', 'badge: 1 stack of 5 → none');
  ok(badgeFor(c, 2) === 'L2' && badgeFor(c, 4) === 'L4', 'badge: L2 / L4');
  ok(badgeFor(c, 5) === 'MAX', 'badge: maxed → MAX');
  ok(badgeFor(lg, 1) === 'MAX', 'badge: 1-stack card → MAX');
  ok(badgeFor(ev, 1) === 'EVO', 'badge: evolution → EVO');
  ok(!/★|\*/.test(badgeFor(c, 3)), 'badge: no star glyph');
}

// ── 6. bar glyphs: distinct per bar + fill contrast (F4) ──
{
  const cards = UPGRADES.filter((u) => !u.perk);
  let minCand = 99, worst = '';
  for (const u of cards) { const c = glyphCandidates(u); if (c.length < minCand) { minCand = c.length; worst = u.id; } ok(c[0] === iconFor(u), `${u.id}: first bar candidate is iconFor (§4.3)`); }
  ok(minCand >= BAR_SLOTS, `every card has ≥ ${BAR_SLOTS} glyph candidates (min ${minCand}, ${worst})`);
  const distinct = (ids: string[], label: string) => {
    const g = barGlyphs(ids);
    ok(new Set(g).size === g.length && g.every((x) => !!x), `${label}: ${ids.length} slots, ${new Set(g).size} distinct glyphs`);
  };
  // every pick-order window of 10 over the whole list, per titan (kit cards only with their titan)
  for (const t of ['molo', 'voltkite', 'hearthback', 'briarwick']) {
    const pool = cards.filter((u) => !u.titan || u.titan === t).map((u) => u.id);
    for (let i = 0; i + BAR_SLOTS <= pool.length; i += 3) distinct(pool.slice(i, i + BAR_SLOTS), `${t} window ${i}`);
    // seeded random bars
    let seed = 1337 + t.length;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let k = 0; k < 100; k++) {
      const bag = pool.slice(); const pick: string[] = [];
      while (pick.length < BAR_SLOTS && bag.length) pick.push(bag.splice(Math.floor(rnd() * bag.length), 1)[0]);
      distinct(pick, `${t} random ${k}`);
    }
  }
  // the before-F4 worst case: the 10 most common primary glyph (ripple) cards together
  const ripple = cards.filter((u) => iconFor(u) === 'ripple').slice(0, BAR_SLOTS).map((u) => u.id);
  distinct(ripple, 'ten RIPPLE-primary cards');
  let minC = 99, minL = 1, wc = '', wl = '';
  for (const u of cards) {
    const f = barFill(u), c = contrast(f, SLOT_BG), l = luminance(f);
    if (c < minC) { minC = c; wc = `${u.id} ${f}`; }
    if (l < minL) { minL = l; wl = `${u.id} ${f}`; }
  }
  ok(minC >= SLOT_MIN_CONTRAST, `bar fill vs slot face: min contrast ${minC.toFixed(2)} ≥ ${SLOT_MIN_CONTRAST} (${wc})`);
  ok(minL >= 0.12, `bar fill never dark-on-dark: min luminance ${minL.toFixed(3)} ≥ 0.12 (${wl})`);
  console.log(`probe_icons: bar glyphs — min candidates ${minCand} · fill contrast min ${minC.toFixed(2)} (${wc}) · luminance min ${minL.toFixed(3)} (${wl})`);
}

// ── 7. HP readout (F4: never hp > max) ──
{
  const cases: [number, number, string][] = [
    [157.9, 157.4, '157 / 157'], [157.4, 157.4, '157 / 157'], [100, 100, '100 / 100'], [0.2, 157.4, '1 / 157'],
    [0, 100, '0 / 100'], [-5, 100, '0 / 100'], [250, 157.4, '157 / 157'], [NaN, 100, '0 / 100'], [50, NaN, '1 / 1'], [99.5, 100, '100 / 100'],
  ];
  for (const [h, m, want] of cases) ok(hpReadout(h, m) === want, `hpReadout(${h}, ${m}) → '${hpReadout(h, m)}' (want '${want}')`);
  for (let i = 0; i < 2000; i++) {
    const m = 20 + i * 0.731, h = (i % 7 === 0 ? 1.2 : (i % 13) / 12) * m;
    const [a, b] = hpReadout(h, m).split(' / ').map(Number);
    if (!(a <= b)) { ok(false, `hpReadout(${h}, ${m}) = ${a} / ${b}: hp side above max`); break; }
  }
  checks++;
}

const top = Object.entries(histo).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g, n]) => `${g} ${n}`).join(' · ');
console.log(`probe_icons: ${GLYPH_IDS.length} glyphs · ${UPGRADES.length} cards (${evos} evolutions) · ${Object.keys(histo).length} distinct card glyphs · top: ${top}`);
console.log(`probe_icons: tags[0] ${[...tags0].sort().join('/')} · evolution tags[1] ${[...tags1].sort().join('/')}`);
console.log(`probe_icons: ${checks} checks, ${fails} failed → ${fails ? 'FAIL' : 'PASS'}`);
process.exit(fails ? 1 : 0);
