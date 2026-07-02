#!/usr/bin/env node
// understone_gen_assets.mjs — fetch pixel-art source images from xAI grok-imagine-image
// ($0.02/image). Node (not Python) because Node gets system DNS inside the Claude Code
// sandbox. Post-processing (downscale/quantize/autotile cutting) is done separately by
// understone_process_assets.py (Pillow, no network needed).
//
// Usage:
//   node pipeline/understone_gen_assets.mjs --manifest pipeline/understone_assets_manifest.json [--only key1,key2] [--dry-run]
//
// Output: forgeflow-games/asset_gen/understone/raw/<key>.png (+ results.json log)
// Gotchas (from house memory): do NOT send aspect_ratio (403s); grok renders NAMED
// franchises/people as literal text — prompts must describe appearance, never name games.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FFG_ROOT = resolve(__dirname, '..');                  // forgeflow-games/
const CLAW_ROOT = resolve(FFG_ROOT, '..');                  // Claude Claw/
const OUT_DIR = resolve(FFG_ROOT, 'asset_gen', 'understone', 'raw');
const ENDPOINT = 'https://api.x.ai/v1/images/generations';
const MODEL = 'grok-imagine-image';

function getKey() {
  const envKey = process.env.CLAW_XAI_API_KEY;
  if (envKey) return envKey;
  const tokens = JSON.parse(readFileSync(resolve(CLAW_ROOT, 'state', '.secrets', 'tokens.json'), 'utf-8'));
  if (!tokens.xai_api_key) throw new Error('xai_api_key missing from state/.secrets/tokens.json');
  return tokens.xai_api_key;
}

const args = process.argv.slice(2);
function argVal(name, dflt = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const DRY = args.includes('--dry-run');
const manifestPath = argVal('--manifest', resolve(__dirname, 'understone_assets_manifest.json'));
const only = argVal('--only')?.split(',').map(s => s.trim()).filter(Boolean) ?? null;
const force = args.includes('--force');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
let entries = Object.entries(manifest.assets);
if (only) entries = entries.filter(([k]) => only.includes(k));

async function genOne(key, prompt, apiKey, attempt = 1) {
  const body = JSON.stringify({ model: MODEL, prompt, n: 1, response_format: 'b64_json' });
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body,
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`HTTP ${res.status} after ${attempt} attempts`);
    const wait = 2 ** attempt * 1000;
    console.log(`  [${key}] HTTP ${res.status} — retry in ${wait / 1000}s`);
    await new Promise(r => setTimeout(r, wait));
    return genOne(key, prompt, apiKey, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const item = data.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) {
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error(`image download HTTP ${imgRes.status}`);
    return Buffer.from(await imgRes.arrayBuffer());
  }
  throw new Error(`no image in response: ${JSON.stringify(data).slice(0, 200)}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const apiKey = DRY ? null : getKey();
  const results = [];
  let generated = 0, skipped = 0, failed = 0;

  console.log(`[gen] ${entries.length} manifest entries (dry=${DRY})`);
  for (const [key, spec] of entries) {
    const outPath = resolve(OUT_DIR, `${key}.png`);
    if (!force && existsSync(outPath)) {
      skipped++;
      results.push({ key, status: 'exists' });
      continue;
    }
    const prompt = `${manifest.stylePrefix ?? ''} ${spec.prompt} ${manifest.styleSuffix ?? ''}`.trim();
    if (DRY) {
      console.log(`  [dry] ${key}: ${prompt.slice(0, 140)}…`);
      continue;
    }
    try {
      const buf = await genOne(key, prompt, apiKey);
      writeFileSync(outPath, buf);
      generated++;
      results.push({ key, status: 'ok', bytes: buf.length });
      console.log(`  [ok] ${key} (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed++;
      results.push({ key, status: 'error', error: String(e.message ?? e) });
      console.log(`  [FAIL] ${key}: ${e.message}`);
    }
  }
  writeFileSync(resolve(OUT_DIR, 'results.json'), JSON.stringify({
    ts: new Date().toISOString(), generated, skipped, failed, costUsd: generated * 0.02, results,
  }, null, 2));
  console.log(`[gen] done: ${generated} generated, ${skipped} existing, ${failed} failed — cost $${(generated * 0.02).toFixed(2)}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
