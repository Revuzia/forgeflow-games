// Per-agent token and time accounting from the workflow transcripts.
// usage: node agentstats.mjs [sinceISO]   (prints one row per agent, grouped by workflow)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'C:/Users/TestRun/.claude/projects/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/subagents/workflows';
const since = process.argv[2] ? Date.parse(process.argv[2]) : 0;
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n));
const hrs = (ms) => (ms / 3.6e6).toFixed(2) + 'h';

const out = [];
for (const wf of readdirSync(ROOT)) {
  const dir = join(ROOT, wf);
  if (!statSync(dir).isDirectory()) continue;
  // labels from the journal (best effort)
  const labels = {};
  const jp = join(dir, 'journal.jsonl');
  if (existsSync(jp)) {
    for (const line of readFileSync(jp, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const id = j.agentId ?? j.id ?? j.agent_id;
        const label = j.label ?? j.opts?.label ?? j.name;
        if (id && label) labels[String(id).replace(/^agent-/, '')] = label;
      } catch { /* ignore */ }
    }
  }
  for (const f of readdirSync(dir)) {
    if (!/^agent-.*\.jsonl$/.test(f)) continue;
    const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const p = join(dir, f);
    let first = Infinity, last = 0, turns = 0, tools = 0, outTok = 0, inTok = 0, cw = 0, cr = 0;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const t = Date.parse(j.timestamp ?? '');
      if (!Number.isNaN(t)) { if (t < first) first = t; if (t > last) last = t; }
      if (j.type === 'assistant' && j.message) {
        turns++;
        const u = j.message.usage;
        if (u) { outTok += u.output_tokens ?? 0; inTok += u.input_tokens ?? 0; cw += u.cache_creation_input_tokens ?? 0; cr += u.cache_read_input_tokens ?? 0; }
        for (const c of j.message.content ?? []) if (c.type === 'tool_use') tools++;
      }
    }
    if (first === Infinity || first < since) continue;
    const mtime = statSync(p).mtimeMs;
    out.push({ wf, id, label: labels[id] ?? '', first, last, wall: last - first, turns, tools, outTok, inTok, cw, cr, mtime });
  }
}
out.sort((a, b) => a.wf.localeCompare(b.wf) || a.first - b.first);
const now = Date.now();
let cur = '';
const tot = { out: 0, inT: 0, cw: 0, cr: 0 };
for (const r of out) {
  if (r.wf !== cur) { cur = r.wf; console.log('\n== ' + r.wf); }
  const active = now - r.mtime < 10 * 60 * 1000 ? 'RUNNING' : 'done';
  console.log(`${r.id.slice(0, 8)} ${active.padEnd(7)} ${(r.label || '-').padEnd(22)} start ${new Date(r.first).toISOString().slice(5, 16)}Z wall ${hrs(r.wall).padStart(6)} turns ${String(r.turns).padStart(4)} tools ${String(r.tools).padStart(4)}  out ${fmt(r.outTok).padStart(6)}  newIn ${fmt(r.inTok + r.cw).padStart(6)}  cacheRead ${fmt(r.cr).padStart(7)}`);
  tot.out += r.outTok; tot.inT += r.inTok + r.cw; tot.cr += r.cr;
}
console.log(`\nTOTAL output ${fmt(tot.out)}  new input (uncached + cache writes) ${fmt(tot.inT)}  cache reads ${fmt(tot.cr)}  agents ${out.length}`);
