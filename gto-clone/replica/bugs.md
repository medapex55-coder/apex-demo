# Bugs

| ID | sev | title | status |
| --- | --- | --- | --- |
| B01 | S2 | Range equity biased low (AA vs KK showed 51–78%) | fixed |
| B02 | S3 | Refreshing Study loses the current spot | fixed |
| B03 | S3 | Action buttons rendered without colour | fixed |

## B01 — Range equity biased low
- Severity: S2 (wrong numbers feed every postflop strategy and the trainer's EV)
- Steps: `rangeEquity(KK range, [], seed)` and read AA's equity, across seeds 1–6.
- Expected: about 0.82. Actual: 0.51–0.78. On a 2c7d9h3s turn it gave 0.913 instead of about 0.955.
- Cause: every runout was weighted equally, but a runout that blocks most of the villain range (a K against KK) is less likely.
- Fix: weight each runout by the villain weight still live on it (`js/engine/equity.js`). Test: U07.

## B02 — Refresh loses the Study spot
- Severity: S3 (workaround: click the line again)
- Steps: build a postflop line, reload. Expected: same spot. Actual: back to UTG.
- Fix: the line is encoded in the URL (`#/study?l=3R2.5_4F_5C_d2c7dKs`), which also makes spots shareable. Test: F02-E1. (The first try used `.` as a separator, which collided with `2.5`. The test caught it.)

## B03 — Coloured buttons had no colour
- Severity: S3
- Cause: `Object.assign(el.style, {'--c': …})` doesn't set custom properties.
- Fix: `style.setProperty` for `--*` keys in `js/ui/dom.js`. Verified by screenshot.

## To check (not reproduced as bugs)
- The info box shows "To call 1bb" for an unopened pot even though limping isn't offered.
- The SB flat-call range vs. an open is narrow and gappy (pairs and suited connectors). It's a heuristic choice, not a crash, but it looks odd.
- No multiway pots: a cold-call or 3-bet folds everyone else. This is by design and documented.
