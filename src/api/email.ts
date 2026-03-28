import { apiRequest, isBackendEnabled } from './client';
import { get_settings } from './settings';

type SendEmailArgs = {
  tenant_id: string;
  subject: string;
  html: string;
  recipients?: string[];
  attachments?: Array<{ filename: string; content: string; type?: string }>;
};

export async function send_email(args: SendEmailArgs): Promise<{ success: boolean; message: string }> {
  if (isBackendEnabled()) {
    return apiRequest<{ success: boolean; message: string }>('/api/v1/ops/emails/send', {
      method: 'POST',
      tenantId: null,
      body: {
        subject: args.subject,
        html: args.html,
        recipients: args.recipients || undefined,
      },
    });
  }

  const settings = get_settings(args.tenant_id);
  const cfg = settings.email_settings;
  if (!cfg?.enabled || cfg.provider === 'none') {
    return { success: false, message: 'Email provider disabled' };
  }

  const timeoutMs = Math.max(5000, Number(cfg.timeout_sec || 15) * 1000);

  if (cfg.provider === 'webhook') {
    if (!cfg.webhook_url) return { success: false, message: 'Webhook URL is empty' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: cfg.recipient_emails,
          from: cfg.sender_email,
          subject: args.subject,
          html: args.html,
          attachments: args.attachments || [],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return { success: false, message: `Webhook failed: ${res.status}` };
      return { success: true, message: 'Webhook sent' };
    } catch (e: any) {
      clearTimeout(timer);
      return { success: false, message: e?.message || 'Webhook error' };
    }
  }

  // Resend direct API.
  if (!cfg.resend_api_key || !cfg.sender_email || !cfg.recipient_emails?.length) {
    return { success: false, message: 'Resend config incomplete' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.resend_api_key}`,
      },
      body: JSON.stringify({
        from: cfg.sender_email,
        to: cfg.recipient_emails,
        subject: args.subject,
        html: args.html,
        attachments: args.attachments || [],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const txt = await res.text();
      return { success: false, message: `Resend failed: ${res.status} ${txt}` };
    }
    return { success: true, message: 'Resend sent' };
  } catch (e: any) {
    clearTimeout(timer);
    return { success: false, message: e?.message || 'Resend error' };
  }
}
