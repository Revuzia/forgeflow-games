// Minimal Vite config for LANE SCRATCH PREVIEWS (orchestrator-owned).
// Usage (from games/blocktooth):  npx vite --config _harness/scratch/vite.scratch.config.ts --port 518X --strictPort
// Then open http://localhost:518X/_harness/scratch/<lane>/index.html
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export default defineConfig({
  root,
  clearScreen: false,
  server: { headers: { 'Cache-Control': 'no-store' }, fs: { strict: false } },
  optimizeDeps: { include: ['three'] },
});
