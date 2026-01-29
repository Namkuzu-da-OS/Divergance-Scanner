# STRATEGY #1: Smart Money Dip Buy

**Pattern Name:** The TSLA Trigger
**Discovery Date:** January 9, 2026
**Based On:** TSLA Jan 7-9, 2026 trade
**Validation:** Decades of trading experience confirms this pattern

---

## The Signal

When these THREE signals appear together, smart money is buying the dip:

| # | Signal | Threshold | Why It Matters |
|---|--------|-----------|----------------|
| 1 | RSI Oversold | <= 30 | Price stretched, reversion likely |
| 2 | Unusual CALL Activity | >= 5x vol/OI | Big money positioning for upside |
| 3 | At Put Wall Support | Price at put wall | Gamma support, dealers must buy |

**All three required.** This is not optional - the confluence is what makes it work.

---

## Confirmation Signals (Nice to Have)

These strengthen conviction but aren't required:

- At lower Bollinger Band (technical oversold confirmation)
- Trending on X (attention = potential catalyst)
- Aligned with SPY direction (market tailwind)
- Author consensus bullish (crowd wisdom)

---

## The Historical Example: TSLA Jan 7-9, 2026

### Score Progression
```
Jan 7 15:05  Score 60   Technical only (BB lower, put wall)
Jan 7 21:33  Score 95   +35 VELOCITY SPIKE (RSI 28 + unusual CALL 13.5x)
Jan 8 06:21  Score 100  Author consensus confirms
```

### The Trigger Alert (Score 95)
```
TSLA BULLISH
Confluence Score: 95/100
Price: $431.41

Signals:
- RSI oversold (28.0)           <- CORE
- At put wall support ($430)    <- CORE
- Unusual CALL activity (13.5x) <- CORE
- At lower Bollinger Band       <- Confirmation
- Trending on X (8 mentions)    <- Confirmation
- Aligned with SPY bullish      <- Confirmation

Key Levels:
- Put Wall: $430 (support)
- Call Wall: $440 (target)
```

### Outcome
- Entry zone: $431
- Target hit: $443+ (call wall approach)
- Move: +2.8% in ~24 hours
- Result: WIN

---

## Why This Works

1. **RSI Oversold** = Price stretched beyond normal, rubber band ready to snap back
2. **Unusual CALL Activity** = Someone with size is betting on upside NOW
3. **Put Wall Support** = Gamma mechanics force dealers to buy, creating floor

The combination tells you: price is cheap, smart money knows it, and there's mechanical support below.

---

## How Bloodhound Detects It

After collecting all signals for a symbol, check for the trigger:

```javascript
// Check for Smart Money Dip Buy trigger
const hasRsiOversold = signals.some(s => s.includes('RSI oversold'));
const hasUnusualCall = signals.some(s => s.includes('Unusual CALL'));
const hasAtPutWall = signals.some(s => s.includes('put wall support'));

if (hasRsiOversold && hasUnusualCall && hasAtPutWall) {
    signals.unshift('🎯 TRIGGER: Smart Money Dip Buy');
}
```

This adds the trigger line at the TOP of the signals list when all three core signals are present.

---

## Trading the Signal

| Component | Specification |
|-----------|---------------|
| Entry | After trigger appears, on confirmation candle |
| Stop | Below put wall - 1 ATR |
| Target 1 | Gamma flip level (50% position) |
| Target 2 | Call wall (remaining position) |
| Timeframe | 1-3 days typical |

---

## What This Is NOT

- NOT a signal to buy immediately without looking
- NOT valid if VIX > 25 (elevated fear changes dynamics)
- NOT valid against SPY trend (don't fight the market)
- NOT a guarantee - it's a high-probability setup

The human makes the final call. Bloodhound finds the opportunity.

---

## Future Enhancements (Planned)

- Per-ticker baselines for "unusual" activity (13.5x might be normal for some, rare for others)
- Velocity tracking specific to each symbol's personality
- Historical win rate tracking for this pattern

---

**This is Strategy #1 of many. The toolbox will grow.**
