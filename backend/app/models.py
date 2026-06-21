import uuid
import secrets
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    domain: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("tenant_id", "username", name="uq_tenant_username"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="staff")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    token_type: Mapped[str] = mapped_column(String(24), nullable=False, default="access")
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Shift(Base):
    __tablename__ = "shifts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="closed")
    opened_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    opening_cash: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    opening_source: Mapped[str | None] = mapped_column(String(24), nullable=True)
    opening_target_cash: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    opening_topup_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    closing_cash: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    actual_cash: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    declared_cash: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cash_variance: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    closing_deposit_liability: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    deposit_settled_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    closed_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    z_report_html: Mapped[str | None] = mapped_column(Text, nullable=True)


class ShiftHandover(Base):
    __tablename__ = "shift_handovers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    handed_by: Mapped[str] = mapped_column(String(80), nullable=False)
    received_by: Mapped[str] = mapped_column(String(80), nullable=False)
    declared_cash: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    actual_cash: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    difference: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="PENDING")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    is_coffee: Mapped[bool] = mapped_column(Boolean, default=False)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Table(Base):
    __tablename__ = "tables"
    __table_args__ = (
        Index("ix_tables_tenant_label", "tenant_id", "label"),
        Index("ix_tables_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    floor_plan_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("floor_plans.id"), nullable=True, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    shape: Mapped[str] = mapped_column(String(32), default="rectangle")
    pos_x: Mapped[int] = mapped_column(Integer, default=0)
    pos_y: Mapped[int] = mapped_column(Integer, default=0)
    width_units: Mapped[int] = mapped_column(Integer, default=2)
    height_units: Mapped[int] = mapped_column(Integer, default=2)
    capacity: Mapped[int] = mapped_column(Integer, default=4)
    status: Mapped[str] = mapped_column(String(24), default="AVAILABLE")
    merged_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    locked_by: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    active_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_occupied: Mapped[bool] = mapped_column(Boolean, default=False)
    assigned_to: Mapped[str | None] = mapped_column(String(80), nullable=True)
    guest_count: Mapped[int] = mapped_column(Integer, default=0)
    deposit_guest_count: Mapped[int] = mapped_column(Integer, default=0)
    deposit_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    deposit_seats_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    items_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class FloorPlan(Base):
    __tablename__ = "floor_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    width_units: Mapped[int] = mapped_column(Integer, default=12)
    height_units: Mapped[int] = mapped_column(Integer, default=8)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Guest(Base):
    __tablename__ = "guests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Reservation(Base):
    __tablename__ = "reservations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    guest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("guests.id"), nullable=True, index=True)
    assigned_table_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tables.id"), nullable=True, index=True)
    reservation_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=90)
    party_size: Mapped[int] = mapped_column(Integer, default=2)
    status: Mapped[str] = mapped_column(String(24), default="BOOKED")
    special_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TableSession(Base):
    __tablename__ = "table_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    table_id: Mapped[str] = mapped_column(String(36), ForeignKey("tables.id"), index=True)
    reservation_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("reservations.id"), nullable=True, index=True)
    assigned_waiter: Mapped[str | None] = mapped_column(String(80), nullable=True)
    guest_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="SEATED")
    seated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Check(Base):
    __tablename__ = "checks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    table_session_id: Mapped[str] = mapped_column(String(36), ForeignKey("table_sessions.id"), index=True)
    check_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), default="OPEN")
    guest_count: Mapped[int] = mapped_column(Integer, default=0)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    service_charge: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class OrderRound(Base):
    __tablename__ = "order_rounds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    check_id: Mapped[str] = mapped_column(String(36), ForeignKey("checks.id"), index=True)
    round_no: Mapped[int] = mapped_column(Integer, default=1)
    course_no: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="SENT")
    sent_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    check_id: Mapped[str] = mapped_column(String(36), ForeignKey("checks.id"), index=True)
    round_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("order_rounds.id"), nullable=True, index=True)
    table_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tables.id"), nullable=True, index=True)
    menu_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("menu_items.id"), nullable=True, index=True)
    seat_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    course_no: Mapped[int] = mapped_column(Integer, default=1)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, default=1)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    status: Mapped[str] = mapped_column(String(24), default="DRAFT")
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    manager_approved_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    parent_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    modifier_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    served_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    stock_consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    stock_consumption_reason: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ItemStatusLog(Base):
    __tablename__ = "item_status_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    order_item_id: Mapped[str] = mapped_column(String(36), ForeignKey("order_items.id"), index=True)
    check_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    round_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    old_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    new_status: Mapped[str] = mapped_column(String(24), nullable=False)
    quantity_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quantity_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    changed_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reason_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    billing_effect: Mapped[str | None] = mapped_column(String(80), nullable=True)
    kitchen_effect: Mapped[str | None] = mapped_column(String(80), nullable=True)
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    check_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("checks.id"), nullable=True, index=True)
    method: Mapped[str] = mapped_column(String(24), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    status: Mapped[str] = mapped_column(String(24), default="POSTED")
    split_group: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    paid_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    paid_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    stock_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"))
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"))
    min_limit: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"))


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    menu_item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    ingredient_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity_required: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=Decimal("0.0000"))


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)


class BusinessProfile(Base):
    __tablename__ = "business_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, unique=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    receipt_footer: Mapped[str | None] = mapped_column(Text, nullable=True)


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (UniqueConstraint("tenant_id", "offline_request_id", name="uq_sales_tenant_offline_request_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    cashier: Mapped[str] = mapped_column(String(80), nullable=False)
    customer_card_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    payment_method: Mapped[str] = mapped_column(String(40), nullable=False)
    order_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    offline_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    receipt_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    receipt_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    receipt_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    reward_claim_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    customer_stars_after: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    free_coffees_applied: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    discount_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cogs: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True, default=Decimal("0.0000"))
    items_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="COMPLETED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FinanceEntry(Base):
    __tablename__ = "finance_entries"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_finance_entries_amount_positive"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    type: Mapped[str] = mapped_column(String(8), nullable=False)  # in/out
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FinanceAccount(Base):
    __tablename__ = "finance_accounts"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_finance_account_tenant_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    account_type: Mapped[str] = mapped_column(String(40), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="AZN")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FinanceTransaction(Base):
    __tablename__ = "finance_transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_finance_transactions_amount_positive"),
        CheckConstraint(
            "status IN ('draft','pending_approval','approved','posted','rejected','reversed')",
            name="ck_finance_transactions_status_valid",
        ),
        Index("ix_finance_transactions_tenant_created", "tenant_id", "created_at"),
        Index("ix_finance_transactions_tenant_status_created", "tenant_id", "status", "created_at"),
        Index("ix_finance_transactions_tenant_type_created", "tenant_id", "transaction_type", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    transaction_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="posted", index=True)
    source_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("finance_accounts.id"), nullable=True, index=True)
    destination_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("finance_accounts.id"), nullable=True, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="AZN")
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    counterparty: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    posted_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reversed_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    related_shift_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    related_table_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    related_order_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    legacy_finance_entry_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)


class FinanceLedgerEntry(Base):
    __tablename__ = "finance_ledger_entries"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_finance_ledger_entries_amount_positive"),
        CheckConstraint("entry_side IN ('debit','credit')", name="ck_finance_ledger_entries_side_valid"),
        Index("ix_finance_ledger_entries_tenant_account_created", "tenant_id", "account_id", "created_at"),
        Index("ix_finance_ledger_entries_tenant_transaction", "tenant_id", "transaction_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    transaction_id: Mapped[str] = mapped_column(String(36), ForeignKey("finance_transactions.id"), index=True)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("finance_accounts.id"), index=True)
    entry_side: Mapped[str] = mapped_column(String(12), nullable=False)  # debit/credit
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="AZN")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FinanceReconciliation(Base):
    __tablename__ = "finance_reconciliations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("finance_accounts.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="reconciled", index=True)
    expected_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    counted_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    variance: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reconciled_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_tenant_created", "tenant_id", "created_at"),
        Index("ix_audit_logs_tenant_action_created", "tenant_id", "action", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    user: Mapped[str] = mapped_column(String(80), nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class KitchenOrder(Base):
    __tablename__ = "kitchen_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    sale_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    table_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    order_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="NEW")
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL")
    items_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("tenant_id", "card_id", name="uq_customer_card_per_tenant"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    card_id: Mapped[str] = mapped_column(String(80), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False, default="Normal")
    stars: Mapped[int] = mapped_column(Integer, default=0)
    secret_token: Mapped[str] = mapped_column(String(64), nullable=False, default=lambda: secrets.token_hex(16))
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("0.00"))
    push_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CustomerConsent(Base):
    __tablename__ = "customer_consents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    card_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    consent_type: Mapped[str] = mapped_column(String(40), nullable=False, default="customer_app")
    accepted: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str | None] = mapped_column(String(80), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(80), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    accepted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_tenant_unread_created", "tenant_id", "is_read", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    card_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RewardClaim(Base):
    __tablename__ = "reward_claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    card_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    claim_code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    reward_name: Mapped[str] = mapped_column(String(120), nullable=False)
    reward_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    points_cost: Mapped[int] = mapped_column(Integer, default=10)
    status: Mapped[str] = mapped_column(String(16), default="PENDING")
    redeemed_sale_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class FeedbackEntry(Base):
    __tablename__ = "feedback_entries"
    __table_args__ = (
        Index("ix_feedback_entries_tenant_created", "tenant_id", "created_at"),
        Index("ix_feedback_entries_tenant_score_created", "tenant_id", "score", "created_at"),
        UniqueConstraint("tenant_id", "receipt_id", "receipt_token", name="uq_feedback_tenant_receipt_token"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    sale_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("sales.id"), nullable=True, index=True)
    receipt_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    receipt_token: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str | None] = mapped_column(String(40), nullable=True, default="receipt")
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact: Mapped[str | None] = mapped_column(String(120), nullable=True)
    staff_username: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FeedbackCoupon(Base):
    __tablename__ = "feedback_coupons"
    __table_args__ = (
        UniqueConstraint("code", name="uq_feedback_coupon_code"),
        UniqueConstraint("tenant_id", "receipt_id", "receipt_token", name="uq_feedback_coupon_tenant_receipt_token"),
        Index("ix_feedback_coupons_tenant_status_issued", "tenant_id", "status", "issued_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    feedback_entry_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("feedback_entries.id"), nullable=True, index=True)
    sale_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("sales.id"), nullable=True, index=True)
    receipt_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    receipt_token: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    percent: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    source: Mapped[str | None] = mapped_column(String(40), nullable=True, default="feedback")
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    redeemed_sale_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("sales.id"), nullable=True, index=True)


class LoyaltyLedgerEntry(Base):
    __tablename__ = "loyalty_ledger"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    card_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    unit: Mapped[str] = mapped_column(String(16), nullable=False, default="points")
    entry_type: Mapped[str] = mapped_column(String(16), nullable=False, default="earn")
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    source_sale_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class StaffNotification(Base):
    __tablename__ = "staff_notifications"
    __table_args__ = (
        Index("ix_staff_notifications_tenant_user_unread_created", "tenant_id", "username", "is_read", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class HappyHour(Base):
    __tablename__ = "happy_hours"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)
    end_time: Mapped[str] = mapped_column(String(5), nullable=False)
    discount_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    days_of_week_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    categories: Mapped[str] = mapped_column(String(255), nullable=False, default="ALL")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DonerBatch(Base):
    __tablename__ = "doner_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    inventory_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    meat_type: Mapped[str] = mapped_column(String(32), nullable=False)
    opened_by: Mapped[str] = mapped_column(String(80), nullable=False)
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    raw_weight_kg: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"))
    raw_to_ready_ratio: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("1.0000"))
    expected_ready_weight_kg: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"))
    sold_ready_weight_kg: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"))
    deducted_raw_weight_kg: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"))
    actual_remaining_raw_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(14, 3), nullable=True)
    variance_percent: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="OPEN")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WasteLog(Base):
    __tablename__ = "waste_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    inventory_name: Mapped[str] = mapped_column(String(255), nullable=False)
    meat_type: Mapped[str] = mapped_column(String(32), nullable=False)
    expected_raw_consumption_kg: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"))
    actual_raw_consumption_kg: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"))
    variance_percent: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0.00"))
    tolerance_percent: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("5.00"))
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AgentInsight(Base):
    __tablename__ = "agent_insights"
    __table_args__ = (
        Index("ix_agent_insights_tenant_created", "tenant_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    insight_type: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CentralBackupLog(Base):
    __tablename__ = "central_backup_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    tenant_slug: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)  # success | failed
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    backup_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DeliveryMenuMapping(Base):
    __tablename__ = "delivery_menu_mappings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", "external_item_id", name="uq_delivery_menu_mappings"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)  # "bolt" or "wolt"
    external_item_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    external_item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    menu_item_id: Mapped[str] = mapped_column(String(36), ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False)


