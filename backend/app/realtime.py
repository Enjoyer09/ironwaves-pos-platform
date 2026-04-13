import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect


class TenantRealtimeHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

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
        stale: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(message)
            except WebSocketDisconnect:
                stale.append(socket)
            except Exception:
                stale.append(socket)
        for socket in stale:
            try:
                await socket.close()
            except Exception:
                pass
            await self.disconnect(tenant_id, socket)


realtime_hub = TenantRealtimeHub()


async def broadcast_tenant_event(tenant_id: str, event: str, payload: dict[str, Any] | None = None) -> None:
    if not tenant_id:
        return
    await realtime_hub.broadcast(tenant_id, event, payload)
