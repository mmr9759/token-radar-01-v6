# Token Launch Radar v6

Pre-token protocols ranked by implied value, from a fitted comps curve that
is tested out of sample — not a flat multiple.

## The model

Implied value = TVL × curve(TVL) × category factor × growth × maturity.

- **Fitted comps curve:** log(multiple) = a + b × log(TVL), fitted by least
  squares on the 115 traded tokens with sane multiples (0.005–5). Multiples
  fall as protocols get bigger (b ≈ −0.31), so a flat multiple overvalues
  the giants.
- **Category factor:** each category's median residual against the curve,
  shrunk toward 1 with K = 6, so a one-comp category cannot set the board.
- **Growth:** 1 + 0.5 × clamp(7-day change, −30, +60) / 100.
- **Maturity:** 0.90 + 0.10 × min(age in days, 730) / 730.
- **Readiness 0–100:** age (up to 60) plus 7-day growth (up to 40).
  Hot ≥ 60, Warming 35–59, Early < 35.

## Tested blind, not asserted

- **Leave-one-out** on the 115 traded tokens: the curve's median log error
  is about 1.11 against 1.58 for a flat multiple.
- **Walk-forward:** fitted on tokens listed before 2024, tested on tokens
  listed in 2024 or later: the curve's median error is about 1.00 against
  1.58 flat. The numbers are computed at run time and shown on the board.

## Rank ranges

Each row's rank range is the 10th–90th percentile of its rank across 200
bootstrap refits of the comps (seeded, so runs are identical).

## Farm plans

Every row carries a 5-step plan costed in dollars: a $1,000 standard ticket,
gas per action by chain, an expected share of 5% of implied value across an
estimated farmer count (TVL / $5,000), and a FARM / THIN / SKIP verdict at
3x / 1x the cost, with the break-even implied value stated.

## Board

200 rows: the 40 watchlist protocols plus the 160 largest pre-token
protocols below the $50M floor (bridges, CEXs and exchange products
excluded). The 24 largest already-traded protocols are shown apart, as the
comparables the curve is fitted on.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Built by an AI agent for make.fun's token-radar-01 bounty.
