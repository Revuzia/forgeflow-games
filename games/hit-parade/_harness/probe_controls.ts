// probe_controls (lane INPUT, CONTRACT §36.1 / §36.5): the EASY control scheme's input layer + settings, under plain node.
//   * input.ts: the 22-bit word (BIT / WORD_MASK / socd keep bits 15-21, drop 22+), the EASY P1 defaults and the P2 SIMPLE
//     layout + NumpadDecimal BLOCK (one owner per key across both players), schemeActions, describeWord, the UI lane's read
//     API (bindingLabels key caps + codes, keyMap), Input#force words.
//   * ui/settings.ts: defaults (P1 EASY, P2 SIMPLE, controlsRev 2, controlsBar on), the pre-EASY save migration (a v0.4.0
//     default save -> EASY with the new keys; an explicit CLASSIC keeps its whole map + free new keys; custom remaps stay),
//     idempotence (a rev-2 save is never migrated again: an explicit SIMPLE stays SIMPLE), the SettingsStore round trip
//     through a fake localStorage, setScheme(p, 2) on a pre-EASY layout.
//   * net: NET_PROTO 2, the online reveal keeps scheme 2 (schemeOf), the u32 INPUT packet size.
import { tester } from './fixtures/simkit.ts';
import {
  ACTIONS, BIT, DEFAULT_KEYS, Input, LEGACY_KEYS, WORD_MASK, bindingLabels, codeLabel, describeWord, keyMap, schemeActions, socd,
  type Action,
} from '../runtime/src/input.ts';
import { CONTROLS_REV, SettingsStore, defaultSettings, sanitizeSettings } from '../runtime/src/ui/settings.ts';
import { SaveStore, SAVE_KEY } from '../runtime/src/ui/save.ts';
import { INPUT, INPUT_WORD_BITS } from '../runtime/src/core/config.ts';
import { IN, WORD_BITS } from '../runtime/src/core/sim/inputs.ts';
import { B as PADB, WORD_MASK as PAD_MASK } from '../runtime/src/core/ai/pad.ts';
import { NET_PROTO } from '../runtime/src/net/netplay.ts';
import { schemeOf as onlineScheme } from '../runtime/src/net/online_flow.ts';
import { inputPacketBytes, WORD_BYTES } from '../runtime/src/core/net/packet.ts';

const t = tester('probe_controls');

// ---- the word
{
  const want: Record<string, number> = { BLOCK: 1 << 15, SP1: 1 << 16, SP2: 1 << 17, SP3: 1 << 18, SP4: 1 << 19, SUPER1: 1 << 20, SUPER3: 1 << 21 };
  const same = Object.entries(want).every(([k, v]) => (BIT as Record<string, number>)[k] === v && (INPUT as Record<string, number>)[k] === v &&
    (IN as Record<string, number>)[k] === v && (PADB as Record<string, number>)[k] === v);
  t.ok(same, 'bits 15-21 (BLOCK, SP1-SP4, SUPER1, SUPER3) agree in input.ts BIT, core/config.ts INPUT, core/sim/inputs.ts IN, core/ai/pad.ts B');
  t.ok(WORD_MASK === 0x3fffff && WORD_BITS === 0x3fffff && INPUT_WORD_BITS === 0x3fffff && PAD_MASK === 0x3fffff, 'WORD_MASK / WORD_BITS / INPUT_WORD_BITS / pad WORD_MASK = 0x3fffff');
  const w = BIT.BLOCK | BIT.SP2 | BIT.SUPER3 | BIT.LEFT | BIT.RIGHT | BIT.STEP_IN | BIT.STEP_OUT | (1 << 22) | (1 << 30);
  t.eq(socd(w), BIT.BLOCK | BIT.SP2 | BIT.SUPER3, 'socd keeps bits 15-21, cleans L+R / STEP_IN+STEP_OUT, drops bits 22+');
  t.ok(describeWord(BIT.BLOCK | BIT.SP1 | BIT.SUPER1 | BIT.DOWN) === '2 BLOCK+SP1+SUPER', 'describeWord names the new bits', describeWord(BIT.BLOCK | BIT.SP1 | BIT.SUPER1 | BIT.DOWN));
  const inp = new Input({ detected: { mode: 'kbm', pinned: true } });
  inp.force(0, BIT.BLOCK | BIT.SP4 | BIT.SUPER1, 2);
  const out = inp.sampleAll();
  t.eq(out[0], BIT.BLOCK | BIT.SP4 | BIT.SUPER1, 'Input#force / sampleAll carry bits 15-21 into the tick word');
}

// ---- default bindings (CONTRACT §36.1 table)
{
  const k0 = DEFAULT_KEYS[0];
  const k1 = DEFAULT_KEYS[1];
  const table: Array<[Action, string[]]> = [
    ['left', ['KeyA']], ['right', ['KeyD']], ['up', ['KeyW', 'Space']], ['down', ['KeyS']], ['blockHold', ['ShiftLeft']],
    ['l', ['KeyJ']], ['m', ['KeyK']], ['h', ['KeyL']], ['sp1', ['KeyU']], ['sp2', ['KeyI']], ['sp3', ['KeyO']], ['sp4', ['KeyP']],
    ['super1', ['KeyH']], ['super3', ['KeyY']], ['throw', ['KeyF']], ['parry', ['KeyR']], ['impact', ['KeyG']], ['taunt', ['KeyT']],
    ['stepIn', ['KeyQ']], ['stepOut', ['KeyE']], ['pause', ['Escape']], ['controls', ['F1']], ['s', ['Semicolon']], ['assist', ['KeyN']],
  ];
  const bad = table.filter(([a, c]) => JSON.stringify(k0[a]) !== JSON.stringify(c)).map(([a]) => `${a}=${JSON.stringify(k0[a])}`);
  t.ok(bad.length === 0, 'P1 keyboard defaults = the CONTRACT §36.1 EASY table (+ ; S and N ASSIST for SIMPLE / CLASSIC)', bad.join(' '));
  const p2Old = (Object.keys(LEGACY_KEYS[1]) as Action[]).every((a) => JSON.stringify(k1[a]) === JSON.stringify(LEGACY_KEYS[1][a]));
  t.ok(p2Old && JSON.stringify(k1.blockHold) === '["NumpadDecimal"]' && ['sp1', 'sp2', 'sp3', 'sp4', 'super1', 'super3', 'controls'].every((a) => k1[a as Action].length === 0),
    'P2 keyboard keeps its SIMPLE layout, BLOCK = NumpadDecimal, no SPECIAL / SUPER / controls keys by default');
  const owners = new Map<string, string>();
  const dup: string[] = [];
  for (const p of [0, 1] as const) for (const a of ACTIONS) for (const c of DEFAULT_KEYS[p][a]) { if (owners.has(c)) dup.push(`${c}: ${owners.get(c)} + P${p + 1} ${a}`); owners.set(c, `P${p + 1} ${a}`); }
  t.ok(dup.length === 0, `no key owned twice across both players' defaults (${owners.size} codes)`, dup.join('; '));
  const reserved = [...owners.keys()].filter((c) => /^(Control|Alt|Meta|Tab|F5|F11|F12)/.test(c));
  t.ok(reserved.length === 0, 'no default on browser-reserved keys (Ctrl / Alt / Meta / Tab / F5 / F11 / F12); F1 is preventDefault-ed by Input', reserved.join(' '));
  const easy = schemeActions(2);
  const simple = schemeActions(0);
  t.ok(!easy.includes('s') && !easy.includes('assist') && ['blockHold', 'sp1', 'sp4', 'super1', 'super3', 'controls'].every((a) => easy.includes(a as Action)) &&
    simple.includes('s') && simple.includes('assist') && simple.includes('blockHold'), 'schemeActions: EASY lists SPECIAL 1-4 / SUPER keys and no S / ASSIST; SIMPLE lists S + ASSIST (+ BLOCK)');
}

// ---- the UI lane's read API
{
  const L = bindingLabels(DEFAULT_KEYS[0], defaultSettings().controls[0].pad);
  const L2 = bindingLabels(DEFAULT_KEYS[1]);
  const okCaps = L.blockHold.keys[0] === 'SHIFT' && L.sp1.keys[0] === 'U' && L.sp4.keys[0] === 'P' && L.super1.keys[0] === 'H' && L.super3.keys[0] === 'Y' &&
    L.s.keys[0] === ';' && L.controls.keys[0] === 'F1' && L.up.keys.join('/') === 'W/SPACE' && L.blockHold.codes[0] === 'ShiftLeft' && L.l.pad[0] === 'X' &&
    L2.blockHold.keys[0] === 'NUM .' && L2.sp1.keys.length === 0 && ACTIONS.every((a) => !!L[a]);
  t.ok(okCaps, 'bindingLabels: key caps + codes + pad labels per action (SHIFT, U..P, H, Y, ;, F1, W/SPACE; P2 NUM .; unbound = [])',
    `blockHold ${L.blockHold.keys} sp1 ${L.sp1.keys} s ${L.s.keys} controls ${L.controls.keys} P2 block ${L2.blockHold.keys}`);
  const km = keyMap(DEFAULT_KEYS[0]);
  t.ok(km.KeyU?.[0] === 'sp1' && km.ShiftLeft?.[0] === 'blockHold' && km.Space?.[0] === 'up' && km.KeyQ?.[0] === 'stepIn', 'keyMap: code -> actions (a drawn keyboard)');
  t.ok(codeLabel('NumpadDecimal') === 'NUM .' && codeLabel('Semicolon') === ';' && codeLabel('ShiftLeft') === 'SHIFT', 'codeLabel caps for the new defaults');
}

// ---- settings defaults + migration
const v040Default = (scheme: 0 | 1): unknown => ({
  controls: [
    { scheme, keys: { ...LEGACY_KEYS[0] }, pad: { up: [12], down: [13], left: [14], right: [15], l: [2], m: [3], h: [5], s: [0], assist: [1], throw: [6], parry: [4], impact: [7], taunt: [8], pause: [9], stepIn: [17], stepOut: [18] } },
    { scheme: 0, keys: { ...LEGACY_KEYS[1] }, pad: { up: [12], down: [13], left: [14], right: [15], l: [2], m: [3], h: [5], s: [0], assist: [1], throw: [6], parry: [4], impact: [7], taunt: [8], pause: [9], stepIn: [17], stepOut: [18] } },
  ],
  volume: { master: 0.5, music: 0.5, sfx: 0.9, voice: 0.9, crowd: 0.7 }, gore: 'sparks',
});
{
  const d = defaultSettings();
  t.ok(d.controls[0].scheme === 2 && d.controls[1].scheme === 0 && d.controlsRev === CONTROLS_REV && CONTROLS_REV === 2 && d.controlsBar === true,
    'defaults: P1 EASY (2), P2 SIMPLE (0), controlsRev 2, controlsBar on');
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const m1 = sanitizeSettings(v040Default(0));
  t.ok(m1.controls[0].scheme === 2 && same(m1.controls[0].keys, d.controls[0].keys) && m1.controlsRev === 2 && m1.gore === 'sparks' && m1.volume.master === 0.5,
    'migration: a v0.4.0 save on the default SIMPLE + default keys -> EASY with exactly the new default keys (other settings kept)',
    `scheme ${m1.controls[0].scheme} keys ${same(m1.controls[0].keys, d.controls[0].keys) ? 'new defaults' : JSON.stringify(m1.controls[0].keys)}`);
  t.ok(m1.controls[1].scheme === 0 && same(m1.controls[1].keys, d.controls[1].keys), 'migration: P2 keeps SIMPLE and its keys, gains NumpadDecimal BLOCK');
  const m2 = sanitizeSettings(v040Default(1));
  const k = m2.controls[0].keys;
  t.ok(m2.controls[0].scheme === 1 && k.s[0] === 'KeyI' && k.assist[0] === 'KeyU' && k.throw[0] === 'KeyH' && k.parry[0] === 'KeyO' && k.impact[0] === 'KeyP' &&
    k.taunt[0] === 'KeyY' && k.blockHold[0] === 'ShiftLeft' && k.controls[0] === 'F1' && k.sp1.length === 0 && k.super1.length === 0,
    'migration: an explicit CLASSIC keeps its scheme + whole key map; new actions only take free keys (Shift BLOCK, F1)', JSON.stringify({ s: k.s, sp1: k.sp1, block: k.blockHold }));
  const custom = v040Default(0) as { controls: Array<{ keys: Record<string, string[]> }> };
  custom.controls[0].keys.l = ['KeyZ'];
  custom.controls[0].keys.taunt = ['KeyB'];
  const m3 = sanitizeSettings(custom);
  const k3 = m3.controls[0].keys;
  t.ok(m3.controls[0].scheme === 2 && k3.l[0] === 'KeyZ' && k3.taunt[0] === 'KeyB' && k3.sp1[0] === 'KeyU' && k3.throw[0] === 'KeyF' && k3.s[0] === 'Semicolon',
    'migration: custom remaps stay (L on Z, TAUNT on B), the actions still on old defaults take the new ones', JSON.stringify({ l: k3.l, taunt: k3.taunt, sp1: k3.sp1, throw: k3.throw }));
  // idempotent: a rev-2 save is never migrated again (an explicit SIMPLE after the EASY era stays SIMPLE, keys stay)
  const r2 = sanitizeSettings({ ...m2, controls: [{ ...m2.controls[0], scheme: 0 }, m2.controls[1]] });
  t.ok(r2.controls[0].scheme === 0 && r2.controls[0].keys.s[0] === 'KeyI', 'a rev-2 save is not migrated again (explicit SIMPLE + its keys stay)');
  t.ok(JSON.stringify(sanitizeSettings(m1)) === JSON.stringify(m1), 'sanitize(migrated) == migrated (stable)');
  // a corrupt / hostile old map (a code on two actions - never written by the game) is sanitised as before: saved order wins
  const hostile = sanitizeSettings({ controls: [{ scheme: 3, keys: { l: ['KeyJ', 'KeyJ', '<script>', 'Mouse0'], m: ['KeyJ'] }, pad: { s: [0, 99, -1] } }] });
  t.ok(hostile.controls[0].scheme === 2 && hostile.controls[0].keys.l.join() === 'KeyJ' && hostile.controls[0].keys.m.length === 0 && hostile.controls[0].pad.s.join() === '0',
    'hostile old blob: scheme 3 = never chosen -> EASY; J on L and M -> L keeps it (the bootcheck lab blob)', JSON.stringify({ s: hostile.controls[0].scheme, l: hostile.controls[0].keys.l, m: hostile.controls[0].keys.m }));
}

// ---- SettingsStore round trip through a (fake) localStorage
{
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k) as string : null), setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); },
  };
  mem.set(SAVE_KEY, JSON.stringify({ v: 1, settings: v040Default(0), unlocks: { freak: true, ricky: false }, clears: {}, scores: { season: [], pilot: [] }, online: { name: 'OLDIE' }, seen: {} }));
  const st = new SettingsStore(new SaveStore());
  const loaded = st.get();
  st.set({ controlsBar: false });
  const blob = JSON.parse(mem.get(SAVE_KEY) ?? '{}') as { settings?: { controlsRev?: number; controlsBar?: boolean; controls?: Array<{ scheme: number }> }; online?: { name: string }; unlocks?: { freak: boolean } };
  const st2 = new SettingsStore(new SaveStore());
  t.ok(loaded.controls[0].scheme === 2 && blob.settings?.controlsRev === 2 && blob.settings?.controlsBar === false && blob.settings?.controls?.[0].scheme === 2 &&
    st2.get().controls[0].scheme === 2 && st2.get().controlsBar === false && blob.online?.name === 'OLDIE' && blob.unlocks?.freak === true,
    'SettingsStore: an old save loads as EASY, the next write stores controlsRev 2 + controlsBar, a reload keeps both; the rest of the save is untouched');
  // setScheme(0, 2) on a pre-EASY CLASSIC layout installs the default keys; P2 keeps its own
  mem.set(SAVE_KEY, JSON.stringify({ v: 1, settings: v040Default(1) }));
  const st3 = new SettingsStore(new SaveStore());
  const before = st3.get().controls[0].keys.sp1.length;
  st3.setScheme(0, 2);
  const after = st3.get().controls[0];
  t.ok(before === 0 && after.scheme === 2 && after.keys.sp1[0] === 'KeyU' && after.keys.super1[0] === 'KeyH' && st3.get().controls[1].keys.l[0] === 'Numpad1',
    'setScheme(P1, EASY) on a CLASSIC layout with no SPECIAL keys installs the EASY keys (P2 untouched)', `sp1 ${before} -> ${after.keys.sp1}`);
  st3.setScheme(0, 1);
  t.ok(st3.get().controls[0].scheme === 1 && st3.get().controls[0].keys.sp1[0] === 'KeyU', 'setScheme back to CLASSIC keeps the keys (one map serves every scheme)');
}

// ---- net
{
  t.ok(NET_PROTO === 2, `net/netplay.ts NET_PROTO = ${NET_PROTO} (old clients never pair)`);
  t.ok(onlineScheme(2) === 2 && onlineScheme('2') === 2 && onlineScheme(1) === 1 && onlineScheme(7) === 0, 'online reveal: schemeOf keeps EASY (2) through the wire string');
  t.ok(WORD_BYTES === 4 && inputPacketBytes(8, false) === 52 && inputPacketBytes(8, true) === 60, 'INPUT packet = 20 + 8*cs + 4N bytes (u32 words)');
}

t.done('EASY input word, defaults, bindings API, settings migration, net proto');
