// Arcane Realms TCG — Three.js board scene: card meshes, layout, tweens,
// highlights, picking. Pure presentation — match.js drives it from engine events.

import * as THREE from 'three';
import { getCard, getBoardCard, getCardBack, CARD_W, CARD_H } from './cardtex.js?v=3';
import { REALMS, cardById } from '../sim/cards.js?v=3';
import { FX } from './fx.js?v=3';

const CW = 1.3, CH = CW * (CARD_H / CARD_W); // card world size
export const LAYOUT = {
  playerBoardZ: 1.22, enemyBoardZ: -1.5, slotDX: 1.62,
  handZ: 4.52, handY: 1.16, enemyHandZ: -3.98,
  deckX: 7.5, playerDeckZ: 3.1, enemyDeckZ: -3.1,
  trapX: -7.35, playerTrapZ: 2.35, enemyTrapZ: -2.35,
  heroPlayer: new THREE.Vector3(0, 0.02, 3.28),
  heroEnemy: new THREE.Vector3(0, 0.02, -3.34),
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

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b0714');
    this.scene.fog = new THREE.Fog('#0b0714', 18, 30);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    this.camera.position.set(0, 10.6, 9.15);
    this.camera.lookAt(0, 0, 0.62);
    this.camShakeT = 0; this.camShakeAmp = 0;
    this.camBase = this.camera.position.clone();

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
    this.camera.fov = w / h < 1.45 ? 50 : 42;
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
    // under-glow (hover/selectable/target highlight)
    const glowGeo = new THREE.ShapeGeometry(roundRectShape(CW * 1.14, CH * 1.11, 0.12));
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
      color: 0x3fae52, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
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
    const entry = {
      iid, cardId, side, group, inner, mesh, glow, ice,
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
    this.scene.remove(e.group);
    this.cards.delete(iid);
  }

  ensureChips(e, atk, hp, maxHp, baseAtk, baseHp) {
    if (!e.chips) {
      const mk = () => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.42, 0.42),
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
        );
        m.renderOrder = 30;
        e.inner.add(m);
        return m;
      };
      e.chips = { atk: mk(), hp: mk() };
      e.chips.atk.scale.setScalar(1.28);
      e.chips.hp.scale.setScalar(1.28);
      e.chips.atk.position.set(-CW / 2 + 0.2, -CH / 2 + 0.2, 0.02);
      e.chips.hp.position.set(CW / 2 - 0.2, -CH / 2 + 0.2, 0.02);
    }
    const atkStyle = atk > baseAtk ? 'atkBuff' : 'atk';
    const hpStyle = hp < maxHp ? 'hpHurt' : (maxHp > baseHp ? 'hpBuff' : 'hp');
    e.chips.atk.material.map = chipTexture(atk, atkStyle);
    e.chips.hp.material.map = chipTexture(hp, hpStyle);
    e.chips.atk.material.needsUpdate = true;
    e.chips.hp.material.needsUpdate = true;
  }

  setBadges(e, unit) {
    for (const b of e.badges) e.inner.remove(b);
    e.badges = [];
    if (!unit) return;
    const kws = unit.silenced ? [] : unit.kw;
    const shown = kws.slice(0, 4);
    if (unit.silenced) shown.push('_silenced');
    shown.forEach((k, i) => {
      const [glyph, color] = k === '_silenced' ? ['✕', '#8d8d9e'] : (KW_BADGE[k] || ['•', '#ccc']);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.3),
        new THREE.MeshBasicMaterial({ map: badgeTexture(glyph, color), transparent: true, depthWrite: false }),
      );
      m.renderOrder = 30;
      m.position.set(-CW / 2 + 0.2 + i * 0.34, CH / 2 - 0.17, 0.02);
      e.inner.add(m);
      e.badges.push(m);
    });
  }

  // ── layout ────────────────────────────────────────────────────
  handTransform(side, i, n, hovered) {
    const spread = Math.min(1.18, 7.4 / Math.max(n, 1));
    const x = (i - (n - 1) / 2) * spread;
    if (side === 0) {
      const arc = Math.abs(i - (n - 1) / 2) / Math.max(1, (n - 1) / 2 || 1);
      // hovered: rise well above the fan, fully readable, in front of everything
      const y = LAYOUT.handY + 0.3 - arc * 0.12 + (hovered ? 1.15 : 0);
      const z = LAYOUT.handZ - (hovered ? 0.55 : 0) + arc * 0.05;
      return {
        pos: new THREE.Vector3(x, y, z),
        rotX: -0.56 + (hovered ? 0.1 : 0),
        rotZ: hovered ? 0 : -(i - (n - 1) / 2) * 0.045,
        scale: hovered ? 1.62 : 0.94,
      };
    }
    return {
      pos: new THREE.Vector3(x * 0.76, LAYOUT.handY + 0.2, LAYOUT.enemyHandZ),
      rotX: 0.5, rotZ: (i - (n - 1) / 2) * 0.05, scale: 0.8,
    };
  }

  // board hover: enlarge the REAL card in place and swap to the full-detail
  // texture so rules text is readable — no duplicate preview card
  setBoardHover(iid, on) {
    const e = this.cards.get(iid);
    if (!e || e.zone !== 'board') return;
    if (on === !!e.boardHover) return;
    e.boardHover = on;
    this.setHoverFront(iid, on);
    const face = on ? getCard(e.cardId).tex : getBoardCard(e.cardId).tex;
    if (e.mesh.material.map !== face) { e.mesh.material.map = face; e.mesh.material.needsUpdate = true; }
    if (e.chips) { e.chips.atk.visible = !on; e.chips.hp.visible = !on; }
    for (const b of e.badges) b.visible = !on;
    const base = this.boardTransform(e.side, e.slot, (e.side === 0 ? this._lastMyBoardN : this._lastFoeBoardN) || 6);
    if (on) {
      this.applyTransform(e, {
        pos: base.pos.clone().add(new THREE.Vector3(0, 1.5, e.side === 0 ? 0.4 : 0.85)),
        rotX: -0.62, rotZ: 0, scale: 1.72,
      }, 0.16);
    } else {
      this.applyTransform(e, base, 0.16);
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

  boardTransform(side, i, n) {
    const x = (i - (n - 1) / 2) * LAYOUT.slotDX;
    const z = side === 0 ? LAYOUT.playerBoardZ : LAYOUT.enemyBoardZ;
    // perfectly flat on the table — tilt made tapped cards' edges sink through it
    return { pos: new THREE.Vector3(x, 0.06, z), rotX: -Math.PI / 2, rotZ: 0, scale: 1 };
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
        // enemy hand shows card BACKS
        const face = rel === 0 ? getCard(h.card).tex : this.backs[1].tex;
        if (e.mesh.material.map !== face) { e.mesh.material.map = face; e.mesh.material.needsUpdate = true; }
        this.applyTransform(e, this.handTransform(rel, i, pl.hand.length, e.hover && rel === 0), dur);
        if (e.chips) { e.inner.remove(e.chips.atk, e.chips.hp); e.chips = null; }
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
        const face = getBoardCard(u.card).tex;
        if (e.mesh.material.map !== face) { e.mesh.material.map = face; e.mesh.material.needsUpdate = true; }
        if (e.chips) { e.chips.atk.visible = true; e.chips.hp.visible = true; }
        this.applyTransform(e, this.boardTransform(rel, i, pl.board.length), dur);
        const def = cardById(u.card);
        this.ensureChips(e, /* live */ this.liveAtk(state, p, u), u.hp, u.maxHp, def.atk ?? 0, def.hp ?? 0);
        this.setBadges(e, u);
        // tap spin (kill any in-flight spin tween first — double-tweens fight)
        const spin = (u.tapped ? 1 : 0) * (rel === 0 ? -1 : 1) * (Math.PI / 2);
        if (instant) {
          this.tweens.killOf(e.group.rotation);
          e.group.rotation.y = spin;
        } else if (Math.abs(e.group.rotation.y - spin) > 0.01) {
          this.tweens.killOf(e.group.rotation);
          this.tweens.add(e.group.rotation, { y: spin }, 0.32, 'cubicInOut');
        }
        e.ice.material.opacity = u.frozen ? 0.4 : 0;
        // legendary idle aura
        if (def.rarity === 'legendary') {
          this.fx.setEmitter('aura' + u.iid, e.group.position, 0xf0b93a, 5);
        }
        // summon-sick sheen
        e.mesh.material.color.setScalar(u.sick && !u.tapped ? 0.82 : 1);
      });
      // traps (face-down)
      pl.traps.forEach((t, i) => {
        seen.add(t.iid);
        let e = this.cards.get(t.iid);
        if (!e) e = this.makeCardEntry(t.iid, t.card, rel);
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
    const start = e.group.position.clone();
    const dir = targetPos.clone().sub(start);
    const hit = start.clone().add(dir.multiplyScalar(0.72));
    await this.tweens.add(e.group.position, { x: hit.x, y: 0.7, z: hit.z }, 0.16, 'sineIn');
    this.shake(0.16);
    await this.tweens.add(e.group.position, { x: e.home.pos.x, y: e.home.pos.y, z: e.home.pos.z }, 0.3, 'cubicOut');
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
    if (e.chips) { this.tweens.add(e.chips.atk.material, { opacity: 0 }, 0.3); this.tweens.add(e.chips.hp.material, { opacity: 0 }, 0.3); }
    for (const b of e.badges) this.tweens.add(b.material, { opacity: 0 }, 0.3);
    await this.tweens.add(e.group.scale, { x: 0.6, y: 0.6, z: 0.6 }, 0.42, 'cubicOut');
    this.removeEntry(iid);
  }

  async animTrapReveal(iid, cardId, side) {
    // flip the face-down card up big, hold, then fade out
    let e = this.cards.get(iid);
    if (!e) e = this.makeCardEntry(iid, cardId, side);
    e.mesh.material.map = getCard(cardId).tex;
    e.mesh.material.needsUpdate = true;
    const focus = new THREE.Vector3(0, 2.4, 1.4);
    await this.applyTransform(e, { pos: focus, rotX: -0.5, rotZ: 0, scale: 1.7 }, 0.3, 'backOut');
    this.fx.ring(new THREE.Vector3(0, 0.4, 1.2), 0xe8b93a, { maxR: 3 });
    await new Promise((r) => setTimeout(r, 800 / this.animSpeed));
    this.tweens.add(e.mesh.material, { opacity: 0 }, 0.3);
    await this.tweens.add(e.group.scale, { x: 0.5, y: 0.5, z: 0.5 }, 0.3, 'sineIn');
    this.removeEntry(iid);
  }

  async animEnemyReveal(cardId) {
    // enemy plays a card: show it big at center briefly
    const tmp = this.makeCardEntry(-9000 - Math.floor(Math.random() * 100000), cardId, 1);
    tmp.group.position.set(0, 2.2, -2.2);
    tmp.inner.rotation.x = 0.5;
    tmp.group.scale.setScalar(0.1);
    await this.applyTransform(tmp, { pos: new THREE.Vector3(0, 2.5, 0.4), rotX: -0.5, rotZ: 0, scale: 1.55 }, 0.3, 'backOut');
    await new Promise((r) => setTimeout(r, 850 / this.animSpeed));
    this.tweens.add(tmp.mesh.material, { opacity: 0 }, 0.26);
    await this.tweens.add(tmp.group.scale, { x: 0.4, y: 0.4, z: 0.4 }, 0.26, 'sineIn');
    this.removeEntry(tmp.iid);
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
    for (const e of this.cards.values()) if (!e.dead) targets.push(e.mesh);
    for (const h of this.heroMeshes) targets.push(...h.children);
    targets.push(this.table);
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud.kind === 'card') {
        const e = this.cards.get(ud.iid);
        if (e) return { kind: e.zone, iid: ud.iid, side: e.side, entry: e, point: h.point };
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
    // glow pulse (no idle motion — cards hold perfectly still unless hovered)
    const pulse = 0.32 + Math.sin(this.time * 5) * 0.14;
    for (const e of this.cards.values()) {
      if (e.glowOn) e.glow.material.opacity = pulse;
      // keep legendary aura tracking
      if (e.zone === 'board') this.fx.moveEmitter('aura' + e.iid, e.group.position);
    }
    // hero ring pulse when targeted
    for (const h of this.heroMeshes) {
      if (h.userData.glow) h.children[0].material.opacity = 0.55 + Math.sin(this.time * 6) * 0.35;
      else h.children[0].material.opacity = 0.9;
    }
    // camera shake
    if (this.camShakeT > 0) {
      this.camShakeT -= dt;
      const a = this.camShakeAmp * Math.max(0, this.camShakeT / 0.32);
      this.camera.position.set(
        this.camBase.x + (Math.random() - 0.5) * a,
        this.camBase.y + (Math.random() - 0.5) * a * 0.6,
        this.camBase.z + (Math.random() - 0.5) * a,
      );
      if (this.camShakeT <= 0) this.camera.position.copy(this.camBase);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
