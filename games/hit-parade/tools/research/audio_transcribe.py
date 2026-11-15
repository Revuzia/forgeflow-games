"""Transcribe candidate voice lines with a LOCALLY cached faster-whisper model.
Usage: python audio_transcribe.py <paths.txt> <out.json> [--model small.en]
Runs offline (HF_HUB_OFFLINE=1, local_files_only) - never downloads.
ASCII only.
"""
import os, sys, json
os.environ["HF_HUB_OFFLINE"] = "1"
from faster_whisper import WhisperModel

paths = [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
out = sys.argv[2]
model_name = "small.en"
if "--model" in sys.argv:
    model_name = sys.argv[sys.argv.index("--model") + 1]
m = WhisperModel(model_name, device="cpu", compute_type="int8", local_files_only=True)
res = {}
if os.path.exists(out):
    res = json.load(open(out, encoding="utf-8"))
for p in paths:
    if p in res:
        continue
    try:
        segs, info = m.transcribe(p, beam_size=5, language="en", vad_filter=False)
        text = " ".join(s.text.strip() for s in segs).strip()
        res[p] = {"text": text, "duration_s": round(info.duration, 2)}
    except Exception as e:
        res[p] = {"error": repr(e)[:200]}
    print(json.dumps({os.path.basename(p): res[p]}), flush=True)
    json.dump(res, open(out, "w", encoding="utf-8"), indent=1)
