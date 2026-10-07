// VALE — client entry (CONTRACT §3.5). MINIMAL STUB written by TOOLS for the build pipeline; LEAD/UI
// replace it with the real boot (Session, AudioEngine, Renderer, ui/App). It proves the two-build
// model end to end: load the catalog from the runtime-configured URL and report its version.

import { loadCatalog } from './catalog.ts';

const ui = document.getElementById('ui');

loadCatalog().then(
  (c) => {
    console.info(`[vale] catalog ${c.version} (schema ${c.schema}) from ${c.manifestUrl}`);
    if (ui) ui.textContent = `VALE — catalog ${c.version} (schema ${c.schema})`;
  },
  (e: unknown) => {
    console.error('[vale] catalog load failed', e);
    if (ui) ui.textContent = `VALE — ${e instanceof Error ? e.message : String(e)}`;
  },
);
