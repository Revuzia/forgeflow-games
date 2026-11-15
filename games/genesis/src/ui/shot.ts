// GENESIS — the screenshot key (Shift+F8): the next frame as the canvas drew it, at the canvas's own pixel size and
// untouched (no scaling, no filter), saved as a PNG. A strip above the picture carries the perf report's header facts —
// build, canvas size, preset, GPU, camera altitude — so a tester's picture and report text can be told apart later.
// The strip is extra rows ABOVE the frame: not one pixel of the frame is covered or changed.

import type { UiHost } from './host.ts';
import { download } from './dom.ts';
import { perfmon } from '../render/perfmon.ts';
import { BUILD_STAMP } from '../render/perfreport.ts';

export interface ShotFacts {
  when: string;
  build: string;
  canvas?: string;
  preset?: string;
  gpu?: string;
  dpr?: number;
  altitude?: number;
  extra?: string;
}

/** the header lines (pure): what the picture was and how it was drawn */
export function shotHeader(f: ShotFacts, w: number, h: number): string[] {
  const l1 = `GENESIS screenshot · ${f.when} · build ${f.build} · ${w}x${h} px`;
  const l2 = [f.preset ? `preset ${f.preset}` : '', f.canvas ? `canvas ${f.canvas}` : '', f.dpr ? `dpr ${f.dpr}` : '', f.altitude !== undefined ? `altitude ${Math.round(f.altitude)} m` : ''].filter(Boolean).join(' · ');
  const l3 = [f.gpu ? `gpu ${f.gpu}` : '', f.extra ?? ''].filter(Boolean).join(' · ');
  return [l1, l2, l3].filter(Boolean);
}

/** the file's name: genesis-shot-<build>-<WxH>-<stamp>.png */
export function shotName(f: ShotFacts, w: number, h: number): string {
  return `genesis-shot-${f.build.replace(/[^A-Za-z0-9._-]+/g, '-')}-${w}x${h}-${f.when.replace(/[^0-9]/g, '').slice(0, 14)}.png`;
}

function facts(): ShotFacts {
  const f: ShotFacts = { when: new Date().toISOString().slice(0, 19) + 'Z', build: BUILD_STAMP };
  try {
    const e = perfmon.env?.();
    if (e) Object.assign(f, { canvas: e.canvas, preset: e.preset, gpu: e.gpu, dpr: e.dpr, extra: e.extra });
    const c = perfmon.context?.();
    if (c) f.altitude = c.altitude;
  } catch { /* the header is a courtesy: the picture is not held back by it */ }
  return f;
}

/** take it: grab the next frame, add the strip, download */
export async function takeScreenshot(host: UiHost): Promise<void> {
  const grab = host.cam?.grab;
  if (!grab) { host.toast({ text: 'No picture can be taken here.', kind: 'warn', ms: 3000 }); return; }
  try {
    const url = await grab();
    if (!url) throw new Error('empty');
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('decode')); i.src = url; });
    const f = facts();
    const lines = shotHeader(f, img.width, img.height);
    const lh = 18, pad = 8, strip = lines.length * lh + pad * 2;
    const out = document.createElement('canvas');
    out.width = img.width; out.height = img.height + strip;
    const g = out.getContext('2d');
    if (!g) throw new Error('2d');
    g.fillStyle = '#0b0d13';
    g.fillRect(0, 0, out.width, strip);
    g.fillStyle = '#efe7d6';
    g.font = '13px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'top';
    lines.forEach((t, i) => g.fillText(t, pad, pad + i * lh, out.width - 2 * pad));
    g.drawImage(img, 0, strip); // the frame itself: 1:1
    const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('encode');
    const name = shotName(f, img.width, img.height);
    download(name, blob, 'image/png');
    host.toast({ text: `Saved ${name}`, kind: 'info', ms: 3500 });
  } catch {
    host.toast({ text: 'The picture could not be saved.', kind: 'warn', ms: 3500 });
  }
}
