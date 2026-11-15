#!/usr/bin/env python
"""Does core.setQuality() after the game's render present an empty canvas (navy3 CSS bg rgb(12,20,38))?
Registers a rAF callback AFTER the game's (same position DynRes uses: after drawWorld) that flips the DPR
every frame via setQuality, and records composited frames with a CDP screencast for --seconds.
Counts frames whose 64x36 thumbnail is >= 60 % navy3. Old code: blank frames expected; fixed code: 0."""
import argparse, base64, io, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from common import Session, add_common_args, build_url  # noqa: E402
from PIL import Image  # noqa: E402

def blankfrac(img):
    im = img.convert("RGB").resize((64, 36))
    px = list(im.getdata())
    return sum(1 for p in px if abs(p[0]-12) < 7 and abs(p[1]-20) < 7 and abs(p[2]-38) < 7) / len(px)

def main():
    ap = argparse.ArgumentParser(); add_common_args(ap)
    ap.add_argument("--tag", default="x"); ap.add_argument("--seconds", type=float, default=4.0)
    ap.add_argument("--flip", type=int, default=1, help="1 = flip DPR every frame after render; 0 = control")
    args = ap.parse_args()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"); os.makedirs(out, exist_ok=True)
    with Session(args, "blankprobe") as s:
        s.goto(build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=1, noslate=1, dynres=0))
        s.wait_bt(90); s.wait_screen(("play",), 90); time.sleep(2.0)
        cdp = s.page.context.new_cdp_session(s.page)
        frames = []
        def on_frame(p):
            frames.append(p["data"])
            try: cdp.send("Page.screencastFrameAck", {"sessionId": p["sessionId"]})
            except Exception: pass
        cdp.on("Page.screencastFrame", on_frame)
        cdp.send("Page.startScreencast", {"format": "png", "everyNthFrame": 1})
        if args.flip:
            s.js("""() => { const c = __BT__.debugCore; let n = 0; window.__flipOn = true;
              const tick = () => { if (!window.__flipOn) return; requestAnimationFrame(tick);
                const q = Object.assign({}, c.quality); q.dpr = (n++ & 1) ? 1.0 : 0.8; c.setQuality(q); };
              requestAnimationFrame(tick); }""")
        t0 = time.time()
        while time.time() - t0 < args.seconds:
            s.page.wait_for_timeout(100)
        cdp.send("Page.stopScreencast")
        s.js("() => { window.__flipOn = false; }")
        blanks = 0; first = None
        for i, d in enumerate(frames):
            img = Image.open(io.BytesIO(base64.b64decode(d)))
            if blankfrac(img) >= 0.6:
                blanks += 1
                if first is None:
                    first = os.path.join(out, f"{args.tag}_blank_frame.png"); img.save(first)
        last = os.path.join(out, f"{args.tag}_last_frame.png")
        if frames: Image.open(io.BytesIO(base64.b64decode(frames[-1]))).save(last)
        errs = [c for c in s.console if c[0] == "error"] + s.page_errors
        print(f"[{args.tag}] flip={args.flip} screencast frames {len(frames)} · blank (>=60% navy3) {blanks} · first blank {first} · errors {len(errs)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
