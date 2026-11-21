export function inventoryMessage(error: unknown): string {
  const message = String((error as any)?.message || error || 'Əməliyyat alınmadı');
  if (/failed to fetch|networkerror|network request failed|backendə qoşulma alınmadı/i.test(message)) {
    return 'Serverə bağlantı alınmadı. Bağlantını yoxlayıb yenidən cəhd edin.';
  }
  return message.replace(/^Inventory backend[^:]*:\s*/i, '').replace(/\s*\(request_id:[^)]*\)\s*$/, '');
}

export function inventoryMovementLabel(row: any): string {
  const labels: Record<string, string> = {
    opening: 'Başlanğıc qalığı', migration_opening: 'Keçid tarixindəki başlanğıc qalıq', legacy_opening: 'Tarixi başlanğıc qalığı',
    stock_change: 'Qalıq dəyişikliyi', stock_count: 'Faktiki sayım', INVENTORY_ADD: 'İlkin mədaxil',
    INVENTORY_RESTOCK: 'Mədaxil', INVENTORY_CONSUMED: 'Satış üçün istifadə', INVENTORY_LOSS: 'Anbar itkisi',
    INVENTORY_WASTE_CONSUMED: 'Hazırlanmış məhsul itkisi',
  };
  if (row.reason && !String(row.reason).startsWith('{')) return row.reason;
  if (row.reason) {
    try { const detail = JSON.parse(row.reason); if (detail.reason) return detail.reason; } catch { /* historical free text */ }
  }
  return labels[row.kind] || 'Anbar əməliyyatı';
}
