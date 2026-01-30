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
    <div className="overflow-auto max-h-[400px]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-bg-secondary">
          <tr className="text-gray-400 text-left border-b border-border">
            <th className="p-2 font-medium">Rank</th>
            <th className="p-2 font-medium">Symbol</th>
            <th className="p-2 font-medium">Price</th>
            <th className="p-2 font-medium text-right">1D</th>
            <th className="p-2 font-medium text-right">5D</th>
            <th className="p-2 font-medium text-right">20D</th>
            <th className="p-2 font-medium text-right">60D</th>
            <th className="p-2 font-medium text-center">RS Score</th>
            <th className="p-2 font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.symbol}
              className="border-b border-border/50 hover:bg-bg-tertiary transition-colors"
            >
              <td className="p-2 text-gray-400">{r.rs_rank}</td>
              <td className="p-2">
                <div className="font-semibold text-white">{r.symbol}</div>
                <div className="text-xs text-gray-500">{r.name}</div>
              </td>
              <td className="p-2">
                <span className="text-white">${r.price?.toFixed(2)}</span>
                <span className={cn(
                  'ml-2 text-xs',
                  r.change_1d_pct > 0 ? 'text-green-500' : 'text-red-500'
                )}>
                  {r.change_1d_pct > 0 ? '+' : ''}{r.change_1d_pct?.toFixed(2)}%
                </span>
              </td>
              <td className={cn(
                'p-2 text-right',
                (r.performance['1d'] ?? 0) > 0 ? 'text-green-500' : 'text-red-500'
              )}>
                {r.performance['1d']?.toFixed(1)}%
              </td>
              <td className={cn(
                'p-2 text-right',
                (r.performance['5d'] ?? 0) > 0 ? 'text-green-500' : 'text-red-500'
              )}>
                {r.performance['5d']?.toFixed(1)}%
              </td>
              <td className={cn(
                'p-2 text-right',
                (r.performance['20d'] ?? 0) > 0 ? 'text-green-500' : 'text-red-500'
              )}>
                {r.performance['20d']?.toFixed(1)}%
              </td>
              <td className={cn(
                'p-2 text-right',
                (r.performance['60d'] ?? 0) > 0 ? 'text-green-500' : 'text-red-500'
              )}>
                {r.performance['60d']?.toFixed(1)}%
              </td>
              <td className="p-2 text-center">
                <span className={cn(
                  'px-2 py-1 rounded text-xs font-semibold',
                  r.rs_score > 5 ? 'bg-green-900 text-green-300' :
                  r.rs_score > 0 ? 'bg-green-900/50 text-green-400' :
                  r.rs_score > -5 ? 'bg-red-900/50 text-red-400' :
                  'bg-red-900 text-red-300'
                )}>
                  {r.rs_score?.toFixed(1)}
                </span>
              </td>
              <td className="p-2">
                <span className={cn(
                  'text-xs px-2 py-1 rounded',
                  r.trend.includes('up') ? 'bg-green-900/50 text-green-400' :
                  r.trend.includes('down') ? 'bg-red-900/50 text-red-400' :
                  'bg-gray-700 text-gray-400'
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
