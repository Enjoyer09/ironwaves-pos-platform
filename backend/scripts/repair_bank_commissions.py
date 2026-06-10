import sys
import os
import argparse
import json
from decimal import Decimal
from datetime import datetime

# Adjust sys.path to find 'app'
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db import SessionLocal
from app.models import Tenant, Setting, Sale, FinanceTransaction, FinanceLedgerEntry, FinanceEntry, FinanceAccount, AuditLog
from app.services.finance_service import finance_account

def main():
    parser = argparse.ArgumentParser(description="Repair bank commission fees for past card sales.")
    parser.add_argument("--apply", action="store_true", help="Apply changes to the database (defaults to dry-run)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        # 1. Resolve Tenant
        tenant = db.query(Tenant).filter(Tenant.slug == "emalatcoffee").first()
        if not tenant:
            print("ERROR: Tenant 'emalatcoffee' not found!")
            return
        
        print(f"Tenant Found: {tenant.name} ({tenant.slug}, ID: {tenant.id})")

        # 2. Update/Verify Settings
        # New target settings: 2% sale, 0.5% transfer, min 60 qepik (min_amount = 0.60)
        target_setting = {
            "percent": 2.0,
            "min_amount": 0.60,
            "card_sale_percent": 2.0,
            "card_transfer_percent": 0.5
        }
        
        setting_row = db.query(Setting).filter(
            Setting.tenant_id == tenant.id,
            Setting.key == "bank_commission"
        ).first()

        print("\n--- Setting Updates ---")
        if setting_row:
            old_value = setting_row.value
            print(f"Current setting: {old_value}")
            if args.apply:
                setting_row.value = json.dumps(target_setting)
                db.flush()
                print(f"Updated setting to: {target_setting}")
            else:
                print(f"[DRY-RUN] Would update setting to: {target_setting}")
        else:
            print("No existing bank_commission setting. Will create one.")
            if args.apply:
                new_setting = Setting(
                    tenant_id=tenant.id,
                    key="bank_commission",
                    value=json.dumps(target_setting)
                )
                db.add(new_setting)
                db.flush()
                print(f"Created new setting: {target_setting}")
            else:
                print(f"[DRY-RUN] Would create setting: {target_setting}")

        # 3. Retrieve Accounts
        card_account = finance_account(db, tenant.id, "card")
        expense_account = finance_account(db, tenant.id, "expense")
        print(f"\nResolved accounts: Card Account ID={card_account.id}, Expense Account ID={expense_account.id}")

        # 4. Fetch Completed Card Sales
        card_sales = db.query(Sale).filter(
            Sale.tenant_id == tenant.id,
            Sale.payment_method == "Kart",
            Sale.status == "COMPLETED"
        ).order_by(Sale.created_at.asc()).all()

        print(f"\nFound {len(card_sales)} completed card sales. Processing commissions at 2%...")

        commissions_created = 0
        commissions_updated = 0
        commissions_skipped = 0
        total_commission_amount = Decimal("0.00")

        for i, sale in enumerate(card_sales):
            expected_fee = (sale.total * Decimal("0.02")).quantize(Decimal("0.01"))
            total_commission_amount += expected_fee

            # Check if there is already a Bank Komissiyası transaction linked to this sale
            existing_txn = db.query(FinanceTransaction).filter(
                FinanceTransaction.tenant_id == tenant.id,
                FinanceTransaction.related_order_id == sale.id,
                FinanceTransaction.category == "Bank Komissiyası"
            ).first()

            note = f"POS Sale {sale.id} kart komissiyası"

            if existing_txn:
                # If transaction exists, check if amount is correct
                if existing_txn.amount != expected_fee:
                    if args.apply:
                        print(f"  [{i+1}/{len(card_sales)}] Updating transaction for Sale {sale.id}: {existing_txn.amount} -> {expected_fee} AZN")
                        existing_txn.amount = expected_fee
                        # Update ledger entries
                        les = db.query(FinanceLedgerEntry).filter(FinanceLedgerEntry.transaction_id == existing_txn.id).all()
                        for le in les:
                            le.amount = expected_fee
                        # Update legacy entry
                        fe = db.query(FinanceEntry).filter(
                            FinanceEntry.tenant_id == tenant.id,
                            FinanceEntry.description.contains(f"Ledger mirror: {existing_txn.id}")
                        ).first()
                        if fe:
                            fe.amount = expected_fee
                        commissions_updated += 1
                    else:
                        print(f"  [DRY-RUN] [{i+1}/{len(card_sales)}] Would update commission for Sale {sale.id}: {existing_txn.amount} -> {expected_fee} AZN")
                        commissions_updated += 1
                else:
                    commissions_skipped += 1
            else:
                if expected_fee <= 0:
                    commissions_skipped += 1
                    continue

                if args.apply:
                    # Create FinanceTransaction
                    txn = FinanceTransaction(
                        tenant_id=tenant.id,
                        transaction_type="expense",
                        status="posted",
                        source_account_id=card_account.id,
                        destination_account_id=expense_account.id,
                        amount=expected_fee,
                        currency="AZN",
                        category="Bank Komissiyası",
                        note=note,
                        created_by="system_repair",
                        posted_by="system_repair",
                        created_at=sale.created_at,
                        posted_at=sale.created_at,
                        approved_at=sale.created_at,
                        related_order_id=sale.id
                    )
                    db.add(txn)
                    db.flush()  # Generate txn.id

                    # Create Debit Ledger Entry (Expense)
                    le_debit = FinanceLedgerEntry(
                        tenant_id=tenant.id,
                        transaction_id=txn.id,
                        account_id=expense_account.id,
                        entry_side="debit",
                        amount=expected_fee,
                        currency="AZN",
                        description=note,
                        created_at=sale.created_at
                    )
                    db.add(le_debit)

                    # Create Credit Ledger Entry (Card Wallet)
                    le_credit = FinanceLedgerEntry(
                        tenant_id=tenant.id,
                        transaction_id=txn.id,
                        account_id=card_account.id,
                        entry_side="credit",
                        amount=expected_fee,
                        currency="AZN",
                        description=note,
                        created_at=sale.created_at
                    )
                    db.add(le_credit)

                    # Create Legacy FinanceEntry
                    fe = FinanceEntry(
                        tenant_id=tenant.id,
                        type="out",
                        category="Bank Komissiyası",
                        source="card",
                        amount=expected_fee,
                        description=f"{note} | Ledger mirror: {txn.id}",
                        created_by="system_repair",
                        created_at=sale.created_at
                    )
                    db.add(fe)

                    commissions_created += 1
                else:
                    commissions_created += 1

        print("\n--- Summary ---")
        print(f"Total Completed Card Sales: {len(card_sales)}")
        print(f"Total calculated commission: {total_commission_amount} AZN")
        print(f"Commissions to CREATE: {commissions_created}")
        print(f"Commissions to UPDATE: {commissions_updated}")
        print(f"Commissions SKIPPED: {commissions_skipped}")

        if args.apply:
            # Create a single Audit Log for the whole repair
            audit = AuditLog(
                tenant_id=tenant.id,
                user="system_repair",
                action="FINANCE_BANK_COMMISSION_REPAIR",
                details=json.dumps({
                    "tenant_id": tenant.id,
                    "commission_rate_percent": 2.0,
                    "total_sales_processed": len(card_sales),
                    "commissions_created": commissions_created,
                    "commissions_updated": commissions_updated,
                    "total_commission_amount": str(total_commission_amount)
                }, ensure_ascii=False)
            )
            db.add(audit)
            db.commit()
            print("\nDatabase transactions committed successfully!")
        else:
            print("\n[DRY-RUN] No changes were written to the database. Run with --apply to commit changes.")

    except Exception as e:
        db.rollback()
        import traceback
        traceback.print_exc()
        print(f"\nERROR: Database transaction rolled back due to error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
