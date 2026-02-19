"""
Data Client for fetching market data from the remote data server
This is a CLIENT - it does NOT connect to Schwab directly.
"""
import httpx
import asyncio
from typing import Dict, List, Optional, Any
from datetime import datetime
import logging

from backend.core.config import get_settings

logger = logging.getLogger(__name__)


class DataClient:
    """
    HTTP client to fetch market data from the existing data server.
    The data server has the Schwab API connection.
    """

    def __init__(self):
        self.settings = get_settings()
        self.base_url = self.settings.data_server_url
        self.timeout = self.settings.data_server_timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the async HTTP client"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"}
            )
        return self._client

    async def close(self):
        """Close the HTTP client"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def get_quotes(self, symbols: List[str]) -> Dict[str, Dict]:
        """
        Fetch quotes for multiple symbols from the data server.

        Args:
            symbols: List of ticker symbols (e.g., ["SPY", "QQQ", "XLK"])

        Returns:
            Dictionary mapping symbol -> quote data
            Quote data includes: lastPrice, netChange, netPercentChangeInDouble, totalVolume
        """
        try:
            client = await self._get_client()
            symbols_str = ",".join(symbols)

            response = await client.get(f"/api/quotes", params={"symbols": symbols_str})
            response.raise_for_status()

            data = response.json()
            quotes = data.get("quotes", {})

            # Normalize the quote data
            result = {}
            for symbol, quote in quotes.items():
                # Try both field names for percent change (API varies)
                change_pct = quote.get("netPercentChange", 0) or quote.get("netPercentChangeInDouble", 0)
                result[symbol] = {
                    "symbol": symbol,
                    "price": quote.get("lastPrice", 0),
                    "change": quote.get("netChange", 0),
                    "change_pct": change_pct,
                    "volume": quote.get("totalVolume", 0),
                    "bid": quote.get("bidPrice", 0),
                    "ask": quote.get("askPrice", 0),
                    "timestamp": datetime.now().isoformat(),
                }

            return result

        except httpx.HTTPError as e:
            logger.error(f"HTTP error fetching quotes: {e}")
            return {}
        except Exception as e:
            logger.error(f"Error fetching quotes: {e}")
            return {}

    async def get_price_history(
        self,
        symbol: str,
        period_type: str = "month",
        period: int = 3,
        frequency_type: str = "daily",
        frequency: int = 1
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch price history (candles) for a symbol from the data server.

        Args:
            symbol: Ticker symbol
            period_type: "day", "month", "year", "ytd"
            period: Number of periods
            frequency_type: "minute", "daily", "weekly", "monthly"
            frequency: Frequency value (1, 5, 10, 15, 30 for minutes)

        Returns:
            Dictionary with "symbol" and "candles" keys
            Each candle has: datetime, open, high, low, close, volume
        """
        try:
            client = await self._get_client()

            response = await client.get(
                f"/api/history/{symbol}",
                params={
                    "period_type": period_type,
                    "period": period,
                    "frequency_type": frequency_type,
                    "frequency": frequency,
                }
            )
            response.raise_for_status()

            data = response.json()

            return {
                "symbol": data.get("symbol", symbol),
                "candles": data.get("candles", []),
            }

        except httpx.HTTPError as e:
            logger.error(f"HTTP error fetching history for {symbol}: {e}")
            return None
        except Exception as e:
            logger.error(f"Error fetching history for {symbol}: {e}")
            return None

    async def get_batch_history(
        self,
        symbols: List[str],
        period_type: str = "month",
        period: int = 3,
        frequency_type: str = "daily",
        frequency: int = 1
    ) -> Dict[str, List[Dict]]:
        """
        Fetch price history for multiple symbols in parallel.

        Args:
            symbols: List of ticker symbols
            period_type, period, frequency_type, frequency: Same as get_price_history

        Returns:
            Dictionary mapping symbol -> list of candles
        """
        history = {}
        for symbol in symbols:
            try:
                result = await self.get_price_history(
                    symbol, period_type, period, frequency_type, frequency
                )
                if result:
                    history[symbol] = result.get("candles", [])
                else:
                    history[symbol] = []
            except Exception as e:
                logger.error(f"Error fetching history for {symbol}: {e}")
                history[symbol] = []
            await asyncio.sleep(0.15)  # 150ms between calls — respect API pacing

        return history

    async def health_check(self) -> bool:
        """Check if the data server is reachable"""
        try:
            client = await self._get_client()
            response = await client.get("/health")
            return response.status_code == 200
        except Exception as e:
            logger.error(f"Data server health check failed: {e}")
            return False


# Singleton instance
_data_client: Optional[DataClient] = None


def get_data_client() -> DataClient:
    """Get the singleton data client instance"""
    global _data_client
    if _data_client is None:
        _data_client = DataClient()
    return _data_client


async def shutdown_data_client():
    """Shutdown the data client (call on app shutdown)"""
    global _data_client
    if _data_client:
        await _data_client.close()
        _data_client = None
