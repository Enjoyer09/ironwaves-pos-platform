import os
import sys
import json
from decimal import Decimal

# Add backend directory to path so we can import app modules
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(current_dir, '..'))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.database import SessionLocal
from app.models import Shift, Sale

def get_item_breakdown(db, tenant_id, opened_at, closed_at):
    """
    Simplified version of _shift_item_sales_breakdown that fetches
    and aggregates items directly for migration purposes.
    """
    query = db.query(Sale.items_json).filter(
        Sale.tenant_id == tenant_id,
        Sale.status.notin_(["VOID", "REFUNDED"])
    )
    if opened_at:
        query = query.filter(Sale.created_at >= opened_at)
    if closed_at:
        query = query.filter(Sale.created_at < closed_at)
        
    rows = query.all()
    item_totals = {}
    
    for (items_json_str,) in rows:
        try:
            items = json.loads(items_json_str)
            if not isinstance(items, list):
                continue
            for item in items:
                name = str(item.get("item_name") or item.get("name") or "Bilinməyən")
                qty = Decimal(str(item.get("qty") or 0))
                price = Decimal(str(item.get("price") or 0))
                total = qty * price
                
                if name not in item_totals:
                    item_totals[name] = {"qty": Decimal("0"), "total": Decimal("0.00")}
                item_totals[name]["qty"] += qty
                item_totals[name]["total"] += total
        except Exception:
            pass
            
    result = []
    for name, data in item_totals.items():
        qty_val = data["qty"]
        if qty_val == qty_val.to_integral_value():
            qty_str = str(int(qty_val))
        else:
            qty_str = str(qty_val.normalize())
            
        result.append({
            "item_name": name,
            "qty": qty_str,
            "total": str(data["total"].quantize(Decimal("0.01")))
        })
        
    result.sort(key=lambda x: Decimal(x["total"]), reverse=True)
    return result

def run_migration():
    db = SessionLocal()
    try:
        # Fetch all shifts that have a z_report_html but don't have the new section
        shifts = db.query(Shift).filter(Shift.z_report_html.isnot(None)).all()
        
        updated_count = 0
        skipped_count = 0
        
        print(f"Bazada ümumi {len(shifts)} ədəd HTML çekli smen tapıldı. Miqrasiya başlayır...")
        
        for shift in shifts:
            html = shift.z_report_html
            
            # Check if it already has the item breakdown
            if "Məhsul Satışları" in html:
                skipped_count += 1
                continue
                
            # Get the breakdown for this shift
            breakdown = get_item_breakdown(db, shift.tenant_id, shift.opened_at, shift.closed_at)
            
            # Generate the HTML for the item breakdown
            if not breakdown:
                item_rows_html = '<div class="muted">Məhsul satışı yoxdur</div>'
            else:
                item_rows_html = ""
                for row in breakdown:
                    qty_str = row['qty']
                    total_str = f"{float(row['total']):.2f}"
                    item_rows_html += f'<div class="line"><span>{row["item_name"]} <span class="muted">({qty_str}x)</span></span><span>{total_str} ₼</span></div>\n            '
            
            item_section = f'<hr />\n            <div class="section-title">Məhsul Satışları</div>\n            {item_rows_html}'
            
            # Find insertion point: Right before `<div class="line"><span>Satış sayı</span>`
            # The pattern is: `<hr />\n            <div class="line"><span>Satış sayı</span>`
            # Or just right before `<div class="line"><span>Satış sayı</span>`
            target = '<div class="line"><span>Satış sayı</span>'
            
            if target in html:
                parts = html.split(target, 1)
                if len(parts) == 2:
                    before, after = parts
                    # We inject the new section right before the target
                    new_html = before + item_section + "\n            " + target + after
                    shift.z_report_html = new_html
                    updated_count += 1
                else:
                    skipped_count += 1
            else:
                skipped_count += 1
                
        db.commit()
        print(f"Miqrasiya bitdi! {updated_count} çek yeniləndi. {skipped_count} çek (artıq yenilənmiş və ya uyğun olmayan) ötürüldü.")
        
    except Exception as e:
        db.rollback()
        print(f"Xəta baş verdi: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    run_migration()
