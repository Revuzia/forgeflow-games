// GENESIS — the god invents (LIVING.md §4.1, §4.3; hook H12): two small forms instead of a bare tool card, because a
// material or a plant is a few choices that read together, not one value at a click.
//   Invent a material   its name; what it is (a metal, stone, mineral, gem, wood or fibre — or guessed from the name);
//                       its traits (hard, light, warm, glowing, flexible, beautiful, fireproof, sharp); what it is for
//                       (building, tools, weapons, luxury); where its vein lies (where you look, or wherever the rocks
//                       would hold it); which town learns its ways → content.material
//   Invent a plant      its name; tree, shrub, grass or crop; the plant it is like (its climate); what it gives (food —
//                       how much — or fibre); whether it grows where you look now → content.plant
// A line under each form says what will be made, in words. The sim answers in a toast (src/app.ts cmd).
// The vein brush ("Seed a vein": terrain.seed-ore with its ore picker) is a plain power (src/ui/powers.ts CLIENT_POWERS).

import type { Command, CommandResult, UnitVec } from '../sim/types.ts';
import type { WorldView } from '../client/worldview.ts';
import { Panel, segmented } from './panel.ts';
import { h, clear, cap } from './dom.ts';

export interface InventDeps {
  view(): WorldView;
  primary(): number;
  cmd(c: Command): Promise<CommandResult>;
  /** where the camera looks on the ground (the vein, the plant), or null */
  here(): { planet: number; dir: UnitVec } | null;
  /** the settlement the player means: the selected one, else the nearest to where the camera looks */
  town(): { planet: number; id: number } | null;
  /** the plants a new one may be like (content.plant `like`), from the sim's command schema */
  plants(): string[];
}

const KINDS = ['metal', 'stone', 'mineral', 'gem', 'wood', 'fibre'];
const TRAITS = ['hard', 'light', 'warm', 'glowing', 'flexible', 'beautiful', 'fireproof', 'sharp'];
const USES = ['building', 'tools', 'weapons', 'luxury'];
const PLANT_TYPES = ['tree', 'shrub', 'grass', 'crop'];
const FOOD = [
  { v: 0.15, label: 'a little' }, { v: 0.3, label: 'a fair meal' }, { v: 0.8, label: 'rich' }, { v: 1.6, label: 'a feast' },
];

type Mode = 'material' | 'plant';

export class Invent {
  readonly panel: Panel;
  private deps: InventDeps;
  private mode: Mode = 'material';
  private form: HTMLDivElement;
  private says: HTMLDivElement;
  private go: HTMLButtonElement;
  private name!: HTMLInputElement;
  // material
  private kind = '';
  private traits = new Set<string>();
  private uses = new Set<string>();
  private vein: 'here' | 'land' = 'here';
  private teach = '';
  // plant
  private ptype = 'shrub';
  private like = '';
  private gives: 'food' | 'fibre' = 'food';
  private food = 0.3;
  private grow = true;
  /** what the last creation sent (test surface) */
  last: Command | null = null;

  constructor(parent: HTMLElement, deps: InventDeps) {
    this.deps = deps;
    this.panel = new Panel(parent, { name: 'invent', title: 'Invent', subtitle: '', icon: 'invent', place: 'center', veil: true });
    this.form = h('div', { class: 'gn-inv-form' });
    this.says = h('div', { class: 'gn-inv-says', aria: { live: 'polite' } });
    this.go = h('button', { class: 'gn-btn gn-primary gn-inv-go', text: 'Create it' });
    this.go.addEventListener('click', () => void this.create());
    this.panel.body.append(this.form, h('div', { class: 'gn-inv-foot' }, this.says, this.go));
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  close(): void { this.panel.close(); }

  /** open the form for a material or a plant (a name typed elsewhere may come with it) */
  open(mode: Mode, name = ''): void {
    this.mode = mode;
    this.panel.setTitle(mode === 'material' ? 'Invent a material' : 'Invent a plant', mode === 'material' ? 'a new metal, stone, gem or fibre — with veins, crafts and uses' : 'a new plant or crop, and what it gives');
    const t = this.deps.town();
    this.teach = t ? `${t.planet}:${t.id}` : '';
    this.build(name);
    if (this.panel.isOpen) this.panel.raise(); else this.panel.open();
    requestAnimationFrame(() => this.name.focus());
  }

  private build(name: string): void {
    clear(this.form);
    this.name = h('input', { class: 'gn-text gn-inv-name', type: 'text', maxlength: '40', placeholder: this.mode === 'material' ? 'glowstone, sunsteel, starwood…' : 'sunroot, silverleaf, emberberry…', aria: { label: 'Its name' } }) as HTMLInputElement;
    this.name.value = name;
    this.name.addEventListener('input', () => this.sync());
    this.name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') void this.create(); if (e.key === 'Escape') this.close(); });
    this.form.append(this.row('Name', this.name));
    if (this.mode === 'material') {
      this.form.append(
        this.row('It is', segmented([{ value: '', label: 'guess', title: 'Guessed from its name ("mithril" is a metal)' }, ...KINDS.map((k) => ({ value: k, label: k }))], this.kind, (v) => { this.kind = v; this.sync(); })),
        this.row('Traits', this.chips(TRAITS, this.traits)),
        this.row('For', this.chips(USES, this.uses)),
        this.row('Its vein', segmented([{ value: 'here', label: 'where I look' }, { value: 'land', label: 'where the rocks hold it' }], this.vein, (v) => { this.vein = v as 'here' | 'land'; this.sync(); })),
        this.row('Taught to', this.townSelect()));
    } else {
      const like = h('select', { class: 'gn-select', aria: { label: 'The plant it is like' } }) as HTMLSelectElement;
      like.append(h('option', { value: '', text: 'the nearest of its kind' }));
      for (const p of this.deps.plants()) like.append(h('option', { value: p, text: p.replace(/-/g, ' ') }));
      like.value = this.like;
      like.addEventListener('change', () => { this.like = like.value; this.sync(); });
      like.addEventListener('keydown', (e) => e.stopPropagation());
      const food = segmented(FOOD.map((f) => ({ value: String(f.v), label: f.label })), String(this.food), (v) => { this.food = Number(v); this.sync(); });
      const foodRow = this.row('How much', food);
      foodRow.hidden = this.gives !== 'food';
      this.form.append(
        this.row('It is a', segmented(PLANT_TYPES.map((t) => ({ value: t, label: t })), this.ptype, (v) => { this.ptype = v; this.sync(); })),
        this.row('Like', like),
        this.row('It gives', segmented([{ value: 'food', label: 'food' }, { value: 'fibre', label: 'fibre' }], this.gives, (v) => { this.gives = v as 'food' | 'fibre'; foodRow.hidden = v !== 'food'; this.sync(); })),
        foodRow,
        this.row('Grow it', segmented([{ value: 'yes', label: 'where I look, now' }, { value: 'no', label: 'not yet' }], this.grow ? 'yes' : 'no', (v) => { this.grow = v === 'yes'; this.sync(); })));
    }
    this.sync();
  }

  private row(label: string, ctl: HTMLElement): HTMLDivElement {
    return h('div', { class: 'gn-inv-row' }, h('span', { class: 'gn-inv-l', text: label }), h('div', { class: 'gn-inv-c' }, ctl));
  }

  /** a set of words that toggle */
  private chips(words: string[], set: Set<string>): HTMLDivElement {
    const wrap = h('div', { class: 'gn-inv-chips' });
    for (const w of words) {
      const b = h('button', { class: `gn-chip gn-inv-chip${set.has(w) ? ' gn-on' : ''}`, text: w, aria: { pressed: String(set.has(w)) } });
      b.addEventListener('click', () => {
        if (set.has(w)) set.delete(w); else set.add(w);
        b.classList.toggle('gn-on', set.has(w));
        b.setAttribute('aria-pressed', String(set.has(w)));
        this.sync();
      });
      wrap.append(b);
    }
    return wrap;
  }

  private townSelect(): HTMLSelectElement {
    const sel = h('select', { class: 'gn-select', aria: { label: 'Which town learns its ways' } }) as HTMLSelectElement;
    sel.append(h('option', { value: '', text: 'no one yet' }));
    const pv = this.deps.view().planet(this.deps.primary());
    for (const s of (pv?.settlements ?? []).filter((q) => !(q.flags & 2)).sort((a, b) => b.population - a.population)) sel.append(h('option', { value: `${pv!.id}:${s.id}`, text: s.name }));
    sel.value = Array.from(sel.options).some((o) => o.value === this.teach) ? this.teach : '';
    this.teach = sel.value;
    sel.addEventListener('change', () => { this.teach = sel.value; this.sync(); });
    sel.addEventListener('keydown', (e) => e.stopPropagation());
    return sel;
  }

  private townName(key: string): string | null {
    if (!key) return null;
    const [planet, id] = key.split(':').map(Number);
    return this.deps.view().planet(planet)?.settlements.find((s) => s.id === id)?.name ?? null;
  }

  /** the command the form makes now (null while it has no name) */
  command(): Command | null {
    const name = this.name.value.trim();
    if (!name) return null;
    const here = this.deps.here();
    const planet = here?.planet ?? this.deps.primary();
    if (this.mode === 'material') {
      const c: Command = { k: 'content.material', name, planet };
      if (this.kind) c.kind = this.kind;
      if (this.traits.size) c.traits = [...this.traits];
      if (this.uses.size) c.uses = [...this.uses];
      if (this.vein === 'here' && here) c.seed = { pos: [...here.dir], radius: 300 };
      if (this.teach) c.settlement = Number(this.teach.split(':')[1]);
      return c;
    }
    const c: Command = { k: 'content.plant', name, type: this.ptype, planet };
    if (this.like) c.like = this.like;
    c.yields = this.gives === 'fibre' ? { tags: ['fibre'] } : { food: this.food };
    if (this.grow && here) c.pos = [...here.dir];
    else c.plant = false;
    return c;
  }

  /** what will be made, in a line */
  private sync(): void {
    const name = this.name.value.trim();
    this.go.disabled = !name;
    if (!name) { this.says.textContent = this.mode === 'material' ? 'Name it, and the world will know it.' : 'Name it, and it will grow.'; return; }
    const N = cap(name);
    if (this.mode === 'material') {
      const kind = this.kind ? `a new ${this.kind}` : 'a new material';
      const tr = this.traits.size ? ` — ${[...this.traits].join(', ')}` : '';
      const us = this.uses.size ? `, for ${listWords([...this.uses])}` : '';
      const vein = this.vein === 'here' ? (this.deps.here() ? 'A vein where you look' : 'Veins where the rocks hold it') : 'Veins where the rocks hold it';
      const town = this.townName(this.teach);
      this.says.textContent = `${N}: ${kind}${tr}${us}. ${vein}${town ? `; ${town} learns to work it` : ''}.`;
    } else {
      const like = this.like ? ` like ${this.like.replace(/-/g, ' ')}` : '';
      const gives = this.gives === 'fibre' ? 'fibre to spin and weave' : `food (${FOOD.find((f) => f.v === this.food)?.label ?? 'some'})`;
      const where = this.grow && this.deps.here() ? 'It grows where you look' : this.ptype === 'crop' ? 'A crop waits to be sown' : 'It waits to be planted';
      this.says.textContent = `${N}: a ${this.ptype}${like} that gives ${gives}. ${where}.`;
    }
  }

  private async create(): Promise<void> {
    const c = this.command();
    if (!c) { this.name.focus(); return; }
    this.go.disabled = true;
    this.last = c;
    try {
      const r = await this.deps.cmd(c);
      if (r.ok) this.close();
    } finally {
      this.go.disabled = false;
    }
  }

  /** test surface */
  state(): { open: boolean; mode: Mode; says: string; command: Command | null } {
    return { open: this.isOpen, mode: this.mode, says: this.says.textContent ?? '', command: this.isOpen ? this.command() : null };
  }

  /** test surface: fill the form as a player would */
  fill(o: { name?: string; kind?: string; traits?: string[]; uses?: string[]; type?: string; like?: string; gives?: 'food' | 'fibre' }): void {
    if (o.name !== undefined) this.name.value = o.name;
    if (o.kind !== undefined) this.kind = o.kind;
    if (o.traits) this.traits = new Set(o.traits);
    if (o.uses) this.uses = new Set(o.uses);
    if (o.type) this.ptype = o.type;
    if (o.like !== undefined) this.like = o.like;
    if (o.gives) this.gives = o.gives;
    this.build(this.name.value);
  }
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
