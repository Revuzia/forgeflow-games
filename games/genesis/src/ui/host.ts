// GENESIS — what the UI needs from the App (CONTRACT.md §16: "every UI action is a Command or a camera action"). The
// panels never reach into the renderer or the sim directly: they run Commands, ask queries and move the camera through
// this interface, which src/app.ts implements.

import type { Command, CommandResult, EntityRef, UnitVec } from '../sim/types.ts';
import type { WorldView } from '../client/worldview.ts';
import type { PowerBook } from './powers.ts';
import type { Keybinds } from './keybinds.ts';
import type { PrefsStore } from './prefs.ts';
import type { ToastSpec, ToastAction } from './toasts.ts';

/** a point on a world's ground */
export interface GroundHit { planet: number; dir: UnitVec; cell: number }

/** what the inspector can show (EntityRef kinds + a species of a planet) */
export type InspectRef = EntityRef | { kind: 'species'; id: number; planet?: number; key?: string };

export interface UiHost {
  readonly view: WorldView;
  readonly powers: PowerBook;
  readonly keybinds: Keybinds;
  readonly prefs: PrefsStore;
  /** 'worker' (the living sim) or 'lookdev' (a fabricated world: nothing to command) */
  readonly source: string;
  cmd(c: Command, opts?: { quiet?: boolean }): Promise<CommandResult>;
  parse(text: string): Promise<CommandResult>;
  query(q: string, args?: Record<string, unknown>): Promise<unknown>;
  /** the world under the camera */
  primary(): number;
  /** the ground under the pointer (or the gamepad's cursor) */
  cursorGround(): GroundHit | null;
  /** the point the camera looks at */
  focusGround(): GroundHit | null;
  /** screen position (CSS px) of a body-frame unit vector on a planet (on its ground), or null when hidden */
  screenOf(planet: number, dir: ArrayLike<number>, lift?: number): [number, number] | null;
  /** the ground under a screen point */
  groundAt(x: number, y: number): GroundHit | null;
  /** the thing drawn under a screen point (people, herds, buildings; creatures, disasters, ships by proximity) */
  entityAt(x: number, y: number): EntityRef | null;
  /** the settlement whose land covers a point */
  settlementAt(planet: number, dir: ArrayLike<number>): number | null;
  select(ref: InspectRef | null): void;
  selected(): InspectRef | null;
  lookAt(planet: number, pos: ArrayLike<number>, dist?: number): void;
  lookAtEntity(ref: EntityRef): void;
  follow(ref: EntityRef | null): void;
  isFollowing(ref: EntityRef): boolean;
  flyTo(planet: number): void;
  setSpeed(x: number): void;
  step(ticks: number): Promise<number>;
  /** run a keybind / UI action by id (the palette lists them) */
  action(id: string): void;
  toast(spec: ToastSpec): void;
  /** the calendar date of a tick on a planet ("Year 3 · day 7") */
  date(planet: number, tick: number): string;
  /** a UI sound from the audio module's catalog ('ui.open', 'ui.arm', 'gesture.ok' …); silent without one */
  sound(cue: string): void;
  /**
   * an "Undo" for a result that killed or ruined many: rewinds the world to just before it (null when the act did
   * little harm, or the result has no tick)
   */
  undoAction?(r: CommandResult, what?: string, kind?: string): ToastAction | null;
  /** a point of interest on the world under the camera ('homestead': a good place to set a people down) */
  poi?(name: string): { pos: UnitVec; planet: number } | null;
}
