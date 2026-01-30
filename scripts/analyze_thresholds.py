"""
Threshold Analysis Script
Analyzes historical data to determine optimal alert thresholds
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
import numpy as np
from collections import defaultdict

from backend.services.data_client import get_data_client
from backend.core.symbols import DIVERGENCE_PAIRS, ALL_SYMBOLS
from modules.intermarket_divergence import (
    calculate_rolling_correlation,
    calculate_relative_strength,
    detect_correlation_breakdown,
    detect_rs_shift,
    calculate_returns
)


async def analyze_all_pairs():
    """Analyze all pairs and compute statistics"""
    client = get_data_client()

    print("=" * 60)
    print("DIVERGENCE THRESHOLD ANALYSIS")
    print("=" * 60)

    # Fetch 6 months of history for all symbols
    symbols_needed = set()
    for a, b in DIVERGENCE_PAIRS:
        symbols_needed.add(a)
        symbols_needed.add(b)

    print(f"\nFetching 6 months of data for {len(symbols_needed)} symbols...")
    history = await client.get_batch_history(
        list(symbols_needed),
        period_type="month",
        period=6,
        frequency_type="daily",
        frequency=1
    )

    # Convert to numpy arrays
    price_data = {}
    for symbol, candles in history.items():
        if candles:
            prices = np.array([c.get("close", 0) for c in candles])
            if len(prices) > 0:
                price_data[symbol] = prices

    print(f"Got data for {len(price_data)} symbols")
    print(f"Data length: {len(list(price_data.values())[0])} days")

    # Analyze each pair
    results = []
    all_zscores = []
    all_correlations = []
    rs_directions = defaultdict(int)

    print("\n" + "-" * 60)
    print("PAIR-BY-PAIR ANALYSIS")
    print("-" * 60)

    for symbol_a, symbol_b in DIVERGENCE_PAIRS:
        if symbol_a not in price_data or symbol_b not in price_data:
            print(f"  {symbol_a}/{symbol_b}: Missing data")
            continue

        prices_a = price_data[symbol_a]
        prices_b = price_data[symbol_b]

        # Align arrays
        min_len = min(len(prices_a), len(prices_b))
        prices_a = prices_a[-min_len:]
        prices_b = prices_b[-min_len:]

        # Calculate correlation series
        corr_series = calculate_rolling_correlation(prices_a, prices_b, window=20)
        valid_corr = corr_series[~np.isnan(corr_series)]

        if len(valid_corr) < 60:
            print(f"  {symbol_a}/{symbol_b}: Insufficient correlation data ({len(valid_corr)} points)")
            continue

        # Detect breakdown
        is_breakdown, curr_corr, base_corr, zscore = detect_correlation_breakdown(corr_series)

        # RS analysis
        rs_series = calculate_relative_strength(prices_a, prices_b)
        rs_direction, curr_rs, rs_ma = detect_rs_shift(rs_series)

        # Collect stats
        all_zscores.append(zscore)
        all_correlations.append(curr_corr)
        rs_directions[rs_direction] += 1

        # Compute correlation volatility
        corr_std = np.std(valid_corr)
        corr_range = np.max(valid_corr) - np.min(valid_corr)

        results.append({
            'pair': f"{symbol_a}/{symbol_b}",
            'curr_corr': curr_corr,
            'base_corr': base_corr,
            'zscore': zscore,
            'corr_std': corr_std,
            'corr_range': corr_range,
            'rs_direction': rs_direction,
            'is_breakdown': is_breakdown,
        })

        # Print pair details
        breakdown_flag = "***" if is_breakdown else ""
        print(f"  {symbol_a:4}/{symbol_b:4}: z={zscore:+6.2f}  corr={curr_corr:+.3f}  "
              f"base={base_corr:+.3f}  std={corr_std:.3f}  rs={rs_direction:12} {breakdown_flag}")

    # Overall statistics
    print("\n" + "=" * 60)
    print("AGGREGATE STATISTICS")
    print("=" * 60)

    zscores_arr = np.array(all_zscores)
    corr_arr = np.array(all_correlations)

    print(f"\nZ-Score Distribution (n={len(zscores_arr)}):")
    print(f"  Mean:    {np.mean(zscores_arr):+.2f}")
    print(f"  Std:     {np.std(zscores_arr):.2f}")
    print(f"  Min:     {np.min(zscores_arr):+.2f}")
    print(f"  Max:     {np.max(zscores_arr):+.2f}")
    print(f"  Median:  {np.median(zscores_arr):+.2f}")

    print(f"\nCorrelation Distribution:")
    print(f"  Mean:    {np.mean(corr_arr):+.3f}")
    print(f"  Std:     {np.std(corr_arr):.3f}")
    print(f"  Range:   {np.min(corr_arr):+.3f} to {np.max(corr_arr):+.3f}")

    print(f"\nRS Direction Distribution:")
    for direction, count in rs_directions.items():
        print(f"  {direction:15}: {count} pairs ({100*count/len(results):.0f}%)")

    # Threshold analysis
    print("\n" + "=" * 60)
    print("THRESHOLD SENSITIVITY ANALYSIS")
    print("=" * 60)

    thresholds = [1.5, 2.0, 2.5, 3.0, 3.5]

    print("\nZ-Score Threshold Impact (correlation breakdown detection):")
    print("-" * 50)
    for thresh in thresholds:
        count = np.sum(np.abs(zscores_arr) >= thresh)
        pct = 100 * count / len(zscores_arr)
        pairs_list = [r['pair'] for r in results if abs(r['zscore']) >= thresh]
        print(f"  |z| >= {thresh}: {count:2} pairs ({pct:4.0f}%) - {', '.join(pairs_list) if pairs_list else 'none'}")

    # Combined threshold analysis (current "high" confidence logic)
    print("\nCombined Threshold Impact (z-score AND rs_direction != neutral):")
    print("-" * 50)
    for thresh in thresholds:
        count = sum(1 for r in results if abs(r['zscore']) >= thresh and r['rs_direction'] != 'neutral')
        pct = 100 * count / len(results)
        pairs_list = [r['pair'] for r in results if abs(r['zscore']) >= thresh and r['rs_direction'] != 'neutral']
        print(f"  |z| >= {thresh} AND rs_shift: {count:2} pairs ({pct:4.0f}%) - {', '.join(pairs_list) if pairs_list else 'none'}")

    # Alternative: OR logic
    print("\nAlternative: z-score OR rs_direction != neutral:")
    print("-" * 50)
    for thresh in thresholds:
        count = sum(1 for r in results if abs(r['zscore']) >= thresh or r['rs_direction'] != 'neutral')
        pct = 100 * count / len(results)
        print(f"  |z| >= {thresh} OR rs_shift: {count:2} pairs ({pct:4.0f}%)")

    # Recommendation
    print("\n" + "=" * 60)
    print("RECOMMENDATIONS")
    print("=" * 60)

    # Find pairs that would trigger at different levels
    high_z = [r for r in results if abs(r['zscore']) >= 2.5]
    medium_z = [r for r in results if 2.0 <= abs(r['zscore']) < 2.5]
    rs_shift_only = [r for r in results if r['rs_direction'] != 'neutral' and abs(r['zscore']) < 2.0]

    print(f"\nCurrent state:")
    print(f"  High z-score (|z|>=2.5): {len(high_z)} pairs")
    for r in high_z:
        print(f"    - {r['pair']}: z={r['zscore']:+.2f}, rs={r['rs_direction']}")

    print(f"\n  Medium z-score (2.0<=|z|<2.5): {len(medium_z)} pairs")
    for r in medium_z:
        print(f"    - {r['pair']}: z={r['zscore']:+.2f}, rs={r['rs_direction']}")

    print(f"\n  RS shift only (|z|<2.0): {len(rs_shift_only)} pairs")
    for r in rs_shift_only:
        print(f"    - {r['pair']}: z={r['zscore']:+.2f}, rs={r['rs_direction']}")

    print("\n" + "-" * 60)
    print("SUGGESTED ALERT TIERS:")
    print("-" * 60)
    print("""
  CRITICAL (immediate attention):
    - |z-score| >= 2.5 (significant correlation breakdown)

  WARNING (notable divergence):
    - |z-score| >= 2.0 OR
    - RS direction shift (strengthening/weakening)

  INFO (monitoring):
    - Any detected divergence
""")

    return results


if __name__ == "__main__":
    asyncio.run(analyze_all_pairs())
