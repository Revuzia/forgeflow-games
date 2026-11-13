# -*- coding: utf-8 -*-
"""Turn the `_untest_probe.py` measurements into verdicts and merge them back
into `_playreports/_replay_verdicts.json`.

    python _untest_verdict.py [--dry]

Two safety rails, both learned the hard way on the first cut of this file:

  * A rule may only fire on the CLAIM IT MEASURES. The first cut called a hanging
    banner FIXED because the HERO was unoccluded, when the tester's words were
    that the banner hid the LOFT. Every rule below is gated on a claim kind.
  * A verdict is only as good as its STATION. A coordinate inferred from prose
    may be metres from the thing the tester was looking at, so an inferred
    station reports its measurements and decides nothing.

Hand verdicts read off a replay frame go in `_playreports/_untest_frame_verdicts.json`
as {key: [verdict, evidence]} and beat every rule below.
"""
import glob, json, os, re, sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
RP = os.path.join(HERE, "_playreports")
OUT = os.path.join(HERE, "_replayout")

VERD = json.load(open(os.path.join(RP, "_replay_verdicts.json"), encoding="utf-8"))
IDX = {d["key"]: d for d in json.load(open(os.path.join(RP, "_defects_index.json"), encoding="utf-8"))}
GROUPS = {}
try:
    GROUPS = {r["key"]: r for r in json.load(open(os.path.join(RP, "_untest_groups.json"), encoding="utf-8"))["rows"]}
except Exception:
    pass
HAND = {}
try:
    HAND = json.load(open(os.path.join(RP, "_untest_frame_verdicts.json"), encoding="utf-8"))
except Exception:
    pass

M = {}
for f in glob.glob(os.path.join(OUT, "untest_*.json")):
    try:
        j = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    for k, v in (j.get("defects") or {}).items():
        v["_audit"] = j.get("audit")
        M[k] = v

# ---------------------------------------------------------------------------
# CLAIM KINDS — what the tester actually asserted.
# ---------------------------------------------------------------------------
CLAIM = [
 ("kill",       r"\bdied\b|\bdeaths?\b|kill(s|ed|ing)?\b|is lethal|instant(ly)? kill|dead in|fell out of the world|falls? out of the world|'crush'|crush(ed|es)?\b|death loop|incinerate|threw me off|throws? you off"),
 ("immobile",   r"stopped (dead|moving)|never moved|froze|frozen|did not move|soft-?lock|wedged|cannot escape|trapped|jam(s|med)\b|pinned\b|stops? dead|slide-?lock|\bbonk|never got (on|in|up|out|past)|acts as a wall|is a wall|stops? \d?\.?\d* m short|cannot go further|walled|will not advance|stuck at|stuck in|slide events|thrown off|hit an invisible|cannot make the|slid back"),
 ("gapmiss",    r"not one (landed|crossing)|never landed|missed|short of|too far|cannot be reached|unreachab|out of reach|every .{0,24}jump fails|tops? out|runs? out .{0,12}short|\d\.\d+ m (short|under)|fell off between|made it \d of \d|failed \d of \d|overflew"),
 ("heroHidden", r"(camera|lens|frame|shot|view).{0,60}(nim|hero|him|his (head|skull|scalp|helmet))|(nim|hero) (is )?(not|never) (visible|on ?screen|in frame)|inside (nim'?s|the hero'?s|his) (head|skull)|top-?down|over-?the-?head|scalp|occlude[sd]? (nim|the hero)|covers? (nim|the hero)|camera (is )?inside him|collapse[sd]? to (zero|\d)|camera (went|goes|ends up) (inside|into)|lens (is |ends up )?inside"),
 ("viewBlocked", r"(hide|hides|hid|blocking|blocks|covers|fills|eats|swallow)s? (the|its|his) ?(view|world|rest|whole|entire|forward|screen|frame|left|right|middle|doorway|loft|run|walk|road|gauntlet|catwalk)|stands? between the (camera|lens) and|in front of the (lens|camera)|you cannot see (any|the)|hidden behind|the frame (filled|fills) with|frame is (a|the) |half the frame"),
 ("inert",      r"no collider|zero colliders|passes? through|never fires|has no collider|no purchase|does not collide|never (moves|arms|engages|carr)|nothing (at all|happen|happened|sank)|no-?op|no reaction|never carr|painted scenery|did nothing|does nothing|never did anything|no sink|no drag|no death|no platform ever|never arrived|nothing came within reach"),
 ("tooSafe",    r"zero deaths|no deaths|nothing to time|never touch|cannot touch|clear on every phase|"
                r"harmless|too safe|0 of \d+|with zero deaths|nothing in the .{0,20}can touch|"
                r"never in any danger|no threat"),
 ("unbroken",   r"broken[=:] ?false|still reports? broken|will not break|does not break|breaks? nothing|leave the .{0,24}collider active|refuses? to break"),
 ("rigid",      r"rigid|plank|does not move like cloth|never moves like|t-?pose|un-?posed|scarecrow"),
 ("nosink",     r"nothing sank|never sank|no sink|y stayed|stayed at|submerged.{0,14}(stayed|remained|false)"),
 ("prompt",     r"interact prompt|the interact|pressing e (does|did)|press e (does|did)|talk (radius|prompt)|range-?gated|prompt is (already )?(drawn|in the page)"),
 ("hudMissing", r"no (breath|air|oxygen) ?(bar|meter|gauge)?|nowhere in the HUD|no air\b|breath bar"),
 ("surfaces",   r"reports? the default surface|every (grate|deck|plate|stair).{0,40}surface|step_metal never|surface '?normal'?"),
 ("ringOverlay", r"(wing|power) ?rings? (are )?(drawn|on screen|visible)|all ten .{0,20}rings|rings? .{0,40}(before (you|the player) (has|have)|on ?screen|are drawn|drawn from the moment|visible from the)|\brings?\b[^.]{0,50}\bopacity\b"),
 ("floating",   r"hang(s|ing)? in (mid ?air|the air)|floats? in mid ?air|with nothing (under|holding) (them|it)|no post, no chain"),
 ("missingHole", r"there is no breach|the aperture was never cut|running unbroken|no hole|never cut"),
 ("slowField",  r"against an authored|slower than the number|per ?cent slower|m/s .{0,20}against"),
 ("text",       r"wraps? (to|mid)|illegible|unreadable|degraded|glyphs?|larger than|cut off by the screen|line cap|two lines"),
 ("visual",     r"render(s|ed|ing)? as|reads? as|looks? like|washed out|milky|z-?fight|banding|near-?black|flat (grey|gray|white|pale|opaque|saturated)|naked primitive|blown-?out|featureless|hard-?edged|silhouette|olive|steel blue|colou?r|texture|no gradient|no blend|seam|half-?buried|buried in|inside the masonry|grow(s|n)? up through|clipped into|half-?sunk|intersect"),
]


def claims(d):
    # The ASSERTION lives in `happened` + `should`. `where` is a description of a
    # place and drags in words ("the crusher cave", "the wall-kick shaft") that
    # would hand a rule a claim the tester never made.
    t = " ".join([d.get("happened") or "", d.get("should") or ""])
    return {n for n, p in CLAIM if re.search(p, t, re.I)}


# A station is only good enough to decide a verdict when the tester himself put
# it in his WHERE line (or the index carried it, or it was resolved by hand from
# the course data). A coordinate lifted out of a `did`/`happened` narrative is
# usually where he STARTED, not where the defect is, and a height the harness had
# to resolve off the ground may be a storey away from the thing he was looking at.
STRONG_KINDS = {"index", "handmap"}


def station_strength(st):
    if st.get("outOfBounds"):
        return False, st["outOfBounds"]
    if (st.get("kind") or "") in STRONG_KINDS or (st.get("src") or "") in STRONG_KINDS:
        return True, ""
    if st.get("src") == "where" and not st.get("needsGround"):
        return True, ""
    if st.get("needsGround"):
        return False, "its height had to be resolved off the ground, so it may be a storey away from the defect"
    if (st.get("src") or "") in ("where", "happened"):
        return True, ""      # the place he named, or the place he recorded failing
    return False, ("it was lifted out of the '%s' narrative, which is usually where he STARTED, not where "
                   "the defect is" % st.get("src"))


def _died_anywhere(m):
    out = []
    if ((m.get("reach") or {}).get("rec") or {}).get("died"):
        out.append("on arrival")
    if (m.get("standlong") or {}).get("died"):
        out.append("standing still 6 s")
    for w in ((m.get("walk4") or {}).get("walks") or []):
        if w["died"]:
            out.append("walking " + w["dir"])
    if (m.get("ride") or {}).get("died"):
        out.append("riding")
    if (m.get("swim") or {}).get("died"):
        out.append("swimming")
    return out


def decide(key):
    d = IDX[key]
    rec = M.get(key)
    C = claims(d)
    cls = d.get("cls") or ""
    if not rec:
        return None, "the course was not re-probed in this pass", ""
    if rec.get("error"):
        return None, "probe error: " + rec["error"], "untest probe"
    # Course-wide facts (the HUD's contents, the surface census, the ring
    # overlay) need no station at all — decide them before anything asks for one.
    aud = rec.get("_audit") or {}
    # 9b. course-wide facts: the HUD, the surface census, the ring overlay.
    if "hudMissing" in C and aud.get("hudText") is not None:
        hud = aud["hudText"]
        has = bool(re.search(r"air|breath|oxygen|lung", hud, re.I))
        if has:
            return "FIXED", "the HUD now carries an air/breath readout — HUD text: '%s'" % hud[:180], "untest probe"
        return "STILL REPRODUCES", ("the HUD still carries no air/breath readout — HUD text verbatim: '%s'"
                                    % hud[:220]), "untest probe"
    if "surfaces" in C and aud.get("surfaceCensus"):
        sc = aud["surfaceCensus"]
        by = sc.get("bySurface") or {}
        dflt = by.get("normal", 0)
        tot = sc.get("total") or 1
        named = tot - dflt
        if named >= 0.25 * tot:
            return "FIXED", ("%d of %d solid colliders now carry a named surface (%s) — the course no longer "
                             "reports the default everywhere" % (named, tot, by)), "untest probe"
        return "STILL REPRODUCES", ("%d of %d solid colliders still report the default 'normal' surface "
                                    "(census %s)" % (dflt, tot, by)), "untest probe"
    if "ringOverlay" in C and aud.get("rings"):
        rg = aud["rings"]
        if rg.get("n"):
            if rg.get("power") is None and rg.get("visible", 0) > 0:
                return "STILL REPRODUCES", ("%d of %d ring meshes are still drawn with no power hat taken "
                                            "(power=%s), at y %s" % (rg["visible"], rg["n"], rg.get("power"),
                                                                     rg.get("y"))), "untest probe"
            return "FIXED", ("no ring is drawn before the hat is taken (%d ring meshes, %d visible, power=%s)"
                             % (rg["n"], rg.get("visible", 0), rg.get("power"))), "untest probe"


    m = rec.get("m")
    if not m:
        return None, (rec.get("note") or "no station could be resolved") + \
            " — a human must supply the coordinate, or the tester's own driver must be re-run", "untest probe"

    st0 = (rec.get("stations") or [{}])[0]
    kind = "%s from %s" % (st0.get("kind") or "?", st0.get("src") or "?")
    strong, weakWhy = station_strength(st0)
    if not strong:
        kind += " — " + weakWhy
    reach = m.get("reach") or {}
    phase = m.get("phase") or {}
    walk4 = m.get("walk4") or {}
    cross = m.get("cross") or {}
    cam = m.get("camsweep") or {}
    scr = m.get("screen") or {}
    ride = m.get("ride") or {}
    pnd = m.get("pound") or {}
    swim = m.get("swim") or {}
    hero = m.get("hero") or {}
    frm = m.get("frame") or {}

    ev = ["station %s (%s) reached=%s%s" % (
        st0.get("p"), kind, reach.get("ok"),
        (" — " + reach.get("reason", "")) if not reach.get("ok") else "")]
    if phase:
        ev.append("hazard phases: %d samples over %s s, kill on %.0f%% of them%s, a moving box inside the body "
                  "column on %.0f%%, ground %s..%s" % (
                      (phase.get("n") or 0) + 1, phase.get("tmax"), 100 * (phase.get("killFrac") or 0),
                      (" at t=" + ",".join(str(t) for t in (phase.get("killT") or [])[:6]) + " s") if phase.get("killT") else "",
                      100 * (phase.get("insideFrac") or 0), phase.get("groundMin"), phase.get("groundMax")))
    if walk4:
        ev.append("walks: best %.2f m (%s), climb %+.2f m, bonk<=%d, slide<=%d" % (
            walk4["best"]["disp"], walk4["best"]["dir"], walk4["climb"]["dy"],
            walk4["maxBonk"], walk4["maxSlide"]))
    if cross:
        ev.append("crossing %s -> %s (%.2f m at %+.2f m): %s" % (
            cross["from"], cross["to"], cross["gap"], cross["rise"],
            ("landed by " + ",".join(cross["landedBy"])) if cross["anyLanded"]
            else "no move landed; closest %s at %.2f m" % (cross["closest"]["move"], cross["closest"]["distToB"])))
    if cam:
        ev.append("camera over %d yaws: min dist %.2f, %d with something between the lens and Nim, hero off-frame on %d" % (
            cam.get("yaws", 0), cam.get("minDist", -1), cam.get("occludedYaws", 0), cam.get("hiddenYaws", 0)))
    if scr:
        ev.append("frame: %s in front of the hero%s" % (
            (", ".join("%s %.0f%%" % (b["name"], 100 * b["area"]) for b in scr["blockers"][:2]) or "nothing"),
            (" (occluders " + ",".join(o["name"] for o in scr["occluders"][:2]) + ")") if scr.get("occluders") else ""))
    if frm and frm.get("lum") is not None:
        ev.append("frame lum %.3f (p05 %.3f p95 %.3f) sat %.2f rgb %s" % (
            frm["lum"], frm["p05"], frm["p95"], frm["sat"], frm["rgb"]))
    died = _died_anywhere(m)
    if died:
        ev.append("DIED while: " + ", ".join(died))
    E = "; ".join(ev)

    def weak():
        return (None, ("the station is not trustworthy enough to decide on — %s. The tester must name the "
                       "coordinate in his WHERE line. Measured anyway: %s" % (weakWhy, E)),
                "untest probe (station inferred)")

    # ------------------------------------------------------------------ rules
    # 0. the station cannot be stood on
    if not reach.get("ok"):
        if not strong:
            return weak()
        why = reach.get("reason") or ""
        # "dies on arrival" and "falls out of the world" ARE the tester's complaint.
        # "is pushed out" can also mean a teleport landed inside set dressing, so it
        # decides nothing.
        if (C & {"kill", "gapmiss"}) and ("dies" in why or "falls out of the world" in why):
            return "STILL REPRODUCES", "the recorded spot still cannot be stood on — " + E, "untest probe"
        return None, ("the recorded spot cannot be stood on (%s), so the claim's own precondition is missing "
                      "— the tester must name a standable coordinate. Measured anyway: %s"
                      % (reach.get("reason"), E)), "untest probe"

    # 0b. a wall-kick shaft that "tops out": climb it and report the height.
    kl = m.get("kickladder") or {}
    if kl and (C & {"gapmiss", "immobile"}):
        if not strong:
            return weak()
        need = None
        sts = rec.get("stations") or []
        if len(sts) >= 2 and sts[1].get("p"):
            need = round(sts[1]["p"][1] - sts[0]["p"][1], 2)
        txt2 = " ".join([d.get("where") or "", d.get("happened") or ""])
        if need is None:
            mm = re.search(r"(\d+(?:\.\d+)?)\s*m of (?:climb|the climb|rise)", txt2, re.I)
            if mm:
                need = float(mm.group(1))
        if need is None:
            # "floor 19.60/20.00 -> exit ledge 27.70" is how rime-3#15 and rime-2#09
            # state the height, and it is not "N m of climb".
            m2 = re.search(r"floor\s*(\d+(?:\.\d+)?)(?:\s*/\s*\d+(?:\.\d+)?)?\s*(?:->|to|,)\s*"
                           r"(?:the\s*)?(?:exit\s*)?ledge\s*(\d+(?:\.\d+)?)", txt2, re.I)
            if m2:
                need = round(float(m2.group(2)) - float(m2.group(1)), 2)
        got = kl.get("maxGain") or 0
        if need is None:
            return None, ("the shaft was climbed for %.2f m over %d kicks (launches %s), but the report does "
                          "not name the height it has to reach, so short-of-what cannot be decided — %s"
                          % (got, kl.get("kicked", 0), kl.get("launches"), E)), "untest probe"
        # `kicked` counts SAMPLED `wallkick` frames and the state lasts about one
        # frame, so it under-reports badly. The height gained is the measurement.
        if got >= need - 0.25:
            return "FIXED", ("the kick ladder now climbs %.2f m against the %.2f m the route asks for "
                             "(launch heights %s) — %s" % (got, need, kl.get("launches"), E)), "untest probe"
        return "STILL REPRODUCES", ("the kick ladder still tops out %.2f m short: %.2f m climbed against %.2f m "
                                    "needed (launch heights %s) — %s"
                                    % (need - got, got, need, kl.get("launches"), E)), "untest probe"

    # 1a. THE INVERSE CLAIM: "zero deaths, nothing to time". Here the ABSENCE of a
    #     kill confirms the tester instead of clearing him, and rule 1 read it the
    #     wrong way round on ember-2#07 ("nothing in the hall can touch a player who
    #     walks a lane") until this was split out.
    if "tooSafe" in C and phase:
        if not strong:
            return weak()
        if (phase.get("killFrac") or 0) > 0 or died:
            return "FIXED", ("the spot is no longer safe: a kill volume covers it on %.0f%% of the hazard "
                             "cycle%s — %s" % (100 * (phase.get("killFrac") or 0),
                                               (" and the hero died " + ", ".join(died)) if died else "", E)), "untest probe"
        return "STILL REPRODUCES", ("the spot is still untouchable: 6 s standing still and every one of %d "
                                    "hazard phases across %s s leave it with no kill volume over it, which is "
                                    "the tester's complaint, not its refutation — %s"
                                    % ((phase.get("n") or 0) + 1, phase.get("tmax"), E)), "untest probe"

    # 1. a death / crush claim
    if "kill" in C and "tooSafe" not in C and (m.get("standlong") or phase):
        if not strong:
            return weak()
        if died:
            return "STILL REPRODUCES", "still dies at the recorded spot — " + E, "untest probe"
        if phase.get("killFrac", 0) > 0:
            return "STILL REPRODUCES", ("a kill volume covers the spot on %.0f%% of the hazard cycle, so the "
                                        "tester's death reproduces without waiting for it — %s"
                                        % (100 * phase["killFrac"], E)), "untest probe"
        if phase.get("n") and m.get("standlong"):
            drift = (m["standlong"] or {}).get("drift") or 0
            if drift > 3.0:
                return None, ("the hero did not STAY at the spot to be killed — he drifted %.2f m during the "
                              "6 s stand (azure-2#16's bell-rope station drops 26 m), so 'no death' is not "
                              "evidence about that spot — %s" % (drift, E)), "untest probe"
            return "FIXED", ("no death: 6 s standing still (drift %.2f m), and every one of %d hazard phases "
                             "across %s s leaves the spot survivable — %s"
                             % (drift, phase["n"] + 1, phase["tmax"], E)), "untest probe"

    # 2. a crossing claim with both ends named
    if cross and ((C & {"gapmiss", "immobile"}) or cls == "long-jump gaps"):
        if not strong:
            return weak()
        # A crossing that never got a RUN-UP is not a measurement of the gap: on
        # rime-2#16 the hero was in slopeSlide at the launch and every attempt left
        # at 0.06 m/s. Require at least one attempt to have reached walking speed.
        topSpeed = max([(t.get("speedAtLaunch") or 0) for t in cross["tries"]] or [0])
        bestApex = max([(t.get("apex") or 0) for t in cross["tries"]] or [0])
        # A STEP-UP is decided by APEX, not by run-up: if the highest of the five
        # moves cannot reach the far ledge's height from the launch, the step is
        # out of reach however fast you arrive. (ember-4#06: 2.20 m across at
        # +2.07 m, best apex 1.83 m.)
        if cross["rise"] >= 0.8 and bestApex < cross["rise"] - 0.15:
            return "STILL REPRODUCES", ("the step is still higher than the hero can jump from the launch: "
                                        "the best apex of %d moves is %.2f m against a required rise of "
                                        "%.2f m — %s" % (len(cross["tries"]), bestApex, cross["rise"], E)), "untest probe"
        if topSpeed < 2.0:
            return None, ("the crossing test never got a run-up — the fastest of %d attempts left the launch "
                          "at %.2f m/s (the hero is on a slide or against a wall there), so 'no move landed' "
                          "says nothing about the gap. Needs a launch coordinate with straight approach — %s"
                          % (len(cross["tries"]), topSpeed, E)), "untest probe"
        if cross["anyLanded"]:
            return "FIXED", "the gap the tester could not cross is crossable now — " + E, "untest probe"
        return "STILL REPRODUCES", "no move in the jump family lands on the far side — " + E, "untest probe"

    # 3. immobile / walled / stair claims
    # (a defect FILED under `stairs` whose complaint is about the CAMERA at the
    #  foot of the flight belongs to rule 4, not here)
    if walk4 and ("immobile" in C or (cls == "stairs" and "heroHidden" not in C)):
        if not strong:
            return weak()
        if walk4["allStuck"] and walk4["maxBonk"] >= 3:
            return "STILL REPRODUCES", "still immobile against a wall at the recorded spot — " + E, "untest probe"
        if walk4["allStuck"] and walk4["maxSlide"] >= 4:
            return "STILL REPRODUCES", "still slide-locked at the recorded spot — " + E, "untest probe"
        if cls == "stairs" and walk4["climb"]["dy"] < 1.0 and walk4["maxBonk"] >= 3:
            return "STILL REPRODUCES", ("the flight still refuses the hero: the best of four held-W walks from "
                                        "the recorded foot climbs %+.2f m and bonks on %d sampled frames — %s"
                                        % (walk4["climb"]["dy"], walk4["maxBonk"], E)), "untest probe"
        if cls == "stairs" and walk4["climb"]["dy"] >= 1.0 and walk4["maxBonk"] <= 2:
            return "FIXED", "climbs %+.2f m from the recorded foot — %s" % (walk4["climb"]["dy"], E), "untest probe"
        if walk4["best"]["disp"] >= 2.5 and walk4["maxBonk"] <= 1 and walk4["maxSlide"] <= 1:
            return "FIXED", "walks freely from the recorded spot now — " + E, "untest probe"

    # 4. a camera claim ABOUT THE HERO (a sign that hides the WORLD is rule 5)
    if "heroHidden" in C and cam:
        if not strong:
            return weak()
        # TWO different complaints hide under "the camera is bad here", and they
        # have different measurements. A COLLAPSE ("top-down over his skull",
        # "inside his head") is answered by cam.dist; an OCCLUSION ("something is
        # between the lens and Nim") by the ray. Deciding a collapse claim on an
        # occlusion count called ember-1#17 reproduced when the lens was 2.35 m out.
        txt = " ".join([d.get("happened") or "", d.get("should") or ""])
        collapse = re.search(r"collaps|top-?down|over-?the-?head|scalp|inside (nim'?s|his|the hero'?s) "
                             r"(head|skull)|zero distance|close-?up", txt, re.I)
        mind = cam.get("minDist")
        if collapse:
            if mind is not None and mind < 1.75:
                return "STILL REPRODUCES", ("the lens still collapses here: %.2f m at its worst of %d yaws "
                                            "(TUNE.cam.minDist is 1.60) — %s" % (mind, cam.get("yaws", 0), E)), "untest probe"
            extra = ("" if not cam.get("occludedYaws") else
                     " Separate finding at the same station, not the tester's complaint: something stands "
                     "between the lens and Nim at %d of %d yaws." % (cam["occludedYaws"], cam.get("yaws", 0)))
            return "FIXED", ("the lens no longer collapses here: its worst of %d yaws is %.2f m, well outside "
                             "TUNE.cam.minDist 1.60.%s — %s" % (cam.get("yaws", 0), mind if mind is not None else -1,
                                                                extra, E)), "untest probe"
        bad = (cam.get("occludedYaws", 0) >= 2 or cam.get("hiddenYaws", 0) >= 2
               or (mind is not None and mind < 1.55))
        if bad:
            return "STILL REPRODUCES", "the hero is still hidden or the lens still collapses here — " + E, "untest probe"
        return "FIXED", ("the hero is framed at >= minDist and nothing stands between the lens and him at "
                         "any of %d yaws (the sweep varies YAW at the default pitch, so a pose the player "
                         "reaches by pitching is not covered) — %s" % (cam.get("yaws", 0), E)), "untest probe"

    # 5. something stands in front of the LENS (a sign, a column, a banner)
    if "viewBlocked" in C and scr:
        if not strong:
            return weak()
        hd = scr.get("headDist") or 7.0
        feet = (st0.get("p") or [0, 0, 0])[1]
        # A thing that HIDES THE VIEW stands near the lens AND stands UP: a race
        # pad on the floor projects across the whole screen when the lens is low
        # and hides nothing. Where the world height band was recorded, require the
        # blocker to reach at least 0.6 m above the hero's feet; on older probe
        # output (no band) fall back to rejecting a full-screen projection.
        def stands_up(b):
            if b.get("y1") is not None:
                return b["y1"] > feet + 0.6 and b["area"] <= 0.95
            return b["area"] <= 0.90
        big = [b for b in scr["blockers"]
               if b["area"] >= 0.18 and stands_up(b)
               and (b.get("dist") is None or b["dist"] <= 0.75 * hd)]
        if big:
            return "STILL REPRODUCES", ("%s still takes %.0f%% of the frame from this station — %s"
                                        % (big[0]["name"], 100 * big[0]["area"], E)), "untest probe"
        if cam and cam.get("maxFront", 0) < 0.18:
            return "FIXED", ("nothing takes more than %.0f%% of the frame at any of %d yaws from this "
                             "station — %s" % (100 * cam.get("maxFront", 0), cam.get("yaws", 0), E)), "untest probe"

    # 6b. an interact-prompt claim: what does the page actually say, here?
    if "prompt" in C and m.get("prompt") is not None:
        if not strong:
            return weak()
        pr = m["prompt"]
        shown = bool(pr.get("shown"))
        near = (pr.get("nearest") or {})
        if shown and (near.get("d") is None or near["d"] > 6.0):
            return "STILL REPRODUCES", ("the interact prompt is shown at this station ('%s') with the "
                                        "nearest interactable %s m away — %s"
                                        % (pr.get("text"), near.get("d"), E)), "untest probe"
        if not shown:
            return "FIXED", ("no interact prompt is drawn at this station (nearest interactable %s m away) "
                             "— %s" % (near.get("d"), E)), "untest probe"

    # 6. "it never fires / has no collider / nothing happens".  A pad, a mover or
    #    a current is answered by RIDING it; nothing else in the battery speaks to
    #    an inert claim (the first cut accepted "a collider covers the spot", which
    #    is true almost everywhere and proves nothing).
    if "nosink" in C and swim:
        pass                                   # rule 9 owns a sink claim
    elif "inert" in C and "prompt" not in C and ride:
        if not strong:
            return weak()
        # If the hero DROPPED off the station instead of standing on the thing,
        # the ride measured a fall, not the mover: verdant-1#12's teleport to the
        # windmill hub fell 10.48 m to the hilltop and would otherwise have been
        # reported as "still inert".
        if (ride.get("dy") or 0) < -2.0:
            return None, ("the hero fell %.2f m off the station within the ride, so he was never standing on "
                          "the thing the tester says does not carry him — the report must name a boarding "
                          "spot ON it. Measured anyway: %s" % (ride["dy"], E)), "untest probe"
        moved = max(abs(ride.get("peakDy") or 0), (ride.get("disp") or 0) / 4.0)
        if moved >= 1.0:
            return "FIXED", ("the thing the tester found inert now moves the hero (20 s standing on it: "
                             "%+.2f m of lift, %.2f m carried) — %s"
                             % (ride.get("peakDy") or 0, ride.get("disp") or 0, E)), "untest probe"
        return "STILL REPRODUCES", ("still inert at the recorded spot (20 s standing on it: %+.2f m of lift, "
                                    "%.2f m carried, states %s) — %s"
                                    % (ride.get("peakDy") or 0, ride.get("disp") or 0,
                                       ",".join(ride.get("states") or []), E)), "untest probe"

    # 7. a pound / breakable claim
    if pnd and (C & {"unbroken", "inert"}):
        if not strong:
            return weak()
        broke = (pnd.get("brokenAfter", 0) > pnd.get("brokenBefore", 0)
                 or len(pnd.get("triggeredAfter") or []) > len(pnd.get("triggeredBefore") or [])
                 or (pnd["coins"][1] or 0) > (pnd["coins"][0] or 0)
                 or (pnd["crests"][1] or 0) > (pnd["crests"][0] or 0))
        if broke:
            return "FIXED", ("a ground pound at the recorded spot now breaks it (broken %d->%d, triggers "
                             "%s->%s, coins %s->%s) — %s"
                             % (pnd["brokenBefore"], pnd["brokenAfter"],
                                len(pnd.get("triggeredBefore") or []), len(pnd.get("triggeredAfter") or []),
                                pnd["coins"][0], pnd["coins"][1], E)), "untest probe"
        return "STILL REPRODUCES", ("a ground pound at the recorded spot still breaks nothing (pound state %s, "
                                    "broken %d->%d, triggers %s->%s) — %s"
                                    % (pnd.get("state"), pnd["brokenBefore"], pnd["brokenAfter"],
                                       len(pnd.get("triggeredBefore") or []),
                                       len(pnd.get("triggeredAfter") or []), E)), "untest probe"

    # 8. a scarf / rigid-animation claim
    if "rigid" in C and hero and re.search(r"scarf|cloth", " ".join(
            [d.get("where") or "", d.get("happened") or "", d.get("should") or ""]), re.I):
        sc = hero.get("scarf") or {}
        if not sc:
            return None, ("the scarf is not an Object3D in the rig — hero.js merges its geometry into "
                          "`nim.body` and drives it from a verlet particle array (`_scarfP`), so a node "
                          "sampler reports it as perfectly still whatever it is doing. This station's probe "
                          "predates the particle-array sampler; re-run `_untest_probe.py` for this course to "
                          "decide it — " + E), "untest probe"
        if sc:
            mx = max(sc.values())
            if mx >= 0.02:
                return "FIXED", ("the scarf is not rigid: %.3f m of local travel across its %d links over a "
                                 "1.4 s run — %s" % (mx, len(sc), E)), "untest probe"
            return "STILL REPRODUCES", ("the scarf is rigid: %.4f m of local travel across its %d links over a "
                                        "1.4 s run — %s" % (mx, len(sc), E)), "untest probe"

    # 9. a "nothing sank" claim
    if "nosink" in C and swim:
        if not strong:
            return weak()
        if not swim.get("inWaterAtStart"):
            return None, ("the recorded spot is not in water on this build (inWater=false on arrival), so the "
                          "sink claim cannot be re-measured there — the tester must name a point inside the "
                          "body. Measured anyway: " + E), "untest probe"
        if (swim.get("sinkLowest") or 0) <= -0.3 or swim.get("submergedAfterSink"):
            return "FIXED", ("crouch now sinks the hero %+.2f m (submerged=%s) — %s"
                             % (swim["sinkLowest"], swim.get("submergedAfterSink"), E)), "untest probe"
        return "STILL REPRODUCES", ("crouch still moves the hero only %+.2f m (submerged=%s) — %s"
                                    % (swim.get("sinkLowest") or 0, swim.get("submergedAfterSink"), E)), "untest probe"

    # 9a. a critter that "does nothing": walk into it and read what happened.
    bump = m.get("bump") or {}
    if "inert" in C and bump.get("target") and "reacted" in bump:
        if not strong:
            return weak()
        t = bump["target"]
        if bump["reacted"]:
            return "FIXED", ("walking into the %s at %s now does something (states %s, deaths %s, coins %s->%s, "
                             "critter after %s) — %s"
                             % (t["kind"], t["p"], ",".join(bump["states"]), bump["died"],
                                bump["coins"][0], bump["coins"][1], bump.get("critterAfter"), E)), "untest probe"
        return "STILL REPRODUCES", ("the hero walks through the %s at %s with no reaction at all (states %s, "
                                    "no death, coins %s->%s, %d active kill volumes on it) — %s"
                                    % (t["kind"], t["p"], ",".join(bump["states"]),
                                       bump["coins"][0], bump["coins"][1], t.get("killsActive", 0), E)), "untest probe"

    # 9b2. "the current runs at 2.22 m/s against an authored 3.2" — the ride
    #      battery stands still in the field for 8 s, so the drift IS the speed.
    if "slowField" in C and ride and strong:
        vols = [v for v in ((m.get("point") or {}).get("volumes") or [])
                if v.get("kind") in ("current", "wind", "conveyor")]
        authored = None
        for v in vols:
            pw = (v.get("props") or {}).get("power")
            if isinstance(pw, (int, float)):
                authored = pw
        measured = round((ride.get("disp") or 0) / 8.0, 2)
        if authored:
            ok = measured >= 0.85 * authored
            return ("FIXED" if ok else "STILL REPRODUCES",
                    ("the field carries the hero %.2f m/s against an authored %.2f (8 s of zero input in the "
                     "%s volume) — %s" % (measured, authored, vols[0]["kind"], E)), "untest probe")
        return None, ("no current/wind volume covers the station on this build, so the authored-vs-measured "
                      "speed cannot be compared here — %s" % E), "untest probe"

    # 9c. "it hangs in mid air" / "the hole was never cut" — both are questions
    #     about what the ground under a coordinate is.
    gr = ((m.get("point") or {}).get("ground") or {}).get("ray")
    if "floating" in C and strong and m.get("point") is not None:
        if gr is None:
            return "STILL REPRODUCES", ("nothing is under the recorded spot — a downward ray from the "
                                        "station finds no surface at all — %s" % E), "untest probe"
        drop = round(st0["p"][1] - gr["y"], 2)
        if drop >= 2.0:
            return "STILL REPRODUCES", ("the recorded spot still stands %.2f m clear of the nearest surface "
                                        "below it (%s at y %.2f) — %s" % (drop, gr["surface"], gr["y"], E)), "untest probe"
        return "FIXED", ("the recorded spot is %.2f m above the surface under it (%s at y %.2f), i.e. it is "
                         "planted, not floating — %s" % (drop, gr["surface"], gr["y"], E)), "untest probe"
    if "missingHole" in C and strong and m.get("point") is not None:
        if gr is None or (st0["p"][1] - gr["y"]) > 1.0:
            return "FIXED", ("the deck is open here: the first surface below the station is %s — %s"
                             % (("nothing at all" if gr is None else "%s at y %.2f" % (gr["surface"], gr["y"])), E)), "untest probe"
        return "STILL REPRODUCES", ("the deck is still unbroken here: solid %s at y %.2f, %.2f m under the "
                                    "station — %s" % (gr["surface"], gr["y"], st0["p"][1] - gr["y"], E)), "untest probe"

    # 10. undecided — say exactly what is missing
    if not strong:
        return weak()
    if C & {"visual", "text"}:
        return None, ("a colour / legibility claim: the probe stood at the coordinate and measured the frame, "
                      "but 'reads as' needs an eye or a named reference colour — %s" % E), "untest probe (frame claim)"
    missing = []
    if "gapmiss" in C and not cross:
        missing.append("the crossing test needs BOTH ends of the gap and the report names only one — add the "
                       "far ledge's coordinate")
    if cls == "stairs" and walk4:
        missing.append("the flight was climbed %+.2f m with %d bonk frames; the report does not name the height "
                       "the flight has to reach, so short-of-what cannot be decided"
                       % (walk4["climb"]["dy"], walk4["maxBonk"]))
    if "viewBlocked" in C:
        missing.append("the battery aims the lens at the station; this claim is about a SIGHTLINE from the "
                       "station to something else, which needs both ends")
    if "inert" in C and not ride:
        missing.append("the inert claim is about a critter or an NPC, not a pad — walking into it is the test, "
                       "and this defect did not ask for the bump battery")
    if "immobile" in C and walk4 and not walk4["allStuck"]:
        b0, w0 = walk4["best"], walk4["walks"]
        blocked = [w for w in w0 if w["disp"] < 0.6 and w["bonk"] >= 2]
        if blocked:
            missing.append("the spot is walled to the %s (%.2f m, %d bonk frames) and open to the %s (%.2f m); "
                           "the report does not say which heading was held, so neither reading is safe"
                           % (blocked[0]["dir"], blocked[0]["disp"], blocked[0]["bonk"], b0["dir"], b0["disp"]))
    if "rigid" in C and hero and not re.search(r"scarf|cloth", " ".join(
            [d.get("where") or "", d.get("happened") or ""]), re.I):
        missing.append("the claim is about a POSE (an un-posed slopeSlide / T-pose), not the scarf; the "
                       "battery samples the rig during a WALK, so it never enters the state complained of "
                       "— a pose battery has to drive the hero into that state and read the arm bones")
    if not missing:
        missing.append("no measurement in the battery speaks to this claim")
    return None, ("the battery ran at the tester's own coordinate and nothing in it contradicts or confirms his "
                  "words. What is missing: " + "; ".join(missing) + " — " + E), "untest probe (inconclusive)"


def main():
    dry = "--dry" in sys.argv
    rows = VERD["verdicts"]
    changed = Counter()
    reasons = Counter()
    for r in rows:
        if r["verdict"] != "COULD NOT TEST":
            continue
        key = r["key"]
        if key in HAND:
            v, w = HAND[key][0], HAND[key][1]
            src = "untest replay frame, read"
        else:
            v, w, src = decide(key)
        st0 = ((M.get(key) or {}).get("stations") or [{}])[0]
        if st0.get("p"):
            r["probeStation"] = st0["p"]
            r["probeStationFrom"] = "%s / %s" % (st0.get("kind"), st0.get("src"))
        if v:
            r["verdict"] = v
            r["evidenceSource"] = src
            r["evidence"] = w
            r.pop("stillUntestedBecause", None)
            changed[v] += 1
            fr = (((M.get(key) or {}).get("m") or {}).get("frame") or {}).get("png")
            if fr:
                r["frame"] = fr
        else:
            r["evidenceSource"] = src or r.get("evidenceSource")
            r["evidence"] = w or r.get("evidence")
            r["stillUntestedBecause"] = (w or "")[:260]
            reasons[(GROUPS.get(key) or {}).get("primary") or "unknown"] += 1
            changed["COULD NOT TEST"] += 1
    tot = Counter(r["verdict"] for r in rows)
    VERD["totals"] = {"fixed": tot["FIXED"], "stillReproduces": tot["STILL REPRODUCES"],
                      "couldNotTest": tot["COULD NOT TEST"]}
    byc = {}
    for r in rows:
        byc.setdefault(r["cls"], Counter())[r["verdict"]] += 1
    VERD["byClass"] = {c: dict(b) for c, b in sorted(byc.items())}
    print("re-measured the 162 previously-untestable defects:", dict(changed))
    print("TOTALS over all 315:", dict(tot))
    print("\nstill untestable, by primary blocker:")
    for k, n in reasons.most_common():
        print("  %-24s %3d" % (k, n))
    if dry:
        return
    VERD.setdefault("meta", {})["reMeasured"] = {
        "pass": "untestable-backlog (2026-09-08)",
        "took": "the 162 COULD NOT TEST entries of the replay pass",
        "left": tot["COULD NOT TEST"],
        "howToReadTheRest": ("every entry that is still COULD NOT TEST now carries `stillUntestedBecause`: "
                             "one line naming exactly what is missing (a coordinate, the far end of a gap, "
                             "an eye on a colour, a beat the battery does not stage)."),
        "byPrimaryBlocker": dict(reasons)}
    VERD.setdefault("passes", []).append({
        "pass": "untestable-backlog", "date": "2026-09-08",
        "harness": ["_untestlib.py — goto+verify, save-state setter, clock advance, two-input, "
                    "screen/material/frame reads, station resolver",
                    "_untest_probe.py — per-class battery runner",
                    "_untest_groups.py — blocker grouping",
                    "_untest_verdict.py — this file"],
        "reMeasured": sum(changed.values()), "outcome": dict(changed)})
    with open(os.path.join(RP, "_replay_verdicts.json"), "w", encoding="utf-8") as f:
        json.dump(VERD, f, indent=1, ensure_ascii=False)
    print("\nwrote", os.path.join(RP, "_replay_verdicts.json"))


if __name__ == "__main__":
    main()
