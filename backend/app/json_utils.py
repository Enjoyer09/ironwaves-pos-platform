import json
from typing import Any


def safe_json_loads(value: Any, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    raw = str(value or "").strip()
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        if not any(token in raw for token in ("NaN", "Infinity", "-Infinity")):
            return default
        try:
            normalized = raw.replace("-Infinity", "null").replace("Infinity", "null").replace("NaN", "null")
            return json.loads(normalized)
        except Exception:
            return default


def safe_json_list(value: Any) -> list[Any]:
    parsed = safe_json_loads(value, [])
    return parsed if isinstance(parsed, list) else []
