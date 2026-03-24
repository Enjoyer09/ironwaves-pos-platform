import { getDB } from '../lib/db_sim';

export function get_logs(tenant_id: string, limit: number = 100, fromDate?: string, toDate?: string) {
  const tenantLogs = getDB<any>(`${tenant_id}_logs`);
  const inRange = (row: any) => {
    if (!fromDate && !toDate) return true;
    const t = new Date(row?.created_at || 0).getTime();
    if (Number.isNaN(t)) return false;
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Infinity;
    return t >= from && t <= to;
  };

  if (tenantLogs.length > 0) {
    return tenantLogs.filter(inRange).slice(-limit).reverse();
  }

  // Backward compatibility for old logs storage
  const systemLogs = getDB<any>('system_logs').filter((l) => (l.tenant_id || 'tenant_default') === tenant_id);
  return systemLogs.filter(inRange).slice(-limit).reverse();
}

export function get_ui_errors(tenant_id: string, limit: number = 50) {
  const rows = getDB<any>(`${tenant_id}_ui_errors`) || [];
  return rows.slice(-limit).reverse();
}

export function clear_ui_errors(tenant_id: string) {
  localStorage.removeItem(`${tenant_id}_ui_errors`);
  return true;
}
