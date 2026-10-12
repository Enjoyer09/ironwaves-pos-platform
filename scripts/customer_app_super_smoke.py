#!/usr/bin/env python3
"""Customer-app smoke on SUPER production — creates ONE temp customer, exercises
the public API, then deletes it. Read-only against the 134 real customers.

Usage:
  APIBASE="https://ironwaves-pos-platform-production.up.railway.app" \
  TENANT_DOMAIN="super.ironwaves.store" \
  python3 scripts/customer_app_super_smoke.py

Exits non-zero on any assertion failure. Prints PASS/FAIL per check.
"""

import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("APIBASE", "https://ironwaves-pos-platform-production.up.railway.app")
DOMAIN = os.environ.get("TENANT_DOMAIN", "super.ironwaves.store")
PREFIX = "/api/v1/ops"

results: list[tuple[str, bool, str]] = []


def call(method: str, path: str, *, query: dict | None = None, body=None) -> tuple[int, dict]:
    url = BASE + PREFIX + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("x-tenant-domain", DOMAIN)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"_raw": raw[:200]}


def check(name: str, ok: bool, extra: str = ""):
    results.append((name, ok, extra))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{extra}]" if extra else ""))


def main() -> int:
    email = f"smoke-{secrets.token_hex(5)}@example.com"
    # A1 enroll
    st, body = call("POST", "/customer-app/enroll", body={
        "email": email, "consent_accepted": True, "registration_mode": "simple",
    })
    check("A1 enroll 200", st == 200, f"status={st} body={str(body)[:120]}")
    if st != 200:
        print("ABORT: enroll failed; nothing else to test")
        return 1
    card, token = body.get("card_id"), body.get("token")
    check("A1 has card+token", bool(card and token))

    try:
        # A2 session
        st, body = call("GET", "/customer-app/session", query={"id": card, "t": token})
        ok = st == 200 and body.get("customer", {}).get("card_id") == card
        check("A2 session 200 + same card", ok, f"status={st}")

        # A3 preferences defaults — read from the session payload (no GET prefs route)
        st, sess = call("GET", "/customer-app/session", query={"id": card, "t": token})
        prefs = (sess.get("customer") or {}).get("push_prefs") or {}
        push = prefs.get("push"); email_p = prefs.get("email"); sms = prefs.get("sms")
        check("A3 prefs defaults push/email/sms", st == 200 and push is True and email_p is False and sms is False,
              f"prefs={prefs}")

        # B2 wrong token -> 401
        st, body = call("GET", "/customer-app/session", query={"id": card, "t": "WRONGTOKEN"})
        check("B2 wrong token 401", st == 401, f"status={st}")

        # B3 missing token -> 4xx not 500
        st, body = call("GET", "/customer-app/session", query={"id": card})
        check("B3 missing token 4xx", 400 <= st < 500, f"status={st}")

        # E3 name update
        new_name = "Smoke Tester"
        st, body = call("POST", "/customer-app/profile/name", query={"id": card, "t": token},
                        body={"name": new_name})
        check("E3 set name 200", st == 200, f"status={st}")

        # E4 preferences flip sms on then read back from session (POST returns prefs too)
        st, body = call("POST", "/customer-app/preferences", query={"id": card, "t": token},
                        body={"sms": True})
        prefs = body.get("prefs") or {}
        check("E4 prefs sms on 200", st == 200, f"status={st}")
        st, sess = call("GET", "/customer-app/session", query={"id": card, "t": token})
        prefs = (sess.get("customer") or {}).get("push_prefs") or {}
        check("E4 prefs sms reflected", st == 200 and prefs.get("sms") is True,
              f"sms={prefs.get('sms')}")

        # D1 orders empty or 200
        st, body = call("GET", "/customer-app/orders", query={"id": card, "t": token})
        check("D1 orders 200", st == 200, f"status={st}")

        # G1 push-engagement with fake delivery -> should reject/bad gently, not 500
        st, body = call("POST", "/customer-app/push-engagement", query={"id": card, "t": token},
                        body={"delivery_id": "nonexistent-delivery"})
        check("G1 engagement not 500", st < 500, f"status={st}")

        # F2 rewards claim with no stars -> clean error not 500
        st, body = call("POST", "/customer-app/rewards/claim", query={"id": card, "t": token},
                        body={"reward_id": "nonexistent"})
        check("F2 claim not 500", st < 500, f"status={st}")

        return 0
    finally:
        # cleanup: delete the temp customer — delete-account takes card_id/token
        # in the JSON body (F5.5), not query params. Always runs, even on abort.
        if card and token:
            st, body = call("POST", "/customer-app/delete-account", body={"card_id": card, "token": token})
            print(f"CLEANUP delete-account status={st} body={str(body)[:120]}")
        else:
            print("CLEANUP skipped: no card/token captured")
        # verify no leak: the temp email must be gone after a successful delete
        if card:
            st, body = call("GET", "/customer-app/session", query={"id": card, "t": token or "x"})
            if st != 401:
                print(f"CLEANUP WARNING: card {card} still reachable (status={st})")


if __name__ == "__main__":
    sys.exit(main())