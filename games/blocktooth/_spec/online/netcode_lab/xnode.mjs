import fs from 'node:fs';
globalThis.window = globalThis;
eval(fs.readFileSync(new URL('./xengine.js', import.meta.url), 'utf8'));
const cfgs = [['molo','grideast',1337,18000], ['voltkite','whitestacks',1337,18000], ['hearthback','lockwater',99,18000]];
fs.writeFileSync(new URL('./xnode.json', import.meta.url), JSON.stringify({ version: process.version, runs: cfgs.map(c => globalThis.runProbe(...c)) }));
console.log('ok');
