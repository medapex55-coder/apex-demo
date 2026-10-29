# Architecture: a rebuild of GTO Wizard's Study + Practice core

Personal / learning use, so there are no accounts, payments or server in v1. The app is a static site that runs entirely in the browser. That matches how this repo already works (plain HTML files served by `serve.ps1` and published on GitHub Pages). Node isn't installed on this machine, so the app has no build step.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Vanilla JS ES modules + HTML/CSS, no build | no Node on this machine; zero tooling; same as the rest of the repo |
| styling | one `styles.css` driven by CSS custom-property tokens from replica-design | tokens swap cleanly for a rebrand |
| engine | own JS modules: card/hand evaluator, Monte Carlo equity, strategy generator | proprietary solver data can't be used; this is our own logic |
| database | `localStorage` (versioned JSON), mirroring `schema.sql` | single user, offline, free |
| auth | none in v1 | personal tool. `schema.sql` is ready for Supabase if accounts are added later |
| payments / email / jobs | none | not needed for personal use |
| hosting | local `serve.ps1 -Root gto-clone`, later GitHub Pages | already used for APEX |

## Data model

The tables are mirrored in `localStorage` under the key `gtoc.v1`: `{ settings, sessions[], hands[], drills[] }`. Strategies aren't stored. They are generated deterministically from the node path and board, then memoized in memory.

Access rules: single local user, so there are none in v1. If the SQL is used later on Supabase, it adds row-level security with `user_id = auth.uid()` on every user-owned table. See `schema.sql`.

## Modules (the "API")

| module / function | does | input | output | flow |
| --- | --- | --- | --- | --- |
| `cards.parse/format/deck` | card primitives | `"As"` | `{rank,suit}` | all |
| `evaluator.rank7(cards)` | 7-card hand strength | 5–7 cards | comparable int | F02, F05, F06 |
| `equity.vsRange(hand, board, range, n)` | Monte Carlo equity | combo, board, weighted range | 0..1 | F02, F04, S08 |
| `tree.nodeAt(path)` | game state for an action line | `[{pos,act,size}]` | pot, toCall, active, legal actions, street | F01, F02, F05 |
| `strategy.preflop(node)` | per-hand action freqs for 169 classes | node | `{hand: {action: freq}}` | F01, F05 |
| `strategy.postflop(node, board, range)` | heuristic strategy from hand class + equity | node, board, range | per-combo freqs + EV estimate | F02, F06 |
| `range.after(path)` | the active player's range reaching a node | path | weights per combo | F02, F04 |
| `trainer.deal(config)` | sample a spot + hero hand | drill config | hand state | F05, F06 |
| `trainer.grade(freqs, evs, chosen)` | best/correct/inaccuracy/wrong/blunder + EV loss | node strategy, choice | grade | F05 |
| `store.load/save` | persistence | — | state | F07 |

There are no webhooks and no background jobs.

## The parts that bite

- **Strategy consistency:** the range reaching each node must be the previous node's range × frequency of the action taken. Compute it that way, never independently.
- **Performance:** Monte Carlo over 1,326 combos on every hover is too slow. Precompute per node with low sample counts (≈200 runouts per hand class), cache by path and board, and yield to the UI.
- **Determinism:** seed the random number generator by path and board, so the same spot always shows the same strategy and the trainer agrees with Study.
- **Card removal:** board cards block combos (shown as black cells), and hero cards block opponent combos in the trainer.
- **Storage limits:** `localStorage` holds about 5 MB. Cap stored hands at the last 2,000.

## Build order

1. **Vertical slice:** S01 shell, S02 preflop strategy grid with action sequence, actions table and hand detail (tree, strategy.preflop). Covers F01.
2. **Must-haves:** S04 board picker and postflop strategy (evaluator, equity, strategy.postflop) for F02 and F03; S10–S12 trainer in Spot mode with grading and score for F05.
3. **Should-haves:** S05 Ranges tab, metric switch EV/EQ, S08 summary table, Full Hand mode, RNG, timebank, S15–S16 stats and sessions, hotkeys, units toggle.
4. **Could-haves:** breakdown, equity graph, copy range, themes, replayer.
5. **Fixes** from replica-entrepreneur.
