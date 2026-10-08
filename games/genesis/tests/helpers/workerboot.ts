// GENESIS test helper: host src/sim/worker.ts inside a Node worker_threads Worker by mapping parentPort onto the
// Web Worker globals it expects (postMessage / onmessage). Lets tests drive the real ToWorker / FromWorker protocol.
import { parentPort } from 'node:worker_threads';

const g = globalThis as unknown as { postMessage: (m: unknown, t?: unknown[]) => void; onmessage: ((ev: { data: unknown }) => void) | null };
g.postMessage = (m, t) => parentPort!.postMessage(m, (t ?? []) as never);
parentPort!.on('message', (data) => g.onmessage?.({ data }));
await import('../../src/sim/worker.ts');
parentPort!.postMessage({ type: '__booted' });
