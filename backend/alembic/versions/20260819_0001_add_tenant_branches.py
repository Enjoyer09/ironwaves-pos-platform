"""add tenant_branches for multi-branch support

Revision ID: 20260819_0001
Revises: 20260816_0006
Create Date: 2026-08-19 12:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260819_0001"
down_revision: Union[str, None] = "20260816_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name

    # ── 1. Create table (idempotent: skip if already exists) ──────────
    inspector = sa.inspect(conn)
    if "tenant_branches" not in inspector.get_table_names():
        op.create_table(
            "tenant_branches",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("address", sa.String(300), nullable=True),
            sa.Column("phone", sa.String(64), nullable=True),
            sa.Column("latitude", sa.Float, nullable=True),
            sa.Column("longitude", sa.Float, nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true" if dialect == "postgresql" else "1")),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false" if dialect == "postgresql" else "0")),
            sa.Column("open_hour", sa.Integer(), nullable=False, server_default=sa.text("8")),
            sa.Column("close_hour", sa.Integer(), nullable=False, server_default=sa.text("23")),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("tenant_id", "name", name="uq_tenant_branch_name"),
        )

        existing_indexes = {idx["name"] for idx in inspector.get_indexes("tenant_branches")} if "tenant_branches" in inspector.get_table_names() else set()
        if "ix_tenant_branches_tenant_id" not in existing_indexes:
            op.create_index("ix_tenant_branches_tenant_id", "tenant_branches", ["tenant_id"])
        if "ix_tenant_branches_tenant_active" not in existing_indexes:
            op.create_index("ix_tenant_branches_tenant_active", "tenant_branches", ["tenant_id", "is_active"])

    # ── 2. Backfill: create a default branch per tenant (Python-side UUID) ──
    # Use Python uuid4() to avoid dialect-specific SQL functions.
    import uuid
    from datetime import datetime, timezone

    # Check if any branches already exist — skip if so (idempotent).
    existing_count = conn.execute(
        sa.text("SELECT COUNT(*) FROM tenant_branches")
    ).scalar()

    if existing_count == 0:
        # Fetch business_profiles that don't have a branch yet
        rows = conn.execute(
            sa.text(
                """
                SELECT bp.tenant_id, bp.company_name, bp.address, bp.phone
                FROM business_profiles bp
                WHERE NOT EXISTS (
                    SELECT 1 FROM tenant_branches tb WHERE tb.tenant_id = bp.tenant_id
                )
                """
            )
        ).fetchall()

        now = datetime.now(timezone.utc)
        for row in rows:
            tenant_id = row[0]
            company_name = row[1] or "Main"
            address = row[2]
            phone = row[3]
            branch_id = str(uuid.uuid4())

            if dialect == "postgresql":
                conn.execute(
                    sa.text(
                        """
                        INSERT INTO tenant_branches
                            (id, tenant_id, name, address, phone, is_active, is_default, sort_order, created_at)
                        VALUES
                            (:id, :tenant_id, :name, :address, :phone, true, true, 0, :created_at)
                        """
                    ),
                    {
                        "id": branch_id,
                        "tenant_id": tenant_id,
                        "name": company_name,
                        "address": address,
                        "phone": phone,
                        "created_at": now,
                    },
                )
            else:
                conn.execute(
                    sa.text(
                        """
                        INSERT INTO tenant_branches
                            (id, tenant_id, name, address, phone, is_active, is_default, sort_order, created_at)
                        VALUES
                            (:id, :tenant_id, :name, :address, :phone, 1, 1, 0, :created_at)
                        """
                    ),
                    {
                        "id": branch_id,
                        "tenant_id": tenant_id,
                        "name": company_name,
                        "address": address,
                        "phone": phone,
                        "created_at": now,
                    },
                )


def downgrade() -> None:
    op.drop_table("tenant_branches")
