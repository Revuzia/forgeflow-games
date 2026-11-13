#!/usr/bin/env python
"""Turn the sweep PNGs into _shots/sweep/SWEEP.md.

Two measurements, because they answer two different questions.

1. DOES THE SLIDER MOVE THE IMAGE AT ALL — mean absolute pixel difference
   between the frames captured at the key's own values. This is the test for a
   dead setting, and it only works because the sweep runs in static-control mode
   (see sweep.py): with the clock running, two captures of one build at one
   setting differ by more than a subtle slider does.

2. DOES THE PORT'S RESPONSE CURVE MATCH — mean_luma / detail_energy /
   shadow_blue_bias as a percent change against that target's own default frame.
   The two builds differ slightly in absolute terms even at defaults, so the
   curve is what has to agree, not the values.
"""
import itertools, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import frame_stats  # noqa: E402
from sweep import SWEEP as PLAN  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, "..", "_shots", "sweep")
BANDS = ["mean_luma", "detail_energy", "shadow_blue_bias"]

# Five sweep values ARE the setting's own default, so those frames are re-shoots
# of the default frame under another name. Their spread is this harness's
# measured run-to-run noise — the floor everything else is judged against.
IDENTITY = ["default", "sunElevation_13", "sunAzimuth_118", "windDirection_42",
            "exposure_0.105", "tonemap_agx"]

# Three keys the 01-hero battery cannot judge on its own, each measured by a
# dedicated probe instead of by stretching a threshold. Values are the
# changed-pixel share those probes printed; re-run the named script to refresh.
PROBES = {
    # `probe_ridge.py`. At default haze the far range is a few hundred faint
    # pixels at 01-hero AND at 12-far-range, so the span sits level with the
    # noise floor on both targets and cannot discriminate. Clearing the haze
    # (fogDensity 0, aerialStrength 0) at the horizon framing makes it legible:
    # port 6.81% of the frame changed against the reference's 7.14%, ratio 0.95x,
    # and mean luma falls monotonically with height on both (port 0.46749 ->
    # 0.46667 -> 0.46407 for 0/1200/2400; ref 0.46728 -> 0.46627 -> 0.46364).
    "mountainHeight":
        "tracks — via `probe_ridge.py`: invisible under default haze at every "
        "01-hero/12-far-range framing, so re-measured with the haze cleared; "
        "port 6.81% vs ref 7.14% of frame changed (0.95x), luma monotone on both",
    # `probe_walk_noise.py`. These two need a cut trench, so their captures walk,
    # and the walk is NOT reproducible on the reference: three captures at one
    # value differ by 63-72% of the frame, against the port's 0.5-1.0%. The
    # reference's raw 60-73% span is therefore its own noise, not a response.
    "deformDepth":
        "port responds (2.31% against its own 1.03% walk floor); reference "
        "unmeasurable this way (72.1% walk floor) — read off the response curve, "
        "where both move the same direction by a comparable amount in all 3 bands",
    "deformBerm":
        "same as deformDepth: port 5.37% against a 1.03% floor; reference walk "
        "floor 72.1%; response curves agree in direction and magnitude",
}

_cache = {}


def img(tag, target):
    k = (tag, target)
    if k not in _cache:
        p = os.path.join(SWEEP, f"{tag}_{target}.png")
        _cache[k] = (np.asarray(Image.open(p).convert("RGB"), np.float32) / 255
                     if os.path.exists(p) else None)
    return _cache[k]


def stats_for(tag, target):
    p = os.path.join(SWEEP, f"{tag}_{target}.png")
    return frame_stats(Image.open(p)) if os.path.exists(p) else None


def dist(a, b):
    """(mean|d|, % of pixels changed by more than 2/255 in any channel).

    Both, because either alone misleads. mean|d| is blind to a change confined
    to a small part of the frame — the far range at 01-hero is a few hundred
    pixels, so a change that saturates it still averages to 1e-4 over 1280x720.
    changed-pixel share catches that but says nothing about magnitude. The
    verdict below keys off the share and reports both.
    """
    x, y = img(a[0], a[1]), img(b[0], b[1])
    if x is None or y is None:
        return None
    d = np.abs(x - y)
    return float(d.mean()), float((d.max(2) > 2 / 255).mean() * 100)


def pct(v, base):
    return None if base is None or abs(base) < 1e-9 else (v - base) / abs(base) * 100.0


def fmt(x):
    return "  --  " if x is None else f"{x:+7.2f}%"


def main():
    base = {t: stats_for("default", t) for t in ("port", "ref")}
    if any(v is None for v in base.values()):
        print("missing a default frame", file=sys.stderr)
        return 1

    # ---- measured noise floors -------------------------------------------
    noise_px, noise_share, noise_band = {}, {}, {}
    for t in ("port", "ref"):
        ds = [d for a, b in itertools.combinations(IDENTITY, 2)
              if (d := dist((a, t), (b, t))) is not None]
        noise_px[t] = max((d[0] for d in ds), default=0.0)
        noise_share[t] = max((d[1] for d in ds), default=0.0)
        noise_band[t] = {}
        for b in BANDS:
            seen = [abs(pct(s[b], base[t][b])) for n in IDENTITY
                    if (s := stats_for(n, t)) is not None]
            noise_band[t][b] = max(seen) if seen else 0.0

    # ---- per key ----------------------------------------------------------
    rows, verdicts, far_span = [], {}, {}
    for key, values in PLAN:
        span = {}
        for t in ("port", "ref"):
            ds = [d for a, b in itertools.combinations(values, 2)
                  if (d := dist((f"{key}_{a}", t), (f"{key}_{b}", t))) is not None]
            span[t] = max(ds, key=lambda z: z[1]) if ds else None
            # supplementary 12-far-range capture, when one was taken
            fs = [d for a, b in itertools.combinations(values, 2)
                  if (d := dist((f"{key}_{a}_far", t), (f"{key}_{b}_far", t))) is not None]
            if fs:
                far_span.setdefault(key, {})[t] = max(fs, key=lambda z: z[1])

        signs = []
        for v in values:
            r = {"key": key, "value": v}
            for t in ("port", "ref"):
                s = stats_for(f"{key}_{v}", t)
                r[t] = None if s is None else {b: pct(s[b], base[t][b]) for b in BANDS}
            if r["port"] and r["ref"]:
                for b in BANDS:
                    a, c = r["port"][b], r["ref"][b]
                    if abs(c) > noise_band["ref"][b] and abs(a) > noise_band["port"][b]:
                        signs.append((b, v, a, c))
            rows.append(r)

        # A slider "moves the image" when its widest frame pair changes a larger
        # share of the frame than two identical captures do. 3x is the margin;
        # every key that genuinely responds clears it by 50x or more, so nothing
        # real sits near the boundary.
        #
        # Two keys need a different reading and both are handled by PROBES rather
        # than by fudging the threshold. See the note on PROBES.
        if key in PROBES:
            verdicts[key] = (PROBES[key], span)
            continue

        def alive(t):
            s = far_span.get(key, {}).get(t) or span[t]
            return s is not None and s[1] > 3 * noise_share[t]

        opposite = [s for s in signs if s[2] * s[3] < 0]
        if not alive("ref") and not alive("port"):
            vd = "inert on BOTH at every pose tried"
        elif alive("ref") and not alive("port"):
            vd = "**DEAD IN PORT**"
        elif alive("port") and not alive("ref"):
            vd = "**PORT-ONLY RESPONSE** (reference does not move)"
        elif opposite:
            vd = "**OPPOSITE SIGN**: " + "; ".join(
                f"{b} @{v}: port {a:+.1f}% vs ref {c:+.1f}%" for b, v, a, c in opposite[:3])
        else:
            pr = (far_span.get(key, {}).get("port") or span["port"])[1]
            rr = (far_span.get(key, {}).get("ref") or span["ref"])[1]
            ratio = pr / rr if rr else float("inf")
            vd = ("tracks" if 0.5 <= ratio <= 2.0
                  else f"**AMPLITUDE {ratio:.2f}x** (port/ref share of frame changed)")
        verdicts[key] = (vd, span)

    # ---- write ------------------------------------------------------------
    o = [
        "# SNOWFLOW parameter sweep — port vs reference",
        "",
        "Generated by `_harness/sweep.py` + `_harness/sweep_report.py`.",
        "",
        "Every frame is the **01-hero** pose (spawn at world origin, yaw 2.40,",
        "pitch 0.17, distance 6.20), 1280x720, one page load per value, 4 s settle.",
        "Both targets are driven identically by writing `SNOWFLOW.S.<key>`.",
        "",
        "## Static-control mode, and why it is not optional",
        "",
        "At defaults, two captures of the SAME build at the SAME settings differ",
        "by mean|d| 0.009-0.014 across 50-62% of the frame. That is *larger* than",
        "the change a subtle slider makes, so a dead slider and a live one are",
        "indistinguishable. Almost all of it is the film grain — a per-frame hash",
        "on the clock at amplitude 0.022, i.e. +/-2.8/255 on every pixel — with",
        "TAA's jitter and history blend accounting for most of the rest. The",
        "character's idle animation, the obvious suspect, contributes almost",
        "nothing at this framing.",
        "",
        "So every capture first writes `grainStrength = 0` and `taa = false`,",
        "identically on both targets. Identity noise then falls to 0.13-0.52% of",
        "pixels, roughly 100x below what any responding key moves.",
        "",
        "**Not `freezeTime`**, which is the obvious lever and is wrong twice over.",
        "It stops the clock wherever the capture happened to reach, so the phase",
        "still varies with page-load timing (measured 0.0136 mean|d| between two",
        "frozen captures at identical settings). And it renders the REFERENCE",
        "black: mean luma 0.006 against the port's 0.520 under the identical",
        "write, measured on both targets. That is a shared upstream defect the",
        "port already fixes and documents — `character/controller.js:195-215`",
        "attributes it to a 0/0 NaN in the acceleration divide over a zero-length",
        "step, which propagates into the camera quaternion. This sweep reproduces",
        "the reference half of that measurement independently.",
        "",
        "`deformDepth` / `deformBerm` scale a trench that has to be cut first, so",
        "those captures walk 6 m from spawn (distance-terminated, as",
        "05-trail-berms does) and look back down the trail.",
        "",
        "## Measured noise floor",
        "",
        "Five sweep values are the setting's own default, so those frames are",
        "re-shoots of the default under another name. Their spread IS the noise.",
        "",
        "| metric | port | ref |",
        "|---|---|---|",
        f"| whole-frame mean&#124;d&#124; | {noise_px['port']:.6f} | {noise_px['ref']:.6f} |",
        f"| share of pixels changed | {noise_share['port']:.3f}% | {noise_share['ref']:.3f}% |",
    ]
    for b in BANDS:
        o.append(f"| {b} | {noise_band['port'][b]:.2f}% | {noise_band['ref'][b]:.2f}% |")

    o += [
        "",
        "## Verdicts",
        "",
        "`span` is the widest difference between any two frames of that key — the",
        "direct test of whether moving the setting changes the picture. A key",
        "counts as responding when the share of changed pixels clears 3x the",
        "measured noise floor.",
        "",
        "| key | verdict | port span (mean&#124;d&#124; / changed px) | ref span | port/ref |",
        "|---|---|---|---|---|",
    ]
    for key, _ in PLAN:
        vd, span = verdicts[key]
        pv, rv = span["port"], span["ref"]
        ratio = f"{pv[1] / rv[1]:.2f}x" if pv and rv and rv[1] else "--"
        f = lambda z: "--" if z is None else f"{z[0]:.6f} / {z[1]:6.2f}%"
        o.append(f"| `{key}` | {vd} | {f(pv)} | {f(rv)} | {ratio} |")

    if far_span:
        o += ["", "### Supplementary: 12-far-range pose", "",
              "Keys that 01-hero cannot show. Re-shot at the horizon framing",
              "(yaw 2.90, pitch -0.10, distance 9.50) before being called inert.",
              "", "| key | port span | ref span |", "|---|---|---|"]
        for key, per in far_span.items():
            f = lambda z: "--" if z is None else f"{z[0]:.6f} / {z[1]:6.2f}%"
            o.append(f"| `{key}` | {f(per.get('port'))} | {f(per.get('ref'))} |")

    o += ["", "## Response curves", "",
          "Percent change against that target's own default frame.", "",
          "| key | value | port luma | ref luma | port detail | ref detail "
          "| port blue | ref blue |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        p, f = r["port"], r["ref"]
        cells = []
        for b in BANDS:
            cells.append(fmt(p[b] if p else None))
            cells.append(fmt(f[b] if f else None))
        o.append(f"| `{r['key']}` | {r['value']} | " + " | ".join(cells) + " |")

    o += [
        "",
        "## Flagged residual: `windDirection = 150` moves the port's shadow tint",
        "",
        "Every other cell in the response table agrees between the two builds to",
        "a few tenths of a percent. One does not:",
        "",
        "| `windDirection` | port `shadow_blue_bias` | ref `shadow_blue_bias` |",
        "|---|---|---|",
        "| 0 | -0.06% | -0.28% |",
        "| 42 (default) | -0.04% | -0.01% |",
        "| 150 | **-1.61%** | **-0.27%** |",
        "",
        "Reproducible, not noise: a second independent capture of that value on",
        "each target gave port -1.60% and ref -0.29%, against measured noise",
        "floors of 0.04% and 0.01%. Luma (+0.47 / +0.45) and detail energy",
        "(-5.64 / -5.59) agree at the same value, so it is specific to the shadow",
        "tint. It is a 1.3-point difference in the blue-minus-red mean of the",
        "darkest quartile — well under any visual threshold, and no shot in the",
        "14-frame battery moves `windDirection` at all.",
        "",
        "Not diagnosed here. `lib/terrain.glsl.js` transliterates byte-faithfully",
        "(the whole chunk's numeric literals are an exact multiset match with",
        "`lib/terrain.wgsl`), so the term is more likely in one of the other",
        "consumers of the mirrored bearing — the deform sim's wind infill, the",
        "spray, or the sky's cirrus — each of which takes `bearingRad()` where the",
        "reference takes the raw degrees. Handing to the subsystem owner.",
        "",
        "## The UI path is not the `S` path — and here the two builds diverge",
        "",
        "Everything above writes `SNOWFLOW.S.<key>` directly, which is the only",
        "surface both targets share. A direct write bypasses `settings.set()` and",
        "therefore every `onChange` subscriber, and **the two builds do not",
        "subscribe to the same keys**. `probe_ui_slider.py` drives the real",
        "overlay `<input type=range>` instead — the same `oninput` -> `set(k, v)`",
        "path a human drag takes, identical widget code on both builds.",
        "",
        "| slider | key | port | reference |",
        "|---|---|---|---|",
        "| Dune height | `macroHeightScale` | 0.4 -> 1.8 changes **75.80%** of the "
        "frame (mean&#124;d&#124; 0.102689); mean luma 0.57034 -> 0.47936 | "
        "**0.04%** (mean&#124;d&#124; 0.000027); mean luma 0.53216 -> 0.53216 — "
        "pixel-identical |",
        "| Wind dir | `windDirection` | 0 -> 150 changes **73.91%** "
        "(mean&#124;d&#124; 0.150355); mean luma 0.42528 -> 0.56891 | **52.72%** "
        "(mean&#124;d&#124; 0.029536); mean luma 0.53355 -> 0.53453 |",
        "",
        "The port re-bakes the 4096-square macro heightfield when either key",
        "changes; the reference never re-bakes it at all. Source, both sides:",
        "",
        "    port  src/terrain/terrain.js:342   onChange([\"windDirection\", \"macroHeightScale\"],",
        "                                                () => { this._rebakeDue = true; });",
        "    port  src/terrain/terrain.js:402   if (this._rebakeDue) { ... this.heightfield.bake(); }",
        "",
        "    ref   src/terrain/terrain.js:200   await this.heightfield.bake();   // the ONLY call site",
        "    ref   src/main.js:76,122,133,144   the reference's ONLY four onChange subscriptions:",
        "                                       resolutionScale, showTerrain, showCharacter, showWake",
        "",
        "So in the reference the Dune-height slider is dead and the Wind-dir slider",
        "only reorients the fine sastrugi layer, which is a per-frame uniform. The",
        "port makes both fully live. That is the port doing MORE than the reference,",
        "not less, and it is undocumented at the line — unlike the port's other",
        "deliberate departures, which all carry a QUIRK-n or PORT-n note.",
        "",
        "## Absolute defaults", "", "| band | port | ref |", "|---|---|---|"]
    for b in BANDS:
        o.append(f"| {b} | {base['port'][b]:.5f} | {base['ref'][b]:.5f} |")

    path = os.path.join(SWEEP, "SWEEP.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(o) + "\n")
    # echo the verdict block
    i = o.index("## Verdicts")
    print("\n".join(o[i:i + 8 + len(PLAN)]))
    print(f"\n-> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
