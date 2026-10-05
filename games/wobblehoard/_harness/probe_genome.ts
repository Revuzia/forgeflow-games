// Genome seam: deterministic, lossless and CANONICAL share string (one genome <=> one string), hostile input never throws, and the
// src/core + src/data module graph has no import cycle (every module loads first in a fresh process).
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { makeStarterGenome, randomGenome, encodeGenome, decodeGenome, pitchRatio, genomeFromParam, genomeEquals, newInstance, quantizeGenome, canonicalGenome, SPECIES } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { CATALOG, speciesBaseGenome } from '../src/data/catalog.ts';

let bad = 0;
const check = (name: string, ok: boolean, extra = ''): void => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };

const starter = makeStarterGenome();
check('starter round-trips', genomeEquals(decodeGenome(encodeGenome(starter))!, starter));
let allOk = true;
for (let s = 0; s < 2000; s++) {
  const g = randomGenome(s);
  const back = decodeGenome(encodeGenome(g));
  if (!back || !genomeEquals(back, g) || JSON.stringify(Object.entries(back).sort()) !== JSON.stringify(Object.entries(g).sort())) { allOk = false; console.log('  mismatch at seed', s); break; }
  if (!genomeEquals(randomGenome(s), g)) { allOk = false; console.log('  non-deterministic at seed', s); break; }
}
check('2000 random genomes round-trip and are deterministic', allOk);
check('share string length is 38 chars', encodeGenome(starter).length === 38, String(encodeGenome(starter).length));
const hostile = ['', 'g1.', 'g1.AAAA', 'g2.xxxx', 'g1.' + 'A'.repeat(200), 'g1.!!!!', '\u0000', 'g1.' + encodeGenome(starter).slice(3, -2) + '!!'];
check('hostile share strings return null, never throw', hostile.every((h) => { try { return decodeGenome(h) === null; } catch { return false; } }));
const hues = new Set(Array.from({ length: 200 }, (_, i) => Math.floor(randomGenome(i).hue / 30)));
check('random genomes cover the hue wheel', hues.size >= 10, `${hues.size}/12 hue bins`);
const p = Array.from({ length: 200 }, (_, i) => pitchRatio(randomGenome(i)));
check('pitch ratio stays musical (0.6..1.7)', Math.min(...p) > 0.6 && Math.max(...p) < 1.7, `${Math.min(...p).toFixed(2)}..${Math.max(...p).toFixed(2)}`);
check('genomeFromParam: null->starter, seed, code, word', genomeEquals(genomeFromParam(null), starter)
  && genomeEquals(genomeFromParam('7'), randomGenome(7))
  && genomeEquals(genomeFromParam(encodeGenome(randomGenome(9))), randomGenome(9))
  && genomeFromParam('jelly').species === 'dollop');
const inst = newInstance(starter, { kind: 'starter' }, 'Dollop', 'test-id', 1);
check('instance carries id/genome/tradeCount', inst.id === 'test-id' && inst.tradeCount === 0 && inst.genome === starter);

// ---- catalog species (the species list now comes from src/data/catalog.ts; full coverage is in probe_catalog.ts) ----
check('SPECIES is the catalog order (50 species, dollop first)', SPECIES.length === 50 && SPECIES[0] === 'dollop' && SPECIES.every((id, i) => CATALOG[i].id === id));
check('starter genome is bit-identical to before the catalog (share string and a random genome)', encodeGenome(starter) === 'g1.AQAAAAkQAQ0gAAoA0aPMx-BhvZ6ATQCAgIA' && encodeGenome(randomGenome(7)) === 'g1.AQAAAF8NYyBhAT8Ap4vqd66h45hz4zx7vss');
for (const id of ['plumpet', 'cindergoo', 'constello'] as const) {
  const g = speciesBaseGenome(id, 12345);
  const back = decodeGenome(encodeGenome(g));
  check(`catalog species ${id}: share string round-trips and stores idx ${SPECIES.indexOf(id)}`, !!back && genomeEquals(back, g) && back.species === id, encodeGenome(g));
}
const mid = encodeGenome(speciesBaseGenome('petalop', 5));
const flip = (idx: number): string => { const raw = atob(mid.slice(3).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - ((mid.length - 3) % 4)) % 4)); const bytes = Array.from(raw, (c) => c.charCodeAt(0)); bytes[1] = idx; return 'g1.' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
check('decodeGenome returns null for an unknown species index (50, 128, 255) and decodes 49', [50, 128, 255].every((i) => decodeGenome(flip(i)) === null) && decodeGenome(flip(49)) !== null);

// ---- canonical form: encode quantises, decode refuses aliases, equality is truthful ----
{
  const g = { ...starter, hue: 32.7, gloss: 0.5004, chroma: 0.8213 };
  const q = quantizeGenome(g);
  check('encodeGenome quantises first: a genome and its quantised copy share one string, and decode gives the ROUNDED hue (32.7 -> 33, not truncated 32)',
    encodeGenome(g) === encodeGenome(q) && decodeGenome(encodeGenome(g))?.hue === 33 && q.hue === 33);
  check('genomeEquals is truthful: true for a genome and its own quantisation (and key order), false for a real difference',
    genomeEquals(g, q) && genomeEquals(q, g) && genomeEquals(starter, JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(starter).reverse())))) && !genomeEquals(starter, { ...starter, hue: 34 }) && !genomeEquals(starter, { ...starter, species: 'plumpet' }));
  const wraps = [[-10, 350], [400, 40], [360, 0], [719.6, 0]].map(([h, want]) => decodeGenome(encodeGenome({ ...starter, hue: h }))?.hue === want);
  check('out-of-range hues wrap instead of producing an undecodable string (-10 -> 350, 400 -> 40, 360 -> 0, 719.6 -> 0)', wraps.every(Boolean), wraps.join());
  const nanG = { ...starter, gloss: NaN, hue: NaN, seed: NaN } as unknown as Genome;
  const nq = quantizeGenome(nanG), nback = decodeGenome(encodeGenome(nanG));
  check('non-finite numbers get defined canonical values (unit field NaN -> 0.5, hue NaN -> 0, seed NaN -> 0) and still round-trip', nq.gloss === 0.5 && nq.hue === 0 && nq.seed === 0 && !!nback && genomeEquals(nback, nq));
  let idem = true; for (let i = 0; i < 500; i++) { const r = randomGenome(i * 31 + 7), j = { ...r, hue: r.hue + 0.37, chroma: r.chroma + 0.0011 }; if (JSON.stringify(quantizeGenome(quantizeGenome(j))) !== JSON.stringify(quantizeGenome(j))) idem = false; }
  check('quantizeGenome is idempotent (500 perturbed genomes)', idem);
  const throws = (x: unknown): boolean => { try { encodeGenome(x as Genome); return false; } catch (e) { return e instanceof RangeError; } };
  check('encodeGenome throws RangeError for a genome with no share string (unknown species, pattern, eye style, version) instead of writing byte 255',
    throws({ ...starter, species: 'nope' }) && throws({ ...starter, pattern: 'zigzag' }) && throws({ ...starter, eyeStyle: 'x' }) && throws({ ...starter, v: 2 }));
  // the last base64url character of a 26-byte payload carries 2 unused bits: the 3 alias spellings of the starter must be refused
  const code = encodeGenome(starter), B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = B64.indexOf(code[code.length - 1]);
  const aliases = [1, 2, 3].map((k) => code.slice(0, -1) + B64[(last & ~3) | k]);
  check('decodeGenome refuses non-canonical aliases (slack bits of the last character set): one genome, one string', aliases.every((a) => decodeGenome(a) === null) && decodeGenome(code) !== null, aliases.join(' '));
  let canonAll = true; for (let i = 0; i < 2000; i++) { const c = encodeGenome(randomGenome(i)); if (decodeGenome(c) === null || encodeGenome(decodeGenome(c) as Genome) !== c) canonAll = false; }
  check('every string encodeGenome writes is accepted and re-encodes to itself (2000 genomes)', canonAll);
  const cg = canonicalGenome({ ...starter, hue: 32.4, extra: 'x' });
  check('canonicalGenome: accepts a valid genome (quantised, extra keys dropped) and rejects NaN, missing fields, strings, unknown enums and non-objects',
    !!cg && cg.hue === 32 && !('extra' in cg) && genomeEquals(cg, starter)
    && [null, 5, 'g1.x', {}, { ...starter, gloss: NaN }, { ...starter, hue: '3' }, { ...starter, species: 'nope' }, { ...starter, pattern: 'x' }, { ...starter, v: 2 }, (({ seed: _s, ...rest }) => rest)(starter)].every((x) => canonicalGenome(x) === null));
}

// ---- module graph: src/core + src/data import each other without a cycle, and every module loads first in a fresh process ----
{
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dirs = ['src/core', 'src/data'];
  const files = dirs.flatMap((d) => readdirSync(resolve(root, d)).filter((f) => f.endsWith('.ts')).map((f) => resolve(root, d, f)));
  const edges = new Map<string, string[]>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const deps: string[] = [];
    // value imports and re-exports only: `import type` / `export type` are erased and cannot form a runtime cycle
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+'(\.{1,2}\/[^']+)'/gm)) {
      const target = resolve(dirname(f), m[1]);
      if (files.includes(target)) deps.push(target);
    }
    edges.set(f, deps);
  }
  const cycles: string[] = [];
  const state = new Map<string, number>(); const stack: string[] = [];
  const visit = (f: string): void => {
    state.set(f, 1); stack.push(f);
    for (const d of edges.get(f) ?? []) {
      if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d].map((x) => relative(root, x)).join(' -> '));
      else if (!state.get(d)) visit(d);
    }
    stack.pop(); state.set(f, 2);
  };
  for (const f of files) if (!state.get(f)) visit(f);
  check(`src/core + src/data value-import graph is acyclic (${files.length} modules, ${[...edges.values()].reduce((a, b) => a + b.length, 0)} edges)`, cycles.length === 0, cycles.slice(0, 3).join(' | '));
  const failed: string[] = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(f).href)});`], { encoding: 'utf8' });
    if (r.status !== 0) failed.push(`${relative(root, f)}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) ?? 'exit ' + r.status}`);
  }
  check('every src/core and src/data module loads FIRST in a fresh node process (no load-order dependence)', failed.length === 0, failed.slice(0, 3).join(' | '));
}
process.exit(bad ? 1 : 0);
