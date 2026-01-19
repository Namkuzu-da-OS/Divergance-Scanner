"""
Wingman Trading System - Python Backtester
Using Backtrader for strategy validation

Usage:
    python wingman_backtest.py --symbol SPY --period 6mo --strategy vwap
    python wingman_backtest.py --symbol QQQ --period 1y --strategy vwap --optimize
"""

import argparse
import datetime
from typing import Optional
import warnings
warnings.filterwarnings('ignore')

try:
    import backtrader as bt
    import pandas as pd
    import yfinance as yf
    import numpy as np
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("\nInstall required packages:")
    print("  pip install backtrader pandas yfinance numpy matplotlib")
    exit(1)


# ============================================================================
# CUSTOM INDICATORS
# ============================================================================

class VWAP(bt.Indicator):
    """Volume Weighted Average Price"""
    lines = ('vwap',)
    params = (('period', 1),)  # Daily VWAP resets each day

    def __init__(self):
        self.cumvol = bt.indicators.SumN(self.data.volume, period=self.p.period)
        self.cumtp = bt.indicators.SumN(
            (self.data.high + self.data.low + self.data.close) / 3 * self.data.volume,
            period=self.p.period
        )

    def next(self):
        if self.cumvol[0] != 0:
            self.lines.vwap[0] = self.cumtp[0] / self.cumvol[0]
        else:
            self.lines.vwap[0] = self.data.close[0]


# ============================================================================
# WINGMAN VWAP REVERSION STRATEGY
# ============================================================================

class WingmanVWAPStrategy(bt.Strategy):
    """
    VWAP Reversion Strategy with ATR-based stops

    Entry: Price in VWAP zone (1.5-2.5 ATR from VWAP)
    Stop: ATR × VIX Multiplier
    Target: Return to VWAP
    """

    params = (
        ('risk_percent', 1.0),       # Risk per trade (%)
        ('atr_period', 10),          # ATR calculation period
        ('atr_mult', 2.0),           # ATR multiplier for stops
        ('vwap_inner', 1.5),         # Inner band (ATR units)
        ('vwap_outer', 2.5),         # Outer band (ATR units)
        ('rsi_period', 14),          # RSI period
        ('rsi_oversold', 30),        # RSI oversold threshold
        ('rsi_overbought', 70),      # RSI overbought threshold
        ('volume_mult', 1.5),        # Volume spike multiplier
        ('use_rsi_filter', True),    # Require RSI confirmation
        ('use_volume_filter', True), # Require volume confirmation
        ('printlog', True),          # Print trade log
    )

    def __init__(self):
        # ATR for stops and zones
        self.atr = bt.indicators.ATR(self.data, period=self.p.atr_period)

        # Simple VWAP approximation (using SMA of typical price)
        self.typical_price = (self.data.high + self.data.low + self.data.close) / 3
        self.vwap = bt.indicators.SMA(self.typical_price, period=20)

        # RSI
        self.rsi = bt.indicators.RSI(self.data, period=self.p.rsi_period)

        # Volume SMA
        self.vol_sma = bt.indicators.SMA(self.data.volume, period=20)

        # Daily EMA for trend
        self.ema20 = bt.indicators.EMA(self.data.close, period=20)

        # Track orders
        self.order = None
        self.entry_price = None
        self.stop_price = None
        self.target_price = None

        # Performance tracking
        self.trade_count = 0
        self.win_count = 0
        self.loss_count = 0

    def log(self, txt, dt=None):
        if self.p.printlog:
            dt = dt or self.datas[0].datetime.date(0)
            print(f'{dt.isoformat()} {txt}')

    def notify_order(self, order):
        if order.status in [order.Submitted, order.Accepted]:
            return

        if order.status in [order.Completed]:
            if order.isbuy():
                self.log(f'BUY EXECUTED @ {order.executed.price:.2f}')
            else:
                self.log(f'SELL EXECUTED @ {order.executed.price:.2f}')

        elif order.status in [order.Canceled, order.Margin, order.Rejected]:
            self.log('Order Canceled/Margin/Rejected')

        self.order = None

    def notify_trade(self, trade):
        if not trade.isclosed:
            return

        self.trade_count += 1
        if trade.pnl > 0:
            self.win_count += 1
        else:
            self.loss_count += 1

        self.log(f'TRADE P&L: ${trade.pnl:.2f}, Net: ${trade.pnlcomm:.2f}')

    def in_buy_zone(self):
        """Check if price is in buy zone (1.5-2.5 ATR below VWAP)"""
        vwap = self.vwap[0]
        atr = self.atr[0]
        lower_inner = vwap - (atr * self.p.vwap_inner)
        lower_outer = vwap - (atr * self.p.vwap_outer)
        return lower_outer <= self.data.close[0] <= lower_inner

    def in_sell_zone(self):
        """Check if price is in sell zone (1.5-2.5 ATR above VWAP)"""
        vwap = self.vwap[0]
        atr = self.atr[0]
        upper_inner = vwap + (atr * self.p.vwap_inner)
        upper_outer = vwap + (atr * self.p.vwap_outer)
        return upper_inner <= self.data.close[0] <= upper_outer

    def volume_spike(self):
        """Check for volume spike"""
        return self.data.volume[0] > self.vol_sma[0] * self.p.volume_mult

    def calculate_position_size(self, stop_distance):
        """Calculate position size based on risk"""
        risk_amount = self.broker.getvalue() * (self.p.risk_percent / 100)
        if stop_distance > 0:
            return int(risk_amount / stop_distance)
        return 0

    def next(self):
        # Skip if we have an open order
        if self.order:
            return

        # Get current values
        close = self.data.close[0]
        atr = self.atr[0]
        vwap = self.vwap[0]

        # Check if we have a position
        if not self.position:
            # LONG ENTRY
            if self.in_buy_zone():
                # Apply filters
                rsi_ok = not self.p.use_rsi_filter or self.rsi[0] < self.p.rsi_oversold
                vol_ok = not self.p.use_volume_filter or self.volume_spike()

                if rsi_ok and vol_ok:
                    stop_distance = atr * self.p.atr_mult
                    size = self.calculate_position_size(stop_distance)

                    if size > 0:
                        self.stop_price = close - stop_distance
                        self.target_price = vwap
                        self.entry_price = close

                        self.log(f'LONG SIGNAL: Entry={close:.2f}, Stop={self.stop_price:.2f}, Target={self.target_price:.2f}')
                        self.order = self.buy(size=size)

            # SHORT ENTRY
            elif self.in_sell_zone():
                rsi_ok = not self.p.use_rsi_filter or self.rsi[0] > self.p.rsi_overbought
                vol_ok = not self.p.use_volume_filter or self.volume_spike()

                if rsi_ok and vol_ok:
                    stop_distance = atr * self.p.atr_mult
                    size = self.calculate_position_size(stop_distance)

                    if size > 0:
                        self.stop_price = close + stop_distance
                        self.target_price = vwap
                        self.entry_price = close

                        self.log(f'SHORT SIGNAL: Entry={close:.2f}, Stop={self.stop_price:.2f}, Target={self.target_price:.2f}')
                        self.order = self.sell(size=size)

        else:
            # MANAGE POSITION
            if self.position.size > 0:  # Long
                # Check stop
                if close <= self.stop_price:
                    self.log(f'STOP HIT: Closing long @ {close:.2f}')
                    self.order = self.close()
                # Check target
                elif close >= self.target_price:
                    self.log(f'TARGET HIT: Closing long @ {close:.2f}')
                    self.order = self.close()

            elif self.position.size < 0:  # Short
                # Check stop
                if close >= self.stop_price:
                    self.log(f'STOP HIT: Closing short @ {close:.2f}')
                    self.order = self.close()
                # Check target
                elif close <= self.target_price:
                    self.log(f'TARGET HIT: Closing short @ {close:.2f}')
                    self.order = self.close()

    def stop(self):
        """Called at end of backtest"""
        win_rate = (self.win_count / self.trade_count * 100) if self.trade_count > 0 else 0
        self.log(f'=== FINAL RESULTS ===')
        self.log(f'Total Trades: {self.trade_count}')
        self.log(f'Wins: {self.win_count}, Losses: {self.loss_count}')
        self.log(f'Win Rate: {win_rate:.1f}%')
        self.log(f'Final Portfolio Value: ${self.broker.getvalue():.2f}')


# ============================================================================
# DATA FETCHING
# ============================================================================

def fetch_data(symbol: str, period: str = '6mo', interval: str = '5m') -> pd.DataFrame:
    """
    Fetch data from Yahoo Finance

    Args:
        symbol: Stock symbol (e.g., 'SPY', 'QQQ')
        period: Data period ('1mo', '3mo', '6mo', '1y', '2y')
        interval: Data interval ('1m', '5m', '15m', '1h', '1d')

    Returns:
        DataFrame with OHLCV data
    """
    print(f"Fetching {symbol} data ({period}, {interval})...")

    ticker = yf.Ticker(symbol)

    # For intraday data, we're limited to recent periods
    if interval in ['1m', '5m', '15m']:
        # Can only get 60 days of intraday data
        if period in ['1y', '2y']:
            print(f"Warning: Intraday data limited to ~60 days. Using 'max' available.")
            period = 'max'

    df = ticker.history(period=period, interval=interval)

    if df.empty:
        raise ValueError(f"No data returned for {symbol}")

    print(f"Fetched {len(df)} bars from {df.index[0]} to {df.index[-1]}")

    return df


# ============================================================================
# RUN BACKTEST
# ============================================================================

def run_backtest(
    symbol: str = 'SPY',
    period: str = '6mo',
    interval: str = '5m',
    initial_capital: float = 20000,
    risk_percent: float = 1.0,
    atr_mult: float = 2.0,
    optimize: bool = False,
    printlog: bool = True
):
    """
    Run backtest on Wingman strategy

    Args:
        symbol: Stock symbol
        period: Data period
        interval: Data interval
        initial_capital: Starting capital
        risk_percent: Risk per trade (%)
        atr_mult: ATR multiplier for stops
        optimize: Whether to run optimization
        printlog: Print trade log
    """

    # Fetch data
    df = fetch_data(symbol, period, interval)

    # Create cerebro engine
    cerebro = bt.Cerebro()

    # Add data feed
    data = bt.feeds.PandasData(
        dataname=df,
        datetime=None,
        open='Open',
        high='High',
        low='Low',
        close='Close',
        volume='Volume',
        openinterest=-1
    )
    cerebro.adddata(data)

    # Set broker settings
    cerebro.broker.setcash(initial_capital)
    cerebro.broker.setcommission(commission=0.0005)  # 0.05% commission
    cerebro.broker.set_slippage_perc(0.001)  # 0.1% slippage

    if optimize:
        # Optimization mode
        print("\n=== RUNNING OPTIMIZATION ===")
        cerebro.optstrategy(
            WingmanVWAPStrategy,
            atr_mult=[1.5, 2.0, 2.5, 3.0],
            vwap_inner=[1.0, 1.5, 2.0],
            vwap_outer=[2.0, 2.5, 3.0],
            printlog=False
        )
    else:
        # Single run mode
        cerebro.addstrategy(
            WingmanVWAPStrategy,
            risk_percent=risk_percent,
            atr_mult=atr_mult,
            printlog=printlog
        )

    # Add analyzers
    cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name='sharpe')
    cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')
    cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name='trades')
    cerebro.addanalyzer(bt.analyzers.Returns, _name='returns')

    # Run backtest
    print(f"\n=== STARTING BACKTEST: {symbol} ===")
    print(f"Period: {period}, Interval: {interval}")
    print(f"Initial Capital: ${initial_capital:,.2f}")
    print(f"Risk: {risk_percent}%, ATR Mult: {atr_mult}")
    print("=" * 50)

    results = cerebro.run()

    if not optimize:
        strat = results[0]

        # Print analysis
        print("\n" + "=" * 50)
        print("BACKTEST SUMMARY")
        print("=" * 50)

        # Portfolio value
        final_value = cerebro.broker.getvalue()
        profit = final_value - initial_capital
        return_pct = (profit / initial_capital) * 100

        print(f"Final Portfolio Value: ${final_value:,.2f}")
        print(f"Total Profit/Loss: ${profit:,.2f} ({return_pct:+.2f}%)")

        # Trade statistics
        try:
            trades = strat.analyzers.trades.get_analysis()
            total_trades = trades.get('total', {}).get('total', 0)
            won = trades.get('won', {}).get('total', 0)
            lost = trades.get('lost', {}).get('total', 0)

            print(f"\nTrade Statistics:")
            print(f"  Total Trades: {total_trades}")
            print(f"  Winning: {won}")
            print(f"  Losing: {lost}")
            if total_trades > 0:
                print(f"  Win Rate: {(won/total_trades)*100:.1f}%")
        except:
            pass

        # Drawdown
        try:
            dd = strat.analyzers.drawdown.get_analysis()
            max_dd = dd.get('max', {}).get('drawdown', 0)
            print(f"\nMax Drawdown: {max_dd:.2f}%")
        except:
            pass

        # Sharpe ratio
        try:
            sharpe = strat.analyzers.sharpe.get_analysis()
            if sharpe.get('sharperatio'):
                print(f"Sharpe Ratio: {sharpe['sharperatio']:.2f}")
        except:
            pass

        print("=" * 50)

        # Plot results (optional)
        try:
            cerebro.plot(style='candlestick', volume=False)
        except:
            print("\nNote: Could not display plot. Install matplotlib for visualization.")

    else:
        # Optimization results
        print("\n=== OPTIMIZATION RESULTS ===")
        for run in results:
            for strat in run:
                trades = strat.analyzers.trades.get_analysis()
                total = trades.get('total', {}).get('total', 0)
                if total > 0:
                    won = trades.get('won', {}).get('total', 0)
                    win_rate = won / total * 100
                    print(f"ATR: {strat.params.atr_mult}, "
                          f"Inner: {strat.params.vwap_inner}, "
                          f"Outer: {strat.params.vwap_outer}, "
                          f"Trades: {total}, "
                          f"Win Rate: {win_rate:.1f}%")

    return results


# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Wingman Strategy Backtester')
    parser.add_argument('--symbol', type=str, default='SPY', help='Stock symbol (default: SPY)')
    parser.add_argument('--period', type=str, default='6mo', help='Data period (default: 6mo)')
    parser.add_argument('--interval', type=str, default='5m', help='Data interval (default: 5m)')
    parser.add_argument('--capital', type=float, default=20000, help='Initial capital (default: 20000)')
    parser.add_argument('--risk', type=float, default=1.0, help='Risk percent (default: 1.0)')
    parser.add_argument('--atr', type=float, default=2.0, help='ATR multiplier (default: 2.0)')
    parser.add_argument('--optimize', action='store_true', help='Run optimization')
    parser.add_argument('--quiet', action='store_true', help='Suppress trade log')

    args = parser.parse_args()

    run_backtest(
        symbol=args.symbol,
        period=args.period,
        interval=args.interval,
        initial_capital=args.capital,
        risk_percent=args.risk,
        atr_mult=args.atr,
        optimize=args.optimize,
        printlog=not args.quiet
    )
