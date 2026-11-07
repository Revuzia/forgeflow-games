// VALE audio — a long Ogg Opus stem held COMPRESSED and decoded by windows (round 5 AUD-4; src/audio/index.ts `stream`).
//
// A match bed's main stem and combat layer are 160 s of 48 kHz stereo each: decoded whole, 61 MB of float PCM apiece.
// Played by sections, only the playing section and the next are ever needed, so the engine keeps the file's bytes
// (about 2.5 MB) and decodes a window [a, b) of the stem's timeline when it is wanted, with WebCodecs' AudioDecoder:
//   demux     the Ogg pages are split into Opus packets once (RFC 7845: OpusHead, OpusTags, then audio packets; a
//             packet's length in samples from its TOC, RFC 6716 §3.1), each with its start on the decoded timeline
//             (granule samples − pre-skip: the timeline decodeAudioData gives, the pre-skip trimmed)
//   window    decoding starts PREROLL_S before `a` (RFC 7845 §4.6: the decoder converges within 80 ms of a cold
//             start; 4x that here), the output is placed by counting frames from that packet's start, and only
//             [a, b) is kept: the window's samples are the whole decode's within the decoder's own noise (the
//             probe _harness/fw_r5_aud_stream.mjs measures it against decodeAudioData). A window past either end of
//             the stem wraps (the stem is a loop)
// No content id lives here; the engine decides what is streamed and when.

/** one Opus packet: byte range in the file, and its start on the decoded timeline (samples, pre-skip trimmed) */
interface Packet { data: Uint8Array; at: number; len: number }

const PREROLL_S = 0.32;
const SR = 48000;

/** a packet's length in samples at 48 kHz from its TOC byte (and frame count byte for code 3) */
function packetSamples(d: Uint8Array): number {
  const n = d.length;
  if (n < 1) return 0;
  const toc = d[0];
  const cfg = toc >> 3;
  let fs: number;
  if (cfg < 12) fs = [480, 960, 1920, 2880][cfg & 3];             // SILK: 10, 20, 40, 60 ms
  else if (cfg < 16) fs = [480, 960][cfg & 1];                     // hybrid: 10, 20 ms
  else fs = [120, 240, 480, 960][cfg & 3];                         // CELT: 2.5, 5, 10, 20 ms
  const code = toc & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : n > 1 ? d[1] & 0x3f : 0;
  return fs * frames;
}

export class OpusStem {
  readonly channels: number;
  /** the decoded timeline's length (samples, 48 kHz) */
  readonly length: number;
  private readonly data: Uint8Array;
  private readonly packets: Packet[];

  private constructor(data: Uint8Array, channels: number, packets: Packet[], length: number) {
    this.data = data; this.channels = channels; this.packets = packets; this.length = length;
  }

  get duration(): number { return this.length / SR; }
  /** the compressed bytes held */
  get bytes(): number { return this.data.byteLength; }

  /** whether this platform can stream (WebCodecs' AudioDecoder decoding Opus at 48 kHz stereo) */
  static async supported(channels = 2): Promise<boolean> {
    const AD = (globalThis as { AudioDecoder?: typeof AudioDecoder }).AudioDecoder;
    if (!AD) return false;
    try { return !!(await AD.isConfigSupported({ codec: 'opus', sampleRate: SR, numberOfChannels: channels })).supported; } catch { return false; }
  }

  /** the stem from an Ogg Opus file's bytes; null when it is not one this can read (one logical stream, mono or stereo) */
  static parse(buf: ArrayBuffer): OpusStem | null {
    const d = new Uint8Array(buf);
    const raw: Uint8Array[] = [];
    let parts: Uint8Array[] = [];                         // the packet being assembled (it may run on over pages)
    let serial = -1, p = 0, lastGranule = -1;
    while (p + 27 <= d.length) {
      if (d[p] !== 0x4f || d[p + 1] !== 0x67 || d[p + 2] !== 0x67 || d[p + 3] !== 0x53) return null;   // 'OggS'
      const dv = new DataView(buf, p);
      const lo = dv.getUint32(6, true), hi = dv.getInt32(10, true);
      const ser = dv.getUint32(14, true);
      if (serial < 0) serial = ser; else if (ser !== serial) return null;
      const segs = d[p + 26];
      let body = p + 27 + segs;
      for (let i = 0; i < segs; i++) {
        const l = d[p + 27 + i];
        if (body + l > d.length) return null;
        parts.push(d.subarray(body, body + l));
        body += l;
        if (l < 255) {                                    // the packet ends here
          if (parts.length === 1) raw.push(parts[0]);
          else {                                          // laced over 255-byte segments: contiguous within a page, copied when not
            const n = parts.reduce((t, x) => t + x.length, 0);
            const first = parts[0];
            const contiguous = parts.every((x, j) => j === 0 || x.byteOffset === parts[j - 1].byteOffset + parts[j - 1].length);
            if (contiguous) raw.push(d.subarray(first.byteOffset, first.byteOffset + n));
            else { const c = new Uint8Array(n); let q = 0; for (const x of parts) { c.set(x, q); q += x.length; } raw.push(c); }
          }
          parts = [];
        }
      }
      if (hi >= 0 && !(hi === -1 && lo === 0xffffffff)) lastGranule = hi * 4294967296 + lo;
      p = body;
    }
    if (raw.length < 3 || lastGranule < 0) return null;
    const head = raw[0];
    if (head.length < 19 || String.fromCharCode(...head.subarray(0, 8)) !== 'OpusHead') return null;
    const channels = head[9], preskip = head[10] | (head[11] << 8);
    if (channels < 1 || channels > 2 || head[18] !== 0) return null;
    // the audio packets (raw[1] is OpusTags), each placed on the timeline by the sum of the lengths before it
    const packets: Packet[] = [];
    let at = -preskip;
    for (let i = 2; i < raw.length; i++) {
      const len = packetSamples(raw[i]);
      packets.push({ data: raw[i], at, len });
      at += len;
    }
    const length = lastGranule - preskip;
    if (length <= 0 || length > at) return null;
    return new OpusStem(d, channels, packets, length);
  }

  /** the window [a, b) of the timeline (samples; past either end it wraps) as an AudioBuffer of `ctx`; null on failure */
  async window(ctx: BaseAudioContext, a: number, b: number): Promise<AudioBuffer | null> {
    if (b <= a) return null;
    const out = ctx.createBuffer(this.channels, b - a, SR);
    const L = this.length;
    // split at the wraps: [a, b) → runs within [0, L) at their place in `out`
    const runs: [number, number, number][] = [];
    let pos = a, w = 0;
    while (pos < b) {
      const m = ((pos % L) + L) % L;
      const n = Math.min(b - pos, L - m);
      runs.push([m, m + n, w]);
      pos += n; w += n;
    }
    for (const [s, e, at] of runs) if (!(await this.decodeInto(out, s, e, at))) return null;
    return out;
  }

  /** decode [s, e) (within the timeline) into `out` from frame `at` */
  private decodeInto(out: AudioBuffer, s: number, e: number, at: number): Promise<boolean> {
    const AD = (globalThis as { AudioDecoder?: typeof AudioDecoder }).AudioDecoder;
    if (!AD) return Promise.resolve(false);
    const P = this.packets;
    const pre = Math.round(PREROLL_S * SR);
    // the first packet: the last one starting at or before s − preroll (or the first); the last: the one covering e
    let lo = 0, hi = P.length - 1;
    const from = s - pre;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (P[mid].at <= from) lo = mid; else hi = mid - 1; }
    const i0 = lo;
    let i1 = i0;
    while (i1 < P.length - 1 && P[i1].at + P[i1].len < e) i1++;
    const ch = this.channels;
    const dst = Array.from({ length: ch }, (_, c) => out.getChannelData(c));
    let frame = P[i0].at;                     // the timeline sample of the next output frame
    let failed = false;
    return new Promise<boolean>((resolve) => {
      const dec = new AD({
        output: (ad: AudioData) => {
          try {
            const n = ad.numberOfFrames;
            const k0 = Math.max(frame, s), k1 = Math.min(frame + n, e);
            if (k1 > k0) {
              for (let c = 0; c < ch; c++) {
                const tmp = new Float32Array(n);
                ad.copyTo(tmp, { planeIndex: Math.min(c, ad.numberOfChannels - 1), format: 'f32-planar' });
                dst[c].set(tmp.subarray(k0 - frame, k1 - frame), at + (k0 - s));
              }
            }
            frame += n;
          } catch { failed = true; } finally { ad.close(); }
        },
        error: () => { failed = true; },
      });
      try {
        dec.configure({ codec: 'opus', sampleRate: SR, numberOfChannels: ch });
        for (let i = i0; i <= i1; i++) {
          const q = P[i];
          dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((q.at / SR) * 1e6), duration: Math.round((q.len / SR) * 1e6),
            data: q.data }));
        }
        dec.flush().then(() => {
          // every frame placed where the packets say (a decoder that trimmed or padded would not land on the last
          // packet's end): else the window is wrong and the caller decodes the stem whole
          const want = P[i1].at + P[i1].len;
          try { dec.close(); } catch { /* closed */ }
          resolve(!failed && frame === want);
        }, () => { try { dec.close(); } catch { /* closed */ } resolve(false); });
      } catch { try { dec.close(); } catch { /* closed */ } resolve(false); }
    });
  }
}
