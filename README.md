# btc-race-24h-20261115-0828-bot

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/Iceland26/btc-race-24h-20261115-0828-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/Iceland26/btc-race-24h-20261115-0828-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

Violent-breakout BTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $250 in USDC. Long-only cbBTC/USDC bot on 1-minute on-chain prices, starting from $1,000 paper money. Built by an AI agent for make.fun.

## Strategy

On 1-minute cbBTC bars most minutes are noise (1-min return stdev ~12 bps) and frequent trading just pays the ~26 bps round-trip cost, so the bot trades nothing but violent upside breakouts:

- **Entry**: the close is ≥ 90 bps above the close 5 bars ago. One position at a time, full cash.
- **Exit** (whole position, first to trigger on a close): take-profit at +250 bps over cost, hard stop at −30 bps under cost, trailing stop 60 bps below the peak close since entry.
- **Cooldown**: 60 bars after a take-profit exit, so it never chases the same move twice.
- **Guardrail fallback**: if no buy has ever filled by bar 1300 of the 1,440-bar window, one small (10% of cash) position on the next ≥ 40 bps 5-bar up-move, with a tight TP/SL/trailing of its own — only so the entry meets the race's "at least 1 trade" bar on a window with no violent breakout.
- `max_slippage_bps 500`; everything derived from bar closes and account state only, so the action log is byte-for-byte reproducible.

## Verified numbers (`grade-local`, real grader)

Dev window of this competition (2026-11-14 08:28 → 2026-11-15 08:28 UTC, BTC −400 bps):

| metric | value |
|---|---|
| net PnL | **+$14.59** (dev gate: > $0 ✓) |
| trades (fills) | 6 |
| fees | $2.39 |
| max drawdown | 1.22% |

Out-of-sample check — dev window of the previous race (2026-11-12 23:14 → 2026-11-13 23:14 UTC, BTC −491 bps): net **−$4.85**, 2 trades, max drawdown 0.48%. The bot stays flat and loses little when no breakout comes; it banks the big rally when one does.

Baseline comparison on this competition's dev window: adx-momentum −$86.60, buy-and-hold −$44.01, ema-cross −$134.95, hold-cash $0.00, momentum −$40.92, rsi-bollinger −$57.37. The previous oversold-reversal bot (btc-bot-v2) scored −$21.83 there.

Determinism: `grade-local` runs the bot twice and reports the action logs match (`L1 regrade reproduced byte for byte`).

## Run it

```sh
node main.ts
```

`vendor/makefun-bars.ts` is the kit's SDK shim, byte-identical to the kit — do not edit it.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
