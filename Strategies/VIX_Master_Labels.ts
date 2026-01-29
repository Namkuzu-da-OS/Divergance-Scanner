# ============================================================================
# VIX MASTER LABELS - Upper Chart Version for SPY/SPX
# ============================================================================
#
# Apply this to your SPY chart to see VIX signals without switching charts.
# Shows labels and buy/sell arrows on price.
#
# Based on backtested strategies from:
# - Larry Connors & Dave Landry (CVR3 - 68% win rate)
# - Larry Connors & Cesar Alvarez ("Short Term Trading Strategies That Work")
# - JPMorgan Research (50% spike signal)
#
# ============================================================================

declare upper;

# ============================================================================
# INPUTS
# ============================================================================

input showCVR3Signal        = yes;
input showStretchSignal     = yes;
input showRSISignal         = yes;
input showBBSignal          = yes;
input showJPMorganSignal    = yes;
input showRegimeLabel       = yes;
input showTermStructure     = yes;
input showCompositeSignal   = yes;

input useTrendFilter        = yes;
input trendMA_length        = 200;
input enableAlerts          = yes;

# ============================================================================
# VIX DATA
# ============================================================================

def vixClose    = close("VIX");
def vixOpen     = open("VIX");
def vixHigh     = high("VIX");
def vixLow      = low("VIX");

# ============================================================================
# SPY DATA
# ============================================================================

def spyClose    = close;
def spyMA200    = Average(close, trendMA_length);
def spyAboveMA  = close > spyMA200;
def trendOK     = if useTrendFilter then spyAboveMA else yes;

# ============================================================================
# STRATEGY 1: CVR3 (68% Win Rate)
# ============================================================================

def cvr3_MA         = Average(vixClose, 10);
def cvr3_pctAbove   = ((vixClose - cvr3_MA) / cvr3_MA) * 100;
def cvr3_pctBelow   = ((cvr3_MA - vixClose) / cvr3_MA) * 100;

def cvr3_BuySignal  = vixLow > cvr3_MA and cvr3_pctAbove >= 10 and trendOK;
def cvr3_SellSignal = vixHigh < cvr3_MA and cvr3_pctBelow >= 10 and vixClose > vixOpen;

# ============================================================================
# STRATEGY 2: VIX STRETCH (58% Win Rate)
# ============================================================================

def stretch_MA      = Average(vixClose, 10);
def stretch_pct     = ((vixClose - stretch_MA) / stretch_MA) * 100;
def isStretched     = stretch_pct >= 5;
def stretchCount    = if isStretched then stretchCount[1] + 1 else 0;
def stretch_BuySignal = stretchCount >= 3 and trendOK;

# ============================================================================
# STRATEGY 3: VIX RSI
# ============================================================================

def vixRSI          = RSI(length = 2, price = vixClose);
def spyRSI          = RSI(length = 2, price = close);
def vixOpenAbove    = vixOpen > vixClose[1];
def rsi_BuySignal   = vixRSI > 90 and vixOpenAbove and spyRSI < 30 and trendOK;

# ============================================================================
# STRATEGY 4: BOLLINGER BAND RE-ENTRY
# ============================================================================

def bb_MA           = Average(vixClose, 20);
def bb_StdDev       = StDev(vixClose, 20);
def bb_Upper        = bb_MA + 2 * bb_StdDev;

def priorAboveBB    = vixClose[1] > bb_Upper[1];
def todayInsideBB   = vixClose <= bb_Upper;
def bb_stretchMet   = vixClose[1] >= 1.20 * bb_MA[1];
def bb_BuySignal    = priorAboveBB and todayInsideBB and bb_stretchMet and trendOK;

# ============================================================================
# STRATEGY 5: JPMORGAN 50% SPIKE
# ============================================================================

def jpm_MA          = Average(vixClose, 20);
def jpm_pctAbove    = ((vixClose - jpm_MA) / jpm_MA) * 100;
def jpm_BuySignal   = jpm_pctAbove >= 50 and trendOK;

# ============================================================================
# TERM STRUCTURE
# ============================================================================

def vix3m           = close("VIX3M");
def termRatio       = if vix3m > 0 then vixClose / vix3m else 0;
def inBackwardation = termRatio > 1;
def steepBackward   = termRatio > 1.10;

# ============================================================================
# REGIME
# ============================================================================

def regime = if vixClose < 12 then 1
             else if vixClose < 20 then 2
             else if vixClose < 30 then 3
             else if vixClose < 40 then 4
             else 5;

# ============================================================================
# COMPOSITE SIGNAL
# ============================================================================

def signalCount = (if cvr3_BuySignal then 1 else 0)
                + (if stretch_BuySignal then 1 else 0)
                + (if rsi_BuySignal then 1 else 0)
                + (if bb_BuySignal then 1 else 0)
                + (if jpm_BuySignal then 1 else 0);

def highConviction  = signalCount >= 2;
def anySignal       = signalCount >= 1;

# ============================================================================
# PLOTS - BUY/SELL ARROWS ON PRICE
# ============================================================================

plot BuyArrow = if highConviction then low * 0.998 else Double.NaN;
BuyArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
BuyArrow.SetDefaultColor(Color.GREEN);
BuyArrow.SetLineWeight(4);

plot SingleBuyArrow = if anySignal and !highConviction then low * 0.999 else Double.NaN;
SingleBuyArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
SingleBuyArrow.SetDefaultColor(Color.YELLOW);
SingleBuyArrow.SetLineWeight(2);

plot SellArrow = if cvr3_SellSignal then high * 1.002 else Double.NaN;
SellArrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
SellArrow.SetDefaultColor(Color.RED);
SellArrow.SetLineWeight(3);

# ============================================================================
# LABELS
# ============================================================================

# VIX Regime
AddLabel(showRegimeLabel,
    "VIX " + Round(vixClose, 1) + " " +
    (if regime == 1 then "COMPLACENT"
     else if regime == 2 then "NORMAL"
     else if regime == 3 then "ELEVATED"
     else if regime == 4 then "FEAR"
     else "CAPITULATION"),
    if regime == 1 then Color.LIGHT_RED
    else if regime == 2 then Color.GRAY
    else if regime == 3 then Color.YELLOW
    else if regime == 4 then Color.GREEN
    else Color.CYAN
);

# Term Structure
AddLabel(showTermStructure and vix3m > 0,
    (if steepBackward then "BACKWARDATION!"
     else if inBackwardation then "Backwardation"
     else "Contango") + " " + Round(termRatio, 2),
    if steepBackward then Color.CYAN
    else if inBackwardation then Color.YELLOW
    else Color.DARK_GRAY
);

# Individual Signal Labels
AddLabel(showCVR3Signal and cvr3_BuySignal, "CVR3 BUY", Color.GREEN);
AddLabel(showCVR3Signal and cvr3_SellSignal, "CVR3 SELL", Color.RED);
AddLabel(showStretchSignal and stretch_BuySignal, "STRETCH BUY (" + stretchCount + "d)", Color.CYAN);
AddLabel(showRSISignal and rsi_BuySignal, "RSI BUY", Color.MAGENTA);
AddLabel(showBBSignal and bb_BuySignal, "BB RE-ENTRY", Color.YELLOW);
AddLabel(showJPMorganSignal and jpm_BuySignal, "JPM 50% SPIKE", Color.VIOLET);

# Composite Signal
AddLabel(showCompositeSignal,
    "SIGNALS " + signalCount + "/5" + (if highConviction then " HIGH CONVICTION" else ""),
    if highConviction then Color.GREEN
    else if anySignal then Color.YELLOW
    else Color.DARK_GRAY
);

# Trend Filter
AddLabel(useTrendFilter,
    "200MA: " + (if spyAboveMA then "OK" else "BELOW"),
    if spyAboveMA then Color.GREEN else Color.RED
);

# ============================================================================
# ALERTS
# ============================================================================

Alert(enableAlerts and highConviction and !highConviction[1],
    "VIX HIGH CONVICTION BUY - " + signalCount + " signals!", Alert.BAR, Sound.Ring);
Alert(enableAlerts and cvr3_BuySignal and !cvr3_BuySignal[1],
    "CVR3 BUY SIGNAL (68% Win Rate)", Alert.BAR, Sound.Chimes);
Alert(enableAlerts and cvr3_SellSignal and !cvr3_SellSignal[1],
    "CVR3 SELL SIGNAL", Alert.BAR, Sound.Bell);

# ============================================================================
# BACKGROUND COLOR (subtle)
# ============================================================================

AssignBackgroundColor(
    if highConviction then CreateColor(0, 30, 0)
    else if cvr3_SellSignal then CreateColor(30, 0, 0)
    else Color.CURRENT
);

# ============================================================================
# END
# ============================================================================
