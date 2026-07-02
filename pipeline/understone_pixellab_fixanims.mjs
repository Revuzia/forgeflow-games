#!/usr/bin/env node
// Fix-up pass: per-body-type template candidates, skipping anims that already exist
// server-side. 422 = free probe; success = 1 gen. Downloads everything at the end.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(__dirname, '..', 'games', 'understone');
const KEY = JSON.parse(readFileSync(resolve(process.env.APPDATA, 'Nomi', 'api_config.json'), 'utf-8')).pixellab.api_key;
const state = JSON.parse(readFileSync(resolve(__dirname, 'understone_pixellab_state.json'), 'utf-8'));

const api = async (path, body, method = 'POST') => {
  const res = await fetch(`https://api.pixellab.ai/v2${path}`, {
    method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

// desired roles → candidate template ids, in preference order, per body type
const PLAN = {
  humanoid: { move: ['walk'], idle: ['breathing-idle'], attack: ['attack', 'attack-right', 'cross-punch'] },
  dog: { move: ['fast-walk', 'running'], idle: ['idle'], attack: ['attack', 'angry', 'bark'] },
  cat: { move: ['fast-walk', 'walk', 'running'], idle: ['idle'], attack: ['attack', 'angry'] },
};
const BODY = { iceWolf: 'dog', vulture: 'cat' };

const poll = async (jobId, label) => {
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const { data } = await api(`/background-jobs/${jobId}`, null, 'GET');
    if (data?.status === 'completed') return true;
    if (data?.status === 'failed') { console.log(`  [fail-job] ${label}`); return false; }
  }
  return false;
};

let spent = 0;
for (const [name, rec] of Object.entries(state.characters)) {
  const { data: c } = await api(`/characters/${rec.id}`, null, 'GET');
  if (!c) { console.log(`[skip] ${name}: fetch failed`); continue; }
  const have = new Set((c.animations ?? []).map(a => a.animation_type ?? a.name));
  const plan = PLAN[BODY[name] ?? 'humanoid'];
  console.log(`[${name}] server has: ${[...have].join(', ') || 'none'}`);

  for (const [role, candidates] of Object.entries(plan)) {
    if (candidates.some(t => have.has(t))) continue;    // role already covered
    let done = false;
    for (const t of candidates) {
      const { status, data } = await api('/characters/animations', {
        character_id: rec.id, template_animation_id: t, directions: ['east'], seed: 42,
      });
      if (status === 422) continue;                     // invalid for this template — free, try next
      if (status === 409) { done = true; break; }       // already exists
      if (data?.background_job_ids?.length) {
        spent += 1;
        console.log(`  [gen] ${name}/${role} → ${t}`);
        await poll(data.background_job_ids[0], `${name}/${t}`);
        done = true;
        break;
      }
      console.log(`  [warn] ${name}/${t}: HTTP ${status}`);
    }
    if (!done) console.log(`  [none] ${name}/${role}: no candidate accepted`);
  }

  // download everything fresh
  const { data: c2 } = await api(`/characters/${rec.id}`, null, 'GET');
  const outDir = resolve(GAME, 'assets', 'entities', name === 'goblin' ? 'goblin' : name);
  mkdirSync(outDir, { recursive: true });
  const meta = { size: 64, animations: {} };
  const eastUrl = c2.rotation_urls?.east;
  if (eastUrl) writeFileSync(resolve(outDir, 'base.png'), Buffer.from(await (await fetch(eastUrl)).arrayBuffer()));
  for (const anim of c2.animations ?? []) {
    const dir = (anim.directions ?? []).find(d => d.direction === 'east') ?? anim.directions?.[0];
    if (!dir?.frames?.length) continue;
    const aName = anim.animation_type ?? anim.name ?? 'anim';
    const aDir = resolve(outDir, aName);
    mkdirSync(aDir, { recursive: true });
    for (let f = 0; f < dir.frames.length; f++) {
      writeFileSync(resolve(aDir, `frame_${String(f).padStart(3, '0')}.png`),
        Buffer.from(await (await fetch(dir.frames[f])).arrayBuffer()));
    }
    meta.animations[aName] = { frames: dir.frames.length };
  }
  writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`  [saved] ${name}: ${Object.keys(meta.animations).join(', ') || 'base only'}`);
}
console.log(`[fixanims] done — ${spent} generations spent`);
