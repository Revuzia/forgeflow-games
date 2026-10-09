// css_audit.mjs: the static audit of EVERY stylesheet and source file of the UI (UI.md K05 + K13, B7).
//   node _harness/uikit/css_audit.mjs            -> prints the rows and exits 1 when one fails
//   node _harness/uikit/css_audit.mjs --dead     -> also lists style rules whose every selector needs a class / id / data-attribute that no source file
//                                                   (src/**/*.ts, index.html) ever creates: the candidates for deletion (prove each one by hand before deleting)
// K05  minified CSS of src (per file, lightningcss, the minifier vite uses) <= 120 KB raw and <= 30 KB gzip (UI.md 9, re-specified 2026-10-08); dev.css is dev-only and not counted
// K13  raw hex colour outside src/ui/theme.ts = 0 (and no raw rgb()/hsl() colour) | font sizes, radii, z-indexes: every value is on the theme scale (TYPE, RADII, Z of
//      src/ui/theme.ts; a var(--wh-fs-x) and the same px literal are ONE size) and the distinct count is within the cap (8 / 6 / 9) | shadows: every layer is one of 6
//      atoms (e1 e2 e3 = the elevation tokens, lip, ring, glow; the inset top highlight `rim` is light, not a shadow) | backdrop-filter <= 4 | 0 audit-list text glyphs
//      in a string of src/ui
// Exceptions, each pinned elsewhere: the :root colours of src/ui/boot.css (the loading card paints before any script installs the theme; probe_boot compares each with theme.ts),
// the display type (clamp() / vw sizes: the jelly caps and the boot card), percentages and 0 / 1 / -1 as z-index (stacking inside one component).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { TYPE, RADII, Z } from '../../src/ui/theme.ts';

const here = dirname(fileURLToPath(import.meta.url));
const G = resolve(here, '..', '..');
const require = createRequire(join(G, 'package.json'));
const { transform } = require('lightningcss');

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const rel = (p) => relative(G, p).replace(/\\/g, '/');
const SRC = join(G, 'src');
const files = walk(SRC);
const css = files.filter((f) => f.endsWith('.css'));
const ts = files.filter((f) => f.endsWith('.ts'));
const html = [join(G, 'index.html')];
const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const blank = (m) => m.replace(/[^\n]/g, ' ');
const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank);          // comments out, line numbers kept
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const isDev = (f) => f.endsWith('dev.css');

let fails = 0;
const row = (ok, name, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`); };

// ---------------------------------------------------------------- K05: minified size (what vite ships: every src CSS, one sheet each)
let rawTotal = 0, gzTotal = 0;
const per = [];
const minified = {};
for (const f of css) {
  const { code: out } = transform({ filename: f, code: Buffer.from(read(f)), minify: true });
  minified[f] = out;
  if (!isDev(f)) { rawTotal += out.length; gzTotal += gzipSync(out).length; }
  per.push([rel(f), out.length, gzipSync(out).length]);
}
const gzConcat = gzipSync(Buffer.concat(css.filter((f) => !isDev(f)).map((f) => minified[f]))).length;
per.sort((a, b) => b[1] - a[1]);
if (process.argv.includes('--sizes') || process.argv.includes('--dead')) for (const [n, r, g] of per) console.log(`     ${n.padEnd(34)} ${(r / 1000).toFixed(1).padStart(6)} KB min  ${(g / 1000).toFixed(1).padStart(5)} KB gz`);
row(rawTotal <= 120000, 'K05 minified CSS <= 120 KB raw', `${rawTotal} B = ${(rawTotal / 1000).toFixed(1)} kB = ${(rawTotal / 1024).toFixed(1)} KiB over ${css.length - 1} shipped sheets (the cap is read as 120 000 B, the stricter of the two)`);
row(gzConcat <= 30000, 'K05 gzip of the sheets as one <= 30 KB', `${(gzConcat / 1000).toFixed(1)} KB (the sum of separate gzips is ${(gzTotal / 1000).toFixed(1)} KB)`);

// ---------------------------------------------------------------- K13 colours
const theme = join(SRC, 'ui', 'theme.ts');
const hexHits = [];
for (const f of css) {
  let t = read(f);
  if (f.endsWith('boot.css')) t = t.replace(/:root \{[\s\S]*?\n\}/, blank);
  t = stripC(t);
  if (isDev(f)) continue;
  for (const m of t.matchAll(/:[^;{}]*?(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4}))(?![\w-])/g)) hexHits.push(`${rel(f)}:${lineOf(t, m.index)} ${m[1]}`);
}
for (const f of ts) {
  if (f === theme) continue;
  const t = read(f).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, (m, a) => a);
  // a colour literal sits inside a quote: '#59d6e6'; '#wh-x' (an id selector), href="#id" and url(#id) have a non-hex letter or no quote
  for (const m of t.matchAll(/['"`](#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4}))['"`]/g)) hexHits.push(`${rel(f)}:${lineOf(t, m.index)} ${m[1]}`);
}
row(hexHits.length === 0, 'K13 raw hex colours outside src/ui/theme.ts = 0 (boot.css :root excepted, pinned by probe_boot)', hexHits.slice(0, 12).join(' | ') + (hexHits.length > 12 ? ` ... ${hexHits.length} in all` : ''));
const rgbHits = [];
for (const f of css) {
  if (isDev(f) || f.endsWith('boot.css')) continue;
  const t = stripC(read(f));
  for (const m of t.matchAll(/(?<![\w-])(?:rgba?|hsla?)\(\s*[0-9]/g)) rgbHits.push(`${rel(f)}:${lineOf(t, m.index)}`);
}
row(rgbHits.length === 0, 'K13 no raw rgb() / hsl() colour in a sheet (colour-mix of a --wh-* token instead; boot.css excepted)', rgbHits.slice(0, 8).join(' | '));

// ---------------------------------------------------------------- K13 scales
const tokenSizes = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [`--wh-fs-${k}`, v]));
const tokenRadii = Object.fromEntries(Object.entries(RADII).map(([k, v]) => [`--wh-r-${k}`, v]));
const tokenZ = Object.fromEntries(Object.entries(Z).map(([k, v]) => [`--wh-z-${k}`, v]));
const SIZE_SCALE = new Set(Object.values(TYPE)), RADIUS_SCALE = new Set(Object.values(RADII)), Z_SCALE = new Set(Object.values(Z));
const num = (v, tokens) => {
  let m = v.match(/^var\((--[a-z0-9-]+)\)$/);
  if (m) return tokens[m[1]] ?? null;
  m = v.match(/^(-?[0-9.]+)(px)?$/);
  if (m) return Number(m[1]);
  // calc(var(--wh-r-card) - 4px): evaluated
  m = v.match(/^calc\(\s*var\((--[a-z0-9-]+)\)\s*([+-])\s*([0-9.]+)px\s*\)$/);
  if (m && tokens[m[1]] !== undefined) return m[2] === '-' ? tokens[m[1]] - Number(m[3]) : tokens[m[1]] + Number(m[3]);
  return null;
};
const seen = { size: new Map(), radius: new Map(), z: new Map() };
const off = { size: [], radius: [], z: [] };
const display = new Set();
const add = (kind, value) => { const m = seen[kind]; m.set(value, (m.get(value) ?? 0) + 1); };
for (const f of css) {
  if (isDev(f)) continue;
  const t = stripC(read(f));
  const here = (idx) => `${rel(f)}:${lineOf(t, idx)}`;
  for (const m of t.matchAll(/(?<![\w-])font-size\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim().replace(/\s*!important$/, '');
    if (v === 'inherit' || v === 'initial') continue;
    const n = num(v, tokenSizes);
    if (n !== null) { add('size', n); if (!SIZE_SCALE.has(n)) off.size.push(`${here(m.index)} ${v}`); }
    else if (/^(clamp|min|max|calc)\(|[0-9.]+(vw|vh|dvh|em|rem|cqw)$/.test(v)) display.add(`${rel(f)} ${v.length > 40 ? v.slice(0, 40) + '..' : v}`);
    else off.size.push(`${here(m.index)} ${v}`);
  }
  for (const m of t.matchAll(/(?<![\w-])font\s*:\s*([^;}]+)/g)) {
    const sm = m[1].match(/(var\(--wh-fs-[a-z0-9]+\)|[0-9.]+px)\s*(?:\/|\s|$)/);
    if (!sm) continue;
    const n = num(sm[1], tokenSizes);
    if (n !== null) { add('size', n); if (!SIZE_SCALE.has(n)) off.size.push(`${here(m.index)} font ${sm[1]}`); }
  }
  for (const m of t.matchAll(/(?<![\w-])border-radius\s*:\s*([^;}]+)/g)) {
    const first = m[1].trim().replace(/\s*!important$/, '').split(/\s+(?![^(]*\))/)[0];
    if (/%$/.test(first) || first === '0' || first === 'inherit') continue;
    const n = num(first, tokenRadii);
    if (n !== null) { add('radius', n); if (!RADIUS_SCALE.has(n)) off.radius.push(`${here(m.index)} ${first}`); }
    else off.radius.push(`${here(m.index)} ${first}`);
  }
  for (const m of t.matchAll(/(?<![\w-])z-index\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim().replace(/\s*!important$/, '');
    const n = num(v, tokenZ);
    if (n === null) { off.z.push(`${here(m.index)} ${v}`); continue; }
    if (n === 0 || n === 1 || n === -1) continue;                 // stacking inside one component
    add('z', n); if (!Z_SCALE.has(n)) off.z.push(`${here(m.index)} ${v}`);
  }
}
const scaleRow = (kind, label, cap) => {
  const used = [...seen[kind].keys()].sort((a, b) => a - b);
  const o = off[kind];
  row(o.length === 0 && used.length <= cap, `K13 ${label}: every value on the theme scale, <= ${cap} distinct`, `${used.length} used (${used.join(' ')})${o.length ? '; OFF-SCALE: ' + o.slice(0, 10).join(' | ') + (o.length > 10 ? ` ... ${o.length}` : '') : ''}`);
};
scaleRow('size', 'font sizes', 8);
scaleRow('radius', 'radii', 6);
scaleRow('z', 'z-indexes', 9);
row(display.size <= 8, 'info: display type (clamp / vw sizes: jelly caps, boot card) kept apart from the 7 text sizes', `${display.size}: ${[...display].slice(0, 5).join(' | ')}`);

// shadows: split every box-shadow value (and the custom properties that hold one) into layers and name each layer's atom
const SHADOW_PROPS = /(?<![\w-])(box-shadow|--k-sh|--hd-lift|--hd-tile|--hd-sel|--k-gel-lip|--k-gel-lip-down|--k-coral-lip|--k-coral-lip-down|--k-glow[a-z-]*)\s*:\s*([^;}]+)/g;
const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
const splitWs = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (/\s/.test(ch) && d === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
const atomOf = (layer) => {
  const l = layer.trim();
  if (/^(none|inherit|initial|unset)$/.test(l)) return null;
  if (/^var\(--wh-(e1|e2|e3)\)$/.test(l)) return l.match(/e[123]/)[0];
  if (/^var\(--k-(gel|coral)-lip(-down)?\)$/.test(l)) return 'lip';
  if (/^var\(--(k-sh|hd-[a-z]+|wh-lip-shadow|k-halo)[a-z-]*\s*(,[^)]*)?\)$/.test(l)) return null;     // an indirection (with or without a fallback): its own definition is audited
  const w = splitWs(l);
  const inset = w[0] === 'inset';
  const parts = inset ? w.slice(1) : w;
  const lengths = parts.filter((p) => /^-?[0-9.]+(px)?$/.test(p) || /^var\(--k-halo-spread\)$/.test(p) || /^calc\(/.test(p));
  if (lengths.length < 2) return 'unparsed';
  const val = (p) => (/^var\(/.test(p) || /^calc\(/.test(p) ? 1 : parseFloat(p));
  const [x, y, blur = 0, spread = 0] = lengths.map(val);
  if (inset && x === 0 && y === 1 && blur === 0 && spread === 0 && /rim/.test(l)) return null;   // the top highlight: light, not a shadow
  if (blur === 0 && x === 0 && y === 0 && spread !== 0) return 'ring';
  if (blur === 0 && x === 0 && y !== 0 && spread === 0) return 'lip';
  if (blur > 0 && x === 0 && y === 0) return 'glow';
  if (x === 0 && y === 0 && blur === 0 && spread === 0) return null;                            // a zero shadow (the reset value)
  return `OTHER(${l.length > 44 ? l.slice(0, 44) + '..' : l})`;
};
const atoms = new Map(); const badShadow = [];
for (const f of css) {
  if (isDev(f)) continue;
  const t = stripC(read(f));
  for (const m of t.matchAll(SHADOW_PROPS)) {
    const value = m[2].trim().replace(/\s*!important$/, '');
    for (const layer of splitTop(value)) {
      if (/^(0|transparent)$/.test(layer)) continue;
      const a = atomOf(layer);
      if (a === null) continue;
      if (a.startsWith('OTHER') || a === 'unparsed') { badShadow.push(`${rel(f)}:${lineOf(t, m.index)} ${a === 'unparsed' ? layer.slice(0, 40) : a}`); continue; }
      atoms.set(a, (atoms.get(a) ?? 0) + 1);
    }
  }
}
row(badShadow.length === 0 && atoms.size <= 6, 'K13 box-shadow: every layer is one of the 6 atoms (e1 e2 e3 lip ring glow)', `${atoms.size} used: ${[...atoms.entries()].map(([k, v]) => k + 'x' + v).join(' ')}${badShadow.length ? '; OTHER: ' + badShadow.slice(0, 8).join(' | ') : ''}`);
let bf = 0;
for (const f of css) { if (isDev(f)) continue; bf += (stripC(read(f)).match(/(?<!-webkit-)backdrop-filter\s*:\s*(?!none)/g) ?? []).length; }
row(bf <= 4, 'K13 backdrop-filter declarations <= 4', `${bf} (not counting "none" and the -webkit- twin)`);

// text glyphs of the audit list (UI_SQUISH_NOW: heart, clock, back chevron, arrow, quotes, middle dot, ellipsis, multiplication sign, cross, gear, star, ticks) inside a string of src/ui
const GLYPHS = new RegExp('[\\u2665\\u2661\\u25F7\\u2039\\u203A\\u2192\\u2190\\u201C\\u201D\\u00B7\\u2026\\u2715\\u00D7\\u2699\\u2605\\u2713\\u2714\\u25B6\\u25BC\\u25B2]');
// A glyph used AS AN ICON is a string that is only the glyph (<= 3 characters: '♥', ' ·', '…'); the same character inside a sentence is punctuation of prose (a loading line's ellipsis, the hint's
// separators, curly quotes around a nickname) and is counted apart: the audit's 11 kinds were icons in the old Hoard (heart, clock, back chevron, arrow, +, ?, ...).
const glyphHits = []; let prose = 0;
for (const f of ts.filter((p) => /[\\/]ui[\\/]/.test(p))) {
  read(f).split('\n').forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const code = t.replace(/\s\/\/.*$/, '');
    for (const sm of code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      const body = sm[2];
      const m = body.match(GLYPHS);
      if (!m) continue;
      if (body.trim().length <= 3) glyphHits.push(`${rel(f)}:${i + 1} U+${m[0].codePointAt(0).toString(16).toUpperCase()} '${body}'`); else prose++;
    }
  });
}
row(glyphHits.length === 0, 'K13 0 audit-list text glyphs used as an icon (a string of <= 3 characters) in src/ui', glyphHits.slice(0, 8).join(' | ') + (glyphHits.length > 8 ? ` ... ${glyphHits.length}` : '') + `; ${prose} prose strings carry a typographic character (ellipsis, middle dot, curly quote): not icons`);

// ---------------------------------------------------------------- dead selector candidates
if (process.argv.includes('--dead')) {
  const corpus = [...ts, ...html].map(read).join('\n');
  const used = new Map();
  const esc = (c) => c.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&');
  const classUsed = (c) => {
    if (used.has('.' + c)) return used.get('.' + c);
    let ok = new RegExp(`(?<![\\w-])${esc(c)}(?![\\w-])`).test(corpus);
    if (!ok) { // built by a prefix: 'tier-' + x   or   `tier-${x}`
      const parts = c.split('-');
      for (let i = 1; i < parts.length && !ok; i++) {
        const pre = parts.slice(0, i).join('-') + '-';
        if (new RegExp(`['"\`]${esc(pre)}(?:['"\`]|\\$\\{)`).test(corpus)) ok = true;
      }
    }
    used.set('.' + c, ok);
    return ok;
  };
  const idUsed = (c) => new RegExp(`(?<![\\w-])${esc(c)}(?![\\w-])`).test(corpus);
  const attrUsed = (a) => {
    if (!a.startsWith('data-')) return true;
    const camel = a.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return new RegExp(`(?<![\\w-])${esc(a)}(?![\\w-])`).test(corpus) || new RegExp(`dataset\\.${camel}\\b|dataset\\[['"\`]${camel}['"\`]\\]`).test(corpus) || new RegExp(`[{,]\\s*${camel}\\s*:`).test(corpus);
  };
  const dead = [];
  for (const f of css) {
    if (isDev(f)) continue;
    const src = read(f).split('\n');
    transform({
      filename: f, code: Buffer.from(read(f)), minify: false, errorRecovery: true,
      visitor: {
        Rule: {
          style(rule) {
            const miss = [];
            let allDead = true;
            for (const sel of rule.value.selectors) {
              const hereMiss = [];
              for (const c of sel) {
                if (c.type === 'class' && !classUsed(c.name)) hereMiss.push('.' + c.name);
                else if (c.type === 'id' && !idUsed(c.name)) hereMiss.push('#' + c.name);
                else if (c.type === 'attribute' && !attrUsed(c.name)) hereMiss.push('[' + c.name + ']');
              }
              if (!hereMiss.length) allDead = false;
              miss.push(...hereMiss);
            }
            if (allDead && miss.length) dead.push({ f: rel(f), line: rule.value.loc.line + 1, miss: [...new Set(miss)], text: (src[rule.value.loc.line] ?? '').trim().slice(0, 100) });
          },
        },
      },
    });
  }
  console.log(`\n--- ${dead.length} style rule(s) whose every selector needs a token no source file creates ---`);
  for (const d of dead) console.log(`${d.f}:${d.line}  ${d.miss.join(' ')}   ${d.text}`);
}
console.log(fails ? `\n${fails} FAIL` : '\nall ok');
process.exit(fails ? 1 : 0);
