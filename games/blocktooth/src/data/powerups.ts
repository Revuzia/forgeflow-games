// BLOCKTOOTH v2 — map power-up names and one-line descriptions (FEATURES_V2 §1 / §6.1). THREE-free data.
//
// ── L0 SKELETON STUB ── names from the §1 register; lane L4 owns the final copy.

import type { PowerUpKind } from '../core/types.ts';

export const POWERUP_NAMES: Record<PowerUpKind, string> = {
  cleanup: 'CLEANUP CREW',
  demolition: 'DEMOLITION NOTICE',
  redLight: 'RED LIGHT',
  rushHour: 'RUSH HOUR',
  backPay: 'BACK PAY',
};

export const POWERUP_DESC: Record<PowerUpKind, string> = {
  cleanup: 'Every pickup on the map comes home.',
  demolition: 'Regular foes on screen are cleared.',
  redLight: 'Foes, their shots and their paint stop.',
  rushHour: 'Attack speed, move speed and contact smash up.',
  backPay: 'UPROAR to full.',
};
