# /checkpoint Command
Save current session state for context recovery. Run anytime mid-session.

## STEP 0: Establish Current Time (ALWAYS FIRST)

Run `TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S %Z'` to get the current Eastern Time.
Use this exact time for the checkpoint timestamp. NEVER infer time from API timestamps (often UTC) or prior checkpoint files.

## What To Do

Review the current conversation context and write a structured checkpoint to `data/SESSION_STATE.md`.

**Extract from conversation context — do NOT make new API calls.** This is a snapshot of what we already know, not a fresh data pull. The only exception is the `date` command above for accurate time.

## Write Format

Write the file `data/SESSION_STATE.md` using this exact structure:

```markdown
# SESSION STATE CHECKPOINT
**Date:** [YYYY-MM-DD]
**Time:** [HH:MM ET]
**Session:** [Day of week, Full date]

---

## MARKET SNAPSHOT
| Metric | Value |
|--------|-------|
| SPY | $XXX.XX (+X.XX%) |
| QQQ | $XXX.XX (+X.XX%) |
| VIX | XX.XX (Regime) |
| Trend | [SPY trend] |
| Gamma | [SPY positioning vs walls] |
| Verdict | [One line: bullish/bearish/neutral + trading implication] |

## WATCHLIST STATUS
| Ticker | Tier | Price | RSI | Zone | Sector Wind | Conclusion |
|--------|------|-------|-----|------|-------------|------------|
[Every active watchlist name with current analytical conclusion]

## POSITIONS
| Ticker | Dir | Entry | Current | P&L | Status |
[Open positions, or "No open positions" if none]

## KEY CONCLUSIONS THIS SESSION
- [Bullet point each analytical conclusion reached]
- [Include what changed from prior session]
- [Include what was invalidated or confirmed]

## ACTION QUEUE (What to do next)
1. [Highest priority next action]
2. [Second priority]
3. [Third priority]

## SECTOR CONTEXT
**Theme:** [One sentence rotation summary]
**Leading:** [Top 3 sectors with RSI]
**Lagging:** [Bottom 3 sectors with RSI]
**Overbought:** [List any RSI > 70]
**Oversold:** [List any RSI < 30]

## ROTATION REGIME
**Phase:** [early/mid/late/recession or 'unavailable']
**Confidence:** [0-1 or N/A]
**Leading:** [Top RS sectors from divergence scanner]
**Lagging:** [Bottom RS sectors from divergence scanner]
**Active Divergences:** [Any sector pair divergences, or 'None']

## SESSION NOTES
[Any other important context from THIS SESSION's data. NEVER fabricate calendar dates or events — only record what was confirmed by API data, user input, or verified web search.]
```

## After Writing

Confirm the checkpoint with a brief summary:
- Timestamp saved
- Number of watchlist names captured
- Top priority from action queue
- Remind user: "Run `/kungfu` in a new session to auto-restore this checkpoint"

## NEVER FABRICATE (NON-NEGOTIABLE)

Checkpoints capture what we KNOW from this session — API data, user statements, confirmed facts. Never write unconfirmed calendar dates, guessed levels, or pattern-matched assumptions into the checkpoint. If it wasn't confirmed this session, it doesn't go in the file. Future sessions will read this checkpoint as truth.
