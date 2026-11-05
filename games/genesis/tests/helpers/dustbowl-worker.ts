// GENESIS test helper: runs the drought fixture (helpers/dustbowl.ts) for workerData.seeds in a worker thread and posts
// the rows back, so tests/drought-band.test.ts runs its 16-seed total four seeds at a time.
import { parentPort, workerData } from 'node:worker_threads';
import { dustBowlRow } from './dustbowl.ts';

const { seeds } = workerData as { seeds: number[] };
parentPort!.postMessage(seeds.map((s) => dustBowlRow(s)));
