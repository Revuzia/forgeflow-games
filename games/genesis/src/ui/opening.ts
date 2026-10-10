// GENESIS — the opening (CONTRACT.md §16.1; the first minutes of a new game on the barren world). It teaches by
// suggestion and adapts to what the player does first; every power works from the first frame.
//   1. Black. The star ignites (the ignition cue; the dark lifts off the system view).
//   2. The airless world turns into view. A whisper: "It is quiet. Breathe on it?" — with one button that does it,
//      and the three other ways to do anything: the palette (/), the radial (hold Q) and words (Enter).
//   3. Air → "Water?"   4. Water → "Soil, and a seed."   5. Green → "Someone to see it?"
//   6. The first night: if they keep a fire, the hearths glow and the whisper says so; if not, they huddle cold in
//      the dark and the whisper notes it (and offers fire).
// Each step is the first one the world has not met yet, in that order — air, water, green, people, then fire by their
// first night — so a player who does several at once (or uses the palette, the radial or words instead of the button)
// skips ahead. After ~20 s with nothing done, a whisper adds another way. The last whisper (their fire, or their cold
// night) stays a while; then the opening ends.
// Esc opens the scenario picker (this barren world, Two worlds, a living system, the sandbox, a saved world); Esc there
// returns to the whisper. "Not now" ends the opening for good.

import type { PlanetView } from '../client/worldview.ts';
import type { Command } from '../sim/types.ts';
import type { UiHost } from './host.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';

export interface OpeningDeps {
  host: UiHost;
  action(id: string): void;
  openFreeform(text: string): void;
  openPalette(query: string): void;
  /** the radial, open on a category */
  openRadialAt(category: string): void;
  newWorld(scenario: string): void;
  openSaves(): void;
  /** the camera's part: 'star' frames the system from the dark, 'world' turns the home world into view */
  camera?(shot: 'star' | 'world'): void;
}

interface Step {
  id: 'air' | 'water' | 'green' | 'people' | 'night' | 'fire';
  whisper: string;
  /** what the button does, and what it is called */
  act?: { label: string; icon: string; run(): void };
  /** words the "do this" field would take, and the palette's search, and the radial's category */
  words: string;
  search: string;
  radial: string;
  /** a second, later suggestion when nothing happens for a while */
  later: string;
}

/** the scenario picker's worlds (the barren one continues this world) */
const WORLDS: { id: string; name: string; desc: string }[] = [
  { id: 'barren', name: 'This barren world', desc: 'Stay here: one airless rock and everything still to do.' },
  { id: 'twoworlds', name: 'Two worlds', desc: 'Plains folk on a green world, a hive on a warm desert one — and the sky between them.' },
  { id: 'system', name: 'A living system', desc: 'Four to six worlds, several peoples at different ages, one within reach of rockets.' },
  { id: 'sandbox', name: 'Sandbox', desc: 'A terran world with nothing alive yet: shape it as you like.' },
];

export class Opening {
  readonly root: HTMLDivElement;
  private host: UiHost;
  private deps: OpeningDeps;
  private veil: HTMLDivElement;
  private card: HTMLDivElement;
  private picker: HTMLDivElement;
  private pickerVeil: HTMLDivElement;
  private active = false;
  /** seconds since the opening began (real time: a slow machine does not stretch the dark) */
  private t = 0;
  private t0 = 0;
  private step: Step | null = null;
  private stepAt = 0;
  private laterShown = false;
  /** the whisper waits for the world to turn into view */
  private shown = false;
  private nightSaid = false;
  private fireNote = false;
  private lastCheck = -1e9;
  private met = { air: false, water: false, green: false, people: false, fire: false };
  private planet = -1;

  constructor(parent: HTMLElement, world: HTMLElement, deps: OpeningDeps) {
    this.deps = deps;
    this.host = deps.host;
    this.veil = h('div', { class: 'gn-open-veil' }, h('div', { class: 'gn-open-title', text: 'GENESIS' }), h('div', { class: 'gn-open-sub', text: 'You poured water on a dead rock. Now they have a word for you.' }));
    this.veil.hidden = true;
    world.appendChild(this.veil);
    this.card = h('div', { class: 'gn-panel gn-whisper', role: 'status', aria: { live: 'polite' } });
    this.card.hidden = true;
    parent.appendChild(this.card);
    this.pickerVeil = h('div', { class: 'gn-veil gn-open-pveil', on: { pointerdown: () => this.closePicker() } });
    this.pickerVeil.hidden = true;
    this.picker = h('div', { class: 'gn-panel gn-win gn-win-center gn-open-picker', role: 'dialog', aria: { label: 'Begin a world' } });
    this.picker.hidden = true;
    parent.append(this.pickerVeil, this.picker);
    this.root = this.picker;
  }

  /** the scenario picker is up: the world waits */
  get modal(): boolean { return !this.picker.hidden; }
  /** the dark is up: names and markers stay hidden */
  get hush(): boolean { return this.active && this.t < 3.2; }
  get isActive(): boolean { return this.active; }

  /** begin: black, the star, the world, the first whisper */
  start(): void {
    this.active = true;
    this.t = 0;
    this.t0 = performance.now();
    this.shown = false;
    this.veil.hidden = false;
    this.veil.style.opacity = '1';
    this.planet = this.host.primary();
    this.deps.camera?.('star');
    this.host.sound('ignition');
  }

  /** Esc: the picker (or back from it); true when the opening took the key */
  cancel(): boolean {
    if (!this.picker.hidden) { this.closePicker(); return true; }
    if (!this.active) return false;
    this.openPicker();
    return true;
  }

  /** end the opening for good (the world stays as it is) */
  end(): void {
    this.active = false;
    this.card.hidden = true;
    this.veil.hidden = true;
    this.closePicker();
  }

  frame(dt: number): void {
    if (!this.active) return;
    void dt;
    this.t = (performance.now() - this.t0) / 1000;
    // 1. the dark lifts off the star (the veil fades), then the world turns into view
    if (this.t < 3.4) {
      const a = this.t < 0.6 ? 1 : Math.max(0, 1 - (this.t - 0.6) / 2.6);
      this.veil.style.opacity = a.toFixed(3);
      if (a <= 0) this.veil.hidden = true;
      if (this.t >= 2.2 && !this.shown) { this.shown = true; this.deps.camera?.('world'); }
      return;
    }
    if (!this.veil.hidden) this.veil.hidden = true;
    const now = performance.now();
    if (now - this.lastCheck > 700) { this.lastCheck = now; this.check(); }
    // after a while with nothing done, one more way to do it
    if (this.step && !this.laterShown && now - this.stepAt > 20000 && this.t > 8) {
      this.laterShown = true;
      this.render();
    }
    // the whisper gives way to the palette, the radial, a window
    this.card.classList.toggle('gn-whisper-away', this.modal || document.querySelector('.gn-pal:not([hidden]), .gn-rad:not([hidden]), .gn-win:not([hidden]):not(.gn-open-picker)') !== null);
  }

  /** what the world has now, and the whisper for the first thing it lacks */
  private check(): void {
    const v = this.host.view;
    const pv = v.planet(this.planet) ?? v.planet(this.host.primary());
    if (!pv) return;
    this.met.air ||= pv.params.atmosphere.pressure > 0.05;
    this.met.water ||= fraction(pv, 'water', 0.5) > 0.015;
    this.met.green ||= mean(pv, 'grass') + mean(pv, 'tree') + mean(pv, 'shrub') > 0.02;
    const live = pv.settlements.filter((s) => !(s.flags & 2) && s.population > 0);
    this.met.people ||= live.length > 0;
    const fire = live.some((s) => s.era !== 'stone' || s.nightLight > 0);
    const night = live.length > 0 && isNight(pv, live[0].pos);
    let next: Step['id'] | null = !this.met.air ? 'air' : !this.met.water ? 'water' : !this.met.green ? 'green' : !this.met.people ? 'people' : null;
    if (!next && live.length) {
      if (fire && !this.fireNote) next = 'fire';
      else if (!fire && night && !this.nightSaid) next = 'night';
    }
    if (!next) {
      // the people found (or were given) fire, or the night passed with the note said: after the last whisper has
      // been read, the opening is done
      const last = this.step && (this.step.id === 'night' || this.step.id === 'fire');
      if (this.met.people && (this.fireNote || this.nightSaid) && !(this.step?.id === 'night' && night) && (!last || performance.now() - this.stepAt > 14000)) { this.end(); return; }
      if (this.step && !last) { this.step = null; this.card.hidden = true; }
      return;
    }
    if (this.step?.id === next) return;
    if (next === 'night') this.nightSaid = true;
    if (next === 'fire') this.fireNote = true;
    this.step = this.stepFor(next, pv, live[0]?.id ?? -1);
    this.stepAt = performance.now();
    this.laterShown = false;
    this.host.sound('whisper');
    this.render();
  }

  private cmd(...cs: Command[]): void {
    void (async () => { for (const c of cs) await this.host.cmd(c); })();
  }

  private stepFor(id: Step['id'], pv: PlanetView, sid: number): Step {
    const planet = pv.id;
    const here = () => this.host.focusGround()?.dir ?? [0, 0, 1];
    switch (id) {
      case 'air': return {
        id, whisper: 'It is quiet. Breathe on it?', words: 'breathe air onto the world', search: 'air', radial: 'Worlds',
        later: 'The air will take days to warm the rock: let time run (3 for ×100) and watch the sky turn blue.',
        act: { label: 'Breathe', icon: 'air', run: () => this.cmd({ k: 'planet.add-air', planet, amount: 1 }) },
      };
      case 'water': return {
        id, whisper: 'Water?', words: 'make it rain everywhere and raise the seas', search: 'sea level', radial: 'Water',
        later: 'Rain on frozen rock lies as snow until the air has warmed it. Hold G and draw a spiral for water where you point.',
        act: { label: 'Rain and seas', icon: 'rain', run: () => this.cmd({ k: 'weather.global', planet, kind: 'storm' }, { k: 'water.sea-level', planet, value: -40 }) },
      };
      case 'green': return {
        id, whisper: 'Soil, and a seed.', words: 'plant grass everywhere and a forest here', search: 'plant', radial: 'Life',
        later: 'Green spreads only where water and warmth allow. Hold G and draw a wave for a forest.',
        act: {
          label: 'Sow', icon: 'seed', run: () => this.cmd(
            { k: 'weather.global', planet, kind: 'none' },
            { k: 'life.plant', planet, species: 'meadow-grass', pos: here(), radius: 12000, density: 0.8 },
            { k: 'life.plant', planet, species: 'berry-bush', pos: here(), radius: 1800, density: 0.5 },
            { k: 'life.forest', planet, pos: here(), radius: 1400 }),
        },
      };
      case 'people': return {
        id, whisper: 'Someone to see it?', words: 'set thirty plains folk down here', search: 'people', radial: 'Peoples',
        later: 'They need water and food in reach: set them where it is green. They will walk to the best place they see.',
        act: { label: 'Set a people down', icon: 'people', run: () => this.spawnPeople(planet) },
      };
      case 'night': return {
        id, whisper: 'Night. They have no fire: they huddle cold in the dark.', words: 'teach them fire', search: 'teach', radial: 'Ideas',
        later: 'A lightning strike, a gift, or time: they may find fire themselves.',
        act: { label: 'Give them fire', icon: 'fire', run: () => this.cmd({ k: 'idea.teach', planet, knowledge: 'fire-keeping', settlement: sid }, { k: 'idea.teach', planet, knowledge: 'fire-making', settlement: sid }) },
      };
      case 'fire': return {
        id, whisper: 'They keep a fire. At night the hearths glow.', words: 'what do they know', search: 'teach', radial: 'Ideas',
        later: 'Leave them at ×100 and come back: they will have worked out something nobody gave them.',
      };
    }
  }

  private spawnPeople(planet: number): void {
    const poi = this.host.poi?.('homestead');
    const pos = poi?.pos ?? this.host.focusGround()?.dir;
    void this.host.cmd({ k: 'life.spawn-people', planet, species: 'plains-folk', count: 30, ...(pos ? { pos } : {}) }).then((r) => {
      const made = r.created?.find((e) => e.kind === 'settlement');
      if (made) this.host.lookAtEntity({ ...made, planet });
    });
  }

  private render(): void {
    const s = this.step;
    if (!s) { this.card.hidden = true; return; }
    clear(this.card);
    const kb = this.host.keybinds;
    const way = (k: string, what: string, run: () => void) => {
      const b = h('button', { class: 'gn-whisper-way' }, h('kbd', { text: k }), h('span', { text: what }));
      b.addEventListener('click', run);
      return b;
    };
    this.card.append(h('div', { class: 'gn-whisper-t', text: s.whisper }));
    const row = h('div', { class: 'gn-whisper-acts' });
    if (s.act) {
      const a = s.act;
      const b = h('button', { class: 'gn-btn gn-btn-gold gn-whisper-go' }, h('span', { html: icon(a.icon) }), a.label);
      b.addEventListener('click', () => { a.run(); b.disabled = true; });
      row.append(b);
    }
    row.append(
      way(kb.hint('ui.palette') || '/', `search “${s.search}”`, () => this.deps.openPalette(s.search)),
      way(`hold ${kb.hint('ui.radial') || 'Q'}`, s.radial, () => this.deps.openRadialAt(s.radial)),
      way(kb.hint('ui.freeform') || 'Enter', `“${s.words}”`, () => this.deps.openFreeform(s.words)));
    this.card.append(row);
    if (this.laterShown) this.card.append(h('div', { class: 'gn-whisper-later', text: s.later }));
    const foot = h('div', { class: 'gn-whisper-foot' });
    const skip = h('button', { class: 'gn-whisper-skip', text: 'Not now — let me be' });
    skip.addEventListener('click', () => this.end());
    const other = h('button', { class: 'gn-whisper-skip', text: `Another world (${kb.hint('tool.cancel') || 'Esc'})` });
    other.addEventListener('click', () => this.openPicker());
    foot.append(other, skip);
    this.card.append(foot);
    this.card.hidden = false;
  }

  private openPicker(): void {
    clear(this.picker);
    const head = h('div', { class: 'gn-win-head' }, h('span', { class: 'gn-win-icon', html: icon('world') }),
      h('div', { class: 'gn-win-titles' }, h('div', { class: 'gn-win-title', text: 'Begin' }), h('div', { class: 'gn-win-sub', text: 'which world will you make?' })));
    const body = h('div', { class: 'gn-win-body gn-open-worlds' });
    for (const w of WORLDS) {
      const b = h('button', { class: 'gn-menu-b gn-open-world' }, h('span', { class: 'gn-menu-i', html: icon(w.id === 'barren' ? 'moon' : w.id === 'system' ? 'orbit' : w.id === 'sandbox' ? 'mountain' : 'world') }),
        h('span', { class: 'gn-open-wt' }, h('span', { class: 'gn-menu-l', text: w.name }), h('small', { text: w.desc })));
      b.addEventListener('click', () => { if (w.id === 'barren') this.closePicker(); else this.deps.newWorld(w.id); });
      body.append(b);
    }
    const load = h('button', { class: 'gn-menu-b gn-open-world' }, h('span', { class: 'gn-menu-i', html: icon('save') }),
      h('span', { class: 'gn-open-wt' }, h('span', { class: 'gn-menu-l', text: 'A saved world' }), h('small', { text: 'Return to a kept moment, or import a file.' })));
    load.addEventListener('click', () => { this.end(); this.deps.openSaves(); });
    body.append(load);
    this.picker.append(head, body);
    this.picker.hidden = false;
    this.pickerVeil.hidden = false;
    this.picker.style.zIndex = '60';
    this.pickerVeil.style.zIndex = '59';
    (body.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private closePicker(): void {
    this.picker.hidden = true;
    this.pickerVeil.hidden = true;
  }

  /** test surface */
  state(): { active: boolean; step: string | null; picker: boolean } {
    return { active: this.active, step: this.step?.id ?? null, picker: !this.picker.hidden };
  }
}

function mean(pv: PlanetView, f: Parameters<PlanetView['fields']['get']>[0]): number {
  const a = pv.fields.get(f);
  if (!a || !a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i += 7) s += a[i];
  return s / Math.ceil(a.length / 7);
}

function fraction(pv: PlanetView, f: Parameters<PlanetView['fields']['get']>[0], over: number): number {
  const a = pv.fields.get(f);
  if (!a || !a.length) return 0;
  let n = 0, m = 0;
  for (let i = 0; i < a.length; i += 7) { m++; if (a[i] > over) n++; }
  return n / Math.max(1, m);
}

/** is it night at a point of a world (the sun below its horizon) */
function isNight(pv: PlanetView, u: ArrayLike<number>): boolean {
  const q = pv.quat, s = pv.sunDir;
  // the sun's direction in the body frame (the inverse of the planet's rotation)
  const x = s[0], y = s[1], z = s[2], qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  const bx = ix * qw + iw * -qx + iy * -qz - iz * -qy, by = iy * qw + iw * -qy + iz * -qx - ix * -qz, bz = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return bx * u[0] + by * u[1] + bz * u[2] < -0.04;
}
