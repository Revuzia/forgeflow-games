// GENESIS — the tool system (CONTRACT.md §16.1 "the current tool + brush size/strength", §11 every power, anywhere,
// live): a power from the palette, the radial, a gesture or a hotkey is ARMED; the tool card at the bottom centre
// shows it with its brush, its strength and (behind "More") every other parameter its schema exposes (generated from
// powers.json), and the pointer uses it on the world:
//   brush       click / drag on the ground: repeated dabs (sculpt, pour, plant, paint a biome, set fire)
//   front       drag across the land: a weather front, systems painted along the stroke
//   once        click: cast once there (a miracle, a meteor, a people set down)
//   aim         press where, drag toward where it goes (a tsunami's run, a tornado's heading)
//   line        press at one end, release at the other (a mountain range, a river, a road)
//   settlement  click a settlement (twice for pairs: war, peace, merge, treaties)
//   agent       click a person
//   entity      click a disaster / creature / ship / anything for the hand (or use the selection)
//   move        a thing (the selection, the inspector's own thing, or a first click) and where it goes
//   world       acts on the world: click it, or Cast
//   instant     no place: Cast
// The brush ring is drawn on the terrain (renderer brush preview); lines and aims are drawn over the screen. A brush
// stroke is ONE toast when the button comes up ("Raise the land near Aru: 2 km²"), not one per dab; brush size and
// strength changes flash on the card instead of toasting. Y casts the armed power at the cursor; T casts the armed one
// too, or — with nothing armed — the last power again, once, without arming it. A one-shot cast (Shift+Enter in the
// palette, T, a gesture) never replaces what is armed. A cast that killed or ruined many offers "Undo" on its toast.

import type { Command, CommandResult, EntityRef } from '../sim/types.ts';
import type { GroundHit, UiHost } from './host.ts';
import type { ParamSpec, Power, ToolMode } from './powers.ts';
import { toolMode, radiusParam, strengthParam, cardParams, defaultValue, missingRequired, paramLabel, fmtParam, buildCommand, entityKey, isSelector, type Place } from './powers.ts';
import { h, clear, fmtDist, clamp, store } from './dom.ts';
import { icon } from './icons.ts';
import { slider, toggle } from './panel.ts';
import { humanize, placeWords, areaText } from './words.ts';

export interface BrushPreview { planet: number; dir: [number, number, number]; radius: number; color: [number, number, number] }

export interface ToolDeps {
  host: UiHost;
  /** the renderer's brush ring on the terrain (null hides it) */
  setBrush(b: BrushPreview | null): void;
}

const CAT_COLOR: Record<string, [number, number, number]> = {
  Water: [0.45, 0.85, 1.4], Sky: [0.75, 0.9, 1.3], Fire: [1.5, 0.6, 0.2], Disasters: [1.5, 0.35, 0.25], Life: [0.55, 1.3, 0.45],
  Peoples: [1.3, 1.05, 0.6], Ideas: [1.05, 0.95, 1.5], Hand: [1.3, 1.1, 0.8], Creature: [1.1, 1.3, 0.6], Worlds: [0.9, 0.9, 1.4],
};

/** brush sizes (m): a log scale from a garden to a continent */
const R_MIN = 5, R_MAX = 20000;
const CARD_KEY = 'genesis.toolcard.v1';

interface Press { x: number; y: number; t: number; hit: GroundHit | null; moved: boolean; lastDab: GroundHit | null; lastDabT: number; startedLine: boolean }

/** what one held stroke of a brush did, gathered into one toast */
interface Stroke {
  power: Power;
  dabs: number;
  cells: number;
  ok: CommandResult | null;
  fail: string | null;
  pending: Promise<void>[];
  dead: number;
  firstTick: number;
  planet: number;
}

export class Tools {
  readonly card: HTMLDivElement;
  readonly overlay: SVGSVGElement;
  private deps: ToolDeps;
  private host: UiHost;
  armed: Power | null = null;
  mode: ToolMode = 'instant';
  /** current parameter values of the armed power (kept per power while the session lasts) */
  values: Record<string, unknown> = {};
  private memory = new Map<string, Record<string, unknown>>();
  brushRadius = 250;
  private press: Press | null = null;
  private stroke: Stroke | null = null;
  /** two-step tools: the first pick (a settlement, a thing, a line's start) */
  private first: { ref?: EntityRef; hit?: GroundHit; label: string } | null = null;
  private last: { power: Power; values: Record<string, unknown> } | null = null;
  /** things given with the arming (the inspector's own creature for "Leash"): sent with every cast of the armed power */
  private presetRefs: Record<string, number> = {};
  private cardBody: HTMLDivElement;
  private cardHead: HTMLDivElement;
  private instr: HTMLDivElement;
  private castBtn: HTMLButtonElement;
  private moreBtn: HTMLButtonElement;
  private line: SVGLineElement;
  private head: SVGPathElement;
  private dot: SVGCircleElement;
  /** the card's own layout: extra settings shown, or the whole card folded to its title line */
  private view = store.get<{ more: boolean; min: boolean }>(CARD_KEY, { more: false, min: false });
  /** told when a tool is armed / disarmed (HUD dock) */
  onChange: (() => void) | null = null;

  constructor(parent: HTMLElement, overlayLayer: HTMLElement, deps: ToolDeps) {
    this.deps = deps;
    this.host = deps.host;
    this.cardHead = h('div', { class: 'gn-tool-head' });
    this.instr = h('div', { class: 'gn-tool-instr' });
    this.cardBody = h('div', { class: 'gn-tool-body' });
    this.castBtn = h('button', { class: 'gn-btn gn-tool-cast', text: 'Cast' });
    this.castBtn.addEventListener('click', () => void this.castButton());
    this.moreBtn = h('button', { class: 'gn-btn gn-tool-more' });
    this.moreBtn.addEventListener('click', () => { this.view.more = !this.view.more; store.set(CARD_KEY, this.view); this.renderCard(); });
    this.card = h('div', { class: 'gn-panel gn-tool', role: 'region', aria: { label: 'Current power' } }, this.cardHead, this.instr, this.cardBody,
      h('div', { class: 'gn-tool-foot' }, this.moreBtn, this.castBtn));
    this.card.hidden = true;
    this.card.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    parent.appendChild(this.card);
    const ns = 'http://www.w3.org/2000/svg';
    this.overlay = document.createElementNS(ns, 'svg') as SVGSVGElement;
    this.overlay.setAttribute('class', 'gn-tool-svg');
    this.line = document.createElementNS(ns, 'line') as SVGLineElement;
    this.head = document.createElementNS(ns, 'path') as SVGPathElement;
    this.dot = document.createElementNS(ns, 'circle') as SVGCircleElement;
    this.dot.setAttribute('r', '5');
    this.overlay.append(this.line, this.head, this.dot);
    this.overlay.style.display = 'none';
    overlayLayer.appendChild(this.overlay);
  }

  get isArmed(): boolean { return !!this.armed; }

  /**
   * Arm a power. Preset values override the remembered ones; a preset entity (the inspector's "Move" on a live
   * disaster arms with its id) is the tool's first pick, so one click sets where it goes.
   */
  arm(p: Power, preset: Record<string, unknown> = {}): void {
    if (this.armed) this.memory.set(this.armed.id, { ...this.values, __radius: this.brushRadius });
    const remembered = this.memory.get(p.id) ?? {};
    const values = this.valuesFor(p, preset);
    this.armed = p;
    this.mode = toolMode(p);
    this.values = values;
    const r = p.schema.radius;
    if (r && typeof remembered.__radius === 'number') this.brushRadius = remembered.__radius;
    else if (r) this.brushRadius = clamp(Number(r.default ?? this.brushRadius), r.min ?? R_MIN, r.max ?? R_MAX);
    this.first = null;
    this.press = null;
    this.presetRefs = {};
    for (const [k, v] of Object.entries(preset)) {
      const s = p.schema[k];
      if (s?.type === 'entity' && typeof v === 'number') {
        const ref: EntityRef = { kind: (s.entity?.[0] ?? 'agent') as EntityRef['kind'], id: v, planet: this.host.primary() };
        // a thing to move is the move's first pick (one click then says where); any other is sent with each cast
        if (this.mode === 'move') this.first = { ref, label: this.refName(ref) };
        else this.presetRefs[k] = v;
        delete this.values[k];
      }
    }
    this.renderCard();
    this.card.hidden = false;
    this.onChange?.();
  }

  /** the values a power would be cast with: what was used last, its own fixed params, what the world suggests, defaults */
  valuesFor(p: Power, preset: Record<string, unknown> = {}): Record<string, unknown> {
    const remembered = this.armed?.id === p.id ? this.values : this.memory.get(p.id) ?? {};
    const v: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(p.schema)) {
      if (s.type === 'pos' || s.type === 'entity' || s.type === 'vec3') continue;
      const d = remembered[k] ?? (p.params[k] !== undefined ? p.params[k] : this.prefill(p, k, s) ?? (isSelector(p, k) ? undefined : defaultValue(k, s)));
      if (d !== undefined) v[k] = d;
    }
    return { ...v, ...preset };
  }

  /** the brush radius a power would use now (its remembered one, the armed one, or its default) */
  private radiusFor(p: Power): number {
    if (this.armed?.id === p.id) return this.brushRadius;
    const m = this.memory.get(p.id)?.__radius;
    const r = p.schema.radius;
    if (typeof m === 'number') return m;
    return r ? clamp(Number(r.default ?? 250), r.min ?? R_MIN, r.max ?? R_MAX) : this.brushRadius;
  }

  /** cast a power once without arming it (a gesture): at a point, with a radius in metres (null: its default) */
  async castWith(p: Power, hit: GroundHit | null, radius: number | null): Promise<CommandResult> {
    const values = this.valuesFor(p);
    const r = p.schema.radius;
    const R = r ? clamp(radius ?? this.radiusFor(p), Math.max(R_MIN, r.min ?? R_MIN), Math.min(R_MAX, r.max ?? R_MAX)) : null;
    const c = buildCommand(p, values, { hit, planet: hit?.planet }, R, this.host.primary());
    return this.run(c, p, values);
  }

  disarm(): void {
    if (this.armed) this.host.sound('ui.disarm');
    if (this.armed) this.memory.set(this.armed.id, { ...this.values, __radius: this.brushRadius });
    if (this.stroke) void this.endStroke();
    this.armed = null;
    this.first = null;
    this.press = null;
    this.card.hidden = true;
    this.overlay.style.display = 'none';
    this.deps.setBrush(null);
    this.onChange?.();
  }

  /** a two-step tool waiting for its second pick: Esc steps back to the first */
  cancelStep(): boolean {
    if (this.first) { this.first = null; this.renderInstr(); this.overlay.style.display = 'none'; return true; }
    return false;
  }

  /** values the world itself suggests: the day's length for "length of the day", the world for world verbs */
  private prefill(p: Power, k: string, s: ParamSpec): unknown {
    const pv = this.host.view.planet(this.host.primary());
    if (!pv) return undefined;
    const pp = pv.params;
    if (p.command === 'time.day-length' && k === 'hours') return Math.round(pp.dayHours * 10) / 10;
    if (p.command === 'time.year-length' && k === 'days') return Math.round(pp.yearDays * 10) / 10;
    if (p.command === 'time.axial-tilt' && k === 'degrees') return Math.round((pp.axialTilt * 180) / Math.PI);
    if (p.command === 'time.set-hour' && k === 'hour') return Math.round(pp.dayHours / 2);
    if (p.command === 'planet.set' && k === 'gravity') return Math.round(pp.gravity * 10) / 10;
    if (p.command === 'planet.set' && k === 'magnetism') return Math.round(pp.magnetism * 100) / 100;
    if (p.command === 'planet.set' && k === 'temperatureOffset') return 5;
    if (p.command === 'time.speed' && k === 'speed') return 10;
    if (p.command === 'time.step' && k === 'hours') return 1;
    if (p.command === 'time.rewind' && k === 'hoursAgo') return 1;
    if (p.command === 'star.set' && k === 'luminosity') return Math.round(this.host.view.star.luminosity * 100) / 100;
    if (p.command === 'set' && k === 'value' && typeof p.params.path === 'string') return undefined;
    if (s.type === 'string' && (k === 'name' || k === 'to')) return '';
    return undefined;
  }

  // ───────────────────────────── the card ─────────────────────────────

  /** the keys of an action as people read them (rebinding shows at once) */
  private key(id: string): string { return this.host.keybinds.hint(id); }

  /** rebuild the card's key labels after a rebinding */
  refreshKeys(): void { if (this.armed) this.renderCard(); }

  private renderCard(flashKey?: string): void {
    const p = this.armed;
    if (!p) return;
    clear(this.cardHead);
    const close = h('button', { class: 'gn-btn gn-tool-x', title: `Put the power away (${this.key('tool.cancel') || 'Esc'} / right click)`, html: icon('close') });
    close.addEventListener('click', () => this.disarm());
    const fold = h('button', { class: `gn-btn gn-tool-fold${this.view.min ? ' gn-on' : ''}`, title: this.view.min ? 'Show the settings' : 'Fold the card to its title', aria: { label: this.view.min ? 'Unfold' : 'Fold', expanded: String(!this.view.min) },
      html: `<svg viewBox="0 0 12 12"><path d="${this.view.min ? 'M3 7.5l3-3 3 3' : 'M3 4.5l3 3 3-3'}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>` });
    fold.addEventListener('click', () => { this.view.min = !this.view.min; store.set(CARD_KEY, this.view); this.renderCard(); });
    this.cardHead.append(
      h('span', { class: 'gn-tool-ico', html: icon(p.icon, p.category) }),
      h('div', { class: 'gn-tool-titles' }, h('div', { class: 'gn-tool-name', text: p.name }), h('div', { class: 'gn-tool-cat', text: `${p.category}${p.gesture ? ` · gesture: ${p.gesture}` : ''}` })),
      fold, close);
    this.card.classList.toggle('gn-tool-min', this.view.min);
    clear(this.cardBody);
    const rk = radiusParam(p);
    const sk = strengthParam(p);
    let extra = 0;
    if (rk) {
      const r = p.schema.radius;
      const lo = Math.max(R_MIN, r.min ?? R_MIN), hi = Math.min(R_MAX, r.max ?? R_MAX);
      const keys = [this.key('tool.smaller'), this.key('tool.bigger')].filter(Boolean).join(' ');
      this.cardBody.append(this.row('radius', 'Brush', slider({ min: lo, max: hi, step: 1, value: clamp(this.brushRadius, lo, hi), log: true, fmt: (v) => fmtDist(v), on: (v) => { this.brushRadius = v; } }), keys, 'Brush size (also Ctrl + wheel)'));
    }
    const miss = new Set(missingRequired(p, this.values));
    for (const [k, s] of cardParams(p)) {
      if (p.params[k] !== undefined && (k === 'kind' || k === 'material' || k === 'path')) continue; // fixed by the power itself
      // the brush and its strength are always on the card; the rest behind "More", unless it must be given
      const main = k === sk || miss.has(k);
      if (!main) { extra++; if (!this.view.more) continue; }
      const ctl = this.control(k, s);
      if (!ctl) continue;
      const keys = k === sk ? [this.key('tool.weaker'), this.key('tool.stronger')].filter(Boolean).join(' ') : '';
      this.cardBody.append(this.row(k, cap(paramLabel(k)), ctl, keys, s.desc ?? (k === sk ? 'Strength (also Alt + wheel)' : '')));
    }
    if (this.host.view.restraint && p.cost) this.cardBody.append(h('div', { class: 'gn-tool-cost', text: `Restraint: costs ${p.cost} worship${p.cooldown ? `, then rests ${Math.round(p.cooldown / 60)} h` : ''}.` }));
    this.moreBtn.hidden = !extra;
    this.moreBtn.textContent = this.view.more ? 'Fewer settings' : `More settings (${extra})`;
    this.renderInstr();
    if (flashKey) {
      const row = this.cardBody.querySelector<HTMLElement>(`[data-key="${CSS.escape(flashKey)}"]`);
      if (row) { row.classList.remove('gn-flash-v'); void row.offsetWidth; row.classList.add('gn-flash-v'); }
    }
  }

  private row(key: string, label: string, ctl: HTMLElement, keys = '', title = ''): HTMLDivElement {
    return h('div', { class: 'gn-tool-row', title, data: { key } }, h('span', { class: 'gn-tool-l' }, label, keys ? h('kbd', { text: keys }) : null), h('div', { class: 'gn-tool-c' }, ctl));
  }

  private control(k: string, s: ParamSpec): HTMLElement | null {
    const v = this.values[k];
    const set = (x: unknown) => { this.values[k] = x; };
    if (s.type === 'number' || s.type === 'int') {
      if (s.min !== undefined && s.max !== undefined) {
        const wide = s.min >= 0 && s.max / Math.max(s.min, 1e-3) > 200 && s.min > 0;
        const step = s.type === 'int' ? 1 : (s.max - s.min) / 400;
        const sl = slider({ min: s.min, max: s.max, step, value: Number(v ?? s.min), log: wide, fmt: (x) => fmtParam(k, x, s, this.dayHours()), on: (x) => set(s.type === 'int' ? Math.round(x) : x) });
        sl.dataset.key = k;
        return sl;
      }
      const inp = h('input', { class: 'gn-num', type: 'number', value: String(v ?? 0) }) as HTMLInputElement;
      inp.addEventListener('input', () => set(Number(inp.value)));
      return inp;
    }
    if (s.type === 'boolean') return toggle(!!v, (x) => set(x), k);
    if (s.type === 'enum') {
      const vals = Array.isArray(s.values) ? s.values : [];
      if (vals.length > 18) {
        // a long list (recipes, items): a field with suggestions
        const id = `gn-dl-${k}-${Math.random().toString(36).slice(2, 7)}`;
        const dl = h('datalist', { id });
        for (const x of vals) dl.append(h('option', { value: x }));
        const inp = h('input', { class: 'gn-text', type: 'text', list: id, value: String(v ?? ''), placeholder: s.required ? `${vals.length} choices…` : `any (${vals.length} choices)`, spellcheck: 'false' }) as HTMLInputElement;
        inp.addEventListener('input', () => set(inp.value.trim() || undefined));
        inp.addEventListener('keydown', (e) => e.stopPropagation());
        return h('div', {}, inp, dl);
      }
      const sel = h('select', { class: 'gn-select' }) as HTMLSelectElement;
      if (!s.required && s.default === undefined) sel.append(h('option', { value: '', text: 'any' }));
      for (const x of vals) sel.append(h('option', { value: x, text: x.replace(/-/g, ' ') }));
      sel.value = String(v ?? '');
      sel.addEventListener('change', () => set(sel.value || undefined));
      return sel;
    }
    if (s.type === 'string' || s.type === 'any') {
      const inp = h('input', { class: 'gn-text', type: 'text', value: v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v), placeholder: s.desc ?? paramLabel(k), spellcheck: 'false' }) as HTMLInputElement;
      inp.addEventListener('input', () => {
        const t = inp.value.trim();
        if (s.type === 'any') { const n = Number(t); set(t === '' ? undefined : Number.isFinite(n) && t !== '' ? n : t === 'true' ? true : t === 'false' ? false : t); }
        else set(t === '' ? undefined : t);
      });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      return inp;
    }
    return null;
  }

  private dayHours(): number { return this.host.view.planet(this.host.primary())?.params.dayHours ?? 24; }

  private renderInstr(): void {
    const p = this.armed;
    if (!p) return;
    const sel = this.selectionFor(p);
    let t = '';
    let cast = '';
    switch (this.mode) {
      case 'brush': t = 'Click or drag on the ground to work it.'; break;
      case 'front': t = 'Drag across the land: a front of weather follows your stroke.'; break;
      case 'once': t = 'Click where it should happen.'; break;
      case 'aim': t = 'Press where it begins, drag toward where it goes.'; break;
      case 'line': t = this.first ? 'Now click where it ends.' : 'Drag from one end to the other (or click both ends).'; break;
      case 'settlement':
        t = this.pairKey(p) && this.first ? `${this.first.label} — now click the other settlement.` : 'Click a settlement.';
        if (sel && !this.pairKey(p)) cast = `Cast on ${this.refName(sel)}`;
        break;
      case 'agent': t = 'Click a person.'; if (sel) cast = `Cast on ${this.refName(sel)}`; break;
      case 'entity': {
        const kinds = this.entityKinds(p);
        t = `Click ${kinds.length ? kinds.map((k) => (k === 'agent' ? 'a person' : `a ${k}`)).join(' or ') : 'something'}.`;
        if (sel) cast = `Cast on ${this.refName(sel)}`;
        else if (kinds.includes('creature') && this.host.view.creatures.length) cast = `Cast on ${this.host.view.creatures[0].name}`;
        else if (kinds.includes('planet')) cast = `Cast on ${this.host.view.planet(this.host.primary())?.name ?? 'this world'}`;
        break;
      }
      case 'move': {
        const who = this.first?.ref ?? sel;
        t = who ? `${cap(this.first?.label ?? this.refName(who))}: click where it should go.` : `Click ${this.moveKindLabel(p)}, then where it should go.`;
        break;
      }
      case 'world': t = 'Acts on the whole world.'; cast = `Cast on ${this.host.view.planet(this.host.primary())?.name ?? 'this world'}`; break;
      case 'instant': t = p.desc || 'Ready.'; cast = 'Cast'; break;
    }
    this.instr.textContent = t;
    this.castBtn.hidden = !cast;
    this.castBtn.textContent = cast || 'Cast';
  }

  private refName(r: EntityRef): string {
    const v = this.host.view;
    if (r.kind === 'settlement') for (const pv of v.planets) { const s = pv.settlements.find((q) => q.id === r.id); if (s) return s.name; }
    if (r.kind === 'creature') { const c = v.creatures.find((q) => q.id === r.id); if (c) return c.name; }
    if (r.kind === 'disaster') for (const pv of v.planets) { const d = pv.disasters.find((q) => q.id === r.id); if (d) return `the ${d.kind.replace(/-/g, ' ')}`; }
    if (r.kind === 'planet') return v.planet(r.id)?.name ?? 'the world';
    if (r.kind === 'ship') { const s = v.ships.find((q) => q.id === r.id); if (s) return `the ${s.kind}`; }
    return r.kind === 'agent' ? 'the selected person' : `the ${r.kind}`;
  }

  // ───────────────────────────── what the power takes ─────────────────────────────

  private entityKey(p: Power, kind: string): string | null { return entityKey(p, kind); }

  private entityKinds(p: Power): string[] {
    const out = new Set<string>();
    for (const s of Object.values(p.schema)) if (s.type === 'entity') for (const k of s.entity ?? []) out.add(k);
    return [...out];
  }

  /** the second settlement of a pair power (war, peace, merge, treaty) */
  private pairKey(p: Power): string | null {
    const o = p.schema.other;
    return o && o.type === 'entity' && (o.entity ?? []).includes('settlement') ? 'other' : null;
  }

  private moveKindLabel(p: Power): string {
    const k = this.entityKinds(p)[0];
    return k === 'agent' ? 'a person' : k ? `a ${k}` : 'a thing';
  }

  /** the selection, if it is of a kind this power takes */
  private selectionFor(p: Power): EntityRef | null {
    const s = this.host.selected();
    if (!s || s.kind === 'species') return null;
    const kinds = this.entityKinds(p);
    return kinds.includes(s.kind) ? (s as EntityRef) : null;
  }

  // ───────────────────────────── casting ─────────────────────────────

  /** build the command for the armed power with the values and the places / things picked */
  build(p: Power, place: Place, values = this.values): Command {
    const armed = this.armed?.id === p.id;
    const pl = armed && Object.keys(this.presetRefs).length ? { ...place, refs: { ...this.presetRefs, ...(place.refs ?? {}) } } : place;
    return buildCommand(p, values, pl, armed ? this.brushRadius : this.radiusFor(p), this.host.primary());
  }

  async run(c: Command, p: Power, values = this.values, quiet = false): Promise<CommandResult> {
    const miss = missingRequired(p, values).filter((k) => c[k] === undefined);
    if (miss.length) {
      const r = { ok: false, msg: `${p.name} needs ${miss.map(paramLabel).join(', ')} — set ${miss.length > 1 ? 'them' : 'it'} on the card.` };
      this.host.toast({ text: r.msg, kind: 'warn' });
      return r;
    }
    this.last = { power: p, values: { ...values, __radius: typeof c.radius === 'number' ? c.radius : this.brushRadius } };
    const r = await this.host.cmd(c, { quiet });
    // a disaster / creature / ship it made can be inspected at once
    const m = toolMode(p);
    const made = r.ok ? r.created?.find((e) => e.kind === 'disaster' || e.kind === 'creature' || e.kind === 'ship') : undefined;
    if (made && (m === 'once' || m === 'aim' || m === 'instant')) this.host.select({ ...made, planet: made.planet ?? c.planet as number });
    return r;
  }

  /** Cast button / Enter on the card: on the selection, the world, or with no place */
  async castButton(): Promise<void> {
    const p = this.armed;
    if (!p) return;
    const refs: Record<string, EntityRef | number> = {};
    const sel = this.first?.ref ?? this.selectionFor(p);
    if (sel) {
      const k = this.entityKey(p, sel.kind);
      if (k) refs[k] = p.schema[k]?.entity?.length === 1 ? sel.id : (k === 'target' ? sel : sel.id);
    }
    if (this.mode === 'once' || this.mode === 'brush' || this.mode === 'aim' || this.mode === 'front') {
      const at = this.host.cursorGround() ?? this.host.focusGround();
      if (at) await this.run(this.build(p, { hit: at, refs }), p);
      return;
    }
    await this.run(this.build(p, { refs, planet: sel?.planet ?? this.host.primary() }), p);
  }

  /** cast the armed power (or a given one) right now at the cursor — Y, the gamepad's A, the test surface */
  async castHere(p: Power | null = this.armed, values?: Record<string, unknown>): Promise<CommandResult | null> {
    if (!p) return null;
    if (p !== this.armed) this.arm(p, values ?? {});
    const at = this.host.cursorGround() ?? this.host.focusGround();
    return this.castAt(p, at, this.values, this.mode);
  }

  /**
   * Cast a power ONCE at a place without arming it (Shift+Enter in the palette, T): what is armed stays armed. A
   * power that needs two picks (war between two towns, moving a thing with nothing chosen) is armed instead.
   */
  async castOnce(p: Power, at: GroundHit | null, values?: Record<string, unknown>): Promise<CommandResult | null> {
    const m = toolMode(p);
    const vals = values ? { ...this.valuesFor(p), ...values } : this.valuesFor(p);
    if ((m === 'settlement' && this.pairKey(p)) || (m === 'move' && !this.selectionFor(p)) || m === 'line') {
      this.arm(p, values ?? {});
      this.host.toast({ text: `${p.name} needs ${m === 'line' ? 'two ends' : 'two picks'}: it is ready on the card.`, kind: 'info', ms: 3200 });
      return null;
    }
    if (m !== 'instant' && m !== 'world' && !at) { this.host.toast({ text: 'Point at the ground first: there is no place to cast it.', kind: 'warn' }); return null; }
    return this.castAt(p, at, vals, m);
  }

  /** the shared body of castHere / castOnce */
  private async castAt(p: Power, at: GroundHit | null, values: Record<string, unknown>, m: ToolMode): Promise<CommandResult | null> {
    if (m === 'instant' || m === 'world') return this.run(this.build(p, { planet: at?.planet ?? this.host.primary() }, values), p, values);
    if (!at) return null;
    if (m === 'settlement' || m === 'agent' || m === 'entity' || m === 'move') {
      const s = this.host.screenOf(at.planet, at.dir);
      return this.clickPick(p, at, s ? this.host.entityAt(s[0], s[1]) : null, m, values);
    }
    return this.run(this.build(p, { hit: at }, values), p, values);
  }

  /** T: with a power armed, cast it at the cursor; with none, the last power again, once, without arming it */
  async repeat(): Promise<void> {
    if (this.armed) { await this.castHere(); return; }
    const l = this.last;
    if (!l) { this.host.toast({ text: 'Nothing cast yet to repeat.', kind: 'info' }); return; }
    const at = this.host.cursorGround() ?? this.host.focusGround();
    const { __radius, ...values } = l.values;
    if (typeof __radius === 'number') this.memory.set(l.power.id, { ...(this.memory.get(l.power.id) ?? {}), __radius });
    await this.castOnce(l.power, at, values);
  }

  /** what T would do now, in words (the dock / help) */
  repeatHint(): string {
    if (this.armed) return `${this.armed.name} at the cursor`;
    return this.last ? `${this.last.power.name} again, at the cursor` : 'nothing yet';
  }

  /** a click that picks a thing for settlement / agent / entity / move tools */
  private async clickPick(p: Power, hit: GroundHit | null, ent: EntityRef | null, mode: ToolMode = this.mode, values = this.values): Promise<CommandResult | null> {
    const refs: Record<string, EntityRef | number> = {};
    const armedHere = this.armed === p;
    if (mode === 'settlement') {
      const sid = ent?.kind === 'settlement' ? ent.id : hit ? this.host.settlementAt(hit.planet, hit.dir) : null;
      const key = this.entityKey(p, 'settlement') ?? 'settlement';
      const pair = this.pairKey(p);
      if (sid === null) {
        // a settlement power may also take a place (leash to a point, found)
        if (hit && p.schema.pos && !pair) return this.run(this.build(p, { hit }, values), p, values);
        this.host.toast({ text: 'There is no settlement there.', kind: 'info' });
        return null;
      }
      if (pair && armedHere) {
        if (!this.first?.ref) { this.first = { ref: { kind: 'settlement', id: sid, planet: hit?.planet }, label: this.refName({ kind: 'settlement', id: sid, planet: hit?.planet }) }; this.renderInstr(); return null; }
        if (this.first.ref.id === sid) { this.host.toast({ text: 'Pick a different settlement.', kind: 'info' }); return null; }
        refs[key] = this.first.ref.id;
        refs[pair] = sid;
        this.first = null;
        this.renderInstr();
        return this.run(this.build(p, { refs, planet: hit?.planet }, values), p, values);
      }
      refs[key] = sid;
      return this.run(this.build(p, { refs, planet: hit?.planet }, values), p, values);
    }
    if (mode === 'agent') {
      if (!ent || ent.kind !== 'agent') { this.host.toast({ text: 'Click a person (zoom in to see them).', kind: 'info' }); return null; }
      const key = this.entityKey(p, 'agent') ?? 'id';
      refs[key] = ent.id;
      return this.run(this.build(p, { refs, planet: ent.planet ?? hit?.planet, hit: p.schema.pos && hit ? hit : null }, values), p, values);
    }
    if (mode === 'entity') {
      const kinds = this.entityKinds(p);
      const target = p.schema.target;
      if (ent && target) refs.target = target.cmdType === 'any' || target.cmdType === undefined ? { kind: ent.kind, id: ent.id } : ent.id;
      else if (ent && kinds.includes(ent.kind)) refs[this.entityKey(p, ent.kind)!] = ent.id;
      else if (!ent && kinds.includes('planet') && hit) refs[this.entityKey(p, 'planet')!] = hit.planet;
      else if (!ent && !p.schema.pos) { this.host.toast({ text: `Click ${kinds.map((k) => (k === 'agent' ? 'a person' : `a ${k}`)).join(' or ')}.`, kind: 'info' }); return null; }
      return this.run(this.build(p, { refs, hit: p.schema.pos ? hit : null, planet: ent?.planet ?? hit?.planet }, values), p, values);
    }
    if (mode === 'move') {
      const kinds = this.entityKinds(p);
      const who = (armedHere ? this.first?.ref : null) ?? this.selectionFor(p) ?? (kinds.includes('creature') && this.host.view.creatures[0] ? { kind: 'creature' as const, id: this.host.view.creatures[0].id, planet: this.host.view.creatures[0].planet } : null);
      if (!who) {
        if (ent && kinds.includes(ent.kind)) { this.first = { ref: ent, label: this.refName(ent) }; this.renderInstr(); return null; }
        if (hit && kinds.includes('settlement')) { const sid = this.host.settlementAt(hit.planet, hit.dir); if (sid !== null) { const r: EntityRef = { kind: 'settlement', id: sid, planet: hit.planet }; this.first = { ref: r, label: this.refName(r) }; this.renderInstr(); return null; } }
        // a disaster under the click (they are picked by their drawn position)
        this.host.toast({ text: `First click ${this.moveKindLabel(p)}.`, kind: 'info' });
        return null;
      }
      const key = this.entityKey(p, who.kind) ?? 'id';
      refs[key] = who.id;
      if (p.command === 'possess.act' && ent && ent.kind !== 'agent' && p.schema.target) refs.target = ent.id;
      if (armedHere) { this.first = null; this.renderInstr(); }
      return this.run(this.build(p, { refs, to: hit, planet: hit?.planet }, values), p, values);
    }
    if (mode === 'world') return this.run(this.build(p, { planet: hit?.planet }, values), p, values);
    return null;
  }

  // ───────────────────────────── the pointer ─────────────────────────────

  /** does this tool take the left drag (else the camera does) */
  wantsDrag(): boolean {
    return this.mode === 'brush' || this.mode === 'front' || this.mode === 'aim' || this.mode === 'line';
  }

  down(x: number, y: number): boolean {
    if (!this.armed) return false;
    const hit = this.host.groundAt(x, y);
    this.press = { x, y, t: performance.now(), hit, moved: false, lastDab: null, lastDabT: 0, startedLine: false };
    if ((this.mode === 'brush' || this.mode === 'front') && hit) { this.beginStroke(); this.dab(hit); }
    if (this.mode === 'line' && hit && !this.first) { this.first = { hit, label: 'start' }; this.press.startedLine = true; }
    return true;
  }

  move(x: number, y: number): void {
    const pr = this.press;
    if (!pr || !this.armed) return;
    if (Math.hypot(x - pr.x, y - pr.y) > 6) pr.moved = true;
    if ((this.mode === 'brush' || this.mode === 'front') && pr.moved) {
      const hit = this.host.groundAt(x, y);
      if (!hit || !pr.lastDab) { if (hit) { this.beginStroke(); this.dab(hit); } return; }
      const pv = this.host.view.planet(hit.planet);
      const R = pv?.params.radius ?? 3000;
      const d = Math.acos(clamp(hit.dir[0] * pr.lastDab.dir[0] + hit.dir[1] * pr.lastDab.dir[1] + hit.dir[2] * pr.lastDab.dir[2], -1, 1)) * R;
      const spacing = this.mode === 'front' ? this.brushRadius * 1.1 : Math.max(4, this.brushRadius * 0.45);
      if (d >= spacing && performance.now() - pr.lastDabT > (this.mode === 'front' ? 60 : 70)) this.dab(hit);
    }
  }

  /** held still with a sculpting brush: keep working (raise / lower / pour build up while held) */
  hold(x: number, y: number): void {
    const pr = this.press;
    const p = this.armed;
    if (!pr || !p || this.mode !== 'brush') return;
    if (!/^(terrain\.(raise|lower|smooth|flatten)|water\.(add|remove))$/.test(p.command)) return;
    if (performance.now() - pr.lastDabT < 260) return;
    const hit = this.host.groundAt(x, y);
    if (hit) this.dab(hit);
  }

  up(x: number, y: number): void {
    const pr = this.press;
    const p = this.armed;
    this.press = null;
    if (!pr || !p) return;
    const hit = this.host.groundAt(x, y);
    switch (this.mode) {
      case 'brush': case 'front': void this.endStroke(); return; // dabbed already: one toast for the stroke
      case 'once':
        if (!pr.moved && hit) void this.run(this.build(p, { hit }), p);
        return;
      case 'aim':
        if (pr.hit) void this.run(this.build(p, { hit: pr.hit, toward: pr.moved && hit ? hit : null }), p);
        return;
      case 'line': {
        const a = this.first?.hit;
        // a drag from one end to the other, or a second click after a first that set the start
        if (a && hit && (pr.moved || !pr.startedLine)) {
          this.first = null;
          this.renderInstr();
          void this.run(this.build(p, { hit: a, to: hit }), p);
        } else this.renderInstr();
        return;
      }
      default:
        if (!pr.moved) void this.clickPick(p, hit, this.host.entityAt(x, y));
    }
  }

  private beginStroke(): void {
    const p = this.armed;
    if (!p || this.stroke) return;
    this.stroke = { power: p, dabs: 0, cells: 0, ok: null, fail: null, pending: [], dead: 0, firstTick: -1, planet: this.host.primary() };
  }

  private dab(hit: GroundHit): void {
    const p = this.armed;
    if (!p || !this.press) return;
    this.press.lastDab = hit;
    this.press.lastDabT = performance.now();
    const st = this.stroke;
    const c = this.build(p, { hit });
    if (!st) { void this.run(c, p); return; }
    st.planet = hit.planet;
    // each dab is quiet: the stroke speaks once when the button comes up
    st.pending.push(this.run(c, p, this.values, true).then((r) => {
      st.dabs++;
      if (r.ok) {
        st.ok ??= r;
        if (st.firstTick < 0 && typeof r.tick === 'number') st.firstTick = r.tick;
        const m = /\((\d[\d,]*) cells?\)/.exec(r.msg ?? '');
        if (m) st.cells += Number(m[1].replace(/,/g, ''));
        const d = /(\d+)\s+(?:killed|dead|died)/.exec(r.msg ?? '');
        if (d) st.dead += Number(d[1]);
      } else st.fail ??= r.msg ?? 'That did not work.';
    }));
  }

  /** the stroke ended: one toast that says what it did */
  private async endStroke(): Promise<void> {
    const st = this.stroke;
    this.stroke = null;
    if (!st) return;
    await Promise.all(st.pending);
    if (!st.ok) {
      if (st.fail) { this.host.toast({ text: st.fail, kind: 'warn' }); this.host.sound('ui.error'); }
      return;
    }
    const pv = this.host.view.planet(st.planet);
    const base = humanize(this.host.view, st.planet, (st.ok.msg ?? st.power.name).replace(/\s*\(\d[\d,]*\s+cells?\)/, '').replace(/[.!]\s*$/, ''), { dayHours: pv?.params.dayHours });
    const parts: string[] = [];
    if (st.cells) parts.push(pv && pv.grid.count > 0 ? areaText((st.cells * 4 * Math.PI * pv.params.radius * pv.params.radius) / pv.grid.count) : `${st.cells.toLocaleString('en')} cells`);
    if (st.dabs > 1 && this.mode === 'front') parts.push(`${st.dabs} systems along the stroke`);
    else if (st.dabs > 1 && !st.cells) parts.push(`${st.dabs} strokes`);
    const text = `${base}${parts.length ? `: ${parts.join(', ')}` : ''}.${st.dead ? ` ${st.dead} died.` : ''}`;
    const r: CommandResult = { ok: true, msg: text, tick: st.firstTick >= 0 ? st.firstTick : st.ok.tick };
    this.host.toast({ text, kind: 'god', ms: 5200, action: this.host.undoAction?.(r, st.power.name, st.power.command) ?? null });
    this.host.sound('ui.confirm');
  }

  // ───────────────────────────── per frame ─────────────────────────────

  /** brush ring under the cursor, line / aim previews */
  frame(cursor: GroundHit | null, pointer: [number, number] | null): void {
    const p = this.armed;
    if (!p) return;
    const ringModes = this.mode === 'brush' || this.mode === 'front' || this.mode === 'once' || this.mode === 'aim' || (this.mode === 'line' && !!p.schema.radius);
    if (cursor && ringModes && p.schema.radius) {
      const col = CAT_COLOR[p.category] ?? [1.2, 0.95, 0.55];
      this.deps.setBrush({ planet: cursor.planet, dir: [cursor.dir[0], cursor.dir[1], cursor.dir[2]], radius: this.brushRadius, color: col });
    } else if (cursor && (ringModes || this.mode === 'move')) {
      this.deps.setBrush({ planet: cursor.planet, dir: [cursor.dir[0], cursor.dir[1], cursor.dir[2]], radius: 14, color: CAT_COLOR[p.category] ?? [1.2, 0.95, 0.55] });
    } else this.deps.setBrush(null);
    // a line from the first end / the press point / the thing being moved to the pointer
    let a: [number, number] | null = null;
    if (this.mode === 'line' && this.first?.hit) a = this.host.screenOf(this.first.hit.planet, this.first.hit.dir);
    else if (this.mode === 'aim' && this.press?.moved && this.press.hit) a = this.host.screenOf(this.press.hit.planet, this.press.hit.dir);
    else if (this.mode === 'move') {
      const who = this.first?.ref ?? this.selectionFor(p);
      const pos = who ? this.posOf(who) : null;
      if (pos) a = this.host.screenOf(pos.planet, pos.dir, 4);
    }
    if (a && pointer) {
      this.overlay.style.display = '';
      this.line.setAttribute('x1', String(a[0])); this.line.setAttribute('y1', String(a[1]));
      this.line.setAttribute('x2', String(pointer[0])); this.line.setAttribute('y2', String(pointer[1]));
      this.dot.setAttribute('cx', String(a[0])); this.dot.setAttribute('cy', String(a[1]));
      const ang = Math.atan2(pointer[1] - a[1], pointer[0] - a[0]);
      const L = 14;
      const p1 = [pointer[0] - Math.cos(ang - 0.45) * L, pointer[1] - Math.sin(ang - 0.45) * L];
      const p2 = [pointer[0] - Math.cos(ang + 0.45) * L, pointer[1] - Math.sin(ang + 0.45) * L];
      this.head.setAttribute('d', this.mode === 'aim' || this.mode === 'move' ? `M${p1[0]} ${p1[1]}L${pointer[0]} ${pointer[1]}L${p2[0]} ${p2[1]}` : '');
    } else this.overlay.style.display = 'none';
  }

  /** where a live thing is now (the line a move tool draws starts there) */
  private posOf(r: EntityRef): { planet: number; dir: ArrayLike<number> } | null {
    const v = this.host.view;
    for (const pv of v.planets) {
      if (r.kind === 'disaster') { const d = pv.disasters.find((q) => q.id === r.id); if (d) return { planet: pv.id, dir: d.pos }; }
      if (r.kind === 'settlement') { const s = pv.settlements.find((q) => q.id === r.id); if (s) return { planet: pv.id, dir: s.pos }; }
      if (r.kind === 'weather') { const w = pv.weather.find((q) => q.id === r.id); if (w) return { planet: pv.id, dir: w.pos }; }
    }
    if (r.kind === 'creature') { const c = v.creatures.find((q) => q.id === r.id); if (c) return { planet: c.planet, dir: c.pos }; }
    return null;
  }

  // ───────────────────────────── brush keys ─────────────────────────────

  /** [ ] and Ctrl+wheel: the brush grows / shrinks by a factor; the card's value flashes */
  resize(f: number): void {
    const p = this.armed;
    const r = p?.schema.radius;
    if (!p || !r) return;
    const lo = Math.max(R_MIN, r.min ?? R_MIN), hi = Math.min(R_MAX, r.max ?? R_MAX);
    this.brushRadius = clamp(this.brushRadius * f, lo, hi);
    this.renderCard('radius');
  }

  /** ⇧[ ⇧] and Alt+wheel: the power's strength by ×1.25 steps (a fifth of the range at the low end, never a leap) */
  strengthen(dir: number): void {
    const p = this.armed;
    if (!p) return;
    const k = strengthParam(p);
    if (!k) return;
    const s = p.schema[k];
    const lo = s.min ?? 0, hi = s.max ?? 1;
    const cur = Number(this.values[k] ?? defaultValue(k, s) ?? lo);
    const floor = (hi - lo) * 0.01;
    let next = dir > 0 ? Math.max(cur * 1.25, cur + floor) : Math.min(cur / 1.25, cur - floor);
    if (s.type === 'int') next = Math.round(next) + (Math.round(next) === cur ? dir : 0);
    this.values[k] = clamp(next, lo, hi);
    this.renderCard(k);
  }

  /** test surface */
  state(): Record<string, unknown> {
    return { armed: this.armed?.id ?? null, mode: this.mode, values: this.values, radius: this.brushRadius, first: this.first?.label ?? null, last: this.last?.power.id ?? null };
  }

  /** where the "here" of a one-shot cast lands, in words (the palette's rows) */
  placeText(at: GroundHit | null): string {
    return at ? placeWords(this.host.view, at.planet, at.dir).text : '';
  }
}

function cap(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
