/**
 * Smart and Customizable Order Note Presets Manager
 * Provides:
 * 1. Business custom presets (stored in settings / tenant storage)
 * 2. Smart frequency-based auto-learning for top waiter notes
 * 3. Fast inline preset creation and removal
 */

export const DEFAULT_ORDER_NOTE_PRESETS: string[] = [
  'Şəkərsiz',
  'Az şirin',
  'Buzlu',
  'Badam südü',
  'Sərt',
  'Soya südü',
  'Ekstra İsti',
  'Paket',
  'Duzsuz',
  'Soğansız',
  'Sous kənarda',
  'Acısız',
];

const PRESETS_STORAGE_PREFIX = 'iw_note_presets_v1_';
const FREQUENCY_STORAGE_PREFIX = 'iw_note_freq_v1_';

function getStorageKey(prefix: string, tenantId?: string): string {
  const safeTenant = String(tenantId || 'tenant_default').trim();
  return `${prefix}${safeTenant}`;
}

export function getTenantNotePresets(tenantId?: string, settingsPresets?: string[]): string[] {
  if (Array.isArray(settingsPresets) && settingsPresets.length > 0) {
    return settingsPresets.map((x) => String(x || '').trim()).filter(Boolean);
  }
  if (typeof window === 'undefined') return DEFAULT_ORDER_NOTE_PRESETS;
  try {
    const raw = window.localStorage.getItem(getStorageKey(PRESETS_STORAGE_PREFIX, tenantId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((x) => String(x || '').trim()).filter(Boolean);
      }
    }
  } catch {
    // fallback to defaults
  }
  return DEFAULT_ORDER_NOTE_PRESETS;
}

export function saveTenantNotePreset(tenantId: string, newPreset: string): string[] {
  const trimmed = String(newPreset || '').trim();
  if (!trimmed) return getTenantNotePresets(tenantId);
  const current = getTenantNotePresets(tenantId);
  if (current.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
    return current;
  }
  const updated = [trimmed, ...current];
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(getStorageKey(PRESETS_STORAGE_PREFIX, tenantId), JSON.stringify(updated));
    } catch {}
  }
  return updated;
}

export function removeTenantNotePreset(tenantId: string, presetToRemove: string): string[] {
  const trimmed = String(presetToRemove || '').trim().toLowerCase();
  const current = getTenantNotePresets(tenantId);
  const updated = current.filter((p) => p.trim().toLowerCase() !== trimmed);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(getStorageKey(PRESETS_STORAGE_PREFIX, tenantId), JSON.stringify(updated));
    } catch {}
  }
  return updated;
}

export function recordNoteUsage(tenantId: string, note: string): void {
  if (!note || typeof window === 'undefined') return;
  try {
    const key = getStorageKey(FREQUENCY_STORAGE_PREFIX, tenantId);
    const raw = window.localStorage.getItem(key);
    const freqMap: Record<string, number> = raw ? JSON.parse(raw) : {};

    const tags = note
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 40);

    for (const tag of tags) {
      freqMap[tag] = (freqMap[tag] || 0) + 1;
    }

    // Keep top 60 frequent tags
    const sorted = Object.entries(freqMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60);

    const pruned: Record<string, number> = Object.fromEntries(sorted);
    window.localStorage.setItem(key, JSON.stringify(pruned));
  } catch {}
}

export function getSmartTopNotes(tenantId?: string, excludePresets: string[] = [], limit = 6): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = getStorageKey(FREQUENCY_STORAGE_PREFIX, tenantId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const freqMap: Record<string, number> = JSON.parse(raw);
    const excludeSet = new Set(excludePresets.map((p) => p.toLowerCase().trim()));

    return Object.entries(freqMap)
      .filter(([tag, count]) => count >= 2 && !excludeSet.has(tag.toLowerCase().trim()))
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag]) => tag);
  } catch {
    return [];
  }
}
