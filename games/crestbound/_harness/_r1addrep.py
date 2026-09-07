import io, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(HERE, "_playreports", "rime-1.json")
with io.open(p, encoding="utf-8") as f:
    r = json.load(f)
B = [
 "FREEING THE GNASHER (pound its post three times, which is what unlocks the barn) WAS NOT TESTED. My walk into the yard died on the way in and respawned at cp-ledge, so all four attempted pounds landed 30 m away up on the hillside and the 'gnasher-freed' flag stayed unset. Note that the death itself is the finding: walking from (-14.0, 5.30, 6.0) toward the barn door was fatal before I reached it.",
 "THE VILLAGE ROOFTOP LINE (four snow caps, sigil 2 on cap 4) WAS NEVER WALKED. The first hop, onto snow block 1 at (-14.6, 5.90, 11.8), killed Nim, and every following hop in that scene was him walking back from cp-shore across the lake. Sigil 2 is untested; sigil 4 (the bell gap) I did get, from a teleport onto cap 2.",
]
for b in B:
    if b not in r["blocked"]:
        r["blocked"].append(b)
W = [
 "THE PAGE IS CLEAN. Across every run of this playtest -- a dozen course loads, hundreds of teleports, three deaths and several thousand hand-stepped frames -- the console produced exactly ONE line, the 'props.js had no entry for: cart' warning. No errors, no shader warnings, no exceptions out of game.update.",
]
for w in W:
    if w not in r["worked"]:
        r["worked"].append(w)
with io.open(p, "w", encoding="utf-8") as f:
    json.dump(r, f, indent=1)
print("defects", len(r["defects"]), "worked", len(r["worked"]), "blocked", len(r["blocked"]))
