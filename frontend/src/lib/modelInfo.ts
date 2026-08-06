// Concise "how it works" bullets per strategy, shown behind an info toggle.
export const MODEL_INFO: Record<string, string[]> = {
  sma: [
    "Two moving averages of price: fast (e.g. 10 bars) and slow (e.g. 40).",
    "Long when the fast SMA is above the slow SMA (uptrend); short/flat when below.",
    "Pure trend-follower — the signal is the crossover itself, no threshold.",
    "Strength = how far fast sits above/below slow (%).",
    "Lags by design; whipsaws in sideways markets.",
  ],
  meanrev: [
    "Short-horizon reversal: fade the prior move — long after a down move, short after an up move.",
    "Sized by magnitude: z = the last `lookback`-bar return in standard deviations (vol-window σ).",
    "Only trades when stretched: flat until |z| passes z_enter, so it's NOT in a position every bar.",
    "Target = −clip(z / z_full, −1, +1): a big, unusual move gets a big fade; a small one a small fade.",
    "Reverting back inside the z_enter band closes the trade — that's the natural exit.",
    "The edge is real but tiny per trade; validate out-of-sample (it survives mainly on daily range-bound pairs).",
  ],
  dmi: [
    "Wilder's Directional Movement: +DI / −DI measure up- vs down-pressure from the bar's range.",
    "ADX measures trend strength (direction-agnostic).",
    "Long when +DI > −DI with ADX rising above the floor; short when −DI > +DI.",
    "The ADX floor filters out weak / range-bound markets.",
    "Needs high/low/close — it's built from the bar's range, not just the close.",
  ],
  velcross: [
    "Fast vs slow velocity crossover (same quadratic-slope velocity, two windows).",
    "Ranks by zvel = velocity ÷ recent volatility; sizes positions inverse to volatility.",
    "Long when fast velocity clears the vthr gate and rises above slow velocity.",
    "Reversion toggle flips it — long recent fallers / short recent risers.",
    "This is your momentum_model, ported — the most developed of the set.",
  ],
};
