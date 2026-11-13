// VALE HUD — the renderer seam the input controller gets (ruling 36): the real renderer, plus target selection for the
// HUD's target plate (a left click on a unit selects it). Every InputRenderer method is forwarded: the controller
// probes run against the bare renderer, so a method this wrapper dropped would work in the probes and silently fall
// back in the shipped game (verifier r3: unitPos was dropped, so attack-move clicks measured sim positions, not drawn
// ones). FORWARD lists them as a mapped type, so adding a method to InputRenderer without forwarding it fails the
// typecheck; probe_input_clicks also checks every this.r.* call in the controller against a wrapped renderer.

import type { EntityId } from '../../contracts/sim.ts';
import type { InputRenderer } from '../../input/controller.ts';

/** every InputRenderer member forwarded as-is (setTarget is wrapped, camera is a getter) */
type Forwarded = Exclude<keyof InputRenderer, 'setTarget' | 'camera'>;
export const FORWARD: { readonly [K in Forwarded]: true } = { pickGround: true, pickEntity: true, worldToScreen: true, setAim: true, setHover: true, unitPos: true };

export function selecting(r: InputRenderer, select: (id: EntityId | null) => void): InputRenderer {
  const w: InputRenderer = {
    setTarget: (id) => { r.setTarget?.(id); select(id); },
    get camera() { return r.camera; },
  };
  for (const k of Object.keys(FORWARD) as Forwarded[]) {
    if (typeof r[k] !== 'function') continue;
    (w as Record<string, unknown>)[k] = (...a: unknown[]) => (r[k] as (...x: unknown[]) => unknown).apply(r, a);
  }
  return w;
}
