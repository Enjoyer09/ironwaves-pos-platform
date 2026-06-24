import React from 'react';
import { Bell, Gift, Home, Languages, MessageCircleHeart, MessageSquare, QrCode, Sparkles, UserRound, Camera as CameraIcon, Mic, Volume2, VolumeX } from 'lucide-react';
import QRCode from 'qrcode';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { tx } from '../i18n';
import { useAppStore } from '../store';
import { claim_customer_reward_live, enroll_customer_app_live, get_customer_app_bootstrap_live, get_customer_app_session_live, mark_customer_notification_read_live, save_push_token_live, send_customer_otp_live, verify_customer_otp_live, analyze_customer_fortune_live, chat_customer_barista_live, get_customer_wallet_pass_url } from '../api/crm';

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

type SimpleAreaChartProps = {
  data: Array<{ date: string; amount: number }>;
  primaryColor: string;
  safeLang: string;
};

function SimpleAreaChart({ data, primaryColor, safeLang }: SimpleAreaChartProps) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState<{ x: number; y: number } | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  if (!data || data.length === 0) return null;

  const width = 500;
  const height = 180;
  const paddingLeft = 35;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 25;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const amounts = data.map((d) => d.amount);
  const maxAmount = Math.max(...amounts, 1);
  const minAmount = 0;

  const points = data.map((d, index) => {
    const x = paddingLeft + (index / (data.length - 1 || 1)) * chartWidth;
    const y = paddingTop + chartHeight - ((d.amount - minAmount) / (maxAmount - minAmount)) * chartHeight;
    return { x, y, date: d.date, amount: d.amount };
  });

  let linePath = '';
  let areaPath = '';

  if (points.length > 0) {
    linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      linePath += ` L ${points[i].x} ${points[i].y}`;
    }
    areaPath = `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`;
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;

    let closestIndex = 0;
    let minDiff = Infinity;
    points.forEach((p, idx) => {
      const diff = Math.abs(p.x - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = idx;
      }
    });

    setHoveredIndex(closestIndex);
    const activePoint = points[closestIndex];
    setTooltipPos({
      x: activePoint.x,
      y: activePoint.y - 10,
    });
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setTooltipPos(null);
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!svgRef.current || e.touches.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const svgX = (touchX / rect.width) * width;

    let closestIndex = 0;
    let minDiff = Infinity;
    points.forEach((p, idx) => {
      const diff = Math.abs(p.x - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = idx;
      }
    });

    setHoveredIndex(closestIndex);
    const activePoint = points[closestIndex];
    setTooltipPos({
      x: activePoint.x,
      y: activePoint.y - 10,
    });
  };

  const yTicks = [0, maxAmount / 2, maxAmount];

  return (
    <div className="relative w-full select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseLeave}
      >
        <defs>
          <linearGradient id="customColorAmount" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity={0.4} />
            <stop offset="100%" stopColor={primaryColor} stopOpacity={0.0} />
          </linearGradient>
        </defs>

        {yTicks.map((tick, idx) => {
          const y = paddingTop + chartHeight - ((tick - minAmount) / (maxAmount - minAmount)) * chartHeight;
          return (
            <line
              key={idx}
              x1={paddingLeft}
              y1={y}
              x2={width - paddingRight}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="4 4"
            />
          );
        })}

        {yTicks.map((tick, idx) => {
          const y = paddingTop + chartHeight - ((tick - minAmount) / (maxAmount - minAmount)) * chartHeight;
          return (
            <text
              key={idx}
              x={paddingLeft - 8}
              y={y + 3}
              fill="rgba(255,255,255,0.35)"
              fontSize={10}
              textAnchor="end"
            >
              {tick.toFixed(0)}₼
            </text>
          );
        })}

        {points.map((p, idx) => {
          const isTick = idx === 0 || idx === points.length - 1 || (points.length > 2 && idx === Math.floor(points.length / 2));
          if (!isTick) return null;
          return (
            <g key={idx}>
              <text
                x={p.x}
                y={height - 5}
                fill="rgba(255,255,255,0.35)"
                fontSize={10}
                textAnchor="middle"
              >
                {p.date}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#customColorAmount)" />

        <path d={linePath} fill="none" stroke={primaryColor} strokeWidth={2.5} strokeLinecap="round" />

        {points.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={hoveredIndex === idx ? 5 : 3}
            fill="#0f172a"
            stroke={primaryColor}
            strokeWidth={hoveredIndex === idx ? 2.5 : 1.5}
            className="transition-all duration-150"
          />
        ))}

        {hoveredIndex !== null && tooltipPos && (
          <line
            x1={tooltipPos.x}
            y1={paddingTop}
            x2={tooltipPos.x}
            y2={paddingTop + chartHeight}
            stroke="rgba(255,255,255,0.15)"
            strokeDasharray="2 2"
            pointerEvents="none"
          />
        )}
      </svg>

      {hoveredIndex !== null && tooltipPos && (
        <div
          className="absolute z-10 rounded-xl border border-white/10 bg-slate-950/95 p-2 text-xs text-white shadow-xl pointer-events-none transition-all duration-100"
          style={{
            left: `${(tooltipPos.x / width) * 100}%`,
            top: `${(tooltipPos.y / height) * 100}%`,
            transform: 'translate(-50%, -115%)',
          }}
        >
          <div className="font-bold text-slate-400">{points[hoveredIndex].date}</div>
          <div className="mt-0.5 flex items-center gap-1 font-semibold text-white">
            <span style={{ color: primaryColor }}>●</span>
            {points[hoveredIndex].amount.toFixed(2)} ₼
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [phone, setPhone] = React.useState('');
  const [otpCode, setOtpCode] = React.useState('');
  const [otpSent, setOtpSent] = React.useState(false);
  const [otpSending, setOtpSending] = React.useState(false);
  const [otpVerifying, setOtpVerifying] = React.useState(false);
  const [otpError, setOtpError] = React.useState('');
  const [baristaMessages, setBaristaMessages] = React.useState<Array<{ role: 'assistant' | 'user'; text: string }>>([]);
  const [baristaInput, setBaristaInput] = React.useState('');
  const [fortuneText, setFortuneText] = React.useState('');
  const [fortuneImage, setFortuneImage] = React.useState('');
  const [fortuneLoading, setFortuneLoading] = React.useState(false);
  const [fortuneProgress, setFortuneProgress] = React.useState(0);
  const [fortuneStepText, setFortuneStepText] = React.useState('');
  const [showFullQr, setShowFullQr] = React.useState(false);
  const [activatedCampaigns, setActivatedCampaigns] = React.useState<Record<string, number>>({});
  const [campaignQrs, setCampaignQrs] = React.useState<Record<string, string>>({});
  const [tick, setTick] = React.useState(0);
  const [isListening, setIsListening] = React.useState(false);
  const [voiceEnabled, setVoiceEnabled] = React.useState(false);
  const recognitionRef = React.useRef<any>(null);
  const [particles, setParticles] = React.useState<Array<{ id: number; x: number; y: number; size: number; angle: number; speed: number }>>([]);
  const [geofenceAlert, setGeofenceAlert] = React.useState(false);
  const [showDevSettings, setShowDevSettings] = React.useState(false);
  const [customApiUrl, setCustomApiUrl] = React.useState(() => {
    return localStorage.getItem('ironwaves_custom_api_base_url') || '';
  });
  const [customTenantDomain, setCustomTenantDomain] = React.useState(() => {
    return localStorage.getItem('mobile_tenant_domain') || 'super.ironwaves.store';
  });
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const safeLang = lang === 'ru' || lang === 'en' ? lang : 'az';
  const [simulatedTemp, setSimulatedTemp] = React.useState<number>(() => {
    const hr = new Date().getHours();
    return hr >= 10 && hr <= 17 ? 26 : 14;
  });
  const [simulatedCondition, setSimulatedCondition] = React.useState<'sunny' | 'rainy'>(() => {
    const hr = new Date().getHours();
    return hr >= 10 && hr <= 17 ? 'sunny' : 'rainy';
  });

  const formatCardId = (id: string) => {
    const clean = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) return '•••• •••• •••• ••••';
    const chunks = [];
    for (let i = 0; i < clean.length; i += 4) {
      chunks.push(clean.slice(i, i + 4));
    }
    return chunks.join(' ');
  };

  const chartData = React.useMemo(() => {
    const historyList = Array.isArray(data?.history) ? data.history : [];
    if (historyList.length === 0) return [];
    const groups: Record<string, number> = {};
    const locale = safeLang === 'az' ? 'az-AZ' : safeLang === 'ru' ? 'ru-RU' : 'en-US';
    const sorted = [...historyList].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const item of sorted) {
      if (!item.created_at) continue;
      const dateStr = new Date(item.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
      groups[dateStr] = (groups[dateStr] || 0) + Number(item.total || 0);
    }
    return Object.keys(groups).map((date) => ({
      date,
      amount: parseFloat(groups[date].toFixed(2)),
    }));
  }, [data?.history, safeLang]);

  const favoriteItems = React.useMemo(() => {
    const counts: Record<string, { name: string; count: number; category: string }> = {};
    const historyList = Array.isArray(data?.history) ? data.history : [];
    
    for (const sale of historyList) {
      const itemsList = Array.isArray(sale.items) ? sale.items : [];
      for (const item of itemsList) {
        if (!item.item_name) continue;
        const name = String(item.item_name).trim();
        const qty = Number(item.qty || 1);
        
        let category = 'coffee';
        const lowerName = name.toLowerCase();
        if (lowerName.includes('çay') || lowerName.includes('tea') || lowerName.includes('matcha')) {
          category = 'tea';
        } else if (lowerName.includes('keks') || lowerName.includes('tart') || lowerName.includes('tort') || lowerName.includes('cake') || lowerName.includes('kurabiye') || lowerName.includes('cookie') || lowerName.includes('biscuit') || lowerName.includes('şirniyyat') || lowerName.includes('desert') || lowerName.includes('dessert')) {
          category = 'sweet';
        } else if (lowerName.includes('sendviç') || lowerName.includes('sandviç') || lowerName.includes('sandwich') || lowerName.includes('tost') || lowerName.includes('toast') || lowerName.includes('burger')) {
          category = 'food';
        } else if (lowerName.includes('limonad') || lowerName.includes('lemonade') || lowerName.includes('su') || lowerName.includes('water') || lowerName.includes('sok') || lowerName.includes('juice') || lowerName.includes('cola') || lowerName.includes('fanta') || lowerName.includes('sprite')) {
          category = 'cold';
        }

        if (counts[name]) {
          counts[name].count += qty;
        } else {
          counts[name] = { name, count: qty, category };
        }
      }
    }

    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [data?.history]);

  const branding = data?.branding || {};
  const wallet = data?.wallet || {};
  const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
  const history = Array.isArray(data?.history) ? data.history : [];
  const customer = data?.customer || {};
  
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      return tx(safeLang, 'Sabahınız xeyir', 'Доброе утро', 'Good morning');
    } else if (hour >= 12 && hour < 18) {
      return tx(safeLang, 'Günortanız xeyir', 'Добрый день', 'Good afternoon');
    } else if (hour >= 18 && hour < 24) {
      return tx(safeLang, 'Axşamınız xeyir', 'Добрый вечер', 'Good evening');
    } else {
      return tx(safeLang, 'Gecəniz xeyir', 'Доброй ночи', 'Good night');
    }
  };

  const getFirstName = () => {
    if (!customer?.name) return '';
    const namePart = String(customer.name).trim().split(' ')[0];
    return namePart ? `, ${namePart}` : '';
  };

  const spawnParticles = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newParticles = Array.from({ length: 8 }).map((_, i) => ({
      id: Math.random(),
      x,
      y,
      size: Math.random() * 8 + 6,
      angle: (i * 45 * Math.PI) / 180,
      speed: Math.random() * 3 + 2,
    }));

    setParticles((prev) => [...prev, ...newParticles]);

    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
    }, 800);
  };

  const playTickSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.05);
    } catch (err) {
      console.warn('Web Audio tick failed', err);
    }
  };

  const playShimmerSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = audioCtx.currentTime;
      const playNote = (freq: number, delay: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + delay);
        gain.gain.setValueAtTime(0.05, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);
        osc.start(now + delay);
        osc.stop(now + delay + duration);
      };
      playNote(523.25, 0, 0.15); // C5
      playNote(659.25, 0.08, 0.15); // E5
      playNote(783.99, 0.16, 0.25); // G5
    } catch (err) {
      console.warn('Web Audio shimmer failed', err);
    }
  };

  const getWeatherInfo = () => {
    const isHot = simulatedTemp > 20;
    const hour = new Date().getHours();
    const isMorning = hour >= 5 && hour < 12;
    const isAfternoon = hour >= 12 && hour < 18;

    let weatherTitle = '';
    let weatherDesc = '';
    let recommendedDrinks: Array<{ name: string; icon: string; tag: string }> = [];
    let comboTitle = '';
    let comboItems: Array<{ name: string; desc: string; icon: string }> = [];

    if (isHot) {
      weatherTitle = tx(safeLang, 'İsti hava təklifləri ☀️', 'Предложения для теплой погоды ☀️', 'Warm Weather Picks ☀️');
      weatherDesc = tx(safeLang, 'Hava istidir! Sərinləmək üçün ideal seçimlər:', 'На улице тепло! Отличные освежающие напитки:', 'It\'s warm outside! Refreshing options to cool down:');
      recommendedDrinks = [
        { name: tx(safeLang, 'Iced Latte', 'Айс Латте', 'Iced Latte'), icon: '🥤', tag: 'Popular' },
        { name: tx(safeLang, 'Soyuq Dəmləmə', 'Колд Брю', 'Cold Brew'), icon: '🥃', tag: 'Smooth' },
        { name: tx(safeLang, 'Şaftalı Iced Tea', 'Персиковый Айс Ти', 'Peach Iced Tea'), icon: '🍹', tag: 'Fruity' },
        { name: tx(safeLang, 'Espresso Tonic', 'Эспрессо Тоник', 'Espresso Tonic'), icon: '🥂', tag: 'Zesty' }
      ];
    } else {
      weatherTitle = tx(safeLang, 'Sərin hava təklifləri 🍂', 'Предложения для прохладной погоды 🍂', 'Cozy Weather Picks 🍂');
      weatherDesc = tx(safeLang, 'Sərin və ya yağışlı hava üçün içimizi isidəcək dadlar:', 'Для прохладной погоды согревающие напитки:', 'Warm up with these cozy choices:');
      recommendedDrinks = [
        { name: tx(safeLang, 'İsti Şokolad', 'Горячий Шоколад', 'Hot Chocolate'), icon: '☕', tag: 'Rich' },
        { name: tx(safeLang, 'Cappuccino', 'Капучисимо', 'Cappuccino'), icon: '🥛', tag: 'Classic' },
        { name: tx(safeLang, 'Matcha Latte', 'Матча Латте', 'Matcha Latte'), icon: '🍵', tag: 'Healthy' },
        { name: tx(safeLang, 'Raf Qəhvə', 'Раф Кофе', 'Raf Coffee'), icon: '🍮', tag: 'Sweet' }
      ];
    }

    if (isMorning) {
      comboTitle = tx(safeLang, 'Səhər Kombosu 🌅', 'Утреннее Комбо 🌅', 'Morning Combo 🌅');
      comboItems = [
        { name: tx(safeLang, 'Kruassan + Double Espresso', 'Круассан + Дабл Эспрессо', 'Croissant + Double Espresso'), desc: tx(safeLang, 'Gününüzü enerjili başlayın', 'Начните день энергично', 'Kickstart your day with energy'), icon: '🥐☕' }
      ];
    } else if (isAfternoon) {
      comboTitle = tx(safeLang, 'Günorta Şirniyyat Kombosu ☀️', 'Дневное Комбо ☀️', 'Afternoon Combo ☀️');
      comboItems = [
        { name: tx(safeLang, 'Kruassan / Kukis + Flat White', 'Круассан / Печенье + Флэт Уайт', 'Croissant / Cookie + Flat White'), desc: tx(safeLang, 'Günün qalan hissəsi üçün xoş fasilə', 'Приятный перерыв на остаток дня', 'A sweet pause for the rest of the day'), icon: '🍪☕' }
      ];
    } else {
      comboTitle = tx(safeLang, 'Axşam Rahatlığı Kombosu 🌙', 'Вечернее Комбо 🌙', 'Evening Cozy Combo 🌙');
      comboItems = [
        { name: tx(safeLang, 'Çizkeyk + Bitki Çayı', 'Чизкейк + Травяной Чай', 'Cheesecake + Herbal Tea'), desc: tx(safeLang, 'Günün yorğunluğunu çıxarın', 'Снимите усталость прошедшего дня', 'Wind down and relax'), icon: '🍰🍵' }
      ];
    }

    return { weatherTitle, weatherDesc, recommendedDrinks, comboTitle, comboItems };
  };
  const rewards = Array.isArray(wallet?.rewards) ? wallet.rewards : [];
  const pendingClaims = Array.isArray(data?.pending_claims) ? data.pending_claims : [];
  const progressPercent = wallet?.next_reward_at ? Math.min(100, Math.round((Number(wallet.progress_current || 0) / Number(wallet.next_reward_at || 1)) * 100)) : 0;
  const primaryColor = String(branding?.primary_color || '#14b8a6');
  const accentColor = String(branding?.accent_color || '#7c3aed');
  const programMode = String(wallet?.program_mode || 'points').toLowerCase();
  const showQrCard = branding?.show_qr_card !== false;
  const showWallet = branding?.show_wallet !== false;
  const balanceSuffix = programMode === 'cashback' ? ' ₼' : '';
  const heroImage = String(branding?.hero_image_url || '');
  const backgroundImage = String(branding?.background_image_url || '');
  const backgroundColor = String(branding?.background_color || data?.customer_app_settings?.background_color || '#0b1220');
  const aiBaristaEnabled = branding?.ai_barista_enabled === true;

  const initOneSignalSDK = React.useCallback((appId: string, cardId: string, token: string) => {
    if (!appId) return;
    try {
      window.OneSignal = window.OneSignal || [];
      window.OneSignal.push(async () => {
        await window.OneSignal.init({
          appId: appId,
          allowLocalhostAsSecureOrigin: true,
        });
        const userId = await window.OneSignal.User.PushSubscription.id;
        if (userId) {
          localStorage.setItem('push_token', userId);
          try {
            await save_push_token_live(cardId, userId, token);
            console.log('OneSignal Push token synced with backend:', userId);
          } catch (pErr) {
            console.warn('Failed to sync OneSignal push token:', pErr);
          }
        }
      });

      if (!document.getElementById('onesignal-sdk')) {
        const script = document.createElement('script');
        script.id = 'onesignal-sdk';
        script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
        script.defer = true;
        document.head.appendChild(script);
      }
    } catch (e) {
      console.warn('Failed to load OneSignal SDK:', e);
    }
  }, []);

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
      
      if (session.onesignal_app_id) {
        initOneSignalSDK(session.onesignal_app_id, sessionCreds.cardId, sessionCreds.token);
      }

      if (Capacitor.isNativePlatform()) {
        const cachedPushToken = localStorage.getItem('push_token');
        if (cachedPushToken) {
          try {
            await save_push_token_live(sessionCreds.cardId, cachedPushToken, sessionCreds.token);
          } catch (pErr) {
            console.warn('Failed to sync push token in load', pErr);
          }
        }
      }
    } catch (e: any) {
      console.error('CustomerApp: session load failed:', e?.message || e, e?.stack);
      setError(String(e?.message || 'Customer app failed to load'));
    } finally {
      setLoading(false);
    }
  }, [sessionCreds.cardId, sessionCreds.token, initOneSignalSDK]);

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
        console.error('CustomerApp: bootstrap failed:', e?.message || e, e?.stack);
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

  React.useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    const SpeechLib = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechLib) {
      const rec = new SpeechLib();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = safeLang === 'az' ? 'az-AZ' : safeLang === 'ru' ? 'ru-RU' : 'en-US';
      rec.onstart = () => setIsListening(true);
      rec.onend = () => setIsListening(false);
      rec.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setBaristaInput(text);
      };
      recognitionRef.current = rec;
    }
  }, [safeLang]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      if (Capacitor.isNativePlatform()) {
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      }
      recognitionRef.current.start();
    }
  };

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
      if (Capacitor.isNativePlatform()) {
        try {
          await Haptics.notification({ type: NotificationType.Success });
        } catch (hErr) {
          console.warn('Haptics failed', hErr);
        }
      }
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
        localStorage.setItem('customer_card_id', created.card_id);
        localStorage.setItem('customer_token', created.token);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('id', created.card_id);
        nextUrl.searchParams.set('t', created.token);
        nextUrl.searchParams.delete('join');
        window.history.replaceState({}, '', nextUrl.toString());

        if (Capacitor.isNativePlatform()) {
          const cachedPushToken = localStorage.getItem('push_token');
          if (cachedPushToken) {
            try {
              await save_push_token_live(created.card_id, cachedPushToken, created.token);
            } catch (pErr) {
              console.warn('Failed to sync push token in enroll', pErr);
            }
          }
        }
      }
    } catch (e: any) {
      setError(String(e?.message || 'Customer enrollment failed'));
    } finally {
      setAcceptingConsent(false);
    }
  };

  const handleSendOtp = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone || trimmedPhone.length < 7) {
      setOtpError(tx(safeLang, 'Düzgün telefon nömrəsi daxil edin', 'Введите корректный номер телефона', 'Please enter a valid phone number'));
      return;
    }
    try {
      setOtpSending(true);
      setOtpError('');
      await send_customer_otp_live(trimmedPhone);
      setOtpSent(true);
    } catch (e: any) {
      setOtpError(String(e?.message || 'OTP send failed'));
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    const trimmedCode = otpCode.trim();
    if (trimmedCode.length < 4) {
      setOtpError(tx(safeLang, 'Təsdiq kodu 4 rəqəmli olmalıdır', 'Код должен быть 4-значным', 'OTP must be 4 digits'));
      return;
    }
    try {
      setOtpVerifying(true);
      setOtpError('');
      const currentUrl = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const joinCustomerType = currentUrl?.searchParams.get('club') || bootstrapData?.join_customer_type || 'golden';
      const joinDiscount = Number(currentUrl?.searchParams.get('discount') || bootstrapData?.join_discount_percent || 0);
      
      const res = await verify_customer_otp_live(phone, trimmedCode, joinCustomerType, joinDiscount);
      const next = { cardId: res.card_id, token: res.token };
      setSessionCreds(next);
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('customer_card_id', res.card_id);
        localStorage.setItem('customer_token', res.token);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('id', res.card_id);
        nextUrl.searchParams.set('t', res.token);
        nextUrl.searchParams.delete('join');
        window.history.replaceState({}, '', nextUrl.toString());

        if (Capacitor.isNativePlatform()) {
          const cachedPushToken = localStorage.getItem('push_token');
          if (cachedPushToken) {
            try {
              await save_push_token_live(res.card_id, cachedPushToken, res.token);
            } catch (pErr) {
              console.warn('Failed to sync push token in enroll', pErr);
            }
          }
        }
      }
    } catch (e: any) {
      setOtpError(String(e?.message || 'OTP verification failed'));
    } finally {
      setOtpVerifying(false);
    }
  };

  const handleBypassLogin = async () => {
    const testPhone = '+994501234567';
    const testCode = '1234';
    try {
      setOtpVerifying(true);
      setOtpError('');
      setPhone(testPhone);
      setOtpCode(testCode);
      
      await send_customer_otp_live(testPhone);
      
      const currentUrl = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const joinCustomerType = currentUrl?.searchParams.get('club') || bootstrapData?.join_customer_type || 'golden';
      const joinDiscount = Number(currentUrl?.searchParams.get('discount') || bootstrapData?.join_discount_percent || 0);
      
      const res = await verify_customer_otp_live(testPhone, testCode, joinCustomerType, joinDiscount);
      const next = { cardId: res.card_id, token: res.token };
      setSessionCreds(next);
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('customer_card_id', res.card_id);
        localStorage.setItem('customer_token', res.token);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('id', res.card_id);
        nextUrl.searchParams.set('t', res.token);
        nextUrl.searchParams.delete('join');
        window.history.replaceState({}, '', nextUrl.toString());

        if (Capacitor.isNativePlatform()) {
          const cachedPushToken = localStorage.getItem('push_token');
          if (cachedPushToken) {
            try {
              await save_push_token_live(res.card_id, cachedPushToken, res.token);
            } catch (pErr) {
              console.warn('Failed to sync push token in enroll', pErr);
            }
          }
        }
      }
    } catch (e: any) {
      setOtpError(String(e?.message || 'Bypass login failed'));
    } finally {
      setOtpVerifying(false);
    }
  };

  const sendBaristaMessage = async () => {
    const prompt = baristaInput.trim();
    if (!prompt) return;

    setBaristaMessages((prev) => [...prev, { role: 'user', text: prompt }]);
    setBaristaInput('');

    setBaristaMessages((prev) => [...prev, { role: 'assistant', text: '...' }]);

    try {
      const history = baristaMessages
        .filter(m => m.text !== '...')
        .map(m => ({ role: m.role, content: m.text }));
      const apiMessages = [...history, { role: 'user', content: prompt }];

      const res = await chat_customer_barista_live(apiMessages, sessionCreds.cardId, sessionCreds.token, lang);
      
      if (voiceEnabled && window.speechSynthesis && res.message) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(res.message);
        utterance.lang = safeLang === 'az' ? 'az-AZ' : safeLang === 'ru' ? 'ru-RU' : 'en-US';
        window.speechSynthesis.speak(utterance);
      }

      setBaristaMessages((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].text === '...') {
          next[next.length - 1] = { role: 'assistant', text: res.message || 'Error occurred' };
        } else {
          next.push({ role: 'assistant', text: res.message || 'Error occurred' });
        }
        return next;
      });
    } catch (e: any) {
      setBaristaMessages((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].text === '...') {
          next[next.length - 1] = { role: 'assistant', text: tx(lang, 'Bağlantı xətası baş verdi.', 'Ошибка подключения.', 'Connection error occurred.') };
        }
        return next;
      });
    }
  };

  const analyzeImageUrl = async (src: string) => {
    setFortuneImage(src);
    setFortuneText('');
    setFortuneLoading(true);
    setFortuneProgress(0);
    setFortuneStepText(tx(safeLang, 'Qəhvə köpükləri təhlil edilir...', 'Анализ кофейной пенки...', 'Analyzing coffee bubbles...'));

    let apiResult: string | null = null;
    let apiError: string | null = null;

    // Start API request in background
    const apiPromise = analyze_customer_fortune_live(src, sessionCreds.cardId, sessionCreds.token, lang)
      .then(res => {
        apiResult = res.fortune || '';
      })
      .catch(e => {
        apiError = tx(safeLang, 'Şəkil analiz edilə bilmədi.', 'Не удалось проанализировать изображение.', 'Failed to analyze the image.');
      });

    let currentProgress = 0;
    const interval = setInterval(async () => {
      currentProgress += Math.floor(Math.random() * 5) + 3; // increment by 3-7%
      if (currentProgress >= 100) {
        currentProgress = 100;
        clearInterval(interval);
        
        // Wait for API to resolve
        await apiPromise;

        setFortuneProgress(100);
        setFortuneText(apiResult || apiError || 'Fortune not available');
        setFortuneLoading(false);
        playShimmerSound();

        // Haptic feedback when loading finishes
        if (Capacitor.isNativePlatform()) {
          try {
            await Haptics.notification({ type: NotificationType.Success });
          } catch {}
        }
      } else {
        setFortuneProgress(currentProgress);
        
        // Update step text based on progress
        if (currentProgress < 30) {
          setFortuneStepText(tx(safeLang, 'Qəhvə köpükləri təhlil edilir...', 'Анализ кофейной пенки...', 'Analyzing coffee bubbles...'));
        } else if (currentProgress < 65) {
          setFortuneStepText(tx(safeLang, 'Ulduz xəritəniz oxunur...', 'Чтение звездной карты...', 'Reading star map...'));
        } else if (currentProgress < 90) {
          setFortuneStepText(tx(safeLang, 'AI Falçı qeydlər yazır...', 'AI предсказатель делает записи...', 'AI fortune teller writing notes...'));
        } else {
          setFortuneStepText(tx(safeLang, 'Nəticə hazırlanır...', 'Подготовка результата...', 'Preparing results...'));
        }

        // Haptic tick for progress animation
        if (currentProgress % 15 === 0 && Capacitor.isNativePlatform()) {
          try {
            await Haptics.impact({ style: ImpactStyle.Light });
          } catch {}
        }
      }
    }, 150);
  };

  const analyzeImageFortune = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      analyzeImageUrl(src);
    };
    reader.readAsDataURL(file);
  };

  const takePhotoWithCamera = async () => {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        quality: 90,
      });
      if (photo.base64String) {
        const src = `data:image/jpeg;base64,${photo.base64String}`;
        analyzeImageUrl(src);
        if (Capacitor.isNativePlatform()) {
          try {
            await Haptics.notification({ type: NotificationType.Success });
          } catch (hErr) {
            console.warn('Haptics failed', hErr);
          }
        }
      }
    } catch (e: any) {
      console.warn('Camera photo failed or cancelled', e);
    }
  };

  React.useEffect(() => {
    if (!('geolocation' in navigator)) return;

    const CAFE_LAT = 40.37767;
    const CAFE_LNG = 49.84583;
    const GEOFENCE_RADIUS_METERS = 100;

    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371e3;
      const phi1 = (lat1 * Math.PI) / 180;
      const phi2 = (lat2 * Math.PI) / 180;
      const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
      const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

      const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return R * c;
    };

    let lastNotifiedAt = 0;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const dist = getDistance(
          position.coords.latitude,
          position.coords.longitude,
          CAFE_LAT,
          CAFE_LNG
        );

        if (dist <= GEOFENCE_RADIUS_METERS) {
          const now = Date.now();
          if (now - lastNotifiedAt > 3600000) {
            lastNotifiedAt = now;
            
            if ('Notification' in window) {
              if (Notification.permission === 'granted') {
                new Notification('iRonWaves-ə yaxınsan! ☕', {
                  body: 'İçəri keç, ulduzlarını qəhvəyə çevir! 🌟',
                  icon: branding.logo_url || '',
                });
              } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((permission) => {
                  if (permission === 'granted') {
                    new Notification('iRonWaves-ə yaxınsan! ☕', {
                      body: 'İçəri keç, ulduzlarını qəhvəyə çevir! 🌟',
                      icon: branding.logo_url || '',
                    });
                  }
                });
              }
            }

            setGeofenceAlert(true);
          }
        }
      },
      (err) => {
        console.warn('Geolocation watching failed', err);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [branding.logo_url]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ background: '#0b1220' }}>
        <div className="flex flex-col items-center gap-5">
          <div className="relative h-12 w-12">
            <div
              className="absolute inset-0 animate-spin rounded-full border-[3px] border-t-transparent"
              style={{ borderColor: 'rgba(250,204,21,0.2)', borderTopColor: '#facc15' }}
            />
          </div>
          <p className="text-[13px] font-medium tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {tx(safeLang, 'Yüklənir...', 'Загрузка...', 'Loading...')}
          </p>
        </div>
      </div>
    );
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
          <section className="rounded-[30px] border border-white/10 bg-slate-900/60 backdrop-blur-xl p-5 text-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <div className="text-lg font-black text-white">{tx(safeLang, 'Giriş və Qeydiyyat', 'Вход и Регистрация', 'Sign in & Sign up')}</div>
            
            <div className="mt-3 rounded-2xl bg-white/5 p-4 text-xs leading-5 text-slate-300 border border-white/5">
              <span className="font-bold text-white block mb-1">{tx(safeLang, 'Müştəri razılaşması:', 'Согласие клиента:', 'Customer consent:')}</span>
              {bootstrapData?.consent_text || tx(safeLang, 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.', 'Я согласен на участие в программе лояльности.', 'I agree to join the loyalty program.')}
            </div>

            {!otpSent ? (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">{tx(safeLang, 'Telefon nömrəniz', 'Номер телефона', 'Phone number')}</label>
                <input
                  type="tel"
                  placeholder="+994 50 123 45 67"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <button
                  type="button"
                  disabled={otpSending || otpVerifying}
                  onClick={handleSendOtp}
                  className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60 transition active:scale-98 hover:brightness-110"
                  style={{ backgroundColor: joinPrimary }}
                >
                  {otpSending ? '...' : tx(safeLang, 'Razıyam və kod göndər', 'Согласен и отправить код', 'Accept and send code')}
                </button>

                <button
                  type="button"
                  disabled={otpSending || otpVerifying}
                  onClick={handleBypassLogin}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-sm font-bold text-white transition active:scale-98 flex items-center justify-center gap-2"
                >
                  ⚡ {tx(safeLang, 'Test Girişi (Bypass OTP)', 'Тестовый вход (Bypass OTP)', 'Test Login (Bypass OTP)')}
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">{tx(safeLang, 'Təsdiq kodu', 'Код подтверждения', 'Verification code')}</label>
                <input
                  type="number"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  placeholder="1234"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-lg font-bold text-white placeholder-white/20 tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <button
                  type="button"
                  disabled={otpVerifying}
                  onClick={handleVerifyOtp}
                  className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60 transition active:scale-98 hover:brightness-110"
                  style={{ backgroundColor: joinPrimary }}
                >
                  {otpVerifying ? '...' : tx(safeLang, 'Daxil ol / Təsdiq et', 'Войти / Подтвердить', 'Sign in / Verify')}
                </button>
                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  className="w-full text-center text-xs font-semibold text-slate-400 hover:text-slate-200 underline mt-2"
                >
                  {tx(safeLang, 'Nömrəni dəyiş', 'Изменить номер', 'Change number')}
                </button>
              </div>
            )}

            {otpError && (
              <p className="mt-3 text-center text-xs font-medium text-red-200 bg-red-500/10 rounded-xl py-2 px-3 border border-red-500/20">
                {otpError}
              </p>
            )}
          </section>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6" style={{ background: '#0b1220' }}>
        <div className="w-full max-w-sm rounded-3xl border p-6 text-center" style={{ borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.06)' }}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(239,68,68,0.1)' }}>
            <span className="text-2xl">⚠️</span>
          </div>
          <h1 className="text-lg font-bold text-white">{tx(safeLang, 'Tətbiq açıla bilmədi', 'Приложение не открылось', 'App could not be opened')}</h1>
          <p className="mt-2 text-[13px] text-red-200/70">{error || 'Invalid customer link'}</p>

          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('customer_card_id');
              localStorage.removeItem('customer_token');
              setSessionCreds({ cardId: '', token: '' });
              setError('');
            }}
            className="mt-6 w-full rounded-2xl bg-white/10 py-3 text-sm font-semibold text-white transition hover:bg-white/15 active:scale-[0.98]"
          >
            {tx(safeLang, 'Sessiyanı Sıfırla & Geri Dön', 'Сбросить сессию и вернуться', 'Reset Session & Go Back')}
          </button>

          <button
            type="button"
            onClick={() => setShowDevSettings(!showDevSettings)}
            className="mt-4 block w-full text-center text-xs text-white/40 underline hover:text-white/60"
          >
            {showDevSettings 
              ? tx(safeLang, 'Ayarları gizlə', 'Скрыть настройки', 'Hide settings')
              : tx(safeLang, 'İnkişaf etdirici ayarları', 'Настройки разработчика', 'Developer settings')}
          </button>

          {showDevSettings && (
            <div className="mt-4 text-left border-t border-white/10 pt-4 space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1">
                  API Base URL
                </label>
                <input
                  type="text"
                  placeholder="https://api.example.com"
                  value={customApiUrl}
                  onChange={(e) => setCustomApiUrl(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/30"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1">
                  Tenant Domain
                </label>
                <input
                  type="text"
                  placeholder="super.ironwaves.store"
                  value={customTenantDomain}
                  onChange={(e) => setCustomTenantDomain(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/30"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (customApiUrl.trim()) {
                      localStorage.setItem('ironwaves_custom_api_base_url', customApiUrl.trim());
                    } else {
                      localStorage.removeItem('ironwaves_custom_api_base_url');
                    }
                    if (customTenantDomain.trim()) {
                      localStorage.setItem('mobile_tenant_domain', customTenantDomain.trim());
                    } else {
                      localStorage.removeItem('mobile_tenant_domain');
                    }
                    window.location.reload();
                  }}
                  className="flex-1 rounded-xl bg-white/20 py-2 text-xs font-bold text-white hover:bg-white/25 transition active:scale-[0.95]"
                >
                  {tx(safeLang, 'Yadda saxla', 'Сохранить', 'Save')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('ironwaves_custom_api_base_url');
                    localStorage.removeItem('mobile_tenant_domain');
                    window.location.reload();
                  }}
                  className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/25 transition active:scale-[0.95]"
                >
                  {tx(safeLang, 'Sıfırla', 'Сбросить', 'Reset')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }


  const aiFalciEnabled = branding.ai_falci_enabled === true;

  const bottomTabs = [
    { key: 'home' as CustomerTab, label: tx(safeLang, 'Ana Səhifə', 'Главная', 'Home'), icon: <Home size={18} /> },
    { key: 'offers' as CustomerTab, label: tx(safeLang, 'Kampaniyalar', 'Кампании', 'Offers'), icon: <Gift size={18} /> },
    ...(aiBaristaEnabled ? [{ key: 'barista' as CustomerTab, label: tx(safeLang, 'Barista', 'Бариста', 'Barista'), icon: <MessageSquare size={18} /> }] : []),
    ...(aiFalciEnabled ? [{ key: 'falci' as CustomerTab, label: tx(safeLang, 'Falçı', 'Фалчы', 'Fortune'), icon: <Sparkles size={18} /> }] : []),
    { key: 'profile', label: tx(safeLang, 'Profil', 'Профиль', 'Profile'), icon: <UserRound size={18} /> },
  ];

  const resolvedActiveTab: CustomerTab =
    (activeTab === 'barista' && !aiBaristaEnabled) || (activeTab === 'falci' && !aiFalciEnabled)
      ? 'home'
      : activeTab;
  const layoutPreset = String(data.customer_app_settings?.layout_preset || 'rewards').toLowerCase();
  const rewardCardStyle = String(branding.reward_card_style || data.customer_app_settings?.reward_card_style || 'rounded').toLowerCase();
  const heroRadius = layoutPreset === 'playful' ? '36px' : '32px';
  const cardRadiusClass = rewardCardStyle === 'glass' ? 'rounded-[30px]' : rewardCardStyle === 'soft-square' ? 'rounded-[18px]' : 'rounded-[28px]';
  const cardClass = layoutPreset === 'playful'
    ? `${cardRadiusClass} border border-white/10 bg-white/95 p-4 text-slate-900 shadow-[0_10px_28px_rgba(236,72,153,0.16)]`
    : `${cardRadiusClass} border border-white/10 p-6 text-white shadow-xl`;
  const renderHome = () => (
    <div className="space-y-4">
      {/* Custom Styles for Animations */}
      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); }
          to { opacity: 1; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9) translateY(20px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes sparkle {
          0% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0) rotate(180deg); opacity: 0; }
        }
        .animate-modalFadeIn {
          animation: modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-scaleIn {
          animation: scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .animate-sparkle {
          animation: sparkle 0.8s cubic-bezier(0.25, 1, 0.5, 1) forwards;
        }
      `}</style>

      {/* Dynamic Welcoming Greeting Banner */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-1.5">
            <span>{getGreeting()}</span>
            <span className="text-amber-400 font-normal">
              {new Date().getHours() >= 5 && new Date().getHours() < 12 ? '🌅' : new Date().getHours() >= 12 && new Date().getHours() < 18 ? '☀️' : '🌙'}
            </span>
          </h2>
          <p className="text-[11px] text-white/50 font-bold mt-0.5 uppercase tracking-wider">
            {tx(safeLang, 'iRonWaves Loyalty proqramına xoş gəldiniz', 'Добро пожаловать в iRonWaves Loyalty', 'Welcome to iRonWaves Loyalty')}
            {getFirstName()}
          </p>
        </div>
      </div>

      {/* Geofence Alert Banner */}
      {geofenceAlert && (
        <div
          className="flex items-center justify-between gap-3 rounded-2xl p-4 animate-pulse"
          style={{
            background: 'linear-gradient(135deg, rgba(250,204,21,0.15) 0%, rgba(34,211,238,0.15) 100%)',
            border: '1px solid rgba(250,204,21,0.3)',
            backdropFilter: 'blur(12px)'
          }}
        >
          <div className="flex gap-3">
            <span className="text-2xl">☕</span>
            <div>
              <h4 className="text-[13px] font-black text-yellow-400">
                {tx(safeLang, 'iRonWaves-ə yaxınsan!', 'Рядом с iRonWaves!', 'Near iRonWaves!')}
              </h4>
              <p className="mt-0.5 text-[11px] text-slate-200">
                {tx(safeLang, 'İçəri keç, ulduzlarını qəhvəyə çevir! 🌟', 'Заходи, преврати свои звезды в кофе! 🌟', 'Come in and turn your stars into coffee! 🌟')}
              </p>
            </div>
          </div>
          <button
            onClick={() => setGeofenceAlert(false)}
            className="text-[14px] font-bold text-white/60 hover:text-white px-2 py-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Premium Digital Membership Card */}
      <section
        onClick={async (e) => {
          spawnParticles(e);
          setShowFullQr(true);
          playTickSound();
          if (Capacitor.isNativePlatform()) {
            try {
              await Haptics.impact({ style: ImpactStyle.Medium });
            } catch (hErr) {
              console.warn('Haptics failed', hErr);
            }
          }
        }}
        className="relative overflow-hidden border p-6 transition-all duration-300 active:scale-[0.99] hover:border-white/20 group cursor-pointer"
        style={{
          borderRadius: '28px',
          borderColor: 'rgba(255, 255, 255, 0.12)',
          background: heroImage
            ? `linear-gradient(180deg, rgba(15, 23, 42, 0.2), rgba(15, 23, 42, 0.8)), url(${heroImage}) center/cover`
            : `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)`,
          boxShadow: `0 20px 45px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)`,
        }}
      >
        {/* Render interactive particles */}
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute pointer-events-none text-amber-400 select-none animate-sparkle z-50"
            style={{
              left: p.x,
              top: p.y,
              fontSize: `${p.size}px`,
              '--dx': `${Math.cos(p.angle) * p.speed * 20}px`,
              '--dy': `${Math.sin(p.angle) * p.speed * 20}px`,
            } as React.CSSProperties}
          >
            ✨
          </div>
        ))}

        {/* Glossy Card Reflection Sweep */}
        <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-[1500ms] ease-out pointer-events-none" />

        {/* Card Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/70">
                {branding.app_name || 'Loyalty Club'}
              </p>
            </div>
            <h1 className="mt-2 text-2xl font-black text-white tracking-tight">
              {branding.hero_title || tx(safeLang, 'Xoş gəldiniz', 'Добro пожаловать', 'Welcome')}
            </h1>
          </div>
          {branding.logo_url ? (
            <img
              src={branding.logo_url}
              alt="brand"
              className="h-12 w-12 rounded-2xl object-cover shadow-2xl border-2 border-white/20"
            />
          ) : (
            <div className="h-12 w-12 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 text-xl">
              👑
            </div>
          )}
        </div>

        {/* Card Chip & Contactless Indicator */}
        <div className="mt-6 flex items-center justify-between">
          {/* SIM Chip Icon */}
          <div className="relative w-10 h-7 rounded-md bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-300 border border-amber-500/20 shadow-inner overflow-hidden flex flex-col justify-between p-1 opacity-85">
            <div className="flex justify-between h-px bg-slate-950/20 mt-1" />
            <div className="flex justify-between h-px bg-slate-950/20" />
            <div className="flex justify-between h-px bg-slate-950/20 mb-1" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-950/20" />
          </div>

          {/* Tap to Scan Guide */}
          <div className="text-[9px] font-bold uppercase tracking-wider text-white/40 flex items-center gap-1 bg-black/20 rounded-full px-2.5 py-1 border border-white/5 backdrop-blur-sm animate-pulse">
            <span>✨</span>
            <span>{tx(safeLang, 'Skan Etmək Üçün Toxun', 'Коснитесь для скана', 'Tap to Scan')}</span>
          </div>

          {/* Contactless waves */}
          <div className="text-white/50">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4zm11-6.5c0-.83.67-1.5 1.5-1.5C20.09 4 24 7.91 24 12.5S20.09 21 16.5 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5c2.48 0 4.5-2.02 4.5-4.5S18.98 9 16.5 9c-.83 0-1.5-.67-1.5-1.5zm-5-3C10.5 2.17 11.17 1.5 12 1.5C17.79 1.5 22.5 6.21 22.5 12S17.79 22.5 12 22.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5c4.14 0 7.5-3.36 7.5-7.5s-3.36-7.5-7.5-7.5c-.83 0-1.5-.67-1.5-1.5z" />
            </svg>
          </div>
        </div>

        {/* Card Details Container */}
        {showWallet && (
          <div
            className="mt-6 rounded-2xl p-4 bg-white/[0.07] border border-white/10 backdrop-blur-md shadow-2xl space-y-4"
          >
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">
                  {wallet.points_label || 'Ulduz'}
                </p>
                <p className="mt-1 text-3xl font-black text-white tracking-tight">
                  {Number(wallet.stars_balance ?? 0).toFixed(programMode === 'cashback' ? 2 : 0)}
                  {balanceSuffix}
                </p>
              </div>
              <div className="text-right">
                <span className="inline-block rounded-full bg-white/10 border border-white/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-white uppercase backdrop-blur-sm">
                  {programMode === 'cashback' ? `${Number(wallet.cashback_percent || 0).toFixed(0)}% cashback` : (customer.type || 'Member')}
                </span>
              </div>
            </div>

            {/* Visual Stars Grid / Milestone Tracker */}
            {programMode === 'points' ? (
              <div className="border-t border-white/5 pt-4">
                <div className="relative my-4 px-2 select-none">
                  {/* Track line */}
                  <div className="h-2 w-full rounded-full bg-black/40 border border-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 transition-all duration-1000"
                      style={{ width: `${Math.min(100, (Number(wallet.stars_balance ?? 0) / Number(wallet.next_reward_at || 10)) * 100)}%` }}
                    />
                  </div>

                  {/* Milestones */}
                  {[
                    { stars: Math.round(Number(wallet.next_reward_at || 10) * 0.3), label: tx(safeLang, 'Çay/Espresso', 'Чай/Эспрессо', 'Tea/Espresso') },
                    { stars: Math.round(Number(wallet.next_reward_at || 10) * 0.6), label: tx(safeLang, 'Cappuccino/Latte', 'Капучино/Латте', 'Cappuccino/Latte') },
                    { stars: Number(wallet.next_reward_at || 10), label: tx(safeLang, 'Böyük Qəhvə + Şirniyyat', 'Большой Кофе + Десерт', 'Large Coffee + Pastry') }
                  ].map((m, mIdx) => {
                    const mPercent = (m.stars / Number(wallet.next_reward_at || 10)) * 100;
                    const isUnlocked = Number(wallet.stars_balance ?? 0) >= m.stars;
                    return (
                      <div
                        key={mIdx}
                        className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer"
                        style={{ left: `${mPercent}%` }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (Capacitor.isNativePlatform()) {
                            Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
                          }
                        }}
                      >
                        <div
                          className={`h-4.5 w-4.5 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
                            isUnlocked
                              ? 'bg-gradient-to-br from-yellow-300 to-amber-500 border-amber-600 scale-110 shadow-[0_0_10px_rgba(245,158,11,0.8)]'
                              : 'bg-slate-900 border-white/20'
                          }`}
                        >
                          {isUnlocked && <span className="text-[8px] text-slate-950 font-bold">✓</span>}
                        </div>
                        {/* Tooltip on Hover/Tap */}
                        <div className="absolute bottom-6 scale-0 group-hover:scale-100 transition-transform origin-bottom duration-200 bg-slate-950/95 border border-white/10 px-2.5 py-1 rounded-xl shadow-2xl text-[9px] font-extrabold text-white whitespace-nowrap z-30">
                          {m.stars} {wallet.points_label || 'Ulduz'}: {m.label}
                        </div>
                        <span className="text-[8px] font-bold text-white/40 mt-1 font-mono">{m.stars}★</span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 text-center text-[11px] font-bold text-white/70">
                  {tx(
                    safeLang,
                    `${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} ulduz topladınız`,
                    `Вы собрали ${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} звезд`,
                    `Collected ${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} stars`
                  )}
                </div>
              </div>
            ) : (
              /* Cashback progress bar */
              <div className="border-t border-white/5 pt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-black/35">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-white/50">
                  <span>{tx(safeLang, 'Növbəti reward', 'Следующая награда', 'Next reward')}</span>
                  <span className="font-bold text-white/80">{wallet.reward_name || 'Reward'} ({progressPercent}%)</span>
                </div>
              </div>
            )}

            {/* Apple & Google Wallet Integration */}
            <div className="pt-3 border-t border-white/5 flex flex-row gap-2 justify-center items-center">
              <a
                href={get_customer_wallet_pass_url(sessionCreds.cardId, sessionCreds.token, safeLang)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-black/80 hover:bg-black/90 py-2 border border-white/10 hover:border-white/20 transition text-[10px] font-semibold text-white active:scale-95"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.75.8-.01 1.99-.79 3.61-.63 1.68.07 2.92.74 3.69 1.95-3.41 2.03-2.87 6.99.78 8.44-.8 2.05-1.74 4.02-3.16 5.46zM15.42 4.38c.75-.92 1.25-2.2 1.11-3.49-1.11.05-2.46.75-3.26 1.69-.69.8-1.3 2.1-1.13 3.37 1.23.1 2.5-.62 3.28-1.57z" />
                </svg>
                {tx(safeLang, 'Apple Wallet', 'Apple Wallet', 'Apple Wallet')}
              </a>
              <a
                href={get_customer_wallet_pass_url(sessionCreds.cardId, sessionCreds.token, safeLang)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-black/80 hover:bg-black/90 py-2 border border-white/10 hover:border-white/20 transition text-[10px] font-semibold text-white active:scale-95"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 1.56-1.56 2.95-3.24 3.51v2.9h5.24c3.07-2.83 4.83-7 4.83-11.64c0-.52-.05-1.04-.17-1.5zM12.18 21c2.43 0 4.47-.8 5.96-2.18l-5.24-2.9c-1.46.99-3.29 1.56-5.96 1.56c-4.59 0-8.48-3.11-9.86-7.3H1.66v3.01C4.46 18.77 8.08 21 12.18 21z" />
                </svg>
                {tx(safeLang, 'Google Wallet', 'Google Wallet', 'Google Wallet')}
              </a>
            </div>
          </div>
        )}

        {/* Card Number printed at the bottom like credit card */}
        <div className="mt-5 flex items-center justify-between text-white/50 text-[11px] font-mono tracking-[0.2em]">
          <span>{formatCardId(customer.card_id)}</span>
          <span className="text-[10px] opacity-75">{tx(safeLang, 'LOYALLIQ', 'ЛОЯЛЬНОСТЬ', 'LOYALTY')}</span>
        </div>
      </section>

      {/* Rewards + QR grid */}
      <div className="grid grid-cols-2 gap-3.5">
        <section
          className="rounded-[24px] p-5 flex flex-col justify-between border border-white/[0.06] backdrop-blur-md shadow-lg transition hover:border-white/10"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}
        >
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/50">
              <Gift size={14} className="text-amber-400 animate-bounce" />
              {tx(safeLang, 'Rewards', 'Награды', 'Rewards')}
            </div>
            <div className="mt-3 text-4xl font-black text-white tracking-tight">
              {wallet.available_rewards ?? 0}
            </div>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              {wallet.reward_label || 'Reward'}
            </p>
          </div>
          {rewards[0] && Number(wallet.available_rewards || 0) > 0 ? (
            <button
              type="button"
              disabled={claiming}
              onClick={(e) => { e.stopPropagation(); void claimReward(); }}
              className="relative mt-4 w-full overflow-hidden rounded-xl py-2.5 text-[12px] font-black text-slate-950 transition-all hover:scale-[1.02] active:scale-[0.97] disabled:opacity-50"
              style={{
                background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
                boxShadow: `0 8px 20px ${primaryColor}33`,
              }}
            >
              <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/15 to-transparent -translate-x-full hover:translate-x-full transition-transform duration-1000 ease-out" />
              {claiming ? '...' : tx(safeLang, 'Tətbiq Et', 'Забрать', 'Claim')}
            </button>
          ) : null}
        </section>

        <section
          onClick={async () => {
            setShowFullQr(true);
            playTickSound();
            if (Capacitor.isNativePlatform()) {
              try {
                await Haptics.impact({ style: ImpactStyle.Medium });
              } catch (hErr) {
                console.warn('Haptics failed', hErr);
              }
            }
          }}
          className="rounded-[24px] p-5 flex flex-col justify-between border border-white/[0.06] backdrop-blur-md shadow-lg transition hover:border-white/10 active:scale-[0.98] cursor-pointer"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}
        >
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/50">
            <QrCode size={14} className="text-teal-400" />
            {tx(safeLang, 'QR Kart', 'QR карта', 'QR Card')}
          </div>
          {showQrCard && cardQr ? (
            <div className="mt-3 flex flex-col items-center">
              <div className="p-2.5 bg-white rounded-2xl shadow-2xl border border-white/20">
                <img src={cardQr} alt="qr" className="h-24 w-24 object-contain" />
              </div>
              <p className="mt-2 text-[9px] font-mono tracking-widest text-white/40">{customer.card_id}</p>
            </div>
          ) : (
            <p className="mt-4 text-xs font-mono tracking-widest text-white/60">{customer.card_id}</p>
          )}
        </section>
      </div>

      {/* Contextual Weather & Combo Card */}
      <section
        className="rounded-[28px] p-5 border border-white/[0.06] backdrop-blur-md shadow-lg space-y-4"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌦️</span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/70">
                {tx(safeLang, 'Ağıllı Təkliflərimiz', 'Умные Рекомендации', 'Smart Recommendations')}
              </p>
              <p className="text-[10px] text-white/40 font-mono mt-0.5">
                {simulatedTemp}°C • {simulatedCondition === 'sunny' ? tx(safeLang, 'Günəşli', 'Солнечно', 'Sunny') : tx(safeLang, 'Yağışlı', 'Дождливо', 'Rainy')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (Capacitor.isNativePlatform()) {
                Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
              }
              setSimulatedTemp(t => t > 20 ? 14 : 26);
              setSimulatedCondition(c => c === 'sunny' ? 'rainy' : 'sunny');
            }}
            className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[9px] font-bold text-white/80 hover:bg-white/10 active:scale-95 transition"
          >
            🔄 {tx(safeLang, 'Havanı Dəyiş', 'Сменить погоду', 'Toggle Weather')}
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] text-white/60 font-semibold">{getWeatherInfo().weatherDesc}</p>
          <div className="grid grid-cols-2 gap-2">
            {getWeatherInfo().recommendedDrinks.map((drink, idx) => (
              <div
                key={idx}
                onClick={async () => {
                  setShowFullQr(true);
                  playTickSound();
                  if (Capacitor.isNativePlatform()) {
                    try {
                      await Haptics.impact({ style: ImpactStyle.Light });
                    } catch {}
                  }
                }}
                className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.08] hover:border-white/15 transition cursor-pointer active:scale-95"
              >
                <span className="text-xl">{drink.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-white truncate">{drink.name}</p>
                  <span className="inline-block px-1.5 py-0.5 mt-0.5 rounded-md bg-teal-500/10 text-teal-400 text-[8px] font-black uppercase tracking-wider">
                    {drink.tag}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-3 border-t border-white/5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">
            {getWeatherInfo().comboTitle}
          </p>
          {getWeatherInfo().comboItems.map((combo, idx) => (
            <div
              key={idx}
              onClick={async () => {
                setShowFullQr(true);
                playTickSound();
                if (Capacitor.isNativePlatform()) {
                  try {
                    await Haptics.impact({ style: ImpactStyle.Light });
                  } catch {}
                }
              }}
              className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-r from-amber-500/5 to-yellow-500/5 border border-amber-500/10 hover:from-amber-500/10 hover:to-yellow-500/10 hover:border-amber-500/20 transition cursor-pointer active:scale-[0.98]"
            >
              <span className="text-2xl">{combo.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-amber-300">{combo.name}</p>
                <p className="text-[9px] text-white/50 font-bold mt-0.5">{combo.desc}</p>
              </div>
              <span className="text-[10px] font-extrabold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                Combo
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Sizin Sevimliləriniz Section */}
      {favoriteItems.length > 0 && (
        <section
          className="rounded-[28px] p-5 border border-white/[0.06] backdrop-blur-md shadow-lg"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-amber-400" />
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">
              {tx(safeLang, 'Sizin Sevimliləriniz', 'Ваше любимое', 'Your Favorites')}
            </p>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
            {favoriteItems.map((item) => (
              <div
                key={item.name}
                onClick={async () => {
                  setShowFullQr(true);
                  playTickSound();
                  if (Capacitor.isNativePlatform()) {
                    try {
                      await Haptics.impact({ style: ImpactStyle.Light });
                    } catch {}
                  }
                }}
                className="flex items-center gap-3 shrink-0 rounded-2xl p-3 border border-white/5 bg-slate-950/20 active:scale-95 transition-transform cursor-pointer hover:border-white/10"
                style={{ minWidth: '160px' }}
              >
                <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center text-lg border border-white/5">
                  {item.category === 'coffee' ? '☕' : item.category === 'tea' ? '🍵' : item.category === 'sweet' ? '🍰' : item.category === 'food' ? '🥪' : '🥤'}
                </div>
                <div className="overflow-hidden">
                  <p className="text-[12px] font-bold text-white truncate w-24">{item.name}</p>
                  <p className="text-[9px] text-white/40 mt-0.5 font-semibold">{item.count} {tx(safeLang, 'dəfə', 'раз', 'times')}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pending claim codes */}
      <section
        className="rounded-[28px] p-5 border border-white/[0.06] backdrop-blur-md shadow-lg"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">
              {tx(safeLang, 'Aktiv Kodlar', 'Коды наград', 'Active Codes')}
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: `${accentColor}25`, color: accentColor }}
          >
            {pendingClaims.length}
          </span>
        </div>
        
        <div className="mt-4 flex gap-3.5 overflow-x-auto pb-1.5 scrollbar-hide">
          {pendingClaims.length === 0 ? (
            <div className="w-full rounded-2xl py-6 text-center text-xs text-white/30 border border-dashed border-white/10 bg-white/[0.01]">
              {tx(safeLang, 'Hələ aktiv kodunuz yoxdur', 'Нет активных кодов', 'No active codes yet')}
            </div>
          ) : (
            pendingClaims.map((row: any) => (
              <div
                key={row.id}
                className="relative min-w-[170px] shrink-0 rounded-2xl p-4 overflow-hidden border border-amber-500/20 shadow-inner flex flex-col justify-between"
                style={{
                  background: 'linear-gradient(135deg, rgba(251,191,36,0.06) 0%, rgba(217,119,6,0.06) 100%)',
                }}
              >
                {/* Coupon ticket side notches */}
                <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-slate-950 border-r border-amber-500/20" />
                <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-slate-950 border-l border-amber-500/20" />

                <div>
                  <p className="text-[8px] font-black uppercase tracking-[0.25em] text-amber-400">
                    {tx(safeLang, 'Kassaya Təqdim Et', 'На кассе', 'Present at POS')}
                  </p>
                  <p className="mt-1.5 text-2xl font-black text-white tracking-tight font-mono">
                    {row.claim_code}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-white/50 truncate font-semibold">
                  {row.reward_name}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );

  const renderOffers = () => {
    const activateCampaign = async (campaignId: string) => {
      if (Capacitor.isNativePlatform()) {
        try {
          await Haptics.impact({ style: ImpactStyle.Medium });
        } catch {}
      }
      const expTime = Date.now() + 15 * 60 * 1000;
      setActivatedCampaigns(prev => ({ ...prev, [campaignId]: expTime }));
      playShimmerSound();
      try {
        const qrUrl = await QRCode.toDataURL(`IWPOS:CAMPAIGN:${campaignId}:${customer.card_id}`, {
          width: 180,
          margin: 1,
          color: { dark: '#0f172a', light: '#ffffff' }
        });
        setCampaignQrs(prev => ({ ...prev, [campaignId]: qrUrl }));
      } catch (err) {
        console.error('Failed to generate campaign QR', err);
      }
    };

    return (
      <div className="space-y-4">
        {/* Campaigns List */}
        <section className="rounded-[28px] p-5 border border-white/[0.06] backdrop-blur-md shadow-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] font-bold text-white flex items-center gap-2">
              <Gift size={16} className="text-amber-400" />
              {tx(safeLang, 'Aktiv kampaniyalar', 'Активные кампании', 'Active offers')}
            </p>
            <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold text-black" style={{ backgroundColor: primaryColor }}>{campaigns.length}</span>
          </div>

          <div className="mt-4 space-y-4">
            {campaigns.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
                <Gift size={28} style={{ color: 'rgba(255,255,255,0.2)' }} />
                <p className="text-[13px] text-white/40">{tx(safeLang, 'Hazırda aktiv kampaniya yoxdur', 'Сейчас нет активных кампаний', 'No active campaigns right now')}</p>
              </div>
            ) : campaigns.map((row: any) => {
              const expTime = activatedCampaigns[row.id];
              const isActive = expTime && expTime > Date.now();
              const timeLeftMs = isActive ? expTime - Date.now() : 0;
              const secondsLeft = Math.max(0, Math.floor(timeLeftMs / 1000));
              const minutes = Math.floor(secondsLeft / 60);
              const seconds = secondsLeft % 60;
              const progressPercent = isActive ? Math.max(0, Math.min(100, (secondsLeft / 900) * 100)) : 0;

              return (
                <div
                  key={row.id}
                  className="relative overflow-hidden rounded-[24px] border border-white/10 p-5 shadow-lg transition-all duration-300"
                  style={{
                    background: isActive 
                      ? 'linear-gradient(135deg, rgba(34,197,94,0.06) 0%, rgba(20,184,166,0.06) 100%)' 
                      : 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.04) 100%)',
                    borderColor: isActive ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'
                  }}
                >
                  {/* Coupon ticket side notches */}
                  <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#080c16] border-r border-white/10" style={{ borderColor: isActive ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)' }} />
                  <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#080c16] border-l border-white/10" style={{ borderColor: isActive ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)' }} />

                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h4 className="text-[15px] font-black text-white leading-tight">{row.name}</h4>
                      <p className="mt-1.5 text-[13px] font-extrabold" style={{ color: primaryColor }}>
                        {row.discount_percent}% {tx(safeLang, 'endirim', 'скидка', 'discount')}
                      </p>
                      <p className="mt-2 text-[10px] font-medium text-white/40">
                        {row.start_time} - {row.end_time} • {row.categories || 'ALL'}
                      </p>
                    </div>
                  </div>

                  {isActive ? (
                    <div className="mt-5 pt-4 border-t border-dashed border-white/10 space-y-4">
                      {/* Countdown Timer UI */}
                      <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
                        <span>{tx(safeLang, 'Kod aktivdir', 'Код активен', 'Code is active')}</span>
                        <span className="font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                        </span>
                      </div>

                      {/* Ticking Progress Bar */}
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-1000 rounded-full"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>

                      {/* Revealed QR Code Container */}
                      <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl shadow-xl">
                        {campaignQrs[row.id] ? (
                          <img src={campaignQrs[row.id]} alt="campaign qr" className="h-36 w-36 object-contain" />
                        ) : (
                          <div className="h-36 w-36 flex items-center justify-center text-slate-800 text-xs font-mono">
                            {row.id}
                          </div>
                        )}
                        <p className="mt-2 text-[10px] font-mono font-bold text-slate-900 tracking-widest uppercase">
                          {tx(safeLang, 'KASSAYA TƏQDİM EDİN', 'ПРЕДЪЯВИТЕ НА КАССЕ', 'PRESENT TO CASHIER')}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 pt-3 border-t border-white/5 flex justify-end">
                      <button
                        type="button"
                        onClick={() => activateCampaign(row.id)}
                        className="relative overflow-hidden rounded-xl px-4 py-2 text-[11px] font-black text-slate-950 transition-all hover:scale-[1.02] active:scale-[0.97]"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
                          boxShadow: `0 4px 12px ${primaryColor}22`
                        }}
                      >
                        {tx(safeLang, 'Aktivləşdir', 'Активировать', 'Activate')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Claim codes */}
        <section className="rounded-[28px] p-5 border border-white/[0.06] backdrop-blur-md shadow-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
          <p className="text-[15px] font-bold text-white flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400" />
            {tx(safeLang, 'Claim kodları', 'Коды наград', 'Claim codes')}
          </p>
          <div className="mt-4 space-y-3">
            {pendingClaims.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-white/30 border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
                {tx(safeLang, 'Aktiv claim kodu yoxdur', 'Активных кодов нет', 'No active claim codes')}
              </div>
            ) : pendingClaims.map((row: any) => (
              <div key={row.id} className="relative overflow-hidden rounded-2xl p-4 border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-yellow-500/5 shadow-inner">
                {/* Side notches for ticket feeling */}
                <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#080c16] border-r border-amber-500/20" />
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#080c16] border-l border-amber-500/20" />

                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">{tx(safeLang, 'Kassada göstərin', 'Покажите на кассе', 'Show at POS')}</p>
                <p className="mt-1 text-2xl font-black text-white font-mono">{row.claim_code}</p>
                <p className="mt-1 text-[11px] text-white/50">{row.reward_name}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderBarista = () => (
    <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl space-y-4">
      {/* Custom styles for bouncing dots */}
      <style>{`
        @keyframes dotBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .animate-dotBounce {
          animation: dotBounce 1.2s infinite ease-in-out;
        }
      `}</style>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🤖</span>
          <div>
            <div className="text-md font-black text-white tracking-tight">AI Barista</div>
            <div className="text-[11px] text-white/50 font-semibold">{tx(safeLang, 'Söhbət et, içki və reward tövsiyəsi al.', 'Поговори и получи совет по напиткам и наградам.', 'Chat and get drink and reward suggestions.')}</div>
          </div>
        </div>
        <button
          onClick={async () => {
            setVoiceEnabled(!voiceEnabled);
            if (Capacitor.isNativePlatform()) {
              try {
                await Haptics.impact({ style: ImpactStyle.Light });
              } catch {}
            }
          }}
          className={`h-9 w-9 rounded-xl flex items-center justify-center border transition-all ${
            voiceEnabled 
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
              : 'bg-white/5 border-white/10 text-white/40'
          }`}
        >
          {voiceEnabled ? <Volume2 size={16} className="animate-pulse" /> : <VolumeX size={16} />}
        </button>
      </div>

      <div className="max-h-72 space-y-3.5 overflow-y-auto rounded-[24px] bg-slate-950/35 p-4 border border-white/5">
        {baristaMessages.map((msg, idx) => (
          <div key={`${msg.role}_${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.text === '...' ? (
              <div className="max-w-[80%] rounded-2xl rounded-tl-none px-4 py-3 bg-white/10 border border-white/10 text-slate-100 shadow-md backdrop-blur-md">
                <div className="flex items-center gap-1.5 py-1 px-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300 animate-dotBounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300 animate-dotBounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300 animate-dotBounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            ) : (
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-[13px] font-medium leading-relaxed shadow-md transition-all active:scale-[0.98] ${
                  msg.role === 'user' 
                    ? 'rounded-tr-none text-slate-950' 
                    : 'rounded-tl-none bg-white/[0.08] border border-white/10 text-slate-100 backdrop-blur-md'
                }`}
                style={msg.role === 'user' ? { background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)` } : undefined}
              >
                {msg.text}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {BARISTA_QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setBaristaInput(prompt)}
            className="rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition-all duration-200 hover:scale-[1.03] active:scale-95 shadow-sm"
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 flex items-center">
          <input
            className="neon-input"
            value={baristaInput}
            onChange={(e) => setBaristaInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendBaristaMessage(); }}
            placeholder={tx(safeLang, 'Mənə nə tövsiyə edərsən?', 'Что ты посоветуешь мне?', 'What would you recommend for me?')}
            style={{
              borderRadius: '16px',
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '12px 48px 12px 16px',
              fontSize: '13px',
              color: 'white',
              outline: 'none',
              width: '100%'
            }}
          />
          <button
            type="button"
            onClick={toggleListening}
            className={`absolute right-3 p-1.5 rounded-lg transition-all ${
              isListening 
                ? 'bg-red-500 text-white animate-pulse' 
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            <Mic size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={sendBaristaMessage}
          className="rounded-2xl px-5 py-3 font-black text-[12px] text-slate-950 active:scale-95 transition-transform"
          style={{
            background: `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)`,
            boxShadow: `0 4px 12px ${accentColor}33`
          }}
        >
          {tx(safeLang, 'Göndər', 'Отправить', 'Send')}
        </button>
      </div>
    </section>
  );

  const renderFalci = () => (
    <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl space-y-4">
      {/* Custom float keyframe animation */}
      <style>{`
        @keyframes floatBall {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-8px) scale(1.02); }
        }
        .animate-floatBall {
          animation: floatBall 3s ease-in-out infinite;
        }
      `}</style>

      <div className="flex items-center gap-2">
        <span className="text-xl">🔮</span>
        <div>
          <div className="text-md font-black text-white tracking-tight">AI Falçı</div>
          <div className="text-[11px] text-white/50 font-semibold">{tx(safeLang, 'Bir şəkil yüklə, AI Falçı onun tonuna və ab-havasına baxıb əyləncəli mesaj versin.', 'Загрузи фото, и AI Falçı даст тебе игровое предсказание по атмосфере изображения.', 'Upload an image and AI Fortune Teller will give you a playful reading based on its vibe.')}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-2xl px-5 py-3 font-black text-[12px] text-slate-950 active:scale-95 transition-transform"
          style={{
            background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
            boxShadow: `0 4px 12px ${primaryColor}33`
          }}
        >
          {tx(safeLang, 'Şəkil yüklə', 'Загрузить фото', 'Upload image')}
        </button>
        {Capacitor.isNativePlatform() && (
          <button
            type="button"
            onClick={takePhotoWithCamera}
            className="flex items-center gap-2 rounded-2xl px-5 py-3 font-black text-[12px] text-slate-950 active:scale-95 transition-transform animate-pulse"
            style={{
              background: `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)`,
              boxShadow: `0 4px 12px ${accentColor}33`
            }}
          >
            <CameraIcon size={16} />
            {tx(safeLang, 'Kamera ilə çək', 'Снять на камеру', 'Take Photo')}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) analyzeImageFortune(file);
        }} />
      </div>

      {fortuneImage && (
        <div className="relative rounded-[24px] overflow-hidden border border-white/10 shadow-2xl">
          <img src={fortuneImage} alt="fortune preview" className="h-48 w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
        </div>
      )}

      {fortuneLoading ? (
        <div className="flex flex-col items-center justify-center py-6 space-y-5 rounded-[24px] bg-slate-950/30 border border-white/5 p-5 animate-modalFadeIn">
          {/* Mystical Crystal Ball */}
          <div className="relative h-32 w-32 flex items-center justify-center animate-floatBall">
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-purple-600/35 via-amber-500/25 to-cyan-500/35 animate-pulse blur-xl" />
            <div className="relative h-28 w-28 rounded-full border border-white/20 bg-white/5 backdrop-blur-md shadow-[0_0_40px_rgba(168,85,247,0.35),_inset_0_4px_16px_rgba(255,255,255,0.2)] flex flex-col items-center justify-center overflow-hidden">
              <div className="absolute inset-2 rounded-full border border-dashed border-white/10 animate-ping opacity-20" />
              <span className="text-2xl font-black text-white">{fortuneProgress}%</span>
              <span className="text-[8px] font-black tracking-widest text-amber-400 uppercase mt-1">
                {tx(safeLang, 'TƏHLİL', 'АНАЛИЗ', 'ANALYSIS')}
              </span>
            </div>
          </div>

          <div className="text-center space-y-2.5 max-w-xs">
            <p className="text-[12px] font-bold text-white tracking-wide animate-pulse">
              {fortuneStepText}
            </p>
            <div className="w-48 h-1 bg-white/10 rounded-full mx-auto overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 via-amber-400 to-cyan-400 transition-all duration-300 rounded-full"
                style={{ width: `${fortuneProgress}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[24px] border border-white/5 bg-slate-950/20 p-5 text-[13px] font-medium leading-relaxed text-slate-200">
          {fortuneText ? (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <span>🔮</span>
                {tx(safeLang, 'Gələcəyin Səsi', 'Голос Будущего', 'Voice of Future')}
              </p>
              <p className="italic text-slate-100">{fortuneText}</p>
            </div>
          ) : (
            <p className="text-center text-white/40 py-3">
              {tx(safeLang, 'Şəkli yükləyəndən sonra fal burada görünəcək.', 'После загрузки фото предсказание появится здесь.', 'Your fortune will appear here after you upload an image.')}
            </p>
          )}
        </div>
      )}
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

      {chartData.length > 1 && (
        <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
          <div className="mb-3 text-[15px] font-bold text-white flex items-center gap-2">
            <span className="text-yellow-400">📊</span>
            {tx(safeLang, 'Alış dinamikası', 'Динамика покупок', 'Purchase dynamics')}
          </div>
          <div className="mt-2 pr-2">
            <SimpleAreaChart data={chartData} primaryColor={primaryColor} safeLang={safeLang} />
          </div>
        </section>
      )}

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
      className="relative min-h-dvh overflow-x-hidden overflow-y-auto overscroll-contain text-slate-100"
      style={{
        background: backgroundImage
          ? `linear-gradient(rgba(8,12,22,0.82), rgba(8,12,22,0.94)), url(${backgroundImage}) center/cover`
          : `linear-gradient(180deg, ${backgroundColor} 0%, ${backgroundColor}ee 50%, ${backgroundColor} 100%)`,
      }}
    >
      <style>{`
        @keyframes aurora-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, 30px) scale(1.15); }
        }
        @keyframes aurora-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, -40px) scale(0.85); }
        }
        @keyframes aurora-3 {
          0%, 100% { transform: translate(-50%, 0) scale(1); }
          50% { transform: translate(-30%, -20px) scale(1.1); }
        }
        .animate-aurora-1 {
          animation: aurora-1 18s ease-in-out infinite;
        }
        .animate-aurora-2 {
          animation: aurora-2 22s ease-in-out infinite;
        }
        .animate-aurora-3 {
          animation: aurora-3 15s ease-in-out infinite;
        }
      `}</style>

      {/* Ambient liquid blobs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full opacity-25 blur-[100px] animate-aurora-1" style={{ background: primaryColor }} />
        <div className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full opacity-15 blur-[120px] animate-aurora-2" style={{ background: accentColor }} />
        <div className="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 rounded-full opacity-10 blur-[80px] animate-aurora-3" style={{ background: primaryColor }} />
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-24 pt-5">
        {/* Language switcher */}
        <div className="mb-4 flex justify-end">
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium text-white/70"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}
          >
            <Languages size={13} />
            <button type="button" onClick={() => setLang('az')} className={`transition ${safeLang === 'az' ? 'font-bold text-white' : ''}`}>AZ</button>
            <button type="button" onClick={() => setLang('en')} className={`transition ${safeLang === 'en' ? 'font-bold text-white' : ''}`}>EN</button>
            <button type="button" onClick={() => setLang('ru')} className={`transition ${safeLang === 'ru' ? 'font-bold text-white' : ''}`}>RU</button>
          </div>
        </div>

        {/* Tab content */}
        {resolvedActiveTab === 'home' && renderHome()}
        {resolvedActiveTab === 'offers' && renderOffers()}
        {resolvedActiveTab === 'barista' && aiBaristaEnabled && renderBarista()}
        {resolvedActiveTab === 'falci' && aiFalciEnabled && renderFalci()}
        {resolvedActiveTab === 'profile' && renderProfile()}
      </div>

      {/* Bottom Navigation — compact glassmorphism */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="mx-auto max-w-md px-4 pb-3">
          <div
            className="flex items-center justify-around rounded-2xl py-2"
            style={{
              backgroundColor: `${backgroundColor}e8`,
              backdropFilter: 'blur(16px) saturate(1.2)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
            }}
          >
            {bottomTabs.map((tab) => {
              const active = tab.key === resolvedActiveTab;
              const unreadCount = tab.key === 'profile' ? notifications.filter((n: any) => !n.is_read).length : 0;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={async () => {
                    setActiveTab(tab.key);
                    if (Capacitor.isNativePlatform()) {
                      try {
                        await Haptics.impact({ style: ImpactStyle.Light });
                      } catch (hErr) {
                        console.warn('Haptics failed', hErr);
                      }
                    }
                  }}
                  className="relative flex flex-col items-center gap-0.5 px-3 py-1.5 transition-colors"
                  style={{ color: active ? primaryColor : 'rgba(255,255,255,0.45)' }}
                >
                  {tab.icon}
                  <span className="text-[10px] font-medium">{tab.label}</span>
                  {active && <div className="mt-0.5 h-1 w-1 rounded-full" style={{ backgroundColor: primaryColor }} />}
                  {unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: '#ef4444' }}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Full-screen QR code modal */}
      {showFullQr && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-4 animate-modalFadeIn"
          onClick={async () => {
            setShowFullQr(false);
            if (Capacitor.isNativePlatform()) {
              try {
                await Haptics.impact({ style: ImpactStyle.Light });
              } catch {}
            }
          }}
        >
          {/* Card container */}
          <div
            className="w-full max-w-md rounded-t-[32px] bg-slate-900 border-t border-white/10 p-6 space-y-6 shadow-2xl animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxHeight: '85vh',
              background: `linear-gradient(180deg, #1e293b 0%, #0f172a 100%)`,
            }}
          >
            {/* Modal Header/Handle */}
            <div className="flex flex-col items-center gap-2">
              <div className="h-1.5 w-12 rounded-full bg-white/20" />
              <h3 className="text-md font-bold text-white mt-2">
                {tx(safeLang, 'Skan Et və Qazan', 'Сканируй и Получай', 'Scan & Earn')}
              </h3>
            </div>

            {/* QR Scanner Container */}
            <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-white shadow-[0_12px_40px_rgba(255,255,255,0.08)]">
              {cardQr ? (
                <div className="p-3 bg-white rounded-xl">
                  <img src={cardQr} alt="qr" className="h-56 w-56 object-contain" />
                </div>
              ) : (
                <div className="h-56 w-56 flex items-center justify-center text-slate-800 font-mono text-sm">
                  {customer.card_id}
                </div>
              )}
              <div className="mt-4 text-center">
                <p className="text-slate-900 font-mono text-sm tracking-wider font-bold">
                  {formatCardId(customer.card_id)}
                </p>
                <p className="text-slate-500 text-[10px] mt-1 font-semibold uppercase tracking-wider">
                  {tx(safeLang, 'KASSAYA TƏQDİM EDİN', 'ПРЕДЪЯВИТЕ НА КАССЕ', 'PRESENT TO CASHIER')}
                </p>
              </div>
            </div>

            {/* Quick Tips */}
            <div className="rounded-2xl bg-white/5 border border-white/5 p-4 flex gap-3 items-center">
              <span className="text-lg">💡</span>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {tx(
                  safeLang,
                  'Skaner oxuya bilsin deyə ekran parlaqlığını artırmağınız tövsiyə olunur.',
                  'Рекомендуется увеличить яркость экрана для облегчения сканирования.',
                  'We recommend increasing screen brightness to make scanning easier.'
                )}
              </p>
            </div>

            {/* Close Button */}
            <button
              onClick={async () => {
                setShowFullQr(false);
                if (Capacitor.isNativePlatform()) {
                  try {
                    await Haptics.impact({ style: ImpactStyle.Light });
                  } catch {}
                }
              }}
              className="w-full py-3.5 rounded-2xl bg-white text-slate-950 font-black text-[13px] active:scale-95 transition-transform"
              style={{
                boxShadow: '0 8px 24px rgba(255,255,255,0.15)',
              }}
            >
              {tx(safeLang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
