// GENESIS — the chronicle (CONTRACT.md §16.7, §13; C): the whole history of the worlds as the sim wrote it, filterable
// by world, kind and importance, searchable, newest or oldest first, and exportable as Markdown, HTML or plain text.
// An entry that names a settlement or a person is a link: click it to fly there. New entries arrive live while the
// panel is open. The full history comes from the sim (query 'chronicle'); the mirror keeps the newest in between.

import type { ChronicleEntry, EntityRef } from '../sim/types.ts';
import type { UiHost } from './host.ts';
import { Panel, segmented } from './panel.ts';
import { h, clear, download, escapeHtml } from './dom.ts';
import { icon } from './icons.ts';

const KIND_ICON: Record<string, string> = {
  discovery: 'idea', loss: 'forget', founding: 'found', split: 'split', fall: 'raze', war: 'swords', treaty: 'dove', disaster: 'd-meteor',
  extinction: 'skull-paw', speciation: 'paw', plague: 'germ', 'golden-age': 'star', 'dark-age': 'moon', diaspora: 'strangers', contact: 'strangers',
  orbit: 'w-rocket', god: 'cast', world: 'world', nature: 'sprout', ecology: 'paw', era: 'book', people: 'people', culture: 'scroll', polity: 'sign',
  trade: 'gift', gift: 'gift', crime: 'strike', hardship: 'cold', death: 'death', birth: 'heart', space: 'w-rocket', milestone: 'star',
};

const WEIGHTS = [
  { value: '0', label: 'All', title: 'every entry' },
  { value: '1', label: 'Notable', title: 'importance 1 and up' },
  { value: '2', label: 'Major', title: 'importance 2 and up' },
  { value: '3', label: 'Era-defining', title: 'only importance 3' },
];

export class Chronicle {
  readonly panel: Panel;
  private host: UiHost;
  private entries: ChronicleEntry[] = [];
  private mirrorSeen = 0;
  private search: HTMLInputElement;
  private planetBar: HTMLDivElement;
  private kindBar: HTMLDivElement;
  private listEl: HTMLDivElement;
  private countEl: HTMLSpanElement;
  private planet = -1;
  private kinds = new Set<string>();
  private minWeight = 0;
  private newestFirst = true;
  private limit = 400;
  private dirty = true;
  private lastRender = 0;

  constructor(parent: HTMLElement, host: UiHost) {
    this.host = host;
    this.panel = new Panel(parent, { name: 'chron', title: 'Chronicle', subtitle: 'what the worlds remember', icon: 'chronicle', place: 'left' });
    this.search = h('input', { class: 'gn-text gn-chron-search', type: 'search', placeholder: 'Search the chronicle…', spellcheck: 'false' }) as HTMLInputElement;
    this.search.addEventListener('input', () => { this.limit = 400; this.dirty = true; });
    this.search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.panel.close(); });
    this.planetBar = h('div', { class: 'gn-chron-chips' });
    this.kindBar = h('div', { class: 'gn-chron-chips gn-chron-kinds' });
    this.listEl = h('div', { class: 'gn-chron-list' });
    this.countEl = h('span', { class: 'gn-chron-count' });
    const order = segmented([{ value: 'new', label: 'Newest first' }, { value: 'old', label: 'Oldest first' }], 'new', (v) => { this.newestFirst = v === 'new'; this.dirty = true; });
    const weight = segmented(WEIGHTS, '0', (v) => { this.minWeight = Number(v); this.dirty = true; });
    const ex = (fmt: 'md' | 'html' | 'txt', label: string, short: string) => h('button', { class: 'gn-btn gn-chron-ex', title: `Export as ${label}`, aria: { label: `Export as ${label}` }, on: { click: () => this.export(fmt) } }, short);
    this.panel.tools.append(h('span', { class: 'gn-chron-exl', html: icon('download'), title: 'Export the chronicle' }), ex('md', 'Markdown', 'MD'), ex('html', 'HTML', 'HTML'), ex('txt', 'plain text', 'TXT'));
    this.panel.body.append(
      h('div', { class: 'gn-chron-filters' }, this.search, this.planetBar, h('div', { class: 'gn-chron-row' }, weight, order), this.kindBar, this.countEl),
      this.listEl);
    this.panel.onOpen = () => { this.fetch(); this.dirty = true; };
  }

  get isOpen(): boolean { return this.panel.isOpen; }

  open(): void { this.panel.open(); }
  close(): void { this.panel.close(); }
  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

  /** the whole history from the sim (the mirror only keeps the newest) */
  private fetch(): void {
    const mirror = this.host.view.chronicle;
    this.entries = mirror.slice();
    this.mirrorSeen = mirror.length;
    if (this.host.source !== 'worker') return;
    void this.host.query('chronicle').then((d) => {
      if (!Array.isArray(d)) return;
      const all = d as ChronicleEntry[];
      // keep anything the mirror has that arrived after the answer was made
      const lastTick = all.length ? all[all.length - 1].tick : -1;
      const extra = this.host.view.chronicle.filter((e) => e.tick > lastTick);
      this.entries = [...all, ...extra];
      this.mirrorSeen = this.host.view.chronicle.length;
      this.dirty = true;
    });
  }

  /** per frame while open: take new entries from the mirror, re-render when something changed (throttled) */
  frame(): void {
    if (!this.isOpen) return;
    const m = this.host.view.chronicle;
    if (m.length < this.mirrorSeen) this.mirrorSeen = m.length;
    if (m.length > this.mirrorSeen) {
      for (let i = this.mirrorSeen; i < m.length; i++) this.entries.push(m[i]);
      this.mirrorSeen = m.length;
      this.dirty = true;
    }
    const now = performance.now();
    if (this.dirty && now - this.lastRender > 250) { this.dirty = false; this.lastRender = now; this.render(); }
  }

  private filtered(): ChronicleEntry[] {
    const q = this.search.value.trim().toLowerCase();
    const words = q ? q.split(/\s+/) : [];
    return this.entries.filter((e) =>
      (this.planet < 0 || e.planet === this.planet) && e.weight >= this.minWeight && (!this.kinds.size || this.kinds.has(e.kind)) &&
      (!words.length || words.every((w) => e.text.toLowerCase().includes(w) || e.kind.includes(w))));
  }

  private render(): void {
    // world chips
    clear(this.planetBar);
    const worlds = new Map<number, number>();
    for (const e of this.entries) worlds.set(e.planet, (worlds.get(e.planet) ?? 0) + 1);
    const chip = (label: string, on: boolean, click: () => void, n?: number) => {
      const b = h('button', { class: `gn-chip-btn${on ? ' gn-on' : ''}` }, label, n !== undefined ? h('small', { text: String(n) }) : null);
      b.addEventListener('click', click);
      return b;
    };
    this.planetBar.append(chip('All worlds', this.planet < 0, () => { this.planet = -1; this.dirty = true; }, this.entries.length));
    for (const [pid, n] of [...worlds.entries()].sort((a, b) => a[0] - b[0])) {
      const name = this.host.view.planet(pid)?.name ?? `world ${pid}`;
      this.planetBar.append(chip(name, this.planet === pid, () => { this.planet = this.planet === pid ? -1 : pid; this.dirty = true; }, n));
    }
    // kind chips
    clear(this.kindBar);
    const kinds = new Map<string, number>();
    for (const e of this.entries) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    for (const [k, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
      const b = h('button', { class: `gn-chip-btn gn-chron-k${this.kinds.has(k) ? ' gn-on' : ''}`, title: `${n} ${k}` }, h('span', { html: icon(KIND_ICON[k] ?? 'scroll') }), k.replace(/-/g, ' '));
      b.addEventListener('click', () => { if (this.kinds.has(k)) this.kinds.delete(k); else this.kinds.add(k); this.dirty = true; });
      this.kindBar.append(b);
    }
    const list = this.filtered();
    this.countEl.textContent = `${list.length} of ${this.entries.length} entries`;
    const shown = this.newestFirst ? list.slice(-this.limit).reverse() : list.slice(0, this.limit);
    const scroll = this.listEl.scrollTop;
    clear(this.listEl);
    if (!shown.length) this.listEl.append(h('div', { class: 'gn-chron-empty', text: this.entries.length ? 'Nothing matches.' : 'Nothing has happened yet that anyone remembers.' }));
    let lastKey = '';
    for (const e of shown) {
      const key = `${e.planet}:${e.year}`;
      if (key !== lastKey) {
        lastKey = key;
        const w = this.host.view.planet(e.planet)?.name;
        this.listEl.append(h('div', { class: 'gn-chron-year' }, h('span', { text: `Year ${e.year}` }), w && worlds.size > 1 ? h('small', { text: w }) : null));
      }
      const place = this.placeOf(e);
      const row = h(place ? 'button' : 'div', { class: `gn-chron-e gn-w${e.weight}`, title: place ? 'Look there' : undefined },
        h('span', { class: 'gn-chron-d', text: `day ${e.day}` }),
        h('span', { class: 'gn-chron-i', html: icon(KIND_ICON[e.kind] ?? 'scroll') }),
        h('span', { class: 'gn-chron-t', text: bodyOf(e.text) }));
      if (place) row.addEventListener('click', () => this.host.lookAtEntity(place));
      this.listEl.append(row);
    }
    if (list.length > shown.length) {
      const more = h('button', { class: 'gn-btn gn-chron-more', text: `Show ${Math.min(400, list.length - shown.length)} more` });
      more.addEventListener('click', () => { this.limit += 400; this.dirty = true; });
      this.listEl.append(more);
    }
    this.listEl.scrollTop = scroll;
  }

  private placeOf(e: ChronicleEntry): EntityRef | null {
    for (const r of e.refs ?? []) {
      if (r.kind === 'settlement' || r.kind === 'agent' || r.kind === 'disaster' || r.kind === 'creature' || r.kind === 'ship') return { ...r, planet: r.planet ?? e.planet };
    }
    return null;
  }

  /** export what is shown (the filters apply), oldest first, as a document */
  export(fmt: 'md' | 'html' | 'txt'): string {
    const list = this.filtered();
    const worlds = [...new Set(list.map((e) => e.planet))].map((p) => this.host.view.planet(p)?.name ?? `world ${p}`);
    const title = `The Chronicle of ${worlds.length === 1 ? worlds[0] : worlds.length ? worlds.join(', ') : 'the worlds'}`;
    const multi = worlds.length > 1;
    let out = '';
    let last = '';
    if (fmt === 'md') {
      out = `# ${title}\n\n_${list.length} entries, as the worlds remember them._\n`;
      for (const e of list) {
        const k = `${e.planet}:${e.year}`;
        if (k !== last) { last = k; out += `\n## Year ${e.year}${multi ? ` — ${this.host.view.planet(e.planet)?.name ?? ''}` : ''}\n\n`; }
        out += `- *Day ${e.day}* — ${e.weight >= 3 ? `**${bodyOf(e.text)}**` : bodyOf(e.text)}\n`;
      }
    } else if (fmt === 'txt') {
      out = `${title.toUpperCase()}\n${'='.repeat(title.length)}\n\n`;
      for (const e of list) out += `[${multi ? `${this.host.view.planet(e.planet)?.name ?? ''} · ` : ''}Year ${e.year}, day ${e.day}] ${bodyOf(e.text)}\n`;
    } else {
      out = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{background:#0b0e16;color:#efe7d6;font:17px/1.6 'Cormorant Garamond',Georgia,serif;max-width:46em;margin:3em auto;padding:0 1.5em}
h1{font-weight:500;letter-spacing:.12em;color:#f3dfae;text-transform:uppercase;font-size:1.8em;border-bottom:1px solid rgba(217,184,120,.4);padding-bottom:.4em}
h2{font-weight:500;color:#d9b878;letter-spacing:.08em;margin:1.8em 0 .4em;font-size:1.2em}
p{margin:.25em 0}.d{font:12px Inter,system-ui,sans-serif;color:#9c968a;letter-spacing:.06em;display:inline-block;width:5.5em}.w3{color:#fff6dc;font-weight:600}
</style></head><body><h1>${escapeHtml(title)}</h1>`;
      for (const e of list) {
        const k = `${e.planet}:${e.year}`;
        if (k !== last) { last = k; out += `<h2>Year ${e.year}${multi ? ` — ${escapeHtml(this.host.view.planet(e.planet)?.name ?? '')}` : ''}</h2>`; }
        out += `<p class="w${e.weight}"><span class="d">day ${e.day}</span>${escapeHtml(bodyOf(e.text))}</p>`;
      }
      out += '</body></html>';
    }
    const base = (worlds[0] ?? 'genesis').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    download(`chronicle-${base}.${fmt === 'md' ? 'md' : fmt}`, out, fmt === 'html' ? 'text/html' : fmt === 'md' ? 'text/markdown' : 'text/plain');
    return out;
  }

  /** test surface */
  state(): { open: boolean; entries: number; shown: number } {
    return { open: this.isOpen, entries: this.entries.length, shown: this.listEl.querySelectorAll('.gn-chron-e').length };
  }

  setSearch(q: string): void { this.search.value = q; this.dirty = true; }
}

/** an entry's words without the "Year 12." the sim starts it with (the list and the exports group by year already) */
function bodyOf(text: string): string {
  return text.replace(/^Year \d+[.,:]\s*/, '');
}
