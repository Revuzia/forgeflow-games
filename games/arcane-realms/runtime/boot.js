// Arcane Realms TCG — boot: asset warmup, screen flow, main loop, debug hooks.
import * as THREE from 'three';
import { BoardScene } from './view/scene.js?v=22';
import { UI, Store } from './view/ui.js?v=22';
import { Match } from './view/match.js?v=22';
import { Audio2 } from './view/audio.js?v=22';
import { OnlineSession } from './view/online.js?v=22';
import { preload, getCardBack } from './view/cardtex.js?v=22';
import { STARTER_DECKS, validateDeck } from './sim/decks.js?v=22';
import { COLLECTIBLE, cardById, TOKENS } from './sim/cards.js?v=22';
import { createGame, legalActions, applyAction, makeUnit } from './sim/engine.js?v=22';
import { chooseAction, runAiTurn } from './sim/ai.js?v=22';
import { CampaignUI } from './view/campaign_ui.js?v=22';
import { openPackReveal } from './view/packreveal.js?v=22';
import { CARDBACK_INFO } from './campaign/campaign_data.js?v=22';
import { initProgress, isOwned, ownedCount, copiesOf, sellCard, sellValue, grantBattleRewards, checkAchievements, applyBattleMods } from './campaign/progression.js?v=22';

const container = document.getElementById('game-container');
const splash = document.getElementById('boot-splash');
const splashBar = document.getElementById('boot-bar-fill');
const splashMsg = document.getElementById('boot-msg');

let scene = null;
let ui = null;
let match = null;
let campaignUI = null;
let lastT = performance.now();
let inMatch = false;

function myBackFile() {
  const id = Store.data?.cardback || 'default';
  return (CARDBACK_INFO[id] || CARDBACK_INFO.default).file;
}

function setProgress(f, msg) {
  if (splashBar) splashBar.style.width = Math.round(f * 100) + '%';
  if (splashMsg && msg) splashMsg.textContent = msg;
}

function loadImage(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

async function boot() {
  setProgress(0.1, 'Lighting the braziers…');
  // warm the big UI images first so screens appear complete
  await Promise.all([
    loadImage('assets/ui/menu_bg.jpg'),
    loadImage('assets/ui/cardback.jpg'),
  ]);
  setProgress(0.4, 'Shuffling the realms…');

  scene = new BoardScene(container);
  getCardBack();
  ui = new UI(container, {
    onPlay: (deck, diff, rematch) => startMatch(deck, diff, rematch),
    onSpeedChange: () => applySettings(),
  });
  ui.onOnline = (deck, mode, code, onStatus, onError) => startOnlineMatch(deck, mode, code, onStatus, onError);
  // ── campaign wiring ──
  initProgress(Store);
  campaignUI = new CampaignUI(ui, Store, { onBattle: startCampaignBattle });
  ui.onCampaign = () => campaignUI.open();
  ui.isOwnedFn = (id) => isOwned(Store, id);
  ui.copiesOf = (id) => copiesOf(Store, id);
  ui.sellCard = (id) => sellCard(Store, id);
  ui.sellValueOf = (rarity) => sellValue(rarity);
  ui.onGoldChange = () => campaignUI.refreshGold();
  ui.campaignStrip = () => campaignUI.collectionStrip();
  ui.collectionTitle = () => `COLLECTION — ${ownedCount(Store)}/${COLLECTIBLE.length} OWNED`;
  ui.afterMatch = () => {
    const unlocked = checkAchievements(Store);
    if (unlocked.length) campaignUI.announceAchievements(unlocked);
  };
  setProgress(0.7, 'Waking the Archfoe…');
  // pre-render a handful of starter cards so first hover is instant
  preload(STARTER_DECKS[0].cards.slice(0, 10));
  preload(Object.keys(TOKENS)); // tokens are summoned mid-game (never in a deck) — warm their art so they never render blank
  await loadImage('assets/ui/board.jpg');
  setProgress(1, 'Ready.');
  setTimeout(() => { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 650); }, 250);
  requestAnimationFrame(tick);
}

function applySettings() {
  const st = Store.data.settings;
  if (!scene) return;
  scene.reduceShake = !st.shake;
  scene.fx.density = st.particles ? 1 : 0.45;
  scene.animSpeed = st.fastAnim ? 1.7 : 1;
  if (match) match.speed = st.fastAnim ? 1.7 : 1;
}

function startMatch(deckDef, difficulty, rematch) {
  if (match) { match.destroy(); match = null; }
  const deck = deckDef.cards.slice();
  const v = validateDeck(deck);
  if (!v.ok) { ui.toast('That deck is not battle-legal: ' + v.errors[0]); return; }
  ui._lastDeck = deckDef;
  ui._lastDiff = difficulty;
  // AI picks a random starter deck that isn't the player's
  const pool = STARTER_DECKS.filter((d) => d.id !== deckDef.id);
  const aiDeck = pool[Math.floor(Math.random() * pool.length)];
  const heroes = [deckDef.hero || v.realms[0] || 'neutral', aiDeck.hero];
  preload(deck);
  preload(aiDeck.cards);
  Store.data.lastHero = heroes[0];
  match = new Match({
    scene, ui,
    playerDeck: deck,
    aiDeck: aiDeck.cards,
    difficulty,
    heroes,
    settings: Store.data.settings,
    cardbacks: [myBackFile(), 'cardback.jpg'],
    use3d: true, // custom duels keep the full 3D presentation
  });
  ui.attachMatch(match, heroes);
  inMatch = true;
  window.__ARC__.match = match;
}

// ── campaign battles ──
function startCampaignBattle(chapter, battle, deckDef) {
  if (match) { match.destroy(); match = null; }
  const deck = deckDef.cards.slice();
  const v = validateDeck(deck);
  if (!v.ok) { ui.toast('That deck is not battle-legal: ' + v.errors[0]); campaignUI.open(); return; }
  const hero = deckDef.hero || v.realms[0] || 'neutral';
  Store.data.lastHero = hero;
  Store.save();
  const heroes = [hero, chapter.commander.hero];
  preload(deck);
  preload(chapter.deck);
  // build the state, then apply the battle's campaign twists (boss hp, ambush
  // boards, commander head-starts) before the first render
  const state = createGame({
    seed: Date.now() % 2147483647,
    decks: [deck, chapter.deck.slice()],
    names: ['You', chapter.commander.name],
    heroes,
    first: null,
  });
  applyBattleMods(state, battle, 1, makeUnit);
  match = new Match({
    scene, ui,
    mode: 'ai',
    sharedState: state,
    difficulty: battle.difficulty,
    heroes,
    settings: Store.data.settings,
    cardbacks: [myBackFile(), 'cardback.jpg'],
    use3d: !!battle.boss, // ONLY boss fights get 3D minis + hero models; grunts stay flat
    onGameOver: (won, stats) => {
      Store.data.record[won ? 'wins' : 'losses']++;
      Store.save();
      if (won) {
        const result = grantBattleRewards(Store, battle);
        campaignUI.showRewards(chapter, battle, result, () => {
          const unlocked = checkAchievements(Store);
          if (unlocked.length) campaignUI.announceAchievements(unlocked);
          leaveMatch();
          campaignUI.open();
        });
      } else {
        ui._campaignRetry = () => {
          if (match) { match.destroy(); match = null; }
          startCampaignBattle(chapter, battle, deckDef);
        };
        ui.showGameOver(false, { ...stats, campaign: true });
      }
    },
  });
  ui.attachMatch(match, heroes);
  inMatch = true;
  window.__ARC__.match = match;
}

function startOnlineMatch(deckDef, mode, code, onStatus, onError) {
  const deck = deckDef.cards.slice();
  const v = validateDeck(deck);
  if (!v.ok) { onError('That deck is not battle-legal: ' + v.errors[0]); return null; }
  const session = new OnlineSession({ onStatus });
  const hero = deckDef.hero || v.realms[0] || 'neutral';
  Store.data.lastHero = hero;
  session.start(mode, code, { deck, hero, name: mode === 'join' ? 'Challenger' : 'Duelist', cardback: Store.data.cardback || 'default' })
    .then(({ net, mySide, params }) => {
      if (match) { match.destroy(); match = null; }
      preload(params.decks[0]);
      preload(params.decks[1]);
      // both clients build the IDENTICAL deterministic state from shared params
      const state = createGame({
        seed: params.seed,
        decks: [params.decks[0].slice(), params.decks[1].slice()],
        names: params.names,
        heroes: params.heroes,
        first: null, // seeded → same on both clients
      });
      const backOf = (id) => (CARDBACK_INFO[id] || CARDBACK_INFO.default).file;
      const backs = params.backs || ['default', 'default'];
      match = new Match({
        scene, ui,
        mode: 'online', net, mySide,
        sharedState: state,
        heroes: params.heroes,
        difficulty: 'knight',
        settings: Store.data.settings,
        cardbacks: [backOf(backs[mySide]), backOf(backs[1 - mySide])],
        use3d: true, // live duels keep the full 3D presentation
      });
      ui._lastDeck = deckDef;
      ui.attachMatch(match, [params.heroes[mySide], params.heroes[1 - mySide]]);
      inMatch = true;
      window.__ARC__.match = match;
    })
    .catch((err) => {
      if (String(err.message) !== 'cancelled') onError(err.message || String(err));
    });
  return session;
}

function leaveMatch() {
  inMatch = false;
  if (match) { match.destroy(); match = null; }
  scene.syncFromState(emptyBoardState(), 0, { instant: true });
  ui.show('menu');
}

function emptyBoardState() {
  // a blank state so the scene clears between matches
  return {
    players: [
      { hand: [], board: [], traps: [], deck: [], grave: [], hp: 30, maxHp: 30, mana: 0, manaMax: 0, name: '', hero: 'dawn' },
      { hand: [], board: [], traps: [], deck: [], grave: [], hp: 30, maxHp: 30, mana: 0, manaMax: 0, name: '', hero: 'grave' },
    ],
  };
}

function tick(now) {
  const dtWall = (now - lastT) / 1000;
  const dt = Math.min(0.05, dtWall);
  lastT = now;
  scene.update(dt, dtWall);
  requestAnimationFrame(tick);
}

// SPACE ends the turn (phases are invisible now — attacking auto-enters combat)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !match || match.busy || match.over || !match.myTurn()) return;
  e.preventDefault();
  match.endTurn();
});

// ── debug/test hook (Claude Preview + selftest-in-browser) ─────────────
window.__ARC__ = {
  version: 1,
  get scene() { return scene; },
  get ui() { return ui; },
  match: null,
  state: () => match?.state ?? null,
  legal: () => (match ? legalActions(match.state) : []),
  act: (a) => match ? applyAction(match.state, a) : null,
  // start a deterministic match instantly (bypasses menus)
  startTest: (seed = 7, deckA = 0, deckB = 2, difficulty = 'knight') => {
    Audio2.enabled = false;
    const d = STARTER_DECKS[deckA];
    ui._lastDeck = d; ui._lastDiff = difficulty;
    if (match) { match.destroy(); match = null; }
    preload(d.cards); preload(STARTER_DECKS[deckB].cards);
    match = new Match({
      scene, ui,
      playerDeck: d.cards, aiDeck: STARTER_DECKS[deckB].cards,
      difficulty, heroes: [d.hero, STARTER_DECKS[deckB].hero],
      settings: Store.data.settings, seed,
    });
    ui.attachMatch(match, [d.hero, STARTER_DECKS[deckB].hero]);
    inMatch = true;
    window.__ARC__.match = match;
    return true;
  },
  // fast-forward until it's the human's turn, with the async AI loop suspended
  ffToMyTurn: (maxActions = 80) => {
    if (!match) return null;
    match._suspendAi = true;
    let n = 0;
    while (n < maxActions && match.state.winner === null &&
           !(match.state.active === match.mySide && n > 0)) {
      const act = chooseAction(match.state, match.state.active, 'knight');
      applyAction(match.state, act);
      n++;
    }
    match._suspendAi = false;
    match.scene.syncFromState(match.state, match.mySide, { instant: true });
    match.busy = false;
    match.refreshLegal();
    match.ui.hudUpdate(match.state, match);
    return { actions: n, active: match.state.active, winner: match.state.winner, turn: match.state.turn };
  },
  // synchronously fast-forward the sim (no animations) — rAF-freeze proof
  ff: (nActions = 20) => {
    if (!match) return null;
    let n = 0;
    while (n < nActions && match.state.winner === null) {
      const side = match.state.active;
      const act = chooseAction(match.state, side, 'knight');
      applyAction(match.state, act);
      n++;
    }
    match.scene.syncFromState(match.state, 0, { instant: true });
    match.ui.hudUpdate(match.state, match);
    match.busy = match.state.active === 1;
    match.refreshLegal();
    return { actions: n, winner: match.state.winner, turn: match.state.turn };
  },
  leaveMatch,
  cardCount: COLLECTIBLE.length,
  // debug: force a pack reveal with a specific card list (rarity FX testing)
  packReveal: (cards) => openPackReveal(cards, { cardbackFile: myBackFile(), shake: Store.data.settings?.shake !== false, particles: Store.data.settings?.particles !== false }),
};

boot();
