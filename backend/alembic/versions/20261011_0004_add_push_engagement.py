"""P4.5 — push_engagement (bildirişə toxunma hadisəsi).

Niyə lazımdır: Faza 4-də huninin son pilləsi **atribusiya deyildi** — `Sale.campaign_id`
kassada endirim tətbiq olunanda yazılır, yəni "müştəri bildirişi görüb gəldi" sübut
olunmurdu. Bunun bir hissəsi indi bağlanır: tətbiq bildirişə toxunanda hadisə göndərir.

Nəyi **HƏLL ETMİR**: OneSignal-ın "web push webhooks" xüsusiyyəti burada işləmir — o,
yalnız brauzer üçündür, mobil tətbiq push-una şamil olunmur və səhifənin açıq olmasını
tələb edir (tətbiq bağlı olanda toxunma heç vaxt qeyd olunmazdı). Ona görə hadisə
tətbiqdən (`Capacitor` → `pushNotificationActionPerformed`) gəlir və göndərmə ilə
OneSignal `data.delivery_id` sahəsi vasitəsilə əlaqələnir.

`uq_push_engagement_event` UNIKAL məhdudiyyəti vacibdir: mobil şəbəkə eyni hadisəni iki
dəfə çatdıra bilər, təkrar sətir isə "daha çox açılma" kimi oxunardı.

Revision ID: 20261011_0004
Revises: 20261011_0003
"""
from alembic import op
import sqlalchemy as sa

revision = "20261011_0004"
down_revision = "20261011_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_engagement",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("delivery_id", sa.String(length=36), nullable=False),
        sa.Column("subscription_id", sa.String(length=80), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="opened"),
        sa.Column("card_id", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        # Təkrar hadisə sətri "daha çox açılma" kimi oxunmasın deyə.
        sa.UniqueConstraint(
            "delivery_id", "subscription_id", "kind", name="uq_push_engagement_event"
        ),
    )
    op.create_index("ix_push_engagement_tenant_id", "push_engagement", ["tenant_id"])
    op.create_index("ix_push_engagement_delivery_id", "push_engagement", ["delivery_id"])
    op.create_index("ix_push_engagement_card_id", "push_engagement", ["card_id"])
    op.create_index("ix_push_engagement_created_at", "push_engagement", ["created_at"])
    op.create_index("ix_push_engagement_tenant_created", "push_engagement", ["tenant_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_push_engagement_tenant_created", table_name="push_engagement")
    op.drop_index("ix_push_engagement_created_at", table_name="push_engagement")
    op.drop_index("ix_push_engagement_card_id", table_name="push_engagement")
    op.drop_index("ix_push_engagement_delivery_id", table_name="push_engagement")
    op.drop_index("ix_push_engagement_tenant_id", table_name="push_engagement")
    op.drop_table("push_engagement")
