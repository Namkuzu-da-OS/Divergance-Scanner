# RULES

## CORE RULES (Non-negotiable)

| # | Rule | Definition | Threshold |
|---|------|------------|-----------|
| 1 | HTF Context | Scalps must be within 1 ATR of a Daily/Weekly level | PDH/PDL, Weekly Open, VWAP, gamma wall |
| 2 | Max Risk | Position size = $risk / (entry - stop) | 1% of account per trade |
| 3 | Daily Stop | Realized losses trigger stop | -$500 = stop for day |
| 4 | Weekly Stop | Realized losses trigger stop | -$1,000 = stop for week, return at 0.5% risk |
| 5 | Primary Target | 127% Fib extension of entry-to-swing | Entry $100, swing high $102 = target $102.54 |

## SUPPORTING RULES

| # | Rule | Definition |
|---|------|------------|
| S-1 | Stop First | Stop set BEFORE entry. Never widened after entry. |
| S-2 | Volume Confirm | Entry requires volume > 1.5x 20-bar average |
| S-3 | Avoid Open/Close | No trading first 15 min or last 15 min |
| S-4 | No Revenge | After loss, wait 3 bars before next entry |
| S-5 | Pre-Trade Plan | Document: Entry, Stop, Target, Size, Why |
| S-6 | News Blackout | No trades 24h before/after: FOMC, CPI, NFP, earnings |

## POSITION SIZING

| Type | ATR Period | Stop Calculation | Example |
|------|------------|------------------|---------|
| Scalp | 10-period on 5/15min | Entry - (ATR x 1.5) | Entry $100, ATR $0.40, Stop $99.40, Size = Risk/$0.60 |
| Swing | 20-period on Daily | Entry - (ATR x 2.0) | Entry $100, ATR $2.00, Stop $96.00, Size = Risk/$4.00 |

## LOSS ESCALATION

| Threshold | Action |
|-----------|--------|
| -$400 daily | Warning - reduce size, slow down |
| -$500 daily | STOP for day |
| -$750 weekly | Warning |
| -$1,000 weekly | STOP for week |
| -10% account | Review required, reduce to 0.5% risk |
| -20% account | Stop 1 week, return at 0.25% risk |

## ACCOUNT PARAMETERS

| Parameter | Value | Notes |
|-----------|-------|-------|
| Account Size | $20,000 | Updates in ACTIVE_SESSION.md |
| Standard Risk | $200 (1%) | Scales with account |
| Reduced Risk | $100 (0.5%) | After -$1,000 weekly or -10% account |
| Emergency Risk | $50 (0.25%) | After -20% account |

## ENFORCEMENT TRIGGERS

When validating a trade, REJECT if:
- Scalp entry is NOT within 1 ATR of HTF level
- Risk exceeds current risk allowance
- Daily/weekly loss limits already hit
- Volume < 1.5x average on entry bar
- No documented stop price
- Within 24h of FOMC/CPI/NFP/earnings
