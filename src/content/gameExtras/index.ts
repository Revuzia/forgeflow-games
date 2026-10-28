import type { GameExtra } from "./types";
import { EXTRAS_A_C } from "./a_c";
import { EXTRAS_D_L } from "./d_l";
import { EXTRAS_M_Z } from "./m_z";

export type { GameExtra } from "./types";

const ALL: Record<string, GameExtra> = { ...EXTRAS_A_C, ...EXTRAS_D_L, ...EXTRAS_M_Z };

/** Hand-written guidance for a game, or null for a game published after this file was last updated. */
export function extrasFor(slug: string): GameExtra | null {
  return ALL[slug] || null;
}

/** every slug that has hand-written guidance (used by the build-time coverage check) */
export const EXTRAS_SLUGS = Object.keys(ALL);
