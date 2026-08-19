# Çoxfilial (Multi-Branch) Dəstək — Texniki Plan

> **Status:** 📋 Plan — Implementasiya başlamayıb
> **Tarix:** 2026-08-19
> **Məqsəd:** Mağaza seçimini həqiqi 'yaxınlıqdakı filial' axınına çevir
> **Əlaqəli sənədlər:** `CUSTOMER_APP_STARBUCKS_BENCHMARK.md` §4

---

## §1 Xülasə

Hazırda `stores` array-i backend tərəfində tək element (tenant-ın özü) olaraq qaytarılır. Bu plan **çoxfilial dəstəyini** təmin edir: `tenant_branches` cədvəli, admin UI, koordinat əsaslı yaxınlıq sıralaması (Haversine) və geolokasiya ilə avtomatik mağaza seçimi.

### Niyə lazımdır?

| Mövcud | Planlanan |
|---|---|
| 1 mağaza (tenant-ın özü) | N mağaza (tenant_branches) |
| Manual seçim | Geolokasiya + avtomatik sıralama |
| Admin panel-də branch idarəetməsi yoxdur | CRUD pəncərəsi |
| KDS-də 'Online Order · BahaY Coffee' | 'Online Order · BahaY Nərimanov' |

---

## §2 Cədvəl Planı

### 2.1 Yeni cədvəl: `tenant_branches`

```sql
CREATE TABLE tenant_branches (
    id              VARCHAR(36) PRIMARY KEY,
    tenant_id       VARCHAR(36) NOT NULL REFERENCES tenants(id),
    name            VARCHAR(120) NOT NULL,
    address         VARCHAR(300),
    phone           VARCHAR(64),
    latitude        DOUBLE PRECISION,    -- enlem
    longitude       DOUBLE PRECISION,    -- boylam
    is_active       BOOLEAN DEFAULT TRUE,
    is_default      BOOLEAN DEFAULT FALSE,
    open_hour       INTEGER DEFAULT 8,   -- açılış saati (0-23)
    close_hour      INTEGER DEFAULT 23,  -- bağlanış saati (0-23)
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX ix_tenant_branches_tenant ON tenant_branches(tenant_id);
CREATE INDEX ix_tenant_branches_active ON tenant_branches(tenant_id, is_active);
```

### 2.2 Migration addımları

1. `tenant_branches` cədvəlini yarat
2. Mövcud `branding.address/phone`-u ilk branch-ə köçür (backfill)
3. `is_default = TRUE` ver ilk branch-ə
4. `KitchenOrder.table_label`-da 'Online Order · {branch_name}' formatı qorunur (dəyişiklik lazım deyil)

### 2.3 Backfill strategiyası

```python
# Migration-də:
# 1. BusinessProfile-dən address/phone oxu
# 2. Tenant adından branch adı yarat: "{tenant_name} - Mərkəz"
# 3. İlk branch-i yarat (is_default=True)
# 4. Mövcud KitchenOrder-ların table_label-ini yenilə (əgər 'Online Order · ...' formatındadırsa)
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

### 3.2 Endpoint-lər

| Endpoint | Metod | Təsvir | İcazə |
|---|---|---|---|
| `/api/v1/branches/{tenant_id}` | GET | Filialların siyahısı (admin) | admin/manager |
| `/api/v1/branches/{tenant_id}` | POST | Yeni filial yarat | admin |
| `/api/v1/branches/{tenant_id}/{branch_id}` | PUT | Filial yenilə | admin |
| `/api/v1/branches/{tenant_id}/{branch_id}` | DELETE | Filial sil (soft delete) | admin |
| `/api/v1/customer-app/branches/{tenant_id}` | GET |公开 filial siyahısı (customer app üçün) | public |
| `/api/v1/customer-app/branches/{tenant_id}/nearest` | GET | Yaxınlıqdakı filiallar (lat,lng params) | public |

### 3.3 Yaxınlıq sıralaması (Haversine)

```python
import math

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """İki nöqtə arasındakı məsafə (km)."""
    R = 6371.0  # Yer radiusu km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def get_nearest_branches(tenant_id: str, lat: float, lng: float, limit: int = 5):
    """Yaxınlıqdakı filialları sıralayır."""
    branches = db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant_id,
        TenantBranch.is_active == True
    ).all()
    for b in branches:
        if b.latitude and b.longitude:
            b._distance = haversine_km(lat, lng, b.latitude, b.longitude)
        else:
            b._distance = 9999.0  # Koordinatı olmayanlar axırda
    return sorted(branches, key=lambda b: b._distance)[:limit]
```

### 3.4 Session-a branches əlavə etmə

`get_customer_app_session` endpoint-ini yenilə:

```python
# Mövcud stores loop-unun əvəzinə:
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
    # Fallback: tenant-ın özü
    {"id": tenant_id, "name": bp.brand_name or tenant.name, "address": bp.address or "", "phone": bp.phone or "", "is_default": True}
]
```

---

## §4 Admin UI

### 4.1 CustomerAppPanel-ə yeni bölmə əlavə et

Mövcud CustomerAppPanel-də 'Dizayn', 'QR', 'AI' bölmələri var. Yeni **'Filiallar'** bölməsi əlavə edilir:

```
┌─────────────────────────────────────────┐
│  Customer App Dizaynı                    │
│  ┌─────────────────────────────────────┐│
│  │ 🏪 Filiallar                        ││
│  │ ┌──────────────────────────────────┐││
│  │ │ + Yeni filial                    │││
│  │ │ ┌────┬──────────┬───────┬─────┐ │││
│  │ │ │ #  │ Ad       │ Ünvan │ Aktiv│ │││
│  │ │ ├────┼──────────┼───────┼─────┤ │││
│  │ │ │ 1  │ Mərkəz   │ ...   │ ✅  │ │││
│  │ │ │ 2  │ Nərimanov│ ...   │ ✅  │ │││
│  │ │ │ 3  │ 28 May   │ ...   │ ❌  │ │││
│  │ │ └────┴──────────┴─────┴─────┘ │││
│  │ └──────────────────────────────────┘││
│  └─────────────────────────────────────┘│
│  ┌─────────────────────────────────────┐│
│  │ 🎨 Dizayn preset-ləri              ││
│  │ ...                                 ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

### 4.2 Filial redaktə formu

Yeni filial yaratma/redaktə formu:

| Sahə | Tip | Təsvir |
|---|---|---|
| Ad | text | Filial adı (məcburi) |
| Ünvan | text | Tam ünvan |
| Telefon | tel | Əlaqə telefonu |
| Enlem (lat) | number | Koordinat (map input) |
| Boylam (lng) | number | Koordinat (map input) |
| Aktiv | checkbox | Filial aktiv/pasiv |
| İlkin filial | radio | 1 tenant-ın 1 default filialı olmalıdır |
| Açılış saati | select | 0-23 |
| Bağlanış saati | select | 0-23 |
| Sıra nömrəsi | number | Göstərilmə sırası |

### 4.3 Koordinat daxil etmə üsulu

İki variant:
1. **Sadə:** Manual lat/lng daxil et (map marker ilə)
2. **Advanced:** Leaflet/OSM widget (gələcək fazada)

**Qərar:** 1-ci variant — sadə input + Google Maps link preview. Kart widget-i P2 fazasına.

---

## §5 Frontend

### 5.1 Geolokasiya axını

```
İstifadəçi Order tab-a keçir
    ↓
Müvəqqəti loading: "Yaxınlıqdakı filiallar axtarılır..."
    ↓
navigator.geolocation.getCurrentPosition()
    ↓
Uğurlu → backend /branches/{tenant}/nearest?lat=...&lng=... çağır
    ↓
Nəticə → store picker-a məsafə ilə birlikdə sırala
    ↓
Uğursuz → yalnız default filialı göstər
```

### 5.2 CustomerApp.tsx dəyişiklikləri

```typescript
// Yeni state
const [userLocation, setUserLocation] = useState<{lat: number; lng: number} | null>(null);
const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'granted' | 'denied'>('idle');

// Geolokasiya istəyi (ilk yüklənmədə)
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

### 5.3 Store picker yeniləməsi

```typescript
// OrderTab.tsx — mağaza kartı yenilənir
// Mövcud kart → yaxınlıq məsafəsi əlavə edilir
{stores.map((s: any) => {
  const active = String(s.id) === String(selectedStoreId);
  const distance = s._distance; // backend-dən gəlir
  return (
    <button key={s.id} onClick={() => selectStore(s.id)}>
      <span>{s.name}</span>
      {distance && <span className="text-xs text-white/50">{distance.toFixed(1)} km</span>}
      {active && <span>✓</span>}
    </button>
  );
})}
```

### 5.4 Pre-order inteqrasiyası

```typescript
// checkoutPreOrder — store_id artıq branch_id-dir
const checkoutPreOrder = async () => {
  // ... mövcud məntiq
  const orderId = await create_customer_pre_order_live({
    card_id: data.customer?.card_id,
    items: cart,
    notes: orderNotes,
    store_id: selectedStore?.id,        // branch_id
    store_name: selectedStore?.name,    // branch adı
  });
  // KDS-də "Online Order · BahaY Nərimanov" kimi görünəcək
};
```

---

## §6 Test Planı

### 6.1 Backend testləri

| Test | Təsvir |
|---|---|
| `test_branch_crud` | Yarat, oxu, yenilə, sil |
| `test_branch_haversine` | Məsafə hesablanması |
| `test_branch_nearest` | Yaxınlıq sıralaması |
| `test_branch_default_one` | 1 tenant-da 1 default |
| `test_branch_fallback` | Branch yoxdursa tenant-ın özü qayıdır |
| `test_branch_open_hours` | İş vaxtı过滤 |

### 6.2 Frontend testləri

| Test | Təsvir |
|---|---|
| `test_store_picker_distance` | Məsafə göstəricisi |
| `test_store_picker_fallback` | Geolokasiya olmadan default |
| `test_pre_order_store_id` | Pre-order store_id daşıması |

### 6.3 Smoke test

```bash
# Backend
pytest tests/test_branch_crud.py tests/test_branch_nearest.py -v

# Frontend
npm run test:smoke  # store selection testləri
npm run build       # tsc + build
```

---

## §7 Fayl Siyahısı

| Fayl | Dəyişiklik |
|---|---|
| `backend/alembic/versions/YYYYMMDD_000x_add_tenant_branches.py` | Yeni migration |
| `backend/app/models.py` | `TenantBranch` modeli |
| `backend/app/routers/branches.py` | Yeni router (CRUD + nearest) |
| `backend/app/routers/operations.py` | Session-a branches əlavə et |
| `backend/tests/test_branch_crud.py` | CRUD testləri |
| `backend/tests/test_branch_nearest.py` | Yaxınlıq testləri |
| `src/components/admin/CustomerAppPanel.tsx` | Filiallar bölməsi |
| `src/components/CustomerApp.tsx` | Geolokasiya + branch state |
| `src/components/customer/OrderTab.tsx` | Distance göstəricisi |
| `src/api/crm.ts` | Lokal fallback yeniləməsi |
| `tests/crm_local_smoke.test.mjs` | Store testləri yeniləmə |

---

## §8 Addımlıq Yol Xəritəsi

| # | Addım | Effort | Status |
|---|---|---|---|
| 1 | `tenant_branches` migration + model | 1h | ⏳ |
| 2 | Backend CRUD endpoint (admin) | 2h | ⏳ |
| 3 | Backend nearest endpoint (public) | 1h | ⏳ |
| 4 | Session-a branches inteqrasiyası | 1h | ⏳ |
| 5 | Backend testlər | 1h | ⏳ |
| 6 | Admin UI — filiallar bölməsi | 3h | ⏳ |
| 7 | Frontend geolokasiya | 1h | ⏳ |
| 8 | OrderTab distance göstəricisi | 1h | ⏳ |
| 9 | Pre-order store_id yeniləmə | 0.5h | ⏳ |
| 10 | Smoke testlər + build yoxlaması | 1h | ⏳ |
| **Cəmi** | | **12.5h** | |

---

## §9 Risklər və Həllər

| Risk | Həll |
|---|---|
| Coğrafi məlumat qanunvericiliyi | Yalnız bothericilik razılığı ilə toplanır, heç bir yerə ötürülmür |
| Geolokasiya icazəsi verilmir | Fallback: yalnız default filial göstərilir |
| Koordinatı olmayan filiallar | Haversine-də 9999km — axırda sıralanır |
| Çoxlu default filial | Backend validasiya: 1 tenant-da 1 is_default=TRUE |
| Köhnə cihazlar | `stores` array-i optional — köhnə payload-lar pozulmur |

---

## §10 Sonrakı Addımlar (P2)

1. **Kart widget-i** — Leaflet/OSM ilə xəritədə filial göstərmə
2. **İş vaxtı avtomatik filtrləmə** — bağlanmış filialları gizlət
3. **Filial statistikası** — hər filial üzrə satış/sifariş sayı
4. **Filial seçim tarixçəsi** — son seçim yadda saxla
