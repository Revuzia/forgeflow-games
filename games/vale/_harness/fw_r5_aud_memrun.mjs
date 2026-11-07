// VALE harness — round 5 AUD-3 / AUD-4: probe_match_memory on a production build of its OWN.
//
//   node _harness/fw_r5_aud_memrun.mjs --dist aud_r5 [--build] -- <probe_match_memory args>
//
// probe_match_memory.mjs builds into, and serves, _harness/_prod/client/dist; other lanes run it with --no-build against
// that directory at the same time, and a rebuild under them would pull their pages' chunks away. This runs the very same
// probe (its source, unchanged but for the one PROD_DIR line) against _harness/_prod/<dist>/dist: --build builds the
// current tree there first (the probe's own vite build call, its outDir only moved). The generated copy is written to
// the path given by --gen (default: _harness/_reports/fw_r5_aud_pmm_<pid>.gen.mjs, gitignored, so the wip sync never
// commits it; its HERE and its relative imports point back at _harness), removed after the run.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const own = sep >= 0 ? argv.slice(0, sep) : argv;
const pass = sep >= 0 ? argv.slice(sep + 1) : [];
const opt = (k, d) => (own.includes(k) ? own[own.indexOf(k) + 1] : d);
const DIST = opt('--dist', 'aud_r5');
if (!/^[a-z0-9_]+$/.test(DIST)) throw new Error('--dist: a plain name');
const GEN = opt('--gen', join(HERE, '_reports', `fw_r5_aud_pmm_${process.pid}.gen.mjs`));

const src = readFileSync(join(HERE, 'probe_match_memory.mjs'), 'utf8');
const line = "const PROD_DIR = join(HERE, '_prod', 'client', 'dist');";
if (!src.includes(line)) throw new Error('probe_match_memory.mjs: the PROD_DIR line moved; nothing run');
const hereLine = 'const HERE = dirname(fileURLToPath(import.meta.url));';
if (!src.includes(hereLine)) throw new Error('probe_match_memory.mjs: the HERE line moved; nothing run');
const gen = src.replace(line, `const PROD_DIR = join(HERE, '_prod', ${JSON.stringify(DIST)}, 'dist');`)
  .replace(hereLine, `const HERE = ${JSON.stringify(HERE)};`)
  .replace(/import\('\.\/([^']+)'\)/g, (m, f) => `import(${JSON.stringify(pathToFileURL(join(HERE, f)).href)})`)
  .replace(/from '\.\/([^']+)'/g, (m, f) => `from ${JSON.stringify(pathToFileURL(join(HERE, f)).href)}`);
writeFileSync(GEN, gen);
const args = [GEN, ...pass.filter((a) => a !== '--no-build'), ...(own.includes('--build') ? [] : ['--no-build'])];
const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
const stop = (sig) => { try { child.kill(sig); } catch { /* gone */ } };
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
child.on('exit', (code) => { try { rmSync(GEN); } catch { /* */ } process.exit(code ?? 2); });
