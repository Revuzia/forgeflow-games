import type { GameMode, MapId, Settings } from '../core/types';
import type { SessionConfig } from '../core/types';
import { FREEROAM, MULTIPLAYER } from '../core/config';

export class Menu {
  private root = document.getElementById('menu')!;
  private callsign = document.getElementById('callsign') as HTMLInputElement;
  private pilotCount = document.getElementById('pilot-count')!;
  private status = document.getElementById('menu-status');
  private mapId: MapId = 'sky-city';
  private onStart: ((cfg: SessionConfig) => void) | null = null;
  private onSettings: (() => void) | null = null;
  private starting = false;

  constructor() {
    const saved = localStorage.getItem('neonveil_callsign');
    if (saved) this.callsign.value = saved;

    document.querySelectorAll('.mode-btn[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as GameMode;
        this.start(mode);
      });
    });

    document.querySelectorAll('.map-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.map-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.mapId = (btn as HTMLElement).dataset.map as MapId;
      });
    });

    document.getElementById('btn-settings-menu')?.addEventListener('click', () => {
      this.onSettings?.();
    });

    // Show realistic lobby size (you + rivals), small jitter — not a fake global MMO count
    const base = 1 + MULTIPLAYER.botCount;
    const refreshPilots = () => {
      const n = base + Math.floor(Math.random() * 3) - 1; // e.g. 12–14 when botCount=12
      this.pilotCount.textContent = String(Math.max(base - 1, n));
    };
    setInterval(refreshPilots, 4000);
    refreshPilots();
    this.setStatus(
      `SELECT A MODE · FFA ${1 + MULTIPLAYER.botCount}/SECTOR · ROAM ${1 + FREEROAM.rivalCount}/SECTOR · 2× ARENAS · RINGS = TRAVEL`
    );
  }

  onStartGame(cb: (cfg: SessionConfig) => void) {
    this.onStart = cb;
  }

  onOpenSettings(cb: () => void) {
    this.onSettings = cb;
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
    if (on) this.starting = false;
  }

  setStatus(text: string) {
    if (this.status) this.status.textContent = text;
  }

  private start(mode: GameMode) {
    if (this.starting) return;
    if (!this.onStart) {
      this.setStatus('ENGINE NOT READY — REFRESH PAGE');
      return;
    }
    this.starting = true;
    const callsign = (this.callsign.value.trim() || 'PILOT').slice(0, 16).toUpperCase();
    localStorage.setItem('neonveil_callsign', callsign);
    this.setStatus(`LAUNCHING ${mode.toUpperCase()}…`);
    this.onStart({ callsign, mode, mapId: this.mapId });
  }
}

export class SettingsUI {
  private root = document.getElementById('settings')!;
  private sens = document.getElementById('set-sens') as HTMLInputElement;
  private vol = document.getElementById('set-vol') as HTMLInputElement;
  private invert = document.getElementById('set-invert') as HTMLInputElement;
  private mute = document.getElementById('set-mute') as HTMLInputElement;
  private onChange: ((s: Settings) => void) | null = null;

  constructor(initial: Settings) {
    this.sens.value = String(initial.mouseSens);
    this.vol.value = String(initial.volume);
    this.invert.checked = initial.invertY;
    this.mute.checked = initial.mute;

    const emit = () => {
      this.onChange?.(this.read());
    };
    this.sens.addEventListener('input', emit);
    this.vol.addEventListener('input', emit);
    this.invert.addEventListener('change', emit);
    this.mute.addEventListener('change', emit);
    document.getElementById('btn-settings-close')?.addEventListener('click', () => this.show(false));
  }

  onSettingsChange(cb: (s: Settings) => void) {
    this.onChange = cb;
  }

  read(): Settings {
    return {
      mouseSens: parseFloat(this.sens.value) || 1,
      volume: parseFloat(this.vol.value) || 0,
      invertY: this.invert.checked,
      mute: this.mute.checked,
    };
  }

  /** Sync mute checkbox from ForgeFlow controls bar / external mute. */
  setMute(muted: boolean) {
    this.mute.checked = muted;
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  toggle() {
    this.show(this.root.classList.contains('hidden'));
  }
}

export class ResultsUI {
  private root = document.getElementById('results')!;
  private title = document.getElementById('results-title')!;
  private stats = document.getElementById('results-stats')!;
  private onMenu: (() => void) | null = null;

  constructor() {
    document.getElementById('btn-results-menu')?.addEventListener('click', () => {
      this.show(false);
      this.onMenu?.();
    });
  }

  onReturn(cb: () => void) {
    this.onMenu = cb;
  }

  showResults(title: string, lines: string[]) {
    this.title.textContent = title;
    this.stats.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    this.show(true);
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }
}

export class LoadingUI {
  private root = document.getElementById('loading')!;
  private fill = document.getElementById('loading-fill') as HTMLElement;
  private text = document.getElementById('loading-text')!;

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  set(progress: number, label: string) {
    this.fill.style.width = `${Math.round(progress * 100)}%`;
    this.text.textContent = label;
  }
}
