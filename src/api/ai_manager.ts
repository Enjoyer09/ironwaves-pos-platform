import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { Settings } from '../types/pos';
import { get_sales_summary } from './analytics';
import { getActiveTenantId } from '../lib/tenant';

const defaultTenant = () => getActiveTenantId();

export async function analyze_business(payload: { date_from: string; date_to: string; custom_question?: string; tenant_id?: string }) {
  const tenantId = payload.tenant_id || defaultTenant();
  // PII (Personal Identifiable Information) olmadan yalnız summary datası çəkilir
  const summary = get_sales_summary(tenantId, payload.date_from, payload.date_to);

  logEvent('system', 'AI_BUSINESS_ANALYSIS_REQUEST', { date_from: payload.date_from, date_to: payload.date_to });
  
  // Gemini API Simulyasiyası
  return Promise.resolve(`AI Analizi: Bu period ərzində ümumi gəlir ${summary.total_revenue}₼ təşkil edib. Qazancınız ${summary.gross_profit}₼-dir. ${payload.custom_question ? '\nSualınıza cavab: Bu məlumatlara əsasən həftəsonu kampaniyalarına diqqət yetirməyiniz məsləhətdir.' : ''}`);
}

export async function security_audit(payload: { date_from: string; date_to: string; question?: string }) {
  logEvent('system', 'AI_SECURITY_AUDIT_REQUEST', { date_from: payload.date_from, date_to: payload.date_to });

  // Gemini API Simulyasiyası
  return Promise.resolve(`AI Təhlükəsizlik Auditi: Loglar analiz edildi. Qeyri-adi 'VOIDED' (satış ləğvi) və ya gecə saatlarında kassa əməliyyatları tapılmadı. Sistem təhlükəsizdir.`);
}

export async function inventory_audit(tenant_id: string = defaultTenant()) {
  logEvent('system', 'AI_INVENTORY_AUDIT_REQUEST', { tenant_id });

  // Gemini API Simulyasiyası
  return Promise.resolve(`AI Anbar Auditi: "Süd" və "Kofe dənəsi" üçün stok səviyyəsi minimum həddə yaxınlaşır. Yaxın 2 gün ərzində mədaxil etməyiniz şiddətlə tövsiyə olunur.`);
}

export function update_api_key(api_key: string) {
  const tenantId = defaultTenant();
  let settingsArr = getDB<Settings>('settings');
  let tenantSettings = settingsArr.find((s) => s.tenant_id === tenantId);
  
  if (!tenantSettings) {
    // İlkin yaradılış əgər boşdursa
    tenantSettings = {
      tenant_id: tenantId,
      service_fee_percent: 0,
      ui_visibility: { staff_show_tables: true, manager_show_tables: true, staff_show_kitchen: true },
      time_settings: { shift_start_time: '08:00', shift_end_time: '23:00', utc_offset: 4, timezone: 'Asia/Baku' },
      email_settings: { resend_api_key: '', sender_email: '', recipient_emails: [] },
      bank_commission: { min_amount: 0.10, percent: 1.5 }
    } as Settings;
    settingsArr.push(tenantSettings);
  }

  tenantSettings.gemini_api_key = api_key;
  setDB('settings', settingsArr);

  logEvent('admin', 'API_KEY_UPDATED', { tenant_id: tenantId });
  return { success: true };
}
