# Multi-Branch Support — Technical Plan

> **Status:** 📋 Plan — Implementation not started
> **Date:** 2026-08-19
> **Goal:** Transform store selection into a real "nearest branch" flow
> **Related docs:** `CUSTOMER_APP_STARBUCKS_BENCHMARK_EN.md` §4

---

## §1 Overview

Currently the `stores` array returned by the backend contains a single element (the tenant itself). This plan enables **multi-branch support**: a `tenant_branches` table, admin UI, coordinate-based proximity sorting (Haversine), and geolocation-driven automatic store selection.

### Why is this needed?

| Current | Planned |
|---|---|
| 1 store (tenant itself) | N stores (tenant_branches) |
| Manual selection | Geolocation + automatic sorting |
| No branch management in admin panel | CRUD panel |
| KDS shows 'Online Order · BahaY Coffee' | 'Online Order · BahaY Narimanov' |

---

## §2 Table Plan

### 2.1 New table: `tenant_branches`

```sql
CREATE TABLE tenant_branches (
    id              VARCHAR(36) PRIMARY KEY,
    tenant_id       VARCHAR(36) NOT NULL REFERENCES tenants(id),
    name            VARCHAR(120) NOT NULL,
    address         VARCHAR(300),
    phone           VARCHAR(64),
    latitude        DOUBLE PRECISION,    -- latitude
    longitude       DOUBLE PRECISION,    -- longitude
    is_active       BOOLEAN DEFAULT TRUE,
    is_default      BOOLEAN DEFAULT FALSE,
    open_hour       INTEGER DEFAULT 8,   -- opening hour (0-23)
    close_hour      INTEGER DEFAULT 23,  -- closing hour (0-23)
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX ix_tenant_branches_tenant ON tenant_branches(tenant_id);
CREATE INDEX ix_tenant_branches_active ON tenant_branches(tenant_id, is_active);
```

### 2.2 Migration steps

1. Create `tenant_branches` table
2. Backfill existing `branding.address/phone` into first branch
3. Set `is_default = TRUE` for first branch
4. `KitchenOrder.table_label` format 'Online Order · {branch_name}' is preserved (no change needed)

### 2.3 Backfill strategy

```python
# In migration:
# 1. Read address/phone from BusinessProfile
# 2. Derive branch name from tenant name: "{tenant_name} - Main"
# 3. Create first branch (is_default=True)
# 4. Update existing KitchenOrder table_labels if in 'Online Order · ...' format
```

---

## §3 Backend API

### 3.1 Model (models.py)

```python
class TenantBranch(Base):
    __tablename__ = "tenant_branches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    open_hour: Mapped[int] = mapped_column(Integer, default=8)
    close_hour: Mapped[int] = mapped_column(Integer, default=23)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
```

### 3.2 Endpoints

| Endpoint | Method | Description | Auth |
|---|---|---|---|
| `/api/v1/branches/{tenant_id}` | GET | List branches (admin) | admin/manager |
| `/api/v1/branches/{tenant_id}` | POST | Create branch | admin |
| `/api/v1/branches/{tenant_id}/{branch_id}` | PUT | Update branch | admin |
| `/api/v1/branches/{tenant_id}/{branch_id}` | DELETE | Soft-delete branch | admin |
| `/api/v1/customer-app/branches/{tenant_id}` | GET | Public branch list (customer app) | public |
| `/api/v1/customer-app/branches/{tenant_id}/nearest` | GET | Nearest branches (lat,lng params) | public |

### 3.3 Proximity sorting (Haversine)

```python
import math

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance between two points in km."""
    R = 6371.0  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def get_nearest_branches(tenant_id: str, lat: float, lng: float, limit: int = 5):
    """Return branches sorted by distance from given coordinates."""
    branches = db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant_id,
        TenantBranch.is_active == True
    ).all()
    for b in branches:
        if b.latitude and b.longitude:
            b._distance = haversine_km(lat, lng, b.latitude, b.longitude)
        else:
            b._distance = 9999.0  # No coordinates → sort to end
    return sorted(branches, key=lambda b: b._distance)[:limit]
```

### 3.4 Session branches injection

Update `get_customer_app_session` endpoint:

```python
# Replace existing stores loop:
branches = db.query(TenantBranch).filter(
    TenantBranch.tenant_id == tenant_id,
    TenantBranch.is_active == True
).order_by(TenantBranch.sort_order, TenantBranch.name).all()

stores = [
    {
        "id": b.id,
        "name": b.name,
        "address": b.address or "",
        "phone": b.phone or "",
        "is_default": b.is_default,
        "latitude": b.latitude,
        "longitude": b.longitude,
        "open_hour": b.open_hour,
        "close_hour": b.close_hour,
    }
    for b in branches
] if branches else [
    # Fallback: tenant itself
    {"id": tenant_id, "name": bp.brand_name or tenant.name, "address": bp.address or "", "phone": bp.phone or "", "is_default": True}
]
```

---

## §4 Admin UI

### 4.1 New section in CustomerAppPanel

The existing CustomerAppPanel has 'Design', 'QR', 'AI' sections. A new **'Branches'** section is added:

```
┌─────────────────────────────────────────┐
│  Customer App Design                     │
│  ┌─────────────────────────────────────┐│
│  │ 🏪 Branches                         ││
│  │ ┌──────────────────────────────────┐││
│  │ │ + New branch                     │││
│  │ │ ┌────┬──────────┬───────┬─────┐ │││
│  │ │ │ #  │ Name     │ Addr  │ Act │ │││
│  │ │ ├────┼──────────┼───────┼─────┤ │││
│  │ │ │ 1  │ Main     │ ...   │ ✅  │ │││
│  │ │ │ 2  │ Narimanov│ ...   │ ✅  │ │││
│  │ │ │ 3  │ 28 May   │ ...   │ ❌  │ │││
│  │ │ └────┴──────────┴─────┴─────┘ │││
│  │ └──────────────────────────────────┘││
│  └─────────────────────────────────────┘│
│  ┌─────────────────────────────────────┐│
│  │ 🎨 Design presets                   ││
│  │ ...                                 ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

### 4.2 Branch edit form

New branch create/edit form:

| Field | Type | Description |
|---|---|---|
| Name | text | Branch name (required) |
| Address | text | Full address |
| Phone | tel | Contact phone |
| Latitude (lat) | number | Coordinate (map input) |
| Longitude (lng) | number | Coordinate (map input) |
| Active | checkbox | Branch active/inactive |
| Default branch | radio | 1 tenant has 1 default branch |
| Opening hour | select | 0-23 |
| Closing hour | select | 0-23 |
| Sort order | number | Display order |

### 4.3 Coordinate input method

Two options:
1. **Simple:** Manual lat/lng input with Google Maps link preview
2. **Advanced:** Leaflet/OSM widget (future phase)

**Decision:** Option 1 — simple input + Google Maps link preview. Map widget deferred to P2.

---

## §5 Frontend

### 5.1 Geolocation flow

```
User switches to Order tab
    ↓
Temporary loading: "Searching for nearby branches..."
    ↓
navigator.geolocation.getCurrentPosition()
    ↓
Success → call backend /branches/{tenant}/nearest?lat=...&lng=...
    ↓
Results → sort store picker with distance
    ↓
Failure → show only default branch
```

### 5.2 CustomerApp.tsx changes

```typescript
// New state
const [userLocation, setUserLocation] = useState<{lat: number; lng: number} | null>(null);
const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'granted' | 'denied'>('idle');

// Geolocation request (on mount)
useEffect(() => {
  if (!('geolocation' in navigator)) return;
  setLocationStatus('loading');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setLocationStatus('granted');
    },
    () => setLocationStatus('denied'),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
  );
}, []);
```

### 5.3 Store picker update

```typescript
// OrderTab.tsx — store card updated
// Existing card → add distance indicator
{stores.map((s: any) => {
  const active = String(s.id) === String(selectedStoreId);
  const distance = s._distance; // comes from backend
  return (
    <button key={s.id} onClick={() => selectStore(s.id)}>
      <span>{s.name}</span>
      {distance && <span className="text-xs text-white/50">{distance.toFixed(1)} km</span>}
      {active && <span>✓</span>}
    </button>
  );
})}
```

### 5.4 Pre-order integration

```typescript
// checkoutPreOrder — store_id is now branch_id
const checkoutPreOrder = async () => {
  // ... existing logic
  const orderId = await create_customer_pre_order_live({
    card_id: data.customer?.card_id,
    items: cart,
    notes: orderNotes,
    store_id: selectedStore?.id,        // branch_id
    store_name: selectedStore?.name,    // branch name
  });
  // KDS will show "Online Order · BahaY Narimanov"
};
```

---

## §6 Test Plan

### 6.1 Backend tests

| Test | Description |
|---|---|
| `test_branch_crud` | Create, read, update, delete |
| `test_branch_haversine` | Distance calculation accuracy |
| `test_branch_nearest` | Proximity sorting |
| `test_branch_default_one` | 1 tenant = 1 default branch |
| `test_branch_fallback` | Falls back to tenant when no branches |
| `test_branch_open_hours` | Business hours filtering |

### 6.2 Frontend tests

| Test | Description |
|---|---|
| `test_store_picker_distance` | Distance indicator display |
| `test_store_picker_fallback` | Default store without geolocation |
| `test_pre_order_store_id` | Pre-order store_id propagation |

### 6.3 Smoke test

```bash
# Backend
pytest tests/test_branch_crud.py tests/test_branch_nearest.py -v

# Frontend
npm run test:smoke  # store selection tests
npm run build       # tsc + build
```

---

## §7 File List

| File | Change |
|---|---|
| `backend/alembic/versions/YYYYMMDD_000x_add_tenant_branches.py` | New migration |
| `backend/app/models.py` | `TenantBranch` model |
| `backend/app/routers/branches.py` | New router (CRUD + nearest) |
| `backend/app/routers/operations.py` | Session branches injection |
| `backend/tests/test_branch_crud.py` | CRUD tests |
| `backend/tests/test_branch_nearest.py` | Proximity tests |
| `src/components/admin/CustomerAppPanel.tsx` | Branches section |
| `src/components/CustomerApp.tsx` | Geolocation + branch state |
| `src/components/customer/OrderTab.tsx` | Distance indicator |
| `src/api/crm.ts` | Local fallback update |
| `tests/crm_local_smoke.test.mjs` | Store tests update |

---

## §8 Roadmap

| # | Step | Effort | Status |
|---|---|---|---|
| 1 | `tenant_branches` migration + model | 1h | ⏳ |
| 2 | Backend CRUD endpoint (admin) | 2h | ⏳ |
| 3 | Backend nearest endpoint (public) | 1h | ⏳ |
| 4 | Session branches integration | 1h | ⏳ |
| 5 | Backend tests | 1h | ⏳ |
| 6 | Admin UI — branches section | 3h | ⏳ |
| 7 | Frontend geolocation | 1h | ⏳ |
| 8 | OrderTab distance indicator | 1h | ⏳ |
| 9 | Pre-order store_id update | 0.5h | ⏳ |
| 10 | Smoke tests + build verification | 1h | ⏳ |
| **Total** | | **12.5h** | |

---

## §9 Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Geolocation data privacy | Collected only with consent, never transmitted externally |
| Geolocation permission denied | Fallback: show only default branch |
| Branches without coordinates | Haversine assigns 9999km — sorts to end |
| Multiple default branches | Backend validation: 1 tenant = 1 is_default=TRUE |
| Legacy devices | `stores` array is optional — old payloads not broken |

---

## §10 Next Steps (P2)

1. **Map widget** — Show branches on Leaflet/OSM map
2. **Business hours auto-filtering** — Hide closed branches
3. **Branch analytics** — Sales/order count per branch
4. **Branch selection history** — Remember last selection
