# Components

Icons: inline SVG drawn for this project (no third-party icon files). Font: Inter, falling back to the system font. All copy is written fresh.
Contrast: `powershell -File replica/design/contrast.ps1 -Path replica/design/tokens.json` (Python isn't available here; this is a port of contrast.py). Result: 0 failures.

```
TopNav
  parts     logo mark, nav tabs (Study, Practice, Stats), settings button
  states    tab active (accent underline), hover, focus-visible ring
  tokens    bg surface, border-bottom border, height 52
  a11y      <nav>, tabs are links with aria-current
  used on   S01

ActionSequence (line strip)
  parts     one chip per decision: position label + action taken; the next actor's chip lists the legal actions
  variants  past (muted), current (outlined accent), street divider with board cards
  states    hover, focus, clicking a past chip rewinds the tree
  tokens    surface-2, radius md, text xs/600
  a11y      buttons; keyboard ←/→ to step back/forward
  used on   S02, S05

RangeGrid 13×13
  cell      label (e.g. "AKs"), background = horizontal stacked bars of action frequencies in act-* colours
  variants  strategy, ev heat, equity heat, mini (trainer)
  states    hover (outline text), selected (outline accent), dimmed (opacity .2, filtered out), empty (cell-empty, not in range)
  tokens    gap 2, radius sm, text xs
  a11y      role=grid, each cell a button with aria-label "AKs: raise 80%, fold 20%"; arrow-key navigation
  used on   S02, S05, S13

ActionsTable
  row       colour swatch, action label + size, overall frequency %, combos
  states    hover, selected (filters grid), disabled
  used on   S02

HandDetail
  shows     hovered or pinned hand class: per-combo rows (suits) with a stacked frequency bar, EV and EQ
  states    empty ("Hover a hand"), hovered, pinned
  used on   S02

InfoBox
  shows     pot, amount to call, pot odds, SPR, active player, board
  used on   S02, S11

CategoryFilter
  rows      made-hand / draw categories with a share bar
  states    active, inactive; Clear button
  used on   S02

CardPicker
  layout    4 suit rows × 13 ranks; Random button; Clear button
  states    available, selected, used elsewhere (disabled)
  a11y      dialog with focus trap, Esc closes
  used on   S04

PlayingCard
  sizes     sm 22×30, md 36×50, lg 56×78; face down
  tokens    four-colour deck: ♠ near-black, ♥ red, ♦ blue, ♣ green on light card
  used on   S04, S11

PokerTable + Seat
  layout    oval felt, 6 seats, pot in centre, board row, dealer button
  seat      position label, stack, bet chip, state: acting (accent ring), folded (opacity .4), hero (bottom)
  used on   S11

ActionBar
  buttons   one per legal action, coloured by action role; hotkeys F / C / R / 1-4
  variants  simple (fold / check-call / bet-raise), standard (each size)
  states    enabled, disabled (not hero's turn)
  used on   S11

FeedbackCard
  grades    best (success), correct (success muted), inaccuracy (warning), wrong (danger), blunder (danger, bold)
  shows     grade, your action vs. strategy frequencies (FrequencyBar), EV loss in bb
  used on   S12

FrequencyBar   horizontal stacked bar of action frequencies with legend (S02, S12)
StatTile       label + big number + delta (S14, S15)
DataTable      sortable headers (aria-sort), zebra-free, row hover (S08, S15, S16)
Tabs           underline style, hotkeys 1–4 (S02)
Modal / Drawer overlay rgba(0,0,0,.6), radius lg, shadow pop, Esc closes, focus trap (S03, S04, S09)
Toggle / Select / Segmented  border-input outline, focus ring 2px accent (S09, S10)
Toast          bottom-centre, auto-dismiss 2.5s (copy range, saved)
```
