import { useScannerStore } from '../stores/scannerStore'
import { cn } from '../lib/utils'

export function RSRankingTable() {
  const { rankings, selectedCategory } = useScannerStore()

  // Filter by category
  const filtered = selectedCategory === 'all'
    ? rankings
    : rankings.filter(r => r.category === selectedCategory)

  // Sort by RS rank
  const sorted = [...filtered].sort((a, b) => a.rs_rank - b.rs_rank)

  if (sorted.length === 0) {
    return <div className="text-center text-gray-500 py-8">Loading rankings...</div>
  }

  return (
    <div className="overflow-auto max-h-[320px]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-bg-secondary z-10">
          <tr className="text-gray-500 text-left border-b border-border">
            <th className="px-2 py-1.5 font-medium w-12">#</th>
            <th className="px-2 py-1.5 font-medium">Symbol</th>
            <th className="px-2 py-1.5 font-medium">Price</th>
            <th className="px-2 py-1.5 font-medium text-right">1D</th>
            <th className="px-2 py-1.5 font-medium text-right">5D</th>
            <th className="px-2 py-1.5 font-medium text-right">20D</th>
            <th className="px-2 py-1.5 font-medium text-right">60D</th>
            <th className="px-2 py-1.5 font-medium text-center">RS</th>
            <th className="px-2 py-1.5 font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.symbol}
              className="border-b border-border/30 hover:bg-bg-tertiary/50 transition-colors"
            >
              <td className="px-2 py-1.5 text-gray-500">{r.rs_rank}</td>
              <td className="px-2 py-1.5">
                <span className="font-semibold text-white">{r.symbol}</span>
                <span className="text-gray-600 ml-1.5 hidden lg:inline">{r.name}</span>
              </td>
              <td className="px-2 py-1.5">
                <span className="text-gray-300">${r.price?.toFixed(2)}</span>
                <span className={cn(
                  'ml-1.5',
                  r.change_1d_pct > 0 ? 'text-green-500' : 'text-red-500'
                )}>
                  {r.change_1d_pct > 0 ? '+' : ''}{r.change_1d_pct?.toFixed(1)}%
                </span>
              </td>
              <td className={cn(
                'px-2 py-1.5 text-right tabular-nums',
                (r.performance['1d'] ?? 0) > 0 ? 'text-green-500' : 'text-red-500'
              )}>
                {r.performance['1d']?.toFixed(1)}%
              </td>
              <td className={cn(
                'px-2 py-1.5 text-right tabular-nums',
                (r.performance['5d'] ?? 0) > 0 ? 'text-green-500' : 'text-red-500'
              )}>
                {r.performance['5d']?.toFixed(1)}%
              </td>
              <td className={cn(
                'px-2 py-1.5 text-right tabular-nums',
                (r.performance['20d'] ?? 0) > 0 ? 'text-green-500' : 'text-red-500'
              )}>
                {r.performance['20d']?.toFixed(1)}%
              </td>
              <td className={cn(
                'px-2 py-1.5 text-right tabular-nums',
                (r.performance['60d'] ?? 0) > 0 ? 'text-green-500' : 'text-red-500'
              )}>
                {r.performance['60d']?.toFixed(1)}%
              </td>
              <td className="px-2 py-1.5 text-center">
                <span className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] font-semibold',
                  r.rs_score > 5 ? 'bg-green-800 text-green-200' :
                  r.rs_score > 0 ? 'bg-green-900/50 text-green-400' :
                  r.rs_score > -5 ? 'bg-red-900/50 text-red-400' :
                  'bg-red-800 text-red-200'
                )}>
                  {r.rs_score?.toFixed(1)}
                </span>
              </td>
              <td className="px-2 py-1.5">
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded',
                  r.trend.includes('up') ? 'bg-green-900/40 text-green-400' :
                  r.trend.includes('down') ? 'bg-red-900/40 text-red-400' :
                  'bg-gray-800 text-gray-500'
                )}>
                  {r.trend.replace('_', ' ')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
