// GENESIS — mods (CONTRACT.md §9: "content is data, mod packs share the schema"; F8): content packs — new peoples,
// recipes, plants, beasts, disasters, worlds, stars — loaded from a JSON file, from an address (?mod=<url> at boot, or
// the panel's field), or from the bundled examples (mods/*.json). Every pack is checked here before it goes anywhere
// (the same loader the sim uses: every problem listed in words, with "did you mean"), then sent to the living world:
// a pack of only new things joins it at once; one that changes what the world already has waits for the next world.
// Packs are kept in a library in the browser (IndexedDB) so the next world (New world, F3) can include them and a save
// that needs one can find it.

import type { CommandResult } from '../sim/types.ts';
import type { ContentPack } from '../sim/content.ts';
import { loadContent, ContentError, RUNTIME_PACK } from '../sim/content.ts';
import { BASE_PACK } from '../data/index.ts';
import type { UiHost } from './host.ts';
import { Panel, toggle } from './panel.ts';
import { h, clear, download } from './dom.ts';
import { icon } from './icons.ts';

export interface PackEntry {
  id: string;
  name: string;
  version: string;
  /** "1 species, 4 recipes" */
  summary: string;
  /** where it came from: a file, an address, the bundled examples, a save that carried it */
  source: 'file' | 'url' | 'example' | 'save';
  url?: string;
  addedAt: number;
  /** offered ticked in the New world menu */
  include: boolean;
  json: ContentPack;
}

/** sections a pack may carry (content.ts KNOWN), for the summary line */
const SECTION_WORDS: Record<string, [string, string]> = {
  species: ['people', 'peoples'], items: ['item', 'items'], recipes: ['recipe', 'recipes'], buildings: ['building', 'buildings'],
  plants: ['plant', 'plants'], animals: ['beast', 'beasts'], diseases: ['sickness', 'sicknesses'], disasters: ['disaster', 'disasters'],
  powers: ['power', 'powers'], weather: ['weather kind', 'weather kinds'], biomes: ['biome', 'biomes'], stars: ['star', 'stars'],
  planetkinds: ['kind of world', 'kinds of world'], scenarios: ['scenario', 'scenarios'], materials: ['material', 'materials'],
  creatures: ['creature', 'creatures'], events: ['chronicle line', 'chronicle lines'], phonologies: ['tongue', 'tongues'], names: ['tongue', 'tongues'],
  ships: ['ship', 'ships'], ores: ['ore', 'ores'],
};

export function packSummary(p: ContentPack): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (!Array.isArray(v) || !v.length || k.startsWith('$')) continue;
    const w = SECTION_WORDS[k] ?? [k, k];
    parts.push(`${v.length} ${v.length === 1 ? w[0] : w[1]}`);
  }
  if (p.lexicon && typeof p.lexicon === 'object') parts.push('words');
  return parts.join(', ') || 'nothing yet';
}

const ID_RX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** a pack from text, or the reason it is not one (in words: where the JSON broke, what is missing) */
export function parsePack(text: string, origin = 'the file'): { pack: ContentPack } | { error: string } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    // "Unexpected token } in JSON at position 812" → line and column
    const pos = /position (\d+)/.exec(m);
    let where = '';
    if (pos) {
      const at = Number(pos[1]);
      const before = text.slice(0, at);
      const line = before.split('\n').length;
      where = ` (line ${line}, column ${at - before.lastIndexOf('\n')})`;
    }
    return { error: `${cap1(origin)} is not valid JSON${where}: ${m.replace(/^JSON\.parse: /, '')}` };
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { error: `${cap1(origin)} is JSON, but not a content pack: a pack is one object with an "id" and sections like "species", "items" or "disasters".` };
  const pk = j as ContentPack;
  if (typeof pk.id !== 'string' || !pk.id.trim()) return { error: `This pack has no "id": give it a short name, like "id": "my-pack".` };
  if (!ID_RX.test(pk.id)) return { error: `The pack's id '${pk.id}' should be a short name of letters, digits, dots, dashes or underscores.` };
  if (pk.id === 'base' || pk.id === RUNTIME_PACK || pk.id.startsWith(`${RUNTIME_PACK}@`)) return { error: `The id '${pk.id}' belongs to the game itself: choose another.` };
  const any = Object.entries(pk).some(([k, v]) => !k.startsWith('$') && (Array.isArray(v) ? v.length > 0 : k === 'lexicon' && !!v));
  if (!any) return { error: `The pack '${pk.id}' holds nothing: add sections like "species", "items", "recipes" or "disasters".` };
  return { pack: pk };
}

function cap1(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/** check packs on top of the base content the way the sim will: null when they load, else every problem in words */
export function validatePacks(packs: ContentPack[]): { msg: string; problems: string[] } | null {
  try {
    loadContent([BASE_PACK, ...packs]);
    return null;
  } catch (e) {
    if (e instanceof ContentError) return { msg: e.problems.length === 1 ? e.problems[0] : `${e.problems.length} problems`, problems: e.problems };
    return { msg: e instanceof Error ? e.message : String(e), problems: [] };
  }
}

/** fetch a pack from an address (readable failures: unreachable, not found, not JSON) */
export async function fetchPack(url: string, timeoutMs = 15000): Promise<{ pack: ContentPack } | { error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { error: /timed? ?out|abort/i.test(m) ? `${url} did not answer within ${Math.round(timeoutMs / 1000)} s.` : `Could not reach ${url} (${m}). An address on another site must allow this page to read it (CORS).` };
  }
  if (!res.ok) return { error: `${url} answered ${res.status} ${res.statusText || ''}`.trim() + '.' };
  const text = await res.text();
  return parsePack(text, url);
}

// ───────────────────────────── the library (IndexedDB) ─────────────────────────────

const DB = 'genesis-mods';
const STORE = 'packs';

export class ModLibrary {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise((ok, fail) => {
      if (typeof indexedDB === 'undefined') { fail(new Error('This browser keeps no mods (IndexedDB is not available).')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error ?? new Error('could not open the mod library'));
    });
    this.db.catch(() => { this.db = null; });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((ok, fail) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error ?? new Error('mod library error'));
    });
  }

  async list(): Promise<PackEntry[]> {
    const all = await this.tx<PackEntry[]>('readonly', (s) => s.getAll() as IDBRequest<PackEntry[]>);
    return all.sort((a, b) => b.addedAt - a.addedAt);
  }
  get(id: string): Promise<PackEntry | undefined> { return this.tx<PackEntry | undefined>('readonly', (s) => s.get(id) as IDBRequest<PackEntry | undefined>); }
  put(e: PackEntry): Promise<IDBValidKey> { return this.tx('readwrite', (s) => s.put(e)); }
  del(id: string): Promise<undefined> { return this.tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>); }

  /** keep a pack (an existing entry keeps its "include" choice unless one is given) */
  async keep(pack: ContentPack, source: PackEntry['source'], o: { url?: string; include?: boolean } = {}): Promise<PackEntry> {
    const old = await this.get(pack.id).catch(() => undefined);
    const e: PackEntry = {
      id: pack.id, name: pack.name ?? pack.id, version: pack.version ?? '', summary: packSummary(pack), source: old?.source === 'file' || old?.source === 'url' ? old.source : source,
      url: o.url ?? old?.url, addedAt: Date.now(), include: o.include ?? old?.include ?? false, json: pack,
    };
    await this.put(e);
    return e;
  }
}

/** the example packs shipped with the game (mods/*.json), loaded on demand */
export function examplePacks(): Record<string, () => Promise<string>> {
  try {
    return import.meta.glob<string>('../../mods/*.json', { query: '?raw', import: 'default' });
  } catch {
    return {};
  }
}

// ───────────────────────────── boot: ?mods=<library ids> and ?mod=<url> ─────────────────────────────

export interface BootProblem { what: string; msg: string; problems: string[] }

/**
 * The packs a new world is made from: library packs named by id (the New world menu's ticks) and packs at addresses
 * (?mod=). Each is checked in order on top of those before it; one that fails is left out and said why.
 */
export async function bootPacks(ids: string[], urls: string[], lib: ModLibrary): Promise<{ packs: ContentPack[]; problems: BootProblem[]; notes: string[] }> {
  const packs: ContentPack[] = [];
  const problems: BootProblem[] = [];
  const notes: string[] = [];
  const add = (pk: ContentPack, what: string): boolean => {
    if (packs.some((p) => p.id === pk.id)) return true;
    const bad = validatePacks([...packs, pk]);
    if (bad) { problems.push({ what, msg: bad.msg, problems: bad.problems }); return false; }
    packs.push(pk);
    return true;
  };
  for (const id of ids) {
    const e = await lib.get(id).catch(() => undefined);
    if (!e) { problems.push({ what: `the pack '${id}'`, msg: `It is not in your mod library any more (F8 to load it again).`, problems: [] }); continue; }
    add(e.json, `'${e.name}'`);
  }
  for (const url of urls) {
    const r = await fetchPack(url);
    if ('error' in r) { problems.push({ what: url, msg: r.error, problems: [] }); continue; }
    if (add(r.pack, `'${r.pack.name ?? r.pack.id}' (${url})`)) {
      notes.push(`Mod '${r.pack.name ?? r.pack.id}' loaded from ${url}.`);
      void lib.keep(r.pack, 'url', { url }).catch(() => { /* kept for this world only */ });
    }
  }
  return { packs, problems, notes };
}

// ───────────────────────────── the panel ─────────────────────────────

export interface ModsDeps {
  host: UiHost;
  library: ModLibrary;
  /** the packs the living world was made with or took since (beyond the base) */
  packs(): ContentPack[];
  /** send a pack to the living world (App: worker 'mod'); the result says added, deferred or refused */
  addToWorld(pack: ContentPack): Promise<CommandResult>;
  /** problems with the packs this world was asked to begin with */
  bootProblems(): BootProblem[];
  openNewWorld(): void;
}

export class Mods {
  readonly panel: Panel;
  private deps: ModsDeps;
  private host: UiHost;
  private status: HTMLDivElement;
  private worldEl: HTMLDivElement;
  private libEl: HTMLDivElement;
  private exEl: HTMLDivElement;
  private urlIn: HTMLInputElement;
  private file: HTMLInputElement;
  private busy = false;
  /** the last outcome (test surface) */
  last: { ok: boolean; deferred?: boolean; msg: string; problems: string[] } | null = null;

  constructor(parent: HTMLElement, deps: ModsDeps) {
    this.deps = deps;
    this.host = deps.host;
    this.panel = new Panel(parent, { name: 'mods', title: 'Mods', subtitle: 'new peoples, recipes, beasts and disasters — all of it data', icon: 'mods', place: 'center', veil: true });
    this.file = h('input', { type: 'file', accept: '.json,application/json', multiple: true, style: 'display:none' }) as HTMLInputElement;
    this.file.addEventListener('change', () => { const fs = Array.from(this.file.files ?? []); this.file.value = ''; void this.fromFiles(fs); });
    this.urlIn = h('input', { class: 'gn-text gn-mods-url', type: 'url', placeholder: 'https://… a pack\'s address (.json)', spellcheck: 'false' }) as HTMLInputElement;
    this.urlIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') void this.fromUrl(); });
    const fileBtn = h('button', { class: 'gn-btn gn-btn-gold', on: { click: () => this.file.click() } }, h('span', { html: icon('upload') }), 'Choose a file');
    const urlBtn = h('button', { class: 'gn-btn', text: 'Load', on: { click: () => void this.fromUrl() } });
    this.status = h('div', { class: 'gn-mods-status', role: 'status', aria: { live: 'polite' } });
    this.status.hidden = true;
    this.worldEl = h('div', { class: 'gn-mods-list' });
    this.libEl = h('div', { class: 'gn-mods-list' });
    this.exEl = h('div', { class: 'gn-mods-list' });
    const drop = h('div', { class: 'gn-mods-drop' },
      h('div', { class: 'gn-mods-add' }, fileBtn, h('span', { class: 'gn-mods-or', text: 'or' }), this.urlIn, urlBtn, this.file),
      h('div', { class: 'gn-set-note', text: 'Or drop a pack\'s .json file here. A pack of only new things joins this world at once; one that changes what the world already has waits for the next world.' }));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('gn-drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('gn-drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('gn-drag');
      const fs = Array.from(e.dataTransfer?.files ?? []);
      if (fs.length) void this.fromFiles(fs);
    });
    const nw = h('button', { class: 'gn-btn', on: { click: () => { this.close(); deps.openNewWorld(); } } }, h('span', { html: icon('new-world') }), 'A new world with them…');
    this.panel.body.append(
      h('div', { class: 'gn-set-h', text: 'Add a pack' }), drop, this.status,
      h('div', { class: 'gn-set-h', text: 'In this world' }), this.worldEl,
      h('div', { class: 'gn-set-h gn-mods-h' }, h('span', { text: 'Your library' }), nw), this.libEl,
      h('div', { class: 'gn-set-h', text: 'Examples' }), this.exEl);
    this.panel.onOpen = () => void this.refresh();
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  open(): void { this.panel.open(); }
  close(): void { this.panel.close(); }

  /** show an outcome: what happened, in words, with every problem listed */
  private say(kind: 'ok' | 'wait' | 'bad', msg: string, problems: string[] = []): void {
    clear(this.status);
    this.status.hidden = false;
    this.status.className = `gn-mods-status gn-mods-${kind}`;
    this.status.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    this.status.append(h('div', { class: 'gn-mods-msg' }, h('span', { html: icon(kind === 'ok' ? 'check' : kind === 'wait' ? 'hourglass' : 'close') }), h('span', { text: msg })));
    if (problems.length) {
      const ul = h('ul', { class: 'gn-mods-probs' });
      for (const p of problems.slice(0, 14)) ul.append(h('li', { text: p.replace(/^[^›]*›\s*/, '') }));
      if (problems.length > 14) ul.append(h('li', { class: 'gn-mods-more', text: `…and ${problems.length - 14} more` }));
      this.status.append(ul);
    }
  }

  private async fromFiles(files: File[]): Promise<void> {
    for (const f of files) {
      const text = await f.text().catch(() => '');
      await this.take(text, `the file ${f.name}`, 'file');
    }
  }

  private async fromUrl(): Promise<void> {
    const url = this.urlIn.value.trim();
    if (!url) { this.say('bad', 'Type the address of a pack first (it ends in .json).'); return; }
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/') && !url.startsWith('./')) { this.say('bad', `'${url}' is not an address: it should begin with https://`); return; }
    this.say('wait', `Fetching ${url}…`);
    const r = await fetchPack(url);
    if ('error' in r) { this.say('bad', r.error); this.last = { ok: false, msg: r.error, problems: [] }; return; }
    await this.add(r.pack, 'url', url);
  }

  /** a pack's text from anywhere: parse, check, keep, send */
  async take(text: string, origin: string, source: PackEntry['source']): Promise<boolean> {
    const r = parsePack(text, origin);
    if ('error' in r) { this.say('bad', r.error); this.last = { ok: false, msg: r.error, problems: [] }; this.host.sound('ui.error'); return false; }
    return this.add(r.pack, source);
  }

  private async add(pack: ContentPack, source: PackEntry['source'], url?: string): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const name = pack.name ?? pack.id;
      // checked against what this world already has (the base and its packs), the sim's own loader
      const others = this.deps.packs().filter((p) => p.id !== pack.id);
      const bad = validatePacks([...others, pack]);
      if (bad) {
        const msg = `'${name}' has ${bad.problems.length > 1 ? `${bad.problems.length} problems` : 'a problem'} and was not loaded:`;
        this.say('bad', bad.problems.length ? msg : `'${name}' was not loaded: ${bad.msg}`, bad.problems);
        this.last = { ok: false, msg: bad.msg, problems: bad.problems };
        this.host.sound('ui.error');
        return false;
      }
      await this.deps.library.keep(pack, source, { url }).catch(() => null);
      if (this.host.source !== 'worker') {
        this.say('wait', `'${name}' is in your library: this lookdev world takes no mods, the next living world can.`);
        this.last = { ok: false, deferred: true, msg: 'lookdev', problems: [] };
        void this.refresh();
        return true;
      }
      const res = await this.deps.addToWorld(pack);
      if (res.ok) {
        this.say('ok', res.msg ?? `'${name}' is part of this world now.`);
        this.host.sound('ui.confirm');
      } else if (res.deferred) {
        await this.deps.library.keep(pack, source, { url, include: true }).catch(() => null);
        this.say('wait', `${res.msg ?? `'${name}' changes what this world already has.`} It is ticked for your next world (New world, ${this.host.keybinds.hint('ui.newWorld') || 'F3'}).`);
      } else {
        const probs = (res.msg ?? '').split('\n').map((s) => s.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
        this.say('bad', probs.length > 1 ? `'${name}' was refused:` : `'${name}' was refused: ${res.msg ?? 'no reason given'}`, probs.length > 1 ? probs.slice(1) : []);
        this.host.sound('ui.error');
      }
      this.last = { ok: res.ok, deferred: res.deferred, msg: res.msg ?? '', problems: [] };
      void this.refresh();
      return res.ok;
    } finally { this.busy = false; }
  }

  private async refresh(): Promise<void> {
    // in this world
    clear(this.worldEl);
    const ids = this.host.view.content.filter((id) => id !== 'base' && id !== RUNTIME_PACK && !id.startsWith(`${RUNTIME_PACK}@`));
    const known = new Map(this.deps.packs().map((p) => [p.id, p]));
    if (!ids.length) this.worldEl.append(h('div', { class: 'gn-set-note', text: 'This world is made of the base content only.' }));
    for (const id of ids) {
      const p = known.get(id);
      this.worldEl.append(h('div', { class: 'gn-mod' },
        h('span', { class: 'gn-mod-i', html: icon('mods') }),
        h('div', { class: 'gn-mod-t' }, h('div', { class: 'gn-mod-name', text: p?.name ?? id }), h('div', { class: 'gn-mod-sub', text: `${id}${p?.version ? ` · ${p.version}` : ''}${p ? ` · ${packSummary(p)}` : ''}` }))));
    }
    for (const b of this.deps.bootProblems()) {
      this.worldEl.append(h('div', { class: 'gn-mod gn-mod-bad' },
        h('span', { class: 'gn-mod-i', html: icon('close') }),
        h('div', { class: 'gn-mod-t' }, h('div', { class: 'gn-mod-name', text: `Left out: ${b.what}` }), h('div', { class: 'gn-mod-sub', text: b.problems.length ? `${b.msg}: ${b.problems.slice(0, 3).join('; ')}${b.problems.length > 3 ? '…' : ''}` : b.msg }))));
    }
    // the library
    clear(this.libEl);
    let lib: PackEntry[] = [];
    try { lib = await this.deps.library.list(); } catch (e) { this.libEl.append(h('div', { class: 'gn-set-warn', text: e instanceof Error ? e.message : String(e) })); }
    if (!lib.length) this.libEl.append(h('div', { class: 'gn-set-note', text: 'Nothing here yet: packs you load are kept here for your next worlds.' }));
    for (const e of lib) {
      const inWorld = ids.includes(e.id);
      const row = h('div', { class: 'gn-mod' },
        h('span', { class: 'gn-mod-i', html: icon('mods') }),
        h('div', { class: 'gn-mod-t' }, h('div', { class: 'gn-mod-name', text: e.name }),
          h('div', { class: 'gn-mod-sub', text: `${e.id}${e.version ? ` · ${e.version}` : ''} · ${e.summary}${e.source === 'url' && e.url ? ` · from ${e.url}` : e.source === 'example' ? ' · an example' : e.source === 'save' ? ' · came with a save' : ''}` })),
        h('div', { class: 'gn-mod-acts' },
          h('div', { class: 'gn-mod-inc', title: 'Ticked in the New world menu' }, toggle(e.include, (on) => { e.include = on; void this.deps.library.put(e); }, `Include ${e.name} in new worlds`), h('span', { text: 'new worlds' })),
          inWorld ? h('span', { class: 'gn-mod-in', text: 'in this world' }) : h('button', { class: 'gn-btn', text: 'Add to this world', on: { click: () => void this.add(e.json, e.source) } }),
          h('button', { class: 'gn-btn', title: 'Download the pack (JSON)', html: icon('download'), on: { click: () => download(`${e.id}.json`, JSON.stringify(e.json, null, 1), 'application/json') } }),
          h('button', { class: 'gn-btn', title: 'Remove from the library (a world that has it keeps it)', html: icon('close'), on: { click: () => void this.deps.library.del(e.id).then(() => this.refresh()) } })));
      this.libEl.append(row);
    }
    // the examples
    clear(this.exEl);
    const ex = examplePacks();
    const names = Object.keys(ex).sort();
    if (!names.length) this.exEl.append(h('div', { class: 'gn-set-note', text: 'No examples in this build.' }));
    for (const path of names) {
      const file = path.split('/').pop() ?? path;
      const row = h('div', { class: 'gn-mod' }, h('span', { class: 'gn-mod-i', html: icon('scroll') }),
        h('div', { class: 'gn-mod-t' }, h('div', { class: 'gn-mod-name', text: file.replace(/\.json$/, '').replace(/[-_]/g, ' ') }), h('div', { class: 'gn-mod-sub', text: file })));
      const btn = h('button', { class: 'gn-btn', text: 'Load', on: { click: () => void ex[path]().then((t) => this.take(t, file, 'example')) } });
      row.append(h('div', { class: 'gn-mod-acts' }, btn));
      this.exEl.append(row);
      // the example's own name and contents, once read
      void ex[path]().then((t) => {
        const r = parsePack(t, file);
        if ('error' in r) return;
        (row.querySelector('.gn-mod-name') as HTMLElement).textContent = r.pack.name ?? r.pack.id;
        (row.querySelector('.gn-mod-sub') as HTMLElement).textContent = `${r.pack.id} · ${packSummary(r.pack)}`;
        if (ids.includes(r.pack.id)) btn.replaceWith(h('span', { class: 'gn-mod-in', text: 'in this world' }));
      }).catch(() => { /* the row stays as the file name */ });
    }
  }
}
