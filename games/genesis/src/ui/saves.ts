// GENESIS — saves (CONTRACT.md §6.6, §16.10; F6 or Ctrl+S, F5 quicksave, F9 quickload): slots kept in the browser
// (IndexedDB) with a picture of the moment, the world's calendar, the names of its worlds, its scenario and seed and the
// content packs it was made with; load, overwrite, delete; export to a file and import one; autosave on a timer (the
// interval is a setting, here and in Settings). The god's own "save" / "load" acts (meta.save / meta.load) land here.
//
// A save needs the packs its world was made with (the sim refuses it without them, in words). A slot keeps those packs'
// JSON beside the bytes, and a file exported from a world with packs is a bundle (.genesis: the packs, then the save) —
// so a save always carries what it needs. A plain save (.gnss) whose packs are nowhere — not in this world, not in the
// slot, not in the mod library — is refused with the packs named and the way to load them. A save that needs a
// different set of packs than this world runs with (one of ours would change what it holds) opens in a fresh simulation
// (the page reloads into it, ?load=<slot>), made with exactly its packs.

import type { ContentPack } from '../sim/content.ts';
import { SAVE_MAJOR, SAVE_MINOR } from '../sim/core/serialize.ts';
import type { UiHost } from './host.ts';
import type { ModLibrary } from './mods.ts';
import { Panel } from './panel.ts';
import { h, clear, download } from './dom.ts';
import { icon } from './icons.ts';

export interface PackRef { id: string; name: string; version: string }

export interface SaveMeta {
  id: string;
  name: string;
  scenario: string;
  seed: number;
  tick: number;
  date: number;
  /** the world the camera was on, and every world of the system */
  world: string;
  worlds: string[];
  /** "Year 3 · day 7 · 14:20" (the world's own calendar) */
  calendar: string;
  /** "312 living · 4 settlements" */
  summary: string;
  thumb: string | null;
  size: number;
  packs: PackRef[];
  auto?: boolean;
}
export interface SaveRecord extends SaveMeta {
  bytes: ArrayBuffer;
  /** the content packs (beyond the base) the world needs, as JSON: a slot always carries what it needs to open */
  packJson?: ContentPack[];
}

const SCENARIO_NAMES: Record<string, string> = {
  barren: 'Barren world', twoworlds: 'Two worlds', 'twoworlds-late': 'Two worlds: the age of rockets', system: 'Living system', sandbox: 'Sandbox', lookdev: 'Lookdev',
};
export function scenarioName(id: string): string { return SCENARIO_NAMES[id] ?? (id.startsWith('custom') ? 'Your own system' : id); }

// ───────────────────────────── the file: header, bundle ─────────────────────────────

export interface SaveHeader {
  scenario: string;
  seed: number;
  tick: number;
  /** pack ids the world was made of (base and runtime included) */
  content: string[];
  packs: PackRef[];
  worlds: string[];
  /** "Year 3 · day 7" from the first world's own calendar */
  calendar: string;
  version: string;
}

/** the header of a save (GNSS) without its bulk arrays; throws a readable error for anything that is not one */
export function readSaveHeader(buf: ArrayBuffer): SaveHeader {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 12) throw new Error('This is not a GENESIS save: the file is too short.');
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic === BUNDLE_MAGIC) return readSaveHeader(unbundle(buf).save);
  if (magic !== 'GNSS') throw new Error('This is not a GENESIS save (it does not begin like one). Saves end in .gnss or .genesis.');
  const dv = new DataView(buf);
  const ver = dv.getUint16(4, true);
  const major = ver >> 8, minor = ver & 255;
  if (major !== SAVE_MAJOR) throw new Error(`This save was written by an incompatible GENESIS (format ${major}.${minor}; this one reads ${SAVE_MAJOR}.x).`);
  if (minor > SAVE_MINOR) throw new Error(`This save was written by a newer GENESIS (format ${major}.${minor}; this one reads up to ${SAVE_MAJOR}.${SAVE_MINOR}). Update the game to open it.`);
  const hlen = dv.getUint32(8, true);
  if (12 + hlen > bytes.length) throw new Error('The save is cut short (its header is incomplete): the file was not copied whole.');
  let j: Record<string, unknown>;
  try { j = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + hlen))) as Record<string, unknown>; } catch { throw new Error('The save is damaged: its header cannot be read.'); }
  const planets = (j.planets as { name?: string; st?: { dayHours?: number; orbit?: { parent?: number; period?: number } } }[] | undefined) ?? [];
  const tick = Number(j.tick) || 0;
  let calendar = '';
  const home = planets.find((p) => (p.st?.orbit?.parent ?? -1) < 0) ?? planets[0];
  if (home?.st?.dayHours) {
    const day = home.st.dayHours * 60;
    const year = Math.max(day, home.st.orbit?.period ?? day * 12);
    calendar = `Year ${Math.floor(tick / year) + 1} · day ${Math.floor((tick % year) / day) + 1}`;
  }
  return {
    scenario: String(j.scenario ?? '?'), seed: Number(j.seed) || 0, tick,
    content: Array.isArray(j.content) ? (j.content as string[]) : ['base'],
    packs: Array.isArray(j.packs) ? (j.packs as PackRef[]) : [],
    worlds: planets.map((p) => p.name ?? '?'),
    calendar, version: `${major}.${minor}`,
  };
}

/** packs a save needs that are not part of the save itself (the base, the god's inventions travel inside it) */
export function neededPacks(h: SaveHeader): string[] {
  return h.content.filter((id) => id !== 'base' && id !== 'runtime' && !id.startsWith('runtime@'));
}

const BUNDLE_MAGIC = 'GNPK';

/** a save with the packs it needs: 'GNPK', u32 JSON length, JSON { format, packs }, padding to 8, then the GNSS bytes */
export function bundle(save: ArrayBuffer, packs: ContentPack[], name: string): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify({ format: 'genesis-bundle', v: 1, name, packs }));
  const start = (8 + json.length + 7) & ~7;
  const out = new Uint8Array(start + save.byteLength);
  out.set([71, 78, 80, 75], 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  out.set(new Uint8Array(save), start);
  return out.buffer;
}

export function unbundle(buf: ArrayBuffer): { save: ArrayBuffer; packs: ContentPack[]; name: string } {
  const b = new Uint8Array(buf);
  const magic = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (magic !== BUNDLE_MAGIC) return { save: buf, packs: [], name: '' };
  const len = new DataView(buf).getUint32(4, true);
  if (8 + len > b.length) throw new Error('The saved world is cut short (its packs are incomplete): the file was not copied whole.');
  let j: { packs?: ContentPack[]; name?: string };
  try { j = JSON.parse(new TextDecoder().decode(b.subarray(8, 8 + len))) as typeof j; } catch { throw new Error('The saved world is damaged: the packs it carries cannot be read.'); }
  const start = (8 + len + 7) & ~7;
  return { save: buf.slice(start), packs: Array.isArray(j.packs) ? j.packs : [], name: j.name ?? '' };
}

/** a storage failure in words */
function storageWords(e: unknown): string {
  const n = (e as { name?: string })?.name ?? '';
  if (n === 'QuotaExceededError') return 'the browser\'s storage for this page is full. Delete an old save, or export this one to a file.';
  if (n === 'InvalidStateError' || n === 'SecurityError') return 'this browser keeps nothing for this page (a private window, or storage is blocked). Export the world to a file instead.';
  return e instanceof Error ? e.message : String(e);
}

// ───────────────────────────── the store (IndexedDB) ─────────────────────────────

const DB = 'genesis-saves';
const STORE = 'saves';

export class SaveStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise((ok, fail) => {
      if (typeof indexedDB === 'undefined') { fail(new Error('this browser keeps no saves here (IndexedDB is not available). Export the world to a file instead.')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error ?? new Error('could not open the save store'));
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
      req.onerror = () => fail(req.error ?? new Error('save store error'));
      t.onabort = () => fail(t.error ?? req.error ?? new Error('the browser refused to keep it'));
    });
  }

  async list(): Promise<SaveMeta[]> {
    // (older slots lack the newer fields: they read as unknown, never as an error)
    const all = await this.tx<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
    return all.map(({ bytes, packJson, ...m }) => ({ ...m, worlds: m.worlds ?? (m.world ? [m.world] : []), calendar: m.calendar ?? '', packs: m.packs ?? (packJson ?? []).map((p) => ({ id: p.id, name: p.name ?? p.id, version: p.version ?? '' })), size: m.size ?? bytes.byteLength }))
      .sort((a, b) => b.date - a.date);
  }
  get(id: string): Promise<SaveRecord | undefined> { return this.tx<SaveRecord | undefined>('readonly', (s) => s.get(id) as IDBRequest<SaveRecord | undefined>); }
  put(r: SaveRecord): Promise<IDBValidKey> { return this.tx('readwrite', (s) => s.put(r)); }
  del(id: string): Promise<undefined> { return this.tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>); }
}

// ───────────────────────────── the panel ─────────────────────────────

export interface LoadOutcome {
  ok: boolean;
  msg?: string;
  /** packs the save needs that are nowhere to be found (named) */
  missing?: PackRef[];
  /** it opens only in a fresh simulation made with exactly its packs */
  reload?: boolean;
}

export interface SavesDeps {
  host: UiHost;
  library: ModLibrary;
  /** the sim's bytes now (null: no living sim) */
  save(): Promise<ArrayBuffer | null>;
  /** open a save in this simulation, the packs it needs sent first (from `packs`, else the library) */
  load(bytes: ArrayBuffer, packs: ContentPack[]): Promise<LoadOutcome>;
  /** a small picture of the view (data URL) */
  thumb(): Promise<string | null>;
  /** the world now (changes when a save is opened) */
  world(): { scenario: string; seed: number };
  /** the packs this world has beyond the base (JSON) */
  packs(): ContentPack[];
  /** open a slot in a fresh simulation (the page reloads) */
  reloadInto(slotId: string): void;
  openMods(): void;
  openNewWorld(): void;
  /** a save was opened (the opening ends, panels close) */
  loaded?(): void;
}

export class Saves {
  readonly panel: Panel;
  private deps: SavesDeps;
  private host: UiHost;
  readonly store = new SaveStore();
  private listEl: HTMLDivElement;
  private nameIn: HTMLInputElement;
  private alertEl: HTMLDivElement;
  private worldEl: HTMLDivElement;
  private autoSel: HTMLSelectElement;
  private autoNote: HTMLSpanElement;
  private lastAuto = performance.now();
  private autoAt = 0;
  private busy = false;
  /** the last outcome (test surface) */
  last: { ok: boolean; msg: string } | null = null;

  constructor(parent: HTMLElement, deps: SavesDeps) {
    this.deps = deps;
    this.host = deps.host;
    this.panel = new Panel(parent, { name: 'saves', title: 'Saves', subtitle: 'keep this moment, or return to one', icon: 'save', place: 'center', veil: true });
    this.nameIn = h('input', { class: 'gn-text', type: 'text', placeholder: 'Name this moment…', spellcheck: 'false', maxlength: '80', aria: { label: 'Name of the save' } }) as HTMLInputElement;
    this.nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') void this.saveNew(); });
    const saveBtn = h('button', { class: 'gn-btn gn-btn-gold', on: { click: () => void this.saveNew() } }, h('span', { html: icon('save') }), 'Save');
    const file = h('input', { type: 'file', accept: '.gnss,.genesis,application/octet-stream', style: 'display:none', aria: { label: 'Import a saved world' } }) as HTMLInputElement;
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void this.importFile(f); file.value = ''; });
    const importBtn = h('button', { class: 'gn-btn', on: { click: () => file.click() } }, h('span', { html: icon('upload') }), 'Import a file');
    this.alertEl = h('div', { class: 'gn-saves-alert', role: 'alert' });
    this.alertEl.hidden = true;
    this.listEl = h('div', { class: 'gn-saves-list' });
    this.autoSel = h('select', { class: 'gn-select gn-saves-autosel', aria: { label: 'Autosave' } }) as HTMLSelectElement;
    for (const [v, l] of [['0', 'Off'], ['5', 'every 5 minutes'], ['10', 'every 10 minutes'], ['20', 'every 20 minutes'], ['30', 'every 30 minutes']]) this.autoSel.append(h('option', { value: v, text: l }));
    this.autoSel.addEventListener('change', () => { this.host.prefs.set('game.autosaveMinutes', Number(this.autoSel.value)); this.lastAuto = performance.now(); this.renderAutoNote(); });
    this.autoSel.addEventListener('keydown', (e) => e.stopPropagation());
    this.autoNote = h('span', { class: 'gn-set-note' });
    this.worldEl = h('div', { class: 'gn-saves-this' });
    this.panel.body.append(
      h('div', { class: 'gn-saves-new' }, this.nameIn, saveBtn, importBtn, file),
      this.alertEl,
      h('div', { class: 'gn-set-h gn-saves-h' }, h('span', { text: 'Kept moments' }), h('span', { class: 'gn-saves-auto' }, h('span', { text: 'Autosave' }), this.autoSel)),
      h('div', { class: 'gn-saves-autonote' }, this.autoNote),
      this.listEl, this.worldEl);
    this.panel.onOpen = () => { this.alertEl.hidden = true; void this.refresh(); };
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  open(): void { this.panel.open(); }
  close(): void { this.panel.close(); }

  /** a problem (or an outcome) shown at the top of the panel, with a way forward when there is one */
  private alert(kind: 'bad' | 'ok', msg: string, act?: { label: string; run(): void }): void {
    clear(this.alertEl);
    this.alertEl.hidden = false;
    this.alertEl.className = `gn-saves-alert gn-saves-${kind}`;
    this.alertEl.append(h('span', { class: 'gn-saves-ai', html: icon(kind === 'bad' ? 'close' : 'check') }), h('span', { class: 'gn-saves-am', text: msg }));
    if (act) this.alertEl.append(h('button', { class: 'gn-btn', text: act.label, on: { click: () => act.run() } }));
  }

  private renderAutoNote(): void {
    const min = this.host.prefs.value.game.autosaveMinutes;
    this.autoSel.value = String(min);
    this.autoNote.textContent = !min ? 'Autosave is off: only what you keep is kept.'
      : this.autoAt ? `Last kept ${Math.max(1, Math.round((Date.now() - this.autoAt) / 60000))} min ago; again in ${Math.max(1, Math.round((min * 60000 - (performance.now() - this.lastAuto)) / 60000))} min.`
        : `The world is kept as “Autosave” ${min === 1 ? 'every minute' : `every ${min} minutes`}, and when you leave it for a new one.`;
  }

  private async refresh(): Promise<void> {
    this.renderAutoNote();
    const w = this.deps.world();
    const pv = this.host.view.planet(this.host.primary());
    clear(this.worldEl);
    this.worldEl.append(h('span', { class: 'gn-set-note', text: `This world: ${pv?.name ?? '—'} · ${scenarioName(w.scenario)} · seed ${w.seed}${this.deps.packs().length ? ` · ${this.deps.packs().length} pack${this.deps.packs().length > 1 ? 's' : ''}` : ''}` }),
      h('button', { class: 'gn-btn', on: { click: () => { this.close(); this.deps.openNewWorld(); } } }, h('span', { html: icon('new-world') }), 'A new world…'));
    clear(this.listEl);
    let list: SaveMeta[] = [];
    try { list = await this.store.list(); } catch (e) { this.listEl.append(h('div', { class: 'gn-set-warn', text: `Saves cannot be listed: ${storageWords(e)}` })); return; }
    if (!list.length) { this.listEl.append(h('div', { class: 'gn-set-note gn-saves-empty', text: `Nothing kept yet. Name this moment and save it — or press ${this.host.keybinds.hint('ui.quicksave') || 'F5'} for a quicksave.` })); return; }
    for (const m of list) this.listEl.append(this.row(m));
  }

  private row(m: SaveMeta): HTMLDivElement {
    const when = new Date(m.date);
    const packs = m.packs.length ? ` · ${m.packs.length === 1 ? `+ ${m.packs[0].name}` : `+ ${m.packs.length} packs`}` : '';
    const del = h('button', { class: 'gn-btn', title: 'Delete', aria: { label: `Delete ${m.name}` }, html: icon('close') });
    const acts = h('div', { class: 'gn-save-acts' },
      h('button', { class: 'gn-btn gn-btn-gold', text: 'Load', on: { click: () => void this.loadSlot(m.id) } }),
      h('button', { class: 'gn-btn', title: 'Keep the world as it is now in this slot', text: 'Overwrite', on: { click: () => void this.saveSlot(m.id, m.name) } }),
      h('button', { class: 'gn-btn', title: 'Export to a file', aria: { label: `Export ${m.name}` }, html: icon('download'), on: { click: () => void this.exportSlot(m.id) } }),
      del);
    del.addEventListener('click', () => {
      // deleting asks once, in place
      const sure = h('span', { class: 'gn-save-sure' }, h('span', { text: 'Delete it?' }),
        h('button', { class: 'gn-btn gn-btn-danger', text: 'Delete', on: { click: () => void this.store.del(m.id).then(() => this.refresh()).catch((e: unknown) => this.alert('bad', `It could not be deleted: ${storageWords(e)}`)) } }),
        h('button', { class: 'gn-btn', text: 'Keep', on: { click: () => sure.replaceWith(acts) } }));
      acts.replaceWith(sure);
    });
    return h('div', { class: `gn-save${m.auto ? ' gn-save-auto' : ''}`, data: { id: m.id } },
      m.thumb ? h('img', { class: 'gn-save-img', src: m.thumb, alt: '' }) : h('div', { class: 'gn-save-img gn-save-noimg', html: icon('world') }),
      h('div', { class: 'gn-save-t' },
        h('div', { class: 'gn-save-name', text: m.name }),
        h('div', { class: 'gn-save-cal', text: [m.world, m.calendar].filter(Boolean).join(' · ') }),
        h('div', { class: 'gn-save-sub', text: `${m.worlds.length > 1 ? `${m.worlds.filter((x) => x !== m.world).join(', ')} · ` : ''}${scenarioName(m.scenario)} · seed ${m.seed}${packs}` }),
        h('div', { class: 'gn-save-sub gn-save-dim', text: `${m.summary ? `${m.summary} · ` : ''}${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${(m.size / 1048576).toFixed(1)} MB` })),
      acts);
  }

  /** what this moment is: the world on screen, its calendar, how many live */
  private describe(): { world: string; worlds: string[]; calendar: string; summary: string } {
    const v = this.host.view;
    const pv = v.planet(this.host.primary());
    let pop = 0, towns = 0;
    for (const p of v.planets) { for (const n of p.population) pop += n; towns += p.settlements.filter((s) => !(s.flags & 2)).length; }
    let calendar = '';
    if (pv) {
      const c = v.calendar(pv);
      const hh = Math.floor(c.hour), mm = Math.floor((c.hour - hh) * 60);
      calendar = `Year ${c.year} · ${c.season.toLowerCase()} · day ${c.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    const parts: string[] = [];
    if (pop) parts.push(`${pop} living`);
    if (towns) parts.push(`${towns} settlement${towns > 1 ? 's' : ''}`);
    return { world: pv?.name ?? '', worlds: v.planets.filter((p) => p.params.kind !== 'moon').map((p) => p.name), calendar, summary: parts.join(' · ') };
  }

  /** keep the world in a slot */
  async saveSlot(id: string, name: string, quiet = false, auto = false): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const bytes = await this.deps.save();
      if (!bytes) { if (!quiet) this.host.toast({ text: 'There is no living world to save here.', kind: 'warn' }); return false; }
      const thumb = await this.deps.thumb().catch(() => null);
      const hdr = readSaveHeader(bytes);
      const need = new Set(neededPacks(hdr));
      const packJson = this.deps.packs().filter((p) => need.has(p.id));
      const w = this.deps.world();
      await this.store.put({ id, name, scenario: hdr.scenario || w.scenario, seed: hdr.seed, tick: hdr.tick, date: Date.now(), ...this.describe(), thumb, size: bytes.byteLength, packs: hdr.packs.filter((p) => need.has(p.id)), packJson, auto, bytes });
      this.last = { ok: true, msg: name };
      if (!quiet) { this.host.toast({ text: `Kept: ${name}.`, kind: 'info' }); this.host.sound('save.kept'); }
      if (this.isOpen) { this.alert('ok', `Kept: ${name}.`); void this.refresh(); }
      return true;
    } catch (e) {
      const msg = `The world could not be kept: ${storageWords(e)}`;
      this.last = { ok: false, msg };
      if (this.isOpen) this.alert('bad', msg, { label: 'Export to a file instead', run: () => void this.exportNow() });
      this.host.toast({ text: msg, kind: 'warn', ms: 9000 });
      return false;
    } finally { this.busy = false; }
  }

  private async saveNew(): Promise<void> {
    const name = this.nameIn.value.trim() || this.describe().calendar || 'A moment';
    this.nameIn.value = '';
    await this.saveSlot(`s${Date.now().toString(36)}`, name);
  }

  async loadSlot(id: string): Promise<boolean> {
    const r = await this.store.get(id).catch((e: unknown) => { this.alert('bad', `The save cannot be read: ${storageWords(e)}`); return undefined; });
    if (!r) { if (this.isOpen && this.alertEl.hidden) this.alert('bad', 'That save is gone.'); return false; }
    return this.loadRecord(r);
  }

  private async loadRecord(r: SaveRecord): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      // read before sending: a damaged or foreign file is refused in words, not by the simulation's stack
      try { readSaveHeader(r.bytes); } catch (e) { this.fail(e instanceof Error ? e.message : String(e)); return false; }
      const res = await this.deps.load(r.bytes.slice(0), r.packJson ?? []);
      if (res.reload) { this.alert('ok', `Opening ${r.name} in a fresh world…`); this.deps.reloadInto(r.id); return true; }
      if (!res.ok) {
        if (res.missing?.length) {
          const names = res.missing.map((p) => `'${p.name}' (${p.id}${p.version ? ` ${p.version}` : ''})`).join(', ');
          this.fail(`This save needs the content pack${res.missing.length > 1 ? 's' : ''} ${names}, which ${res.missing.length > 1 ? 'are' : 'is'} not loaded. Load ${res.missing.length > 1 ? 'them' : 'it'} in Mods, then open the save again.`, { label: 'Open Mods', run: () => { this.close(); this.deps.openMods(); } });
        } else this.fail(`It would not open: ${res.msg ?? 'no reason was given'}`);
        return false;
      }
      this.last = { ok: true, msg: r.name };
      this.host.toast({ text: `Returned to: ${r.name}.`, kind: 'info' });
      this.close();
      this.deps.loaded?.();
      return true;
    } finally { this.busy = false; }
  }

  private fail(msg: string, act?: { label: string; run(): void }): void {
    this.last = { ok: false, msg };
    if (this.isOpen) this.alert('bad', msg, act);
    this.host.toast({ text: msg, kind: 'warn', ms: 10000 });
    this.host.sound('ui.error');
  }

  async quicksave(): Promise<void> { await this.saveSlot('quick', 'Quicksave'); }
  async quickload(): Promise<void> {
    const r = await this.store.get('quick').catch(() => undefined);
    if (!r) { this.host.toast({ text: `No quicksave yet (${this.host.keybinds.hint('ui.quicksave') || 'F5'} makes one).`, kind: 'info' }); return; }
    await this.loadRecord({ ...r, name: 'the quicksave' });
  }

  /** the god's own save / load acts (CommandResult.control from meta.save / meta.load) */
  async control(ctl: Record<string, number>): Promise<void> {
    if (ctl.save) { if (ctl.quick) await this.quicksave(); else await this.saveSlot(`s${Date.now().toString(36)}`, this.describe().calendar || 'A moment'); }
    if (ctl.load) {
      if (ctl.quick) { await this.quickload(); return; }
      const list = await this.store.list().catch(() => [] as SaveMeta[]);
      if (list[0]) await this.loadSlot(list[0].id); else this.host.toast({ text: 'Nothing has been kept to return to.', kind: 'info' });
    }
  }

  private fileName(r: { name: string; world?: string }, ext: string): string {
    const base = `${r.world ? `${r.world} - ` : ''}${r.name}`.replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'genesis';
    return `${base}.${ext}`;
  }

  private async exportSlot(id: string): Promise<void> {
    const r = await this.store.get(id).catch(() => undefined);
    if (!r) { this.alert('bad', 'That save is gone.'); return; }
    const packs = r.packJson ?? [];
    if (packs.length) download(this.fileName(r, 'genesis'), bundle(r.bytes, packs, r.name), 'application/octet-stream');
    else download(this.fileName(r, 'gnss'), r.bytes, 'application/octet-stream');
    this.alert('ok', `Exported ${r.name}${packs.length ? ` with the pack${packs.length > 1 ? 's' : ''} it needs` : ''}.`);
  }

  /** the world as it is now, straight to a file (when the browser keeps nothing) */
  private async exportNow(): Promise<void> {
    const bytes = await this.deps.save().catch(() => null);
    if (!bytes) return;
    const hdr = readSaveHeader(bytes);
    const need = new Set(neededPacks(hdr));
    const packs = this.deps.packs().filter((p) => need.has(p.id));
    const d = this.describe();
    if (packs.length) download(this.fileName({ name: d.calendar, world: d.world }, 'genesis'), bundle(bytes, packs, d.calendar), 'application/octet-stream');
    else download(this.fileName({ name: d.calendar, world: d.world }, 'gnss'), bytes, 'application/octet-stream');
  }

  /** a file from outside: read it, keep it (with the packs it carries), open it */
  async importFile(f: File): Promise<boolean> {
    let buf: ArrayBuffer;
    try { buf = await f.arrayBuffer(); } catch (e) { this.fail(`The file could not be read: ${e instanceof Error ? e.message : String(e)}`); return false; }
    let parts: { save: ArrayBuffer; packs: ContentPack[]; name: string };
    let hdr: SaveHeader;
    try { parts = unbundle(buf); hdr = readSaveHeader(parts.save); } catch (e) { this.fail(`${f.name}: ${e instanceof Error ? e.message : String(e)}`); return false; }
    // the packs it carries join the library (a later save of this world finds them there too)
    for (const p of parts.packs) await this.deps.library.keep(p, 'save').catch(() => null);
    const need = new Set(neededPacks(hdr));
    const name = parts.name || f.name.replace(/\.(gnss|genesis)$/i, '');
    const rec: SaveRecord = {
      id: `s${Date.now().toString(36)}`, name, scenario: hdr.scenario, seed: hdr.seed, tick: hdr.tick, date: Date.now(),
      world: hdr.worlds[0] ?? '', worlds: hdr.worlds, calendar: hdr.calendar, summary: 'imported', thumb: null, size: parts.save.byteLength,
      packs: hdr.packs.filter((p) => need.has(p.id)), packJson: parts.packs.filter((p) => need.has(p.id)), bytes: parts.save,
    };
    // kept before it is opened, so a fresh world can be made for it if this one cannot take it
    await this.store.put(rec).catch(() => null);
    return this.loadRecord(rec);
  }

  /** autosave on its timer (called every frame) */
  frame(): void {
    const min = this.host.prefs.value.game.autosaveMinutes;
    if (!min || this.host.source !== 'worker') return;
    const now = performance.now();
    if (now - this.lastAuto < min * 60000) return;
    this.lastAuto = now;
    void this.autosave();
  }

  /** keep the world as the autosave now (also before leaving it for a new one) */
  async autosave(): Promise<boolean> {
    const ok = await this.saveSlot('auto', 'Autosave', true, true);
    if (ok) { this.autoAt = Date.now(); this.lastAuto = performance.now(); }
    return ok;
  }

  /** test surface */
  async list(): Promise<SaveMeta[]> { return this.store.list(); }
}
