// TEMP lane-AI A/B switches (scratch experiments only; removed before commit)
const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
const set = new Set(String(g.process?.env?.VALE_AB ?? '').split(',').filter((x) => x));
export function ab(k: string): boolean { return set.has(k); }
