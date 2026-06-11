import sys
import os
import argparse
import json
from decimal import Decimal
from datetime import datetime

# Adjust sys.path to find 'app'
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db import SessionLocal, engine
from app.models import Tenant, FinanceTransaction, FinanceLedgerEntry, FinanceEntry, FinanceAccount, AuditLog
from app.services.finance_service import finance_account, post_finance_transaction_with_legacy_mirror

def get_ledger_balance(db, tenant_id, account_id, account_type):
    # Calculate balance from ledger entries
    debits = db.query(FinanceLedgerEntry.amount).filter(
        FinanceLedgerEntry.tenant_id == tenant_id,
        FinanceLedgerEntry.account_id == account_id,
        FinanceLedgerEntry.entry_side == "debit"
    ).all()
    credits = db.query(FinanceLedgerEntry.amount).filter(
        FinanceLedgerEntry.tenant_id == tenant_id,
        FinanceLedgerEntry.account_id == account_id,
        FinanceLedgerEntry.entry_side == "credit"
    ).all()
    
    debit_sum = sum((Decimal(str(d[0] or 0)) for d in debits), Decimal("0"))
    credit_sum = sum((Decimal(str(c[0] or 0)) for c in credits), Decimal("0"))
    
    # Assets: Debit - Credit
    # Liabilities/Equity/Revenue: Credit - Debit
    LIABILITY_OR_CREDIT_TYPES = {"liability", "equity", "revenue"}
    if account_type in LIABILITY_OR_CREDIT_TYPES:
        return (credit_sum - debit_sum).quantize(Decimal("0.01"))
    else:
        return (debit_sum - credit_sum).quantize(Decimal("0.01"))

def main():
    parser = argparse.ArgumentParser(description="Fix ledger balances for tenant emalatcoffee.")
    parser.add_argument("--apply", action="store_true", help="Apply changes to the database (defaults to dry-run)")
    parser.add_argument("--db-url", type=str, help="Override database URL")
    args = parser.parse_args()

    # Override DATABASE_URL if provided
    if args.db_url:
        os.environ["DATABASE_URL"] = args.db_url
        # Re-create engine/sessionmakers if overridden
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        global SessionLocal
        new_engine = create_engine(args.db_url, future=True)
        SessionLocal = sessionmaker(bind=new_engine, autoflush=False, autocommit=False, expire_on_commit=False)

    db = SessionLocal()
    try:
        # 1. Resolve Tenant
        tenant = db.query(Tenant).filter(Tenant.domain == "emalatcoffee.ironwaves.store").first()
        if not tenant:
            tenant = db.query(Tenant).filter(Tenant.slug == "emalatcoffee").first()
        if not tenant:
            print("ERROR: Tenant 'emalatcoffee' not found in database!")
            return
        
        print(f"Found Tenant: {tenant.name} (ID: {tenant.id}, Domain: {tenant.domain})")

        # 2. Resolve Accounts
        cash_account = finance_account(db, tenant.id, "cash")
        card_account = finance_account(db, tenant.id, "card")
        adj_account = finance_account(db, tenant.id, "adjustment")
        
        print(f"Cash Account ID: {cash_account.id}")
        print(f"Card Account ID: {card_account.id}")
        print(f"Adjustment Account ID: {adj_account.id}")

        # 3. Get Current Balances
        curr_cash = get_ledger_balance(db, tenant.id, cash_account.id, cash_account.account_type)
        curr_card = get_ledger_balance(db, tenant.id, card_account.id, card_account.account_type)
        
        print(f"\nCurrent Balances in Ledger:")
        print(f"  Nağd Kassa (cash): {curr_cash} AZN")
        print(f"  Bank/Kart (card):  {curr_card} AZN")

        # Targets
        target_cash = Decimal("56.60")
        target_card = Decimal("91.11")

        # 4. Calculate Adjustments
        cash_diff = target_cash - curr_cash
        card_diff = target_card - curr_card

        print(f"\nTarget Balances:")
        print(f"  Nağd Kassa target: {target_cash} AZN (Adjustment: {cash_diff:+.2f} AZN)")
        print(f"  Bank/Kart target:  {target_card} AZN (Adjustment: {card_diff:+.2f} AZN)")

        # 5. Apply Adjustments
        actions = []
        if cash_diff != 0:
            actions.append(("cash", cash_diff))
        if card_diff != 0:
            actions.append(("card", card_diff))

        if not actions:
            print("\nBalances already match target! No adjustments needed.")
            return

        for acc_code, diff in actions:
            abs_diff = abs(diff)
            # Determine source/destination codes
            # Positive diff means debit asset (increase) -> src=adjustment, dest=asset
            # Negative diff means credit asset (decrease) -> src=asset, dest=adjustment
            if diff > 0:
                src_code = "adjustment"
                dest_code = acc_code
            else:
                src_code = acc_code
                dest_code = "adjustment"

            print(f"\nPosting adjustment for {acc_code}:")
            print(f"  Amount: {abs_diff} AZN")
            print(f"  Source: {src_code} -> Destination: {dest_code}")
            print(f"  Note: Manual kassa bərpası")

            if args.apply:
                txn = post_finance_transaction_with_legacy_mirror(
                    db,
                    tenant_id=tenant.id,
                    transaction_type="cash_adjustment",
                    amount=abs_diff,
                    source_code=src_code,
                    destination_code=dest_code,
                    created_by="system_repair",
                    category="Manual Kassa Bərpası",
                    note="Manual kassa bərpası"
                )
                print(f"  [SUCCESS] Transaction posted. ID: {txn.id}")
            else:
                print(f"  [DRY-RUN] Would post adjustment transaction.")

        if args.apply:
            # Create Audit Log
            audit = AuditLog(
                tenant_id=tenant.id,
                user="system_repair",
                action="FINANCE_MANUAL_CASH_RESTORE",
                details=json.dumps({
                    "tenant_id": tenant.id,
                    "cash_before": str(curr_cash),
                    "cash_after": str(target_cash),
                    "card_before": str(curr_card),
                    "card_after": str(target_card),
                    "note": "Manual kassa bərpası"
                }, ensure_ascii=False)
            )
            db.add(audit)
            db.commit()
            print("\nChanges successfully committed to database!")
            
            # Print new balances to verify
            new_cash = get_ledger_balance(db, tenant.id, cash_account.id, cash_account.account_type)
            new_card = get_ledger_balance(db, tenant.id, card_account.id, card_account.account_type)
            print(f"\nVerified New Balances in Ledger:")
            print(f"  Nağd Kassa (cash): {new_cash} AZN (Target: {target_cash})")
            print(f"  Bank/Kart (card):  {new_card} AZN (Target: {target_card})")
        else:
            print("\n[DRY-RUN] No changes committed. Run with --apply to execute adjustments on the database.")

    except Exception as e:
        db.rollback()
        import traceback
        traceback.print_exc()
        print(f"\nERROR: Database transaction rolled back due to error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
