// BLOCKTOOTH VS — bot call-signs (vs_design.md §10 "Honesty": bots are labelled BOT on seat cards, the scoreboard and the end
// card, with original handler call-signs and the default palettes). Lane B-VS. Pure: a deterministic pick from the seed.

const SIGNS: readonly string[] = [
  'LOOSE PERMIT', 'NIGHT SHIFT', 'RED TAPE', 'PUBLIC WORKS', 'ZONING HOLD', 'CURB CUT', 'WET PAINT', 'LAST NOTICE',
  'OVERTIME', 'SITE VISIT', 'HARD HAT', 'FINE PRINT', 'BACK ORDER', 'CHANGE ORDER', 'SOFT OPENING', 'DEAD LETTER',
  'SECOND OPINION', 'STAY ORDER', 'PAPER TRAIL', 'STREET SWEEP',
];

/** `n` distinct call-signs for a match seeded `seed`: "UNIT <1-99> - <SIGN>". Bots only; humans keep their own names. */
export function botCallsigns(seed: number, n: number): string[] {
  const out: string[] = [];
  let s = (seed ^ 0x5bd1e995) >>> 0;
  const next = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const used: boolean[] = SIGNS.map(() => false);
  for (let i = 0; i < n; i++) {
    let k = Math.floor(next() * SIGNS.length);
    for (let g = 0; g < SIGNS.length && used[k]; g++) k = (k + 1) % SIGNS.length;
    used[k] = true;
    out.push(`UNIT ${1 + Math.floor(next() * 99)} \u2014 ${SIGNS[k]}`);
  }
  return out;
}
