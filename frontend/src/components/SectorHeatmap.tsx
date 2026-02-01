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
      {/* Title + Timeframe selector inline */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Sector Heatmap</h2>
        <div className="flex gap-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setSelectedTimeframe(tf)}
              className={cn(
                'px-2 py-0.5 rounded text-xs transition-colors',
                selectedTimeframe === tf
                  ? 'bg-blue-600 text-white'
                  : 'bg-bg-tertiary text-gray-500 hover:text-white'
              )}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap grid - more compact */}
      {sectors.length === 0 ? (
        <div className="text-center text-gray-500 py-6 text-sm">Loading sector data...</div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {sortedSectors.map((sector) => {
            const perf = getPerf(sector)
            return (
              <div
                key={sector.symbol}
                className={cn(
                  'p-2 rounded cursor-pointer transition-all hover:scale-105 hover:brightness-110',
                  getColor(perf)
                )}
                title={`${sector.name} | RS: ${sector.rs_score?.toFixed(1)} | Rank #${sector.rs_rank}`}
              >
                <div className="font-semibold text-white text-xs">{sector.symbol}</div>
                <div className="text-base font-bold text-white">
                  {perf > 0 ? '+' : ''}{perf?.toFixed(1)}%
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
