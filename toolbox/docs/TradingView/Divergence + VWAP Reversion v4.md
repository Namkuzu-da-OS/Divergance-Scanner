// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
// © LonesomeTheBlue (Divergence Original), Enhanced with VWAP Reversion Integration
// WINGMAN MODIFICATION: Added VWAP + ATR bands for scalp trade entry confirmation

//@version=4
study("Divergence + VWAP Reversion v4", overlay = true, max_bars_back = 1000, max_lines_count = 400, max_labels_count = 400)

// ==================== ORIGINAL DIVERGENCE INPUTS ====================
prd = input(defval = 5, title = "Pivot Period", minval = 1, maxval = 50)
source = input(defval = "Close", title = "Source for Pivot Points", options = ["Close", "High/Low"])
searchdiv = input(defval = "Regular", title = "Divergence Type", options = ["Regular", "Hidden", "Regular/Hidden"])
showindis = input(defval = "Full", title = "Show Indicator Names", options = ["Full", "First Letter", "Don't Show"])
showlimit = input(1, title="Minimum Number of Divergence", minval = 1, maxval = 11)
maxpp = input(defval = 10, title = "Maximum Pivot Points to Check", minval = 1, maxval = 20)
maxbars = input(defval = 100, title = "Maximum Bars to Check", minval = 30, maxval = 200)
shownum = input(defval = true, title = "Show Divergence Number")
showlast = input(defval = false, title = "Show Only Last Divergence")
dontconfirm = input(defval = false, title = "Don't Wait for Confirmation")
showlines = input(defval = true, title = "Show Divergence Lines")
showpivot = input(defval = false, title = "Show Pivot Points")

// Indicator selections
calcmacd = input(defval = true, title = "MACD")
calcmacda = input(defval = true, title = "MACD Histogram")
calcrsi = input(defval = true, title = "RSI")
calcstoc = input(defval = true, title = "Stochastic")
calccci = input(defval = true, title = "CCI")
calcmom = input(defval = true, title = "Momentum")
calcobv = input(defval = true, title = "OBV")
calcvwmacd = input(true, title = "VWmacd")
calccmf = input(true, title = "Chaikin Money Flow")
calcmfi = input(true, title = "Money Flow Index")
calcext = input(false, title = "Check External Indicator")
externalindi = input(defval = close, title = "External Indicator")

// Colors
pos_reg_div_col = input(defval = color.yellow, title = "Positive Regular Divergence")
neg_reg_div_col = input(defval = color.navy, title = "Negative Regular Divergence")
pos_hid_div_col = input(defval = color.lime, title = "Positive Hidden Divergence")
neg_hid_div_col = input(defval = color.red, title = "Negative Hidden Divergence")
pos_div_text_col = input(defval = color.black, title = "Positive Divergence Text Color")
neg_div_text_col = input(defval = color.white, title = "Negative Divergence Text Color")
reg_div_l_style_ = input(defval = "Solid", title = "Regular Divergence Line Style", options = ["Solid", "Dashed", "Dotted"])
hid_div_l_style_ = input(defval = "Dashed", title = "Hidden Divergence Line Style", options = ["Solid", "Dashed", "Dotted"])
reg_div_l_width = input(defval = 2, title = "Regular Divergence Line Width", minval = 1, maxval = 5)
hid_div_l_width = input(defval = 1, title = "Hidden Divergence Line Width", minval = 1, maxval = 5)

// ==================== VWAP REVERSION INPUTS ====================
showvwap = input(defval = true, title = "Show VWAP Reversion Levels", group = "VWAP Reversion Setup")
vwap_source = input(defval = "Daily", title = "VWAP Period", options = ["Daily", "Session"], group = "VWAP Reversion Setup")
atr_mult_lower = input(defval = 1.5, title = "ATR Multiplier (Lower Band)", minval = 0.5, maxval = 3.0, step = 0.1, group = "VWAP Reversion Setup")
atr_mult_upper = input(defval = 2.5, title = "ATR Multiplier (Upper Band)", minval = 0.5, maxval = 3.0, step = 0.1, group = "VWAP Reversion Setup")
atr_period = input(defval = 10, title = "ATR Period (10 for scalps)", minval = 5, maxval = 50, group = "VWAP Reversion Setup")
show_entry_zone = input(defval = true, title = "Highlight Entry Zone", group = "VWAP Reversion Setup")

// VWAP Reversion colors
vwap_line_col = input(defval = color.new(color.blue, 0), title = "VWAP Line Color", group = "VWAP Reversion Setup")
entry_zone_col = input(defval = color.new(color.green, 80), title = "Entry Zone Color", group = "VWAP Reversion Setup")
reversion_target_col = input(defval = color.new(color.purple, 80), title = "Reversion Target Zone", group = "VWAP Reversion Setup")

// Set line styles
var reg_div_l_style = reg_div_l_style_ == "Solid" ? line.style_solid :
                       reg_div_l_style_ == "Dashed" ? line.style_dashed :
                       line.style_dotted
var hid_div_l_style = hid_div_l_style_ == "Solid" ? line.style_solid :
                       hid_div_l_style_ == "Dashed" ? line.style_dashed :
                       line.style_dotted

// ==================== VWAP CALCULATION ====================
// Calculate VWAP - uses typical price and cumulative volume
tp = (high + low + close) / 3.0
vwap_val = ta.vwap(tp)

// Calculate ATR on execution timeframe (10-period for scalps)
atr_val = ta.atr(atr_period)

// Upper band: VWAP + ATR (extended zone)
upper_band = vwap_val + (atr_val * atr_mult_upper)

// Lower band: VWAP + ATR (extended zone - below VWAP for short reversions)
lower_band = vwap_val + (atr_val * atr_mult_lower)

// Mid-entry zones (where reversions are most likely)
mid_upper = vwap_val + (atr_val * atr_mult_upper * 0.5)
mid_lower = vwap_val - (atr_val * atr_mult_lower * 0.5)

// ==================== VWAP PLOTTING ====================
plot(showvwap ? vwap_val : na, title = "VWAP Daily", color = vwap_line_col, linewidth = 2)
plot(showvwap ? upper_band : na, title = "VWAP Upper Band (Reversion Entry)", color = color.new(color.green, 40), linewidth = 1, style = plot.style_dashed)
plot(showvwap ? lower_band : na, title = "VWAP Lower Band", color = color.new(color.red, 40), linewidth = 1, style = plot.style_dashed)

// Highlight when price is in entry zone (1.5-2.5 ATR from VWAP)
in_entry_zone_upper = close > lower_band and close < upper_band
in_entry_zone_lower = close > (vwap_val - atr_val * atr_mult_upper) and close < (vwap_val - atr_val * atr_mult_lower)

bgcolor(show_entry_zone and in_entry_zone_upper ? entry_zone_col : na, title = "VWAP Entry Zone")

// ==================== ORIGINAL DIVERGENCE CODE ====================
// Get indicators
rsi = ta.rsi(close, 14) // RSI
[macd, signal, deltamacd] = ta.macd(close, 12, 26, 9) // MACD
moment = ta.momentum(close, 10) // Momentum
cci = ta.cci(close, 10) // CCI
Obv = ta.obv // OBV
stk = ta.sma(ta.stoch(close, high, low, 14), 3) // Stoch
maFast = ta.vwma(close, 12), maSlow = ta.vwma(close, 26), vwmacd = maFast - maSlow // volume weighted macd
Cmfm = ((close-low) - (high-close)) / (high - low), Cmfv = Cmfm * volume, cmf = ta.sma(Cmfv, 21) / ta.sma(volume, 21) // Chaikin money flow
Mfi = ta.mfi(close, 14) // Money Flow Index

// Keep indicator names and colors in arrays
var indicators_name = array.new_string(11)
var div_colors = array.new_color(4)
if barstate.isfirst
    // names
    array.set(indicators_name, 0, showindis == "Full" ? "MACD" : "M")
    array.set(indicators_name, 1, showindis == "Full" ? "Hist" : "H")
    array.set(indicators_name, 2, showindis == "Full" ? "RSI" : "E")
    array.set(indicators_name, 3, showindis == "Full" ? "Stoch" : "S")
    array.set(indicators_name, 4, showindis == "Full" ? "CCI" : "C")
    array.set(indicators_name, 5, showindis == "Full" ? "MOM" : "M")
    array.set(indicators_name, 6, showindis == "Full" ? "OBV" : "O")
    array.set(indicators_name, 7, showindis == "Full" ? "VWMACD" : "V")
    array.set(indicators_name, 8, showindis == "Full" ? "CMF" : "C")
    array.set(indicators_name, 9, showindis == "Full" ? "MFI" : "M")
    array.set(indicators_name, 10, showindis == "Full" ? "Extrn" : "X")
    //colors
    array.set(div_colors, 0, pos_reg_div_col)
    array.set(div_colors, 1, neg_reg_div_col)
    array.set(div_colors, 2, pos_hid_div_col)
    array.set(div_colors, 3, neg_hid_div_col)

// Check if we get new Pivot High Or Pivot Low
float ph = ta.pivothigh((source == "Close" ? close : high), prd, prd)
float pl = ta.pivotlow((source == "Close" ? close : low), prd, prd)
plotshape(ph and showpivot, text = "H", style = shape.labeldown, color = color.new(color.white, 100), textcolor = color.red, location = location.abovebar, transp = 0, offset = -prd)
plotshape(pl and showpivot, text = "L", style = shape.labelup, color = color.new(color.white, 100), textcolor = color.lime, location = location.belowbar, transp = 0, offset = -prd)

// Keep values and positions of Pivot Highs/Lows in arrays
var int maxarraysize = 20
var ph_positions = array.new_int(maxarraysize, 0)
var pl_positions = array.new_int(maxarraysize, 0)
var ph_vals = array.new_float(maxarraysize, 0.)
var pl_vals = array.new_float(maxarraysize, 0.)

// Add PHs to array
if ph
    array.unshift(ph_positions, bar_index)
    array.unshift(ph_vals, ph)
    if array.size(ph_positions) > maxarraysize
        array.pop(ph_positions)
        array.pop(ph_vals)

// Add PLs to array
if pl
    array.unshift(pl_positions, bar_index)
    array.unshift(pl_vals, pl)
    if array.size(pl_positions) > maxarraysize
        array.pop(pl_positions)
        array.pop(pl_vals)

// Divergence detection functions (from original code)
positive_regular_positive_hidden_divergence(src, cond)=>
    divlen = 0
    prsc = source == "Close" ? close : low
    if dontconfirm or src > src[1] or close > close[1]
        startpoint = dontconfirm ? 0 : 1
        for x = 0 to maxpp - 1
            len = bar_index - array.get(pl_positions, x) + prd
            if array.get(pl_positions, x) == 0 or len > maxbars
                break
            if len > 5 and
               ((cond == 1 and src[startpoint] > src[len] and prsc[startpoint] < nz(array.get(pl_vals, x))) or
               (cond == 2 and src[startpoint] < src[len] and prsc[startpoint] > nz(array.get(pl_vals, x))))
                slope1 = (src[startpoint] - src[len]) / (len - startpoint)
                virtual_line1 = src[startpoint] - slope1
                slope2 = (close[startpoint] - close[len]) / (len - startpoint)
                virtual_line2 = close[startpoint] - slope2
                arrived = true
                for y = 1 + startpoint to len - 1
                    if src[y] < virtual_line1 or nz(close[y]) < virtual_line2
                        arrived := false
                        break
                    virtual_line1 := virtual_line1 - slope1
                    virtual_line2 := virtual_line2 - slope2

                if arrived
                    divlen := len
                    break
    divlen

negative_regular_negative_hidden_divergence(src, cond)=>
    divlen = 0
    prsc = source == "Close" ? close : high
    if dontconfirm or src < src[1] or close < close[1]
        startpoint = dontconfirm ? 0 : 1
        for x = 0 to maxpp - 1
            len = bar_index - array.get(ph_positions, x) + prd
            if array.get(ph_positions, x) == 0 or len > maxbars
                break
            if len > 5 and
               ((cond == 1 and src[startpoint] < src[len] and prsc[startpoint] > nz(array.get(ph_vals, x))) or
               (cond == 2 and src[startpoint] > src[len] and prsc[startpoint] < nz(array.get(ph_vals, x))))
                slope1 = (src[startpoint] - src[len]) / (len - startpoint)
                virtual_line1 = src[startpoint] - slope1
                slope2 = (close[startpoint] - nz(close[len])) / (len - startpoint)
                virtual_line2 = close[startpoint] - slope2
                arrived = true
                for y = 1 + startpoint to len - 1
                    if src[y] > virtual_line1 or nz(close[y]) > virtual_line2
                        arrived := false
                        break
                    virtual_line1 := virtual_line1 - slope1
                    virtual_line2 := virtual_line2 - slope2

                if arrived
                    divlen := len
                    break
    divlen

// Calculate divergences
calculate_divs(cond, indicator)=>
    divs = array.new_int(4, 0)
    array.set(divs, 0, cond and (searchdiv == "Regular" or searchdiv == "Regular/Hidden") ? positive_regular_positive_hidden_divergence(indicator, 1) : 0)
    array.set(divs, 1, cond and (searchdiv == "Regular" or searchdiv == "Regular/Hidden") ? negative_regular_negative_hidden_divergence(indicator, 1) : 0)
    array.set(divs, 2, cond and (searchdiv == "Hidden" or searchdiv == "Regular/Hidden") ? positive_regular_positive_hidden_divergence(indicator, 2) : 0)
    array.set(divs, 3, cond and (searchdiv == "Hidden" or searchdiv == "Regular/Hidden") ? negative_regular_negative_hidden_divergence(indicator, 2) : 0)
    divs

// Array to keep all divergences
var all_divergences = array.new_int(44) // 11 indicators * 4 divergence types = 44 elements

// Set related array elements
array_set_divs(div_pointer, index)=>
    for x = 0 to 3
        array.set(all_divergences, index * 4 + x, array.get(div_pointer, x))

// Calculate all divergences
array_set_divs(calculate_divs(calcmacd, macd), 0)
array_set_divs(calculate_divs(calcmacda, deltamacd), 1)
array_set_divs(calculate_divs(calcrsi, rsi), 2)
array_set_divs(calculate_divs(calcstoc, stk), 3)
array_set_divs(calculate_divs(calccci, cci), 4)
array_set_divs(calculate_divs(calcmom, moment), 5)
array_set_divs(calculate_divs(calcobv, Obv), 6)
array_set_divs(calculate_divs(calcvwmacd, vwmacd), 7)
array_set_divs(calculate_divs(calccmf, cmf), 8)
array_set_divs(calculate_divs(calcmfi, Mfi), 9)
array_set_divs(calculate_divs(calcext, externalindi), 10)

// Check minimum number of divergences
total_div = 0
for x = 0 to array.size(all_divergences) - 1
    total_div := total_div + math.sign(array.get(all_divergences, x))

if total_div < showlimit
    array.clear(all_divergences)

// ==================== WINGMAN ENHANCEMENT ====================
// Alert when divergence detected + price in entry zone
divergence_with_vwap_signal = (total_div >= showlimit) and (in_entry_zone_upper or in_entry_zone_lower)

plotshape(divergence_with_vwap_signal and show_entry_zone, title = "Divergence + VWAP Zone Signal",
          style = shape.circle, location = location.bottom, color = color.new(color.orange, 0),
          size = size.large)

// ==================== TABLE: TRADE CHECKLIST ====================
// Display live trade checklist at top-right
var table_obj = table.new(position.top_right, 4, 5, border_width = 1)

// Populate table with current state
if barstate.islast
    table.cell(table_obj, 0, 0, "VWAP REVERSION SCALP CHECKLIST", text_size = size.small, bgcolor = color.navy, text_color = color.white)

    // Price vs VWAP
    table.cell(table_obj, 0, 1, "Price vs VWAP:", text_size = size.small, text_color = color.white)
    table.cell(table_obj, 1, 1, close > vwap_val ? "ABOVE (" + str.tostring(close - vwap_val, "0.00") + ")" : "BELOW (" + str.tostring(vwap_val - close, "0.00") + ")",
               text_size = size.small, text_color = close > vwap_val ? color.green : color.red)

    // Entry zone check
    table.cell(table_obj, 0, 2, "In Entry Zone?", text_size = size.small, text_color = color.white)
    table.cell(table_obj, 1, 2, in_entry_zone_upper or in_entry_zone_lower ? "YES ✓" : "NO",
               text_size = size.small, text_color = in_entry_zone_upper or in_entry_zone_lower ? color.green : color.gray)

    // Divergence check
    table.cell(table_obj, 0, 3, "Divergence Found?", text_size = size.small, text_color = color.white)
    table.cell(table_obj, 1, 3, total_div >= showlimit ? "YES ✓ (" + str.tostring(total_div) + ")" : "NO",
               text_size = size.small, text_color = total_div >= showlimit ? color.green : color.gray)

    // Overall signal
    table.cell(table_obj, 0, 4, "SIGNAL:", text_size = size.small, bgcolor = divergence_with_vwap_signal ? color.green : color.gray, text_color = color.white)
    table.cell(table_obj, 1, 4, divergence_with_vwap_signal ? "READY ✓" : "WAITING",
               text_size = size.small, bgcolor = divergence_with_vwap_signal ? color.green : color.gray, text_color = color.white)

// ==================== INFO LABEL ====================
var infolbl = label.new(bar_index, high, "", xloc = xloc.bar_index, yloc = yloc.abovebar, text_size = size.small, color = color.new(color.blue, 100))

if barstate.islast
    info_text = ("ATR: " + str.tostring(atr_val, "0.00") +
                " | Entry Zone: " + str.tostring(lower_band, "0.00") + "-" + str.tostring(upper_band, "0.00") +
                " | Divergences: " + str.tostring(total_div))
    label.set_text(infolbl, info_text)
