import { useEffect, useMemo, useState } from 'react';
import { generate_qr_codes } from '../../api/qr_generator';
import { get_customers_live, get_reservation_guests_live, import_customers_live, type ReservationGuestRecord } from '../../api/crm';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { send_email } from '../../api/email';
import { readScopedStorage, removeScopedStorage } from '../../lib/storage_keys';

const QR_TYPES = [
  { value: 'golden', label_az: 'Golden (5%)', label_ru: 'Golden (5%)', discount: 5 },
  { value: 'platinum', label_az: 'Platinum (10%)', label_ru: 'Platinum (10%)', discount: 10 },
  { value: 'elite', label_az: 'Elite (20%)', label_ru: 'Elite (20%)', discount: 20 },
  { value: 'thermos', label_az: 'Thermos (20%)', label_ru: 'Thermos (20%)', discount: 20 },
  { value: 'ikram', label_az: 'Ikram (100%)', label_ru: 'Угощение (100%)', discount: 100 },
  { value: 'telebe', label_az: 'Tələbə (15%)', label_ru: 'Студент (15%)', discount: 15 },
];

export default function CRMPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [customers, setCustomers] = useState<any[]>([]);
  const [reservationGuests, setReservationGuests] = useState<ReservationGuestRecord[]>([]);
  const [guestSearch, setGuestSearch] = useState('');
  const [count, setCount] = useState(1);
  const [tier, setTier] = useState('golden');
  const [customType, setCustomType] = useState('');
  const [customDiscount, setCustomDiscount] = useState('0');
  const [loading, setLoading] = useState(false);
  const [importText, setImportText] = useState('');
  const [campaignRecipients, setCampaignRecipients] = useState('');
  const [campaignSubject, setCampaignSubject] = useState('');
  const [campaignBody, setCampaignBody] = useState('');
  const [aiDraftLoaded, setAiDraftLoaded] = useState(false);
  const [sendingAiDraft, setSendingAiDraft] = useState(false);

  const selectedTier = useMemo(() => QR_TYPES.find((t) => t.value === tier) || QR_TYPES[0], [tier]);
  const effectiveType = tier === '__custom__' ? customType.trim() : selectedTier.value;
  const effectiveDiscount = tier === '__custom__' ? Number(customDiscount || 0) : selectedTier.discount;
  const guestSummary = useMemo(() => ({
    total: reservationGuests.length,
    withPhone: reservationGuests.filter((row) => String(row.phone || '').trim()).length,
    upcoming: reservationGuests.filter((row) => row.next_reservation_at).length,
  }), [reservationGuests]);
  const filteredReservationGuests = useMemo(() => {
    const query = guestSearch.trim().toLowerCase();
    if (!query) return reservationGuests;
    return reservationGuests.filter((row) => (
      String(row.full_name || '').toLowerCase().includes(query)
      || String(row.phone || '').toLowerCase().includes(query)
      || String(row.email || '').toLowerCase().includes(query)
    ));
  }, [reservationGuests, guestSearch]);

  const loadData = async () => {
    const [cust, guests] = await Promise.all([
      get_customers_live(tenant_id),
      get_reservation_guests_live(tenant_id).catch(() => []),
    ]);
    setCustomers(cust || []);
    setReservationGuests(Array.isArray(guests) ? guests : []);
  };

  const onSendCampaign = async () => {
    const recipients = campaignRecipients.split(',').map((v) => v.trim()).filter(Boolean);
    if (!campaignSubject.trim() || !campaignBody.trim()) {
      notify('error', tx(lang, 'Email başlığı və mətni vacibdir', 'Тема и текст email обязательны', 'Email subject and body are required'));
      return;
    }
    try {
      const result = await send_email({
        tenant_id,
        subject: campaignSubject.trim(),
        html: `<div style="font-family:Arial,sans-serif;white-space:pre-line">${campaignBody.trim()}</div>`,
        recipients: recipients.length ? recipients : undefined,
      });
      notify(result.success ? 'success' : 'error', result.message);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Email göndərilmədi', 'Email не отправлен', 'Email was not sent'));
    }
  };

  const onSendAiDraftNow = async () => {
    if (!campaignSubject.trim() || !campaignBody.trim()) {
      notify('error', tx(lang, 'Əvvəl AI draft və ya manual mətn doldurun', 'Сначала заполните AI draft или вручную', 'Fill AI draft or manual copy first'));
      return;
    }
    setSendingAiDraft(true);
    try {
      await onSendCampaign();
      removeScopedStorage('ai_campaign_draft');
      setAiDraftLoaded(false);
    } finally {
      setSendingAiDraft(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [tenant_id]);

  useEffect(() => {
    const applyDraft = (payload?: { subject?: string; body?: string }) => {
      if (!payload) return;
      if (payload.subject) setCampaignSubject(String(payload.subject));
      if (payload.body) setCampaignBody(String(payload.body));
      setAiDraftLoaded(true);
    };

    try {
      const raw = readScopedStorage('ai_campaign_draft');
      if (raw) {
        applyDraft(JSON.parse(raw));
      }
    } catch {
      // ignore parse issues
    }

    const handleDraft = (event: Event) => {
      const detail = (event as CustomEvent<{ subject?: string; body?: string }>).detail;
      applyDraft(detail);
    };
    window.addEventListener('ai-campaign-draft', handleDraft as EventListener);
    return () => {
      window.removeEventListener('ai-campaign-draft', handleDraft as EventListener);
    };
  }, []);

  const onGenerate = async () => {
    if (count < 1 || count > 200) {
      notify('error', tx(lang, 'Say 1 ilə 200 arasında olmalıdır', 'Количество должно быть от 1 до 200'));
      return;
    }
    if (tier === '__custom__' && !customType.trim()) {
      notify('error', tx(lang, 'Custom tip yazın', 'Введите custom тип', 'Enter a custom type'));
      return;
    }
    setLoading(true);
    try {
      await generate_qr_codes(tenant_id, count, effectiveType || selectedTier.value, effectiveDiscount);
      loadData();
      notify('success', tx(lang, 'QR kodlar uğurla yaradıldı', 'QR-коды успешно созданы'));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'QR yaratma zamanı xəta', 'Ошибка при создании QR'));
    } finally {
      setLoading(false);
    }
  };

  const onImportLegacy = async () => {
    const rows = importText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [card_id, secret_token, type, stars, discount_percent] = line.split(',').map((part) => part?.trim() || '');
        return {
          card_id,
          secret_token,
          type: type || selectedTier.label_az.split(' ')[0],
          stars: Number(stars || 0),
          discount_percent: discount_percent || selectedTier.discount,
        };
      });

    try {
      const result = await import_customers_live(rows, tenant_id);
      notify('success', tx(
        lang,
        `${result.imported} yeni, ${result.updated} yenilənmiş QR müştəri köçürüldü`,
        `${result.imported} новых и ${result.updated} обновленных QR-клиентов импортировано`,
      ));
      setImportText('');
      void loadData();
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Legacy QR import xətası', 'Ошибка импорта legacy QR'));
    }
  };

  return (
    <div className="space-y-5 text-slate-100">
      <div className="metal-panel p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-black tracking-wide">{tx(lang, 'REZERVASİYA MÜŞTƏRİ BAZASI', 'БАЗА ГОСТЕЙ ПО БРОНЯМ', 'RESERVATION GUEST DATABASE')}</h2>
            <p className="mt-2 text-sm text-slate-300">
              {tx(
                lang,
                'Rezervasiya edən qonaqlar burada toplanır. Zəng etmək, xüsusi təklif hazırlamaq və geri qayıdan müştərini izləmək üçün istifadə edin.',
                'Здесь собираются гости, которые оформляли брони. Используйте для звонков, спецпредложений и отслеживания возвратных гостей.',
                'Guests who make reservations are collected here. Use this for calls, offers, and returning-guest tracking.',
              )}
            </p>
          </div>
          <input
            className="neon-input w-full md:max-w-xs"
            value={guestSearch}
            onChange={(e) => setGuestSearch(e.target.value)}
            placeholder={tx(lang, 'Ad, telefon və ya email ilə axtar', 'Поиск по имени, телефону или email', 'Search by name, phone, or email')}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{tx(lang, 'Bazada qonaq', 'Гостей в базе', 'Guests in database')}</div>
            <div className="mt-2 text-3xl font-black text-slate-50">{guestSummary.total}</div>
          </div>
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{tx(lang, 'Telefonu olanlar', 'С телефоном', 'With phone')}</div>
            <div className="mt-2 text-3xl font-black text-cyan-200">{guestSummary.withPhone}</div>
          </div>
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{tx(lang, 'Gələcək rezervi olanlar', 'С будущей бронью', 'With upcoming reservation')}</div>
            <div className="mt-2 text-3xl font-black text-amber-200">{guestSummary.upcoming}</div>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-700/70">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-700/70 bg-slate-900/50 text-slate-300">
              <tr>
                <th className="px-4 py-3">{tx(lang, 'Qonaq', 'Гость', 'Guest')}</th>
                <th className="px-4 py-3">{tx(lang, 'Əlaqə', 'Контакт', 'Contact')}</th>
                <th className="px-4 py-3">{tx(lang, 'Rezerv sayı', 'Кол-во броней', 'Reservation count')}</th>
                <th className="px-4 py-3">{tx(lang, 'Son rezerv', 'Последняя бронь', 'Last reservation')}</th>
                <th className="px-4 py-3">{tx(lang, 'Növbəti rezerv', 'Следующая бронь', 'Next reservation')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredReservationGuests.map((row) => (
                <tr key={row.id} className="border-t border-slate-700/50 align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-100">{row.full_name || tx(lang, 'Adsız qonaq', 'Гость без имени', 'Unnamed guest')}</div>
                    {row.notes ? <div className="mt-1 max-w-[280px] text-xs text-slate-400">{row.notes}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <div>{row.phone ? <a className="text-cyan-200 hover:underline" href={`tel:${row.phone}`}>{row.phone}</a> : <span className="text-slate-500">{tx(lang, 'Telefon yoxdur', 'Нет телефона', 'No phone')}</span>}</div>
                      <div>{row.email ? <a className="text-slate-300 hover:underline" href={`mailto:${row.email}`}>{row.email}</a> : <span className="text-slate-500">{tx(lang, 'Email yoxdur', 'Нет email', 'No email')}</span>}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-100">{row.reservation_count}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {tx(lang, 'Aktiv', 'Активные', 'Active')}: {row.active_count} • {tx(lang, 'Ləğv', 'Отмена', 'Cancelled')}: {row.cancelled_count}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {row.last_reservation_at ? new Date(row.last_reservation_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {row.next_reservation_at ? new Date(row.next_reservation_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ') : <span className="text-slate-500">{tx(lang, 'Plan yoxdur', 'Нет плана', 'No upcoming')}</span>}
                  </td>
                </tr>
              ))}
              {filteredReservationGuests.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    {tx(lang, 'Hələ rezervasiya müştəri bazası görünmür', 'База гостей по броням пока пуста', 'Reservation guest database is empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="metal-panel p-5">
        <h2 className="text-3xl font-black tracking-wide">{tx(lang, 'QR GENERATOR', 'ГЕНЕРАТОР QR')}</h2>
        <p className="mt-2 text-sm text-slate-300">{tx(lang, 'QR tipi POS və Maliyyə ilə sinxron işləyir. Müştərinin tipi satışdakı endirimə avtomatik tətbiq olunur.', 'Тип QR синхронизирован с POS и Финансами. Тип клиента автоматически влияет на скидку в продаже.')}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            {tx(lang, 'Say', 'Количество')}
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(Number(e.target.value || 1))}
              className="neon-input mt-1"
            />
          </label>
          <label className="text-sm text-slate-300">
            {tx(lang, 'Tip', 'Тип')}
            <select value={tier} onChange={(e) => setTier(e.target.value)} className="neon-input mt-1">
              {QR_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {lang === 'ru' ? item.label_ru : item.label_az}
                </option>
              ))}
              <option value="__custom__">{tx(lang, 'Custom', 'Custom', 'Custom')}</option>
            </select>
          </label>
        </div>
        {tier === '__custom__' && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-300">
              {tx(lang, 'Custom tip', 'Custom тип', 'Custom type')}
              <input className="neon-input mt-1" value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder="VIP / Corporate / Legacy" />
            </label>
            <label className="text-sm text-slate-300">
              {tx(lang, 'Custom endirim %', 'Custom скидка %', 'Custom discount %')}
              <input className="neon-input mt-1" type="number" min={0} max={100} value={customDiscount} onChange={(e) => setCustomDiscount(e.target.value)} />
            </label>
          </div>
        )}
        <button disabled={loading} onClick={onGenerate} className="glossy-gold mt-4 rounded-xl px-5 py-3 font-bold disabled:opacity-60">
          {loading ? tx(lang, 'Yaradılır...', 'Создается...') : tx(lang, 'QR Kodları Yarat', 'Создать QR-коды')}
        </button>
      </div>

      <div className="metal-panel p-5">
        <h3 className="text-xl font-bold text-slate-100">{tx(lang, 'Legacy QR Köçürmə', 'Импорт legacy QR', 'Legacy QR Import')}</h3>
        <p className="mt-2 text-sm text-slate-300">
          {tx(
            lang,
            'Hər sətrə belə yazın: kart_id,secret_token,tip,ulduz,endirim. Təkcə kart_id yazmaq da olar.',
            'Каждая строка: card_id,secret_token,тип,звезды,скидка. Можно указать только card_id.',
          )}
        </p>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          className="neon-input mt-3 min-h-36 w-full"
          placeholder={'QR-100001,abc123,Golden,12,5\nQR-100002'}
        />
        <button onClick={() => { void onImportLegacy(); }} className="glossy-gold mt-4 rounded-xl px-5 py-3 font-bold">
          {tx(lang, 'Legacy QR-ları Köçür', 'Импортировать legacy QR', 'Import Legacy QRs')}
        </button>
      </div>

      <div className="metal-panel p-5">
        <h3 className="text-xl font-bold text-slate-100">{tx(lang, 'CRM Email Kampaniyası', 'Email кампания CRM', 'CRM Email Campaign')}</h3>
        <p className="mt-2 text-sm text-slate-300">
          {tx(
            lang,
            'Burada manual alıcı email-ləri yazıb CRM kampaniyası göndərə bilərsiniz. Default recipient-lər Settings-dən də gəlir.',
            'Здесь можно вручную указать email получателей и отправить CRM кампанию. Получатели по умолчанию также берутся из Settings.',
            'You can enter recipient emails manually here and send a CRM campaign. Default recipients also come from Settings.',
          )}
        </p>
        {aiDraftLoaded && (
          <div className="mt-3 rounded-2xl border border-fuchsia-400/35 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100">
            <div className="font-bold">{tx(lang, 'AI draft hazırdır', 'AI draft готов', 'AI draft is ready')}</div>
            <div className="mt-1">{tx(lang, 'AI Manager-dən gələn kampaniya mətni formaya yerləşdirildi.', 'Текст кампании из AI Manager уже добавлен в форму.', 'Campaign copy from AI Manager has been loaded into the form.')}</div>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                onClick={() => { void onSendAiDraftNow(); }}
                disabled={sendingAiDraft}
                className="rounded-xl border border-fuchsia-200/40 bg-fuchsia-100/10 px-3 py-2 text-xs font-semibold text-fuchsia-50 disabled:opacity-60"
              >
                {sendingAiDraft ? tx(lang, 'Göndərilir...', 'Отправляется...', 'Sending...') : tx(lang, '1 kliklə göndər', 'Отправить в 1 клик', 'Send in 1 click')}
              </button>
              <button
                onClick={() => {
                  removeScopedStorage('ai_campaign_draft');
                  setAiDraftLoaded(false);
                }}
                className="rounded-xl border border-fuchsia-300/40 px-3 py-2 text-xs font-semibold text-fuchsia-50"
              >
                {tx(lang, 'Draft nişanını bağla', 'Скрыть draft', 'Dismiss draft')}
              </button>
            </div>
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3">
          <input className="neon-input" value={campaignRecipients} onChange={(e) => setCampaignRecipients(e.target.value)} placeholder={tx(lang, 'Alıcı email-ləri (vergüllə)', 'Email получателей (через запятую)', 'Recipient emails (comma separated)')} />
          <input className="neon-input" value={campaignSubject} onChange={(e) => setCampaignSubject(e.target.value)} placeholder={tx(lang, 'Email başlığı', 'Тема email', 'Email subject')} />
          <textarea className="neon-input min-h-32" value={campaignBody} onChange={(e) => setCampaignBody(e.target.value)} placeholder={tx(lang, 'Kampaniya mətni', 'Текст кампании', 'Campaign body')} />
        </div>
        <button onClick={() => { void onSendCampaign(); }} className="glossy-gold mt-4 rounded-xl px-5 py-3 font-bold">
          {tx(lang, 'Email Göndər', 'Отправить email', 'Send Email')}
        </button>
      </div>

      <div className="metal-panel overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-700/70 bg-slate-900/40 text-slate-300">
            <tr>
                <th className="px-4 py-3">{tx(lang, 'Kart ID', 'ID карты', 'Card ID')}</th>
                <th className="px-4 py-3">{tx(lang, 'Tip', 'Тип', 'Type')}</th>
                <th className="px-4 py-3">{tx(lang, 'Endirim', 'Скидка', 'Discount')}</th>
                <th className="px-4 py-3">{tx(lang, 'Ulduz', 'Звезды', 'Stars')}</th>
                <th className="px-4 py-3">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-700/50">
                <td className="px-4 py-3 font-mono text-slate-100">{c.card_id}</td>
                <td className="px-4 py-3">{c.type}</td>
                <td className="px-4 py-3 text-emerald-300">{c.discount_percent || 0}%</td>
                <td className="px-4 py-3">{c.stars || 0}</td>
                <td className="px-4 py-3 text-slate-400">{new Date(c.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    {tx(lang, 'Hələ QR müştəri yaradılmayıb', 'QR-клиенты еще не созданы', 'No QR customers yet')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
