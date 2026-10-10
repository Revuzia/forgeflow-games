// GENESIS — the audio DSP worker: renders the synthesized textures (bank.ts specFor → dsp.ts) off the main thread so
// that a crowd's murmur or a lyre's strings coming into earshot never stalls a frame. One message per texture:
// { name, rate } in, { name, sr, chs } out (channels transferred, not copied); chs null for an unknown name.

import { specFor, type DspReply } from './bank.ts';

interface Scope {
  onmessage: ((e: MessageEvent<{ name: string; rate: number }>) => void) | null;
  postMessage(msg: DspReply, transfer?: Transferable[]): void;
}
const scope = globalThis as unknown as Scope;

scope.onmessage = (e) => {
  const { name, rate } = e.data;
  const spec = specFor(name, rate);
  if (!spec) { scope.postMessage({ name, sr: 0, chs: null }); return; }
  const chs = spec.render(spec.sr).map((c) => (c.byteOffset === 0 && c.byteLength === c.buffer.byteLength ? c : c.slice()));
  scope.postMessage({ name, sr: spec.sr, chs }, chs.map((c) => c.buffer as ArrayBuffer));
};
