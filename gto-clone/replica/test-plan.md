# Test plan

Runner: `tests.html` (in-browser; Node/Playwright aren't installed on this machine). Open http://localhost:8844/tests.html. Engine unit tests run first, then flow tests drive the real app in an iframe using labels, titles and roles. The suite fails on any uncaught error (X01) and checks accessible names on the grid (X02).

Last run: 2026-10-29, **30/30 passed**.

## Engine (U01–U17)
Evaluator ranks (straight flush, wheel, flush vs straight, boats, kickers), hand classes and draws, range equity (AA vs KK ≈ 82%, exact river, blocked combos), game tree (walks, heads-up after a 3-bet, all-in runout), strategy (frequencies sum to 1, AA always opens, 72o never opens UTG, BTN wider than UTG), range propagation, grading, determinism.

## Flows
| case | flow | what | auto |
| --- | --- | --- | --- |
| F01-H1 | study preflop | fold to BTN, open, SB folds, BB to act | yes |
| F01-E1 | study preflop | click an earlier chip rewinds the line | yes |
| F02-H1 | study postflop | BB calls, random flop, flop strategy + categories | yes |
| F02-E1 | study postflop | refresh mid-flow keeps the spot (line in URL) | yes |
| F02-E2 | study postflop | picker disables cards already on the board | manual ✔ |
| F03-H1 | filters | action-row filter on/off, P clears | yes |
| F04-H1 | ranges | both players shown on the flop | yes |
| F05-H1 | trainer | start drill, act, graded | yes |
| F05-E1 | trainer | double click records one decision | yes |
| F05-E2 | trainer | keyboard only: digits act, space deals | yes |
| F05-E3 | trainer | timebank expiry auto-checks/folds | manual ✔ |
| F06-H1 | trainer | full hand plays to the end | yes |
| F07-H1 | stats | sessions saved, expandable | yes |
| M-390 | all | 390px width, no horizontal scroll | manual ✔ |
| M-1440 | all | 1440px layout | manual ✔ |

Not applicable (no accounts, server or payments): expired session, second user's data, wrong password, declined card, 5xx responses.
