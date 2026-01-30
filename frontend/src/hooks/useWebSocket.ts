import { useEffect, useRef, useCallback, useState } from 'react'

interface UseWebSocketOptions {
  onMessage?: (message: { channel: string; data: unknown; timestamp: string }) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Event) => void
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export function useWebSocket(options: UseWebSocketOptions = {}) {
  // Store callbacks in refs to avoid reconnection on callback change
  const onMessageRef = useRef(options.onMessage)
  const onConnectRef = useRef(options.onConnect)
  const onDisconnectRef = useRef(options.onDisconnect)
  const onErrorRef = useRef(options.onError)

  // Update refs when callbacks change
  onMessageRef.current = options.onMessage
  onConnectRef.current = options.onConnect
  onDisconnectRef.current = options.onDisconnect
  onErrorRef.current = options.onError

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  const connect = useCallback(() => {
    // Don't connect if unmounted or already connected/connecting
    if (!mountedRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return

    setStatus('connecting')

    // Dynamic WebSocket URL - uses the same host that served the page
    const wsUrl = `ws://${window.location.hostname}:8042/ws`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setStatus('connected')
        onConnectRef.current?.()
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        wsRef.current = null
        setStatus('disconnected')
        onDisconnectRef.current?.()

        // Auto-reconnect after 5 seconds
        if (mountedRef.current) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect()
          }, 5000)
        }
      }

      ws.onerror = (error) => {
        onErrorRef.current?.(error)
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          // Handle channel messages
          if (message.channel && message.data) {
            onMessageRef.current?.(message)
          }
        } catch {
          console.warn('Failed to parse WebSocket message:', event.data)
        }
      }
    } catch (error) {
      console.error('WebSocket connection error:', error)
      setStatus('disconnected')
    }
  }, []) // No dependencies - uses refs for callbacks

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.onclose = null // Prevent reconnect on manual disconnect
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const subscribe = useCallback((channel: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'subscribe', channel }))
    }
  }, [])

  const unsubscribe = useCallback((channel: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'unsubscribe', channel }))
    }
  }, [])

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      disconnect()
    }
  }, [connect, disconnect])

  return {
    status,
    isConnected: status === 'connected',
    subscribe,
    unsubscribe,
    connect,
    disconnect,
  }
}
