// GENESIS — the star at the centre of a system (CONTRACT.md §12): kind, luminosity, temperature, colour, activity.
//
// The star is plain serializable state. Climate reads `luminosity` (flux at distance d = L · (AU / d)²); the renderer
// reads the StarView (colour from temperature, radius for the disc, activity for flares and auroras). `star.set`
// changes kind (taking the kind's defaults) and/or luminosity live.

import type { StarView } from '../types.ts';
import type { Content, StarDef } from '../content.ts';
import { blackbody } from './orbits.ts';

export interface StarState {
  name: string;
  /** stars.json id ('G', 'red-giant', ...) */
  def: string;
  /** spectral class shown to the renderer ('G', 'white-dwarf', 'black-hole', ...) */
  kind: string;
  luminosity: number;
  temperature: number;
  radius: number;
  activity: number;
  color: [number, number, number];
}

export function makeStar(def: StarDef, name: string): StarState {
  return {
    name,
    def: def.id,
    kind: def.kind,
    luminosity: def.luminosity,
    temperature: def.temperature,
    radius: def.radius,
    activity: def.activity,
    color: def.color ? [def.color[0], def.color[1], def.color[2]] : blackbody(def.temperature, [1, 1, 1]),
  };
}

/** switch the star to another kind (keeps its name); returns false for an unknown kind */
export function setStarKind(s: StarState, content: Content, id: string): boolean {
  const def = content.stars.find(id) ?? content.stars.list.find((d) => d.kind === id);
  if (!def) return false;
  const name = s.name;
  Object.assign(s, makeStar(def, name));
  return true;
}

export function setStarLuminosity(s: StarState, lum: number): void {
  s.luminosity = Math.max(0, lum);
}

export function starView(s: StarState): StarView {
  return {
    name: s.name,
    kind: s.kind,
    luminosity: s.luminosity,
    temperature: s.temperature,
    radius: s.radius,
    color: [s.color[0], s.color[1], s.color[2]],
    activity: s.activity,
  };
}
