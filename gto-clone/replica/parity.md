# Parity report (2026-10-29)

Computed by hand with parity.py's rules (Python isn't installed): must 3, should 2, could 1, partial = ½, skip rows excluded.

| priority | rows | done | partial | missing | points |
| --- | --- | --- | --- | --- | --- |
| must | 16 | 16 | 0 | 0 | 48 / 48 |
| should | 11 | 10 | 1 | 0 | 21 / 22 |
| could | 6 | 0 | 2 | 4 | 1 / 6 |
| **total** | 33 | 26 | 3 | 4 | **70 / 76 = 92%** |

Must-haves: 16/16. By area, weakest first: stats (could: replayer missing), study (could: breakdown, equity graph), practice (could: multi-table), settings.

**Layout score:** not measured. Recon used public text sources only (no screenshots of the original's logged-in app), so there's nothing to diff against. The structure follows the recon map: action line on top, grid left, info/actions/hand/categories on the right.

## Missing, in build order
1. Breakdown tab (S06): stacked bars of each action's range by hand category.
2. Hand replayer (S17): step through practiced hands from Stats.
3. Equity graph on the Ranges tab.
4. Multi-table trainer (2–4 tables).
5. Spot-selector popup (J) and the blockers table.

## Behaviour differences
| flow | original | clone | keep / fix |
| --- | --- | --- | --- |
| F01 pick a preflop spot | pick each seat's action | the same, plus one click on a later seat folds to it | keep |
| F02 reach a flop | ~7 clicks | 5 clicks (seat, raise, fold, call, Random) | keep |
| Strategy source | solver library + AI solver | heuristic generator, labelled "demo strategies" | the real gap. Plug in solver output later (`analyze()` is the single seam) |
| Multiway | multiway solutions exist | always heads-up after a second player enters | keep for v1 |
| Remembered between visits | account, cloud | localStorage on this device; Study line in the URL | keep (personal) |
| Free-hand limit | 10/day for free users | none | keep |

## Verdict
**Shippable for personal use:** all must-haves done, feature score 92%, no open S1 or S2 bugs (B01, the S2, is fixed). It isn't "better than the original": the strategies are heuristic, not solved. That's the honest ceiling of a clean-room clone without a solver.
