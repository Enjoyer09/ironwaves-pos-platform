from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field


class HealthOut(BaseModel):
    status: str
    app: str


class LoginIn(BaseModel):
    username: str
    password: str
    tenant_id: str | None = None
    second_factor_code: str | None = None
    remember_device: bool | None = False


class PinLoginIn(BaseModel):
    pin: str
    tenant_id: str | None = None


class RefreshIn(BaseModel):
    refresh_token: str


class VerifyPasswordIn(BaseModel):
    password: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict
    trusted_device_token: str | None = None


class BootstrapOwnerIn(BaseModel):
    username: str
    password: str


class TotpSetupOut(BaseModel):
    secret: str
    otpauth_url: str


class TotpVerifyIn(BaseModel):
    code: str


class TotpDisableIn(BaseModel):
    current_password: str
    code: str | None = None


class SystemResetIn(BaseModel):
    current_password: str
    code: str | None = None


class MenuItemOut(BaseModel):
    id: str
    item_name: str
    category: str
    price: Decimal
    is_coffee: bool
    image_url: str | None = None
    description: str | None = None


class MenuItemCreateIn(BaseModel):
    item_name: str
    price: Decimal
    category: str
    is_coffee: bool = False
    image_url: str | None = None
    description: str | None = None


class InventoryItemCreateIn(BaseModel):
    name: str
    stock_qty: Decimal
    unit: str
    category: str | None = None
    type: str | None = None
    unit_cost: Decimal
    min_limit: Decimal = Decimal("0")


class InventoryRestockIn(BaseModel):
    qty_added: Decimal
    total_price: Decimal


class InventoryLossIn(BaseModel):
    qty_removed: Decimal
    reason: str


class RecipeIngredientCreateIn(BaseModel):
    menu_item_name: str
    ingredient_name: str
    quantity_required: Decimal
    quantity_unit: str | None = None


class SaleItemIn(BaseModel):
    item_name: str
    price: Decimal
    qty: int = Field(ge=1)
    category: str | None = None
    is_coffee: bool = False
    cup_mode: str | None = None


class SaleCreateIn(BaseModel):
    cart_items: list[SaleItemIn]
    payment_method: str
    discount_percent: Decimal = Decimal("0")
    order_type: str | None = "Take Away"
    customer_card_id: str | None = None
    reward_claim_code: str | None = None
    split_cash: Decimal | None = None
    split_card: Decimal | None = None
    offline_request_id: str | None = None


class SaleCreateOut(BaseModel):
    sale_id: str
    receipt_code: str | None = None
    receipt_token: str | None = None
    total: Decimal
    created_at: datetime


class OpenShiftIn(BaseModel):
    opening_cash: Decimal = Decimal("0")
    funding_source: str | None = None
    target_cash: Decimal | None = None
    topup_amount: Decimal | None = None


class XReportIn(BaseModel):
    actual_cash: Decimal


class ZReportIn(BaseModel):
    actual_cash: Decimal
    wage_amount: Decimal = Decimal("0")


class ShiftHandoverIn(BaseModel):
    received_by: str
    declared_cash: Decimal


class ShiftHandoverAcceptIn(BaseModel):
    actual_cash: Decimal


class FinanceEntryIn(BaseModel):
    type: str
    category: str
    category_code: str | None = None
    source: str
    amount: Decimal
    description: str | None = None


class TransferIn(BaseModel):
    direction: str
    amount: Decimal
    description: str | None = None


class InvestorRepayIn(BaseModel):
    amount: Decimal
    pay_from: str
    description: str | None = None


class FinanceTransactionIn(BaseModel):
    transaction_type: str
    source_account_code: str | None = None
    destination_account_code: str | None = None
    amount: Decimal
    category: str | None = None
    category_code: str | None = None
    counterparty: str | None = None
    reference: str | None = None
    note: str | None = None
    requires_approval: bool | None = None


class FinanceReconciliationIn(BaseModel):
    account_code: str
    expected_balance: Decimal
    counted_balance: Decimal
    notes: str | None = None


class TenantCreateIn(BaseModel):
    name: str
    slug: str
    domain: str
    admin_username: str
    admin_password: str


class TenantCloneIn(BaseModel):
    name: str
    slug: str
    domain: str
    admin_username: str
    admin_password: str


class TenantOut(BaseModel):
    id: str
    name: str
    slug: str
    domain: str
    status: str


class FloorPlanCreateIn(BaseModel):
    name: str
    width_units: int = 12
    height_units: int = 8
    is_active: bool = True


class FloorPlanUpdateIn(BaseModel):
    name: str | None = None
    width_units: int | None = None
    height_units: int | None = None
    is_active: bool | None = None


class GuestCreateIn(BaseModel):
    full_name: str
    phone: str | None = None
    email: str | None = None
    notes: str | None = None


class ReservationCreateIn(BaseModel):
    guest_name: str
    phone: str | None = None
    email: str | None = None
    reservation_at: datetime
    duration_minutes: int = 90
    party_size: int = 2
    special_note: str | None = None
    assigned_table_id: str | None = None
    status: str | None = None


class ReservationUpdateIn(BaseModel):
    guest_name: str | None = None
    phone: str | None = None
    email: str | None = None
    reservation_at: datetime | None = None
    duration_minutes: int | None = None
    party_size: int | None = None
    special_note: str | None = None
    assigned_table_id: str | None = None
    status: str | None = None


class ReservationSeatIn(BaseModel):
    table_id: str
    guest_count: int | None = None
    assigned_waiter: str | None = None


class TableLayoutUpdateIn(BaseModel):
    floor_plan_id: str | None = None
    pos_x: int | None = None
    pos_y: int | None = None
    width_units: int | None = None
    height_units: int | None = None
    capacity: int | None = None
    shape: str | None = None
    status: str | None = None


class TableCombineIn(BaseModel):
    target_table_id: str


class TableSplitIn(BaseModel):
    merged_group_id: str | None = None


class TableLockTransferIn(BaseModel):
    new_owner: str
    reason: str | None = None


class TableUnlockIn(BaseModel):
    reason: str | None = None


class RestaurantRoundItemIn(BaseModel):
    id: str | None = None
    item_name: str
    price: Decimal
    qty: int = Field(ge=1)
    category: str | None = None
    is_coffee: bool = False
    seat_no: int | None = None
    course_no: int | None = 1
    note: str | None = None
    modifier_json: str | None = None


class SendRoundIn(BaseModel):
    items: list[RestaurantRoundItemIn]
    sent_by: str | None = None
    course_no: int | None = 1


class SendDraftItemsIn(BaseModel):
    sent_by: str | None = None
    course_no: int | None = 1


class DraftItemUpdateIn(BaseModel):
    qty: int | None = Field(default=None, ge=1)
    note: str | None = None
    modifier_json: str | None = None


class OrderItemActionIn(BaseModel):
    action: str
    reason: str | None = None
    reason_code: str | None = None
    quantity_delta: int | None = Field(default=None, ge=1)
    note: str | None = None
    modifier_json: str | None = None
    manager_password: str | None = None
    remake_note: str | None = None


class RestaurantPaymentPartIn(BaseModel):
    method: str
    amount: Decimal


class SettleCheckIn(BaseModel):
    payment_method: str
    split_cash: Decimal | None = None
    split_card: Decimal | None = None
    parts: list[RestaurantPaymentPartIn] | None = None
