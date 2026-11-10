// PERF lane: which WebGL2 extensions the headless SwiftShader Chromium exposes (EXT_clip_control, EXT_conservative_depth, ...)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
console.log(await p.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); return gl ? gl.getSupportedExtensions().join(' ') : 'no gl'; }));
await b.close();
