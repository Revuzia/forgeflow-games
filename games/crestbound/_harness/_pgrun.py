"""Resilient runner: the headless page dies intermittently on this box, so retry the boot."""
import sys, os, json, traceback, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_gnasher import enter_direct, DIRECT


def run(area, body, tries=3):
    last = None
    for k in range(tries):
        try:
            with Play(area, url=DIRECT) as pl:
                enter_direct(pl)
                body(pl)
                pl.dump("gnasher_" + area)
                print("CONSOLE:", json.dumps(pl.console[:25]), flush=True)
                print("DONE", flush=True)
                return
        except Exception as e:
            last = e
            traceback.print_exc()
            print("!! boot/run attempt %d failed (%s) - retrying" % (k + 1, type(e).__name__), flush=True)
            time.sleep(4)
    print("GAVE UP:", last, flush=True)
    print("DONE", flush=True)
