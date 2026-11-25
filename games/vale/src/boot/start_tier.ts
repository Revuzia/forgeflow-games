// VALE boot — the first-run start tier (ruling 67). Before the renderer exists (so no High program is ever compiled on a
// device that should not start there), the device's GPU string and machine facts (render/device_tier.ts) give a
// ceiling; a profile still on the untouched High default is moved down to it once, and the first-run calibration
// (ui/app.tsx firstRunCalibrate) then samples AT that ceiling and may only step further down. Pure decision here, so
// _harness/probe_device_tier.ts holds it; main.ts reads the browser and applies it.
//
//   ?tier=low|medium|high|ultra   force the start preset (QA; it is written like a player's own choice)
//   automated browsers (navigator.webdriver: the harness) keep the fixed default unless ?calibrate=1 or ?tier=
//   a stored first-run verdict from the old rule that drew under 30 frames (the "too few frames keeps High" bug) is
//   treated as no verdict, so that device is judged again

import type { DeviceClass, StartTier } from '../render/device_tier.ts';

export const DEVTIER_KEY = 'vale.devtier.v1';
export const CALIB_KEY = 'vale.calib.v1';
export type AnyTier = 'low' | 'medium' | 'high' | 'ultra';

export interface StartInput {
  cls: DeviceClass;
  /** ?tier= */
  forced: AnyTier | null;
  /** the first-run rules apply (not an automated browser, or ?calibrate=1) */
  auto: boolean;
  /** the stored video block is the untouched High default */
  untouchedHigh: boolean;
  /** DEVTIER_KEY was already written (the ceiling was applied once) */
  devtierDone: boolean;
}

/** the preset to write into the profile before the renderer is made, or null to leave it */
export function startPreset(i: StartInput): AnyTier | null {
  if (i.forced) return i.forced;
  if (!i.auto || i.devtierDone || !i.untouchedHigh) return null;
  return i.cls.cap === 'high' ? null : i.cls.cap;
}

/** a stored first-run verdict that still counts (the old rule's under-30-frame "high" does not) */
export function calibStillValid(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const v = JSON.parse(raw) as { preset?: string; frames?: number; starved?: boolean };
    if (v.preset === 'high' && typeof v.frames === 'number' && v.frames < 30) return false;
    return true;
  } catch { return false; }
}

export function parseTier(q: string | null): AnyTier | null {
  return q === 'low' || q === 'medium' || q === 'high' || q === 'ultra' ? q : null;
}

/** what the boot decided, for the device report (render/diag.ts) and the first-run calibration */
export interface StartRecord { cls: DeviceClass; renderer: string; vendor: string; facts: Record<string, unknown>; applied: AnyTier | null; ceiling: StartTier }
