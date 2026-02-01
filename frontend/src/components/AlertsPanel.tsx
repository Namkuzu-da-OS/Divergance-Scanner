import { useState } from 'react'
import { useScannerStore } from '../stores/scannerStore'
import { cn } from '../lib/utils'

interface AlertData {
  symbol_a?: string
  symbol_b?: string
  type?: string
  correlation?: {
    current: number
    baseline: number
    zscore: number
  }
  performance?: {
    symbol_a: Record<string, number>
    symbol_b: Record<string, number>
    spread: Record<string, number>
  }
  relative_strength?: {
    ratio: number
    ma: number
    direction: string
  }
  strength?: number
  confidence?: string
}

interface Alert {
  id: string
  type: string
  severity: 'info' | 'warning' | 'critical'
  symbol: string
  message: string
  timestamp: string
  read: boolean
  data?: AlertData
}

// Explanations for why each alert type matters
const alertExplanations: Record<string, { title: string; why: string; action: string }> = {
  correlation_breakdown: {
    title: "Correlation Breakdown",
    why: "When two historically correlated assets diverge significantly, it often signals a shift in market dynamics. This breakdown may indicate sector rotation, risk-off behavior, or a leading indicator for one asset catching up to the other.",
    action: "Watch for the lagging asset to either catch up (convergence trade) or for the divergence to continue (trend trade). Consider which asset is 'right' about the market direction."
  },
  rs_shift: {
    title: "Relative Strength Shift",
    why: "A change in relative strength direction indicates money is flowing between these assets. This is often an early signal of rotation - institutions repositioning before trends become obvious.",
    action: "Consider the strengthening asset for long positions and the weakening one for potential exits. Monitor if this shift aligns with broader market themes (risk-on/off, sector rotation)."
  },
  rotation: {
    title: "Sector Rotation Signal",
    why: "Capital is actively moving between market segments. This often precedes or confirms changes in the economic cycle and can identify emerging opportunities before they become crowded trades.",
    action: "Align positions with the flow direction. Money flowing INTO defensive sectors may signal risk-off; INTO cyclicals may signal early-cycle recovery."
  },
  price_extreme: {
    title: "Price Extreme",
    why: "The asset has reached an unusual price level relative to its recent history, potentially indicating overbought or oversold conditions.",
    action: "Look for mean reversion opportunities or trend continuation signals depending on broader context."
  }
}

// Duration curve explanations
const durationCurveExplanation = {
  why: "The yield curve (short vs long duration treasuries) is a key economic indicator. Breakdown in correlation between SHY/IEF/TLT often precedes Fed policy changes or signals market stress.",
  action: "A flattening curve (long-end falling relative to short) may signal recession fears. Steepening often signals growth expectations. This affects rate-sensitive sectors like Financials, Utilities, and Real Estate."
}

// Currency explanations
const currencyExplanation = {
  why: "Dollar strength impacts multinational earnings, commodity prices, and emerging markets. Gold typically moves inverse to the dollar.",
  action: "Strong dollar: favor domestic companies, expect EM weakness. Weak dollar: favor multinationals, commodities, and gold."
}

function AlertDetailModal({
  alert,
  onClose
}: {
  alert: Alert
  onClose: () => void
}) {
  const data = alert.data || {}
  const explanation = alertExplanations[alert.type] || alertExplanations.correlation_breakdown

  // Check for special pair types
  const isDurationCurve = ['SHY', 'IEF', 'TLT'].includes(data.symbol_a || '') &&
                          ['SHY', 'IEF', 'TLT'].includes(data.symbol_b || '')
  const isCurrencyRelated = data.symbol_a === 'UUP' || data.symbol_b === 'UUP' ||
                            data.symbol_a === 'GLD' || data.symbol_b === 'GLD'

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-bg-secondary rounded-lg max-w-lg w-full max-h-[80vh] overflow-y-auto border border-border"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={cn(
          "p-4 border-b border-border",
          alert.severity === 'critical' && 'bg-red-900/30',
          alert.severity === 'warning' && 'bg-yellow-900/30',
          alert.severity === 'info' && 'bg-blue-900/30',
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-xs px-2 py-1 rounded font-semibold',
                alert.severity === 'critical' && 'bg-red-700 text-red-100',
                alert.severity === 'warning' && 'bg-yellow-700 text-yellow-100',
                alert.severity === 'info' && 'bg-blue-700 text-blue-100',
              )}>
                {alert.severity.toUpperCase()}
              </span>
              <span className="font-semibold text-white text-lg">{alert.symbol}</span>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>
          <p className="text-sm text-gray-300 mt-2">{alert.message}</p>
          <p className="text-xs text-gray-500 mt-1">
            {new Date(alert.timestamp).toLocaleString()}
          </p>
        </div>

        {/* Data Section */}
        {data.correlation && (
          <div className="p-4 border-b border-border">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">Correlation Data</h4>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="bg-bg-tertiary p-2 rounded">
                <div className="text-gray-500 text-xs">Current</div>
                <div className={cn(
                  "font-mono",
                  data.correlation.current > 0 ? "text-green-400" : "text-red-400"
                )}>
                  {data.correlation.current.toFixed(3)}
                </div>
              </div>
              <div className="bg-bg-tertiary p-2 rounded">
                <div className="text-gray-500 text-xs">Baseline</div>
                <div className="font-mono text-gray-300">{data.correlation.baseline.toFixed(3)}</div>
              </div>
              <div className="bg-bg-tertiary p-2 rounded">
                <div className="text-gray-500 text-xs">Z-Score</div>
                <div className={cn(
                  "font-mono",
                  Math.abs(data.correlation.zscore) >= 2.5 && "text-red-400",
                  Math.abs(data.correlation.zscore) >= 2.0 && Math.abs(data.correlation.zscore) < 2.5 && "text-yellow-400",
                  Math.abs(data.correlation.zscore) < 2.0 && "text-gray-300",
                )}>
                  {data.correlation.zscore.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Performance Spread */}
        {data.performance?.spread && (
          <div className="p-4 border-b border-border">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">Performance Spread</h4>
            <div className="grid grid-cols-4 gap-2 text-sm">
              {['1d', '5d', '20d', '60d'].map(period => (
                <div key={period} className="bg-bg-tertiary p-2 rounded text-center">
                  <div className="text-gray-500 text-xs">{period}</div>
                  <div className={cn(
                    "font-mono",
                    (data.performance?.spread[period] || 0) > 0 ? "text-green-400" : "text-red-400"
                  )}>
                    {(data.performance?.spread[period] || 0).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Positive = {data.symbol_a} outperforming {data.symbol_b}
            </p>
          </div>
        )}

        {/* RS Direction */}
        {data.relative_strength && (
          <div className="p-4 border-b border-border">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">Relative Strength</h4>
            <div className="flex items-center gap-4">
              <div className="bg-bg-tertiary p-2 rounded flex-1">
                <div className="text-gray-500 text-xs">RS Ratio</div>
                <div className="font-mono text-gray-300">{data.relative_strength.ratio.toFixed(3)}</div>
              </div>
              <div className="bg-bg-tertiary p-2 rounded flex-1">
                <div className="text-gray-500 text-xs">MA</div>
                <div className="font-mono text-gray-300">{data.relative_strength.ma.toFixed(3)}</div>
              </div>
              <div className="bg-bg-tertiary p-2 rounded flex-1">
                <div className="text-gray-500 text-xs">Direction</div>
                <div className={cn(
                  "font-semibold",
                  data.relative_strength.direction === 'strengthening' && "text-green-400",
                  data.relative_strength.direction === 'weakening' && "text-red-400",
                  data.relative_strength.direction === 'neutral' && "text-gray-400",
                )}>
                  {data.relative_strength.direction}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Why This Matters */}
        <div className="p-4 border-b border-border">
          <h4 className="text-sm font-semibold text-yellow-400 mb-2">Why This Matters</h4>
          <p className="text-sm text-gray-300">
            {isDurationCurve ? durationCurveExplanation.why :
             isCurrencyRelated ? currencyExplanation.why :
             explanation.why}
          </p>
        </div>

        {/* Suggested Action */}
        <div className="p-4">
          <h4 className="text-sm font-semibold text-green-400 mb-2">Suggested Action</h4>
          <p className="text-sm text-gray-300">
            {isDurationCurve ? durationCurveExplanation.action :
             isCurrencyRelated ? currencyExplanation.action :
             explanation.action}
          </p>
        </div>
      </div>
    </div>
  )
}

export function AlertsPanel() {
  const { alerts, markAlertRead, rankings } = useScannerStore()
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)

  // Show unread first, then by timestamp
  const sorted = [...alerts].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })

  const unreadCount = alerts.filter(a => !a.read).length

  const handleAlertClick = (alert: Alert) => {
    setSelectedAlert(alert)
    markAlertRead(alert.id)
  }

  // Get top movers from rankings
  const sortedByChange = [...rankings].sort((a, b) => (b.change_1d_pct || 0) - (a.change_1d_pct || 0))
  const topGainers = sortedByChange.slice(0, 3)
  const topLosers = sortedByChange.slice(-3).reverse()

  return (
    <div className="h-full flex flex-col">
      {/* Top Movers Section */}
      <div className="mb-3 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Top Movers</h2>
        <div className="grid grid-cols-2 gap-2">
          {/* Gainers */}
          <div>
            <div className="text-[10px] text-gray-500 mb-1">GAINERS</div>
            <div className="space-y-1">
              {topGainers.map((r) => (
                <div key={r.symbol} className="flex items-center justify-between bg-green-950/30 rounded px-2 py-1">
                  <span className="text-xs font-medium text-white">{r.symbol}</span>
                  <span className="text-xs font-semibold text-green-400">
                    +{r.change_1d_pct?.toFixed(1)}%
                  </span>
                </div>
              ))}
              {topGainers.length === 0 && (
                <div className="text-xs text-gray-600 py-1">Loading...</div>
              )}
            </div>
          </div>
          {/* Losers */}
          <div>
            <div className="text-[10px] text-gray-500 mb-1">LOSERS</div>
            <div className="space-y-1">
              {topLosers.map((r) => (
                <div key={r.symbol} className="flex items-center justify-between bg-red-950/30 rounded px-2 py-1">
                  <span className="text-xs font-medium text-white">{r.symbol}</span>
                  <span className="text-xs font-semibold text-red-400">
                    {r.change_1d_pct?.toFixed(1)}%
                  </span>
                </div>
              ))}
              {topLosers.length === 0 && (
                <div className="text-xs text-gray-600 py-1">Loading...</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Alerts Section */}
      <div className="border-t border-border pt-2 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Alerts</h2>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 bg-red-800 text-red-200 rounded text-[10px] font-medium">
              {unreadCount} new
            </span>
          )}
        </div>

        {alerts.length === 0 ? (
          <div className="text-center text-gray-600 py-4 text-xs">
            No alerts yet
          </div>
        ) : (
          <div className="space-y-1 flex-1 overflow-auto">
            {sorted.map((alert) => (
              <div
                key={alert.id}
                onClick={() => handleAlertClick(alert as Alert)}
                className={cn(
                  'p-2 rounded cursor-pointer transition-all hover:brightness-110',
                  !alert.read && 'bg-bg-tertiary',
                  alert.read && 'bg-bg-tertiary/30 opacity-50',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full flex-shrink-0',
                    alert.severity === 'critical' && 'bg-red-500',
                    alert.severity === 'warning' && 'bg-yellow-500',
                    alert.severity === 'info' && 'bg-blue-500',
                  )} />
                  <span className="text-xs font-medium text-white">{alert.symbol}</span>
                  <span className="text-[10px] text-gray-500">
                    {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5 line-clamp-1 pl-3.5">{alert.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedAlert && (
        <AlertDetailModal
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
        />
      )}
    </div>
  )
}
