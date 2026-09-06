"""add push_deliveries table (P1.4)

Push göndərmə jurnalı. Bundan əvvəl heç bir cədvəl kanal/status/provayder
saxlamırdı: `notifications` tətbiq içi poçt qutusudur, `staff_notifications`
isə işçi bildirişidir. Push-un **niyə çatmadığı** (konfiqurasiya mənbəyi,
provayderin cavabı, cəhd/qəbul sayı) yalnız bu cədvəldə görünür.

Həcm qeydi: hadisə push-ları yalnız müştəridə abunəlik id-si olanda yazılır,
yəni sətir sayı real cəhdlərə bərabərdir.

Revision ID: 20260905_0002
Revises: 20260905_0001
Create Date: 2026-09-05 12:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260905_0002"
down_revision: Union[str, None] = "20260905_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "push_deliveries",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("tenant_id", sa.String(length=36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="event"),
        sa.Column("event", sa.String(length=40), nullable=True),
        sa.Column("title", sa.String(length=160), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("segment", sa.String(length=40), nullable=True),
        sa.Column("segment_value", sa.String(length=80), nullable=True),
        sa.Column("card_id", sa.String(length=80), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="skipped"),
        sa.Column("config_source", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("recipients", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("accepted", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("provider_id", sa.String(length=64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_push_deliveries_tenant_id", "push_deliveries", ["tenant_id"], unique=False)
    op.create_index("ix_push_deliveries_card_id", "push_deliveries", ["card_id"], unique=False)
    op.create_index("ix_push_deliveries_created_at", "push_deliveries", ["created_at"], unique=False)
    op.create_index(
        "ix_push_deliveries_tenant_created", "push_deliveries", ["tenant_id", "created_at"], unique=False
    )
    op.create_index(
        "ix_push_deliveries_tenant_kind_created",
        "push_deliveries",
        ["tenant_id", "kind", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_push_deliveries_tenant_kind_created", table_name="push_deliveries")
    op.drop_index("ix_push_deliveries_tenant_created", table_name="push_deliveries")
    op.drop_index("ix_push_deliveries_created_at", table_name="push_deliveries")
    op.drop_index("ix_push_deliveries_card_id", table_name="push_deliveries")
    op.drop_index("ix_push_deliveries_tenant_id", table_name="push_deliveries")
    op.drop_table("push_deliveries")
