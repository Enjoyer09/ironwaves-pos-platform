"""P4.3 — push_schedules (planlanmış kütləvi bildiriş).

Niyə lazımdır: kampaniyanı sükut saatı bitəndə elan etmək üçün admin gecə oyaq
qalmamalıdır. İndiyə qədər göndərmə yalnız **indi** mümkün idi
(`POST /push/broadcast`), yəni "sabah 09:00-da Cümə endirimini elan et" tapşırığı
insan yaddaşına həvalə olunurdu.

`campaign_id` FK **deyil** — `push_deliveries.campaign_id` (20261011_0002) ilə eyni
səbəb: silinmiş kampaniya planın/göndərmənin tarixçəsini itirməməlidir.

Revision ID: 20261011_0003
Revises: 20261011_0002
"""
from alembic import op
import sqlalchemy as sa

revision = "20261011_0003"
down_revision = "20261011_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_schedules",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("spec_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("campaign_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("scheduled_at", sa.DateTime(), nullable=False),
        sa.Column("executed_at", sa.DateTime(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("delivery_id", sa.String(length=36), nullable=True),
        sa.Column("created_by", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_push_schedules_tenant_id", "push_schedules", ["tenant_id"])
    op.create_index("ix_push_schedules_scheduled_at", "push_schedules", ["scheduled_at"])
    op.create_index("ix_push_schedules_campaign_id", "push_schedules", ["campaign_id"])
    # Scheduler-in əsas sorğusu: "pending + vaxtı çatıb" — birgə indeks olmasa
    # hər dövrədə tam cədvəl skanı gedərdi (hər 60 saniyədə).
    op.create_index("ix_push_schedules_due", "push_schedules", ["status", "scheduled_at"])
    op.create_index("ix_push_schedules_tenant_status", "push_schedules", ["tenant_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_push_schedules_tenant_status", table_name="push_schedules")
    op.drop_index("ix_push_schedules_due", table_name="push_schedules")
    op.drop_index("ix_push_schedules_campaign_id", table_name="push_schedules")
    op.drop_index("ix_push_schedules_scheduled_at", table_name="push_schedules")
    op.drop_index("ix_push_schedules_tenant_id", table_name="push_schedules")
    op.drop_table("push_schedules")
