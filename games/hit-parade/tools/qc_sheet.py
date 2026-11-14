"""HIT PARADE - compose QC contact sheets from art/blender/qc_render.py output (lane ASSETS).

  python tools/qc_sheet.py <qc_dir> <fighter_id> [--per 8]

Writes <qc_dir>/sheet_NN.png (rows = clips: 4-frame strip in a 3/4 front view + the contact / middle
frame from the game camera side, labelled with the measured lowest-vertex range, T-pose frames and
finger curl) and <qc_dir>/turntable.png. ASCII only.
"""
import argparse
import json
import os

from PIL import Image, ImageDraw, ImageFont


def font(sz):
    for f in ("C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/arial.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


STEP_WARN = 60.0   # a single-frame local bone rotation above this is drawn red (flip / snap lead)


def step_txt(m):
    if m.get("max_step_deg") is None:
        return ""
    return "  step %.0f deg %s f%s  hand sw L/R %d/%d  toe L/R %d/%d" % (
        m["max_step_deg"], m.get("step_bone"), m.get("step_frame"),
        m["hand_swing_max_LR"][0], m["hand_swing_max_LR"][1], m["toe_max_LR"][0], m["toe_max_LR"][1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("qc_dir")
    ap.add_argument("fighter")
    ap.add_argument("--per", type=int, default=8)
    a = ap.parse_args()
    q = json.load(open(os.path.join(a.qc_dir, "qc.json")))
    clips = [c for c in q["clips"] if "error" not in q["clips"][c]]
    f1, f2 = font(15), font(13)
    tw, th = 220, 300
    lab = 34
    sheets = []
    for si in range(0, len(clips), a.per):
        chunk = clips[si:si + a.per]
        sheet = Image.new("RGB", (tw * 5, (th + lab) * len(chunk)), (24, 24, 28))
        d = ImageDraw.Draw(sheet)
        for r, cid in enumerate(chunk):
            m = q["clips"][cid]
            y = r * (th + lab)
            txt = "%s  %df  low %.3f..%.3f m  tpose %d  sink>3cm %d" % (
                cid, m["frames"], m["lowest_min"], m["lowest_max"], len(m["tpose_frames"]), m["sink_frames_lt_-0.03"])
            d.text((6, y + 2), txt, fill=(255, 220, 90), font=f1)
            fr = m["strip_frames"]
            sub = "strip f" + ",".join(str(x) for x in fr) + "  | game view f%d%s" % (
                m["game_frame"], " CONTACT" if m.get("contact_frame") is not None else "")
            cu = m["finger_curl_deg_LR"].get(str(m["game_frame"]))
            if cu:
                sub += "  curl L/R %s/%s" % tuple("-" if v is None else int(v) for v in cu)
            sub += step_txt(m)
            d.text((6, y + 18), sub, fill=(255, 130, 110) if m.get("max_step_deg", 0) > STEP_WARN else (200, 200, 210),
                   font=f2)
            for k in range(5):
                p = os.path.join(a.qc_dir, "%s__%s.png" % (cid, ("s%d" % k) if k < 4 else "game"))
                if k < 4 and k >= len(fr):
                    continue
                if os.path.exists(p):
                    im = Image.open(p).convert("RGB").resize((tw, th))
                    sheet.paste(im, (k * tw, y + lab))
                    if k == 4:
                        d.rectangle([k * tw, y + lab, k * tw + tw - 1, y + lab + th - 1],
                                    outline=(230, 60, 60) if m.get("contact_frame") is not None else (90, 160, 255), width=2)
        out = os.path.join(a.qc_dir, "sheet_%02d.png" % (si // a.per))
        sheet.save(out)
        sheets.append(out)
    # moves sheets: 5 game-camera frames per clip (c-6, c-3, c, c+3, c+8 with the effector ball on c)
    gw, gh = 380, 400
    per = max(1, a.per - 2)
    gclips = [c for c in clips if q["clips"][c].get("game_frames")]
    for si in range(0, len(gclips), per):
        chunk = gclips[si:si + per]
        sheet = Image.new("RGB", (gw * 5, (gh + lab) * len(chunk)), (24, 24, 28))
        d = ImageDraw.Draw(sheet)
        for r, cid in enumerate(chunk):
            m = q["clips"][cid]
            y = r * (gh + lab)
            gf = m["game_frames"]
            cf = m.get("contact_frame")
            eff = ""
            txt = "%s  %df  game camera  frames %s%s" % (cid, m["frames"], ",".join(str(x) for x in gf),
                                                         ("  CONTACT f%d (red ball = effector.at)" % cf) if cf is not None else "")
            d.text((6, y + 2), txt, fill=(255, 220, 90), font=f1)
            d.text((6, y + 18), "low %.3f..%.3f m  tpose %d%s%s" % (m["lowest_min"], m["lowest_max"], len(m["tpose_frames"]), eff,
                                                                     step_txt(m)),
                   fill=(255, 130, 110) if m.get("max_step_deg", 0) > STEP_WARN else (200, 200, 210), font=f2)
            for k in range(5):
                p = os.path.join(a.qc_dir, "%s__g%d.png" % (cid, k))
                if os.path.exists(p):
                    im = Image.open(p).convert("RGB").resize((gw, gh))
                    sheet.paste(im, (k * gw, y + lab))
                    d.text((k * gw + 4, y + lab + 2), "f%d" % gf[k], fill=(20, 20, 20), font=f1)
                    if cf is not None and gf[k] == cf:
                        d.rectangle([k * gw, y + lab, k * gw + gw - 1, y + lab + gh - 1], outline=(230, 60, 60), width=3)
        out = os.path.join(a.qc_dir, "moves_%02d.png" % (si // per))
        sheet.save(out)
        sheets.append(out)
    # CHANGED(ASSETS3D): locomotion sheets (side-steps / side-walks): per clip 3 rows (front / top / game view) x up
    # to 8 frames with the stripped travel put back and footprint discs (red = left ball of foot, blue = right); the
    # tile label "f7 L-" = frame 7, left foot planted, right foot in the air
    lclips = [c for c in clips if q["clips"][c].get("loco")]
    for cid in lclips:
        m = q["clips"][cid]
        lo = m["loco"]
        fr = lo["frames"]
        views = lo.get("views", ["front", "top", "game"])
        sheet = Image.new("RGB", (tw * max(1, len(fr)), (th + lab) * len(views) + lab), (24, 24, 28))
        d = ImageDraw.Draw(sheet)
        sl = lo.get("slide_mesh_rig", {})
        txt = "%s  %df  travel fwd %.3f m / lat %+.3f m (+ = his right)  stance slide L %s / R %s m/s (mean/max)" % (
            cid, m["frames"], lo["travel_m"][0], lo["travel_m"][1],
            "%s/%s" % (sl.get("Left", {}).get("slide_mps_mean"), sl.get("Left", {}).get("slide_mps_max")),
            "%s/%s" % (sl.get("Right", {}).get("slide_mps_mean"), sl.get("Right", {}).get("slide_mps_max")))
        d.text((6, 4), txt, fill=(255, 220, 90), font=f1)
        d.text((6, 18), "low %.3f..%.3f m  tpose %d%s" % (m["lowest_min"], m["lowest_max"], len(m["tpose_frames"]), step_txt(m)),
               fill=(200, 200, 210), font=f2)
        hint = {"front": "FRONT view (his LEFT = screen RIGHT)", "top": "TOP view, facing screen-down (his LEFT = screen RIGHT)",
                "feet": "FEET close-up, front 28 deg down (planted = the foot stays on its disc; red = left ball, blue = right)",
                "game": "GAME side view (orbit camera on the step axis: a step reads as depth)"}
        stl = lo.get("stance_LR") or []
        for r, v in enumerate(views):
            y = lab + r * (th + lab)
            d.text((6, y + 10), hint.get(v, v), fill=(150, 210, 255), font=f2)
            for k, f in enumerate(fr):
                p = os.path.join(a.qc_dir, "%s__loco_%s%d.png" % (cid, v, k))
                if os.path.exists(p):
                    im = Image.open(p).convert("RGB").resize((tw, th))
                    sheet.paste(im, (k * tw, y + lab))
                    d.text((k * tw + 4, y + lab + 2), "f%d %s" % (f, "".join(stl[k]) if k < len(stl) else ""),
                           fill=(20, 20, 20), font=f1)
        out = os.path.join(a.qc_dir, "loco_%s.png" % cid)
        sheet.save(out)
        sheets.append(out)
    turn = [os.path.join(a.qc_dir, "_turn_%d.png" % k) for k in range(8)] + \
           [os.path.join(a.qc_dir, "_turn_head_%d.png" % k) for k in range(2)]
    turn = [p for p in turn if os.path.exists(p)]
    if turn:
        ims = [Image.open(p).convert("RGB") for p in turn]
        w, h = ims[0].size
        cols = 5
        rows = (len(ims) + cols - 1) // cols
        t = Image.new("RGB", (w * cols, h * rows + 24), (24, 24, 28))
        d = ImageDraw.Draw(t)
        d.text((6, 4), "%s textured turntable (EEVEE, idle f0) + head close-ups (hair/lash cutout)" % a.fighter,
               fill=(255, 220, 90), font=f1)
        for i, im in enumerate(ims):
            t.paste(im, ((i % cols) * w, 24 + (i // cols) * h))
        out = os.path.join(a.qc_dir, "turntable.png")
        t.save(out)
        sheets.append(out)
    print(json.dumps({"sheets": sheets}))


if __name__ == "__main__":
    main()
