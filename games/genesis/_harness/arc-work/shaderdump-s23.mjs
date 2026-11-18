// usage: node dump.mjs <tree root genesis dir> <search> -> prints ocean + terrain shader text
const [root, search] = process.argv.slice(2);
globalThis.location = { search: search || '' };
const three = await import(root + '/node_modules/three/build/three.module.js');
const oc = await import(root + '/src/render/planet/ocean.ts');
const tm = await import(root + '/src/render/planet/terrainmat.ts');
const strip = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean).join('\n');
const m = oc.makeOceanMaterial({}, { value: new three.Vector4() }, {});
let out = '=== OCEAN VERT\n' + strip(m.vertexShader) + '\n=== OCEAN FRAG\n' + strip(m.fragmentShader) + '\n';
const shared = tm.makePlanetUniforms ? null : null;
try {
  const t = tm.makeTerrainMaterial(new Proxy({}, { get: (o, k) => (o[k] ??= { value: null }) }), 3);
  const sh = { vertexShader: three.ShaderLib.physical.vertexShader, fragmentShader: three.ShaderLib.physical.fragmentShader, uniforms: {}, defines: {} };
  t.onBeforeCompile(sh, {});
  out += '=== TERRAIN VERT\n' + strip(sh.vertexShader) + '\n=== TERRAIN FRAG\n' + strip(sh.fragmentShader) + '\n=== key ' + t.customProgramCacheKey() + ' defines ' + JSON.stringify(t.defines);
} catch (e) { out += 'TERRAIN ERR ' + e.stack; }
process.stdout.write(out);
