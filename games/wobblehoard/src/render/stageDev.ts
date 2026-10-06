// DEV ONLY (the render harness and the verifiers' probes): the stage with its dev members typed (`renderer`, `scene`, `views`, `flash`, `memory()`,
// `loseContext()`, `restoreContext()`, `info`; they exist only in a DEV build, see stage.ts). NOTHING in the game imports this file, so
// `vite build` never includes it and `createStageDev` is not even a name in the production bundle.
import type { StageDev } from './stage.ts';
import { createStage } from './stage.ts';

export type { StageDev };

/** The same stage as createStage, typed with its dev members. */
export function createStageDev(canvas: HTMLCanvasElement): StageDev {
  return createStage(canvas) as unknown as StageDev;
}
