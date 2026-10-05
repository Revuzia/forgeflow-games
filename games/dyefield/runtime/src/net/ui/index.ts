// DYEFIELD — the LOBBY-UI entry (CONTRACT_ONLINE §O11.2): main.ts (SYNC) lazy-loads this with `import('./net/ui/index.ts')`
// when PLAY ONLINE opens (or a ?room= / ?net= link), so nothing under net/** is in the offline boot path.
//
// Wiring (SYNC, main.ts) — the shape this lane was built and tested against (_harness/netlobby.py does the same through
// ./dev.ts with the mock):
//
//   const ui = (await import('./net/ui/index.ts')).createOnlineUi(uiRoot, {
//     api,                                   // net/api.ts OnlineApi
//     profile,                               // the ProfileStore (name / kit / crew / ffaColor; MODE + RULE written back)
//     settings,                              // optional: the SettingsStore (REDUCE MOTION; else the OS preference)
//     screens: {
//       close: () => menus.returnFromOnline(),                 // BACK from PLAY ONLINE: the title, PLAY ONLINE focused
//       playOffline: (mode, rule) => { api.leave(false); startMatch({ ...offline selection with this mode / rule }); },
//                                            // ONLY the notice cards' PLAY VS BOTS (quota / unsupported). The solo prompt's PLAY VS BOTS
//                                            // calls api.playBotsInstead(), which starts the offline match itself (OnlineDriver.playOffline):
//                                            // the screens never call both, so the offline match starts once.
//       matchPhase: (phase, room) => { … loading → loadArena / startSession; null → back to the lobby backdrop … },
//       sound: (s) => audio.ui(s),
//     },
//     hud: {
//       resume: () => …,                     // the MATCH MENU card closed (the match never paused)
//       settings: () => …, howto: () => …,   // open the menus' SETTINGS / HOW TO PLAY over the running match
//       leaveMatch: () => …,                 // api.leave() + stats matchAbandon('dispose') + back to the lobby
//       leavePost: () => …,                  // the slate's LEAVE: back to the lobby + PLAY ONLINE
//       crewOf: (runner) => ({ mark, dye }), // the players lists' crew chips
//       tabFree: () => !bindingsUse('Tab'),
//       sound: (s) => audio.ui(s),
//     },
//   });
//   menus hook:  online: () => { menus.hideAll(); ui.screens.open(); }
//   deep link:   ?room=K7QX → ui.screens.open({ join: 'K7QX' })
//   in a match:  ui.hud.attach() at the countdown, ui.hud.detach() at the horn / leave; ESC, the touch PAUSE, blur,
//                hidden and back → ui.hud.showMenu() (no pause online, §O10); the victory slate →
//                ui.hud.showPost(room, hud.slates.victoryCardEl) (its buttons live inside the slate: the Menus'
//                extraScope keeps navigating them); a new match / the lobby → ui.hud.hidePost().
//   name tags:   players.ts rename(id, name) sets tag.dataset.net = 'human' | 'bot' | 'away' (hud.css draws the chip).

import { NavController } from './nav.ts';
import { OnlineScreens, type OnlineScreensHooks, type ProfileLike } from './screens.ts';
import { OnlineHud, type OnlineHudHooks } from './onlinehud.ts';
import type { OnlineApi, UiSettingsLike } from './types.ts';

export { OnlineScreens, ONLINE_TEXT, NOTICES, untilUtcMidnight, copyText } from './screens.ts';
export type { OnlineScreen, OnlineScreensHooks, ProfileLike } from './screens.ts';
export { OnlineHud, HUD_TEXT } from './onlinehud.ts';
export type { OnlineHudHooks } from './onlinehud.ts';
export { NavController } from './nav.ts';
export * from './types.ts';

export interface OnlineUi {
  readonly screens: OnlineScreens;
  readonly hud: OnlineHud;
  readonly nav: NavController;
  dispose(): void;
}

/** the PLAY ONLINE screens + the in-match overlays, sharing one focus controller */
export function createOnlineUi(host: HTMLElement, o: { api: OnlineApi; profile: ProfileLike; screens: OnlineScreensHooks; hud: OnlineHudHooks;
  settings?: UiSettingsLike }): OnlineUi {
  const nav = new NavController();
  const screens = new OnlineScreens(host, { api: o.api, profile: o.profile, hooks: o.screens, nav, settings: o.settings });
  const hud = new OnlineHud(host, { api: o.api, hooks: o.hud, nav, settings: o.settings });
  return {
    screens, hud, nav,
    dispose(): void { hud.dispose(); screens.dispose(); nav.dispose(); },
  };
}
