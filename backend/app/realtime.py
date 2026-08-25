import asyncio
from collections import defaultdict
import logging
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

logger = logging.getLogger("ironwaves.realtime")


class TenantRealtimeHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def get_loop(self) -> asyncio.AbstractEventLoop | None:
        if self._loop and self._loop.is_running():
            return self._loop
        try:
            return asyncio.get_running_loop()
        except RuntimeError:
            return None

    def _tenant_lock(self, tenant_id: str) -> asyncio.Lock:
        return self._locks[tenant_id]

    async def connect(self, tenant_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._tenant_lock(tenant_id):
            self._connections[tenant_id].add(websocket)

    async def disconnect(self, tenant_id: str, websocket: WebSocket) -> None:
        async with self._tenant_lock(tenant_id):
            sockets = self._connections.get(tenant_id)
            if not sockets:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(tenant_id, None)
                self._locks.pop(tenant_id, None)

    async def _safe_send(self, socket: WebSocket, message: dict) -> bool:
        try:
            await asyncio.wait_for(socket.send_json(message), timeout=0.8)
            return True
        except Exception:
            return False

    async def _safe_close(self, socket: WebSocket) -> None:
        try:
            await asyncio.wait_for(socket.close(), timeout=0.3)
        except Exception:
            pass

    async def broadcast(self, tenant_id: str, event: str, payload: dict[str, Any] | None = None) -> None:
        async with self._tenant_lock(tenant_id):
            sockets = list(self._connections.get(tenant_id, set()))
        if not sockets:
            return
        message = {
            "event": event,
            "tenant_id": tenant_id,
            "payload": payload or {},
        }
        # Send concurrently to all sockets with strict per-socket timeout so a slow client never blocks others
        results = await asyncio.gather(*(self._safe_send(s, message) for s in sockets), return_exceptions=True)
        stale: list[WebSocket] = []
        for socket, success in zip(sockets, results):
            if success is not True:
                stale.append(socket)
        if stale:
            await asyncio.gather(*(self._safe_close(s) for s in stale), return_exceptions=True)
            for socket in stale:
                await self.disconnect(tenant_id, socket)


realtime_hub = TenantRealtimeHub()


async def broadcast_tenant_event(tenant_id: str, event: str, payload: dict[str, Any] | None = None) -> None:
    if not tenant_id:
        return
    await realtime_hub.broadcast(tenant_id, event, payload)


def emit_realtime_sync(tenant_id: str, event: str, payload: dict[str, Any] | None = None) -> None:
    """Non-blocking fire-and-forget emission from synchronous route worker threads."""
    if not tenant_id:
        return
    loop = realtime_hub.get_loop()
    if loop and loop.is_running():
        try:
            asyncio.run_coroutine_threadsafe(broadcast_tenant_event(tenant_id, event, payload), loop)
            return
        except Exception:
            pass
    try:
        from anyio import from_thread
        from_thread.run(broadcast_tenant_event, tenant_id, event, payload or {})
    except Exception:
        pass

