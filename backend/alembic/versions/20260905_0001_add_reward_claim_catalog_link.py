"""add reward catalogue link columns to reward_claims (P1.3)

`reward_id` — `customer_app_settings.rewards` içindəki sətrin id-si. FK deyil,
çünki kataloq ayar blobundadır; NULL = kataloqdan əvvəl verilmiş köhnə claim.
`menu_item_id` — hədiyyə konkret məhsula bağlıdırsa kassa endirimi məhz ona
tətbiq edir (`pos.py`). Kataloq sətri sonradan silinsə də claim öz məhsulunu
saxlayır, ona görə dəyər claim sətrinə köçürülür.

Revision ID: 20260905_0001
Revises: 20260903_0001
Create Date: 2026-09-05 10:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260905_0001"
down_revision: Union[str, None] = "20260903_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reward_claims",
        sa.Column("reward_id", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "reward_claims",
        sa.Column("menu_item_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_reward_claims_reward_id",
        "reward_claims",
        ["reward_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_reward_claims_reward_id", table_name="reward_claims")
    op.drop_column("reward_claims", "menu_item_id")
    op.drop_column("reward_claims", "reward_id")
