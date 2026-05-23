# IronWaves POS Platform — Kiro Kontekst Faylı

## Layihə Haqqında
- **Nədir:** Multi-tenant restoran/kafe POS sistemi (Azərbaycan bazarı)
- **Stack:** React 19 + Vite (frontend), FastAPI + PostgreSQL (backend)
- **Deploy:** Railway (auto-deploy from `main` branch)
- **Repo:** git@github.com:Enjoyer09/ironwaves-pos-platform.git
- **Production tenantlar:**
  - `super.ironwaves.store` — admin/test tenant
  - `emalatxana.ironwaves.store` / `emalatkhana.ironwaves.store` — real müştəri
  - `demo.ironwaves.store` — demo

## ⚠️ KRİTİK QAYDALAR
1. **`main` branch-ə birbaşa push ETMƏ** — Railway dərhal deploy edir
2. **Həmişə feature branch yarat** → PR aç → CI keçsin → merge et
3. **Test üçün `super.ironwaves.store` istifadə et** — digər tenantlara toxunma
4. **Rollback:** Railway dashboard → Deployments → əvvəlki deploy-a "Rollback"

## Artıq Edilmiş Dəyişikliklər (PR #7 — merged)

### 1. TablesPage.tsx — Detail Panel UX
- Panel tam ekranı örtmür, slide-over kimi sağda açılır
- `w-[92vw] max-w-[560px] md:w-[50vw] lg:w-[42vw] xl:w-[38vw]`
- "Geri" düyməsi böyüdüldü (min-h-11, min-w-11)

### 2. Split Payment Quick Presets
- "👥 Bərabər böl" düyməsi — qonaq sayına görə avtomatik bölür
- "💵+💳 Yarı-yarı" düyməsi — yarısı nəğd, yarısı kart

### 3. Error Mesajları Lokalizasiyası
- `src/lib/error_localize.ts` yaradıldı
- 20+ backend xəta mesajı AZ dilinə çevrildi
- TablesPage-dəki bütün `notify('error')` çağırışları `localizeError()` istifadə edir

### 4. Masa Açılış Modalı
- Depozit konfiqurasiya edilməyibsə, depozit bölməsi gizlənir

### 5. MenuGrid
- Qiymət fontu `text-base` → `text-lg` (qaranlıq mühitdə oxunaqlılıq)

### 6. StickyActionBar
- Draft item sayı badge göstərilir
- "Göndər" → "Mətbəxə göndər" (daha aydın)

### 7. Sifariş Tab Badge
- "Sifariş · 3" formatında draft sayı göstərilir

### 8. store.ts — restoreSession fix
- `isBackendEnabled()` import əlavə olundu
- Lokal rejimdə (backend yoxdursa) session restore skip edilir
- **⚠️ PROBLEM:** Bu dəyişiklik `super.ironwaves.store`-da login-dən sonra donmaya səbəb ola bilər. YOXLANMALIDIR.

## 🔴 Bilinən Problemlər

### Production Donma (super.ironwaves.store) — PR #8 ilə fix edildi
- **Simptom:** Login-dən sonra app donub qalır (yalnız super.ironwaves.store-da)
- **Kök səbəb:** `App.tsx`-dəki `syncSession` useEffect sonsuz re-render loop yaradırdı. `applySessionUser()` `user.tenant_id`-ni dəyişirdi → bu effect-in dependency-si olduğu üçün effect yenidən trigger olurdu → sonsuz loop.
- **Həll:** `syncSessionRanRef` əlavə edildi — effect yalnız bir dəfə (hər valid session üçün) işləyir. PR #8 merge edildikdən sonra Railway avtomatik deploy edəcək.
- **Status:** PR #8 açıldı, merge gözlənilir

## Edilməli İşlər (TODO)

### Təcili (production fix)
- [x] `syncSession` sonsuz loop fix — PR #8
- [ ] PR #8 merge et → Railway deploy gözlə
- [ ] `super.ironwaves.store`-da test et

### Sonra (UX improvements — təhlükəsiz)
- [ ] TablesPage.tsx refaktor — 3400+ sətir, sub-komponentlərə bölünməli
- [ ] Backend `restaurant.py` refaktor — 3100+ sətir
- [ ] `window.prompt` əvəzinə custom modal (handleCancelTableCheck)
- [ ] Item action modal — tez-tez istifadə olunan reason-lar üçün one-tap preset
- [ ] Reservation timeline — kiçik ekranda list view
- [ ] WebSocket əvəzinə real SSE/WS (KDS üçün 8s polling əvəzinə)
- [ ] Race condition fix — `_ensure_active_session_and_check`-ə `with_for_update()`

## Deployment Workflow

```bash
# 1. Feature branch yarat
git checkout -b fix/my-change

# 2. Dəyişiklik et, commit et
git add <files>
git commit -m "fix(scope): description"

# 3. Push et
git push -u origin fix/my-change

# 4. PR aç
gh pr create --base main --head fix/my-change --title "fix: description"

# 5. CI keçməsini gözlə, sonra merge et
gh pr merge <PR_NUMBER> --merge --delete-branch

# 6. Railway avtomatik deploy edəcək (1-3 dəq)
# 7. super.ironwaves.store-da test et
# 8. Problem varsa: Railway dashboard → Rollback
```

## Test Checklist (super.ironwaves.store)
- [ ] Login işləyir (admin credentials ilə)
- [ ] POS bölməsi açılır, məhsul seçilir, satış tamamlanır
- [ ] Masalar bölməsi açılır
- [ ] Masa açılır (qonaq sayı seçilir)
- [ ] Sifariş yazılır (menüdən məhsul seçilir)
- [ ] "Mətbəxə göndər" işləyir
- [ ] KDS-də sifariş görünür
- [ ] Hesab bağlanır (nəğd/kart/split)
- [ ] Detail panel floor grid-i örtmür (slide-over)
- [ ] Error mesajları AZ dilindədir
- [ ] Digər tenantlar (`emalatxana.ironwaves.store`) təsirlənməyib

## Fayl Strukturu (əsas)
```
src/
├── App.tsx                    — Ana routing/layout
├── main.tsx                   — Entry point
├── store.ts                   — Zustand store (persist + auth)
├── i18n.ts                    — Dil faylları
├── api/
│   ├── client.ts              — API request utility
│   ├── restaurant.ts          — Masa/sifariş API
│   ├── tables.ts              — Legacy masa API
│   ├── kds.ts                 — Kitchen display API
│   └── auth.ts                — Login/session API
├── components/
│   ├── TablesPage.tsx          — Masalar əsas səhifə (3400+ sətir!)
│   ├── PinLogin.tsx            — PIN giriş ekranı
│   ├── KDS.tsx                 — Mətbəx ekranı
│   ├── POS.tsx                 — Satış ekranı
│   └── tables/
│       ├── TableGrid.tsx       — Masa grid komponenti
│       ├── MenuGrid.tsx        — Menü grid komponenti
│       └── StickyActionBar.tsx — Alt action bar
├── lib/
│   ├── error_localize.ts      — Error mesaj lokalizasiyası (yeni)
│   ├── seeder.ts              — Lokal demo data
│   ├── db_sim.ts              — localStorage DB simulyasiyası
│   └── tenant.ts              — Multi-tenant routing
backend/
├── app/routers/restaurant.py  — Restoran API (3100+ sətir!)
├── app/models.py              — DB modelləri
└── app/schemas.py             — Pydantic schemas
```
