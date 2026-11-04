#!/usr/bin/env node
// VALE art: thin a shipped fighter GLB's triangles without a rebuild (closing CW5 refix 2, Ulkro's wraps over the load
// budget): meshoptimizer simplify with locked UV borders, skin weights and UVs interpolated; nothing else changes.
//   node art/tools/glb_simplify.mjs in.glb out.glb --ratio 0.86 --error 0.0015
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { statSync } from 'node:fs';
const a = process.argv.slice(2);
const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const [input, output] = a;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const tris = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0);
const t0 = tris();
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Number(opt('--ratio', 0.9)), error: Number(opt('--error', 0.0015)), lockBorder: true }));
await io.write(output, doc);
console.log(`${input}: tris ${t0} -> ${tris()}; ${(statSync(input).size / 1024).toFixed(1)} -> ${(statSync(output).size / 1024).toFixed(1)} KiB`);
