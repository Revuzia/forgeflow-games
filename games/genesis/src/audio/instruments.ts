// GENESIS — the instruments of the cultures' music (CONTRACT §17): bone flutes and log drums, hummed chants and
// drones; lyres, harps, fiddles and bowed strings; horns, brass, pipe organ, pizzicato bass and timpani; analog-style
// synth leads, arpeggios, pads and sub bass; the glass bells of the orbital score. Each is a few WebAudio nodes per
// note, built at the note's time and stopped at its end (plucked strings play Karplus–Strong buffers from the bank).
// `bright` (0..1, from the culture's alignment) opens or darkens the filters: benevolent music shines, fearful music
// is muffled and heavy.

import type { InstrumentId, PercId } from './music.ts';
import { midiToHz } from './music.ts';
import type { BufferBank } from './bank.ts';
import { BELL_BASE, PLUCKS, pluckRoot } from './bank.ts';
import { bq, bufSrc, envelope, glide, organWave, osc } from './synth.ts';

export interface NoteCtx {
  ctx: BaseAudioContext;
  bank: BufferBank;
  out: AudioNode;
  /** 0..1 dark .. bright */
  bright: number;
  r: () => number;
}

function amp(g: GainNode, t: number, a: number, hold: number, rel: number, peak: number): number {
  return envelope(g.gain, t, a, hold, rel, peak);
}

function vibrato(n: NoteCtx, o: OscillatorNode, t: number, end: number, rate: number, cents: number, delay: number): void {
  const lfo = osc(n.ctx, 'sine', rate * (0.95 + 0.1 * n.r()), t, end);
  const d = n.ctx.createGain();
  d.gain.setValueAtTime(0, t);
  d.gain.linearRampToValueAtTime(cents, t + delay + 0.2);
  lfo.connect(d);
  d.connect(o.detune);
}

function noiseBurst(n: NoteCtx, color: string, t: number, a: number, d: number, peak: number, type: BiquadFilterType, f: number, q = 1, dest?: AudioNode): number {
  const buf = n.bank.get(color);
  if (!buf) return t;
  const end = t + a + d;
  const s = bufSrc(n.ctx, buf, t, end, 1, true, n.r() * buf.duration);
  const fl = bq(n.ctx, type, f, q);
  const g = n.ctx.createGain();
  amp(g, t, a, 0, d, peak);
  s.connect(fl); fl.connect(g); g.connect(dest ?? n.out);
  return end;
}

function pluck(n: NoteCtx, inst: string, t: number, dur: number, midi: number, vel: number, lp: number): number {
  const root = pluckRoot(midi);
  const buf = n.bank.get(`pluck:${inst}:${root}`);
  if (!buf) return t;
  const rate = Math.pow(2, (midi - root) / 12);
  const len = Math.min(buf.duration / rate, dur + (PLUCKS[inst]?.decay ?? 2) * 0.6);
  const end = t + len;
  const s = bufSrc(n.ctx, buf, t, end, rate);
  const f = bq(n.ctx, 'lowpass', lp, 0.6);
  const g = n.ctx.createGain();
  g.gain.setValueAtTime(vel, t);
  g.gain.setValueAtTime(vel, Math.max(t, end - 0.08));
  g.gain.linearRampToValueAtTime(0, end);
  s.connect(f); f.connect(g); g.connect(n.out);
  return end;
}

/** play one note; returns when it has fully decayed */
export function playNote(n: NoteCtx, inst: InstrumentId | PercId, t: number, dur: number, midi: number, vel: number): number {
  const c = n.ctx;
  const hz = midiToHz(midi);
  const br = n.bright;
  switch (inst) {
    // ── era 0: drums and flutes ──
    case 'flute': {
      const end = t + dur + 0.15;
      const o = osc(c, 'sine', hz, t, end);
      const o2 = osc(c, 'triangle', hz * 2, t, end);
      vibrato(n, o, t, end, 5.2, 9, 0.25);
      const g = c.createGain(), g2 = c.createGain();
      amp(g, t, 0.06, Math.max(0, dur - 0.06), 0.15, 0.32 * vel);
      amp(g2, t, 0.06, Math.max(0, dur - 0.06), 0.15, 0.05 * vel);
      o.connect(g); o2.connect(g2); g.connect(n.out); g2.connect(n.out);
      noiseBurst(n, 'white', t, 0.01, 0.07, 0.06 * vel, 'bandpass', Math.min(9000, hz * 2.2), 1.5);
      noiseBurst(n, 'pink', t, 0.08, Math.max(0.05, dur), 0.025 * vel, 'bandpass', 2400, 1.2);
      return end;
    }
    case 'voice': {
      // a hummed (benevolent) or chanted (fearful) line: sawtooth through two vowel formants
      const end = t + dur + 0.4;
      const vowel = br > 0.45 ? [380, 900] : [650, 1080];
      const o1 = osc(c, 'sawtooth', hz, t, end, -5), o2 = osc(c, 'sawtooth', hz, t, end, 6);
      const f1 = bq(c, 'bandpass', vowel[0], 5), f2 = bq(c, 'bandpass', vowel[1], 7);
      const g = c.createGain();
      amp(g, t, 0.25, Math.max(0, dur - 0.25), 0.4, 0.5 * vel);
      o1.connect(f1); o2.connect(f1); o1.connect(f2); o2.connect(f2); f1.connect(g); f2.connect(g); g.connect(n.out);
      return end;
    }
    case 'drone': {
      const end = t + dur + 0.9;
      const lp = bq(c, 'lowpass', 260 + 260 * br, 0.8);
      const g = c.createGain();
      amp(g, t, 0.6, Math.max(0, dur - 0.4), 0.9, 0.16 * vel);
      for (const dt of [-8, 7]) osc(c, 'sawtooth', hz, t, end, dt).connect(lp);
      lp.connect(g); g.connect(n.out);
      return end;
    }
    case 'logdrum': {
      const buf = n.bank.get('wood');
      if (!buf) return t;
      const end = t + 0.4;
      const s = bufSrc(c, buf, t, end, hz / BELL_BASE.wood);
      const g = c.createGain(); g.gain.value = 0.55 * vel;
      s.connect(g); g.connect(n.out);
      return end;
    }
    case 'framedrum': {
      const end = t + 0.45;
      const o = osc(c, 'sine', 96, t, end);
      glide(o.frequency, t, 96, 60, 0.07);
      const g = c.createGain();
      amp(g, t, 0.002, 0, 0.38, 0.55 * vel);
      o.connect(g); g.connect(n.out);
      noiseBurst(n, 'pink', t, 0.001, 0.06, 0.22 * vel, 'bandpass', 850, 1.2);
      return end;
    }
    case 'shaker': return noiseBurst(n, 'white', t + (n.r() - 0.5) * 0.006, 0.006, 0.06, 0.12 * vel, 'highpass', 6000, 0.7);

    // ── era 1: lyres and strings ──
    case 'lyre': return pluck(n, 'lyre', t, dur, midi, 0.5 * vel, 2400 + 3600 * br);
    case 'harp': return pluck(n, 'harp', t, dur, midi, 0.55 * vel, 1600 + 2000 * br);
    case 'pizz': return pluck(n, 'pizz', t, dur, midi, 0.6 * vel, 1400 + 1400 * br);
    case 'fiddle': {
      const end = t + dur + 0.25;
      const o1 = osc(c, 'sawtooth', hz, t, end), o2 = osc(c, 'sawtooth', hz, t, end, 5);
      vibrato(n, o1, t, end, 5.6, 12, 0.18);
      const lp = bq(c, 'lowpass', hz * 3, 1.1);
      lp.frequency.setValueAtTime(hz * 2, t);
      lp.frequency.linearRampToValueAtTime(hz * (3 + 2 * br), t + 0.15);
      const body = bq(c, 'peaking', 520, 1.5, 4);
      const g = c.createGain();
      amp(g, t, 0.12, Math.max(0, dur - 0.12), 0.25, 0.12 * vel);
      o1.connect(lp); o2.connect(lp); lp.connect(body); body.connect(g); g.connect(n.out);
      return end;
    }
    case 'strings': {
      const end = t + dur + 0.9;
      const lp = bq(c, 'lowpass', 1300 + 1300 * br, 0.7);
      const g = c.createGain();
      amp(g, t, 0.5, Math.max(0, dur - 0.4), 0.9, 0.075 * vel);
      for (const dt of [-9, 0, 8]) osc(c, 'sawtooth', hz, t, end, dt).connect(lp);
      lp.connect(g); g.connect(n.out);
      return end;
    }
    case 'tabor': {
      const end = t + 0.3;
      const o = osc(c, 'sine', 165, t, end);
      glide(o.frequency, t, 165, 112, 0.05);
      const g = c.createGain();
      amp(g, t, 0.002, 0, 0.2, 0.42 * vel);
      o.connect(g); g.connect(n.out);
      noiseBurst(n, 'white', t, 0.001, 0.12, 0.14 * vel, 'bandpass', 2100, 0.9);
      return end;
    }

    // ── era 2: brass and organ ──
    case 'horn': case 'brass': {
      const stab = inst === 'brass';
      const end = t + dur + 0.2;
      const o1 = osc(c, 'sawtooth', hz, t, end), o2 = osc(c, 'sawtooth', hz, t, end, 6);
      o1.detune.setValueAtTime(-35, t);
      o1.detune.linearRampToValueAtTime(0, t + 0.06);
      if (!stab) vibrato(n, o2, t, end, 5, 8, 0.3);
      const lp = bq(c, 'lowpass', hz, 1.3);
      lp.frequency.setValueAtTime(hz * 1.1, t);
      lp.frequency.linearRampToValueAtTime(hz * (3.5 + 3 * br), t + (stab ? 0.04 : 0.09));
      lp.frequency.setTargetAtTime(hz * (2.2 + 1.5 * br), t + 0.12, 0.25);
      const g = c.createGain();
      amp(g, t, stab ? 0.025 : 0.05, Math.max(0, dur - 0.05), stab ? 0.1 : 0.18, (stab ? 0.08 : 0.11) * vel);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(n.out);
      return end;
    }
    case 'organ': {
      const end = t + dur + 0.15;
      const w = organWave(c);
      const lp = bq(c, 'lowpass', 2500 + 3000 * br, 0.5);
      const g = c.createGain();
      amp(g, t, 0.04, Math.max(0, dur - 0.04), 0.14, 0.07 * vel);
      osc(c, w, hz, t, end).connect(lp);
      osc(c, w, hz, t, end, 4).connect(lp);
      lp.connect(g); g.connect(n.out);
      return end;
    }
    case 'timpani': {
      const end = t + 1.8;
      const o = osc(c, 'sine', hz, t, end);
      glide(o.frequency, t, hz * 1.04, hz, 0.12);
      const o2 = osc(c, 'triangle', hz * 1.5, t, end);
      const g = c.createGain(), g2 = c.createGain();
      amp(g, t, 0.003, 0, 1.6, 0.5 * vel);
      amp(g2, t, 0.003, 0, 0.6, 0.12 * vel);
      o.connect(g); o2.connect(g2); g.connect(n.out); g2.connect(n.out);
      noiseBurst(n, 'brown', t, 0.002, 0.15, 0.3 * vel, 'lowpass', 400);
      return end;
    }
    case 'snare': {
      const end = t + 0.2;
      noiseBurst(n, 'white', t, 0.001, 0.16, 0.22 * vel, 'bandpass', 1900, 0.7);
      const o = osc(c, 'triangle', 190, t, end);
      const g = c.createGain();
      amp(g, t, 0.001, 0, 0.08, 0.2 * vel);
      o.connect(g); g.connect(n.out);
      return end;
    }

    // ── era 3: synth ──
    case 'lead': {
      const end = t + dur + 0.2;
      const o1 = osc(c, 'square', hz, t, end), o2 = osc(c, 'sawtooth', hz, t, end, 9);
      vibrato(n, o2, t, end, 5.5, 6, 0.35);
      const lp = bq(c, 'lowpass', hz * 2, 4 + 3 * br);
      lp.frequency.setValueAtTime(hz * 2, t);
      lp.frequency.linearRampToValueAtTime(Math.min(12000, hz * (6 + 4 * br)), t + 0.03);
      lp.frequency.setTargetAtTime(hz * 3, t + 0.05, 0.15);
      const g = c.createGain();
      amp(g, t, 0.01, Math.max(0, dur - 0.01), 0.18, 0.07 * vel);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(n.out);
      return end;
    }
    case 'arp': {
      const end = t + 0.25;
      const o = osc(c, 'square', hz, t, end);
      const lp = bq(c, 'lowpass', hz * 5, 3);
      lp.frequency.setValueAtTime(hz * 6, t);
      lp.frequency.setTargetAtTime(hz * 1.5, t, 0.05);
      const g = c.createGain();
      amp(g, t, 0.003, 0, 0.2, 0.05 * vel);
      o.connect(lp); lp.connect(g); g.connect(n.out);
      return end;
    }
    case 'synthpad': {
      const end = t + dur + 1.6;
      const lp = bq(c, 'lowpass', 700 + 900 * br, 1.2);
      const lfo = osc(c, 'sine', 0.15 + 0.1 * n.r(), t, end);
      const ld = c.createGain(); ld.gain.value = 250;
      lfo.connect(ld); ld.connect(lp.frequency);
      const g = c.createGain();
      amp(g, t, 0.8, Math.max(0, dur - 0.6), 1.6, 0.06 * vel);
      for (const dt of [-12, 0, 11]) osc(c, 'sawtooth', hz, t, end, dt).connect(lp);
      lp.connect(g); g.connect(n.out);
      return end;
    }
    case 'subbass': {
      const end = t + dur + 0.3;
      const o = osc(c, 'sine', hz, t, end), o2 = osc(c, 'triangle', hz, t, end);
      const g = c.createGain(), g2 = c.createGain();
      amp(g, t, 0.02, Math.max(0, dur - 0.02), 0.3, 0.2 * vel);
      amp(g2, t, 0.02, Math.max(0, dur - 0.02), 0.3, 0.07 * vel);
      o.connect(g); o2.connect(g2); g.connect(n.out); g2.connect(n.out);
      return end;
    }
    case 'kick': {
      const end = t + 0.45;
      const o = osc(c, 'sine', 140, t, end);
      glide(o.frequency, t, 140, 42, 0.09);
      const g = c.createGain();
      amp(g, t, 0.002, 0, 0.36, 0.6 * vel);
      o.connect(g); g.connect(n.out);
      return end;
    }
    case 'hat': return noiseBurst(n, 'white', t, 0.001, 0.045, 0.1 * vel, 'highpass', 8000, 0.7);
    case 'clap': {
      for (let i = 0; i < 3; i++) noiseBurst(n, 'white', t + i * 0.011, 0.001, i === 2 ? 0.16 : 0.02, 0.16 * vel, 'bandpass', 1200, 0.9);
      return t + 0.25;
    }
    case 'wardrum': {
      const end = t + 1.1;
      const o = osc(c, 'sine', 74, t, end);
      glide(o.frequency, t, 74, 41, 0.18);
      const g = c.createGain();
      amp(g, t, 0.003, 0, 0.95, 0.6 * vel);
      o.connect(g); g.connect(n.out);
      noiseBurst(n, 'brown', t, 0.002, 0.3, 0.45 * vel, 'lowpass', 320);
      noiseBurst(n, 'pink', t, 0.001, 0.05, 0.15 * vel, 'bandpass', 700, 1);
      return end;
    }

    // ── the orbital score ──
    case 'bell': {
      const buf = n.bank.get('glass');
      if (!buf) return t;
      const rate = hz / BELL_BASE.glass;
      const end = t + Math.min(buf.duration / rate, dur + 2.5);
      const s = bufSrc(c, buf, t, end, rate);
      const g = c.createGain(); g.gain.value = 0.45 * vel;
      s.connect(g); g.connect(n.out);
      return end;
    }
    case 'glass': {
      const end = t + dur + 1.2;
      const o = osc(c, 'sine', hz, t, end), o2 = osc(c, 'sine', hz * 2.005, t, end);
      const g = c.createGain(), g2 = c.createGain();
      amp(g, t, 0.2, Math.max(0, dur - 0.2), 1.2, 0.12 * vel);
      amp(g2, t, 0.25, Math.max(0, dur - 0.3), 0.9, 0.03 * vel);
      o.connect(g); o2.connect(g2); g.connect(n.out); g2.connect(n.out);
      return end;
    }
    case 'glasspad': {
      const end = t + dur + 2.5;
      const lp = bq(c, 'lowpass', 2400, 0.6);
      const g = c.createGain();
      amp(g, t, 1.4, Math.max(0, dur - 1.2), 2.5, 0.07 * vel);
      osc(c, 'sine', hz, t, end, -3).connect(lp);
      osc(c, 'triangle', hz, t, end, 4).connect(lp);
      osc(c, 'sine', hz * 2, t, end, 2).connect(lp);
      lp.connect(g); g.connect(n.out);
      return end;
    }
  }
  return t;
}

/** the bank buffers an ensemble needs before it can play (queued as soon as a culture comes into earshot) */
export function buffersFor(insts: string[], tonic: number): string[] {
  const out = new Set<string>(['white', 'pink', 'brown']);
  for (const i of insts) {
    if (i === 'lyre' || i === 'harp' || i === 'pizz') {
      for (let m = tonic - 30; m <= tonic + 30; m += 6) out.add(`pluck:${i}:${pluckRoot(m)}`);
    }
    if (i === 'logdrum') out.add('wood');
    if (i === 'bell') out.add('glass');
  }
  return [...out];
}
