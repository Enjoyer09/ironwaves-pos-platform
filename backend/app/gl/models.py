"""SQLAlchemy models for the Finance v2 General Ledger.

All tables are prefixed with ``gl_`` and live side by side with the legacy
``finance_*`` tables until the migration (P1) is complete.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

MONEY = Numeric(18, 2)


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.utcnow()


ACCOUNT_TYPES = ("asset", "liability", "equity", "revenue", "expense")
JOURNAL_TYPES = ("sales", "purchase", "cash", "bank", "general", "adjustment", "tax", "opening", "closing", "reversal", "migration")
JOURNAL_STATUSES = ("draft", "pending_approval", "posted", "rejected")
PERIOD_STATUSES = ("open", "soft_closed", "closed")
TAX_REGIMES = ("simplified", "vat", "exempt")


class GLAccount(Base):
    """Chart of accounts node (AMHP based). Only ``is_postable`` leaves accept lines."""

    __tablename__ = "gl_accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_gl_accounts_tenant_code"),
        UniqueConstraint("tenant_id", "system_role", name="uq_gl_accounts_tenant_role"),
        CheckConstraint("account_type IN ('asset','liability','equity','revenue','expense')", name="ck_gl_accounts_type"),
        CheckConstraint("normal_side IN ('debit','credit')", name="ck_gl_accounts_normal_side"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("gl_accounts.id"), nullable=True, index=True)
    account_class: Mapped[int] = mapped_column(Integer, nullable=False)  # AMHP bölmə 1..9
    account_type: Mapped[str] = mapped_column(String(16), nullable=False)
    normal_side: Mapped[str] = mapped_column(String(8), nullable=False)
    is_postable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Stable semantic handle used by posting rules (e.g. "cash_drawer").
    system_role: Mapped[str | None] = mapped_column(String(48), nullable=True)
    allow_negative: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    requires_partner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="AZN")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class GLFiscalPeriod(Base):
    __tablename__ = "gl_fiscal_periods"
    __table_args__ = (
        UniqueConstraint("tenant_id", "year", "month", name="uq_gl_periods_tenant_year_month"),
        CheckConstraint("month BETWEEN 1 AND 12", name="ck_gl_periods_month"),
        CheckConstraint("status IN ('open','soft_closed','closed')", name="ck_gl_periods_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    closed_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class GLJournal(Base):
    __tablename__ = "gl_journals"
    __table_args__ = (
        UniqueConstraint("tenant_id", "journal_no", name="uq_gl_journals_tenant_no"),
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_gl_journals_tenant_idem"),
        CheckConstraint("status IN ('draft','pending_approval','posted','rejected')", name="ck_gl_journals_status"),
        CheckConstraint("total_debit = total_credit", name="ck_gl_journals_balanced"),
        Index("ix_gl_journals_tenant_date", "tenant_id", "posting_date"),
        Index("ix_gl_journals_tenant_status", "tenant_id", "status"),
        Index("ix_gl_journals_tenant_source", "tenant_id", "source_type", "source_id"),
        Index("ix_gl_journals_tenant_legacy", "tenant_id", "legacy_ref"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    journal_no: Mapped[str | None] = mapped_column(String(32), nullable=True)  # assigned on post (gapless)
    journal_type: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    posting_date: Mapped[date] = mapped_column(Date, nullable=False)
    period_id: Mapped[str] = mapped_column(String(36), ForeignKey("gl_fiscal_periods.id"), nullable=False, index=True)
    branch_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="AZN")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_module: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(160), nullable=True)
    legacy_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    total_debit: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0.00"))
    total_credit: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0.00"))
    reversal_of_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("gl_journals.id"), nullable=True, index=True)
    reversed_by_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("gl_journals.id"), nullable=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    approved_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    posted_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejected_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class GLJournalLine(Base):
    __tablename__ = "gl_journal_lines"
    __table_args__ = (
        UniqueConstraint("journal_id", "line_no", name="uq_gl_lines_journal_line"),
        CheckConstraint("debit >= 0 AND credit >= 0", name="ck_gl_lines_non_negative"),
        CheckConstraint("(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)", name="ck_gl_lines_one_side"),
        Index("ix_gl_lines_tenant_account", "tenant_id", "account_id"),
        Index("ix_gl_lines_tenant_journal", "tenant_id", "journal_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    journal_id: Mapped[str] = mapped_column(String(36), ForeignKey("gl_journals.id"), nullable=False)
    line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("gl_accounts.id"), nullable=False)
    debit: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0.00"))
    credit: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0.00"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="AZN")
    branch_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    partner_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    partner_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tax_code: Mapped[str | None] = mapped_column(String(24), nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)


class GLAccountBalance(Base):
    """Materialized per-period turnover, updated in the same DB transaction as posting."""

    __tablename__ = "gl_account_balances"
    __table_args__ = (
        UniqueConstraint("tenant_id", "account_id", "period_id", "branch_key", name="uq_gl_balances_key"),
        Index("ix_gl_balances_tenant_period", "tenant_id", "period_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("gl_accounts.id"), nullable=False)
    period_id: Mapped[str] = mapped_column(String(36), ForeignKey("gl_fiscal_periods.id"), nullable=False)
    branch_key: Mapped[str] = mapped_column(String(36), nullable=False, default="")
    debit_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0.00"))
    credit_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0.00"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class GLSequence(Base):
    """Row-locked counters: gapless journal numbers and the audit hash chain head."""

    __tablename__ = "gl_sequences"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_gl_sequences_tenant_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


class GLTaxProfile(Base):
    """Effective-dated tax regime per tenant. A new row starts on the first day of a month."""

    __tablename__ = "gl_tax_profiles"
    __table_args__ = (
        UniqueConstraint("tenant_id", "effective_from", name="uq_gl_tax_profiles_tenant_from"),
        CheckConstraint("regime IN ('simplified','vat','exempt')", name="ck_gl_tax_profiles_regime"),
        CheckConstraint("simplified_rate >= 0 AND simplified_rate <= 100", name="ck_gl_tax_profiles_simplified_rate"),
        CheckConstraint("vat_rate >= 0 AND vat_rate <= 100", name="ck_gl_tax_profiles_vat_rate"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    regime: Mapped[str] = mapped_column(String(16), nullable=False)
    simplified_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0.00"))
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0.00"))
    prices_include_vat: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class GLAuditEvent(Base):
    """Append-only, hash-chained audit trail. Tampering breaks the chain."""

    __tablename__ = "gl_audit_events"
    __table_args__ = (
        UniqueConstraint("tenant_id", "seq", name="uq_gl_audit_tenant_seq"),
        Index("ix_gl_audit_tenant_entity", "tenant_id", "entity_type", "entity_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class GLShadowRun(Base):
    """Shadow-mode job log: legacy→GL sync batches and nightly reconciliations."""

    __tablename__ = "gl_shadow_runs"
    __table_args__ = (Index("ix_gl_shadow_runs_tenant_type_started", "tenant_id", "run_type", "started_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    run_type: Mapped[str] = mapped_column(String(16), nullable=False)  # sync | reconcile
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)


class GLLegacyLink(Base):
    """Dual mode: which legacy transactions a native GL journal replaces.

    A covered legacy transaction is never mirrored by the shadow job (that would
    double-count). ``wallet_diff`` records, per legacy wallet code, how the
    native journal differs from the legacy postings it covers (e.g. the card fee
    legacy forgot on table checks) so nightly reconciliation can explain every
    cent of difference.
    """

    __tablename__ = "gl_legacy_links"
    __table_args__ = (
        UniqueConstraint("tenant_id", "legacy_txn_id", name="uq_gl_legacy_links_txn"),
        Index("ix_gl_legacy_links_tenant_journal", "tenant_id", "journal_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    legacy_txn_id: Mapped[str] = mapped_column(String(36), nullable=False)
    journal_id: Mapped[str] = mapped_column(String(36), ForeignKey("gl_journals.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    wallet_diff: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


DOCUMENT_KINDS = ("ap_bill", "ar_invoice")
# pending_approval/rejected follow the bill journal's approval (String(16), no CHECK: no migration needed).
DOCUMENT_STATUSES = ("pending_approval", "open", "partially_paid", "paid", "rejected", "void")


class GLDocument(Base):
    """Business source document (AP bill or AR invoice) linked to GL postings.

    Holds the business metadata (number, due date, terms) and tracks payment
    settlement via ``gl_document_allocations`` while keeping the GL as the
    immutable double-entry source of truth.
    """

    __tablename__ = "gl_documents"
    __table_args__ = (
        UniqueConstraint("tenant_id", "kind", "partner_id", "number", name="uq_gl_documents_partner_number"),
        Index("ix_gl_documents_tenant_kind_status", "tenant_id", "kind", "status"),
        Index("ix_gl_documents_tenant_partner", "tenant_id", "partner_id"),
        Index("ix_gl_documents_tenant_due", "tenant_id", "due_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # ap_bill | ar_invoice
    partner_type: Mapped[str] = mapped_column(String(24), nullable=False)  # supplier | customer | counterparty
    partner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    number: Mapped[str] = mapped_column(String(64), nullable=False)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="AZN")
    total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")  # see DOCUMENT_STATUSES
    journal_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("gl_journals.id"), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class GLDocumentAllocation(Base):
    """Settlement link: connects a payment journal line to an open document."""

    __tablename__ = "gl_document_allocations"
    __table_args__ = (
        Index("ix_gl_doc_alloc_tenant_document", "tenant_id", "document_id"),
        Index("ix_gl_doc_alloc_tenant_journal", "tenant_id", "journal_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("gl_documents.id"), nullable=False)
    journal_id: Mapped[str] = mapped_column(String(36), ForeignKey("gl_journals.id"), nullable=False)
    journal_line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

