import { useScannerStore } from '../stores/scannerStore'
import { cn } from '../lib/utils'

interface HeaderProps {
  connectionStatus: 'connecting' | 'connected' | 'disconnected'
}

export function Header({ connectionStatus }: HeaderProps) {
  const { lastUpdate, rotations, selectedCategory, setSelectedCategory } = useScannerStore()

  const categories = [
    { value: 'all', label: 'All' },
    { value: 'indices', label: 'Indices' },
    { value: 'sectors', label: 'Sectors' },
    { value: 'commodities', label: 'Commodities' },
    { value: 'fixed_income', label: 'Fixed Income' },
  ]

  return (
    <header className="bg-bg-secondary border-b border-border px-4 py-3">
      <div className="max-w-[1800px] mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-white">Divergence Scanner</h1>

          {/* Market Regime Badge */}
          {rotations?.regime && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Regime:</span>
              <span className={cn(
                'px-2 py-1 rounded text-xs font-semibold',
                rotations.regime.phase === 'early_cycle' && 'bg-blue-900 text-blue-300',
                rotations.regime.phase === 'mid_cycle' && 'bg-green-900 text-green-300',
                rotations.regime.phase === 'late_cycle' && 'bg-yellow-900 text-yellow-300',
                rotations.regime.phase === 'recession' && 'bg-red-900 text-red-300',
                rotations.regime.phase === 'unknown' && 'bg-gray-700 text-gray-300',
              )}>
                {rotations.regime.phase.replace('_', ' ').toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Category Filter */}
          <div className="flex items-center gap-2">
            {categories.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setSelectedCategory(cat.value)}
                className={cn(
                  'px-3 py-1 rounded text-sm transition-colors',
                  selectedCategory === cat.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-bg-tertiary text-gray-400 hover:text-white'
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <div className={cn(
              'w-2 h-2 rounded-full',
              connectionStatus === 'connected' && 'bg-green-500',
              connectionStatus === 'connecting' && 'bg-yellow-500 animate-pulse',
              connectionStatus === 'disconnected' && 'bg-red-500',
            )} />
            <span className="text-xs text-gray-400">
              {connectionStatus === 'connected' ? 'Live' : connectionStatus}
            </span>
          </div>

          {/* Last Update */}
          {lastUpdate && (
            <span className="text-xs text-gray-500">
              Updated: {new Date(lastUpdate).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
