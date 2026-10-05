"""Finance v2 tenant cut-over readiness gate.

Read-only. Reports a tenant's migration posture and the two go/no-go verdicts
(``can_switch_to_dual`` / ``can_switch_reports_to_gl``) with the reasons any
failed condition contributes. Writes nothing to the database.

Usage (from backend/):
    python scripts/gl_readiness.py --tenant <id>
    python scripts/gl_readiness.py --tenant <id> --json
    python scripts/gl_readiness.py --tenant <id> --allow-production

Like scripts/gl_ledger_mode.py, it refuses a Railway/production DATABASE_URL
unless ``--allow-production`` is given (returns code 2). Exit code is 0 when both
verdicts resolve without error, otherwise non-zero.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.gl.readiness import readiness  # noqa: E402
from scripts.gl_migrate_legacy import _is_production  # noqa: E402


def _verdict_line(name: str, verdict: dict) -> str:
    head = f"{name}: {'YES' if verdict['ok'] else 'NO'}"
    if verdict["ok"]:
        return head
    return head + "".join(f"\n    - {reason}" for reason in verdict["reasons"])


def _human(report: dict) -> str:
    lines = [
        f"Tenant:                 {report['tenant_id']}",
        f"Ledger mode:            {report['ledger_mode']}",
        f"Reports source:         {report['reports_source']}",
        f"Chart present:          {report['chart_present']}",
        f"Clean reconcile streak: {report['clean_reconciliation_streak']}",
        f"Native errors (7d):     {report['native_error_count_7d']}",
        f"Pending journals:       {report['pending_journals']}",
        f"Unassigned AP:          {report['unassigned_ap']}",
        f"Negative wallets:       {len(report['negative_wallets'])}",
        f"Shadow sync lag (s):    {report['shadow_sync_lag_seconds']}",
    ]
    recon = report.get("current_reconcile")
    if recon is not None:
        failed = [c["check"] for c in recon.get("checks", []) if not c.get("ok")]
        lines.append(f"Current reconcile:      ok={recon.get('ok')} failed={failed}")
    parity = report.get("parity")
    if parity is not None:
        lines.append(f"Parity:                 ok={parity.get('ok')} unexplained={parity.get('unexplained')}")
    for wallet in report["negative_wallets"]:
        lines.append(f"  negative wallet: {wallet['code']} {wallet['name']} = {wallet['balance']}")
    lines.append("")
    lines.append(_verdict_line("can_switch_to_dual     ", report["can_switch_to_dual"]))
    lines.append(_verdict_line("can_switch_reports_to_gl", report["can_switch_reports_to_gl"]))
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--json", action="store_true", help="emit the full readiness report as JSON")
    parser.add_argument("--allow-production", action="store_true")
    args = parser.parse_args()

    if _is_production(settings.database_url) and not args.allow_production:
        print("Refusing to run against a Railway/production database without --allow-production", file=sys.stderr)
        return 2

    with SessionLocal() as db:
        report = readiness(db, args.tenant)
        db.rollback()  # read-only: discard anything a reused reader touched

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(_human(report))

    both_ok = report["can_switch_to_dual"]["ok"] and report["can_switch_reports_to_gl"]["ok"]
    return 0 if both_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
