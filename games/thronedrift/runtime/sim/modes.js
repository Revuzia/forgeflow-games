// Thronedrift — game modes. CampaignMode preserves the wave-survival flow;
// the versus modes (FFA / Duel Bo3 / Teams 2v2) run champions against each
// other with respawns or rounds, scoreboards, and local stat recording.

import { BOARD_RADIUS } from "../data/arenas.js";
import { SFX } from "../core/audio.js";
import { Music } from "../core/music.js";
import { formatScore, save, rand } from "../core/util.js";

export class Mode {
  constructor() { this.usesWaves = false; }
  setup(game) {}
  update(dt) {}
  onDeath(victim, attacker) {}
  onLeave() {}                                  // local player quit mid-match
  /** evenly spaced spawn ring, index-stable */
  spawnPoint(i, n) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 4;
    const r = BOARD_RADIUS * 0.62;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
}

// ── CAMPAIGN — the existing wave-survival flow ─────────────────────────────
export class CampaignMode extends Mode {
  constructor() { super(); this.usesWaves = true; }
  onDeath(victim, attacker) {
    victim.die();
    this.game.gameOver();
  }
  setup(game) { this.game = game; }
}

// ── shared versus machinery ────────────────────────────────────────────────
class VersusMode extends Mode {
  constructor({ modeId, roster, killTarget = 0, rounds = 0, timeLimit = 0 }) {
    super();
    this.modeId = modeId;
    this.roster = roster;                       // [{classId, controller, team, isLocal, name}]
    this.killTarget = killTarget;
    this.roundsToWin = rounds;
    this.timeLimit = timeLimit;
    this.roundWins = {};                        // team → rounds won
    this.roundNum = 1;
    this.matchT = 0;
    this.over = false;
  }

  setup(game) {
    this.game = game;
    game.roundLive = false;
    const n = this.roster.length;
    this.roster.forEach((r, i) => {
      const c = game.addChampion(r);
      const p = this.spawnPoint(i, n);
      c.x = p.x; c.z = p.z;
      c.facing = Math.atan2(-p.z, -p.x);        // face center
    });
    game.hud.setMatchStatus(this.statusText(), this.subText(), "#ffd24a");
    this.countdown(3, () => { game.roundLive = true; game.hud.banner("FIGHT!", { color: "#ff6a4a", dur: 1.0, size: 60 }); SFX.play("wave_clear"); });
  }

  countdown(n, done) {
    const g = this.game;
    if (n <= 0) { done(); return; }
    g.hud.banner(String(n), { color: "#ffd24a", dur: 0.85, size: 72 });
    SFX.play("ui_big");
    g.after(1, () => this.countdown(n - 1, done));
  }

  statusText() { return ""; }
  subText() { return ""; }

  killFeed(victim, attacker) {
    const g = this.game;
    const who = attacker ? attacker.name : "The arena";
    g.hud.toast(`${who} ⚔ ${victim.name}`, attacker && attacker.isLocal ? "#7dff9a" : "#ff9ab0");
    if (attacker) {
      attacker.kills++;
      attacker.score += 500;
      if (attacker.isLocal) g.hud.setScore(attacker.score);
    }
  }

  updateBoards() {
    const g = this.game;
    g.hud.setMatchStatus(this.statusText(), this.subText(), "#ffd24a");
    g.hud.setScoreboard(g.champions, this.modeId, this.roundWins);
  }

  finish(winnerLabel, winnerTeam) {
    if (this.over) return;
    this.over = true;
    const g = this.game;
    g.roundLive = false;
    g.state = "arenaclear";
    g.input.enabled = false;
    const local = g.local;
    const won = winnerTeam != null ? local.team === winnerTeam : false;
    SFX.play(won ? "victory" : "game_over");
    Music.play("menu");
    recordMatch(this.modeId, local, won);
    const rows = [...g.champions].sort((a, b) => b.kills - a.kills).map((c) =>
      `<div style="display:flex;justify-content:space-between;gap:18px;font-size:14px;${c.isLocal ? "color:#ffd24a;font-weight:800" : "color:#cbbfe0"}">
        <span>${c.isLocal ? "➤ " : ""}${c.name} <span style="opacity:.6">(${c.cls.name})</span></span>
        <span>⚔ ${c.kills} · 💀 ${c.deaths} · ${Math.round(c.dmgDealt)} dmg</span></div>`).join("");
    g.hud.panel({
      title: won ? "VICTORY!" : `${winnerLabel} WINS`,
      titleColor: won ? "#ffd24a" : "#ff9ab0",
      lines: [rows],
      buttons: [
        { label: "REMATCH", fn: () => g.startVersus(this.modeId, local.classId, g.arenaIdx) },
        { label: "CHANGE MODE", fn: () => { g.toMenu(); g.hud.showVersusModes(local.classId); } },
        { label: "MENU", fn: () => g.toMenu() },
      ],
    });
  }

  onLeave() { this.over = true; }
}

// ── FFA — 5 champions, respawns, first to killTarget ───────────────────────
export class FfaMode extends VersusMode {
  constructor(roster) { super({ modeId: "ffa", roster, killTarget: 10, timeLimit: 300 }); }
  statusText() { const best = Math.max(0, ...(this.game?.champions || []).map((c) => c.kills)); return `FFA · FIRST TO ${this.killTarget} (top ${best})`; }
  subText() { const t = Math.max(0, this.timeLimit - this.matchT); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; }

  onDeath(victim, attacker) {
    victim.die();
    this.killFeed(victim, attacker);
    victim.respawnT = 3;
    if (victim.isLocal && attacker) this.game.cameraTarget = attacker;   // spectate your killer
    this.updateBoards();
    if (attacker && attacker.kills >= this.killTarget) this.finish(attacker.name, attacker.team);
  }

  update(dt) {
    if (this.over) return;
    this.matchT += dt;
    const g = this.game;
    for (const c of g.champions) {
      if (!c.dead || c.respawnT <= 0) continue;
      c.respawnT -= dt;
      if (c.respawnT <= 0) {
        // farthest spawn from living hostiles
        let best = null, bd = -1;
        for (let i = 0; i < 8; i++) {
          const p = this.spawnPoint(i, 8);
          let nd = 1e9;
          for (const o of g.champions) if (!o.dead && o !== c) nd = Math.min(nd, (o.x - p.x) ** 2 + (o.z - p.z) ** 2);
          if (nd > bd) { bd = nd; best = p; }
        }
        c.respawn(best.x, best.z);
      }
    }
    if (Math.floor(this.matchT * 2) !== Math.floor((this.matchT - dt) * 2)) this.updateBoards();
    if (this.matchT >= this.timeLimit) {
      const top = [...g.champions].sort((a, b) => b.kills - a.kills)[0];
      this.finish(top.name, top.team);
    }
  }
}

// ── rounds base (duel + teams) ─────────────────────────────────────────────
class RoundsMode extends VersusMode {
  roundOver(winnerTeam, label) {
    const g = this.game;
    if (this.over || this.roundResetting) return;
    this.roundResetting = true;
    g.roundLive = false;
    this.roundWins[winnerTeam] = (this.roundWins[winnerTeam] || 0) + 1;
    g.hud.banner(`ROUND ${this.roundNum} — ${label}`, { color: "#ffd24a", dur: 2.0, size: 44 });
    this.updateBoards();
    if (this.roundWins[winnerTeam] >= this.roundsToWin) {
      g.after(1.6, () => this.finish(label, winnerTeam));
      return;
    }
    g.after(2.2, () => {
      this.roundNum++;
      // full round reset: transient world state + champions to spawn points
      g.clearTransient();
      const n = g.champions.length;
      g.champions.forEach((c, i) => {
        const p = this.spawnPoint(i, n);
        c.respawn(p.x, p.z);
        c.facing = Math.atan2(-p.z, -p.x);
        c.kills = c.kills;                     // kills persist across rounds
      });
      this.roundResetting = false;
      this.countdown(3, () => { g.roundLive = true; g.hud.banner("FIGHT!", { color: "#ff6a4a", dur: 1.0, size: 60 }); });
    });
  }

  onDeath(victim, attacker) {
    victim.die();
    this.killFeed(victim, attacker);
    this.updateBoards();
    const g = this.game;
    const aliveTeams = new Set(g.champions.filter((c) => !c.dead).map((c) => c.team));
    if (aliveTeams.size === 1) {
      const t = [...aliveTeams][0];
      const label = this.teamLabel(t);
      this.roundOver(t, label);
    }
  }

  teamLabel(t) {
    const members = this.game.champions.filter((c) => c.team === t);
    return members.length === 1 ? members[0].name : (members.some((c) => c.isLocal) ? "YOUR TEAM" : "ENEMY TEAM");
  }
}

// ── DUEL — 1v1, best of 3 ──────────────────────────────────────────────────
export class DuelMode extends RoundsMode {
  constructor(roster) { super({ modeId: "duel", roster, rounds: 2 }); }
  statusText() { return `DUEL · BEST OF 3 · ROUND ${this.roundNum}`; }
  subText() {
    const w = this.roundWins;
    const mine = this.game ? (w[this.game.local.team] || 0) : 0;
    const theirs = Object.entries(w).filter(([t]) => this.game && t !== this.game.local.team).reduce((s, [, v]) => s + v, 0);
    return `You ${mine} — ${theirs} Them`;
  }
}

// ── TEAMS — 2v2, best of 3 team wipes ──────────────────────────────────────
export class TeamsMode extends RoundsMode {
  constructor(roster) { super({ modeId: "teams", roster, rounds: 2 }); }
  statusText() { return `2v2 · BEST OF 3 · ROUND ${this.roundNum}`; }
  subText() { return this.game ? `${this.roundWins.A || 0} — ${this.roundWins.B || 0}` : ""; }
  spawnPoint(i, n) {
    // teams spawn on opposite sides, teammates adjacent
    const side = this.roster[i].team === "A" ? 0 : Math.PI;
    const off = (i % 2 === 0 ? -0.35 : 0.35);
    const a = side + off;
    const r = BOARD_RADIUS * 0.62;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
}

// ── local stats / leaderboards ─────────────────────────────────────────────
export function recordMatch(modeId, local, won) {
  const s = save.get("pvp_stats", { modes: {}, classes: {}, records: [] });
  const m = s.modes[modeId] = s.modes[modeId] || { games: 0, wins: 0 };
  m.games++; if (won) m.wins++;
  const c = s.classes[local.classId] = s.classes[local.classId] || { games: 0, wins: 0, kills: 0, dmg: 0 };
  c.games++; if (won) c.wins++;
  c.kills += local.kills; c.dmg += Math.round(local.dmgDealt);
  s.records.unshift({
    at: new Date().toISOString().slice(0, 16).replace("T", " "),
    mode: modeId, cls: local.classId, kills: local.kills, deaths: local.deaths,
    dmg: Math.round(local.dmgDealt), won,
  });
  s.records = s.records.slice(0, 50);
  save.set("pvp_stats", s);
}
