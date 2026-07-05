import React from 'react';
import { Bell, Gift, Home, Languages, MessageCircleHeart, MessageSquare, QrCode, Sparkles, UserRound, Camera as CameraIcon, Mic, Volume2, VolumeX, ShoppingBag, ChevronRight, Check, ChevronLeft, X, Sliders } from 'lucide-react';
import QRCode from 'qrcode';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { tx } from '../i18n';
import { useAppStore } from '../store';
import { claim_customer_reward_live, enroll_customer_app_live, get_customer_app_bootstrap_live, get_customer_app_session_live, mark_customer_notification_read_live, save_push_token_live, send_customer_otp_live, verify_customer_otp_live, analyze_customer_fortune_live, chat_customer_barista_live, get_customer_wallet_pass_url, create_customer_pre_order_live } from '../api/crm';
import { get_public_menu_live } from '../api/menu';
import { clearCustomerSession, readCustomerPushToken, readCustomerPushTokenAsync, writeCustomerPushToken, writeCustomerSession } from '../lib/customer_session';

type Props = {
  cardId?: string;
  token?: string;
  joinMode?: boolean;
};

type CustomerTab = 'home' | 'order' | 'offers' | 'barista' | 'falci' | 'profile';

const BARISTA_QUICK_PROMPTS = [
  'Mənə soyuq içki tövsiyə et',
  'Bu gün hansı reward mənə sərf edir?',
  'Dessert ilə nə uyğun gedər?',
];

const getProductImage = (name: string, currentUrl?: string): string => {
  if (currentUrl && currentUrl.trim().startsWith('http')) return currentUrl;
  const n = name.toLowerCase();
  if (n.includes('espresso') || n.includes('double shot')) {
    return 'https://images.unsplash.com/photo-1510705315444-837e27e8ecea?auto=format&fit=crop&w=400&q=80';
  }
  if (n.includes('cappuccino') || n.includes('latte') || n.includes('flat white') || n.includes('macchiato') || n.includes('mocha') || n.includes('qəhvə') || n.includes('coffee')) {
    return 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=400&q=80';
  }
  if (n.includes('iced') || n.includes('cold') || n.includes('soyuq') || n.includes('frappe') || n.includes('shake')) {
    return 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=400&q=80';
  }
  if (n.includes('tea') || n.includes('çay') || n.includes('cay') || n.includes('matcha') || n.includes('herbal')) {
    return 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80';
  }
  if (n.includes('cheesecake') || n.includes('cake') || n.includes('şirniyyat') || n.includes('sirniyyat') || n.includes('desert') || n.includes('cookie') || n.includes('croissant') || n.includes('kruassan') || n.includes('panini') || n.includes('waffle')) {
    return 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=400&q=80';
  }
  return 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=400&q=80';
};

const CUSTOMER_DEBUG_TOOLS_ENABLED = Boolean((import.meta as any)?.env?.DEV) && !Capacitor.isNativePlatform();

type OneSignalRuntime = {
  push: (callback: () => void | Promise<void>) => void;
  init: (config: { appId: string; allowLocalhostAsSecureOrigin?: boolean }) => Promise<void>;
  User: {
    PushSubscription: {
      id: string | null;
    };
  };
};

function persistCustomerSession(cardId: string, token: string) {
  writeCustomerSession(cardId, token);
}

function scrubCustomerSessionFromUrl() {
  if (typeof window === 'undefined') return;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete('id');
  nextUrl.searchParams.delete('t');
  nextUrl.searchParams.delete('token');
  nextUrl.searchParams.delete('join');
  nextUrl.searchParams.delete('club');
  nextUrl.searchParams.delete('discount');
  nextUrl.searchParams.set('customer', '1');
  window.history.replaceState({}, '', nextUrl.toString());
}

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
  const [cardFlipped, setCardFlipped] = React.useState(false);
  const [menuItems, setMenuItems] = React.useState<any[]>([]);
  const [menuLoading, setMenuLoading] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState<string>('');
  const [customerCart, setCustomerCart] = React.useState<any[]>([]);
  const [modifierSheetItem, setModifierSheetItem] = React.useState<any | null>(null);
  const [selectedVariant, setSelectedVariant] = React.useState<any | null>(null);
  const [selectedModifiers, setSelectedModifiers] = React.useState<any[]>([]);
  const [preOrderSubmitting, setPreOrderSubmitting] = React.useState(false);
  const [preOrderSuccess, setPreOrderSuccess] = React.useState(false);
  const [preOrderSuccessId, setPreOrderSuccessId] = React.useState('');
  const [showCartSheet, setShowCartSheet] = React.useState(false);
  const [orderNotes, setOrderNotes] = React.useState('');
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

  React.useEffect(() => {
    if (!cardId || !token) return;
    persistCustomerSession(cardId, token);
    scrubCustomerSessionFromUrl();
  }, [cardId, token]);

  const formatCardId = (id: string) => {
    const clean = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) return '•••• •••• •••• ••••';
    const chunks = [];
    for (let i = 0; i < clean.length; i += 4) {
      chunks.push(clean.slice(i, i + 4));
    }
    return chunks.join(' ');
  };

  const audioCtxRef = React.useRef<AudioContext | null>(null);

  const initAudioCtx = () => {
    if (typeof window === 'undefined') return null;
    if (!audioCtxRef.current) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        audioCtxRef.current = new AudioCtxClass();
      }
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  };

  const openWalletPass = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    void initAudioCtx();
    if (Capacitor.isNativePlatform()) {
      window.open(url, '_system');
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenModifiers = (item: any) => {
    setModifierSheetItem(item);
    setSelectedVariant(item.variants && item.variants.length > 0 ? item.variants[0] : null);
    setSelectedModifiers([]);
  };

  const handleToggleModifier = (mod: { name: string; price: number }) => {
    setSelectedModifiers(prev => {
      const exists = prev.find(m => m.name === mod.name);
      if (exists) {
        return prev.filter(m => m.name !== mod.name);
      } else {
        return [...prev, mod];
      }
    });
  };

  const handleAddToCart = () => {
    if (!modifierSheetItem) return;
    const basePrice = selectedVariant ? Number(selectedVariant.price) : Number(modifierSheetItem.price || 0);
    const modifiersTotal = selectedModifiers.reduce((acc, m) => acc + m.price, 0);
    const finalPrice = basePrice + modifiersTotal;

    const cartItem = {
      id: modifierSheetItem.id,
      name: modifierSheetItem.name,
      quantity: 1,
      price: finalPrice,
      variant_name: selectedVariant ? selectedVariant.name : null,
      selected_modifiers: selectedModifiers,
      notes: ''
    };

    setCustomerCart(prev => {
      const existingIdx = prev.findIndex(item => 
        item.id === cartItem.id && 
        item.variant_name === cartItem.variant_name &&
        JSON.stringify(item.selected_modifiers) === JSON.stringify(cartItem.selected_modifiers)
      );
      if (existingIdx > -1) {
        const next = [...prev];
        next[existingIdx].quantity += 1;
        return next;
      }
      return [...prev, cartItem];
    });

    setModifierSheetItem(null);
    playTickSound();
    if (Capacitor.isNativePlatform()) {
      try {
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      } catch {}
    }
  };

  const handleRemoveFromCart = (index: number) => {
    setCustomerCart(prev => prev.filter((_, idx) => idx !== index));
    playTickSound();
  };

  const handleCheckoutPreOrder = async () => {
    if (customerCart.length === 0) return;
    try {
      setPreOrderSubmitting(true);
      const res = await create_customer_pre_order_live({
        cardId: sessionCreds.cardId!,
        token: sessionCreds.token!,
        items: customerCart,
        notes: orderNotes,
        tenantId: data?.tenant_id
      });
      if (res.success) {
        setPreOrderSuccessId(res.orderId);
        setPreOrderSuccess(true);
        setCustomerCart([]);
        setOrderNotes('');
        setShowCartSheet(false);
        playShimmerSound();
      }
    } catch (err) {
      console.warn('Checkout failed:', err);
    } finally {
      setPreOrderSubmitting(false);
    }
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

  const spawnParticles = (e: React.MouseEvent<HTMLElement>) => {
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
    const audioCtx = initAudioCtx();
    if (!audioCtx) return;
    try {
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
    const audioCtx = initAudioCtx();
    if (!audioCtx) return;
    try {
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
  const primaryColor = String(branding?.primary_color || '#F48C24');
  const accentColor = String(branding?.accent_color || '#1A4329');
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
      const oneSignal = ((window as any).OneSignal || []) as OneSignalRuntime;
      (window as any).OneSignal = oneSignal;
      oneSignal.push(async () => {
        await oneSignal.init({
          appId: appId,
          allowLocalhostAsSecureOrigin: true,
        });
        const userId = await oneSignal.User.PushSubscription.id;
        if (userId) {
          writeCustomerPushToken(userId);
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
        const cachedPushToken = await readCustomerPushTokenAsync();
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
    if (!Capacitor.isNativePlatform()) return;
    if (!sessionCreds.cardId || !sessionCreds.token) return;

    const setupNativePush = async () => {
      try {
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive !== 'granted') {
          permStatus = await PushNotifications.requestPermissions();
        }
        if (permStatus.receive === 'granted') {
          await PushNotifications.register();
        }

        await PushNotifications.addListener('registration', async (token) => {
          const pushToken = token.value;
          if (pushToken) {
            writeCustomerPushToken(pushToken);
            try {
              await save_push_token_live(sessionCreds.cardId, pushToken, sessionCreds.token);
              console.log('Native Push token registered and synced with CRM:', pushToken);
            } catch (err) {
              console.warn('Failed to sync native push token:', err);
            }
          }
        });

        await PushNotifications.addListener('registrationError', (error) => {
          console.error('Push registration error:', error);
        });
      } catch (err) {
        console.warn('Native push registration setup failed:', err);
      }
    };

    void setupNativePush();

    return () => {
      try {
        void PushNotifications.removeAllListeners();
      } catch {}
    };
  }, [sessionCreds.cardId, sessionCreds.token]);

  React.useEffect(() => {
    if (activeTab !== 'order') return;
    let mounted = true;
    void (async () => {
      try {
        setMenuLoading(true);
        const menu = await get_public_menu_live();
        if (mounted) {
          const items = Array.isArray(menu) ? menu : [];
          setMenuItems(items);
          if (items.length > 0) {
            const cats = Array.from(new Set(items.map(it => it.category).filter(Boolean))) as string[];
            if (cats.length > 0 && !selectedCategory) {
              setSelectedCategory(cats[0]);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch public menu items:', err);
      } finally {
        if (mounted) setMenuLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [activeTab]);

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
        persistCustomerSession(created.card_id, created.token);
        scrubCustomerSessionFromUrl();

        if (Capacitor.isNativePlatform()) {
          const cachedPushToken = readCustomerPushToken();
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
        persistCustomerSession(res.card_id, res.token);
        scrubCustomerSessionFromUrl();

        if (Capacitor.isNativePlatform()) {
          const cachedPushToken = readCustomerPushToken();
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
                <div className="text-xs uppercase tracking-[0.3em] text-white/70">{bootstrapBranding.app_name || 'Emalatkhana'}</div>
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

                {CUSTOMER_DEBUG_TOOLS_ENABLED ? (
                  <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-xs font-semibold text-white/50">
                    DEV mode: OTP test bypass removed from the customer-facing flow.
                  </p>
                ) : null}
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
              clearCustomerSession();
              setSessionCreds({ cardId: '', token: '' });
              setError('');
            }}
            className="mt-6 w-full rounded-2xl bg-white/10 py-3 text-sm font-semibold text-white transition hover:bg-white/15 active:scale-[0.98]"
          >
            {tx(safeLang, 'Sessiyanı Sıfırla & Geri Dön', 'Сбросить сессию и вернуться', 'Reset Session & Go Back')}
          </button>

          {CUSTOMER_DEBUG_TOOLS_ENABLED ? (
            <button
              type="button"
              onClick={() => setShowDevSettings(!showDevSettings)}
              className="mt-4 block w-full text-center text-xs text-white/40 underline hover:text-white/60"
            >
              {showDevSettings 
                ? tx(safeLang, 'Ayarları gizlə', 'Скрыть настройки', 'Hide settings')
                : tx(safeLang, 'İnkişaf etdirici ayarları', 'Настройки разработчика', 'Developer settings')}
            </button>
          ) : null}

          {CUSTOMER_DEBUG_TOOLS_ENABLED && showDevSettings && (
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

  const bottomTabs: Array<{ key: CustomerTab; label: string; icon: React.ReactNode }> = [
    { key: 'home' as CustomerTab, label: tx(safeLang, 'Ana Səhifə', 'Главная', 'Home'), icon: <Home size={18} /> },
    { key: 'order' as CustomerTab, label: tx(safeLang, 'Sifariş', 'Заказать', 'Order'), icon: <ShoppingBag size={18} /> },
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

      {/* Welcome Back Header styled exactly like mockup */}
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-3">
          {/* Circular avatar */}
          <div className="h-11 w-11 rounded-full bg-[#1A4329]/10 flex items-center justify-center border border-[#1A4329]/5 text-lg font-black text-[#1A4329]">
            {customer.name ? customer.name.charAt(0).toUpperCase() : 'M'}
          </div>
          <div>
            <p className="text-[10px] text-[#1A4329]/50 font-bold uppercase tracking-wider">
              {tx(safeLang, 'Xoş gəldiniz', 'Добро пожаловать', 'Welcome Back')}
            </p>
            <h2 className="text-md font-black text-[#1A4329] tracking-tight">
              {customer.name || tx(safeLang, 'Qonaq', 'Гость', 'Guest')}
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Bell Icon in white circle with shadow */}
          <div className="h-10 w-10 rounded-full bg-white flex items-center justify-center border border-[#1A4329]/5 shadow-sm text-[#1A4329]/70 relative">
            <Bell size={18} />
            {notifications.filter((n: any) => !n.is_read).length > 0 && (
              <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-[#F48C24]" />
            )}
          </div>
          {/* Orange active indicator or filter button */}
          <div className="h-10 w-10 rounded-full bg-[#F48C24] flex items-center justify-center shadow-[0_4px_12px_rgba(244,140,36,0.25)] text-white">
            <Sliders size={18} />
          </div>
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

      {/* Premium Digital Membership Card wrapper with 3D Flip */}
      <div 
        onClick={async (e) => {
          spawnParticles(e);
          playTickSound();
          setCardFlipped(!cardFlipped);
          if (Capacitor.isNativePlatform()) {
            try {
              await Haptics.impact({ style: ImpactStyle.Light });
            } catch {}
          }
        }}
        className="perspective-1000 w-full h-[220px] select-none cursor-pointer"
      >
        <div className={`relative w-full h-full duration-700 preserve-3d transition-transform ${cardFlipped ? 'rotate-y-180' : ''}`}>
          {/* CARD FRONT */}
          <div 
            className="absolute inset-0 backface-hidden border p-6 flex flex-col justify-between overflow-hidden shadow-[0_16px_36px_rgba(26,67,41,0.18)]"
            style={{
              borderRadius: '28px',
              borderColor: 'rgba(26, 67, 41, 0.1)',
              background: heroImage
                ? `linear-gradient(180deg, rgba(26, 67, 41, 0.2), rgba(26, 67, 41, 0.8)), url(${heroImage}) center/cover`
                : `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)`,
            }}
          >
            {/* Glossy Card Reflection Sweep */}
            <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-[1500ms] ease-out pointer-events-none" />

            {/* Card Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/80">
                    {branding.app_name || 'Emalatkhana'}
                  </p>
                </div>
                <h1 className="mt-2 text-2xl font-black text-white tracking-tight">
                  {branding.hero_title || tx(safeLang, 'Xoş gəldiniz', 'Добро пожаловать', 'Welcome')}
                </h1>
              </div>
              {branding.logo_url ? (
                <img
                  src={branding.logo_url}
                  alt="brand"
                  className="h-11 w-11 rounded-xl object-cover shadow-2xl border border-white/20"
                />
              ) : (
                <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 text-xl">
                  ☕
                </div>
              )}
            </div>

            {/* Card Chip & Contactless Indicator */}
            <div className="flex items-center justify-between mt-4">
              {/* SIM Chip Icon */}
              <div className="relative w-10 h-7 rounded-md bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-300 border border-amber-500/20 shadow-inner overflow-hidden flex flex-col justify-between p-1 opacity-85">
                <div className="flex justify-between h-px bg-slate-950/20 mt-1" />
                <div className="flex justify-between h-px bg-slate-950/20" />
                <div className="flex justify-between h-px bg-slate-950/20 mb-1" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-950/20" />
              </div>

              {/* Tap to Scan Guide */}
              <div className="text-[9px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1 bg-black/20 rounded-full px-2.5 py-1 border border-white/5 backdrop-blur-sm animate-pulse">
                <span>✨</span>
                <span>{tx(safeLang, 'Skan üçün toxun', 'Коснитесь для скана', 'Tap to Scan')}</span>
              </div>

              {/* Contactless waves */}
              <div className="text-white/40">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4zm11-6.5c0-.83.67-1.5 1.5-1.5C20.09 4 24 7.91 24 12.5S20.09 21 16.5 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5c2.48 0 4.5-2.02 4.5-4.5S18.98 9 16.5 9c-.83 0-1.5-.67-1.5-1.5zm-5-3C10.5 2.17 11.17 1.5 12 1.5C17.79 1.5 22.5 6.21 22.5 12S17.79 22.5 12 22.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5c4.14 0 7.5-3.36 7.5-7.5s-3.36-7.5-7.5-7.5c-.83 0-1.5-.67-1.5-1.5z" />
                </svg>
              </div>
            </div>

            {/* Card Number printed at the bottom like credit card */}
            <div className="mt-4 flex items-center justify-between text-white/60 text-[10px] font-mono tracking-[0.2em]">
              <span>{formatCardId(customer.card_id)}</span>
              <span className="text-[9px] opacity-75">{tx(safeLang, 'MÜŞTƏRİ', 'КЛИЕНТ', 'CUSTOMER')}</span>
            </div>
          </div>

          {/* CARD BACK - High Contrast Solid White */}
          <div 
            className="absolute inset-0 backface-hidden rotate-y-180 border p-6 flex flex-col items-center justify-center bg-white shadow-[0_16px_36px_rgba(26,67,41,0.12)]"
            style={{
              borderRadius: '28px',
              borderColor: 'rgba(26, 67, 41, 0.1)',
            }}
          >
            {cardQr ? (
              <div className="rounded-2xl bg-white p-2.5 shadow-md border border-slate-100">
                <img src={cardQr} alt="QR Code" className="h-28 w-28 object-contain" />
              </div>
            ) : (
              <div className="text-slate-400 text-xs">No QR Code available</div>
            )}
            <div className="mt-3 text-[10px] font-black text-[#F48C24] tracking-[0.25em] uppercase">
              {tx(safeLang, 'MƏSƏNİ PƏNCƏRƏYƏ YAXINLAŞDIRIN', 'ПОДНЕСИТЕ К СКАНЕРУ', 'SCAN QR CODE')}
            </div>
            <div className="mt-1 font-mono text-[9px] text-[#1A4329]/40">{formatCardId(customer.card_id)}</div>
          </div>
        </div>
      </div>

      {/* Card Details Container (Placed directly below card) */}
      {showWallet && (
        <section 
          className="rounded-[28px] border p-6 shadow-[0_12px_40px_rgba(26,67,41,0.03)] space-y-5 bg-white"
          style={{
            borderColor: 'rgba(26, 67, 41, 0.05)',
          }}
        >
          <div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#1A4329]/50">
                  {wallet.points_label || 'Ulduz'}
                </p>
                <p className="mt-1 text-3xl font-black text-[#1A4329] tracking-tight">
                  {Number(wallet.stars_balance ?? 0).toFixed(programMode === 'cashback' ? 2 : 0)}
                  {balanceSuffix}
                </p>
              </div>
              <div className="text-right">
                <span className="inline-block rounded-full bg-[#1A4329]/5 border border-[#1A4329]/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-[#1A4329] uppercase">
                  {programMode === 'cashback' ? `${Number(wallet.cashback_percent || 0).toFixed(0)}% cashback` : (customer.type || 'Member')}
                </span>
              </div>
            </div>

            {/* Visual Stars Grid / Milestone Tracker with Coffee Cup Animation */}
            {programMode === 'points' ? (
              <div className="border-t border-[#1A4329]/5 pt-4">
                <div className="flex items-center gap-5">
                  {/* Waving Coffee Cup SVG */}
                  <div className="relative select-none flex-shrink-0 flex items-center justify-center">
                    <svg viewBox="0 0 100 110" className="w-16 h-18 overflow-visible">
                      <defs>
                        <linearGradient id="coffeeLiquidGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#ffb366" />
                          <stop offset="40%" stopColor="#F48C24" />
                          <stop offset="100%" stopColor="#b35900" />
                        </linearGradient>
                        <clipPath id="cupInterior">
                          <path d="M20 18 L80 18 L73 85 C72 93, 28 93, 27 85 Z" />
                        </clipPath>
                      </defs>
                      
                      {/* Steam waves */}
                      <path d="M40 10 Q43 4, 40 -2" fill="none" stroke="rgba(244,140,36,0.35)" strokeWidth="1.5" strokeLinecap="round" className="animate-pulse" />
                      <path d="M50 12 Q53 6, 50 0" fill="none" stroke="rgba(244,140,36,0.45)" strokeWidth="1.5" strokeLinecap="round" className="animate-pulse" />
                      <path d="M60 10 Q63 4, 60 -2" fill="none" stroke="rgba(244,140,36,0.35)" strokeWidth="1.5" strokeLinecap="round" className="animate-pulse" />
                      
                      {/* Cup Handle */}
                      <path d="M76 35 C90 35, 90 65, 76 65" fill="none" stroke="rgba(26,67,41,0.2)" strokeWidth="4.5" strokeLinecap="round" />
                      {/* Cup Body Outline */}
                      <path d="M20 18 L80 18 L73 85 C72 93, 28 93, 27 85 Z" fill="rgba(26,67,41,0.03)" stroke="rgba(26,67,41,0.25)" strokeWidth="2.5" />
                      {/* Waving Liquid clipped inside cup interior */}
                      <g clipPath="url(#cupInterior)">
                        <path 
                          d="M -100 120 L -100 45 Q -75 40, -50 45 T 0 45 T 50 45 T 100 45 T 150 45 T 200 45 L 200 120 Z" 
                          fill="url(#coffeeLiquidGrad)"
                          className="animate-wave"
                          style={{
                            transform: `translateY(${Math.max(0, 100 - progressPercent)}%)`,
                            transition: 'transform 1.5s cubic-bezier(0.4, 0, 0.2, 1)'
                          }}
                        />
                      </g>
                    </svg>
                    {/* Floating Star badge */}
                    <div className="absolute -top-1.5 -right-1 bg-[#F48C24] text-white font-black text-[9px] h-4.5 w-4.5 rounded-full flex items-center justify-center border border-white shadow-lg animate-bounce">
                      ★
                    </div>
                  </div>

                  {/* Milestone details on the right */}
                  <div className="flex-1 space-y-2">
                    <div className="text-[11px] font-bold text-[#1A4329]">
                      {tx(
                        safeLang,
                        `${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} ulduz topladınız`,
                        `Вы собрали ${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} звезд`,
                        `Collected ${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} stars`
                      )}
                    </div>
                    {/* Progress milestones list */}
                    <div className="space-y-1">
                      {[
                        { stars: Math.round(Number(wallet.next_reward_at || 10) * 0.3), label: tx(safeLang, 'Çay / Espresso', 'Чай / Эспрессо', 'Tea / Espresso') },
                        { stars: Math.round(Number(wallet.next_reward_at || 10) * 0.6), label: tx(safeLang, 'Cappuccino / Latte', 'Капучино / Латте', 'Cappuccino / Latte') },
                        { stars: Number(wallet.next_reward_at || 10), label: tx(safeLang, 'Böyük Qəhvə + Desert', 'Большой Кофе + Десерт', 'Large Coffee + Pastry') }
                      ].map((m, mIdx) => {
                        const isUnlocked = Number(wallet.stars_balance ?? 0) >= m.stars;
                        return (
                          <div key={mIdx} className="flex items-center gap-2 text-[10px]">
                            <span className={`h-2 w-2 rounded-full ${isUnlocked ? 'bg-[#F48C24] shadow-[0_0_6px_rgba(244,140,36,0.8)]' : 'bg-slate-200'}`} />
                            <span className={isUnlocked ? 'text-[#1A4329] font-black' : 'text-[#1A4329]/50 font-bold'}>
                              {m.stars}★ · {m.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Cashback progress bar */
              <div className="border-t border-[#1A4329]/5 pt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#F48C24] to-[#ffb366] transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-[#1A4329]/50">
                  <span>{tx(safeLang, 'Növbəti reward', 'Следующая награда', 'Next reward')}</span>
                  <span className="font-bold text-[#1A4329]/80">{wallet.reward_name || 'Reward'} ({progressPercent}%)</span>
                </div>
              </div>
            )}

            {/* Apple & Google Wallet Integration */}
            <div className="pt-3 border-t border-[#1A4329]/5 flex flex-row gap-2 justify-center items-center">
              <a
                href={get_customer_wallet_pass_url(sessionCreds.cardId, sessionCreds.token, safeLang)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => openWalletPass(e, get_customer_wallet_pass_url(sessionCreds.cardId, sessionCreds.token, safeLang))}
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
                onClick={(e) => openWalletPass(e, get_customer_wallet_pass_url(sessionCreds.cardId, sessionCreds.token, safeLang))}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-black/80 hover:bg-black/90 py-2 border border-white/10 hover:border-white/20 transition text-[10px] font-semibold text-white active:scale-95"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 1.56-1.56 2.95-3.24 3.51v2.9h5.24c3.07-2.83 4.83-7 4.83-11.64c0-.52-.05-1.04-.17-1.5zM12.18 21c2.43 0 4.47-.8 5.96-2.18l-5.24-2.9c-1.46.99-3.29 1.56-5.96 1.56c-4.59 0-8.48-3.11-9.86-7.3H1.66v3.01C4.46 18.77 8.08 21 12.18 21z" />
                </svg>
                {tx(safeLang, 'Google Wallet', 'Google Wallet', 'Google Wallet')}
              </a>
            </div>

            {/* Card Number printed at the bottom like credit card */}
            <div className="mt-5 flex items-center justify-between text-[#1A4329]/40 text-[11px] font-mono tracking-[0.2em] border-t border-[#1A4329]/5 pt-3">
              <span>{formatCardId(customer.card_id)}</span>
              <span className="text-[10px] opacity-75">{tx(safeLang, 'LOYALLIQ', 'ЛОЯЛЬНОСТЬ', 'LOYALTY')}</span>
            </div>
          </div>
        </section>
      )}

      {/* Mockup-Style Promo Banner */}
      <section className="relative overflow-hidden rounded-[28px] p-5 text-white shadow-[0_12px_36px_rgba(26,67,41,0.04)] bg-gradient-to-r from-[#1A4329] to-[#2E5E3D] border border-white/5">
        {/* Abstract background shapes acting as mock image */}
        <div className="absolute right-0 bottom-0 top-0 w-1/3 opacity-30 pointer-events-none select-none">
          <div className="absolute -right-4 -bottom-4 w-28 h-28 rounded-full bg-[#F48C24] blur-lg" />
          <div className="absolute right-4 top-2 w-16 h-16 rounded-full bg-white blur-md" />
        </div>
        <div className="relative z-10 max-w-[70%] space-y-3.5">
          <div>
            <h4 className="text-sm font-black tracking-tight leading-snug">
              {tx(safeLang, 'Hər gün təzə dəmlənmiş premium qəhvə', 'Свежесваренный премиум кофе каждый день', 'Freshly brewed premium coffee everyday')}
            </h4>
            <p className="mt-1 text-[9px] text-white/70 font-semibold uppercase tracking-wider">
              {tx(safeLang, 'İndi sifariş et, növbəni keç!', 'Закажи сейчас, пропусти очередь!', 'Order now, skip the line!')}
            </p>
          </div>
          <button
            onClick={() => setActiveTab('order')}
            className="rounded-full bg-white hover:bg-slate-100 text-[#1A4329] font-black text-[9px] px-3.5 py-1.5 uppercase tracking-wider transition active:scale-95 shadow-sm"
          >
            {tx(safeLang, 'Sifariş Et', 'Заказать', 'Order Now')}
          </button>
        </div>
      </section>

      {/* Rewards + QR grid */}
      <div className="grid grid-cols-2 gap-3.5">
        <section
          className="rounded-[28px] p-5 flex flex-col justify-between border shadow-[0_12px_40px_rgba(26,67,41,0.02)] bg-white"
          style={{ borderColor: 'rgba(26, 67, 41, 0.05)' }}
        >
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#1A4329]/50">
              <Gift size={14} className="text-[#F48C24] animate-bounce" />
              {tx(safeLang, 'Hədiyyələr', 'Награды', 'Rewards')}
            </div>
            <div className="mt-3 text-4xl font-black text-[#1A4329] tracking-tight">
              {wallet.available_rewards ?? 0}
            </div>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[#1A4329]/40">
              {wallet.reward_label || 'Hədiyyə'}
            </p>
          </div>
          {rewards[0] && Number(wallet.available_rewards || 0) > 0 ? (
            <button
              type="button"
              disabled={claiming}
              onClick={(e) => { e.stopPropagation(); void claimReward(); }}
              className="relative mt-4 w-full overflow-hidden rounded-xl py-2.5 text-[12px] font-black text-white transition-all active:scale-[0.97] disabled:opacity-50"
              style={{
                background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
              }}
            >
              <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/15 to-transparent -translate-x-full hover:translate-x-full transition-transform duration-1000 ease-out" />
              {claiming ? '...' : tx(safeLang, 'Tətbiq et', 'Забрать', 'Claim')}
            </button>
          ) : null}
        </section>

        <section
          onClick={async () => {
            setCardFlipped(!cardFlipped);
            playTickSound();
            if (Capacitor.isNativePlatform()) {
              try {
                await Haptics.impact({ style: ImpactStyle.Medium });
              } catch (hErr) {
                console.warn('Haptics failed', hErr);
              }
            }
          }}
          className="rounded-[28px] p-5 flex flex-col justify-between border shadow-[0_12px_40px_rgba(26,67,41,0.02)] transition active:scale-[0.98] cursor-pointer bg-white"
          style={{ borderColor: 'rgba(26, 67, 41, 0.05)' }}
        >
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#1A4329]/50">
            <QrCode size={14} className="text-[#F48C24]" />
            {tx(safeLang, 'QR Kart', 'QR карта', 'QR Card')}
          </div>
          {showQrCard && cardQr ? (
            <div className="mt-3 flex flex-col items-center">
              <div className="p-2 bg-white rounded-2xl border border-slate-100 shadow-inner">
                <img src={cardQr} alt="qr" className="h-20 w-20 object-contain" />
              </div>
              <p className="mt-2 text-[9px] font-mono tracking-widest text-[#1A4329]/40">{customer.card_id}</p>
            </div>
          ) : (
            <p className="mt-4 text-xs font-mono tracking-widest text-[#1A4329]/60">{customer.card_id}</p>
          )}
        </section>
      </div>

      {/* Contextual Weather & Combo Card */}
      <section
        className="rounded-[28px] p-5 border shadow-[0_12px_40px_rgba(26,67,41,0.02)] bg-white space-y-4"
        style={{ borderColor: 'rgba(26, 67, 41, 0.05)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌦️</span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#1A4329]/75">
                {tx(safeLang, 'Ağıllı Təkliflərimiz', 'Умные Рекомендации', 'Smart Recommendations')}
              </p>
              <p className="text-[10px] text-[#1A4329]/50 font-mono mt-0.5">
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
            className="rounded-full bg-[#1A4329]/5 border border-[#1A4329]/10 px-2.5 py-1 text-[9px] font-bold text-[#1A4329] hover:bg-[#1A4329]/10 active:scale-95 transition"
          >
            🔄 {tx(safeLang, 'Havanı Dəyiş', 'Сменить погоду', 'Toggle Weather')}
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] text-[#1A4329]/70 font-semibold">{getWeatherInfo().weatherDesc}</p>
          <div className="grid grid-cols-2 gap-2">
            {getWeatherInfo().recommendedDrinks.map((drink, idx) => (
              <div
                key={idx}
                onClick={async () => {
                  setCardFlipped(!cardFlipped);
                  playTickSound();
                  if (Capacitor.isNativePlatform()) {
                    try {
                      await Haptics.impact({ style: ImpactStyle.Light });
                    } catch {}
                  }
                }}
                className="flex items-center gap-2.5 p-3 rounded-2xl bg-[#1A4329]/5 border border-transparent hover:bg-[#1A4329]/10 hover:border-[#1A4329]/10 transition cursor-pointer active:scale-95"
              >
                <span className="text-xl">{drink.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-[#1A4329] truncate">{drink.name}</p>
                  <span className="inline-block px-1.5 py-0.5 mt-0.5 rounded-md bg-[#F48C24]/10 text-[#F48C24] text-[8px] font-black uppercase tracking-wider">
                    {drink.tag}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-3 border-t border-[#1A4329]/5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#1A4329]/40 mb-2">
            {getWeatherInfo().comboTitle}
          </p>
          {getWeatherInfo().comboItems.map((combo, idx) => (
            <div
              key={idx}
              onClick={async () => {
                setCardFlipped(!cardFlipped);
                playTickSound();
                if (Capacitor.isNativePlatform()) {
                  try {
                    await Haptics.impact({ style: ImpactStyle.Light });
                  } catch {}
                }
              }}
              className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-r from-[#F48C24]/5 to-[#ffb366]/5 border border-[#F48C24]/10 hover:from-[#F48C24]/10 hover:to-[#ffb366]/10 hover:border-[#F48C24]/20 transition cursor-pointer active:scale-[0.98]"
            >
              <span className="text-2xl">{combo.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-[#F48C24]">{combo.name}</p>
                <p className="text-[9px] text-[#1A4329]/50 font-bold mt-0.5">{combo.desc}</p>
              </div>
              <span className="text-[10px] font-extrabold text-[#F48C24] bg-[#F48C24]/10 px-2 py-0.5 rounded-full">
                Combo
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Sizin Sevimliləriniz Section */}
      {favoriteItems.length > 0 && (
        <section
          className="rounded-[28px] p-5 border shadow-[0_12px_40px_rgba(26,67,41,0.02)] bg-white"
          style={{ borderColor: 'rgba(26, 67, 41, 0.05)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-[#F48C24]" />
            <p className="text-xs font-bold uppercase tracking-wider text-[#1A4329]/70">
              {tx(safeLang, 'Sizin Sevimliləriniz', 'Ваше любимое', 'Your Favorites')}
            </p>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
            {favoriteItems.map((item) => (
              <div
                key={item.name}
                onClick={async () => {
                  setCardFlipped(!cardFlipped);
                  playTickSound();
                  if (Capacitor.isNativePlatform()) {
                    try {
                      await Haptics.impact({ style: ImpactStyle.Light });
                    } catch {}
                  }
                }}
                className="flex items-center gap-3 shrink-0 rounded-2xl p-3 border border-slate-100 bg-[#1A4329]/5 active:scale-95 transition-transform cursor-pointer hover:border-[#1A4329]/10"
                style={{ minWidth: '160px' }}
              >
                <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-lg border border-slate-100">
                  {item.category === 'coffee' ? '☕' : item.category === 'tea' ? '🍵' : item.category === 'sweet' ? '🍰' : item.category === 'food' ? '🥪' : '🥤'}
                </div>
                <div className="overflow-hidden">
                  <p className="text-[12px] font-bold text-[#1A4329] truncate w-24">{item.name}</p>
                  <p className="text-[9px] text-[#1A4329]/40 mt-0.5 font-semibold">{item.count} {tx(safeLang, 'dəfə', 'раз', 'times')}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pending claim codes */}
      <section
        className="rounded-[28px] p-5 border shadow-[0_12px_40px_rgba(26,67,41,0.02)] bg-white"
        style={{ borderColor: 'rgba(26, 67, 41, 0.05)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-[#F48C24] animate-pulse" />
            <p className="text-xs font-bold uppercase tracking-wider text-[#1A4329]/70">
              {tx(safeLang, 'Aktiv Kodlar', 'Коды наград', 'Active Codes')}
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#F48C24]/10 text-[#F48C24]"
          >
            {pendingClaims.length}
          </span>
        </div>
        
        <div className="mt-4 flex gap-3.5 overflow-x-auto pb-1.5 scrollbar-hide">
          {pendingClaims.length === 0 ? (
            <div className="w-full rounded-2xl py-6 text-center text-xs text-[#1A4329]/30 border border-dashed border-[#1A4329]/10 bg-slate-50/50">
              {tx(safeLang, 'Hələ aktiv kodunuz yoxdur', 'Нет активных кодов', 'No active codes yet')}
            </div>
          ) : (
            pendingClaims.map((row: any) => (
              <div
                key={row.id}
                className="relative min-w-[170px] shrink-0 rounded-2xl p-4 overflow-hidden border border-[#F48C24]/20 shadow-inner flex flex-col justify-between"
                style={{
                  background: 'linear-gradient(135deg, rgba(244,140,36,0.06) 0%, rgba(244,140,36,0.03) 100%)',
                }}
              >
                {/* Coupon ticket side notches */}
                <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#FAF8F5] border-r border-[#F48C24]/20" />
                <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#FAF8F5] border-l border-[#F48C24]/20" />

                <div>
                  <p className="text-[8px] font-black uppercase tracking-[0.25em] text-[#F48C24]">
                    {tx(safeLang, 'Kassaya Təqdim Et', 'На кассе', 'Present at POS')}
                  </p>
                  <p className="mt-1.5 text-2xl font-black text-[#1A4329] tracking-tight font-mono">
                    {row.claim_code}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-[#1A4329]/5 text-[10px] text-[#1A4329]/50 truncate font-semibold">
                  {row.reward_name}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );

  const renderOrderTab = () => {
    const cats = Array.from(new Set(menuItems.map(it => it.category).filter(Boolean))) as string[];
    const filtered = menuItems.filter(it => it.category === selectedCategory);
    
    return (
      <div className="space-y-6">
        {/* Order ahead heading */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-2xl font-black text-[#1A4329] tracking-tight">
              {tx(safeLang, 'Sifariş Et', 'Заказать', 'Pre-Order')}
            </h2>
            <p className="text-[10px] text-[#1A4329]/60 font-bold uppercase tracking-wider mt-0.5">
              {tx(safeLang, 'Növbə gözləmədən qəhvəni al', 'Кофе без очереди', 'Skip the line, order ahead')}
            </p>
          </div>
          {customerCart.length > 0 && (
            <button
              onClick={() => setShowCartSheet(true)}
              className="relative flex items-center justify-center h-10 w-10 rounded-full bg-[#1A4329] text-white shadow-lg active:scale-95 transition"
            >
              <ShoppingBag size={18} />
              <span className="absolute -top-1 -right-1 bg-[#F48C24] text-white text-[9px] font-black h-4.5 w-4.5 rounded-full flex items-center justify-center border border-white">
                {customerCart.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
            </button>
          )}
        </div>

        {/* Categories scroll slider styled exactly like mockup */}
        {cats.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-2 pt-1 scrollbar-hide">
            {cats.map(cat => {
              const firstItem = menuItems.find(it => it.category === cat);
              const catImage = getProductImage(firstItem?.name || cat, firstItem?.image_url);
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex-none w-20 flex flex-col items-center gap-2 rounded-[22px] p-3 transition border ${
                    isSelected
                      ? 'bg-[#F48C24] border-[#F48C24] text-white shadow-[0_6px_16px_rgba(244,140,36,0.25)]'
                      : 'bg-white border-[#1A4329]/10 text-[#1A4329]/75 hover:bg-slate-50'
                  }`}
                >
                  <div className={`h-11 w-11 rounded-full flex items-center justify-center overflow-hidden bg-slate-100 border ${isSelected ? 'border-white/20' : 'border-slate-100'}`}>
                    <img src={catImage} alt={cat} className="h-full w-full object-cover" />
                  </div>
                  <span className="text-[10px] font-black text-center truncate w-full uppercase tracking-wider">{cat}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Menu list grid */}
        {menuLoading ? (
          <div className="py-20 text-center text-xs text-[#1A4329]/40 font-bold">
            {tx(safeLang, 'Menyu yüklənir...', 'Меню загружается...', 'Loading menu...')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-xs text-[#1A4329]/40 font-bold border border-dashed border-[#1A4329]/10 rounded-3xl bg-white/50">
            {tx(safeLang, 'Bu kateqoriyada məhsul tapılmadı', 'Нет товаров в этой категории', 'No products in this category')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3.5">
            {filtered.map(item => {
              const isHot = item.name.toLowerCase().includes('isti') || item.name.toLowerCase().includes('hot') || item.category?.toLowerCase().includes('isti');
              const badgeText = isHot ? 'HOT' : item.name.toLowerCase().includes('iced') || item.name.toLowerCase().includes('soyuq') ? 'ICED' : 'NEW';
              const badgeColor = badgeText === 'HOT' ? 'bg-[#F48C24] text-white' : badgeText === 'ICED' ? 'bg-cyan-500 text-white' : 'bg-[#1A4329] text-white';
              
              return (
                <div
                  key={item.id}
                  onClick={() => handleOpenModifiers(item)}
                  className="relative group flex flex-col justify-between rounded-[28px] border bg-white p-3.5 transition active:scale-[0.98] shadow-[0_8px_24px_rgba(26,67,41,0.02)] cursor-pointer"
                  style={{ borderColor: 'rgba(26, 67, 41, 0.05)' }}
                >
                  {/* Badge top-left */}
                  <span className={`absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${badgeColor}`}>
                    {badgeText}
                  </span>
                  <div>
                    <img
                      src={getProductImage(item.name, item.image_url)}
                      alt={item.name}
                      className="h-28 w-full rounded-2xl object-cover border border-slate-100 group-hover:scale-[1.02] transition duration-300"
                    />
                    <h3 className="mt-3 text-xs font-black text-[#1A4329] leading-tight line-clamp-1">{item.name}</h3>
                  </div>

                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <span className="block text-[11px] font-bold text-[#1A4329]/40 uppercase tracking-wider scale-90 -translate-x-1">{tx(safeLang, 'QİYMƏT', 'ЦЕНА', 'PRICE')}</span>
                      <span className="text-xs font-black text-[#1A4329]">
                        {Number(item.price || 0).toFixed(2)} ₼
                      </span>
                    </div>
                    {/* Circle plus button */}
                    <div className="h-7 w-7 rounded-full bg-[#F48C24] flex items-center justify-center text-white font-bold text-lg shadow-[0_4px_10px_rgba(244,140,36,0.2)] hover:scale-105 active:scale-95 transition">
                      +
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderModifierSheet = () => {
    if (!modifierSheetItem) return null;
    const basePrice = selectedVariant ? Number(selectedVariant.price) : Number(modifierSheetItem.price || 0);
    const modifiersTotal = selectedModifiers.reduce((acc, m) => acc + m.price, 0);
    const finalPrice = basePrice + modifiersTotal;

    const hasVariants = modifierSheetItem.variants && modifierSheetItem.variants.length > 0;
    const hasModifiers = modifierSheetItem.modifiers && modifierSheetItem.modifiers.length > 0;

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
        {/* Backdrop click closer */}
        <div className="absolute inset-0" onClick={() => setModifierSheetItem(null)} />
        
        <div className="relative w-full max-w-md rounded-t-[36px] bg-[#FAF8F5] border-t border-slate-200/50 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.15)] max-h-[90vh] overflow-y-auto flex flex-col justify-between">
          <div className="overflow-x-hidden">
            {/* Mockup-Style Header */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setModifierSheetItem(null)}
                className="h-9 w-9 rounded-full bg-white flex items-center justify-center border border-[#1A4329]/5 shadow-sm text-[#1A4329]"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-[11px] font-black text-[#1A4329] uppercase tracking-wider">
                {tx(safeLang, 'Məhsul Təfərrüatı', 'Детали продукта', 'Product Details')}
              </span>
              <button
                onClick={() => setModifierSheetItem(null)}
                className="h-9 w-9 rounded-full bg-white flex items-center justify-center border border-[#1A4329]/5 shadow-sm text-[#1A4329]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Asymmetrical Layout Row */}
            <div className="grid grid-cols-12 gap-3 items-start my-2">
              {/* Left Column: Details & Specs */}
              <div className="col-span-7 space-y-3">
                <div>
                  <h2 className="text-xl font-black text-[#1A4329] leading-tight">{modifierSheetItem.name}</h2>
                  <p className="text-[9px] text-[#1A4329]/50 font-bold uppercase tracking-wider mt-0.5">
                    {modifierSheetItem.category || 'Craft Blend'}
                  </p>
                </div>

                {/* Rating stars */}
                <div className="flex items-center gap-1">
                  <span className="text-amber-400 text-xs">★★★★★</span>
                  <span className="text-[10px] text-[#1A4329]/50 font-bold">(4.8)</span>
                </div>

                {/* Price */}
                <div>
                  <span className="text-xl font-black text-[#F48C24]">
                    {finalPrice.toFixed(2)} ₼
                  </span>
                </div>

                {/* Vertical Specs list */}
                <div className="pt-2 space-y-1.5 border-t border-[#1A4329]/5">
                  <div>
                    <span className="block text-[8px] font-bold text-[#1A4329]/40 uppercase tracking-wider">{tx(safeLang, 'KALORİ', 'КАЛОРИИ', 'CALORIES')}</span>
                    <span className="text-[11px] font-black text-[#1A4329]">210 Cal</span>
                  </div>
                  <div>
                    <span className="block text-[8px] font-bold text-[#1A4329]/40 uppercase tracking-wider">{tx(safeLang, 'ÖLÇÜ', 'РАЗМЕР', 'SIZE')}</span>
                    <span className="text-[11px] font-black text-[#1A4329]">{selectedVariant?.name || 'Standard'}</span>
                  </div>
                  <div>
                    <span className="block text-[8px] font-bold text-[#1A4329]/40 uppercase tracking-wider">{tx(safeLang, 'NÖV', 'ТИП', 'TYPE')}</span>
                    <span className="text-[11px] font-black text-[#1A4329]">Espresso-Base</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Circular Offset Image */}
              <div className="col-span-5 flex justify-end">
                <div className="relative h-36 w-36 rounded-full overflow-hidden border-[6px] border-white shadow-md translate-x-4 select-none pointer-events-none bg-slate-100 flex items-center justify-center">
                  <img
                    src={getProductImage(modifierSheetItem.name, modifierSheetItem.image_url)}
                    alt={modifierSheetItem.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="mt-4 space-y-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-[#1A4329]/50">
                {tx(safeLang, 'Təsvir', 'Описание', 'Description')}
              </p>
              <p className="text-[11px] text-[#1A4329]/60 leading-relaxed font-semibold">
                {modifierSheetItem.description || tx(safeLang, 'Emalatkhana tərəfindən sevgi ilə hazırlanan xüsusi premium qarışıq.', 'Особый премиум-бленд, приготовленный с любовью в Emalatkhana.', 'A special premium blend prepared with love by Emalatkhana.')}
                <span className="text-[#F48C24] font-black ml-1 cursor-pointer">{tx(safeLang, ' ...Daha Ətraflı', ' ...Подробнее', ' ...Read More')}</span>
              </p>
            </div>

            {/* Variants Option section */}
            {hasVariants && (
              <div className="mt-5 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#1A4329]/50">
                  {tx(safeLang, 'Ölçü Seçin', 'Выберите размер', 'Select Size')}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  {modifierSheetItem.variants.map((v: any) => (
                    <button
                      key={v.name}
                      onClick={() => setSelectedVariant(v)}
                      className={`flex-none px-4 py-2.5 rounded-full border transition text-center min-w-[70px] ${
                        selectedVariant?.name === v.name
                          ? 'border-[#F48C24] bg-[#F48C24]/5 text-[#1A4329] font-black'
                          : 'border-[#1A4329]/5 bg-white text-[#1A4329]/75 font-semibold'
                      }`}
                    >
                      <span className="text-[11px] block">{v.name}</span>
                      <span className="text-[9px] text-[#F48C24] font-black mt-0.5">+{Number(v.price - modifierSheetItem.price).toFixed(2)} ₼</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Modifiers Checkbox list */}
            {hasModifiers && (
              <div className="mt-5 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#1A4329]/50">
                  {tx(safeLang, 'Əlavələr', 'Добавки', 'Modifiers')}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  {modifierSheetItem.modifiers.map((m: any) => {
                    const isSelected = selectedModifiers.some(mod => mod.name === m.name);
                    return (
                      <button
                        key={m.name}
                        onClick={() => handleToggleModifier(m)}
                        className={`flex-none px-4 py-2.5 rounded-full border transition text-center min-w-[70px] ${
                          isSelected
                            ? 'border-[#F48C24] bg-[#F48C24]/5 text-[#1A4329] font-black'
                            : 'border-[#1A4329]/5 bg-white text-[#1A4329]/75 font-semibold'
                        }`}
                      >
                        <span className="text-[11px] block">{m.name}</span>
                        <span className="text-[9px] text-[#F48C24] font-black mt-0.5">+{Number(m.price).toFixed(2)} ₼</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Fixed Action Panel */}
          <div className="mt-6 pt-4 border-t border-[#1A4329]/5 flex items-center justify-between gap-4">
            <button
              onClick={handleAddToCart}
              className="flex-1 rounded-full border border-[#1A4329]/20 hover:border-[#1A4329] bg-white text-[#1A4329] py-3.5 text-xs font-black transition active:scale-95 flex items-center justify-center gap-1.5 shadow-sm"
            >
              <ShoppingBag size={14} />
              {tx(safeLang, 'Səbətə At', 'В корзину', 'Add To Cart')}
            </button>
            <button
              onClick={() => {
                handleAddToCart();
                setShowCartSheet(true);
              }}
              className="flex-1 rounded-full bg-[#F48C24] hover:bg-[#e07f1d] text-white py-3.5 text-xs font-black transition active:scale-95 flex items-center justify-center gap-1.5 shadow-[0_4px_12px_rgba(244,140,36,0.25)]"
            >
              {tx(safeLang, 'İndi Al', 'Купить', 'Buy Now')}
            </button>
          </div>
        </div>
      </div>
    );
  };

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
        <section className="rounded-[28px] p-5 border shadow-[0_12px_40px_rgba(26,67,41,0.02)] bg-white" style={{ borderColor: 'rgba(26, 67, 41, 0.05)' }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] font-bold text-[#1A4329] flex items-center gap-2">
              <Gift size={16} className="text-[#F48C24]" />
              {tx(safeLang, 'Aktiv kampaniyalar', 'Активные кампании', 'Active offers')}
            </p>
            <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black text-white" style={{ backgroundColor: primaryColor }}>{campaigns.length}</span>
          </div>

          <div className="mt-4 space-y-4">
            {campaigns.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center border border-dashed border-[#1A4329]/10 rounded-2xl bg-slate-50/50">
                <Gift size={28} className="text-[#1A4329]/20" />
                <p className="text-[13px] text-[#1A4329]/40 font-semibold">{tx(safeLang, 'Hazırda aktiv kampaniya yoxdur', 'Сейчас нет активных кампаний', 'No active campaigns right now')}</p>
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
                  className="relative overflow-hidden rounded-[24px] border p-5 shadow-sm transition-all duration-300"
                  style={{
                    backgroundColor: isActive ? '#f0fdf4' : '#ffffff',
                    borderColor: isActive ? 'rgba(34,197,94,0.3)' : 'rgba(26,67,41,0.08)'
                  }}
                >
                  {/* Coupon ticket side notches */}
                  <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#FAF8F5] border-r border-[#1A4329]/10" style={{ borderColor: isActive ? 'rgba(34,197,94,0.3)' : 'rgba(26,67,41,0.08)' }} />
                  <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#FAF8F5] border-l border-[#1A4329]/10" style={{ borderColor: isActive ? 'rgba(34,197,94,0.3)' : 'rgba(26,67,41,0.08)' }} />

                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h4 className="text-[15px] font-black text-[#1A4329] leading-tight">{row.name}</h4>
                      <p className="mt-1.5 text-[13px] font-extrabold" style={{ color: primaryColor }}>
                        {row.discount_percent}% {tx(safeLang, 'endirim', 'скидка', 'discount')}
                      </p>
                      <p className="mt-2 text-[10px] font-bold text-[#1A4329]/40">
                        {row.start_time} - {row.end_time} • {row.categories || 'ALL'}
                      </p>
                    </div>
                  </div>

                  {isActive ? (
                    <div className="mt-5 pt-4 border-t border-dashed border-[#1A4329]/10 space-y-4">
                      {/* Countdown Timer UI */}
                      <div className="flex items-center justify-between text-xs font-bold text-emerald-600">
                        <span>{tx(safeLang, 'Kod aktivdir', 'Код активен', 'Code is active')}</span>
                        <span className="font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                        </span>
                      </div>

                      {/* Ticking Progress Bar */}
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-1000 rounded-full"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>

                      {/* Revealed QR Code Container */}
                      <div className="flex flex-col items-center justify-center p-4 bg-[#FAF8F5] border border-slate-100 rounded-2xl shadow-inner">
                        {campaignQrs[row.id] ? (
                          <img src={campaignQrs[row.id]} alt="campaign qr" className="h-36 w-36 object-contain" />
                        ) : (
                          <div className="h-36 w-36 flex items-center justify-center text-slate-800 text-xs font-mono">
                            {row.id}
                          </div>
                        )}
                        <p className="mt-2 text-[10px] font-mono font-bold text-[#1A4329] tracking-widest uppercase">
                          {tx(safeLang, 'KASSAYA TƏQDİM EDİN', 'ПРЕДЪЯВИТЕ НА КАССЕ', 'PRESENT TO CASHIER')}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 pt-3 border-t border-[#1A4329]/5 flex justify-end">
                      <button
                        type="button"
                        onClick={() => activateCampaign(row.id)}
                        className="relative overflow-hidden rounded-xl px-4 py-2 text-[11px] font-black text-white transition-all active:scale-[0.97]"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
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
        <section className="rounded-[28px] p-5 border shadow-[0_12px_40px_rgba(26,67,41,0.02)] bg-white" style={{ borderColor: 'rgba(26, 67, 41, 0.05)' }}>
          <p className="text-[15px] font-bold text-[#1A4329] flex items-center gap-2">
            <Sparkles size={16} className="text-[#F48C24]" />
            {tx(safeLang, 'Claim kodları', 'Коды наград', 'Claim codes')}
          </p>
          <div className="mt-4 space-y-3">
            {pendingClaims.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[#1A4329]/30 border border-dashed border-[#1A4329]/10 rounded-2xl bg-slate-50/50">
                {tx(safeLang, 'Aktiv claim kodu yoxdur', 'Активных кодов нет', 'No active claim codes')}
              </div>
            ) : pendingClaims.map((row: any) => (
              <div key={row.id} className="relative overflow-hidden rounded-2xl p-4 border border-[#F48C24]/20 bg-[#F48C24]/5 shadow-inner">
                {/* Side notches for ticket feeling */}
                <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#FAF8F5] border-r border-[#F48C24]/20" />
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#FAF8F5] border-l border-[#F48C24]/20" />

                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#1A4329]/50">{tx(safeLang, 'Kassada göstərin', 'Покажите на кассе', 'Show at POS')}</p>
                <p className="mt-1 text-2xl font-black text-[#1A4329] font-mono">{row.claim_code}</p>
                <p className="mt-1 text-[11px] text-[#1A4329]/50">{row.reward_name}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderCartSheet = () => {
    if (!showCartSheet) return null;
    const cartTotal = customerCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
        {/* Backdrop click closer */}
        <div className="absolute inset-0" onClick={() => setShowCartSheet(false)} />
        
        <div className="relative w-full max-w-md rounded-t-[36px] bg-[#FAF8F5] border-t border-slate-200/50 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.15)] max-h-[85vh] overflow-y-auto flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-[#1A4329]">{tx(safeLang, 'Səbətiniz', 'Ваша корзина', 'Your Cart')}</h2>
              <button
                onClick={() => setShowCartSheet(false)}
                className="h-8 w-8 rounded-full bg-[#1A4329]/5 text-[#1A4329] flex items-center justify-center font-bold hover:bg-[#1A4329]/10"
              >
                ✕
              </button>
            </div>

            {/* Cart Items list */}
            <div className="mt-5 space-y-3">
              {customerCart.map((item, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between p-3 rounded-2xl bg-white border border-[#1A4329]/5"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-black text-[#1A4329]">{item.name}</p>
                    {item.variant_name && (
                      <p className="text-[9px] text-[#1A4329]/60 font-semibold mt-0.5">
                        Size: {item.variant_name}
                      </p>
                    )}
                    {item.selected_modifiers && item.selected_modifiers.length > 0 && (
                      <p className="text-[9px] text-[#1A4329]/40 font-semibold mt-0.5">
                        Extras: {item.selected_modifiers.map((m: any) => m.name).join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-[#F48C24]">
                      {(item.price * item.quantity).toFixed(2)} ₼
                    </span>
                    <button
                      onClick={() => handleRemoveFromCart(index)}
                      className="h-6 w-6 rounded-full bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center text-[10px] font-bold"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Note text field */}
            <div className="mt-5 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-[#1A4329]/50">
                {tx(safeLang, 'Sifariş Qeydi', 'Примечание', 'Order Notes')}
              </p>
              <textarea
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder={tx(safeLang, 'Məsələn: Şəkərsiz olsun, isti olsun...', 'Например: Без сахара, горячий...', 'e.g. No sugar, extra hot...')}
                className="w-full rounded-2xl border border-[#1A4329]/5 bg-white p-3.5 text-xs text-[#1A4329] placeholder-[#1A4329]/30 focus:border-[#F48C24] focus:ring-1 focus:ring-[#F48C24] outline-none min-h-[70px] resize-none"
              />
            </div>
          </div>

          {/* Cart actions footer bar */}
          <div className="mt-6 pt-4 border-t border-[#1A4329]/5 flex items-center justify-between gap-4">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-[#1A4329]/40">
                {tx(safeLang, 'Ümumi Məbləğ', 'Общая сумма', 'Total Amount')}
              </p>
              <p className="text-xl font-black text-[#1A4329] tracking-tight">
                {cartTotal.toFixed(2)} ₼
              </p>
            </div>
            <button
              onClick={handleCheckoutPreOrder}
              disabled={preOrderSubmitting}
              className="flex-1 rounded-2xl bg-[#1A4329] hover:bg-[#153621] disabled:opacity-50 text-white py-3 text-xs font-black transition active:scale-95 flex items-center justify-center gap-1.5 shadow-md"
            >
              {preOrderSubmitting ? '...' : tx(safeLang, 'Sifarişi Təsdiqlə', 'Оформить предзаказ', 'Confirm Order')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderPreOrderSuccess = () => {
    if (!preOrderSuccess) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
        <div className="w-full max-w-sm rounded-[32px] bg-white border border-[#1A4329]/5 p-6 shadow-2xl text-center space-y-5">
          <div className="mx-auto h-16 w-16 rounded-full bg-[#1A4329]/5 text-[#F48C24] flex items-center justify-center text-3xl animate-bounce">
            🎉
          </div>
          
          <div className="space-y-2">
            <h2 className="text-lg font-black text-[#1A4329] leading-tight">
              {tx(safeLang, 'Sifariş Qəbul Olundu!', 'Предзаказ оформлен!', 'Order Confirmed!')}
            </h2>
            <p className="text-xs text-[#1A4329]/60 leading-relaxed font-semibold">
              {tx(
                safeLang,
                'Sifarişiniz hazırlandıqda sizə bildiriş göndəriləcək. Kassaya yaxınlaşıb təslim ala bilərsiniz.',
                'Вам придет уведомление, когда заказ будет готов. Вы можете забрать его на кассе.',
                'We will notify you when your order is ready. You can pick it up at the cashier counter.'
              )}
            </p>
          </div>

          <div className="rounded-2xl bg-[#FAF8F5] p-3 border border-[#1A4329]/5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-[#1A4329]/40">
              {tx(safeLang, 'Sifariş Nömrəsi', 'Номер заказа', 'Order Number')}
            </p>
            <p className="text-lg font-black text-[#F48C24] tracking-tight mt-0.5">
              #{preOrderSuccessId.slice(-6).toUpperCase()}
            </p>
          </div>

          <button
            onClick={() => setPreOrderSuccess(false)}
            className="w-full rounded-2xl bg-[#1A4329] hover:bg-[#153621] text-white py-3 text-xs font-black transition active:scale-95"
          >
            {tx(safeLang, 'Əla', 'Отлично', 'Awesome')}
          </button>
        </div>
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
      className="relative min-h-dvh overflow-x-hidden overflow-y-auto overscroll-contain text-[#1A4329] bg-[#FAF8F5]"
      style={{
        background: `linear-gradient(180deg, #FAF8F5 0%, #FAF6F0 100%)`,
      }}
    >
      <style>{`
        @keyframes wave {
          0% { transform: translateX(0); }
          50% { transform: translateX(-25%); }
          100% { transform: translateX(-50%); }
        }
        .animate-wave {
          animation: wave 12s linear infinite;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
        .perspective-1000 {
          perspective: 1000px;
        }
        .backface-hidden {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .preserve-3d {
          transform-style: preserve-3d;
        }
        .rotate-y-180 {
          transform: rotateY(180deg);
        }
      `}</style>

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-28 pt-5">
        {/* Language switcher */}
        <div className="mb-4 flex justify-end">
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-extrabold text-[#1A4329]/70 bg-white border border-[#1A4329]/10 shadow-sm"
          >
            <Languages size={13} />
            <button type="button" onClick={() => setLang('az')} className={`transition ${safeLang === 'az' ? 'font-black text-[#F48C24]' : ''}`}>AZ</button>
            <button type="button" onClick={() => setLang('en')} className={`transition ${safeLang === 'en' ? 'font-black text-[#F48C24]' : ''}`}>EN</button>
            <button type="button" onClick={() => setLang('ru')} className={`transition ${safeLang === 'ru' ? 'font-black text-[#F48C24]' : ''}`}>RU</button>
          </div>
        </div>

        {/* Tab content */}
        {resolvedActiveTab === 'home' && renderHome()}
        {resolvedActiveTab === 'order' && renderOrderTab()}
        {resolvedActiveTab === 'offers' && renderOffers()}
        {resolvedActiveTab === 'barista' && aiBaristaEnabled && renderBarista()}
        {resolvedActiveTab === 'falci' && aiFalciEnabled && renderFalci()}
        {resolvedActiveTab === 'profile' && renderProfile()}
      </div>

      {/* Bottom Navigation — compact glassmorphism capsule */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
      >
        <div className="mx-auto max-w-md px-4 pb-3">
          <div
            className="flex items-center justify-around rounded-[32px] py-2 border shadow-[0_12px_40px_rgba(26,67,41,0.06)] bg-white"
            style={{
              borderColor: 'rgba(26, 67, 41, 0.05)',
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
                  className={`relative flex items-center justify-center transition-all duration-300 ${
                    active
                      ? 'rounded-full bg-[#F48C24] text-white px-4 py-2 shadow-[0_4px_12px_rgba(244,140,36,0.25)] gap-1.5'
                      : 'text-[#1A4329]/45 hover:text-[#1A4329]/70 p-2.5 rounded-full hover:bg-slate-50'
                  }`}
                >
                  {tab.icon}
                  {active && (
                    <span className="text-[10px] font-black uppercase tracking-wider animate-fadeIn">
                      {tab.label}
                    </span>
                  )}
                  {unreadCount > 0 && (
                    <span className={`absolute ${active ? '-top-1 -right-1' : 'top-1.5 right-1.5'} flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white bg-red-500`}>
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4 animate-modalFadeIn"
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
            className="w-full max-w-md rounded-t-[32px] bg-[#FAF8F5] border-t border-slate-200/50 p-6 space-y-6 shadow-2xl animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxHeight: '85vh',
            }}
          >
            {/* Modal Header/Handle */}
            <div className="flex flex-col items-center gap-2">
              <div className="h-1.5 w-12 rounded-full bg-[#1A4329]/10" />
              <h3 className="text-md font-black text-[#1A4329] mt-2">
                {tx(safeLang, 'Skan Et və Qazan', 'Сканируй и Получай', 'Scan & Earn')}
              </h3>
            </div>

            {/* QR Scanner Container */}
            <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-white border border-[#1A4329]/5 shadow-sm">
              {cardQr ? (
                <div className="p-1 bg-white rounded-xl">
                  <img src={cardQr} alt="qr" className="h-56 w-56 object-contain" />
                </div>
              ) : (
                <div className="h-56 w-56 flex items-center justify-center text-slate-800 font-mono text-sm">
                  {customer.card_id}
                </div>
              )}
              <div className="mt-4 text-center">
                <p className="text-[#1A4329] font-mono text-sm tracking-wider font-bold">
                  {formatCardId(customer.card_id)}
                </p>
                <p className="text-[#F48C24] text-[10px] mt-1 font-semibold uppercase tracking-wider">
                  {tx(safeLang, 'KASSAYA TƏQDİM EDİN', 'ПРЕДЪЯВИТЕ НА КАССЕ', 'PRESENT TO CASHIER')}
                </p>
              </div>
            </div>

            {/* Quick Tips */}
            <div className="rounded-2xl bg-white border border-[#1A4329]/5 p-4 flex gap-3 items-center">
              <span className="text-lg">💡</span>
              <p className="text-[11px] text-[#1A4329]/60 leading-relaxed font-semibold">
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
              className="w-full py-3.5 rounded-2xl bg-[#1A4329] text-white font-black text-[13px] active:scale-95 transition-transform shadow-md"
            >
              {tx(safeLang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
        </div>
      )}

      {/* Modifier sheet, Cart sheet & Success modals */}
      {renderModifierSheet()}
      {renderCartSheet()}
      {renderPreOrderSuccess()}
    </div>
  );
}
