// Pure rules for the music duck and the news reach, split out of engine.ts so they are testable without WebAudio.
// The numbers are the engine's own, unchanged (music levels are not touched here).
import { attenuate, hearingRef } from './scene.ts';

/** music-bus duck target and glide time (s) at `now`: pushed back to 0.45 while held, eased back to 1 */
export function duckTarget(now: number, duckUntil: number): { gain: number; glide: number } {
  return now < duckUntil ? { gain: 0.45, glide: 0.12 } : { gain: 1, glide: 1.2 };
}

/** level multiplier and stereo spread for a `news` cue: near news is placed and louder, far or off-planet is a quiet bulletin */
export function newsReach(local: boolean, samePlanet: boolean, dist: number, reach: number, alt: number): { mul: number; spread: number | null } {
  if (local && samePlanet) return { mul: Math.max(0.3, attenuate(dist, hearingRef(reach * 1.5, alt))), spread: dist > reach ? 0.45 : 0.15 };
  return { mul: 0.28, spread: null };
}
