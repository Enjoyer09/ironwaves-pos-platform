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
    # Use batch mode for SQLite compatibility in CI
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("finance_entries") as batch_op:
            batch_op.create_check_constraint(
                "ck_finance_entries_amount_positive",
                "amount > 0"
            )
    else:
        op.create_check_constraint(
            "ck_finance_entries_amount_positive",
            "finance_entries",
            "amount > 0"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("finance_entries") as batch_op:
            batch_op.drop_constraint("ck_finance_entries_amount_positive", type_="check")
    else:
        op.drop_constraint("ck_finance_entries_amount_positive", "finance_entries", type_="check")
