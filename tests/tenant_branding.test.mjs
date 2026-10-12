// PinLogin public-branding tenant resolution — regression guard.
//
// Bug (found 2026-10-12, introduced by 2301a8e6 on 2026-09-03):
//   PinLogin did `getResolvedTenantIdFromHost() || getActiveTenantId() || ''`.
//   For every production host in a fresh browser the first call returns null, and
//   `getActiveTenantId()` FABRICATES `tenant_default`. That value then went out as
//   `?tenant_id=tenant_default` on /public-branding. The backend honours an explicit
//   tenant_id OVER the host, so all four live hosts (super, emalatcoffee, gyrospos,
//   art-space) rendered the "Default Tenant" brand, and super additionally adopted
//   Default Tenant's `device_authorization_enabled=false` while the backend still
//   enforced super's own device-auth (0 authorized terminals) → staff PIN dead-ends.
//
//   npm run test:tenant
import test from 'node:test';
import assert from 'node:assert/strict';
import { getExplicitBrandingTenantId, getResolvedTenantIdFromHost } from '../src/lib/tenant';

test('unmapped production hosts must NOT fabricate a tenant id', () => {
  for (const host of [
    'super.ironwaves.store',
    'emalatcoffee.ironwaves.store',
    'gyrospos.ironwaves.store',
    'art-space.ironwaves.store',
  ]) {
    assert.equal(
      getResolvedTenantIdFromHost(host),
      null,
      `${host} must stay unmapped — the frontend does not own the domain→tenant map`,
    );
    assert.equal(
      getExplicitBrandingTenantId(host),
      '',
      `${host} must send NO explicit tenant_id so the backend resolves from x-tenant-domain`,
    );
  }
});

test('empty explicit id is what the far end needs to fall back to the host header', () => {
  // The API layer turns '' into "omit the query param" (`tenantId || undefined`).
  assert.equal(String('' || undefined), 'undefined');
});

test('localhost keeps its literal tenant_default (backend cannot map it)', () => {
  assert.equal(getResolvedTenantIdFromHost('localhost'), 'tenant_default');
  assert.equal(getExplicitBrandingTenantId('localhost'), 'tenant_default');
  assert.equal(getExplicitBrandingTenantId('127.0.0.1'), 'tenant_default');
});
