import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Local rebuild of Neon Veil from the RESTORED TypeScript sources.
//
//  - base './'            → asset URLs are relative, so the bundle works when
//                           served under /games/neon-veil/ (or a subfolder).
//  - input index.dev.html → a dev/build-only HTML that loads src/main.ts.
//                           The LIVE games/neon-veil/index.html is untouched;
//                           it still ships the current assets/index-*.js bundle.
//  - outDir dist-rebuild  → kept SEPARATE from the live assets/. Swapping the
//                           rebuilt bundle into the live game is a later,
//                           separately-verified step.
export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    outDir: 'dist-rebuild',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: resolve(__dirname, 'index.dev.html'),
    },
  },
});
