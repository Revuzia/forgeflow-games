// ARC §3 (stage B), the UI side: the first defiant act of each kind per town is a toast in the voice whose only button is
// "Look" (later acts stay in the chronicle, their lines claimed); the god's answer as it was read is told; a defiant act
// in the open shows the fist on the name chip whatever the heart; the stub delivers the events once; the free-form box
// offers the answers in words while a town defies; the help names them. Coded to the §6 contracts ahead of the sim.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Toasts } from '../src/ui/toasts.ts';
import { heartGlyph, defyToastText, defyAnsweredText, DEFY_WORDS } from '../src/ui/hearts.ts';
import { arcStub, applyArcStub, arcStubActive } from '../src/client/arcstub.ts';
import { DEFY_EXAMPLES, defiantTown } from '../src/ui/freeform.ts';
import { livingRows } from '../src/ui/controlstext.ts';
import type { Snapshot } from '../src/sim/types.ts';

class FakeEl {
  tagName: string; className = ''; children: FakeEl[] = []; parent: FakeEl | null = null; dataset: Record<string, string> = {};
  hidden = false; title = ''; tabIndex = -1; type = ''; disabled = false; innerHTML = ''; attrs: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  private _text = '';
  constructor(tag: string) { this.tagName = tag; }
  get classList() { const self = this; return { add: (c: string) => { if (!self.className.split(' ').includes(c)) self.className += ` ${c}`; }, contains: (c: string) => self.className.split(' ').includes(c) }; }
  get isConnected(): boolean { let p: FakeEl | null = this; while (p) { if (p.tagName === 'ROOT') return true; p = p.parent; } return false; }
  get firstElementChild() { return this.children[0] ?? null; }
  get textContent(): string { return this._text + this.children.filter((c) => !c.hidden).map((c) => c.textContent).join(''); }
  set textContent(v: string) { this._text = v; this.children = []; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(k: string, f: (e: unknown) => void) { (this.listeners[k] ??= []).push(f); }
  appendChild(c: FakeEl) { c.remove(); c.parent = this; this.children.push(c); return c; }
  append(...cs: FakeEl[]) { for (const c of cs) this.appendChild(c); }
  insertBefore(c: FakeEl, ref: FakeEl | null) { c.remove(); c.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  querySelector(sel: string): FakeEl | null { const cls = sel.slice(1); for (const c of this.children) { if (c.className.split(' ').includes(cls)) return c; const r = c.querySelector(sel); if (r) return r; } return null; }
  all(pred: (e: FakeEl) => boolean): FakeEl[] { const out: FakeEl[] = []; for (const c of this.children) { if (pred(c)) out.push(c); out.push(...c.all(pred)); } return out; }
}
(globalThis as any).document = { createElement: (t: string) => new FakeEl(t) };

const aru = { id: 1, name: 'Aru', pos: [1, 0, 0], flags: 0 };
const tesh = { id: 2, name: 'Tesh', pos: [0, 1, 0], flags: 0 };
const line = (tick: number, text: string, weight = 2) => ({ tick, kind: 'god', text, weight, year: 3, day: 9, planet: 0, refs: [{ kind: 'settlement', id: 1 }] });
function view(ev: any[], chron: any[]): any {
  return {
    pendingEvents: ev, chronicle: chron,
    planet: (id: number) => (id === 0 ? { id: 0, name: 'Ebe', settlements: [aru, tesh], agents: null } : undefined),
    calendar: () => ({ year: 3, day: 9 }),
  };
}
const toasts = (root: FakeEl) => root.children[0].children.filter((c) => !c.className.includes('gn-out'));

test('the first act of each kind per town is a toast in the voice, its only button "Look"; repeats stay in the chronicle', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const root = new FakeEl('ROOT');
    const looked: unknown[] = [];
    const t = new Toasts(root as any, { lookAt: (p, pos) => looked.push([p, pos]), cmd() {} });
    t.maxShown = 6;
    const v = view([{ t: 'defy', tick: 100, planet: 0, data: { settlement: 1, kind: 'hurl', count: 8 } }],
      [line(100, 'In Aru they threw stones at the storm. The stones fell back on their fields.')]);
    t.pump(v, 1000, 0);
    let shown = toasts(root);
    assert.equal(shown.length, 1);
    assert.match(shown[0].textContent, /^Defiance · Aru/);
    assert.match(shown[0].textContent, /In Aru they are throwing stones at your storm\./);
    const buttons = shown[0].all((e) => e.tagName === 'button');
    assert.deepEqual(buttons.map((b) => b.textContent), ['Look'], 'the only button is Look (no answer menu)');
    buttons[0].listeners.click[0]({ stopPropagation() {} });
    assert.deepEqual(looked, [[0, [1, 0, 0]]], 'Look flies to the town');
    // the chronicle line was claimed: it does not come back as a milestone toast of its own
    t.pump(v, 2000, 0);
    assert.equal(toasts(root).filter((c) => /fell back on their fields/.test(c.textContent)).length, 0);
    // a second hurl in Aru: no toast, its w2 line claimed too
    v.pendingEvents.push({ t: 'defy', tick: 300, planet: 0, data: { settlement: 1, kind: 'hurl', count: 5 } });
    v.chronicle.push(line(300, 'Asha of Aru threw a spear at the lightning, and it came down in the river.'));
    t.pump(v, 3000, 0);
    t.pump(v, 4000, 0);
    assert.ok(!toasts(root).some((c) => /spear/.test(c.textContent)), 'a repeated act is chronicle only');
    // a new kind in Aru, and the same kind in another town, are news
    v.pendingEvents.push({ t: 'defy', tick: 400, planet: 0, data: { settlement: 1, kind: 'idol', count: 0 } });
    v.pendingEvents.push({ t: 'defy', tick: 401, planet: 0, data: { settlement: 2, kind: 'hurl', count: 4 } });
    t.pump(v, 5000, 0);
    shown = toasts(root);
    assert.ok(shown.some((c) => /Aru has carved a god of its own/.test(c.textContent)));
    assert.ok(shown.some((c) => /In Tesh they are throwing stones/.test(c.textContent)));
  } finally { mock.timers.reset(); }
});

test('the god\'s answer is told: the sim\'s line when it came, else a plain fallback', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const root = new FakeEl('ROOT');
    const t = new Toasts(root as any, { lookAt() {}, cmd() {} });
    t.maxShown = 6;
    const v = view([
      { t: 'defy.answered', tick: 50, planet: 0, data: { settlement: 1, how: 'mercy' } },
      { t: 'defy.answered', tick: 60, planet: 0, data: { settlement: 2, how: 'patience' } },
    ], [line(50, 'They threw stones, and the god sent rain on Aru.')]);
    t.pump(v, 1000, 0);
    const shown = toasts(root).map((c) => c.textContent);
    assert.ok(shown.some((s) => /^Answered · Aru/.test(s) && /sent rain on Aru/.test(s)), JSON.stringify(shown));
    assert.ok(shown.some((s) => /^Answered · Tesh/.test(s) && /The sky did not answer Tesh\./.test(s)), JSON.stringify(shown));
  } finally { mock.timers.reset(); }
});

test('words: every kind and answer has a line in the voice (<= 140 chars, no banned words)', () => {
  const banned = /\b(thee|thou|thy|smite|behold|hath|doth|unto|verily)\b/i;
  for (const k of ['curse', 'hurl', 'burn', 'idol']) {
    const s = defyToastText(k, 'Aru');
    assert.ok(s.length <= 140 && /Aru/.test(s) && !banned.test(s) && /^[A-Z]/.test(s), s);
    assert.ok(DEFY_WORDS[k as keyof typeof DEFY_WORDS]);
  }
  for (const how of ['wrath', 'mercy', 'sign', 'patience']) {
    const s = defyAnsweredText(how, 'Aru');
    assert.ok(s.length <= 140 && /Aru/.test(s) && !banned.test(s) && !/\bGod\b/.test(s), s);
  }
});

test('a defiant act in the open shows the fist on the chip whatever the heart, and says what they did', () => {
  const g = heartGlyph({ name: 'Aru', heart: undefined, defiant: { kind: 'hurl', tick: 9 } })!;
  assert.equal(g.icon, 'heart-defiant');
  assert.equal(g.defiantTick, 9);
  assert.equal(g.title, 'Aru: they threw stones at the storm');
  const heart = { kind: 'restless', proud: true, devoted: 0, fearful: 0, restless: 0.4, defiant: 0.2, pride: 0.7, defiance: 0.5,
    dusk: 0, duskYearAgo: 0, caption: 'They murmur', line: '', remember: [], answered: '' } as const;
  const r = heartGlyph({ name: 'Aru', heart: heart as any, defiant: { kind: 'curse', tick: 3 } })!;
  assert.equal(r.icon, 'heart-defiant');
  assert.ok(r.proud);
  assert.equal(r.title, 'Aru: They murmur · they boast · they cursed the sky');
  assert.equal(heartGlyph({ name: 'Aru', heart: heart as any })!.icon, 'heart-restless', 'without an act the heart decides');
});

test('stub("events") delivers events and chronicle once, ticked by the snapshot', () => {
  const snap = (): Snapshot => ({ tick: 77.4, events: [], chronicle: [], planets: [{ id: 0, settlements: [] }] } as unknown as Snapshot);
  arcStub('events', { events: [{ t: 'defy', planet: 0, data: { settlement: 1, kind: 'curse', count: 6 } }], chronicle: [{ text: 'At dusk in Aru they cursed the sky.', weight: 1 }] });
  assert.ok(arcStubActive());
  const a = snap();
  applyArcStub(a);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0].t, 'defy');
  assert.equal(a.events[0].tick, 77);
  assert.equal(a.chronicle[0].tick, 77);
  assert.equal(a.chronicle[0].kind, 'god');
  assert.equal(arcStubActive(), false, 'one-shot');
  const b = snap();
  applyArcStub(b);
  assert.equal(b.events.length, 0);
  arcStub('events', [{ t: 'defy.answered', tick: 5, data: { settlement: 1, how: 'sign' } }]);
  const c = snap();
  applyArcStub(c);
  assert.equal(c.events[0].tick, 5);
});

test('the free-form box offers the answers in words while a town defies; the help names them', () => {
  assert.equal(defiantTown([{ settlements: [{ name: 'Aru', flags: 0 }] }]), null);
  assert.equal(defiantTown([{ settlements: [{ name: 'Aru', flags: 0, defiant: { tick: 3 } }, { name: 'Tesh', flags: 0, defiant: { tick: 8 } }, { name: 'Gone', flags: 2, defiant: { tick: 9 } }] }]), 'Tesh');
  // every chip is a §6.5 phrase the sim reads as defiance.answer (or the hearts question)
  const arc = readFileSync(new URL('../_spec/ARC.md', import.meta.url), 'utf8');
  const row = arc.split('\n').find((l) => l.includes('`defiance.answer { how }`'))!;
  assert.ok(row, '§6.5 row');
  for (const e of DEFY_EXAMPLES) {
    const stem = e.replace(' {town}', '').replace('?', '');
    assert.ok(row.includes(stem) || arc.includes(`"${stem.replace(' of', ' of {town}')}`) || /how do the people/.test(stem), `${e} is a §6.5 phrase`);
  }
  const help = livingRows(() => '').find(([k]) => k === 'defiance');
  assert.ok(help && /no answer button/.test(help[1]) && /forgive Aru/.test(help[1]));
});

test('a first defiant act outranks the god\'s routine news in a two-toast column (888 × 500)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const root = new FakeEl('ROOT');
    const t = new Toasts(root as any, { lookAt() {}, cmd() {} });
    t.maxShown = 2;
    const v = view([
      { t: 'defy', tick: 10, planet: 0, data: { settlement: 1, kind: 'hurl', count: 8 } },
      { t: 'defy', tick: 10, planet: 0, data: { settlement: 2, kind: 'curse', count: 6 } },
      { t: 'heart', tick: 11, planet: 0, data: { settlement: 1, from: 'restless', to: 'defiant' } },
    ], []);
    t.pump(v, 1000, 0);
    const shown = toasts(root).map((c) => c.textContent);
    assert.equal(shown.filter((s) => /^Defiance/.test(s)).length, 2, JSON.stringify(shown));
  } finally { mock.timers.reset(); }
});
