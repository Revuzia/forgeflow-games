// GENESIS — a small, dismissible notice when the browser is drawing the game with software rendering or with the
// processor's built-in graphics (LOADTIME ledger, task 5). The page cannot see whether the computer also has a separate
// graphics card, so the built-in case is worded as an "if". Shown once the world is up; "Got it" is remembered.
// `?gpunote=0` never shows it; `?gpunote=software` / `?gpunote=integrated` show that notice whatever the GPU (testing).

import { classifyGpu, gpuShortName, type GpuClass } from '../render/gpuclass.ts';

const KEY = 'genesis.gpunote.ok';

export function gpuNoticeText(kind: GpuClass, renderer: string, windows: boolean): { title: string; body: string[] } | null {
  if (kind === 'software') {
    return {
      title: 'The game is running without your graphics card',
      body: [
        'This browser is drawing on the processor (software rendering), so the game will be slow.',
        'To fix it: open the browser\'s settings, search for "hardware acceleration", turn it on, and restart the browser.',
      ],
    };
  }
  if (kind === 'integrated' && windows) {
    return {
      title: 'The game is running on built-in graphics',
      body: [
        `The browser is using ${gpuShortName(renderer) || 'the processor\'s built-in graphics'}. That works, but it is slow for this game.`,
        'If this computer also has a separate graphics card: Windows Settings > System > Display > Graphics, add or pick your browser, choose "High performance", then restart the browser.',
      ],
    };
  }
  return null;
}

/** show the notice if it applies (once; returns what was detected) */
export function showGpuNotice(renderer: string, root: HTMLElement = document.body): GpuClass {
  const q = new URLSearchParams(location.search).get('gpunote');
  const kind = q === 'software' || q === 'integrated' ? q : classifyGpu(renderer);
  // (never by itself in an automated browser — the harness runs on SwiftShader — nor over the benchmark)
  if (q === '0' || (!q && (navigator.webdriver || /[?&]bench=/.test(location.search)))) return kind;
  let seen = false;
  try { seen = localStorage.getItem(KEY) === kind; } catch { /* asked again */ }
  const text = gpuNoticeText(kind, renderer, q === 'integrated' || /Windows/i.test(navigator.userAgent));
  if (!text || (seen && !q)) return kind;
  const box = document.createElement('div');
  box.id = 'gn-gpunote';
  box.setAttribute('role', 'status');
  box.style.cssText = 'position:fixed;right:14px;top:14px;z-index:900;max-width:min(360px,calc(100vw - 28px));box-sizing:border-box;padding:11px 13px 10px;border-radius:8px;'
    + 'background:rgba(14,16,20,.92);border:1px solid rgba(214,178,94,.45);color:#ece6d6;font:13px/1.4 var(--gn-sans,system-ui,sans-serif);box-shadow:0 6px 24px rgba(0,0,0,.5);pointer-events:auto';
  const t = document.createElement('div');
  t.textContent = text.title;
  t.style.cssText = 'font-weight:600;margin:0 0 5px;color:#e6c97a';
  box.appendChild(t);
  for (const line of text.body) { const p = document.createElement('div'); p.textContent = line; p.style.cssText = 'margin:0 0 6px'; box.appendChild(p); }
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Got it';
  b.style.cssText = 'margin-top:2px;padding:4px 12px;border-radius:5px;border:1px solid rgba(214,178,94,.6);background:rgba(214,178,94,.12);color:#ece6d6;font:inherit;cursor:pointer';
  b.addEventListener('click', () => { try { localStorage.setItem(KEY, kind); } catch { /* shown again next time */ } box.remove(); });
  box.appendChild(b);
  root.appendChild(box);
  return kind;
}
