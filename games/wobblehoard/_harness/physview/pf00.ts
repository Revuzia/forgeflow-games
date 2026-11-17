// PF-00's browser side (PG_PHYS): exposes the shared workload to _harness/pf00.mjs.
import { pf00Run } from '../pf00_work.ts';

declare global { interface Window { __PF__: { ready: boolean; run: (reps: number, per: number) => unknown } } }
window.__PF__ = { ready: true, run: (reps: number, per: number) => pf00Run(reps, per) };
