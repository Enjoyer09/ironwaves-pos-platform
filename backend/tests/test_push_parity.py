"""P1.4 — Python ↔ JS **paritet** testi (tək fixture, iki icraçı).

Niyə lazımdır: `src/lib/push.ts` `app/services/push_service.py` +
`push_audience.py`-nin **əl ilə yazılmış güzgüsüdür**. Lokal rejimdə panel JS
güzgüsündən sayır, backend rejimində serverdən. Güzgü səssizcə ayrılsa panel
"128 alıcı" deyib backend 30-a göndərər və heç bir test sınmaz — P0.4 dürüstlük
qaydasının ən sinsi pozulması.

Ona görə halların cədvəli koda YAZILMIR, `tests/fixtures/push_parity.json`-dadır
və iki tərəf onu oxuyur:

    Python: bu fayl
    JS:     tests/push_parity.test.mjs  (`npm run test:parity`)

Yeni hal əlavə edəndə yalnız JSON redaktə olunur; hər iki test dərhal onu yoxlayır.
Bir tərəf dəyişib digəri qalsa test sınır — güzgünün sürüşməsi görünən olur.
"""

import json
from pathlib import Path

import pytest

from app.services.push_audience import (
    audience_label,
    current_tier_key,
    normalize_audience_spec,
    resolve_push_audience,
)
from app.services.push_service import (
    PUSH_SECRET_SENTINEL,
    is_onesignal_subscription_id,
    mask_token,
    normalize_push_settings,
    resolve_client_app_id,
    resolve_push_config,
    sanitize_push_text,
)

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "push_parity.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))
TIERS = DATA["tiers"]
NOW = DATA["now"]


def ids(cases):
    """Test adında fixture-un `name`/`input` sahəsi görünsün."""
    return [str(c.get("name") or c.get("input") or c) for c in cases]


def test_fixture_is_reachable_from_backend():
    """Fixture repo kökündədir (JS testi də oradan oxuyur) — yol sınsa hər iki
    tərəf öz cədvəlini yazmağa başlayar, paritet itir."""
    assert FIXTURE.is_file()
    assert DATA["tokens"]["sub_a"] and DATA["now"]


@pytest.mark.parametrize("case", DATA["settings"], ids=ids(DATA["settings"]))
def test_settings_parity(case):
    out = normalize_push_settings(case["input"])
    for key, expected in case["expect"].items():
        assert out[key] == expected, key


def test_settings_sentinel_parity():
    block = DATA["settings_sentinel"]
    patch = {"onesignal_rest_api_key": PUSH_SECRET_SENTINEL}
    assert normalize_push_settings(patch, current=block["current"])["onesignal_rest_api_key"] == block["expect_with_current"]
    assert normalize_push_settings(patch)["onesignal_rest_api_key"] == block["expect_without_current"]


@pytest.mark.parametrize("case", DATA["config"], ids=ids(DATA["config"]))
def test_config_parity(case):
    config = resolve_push_config(**case["input"])
    expect = case["expect"]
    assert config.source == expect["source"]
    assert config.app_id == expect["app_id"]
    assert config.ok is expect["ok"]
    if "reason_key" in expect:
        # Səbəb mətni İKİ tərəfdə hərfi eynidir — panel lokal və backend rejimində
        # eyni izahı göstərməlidir.
        assert config.reason == DATA["reasons"][expect["reason_key"]]
    else:
        assert config.reason == expect["reason"]


@pytest.mark.parametrize("case", DATA["client_app_id"], ids=ids(DATA["client_app_id"]))
def test_client_app_id_parity(case):
    assert resolve_client_app_id(case["tenant"], case["platform"]) == case["expect"]


@pytest.mark.parametrize("case", DATA["text"], ids=ids(DATA["text"]))
def test_text_parity(case):
    title, body = sanitize_push_text(case["title"], case["body"])
    if "expect_title" in case:
        assert title == case["expect_title"]
    if "expect_title_len" in case:
        assert len(title) == case["expect_title_len"]
    assert body == case["expect_body"]


@pytest.mark.parametrize("case", DATA["mask"], ids=ids(DATA["mask"]))
def test_mask_parity(case):
    assert mask_token(case["input"]) == case["expect"]


@pytest.mark.parametrize("case", DATA["subscription_id"], ids=ids(DATA["subscription_id"]))
def test_subscription_id_parity(case):
    token = case["input"].upper() if case.get("upper") else case["input"]
    assert is_onesignal_subscription_id(token) is case["expect"]


@pytest.mark.parametrize("case", DATA["audience_spec"], ids=ids(DATA["audience_spec"]))
def test_audience_spec_parity(case):
    out = normalize_audience_spec(case["input"])
    for key, expected in case["expect"].items():
        assert out[key] == expected, key


@pytest.mark.parametrize("case", DATA["tier_key"], ids=ids(DATA["tier_key"]))
def test_tier_key_parity(case):
    tiers = case["tiers"] if "tiers" in case else TIERS
    assert current_tier_key(case["lifetime_stars"], tiers) == case["expect"]


@pytest.mark.parametrize("case", DATA["labels"], ids=ids(DATA["labels"]))
def test_label_parity(case):
    assert audience_label(case["spec"], TIERS) == case["expect"]


@pytest.mark.parametrize("case", DATA["audience"], ids=ids(DATA["audience"]))
def test_audience_parity(case):
    audience = resolve_push_audience(
        case["rows"],
        case["spec"],
        now=NOW,
        tiers=TIERS,
        limit=case.get("limit") or 0,
    )
    actual = audience.as_dict()
    for key, expected in case["expect"].items():
        assert actual[key] == expected, f"{case['name']} → {key}"


def test_audience_dict_keys_match_the_js_mirror():
    """`pushAudienceSummary` (JS) ilə eyni açar dəsti — panel ikisini bir kimi oxuyur."""
    keys = set(resolve_push_audience([], {"segment": "all"}, now=NOW).as_dict())
    assert keys == {"recipients", "matched", "with_token", "undeliverable", "capped", "total", "label", "note"}
