# Notes for the shell's Cut tool (collected from the lane reports)

## Audio (cut/rejoin voices, built)
- The audio lane built `cut()` and `rejoin()`.
- `frac` is the share of the WHOLE squishy, not of the piece being cut. For `cut`, pass the smaller resulting piece's share of the whole.
- Do NOT also call `audio.strand()` for the strand drawn between parting pieces. The cut voices already carry it.
- Call `cut({ phase: 'start', neckS, frac, family, pan, calm, pitch })` when the neck starts. Call
  `cut({ phase: 'separate', frac, ... })` at t = 1, when the pieces part.
- Call `rejoin({ frac: mergedShareOfWhole, pitch, calm })` when two pieces flow together. Call `rejoin({ frac: 1, all: true })`
  when Reconnect-all completes ("whole again").
- `pitch` is the squishy's genome pitch ratio. It is an optional contract field, being wired now.
- The rate limiter is inside the engine. Ten cuts in 2 s are safe.

## Economy
- Cutting and reconnecting pay nothing (`CUT.md` rule 3). Touches on pieces pay as usual through `collection.feed`.
