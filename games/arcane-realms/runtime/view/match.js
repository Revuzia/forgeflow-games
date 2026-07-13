// Arcane Realms TCG — match controller.
// Drives a live game vs the AI ('ai' mode) or a remote human over the NetPlay
// relay ('online' mode). Input FSM: drag-to-play from hand; attacks use
// click-select → arrow-follows-cursor → click-target (drag-release also works).
// `mySide` is this client's engine player index (host 0 / guest 1); the scene
// always shows my side at the bottom via syncFromState(state, mySide).

import * as THREE from 'three';
import { createGame, legalActions, applyAction, cloneState } from '../sim/engine.js?v=24';
import { cardById, REALMS } from '../sim/cards.js?v=24';
import { chooseAction } from '../sim/ai.js?v=24';
import { Audio2 } from './audio.js?v=24';

const REALM_COLOR = (id) => REALMS[cardById(id).realm]?.color ?? 0x8d99ae;
// css hex of a card's realm color — tints the targeting arrows per element
const REALM_CSS = (id) => '#' + REALM_COLOR(id).toString(16).padStart(6, '0');

function hashState(state) {
  // cheap deterministic digest for online desync detection (djb2 over JSON)
  const s = JSON.stringify([state.turn, state.active, state.phase, state.iid, state.rngState,
    state.players.map((p) => [p.hp, p.mana, p.manaMax, p.deck.length, p.hand.length,
      p.board.map((u) => [u.iid, u.card, u.atk, u.hp, u.tapped, u.frozen]), p.traps.length, p.grave.length])]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

export class Match {
  constructor({ scene, ui, playerDeck, aiDeck, difficulty, heroes, seed, settings,
                mode = 'ai', net = null, mySide = 0, sharedState = null, names,
                cardbacks = null, onGameOver = null, use3d = true }) {
    this.onGameOver = onGameOver;
    this.scene = scene;
    this.ui = ui;
    this.mode = mode;
    this.net = net;
    this.mySide = mySide;
    this.foeSide = 1 - mySide;
    this.difficulty = difficulty || 'knight';
    this.settings = settings;
    this.state = sharedState || createGame({
      seed: seed ?? (Date.now() % 2147483647),
      decks: [playerDeck.slice(), aiDeck.slice()],
      names: names || ['You', 'Archfoe'],
      heroes,
      first: null,
    });
    this.busy = true;
    this.over = false;
    this.drag = null;        // hand-card drag
    this.select = null;      // attack selection {iid, attacks, viaCombat, moved}
    this.attackQueue = [];   // SELECTED attackers {iid, attacks, viaCombat} — all strike one clicked target
    this.hoverIid = null;
    this.legal = [];
    this.stats = { dmgDealt: 0, cardsPlayed: 0 };
    this.speed = settings.fastAnim ? 1.7 : 1;
    this._remoteQueue = [];
    this._remoteBusy = false;
    scene.animSpeed = this.speed;
    scene.reduceShake = !settings.shake;
    scene.fx.density = settings.particles ? 1 : 0.45;
    scene.use3d = use3d; // gate 3D minis + hero models (bosses only in campaign)

    // heroes[] is by ABSOLUTE engine side; scene wants rel (0 = bottom = me)
    scene.setHeroPortrait(0, heroes[this.mySide]);
    scene.setHeroPortrait(1, heroes[this.foeSide]);
    scene.setCardBacks(cardbacks?.[0], cardbacks?.[1]);
    this.heroesAbs = heroes;
    // 60s turn clock (HS-style): enforced for MY turn (auto end), shown for the
    // opponent's turn online. AI turns resolve instantly → clock hidden.
    this.turnMs = 60000;
    this._turnEndsAt = 0;
    this._timerVis = false;
    this._timerMine = false;
    this._timerIv = setInterval(() => this._timerTick(), 200);
    this.bindInput();
    if (this.net) this.bindNet();

    this.scene.syncFromState(this.state, this.mySide, { instant: true });
    this.ui.hudUpdate(this.state, this);
    this.playOpening();
  }

  relOf(absSide) { return absSide === this.mySide ? 0 : 1; }
  myTurn() { return this.state.active === this.mySide; }
  isGuard(u) { return !!u && !u.silenced && Array.isArray(u.kw) && u.kw.includes('guard'); }
  enemyHasGuard() { return this.state.players[this.foeSide].board.some((u) => this.isGuard(u)); }

  async playOpening() {
    await this.ui.banner(this.myTurn() ? 'YOUR TURN' : 'ENEMY TURN', this.myTurn());
    Audio2.playMusic(Math.random() < 0.5 ? 'battle' : 'battle2');
    this.busy = false;
    this._startTurnTimer(this.state.active);
    this.refreshLegal();
    this.ui.coach('welcome', 'Play a card: <b>click or drag a creature</b> onto the table, or click a spell and pick its target. Mana 💎 refills every turn — spend it all!');
    if (!this.myTurn()) this.startFoeTurn();
  }

  startFoeTurn() {
    if (this.mode === 'ai') this.aiTurn();
    else this.pumpRemote(); // online: wait for opponent messages
  }

  // ── helpers ──────────────────────────────────────────────────
  refreshLegal() {
    this.legal = this.over ? [] : legalActions(this.state);
    this.scene.clearGlows();
    this.scene.setHeroGlow(0, false);
    this.scene.setHeroGlow(1, false);
    // hand affordability is ALWAYS reflected: unaffordable cards are dimmed,
    // playable ones glow — instantly readable "what can I use at this mana"
    const playable = new Set(
      (!this.over && this.myTurn() ? this.legal : []).filter((a) => a.type === 'play').map((a) => a.iid));
    for (const h of this.state.players[this.mySide].hand) {
      const e = this.scene.cards.get(h.iid);
      if (!e || e.zone !== 'hand') continue;
      e.mesh.material.color.setScalar(playable.has(h.iid) || !this.myTurn() || this.busy ? 1 : 0.45);
    }
    if (this.busy || !this.myTurn()) { this.ui.hudUpdate(this.state, this); return; }
    const glowCol = this.settings.glowColor || '#4fd0e8';
    for (const iid of playable) this.scene.setGlow(iid, glowCol, true);
    // attacker glow ONLY during combat — the main phase stays clean
    if (this.state.phase === 'combat') {
      const attackers = new Set(this.legal.filter((a) => a.type === 'attack').map((a) => a.attacker));
      for (const iid of attackers) this.scene.setGlow(iid, 0xffd45f, true);
    }
    // selected attackers keep their "ready" ring
    for (const item of this.attackQueue) this.scene.setGlow(item.iid, 0xffd45f, true);
    this.ui.hudUpdate(this.state, this);
  }

  posOfTarget(t) {
    if (!t) return new THREE.Vector3(0, 0.4, 0);
    if (t.kind === 'hero') return this.scene.heroPos(this.relOf(t.p));
    const p = this.scene.posOf(t.iid);
    return p || new THREE.Vector3(0, 0.4, 0);
  }

  floatAt(pos3, text, cls) {
    const s = this.scene.worldToScreen(pos3.clone().add(new THREE.Vector3(0, 0.5, 0)));
    this.ui.floatText(s.x, s.y, text, cls);
  }

  wait(ms) { return new Promise((r) => setTimeout(r, ms / this.speed)); }

  // ── action pipeline ──────────────────────────────────────────
  async doAction(action, { enemyReveal = null, fromRemote = false } = {}) {
    if (this.over) return;
    this.busy = true;
    if (this.boardHoverIid != null) { this.scene.setBoardHover(this.boardHoverIid, false); this.boardHoverIid = null; }
    this.hoverIid = null; this.scene._hoverActive = false; // clear any hand-hover overlay state
    this.clearSelect();
    this.scene.clearGlows();
    this.scene.setHeroGlow(0, false);
    this.scene.setHeroGlow(1, false);
    this.ui.hideArrow();
    let events;
    try {
      events = applyAction(this.state, action);
    } catch (err) {
      console.warn('illegal action', action, err.message);
      if (!fromRemote) Audio2.sfx('error');
      this.busy = false;
      this.refreshLegal();
      return;
    }
    if (!fromRemote && this.net) {
      this.net.send('action', { action, h: hashState(this.state) });
    }
    if (action.type === 'play' && !fromRemote) this.stats.cardsPlayed++;
    await this.animateEvents(events, action, enemyReveal);
    this.ui.hudUpdate(this.state, this);
    if (this.state.winner !== null && !this.over) return this.finish();
    this.busy = false;
    this.refreshLegal();
    if (!this.myTurn() && !this.over && !fromRemote) this.startFoeTurn();
  }

  async animateEvents(events, action, enemyReveal) {
    const scene = this.scene;
    const playEv = events.find((e) => e.t === 'play-creature');
    if (playEv && scene.cards.has(playEv.handIid)) {
      const e = scene.cards.get(playEv.handIid);
      scene.cards.delete(playEv.handIid);
      e.iid = playEv.iid;
      e.mesh.userData.iid = playEv.iid;
      scene.cards.set(playEv.iid, e);
    }

    if (enemyReveal) {
      Audio2.sfx('draw');
      await scene.animEnemyReveal(enemyReveal);
    }

    const playedCardId = playEv ? playEv.card : (events.find((e) => e.t === 'play-spell')?.card ?? null);
    if (playedCardId) {
      const def = cardById(playedCardId);
      if (def.rarity === 'legendary' || def.rarity === 'epic') {
        Audio2.sfx('legendary');
        this.ui.cardBanner(def);
        await this.wait(700);
      }
    }

    // PRE-SYNC pass
    for (const ev of events) {
      switch (ev.t) {
        case 'turn-start': {
          Audio2.sfx('turn');
          this._startTurnTimer(ev.p);
          await this.ui.banner(ev.p === this.mySide ? 'YOUR TURN' : 'ENEMY TURN', ev.p === this.mySide);
          if (ev.p === this.mySide &&
              this.state.players[this.mySide].board.some((u) => !u.sick && !u.tapped && !u.frozen)) {
            this.ui.coach('attack-how', 'Your creatures are ready! <b>Click one, then click an enemy</b> creature or their hero to attack.');
          }
          break;
        }
        case 'draw': if (ev.p === this.mySide) Audio2.sfx('draw'); break;
        case 'burn': this.floatAt(scene.heroPos(this.relOf(ev.p)), 'Burned: ' + cardById(ev.card).name, 'bad'); break;
        case 'fatigue': this.floatAt(scene.heroPos(this.relOf(ev.p)), `Fatigue ${ev.amount}!`, 'bad'); break;
        case 'play-creature': Audio2.sfx('summon'); break;
        case 'play-spell': {
          // distinct cast voice per realm — fire ≠ frost ≠ shadow ≠ light…
          const sr = cardById(ev.card).realm;
          Audio2.sfx(['ember', 'tide', 'grove', 'dawn', 'grave'].includes(sr) ? 'spell_' + sr : 'spell_arcane');
          await this.spellChoreography(ev);
          break;
        }
        case 'play-trap': Audio2.sfx('trap'); break;
        case 'trap-trigger': {
          Audio2.sfx('trap');
          this.ui.toast(`Trap: ${cardById(ev.card).name}!`);
          await scene.animTrapReveal(ev.iid, ev.card, this.relOf(ev.p));
          break;
        }
        case 'negate': this.floatAt(new THREE.Vector3(0, 0.5, 0), 'COUNTERED!', 'huge'); await this.wait(420); break;
        case 'attack-declared': {
          Audio2.sfx('attack');
          const tp = this.posOfTarget(ev.target);
          await scene.animAttack(ev.attacker, tp);
          break;
        }
        case 'attack-fizzle': this.floatAt(this.posOfTarget({ kind: 'unit', iid: ev.attacker }), 'Foiled!', 'bad'); break;
        case 'combat': Audio2.sfx('impact'); break;
        case 'tap': {
          const e = scene.cards.get(ev.iid);
          if (e) {
            Audio2.sfx('tap');
            scene.tweens.killOf(e.group.rotation);
            scene.tweens.add(e.group.rotation, { y: (e.side === 0 ? -1 : 1) * Math.PI / 2 }, 0.3, 'cubicInOut');
          }
          break;
        }
        case 'damage': {
          const pos = this.posOfTarget(ev.target);
          this.floatAt(pos, `-${ev.amount}`, ev.target.kind === 'hero' ? 'dmg big' : 'dmg');
          scene.playFxAt(pos, 'damage');
          if (ev.target.kind === 'hero') {
            scene.shake(0.22);
            if (ev.target.p === this.foeSide) this.stats.dmgDealt += ev.amount;
            this.ui.heroHit(this.relOf(ev.target.p));      // HUD plate flash
            scene.heroFlinch(this.relOf(ev.target.p));     // 3D character recoils + flashes red
          }
          await this.wait(110);
          break;
        }
        case 'venom': { const p = this.posOfTarget({ kind: 'unit', iid: ev.iid }); this.floatAt(p, '☠ Venom', 'bad'); scene.playFxAt(p, 'venom'); Audio2.sfx('venom'); break; }
        case 'pierce': { scene.playFxAt(this.scene.heroPos(1), 'pierce'); Audio2.sfx('pierce'); break; }
        case 'death': {
          Audio2.sfx('death');
          await scene.animDeath(ev.iid);
          break;
        }
        case 'rites': this.floatAt(this.posOfTarget({ kind: 'unit', iid: ev.iid }), 'Last Rites', 'purple'); await this.wait(160); break;
        case 'ward-break': { const p = this.posOfTarget({ kind: 'unit', iid: ev.iid }); this.floatAt(p, 'Ward broken', 'info'); Audio2.sfx('shield'); break; }
        case 'bounce': Audio2.sfx('draw'); break;
        case 'time-surge': { this.ui.toast('⏳ TIME SURGE — creatures attack twice this turn!'); Audio2.sfx('legendary'); break; }
      }
    }

    scene.syncFromState(this.state, this.mySide);

    // POST-SYNC pass
    for (const ev of events) {
      switch (ev.t) {
        case 'play-creature':
        case 'summon': {
          const pos = scene.posOf(ev.iid);
          if (!pos) break;
          const cardId = this.unitCard(ev.iid) || ev.card;
          const def = cardById(cardId);
          const kind = def.rarity === 'legendary' ? 'legendary-summon' : def.rarity === 'epic' ? 'epic-summon' : 'summon';
          scene.playFxAt(pos, kind, REALM_COLOR(cardId));
          if (ev.resurrected) this.floatAt(pos, 'Resurrected', 'purple');
          if (ev.stolen) this.floatAt(pos, 'Betrayed!', 'purple');
          if (kind !== 'summon') await this.wait(260);
          break;
        }
        case 'heal': {
          const pos = this.posOfTarget(ev.target);
          this.floatAt(pos, `+${ev.amount}`, 'heal');
          scene.playFxAt(pos, 'heal');
          Audio2.sfx('heal');
          break;
        }
        case 'buff': {
          const pos = this.posOfTarget({ kind: 'unit', iid: ev.iid });
          if (ev.atk || ev.hp) this.floatAt(pos, `+${ev.atk}/+${ev.hp}`, 'heal');
          if (ev.kw && ev.kw.length) this.floatAt(pos, ev.kw.join(' '), 'info');
          scene.playFxAt(pos, 'buff');
          Audio2.sfx('buff');
          break;
        }
        case 'debuff': {
          const pos = this.posOfTarget({ kind: 'unit', iid: ev.iid });
          this.floatAt(pos, `${ev.atk || 0}/${ev.hp || 0}`, 'bad');
          scene.playFxAt(pos, 'debuff');
          Audio2.sfx('debuff');
          break;
        }
        case 'freeze': {
          const pos = this.posOfTarget({ kind: 'unit', iid: ev.iid });
          scene.playFxAt(pos, 'freeze');
          Audio2.sfx('freeze');
          break;
        }
        case 'silence': {
          const pos = this.posOfTarget({ kind: 'unit', iid: ev.iid });
          this.floatAt(pos, 'Silenced', 'info');
          Audio2.sfx('debuff');
          break;
        }
        case 'ramp': if (ev.p === this.mySide) this.floatAt(scene.heroPos(0), '+1 Mana Crystal', 'info'); break;
        case 'untap': if (ev.extra) { const p = scene.posOf(ev.iid); if (p) scene.playFxAt(p, 'buff'); } break;
      }
    }
    this.ui.hudUpdate(this.state, this);
  }

  unitCard(iid) {
    for (const p of this.state.players) {
      const u = p.board.find((x) => x.iid === iid);
      if (u) return u.card;
    }
    const e = this.scene.cards.get(iid);
    return e ? e.cardId : null;
  }

  // realm-aware spell FX: comets, detonations, novas, pillars, sweeps.
  // Awaited BEFORE the damage events animate, so numbers land on impact.
  async spellChoreography(ev) {
    const scene = this.scene;
    const def = cardById(ev.card);
    const ops = def.fx || [];
    const has = (o) => ops.some((x) => x.op === o);
    const COLORS = { ember: 0xff7a3d, tide: 0x7fd0ff, grove: 0x54d06a, dawn: 0xffd45f, grave: 0xb44fe8, neutral: 0xc9b8ec };
    const col = COLORS[def.realm] ?? 0xc9b8ec;
    const big = def.cost >= 4;
    const caster = scene.heroPos(this.relOf(ev.p)).clone().setY(0.85);
    const tgt = ev.target ? this.posOfTarget(ev.target).clone().setY(0.45) : null;
    const offensive = has('damage') || has('destroy') || has('debuff') || has('freeze');
    const isAoe = has('aoe') || has('freeze-all') || has('multi-hit') || has('bounce-all')
      || ops.some((x) => x.target === 'all-enemy-creatures');

    const detonate = (pos) => {
      switch (def.realm) {
        case 'ember': scene.fx.explosion(pos, col, { big }); scene.shake(big ? 0.3 : 0.16); Audio2.sfx('impact'); break;
        case 'tide': scene.fx.frostNova(pos, { big }); Audio2.sfx('freeze'); break;
        case 'grave': scene.fx.shadowRend(pos, { big }); Audio2.sfx('venom'); break;
        case 'dawn': scene.fx.holyPillar(pos); Audio2.sfx('heal'); break;
        case 'grove': scene.fx.natureBurst(pos, { big }); Audio2.sfx('buff'); break;
        default: scene.fx.explosion(pos, col, { big: false }); Audio2.sfx('impact');
      }
    };

    if (tgt && offensive) {
      // the Fireball moment: comet arcs from your hero and DETONATES on the target
      await scene.fx.projectile(caster, tgt, {
        color: col, coreColor: 0xffffff,
        size: def.realm === 'ember' ? 0.62 : 0.5,
        dur: 0.42, arc: 1.9,
      });
      detonate(tgt);
      await this.wait(170);
    } else if (isAoe) {
      // wave of element matter crashes across the enemy board
      const foeUnits = this.state.players[this.foeSide].board
        .map((u) => scene.posOf(u.iid)).filter(Boolean);
      const mid = new THREE.Vector3(0, 0.5, scene.heroPos(1).z + 1.9);
      await scene.fx.projectile(caster, foeUnits[0] || mid, { color: col, size: 0.55, dur: 0.34, arc: 2.1 });
      if (def.realm === 'ember') scene.shake(0.22);
      const SWEEP = { ember: { cell: 1, spin: 4 }, tide: { cell: 3, spin: 2 }, grove: { cell: 2, spin: 3 }, dawn: { cell: 1, spin: 1 } };
      await scene.fx.aoeSweep(foeUnits.length ? foeUnits : [mid], col, { stepMs: 85, ...(SWEEP[def.realm] || {}) });
      await this.wait(90);
    } else if (has('heal') && tgt) {
      if (def.realm === 'dawn') scene.fx.holyPillar(tgt);
      else { scene.fx.fountain(tgt, 0x54d06a, { n: 22 }); scene.fx.ring(tgt, 0x54d06a, { maxR: 1.6 }); }
      Audio2.sfx('heal');
      await this.wait(200);
    } else if (has('buff') && tgt) {
      scene.fx.fountain(tgt, 0xffd45f, { n: 20 });
      scene.fx.ring(tgt, col, { maxR: 1.5 });
      Audio2.sfx('buff');
      await this.wait(180);
    } else {
      // utility flourish at the caster (draw / ramp / summon spells)
      scene.fx.burst(caster, col, { n: 20, speed: 1.7, life: 0.6, up: 1.1 });
      scene.fx.ring(caster.clone().setY(0.06), col, { maxR: 1.4, dur: 0.4 });
      await this.wait(160);
    }
  }

  async finish() {
    this.over = true;
    this.busy = true;
    const won = this.state.winner === this.mySide;
    Audio2.sting(won ? 'victory' : 'defeat');
    if (won) this.scene.fx.fountain(new THREE.Vector3(0, 0.4, 0.5), 0xf0b93a, { n: 90, life: 1.6 });
    if (this.net) { try { this.net.leave(); } catch { /* gone */ } }
    await this.wait(900);
    const stats = {
      turns: this.state.turn,
      dmg: this.stats.dmgDealt,
      played: this.stats.cardsPlayed,
      difficulty: this.mode === 'online' ? 'online' : this.difficulty,
      online: this.mode === 'online',
    };
    if (this.onGameOver) { this.onGameOver(won, stats); return; }
    this.ui.showGameOver(won, stats);
  }

  // ── AI turn (ai mode) ────────────────────────────────────────
  async aiTurn() {
    this.busy = true;
    this.refreshLegal();
    let guard = 0;
    while (!this.over && !this._suspendAi && this.state.winner === null && this.state.active === this.foeSide && guard++ < 60) {
      await this.wait(520);
      // the state can change during the wait (debug fast-forward, concede) —
      // recheck the guard so a stale loop never acts on the wrong turn
      if (this.over || this._suspendAi || this.state.winner !== null || this.state.active !== this.foeSide) break;
      const act = chooseAction(this.state, this.foeSide, this.difficulty);
      const revealCard =
        act.type === 'play' ? this.state.players[this.foeSide].hand.find((h) => h.iid === act.iid)?.card : null;
      const revealDef = revealCard ? cardById(revealCard) : null;
      const showcase = revealDef && revealDef.type !== 'trap' ? revealCard : null;
      let events;
      try {
        events = applyAction(this.state, act);
      } catch (err) {
        console.warn('AI illegal action', act, err.message);
        events = applyAction(this.state, { type: 'end' });
      }
      if (act.type === 'play' && revealDef && revealDef.type === 'trap') {
        this.ui.toast('The enemy set a trap…');
        Audio2.sfx('trap');
      }
      await this.animateEvents(events, act, showcase);
      if (this.state.winner !== null) return this.finish();
      if (act.type === 'end' || act.type === 'concede') break;
    }
    this.busy = false;
    this.refreshLegal();
  }

  // ── remote turn (online mode) ────────────────────────────────
  bindNet() {
    this.net.on('msg', ({ t, d }) => {
      if (this.over) return;
      if (t === 'action') { this._remoteQueue.push(d); this.pumpRemote(); }
      else if (t === 'emote') this.ui.toast('💬 ' + String(d.text || '').slice(0, 60));
      else if (t === 'resyncReq') {
        this.net.send('resync', { state: this.state });
      } else if (t === 'resync' && d.state) {
        this.state = d.state;
        this.scene.syncFromState(this.state, this.mySide, { instant: true });
        this.busy = !this.myTurn();
        this.refreshLegal();
        this.ui.toast('Game state resynced.');
      }
    });
    this.net.on('peer', ({ present }) => {
      if (!present && !this.over) {
        this.ui.toast('Opponent disconnected — waiting 15s…');
        clearTimeout(this._dcTimer);
        this._dcTimer = setTimeout(() => {
          if (!this.over && !this.net.peerPresent) {
            this.state.winner = this.mySide;
            this.finish();
          }
        }, 15000);
      } else if (present) {
        clearTimeout(this._dcTimer);
      }
    });
  }

  async pumpRemote() {
    if (this._remoteBusy || this.over) return;
    this._remoteBusy = true;
    while (this._remoteQueue.length && !this.over) {
      const d = this._remoteQueue.shift();
      const act = d.action;
      // showcase what the opponent played (their hand is hidden card-backs here)
      const revealCard = act.type === 'play'
        ? this.state.players[this.foeSide].hand.find((h) => h.iid === act.iid)?.card : null;
      const revealDef = revealCard ? cardById(revealCard) : null;
      const showcase = revealDef && revealDef.type !== 'trap' ? revealCard : null;
      if (act.type === 'play' && revealDef && revealDef.type === 'trap') {
        this.ui.toast('Your opponent set a trap…');
        Audio2.sfx('trap');
      }
      await this.doAction(act, { enemyReveal: showcase, fromRemote: true });
      // desync check vs the sender's post-action hash
      if (d.h != null && hashState(this.state) !== d.h && this.net) {
        console.warn('desync detected — requesting resync');
        this.net.send('resyncReq', {});
      }
    }
    this._remoteBusy = false;
    if (!this.over) {
      this.busy = !this.myTurn();
      this.refreshLegal();
    }
  }

  // ── player input ─────────────────────────────────────────────
  bindInput() {
    const el = this.scene.renderer.domElement;
    this.onMove = (e) => this.pointerMove(e);
    this.onDown = (e) => this.pointerDown(e);
    this.onUp = (e) => this.pointerUp(e);
    this.onCtx = (e) => {
      e.preventDefault();
      if (this.select) { this.clearSelect(); this.refreshLegal(); return; }
      this.inspectAt(e.clientX, e.clientY);
    };
    this.onKey = (e) => {
      if (e.key === 'Escape') {
        if (this.select) { this.clearSelect(); this.refreshLegal(); }
        else if (this.ui && this.ui.matchSettings && !document.querySelector('.modal-wrap')) this.ui.matchSettings(); // Esc = pause (industry standard)
      }
      // F/fullscreen is owned by the shared control bar (game_controls.js)
    };
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('keydown', this.onKey);
  }
  unbindInput() {
    const el = this.scene.renderer.domElement;
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('keydown', this.onKey);
  }

  inspectAt(x, y) {
    const hit = this.scene.pick(x, y);
    if (hit && (hit.kind === 'hand' || hit.kind === 'board' || hit.kind === 'trap')) {
      if (hit.kind === 'trap' && hit.side === 1) return;
      const unit = hit.kind === 'board' ? this.findUnit(hit.iid) : null;
      this.ui.showInspect(hit.entry.cardId, unit);
    }
  }

  findUnit(iid) {
    for (const p of this.state.players) {
      const u = p.board.find((x) => x.iid === iid);
      if (u) return u;
    }
    return null;
  }

  // ── unified selection (click-to-target for attacks AND spells) ──
  beginSelect(iid, attacks, viaCombat) {
    this.clearSelect();
    if (viaCombat) {
      const creatureInHand = this.legal.some((a) => {
        if (a.type !== 'play') return false;
        const h = this.state.players[this.mySide].hand.find((x) => x.iid === a.iid);
        return h && cardById(h.card).type === 'creature';
      });
      if (creatureInHand) this.ui.coach('combat-locks', 'Heads up: once you attack, you <b>can\'t summon new creatures</b> this turn (spells are still fine). Play creatures first, then attack.');
    }
    this.select = { kind: 'attack', iid, attacks, viaCombat, moved: false };
    this.scene.setGlow(iid, 0xffd45f, true);
    this.scene.setHoverFront(iid, true);
    for (const a of attacks) {
      if (a.target.kind === 'unit') this.scene.setGlow(a.target.iid, 0xd43f3f, true);
      else this.scene.setHeroGlow(this.relOf(a.target.p), true);
    }
    const from = this.scene.worldToScreen(this.scene.posOf(iid) || new THREE.Vector3());
    this.ui.showArrow(from.x, from.y, from.x, from.y - 30, 'attack', REALM_CSS(this.unitCard(iid)));
    Audio2.sfx('click');
  }

  // targeted spell: the card slides to a casting pose on its NEAR FLANK —
  // small, out of the way, never covering the board or the targets — while
  // the arcane arrow follows the cursor. No dragging required.
  beginSpellSelect(hit, plays) {
    this.clearSelect();
    const entry = hit.entry;
    this.select = { kind: 'spell', iid: hit.iid, cardId: entry.cardId, plays, moved: false };
    this.scene.setHoverFront(hit.iid, true);
    this.scene.tweens.killOf(entry.group.position);
    const castPos = new THREE.Vector3(entry.group.position.x >= 0 ? 5.45 : -5.45, 1.5, 4.25);
    this.scene.applyTransform(entry, {
      pos: castPos,
      rotX: this.scene.faceCamRotX(castPos.y, castPos.z), rotZ: 0, scale: 0.98,
    }, 0.18, 'backOut');
    this.scene.setGlow(hit.iid, 0x6fd8ff, true);
    this.highlightPlays(plays);
    const from = this.scene.worldToScreen(castPos);
    this.ui.showArrow(from.x, from.y, from.x, from.y - 30, 'spell', REALM_CSS(entry.cardId));
    Audio2.sfx('click');
  }

  clearSelect() {
    if (this.select) {
      this.scene.setHoverFront(this.select.iid, false);
      if (this.select.kind === 'spell') this.scene.syncFromState(this.state, this.mySide);
    }
    this.select = null;
    this.ui.hideArrow();
  }

  // multi-attack, gang-up style: SELECTED attackers (this.attackQueue holds
  // {iid, attacks, viaCombat}) each show an arrow; clicking one enemy makes them
  // all strike it. No separate Attack button.
  redrawSelectArrows(cx, cy) {
    this.ui.clearQueuedArrows();
    for (const item of this.attackQueue) {
      const f = this.scene.worldToScreen(this.scene.posOf(item.iid) || new THREE.Vector3());
      const tx = cx != null ? cx : f.x, ty = cy != null ? cy : f.y - 70;
      // each attacker's arrow carries its own element color
      this.ui.addQueuedArrow(item.iid, f.x, f.y, tx, ty, REALM_CSS(this.unitCard(item.iid)));
    }
  }

  // resolve every selected attacker against the one chosen target (skipping any
  // made illegal by an earlier hit, e.g. the target already died)
  async resolveSelectedAttacks(tgt) {
    if (this.busy || !this.attackQueue.length) return;
    const sel = this.attackQueue; this.attackQueue = [];
    this.ui.clearQueuedArrows();
    this.scene.clearGlows();
    if (sel.some((x) => x.viaCombat) && this.state.phase === 'main') await this.doAction({ type: 'combat' });
    for (const item of sel) {
      if (this.over) break;
      const action = legalActions(this.state).find(
        (a) => a.type === 'attack' && a.attacker === item.iid && this.sameTarget(a.target, tgt));
      if (action) await this.doAction(action);
    }
    this.ui.coach('exhausted', 'After attacking, a creature is <b>exhausted 💤</b> — it dims and rests until your next turn.');
    this.refreshLegal();
  }

  // drop the current attacker selection (turn change / concede / cancel)
  clearAttackQueue() {
    if (!this.attackQueue.length) return;
    for (const item of this.attackQueue) this.scene.setGlow(item.iid, 0, false);
    this.attackQueue = [];
    this.ui.clearQueuedArrows();
  }

  async commitSpell(tgt) {
    const sel = this.select;
    const def = cardById(sel.cardId);
    if (def.target2) {
      const candidates = sel.plays.filter((a) => this.sameTarget(a.target, tgt));
      if (!candidates.length) { this.clearSelect(); this.refreshLegal(); return; }
      this.clearSelect();
      const action = await this.pickSecond(candidates);
      if (action) { Audio2.sfx('play'); await this.doAction(action); }
      else { this.scene.syncFromState(this.state, this.mySide); this.refreshLegal(); }
      return;
    }
    const match = sel.plays.find((a) => this.sameTarget(a.target, tgt));
    this.clearSelect();
    if (match) {
      Audio2.sfx('play');
      await this.doAction(match);
    } else {
      this.refreshLegal();
    }
  }

  pointerMove(e) {
    if (this.over) return;
    const hit = this.scene.pick(e.clientX, e.clientY);
    if (this.drag) { this.dragMove(e, hit); return; }
    // spell arrow follows the cursor (sticky click-to-target mode)
    if (this.select && this.select.kind === 'spell') {
      const fromPos = this.scene.cards.get(this.select.iid)?.group.position || new THREE.Vector3();
      const from = this.scene.worldToScreen(fromPos);
      this.ui.showArrow(from.x, from.y, e.clientX, e.clientY, 'spell', REALM_CSS(this.select.cardId));
      if (e.buttons & 1) this.select.moved = true;
      el_cursor(this.scene.renderer.domElement, hit, this);
      return;
    }
    // every selected attacker's arrow follows the cursor toward the target
    if (this.attackQueue.length) {
      this.redrawSelectArrows(e.clientX, e.clientY);
      el_cursor(this.scene.renderer.domElement, hit, this);
      return;
    }
    // hand hover lift + front-render (the card itself enlarges — no duplicates)
    const newHover = hit && hit.kind === 'hand' && hit.side === 0 ? hit.iid : null;
    if (newHover !== this.hoverIid) {
      const prev = this.scene.cards.get(this.hoverIid);
      if (prev && prev.zone === 'hand') {
        prev.hover = false;
        this.scene.setHoverFront(prev.iid, false);
        const handArr = this.state.players[this.mySide].hand;
        const idx = handArr.findIndex((h) => h.iid === prev.iid);
        if (idx >= 0) this.scene.applyTransform(prev, this.scene.handTransform(0, idx, handArr.length, false), 0.18);
      }
      this.hoverIid = newHover;
      // while a hand card is enlarged, hide every board nameplate so the card
      // renders CLEANLY on top — the HTML orbs (above the canvas) were bleeding
      // over the pushed-forward card
      this.scene._hoverActive = !!newHover;
      const cur = this.scene.cards.get(newHover);
      if (cur) {
        cur.hover = true;
        this.scene.setHoverFront(cur.iid, true);
        Audio2.sfx('hover');
        const handArr = this.state.players[this.mySide].hand;
        const idx = handArr.findIndex((h) => h.iid === cur.iid);
        if (idx >= 0) this.scene.applyTransform(cur, this.scene.handTransform(0, idx, handArr.length, true), 0.16);
      }
    }
    // board hover: the REAL card enlarges with full rules text — but NOT while
    // targeting (spell armed / attackers selected / dragging), so the enlarge
    // never covers the creature you're trying to click
    const targeting = (this.select && this.select.kind === 'spell') || this.attackQueue.length > 0 || this.drag;
    const newBoardHover = hit && hit.kind === 'board' && !this.busy && !targeting ? hit.iid : null;
    if (newBoardHover !== this.boardHoverIid) {
      if (this.boardHoverIid != null) this.scene.setBoardHover(this.boardHoverIid, false);
      this.boardHoverIid = newBoardHover;
      if (newBoardHover != null) this.scene.setBoardHover(newBoardHover, true);
    }
    el_cursor(this.scene.renderer.domElement, hit, this);
  }

  pointerDown(e) {
    if (this.busy || this.over || !this.myTurn() || e.button !== 0) return;
    const hit = this.scene.pick(e.clientX, e.clientY);

    // a spell is armed → this click picks its target (or cancels)
    if (this.select && this.select.kind === 'spell') {
      const tgt = this.hitToTarget(hit);
      if (tgt && this.select.plays.some((a) => this.sameTarget(a.target, tgt))) this.commitSpell(tgt);
      else { this.clearSelect(); this.refreshLegal(); }
      return;
    }

    // attackers are selected → this click is the SHARED target (they all strike),
    // or toggles another of your creatures into the selection
    if (this.attackQueue.length) {
      const tgt = this.hitToTarget(hit);
      const valid = tgt && this.attackQueue.some((item) => item.attacks.some((a) => this.sameTarget(a.target, tgt)));
      if (valid) { this.resolveSelectedAttacks(tgt); return; }
      if (hit && hit.kind === 'board' && hit.side === 0) { this.trySelectAttacker(hit); return; }
      // clicked an evasive Flyer with grounded attackers → explain the rule
      if (tgt && tgt.kind === 'unit') {
        const u = this.findUnit(tgt.iid);
        if (u && !u.silenced && (u.kw || []).includes('flying') && !u.tapped && !(u.kw || []).includes('guard')) {
          Audio2.sfx('error');
          this.ui.toast('≋ Flying — only Flying attackers can reach it. (Exhausted or Guarding Flyers lose this.)');
          return; // keep the selection so they can pick a legal target
        }
      }
      if (tgt && this.enemyHasGuard() &&
          (tgt.kind === 'hero' ? tgt.p === this.foeSide : !this.isGuard(this.findUnit(tgt.iid)))) {
        Audio2.sfx('error');
        this.ui.toast('🛡 Blocked by Guard — destroy the enemy Guard creature(s) first.');
        return; // keep the selection so they can pick a legal target
      }
      this.clearAttackQueue(); this.refreshLegal(); // clicked away → cancel selection
      return;
    }

    if (!hit) return;
    if (hit.kind === 'hand' && hit.side === 0) {
      const plays = this.legal.filter((a) => a.type === 'play' && a.iid === hit.iid);
      if (!plays.length) { Audio2.sfx('error'); this.ui.toast(this.whyUnplayable(hit.iid)); return; }
      const card = cardById(hit.entry.cardId);
      if (card.type === 'spell' && card.target) {
        // targeted spells use click-to-target — the card locks into a casting
        // pose and the arcane arrow follows the cursor
        this.beginSpellSelect(hit, plays);
        return;
      }
      this.drag = { mode: 'card', iid: hit.iid, cardId: hit.entry.cardId, def: card, plays, sx: e.clientX, sy: e.clientY };
      this.scene.tweens.killOf(hit.entry.group.position);
      this.highlightPlays(plays);
    } else if (hit.kind === 'board' && hit.side === 0) {
      if (this.boardHoverIid != null) { this.scene.setBoardHover(this.boardHoverIid, false); this.boardHoverIid = null; }
      this.trySelectAttacker(hit);
    }
  }

  // toggle a creature in/out of the attacker selection; clicking an already
  // selected one deselects it
  trySelectAttacker(hit) {
    const idx = this.attackQueue.findIndex((x) => x.iid === hit.iid);
    if (idx >= 0) {
      this.scene.setGlow(hit.iid, 0, false);
      this.attackQueue.splice(idx, 1);
      this.redrawSelectArrows();
      this.refreshLegal();
      return;
    }
    let attacks = this.legal.filter((a) => a.type === 'attack' && a.attacker === hit.iid);
    let viaCombat = false;
    if (!attacks.length && this.state.phase === 'main') {
      const sim = cloneState(this.state);
      try {
        applyAction(sim, { type: 'combat' });
        attacks = legalActions(sim).filter((a) => a.type === 'attack' && a.attacker === hit.iid);
        viaCombat = true;
      } catch { /* noop */ }
    }
    if (!attacks.length) {
      const u = this.findUnit(hit.iid);
      if (u) this.ui.toast(u.tapped ? 'Exhausted — already attacked this turn.' : u.frozen ? 'Frozen solid.' : u.sick ? 'Summoning sickness — ready next turn.' : 'No attack available.');
      Audio2.sfx('error');
      return;
    }
    this.attackQueue.push({ iid: hit.iid, attacks, viaCombat });
    this.scene.setGlow(hit.iid, 0xffd45f, true);
    Audio2.sfx('click');
    if (this.enemyHasGuard() && !attacks.some((a) => a.target.kind === 'hero')) {
      this.ui.coach('guard', '🛡 The enemy has a <b>Guard</b>. Destroy Guard creatures before you can attack the hero or anything behind them.');
    }
    this.ui.coach('multi-attack', 'Pick <b>one or more of your creatures</b> (each shows an arrow), then click the <b>enemy</b> — they all strike together.');
    this.redrawSelectArrows();
  }

  whyUnplayable(iid) {
    const h = this.state.players[this.mySide].hand.find((x) => x.iid === iid);
    if (!h) return 'Not your card.';
    const def = cardById(h.card);
    if (def.cost > this.state.players[this.mySide].mana) return `Needs ${def.cost} mana.`;
    if (def.type === 'creature' && this.state.phase !== 'main') return 'You\'ve already attacked — creatures can\'t be summoned after combat starts.';
    if (def.type === 'creature' && this.state.players[this.mySide].board.length >= 6) return 'Your board is full.';
    if (def.type === 'trap' && this.state.players[this.mySide].traps.length >= 3) return 'Trap limit reached (3).';
    if (def.target && !def.target.optional) return 'No valid target.';
    return 'Cannot play that now.';
  }

  highlightPlays(plays) {
    for (const a of plays) {
      if (a.target) {
        if (a.target.kind === 'unit') this.scene.setGlow(a.target.iid, 0x4f8fe8, true);
        else this.scene.setHeroGlow(this.relOf(a.target.p), true, a.target.p === this.foeSide ? 0xd43f3f : 0x4fc06a);
      }
      if (a.target2 && a.target2.kind === 'unit') this.scene.setGlow(a.target2.iid, 0xd43f3f, true);
    }
  }

  dragMove(e, hit) {
    const d = this.drag;
    if (d.mode === 'card') {
      const entry = this.scene.cards.get(d.iid);
      if (!entry) { this.drag = null; return; }
      const pt = hit && hit.point ? hit.point : null;
      if (pt) {
        entry.group.position.set(pt.x, 0.9, pt.z);
        entry.inner.rotation.x = this.scene.faceCamRotX(0.9, pt.z); // billboard while dragging
        entry.group.scale.setScalar(0.9);
      }
      if (d.def.type === 'creature') {
        const n = this.state.players[this.mySide].board.length;
        if (pt && pt.z > -0.2 && pt.z < 3.4) {
          const slot = Math.max(0, Math.min(n, Math.round(pt.x / 1.62 + n / 2)));
          d.slot = slot;
          this.scene.showGhost(Math.min(slot, n), n + 1);
        } else { d.slot = null; this.scene.hideGhost(); }
      } else if (d.def.target) {
        const from = this.scene.worldToScreen(entry.group.position);
        this.ui.showArrow(from.x, from.y, e.clientX, e.clientY, 'spell', REALM_CSS(d.cardId));
      }
    }
  }

  async pointerUp(e) {
    const d = this.drag;
    if (!d) {
      // drag-release while a spell is armed also confirms it (drag OR click work)
      if (this.select && this.select.kind === 'spell' && this.select.moved) {
        const hit = this.scene.pick(e.clientX, e.clientY);
        const tgt = this.hitToTarget(hit);
        if (tgt && this.select.plays.some((a) => this.sameTarget(a.target, tgt))) { this.commitSpell(tgt); return; }
        this.select.moved = false; // released over nothing → stay in sticky mode
      }
      return;
    }
    this.drag = null;
    this.ui.hideArrow();
    this.scene.hideGhost();
    const hit = this.scene.pick(e.clientX, e.clientY);
    if (d.mode === 'card') {
      const dropOnBoard = hit && (hit.kind === 'table' || hit.kind === 'board' || hit.kind === 'hero' || hit.kind === 'hand' || hit.kind === 'trap');
      let action = null;
      if (d.def.type === 'creature') {
        if (hit && hit.point && hit.point.z < 3.6) {
          const slot = d.slot ?? undefined;
          const targeted = d.plays.filter((a) => a.target); // Rally-with-target options
          let play = d.plays.find((a) => !a.target) || d.plays[0];
          if (hit.kind === 'board' || hit.kind === 'hero') {
            // dropped directly on a valid Rally target
            const tgt = this.hitToTarget(hit);
            const withTgt = targeted.find((a) => this.sameTarget(a.target, tgt));
            if (withTgt) play = withTgt;
          } else if (targeted.length) {
            // has a targeted Rally but wasn't dropped on a target — PROMPT so the
            // Rally actually fires (previously it silently played with no target)
            this.scene.syncFromState(this.state, this.mySide);
            const picked = await this.chooseRallyTarget(targeted, !!d.def.target?.optional);
            if (picked === 'cancel') play = null;           // bailed on a required target
            else if (picked) play = picked;                 // chose a target
            // picked === null + optional → keep the no-target play (skip Rally)
          }
          action = play ? { ...play, slot } : null;
        }
      } else if (d.def.target) {
        const tgt = this.hitToTarget(hit);
        if (d.def.target2) {
          const candidates = tgt ? d.plays.filter((a) => this.sameTarget(a.target, tgt)) : [];
          if (candidates.length) {
            this.scene.syncFromState(this.state, this.mySide);
            action = await this.pickSecond(candidates);
          }
        } else {
          const match = tgt && d.plays.find((a) => this.sameTarget(a.target, tgt));
          if (match) action = match;
        }
      } else {
        if (dropOnBoard) action = d.plays[0];
      }
      if (action) {
        Audio2.sfx('play');
        await this.doAction(action);
      } else {
        this.scene.syncFromState(this.state, this.mySide);
        this.refreshLegal();
      }
    }
  }

  pickSecond(candidates) {
    return new Promise((resolve) => {
      this.ui.toast('Choose the enemy creature to fight');
      this.scene.clearGlows();
      for (const a of candidates) this.scene.setGlow(a.target.iid, 0x4fc06a, true);
      for (const a of candidates) if (a.target2?.kind === 'unit') this.scene.setGlow(a.target2.iid, 0xd43f3f, true);
      const el = this.scene.renderer.domElement;
      const cancel = (val) => {
        el.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('keydown', onKey);
        this.scene.clearGlows();
        resolve(val);
      };
      const onDown = (e) => {
        e.stopPropagation();
        const hit = this.scene.pick(e.clientX, e.clientY);
        const tgt = this.hitToTarget(hit);
        const match = tgt && candidates.find((a) => this.sameTarget(a.target2, tgt));
        cancel(match || null);
      };
      const onKey = (e) => { if (e.key === 'Escape') cancel(null); };
      el.addEventListener('pointerdown', onDown, true);
      window.addEventListener('keydown', onKey);
    });
  }

  // choose the target for a creature's Rally on summon (glow valid targets,
  // click to fire; Esc / click-away skips it when the Rally is optional)
  chooseRallyTarget(candidates, optional) {
    return new Promise((resolve) => {
      this.ui.toast(optional ? '✨ Rally — choose a target (or Esc to skip)' : '✨ Rally — choose a target');
      this.scene.clearGlows();
      for (const a of candidates) {
        if (a.target.kind === 'unit') this.scene.setGlow(a.target.iid, 0x6fd8ff, true);
        else this.scene.setHeroGlow(this.relOf(a.target.p), true);
      }
      const el = this.scene.renderer.domElement;
      const done = (val) => {
        el.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('keydown', onKey);
        this.scene.clearGlows();
        resolve(val);
      };
      const onDown = (e) => {
        e.stopPropagation();
        const hit = this.scene.pick(e.clientX, e.clientY);
        const tgt = this.hitToTarget(hit);
        const match = tgt && candidates.find((a) => this.sameTarget(a.target, tgt));
        if (match) done(match);
        else if (optional) done(null); // clicked away + optional → skip the Rally
        // required + missed → keep waiting for a valid target
      };
      const onKey = (e) => { if (e.key === 'Escape') done(optional ? null : 'cancel'); };
      el.addEventListener('pointerdown', onDown, true);
      window.addEventListener('keydown', onKey);
    });
  }

  hitToTarget(hit) {
    if (!hit) return null;
    if (hit.kind === 'hero') return { kind: 'hero', p: hit.p === 0 ? this.mySide : this.foeSide };
    if (hit.kind === 'board') return { kind: 'unit', iid: hit.iid };
    return null;
  }
  sameTarget(a, b) {
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    return a.kind === 'hero' ? a.p === b.p : a.iid === b.iid;
  }

  async toCombat() {
    if (this.busy || !this.myTurn() || this.state.phase !== 'main') return;
    Audio2.sfx('click');
    await this.doAction({ type: 'combat' });
  }
  async endTurn() {
    if (this.busy || !this.myTurn()) return;
    this.clearAttackQueue(); // drop any pending attacker selection
    Audio2.sfx('click');
    await this.doAction({ type: 'end' });
  }

  // ── turn clock ───────────────────────────────────────────────
  _startTurnTimer(absSide) {
    this._turnEndsAt = performance.now() + this.turnMs;
    this._timerMine = absSide === this.mySide;
    // my turn: always shown + enforced. Foe's turn: shown online (their clock
    // runs on their client), hidden vs the instant AI.
    this._timerVis = this._timerMine || this.mode === 'online';
    this.ui.timerSet?.(this.turnMs, this.turnMs, this._timerMine, this._timerVis);
  }

  _timerTick() {
    if (this.over) { this.ui.timerSet?.(0, this.turnMs, false, false); return; }
    const remain = Math.max(0, this._turnEndsAt - performance.now());
    this.ui.timerSet?.(remain, this.turnMs, this._timerMine, this._timerVis);
    if (remain > 0 || !this._timerMine || !this.myTurn()) return;
    if (this.busy) return; // mid-animation — the next tick retries
    // time's up: drop any half-done input, then end the turn
    if (this.drag) { this.drag = null; this.scene.hideGhost(); this.ui.hideArrow(); this.scene.syncFromState(this.state, this.mySide); }
    this.clearSelect();
    this.ui.toast('⏳ Time! Turn ended.');
    this.endTurn();
  }
  async concede() {
    if (this.over) return;
    await this.doAction({ type: 'concede' });
  }

  destroy() {
    this.unbindInput();
    if (this.net) { try { this.net.leave(); } catch { /* gone */ } }
    clearTimeout(this._dcTimer);
    clearInterval(this._timerIv);
    this.ui.timerSet?.(0, 1, false, false);
    this.over = true;
  }
}

function el_cursor(el, hit, match) {
  if (match.busy || !match.myTurn()) { el.style.cursor = 'default'; return; }
  if (match.select) { el.style.cursor = 'crosshair'; return; }
  if (!hit) { el.style.cursor = 'default'; return; }
  if (hit.kind === 'hand' && hit.side === 0) el.style.cursor = 'grab';
  else if (hit.kind === 'board') el.style.cursor = 'pointer';
  else el.style.cursor = 'default';
}
