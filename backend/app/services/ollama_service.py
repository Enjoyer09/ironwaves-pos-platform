import json
from urllib import request as urllib_request


OLLAMAFREEAPI_MODEL_INDEX_URLS = [
    "https://raw.githubusercontent.com/mfoud444/ollamafreeapi/main/ollamafreeapi/ollama_json/llama.json",
    "https://raw.githubusercontent.com/mfoud444/ollamafreeapi/main/ollamafreeapi/ollama_json/mistral.json",
    "https://raw.githubusercontent.com/mfoud444/ollamafreeapi/main/ollamafreeapi/ollama_json/deepseek.json",
    "https://raw.githubusercontent.com/mfoud444/ollamafreeapi/main/ollamafreeapi/ollama_json/qwen.json",
    "https://raw.githubusercontent.com/mfoud444/ollamafreeapi/main/ollamafreeapi/ollama_json/gemma.json",
]


def _extract_models(payload):
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    if isinstance(payload.get("models"), list):
        return [row for row in payload.get("models", []) if isinstance(row, dict)]
    props = payload.get("props") if isinstance(payload.get("props"), dict) else {}
    page_props = props.get("pageProps") if isinstance(props.get("pageProps"), dict) else {}
    models = page_props.get("models")
    if isinstance(models, list):
        return [row for row in models if isinstance(row, dict)]
    return []


def _parse_tps(value) -> float:
    try:
        return float(value)
    except Exception:
        return -1.0


def find_servers_for_model(model_name: str):
    target = str(model_name or "").strip()
    if not target:
        return []
    hits = []
    for url in OLLAMAFREEAPI_MODEL_INDEX_URLS:
        try:
            req = urllib_request.Request(url, headers={"User-Agent": "IronWavesPOS/1.0"})
            with urllib_request.urlopen(req, timeout=8) as response:
                raw = response.read().decode("utf-8", errors="ignore")
            payload = json.loads(raw)
        except Exception:
            continue
        models = _extract_models(payload)
        for row in models:
            name = str(row.get("model_name") or row.get("model") or row.get("name") or "").strip()
            server_url = str(row.get("ip_port") or "").strip()
            if not name or not server_url:
                continue
            if name != target:
                continue
            hits.append(
                {
                    "server_url": server_url,
                    "model_name": name,
                    "tokens_per_second": _parse_tps(row.get("perf_tokens_per_second")),
                    "last_tested": str(row.get("perf_last_tested") or ""),
                }
            )
    unique = {}
    for hit in hits:
        key = f"{hit['model_name']}@{hit['server_url']}"
        prev = unique.get(key)
        if prev is None or hit["tokens_per_second"] > prev["tokens_per_second"]:
            unique[key] = hit
    return sorted(unique.values(), key=lambda row: row.get("tokens_per_second", -1.0), reverse=True)


def generate_once(server_url: str, model: str, prompt: str, temperature: float, num_predict: int, timeout_seconds: int):
    base = str(server_url or "").rstrip("/")
    endpoint = f"{base}/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": float(temperature),
            "num_predict": int(num_predict),
            "top_p": 0.9,
        },
    }
    req = urllib_request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "IronWavesPOS/1.0"},
        method="POST",
    )
    with urllib_request.urlopen(req, timeout=max(5, int(timeout_seconds))) as response:
        body = response.read().decode("utf-8", errors="ignore")
    parsed = json.loads(body or "{}")
    text = str(parsed.get("response") or "").strip()
    if not text:
        raise RuntimeError("Empty response from Ollama server")
    return text


def cloud_generate_once(api_key: str, model: str, prompt: str, temperature: float, num_predict: int, timeout_seconds: int):
    endpoint = "https://ollama.com/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": float(temperature),
            "num_predict": int(num_predict),
            "top_p": 0.9,
        },
    }
    req = urllib_request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "IronWavesPOS/1.0",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib_request.urlopen(req, timeout=max(5, int(timeout_seconds))) as response:
        body = response.read().decode("utf-8", errors="ignore")
    parsed = json.loads(body or "{}")
    text = str(parsed.get("response") or parsed.get("text") or parsed.get("output") or "").strip()
    if not text:
        raise RuntimeError("Empty response from Ollama Cloud")
    return text

