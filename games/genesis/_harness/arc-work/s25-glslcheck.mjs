// PERF s25c: compile the water shaders for several URL switch sets in a bare WebGL2 context (SwiftShader), seconds
// instead of a game boot. Usage: node _harness/arc-work/s25-glslcheck.mjs '?wfast=3' '?wfast=3&wshade3=ssrall' ...
// (three's prefix approximated: GLSL3, highp, gl_FragColor / varying compat, #include chunks resolved; logdepth via defines)
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const three = await import(ROOT + '/node_modules/three/build/three.module.js');
const inc = (s) => s.replace(/#include <(\w+)>/g, (_, k) => inc(three.ShaderChunk[k] ?? ''));
const out = [];
for (const q of process.argv.slice(2)) {
  globalThis.location = { search: q };
  const oc = await import(ROOT + '/src/render/planet/ocean.ts?' + encodeURIComponent(q));
  const m = oc.makeOceanMaterial({}, { value: new three.Vector4() }, {});
  out.push({ q, vs: inc(m.vertexShader), fs: inc(m.fragmentShader) });
}
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const res = await page.evaluate((list) => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const P = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp samplerCube;\nprecision highp sampler3D;\nprecision highp sampler2DShadow;\n#define LOGARITHMIC_DEPTH_BUFFER\n';
  const VP = P + 'uniform mat4 modelViewMatrix;\nuniform mat4 projectionMatrix;\nuniform mat4 modelMatrix;\nuniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\nin vec3 position;\nin vec3 normal;\nin vec2 uv;\n#define attribute in\n#define varying out\n#define texture2D texture\n';
  const FP = P + 'uniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n';
  return list.map(({ q, vs, fs }) => {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return [o, gl.getShaderParameter(o, gl.COMPILE_STATUS) ? '' : gl.getShaderInfoLog(o)]; };
    const [v, ve] = sh(gl.VERTEX_SHADER, VP + vs), [f, fe] = sh(gl.FRAGMENT_SHADER, FP + fs);
    let le = '';
    if (!ve && !fe) { const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) le = gl.getProgramInfoLog(p); }
    return { q, ok: !ve && !fe && !le, ve: ve.slice(0, 400), fe: fe.slice(0, 400), le: le.slice(0, 300) };
  });
}, out);
for (const r of res) console.log(r.ok ? 'OK  ' : 'FAIL', r.q, r.ok ? '' : JSON.stringify({ ve: r.ve, fe: r.fe, le: r.le }));
await browser.close();
