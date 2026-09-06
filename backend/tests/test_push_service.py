"""P1.4 — push nüvəsinin saf funksiyaları (`app/services/push_service.py`).

Niyə bu testlər: modul push-un **bütün** yollarının altındadır — satışdan sonrakı
ulduz bildirişi (`pos.py`), ad günü scheduleri, sifariş statusu
(`operations.py::_notify_customer_push`), panelin test və kütləvi göndərməsi.
Burada səhv olsa hər dörd yol birdən susur və ya səhv adama gedir.

Üç qayda qəsdən kilidlənir, çünki səssiz dəyişsə real ziyan verir:

  1. **Qarışıq cüt heç vaxt qurulmur.** Tenant `app_id` + platforma REST açarı
     (və ya tərsi) OneSignal-da `invalid_player_ids` verir, çünki abunəlik id-si
     başqa app-a aiddir. `resolve_push_config` belə halda `source="none"` və
     insan-oxunaqlı səbəb qaytarır — köhnə göndərici bu səhvi udub susurdu.
  2. **Cavabın şəkli roldan asılı deyil.** `push_settings_response` `reveal=False`
     olanda açarı boşaldır, amma `..._set` bayrağını HƏMİŞƏ verir; yoxsa manager
     "konfiqurasiya yoxdur" deyə səhv diaqnoz qoyar.
  3. **`send_onesignal` heç vaxt exception atmır və heç vaxt yalan demir.** Nə
     qədər cəhd, nə qədər qəbul, nə qədər uğursuz — hamısı ayrıdır (`skipped`
     uğur DEYİL).

Fayl yalnız saf funksiyaları import edir (DB, HTTP, auth yoxdur); şəbəkə
`transport` inyeksiyası ilə əvəz olunur. JS güzgüsü `src/lib/push.ts`-dədir və
`tests/crm_local_smoke.test.mjs` onu eyni girişlərlə yoxlayır.
"""

import json

import pytest

from app.services.push_service import (
    DEFAULT_BROADCAST_DAILY_LIMIT,
    DEFAULT_PUSH_SETTINGS,
    MAX_BROADCAST_DAILY_LIMIT,
    MAX_PUSH_BODY,
    MAX_PUSH_TITLE,
    ONESIGNAL_URL,
    PUSH_BATCH_SIZE,
    PUSH_SECRET_SENTINEL,
    PushConfig,
    PushResult,
    build_onesignal_payload,
    chunk_tokens,
    dedupe_tokens,
    is_onesignal_subscription_id,
    mask_token,
    normalize_push_settings,
    push_settings_response,
    resolve_client_app_id,
    resolve_push_config,
    sanitize_push_text,
    send_onesignal,
    split_deliverable_tokens,
)

SUB_A = "11111111-1111-4111-8111-111111111111"
SUB_B = "22222222-2222-4222-8222-222222222222"
#: Native APNs cihaz tokeni — 64 hex simvol, defis YOX.
NATIVE_TOKEN = "a" * 64

# ---------------------------------------------------------------------------
# normalize_push_settings
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", [None, {}, [], "", 0, "zibil"])
def test_normalize_returns_defaults_for_any_garbage(value):
    """Blob köhnə backup-dan gələ bilər — normalizer exception atmamalıdır."""
    assert normalize_push_settings(value) == DEFAULT_PUSH_SETTINGS


def test_normalize_keeps_zero_daily_limit():
    """`0` qanuni dəyərdir: kütləvi bildirişi TAM bağlamaq üçün yazılır.

    `x or default` işlədilsəydi 0 səssizcə 3-ə qayıdardı və admin bağladığını
    düşünüb bildiriş göndərilməyə davam edərdi.
    """
    assert normalize_push_settings({"broadcast_daily_limit": 0})["broadcast_daily_limit"] == 0


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (999, MAX_BROADCAST_DAILY_LIMIT),
        (-5, 0),
        ("7", 7),
        ("7.9", 7),
        (None, DEFAULT_BROADCAST_DAILY_LIMIT),
        ("", DEFAULT_BROADCAST_DAILY_LIMIT),
        (True, DEFAULT_BROADCAST_DAILY_LIMIT),
        (float("inf"), DEFAULT_BROADCAST_DAILY_LIMIT),
    ],
)
def test_normalize_clamps_daily_limit(raw, expected):
    assert normalize_push_settings({"broadcast_daily_limit": raw})["broadcast_daily_limit"] == expected


def test_normalize_sentinel_keeps_previous_secret():
    """`__keep__` = "açarı dəyişmə". Panel sirri geri göndərmədən PATCH edə bilsin."""
    current = {"onesignal_rest_api_key": "köhnə-açar"}
    merged = normalize_push_settings({"onesignal_rest_api_key": PUSH_SECRET_SENTINEL}, current=current)
    assert merged["onesignal_rest_api_key"] == "köhnə-açar"


def test_normalize_sentinel_without_current_is_empty():
    """`current` verilməyibsə sentinel uydurulmuş açara çevrilməməlidir."""
    assert normalize_push_settings({"onesignal_rest_api_key": PUSH_SECRET_SENTINEL})["onesignal_rest_api_key"] == ""


def test_normalize_trims_and_caps_secret():
    long_key = "  " + ("k" * 500) + "  "
    assert normalize_push_settings({"onesignal_rest_api_key": long_key})["onesignal_rest_api_key"] == "k" * 200

def test_normalize_coerces_flags_to_bool():
    out = normalize_push_settings({"enabled": "yes", "event_push_enabled": 0, "broadcast_enabled": []})
    assert out["enabled"] is True
    assert out["event_push_enabled"] is False
    assert out["broadcast_enabled"] is False


# ---------------------------------------------------------------------------
# push_settings_response — sirrin dövriyyəsi
# ---------------------------------------------------------------------------


def test_response_hides_secret_but_keeps_set_flag():
    out = push_settings_response({"onesignal_rest_api_key": "gizli"}, reveal=False)
    assert out["onesignal_rest_api_key"] == ""
    assert out["onesignal_rest_api_key_set"] is True


def test_response_reveals_secret_when_allowed():
    out = push_settings_response({"onesignal_rest_api_key": "gizli"}, reveal=True)
    assert out["onesignal_rest_api_key"] == "gizli"
    assert out["onesignal_rest_api_key_set"] is True


def test_response_shape_is_identical_for_both_roles():
    """Sxem roldan asılı olmamalıdır — frontend iki fərqli forma saxlamır."""
    hidden = push_settings_response({"onesignal_rest_api_key": "gizli"}, reveal=False)
    shown = push_settings_response({"onesignal_rest_api_key": "gizli"}, reveal=True)
    assert set(hidden) == set(shown)


def test_response_set_flag_false_when_empty():
    out = push_settings_response({}, reveal=False)
    assert out["onesignal_rest_api_key_set"] is False


# ---------------------------------------------------------------------------
# resolve_push_config — P1.4-ün əsl düyünü
# ---------------------------------------------------------------------------


def test_config_tenant_pair_wins():
    config = resolve_push_config(
        tenant_app_id="app-t", tenant_rest_key="key-t",
        platform_app_id="app-p", platform_rest_key="key-p",
    )
    assert (config.source, config.app_id, config.rest_api_key) == ("tenant", "app-t", "key-t")
    assert config.ok is True
    assert config.reason == ""

def test_config_never_mixes_tenant_app_with_platform_key():
    """Yarımçıq tenant cütü platforma açarı ilə TAMAMLANMIR.

    Abunəliklər tenant-ın app-ında yaranıb; platforma açarı ilə göndərmə
    OneSignal tərəfindən `invalid_player_ids` ilə rədd edilir. Ona görə
    `app_id` **qəsdən boşalır** — panel "yarım konfiqurasiya var" deyə
    aldanmasın.
    """
    config = resolve_push_config(
        tenant_app_id="app-t", tenant_rest_key="",
        platform_app_id="app-p", platform_rest_key="key-p",
    )
    assert config.source == "none"
    assert config.ok is False
    assert config.app_id == ""
    assert "REST API açarı" in config.reason


def test_config_tenant_key_without_app_falls_back_with_warning():
    """Açar var, App ID yoxdur → platforma işləyir, amma səbəb xəbərdarlıq verir."""
    config = resolve_push_config(
        tenant_app_id="", tenant_rest_key="key-t",
        platform_app_id="app-p", platform_rest_key="key-p",
    )
    assert config.source == "platform"
    assert config.ok is True
    assert config.app_id == "app-p"
    assert "App ID" in config.reason


def test_config_platform_only_is_silent():
    config = resolve_push_config(
        tenant_app_id=None, tenant_rest_key=None,
        platform_app_id="app-p", platform_rest_key="key-p",
    )
    assert (config.source, config.reason, config.ok) == ("platform", "", True)


def test_config_nothing_configured_explains_itself():
    config = resolve_push_config(tenant_app_id="", tenant_rest_key="")
    assert config.source == "none"
    assert config.ok is False
    assert "konfiqurasiya edilməyib" in config.reason


def test_config_whitespace_only_counts_as_empty():
    config = resolve_push_config(tenant_app_id="   ", tenant_rest_key="\t\n")
    assert config.source == "none"

@pytest.mark.parametrize(
    ("tenant", "platform", "expected"),
    [("app-t", "app-p", "app-t"), ("", "app-p", "app-p"), (None, None, ""), ("  ", "app-p", "app-p")],
)
def test_client_app_id_follows_the_same_priority(tenant, platform, expected):
    """SDK-nın init etdiyi app id göndərici ilə EYNİ prioritetdə olmalıdır.

    Fərqli olsa abunəlik bir app-da yaranır, göndərmə başqasına gedir — bildiriş
    heç vaxt çatmır və heç bir səhv görünmür.
    """
    assert resolve_client_app_id(tenant, platform) == expected


# ---------------------------------------------------------------------------
# Mətn və token köməkçiləri
# ---------------------------------------------------------------------------


def test_sanitize_collapses_whitespace_and_truncates():
    title, body = sanitize_push_text("  Salam\n\n dostlar  ", "x" * 400)
    assert title == "Salam dostlar"
    assert len(body) == MAX_PUSH_BODY


def test_sanitize_title_limit():
    title, _ = sanitize_push_text("t" * 200, "mətn")
    assert len(title) == MAX_PUSH_TITLE


@pytest.mark.parametrize(("raw", "expected"), [("", ""), ("qısa", "***"), ("12345678", "***")])
def test_mask_token_hides_short_values(raw, expected):
    assert mask_token(raw) == expected


def test_mask_token_keeps_only_edges():
    assert mask_token(SUB_A) == "1111…1111"


def test_dedupe_keeps_order_and_drops_blanks():
    assert dedupe_tokens([SUB_A, "  ", None, SUB_B, SUB_A, ""]) == [SUB_A, SUB_B]


def test_chunk_tokens_zero_size_falls_back_to_default_batch():
    """`size=0` "batch yoxdur" demək deyil — default batch ölçüsünə qayıdır."""
    assert chunk_tokens(["a", "b"], size=0) == [["a", "b"]]
    assert PUSH_BATCH_SIZE > 1


@pytest.mark.parametrize("size", [-5, -1])
def test_chunk_tokens_never_loops_forever_on_negative_size(size):
    """Mənfi step `range` ilə sonsuz dövrə və ya boş nəticə verərdi — 1-ə qalxır."""
    assert chunk_tokens(["a", "b"], size=size) == [["a"], ["b"]]


def test_chunk_tokens_splits_evenly():
    assert chunk_tokens(["a", "b", "c"], size=2) == [["a", "b"], ["c"]]

# ---------------------------------------------------------------------------
# Token təsnifatı — §3.6 defektinin kilidi
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("token", [SUB_A, SUB_B, SUB_A.upper()])
def test_subscription_id_accepts_uuid_forms(token):
    assert is_onesignal_subscription_id(token) is True


@pytest.mark.parametrize(
    "token",
    [
        None,
        "",
        "   ",
        NATIVE_TOKEN,                       # native APNs cihaz tokeni
        SUB_A.replace("-", ""),             # defissiz 32 simvol
        SUB_A[:-1] + "z",                   # hex olmayan simvol
        "1111111-11111-4111-8111-111111111111",  # düzgün uzunluq, səhv bölgü
        SUB_A + "1",                        # 37 simvol
    ],
)
def test_subscription_id_rejects_everything_else(token):
    assert is_onesignal_subscription_id(token) is False


def test_split_separates_native_tokens_without_dropping_them():
    """Native cihaz tokeni **silinmir**, ayrı yığına düşür.

    `Customer.push_token` tək sütundur və brauzer SDK-sı abunəlik id-si, native
    tətbiq isə APNs/FCM cihaz tokeni yazır. `include_subscription_ids` ikincisini
    qəbul etmir. Sayı gizlətmək dürüst olmazdı — panel "N nəfər çatdırıla bilməz"
    deyə bilsin (`docs/CUSTOMER_APP_SETTINGS_AUDIT.md` §3.6).
    """
    deliverable, undeliverable = split_deliverable_tokens([SUB_A, NATIVE_TOKEN, SUB_B, "zibil"])
    assert deliverable == [SUB_A, SUB_B]
    assert undeliverable == [NATIVE_TOKEN, "zibil"]


def test_split_dedupes_before_classifying():
    deliverable, undeliverable = split_deliverable_tokens([SUB_A, SUB_A, NATIVE_TOKEN, NATIVE_TOKEN, None, "  "])
    assert (deliverable, undeliverable) == ([SUB_A], [NATIVE_TOKEN])


# ---------------------------------------------------------------------------
# build_onesignal_payload
# ---------------------------------------------------------------------------

CONFIG = PushConfig(app_id="app-1", rest_api_key="key-1", source="tenant")


def test_payload_has_azerbaijani_content_alongside_english():
    """`contents` həm `en`, həm `az` daşıyır.

    OneSignal `en` olmayanda bütün bildirişi rədd edir, amma cihaz dili `az`
    olanda `az` göstərilir — ikisi birlikdə yazılır.
    """
    payload = build_onesignal_payload(CONFIG, [SUB_A], "Başlıq", "Mətn")
    assert payload["contents"] == {"en": "Mətn", "az": "Mətn"}
    assert payload["headings"] == {"en": "Başlıq", "az": "Başlıq"}
    assert payload["app_id"] == "app-1"
    assert payload["include_subscription_ids"] == [SUB_A]


def test_payload_omits_headings_when_title_empty():
    """Boş `headings` OneSignal-da başlıqsız yerinə **səhv** verir."""
    assert "headings" not in build_onesignal_payload(CONFIG, [SUB_A], "", "Mətn")


@pytest.mark.parametrize("raw_url", ["", "   ", "http://ironwaves.store", "javascript:alert(1)", "/menu"])
def test_payload_drops_non_https_url(raw_url):
    """Yalnız `https://` keçir — `http` və sxem olmayan dəyər açıq yönləndirmədir."""
    assert "url" not in build_onesignal_payload(CONFIG, [SUB_A], "T", "B", url=raw_url)


def test_payload_keeps_https_url_and_data():
    payload = build_onesignal_payload(
        CONFIG, [SUB_A], "T", "B", url=" https://ironwaves.store/menu ", data={"kind": "reward"}
    )
    assert payload["url"] == "https://ironwaves.store/menu"
    assert payload["data"] == {"kind": "reward"}


# ---------------------------------------------------------------------------
# send_onesignal — transport inyeksiyası ilə
# ---------------------------------------------------------------------------


class FakeTransport:
    """`transport(url, body, headers, timeout) -> (status, dict)` imitasiyası.

    Şəbəkəyə çıxmır; hər çağırışın gövdəsini saxlayır ki, batching və payload
    yoxlanıla bilsin.
    """

    def __init__(self, *responses, raises: BaseException | None = None):
        self.responses = list(responses)
        self.raises = raises
        self.calls: list[dict] = []

    def __call__(self, url, body, headers, timeout):
        self.calls.append(
            {"url": url, "payload": json.loads(body.decode("utf-8")), "headers": dict(headers), "timeout": timeout}
        )
        if self.raises is not None:
            raise self.raises
        return self.responses.pop(0) if self.responses else (200, {"id": "n-1", "recipients": 1})


def test_send_skips_when_config_not_ok_and_never_calls_transport():
    transport = FakeTransport()
    result = send_onesignal(PushConfig(source="none", reason="səbəb"), [SUB_A], "T", "B", transport=transport)
    assert result.status == "skipped"
    assert result.ok is False          # `skipped` UĞUR DEYİL
    assert result.error == "səbəb"
    assert transport.calls == []


def test_send_skips_on_empty_body():
    transport = FakeTransport()
    result = send_onesignal(CONFIG, [SUB_A], "Başlıq", "   ", transport=transport)
    assert (result.status, transport.calls) == ("skipped", [])
    assert "mətni boşdur" in result.error


def test_send_skips_when_no_recipients():
    transport = FakeTransport()
    result = send_onesignal(CONFIG, ["", None, "  "], "T", "B", transport=transport)
    assert result.status == "skipped"
    assert result.attempted == 0
    assert transport.calls == []


def test_send_marks_sent_and_uses_basic_auth():
    transport = FakeTransport((200, {"id": "notif-1", "recipients": 2}))
    result = send_onesignal(CONFIG, [SUB_A, SUB_B], "T", "B", transport=transport)
    assert (result.status, result.attempted, result.accepted, result.failed) == ("sent", 2, 2, 0)
    assert result.provider_ids == ["notif-1"]
    assert transport.calls[0]["headers"]["Authorization"] == "Basic key-1"
    assert transport.calls[0]["url"] == ONESIGNAL_URL


def test_send_counts_accepted_when_recipients_field_missing():
    """OneSignal bəzən `recipients` qaytarmır; `id` varsa batch qəbul sayılır.

    Əks halda uğurlu göndərmə `failed` kimi jurnala düşür və panel yalan danışır.
    """
    transport = FakeTransport((200, {"id": "notif-1"}))
    result = send_onesignal(CONFIG, [SUB_A, SUB_B], "T", "B", transport=transport)
    assert (result.status, result.accepted) == ("sent", 2)


def test_send_subtracts_invalid_ids_from_the_optimistic_count():
    transport = FakeTransport((200, {"id": "notif-1", "errors": {"invalid_player_ids": [SUB_B]}}))
    result = send_onesignal(CONFIG, [SUB_A, SUB_B], "T", "B", transport=transport)
    assert result.invalid_tokens == [SUB_B]
    assert (result.status, result.accepted, result.failed) == ("partial", 1, 1)


def test_send_partial_when_only_some_accepted():
    transport = FakeTransport((200, {"id": "notif-1", "recipients": 1}))
    result = send_onesignal(CONFIG, [SUB_A, SUB_B], "T", "B", transport=transport)
    assert (result.status, result.accepted, result.failed, result.ok) == ("partial", 1, 1, True)


def test_send_failed_on_http_error_records_status_code():
    transport = FakeTransport((403, {"errors": ["Invalid app_id"]}))
    result = send_onesignal(CONFIG, [SUB_A], "T", "B", transport=transport)
    assert (result.status, result.accepted, result.failed) == ("failed", 0, 1)
    assert "Invalid app_id" in result.error
    assert "HTTP 403" in result.error


def test_send_never_raises_when_transport_explodes():
    """Şəbəkə partlayanda satış axını dayanmamalıdır — səhv nəticəyə yazılır."""
    transport = FakeTransport(raises=RuntimeError("socket qopdu"))
    result = send_onesignal(CONFIG, [SUB_A], "T", "B", transport=transport)
    assert result.status == "failed"
    assert "transport xətası" in result.error
    assert "socket qopdu" in result.error


def test_send_batches_and_aggregates():
    transport = FakeTransport(
        (200, {"id": "n-1", "recipients": 1}),
        (200, {"id": "n-2", "recipients": 1}),
    )
    result = send_onesignal(CONFIG, [SUB_A, SUB_B], "T", "B", transport=transport, batch_size=1)
    assert len(transport.calls) == 2
    assert [c["payload"]["include_subscription_ids"] for c in transport.calls] == [[SUB_A], [SUB_B]]
    assert (result.status, result.accepted, result.provider_ids) == ("sent", 2, ["n-1", "n-2"])


def test_send_survives_one_failed_batch_out_of_two():
    transport = FakeTransport((500, {"errors": ["server"]}), (200, {"id": "n-2", "recipients": 1}))
    result = send_onesignal(CONFIG, [SUB_A, SUB_B], "T", "B", transport=transport, batch_size=1)
    assert (result.status, result.accepted, result.failed) == ("partial", 1, 1)


def test_send_dedupes_recipients_before_counting():
    transport = FakeTransport((200, {"id": "n-1", "recipients": 1}))
    result = send_onesignal(CONFIG, [SUB_A, SUB_A, SUB_A], "T", "B", transport=transport)
    assert result.attempted == 1
    assert transport.calls[0]["payload"]["include_subscription_ids"] == [SUB_A]


def test_send_accepted_is_clamped_to_batch_size():
    """Provayder şişirdilmiş `recipients` qaytarsa da qəbul sayı alıcıdan çox olmur."""
    transport = FakeTransport((200, {"id": "n-1", "recipients": 999}))
    result = send_onesignal(CONFIG, [SUB_A], "T", "B", transport=transport)
    assert (result.accepted, result.failed, result.status) == (1, 0, "sent")


def test_send_sanitizes_text_before_transport():
    transport = FakeTransport()
    send_onesignal(CONFIG, [SUB_A], "  Baş\nlıq  ", "b" * 400, transport=transport)
    payload = transport.calls[0]["payload"]
    assert payload["headings"]["az"] == "Baş lıq"
    assert len(payload["contents"]["az"]) == MAX_PUSH_BODY


# ---------------------------------------------------------------------------
# PushResult.as_log_dict — jurnal sızma etmir
# ---------------------------------------------------------------------------


def test_log_dict_hides_tokens_and_caps_provider_ids():
    result = PushResult(
        status="partial",
        attempted=9,
        accepted=4,
        failed=5,
        provider_ids=[f"n-{i}" for i in range(9)],
        invalid_tokens=[SUB_A, SUB_B],
        error="x" * 900,
    )
    log = result.as_log_dict()
    assert log["invalid_count"] == 2
    assert "invalid_tokens" not in log        # token DB-yə düşmür
    assert SUB_A not in json.dumps(log)
    assert len(log["provider_ids"]) == 5
    assert len(log["error"]) == 500


def test_log_dict_of_skipped_result_is_all_zeros():
    log = PushResult(status="skipped", error="konfiqurasiya yoxdur").as_log_dict()
    assert (log["status"], log["accepted"], log["failed"], log["invalid_count"]) == ("skipped", 0, 0, 0)
