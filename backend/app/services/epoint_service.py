"""F3/F6 — epoint.az ödəniş xidməti (sadə, stdlib).

API: `developer.epoint.az/en/authentication`
- Hər sorğu: `data` = base64(JSON) + `signature` = base64(sha1(private_key + data + private_key))
- Callback: eyni imza qaydaları, `hmac.compare_digest` ilə yoxlanır (timing-safe).
- Transport urllib ilə, testlər üçün injectable (push_service nümunəsi ilə).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from app.core.config import settings

# transport(url, body_bytes, headers, timeout) -> (status_code, parsed_dict)
EpointTransport = Callable[[str, bytes, dict[str, str], int], tuple[int, dict[str, Any]]]


class EpointError(Exception):
    """epoint API və ya konfiqurasiya xətası (mesaj istifadəçiyə göstərilə bilər)."""


def epoint_configured() -> bool:
    return bool(settings.epoint_public_key and settings.epoint_private_key)


def _keys() -> tuple[str, str]:
    public_key = str(settings.epoint_public_key or "").strip()
    private_key = str(settings.epoint_private_key or "").strip()
    if not public_key or not private_key:
        raise EpointError("epoint ödəniş konfiqurasiya olunmayıb (EPOINT_PUBLIC_KEY/EPOINT_PRIVATE_KEY)")
    return public_key, private_key


def sign_data(data_b64: str, private_key: str) -> str:
    """base64(sha1(private_key + data + private_key)) — epoint imza sxemi."""
    digest = hashlib.sha1(  # noqa: S324 — epoint API məhz SHA1 tələb edir
        f"{private_key}{data_b64}{private_key}".encode("utf-8")
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def verify_signature(data_b64: str, signature: str, private_key: str) -> bool:
    """Callback imzası timing-safe yoxlanır."""
    if not data_b64 or not signature or not private_key:
        return False
    return hmac.compare_digest(sign_data(data_b64, private_key), signature)


def encode_payload(payload: dict[str, Any]) -> str:
    return base64.b64encode(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")


def decode_data(data_b64: str) -> dict[str, Any]:
    try:
        raw = base64.b64decode(data_b64, validate=True)
        parsed = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise EpointError(f"epoint data deşifr edilmədi: {exc}") from exc
    if not isinstance(parsed, dict):
        raise EpointError("epoint data obyekt deyil")
    return parsed


def _urllib_transport(url: str, body: bytes, headers: dict[str, str], timeout: int) -> tuple[int, dict[str, Any]]:
    request = urllib.request.Request(url, data=body, headers=dict(headers), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310 - sabit https URL
            raw = response.read().decode("utf-8", "replace")
            status = int(getattr(response, "status", 200) or 200)
    except urllib.error.HTTPError as exc:
        raw = ""
        try:
            raw = exc.read().decode("utf-8", "replace")
        except Exception:  # pragma: no cover
            raw = ""
        status = int(getattr(exc, "code", 0) or 0)
    except urllib.error.URLError as exc:
        return 0, {"status": "error", "message": f"şəbəkə xətası: {getattr(exc, 'reason', exc)}"}
    except Exception as exc:  # pragma: no cover
        return 0, {"status": "error", "message": f"gözlənilməz xəta: {exc}"}
    try:
        parsed = json.loads(raw) if raw else {}
    except ValueError:
        return status, {"status": "error", "message": raw[:300]}
    return status, parsed if isinstance(parsed, dict) else {"status": "error", "message": str(parsed)[:300]}


def _post(path: str, payload: dict[str, Any], *, transport: EpointTransport | None = None) -> dict[str, Any]:
    public_key, private_key = _keys()
    body_payload = {"public_key": public_key, **payload}
    data_b64 = encode_payload(body_payload)
    body = urllib.parse.urlencode(
        {"data": data_b64, "signature": sign_data(data_b64, private_key)}
    ).encode("utf-8")
    url = f"{str(settings.epoint_base_url).rstrip('/')}{path}"
    send = transport or _urllib_transport
    status, parsed = send(
        url,
        body,
        {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        20,
    )
    if status == 0:
        raise EpointError(str(parsed.get("message") or "epoint-ə qoşula bilmədi"))
    if status >= 500:
        raise EpointError(f"epoint server xətası ({status}): {parsed.get('message') or ''}".strip())
    return parsed


def create_payment(
    *,
    amount: str,
    order_id: str,
    description: str = "",
    language: str | None = None,
    success_redirect_url: str | None = None,
    error_redirect_url: str | None = None,
    transport: EpointTransport | None = None,
) -> dict[str, Any]:
    """`POST /api/1/request` — ödəniş yaradır, `redirect_url` qaytarır."""
    payload: dict[str, Any] = {
        "amount": amount,
        "currency": "AZN",
        "language": str(language or settings.epoint_language or "az"),
        "order_id": order_id,
    }
    if description:
        payload["description"] = description[:1000]
    success = str(success_redirect_url or settings.epoint_success_redirect_url or "").strip()
    error = str(error_redirect_url or settings.epoint_failed_redirect_url or "").strip()
    if success:
        payload["success_redirect_url"] = success
    if error:
        payload["error_redirect_url"] = error
    resp = _post("/request", payload, transport=transport)
    if resp.get("status") != "success" or not resp.get("redirect_url"):
        raise EpointError(str(resp.get("message") or "epoint ödəniş yaratmadı"))
    return resp


def get_status(transaction: str, *, transport: EpointTransport | None = None) -> dict[str, Any]:
    """`POST /api/1/get-status` — əməliyyatın cari statusu."""
    resp = _post("/get-status", {"transaction": transaction}, transport=transport)
    if resp.get("status") is None:
        raise EpointError(str(resp.get("message") or "epoint status qaytarmadı"))
    return resp
