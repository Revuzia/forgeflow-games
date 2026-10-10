// GENESIS — saves and worlds (CONTRACT.md §16.10; F6 or Ctrl+S, F5 quicksave, F9 quickload): save slots kept in the
// browser (IndexedDB) with a picture of the moment, the world, the date and the tick; load, overwrite, delete, export
// to a file and import one; autosave on a timer (Settings); and a new world — a scenario picker with a seed. The
// god's own "save" / "load" acts (meta.save / meta.load, from the palette or in words) land here too.

import type { UiHost } from './host.ts';
import { Panel } from './panel.ts';
import { BASE_PACK } from '../data/index.ts';
import { h, clear, download } from './dom.ts';
import { icon } from './icons.ts';

export interface SaveMeta { id: string; name: string; scenario: string; seed: number; tick: number; world: string; date: number; summary: string; thumb: string | null; size: number }
interface SaveRecord extends SaveMeta { bytes: ArrayBuffer }

const DB = 'genesis-saves';
const STORE = 'saves';

class SaveStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise((ok, fail) => {
      if (typeof indexedDB === 'undefined') { fail(new Error('This browser keeps no saves (IndexedDB is not available).')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error ?? new Error('could not open the save store'));
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((ok, fail) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error ?? new Error('save store error'));
    });
  }

  async list(): Promise<SaveMeta[]> {
    const all = await this.tx<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
    return all.map(({ bytes, ...m }) => ({ ...m, size: m.size ?? bytes.byteLength })).sort((a, b) => b.date - a.date);
  }
  get(id: string): Promise<SaveRecord | undefined> { return this.tx<SaveRecord | undefined>('readonly', (s) => s.get(id) as IDBRequest<SaveRecord | undefined>); }
  put(r: SaveRecord): Promise<IDBValidKey> { return this.tx('readwrite', (s) => s.put(r)); }
  del(id: string): Promise<undefined> { return this.tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>); }
}

export interface SavesDeps {
  host: UiHost;
  /** the sim's bytes now (null: no living sim) */
  save(): Promise<ArrayBuffer | null>;
  load(bytes: ArrayBuffer): Promise<{ ok: boolean; msg?: string }>;
  /** a small picture of the view (data URL) */
  thumb(): Promise<string | null>;
  scenario: string;
  seed: number;
  /** ?dev=1: the render-dev worlds (lookdev) are offered too */
  dev?: boolean;
}

const SCENARIOS = ((BASE_PACK.scenarios ?? []) as unknown as { id: string; name: string; desc?: string }[]);

export class Saves {
  readonly panel: Panel;
  private deps: SavesDeps;
  private host: UiHost;
  private store = new SaveStore();
  private listEl: HTMLDivElement;
  private nameIn: HTMLInputElement;
  private lastAuto = performance.now();
  private busy = false;

  constructor(parent: HTMLElement, deps: SavesDeps) {
    this.deps = deps;
    this.host = deps.host;
    this.panel = new Panel(parent, { name: 'saves', title: 'Saves and worlds', subtitle: 'keep this moment, return to one, or begin again', icon: 'save', place: 'center', veil: true });
    this.nameIn = h('input', { class: 'gn-text', type: 'text', placeholder: 'Name this moment…', spellcheck: 'false' }) as HTMLInputElement;
    this.nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') void this.saveNew(); });
    const saveBtn = h('button', { class: 'gn-btn gn-btn-gold', on: { click: () => void this.saveNew() } }, h('span', { html: icon('save') }), 'Save');
    const file = h('input', { type: 'file', accept: '.gnss,.genesis,application/octet-stream', style: 'display:none' }) as HTMLInputElement;
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void this.importFile(f); file.value = ''; });
    const importBtn = h('button', { class: 'gn-btn', on: { click: () => file.click() } }, h('span', { html: icon('upload') }), 'Import a file');
    this.listEl = h('div', { class: 'gn-saves-list' });
    // a new world
    const sc = h('select', { class: 'gn-select' }) as HTMLSelectElement;
    // the lookdev world is a fabricated test scene for the render lane: offered only with ?dev=1
    for (const s of SCENARIOS) if (deps.dev || s.id !== 'lookdev') sc.append(h('option', { value: s.id, text: s.name }));
    sc.value = deps.scenario === 'lookdev' && !deps.dev ? 'barren' : deps.scenario;
    const desc = h('div', { class: 'gn-set-note' });
    const showDesc = () => { desc.textContent = SCENARIOS.find((s) => s.id === sc.value)?.desc ?? ''; };
    sc.addEventListener('change', showDesc);
    showDesc();
    const seed = h('input', { class: 'gn-text gn-seed', type: 'text', value: String(deps.seed), spellcheck: 'false', title: 'The seed: the same seed and the same acts make the same world' }) as HTMLInputElement;
    seed.addEventListener('keydown', (e) => e.stopPropagation());
    const dice = h('button', { class: 'gn-btn', title: 'A new seed', text: '⚄', on: { click: () => { seed.value = String(Math.floor(Math.random() * 1e9)); } } });
    const begin = h('button', { class: 'gn-btn gn-btn-gold', text: 'Begin this world', on: { click: () => this.newWorld(sc.value, Number(seed.value) || 0) } });
    this.panel.body.append(
      h('div', { class: 'gn-saves-new' }, this.nameIn, saveBtn, importBtn, file),
      h('div', { class: 'gn-set-h', text: 'Kept moments' }), this.listEl,
      h('div', { class: 'gn-set-h', text: 'A new world' }),
      h('div', { class: 'gn-saves-world' }, sc, h('label', { class: 'gn-field-l', text: 'seed' }), seed, dice, begin), desc,
      h('div', { class: 'gn-set-note', text: `This world: ${deps.scenario}, seed ${deps.seed}.` }));
    this.panel.onOpen = () => void this.refresh();
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  open(): void { this.panel.open(); }
  close(): void { this.panel.close(); }

  private async refresh(): Promise<void> {
    clear(this.listEl);
    let list: SaveMeta[] = [];
    try { list = await this.store.list(); } catch (e) { this.listEl.append(h('div', { class: 'gn-set-warn', text: e instanceof Error ? e.message : String(e) })); return; }
    if (!list.length) { this.listEl.append(h('div', { class: 'gn-set-note', text: 'Nothing kept yet. Save, or press F5 for a quicksave.' })); return; }
    for (const m of list) {
      const when = new Date(m.date);
      const row = h('div', { class: 'gn-save' },
        m.thumb ? h('img', { class: 'gn-save-img', src: m.thumb, alt: '' }) : h('div', { class: 'gn-save-img gn-save-noimg', html: icon('world') }),
        h('div', { class: 'gn-save-t' },
          h('div', { class: 'gn-save-name', text: m.name }),
          h('div', { class: 'gn-save-sub', text: `${m.summary || m.world} · ${m.scenario} · seed ${m.seed}` }),
          h('div', { class: 'gn-save-sub', text: `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${(m.size / 1048576).toFixed(1)} MB` })),
        h('div', { class: 'gn-save-acts' },
          h('button', { class: 'gn-btn gn-btn-gold', text: 'Load', on: { click: () => void this.loadSlot(m.id) } }),
          h('button', { class: 'gn-btn', title: 'Keep the world as it is now in this slot', text: 'Overwrite', on: { click: () => void this.saveSlot(m.id, m.name) } }),
          h('button', { class: 'gn-btn', title: 'Download as a file', html: icon('download'), on: { click: () => void this.exportSlot(m.id) } }),
          h('button', { class: 'gn-btn', title: 'Delete', html: icon('close'), on: { click: () => void this.store.del(m.id).then(() => this.refresh()) } })));
      this.listEl.append(row);
    }
  }

  private summary(): string {
    const pv = this.host.view.planet(this.host.primary());
    if (!pv) return '';
    const c = this.host.view.calendar(pv);
    let pop = 0;
    for (const p of this.host.view.planets) for (const n of p.population) pop += n;
    return `${pv.name}, year ${c.year} day ${c.day}${pop ? ` · ${pop} living` : ''}`;
  }

  /** keep the world in a slot */
  async saveSlot(id: string, name: string, quiet = false): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const bytes = await this.deps.save();
      if (!bytes) { this.host.toast({ text: 'There is no living world to save here.', kind: 'warn' }); return false; }
      const thumb = await this.deps.thumb().catch(() => null);
      await this.store.put({ id, name, scenario: this.deps.scenario, seed: this.deps.seed, tick: Math.floor(this.host.view.snapTick), world: this.host.view.planet(this.host.primary())?.name ?? '', date: Date.now(), summary: this.summary(), thumb, size: bytes.byteLength, bytes });
      if (!quiet) this.host.toast({ text: `Kept: ${name}.`, kind: 'info' });
      if (this.isOpen) void this.refresh();
      return true;
    } catch (e) {
      this.host.toast({ text: `The world could not be kept: ${e instanceof Error ? e.message : String(e)}`, kind: 'warn' });
      return false;
    } finally { this.busy = false; }
  }

  private async saveNew(): Promise<void> {
    const name = this.nameIn.value.trim() || this.summary() || 'A moment';
    this.nameIn.value = '';
    await this.saveSlot(`s${Date.now().toString(36)}`, name);
  }

  async loadSlot(id: string): Promise<boolean> {
    const r = await this.store.get(id).catch(() => undefined);
    if (!r) { this.host.toast({ text: 'That save is gone.', kind: 'warn' }); return false; }
    return this.loadBytes(r.bytes, r.name);
  }

  private async loadBytes(bytes: ArrayBuffer, name: string): Promise<boolean> {
    const res = await this.deps.load(bytes.slice(0));
    if (!res.ok) { this.host.toast({ text: `It would not load: ${res.msg ?? 'unknown reason'}`, kind: 'warn', ms: 9000 }); return false; }
    this.host.toast({ text: `Returned to: ${name}.`, kind: 'info' });
    this.close();
    return true;
  }

  async quicksave(): Promise<void> { await this.saveSlot('quick', 'Quicksave'); }
  async quickload(): Promise<void> {
    const r = await this.store.get('quick').catch(() => undefined);
    if (!r) { this.host.toast({ text: 'No quicksave yet (F5 makes one).', kind: 'info' }); return; }
    await this.loadBytes(r.bytes, 'the quicksave');
  }

  /** the god's own save / load acts (CommandResult.control from meta.save / meta.load) */
  async control(ctl: Record<string, number>): Promise<void> {
    if (ctl.save) { if (ctl.quick) await this.quicksave(); else await this.saveSlot(`s${Date.now().toString(36)}`, this.summary() || 'A moment'); }
    if (ctl.load) {
      if (ctl.quick) { await this.quickload(); return; }
      const list = await this.store.list().catch(() => [] as SaveMeta[]);
      if (list[0]) await this.loadSlot(list[0].id); else this.host.toast({ text: 'Nothing has been kept to return to.', kind: 'info' });
    }
  }

  private async exportSlot(id: string): Promise<void> {
    const r = await this.store.get(id);
    if (!r) return;
    download(`${r.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'genesis'}.gnss`, r.bytes, 'application/octet-stream');
  }

  private async importFile(f: File): Promise<void> {
    const bytes = await f.arrayBuffer();
    const ok = await this.loadBytes(bytes, f.name);
    if (ok) await this.saveSlot(`s${Date.now().toString(36)}`, f.name.replace(/\.\w+$/, ''), true);
  }

  /** begin a new world (the page reloads into it; the opening plays only on the barren start) */
  newWorld(scenario: string, seed: number): void {
    const p = new URLSearchParams(location.search);
    p.set('scenario', scenario);
    if (scenario === 'barren') p.delete('intro'); else p.set('intro', '0');
    p.set('seed', String(Math.max(0, Math.floor(seed)) >>> 0));
    location.search = p.toString();
  }

  /** autosave on its timer (called every frame) */
  frame(): void {
    const min = this.host.prefs.value.game.autosaveMinutes;
    if (!min || this.host.source !== 'worker') return;
    const now = performance.now();
    if (now - this.lastAuto < min * 60000) return;
    this.lastAuto = now;
    void this.saveSlot('auto', 'Autosave', true);
  }
}
