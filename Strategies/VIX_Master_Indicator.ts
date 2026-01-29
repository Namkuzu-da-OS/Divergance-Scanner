# ============================================================================
# VIX MASTER INDICATOR - Comprehensive VIX Trading System for ThinkOrSwim
# ============================================================================
#
# Based on backtested strategies from:
# - Larry Connors & Dave Landry (CVR3 - 68% win rate)
# - Larry Connors & Cesar Alvarez ("Short Term Trading Strategies That Work")
# - JPMorgan Research (50% spike signal)
# - Options Hawk (Rubber Band Reversion)
#
# Sources:
# - https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/cvr3-vix-market-timing
# - https://easycators.com/thinkscript/vix-stretches-trading-strategy-for-the-spy-or-spx-from-short-term-trading-strategies-that-work-by-connors-alvarez/
# - https://quantifiedstrategies.com/vix-trading-strategy/
#
# ============================================================================

declare lower;

# ============================================================================
# INPUTS - Customize Your Settings
# ============================================================================

input showCVR3Signal        = yes;      # CVR3: 68% win rate signal
input showStretchSignal     = yes;      # VIX Stretch: 5% above 10-MA for 3 days
input showRSISignal         = yes;      # VIX RSI(2) > 90 signal
input showBBSignal          = yes;      # Bollinger Band re-entry signal
input showJPMorganSignal    = yes;      # 50% above 20-MA spike
input showTermStructure     = yes;      # VIX/VIX3M ratio
input showRegimeLabel       = yes;      # VIX level regime label
input showPercentileRank    = yes;      # 52-week percentile

# CVR3 Settings (Connors/Landry - 68% win rate)
input cvr3_MAlength         = 10;       # 10-day MA (don't change - backtested)
input cvr3_threshold        = 10.0;     # 10% threshold (don't change - backtested)

# Stretch Settings (Connors/Alvarez)
input stretch_MAlength      = 10;       # 10-day MA
input stretch_threshold     = 5.0;      # 5% above MA
input stretch_days          = 3;        # Consecutive days stretched

# RSI Settings
input rsi_length            = 2;        # RSI(2) - Connors' preferred
input vix_rsi_overbought    = 90;       # VIX RSI threshold
input spy_rsi_oversold      = 30;       # SPY RSI threshold

# Bollinger Band Settings
input bb_length             = 20;
input bb_numDev             = 2.0;
input bb_stretchFilter      = yes;      # Require 20% stretch on breach day
input bb_stretchPct         = 20.0;     # 20% above 20-MA

# Trend Filter
input useTrendFilter        = yes;      # Require SPY > 200 MA
input trendMA_length        = 200;

# Alert Settings
input enableAlerts          = yes;

# ============================================================================
# VIX DATA
# ============================================================================

def vixClose    = close("VIX");
def vixOpen     = open("VIX");
def vixHigh     = high("VIX");
def vixLow      = low("VIX");

# ============================================================================
# SPY DATA (for trend filter and RSI)
# ============================================================================

def spyClose    = close("SPY");
def spyMA200    = Average(spyClose, trendMA_length);
def spyAboveMA  = spyClose > spyMA200;
def trendOK     = if useTrendFilter then spyAboveMA else yes;

# ============================================================================
# STRATEGY 1: CVR3 VIX MARKET TIMING (Connors/Landry - 68% Win Rate)
# ============================================================================
# BUY: VIX low > 10-MA AND close >= 10% above 10-MA
# SELL: VIX high < 10-MA AND close >= 10% below 10-MA AND close > open
# Exit: VIX crosses back through 10-MA

def cvr3_MA         = Average(vixClose, cvr3_MAlength);
def cvr3_pctAbove   = ((vixClose - cvr3_MA) / cvr3_MA) * 100;
def cvr3_pctBelow   = ((cvr3_MA - vixClose) / cvr3_MA) * 100;

# Buy Signal: Entire bar above MA + close 10%+ above MA
def cvr3_buySetup   = vixLow > cvr3_MA and cvr3_pctAbove >= cvr3_threshold;
def cvr3_BuySignal  = cvr3_buySetup and trendOK;

# Sell Signal: Entire bar below MA + close 10%+ below MA + green candle
def cvr3_sellSetup  = vixHigh < cvr3_MA and cvr3_pctBelow >= cvr3_threshold and vixClose > vixOpen;
def cvr3_SellSignal = cvr3_sellSetup;

# ============================================================================
# STRATEGY 2: VIX STRETCH (Connors/Alvarez - 58% Win Rate)
# ============================================================================
# BUY: VIX > 5% above 10-MA for 3+ consecutive days AND SPY > 200 MA

def stretch_MA      = Average(vixClose, stretch_MAlength);
def stretch_pct     = ((vixClose - stretch_MA) / stretch_MA) * 100;
def isStretched     = stretch_pct >= stretch_threshold;

# Count consecutive stretched days
def stretchCount    = if isStretched then stretchCount[1] + 1 else 0;

def stretch_BuySignal = stretchCount >= stretch_days and trendOK;

# ============================================================================
# STRATEGY 3: VIX RSI (Connors/Alvarez)
# ============================================================================
# BUY: VIX RSI(2) > 90 AND VIX opens > prior close AND SPY > 200 MA AND SPY RSI(2) < 30

def vixRSI          = RSI(length = rsi_length, price = vixClose);
def spyRSI          = RSI(length = rsi_length, price = spyClose);
def vixOpenAbove    = vixOpen > vixClose[1];

def rsi_BuySignal   = vixRSI > vix_rsi_overbought
                      and vixOpenAbove
                      and spyRSI < spy_rsi_oversold
                      and trendOK;

# ============================================================================
# STRATEGY 4: BOLLINGER BAND RE-ENTRY (Your Original + Enhancement)
# ============================================================================
# BUY: VIX closed above upper BB yesterday, closes back inside today
# Optional: 20% stretch filter on breach day

def bb_MA           = Average(vixClose, bb_length);
def bb_StdDev       = StDev(vixClose, bb_length);
def bb_Upper        = bb_MA + bb_numDev * bb_StdDev;
def bb_Lower        = bb_MA - bb_numDev * bb_StdDev;

# Yesterday closed above upper band
def priorAboveBB    = vixClose[1] > bb_Upper[1];

# Today closed back inside
def todayInsideBB   = vixClose <= bb_Upper;

# Stretch filter: yesterday's close was 20%+ above yesterday's 20-MA
def bb_stretchMet   = if bb_stretchFilter
                      then (vixClose[1] >= (1 + bb_stretchPct / 100) * bb_MA[1])
                      else yes;

def bb_BuySignal    = priorAboveBB and todayInsideBB and bb_stretchMet and trendOK;

# ============================================================================
# STRATEGY 5: JPMORGAN 50% SPIKE SIGNAL
# ============================================================================
# BUY: VIX > 50% above its 20-day (1-month) MA

def jpm_MA          = Average(vixClose, 20);
def jpm_pctAbove    = ((vixClose - jpm_MA) / jpm_MA) * 100;
def jpm_BuySignal   = jpm_pctAbove >= 50 and trendOK;

# ============================================================================
# VIX TERM STRUCTURE (VIX vs VIX3M)
# ============================================================================
# Ratio > 1 = Backwardation = Fear/Panic (contrarian buy)
# Ratio < 1 = Contango = Normal/Complacent

def vix3m           = close("VIX3M");
def termRatio       = if vix3m > 0 then vixClose / vix3m else 0;
def inBackwardation = termRatio > 1;
def steepBackward   = termRatio > 1.10;  # Steep backwardation (panic)

# ============================================================================
# VIX REGIME CLASSIFICATION
# ============================================================================

def regime = if vixClose < 12 then 1        # Complacent
             else if vixClose < 20 then 2   # Normal
             else if vixClose < 30 then 3   # Elevated
             else if vixClose < 40 then 4   # Fear
             else 5;                        # Capitulation

# ============================================================================
# VIX PERCENTILE RANK (52-week)
# ============================================================================

def vix52High       = Highest(vixClose, 252);
def vix52Low        = Lowest(vixClose, 252);
def vixPctRank      = if (vix52High - vix52Low) > 0
                      then ((vixClose - vix52Low) / (vix52High - vix52Low)) * 100
                      else 50;

# ============================================================================
# COMPOSITE SIGNAL STRENGTH
# ============================================================================
# Count how many strategies are triggering

def signalCount = (if cvr3_BuySignal then 1 else 0)
                + (if stretch_BuySignal then 1 else 0)
                + (if rsi_BuySignal then 1 else 0)
                + (if bb_BuySignal then 1 else 0)
                + (if jpm_BuySignal then 1 else 0);

def highConviction  = signalCount >= 2;
def anySignal       = signalCount >= 1;

# ============================================================================
# PLOTS
# ============================================================================

# VIX with moving averages
plot VIX_Price = vixClose;
VIX_Price.SetDefaultColor(Color.WHITE);
VIX_Price.SetLineWeight(2);

plot MA_10 = cvr3_MA;
MA_10.SetDefaultColor(Color.YELLOW);
MA_10.SetStyle(Curve.SHORT_DASH);

plot MA_20 = bb_MA;
MA_20.SetDefaultColor(Color.CYAN);
MA_20.SetStyle(Curve.SHORT_DASH);

# Bollinger Bands
plot BB_Upper_Plot = bb_Upper;
BB_Upper_Plot.SetDefaultColor(Color.DARK_RED);

plot BB_Lower_Plot = bb_Lower;
BB_Lower_Plot.SetDefaultColor(Color.DARK_GREEN);

# CVR3 Thresholds (10% above/below 10-MA)
plot CVR3_UpperThreshold = cvr3_MA * 1.10;
CVR3_UpperThreshold.SetDefaultColor(Color.ORANGE);
CVR3_UpperThreshold.SetStyle(Curve.LONG_DASH);

plot CVR3_LowerThreshold = cvr3_MA * 0.90;
CVR3_LowerThreshold.SetDefaultColor(Color.LIGHT_GREEN);
CVR3_LowerThreshold.SetStyle(Curve.LONG_DASH);

# Regime Lines
plot Line_12 = 12;
Line_12.SetDefaultColor(Color.DARK_GRAY);
Line_12.SetStyle(Curve.SHORT_DASH);

plot Line_20 = 20;
Line_20.SetDefaultColor(Color.DARK_GRAY);
Line_20.SetStyle(Curve.SHORT_DASH);

plot Line_30 = 30;
Line_30.SetDefaultColor(Color.DARK_GRAY);
Line_30.SetStyle(Curve.SHORT_DASH);

plot Line_40 = 40;
Line_40.SetDefaultColor(Color.DARK_GRAY);
Line_40.SetStyle(Curve.SHORT_DASH);

# Signal Arrows
plot CVR3_Arrow = if showCVR3Signal and cvr3_BuySignal then vixLow * 0.95 else Double.NaN;
CVR3_Arrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
CVR3_Arrow.SetDefaultColor(Color.GREEN);
CVR3_Arrow.SetLineWeight(3);

plot Stretch_Arrow = if showStretchSignal and stretch_BuySignal and !stretch_BuySignal[1] then vixLow * 0.93 else Double.NaN;
Stretch_Arrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
Stretch_Arrow.SetDefaultColor(Color.CYAN);
Stretch_Arrow.SetLineWeight(2);

plot RSI_Arrow = if showRSISignal and rsi_BuySignal then vixLow * 0.91 else Double.NaN;
RSI_Arrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
RSI_Arrow.SetDefaultColor(Color.MAGENTA);
RSI_Arrow.SetLineWeight(2);

plot BB_Arrow = if showBBSignal and bb_BuySignal then vixLow * 0.89 else Double.NaN;
BB_Arrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
BB_Arrow.SetDefaultColor(Color.YELLOW);
BB_Arrow.SetLineWeight(2);

plot JPM_Arrow = if showJPMorganSignal and jpm_BuySignal then vixHigh * 1.05 else Double.NaN;
JPM_Arrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
JPM_Arrow.SetDefaultColor(Color.VIOLET);
JPM_Arrow.SetLineWeight(3);

# Sell Signal
plot CVR3_Sell = if showCVR3Signal and cvr3_SellSignal then vixHigh * 1.02 else Double.NaN;
CVR3_Sell.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
CVR3_Sell.SetDefaultColor(Color.RED);
CVR3_Sell.SetLineWeight(3);

# ============================================================================
# LABELS
# ============================================================================

# VIX Regime Label
AddLabel(showRegimeLabel,
    "VIX: " + Round(vixClose, 2) + " | " +
    (if regime == 1 then "COMPLACENT - Spike probable"
     else if regime == 2 then "NORMAL"
     else if regime == 3 then "ELEVATED - Watch for setups"
     else if regime == 4 then "FEAR - Quality entries"
     else "CAPITULATION - Scale in"),
    if regime == 1 then Color.LIGHT_RED
    else if regime == 2 then Color.GRAY
    else if regime == 3 then Color.YELLOW
    else if regime == 4 then Color.GREEN
    else Color.CYAN
);

# Term Structure Label
AddLabel(showTermStructure and vix3m > 0,
    "Term: " + Round(termRatio, 2) +
    (if steepBackward then " STEEP BACKWARDATION"
     else if inBackwardation then " Backwardation"
     else " Contango"),
    if steepBackward then Color.CYAN
    else if inBackwardation then Color.YELLOW
    else Color.GRAY
);

# Percentile Rank Label
AddLabel(showPercentileRank,
    "52wk Rank: " + Round(vixPctRank, 0) + "%",
    if vixPctRank > 80 then Color.GREEN
    else if vixPctRank < 20 then Color.RED
    else Color.GRAY
);

# CVR3 Signal Status
AddLabel(showCVR3Signal,
    if cvr3_BuySignal then "CVR3: BUY (68% WR)"
    else if cvr3_SellSignal then "CVR3: SELL"
    else if cvr3_pctAbove > 5 then "CVR3: " + Round(cvr3_pctAbove, 1) + "% above MA"
    else "CVR3: -",
    if cvr3_BuySignal then Color.GREEN
    else if cvr3_SellSignal then Color.RED
    else if cvr3_pctAbove > 5 then Color.YELLOW
    else Color.DARK_GRAY
);

# Stretch Signal Status
AddLabel(showStretchSignal,
    if stretch_BuySignal then "STRETCH: BUY (" + stretchCount + " days)"
    else if isStretched then "STRETCH: " + stretchCount + "/" + stretch_days + " days"
    else "STRETCH: -",
    if stretch_BuySignal then Color.CYAN
    else if isStretched then Color.YELLOW
    else Color.DARK_GRAY
);

# RSI Signal Status
AddLabel(showRSISignal,
    "VIX RSI(2): " + Round(vixRSI, 0) +
    (if rsi_BuySignal then " BUY" else ""),
    if rsi_BuySignal then Color.MAGENTA
    else if vixRSI > 80 then Color.YELLOW
    else Color.DARK_GRAY
);

# BB Signal Status
AddLabel(showBBSignal,
    if bb_BuySignal then "BB: RE-ENTRY BUY"
    else if priorAboveBB then "BB: Setup forming"
    else "BB: -",
    if bb_BuySignal then Color.YELLOW
    else if priorAboveBB then Color.ORANGE
    else Color.DARK_GRAY
);

# JPMorgan Signal
AddLabel(showJPMorganSignal,
    if jpm_BuySignal then "JPM: 50%+ SPIKE BUY"
    else if jpm_pctAbove > 30 then "JPM: " + Round(jpm_pctAbove, 0) + "% above MA"
    else "JPM: -",
    if jpm_BuySignal then Color.VIOLET
    else if jpm_pctAbove > 30 then Color.YELLOW
    else Color.DARK_GRAY
);

# Composite Signal Count
AddLabel(yes,
    "SIGNALS: " + signalCount + "/5" + (if highConviction then " HIGH CONVICTION" else ""),
    if highConviction then Color.GREEN
    else if anySignal then Color.YELLOW
    else Color.DARK_GRAY
);

# Trend Filter Status
AddLabel(useTrendFilter,
    "SPY vs 200MA: " + (if spyAboveMA then "ABOVE" else "BELOW"),
    if spyAboveMA then Color.GREEN else Color.RED
);

# ============================================================================
# ALERTS
# ============================================================================

Alert(enableAlerts and cvr3_BuySignal, "CVR3 BUY SIGNAL - 68% Win Rate", Alert.BAR, Sound.Ring);
Alert(enableAlerts and cvr3_SellSignal, "CVR3 SELL SIGNAL", Alert.BAR, Sound.Bell);
Alert(enableAlerts and stretch_BuySignal and !stretch_BuySignal[1], "VIX STRETCH BUY SIGNAL", Alert.BAR, Sound.Chimes);
Alert(enableAlerts and rsi_BuySignal, "VIX RSI BUY SIGNAL", Alert.BAR, Sound.Ding);
Alert(enableAlerts and bb_BuySignal, "VIX BB RE-ENTRY BUY SIGNAL", Alert.BAR, Sound.Ring);
Alert(enableAlerts and jpm_BuySignal and !jpm_BuySignal[1], "JPMORGAN 50% SPIKE BUY SIGNAL", Alert.BAR, Sound.Bell);
Alert(enableAlerts and highConviction and !highConviction[1], "HIGH CONVICTION - Multiple signals!", Alert.BAR, Sound.Ring);

# ============================================================================
# BACKGROUND COLOR
# ============================================================================

AssignBackgroundColor(
    if highConviction then Color.DARK_GREEN
    else if anySignal then CreateColor(0, 50, 0)
    else if cvr3_SellSignal then Color.DARK_RED
    else Color.CURRENT
);

# ============================================================================
# END OF SCRIPT
# ============================================================================
