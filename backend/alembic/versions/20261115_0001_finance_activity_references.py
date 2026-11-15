"""Index finance audit references without changing tenant transactions.

Revision ID: 20261115_0001
Revises: 20261026_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261115_0001"
down_revision = "20261026_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "finance_activity_references",
        sa.Column("audit_id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("transaction_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_finance_activity_ref_lookup", "finance_activity_references",
        ["tenant_id", "transaction_id", "kind", "created_at"],
    )
    op.execute("""
        CREATE FUNCTION finance_activity_transaction_id(event_action text, event_details text)
        RETURNS text LANGUAGE plpgsql AS $$
        DECLARE value jsonb;
        BEGIN
            IF event_action NOT IN ('FINANCE_ENTRY_CREATED', 'FINANCE_LEGACY_WALLET_SYNC_SKIPPED') THEN
                RETURN NULL;
            END IF;
            value := event_details::jsonb;
            IF event_action = 'FINANCE_ENTRY_CREATED' THEN
                RETURN NULLIF(value->>'ledger_transaction_id', '');
            END IF;
            IF value->>'transaction_type' = 'expense' THEN
                RETURN NULLIF(value->>'transaction_id', '');
            END IF;
            RETURN NULL;
        EXCEPTION WHEN invalid_text_representation THEN
            RETURN NULL;
        END;
        $$
    """)
    op.execute("""
        CREATE FUNCTION finance_activity_reference_on_audit_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE reference_id text;
        BEGIN
            reference_id := finance_activity_transaction_id(NEW.action, NEW.details);
            IF reference_id IS NOT NULL AND length(reference_id) <= 36 THEN
                INSERT INTO finance_activity_references
                    (audit_id, tenant_id, transaction_id, kind, created_at)
                VALUES (
                    NEW.id, NEW.tenant_id, reference_id,
                    CASE WHEN NEW.action = 'FINANCE_ENTRY_CREATED' THEN 'manual' ELSE 'fee' END,
                    NEW.created_at
                ) ON CONFLICT (audit_id) DO NOTHING;
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    # Trigger first: writes from still-running old app instances are captured
    # while the historical projection is populated.
    op.execute("""
        CREATE TRIGGER trg_finance_activity_reference
        AFTER INSERT ON audit_logs FOR EACH ROW
        WHEN (NEW.action IN ('FINANCE_ENTRY_CREATED', 'FINANCE_LEGACY_WALLET_SYNC_SKIPPED'))
        EXECUTE FUNCTION finance_activity_reference_on_audit_insert()
    """)
    op.execute("""
        INSERT INTO finance_activity_references
            (audit_id, tenant_id, transaction_id, kind, created_at)
        SELECT id, tenant_id, transaction_id,
               CASE WHEN action = 'FINANCE_ENTRY_CREATED' THEN 'manual' ELSE 'fee' END,
               created_at
        FROM (
            SELECT id, tenant_id, action, created_at,
                   finance_activity_transaction_id(action, details) AS transaction_id
            FROM audit_logs
            WHERE action IN ('FINANCE_ENTRY_CREATED', 'FINANCE_LEGACY_WALLET_SYNC_SKIPPED')
        ) source
        WHERE transaction_id IS NOT NULL AND length(transaction_id) <= 36
        ON CONFLICT (audit_id) DO NOTHING
    """)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS trg_finance_activity_reference ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS finance_activity_reference_on_audit_insert()")
    op.execute("DROP FUNCTION IF EXISTS finance_activity_transaction_id(text, text)")
    op.drop_index("ix_finance_activity_ref_lookup", table_name="finance_activity_references")
    op.drop_table("finance_activity_references")
