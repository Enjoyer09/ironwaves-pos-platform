import React from 'react';
import { Bell, Gift, Home, Languages, MessageCircleHeart, QrCode, Sparkles, UserRound } from 'lucide-react';
import QRCode from 'qrcode';
import { tx } from '../i18n';
import { useAppStore } from '../store';
import { claim_customer_reward_live, enroll_customer_app_live, get_customer_app_bootstrap_live, get_customer_app_session_live, mark_customer_notification_read_live } from '../api/crm';

type Props = {
  cardId?: string;
  token?: string;
  joinMode?: boolean;
};

type CustomerTab = 'home' | 'offers' | 'barista' | 'falci' | 'profile';

const BARISTA_QUICK_PROMPTS = [
  'Mənə soyuq içki tövsiyə et',
  'Bu gün hansı reward mənə sərf edir?',
  'Dessert ilə nə uyğun gedər?',
];

export default function CustomerApp({ cardId = '', token = '', joinMode = false }: Props) {
  const { lang, setLang } = useAppStore();
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<any | null>(null);
  const [bootstrapData, setBootstrapData] = React.useState<any | null>(null);
  const [error, setError] = React.useState('');
  const [claiming, setClaiming] = React.useState(false);
  const [cardQr, setCardQr] = React.useState('');
  const [sessionCreds, setSessionCreds] = React.useState({ cardId, token });
  const [acceptingConsent, setAcceptingConsent] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<CustomerTab>('home');
  const [baristaMessages, setBaristaMessages] = React.useState<Array<{ role: 'assistant' | 'user'; text: string }>>([]);
  const [baristaInput, setBaristaInput] = React.useState('');
  const [fortuneText, setFortuneText] = React.useState('');
  const [fortuneImage, setFortuneImage] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const safeLang = lang === 'ru' || lang === 'en' ? lang : 'az';

  const load = React.useCallback(async () => {
    if (!sessionCreds.cardId || !sessionCreds.token) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const session = await get_customer_app_session_live(sessionCreds.cardId, sessionCreds.token);
      setData(session);
    } catch (e: any) {
      setError(String(e?.message || 'Customer app failed to load'));
    } finally {
      setLoading(false);
    }
  }, [sessionCreds.cardId, sessionCreds.token]);

  React.useEffect(() => {
    if (sessionCreds.cardId && sessionCreds.token) {
      void load();
      return;
    }
    if (!joinMode) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        setLoading(true);
        setError('');
        const bootstrap = await get_customer_app_bootstrap_live();
        setBootstrapData(bootstrap);
      } catch (e: any) {
        setError(String(e?.message || 'Customer app onboarding failed to load'));
      } finally {
        setLoading(false);
      }
    })();
  }, [joinMode, load, sessionCreds.cardId, sessionCreds.token]);

  React.useEffect(() => {
    let cancelled = false;
    const payload = `IWPOS:CARD:${sessionCreds.cardId || ''}`;
    if (!payload) {
      setCardQr('');
      return;
    }
    void QRCode.toDataURL(payload, {
      width: 240,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setCardQr(url);
      })
      .catch(() => {
        if (!cancelled) setCardQr('');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionCreds.cardId]);

  React.useEffect(() => {
    setBaristaMessages([
      {
        role: 'assistant',
        text: tx(
          lang,
          'Salam, mən AI Barista. İçki zövqünə, bonusuna və mood-una görə sənə seçim tövsiyə edə bilərəm.',
          'Привет, я AI Barista. Подскажу напиток по твоему настроению и бонусам.',
          'Hi, I am AI Barista. I can recommend drinks based on your mood and rewards.',
        ),
      },
    ]);
  }, [lang]);

  const markRead = async (notificationId: string) => {
    try {
      await mark_customer_notification_read_live(notificationId, sessionCreds.cardId, sessionCreds.token);
      setData((prev: any) => ({
        ...prev,
        notifications: Array.isArray(prev?.notifications)
          ? prev.notifications.map((row: any) => (row.id === notificationId ? { ...row, is_read: true } : row))
          : [],
      }));
    } catch {}
  };

  const claimReward = async () => {
    try {
      setClaiming(true);
      await claim_customer_reward_live(sessionCreds.cardId, sessionCreds.token);
      await load();
    } catch (e: any) {
      setError(String(e?.message || 'Reward claim failed'));
    } finally {
      setClaiming(false);
    }
  };

  const acceptConsentAndCreateCard = async () => {
    try {
      setAcceptingConsent(true);
      const currentUrl = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const joinCustomerType = currentUrl?.searchParams.get('club') || bootstrapData?.join_customer_type || '';
      const joinDiscount = Number(currentUrl?.searchParams.get('discount') || bootstrapData?.join_discount_percent || 0);
      const created = await enroll_customer_app_live(true, undefined, joinCustomerType, joinDiscount);
      const next = { cardId: created.card_id, token: created.token };
      setSessionCreds(next);
      if (typeof window !== 'undefined') {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('id', created.card_id);
        nextUrl.searchParams.set('t', created.token);
        nextUrl.searchParams.delete('join');
        window.history.replaceState({}, '', nextUrl.toString());
      }
    } catch (e: any) {
      setError(String(e?.message || 'Customer enrollment failed'));
    } finally {
      setAcceptingConsent(false);
    }
  };

  const sendBaristaMessage = () => {
    const prompt = baristaInput.trim();
    if (!prompt) return;
    const lower = prompt.toLowerCase();
    const answer = lower.includes('soyuq') || lower.includes('cold')
      ? tx(lang, 'Sənə buzlu latte və ya meyvəli soyuq içki tövsiyə edirəm. Bonusun varsa bunu desertlə birləşdirmək yaxşı olar.', 'Тебе подойдут айс-латте или фруктовый холодный напиток. Если есть бонус, лучше взять с десертом.', 'I would recommend an iced latte or a fruity cold drink. If you have a bonus, pairing it with dessert would be smart.')
      : lower.includes('güclü') || lower.includes('strong') || lower.includes('oyaq')
      ? tx(lang, 'Bugünkü ritmin üçün double espresso və ya daha güclü qəhvə bazalı içki yaxşı seçimdir.', 'Для сегодняшнего темпа тебе подойдёт double espresso или более крепкий кофейный напиток.', 'For your pace today, a double espresso or another stronger coffee is a great pick.')
      : tx(lang, 'Mood-un üçün balanslı latte, yumşaq desert və mövcud reward-unla rahat combo ən uyğun seçimdir.', 'Для твоего настроения лучше всего подойдут сбалансированный латте, мягкий десерт и спокойное комбо с наградой.', 'For your mood, a balanced latte, a soft dessert, and a calm reward combo would fit best.');

    setBaristaMessages((prev) => [...prev, { role: 'user', text: prompt }, { role: 'assistant', text: answer }]);
    setBaristaInput('');
  };

  const analyzeImageFortune = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      setFortuneImage(src);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 40;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const pixels = ctx.getImageData(0, 0, size, size).data;
        let total = 0;
        let warm = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          total += (r + g + b) / 3;
          if (r > b) warm += 1;
        }
        const avg = total / (pixels.length / 4);
        const warmRatio = warm / (pixels.length / 4);
        const result = avg > 160
          ? tx(lang, 'Fal deyir ki, bu şəkil işıqlı enerji daşıyır. Qarşıdakı günlərdə sənin üçün açıq qapılar və xoş kampaniyalar görünür.', 'Изображение несет светлую энергию. Впереди для тебя открытые возможности и приятные акции.', 'This image carries bright energy. Open doors and pleasant offers are ahead for you.')
          : warmRatio > 0.55
          ? tx(lang, 'Fal isti tonlar görür. Bu, yaxın zamanda daha rahatlıq, dadlı seçimlər və özünü mükafatlandırmaq vaxtı deməkdir.', 'Предсказание видит тёплые тона. Это знак уюта, вкусных выборов и времени порадовать себя.', 'Your fortune sees warm tones. That means comfort, tasty choices, and a good time to reward yourself.')
          : tx(lang, 'Fal daha dərin və sakit aura görür. Yaxın günlərdə səni sürpriz bonus və gözlənilməz bir reward sevindirə bilər.', 'Предсказание видит более глубокую и спокойную ауру. В ближайшие дни тебя может порадовать неожиданный бонус.', 'Your fortune sees a deeper, calmer aura. An unexpected bonus or reward may cheer you up soon.');
        setFortuneText(result);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950 px-4 py-10 text-center text-slate-200">Loading customer app...</div>;
  }

  if (!sessionCreds.cardId || !sessionCreds.token) {
    const bootstrapBranding = bootstrapData?.branding || {};
    const joinPrimary = String(bootstrapBranding.primary_color || '#facc15');
    const joinAccent = String(bootstrapBranding.accent_color || '#22d3ee');
    const joinBg = String(bootstrapBranding.background_color || '#0b1220');
    return (
      <div className="min-h-screen px-4 py-8 text-slate-100" style={{ background: `linear-gradient(180deg, ${joinBg}, #020617)` }}>
        <div className="mx-auto max-w-md space-y-4">
          <section className="overflow-hidden rounded-[34px] border border-white/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]" style={{ background: `linear-gradient(180deg, ${joinAccent}, ${joinPrimary})` }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-white/70">{bootstrapBranding.app_name || 'Loyalty Club'}</div>
                <h1 className="mt-3 text-3xl font-black text-white">{bootstrapBranding.hero_title || tx(safeLang, 'Xoş gəldiniz', 'Добро пожаловать', 'Welcome')}</h1>
                <p className="mt-2 text-sm text-white/80">{bootstrapBranding.hero_subtitle || tx(safeLang, 'Loyalty klubuna bir toxunuşla qoşul', 'Присоединяйся к loyalty клубу одним касанием', 'Join the loyalty club in one tap')}</p>
              </div>
              <div className="flex flex-col items-end gap-3">
                <div className="flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs text-white backdrop-blur">
                  <Languages size={14} />
                  <button type="button" onClick={() => setLang('az')} className={safeLang === 'az' ? 'font-bold underline' : ''}>AZ</button>
                  <button type="button" onClick={() => setLang('en')} className={safeLang === 'en' ? 'font-bold underline' : ''}>EN</button>
                  <button type="button" onClick={() => setLang('ru')} className={safeLang === 'ru' ? 'font-bold underline' : ''}>RU</button>
                </div>
                {bootstrapBranding.logo_url ? <img src={bootstrapBranding.logo_url} alt="brand" className="h-12 w-12 rounded-2xl object-cover" /> : null}
              </div>
            </div>
          </section>
          <section className="rounded-[30px] border border-white/10 bg-white p-5 text-slate-900 shadow-[0_12px_32px_rgba(0,0,0,0.16)]">
            <div className="text-lg font-black">{tx(safeLang, 'Müştəri razılaşması', 'Согласие клиента', 'Customer consent')}</div>
            <div className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              {bootstrapData?.consent_text || tx(safeLang, 'Razılaşma mətni əlavə edilməyib.', 'Текст согласия не задан.', 'Consent text has not been set.')}
            </div>
            <button
              type="button"
              disabled={acceptingConsent}
              onClick={() => { void acceptConsentAndCreateCard(); }}
              className="mt-4 w-full rounded-2xl px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
              style={{ backgroundColor: joinPrimary }}
            >
              {acceptingConsent ? tx(safeLang, 'Kart yaradılır...', 'Карта создается...', 'Creating your card...') : tx(safeLang, 'Qəbul edirəm və kartımı yarat', 'Принимаю и создать карту', 'Accept and create my card')}
            </button>
          </section>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-10 text-center text-slate-200">
        <div className="mx-auto max-w-lg rounded-3xl border border-red-400/20 bg-red-500/10 p-6">
          <h1 className="text-2xl font-bold text-white">{tx(safeLang, 'Müştəri tətbiqi açıla bilmədi', 'Клиентское приложение не открылось', 'Customer app could not be opened')}</h1>
          <p className="mt-3 text-sm text-red-200">{error || 'Invalid customer link'}</p>
        </div>
      </div>
    );
  }

  const branding = data.branding || {};
  const wallet = data.wallet || {};
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  const history = Array.isArray(data.history) ? data.history : [];
  const customer = data.customer || {};
  const rewards = Array.isArray(wallet.rewards) ? wallet.rewards : [];
  const pendingClaims = Array.isArray(data.pending_claims) ? data.pending_claims : [];
  const progressPercent = wallet.next_reward_at ? Math.min(100, Math.round((Number(wallet.progress_current || 0) / Number(wallet.next_reward_at || 1)) * 100)) : 0;
  const primaryColor = String(branding.primary_color || '#14b8a6');
  const accentColor = String(branding.accent_color || '#7c3aed');
  const programMode = String(wallet.program_mode || 'points').toLowerCase();
  const showQrCard = branding.show_qr_card !== false;
  const showWallet = branding.show_wallet !== false;
  const balanceSuffix = programMode === 'cashback' ? ' ₼' : '';
  const heroImage = String(branding.hero_image_url || '');
  const backgroundImage = String(branding.background_image_url || '');
  const backgroundColor = String(branding.background_color || data.customer_app_settings?.background_color || '#0b1220');
  const aiBaristaEnabled = branding.ai_barista_enabled === true;
  const aiFalciEnabled = branding.ai_falci_enabled === true;
  const layoutPreset = String(data.customer_app_settings?.layout_preset || 'rewards').toLowerCase();
  const rewardCardStyle = String(branding.reward_card_style || data.customer_app_settings?.reward_card_style || 'rounded').toLowerCase();
  const heroRadius = layoutPreset === 'playful' ? '36px' : '32px';
  const cardRadiusClass = rewardCardStyle === 'glass' ? 'rounded-[30px]' : rewardCardStyle === 'soft-square' ? 'rounded-[18px]' : 'rounded-[28px]';
  const cardClass = layoutPreset === 'playful'
    ? `${cardRadiusClass} border border-white/10 bg-white/95 p-4 text-slate-900 shadow-[0_10px_28px_rgba(236,72,153,0.16)]`
    : layoutPreset === 'cashback'
    ? `${cardRadiusClass} border border-white/10 bg-white p-4 text-slate-900 shadow-[0_8px_24px_rgba(20,184,166,0.14)]`
    : `${cardRadiusClass} border border-white/10 bg-white p-4 text-slate-900 shadow-[0_8px_24px_rgba(0,0,0,0.12)]`;

  const bottomTabs: Array<{ key: CustomerTab; label: string; icon: React.ReactNode }> = [
    { key: 'home', label: tx(safeLang, 'Rewards', 'Награды', 'Rewards'), icon: <Home size={18} /> },
    { key: 'offers', label: tx(safeLang, 'Təkliflər', 'Предложения', 'Offers'), icon: <Gift size={18} /> },
    ...(aiBaristaEnabled ? [{ key: 'barista' as CustomerTab, label: tx(safeLang, 'Barista', 'Barиста', 'Barista'), icon: <MessageCircleHeart size={18} /> }] : []),
    ...(aiFalciEnabled ? [{ key: 'falci' as CustomerTab, label: tx(safeLang, 'Falçı', 'Фалчы', 'Fortune'), icon: <Sparkles size={18} /> }] : []),
    { key: 'profile', label: tx(safeLang, 'Profil', 'Профиль', 'Profile'), icon: <UserRound size={18} /> },
  ];
  const resolvedActiveTab: CustomerTab =
    (activeTab === 'barista' && !aiBaristaEnabled) || (activeTab === 'falci' && !aiFalciEnabled)
      ? 'home'
      : activeTab;

  const renderHome = () => (
    <div className="space-y-4">
      <section
        className="overflow-hidden border border-white/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
        style={{
          borderRadius: heroRadius,
          background: heroImage
            ? `linear-gradient(180deg, rgba(15,23,42,0.18), rgba(15,23,42,0.68)), url(${heroImage}) center/cover`
            : layoutPreset === 'cashback'
            ? `linear-gradient(180deg, ${primaryColor}, #052e2b)`
            : `linear-gradient(180deg, ${accentColor}, ${primaryColor})`,
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-white/70">{branding.app_name || 'Loyalty Club'}</div>
            <h1 className="mt-3 text-3xl font-black text-white">{branding.hero_title || tx(safeLang, 'Xoş gəldiniz', 'Добро пожаловать', 'Welcome')}</h1>
            <p className="mt-2 max-w-[16rem] text-sm text-white/80">{branding.hero_subtitle || customer.card_id}</p>
          </div>
          {branding.logo_url ? <img src={branding.logo_url} alt="brand" className="h-12 w-12 rounded-2xl object-cover" /> : null}
        </div>
        {showWallet ? (
          <div className="mt-6 rounded-[28px] bg-white/12 p-4 backdrop-blur">
            <div className="text-xs uppercase tracking-[0.2em] text-white/70">{wallet.points_label || 'Ulduz'}</div>
            <div className="mt-2 text-5xl font-black text-white">{Number(wallet.stars_balance ?? 0).toFixed(programMode === 'cashback' ? 2 : 0)}{balanceSuffix}</div>
            <div className="mt-2 text-sm text-white/80">
              {programMode === 'cashback'
                ? `${Number(wallet.cashback_percent || 0).toFixed(0)}% cashback`
                : (customer.type || 'Member')}
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-black/20">
              <div className="h-full rounded-full bg-white" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-white/75">
              <span>{tx(safeLang, 'Növbəti reward', 'Следующая награда', 'Next reward')}</span>
              <span>{wallet.reward_name || tx(safeLang, 'Bonus', 'Бонус', 'Reward')}</span>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={cardClass}>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Gift size={16} /> {tx(safeLang, 'Reward-lar', 'Награды', 'Rewards')}</div>
          <div className="mt-3 text-3xl font-black text-slate-900">{wallet.available_rewards ?? 0}</div>
          <div className="mt-2 text-sm text-slate-600">{wallet.reward_label || 'Reward'}</div>
          {rewards[0] ? (
            <button
              type="button"
              disabled={claiming || Number(wallet.available_rewards || 0) <= 0}
              onClick={() => { void claimReward(); }}
              className="mt-4 w-full rounded-2xl px-4 py-3 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: primaryColor }}
            >
              {claiming ? tx(safeLang, 'Hazırlanır...', 'Подготавливается...', 'Preparing...') : tx(safeLang, 'Reward claim et', 'Забрать награду', 'Claim reward')}
            </button>
          ) : null}
        </section>

        <section className={cardClass}>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><QrCode size={16} /> {tx(safeLang, 'QR Kart', 'QR карта', 'QR card')}</div>
          {showQrCard ? (
            <div className="mt-3 flex flex-col items-center rounded-[24px] bg-white px-4 py-5 text-slate-900">
              {cardQr ? <img src={cardQr} alt="customer qr" className="h-36 w-36 rounded-2xl" /> : null}
              <div className="mt-3 text-sm font-bold">{customer.card_id}</div>
            </div>
          ) : (
            <div className="mt-3 rounded-[24px] bg-slate-100 p-4 text-sm text-slate-700">{customer.card_id}</div>
          )}
        </section>
      </div>

      <section className="rounded-[28px] border border-white/10 bg-white p-4 text-slate-900 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{tx(safeLang, 'Hazır claim kodların', 'Готовые коды наград', 'Your ready claim codes')}</div>
            <div className="mt-1 text-xs text-slate-500">{tx(safeLang, 'Kassada bu kodu göstər və reward istifadə et', 'Покажи код на кассе и используй награду', 'Show this code at checkout to use your reward')}</div>
          </div>
          <div className="rounded-full px-3 py-1 text-xs font-bold text-slate-950" style={{ backgroundColor: accentColor }}>
            {pendingClaims.length}
          </div>
        </div>
        <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
          {pendingClaims.length === 0 ? (
            <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              {tx(safeLang, 'Hələ aktiv reward kodu yoxdur', 'Пока нет активного reward-кода', 'No active reward code yet')}
            </div>
          ) : pendingClaims.map((row: any) => (
            <div key={row.id} className="min-w-[210px] rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{tx(lang, 'Kod', 'Код', 'Code')}</div>
              <div className="mt-2 text-2xl font-black text-slate-900">{row.claim_code}</div>
              <div className="mt-2 text-sm text-slate-600">{row.reward_name}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderOffers = () => (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-bold text-white">{tx(safeLang, 'Aktiv kampaniyalar', 'Активные кампании', 'Active offers')}</div>
          <div className="rounded-full px-3 py-1 text-xs font-semibold text-slate-950" style={{ backgroundColor: primaryColor }}>{campaigns.length}</div>
        </div>
        <div className="mt-4 space-y-3">
          {campaigns.length === 0 ? (
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">{tx(safeLang, 'Hazırda aktiv kampaniya yoxdur', 'Сейчас нет активных кампаний', 'No active campaigns right now')}</div>
          ) : campaigns.map((row: any) => (
            <div key={row.id} className="rounded-[24px] border border-white/10 bg-white px-4 py-4 text-slate-900 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
              <div className="text-lg font-bold">{row.name}</div>
              <div className="mt-2 text-sm text-slate-600">{row.discount_percent}% {tx(safeLang, 'endirim', 'скидка', 'discount')}</div>
              <div className="mt-3 text-xs text-slate-500">{row.start_time} - {row.end_time} • {row.categories || 'ALL'}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
        <div className="text-lg font-bold text-white">{tx(safeLang, 'Claim kodları', 'Коды наград', 'Claim codes')}</div>
        <div className="mt-4 space-y-3">
          {pendingClaims.length === 0 ? (
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">{tx(safeLang, 'Aktiv claim kodu yoxdur', 'Активных кодов нет', 'No active claim codes')}</div>
          ) : pendingClaims.map((row: any) => (
            <div key={row.id} className="rounded-[24px] border border-amber-300/20 bg-amber-400/10 p-4">
              <div className="text-xs uppercase tracking-[0.25em] text-amber-100">{tx(safeLang, 'Kassada göstərin', 'Покажите на кассе', 'Show at POS')}</div>
              <div className="mt-2 text-3xl font-black text-white">{row.claim_code}</div>
              <div className="mt-2 text-sm text-slate-200">{row.reward_name}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderBarista = () => (
    <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
      <div className="text-lg font-bold text-white">AI Barista</div>
      <div className="mt-2 text-sm text-slate-300">{tx(safeLang, 'Söhbət et, içki və reward tövsiyəsi al.', 'Поговори и получи совет по напиткам и наградам.', 'Chat and get drink and reward suggestions.')}</div>
      <div className="mt-4 max-h-72 space-y-3 overflow-y-auto rounded-[24px] bg-slate-950/35 p-3">
        {baristaMessages.map((msg, idx) => (
          <div key={`${msg.role}_${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-[20px] px-4 py-3 text-sm ${
                msg.role === 'user' ? 'text-slate-950' : 'bg-white/10 text-slate-100'
              }`}
              style={msg.role === 'user' ? { backgroundColor: primaryColor } : undefined}
            >
              {msg.text}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {BARISTA_QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setBaristaInput(prompt)}
            className="rounded-full border border-white/10 bg-white/6 px-3 py-2 text-xs text-slate-200"
          >
            {prompt}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className="neon-input"
          value={baristaInput}
          onChange={(e) => setBaristaInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendBaristaMessage(); }}
          placeholder={tx(safeLang, 'Mənə nə tövsiyə edərsən?', 'Что ты посоветуешь мне?', 'What would you recommend for me?')}
        />
        <button type="button" onClick={sendBaristaMessage} className="rounded-2xl px-4 py-3 font-semibold text-slate-950" style={{ backgroundColor: accentColor }}>
          {tx(safeLang, 'Göndər', 'Отправить', 'Send')}
        </button>
      </div>
    </section>
  );

  const renderFalci = () => (
    <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
      <div className="text-lg font-bold text-white">AI Falçı</div>
      <p className="mt-2 text-sm text-slate-300">{tx(safeLang, 'Bir şəkil yüklə, AI Falçı onun tonuna və ab-havasına baxıb əyləncəli mesaj versin.', 'Загрузи фото, и AI Falçı даст тебе игровое предсказание по атмосфере изображения.', 'Upload an image and AI Fortune Teller will give you a playful reading based on its vibe.')}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => fileRef.current?.click()} className="rounded-2xl px-4 py-3 font-semibold text-slate-950" style={{ backgroundColor: primaryColor }}>
          {tx(safeLang, 'Şəkil yüklə', 'Загрузить фото', 'Upload image')}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) analyzeImageFortune(file);
        }} />
      </div>
      {fortuneImage ? <img src={fortuneImage} alt="fortune preview" className="mt-4 h-44 w-full rounded-[24px] object-cover" /> : null}
      <div className="mt-4 rounded-[24px] bg-amber-400/10 p-4 text-sm text-slate-100">
        {fortuneText || tx(safeLang, 'Şəkli yükləyəndən sonra fal burada görünəcək.', 'После загрузки фото предсказание появится здесь.', 'Your fortune will appear here after you upload an image.')}
      </div>
    </section>
  );

  const renderProfile = () => (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-lg font-bold text-white">{tx(safeLang, 'Müştəri Profili', 'Профиль клиента', 'Customer profile')}</div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-200">
            <Languages size={14} />
            <button type="button" onClick={() => setLang('az')} className={safeLang === 'az' ? 'font-bold underline' : ''}>AZ</button>
            <button type="button" onClick={() => setLang('en')} className={safeLang === 'en' ? 'font-bold underline' : ''}>EN</button>
            <button type="button" onClick={() => setLang('ru')} className={safeLang === 'ru' ? 'font-bold underline' : ''}>RU</button>
          </div>
        </div>
        <div className="mt-4 space-y-3 rounded-[24px] bg-slate-950/35 p-4 text-sm text-slate-200">
          <div className="flex items-center justify-between gap-3"><span className="text-slate-400">{tx(safeLang, 'Kart ID', 'ID карты', 'Card ID')}</span><span className="font-semibold text-white">{customer.card_id}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-400">{tx(safeLang, 'Tip', 'Тип', 'Type')}</span><span className="font-semibold text-white">{customer.type || 'Member'}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-400">{tx(safeLang, 'Endirim', 'Скидка', 'Discount')}</span><span className="font-semibold text-white">{Number(customer.discount_percent || 0).toFixed(0)}%</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-400">{tx(safeLang, 'Qoşulma tarixi', 'Дата подключения', 'Joined')}</span><span className="font-semibold text-white">{customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '-'}</span></div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2 text-lg font-bold text-white"><Bell size={18} /> {tx(safeLang, 'Bildirişlər', 'Уведомления', 'Notifications')}</div>
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">{tx(safeLang, 'Yeni bildiriş yoxdur', 'Нет новых уведомлений', 'No new notifications')}</div>
          ) : notifications.map((row: any) => (
            <button
              key={row.id}
              type="button"
              onClick={() => { if (!row.is_read) void markRead(row.id); }}
              className={`w-full rounded-2xl border p-4 text-left ${row.is_read ? 'border-slate-700/60 bg-slate-950/20' : 'border-cyan-300/20 bg-cyan-400/10'}`}
            >
              <div className="text-sm text-white">{row.message}</div>
              <div className="mt-2 text-xs text-slate-400">{new Date(row.created_at).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2 text-lg font-bold text-white"><Gift size={18} /> {tx(safeLang, 'Son tarixçə', 'Последняя история', 'Recent history')}</div>
        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">{tx(safeLang, 'Hələ alış tarixçəsi yoxdur', 'История покупок пока пуста', 'No purchase history yet')}</div>
          ) : history.map((row: any) => (
            <div key={row.id} className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{new Date(row.created_at).toLocaleString()}</div>
                  <div className="mt-1 text-sm text-slate-400">{(row.items || []).map((item: any) => `${item.item_name} x${item.qty}`).join(', ') || '-'}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">{Number(row.total || 0).toFixed(2)} ₼</div>
                  <div className="text-xs text-slate-400">{row.payment_method}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        backgroundImage: `${backgroundImage ? `linear-gradient(rgba(8,12,22,0.82), rgba(8,12,22,0.94)), url(${backgroundImage}), ` : ''}linear-gradient(180deg, #0b1220, #121b2c)`,
        background: backgroundImage ? undefined : `linear-gradient(180deg, ${backgroundColor}, #121b2c)`,
        backgroundSize: backgroundImage ? 'cover, auto' : undefined,
        backgroundPosition: backgroundImage ? 'center, center' : undefined,
      }}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-28 pt-4">
        <div className="mb-3 flex justify-end">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-200 backdrop-blur">
            <Languages size={14} />
            <button type="button" onClick={() => setLang('az')} className={safeLang === 'az' ? 'font-bold underline' : ''}>AZ</button>
            <button type="button" onClick={() => setLang('en')} className={safeLang === 'en' ? 'font-bold underline' : ''}>EN</button>
            <button type="button" onClick={() => setLang('ru')} className={safeLang === 'ru' ? 'font-bold underline' : ''}>RU</button>
          </div>
        </div>
        {resolvedActiveTab === 'home' && renderHome()}
        {resolvedActiveTab === 'offers' && renderOffers()}
        {resolvedActiveTab === 'barista' && aiBaristaEnabled && renderBarista()}
        {resolvedActiveTab === 'falci' && aiFalciEnabled && renderFalci()}
        {resolvedActiveTab === 'profile' && renderProfile()}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md px-4 pb-4">
        <div className="grid gap-2 rounded-[28px] border border-white/10 bg-slate-950/85 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur-xl" style={{ gridTemplateColumns: `repeat(${bottomTabs.length}, minmax(0, 1fr))` }}>
          {bottomTabs.map((tab) => {
            const active = tab.key === resolvedActiveTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex flex-col items-center gap-1 rounded-[22px] px-2 py-3 text-xs font-semibold transition ${active ? 'text-slate-950' : 'text-slate-300'}`}
                style={active ? { backgroundColor: primaryColor } : undefined}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
