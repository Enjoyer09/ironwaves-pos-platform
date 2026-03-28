import JSZip from 'jszip';
import { v4 as uuidv4 } from 'uuid';
import * as QRCode from 'qrcode';
import { logEvent } from '../lib/logger';
import { getDB, setDB } from '../lib/db_sim';
import { apiRequest, isBackendEnabled } from './client';
import { get_settings } from './settings';

const TIER_CONFIG: Record<string, { type: string; discount: number }> = {
  golden: { type: 'Golden', discount: 5 },
  platinum: { type: 'Platinum', discount: 10 },
  elite: { type: 'Elite', discount: 20 },
  thermos: { type: 'Thermos', discount: 20 },
  ikram: { type: 'Ikram', discount: 100 },
  telebe: { type: 'Tələbə', discount: 15 },
};

export async function generate_qr_codes(tenant_id: string, count: number, customer_type: string, discount_percent: number = 0) {
  const tier = TIER_CONFIG[customer_type.toLowerCase()] || { type: customer_type, discount: discount_percent };
  const appliedDiscount = discount_percent > 0 ? discount_percent : tier.discount;
  const db = getDB<any>(`${tenant_id}_customers`) || [];
  
  const zip = new JSZip();
  const folder = zip.folder("qr_codes");
  const configuredBase = String(get_settings(tenant_id).qr_settings?.base_url || '').trim();
  const qrBaseUrl = (configuredBase || window.location.origin).replace(/\/+$/, '');

  const newCustomers = isBackendEnabled()
    ? await apiRequest<any[]>('/api/v1/ops/customers/qr-batch', {
        method: 'POST',
        tenantId: null,
        body: { count, customer_type: tier.type, discount_percent: appliedDiscount },
      })
    : [];

  if (!isBackendEnabled()) {
    for (let i = 0; i < count; i++) {
      const card_id = `QR-${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`;
      const secret_token = uuidv4();
      const customer = {
        id: uuidv4(),
        tenant_id,
        card_id,
        secret_token,
        type: tier.type,
        discount_percent: appliedDiscount,
        stars: 0,
        created_at: new Date().toISOString()
      };
      newCustomers.push(customer);
      db.push(customer);
    }
  }

  for (const customer of newCustomers) {
    const card_id = customer.card_id;
    const secret_token = customer.secret_token;

    // Gerçək QR kodunu yaradırıq (DataURL olaraq)
    const url = `${qrBaseUrl}/?id=${encodeURIComponent(card_id)}&t=${encodeURIComponent(secret_token)}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });
    
    // DataURL-dən ancaq Base64 datanı ayırırıq
    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, "");

    // PNG faylını (QR şəklini) və izahlı məlumat faylını ZIP-ə əlavə edirik
    folder?.file(`${card_id}.png`, base64Data, { base64: true });
    folder?.file(`${card_id}_info.txt`, `Card ID: ${card_id}\nToken: ${secret_token}\nURL: ${url}`);
  }

  if (!isBackendEnabled()) {
    setDB(`${tenant_id}_customers`, db);
  }
  logEvent('System', 'QR_GENERATED', { count, type: tier.type, discount_percent: appliedDiscount });

  // Browser download trick
  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `QR_Codes_${tier.type}_${count}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  return newCustomers;
}
