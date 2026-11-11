// GENESIS — PERF A/B switches (session 9). Every performance fix that can be turned off from the URL registers here
// (`?name=0` off, `?name=1` on; each has its default), and the perf report's header prints the effective value of every
// one of them, so an A/B run on the owner's machine labels itself even when the URL carries no switch at all.

const REG = new Map<string, string>();

function query(): URLSearchParams {
  try { return new URLSearchParams(globalThis.location?.search ?? ''); } catch { return new URLSearchParams(); }
}

/** a fix's on/off switch: `?name=0` turns it off, `?name=1` on; anything else = the default */
export function perfSwitch(name: string, def = true): boolean {
  const q = query().get(name);
  const on = q === '0' ? false : q === '1' ? true : def;
  REG.set(name, on ? '1' : '0');
  return on;
}

/** record a switch decided elsewhere (e.g. 'auto' by the GPU) */
export function perfSwitchNote(name: string, value: string): void { REG.set(name, value); }

/** 'bldpage=1 shlod=1 ...' — every registered switch with its effective value, sorted */
export function perfSwitchLine(): string {
  return [...REG.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(' ');
}
