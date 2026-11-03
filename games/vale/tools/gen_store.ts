// VALE — regenerate content/store.json from content/skins/*.json + content/fighters/*.json.
//
//   node tools/gen_store.ts            write content/store.json
//   node tools/gen_store.ts --check    exit 1 if content/store.json is out of date (writes nothing)
//   flags: --content <dir>  --art-out <dir>  --report <file.json>  --provisional
//
// THE ΔE GATE (closing review client CL-1: a paid skin must read as different in every client view). Every paid skin's
// portrait is compared with its fighter's base portrait (both resized to 256², sRGB → CIE L*a*b* D65, mean CIE76 ΔE
// over every pixel, the measure of _harness/_reports/closing_client_verify_skin_de.json). A standard skin needs ΔE >= 12
// and a deluxe (or legend) skin ΔE >= 18. Any paid skin under its floor FAILS the gate: the tool prints the table and
// exits 1 without writing. --provisional writes anyway and re-tiers what failed (CW3 seam: "re-tiers the deluxes until
// the re-palettes pass"): a deluxe or legend under 18 is priced as a standard skin, and nothing under its floor is
// Featured or New. --check applies the gate the same way (provisional or not) and compares.
//
// One offer per NON-base skin (sku `sku_<skin_id>`). Prices are Candles by tier (modes_economy.md §8,
// with `legend` set to 3,600 for this slice, which has no premium currency). Shelves: Featured (hero),
// New (row), then one row per fighter class. starterOwnership = every base skin; starterWallet = 300
// Candles. Run it again whenever a skin file is added or changed; the output is deterministic.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n: string): boolean => args.includes(n);
const opt = (n: string, d: string): string => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CONTENT = resolve(opt('--content', join(ROOT, 'content')));
const ART_OUT = resolve(opt('--art-out', join(CONTENT, '..', 'art', 'out')));
const PROVISIONAL = flag('--provisional');

const CURRENCY = 'candles';
// first skin after 2-3 matches (owner's DONE journey: earn by play, buy, equip); deluxe ~6, legend ~12
const PRICE: Record<string, number> = { standard: 600, deluxe: 1500, legend: 2400 };
const TIER_ORDER = ['standard', 'deluxe', 'legend'];
const STARTER_CANDLES = 300;
/** skins that carry the "new" badge and fill the New row (only those that exist are used) */
const NEW_SKINS = ['ardit_first_bell', 'ilsheta_first_bell', 'kemdo_long_evening', 'nurrow_noon_fair', 'tunlan_lamplit', 'ulkro_highrim'];
/** the hero shelf: the first 4 of these that exist AND pass the ΔE gate at their tier (so the headline offers always
 *  show what you buy; closing CL-1 found 3 of the 4 Featured skins within ΔE 7.2 of their base) */
const FEATURED = ['ardit_first_bell', 'ilsheta_first_bell', 'kemdo_long_evening', 'vashil_first_bell',
  'nurrow_shadeprint', 'odrum_shadeprint', 'hesmi_shadeprint', 'ulkro_long_evening', 'burdam_almanac', 'sukri_shadeprint'];
/** the ΔE floor per tier (portrait mean CIE76 vs the base portrait) */
const DE_FLOOR: Record<string, number> = { standard: 12, deluxe: 18, legend: 18 };
const CLASS_ROWS: [string, string][] = [
  ['class_plinth', 'Plinths'], ['class_breaker', 'Breakers'], ['class_striker', 'Strikers'],
  ['class_slinger', 'Slingers'], ['class_caster', 'Casters'], ['class_tender', 'Tenders'],
];

interface Skin { id: string; fighter: string; tier: string; portrait?: string }
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

const fighterClass = new Map<string, string>();
for (const f of readdirSync(join(CONTENT, 'fighters')).filter((n) => n.endsWith('.json')).sort()) {
  const rec = readJson(join(CONTENT, 'fighters', f)) as { id: string; class: string };
  fighterClass.set(rec.id, rec.class);
}
const skins: Skin[] = [];
const skinFiles = readdirSync(join(CONTENT, 'skins')).filter((n) => n.endsWith('.json')).sort();
for (const f of skinFiles) {
  const v = readJson(join(CONTENT, 'skins', f)) as Skin[] | { skins: Skin[] };
  skins.push(...(Array.isArray(v) ? v : v.skins));
}

const base = skins.filter((s) => s.tier === 'base');
const sold = skins.filter((s) => s.tier !== 'base')
  .sort((a, b) => a.fighter.localeCompare(b.fighter) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
for (const s of sold) if (!(s.tier in PRICE)) throw new Error(`skin ${s.id}: no price for tier "${s.tier}"`);
const skuOf = (skinId: string): string => `sku_${skinId}`;

// ── the ΔE gate ──────────────────────────────────────────────────────────────────────────────────
const lin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i));
const fLab = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
function toLab(px: Buffer): Float64Array {
  const n = px.length / 3, out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = LIN[px[i * 3]], g = LIN[px[i * 3 + 1]], b = LIN[px[i * 3 + 2]];
    const x = fLab((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = fLab(r * 0.2126 + g * 0.7152 + b * 0.0722), z = fLab((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    out[i * 3] = 116 * y - 16; out[i * 3 + 1] = 500 * (x - y); out[i * 3 + 2] = 200 * (y - z);
  }
  return out;
}
const labCache = new Map<string, Promise<Float64Array | null>>();
const portraitLab = (ref: string | undefined): Promise<Float64Array | null> => {
  if (!ref) return Promise.resolve(null);
  const rest = ref.replace(/^assets\//, '');
  const file = [join(CONTENT, rest), join(ART_OUT, rest)].find((p) => existsSync(p));
  if (!file) return Promise.resolve(null);
  let p = labCache.get(file);
  if (!p) {
    p = sharp(file).removeAlpha().resize(256, 256, { fit: 'fill' }).raw().toBuffer().then((b) => toLab(b), () => null);
    labCache.set(file, p);
  }
  return p;
};
interface GateRow { skin: string; fighter: string; tier: string; floor: number; dE: number | null; pct20: number | null; pass: boolean; priced: string; note?: string }
const gate: GateRow[] = [];
for (const s of sold) {
  const b = base.find((x) => x.fighter === s.fighter);
  const [lb, ls] = await Promise.all([portraitLab(b?.portrait), portraitLab(s.portrait)]);
  const floor = DE_FLOOR[s.tier] ?? DE_FLOOR.standard;
  if (!lb || !ls) { gate.push({ skin: s.id, fighter: s.fighter, tier: s.tier, floor, dE: null, pct20: null, pass: false, priced: s.tier, note: 'portrait missing' }); continue; }
  let sum = 0, big = 0;
  const n = lb.length / 3;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(lb[i * 3] - ls[i * 3], lb[i * 3 + 1] - ls[i * 3 + 1], lb[i * 3 + 2] - ls[i * 3 + 2]);
    sum += d; if (d > 20) big++;
  }
  const dE = Math.round((sum / n) * 10) / 10;
  const pass = dE >= floor;
  // provisional: a deluxe / legend under its floor is sold at the standard price
  const priced = !pass && PROVISIONAL && s.tier !== 'standard' ? 'standard' : s.tier;
  gate.push({ skin: s.id, fighter: s.fighter, tier: s.tier, floor, dE, pct20: Math.round((1000 * big) / n) / 10, pass, priced });
}
const failed = gate.filter((g) => !g.pass);
const gateOf = new Map(gate.map((g) => [g.skin, g]));
for (const g of [...gate].sort((a, b) => (a.dE ?? -1) / a.floor - (b.dE ?? -1) / b.floor)) {
  if (!g.pass || flag('--verbose')) console.log(`  ${g.pass ? 'ok  ' : 'FAIL'} ${g.skin.padEnd(24)} ${g.tier.padEnd(9)} ΔE ${g.dE === null ? '  —' : g.dE.toFixed(1).padStart(4)} (floor ${g.floor})${g.priced !== g.tier ? ` → priced ${g.priced}` : ''}${g.note ? ` · ${g.note}` : ''}`);
}
const reportPath = opt('--report', '');
if (reportPath) writeFileSync(resolve(reportPath), JSON.stringify({ floors: DE_FLOOR, provisional: PROVISIONAL, failed: failed.map((g) => g.skin), skins: gate }, null, 1) + '\n');
if (failed.length && !PROVISIONAL) {
  console.error(`ΔE gate: ${failed.length} of ${gate.length} paid skins read too close to their base (standard >= ${DE_FLOOR.standard}, deluxe >= ${DE_FLOOR.deluxe}). Re-palette them, or write with --provisional (re-tiers them).`);
  process.exit(1);
}
const passes = (id: string): boolean => gateOf.get(id)?.pass === true;

const have = new Set(sold.map((s) => s.id));
const isNew = new Set(NEW_SKINS.filter((id) => have.has(id) && passes(id)));

const offers = sold.map((s) => ({
  sku: skuOf(s.id), kind: 'skin', ref: s.id, price: { currency: CURRENCY, amount: PRICE[gateOf.get(s.id)?.priced ?? s.tier] },
  ...(isNew.has(s.id) ? { badge: 'new' } : {}),
}));
const shelves: { id: string; name: string; skus: string[]; layout: string }[] = [
  { id: 'featured', name: 'Featured', layout: 'hero', skus: FEATURED.filter((id) => have.has(id) && passes(id)).slice(0, 4).map(skuOf) },
  { id: 'new', name: 'New', layout: 'row', skus: NEW_SKINS.filter((id) => have.has(id) && passes(id)).map(skuOf) },
];
for (const [cls, name] of CLASS_ROWS) {
  const ids = sold.filter((s) => fighterClass.get(s.fighter) === cls).map((s) => skuOf(s.id));
  if (ids.length) shelves.push({ id: `by_${cls.replace(/^class_/, '')}`, name, layout: 'row', skus: ids });
}
const unclassed = sold.filter((s) => !CLASS_ROWS.some(([c]) => c === fighterClass.get(s.fighter))).map((s) => skuOf(s.id));
if (unclassed.length) shelves.push({ id: 'by_other', name: 'More', layout: 'row', skus: unclassed });

const line = (v: unknown): string => JSON.stringify(v);
const text = `{
  "$comment": "VALE store (CONTRACT §4 StoreDef). Generated by tools/gen_store.ts from content/skins and content/fighters; re-run it when a skin is added. Scope note: this slice has NO premium currency, so the Prisms currency and the 1,350 Prisms legend pricing in _design/sections/modes_economy.md §8 are out of scope; legend skins (none yet) would cost 2,400 Candles. Prices: standard 600, deluxe 1,500 (a first skin after 2-3 matches).",
  "currencies": [
    ${line({ id: CURRENCY, name: 'Candles', desc: 'Earned by playing matches. Spend them on skins.', icon: 'assets/ui/icons/currency/candles.svg', earnedOnly: true })}
  ],
  "offers": [
${offers.map((o) => `    ${line(o)}`).join(',\n')}
  ],
  "shelves": [
${shelves.map((s) => `    ${line(s)}`).join(',\n')}
  ],
  "starterOwnership": ${line(base.map((s) => s.id))},
  "starterWallet": ${line({ [CURRENCY]: STARTER_CANDLES })}
}
`;

const target = join(CONTENT, 'store.json');
if (flag('--check')) {
  const cur = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (cur !== text) { console.error('content/store.json is out of date: run node tools/gen_store.ts'); process.exit(1); }
  console.log(`store.json is current (${offers.length} offers, ${shelves.length} shelves; ΔE gate ${gate.length - failed.length}/${gate.length} pass${PROVISIONAL && failed.length ? ', provisional' : ''})`);
} else {
  writeFileSync(target, text);
  const fightersWithSkins = new Set(skins.map((s) => s.fighter));
  console.log(`ΔE gate: ${gate.length - failed.length}/${gate.length} paid skins pass${failed.length ? ` (provisional: ${failed.length} re-tiered / kept off Featured and New)` : ''}`);
  console.log(`wrote ${target}: ${offers.length} offers, ${shelves.length} shelves, ${base.length} starter skins, ${fightersWithSkins.size} fighters with skins (${skinFiles.length} skin files)`);
}
