/// <reference types="vite/client" />
// HIT PARADE — game data loader (CONTRACT §5, §16, §17 rule 2, §19.9). THREE-free, DOM-free.
//
// loadGameData():
//   * in Vite (dev + build): `import.meta.glob` over data/**/*.json, bundled eagerly;
//   * in Node (probes of every lane): the same files read through fs obtained with
//     process.getBuiltinModule (no top-level node imports, so the browser bundle stays clean).
// buildGameData(raw) validates everything (throws ONE readable error listing every problem),
// derives anim.warp and hit boxes from clips.json when a move omits them (§5.2), and builds the
// §17 per-fighter anim tables. Non-fatal findings (a clips file not generated yet, a fallback box)
// go to GameData.warnings, which probe_data prints.

import type {
  AnimRef, BoxDef, ClassicEntry, ClipInfo, ClipsFile, FighterDef, GameData, Move, SimpleMap, System, Vec2,
} from './types.ts';
import { hashString } from './sim/hash.ts';

/** §6.2 shared system clips, in the exact §17 rule 2 order (anim ids 0..33). */
export const SHARED_CLIPS: readonly string[] = [
  'idle', 'walk_f', 'walk_b', 'crouch', 'crouch_idle', 'jump_up', 'jump_f', 'jump_b', 'land', 'dash_f',
  'dash_b', 'block_high', 'block_low', 'hit_high_s', 'hit_high_l', 'hit_body', 'hit_low', 'hit_air', 'crumple',
  'kd_fall_b', 'kd_fall_f', 'kd_ground_b', 'kd_ground_f', 'wake_b', 'wake_f', 'wall_splat', 'thrown_f',
  'thrown_b', 'dizzy', 'ko_fall', 'timeover_lose', 'parry', 'impact_windup', 'shove',
];
const LOOPING_SHARED = new Set(['idle', 'walk_f', 'walk_b', 'crouch_idle', 'dizzy', 'kd_ground_b', 'kd_ground_f']);

export const MOVE_KINDS: readonly string[] = [
  'normal', 'command', 'special', 'ex', 'super1', 'super3', 'throw', 'cmdgrab', 'projectile', 'system',
];
export const MOTIONS: readonly string[] = [
  '236', '214', '623', '421', '41236', '63214', '360', '236236', '214214', '[4]6', '[2]8', '22',
];
const SIMPLE_KEYS = ['5S', '6S', '2S', '4S', 'S+H', 'S+H+2', 'A5S', 'A6S', 'A2S', 'A4S', 'jS'];

export interface RawData {
  system: unknown;
  fighters: Record<string, unknown>;
  clips: Record<string, unknown>;
  stages?: unknown;
  ladder?: unknown;
  cpu?: unknown;
  strings?: unknown;
}

// ------------------------------------------------------------------ file collection
type FileMap = Record<string, unknown>;

function globFiles(): FileMap | null {
  try {
    const mods = import.meta.glob('../../../data/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
    const out: FileMap = {};
    for (const k of Object.keys(mods)) {
      const i = k.lastIndexOf('/data/');
      out[i >= 0 ? k.slice(i + 6) : k] = mods[k];
    }
    return out;
  } catch {
    return null; // not running under Vite
  }
}

interface NodeFs {
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: 'utf8'): string;
  existsSync(p: string): boolean;
  statSync(p: string): { isDirectory(): boolean };
}

function nodeFiles(): FileMap | null {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  if (!proc || typeof proc.getBuiltinModule !== 'function') return null;
  const fs = proc.getBuiltinModule('node:fs') as NodeFs;
  const url = proc.getBuiltinModule('node:url') as { fileURLToPath(u: URL): string };
  const rel = '../../../data/';
  const dir = url.fileURLToPath(new URL(rel, import.meta.url));
  return readDataDir(fs, dir);
}

/** Reads data/*.json, data/fighters/*.json, data/clips/*.clips.json from `dir` (Node harness use). */
export function readDataDir(fs: NodeFs, dir: string): FileMap {
  const out: FileMap = {};
  const base = dir.endsWith('/') || dir.endsWith('\\') ? dir : dir + '/';
  const walk = (sub: string): void => {
    const d = base + sub;
    if (!fs.existsSync(d)) return;
    for (const name of fs.readdirSync(d).sort()) {
      const p = d + name;
      if (fs.statSync(p).isDirectory()) {
        if (sub === '') walk(name + '/');
        continue;
      }
      if (!name.endsWith('.json')) continue;
      try {
        out[sub + name] = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
      } catch (e) {
        throw new Error(`HIT PARADE data: ${sub + name} is not valid JSON: ${(e as Error).message}`);
      }
    }
  };
  walk('');
  return out;
}

/** Groups a data/-relative file map into RawData. */
export function rawFromFiles(files: FileMap): RawData {
  const raw: RawData = { system: files['system.json'], fighters: {}, clips: {} };
  for (const k of Object.keys(files).sort()) {
    let m = /^fighters\/([^/]+)\.json$/.exec(k);
    if (m) {
      raw.fighters[m[1]] = files[k];
      continue;
    }
    m = /^clips\/([^/]+)\.clips\.json$/.exec(k);
    if (m) {
      raw.clips[m[1]] = files[k];
      continue;
    }
  }
  raw.stages = files['stages.json'];
  raw.ladder = files['ladder.json'];
  raw.cpu = files['cpu.json'];
  raw.strings = files['strings.json'];
  return raw;
}

let cached: GameData | null = null;

/** §16: loads + validates all JSON (bundled in Vite, fs in Node). Cached after the first call. */
export function loadGameData(): GameData {
  if (cached) return cached;
  const files = globFiles() ?? nodeFiles();
  if (!files) throw new Error('loadGameData: neither import.meta.glob (Vite) nor Node fs is available; use buildGameData(raw)');
  cached = buildGameData(rawFromFiles(files));
  return cached;
}

// ------------------------------------------------------------------ validation helpers
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}
function isVec2(v: unknown): v is Vec2 {
  return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
}
function isRange(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && v[0] >= 1 && v[1] >= v[0];
}
/** A frame range, or [0, 0] = "none" (how the fighter JSON spells an unused range). */
function isRangeOrNone(v: unknown): boolean {
  return isRange(v) || (Array.isArray(v) && v.length === 2 && v[0] === 0 && v[1] === 0);
}
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ------------------------------------------------------------------ strength inference (shared with compile)
/** 'L' | 'M' | 'H' strength of a move: explicit field > input button > id suffix > kind default. */
export function moveStrength(id: string, mv: Move): 'L' | 'M' | 'H' {
  if (mv.strength === 'L' || mv.strength === 'M' || mv.strength === 'H') return mv.strength;
  const inp = (mv.input ?? '').split('>').pop() ?? '';
  const last = inp.charAt(inp.length - 1);
  if (mv.kind === 'normal' || mv.kind === 'command') {
    if (last === 'L' || last === 'M' || last === 'H') return last;
  }
  const suf = /_(l|m|h|ex)$/i.exec(id);
  if (suf) {
    const s = suf[1].toLowerCase();
    return s === 'l' ? 'L' : s === 'm' ? 'M' : 'H';
  }
  if (last === 'L' || last === 'M' || last === 'H') return last;
  if (mv.kind === 'super1' || mv.kind === 'super3' || mv.kind === 'system') return 'H';
  return 'M';
}

// ------------------------------------------------------------------ clips normalisation
function normaliseClips(id: string, raw: unknown, errs: string[]): ClipsFile | null {
  if (!isObj(raw)) {
    errs.push(`clips/${id}.clips.json: not an object`);
    return null;
  }
  const out: ClipsFile = { clips: {} };
  const src = isObj(raw.clips) ? raw.clips : raw;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (isNum(v) && (k === 'heightM' || k === 'hipsM' || k === 'handReachM' || k === 'footReachM')) out[k] = v;
  }
  if (isObj(raw.body)) {
    for (const k of ['heightM', 'hipsM', 'handReachM', 'footReachM'] as const) {
      const v = raw.body[k];
      if (isNum(v)) out[k] = v;
    }
  }
  for (const k of Object.keys(src)) {
    const c = src[k];
    if (!isObj(c) || !isNum(c.dur)) continue;
    const eff = isObj(c.effector) && isVec2(c.effector.at) ? { bone: String(c.effector.bone ?? ''), at: c.effector.at as Vec2 } : null;
    out.clips[k] = {
      dur: c.dur,
      frames: isNum(c.frames) ? c.frames : Math.round(c.dur * 30),
      contact: isNum(c.contact) ? c.contact : null,
      effector: eff,
      root: Array.isArray(c.root) ? (c.root.filter(isVec2) as Vec2[]) : [],
      apexY: isNum(c.apexY) ? c.apexY : null,
      loop: c.loop === true,
    } satisfies ClipInfo;
  }
  return out;
}

// ------------------------------------------------------------------ system validation
const SYSTEM_SECTIONS = [
  'hp', 'round', 'stage', 'movement', 'jump', 'buffer', 'motion', 'hitstop', 'hitstun', 'counter', 'scaling',
  'simple', 'grey', 'showtime', 'nerve', 'stageFright', 'parry', 'rush', 'impact', 'shove', 'throw', 'kd',
  'juggle', 'wallSplat', 'groundBounce', 'crumple', 'pushback', 'cancel', 'super', 'cinematic', 'projectile',
  'boxes', 'anim', 'training',
];

function validateSystem(raw: unknown, errs: string[]): System | null {
  if (!isObj(raw)) {
    errs.push('system.json: missing or not an object');
    return null;
  }
  for (const k of SYSTEM_SECTIONS) if (!isObj(raw[k])) errs.push(`system.json: missing section "${k}"`);
  const sc = raw.scaling;
  if (isObj(sc)) {
    for (const t of ['general', 'light']) {
      const a = sc[t];
      if (!Array.isArray(a) || a.length !== 10 || !a.every(isInt)) errs.push(`system.json scaling.${t}: need 10 integers`);
    }
  }
  return raw as System;
}

// ------------------------------------------------------------------ fighter validation
function validateBoxes(where: string, v: unknown, errs: string[]): void {
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    errs.push(`${where}: must be an array of {f,x,y,w,h}`);
    return;
  }
  v.forEach((b, i) => {
    if (!isObj(b) || !isRange(b.f) || !isNum(b.x) || !isNum(b.y) || !isNum(b.w) || !isNum(b.h) || b.w <= 0 || b.h <= 0) {
      errs.push(`${where}[${i}]: need {f:[a,b] (1 <= a <= b), x, y, w > 0, h > 0}`);
    }
  });
}

function validateMove(where: string, id: string, mv: unknown, moves: Record<string, unknown>, errs: string[], warns: string[]): void {
  if (!isObj(mv)) {
    errs.push(`${where}: not an object`);
    return;
  }
  if (typeof mv.kind !== 'string' || !MOVE_KINDS.includes(mv.kind)) errs.push(`${where}.kind: "${String(mv.kind)}" not one of ${MOVE_KINDS.join('|')}`);
  if (!isInt(mv.startup) || mv.startup < 1) errs.push(`${where}.startup: integer >= 1 required`);
  if (!isInt(mv.active) || mv.active < 1) errs.push(`${where}.active: integer >= 1 required`);
  if (!isInt(mv.recovery) || mv.recovery < 0) errs.push(`${where}.recovery: integer >= 0 required`);
  for (const k of ['damage', 'hitstop', 'hitstun', 'blockstun', 'multi']) {
    if (mv[k] !== undefined && (!isInt(mv[k]) || (mv[k] as number) < 0)) errs.push(`${where}.${k}: integer >= 0 required`);
  }
  if (mv.chipPct !== undefined && !isNum(mv.chipPct)) errs.push(`${where}.chipPct: number required`);
  if (mv.guard !== undefined && !['HL', 'H', 'L', 'U'].includes(String(mv.guard))) errs.push(`${where}.guard: HL|H|L|U`);
  if (mv.input !== undefined && typeof mv.input !== 'string') errs.push(`${where}.input: string required`);
  if ((mv.kind === 'normal' || mv.kind === 'command' || mv.kind === 'throw') && typeof mv.input !== 'string') {
    errs.push(`${where}.input: required for kind ${String(mv.kind)} (routing, CONTRACT §19.1)`);
  }
  validateBoxes(`${where}.boxes`, mv.boxes, errs);
  validateBoxes(`${where}.hurtExt`, mv.hurtExt, errs);
  if (mv.move !== undefined && (!Array.isArray(mv.move) || !mv.move.every(isVec2))) errs.push(`${where}.move: [[frame, metres], ...] required`);
  if (mv.cancel !== undefined) {
    if (!Array.isArray(mv.cancel)) errs.push(`${where}.cancel: array of strings required`);
    else {
      for (const c of mv.cancel) {
        if (typeof c !== 'string') {
          errs.push(`${where}.cancel: non-string entry`);
          continue;
        }
        if (c.startsWith('chain:')) {
          const t = c.slice(6);
          if (!(t in moves)) errs.push(`${where}.cancel "${c}": no move "${t}"`);
        } else if (!['special', 'super', 'whiff', 'ex'].includes(c)) warns.push(`${where}.cancel "${c}": unknown token (ignored)`);
      }
    }
  }
  if (isObj(mv.onHit)) {
    const oh = mv.onHit;
    if (oh.kd !== undefined && !['none', 'soft', 'hard'].includes(String(oh.kd))) errs.push(`${where}.onHit.kd: none|soft|hard`);
    if (oh.launch !== undefined && !isVec2(oh.launch)) errs.push(`${where}.onHit.launch: [vx, vy] m/s`);
  }
  if (isObj(mv.invuln)) {
    for (const k of ['strike', 'throw', 'air', 'proj']) {
      if (mv.invuln[k] !== undefined && !isRangeOrNone(mv.invuln[k])) errs.push(`${where}.invuln.${k}: [a, b] frames (or [0, 0] = none)`);
    }
  }
  if (mv.armor !== undefined) {
    const ar = mv.armor;
    if (!isObj(ar) || !isInt(ar.hits) || ar.hits < 0 || (ar.hits > 0 ? !isRange(ar.f) : ar.f !== undefined && !isRangeOrNone(ar.f))) {
      errs.push(`${where}.armor: {hits >= 0, f:[a,b]} (hits 0 = none)`);
    }
  }
  if (mv.projectile !== undefined) {
    const p = mv.projectile;
    if (!isObj(p) || !isNum(p.speed) || !isInt(p.life) || !isVec2(p.box) || !isNum(p.y)) errs.push(`${where}.projectile: {speed, life, box:[w,h], y} required`);
  }
  if (mv.cinematic !== undefined) {
    const c = mv.cinematic;
    if (!isObj(c) || !isInt(c.frames) || c.frames < 1 || !Array.isArray(c.hits) || !c.hits.every(isVec2)) {
      errs.push(`${where}.cinematic: {frames, cue, hits:[[frame, dmg]...]} required`);
    } else {
      for (const h of c.hits as Vec2[]) if (!isInt(h[0]) || h[0] < 0 || h[0] >= c.frames || !isInt(h[1])) errs.push(`${where}.cinematic.hits: frame in [0, frames) and integer damage`);
    }
    if (mv.kind !== 'super3') warns.push(`${where}: cinematic on a non-super3 move`);
  }
  if (mv.anim !== undefined) {
    if (!isObj(mv.anim) || typeof mv.anim.clip !== 'string') errs.push(`${where}.anim: {clip, warp?} required`);
    else if (mv.anim.warp !== undefined && (!Array.isArray(mv.anim.warp) || !mv.anim.warp.every(isVec2))) errs.push(`${where}.anim.warp: [[frame, seconds]...]`);
  } else {
    warns.push(`${where}: no anim.clip`);
  }
  if (mv.sfx !== undefined && (!Array.isArray(mv.sfx) || !mv.sfx.every((e) => Array.isArray(e) && isInt(e[0]) && typeof e[1] === 'string'))) {
    errs.push(`${where}.sfx: [[frame, "name"], ...]`);
  }
  // §20.2 (lane FIGHTERS) optional fields
  if (mv.hits !== undefined) {
    if (!Array.isArray(mv.hits) || mv.hits.length === 0) errs.push(`${where}.hits: non-empty array of {f, damage, hitstop?}`);
    else mv.hits.forEach((h, i) => {
      if (!isObj(h) || !isRange(h.f) || !isInt(h.damage) || (h.hitstop !== undefined && !isInt(h.hitstop))) errs.push(`${where}.hits[${i}]: {f:[a,b], damage, hitstop?}`);
    });
  }
  if (mv.moveY !== undefined && (!Array.isArray(mv.moveY) || !mv.moveY.every(isVec2))) errs.push(`${where}.moveY: [[frame, metres], ...]`);
  if (mv.airVel !== undefined && !isVec2(mv.airVel)) errs.push(`${where}.airVel: [vx, vy] m/s`);
  if (mv.hurtOverride !== undefined) {
    if (!Array.isArray(mv.hurtOverride)) errs.push(`${where}.hurtOverride: array of {f, w, h, y?}`);
    else mv.hurtOverride.forEach((h, i) => {
      if (!isObj(h) || !isRange(h.f) || !isNum(h.w) || !isNum(h.h) || h.w <= 0 || h.h <= 0 || (h.y !== undefined && !isNum(h.y))) errs.push(`${where}.hurtOverride[${i}]: {f:[a,b], w > 0, h > 0, y?}`);
    });
  }
  if (mv.grab !== undefined) {
    const g = mv.grab;
    if (!isObj(g) || !isInt(g.frames) || g.frames < 1 || !isInt(g.adv) || !isInt(g.hitF) || g.hitF < 1 || (g.rangeM !== undefined && !isNum(g.rangeM))) {
      errs.push(`${where}.grab: {frames >= 1, adv, hitF >= 1, rangeM?, swap?, air?, techable?, clip?}`);
    } else if (g.hitF > g.frames) errs.push(`${where}.grab.hitF ${g.hitF} > frames ${g.frames}`);
  }
  if (mv.trigger !== undefined) {
    const tr = mv.trigger;
    if (!isObj(tr)) errs.push(`${where}.trigger: {classic?: {motion, btn}, simple?}`);
    else {
      if (tr.classic !== undefined && (!isObj(tr.classic) || typeof tr.classic.motion !== 'string' || typeof tr.classic.btn !== 'string' || (tr.classic.motion !== '' && !MOTIONS.includes(tr.classic.motion)))) {
        errs.push(`${where}.trigger.classic: {motion: '' | ${MOTIONS.join('|')}, btn}`);
      }
      if (tr.simple !== undefined && (typeof tr.simple !== 'string' || !/^([1-9]?S|[LMH]+)$/.test(tr.simple))) errs.push(`${where}.trigger.simple: "6S"-style key or buttons "LMH"`);
    }
  }
  if (mv.projectile !== undefined && isObj(mv.projectile)) {
    const p = mv.projectile;
    if ((p.vy !== undefined && !isNum(p.vy)) || (p.g !== undefined && !isNum(p.g))) errs.push(`${where}.projectile: vy / g must be numbers`);
  }
  if (isObj(mv.cinematic)) {
    const c = mv.cinematic;
    if ((c.endAdv !== undefined && !isInt(c.endAdv)) || (c.endGapM !== undefined && !isNum(c.endGapM))) errs.push(`${where}.cinematic: endAdv integer, endGapM metres`);
  }
  void id;
}

/** Resolves a classic entry's move id for a button ('L'|'M'|'H'|'S'). */
export function classicMoveId(entry: ClassicEntry, btn: 'L' | 'M' | 'H' | 'S'): string {
  const s = btn === 'L' ? 'l' : btn === 'M' ? 'm' : btn === 'H' ? 'h' : 'ex';
  return entry.move.includes('{s}') ? entry.move.split('{s}').join(s) : entry.move;
}

/** SIMPLE EX id for a routed special id: trailing _l|_m|_h -> _ex. */
export function exIdFor(id: string): string {
  return /_(l|m|h)$/i.test(id) ? id.replace(/_(l|m|h)$/i, '_ex') : id + '_ex';
}

function validateFighter(fid: string, raw: unknown, errs: string[], warns: string[]): FighterDef | null {
  const w = `fighters/${fid}.json`;
  if (!isObj(raw)) {
    errs.push(`${w}: not an object`);
    return null;
  }
  const n0 = errs.length;
  if (typeof raw.id !== 'string') errs.push(`${w}.id: string required`);
  else if (raw.id !== fid) warns.push(`${w}.id "${raw.id}" differs from the file name (file name wins)`);
  if (typeof raw.name !== 'string') errs.push(`${w}.name: string required`);
  if (!isNum(raw.heightM) || raw.heightM <= 0) errs.push(`${w}.heightM: number > 0 required`);
  if (!isInt(raw.hp) || raw.hp <= 0) errs.push(`${w}.hp: integer > 0 required`);
  if (!isObj(raw.walk) || !isNum(raw.walk.fwd) || !isNum(raw.walk.back)) errs.push(`${w}.walk: {fwd, back} m/s required`);
  if (!isObj(raw.dash) || !isNum(raw.dash.fwd) || !isNum(raw.dash.back) || !isInt(raw.dash.fwdFrames) || !isInt(raw.dash.backFrames)) {
    errs.push(`${w}.dash: {fwd, back, fwdFrames, backFrames} required`);
  }
  const j = raw.jump;
  if (!isObj(j) || !isInt(j.prejump) || !isInt(j.air) || j.air < 4 || !isInt(j.landing) || !isNum(j.apexM) || !isNum(j.fwdM)) {
    errs.push(`${w}.jump: {prejump, air >= 4, landing, apexM, fwdM} required`);
  }
  if (!isNum(raw.throwRangeM) || raw.throwRangeM <= 0) errs.push(`${w}.throwRangeM: number > 0 required`);
  if (!isObj(raw.hurt) || !isVec2(raw.hurt.stand) || !isVec2(raw.hurt.crouch) || !isVec2(raw.hurt.air)) errs.push(`${w}.hurt: {stand, crouch, air} as [w, h] required`);
  if (!isVec2(raw.pushbox)) errs.push(`${w}.pushbox: [w, h] required`);
  if (!isObj(raw.moves) || Object.keys(raw.moves).length === 0) {
    errs.push(`${w}.moves: non-empty object required`);
    return null;
  }
  const moves = raw.moves;
  for (const id of Object.keys(moves)) validateMove(`${w} moves.${id}`, id, moves[id], moves, errs, warns);
  // simple
  if (!isObj(raw.simple)) errs.push(`${w}.simple: object required`);
  else {
    const sm = raw.simple;
    for (const k of Object.keys(sm)) {
      if (k === 'assist') {
        const a = sm.assist;
        if (!Array.isArray(a) || !a.every((x) => typeof x === 'string')) errs.push(`${w}.simple.assist: array of move ids`);
        else for (const x of a) if (!(x in moves)) errs.push(`${w}.simple.assist: no move "${x}"`);
      } else if (SIMPLE_KEYS.includes(k)) {
        const v = sm[k];
        if (typeof v !== 'string' || !(v in moves)) errs.push(`${w}.simple["${k}"]: no move "${String(v)}"`);
      } else warns.push(`${w}.simple: unknown key "${k}" (ignored)`);
    }
  }
  // classic
  if (!Array.isArray(raw.classic)) errs.push(`${w}.classic: array required`);
  else {
    raw.classic.forEach((e, i) => {
      if (!isObj(e) || typeof e.motion !== 'string' || typeof e.btn !== 'string' || typeof e.move !== 'string') {
        errs.push(`${w}.classic[${i}]: {motion, btn, move} required`);
        return;
      }
      if (!MOTIONS.includes(e.motion)) errs.push(`${w}.classic[${i}].motion "${e.motion}": not one of ${MOTIONS.join(' ')}`);
      if (!/^[LMHS]+$/.test(e.btn)) errs.push(`${w}.classic[${i}].btn "${e.btn}": letters from LMHS`);
      const ent = e as unknown as ClassicEntry;
      const found = (['L', 'M', 'H', 'S'] as const).filter((b) => classicMoveId(ent, b) in moves);
      if (found.length === 0) errs.push(`${w}.classic[${i}].move "${e.move}": resolves to no existing move`);
      for (const b of e.btn.split('') as ('L' | 'M' | 'H' | 'S')[]) {
        if (!(classicMoveId(ent, b) in moves)) warns.push(`${w}.classic[${i}]: button ${b} -> "${classicMoveId(ent, b)}" missing`);
      }
    });
  }
  for (const k of ['intro', 'taunt']) if (raw[k] !== undefined && typeof raw[k] !== 'string') errs.push(`${w}.${k}: clip name string`);
  if (raw.win !== undefined && (!Array.isArray(raw.win) || !raw.win.every((x) => typeof x === 'string'))) errs.push(`${w}.win: array of clip names`);
  if (errs.length !== n0) return null;
  const def = clone(raw) as unknown as FighterDef;
  def.id = fid;
  return def;
}

// ------------------------------------------------------------------ derivation (§5.2)
function isStrikeKind(mv: Move): boolean {
  if (mv.kind === 'throw' || mv.kind === 'cmdgrab' || mv.grab) return false;
  if (mv.projectile) return false;
  if (mv.cinematic) return true;
  return (mv.damage ?? 0) > 0 || (mv.hits ?? []).some((h) => h.damage > 0);
}

const DEFAULT_REACH: Record<'L' | 'M' | 'H', Vec2> = { L: [0.7, 1.25], M: [0.88, 1.2], H: [1.05, 1.2] };

function derive(def: FighterDef, clips: ClipsFile | null, sys: System, warns: string[]): void {
  const w = `fighters/${def.id}.json`;
  for (const id of Object.keys(def.moves)) {
    const mv = def.moves[id];
    const clip = mv.anim && clips ? clips.clips[mv.anim.clip] : undefined;
    if (mv.anim && clips && !clip) warns.push(`${w} moves.${id}: clip "${mv.anim.clip}" not in clips/${def.id}.clips.json`);
    const total1 = mv.startup + mv.active + mv.recovery; // frame after the last move frame
    if (mv.anim && !mv.anim.warp) {
      if (clip) {
        const dur = Math.max(clip.dur, 1 / 30);
        if (clip.contact !== null && clip.contact > 0 && clip.contact < dur) {
          mv.anim.warp = [[0, 0], [mv.startup, clip.contact], [total1, dur]];
        } else {
          mv.anim.warp = [[0, 0], [total1, dur]];
        }
      }
    }
    if (!mv.boxes && isStrikeKind(mv)) {
      const st = mv.kind === 'super1' || mv.kind === 'super3' ? 'H' : moveStrength(id, mv);
      const size = sys.boxes[st];
      let at: Vec2 | null = clip && clip.effector ? clip.effector.at : null;
      if (!at) {
        at = DEFAULT_REACH[st];
        warns.push(`${w} moves.${id}: no boxes and no clip effector -> default ${st} box at ${at[0]} m`);
      }
      const ranges: [number, number][] = mv.hits && mv.hits.length > 0 ? mv.hits.map((h) => [h.f[0], h.f[1]] as [number, number]) : [[mv.startup, mv.startup + mv.active - 1]];
      mv.boxes = ranges.map((f) => ({ f, x: at![0], y: at![1], w: size[0], h: size[1] }) satisfies BoxDef);
    }
  }
}

function buildAnims(def: FighterDef, clips: ClipsFile | null): AnimRef[] {
  const out: AnimRef[] = [];
  const loopOf = (c: string, dflt: boolean): boolean => {
    const ci = clips?.clips[c];
    return ci ? ci.loop : dflt;
  };
  for (const c of SHARED_CLIPS) out.push({ clip: c, warp: null, loop: loopOf(c, LOOPING_SHARED.has(c)), moveId: -1 });
  const ids = Object.keys(def.moves);
  ids.forEach((id, k) => {
    const mv = def.moves[id];
    out.push({ clip: mv.anim?.clip ?? '', warp: mv.anim?.warp ? (mv.anim.warp.map((p) => [p[0], p[1]]) as [number, number][]) : null, loop: false, moveId: k });
  });
  out.push({ clip: def.intro ?? '', warp: null, loop: false, moveId: -1 });
  for (const wn of def.win ?? []) out.push({ clip: wn, warp: null, loop: loopOf(wn, false), moveId: -1 });
  out.push({ clip: def.taunt ?? '', warp: null, loop: false, moveId: -1 });
  // §19.10: then one entry per move with a grab block (move order): the connect clip, time-scaled
  // over the lock (`frames`)
  ids.forEach((id, k) => {
    const g = def.moves[id].grab;
    if (!g) return;
    const clip = g.clip ?? def.moves[id].anim?.clip ?? '';
    const ci = clips?.clips[clip];
    const dur = ci ? ci.dur : g.frames / 60;
    out.push({ clip, warp: [[0, 0], [g.frames, dur]], loop: false, moveId: k });
  });
  return out;
}

/** Anim id of the grab (connect) clip of move `moveKey` (§19.10), or -1. */
export function animGrabId(def: FighterDef, moveKey: string): number {
  let id = animTauntId(def) + 1;
  for (const k of Object.keys(def.moves)) {
    if (!def.moves[k].grab) continue;
    if (k === moveKey) return id;
    id++;
  }
  return -1;
}

/** Anim id helpers (§17 rule 2). */
export function animIntroId(def: FighterDef): number {
  return SHARED_CLIPS.length + Object.keys(def.moves).length;
}
export function animWinId(def: FighterDef, k: number): number {
  const n = (def.win ?? []).length;
  return n > 0 ? animIntroId(def) + 1 + Math.min(k, n - 1) : 0;
}
export function animTauntId(def: FighterDef): number {
  return animIntroId(def) + 1 + (def.win ?? []).length;
}

// ------------------------------------------------------------------ build
export function buildGameData(raw: RawData): GameData {
  const errs: string[] = [];
  const warns: string[] = [];
  const system = validateSystem(raw.system, errs);
  const clips: Record<string, ClipsFile> = {};
  for (const id of Object.keys(raw.clips).sort()) {
    const c = normaliseClips(id, raw.clips[id], errs);
    if (c) clips[id] = c;
  }
  const fighters: Record<string, FighterDef> = {};
  for (const fid of Object.keys(raw.fighters).sort()) {
    const def = validateFighter(fid, raw.fighters[fid], errs, warns);
    if (def) fighters[fid] = def;
  }
  if (errs.length > 0 || !system) {
    throw new Error(`HIT PARADE data invalid (${errs.length} problem${errs.length === 1 ? '' : 's'}):\n  - ${errs.join('\n  - ')}`);
  }
  const anims: Record<string, AnimRef[]> = {};
  for (const fid of Object.keys(fighters)) {
    const def = fighters[fid];
    const cf = clips[fid] ?? null;
    if (!cf) warns.push(`fighters/${fid}.json: clips/${fid}.clips.json not generated yet (warps/boxes not derived from clips)`);
    derive(def, cf, system, warns);
    anims[fid] = buildAnims(def, cf);
  }
  const strings: Record<string, string> = {};
  if (isObj(raw.strings)) for (const k of Object.keys(raw.strings)) if (typeof raw.strings[k] === 'string') strings[k] = raw.strings[k] as string;
  return {
    system,
    fighters,
    clips,
    stages: isObj(raw.stages) ? raw.stages : Array.isArray(raw.stages) ? { list: raw.stages } : {},
    ladder: isObj(raw.ladder) ? raw.ladder : {},
    cpu: isObj(raw.cpu) ? raw.cpu : {},
    strings,
    anims,
    warnings: warns,
  };
}

/** uint32 identity of everything that decides gameplay (system + derived fighters), for NET HELLO. */
export function dataHash(data: GameData): number {
  const ids = Object.keys(data.fighters).sort();
  return hashString(JSON.stringify([data.system, ids.map((id) => data.fighters[id])]));
}

export type { SimpleMap };
