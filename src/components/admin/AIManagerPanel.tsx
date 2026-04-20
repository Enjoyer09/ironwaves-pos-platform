import React, { useMemo, useState } from 'react';
import {
  analyze_business,
  generate_campaign_writer,
  generate_finance_insight,
  generate_ai_insight_engine,
  generate_shift_summary,
  generate_stock_forecast,
  inventory_audit,
  security_audit,
  type AiDecisionInsight,
  type AiInsightResult,
  update_api_key,
} from '../../api/ai_manager';
import { update_api_key_live } from '../../api/settings';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { readScopedStorage, writeScopedStorage } from '../../lib/storage_keys';
import { Bot, Clipboard, Loader2, PackageSearch, ShieldAlert, Sparkles, TrendingUp, WalletCards } from 'lucide-react';
import { send_email } from '../../api/email';
import { DEFAULT_MODEL_BY_PROVIDER, detectAiConfigFromApiKey, providerLabel } from '../../lib/ai_config';

type AiWorkspace = 'copilot' | 'shift' | 'finance' | 'stock' | 'campaign' | 'security';

const toLocalDate = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function AIManagerPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [workspace, setWorkspace] = useState<AiWorkspace>('copilot');
  const [apiKey, setApiKey] = useState(readScopedStorage('gemini_api_key') || '');
  const detection = useMemo(() => detectAiConfigFromApiKey(apiKey), [apiKey]);
  const [modelOverride, setModelOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [auditWindow, setAuditWindow] = useState<'7' | '30' | '90'>('30');
  const [focus, setFocus] = useState('');
  const [campaignGoal, setCampaignGoal] = useState('');
  const [customReport, setCustomReport] = useState<string | null>(null);
  const [structuredResult, setStructuredResult] = useState<AiInsightResult | null>(null);
  const [decisionInsights, setDecisionInsights] = useState<AiDecisionInsight[]>([]);
  const [digestSending, setDigestSending] = useState(false);

  const pushCampaignToCrm = () => {
    if (!structuredResult || structuredResult.kind !== 'campaign') return;
    const narrativeLines = String(structuredResult.narrative || '').split('\n');
    const subjectLine = narrativeLines.find((line) => line.startsWith('Subject:'));
    const bodyLine = narrativeLines.find((line) => line.startsWith('Body:'));
    const payload = {
      subject: subjectLine ? subjectLine.replace(/^Subject:\s*/, '').trim() : tx(lang, 'AI CRM Kampaniyası', 'AI CRM кампания', 'AI CRM Campaign'),
      body: bodyLine ? bodyLine.replace(/^Body:\s*/, '').trim() : structuredResult.summary,
    };
    writeScopedStorage('ai_campaign_draft', JSON.stringify(payload));
    try {
      window.dispatchEvent(new CustomEvent('ai-campaign-draft', { detail: payload }));
    } catch {
      // ignore browser event issues
    }
    notify('success', tx(lang, 'AI kampaniya mətni CRM moduluna göndərildi', 'AI кампания отправлена в CRM модуль', 'AI campaign draft sent to CRM'));
  };

  const range = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Number(auditWindow));
    return {
      date_from: `${toLocalDate(start)}T00:00:00.000Z`,
      date_to: `${toLocalDate(end)}T23:59:59.999Z`,
    };
  }, [auditWindow]);

  const saveApiKey = () => {
    const detectedModel = modelOverride.trim() || detection.model || DEFAULT_MODEL_BY_PROVIDER[detection.provider];
    writeScopedStorage('gemini_api_key', apiKey);
    update_api_key(apiKey);
    void update_api_key_live(apiKey, {
      provider: detection.provider,
      model: detectedModel,
      autodetected: !modelOverride.trim(),
    });
    notify('success', tx(lang, 'API Key yadda saxlanıldı!', 'API ключ сохранен!', 'API key saved'));
  };

  const refreshDecisionEngine = (maxItems = 12) => {
    const insights = generate_ai_insight_engine({ tenant_id, ...range, max_items: maxItems });
    setDecisionInsights(insights);
    return insights;
  };

  React.useEffect(() => {
    refreshDecisionEngine();
  }, [tenant_id, range.date_from, range.date_to]);

  const runWorkspace = async (nextWorkspace: AiWorkspace = workspace) => {
    setLoading(true);
    setWorkspace(nextWorkspace);
    setStructuredResult(null);
    setCustomReport(null);
    try {
      if (nextWorkspace === 'copilot') {
        refreshDecisionEngine();
      } else if (nextWorkspace === 'shift') {
        const result = await generate_shift_summary({ tenant_id, ...range, focus });
        setStructuredResult(result);
      } else if (nextWorkspace === 'finance') {
        const result = await generate_finance_insight({ tenant_id, ...range, focus });
        setStructuredResult(result);
      } else if (nextWorkspace === 'stock') {
        const result = await generate_stock_forecast({ tenant_id, ...range, focus });
        setStructuredResult(result);
      } else if (nextWorkspace === 'campaign') {
        const result = await generate_campaign_writer({ tenant_id, goal: campaignGoal, focus });
        setStructuredResult(result);
      } else if (nextWorkspace === 'security') {
        const report = await security_audit({ tenant_id, ...range, question: focus });
        setCustomReport(report);
      }
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'AI hesabatı yaradılmadı', 'AI отчет не создан', 'AI report could not be generated'));
    } finally {
      setLoading(false);
    }
  };

  const runClassicBusinessAudit = async () => {
    setLoading(true);
    setStructuredResult(null);
    setCustomReport(null);
    try {
      const report = await analyze_business({ tenant_id, ...range, custom_question: focus });
      setCustomReport(report);
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Biznes analizi alınmadı', 'Анализ бизнеса не получен', 'Business analysis failed'));
    } finally {
      setLoading(false);
    }
  };

  const runInventoryAudit = async () => {
    setLoading(true);
    setStructuredResult(null);
    setCustomReport(null);
    try {
      const report = await inventory_audit(tenant_id);
      setCustomReport(report);
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Anbar auditi alınmadı', 'Аудит склада не получен', 'Inventory audit failed'));
    } finally {
      setLoading(false);
    }
  };

  const copyResult = async () => {
    const text = structuredResult
      ? [structuredResult.summary, '', structuredResult.narrative, '', structuredResult.actions.map((row) => `• ${row}`).join('\n')].join('\n')
      : customReport || '';
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      notify('success', tx(lang, 'AI nəticəsi kopyalandı', 'AI результат скопирован', 'AI result copied'));
    } catch {
      notify('error', tx(lang, 'Kopyalama alınmadı', 'Копирование не удалось', 'Copy failed'));
    }
  };

  const sendDailyDigest = async () => {
    setDigestSending(true);
    try {
      const [shift, finance, stock] = await Promise.all([
        generate_shift_summary({ tenant_id, ...range, focus }),
        generate_finance_insight({ tenant_id, ...range, focus }),
        generate_stock_forecast({ tenant_id, ...range, focus }),
      ]);

      const renderCard = (result: AiInsightResult) => `
        <div style="border:1px solid #1e293b;border-radius:16px;padding:16px;margin-bottom:16px;background:#0f172a;color:#e2e8f0;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;font-weight:700;">${result.title}</div>
          <div style="margin-top:10px;font-size:15px;line-height:1.7;">${result.summary}</div>
          <div style="margin-top:12px;padding:12px;border-radius:12px;background:#111827;color:#f8fafc;font-weight:600;">${result.actions[0] || ''}</div>
          <div style="margin-top:12px;font-size:13px;line-height:1.7;color:#cbd5e1;white-space:pre-line;">${result.narrative}</div>
        </div>
      `;

      const html = `
        <div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#020617;padding:24px;color:#e2e8f0;">
          <div style="max-width:760px;margin:0 auto;">
            <div style="margin-bottom:18px;">
              <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#67e8f9;font-weight:800;">AI Daily Digest</div>
              <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;color:#f8fafc;">${tx(lang, 'Günlük operativ AI xülasəsi', 'Ежедневная AI сводка', 'Daily AI operations digest')}</h1>
              <p style="margin:10px 0 0;color:#94a3b8;font-size:14px;">${new Date().toLocaleString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ')}</p>
            </div>
            ${renderCard(shift)}
            ${renderCard(finance)}
            ${renderCard(stock)}
          </div>
        </div>
      `;

      const result = await send_email({
        tenant_id,
        subject: tx(lang, 'AI Günlük Xülasə', 'AI ежедневная сводка', 'AI Daily Digest'),
        html,
      });
      notify(result.success ? 'success' : 'error', result.message);
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'AI daily digest göndərilmədi', 'AI daily digest не отправлен', 'AI daily digest failed'));
    } finally {
      setDigestSending(false);
    }
  };

  const workspaceCards: Array<{
    key: AiWorkspace;
    title: string;
    description: string;
    icon: React.ReactNode;
    accent: string;
  }> = [
    {
      key: 'copilot',
      title: tx(lang, 'AI Komanda Mərkəzi', 'AI командный центр', 'AI Command Center'),
      description: tx(lang, 'API key olmadan satış, kassa, mətbəx, anbar və CRM siqnallarını prioritetləşdirir.', 'Без API key приоритизирует продажи, кассу, кухню, склад и CRM сигналы.', 'Prioritizes sales, cash, kitchen, stock, and CRM signals without an API key.'),
      icon: <Bot size={22} />,
      accent: 'border-cyan-400/50 bg-cyan-500/10',
    },
    {
      key: 'shift',
      title: tx(lang, 'Növbə xülasəsi', 'Сводка смены', 'Shift Summary'),
      description: tx(lang, 'Satış, kassir və top məhsullar üzrə qısa operativ xülasə.', 'Короткая оперативная сводка по продажам, кассирам и топ-продуктам.', 'A short operations summary for sales, cashiers, and top products.'),
      icon: <TrendingUp size={22} />,
      accent: 'border-emerald-400/50 bg-emerald-500/10',
    },
    {
      key: 'finance',
      title: tx(lang, 'Maliyyə insight', 'Финансовый insight', 'Finance Insight'),
      description: tx(lang, 'Cash, card, safe və investor axınını bir baxışda izah edir.', 'Объясняет cash, card, safe и investor потоки в одном обзоре.', 'Explains cash, card, safe, and investor flows in one view.'),
      icon: <WalletCards size={22} />,
      accent: 'border-sky-400/50 bg-sky-500/10',
    },
    {
      key: 'stock',
      title: tx(lang, 'Stok proqnozu', 'Прогноз склада', 'Stock Forecast'),
      description: tx(lang, 'Kritik stok və hərəkətli məhsullar üçün preventiv siqnallar.', 'Превентивные сигналы для критического склада и быстрых товаров.', 'Preventive signals for critical stock and fast-moving items.'),
      icon: <PackageSearch size={22} />,
      accent: 'border-amber-400/50 bg-amber-500/10',
    },
    {
      key: 'campaign',
      title: tx(lang, 'CRM kampaniya yazarı', 'Генератор CRM кампаний', 'CRM Campaign Writer'),
      description: tx(lang, 'Müştəri bazası və loyalty modelinə uyğun kampaniya mətni yazır.', 'Пишет кампанию под клиентскую базу и loyalty модель.', 'Writes campaigns fitted to your customer base and loyalty model.'),
      icon: <Sparkles size={22} />,
      accent: 'border-fuchsia-400/50 bg-fuchsia-500/10',
    },
    {
      key: 'security',
      title: tx(lang, 'Təhlükəsizlik auditi', 'Аудит безопасности', 'Security Audit'),
      description: tx(lang, 'VOID və yüksək endirim hərəkətlərini qısa risk dilində çıxarır.', 'Показывает VOID и высокие скидки в кратком risk формате.', 'Highlights VOIDs and large discounts in a compact risk format.'),
      icon: <ShieldAlert size={22} />,
      accent: 'border-rose-400/50 bg-rose-500/10',
    },
  ];

  const severityTone = (severity: AiDecisionInsight['severity']) => {
    if (severity === 'critical') return 'border-rose-400/45 bg-rose-500/10 text-rose-100';
    if (severity === 'warning') return 'border-amber-400/45 bg-amber-500/10 text-amber-100';
    if (severity === 'opportunity') return 'border-cyan-400/45 bg-cyan-500/10 text-cyan-100';
    if (severity === 'good') return 'border-emerald-400/45 bg-emerald-500/10 text-emerald-100';
    return 'border-slate-600 bg-slate-900/50 text-slate-100';
  };

  const phaseLabel = (phase: AiDecisionInsight['phase']) => {
    const labels: Record<AiDecisionInsight['phase'], string> = {
      manager: tx(lang, 'Menecer', 'Менеджер', 'Manager'),
      anomaly: tx(lang, 'Risk', 'Риск', 'Risk'),
      finance: tx(lang, 'Maliyyə', 'Финансы', 'Finance'),
      inventory: tx(lang, 'Anbar', 'Склад', 'Inventory'),
      sales: tx(lang, 'Satış', 'Продажи', 'Sales'),
    };
    return labels[phase];
  };

  return (
    <div className="space-y-6 text-slate-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-wide text-slate-100">
            <Bot className="text-cyan-300" size={30} />
            {tx(lang, 'AI Menecer', 'AI менеджер', 'AI Manager')}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            {tx(
              lang,
              'AI burada dekor deyil. Növbə, maliyyə, anbar, mətbəx və CRM üçün operativ qərar dəstəyi verir.',
              'AI здесь не для декора. Он помогает с оперативными решениями по смене, финансам, складу и CRM.',
              'AI here is not decorative. It provides operational decision support for shift, finance, stock, and CRM.'
            )}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={copyResult} className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-cyan-300/50">
            <span className="inline-flex items-center gap-2"><Clipboard size={16} /> {tx(lang, 'Kopyala', 'Копировать', 'Copy')}</span>
          </button>
          <button
            onClick={() => { void sendDailyDigest(); }}
            disabled={digestSending}
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60"
          >
            {digestSending ? tx(lang, 'Digest göndərilir...', 'Digest отправляется...', 'Sending digest...') : tx(lang, 'Daily Digest göndər', 'Отправить daily digest', 'Send daily digest')}
          </button>
          {structuredResult?.kind === 'campaign' && (
            <button onClick={pushCampaignToCrm} className="rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/10 px-4 py-2 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-500/20">
              {tx(lang, 'CRM-ə ötür', 'Передать в CRM', 'Send to CRM')}
            </button>
          )}
        </div>
      </div>

      <div className="metal-panel rounded-2xl border border-slate-700/70 p-5">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-300">{tx(lang, 'AI API Key', 'AI API ключ', 'AI API Key')}</label>
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={tx(lang, 'API key daxil edin', 'Введите API key', 'Enter API key')}
                className="neon-input"
              />
              <button onClick={saveApiKey} className="glossy-gold rounded-xl px-5 py-3 text-sm font-bold">
                {tx(lang, 'Yadda Saxla', 'Сохранить', 'Save')}
              </button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{tx(lang, 'Provider', 'Провайдер', 'Provider')}</div>
                <div className="mt-1 font-semibold text-slate-100">{providerLabel(detection.provider)}</div>
              </div>
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{tx(lang, 'Model', 'Модель', 'Model')}</div>
                <div className="mt-1 font-semibold text-slate-100">{modelOverride.trim() || detection.model}</div>
              </div>
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{tx(lang, 'Aşkarlama', 'Детект', 'Detection')}</div>
                <div className="mt-1 font-semibold text-slate-100">{detection.confidence.toUpperCase()}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-400">{detection.reason}</div>
            <div className="mt-2">
              <input
                value={modelOverride}
                onChange={(e) => setModelOverride(e.target.value)}
                placeholder={tx(lang, 'Model override (opsional)', 'Model override (опционально)', 'Model override (optional)')}
                className="neon-input"
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-300">
              {tx(lang, 'Audit pəncərəsi', 'Окно аудита', 'Audit window')}
              <select className="neon-input mt-1" value={auditWindow} onChange={(e) => setAuditWindow(e.target.value as '7' | '30' | '90')}>
                <option value="7">{tx(lang, 'Son 7 gün', 'Последние 7 дней', 'Last 7 days')}</option>
                <option value="30">{tx(lang, 'Son 30 gün', 'Последние 30 дней', 'Last 30 days')}</option>
                <option value="90">{tx(lang, 'Son 90 gün', 'Последние 90 дней', 'Last 90 days')}</option>
              </select>
            </label>
            <label className="text-sm text-slate-300">
              {tx(lang, 'Əlavə fokus', 'Дополнительный фокус', 'Additional focus')}
              <input
                className="neon-input mt-1"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder={tx(lang, 'Məs: zəif saatları tap', 'Напр.: найти слабые часы', 'Example: find weak hours')}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {workspaceCards.map((card) => (
          <button
            key={card.key}
            onClick={() => { void runWorkspace(card.key); }}
            className={`rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5 ${workspace === card.key ? card.accent : 'border-slate-700/70 bg-slate-900/35 hover:border-slate-500/70'}`}
          >
            <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-white/5 p-3 text-slate-100">
              {card.icon}
            </div>
            <h3 className="text-base font-bold text-slate-100">{card.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{card.description}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="metal-panel rounded-2xl border border-slate-700/70 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'AI İş Sahəsi', 'AI рабочая зона', 'AI Workspace')}</h2>
              <p className="mt-1 text-sm text-slate-400">{tx(lang, 'Ən faydalı AI modullarını bir yerdə işlədir.', 'Самые полезные AI модули в одном месте.', 'Runs the most valuable AI modules in one place.')}</p>
            </div>
            {loading && <Loader2 className="animate-spin text-cyan-300" size={20} />}
          </div>

          {workspace === 'campaign' && (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-semibold text-slate-300">{tx(lang, 'Kampaniya məqsədi', 'Цель кампании', 'Campaign goal')}</label>
              <input
                className="neon-input"
                value={campaignGoal}
                onChange={(e) => setCampaignGoal(e.target.value)}
                placeholder={tx(lang, 'Məs: zəif müştərini geri qaytar', 'Напр.: вернуть слабого клиента', 'Example: win back inactive customers')}
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => { void runWorkspace(workspace); }} className="glossy-gold rounded-xl px-5 py-3 text-sm font-bold">
              {tx(lang, 'AI Hesabatı Yarat', 'Сгенерировать AI отчет', 'Generate AI Report')}
            </button>
            <button onClick={() => { void runClassicBusinessAudit(); }} className="rounded-xl border border-slate-700 bg-slate-900/50 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-cyan-300/40">
              {tx(lang, 'Klassik Biznes Analizi', 'Классический бизнес-анализ', 'Classic Business Analysis')}
            </button>
            <button onClick={() => { void runInventoryAudit(); }} className="rounded-xl border border-slate-700 bg-slate-900/50 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-cyan-300/40">
              {tx(lang, 'Klassik Anbar Auditi', 'Классический аудит склада', 'Classic Inventory Audit')}
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
            {loading ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-slate-400">
                <Loader2 size={40} className="animate-spin text-cyan-300" />
                <p>{tx(lang, 'AI data toplayır və operativ insight hazırlayır...', 'AI собирает данные и готовит insight...', 'AI is collecting data and preparing insights...')}</p>
              </div>
            ) : workspace === 'copilot' ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h3 className="text-2xl font-black text-slate-100">{tx(lang, 'AI Komanda Mərkəzi', 'AI командный центр', 'AI Command Center')}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      {tx(
                        lang,
                        'Phase 1-5: menecer baxışı, anomaly detector, finance auditor, inventory forecast və satış/CRM tövsiyələri bir prioritet siyahısında.',
                        'Phase 1-5: менеджерский обзор, anomaly detector, finance auditor, inventory forecast и sales/CRM рекомендации в одном списке.',
                        'Phase 1-5: manager view, anomaly detector, finance auditor, inventory forecast, and sales/CRM recommendations in one priority list.',
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => refreshDecisionEngine()}
                    className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20"
                  >
                    {tx(lang, 'Yenidən analiz et', 'Анализировать снова', 'Analyze again')}
                  </button>
                </div>

                <div className="grid gap-4">
                  {decisionInsights.map((insight) => (
                    <div key={insight.id} className={`rounded-2xl border p-4 ${severityTone(insight.severity)}`}>
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em]">
                              {phaseLabel(insight.phase)}
                            </span>
                            {insight.metric && (
                              <span className="rounded-full bg-black/20 px-2.5 py-1 text-xs font-bold">{insight.metric}</span>
                            )}
                          </div>
                          <h4 className="mt-3 text-lg font-black text-white">{insight.title}</h4>
                          <p className="mt-2 text-sm leading-6 text-slate-200">{insight.body}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-center">
                          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{tx(lang, 'Prioritet', 'Приоритет', 'Priority')}</div>
                          <div className="mt-1 text-2xl font-black text-white">{insight.score}</div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                        <div className="flex flex-wrap gap-2">
                          {insight.evidence.slice(0, 4).map((item) => (
                            <span key={item} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-slate-200">
                              {item}
                            </span>
                          ))}
                        </div>
                        <span className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950">
                          {insight.action_label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : structuredResult ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-2xl font-black text-slate-100">{structuredResult.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{structuredResult.summary}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {structuredResult.highlights.map((item) => (
                    <div
                      key={item.label}
                      className={`rounded-2xl border p-4 ${
                        item.tone === 'warning'
                          ? 'border-amber-400/40 bg-amber-500/10'
                          : item.tone === 'good'
                            ? 'border-emerald-400/40 bg-emerald-500/10'
                            : 'border-slate-700/70 bg-slate-900/45'
                      }`}
                    >
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{item.label}</div>
                      <div className="mt-2 text-xl font-bold text-slate-100">{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-[0.22em] text-slate-400">{tx(lang, 'AI izahı', 'AI пояснение', 'AI narrative')}</h4>
                    <div className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-200">{structuredResult.narrative}</div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-[0.22em] text-slate-400">{tx(lang, 'Tövsiyə olunan addımlar', 'Рекомендуемые шаги', 'Recommended actions')}</h4>
                    <div className="mt-3 space-y-3">
                      {structuredResult.actions.map((item) => (
                        <div key={item} className="rounded-xl border border-slate-700/70 bg-slate-900/50 px-4 py-3 text-sm text-slate-200">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : customReport ? (
              <div className="min-h-[280px] whitespace-pre-line text-sm leading-7 text-slate-200">{customReport}</div>
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-slate-500">
                <Bot size={54} className="text-slate-600" />
                <p>{tx(lang, 'Yuxarıdan AI iş sahəsi seçin və hesabat yaradın.', 'Выберите AI рабочую зону выше и запустите отчет.', 'Choose an AI workspace above and generate a report.')}</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="metal-panel rounded-2xl border border-slate-700/70 p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Dünya standartı AI qaydası', 'Правило AI мирового уровня', 'World-standard AI rule')}</h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
              <p>{tx(lang, 'AI əyləncə üçün yox, qərar verməni sürətləndirmək üçün işləməlidir.', 'AI должен ускорять решения, а не просто развлекать.', 'AI should accelerate decision-making, not just entertain.')}</p>
              <p>{tx(lang, 'Ən əvvəl növbə, maliyyə, stok, mətbəx və CRM təsiri olan modullar önə çıxmalıdır.', 'Сначала должны идти модули со влиянием на смену, финансы, склад и CRM.', 'Shift, finance, stock, and CRM impact modules should come first.')}</p>
              <p>{tx(lang, 'Bu panelin məntiqi də elə quruldu: əvvəl operativ dəyər, sonra dərin audit.', 'Логика панели построена так же: сначала операционная ценность, потом глубокий аудит.', 'This panel is designed the same way: operational value first, deeper audits second.')}</p>
            </div>
          </div>

          <div className="metal-panel rounded-2xl border border-slate-700/70 p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Növbəti AI addımları', 'Следующие AI шаги', 'Next AI steps')}</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              {[
                tx(lang, 'AI Komanda Mərkəzi API key olmadan risk və fürsətləri prioritetləşdirir.', 'AI командный центр приоритизирует риски и возможности без API key.', 'AI Command Center prioritizes risks and opportunities without an API key.'),
                tx(lang, 'AI daily digest artıq email kimi göndərilə bilir.', 'AI daily digest теперь можно отправить по email.', 'AI daily digest can now be sent by email.'),
                tx(lang, 'CRM kampaniyası AI-dən bir kliklə CRM formuna ötürülür.', 'CRM кампания уже передается в CRM форму в один клик.', 'CRM campaign now flows into the CRM form in one click.'),
                tx(lang, 'Kritik stok üçün dashboard reminder artıq gündəlik görünür.', 'Dashboard reminder по критическому складу теперь ежедневный.', 'Critical stock dashboard reminder is now daily.'),
              ].map((item) => (
                <div key={item} className="rounded-xl border border-slate-700/70 bg-slate-900/45 px-4 py-3">{item}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
