# Implementation Plan: Settings Panel Split & Light Theme

## Overview

Phase 1 extracts the remaining 6 section components from the monolithic `SettingsPanel.tsx` (4200+ lines) into focused sub-components, following the established pattern set by `BusinessProfileSection.tsx` and `EmailSettingsSection.tsx`. Phase 2 introduces a light theme layer using CSS variables and adapts major modules.

## Tasks

- [x] 1. Create shared types and prepare extraction foundation
  - [x] 1.1 Create shared state types file
    - Create `src/components/admin/settings/types.ts`
    - Export all settings state interfaces: `PrintSettingsState`, `ZReportReceiptSettingsState`, `SessionSettingsState`, `BeverageServiceSettingsState`, `BankCommissionState`, `FinancePolicyState`, `YieldManagementState`, `StaffBenefitsState`, `RoleModules`, `DeliveryIntegrationsState`
    - Export shared prop types: `saveButtonClass`, `renderPanelSuccess`, `lang`
    - Move `RoleModules` type, `YIELD_PRESETS`, `defaultRoleModules`, `moduleCatalog`, `roleLabelMap`, `moduleLabelMap` constants from SettingsPanel to this file or a shared constants file
    - _Requirements: 8.1, 8.3_

- [x] 2. Extract AISettingsSection (smallest, fewest props)
  - [x] 2.1 Create AISettingsSection component
    - Create `src/components/admin/settings/AISettingsSection.tsx`
    - Define `AISettingsSectionProps` interface with: `lang`, `saveButtonClass`, `renderPanelSuccess`, `aiApiKey`, `setAiApiKey`, `saveAiApiKey`, `menuCatalog`, `inventoryCatalog`
    - Extract the `sec-ai` section markup from SettingsPanel into this component
    - Preserve the `<div id="sec-ai">` root wrapper for DOM visibility toggling
    - Import and use `detectAiConfigFromApiKey` and `aiProviderLabel` from `../../lib/ai_config`
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 2.2 Wire AISettingsSection into SettingsPanel
    - Import `AISettingsSection` in SettingsPanel
    - Replace inline `sec-ai` JSX with `<AISettingsSection {...aiProps} />`
    - Remove extracted JSX from SettingsPanel (reduce line count)
    - Verify the section still appears under the AI category tab
    - _Requirements: 4.2, 7.1, 8.1_

  - [ ]* 2.3 Write unit test for AISettingsSection
    - Test that component renders with `id="sec-ai"` on root element
    - Test that save button calls `saveAiApiKey` handler
    - Test that `renderPanelSuccess('ai')` is rendered
    - _Requirements: 4.1, 4.3, 8.4_

- [x] 3. Extract InterfaceSettingsSection (standalone, few dependencies)
  - [x] 3.1 Create InterfaceSettingsSection component
    - Create `src/components/admin/settings/InterfaceSettingsSection.tsx`
    - Define `InterfaceSettingsSectionProps` interface with: `lang`, `saveButtonClass`, `renderPanelSuccess`, `sessionSettings`, `setSessionSettings`, `saveSessionSettings`, `changeThemeMode`, `toggleVirtualKeyboard`
    - Extract the `sec-interface` section markup from SettingsPanel
    - Preserve `<div id="sec-interface">` root wrapper
    - Include theme mode toggle, virtual keyboard toggle, staff PIN length, idle logout, login background URL controls
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 3.2 Wire InterfaceSettingsSection into SettingsPanel
    - Import `InterfaceSettingsSection` in SettingsPanel
    - Replace inline `sec-interface` JSX with `<InterfaceSettingsSection {...interfaceProps} />`
    - Remove extracted JSX from SettingsPanel
    - Verify section appears under Interface category tab
    - _Requirements: 6.2, 7.1, 8.1_

  - [ ]* 3.3 Write unit test for InterfaceSettingsSection
    - Test that component renders with `id="sec-interface"` on root element
    - Test that theme mode toggle calls `changeThemeMode`
    - Test that save button calls `saveSessionSettings`
    - _Requirements: 6.1, 6.3, 8.4_

- [x] 4. Checkpoint - Verify small extractions
  - Ensure all tests pass, ask the user if questions arise.
  - Manually confirm AI and Interface sections render correctly under their category tabs.

- [x] 5. Extract OperationSettingsSection (4 sub-sections)
  - [x] 5.1 Create OperationSettingsSection component
    - Create `src/components/admin/settings/OperationSettingsSection.tsx`
    - Define `OperationSettingsSectionProps` interface with props for: print settings, z-report receipt settings, table service settings, beverage service settings, plus their setters and save handlers
    - Include printer-related state: `printers`, `agentStatus`, `qzStatus`, local print agent props
    - Extract all 4 section blocks: `sec-print`, `sec-zreport`, `sec-tables`, `sec-beverage`
    - Render as a fragment containing 4 `<div id="sec-*">` wrappers to preserve DOM visibility
    - Import `PrintSettingsState`, `ZReportReceiptSettingsState`, `BeverageServiceSettingsState` from `./types`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 5.2 Wire OperationSettingsSection into SettingsPanel
    - Import `OperationSettingsSection` in SettingsPanel
    - Replace inline `sec-print`, `sec-zreport`, `sec-tables`, `sec-beverage` JSX blocks with `<OperationSettingsSection {...operationProps} />`
    - Remove extracted JSX from SettingsPanel
    - Verify all 4 sections appear under Operations category tab
    - _Requirements: 1.4, 7.1, 8.1_

  - [ ]* 5.3 Write unit test for OperationSettingsSection
    - Test all 4 DOM IDs are present: `sec-print`, `sec-zreport`, `sec-tables`, `sec-beverage`
    - Test each save button invokes correct handler (savePrintSettings, saveZReportReceiptSettings, saveTableServiceSettings, saveBeverageServiceSettings)
    - Test renderPanelSuccess is called for each sub-section
    - _Requirements: 1.1, 1.3, 1.4_

- [x] 6. Extract FinanceSettingsSection (3 sub-sections)
  - [x] 6.1 Create FinanceSettingsSection component
    - Create `src/components/admin/settings/FinanceSettingsSection.tsx`
    - Define `FinanceSettingsSectionProps` interface with props for: bank commission, finance policy, yield management, plus their setters and save handlers
    - Include `inventoryCatalog` for yield tracked items selection
    - Include `YIELD_PRESETS` constant (import from types/constants)
    - Extract all 3 section blocks: `sec-bankfee`, `sec-finance`, `sec-yield`
    - Render as fragment with 3 `<div id="sec-*">` wrappers
    - Import `BankCommissionState`, `FinancePolicyState`, `YieldManagementState` from `./types`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 6.2 Wire FinanceSettingsSection into SettingsPanel
    - Import `FinanceSettingsSection` in SettingsPanel
    - Replace inline `sec-bankfee`, `sec-finance`, `sec-yield` JSX with `<FinanceSettingsSection {...financeProps} />`
    - Remove extracted JSX from SettingsPanel
    - Verify all 3 sections appear under Finance category tab
    - _Requirements: 2.2, 7.1, 8.1_

  - [ ]* 6.3 Write unit test for FinanceSettingsSection
    - Test all 3 DOM IDs present: `sec-bankfee`, `sec-finance`, `sec-yield`
    - Test each save button invokes correct handler
    - Test yield presets apply values correctly
    - _Requirements: 2.1, 2.3, 2.4_

- [x] 7. Extract IntegrationsSettingsSection (3 sub-sections + complex QR/feedback)
  - [x] 7.1 Create IntegrationsSettingsSection component
    - Create `src/components/admin/settings/IntegrationsSettingsSection.tsx`
    - Define `IntegrationsSettingsSectionProps` interface with props for: delivery integrations, QR menu settings, feedback settings, delivery menu mappings, plus their setters and save handlers
    - Include `menuCatalog` for delivery menu mapping selection
    - Include QR code generation logic (import `QRCode` from 'qrcode')
    - Extract all 3 section blocks: `sec-delivery`, `sec-qr`, `sec-feedback`
    - Render as fragment with 3 `<div id="sec-*">` wrappers
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 7.2 Wire IntegrationsSettingsSection into SettingsPanel
    - Import `IntegrationsSettingsSection` in SettingsPanel
    - Replace inline `sec-delivery`, `sec-qr`, `sec-feedback` JSX with `<IntegrationsSettingsSection {...integrationsProps} />`
    - Remove extracted JSX from SettingsPanel
    - Verify all 3 sections appear under Integrations category tab
    - _Requirements: 3.2, 7.1, 8.1_

  - [ ]* 7.3 Write unit test for IntegrationsSettingsSection
    - Test all 3 DOM IDs present: `sec-delivery`, `sec-qr`, `sec-feedback`
    - Test each save button invokes correct handler
    - Test delivery menu mapping CRUD operations
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 8. Checkpoint - Verify mid-level extractions
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm Operations, Finance, and Integrations sections render and save correctly.

- [x] 9. Extract SecuritySettingsSection (largest, most complex)
  - [x] 9.1 Create SecuritySettingsSection component
    - Create `src/components/admin/settings/SecuritySettingsSection.tsx`
    - Define `SecuritySettingsSectionProps` interface grouping props by concern:
      - Staff benefits: `staffBenefits`, `setStaffBenefits`, `saveStaffBenefits`, `menuCatalog`
      - Role modules: `roleModules`, `setRoleModules`, `saveRoleModules`
      - User management: `users`, `newUserName`, `setNewUserName`, `newUserRole`, `setNewUserRole`, `newUserPin`, `setNewUserPin`, `handleCreateUser`, `handleDeleteUser`
      - Password/2FA: TOTP setup state, `handleChangeOwnPassword`, `handleUpdatePasswordForUser`, `handleUpdatePin`, `setupTotp`, `verifyTotp`, `disableTotp`
      - Danger zone: `resetModalOpen`, `setResetModalOpen`, `resetSystem`, `resetConfirmPassword`, `setResetConfirmPassword`
    - Extract all 6 section blocks: `sec-security`, `sec-staff`, `sec-roles`, `sec-password`, `sec-users`, `sec-danger`
    - Render as fragment with 6 `<div id="sec-*">` wrappers
    - Import `StaffBenefitsState`, `RoleModules` from `./types`
    - Import `roleLabelMap`, `moduleLabelMap`, `moduleCatalog`, `defaultRoleModules` from shared constants
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 9.2 Wire SecuritySettingsSection into SettingsPanel
    - Import `SecuritySettingsSection` in SettingsPanel
    - Replace inline security section JSX with conditional render: `{['admin', 'super_admin'].includes(currentRole) && <SecuritySettingsSection {...securityProps} />}`
    - Remove extracted JSX from SettingsPanel
    - Ensure role guard is preserved (component not rendered for non-admin users)
    - Verify all 6 sections appear under Security category tab for admin users
    - _Requirements: 5.2, 5.3, 7.1, 8.1_

  - [ ]* 9.3 Write unit test for SecuritySettingsSection
    - Test all 6 DOM IDs present for admin role
    - Test component is not rendered when role is not admin/super_admin
    - Test save handlers for staff benefits, role modules
    - Test user creation flow
    - Test danger zone reset modal behavior
    - _Requirements: 5.1, 5.3, 5.4_

- [x] 10. Wire all components and clean up SettingsPanel orchestrator
  - [x] 10.1 Finalize SettingsPanel as orchestrator
    - Remove all extracted inline JSX from SettingsPanel
    - Ensure SettingsPanel only contains: state declarations, save functions, data loading (`loadData`), tab strip, and section component renders
    - Verify import statements are clean (remove unused imports from extracted code)
    - Confirm SettingsPanel line count is reduced to ~800-1200 lines (state + handlers + orchestration)
    - _Requirements: 8.1, 8.3_

  - [x] 10.2 Verify category tab navigation still works end-to-end
    - Confirm the `useEffect` DOM visibility toggle works with all extracted components
    - Test each category tab shows only its sections: General (sec-profile, sec-email), Operations (sec-print, sec-zreport, sec-tables, sec-beverage), Finance (sec-bankfee, sec-finance, sec-yield), Integrations (sec-delivery, sec-qr, sec-feedback), AI (sec-ai), Security (sec-security, sec-staff, sec-roles, sec-password, sec-users, sec-danger), Interface (sec-interface)
    - Test "All" tab shows all sections
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 10.3 Write integration test for full SettingsPanel
    - Test that all section components render within SettingsPanel
    - Test category tab switching hides/shows correct sections
    - Test that state changes in one section are reflected when reading from parent
    - _Requirements: 7.1, 7.2, 8.2, 8.4_

- [x] 11. Checkpoint - Phase 1 complete
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm SettingsPanel is now an orchestrator with all sections extracted.
  - Verify no visual regressions in any settings category.

- [ ] 12. Phase 2: Define Theme Layer (lower priority)
  - [ ] 12.1 Create theme CSS variables file
    - Create `src/styles/theme.css` (or extend existing CSS)
    - Define `:root` / `:root[data-theme="dark"]` variables matching current dark palette
    - Define `:root[data-theme="light"]` variables with WCAG AA contrast ratios
    - Include semantic tokens: background, foreground, card, primary, secondary, muted, accent, destructive, border, input, ring
    - Import the theme CSS file in the app entry point
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ] 12.2 Update Tailwind config to consume theme variables
    - Extend `tailwind.config.ts` theme colors to reference the new CSS variables with `hsl(var(--*))` syntax (if not already done)
    - Ensure all semantic color tokens are available as Tailwind utilities (e.g., `bg-background`, `text-foreground`, `border-border`)
    - _Requirements: 9.4_

  - [ ]* 12.3 Write unit tests for theme variable definitions
    - Test that both dark and light variable sets define all required tokens
    - Test WCAG AA contrast ratios for light theme color pairs (4.5:1 body text, 3:1 large text)
    - _Requirements: 9.3, 15.2_

- [ ] 13. Phase 2: Adapt POS Module for Light Theme (lower priority)
  - [ ] 13.1 Replace hardcoded dark classes in POS module
    - Audit `POS.tsx` for hardcoded dark-palette Tailwind classes (`bg-slate-900`, `text-slate-100`, `border-slate-700`, etc.)
    - Replace with semantic Tailwind utilities (`bg-background`, `text-foreground`, `border-border`)
    - Preserve all existing layout and spacing
    - _Requirements: 10.1, 10.3_

  - [ ]* 13.2 Write visual regression test for POS in both themes
    - Test POS renders without errors in both dark and light modes
    - Verify interactive elements maintain visible focus indicators in both modes
    - _Requirements: 10.1, 10.2, 15.2_

- [ ] 14. Phase 2: Adapt Tables and KDS Modules (lower priority)
  - [ ] 14.1 Replace hardcoded dark classes in Tables module
    - Audit `TablesPage.tsx` for hardcoded dark-palette classes
    - Replace with semantic Tailwind utilities
    - Ensure table status indicators (free, occupied, reserved) remain distinct in both themes
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ] 14.2 Replace hardcoded dark classes in KDS module
    - Audit `KDS.tsx` for hardcoded dark-palette classes
    - Replace with semantic Tailwind utilities
    - Ensure order status color coding (pending, in-progress, ready, overdue) uses shape/icon in addition to color
    - _Requirements: 12.1, 12.2, 12.3, 15.3_

  - [ ]* 14.3 Write visual regression tests for Tables and KDS
    - Test both modules render in dark and light modes
    - Verify status indicators are distinguishable in both modes
    - _Requirements: 11.3, 12.3_

- [ ] 15. Phase 2: Adapt Finance and Admin Modules (lower priority)
  - [ ] 15.1 Replace hardcoded dark classes in Finance and Admin panels
    - Audit Finance-related panels and `AdminPanel.tsx` for hardcoded dark-palette classes
    - Replace with semantic Tailwind utilities
    - Ensure data tables, charts, and form inputs remain legible in both modes
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ]* 15.2 Write visual regression tests for Finance and Admin
    - Test panels render in both dark and light modes
    - Verify contrast for data tables and form inputs
    - _Requirements: 13.2, 13.3_

- [ ] 16. Phase 2: Theme persistence and transitions (lower priority)
  - [ ] 16.1 Implement theme persistence and FOUC prevention
    - Ensure `data-theme` attribute is applied from stored settings before first React render (synchronous script or early App root logic)
    - Verify `update_session_settings_live` is called when theme changes
    - Ensure fallback to `'dark'` when stored value is invalid or missing
    - Apply theme transition within one animation frame (avoid FOUC)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 15.1_

  - [ ]* 16.2 Write tests for theme persistence
    - Test default theme is 'dark' when no value stored
    - Test theme persists across page reloads (mocked)
    - Test invalid stored values fall back to 'dark'
    - _Requirements: 14.1, 14.4_

- [ ] 17. Final checkpoint - All phases complete
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm Phase 1 extraction is complete with no visual regressions.
  - Confirm Phase 2 theme layer works across all adapted modules.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Phase 1 (tasks 1–11) is the immediate priority — extract all sections from SettingsPanel
- Phase 2 (tasks 12–17) is lower priority and can be done incrementally after Phase 1
- Each extraction task references specific requirements for traceability
- Checkpoints ensure incremental validation after groups of extractions
- The existing `BusinessProfileSection` and `EmailSettingsSection` serve as reference patterns for all new extractions
- All extracted components must preserve their `<div id="sec-*">` root wrappers for the DOM visibility toggle to work
- State and save functions remain in SettingsPanel — extracted components are pure rendering children receiving props

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3"] },
    { "id": 3, "tasks": ["5.1", "6.1", "7.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.2", "6.3", "7.2", "7.3"] },
    { "id": 5, "tasks": ["9.1"] },
    { "id": 6, "tasks": ["9.2", "9.3"] },
    { "id": 7, "tasks": ["10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3"] },
    { "id": 9, "tasks": ["12.1"] },
    { "id": 10, "tasks": ["12.2", "12.3"] },
    { "id": 11, "tasks": ["13.1", "14.1", "14.2", "15.1", "16.1"] },
    { "id": 12, "tasks": ["13.2", "14.3", "15.2", "16.2"] }
  ]
}
```
