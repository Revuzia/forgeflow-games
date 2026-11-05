// GENESIS — the save-picture worker (thumbjpeg.ts): draws a save's small ImageBitmap on an OffscreenCanvas and encodes
// it as a JPEG data URL here, off the main thread. A main-thread canvas.toBlob on a GPU-backed canvas reads the canvas
// back synchronously and waits for the whole GPU queue (macfix r3: the autosave's 2-minute hitch).

import { encodeInWorker, type ThumbRequest } from './thumbjpeg.ts';

const scope = self as unknown as { onmessage: ((e: MessageEvent<ThumbRequest>) => void) | null; postMessage(m: unknown): void };
scope.onmessage = (e) => {
  const { id, bmp, quality } = e.data;
  void encodeInWorker(bmp, quality).then((url) => scope.postMessage({ id, url }), () => scope.postMessage({ id, url: null }));
};
