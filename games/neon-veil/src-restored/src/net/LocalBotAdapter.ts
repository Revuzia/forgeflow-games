import type { KillEvent, PlayerState, TeamId, WeaponId } from '../core/types';
import type { INetAdapter } from './INetAdapter';
import { randomHandles } from './handles';


export class LocalBotAdapter implements INetAdapter {
  readonly localId = 'local';
  private players = new Map<string, PlayerState>();
  private pilotBase = 12;

  async connect(callsign: string) {
    this.players.clear();
    this.players.set(this.localId, this.makePlayer(this.localId, callsign || 'PILOT', false, 0));
    this.pilotBase = 10 + Math.floor(Math.random() * 18);
  }

  disconnect() {
    this.players.clear();
  }

  spawnBots(count: number, teamMode: boolean) {
    // Remove old bots
    for (const [id, p] of this.players) {
      if (p.isBot) this.players.delete(id);
    }
    // random pilot callsigns, new every match (owner 2026-10-13: bot names are always random)
    const local = this.players.get(this.localId);
    const names = randomHandles(count, { upper: true, maxLen: 12, avoid: local ? [local.callsign] : [] });
    for (let i = 0; i < count; i++) {
      const id = `bot-${i}`;
      const team: TeamId = teamMode ? ((i % 2) + 1) as TeamId : 0;
      const name = names[i];
      this.players.set(id, this.makePlayer(id, name, true, team));
    }
  }

  getPlayers(): PlayerState[] {
    return [...this.players.values()];
  }

  getLocal(): PlayerState {
    return this.players.get(this.localId)!;
  }

  getPlayer(id: string) {
    return this.players.get(id);
  }

  pushLocal(partial: Partial<PlayerState>) {
    const p = this.players.get(this.localId);
    if (!p) return;
    Object.assign(p, partial);
  }

  updatePlayer(id: string, partial: Partial<PlayerState>) {
    const p = this.players.get(id);
    if (!p) return;
    Object.assign(p, partial);
  }

  onKill(ev: KillEvent) {
    const killer = this.players.get(ev.killerId);
    const victim = this.players.get(ev.victimId);
    if (killer) {
      killer.kills++;
      killer.score += 100;
    }
    if (victim) {
      victim.deaths++;
      victim.alive = false;
      victim.health = 0;
    }
  }

  getPilotCount() {
    return this.pilotBase + this.players.size;
  }

  tick(_dt: number) {
    // Simulated ping jitter for display
    for (const p of this.players.values()) {
      if (p.isBot) p.ping = 20 + Math.floor(Math.random() * 40);
      else p.ping = 12 + Math.floor(Math.random() * 8);
    }
  }

  private makePlayer(id: string, callsign: string, isBot: boolean, team: TeamId): PlayerState {
    return {
      id,
      callsign,
      team,
      position: [0, 40, 0],
      rotation: [0, 0, 0, 1],
      velocity: [0, 0, 0],
      health: 100,
      shield: 100,
      shieldDeployed: false,
      weapon: 'plasma' as WeaponId,
      kills: 0,
      deaths: 0,
      score: 0,
      alive: true,
      isBot,
      ping: isBot ? 30 : 15,
    };
  }
}
