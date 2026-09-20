# Phase 2: Light Theme — İcra Planı

## Cari Vəziyyət

- `tailwind.config.ts` artıq semantic token-ları dəstəkləyir: `bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground` və s.
- `src/index.css` artıq həm `:root` (dark) həm `:root[data-theme='light']` variable-ları təyin edir
- `changeThemeMode()` funksiyası `document.documentElement.setAttribute('data-theme', mode)` çağırır və backend-ə persist edir

**Nəticə:** Task 12.1 və 12.2 əslində artıq mövcuddur (theme infrastructure hazırdır). Yalnız light variable-ları genişləndirmək və hardcoded class-ları dəyişmək qalıb.

---

## Task 12.1 — Theme CSS Variables (Tamamlamaq lazımdır)

**Fayl:** `src/index.css`

**Nə etmək lazımdır:**
`:root[data-theme='light']` blokuna çatışmayan variable-ları əlavə et:
```css
:root[data-theme='light'] {
  /* Artıq var: background, foreground, card, card-foreground, popover, popover-foreground,
     secondary, secondary-foreground, muted, muted-foreground, border, input,
     hero-heading, hero-sub, metal-* */
  
  /* ƏLAVƏ EDİLMƏLİ: */
  --primary: 47.9 95.8% 38%;          /* amber-600 — light bg-da contrast üçün */
  --primary-foreground: 0 0% 100%;
  --accent: 38 92% 38%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 84.2% 50%;
  --destructive-foreground: 0 0% 100%;
  --ring: 47.9 95.8% 38%;
  --gold-a: #b45309;                   /* amber-700 */
  --gold-b: #92400e;                   /* amber-800 */
}
```

**Yoxlama:** `npx vite build` keçməlidir.

---

## Task 12.2 — Tailwind Config (Artıq tamamdır ✅)

`tailwind.config.ts` artıq bütün semantic token-ları `hsl(var(--*))` ilə istifadə edir. Heç bir dəyişiklik lazım deyil.

---

## Task 13.1 — POS Module Light Theme Adaptation

**Fayl:** `src/components/POS.tsx` (~3200 sətir)

**Strategiya:** Hardcoded dark Tailwind class-ları semantic token-larla əvəz et.

**Əvəzləmə xəritəsi:**
| Hardcoded class | Əvəzi |
|---|---|
| `bg-slate-900` | `bg-card` |
| `bg-slate-900/40` | `bg-card/40` |
| `bg-slate-900/60` | `bg-card/60` |
| `bg-slate-950` | `bg-background` |
| `bg-slate-950/30` | `bg-background/30` |
| `bg-slate-950/50` | `bg-background/50` |
| `text-slate-100` | `text-foreground` |
| `text-slate-200` | `text-foreground/90` |
| `text-slate-300` | `text-muted-foreground` |
| `text-slate-400` | `text-muted-foreground` |
| `text-slate-500` | `text-muted-foreground/70` |
| `border-slate-700` | `border-border` |
| `border-slate-700/60` | `border-border/60` |
| `border-slate-700/70` | `border-border/70` |
| `border-slate-600` | `border-border` |
| `border-slate-800` | `border-border` |

**Qeyd:** `bg-emerald-*`, `bg-amber-*`, `bg-cyan-*`, `bg-red-*` kimi accent rəngləri DƏYIŞMƏ — bunlar hər iki temada eyni qalmalıdır.

**Yoxlama:**
1. `npx tsc --noEmit`
2. `npx vite build`
3. Brauzerdə dark mode-da heç bir visual regression olmadığını yoxla

---

## Task 14.1 — Tables Module

**Fayl:** `src/components/TablesPage.tsx`

Eyni əvəzləmə xəritəsi. Əlavə diqqət:
- Table status indikatorları (free=emerald, occupied=amber, reserved=purple) — bunlar DƏYIŞMƏ
- Yalnız `slate-*` class-ları dəyiş

---

## Task 14.2 — KDS Module

**Fayl:** `src/components/KDS.tsx`

Eyni əvəzləmə xəritəsi. Əlavə diqqət:
- Order status rəngləri (pending=amber, in-progress=cyan, ready=emerald, overdue=red) — DƏYIŞMƏ
- Yalnız `slate-*` class-ları dəyiş

---

## Task 15.1 — Finance + Admin

**Fayllar:**
- `src/components/admin/AdminPanel.tsx`
- Finance panel-ləri (`src/components/admin/` altındakı finance-related fayllar)

Eyni əvəzləmə xəritəsi tətbiq et.

---

## Task 16.1 — Theme Persistence + FOUC Prevention

**Fayl:** `src/App.tsx` (və ya app entry point)

**Nə etmək lazımdır:**

1. `App` komponentinin ən əvvəlində (və ya `index.html`-dəki `<script>`) theme-i sync olaraq tətbiq et:

```typescript
// App.tsx — komponent render-dən əvvəl
const storedTheme = localStorage.getItem('iw_theme_mode') || 'dark';
if (['dark', 'light'].includes(storedTheme)) {
  document.documentElement.setAttribute('data-theme', storedTheme);
} else {
  document.documentElement.setAttribute('data-theme', 'dark');
}
```

2. Yoxla ki, mövcud `changeThemeMode()` funksiyası `update_session_settings_live` çağırır (artıq edir).

3. Yoxla ki, invalid/missing dəyər üçün fallback `'dark'`-dır.

---

## Task 17 — Final Checkpoint

1. `npx tsc --noEmit` — keçməlidir
2. `npx vite build` — keçməlidir
3. Brauzerdə hər iki temada əsas modulları yoxla:
   - Settings → Interface → Theme toggle
   - POS ekranı (dark + light)
   - Tables səhifəsi (dark + light)
   - KDS (dark + light)
   - Admin panel (dark + light)

---

## İcra Sırası (Dependency Graph)

```
12.1 (CSS variables tamamla)
  ↓
13.1, 14.1, 14.2, 15.1, 16.1  (paralel icra oluna bilər)
  ↓
17 (final checkpoint)
```

## Əmrlər

Hər task-dan sonra build yoxla:
```bash
npx tsc --noEmit && npx vite build
```

## Vacib Qeydlər

1. **Accent rəngləri dəyişmə** — `emerald`, `amber`, `cyan`, `red`, `purple` class-ları (button state, status indicator) hər iki temada eyni qalmalıdır
2. **`metal-panel`, `neon-input`, `neon-btn` class-ları** — bunlar CSS-də artıq `var(--metal-*)` istifadə edir, avtomatik dəyişəcək
3. **Yalnız `slate-*` class-ları** hədəflə — digər rəng class-larına toxunma
4. **Regex üçün:** `bg-slate-9[0-9]{2}`, `text-slate-[1-5]00`, `border-slate-[6-8]00` pattern-ləri istifadə et
5. **Hər modul üçün əvvəlcə grep et**, dəyişdiriləcək yerlərin sayını gör, sonra batch replace et
