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


class PinLoginIn(BaseModel):
    pin: str
    tenant_id: str | None = None


class RefreshIn(BaseModel):
    refresh_token: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class MenuItemOut(BaseModel):
    id: str
    item_name: str
    category: str
    price: Decimal
    is_coffee: bool


class MenuItemCreateIn(BaseModel):
    item_name: str
    price: Decimal
    category: str
    is_coffee: bool = False


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


class SaleItemIn(BaseModel):
    item_name: str
    price: Decimal
    qty: int = Field(ge=1)
    category: str | None = None
    is_coffee: bool = False


class SaleCreateIn(BaseModel):
    cart_items: list[SaleItemIn]
    payment_method: str
    discount_percent: Decimal = Decimal("0")
    order_type: str | None = "Take Away"
    customer_card_id: str | None = None
    split_cash: Decimal | None = None
    split_card: Decimal | None = None


class SaleCreateOut(BaseModel):
    sale_id: str
    receipt_code: str | None = None
    receipt_token: str | None = None
    total: Decimal
    created_at: datetime


class OpenShiftIn(BaseModel):
    opening_cash: Decimal = Decimal("0")


class XReportIn(BaseModel):
    actual_cash: Decimal


class ZReportIn(BaseModel):
    actual_cash: Decimal
    wage_amount: Decimal = Decimal("0")


class FinanceEntryIn(BaseModel):
    type: str
    category: str
    source: str
    amount: Decimal
    description: str | None = None


class TransferIn(BaseModel):
    direction: str
    amount: Decimal
    description: str | None = None


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
