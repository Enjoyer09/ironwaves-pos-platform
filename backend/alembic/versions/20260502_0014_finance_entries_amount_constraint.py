"""finance entries amount constraint

Revision ID: 20260502_0014
Revises: 20260429_0013
Create Date: 2026-05-02 00:00:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260502_0014"
down_revision: Union[str, None] = "20260429_0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Adding a check constraint to ensure that amount is strictly positive
    op.create_check_constraint(
        "ck_finance_entries_amount_positive",
        "finance_entries",
        "amount > 0"
    )


def downgrade() -> None:
    op.drop_constraint("ck_finance_entries_amount_positive", "finance_entries", type_="check")
