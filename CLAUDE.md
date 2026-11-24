# Owner's working standard (applies to every game in this repo)

Recorded 2026-11-23 from the owner's own instructions. Every session and every agent it starts follows this.

## Quality
- The best job done, always. Never cut corners, and never brief an agent to "do the minimum" or to treat budget as the top constraint.
- Fix the real cause of a fault, not the symptom. Verify by measurement, on desktop and phone for anything a player sees.
- Report honestly: what was verified, what was not, and what is still open.

## Spending
- Spend the least that still gets the best job. Saving comes only from not wasting work: no repeated runs that add nothing, no audits of things that did not change.
- Several agents at once are fine. Size each one to its job by model and effort:
  - hard, cross-cutting work (physics, camera, core systems): the strongest model, high effort;
  - ordinary features and fixes with a known cause: a mid model, medium effort;
  - mechanical work (check rows, text, probe runs, deploy checks): a small model, low effort.
- Do not run every agent at the top setting. Small updates must not cost like large ones.
- If the owner sets a usage limit (for example "stop before 95 % weekly"), respect it; say plainly if the meter cannot be seen.

## Orchestrating
- The session lead orchestrates: adjusts as work lands and brings recommendations to the owner. The owner generally follows them.
- Agents never run git write commands; the lead commits and pushes, only to the session's assigned branch. No pull request unless asked.

## Product rules
- No external assets, no paywall, no ads, no currency.
- Published save keys are never renamed; old saves must keep loading.
- A live game's published behaviour must keep working after every change.

## Secrets
- Never ask the owner to paste a secret in chat; use the secure credential form. Treat the owner's email and project details as private.
