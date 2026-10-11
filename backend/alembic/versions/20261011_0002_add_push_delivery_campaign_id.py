"""P4.2 — push_deliveries.campaign_id (kampaniya bildirişinin atribusiyası).

Niyə lazımdır: panel indiyə qədər "hansı kampaniya üçün nə göndərdik" sualına cavab
verə bilmirdi. Kütləvi bildiriş `segment`/`segment_value` saxlayırdı, lakin
kampaniya (happy hour) ilə əlaqə yox idi — yəni "Qızıl müştərilər" seqmentinə
getdiyini bilirdik, onun **hansı kampaniya** olduğunu yox.

FK qəsdən qoyulmur: kampaniya silinsə tarixçə sətri qalmalıdır. Bu, audit
sualıdır ("keçən ay bu endirimi elan etdikmi?"), kampaniyanın mövcudluğu ilə
bağlı deyil.

Revision ID: 20261011_0002
Revises: 20261011_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261011_0002"
down_revision = "20261011_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("push_deliveries", sa.Column("campaign_id", sa.String(length=36), nullable=True))
    # Süzgəc "bu kampaniya üçün nə göndərildi" və "son 30 gündə hansı kampaniyalar
    # elan olundu" sorğuları üçündür; tenant sütunu ayrıca indekslə örtülür.
    op.create_index(
        "ix_push_deliveries_campaign_id",
        "push_deliveries",
        ["campaign_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_push_deliveries_campaign_id", table_name="push_deliveries")
    op.drop_column("push_deliveries", "campaign_id")
