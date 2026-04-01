import React, { useMemo, useState } from 'react';
import {
  analyze_business,
  generate_campaign_writer,
  generate_finance_insight,
  generate_shift_summary,
  generate_stock_forecast,
  inventory_audit,
  security_audit,
  type AiInsightResult,
  update_api_key,
} from '../../api/ai_manager';
import { update_api_key_live } from '../../api/settings';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { readScopedStorage, writeScopedStorage } from '../../lib/storage_keys';
import { Bot, Clipboard, Loader2, PackageSearch, ShieldAlert, Sparkles, TrendingUp, WalletCards } from 'lucide-react';

type AiWorkspace = 'shift' | 'finance' | 'stock' | 'campaign' | 'security';

const toLocalDate = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function AIManagerPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [workspace, setWorkspace] = useState<AiWorkspace>('shift');
  const [apiKey, setApiKey] = useState(readScopedStorage('gemini_api_key') || '');
  const [loading, setLoading] = useState(false);
  const [auditWindow, setAuditWindow] = useState<'7' | '30' | '90'>('30');
  const [focus, setFocus] = useState('');
  const [campaignGoal, setCampaignGoal] = useState('');
  const [customReport, setCustomReport] = useState<string | null>(null);
  const [structuredResult, setStructuredResult] = useState<AiInsightResult | null>(null);

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
    writeScopedStorage('gemini_api_key', apiKey);
    update_api_key(apiKey);
    void update_api_key_live(apiKey);
    notify('success', tx(lang, 'API Key yadda saxlanıldı!', 'API ключ сохранен!', 'API key saved'));
  };

  const runWorkspace = async (nextWorkspace: AiWorkspace = workspace) => {
    setLoading(true);
    setWorkspace(nextWorkspace);
    setStructuredResult(null);
    setCustomReport(null);
    try {
      if (nextWorkspace === 'shift') {
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

  const workspaceCards: Array<{
    key: AiWorkspace;
    title: string;
    description: string;
    icon: React.ReactNode;
    accent: string;
  }> = [
    {
      key: 'shift',
      title: tx(lang, 'Shift Summary', 'Сводка смены', 'Shift Summary'),
      description: tx(lang, 'Satış, kassir və top məhsullar üzrə qısa operativ xülasə.', 'Короткая оперативная сводка по продажам, кассирам и топ-продуктам.', 'A short operations summary for sales, cashiers, and top products.'),
      icon: <TrendingUp size={22} />,
      accent: 'border-emerald-400/50 bg-emerald-500/10',
    },
    {
      key: 'finance',
      title: tx(lang, 'Finance Insight', 'Финансовый insight', 'Finance Insight'),
      description: tx(lang, 'Cash, card, safe və investor axınını bir baxışda izah edir.', 'Объясняет cash, card, safe и investor потоки в одном обзоре.', 'Explains cash, card, safe, and investor flows in one view.'),
      icon: <WalletCards size={22} />,
      accent: 'border-sky-400/50 bg-sky-500/10',
    },
    {
      key: 'stock',
      title: tx(lang, 'Stock Forecast', 'Прогноз склада', 'Stock Forecast'),
      description: tx(lang, 'Kritik stok və hərəkətli məhsullar üçün preventiv siqnallar.', 'Превентивные сигналы для критического склада и быстрых товаров.', 'Preventive signals for critical stock and fast-moving items.'),
      icon: <PackageSearch size={22} />,
      accent: 'border-amber-400/50 bg-amber-500/10',
    },
    {
      key: 'campaign',
      title: tx(lang, 'CRM Campaign Writer', 'Генератор CRM кампаний', 'CRM Campaign Writer'),
      description: tx(lang, 'Müştəri bazası və loyalty modelinə uyğun kampaniya mətni yazır.', 'Пишет кампанию под клиентскую базу и loyalty модель.', 'Writes campaigns fitted to your customer base and loyalty model.'),
      icon: <Sparkles size={22} />,
      accent: 'border-fuchsia-400/50 bg-fuchsia-500/10',
    },
    {
      key: 'security',
      title: tx(lang, 'Security Audit', 'Аудит безопасности', 'Security Audit'),
      description: tx(lang, 'VOID və yüksək endirim hərəkətlərini qısa risk dilində çıxarır.', 'Показывает VOID и высокие скидки в кратком risk формате.', 'Highlights VOIDs and large discounts in a compact risk format.'),
      icon: <ShieldAlert size={22} />,
      accent: 'border-rose-400/50 bg-rose-500/10',
    },
  ];

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
              'AI burada dekor deyil. Növbə, maliyyə, anbar və CRM üçün operativ qərar dəstəyi verir.',
              'AI здесь не для декора. Он помогает с оперативными решениями по смене, финансам, складу и CRM.',
              'AI here is not decorative. It provides operational decision support for shift, finance, stock, and CRM.'
            )}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={copyResult} className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-cyan-300/50">
            <span className="inline-flex items-center gap-2"><Clipboard size={16} /> {tx(lang, 'Kopyala', 'Копировать', 'Copy')}</span>
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
            <label className="mb-1 block text-sm font-semibold text-slate-300">Gemini API Key</label>
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="neon-input"
              />
              <button onClick={saveApiKey} className="glossy-gold rounded-xl px-5 py-3 text-sm font-bold">
                {tx(lang, 'Yadda Saxla', 'Сохранить', 'Save')}
              </button>
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

      <div className="grid gap-4 xl:grid-cols-5">
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
              <p>{tx(lang, 'Ən əvvəl növbə, maliyyə, stok və CRM təsiri olan modullar önə çıxmalıdır.', 'Сначала должны идти модули со влиянием на смену, финансы, склад и CRM.', 'Shift, finance, stock, and CRM impact modules should come first.')}</p>
              <p>{tx(lang, 'Bu panelin məntiqi də elə quruldu: əvvəl operativ dəyər, sonra dərin audit.', 'Логика панели построена так же: сначала операционная ценность, потом глубокий аудит.', 'This panel is designed the same way: operational value first, deeper audits second.')}</p>
            </div>
          </div>

          <div className="metal-panel rounded-2xl border border-slate-700/70 p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Növbəti AI addımları', 'Следующие AI шаги', 'Next AI steps')}</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              {[
                tx(lang, 'AI nəticələrini Dashboard kartlarına da çıxaraq.', 'Выведем AI результаты прямо в карточки Dashboard.', 'Surface AI results directly on Dashboard cards.'),
                tx(lang, 'CRM kampaniyasını bir kliklə CRM panelinə ötürək.', 'Передадим CRM кампанию в CRM панель в один клик.', 'Send the CRM campaign into the CRM panel in one click.'),
                tx(lang, 'Stock forecast üçün həftəlik avtomatik xəbərdarlıq quraq.', 'Добавим еженедельное авто-предупреждение по stock forecast.', 'Add a weekly auto-alert for stock forecast.'),
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
