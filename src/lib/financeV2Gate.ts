// Finance v2 UI gate (WP-A1). Pure and import-free so a node test can load it without the app bundle.
// The backend already answers 404 to everybody but super_admin for a dual tenant whose UI is hidden; this is the
// matching client rule. Fail closed: a missing or non-boolean `ui_visible` (old backend) only serves super_admin.
export type FinanceV2Caps = { enabled?: boolean; ui_visible?: boolean } | null | undefined;

export function isFinanceV2Available(caps: FinanceV2Caps, role: string): boolean {
  if (!caps || caps.enabled !== true) return false;
  return caps.ui_visible === true || String(role || '').trim().toLowerCase() === 'super_admin';
}
