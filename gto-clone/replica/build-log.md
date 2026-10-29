# Build log

Run locally: `powershell -File serve.ps1 -Port 8844 -Root gto-clone` from the repo root (or the `gto-clone` entry in `.claude/launch.json`), then open http://localhost:8844.

| ID | date | status | missing / notes |
| --- | --- | --- | --- |
| S01 | 2026-10-29 | done | top nav, hash routes (#/study, #/practice, #/stats, #/design), settings drawer |
| S02 | 2026-10-29 | done | grid, action line, actions table, hand detail, info box, metrics. Postflop node ≈ 300 ms to compute, with a loading state |
| S03 | 2026-10-29 | partial | no popup table; instead, clicking a later seat chip folds to it in one click |
| S04 | 2026-10-29 | done | card picker modal + random |
| S05 | 2026-10-29 | done | side-by-side ranges, equity buckets, copy range. No equity graph |
| S06 | — | not built | breakdown tab (could) |
| S07 | — | skip | aggregate reports need a solved dataset |
| S08 | 2026-10-29 | done | summary table, sortable. No blockers table |
| S09 | 2026-10-29 | done | units, grid scaling, cell numbers |
| S10 | 2026-10-29 | done | 5 drills, position, difficulty, RNG, timebank, pause, auto-next, close-decisions bias |
| S11 | 2026-10-29 | done | 6-max table, hero at bottom, bet chips, villain reveal |
| S12 | 2026-10-29 | done | grade, EV loss, strategy for the hand, full-range grid on demand |
| S13 | 2026-10-29 | partial | range grid inside the feedback card; not a separate pop-out panel |
| S14 | 2026-10-29 | done | HUD tiles + session log |
| S15 | 2026-10-29 | done | lifetime tiles, grade distribution, per-drill table |
| S16 | 2026-10-29 | done | expandable sessions with decision table |
| S17 | — | not built | hand replayer (could) |
| S18 | — | skip | no paywall: personal tool |

Harder than expected:
- **Strategy generation** is the real product. GTO Wizard sells solver output; here it is heuristic (Chen-style preflop ordering, equity/draw/range-advantage rules postflop). It looks plausible but it is *not* GTO, and the app says so in the spot bar and settings.
- **Range equity speed:** naive range vs. range is 1.7M comparisons per runout. Solved with one shared runout set per node, a sorted villain range with prefix sums, and exact card-removal correction (`js/engine/equity.js`).
- **Preflop becomes heads-up** as soon as a second player enters (others auto-fold). This keeps postflop heads-up like most of the original's library, but it means no multiway pots or squeezes.

Screenshots for replica-diff were reviewed in the browser pane at 1440×900 and 390×844 rather than saved to `replica/clone-screens/` (no references of the original were captured either, since recon used public text sources only).
