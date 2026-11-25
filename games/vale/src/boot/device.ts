// VALE boot — can this device play at all? (W1-E, TECH-07). Pure decision + the English text of the ship plates,
// so _harness/probe_boot_gate.ts runs them under plain node. The text lives in content/strings.en.json (the keys
// below); the literals here are the same words as the fallback for the moments before any catalog exists (the plate
// shows at once, before a byte of content is fetched), and the probe fails when the two drift apart.

export interface DeviceFacts {
  /** a throwaway canvas gave a webgl2 context */
  webgl2: boolean;
  /** matchMedia('(pointer: coarse)') */
  coarse: boolean;
  /** matchMedia('(any-pointer: fine)'): a mouse, trackpad or pen is attached */
  anyFine: boolean;
  width: number;
  height: number;
}

export type DeviceKind = 'webgl' | 'touch' | 'small' | 'slow';
export interface DeviceProblem { kind: DeviceKind; /** hybrids and small windows may go on; a device that cannot draw may not */ tryAnyway: boolean }

export const MIN_WIDTH = 1024;
export const MIN_HEIGHT = 600;

/**
 * null = play. `noRender` (?render=0) in a shipped build is the same as a browser that cannot draw (a match would be
 * blank); a dev build with ?dev=1 keeps the harness's no-renderer runs. `tried` = the player chose "Try anyway".
 */
export function deviceProblem(f: DeviceFacts, o: { noRender: boolean; dev: boolean; tried: boolean }): DeviceProblem | null {
  if (o.noRender && !o.dev) return { kind: 'webgl', tryAnyway: false };
  if (!f.webgl2) return { kind: 'webgl', tryAnyway: false };
  if (o.tried) return null;
  if (f.coarse && !f.anyFine) return { kind: 'touch', tryAnyway: true };
  if (f.width < MIN_WIDTH || f.height < MIN_HEIGHT) return { kind: 'small', tryAnyway: true };
  return null;
}

/** the browser's facts (call in a page only) */
export function readDeviceFacts(): DeviceFacts {
  let webgl2 = false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) { webgl2 = true; (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext(); }
  } catch { webgl2 = false; }
  const mq = (q: string): boolean => { try { return matchMedia(q).matches; } catch { return false; } };
  return { webgl2, coarse: mq('(pointer: coarse)'), anyFine: mq('(any-pointer: fine)'), width: innerWidth, height: innerHeight };
}

/** key -> English, mirrored in content/strings.en.json */
export const SHIP_TEXT = {
  'state.error.webgl': "This browser can't draw the game. Try a recent version of Chrome, Edge, Firefox or Safari.",
  'ship.device.touch': 'VALE plays on a computer with a mouse and keyboard.',
  'ship.device.small': 'This window is too small for VALE. Make it at least 1024 by 600, or use a bigger screen.',
  'ship.device.try': 'Try anyway',
  'ship.device.fullscreen': 'Make it full screen',
  'ship.device.reload': 'Reload',
  'ship.tab.title': 'VALE is open in another tab',
  'ship.tab.body': 'Your progress is saved from one tab at a time. Close the other tab, or play here instead.',
  'ship.tab.moved': 'VALE moved to another tab. Close this one, or play here instead.',
  'ship.tab.use': 'Play here',
  'ship.stale.toast': 'Another tab saved newer progress, so this tab will not save. Reload to continue.',
  'ship.match.interrupted': 'The match hit a problem and was ended. Your rating is unchanged.',
  'ship.view.lost': 'The picture stopped drawing',
  'ship.view.lost_sub': 'Trying to bring it back. If it stays blank, reload the page.',
  'ship.device.slow': "This device is drawing VALE without graphics acceleration, so it will run very slowly. Turn on hardware acceleration in your browser's settings and restart the browser, or play on Low anyway.",
  'ship.device.slow_try': 'Play on Low',
  'ship.device.struggle': 'VALE is running very slowly on this device. Graphics are on Low; closing other tabs and apps can help.',
  'ship.view.low': 'Switch to Low quality',
} as const;
export type ShipKey = keyof typeof SHIP_TEXT;

/** the text for a key: the catalog's string when one is at hand, else the English above */
export function shipText(key: ShipKey, strings?: Record<string, string>): string { return strings?.[key] ?? SHIP_TEXT[key]; }
