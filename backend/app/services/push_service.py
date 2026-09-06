"""P1.4 — per-tenant push konfiqurasiyası və göndərmə.

Niyə ayrı modul: göndərici indiyə qədər `pos.py`-nin içində, **qlobal env**
açarları ilə işləyirdi (`settings.onesignal_app_id`, `settings.onesignal_rest_api_key`).
Panelin `onesignal_app_id` sahəsi isə **per-tenant** blobda yaşayır və brauzer
SDK-sı onunla işə düşür. Bu ikisi bir-birinə baxmırdı, yəni:

    tenant öz OneSignal app-ını yazır  →  SDK abunəliyi TENANT app-ında yaranır
    server isə PLATFORMA app-ına göndərir  →  "invalid_player_ids"  →  səssiz uğursuzluq

Köhnə göndərici bütün exception-ları udurdu, ona görə bu heç yerdə görünmürdü.
Bu modul həmin uyğunsuzluğu **konfiqurasiya səviyyəsində** bağlayır: app id və
REST açarı **bir mənbədən** götürülür (ya tenant, ya platforma) — qarışıq cüt
heç vaxt qurulmur.

⚠️ **REST açarı `customer_app_settings`-ə YAZILMIR.** O blob
`get_customer_app_session`-da hər müştəriyə qaytarılır (`operations.py`), yəni
oraya qoyulan açar hər telefonda görünərdi. Açar ayrı `push_settings` açarında
saxlanılır (`Setting` cədvəli) və `_can_view_sensitive_settings` maskası ilə
qorunur — `email_settings.resend_api_key` ilə eyni naxış.

`app_id` isə **qəsdən** `customer_app_settings`-də qalır: OneSignal app id
brauzer SDK-sının init parametridir, yəni onsuz da publikdir.

Bu modul `fastapi`/DB import ETMİR — testlər onu birbaşa import edir.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

logger = logging.getLogger(__name__)

ONESIGNAL_URL = "https://onesignal.com/api/v1/notifications"
ONESIGNAL_TIMEOUT_SEC = 10

#: Bir sorğuda OneSignal-a göndərilən maksimum abunəlik id-si. Provayderin
#: `include_subscription_ids` limiti 2000-dir; biz onun altında qalırıq.
PUSH_BATCH_SIZE = 1000

#: Bir broadcast-ın maksimum alıcı sayı. Səhv seqment + böyük baza = kütləvi
#: spam; hədd panelin ön baxışında da göstərilir.
MAX_BROADCAST_RECIPIENTS = 20_000

MAX_PUSH_TITLE = 80
MAX_PUSH_BODY = 240

#: Gündə paneldən əl ilə göndərilə bilən broadcast sayı. `0` = broadcast
#: bloklanır (limitsiz DEYİL) — bu, `broadcast_enabled=False` ilə eyni istiqamətdə
#: oxunur, yəni "şübhə varsa göndərmə".
DEFAULT_BROADCAST_DAILY_LIMIT = 3
MAX_BROADCAST_DAILY_LIMIT = 50

#: `push_settings` (Setting açarı) defaultları. Hamısı **köhnə davranışı
#: saxlayır**: `enabled` və `event_push_enabled` açıqdır, çünki hadisə push-ları
#: (checkout, sifariş hazır, hədiyyə kodu, ad günü) P1.4-dən əvvəl də gedirdi —
#: onları söndürülü başlatmaq mövcud tenant-larda işləyən bildirişi kəsərdi.
DEFAULT_PUSH_SETTINGS: dict[str, Any] = {
    "enabled": True,
    "event_push_enabled": True,
    "broadcast_enabled": False,
    "onesignal_rest_api_key": "",
    "broadcast_daily_limit": DEFAULT_BROADCAST_DAILY_LIMIT,
}

#: Maskalananda müştəriyə/manager-ə boş gedən açarlar.
PUSH_SECRET_KEYS = ("onesignal_rest_api_key",)

PUSH_KINDS = ("event", "test", "broadcast")

#: Frontend REST açarını əlində saxlamaq məcburiyyətində qalmasın: bu sentinel
#: göndərilsə mövcud açar olduğu kimi qalır. (Açar sadəcə göndərilməsə də qalır —
#: PATCH merge top-level açar səviyyəsindədir — amma form boş sətir göndərəndə
#: açarın silinməsi real risk idi, ona görə açıq sentinel var.)
PUSH_SECRET_SENTINEL = "__keep__"


# ---------------------------------------------------------------------------
# Normalizasiya — `operations.py`-dəki `_norm_*` ilə eyni semantika.
# Bura kopyalanır, çünki modul `operations.py` (deməli `fastapi`) import etmir.
# JS güzgüsü: `src/lib/push.ts`.
# ---------------------------------------------------------------------------


def _norm_text(value: Any, fallback: str, limit: int = 500) -> str:
    candidate = str(value or "").strip()
    return candidate[:limit] if candidate else fallback


def _norm_int(value: Any, fallback: int, minimum: int = 0, maximum: int | None = None) -> int:
    """`0` qanuni dəyərdir (broadcast bloklamaq üçün) — `x or default` işlədilmir.

    `OverflowError` də tutulur: `json.loads` standartda `Infinity` qəbul edir
    (`db_sim.safeParse` bunu "idxal edilmiş backup"-lardan gələn real hal kimi
    sənədləşdirir), `int(float("inf"))` isə `OverflowError` atır — modulun
    "heç vaxt exception atmır" müqaviləsini pozardı.
    """
    if value is None or (isinstance(value, str) and not value.strip()) or isinstance(value, bool):
        parsed = int(fallback)
    else:
        try:
            parsed = int(float(value))
        except (TypeError, ValueError, OverflowError):
            parsed = int(fallback)
    if parsed < minimum:
        parsed = minimum
    return min(parsed, maximum) if maximum is not None else parsed


def normalize_push_settings(value: Mapping[str, Any] | None, *, current: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """`push_settings` blobunu validasiya edir. Heç vaxt exception atmır.

    `current` verilibsə, REST açarı üçün sentinel dəstəklənir: gələn dəyər
    `PUSH_SECRET_SENTINEL`-dirsə köhnə açar saxlanılır.
    """
    raw = dict(value) if isinstance(value, Mapping) else {}
    prev = dict(current) if isinstance(current, Mapping) else {}
    d = DEFAULT_PUSH_SETTINGS

    incoming_key = raw.get("onesignal_rest_api_key")
    if str(incoming_key or "").strip() == PUSH_SECRET_SENTINEL:
        rest_key = str(prev.get("onesignal_rest_api_key") or "").strip()
    else:
        rest_key = str(incoming_key or "").strip()

    return {
        "enabled": bool(raw.get("enabled", d["enabled"])),
        "event_push_enabled": bool(raw.get("event_push_enabled", d["event_push_enabled"])),
        "broadcast_enabled": bool(raw.get("broadcast_enabled", d["broadcast_enabled"])),
        "onesignal_rest_api_key": rest_key[:200],
        "broadcast_daily_limit": _norm_int(
            raw.get("broadcast_daily_limit"), d["broadcast_daily_limit"], 0, MAX_BROADCAST_DAILY_LIMIT
        ),
    }


def push_settings_response(value: Mapping[str, Any] | None, *, reveal: bool = False) -> dict[str, Any]:
    """GET cavabı. `reveal=False` olanda sirlər boşalır, forma sxemi dəyişmir.

    Cavabın **şəkli roldan asılı deyil**: hər iki halda `..._set` bayrağı var, ona
    görə panel açarın mövcudluğunu göstərə bilir (yoxsa manager "konfiqurasiya
    yoxdur" deyə səhv diaqnoz qoyar) və frontend iki fərqli sxem saxlamır.
    """
    normalized = normalize_push_settings(value)
    out = dict(normalized)
    for key in PUSH_SECRET_KEYS:
        out[f"{key}_set"] = bool(str(normalized.get(key) or "").strip())
        if not reveal:
            out[key] = ""
    return out


# ---------------------------------------------------------------------------
# Konfiqurasiya həlli — P1.4-ün əsl düyünü.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PushConfig:
    """Göndərmə üçün hazır (və ya hazır olmayan) OneSignal cütü."""

    app_id: str = ""
    rest_api_key: str = ""
    #: "tenant" | "platform" | "none"
    source: str = "none"
    #: Azərbaycanca, panelə birbaşa göstərilə bilən səbəb (boş = problem yox).
    reason: str = ""

    @property
    def ok(self) -> bool:
        return bool(self.app_id and self.rest_api_key and self.source in ("tenant", "platform"))


def resolve_push_config(
    *,
    tenant_app_id: str | None,
    tenant_rest_key: str | None,
    platform_app_id: str | None = None,
    platform_rest_key: str | None = None,
) -> PushConfig:
    """`app_id` və REST açarını **bir mənbədən** götürür.

    Qadağa: tenant app id + platforma REST açarı (və ya tərsi). Belə cüt
    OneSignal-da `invalid_player_ids` verir — abunəlik id-si başqa app-a aiddir —
    və köhnə göndərici bu səhvi udub susurdu. Ona görə qarışıq cüt **heç vaxt**
    qurulmur; əvəzinə `source="none"` və insan-oxunaqlı səbəb qaytarılır.
    """
    t_app = str(tenant_app_id or "").strip()
    t_key = str(tenant_rest_key or "").strip()
    p_app = str(platform_app_id or "").strip()
    p_key = str(platform_rest_key or "").strip()

    if t_app and t_key:
        return PushConfig(app_id=t_app, rest_api_key=t_key, source="tenant")

    if t_app and not t_key:
        return PushConfig(
            source="none",
            reason=(
                "OneSignal App ID yazılıb, amma bu tenant üçün REST API açarı boşdur. "
                "Platforma açarı ilə cütləşdirilmir — abunəliklər sizin app-da olduğu üçün "
                "belə göndərmə OneSignal tərəfindən rədd edilir."
            ),
        )

    if p_app and p_key:
        reason = ""
        if t_key:
            reason = (
                "REST API açarı yazılıb, amma OneSignal App ID boşdur — açar nəzərə alınmır. "
                "Platforma konfiqurasiyası işlədilir. Öz app-ınızı işlətmək üçün App ID-ni də doldurun."
            )
        return PushConfig(app_id=p_app, rest_api_key=p_key, source="platform", reason=reason)

    return PushConfig(
        source="none",
        reason=(
            "Push konfiqurasiya edilməyib: nə tenant, nə platforma səviyyəsində "
            "OneSignal App ID + REST API açarı cütü tamamlanmır."
        ),
    )


def resolve_client_app_id(tenant_app_id: str | None, platform_app_id: str | None = None) -> str:
    """Brauzer/mobil SDK-nın init edəcəyi app id.

    `resolve_push_config` ilə **eyni prioritet** (tenant → platforma), çünki iki
    tərəf ayrı-ayrı qərar versə abunəlik bir app-da yaranıb göndərmə başqasına
    gedir. Server bu funksiyanın nəticəsini müştəri sessiyasında qaytarır.
    """
    t_app = str(tenant_app_id or "").strip()
    return t_app if t_app else str(platform_app_id or "").strip()


# ---------------------------------------------------------------------------
# Mətn və token köməkçiləri
# ---------------------------------------------------------------------------


def sanitize_push_text(title: Any, body: Any) -> tuple[str, str]:
    """Başlıq/mətni kəsir və bir sətrə yığır.

    OneSignal uzun mətni özü kəsir, amma kəsim **cihazdan asılı** olur; burada
    kəsmək panelin ön baxışı ilə real bildirişi uyğunlaşdırır.
    """
    clean_title = " ".join(str(title or "").split())[:MAX_PUSH_TITLE]
    clean_body = " ".join(str(body or "").split())[:MAX_PUSH_BODY]
    return clean_title, clean_body


def mask_token(token: Any) -> str:
    """Loga tam abunəlik id-si yazmaq olmaz (köhnə göndərici yazırdı)."""
    raw = str(token or "").strip()
    if len(raw) <= 8:
        return "***" if raw else ""
    return f"{raw[:4]}…{raw[-4:]}"


def dedupe_tokens(tokens: Sequence[Any] | None) -> list[str]:
    """Boşları atır, təkrarı silir, sıranı saxlayır.

    Təkrar real haldır: bir müştəri həm brauzerdən, həm tətbiqdən qeydiyyatdan
    keçəndə `push_token` sütunu üzərinə yazılır, amma seqment sorğusu birləşmiş
    sətirlər qaytara bilir — təkrar göndərmə isə istifadəçiyə iki bildiriş deməkdir.
    """
    seen: set[str] = set()
    out: list[str] = []
    for raw in tokens or ():
        value = str(raw or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def chunk_tokens(tokens: Sequence[str], size: int = PUSH_BATCH_SIZE) -> list[list[str]]:
    step = max(1, int(size or PUSH_BATCH_SIZE))
    return [list(tokens[i : i + step]) for i in range(0, len(tokens), step)]


def is_onesignal_subscription_id(token: Any) -> bool:
    """Token OneSignal abunəlik id-sinə (UUID) bənzəyir?

    Niyə lazımdır: `Customer.push_token` **iki fərqli** şey saxlayır. Brauzer SDK-sı
    OneSignal abunəlik id-si (UUID) yazır, native tətbiq isə
    `@capacitor/push-notifications` ilə APNs/FCM **cihaz tokeni** (64+ simvol, hex
    və ya nöqtəli-alt-xətli uzun sətir) yazır. OneSignal `include_subscription_ids`
    ikinci formanı qəbul etmir — yəni belə tokenlər çatdırıla bilməz.

    Bu funksiya **heç nə silmir**; audience və panel dürüst say göstərsin deyə
    təsnifat verir (`docs/CUSTOMER_APP_SETTINGS_AUDIT.md` §3.6 açıq maddə).
    """
    raw = str(token or "").strip()
    if len(raw) != 36 or raw.count("-") != 4:
        return False
    parts = raw.split("-")
    if [len(p) for p in parts] != [8, 4, 4, 4, 12]:
        return False
    return all(c in "0123456789abcdefABCDEF" for c in raw.replace("-", ""))


def split_deliverable_tokens(tokens: Sequence[Any] | None) -> tuple[list[str], list[str]]:
    """(çatdırıla bilən abunəliklər, çatdırıla bilməyən cihaz tokenləri)."""
    deliverable: list[str] = []
    undeliverable: list[str] = []
    for token in dedupe_tokens(tokens):
        (deliverable if is_onesignal_subscription_id(token) else undeliverable).append(token)
    return deliverable, undeliverable


# ---------------------------------------------------------------------------
# Göndərmə
# ---------------------------------------------------------------------------


@dataclass
class PushResult:
    """Göndərmənin **dürüst** nəticəsi.

    Köhnə göndərici `None` qaytarırdı və bütün səhvləri udurdu, ona görə ad günü
    schedulerindəki `notified` sayğacı əslində "cəhd" sayırdı. Bu obyekt cəhd,
    qəbul və uğursuzluğu ayırır ki, tarixçə cədvəli və panel real rəqəm göstərsin.
    """

    #: "sent" | "partial" | "failed" | "skipped"
    status: str = "skipped"
    attempted: int = 0
    accepted: int = 0
    failed: int = 0
    provider_ids: list[str] = field(default_factory=list)
    invalid_tokens: list[str] = field(default_factory=list)
    error: str = ""

    @property
    def ok(self) -> bool:
        return self.status in ("sent", "partial")

    def as_log_dict(self) -> dict[str, Any]:
        """`PushDelivery.details` üçün — token YOX, yalnız maskalanmış say."""
        return {
            "status": self.status,
            "attempted": self.attempted,
            "accepted": self.accepted,
            "failed": self.failed,
            "provider_ids": list(self.provider_ids)[:5],
            "invalid_count": len(self.invalid_tokens),
            "error": (self.error or "")[:500],
        }


def _urllib_transport(url: str, body: bytes, headers: Mapping[str, str], timeout: int) -> tuple[int, dict[str, Any]]:
    """Stdlib HTTP POST. Heç vaxt exception atmır — (status, gövdə) qaytarır.

    `httpx` yerinə `urllib` işlədilir ki, köhnə göndərici ilə asılılıq fərqi
    yaranmasın (`pos.py` da `urllib` işlədirdi).
    """
    request = urllib.request.Request(url, data=body, headers=dict(headers), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310 - sabit https URL
            raw = response.read().decode("utf-8", "replace")
            status = int(getattr(response, "status", 200) or 200)
    except urllib.error.HTTPError as exc:  # 4xx/5xx — gövdədə səbəb olur
        raw = ""
        try:
            raw = exc.read().decode("utf-8", "replace")
        except Exception:  # pragma: no cover - gövdə oxunmaya bilər
            raw = ""
        status = int(getattr(exc, "code", 0) or 0)
    except urllib.error.URLError as exc:
        return 0, {"errors": [f"şəbəkə xətası: {getattr(exc, 'reason', exc)}"]}
    except Exception as exc:  # pragma: no cover - gözlənilməz
        return 0, {"errors": [f"gözlənilməz xəta: {exc}"]}

    if not raw:
        return status, {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        return status, {"errors": [raw[:300]]}
    return status, parsed if isinstance(parsed, dict) else {"errors": [str(parsed)[:300]]}


def _extract_errors(payload: Mapping[str, Any]) -> tuple[list[str], list[str]]:
    """OneSignal `errors` sahəsi ya list, ya dict olur. (mesajlar, yararsız token-lar)."""
    errors = payload.get("errors")
    if isinstance(errors, list):
        return [str(e)[:200] for e in errors if str(e or "").strip()], []
    if isinstance(errors, Mapping):
        invalid: list[str] = []
        for key in ("invalid_player_ids", "invalid_subscription_ids", "invalid_external_user_ids"):
            values = errors.get(key)
            if isinstance(values, list):
                invalid.extend(str(v) for v in values if str(v or "").strip())
        messages = [f"{k}: {v}" for k, v in errors.items() if not isinstance(v, list)]
        return [m[:200] for m in messages], invalid
    return [], []


def build_onesignal_payload(
    config: PushConfig,
    tokens: Sequence[str],
    title: str,
    body: str,
    *,
    data: Mapping[str, Any] | None = None,
    url: str | None = None,
) -> dict[str, Any]:
    """Bir batch üçün OneSignal gövdəsi. Test bunu ayrıca yoxlayır."""
    payload: dict[str, Any] = {
        "app_id": config.app_id,
        "include_subscription_ids": list(tokens),
        "contents": {"en": body, "az": body},
    }
    if title:
        payload["headings"] = {"en": title, "az": title}
    if data:
        payload["data"] = dict(data)
    clean_url = str(url or "").strip()
    if clean_url.startswith("https://"):
        payload["url"] = clean_url
    return payload


def send_onesignal(
    config: PushConfig,
    tokens: Sequence[str] | None,
    title: Any,
    body: Any,
    *,
    data: Mapping[str, Any] | None = None,
    url: str | None = None,
    transport: Any = None,
    batch_size: int = PUSH_BATCH_SIZE,
) -> PushResult:
    """Abunəliklərə push göndərir. **Heç vaxt exception atmır.**

    `transport` inyeksiya olunandır — testlər şəbəkəyə çıxmadan cavab formasını
    yoxlayır: `transport(url, body_bytes, headers, timeout) -> (status, dict)`.
    """
    clean_title, clean_body = sanitize_push_text(title, body)
    recipients = dedupe_tokens(tokens)
    result = PushResult(attempted=len(recipients))

    if not config.ok:
        result.status = "skipped"
        result.error = config.reason or "Push konfiqurasiyası tamamlanmayıb."
        return result
    if not clean_body:
        result.status = "skipped"
        result.error = "Bildiriş mətni boşdur."
        return result
    if not recipients:
        result.status = "skipped"
        result.error = "Alıcı yoxdur (abunəlik id-si olan müştəri tapılmadı)."
        return result

    send = transport or _urllib_transport
    headers = {
        "Authorization": f"Basic {config.rest_api_key}",
        "Content-Type": "application/json; charset=utf-8",
    }
    messages: list[str] = []

    for batch in chunk_tokens(recipients, batch_size):
        payload = build_onesignal_payload(config, batch, clean_title, clean_body, data=data, url=url)
        try:
            status, response = send(
                ONESIGNAL_URL,
                json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers,
                ONESIGNAL_TIMEOUT_SEC,
            )
        except Exception as exc:  # transport özü partlayarsa da göndərici susmur
            messages.append(f"transport xətası: {exc}")
            continue

        response = response if isinstance(response, Mapping) else {}
        batch_errors, invalid = _extract_errors(response)
        messages.extend(batch_errors)
        result.invalid_tokens.extend(invalid)

        provider_id = str(response.get("id") or "").strip()
        if provider_id:
            result.provider_ids.append(provider_id)

        try:
            accepted = int(response.get("recipients") or 0)
        except (TypeError, ValueError):
            accepted = 0
        if accepted <= 0 and 200 <= int(status or 0) < 300 and provider_id and not batch_errors:
            # OneSignal bəzən `recipients` sahəsini qaytarmır; id varsa qəbul sayılır.
            accepted = len(batch) - len(invalid)
        result.accepted += max(0, min(accepted, len(batch)))

        if not (200 <= int(status or 0) < 300):
            messages.append(f"HTTP {status or 0}")

    result.failed = max(0, result.attempted - result.accepted)
    result.error = "; ".join(dict.fromkeys(m for m in messages if m))[:500]
    if result.accepted <= 0:
        result.status = "failed"
    elif result.failed > 0:
        result.status = "partial"
    else:
        result.status = "sent"

    if not result.ok:
        logger.warning(
            "[PUSH] göndərilmədi (source=%s, alıcı=%s, nümunə=%s): %s",
            config.source,
            result.attempted,
            mask_token(recipients[0]),
            result.error or "səbəb bilinmir",
        )
    return result
