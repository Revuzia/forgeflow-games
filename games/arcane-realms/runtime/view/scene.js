// Arcane Realms TCG — Three.js board scene: card meshes, layout, tweens,
// highlights, picking. Pure presentation — match.js drives it from engine events.

import * as THREE from 'three';
import { getCard, getBoardCard, getCardBack, CARD_W, CARD_H } from './cardtex.js?v=24';
import { REALMS, cardById } from '../sim/cards.js?v=24';
import { FX } from './fx.js?v=24';

const CW = 1.3, CH = CW * (CARD_H / CARD_W); // card world size
const HIT_RED = new THREE.Color(0x9a1408); // hero hit-flash tint
// realm-tinted emissive for 3D characters: emissiveMap = the diffuse map, so the
// texture's HOT parts glow in the realm color (ember hero's red arms/chest, etc.)
// while dark armor stays dark. Cheap — no extra textures, no shader work.
const REALM_EMISSIVE = {
  ember: 0xff5a22, tide: 0x3fb6ff, grove: 0x59d97a,
  dawn: 0xffd76a, grave: 0xb45cff, neutral: 0x9a7bff,
};
export const LAYOUT = {
  playerBoardZ: 1.22, enemyBoardZ: -1.72, slotDX: 1.62,
  handZ: 4.52, handY: 1.0, enemyHandZ: -3.98,
  deckX: 7.5, playerDeckZ: 3.1, enemyDeckZ: -3.1,
  trapX: -7.35, playerTrapZ: 2.35, enemyTrapZ: -2.35,
  // heroes stand CENTERED (Hearthstone-style), each IN FRONT of its OWN hand row
  // so the full 3D figure reads over the cards (never over the board). Player sits
  // in front of handZ 4.52 (margin ~0.53); the enemy mirrors that — in front of its
  // hand (enemyHandZ+0.35 = -3.63), not behind it. Applies at every camera pitch.
  heroPlayer: new THREE.Vector3(0, 0.12, 5.05),
  heroEnemy: new THREE.Vector3(0, 0.44, -3.12),
};

// ── tiny tween engine ────────────────────────────────────────────
const EASE = {
  cubicOut: (t) => 1 - Math.pow(1 - t, 3),
  cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  backOut: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
  sineIn: (t) => 1 - Math.cos((t * Math.PI) / 2),
  linear: (t) => t,
};
class Tweens {
  constructor() { this.list = []; }
  add(obj, to, dur, ease = 'cubicOut', onDone = null) {
    const from = {};
    for (const k of Object.keys(to)) from[k] = obj[k];
    const tw = { obj, from, to, dur, t: 0, ease: EASE[ease] || EASE.cubicOut, onDone, dead: false };
    this.list.push(tw);
    return new Promise((res) => { tw.res = res; });
  }
  killOf(obj) { for (const tw of this.list) if (tw.obj === obj) tw.dead = true; }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      if (tw.dead) { this.list.splice(i, 1); tw.res && tw.res(); continue; }
      tw.t += dt;
      const f = Math.min(1, tw.t / tw.dur);
      const e = tw.ease(f);
      for (const k of Object.keys(tw.to)) tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      if (f >= 1) {
        this.list.splice(i, 1);
        tw.onDone && tw.onDone();
        tw.res && tw.res();
      }
    }
  }
}

// ── stat chips (small number gems pinned to unit cards) ──────────
const chipCache = new Map();
function chipTexture(value, style) {
  const key = value + ':' + style;
  if (chipCache.has(key)) return chipCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  const colors = {
    atk: '#c8392e', atkBuff: '#ff7a3d', hp: '#2e8f3f', hpBuff: '#54d06a', hpHurt: '#d43f3f',
  };
  const col = colors[style] || '#888';
  const grad = g.createRadialGradient(38, 34, 6, 48, 48, 46);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.3, col);
  grad.addColorStop(1, '#160f08');
  g.beginPath(); g.arc(48, 48, 44, 0, Math.PI * 2);
  g.fillStyle = grad; g.fill();
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.65)'; g.stroke();
  g.font = '800 52px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillText(String(value), 50, 54);
  g.fillStyle = '#fff'; g.fillText(String(value), 48, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  chipCache.set(key, tex);
  return tex;
}

const badgeCache = new Map();
function badgeTexture(glyph, color) {
  const key = glyph + color;
  if (badgeCache.has(key)) return badgeCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(48, 48, 42, 0, Math.PI * 2);
  g.fillStyle = 'rgba(10,8,18,.85)'; g.fill();
  g.lineWidth = 5; g.strokeStyle = color; g.stroke();
  g.font = '700 46px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(glyph, 48, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  badgeCache.set(key, tex);
  return tex;
}
const KW_BADGE = {
  guard: ['🛡', '#e8b93a'], flying: ['≋', '#7fc4ff'], stealth: ['◍', '#9a90b8'],
  ward: ['◇', '#4fd0e8'], lifesteal: ['❤', '#e85fa0'], venomous: ['☠', '#7fd44f'],
  cleave: ['⚔', '#ff8a3d'], piercing: ['➹', '#d4b03f'], regenerate: ['✚', '#54d06a'],
  frenzy: ['🔥', '#ff5f3d'], swift: ['»', '#ffd45f'],
};

// 3D minis for legendary creatures — lazy-loaded from assets/minis/ only when
// the card actually hits the board. Curated BY EYE from the unused F:
// sketchfab haul (two lineup passes; props/junk rejected). Quality > coverage:
// legendaries without a worthy model simply get no mini. Extend by dropping a
// GLB in assets/minis/ and adding a row here.
// s = height target, cap = max ground footprint (long/winged models trade
// height for span), hover = base lift + idle bob for flyers,
// glow = realm-colored ground disc so dark models read on the dark board
export const MINI_MAP = {
  // all Meshy image-to-3d from card art (the sketchfab originals had broken
  // rigs/bounds — sprawled/sunk models — and were regenerated 2026-07-09)
  ef19:  { file: 'mini_ef19.glb',  s: 1.75, cap: 2.4, glow: 0xff7a2e }, // Pyraxis — dragon
  efc10: { file: 'mini_efc10.glb', s: 1.6,  glow: 0xff7a2e }, // Vulkarrion — gargoyle
  gm18:  { file: 'mini_gm18.glb',  s: 1.55, glow: 0xb45cff }, // Morthul — shade
  gmc10: { file: 'mini_gmc10.glb', s: 1.55, glow: 0xb45cff }, // Nyxathra — demon
  tc18:  { file: 'mini_tc18.glb',  s: 1.7,  cap: 2.2, glow: 0x3fb6ff }, // Nerivia — leviathan
  tcc10: { file: 'mini_tcc10.glb', s: 1.55, glow: 0x3fb6ff }, // Maelstra — siren
  wgc10: { file: 'mini_wgc10.glb', s: 1.6,  glow: 0x59d97a }, // Sylvaris — troll
  dwc10: { file: 'mini_dwc10.glb', s: 1.5,  glow: 0xffd76a }, // Solmara — light spirit
  nt21:  { file: 'mini_nt21.glb',  s: 1.3,  glow: 0x9a7bff }, // Chronarch Vex
  // ── more Meshy image-to-3d LEGENDARIES ──
  wg18:  { file: 'mini_wg18.glb',  s: 1.7,  cap: 1.5, glow: 0x59d97a }, // Verdance, Heart of the Grove
  dw16:  { file: 'mini_dw16.glb',  s: 1.6,  glow: 0xffd76a }, // Seraphine, High Justicar
  nt20:  { file: 'mini_nt20.glb',  s: 1.5,  glow: 0x9a7bff }, // Zanzibar, Planar Merchant
  ntc10: { file: 'mini_ntc10.glb', s: 1.55, glow: 0x9a7bff }, // Aurelion the Collector

  // ── EPICS — deliberately a tier SMALLER & less grand than legendaries ──
  ef15:  { file: 'mini_ef15.glb',  s: 1.35, glow: 0xff7a2e }, // Phoenix of the Second Dawn
  gm14:  { file: 'mini_gm14.glb',  s: 1.25, glow: 0xb45cff }, // Plaguebringer Lich
  tcc8:  { file: 'mini_tcc8.glb',  s: 1.4,  glow: 0x3fb6ff }, // Abyssal Kraken
  ef20:  { file: 'mini_ef20.glb',  s: 1.25, glow: 0xff7a2e }, // Hellforged Berserker
  tc16:  { file: 'mini_tc16.glb',  s: 1.35, glow: 0x3fb6ff }, // Tempest Serpent
  tc19:  { file: 'mini_tc19.glb',  s: 1.25, hover: 0.25, glow: 0x3fb6ff }, // Mirrorplane Archon
  wg17:  { file: 'mini_wg17.glb',  s: 1.4,  cap: 1.5, glow: 0x59d97a }, // Primal Colossus
  dw13:  { file: 'mini_dw13.glb',  s: 1.3,  hover: 0.25, glow: 0xffd76a }, // Seraph of Mercy
  wgc8:  { file: 'mini_wgc8.glb',  s: 1.4,  glow: 0x59d97a }, // Emerald Wyrm
  // ── Aetherbound: the 10 Pact marquee minis (one per realm pair) ──
  et06:  { file: 'mini_et06.glb',  s: 1.7,  cap: 2.4, glow: 0xa878ff }, // Stormcrown Leviathan
  eg06:  { file: 'mini_eg06.glb',  s: 1.7,  cap: 2.0, glow: 0xff9a3e }, // Vorrgax, the Wildfire Titan
  ed06:  { file: 'mini_ed06.glb',  s: 1.55, glow: 0xffb84a }, // Aurelian, the Dawnbanner
  ev06:  { file: 'mini_ev06.glb',  s: 1.6,  glow: 0xd85cc0 }, // Malgroth, the Cinder Tyrant
  tg06:  { file: 'mini_tg06.glb',  s: 1.7,  cap: 2.0, glow: 0x4fd0b0 }, // Thalassa, the Everbloom
  td06:  { file: 'mini_td06.glb',  s: 1.55, glow: 0x8fd0ff }, // Sariel, the Frozen Dawn
  tv06:  { file: 'mini_tv06.glb',  s: 1.5,  glow: 0x6f8fe8 }, // Maelstrom Chronicler
  gd06:  { file: 'mini_gd06.glb',  s: 1.65, cap: 1.6, glow: 0x9fd96a }, // Elarion, Voice of the Verdant Choir
  gv06:  { file: 'mini_gv06.glb',  s: 1.6,  glow: 0x7fbf5c }, // Sythrala, Matriarch of the Rotwood
  dv06:  { file: 'mini_dv06.glb',  s: 1.55, glow: 0xc9a6ff }, // Vael, the Pale Tithe
};

// element-styled FX auras — LEGENDARIES ONLY (epics get the bare model).
// Meshy makes 3D meshes, not particle FX; these are procedural Three.js.
const ELEMENT_FX = {
  ember:   { color: 0xff7a2e, rate: 10, style: 'ember' },  // rising hot embers
  tide:    { color: 0x6fd8ff, rate: 8,  style: 'frost' },  // drifting frost mist
  grove:   { color: 0x6fe08a, rate: 8,  style: 'spore' },  // floating spores
  dawn:    { color: 0xffe6a0, rate: 9,  style: 'light' },  // rising light motes
  grave:   { color: 0xb47bff, rate: 8,  style: 'shadow' }, // slow shadow wisps
  neutral: { color: 0xb49bff, rate: 7,  style: 'arcane' }, // arcane sparkles
};

let _miniGlowTex = null;
function miniGlowTex() {
  if (_miniGlowTex) return _miniGlowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _miniGlowTex = new THREE.CanvasTexture(c);
  _miniGlowTex.colorSpace = THREE.SRGBColorSpace;
  return _miniGlowTex;
}

function roundRectShape(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0);
  s.lineTo(w / 2, h / 2 - r); s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2);
  s.lineTo(-w / 2 + r, h / 2); s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI);
  s.lineTo(-w / 2, -h / 2 + r); s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5);
  return s;
}

export class BoardScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'arc-canvas';
    // HTML overlay for stat orbs + badges — positioned a fixed number of
    // pixels BELOW each creature on screen, so numbers are always readable and
    // never cover the 3D model's body (world-space orbs fought perspective).
    this.npLayer = document.createElement('div');
    this.npLayer.id = 'np-layer';
    container.appendChild(this.npLayer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b0714');
    this.scene.fog = new THREE.Fog('#0b0714', 18, 30);

    // pulled back + slightly wider than before so more of the board reads and
    // there's room for the centred heroes in front of each card row
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
    this.camera.position.set(0, 12.1, 11.2);
    this.camera.lookAt(0, 0, 0.35);
    this.camShakeT = 0; this.camShakeAmp = 0;
    this.camBase = this.camera.position.clone();
    // scroll-wheel zoom: dolly toward the board centre to inspect cards & the
    // animated legendaries, scroll back out to the default framing (zoom 0)
    this.camPivot = new THREE.Vector3(0, 0, 0.62);
    this.camZoomPos = this.camBase.clone().lerp(this.camPivot, 0.6);
    this.zoom = 0; this.zoomTarget = 0;
    this.renderer.domElement.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoomTarget = Math.max(0, Math.min(1, this.zoomTarget - ev.deltaY * 0.0012));
    }, { passive: false });
    // RIGHT-drag: tilt the view up/down (orbit pitch around the board pivot).
    // Non-inverted: drag UP → the camera drops to a lower, more side-on angle
    // (you "look up" at the board); drag DOWN → a higher, more top-down angle.
    // Clamped so you never dip under the table or flip fully overhead. The hand
    // cards re-tilt to keep facing the camera (see _retiltCards / handTransform).
    this.pitch = 0; this.pitchTarget = 0; this._pdrag = null;
    const cel = this.renderer.domElement;
    cel.addEventListener('contextmenu', (e) => e.preventDefault());
    cel.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { this._pdrag = { y: e.clientY, base: this.pitchTarget }; cel.setPointerCapture?.(e.pointerId); }
    });
    cel.addEventListener('pointermove', (e) => {
      if (!this._pdrag) return;
      const dy = e.clientY - this._pdrag.y;
      this.pitchTarget = Math.max(-0.42, Math.min(0.6, this._pdrag.base + dy * 0.0032));
    });
    const endPitch = (e) => { if (this._pdrag) { cel.releasePointerCapture?.(e.pointerId); this._pdrag = null; } };
    cel.addEventListener('pointerup', endPitch);
    cel.addEventListener('pointercancel', endPitch);

    // lights (table only — cards are unlit for color fidelity)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xfff2dd, 1.15);
    key.position.set(-4, 10, 6);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x8a5fd4, 30, 26);
    rim.position.set(7, 5, -6);
    this.scene.add(rim);

    // table
    const tableTex = new THREE.TextureLoader().load('assets/ui/board.jpg');
    tableTex.colorSpace = THREE.SRGBColorSpace;
    tableTex.anisotropy = 8;
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(21.4, 12.6),
      new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.92, metalness: 0.05 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.04;
    table.userData = { kind: 'table' };
    this.scene.add(table);
    this.table = table;

    // ── 3D table build (pure three.js — no external models) ────────
    // The flat art plane above stays the play surface + pick target; beneath
    // and around it: a thick stone body, a carved rim with gold corner caps,
    // glowing rune inlays, a plinth, and a vignetted chamber floor, so the
    // board reads as a real object in a space instead of a floating image.
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2a2036, roughness: 0.88, metalness: 0.18 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(21.4, 0.62, 12.6), stoneMat);
    body.position.y = -0.36;
    this.scene.add(body);
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x4a3358, roughness: 0.55, metalness: 0.55,
      emissive: 0x1a0f26, emissiveIntensity: 0.5,
    });
    for (const [w, h2, d, x, z] of [
      [22.6, 0.26, 0.62, 0, -6.6], [22.6, 0.26, 0.62, 0, 6.6],   // long rails
      [0.62, 0.26, 13.8, -11.0, 0], [0.62, 0.26, 13.8, 11.0, 0], // side rails
    ]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h2, d), trimMat);
      rail.position.set(x, 0.05, z);
      this.scene.add(rail);
    }
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0x8a6a2a, roughness: 0.4, metalness: 0.75,
      emissive: 0x332008, emissiveIntensity: 0.6,
    });
    for (const [x, z] of [[-11.0, -6.6], [11.0, -6.6], [-11.0, 6.6], [11.0, 6.6]]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.4, 1.05), goldMat);
      cap.position.set(x, 0.1, z);
      this.scene.add(cap);
    }
    // rune inlays: soft additive strips along the rails that slowly breathe
    this.runeStrips = [];
    const runeMat = () => new THREE.MeshBasicMaterial({
      color: 0x8a5fd4, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (const z of [-6.6, 6.6]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(20.9, 0.16), runeMat());
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(0, 0.185, z);
      this.scene.add(strip);
      this.runeStrips.push(strip);
    }
    for (const x of [-11.0, 11.0]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 12.1), runeMat());
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(x, 0.185, 0);
      this.scene.add(strip);
      this.runeStrips.push(strip);
    }
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(23.8, 0.5, 14.8),
      new THREE.MeshStandardMaterial({ color: 0x1b1426, roughness: 0.94, metalness: 0.1 }),
    );
    plinth.position.y = -0.95;
    this.scene.add(plinth);
    // chamber floor: radial-gradient disc far below — fog vignettes it away
    const fc = document.createElement('canvas');
    fc.width = fc.height = 256;
    const fg = fc.getContext('2d');
    const fgrad = fg.createRadialGradient(128, 128, 10, 128, 128, 128);
    fgrad.addColorStop(0, '#241a33');
    fgrad.addColorStop(0.55, '#120c1e');
    fgrad.addColorStop(1, '#05030a');
    fg.fillStyle = fgrad;
    fg.fillRect(0, 0, 256, 256);
    const floorTex = new THREE.CanvasTexture(fc);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(34, 48),
      new THREE.MeshBasicMaterial({ map: floorTex }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.55;
    this.scene.add(floor);

    // center line glow
    const mid = new THREE.Mesh(
      new THREE.PlaneGeometry(16.4, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x7a5cb8, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending }),
    );
    mid.rotation.x = -Math.PI / 2;
    mid.position.set(0, 0.01, -0.08);
    this.scene.add(mid);

    // hero plates — compact discs that stay clear of the card rows
    this.heroMeshes = [];
    for (const [i, pos] of [[0, LAYOUT.heroPlayer], [1, LAYOUT.heroEnemy]]) {
      const gtex = new THREE.TextureLoader().load(`assets/ui/hero_${i === 0 ? 'dawn' : 'grave'}.jpg`);
      gtex.colorSpace = THREE.SRGBColorSpace;
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.56, 0.67, 48),
        new THREE.MeshBasicMaterial({ color: 0xd4952b, transparent: true, opacity: 0.9 }),
      );
      ring.rotation.x = -Math.PI / 2;
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.56, 48),
        new THREE.MeshBasicMaterial({ map: gtex }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.005;
      grp.add(ring, disc);
      grp.position.copy(pos);
      grp.userData = { kind: 'hero', p: i };
      disc.userData = grp.userData; ring.userData = grp.userData;
      this.scene.add(grp);
      this.heroMeshes.push(grp);
    }

    // deck stacks + trap zone markers (visual only; counts in DOM)
    this.backs = [getCardBack(), getCardBack()]; // [my back, foe back]
    this.deckMeshes = [];
    for (const [i, z] of [[0, LAYOUT.playerDeckZ], [1, LAYOUT.enemyDeckZ]]) {
      const grp = new THREE.Group();
      for (let s = 0; s < 3; s++) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(CW * 0.92, CH * 0.92),
          new THREE.MeshBasicMaterial({ map: this.backs[i].tex }),
        );
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.02 + s * 0.022;
        grp.add(m);
      }
      grp.position.set(LAYOUT.deckX, 0, z);
      this.scene.add(grp);
      this.deckMeshes.push(grp);
    }

    // battlefield diorama: corner braziers with ember light + realm crystals
    this.dioramaSpin = [];
    const brazierMat = new THREE.MeshStandardMaterial({ color: 0x2a2130, roughness: 0.85, metalness: 0.4 });
    this.brazierPts = [];
    for (const [bx, bz] of [[-10.4, -5.9], [10.4, -5.9], [-10.4, 5.9], [10.4, 5.9]]) {
      const grp = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 1.15, 8), brazierMat);
      stem.position.y = 0.57;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.2, 0.3, 10), brazierMat);
      bowl.position.y = 1.25;
      const glow = new THREE.PointLight(0xff8a3d, 5, 6);
      glow.position.y = 1.65;
      grp.add(stem, bowl, glow);
      grp.position.set(bx, 0, bz);
      this.scene.add(grp);
      this.brazierPts.push(new THREE.Vector3(bx, 1.45, bz));
    }
    for (const [cx, cz, ccol] of [[-9.9, 0, 0x7a5cd4], [9.9, 0, 0x4fd0e8]]) {
      const crystal = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.5, 0),
        new THREE.MeshStandardMaterial({ color: ccol, emissive: ccol, emissiveIntensity: 0.9, roughness: 0.2 }),
      );
      crystal.position.set(cx, 1.5, cz);
      this.scene.add(crystal);
      this.dioramaSpin.push(crystal);
    }

    // 3D minis for legendaries (lazy-loaded GLBs — zero upfront payload)
    this.minis = new Map();       // unit iid -> {group, mixer, offset}
    this._miniBuf = new Map();    // file -> Promise<ArrayBuffer>
    this._gltfLoaderP = null;

    this.tweens = new Tweens();
    this.fx = new FX(this.scene);
    this.raycaster = new THREE.Raycaster();
    this.cards = new Map(); // iid -> entry
    this.trapMeshes = new Map(); // iid -> mesh (face-down)
    this.ghost = null; // slot drop ghost
    this.time = 0;
    this.animSpeed = 1;
    this.reduceShake = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep whole table in view on narrow screens
    this.camera.fov = w / h < 1.45 ? 52 : 45;
    this.camera.updateProjectionMatrix();
  }

  // ── card entries ───────────────────────────────────────────────
  makeCardEntry(iid, cardId, side) {
    const group = new THREE.Group();       // world position + tap spin (y)
    const inner = new THREE.Group();       // facing rotation (x) + flips
    group.add(inner);
    const { tex } = getCard(cardId);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CW, CH),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    );
    mesh.userData = { kind: 'card', iid };
    inner.add(mesh);
    // selection highlight — a CRISP THIN rounded frame hugging the card edge
    // (was a thick additive under-glow; owner wanted something cleaner)
    const glowOuter = roundRectShape(CW * 1.05, CH * 1.045, 0.12);
    glowOuter.holes.push(roundRectShape(CW * 0.985, CH * 0.99, 0.10));
    const glowGeo = new THREE.ShapeGeometry(glowOuter);
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
      color: 0x4fd0e8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.position.z = -0.012;
    inner.add(glow);
    // ice overlay
    const ice = new THREE.Mesh(
      new THREE.ShapeGeometry(roundRectShape(CW * 1.0, CH * 1.0, 0.1)),
      new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0, depthWrite: false }),
    );
    ice.position.z = 0.012;
    inner.add(ice);
    this.scene.add(group);
    // static hover/click proxy (player hand only) — see _placeHandHit
    let hit = null;
    if (side === 0) {
      hit = new THREE.Mesh(
        new THREE.PlaneGeometry(CW * 1.06, CH * 1.9),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      hit.userData = { kind: 'handhit', iid };
      hit.visible = false;
      hit.position.y = -50;
      this.scene.add(hit);
    }
    const entry = {
      iid, cardId, side, group, inner, mesh, glow, ice, hit,
      zone: 'limbo', slot: 0, hover: false,
      chips: null, badges: [], tapSpin: 0, dead: false,
      home: { pos: new THREE.Vector3(), rotX: 0, rotZ: 0, scale: 1 },
    };
    this.cards.set(iid, entry);
    return entry;
  }

  removeEntry(iid) {
    const e = this.cards.get(iid);
    if (!e) return;
    this.tweens.killOf(e.group.position);
    this.tweens.killOf(e.group.rotation);
    this.fx.clearEmitter('aura' + iid);
    this.despawnMini(iid);
    // scene-space nameplate (orbs + badges) lives outside e.group — remove it
    if (e.chips) { e.chips.atk.remove(); e.chips.hp.remove(); }
    for (const b of e.badges) b.remove();
    if (e.hit) { this.scene.remove(e.hit); e.hit.geometry.dispose(); e.hit.material.dispose(); }
    this.scene.remove(e.group);
    this.cards.delete(iid);
  }

  ensureChips(e, atk, hp, maxHp, baseAtk, baseHp) {
    if (!e.chips) {
      const mk = (cls) => { const d = document.createElement('div'); d.className = 'np-orb ' + cls; this.npLayer.appendChild(d); return d; };
      e.chips = { atk: mk('atk'), hp: mk('hp') };
    }
    const atkStyle = atk > baseAtk ? 'atkBuff' : 'atk';
    const hpStyle = hp < maxHp ? 'hpHurt' : (maxHp > baseHp ? 'hpBuff' : 'hp');
    e.chips.atk.textContent = atk; e.chips.atk.dataset.s = atkStyle;
    e.chips.hp.textContent = hp;  e.chips.hp.dataset.s = hpStyle;
  }

  setBadges(e, unit) {
    // HTML badges in the same nameplate cluster — never cover the model
    for (const b of e.badges) b.remove();
    e.badges = [];
    if (!unit) return;
    // 'swift' badge dropped (owner) — it only matters the turn of summon; the
    // keyword still shows in the full card on hover. corner = which card corner.
    const kws = (unit.silenced ? [] : unit.kw).filter((k) => k !== 'swift');
    const shown = kws.slice(0, 3);
    if (unit.silenced) shown.push('_silenced');
    const mkBadge = (glyph, color, corner, i) => {
      const d = document.createElement('div');
      d.className = 'np-badge';
      d.textContent = glyph; d.style.color = color; d.style.borderColor = color;
      d._corner = corner; d._i = i; // placed each frame at that card corner
      this.npLayer.appendChild(d);
      e.badges.push(d);
    };
    // keyword badges stack down the TOP-LEFT corner
    shown.forEach((k, i) => {
      const [glyph, color] = k === '_silenced' ? ['✕', '#8d8d9e'] : (KW_BADGE[k] || ['•', '#ccc']);
      mkBadge(glyph, color, 'tl', i);
    });
    // status marker → TOP-RIGHT corner: FROZEN takes priority over exhausted
    if (unit.frozen) mkBadge('❄', '#9fdcff', 'tr', 0);
    else if (unit.tapped) mkBadge('💤', '#cdbcf2', 'tr', 0);
  }

  // place HTML orbs + badges at the CARD's actual corners (owner: bottom
  // corners, not centered). localToWorld handles per-side tilt/scale exactly.
  placeNameplate(e) {
    // hide ALL board orbs while ANY card is hover-enlarged (hand OR board) —
    // the orbs are HTML above the canvas, so they'd overlap the enlarged card.
    // Two separate flags: match.js owns _hoverActive (hand), setBoardHover owns
    // _boardHoverActive — so un-hovering one can't clobber the other's state.
    if (this._hoverActive || this._boardHoverActive || this._showcaseActive || e.boardHover) { this.hideNameplate(e); return; }
    e.mesh.updateWorldMatrix(true, false);
    const cr = this.container.getBoundingClientRect();
    const corner = (lx, ly) => {
      const w = e.mesh.localToWorld(new THREE.Vector3(lx, ly, 0.06));
      const s = this.worldToScreen(w);
      return { x: s.x - cr.left, y: s.y - cr.top };
    };
    const put = (el, xy) => { el.style.left = xy.x + 'px'; el.style.top = xy.y + 'px'; el.style.display = ''; };
    // inset the orbs well INSIDE the card so they never bleed onto a neighbour
    const KX = CW / 2 * 0.6, KY = CH / 2 * 0.82;
    if (e.chips) { put(e.chips.atk, corner(-KX, -KY)); put(e.chips.hp, corner(KX, -KY)); } // bottom L/R
    for (const b of e.badges) {
      const c = b._corner === 'tr' ? corner(KX, KY) : corner(-KX, KY - b._i * 0.5); // top R / top L stack
      put(b, c);
    }
  }
  hideNameplate(e) {
    if (e.chips) { e.chips.atk.style.display = 'none'; e.chips.hp.style.display = 'none'; }
    for (const b of e.badges) b.style.display = 'none';
  }

  // ── layout ────────────────────────────────────────────────────
  // billboard helper: the exact X-tilt that makes a card at (y, z) face the
  // camera dead-on (industry standard — hand cards read screen-flat like HS).
  // Uses the LIVE camera position, so pitch/zoom compose automatically.
  faceCamRotX(y, z) {
    return -Math.atan2(this.camera.position.y - y, this.camera.position.z - z);
  }

  handTransform(side, i, n, hovered) {
    const spread = Math.min(1.18, 7.4 / Math.max(n, 1));
    const x = (i - (n - 1) / 2) * spread;
    if (side === 0) {
      const arc = Math.abs(i - (n - 1) / 2) / Math.max(1, (n - 1) / 2 || 1);
      // hovered: rise well above the fan, fully readable, in front of everything
      const y = LAYOUT.handY + 0.3 - arc * 0.12 + (hovered ? 1.15 : 0);
      const z = LAYOUT.handZ - (hovered ? 0.55 : 0) + arc * 0.05;
      // side-on pitch brings the camera down toward the hand — damp the card
      // scale responsively so the near cards can't balloon over the board/HUD
      const pd = 1 - Math.max(0, this.pitch || 0) * 0.55;
      return {
        pos: new THREE.Vector3(x, y, z),
        rotX: this.faceCamRotX(y, z) + (hovered ? 0.08 : 0),
        rotZ: hovered ? 0 : -(i - (n - 1) / 2) * 0.045,
        scale: (hovered ? 1.62 : 0.94) * pd,
      };
    }
    // enemy hand (face-down backs) — tilt toward the camera like the player's
    // hand so the cards read as proper PORTRAIT rectangles, not foreshortened
    // squares. Brought slightly forward + bigger; gentle mirrored fan.
    return {
      pos: new THREE.Vector3(x * 0.94, LAYOUT.handY + 0.32, LAYOUT.enemyHandZ + 0.35),
      rotX: this.faceCamRotX(LAYOUT.handY + 0.32, LAYOUT.enemyHandZ + 0.35),
      rotZ: (i - (n - 1) / 2) * 0.04, scale: 0.9,
    };
  }

  // invisible, STATIC hover/click proxy for a hand card — raycast against this
  // instead of the moving visual mesh, so hovering near the card's bottom edge
  // can't lift the card out from under the pointer (the un/hover flicker loop).
  // The proxy is taller than the card and extends BELOW it: the whole lane down
  // to the screen bottom keeps the hover.
  _placeHandHit(e, t) {
    if (!e.hit) return;
    e.hit.position.set(t.pos.x, Math.max(0.35, t.pos.y - 0.55), t.pos.z + 0.02);
    e.hit.rotation.x = t.rotX;
    e.hit.visible = true;
  }
  _parkHandHit(e) { if (e.hit) { e.hit.visible = false; e.hit.position.y = -50; } }

  // re-tilt hand cards so they keep facing the camera as the view moves.
  // cheap: touches only the X rotation of hand-zone cards (no chip/mini rebuild).
  _retiltCards() {
    for (const e of this.cards.values()) {
      if (e.zone !== 'hand' || e.li == null) continue;
      const t = this.handTransform(e.side, e.li, e.ln, e.hover && e.side === 0);
      e.inner.rotation.x = t.rotX;
      if (e.side === 0) {
        e.group.scale.setScalar(t.scale); // pitch-responsive size (see handTransform)
        this._placeHandHit(e, e.hover ? this.handTransform(0, e.li, e.ln, false) : t);
      }
    }
  }

  // board hover: enlarge the REAL card in place and swap to the full-detail
  // texture so rules text is readable — no duplicate preview card
  setBoardHover(iid, on) {
    const e = this.cards.get(iid);
    if (!e || e.zone !== 'board') return;
    if (on === !!e.boardHover) return;
    e.boardHover = on;
    // show the FULL rules-text card on hover (like the deck view) + hide every
    // board orb so it reads cleanly. match.js suppresses this while you're
    // TARGETING a spell/attack, so it never covers the card you're clicking.
    this._boardHoverActive = on;
    this.setHoverFront(iid, on);
    const face = on ? getCard(e.cardId).tex : getBoardCard(e.cardId).tex;
    if (e.mesh.material.map !== face) { e.mesh.material.map = face; e.mesh.material.needsUpdate = true; }
    if (on) for (const c of this.cards.values()) this.hideNameplate(c);
    const base = this.boardTransform(e.side, e.slot, (e.side === 0 ? this._lastMyBoardN : this._lastFoeBoardN) || 6);
    if (on) {
      const pos = base.pos.clone().add(new THREE.Vector3(0, 1.15, e.side === 0 ? 0.35 : 0.7));
      this.applyTransform(e, {
        pos, rotX: this.faceCamRotX(pos.y, pos.z), rotZ: 0, scale: 1.5,
      }, 0.15);
    } else {
      this.applyTransform(e, base, 0.15);
    }
  }

  // hovered/selected cards must render in FRONT of neighbors and never z-fight
  setHoverFront(iid, on) {
    const e = this.cards.get(iid);
    if (!e) return;
    e.mesh.renderOrder = on ? 80 : 0;
    e.mesh.material.depthTest = !on;
    e.glow.renderOrder = on ? 79 : 50;
    e.mesh.material.needsUpdate = true;
  }

  boardTransform(side, i, n, exhausted) {
    const x = (i - (n - 1) / 2) * LAYOUT.slotDX;
    const z = side === 0 ? LAYOUT.playerBoardZ : LAYOUT.enemyBoardZ;
    // smaller board cards → less overlap with the 3D minis. Enemy cards tilt
    // up toward the camera so they read as rectangles, not foreshortened
    // squares; a small lift keeps the tilted bottom edge off the table.
    // constant scale — NO exhaust shrink (owner: cards must not tap/pop). The
    // "used" state reads from the dim + 💤 badge; the 3D mini lunge is the motion.
    const rotX = side === 0 ? -Math.PI / 2 : -Math.PI / 2 + 0.62;
    const y = side === 0 ? 0.06 : 0.42;
    return { pos: new THREE.Vector3(x, y, z), rotX, rotZ: 0, scale: 0.78 };
  }

  trapTransform(side, i) {
    const z = side === 0 ? LAYOUT.playerTrapZ : LAYOUT.enemyTrapZ;
    return { pos: new THREE.Vector3(LAYOUT.trapX, 0.03 + i * 0.03, z + i * 0.28), rotX: -Math.PI / 2, rotZ: 0, scale: 0.62 };
  }

  applyTransform(e, t, dur = 0.28, ease = 'cubicOut') {
    e.home = { pos: t.pos.clone(), rotX: t.rotX, rotZ: t.rotZ, scale: t.scale };
    this.tweens.killOf(e.group.position);
    this.tweens.killOf(e.inner.rotation);
    this.tweens.killOf(e.group.scale);
    const p = [];
    p.push(this.tweens.add(e.group.position, { x: t.pos.x, y: t.pos.y, z: t.pos.z }, dur, ease));
    p.push(this.tweens.add(e.inner.rotation, { x: t.rotX, z: t.rotZ }, dur, ease));
    p.push(this.tweens.add(e.group.scale, { x: t.scale, y: t.scale, z: t.scale }, dur, ease));
    return Promise.all(p);
  }

  // authoritative re-layout of all zones from state (no per-event animation)
  syncFromState(state, mySide, { instant = false } = {}) {
    const seen = new Set();
    const dur = instant ? 0.001 : 0.24;
    for (let p = 0; p < 2; p++) {
      const rel = p === mySide ? 0 : 1; // 0 = bottom of screen
      const pl = state.players[p];
      // hands
      pl.hand.forEach((h, i) => {
        seen.add(h.iid);
        let e = this.cards.get(h.iid);
        if (!e) {
          e = this.makeCardEntry(h.iid, h.card, rel);
          const dz = rel === 0 ? LAYOUT.playerDeckZ : LAYOUT.enemyDeckZ;
          e.group.position.set(LAYOUT.deckX, 0.3, dz);
        }
        e.zone = 'hand'; e.side = rel; e.cardId = h.card;
        e.li = i; e.ln = pl.hand.length; // remembered so _retiltCards can re-face the camera
        // enemy hand shows card BACKS
        const face = rel === 0 ? getCard(h.card).tex : this.backs[1].tex;
        if (e.mesh.material.map !== face) { e.mesh.material.map = face; e.mesh.material.needsUpdate = true; }
        this.applyTransform(e, this.handTransform(rel, i, pl.hand.length, e.hover && rel === 0), dur);
        if (rel === 0) this._placeHandHit(e, this.handTransform(0, i, pl.hand.length, false));
        if (e.chips) { e.chips.atk.remove(); e.chips.hp.remove(); e.chips = null; }
        for (const b of e.badges) b.remove(); e.badges = [];
        this.setBadges(e, null);
        e.ice.material.opacity = 0;
        e.group.rotation.y = 0; e.tapSpin = 0;
      });
      // boards
      if (rel === 0) this._lastMyBoardN = pl.board.length; else this._lastFoeBoardN = pl.board.length;
      pl.board.forEach((u, i) => {
        seen.add(u.iid);
        let e = this.cards.get(u.iid);
        if (!e) e = this.makeCardEntry(u.iid, u.card, rel);
        e.zone = 'board'; e.side = rel; e.slot = i; e.cardId = u.card;
        e.boardHover = false;
        this._parkHandHit(e);
        const face = getBoardCard(u.card).tex;
        if (e.mesh.material.map !== face) { e.mesh.material.map = face; e.mesh.material.needsUpdate = true; }
        this.applyTransform(e, this.boardTransform(rel, i, pl.board.length, u.tapped), dur);
        const def = cardById(u.card);
        this.ensureChips(e, /* live */ this.liveAtk(state, p, u), u.hp, u.maxHp, def.atk ?? 0, def.hp ?? 0);
        this.setBadges(e, u);
        // exhausted look — NO rotation (owner: cards must never turn sideways);
        // instead: dim + shrink (boardTransform) + 💤 badge (setBadges)
        this.tweens.killOf(e.group.rotation);
        e.group.rotation.y = 0;
        e.ice.material.opacity = u.frozen ? 0.4 : 0;
        // legendary element FX aura — legendary-only (epics: bare model)
        if (def.rarity === 'legendary') {
          const el = ELEMENT_FX[def.realm] || ELEMENT_FX.neutral;
          this.fx.setEmitter('aura' + u.iid, e.group.position, el.color, el.rate, el.style);
        }
        // lazy 3D mini — any mapped card (legendaries + curated epics).
        // Legendaries idle-animate (grander); epics stay static (tier).
        const mspec = this.use3d !== false ? MINI_MAP[u.card] : null; // grunts: flat card only
        if (mspec && !this.minis.has(u.iid)) this.spawnMini(u.iid, mspec, rel, def.rarity === 'legendary');
        // exhausted creatures rest dimmed; summon-sick get a lighter sheen
        e.mesh.material.color.setScalar(u.tapped ? 0.48 : u.sick ? 0.82 : 1);
      });
      // traps (face-down)
      pl.traps.forEach((t, i) => {
        seen.add(t.iid);
        let e = this.cards.get(t.iid);
        if (!e) e = this.makeCardEntry(t.iid, t.card, rel);
        this._parkHandHit(e);
        e.zone = 'trap'; e.side = rel;
        const face = rel === 0 ? getCard(t.card).tex : this.backs[1].tex; // you can see your own traps
        if (e.mesh.material.map !== face) { e.mesh.material.map = face; e.mesh.material.needsUpdate = true; }
        this.applyTransform(e, this.trapTransform(rel, i), dur);
      });
    }
    // remove anything not in state
    for (const iid of [...this.cards.keys()]) {
      if (!seen.has(iid)) this.removeEntry(iid);
    }
  }

  liveAtk(state, p, u) {
    // mirror of engine effAtk (kept tiny — display only)
    let a = u.atk;
    if (!u.silenced) {
      if (u.frenzy && u.hp < u.maxHp) a += u.frenzy;
      for (const other of state.players[p].board) {
        if (other === u || other.silenced) continue;
        const aura = cardById(other.card).aura;
        if (aura && aura.atk) {
          const f = aura.filter || {};
          if (!f.tribe || cardById(u.card).tribe === f.tribe) a += aura.atk;
        }
      }
    }
    return Math.max(0, a);
  }

  // ── highlights ────────────────────────────────────────────────
  setGlow(iid, color, on) {
    const e = this.cards.get(iid);
    if (!e) return;
    if (on) {
      e.glow.material.color.set(color);
      e.glow.material.opacity = 0.0001; // pulsed in update()
      e.glowOn = true;
    } else { e.glowOn = false; e.glow.material.opacity = 0; }
  }
  clearGlows() { for (const e of this.cards.values()) { e.glowOn = false; e.glow.material.opacity = 0; } }
  setHeroGlow(p, on, color = 0xd43f3f) {
    const grp = this.heroMeshes[p];
    if (!grp) return;
    grp.children[0].material.color.set(on ? color : 0xd4952b);
    grp.userData.glow = on;
  }

  showGhost(slotIndex, n) {
    if (!this.ghost) {
      this.ghost = new THREE.Mesh(
        new THREE.ShapeGeometry(roundRectShape(CW, CH, 0.1)),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }),
      );
      this.ghost.rotation.x = -Math.PI / 2;
      this.scene.add(this.ghost);
    }
    const t = this.boardTransform(0, slotIndex, n);
    this.ghost.position.set(t.pos.x, 0.03, t.pos.z);
    this.ghost.visible = true;
  }
  hideGhost() { if (this.ghost) this.ghost.visible = false; }

  // ── animations used by match.js ───────────────────────────────
  async animAttack(iid, targetPos) {
    const e = this.cards.get(iid);
    if (!e) return;
    const mini = this.minis.get(iid);
    if (mini && mini.group) {
      // the 3D MODEL lunges — the card never moves (owner: no tap/tip/shake).
      // Suspend the follow-lerp so the tween owns x/z during the lunge.
      mini.lunging = true;
      const start = mini.group.position.clone();
      const dir = targetPos.clone().sub(start); dir.y = 0;
      const hit = start.clone().add(dir.multiplyScalar(0.5));
      await this.tweens.add(mini.group.position, { x: hit.x, z: hit.z }, 0.14, 'sineIn');
      await this.tweens.add(mini.group.position, { x: start.x, z: start.z }, 0.26, 'cubicOut');
      mini.lunging = false;
    } else {
      // commons (no mini): a FLAT forward slide — no y-lift, no shake, so the
      // card never reads as tapping/tipping.
      const start = e.group.position.clone();
      const dir = targetPos.clone().sub(start); dir.y = 0;
      const hit = start.clone().add(dir.multiplyScalar(0.42));
      await this.tweens.add(e.group.position, { x: hit.x, z: hit.z }, 0.14, 'sineIn');
      await this.tweens.add(e.group.position, { x: e.home.pos.x, z: e.home.pos.z }, 0.26, 'cubicOut');
    }
  }

  async animDeath(iid) {
    const e = this.cards.get(iid);
    if (!e) return;
    e.dead = true;
    const def = cardById(e.cardId);
    const col = def.rarity === 'legendary' ? 0xf0b93a : REALMS[def.realm]?.color || 0x8d99ae;
    this.fx.burst(e.group.position, col, { n: def.rarity === 'legendary' ? 60 : 26, speed: 2.6, life: 0.8 });
    if (def.rarity === 'legendary' || def.rarity === 'epic') this.fx.ring(e.group.position, col, { maxR: 2.6 });
    this.tweens.add(e.mesh.material, { opacity: 0 }, 0.42, 'cubicOut');
    this.hideNameplate(e); // HTML orbs/badges vanish with the dying creature
    // sink + fade (NOT a scale-tap): the card settles into the board as it dies
    await this.tweens.add(e.group.position, { y: e.group.position.y - 0.5 }, 0.42, 'cubicOut');
    this.removeEntry(iid);
  }

  async animTrapReveal(iid, cardId, side) {
    // flip the face-down card up big, hold, then fade out
    let e = this.cards.get(iid);
    if (!e) e = this.makeCardEntry(iid, cardId, side);
    e.mesh.material.map = getCard(cardId).tex;
    e.mesh.material.needsUpdate = true;
    this._showcaseActive = (this._showcaseActive || 0) + 1; // orbs hide under the showcase
    try {
      const focus = new THREE.Vector3(0, 2.4, 1.4);
      await this.applyTransform(e, { pos: focus, rotX: this.faceCamRotX(focus.y, focus.z), rotZ: 0, scale: 1.7 }, 0.3, 'backOut');
      this.fx.ring(new THREE.Vector3(0, 0.4, 1.2), 0xe8b93a, { maxR: 3 });
      await new Promise((r) => setTimeout(r, 800 / this.animSpeed));
      this.tweens.add(e.mesh.material, { opacity: 0 }, 0.3);
      await this.tweens.add(e.group.scale, { x: 0.5, y: 0.5, z: 0.5 }, 0.3, 'sineIn');
      this.removeEntry(iid);
    } finally { this._showcaseActive--; }
  }

  async animEnemyReveal(cardId) {
    // enemy plays a card: show it big at center briefly
    const tmp = this.makeCardEntry(-9000 - Math.floor(Math.random() * 100000), cardId, 1);
    tmp.group.position.set(0, 2.2, -2.2);
    tmp.inner.rotation.x = 0.5;
    tmp.group.scale.setScalar(0.1);
    this._showcaseActive = (this._showcaseActive || 0) + 1; // orbs hide under the showcase
    try {
      await this.applyTransform(tmp, { pos: new THREE.Vector3(0, 2.5, 0.4), rotX: this.faceCamRotX(2.5, 0.4), rotZ: 0, scale: 1.55 }, 0.3, 'backOut');
      await new Promise((r) => setTimeout(r, 850 / this.animSpeed));
      this.tweens.add(tmp.mesh.material, { opacity: 0 }, 0.26);
      await this.tweens.add(tmp.group.scale, { x: 0.4, y: 0.4, z: 0.4 }, 0.26, 'sineIn');
      this.removeEntry(tmp.iid);
    } finally { this._showcaseActive--; }
  }

  playFxAt(pos, kind, realmColor) {
    switch (kind) {
      case 'summon': this.fx.ring(pos, realmColor, { maxR: 1.6, dur: 0.4 }); this.fx.burst(pos, realmColor, { n: 14, speed: 1.4, life: 0.5 }); break;
      case 'epic-summon': this.fx.ring(pos, 0xb44fe8, { maxR: 2.8, dur: 0.6 }); this.fx.burst(pos, 0xb44fe8, { n: 46, speed: 3, life: 0.9 }); this.shake(0.22); break;
      case 'legendary-summon': this.fx.ring(pos, 0xf0b93a, { maxR: 3.4, dur: 0.75 }); this.fx.burst(pos, 0xf0b93a, { n: 80, speed: 3.6, life: 1.1 }); this.fx.fountain(pos, 0xffe9a8, { n: 30 }); this.shake(0.34); break;
      case 'damage': this.fx.burst(pos, 0xff5f3d, { n: 18, speed: 2.4, life: 0.5 }); break;
      case 'heal': this.fx.fountain(pos, 0x54d06a, { n: 16 }); break;
      case 'buff': this.fx.fountain(pos, 0xffd45f, { n: 14 }); break;
      case 'debuff': this.fx.burst(pos, 0x8a3fd4, { n: 14, speed: 1.2, up: -0.3, grav: 1.2, life: 0.6 }); break;
      case 'freeze': this.fx.snow(pos, { n: 20 }); break;
      case 'spell': this.fx.burst(pos, 0x7fc4ff, { n: 20, speed: 1.8, life: 0.55 }); break;
      case 'venom': this.fx.burst(pos, 0x7fd44f, { n: 22, speed: 1.6, life: 0.6 }); break;
      case 'pierce': this.fx.beam(pos, LAYOUT.heroEnemy.clone().setY(0.6), 0xd4b03f, { n: 30 }); break;
    }
  }

  // ── 3D legendary minis ─────────────────────────────────────────
  async _gltfLoader() {
    if (!this._gltfLoaderP) {
      this._gltfLoaderP = import('../../vendor/GLTFLoader.js?v=24').then((m) => new m.GLTFLoader());
    }
    return this._gltfLoaderP;
  }

  async spawnMini(iid, spec, side, legendary = false) {
    if (this.minis.has(iid)) return;
    this.minis.set(iid, { pending: true }); // reserve against double-spawn
    try {
      const loader = await this._gltfLoader();
      if (!this._miniBuf.has(spec.file)) {
        this._miniBuf.set(spec.file, fetch('assets/minis/' + spec.file).then((r) => {
          if (!r.ok) throw new Error('mini fetch ' + r.status);
          return r.arrayBuffer();
        }));
      }
      const buf = await this._miniBuf.get(spec.file);
      const gltf = await new Promise((res, rej) => loader.parse(buf.slice(0), '', res, rej));
      const entry = this.cards.get(iid);
      if (!entry || entry.zone !== 'board') { this.minis.delete(iid); return; } // died while loading
      const model = gltf.scene;
      // normalize: feet on the table, height ≈ target — then CLAMP the ground
      // footprint so long/serpentine models can't sprawl across the board
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const h = Math.max(size.y, 0.001);
      model.scale.setScalar((spec.s || 1.35) / h);
      let b2 = new THREE.Box3().setFromObject(model);
      let s2 = b2.getSize(new THREE.Vector3());
      const ext = Math.max(s2.x, s2.z);
      const cap = spec.cap || 1.85; // keep footprints within ~a card width
      if (ext > cap) {
        model.scale.multiplyScalar(cap / ext);
        b2 = new THREE.Box3().setFromObject(model);
      }
      const center = b2.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= b2.min.y;
      // strip lights baked into the GLB (fps rule); tame mirror-metal mats
      // that go black under our dim mood lighting
      const strip = [];
      const glowMats = [];
      model.traverse((o) => {
        if (o.isLight) strip.push(o);
        if (o.isMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mt of mats) {
            if (mt.metalness !== undefined && mt.metalness > 0.45) mt.metalness = 0.45;
            if (mt.roughness !== undefined && mt.roughness < 0.35) mt.roughness = 0.35;
            // per-creature glow: hot texture parts self-illuminate in the card's
            // MINI_MAP glow color (legendaries pulse; epics hold a soft steady glow)
            if (mt.emissive !== undefined && mt.map) {
              mt.emissiveMap = mt.map;
              mt.emissive = new THREE.Color(spec.glow || 0xf0b93a);
              mt.emissiveIntensity = legendary ? 0.38 : 0.24;
              glowMats.push(mt);
            }
          }
        }
      });
      for (const l of strip) l.parent?.remove(l);
      // one shared key light over the mid-board gap so minis read clearly
      if (!this.miniLight) {
        this.miniLight = new THREE.PointLight(0xfff1d8, 110, 16, 2);
        this.miniLight.position.set(0, 5.5, 0);
        this.scene.add(this.miniLight);
      }
      const group = new THREE.Group();
      group.add(model);
      // stand just in front of the card in the mid-board gap (diorama look);
      // the footprint clamp above keeps even long models inside their half
      const offset = new THREE.Vector3(0, 0, side === 0 ? -0.8 : 0.8);
      // BOTH sides face the local player (camera) so you always see the front
      // of every model — mine and the enemy's. In PvP each client sees both
      // sides facing themselves (scene always renders my side at the bottom).
      group.rotation.y = (spec.yaw || 0);
      group.position.copy(entry.group.position).add(offset);
      group.scale.setScalar(0.01);
      this.scene.add(group);
      let mixer = null;
      if (gltf.animations?.length) {
        mixer = new THREE.AnimationMixer(model);
        const idle = gltf.animations.find((a) => /idle|breath|stand/i.test(a.name)) || gltf.animations[0];
        mixer.clipAction(idle).play();
      }
      if (spec.hover) group.position.y = spec.hover;
      // LEGENDARY-ONLY dressing: realm ground glow + personal rim light.
      // Epics get the bare model (owner: "epics have no effects, just the model").
      const fin = b2.getSize(new THREE.Vector3());
      let disc = null;
      if (legendary) {
        disc = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({
            map: miniGlowTex(), color: spec.glow || 0xf0b93a, transparent: true,
            opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        disc.rotation.x = -Math.PI / 2;
        disc.scale.setScalar(Math.max(fin.x, fin.z) * 0.85 + 0.35);
        disc.position.set(group.position.x, 0.025, group.position.z);
        this.scene.add(disc);
        const plight = new THREE.PointLight(spec.glow || 0xffe6b8, 9, 5, 2);
        plight.position.set(0, 1.6, 0.6);
        group.add(plight);
      }
      this.minis.set(iid, { group, mixer, offset, hover: spec.hover || 0, disc, discT: 0,
        // legendaries idle-animate; epics hold still (tier). baseYaw so the
        // sway oscillates around the model's facing instead of drifting.
        idle: legendary && !mixer, baseYaw: group.rotation.y, seed: (iid * 1.7) % 6.28,
        glowMats, legendary });
      this.tweens.add(group.scale, { x: 1, y: 1, z: 1 }, 0.4, 'backOut');
      this.fx.ring(group.position, 0xf0b93a, { maxR: 1.8, dur: 0.5 });
    } catch (err) {
      console.warn('mini spawn failed', spec.file, err.message);
      this.minis.delete(iid);
    }
  }

  despawnMini(iid) {
    const m = this.minis.get(iid);
    this.minis.delete(iid);
    if (!m || !m.group) return;
    this.fx.burst(m.group.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xf0b93a, { n: 30, speed: 2.4, life: 0.8 });
    if (m.disc) {
      this.scene.remove(m.disc);
      m.disc.geometry.dispose();
      m.disc.material.dispose();
    }
    this.tweens.add(m.group.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.35, 'sineIn').then(() => {
      this.scene.remove(m.group);
      m.group.traverse((o) => { o.geometry?.dispose?.(); });
    });
  }

  // cosmetic card backs: [my back file, opponent's back file]
  setCardBacks(myFile, foeFile) {
    this.backs = [getCardBack(myFile || 'cardback.jpg'), getCardBack(foeFile || 'cardback.jpg')];
    this.deckMeshes.forEach((grp, i) => {
      for (const m of grp.children) { m.material.map = this.backs[i].tex; m.material.needsUpdate = true; }
    });
  }

  setHeroPortrait(rel, realm) {
    const grp = this.heroMeshes[rel];
    if (!grp) return;
    const tex = new THREE.TextureLoader().load(`assets/ui/hero_${realm}.jpg`);
    tex.colorSpace = THREE.SRGBColorSpace;
    grp.children[1].material.map = tex;
    grp.children[1].material.needsUpdate = true;
    if (this.use3d !== false) {
      this.setHeroModel(rel, realm); // 3D character (replaces the flat disc)
    } else {
      // flat mode (grunt battles): keep the disc portrait, drop any 3D model
      grp.children[1].visible = true;
      if (this.heroModels && this.heroModels[rel]) {
        this.scene.remove(this.heroModels[rel].grp);
        this.heroModels[rel].grp.traverse((o) => o.geometry?.dispose?.());
        this.heroModels[rel] = null;
      }
    }
  }

  // load a standing 3D hero character (Meshy, from the portrait art) behind
  // each side, facing the camera. Falls back to the disc if the GLB is missing.
  async setHeroModel(rel, realm) {
    try {
      const loader = await this._gltfLoader();
      const key = 'hero_' + realm;
      if (!this._miniBuf.has(key)) {
        this._miniBuf.set(key, fetch('assets/heroes/hero_' + realm + '.glb').then((r) => {
          if (!r.ok) throw new Error('hero ' + r.status);
          return r.arrayBuffer();
        }));
      }
      const buf = await this._miniBuf.get(key);
      const gltf = await new Promise((res, rej) => loader.parse(buf.slice(0), '', res, rej));
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      // full-body standing figure — modest height so it reads as a character
      // beside the board, not a giant; enemy a touch taller vs perspective
      const H = rel === 0 ? 2.5 : 2.9;
      model.scale.setScalar(H / Math.max(size.y, 0.001));
      let b2 = new THREE.Box3().setFromObject(model);
      const s2 = b2.getSize(new THREE.Vector3());
      const ext = Math.max(s2.x, s2.z);
      if (ext > 3.0) { model.scale.multiplyScalar(3.0 / ext); b2 = new THREE.Box3().setFromObject(model); }
      const c = b2.getCenter(new THREE.Vector3());
      model.position.x -= c.x; model.position.z -= c.z; model.position.y -= b2.min.y;
      const glowMats = [];
      model.traverse((o) => {
        if (o.isLight) o.parent?.remove(o);
        if (o.isMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mt of mats) {
            if (mt.metalness > 0.45) mt.metalness = 0.45;
            if (mt.roughness < 0.35) mt.roughness = 0.35;
            // realm glow: bright texture parts self-illuminate in the realm tint
            if (mt.emissive !== undefined && mt.map) {
              mt.emissiveMap = mt.map;
              mt.emissive = new THREE.Color(REALM_EMISSIVE[realm] || REALM_EMISSIVE.neutral);
              mt.emissiveIntensity = 0.3;
              glowMats.push(mt);
            }
          }
          o.userData = { kind: 'hero', p: rel };
        }
      });
      const grp = new THREE.Group(); grp.add(model);
      const pos = rel === 0 ? LAYOUT.heroPlayer : LAYOUT.heroEnemy;
      // stand at the flank anchor (LAYOUT y lifts the figure onto the board so
      // the whole body clears the near rim / hand row)
      grp.position.set(pos.x, pos.y, pos.z);
      this.scene.add(grp);
      // dedicated hero lighting — the board is dark and several heroes wear
      // dark armor (ember/grave), so a strong key + camera-side fill keeps the
      // full-body characters clearly readable instead of melting into the board
      if (!this.heroLight) {
        this.heroLight = new THREE.PointLight(0xfff1d8, 130, 30, 2);
        this.heroLight.position.set(0, 8, 2);
        this.scene.add(this.heroLight);
        this.heroFill = new THREE.DirectionalLight(0xdfe6ff, 1.5);
        this.heroFill.position.set(0, 6, 12); // from the camera side
        this.scene.add(this.heroFill);
      }
      // hide the flat disc face; keep the ring as a targeting/glow base
      const disc = this.heroMeshes[rel];
      if (disc && disc.children[1]) disc.children[1].visible = false;
      this.heroModels = this.heroModels || [null, null];
      if (this.heroModels[rel]) { // clean up a previous match's hero
        this.scene.remove(this.heroModels[rel].grp);
        this.heroModels[rel].grp.traverse((o) => o.geometry?.dispose?.());
      }
      // centred heroes face straight at the camera
      const baseYaw = 0;
      grp.rotation.y = baseYaw;
      this.heroModels[rel] = {
        grp, rel, seed: rel * 3.14, baseY: grp.position.y, baseZ: grp.position.z, baseYaw,
        recoilDir: rel === 0 ? 1 : -1, // player staggers toward the camera, enemy toward the back
        flinchT: 0, flinchDur: 0.44, flashMats: null, glowMats,
      };
    } catch (e) { /* GLB missing → keep the disc portrait */ }
  }

  // hit reaction: recoil + red flash when this hero takes damage
  heroFlinch(rel) {
    const hm = this.heroModels && this.heroModels[rel];
    if (!hm) return;
    hm.flinchT = hm.flinchDur;
    if (!hm.flashMats) { // cache emissive materials + their base colour once
      hm.flashMats = [];
      hm.grp.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mt of mats) if (mt && mt.emissive) { mt.userData._be = mt.emissive.getHex(); hm.flashMats.push(mt); }
      });
    }
    this.shake(0.16);
  }

  posOf(iid) {
    const e = this.cards.get(iid);
    return e ? e.group.position.clone() : null;
  }
  heroPos(rel) { return (rel === 0 ? LAYOUT.heroPlayer : LAYOUT.heroEnemy).clone(); }

  shake(amp = 0.2) {
    if (this.reduceShake) return;
    this.camShakeAmp = Math.max(this.camShakeAmp, amp);
    this.camShakeT = 0.32;
  }

  worldToScreen(v) {
    const p = v.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * r.width + r.left, y: (-p.y * 0.5 + 0.5) * r.height + r.top };
  }

  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(m, this.camera);
    const targets = [];
    for (const e of this.cards.values()) {
      if (e.dead) continue;
      targets.push(e.mesh);
      // static hand proxies — stable hover/click zones that never move on hover
      if (e.hit && e.hit.visible && e.zone === 'hand') targets.push(e.hit);
    }
    for (const h of this.heroMeshes) targets.push(...h.children);
    // 3D hero characters are clickable as their hero too
    if (this.heroModels) for (const hm of this.heroModels) if (hm) hm.grp.traverse((o) => { if (o.isMesh) targets.push(o); });
    targets.push(this.table);
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud.kind === 'card') {
        const e = this.cards.get(ud.iid);
        if (e) return { kind: e.zone, iid: ud.iid, side: e.side, entry: e, point: h.point };
      }
      if (ud.kind === 'handhit') {
        const e = this.cards.get(ud.iid);
        if (e && e.zone === 'hand') return { kind: 'hand', iid: ud.iid, side: e.side, entry: e, point: h.point };
      }
      if (ud.kind === 'hero') return { kind: 'hero', p: ud.p, point: h.point };
      if (ud.kind === 'table') return { kind: 'table', point: h.point };
    }
    return null;
  }

  update(dt, dtWall = dt) {
    this.time += dt;
    // tweens advance on WALL time (capped) so they finish promptly even after
    // background-tab throttling starves rAF
    this.tweens.update(Math.min(dtWall, 0.4) * this.animSpeed);
    this.fx.update(dt);
    // glow pulse (no idle motion — cards hold perfectly still unless hovered).
    // Thin frame reads crisp, so it can sit brighter than the old fuzzy fill.
    const pulse = 0.62 + Math.sin(this.time * 4) * 0.2;
    for (const e of this.cards.values()) {
      if (e.glowOn) e.glow.material.opacity = pulse;
      if (e.zone === 'board') {
        // keep legendary aura + the scene-space nameplate tracking the card
        this.fx.moveEmitter('aura' + e.iid, e.group.position);
        if (!e.dead) this.placeNameplate(e);
      } else if (e.chips) {
        this.hideNameplate(e); // off-board (bounced to hand etc.)
      }
    }
    // minis follow their card (lunges carry them) + idle animation
    for (const [iid, m] of this.minis) {
      if (!m.group) continue;
      if (m.mixer) m.mixer.update(dt);
      const e = this.cards.get(iid);
      if (e && !m.lunging) {
        const tx = e.group.position.x + m.offset.x;
        const tz = e.group.position.z + m.offset.z;
        m.group.position.x += (tx - m.group.position.x) * Math.min(1, dt * 10);
        m.group.position.z += (tz - m.group.position.z) * Math.min(1, dt * 10);
        if (m.hover) m.group.position.y = m.hover + Math.sin(this.time * 1.6 + iid) * 0.08;
        // legendary idle: gentle breathing bob + slow yaw sway (epics: none)
        if (m.idle) {
          m.group.position.y = (m.hover || 0) + 0.02 + (Math.sin(this.time * 1.7 + m.seed) + 1) * 0.035;
          m.group.rotation.y = m.baseYaw + Math.sin(this.time * 0.9 + m.seed) * 0.11;
        }
        // legendary glow breathes; epics hold their steady sheen
        if (m.legendary && m.glowMats) {
          const gi = 0.38 + (Math.sin(this.time * 2.2 + m.seed) + 1) * 0.09;
          for (const mt of m.glowMats) mt.emissiveIntensity = gi;
        }
        if (m.disc) {
          m.discT = Math.min(1, m.discT + dt * 3);
          m.disc.position.x = m.group.position.x;
          m.disc.position.z = m.group.position.z;
          m.disc.material.opacity = m.discT * (0.52 + Math.sin(this.time * 2 + iid) * 0.12);
        }
      }
    }
    // hero characters: gentle idle sway around their facing; feet stay planted.
    // when hit, they recoil (stagger back + pitch + shudder) and flash red.
    if (this.heroModels) for (const hm of this.heroModels) if (hm) {
      let recoil = 0, pitch = 0, shud = 0, flash = 0;
      if (hm.flinchT > 0) {
        hm.flinchT = Math.max(0, hm.flinchT - dt);
        const env = Math.sin((1 - hm.flinchT / hm.flinchDur) * Math.PI); // 0→1→0
        recoil = env * 0.3 * hm.recoilDir;              // stagger toward own side
        pitch = env * 0.16;                             // flinch backward
        shud = Math.sin(this.time * 55) * env * 0.06;   // fast shudder
        flash = env;
      }
      hm.grp.rotation.y = (hm.baseYaw || 0) + Math.sin(this.time * 0.6 + hm.seed) * 0.05 + shud;
      hm.grp.rotation.x = pitch;
      hm.grp.position.z = (hm.baseZ ?? hm.grp.position.z) + recoil;
      hm.grp.position.y = (hm.baseY || 0.02) + (Math.sin(this.time * 1.1 + hm.seed) + 1) * 0.008;
      if (hm.flashMats) for (const mt of hm.flashMats) mt.emissive.setHex(mt.userData._be || 0).lerp(HIT_RED, flash * 0.85);
      // realm glow breathes softly (intensity only — the flash above owns color)
      if (hm.glowMats) {
        const gi = 0.3 + (Math.sin(this.time * 1.8 + hm.seed) + 1) * 0.06;
        for (const mt of hm.glowMats) mt.emissiveIntensity = gi + flash * 0.5;
      }
    }
    // diorama: crystals spin, braziers flicker embers, rune inlays breathe
    for (const c of this.dioramaSpin) { c.rotation.y += dt * 0.5; c.position.y = 1.5 + Math.sin(this.time * 1.2 + c.position.x) * 0.1; }
    if (this.runeStrips) {
      const ro = 0.22 + (Math.sin(this.time * 1.4) + 1) * 0.07;
      for (const s of this.runeStrips) s.material.opacity = ro;
    }
    this._brazierAcc = (this._brazierAcc || 0) + dt;
    if (this._brazierAcc > 0.09) {
      this._brazierAcc = 0;
      for (const p of this.brazierPts) {
        this.fx.spawn(
          new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.25, p.y, p.z + (Math.random() - 0.5) * 0.25),
          new THREE.Vector3((Math.random() - 0.5) * 0.2, 1.1 + Math.random() * 0.7, (Math.random() - 0.5) * 0.2),
          Math.random() < 0.7 ? 0xff8a3d : 0xffd45f, 0.34, 0.7, 0, 0.985);
      }
    }
    // hero ring pulse when targeted
    for (const h of this.heroMeshes) {
      if (h.userData.glow) h.children[0].material.opacity = 0.55 + Math.sin(this.time * 6) * 0.35;
      else h.children[0].material.opacity = 0.9;
    }
    // camera: zoom (dolly toward pivot) + shake + user pitch, then re-aim at pivot
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 9);
    const rest = this.camBase.clone().lerp(this.camZoomPos, this.zoom);
    if (this.camShakeT > 0) {
      this.camShakeT -= dt;
      const a = this.camShakeAmp * Math.max(0, this.camShakeT / 0.32);
      rest.x += (Math.random() - 0.5) * a;
      rest.y += (Math.random() - 0.5) * a * 0.6;
      rest.z += (Math.random() - 0.5) * a;
    }
    // user pitch: orbit the rest position around the board pivot on the Y-Z plane
    // (drag up → higher/top-down, drag down → lower/side-on). Smoothed toward target.
    this.pitch += (this.pitchTarget - this.pitch) * Math.min(1, dt * 10);
    if (Math.abs(this.pitch) > 1e-4) {
      const oy = rest.y - this.camPivot.y, oz = rest.z - this.camPivot.z;
      const c = Math.cos(this.pitch), s = Math.sin(this.pitch);
      rest.y = this.camPivot.y + oy * c - oz * s;
      rest.z = this.camPivot.z + oy * s + oz * c;
    }
    this.camera.position.copy(rest);
    this.camera.lookAt(this.camPivot);
    // billboard upkeep: whenever the camera actually moves (pitch drag, zoom
    // dolly), re-face the hand cards so they stay screen-flat
    if (!this._lastCamPos) this._lastCamPos = rest.clone();
    if (this._lastCamPos.distanceToSquared(rest) > 0.0012) {
      this._lastCamPos.copy(rest);
      this._retiltCards();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
