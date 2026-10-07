"""Show or switch a tenant's Finance v2 ledger mode (legacy | dual) and its per-tenant Finance v2 flags.

Usage (from backend/):
    python scripts/gl_ledger_mode.py --list
    python scripts/gl_ledger_mode.py --tenant <id> --set dual --reason "pilot" [--allow-production]
    python scripts/gl_ledger_mode.py --tenant <id> --reconcile
    python scripts/gl_ledger_mode.py --tenant <id> --ui visible|hidden --reason "..." [--allow-production]
    python scripts/gl_ledger_mode.py --tenant <id> --require-supplier on|off --reason "..." [--allow-production]

``--set dual`` creates the chart of accounts when the tenant has none, mirrors the legacy ledger (incremental), switches
the mode and verifies the tenant reconciles, all in ONE transaction: if the reconciliation fails nothing is kept (no
chart, no mirror, no mode). ``--set legacy`` warns when the tenant owns native journals; they stay in the GL.

``--ui`` (default hidden everywhere) decides whether a dual tenant's users may open the Finance v2 module; super_admin
always can. ``--require-supplier`` (default off) decides whether stock receipts must name a supplier. Both are audited in
the GL hash chain and refuse a production database without ``--allow-production``.

The reconciler follows the tenant's history: a tenant that is dual now or ever was is judged by the dual reconciler.
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
from app.gl import engine as gl_engine  # noqa: E402
from app.gl.engine import GLError  # noqa: E402
from app.gl.legacy_migration import migrate_tenant, reconcile_dual_tenant, reconcile_for_tenant  # noqa: E402
from app.gl.shadow import sync_tenant  # noqa: E402
from app.models import FinanceTransaction, Tenant  # noqa: E402
from scripts.gl_migrate_legacy import _is_production  # noqa: E402

NO_CHART_HELP = ("Tenant has no chart of accounts; run --set dual (creates it) or "
                 "scripts/gl_migrate_legacy.py --tenant {tenant}")
NATIVE_JOURNALS_WARNING = (
    "WARNING: this tenant has {count} native journal(s) in the GL (not mirrored from legacy). They STAY in the GL after "
    "the switch to legacy; the GL screens keep showing them; new legacy activity is mirrored by the shadow job; and the "
    "nightly check keeps using the dual reconciler because the tenant has been dual. This is not a full rewind. To stop "
    "serving GL numbers use --reports legacy."
)


def _summary(report: dict) -> str:
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    return f"ok={report['ok']} checks={len(report['checks']) - len(failed)}/{len(report['checks'])} failed={failed}"


def _refuse_production(args) -> bool:
    if _is_production(settings.database_url) and not args.allow_production:
        print("Refusing to change a production tenant without --allow-production", file=sys.stderr)
        return True
    return False


def _has_chart(db, tenant_id: str) -> bool:
    try:
        gl_engine.accounts_by_role(db, tenant_id)
    except GLError:
        return False
    return True


def _set_flag(db, args, setter, value: bool) -> int:
    """Shared body of --ui / --require-supplier: unknown tenant and blank reason are refused, nothing is half-written."""
    if db.get(Tenant, args.tenant) is None:
        print(f"Unknown tenant: {args.tenant}", file=sys.stderr)
        return 1
    try:
        result = setter(db, args.tenant, value, actor="system:cli", reason=args.reason or "")
        db.commit()
    except GLError as exc:
        db.rollback()
        print(f"ABORTED — {exc.message}", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


def _switch_mode(db, args) -> int:
    if db.get(Tenant, args.tenant) is None:
        print(f"Unknown tenant: {args.tenant}", file=sys.stderr)
        return 1
    if args.set == "legacy" and read_model.reports_source(db, args.tenant) == "gl":
        print("Switch reports back to legacy first (--reports legacy)", file=sys.stderr)
        return 1
    if args.set == "legacy":
        native = bridge.native_journal_count(db, args.tenant)
        if native:
            print(NATIVE_JOURNALS_WARNING.format(count=native), file=sys.stderr)
    try:
        # One transaction: chart (idempotent) -> catch-up mirror -> mode -> independent reconciliation.
        gl_engine.ensure_chart(db, args.tenant, actor="system:cli")
        migrate_tenant(db, args.tenant, commit=False, incremental=True)
        result = bridge.set_ledger_mode(db, args.tenant, args.set, actor="system:cli", reason=args.reason or "")
        report = reconcile_for_tenant(db, args.tenant)
    except GLError as exc:
        db.rollback()
        print(f"ABORTED — {exc.message}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - a CLI must end with a clear line, and the transaction must not stay open
        db.rollback()
        print(f"ABORTED — {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    if not report["ok"]:
        db.rollback()
        print(f"ABORTED — reconciliation failed after switch: {_summary(report)}", file=sys.stderr)
        return 1
    db.commit()
    print(json.dumps(result), _summary(report))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--tenant")
    parser.add_argument("--set", choices=bridge.LEDGER_MODES)
    parser.add_argument("--reason")
    parser.add_argument("--reconcile", action="store_true")
    parser.add_argument("--parity", action="store_true", help="legacy vs GL numbers served to finance screens")
    parser.add_argument("--reports", choices=read_model.REPORT_SOURCES, help="switch the reports source (gl requires dual + clean parity)")
    parser.add_argument("--ui", choices=("visible", "hidden"), help="show or hide the Finance v2 module for a dual tenant (default hidden)")
    parser.add_argument("--require-supplier", choices=("on", "off"), dest="require_supplier",
                        help="require a supplier on every stock receipt of this tenant (default off)")
    parser.add_argument("--allow-production", action="store_true")
    args = parser.parse_args(argv)

    with SessionLocal() as db:
        if args.list:
            ids = {tid for (tid,) in db.query(FinanceTransaction.tenant_id).distinct().all()}
            for t in db.query(Tenant).filter(Tenant.id.in_(ids)).order_by(Tenant.name).all():
                ui = "visible" if bridge.is_ui_visible(db, t.id) else "hidden"
                supplier = "on" if bridge.require_supplier(db, t.id) else "off"
                print(f"{t.name:<32} {t.id}  mode={bridge.get_ledger_mode(db, t.id):<7} reports={read_model.reports_source(db, t.id)}"
                      f" ui={ui} require_supplier={supplier}")
            return 0
        if not args.tenant:
            parser.error("--tenant is required")
        if args.parity:
            report = read_model.parity_report(db, args.tenant)
            db.rollback()
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report["ok"] else 1
        if args.reports:
            if _refuse_production(args):
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
        if args.ui:
            if _refuse_production(args):
                return 2
            return _set_flag(db, args, bridge.set_ui_visible, args.ui == "visible")
        if args.require_supplier:
            if _refuse_production(args):
                return 2
            return _set_flag(db, args, bridge.set_require_supplier, args.require_supplier == "on")
        if args.set:
            if _refuse_production(args):
                return 2
            return _switch_mode(db, args)
        if db.get(Tenant, args.tenant) is None:
            print(f"Unknown tenant: {args.tenant}", file=sys.stderr)
            return 1
        if not _has_chart(db, args.tenant):
            print(NO_CHART_HELP.format(tenant=args.tenant), file=sys.stderr)
            return 1
        mode = bridge.get_ledger_mode(db, args.tenant)
        report = reconcile_for_tenant(db, args.tenant)
        db.rollback()
        print(f"mode={mode}", f"reconciler={report['reconciler']} ever_dual={report['ever_dual']}", _summary(report))
        if report.get("explained_differences"):
            print("explained differences:", json.dumps(report["explained_differences"], ensure_ascii=False))
        return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
