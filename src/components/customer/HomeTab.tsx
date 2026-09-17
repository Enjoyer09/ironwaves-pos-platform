import React from 'react';
import { Gift, Sparkles, QrCode, Menu } from 'lucide-react';
import { ImpactStyle } from '@capacitor/haptics';
import { tx } from '../../i18n';
import { formatCardId, playTickSound, nativeHapticImpact, Haptic } from '../../lib/customer_utils';
import { FALLBACK_TIER_COLOR, fallbackTierLabel } from '../../lib/loyalty';

const CATEGORY_EMOJI: Record<string, string> = { coffee: '☕', tea: '🍵', sweet: '🍰', food: '🥪', cold: '🥤' };

/* ── Cozy coffee-shop helpers ──────────────────────────────────── */
function coffeeGreeting(lang: string): string {
  const h = new Date().getHours();
  if (h < 12) return lang === 'ru' ? 'Доброе утро' : lang === 'en' ? 'Good morning' : 'Sabahlar xeyir';
  if (h < 18) return lang === 'ru' ? 'Добрый день' : lang === 'en' ? 'Good afternoon' : 'Günortanız xeyir';
  return lang === 'ru' ? 'Добрый вечер' : lang === 'en' ? 'Good evening' : 'Axşamınız xeyir';
}

/* Days until the customer's next birthday (0 = today, -1 = no date). */
function daysUntilNextBirthday(iso?: string | null): number {
  if (!iso) return -1;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return -1;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next.getTime() < today.getTime()) {
    next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  }
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

/* Energetic brand hero — orange panel (no steam cup). */

/* ── Animated Counter ────────────────────────────────────────────── */
function AnimatedCounter({ value, suffix = '', decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = React.useState(0);
  const prevRef = React.useRef(0);
  const rafRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    const startVal = prevRef.current;
    const endVal = value;
    if (startVal === endVal) { setDisplay(endVal); return; }
    const duration = 700;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(startVal + (endVal - startVal) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    prevRef.current = endVal;
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);

  return <>{display.toFixed(decimals)}{suffix}</>;
}

/* ── Confetti burst ─────────────────────────────────────────────── */
function spawnConfetti(originX: number, originY: number) {
  const colors = ['#F48C24', '#ffb366', '#1A4329', '#34d399', '#facc15', '#a78bfa', '#f472b6'];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';
    const angle = Math.random() * 360;
    const distance = 80 + Math.random() * 180;
    const dx = Math.cos((angle * Math.PI) / 180) * distance;
    const dy = Math.sin((angle * Math.PI) / 180) * distance - 60;
    const rot = (Math.random() - 0.5) * 720;
    const duration = 0.8 + Math.random() * 0.8;
    const size = 5 + Math.random() * 8;
    el.style.cssText = `
      left: ${originX - size / 2}px;
      top: ${originY - size / 2}px;
      width: ${size}px;
      height: ${size}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      --dx: ${dx}px;
      --dy: ${dy}px;
      --rot: ${rot}deg;
      --duration: ${duration}s;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration * 1000 + 100);
  }
}

/* ── Toast ──────────────────────────────────────────────────────── */
function showToast(message: string) {
  const el = document.createElement('div');
  el.className = 'cust-toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

type Props = {
  safeLang: string;
  customer: any;
  customer_card_id: string;
  branding: any;
  wallet: any;
  primaryColor: string;
  accentColor: string;
  programMode: string;
  cardQr: string;
  showQrCard: boolean;
  showWallet: boolean;
  balanceSuffix: string;
  heroImage: string;
  cardFlipped: boolean;
  setCardFlipped: (v: boolean) => void;
  claimReward: (rewardId?: string) => void;
  claiming: boolean;
  // P1.3 — kataloqda bir neçə sətir var; yalnız basılan sətir "yüklənir" göstərir.
  claimingRewardId?: string;
  rewards: any[];
  progressPercent: number;
  notifications: any[];
  favoriteItems: any[];
  pendingClaims: any[];
  claims: any[];
  geofenceAlert: boolean;
  setGeofenceAlert: (v: boolean) => void;
  recentItems: any[];
  onReorderItem: (item: any) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  setActiveTab: (tab: any) => void;
  openWalletPass: (e: React.MouseEvent, url: string) => void;
  get_customer_wallet_pass_url_fn: (cardId: string, token: string, lang: string) => string;
  sessionCreds: { cardId: string; token: string };
  data: any;
  activeOrders: any[];
  isLight?: boolean;
  designMode?: 'classic' | 'retro';
};

export default function HomeTab({
  safeLang, customer, customer_card_id, branding, wallet, primaryColor,
  accentColor, programMode, cardQr, showQrCard, showWallet, balanceSuffix,
  heroImage, cardFlipped, setCardFlipped, claimReward, claiming, claimingRewardId = '',
  rewards, progressPercent, notifications, favoriteItems, pendingClaims, claims,
  geofenceAlert, setGeofenceAlert, recentItems, searchQuery, setSearchQuery, setActiveTab,
  openWalletPass, get_customer_wallet_pass_url_fn, sessionCreds, data, isLight = false,
  designMode = 'classic', onReorderItem, activeOrders
}: Props) {

  const isRetro     = designMode === 'retro';
  const headerBtn   = isRetro
    ? (isLight ? 'border-[2px] border-[#2B1B1A] bg-white text-slate-900 shadow-[2px_2px_0px_0px_#2B1B1A]' : 'border-[2px] border-[#3D2F2A] bg-[#1E1714] text-white shadow-[2px_2px_0px_0px_#3D2F2A]')
    : (isLight ? 'bg-[#F5F5F7] border-transparent text-slate-700 shadow-none' : 'bg-white/8 border-white/12 text-white/90 backdrop-blur-md');
  const headerText  = isLight ? 'text-[#1D1D1F]' : 'text-white';
  const textPrimary = headerText;
  const subText     = isLight ? 'text-[#6E6E73]' : 'text-white/60';
  const textMuted   = isLight ? 'text-[#8E8E93]' : 'text-white/40';
  const borderSec   = isRetro ? (isLight ? 'border-[#2B1B1A]' : 'border-[#3D2F2A]') : (isLight ? 'border-[#E5E5EA]' : 'border-white/8');
  const bgCard      = isRetro ? 'retro-card' : (isLight ? 'cust-glass-light' : 'cust-glass premium-shadow');
  const inputSearch = isRetro
    ? (isLight ? 'border-[2px] border-[#2B1B1A] bg-white text-slate-900 placeholder-slate-400' : 'border-[2px] border-[#3D2F2A] bg-[#1E1714] text-white placeholder-white/30')
    : (isLight ? 'bg-[#F5F5F7] border-transparent text-[#1D1D1F] placeholder-[#8E8E93]' : 'bg-white/6 border-white/10 text-white placeholder-white/40 backdrop-blur-md');
  const walletBtn   = isRetro
    ? 'retro-btn font-black text-center flex items-center justify-center'
    : (isLight ? 'bg-[#F5F5F7] border-transparent text-[#1D1D1F] shadow-none hover:bg-[#EBEBF0]' : 'bg-white/6 hover:bg-white/10 text-white border-white/10 backdrop-blur-sm');
  const comboCard   = isRetro
    ? (isLight ? 'border-[2px] border-[#2B1B1A] bg-[#FAF8F5] text-slate-800' : 'border-[2px] border-[#3D2F2A] bg-[#1A1513] text-white')
    : (isLight ? 'bg-[#FFF3E8] border-transparent shadow-sm' : 'bg-gradient-to-r from-[#F48C24]/10 to-[#ffb366]/5 border-white/10 hover:border-[#F48C24]/30');

  const tier: any = customer?.tier || null;
  const tierColor = String(tier?.color || FALLBACK_TIER_COLOR);
  const tierLabel = (tier?.label?.[safeLang] as string) || tier?.label?.en || customer?.type || fallbackTierLabel(safeLang);
  const lifetimeStars = Number(customer?.lifetime_stars ?? customer?.stars ?? 0);

  // Next-reward clarity (Starbucks-style "X stars to a free drink")
  const starsBalance = Number(wallet?.stars_balance ?? 0);
  // P0.3 — hədd `customer_app_settings.reward_threshold`-dan gəlir (backend onu
  // `wallet.next_reward_at` kimi göndərir). `% 0` → NaN olmasın deyə clamp.
  const nextRewardAt = Math.max(1, Math.trunc(Number(wallet?.next_reward_at) || 10));
  const rewardRemaining = Math.max(0, nextRewardAt - starsBalance);
  // P0.5 — əvvəl hədiyyə adı "pulsuz Latte" kimi hardcoded idi; tenant menyusunda
  // Latte olmaya da bilər. Ad `customer_app_settings.reward_name`-dən gəlir
  // (backend onu `wallet.reward_name` kimi göndərir). Backend default-u "Reward"-dur
  // — bu "tenant seçməmişdir" sentineli sayılır və tərcümə olunmuş sözlə əvəzlənir.
  const rewardNameRaw = String(wallet?.reward_name || '').trim();
  const rewardName = rewardNameRaw && rewardNameRaw.toLowerCase() !== 'reward'
    ? rewardNameRaw
    : tx(safeLang, 'Hədiyyə', 'Награда', 'Reward');
  // Backend default-u sabit "10 ulduza..." mətnidir — tenant həddi 8-dirsə yalan
  // deyir. Ona görə default sentinel sayılır və mətn real həddən qurulur.
  const REWARD_DESC_SENTINEL = '10 ulduza 1 pulsuz içki';
  const rewardDescRaw = String(wallet?.reward_label || '').trim();
  const rewardDescription = rewardDescRaw && rewardDescRaw !== REWARD_DESC_SENTINEL
    ? rewardDescRaw
    : tx(safeLang,
        `${nextRewardAt} ulduza 1 ${rewardName}`,
        `${nextRewardAt} звёзд → 1 ${rewardName}`,
        `${nextRewardAt} stars → 1 ${rewardName}`);
  const rewardText = rewardRemaining > 0
    ? tx(safeLang, `${rewardRemaining} ulduz qaldı → ${rewardName}`, `${rewardRemaining} звезд до «${rewardName}»`, `${rewardRemaining} stars to ${rewardName}`)
    : tx(safeLang, `${rewardName} hazır!`, `«${rewardName}» готов!`, `${rewardName} ready!`);

  // P0.3 — möhür şəbəkəsi. Slot sayı həddin özüdür; 20-dən çox hədd 5-sütunlu
  // şəbəkədə oxunmaz olur, ona görə vizual limit var (rəqəm mətndə tam görünür).
  const stampSlots = Math.min(nextRewardAt, 20);
  const stampsFilled = starsBalance > 0 && starsBalance % nextRewardAt === 0
    ? Math.min(nextRewardAt, stampSlots)
    : Math.min(starsBalance % nextRewardAt, stampSlots);

  // P0.3 — `reward_card_style` artıq real fərq yaradır (admin ön baxışındakı
  // eyni xəritə: CustomerAppPanel.tsx). Əvvəl ayar yazılırdı, heç yerdə oxunmurdu.
  const cardStyle = String(branding?.reward_card_style || 'rounded').trim().toLowerCase();
  const cardRadius = cardStyle === 'soft-square' ? '12px' : cardStyle === 'glass' ? '16px' : '24px';
  const cardBlur = cardStyle === 'glass' ? 'blur(8px)' : undefined;

  // P0.3 — hero mətni tenant ayarındandır; ayar boşdursa köhnə mətn fallback qalır.
  const heroTitle = String(branding?.hero_title || '').trim()
    || tx(safeLang, 'Bugün hansı qəhvə ilə başlayırıq?', 'С чего начнём кофе сегодня?', "What coffee shall we start with today?");
  const heroSubtitle = String(branding?.hero_subtitle || '').trim()
    || tx(safeLang, 'Barista tövsiyəsi: günün brendini yoxla', 'Совет бариста: попробуй напиток дня', "Barista's tip: try the brew of the day");

  // P0.5 — tenant adı. Əvvəl bir neçə yerdə platforma adı "iRonWaves" hardcoded
  // idi və hər tenant-ın müştərisi onu görürdü.
  const brandName = String(branding?.app_name || branding?.company_name || '').trim() || 'Loyalty';
  const brandLogoUrl = String(branding?.logo_url || '').trim();

  // Birthday surprise detection
  const birthdaySoon = (() => {
    const bd = customer?.birth_date;
    if (!bd) return false;
    const days = daysUntilNextBirthday(bd);
    return days >= 0 && days <= 7;
  })();

  // P1 — personalization + gamification
  const [surpriseOpen, setSurpriseOpen] = React.useState(false);
  const baristaTip = (() => {
    const h = new Date().getHours();
    if (h < 11) return tx(safeLang, 'Sabahın ilk qəhvəsi: Flat White ilə başla', 'Начни утро с Flat White', 'Start your morning with a Flat White');
    if (h < 15) return tx(safeLang, 'Gün ortası: mocha ilə enerjini artır', 'Середина дня: мокка добавит энергии', 'Midday: a mocha boosts your energy');
    if (h < 19) return tx(safeLang, 'Gün batımı: caramel latte ilə fasilə et', 'На закате: caramel latte на перерыв', 'Sunset: take a break with a caramel latte');
    return tx(safeLang, 'Axşam: decaf ilə rahatla', 'Вечер: расслабись с decaf', 'Evening: unwind with a decaf');
  })();
  // Kampaniya sayı — mətn yalnız real aktiv kampaniya varsa göstərilir.
  const campaignsCount = Array.isArray((data as any)?.campaigns) ? (data as any).campaigns.length : 0;
  // P0.6 — əvvəl burada 4 sabit mətn vardı, ikisi yalan idi:
  //   • "Dostunu dəvət et, hər ikinizə ulduz!" — referral sistemi backend-də YOXDUR.
  //   • "Səhər 11-dən qabaq sifarişə 2x ulduz!" — saatdan asılı çarpan yoxdur
  //     (`double_points_days` ayarı da hələ heç yerdə oxunmur — P1.1).
  // Kassada mübahisəyə səbəb olurdu. Artıq siyahı yalnız real qaydalardan qurulur.
  const surpriseMessages = React.useMemo(() => {
    const rows: string[] = [];
    if (programMode === 'cashback') {
      const pct = Number(wallet?.cashback_percent || 0);
      rows.push(tx(safeLang,
        `Hər sifarişdən ${pct}% cashback hesabına yazılır`,
        `С каждого заказа ${pct}% кэшбэка зачисляется на счёт`,
        `Every order earns ${pct}% cashback`));
    } else {
      rows.push(tx(safeLang,
        `Hər qəhvə 1 ${wallet?.points_label || 'Ulduz'} — ${nextRewardAt} ulduza ${rewardName}`,
        `Каждый кофе — 1 ${wallet?.points_label || 'звезда'}; ${nextRewardAt} звёзд → ${rewardName}`,
        `Every coffee earns 1 ${wallet?.points_label || 'star'} — ${nextRewardAt} stars → ${rewardName}`));
    }
    if (rewardRemaining > 0) {
      rows.push(rewardText);
    } else {
      rows.push(tx(safeLang, `${rewardName} hazırdır — kassada göstər`, `«${rewardName}» готов — покажите на кассе`, `${rewardName} is ready — show it at the counter`));
    }
    // Doğum günü vədi yalnız tenant ayarı açıq olanda verilir.
    if (wallet?.birthday_enabled) {
      rows.push(tx(safeLang,
        'Doğum günündə bonus səni gözləyir 🎂',
        'В день рождения тебя ждёт бонус 🎂',
        'A birthday bonus is waiting for you 🎂'));
    }
    if (campaignsCount > 0) {
      rows.push(tx(safeLang, 'Aktiv kampaniyalara bax — endirimlər var 🎯', 'Посмотри активные кампании — есть скидки 🎯', 'Check the active offers — discounts inside 🎯'));
    }
    return rows;
  }, [programMode, wallet?.cashback_percent, wallet?.points_label, wallet?.birthday_enabled, nextRewardAt, rewardName, rewardRemaining, rewardText, campaignsCount, safeLang]);
  // Gün ərzində sabit qalsın deyə indeks tarixə bağlıdır (əvvəlki davranış).
  const surpriseMessage = surpriseMessages[new Date().getDate() % surpriseMessages.length];
  const reorderAll = async () => {
    for (const it of (recentItems || []).slice(0, 6)) {
      onReorderItem(it);
    }
    await nativeHapticImpact(ImpactStyle.Medium);
  };

  // Starbucks-style activated rewards: prefer the all-status claim history from
  // the backend; fall back to pending claims (older API responses).
  const claimList = (Array.isArray(claims) && claims.length > 0) ? claims : pendingClaims;
  const activeClaims = claimList.filter((c: any) => c.status === 'PENDING' || !c.status);
  const usedClaims = claimList.filter((c: any) => c.status === 'REDEEMED');

  const formatClaimDate = (iso?: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(safeLang === 'az' ? 'az-AZ' : safeLang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  };

  const claimStatusMeta = (status: string) => {
    if (status === 'PENDING') {
      return { label: tx(safeLang, 'Aktiv', 'Активен', 'Active'), dot: 'bg-emerald-500', chip: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' };
    }
    if (status === 'REDEEMED') {
      return { label: tx(safeLang, 'İstifadə olundu', 'Использовано', 'Used'), dot: 'bg-white/30', chip: isLight ? 'bg-black/5 border-black/10 text-slate-400' : 'bg-white/5 border-white/10 text-white/40' };
    }
    return { label: status, dot: 'bg-white/30', chip: isLight ? 'bg-black/5 border-black/10 text-slate-400' : 'bg-white/5 border-white/10 text-white/40' };
  };

  const formatCardIdFn = (id: string) => {
    const clean = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) return '•••• •••• •••• ••••';
    const chunks: string[] = [];
    for (let i = 0; i < clean.length; i += 4) chunks.push(clean.slice(i, i + 4));
    return chunks.join(' ');
  };

  const handleClaimWithConfetti = (e: React.MouseEvent<HTMLButtonElement>, rewardId?: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    spawnConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    claimReward(rewardId);
  };

  /* ── P1.3 — hədiyyə kataloqu nərdivanı ──────────────────────────────────
     Sətirlər `wallet.rewards`-dandır (backend `_reward_catalog_payload`,
     lokal rejim `buildRewardWalletRows`). Kataloq boş olsa da massiv boş
     gəlmir: server köhnə tək hədiyyəni sintetik sətir kimi verir. Ona görə
     burada uydurma pillə YOXDUR — P0.6-da silinən nərdivan indi real
     kataloqun üstündə qayıdır.
     Deaktiv sətirlər payload-a düşmür, yəni filtrə ehtiyac yoxdur. */
  const catalogRows = (Array.isArray(rewards) ? rewards : [])
    .map((row: any) => {
      const i18nTitle = row?.title_i18n && typeof row.title_i18n === 'object' ? row.title_i18n : null;
      const i18nDesc = row?.description_i18n && typeof row.description_i18n === 'object' ? row.description_i18n : null;
      const cost = Math.max(1, Math.trunc(Number(row?.points_cost ?? row?.threshold) || 1));
      const rawRemaining = row?.stock_remaining;
      return {
        id: String(row?.id || ''),
        // Server dilə uyğun `title`-ı özü seçir; `*_i18n` varsa tətbiq öz dilini
        // götürür (offline keş başqa dildə yazılmış ola bilər).
        title: String((i18nTitle?.[safeLang] || i18nTitle?.az || row?.title || '') || '').trim(),
        description: String((i18nDesc?.[safeLang] || i18nDesc?.az || row?.description || '') || '').trim(),
        cost,
        menuItemName: String(row?.menu_item_name || '').trim(),
        // `null` = limitsiz; 0 = stok bitdi. `?? null` qəsdən: 0 dəyəri itməsin.
        stockRemaining: rawRemaining === null || rawRemaining === undefined ? null : Math.max(0, Math.trunc(Number(rawRemaining) || 0)),
        availableCount: Math.max(0, Math.trunc(Number(row?.available_count) || 0)),
        locked: Boolean(row?.locked ?? (Number(row?.available_count) || 0) <= 0),
      };
    })
    .filter((row) => row.id || row.title)
    .sort((a, b) => a.cost - b.cost);
  // Nərdivan uzun olanda ilk 5 sətir göstərilir, qalanı yerində açılır.
  // ⚠️ `setActiveTab('stars')` kimi bir yer YOXDUR (`CustomerTab` = home | order |
  // offers | feedback | barista | falci | ai | profile), ona görə "daha çox"
  // düyməsi naviqasiya etmir, sadəcə siyahını genişləndirir.
  const LADDER_VISIBLE = 5;
  const [rewardsExpanded, setRewardsExpanded] = React.useState(false);
  const ladderRows = rewardsExpanded ? catalogRows : catalogRows.slice(0, LADDER_VISIBLE);
  const ladderHiddenCount = Math.max(0, catalogRows.length - ladderRows.length);
  // "Tətbiq et" düyməsi ən ucuz AÇIQ sətri tələb edir — `available_rewards`
  // rəqəmi də elə həmin məntiqin (max over rows) nəticəsidir.
  const claimableRow = catalogRows.find((row) => !row.locked) || null;
  // Hələ çatılmayan ən yaxın sətir (kompakt görünüş üçün): hamısı açıqsa ən ucuzu.
  const nextCatalogRow = catalogRows.find((row) => row.locked) || catalogRows[0] || null;
  const catalogHasMultipleRows = catalogRows.length > 1;

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.88) translateY(24px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes sparkle {
          0%   { transform: translate(0,0) scale(1) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--dx),var(--dy)) scale(0) rotate(180deg); opacity: 0; }
        }
        @keyframes cardShimmer {
          0%   { background-position: -300% 0; }
          100% { background-position: 300% 0; }
        }
        .animate-modalFadeIn { animation: modalFadeIn 0.25s ease forwards; }
        .animate-scaleIn { animation: scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .animate-sparkle { animation: sparkle 0.8s cubic-bezier(0.25,1,0.5,1) forwards; }
        .card-sweep::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.16) 50%, transparent 70%);
          background-size: 300% 100%;
          animation: cardShimmer 4s ease-in-out infinite;
          border-radius: inherit;
          pointer-events: none;
        }
        .wallet-balance-glow {
          text-shadow: 0 0 24px rgba(244,140,36,0.35);
        }
        .progress-shimmer {
          background: linear-gradient(90deg, #F48C24, #ffb366, #F48C24);
          background-size: 200% 100%;
          animation: gradientShift 2s linear infinite;
        }
      `}</style>

      {/* Top Header Row — Apple SF-style large title */}
      <div className="flex items-center justify-between px-1 mb-5">
        <div className="flex items-center gap-3">
          {brandLogoUrl ? (
            <img src={brandLogoUrl} alt={brandName} width={38} height={38}
              className="h-[38px] w-[38px] rounded-[10px] object-cover shadow-sm" />
          ) : (
            <div className={`h-[38px] w-[38px] rounded-[10px] flex items-center justify-center text-base shadow-sm ${isLight ? 'bg-[#FF8B26]/10' : 'bg-white/10'}`}>☕</div>
          )}
          <div>
            <p className={`text-[11px] font-medium ${isLight ? 'text-[#8E8E93]' : 'text-white/40'}`}>
              {coffeeGreeting(safeLang)}
            </p>
            <h2 className={`text-[15px] font-bold leading-tight tracking-[-0.3px] ${textPrimary}`}>
              {customer.name || brandName || 'IronWaves'}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button"
            onClick={(e) => openWalletPass(e, get_customer_wallet_pass_url_fn(sessionCreds.cardId, sessionCreds.token, safeLang))}
            aria-label={tx(safeLang, 'Wallet-ə əlavə et', 'Добавить в Wallet', 'Add to Wallet')}
            className={`h-9 w-9 rounded-full flex items-center justify-center text-[#FF8B26] active:scale-95 transition-all ${
              isLight ? 'bg-[#FF8B26]/10' : 'bg-[#FF8B26]/10 border border-[#FF8B26]/30'
            }`}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h15a2 2 0 012 2v6a2 2 0 01-2 2H3V7zm0 0l2-3h12l2 3M16 13h2" />
            </svg>
          </button>
          <button type="button" onClick={() => setActiveTab('profile')} aria-label={tx(safeLang, 'Profil', 'Профиль', 'Profile')}
            className="relative h-9 w-9 rounded-full flex items-center justify-center font-bold text-[13px] active:scale-95 transition-all text-white shadow-sm bg-gradient-to-tr from-amber-500 to-[#FF8B26]">
            {customer.name ? customer.name.charAt(0).toUpperCase() : 'M'}
            {notifications.filter((n: any) => !n.is_read).length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-red-500 border-2 border-white animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* ── Apple Wallet Flip Card ─────────────────────────────── */}
      <div
        onClick={async (e) => {
          spawnConfetti(e.clientX, e.clientY);
          playTickSound();
          setCardFlipped(!cardFlipped);
          await nativeHapticImpact(ImpactStyle.Medium);
        }}
        className="w-full h-[220px] select-none cursor-pointer stagger-fade-in"
        style={{ perspective: '1200px' }}
      >
        <div
          className={`relative w-full h-full duration-500 preserve-3d transition-transform ${
            cardFlipped ? 'rotate-y-180' : ''
          }`}
        >
          {/* CARD FRONT — Apple Wallet Espresso */}
          <div
            className="absolute inset-0 backface-hidden flex flex-col justify-between overflow-hidden"
            style={{
              borderRadius: '24px',
              padding: '22px 24px',
              background: isLight
                ? 'linear-gradient(145deg, #2C1810 0%, #5C2E0A 52%, #8B4513 100%)'
                : 'linear-gradient(145deg, #1A0E08 0%, #3D1F05 50%, #6B3310 100%)',
              boxShadow: isLight
                ? '0 14px 36px rgba(44,24,16,0.35), 0 2px 8px rgba(0,0,0,0.14)'
                : '0 14px 36px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)',
              transform: 'rotateY(0deg)',
              WebkitTransform: 'rotateY(0deg)',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            {/* Glossy top edge & shimmer */}
            <div
              className="absolute inset-x-0 top-0 h-24 pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, transparent 100%)',
                borderRadius: '24px 24px 0 0',
              }}
            />
            <div className="absolute inset-0 pointer-events-none card-sweep" style={{ borderRadius: 24 }} />

            {/* Top row: Brand + Tier Badge + EMV chip */}
            <div className="flex items-center justify-between relative z-10">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white/80">
                  {brandName}
                </span>
                <span
                  className="rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-black/30 border border-amber-400/25"
                >
                  ⭐ {tierLabel}
                </span>
              </div>
              {/* EMV chip */}
              <div
                className="relative w-9 h-6 rounded-md overflow-hidden flex flex-col justify-between p-0.5 opacity-90 shadow-sm"
                style={{ background: 'linear-gradient(135deg, #E5C058 0%, #F8E287 40%, #B8860B 100%)' }}
              >
                <div className="h-px bg-[#704214]/40 mt-1" />
                <div className="h-px bg-[#704214]/40" />
                <div className="h-px bg-[#704214]/40 mb-1" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#704214]/30" />
              </div>
            </div>

            {/* Center: Big Star / Point Balance */}
            <div className="my-auto relative z-10">
              <p className="text-[10px] font-medium text-white/60 uppercase tracking-widest">
                {wallet.points_label || tx(safeLang, 'Ulduz Balansı', 'Баланс звёзд', 'Star Balance')}
              </p>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-[34px] font-black text-white tracking-tight leading-none">
                  <AnimatedCounter
                    value={Number(wallet.stars_balance ?? 0)}
                    decimals={programMode === 'cashback' ? 2 : 0}
                    suffix={balanceSuffix}
                  />
                </span>
                {programMode !== 'cashback' && (
                  <span className="text-amber-400 text-lg font-black">★</span>
                )}
              </div>

              {/* Progress bar to next reward */}
              <div className="mt-2.5 h-1.5 bg-white/15 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-[#FF8B26] transition-all duration-700"
                  style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] font-medium text-white/70">
                {rewardRemaining > 0
                  ? tx(safeLang, `${rewardRemaining} ulduz qaldı → ${rewardName}`, `${rewardRemaining} звезд до «${rewardName}»`, `${rewardRemaining} stars to ${rewardName}`)
                  : tx(safeLang, `${rewardName} hazırdır 🎉`, `«${rewardName}» готов 🎉`, `${rewardName} ready 🎉`)}
              </p>
            </div>

            {/* Bottom: Card ID + Tap to Flip hint */}
            <div className="flex items-center justify-between text-white/60 relative z-10 pt-1 border-t border-white/10">
              <span className="font-mono text-[10px] tracking-[0.16em] text-white/50">
                {formatCardIdFn(customer.card_id)}
              </span>
              <div className="flex items-center gap-1 text-[9px] font-bold text-white/80 bg-white/10 rounded-full px-2.5 py-0.5">
                <span>🔄</span>
                <span>{tx(safeLang, 'Skan üçün toxun', 'Коснись для QR', 'Tap to scan')}</span>
              </div>
            </div>
          </div>

          {/* CARD BACK — Apple QR Reveal */}
          <div
            className="absolute inset-0 backface-hidden flex flex-col items-center justify-center text-white"
            style={{
              borderRadius: '24px',
              padding: '20px',
              background: isLight ? '#FFFFFF' : '#1C1C1E',
              boxShadow: isLight
                ? '0 14px 36px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)'
                : '0 14px 36px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.3)',
              transform: 'rotateY(180deg)',
              WebkitTransform: 'rotateY(180deg)',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            {cardQr ? (
              <div className="p-2.5 bg-white rounded-2xl shadow-sm border border-slate-200">
                <img src={cardQr} alt="QR Code" className="h-28 w-28 object-contain" />
              </div>
            ) : (
              <div className="text-slate-400 text-xs">QR Code</div>
            )}
            <p
              className={`mt-3 text-[10px] font-extrabold uppercase tracking-[0.2em] ${
                isLight ? 'text-[#FF8B26]' : 'text-amber-400'
              }`}
            >
              {tx(safeLang, 'KASSAYA TƏQDİM EDİN', 'ПОКАЖИТЕ НА КАССЕ', 'SHOW AT CHECKOUT')}
            </p>
            <p
              className={`mt-0.5 font-mono text-[10px] tracking-wider ${
                isLight ? 'text-slate-500' : 'text-white/50'
              }`}
            >
              {formatCardIdFn(customer.card_id)}
            </p>
          </div>
        </div>
      </div>

      {/* ── 2 Stat Widgets (Apple Style) ────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 stagger-fade-in stagger-1">
        {/* Left Widget: Rewards Available / Claim */}
        <div
          className={`rounded-[20px] p-4 flex flex-col justify-between border ${
            isLight
              ? 'bg-white border-black/[0.05] shadow-[0_2px_10px_rgba(0,0,0,0.04)]'
              : 'bg-[#1C1C1E] border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.3)]'
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${subText}`}>
                {tx(safeLang, 'Hədiyyələr', 'Награды', 'Rewards')}
              </span>
              <Gift size={15} className="text-[#FF8B26]" />
            </div>
            <div className={`mt-2 text-2xl font-black ${headerText}`}>
              {wallet.available_rewards ?? 0}
            </div>
            <p className={`text-[10px] font-medium mt-0.5 ${textMuted}`}>
              {rewardDescription}
            </p>
          </div>
          {claimableRow && (
            <button
              type="button"
              disabled={claiming}
              onClick={(e) => handleClaimWithConfetti(e, claimableRow.id)}
              className="mt-3 w-full rounded-xl py-2 text-[11px] font-bold text-white bg-[#FF8B26] active:scale-95 transition-all shadow-sm disabled:opacity-50"
            >
              {claiming ? '...' : tx(safeLang, 'Tətbiq et', 'Забрать', 'Claim')} 🎉
            </button>
          )}
        </div>

        {/* Right Widget: Level / Cashback */}
        <div
          className={`rounded-[20px] p-4 flex flex-col justify-between border ${
            isLight
              ? 'bg-white border-black/[0.05] shadow-[0_2px_10px_rgba(0,0,0,0.04)]'
              : 'bg-[#1C1C1E] border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.3)]'
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${subText}`}>
                {programMode === 'cashback'
                  ? 'Cashback'
                  : tx(safeLang, 'Səviyyə', 'Уровень', 'Level')}
              </span>
              <span className="text-sm">⭐</span>
            </div>
            <div className={`mt-2 text-2xl font-black ${headerText}`}>
              {programMode === 'cashback'
                ? `${Number(wallet.cashback_percent || 0).toFixed(0)}%`
                : tierLabel}
            </div>
            <p className={`text-[10px] font-medium mt-0.5 ${textMuted}`}>
              {tier?.next_threshold
                ? tx(safeLang, `Hədəf: ${tier.next_threshold} ★`, `Цель: ${tier.next_threshold} ★`, `Goal: ${tier.next_threshold} ★`)
                : tx(safeLang, 'Maksimum status', 'Максимальный статус', 'Top tier status')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('order')}
            className={`mt-3 w-full rounded-xl py-2 text-[11px] font-bold active:scale-95 transition-all ${
              isLight
                ? 'bg-[#F5F5F7] text-slate-800 hover:bg-[#EBEBF0]'
                : 'bg-white/10 text-white hover:bg-white/15'
            }`}
          >
            {tx(safeLang, 'Sifariş et', 'Заказать', 'Order')} →
          </button>
        </div>
      </div>

      {/* ── 4 Quick Actions (iOS Style Grid) ────────────────────── */}
      <div className="grid grid-cols-4 gap-2.5 stagger-fade-in stagger-2">
        {[
          {
            icon: '☕',
            label: tx(safeLang, 'Sifariş', 'Заказ', 'Order'),
            action: () => setActiveTab('order'),
            bg: isLight ? 'bg-orange-50/80 text-[#FF8B26]' : 'bg-[#FF8B26]/15 text-[#FF8B26]',
          },
          {
            icon: '✨',
            label: 'Barista AI',
            action: () => setActiveTab('ai'),
            bg: isLight ? 'bg-amber-50/80 text-amber-600' : 'bg-amber-500/15 text-amber-400',
          },
          {
            icon: '🏷️',
            label: tx(safeLang, 'Təkliflər', 'Акции', 'Offers'),
            action: () => setActiveTab('offers'),
            bg: isLight ? 'bg-rose-50/80 text-rose-600' : 'bg-rose-500/15 text-rose-400',
          },
          {
            icon: '👤',
            label: tx(safeLang, 'Profil', 'Профиль', 'Profile'),
            action: () => setActiveTab('profile'),
            bg: isLight ? 'bg-blue-50/80 text-blue-600' : 'bg-blue-500/15 text-blue-400',
          },
        ].map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={async () => {
              await nativeHapticImpact(ImpactStyle.Light);
              item.action();
            }}
            className={`flex flex-col items-center justify-center p-3 rounded-[18px] border transition-all active:scale-95 ${
              isLight
                ? 'bg-white border-black/[0.04] shadow-[0_2px_8px_rgba(0,0,0,0.03)]'
                : 'bg-[#1C1C1E] border-white/8 shadow-sm'
            }`}
          >
            <div className={`h-11 w-11 rounded-[14px] flex items-center justify-center text-xl mb-1.5 ${item.bg}`}>
              {item.icon}
            </div>
            <span className={`text-[11px] font-bold tracking-tight text-center leading-tight ${headerText}`}>
              {item.label}
            </span>
          </button>
        ))}
      </div>

      {/* ── Search & Filter Bar (Apple Rounded Field) ───────────── */}
      <div className="flex gap-2.5 stagger-fade-in stagger-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setActiveTab('order');
              }
            }}
            placeholder={tx(safeLang, 'Qəhvə, çay, desert axtarın...', 'Поиск по меню...', 'Search coffee, tea, dessert...')}
            className={`w-full rounded-[14px] px-10 py-3 text-[13px] transition duration-200 focus:outline-none ${inputSearch}`}
            onClick={() => setActiveTab('order')}
            aria-label={tx(safeLang, 'Menyuda axtarış', 'Поиск в меню', 'Search the menu')}
          />
          <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isLight ? 'text-[#8E8E93]' : 'text-white/40'}`}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('order')}
          className="h-[46px] w-[46px] rounded-[14px] bg-[#FF8B26] flex items-center justify-center text-white active:scale-95 transition-all shadow-sm"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </button>
      </div>

      {/* ── Active Order Alert Pill (if present) ─────────────────── */}
      {Array.isArray(activeOrders) && activeOrders.length > 0 && (
        <div className="stagger-fade-in">
          <button
            type="button"
            onClick={() => setActiveTab('order')}
            className="w-full rounded-[20px] border border-[#FF8B26]/30 bg-[#FF8B26]/[0.08] p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-all"
          >
            <div className="h-10 w-10 rounded-full bg-[#FF8B26] flex items-center justify-center text-white shrink-0 shadow-sm">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-[#FF8B26]">
                {tx(safeLang, 'Sifariş hazırlanır', 'Заказ готовится', 'Order in progress')}
              </p>
              <p className={`text-[11px] truncate ${subText}`}>
                {activeOrders[0]?.item_names || activeOrders[0]?.title || tx(safeLang, 'Kasada götürün', 'Заберите у кассы', 'Pick up at counter')}
              </p>
            </div>
            <span className="text-[11px] font-black text-[#FF8B26] shrink-0">
              {activeOrders[0]?.eta || '2 dəq'}
            </span>
          </button>
        </div>
      )}

      {/* ── Birthday Alert (if soon) ────────────────────────────── */}
      {birthdaySoon && (
        <div>
          <div
            className="w-full rounded-[20px] p-4 flex items-center gap-3 text-white shadow-md"
            style={{ background: 'linear-gradient(135deg, #FF8B26 0%, #F48C24 100%)' }}
          >
            <span className="text-2xl">🎂</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-white">
                {tx(safeLang, 'Doğum günün yaxınlaşır!', 'День рождения скоро!', "Your birthday is near!")}
              </p>
              <p className="text-[11px] text-white/85">
                {tx(safeLang, 'Sürpriz: pulsuz içki hədiyyə edirik 🎉', 'Сюрприз: дарим бесплатный напиток 🎉', 'Surprise: a free drink on us 🎉')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Geofence Alert (if nearby) ──────────────────────────── */}
      {geofenceAlert && (
        <div
          className="flex items-center justify-between gap-3 rounded-2xl p-4 animate-pulse border border-yellow-500/30 bg-yellow-500/10"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">☕</span>
            <div>
              <h4 className="text-[13px] font-bold text-yellow-600 dark:text-yellow-400">
                {tx(safeLang, 'Yaxınlıqdasan!', 'Вы рядом!', "You're nearby!")}
              </h4>
              <p className={`mt-0.5 text-[11px] ${subText}`}>
                {tx(safeLang, 'İçəri keç, ulduzlarını qəhvəyə çevir! 🌟', 'Заходи, преврати свои звезды в кофе! 🌟', 'Come in and turn your stars into coffee! 🌟')}
              </p>
            </div>
          </div>
          <button
            onClick={() => setGeofenceAlert(false)}
            className={`text-[14px] font-bold px-2 py-1 ${subText}`}
          >
            ✕
          </button>
        </div>
      )}

      {/* For You — real, data-driven */}
      {recentItems.length > 0 && (
        <section className={`rounded-[24px] p-6 border shadow-sm space-y-4 stagger-fade-in stagger-5 ${isLight ? 'cust-glass-light' : 'cust-glass'}`}>
          <div className="flex items-center gap-2.5">
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center border ${isLight ? 'bg-black/3 border-black/5' : 'bg-white/5 border-white/5'}`}>
              <Sparkles className="text-[#F48C24]" size={16} />
            </div>
            <div>
              <p className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-white/90'}`}>
                {tx(safeLang, 'Sizin üçün', 'Для вас', 'Picked for You')}
              </p>
              <p className={`text-[10px] font-medium mt-0.5 ${textMuted}`}>
                {tx(safeLang, 'Son sifarişlərinizə əsasən', 'На основе ваших заказов', 'Based on your recent orders')}
              </p>
            </div>
            <button type="button" onClick={() => void reorderAll()}
              className="ml-auto shrink-0 rounded-full bg-[#FF8B26] px-3 py-1.5 text-[11px] font-bold text-white active:scale-95 transition-all">
              {tx(safeLang, 'Hamısını təkrarla', 'Повторить всё', 'Reorder all')}
            </button>
          </div>
          <div className="space-y-2.5">
            {recentItems.map((item: any, idx: number) => (
              <div key={idx} onClick={async () => { onReorderItem(item); await nativeHapticImpact(ImpactStyle.Light); }}
                role="button" tabIndex={0} aria-label={`${item.name} ${tx(safeLang, 'yenidən sifariş et', 'заказать снова', 'reorder')}`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReorderItem(item); } }}
                className={`flex items-center justify-between gap-3 rounded-2xl p-3.5 border active:scale-[0.98] transition-all cursor-pointer ${isLight ? 'bg-white/70 border-black/6 hover:shadow-md' : 'bg-white/6 border-white/6 hover:border-white/12 hover:bg-white/10'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-lg border ${isLight ? 'bg-white border-black/6 shadow-sm' : 'bg-white/10 border-white/6'}`}>
                    {(() => { switch(item.category) { case 'coffee': return '☕'; case 'tea': return '🍵'; case 'sweet': return '🍰'; case 'food': return '🥪'; default: return '🥤'; } })()}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-bold truncate ${headerText}`}>{item.name}</p>
                    <p className={`text-[10px] font-medium ${textMuted}`}>{item.price ? `${Number(item.price).toFixed(2)} ₼` : ''} · {item.count} {tx(safeLang, 'dəfə', 'раз', 'times')}</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-[#F48C24] bg-[#F48C24]/10 px-3 py-1 rounded-full border border-[#F48C24]/20 flex-shrink-0">
                  + {tx(safeLang, 'Sifariş', 'Заказать', 'Order')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Your Favorites */}
      {favoriteItems.length > 0 && (
        <section className={`rounded-[24px] p-6 border shadow-sm space-y-4 ${isLight ? 'cust-glass-light' : 'cust-glass'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-[#F48C24]" />
            <p className={`text-xs font-bold uppercase tracking-wider ${subText}`}>{tx(safeLang, 'Sizin Sevimliləriniz', 'Ваше любимое', 'Your Favorites')}</p>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {favoriteItems.map((item: any) => (
              <div key={item.name} onClick={async () => { onReorderItem(item.lastItem || item); await nativeHapticImpact(ImpactStyle.Light); }}
                role="button" tabIndex={0} aria-label={`${item.name} ${tx(safeLang, 'yenidən sifariş et', 'заказать снова', 'reorder')}`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReorderItem(item.lastItem || item); } }}
                className={`flex items-center gap-3 shrink-0 rounded-2xl p-3 border active:scale-95 transition-all cursor-pointer ${isLight ? 'bg-white/70 border-black/6 hover:shadow-md shadow-sm' : 'bg-white/6 border-white/6 hover:border-white/12 hover:bg-white/10'}`}
                style={{ minWidth: '160px' }}>
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-lg border ${isLight ? 'bg-white border-black/6 shadow-sm' : 'bg-white/10 border-white/6'}`}>
                  {(() => { switch(item.category) { case 'coffee': return '☕'; case 'tea': return '🍵'; case 'sweet': return '🍰'; case 'food': return '🥪'; default: return '🥤'; } })()}
                </div>
                <div className="overflow-hidden">
                  <p className={`text-xs font-bold truncate w-24 ${headerText}`}>{item.name}</p>
                  <p className={`text-[10px] mt-0.5 font-medium ${textMuted}`}>{item.count} {tx(safeLang, 'dəfə', 'раз', 'times')}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My Rewards — Starbucks-style activated rewards with status */}
      <section className={`rounded-[28px] p-5 border shadow-sm ${isLight ? 'cust-glass-light' : 'cust-glass'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift size={14} className="text-[#F48C24]" />
            <p className={`text-xs font-bold uppercase tracking-wider ${subText}`}>{tx(safeLang, 'Mükafatlarım', 'Мои награды', 'My Rewards')}</p>
          </div>
          <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#F48C24]/10 text-[#F48C24] border border-[#F48C24]/20">{activeClaims.length}</span>
        </div>

        {claimList.length === 0 ? (
          <div className={`mt-4 w-full rounded-2xl py-6 text-center text-xs border border-dashed ${isLight ? 'border-black/10 bg-black/3' : 'border-white/10 bg-white/4'} ${textMuted}`}>
            {/* P1.3 — köhnə mətn "Ulduzlar bölməsindən claim edin" deyirdi, amma
                belə bir tab yoxdur (`CustomerTab`-da `stars` yoxdur). Tələb
                düymələri möhür kartındaki hədiyyə nərdivanındadır. */}
            {tx(safeLang,
              'Hələ hədiyyə almamısınız — möhür kartındaki hədiyyə siyahısından seçin',
              'Вы ещё не забрали награды — выберите из списка на штамп-карте',
              'No rewards claimed yet — pick one from the reward list on your stamp card')}
          </div>
        ) : (
          <>
            {/* Active tickets */}
            {activeClaims.length > 0 && (
              <div className="mt-4 flex gap-3.5 overflow-x-auto pb-1.5">
                {activeClaims.map((row: any) => {
                  const meta = claimStatusMeta(row.status);
                  return (
                    <div key={row.id}
                      className="relative min-w-[175px] shrink-0 rounded-2xl p-4 overflow-hidden flex flex-col justify-between shimmer-card"
                      style={{
                        background: 'linear-gradient(135deg, rgba(244,140,36,0.12) 0%, rgba(244,140,36,0.06) 100%)',
                        border: '1px solid rgba(244,140,36,0.32)',
                        boxShadow: '0 4px 16px rgba(244,140,36,0.10), inset 0 1px 0 rgba(255,255,255,0.05)',
                      }}>
                      {/* Ticket perforations */}
                      <div className={`absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-r border-[#F48C24]/20 ${isLight ? 'bg-slate-100' : 'bg-[#0E0C0B]'}`} />
                      <div className={`absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-l border-[#F48C24]/20 ${isLight ? 'bg-slate-100' : 'bg-[#0E0C0B]'}`} />
                      {/* Dashed center line */}
                      <div className="absolute top-1/2 left-4 right-4 h-px border-t border-dashed border-[#F48C24]/20 pointer-events-none" />
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[8px] font-black uppercase tracking-[0.25em] text-[#F48C24]">{tx(safeLang, 'Kassaya Təqdim Et', 'На кассе', 'Present at POS')}</p>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wider border ${meta.chip}`}>
                            <span className={`h-1 w-1 rounded-full ${meta.dot} animate-pulse`} />
                            {meta.label}
                          </span>
                        </div>
                        <p className={`mt-1.5 text-2xl font-black tracking-tight font-mono ${isLight ? 'text-slate-800' : 'text-white'}`}>{row.claim_code}</p>
                      </div>
                      <div className={`mt-3 pt-2 border-t text-[10px] truncate font-semibold ${isLight ? 'border-black/5 text-slate-500' : 'border-white/10 text-white/60'}`}>{row.reward_name}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Used rewards — muted history */}
            {usedClaims.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className={`text-[9px] font-bold uppercase tracking-wider ${textMuted}`}>
                  {tx(safeLang, 'İstifadə olunmuş', 'Использованные', 'Redeemed')}
                </p>
                {usedClaims.map((row: any) => {
                  const meta = claimStatusMeta(row.status);
                  return (
                    <div key={row.id}
                      className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 opacity-70 ${isLight ? 'bg-black/2 border-black/5' : 'bg-white/3 border-white/6'}`}>
                      <div className="min-w-0 flex items-center gap-2.5">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${meta.chip}`}>✓</span>
                        <div className="min-w-0">
                          <p className={`text-[11px] font-bold truncate ${isLight ? 'text-slate-700' : 'text-white/70'}`}>{row.reward_name}</p>
                          <p className={`text-[9px] font-mono mt-0.5 truncate ${textMuted}`}>{row.claim_code}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end">
                        <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-400' : 'text-white/40'}`}>
                          <span className={`h-1 w-1 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                        {formatClaimDate(row.redeemed_at || row.created_at) && (
                          <span className={`mt-0.5 text-[9px] font-mono ${textMuted}`}>{formatClaimDate(row.redeemed_at || row.created_at)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
