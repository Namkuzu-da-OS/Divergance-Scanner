"""
WebSocket Handler for Real-Time Updates
Broadcasts rankings, divergences, rotations, and alerts to connected clients
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set, List, Any
import asyncio
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections and subscriptions"""

    def __init__(self):
        # Active connections
        self.active_connections: Set[WebSocket] = set()
        # Channel subscriptions: channel_name -> set of websockets
        self.subscriptions: Dict[str, Set[WebSocket]] = {
            "rankings": set(),
            "divergences": set(),
            "rotations": set(),
            "alerts": set(),
            "quotes": set(),
        }

    async def connect(self, websocket: WebSocket):
        """Accept a new WebSocket connection"""
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection"""
        self.active_connections.discard(websocket)
        # Remove from all subscriptions
        for channel in self.subscriptions.values():
            channel.discard(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")

    def subscribe(self, websocket: WebSocket, channel: str):
        """Subscribe a websocket to a channel"""
        if channel in self.subscriptions:
            self.subscriptions[channel].add(websocket)
            logger.debug(f"Subscribed to {channel}. Subscribers: {len(self.subscriptions[channel])}")

    def unsubscribe(self, websocket: WebSocket, channel: str):
        """Unsubscribe a websocket from a channel"""
        if channel in self.subscriptions:
            self.subscriptions[channel].discard(websocket)

    async def broadcast_to_channel(self, channel: str, data: Any):
        """Broadcast data to all subscribers of a channel"""
        if channel not in self.subscriptions:
            return

        message = json.dumps({
            "channel": channel,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        })

        disconnected = set()
        for websocket in self.subscriptions[channel]:
            try:
                await websocket.send_text(message)
            except Exception as e:
                logger.warning(f"Failed to send to websocket: {e}")
                disconnected.add(websocket)

        # Clean up disconnected sockets
        for ws in disconnected:
            self.disconnect(ws)

    async def send_personal_message(self, websocket: WebSocket, message: dict):
        """Send a message to a specific websocket"""
        try:
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.warning(f"Failed to send personal message: {e}")

    def get_stats(self) -> dict:
        """Get connection statistics"""
        return {
            "total_connections": len(self.active_connections),
            "subscriptions": {
                channel: len(subs) for channel, subs in self.subscriptions.items()
            }
        }


# Global connection manager
manager = ConnectionManager()


def get_connection_manager() -> ConnectionManager:
    """Get the global connection manager"""
    return manager


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates.

    Clients can subscribe to channels:
    - rankings: RS ranking updates
    - divergences: Divergence signal updates
    - rotations: Rotation signal updates
    - alerts: New alerts
    - quotes: Price quote updates

    Message format:
    - Subscribe: {"action": "subscribe", "channel": "rankings"}
    - Unsubscribe: {"action": "unsubscribe", "channel": "rankings"}
    - Ping: {"action": "ping"}
    """
    await manager.connect(websocket)

    try:
        while True:
            try:
                # Receive message with timeout
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=60.0  # 1 minute timeout
                )

                try:
                    message = json.loads(data)
                    action = message.get("action", "")

                    if action == "subscribe":
                        channel = message.get("channel", "")
                        if channel:
                            manager.subscribe(websocket, channel)
                            await manager.send_personal_message(websocket, {
                                "type": "subscribed",
                                "channel": channel,
                            })

                    elif action == "unsubscribe":
                        channel = message.get("channel", "")
                        if channel:
                            manager.unsubscribe(websocket, channel)
                            await manager.send_personal_message(websocket, {
                                "type": "unsubscribed",
                                "channel": channel,
                            })

                    elif action == "ping":
                        await manager.send_personal_message(websocket, {
                            "type": "pong",
                            "timestamp": datetime.now().isoformat(),
                        })

                    elif action == "stats":
                        await manager.send_personal_message(websocket, {
                            "type": "stats",
                            "data": manager.get_stats(),
                        })

                except json.JSONDecodeError:
                    await manager.send_personal_message(websocket, {
                        "type": "error",
                        "message": "Invalid JSON",
                    })

            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                try:
                    await websocket.send_text(json.dumps({
                        "type": "ping",
                        "timestamp": datetime.now().isoformat(),
                    }))
                except:
                    break

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected normally")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        manager.disconnect(websocket)
