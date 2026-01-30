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
  const { alerts, markAlertRead } = useScannerStore()
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

  if (alerts.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No alerts yet
      </div>
    )
  }

  return (
    <div>
      {/* Header with unread count */}
      {unreadCount > 0 && (
        <div className="mb-3 text-sm">
          <span className="px-2 py-1 bg-red-900 text-red-300 rounded text-xs">
            {unreadCount} unread
          </span>
        </div>
      )}

      {/* Alert list */}
      <div className="space-y-2 max-h-[350px] overflow-auto">
        {sorted.slice(0, 20).map((alert) => (
          <div
            key={alert.id}
            onClick={() => handleAlertClick(alert as Alert)}
            className={cn(
              'p-3 rounded-lg cursor-pointer transition-all hover:bg-bg-tertiary/80',
              !alert.read && 'bg-bg-tertiary border-l-2',
              alert.read && 'bg-bg-tertiary/50 opacity-60',
              alert.severity === 'critical' && !alert.read && 'border-l-red-500',
              alert.severity === 'warning' && !alert.read && 'border-l-yellow-500',
              alert.severity === 'info' && !alert.read && 'border-l-blue-500',
            )}
          >
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded',
                    alert.severity === 'critical' && 'bg-red-900 text-red-300',
                    alert.severity === 'warning' && 'bg-yellow-900 text-yellow-300',
                    alert.severity === 'info' && 'bg-blue-900 text-blue-300',
                  )}>
                    {alert.severity}
                  </span>
                  <span className="text-sm font-medium text-white">{alert.symbol}</span>
                </div>
                <div className="text-sm text-gray-400 mt-1 line-clamp-2">{alert.message}</div>
              </div>
              <div className="text-xs text-gray-500 whitespace-nowrap ml-2">
                {new Date(alert.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
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
