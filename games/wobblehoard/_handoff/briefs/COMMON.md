# Shared rules for every engineer on Squish Keeper (read first)

**The project.** The ForgeFlow Games monorepo is at /home/user/forgeflow-games. The game is **Squish Keeper**, built in
`games/wobblehoard` (the folder keeps its old name). It is a 3D soft-body squishy collectible toy:
- Three.js 0.186, TypeScript 7 strict with `erasableSyntaxOnly`, Vite 8. Relative imports end in `.ts`. Probes run under plain node 22.
- A custom XPBD soft body (`src/physics`), a procedural WebAudio engine with zero samples (`src/audio`), and a Three.js stage (`src/render`).
- A modular shell (`src/shell`, `src/ui`, `src/input`), pure core and data (`src/core`, `src/data`), and a local practice collection
  (`src/collection`).

All paths are relative to /home/user/forgeflow-games/games/wobblehoard unless absolute.

**Scratch.** Use /tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/<your lane>/ for everything
that is not repo code.

**Specs to know.** `_spec/CONTRACT.md` (lanes, gates, ports); `src/contracts.ts` (the seams, all additive; never rename or remove);
`_spec/DESIGN.md`; and your lane's specs named in your brief. Two new owner specs:
- `_spec/CUT.md`: cut a squishy into pieces and reconnect them.
- `_spec/FUN.md`: the toy tray, more activities, and the XP (meter) direction.

**You are a fresh engineer continuing someone else's work.** A previous engineer in your lane was stopped mid-task. Their work is
committed at HEAD. Before you build anything, read `git log --oneline -15` and the diff of your lane's files since the commit your
brief names, so you continue their work rather than redo it.

**Hard rules**
- **Files.** Edit only the files your brief says you own. Other engineers are working in parallel on the other lanes. Need a change
  outside your lane? Report it.
- **Git.** Never run any git write command (add, commit, push, stash, checkout, reset, restore, rm, mv). The orchestrator commits checkpoints.
- **Contract.** `src/contracts.ts` changes must be additive and documented. Report them.
- **Assets.** No new dependencies. No external assets: everything is procedural and original, with no samples, textures, models or fonts.
- **Product.** No paywall, ads or currency.
- **Checks.** `npx tsc --noEmit -p tsconfig.json` must stay clean at every step. Never loosen an existing check or threshold to pass.
  A check that encodes old behaviour that the owner deliberately changed may be re-specified only with a written reason in your report.
- **Machine.**
  - It has 4 shared cores and is shared with 4 other engineers.
  - Run at most 2 of your own processes at a time, and one browser at a time, on your port only.
  - Kill everything you start.
  - Browsers run through `_harness/pw.mjs`: Playwright with SwiftShader software WebGL2, which is slow. Wait a little if load is above about 12.
- **Images.** You can see images. Read your screenshots and filmstrips and judge them as a demanding product designer would.
- **Restarts.** Containers have restarted twice today. Keep the tree type-clean and working after each meaningful step, so a
  restart loses little.
- **Honesty.** Report real numbers, before and after. List weaknesses plainly. If time runs out, stop and report exactly what is done
  and what is not.
- **Player text.** The player-facing name is "Squish Keeper" (wordmark SQUISH KEEPER). Internal ids keep "wobblehoard", including
  the `wobblehoard:v1:*` storage keys, which must never be renamed.
