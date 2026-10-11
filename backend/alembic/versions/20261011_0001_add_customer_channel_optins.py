"""add channel opt-in columns to customers (P4.1)

Kanal bazlı marketinq razılığı — global standart + qanuni tələb.

`customer_consents` yalnız tətbiqə qoşulma razılığıdır (consent_type='customer_app'),
kanal bazlı (push/email/sms) ayrıca razılıq saxlamır. Push/email göndəricisi
indiyə qədər razılıq yoxlamırdı. Bu migration Customer cədvəlinə üç kanal
bayrağı əlavə edir.

Defoltlar qəsdən seçilib:
- push_opt_in=true  — mövcud push_token-lu müştərilər (tətbiq istifadəçiləri)
  bildiriş almağı gözləyir; onları səssizcə kəsmək itki olardı. Yeni qoşulan
  tətbiq istifadəçisi də standart olaraq bildiriş istəyir (iOS/Android
  qoşulma dialoqu artıq icazə tələb edir).
- email/sms=false — ayrıca razılıq olmadan marketinq göndərmək qanunsuzdur.
  Bunlar yalnız istifadəçi açıq şəkildə seçəndə true olur.

Revision ID: 20261011_0001
Revises: 20261008_0002
Create Date: 2026-10-11 12:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "20261011_0001"
down_revision: Union[str, None] = "20261008_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "customers",
        sa.Column("push_opt_in", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "customers",
        sa.Column("email_opt_in", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "customers",
        sa.Column("sms_opt_in", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("customers", "sms_opt_in")
    op.drop_column("customers", "email_opt_in")
    op.drop_column("customers", "push_opt_in")