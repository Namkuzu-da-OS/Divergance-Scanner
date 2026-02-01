import { useState } from 'react'
import { useScannerStore } from '../stores/scannerStore'
import { cn } from '../lib/utils'

interface Divergence {
  symbol_a: string
  symbol_b: string
  type: string
  message: string
  strength: number
  confidence: 'high' | 'medium' | 'low'
  correlation: {
    current: number | null
    baseline: number | null
    zscore: number | null
  }
  relative_strength: {
    ratio: number | null
    ma: number | null
    direction: 'strengthening' | 'weakening' | 'neutral'
  }
  performance: {
    symbol_a: Record<string, number | null>
    symbol_b: Record<string, number | null>
    spread: Record<string, number | null>
  }
}

function DivergenceModal({
  divergence,
  onClose
}: {
  divergence: Divergence
  onClose: () => void
}) {
  const d = divergence

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          'bg-bg-secondary rounded-lg border max-w-lg w-full p-5',
          d.confidence === 'high' && 'border-red-500/50',
          d.confidence === 'medium' && 'border-yellow-500/50',
          d.confidence === 'low' && 'border-blue-500/50',
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="font-semibold text-white text-lg">
              {d.symbol_a} vs {d.symbol_b}
            </div>
            <div className="text-sm text-gray-400 mt-1">{d.message}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className={cn(
              'text-xs px-2 py-1 rounded',
              d.confidence === 'high' && 'bg-red-900 text-red-300',
              d.confidence === 'medium' && 'bg-yellow-900 text-yellow-300',
              d.confidence === 'low' && 'bg-blue-900 text-blue-300',
            )}>
              {d.confidence}
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white text-xl leading-none"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Strength bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Strength</span>
            <span>{(d.strength * 100).toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-bg-primary rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full',
                d.confidence === 'high' && 'bg-red-500',
                d.confidence === 'medium' && 'bg-yellow-500',
                d.confidence === 'low' && 'bg-blue-500',
              )}
              style={{ width: `${d.strength * 100}%` }}
            />
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-3 gap-4 text-sm mb-4">
          <div className="bg-bg-primary/50 rounded p-3">
            <div className="text-gray-500 text-xs mb-1">Correlation</div>
            <div className="text-white font-medium">
              {d.correlation.current?.toFixed(3)}
            </div>
            <div className="text-gray-500 text-xs mt-1">
              baseline: {d.correlation.baseline?.toFixed(3)}
            </div>
          </div>
          <div className="bg-bg-primary/50 rounded p-3">
            <div className="text-gray-500 text-xs mb-1">Z-Score</div>
            <div className={cn(
              'font-medium',
              Math.abs(d.correlation.zscore || 0) > 2 ? 'text-red-400' : 'text-white'
            )}>
              {d.correlation.zscore?.toFixed(2)}
            </div>
            <div className="text-gray-500 text-xs mt-1">
              {Math.abs(d.correlation.zscore || 0) > 2 ? 'significant' : 'normal'}
            </div>
          </div>
          <div className="bg-bg-primary/50 rounded p-3">
            <div className="text-gray-500 text-xs mb-1">RS Direction</div>
            <div className={cn(
              'font-medium',
              d.relative_strength.direction === 'strengthening' && 'text-green-400',
              d.relative_strength.direction === 'weakening' && 'text-red-400',
              d.relative_strength.direction === 'neutral' && 'text-gray-400',
            )}>
              {d.relative_strength.direction}
            </div>
            <div className="text-gray-500 text-xs mt-1">
              ratio: {d.relative_strength.ratio?.toFixed(4)}
            </div>
          </div>
        </div>

        {/* Performance Spread */}
        <div className="bg-bg-primary/50 rounded p-3">
          <div className="text-xs text-gray-500 mb-2">
            Performance Spread ({d.symbol_a} - {d.symbol_b})
          </div>
          <div className="grid grid-cols-4 gap-2 text-sm">
            {['1d', '5d', '20d', '60d'].map((tf) => {
              const spread = d.performance.spread[tf]
              if (spread === null || spread === undefined) return (
                <div key={tf} className="text-center">
                  <div className="text-gray-600 text-xs">{tf}</div>
                  <div className="text-gray-600">-</div>
                </div>
              )
              return (
                <div key={tf} className="text-center">
                  <div className="text-gray-500 text-xs">{tf}</div>
                  <div className={cn(
                    'font-medium',
                    spread > 0 ? 'text-green-400' : 'text-red-400'
                  )}>
                    {spread > 0 ? '+' : ''}{spread.toFixed(1)}%
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Individual Performance */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="bg-bg-primary/50 rounded p-3">
            <div className="text-xs text-gray-500 mb-2">{d.symbol_a} Performance</div>
            <div className="flex gap-2 text-xs flex-wrap">
              {['1d', '5d', '20d', '60d'].map((tf) => {
                const perf = d.performance.symbol_a[tf]
                if (perf === null || perf === undefined) return null
                return (
                  <span key={tf} className={cn(
                    perf > 0 ? 'text-green-400' : 'text-red-400'
                  )}>
                    {tf}: {perf > 0 ? '+' : ''}{perf.toFixed(1)}%
                  </span>
                )
              })}
            </div>
          </div>
          <div className="bg-bg-primary/50 rounded p-3">
            <div className="text-xs text-gray-500 mb-2">{d.symbol_b} Performance</div>
            <div className="flex gap-2 text-xs flex-wrap">
              {['1d', '5d', '20d', '60d'].map((tf) => {
                const perf = d.performance.symbol_b[tf]
                if (perf === null || perf === undefined) return null
                return (
                  <span key={tf} className={cn(
                    perf > 0 ? 'text-green-400' : 'text-red-400'
                  )}>
                    {tf}: {perf > 0 ? '+' : ''}{perf.toFixed(1)}%
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DivergencePanel() {
  const { divergences } = useScannerStore()
  const [selectedDivergence, setSelectedDivergence] = useState<Divergence | null>(null)

  if (divergences.length === 0) {
    return (
      <div className="text-center text-gray-500 py-6 text-sm">
        No significant divergences detected
      </div>
    )
  }

  // Sort by strength
  const sorted = [...divergences].sort((a, b) => b.strength - a.strength)

  return (
    <>
      <div className="space-y-1.5">
        {sorted.map((d, i) => (
          <div
            key={`${d.symbol_a}-${d.symbol_b}-${i}`}
            onClick={() => setSelectedDivergence(d as Divergence)}
            className={cn(
              'p-2 rounded cursor-pointer transition-all hover:brightness-110',
              d.relative_strength.direction === 'strengthening' && 'bg-green-950/40',
              d.relative_strength.direction === 'weakening' && 'bg-red-950/40',
              d.relative_strength.direction === 'neutral' && 'bg-bg-tertiary',
            )}
          >
            {/* Top row: Pair name + direction badge */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white text-sm">
                  {d.symbol_a} <span className="text-gray-500">vs</span> {d.symbol_b}
                </span>
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded font-medium',
                  d.relative_strength.direction === 'strengthening' && 'bg-green-800 text-green-300',
                  d.relative_strength.direction === 'weakening' && 'bg-red-800 text-red-300',
                  d.relative_strength.direction === 'neutral' && 'bg-gray-700 text-gray-400',
                )}>
                  {d.relative_strength.direction}
                </span>
              </div>
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-medium',
                d.confidence === 'high' && 'bg-red-800 text-red-200',
                d.confidence === 'medium' && 'bg-yellow-800 text-yellow-200',
                d.confidence === 'low' && 'bg-blue-800 text-blue-200',
              )}>
                {d.confidence}
              </span>
            </div>

            {/* Strength bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-bg-primary rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    d.relative_strength.direction === 'strengthening' && 'bg-green-500',
                    d.relative_strength.direction === 'weakening' && 'bg-red-500',
                    d.relative_strength.direction === 'neutral' && 'bg-gray-500',
                  )}
                  style={{ width: `${d.strength * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400 w-8 text-right">
                {(d.strength * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {selectedDivergence && (
        <DivergenceModal
          divergence={selectedDivergence}
          onClose={() => setSelectedDivergence(null)}
        />
      )}
    </>
  )
}
