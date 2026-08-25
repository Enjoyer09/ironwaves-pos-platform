"""add fiscal and tax regime columns to business_profiles

Revision ID: 20260825_0001
Revises: 20260819_0001
Create Date: 2026-08-25 12:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260825_0001"
down_revision: Union[str, None] = "20260819_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("business_profiles", sa.Column("voen", sa.String(length=64), nullable=True))
    op.add_column("business_profiles", sa.Column("tax_regime", sa.String(length=32), nullable=False, server_default="simplified"))
    op.add_column("business_profiles", sa.Column("vat_rate", sa.Numeric(precision=5, scale=2), nullable=False, server_default="18"))
    op.add_column("business_profiles", sa.Column("nka_registration_no", sa.String(length=64), nullable=True))
    op.add_column("business_profiles", sa.Column("fiscal_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    op.drop_column("business_profiles", "fiscal_enabled")
    op.drop_column("business_profiles", "nka_registration_no")
    op.drop_column("business_profiles", "vat_rate")
    op.drop_column("business_profiles", "tax_regime")
    op.drop_column("business_profiles", "voen")
