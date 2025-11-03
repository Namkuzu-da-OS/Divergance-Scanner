# -note Command
Add a timestamped note to the daily trading log with category.

## Usage
`-note [category:] your note text here`
or
`your note text here -note [category:]`

## Categories
- **observation** - Market observation, price action, pattern recognition
- **trade_idea** - Potential trade setup identified
- **emotion** - Emotional state, mindset, psychology
- **lesson** - Learning, mistake analysis, improvement insight

## Examples
```
-note observation: Price rejected at daily resistance 3 times
-note VWAP rejecting at $150, watching for breakdown -note
-note emotion: Feeling FOMO, need to wait for setup -note
Realized I cut winners too early today -note lesson:
```

## Format
Each note will be stored as:
```
[HH:MM] [CATEGORY] - Your note text here
```

## Storage
All notes append to: `data/daily_log.md`

## Dashboard
Notes automatically appear in the Session Notes section (collapsible) on the trading dashboard for easy reference.
