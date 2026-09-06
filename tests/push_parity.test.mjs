// P1.4 — JS güzgüsünün PARİTET testi (`src/lib/push.ts`).
//
// Niyə: `src/lib/push.ts` `backend/app/services/push_service.py` +
// `push_audience.py`-nin əl ilə yazılmış güzgüsüdür. Lokal rejimdə panel JS-dən
// sayır, backend rejimində serverdən. Güzgü səssizcə ayrılsa panel "128 alıcı"
// deyib server 30-a göndərər — P0.4 dürüstlük qaydasının ən sinsi pozulması.
//
// Halların cədvəli burada YAZILMIR: `tests/fixtures/push_parity.json` tək
// mənbədir və Python tərəfi (`backend/tests/test_push_parity.py`) EYNİ faylı
// oxuyur. Bir tərəf dəyişib digəri qalsa test sınır.
//
//   npm run test:parity
//
// (esbuild bundle -> tests/.build/push_parity.test.mjs -> node --test)
import test from 'node:test';
import assert from 'node:assert/strict';

import DATA from './fixtures/push_parity.json';
import {
  PUSH_SECRET_SENTINEL,
  audienceLabel,
  currentTierKey,
  isOneSignalSubscriptionId,
  maskToken,
  normalizeAudienceSpec,
  normalizePushSettings,
  pushAudienceSummary,
  pushSettingsResponse,
  resolveClientAppId,
  resolvePushAudience,
  resolvePushConfig,
  sanitizePushText,
} from '../src/lib/push';

const TIERS = DATA.tiers;
const NOW = DATA.now;
const label = (c) => String(c.name || JSON.stringify(c.input ?? c));

test('fixture reaches the JS side too (yol sınsa paritet itir)', () => {
  assert.ok(DATA.tokens.sub_a && DATA.now);
  assert.ok(Array.isArray(DATA.audience) && DATA.audience.length > 0);
});

test('normalizePushSettings parity', () => {
  for (const c of DATA.settings) {
    const out = normalizePushSettings(c.input);
    for (const [key, expected] of Object.entries(c.expect)) {
      assert.deepEqual(out[key], expected, `${label(c)} → ${key}`);
    }
  }
});

test('normalizePushSettings sentinel parity (__keep__ = açarı dəyişmə)', () => {
  const block = DATA.settings_sentinel;
  const patch = { onesignal_rest_api_key: PUSH_SECRET_SENTINEL };
  assert.equal(
    normalizePushSettings(patch, { current: block.current }).onesignal_rest_api_key,
    block.expect_with_current,
  );
  assert.equal(normalizePushSettings(patch).onesignal_rest_api_key, block.expect_without_current);
});

test('pushSettingsResponse: şəkil roldan asılı deyil, açar sızmır', () => {
  const hidden = pushSettingsResponse({ onesignal_rest_api_key: 'gizli' }, { reveal: false });
  const shown = pushSettingsResponse({ onesignal_rest_api_key: 'gizli' }, { reveal: true });
  assert.deepEqual(Object.keys(hidden).sort(), Object.keys(shown).sort());
  assert.equal(hidden.onesignal_rest_api_key, '');
  assert.equal(hidden.onesignal_rest_api_key_set, true);
  assert.equal(shown.onesignal_rest_api_key, 'gizli');
  assert.equal(pushSettingsResponse({}).onesignal_rest_api_key_set, false);
});

test('resolvePushConfig parity (qarışıq cüt heç vaxt qurulmur)', () => {
  for (const c of DATA.config) {
    const config = resolvePushConfig({
      tenantAppId: c.input.tenant_app_id,
      tenantRestKey: c.input.tenant_rest_key,
      platformAppId: c.input.platform_app_id,
      platformRestKey: c.input.platform_rest_key,
    });
    assert.equal(config.source, c.expect.source, label(c));
    assert.equal(config.app_id, c.expect.app_id, label(c));
    assert.equal(config.ok, c.expect.ok, label(c));
    const expectedReason =
      'reason_key' in c.expect ? DATA.reasons[c.expect.reason_key] : c.expect.reason;
    // Səbəb mətni hərfi eynidir: panel lokal və backend rejimində eyni izahı verir.
    assert.equal(config.reason, expectedReason, label(c));
  }
});

test('resolveClientAppId parity (SDK göndərici ilə eyni prioritet)', () => {
  for (const c of DATA.client_app_id) {
    assert.equal(resolveClientAppId(c.tenant, c.platform), c.expect, JSON.stringify(c));
  }
});

test('sanitizePushText parity', () => {
  for (const c of DATA.text) {
    const { title, body } = sanitizePushText(c.title, c.body);
    if ('expect_title' in c) assert.equal(title, c.expect_title);
    if ('expect_title_len' in c) assert.equal(title.length, c.expect_title_len);
    assert.equal(body, c.expect_body);
  }
});

test('maskToken parity', () => {
  for (const c of DATA.mask) assert.equal(maskToken(c.input), c.expect, JSON.stringify(c));
});

test('isOneSignalSubscriptionId parity (native cihaz tokeni abunəlik deyil)', () => {
  for (const c of DATA.subscription_id) {
    const token = c.upper ? String(c.input).toUpperCase() : c.input;
    assert.equal(isOneSignalSubscriptionId(token), c.expect, JSON.stringify(c));
  }
});

test('normalizeAudienceSpec parity (days heç vaxt 0 olmur)', () => {
  for (const c of DATA.audience_spec) {
    const out = normalizeAudienceSpec(c.input);
    for (const [key, expected] of Object.entries(c.expect)) {
      assert.equal(out[key], expected, `${label(c)} → ${key}`);
    }
  }
});

test('currentTierKey parity (operations._compute_tier qaydası)', () => {
  for (const c of DATA.tier_key) {
    const tiers = 'tiers' in c ? c.tiers : TIERS;
    assert.equal(currentTierKey(c.lifetime_stars, tiers), c.expect, JSON.stringify(c));
  }
});

test('audienceLabel parity', () => {
  for (const c of DATA.labels) {
    assert.equal(audienceLabel(c.spec, TIERS), c.expect, JSON.stringify(c.spec));
  }
});

test('resolvePushAudience parity (say pillələri ayrı)', () => {
  for (const c of DATA.audience) {
    const audience = resolvePushAudience(c.rows, c.spec, {
      now: NOW,
      tiers: TIERS,
      limit: c.limit || 0,
    });
    const actual = pushAudienceSummary(audience);
    for (const [key, expected] of Object.entries(c.expect)) {
      assert.equal(actual[key], expected, `${label(c)} → ${key}`);
    }
    // Token siyahısı yalnız `tokens`-dədir; xülasə onu daşımır.
    assert.equal('tokens' in actual, false, label(c));
    assert.equal(audience.tokens.length, audience.recipients, label(c));
  }
});

test('pushAudienceSummary açar dəsti Python `as_dict` ilə eynidir', () => {
  const summary = pushAudienceSummary(resolvePushAudience([], { segment: 'all' }, { now: NOW }));
  assert.deepEqual(Object.keys(summary).sort(), [
    'capped', 'label', 'matched', 'note', 'recipients', 'total', 'undeliverable', 'with_token',
  ]);
});
