// HIT PARADE - the TRAINING OPTIONS model (lane UI; CONTRACT 8, 27.1). DOM-free (the training driver and its Node probe
// load it); ui/training.ts re-exports it next to the options screen rows and the HUD overlays.

export type DummyAction = 'stand' | 'crouch' | 'jump' | 'cpu';
export type DummyGuard = 'none' | 'all' | 'first' | 'random';
export type RecordMode = 'off' | 'record' | 'play';
export type ResetWhere = 'mid' | 'corner' | 'cornered';
/**
 * CHANGED(UI) P2 (CONTRACT 27.1): the options the training driver (ui/trainer.ts) applies. `guard: 'random'` added; the P1
 * `hpRefill` toggle is gone (the sim always refills HP in training - it could never be switched off).
 */
export interface TrainingOpts {
  dummy: DummyAction; guard: DummyGuard; cpuLevel: number; record: RecordMode;
  inputs: boolean; frames: boolean; hitboxes: boolean; meter: 'normal' | 'full';
}
export const TRAINING_DEFAULTS: Readonly<TrainingOpts> = Object.freeze({
  dummy: 'stand', guard: 'none', cpuLevel: 3, record: 'off', inputs: true, frames: true, hitboxes: false, meter: 'full',
});
/** RECORD length: 3 s of sim ticks */
export const RECORD_TICKS = 180;

/** CHANGED(UI) P2: one box of the training HITBOX overlay, in CSS px of the HUD root (ui/trainer.ts projects them) */
export interface ScreenBox { kind: 'hurt' | 'hit' | 'push' | 'proj'; x0: number; y0: number; x1: number; y1: number }

/** in-memory training options (per session); the training driver subscribes and applies them to the dummy / overlays */
export class TrainingState {
  private v: TrainingOpts = { ...TRAINING_DEFAULTS };
  private fns = new Set<(o: TrainingOpts, action: 'change' | 'reset', where: ResetWhere) => void>();
  /** read-back: ticks held by the driver's last recording (set by ui/trainer.ts) */
  recorded = 0;
  get(): TrainingOpts { return { ...this.v }; }
  set(p: Partial<TrainingOpts>): void {
    const n = { ...this.v, ...p };
    n.cpuLevel = Math.max(1, Math.min(8, Math.round(n.cpuLevel)));
    this.v = n;
    for (const f of [...this.fns]) f(this.get(), 'change', 'mid');
  }
  /** RESET POSITION: mid-screen, the dummy in its corner, or you in yours */
  reset(where: ResetWhere = 'mid'): void { for (const f of [...this.fns]) f(this.get(), 'reset', where); }
  on(fn: (o: TrainingOpts, action: 'change' | 'reset', where: ResetWhere) => void): () => void { this.fns.add(fn); return () => this.fns.delete(fn); }
}
