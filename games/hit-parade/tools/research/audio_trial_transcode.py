"""Trial-transcode the audio kit's primary picks to measure the real shipped size.

Usage: python audio_trial_transcode.py <audio_kit.json> <scratch_dir> <out_sizes.json>

For every candidate with "ship": true in audio_kit.json, runs ffmpeg with the
role's transcode profile, applying the candidate's slice (start_ms/end_ms) if
given, writes the result into <scratch_dir> (outside the repo), records the
output byte size, then deletes the file. Profiles (libopus in .ogg):
  sfx_mono   : mono, 48 kHz, 48 kbps VBR  (-application audio)
  sfx_stereo : stereo, 48 kHz, 64 kbps VBR
  bed_stereo : stereo, 48 kHz, 64 kbps VBR (crowd loops)
  music      : stereo, 48 kHz, 80 kbps VBR
  jingle     : stereo, 48 kHz, 96 kbps VBR
Also transcodes the same inputs to AAC-LC .m4a (fallback set) at matching
bitrates when --aac is passed. ASCII only.
"""
import sys, os, json, subprocess

PROFILES = {
    "sfx_mono": ["-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "48k", "-vbr", "on", "-application", "audio"],
    "sfx_stereo": ["-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "64k", "-vbr", "on", "-application", "audio"],
    "bed_stereo": ["-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "64k", "-vbr", "on", "-application", "audio"],
    "music": ["-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "80k", "-vbr", "on", "-application", "audio"],
    "jingle": ["-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "96k", "-vbr", "on", "-application", "audio"],
}
AAC = {
    "sfx_mono": ["-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "64k"],
    "sfx_stereo": ["-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "96k"],
    "bed_stereo": ["-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "96k"],
    "music": ["-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "112k"],
    "jingle": ["-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "128k"],
}


def enc(src, dst, prof, start_ms=None, end_ms=None, table=PROFILES):
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y"]
    if start_ms is not None:
        cmd += ["-ss", "%.3f" % (start_ms / 1000.0)]
    if end_ms is not None:
        cmd += ["-to", "%.3f" % (end_ms / 1000.0)]
    cmd += ["-i", src, "-map", "0:a:0", "-vn", "-map_metadata", "-1"] + table[prof] + [dst]
    p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0 or not os.path.exists(dst):
        return None, p.stderr.decode("utf-8", "replace")[-300:]
    n = os.path.getsize(dst)
    return n, None


def main():
    kit = json.load(open(sys.argv[1], encoding="utf-8"))
    scratch = sys.argv[2]
    out = sys.argv[3]
    do_aac = "--aac" in sys.argv
    os.makedirs(scratch, exist_ok=True)
    res = []
    k = 0
    for role in kit["roles"]:
        for c in role["candidates"]:
            if not c.get("ship"):
                continue
            prof = c.get("profile") or role.get("profile") or "sfx_mono"
            k += 1
            dst = os.path.join(scratch, "t%04d.ogg" % k)
            n, err = enc(c["path"], dst, prof, c.get("start_ms"), c.get("end_ms"))
            rec = {"role": role["id"], "path": c["path"], "profile": prof,
                   "start_ms": c.get("start_ms"), "end_ms": c.get("end_ms"), "opus_bytes": n, "error": err}
            if os.path.exists(dst):
                os.remove(dst)
            if do_aac:
                dst2 = os.path.join(scratch, "t%04d.m4a" % k)
                n2, err2 = enc(c["path"], dst2, prof, c.get("start_ms"), c.get("end_ms"), AAC)
                rec["aac_bytes"] = n2
                if err2:
                    rec["aac_error"] = err2
                if os.path.exists(dst2):
                    os.remove(dst2)
            res.append(rec)
            print(role["id"], prof, n, os.path.basename(c["path"])[:60], flush=True)
    # sprite trial: all shipped sfx_mono items concatenated (100 ms gaps) into ONE opus file
    import numpy as np
    chunks = []
    for role in kit["roles"]:
        for c in role["candidates"]:
            prof = c.get("profile") or role.get("profile") or "sfx_mono"
            if not c.get("ship") or prof != "sfx_mono":
                continue
            cmd = ["ffmpeg", "-nostdin", "-v", "error"]
            if c.get("start_ms") is not None:
                cmd += ["-ss", "%.3f" % (c["start_ms"] / 1000.0), "-to", "%.3f" % (c["end_ms"] / 1000.0)]
            cmd += ["-i", c["path"], "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]
            p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            chunks.append(np.frombuffer(p.stdout, dtype=np.float32))
            chunks.append(np.zeros(4800, dtype=np.float32))
    raw = np.concatenate(chunks).astype(np.float32).tobytes()
    dst = os.path.join(scratch, "sprite_sfx.ogg")
    p = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", "-",
                        "-c:a", "libopus", "-b:a", "48k", "-vbr", "on", "-application", "audio", dst],
                       input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    sprite = {"items": sum(1 for x in chunks if len(x) != 4800 or True) // 2, "seconds": round(len(raw) / 4 / 48000.0, 2),
              "opus_bytes": os.path.getsize(dst) if os.path.exists(dst) else None}
    if os.path.exists(dst):
        os.remove(dst)
    print("sprite", sprite)
    json.dump({"files": res, "sprite_sfx_mono": sprite}, open(out, "w", encoding="utf-8"), indent=1)
    tot = sum(r["opus_bytes"] or 0 for r in res)
    print("files", len(res), "opus total bytes", tot)
    if do_aac:
        print("aac total bytes", sum(r.get("aac_bytes") or 0 for r in res))


if __name__ == "__main__":
    main()
