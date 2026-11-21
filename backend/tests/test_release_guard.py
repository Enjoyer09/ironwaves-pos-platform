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


@pytest.mark.asyncio
async def test_release_readonly_startup_does_not_run_background_or_seed_writers(monkeypatch):
    from app import main
    monkeypatch.setattr(main.settings, 'release_read_only', True)
    monkeypatch.setattr(main.settings, 'startup_create_all_enabled', False)
    monkeypatch.setattr(main, '_assert_redis_available_for_production', lambda: None)
    monkeypatch.setattr(main, '_assert_demo_seed_safety', lambda: None)
    monkeypatch.setattr(main, '_schema_ready_for_current_version', lambda: True)
    monkeypatch.setattr(main.realtime_hub, 'set_loop', lambda loop: None)
    def forbidden(*args, **kwargs):
        raise AssertionError('Read-only release must not run a writer')
    for name in ['_run_data_retention_cleanup', '_start_retention_scheduler', '_seed_initial_data', '_seed_demo_tenant', '_repair_customer_discounts',
                 'start_background_agent', 'start_backup_scheduler', 'start_birthday_scheduler', 'start_push_scheduler', 'start_gl_shadow_scheduler']:
        monkeypatch.setattr(main, name, forbidden)
    await main.on_startup()
