from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

import streamlit as st

try:
    import psycopg2  # type: ignore
except Exception:  # pragma: no cover
    psycopg2 = None

try:
    import certifi  # type: ignore
except Exception:  # pragma: no cover
    certifi = None


@dataclass
class ProbeRow:
    ts: str
    target: str
    kind: str
    status: str
    latency_ms: float | None
    details: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_base_url(url: str) -> str:
    u = url.strip()
    if not u:
        return ""
    if not (u.startswith("http://") or u.startswith("https://")):
        u = f"https://{u}"
    return u.rstrip("/")


def _ssl_context(verify_ssl: bool) -> ssl.SSLContext | None:
    if not verify_ssl:
        return ssl._create_unverified_context()
    if certifi:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()


def http_probe(url: str, timeout_sec: int, headers: dict[str, str] | None = None, verify_ssl: bool = True) -> ProbeRow:
    headers = headers or {}
    started = time.perf_counter()
    req = urllib.request.Request(url=url, method="GET", headers=headers)
    ctx = _ssl_context(verify_ssl)
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec, context=ctx) as resp:
            body = resp.read(3000).decode("utf-8", errors="ignore")
            latency_ms = (time.perf_counter() - started) * 1000
            return ProbeRow(
                ts=now_iso(),
                target=url,
                kind="http",
                status=str(resp.status),
                latency_ms=round(latency_ms, 2),
                details=body[:300].replace("\n", " "),
            )
    except urllib.error.HTTPError as e:
        latency_ms = (time.perf_counter() - started) * 1000
        body = ""
        try:
            body = e.read(1500).decode("utf-8", errors="ignore")
        except Exception:
            body = str(e)
        return ProbeRow(
            ts=now_iso(),
            target=url,
            kind="http",
            status=f"HTTP_{e.code}",
            latency_ms=round(latency_ms, 2),
            details=body[:300].replace("\n", " "),
        )
    except Exception as e:
        latency_ms = (time.perf_counter() - started) * 1000
        return ProbeRow(
            ts=now_iso(),
            target=url,
            kind="http",
            status="NETWORK_ERROR",
            latency_ms=round(latency_ms, 2),
            details=str(e),
        )


def db_probe(conn_str: str, timeout_sec: int) -> list[ProbeRow]:
    rows: list[ProbeRow] = []
    if not psycopg2:
        rows.append(
            ProbeRow(
                ts=now_iso(),
                target="neon",
                kind="db",
                status="DRIVER_MISSING",
                latency_ms=None,
                details="psycopg2 tapılmadı. pip install psycopg2-binary edin.",
            )
        )
        return rows

    started = time.perf_counter()
    conn = None
    try:
        conn = psycopg2.connect(conn_str, connect_timeout=timeout_sec)
        conn.autocommit = True
        cur = conn.cursor()

        cur.execute("SELECT 1")
        ping_ms = (time.perf_counter() - started) * 1000
        rows.append(
            ProbeRow(
                ts=now_iso(),
                target="neon",
                kind="db",
                status="OK",
                latency_ms=round(ping_ms, 2),
                details="DB ping OK",
            )
        )

        cur.execute(
            """
            SELECT
              COUNT(*)::int AS total_conn,
              COUNT(*) FILTER (WHERE state='active')::int AS active_conn,
              MAX(EXTRACT(EPOCH FROM (NOW() - query_start)) * 1000)::float AS longest_active_query_ms
            FROM pg_stat_activity
            WHERE datname = current_database();
            """
        )
        total_conn, active_conn, longest_active_query_ms = cur.fetchone()
        rows.append(
            ProbeRow(
                ts=now_iso(),
                target="neon",
                kind="db",
                status="STAT_ACTIVITY",
                latency_ms=None,
                details=f"total_conn={total_conn}, active_conn={active_conn}, longest_active_query_ms={round(float(longest_active_query_ms or 0.0), 2)}",
            )
        )

        try:
            cur.execute(
                """
                SELECT query, calls, total_exec_time, mean_exec_time
                FROM pg_stat_statements
                ORDER BY total_exec_time DESC
                LIMIT 3;
                """
            )
            top = cur.fetchall()
            for i, (q, calls, total_exec, mean_exec) in enumerate(top, start=1):
                rows.append(
                    ProbeRow(
                        ts=now_iso(),
                        target="neon",
                        kind="db",
                        status=f"TOP_QUERY_{i}",
                        latency_ms=float(mean_exec or 0.0),
                        details=f"calls={calls}, total_exec_ms={round(float(total_exec or 0.0), 2)}, query={(q or '')[:180]}",
                    )
                )
        except Exception as e:
            rows.append(
                ProbeRow(
                    ts=now_iso(),
                    target="neon",
                    kind="db",
                    status="PG_STAT_STATEMENTS_UNAVAILABLE",
                    latency_ms=None,
                    details=str(e),
                )
            )
    except Exception as e:
        rows.append(
            ProbeRow(
                ts=now_iso(),
                target="neon",
                kind="db",
                status="DB_ERROR",
                latency_ms=None,
                details=str(e),
            )
        )
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    return rows


def ensure_history() -> list[ProbeRow]:
    if "live_history" not in st.session_state:
        st.session_state.live_history = []
    return st.session_state.live_history


def main() -> None:
    st.set_page_config(page_title="iRonWaves Live Monitor", layout="wide")
    st.title("iRonWaves Live Monitor")
    st.caption("Backend + Frontend + Neon vəziyyətini canlı izlə.")

    with st.sidebar:
        st.header("Konfiqurasiya")
        backend_base = normalize_base_url(st.text_input("Backend URL", value="https://ironwaves-pos-platform-production.up.railway.app"))
        frontend_base = normalize_base_url(st.text_input("Frontend URL", value=""))
        backend_paths_text = st.text_area(
            "Backend endpoint-lər (hər sətirdə bir path)",
            value="/health\n/api/v1/auth/me\n/api/v1/ops/tables\n/api/v1/restaurant/floor-plans",
            height=140,
        )
        tenant_domain = st.text_input("x-tenant-domain (opsional)", value="")
        bearer_token = st.text_input("Bearer token (opsional)", value="", type="password")
        neon_conn = st.text_input("Neon connection string (opsional)", value="", type="password")
        timeout_sec = st.slider("Timeout (saniyə)", 3, 45, 15)
        verify_ssl = st.checkbox("SSL doğrulamasını aktiv saxla", value=True)
        auto_refresh = st.checkbox("Canlı auto-refresh", value=False)
        interval_sec = st.slider("Refresh interval (saniyə)", 3, 60, 10)

    headers: dict[str, str] = {}
    if tenant_domain.strip():
        headers["x-tenant-domain"] = tenant_domain.strip()
    if bearer_token.strip():
        headers["Authorization"] = f"Bearer {bearer_token.strip()}"

    col_a, col_b, col_c = st.columns([1, 1, 1])
    run_now = col_a.button("Probe et", type="primary", use_container_width=True)
    clear = col_b.button("Tarixçəni sil", use_container_width=True)
    export = col_c.button("JSON export hazırla", use_container_width=True)

    history = ensure_history()
    if clear:
        st.session_state.live_history = []
        history = st.session_state.live_history

    if run_now:
        new_rows: list[ProbeRow] = []
        if backend_base:
            for p in [x.strip() for x in backend_paths_text.splitlines() if x.strip()]:
                url = f"{backend_base}{p if p.startswith('/') else '/' + p}"
                new_rows.append(http_probe(url, timeout_sec, headers=headers, verify_ssl=verify_ssl))
        if frontend_base:
            new_rows.append(http_probe(frontend_base, timeout_sec, verify_ssl=verify_ssl))
        if neon_conn.strip():
            new_rows.extend(db_probe(neon_conn.strip(), timeout_sec))
        st.session_state.live_history = (history + new_rows)[-2000:]
        history = st.session_state.live_history

    if auto_refresh:
        time.sleep(interval_sec)
        st.rerun()

    if not history:
        st.info("Konfiqurasiya daxil et və 'Probe et' bas.")
        return

    flat = [asdict(r) for r in history]

    recent = flat[-150:]
    ok_count = sum(1 for r in recent if str(r["status"]).startswith("2") or r["status"] in ("OK", "STAT_ACTIVITY"))
    err_count = len(recent) - ok_count
    lat_values = [float(r["latency_ms"]) for r in recent if r["latency_ms"] is not None]
    avg_lat = round(sum(lat_values) / len(lat_values), 2) if lat_values else 0.0

    m1, m2, m3 = st.columns(3)
    m1.metric("Son 150 probe OK", str(ok_count))
    m2.metric("Son 150 probe xəta", str(err_count))
    m3.metric("Orta latency (ms)", str(avg_lat))

    st.subheader("Son nəticələr")
    st.dataframe(recent[::-1], use_container_width=True, hide_index=True)

    if export:
        payload = json.dumps(flat, ensure_ascii=False, indent=2)
        st.download_button(
            "JSON yüklə",
            data=payload.encode("utf-8"),
            file_name=f"live_monitor_{int(time.time())}.json",
            mime="application/json",
        )


if __name__ == "__main__":
    main()
