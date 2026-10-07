// Content-author check (lane CONTENT, shared by the kit designers): validates fighter and skin source
// files BEFORE the full content build, with errors that point at one file.
//
//   node _harness/check_fighter_json.ts                 every content/fighters/*.json + content/skins/*.json
//   node _harness/check_fighter_json.ts marund burdam   only those fighters (and their skin files)
//
// Checks (exit 1 on any error, 0 when clean):
//   * zod: content/fighters/<id>.json with FighterDef, content/skins/<id>.json with z.array(SkinDef),
//     content/vfx.json and any content/vfx_fighters_*.json (per-half bespoke presets not merged yet) with z.array(VfxDef)
//     plus the CONTRACT §9.5 layer vocabulary (types, keys, enums, value shapes) and the emissive tiers
//     (the "$comment" tier T0-T4 caps a flash's intensity; white only at T4);
//   * file names: fighter id == file name; every skin's `fighter` == its file name; exactly one
//     `<id>_base` skin of tier "base"; skin ids `<id>_<variant>`;
//   * refs: class / role / secondaryRole / resource exist in content/{classes,roles,resources}.json;
//     every `present.vfx|hitVfx` is in content/vfx.json or a vfx_fighters_*.json; every
//     `present.sfx|hitSfx` is an audio.json cue; every `present.anim` is a clip role in art.clips;
//     `form` / `inForm` ids are in kit.passive.forms; ability ids are unique across all fighters;
//   * text: every {placeholder} in a kit desc resolves inside its own record (same rules as the
//     tooltip formatter, src/ui/format.ts: a dot path from the record, or a bare key found depth-first);
//   * VFX layers use only CONTRACT §9.5 types and keys.
// The real gate is still `npm run content:check`; this is the fast inner loop for kit authors.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { FighterDef, SkinDef, VfxDef } from '../src/contracts/catalog.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');
const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith('--')));

let errors = 0, warnings = 0;
const err = (file: string, msg: string): void => { errors++; console.log(`ERROR ${file}: ${msg}`); };
const warn = (file: string, msg: string): void => { warnings++; console.log(`warn  ${file}: ${msg}`); };

function readJson(p: string): unknown {
  const txt = readFileSync(p, 'utf8').replace(/^﻿/, '');
  return stripComments(JSON.parse(txt));
}
/** the content build strips "$comment"/"$schema" keys at any depth (CONTRACT §3.6) */
function stripComments(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== '$comment' && k !== '$schema') o[k] = stripComments(x);
    return o;
  }
  return v;
}
function zodIssues(e: z.ZodError): string {
  return e.issues.slice(0, 12).map((i) => `  ${i.path.join('.') || '$'}: ${i.message}`).join('\n');
}

// ── reference sets ──────────────────────────────────────────────────────────────────────────────
const ids = (file: string): Set<string> => {
  const p = join(CONTENT, file);
  if (!existsSync(p)) return new Set();
  const v = readJson(p) as { id: string }[];
  return new Set(v.map((x) => x.id));
};
const classes = ids('classes.json'), roles = ids('roles.json'), resources = ids('resources.json');
const vfxIds = ids('vfx.json');
const cues = new Set<string>(existsSync(join(CONTENT, 'audio.json')) ? Object.keys((readJson(join(CONTENT, 'audio.json')) as { cues: object }).cues) : []);

// ── bespoke VFX files (vfx_fighters_*.json) ────────────────────────────────────────────────────
const VFX_COMMON = ['delay', 'at'];
const VFX_LAYERS: Record<string, string[]> = {
  burst: ['count', 'life', 'speed', 'spreadDeg', 'size', 'color', 'alpha', 'gravity', 'drag', 'blend', 'texture'],
  trail: ['width', 'life', 'color', 'alpha', 'texture', 'blend'],
  ring: ['radius', 'width', 'life', 'color', 'alpha', 'blend'],
  beam: ['width', 'life', 'color', 'texture', 'blend'],
  flash: ['radius', 'life', 'color', 'intensity'],
  mesh: ['shape', 'scale', 'life', 'color', 'alpha', 'spinDeg', 'blend'],
  decal: ['shape', 'radius', 'life', 'color', 'alpha', 'texture'],
};
const VFX_ENUM: Record<string, string[]> = {
  blend: ['add', 'alpha'],
  texture: ['spark', 'glow', 'smoke', 'shard', 'ring', 'streak', 'petal', 'ember', 'drop', 'rune', 'crack', 'dust', 'mote'],
  at: ['origin', 'target', 'path', 'ground'],
};
const MESH_SHAPES = ['orb', 'blade', 'shard', 'cone', 'pillar', 'disc', 'spiral', 'crescent', 'spike'];
const DECAL_SHAPES = ['circle', 'ring', 'cone', 'rect', 'line'];
const isColor = (v: unknown): boolean => typeof v === 'string' && (/^#[0-9a-fA-F]{6}$/.test(v) || v === 'team' || v === 'element');
const isPair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** CONTRACT §9.5 vocabulary: layer types, keys, enums and value shapes */
function checkVfxLayers(file: string, list: z.infer<typeof VfxDef>[]): void {
  for (const v of list) {
    v.layers.forEach((l, j) => {
      const where = `${v.id}.layers[${j}]`;
      const keys = VFX_LAYERS[l.type as string];
      if (!keys) { err(file, `${where}: unknown layer type ${JSON.stringify(l.type)}`); return; }
      for (const [k, val] of Object.entries(l)) {
        if (k === 'type') continue;
        if (!keys.includes(k) && !VFX_COMMON.includes(k)) { err(file, `${where}: unknown key "${k}" for ${l.type}`); continue; }
        if (VFX_ENUM[k] && !VFX_ENUM[k].includes(val as string)) err(file, `${where}.${k}: ${JSON.stringify(val)} not in ${VFX_ENUM[k].join('|')}`);
        if (k === 'shape' && !(l.type === 'mesh' ? MESH_SHAPES : DECAL_SHAPES).includes(val as string)) err(file, `${where}.shape: ${JSON.stringify(val)}`);
        if (k === 'color' && !(l.type === 'burst' ? Array.isArray(val) && val.length === 2 && val.every(isColor) : isColor(val))) err(file, `${where}.color: ${JSON.stringify(val)}`);
        if (['life', 'speed', 'size', 'alpha', 'radius', 'scale'].includes(k) && !(typeof val === 'number' || isPair(val))) err(file, `${where}.${k}: expected number or [a, b]`);
      }
    });
  }
}

// the merged library: every bespoke `<fighter>_<slot>_<word>` preset (and every lib_*) gets the same vocabulary check
if (existsSync(join(CONTENT, 'vfx.json'))) {
  const r = z.array(VfxDef).safeParse(readJson(join(CONTENT, 'vfx.json')));
  if (!r.success) err('content/vfx.json', `VfxDef[] schema:\n${zodIssues(r.error)}`);
  else {
    const seen = new Set<string>();
    for (const v of r.data) { if (seen.has(v.id)) err('content/vfx.json', `duplicate vfx id "${v.id}"`); seen.add(v.id); }
    checkVfxLayers('content/vfx.json', r.data);
  }
}
// emissive tiers (STYLE_BIBLE "VFX": caps T0-T4 0.8 · 1.5 · 3 · 6 · >= 10, only T4 reaches white). Each preset's "$comment" starts
// with its tier ("T3 · Lumen · ..."); the check reads the raw file because readJson() strips comments.
const TIER_CAP = [0.8, 1.5, 3, 6, Infinity];
function checkVfxTiers(file: string, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const v of raw as { id?: string; $comment?: string; layers?: { type?: string; color?: unknown; intensity?: number }[] }[]) {
    const id = v.id ?? '?';
    const m = /^T([0-4])\b/.exec(v.$comment ?? '');
    if (!m) { warn(file, `${id}: no tier ("T0".."T4") at the start of its "$comment"`); continue; }
    const tier = Number(m[1]);
    let maxFlash = 0;
    (v.layers ?? []).forEach((l, j) => {
      const cols = Array.isArray(l.color) ? l.color : [l.color];
      if (tier < 4 && cols.some((c) => typeof c === 'string' && c.toUpperCase() === '#FFFFFF')) err(file, `${id}.layers[${j}]: white is T4 only (this preset is T${tier})`);
      if (l.type === 'flash' && typeof l.intensity === 'number') {
        maxFlash = Math.max(maxFlash, l.intensity);
        if (l.intensity > TIER_CAP[tier] + 1e-9) err(file, `${id}.layers[${j}]: flash intensity ${l.intensity} exceeds the T${tier} cap ${TIER_CAP[tier]}`);
      }
    });
    if (tier === 4 && maxFlash < 10) warn(file, `${id}: a T4 preset should reach an emissive of 10 or more (its brightest flash is ${maxFlash})`);
  }
}
if (existsSync(join(CONTENT, 'vfx.json'))) checkVfxTiers('content/vfx.json', JSON.parse(readFileSync(join(CONTENT, 'vfx.json'), 'utf8').replace(/^\ufeff/, '')));
// per-half files not merged yet (vfx_fighters_*.json): same check, ids must not collide with vfx.json
for (const name of readdirSync(CONTENT).filter((n) => /^vfx_fighters_.*\.json$/.test(n)).sort()) {
  const file = `content/${name}`;
  const r = z.array(VfxDef).safeParse(readJson(join(CONTENT, name)));
  if (!r.success) { err(file, `VfxDef[] schema:\n${zodIssues(r.error)}`); continue; }
  for (const v of r.data) {
    if (vfxIds.has(v.id)) err(file, `vfx id "${v.id}" already exists in content/vfx.json`);
    vfxIds.add(v.id);
  }
  checkVfxLayers(file, r.data);
  checkVfxTiers(file, JSON.parse(readFileSync(join(CONTENT, name), 'utf8').replace(/^\ufeff/, '')));
}

// ── placeholders (src/ui/format.ts semantics) ─────────────────────────────────────────────────
type Any = Record<string, unknown>;
function walkPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? (cur as unknown[])[Number(p)] : (cur as Any)[p];
    if (cur === undefined) return undefined;
  }
  return cur;
}
function findKey(root: unknown, key: string, depth = 0): unknown {
  if (!root || typeof root !== 'object' || depth > 12) return undefined;
  if (!Array.isArray(root) && key in (root as Any)) return (root as Any)[key];
  for (const v of Array.isArray(root) ? root : Object.values(root as Any)) {
    const f = findKey(v, key, depth + 1);
    if (f !== undefined) return f;
  }
  return undefined;
}
function checkPlaceholders(file: string, where: string, record: unknown, desc: string): void {
  for (const m of desc.matchAll(/\{([A-Za-z0-9_.]+)\}/g)) {
    const path = m[1].split('.');
    const v = walkPath(record, path) ?? (path.length === 1 ? findKey(record, path[0]) : undefined);
    if (v === undefined) { err(file, `${where}: placeholder {${m[1]}} does not resolve in its record`); continue; }
    const ok = typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number')) ||
      (v !== null && typeof v === 'object' && 'base' in (v as Any));
    if (!ok) err(file, `${where}: placeholder {${m[1]}} points at a non-number (${JSON.stringify(v).slice(0, 60)})`);
  }
}

/** depth-first walk of every object node */
function walk(node: unknown, path: string, fn: (n: Any, p: string) => void): void {
  if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${path}[${i}]`, fn)); return; }
  if (node && typeof node === 'object') {
    fn(node as Any, path);
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, fn);
  }
}

// ── fighters ────────────────────────────────────────────────────────────────────────────────────
const fdir = join(CONTENT, 'fighters'), sdir = join(CONTENT, 'skins');
const fighterFiles = existsSync(fdir) ? readdirSync(fdir).filter((n) => n.endsWith('.json')).sort() : [];
const abilityOwner = new Map<string, string>();
let nFighters = 0, nSkins = 0;
for (const name of fighterFiles) {
  const stem = name.slice(0, -5);
  // ability ids are global: collect them from every fighter even when only some are checked
  const raw = readJson(join(fdir, name));
  const file = `content/fighters/${name}`;
  const parsed = FighterDef.safeParse(raw);
  if (!parsed.success) { if (only.size === 0 || only.has(stem)) err(file, `FighterDef schema:\n${zodIssues(parsed.error)}`); continue; }
  const f = parsed.data;
  const kitIds: string[] = [f.kit.passive.id];
  for (const s of ['a1', 'a2', 'a3', 'ult'] as const) {
    kitIds.push(f.kit[s].id);
    if (f.kit[s].recast) kitIds.push(f.kit[s].recast!.ability.id);
  }
  for (const form of Object.values(f.kit.passive.forms ?? {})) for (const a of Object.values(form.kit ?? {})) if (a) kitIds.push(a.id);
  for (const id of kitIds) {
    const prev = abilityOwner.get(id);
    if (prev && prev !== f.id) err(file, `ability id "${id}" is already used by ${prev}`);
    abilityOwner.set(id, f.id);
  }
  if (only.size > 0 && !only.has(stem)) continue;
  nFighters++;
  if (f.id !== stem) err(file, `id "${f.id}" must equal the file name "${stem}"`);
  if (!classes.has(f.class)) err(file, `unknown class "${f.class}"`);
  if (!roles.has(f.role)) err(file, `unknown role "${f.role}"`);
  if (f.secondaryRole !== undefined && !roles.has(f.secondaryRole)) err(file, `unknown secondaryRole "${f.secondaryRole}"`);
  if (!resources.has(f.resource)) err(file, `unknown resource "${f.resource}"`);
  const clips = new Set(Object.keys(f.art.clips));
  const forms = new Set(Object.keys(f.kit.passive.forms ?? {}));
  walk(raw, '', (n, p) => {
    if (p.endsWith('present')) {
      for (const k of ['vfx', 'hitVfx']) if (typeof n[k] === 'string' && !vfxIds.has(n[k] as string)) err(file, `${p}.${k}: unknown vfx "${n[k]}"`);
      for (const k of ['sfx', 'hitSfx']) if (typeof n[k] === 'string' && !cues.has(n[k] as string)) err(file, `${p}.${k}: unknown audio cue "${n[k]}"`);
      if (typeof n.anim === 'string' && !clips.has(n.anim)) err(file, `${p}.anim: clip role "${n.anim}" is not in art.clips`);
    }
    if (n.op === 'form' && typeof n.form === 'string' && !forms.has(n.form)) err(file, `${p}: form "${n.form}" is not in kit.passive.forms`);
    if (n.kind === 'inForm' && typeof n.form === 'string' && !forms.has(n.form)) err(file, `${p}: inForm "${n.form}" is not in kit.passive.forms`);
    if (n.op === 'script') warn(file, `${p}: uses script "${n.id}" (zero scripts is the goal)`);
  });
  // tooltip text
  const records: [string, Any][] = [['kit.passive', f.kit.passive as unknown as Any]];
  for (const s of ['a1', 'a2', 'a3', 'ult'] as const) {
    records.push([`kit.${s}`, f.kit[s] as unknown as Any]);
    if (f.kit[s].recast) records.push([`kit.${s}.recast.ability`, f.kit[s].recast!.ability as unknown as Any]);
  }
  for (const [fid, form] of Object.entries(f.kit.passive.forms ?? {})) {
    for (const [s, a] of Object.entries(form.kit ?? {})) if (a) records.push([`kit.passive.forms.${fid}.kit.${s}`, a as unknown as Any]);
  }
  for (const [where, rec] of records) {
    checkPlaceholders(file, where, rec, rec.desc as string);
    if (!(rec.desc as string).trim()) err(file, `${where}: blank desc`);
  }
  // skins of this fighter
  const sfile = join(sdir, name);
  if (!existsSync(sfile)) { err(file, `no skin file content/skins/${name}`); continue; }
  const sr = z.array(SkinDef).safeParse(readJson(sfile));
  if (!sr.success) { err(`content/skins/${name}`, `SkinDef[] schema:\n${zodIssues(sr.error)}`); continue; }
  const skins = sr.data;
  nSkins += skins.length;
  const seen = new Set<string>();
  for (const s of skins) {
    if (s.fighter !== stem) err(`content/skins/${name}`, `skin "${s.id}" belongs to "${s.fighter}" but lives in skins/${name}`);
    if (!s.id.startsWith(`${stem}_`)) err(`content/skins/${name}`, `skin id "${s.id}" must be <fighter>_<variant>`);
    if (seen.has(s.id)) err(`content/skins/${name}`, `duplicate skin id "${s.id}"`);
    seen.add(s.id);
  }
  const base = skins.filter((s) => s.tier === 'base');
  if (base.length !== 1 || base[0].id !== `${stem}_base`) err(`content/skins/${name}`, `needs exactly one base skin "${stem}_base" (found ${base.map((s) => s.id).join(', ') || 'none'})`);
  else if (base[0].model !== f.art.model || base[0].portrait !== f.art.portrait || base[0].splash !== f.art.splash) {
    err(`content/skins/${name}`, `${stem}_base must point at the base files in art (model/portrait/splash)`);
  }
}
// skin files without a fighter
if (existsSync(sdir)) {
  for (const name of readdirSync(sdir).filter((n) => n.endsWith('.json'))) {
    const stem = name.slice(0, -5);
    if ((only.size === 0 || only.has(stem)) && !fighterFiles.includes(name)) err(`content/skins/${name}`, `no fighter content/fighters/${name}`);
  }
}

console.log(`check_fighter_json: ${nFighters} fighter(s), ${nSkins} skin(s); ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
