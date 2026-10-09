// The later-* chunk of the secondary screens (UI.md 8 B4b): Settings, How to play, Credits. Nothing here is needed for the first play: `shell/screens.ts` imports this file
// the first time a player opens one of them (the Menu, a title chip, the ? key) and the stylesheet arrives with it (a `later-*.css`, not counted in G0b).
import './screens.css';

export { createSettingsPanel } from '../settingsPanel.ts';
export { openHowTo } from './howToPlay.ts';
export { openCredits } from './credits.ts';
