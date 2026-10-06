# CUT & RECONNECT: slice a squishy into pieces and put it back together

**Status:** owner request, 2026-10-06. Designed here; built by the PHYS, RENDER, AUDIO and SHELL lanes against the optional contract
members marked `CUT` in `src/contracts.ts`. The idea comes from reference clip A ("Each cut, another size", "Everything reconnects";
see [`REFERENCES.md`](REFERENCES.md)). Everything here is our own: our gestures, our look, our sounds. No frame, sound or wording from
the clip is used.

## 1. What the player does

| Step | What happens |
|---|---|
| Pick the **Cut** tool (a blade icon next to the Hoard button; `C` when keyboard shortcuts are on) | The cursor or finger hint changes to a thin blade line. Every other gesture is paused while the tool is on. |
| **Swipe across** a squishy | It is sliced along the swipe. The cut plane is the plane through the camera that contains the swipe, so what you draw is what you cut. |
| Watch it part | For about 0.25 s the jelly pinches along the line into a thin waist. A thin warm seam glows along the cut (a glow, never a flash). The two parts pull apart, a tacky strand stretches between them and snaps (long for sticky and slime, barely there for gel), and the pieces spring a little apart and wobble. |
| **Each cut, another size** | Where you cut sets the sizes. Through the middle gives two halves; near an edge gives a small chunk and a big piece. Volume is conserved exactly. |
| Cut again | Any piece can be cut again, with the same rules. |
| Play with the pieces | Turn the tool off. Pieces are real soft bodies: poke, squish, pull, pick up and toss them, and they push against each other. |
| **Reconnect** | Drag a piece into another and hold them together for about 0.4 s, or let go while they touch. They bridge with a glowing neck, flow together and become one bigger piece. A gloopy merge sound plays. |
| **Reconnect all** | One button in the Cut tool's popover. Every piece flows back to the face piece and the squishy is whole again (about 1.2 s). |

**The face piece.** One piece always keeps the face (the eyes) and the species silhouette, scaled to its size: the piece on the
side of the cut that holds the eyes' anchor point. Every other piece is an eyeless, rounded **chunk** of the same jelly (same
material family, colour, pattern and core glow) with a flat cut face that slowly rounds over in about 2 s. Plastic families keep
the flat face longer (putty about 6 s, mochi about 4 s), so a fresh cut looks fresh.

**Whole again means exactly whole.** When the last piece reconnects, the squishy is bit-for-bit its original self: the same genome,
size, silhouette and face, at full volume.

## 2. Rules that keep the toy honest

1. **Cutting never creates items.** Pieces are a play state of the one squishy in your hands. They never appear in the Hoard, never
   count as copies, and cannot be merged, traded or kept.
2. **Leaving reconnects.** Switching squishy, opening the Hoard, opening a capsule, starting a merge, hiding the tab for more than
   60 s, or reloading puts the squishy back together first: with the 1.2 s animation if it is on screen, instantly otherwise.
3. **No economy change.** Touches on pieces pay the meter exactly as touches on a whole squishy do (pokes, squeezes, pulls, with the
   same freshness rule). Cutting and reconnecting themselves pay nothing. `DESIGN.md` 5.4 and the economy simulation are unchanged.
4. **Limits.** At most 6 pieces at `high` and `med` quality, 4 at `low`. No piece smaller than 1/8 of the whole. A refused cut gives
   a small "too small" wobble (or "that's as many pieces as it can make") and a polite live-region line; nothing breaks.
5. **Calm effects** (DESIGN 6.6): a softer seam glow, no camera move, shorter strands, no shake. There is never a screen flash.
6. **Accessibility.** With the squishy focused, the Cut tool's popover offers **Split in two** (a vertical cut through the middle as
   the camera sees it) and **Reconnect all**. Both are buttons, reachable by keyboard, announced in the live region ("Cut into 2
   pieces", "Whole again"). The tool never needs a drag.

## 3. How each family cuts (flavour, from `SQUISHY_SCIENCE.md` section 4)

| Family | Cut feel |
|---|---|
| Jelly gel, gummy, water-fill | Clean and quick; the halves wobble hard. Water-fill pieces slosh. |
| Sticky stretch, slime goo | The waist strings out into a long strand before it snaps; pieces are tacky and reconnect eagerly. |
| Putty, mochi dough | A slow, sharp cut; the flat cut face stays for seconds. |
| Slow-rise foam, marshmallow | The waist compresses before it parts; the pieces puff back. |
| Firm silicone, pop dome | Resists: the pinch takes longer (about 0.4 s); the pieces snap back to round fast. |
| Bead squeeze | A crunchy cut; the pieces stay lumpy. |

## 4. How it is built (lanes)

**PHYS** (`src/physics`). The cut is a goal morph, not mesh surgery, so it stays robust.
1. `measureCut(plane)`: the volume fraction on each side, so the shell can enforce the limits before it starts.
2. `setNeck(plane, t)`: morphs the shape-matching goal into a waisted peanut along the plane (eased; t = 1 is a waist about 0.15 of
   the body's width). The volume constraint holds throughout.
3. At t = 1 the shell replaces the body with two new bodies built with `new SoftBody(genome, { piece })`. Each is placed at its
   lobe's centre of mass with the lobe's velocity plus a small separating push. Their rest shapes are the face piece (the species
   shape scaled by the cube root of its fraction) and the chunk (a rounded blob with a flat face toward the cut that rounds over by
   the family's memory). Pieces under 0.35 of the whole use mesh detail 2 to stay inside the frame budget.
4. `setFrac(frac, seconds)`: grows or shrinks a body's rest volume smoothly. Reconnect = the receiver grows by the giver's fraction
   while the giver shrinks into it, then the giver is removed.
5. **Body-to-body contact** (stage B item B2): `collide(others)` pushes particles of different bodies apart (bounding-sphere broad
   phase, a particle-against-surface narrow phase, friction) and emits `bump` events. Pieces need it so they can push and touch.
6. Determinism, zero allocation per step, every fold, hop and robustness gate per piece, and perf: 6 pieces must cost no more per
   frame than 2 whole bodies.

**RENDER** (`src/render`). `AddBodyOpts.chunk` (a piece without a face); the cut seam glow (`setCutSeam`) along the plane while the
neck forms; the strand between the parts as they separate (reuse the tack-strand renderer); the reconnect bridge glow
(`setBridge`); frame all pieces on the mat; the flash governor applies (glows only, no flashes).

**AUDIO** (`src/audio`). `cut({ phase: 'start' | 'separate', ... })`: a wet slice that follows the neck, then the separation pop
(pitch by the smaller piece's size: small pieces sound higher). `rejoin({ ... })`: a gloopy merge "blorp" whose size follows the
merged volume, and a gentle rising flourish for Reconnect all. Both make room in the music like every other effect.

**SHELL** (`src/shell`, `src/ui`). The Cut tool (button, `C` key, popover with Split in two and Reconnect all); the swipe-to-plane
mapping; the piece manager (limits, the face piece, the replace-at-t=1 swap, drag-to-reconnect detection with a 0.4 s hold or a
release while touching); reconnect-on-leave (rule 2); meter mapping (rule 3); haptics (a tick at the cut, a thump on reconnect);
the live-region announcements.

## 5. Contract (all optional; every lane feature-detects; types in `src/contracts.ts`, marked `CUT`)

* Physics: `CutPlane`, `PieceOpts`, `SoftBodyCtor` option `piece`; `SoftBodyLike.frac`, `measureCut`, `setNeck`, `setFrac`,
  `collide`; the `bump` event kind.
* Render: `AddBodyOpts.chunk`; `StageLike.setCutSeam`, `setBridge`.
* Audio: `SquishAudio.cut`, `rejoin`.

## 6. Acceptance checks

| Id | Check |
|---|---|
| X01 | A centre cut makes two pieces whose fractions sum to 1 (within 0.5%) and whose measured volumes match their fractions (within 3%). |
| X02 | An edge cut gives the sizes `measureCut` predicted (within 3%); a cut that would leave a piece under 1/8, or more pieces than the limit, is refused cleanly. |
| X03 | The face stays on exactly one piece, the one holding the eyes' anchor; chunks have no face. |
| X04 | Cut into 6 pieces, then Reconnect all: the result's rest shape, volume and genome equal the original (shape RMS under 0.002 R0). |
| X05 | Every leave path (switch, Hoard, capsule, merge, hidden 60 s, reload) reconnects first; the Hoard never shows a piece. |
| X06 | The meter pays nothing for a cut or a reconnect, and pays a poke on a piece like a poke on a whole squishy. |
| X07 | No piece folds, hops, tunnels through another piece or the table, or loses determinism (the probe_softbody limits apply per piece). |
| X08 | Frame cost with 6 pieces is no more than with 2 whole bodies (same machine, solo). |
| X09 | The flash gate holds through 10 rapid cuts and a Reconnect all (no more than 3 luminance transitions in any 1 s; no screen flash). |
| X10 | Keyboard only: focus the squishy, open the Cut tool, Split in two, Reconnect all, with live-region announcements. |
