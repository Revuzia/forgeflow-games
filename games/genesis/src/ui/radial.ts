// GENESIS — the radial menu (CONTRACT.md §16.3; hold Q, right-stick click, or a long press on the ground): the
// categories on an inner ring (Shape, Water, Sky, Life, Peoples, Ideas, Fire, Disasters, Hand, Creature, Worlds, Time,
// Laws), and the chosen category's powers around it on one or two outer rings — the most basic ones (powers.json
// `ring` 0) nearest the category's own direction. Generated from the power catalogue, so mods' powers appear too.
//
// A big category (more than 24 powers) first fans out into groups on a middle ring — Disasters by what they are made of
// (sky, earth and water, life, the cosmos — from disasters.json's own categories — and the controls that cancel, scale,
// move or freeze a live one), Peoples into people and settlements, any other by how basic its powers are — and the
// chosen group's powers sit on the outer ring. Every ring ends with "More…", which opens the palette on the category.
// The slots nearest the pointer carry their names; the hot slot shows what it does beside it.
//
// Hold mode: point and let go of the key over a power to arm it (over a category it stays open to pick from). Click
// mode: click a category, then a power. Keyboard: arrows move, Enter picks, Esc steps back. Gamepad: the stick points
// at a category, A opens it (then a group), the stick points at a power, A arms it, B steps back.

import type { UiHost } from './host.ts';
import type { Power } from './powers.ts';
import { BASE_PACK } from '../data/index.ts';
import { h, clear } from './dom.ts';
import { icon, categoryIcon } from './icons.ts';

const R_CAT = 122;
const R_POW = [200, 256, 312];
/** with groups: the group ring, then the powers */
const R_GRP = 194;
const R_GPOW = [268, 324];
const SLOT = 50;
const CENTER = 64;
/** a category bigger than this fans out into groups first */
const GROUP_AT = 24;
/** how many slots near the pointer show their names */
const NAMED = 8;

interface Slot { el: HTMLButtonElement; label: HTMLSpanElement | null; x: number; y: number; power?: Power; cat?: string; group?: string; more?: string; angle: number }

/** disasters.json's own categories → the radial's disaster groups */
const DISASTER_GROUP: Record<string, string> = { weather: 'Sky', sky: 'Cosmos', space: 'Cosmos', world: 'Cosmos', earth: 'Earth', water: 'Earth', fire: 'Earth', life: 'Life' };
const DISASTER_CAT = new Map(((BASE_PACK.disasters ?? []) as unknown as { id: string; category?: string }[]).map((d) => [d.id, d.category ?? '']));
const GROUP_ICON: Record<string, string> = {
  Sky: 'd-tornado', Earth: 'd-quake', Life: 'd-plague', Cosmos: 'd-meteor', Control: 'stop', People: 'people', Settlements: 'found',
  Basic: 'star', More: 'plus', Rare: 'spark',
};
const GROUP_ORDER = ['Control', 'Sky', 'Earth', 'Life', 'Cosmos', 'People', 'Settlements', 'Basic', 'More', 'Rare'];

/** the group a power of a big category falls in */
export function groupOf(p: Power): string {
  if (p.category === 'Disasters') {
    const kind = typeof p.params.kind === 'string' ? p.params.kind : p.command === 'miracle.meteor' ? 'meteor' : null;
    if (kind) return DISASTER_GROUP[DISASTER_CAT.get(kind) ?? ''] ?? 'Cosmos';
    return 'Control';
  }
  if (p.category === 'Peoples') return /^(settlement\.|miracle\.wood)/.test(p.command) ? 'Settlements' : 'People';
  return p.ring <= 0 ? 'Basic' : p.ring === 1 ? 'More' : 'Rare';
}

export class Radial {
  readonly root: HTMLDivElement;
  private host: UiHost;
  private onPick: (p: Power) => void;
  private onMore: (category: string) => void;
  private svg: SVGSVGElement;
  private center: HTMLDivElement;
  private cName: HTMLDivElement;
  private cSub: HTMLDivElement;
  private tip: HTMLDivElement;
  private cats: Slot[] = [];
  private groups: Slot[] = [];
  private pows: Slot[] = [];
  private cx = 0;
  private cy = 0;
  private active: string | null = null;
  private activeGroup: string | null = null;
  private hot: Slot | null = null;
  /** 'hold': choose on key release; 'click': choose on click */
  mode: 'hold' | 'click' = 'click';
  /** gamepad stage: choosing a category, a group of the active one, or a power */
  private stage: 'cat' | 'grp' | 'pow' = 'cat';

  constructor(parent: HTMLElement, host: UiHost, onPick: (p: Power) => void, onMore: (category: string) => void = () => {}) {
    this.host = host;
    this.onPick = onPick;
    this.onMore = onMore;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'gn-rad-svg');
    this.cName = h('div', { class: 'gn-rad-name' });
    this.cSub = h('div', { class: 'gn-rad-sub' });
    this.center = h('div', { class: 'gn-rad-center' }, this.cName, this.cSub);
    this.tip = h('div', { class: 'gn-rad-tip' });
    this.tip.hidden = true;
    this.root = h('div', { class: 'gn-rad', role: 'menu', aria: { label: 'Powers' } });
    this.root.append(this.svg, this.center, this.tip);
    this.root.hidden = true;
    parent.appendChild(this.root);
    this.root.addEventListener('pointermove', (e) => this.point(e.clientX, e.clientY));
    this.root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) { this.close(); return; }
      this.point(e.clientX, e.clientY);
      const d = Math.hypot(e.clientX - this.cx, e.clientY - this.cy);
      if (!this.hot && (d < CENTER || d > this.outerR() + SLOT)) { this.close(); return; }
      this.choose();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('wheel', (e) => { e.preventDefault(); this.step(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  private outerR(): number {
    let r = R_POW[1];
    for (const s of this.pows) r = Math.max(r, Math.hypot(s.x - this.cx, s.y - this.cy));
    return r;
  }

  open(x: number, y: number, mode: 'hold' | 'click'): void {
    const W = window.innerWidth, H = window.innerHeight;
    // keep the rings on screen (the outer one may be clipped on small windows)
    const m = Math.min(R_POW[1] + SLOT * 0.6, Math.min(W, H) / 2 - 8);
    this.cx = Math.min(W - m, Math.max(m, x));
    this.cy = Math.min(H - m, Math.max(m, y));
    this.mode = mode;
    this.stage = 'cat';
    this.root.style.setProperty('--rx', `${this.cx}px`);
    this.root.style.setProperty('--ry', `${this.cy}px`);
    if (this.root.hidden) this.host.sound('ui.radial');
    this.root.hidden = false;
    this.build();
    this.point(x, y);
  }

  close(): void {
    if (this.root.hidden) return;
    this.host.sound('ui.close');
    this.root.hidden = true;
    this.active = null;
    this.activeGroup = null;
    this.hot = null;
    this.tip.hidden = true;
  }

  /** the hold key was released: pick what is pointed at (a category stays open to click from) */
  release(): void {
    if (!this.isOpen || this.mode !== 'hold') return;
    if (this.hot?.power || this.hot?.more) { this.choose(); return; }
    if (this.active) { this.mode = 'click'; return; }
    this.close();
  }

  private ringCircle(r: number, cls: string): void {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(this.cx)); c.setAttribute('cy', String(this.cy)); c.setAttribute('r', String(r)); c.setAttribute('class', cls);
    this.svg.append(c);
  }

  private build(): void {
    clear(this.svg);
    for (const s of [...this.cats, ...this.groups, ...this.pows]) { s.el.remove(); s.label?.remove(); }
    this.cats = [];
    this.groups = [];
    this.pows = [];
    this.center.style.left = `${this.cx}px`;
    this.center.style.top = `${this.cy}px`;
    this.ringCircle(R_CAT, 'gn-rad-ring');
    this.ringCircle(CENTER, 'gn-rad-ring gn-rad-inner');
    const cats = this.host.powers.categories();
    cats.forEach((c, i) => {
      const a = -Math.PI / 2 + (i / cats.length) * Math.PI * 2;
      const x = this.cx + Math.cos(a) * R_CAT, y = this.cy + Math.sin(a) * R_CAT;
      const el = h('button', { class: 'gn-rad-cat', title: c, aria: { label: c }, html: categoryIcon(c) });
      el.append(h('span', { class: 'gn-rad-cl', text: c }));
      el.style.left = `${x}px`; el.style.top = `${y}px`;
      this.root.append(el);
      this.cats.push({ el, label: null, x, y, cat: c, angle: a });
    });
    this.label(null);
  }

  /** the groups of a big category, in a fixed order (null: small enough to show whole) */
  private groupsOf(cat: string): Map<string, Power[]> | null {
    const list = this.host.powers.byCategory.get(cat) ?? [];
    if (list.length <= GROUP_AT) return null;
    const m = new Map<string, Power[]>();
    for (const p of list) { const g = groupOf(p); const l = m.get(g) ?? []; l.push(p); m.set(g, l); }
    if (m.size < 2) return null;
    return new Map([...m.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0])));
  }

  private clearRing(slots: Slot[], cls: string): void {
    for (const s of slots) { s.el.remove(); s.label?.remove(); }
    slots.length = 0;
    for (const c of Array.from(this.svg.querySelectorAll(`.${cls}`))) c.remove();
  }

  private showCategory(cat: string): void {
    if (this.active === cat) return;
    this.active = cat;
    this.activeGroup = null;
    this.clearRing(this.groups, 'gn-rad-gring');
    this.clearRing(this.pows, 'gn-rad-pring');
    for (const s of this.cats) s.el.classList.toggle('gn-on', s.cat === cat);
    const base = this.cats.find((s) => s.cat === cat)?.angle ?? 0;
    const groups = this.groupsOf(cat);
    if (groups) {
      // the groups fan out from the category's direction on their own ring
      this.ringCircle(R_GRP, 'gn-rad-ring gn-rad-gring');
      const names = [...groups.keys()];
      const dA = Math.min(0.42, (Math.PI * 2) / Math.max(6, names.length + 1));
      names.forEach((g, k) => {
        const off = k - (names.length - 1) / 2;
        const a = base + off * dA;
        const x = this.cx + Math.cos(a) * R_GRP, y = this.cy + Math.sin(a) * R_GRP;
        const el = h('button', { class: 'gn-rad-cat gn-rad-grp', title: `${g} (${groups.get(g)!.length})`, aria: { label: g }, html: icon(GROUP_ICON[g] ?? 'star') });
        el.append(h('span', { class: 'gn-rad-cl', text: g }));
        el.style.left = `${x}px`; el.style.top = `${y}px`;
        this.root.append(el);
        this.groups.push({ el, label: null, x, y, cat, group: g, angle: a });
      });
      return;
    }
    this.layPowers(this.host.powers.byCategory.get(cat) ?? [], base, R_POW, cat);
  }

  private showGroup(slot: Slot): void {
    if (!slot.group || this.activeGroup === slot.group) return;
    this.activeGroup = slot.group;
    for (const s of this.groups) s.el.classList.toggle('gn-on', s === slot);
    this.clearRing(this.pows, 'gn-rad-pring');
    const list = this.groupsOf(slot.cat!)?.get(slot.group) ?? [];
    this.layPowers(list, slot.angle, R_GPOW, slot.cat!);
  }

  /** powers (and "More…") on rings, fanned out from a direction: 0, +1, −1, +2, −2 … */
  private layPowers(list: Power[], base: number, radii: number[], cat: string): void {
    const items: (Power | 'more')[] = [...list, 'more'];
    let i = 0;
    for (let r = 0; r < radii.length && i < items.length; r++) {
      const R = radii[r];
      const cap = Math.max(6, Math.floor((Math.PI * 2 * R) / SLOT));
      const n = r === radii.length - 1 ? items.length - i : Math.min(cap, items.length - i);
      this.ringCircle(R, 'gn-rad-ring gn-rad-pring');
      const dA = (Math.PI * 2) / Math.max(cap, n);
      for (let k = 0; k < n; k++, i++) {
        const off = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2);
        const a = base + off * dA;
        const x = this.cx + Math.cos(a) * R, y = this.cy + Math.sin(a) * R;
        const it = items[i];
        const more = it === 'more';
        const name = more ? 'More…' : it.name;
        const el = h('button', { class: `gn-rad-pow${more ? ' gn-rad-more' : ''}`, title: more ? `Every ${cat.toLowerCase()} power, in the palette` : it.name, aria: { label: name }, html: more ? icon('search') : icon(it.icon, it.category) });
        el.style.left = `${x}px`; el.style.top = `${y}px`;
        el.style.animationDelay = `${Math.min(k, 14) * 12}ms`;
        // its name, outward from the ring (shown on the slots nearest the pointer)
        const label = h('span', { class: 'gn-rad-pl', text: name });
        const lx = this.cx + Math.cos(a) * (R + 30), ly = this.cy + Math.sin(a) * (R + 30);
        label.style.left = `${lx}px`; label.style.top = `${ly}px`;
        label.style.transform = `translate(${Math.cos(a) < -0.3 ? '-100%' : Math.cos(a) > 0.3 ? '0' : '-50%'}, -50%)`;
        this.root.append(el, label);
        this.pows.push(more ? { el, label, x, y, more: cat, angle: a } : { el, label, x, y, power: it, angle: a });
      }
    }
  }

  /** the pointer moved to (x, y): highlight what is there, name the slots near it */
  point(x: number, y: number): void {
    const d = Math.hypot(x - this.cx, y - this.cy);
    const a = Math.atan2(y - this.cy, x - this.cx);
    let hot: Slot | null = null;
    const grouped = this.groups.length > 0;
    const catEdge = (R_CAT + (grouped ? R_GRP : R_POW[0])) / 2;
    if (d >= CENTER && d < catEdge) {
      // the category whose direction is nearest
      let best = Infinity;
      for (const s of this.cats) { const da = Math.abs(angDiff(a, s.angle)); if (da < best) { best = da; hot = s; } }
      if (hot?.cat) this.showCategory(hot.cat);
    } else if (grouped && d >= catEdge && d < (R_GRP + R_GPOW[0]) / 2) {
      let best = SLOT * 1.1;
      for (const s of this.groups) { const dd = Math.hypot(x - s.x, y - s.y); if (dd < best) { best = dd; hot = s; } }
      if (hot) this.showGroup(hot);
    } else if (d >= catEdge) {
      let best = SLOT * 0.95;
      for (const s of this.pows) { const dd = Math.hypot(x - s.x, y - s.y); if (dd < best) { best = dd; hot = s; } }
    }
    this.setHot(hot);
    this.nameNear(x, y);
  }

  /** names on the power slots nearest a point */
  private nameNear(x: number, y: number): void {
    if (!this.pows.length) return;
    const near = [...this.pows].sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y)).slice(0, NAMED);
    const on = new Set(near);
    for (const s of this.pows) s.label?.classList.toggle('gn-on', on.has(s) && s !== this.hot);
  }

  private setHot(s: Slot | null): void {
    if (this.hot === s) return;
    this.hot?.el.classList.remove('gn-hot');
    this.hot = s;
    if (s) this.host.sound('ui.tick');
    s?.el.classList.add('gn-hot');
    this.label(s);
  }

  private label(s: Slot | null): void {
    this.tip.hidden = true;
    if (s?.power || s?.more) {
      const name = s.power ? s.power.name : 'More…';
      this.cName.textContent = name;
      this.cSub.textContent = s.power ? s.power.category : `every ${s.more!.toLowerCase()} power`;
      // what it does, beside the slot (outward), never cut off
      const desc = s.power ? `${s.power.desc}${s.power.gesture ? ` · gesture: ${s.power.gesture}` : ''}` : 'Open the palette on this category: search, arm, cast.';
      clear(this.tip);
      this.tip.append(h('b', { text: name }), h('span', { text: desc }));
      const right = s.x >= this.cx;
      this.tip.style.left = `${s.x + (right ? 30 : -30)}px`;
      this.tip.style.top = `${s.y}px`;
      this.tip.style.transform = `translate(${right ? '0' : '-100%'}, -50%)`;
      this.tip.hidden = false;
    } else if (s?.group) {
      this.cName.textContent = s.group;
      this.cSub.textContent = `${this.groupsOf(s.cat!)?.get(s.group)?.length ?? 0} ${s.cat!.toLowerCase()}`;
    } else if (s?.cat) {
      this.cName.textContent = s.cat;
      this.cSub.textContent = `${this.host.powers.byCategory.get(s.cat)?.length ?? 0} powers`;
    } else if (this.active) {
      this.cName.textContent = this.activeGroup ?? this.active;
      this.cSub.textContent = this.groups.length && !this.activeGroup ? 'point at a group' : 'point at a power';
    } else {
      this.cName.textContent = 'Powers';
      this.cSub.textContent = 'point at a category';
    }
  }

  private choose(): void {
    const s = this.hot;
    if (!s) return;
    if (s.cat && !s.group && !s.power && !s.more) {
      this.showCategory(s.cat);
      this.mode = 'click';
      this.stage = this.groups.length ? 'grp' : 'pow';
      return;
    }
    if (s.group) { this.showGroup(s); this.mode = 'click'; this.stage = 'pow'; return; }
    if (s.more) { const c = s.more; this.close(); this.onMore(c); return; }
    if (s.power) { const p = s.power; this.close(); this.onPick(p); }
  }

  /** keyboard / wheel: step the highlight around the current ring */
  step(d: number): void {
    const ring = this.hot?.power || this.hot?.more || this.stage === 'pow' ? this.pows : this.hot?.group || this.stage === 'grp' ? this.groups : this.cats;
    if (!ring.length) return;
    const sorted = [...ring].sort((a, b) => norm(a.angle) - norm(b.angle));
    const i = this.hot ? sorted.indexOf(this.hot) : -1;
    const next = sorted[(i + d + sorted.length) % sorted.length];
    this.setHot(next);
    if (next.cat && !next.group && !next.power && !next.more) this.showCategory(next.cat);
    if (next.group) this.showGroup(next);
    this.nameNear(next.x, next.y);
  }

  key(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': this.step(1); break;
      case 'ArrowLeft': case 'ArrowUp': this.step(-1); break;
      case 'Enter': case ' ': this.choose(); break;
      case 'Escape': case 'Backspace': this.back(); break;
      default: return false;
    }
    e.preventDefault();
    return true;
  }

  /** gamepad: a stick vector (−1..1) points at a category, a group, or a power */
  stick(x: number, y: number): void {
    const m = Math.hypot(x, y);
    if (m < 0.35) return;
    const a = Math.atan2(y, x);
    const nearestByAngle = (ring: Slot[]): Slot | null => {
      let best = Infinity, hot: Slot | null = null;
      for (const s of ring) { const da = Math.abs(angDiff(a, s.angle)); if (da < best) { best = da; hot = s; } }
      return hot;
    };
    if (this.stage === 'cat') {
      const hot = nearestByAngle(this.cats);
      this.setHot(hot);
      if (hot?.cat) this.showCategory(hot.cat);
    } else if (this.stage === 'grp') {
      const hot = nearestByAngle(this.groups);
      this.setHot(hot);
      if (hot) this.showGroup(hot);
    } else {
      // the stick's tip on the rings: magnitude picks the ring, angle the slot
      const inner = this.groups.length ? R_GPOW[0] : R_POW[0];
      const outer = this.outerR();
      const R = inner + (outer - inner) * Math.max(0, Math.min(1, (m - 0.55) / 0.4));
      const px = this.cx + Math.cos(a) * R, py = this.cy + Math.sin(a) * R;
      let best = SLOT * 1.2, hot: Slot | null = null;
      for (const s of this.pows) { const dd = Math.hypot(px - s.x, py - s.y); if (dd < best) { best = dd; hot = s; } }
      this.setHot(hot);
      this.nameNear(px, py);
    }
  }

  /** gamepad A */
  confirm(): void {
    if (this.stage === 'cat' && this.hot?.cat) {
      this.showCategory(this.hot.cat);
      if (this.groups.length) { this.stage = 'grp'; this.setHot(this.groups[0] ?? null); if (this.groups[0]) this.showGroup(this.groups[0]); }
      else { this.stage = 'pow'; this.setHot(this.pows[0] ?? null); }
      return;
    }
    if (this.stage === 'grp' && this.hot?.group) { this.showGroup(this.hot); this.stage = 'pow'; this.setHot(this.pows[0] ?? null); return; }
    this.choose();
  }

  /** gamepad B / Esc: one step back */
  back(): void {
    if (this.stage === 'pow' && this.groups.length) { this.stage = 'grp'; this.setHot(this.groups.find((g) => g.group === this.activeGroup) ?? null); return; }
    if (this.stage === 'pow' || this.stage === 'grp') { this.stage = 'cat'; this.setHot(this.cats.find((c) => c.cat === this.active) ?? null); return; }
    this.close();
  }

  /** test surface: what is open */
  state(): { open: boolean; active: string | null; group: string | null; groups: string[]; hot: string | null; powers: string[] } {
    return { open: this.isOpen, active: this.active, group: this.activeGroup, groups: this.groups.map((g) => g.group!), hot: this.hot?.power?.id ?? this.hot?.group ?? this.hot?.cat ?? (this.hot?.more ? 'more' : null), powers: this.pows.filter((s) => s.power).map((s) => s.power!.id) };
  }

  /** test surface / shots: open on a category (and a group of it) */
  openCategory(cat: string, x = window.innerWidth / 2, y = window.innerHeight / 2, group?: string): void {
    this.open(x, y, 'click');
    this.showCategory(cat);
    const g = group ? this.groups.find((s) => s.group === group) : this.groups[0];
    if (g) { this.showGroup(g); this.stage = 'pow'; } else this.stage = this.groups.length ? 'grp' : 'pow';
    const s = this.cats.find((c) => c.cat === cat);
    if (s) { s.el.classList.add('gn-on'); this.label(null); }
  }

  /** test surface: highlight a power by id */
  hover(id: string): void {
    const s = this.pows.find((q) => q.power?.id === id) ?? null;
    this.setHot(s);
    if (s) this.nameNear(s.x, s.y);
  }
}

function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function norm(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
