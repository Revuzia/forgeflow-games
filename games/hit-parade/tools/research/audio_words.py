"""Word-level timestamps for one file with a locally cached faster-whisper model (offline).
Usage: python audio_words.py <audio> [model]  -> prints start/end/word. ASCII only."""
import os, sys
os.environ["HF_HUB_OFFLINE"] = "1"
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[2] if len(sys.argv) > 2 else "small.en", device="cpu", compute_type="int8", local_files_only=True)
segs, info = m.transcribe(sys.argv[1], beam_size=5, language="en", word_timestamps=True)
for s in segs:
    for w in s.words:
        print("%7.2f %7.2f %s" % (w.start, w.end, w.word.strip()))
