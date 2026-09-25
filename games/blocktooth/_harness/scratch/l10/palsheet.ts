// L10 scratch: a contact sheet of every titan in its canonical colours + both §8.6 palettes, rendered
// by the real renderPortrait (titans/portraits.ts). Loaded in-page by palshot.py:
//   await (await import('/_harness/scratch/l10/palsheet.ts')).sheet()
import * as THREE from 'three';
import { renderPortrait } from '../../../src/titans/portraits.ts';
import { TITAN_PALETTES } from '../../../src/data/palettes.ts';
import { TITAN_IDS } from '../../../src/core/types.ts';

export async function sheet(size = 220): Promise<{ ok: number; empty: string[]; ms: number[] }> {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: true });
  r.toneMapping = THREE.NeutralToneMapping;
  r.outputColorSpace = THREE.SRGBColorSpace;
  const host = document.createElement('div');
  host.id = 'l10-palsheet';
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#1f2b48;display:grid;grid-template-columns:repeat(3,' + size + 'px);gap:6px;padding:10px;align-content:start;font:12px monospace;color:#f4ecd8';
  document.body.appendChild(host);
  const empty: string[] = [];
  const ms: number[] = [];
  let ok = 0;
  for (const id of TITAN_IDS) {
    const pals = [null, TITAN_PALETTES[id][0], TITAN_PALETTES[id][1]];
    for (const p of pals) {
      const t0 = performance.now();
      const url = await renderPortrait(r, id, size, p);
      ms.push(Math.round(performance.now() - t0));
      const cell = document.createElement('div');
      cell.style.cssText = 'background:#2a3350;position:relative;height:' + size + 'px';
      if (url) {
        const img = document.createElement('img');
        img.src = url; img.width = size; img.height = size;
        cell.appendChild(img);
        ok++;
      } else empty.push(id + ':' + (p ? p.name : 'canonical'));
      const lab = document.createElement('span');
      lab.textContent = id + ' · ' + (p ? p.name : 'CANONICAL');
      lab.style.cssText = 'position:absolute;left:4px;top:2px';
      cell.appendChild(lab);
      host.appendChild(cell);
    }
  }
  r.dispose();
  return { ok, empty, ms };
}
