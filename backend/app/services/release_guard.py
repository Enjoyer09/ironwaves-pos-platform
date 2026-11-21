"""Temporary write gate used while a release is verified against live data."""
from starlette.responses import JSONResponse


class ReleaseReadOnlyMiddleware:
    def __init__(self, app, enabled=False):
        self.app = app
        self.enabled = bool(enabled)

    async def __call__(self, scope, receive, send):
        if not self.enabled or scope['type'] != 'http':
            return await self.app(scope, receive, send)
        if scope['method'].upper() not in {'GET', 'HEAD', 'OPTIONS'}:
            response = JSONResponse(
                status_code=503,
                content={'detail': 'Yenilənmə yoxlanılır. Əməliyyat saxlanılmadı; bir az sonra yenidən cəhd edin.'},
                headers={'Retry-After': '30', 'X-Release-Read-Only': '1'},
            )
            return await response(scope, receive, send)
        async def mark_response(message):
            if message['type'] == 'http.response.start':
                message = dict(message)
                message['headers'] = list(message.get('headers', [])) + [(b'x-release-read-only', b'1')]
            await send(message)
        return await self.app(scope, receive, mark_response)
