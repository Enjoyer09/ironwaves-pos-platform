import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.services.release_guard import ReleaseReadOnlyMiddleware


@pytest.mark.parametrize('enabled', [True, False])
def test_release_gate_preserves_reads_and_blocks_mutations(enabled):
    app = FastAPI()
    app.add_middleware(ReleaseReadOnlyMiddleware, enabled=enabled)
    app.state.writes = 0
    @app.get('/health')
    def health():
        return {'status': 'ok'}
    @app.api_route('/write', methods=['POST','PUT','PATCH','DELETE'])
    def write():
        app.state.writes += 1
        return {'saved': True}
    client = TestClient(app)
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}
    if enabled:
        assert response.headers['X-Release-Read-Only'] == '1'
    for method in ['POST','PUT','PATCH','DELETE']:
        response = client.request(method, '/write')
        assert response.status_code == (503 if enabled else 200)
        if enabled:
            assert response.headers['Retry-After'] == '30'
    assert app.state.writes == (0 if enabled else 4)
