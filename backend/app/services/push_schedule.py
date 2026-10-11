"""P4.3 — push cədvəli: sükut saatları (quiet hours). **Saf modul.**

Niyə saf: sükut saatı qərarını **iki** yer verir — paneldən dərhal göndərmə
(`operations.send_push_broadcast`) və planlanmış göndərmə (`push_scheduler`).
İki yerdə ayrı riyaziyyat yazılsa biri "sükut saatıdır" deyib bloklayar, digəri
gecə 03:00-da müştəriləri oyadar. Ona görə hesablama bir funksiyadadır.

Bu modul `fastapi`, `sqlalchemy` və saat qurşağı kitabxanası import ETMİR —
vaxt qurşağı çevrilməsi **kənarda** (DB tərəfdə) olur, bura yalnız yerli
`minute_of_day` (0..1439) gəlir. Beləliklə testlər modulu birbaşa import edir və
JS güzgüsü (`src/lib/push.ts`) eyni girişlərlə eyni cavabı verir.

⚠️ Sərhəd qaydası: `start == end` **sükut deyil**. Sıfır uzunluqlu pəncərə
"bütün gün sükut" kimi oxunsaydı, admin eyni dəyəri iki dəfə yazanda bütün
kütləvi bildirişlər səssizcə dayanardı. 24 saat sükut istəyən admin kütləvi
bildirişi tam söndürür (`broadcast_enabled=False`) — bu, açıq qərardır.
"""

from __future__ import annotations

import re
from typing import Any, Mapping

#: `push_settings` blobunda sükut saatlarının açarları.
QUIET_ENABLED_KEY = "quiet_enabled"
QUIET_START_KEY = "quiet_start"
QUIET_END_KEY = "quiet_end"

#: Defaultlar: **söndürülü**, amma sənədli pəncərə (22:00–09:00). Söndürülü
#: başlamaq qəsdəndir — mövcud tenant-ların bildirişi heç bir miqrasiya ilə
#: səssizcə kəsilməməlidir.
DEFAULT_QUIET_ENABLED = False
DEFAULT_QUIET_START = "22:00"
DEFAULT_QUIET_END = "09:00"

DEFAULT_QUIET_HOURS: dict[str, Any] = {
    QUIET_ENABLED_KEY: DEFAULT_QUIET_ENABLED,
    QUIET_START_KEY: DEFAULT_QUIET_START,
    QUIET_END_KEY: DEFAULT_QUIET_END,
}

MINUTES_PER_DAY = 24 * 60

#: `H:MM` və `HH:MM` qəbul olunur (panel `type="time"` `09:00` verir, amma əl ilə
#: yazılmış `9:00` rədd edilməməlidir). Saat 24 ola bilməz: `24:00` gecə yarısıdır
#: və `00:00` kimi yazılmalıdır, yoxsa sərhəd hesabı ikimənalı olardı.
_HHMM_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def parse_hhmm(value: Any) -> int | None:
    """`"HH:MM"` → günün dəqiqəsi (0..1439). Tanınmasa `None`.

    `"9:00"` → 540, `"09:00"` → 540 (eyni dəyər). `"24:00"`, `"9:60"`, `"09:00:00"`
    və boş dəyər → `None`.
    """
    raw = str(value or "").strip()
    if not raw:
        return None
    match = _HHMM_RE.match(raw)
    if not match:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def format_hhmm(minute_of_day: Any, fallback: str) -> str:
    """Günün dəqiqəsi → `"HH:MM"`. Aralıqdan kənar dəyər üçün `fallback`."""
    try:
        minute = int(minute_of_day)
    except (TypeError, ValueError, OverflowError):
        return fallback
    if minute < 0 or minute > MINUTES_PER_DAY - 1:
        return fallback
    return f"{minute // 60:02d}:{minute % 60:02d}"


def normalize_quiet_hours(value: Mapping[str, Any] | None) -> dict[str, Any]:
    """Sükut saatları blobunu validasiya edir. **Heç vaxt exception atmır.**

    Xarab `HH:MM` sətri defaulta düşür — panelə "22:00" yazdırıb səssizcə
    "sükut yoxdur" etmək daha pis olardı, çünki admin qorunduğunu düşünərdi.
    """
    raw = dict(value) if isinstance(value, Mapping) else {}
    start_minute = parse_hhmm(raw.get(QUIET_START_KEY))
    end_minute = parse_hhmm(raw.get(QUIET_END_KEY))
    return {
        # `bool` qəsdən Python semantikası ilə: boş konteyner `False`.
        QUIET_ENABLED_KEY: bool(raw.get(QUIET_ENABLED_KEY, DEFAULT_QUIET_ENABLED)),
        QUIET_START_KEY: format_hhmm(start_minute, DEFAULT_QUIET_START)
        if start_minute is not None
        else DEFAULT_QUIET_START,
        QUIET_END_KEY: format_hhmm(end_minute, DEFAULT_QUIET_END)
        if end_minute is not None
        else DEFAULT_QUIET_END,
    }


def _inside(minute_of_day: int, start: int, end: int) -> bool:
    """Pəncərə içindədir? `start > end` olduqda pəncərə gecə yarısından keçir.

    `start == end` → **sükut deyil** (modul sənədinə bax).
    """
    if start == end:
        return False
    if start < end:
        return start <= minute_of_day < end
    # Gecə yarısından keçən pəncərə: 22:00–09:00 → [22:00, 24:00) ∪ [00:00, 09:00)
    return minute_of_day >= start or minute_of_day < end


def quiet_window_state(quiet: Mapping[str, Any] | None, minute_of_day: Any) -> dict[str, Any]:
    """Sükut saatı vəziyyəti — panelin göstərəcəyi **bütün** sahələr bir yerdə.

    Qaytarma: `{enabled, start, end, inside, next_allowed_minute, minutes_until_allowed}`.

    `minutes_until_allowed` sükut içindədirsə pəncərənin **sonuna** qədər qalan
    dəqiqədir (0-dan böyük); kənardadırsa `0`. Panel "sükut bitəndə göndər"
    düyməsinin vaxtını bundan göstərir — səbəb mətni ilə birlikdə.
    """
    normalized = normalize_quiet_hours(quiet)
    start = parse_hhmm(normalized[QUIET_START_KEY]) or 0
    end = parse_hhmm(normalized[QUIET_END_KEY]) or 0

    now: int | None
    try:
        now = int(minute_of_day)
    except (TypeError, ValueError, OverflowError):
        now = None
    if now is None or now < 0 or now > MINUTES_PER_DAY - 1:
        # Vaxt bilinmirsə **bloklamırıq**: naməlum saat ucbatından göndərməni
        # saxlamaq, sükut saatını pozmaqdan daha pis nəticə verərdi (heç nə getmir).
        #
        # ⚠️ `now = 0` işlədilmir: 0 gecə yarısıdır və gecə yarısından keçən pəncərənin
        # (22:00–09:00) **içindədir**, yəni naməlum vaxt göndərməni səssizcə bloklayardı.
        return {
            "enabled": bool(normalized[QUIET_ENABLED_KEY]),
            "start": normalized[QUIET_START_KEY],
            "end": normalized[QUIET_END_KEY],
            "inside": False,
            "next_allowed_minute": 0,
            "minutes_until_allowed": 0,
        }

    enabled = bool(normalized[QUIET_ENABLED_KEY])
    inside = enabled and _inside(now, start, end)
    if not inside:
        return {
            "enabled": enabled,
            "start": normalized[QUIET_START_KEY],
            "end": normalized[QUIET_END_KEY],
            "inside": False,
            "next_allowed_minute": now,
            "minutes_until_allowed": 0,
        }
    remaining = (end - now) % MINUTES_PER_DAY
    if remaining <= 0:  # pragma: no cover - `_inside` bunu qəbul etmir
        remaining = MINUTES_PER_DAY
    return {
        "enabled": True,
        "start": normalized[QUIET_START_KEY],
        "end": normalized[QUIET_END_KEY],
        "inside": True,
        "next_allowed_minute": (now + remaining) % MINUTES_PER_DAY,
        "minutes_until_allowed": remaining,
    }


def quiet_block_message(state: Mapping[str, Any], *, lang_hint: str = "az") -> str:
    """Panelə və API cavabına yazılan insan-oxunaqlı səbəb (Azərbaycanca).

    Mesaj **nə vaxt** göndərilə biləcəyini deyir: "sükut saatıdır" tək başına
    admini səbəbi axtarmağa məcbur edərdi.
    """
    minutes = int(state.get("minutes_until_allowed") or 0)
    hours, mins = divmod(max(0, minutes), 60)
    if hours and mins:
        wait = f"{hours} saat {mins} dəqiqə"
    elif hours:
        wait = f"{hours} saat"
    else:
        wait = f"{mins} dəqiqə"
    return (
        f"Sükut saatıdır ({state.get('start')}–{state.get('end')}) — bildiriş göndərilmədi. "
        f"Növbəti icazəli vaxt: {format_hhmm(state.get('next_allowed_minute'), '00:00')} ({wait} sonra)."
    )
