import io, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(HERE, "_playreports", "rime-1.json")
with io.open(p, encoding="utf-8") as f:
    r = json.load(f)
D = r["defects"]
NEW = [
{
 "where": "rime-1 BEAT 7, THE CHAPEL TRACK -- the authored trodden-snow path and its coin line, waypoints [12,-25] [8,-29] [4,-33] [0,-37] [2,-42] [2.8,-46.5]",
 "did": "walked the required route from the village square all the way to the chapel green, leg by leg, following the trodden track exactly as it is drawn on the snow",
 "happened": "THE PATH WALKS YOU INTO THE CHAPEL WALL. Every leg up to (0, 14.45, -36.6) arrived cleanly, and then the next leg -- toward the green at (2, -42), which is where the track decal goes -- ended at (2.83, 14.29, -36.62) after 320 frames of `bonk`, `pivot` and `run`: 5.44 m short, having moved sideways and not one metre south. The nave is a 12 x 5.5 x 8 building at (-2, -41), i.e. x -8..4 and z -45..-37, so the path's own waypoint (2, -42) is INSIDE the chapel and the segment (0,-37) -> (2,-42) runs straight through its south wall. The coin trail stops dead at (0,-37) for the same reason.",
 "should": "route the track round the nave -- east of x 4 or west of x -8 -- and take the coin line with it. The green, cp5, the tower and the course's OPEN CREST are all past this point; the player CAN walk round the building, but the one visual guide the course gives him points at a wall.",
 "png": "_shots/play_rime1b/31_r2_green.png",
 "note": "an earlier leg also stalled: 'walk -> (8.0, -29.0) ended [10.33, 10.93, -28.17] d=2.47 DID NOT ARRIVE'."
},
{
 "where": "rime-1, the saturated magenta / lime-green marker VFX -- seen on THE LAKE RUN start pad at (0, 1.36, 55) and again as a bright magenta plume standing over the ice on the east side of the lake",
 "did": "looked at the lake from the spawn and from the plug",
 "happened": "two separate hot-magenta plumes and a lime-green outlined octagon sit on a course whose whole palette is snow white, ice blue, aurora green-cyan, gold and bronze. On a dusk snowfield they are the most saturated thing in frame by a wide margin and they read as debug overlays rather than as course furniture.",
 "should": "tint the race/marker VFX from the theme palette (checkpoint / accent / crest) the way the checkpoint pads already are -- those look right.",
 "png": "_shots/play_rime1b/01_r2_on_plug.png",
 "note": "the ambient snow quads are visible in the same frame as flat white slivers lying ON the ice at assorted angles rather than as camera-facing flakes -- see the particle defect above."
},
]
have = set((d["where"], d["did"]) for d in D)
for n in NEW:
    if (n["where"], n["did"]) not in have:
        D.append(n)
W = [
 "THE REQUIRED WALK FROM THE SQUARE TO THE HILLSIDE LEDGE IS SOLID. square (0, 4.70, 3) -> (2.5, 4.70, -2.0) -> (6.3, 6.29, -8.3) -> (10.0, 8.60, -13.9) -> (13.4, 10.20, -19.8) -> cp-ledge (14.3, 10.20, -22.7), every leg arriving within 1.2 m on a plain run with no jumping, and cp4 fired on the way. The hillside gradient really is a walk, as the course claims.",
 "CHECKPOINTS FIRE ALONG THE ROUTE -- the HUD's cp counter reached 3 by the time the walk got to the ledge, without any special handling.",
]
for w in W:
    if w not in r["worked"]:
        r["worked"].append(w)
B = [
 "THE SLEIGH LIFT WAS NOT RIDDEN. The mover's mesh is not exposed on the hazard object (h.mesh is null -- it is inside a BatchedMesh), so my driver could not find where the sleigh was in its 18 s cycle to board it. The lift, the ride up to the crest shelf, and stepping off at the top are untested.",
 "THE KICKER AT THE BOTTOM OF THE CREST FACE WAS NOT JUMPED. I rode the face at up to 17.28 m/s and over the kicker, but my driver never pressed jump at the lip, so whether the intended belfry landing works is untested. Without the jump you land on the green at 15.10 and bonk into the tower's north wall -- which is the documented failure case, not evidence against the kicker.",
 "THE TWO RACES (THE LAKE RUN, 60 s; THE BELL RUN, 20 s) and the WING / OWL'S ROAD ring run were not attempted -- all three need the belfry, and the tower door defeated me.",
 "OLD FEN, the keep caretaker NPC, is not on this course (rime-1 authors no npcs), so there was nobody to talk to here.",
]
for b in B:
    if b not in r["blocked"]:
        r["blocked"].append(b)
# the old blanket "beats 5-9 untested" line is now wrong -- most of them were driven.
r["blocked"] = [b for b in r["blocked"] if not b.startswith("BEATS 5-9 COULD NOT BE DRIVEN")]
r["blocked"] = [b for b in r["blocked"] if not b.startswith("THE TWO RACES (THE LAKE RUN, 60 s shore-to-belfry")]
r["blocked"] = [b for b in r["blocked"] if not b.startswith("THE CAUSE OF THE ICE PLUG")]
r["blocked"] = [b for b in r["blocked"] if not b.startswith("WHETHER THE POUND ACTUALLY OPENS THE HOLE")]
r["blocked"].insert(0,
 "THE RUN WAS FOUGHT FOR. Five other lanes were driving headless Chrome at the same time; the box sat at 100 % CPU with 80-115 chrome processes and the local server (serve_nocache.py, single-threaded) starved badly enough that one page failed a dynamic import outright -- 'TypeError: Failed to fetch dynamically imported module: .../runtime/data/courses/rime-1.js'. Four driver runs had their browser killed mid-run. Everything reported here was measured with the engine STOPPED and game.update(1/60) hand-stepped, so the numbers are frames and are not affected by the load; but the coverage below is thinner than it should be, and the drivers (_harness/_r1play2.py, _r1step.py, _r1death.py) are committed so any of it can be re-run on a quiet box.")
with io.open(p, "w", encoding="utf-8") as f:
    json.dump(r, f, indent=1)
print("defects", len(D), "worked", len(r["worked"]), "blocked", len(r["blocked"]))
