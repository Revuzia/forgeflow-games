// Mock data for the kit pages: real-looking strings (kind copy, long names, a 50-character nickname) so wrapping and clipping show up
// on the sheet before they show up in the game. No game state is read; nothing here touches storage or audio.
import type { SwitchChoice } from '../../src/ui/quickSwitch.ts';

export const MOCK = {
  squishy: { name: 'Dollop', species: 'Wrigglo', tier: 'uncommon', tierLabel: 'Uncommon' },
  longName: 'Sir Reginald Bartholomew Wobblesworth the Third',
  nick50: 'Professor Wigglesworth-Squishington of Jellyfield',
  hoard: { have: 14, of: 50 },
  trophies: { have: 6, of: 20 },
  copy: {
    gel: 'Wake it up',
    takeThis: 'Take this one',
    longLabel: 'Take this one, it is a rather long label for a button',
    reasonCut: 'Cut is not available while a capsule is opening.',
    reasonGift: 'Come back tomorrow for your next gift.',
    tooltip: 'Cut (C)',
    toastInfo: 'A capsule is ready.',
    toastOk: 'Photo saved.',
    toastWarn: 'You are offline. Your squishies are safe in this browser.',
    toastErr: 'That did not work. Please try again.',
    toastTrophy: 'First squish',
    toastTrophySub: 'Poke your squishy for the first time. +10 XP',
    modalTitle: 'Tidy up these copies?',
    modalText: 'This turns three Commons into one Uncommon. The last copy of a squishy is always kept.',
  },
  /** the OTHER squishies of the quick switcher: one of five tiers, one very long name */
  switch: [
    { id: 'a', species: 'dollop', name: 'Dollop', tier: 'common' },
    { id: 'b', species: 'wrigglo', name: 'Sir Reginald Bartholomew Wobblesworth', tier: 'uncommon' },
    { id: 'c', species: 'pastrel', name: 'Pastrel', tier: 'rare' },
    { id: 'd', species: 'thumbly', name: 'Thumbly', tier: 'epic' },
    { id: 'e', species: 'boingle', name: 'Boingle', tier: 'legendary' },
  ] as SwitchChoice[],
  rarities: [['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'], ['epic', 'Epic'], ['legendary', 'Legendary'], ['mythic', 'Mythic']] as const,
  medals: [['bronze', 'Bronze'], ['silver', 'Silver'], ['gold', 'Gold'], ['diamond', 'Diamond']] as const,
  quality: [{ value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'med', label: 'Medium' }, { value: 'high', label: 'High' }],
  gravity: [{ value: 'table', label: 'Table', icon: 'table' as const }, { value: 'float', label: 'Float', icon: 'float' as const }],
};
