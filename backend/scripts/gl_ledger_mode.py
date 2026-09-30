"""Show or switch a tenant's Finance v2 ledger mode (legacy | dual).

Usage (from backend/):
    python scripts/gl_ledger_mode.py --list
    python scripts/gl_ledger_mode.py --tenant <id> --set dual --reason "pilot" [--allow-production]
    python scripts/gl_ledger_mode.py --tenant <id> --reconcile

Switching to dual first runs a shadow sync so no legacy posting is left
unmirrored, then verifies the tenant reconciles before committing the switch.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.gl import bridge, read_model  # noqa: E402
from app.gl.legacy_migration import reconcile_dual_tenant, reconcile_tenant  # noqa: E402
from app.gl.shadow import sync_tenant  # noqa: E402
from app.models import FinanceTransaction, Tenant  # noqa: E402
from scripts.gl_migrate_legacy import _is_production  # noqa: E402


def _summary(report: dict) -> str:
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    return f"ok={report['ok']} checks={len(report['checks']) - len(failed)}/{len(report['checks'])} failed={failed}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--tenant")
    parser.add_argument("--set", choices=bridge.LEDGER_MODES)
    parser.add_argument("--reason")
    parser.add_argument("--reconcile", action="store_true")
    parser.add_argument("--parity", action="store_true", help="legacy vs GL numbers served to finance screens")
    parser.add_argument("--reports", choices=read_model.REPORT_SOURCES, help="switch the reports source (gl requires dual + clean parity)")
    parser.add_argument("--allow-production", action="store_true")
    args = parser.parse_args()

    with SessionLocal() as db:
        if args.list:
            ids = {tid for (tid,) in db.query(FinanceTransaction.tenant_id).distinct().all()}
            for t in db.query(Tenant).filter(Tenant.id.in_(ids)).order_by(Tenant.name).all():
                print(f"{t.name:<32} {t.id}  mode={bridge.get_ledger_mode(db, t.id):<7} reports={read_model.reports_source(db, t.id)}")
            return 0
        if not args.tenant:
            parser.error("--tenant is required")
        if args.parity:
            report = read_model.parity_report(db, args.tenant)
            db.rollback()
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report["ok"] else 1
        if args.reports:
            if _is_production(settings.database_url) and not args.allow_production:
                print("Refusing to change a production tenant without --allow-production", file=sys.stderr)
                return 2
            sync_tenant(db, args.tenant)
            if args.reports == "gl":
                recon = reconcile_dual_tenant(db, args.tenant)
                parity = read_model.parity_report(db, args.tenant)
                if not recon["ok"] or not parity["ok"]:
                    db.rollback()
                    print(f"ABORTED — reconcile {_summary(recon)}; parity unexplained={parity['unexplained']}", file=sys.stderr)
                    return 1
            result = read_model.set_reports_source(db, args.tenant, args.reports, actor="system:cli", reason=args.reason or "")
            db.commit()
            print(json.dumps(result))
            return 0
        if args.set:
            if _is_production(settings.database_url) and not args.allow_production:
                print("Refusing to change a production tenant without --allow-production", file=sys.stderr)
                return 2
            if args.set == "legacy" and read_model.reports_source(db, args.tenant) == "gl":
                print("Switch reports back to legacy first (--reports legacy)", file=sys.stderr)
                return 1
            sync_tenant(db, args.tenant)  # catch up the shadow first
            result = bridge.set_ledger_mode(db, args.tenant, args.set, actor="system:cli", reason=args.reason or "")
            report = reconcile_dual_tenant(db, args.tenant) if args.set == "dual" else reconcile_tenant(db, args.tenant)
            if not report["ok"]:
                db.rollback()
                print(f"ABORTED — reconciliation failed after switch: {_summary(report)}", file=sys.stderr)
                return 1
            db.commit()
            print(json.dumps(result), _summary(report))
            return 0
        mode = bridge.get_ledger_mode(db, args.tenant)
        report = reconcile_dual_tenant(db, args.tenant) if mode == "dual" else reconcile_tenant(db, args.tenant)
        print(f"mode={mode}", _summary(report))
        if report.get("explained_differences"):
            print("explained differences:", json.dumps(report["explained_differences"], ensure_ascii=False))
        return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
