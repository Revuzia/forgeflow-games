// ui lane scratch preview (CONTRACT §0.5). One page, ?screen=<name>, fake-but-REAL data:
// a real World from createWorld/stepN, poked into the state each screen needs.
// Screens: hud · slate · sizeup · alert · boss · draft · chest · select · select2 · title · pause ·
//          settings · tabloid · tabloiddead · flow (keyboard-driven interaction test → window.__RESULTS__)
import type { BossState, TitanId, World } from '../../../src/core/types.ts';
import { TITAN_IDS } from '../../../src/core/types.ts';
import { createWorld, stepN } from '../../../src/core/world.ts';
import { Input } from '../../../src/core/input.ts';
import { loadSettings } from '../../../src/core/save.ts';
import { TITANS } from '../../../src/data/titans.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
import { BOSSES } from '../../../src/data/bosses.ts';
import { UPGRADES } from '../../../src/data/upgrades.ts';
import { Hud } from '../../../src/ui/hud.ts';
import { Broadcast } from '../../../src/ui/broadcast.ts';
import { BossBar } from '../../../src/ui/bossbar.ts';
import { SelectScreen } from '../../../src/ui/select.ts';
import { DraftScreen } from '../../../src/ui/draft.ts';
import { TitleScreen, PauseMenu, SettingsPanel } from '../../../src/ui/menus.ts';

declare global { interface Window { __SNAP_READY__?: boolean; __RESULTS__?: unknown[]; __UI__?: unknown } }

const q = new URLSearchParams(location.search);
const screen = q.get('screen') || 'hud';
const titanId = (q.get('titan') || 'molo') as TitanId;
const biomeId = (q.get('biome') || 'grideast') as 'grideast' | 'whitestacks' | 'lockwater';
const root = document.getElementById('ui') as HTMLElement;
const bg = document.getElementById('bg') as HTMLCanvasElement;
const input = new Input(window);
const results: unknown[] = [];
window.__RESULTS__ = results;

// ── placeholder "freeze frame": a painted 2D city so overlays read against a busy scene ──
function paintBackdrop(night = biomeId === 'lockwater'): string {
  const W = bg.width = innerWidth, H = bg.height = innerHeight;
  const g = bg.getContext('2d') as CanvasRenderingContext2D;
  const P = BIOMES[biomeId].palette;
  g.fillStyle = P.road; g.fillRect(0, 0, W, H);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // blocks on an iso-ish grid
  g.save(); g.translate(W / 2, H / 2); g.rotate(-0.46); g.scale(1, 0.62);
  const pitch = W / 5;
  for (let bx = -5; bx <= 5; bx++) for (let bz = -5; bz <= 5; bz++) {
    const x = bx * pitch, z = bz * pitch;
    g.fillStyle = P.sidewalk; g.fillRect(x - pitch * .4, z - pitch * .4, pitch * .8, pitch * .8);
    for (let k = 0; k < 4; k++) {
      const w = pitch * (.18 + r() * .16), d = pitch * (.18 + r() * .16);
      const px = x - pitch * .34 + (k % 2) * pitch * .36, pz = z - pitch * .34 + Math.floor(k / 2) * pitch * .36;
      g.fillStyle = 'rgba(20,20,40,.35)'; g.fillRect(px + 14, pz + 22, w, d);
      g.fillStyle = [P.bodyA, P.bodyB, P.bodyC][k % 3]; g.fillRect(px, pz, w, d);
      g.fillStyle = P.roofA; g.fillRect(px + 4, pz + 4, w - 8, d - 8);
    }
    // zebra
    g.fillStyle = P.crosswalk;
    for (let s = 0; s < 6; s++) g.fillRect(x + pitch * .44, z - pitch * .12 + s * pitch * .045, pitch * .12, pitch * .025);
  }
  g.restore();
  // "titan" blob in the middle so the frame has a subject
  const T = TITANS[titanId];
  g.fillStyle = 'rgba(20,20,40,.35)'; g.beginPath(); g.ellipse(W / 2 + 30, H / 2 + 34, 80, 26, 0, 0, 7); g.fill();
  g.fillStyle = T.colors.primary; g.strokeStyle = '#1b1426'; g.lineWidth = 6;
  g.beginPath(); g.ellipse(W / 2, H / 2, 90, 46, -0.2, 0, 7); g.fill(); g.stroke();
  g.fillStyle = T.colors.secondary; g.beginPath(); g.ellipse(W / 2 + 70, H / 2 - 20, 38, 30, 0, 0, 7); g.fill(); g.stroke();
  g.fillStyle = T.colors.eye; g.beginPath(); g.arc(W / 2 + 82, H / 2 - 28, 7, 0, 7); g.fill();
  if (night) { g.fillStyle = 'rgba(11,16,34,.45)'; g.fillRect(0, 0, W, H); }
  return bg.toDataURL('image/jpeg', 0.85);
}

// ── fake portraits (2D canvas silhouettes in canon colours; the real ones come from portraits.ts) ──
function fakePortrait(id: TitanId): string {
  const c = document.createElement('canvas'); c.width = 384; c.height = 384;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const T = TITANS[id].colors;
  g.lineWidth = 10; g.strokeStyle = '#1b1426'; g.lineJoin = 'round';
  const blob = (x: number, y: number, rx: number, ry: number, rot: number, fill: string) => {
    g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, 7); g.fill(); g.stroke();
  };
  if (id === 'molo') { blob(190, 250, 150, 70, 0, T.primary); blob(300, 205, 60, 45, -.3, T.secondary); for (let i = 0; i < 6; i++) blob(90 + i * 34, 185 - (i % 2) * 14, 16, 28, 0, T.accent); }
  if (id === 'voltkite') { blob(190, 240, 110, 60, -.3, T.primary); blob(285, 150, 50, 38, -.5, T.secondary); for (let i = 0; i < 5; i++) blob(230 + i * 18, 110 - i * 8, 10, 30, .6, T.accent); }
  if (id === 'hearthback') { blob(190, 240, 150, 105, 0, T.primary); blob(190, 200, 90, 40, 0, T.accent); blob(320, 260, 45, 35, 0, T.secondary); }
  if (id === 'briarwick') { blob(190, 250, 130, 80, 0, T.primary); blob(290, 180, 55, 45, 0, T.secondary); for (let i = 0; i < 7; i++) blob(120 + i * 25, 175 - Math.sin(i) * 20, 16, 16, 0, T.accent); }
  g.fillStyle = T.eye; g.beginPath(); g.arc(id === 'hearthback' ? 330 : 300, id === 'voltkite' ? 140 : 195, 9, 0, 7); g.fill();
  return c.toDataURL('image/png');
}

// ── a real world, poked into a mid-run state ──
function midRun(rank: 0 | 1 | 2 | 3 | 4 = 2): World {
  const w = createWorld({ titan: titanId, biome: biomeId, seed: 7 });
  stepN(w, 240);
  const T = w.titan;
  T.rank = rank; T.level = 17; T.xp = Math.round(T.xpToNext * 0.62);
  T.mass = 95 + 600 + 9000 * 0.4;           // ~40 % through Size III
  T.maxHp = 480; T.hp = 312;
  T.floorsEaten = 812; T.buildingsLeveled = 96; T.propsEaten = 1400; T.kills = 342; T.crushed = 188;
  T.abilityCd = 3.4; T.dashCharges = 0; T.dashRecharge = 1.3;
  w.run.tonnage = 184_220; w.run.blocksLeveled = 7; w.t = 331.4;
  const ids = UPGRADES.filter((u) => !u.titan || u.titan === titanId).slice(0, 60);
  const pick = [ids[0], ids[5], ids[12], ids[20], ids[33], ids[41], ids[48]].filter(Boolean);
  pick.forEach((u, i) => { w.upgrades.owned[u.id] = 1 + (i % 3); w.upgrades.order.push(u.id); });
  w.upgrades.shield = 60;
  return w;
}

function fakeBoss(w: World, phase: 1 | 2 | 3, frac: number): BossState {
  const id = biomeId === 'whitestacks' ? 'irongully' : 'caisson4';
  const def = BOSSES[id];
  const b: BossState = {
    id, alive: true, x: 0, z: 0, heading: 0, px: 0, pz: 0, pheading: 0,
    hp: def.hp * 0.75 * frac, maxHp: def.hp * 0.75, phase, meter: 0.62, staggerT: 0,
    attack: phase >= 2 ? def.attacks[2].id : null, attackT: 0.4, cd: 2, introT: 0, parts: [],
    subtitle: phase >= 2 ? def.attacks[2].subtitle : '', data: {},
  };
  w.boss = b;
  return b;
}

async function main(): Promise<void> {
  const shot = paintBackdrop();
  const ready = () => { setTimeout(() => { window.__SNAP_READY__ = true; }, 900); };
  const portraits = {} as Record<TitanId, string>;
  for (const id of TITAN_IDS) portraits[id] = fakePortrait(id);

  switch (screen) {
    case 'hud': case 'boss': case 'sizeup': case 'alert': case 'lowhp': {
      const w = midRun(screen === 'boss' ? 4 : 2);
      if (screen === 'lowhp') w.titan.hp = w.titan.maxHp * 0.18;
      const hud = new Hud(root);
      const bc = new Broadcast(root, input);
      const bar = new BossBar(root);
      hud.show(true);
      let b: BossState | null = null;
      if (screen === 'boss') { b = fakeBoss(w, 2, 0.58); bar.show(BOSSES[b.id]); }
      let last = performance.now();
      const loop = (t: number) => {
        const dt = Math.min(0.1, (t - last) / 1000); last = t;
        hud.update(w, dt);
        if (b) bar.update(b);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      hud.onEvents(w, [{ type: 'rankUp', rank: 2 }, { type: 'chest', x: 0, z: 0 }]);
      if (screen === 'sizeup') setTimeout(() => bc.sizeUp(2), 50);
      if (screen === 'alert') { bc.alert('armor'); bc.alert('elite'); }
      window.__UI__ = { w, hud, bc, bar };
      setTimeout(() => { window.__SNAP_READY__ = true; }, screen === 'sizeup' ? 700 : screen === 'alert' ? 900 : 1200);
      return;
    }
    case 'slate': {
      const bc = new Broadcast(root, input);
      void bc.openSlate(BIOMES[biomeId], TITANS[titanId]).then(() => results.push('slate:done'));
      window.__UI__ = { bc };
      ready();
      return;
    }
    case 'tabloid': case 'tabloiddead': {
      const w = midRun(4);
      const b = fakeBoss(w, 3, screen === 'tabloid' ? 0 : 0.41);
      if (screen === 'tabloid') { b.alive = false; b.hp = 0; w.run.result = 'clear'; } else { w.run.result = 'dead'; w.titan.alive = false; }
      w.run.endT = 548.2; w.run.peakRank = 4;
      const bc = new Broadcast(root, input);
      void bc.tabloid(w, shot).then((r) => results.push('tabloid:' + r));
      window.__UI__ = { bc };
      setTimeout(() => { window.__SNAP_READY__ = true; }, 1700);
      return;
    }
    case 'draft': case 'chest': {
      const w = midRun(2);
      if (screen === 'chest') { w.upgrades.pendingDrafts = 0; w.upgrades.chestDrafts = 1; } else w.upgrades.pendingDrafts = 1;
      const pool = UPGRADES.filter((u) => !u.titan || u.titan === titanId);
      const offer = screen === 'chest'
        ? [pool.find((u) => u.rarity === 'epic'), pool.find((u) => u.rarity === 'legendary'), pool.find((u) => u.titan === titanId && u.rarity !== 'common')]
        : [pool.find((u) => u.rarity === 'common' && w.upgrades.owned[u.id]), pool.find((u) => u.rarity === 'rare'), pool.find((u) => u.titan === titanId)];
      const ids = offer.filter(Boolean).map((u) => (u as { id: string }).id);
      const hud = new Hud(root); hud.show(true); hud.update(w, 0.016);
      const d = new DraftScreen(root, input);
      void d.open(w, ids, screen === 'chest' ? 0 : 2).then((r) => results.push(r));
      window.__UI__ = { d };
      setTimeout(() => { window.__SNAP_READY__ = true; }, 1100);
      return;
    }
    case 'select': case 'select2': {
      const s = new SelectScreen(root, input);
      void s.run(portraits, { titan: titanId, biome: biomeId }).then((r) => results.push(r));
      if (screen === 'select2') setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' })), 500);
      window.__UI__ = { s };
      setTimeout(() => { window.__SNAP_READY__ = true; }, 1300);
      return;
    }
    case 'title': {
      const t = new TitleScreen(root, input);
      void t.run().then(() => results.push('title:done'));
      ready();
      return;
    }
    case 'pause': {
      const w = midRun(2);
      const hud = new Hud(root); hud.show(true); hud.update(w, 0.016);
      const p = new PauseMenu(root, input);
      void p.open().then((r) => results.push('pause:' + r));
      ready();
      return;
    }
    case 'settings': {
      const p = new SettingsPanel(root, input);
      void p.open(loadSettings()).then((r) => results.push(r));
      ready();
      return;
    }
    case 'flow': { await flow(portraits, shot); return; }
    default: ready();
  }
}

// ── interaction test: real KeyboardEvents through window (the UiKeys path) ──
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function key(code: string, keyName: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, code, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: keyName, code, bubbles: true }));
}
async function flow(portraits: Record<TitanId, string>, shot: string): Promise<void> {
  const log = (k: string, v: unknown) => results.push({ k, v, mode: input.mode });
  input.mode = 'game';
  // title: Enter
  const t = new TitleScreen(root, input);
  const tp = t.run(); log('title.open.mode', input.mode);
  await sleep(450); key('Enter', 'Enter'); await tp; log('title.done', true);
  // select: right, Enter (→ step 2), Esc (→ step 1), Enter, right, right, Enter (DROP IN)
  const s = new SelectScreen(root, input);
  const sp = s.run(portraits, { titan: 'molo', biome: 'grideast' });
  await sleep(350); key('ArrowRight', 'ArrowRight'); await sleep(60); key('Enter', 'Enter'); await sleep(80);
  key('Escape', 'Escape'); await sleep(80); key('Enter', 'Enter'); await sleep(80);
  key('KeyD', 'd'); await sleep(60); key('KeyD', 'd'); await sleep(60); key('Enter', 'Enter');
  log('select.result', await sp);
  // select: Esc at step 1 → null
  const sp2 = s.run(portraits); await sleep(350); key('Escape', 'Escape'); log('select.esc', await sp2);
  // slate: any key
  const bc = new Broadcast(root, input);
  const sl = bc.openSlate(BIOMES.lockwater, TITANS.voltkite); await sleep(600); key('KeyQ', 'q'); await sl; log('slate.done', true);
  // draft: Space must NOT pick; '2' picks card 2
  const w = midRun(2); w.upgrades.pendingDrafts = 1;
  const ids = UPGRADES.filter((u) => !u.titan).slice(0, 3).map((u) => u.id);
  const d = new DraftScreen(root, input);
  let dp = d.open(w, ids, 1); await sleep(400); key('Space', ' '); await sleep(120); key('Digit2', '2');
  log('draft.pick2', await dp); log('draft.expect', ids[1]);
  dp = d.open(w, ids, 1); await sleep(400); key('KeyR', 'r'); log('draft.reroll', await dp);
  dp = d.open(w, ids, 0); await sleep(400); key('KeyR', 'r'); await sleep(150); key('ArrowRight', 'ArrowRight'); await sleep(50); key('Enter', 'Enter');
  log('draft.noReroll.enter', await dp);
  // pause: down ×2 (retry) Enter Enter → retry; then Esc → resume
  input.mode = 'game';
  const p = new PauseMenu(root, input);
  let pp = p.open(); log('pause.open.mode', input.mode);
  await sleep(300); key('ArrowDown', 'ArrowDown'); key('ArrowDown', 'ArrowDown'); await sleep(40); key('Enter', 'Enter'); await sleep(60); key('Enter', 'Enter');
  log('pause.retry', await pp); log('pause.after.mode', input.mode);
  pp = p.open(); await sleep(300); key('Escape', 'Escape'); log('pause.esc', await pp);
  await sleep(50); log('pause.esc.pausePressedLeak', (input.update(), input.pressed('pause')));
  // pause → settings: down, Enter (settings), right ×3 on master, down ×5 → DONE row... Esc closes settings; Esc resumes
  let got: unknown = null; p.onSettings = (x) => { got = x; };
  pp = p.open(); await sleep(300); key('ArrowDown', 'ArrowDown'); await sleep(40); key('Enter', 'Enter'); await sleep(350);
  key('ArrowLeft', 'ArrowLeft'); key('ArrowLeft', 'ArrowLeft'); await sleep(40); key('ArrowDown', 'ArrowDown'); key('ArrowDown', 'ArrowDown'); key('ArrowDown', 'ArrowDown');
  key('ArrowDown', 'ArrowDown'); await sleep(30); key('Enter', 'Enter'); await sleep(40); key('Escape', 'Escape'); await sleep(400);
  log('settings.saved', got); key('Escape', 'Escape'); log('pause.after.settings', await pp);
  // tabloid: arrow down + Enter → 'select'; then 'T' → title
  const w2 = midRun(4); w2.run.result = 'dead';
  let tb = bc.tabloid(w2, shot); await sleep(1200); key('ArrowDown', 'ArrowDown'); await sleep(40); key('Enter', 'Enter'); log('tabloid.enter', await tb);
  tb = bc.tabloid(w2, shot); await sleep(1200); key('KeyT', 't'); log('tabloid.t', await tb);
  log('final.mode', input.mode);
  window.__SNAP_READY__ = true;
}

void main().catch((e) => { console.error(e); results.push('ERROR ' + String(e)); window.__SNAP_READY__ = true; });
