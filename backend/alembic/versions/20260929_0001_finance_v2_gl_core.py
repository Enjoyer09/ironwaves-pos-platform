"""Finance v2: General Ledger core (additive, legacy finance tables untouched)

Yeni `gl_*` cədvəlləri: hesablar planı (AMHP), maliyyə dövrləri, jurnallar,
jurnal sətirləri, materiallaşdırılmış qalıqlar, ardıcıllıqlar, vergi profili,
hash-zəncirli audit.

PostgreSQL-də əlavə olaraq DB səviyyəli invariantlar qurulur:
- post olunmuş jurnal/sətir dəyişdirilə və silinə bilməz (yalnız reversed_by_id linki);
- post anında Σdebit = Σkredit və ≥ 2 sətir (deferred constraint trigger);
- bağlı (closed) dövrə post qadağandır;
- audit hadisələri append-only.

Revision ID: 20260929_0001
Revises: 20260905_0002
Create Date: 2026-09-29 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260929_0001"
down_revision: Union[str, None] = "20260905_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(18, 2)


def _id():
    return sa.Column("id", sa.String(length=36), primary_key=True)


def _tenant(index: bool = True):
    return sa.Column("tenant_id", sa.String(length=36), sa.ForeignKey("tenants.id"), nullable=False, index=index)


def upgrade() -> None:
    op.create_table(
        "gl_accounts",
        _id(),
        _tenant(),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("parent_id", sa.String(36), sa.ForeignKey("gl_accounts.id"), nullable=True, index=True),
        sa.Column("account_class", sa.Integer(), nullable=False),
        sa.Column("account_type", sa.String(16), nullable=False),
        sa.Column("normal_side", sa.String(8), nullable=False),
        sa.Column("is_postable", sa.Boolean(), nullable=False),
        sa.Column("system_role", sa.String(48), nullable=True),
        sa.Column("allow_negative", sa.Boolean(), nullable=False),
        sa.Column("requires_partner", sa.Boolean(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("tenant_id", "code", name="uq_gl_accounts_tenant_code"),
        sa.UniqueConstraint("tenant_id", "system_role", name="uq_gl_accounts_tenant_role"),
        sa.CheckConstraint("account_type IN ('asset','liability','equity','revenue','expense')", name="ck_gl_accounts_type"),
        sa.CheckConstraint("normal_side IN ('debit','credit')", name="ck_gl_accounts_normal_side"),
    )

    op.create_table(
        "gl_fiscal_periods",
        _id(),
        _tenant(),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("closed_by", sa.String(80), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("tenant_id", "year", "month", name="uq_gl_periods_tenant_year_month"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_gl_periods_month"),
        sa.CheckConstraint("status IN ('open','soft_closed','closed')", name="ck_gl_periods_status"),
    )

    op.create_table(
        "gl_journals",
        _id(),
        _tenant(),
        sa.Column("journal_no", sa.String(32), nullable=True),
        sa.Column("journal_type", sa.String(16), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("posting_date", sa.Date(), nullable=False),
        sa.Column("period_id", sa.String(36), sa.ForeignKey("gl_fiscal_periods.id"), nullable=False, index=True),
        sa.Column("branch_id", sa.String(36), nullable=True, index=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source_module", sa.String(32), nullable=True),
        sa.Column("source_type", sa.String(40), nullable=True),
        sa.Column("source_id", sa.String(64), nullable=True),
        sa.Column("idempotency_key", sa.String(160), nullable=True),
        sa.Column("legacy_ref", sa.String(64), nullable=True),
        sa.Column("total_debit", MONEY, nullable=False),
        sa.Column("total_credit", MONEY, nullable=False),
        sa.Column("reversal_of_id", sa.String(36), sa.ForeignKey("gl_journals.id"), nullable=True, index=True),
        sa.Column("reversed_by_id", sa.String(36), sa.ForeignKey("gl_journals.id"), nullable=True),
        sa.Column("created_by", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("approved_by", sa.String(80), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("posted_by", sa.String(80), nullable=True),
        sa.Column("posted_at", sa.DateTime(), nullable=True),
        sa.Column("rejected_by", sa.String(80), nullable=True),
        sa.Column("rejected_at", sa.DateTime(), nullable=True),
        sa.Column("reject_reason", sa.Text(), nullable=True),
        sa.UniqueConstraint("tenant_id", "journal_no", name="uq_gl_journals_tenant_no"),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_gl_journals_tenant_idem"),
        sa.CheckConstraint("status IN ('draft','pending_approval','posted','rejected')", name="ck_gl_journals_status"),
        sa.CheckConstraint("total_debit = total_credit", name="ck_gl_journals_balanced"),
    )
    op.create_index("ix_gl_journals_tenant_date", "gl_journals", ["tenant_id", "posting_date"])
    op.create_index("ix_gl_journals_tenant_status", "gl_journals", ["tenant_id", "status"])
    op.create_index("ix_gl_journals_tenant_source", "gl_journals", ["tenant_id", "source_type", "source_id"])
    op.create_index("ix_gl_journals_tenant_legacy", "gl_journals", ["tenant_id", "legacy_ref"])

    op.create_table(
        "gl_journal_lines",
        _id(),
        _tenant(index=False),
        sa.Column("journal_id", sa.String(36), sa.ForeignKey("gl_journals.id"), nullable=False),
        sa.Column("line_no", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("gl_accounts.id"), nullable=False),
        sa.Column("debit", MONEY, nullable=False),
        sa.Column("credit", MONEY, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("branch_id", sa.String(36), nullable=True),
        sa.Column("partner_type", sa.String(24), nullable=True),
        sa.Column("partner_id", sa.String(64), nullable=True),
        sa.Column("tax_code", sa.String(24), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.UniqueConstraint("journal_id", "line_no", name="uq_gl_lines_journal_line"),
        sa.CheckConstraint("debit >= 0 AND credit >= 0", name="ck_gl_lines_non_negative"),
        sa.CheckConstraint("(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)", name="ck_gl_lines_one_side"),
    )
    op.create_index("ix_gl_lines_tenant_account", "gl_journal_lines", ["tenant_id", "account_id"])
    op.create_index("ix_gl_lines_tenant_journal", "gl_journal_lines", ["tenant_id", "journal_id"])

    op.create_table(
        "gl_account_balances",
        _id(),
        _tenant(index=False),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("gl_accounts.id"), nullable=False),
        sa.Column("period_id", sa.String(36), sa.ForeignKey("gl_fiscal_periods.id"), nullable=False),
        sa.Column("branch_key", sa.String(36), nullable=False),
        sa.Column("debit_total", MONEY, nullable=False),
        sa.Column("credit_total", MONEY, nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("tenant_id", "account_id", "period_id", "branch_key", name="uq_gl_balances_key"),
    )
    op.create_index("ix_gl_balances_tenant_period", "gl_account_balances", ["tenant_id", "period_id"])

    op.create_table(
        "gl_sequences",
        _id(),
        _tenant(index=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("last_value", sa.Integer(), nullable=False),
        sa.Column("last_hash", sa.String(64), nullable=True),
        sa.UniqueConstraint("tenant_id", "name", name="uq_gl_sequences_tenant_name"),
    )

    op.create_table(
        "gl_tax_profiles",
        _id(),
        _tenant(),
        sa.Column("regime", sa.String(16), nullable=False),
        sa.Column("simplified_rate", sa.Numeric(5, 2), nullable=False),
        sa.Column("vat_rate", sa.Numeric(5, 2), nullable=False),
        sa.Column("prices_include_vat", sa.Boolean(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("tenant_id", "effective_from", name="uq_gl_tax_profiles_tenant_from"),
        sa.CheckConstraint("regime IN ('simplified','vat','exempt')", name="ck_gl_tax_profiles_regime"),
        sa.CheckConstraint("simplified_rate >= 0 AND simplified_rate <= 100", name="ck_gl_tax_profiles_simplified_rate"),
        sa.CheckConstraint("vat_rate >= 0 AND vat_rate <= 100", name="ck_gl_tax_profiles_vat_rate"),
    )

    op.create_table(
        "gl_audit_events",
        _id(),
        _tenant(index=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=True),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("prev_hash", sa.String(64), nullable=False),
        sa.Column("hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "seq", name="uq_gl_audit_tenant_seq"),
    )
    op.create_index("ix_gl_audit_tenant_entity", "gl_audit_events", ["tenant_id", "entity_type", "entity_id"])

    if op.get_bind().dialect.name == "postgresql":
        _create_postgres_invariants()


def _create_postgres_invariants() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION gl_journal_guard() RETURNS trigger AS $$
        DECLARE period_status text;
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.status = 'posted' THEN
              RAISE EXCEPTION 'GL: posted journal % cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
            END IF;
            RETURN OLD;
          END IF;

          IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
            -- Only the reversal link may be set, once.
            IF OLD.reversed_by_id IS NOT NULL
               OR (NEW.tenant_id, NEW.journal_no, NEW.journal_type, NEW.status, NEW.posting_date, NEW.period_id,
                   NEW.branch_id, NEW.currency, NEW.description, NEW.source_module, NEW.source_type, NEW.source_id,
                   NEW.idempotency_key, NEW.legacy_ref, NEW.total_debit, NEW.total_credit, NEW.reversal_of_id,
                   NEW.created_by, NEW.created_at, NEW.approved_by, NEW.approved_at, NEW.posted_by, NEW.posted_at)
                  IS DISTINCT FROM
                  (OLD.tenant_id, OLD.journal_no, OLD.journal_type, OLD.status, OLD.posting_date, OLD.period_id,
                   OLD.branch_id, OLD.currency, OLD.description, OLD.source_module, OLD.source_type, OLD.source_id,
                   OLD.idempotency_key, OLD.legacy_ref, OLD.total_debit, OLD.total_credit, OLD.reversal_of_id,
                   OLD.created_by, OLD.created_at, OLD.approved_by, OLD.approved_at, OLD.posted_by, OLD.posted_at) THEN
              RAISE EXCEPTION 'GL: posted journal % is immutable', OLD.id USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;

          IF NEW.status = 'posted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'posted') THEN
            SELECT status INTO period_status FROM gl_fiscal_periods WHERE id = NEW.period_id;
            IF period_status = 'closed' THEN
              RAISE EXCEPTION 'GL: period of journal % is closed', NEW.id USING ERRCODE = 'check_violation';
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_gl_journal_guard
        BEFORE INSERT OR UPDATE OR DELETE ON gl_journals
        FOR EACH ROW EXECUTE FUNCTION gl_journal_guard();
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION gl_journal_balanced_check() RETURNS trigger AS $$
        DECLARE d numeric; c numeric; n integer;
        BEGIN
          IF NEW.status <> 'posted' THEN
            RETURN NULL;
          END IF;
          SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*) INTO d, c, n
            FROM gl_journal_lines WHERE journal_id = NEW.id;
          IF n < 2 OR d <> c OR d <> NEW.total_debit THEN
            RAISE EXCEPTION 'GL: journal % is not balanced (lines=%, debit=%, credit=%, header=%)', NEW.id, n, d, c, NEW.total_debit
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER trg_gl_journal_balanced
        AFTER INSERT OR UPDATE ON gl_journals
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION gl_journal_balanced_check();
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION gl_line_guard() RETURNS trigger AS $$
        DECLARE parent_status text;
        BEGIN
          SELECT status INTO parent_status FROM gl_journals WHERE id = COALESCE(NEW.journal_id, OLD.journal_id);
          IF parent_status = 'posted' THEN
            RAISE EXCEPTION 'GL: lines of posted journal % are immutable', COALESCE(NEW.journal_id, OLD.journal_id)
              USING ERRCODE = 'check_violation';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_gl_line_guard
        BEFORE INSERT OR UPDATE OR DELETE ON gl_journal_lines
        FOR EACH ROW EXECUTE FUNCTION gl_line_guard();
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION gl_audit_append_only() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'GL: audit events are append-only' USING ERRCODE = 'check_violation';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_gl_audit_append_only
        BEFORE UPDATE OR DELETE ON gl_audit_events
        FOR EACH ROW EXECUTE FUNCTION gl_audit_append_only();
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_gl_audit_append_only ON gl_audit_events")
        op.execute("DROP TRIGGER IF EXISTS trg_gl_line_guard ON gl_journal_lines")
        op.execute("DROP TRIGGER IF EXISTS trg_gl_journal_balanced ON gl_journals")
        op.execute("DROP TRIGGER IF EXISTS trg_gl_journal_guard ON gl_journals")
        op.execute("DROP FUNCTION IF EXISTS gl_audit_append_only()")
        op.execute("DROP FUNCTION IF EXISTS gl_line_guard()")
        op.execute("DROP FUNCTION IF EXISTS gl_journal_balanced_check()")
        op.execute("DROP FUNCTION IF EXISTS gl_journal_guard()")
    for table in (
        "gl_audit_events",
        "gl_tax_profiles",
        "gl_sequences",
        "gl_account_balances",
        "gl_journal_lines",
        "gl_journals",
        "gl_fiscal_periods",
        "gl_accounts",
    ):
        op.drop_table(table)
