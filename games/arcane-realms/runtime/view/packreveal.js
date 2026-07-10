// Arcane Realms TCG — 3D Arcane Pack opening.
// A self-contained Three.js overlay: an arcane-foil pack floats in the void; click
// it to burst it open and fan the cards out, each flipping face-up with rarity FX
// (glow for new cards, an energy ring for epics, a golden ray-burst + screen shake
// for legendaries; duplicates show muted with their sell-back value).
//
// openPackReveal(cards, opts) — cards: [{id, isNew, rarity, dupGold}]
//   opts: { onDone, cardbackFile, shake, particles }
// Throws synchronously if WebGL is unavailable so the caller can fall back to the
// flat DOM reveal. All GL resources created here are disposed on close; the shared
// card textures from cardtex.js are cloned, never disposed.

import * as THREE from 'three';
import { getCard, getCardBack, preload } from './cardtex.js?v=23';
import { Audio2 } from './audio.js?v=23';

const RARITY = {
  common:    { hex: 0xb8c0cc, css: '#b8c0cc', name: 'Common' },
  uncommon:  { hex: 0x4fc06a, css: '#4fc06a', name: 'Uncommon' },
  rare:      { hex: 0x3f8fe8, css: '#5aa2f0', name: 'Rare' },
  epic:      { hex: 0xb44fe8, css: '#c98bff', name: 'Epic' },
  legendary: { hex: 0xf0b93a, css: '#ffd45f', name: 'Legendary' },
  token:     { hex: 0x8d99ae, css: '#8d99ae', name: 'Token' },
};
const rar = (r) => RARITY[r] || RARITY.common;

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const s = document.createElement('style');
  s.textContent = `
#pk-overlay{position:fixed;inset:0;z-index:320;overflow:hidden;opacity:0;transition:opacity .4s;cursor:pointer;pointer-events:auto;
  background:
    radial-gradient(ellipse at 50% 48%, transparent 26%, rgba(8,5,16,.66) 82%),
    linear-gradient(rgba(11,7,20,.34), rgba(11,7,20,.52)),
    url('assets/ui/pack_bg.jpg') center/cover no-repeat,
    #0b0714}
#pk-overlay.in{opacity:1}
#pk-overlay canvas{position:absolute;inset:0;width:100%!important;height:100%!important}
#pk-flash{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%,#fff8e6,#ffe6a0 40%,transparent 72%);opacity:0;pointer-events:none;mix-blend-mode:screen}
#pk-hint{position:absolute;left:0;right:0;bottom:8.5vh;text-align:center;color:#e7dcff;font:600 15px 'Segoe UI',system-ui,sans-serif;
  letter-spacing:.16em;text-transform:uppercase;text-shadow:0 2px 12px #000;pointer-events:none;animation:pkpulse 1.5s ease-in-out infinite}
@keyframes pkpulse{50%{opacity:.45}}
#pk-labels{position:absolute;inset:0;pointer-events:none}
.pk-label{position:absolute;transform:translate(-50%,0);text-align:center;white-space:nowrap;opacity:0;transition:opacity .3s;
  font:800 12.5px 'Segoe UI',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;text-shadow:0 2px 8px #000}
.pk-label .pk-rar{font-size:10.5px;font-weight:700;letter-spacing:.2em;opacity:.9;display:block;margin-top:2px}
#pk-continue{position:absolute;left:50%;bottom:7vh;transform:translateX(-50%) translateY(10px);opacity:0;transition:all .3s;
  pointer-events:auto;z-index:2}
#pk-continue.show{opacity:1;transform:translateX(-50%)}
`;
  document.head.appendChild(s);
}

// small generated additive sprites -------------------------------------------
function radial(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const R = size / 2;
  const grd = g.createRadialGradient(R, R, R * 0.5, R, R, R);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.72, 'rgba(255,255,255,0)');
  grd.addColorStop(0.85, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function runeTexture(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const R = size / 2;
  g.translate(R, R);
  g.strokeStyle = 'rgba(230,205,255,0.9)'; g.lineWidth = 3;
  for (const rr of [0.62, 0.72, 0.9]) { g.beginPath(); g.arc(0, 0, R * rr, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 5;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74);
    g.lineTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,235,190,0.95)';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.save(); g.rotate(a); g.beginPath();
    g.moveTo(0, -R * 0.55); g.lineTo(R * 0.05, -R * 0.66); g.lineTo(-R * 0.05, -R * 0.66);
    g.closePath(); g.fill(); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function openPackReveal(cards, opts = {}) {
  injectStyle();
  const onDone = opts.onDone || (() => {});
  const wantShake = opts.shake !== false;
  const pFactor = opts.particles === false ? 0.4 : 1;
  preload(cards.map((c) => c.id));

  // ── overlay DOM ──
  const overlay = document.createElement('div'); overlay.id = 'pk-overlay';
  const flash = document.createElement('div'); flash.id = 'pk-flash';
  const hint = document.createElement('div'); hint.id = 'pk-hint'; hint.textContent = '✦ Click the pack to open ✦';
  const labels = document.createElement('div'); labels.id = 'pk-labels';
  const cont = document.createElement('button'); cont.id = 'pk-continue'; cont.className = 'btn primary'; cont.textContent = 'Continue';
  overlay.append(flash, labels, hint, cont);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));

  // ── renderer / scene ──
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { overlay.remove(); throw e; }
  if (!renderer || !renderer.getContext()) { overlay.remove(); throw new Error('no webgl'); }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  overlay.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 7);

  const disposables = [];      // geometries + materials + generated textures I own
  const track = (o) => { disposables.push(o); return o; };
  const effects = [];          // transient particle systems {points, vel, life, ttl, geo, mat}

  // shared textures cloned so this renderer/overlay fully owns + refreshes them
  const backFile = opts.cardbackFile || 'cardback.jpg';
  const backTex = track(new THREE.CanvasTexture(getCardBack(backFile).canvas));
  backTex.colorSpace = THREE.SRGBColorSpace; backTex.anisotropy = 8;
  const refreshables = [backTex];

  const N = cards.length;
  const SP = N <= 1 ? 0 : N <= 3 ? 2.2 : 1.8;   // tighter spacing for a 4-5 card fan
  const ARC_Y = N <= 3 ? 0 : 0.42;              // gentle upward bow for wider fans
  const CW = 1.5, CH = CW * 768 / 512;  // card plane size

  // ── the pack ──
  const glintTex = track(radial(64, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,230,170,0.9)'], [1, 'rgba(255,200,120,0)']]));
  const softTex = track(radial(256, [[0, 'rgba(255,220,150,0.9)'], [0.4, 'rgba(210,150,60,0.35)'], [1, 'rgba(120,80,200,0)']]));
  const ringTex = track(ringTexture());
  const runeTex = track(runeTexture());

  const packGroup = new THREE.Group(); scene.add(packGroup);
  // big soft glow behind
  const glow = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: softTex, color: 0xffd98a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })));
  glow.scale.set(6.4, 6.4, 1); glow.position.z = -0.6; packGroup.add(glow);
  // slab body (card-back on the broad faces, dark gold on the edges)
  const edgeMat = track(new THREE.MeshBasicMaterial({ color: 0x3a2a10 }));
  const faceMat = track(new THREE.MeshBasicMaterial({ map: backTex }));
  const slab = new THREE.Mesh(track(new THREE.BoxGeometry(1.62, 2.42, 0.17)), [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, faceMat]);
  packGroup.add(slab);
  // rotating rune ring in front
  const rune = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: runeTex, color: 0xf6e4b4, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })));
  rune.scale.set(3.1, 3.1, 1); rune.position.z = 0.14; packGroup.add(rune);
  // orbiting glints
  const AMB = Math.round(120 * pFactor);
  const ambGeo = track(new THREE.BufferGeometry());
  {
    const p = new Float32Array(AMB * 3);
    for (let i = 0; i < AMB; i++) {
      const a = Math.random() * Math.PI * 2, r = 1.3 + Math.random() * 2.4, y = (Math.random() - 0.5) * 3.4;
      p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = y; p[i * 3 + 2] = Math.sin(a) * r * 0.5;
    }
    ambGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  }
  const ambMat = track(new THREE.PointsMaterial({ map: glintTex, color: 0xffe4a8, size: 0.14, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  const amb = new THREE.Points(ambGeo, ambMat); scene.add(amb);

  // ── cards (built now, hidden until reveal) ──
  const cardObjs = cards.map((cd, i) => {
    const grp = new THREE.Group();
    const frontTex = track(new THREE.CanvasTexture(getCard(cd.id).canvas));
    frontTex.colorSpace = THREE.SRGBColorSpace; frontTex.anisotropy = 8; refreshables.push(frontTex);
    const front = new THREE.Mesh(track(new THREE.PlaneGeometry(CW, CH)), track(new THREE.MeshBasicMaterial({ map: frontTex })));
    front.position.z = 0.006;
    const back = new THREE.Mesh(track(new THREE.PlaneGeometry(CW, CH)), track(new THREE.MeshBasicMaterial({ map: backTex })));
    back.rotation.y = Math.PI; back.position.z = -0.006;
    grp.add(front, back);
    // rarity aura behind the card
    const auraMat = track(new THREE.SpriteMaterial({ map: softTex, color: rar(cd.rarity).hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const aura = new THREE.Sprite(auraMat); aura.scale.set(3.4, 3.9, 1); aura.position.z = -0.2; grp.add(aura);
    const t = i - (N - 1) / 2, tmax = Math.max(1, (N - 1) / 2);
    const tx = t * SP, ty = ARC_Y * (1 - (t / tmax) ** 2);   // middle cards ride slightly higher
    grp.position.set(0, 0, 0); grp.rotation.y = Math.PI; grp.scale.setScalar(0.2); grp.visible = false;
    scene.add(grp);
    // DOM label
    const lab = document.createElement('div'); lab.className = 'pk-label';
    const R = rar(cd.rarity);
    if (cd.isNew) lab.innerHTML = `<span style="color:#8ff0a6">NEW!</span><span class="pk-rar" style="color:${R.css}">${R.name}</span>`;
    else lab.innerHTML = `<span style="color:#ffd45f">Duplicate&nbsp;+${cd.dupGold}g</span><span class="pk-rar" style="color:${R.css}">${R.name}</span>`;
    labels.appendChild(lab);
    return { cd, grp, aura, auraMat, target: new THREE.Vector3(tx, ty, 0), leanZ: -t * 0.06, lab, revealed: false, t0: 0 };
  });

  // ── effect helpers ──
  function burst(origin, count, { color = 0xffe4a8, speed = 4, size = 0.16, ttl = 0.9, spread = 1, up = 0 }) {
    count = Math.max(6, Math.round(count * pFactor));
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = origin.x; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z;
      const a = Math.random() * Math.PI * 2, el = (Math.random() - 0.5) * Math.PI * spread, s = speed * (0.4 + Math.random() * 0.8);
      vel[i * 3] = Math.cos(a) * Math.cos(el) * s;
      vel[i * 3 + 1] = Math.sin(el) * s + up;
      vel[i * 3 + 2] = Math.sin(a) * Math.cos(el) * s * 0.6;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: glintTex, color, size, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = new THREE.Points(geo, mat); scene.add(pts);
    effects.push({ pts, geo, mat, vel, life: 0, ttl });
  }
  function ringPulse(origin, { color = 0xf0b93a, ttl = 0.7, max = 3.4 }) {
    const mat = new THREE.SpriteMaterial({ map: ringTex, color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const sp = new THREE.Sprite(mat); sp.position.copy(origin); sp.scale.setScalar(0.4); scene.add(sp);
    effects.push({ sprite: sp, mat, ttl, life: 0, ringMax: max });
  }
  let shakeMag = 0;
  function shake(m) { if (wantShake) shakeMag = Math.max(shakeMag, m); }

  // fire the per-rarity reward FX when a card lands face-up
  function fireRarityFx(o) {
    const R = rar(o.cd.rarity); const at = o.grp.position;
    if (!o.cd.isNew) { Audio2.sfx('coin'); o.auraMat.color.setHex(0x6a6a78); return; }
    if (o.cd.rarity === 'legendary') {
      Audio2.sfx('legendary');
      ringPulse(at, { color: 0xffe08a, ttl: 0.85, max: 4.4 });
      burst(at, 60, { color: 0xffe4a8, speed: 6, size: 0.2, ttl: 1.1, spread: 1.4 });
      flashScreen(0.7); shake(0.5);
    } else if (o.cd.rarity === 'epic') {
      Audio2.sfx('shield');
      ringPulse(at, { color: 0xc98bff, ttl: 0.7, max: 3.2 });
      burst(at, 40, { color: 0xd8a6ff, speed: 4.5, size: 0.17, ttl: 0.9, spread: 1.2 });
      flashScreen(0.28);
    } else {
      Audio2.sfx('spell_arcane');
      burst(at, o.cd.rarity === 'rare' ? 28 : 18, { color: R.hex, speed: 3.4, size: 0.15, ttl: 0.8, spread: 1 });
      if (o.cd.rarity === 'rare') ringPulse(at, { color: R.hex, ttl: 0.6, max: 2.6 });
    }
  }
  let flashV = 0;
  function flashScreen(v) { flashV = Math.max(flashV, v); }

  // ── phase machine ──
  let phase = 'idle';       // idle → burst → reveal → done → closing
  let clock = 0, phaseT = 0;
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === cont) return;
    if (phase === 'idle') startBurst();
    else if (phase === 'done') close();
  });
  cont.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  window.addEventListener('keydown', onKey);
  function onKey(e) { if (e.key === 'Escape') { if (phase === 'idle' || phase === 'done') close(); } }

  function startBurst() { phase = 'burst'; phaseT = 0; hint.style.display = 'none'; Audio2.sfx('summon'); }

  function beginReveal() {
    phase = 'reveal'; phaseT = 0;
    slab.visible = false; rune.visible = false; glow.visible = false;
    cardObjs.forEach((o, i) => { o.grp.visible = true; o.t0 = i * 0.18; });
  }

  function close() {
    if (phase === 'closing') return;
    phase = 'closing';
    overlay.classList.remove('in');
    window.removeEventListener('keydown', onKey);
    setTimeout(() => {
      cancelAnimationFrame(raf);
      for (const d of disposables) if (d && d.dispose) d.dispose();
      for (const e of effects) { e.geo?.dispose(); e.mat?.dispose(); }
      renderer.dispose();
      overlay.remove();
      onDone();
    }, 400);
  }

  // ── resize ──
  function resize() {
    const w = overlay.clientWidth || window.innerWidth, h = overlay.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // pull the camera back so the whole fan fits both axes
    const fanW = SP * (N - 1) + CW + 1.4, fanH = CH + ARC_Y + 1.9;
    const vfov = camera.fov * Math.PI / 180;
    const zH = fanH / (2 * Math.tan(vfov / 2));
    const zW = (fanW / camera.aspect) / (2 * Math.tan(vfov / 2));
    camera.position.z = Math.max(6, Math.max(zH, zW) * 1.06);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ── DOM label placement ──
  const tmp = new THREE.Vector3();
  function placeLabel(o) {
    const w = overlay.clientWidth, h = overlay.clientHeight;
    tmp.set(o.grp.position.x, o.grp.position.y - CH / 2 * o.grp.scale.y - 0.18, o.grp.position.z).project(camera);
    o.lab.style.left = ((tmp.x * 0.5 + 0.5) * w) + 'px';
    o.lab.style.top = ((-tmp.y * 0.5 + 0.5) * h) + 'px';
  }

  // ── main loop ──
  let last = performance.now(), raf = 0;
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt; phaseT += dt;

    // ambient always
    amb.rotation.y += dt * 0.25;
    ambMat.opacity = 0.55 + Math.sin(clock * 2) * 0.2;

    if (phase === 'idle') {
      packGroup.position.y = Math.sin(clock * 1.3) * 0.12;
      packGroup.rotation.y = Math.sin(clock * 0.7) * 0.35;
      packGroup.rotation.z = Math.sin(clock * 0.9) * 0.03;
      rune.material.rotation += dt * 0.5;
      rune.material.opacity = 0.5 + Math.sin(clock * 2.4) * 0.18;
      glow.material.opacity = 0.7 + Math.sin(clock * 1.8) * 0.18;
    } else if (phase === 'burst') {
      if (phaseT < 0.24) {
        const k = phaseT / 0.24;
        packGroup.scale.setScalar(1 - k * 0.22);
        packGroup.rotation.y += dt * (6 + k * 22);
        glow.material.opacity = 0.7 + k * 0.9;
        rune.material.rotation += dt * (2 + k * 10);
        rune.material.opacity = 0.5 + k * 0.5;
      } else if (!packGroup.userData.popped) {
        packGroup.userData.popped = true;
        flashScreen(0.9); shake(wantShake ? 0.4 : 0);
        Audio2.sfx('legendary');
        burst(new THREE.Vector3(0, 0, 0.2), 100, { color: 0xffdf9a, speed: 7.5, size: 0.22, ttl: 1.1, spread: 1.6 });
        burst(new THREE.Vector3(0, 0, 0.2), 40, { color: 0xb98bff, speed: 5.5, size: 0.18, ttl: 1.0, spread: 1.6 });
      } else {
        const k = Math.min(1, (phaseT - 0.24) / 0.3);
        packGroup.scale.setScalar(1.05 + k * 0.6);
        faceMat.opacity = 1 - k; faceMat.transparent = true; edgeMat.opacity = 1 - k; edgeMat.transparent = true;
        rune.material.opacity = (1 - k) * 0.9; glow.material.opacity = (1 - k) * 1.4;
        if (k >= 1) beginReveal();
      }
    } else if (phase === 'reveal' || phase === 'done') {
      let allDone = true;
      for (const o of cardObjs) {
        const lt = phaseT - o.t0;
        if (lt < 0) { allDone = false; continue; }
        const k = Math.min(1, lt / 0.55);
        const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
        o.grp.position.lerpVectors(new THREE.Vector3(0, 0, 0), o.target, e);
        o.grp.scale.setScalar(0.2 + e * 0.8);
        // flip: PI → 0 across the back half of the tween
        const fk = Math.min(1, Math.max(0, (k - 0.35) / 0.5));
        o.grp.rotation.y = Math.PI * (1 - fk);
        o.grp.rotation.z = o.leanZ * e;
        if (!o.revealed && fk >= 1) { o.revealed = true; fireRarityFx(o); }
        if (o.revealed) {
          const target = o.cd.isNew ? (o.cd.rarity === 'legendary' ? 0.9 : o.cd.rarity === 'epic' ? 0.7 : 0.5) : 0.14;
          o.auraMat.opacity += (target + Math.sin(clock * 3) * 0.06 - o.auraMat.opacity) * Math.min(1, dt * 6);
          o.lab.style.opacity = '1';
        }
        placeLabel(o);
        if (k < 1 || !o.revealed) allDone = false;
      }
      if (phase === 'reveal' && allDone) { phase = 'done'; cont.classList.add('show'); hint.style.display = ''; hint.style.animation = 'none'; hint.style.opacity = '.7'; hint.textContent = 'Click anywhere to continue'; }
    }

    // effects update
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i]; fx.life += dt; const p = fx.life / fx.ttl;
      if (p >= 1) { scene.remove(fx.pts || fx.sprite); fx.geo?.dispose(); fx.mat?.dispose(); effects.splice(i, 1); continue; }
      if (fx.pts) {
        const arr = fx.geo.attributes.position.array;
        for (let j = 0; j < arr.length; j += 3) {
          arr[j] += fx.vel[j] * dt; arr[j + 1] += (fx.vel[j + 1] - 2.2 * fx.life) * dt; arr[j + 2] += fx.vel[j + 2] * dt;
        }
        fx.geo.attributes.position.needsUpdate = true;
        fx.mat.opacity = 1 - p;
      } else if (fx.sprite) {
        const s = 0.4 + (fx.ringMax - 0.4) * (1 - Math.pow(1 - p, 2));
        fx.sprite.scale.setScalar(s); fx.mat.opacity = 0.95 * (1 - p);
      }
    }

    // screen flash + shake
    if (flashV > 0) { flash.style.opacity = String(flashV); flashV = Math.max(0, flashV - dt * 2.2); }
    if (shakeMag > 0.001) {
      camera.position.x = (Math.random() - 0.5) * shakeMag;
      camera.position.y = (Math.random() - 0.5) * shakeMag;
      shakeMag *= 0.86;
    } else { camera.position.x = 0; camera.position.y = 0; }

    // keep cloned textures fresh while their source art streams in
    if (clock < 2) for (const t of refreshables) t.needsUpdate = true;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  return { close };
}
