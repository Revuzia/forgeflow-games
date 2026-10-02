// Genome seam: deterministic, lossless share string, hostile input never throws.
import { makeStarterGenome, randomGenome, encodeGenome, decodeGenome, pitchRatio, genomeFromParam, genomeEquals, newInstance, SPECIES } from '../src/core/genome.ts';
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
process.exit(bad ? 1 : 0);
