import React from 'react';
import { Bell, Gift, Home, Languages, MessageCircleHeart, QrCode, Sparkles, UserRound, Camera as CameraIcon } from 'lucide-react';
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

  const branding = data?.branding || {};
  const wallet = data?.wallet || {};
  const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
  const history = Array.isArray(data?.history) ? data.history : [];
  const customer = data?.customer || {};
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
    
    try {
      const res = await analyze_customer_fortune_live(src, sessionCreds.cardId, sessionCreds.token, lang);
      setFortuneText(res.fortune || '');
    } catch (e: any) {
      setFortuneText(tx(lang, 'Şəkil analiz edilə bilmədi.', 'Не удалось проанализировать изображение.', 'Failed to analyze the image.'));
    } finally {
      setFortuneLoading(false);
    }
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
          <section className="rounded-[30px] border border-white/10 bg-white p-5 text-slate-900 shadow-[0_12px_32px_rgba(0,0,0,0.16)]">
            <div className="text-lg font-black">{tx(safeLang, 'Giriş və Qeydiyyat', 'Вход и Регистрация', 'Sign in & Sign up')}</div>
            
            <div className="mt-3 rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-600 border border-slate-100">
              <span className="font-bold text-slate-700 block mb-1">{tx(safeLang, 'Müştəri razılaşması:', 'Согласие клиента:', 'Customer consent:')}</span>
              {bootstrapData?.consent_text || tx(safeLang, 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.', 'Я согласен на участие в программе лояльности.', 'I agree to join the loyalty program.')}
            </div>

            {!otpSent ? (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">{tx(safeLang, 'Telefon nömrəniz', 'Номер телефона', 'Phone number')}</label>
                <input
                  type="tel"
                  placeholder="+994 50 123 45 67"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
                <button
                  type="button"
                  disabled={otpSending}
                  onClick={handleSendOtp}
                  className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60 transition active:scale-98"
                  style={{ backgroundColor: joinPrimary }}
                >
                  {otpSending ? '...' : tx(safeLang, 'Razıyam və kod göndər', 'Согласен и отправить код', 'Accept and send code')}
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">{tx(safeLang, 'Təsdiq kodu', 'Код подтверждения', 'Verification code')}</label>
                <input
                  type="number"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  placeholder="1234"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-lg font-bold text-slate-900 tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
                <button
                  type="button"
                  disabled={otpVerifying}
                  onClick={handleVerifyOtp}
                  className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60 transition active:scale-98"
                  style={{ backgroundColor: joinPrimary }}
                >
                  {otpVerifying ? '...' : tx(safeLang, 'Daxil ol / Təsdiq et', 'Войти / Подтвердить', 'Sign in / Verify')}
                </button>
                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-700 underline mt-2"
                >
                  {tx(safeLang, 'Nömrəni dəyiş', 'Изменить номер', 'Change number')}
                </button>
              </div>
            )}

            {otpError && (
              <p className="mt-3 text-center text-xs font-medium text-red-600 bg-red-50 rounded-xl py-2 px-3 border border-red-100">
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

      {/* Hero card */}
      <section
        className="relative overflow-hidden border p-5"
        style={{
          borderRadius: '24px',
          borderColor: 'rgba(255,255,255,0.08)',
          background: heroImage
            ? `linear-gradient(180deg, rgba(15,23,42,0.18), rgba(15,23,42,0.72)), url(${heroImage}) center/cover`
            : `linear-gradient(135deg, ${accentColor}, ${primaryColor})`,
          boxShadow: `0 12px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)`,
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/60">{branding.app_name || 'Loyalty Club'}</p>
            <h1 className="mt-2 text-2xl font-extrabold text-white">{branding.hero_title || tx(safeLang, 'Xoş gəldiniz', 'Добро пожаловать', 'Welcome')}</h1>
            <p className="mt-1.5 max-w-[14rem] text-[13px] text-white/70">{branding.hero_subtitle || customer.card_id}</p>
          </div>
          {branding.logo_url ? <img src={branding.logo_url} alt="brand" className="h-11 w-11 rounded-xl object-cover shadow-lg" style={{ border: `2px solid rgba(255,255,255,0.2)` }} /> : null}
        </div>

        {/* Wallet */}
        {showWallet && (
          <div
            className="mt-5 rounded-2xl p-4"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">{wallet.points_label || 'Ulduz'}</p>
                <p className="mt-1 text-4xl font-black text-white">{Number(wallet.stars_balance ?? 0).toFixed(programMode === 'cashback' ? 2 : 0)}{balanceSuffix}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium text-white/60">
                  {programMode === 'cashback' ? `${Number(wallet.cashback_percent || 0).toFixed(0)}% cashback` : (customer.type || 'Member')}
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/20">
              <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
              <span>{tx(safeLang, 'Növbəti reward', 'Следующая награда', 'Next reward')}</span>
              <span className="font-semibold text-white/80">{wallet.reward_name || 'Reward'}</span>
            </div>

            {/* Apple & Google Wallet buttons */}
            <div className="mt-4 pt-3 border-t border-white/10 flex flex-col xs:flex-row gap-2 justify-center items-center">
              <a
                href={get_customer_wallet_pass_url(sessionCreds.cardId, sessionCreds.token, safeLang)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl bg-black/80 px-4 py-2 border border-white/10 hover:border-white/30 transition-all text-[11px] font-semibold text-white active:scale-95 w-full xs:w-auto"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.75.8-.01 1.99-.79 3.61-.63 1.68.07 2.92.74 3.69 1.95-3.41 2.03-2.87 6.99.78 8.44-.8 2.05-1.74 4.02-3.16 5.46zM15.42 4.38c.75-.92 1.25-2.2 1.11-3.49-1.11.05-2.46.75-3.26 1.69-.69.8-1.3 2.1-1.13 3.37 1.23.1 2.5-.62 3.28-1.57z" />
                </svg>
                {tx(safeLang, 'Apple Wallet', 'Apple Wallet', 'Apple Wallet')}
              </a>
              <a
                href={get_customer_wallet_pass_url(sessionCreds.cardId, sessionCreds.token, safeLang)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl bg-black/80 px-4 py-2 border border-white/10 hover:border-white/30 transition-all text-[11px] font-semibold text-white active:scale-95 w-full xs:w-auto"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 1.56-1.56 2.95-3.24 3.51v2.9h5.24c3.07-2.83 4.83-7 4.83-11.64c0-.52-.05-1.04-.17-1.5zM12.18 21c2.43 0 4.47-.8 5.96-2.18l-5.24-2.9c-1.46.99-3.29 1.56-5.96 1.56c-4.59 0-8.48-3.11-9.86-7.3H1.66v3.01C4.46 18.77 8.08 21 12.18 21z" />
                </svg>
                {tx(safeLang, 'Google Wallet', 'Google Wallet', 'Google Wallet')}
              </a>
            </div>
          </div>
        )}
      </section>

      {/* Rewards + QR grid */}
      <div className="grid grid-cols-2 gap-3">
        <section
          className="rounded-2xl p-4"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}
        >
          <div className="flex items-center gap-2 text-[12px] font-semibold text-white/70"><Gift size={14} /> {tx(safeLang, 'Rewards', 'Награды', 'Rewards')}</div>
          <div className="mt-2 text-3xl font-black text-white">{wallet.available_rewards ?? 0}</div>
          <div className="mt-1 text-[11px] text-white/50">{wallet.reward_label || 'Reward'}</div>
          {rewards[0] && Number(wallet.available_rewards || 0) > 0 ? (
            <button
              type="button"
              disabled={claiming}
              onClick={() => { void claimReward(); }}
              className="relative mt-3 w-full overflow-hidden rounded-xl px-3 py-2.5 text-[12px] font-bold text-black disabled:opacity-50"
              style={{ backgroundColor: primaryColor, boxShadow: `0 4px 16px ${primaryColor}44` }}
            >
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, transparent 100%)' }} />
              {claiming ? '...' : tx(safeLang, 'Claim', 'Забрать', 'Claim')}
            </button>
          ) : null}
        </section>

        <section
          onClick={async () => {
            if (Capacitor.isNativePlatform()) {
              try {
                await Haptics.impact({ style: ImpactStyle.Medium });
              } catch (hErr) {
                console.warn('Haptics failed', hErr);
              }
            }
          }}
          className="rounded-2xl p-4 cursor-pointer active:scale-95 transition-transform"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}
        >
          <div className="flex items-center gap-2 text-[12px] font-semibold text-white/70"><QrCode size={14} /> {tx(safeLang, 'QR Kart', 'QR карта', 'QR Card')}</div>
          {showQrCard && cardQr ? (
            <div className="mt-2 flex flex-col items-center">
              <img src={cardQr} alt="qr" className="h-24 w-24 rounded-xl" />
              <p className="mt-1.5 text-[10px] font-semibold text-white/60">{customer.card_id}</p>
            </div>
          ) : (
            <p className="mt-3 text-[11px] font-semibold text-white/60">{customer.card_id}</p>
          )}
        </section>
      </div>

      {/* Pending claim codes */}
      <section
        className="rounded-2xl p-4"
        style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-white">{tx(safeLang, 'Claim kodları', 'Коды наград', 'Claim codes')}</p>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${accentColor}33`, color: accentColor }}>{pendingClaims.length}</span>
        </div>
        <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
          {pendingClaims.length === 0 ? (
            <div className="w-full rounded-xl py-4 text-center text-[12px] text-white/40">
              {tx(safeLang, 'Hələ aktiv kod yoxdur', 'Нет активных кодов', 'No active codes yet')}
            </div>
          ) : pendingClaims.map((row: any) => (
            <div key={row.id} className="min-w-[160px] shrink-0 rounded-xl p-3" style={{ backgroundColor: `${primaryColor}12`, border: `1px solid ${primaryColor}25` }}>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">{tx(safeLang, 'Kassada göstər', 'На кассе', 'At POS')}</p>
              <p className="mt-1 text-xl font-black text-white">{row.claim_code}</p>
              <p className="mt-1 text-[11px] text-white/50">{row.reward_name}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderOffers = () => (
    <div className="space-y-4">
      <section className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-bold text-white">{tx(safeLang, 'Aktiv kampaniyalar', 'Активные кампании', 'Active offers')}</p>
          <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold text-black" style={{ backgroundColor: primaryColor }}>{campaigns.length}</span>
        </div>
        <div className="mt-4 space-y-3">
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Gift size={28} style={{ color: 'rgba(255,255,255,0.2)' }} />
              <p className="text-[13px] text-white/40">{tx(safeLang, 'Hazırda aktiv kampaniya yoxdur', 'Сейчас нет активных кампаний', 'No active campaigns right now')}</p>
            </div>
          ) : campaigns.map((row: any) => (
            <div key={row.id} className="rounded-xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[15px] font-bold text-white">{row.name}</p>
              <p className="mt-1 text-[13px] font-semibold" style={{ color: primaryColor }}>{row.discount_percent}% {tx(safeLang, 'endirim', 'скидка', 'discount')}</p>
              <p className="mt-2 text-[11px] text-white/40">{row.start_time} - {row.end_time} • {row.categories || 'ALL'}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Claim codes */}
      <section className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}>
        <p className="text-[15px] font-bold text-white">{tx(safeLang, 'Claim kodları', 'Коды наград', 'Claim codes')}</p>
        <div className="mt-3 space-y-2.5">
          {pendingClaims.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-white/40">{tx(safeLang, 'Aktiv claim kodu yoxdur', 'Активных кодов нет', 'No active claim codes')}</div>
          ) : pendingClaims.map((row: any) => (
            <div key={row.id} className="rounded-xl p-3.5" style={{ backgroundColor: `${primaryColor}10`, border: `1px solid ${primaryColor}20` }}>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">{tx(safeLang, 'Kassada göstərin', 'Покажите на кассе', 'Show at POS')}</p>
              <p className="mt-1 text-2xl font-black text-white">{row.claim_code}</p>
              <p className="mt-1 text-[11px] text-white/50">{row.reward_name}</p>
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
        {Capacitor.isNativePlatform() && (
          <button type="button" onClick={takePhotoWithCamera} className="flex items-center gap-2 rounded-2xl px-4 py-3 font-semibold text-slate-950 animate-pulse" style={{ backgroundColor: accentColor }}>
            <CameraIcon size={18} />
            {tx(safeLang, 'Kamera ilə çək', 'Снять на камеру', 'Take Photo')}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) analyzeImageFortune(file);
        }} />
      </div>
      {fortuneImage ? <img src={fortuneImage} alt="fortune preview" className="mt-4 h-44 w-full rounded-[24px] object-cover" /> : null}
      <div className="mt-4 rounded-[24px] bg-amber-400/10 p-4 text-sm text-slate-100">
        {fortuneLoading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-yellow-400" />
            <span>{tx(safeLang, 'Falınız oxunur...', 'Гадание считывается...', 'Reading your fortune...')}</span>
          </div>
        ) : (
          fortuneText || tx(safeLang, 'Şəkli yükləyəndən sonra fal burada görünəcək.', 'После загрузки фото предсказание появится здесь.', 'Your fortune will appear here after you upload an image.')
        )}
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
      {/* Ambient liquid blobs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full opacity-25 blur-[100px]" style={{ background: primaryColor }} />
        <div className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full opacity-15 blur-[120px]" style={{ background: accentColor }} />
        <div className="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 rounded-full opacity-10 blur-[80px]" style={{ background: primaryColor }} />
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
    </div>
  );
}
