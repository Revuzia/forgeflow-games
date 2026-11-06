// ARC §10 / A-r2 finding 8: at the owner's 888 × 500 frame (two toasts) the river's warning is the headline of its
// tick. The same tick brings the evacuation, the god's own disaster, the omen, the command's answer and a prayer; the
// warning outranks them, the evacuation is told on the warning's own toast, and the omen never takes "Flood on Aru."
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Toasts } from '../src/ui/toasts.ts';

// a small DOM: enough for the toast column
class FakeEl {
  tagName: string; className = ''; children: FakeEl[] = []; parent: FakeEl | null = null; dataset: Record<string, string> = {};
  hidden = false; title = ''; tabIndex = -1; type = ''; disabled = false; innerHTML = ''; attrs: Record<string, string> = {};
  private _text = '';
  constructor(tag: string) { this.tagName = tag; }
  get classList() { const self = this; return { add: (c: string) => { if (!self.className.split(' ').includes(c)) self.className += ` ${c}`; }, contains: (c: string) => self.className.split(' ').includes(c) }; }
  get isConnected(): boolean { let p: FakeEl | null = this; while (p) { if (p.tagName === 'ROOT') return true; p = p.parent; } return false; }
  get firstElementChild() { return this.children[0] ?? null; }
  get textContent(): string { return this._text + this.children.filter((c) => !c.hidden).map((c) => c.textContent).join(''); }
  set textContent(v: string) { this._text = v; this.children = []; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener() {}
  appendChild(c: FakeEl) { c.remove(); c.parent = this; this.children.push(c); return c; }
  append(...cs: FakeEl[]) { for (const c of cs) this.appendChild(c); }
  insertBefore(c: FakeEl, ref: FakeEl | null) { c.remove(); c.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  querySelector(sel: string): FakeEl | null { const cls = sel.slice(1); for (const c of this.children) { if (c.className.split(' ').includes(cls)) return c; const r = c.querySelector(sel); if (r) return r; } return null; }
}
(globalThis as any).document = { createElement: (t: string) => new FakeEl(t) };

const aru = { id: 1, name: 'Aru', pos: [1, 0, 0] };
const entry = (tick: number, kind: string, text: string) => ({ tick, kind, text: `Year 1. ${text}`, weight: 2, year: 1, day: 3, planet: 0, refs: [{ kind: 'settlement', id: 1 }] });
function view(ev: any[], chron: any[]): any {
  return {
    pendingEvents: ev, chronicle: chron,
    planet: (id: number) => (id === 0 ? { id: 0, name: 'Ebe', settlements: [aru], agents: null } : undefined),
    calendar: () => ({ year: 1, day: 3 }),
  };
}

test('the flood warning is the headline at 888 × 500, with the leaving told on it', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const root = new FakeEl('ROOT');
    const t = new Toasts(root as any, { lookAt() {}, cmd() {} });
    t.maxShown = 2;
    const chron = [
      entry(120, 'disaster', 'Rain hangs over the hills above Aru and the river climbs its banks; they take their stores and go up to high ground.'),
      entry(120, 'disaster', 'Aru leaves its homes before the flood comes.'),
      entry(120, 'disaster', 'Flood on Aru.'),
      entry(120, 'god', 'In Aru they saw the waters rise, and said it meant the god sends the water against them.'),
      entry(120, 'god', 'In Aru they say the god is punishing them for their sins.'),
    ];
    const ev = [
      { t: 'warning', tick: 120, planet: 0, data: { kind: 'flood', id: 1 }, ref: { kind: 'disaster', id: 1 } },
      { t: 'evacuate', tick: 120, planet: 0, data: { settlement: 1, disaster: 1 } },
      { t: 'disaster', tick: 120, planet: 0, data: { kind: 'flood', id: 1, god: 0 } },
      { t: 'omen', tick: 120, planet: 0, data: { kind: 'flood', settlement: 1, reading: 'feared', god: 0 } },
    ];
    const v = view(ev, chron);
    t.pump(v, 1000, 0);
    // the command's own answer and a prayer arrive right after
    t.show({ kind: 'god', title: 'Flood', text: 'The river at Aru begins to rise and run brown: the flood comes in 9 hours.' });
    v.pendingEvents.push({ t: 'prayer.raised', tick: 143, planet: 0, data: { settlement: 1, prayer: 5, kind: 'protection', urgency: 0.9 } });
    t.pump(v, 1100, 0);
    const shown = root.children[0].children.map((c) => c.textContent);
    assert.equal(shown.length, 2);
    const warn = shown.find((s) => /^Warning/.test(s));
    assert.ok(warn, `the warning stays up: ${JSON.stringify(shown)}`);
    assert.match(warn!, /river climbs its banks/);
    assert.match(warn!, /Aru leaves its homes before the flood comes/, 'the leaving is told on the warning');
    assert.ok(!shown.some((s) => /^Leaving/.test(s)), 'no second toast for the leaving');
    assert.ok(!shown.some((s) => /Flood on Aru/.test(s)), 'the generic disaster line is no headline');
    // and the generic line does not come back later as a milestone of its own
    t.pump(v, 2000, 0);
    assert.ok(!root.children[0].children.some((c) => /Flood on Aru/.test(c.textContent)));
  } finally { mock.timers.reset(); }
});

test('the omen claims the god line, not the disaster line', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const root = new FakeEl('ROOT');
    const t = new Toasts(root as any, { lookAt() {} });
    const chron = [entry(50, 'disaster', 'Flood on Aru.'), entry(50, 'god', 'In Aru they saw the waters rise, and said it meant the god sends the water against them.')];
    t.pump(view([{ t: 'omen', tick: 50, planet: 0, data: { kind: 'flood', settlement: 1, reading: 'feared' } }], chron), 10, 0);
    const shown = root.children[0].children.map((c) => c.textContent);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /^A sign · Aru/);
    assert.match(shown[0], /saw the waters rise/);
  } finally { mock.timers.reset(); }
});
