// VALE UI — the screen registry (CONTRACT §10): screen id → module. A new screen is a new module, an
// entry here and (for a top-level screen) a catalog nav record; route params are plain strings.
//   chrome  'nav'   top bar with Back, the nav and the wallet (menu screens)
//           'flow'  the match flow owns the screen: no nav (queue, draft, loading, post-game)
//           'match' no bar at all (the HUD owns the screen)
//   music   which bed plays (menu · draft · postgame · the map's match bed via MapDef.art.music)

import type { ComponentType } from 'preact';
import { CollectionScreen } from './collection.tsx';
import { CustomScreen } from './custom.tsx';
import { DraftScreen } from './draft.tsx';
import { HomeScreen } from './home.tsx';
import { LoadingScreen } from './loading.tsx';
import { LoadoutScreen } from './loadout.tsx';
import { MatchScreen } from './match.tsx';
import { PlayScreen } from './play.tsx';
import { PostgameScreen } from './postgame.tsx';
import { PracticeScreen } from './practice.tsx';
import { ProfileScreen } from './profile.tsx';
import { QueueScreen } from './queue.tsx';
import { SettingsScreen } from './settings.tsx';
import { ShopScreen } from './shop.tsx';

export interface ScreenDef {
  id: string;
  component: ComponentType<{ params: Record<string, string> }>;
  chrome?: 'nav' | 'flow' | 'match';
  music?: 'menu' | 'draft' | 'postgame' | 'match' | 'none';
  /** show the gloam "new" dot on its nav entry until first visited */
  isNew?: boolean;
}

const def = (d: ScreenDef): ScreenDef => d;

export const SCREENS: Record<string, ScreenDef> = {
  home: def({ id: 'home', component: HomeScreen, music: 'menu' }),
  play: def({ id: 'play', component: PlayScreen, music: 'menu' }),
  queue: def({ id: 'queue', component: QueueScreen, chrome: 'flow', music: 'menu' }),
  draft: def({ id: 'draft', component: DraftScreen, chrome: 'flow', music: 'draft' }),
  loadout: def({ id: 'loadout', component: LoadoutScreen, music: 'menu' }),
  loading: def({ id: 'loading', component: LoadingScreen, chrome: 'flow', music: 'draft' }),
  match: def({ id: 'match', component: MatchScreen, chrome: 'match', music: 'match' }),
  postgame: def({ id: 'postgame', component: PostgameScreen, chrome: 'flow', music: 'postgame' }),
  collection: def({ id: 'collection', component: CollectionScreen, music: 'menu' }),
  shop: def({ id: 'shop', component: ShopScreen, music: 'menu' }),
  profile: def({ id: 'profile', component: ProfileScreen, music: 'menu' }),
  settings: def({ id: 'settings', component: SettingsScreen, music: 'menu' }),
  practice: def({ id: 'practice', component: PracticeScreen, music: 'menu' }),
  custom: def({ id: 'custom', component: CustomScreen, music: 'menu' }),
};
