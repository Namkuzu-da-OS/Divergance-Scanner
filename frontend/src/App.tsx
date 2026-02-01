import { useEffect, useCallback, useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWebSocket } from './hooks/useWebSocket'
import { useScannerStore } from './stores/scannerStore'
import { Header } from './components/Header'
import { SectorHeatmap } from './components/SectorHeatmap'
import { RSRankingTable } from './components/RSRankingTable'
import { DivergencePanel } from './components/DivergencePanel'
import { AlertsPanel } from './components/AlertsPanel'

// API base - empty string means same origin (nginx proxies to backend)
// For dev mode with Vite proxy, this also works since Vite proxies /api to backend
const API_BASE = ''

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchInterval: 60000,
    },
  },
})

function Dashboard() {
  const {
    setRankings,
    setDivergences,
    setRotations,
    addAlerts,
    setQuotes,
    setWsConnected,
    setLastUpdate,
  } = useScannerStore()

  const subscribeRef = useRef<((channel: string) => void) | null>(null)

  const handleConnect = useCallback(() => {
    setWsConnected(true)
    // Subscribe to all channels
    if (subscribeRef.current) {
      subscribeRef.current('rankings')
      subscribeRef.current('divergences')
      subscribeRef.current('rotations')
      subscribeRef.current('alerts')
      subscribeRef.current('quotes')
    }
  }, [setWsConnected])

  const handleDisconnect = useCallback(() => {
    setWsConnected(false)
  }, [setWsConnected])

  const handleMessage = useCallback((message: { channel: string; data: unknown }) => {
    setLastUpdate(new Date().toISOString())

    switch (message.channel) {
      case 'rankings':
        setRankings(message.data as never[])
        break
      case 'divergences':
        setDivergences(message.data as never[])
        break
      case 'rotations':
        setRotations(message.data as never)
        break
      case 'alerts':
        addAlerts(message.data as never[])
        break
      case 'quotes':
        setQuotes(message.data as never)
        break
    }
  }, [setLastUpdate, setRankings, setDivergences, setRotations, addAlerts, setQuotes])

  const { status, subscribe } = useWebSocket({
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    onMessage: handleMessage,
  })

  // Store subscribe in ref so handleConnect can access it
  subscribeRef.current = subscribe

  // Initial data fetch
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // Fetch rankings
        const rankingsRes = await fetch(`${API_BASE}/api/relative-strength/rankings`)
        if (rankingsRes.ok) {
          const data = await rankingsRes.json()
          setRankings(data.rankings)
        }

        // Fetch divergences
        const divRes = await fetch(`${API_BASE}/api/divergence/scan`)
        if (divRes.ok) {
          const data = await divRes.json()
          setDivergences(data.divergences)
        }

        // Fetch regime
        const regimeRes = await fetch(`${API_BASE}/api/rotation/regime`)
        if (regimeRes.ok) {
          const data = await regimeRes.json()
          setRotations({ regime: data, sector_rankings: [] })
        }
      } catch (error) {
        console.error('Failed to fetch initial data:', error)
      }
    }

    fetchInitialData()
  }, [setRankings, setDivergences, setRotations])

  return (
    <div className="min-h-screen bg-bg-primary text-white">
      <Header connectionStatus={status} />

      <main className="p-3 max-w-[1920px] mx-auto">
        {/* Top Row: 3-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3 lg:grid-rows-[minmax(320px,auto)]">
          <div className="bg-bg-secondary rounded-lg p-3 border border-border">
            <SectorHeatmap />
          </div>

          <div className="bg-bg-secondary rounded-lg p-3 border border-border">
            <h2 className="text-sm font-semibold mb-2 text-gray-400 uppercase tracking-wide">Active Divergences</h2>
            <DivergencePanel />
          </div>

          <div className="bg-bg-secondary rounded-lg p-3 border border-border flex flex-col">
            <AlertsPanel />
          </div>
        </div>

        {/* Bottom Row: Full-width Rankings */}
        <div className="bg-bg-secondary rounded-lg p-3 border border-border">
          <h2 className="text-sm font-semibold mb-2 text-gray-400 uppercase tracking-wide">Relative Strength Rankings</h2>
          <RSRankingTable />
        </div>
      </main>
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  )
}

export default App
