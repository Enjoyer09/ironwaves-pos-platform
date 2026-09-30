"""Import the legacy finance ledger into Finance v2 (GL) and reconcile it.

Usage (from backend/):
    python scripts/gl_migrate_legacy.py --all --dry-run
    python scripts/gl_migrate_legacy.py --tenant <id> --report-dir /tmp/gl-report

Safety:
* Refuses to touch a Railway-hosted database unless --allow-production is given.
* --dry-run imports inside a transaction, runs the full reconciliation and
  then ROLLS BACK: nothing is persisted.
* Without --dry-run, each tenant is committed only if its reconciliation passes;
  otherwise that tenant is rolled back and the script exits non-zero.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.gl.legacy_migration import migrate_tenant, open_items, reconcile_tenant  # noqa: E402
from app.models import FinanceTransaction, Tenant  # noqa: E402

PRODUCTION_HOST_MARKERS = ("railway.internal", "rlwy.net", "railway.app")


def _is_production(url: str) -> bool:
    host = (urlparse(url.replace("+psycopg2", "")).hostname or "").lower()
    return any(marker in host for marker in PRODUCTION_HOST_MARKERS)


def _markdown(summary: dict) -> str:
    out = [f"# GL legacy migration report — {summary['started_at']}", "",
           f"Mode: **{'DRY RUN (rolled back)' if summary['dry_run'] else 'COMMITTED'}** · duration {summary['duration_s']}s", ""]
    for t in summary["tenants"]:
        status = "✅ OK" if t["reconciliation"]["ok"] else "❌ FAILED"
        out += [f"## {t['name']} ({t['tenant_id']}) — {status}", "",
                f"Imported {t['migration']['imported']}, already present {t['migration']['skipped_existing']}, "
                f"reversal links {t['migration']['reversal_links']}", "",
                "| Check | Legacy | GL | OK |", "|---|---|---|---|"]
        out += [f"| {c['check']} | {c['legacy']} | {c['gl']} | {'✅' if c['ok'] else '❌'} |" for c in t["reconciliation"]["checks"]]
        low = t["migration"]["lowest_balances"]
        if low:
            out += ["", "Lowest historic balances: " + ", ".join(f"{k} {v['amount']} ({v['date']})" for k, v in low.items())]
        for f in t["migration"]["flagged"]:
            out.append(f"- ⚠️ {f['date']} {f['amount']} ₼ — {f['reason']} (legacy {f['legacy_id']})")
        items = t["open_items"]
        if items["unposted_legacy_transactions"]:
            out += ["", "**Not migrated (not posted in legacy):**"]
            out += [f"- {i['status']} {i['type']} {i['amount']} ₼ by {i['created_by']} at {i['created_at']} — {i['note'] or ''}" for i in items["unposted_legacy_transactions"]]
        if items["wallet_rows_without_ledger"]:
            out += ["", f"**Legacy wallet rows that never reached the ledger:** {len(items['wallet_rows_without_ledger'])}"]
            out += [f"- {i['created_at']} {i['type']} {i['category']} {i['source']} {i['amount']} ₼ — {i['description']}" for i in items["wallet_rows_without_ledger"]]
        out.append("")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--tenant", action="append", help="tenant id (repeatable)")
    target.add_argument("--all", action="store_true", help="all tenants that have legacy finance transactions")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-production", action="store_true")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--report-dir", default=".")
    args = parser.parse_args()

    if _is_production(settings.database_url) and not args.allow_production:
        print("Refusing to run against a Railway/production database without --allow-production", file=sys.stderr)
        return 2

    started = time.time()
    summary = {"started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "dry_run": args.dry_run, "tenants": []}
    failed = False
    with SessionLocal() as db:
        if args.all:
            tenant_ids = [tid for (tid,) in db.query(FinanceTransaction.tenant_id).group_by(FinanceTransaction.tenant_id).having(func.count() > 0).all()]
        else:
            tenant_ids = args.tenant
        names = {t.id: t.name for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()}
        for tid in tenant_ids:
            t0 = time.time()
            # In a real run we still import inside one transaction per tenant and
            # commit only after reconciliation passes (batch commits disabled).
            result = migrate_tenant(db, tid, batch_size=args.batch_size, commit=False)
            db.flush()
            recon = reconcile_tenant(db, tid)
            items = open_items(db, tid)
            if args.dry_run or not recon["ok"]:
                db.rollback()
            else:
                db.commit()
            failed = failed or not recon["ok"]
            summary["tenants"].append({"tenant_id": tid, "name": names.get(tid, tid), "migration": result.as_dict(),
                                       "reconciliation": recon, "open_items": items, "duration_s": round(time.time() - t0, 1)})
            print(f"{names.get(tid, tid):<32} imported={result.imported:<6} existing={result.skipped_existing:<6} "
                  f"recon={'OK' if recon['ok'] else 'FAILED'} ({time.time() - t0:.1f}s)")
    summary["duration_s"] = round(time.time() - started, 1)

    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    (report_dir / f"gl-migration-{stamp}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
    (report_dir / f"gl-migration-{stamp}.md").write_text(_markdown(summary))
    print(f"Report: {report_dir / f'gl-migration-{stamp}.md'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
