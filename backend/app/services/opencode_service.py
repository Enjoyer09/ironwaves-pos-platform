import json
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError

from app.core.config import settings


DEFAULT_MODEL_LABELS = {
    "deepseek-v4-flash": "DeepSeek V4 Flash Free",
    "glm-5": "GLM 5",
    "glm-5.1": "GLM 5.1",
    "kimi-k2.5": "Kimi K2.5",
    "kimi-k2.6": "Kimi K2.6",
    "minimax-m2.5": "MiniMax M2.5 Free",
    "minimax-m2.7": "MiniMax M2.7",
    "qwen3.5-plus": "Qwen3.5 Plus",
    "qwen3.6-plus": "Qwen3.6 Plus",
}


def get_allowed_models() -> list[dict[str, str]]:
    configured = str(settings.opencode_allowed_models or "").strip()
    model_ids = [item.strip() for item in configured.split(",") if item.strip()]
    if not model_ids:
        model_ids = ["deepseek-v4-flash"]
    return [
        {
            "id": model_id,
            "name": DEFAULT_MODEL_LABELS.get(model_id, model_id),
            "provider": "OpenCode Zen",
        }
        for model_id in dict.fromkeys(model_ids)
    ]


def is_allowed_model(model_id: str) -> bool:
    allowed_ids = {row["id"] for row in get_allowed_models()}
    return str(model_id or "").strip() in allowed_ids


def default_model_id() -> str:
    configured = str(settings.opencode_default_model or "").strip()
    if configured and is_allowed_model(configured):
        return configured
    models = get_allowed_models()
    return models[0]["id"] if models else "deepseek-v4-flash"


def _base_url() -> str:
    return str(settings.opencode_base_url or "https://opencode.ai/zen/go/v1").strip().rstrip("/")


def _api_key() -> str:
    return str(settings.opencode_api_key or "").strip()


def _headers() -> dict[str, str]:
    key = _api_key()
    if not key:
        raise RuntimeError("OpenCode API key is not configured")
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "User-Agent": "IronWavesPOS/1.0",
    }


def _read_json(url: str, payload: dict, timeout_seconds: int) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib_request.Request(url, data=body, headers=_headers(), method="POST")
    with urllib_request.urlopen(req, timeout=max(5, int(timeout_seconds))) as response:
        raw = response.read().decode("utf-8", errors="replace")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("OpenCode returned non-JSON response") from exc
    if not isinstance(data, dict):
        raise RuntimeError("OpenCode returned invalid response")
    return data


def _extract_chat_text(data: dict) -> str:
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                parts = []
                for item in content:
                    if isinstance(item, dict) and isinstance(item.get("text"), str):
                        parts.append(item["text"])
                if parts:
                    return "\n".join(parts).strip()
    return ""


def _extract_messages_text(data: dict) -> str:
    content = data.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        if parts:
            return "\n".join(parts).strip()
    return ""


def generate_text(
    *,
    model: str,
    prompt: str,
    system: str = "",
    temperature: float = 0.2,
    max_tokens: int = 800,
    timeout_seconds: int | None = None,
) -> str:
    model_id = str(model or default_model_id()).strip()
    if not is_allowed_model(model_id):
        raise ValueError("Selected OpenCode model is not allowed")
    prompt_text = str(prompt or "").strip()
    if not prompt_text:
        raise ValueError("Prompt is required")

    timeout = timeout_seconds or int(settings.opencode_timeout_seconds or 45)
    if model_id.startswith("minimax-"):
        payload = {
            "model": model_id,
            "max_tokens": max(16, min(int(max_tokens or 800), 4096)),
            "temperature": max(0.0, min(float(temperature or 0.2), 2.0)),
            "messages": [{"role": "user", "content": prompt_text}],
        }
        if system:
            payload["system"] = str(system).strip()
        data = _read_json(f"{_base_url()}/messages", payload, timeout)
        text = _extract_messages_text(data)
    else:
        messages = []
        if system:
            messages.append({"role": "system", "content": str(system).strip()})
        messages.append({"role": "user", "content": prompt_text})
        payload = {
            "model": model_id,
            "messages": messages,
            "temperature": max(0.0, min(float(temperature or 0.2), 2.0)),
            "max_tokens": max(16, min(int(max_tokens or 800), 4096)),
        }
        data = _read_json(f"{_base_url()}/chat/completions", payload, timeout)
        text = _extract_chat_text(data)
    if not text:
        raise RuntimeError("OpenCode returned empty text")
    return text


def normalize_opencode_error(exc: Exception) -> str:
    if isinstance(exc, HTTPError):
        try:
            body = exc.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            body = ""
        return f"OpenCode HTTP {exc.code}: {body}".strip()
    if isinstance(exc, URLError):
        return f"OpenCode network error: {exc.reason}"
    return str(exc)
