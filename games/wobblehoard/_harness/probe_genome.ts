// Genome seam: deterministic, lossless share string, hostile input never throws.
import { makeStarterGenome, randomGenome, encodeGenome, decodeGenome, pitchRatio, genomeFromParam, genomeEquals, newInstance } from '../src/core/genome.ts';

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
process.exit(bad ? 1 : 0);
