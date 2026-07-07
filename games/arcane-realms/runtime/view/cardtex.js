// Arcane Realms TCG — card texture compositor.
// Composites generated artwork + procedural realm/rarity frames + text into
// crisp 512×768 canvases, cached per card. Used as THREE textures on the
// board and as plain canvases in the DOM (deck builder / collection / inspect).

import * as THREE from 'three';
import { CARDS, REALMS, cardById } from '../sim/cards.js?v=9';

export const CARD_W = 512, CARD_H = 768;

const RARITY_COLOR = {
  common: '#b8c0cc', uncommon: '#4fc06a', rare: '#3f8fe8',
  epic: '#b44fe8', legendary: '#f0b93a', token: '#8d99ae',
};
const RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', token: 'Token' };

const artCache = new Map();   // id -> {img, loaded, callbacks}
const cardCache = new Map();  // id -> {canvas, tex, drawn}
let backCache = null;

function loadArt(id, onload) {
  let a = artCache.get(id);
  if (!a) {
    a = { img: new Image(), loaded: false, cbs: [] };
    a.img.onload = () => { a.loaded = true; for (const cb of a.cbs) cb(); a.cbs = []; };
    a.img.onerror = () => { a.error = true; a.cbs = []; };
    a.img.src = `assets/art/${id}.jpg`;
    artCache.set(id, a);
  }
  if (a.loaded) onload();
  else if (!a.error) a.cbs.push(onload);
  return a;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fitText(g, text, maxW, basePx, font) {
  let px = basePx;
  do {
    g.font = `${font.replace('{px}', px)}`;
    if (g.measureText(text).width <= maxW) break;
    px -= 1;
  } while (px > 12);
  return px;
}

function wrapText(g, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function drawGem(g, x, y, r, color, value, opts = {}) {
  // radial jewel with number
  const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, shade(color, -0.55));
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = grad; g.fill();
  g.lineWidth = 4; g.strokeStyle = shade(color, -0.7); g.stroke();
  g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.55)';
  g.beginPath(); g.arc(x, y, r - 4, Math.PI * 1.05, Math.PI * 1.7); g.stroke();
  if (value != null) {
    g.font = `800 ${Math.round(r * 1.15)}px Georgia, serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#0d0a14';
    g.fillText(String(value), x + 2, y + r * 0.1 + 2);
    g.fillStyle = opts.hot ? '#ffe9a8' : '#ffffff';
    g.fillText(String(value), x, y + r * 0.1);
  }
  g.restore();
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt >= 0) c.lerp(new THREE.Color('#ffffff'), amt);
  else c.lerp(new THREE.Color('#000000'), -amt);
  return '#' + c.getHexString();
}

function drawFrame(g, card) {
  const realm = REALMS[card.realm] || REALMS.neutral;
  const rc = RARITY_COLOR[card.rarity] || RARITY_COLOR.common;
  const legendary = card.rarity === 'legendary';
  const epic = card.rarity === 'epic';

  // base card body — realm-tinted dark gradient
  const bg = g.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, shade(realm.css, -0.62));
  bg.addColorStop(0.5, '#171224');
  bg.addColorStop(1, shade(realm.css, -0.72));
  roundRect(g, 6, 6, CARD_W - 12, CARD_H - 12, 30);
  g.fillStyle = bg; g.fill();

  // outer border(s)
  roundRect(g, 6, 6, CARD_W - 12, CARD_H - 12, 30);
  g.lineWidth = legendary ? 10 : 8;
  const borderGrad = g.createLinearGradient(0, 0, CARD_W, CARD_H);
  if (legendary) {
    borderGrad.addColorStop(0, '#f5d97a'); borderGrad.addColorStop(0.5, '#b8860b'); borderGrad.addColorStop(1, '#f5d97a');
  } else if (epic) {
    borderGrad.addColorStop(0, '#d78bff'); borderGrad.addColorStop(0.5, '#7a2ea8'); borderGrad.addColorStop(1, '#d78bff');
  } else {
    borderGrad.addColorStop(0, shade(rc, 0.1)); borderGrad.addColorStop(1, shade(rc, -0.4));
  }
  g.strokeStyle = borderGrad; g.stroke();
  // inner hairline in realm color
  roundRect(g, 14, 14, CARD_W - 28, CARD_H - 28, 24);
  g.lineWidth = 2.5;
  g.strokeStyle = shade(realm.css, 0.15);
  g.stroke();

  if (legendary) {
    // corner ornaments — filigree curls
    g.save();
    g.strokeStyle = '#f0cf6a'; g.lineWidth = 3.5; g.lineCap = 'round';
    const curl = (cx, cy, sx, sy) => {
      g.beginPath();
      g.moveTo(cx + 38 * sx, cy);
      g.quadraticCurveTo(cx, cy, cx, cy + 38 * sy);
      g.moveTo(cx + 26 * sx, cy + 6 * sy);
      g.quadraticCurveTo(cx + 6 * sx, cy + 8 * sy, cx + 8 * sx, cy + 26 * sy);
      g.stroke();
      g.beginPath(); g.arc(cx + 12 * sx, cy + 12 * sy, 3.4, 0, Math.PI * 2);
      g.fillStyle = '#ffe9a8'; g.fill();
    };
    curl(22, 22, 1, 1); curl(CARD_W - 22, 22, -1, 1);
    curl(22, CARD_H - 22, 1, -1); curl(CARD_W - 22, CARD_H - 22, -1, -1);
    g.restore();
  } else if (epic) {
    // rune diamonds along the sides
    g.save();
    g.fillStyle = '#c76bff';
    for (const y of [190, 384, 578]) {
      for (const x of [14, CARD_W - 14]) {
        g.beginPath();
        g.moveTo(x, y - 9); g.lineTo(x + 7, y); g.lineTo(x, y + 9); g.lineTo(x - 7, y);
        g.closePath(); g.fill();
      }
    }
    g.restore();
  }
}

export function drawCard(canvas, cardId, { forceArt = null } = {}) {
  const card = cardById(cardId);
  const realm = REALMS[card.realm] || REALMS.neutral;
  const rc = RARITY_COLOR[card.rarity] || RARITY_COLOR.common;
  canvas.width = CARD_W; canvas.height = CARD_H;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, CARD_W, CARD_H);

  drawFrame(g, card);

  // ── art window ──
  const ax = 34, ay = 76, aw = CARD_W - 68, ah = 318;
  g.save();
  roundRect(g, ax, ay, aw, ah, 14);
  g.clip();
  const art = artCache.get(cardId);
  const img = forceArt || (art && art.loaded ? art.img : null);
  if (img) {
    // cover-crop
    const s = Math.max(aw / img.width, ah / img.height);
    const dw = img.width * s, dh = img.height * s;
    g.drawImage(img, ax + (aw - dw) / 2, ay + (ah - dh) / 2 - dh * 0.04, dw, dh);
  } else {
    const ph = g.createLinearGradient(0, ay, 0, ay + ah);
    ph.addColorStop(0, shade(realm.css, -0.3));
    ph.addColorStop(1, shade(realm.css, -0.65));
    g.fillStyle = ph; g.fillRect(ax, ay, aw, ah);
    g.font = '700 90px Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fillText('✦', CARD_W / 2, ay + ah / 2);
  }
  // art inner shadow
  const vg = g.createLinearGradient(0, ay, 0, ay + ah);
  vg.addColorStop(0, 'rgba(0,0,0,.32)'); vg.addColorStop(0.15, 'rgba(0,0,0,0)');
  vg.addColorStop(0.85, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.4)');
  g.fillStyle = vg; g.fillRect(ax, ay, aw, ah);
  g.restore();
  roundRect(g, ax, ay, aw, ah, 14);
  g.lineWidth = 3; g.strokeStyle = shade(realm.css, -0.15); g.stroke();

  // ── name banner ──
  const ny = ay + ah + 4;
  const nbGrad = g.createLinearGradient(0, ny, 0, ny + 52);
  nbGrad.addColorStop(0, shade(realm.css, -0.25));
  nbGrad.addColorStop(1, shade(realm.css, -0.6));
  roundRect(g, 28, ny, CARD_W - 56, 52, 12);
  g.fillStyle = nbGrad; g.fill();
  g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.25)'; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const namePx = fitText(g, card.name, CARD_W - 90, 33, '800 {px}px Georgia, serif');
  g.font = `800 ${namePx}px Georgia, serif`;
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillText(card.name, CARD_W / 2 + 1.5, ny + 27.5);
  g.fillStyle = card.rarity === 'legendary' ? '#ffe9a8' : '#f4eeff';
  g.fillText(card.name, CARD_W / 2, ny + 26);

  // ── type line ──
  const typeBits = [];
  if (card.type === 'creature') typeBits.push(card.tribe || 'Creature');
  else typeBits.push(card.type === 'trap' ? 'Trap' : 'Spell');
  typeBits.push(realm.name);
  typeBits.push(RARITY_LABEL[card.rarity]);
  g.font = '600 20px Georgia, serif';
  g.fillStyle = shade(rc, 0.25);
  g.fillText(typeBits.join('  ·  '), CARD_W / 2, ny + 72);

  // ── rules text panel ──
  const tx = 40, ty = ny + 92, tw = CARD_W - 80, th = CARD_H - ty - 78;
  roundRect(g, tx, ty, tw, th, 12);
  g.fillStyle = 'rgba(8,6,14,.62)';
  g.fill();
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.12)'; g.stroke();

  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const rules = card.text || '';
  g.font = '600 23px Georgia, serif';
  let lines = wrapText(g, rules, tw - 28);
  if (lines.length > 4) { g.font = '600 20px Georgia, serif'; lines = wrapText(g, rules, tw - 28); }
  const lh = lines.length > 4 ? 24 : 28;
  let yy = ty + 34;
  g.fillStyle = '#efe9fb';
  for (const ln of lines.slice(0, 5)) { g.fillText(ln, CARD_W / 2, yy); yy += lh; }
  // flavor
  if (card.flavor && yy < ty + th - 26) {
    g.font = 'italic 500 19px Georgia, serif';
    g.fillStyle = 'rgba(200,190,225,.72)';
    const fl = wrapText(g, card.flavor, tw - 36);
    yy += 8;
    for (const ln of fl.slice(0, Math.max(0, Math.floor((ty + th - 12 - yy) / 23)))) {
      g.fillText(ln, CARD_W / 2, yy); yy += 23;
    }
  }

  // ── cost gem ──
  drawGem(g, 60, 60, 42, realm.css, card.cost, { hot: true });
  g.font = '700 15px Georgia, serif';
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.textAlign = 'center';

  // ── stat gems (creatures) ──
  if (card.type === 'creature') {
    drawGem(g, 62, CARD_H - 60, 40, '#c8392e', card.atk);            // attack
    drawGem(g, CARD_W - 62, CARD_H - 60, 40, '#2e8f3f', card.hp);    // health
    // tiny sword / heart glyphs above gems
    g.font = '700 20px Georgia, serif';
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.fillText('⚔', 62, CARD_H - 104);
    g.fillText('❤', CARD_W - 62, CARD_H - 104);
  } else if (card.type === 'trap') {
    g.font = '800 26px Georgia, serif';
    g.fillStyle = '#e8b93a';
    g.fillText('⧗ TRAP', CARD_W / 2, CARD_H - 44);
  }

  // ── rarity gem ──
  const gy = CARD_H - 56;
  g.save();
  g.translate(CARD_W / 2, gy + (card.type === 'trap' ? 22 : 0));
  if (card.type !== 'trap') {
    g.rotate(Math.PI / 4);
    const gs = 13;
    const rg = g.createLinearGradient(-gs, -gs, gs, gs);
    rg.addColorStop(0, shade(rc, 0.4)); rg.addColorStop(1, shade(rc, -0.35));
    g.fillStyle = rg;
    g.fillRect(-gs, -gs, gs * 2, gs * 2);
    g.lineWidth = 2.5; g.strokeStyle = shade(rc, -0.55);
    g.strokeRect(-gs, -gs, gs * 2, gs * 2);
  }
  g.restore();

  // art not in yet → kick the load and redraw THIS canvas when it lands
  // (fixes placeholder cards in reward reveals / inspect modals)
  const artState = artCache.get(cardId);
  if (!forceArt && (!artState || (!artState.loaded && !artState.error))) {
    loadArt(cardId, () => drawCard(canvas, cardId));
  }
  return canvas;
}

// ── BOARD variant: Hearthstone-style in-play card — big art, name, no rules
// text (hover/inspect gives details), no baked stat gems (live chips own those).
export function drawBoardCard(canvas, cardId) {
  const card = cardById(cardId);
  const realm = REALMS[card.realm] || REALMS.neutral;
  canvas.width = CARD_W; canvas.height = CARD_H;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, CARD_W, CARD_H);
  drawFrame(g, card);

  // art fills the card body
  const ax = 26, ay = 26, aw = CARD_W - 52, ah = CARD_H - 160;
  g.save();
  roundRect(g, ax, ay, aw, ah, 18);
  g.clip();
  const art = artCache.get(cardId);
  const img = art && art.loaded ? art.img : null;
  if (img) {
    const s = Math.max(aw / img.width, ah / img.height);
    const dw = img.width * s, dh = img.height * s;
    g.drawImage(img, ax + (aw - dw) / 2, ay + (ah - dh) / 2, dw, dh);
  } else {
    const ph = g.createLinearGradient(0, ay, 0, ay + ah);
    ph.addColorStop(0, shade(realm.css, -0.3));
    ph.addColorStop(1, shade(realm.css, -0.65));
    g.fillStyle = ph; g.fillRect(ax, ay, aw, ah);
  }
  const vg = g.createLinearGradient(0, ay, 0, ay + ah);
  vg.addColorStop(0, 'rgba(0,0,0,.25)'); vg.addColorStop(0.12, 'rgba(0,0,0,0)');
  vg.addColorStop(0.8, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = vg; g.fillRect(ax, ay, aw, ah);
  g.restore();
  roundRect(g, ax, ay, aw, ah, 18);
  g.lineWidth = 3; g.strokeStyle = shade(realm.css, -0.1); g.stroke();

  // name banner — big and readable at board size
  const ny = CARD_H - 128;
  const nbGrad = g.createLinearGradient(0, ny, 0, ny + 66);
  nbGrad.addColorStop(0, shade(realm.css, -0.18));
  nbGrad.addColorStop(1, shade(realm.css, -0.58));
  roundRect(g, 22, ny, CARD_W - 44, 66, 14);
  g.fillStyle = nbGrad; g.fill();
  g.lineWidth = 2.5; g.strokeStyle = 'rgba(255,255,255,.3)'; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const namePx = fitText(g, card.name, CARD_W - 96, 42, '800 {px}px Georgia, serif');
  g.font = `800 ${namePx}px Georgia, serif`;
  g.fillStyle = 'rgba(0,0,0,.6)';
  g.fillText(card.name, CARD_W / 2 + 2, ny + 35);
  g.fillStyle = card.rarity === 'legendary' ? '#ffe9a8' : '#f7f2ff';
  g.fillText(card.name, CARD_W / 2, ny + 33);

  // small tribe line under banner
  g.font = '600 24px Georgia, serif';
  g.fillStyle = shade(RARITY_COLOR[card.rarity] || '#b8c0cc', 0.25);
  g.fillText((card.tribe || (card.type === 'trap' ? 'Trap' : 'Spell')), CARD_W / 2, CARD_H - 34);

  // cost gem (kept — useful for bounce/inspect reads); larger for readability
  drawGem(g, 64, 64, 48, realm.css, card.cost, { hot: true });
  return canvas;
}

const boardCache = new Map();
export function getBoardCard(cardId) {
  let c = boardCache.get(cardId);
  if (!c) {
    const canvas = document.createElement('canvas');
    drawBoardCard(canvas, cardId);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    c = { canvas, tex };
    boardCache.set(cardId, c);
    loadArt(cardId, () => {
      drawBoardCard(canvas, cardId);
      tex.needsUpdate = true;
    });
  }
  return c;
}

// cached full-size canvas + THREE texture
export function getCard(cardId) {
  let c = cardCache.get(cardId);
  if (!c) {
    const canvas = document.createElement('canvas');
    drawCard(canvas, cardId);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    c = { canvas, tex };
    cardCache.set(cardId, c);
    loadArt(cardId, () => {
      drawCard(canvas, cardId);
      tex.needsUpdate = true;
      if (c.onArt) c.onArt();
    });
  }
  return c;
}

export function preload(cardIds) {
  for (const id of new Set(cardIds)) getCard(id);
}

// card backs (enemy hand, decks, face-down traps) — selectable cosmetics,
// keyed by asset file name. Earned through the Campaign.
const backCaches = new Map();
export function getCardBack(file = 'cardback.jpg') {
  if (backCaches.has(file)) return backCaches.get(file);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W; canvas.height = CARD_H;
  const g = canvas.getContext('2d');
  const draw = (img) => {
    g.clearRect(0, 0, CARD_W, CARD_H);
    roundRect(g, 6, 6, CARD_W - 12, CARD_H - 12, 30);
    g.fillStyle = '#141026'; g.fill();
    g.save();
    roundRect(g, 16, 16, CARD_W - 32, CARD_H - 32, 22);
    g.clip();
    if (img) {
      const s = Math.max((CARD_W - 32) / img.width, (CARD_H - 32) / img.height);
      g.drawImage(img, (CARD_W - img.width * s) / 2, (CARD_H - img.height * s) / 2, img.width * s, img.height * s);
    } else {
      g.fillStyle = '#1c1433'; g.fillRect(0, 0, CARD_W, CARD_H);
    }
    g.restore();
    roundRect(g, 6, 6, CARD_W - 12, CARD_H - 12, 30);
    g.lineWidth = 8;
    const bg2 = g.createLinearGradient(0, 0, CARD_W, CARD_H);
    bg2.addColorStop(0, '#7a5cb8'); bg2.addColorStop(0.5, '#3a2a5c'); bg2.addColorStop(1, '#7a5cb8');
    g.strokeStyle = bg2; g.stroke();
  };
  draw(null);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => { draw(img); tex.needsUpdate = true; };
  img.src = 'assets/ui/' + file;
  const entry = { canvas, tex };
  backCaches.set(file, entry);
  return entry;
}

// small canvas for DOM grids (deck builder / collection)
export function cardThumb(cardId, w = 210) {
  const { canvas } = getCard(cardId);
  const out = document.createElement('canvas');
  out.width = w; out.height = Math.round(w * CARD_H / CARD_W);
  const g = out.getContext('2d');
  g.drawImage(canvas, 0, 0, out.width, out.height);
  // keep thumbs fresh once art lands
  const c = cardCache.get(cardId);
  const prev = c.onArt;
  c.onArt = () => {
    if (prev) prev();
    g.clearRect(0, 0, out.width, out.height);
    g.drawImage(canvas, 0, 0, out.width, out.height);
  };
  return out;
}
