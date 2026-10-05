// DYEFIELD — LOBBY-UI dev mount (harness only; nothing in the game imports this file, so it is never in a build).
// _harness/netlobby.py loads the real game page (the lobby backdrop, the real menus, the real touch mode), then runs
//   const m = await import('/src/net/ui/dev.ts'); m.mountDev({ ... });
// in it: the screens + overlays mount over the page against the mock, exactly as main.ts will mount them against
// SYNC's api, and window.__DFO__ exposes the read-backs and the mock's controls.

import { WEAPONS, playableMaps } from '../../core/data.ts';
import { ProfileStore, SettingsStore } from '../../ui/settings.ts';
import { createOnlineUi, type OnlineUi } from './index.ts';
import { MockOnline, type MockOptions } from './mock.ts';
import type { OnlineMode, OnlineRule, RoomView } from './types.ts';

export interface DevMount {
  ui: OnlineUi;
  mock: MockOnline;
  /** the SettingsStore the UI follows (REDUCE MOTION) */
  settings: SettingsStore;
  /** what the hooks were asked to do, in order */
  log: Array<{ hook: string; a: unknown[] }>;
  state(): Record<string, unknown>;
  /** PLAY ONLINE from the title: the menus hide, the screens open */
  open(o?: { join?: string }): void;
  dispose(): void;
}

declare global { interface Window { __DFO__?: DevMount } }

export function mountDev(o: { mock?: MockOptions } = {}): DevMount {
  window.__DFO__?.dispose();
  const host = document.getElementById('ui') ?? document.body;
  const menusRoot = document.getElementById('df-menus');
  const profile = new ProfileStore(WEAPONS.kits.map((k) => k.id), playableMaps().map((m) => m.id));
  const settings = new SettingsStore();
  const log: DevMount['log'] = [];
  const rec = (hook: string, ...a: unknown[]): void => { log.push({ hook, a }); if (log.length > 200) log.shift(); };
  // onBots = the driver stand-in: SYNC's NetApi.playBotsInstead() starts the offline match itself (the solo prompt's PLAY VS BOTS)
  const mock = new MockOnline({ ...o.mock, onBots: (m: OnlineMode, r: OnlineRule) => { rec('onBots', m, r); if (menusRoot) menusRoot.hidden = false; } });
  const ui = createOnlineUi(host, {
    api: mock, profile, settings,
    screens: {
      close: () => { rec('close'); if (menusRoot) menusRoot.hidden = false; },
      playOffline: (mode, rule) => { rec('playOffline', mode, rule); if (menusRoot) menusRoot.hidden = false; },
      matchPhase: (phase: string | null, room: RoomView | null) => rec('matchPhase', phase, room ? room.code : null),
      sound: (s) => rec('sound', s),
      reload: () => rec('reload'),
    },
    hud: {
      resume: () => rec('resume'),
      settings: () => rec('settings'),
      howto: () => rec('howto'),
      leaveMatch: () => rec('leaveMatch'),
      leavePost: () => rec('leavePost'),
      sound: (s) => rec('hudSound', s),
      crewOf: (runner) => {
        const teams = ['#ff8a1f', '#5b4bf0'];
        return { mark: runner < 4 ? '◉' : '▲', dye: teams[runner < 4 ? 0 : 1] };
      },
    },
  });
  const api: DevMount = {
    ui, mock, log, settings,
    state: () => ({ screens: ui.screens.readback(), hud: ui.hud.readback(), calls: mock.calls.map((c) => c.m), menusHidden: menusRoot ? menusRoot.hidden : null }),
    open: (x) => { if (menusRoot) menusRoot.hidden = true; ui.screens.open(x); },
    dispose: () => { ui.dispose(); if (menusRoot) menusRoot.hidden = false; if (window.__DFO__ === api) delete window.__DFO__; },
  };
  window.__DFO__ = api;
  return api;
}
