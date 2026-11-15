// VALE harness (lane W1-E, TECH-01): the games CDN worker's cache rules, run in Node with a fake R2 bucket (no deploy,
// no network). Hashed and content-addressed VALE files are immutable, the manifest / catalog json / config.js /
// game_controls.js are no-cache with an ETag, a matching If-None-Match is a 304 (VALE only), and every other game's
// response is byte-identical to the worker before the change (_harness/fixtures/games_cdn_baseline.js is that copy).
//
//   node _harness/probe_cdn_headers.ts
import { check, finish } from './fixtures/sim_fixture.ts';
// @ts-expect-error plain JS worker (no types)
import worker, { etagMatches } from '../../../workers/games-cdn/src/index.js';
// @ts-expect-error plain JS worker (no types)
import baseline from './fixtures/games_cdn_baseline.js';

interface Obj { size: number; httpEtag: string; body: string; writeHttpMetadata(h: Headers): void }
const obj = (etag: string, body = 'x'): Obj => ({ size: body.length, httpEtag: etag, body, writeHttpMetadata(h) { h.set('last-modified', 'Mon, 01 Jan 2026 00:00:00 GMT'); } });
const FILES: Record<string, Obj> = {};
const keys = [
  'vale/index.html', 'vale/assets/index-NSSwHBt2.js', 'vale/assets/Inter-ab12CD_9.woff2', 'vale/assets/vendor.js',
  'vale/config.js', 'vale/game_controls.js', 'vale/catalog/manifest.json', 'vale/catalog/schema-1/2026.11.6/catalog.json',
  'vale/catalog/assets/00110b7e5695-ulkro_long_evening_splash.webp', 'vale/catalog/assets/0023b48888f2-portrait.webp',
  'vale/catalog/assets/001b0eee480a-map.glb', 'vale/thumbnail.png', 'vale/game_meta.json',
  'dyefield/index.html', 'dyefield/assets/main-AbCdEf12.js', 'dyefield/assets/main-AbCdEf12.css', 'dyefield/config.js', 'dyefield/data.json', 'dyefield/m.glb',
  'other/index.html', 'other/game.js', 'other/assets/index-NSSwHBt2.js', 'other/data/x.unityweb', 'other/img.png', 'other/catalog/manifest.json',
  'other/catalog/assets/00110b7e5695-a.webp', 'other/config.js',
];
for (const k of keys) FILES[k] = obj(`"e-${k.length}-${k.charCodeAt(k.length - 3)}"`);
const env = { GAMES: { get: async (k: string) => FILES[k] ?? null } };
const call = async (w: { fetch(r: Request, e: unknown): Promise<Response> }, key: string, h: Record<string, string> = {}): Promise<Response> =>
  w.fetch(new Request(`https://cdn.example/${key}`, { headers: h }), env);
const dump = (r: Response): string => JSON.stringify([r.status, [...r.headers.entries()].sort()]);

void (async () => {
  const cc = async (k: string, h: Record<string, string> = {}): Promise<string | null> => (await call(worker, k, h)).headers.get('cache-control');
  check('vale hashed bundle is immutable', (await cc('vale/assets/index-NSSwHBt2.js'))?.includes('immutable') === true, await cc('vale/assets/index-NSSwHBt2.js'));
  check('vale hashed font is immutable', (await cc('vale/assets/Inter-ab12CD_9.woff2'))?.includes('immutable') === true);
  check('vale content-addressed webp is immutable', (await cc('vale/catalog/assets/00110b7e5695-ulkro_long_evening_splash.webp')) === 'public, max-age=31536000, immutable');
  check('vale content-addressed glb is immutable', (await cc('vale/catalog/assets/001b0eee480a-map.glb')) === 'public, max-age=31536000, immutable');
  check('vale unhashed js stays no-store', (await cc('vale/assets/vendor.js'))?.includes('no-store') === true);
  check('vale html stays no-store', (await cc('vale/index.html'))?.includes('no-store') === true);
  for (const k of ['vale/catalog/manifest.json', 'vale/catalog/schema-1/2026.11.6/catalog.json', 'vale/config.js', 'vale/game_controls.js']) {
    const r = await call(worker, k);
    check(`vale ${k} is no-cache with an ETag`, r.headers.get('cache-control') === 'no-cache' && !!r.headers.get('etag') && !r.headers.get('pragma'), [r.headers.get('cache-control'), r.headers.get('etag')]);
  }
  check('vale thumbnail keeps the day cache', (await cc('vale/thumbnail.png')) === 'public, max-age=86400');

  // 304
  const etag = FILES['vale/catalog/manifest.json'].httpEtag;
  const hit = await call(worker, 'vale/catalog/manifest.json', { 'if-none-match': etag });
  check('vale matching If-None-Match -> 304 with no body', hit.status === 304 && (await hit.text()) === '', hit.status);
  check('304 carries etag, cache-control and CORS', hit.headers.get('etag') === etag && hit.headers.get('cache-control') === 'no-cache' && hit.headers.get('access-control-allow-origin') === '*');
  const weak = await call(worker, 'vale/catalog/manifest.json', { 'if-none-match': `W/${etag}` });
  check('weak validator matches', weak.status === 304);
  const list = await call(worker, 'vale/catalog/manifest.json', { 'if-none-match': `"zzz", ${etag}` });
  check('a list containing the tag matches', list.status === 304);
  const miss = await call(worker, 'vale/catalog/manifest.json', { 'if-none-match': '"stale"' });
  check('a different tag is a 200 with the body', miss.status === 200 && (await miss.text()) === 'x');
  const star = await call(worker, 'vale/config.js', { 'if-none-match': '*' });
  check('* matches an existing object', star.status === 304);
  const asset = await call(worker, 'vale/catalog/assets/0023b48888f2-portrait.webp', { 'if-none-match': FILES['vale/catalog/assets/0023b48888f2-portrait.webp'].httpEtag });
  check('immutable asset revalidates to 304 too', asset.status === 304 && asset.headers.get('cache-control')?.includes('immutable') === true);
  const gone = await call(worker, 'vale/nope.json', { 'if-none-match': '*' });
  check('a missing file is still 404', gone.status === 404);
  check('etagMatches edge cases', !etagMatches(null, '"a"') && !etagMatches('"a"', undefined) && etagMatches('W/"a"', '"a"') && !etagMatches('"b"', '"a"'));

  // every other game: byte-identical to the worker before the change
  let same = 0, diff: string[] = [];
  for (const k of keys.filter((x) => !x.startsWith('vale/'))) {
    for (const h of [{}, { 'accept-encoding': 'gzip, br' }, { 'if-none-match': FILES[k].httpEtag }]) {
      const a = await call(baseline, k, h), b = await call(worker, k, h);
      if (dump(a) === dump(b) && (await a.text()) === (await b.text())) same++; else diff.push(`${k} ${JSON.stringify(h)}`);
    }
  }
  check(`other games' responses byte-identical to baseline (${same} compared)`, diff.length === 0, diff.slice(0, 4));
  const dyHashed = await cc('dyefield/assets/main-AbCdEf12.js');
  check('dyefield hashed asset still immutable', dyHashed === 'public, max-age=31536000, immutable');
  const otherCat = await call(worker, 'other/catalog/assets/00110b7e5695-a.webp', { 'if-none-match': FILES['other/catalog/assets/00110b7e5695-a.webp'].httpEtag });
  check('another game never gets a 304 or immutable catalog rule', otherCat.status === 200 && otherCat.headers.get('cache-control') === 'public, max-age=86400');
  finish('probe_cdn_headers');
})();
