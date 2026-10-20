// VALE game server — `npm run server` (node server/main.ts). Serves online play over WebSocket
// (CONTRACT §7.2): matchmaking, server-side drafts and lockstep matches with an authoritative sim.
//
//   node server/main.ts [--port 8787] [--host 0.0.0.0] [--catalog <catalog.json>] [--wait 8] [--speed 1]
//
// The catalog must be the one the clients load (same version): by default the newest
// dist-catalog/schema-1/<version>/catalog.json (`npm run content` writes it).

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog } from '../src/contracts/catalog.ts';
import { Hub } from './hub.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : process.env[`VALE_${k.toUpperCase()}`] ?? d; };
const HERE = dirname(fileURLToPath(import.meta.url));

function newestCatalog(): string {
  const root = join(HERE, '..', 'dist-catalog', 'schema-1');
  const vers = readdirSync(root).filter((v) => /^\d{4}\.\d+\.\d+$/.test(v))
    .sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  if (!vers.length) throw new Error('no built catalog: run `npm run content` first');
  return join(root, vers[vers.length - 1], 'catalog.json');
}

const path = opt('catalog', '') || newestCatalog();
const catalog = Catalog.parse(JSON.parse(readFileSync(path, 'utf8')));
const hub = new Hub({
  catalog, port: Number(opt('port', '8787')), host: opt('host', '0.0.0.0'),
  waitSeconds: Number(opt('wait', '8')), speed: Number(opt('speed', '1')),
  log: (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`),
});
console.log(`VALE server · catalog ${catalog.version} · ws://localhost:${hub.port}`);
const stop = (): void => { void hub.close().then(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
