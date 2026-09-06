# Settings Section — UI/UX Audit

**Scope:** the admin "Ayarlar" (Settings) module — `src/components/admin/SettingsPanel.tsx` and `src/components/admin/settings/*`.
**Date:** 2026-09-06 · **Method:** code-only audit (working tree, uncommitted changes included). No code was modified.

## 0. Shape of the module

| File | Lines | Contents |
|---|---|---|
| `SettingsPanel.tsx` | 1,704 | ~30 `useState` blocks, all save handlers, all load logic, category nav, renders 8 sections |
| `settings/IntegrationsSettingsSection.tsx` | 1,036 | Delivery, QR Menu, Feedback Portal (3 panels) + QR poster canvas generator |
| `settings/SecuritySettingsSection.tsx` | 911 | Session security, staff benefits, roles, users, password/2FA, danger zone (6 panels) |
| `settings/OperationSettingsSection.tsx` | 847 | Print, Z-report receipt, Tables, Beverage (4 panels) + print-agent install modal |
| `settings/FinanceSettingsSection.tsx` | 533 | Bank fee, Finance policy, Yield (3 panels) |
| `settings/InterfaceSettingsSection.tsx` | 281 | Interface + duplicated session-security block |
| `settings/BusinessProfileSection.tsx` | 204 | Profile + tax/fiscal |
| `settings/EmailSettingsSection.tsx` | 111 | Email/Resend |
| `settings/AISettingsSection.tsx` | 61 | One API-key field |
| `settings/InterfaceSettingsSection.tsx.bak` | 281 | **Dead backup file shipped in `src/`** |

20 panels total (`sec-profile … sec-ai`), ~5,700 lines. The parent is a "prop hose": `SecuritySettingsSection` alone takes **~60 props**; every new field must be threaded through state → handler → props interface → destructure.

---

## 1. P0 — functional bugs / data risk

### 1.1 AI API key is PATCHed on every keystroke
`SettingsPanel.tsx` passes an inline setter that fires a backend request **and** a localStorage write per character:

```tsx
setAiApiKey={(value: string) => { setAiApiKey(value); writeScopedStorage('gemini_api_key', value); void update_api_key_live(value, {}); }}
```

Typing a 40-char key = ~40 PATCH requests + 40 localStorage writes, racing each other (last-char-wins is not guaranteed). The separate "Saxla" button is redundant and misleading. There is no debounce and no `disabled` state.

### 1.2 Half of the save handlers have no error handling at all
**With `try/catch` + toast:** `saveSessionSettings`, `saveDeliveryIntegrations`, `savePrintSettings`, `saveAiApiKey`, user/TOTP handlers, all optimistic toggles.
**No `try/catch` (unhandled rejection, silent failure):** `saveBusinessProfile`, `saveEmailSettings`, `saveQrMenuSettings`, `saveFeedbackSettings`, `saveBankCommission`, `saveFinancePolicy`, `saveTableServiceSettings`, `saveBeverageServiceSettings`, `saveYieldManagement`, `saveStaffBenefits`, `saveZReportReceiptSettings`, `saveRoleModules`.

On API failure these show **no error message** — just no success flash. The user cannot distinguish "saved" from "failed".

### 1.3 Partial saves in double-call handlers
- `saveBusinessProfile` = `update_business_profile_live` **then** `update_qr_settings_live` (QR Base URL lives in a different settings key). If the second call throws, the profile is already saved but no success is shown and the failure is silent (1.2). Reload shows mixed state.
- `saveTableServiceSettings` = `update_service_fee_live` **then** `update_table_service_settings_live` — same pattern, same risk.

### 1.4 Silent load failure → defaults can be saved over real settings
`loadData` uses `Promise.allSettled`, but only a `users` failure notifies. If `get_settings_live` fails, every form silently shows initial defaults (bank 2%/0.5%, yield presets, feedback texts…). A user who then presses Save persists those defaults over production config. No loading state, no retry.

### 1.5 Session PATCH resets omitted fields to defaults (merge-by-convention)
Backend `operations.py:4108-4129` builds the session object from payload with fallbacks to `current` **only** for `theme_mode/ui_mode/tables_ui_mode/login_background_url/device_authorization_enabled`. For `idle_logout_minutes`, `virtual_keyboard_enabled`, `staff_pin_length` an omitted field becomes the default — `idle_logout_minutes` omitted ⇒ **auto-logout silently disabled (0)**. All four current frontend callers happen to send the full object, so nothing is broken today, but this is a landmine for the next "small" toggle handler.

### 1.6 No dirty-state tracking, no busy state → double submit
No panel tracks "unsaved changes"; no save button disables while a request is in flight (only the test-print buttons do, via `testingPrint`). Double-click = double PATCH. Combined with the 2.5 s success flash, users have no way to know what is persisted.

---

## 2. P1 — information architecture & navigation

### 2.1 Category switching manipulates the DOM directly
```tsx
const el = document.getElementById(sec.id);
if (el) el.style.display = visibleSet.has(sec.id) ? '' : 'none';
```
(`SettingsPanel.tsx`, category `useEffect`.) All 20 panels are always mounted; filtering hides them via `style.display`. This fights React, keeps all panels' cost in the tree, and means a panel hidden in one category is still one `getElementById` typo away from breaking.

### 2.2 No search, no anchor navigation
20 panels, hundreds of fields, no search box, no jump links. "Hamısı / All" is one giant scroll. The `sec-*` ids exist but nothing links to them.

### 2.3 Session settings are duplicated in two sections
`InterfaceSettingsSection` contains a "Session Security" block (idle logout, staff PIN length, login background uploader) that is **near-verbatim duplicated** in `SecuritySettingsSection`'s `sec-security` panel — same state, two independent save buttons, both calling `saveSessionSettings`. Drift already happened: the device-authorization toggle + terminal list exists **only** in the Security copy, while both copies render the login-background uploader (~90 duplicated lines each: `InterfaceSettingsSection.tsx:118-260` vs `SecuritySettingsSection.tsx:300-487`).

### 2.4 Category taxonomy is mixed with permission gating
- `security` category (Session security, Staff, Roles, Users, Password/2FA, Danger) is hidden client-side for non-admins — but "Staff benefit settings" is an **operations** setting, not security.
- Conversely, the whole `interface` category renders for **every** role, yet its save endpoint (`/ops/settings/session`) is `_ensure_admin` server-side. A manager/staff granted the settings module can edit fields and gets 403 toasts on save. Client gating and server gating disagree.

### 2.5 Print section buries its settings under documentation
`sec-print` (~500 lines) interleaves actual settings with three long tutorials: QZ Tray silent-print steps, `allowed.dat` instructions, and a separate agent-install modal with options A/B/C. The real fields are scattered between walls of instructions.

### 2.6 Inconsistent confirmation & modal systems
Three patterns for destructive actions: native `confirm()` (delivery-mapping delete), `ConfirmModal` component (user delete), hand-rolled password modal (system reset). Two hand-rolled modal z-indexes (`z-[120]`, `z-[140]`) plus the shared component.

---

## 3. P2 — consistency, duplication, polish

1. **≥4 button styles** on one screen: `glossy-gold` (the standard `saveButtonClass`), `neon-btn` (role permissions, password update, TOTP verify — `SecuritySettingsSection.tsx:612`), bordered red variants, ad-hoc emerald/amber test buttons.
2. **Label vs placeholder inconsistency:** Business/Finance/Tables/Beverage use `field-stack form-card` + `field-label` + `field-hint`; Email, Staff limits, Users use placeholder-only inputs (context disappears once filled).
3. **Emoji icons for categories** (📋🏢⚙️💰🔗🤖🔒🎨) vs lucide icons elsewhere; on mobile the category labels are hidden (`hidden sm:inline`), leaving emoji-only tabs with no accessible name.
4. **i18n leaks:** hardcoded AZ strings — `'Bolt Food Webhook URL:'`, `'Yoxlanır...'`, `'QZ Tray:'` badges, AI provider list, `'Modern (BahaY)'`, `'Test çapı xətası'`; English-only errors — `'Compression failed'`, `'Failed'` (`saveTablesUiMode` catch), `'Error creating mapping'`.
5. **Dead artifacts:** `InterfaceSettingsSection.tsx.bak` in `src/`; `ui_mode: 'old' as 'old'` — a dead `'old' | 'new'` mode still threaded through types and every session payload.
6. **Half-finished typing:** `settings/types.ts` defines typed state models, but the panel still declares inline `useState({...})` objects, casts `as any`, and sections receive `profile: any`, `emailSettings: any`, `users: any[]`.
7. **Duplicated default literals:** QR-menu and feedback defaults (including the 6 `preset_tags` strings) and yield presets are written twice — once in `useState` initializers, once in `loadData` fallbacks. Guaranteed to drift.
8. **Secret fields give no state feedback:** delivery secrets load as literal `'***'`, so a set secret renders as 3 password dots indistinguishable from "user typed ***"; an empty field doesn't tell you whether a secret is stored. Clearing works (saves `''`), but there's no "stored / not set" indicator.
9. **Header leaks internals:** raw `tenantId` (`tenant_default`) shown under the title.
10. **Global success banner is invisible when scrolled:** `flashSuccess` always also sets a top-of-page banner; in a 20-panel scroll the user sees only the per-panel flash (which not all handlers have).
11. **Accessibility:** category strip uses `role=tablist/tab` without `tabpanel` linkage; save buttons inside no `form` rely on `onClick` only; several icon-only buttons lack labels.
12. **Feedback panel field flood:** 12 multi-language receipt/heading text inputs rendered flat (no tabs/accordion), plus QR-poster canvas generation logic living inside the section component (UI + business logic mixed).

---

## 4. What already works well

- Consistent per-panel save granularity (one panel = one concern = one save button) — the right base model.
- Optimistic toggles with rollback for theme / virtual keyboard / device auth (correct pattern, applied only in Interface/Security).
- `Promise.allSettled` initial load; secrets masked by backend for non-privileged viewers (`operations.py:1418-1444`); `'***'` sentinel to avoid overwriting secrets.
- i18n is triple-language `tx()` in the overwhelming majority of strings; touch-friendly `min-h-11` targets in the newer blocks.

---

## 5. Recommended fix order

> **Status (2026-09-06):**
> - **Item 1 — done:** P0 batch (per-keystroke AI-key save removed, all 12 bare save handlers wrapped with error toast + busy state, settings/profile load-failure warnings, save-button disabling) plus `.bak` cleanup and two i18n fixes.
> - **Item 2 — done:** duplicated session-security block removed from `InterfaceSettingsSection` (Interface keeps only the three instant-persist toggles + a pointer note; idle logout, staff PIN length, login background, device auth live only in the admin-only Security copy).
> - **Item 3 (partial) — done:** `sec-staff` moved to the `operations` category; **search box added** to the settings header (matches localized panel titles + per-panel multi-language keywords, overrides the category filter while active, auto-scrolls to the first hit, empty-state message). Conditional rendering is still deferred.
> - **Item 4 (partial):** the client/server permission mismatch on session settings remains open (backend/product decision).
> - **Backend hardening — done (P0.5 from §1.5):** `PATCH /ops/settings/session` now uses true merge semantics — omitted/`None` fields keep their stored values (fallback `DEFAULT_SESSION_SETTINGS`), garbage `idle_logout_minutes` can no longer silently disable auto-logout, and `staff_pin_length` changes only on an explicit `4`/`6`. Regression-tested in `backend/tests/test_session_settings_merge.py` (10 cases).
> - **Item 5 — polish batch done:** primary actions unified (`glossy-gold` save buttons via `PanelSaveButton` now cover roles/password/PIN/user-password; TOTP verify + add-feedback-tag converted); all Email/Staff/Users/delivery inputs got labels or `aria-label` (no placeholder-only fields remain); destructive confirms unified on `ConfirmModal` (native `confirm()` for delivery-mapping delete replaced; reset-modal and print-agent modal aligned to `z-[130]`). Remaining minor: secret-field "stored ✓" indicators, print-section docs accordion.

1. **P0 batch (small, surgical):** remove the per-keystroke AI-key API call (save only on button / debounce); wrap the 12 bare save handlers in the existing try/catch+toast pattern; notify on `settingsRes` load failure; disable save buttons while saving.
2. **De-duplicate session UI:** keep idle-logout/PIN-length/login-background in **one** place (Interface), keep device-auth/terminals in Security; delete the copy and its second save button.
3. **State refactor:** lift each panel's state into its own section component (they already exist) and hand the parent only load-data + notify; kills the 60-prop hose and the double default literals. The DOM-hiding effect is replaced for free once panels own their visibility.
4. **IA:** add a search box filtering panel titles/field labels; replace category DOM toggling with conditional render; split "Staff benefits" out of `security`; align client gating with `_ensure_admin` (hide what the server would reject).
5. **Polish pass:** one button component, label+hint for every input, purge `.bak`/`ui_mode`, i18n sweep, single modal system, "stored ✓" indicator on secret fields, unsaved-changes guard on navigation.
