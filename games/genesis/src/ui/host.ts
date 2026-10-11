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

// ───────────────────────────── camera modes (CONTRACT §15.8, §16) ─────────────────────────────

/** what the camera is doing, as the interface names it */
export type CameraModeName = 'orbit' | 'system' | 'fly' | 'follow' | 'dolly' | 'walk' | 'photo';

/** photo mode's lens and look (photo.ts edits it; the App applies it to the renderer, or to the fallback) */
export interface PhotoLens {
  /** exposure compensation, stops (on top of the auto exposure) */
  exposure: number;
  /** vertical field of view, degrees (a longer lens is a smaller angle) */
  fov: number;
  /** focus distance, metres */
  focus: number;
  /** depth-of-field strength 0 (all sharp) .. 1 (a wide-open lens) */
  blur: number;
  /** colour filter id (photo.ts FILTERS) */
  filter: string;
  /** frame id: 'free' or an aspect ratio ('16:9', '2.39:1', '4:5', '1:1', '9:16') */
  frame: string;
  /** composition guides: 'none' | 'thirds' | 'golden' | 'centre' */
  guides: string;
  bloom: number;
  vignette: number;
  grain: number;
  /** roll of the camera, degrees */
  roll: number;
}

/**
 * The render lane's camera modes (src/render/camera/follow.ts, dolly.ts, walk.ts, photo.ts), as the UI expects to
 * drive them. Every member is optional: what the renderer does not offer yet, the App does with its fallback
 * (src/ui/camfallback.ts: an orbit that eases after the thing, a dolly that circles the orbit camera, a walking eye on
 * the fly camera's frame, a CSS / 2D-canvas tilt-shift for depth of field). The integration step binds these to the
 * rig; the App prefers them whenever they exist.
 */
export interface RenderCameraModes {
  /** keep the camera on a thing (null: stop) */
  follow?(ref: EntityRef | null): void;
  /** a cinematic arc around a place: centre (body-frame unit vector), radius of the place (m); null stops */
  dolly?(o: { planet: number; center: UnitVec; radius: number } | null): void;
  /** the player's body on the surface at a point, looking along a heading (rad from north); null leaves */
  walk?(o: { planet: number; at: UnitVec; heading: number } | null): void;
  /** the free photo camera from the current pose (true) or back to what it was (false) */
  photo?(on: boolean): void;
  /** the lens: physical depth of field from the depth buffer, exposure, field of view, roll */
  lens?(l: Readonly<PhotoLens>): void;
  /** true when `lens` draws real depth of field (else the interface's tilt-shift stands in) */
  readonly dof?: boolean;
}

/** what the interface asks of the camera (the App implements it over the render lane's modes or its fallbacks) */
export interface CameraHost {
  mode(): CameraModeName;
  /** the thing followed / circled / walked beside, for the camera's chip */
  subject(): InspectRef | null;
  dolly(ref: EntityRef | null): void;
  /** walk at a thing (a settlement, a person, a cell) or at the cursor / the camera's point when null; `leave` rises */
  walk(ref: EntityRef | null, leave?: boolean): void;
  photo(on: boolean): void;
  lens(): PhotoLens;
  setLens(p: Partial<PhotoLens>): void;
  /** does the renderer draw real depth of field (else the tilt-shift fallback) */
  realDof(): boolean;
  /** distance (m) to the world under a screen point, or null for the sky */
  depthAt(x: number, y: number): number | null;
  /** the next rendered frame as a PNG data URL (the raw canvas: no interface) */
  grab(): Promise<string>;
  /** photo mode: is time frozen */
  frozen(): boolean;
  freeze(on: boolean): void;
  /** the walking body's analog stick (gamepad), −1..1 */
  stick(x: number, y: number): void;
}

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
  /** the camera's modes (follow, cinematic, walk, photo) */
  readonly cam?: CameraHost;
}
