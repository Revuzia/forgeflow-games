// GENESIS — keeping one planet visual per planet view (renderer.ts syncPlanets).
//
// A visual is keyed by planet id, but the id alone does not name a world: loading a save in place (title Continue,
// Saves → Load) or any snapshot whose seed or grid size differs makes WorldView build a NEW PlanetView under the same
// id (worldview.ts). Everything a planet visual built from its first view — the field textures that hold the view they
// read, the chunk LOD's grid, noise and radius, the per-world life, cloud and lava caches — belongs to that old world,
// so a replaced view gets a fresh visual instead of a re-sync of the old one (which drew the old world's terrain, seas
// and snow under the new world's air and clouds).

/** what syncPlanetVisuals needs of a visual */
export interface SyncedVisual<P> {
  pv: P;
  sync(pv: P): void;
  dispose(): void;
}

export interface PlanetVisualHooks<P, V extends SyncedVisual<P>> {
  make(pv: P): V;
  /** a new visual joins the scene */
  added(v: V): void;
  /** a visual leaves the scene (it is disposed right after) */
  removed(v: V): void;
}

/**
 * Bring `visuals` in line with `views`: build a visual for a new id, rebuild one whose view object was replaced, sync
 * the rest, and drop ids no longer present. Returns the ids whose visual was REBUILT (its view replaced) this call.
 */
export function syncPlanetVisuals<P extends { id: number }, V extends SyncedVisual<P>>(
  visuals: Map<number, V>, views: readonly P[], hooks: PlanetVisualHooks<P, V>,
): number[] {
  const rebuilt: number[] = [];
  const seen = new Set<number>();
  for (const pv of views) {
    seen.add(pv.id);
    let vis = visuals.get(pv.id);
    if (vis && vis.pv !== pv) {
      // the world under this id was replaced (a save loaded in place): nothing the old visual built still applies
      hooks.removed(vis);
      vis.dispose();
      visuals.delete(pv.id);
      vis = undefined;
      rebuilt.push(pv.id);
    }
    if (!vis) {
      vis = hooks.make(pv);
      visuals.set(pv.id, vis);
      hooks.added(vis);
    }
    vis.sync(pv);
  }
  for (const [id, vis] of visuals) {
    if (seen.has(id)) continue;
    hooks.removed(vis);
    vis.dispose();
    visuals.delete(id);
  }
  return rebuilt;
}
