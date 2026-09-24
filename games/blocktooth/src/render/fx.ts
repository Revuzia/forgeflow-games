// BLOCKTOOTH — FxView (fx lane, CONTRACT §6 / §6.1 / §3 / §8 / §12 burst words).
//
// Event-driven, pooled, instanced effects. Everything is sized by the titan height (H), the
// event radius, or — for the comic words — by the camera distance so it reads at every zoom.
//
// Batches (≈ 9 draw calls total, all created at mount, never added/removed later):
//   decals   ground rings / discs (ONE instanced plane, ring drawn in the fragment shader with
//            screen-constant ink edges, optional dashes, optional flash fill)
//   dust     faceted toon puffs + ink hull (collapse plumes, footsteps, smoke, spores, crush pops)
//   fire     faceted UNLIT fireballs + ink hull (explosions, vent eruption column, magma stomp)
//   shards   stretched unlit diamonds oriented along velocity (hit sparks, embers, vacuum streaks)
//   ribbons  one dynamic camera-facing strip buffer (lightning arcs with flicker, vine lashes)
//   sprites  atlas billboards, depth-tested (sparkles, heal crosses, bolts & springs, muzzle flashes)
//   words    atlas billboards, ALWAYS ON TOP (comic burst words — pop-scale, jitter, fade)
// The atlas is a canvas baked once per mount: every BURST_WORDS word on a jagged starburst plus
// a row of icons. Channels are MASKS (R = fill, G = ink, B = backing) so one texture serves every
// colourway; the shader recombines them with per-instance colours.

import * as THREE from 'three';
import type { Enemy, SimEvent, TitanId, World } from '../core/types.ts';
import { BIOMES } from '../data/biomes.ts';
import { TITANS } from '../data/titans.ts';
import { BURST_WORDS } from '../data/strings.ts';
import { addOutline, bakeOutlineNormals, facet, INK, makeToon } from './materials.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

// ─────────────────────────────── constants ───────────────────────────────
/** 2·tan(fov/2) for the 30° camera: screen height in metres at distance D = D · K_VIEW */
const K_VIEW = 2 * Math.tan((30 * Math.PI) / 360);
const Q_MUL = [0.45, 0.75, 1] as const;
const CAP_DECAL = [32, 48, 64] as const;
const CAP_DUST = [160, 300, 440] as const;
const CAP_FIRE = [80, 140, 200] as const;
const CAP_SHARD = [140, 260, 400] as const;
const CAP_SPRITE = [140, 240, 340] as const;
// Burst words on screen at once. 10 at high buried CAISSON-4's hook-lane paint under five overlapping
// words at Size V (boot-integration shot boss_caisson4_hookLane.png); telegraphs must stay readable.
const CAP_WORDS = [3, 4, 5] as const;
// ...and at Size IV-V / during a boss fight even that buried CAISSON-4 and IRON GULLY's lanes (critic
// shots boss_caisson4_hookLane, boss_c4lw_intro, boss_igws_P2_ridgeCharge): each word is sized as a
// fraction of the SCREEN, so at Size V three of them cover the fight. While BUSY (boss alive or rank >= IV):
const BUSY_WORD_CAP = 2;            // live words on screen
const BUSY_SHRINK = 0.6;            // secondary (env / foe / pickup) words shrink to this
const BUSY_ENV_CD = 0.9;            // min cooldown per env word key while a boss is alive (s)
const WORD_DEDUPE_S = 1.2;          // the same word text never repeats within this (s)
/** env/secondary words: dropped when no clear spot exists while busy (never cover the boss or its paint) */
const DROP_WORDS = new Set(['smash', 'propDestroyed', 'floorBreak', 'buildingCollapse', 'bump', 'crush', 'enemyKilled', 'explosion', 'pickup']);
/** words shrunk while busy (full size stays for titan attacks, hooks, rankUp and boss beats) */
const SHRINK_WORDS = new Set([...DROP_WORDS, 'bossHit', 'chest', 'titanHurt', 'levelUp']);
/** max blocker rects (titan + boss + hostile telegraphs) per frame */
const MAX_BLOCK = 24;
/** word placement: side offsets tried, as a fraction of the screen height (world m at the target) */
const WORD_OFFSETS = [0.13, 0.24, 0.36] as const;
const RIBBON_QUADS = 4096;

/** local fallback burst words (ORIGINAL — used only if data/strings.ts lacks a key) */
const FALLBACK_WORDS: Record<string, string[]> = {
  smash: ['KRUNCH!', 'SKRAKK!'], propDestroyed: ['KRUNCH!', 'PLINK!'], floorBreak: ['SKRAKK!', 'GRONK!'],
  buildingCollapse: ['THOOM!', 'WHUMP!'], bump: ['BONK!'], crush: ['SPLNT!', 'CLANK-BOING!'], enemyKilled: ['POP!', 'KLUNK!'],
  bite: ['CHOMP!'], arc: ['BZZAK!'], wireDetonate: ['ZAPPOW!'], pulse: ['WHUMP!'], stomp: ['THOOM!'], vent: ['FWASH!'],
  vine: ['THWAPP!'], spore: ['POOF!'], bloomSpawn: ['SPROING!'], dash: ['FWOOSH!'], ability: ['FWASH!'],
  // per-titan HOOK words (one shared list made MOLO's vacuum shout HEARTHBACK's vent word). Keyed
  // 'ability_<titanId>'; data/strings.ts may override any of them under the same key.
  ability_molo: ['SHLUUURP!', 'GLRRRK!', 'SHOOMP!'], ability_voltkite: ['ZAPPOW!', 'KZZZAK!'],
  ability_hearthback: ['FWASH!', 'KA-FWOOM!'], ability_briarwick: ['SPROING!', 'FWUMPH!', 'KA-BLOOM!'],
  explosion: ['KA-BLAM!'], titanHurt: ['OOF!'], levelUp: ['DING!'], rankUp: ['BIGGER!'], bossHit: ['KLANNG!'],
  bossStagger: ['WOBBLE!'], bossDefeated: ['KRASSSH!'], pickup: ['TINK!'], chest: ['KA-CHUNK!'], generic: ['WHUMP!'],
};

/** per-word-type colourway [fill, backing], size class, priority, cooldown (s) */
interface WordStyle { fill: string; back: string; size: number; prio: number; cd: number; }
const WORD_STYLE: Record<string, WordStyle> = {
  smash:            { fill: '#ffd166', back: '#ff6f5e', size: 0.07, prio: 2, cd: 0.35 },
  propDestroyed:    { fill: '#ffffff', back: '#ff9f43', size: 0.06, prio: 1, cd: 0.55 },
  floorBreak:       { fill: '#ffd166', back: '#ff6f5e', size: 0.075, prio: 2, cd: 0.4 },
  buildingCollapse: { fill: '#fff4dc', back: '#ff4f5e', size: 0.11, prio: 5, cd: 0.25 },
  bump:             { fill: '#ffffff', back: '#8fa7a3', size: 0.06, prio: 1, cd: 1.2 },
  crush:            { fill: '#ffffff', back: '#ff9ec7', size: 0.07, prio: 3, cd: 0.3 },
  enemyKilled:      { fill: '#fff27a', back: '#5b7cff', size: 0.055, prio: 1, cd: 0.5 },
  bite:             { fill: '#ffffff', back: '#3fae7f', size: 0.065, prio: 2, cd: 0.9 },
  arc:              { fill: '#6ff3ff', back: '#23255e', size: 0.065, prio: 2, cd: 0.9 },
  wireDetonate:     { fill: '#fff27a', back: '#3b3f9e', size: 0.1, prio: 4, cd: 0.3 },
  pulse:            { fill: '#9dffcf', back: '#1f6f55', size: 0.065, prio: 2, cd: 1.0 },
  stomp:            { fill: '#ffd166', back: '#ff5a2e', size: 0.075, prio: 2, cd: 0.8 },
  vent:             { fill: '#ffe08a', back: '#ff5a2e', size: 0.12, prio: 4, cd: 0.3 },
  vine:             { fill: '#d8ff7a', back: '#5e8f3a', size: 0.065, prio: 2, cd: 0.9 },
  spore:            { fill: '#f4ffb0', back: '#6b9f3a', size: 0.07, prio: 2, cd: 1.5 },
  bloomSpawn:       { fill: '#ff9ec7', back: '#5e8f3a', size: 0.06, prio: 1, cd: 1.2 },
  dash:             { fill: '#ffffff', back: '#44d2c2', size: 0.06, prio: 1, cd: 1.4 },
  ability:          { fill: '#ffffff', back: '#b98bff', size: 0.09, prio: 3, cd: 0.6 },
  ability_molo:     { fill: '#e8ffd8', back: '#2f8f5a', size: 0.09, prio: 3, cd: 0.6 },
  ability_voltkite: { fill: '#6ff3ff', back: '#3b3f9e', size: 0.09, prio: 3, cd: 0.6 },
  ability_hearthback: { fill: '#ffe08a', back: '#ff5a2e', size: 0.09, prio: 3, cd: 0.6 },
  ability_briarwick: { fill: '#ff9ec7', back: '#5e8f3a', size: 0.09, prio: 3, cd: 0.6 },
  explosion:        { fill: '#ffd166', back: '#e84a3c', size: 0.075, prio: 2, cd: 0.45 },
  titanHurt:        { fill: '#ffffff', back: '#e84a3c', size: 0.065, prio: 2, cd: 1.6 },
  levelUp:          { fill: '#fff27a', back: '#5b7cff', size: 0.075, prio: 3, cd: 0.5 },
  rankUp:           { fill: '#ffd166', back: '#ff4fa0', size: 0.16, prio: 6, cd: 0.1 },
  bossHit:          { fill: '#ffffff', back: '#e84a3c', size: 0.07, prio: 2, cd: 0.7 },
  bossStagger:      { fill: '#fff27a', back: '#ff4fa0', size: 0.11, prio: 5, cd: 0.5 },
  bossDefeated:     { fill: '#ffffff', back: '#ff4f5e', size: 0.14, prio: 6, cd: 0.2 },
  pickup:           { fill: '#fff27a', back: '#ff9f43', size: 0.045, prio: 0, cd: 2.5 },
  chest:            { fill: '#ffd166', back: '#ff9f43', size: 0.09, prio: 4, cd: 0.5 },
  generic:          { fill: '#ffffff', back: '#ff6f5e', size: 0.07, prio: 1, cd: 0.5 },
};

const ABILITY_KEY: Record<string, string> = {
  molo: 'ability_molo', voltkite: 'ability_voltkite', hearthback: 'ability_hearthback', briarwick: 'ability_briarwick',
};

// atlas icons (row after the words)
const IC_STAR4 = 0, IC_STAR8 = 1, IC_PLUS = 2, IC_NUT = 3, IC_SPRING = 4, IC_GEAR = 5, IC_BOLT = 6, IC_PETAL = 7, IC_DOT = 8;
const ICON_COUNT = 9;
const WORD_W = 384, WORD_H = 112, WORD_COLS = 5, ICON_S = 128;

// ─────────────────────────────── small utils ───────────────────────────────
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const rndi = (n: number) => (Math.random() * n) | 0;
const _c = new THREE.Color();
/** hex → linear RGB triple written into out[o..o+2] */
function lin(hex: string | number, out: number[] | Float32Array, o: number): void {
  _c.set(hex);
  out[o] = _c.r; out[o + 1] = _c.g; out[o + 2] = _c.b;
}

interface Timed { t: number; life: number; }
/** fixed pool; dead = t >= life. alloc() takes a dead slot, else steals the oldest-by-cursor */
class Pool<T extends Timed> {
  readonly items: T[] = [];
  private cursor = 0;
  constructor(n: number, make: () => T) { for (let i = 0; i < n; i++) this.items.push(make()); }
  alloc(): T {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      const it = this.items[(this.cursor + k) % n];
      if (it.t >= it.life) { this.cursor = (this.cursor + k + 1) % n; return it; }
    }
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % n;
    return it;
  }
  clear(): void { for (const it of this.items) { it.t = 1; it.life = 0; } }
}

// ─────────────────────────────── item types ───────────────────────────────
interface Decal extends Timed {
  x: number; y: number; z: number;
  r0: number; r1: number;          // radius start → end (m)
  thick: number;                   // band thickness (m); ≤ 0 → use `inner`
  inner: number;                   // fixed inner fraction when thick ≤ 0
  dashes: number; spin: number; rot: number;
  fill: number;                    // interior flash alpha (0..1) at t = 0
  a0: number;                      // starting alpha
  col: number[];                   // linear rgb
  follow: boolean;                 // rides the titan
}
interface Part extends Timed {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  s0: number; s1: number;          // size at birth → peak
  peakAt: number;                  // 0..1 of life where it peaks
  drag: number; grav: number;
  rot: number; vrot: number;
  c0: number[]; c1: number[];      // colour birth → death (linear)
  home: number;                    // 1 = steer to the vacuum mouth
  stretch: number;                 // shards: length / width
}
interface SPart extends Timed {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  size: number; rot: number; vrot: number; grav: number; drag: number;
  icon: number; fill: number[]; back: number[];
  pop: number;                     // 1 = pop-scale in, shrink out; 0 = flash (constant then fade)
}
interface Word extends Timed {
  x: number; y: number; z: number;
  h: number; cell: number; fill: number[]; back: number[];
  rot: number; prio: number; jx: number; jy: number;
}
interface Bolt extends Timed {
  n: number;                       // polyline points
  base: Float32Array;              // xyz control points
  pts: Float32Array;               // jittered xyz (n_sub)
  sub: number;
  jitT: number;
  amp: number;                     // jitter amplitude (m)
  wPx: number;
  core: number[]; glow: number[];
  vine: boolean;                   // vine lash ribbon instead of lightning
}

// ─────────────────────────────── shaders ───────────────────────────────
const DECAL_VERT = /* glsl */ `
attribute vec4 aFx;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vFx;
void main() {
  vUv = uv;
  vFx = aFx;
  vCol = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const DECAL_FRAG = /* glsl */ `
uniform vec3 uInk;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vFx;   // alpha, inner, dashes, fill
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float fw = max(fwidth(r), 1e-4);
  if (r > 1.0 + fw) discard;
  float inner = vFx.y;
  float outerIn = 1.0 - smoothstep(1.0 - fw, 1.0, r);
  float innerOut = inner > 0.001 ? smoothstep(inner - fw, inner, r) : 1.0;
  float band = outerIn * innerOut;
  if (vFx.z > 0.5) {
    float d = fract(atan(p.y, p.x) / 6.2831853 * vFx.z);
    band *= smoothstep(0.0, 0.05, d) * (1.0 - smoothstep(0.52, 0.57, d));
  }
  float ink = 2.2 * fw;
  float inkO = smoothstep(1.0 - ink - fw, 1.0 - ink, r);
  float inkI = inner > 0.001 ? 1.0 - smoothstep(inner + ink, inner + ink + fw, r) : 0.0;
  float inkMask = max(inkO, inkI);
  float g = inner < 0.999 ? clamp((r - inner) / max(1.0 - inner, 1e-3), 0.0, 1.0) : 1.0;
  vec3 bandCol = mix(vCol * (0.82 + 0.3 * g), uInk, inkMask);
  float fillMask = (1.0 - innerOut) * vFx.w;
  vec3 fillCol = mix(vCol, vec3(1.0), 0.4);
  vec3 col = mix(fillCol, bandCol, band);
  float a = max(band, fillMask) * vFx.x;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SPRITE_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aSize;   // w, h, rot
attribute vec4 aUV;     // u0, v0, u1, v1
attribute vec4 aFill;   // rgb + alpha
attribute vec3 aBack;
varying vec2 vUv;
varying vec4 vFill;
varying vec3 vBack;
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float c = cos(aSize.z), s = sin(aSize.z);
  vec2 q = position.xy * aSize.xy;
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  gl_Position = projectionMatrix * mv;
  vUv = vec2(mix(aUV.x, aUV.z, uv.x), mix(aUV.y, aUV.w, uv.y));
  vFill = aFill;
  vBack = aBack;
}`;
const SPRITE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uInk;
varying vec2 vUv;
varying vec4 vFill;
varying vec3 vBack;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vFill.a;
  if (a < 0.02) discard;
  float sum = max(t.r + t.g + t.b, 1e-3);
  vec3 wgt = t.rgb / sum;
  vec3 col = wgt.r * vFill.rgb + wgt.g * uInk + wgt.b * vBack;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ─────────────────────────────── atlas ───────────────────────────────
interface Atlas { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement; words: Map<string, number>; cells: Float32Array; iconBase: number; lists: Record<string, number[]>; }

function hash01(i: number, salt: number): number {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const FILL = 'rgb(255,0,0)', INKC = 'rgb(0,255,0)', BACK = 'rgb(0,0,255)';
const FONT = '"Anton", Impact, "Haettenschweiler", "Arial Black", "Arial Narrow Bold", sans-serif';

function starPath(x: CanvasRenderingContext2D, cx: number, cy: number, n: number, r0: number, r1: number, rot: number, sx = 1, sy = 1, seed = 0): void {
  x.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const j = seed ? 0.88 + 0.24 * hash01(i, seed) : 1;
    const r = (i % 2 === 0 ? r0 : r1) * j;
    const px = cx + Math.cos(a) * r * sx, py = cy + Math.sin(a) * r * sy;
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.closePath();
}

function drawWord(x: CanvasRenderingContext2D, word: string, ox: number, oy: number, idx: number): void {
  const cx = ox + WORD_W / 2, cy = oy + WORD_H / 2;
  let size = 74;
  x.font = `${size}px ${FONT}`;
  let tw = x.measureText(word).width;
  const maxW = WORD_W - 70;
  if (tw > maxW) { size = Math.floor(size * maxW / tw); x.font = `${size}px ${FONT}`; tw = x.measureText(word).width; }
  // starburst backing sized to the word
  const rx = Math.min(WORD_W / 2 - 5, tw / 2 + 30), ry = WORD_H / 2 - 5;
  starPath(x, cx, cy, 11 + (idx % 4), 1, 0.8, hash01(idx, 3) * 0.6, rx, ry, 17 + idx);
  x.fillStyle = BACK; x.fill();
  x.lineWidth = 5; x.lineJoin = 'miter'; x.strokeStyle = INKC; x.stroke();
  // skewed, heavy lettering: drop shadow → ink stroke → fill
  x.save();
  x.translate(cx, cy + size * 0.06);
  x.transform(1, 0, -0.14, 1, 0, 0);
  x.rotate((hash01(idx, 9) - 0.5) * 0.08);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round';
  x.lineWidth = 12; x.strokeStyle = INKC; x.fillStyle = INKC;
  x.strokeText(word, 4, 5); x.fillText(word, 4, 5);
  x.strokeText(word, 0, 0);
  x.fillStyle = FILL; x.fillText(word, 0, 0);
  x.restore();
}

function drawIcon(x: CanvasRenderingContext2D, icon: number, ox: number, oy: number): void {
  const c = ICON_S / 2, cx = ox + c, cy = oy + c;
  x.save();
  x.lineJoin = 'round'; x.lineCap = 'round';
  const inked = (w: number) => { x.lineWidth = w; x.strokeStyle = INKC; x.stroke(); };
  switch (icon) {
    case IC_STAR4:
      starPath(x, cx, cy, 4, c - 8, (c - 8) * 0.3, -Math.PI / 2);
      x.fillStyle = FILL; x.fill(); inked(6);
      break;
    case IC_STAR8:
      starPath(x, cx, cy, 8, c - 6, (c - 6) * 0.42, 0, 1, 1, 5);
      x.fillStyle = FILL; x.fill(); inked(5);
      starPath(x, cx, cy, 8, (c - 6) * 0.55, (c - 6) * 0.25, 0.2);
      x.fillStyle = BACK; x.fill();
      break;
    case IC_PLUS: {
      const a = 18, l = c - 10;
      x.beginPath();
      x.moveTo(cx - a, cy - l); x.lineTo(cx + a, cy - l); x.lineTo(cx + a, cy - a); x.lineTo(cx + l, cy - a); x.lineTo(cx + l, cy + a);
      x.lineTo(cx + a, cy + a); x.lineTo(cx + a, cy + l); x.lineTo(cx - a, cy + l); x.lineTo(cx - a, cy + a); x.lineTo(cx - l, cy + a);
      x.lineTo(cx - l, cy - a); x.lineTo(cx - a, cy - a); x.closePath();
      x.fillStyle = FILL; x.fill(); inked(7);
      break;
    }
    case IC_NUT: {
      x.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; const px = cx + Math.cos(a) * (c - 12), py = cy + Math.sin(a) * (c - 12); if (i) x.lineTo(px, py); else x.moveTo(px, py); }
      x.closePath(); x.fillStyle = FILL; x.fill(); inked(7);
      x.beginPath(); x.arc(cx, cy, 17, 0, Math.PI * 2); x.fillStyle = INKC; x.fill();
      x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(cx, cy, 11, 0, Math.PI * 2); x.fill();
      break;
    }
    case IC_SPRING: {
      x.beginPath();
      const n = 7;
      for (let i = 0; i <= n; i++) { const px = ox + 18 + (i / n) * (ICON_S - 36); const py = cy + (i % 2 ? -26 : 26); if (i) x.lineTo(px, py); else x.moveTo(px, py); }
      x.lineWidth = 20; x.strokeStyle = INKC; x.stroke();
      x.lineWidth = 9; x.strokeStyle = FILL; x.stroke();
      break;
    }
    case IC_GEAR: {
      x.beginPath();
      const teeth = 8;
      for (let i = 0; i < teeth * 4; i++) {
        const a = (i / (teeth * 4)) * Math.PI * 2;
        const r = (i % 4 < 2) ? c - 8 : c - 22;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        if (i) x.lineTo(px, py); else x.moveTo(px, py);
      }
      x.closePath(); x.fillStyle = FILL; x.fill(); inked(6);
      x.beginPath(); x.arc(cx, cy, 14, 0, Math.PI * 2); x.fillStyle = INKC; x.fill();
      x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(cx, cy, 8, 0, Math.PI * 2); x.fill();
      break;
    }
    case IC_BOLT: {
      x.translate(cx, cy); x.rotate(-0.6);
      x.beginPath(); x.rect(-10, -8, 20, 52); x.fillStyle = FILL; x.fill(); inked(6);
      for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(-10, 2 + i * 11); x.lineTo(10, 8 + i * 11); inked(4); }
      x.beginPath(); x.rect(-24, -30, 48, 22); x.fillStyle = FILL; x.fill(); inked(6);
      break;
    }
    case IC_PETAL: {
      x.beginPath(); x.ellipse(cx, cy, c - 14, (c - 14) * 0.5, -0.5, 0, Math.PI * 2);
      x.fillStyle = FILL; x.fill(); inked(6);
      x.beginPath(); x.moveTo(cx - 30, cy + 18); x.lineTo(cx + 28, cy - 16); x.lineWidth = 4; x.strokeStyle = BACK; x.stroke();
      break;
    }
    case IC_DOT: {
      x.beginPath(); x.arc(cx, cy, c - 16, 0, Math.PI * 2); x.fillStyle = FILL; x.fill(); inked(7);
      x.beginPath(); x.arc(cx - 12, cy - 12, 10, 0, Math.PI * 2); x.fillStyle = BACK; x.fill();
      break;
    }
  }
  x.restore();
}

function collectWords(): Record<string, string[]> {
  const src = (BURST_WORDS ?? {}) as Record<string, string[]>;
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(FALLBACK_WORDS)) out[k] = (src[k] && src[k].length) ? src[k].slice() : FALLBACK_WORDS[k].slice();
  for (const k of Object.keys(src)) if (!out[k] && src[k].length) out[k] = src[k].slice();
  return out;
}

function bakeAtlas(prev: Atlas | null): Atlas {
  const lists = collectWords();
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const k of Object.keys(lists)) for (const wd of lists[k]) if (!seen.has(wd) && uniq.length < 120) { seen.add(wd); uniq.push(wd); }
  const rows = Math.ceil(uniq.length / WORD_COLS);
  const W = 2048;
  const needH = rows * WORD_H + ICON_S;
  let Hh = 256; while (Hh < needH) Hh *= 2;
  const canvas = prev ? prev.canvas : document.createElement('canvas');
  canvas.width = W; canvas.height = Hh;
  const x = canvas.getContext('2d')!;
  x.clearRect(0, 0, W, Hh);
  const words = new Map<string, number>();
  const nCells = uniq.length + ICON_COUNT;
  const cells = new Float32Array(nCells * 5);   // u0 v0 u1 v1 aspect
  uniq.forEach((wd, i) => {
    const ox = (i % WORD_COLS) * WORD_W, oy = Math.floor(i / WORD_COLS) * WORD_H;
    drawWord(x, wd, ox, oy, i);
    words.set(wd, i);
    cells.set([ox / W, 1 - (oy + WORD_H) / Hh, (ox + WORD_W) / W, 1 - oy / Hh, WORD_W / WORD_H], i * 5);
  });
  const iconBase = uniq.length;
  const iy = rows * WORD_H;
  for (let k = 0; k < ICON_COUNT; k++) {
    const ox = k * ICON_S;
    drawIcon(x, k, ox, iy);
    cells.set([(ox + 1) / W, 1 - (iy + ICON_S - 1) / Hh, (ox + ICON_S - 1) / W, 1 - (iy + 1) / Hh, 1], (iconBase + k) * 5);
  }
  const listIdx: Record<string, number[]> = {};
  for (const k of Object.keys(lists)) listIdx[k] = lists[k].map((wd) => words.get(wd)!).filter((v) => v !== undefined);
  let tex: THREE.CanvasTexture;
  if (prev) { tex = prev.tex; tex.needsUpdate = true; }
  else {
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;     // channel MASKS, not colours
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.premultiplyAlpha = false;
  }
  return { tex, canvas, words, cells, iconBase, lists: listIdx };
}

// ─────────────────────────────── sprite batch ───────────────────────────────
class SpriteBatch {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aSize: THREE.InstancedBufferAttribute;
  private readonly aUV: THREE.InstancedBufferAttribute;
  private readonly aFill: THREE.InstancedBufferAttribute;
  private readonly aBack: THREE.InstancedBufferAttribute;
  private readonly attrs: THREE.InstancedBufferAttribute[];   // cached: no per-frame array literal
  readonly cap: number;
  n = 0;
  constructor(cap: number, mat: THREE.ShaderMaterial, name: string) {
    this.cap = cap;
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    const mk = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aPos = mk(3); this.aSize = mk(3); this.aUV = mk(4); this.aFill = mk(4); this.aBack = mk(3);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aSize', this.aSize); g.setAttribute('aUV', this.aUV);
    g.setAttribute('aFill', this.aFill); g.setAttribute('aBack', this.aBack);
    this.attrs = [this.aPos, this.aSize, this.aUV, this.aFill, this.aBack];
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
  }
  begin(): void { this.n = 0; }
  push(x: number, y: number, z: number, w: number, h: number, rot: number, cells: Float32Array, cell: number,
    fill: number[], alpha: number, back: number[]): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const P = this.aPos.array as Float32Array, S = this.aSize.array as Float32Array, U = this.aUV.array as Float32Array;
    const F = this.aFill.array as Float32Array, B = this.aBack.array as Float32Array;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    S[i * 3] = w; S[i * 3 + 1] = h; S[i * 3 + 2] = rot;
    const c = cell * 5;
    U[i * 4] = cells[c]; U[i * 4 + 1] = cells[c + 1]; U[i * 4 + 2] = cells[c + 2]; U[i * 4 + 3] = cells[c + 3];
    F[i * 4] = fill[0]; F[i * 4 + 1] = fill[1]; F[i * 4 + 2] = fill[2]; F[i * 4 + 3] = alpha;
    B[i * 3] = back[0]; B[i * 3 + 1] = back[1]; B[i * 3 + 2] = back[2];
  }
  end(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n === 0) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }
  dispose(): void { this.geo.dispose(); }
}

// ─────────────────────────────── the view ───────────────────────────────
export class FxView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private mounted = false;
  private epoch = 0;
  // pools
  private decals!: Pool<Decal>;
  private dust!: Pool<Part>;
  private fire!: Pool<Part>;
  private shards!: Pool<Part>;
  private sprites!: Pool<SPart>;
  private words!: Pool<Word>;
  private bolts!: Pool<Bolt>;
  // meshes
  private decalMesh: THREE.InstancedMesh | null = null;
  private decalFx: THREE.InstancedBufferAttribute | null = null;
  private dustMesh: THREE.InstancedMesh | null = null;
  private fireMesh: THREE.InstancedMesh | null = null;
  private shardMesh: THREE.InstancedMesh | null = null;
  private ribbon: THREE.Mesh | null = null;
  private ribPos: THREE.BufferAttribute | null = null;
  private ribCol: THREE.BufferAttribute | null = null;
  private spriteWorld: SpriteBatch | null = null;
  private spriteTop: SpriteBatch | null = null;
  private atlas: Atlas | null = null;
  // state
  private titanId: TitanId = 'molo';
  private glow: number[] = [1, 1, 1];
  private accent: number[] = [1, 1, 1];
  private dustCol: number[] = [1, 1, 1];
  private smokeCol: number[] = [0.3, 0.3, 0.3];
  private night = false;
  private wordCd = new Map<string, number>();
  private wordTokens = 4;
  // burst-word layout (screen space, NDC): titan / boss / hostile-telegraph rects words must not cover
  private busy = false;
  private bossLive = false;
  private bossSx = 0;                               // boss centre NDC x (words go to the other side)
  private readonly vp = new THREE.Matrix4();
  private readonly clip = new THREE.Vector4();
  private readonly blk = new Float32Array(MAX_BLOCK * 4);
  private nBlk = 0;
  private readonly titanR = new Float32Array(4);
  private readonly cand = new Float32Array(4);
  private readonly cellShown = new Float64Array(512);
  private healAcc = 0;
  private healCd = 0;
  private pickupCd = 0;
  private vacSpawnAcc = 0;
  private vacRingCd = 0;
  private lastTime = 0;
  private readonly enemyMap = new Map<number, Enemy>();
  private enemyMapTick = -1;
  // scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly camDir = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3(0.7071, 0, -0.7071);
  private readonly col = new THREE.Color();
  private readonly tmp3 = [0, 0, 0];
  private readonly ink = [0, 0, 0];
  private readonly white = [1, 1, 1];
  /** smallest readable shard width this frame (m) ≈ 2.5 px */
  private minShard = 0.02;
  /** largest single puff this frame (m) ≈ 10 % of the screen height — plumes are MANY puffs */
  private maxPuff = 10;

  constructor(ctx: ViewCtx) { this.ctx = ctx; this.root.name = 'fx'; }

  /** live counts per batch (scratch page / debug overlay) */
  stats(): Record<string, number> {
    const live = <T extends Timed>(p: Pool<T> | undefined) => (p ? p.items.reduce((n, it) => n + (it.t >= 0 && it.t < it.life ? 1 : 0), 0) : 0);
    return { decals: live(this.decals), dust: live(this.dust), fire: live(this.fire), shards: live(this.shards), sprites: live(this.sprites), words: live(this.words), bolts: live(this.bolts) };
  }

  mount(w: World): void {
    const ep = ++this.epoch;
    const q = this.ctx.quality.level;
    const biome = BIOMES[w.biomeId];
    this.night = biome.time === 'night';
    this.titanId = w.titanId;
    const tc = TITANS[w.titanId].colors;
    lin(tc.glow, this.glow, 0);
    lin(tc.accent, this.accent, 0);
    lin(w.biomeId === 'whitestacks' ? '#f3f5f8' : w.biomeId === 'lockwater' ? '#b7b2c8' : '#f1e6cf', this.dustCol, 0);
    lin(this.night ? '#6a6480' : '#9a93a0', this.smokeCol, 0);
    lin(INK, this.ink, 0);

    // pools
    const mkDecal = (): Decal => ({ t: 1, life: 0, x: 0, y: 0, z: 0, r0: 1, r1: 1, thick: 0, inner: 0.8, dashes: 0, spin: 0, rot: 0, fill: 0, a0: 1, col: [1, 1, 1], follow: false });
    const mkPart = (): Part => ({ t: 1, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0, s1: 1, peakAt: 0.3, drag: 0, grav: 0, rot: 0, vrot: 0, c0: [1, 1, 1], c1: [1, 1, 1], home: 0, stretch: 1 });
    const mkSP = (): SPart => ({ t: 1, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, rot: 0, vrot: 0, grav: 0, drag: 0, icon: 0, fill: [1, 1, 1], back: [1, 1, 1], pop: 1 });
    const mkWord = (): Word => ({ t: 1, life: 0, x: 0, y: 0, z: 0, h: 1, cell: 0, fill: [1, 1, 1], back: [1, 1, 1], rot: 0, prio: 0, jx: 0, jy: 0 });
    const mkBolt = (): Bolt => ({ t: 1, life: 0, n: 0, base: new Float32Array(3 * 16), pts: new Float32Array(3 * 16 * 12), sub: 0, jitT: 0, amp: 0, wPx: 3, core: [1, 1, 1], glow: [1, 1, 1], vine: false });
    this.decals = new Pool(CAP_DECAL[q], mkDecal);
    this.dust = new Pool(CAP_DUST[q], mkPart);
    this.fire = new Pool(CAP_FIRE[q], mkPart);
    this.shards = new Pool(CAP_SHARD[q], mkPart);
    this.sprites = new Pool(CAP_SPRITE[q], mkSP);
    this.words = new Pool(CAP_WORDS[q], mkWord);
    this.bolts = new Pool(40, mkBolt);

    // decals
    {
      const plane = new THREE.PlaneGeometry(2, 2);
      plane.rotateX(-Math.PI / 2);
      const aFx = new THREE.InstancedBufferAttribute(new Float32Array(CAP_DECAL[q] * 4), 4);
      aFx.setUsage(THREE.DynamicDrawUsage);
      plane.setAttribute('aFx', aFx);
      const mat = new THREE.ShaderMaterial({
        name: 'fxDecal', vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG,
        uniforms: { uInk: { value: new THREE.Color(INK) } },
        transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const im = new THREE.InstancedMesh(plane, mat, CAP_DECAL[q]);
      im.name = 'fx:decals';
      im.setColorAt(0, this.col.setRGB(1, 1, 1));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; im.count = 0; im.renderOrder = 2;
      this.decalMesh = im; this.decalFx = aFx;
      this.root.add(im);
      this.disposables.push(plane, mat);
    }
    // dust + fire puffs (faceted icosa, ink hull)
    {
      let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.5, 1);
      g = facet(g); bakeOutlineNormals(g); g.computeBoundingSphere();
      // emissive lift: the toon SHADE band on a puff sits near light grey, so dust reads as dust, not rock
      const dustMat = makeToon({ color: '#ffffff', emissive: '#8a8278', emissiveIntensity: 1 });
      const fireMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const dm = new THREE.InstancedMesh(g, dustMat, CAP_DUST[q]);
      const fm = new THREE.InstancedMesh(g, fireMat, CAP_FIRE[q]);
      dm.name = 'fx:dust'; fm.name = 'fx:fire';
      for (const im of [dm, fm]) {
        im.setColorAt(0, this.col.setRGB(1, 1, 1));
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false; im.count = 0;
        im.castShadow = false; im.receiveShadow = im === dm;
        addOutline(im, 1.6);
        this.root.add(im);
      }
      this.dustMesh = dm; this.fireMesh = fm;
      this.disposables.push(g, dustMat, fireMat);
    }
    // shards
    {
      const g = new THREE.OctahedronGeometry(0.5, 0);
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const im = new THREE.InstancedMesh(g, mat, CAP_SHARD[q]);
      im.name = 'fx:shards';
      im.setColorAt(0, this.col.setRGB(1, 1, 1));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; im.count = 0;
      this.shardMesh = im;
      this.root.add(im);
      this.disposables.push(g, mat);
    }
    // ribbons (lightning + vines)
    {
      const g = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(RIBBON_QUADS * 6 * 3), 3);
      const col = new THREE.BufferAttribute(new Float32Array(RIBBON_QUADS * 6 * 4), 4);
      pos.setUsage(THREE.DynamicDrawUsage); col.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', pos); g.setAttribute('color', col);
      g.setDrawRange(0, 0);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(g, mat);
      m.name = 'fx:ribbons'; m.frustumCulled = false; m.renderOrder = 4;
      this.ribbon = m; this.ribPos = pos; this.ribCol = col;
      this.root.add(m);
      this.disposables.push(g, mat);
    }
    // sprites + words (one atlas)
    {
      this.atlas = bakeAtlas(null);
      const mk = (top: boolean) => new THREE.ShaderMaterial({
        name: top ? 'fxWords' : 'fxSprites', vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG,
        uniforms: { uAtlas: { value: this.atlas!.tex }, uInk: { value: new THREE.Color(INK) } },
        transparent: true, depthWrite: false, depthTest: !top, side: THREE.DoubleSide,
      });
      const mw = mk(false), mt = mk(true);
      this.spriteWorld = new SpriteBatch(CAP_SPRITE[q], mw, 'fx:sprites');
      this.spriteTop = new SpriteBatch(CAP_WORDS[q] + 2, mt, 'fx:words');
      this.spriteWorld.mesh.renderOrder = 5;
      this.spriteTop.mesh.renderOrder = 20;
      this.root.add(this.spriteWorld.mesh, this.spriteTop.mesh);
      this.disposables.push(mw, mt, this.atlas.tex, this.spriteWorld, this.spriteTop);
      // Anton (the HUD display face) may finish loading after mount: re-bake once it has.
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts && typeof fonts.ready?.then === 'function') {
        fonts.ready.then(() => {
          if (ep !== this.epoch || !this.atlas) return;
          try { if (fonts.check('40px "Anton"')) this.atlas = bakeAtlas(this.atlas); } catch { /* keep the first bake */ }
        }).catch(() => { /* ignore */ });
      }
    }

    this.wordCd.clear();
    this.wordTokens = 4;
    this.cellShown.fill(-99);
    this.healAcc = 0; this.healCd = 0; this.pickupCd = 0; this.vacSpawnAcc = 0; this.vacRingCd = 0;
    this.enemyMapTick = -1;
    this.ctx.scene.add(this.root);
    this.mounted = true;
  }

  unmount(): void {
    this.epoch++;
    this.mounted = false;
    this.root.removeFromParent();
    for (const im of [this.decalMesh, this.dustMesh, this.fireMesh, this.shardMesh]) im?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.clear();
    this.decalMesh = this.dustMesh = this.fireMesh = this.shardMesh = null;
    this.ribbon = null; this.ribPos = null; this.ribCol = null; this.decalFx = null;
    this.spriteWorld = this.spriteTop = null;
    this.atlas = null;
    this.enemyMap.clear();
  }

  // ─────────────────────────────── per frame ───────────────────────────────
  update(w: World, f: FrameInfo): void {
    if (!this.mounted) return;
    const dt = f.frozen ? 0 : f.dt;
    this.camRight.setFromMatrixColumn(this.camera().matrixWorld, 0);
    this.camRight.y = 0;
    if (this.camRight.lengthSq() < 1e-6) this.camRight.set(0.7071, 0, -0.7071); else this.camRight.normalize();
    this.lastTime = f.time;
    this.minShard = f.camDist * K_VIEW * 0.0035;
    this.maxPuff = f.camDist * K_VIEW * 0.1;
    this.layoutBlockers(w);
    if (!f.frozen) {
      this.wordTokens = Math.min(4, this.wordTokens + dt * 4.5);
      for (const [k, v] of this.wordCd) { if (v > 0) this.wordCd.set(k, v - dt); }
      this.healCd = Math.max(0, this.healCd - dt);
      this.pickupCd = Math.max(0, this.pickupCd - dt);
      this.vacRingCd = Math.max(0, this.vacRingCd - dt);
      for (let i = 0; i < f.events.length; i++) this.onEvent(w, f.events[i], f);
      this.stepVacuum(w, f, dt);
    }
    this.camera().getWorldDirection(this.camDir);
    this.drawDecals(w, f, dt);
    this.drawParts(this.dust, this.dustMesh!, w, dt, false);
    this.drawParts(this.fire, this.fireMesh!, w, dt, false);
    this.drawParts(this.shards, this.shardMesh!, w, dt, true);
    this.drawRibbons(w, f, dt);
    this.drawSprites(f, dt);
    this.drawWords(f, dt);
  }

  private camera(): THREE.PerspectiveCamera { return this.ctx.camera; }

  // ─────────────────────────────── event dispatch ───────────────────────────────
  private onEvent(w: World, e: SimEvent, f: FrameInfo): void {
    const T = w.titan;
    const H = T.height;
    const qm = Q_MUL[this.ctx.quality.level] ?? 1;
    const rf = this.ctx.quality.reduceFlashing;
    switch (e.type) {
      case 'footstep': {
        if (e.heavy >= 0.24) {
          this.ring(e.x, e.z, T.radius * 0.8, T.radius * (1.6 + e.heavy * 1.6), 0.45, this.dustCol, 0.55, H * 0.07);
        }
        if (e.heavy >= 0.49) {
          const n = Math.round((4 + e.heavy * 6) * qm);
          for (let i = 0; i < n; i++) {
            const a = rnd(0, Math.PI * 2), r = T.radius * rnd(0.5, 1.1);
            this.puff(this.dust, e.x + Math.cos(a) * r, 0.05 * H, e.z + Math.sin(a) * r,
              Math.cos(a) * H * rnd(0.6, 1.4), H * rnd(0.1, 0.35), Math.sin(a) * H * rnd(0.6, 1.4),
              H * 0.05, H * rnd(0.14, 0.24), rnd(0.6, 0.9), this.dustCol, this.dustCol, 2.2, -H * 0.2);
          }
        }
        break;
      }
      case 'smash': {
        this.sparks(e.x, 0.4 * H, e.z, Math.round(3 * qm) + 1, H * 0.9, '#fff4dc', '#ffd166', H);
        this.dustBurst(e.x, e.z, H * (0.25 + e.tier * 0.12), Math.round(3 * qm) + 1, H * 0.12, 0.7);
        this.word('smash', e.x, H * 0.7, e.z, f);
        break;
      }
      case 'floorBreak': {
        const b = w.city.buildings[e.id];
        if (b && b.id === e.id) {
          const n = Math.round((6 + e.tier * 3) * qm);
          this.dustRect(b.x, b.z, b.w, b.d, n, Math.max(0.8, b.floorH * 0.5), 0.9);
          if (Math.random() < 0.5) this.word('floorBreak', b.x, Math.min(b.floorH * (e.remaining + 1), H * 1.2), b.z, f);
        }
        break;
      }
      case 'buildingCollapse': {
        const s = Math.max(e.w, e.d);
        const n = Math.round((14 + e.tier * 6) * qm);
        // plume: a rising column + a ground-hugging skirt
        for (let i = 0; i < n; i++) {
          const up = i < n * 0.55;
          const x = e.x + rnd(-0.45, 0.45) * e.w, z = e.z + rnd(-0.45, 0.45) * e.d;
          const out = up ? 0.15 : 1;
          const dx = x - e.x, dz = z - e.z;
          this.puff(this.dust, x, up ? rnd(0.1, 0.6) * e.h : s * 0.05, z,
            dx * out * rnd(0.6, 1.6), up ? rnd(0.25, 0.6) * e.h : s * 0.05, dz * out * rnd(0.6, 1.6),
            s * 0.08, s * rnd(0.2, 0.34), rnd(1.1, 1.7), this.dustCol, this.dustCol, up ? 1.4 : 2.2, up ? -0.05 * e.h : 0);
        }
        this.ring(e.x, e.z, s * 0.5, s * 1.35, 0.7, this.dustCol, 0.8, s * 0.12);
        this.word('buildingCollapse', e.x, Math.max(e.h * 0.8, H * 0.8), e.z, f);
        break;
      }
      case 'propDestroyed': {
        const metal = e.kind !== 'tree' && e.kind !== 'bench' && e.kind !== 'snowbank' && e.kind !== 'barrier' && e.kind !== 'kiosk';
        this.dustBurst(e.x, e.z, 0.8, Math.round(2 * qm) + 1, 0.9, 0.55);
        if (metal) this.sparks(e.x, 0.8, e.z, Math.round(3 * qm) + 1, 5, '#ffffff', '#ffd166', Math.max(1.2, H * 0.4));
        if (T.rank <= 1 && Math.random() < 0.4) this.word('propDestroyed', e.x, 1.6 + H * 0.3, e.z, f);
        break;
      }
      case 'bump': {
        this.dustBurst(e.x, e.z, H * 0.3, 3, H * 0.12, 0.6);
        this.word('bump', e.x, H * 0.9, e.z, f);
        break;
      }
      case 'titanAttack': {
        if (e.attack === 'curbBite' && e.hits > 0) {
          const hx = T.x + Math.sin(e.dir) * e.r * 0.7, hz = T.z + Math.cos(e.dir) * e.r * 0.7;
          this.sparks(hx, H * 0.35, hz, Math.round(4 * qm) + 1, H * 1.2, '#ffffff', '#f1e4c8', H);
          this.word('bite', hx, H * 0.95, hz, f);
        } else if (e.attack === 'forkArc' && e.hits > 0 && Math.random() < 0.35) {
          this.word('arc', e.x + Math.sin(e.dir) * e.r * 0.5, H * 1.0, e.z + Math.cos(e.dir) * e.r * 0.5, f);
        }
        break;
      }
      case 'arc': {
        const kind = e.kind;
        const core = kind === 'fork' ? '#ffffff' : '#fffbe0';
        const glow = kind === 'fork' ? '#6ff3ff' : kind === 'spark' ? '#ffe066' : '#c49bff';
        const y0 = kind === 'fork' ? H * 0.6 : H * 0.3;
        this.lightning(e.pts, y0, H * 0.3, H, kind === 'fork' ? 3.2 : 2.4, core, glow, 0.16);
        // impact sparks at every hop
        for (let i = 2; i + 1 < e.pts.length; i += 2) this.sparks(e.pts[i], H * 0.3, e.pts[i + 1], Math.round(2 * qm) + 1, H * 1.1, '#ffffff', glow, H * 0.8);
        break;
      }
      case 'wireDetonate': {
        const p = e.pts;
        for (let i = 0; i + 3 < p.length; i += 4) {
          const seg = [p[i], p[i + 1], p[i + 2], p[i + 3]];
          for (let k = 0; k < 2; k++) this.lightning(seg, H * rnd(0.15, 0.5), H * rnd(0.15, 0.5), H, 3.6, '#ffffff', '#6ff3ff', 0.26);
          const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
          const n = Math.max(2, Math.min(7, Math.round(len / (H * 0.9) * qm)));
          for (let k = 0; k < n; k++) {
            const u = (k + 0.5) / n;
            const x = p[i] + (p[i + 2] - p[i]) * u, z = p[i + 1] + (p[i + 3] - p[i + 1]) * u;
            this.explosion(x, z, H * 0.34, '#ffffff', '#6ff3ff', '#3b3f9e', 0.45, H);
          }
          this.ring((p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2, H * 0.3, Math.max(H * 1.2, len * 0.55), 0.45, L('#6ff3ff'), 0.8, H * 0.12);
        }
        if (p.length >= 2) this.word('wireDetonate', p[0], H * 1.1, p[1], f);
        break;
      }
      case 'pulse': {
        this.ring(e.x, e.z, T.radius, e.r, 0.5, this.glow, 0.9, H * 0.16);
        this.ring(e.x, e.z, T.radius * 0.6, e.r * 0.7, 0.4, this.dustCol, 0.6, H * 0.08, 0.06);
        this.dustBurst(e.x, e.z, e.r * 0.7, Math.round(6 * qm) + 2, H * 0.14, 0.7);
        if (Math.random() < 0.5) this.word('pulse', e.x, H * 1.1, e.z, f);
        break;
      }
      case 'vine': {
        this.vine(e.x0, e.z0, e.x1, e.z1, H);
        const n = Math.round(5 * qm) + 1;
        for (let i = 0; i < n; i++) {
          const u = rnd(0.2, 1);
          this.spritePart(e.x0 + (e.x1 - e.x0) * u, H * 0.3, e.z0 + (e.z1 - e.z0) * u, rnd(-1, 1) * H, rnd(0.5, 1.5) * H, rnd(-1, 1) * H,
            H * 0.16, IC_PETAL, i % 2 ? '#ff9ec7' : '#d8ff7a', '#fff3b0', rnd(0.6, 1.0), H * 2.2, 1);
        }
        if (Math.random() < 0.3) this.word('vine', e.x1, H * 0.9, e.z1, f);
        break;
      }
      case 'dash': {
        const n = Math.round(6 * qm) + 2;
        for (let i = 0; i < n; i++) {
          const u = i / Math.max(1, n - 1);
          const x = e.x0 + (e.x1 - e.x0) * u, z = e.z0 + (e.z1 - e.z0) * u;
          this.puff(this.dust, x, 0.05 * H, z, rnd(-0.3, 0.3) * H, H * 0.2, rnd(-0.3, 0.3) * H, H * 0.08, H * rnd(0.16, 0.26), rnd(0.45, 0.7), this.dustCol, this.dustCol, 2.5, 0);
        }
        const dl = Math.hypot(e.x1 - e.x0, e.z1 - e.z0) || 1;
        const ux = (e.x1 - e.x0) / dl, uz = (e.z1 - e.z0) / dl;
        for (let i = 0; i < n; i++) {
          this.shard(e.x0 + (e.x1 - e.x0) * Math.random(), H * rnd(0.2, 0.8), e.z0 + (e.z1 - e.z0) * Math.random(),
            -ux * H * 3, 0, -uz * H * 3, H * 0.05, 7, 0.22, '#ffffff', '#cfe8ff', 0, 1);
        }
        if (Math.random() < 0.25) this.word('dash', e.x1, H * 1.0, e.z1, f);
        break;
      }
      case 'ability': {
        const g = this.glow;
        this.ring(e.x, e.z, T.radius * 0.6, T.radius * 3, 0.45, g, 0.9, H * 0.14);
        if (e.titan === 'molo') this.vacRingCd = 0;
        if (e.titan !== 'voltkite' && e.titan !== 'hearthback') this.word(ABILITY_KEY[e.titan] ?? 'ability', e.x, H * 1.2, e.z, f);
        break;
      }
      case 'vent': {
        // HEARTHBACK SHELL VENT: a hot core flash, a tall fire column, smoke capping it, embers, rings
        const r = e.r;
        const pw = 0.8 + e.power * 0.5;
        this.puff(this.fire, e.x, H * 0.9, e.z, 0, H * 1.5, 0, H * 0.4, H * 0.95 * pw, 0.4, L(rf ? '#ffc05a' : '#fff6d0'), L('#ff9a3d'), 2, 0);
        const n = Math.round((16 + e.power * 16) * qm) + 6;
        for (let i = 0; i < n; i++) {
          const a = rnd(0, Math.PI * 2), rr = T.radius * rnd(0, 0.45);
          this.puff(this.fire, e.x + Math.cos(a) * rr, H * rnd(0.7, 1.0), e.z + Math.sin(a) * rr,
            Math.cos(a) * H * rnd(0.1, 0.5), H * rnd(3, 6.5) * pw, Math.sin(a) * H * rnd(0.1, 0.5),
            H * 0.15, H * rnd(0.32, 0.58) * pw, rnd(0.85, 1.45), L(i % 2 ? '#ffe08a' : '#ffb347'), L('#c2361e'), 1.0, -H * 0.6);
        }
        const sm = Math.round(n / 3);
        for (let i = 0; i < sm; i++) {
          const a = rnd(0, Math.PI * 2);
          this.puff(this.dust, e.x + Math.cos(a) * H * 0.3, H * rnd(2.2, 3.2) * pw, e.z + Math.sin(a) * H * 0.3,
            Math.cos(a) * H * 0.8, H * rnd(1.5, 2.5), Math.sin(a) * H * 0.8, H * 0.2, H * rnd(0.45, 0.7) * pw, rnd(1.4, 2.0),
            this.smokeCol, this.smokeCol, 1.0, 0).t = -rnd(0.25, 0.45);
        }
        const emb = Math.round(16 * qm) + 4;
        for (let i = 0; i < emb; i++) {
          const a = rnd(0, Math.PI * 2);
          this.shard(e.x, H * rnd(0.8, 1.4), e.z, Math.cos(a) * H * rnd(1, 3), H * rnd(4, 8), Math.sin(a) * H * rnd(1, 3),
            H * 0.05, 4, rnd(0.8, 1.3), '#ffd166', '#ff5a2e', H * 4, 0);
        }
        this.ring(e.x, e.z, T.radius, r, 0.6, L('#ff7a2e'), 0.95, H * 0.2, rf ? 0.1 : 0.35);
        this.ring(e.x, e.z, T.radius * 0.5, r * 0.75, 0.5, L('#ffd166'), 0.8, H * 0.1, 0, 0.12);
        this.word('vent', e.x, H * 1.4, e.z, f);
        break;
      }
      case 'bloomSpawn': {
        this.dustBurst(e.x, e.z, H * 0.3, 4, H * 0.12, 0.6, L('#b9e07a'));
        for (let i = 0; i < 5; i++) this.spritePart(e.x, H * 0.2, e.z, rnd(-1, 1) * H, rnd(1, 2) * H, rnd(-1, 1) * H, H * 0.15, IC_PETAL, '#ff9ec7', '#fff3b0', 0.8, H * 2, 1);
        if (Math.random() < 0.3) this.word('bloomSpawn', e.x, H * 0.7, e.z, f);
        break;
      }
      case 'spore': {
        const n = Math.round((10 + Math.min(20, e.r / Math.max(0.5, H) * 4)) * qm) + 3;
        const sc = L('#d8ff7a'), sc2 = L('#fff3b0');
        for (let i = 0; i < n; i++) {
          const a = rnd(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * e.r;
          this.puff(this.dust, e.x + Math.cos(a) * rr, H * rnd(0.05, 0.4), e.z + Math.sin(a) * rr,
            rnd(-0.2, 0.2) * H, H * rnd(0.15, 0.45), rnd(-0.2, 0.2) * H, H * 0.05, H * rnd(0.12, 0.22), rnd(1.2, 1.9), sc, sc2, 0.8, 0);
        }
        for (let i = 0; i < Math.round(6 * qm) + 2; i++) {
          const a = rnd(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * e.r;
          this.spritePart(e.x + Math.cos(a) * rr, H * rnd(0.1, 0.5), e.z + Math.sin(a) * rr, 0, H * 0.3, 0, H * 0.12, IC_DOT, '#d8ff7a', '#ffffff', rnd(1, 1.6), 0, 1);
        }
        this.ring(e.x, e.z, e.r * 0.3, e.r, 0.9, sc, 0.45, H * 0.1, 0.12, 0, 14);
        if (Math.random() < 0.4) this.word('spore', e.x, H * 1.0, e.z, f);
        break;
      }
      case 'explosion': this.onExplosion(w, e.x, e.z, e.r, e.kind, f); break;
      case 'enemyHit': {
        const en = this.enemy(w, e.id);
        const y = en ? en.y + en.height * 0.55 : H * 0.3;
        const sz = en ? Math.max(en.height, 0.6) : 1;
        this.sparks(e.x, y, e.z, e.crit ? 6 : 2, sz * 3.5, '#ffffff', e.crit ? '#ffd166' : '#fff4dc', sz);
        if (e.crit) this.spritePart(e.x, y, e.z, 0, 0, 0, Math.max(sz * 1.4, f.camDist * K_VIEW * 0.03), IC_STAR8, rf ? '#ffb347' : '#ffd166', '#ffffff', 0.14, 0, 0);
        break;
      }
      case 'enemyKilled': {
        const en = this.enemy(w, e.id);
        const h = en ? en.height : 1.8, r = en ? en.radius : 0.5;
        if (e.crushed) {
          // no gore: a puff of dust + bolts & springs confetti
          this.dustBurst(e.x, e.z, r * 1.5, Math.round(4 * qm) + 2, Math.max(0.5, h * 0.45), 0.6);
          const n = Math.round(9 * qm) + 3;
          const icons = [IC_NUT, IC_SPRING, IC_GEAR, IC_BOLT];
          const fills = ['#c9d1da', '#ff9f43', '#ffd166', '#9aa4ad'];
          const sp = Math.max(3, h * 3);
          for (let i = 0; i < n; i++) {
            const a = rnd(0, Math.PI * 2);
            this.spritePart(e.x, h * 0.4, e.z, Math.cos(a) * sp * rnd(0.3, 1), sp * rnd(1, 2), Math.sin(a) * sp * rnd(0.3, 1),
              Math.max(h * 0.3, f.camDist * K_VIEW * 0.012), icons[rndi(4)], fills[rndi(4)], '#ffffff', rnd(0.7, 1.1), sp * 2.2, 1);
          }
          this.word('crush', e.x, Math.max(h, H * 0.4), e.z, f);
        } else {
          const big = e.kind === 'buggy' || e.kind === 'apc' || e.kind === 'tank' || e.kind === 'walker' || e.kind === 'elite';
          if (big) this.explosion(e.x, e.z, Math.max(r * 1.6, h * 0.8), '#fff4c2', '#ff8a3d', '#e84a3c', 0.65, Math.max(h, 1));
          else this.dustBurst(e.x, e.z, r * 1.2, 3, Math.max(0.4, h * 0.4), 0.5, this.smokeCol);
          this.sparks(e.x, h * 0.5 + (en ? en.y : 0), e.z, big ? 6 : 3, Math.max(3, h * 3), '#ffffff', '#ffd166', h);
          if (Math.random() < (big ? 0.7 : 0.15)) this.word(big ? 'explosion' : 'enemyKilled', e.x, h * 1.2 + (en ? en.y : 0), e.z, f);
        }
        break;
      }
      case 'enemyFire': {
        const en = this.enemy(w, e.id);
        const h = en ? en.height : 1.6, r = en ? en.radius : 0.4;
        const dx = e.tx - e.x, dz = e.tz - e.z, dl = Math.hypot(dx, dz) || 1;
        const mx = e.x + dx / dl * r * 1.1, mz = e.z + dz / dl * r * 1.1;
        const my = (en ? en.y : 0) + h * 0.6;
        const s = Math.max(h * 0.55, f.camDist * K_VIEW * 0.012);
        this.spritePart(mx, my, mz, 0, 0, 0, s, IC_STAR8, rf ? '#ffb347' : '#ffd166', '#fffbe8', 0.08, 0, 0);
        break;
      }
      case 'projectileHit': {
        const big = e.kind === 'shell' || e.kind === 'mortar' || e.kind === 'rocket' || e.kind === 'plate';
        const s = big ? 1.4 : 0.5;
        this.dustBurst(e.x, e.z, s, big ? 4 : 2, s * 0.7, 0.5, big ? this.smokeCol : this.dustCol);
        this.sparks(e.x, s * 0.5, e.z, big ? 4 : 2, s * 4, '#ffffff', '#ffd166', s);
        break;
      }
      case 'titanHurt': {
        this.sparks(T.x + rnd(-0.3, 0.3) * H, H * 0.55, T.z + rnd(-0.3, 0.3) * H, 5, H * 1.6, '#ffffff', '#ff6f5e', H);
        if (e.dmg > T.maxHp * 0.04) this.word('titanHurt', T.x, H * 1.3, T.z, f);
        break;
      }
      case 'titanHeal': {
        this.healAcc += e.amount / Math.max(1, T.maxHp);
        if (this.healCd <= 0 && this.healAcc > 0.004) {
          const n = Math.min(10, Math.max(2, Math.round(this.healAcc * 90 * qm)));
          for (let i = 0; i < n; i++) {
            const a = rnd(0, Math.PI * 2), rr = T.radius * rnd(0.4, 1.1);
            this.spritePart(T.x + Math.cos(a) * rr, H * rnd(0.2, 0.8), T.z + Math.sin(a) * rr, 0, H * rnd(0.5, 0.9), 0,
              Math.max(H * 0.14, f.camDist * K_VIEW * 0.018), IC_PLUS, '#5cff86', '#ffffff', rnd(0.7, 1.0), 0, 1);
          }
          this.healAcc = 0; this.healCd = 0.18;
        }
        break;
      }
      case 'pickup': {
        if (this.pickupCd <= 0) {
          this.spritePart(T.x + rnd(-0.2, 0.2) * H, H * rnd(0.4, 0.7), T.z + rnd(-0.2, 0.2) * H, 0, H * 0.6, 0,
            Math.max(H * 0.1, f.camDist * K_VIEW * 0.014), IC_STAR4, e.kind === 'scrap' ? '#9ffcff' : e.kind === 'heal' ? '#9dffb0' : '#ffe28a', '#ffffff', 0.35, 0, 1);
          this.pickupCd = 0.06;
        }
        break;
      }
      case 'levelUp': {
        this.ring(T.x, T.z, T.radius * 1.2, T.radius * 3.4, 0.9, L('#ffd166'), 1, H * 0.1, 0, 0, 20, 2.5, true);
        const n = Math.round(10 * qm) + 3;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          this.spritePart(T.x + Math.cos(a) * T.radius * 1.4, H * 0.2, T.z + Math.sin(a) * T.radius * 1.4, 0, H * rnd(0.9, 1.6), 0,
            Math.max(H * 0.16, f.camDist * K_VIEW * 0.02), IC_STAR4, i % 2 ? '#fff27a' : '#ffffff', '#ffffff', rnd(0.6, 0.9), 0, 1);
        }
        this.word('levelUp', T.x, H * 1.35, T.z, f);
        break;
      }
      case 'rankUp': {
        // MASS BREACH: ground flash + double shockwave + dust skirt + big word
        const Hn = Math.max(H, 1);
        this.ring(T.x, T.z, 0, Hn * 5, 0.55, L('#fff1c2'), rf ? 0.3 : 0.85, 0, 0, 0, 0, 0, false, 0.0, 1);
        this.ring(T.x, T.z, Hn * 0.5, Hn * 9, 1.1, L('#ffd166'), 1, Hn * 0.28);
        if (!rf) this.ring(T.x, T.z, Hn * 0.3, Hn * 6.5, 1.0, L('#ff4fa0'), 0.9, Hn * 0.16, 0, 0.15);
        const n = Math.round(22 * qm) + 6;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rnd(-0.1, 0.1);
          this.puff(this.dust, T.x + Math.cos(a) * Hn * 0.6, Hn * 0.05, T.z + Math.sin(a) * Hn * 0.6,
            Math.cos(a) * Hn * rnd(3, 5), Hn * 0.2, Math.sin(a) * Hn * rnd(3, 5), Hn * 0.1, Hn * rnd(0.3, 0.45), rnd(0.9, 1.3), this.dustCol, this.dustCol, 2.2, 0);
        }
        for (let i = 0; i < Math.round(12 * qm) + 4; i++) {
          const a = rnd(0, Math.PI * 2);
          this.spritePart(T.x + Math.cos(a) * Hn * 0.5, Hn * rnd(0.3, 1.0), T.z + Math.sin(a) * Hn * 0.5, Math.cos(a) * Hn * 1.5, Hn * rnd(1, 2), Math.sin(a) * Hn * 1.5,
            Hn * 0.2, IC_STAR4, i % 2 ? '#ffd166' : '#ff9ec7', '#ffffff', rnd(0.8, 1.2), 0, 1);
        }
        this.word('rankUp', T.x, Hn * 1.6, T.z, f, true);
        break;
      }
      case 'chest': {
        for (let i = 0; i < Math.round(8 * qm) + 3; i++) {
          const a = rnd(0, Math.PI * 2);
          this.spritePart(e.x, H * 0.4, e.z, Math.cos(a) * H, H * rnd(1, 2), Math.sin(a) * H, Math.max(H * 0.18, f.camDist * K_VIEW * 0.02), IC_STAR4, '#ffd166', '#ffffff', 0.9, H * 1.5, 1);
        }
        this.word('chest', e.x, H * 1.2, e.z, f);
        break;
      }
      case 'bossHit': {
        const b = w.boss;
        let y = H * 0.5;
        if (b) for (const p of b.parts) if (p.name === e.part) { y = (p.y0 + p.y1) * 0.5; break; }
        const s = Math.max(H * 0.5, 4);
        this.sparks(e.x, y, e.z, 4, s * 3, '#ffffff', '#ffd166', s);
        if (Math.random() < 0.25) this.word('bossHit', e.x, y + s, e.z, f);
        break;
      }
      case 'bossStagger': {
        const b = w.boss;
        if (b) {
          this.ring(b.x, b.z, 10, 70, 0.9, L('#fff27a'), 1, 6);
          this.word('bossStagger', b.x, 60, b.z, f, true);
        }
        break;
      }
      case 'bossDefeated': {
        for (let i = 0; i < 7; i++) {
          const a = rnd(0, Math.PI * 2), rr = rnd(0, 35);
          this.explosion(e.x + Math.cos(a) * rr, e.z + Math.sin(a) * rr, rnd(14, 26), '#fff4c2', '#ff8a3d', '#e84a3c', 1.0, 40, i * 0.18);
        }
        this.ring(e.x, e.z, 10, 160, 1.6, this.dustCol, 0.9, 14);
        this.word('bossDefeated', e.x, 70, e.z, f, true);
        break;
      }
      case 'bossSpawn': {
        const b = w.boss;
        if (b) this.ring(b.x, b.z, 8, 90, 1.2, this.dustCol, 0.7, 8);
        break;
      }
      case 'bossPhase': {
        const b = w.boss;
        if (b) this.ring(b.x, b.z, 8, 110, 1.0, L('#ff4fa0'), 0.8, 7, 0, 0, 16, 1.5);
        break;
      }
      case 'telegraphFire': {
        if (e.owner !== 'boss') break;
        let R = 16;
        for (const tg of w.telegraphs) {
          if (tg.id !== e.id) continue;
          const s = tg.shape;
          R = s.k === 'circle' ? s.r : s.k === 'ring' ? s.r1 : s.k === 'oval' ? Math.max(s.rx, s.rz) : s.k === 'cone' ? s.r * 0.5 : s.k === 'lane' ? s.w : s.r;
          break;
        }
        this.ring(e.x, e.z, R * 0.2, R * 1.1, 0.7, L('#ffb0d4'), 0.9, Math.max(2, R * 0.08));
        this.dustBurst(e.x, e.z, R * 0.6, Math.round(10 * qm) + 3, R * 0.14, 0.9);
        break;
      }
      case 'upgradeProc': {
        this.spritePart(e.x, H * 0.5, e.z, 0, H * 0.8, 0, Math.max(H * 0.14, f.camDist * K_VIEW * 0.016), IC_STAR4, '#c49bff', '#ffffff', 0.5, 0, 1);
        break;
      }
      default: break;
    }
  }

  private onExplosion(w: World, x: number, z: number, r: number, kind: string, f: FrameInfo): void {
    const H = w.titan.height;
    const qm = Q_MUL[this.ctx.quality.level] ?? 1;
    if (kind === 'stomp') {
      // HEARTHBACK magma stomp: a low molten splash
      this.explosion(x, z, r * 0.55, '#ffe08a', '#ff7a2e', '#b2331c', 0.7, H);
      this.ring(x, z, r * 0.3, r * 1.05, 0.5, L('#ff7a2e'), 0.95, H * 0.14, 0.2);
      this.dustBurst(x, z, r * 0.8, Math.round(6 * qm) + 2, H * 0.16, 0.8, this.smokeCol);
      if (Math.random() < 0.6) this.word('stomp', x, H * 0.9, z, f);
    } else if (kind === 'arc') {
      // VOLT-KITE static burst: radial bolts + cyan ring
      this.ring(x, z, r * 0.2, r, 0.4, L('#6ff3ff'), 0.9, H * 0.1, 0.12);
      const n = 6;
      const pts = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3);
        pts[0] = x; pts[1] = z; pts[2] = x + Math.cos(a) * r; pts[3] = z + Math.sin(a) * r;
        this.lightning(pts, H * 0.5, H * 0.1, H, 2.6, '#ffffff', '#6ff3ff', 0.18);
      }
      this.word('arc', x, H * 1.1, z, f);
    } else if (kind === 'shockwave') {
      this.ring(x, z, r * 0.2, r, 0.5, this.dustCol, 0.9, H * 0.12);
      this.dustBurst(x, z, r * 0.7, Math.round(6 * qm) + 2, H * 0.12, 0.7);
    } else {
      // hostile ordnance / generic: fireball + smoke
      this.explosion(x, z, Math.max(r * 0.6, 0.8), '#fff4c2', '#ff8a3d', '#e84a3c', 0.7, Math.max(r, 1));
      this.ring(x, z, r * 0.2, r * 1.1, 0.45, L('#ffb36b'), 0.8, Math.max(0.3, r * 0.12));
      if (r > H * 0.3 && Math.random() < 0.5) this.word('explosion', x, r + H * 0.3, z, f);
    }
  }

  // ─────────────────────────────── spawners ───────────────────────────────
  private ring(x: number, z: number, r0: number, r1: number, life: number, col: number[], a0: number, thick: number,
    fill = 0, delay = 0, dashes = 0, spin = 0, follow = false, inner = 0.82, easeFill = 0): void {
    const d = this.decals.alloc();
    d.x = x; d.z = z; d.y = 0.05; d.r0 = Math.max(0.01, r0); d.r1 = Math.max(0.01, r1);
    d.life = life; d.t = -delay; d.a0 = a0; d.thick = thick; d.inner = thick > 0 ? inner : (easeFill ? 0 : inner);
    d.fill = fill; d.dashes = dashes; d.spin = spin; d.rot = Math.random() * Math.PI * 2; d.follow = follow;
    d.col[0] = col[0]; d.col[1] = col[1]; d.col[2] = col[2];
  }

  private puff(pool: Pool<Part>, x: number, y: number, z: number, vx: number, vy: number, vz: number,
    s0: number, s1: number, life: number, c0: number[], c1: number[], drag: number, grav: number): Part {
    const p = pool.alloc();
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    const cap = pool === this.fire ? this.maxPuff * 1.3 : this.maxPuff;
    p.s0 = Math.min(s0, cap * 0.5); p.s1 = Math.min(s1, cap); p.peakAt = 0.3; p.life = life; p.t = 0;
    p.drag = drag; p.grav = grav; p.rot = Math.random() * 6.28; p.vrot = rnd(-2, 2);
    p.c0[0] = c0[0]; p.c0[1] = c0[1]; p.c0[2] = c0[2];
    p.c1[0] = c1[0]; p.c1[1] = c1[1]; p.c1[2] = c1[2];
    p.home = 0; p.stretch = 1;
    return p;
  }

  private shard(x: number, y: number, z: number, vx: number, vy: number, vz: number, w: number, stretch: number,
    life: number, c0: string, c1: string, grav: number, home: number): void {
    const p = this.shards.alloc();
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.s0 = w; p.s1 = w; p.peakAt = 0; p.life = life; p.t = 0;
    p.drag = 1.5; p.grav = grav; p.rot = 0; p.vrot = 0; p.home = home; p.stretch = stretch;
    lin(c0, p.c0, 0); lin(c1, p.c1, 0);
  }

  private sparks(x: number, y: number, z: number, n: number, speed: number, c0: string, c1: string, size: number): void {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), el = rnd(0.1, 1.2);
      const sp = speed * rnd(0.5, 1.1);
      this.shard(x, y, z, Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp,
        Math.max(size * 0.06, this.minShard), 5, rnd(0.18, 0.32), c0, c1, speed * 1.5, 0);
    }
  }

  private dustBurst(x: number, z: number, r: number, n: number, s: number, life: number, col?: number[]): void {
    const c = col ?? this.dustCol;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), rr = r * rnd(0.2, 1);
      this.puff(this.dust, x + Math.cos(a) * rr, s * 0.4, z + Math.sin(a) * rr, Math.cos(a) * s * 2.5, s * rnd(1, 2.5), Math.sin(a) * s * 2.5,
        s * 0.5, s * rnd(1.4, 2.2), life * rnd(0.8, 1.2), c, c, 2.5, 0);
    }
  }

  private dustRect(cx: number, cz: number, w: number, d: number, n: number, s: number, life: number): void {
    for (let i = 0; i < n; i++) {
      // around the footprint's perimeter, pushed outward
      const side = rndi(4), u = rnd(-0.5, 0.5);
      const x = cx + (side < 2 ? u * w : (side === 2 ? -0.5 : 0.5) * w);
      const z = cz + (side < 2 ? (side === 0 ? -0.5 : 0.5) * d : u * d);
      const ox = x - cx, oz = z - cz, ol = Math.hypot(ox, oz) || 1;
      this.puff(this.dust, x, s * 0.3, z, ox / ol * s * 2.2, s * rnd(0.3, 1.1), oz / ol * s * 2.2, s * 0.4, s * rnd(1.1, 1.8), life * rnd(0.8, 1.2), this.dustCol, this.dustCol, 2.4, 0);
    }
  }

  private explosion(x: number, z: number, r: number, cHot: string, cMid: string, cEnd: string, life: number, scale: number, delay = 0): void {
    const qm = Q_MUL[this.ctx.quality.level] ?? 1;
    const rf = this.ctx.quality.reduceFlashing;
    const hot = L(rf ? cMid : cHot), mid = L(cMid), end = L(cEnd);
    // core ball
    this.puff(this.fire, x, r * 0.5, z, 0, r * 0.6, 0, r * 0.3, r * 1.2, life * 0.8, hot, mid, 3, 0).t = -delay;
    const n = Math.round(6 * qm) + 2;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), el = rnd(0.2, 1.1);
      const sp = r * rnd(1.4, 2.6);
      this.puff(this.fire, x, r * 0.4, z, Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp,
        r * 0.2, r * rnd(0.45, 0.75), life * rnd(0.6, 1.0), i % 2 ? hot : mid, end, 3.5, 0).t = -delay;
    }
    const sm = Math.round(4 * qm) + 1;
    for (let i = 0; i < sm; i++) {
      const a = rnd(0, Math.PI * 2);
      this.puff(this.dust, x + Math.cos(a) * r * 0.4, r * 0.7, z + Math.sin(a) * r * 0.4, Math.cos(a) * r * 0.5, r * rnd(0.9, 1.6), Math.sin(a) * r * 0.5,
        r * 0.15, r * rnd(0.32, 0.5), life * rnd(1.3, 1.8), this.smokeCol, this.smokeCol, 1.2, 0).t = -delay - life * 0.25;
    }
    if (delay <= 0) this.sparks(x, r * 0.5, z, Math.round(5 * qm) + 2, r * 4, '#ffffff', cMid, Math.max(scale, r));
  }

  private spritePart(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, icon: number,
    fill: string, back: string, life: number, grav: number, pop: number): void {
    const s = this.sprites.alloc();
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz;
    s.size = size; s.rot = rnd(-0.6, 0.6); s.vrot = pop ? rnd(-6, 6) : 0; s.grav = grav; s.drag = 0.8;
    s.icon = icon; lin(fill, s.fill, 0); lin(back, s.back, 0);
    s.life = life; s.t = 0; s.pop = pop;
  }

  private lightning(pts: readonly number[], y0: number, y1: number, H: number, wPx: number, core: string, glow: string, life: number): void {
    const n = Math.min(16, pts.length >> 1);
    if (n < 2) return;
    const b = this.bolts.alloc();
    b.n = n; b.vine = false;
    for (let i = 0; i < n; i++) {
      b.base[i * 3] = pts[i * 2];
      b.base[i * 3 + 1] = i === 0 ? y0 : y1;
      b.base[i * 3 + 2] = pts[i * 2 + 1];
    }
    b.amp = H * 0.12; b.wPx = wPx; b.life = life; b.t = 0; b.jitT = 1;
    b.sub = 7;
    lin(core, b.core, 0); lin(glow, b.glow, 0);
  }

  private vine(x0: number, z0: number, x1: number, z1: number, H: number): void {
    const b = this.bolts.alloc();
    b.n = 2; b.vine = true;
    b.base[0] = x0; b.base[1] = H * 0.35; b.base[2] = z0;
    b.base[3] = x1; b.base[4] = H * 0.12; b.base[5] = z1;
    b.amp = H * 0.4; b.wPx = H * 0.16;           // vines: world-space width
    b.life = 0.5; b.t = 0; b.jitT = 0; b.sub = 11;
    lin('#6fae45', b.core, 0); lin('#3d6b2a', b.glow, 0);
  }

  // ─────────────────────────────── burst-word layout ───────────────────────────────
  /** world point → clip space (this.clip); false when behind the camera */
  private toClip(x: number, y: number, z: number): boolean {
    this.clip.set(x, y, z, 1).applyMatrix4(this.vp);
    return this.clip.w > 1e-3;
  }

  /** grow NDC rect i (in this.blk) by a projected world point padded by padM metres */
  private growPt(i: number, x: number, y: number, z: number, padM: number): void {
    if (!this.toClip(x, y, z)) return;
    const c = this.clip, iw = 1 / c.w, e = this.vp.elements;
    const nx = c.x * iw, ny = c.y * iw;
    const py = padM * iw * Math.abs(e[5]), pxx = padM * iw * Math.abs(e[0]);
    const b = this.blk, o = i * 4;
    if (nx - pxx < b[o]) b[o] = nx - pxx;
    if (nx + pxx > b[o + 2]) b[o + 2] = nx + pxx;
    if (ny - py < b[o + 1]) b[o + 1] = ny - py;
    if (ny + py > b[o + 3]) b[o + 3] = ny + py;
  }

  private openRect(): number {
    if (this.nBlk >= MAX_BLOCK) return -1;
    const o = this.nBlk * 4;
    this.blk[o] = this.blk[o + 1] = Infinity; this.blk[o + 2] = this.blk[o + 3] = -Infinity;
    return this.nBlk;
  }

  /** keep rect i only if it is valid and touches the screen */
  private closeRect(i: number): void {
    const b = this.blk, o = i * 4;
    if (b[o] < b[o + 2] && b[o + 1] < b[o + 3] && b[o + 2] > -1.1 && b[o] < 1.1 && b[o + 3] > -1.1 && b[o + 1] < 1.1) this.nBlk++;
  }

  /**
   * Once per frame: the screen rects burst words keep clear of — the titan (rect 0, kept in titanR),
   * the boss (projected part cylinders) and every live hostile telegraph (projected ground bounds).
   */
  private layoutBlockers(w: World): void {
    const cam = this.camera();
    cam.updateMatrixWorld();
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.nBlk = 0;
    const T = w.titan;
    const b = w.boss;
    this.bossLive = !!(b && b.alive);
    this.busy = this.bossLive || T.rank >= 3;
    // rect 0: the titan (always slot 0, even when off-screen, so overlap() can skip it by index)
    this.blk[0] = this.blk[1] = Infinity; this.blk[2] = this.blk[3] = -Infinity;
    // radius = 0.42 H understates the long bodies (MOLO's snout-to-tail, VOLT-KITE's wings): the
    // rect spans ±2.2 radii along the heading (snout / tail) and 1.3 radii of padding around that
    {
      const L = T.radius * 2.2, hx = Math.sin(T.heading) * L, hz = Math.cos(T.heading) * L, pad = T.radius * 1.3;
      for (let k = -1; k <= 1; k += 2) {
        this.growPt(0, T.x + hx * k, 0, T.z + hz * k, pad);
        this.growPt(0, T.x + hx * k, T.height * 1.1, T.z + hz * k, pad);
      }
    }
    for (let k = 0; k < 4; k++) this.titanR[k] = this.blk[k];
    this.nBlk = 1;
    if (b && b.alive) {
      const i = this.openRect();
      if (i >= 0) {
        for (const p of b.parts) {
          this.growPt(i, p.x, p.y0, p.z, p.r * 1.15);
          this.growPt(i, p.x, p.y1, p.z, p.r * 1.15);
        }
        this.bossSx = (this.blk[i * 4] + this.blk[i * 4 + 2]) * 0.5;
        this.closeRect(i);
      }
    }
    for (const tg of w.telegraphs) {
      if (!tg.alive || tg.owner === 'titan') continue;
      const i = this.openRect();
      if (i < 0) break;
      const s = tg.shape;
      switch (s.k) {
        case 'circle': case 'ring': case 'oval': {
          const R = s.k === 'circle' ? s.r : s.k === 'ring' ? s.r1 : Math.max(s.rx, s.rz);
          this.growPt(i, s.x - R, 0, s.z - R, 0); this.growPt(i, s.x + R, 0, s.z - R, 0);
          this.growPt(i, s.x - R, 0, s.z + R, 0); this.growPt(i, s.x + R, 0, s.z + R, 0);
          break;
        }
        case 'cone': {
          this.growPt(i, s.x, 0, s.z, 0);
          const n = s.half > 1.2 ? 6 : 3;
          for (let k = 0; k <= n; k++) {
            const a = s.dir - s.half + (2 * s.half * k) / n;
            this.growPt(i, s.x + Math.sin(a) * s.r, 0, s.z + Math.cos(a) * s.r, 0);
          }
          break;
        }
        case 'lane': {
          const sx = Math.sin(s.dir), cz = Math.cos(s.dir), hw = s.w * 0.5;
          const ex = s.x + sx * s.len, ez = s.z + cz * s.len;
          this.growPt(i, s.x + cz * hw, 0, s.z - sx * hw, 0); this.growPt(i, s.x - cz * hw, 0, s.z + sx * hw, 0);
          this.growPt(i, ex + cz * hw, 0, ez - sx * hw, 0); this.growPt(i, ex - cz * hw, 0, ez + sx * hw, 0);
          break;
        }
        case 'capsule':
          this.growPt(i, s.x0, 0, s.z0, s.r); this.growPt(i, s.x1, 0, s.z1, s.r);
          break;
      }
      this.closeRect(i);
    }
  }

  /** NDC rect of a word centred at (x,y,z), world height h → this.cand; false when behind the camera */
  private wordRect(x: number, y: number, z: number, h: number, aspect: number): boolean {
    if (!this.toClip(x, y, z)) return false;
    const c = this.clip, iw = 1 / c.w, e = this.vp.elements;
    const nx = c.x * iw, ny = c.y * iw;
    const hh = 0.5 * h * 1.12 * iw * Math.abs(e[5]);          // +12 %: the pop overshoot
    const hw = 0.5 * h * aspect * 1.12 * iw * Math.abs(e[0]);
    const rise = h * 0.35 * iw * Math.abs(e[5]);                // words drift up over their life
    const r = this.cand;
    r[0] = nx - hw; r[1] = ny - hh; r[2] = nx + hw; r[3] = ny + hh + rise;
    return true;
  }

  /** overlap area (NDC²) of this.cand with rect (x0,y0)-(x1,y1) */
  private ov(x0: number, y0: number, x1: number, y1: number): number {
    const r = this.cand;
    const w = Math.min(r[2], x1) - Math.max(r[0], x0), h = Math.min(r[3], y1) - Math.max(r[1], y0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /** how badly this.cand is placed: overlap with boss / hostile paint / live words (+ titan), off-screen area */
  private badness(avoidTitan: boolean, self: Word | null): number {
    const r = this.cand, b = this.blk;
    let a = 0;
    for (let i = 1; i < this.nBlk; i++) a += this.ov(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]);
    if (avoidTitan) a += this.ov(this.titanR[0], this.titanR[1], this.titanR[2], this.titanR[3]);
    // a word half out of frame (or under the top HUD band) is as bad as a covered one
    if (r[0] < -0.97) a += (-0.97 - r[0]) * (r[3] - r[1]);
    if (r[2] > 0.97) a += (r[2] - 0.97) * (r[3] - r[1]);
    if (r[3] > 0.72) a += (r[3] - 0.72) * (r[2] - r[0]);
    if (r[1] < -0.95) a += (-0.95 - r[1]) * (r[2] - r[0]);
    const at = this.atlas;
    for (const o of this.words.items) {
      if (o === self || o.t >= o.life) continue;
      if (!this.toClip(o.x, o.y, o.z)) continue;
      const c = this.clip, iw = 1 / c.w, e = this.vp.elements;
      const asp = at ? (at.cells[o.cell * 5 + 4] || 3.4) : 3.4;
      const nx = c.x * iw, ny = c.y * iw;
      const hh = 0.5 * o.h * iw * Math.abs(e[5]), hw = 0.5 * o.h * asp * iw * Math.abs(e[0]);
      a += this.ov(nx - hw, ny - hh, nx + hw, ny + hh + o.h * 0.35 * iw * Math.abs(e[5]));
    }
    return a;
  }

  private word(key: string, x: number, y: number, z: number, f: FrameInfo, force = false): void {
    if (!this.atlas) return;
    const st = WORD_STYLE[key] ?? WORD_STYLE.generic;
    const cd = this.wordCd.get(key) ?? 0;
    if (!force) {
      if (cd > 0) return;
      if (this.wordTokens < 1 && st.prio < 4) return;
    }
    const busy = this.busy;
    const droppable = DROP_WORDS.has(key);
    // keep titan-scale words near the action (a 100 m tower's collapse word must not fly off-screen)
    y = Math.min(y, f.camDist * K_VIEW * 0.28 + 1);
    const list = this.atlas.lists[key] ?? this.atlas.lists.generic;
    if (!list || list.length === 0) return;
    // capacity: BUSY_WORD_CAP live words while busy (else the whole pool); a full screen only yields
    // its lowest-priority / oldest word to a HIGHER-priority one (or a forced beat)
    const cap = busy ? BUSY_WORD_CAP : this.words.items.length;
    let live = 0;
    let free: Word | null = null, worstLive: Word | null = null;
    let worst = Infinity;
    for (const wd of this.words.items) {
      if (wd.t >= wd.life) { if (!free) free = wd; continue; }
      live++;
      const score = wd.prio * 10 - wd.t;
      if (score < worst) { worst = score; worstLive = wd; }
    }
    let slot: Word | null = null;
    if (live < cap && free) slot = free;
    else if (worstLive && (force || worstLive.prio < st.prio)) slot = worstLive;
    if (!slot) return;
    // dedupe: never the same text twice within WORD_DEDUPE_S, nor one still on screen
    const now = this.lastTime;
    let cell = -1;
    const n = list.length, k0 = rndi(n);
    for (let k = 0; k < n; k++) {
      const c = list[(k0 + k) % n];
      if (c < this.cellShown.length && now - this.cellShown[c] < WORD_DEDUPE_S) continue;
      let onScreen = false;
      for (const o of this.words.items) if (o !== slot && o.t < o.life && o.cell === c) { onScreen = true; break; }
      if (!onScreen) { cell = c; break; }
    }
    if (cell < 0) { if (!force) return; cell = list[k0]; }
    const hScreen = f.camDist * K_VIEW;
    let size = st.size;
    if (busy && SHRINK_WORDS.has(key)) size *= BUSY_SHRINK;
    const h = size * hScreen * (this.ctx.quality.level === 0 ? 0.9 : 1);
    const aspect = this.atlas.cells[cell * 5 + 4] || 3.4;
    // placement: beside the event, on the screen side AWAY from the boss, stepping further out until
    // the word clears the boss, every hostile telegraph, live words and (secondary words while busy)
    // the titan. Env words that find no clear spot while busy are dropped.
    let pref = Math.random() < 0.5 ? -1 : 1;
    if (this.bossLive && this.toClip(x, y, z)) pref = this.clip.x / this.clip.w >= this.bossSx ? 1 : -1;
    const avoidTitan = busy && !force && SHRINK_WORDS.has(key);
    let bestA = Infinity, bx = 0, bz = 0;
    for (let oi = 0; oi < WORD_OFFSETS.length && bestA > 1e-6; oi++) {
      for (let si = 0; si < 2; si++) {
        const side = (si === 0 ? pref : -pref) * (WORD_OFFSETS[oi] + rnd(0, 0.03)) * hScreen;
        const cx = x + this.camRight.x * side, cz = z + this.camRight.z * side;
        if (!this.wordRect(cx, y, cz, h, aspect)) continue;
        const a = this.badness(avoidTitan, slot);
        if (a < bestA) { bestA = a; bx = cx; bz = cz; }
        if (a <= 1e-6) break;
      }
    }
    if (bestA === Infinity) return;                       // behind the camera
    if (bestA > 1e-6 && busy && droppable && !force) return;
    let kcd = st.cd;
    if (this.bossLive && droppable) kcd = Math.max(kcd, BUSY_ENV_CD);
    this.wordCd.set(key, kcd);
    this.wordTokens = Math.max(0, this.wordTokens - 1);
    if (cell < this.cellShown.length) this.cellShown[cell] = now;
    slot.x = bx; slot.y = y; slot.z = bz;
    slot.h = h;
    slot.cell = cell;
    lin(st.fill, slot.fill, 0); lin(st.back, slot.back, 0);
    slot.rot = rnd(-0.22, 0.22);
    slot.prio = st.prio;
    slot.life = st.prio >= 5 ? 1.35 : 0.95;
    slot.t = 0; slot.jx = 0; slot.jy = 0;
  }

  // Molo's GULLET VACUUM: streaks converge on the mouth while kit.vacuumT > 0
  private stepVacuum(w: World, f: FrameInfo, dt: number): void {
    const T = w.titan;
    if (this.titanId !== 'molo') return;
    const vac = T.kit.vacuumT ?? 0;
    if (!(vac > 0)) { this.vacSpawnAcc = 0; return; }
    const H = T.height;
    const st = T.stats;
    const R = 6 * H * Math.max(0.1, st.vacuumRadius ?? 1) * Math.max(0.1, st.area ?? 1);
    const qm = Q_MUL[this.ctx.quality.level] ?? 1;
    this.vacSpawnAcc += dt * 110 * qm;
    while (this.vacSpawnAcc >= 1) {
      this.vacSpawnAcc -= 1;
      const a = rnd(0, Math.PI * 2), rr = R * rnd(0.55, 1.0);
      const x = T.x + Math.cos(a) * rr, z = T.z + Math.sin(a) * rr;
      // tangential swirl + inward pull; homing steers it into the mouth
      const tx = -Math.sin(a), tz = Math.cos(a);
      this.shard(x, H * rnd(0.1, 0.6), z, tx * H * 4 - Math.cos(a) * H * 3, H * 0.4, tz * H * 4 - Math.sin(a) * H * 3,
        H * 0.045, 9, 1.2, '#ffffff', '#9dffcf', 0, 1);
    }
    if (this.vacRingCd <= 0) {
      this.ring(T.x, T.z, R, R * 0.35, 0.5, this.glow, 0.7, H * 0.1, 0, 0, 24, -2.5, true);
      this.vacRingCd = 0.22;
    }
    // occasional debris puffs sucked in from the rim
    if (Math.random() < dt * 14 * qm) {
      const a = rnd(0, Math.PI * 2);
      this.puff(this.dust, T.x + Math.cos(a) * R * 0.9, H * 0.1, T.z + Math.sin(a) * R * 0.9, -Math.cos(a) * R * 1.2, H * 0.3, -Math.sin(a) * R * 1.2,
        H * 0.12, H * 0.2, 0.6, this.dustCol, this.dustCol, 0.5, 0);
    }
  }

  // ─────────────────────────────── drawing ───────────────────────────────
  private drawDecals(w: World, f: FrameInfo, dt: number): void {
    const im = this.decalMesh!, fx = this.decalFx!;
    const A = fx.array as Float32Array;
    const T = w.titan;
    const tx = T.px + (T.x - T.px) * f.alpha, tz = T.pz + (T.z - T.pz) * f.alpha;
    let n = 0;
    for (const d of this.decals.items) {
      if (d.t >= d.life) continue;
      d.t += dt;
      if (d.t < 0 || d.t >= d.life) continue;
      const u = d.t / d.life;
      const e = 1 - Math.pow(1 - u, 3);                 // easeOutCubic expansion
      const r = d.r0 + (d.r1 - d.r0) * e;
      if (d.follow) { d.x = tx; d.z = tz; }
      d.rot += d.spin * dt;
      this.q.setFromAxisAngle(this.up, d.rot);
      this.p3.set(d.x, d.y, d.z);
      this.s3.set(r, 1, r);
      this.m4.compose(this.p3, this.q, this.s3);
      im.setMatrixAt(n, this.m4);
      this.col.setRGB(d.col[0], d.col[1], d.col[2]);
      im.setColorAt(n, this.col);
      const inner = d.thick > 0 ? Math.min(0.97, Math.max(0.15, 1 - d.thick / Math.max(r, 1e-3))) : d.inner;
      const alpha = inner <= 0.001 ? d.a0 * Math.pow(1 - u, 1.5) : d.a0 * (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3);
      A[n * 4] = alpha; A[n * 4 + 1] = inner; A[n * 4 + 2] = d.dashes; A[n * 4 + 3] = d.fill * (1 - u) * (1 - u);
      n++;
    }
    im.count = n;
    im.visible = n > 0;
    if (n > 0) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      fx.clearUpdateRanges(); fx.addUpdateRange(0, n * 4); fx.needsUpdate = true;
    }
  }

  private drawParts(pool: Pool<Part>, im: THREE.InstancedMesh, w: World, dt: number, oriented: boolean): void {
    const T = w.titan;
    const H = T.height;
    const mouthX = T.x + Math.sin(T.heading) * T.radius * 1.1, mouthZ = T.z + Math.cos(T.heading) * T.radius * 1.1, mouthY = H * 0.35;
    let n = 0;
    for (const p of pool.items) {
      if (p.t >= p.life) continue;
      p.t += dt;
      if (p.t < 0 || p.t >= p.life) continue;
      const u = p.t / p.life;
      if (p.home) {
        const dx = mouthX - p.x, dy = mouthY - p.y, dz = mouthZ - p.z;
        const dl = Math.hypot(dx, dy, dz);
        if (dl < H * 0.3) { p.t = p.life; continue; }
        const sp = Math.max(H * 6, Math.hypot(p.vx, p.vy, p.vz));
        const k = Math.min(1, dt * 5);
        p.vx += (dx / dl * sp - p.vx) * k; p.vy += (dy / dl * sp - p.vy) * k; p.vz += (dz / dl * sp - p.vz) * k;
      } else {
        const dk = Math.exp(-p.drag * dt);
        p.vx *= dk; p.vz *= dk; p.vy = p.vy * dk - p.grav * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy) * 0.2; }
      p.rot += p.vrot * dt;
      // size: grow to peak then shrink away (comic puffs pop out, no alpha)
      let s: number;
      if (oriented) s = p.s0 * (1 - u * 0.7);
      else s = u < p.peakAt ? p.s0 + (p.s1 - p.s0) * (1 - Math.pow(1 - u / p.peakAt, 2)) : p.s1 * (1 - Math.pow((u - p.peakAt) / (1 - p.peakAt), 1.6));
      if (s <= 1e-4) continue;
      this.p3.set(p.x, p.y, p.z);
      if (oriented) {
        const vl = Math.hypot(p.vx, p.vy, p.vz);
        if (vl > 1e-4) { this.v3.set(p.vx / vl, p.vy / vl, p.vz / vl); this.q.setFromUnitVectors(this.up, this.v3); }
        else this.q.identity();
        this.s3.set(s, s * p.stretch, s);
      } else {
        this.q.setFromAxisAngle(this.up, p.rot);
        this.s3.set(s, s * 0.9, s);
      }
      this.m4.compose(this.p3, this.q, this.s3);
      im.setMatrixAt(n, this.m4);
      const cu = Math.min(1, u * 1.3);
      this.col.setRGB(p.c0[0] + (p.c1[0] - p.c0[0]) * cu, p.c0[1] + (p.c1[1] - p.c0[1]) * cu, p.c0[2] + (p.c1[2] - p.c0[2]) * cu);
      im.setColorAt(n, this.col);
      n++;
    }
    im.count = n;
    im.visible = n > 0;
    if (n > 0) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private drawRibbons(w: World, f: FrameInfo, dt: number): void {
    const pos = this.ribPos!, colA = this.ribCol!;
    const P = pos.array as Float32Array, C = colA.array as Float32Array;
    const rf = this.ctx.quality.reduceFlashing;
    const cam = this.camera();
    const vpH = Math.max(1, this.ctx.renderer.domElement.clientHeight || 720);
    let quads = 0;
    const maxQ = RIBBON_QUADS;
    for (const b of this.bolts.items) {
      if (b.t >= b.life) continue;
      b.t += dt;
      if (b.t >= b.life) continue;
      const u = b.t / b.life;
      // (re)jitter the polyline at ~30 Hz (lightning) — vines re-shape every frame
      b.jitT += dt;
      const segs = b.n - 1;
      const count = segs * b.sub + 1;
      if (b.vine || b.jitT >= 1 / 30 || dt === 0 && b.t === 0) {
        b.jitT = 0;
        this.buildPolyline(b, u);
      }
      // lightning flickers (visible 2 of every 3 re-jitters) unless reduceFlashing
      if (!b.vine && !rf && ((b.t * 30) | 0) % 3 === 2) continue;
      const fade = b.vine ? (u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25) : (rf ? 1 - u : (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4));
      // world width per pixel at the bolt's distance
      const mx = b.base[0], my = b.base[1], mz = b.base[2];
      const dist = Math.max(1, cam.position.distanceTo(this.p3.set(mx, my, mz)));
      const wpp = (dist * K_VIEW) / vpH;
      const layers = b.vine ? 3 : 3;
      for (let L = 0; L < layers; L++) {
        let wdt: number; let cr: number, cg: number, cb: number, ca: number;
        if (b.vine) {
          const base = b.wPx;          // world units for vines
          if (L === 0) { wdt = base + wpp * 4; cr = this.ink[0]; cg = this.ink[1]; cb = this.ink[2]; ca = 1; }
          else if (L === 1) { wdt = base; cr = b.glow[0]; cg = b.glow[1]; cb = b.glow[2]; ca = 1; }
          else { wdt = base * 0.45; cr = b.core[0]; cg = b.core[1]; cb = b.core[2]; ca = 1; }
        } else {
          if (L === 0) { wdt = (b.wPx + 4) * wpp; cr = this.ink[0]; cg = this.ink[1]; cb = this.ink[2]; ca = 0.9; }
          else if (L === 1) { wdt = (b.wPx + 1.5) * wpp; cr = b.glow[0]; cg = b.glow[1]; cb = b.glow[2]; ca = 1; }
          else { wdt = Math.max(1, b.wPx * 0.4) * wpp; cr = b.core[0]; cg = b.core[1]; cb = b.core[2]; ca = rf ? 0.8 : 1; }
        }
        ca *= fade;
        // vines: taper toward the tip, and only the extended part is drawn
        const shown = b.vine ? Math.max(2, Math.round((count - 1) * Math.min(1, u / 0.18) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 * 0.6 : 1)) + 1) : count;
        for (let i = 0; i + 1 < shown && quads < maxQ; i++) {
          const ax = b.pts[i * 3], ay = b.pts[i * 3 + 1], az = b.pts[i * 3 + 2];
          const bx = b.pts[i * 3 + 3], by = b.pts[i * 3 + 4], bz = b.pts[i * 3 + 5];
          // side vector = normalize(cross(segment, view dir))
          let sx = (by - ay) * this.camDir.z - (bz - az) * this.camDir.y;
          let sy = (bz - az) * this.camDir.x - (bx - ax) * this.camDir.z;
          let sz = (bx - ax) * this.camDir.y - (by - ay) * this.camDir.x;
          const sl = Math.hypot(sx, sy, sz) || 1;
          const taper0 = b.vine ? 1 - (i / shown) * 0.65 : 1, taper1 = b.vine ? 1 - ((i + 1) / shown) * 0.65 : 1;
          const h0 = wdt * 0.5 * taper0 / sl, h1 = wdt * 0.5 * taper1 / sl;
          const o = quads * 18;
          const ax0 = ax - sx * h0, ay0 = ay - sy * h0, az0 = az - sz * h0, ax1 = ax + sx * h0, ay1 = ay + sy * h0, az1 = az + sz * h0;
          const bx0 = bx - sx * h1, by0 = by - sy * h1, bz0 = bz - sz * h1, bx1 = bx + sx * h1, by1 = by + sy * h1, bz1 = bz + sz * h1;
          P[o] = ax0; P[o + 1] = ay0; P[o + 2] = az0; P[o + 3] = bx0; P[o + 4] = by0; P[o + 5] = bz0; P[o + 6] = bx1; P[o + 7] = by1; P[o + 8] = bz1;
          P[o + 9] = ax0; P[o + 10] = ay0; P[o + 11] = az0; P[o + 12] = bx1; P[o + 13] = by1; P[o + 14] = bz1; P[o + 15] = ax1; P[o + 16] = ay1; P[o + 17] = az1;
          const oc = quads * 24;
          for (let k = 0; k < 6; k++) { C[oc + k * 4] = cr; C[oc + k * 4 + 1] = cg; C[oc + k * 4 + 2] = cb; C[oc + k * 4 + 3] = ca; }
          quads++;
        }
      }
    }
    const g = this.ribbon!.geometry;
    g.setDrawRange(0, quads * 6);
    this.ribbon!.visible = quads > 0;
    if (quads > 0) {
      pos.clearUpdateRanges(); pos.addUpdateRange(0, quads * 18); pos.needsUpdate = true;
      colA.clearUpdateRanges(); colA.addUpdateRange(0, quads * 24); colA.needsUpdate = true;
    }
  }

  /** subdivide + jitter a bolt's control polyline (lightning), or shape a lashing vine */
  private buildPolyline(b: Bolt, u: number): void {
    const segs = b.n - 1;
    let o = 0;
    for (let s = 0; s < segs; s++) {
      const ax = b.base[s * 3], ay = b.base[s * 3 + 1], az = b.base[s * 3 + 2];
      const bx = b.base[s * 3 + 3], by = b.base[s * 3 + 4], bz = b.base[s * 3 + 5];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len, pz = dx / len;               // horizontal perpendicular
      for (let k = 0; k < b.sub; k++) {
        const t = k / b.sub;
        let x = ax + dx * t, y = ay + (by - ay) * t, z = az + dz * t;
        if (b.vine) {
          // a whip: travelling sine that decays, lifted in an arc
          const env = Math.sin(Math.PI * t) * (1 - u) * (1 - u);
          const wave = Math.sin(t * 9 - u * 28) * b.amp * env;
          x += px * wave; z += pz * wave;
          y += Math.sin(Math.PI * t) * b.amp * 0.6 * (1 - u);
        } else if (k > 0) {
          const amp = Math.min(b.amp, len * 0.16) * Math.sin(Math.PI * t) + b.amp * 0.15;
          const j = (Math.random() - 0.5) * 2 * amp;
          x += px * j; z += pz * j; y += (Math.random() - 0.5) * amp * 0.8;
        }
        b.pts[o++] = x; b.pts[o++] = y; b.pts[o++] = z;
      }
    }
    b.pts[o++] = b.base[segs * 3]; b.pts[o++] = b.base[segs * 3 + 1]; b.pts[o++] = b.base[segs * 3 + 2];
  }

  private drawSprites(f: FrameInfo, dt: number): void {
    const sb = this.spriteWorld!, at = this.atlas!;
    sb.begin();
    for (const s of this.sprites.items) {
      if (s.t >= s.life) continue;
      s.t += dt;
      if (s.t < 0 || s.t >= s.life) continue;
      const u = s.t / s.life;
      const dk = Math.exp(-s.drag * dt);
      s.vx *= dk; s.vz *= dk; s.vy = s.vy * dk - s.grav * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < 0.05) { s.y = 0.05; s.vy = Math.abs(s.vy) * 0.35; s.vx *= 0.6; s.vz *= 0.6; }
      s.rot += s.vrot * dt;
      let k: number, a = 1;
      if (s.pop) {
        k = u < 0.15 ? 0.3 + (u / 0.15) * 0.8 : u < 0.25 ? 1.1 - (u - 0.15) : 1 - Math.max(0, (u - 0.7) / 0.3);
      } else {
        k = 1; a = 1 - u * u;
      }
      const sz = s.size * Math.max(0, k);
      sb.push(s.x, s.y, s.z, sz, sz, s.rot, at.cells, at.iconBase + s.icon, s.fill, a, s.back);
    }
    sb.end();
  }

  private drawWords(f: FrameInfo, dt: number): void {
    const sb = this.spriteTop!, at = this.atlas!;
    const rf = this.ctx.quality.reduceFlashing;
    sb.begin();
    for (const wd of this.words.items) {
      if (wd.t >= wd.life) continue;
      wd.t += dt;
      if (wd.t >= wd.life) continue;
      const u = wd.t / wd.life;
      // pop: overshoot scale-in (easeOutBack), jitter for the first ~0.3 s, drift up, fade out
      const tIn = Math.min(1, wd.t / 0.16);
      const back = 1 + 2.70158 * Math.pow(tIn - 1, 3) + 1.70158 * Math.pow(tIn - 1, 2);
      let k = 0.35 + 0.65 * back;
      let a = 1;
      if (u > 0.72) { const v = (u - 0.72) / 0.28; a = 1 - v; k *= 1 - 0.15 * v; }
      if (wd.t < 0.3 && dt > 0 && !rf) {
        wd.jx = (Math.random() - 0.5) * wd.h * 0.08;
        wd.jy = (Math.random() - 0.5) * wd.h * 0.08;
      } else if (wd.t >= 0.3) { wd.jx *= 0.8; wd.jy *= 0.8; }
      const rise = wd.h * 0.35 * u;
      const cell = wd.cell;
      const aspect = at.cells[cell * 5 + 4] || 3.4;
      const h = wd.h * k;
      sb.push(wd.x + wd.jx, wd.y + rise + wd.jy, wd.z, h * aspect, h, wd.rot + (wd.t < 0.3 && !rf ? (Math.random() - 0.5) * 0.06 : 0),
        at.cells, cell, wd.fill, a, wd.back);
    }
    sb.end();
  }

  private enemy(w: World, id: number): Enemy | undefined {
    if (this.enemyMapTick !== w.tick) {
      this.enemyMap.clear();
      for (const e of w.enemies) this.enemyMap.set(e.id, e);
      this.enemyMapTick = w.tick;
    }
    return this.enemyMap.get(id);
  }
}

/** cached hex → linear rgb triple (shared, read-only: every spawner COPIES the values) */
const LIN_CACHE = new Map<string, number[]>();
function L(hex: string): number[] {
  let v = LIN_CACHE.get(hex);
  if (!v) { v = [0, 0, 0]; lin(hex, v, 0); LIN_CACHE.set(hex, v); }
  return v;
}
