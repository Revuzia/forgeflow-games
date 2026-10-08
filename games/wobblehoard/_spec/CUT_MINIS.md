# CUT STYLE "MINIS": cut a squishy into smaller copies of itself

**Status:** owner request, 2026-10-08 (chat): "can we also have a mode where we can choose to cut it, but it cuts it into the same squishy just smaller ones? That should be an easy build."
Read with [`CUT.md`](CUT.md) (the Cut tool, limits, leave rules) and [`CUT2.md`](CUT2.md) (the TRUE CUT: real geometric pieces). This is the second **cut style**; the first is the clean cut of CUT2.md.

## 1. What the player sees
The Cut tool has a **cut style** switch in its options bar: **Clean cut** (CUT2: each piece is the real part on its side of the cut, a flat cut face, the eyes stay where they are) and **Minis** (this file). In Minis, the same swipe or **Split in two** cuts the squishy into two or more COMPLETE, smaller copies of itself: the same species, colours, pattern and material, each with its own full face (both eyes, mouth), each a round little squishy in its own right. Where the cut falls sets the sizes exactly as in CUT.md (a middle cut gives two equal minis, an off-centre cut a big one and a small one); volume is conserved (a mini of fraction f is the species shape scaled by cbrt(f)).

## 2. Rules
1. Everything in CUT.md section 2 holds: no item is ever created, nothing reaches the Hoard, the meter pays nothing for cutting or reconnecting, the limits (6 pieces at high and med quality, 4 at low, none under 1/8), the leave paths reconnect first, the Calm and accessibility rules, the live-region lines (wording: "Cut into 2 minis").
2. The style can be changed only between cuts that leave the squishy whole or when it is whole: pieces made in one style cannot be mixed with the other. If the squishy is already cut, the switch is disabled with a plain reason ("Reconnect first to change the cut style"). The style is a per-session setting (not saved).
3. **Reconnect** works as today: a mini dragged into another (hold about 0.4 s, or let go while touching) flows into it and becomes one bigger mini; **Reconnect all** returns the exact original squishy (bit-for-bit, X04).
4. Every mini is a full body with its face: it blinks, looks at the pointer and reacts. Which mini is "the" play body for the HUD name tag is the largest.

## 3. How it is built (small, because the pieces exist)
The old CUT.md build already makes this shape: `PieceOpts { frac, chunk: false }` is "the species silhouette scaled to frac" with a face. Minis = both sides of the cut (and every later cut) built with `chunk: false`, each placed at its lobe's centre. Work: SHELL `src/shell/cut.ts` (the style flag; the piece manager must stop assuming exactly one face piece: any piece may be the receiver; the live-region wording), RENDER (nothing new: a non-chunk body already draws its face; verify several faced bodies at once, the framing of 6 minis, the face of the smallest), PHYS (nothing new; verify the 6-mini sequences on 50 species, including the launch stopgap that exists only for chunks), UI (the style switch in the Cut options bar; the toolbar spec of UI.md).
This must keep working after CUT2 replaces the chunk build: Minis uses the scaled-whole body, which CUT2 keeps as `piece.style = 'mini'` (additive; the old `chunk:false` is accepted).

## 4. Acceptance checks
| Id | Check |
|---|---|
| M01 | A middle cut in Minis makes two pieces, each with a full face (two eye meshes each, counted in the scene), fractions summing to 1 within 0.5 percent, measured volumes within 3 percent of their fractions. |
| M02 | A cut near an edge gives a large and a small mini; the small one's face is complete and legible at 1/8. |
| M03 | Six minis (the limit): all faces live, the frame cost no more than 2 whole bodies, no overlap, all inside the frame at 390x844 and 1280x800. |
| M04 | Reconnect all from six minis returns the exact original (X04 exactness: genome, rest shape, volume). A mini dragged into a mini becomes one mini of the summed fraction. |
| M05 | The switch is unavailable while cut, with the live-region reason; changing style on a whole squishy works from the keyboard; the default style is Clean cut. |
| M06 | The meter pays nothing for cutting or reconnecting; touches on minis pay like touches on a whole squishy. |
