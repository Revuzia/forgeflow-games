// The screens the title chips and the Menu rows can open (UI.md 6). ONE list of flags: a destination exists when its flag is true, and only then does a chip or a row
// for it get drawn (a button that does nothing is worse than none). A later batch flips its flag and adds its `case` to `openDestination` in hudBinding.ts:
//   settings  B4a  the Settings panel (B4b: restyled on the kit, a later-* chunk, still a standalone panel opened from the Menu row or the title chip)
//   howto     B4b  How to play (a later-* chunk)        credits  B4b  Credits (a later-* chunk)        trophies  B6b  Trophies and Records
import type { IconName } from '../ui/icons.ts';

export type DestId = 'settings' | 'trophies' | 'howto' | 'credits';
export const DESTINATIONS: Readonly<Record<DestId, boolean>> = { howto: true, trophies: true, credits: true, settings: true };
export const DEST_LABELS: Readonly<Record<DestId, string>> = { howto: 'How to play', trophies: 'Trophies', credits: 'Credits', settings: 'Settings' };
export const DEST_ICONS: Readonly<Record<DestId, IconName>> = { howto: 'help', trophies: 'trophy', credits: 'heart', settings: 'gear' };
/** the title's chip order, and the Menu's row order (UI.md 6: Settings, Trophies, How to play, Credits) */
export const TITLE_ORDER: readonly DestId[] = ['howto', 'trophies', 'credits', 'settings'];
export const MENU_ORDER: readonly DestId[] = ['settings', 'trophies', 'howto', 'credits'];
