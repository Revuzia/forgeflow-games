/* Grid Rush — modes/battle-arena.js — "DATA DUEL"
 * Arena = the active circuit's closed ribbon (walls = projectRacer lateral clamp);
 * NO laps. Offensive gadgets drain shields; 0 shields = KO. Win = last standing
 * (survival) or most KOs before the clock (kos).
 * Registry contract (adapted to the shipped factory pattern, see grand-prix.js /
 * time-trial.js):
 *   usesLaps = false                       → game skips laps/checkpoints/LAP HUD, freezes KO'd karts
 *   onRaceStart(game)                      → init shields/KO/timer, inject HUD, banner
 *   update / onGadgetHit / hudExtra        → regen/respawn/well-crush, shield damage, HUD
 *   isOver(game)                           → per-frame match-over decider (NOT checkEnd — GP owns that)
 *   results(game) / teardown(game)         → custom results panel; remove HUD, restore LAP inst
 */

const BATTLE = Object.freeze({
  SHIELD_MAX: 3,
  KO_DOWN_TIME: 4.0, // s knocked out before respawn (kos rules)
  SPAWN_GRACE: 2.2, // s invulnerable after (re)spawn
  REGEN_TIME: 8.0, // s hit-free to regen +1 shield (kos rules; 0 = disabled)
  MATCH_TIME: 120, // s match length (kos rules)
  WELL_CRUSH_FRAC: 0.42, // inner fraction of a gravity well that crushes a shield
  WELL_HIT_CD: 1.2, // s per-racer cooldown between well crush ticks
  DEFAULT_RULES: 'kos', // 'kos' | 'survival'
  SHIELD_DMG: { pulse_mine: 1, volt_lash: 1, emp_bloom: 1, gravity_well: 1, mirror_fog: 0 },
});

const HUD_ID = 'gr-battle-hud';
const STYLE_ID = 'gr-battle-style';

function ord(n) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}
function pips(cur, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < cur ? '▮' : '▯';
  return s;
}
function fmtClock(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createBattle() {
  return {
    id: 'battle',
    usesLaps: false,
    // rivalCount intentionally unset → game falls back to RIVAL_COUNT (6-kart arena).

    rules: BATTLE.DEFAULT_RULES,
    matchTime: BATTLE.MATCH_TIME,
    over: false,
    winner: null,
    koFeed: [],
    _flash: 0,
    _hud: null,
    _lapInst: null,

    // ── lifecycle ──────────────────────────────────────────────────────────
    onRaceStart(game) {
      this.rules = game.battleRules === 'survival' ? 'survival' : BATTLE.DEFAULT_RULES;
      this.matchTime = BATTLE.MATCH_TIME;
      this.over = false;
      this.winner = null;
      this.koFeed = [];
      this._flash = 0;

      for (const r of game.racers) this._initRacer(r);

      if (game.els.banner) {
        const arena = game.track?.def?.name || 'ARENA';
        const label = this.rules === 'survival' ? 'LAST STANDING' : `MOST KOs · ${fmtClock(this.matchTime)}`;
        game.els.banner.textContent = `DATA DUEL · ${arena} · ${label}`;
      }
      this._lapInst = game.els.lap?.closest?.('.inst') || null;
      if (this._lapInst) this._lapInst.style.display = 'none';

      this._injectHud(game);
    },

    teardown(game) {
      if (this._lapInst) this._lapInst.style.display = '';
      this._lapInst = null;
      document.getElementById(HUD_ID)?.remove();
      this._hud = null;
    },

    _initRacer(r) {
      r.maxShield = BATTLE.SHIELD_MAX;
      r.shield = BATTLE.SHIELD_MAX;
      r.kos = 0;
      r.timesKO = 0;
      r.koState = 'active';
      r.downTimer = 0;
      r.hitFreeT = 0;
      r.spawnGrace = BATTLE.SPAWN_GRACE;
      r._wellCd = 0;
      r.alive = true;
      r.finished = false;
    },

    // ── per-frame ──────────────────────────────────────────────────────────
    update(game, dt) {
      if (this.over) return;
      this._flash = Math.max(0, this._flash - dt);

      for (const r of game.racers) {
        r.spawnGrace = Math.max(0, r.spawnGrace - dt);
        r._wellCd = Math.max(0, r._wellCd - dt);

        if (r.koState === 'down') {
          r.downTimer -= dt;
          if (r.downTimer <= 0) this._respawn(game, r);
          continue;
        }
        if (r.koState !== 'active') continue;

        // Shield regen (kos rules only): hit-free for REGEN_TIME → +1 shield.
        if (this.rules === 'kos' && BATTLE.REGEN_TIME > 0 && r.shield < r.maxShield) {
          r.hitFreeT += dt;
          if (r.hitFreeT >= BATTLE.REGEN_TIME) {
            r.shield += 1;
            r.hitFreeT = 0;
            if (r.isPlayer) game.flashToast(`SHIELD +1 · ${r.shield}/${r.maxShield}`);
          }
        }
      }

      // Gravity-well crush: read itemWorld directly (no event exists for wells).
      for (const e of game.itemWorld?.entities || []) {
        if (e.type !== 'gravity_well' || !e.pos) continue;
        const crushR = e.radius * BATTLE.WELL_CRUSH_FRAC;
        for (const r of game.racers) {
          if (r.koState !== 'active' || r.spawnGrace > 0 || r._wellCd > 0) continue;
          if (r.id === e.ownerId) continue;
          if (r.position.distanceTo(e.pos) < crushR) {
            r._wellCd = BATTLE.WELL_HIT_CD;
            this.onGadgetHit(game, r, e.ownerId, 'gravity_well');
          }
        }
      }
    },

    // ── shield damage ──────────────────────────────────────────────────────
    onGadgetHit(game, victim, attackerId, kind) {
      if (!victim || victim.koState !== 'active' || victim.spawnGrace > 0) return;
      const dmg = BATTLE.SHIELD_DMG[kind] ?? 1;
      if (dmg <= 0) return;

      victim.shield -= dmg;
      victim.hitFreeT = 0;
      game.fx.burst(victim.position, 0xff2bd6, 8, 10);
      if (victim.isPlayer) {
        game.fx.addShake(0.28);
        this._flash = 0.4;
      }

      if (victim.shield <= 0) this._ko(game, victim, attackerId);
      else if (victim.isPlayer) game.flashToast(`SHIELD ${victim.shield}/${victim.maxShield}`);
    },

    _ko(game, victim, attackerId) {
      victim.shield = 0;
      victim.timesKO += 1;
      const attacker = game.racers.find((x) => x.id === attackerId);
      if (attacker && attacker !== victim && attacker.koState !== 'out') attacker.kos += 1;
      this.koFeed.unshift({ by: attacker?.callsign || 'ARENA', who: victim.callsign, t: 3.2 });
      this.koFeed.length = Math.min(this.koFeed.length, 4);

      game.fx.burst(victim.position, victim.vehicle.color, 26, 18);
      game.fx.empRing(victim.position, 0xffe566);
      if (victim.isPlayer || attacker?.isPlayer) game.fx.addShake(0.5);
      game.sfx.hit?.();

      victim.alive = false;
      victim.velocity.set(0, 0, 0);
      victim.speed = 0;
      victim.item = null;

      if (victim.isPlayer) game.flashToast('KNOCKED OUT');
      else if (attacker?.isPlayer) game.flashToast(`KO → ${victim.callsign}`);

      if (this.rules === 'survival') {
        victim.koState = 'out';
        victim.finished = true;
        victim.finishTime = game.raceTime;
      } else {
        victim.koState = 'down';
        victim.downTimer = BATTLE.KO_DOWN_TIME;
      }
    },

    _respawn(game, victim) {
      const samp = game.track.sampleAt(victim.trackS);
      victim.position.copy(samp.pos);
      victim.position.y = samp.pos.y + 1.15;
      victim._lastS = samp.s;
      victim.yaw = Math.atan2(samp.tangent.x, samp.tangent.z);
      victim.velocity.set(0, 0, 0);
      victim.speed = 0;
      victim.shield = victim.maxShield;
      victim.koState = 'active';
      victim.alive = true;
      victim.spawnGrace = BATTLE.SPAWN_GRACE;
      victim.hitFreeT = 0;
      victim.stun = 0;
      victim.airborne = false;
      victim.hopY = 0;
      victim.vy = 0;
      game.fx.burst(victim.position, 0x39ff88, 16, 12);
      if (victim.isPlayer) game.flashToast('RESPAWN');
    },

    // ── end + results ───────────────────────────────────────────────────────
    // NOTE: named isOver (per-frame decider) not checkEnd — game.js reserves
    // checkEnd for Grand Prix's post-race scoring notification.
    isOver(game) {
      if (this.over) return true;
      const aliveN = game.racers.filter((r) => r.koState !== 'out').length;

      if (this.rules === 'survival') {
        const playerOut = game.player && game.player.koState === 'out';
        if (aliveN <= 1 || playerOut) {
          this.over = true;
          this.winner = this._standings(game)[0];
          return true;
        }
        return false;
      }
      if (game.raceTime >= this.matchTime) {
        this.over = true;
        this.winner = this._standings(game)[0];
        return true;
      }
      return false;
    },

    _standings(game) {
      return [...game.racers].sort((a, b) => {
        const ao = a.koState === 'out',
          bo = b.koState === 'out';
        if (ao !== bo) return ao ? 1 : -1;
        if (ao && bo) return (b.finishTime || 0) - (a.finishTime || 0);
        if (b.kos !== a.kos) return b.kos - a.kos;
        if (a.timesKO !== b.timesKO) return a.timesKO - b.timesKO;
        return b.shield - a.shield;
      });
    },

    // Renders directly into the results panel (matches the refreshResults delegate).
    results(game) {
      const rank = this._standings(game);
      const place = rank.findIndex((r) => r.id === game.player.id) + 1;
      const won = place === 1;
      const title = won ? 'GRID CROWN — DUEL WON' : `DATA DUEL · ${ord(place)} of ${rank.length}`;
      const rows = rank.map((r, i) => {
        const me = r.id === game.player.id ? ' style="color:#00f0ff"' : '';
        const out = r.koState === 'out' ? ' · OUT' : '';
        return `<div${me}>${i + 1}. ${r.callsign} — ${r.kos} KO · ${pips(Math.max(0, r.shield), r.maxShield)}${out} · ${r.vehicle.name}</div>`;
      });
      if (game.els.resultsTitle) game.els.resultsTitle.textContent = title;
      if (game.els.resultsStats) game.els.resultsStats.innerHTML = rows.join('');
    },

    // ── HUD ──────────────────────────────────────────────────────────────────
    _injectHud(game) {
      if (!document.getElementById(STYLE_ID)) {
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = `
        #${HUD_ID}{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:8;
          display:flex;flex-direction:column;align-items:center;gap:.3rem;pointer-events:none;
          font-family:var(--font-display,"Orbitron",sans-serif);text-align:center;}
        #${HUD_ID} .bt-timer{font-size:1.5rem;font-weight:800;letter-spacing:.1em;color:#e8f7ff;
          text-shadow:0 0 12px #00f0ff88;}
        #${HUD_ID} .bt-stat{display:flex;gap:1.1rem;align-items:center;font-size:.8rem;letter-spacing:.08em;}
        #${HUD_ID} .bt-pips{font-size:1.05rem;letter-spacing:.12em;color:#00f0ff;text-shadow:0 0 8px #00f0ff;}
        #${HUD_ID} .bt-pips.hit{color:#ff2bd6;text-shadow:0 0 12px #ff2bd6;}
        #${HUD_ID} .bt-ko{color:#ffe566;}
        #${HUD_ID} .bt-feed{display:flex;flex-direction:column;gap:.15rem;font-family:var(--font-mono,"Share Tech Mono",monospace);
          font-size:.62rem;color:#c8dcffcc;letter-spacing:.04em;min-height:1.2em;}`;
        document.head.appendChild(s);
      }
      const host = game.els.hud || document.getElementById('hud');
      if (!host) return;
      // Reuse an existing panel — createBattle() makes a fresh object per race.
      let el = document.getElementById(HUD_ID);
      if (!el) {
        el = document.createElement('div');
        el.id = HUD_ID;
        el.innerHTML =
          '<div class="bt-timer" data-bt="timer">0:00</div>' +
          '<div class="bt-stat"><span class="bt-pips" data-bt="pips">▮▮▮</span>' +
          '<span class="bt-ko" data-bt="ko">KO ×0</span></div>' +
          '<div class="bt-feed" data-bt="feed"></div>';
        host.appendChild(el);
      }
      this._hud = {
        timer: el.querySelector('[data-bt="timer"]'),
        pips: el.querySelector('[data-bt="pips"]'),
        ko: el.querySelector('[data-bt="ko"]'),
        feed: el.querySelector('[data-bt="feed"]'),
      };
    },

    hudExtra(game) {
      const p = game.player;
      if (!p || !this._hud) return;

      // Timer / mode line
      if (this.rules === 'survival') {
        const aliveN = game.racers.filter((r) => r.koState !== 'out').length;
        this._hud.timer.textContent = `SURVIVAL · ${aliveN} LEFT`;
      } else {
        this._hud.timer.textContent = fmtClock(this.matchTime - game.raceTime);
      }

      // Player shields + KO
      this._hud.pips.textContent = pips(Math.max(0, p.shield), p.maxShield);
      this._hud.pips.classList.toggle('hit', this._flash > 0);
      this._hud.pips.style.color = this._flash > 0 ? '' : `#${(p.vehicle.color >>> 0).toString(16).padStart(6, '0')}`;
      this._hud.ko.textContent = `KO ×${p.kos}`;

      // KO feed (expiring)
      for (const f of this.koFeed) f.t -= 1 / 60;
      this.koFeed = this.koFeed.filter((f) => f.t > 0);
      this._hud.feed.innerHTML = this.koFeed.map((f) => `${f.by} ▸ ${f.who}`).join('<br>');

      // Standings list (override the default leader paint for battle)
      if (game.els.leaders) {
        const rank = this._standings(game);
        game.els.leaders.innerHTML = rank
          .map((r, i) => {
            const me = r.id === p.id ? ' me' : '';
            const dim = r.koState === 'out' ? ' style="opacity:.45"' : '';
            return `<div class="${me}"${dim}><span class="pos">${i + 1}</span>${r.callsign} ${pips(Math.max(0, r.shield), r.maxShield)} ×${r.kos}</div>`;
          })
          .join('');
      }
    },
  };
}
