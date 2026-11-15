// BTC 24h race bot — violent-breakout rider (bars-replay/v1).
//
// Long-only, no shorts/leverage, deterministic: every decision comes from the
// bar closes and the account state only, never the clock, env or Math.random,
// so the action log is byte-for-byte reproducible.
//
// The idea: on 1-minute cbBTC bars most minutes are noise (1-min return stdev
// ~12 bps) and frequent trading just pays the ~26 bps round-trip cost. The
// only moves big enough to survive that cost are violent upside breakouts, so
// the bot trades nothing else. It waits for a sharp 5-minute surge, rides it
// with a take-profit, a tight hard stop and a trailing stop, then stands down
// for an hour after banking a win so it never chases the same move twice.
//
//   * Entry: the close is >= BURST_BPS above the close BURST_BARS ago.
//     One position at a time, full cash (the replay caps at 100% of equity).
//   * Exit (the whole position, whichever triggers first on a bar's close):
//       - take profit: position worth >= +TAKE_PROFIT_BPS over its cost;
//       - hard stop:   position worth <= -STOP_LOSS_BPS under its cost;
//       - trailing:    close <= the peak close since entry minus TRAIL_BPS.
//   * After a take-profit exit, cool down for COOLDOWN_AFTER_TP_BARS bars
//     before re-entering (a banked move is done; its tail is where the
//     whipsaw losses live). No cooldown after a stop/trailing exit.
//   * Guardrail fallback: if no buy has ever filled by bar 1300 of the
//     1,440-bar window, take one small (10% of cash) position on the next
//     modest >= 40 bps 5-bar up-move, with a tight TP/SL/trailing of its own.
//     It exists only so the entry meets the race's "at least 1 trade" bar on
//     a window with no violent breakout; its worst case costs ~$0.60.
//   * Size: full cash on breakout entries; max_slippage_bps 500 so a fill
//     into a gap is refused rather than filled at a ruinous price.
//
// The closes run in float64 on + - * / alone (IEEE 754, correctly rounded), so
// the same bars give the same orders run after run.

import { runBars, type BarsState, type Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Parameters (verified on two frozen 24h dev windows: the 2026-11-15 08:28
// window of this competition and the 2026-11-13 23:14 window of the
// previous race — see README.md for the numbers).
const BURST_BARS = 5;             // breakout lookback (bars)
const BURST_BPS = 90;             // enter when up >= 90 bps over BURST_BARS
const TAKE_PROFIT_BPS = 250;      // exit once up >= +250 bps from cost
const STOP_LOSS_BPS = 20;         // hard stop at -20 bps from cost
const TRAIL_BPS = 60;             // trailing stop 60 bps below the peak close
const COOLDOWN_AFTER_TP_BARS = 60; // bars to wait after a take-profit exit
const MAX_SLIPPAGE_BPS = 500;
const MIN_NOTIONAL = 1_000_000n;

// Guardrail fallback (see header): small trade late in the window, only if
// the bot has never traded.
const FALLBACK_BAR = 1300;        // first bar index the fallback may fire on
const FALLBACK_BURST_BPS = 40;    // modest up-move that arms the fallback
const FALLBACK_SIZE_NUM = 1;      // size = 1/10 of cash
const FALLBACK_TAKE_PROFIT_BPS = 50;
const FALLBACK_STOP_LOSS_BPS = 30;
const FALLBACK_TRAIL_BPS = 30;

const closes: number[] = [];
let barsSinceExit = 1_000_000;    // starts huge so the first signal is eligible
let lastExitWasTp = false;
let peak: number | null = null;   // peak close since entry (trailing stop)
let filledBuys = 0;               // buy fills seen so far
let fallbackPosition = false;     // the open position is the small fallback one

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    for (const fill of batch.fills) {
      if (fill.side === 'buy' && fill.status === 'filled') filledBuys += 1;
    }

    const closeRaw = state.close(SYMBOL);
    if (closeRaw !== null) closes.push(Number(closeRaw));
    if (state.warmingUp) return []; // warm-up batches: build history, never trade
    if (closeRaw === null) return []; // no bar for the symbol this minute

    const close = Number(closeRaw);

    // Hold a position: check the three exits on this close.
    const pos = state.positions.get(SYMBOL);
    if (pos !== undefined && pos.qty > 0n) {
      if (peak === null || close > peak) peak = close;
      const tp = fallbackPosition ? FALLBACK_TAKE_PROFIT_BPS : TAKE_PROFIT_BPS;
      const sl = fallbackPosition ? FALLBACK_STOP_LOSS_BPS : STOP_LOSS_BPS;
      const trail = fallbackPosition ? FALLBACK_TRAIL_BPS : TRAIL_BPS;
      const value = state.value(SYMBOL, pos.qty);
      let exit = false;
      let wasTp = false;
      if (value * 10000n >= pos.cost * BigInt(10000 + tp)) { exit = true; wasTp = true; }
      else if (value * 10000n <= pos.cost * BigInt(10000 - sl)) exit = true;
      else if (peak !== null && close * 10000.0 <= peak * (10000 - trail)) exit = true;
      if (exit) {
        barsSinceExit = 0;
        lastExitWasTp = wasTp;
        peak = null;
        fallbackPosition = false;
        return [{ side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: count bars since the last exit, then look for a breakout.
    barsSinceExit += 1;
    const cooldown = lastExitWasTp ? COOLDOWN_AFTER_TP_BARS : 0;
    if (barsSinceExit < cooldown) return [];
    if (closes.length < BURST_BARS + 2) return [];

    const base = closes[closes.length - BURST_BARS - 1];
    const burst = ((close - base) * 10000.0) / base; // positive bps = surged

    if (burst >= BURST_BPS) {
      const notional = state.cash;
      if (notional >= MIN_NOTIONAL) {
        peak = close;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Guardrail fallback: late in the window, never traded, modest up-move.
    if (
      filledBuys === 0 &&
      closes.length - 1 >= FALLBACK_BAR &&
      burst >= FALLBACK_BURST_BPS
    ) {
      const notional = (state.cash * BigInt(FALLBACK_SIZE_NUM)) / 10n;
      if (notional >= MIN_NOTIONAL) {
        peak = close;
        fallbackPosition = true;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});
