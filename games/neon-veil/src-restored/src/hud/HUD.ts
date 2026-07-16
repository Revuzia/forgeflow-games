import type { PlayerState, WeaponId } from '../core/types';
import { WEAPONS } from '../core/config';

export class HUD {
  private els = {
    hud: document.getElementById('hud')!,
    alt: document.getElementById('hud-alt')!,
    speed: document.getElementById('hud-speed')!,
    time: document.getElementById('hud-time')!,
    weapon: document.getElementById('hud-weapon')!,
    ammo: document.getElementById('hud-ammo')!,
    leaders: document.getElementById('hud-leaders')!,
    health: document.getElementById('bar-health') as HTMLElement,
    healthN: document.getElementById('bar-health-n')!,
    shield: document.getElementById('bar-shield') as HTMLElement,
    shieldN: document.getElementById('bar-shield-n')!,
    burn: document.getElementById('bar-burn') as HTMLElement,
    burnN: document.getElementById('bar-burn-n')!,
    shieldPrompt: document.getElementById('shield-prompt')!,
    hitMarker: document.getElementById('hit-marker')!,
    killFeed: document.getElementById('kill-feed')!,
    modeBanner: document.getElementById('mode-banner')!,
    help: document.getElementById('help-card')!,
    scoreboard: document.getElementById('scoreboard')!,
    sbBody: document.getElementById('sb-body')!,
    death: document.getElementById('death')!,
    deathSub: document.getElementById('death-sub')!,
    damageVignette: document.getElementById('damage-vignette')!,
    clickToPlay: document.getElementById('click-to-play')!,
    ctpTitle: document.getElementById('ctp-title'),
    ctpSub: document.getElementById('ctp-sub'),
    ctpHint: document.getElementById('ctp-hint'),
    radar: document.getElementById('radar-canvas') as HTMLCanvasElement,
    debug: document.getElementById('debug-panel'),
    debugText: document.getElementById('debug-text'),
    biomeToast: document.getElementById('biome-toast'),
    lockBox: document.getElementById('missile-lock'),
    lockLabel: document.getElementById('missile-lock-label'),
    lockFill: document.getElementById('missile-lock-fill'),
  };

  private radarCtx: CanvasRenderingContext2D;
  private helpVisible = true;
  private debugVisible = false;

  constructor() {
    this.radarCtx = this.els.radar.getContext('2d')!;
  }

  show(on: boolean) {
    this.els.hud.classList.toggle('hidden', !on);
    if (on) this.els.help.classList.toggle('hidden', !this.helpVisible);
  }

  /**
   * Flight gate panel.
   * - engage: simple "click to fly" only (first launch / pointer drop)
   * - pause: full Esc menu (Resume · Settings · Main Menu)
   */
  setClickToPlay(on: boolean, mode: 'engage' | 'pause' = 'pause') {
    this.els.clickToPlay.classList.toggle('hidden', !on);
    this.els.clickToPlay.classList.toggle('mode-engage', mode === 'engage');
    this.els.clickToPlay.classList.toggle('mode-pause', mode === 'pause');

    const resumeBtn = document.getElementById('btn-resume');
    const keysEl = document.getElementById('ctp-keys');

    if (this.els.ctpTitle) {
      this.els.ctpTitle.textContent = mode === 'engage' ? 'CLICK TO ENGAGE' : 'PAUSED';
    }
    if (this.els.ctpSub) {
      this.els.ctpSub.textContent =
        mode === 'engage'
          ? 'Click or Enter to take the stick'
          : 'Esc resume · Settings · Main Menu';
    }
    if (resumeBtn) {
      resumeBtn.textContent = mode === 'engage' ? 'CLICK TO FLY' : 'RESUME';
    }
    if (keysEl) {
      keysEl.textContent =
        mode === 'engage'
          ? 'Enter / Click · WASD fly · LMB fire · Esc pause · M mute'
          : 'Enter / Click Resume · Esc resume · M mute · Settings / Menu below';
    }
    if (on) {
      try {
        resumeBtn?.focus({ preventScroll: true });
      } catch {
        try {
          this.els.clickToPlay.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    }
  }

  isPauseOpen() {
    return !this.els.clickToPlay.classList.contains('hidden');
  }

  setEngageHint(text: string | null) {
    if (!this.els.ctpHint) return;
    this.els.ctpHint.textContent = text ?? '';
    this.els.ctpHint.classList.toggle('hidden', !text);
  }

  setModeBanner(text: string) {
    this.els.modeBanner.textContent = text;
  }

  toggleHelp() {
    this.helpVisible = !this.helpVisible;
    this.els.help.classList.toggle('hidden', !this.helpVisible);
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.els.debug?.classList.toggle('hidden', !this.debugVisible);
    return this.debugVisible;
  }

  setDebugVisible(on: boolean) {
    this.debugVisible = on;
    this.els.debug?.classList.toggle('hidden', !on);
  }

  isDebugVisible() {
    return this.debugVisible;
  }

  updateDebug(lines: string[]) {
    if (!this.els.debugText || !this.debugVisible) return;
    this.els.debugText.textContent = lines.join('\n');
  }

  showBiomeToast(name: string) {
    this.flashToast(`ENTERING  ${name}`, this.els.biomeToast);
  }

  showPickupToast(text: string) {
    this.flashToast(text, this.els.biomeToast);
  }

  private flashToast(text: string, el: HTMLElement | null) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden', 'fade');
    void el.offsetWidth;
    el.classList.add('show');
    window.setTimeout(() => {
      el.classList.add('fade');
      window.setTimeout(() => el.classList.add('hidden'), 600);
    }, 1600);
  }

  showScoreboard(on: boolean, players: PlayerState[], localId: string) {
    this.els.scoreboard.classList.toggle('hidden', !on);
    if (!on) return;
    const sorted = [...players].sort((a, b) => b.score - a.score || b.kills - a.kills);
    this.els.sbBody.innerHTML = sorted
      .map((p, i) => {
        const me = p.id === localId ? ' class="me"' : '';
        return `<tr${me}><td>${i + 1}</td><td>${esc(p.callsign)}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.score}</td><td>${p.ping}</td></tr>`;
      })
      .join('');
  }

  showDeath(on: boolean, sub = 'Respawning…') {
    this.els.death.classList.toggle('hidden', !on);
    this.els.deathSub.textContent = sub;
  }

  flashHit() {
    this.els.hitMarker.classList.remove('hidden', 'show');
    void this.els.hitMarker.offsetWidth;
    this.els.hitMarker.classList.add('show');
    setTimeout(() => this.els.hitMarker.classList.add('hidden'), 180);
  }

  flashDamage() {
    this.els.damageVignette.classList.add('flash');
    setTimeout(() => this.els.damageVignette.classList.remove('flash'), 160);
  }

  pushKill(killer: string, victim: string, weapon: string) {
    const line = document.createElement('div');
    line.className = 'kill-line';
    line.textContent = `${killer}  [${weapon}]  ${victim}`;
    this.els.killFeed.prepend(line);
    while (this.els.killFeed.children.length > 5) {
      this.els.killFeed.lastChild?.remove();
    }
    setTimeout(() => line.remove(), 5000);
  }

  updateFlight(alt: number, speedMs: number, timeSec: number, energy: number, health: number, shield: number, shieldReady: boolean) {
    this.els.alt.innerHTML = `${pad3(Math.round(alt))}<span class="unit">m</span>`;
    const kmh = Math.round(speedMs * 3.6);
    this.els.speed.innerHTML = `${pad3(kmh)}<span class="unit">km/h</span>`;
    this.els.time.textContent = formatTime(timeSec);
    this.els.health.style.width = `${clamp01(health / 100) * 100}%`;
    this.els.healthN.textContent = String(Math.round(health));
    this.els.shield.style.width = `${clamp01(shield / 100) * 100}%`;
    this.els.shieldN.textContent = String(Math.round(shield));
    this.els.burn.style.width = `${clamp01(energy / 100) * 100}%`;
    this.els.burnN.textContent = String(Math.round(energy));
    this.els.shieldPrompt.classList.toggle('hidden', !shieldReady);
  }

  updateWeapon(id: WeaponId, ammo: number) {
    const def = WEAPONS[id];
    this.els.weapon.textContent = def.name;
    this.els.ammo.textContent = ammo < 0 ? '∞' : String(ammo);
  }

  /**
   * Red heat-seek latch UI. phase: off | seeking | locking | locked
   * screenX/Y in CSS pixels when tracking a target.
   */
  updateMissileLock(
    on: boolean,
    phase: 'off' | 'seeking' | 'locking' | 'locked',
    progress: number,
    screen?: { x: number; y: number } | null
  ) {
    const box = this.els.lockBox;
    if (!box) return;
    if (!on || phase === 'off') {
      box.classList.add('hidden');
      box.classList.remove('locking', 'locked', 'seeking');
      return;
    }
    box.classList.remove('hidden');
    box.classList.toggle('seeking', phase === 'seeking');
    box.classList.toggle('locking', phase === 'locking');
    box.classList.toggle('locked', phase === 'locked');
    if (this.els.lockFill) {
      const p = Math.round(Math.max(0, Math.min(1, progress)) * 100);
      this.els.lockFill.style.width = `${p}%`;
    }
    if (this.els.lockLabel) {
      this.els.lockLabel.textContent =
        phase === 'locked' ? 'LOCK' : phase === 'locking' ? 'LOCKING…' : 'SEEK';
    }
    if (screen) {
      box.style.left = `${screen.x}px`;
      box.style.top = `${screen.y}px`;
      box.style.transform = 'translate(-50%, -50%)';
    } else {
      // Center soft seek box on reticle
      box.style.left = '50%';
      box.style.top = '48%';
      box.style.transform = 'translate(-50%, -50%)';
    }
  }

  updateLeaders(players: PlayerState[], localId: string) {
    const sorted = [...players].sort((a, b) => b.score - a.score || b.kills - a.kills).slice(0, 4);
    this.els.leaders.innerHTML = sorted
      .map((p, i) => {
        const cls = p.id === localId ? 'me' : '';
        return `<div class="${cls}">${i + 1}. ${esc(p.callsign)}  ${p.score}</div>`;
      })
      .join('');
  }

  drawRadar(
    playerPos: { x: number; z: number },
    playerYaw: number,
    blips: Array<{ x: number; z: number; friendly: boolean; isPlayer?: boolean }>,
    range: number
  ) {
    const ctx = this.radarCtx;
    const w = this.els.radar.width;
    const h = this.els.radar.height;
    const cx = w / 2;
    const cy = h / 2;
    const R = w / 2 - 4;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 20, 40, 0.75)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Rings
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    for (const f of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Forward line
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - R);
    ctx.stroke();

    const cos = Math.cos(-playerYaw);
    const sin = Math.sin(-playerYaw);

    for (const b of blips) {
      let dx = b.x - playerPos.x;
      let dz = b.z - playerPos.z;
      // Rotate into player space
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      let px = (rx / range) * R;
      let py = (-rz / range) * R;
      const len = Math.hypot(px, py);
      if (len > R - 3) {
        px = (px / len) * (R - 3);
        py = (py / len) * (R - 3);
      }
      ctx.fillStyle = b.isPlayer ? '#00f0ff' : b.friendly ? '#39ff88' : '#ff2bd6';
      ctx.beginPath();
      ctx.arc(cx + px, cy + py, b.isPlayer ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function pad3(n: number) {
  return String(Math.max(0, n)).padStart(3, '0');
}

function formatTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
