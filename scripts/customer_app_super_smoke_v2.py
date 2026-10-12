#!/usr/bin/env python3
"""Customer-app smoke v2 — SUPER production, **zero-leak** deep pass (D orders, C epoint).

Why no real pre-order: `POST /customer-app/pre-order` writes a KitchenOrder and fires
`_notify_front_of_house` — on a live tenant that pings real staff in the KDS. So D is
verified through its guards (400s) instead of a write. Same for campaigns/rewards
(real activation would leave an orphan `campaign_activations` row keyed by card_id,
which `delete-account` does NOT clean).

Every check below is either read-only or writes only to the temp customer's own row
(cleaned by `delete-account`). Cleanup is asserted at the end.

Usage:
  APIBASE=https://ironwaves-pos-platform-production.up.railway.app \
  TENANT_DOMAIN=super.ironwaves.store \
  python3 scripts/customer_app_super_smoke_v2.py
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


def call(method, path, *, query=None, body=None):
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


def check(name, ok, extra=""):
    results.append((name, ok, extra))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{extra}]" if extra else ""))


def main() -> int:
    email = f"smoke2-{secrets.token_hex(5)}@example.com"

    # ── A. onboarding ────────────────────────────────────────────────────────
    st, body = call("POST", "/customer-app/enroll", body={
        "email": email, "consent_accepted": True, "registration_mode": "simple"})
    check("A1 enroll 200", st == 200, f"status={st} {str(body)[:100]}")
    if st != 200:
        print("ABORT: enroll failed")
        return 1
    card, token = body["card_id"], body["token"]

    # A2 duplicate email: 409 is only the gate when registration_mode == "full"
    # (F5.1 — email is the identity there). Super runs "simple", where email is an
    # optional contact field, so the correct assertion is: a second enroll returns a
    # NEW distinct card+token and NEVER the first customer's token (no takeover).
    st2, boot = call("GET", "/customer-app/bootstrap")
    mode = str(boot.get("registration_mode") or "")
    st, body = call("POST", "/customer-app/enroll", body={
        "email": email, "consent_accepted": True, "registration_mode": mode or "simple"})
    if mode == "full":
        check("A2 duplicate email 409 (full mode, F5.1)", st == 409, f"status={st}")
    else:
        new_card = body.get("card_id")
        check(f"A2 duplicate email in '{mode}' mode → new card, no token leak",
              st == 200 and new_card and new_card != card and body.get("token") != token,
              f"status={st} new={new_card} distinct={new_card != card}")
        if st == 200 and new_card and new_card != card:
            # clean the duplicate immediately — it is a second test row
            call("POST", "/customer-app/delete-account",
                 body={"card_id": new_card, "token": body.get("token")})

    try:
        # ── Rich session read (stores / campaigns / wallet / tier) ───────────
        st, sess = call("GET", "/customer-app/session", query={"id": card, "t": token})
        check("S1 session 200", st == 200, f"status={st}")
        cust = sess.get("customer") or {}
        stores = sess.get("stores") or []
        wallet = sess.get("wallet") or {}
        check("S2 stores non-empty", isinstance(stores, list) and len(stores) > 0,
              f"stores={len(stores)} first={(stores[0] or {}).get('name') if stores else None}")
        check("S3 store has id (F5.2 filial)", bool(stores) and bool(stores[0].get("id")),
              f"id={stores[0].get('id') if stores else None}")
        check("S4 tier present", bool(cust.get("tier")), f"tier={cust.get('tier')}")
        check("S5 wallet program_mode", bool(wallet.get("program_mode")),
              f"mode={wallet.get('program_mode')} cashback%={wallet.get('cashback_percent')}")
        check("S6 wallet rewards catalog", isinstance(wallet.get("rewards"), list),
              f"rewards={len(wallet.get('rewards') or [])}")
        check("S7 push_prefs 3 channels",
              set((cust.get("push_prefs") or {}).keys()) == {"push", "email", "sms"},
              f"prefs={cust.get('push_prefs')}")
        check("S8 history list", isinstance(sess.get("history"), list),
              f"history={len(sess.get('history') or [])}")

        store_id = str((stores[0] or {}).get("id") or "") if stores else ""

        # ── D. Orders — guards only, NO write (would ping live KDS) ──────────
        st, body = call("GET", "/customer-app/orders", query={"id": card, "t": token})
        check("D1 orders 200 + empty list for fresh card",
              st == 200 and isinstance(body, list) and len(body) == 0,
              f"status={st} n={len(body) if isinstance(body, list) else '?'}")

        st, body = call("POST", "/customer-app/pre-order", query={"id": card, "t": token},
                        body={"items": [], "store_id": store_id})
        check("D2 empty cart 400", st == 400, f"status={st} {str(body)[:80]}")

        st, body = call("POST", "/customer-app/pre-order", query={"id": card, "t": token},
                        body={"items": [{"id": "no-such-item", "name": "Ghost", "quantity": 1}]})
        check("D3 missing store_id 400 (F5.2)", st == 400, f"status={st} {str(body)[:80]}")

        st, body = call("POST", "/customer-app/pre-order", query={"id": card, "t": token},
                        body={"items": [{"id": "no-such-item", "name": "Ghost", "quantity": 1}],
                              "store_id": store_id})
        check("D4 unknown menu item 400 (server price path)",
              st == 400 and "tapılmadı" in json.dumps(body, ensure_ascii=False),
              f"status={st} {str(body)[:80]}")

        st, body = call("POST", "/customer-app/pre-order", query={"id": card, "t": "WRONGTOKEN"},
                        body={"items": [{"id": "x", "name": "x"}], "store_id": store_id})
        check("D5 pre-order wrong token 401", st == 401, f"status={st}")

        # ── C. epoint payment — config + guard checks, no money ──────────────
        st, body = call("POST", "/customer-app/payment/create",
                        body={"card_id": card, "token": token, "order_id": "no-such-order"})
        check("C1 payment/create 503 when epoint off / 404 when on (never 5xx-other)",
              st in (503, 404), f"status={st} {str(body)[:90]}")
        epoint_off = st == 503

        st, body = call("POST", "/customer-app/payment/status",
                        body={"card_id": card, "token": token, "transaction": "no-such-tx"})
        check("C2 payment/status 503 when epoint off / 404 when on",
              st in (503, 404), f"status={st}")

        if epoint_off:
            st, body = call("POST", "/customer-app/payment/create",
                            body={"card_id": card, "token": "WRONG", "order_id": "x"})
            check("C2b epoint-off guard fires BEFORE auth (503, no info leak)",
                  st == 503, f"status={st}")

        # callback route must exist: wrong/missing form → 422, never 404
        req = urllib.request.Request(BASE + PREFIX + "/customer-app/payment/callback", data=b"", method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("x-tenant-domain", DOMAIN)
        try:
            with urllib.request.urlopen(req) as r:
                cb = r.status
        except urllib.error.HTTPError as e:
            cb = e.code
        check("C3 payment/callback route registered (422 not 404)", cb == 422, f"status={cb}")

        # ── F. campaigns / rewards — guards, no orphan rows ───────────────────
        st, body = call("POST", "/customer-app/campaigns/does-not-exist/activate",
                        query={"id": card, "t": token})
        check("F1 activate unknown campaign 404", st == 404, f"status={st}")

        st, body = call("POST", "/customer-app/rewards/claim",
                        query={"id": card, "t": token}, body={"reward_id": "made-up-id"})
        check("F2 claim unknown reward 404", st == 404, f"status={st}")

        st, body = call("DELETE", "/customer-app/campaigns/x/activate",
                        query={"id": card, "t": token})
        check("F3 activate rejects wrong method (405)", st == 405, f"status={st}")

        # ── G. push engagement ────────────────────────────────────────────────
        st, body = call("POST", "/customer-app/push-engagement", query={"id": card, "t": token},
                        body={"delivery_id": "smoke2-nonexistent"})
        check("G1 engagement unknown delivery not 500", st < 500, f"status={st}")
        st, body = call("POST", "/customer-app/push-engagement", query={"id": card, "t": token},
                        body={"delivery_id": ""})
        check("G2 engagement empty delivery 400", st == 400, f"status={st}")

        # ── E. profile / prefs (own row only) ────────────────────────────────
        st, body = call("POST", "/customer-app/profile/name", query={"id": card, "t": token},
                        body={"name": "Smoke2 Tester"})
        check("E1 set name 200", st == 200, f"status={st}")
        st, body = call("POST", "/customer-app/profile/birthday", query={"id": card, "t": token},
                        body={"birth_date": "1995-04-17"})
        check("E2 set birthday 200", st == 200, f"status={st}")
        st, body = call("POST", "/customer-app/preferences", query={"id": card, "t": token},
                        body={"sms": True, "email": True})
        check("E3 prefs push/email/sms 200", st == 200, f"status={st}")
        st, sess = call("GET", "/customer-app/session", query={"id": card, "t": token})
        prefs = (sess.get("customer") or {}).get("push_prefs") or {}
        check("E4 prefs reflected + name + birthday",
              prefs.get("sms") is True and prefs.get("email") is True
              and (sess.get("customer") or {}).get("name") == "Smoke2 Tester"
              and (sess.get("customer") or {}).get("birth_date") == "1995-04-17",
              f"prefs={prefs} name={(sess.get('customer') or {}).get('name')}")

        # ── Wallet pass must match bootstrap's wallet_pass_enabled ────────────
        st, boot = call("GET", "/customer-app/bootstrap")
        enabled = bool(boot.get("wallet_pass_enabled"))
        st, body = call("GET", "/customer-app/wallet-pass", query={"id": card, "t": token})
        check("W1 wallet-pass consistent with bootstrap flag",
              (enabled and st == 200) or (not enabled and st == 503),
              f"flag={enabled} status={st}")

        # ── B. auth hardening ────────────────────────────────────────────────
        st, body = call("GET", "/customer-app/session", query={"id": card, "t": "WRONG"})
        check("B1 wrong token 401", st == 401, f"status={st}")
        st, body = call("GET", "/customer-app/session", query={"id": card})
        check("B2 missing token 4xx not 5xx", 400 <= st < 500, f"status={st}")
        st, body = call("POST", "/customer-app/preferences", body={"sms": True})
        check("B3 prefs without auth 4xx", 400 <= st < 500, f"status={st}")

        print(f"NOTE epoint configured: {not epoint_off}")
        return 0
    finally:
        st, body = call("POST", "/customer-app/delete-account",
                        body={"card_id": card, "token": token})
        print(f"CLEANUP delete-account status={st} body={str(body)[:80]}")
        st, _ = call("GET", "/customer-app/session", query={"id": card, "t": token})
        print(("CLEANUP OK card gone" if st == 401 else f"CLEANUP WARNING card still reachable status={st}"))
        if st != 401:
            results.append(("CLEANUP card gone", False, f"status={st}"))


if __name__ == "__main__":
    rc = main()
    failed = [r for r in results if not r[1]]
    print(f"\nTOTAL {len(results) - len(failed)}/{len(results)} PASS")
    for name, _, extra in failed:
        print(f"  FAILED: {name} [{extra}]")
    sys.exit(1 if failed or rc else 0)
