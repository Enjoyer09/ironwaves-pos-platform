from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import streamlit as st


METHOD_STATUS_RE = re.compile(r'"(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s+([^"]+)\s+HTTP/[^"]+"\s+(\d{3})')


@dataclass
class EventRow:
    source: str
    ts: datetime
    method: str
    path: str
    status: int | None
    duration_ms: float | None
    note: str


def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except Exception:
            return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def clean_path(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        return urlparse(raw).path or "/"
    if "?" in raw:
        return raw.split("?", 1)[0]
    return raw or "/"


def parse_railway_logs(payload: Any) -> list[EventRow]:
    rows: list[EventRow] = []
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return rows
    for item in payload:
        if not isinstance(item, dict):
            continue
        msg = str(item.get("message") or "")
        ts = parse_dt(item.get("timestamp"))
        if not ts:
            continue
        m = METHOD_STATUS_RE.search(msg)
        if m:
            method, path, status = m.group(1), clean_path(m.group(2)), int(m.group(3))
            rows.append(
                EventRow(
                    source="railway",
                    ts=ts,
                    method=method,
                    path=path,
                    status=status,
                    duration_ms=None,
                    note=msg,
                )
            )
        elif "Exception" in msg or "Traceback" in msg or "ERROR" in msg.upper():
            rows.append(
                EventRow(
                    source="railway",
                    ts=ts,
                    method="-",
                    path="-",
                    status=500,
                    duration_ms=None,
                    note=msg,
                )
            )
    return rows


def parse_chrome_har(payload: Any) -> list[EventRow]:
    rows: list[EventRow] = []
    entries = payload.get("log", {}).get("entries", []) if isinstance(payload, dict) else []
    if not isinstance(entries, list):
        return rows
    for e in entries:
        if not isinstance(e, dict):
            continue
        req = e.get("request", {}) if isinstance(e.get("request"), dict) else {}
        res = e.get("response", {}) if isinstance(e.get("response"), dict) else {}
        ts = parse_dt(e.get("startedDateTime"))
        if not ts:
            continue
        method = str(req.get("method") or "-").upper()
        path = clean_path(str(req.get("url") or "-"))
        status = int(res.get("status")) if str(res.get("status", "")).isdigit() else None
        time_ms = None
        try:
            time_ms = float(e.get("time"))
        except Exception:
            time_ms = None
        rows.append(
            EventRow(
                source="chrome",
                ts=ts,
                method=method,
                path=path,
                status=status,
                duration_ms=time_ms,
                note=f"Chrome request {method} {path}",
            )
        )
    return rows


def parse_neon_csv(text: str) -> list[EventRow]:
    rows: list[EventRow] = []
    reader = csv.DictReader(io.StringIO(text))
    for r in reader:
        q = str(r.get("query") or r.get("statement") or "").strip()
        if not q:
            continue
        ts = parse_dt(r.get("started_at") or r.get("timestamp") or r.get("time"))
        if not ts:
            continue
        dur = None
        for k in ("duration_ms", "duration", "total_time_ms"):
            try:
                if r.get(k) not in (None, ""):
                    dur = float(r.get(k))  # type: ignore[arg-type]
                    break
            except Exception:
                pass
        rows.append(
            EventRow(
                source="neon",
                ts=ts,
                method="SQL",
                path="db.query",
                status=None,
                duration_ms=dur,
                note=q[:240],
            )
        )
    return rows


def parse_neon_json(payload: Any) -> list[EventRow]:
    rows: list[EventRow] = []
    if isinstance(payload, dict):
        payload = payload.get("rows", payload.get("data", payload))
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return rows
    for item in payload:
        if not isinstance(item, dict):
            continue
        ts = parse_dt(item.get("started_at") or item.get("timestamp") or item.get("time"))
        if not ts:
            continue
        q = str(item.get("query") or item.get("statement") or "")
        dur = None
        for k in ("duration_ms", "duration", "total_time_ms"):
            try:
                if item.get(k) not in (None, ""):
                    dur = float(item.get(k))
                    break
            except Exception:
                pass
        rows.append(EventRow("neon", ts, "SQL", "db.query", None, dur, q[:240]))
    return rows


def p95(values: list[float]) -> float | None:
    if not values:
        return None
    values = sorted(values)
    idx = max(0, min(len(values) - 1, int(round(0.95 * (len(values) - 1)))))
    return values[idx]


def main() -> None:
    st.set_page_config(page_title="iRonWaves Log Korelyatoru", layout="wide")
    st.title("iRonWaves Log Korelyatoru")
    st.caption("Railway + Chrome + Neon loglarını eyni timeline-da yoxla və kök səbəbi tez tap.")

    with st.sidebar:
        st.header("Fayl yüklə")
        railway_file = st.file_uploader("Railway log (JSON)", type=["json"], key="railway")
        chrome_file = st.file_uploader("Chrome HAR/JSON", type=["har", "json"], key="chrome")
        neon_file = st.file_uploader("Neon log (CSV/JSON)", type=["csv", "json"], key="neon")
        window_sec = st.slider("Korrelyasiya pəncərəsi (saniyə)", 3, 60, 15)
        long_req_ms = st.slider("Yavaş request həddi (ms)", 500, 20000, 3000, step=500)

    events: list[EventRow] = []
    errors: list[str] = []

    if railway_file is not None:
        try:
            payload = json.loads(railway_file.getvalue().decode("utf-8", errors="ignore"))
            events.extend(parse_railway_logs(payload))
        except Exception as exc:
            errors.append(f"Railway parse xətası: {exc}")

    if chrome_file is not None:
        try:
            payload = json.loads(chrome_file.getvalue().decode("utf-8", errors="ignore"))
            events.extend(parse_chrome_har(payload))
        except Exception as exc:
            errors.append(f"Chrome parse xətası: {exc}")

    if neon_file is not None:
        try:
            raw = neon_file.getvalue().decode("utf-8", errors="ignore")
            if neon_file.name.lower().endswith(".csv"):
                events.extend(parse_neon_csv(raw))
            else:
                payload = json.loads(raw)
                events.extend(parse_neon_json(payload))
        except Exception as exc:
            errors.append(f"Neon parse xətası: {exc}")

    for e in errors:
        st.error(e)

    if not events:
        st.info("Başlamaq üçün ən azı bir log faylı yüklə.")
        return

    events.sort(key=lambda x: x.ts)
    total = len(events)
    slow_chrome = [e for e in events if e.source == "chrome" and (e.duration_ms or 0) >= long_req_ms]
    railway_5xx = [e for e in events if e.source == "railway" and (e.status or 0) >= 500]
    st_cols = st.columns(4)
    st_cols[0].metric("Ümumi event", str(total))
    st_cols[1].metric("Yavaş Chrome request", str(len(slow_chrome)))
    st_cols[2].metric("Railway 5xx", str(len(railway_5xx)))
    st_cols[3].metric("Timespan", f"{(events[-1].ts - events[0].ts).total_seconds():.0f} s")

    path_filter = st.text_input("Endpoint filtr (məs: /api/v1/ops/tables)")
    src_filter = st.multiselect("Mənbə", ["chrome", "railway", "neon"], default=["chrome", "railway", "neon"])

    filtered = [
        e
        for e in events
        if e.source in src_filter and (not path_filter or path_filter in e.path or path_filter in e.note)
    ]
    if not filtered:
        st.warning("Filter nəticəsi boşdur.")
        return

    st.subheader("Endpoint üzrə icmal")
    endpoint_stats: dict[str, list[float]] = {}
    for e in filtered:
        if e.duration_ms is None:
            continue
        key = f"{e.source} {e.method} {e.path}"
        endpoint_stats.setdefault(key, []).append(float(e.duration_ms))
    rows = []
    for key, vals in endpoint_stats.items():
        rows.append(
            {
                "endpoint": key,
                "count": len(vals),
                "avg_ms": round(sum(vals) / len(vals), 2),
                "p95_ms": round(p95(vals) or 0.0, 2),
                "max_ms": round(max(vals), 2),
            }
        )
    rows.sort(key=lambda x: x["max_ms"], reverse=True)
    st.dataframe(rows[:300], use_container_width=True, hide_index=True)

    st.subheader("Chrome ↔ Railway korelyasiya")
    chrome_rows = [e for e in filtered if e.source == "chrome" and e.path.startswith("/api/")]
    railway_rows = [e for e in filtered if e.source == "railway" and e.path.startswith("/api/")]
    corr = []
    window = timedelta(seconds=window_sec)
    for c in chrome_rows:
        candidates = [
            r
            for r in railway_rows
            if r.path == c.path and r.method == c.method and abs(r.ts - c.ts) <= window
        ]
        best = min(candidates, key=lambda x: abs(x.ts - c.ts), default=None)
        corr.append(
            {
                "ts_chrome": c.ts.isoformat(),
                "method": c.method,
                "path": c.path,
                "chrome_ms": round(c.duration_ms or 0.0, 2),
                "railway_status": best.status if best else None,
                "delta_sec": round(abs((best.ts - c.ts).total_seconds()), 2) if best else None,
                "match": bool(best),
            }
        )
    st.dataframe(corr[:600], use_container_width=True, hide_index=True)
    misses = sum(1 for row in corr if not row["match"])
    st.info(f"Uyğun gəlməyən Chrome API request sayı: {misses}")

    st.subheader("Raw timeline")
    timeline = [
        {
            "timestamp": e.ts.isoformat(),
            "source": e.source,
            "method": e.method,
            "path": e.path,
            "status": e.status,
            "duration_ms": e.duration_ms,
            "note": e.note,
        }
        for e in filtered
    ]
    st.dataframe(timeline[:5000], use_container_width=True, hide_index=True)


if __name__ == "__main__":
    main()
