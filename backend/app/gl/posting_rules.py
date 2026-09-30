"""Posting rules: business events → one compound, balanced GL journal.

Every business event (a sale, a refund, a shift variance, a supplier bill ...)
is described by a small immutable dataclass. ``event.spec(tax)`` is a *pure*
function that returns the journal to post, given the tenant's tax regime.
``post_event`` resolves the tax regime for the posting date, builds the spec
and hands it to the engine (idempotent, balanced, period-checked).

Nothing in the live POS flows calls this module yet (P2b wires it in behind a
per-tenant switch). Differences vs. the legacy ledger, on purpose:

* One sale = one journal (payments, card fee, discount, deposit, staff meal,
  tax and COGS together), instead of up to five separate transactions.
* Revenue is booked gross with discounts on 602, so discounts are visible.
* VAT regime: VAT is extracted from the consideration into 521.1.
  Simplified regime: nothing is split per sale; the tax is accrued monthly
  from revenue (``tax.accrue_simplified_tax``).
* Card fees are always booked (legacy skipped them on table checks).
* Unknown payment methods are rejected instead of silently becoming "card".
* Partial refunds post only the refunded part instead of reversing and
  re-posting the whole sale.

Open accounting questions (to confirm with the accountant) are marked ``ACCT:``.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.gl import engine as gl
from app.gl.engine import ZERO, GLError, LineIn, money, round_money
from app.gl.models import GLJournal
from app.gl.tax import TaxSettings, get_tax_profile, split_vat

# ─────────────────────────────── normalisation ──────────────────────────

_CASH_ALIASES = {"cash", "nəğd", "nəqd", "nagd", "nağd", "naghd", "negd"}
_CARD_ALIASES = {"card", "kart", "pos", "terminal", "visa", "mastercard", "bank_card"}
PAYMENT_METHODS = ("cash", "card", "staff")

_WALLET_ROLES = {
    "cash": "cash_drawer",
    "cash_drawer": "cash_drawer",
    "safe": "safe",
    "card": "bank_main",
    "bank": "bank_main",
    "bank_main": "bank_main",
}


def normalize_payment_method(value: str | None) -> str:
    """Strict normalisation. Unknown values raise instead of defaulting to card."""
    raw = str(value or "").strip().lower()
    if raw in _CASH_ALIASES:
        return "cash"
    if raw in _CARD_ALIASES:
        return "card"
    if raw == "staff":
        return "staff"
    raise GLError(f"Unknown payment method: {value!r}", "unknown_payment_method")


def wallet_role(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    if raw not in _WALLET_ROLES:
        raise GLError(f"Unknown wallet: {value!r} (expected cash, safe or card/bank)", "unknown_wallet")
    return _WALLET_ROLES[raw]


def _pos(value, label: str) -> Decimal:
    amount = money(value)
    if amount < 0:
        raise GLError(f"{label} cannot be negative", "negative_amount")
    return amount


# ─────────────────────────────── spec ───────────────────────────────────


@dataclass
class JournalSpec:
    journal_type: str
    lines: list[LineIn]
    description: str
    source_type: str
    source_id: str
    idempotency_key: str
    posting_date: date | None = None
    branch_id: str | None = None

    def totals(self) -> tuple[Decimal, Decimal]:
        debit = sum((money(line.debit) for line in self.lines), ZERO)
        credit = sum((money(line.credit) for line in self.lines), ZERO)
        return debit, credit


class _Lines:
    """Collects lines, merges same account+side, drops zero amounts."""

    def __init__(self):
        self._items: list[LineIn] = []

    def dr(self, account: str, amount: Decimal, memo: str | None = None, **kw) -> None:
        if amount > 0:
            self._items.append(LineIn(account, debit=amount, memo=memo, **kw))
        elif amount < 0:
            self._items.append(LineIn(account, credit=-amount, memo=memo, **kw))

    def cr(self, account: str, amount: Decimal, memo: str | None = None, **kw) -> None:
        self.dr(account, -amount, memo, **kw)

    def build(self) -> list[LineIn]:
        merged: dict[tuple, LineIn] = {}
        for line in self._items:
            side = "d" if money(line.debit) > 0 else "c"
            key = (line.account, side, line.partner_type, line.partner_id, line.branch_id)
            if key in merged:
                existing = merged[key]
                existing.debit = money(existing.debit) + money(line.debit)
                existing.credit = money(existing.credit) + money(line.credit)
            else:
                merged[key] = LineIn(line.account, debit=money(line.debit), credit=money(line.credit), memo=line.memo,
                                     partner_type=line.partner_type, partner_id=line.partner_id, branch_id=line.branch_id)
        return list(merged.values())


def _revenue_split(consideration: Decimal, tax: TaxSettings) -> tuple[Decimal, Decimal]:
    """(net revenue, output VAT) for a gross consideration under the tenant's regime."""
    if tax.regime == "vat" and consideration > 0:
        return split_vat(consideration, tax.vat_rate, inclusive=tax.prices_include_vat)
    return consideration, ZERO


# ─────────────────────────────── sales ──────────────────────────────────


@dataclass(frozen=True)
class SalePayment:
    method: str  # cash | card | staff (aliases accepted)
    amount: Decimal | str


@dataclass(frozen=True)
class SaleCompleted:
    """A completed sale (POS, table check, delivery).

    ``payments`` are the amounts actually received now. ``deposit_applied`` is a
    previously held deposit recognised against this bill. ``staff_benefit`` is
    the part of a staff meal covered by the benefit (no money received).
    ``discount`` is the gross discount given (already excluded from payments).
    """

    sale_id: str
    posting_date: date
    payments: tuple[SalePayment, ...] = ()
    deposit_applied: Decimal | str = ZERO
    staff_benefit: Decimal | str = ZERO
    discount: Decimal | str = ZERO
    card_fee_percent: Decimal | str = ZERO
    cogs: Decimal | str = ZERO
    receipt_code: str | None = None
    branch_id: str | None = None
    version: int = 1

    def spec(self, tax: TaxSettings) -> JournalSpec:
        lines = _Lines()
        received = ZERO
        card_total = ZERO
        for payment in self.payments:
            method = normalize_payment_method(payment.method)
            amount = _pos(payment.amount, "Payment")
            if amount == 0:
                continue
            received += amount
            if method == "card":
                card_total += amount
            else:  # cash and staff co-payments both land in the drawer
                lines.dr("cash_drawer", amount, "Nağd ödəniş" if method == "cash" else "İşçi ödənişi")
        fee_pct = Decimal(str(self.card_fee_percent or 0))
        if fee_pct < 0 or fee_pct > 100:
            raise GLError("card_fee_percent must be between 0 and 100", "invalid_fee")
        card_fee = round_money(card_total * fee_pct / Decimal("100")) if card_total else ZERO
        lines.dr("bank_main", card_total - card_fee, "Kart ödənişi (komissiyadan sonra)")
        lines.dr("bank_fees", card_fee, f"Ekvayrinq komissiyası {fee_pct}%")

        deposit = _pos(self.deposit_applied, "deposit_applied")
        lines.dr("customer_deposits", deposit, "Depozit hesaba tətbiq edildi")

        consideration = received + deposit
        if consideration <= 0 and _pos(self.staff_benefit, "staff_benefit") <= 0:
            raise GLError("A sale needs a payment, an applied deposit or a staff benefit", "empty_sale")
        net, vat = _revenue_split(consideration, tax)
        discount = _pos(self.discount, "discount")
        discount_net = _revenue_split(discount, tax)[0]
        lines.cr("sales_revenue", net + discount_net, "Satış gəliri (endirimdən əvvəl)")
        lines.dr("sales_discounts", discount_net, "Endirim")
        lines.cr("vat_output", vat, f"ƏDV {tax.vat_rate}%")

        # ACCT: staff meals booked at sale value without VAT (benefit in kind).
        benefit = _pos(self.staff_benefit, "staff_benefit")
        lines.dr("staff_meals", benefit, "İşçi yeməyi (limit daxilində)")
        lines.cr("sales_revenue", benefit, "İşçi yeməyi satış dəyəri")

        cogs = round_money(Decimal(str(self.cogs or 0)))
        if cogs < 0:
            raise GLError("cogs cannot be negative", "negative_amount")
        lines.dr("cogs", cogs, "Satışın maya dəyəri")
        lines.cr("inventory", cogs, "Ehtiyat silinməsi (satış)")

        label = self.receipt_code or self.sale_id[:8]
        return JournalSpec(
            journal_type="sales",
            lines=lines.build(),
            description=f"Satış {label}" + (f" (düzəliş v{self.version})" if self.version > 1 else ""),
            source_type="sale",
            source_id=self.sale_id,
            idempotency_key=f"sale:{self.sale_id}:v{self.version}",
            posting_date=self.posting_date,
            branch_id=self.branch_id,
        )


@dataclass(frozen=True)
class SaleRefunded:
    """Partial (or full) money-back on a sale, without reversing the original.

    The refunded consideration reduces revenue (and output VAT) and leaves the
    drawer/bank. COGS is not touched: goods are not returned to stock.
    ACCT: the acquirer usually keeps the original card fee; we do not refund it.
    """

    refund_id: str
    sale_id: str
    posting_date: date
    method: str
    amount: Decimal | str
    reason: str
    branch_id: str | None = None

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Refund")
        if amount == 0:
            raise GLError("Refund amount must be > 0", "invalid_amount")
        if not str(self.reason or "").strip():
            raise GLError("A refund reason is required", "reason_required")
        method = normalize_payment_method(self.method)
        net, vat = _revenue_split(amount, tax)
        lines = _Lines()
        lines.dr("sales_discounts", net, f"Qaytarma: {self.reason}")
        lines.dr("vat_output", vat, "ƏDV korreksiyası")
        lines.cr("bank_main" if method == "card" else "cash_drawer", amount, "Müştəriyə qaytarıldı")
        return JournalSpec("sales", lines.build(), f"Qaytarma {self.sale_id[:8]}: {self.reason}", "sale_refund",
                           self.refund_id, f"refund:{self.refund_id}", self.posting_date, self.branch_id)


# ─────────────────────────────── deposits ───────────────────────────────


@dataclass(frozen=True)
class DepositHeld:
    deposit_id: str
    posting_date: date
    method: str
    amount: Decimal | str
    table_id: str | None = None

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Deposit")
        method = normalize_payment_method(self.method)
        lines = _Lines()
        lines.dr("bank_main" if method == "card" else "cash_drawer", amount, "Depozit alındı")
        lines.cr("customer_deposits", amount, "Müştəri depoziti öhdəliyi")
        return JournalSpec("cash", lines.build(), "Masa depoziti alındı", "deposit", self.deposit_id,
                           f"deposit:{self.deposit_id}:hold", self.posting_date)


@dataclass(frozen=True)
class DepositRefunded:
    deposit_id: str
    posting_date: date
    method: str
    amount: Decimal | str

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Deposit")
        method = normalize_payment_method(self.method)
        lines = _Lines()
        lines.dr("customer_deposits", amount, "Depozit öhdəliyi bağlandı")
        lines.cr("bank_main" if method == "card" else "cash_drawer", amount, "Depozit qaytarıldı")
        return JournalSpec("cash", lines.build(), "Masa depoziti qaytarıldı", "deposit", self.deposit_id,
                           f"deposit:{self.deposit_id}:refund", self.posting_date)


@dataclass(frozen=True)
class DepositForfeited:
    """Held deposit kept by the business (e.g. settled at Z close). Treated as consideration."""

    deposit_id: str
    posting_date: date
    amount: Decimal | str

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Deposit")
        net, vat = _revenue_split(amount, tax)
        lines = _Lines()
        lines.dr("customer_deposits", amount, "Depozit gəlirə köçürüldü")
        lines.cr("sales_revenue", net, "Saxlanılan depozit")
        lines.cr("vat_output", vat, "ƏDV")
        return JournalSpec("sales", lines.build(), "Depozit gəlirə tanındı", "deposit", self.deposit_id,
                           f"deposit:{self.deposit_id}:forfeit", self.posting_date)


# ─────────────────────────────── shifts / cash ──────────────────────────


@dataclass(frozen=True)
class DrawerFunded:
    """Opening float moved into the drawer from the safe, the bank or the investor."""

    shift_id: str
    posting_date: date
    source: str  # safe | card/bank | investor
    amount: Decimal | str
    bank_fee: Decimal | str = ZERO

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Amount")
        src = str(self.source or "").strip().lower()
        source_role = "investor_loan" if src == "investor" else wallet_role(src)
        if source_role == "cash_drawer":
            raise GLError("The drawer cannot be funded from itself", "invalid_source")
        fee = _pos(self.bank_fee, "bank_fee")
        lines = _Lines()
        lines.dr("cash_drawer", amount, "Gün açılışı üçün kassaya")
        lines.cr(source_role, amount, f"Mənbə: {src}")
        if fee:
            if source_role != "bank_main":
                raise GLError("A bank fee only applies to bank withdrawals", "invalid_fee")
            lines.dr("bank_fees", fee, "Nağdlaşdırma komissiyası")
            lines.cr("bank_main", fee, "Nağdlaşdırma komissiyası")
        return JournalSpec("cash", lines.build(), f"Kassanın açılış təminatı ({src})", "shift", self.shift_id,
                           f"shift:{self.shift_id}:funding", self.posting_date)


@dataclass(frozen=True)
class CashCountVariance:
    """Counted cash ≠ expected cash at X/Z report or handover. ``difference`` = counted − expected."""

    shift_id: str
    posting_date: date
    checkpoint: str  # x | z | handover
    reference: str
    difference: Decimal | str

    def spec(self, tax: TaxSettings) -> JournalSpec:
        diff = money(self.difference)
        if diff == 0:
            raise GLError("No variance to post", "no_variance")
        lines = _Lines()
        if diff > 0:
            lines.dr("cash_drawer", diff, "Kassa artığı")
            lines.cr("cash_overage", diff, "Kassa artığı")
        else:
            lines.dr("cash_shortage", -diff, "Kassa kəsiri")
            lines.cr("cash_drawer", -diff, "Kassa kəsiri")
        label = {"x": "X-hesabat", "z": "Z-hesabat", "handover": "Növbə təhvili"}.get(self.checkpoint, self.checkpoint)
        return JournalSpec("adjustment", lines.build(), f"{label} kassa fərqi {diff:+}", "shift", self.shift_id,
                           f"variance:{self.shift_id}:{self.checkpoint}:{self.reference}", self.posting_date)


@dataclass(frozen=True)
class WagePaidFromDrawer:
    shift_id: str
    posting_date: date
    amount: Decimal | str
    employee: str | None = None

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Wage")
        lines = _Lines()
        # ACCT: paid gross in cash; payroll taxes/withholding are handled in payroll, not here.
        lines.dr("payroll_expense", amount, f"Maaş {self.employee or ''}".strip(), partner_type="employee" if self.employee else None,
                 partner_id=self.employee)
        lines.cr("cash_drawer", amount, "Kassadan maaş")
        return JournalSpec("cash", lines.build(), "Növbə sonu maaş ödənişi", "shift", self.shift_id,
                           f"wage:{self.shift_id}", self.posting_date)


# ─────────────────────────────── money movements ────────────────────────


@dataclass(frozen=True)
class WalletTransfer:
    transfer_id: str
    posting_date: date
    from_wallet: str
    to_wallet: str
    amount: Decimal | str
    bank_fee: Decimal | str = ZERO
    note: str | None = None

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Amount")
        src, dst = wallet_role(self.from_wallet), wallet_role(self.to_wallet)
        if src == dst:
            raise GLError("Source and destination wallets are the same", "invalid_transfer")
        fee = _pos(self.bank_fee, "bank_fee")
        lines = _Lines()
        lines.dr(dst, amount, "Daxili köçürmə")
        lines.cr(src, amount + fee, "Daxili köçürmə")
        lines.dr("bank_fees", fee, "Köçürmə komissiyası")
        return JournalSpec("cash", lines.build(), self.note or f"Köçürmə {self.from_wallet} → {self.to_wallet}", "transfer",
                           self.transfer_id, f"transfer:{self.transfer_id}", self.posting_date)


@dataclass(frozen=True)
class ExpensePaid:
    """Operating expense paid from a wallet (or accrued to payables when ``paid_from`` is None)."""

    expense_id: str
    posting_date: date
    expense_account: str  # system role or account code, e.g. "rent_expense" or "721.2"
    amount: Decimal | str  # gross paid
    paid_from: str | None
    input_vat: Decimal | str = ZERO
    supplier_id: str | None = None
    bank_fee: Decimal | str = ZERO
    note: str | None = None

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Amount")
        vat = _pos(self.input_vat, "input_vat")
        if vat and tax.regime != "vat":
            raise GLError("Input VAT can only be recovered under the VAT regime", "vat_not_applicable")
        if vat >= amount and amount:
            raise GLError("Input VAT must be smaller than the gross amount", "invalid_vat")
        fee = _pos(self.bank_fee, "bank_fee")
        lines = _Lines()
        lines.dr(self.expense_account, amount - vat, self.note)
        lines.dr("vat_input", vat, "Əvəzləşdirilən ƏDV")
        if self.paid_from is None:
            if not self.supplier_id:
                raise GLError("An unpaid expense needs a supplier", "partner_required")
            lines.cr("accounts_payable", amount, "Təchizatçıya borc", partner_type="supplier", partner_id=self.supplier_id)
        else:
            lines.cr(wallet_role(self.paid_from), amount + fee, "Ödəniş")
            lines.dr("bank_fees", fee, "Bank komissiyası")
        return JournalSpec("purchase" if self.paid_from is None else "cash", lines.build(), self.note or "Xərc",
                           "expense", self.expense_id, f"expense:{self.expense_id}", self.posting_date)


@dataclass(frozen=True)
class OtherIncomeReceived:
    income_id: str
    posting_date: date
    amount: Decimal | str
    to_wallet: str
    note: str | None = None

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Amount")
        net, vat = _revenue_split(amount, tax)
        lines = _Lines()
        lines.dr(wallet_role(self.to_wallet), amount, self.note)
        lines.cr("other_income", net, self.note)
        lines.cr("vat_output", vat, "ƏDV")
        return JournalSpec("general", lines.build(), self.note or "Digər gəlir", "income", self.income_id,
                           f"income:{self.income_id}", self.posting_date)


@dataclass(frozen=True)
class FinancingMovement:
    """Money in/out from financing: investor funds, loans taken, loans given.

    kind: investor_in | investor_repay | loan_in | loan_repay | lend_out | lend_back
    """

    movement_id: str
    posting_date: date
    kind: str
    wallet: str
    amount: Decimal | str
    counterparty: str | None = None

    _MAP = {
        "investor_in": ("wallet", "investor_loan"),
        "investor_repay": ("investor_loan", "wallet"),
        "loan_in": ("wallet", "other_borrowings"),
        "loan_repay": ("other_borrowings", "wallet"),
        "lend_out": ("other_receivable", "wallet"),
        "lend_back": ("wallet", "other_receivable"),
    }

    def spec(self, tax: TaxSettings) -> JournalSpec:
        if self.kind not in self._MAP:
            raise GLError(f"Unknown financing kind: {self.kind}", "invalid_kind")
        amount = _pos(self.amount, "Amount")
        wallet = wallet_role(self.wallet)
        debit, credit = (wallet if side == "wallet" else side for side in self._MAP[self.kind])
        lines = _Lines()
        kw = {"partner_type": "counterparty", "partner_id": self.counterparty} if self.counterparty else {}
        lines.dr(debit, amount, self.kind, **(kw if debit != wallet else {}))
        lines.cr(credit, amount, self.kind, **(kw if credit != wallet else {}))
        labels = {"investor_in": "İnvestor vəsaiti", "investor_repay": "İnvestora geri ödəniş", "loan_in": "Borc alındı",
                  "loan_repay": "Borc qaytarıldı", "lend_out": "Borc verildi", "lend_back": "Verilmiş borc qaytarıldı"}
        return JournalSpec("general" if self.kind.startswith("investor_in") else "cash", lines.build(), labels[self.kind],
                           "financing", self.movement_id, f"financing:{self.movement_id}", self.posting_date)


# ─────────────────────────────── inventory / suppliers ──────────────────


@dataclass(frozen=True)
class StockReceived:
    receipt_id: str
    posting_date: date
    amount: Decimal | str  # gross invoice amount
    paid_from: str | None = None  # None = on credit (accounts payable)
    supplier_id: str | None = None
    input_vat: Decimal | str = ZERO
    invoice_no: str | None = None

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Amount")
        vat = _pos(self.input_vat, "input_vat")
        if vat and tax.regime != "vat":
            raise GLError("Input VAT can only be recovered under the VAT regime", "vat_not_applicable")
        if vat >= amount and amount:
            raise GLError("Input VAT must be smaller than the gross amount", "invalid_vat")
        lines = _Lines()
        lines.dr("inventory", amount - vat, f"Anbar mədaxili {self.invoice_no or ''}".strip())
        lines.dr("vat_input", vat, "Əvəzləşdirilən ƏDV")
        if self.paid_from is None:
            # Supplier is optional: legacy restocks on credit mostly have none. Unassigned AP
            # stays visible in the AP sub-ledger (partner_id NULL) until P3 introduces bills.
            lines.cr("accounts_payable", amount, "Təchizatçıya borc" + ("" if self.supplier_id else " (təchizatçı göstərilməyib)"),
                     partner_type="supplier" if self.supplier_id else None, partner_id=self.supplier_id)
        else:
            lines.cr(wallet_role(self.paid_from), amount, "Nağd alış")
        return JournalSpec("purchase", lines.build(), f"Mal alışı {self.invoice_no or ''}".strip(), "stock_receipt",
                           self.receipt_id, f"stock:{self.receipt_id}", self.posting_date)


@dataclass(frozen=True)
class StockWrittenOff:
    writeoff_id: str
    posting_date: date
    amount: Decimal | str
    reason: str

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = round_money(Decimal(str(self.amount or 0)))
        if amount <= 0:
            raise GLError("Write-off amount must be > 0", "invalid_amount")
        if not str(self.reason or "").strip():
            raise GLError("A write-off reason is required", "reason_required")
        lines = _Lines()
        lines.dr("inventory_writeoff", amount, self.reason)
        lines.cr("inventory", amount, self.reason)
        return JournalSpec("adjustment", lines.build(), f"Anbar itkisi: {self.reason}", "stock_writeoff",
                           self.writeoff_id, f"writeoff:{self.writeoff_id}", self.posting_date)


@dataclass(frozen=True)
class SupplierPaid:
    payment_id: str
    posting_date: date
    supplier_id: str
    amount: Decimal | str
    paid_from: str
    bank_fee: Decimal | str = ZERO

    def spec(self, tax: TaxSettings) -> JournalSpec:
        amount = _pos(self.amount, "Amount")
        fee = _pos(self.bank_fee, "bank_fee")
        lines = _Lines()
        lines.dr("accounts_payable", amount, "Təchizatçı borcu ödənildi", partner_type="supplier", partner_id=self.supplier_id)
        lines.cr(wallet_role(self.paid_from), amount + fee, "Ödəniş")
        lines.dr("bank_fees", fee, "Bank komissiyası")
        return JournalSpec("purchase", lines.build(), "Təchizatçıya ödəniş", "supplier_payment", self.payment_id,
                           f"supplier_payment:{self.payment_id}", self.posting_date)


# ─────────────────────────────── posting ────────────────────────────────


def post_event(db: Session, tenant_id: str, event, *, actor: str, require_approval: bool = False) -> GLJournal:
    """Resolve the tax regime for the event's date, build its spec and post it (idempotent)."""
    posting_date = getattr(event, "posting_date", None) or gl.business_today()
    tax = get_tax_profile(db, tenant_id, posting_date)
    spec = event.spec(tax)
    debit, credit = spec.totals()
    if debit != credit:  # defensive: every rule must balance by construction
        raise GLError(f"Posting rule {type(event).__name__} produced an unbalanced journal ({debit} ≠ {credit})", "rule_unbalanced", 500)
    return gl.create_journal(
        db,
        tenant_id=tenant_id,
        journal_type=spec.journal_type,
        lines=spec.lines,
        created_by=actor,
        posting_date=spec.posting_date or posting_date,
        description=spec.description,
        source_module="pos",
        source_type=spec.source_type,
        source_id=spec.source_id,
        idempotency_key=spec.idempotency_key,
        branch_id=spec.branch_id,
        require_approval=require_approval,
    )


def active_sale_journal(db: Session, tenant_id: str, sale_id: str) -> GLJournal | None:
    """The current (latest, not reversed) *native* sale journal.

    Mirrored legacy journals (idempotency ``legacy:<id>``) are deliberately
    excluded: sales made before dual mode are corrected through legacy flows and
    mirrored, never through the native rules.
    """
    return (
        db.query(GLJournal)
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.source_type == "sale", GLJournal.source_id == sale_id,
                GLJournal.status == "posted", GLJournal.reversed_by_id.is_(None), GLJournal.journal_type == "sales",
                GLJournal.idempotency_key.like(f"sale:{sale_id}:v%"))
        .order_by(GLJournal.created_at.desc())
        .first()
    )


def void_sale(db: Session, tenant_id: str, sale_id: str, *, actor: str, reason: str, stock_returned: bool) -> list[GLJournal]:
    """Full void: reverse the sale journal. If stock was *not* returned, the COGS
    part is re-booked as a write-off (goods are gone even though the sale is not).
    Returns ``[storno]`` or ``[storno, write_off]``."""
    journal = active_sale_journal(db, tenant_id, sale_id)
    if not journal:
        raise GLError("No active sale journal to void", "sale_journal_not_found", 404)
    # Dated today: a void must not silently change an already-closed shift/day.
    reversal = gl.reverse_journal(db, tenant_id, journal.id, actor=actor, reason=f"Satış ləğvi: {reason}",
                                  posting_date=gl.business_today(), require_approval=False)
    if not stock_returned:
        from app.gl.models import GLAccount, GLJournalLine

        cogs_account = db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.system_role == "cogs").one()
        cogs = sum(
            (Decimal(str(l.debit)) for l in db.query(GLJournalLine).filter(GLJournalLine.journal_id == journal.id,
                                                                           GLJournalLine.account_id == cogs_account.id)),
            ZERO,
        )
        if cogs > 0:
            writeoff = post_event(db, tenant_id, StockWrittenOff(f"void:{sale_id}", reversal.posting_date, cogs, f"Ləğv edilmiş satış {sale_id[:8]}"), actor=actor)
            return [reversal, writeoff]
    return [reversal]


def correct_sale(db: Session, tenant_id: str, corrected: SaleCompleted, *, actor: str, reason: str) -> list[GLJournal]:
    """Replace a sale's accounting (e.g. payment method or amount corrected):
    reverse the active journal and post the corrected event as the next version.
    Returns ``[storno, new_version]`` — callers comparing money effects need both."""
    current = active_sale_journal(db, tenant_id, corrected.sale_id)
    if not current:
        raise GLError("No active sale journal to correct", "sale_journal_not_found", 404)
    key = str(current.idempotency_key or "")
    version = int(key.rsplit(":v", 1)[1]) + 1 if ":v" in key else 2
    today = gl.business_today()
    storno = gl.reverse_journal(db, tenant_id, current.id, actor=actor, reason=f"Satış düzəlişi: {reason}", posting_date=today, require_approval=False)
    return [storno, post_event(db, tenant_id, replace(corrected, version=version, posting_date=today), actor=actor)]
