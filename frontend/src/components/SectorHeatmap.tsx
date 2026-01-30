import { useScannerStore } from '../stores/scannerStore'
import { cn } from '../lib/utils'

export function SectorHeatmap() {
  const { rankings, selectedTimeframe, setSelectedTimeframe } = useScannerStore()

  // Filter to sectors only
  const sectors = rankings.filter(r => r.category === 'sectors')

  const timeframes = ['1d', '5d', '20d', '60d'] as const

  // Get performance for selected timeframe
  // For 1D, use real-time quote change; for other timeframes, use historical performance
  const getPerf = (r: typeof sectors[0]) => {
    if (selectedTimeframe === '1d') {
      // Use real-time quote change for 1D (more accurate)
      return r.change_1d_pct ?? r.performance['1d'] ?? 0
    }
    const key = selectedTimeframe as keyof typeof r.performance
    return r.performance[key] ?? 0
  }

  // Color based on performance
  const getColor = (perf: number) => {
    if (perf > 3) return 'bg-green-600'
    if (perf > 1.5) return 'bg-green-700'
    if (perf > 0) return 'bg-green-800/70'
    if (perf > -1.5) return 'bg-red-900/70'
    if (perf > -3) return 'bg-red-700'
    return 'bg-red-600'
  }

  // Sort by performance
  const sortedSectors = [...sectors].sort((a, b) => getPerf(b) - getPerf(a))

  return (
    <div>
      {/* Timeframe selector */}
      <div className="flex gap-2 mb-4">
        {timeframes.map((tf) => (
          <button
            key={tf}
            onClick={() => setSelectedTimeframe(tf)}
            className={cn(
              'px-3 py-1 rounded text-sm transition-colors',
              selectedTimeframe === tf
                ? 'bg-blue-600 text-white'
                : 'bg-bg-tertiary text-gray-400 hover:text-white'
            )}
          >
            {tf.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Heatmap grid */}
      {sectors.length === 0 ? (
        <div className="text-center text-gray-500 py-8">Loading sector data...</div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {sortedSectors.map((sector) => {
            const perf = getPerf(sector)
            return (
              <div
                key={sector.symbol}
                className={cn(
                  'p-3 rounded cursor-pointer transition-all hover:scale-105',
                  getColor(perf)
                )}
              >
                <div className="font-semibold text-white text-sm">{sector.symbol}</div>
                <div className="text-xs text-gray-200 truncate">{sector.name}</div>
                <div className="text-lg font-bold text-white mt-1">
                  {perf > 0 ? '+' : ''}{perf?.toFixed(1)}%
                </div>
                <div className="text-xs text-gray-300">
                  RS: {sector.rs_score?.toFixed(1)} | #{sector.rs_rank}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-600"></div> Strong
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-800/70"></div> Positive
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-900/70"></div> Negative
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-600"></div> Weak
        </span>
      </div>
    </div>
  )
}
