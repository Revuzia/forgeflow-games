# CUT3: cut as much as you like (no piece limit), tips that fall off, the same for Minis

**Status:** owner request, 2026-10-09 (chat): "I can split the squishies in half but I should be able to cut them as much as I want. A star for example: I should be able to cut its tips off and those fall down, and even cut the middle further. Not necessarily an end to the cuts." and "Minis also cut to a LIMIT; we need to extend this limit or remove it."
Read with [`CUT2.md`](CUT2.md) (the true cut; its limits are REPLACED here) and [`CUT_MINIS.md`](CUT_MINIS.md). Where this file and CUT2.md / CUT_MINIS.md disagree, THIS file wins.

## 1. What the player gets
Cut any piece, any time, as often as they like, in both styles. A swipe across a tip of a star takes the tip off as its own piece and it **falls** (it is a real body in gravity mode: it drops to the table, bounces, settles). A swipe across several tips takes several off at once (one piece each). Cut the middle again, cut the pieces again. Pieces can be as small as a crumb. Minis: any mini can be cut again into minis, as many times as you like. **Reconnect all** still returns the exact original, whatever the count. Dragging pieces together still joins them (CUT2 section 7).

## 2. Rules that replace the old limits
1. **No piece-count limit and no minimum piece size** that the player can run into in normal play. CUT2's "at most 6 (4 on low)" and "no piece under 1/8" (CUT.md 2.4, CUT2.md, CUT_MINIS.md rule 1) are REMOVED. The `MAX_PIECES` constants and the "That's as many pieces as it can make" / "Too small to cut" refusals go away.
2. **Honest engineering limit, invisible in normal play.** The simulation has a total budget (below). Pieces get cheaper as they get smaller (mesh detail by share: >= 0.35 detail 3, 0.08 to 0.35 detail 2, 0.02 to 0.08 detail 1, below that the coarsest mesh the solver supports), resting tiny pieces SLEEP (no solver steps until touched or hit; they still draw), contact is only computed between awake or moving pieces. A **safety ceiling of 64 live pieces** exists only to protect phones; reaching it is answered kindly ("That's a lot of pieces! Reconnect some to keep cutting.") and is reported to the owner by the harness, not hidden. The target is that real play (dozens of pieces) never reaches it.
3. **Multi-part results become several pieces, not a refusal.** CUT2.md 4.4 refused a cut that "would leave loose crumbs" (one side made of two or more separate parts, such as both ears of a species taken off by one level plane, or two tips of a star). Now each connected part becomes its own piece (a body per component, each with its exact share, summing to the parent). The refusal remains only for a result the builder cannot make into a valid mesh (a sliver thinner than the mesh can hold): the cut is nudged by the retry ladder first, then refused with a plain line.
4. **Pieces fall.** A piece born above the table is released with the velocity of its material (the parent's) and falls under gravity; it must land without launching (X13 bars hold for every new piece: rise <= 0.06 m after the swap, speed <= 1.0 m/s up, settle <= 1.2 m/s from 0.1 s). In float mode pieces drift as the parent did.
5. Everything else in CUT.md / CUT2.md rule sets holds: volume exact, nothing is created or stored, the meter pays nothing for cutting or joining (touches on pieces pay as on a whole squishy), leaving reconnects first, Calm effects, no flash, keyboard path (Split in two works on the largest piece, repeatedly), live-region lines.

## 3. Budgets (measured by the engineers; bars are the owner's "does not get slow")
| Budget | Bar |
|---|---|
| Physics step, N pieces awake | 1 whole squishy 2.0 ms is the existing bar; N pieces: total solver particles <= 3 x a whole body (about 1,900) for the AWAKE set; asleep pieces cost < 0.01 ms each |
| Frame at 24 pieces (12 awake) on this machine | <= 1.5 x the frame with 2 whole bodies |
| Mesh | a piece's draw cost scales with its detail; 64 pieces <= 64 x 2 draw calls; shadows only for the 8 largest pieces |
| Framing | the camera pulls back so every piece stays in frame between the safe insets (CUT2 8.6, SR2); pieces that roll away stay in the mat's rim |
| Memory | no per-step allocation; piece builds cached; pooling for bodies and meshes |
| Cut latency | a swipe to the visible parting <= 0.6 s even at 24 pieces (builds are time-sliced) |

## 4. What this changes in the build
**PHYS** (`src/physics`, the one owner of `softbody.ts` this round): the connected-component split of a clipped region (`region.ts` / `piece.ts`: a cell with several components yields several bodies; `planCut` reports `parts`); detail by share and the coarsest-mesh floor (check `SoftBody` supports detail 0 and 1; if not, add them); sleep / wake for resting small pieces; a budget accountant (`awakeParticles`); the contact broad phase for N bodies (`collide` is pairwise: sort-and-sweep or a grid so 64 bodies are not 2,016 pair tests per frame); the X13 launch bars for tips and crumbs (50 species x tip cuts); perf rows at 2, 6, 12, 24, 64 pieces.
**SHELL** (`src/shell/cut.ts`, `cutRegion.ts`, `cutText.ts`, `cutBinding.ts`): remove `MAX_PIECES*` and the 1/8 rule, route multi-part plans to several bodies, the cut tree handles any number of leaves (it already does: X18 ran to 6 leaves; extend the property test to 64), Split in two on the largest piece, Minis: any piece cuttable repeatedly, joins and Reconnect all for any count, the safety-ceiling line, the refusal wording.
**RENDER**: draw cost by detail, shadows for the largest pieces only, instancing or pooling for tiny pieces if measured necessary, framing of many pieces, the cut face on tiny pieces (a 1/200 crumb must still read as jelly).
**UI**: the Cut bar's "pieces" counter says the number (no "of N"); no disabled Split state except when the safety ceiling is reached.

## 5. Acceptance checks
| Id | Check |
|---|---|
| U01 | 20 consecutive Split in two presses on the largest piece (both styles) all succeed; shares sum to 1 within 1e-9; Reconnect all ends bit-for-bit whole. |
| U02 | A star-like species (5 or more tips): one swipe across a tip takes it off as its own piece that falls and rests on the table (rise after landing <= 0.06 m, no launch); 5 swipes take 5 tips; the middle can be cut further. Run on the 12 family representatives and every species with 3 or more lobes. |
| U03 | A swipe across several tips at once makes several pieces (one per component); volumes sum to the parent's within 0.5 percent. |
| U04 | 24 pieces: frame cost <= 1.5 x two whole bodies; 64 pieces: no crash, no NaN, safety line shown at the ceiling and cutting works again after a join. |
| U05 | Minis to 24 minis: each has a full face; no mini under the coarsest-mesh floor loses its face; Reconnect all exact. |
| U06 | A resting tiny piece sleeps (solver steps = 0) and wakes on a touch or a hit; the sleeping set costs < 0.01 ms each. |
| U07 | Nothing pays the meter for cutting; the Hoard never sees a piece; leave paths reconnect first at 24 pieces. |
