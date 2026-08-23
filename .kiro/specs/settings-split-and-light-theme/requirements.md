# Requirements Document

## Introduction

This feature combines two related improvements to the ironwaves POS platform:

**Phase 1 – Settings Panel Decomposition**: The monolithic `SettingsPanel.tsx` (4200+ lines) is split into 6–7 focused sub-components grouped by category tab (General, Operations, Finance, Integrations, AI, Security, Interface). Currently only `BusinessProfileSection` and `EmailSettingsSection` have been extracted. The remaining sections must be extracted while preserving existing behavior: category tab navigation via DOM visibility toggling, shared state across sections, flash success notifications, and role-based access control.

**Phase 2 – Light Theme for POS**: The platform currently supports only a dark color scheme despite already having a `theme_mode` toggle (`'dark' | 'light'`) in session settings and a `data-theme` attribute on `documentElement`. Over 100 components use hardcoded Tailwind dark-palette classes (e.g., `bg-slate-900`, `text-slate-100`). This phase introduces a theming layer (CSS variables or Tailwind utilities) and adapts all major modules so both dark and light modes render correctly.

## Glossary

- **Settings_Panel**: The admin settings UI component (`SettingsPanel.tsx`) containing all tenant configuration controls, organized into category tabs.
- **Section_Component**: An extracted React sub-component responsible for rendering and managing one logical section of the Settings_Panel (e.g., Print settings, Finance settings).
- **Category_Tab**: A navigation tab within the Settings_Panel that filters visible sections by domain (General, Operations, Finance, Integrations, AI, Security, Interface).
- **Theme_Mode**: A tenant-level session setting with value `'dark'` or `'light'` that controls the visual color scheme of the application.
- **Theme_Layer**: The CSS variables, Tailwind utilities, or class mappings that translate `Theme_Mode` into concrete color values consumed by components.
- **POS_Module**: The point-of-sale interface component (`POS.tsx`).
- **Tables_Module**: The table management interface (`TablesPage.tsx`).
- **KDS_Module**: The kitchen display system component (`KDS.tsx`).
- **Finance_Module**: Finance-related admin panels (Finance, Bank Fees, Yield).
- **Admin_Module**: The top-level admin panel and its sub-panels (`AdminPanel.tsx`).
- **Flash_Notification**: A temporary success/error message shown to the user after a save operation.
- **Role_Guard**: Logic that restricts visibility of the Security category tab to users with `admin` or `super_admin` roles.

## Requirements

### Requirement 1: Extract Operations Section Component

**User Story:** As a developer, I want the Operations-related settings (Print, Z-Report Receipt, Tables, Beverage) extracted into a dedicated `OperationSettingsSection` component, so that `SettingsPanel.tsx` is smaller and easier to maintain.

#### Acceptance Criteria

1. WHEN the Settings_Panel renders, THE Section_Component for Operations SHALL display all controls previously rendered inline for Print, Z-Report Receipt, Tables, and Beverage settings.
2. THE Section_Component for Operations SHALL accept shared state and setter functions as props or via a shared context, preserving existing read/write behavior for all Operations state variables.
3. WHEN a user saves any Operations setting, THE Section_Component SHALL invoke the corresponding save function and THE Settings_Panel SHALL display a Flash_Notification with the success message.
4. THE Section_Component for Operations SHALL render identically to the current inline rendering (same DOM element IDs `sec-print`, `sec-zreport`, `sec-tables`, `sec-beverage`).

### Requirement 2: Extract Finance Section Component

**User Story:** As a developer, I want the Finance-related settings (Bank Fees, Finance Policy, Yield Management) extracted into a `FinanceSettingsSection` component, so that financial configuration is isolated and testable.

#### Acceptance Criteria

1. WHEN the Settings_Panel renders, THE Section_Component for Finance SHALL display all controls for Bank Fees, Finance Policy, and Yield Management.
2. THE Section_Component for Finance SHALL preserve DOM element IDs `sec-bankfee`, `sec-finance`, and `sec-yield`.
3. WHEN a user saves any Finance setting, THE Section_Component SHALL invoke the existing save function and THE Settings_Panel SHALL display a Flash_Notification.
4. THE Section_Component for Finance SHALL receive state variables and save handlers through props or shared context without duplicating state.

### Requirement 3: Extract Integrations Section Component

**User Story:** As a developer, I want the Integrations-related settings (Delivery, QR & Feedback, Feedback Portal) extracted into an `IntegrationsSettingsSection` component, so that third-party integration configuration is self-contained.

#### Acceptance Criteria

1. WHEN the Settings_Panel renders, THE Section_Component for Integrations SHALL display all controls for Delivery integrations, QR & Feedback settings, and Feedback Portal settings.
2. THE Section_Component for Integrations SHALL preserve DOM element IDs `sec-delivery`, `sec-qr`, and `sec-feedback`.
3. WHEN a user saves any Integrations setting, THE Section_Component SHALL invoke the corresponding save function and THE Settings_Panel SHALL display a Flash_Notification.
4. THE Section_Component for Integrations SHALL receive all required state and handlers without duplicating logic.

### Requirement 4: Extract AI Section Component

**User Story:** As a developer, I want the AI & Recipes settings extracted into an `AISettingsSection` component, so that AI-specific configuration is independently maintainable.

#### Acceptance Criteria

1. WHEN the Settings_Panel renders, THE Section_Component for AI SHALL display all controls for AI provider configuration and recipe settings.
2. THE Section_Component for AI SHALL preserve the DOM element ID `sec-ai`.
3. WHEN a user saves AI settings, THE Section_Component SHALL invoke the corresponding save function and THE Settings_Panel SHALL display a Flash_Notification.

### Requirement 5: Extract Security Section Component

**User Story:** As a developer, I want the Security-related settings (Security, Staff Benefits, Roles, Password/2FA, Users, Danger Zone) extracted into a `SecuritySettingsSection` component, so that sensitive admin controls are in a dedicated module.

#### Acceptance Criteria

1. WHEN the Settings_Panel renders, THE Section_Component for Security SHALL display all controls for Security, Staff Benefits, Roles, Password/2FA, Users, and Danger Zone.
2. THE Section_Component for Security SHALL preserve DOM element IDs `sec-security`, `sec-staff`, `sec-roles`, `sec-password`, `sec-users`, and `sec-danger`.
3. WHILE the current user role is not `admin` or `super_admin`, THE Category_Tab for Security SHALL remain hidden and THE Section_Component for Security SHALL not render.
4. WHEN a user saves any Security setting, THE Section_Component SHALL invoke the corresponding save function and THE Settings_Panel SHALL display a Flash_Notification.

### Requirement 6: Extract Interface Section Component

**User Story:** As a developer, I want the Interface settings (theme mode, UI mode, language, login background) extracted into an `InterfaceSettingsSection` component, so that appearance-related settings are isolated.

#### Acceptance Criteria

1. WHEN the Settings_Panel renders, THE Section_Component for Interface SHALL display all controls for Theme_Mode, UI mode, virtual keyboard, staff PIN length, and login background.
2. THE Section_Component for Interface SHALL preserve the DOM element ID `sec-interface`.
3. WHEN a user saves Interface settings, THE Section_Component SHALL invoke the save function and THE Settings_Panel SHALL display a Flash_Notification.

### Requirement 7: Preserve Category Tab Navigation After Extraction

**User Story:** As a user, I want the category tab navigation to continue working identically after settings sections are extracted, so that my workflow is not disrupted.

#### Acceptance Criteria

1. WHEN a user selects a Category_Tab, THE Settings_Panel SHALL show only sections belonging to that category by toggling DOM element visibility via the existing `useEffect` pattern.
2. WHEN a user selects the "All" category, THE Settings_Panel SHALL display all sections regardless of category.
3. THE Settings_Panel SHALL maintain the same tab strip with icons and localized labels for all categories (General, Operations, Finance, Integrations, AI, Security, Interface).
4. THE Category_Tab strip SHALL remain sticky at the top of the panel and scroll horizontally on mobile viewports.

### Requirement 8: Preserve Shared State Architecture

**User Story:** As a developer, I want extracted section components to share state without duplication or prop-drilling deep hierarchies, so that the refactoring does not introduce bugs or performance regressions.

#### Acceptance Criteria

1. THE Settings_Panel SHALL maintain all state variables and save functions at the panel level or in a shared context provider accessible to all Section_Components.
2. WHEN any Section_Component modifies a state variable, THE change SHALL be reflected in all other Section_Components that read the same variable.
3. THE Settings_Panel SHALL not duplicate any state variable or save function across multiple Section_Components.
4. FOR ALL Section_Components, the extracted component SHALL produce the same render output as the original inline code for identical state values (round-trip equivalence).

### Requirement 9: Define Theme Layer with CSS Variables

**User Story:** As a developer, I want a centralized theme layer that maps semantic color tokens to concrete values based on `data-theme`, so that components can reference theme-aware colors without hardcoding.

#### Acceptance Criteria

1. THE Theme_Layer SHALL define CSS custom properties (or Tailwind theme tokens) for at least these semantic categories: background-primary, background-secondary, background-surface, text-primary, text-secondary, text-muted, border-default, border-subtle, accent-primary, accent-hover.
2. WHEN `data-theme` is `'dark'`, THE Theme_Layer SHALL resolve semantic tokens to dark palette values consistent with the current appearance.
3. WHEN `data-theme` is `'light'`, THE Theme_Layer SHALL resolve semantic tokens to light palette values ensuring WCAG AA contrast (minimum 4.5:1 for normal text, 3:1 for large text).
4. THE Theme_Layer SHALL be defined in a single CSS file or Tailwind config extension importable by all components.

### Requirement 10: Adapt POS Module for Light Theme

**User Story:** As a cashier, I want the POS interface to be readable and visually consistent in light mode, so that I can work comfortably in well-lit environments.

#### Acceptance Criteria

1. WHEN Theme_Mode is `'light'`, THE POS_Module SHALL render all backgrounds, text, and borders using Theme_Layer semantic tokens instead of hardcoded dark classes.
2. WHEN Theme_Mode is `'light'`, THE POS_Module SHALL maintain a minimum WCAG AA contrast ratio for all interactive elements and text.
3. WHEN Theme_Mode is `'dark'`, THE POS_Module SHALL render identically to the current appearance (no visual regression).

### Requirement 11: Adapt Tables Module for Light Theme

**User Story:** As a waiter, I want the Tables interface to be readable in light mode, so that I can use it on tablets in bright restaurant environments.

#### Acceptance Criteria

1. WHEN Theme_Mode is `'light'`, THE Tables_Module SHALL render using Theme_Layer semantic tokens for backgrounds, text, and borders.
2. WHEN Theme_Mode is `'dark'`, THE Tables_Module SHALL render identically to the current appearance.
3. WHEN Theme_Mode is `'light'`, THE Tables_Module SHALL maintain readable text contrast on all table status indicators (free, occupied, reserved).

### Requirement 12: Adapt KDS Module for Light Theme

**User Story:** As a kitchen staff member, I want the KDS to support light mode, so that the display is legible under kitchen lighting.

#### Acceptance Criteria

1. WHEN Theme_Mode is `'light'`, THE KDS_Module SHALL render using Theme_Layer semantic tokens.
2. WHEN Theme_Mode is `'dark'`, THE KDS_Module SHALL render identically to the current appearance.
3. WHEN Theme_Mode is `'light'`, THE KDS_Module SHALL preserve distinct color coding for order status indicators (pending, in-progress, ready, overdue).

### Requirement 13: Adapt Finance and Admin Panels for Light Theme

**User Story:** As a manager, I want Finance and Admin panels to support light mode, so that all back-office interfaces are consistent with the selected theme.

#### Acceptance Criteria

1. WHEN Theme_Mode is `'light'`, THE Finance_Module and Admin_Module SHALL render using Theme_Layer semantic tokens.
2. WHEN Theme_Mode is `'dark'`, THE Finance_Module and Admin_Module SHALL render identically to the current appearance.
3. WHEN Theme_Mode is `'light'`, THE Admin_Module SHALL maintain legible contrast for data tables, charts, and form inputs.

### Requirement 14: Theme Mode Defaults and Persistence

**User Story:** As a tenant admin, I want dark mode to remain the default theme, and changes to persist across sessions, so that existing users are not surprised by appearance changes.

#### Acceptance Criteria

1. THE Settings_Panel SHALL default Theme_Mode to `'dark'` when no explicit value is stored in session settings.
2. WHEN a user changes Theme_Mode in the Interface section, THE Settings_Panel SHALL persist the value to the backend via `update_session_settings_live`.
3. WHEN the application loads, THE App root SHALL read Theme_Mode from session settings and apply the corresponding `data-theme` attribute to `documentElement` before first paint.
4. IF the stored Theme_Mode value is invalid or missing, THEN THE App root SHALL fall back to `'dark'`.

### Requirement 15: Theme Transition and Accessibility

**User Story:** As a user, I want the theme to switch smoothly without jarring flashes, and all UI elements to remain accessible regardless of theme.

#### Acceptance Criteria

1. WHEN Theme_Mode changes, THE application SHALL apply the new theme within one animation frame to avoid flash of unstyled content.
2. THE Theme_Layer SHALL ensure all interactive elements have visible focus indicators in both dark and light modes.
3. THE Theme_Layer SHALL ensure that color is not the sole means of conveying information (status indicators must also use shape, icon, or label).
