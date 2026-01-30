import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface RSRanking {
  symbol: string
  name: string
  category: string
  price: number
  change_1d: number
  change_1d_pct: number
  performance: {
    '1d': number | null
    '5d': number | null
    '20d': number | null
    '60d': number | null
  }
  rs_score: number
  rs_rank: number
  rs_percentile: number
  trend: string
  above_20sma: boolean
  above_50sma: boolean
}

interface Divergence {
  symbol_a: string
  symbol_b: string
  type: string
  correlation: {
    current: number
    baseline: number
    zscore: number
  }
  performance: {
    symbol_a: Record<string, number | null>
    symbol_b: Record<string, number | null>
    spread: Record<string, number | null>
  }
  relative_strength: {
    ratio: number
    ma: number
    direction: string
  }
  strength: number
  confidence: string
  message: string
  timestamp: string
}

interface RotationData {
  regime: {
    phase: string
    confidence: number
    leading_sectors: string[]
    lagging_sectors: string[]
    message: string
  }
  sector_rankings: RSRanking[]
}

interface Alert {
  id: string
  type: string
  severity: 'info' | 'warning' | 'critical'
  symbol: string
  message: string
  timestamp: string
  read: boolean
  data?: {
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
}

interface ScannerState {
  // Data
  rankings: RSRanking[]
  divergences: Divergence[]
  rotations: RotationData | null
  alerts: Alert[]
  quotes: Record<string, { price: number; change: number; change_pct: number }>

  // Setters
  setRankings: (rankings: RSRanking[]) => void
  setDivergences: (divergences: Divergence[]) => void
  setRotations: (rotations: RotationData) => void
  addAlerts: (alerts: Alert[]) => void
  markAlertRead: (id: string) => void
  setQuotes: (quotes: Record<string, { price: number; change: number; change_pct: number }>) => void

  // Filters
  selectedCategory: string
  setSelectedCategory: (category: string) => void
  selectedTimeframe: string
  setSelectedTimeframe: (timeframe: string) => void

  // Connection
  wsConnected: boolean
  setWsConnected: (connected: boolean) => void
  lastUpdate: string | null
  setLastUpdate: (time: string) => void
}

export const useScannerStore = create<ScannerState>()(
  persist(
    (set) => ({
      // Data
      rankings: [],
      divergences: [],
      rotations: null,
      alerts: [],
      quotes: {},

      // Setters
      setRankings: (rankings) => set({ rankings }),
      setDivergences: (divergences) => set({ divergences }),
      setRotations: (rotations) => set({ rotations }),
      addAlerts: (newAlerts) => set((state) => {
        const existingIds = new Set(state.alerts.map(a => a.id))
        const uniqueNew = newAlerts.filter(a => !existingIds.has(a.id))
        return { alerts: [...uniqueNew, ...state.alerts].slice(0, 100) }
      }),
      markAlertRead: (id) => set((state) => ({
        alerts: state.alerts.map(a => a.id === id ? { ...a, read: true } : a)
      })),
      setQuotes: (quotes) => set({ quotes }),

      // Filters
      selectedCategory: 'all',
      setSelectedCategory: (selectedCategory) => set({ selectedCategory }),
      selectedTimeframe: '20d',
      setSelectedTimeframe: (selectedTimeframe) => set({ selectedTimeframe }),

      // Connection
      wsConnected: false,
      setWsConnected: (wsConnected) => set({ wsConnected }),
      lastUpdate: null,
      setLastUpdate: (lastUpdate) => set({ lastUpdate }),
    }),
    {
      name: 'divergence-scanner-storage',
      partialize: (state) => ({
        selectedCategory: state.selectedCategory,
        selectedTimeframe: state.selectedTimeframe,
      }),
    }
  )
)
