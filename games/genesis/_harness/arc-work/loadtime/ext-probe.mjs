// LOADTIME: does headless Chromium expose KHR_parallel_shader_compile under these ANGLE back ends? (one browser at a time)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const sets = [['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ['--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ['--use-gl=angle', '--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']];
for (const a of sets) {
  try {
    const b = await chromium.launch({ args: a });
    const p = await b.newPage();
    const r = await p.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); if (!gl) return 'no gl'; const d = gl.getExtension('WEBGL_debug_renderer_info'); return [gl.getParameter(d.UNMASKED_RENDERER_WEBGL), !!gl.getExtension('KHR_parallel_shader_compile'), gl.getSupportedExtensions().filter((x) => /KHR|parallel/.test(x))]; });
    console.log(a.join(' '), '=>', JSON.stringify(r));
    await b.close();
  } catch (e) { console.log(a.join(' '), 'ERR', String(e).slice(0, 100)); }
}
