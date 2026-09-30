"""Finance v2 posting rules: pure specs and end-to-end posting on SQLite."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import engine as gl
from app.gl import posting_rules as pr
from app.gl import reports, tax
from app.gl.engine import GLError
from app.gl.models import GLJournal
from app.gl.tax import TaxSettings
from app.models import Tenant

D = Decimal
DAY = date(2026, 10, 5)
SIMPLIFIED = TaxSettings("simplified", D("2"), D("0"), True, date(2026, 10, 1), True)
VAT = TaxSettings("vat", D("0"), D("18"), True, date(2026, 10, 1), True)


def lines_of(spec) -> dict[str, Decimal]:
    """account -> signed amount (debit positive)."""
    out: dict[str, Decimal] = {}
    for line in spec.lines:
        out[line.account] = out.get(line.account, D("0")) + D(str(line.debit)) - D(str(line.credit))
    return out


def assert_balanced(spec):
    debit, credit = spec.totals()
    assert debit == credit and debit > 0
    assert all((D(str(l.debit)) > 0) != (D(str(l.credit)) > 0) for l in spec.lines)


def sale(**kw) -> pr.SaleCompleted:
    base = dict(sale_id="s-1", posting_date=DAY)
    base.update(kw)
    return pr.SaleCompleted(**base)


# ─────────────────────────── normalisation ───────────────────────────


@pytest.mark.parametrize("raw,expected", [("Nəğd", "cash"), ("nağd", "cash"), ("NAGD", "cash"), ("cash", "cash"),
                                          ("Kart", "card"), ("card", "card"), ("POS", "card"), ("staff", "staff")])
def test_payment_method_aliases(raw, expected):
    assert pr.normalize_payment_method(raw) == expected


@pytest.mark.parametrize("raw", ["qr", "", None, "split", "bonus", "crypto"])
def test_unknown_payment_method_is_rejected_not_card(raw):
    with pytest.raises(GLError) as exc:
        pr.normalize_payment_method(raw)
    assert exc.value.code == "unknown_payment_method"


# ─────────────────────────── sales ───────────────────────────


def test_cash_sale_simplified_regime_no_tax_split():
    spec = sale(payments=(pr.SalePayment("Nəğd", "10.00"),), cogs="3.2567").spec(SIMPLIFIED)
    assert_balanced(spec)
    assert lines_of(spec) == {"cash_drawer": D("10.00"), "sales_revenue": D("-10.00"), "cogs": D("3.26"), "inventory": D("-3.26")}
    assert spec.idempotency_key == "sale:s-1:v1" and spec.journal_type == "sales"


def test_card_sale_books_fee_and_net_bank_amount():
    spec = sale(payments=(pr.SalePayment("card", "50.00"),), card_fee_percent="2").spec(SIMPLIFIED)
    assert_balanced(spec)
    got = lines_of(spec)
    assert got["bank_main"] == D("49.00") and got["bank_fees"] == D("1.00") and got["sales_revenue"] == D("-50.00")


def test_split_sale_with_discount_under_vat():
    # 118 received (100 cash + 18 card), 11.80 gross discount given, 18% VAT inclusive.
    spec = sale(payments=(pr.SalePayment("cash", "100.00"), pr.SalePayment("kart", "18.00")), discount="11.80").spec(VAT)
    assert_balanced(spec)
    got = lines_of(spec)
    assert got["cash_drawer"] == D("100.00") and got["bank_main"] == D("18.00")
    assert got["vat_output"] == D("-18.00")
    assert got["sales_revenue"] == D("-110.00")  # 100 net + 10 net discount
    assert got["sales_discounts"] == D("10.00")
    assert got["sales_revenue"] + got["sales_discounts"] == D("-100.00")  # net revenue = consideration ex VAT


def test_deposit_applied_and_extra_payment():
    spec = sale(payments=(pr.SalePayment("cash", "15.00"),), deposit_applied="20.00").spec(SIMPLIFIED)
    assert_balanced(spec)
    got = lines_of(spec)
    assert got["customer_deposits"] == D("20.00") and got["sales_revenue"] == D("-35.00")


def test_staff_meal_benefit_moves_no_cash():
    spec = sale(payments=(pr.SalePayment("staff", "3.00"),), staff_benefit="6.00").spec(SIMPLIFIED)
    assert_balanced(spec)
    got = lines_of(spec)
    assert got["cash_drawer"] == D("3.00")  # only the co-payment
    assert got["staff_meals"] == D("6.00") and got["sales_revenue"] == D("-9.00")


def test_fully_covered_staff_meal():
    spec = sale(staff_benefit="4.50").spec(SIMPLIFIED)
    assert_balanced(spec)
    assert "cash_drawer" not in lines_of(spec)


@pytest.mark.parametrize("kw,code", [
    (dict(), "empty_sale"),
    (dict(payments=(pr.SalePayment("cash", "-1"),)), "negative_amount"),
    (dict(payments=(pr.SalePayment("qr", "5"),)), "unknown_payment_method"),
    (dict(payments=(pr.SalePayment("card", "5"),), card_fee_percent="150"), "invalid_fee"),
    (dict(payments=(pr.SalePayment("cash", "5.001"),)), "invalid_amount"),
])
def test_invalid_sales(kw, code):
    with pytest.raises(GLError) as exc:
        sale(**kw).spec(SIMPLIFIED)
    assert exc.value.code == code


@pytest.mark.parametrize("amount", ["0.01", "0.99", "1.17", "33.33", "999.99", "12345.67"])
@pytest.mark.parametrize("fee", ["0", "1.5", "2"])
def test_every_sale_balances_under_vat_with_rounding(amount, fee):
    spec = sale(payments=(pr.SalePayment("card", amount), pr.SalePayment("cash", "0.07")), discount="0.33",
                card_fee_percent=fee, cogs="0.005").spec(VAT)
    assert_balanced(spec)


# ─────────────────────────── other events ───────────────────────────


def test_partial_refund_under_vat():
    spec = pr.SaleRefunded("r-1", "s-1", DAY, "card", "11.80", "soyuq idi").spec(VAT)
    assert_balanced(spec)
    assert lines_of(spec) == {"sales_discounts": D("10.00"), "vat_output": D("1.80"), "bank_main": D("-11.80")}
    with pytest.raises(GLError):
        pr.SaleRefunded("r-2", "s-1", DAY, "cash", "5", " ").spec(VAT)


def test_cash_variance_both_directions():
    over = lines_of(pr.CashCountVariance("sh", DAY, "z", "z1", "2.50").spec(SIMPLIFIED))
    short = lines_of(pr.CashCountVariance("sh", DAY, "z", "z1", "-4.00").spec(SIMPLIFIED))
    assert over == {"cash_drawer": D("2.50"), "cash_overage": D("-2.50")}
    assert short == {"cash_shortage": D("4.00"), "cash_drawer": D("-4.00")}
    with pytest.raises(GLError):
        pr.CashCountVariance("sh", DAY, "z", "z1", "0").spec(SIMPLIFIED)


def test_drawer_funding_from_bank_with_fee():
    got = lines_of(pr.DrawerFunded("sh", DAY, "card", "100", bank_fee="0.60").spec(SIMPLIFIED))
    assert got == {"cash_drawer": D("100.00"), "bank_main": D("-100.60"), "bank_fees": D("0.60")}
    with pytest.raises(GLError):
        pr.DrawerFunded("sh", DAY, "cash", "10").spec(SIMPLIFIED)
    with pytest.raises(GLError):
        pr.DrawerFunded("sh", DAY, "safe", "10", bank_fee="1").spec(SIMPLIFIED)
    assert lines_of(pr.DrawerFunded("sh", DAY, "investor", "50").spec(SIMPLIFIED))["investor_loan"] == D("-50.00")


def test_transfer_fee_comes_from_source():
    got = lines_of(pr.WalletTransfer("t1", DAY, "card", "cash", "200", bank_fee="1.00").spec(SIMPLIFIED))
    assert got == {"cash_drawer": D("200.00"), "bank_main": D("-201.00"), "bank_fees": D("1.00")}
    with pytest.raises(GLError):
        pr.WalletTransfer("t2", DAY, "cash", "cash", "1").spec(SIMPLIFIED)


def test_expense_with_input_vat_only_under_vat_regime():
    spec = pr.ExpensePaid("e1", DAY, "utilities_expense", "118.00", "card", input_vat="18.00").spec(VAT)
    assert lines_of(spec) == {"utilities_expense": D("100.00"), "vat_input": D("18.00"), "bank_main": D("-118.00")}
    with pytest.raises(GLError) as exc:
        pr.ExpensePaid("e2", DAY, "utilities_expense", "118.00", "card", input_vat="18.00").spec(SIMPLIFIED)
    assert exc.value.code == "vat_not_applicable"
    with pytest.raises(GLError):
        pr.ExpensePaid("e3", DAY, "rent_expense", "400", None).spec(SIMPLIFIED)  # on credit without supplier


def test_stock_on_credit_needs_supplier_and_tracks_partner():
    spec = pr.StockReceived("g1", DAY, "80.00", supplier_id="sup-1", invoice_no="INV-7").spec(SIMPLIFIED)
    ap = [l for l in spec.lines if l.account == "accounts_payable"][0]
    assert ap.partner_type == "supplier" and ap.partner_id == "sup-1"
    with pytest.raises(GLError):
        pr.StockReceived("g2", DAY, "80.00").spec(SIMPLIFIED)


@pytest.mark.parametrize("kind,dr,cr", [
    ("investor_in", "cash_drawer", "investor_loan"), ("investor_repay", "investor_loan", "cash_drawer"),
    ("loan_in", "cash_drawer", "other_borrowings"), ("loan_repay", "other_borrowings", "cash_drawer"),
    ("lend_out", "other_receivable", "cash_drawer"), ("lend_back", "cash_drawer", "other_receivable"),
])
def test_financing_movements(kind, dr, cr):
    got = lines_of(pr.FinancingMovement("f1", DAY, kind, "cash", "40").spec(SIMPLIFIED))
    assert got == {dr: D("40.00"), cr: D("-40.00")}


def test_deposit_forfeit_is_taxed_under_vat():
    got = lines_of(pr.DepositForfeited("d1", DAY, "11.80").spec(VAT))
    assert got == {"customer_deposits": D("11.80"), "sales_revenue": D("-10.00"), "vat_output": D("-1.80")}


# ─────────────────────────── posting on a real DB ───────────────────────────


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", future=True)

    @event.listens_for(engine, "connect")
    def _connect(dbapi_conn, _):
        dbapi_conn.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def tid(db):
    t = str(uuid.uuid4())
    db.add(Tenant(id=t, name="T", slug=f"t-{t[:8]}", domain=f"{t[:8]}.test", status="active"))
    db.flush()
    gl.ensure_chart(db, t)
    tax.set_tax_profile(db, t, regime="simplified", simplified_rate="2", effective_from=date(2026, 10, 1), actor="cfo")
    pr.post_event(db, t, pr.FinancingMovement("seed", DAY, "investor_in", "cash", "100"), actor="owner")
    return t


def bal(db, tid, role):
    return gl.account_balance(db, tid, gl.accounts_by_role(db, tid)[role])


def test_post_sale_is_idempotent_and_updates_reports(db, tid):
    ev = sale(sale_id="s-9", payments=(pr.SalePayment("cash", "20.00"), pr.SalePayment("card", "30.00")), card_fee_percent="2", cogs="12")
    j1 = pr.post_event(db, tid, ev, actor="kassir")
    j2 = pr.post_event(db, tid, ev, actor="kassir")  # offline retry
    assert j1.id == j2.id
    assert bal(db, tid, "cash_drawer") == D("120.00") and bal(db, tid, "bank_main") == D("29.40")
    pl = reports.profit_and_loss(db, tid, date_from=DAY, date_to=DAY)
    assert pl["revenue"]["total"] == "50.00" and pl["gross_profit"] == "38.00"
    assert reports.balance_sheet(db, tid, as_of=DAY)["balanced"]


def test_void_with_and_without_stock_return(db, tid):
    pr.post_event(db, tid, sale(sale_id="a", payments=(pr.SalePayment("cash", "10"),), cogs="4"), actor="k")
    pr.post_event(db, tid, sale(sale_id="b", payments=(pr.SalePayment("cash", "10"),), cogs="4"), actor="k")
    pr.void_sale(db, tid, "a", actor="mgr", reason="səhv", stock_returned=True)
    pr.void_sale(db, tid, "b", actor="mgr", reason="müştəri getdi", stock_returned=False)
    assert bal(db, tid, "sales_revenue") == D("0.00")
    assert bal(db, tid, "cogs") == D("0.00")
    assert bal(db, tid, "inventory_writeoff") == D("4.00")  # b's goods are gone
    assert bal(db, tid, "inventory") == D("-4.00")
    with pytest.raises(GLError):
        pr.void_sale(db, tid, "a", actor="mgr", reason="again", stock_returned=True)


def test_sale_correction_versions(db, tid):
    pr.post_event(db, tid, sale(sale_id="c", payments=(pr.SalePayment("card", "10"),)), actor="k")
    fixed = pr.correct_sale(db, tid, sale(sale_id="c", payments=(pr.SalePayment("cash", "10"),)), actor="mgr", reason="nağd idi")
    assert fixed.idempotency_key == "sale:c:v2"
    assert pr.active_sale_journal(db, tid, "c").id == fixed.id
    again = pr.correct_sale(db, tid, sale(sale_id="c", payments=(pr.SalePayment("cash", "8"),)), actor="mgr", reason="endirim")
    assert again.idempotency_key == "sale:c:v3"
    assert bal(db, tid, "bank_main") == D("0.00") and bal(db, tid, "cash_drawer") == D("108.00")


def test_cash_guard_applies_to_rules(db, tid):
    with pytest.raises(GLError) as exc:
        pr.post_event(db, tid, pr.WagePaidFromDrawer("sh1", DAY, "150", "Aysel"), actor="mgr")
    assert exc.value.code == "insufficient_balance"


def test_simplified_tax_accrues_from_rule_revenue(db, tid):
    pr.post_event(db, tid, sale(sale_id="t1", payments=(pr.SalePayment("cash", "500"),)), actor="k")
    pr.post_event(db, tid, pr.SaleRefunded("r1", "t1", DAY, "cash", "50", "qaytarma"), actor="k")
    result = tax.accrue_simplified_tax(db, tid, year=2026, month=10, actor="cfo")
    assert result["base"] == "450.00" and result["tax_due"] == "9.00"


def test_vat_tenant_end_to_end(db):
    t = str(uuid.uuid4())
    db.add(Tenant(id=t, name="V", slug=f"v-{t[:8]}", domain=f"{t[:8]}.v.test", status="active"))
    db.flush()
    gl.ensure_chart(db, t)
    tax.set_tax_profile(db, t, regime="vat", vat_rate="18", effective_from=date(2026, 10, 1), actor="cfo")
    pr.post_event(db, t, sale(sale_id="v1", payments=(pr.SalePayment("cash", "118"),)), actor="k")
    pr.post_event(db, t, pr.ExpensePaid("e1", DAY, "utilities_expense", "59", "cash", input_vat="9"), actor="k")
    summary = tax.tax_summary(db, t, year=2026, month=10)
    assert summary["output_vat"] == "18.00" and summary["input_vat"] == "9.00" and summary["vat_payable"] == "9.00"
    assert reports.trial_balance(db, t)["balanced"]
