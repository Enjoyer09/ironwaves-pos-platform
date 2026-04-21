import json
import re

from fastapi import HTTPException


def json_load(value: str | None, default):
    try:
        return json.loads(value or "")
    except Exception:
        return default


def clean_public_text(value: str | None, *, max_len: int = 120, field_name: str = "text") -> str:
    raw = str(value or "").strip()
    if len(raw) > max_len:
        raise HTTPException(status_code=400, detail=f"{field_name} çox uzundur")
    if re.search(r"<\s*script|javascript:|data:text/html", raw, re.IGNORECASE):
        raise HTTPException(status_code=400, detail=f"{field_name} təhlükəli məzmun daşıyır")
    return raw


def clean_card_id(value: str | None) -> str:
    raw = clean_public_text(value, max_len=80, field_name="Kart ID")
    if len(raw) < 2:
        raise HTTPException(status_code=400, detail="Kart ID ən azı 2 simvol olmalıdır")
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", raw):
        raise HTTPException(status_code=400, detail="Kart ID yalnız hərf, rəqəm və . _ : - işarələrindən ibarət olmalıdır")
    return raw


def clean_customer_type(value: str | None) -> str:
    return clean_public_text(value or "Golden", max_len=32, field_name="Müştəri tipi") or "Golden"


def clean_secret_token(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) > 96 or not re.fullmatch(r"[A-Za-z0-9._~\-]+", raw):
        raise HTTPException(status_code=400, detail="Secret token formatı düzgün deyil")
    return raw


def clean_staff_pin_length(value, *, default_length: int = 4) -> int:
    try:
        pin_length = int(value)
    except Exception:
        pin_length = int(default_length)
    return 4 if pin_length == 4 else 6


def clean_theme_mode(value) -> str:
    return "light" if str(value or "").strip().lower() == "light" else "dark"


def clean_ui_mode(value) -> str:
    return "new" if str(value or "").strip().lower() == "new" else "old"

