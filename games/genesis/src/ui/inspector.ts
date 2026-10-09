// GENESIS — the inspector (CONTRACT.md §16.6, §1.6 "inspector biographies"): click a person, a building, a herd or a
// settlement and read who they are. A dark glass card on the right that exists only while something is selected.
//
// Everything shown comes from `sim.query` (src/sim/people/query.ts): 'agent' (a biography: name, people, age, role,
// what they are doing, family, health, mood, needs, skills, traits, knowledge, memories, faith), 'building',
// 'settlement' (population, era, library, stores, buildings, roles, stories, language) and 'herds'. The card re-asks
// every ~1.2 s while open (a person's needs and doings move with the sim). Names in the card are links: a person's
// settlement, a building's settlement, a settlement's buildings. A person who dies while selected keeps their card,
// marked as such. The App owns the selection (and the marker over the selected thing in the world).

import type { EntityRef } from '../sim/types.ts';

export interface InspectorDeps {
  query(q: string, args: Record<string, unknown>): Promise<unknown>;
  /** calendar date of a tick on a planet ("Year 2, day 7") */
  date(planet: number, tick: number): string;
  /** select something else (a link in the card) */
  select(ref: EntityRef | null): void;
  /** fly the camera to the selected thing / keep it in view */
  lookAt(ref: EntityRef): void;
  follow(ref: EntityRef | null): void;
  isFollowing(ref: EntityRef): boolean;
}

type Rec = Record<string, unknown>;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const pct = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}`;

const NEED_LABEL: Record<string, string> = {
  food: 'Food', water: 'Water', warmth: 'Warmth', rest: 'Rest', safety: 'Safety', belonging: 'Belonging', status: 'Standing',
  curiosity: 'Curiosity', faith: 'Faith', methane: 'Methane', wetness: 'Wetness', hive: 'Hive',
};
const TRAIT_WORDS: Record<string, [string, string]> = {
  curiosity: ['incurious', 'curious'], boldness: ['timid', 'bold'], sociability: ['solitary', 'sociable'], piety: ['sceptical', 'pious'],
  aggression: ['gentle', 'fierce'], diligence: ['idle', 'diligent'], conservatism: ['open to new ways', 'set in the old ways'],
};

export class Inspector {
  readonly root: HTMLDivElement;
  private deps: InspectorDeps;
  private head: HTMLDivElement;
  private body: HTMLDivElement;
  private ref: EntityRef | null = null;
  private data: Rec | null = null;
  private gone = false;
  private lastAsk = -1e9;
  private asking = false;
  private gen = 0;
  /** extra data per kind (a settlement's species list, etc.) */
  private followBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, deps: InspectorDeps) {
    this.deps = deps;
    this.root = el('div', 'gn-panel gn-insp');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Inspector');
    this.root.hidden = true;
    const bar = el('div', 'gn-insp-bar');
    this.head = el('div', 'gn-insp-head');
    const tools = el('div', 'gn-insp-tools');
    const look = el('button', 'gn-btn gn-insp-tool', 'Look');
    look.type = 'button';
    look.title = 'Fly the camera here';
    look.addEventListener('click', () => { if (this.ref) this.deps.lookAt(this.ref); });
    this.followBtn = el('button', 'gn-btn gn-insp-tool', 'Follow');
    this.followBtn.type = 'button';
    this.followBtn.title = 'Keep the camera on them (F)';
    this.followBtn.addEventListener('click', () => {
      if (!this.ref) return;
      this.deps.follow(this.deps.isFollowing(this.ref) ? null : this.ref);
      this.syncFollow();
    });
    const close = el('button', 'gn-btn gn-insp-close');
    close.type = 'button';
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close the inspector');
    close.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';
    close.addEventListener('click', () => this.deps.select(null));
    tools.append(look, this.followBtn, close);
    bar.append(this.head, tools);
    this.body = el('div', 'gn-insp-body');
    this.root.append(bar, this.body);
    parent.appendChild(this.root);
  }

  get selected(): EntityRef | null { return this.ref; }
  get isOpen(): boolean { return !this.root.hidden; }

  /** open the card on a thing (null closes it) */
  open(ref: EntityRef | null): void {
    this.gen++;
    this.ref = ref;
    this.data = null;
    this.gone = false;
    this.asking = false;
    if (!ref) { this.root.hidden = true; return; }
    this.root.hidden = false;
    this.head.innerHTML = '';
    this.head.append(el('div', 'gn-insp-kind', ref.kind === 'agent' ? 'Person' : ref.kind === 'animal' ? 'Herd' : cap(ref.kind)), el('div', 'gn-insp-name', '…'));
    this.body.innerHTML = '';
    this.body.append(el('div', 'gn-insp-wait', 'Asking the world…'));
    this.followBtn.hidden = ref.kind === 'settlement' || ref.kind === 'building';
    this.syncFollow();
    this.lastAsk = -1e9;
    this.tick(performance.now());
  }

  private syncFollow(): void {
    this.followBtn.classList.toggle('gn-on', !!this.ref && this.deps.isFollowing(this.ref));
  }

  /** refresh while open (call every frame; it asks the sim at most every ~1.2 s) */
  tick(now: number): void {
    const ref = this.ref;
    if (!ref || this.asking || this.gone || now - this.lastAsk < 1200) return;
    this.lastAsk = now;
    this.asking = true;
    const gen = this.gen;
    const q = ref.kind === 'animal' ? 'herds' : ref.kind;
    this.deps.query(q, { id: ref.id, planet: ref.planet }).then((d) => {
      if (gen !== this.gen) return;
      this.asking = false;
      let rec: Rec | null = null;
      if (ref.kind === 'animal' && Array.isArray(d)) rec = (d as Rec[]).find((h) => h.id === ref.id) ?? null;
      else if (d && typeof d === 'object' && !Array.isArray(d)) rec = d as Rec;
      if (rec && rec.lookdev) {
        this.head.innerHTML = '';
        this.header(ref.kind === 'agent' ? 'Person' : ref.kind === 'animal' ? 'Herd' : cap(ref.kind), ref.kind === 'agent' ? 'A figure of the lookdev world' : `A ${ref.kind === 'animal' ? 'herd' : ref.kind} of the lookdev world`, '');
        this.body.innerHTML = '';
        this.body.append(el('div', 'gn-insp-wait', 'This world is fabricated for the look: nobody here has a story. Run the living simulation (source=worker) to meet its people.'));
        this.gone = true;
        return;
      }
      if (!rec) {
        // gone: keep the last card, marked
        if (this.data) { this.gone = true; this.render(); }
        else { this.body.innerHTML = ''; this.body.append(el('div', 'gn-insp-wait', ref.kind === 'agent' ? 'No one by that name lives now.' : 'Nothing is there any more.')); }
        return;
      }
      this.data = rec;
      this.render();
    }).catch(() => { if (gen === this.gen) this.asking = false; });
  }

  // ───────────────────────────── rendering ─────────────────────────────

  private render(): void {
    const ref = this.ref, d = this.data;
    if (!ref || !d) return;
    const scroll = this.body.scrollTop;
    this.body.innerHTML = '';
    this.head.innerHTML = '';
    switch (ref.kind) {
      case 'agent': this.agent(ref, d); break;
      case 'building': this.building(ref, d); break;
      case 'settlement': this.settlement(ref, d); break;
      case 'animal': this.herd(d); break;
      default: this.head.append(el('div', 'gn-insp-name', cap(ref.kind)));
    }
    this.body.scrollTop = scroll;
    this.syncFollow();
  }

  private header(kind: string, name: string, sub: string): void {
    this.head.append(el('div', 'gn-insp-kind', kind), el('div', 'gn-insp-name', name));
    if (sub) this.head.append(el('div', 'gn-insp-sub', sub));
  }

  private section(title: string, extra?: string): HTMLDivElement {
    const s = el('div', 'gn-insp-sec');
    const h = el('div', 'gn-insp-sec-h', title);
    if (extra) h.append(el('span', 'gn-insp-sec-x', extra));
    s.append(h);
    this.body.append(s);
    return s;
  }

  private bar(parent: HTMLElement, label: string, v: number, tone = ''): void {
    const row = el('div', 'gn-insp-bar-row');
    const l = el('span', 'gn-insp-bar-l', label);
    const track = el('span', 'gn-insp-track');
    const fill = el('span', `gn-insp-fill ${tone}`);
    fill.style.width = `${pct(v)}%`;
    if (!tone && v < 0.25) fill.classList.add('gn-low');
    track.append(fill);
    const val = el('span', 'gn-insp-bar-v', pct(v));
    row.append(l, track, val);
    parent.append(row);
  }

  private kv(parent: HTMLElement, k: string, v: string | HTMLElement): void {
    const row = el('div', 'gn-insp-kv');
    row.append(el('span', 'gn-insp-k', k));
    const val = el('span', 'gn-insp-v');
    if (typeof v === 'string') val.textContent = v; else val.append(v);
    row.append(val);
    parent.append(row);
  }

  private link(text: string, ref: EntityRef): HTMLButtonElement {
    const a = el('button', 'gn-insp-link', text);
    a.type = 'button';
    a.addEventListener('click', () => this.deps.select(ref));
    return a;
  }

  private chips(parent: HTMLElement, items: string[], max = 18, cls = ''): void {
    const wrap = el('div', 'gn-insp-chips');
    for (const it of items.slice(0, max)) wrap.append(el('span', `gn-chip ${cls}`, it));
    if (items.length > max) wrap.append(el('span', 'gn-chip gn-chip-more', `+${items.length - max}`));
    if (!items.length) wrap.append(el('span', 'gn-insp-none', 'none'));
    parent.append(wrap);
  }

  private agent(ref: EntityRef, d: Rec): void {
    const planet = ref.planet ?? 0;
    const sex = str(d.sex);
    const age = num(d.age);
    const role = str(d.role);
    const caste = str(d.caste);
    const sp = str(d.speciesName, str(d.species));
    const ageText = age < 1 ? 'an infant' : `${age < 10 ? age.toFixed(1) : Math.floor(age)} years`;
    const sub = [cap(sp), sex, ageText, caste ? `${caste} caste` : role && role !== 'none' ? role : ''].filter(Boolean).join(' · ');
    this.header(this.gone ? 'Person · died' : 'Person', str(d.name, 'Someone'), sub);
    const st = d.settlement as Rec | null;
    const now = el('div', 'gn-insp-doing');
    if (this.gone) now.textContent = 'Has died. This is how the world remembers them.';
    else {
      now.append(document.createTextNode(cap(str(d.doing, 'resting'))));
      if (st) { now.append(document.createTextNode(st.band ? ', with ' : ' · ')); now.append(this.link(str(st.name), { kind: 'settlement', id: num(st.id), planet })); }
    }
    this.body.append(now);
    const flags: string[] = [];
    if (d.sick) flags.push(`sick: ${str(d.sick)}`);
    const master = Array.isArray(d.master) ? (d.master as string[]) : [];
    if (master.length) flags.push(`master of ${master.join(', ')}`);
    if (num(d.flags) & 16) flags.push('disciple of the god');
    if (num(d.flags) & 8) flags.push('leader');
    if (flags.length) this.chips(this.body, flags, 6, 'gn-chip-flag');
    const vit = this.section('Body and mind');
    this.bar(vit, 'Health', num(d.health), 'gn-health');
    this.bar(vit, 'Mood', num(d.mood), 'gn-mood');
    const needs = (d.needs ?? {}) as Record<string, number>;
    const nk = Object.keys(needs);
    if (nk.length) {
      const sec = this.section('Needs', 'met');
      const grid = el('div', 'gn-insp-grid');
      for (const k of nk) this.bar(grid, NEED_LABEL[k] ?? cap(k), num(needs[k]));
      sec.append(grid);
    }
    const faith = (d.faith ?? {}) as Rec;
    if (faith) {
      const sec = this.section('Toward the god');
      this.bar(sec, 'Love', num(faith.love), 'gn-love');
      this.bar(sec, 'Fear', num(faith.fear), 'gn-fear');
    }
    const skills = Object.entries((d.skills ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (skills.length) {
      const sec = this.section('Skills');
      for (const [k, v] of skills) this.bar(sec, cap(k) + (v >= 0.7 ? ' ★' : ''), v, 'gn-skill');
    }
    const traits = Object.entries((d.traits ?? {}) as Record<string, number>)
      .filter(([k, v]) => TRAIT_WORDS[k] && Math.abs(v - 0.5) > 0.15)
      .sort((a, b) => Math.abs(b[1] - 0.5) - Math.abs(a[1] - 0.5))
      .map(([k, v]) => TRAIT_WORDS[k][v > 0.5 ? 1 : 0]);
    if (traits.length) { const sec = this.section('Nature'); this.chips(sec, traits.slice(0, 5), 5, 'gn-chip-trait'); }
    const know = Array.isArray(d.knowledge) ? (d.knowledge as string[]) : [];
    const ks = this.section('Knows', `${know.length}`);
    this.chips(ks, know, 16);
    const fam = (d.family ?? {}) as Rec;
    const kids = Array.isArray(fam.children) ? (fam.children as string[]) : [];
    if (fam.mother || fam.father || fam.partner || kids.length) {
      const sec = this.section('Family');
      if (fam.partner) this.kv(sec, 'Partner', str(fam.partner));
      if (fam.mother || fam.father) this.kv(sec, 'Parents', [fam.mother, fam.father].filter(Boolean).map((x) => str(x)).join(' and '));
      if (kids.length) this.kv(sec, kids.length === 1 ? 'Child' : 'Children', kids.join(', '));
    }
    const inv = Array.isArray(d.inventory) ? (d.inventory as Rec[]) : [];
    if (inv.length || d.tool || d.wearing) {
      const sec = this.section('Carries');
      if (d.tool) this.kv(sec, 'Tool', str(d.tool));
      if (d.wearing) this.kv(sec, 'Wears', str(d.wearing));
      if (inv.length) this.kv(sec, 'Pack', inv.map((x) => `${str(x.item)}${num(x.qty) > 1.05 ? ` ×${Math.round(num(x.qty))}` : ''}`).join(', '));
    }
    const mem = Array.isArray(d.memories) ? (d.memories as Rec[]) : [];
    if (mem.length) {
      const sec = this.section('Remembers');
      const list = el('ol', 'gn-insp-mem');
      for (const m of [...mem].sort((a, b) => num(b.tick) - num(a.tick))) {
        const li = el('li');
        li.append(el('span', 'gn-insp-mem-d', this.deps.date(planet, num(m.tick))), el('span', 'gn-insp-mem-t', cap(str(m.text))));
        list.append(li);
      }
      sec.append(list);
    }
  }

  private building(ref: EntityRef, d: Rec): void {
    const planet = ref.planet ?? 0;
    const name = str(d.name, 'A building');
    const mat = str(d.material);
    const fn = str(d.function);
    this.header(this.gone ? 'Building · gone' : 'Building', name, [mat ? cap(mat.replace(/-/g, ' ')) : '', fn && fn !== name.toLowerCase() ? fn : ''].filter(Boolean).join(' · '));
    const where = el('div', 'gn-insp-doing');
    const sid = num(d.settlement, -1);
    if (sid >= 0 && d.settlementName) { where.append(document.createTextNode('Of ')); where.append(this.link(str(d.settlementName), { kind: 'settlement', id: sid, planet })); }
    else where.textContent = 'No one claims it.';
    this.body.append(where);
    const sec = this.section('State');
    const progress = num(d.progress, 1);
    if (progress < 0.999) this.bar(sec, 'Built', progress, 'gn-skill');
    this.bar(sec, 'Sound', 1 - num(d.damage), 'gn-health');
    const flags = num(d.flags);
    const st: string[] = [];
    if (flags & 1) st.push('burning');
    if (flags & 2) st.push('in ruins');
    if (flags & 4) st.push('abandoned');
    if (flags & 8) st.push('sacred');
    if (d.lit) st.push('a fire burns');
    if (st.length) this.chips(sec, st, 6, 'gn-chip-flag');
    if (num(d.occupants) > 0) this.kv(sec, 'Inside', `${num(d.occupants)} ${num(d.occupants) === 1 ? 'person' : 'people'}`);
    const books = Array.isArray(d.books) ? (d.books as string[]).filter(Boolean) : [];
    if (books.length) { const b = this.section('Written here', `${books.length}`); this.chips(b, books, 16, 'gn-chip-book'); }
  }

  private settlement(ref: EntityRef, d: Rec): void {
    const planet = ref.planet ?? 0;
    const pop = num(d.population);
    const coh = (d.cohort ?? {}) as Rec;
    const cohort = num(coh.children) + num(coh.adults) + num(coh.elders);
    const sp = str(d.speciesName, str(d.species));
    const era = str(d.era);
    this.header(d.fallen ? 'Settlement · fallen' : d.band ? 'Band' : 'Settlement', str(d.name, 'A settlement'),
      [cap(sp), era ? `${era} age` : '', `${pop} ${pop === 1 ? 'soul' : 'souls'}`].filter(Boolean).join(' · '));
    const line = el('div', 'gn-insp-doing');
    const f = d.founded as Rec | null;
    const feature = str(d.feature);
    line.textContent = d.band ? 'Wandering, looking for a place to live.'
      : `${f ? `Founded in year ${num(f.year)}, day ${num(f.day)}` : 'Founded before memory'}${feature && feature !== 'plain' ? `, by the ${feature}` : ''}.`;
    this.body.append(line);
    // the state of the place: a golden / dark age, plague, siege, war (societies; absent in older sims)
    const badges: string[] = [];
    if (d.age === 'golden') badges.push('a golden age');
    if (d.age === 'dark') badges.push('a dark age');
    if (d.epidemic) badges.push(`plague: ${str(d.epidemic)}`);
    if (d.besieged) badges.push('under siege');
    const rel = Array.isArray(d.relations) ? (d.relations as Rec[]) : [];
    if (rel.some((r) => r.atWar)) badges.push('at war');
    if (badges.length) this.chips(this.body, badges, 6, 'gn-chip-flag');
    const lead = d.leader as Rec | null;
    const pol = d.polity as Rec | null;
    if (lead || (pol && pol.name)) {
      const g = this.section('Rule');
      if (lead) {
        const who = el('span');
        if (lead.title) who.append(document.createTextNode(`${cap(str(lead.title))} `));
        who.append(this.link(str(lead.name), { kind: 'agent', id: num(lead.id), planet }));
        this.kv(g, 'Led by', who);
      }
      if (pol && pol.name) this.kv(g, 'Realm', str(pol.name));
      const fac = Array.isArray(d.factions) ? (d.factions as Rec[]) : [];
      if (fac.length) this.chips(g, fac.sort((a, b) => num(b.share) - num(a.share)).map((f) => `${str(f.kind)} ${Math.round(num(f.share) * 100)}%`), 6, 'gn-chip-role');
    }
    if (rel.length) {
      const g = this.section('Neighbours');
      for (const r of rel.slice(0, 6)) {
        const op = num(r.opinion);
        const mood = r.atWar ? 'at war' : op > 0.4 ? 'friends' : op < -0.4 ? 'hostile' : op < -0.1 ? 'wary' : 'at peace';
        this.kv(g, str(r.name, 'a people'), `${mood}${num(r.trade) > 0.05 ? ' · trading' : ''}`);
      }
    }
    const sec = this.section('People');
    this.kv(sec, 'Living', cohort > 0 ? `${num(d.agents)} named, ${Math.round(cohort)} more` : `${num(d.agents)}`);
    const fd = num(d.foodDays, -1);
    if (fd >= 0) this.kv(sec, 'Food stored', fd >= 30 ? 'plenty' : `${fd.toFixed(1)} days`);
    const stats = (d.stats ?? {}) as Rec;
    if (num(stats.births) || num(stats.deaths)) this.kv(sec, 'Born / died', `${num(stats.births)} / ${num(stats.deaths)}`);
    if (d.crop) this.kv(sec, 'Fields of', `${str(d.crop).toLowerCase()}${num(d.fields) ? ` (${num(d.fields)})` : ''}`);
    const roles = Object.entries((d.roles ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
    if (roles.length) this.chips(sec, roles, 10, 'gn-chip-role');
    if (typeof d.belief === 'number') {
      const g = this.section('Toward the god');
      this.bar(g, 'Belief', num(d.belief), 'gn-love');
      this.bar(g, 'Fear', num(d.fear), 'gn-fear');
    }
    const lib = Array.isArray(d.library) ? (d.library as string[]) : [];
    const written = new Set(Array.isArray(d.written) ? (d.written as string[]) : []);
    const secrets = new Set(Array.isArray(d.secrets) ? (d.secrets as string[]) : []);
    const ls = this.section('Knowledge', `${lib.length}${written.size ? ` · ${written.size} written` : ''}`);
    const wrap = el('div', 'gn-insp-chips');
    for (const k of lib.slice(0, 28)) wrap.append(el('span', `gn-chip${written.has(k) ? ' gn-chip-book' : ''}${secrets.has(k) ? ' gn-chip-secret' : ''}`, k));
    if (lib.length > 28) wrap.append(el('span', 'gn-chip gn-chip-more', `+${lib.length - 28}`));
    ls.append(wrap);
    const stores = Object.entries((d.stores ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
    if (stores.length) {
      const s = this.section('Stores');
      this.chips(s, stores.map(([k, v]) => `${k} ${v >= 10 ? Math.round(v) : v.toFixed(1)}`), 14, 'gn-chip-store');
    }
    const bl = Array.isArray(d.buildings) ? (d.buildings as Rec[]) : [];
    if (bl.length) {
      const s = this.section('Buildings', `${bl.length}`);
      const count = new Map<string, { n: number; id: number; rising: number }>();
      for (const b of bl) {
        const k = str(b.type);
        const c = count.get(k) ?? { n: 0, id: num(b.id), rising: 0 };
        c.n++;
        if (num(b.progress, 1) < 0.999) c.rising++;
        count.set(k, c);
      }
      const wrapB = el('div', 'gn-insp-chips');
      for (const [k, c] of count) {
        const a = this.link(`${k}${c.n > 1 ? ` ×${c.n}` : ''}${c.rising ? ' (rising)' : ''}`, { kind: 'building', id: c.id, planet });
        a.classList.add('gn-chip');
        wrapB.append(a);
      }
      s.append(wrapB);
    }
    const stories = Array.isArray(d.stories) ? (d.stories as string[]) : [];
    if (stories.length) {
      const s = this.section('Stories they tell');
      const list = el('ul', 'gn-insp-stories');
      for (const t of stories.slice(-5).reverse()) list.append(el('li', '', t));
      s.append(list);
    }
    const lang = d.language as Rec | null;
    if (lang && Array.isArray(lang.sample)) {
      const s = this.section('Their tongue');
      s.append(el('div', 'gn-insp-lang', (lang.sample as string[]).join(' · ')));
    }
  }

  private herd(d: Rec): void {
    const n = num(d.count);
    this.header('Herd', str(d.name, 'Animals'), `${Math.max(1, Math.round(n))} ${n >= 1.5 ? 'animals' : 'animal'} · ${str(d.state, 'grazing')}`);
    const sec = this.section('State');
    this.bar(sec, 'Fed', 1 - num(d.hunger), 'gn-health');
    this.kv(sec, 'Kept by', num(d.owner, -1) >= 0 ? 'people (domestic)' : 'no one (wild)');
  }
}
