import React, { useEffect, useState } from 'react';
import { MapPin, Palette, Plus, Sparkles, Trash2 , Clock, Calendar, Star, Eye, UserCheck, Home, Coffee, Gift, MessageSquare, UserRound, Bell, Send } from 'lucide-react';
import QRCode from 'qrcode';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { get_settings_live, update_customer_app_settings_live, get_business_profile_live, list_branches_live, create_branch_live, update_branch_live, delete_branch_live , list_campaigns_admin_live, create_campaign_live, update_campaign_live, delete_campaign_live, cloneDefaultCustomerAppTiers, normCustomerAppTiers, update_push_settings_live} from '../../api/settings';
import type { PushSettingsPatch } from '../../api/settings';
// P1.4e — push bloku. Panel **yalnız** bu cütlərdən keçir: göndərmə məntiqi
// (konfiqurasiya nərdivanı, seqment, gündəlik hədd) `push_admin.ts`-dədir və
// backend `operations.py::/push/*` ilə eyni sıradadır. Burada ikinci qərar
// mərkəzi qurmuruq — panel yalnız cavabı göstərir.
import {
  PUSH_HISTORY_LIMIT,
  get_push_history_live,
  get_push_status_live,
  preview_push_audience_live,
  send_push_broadcast_live,
  send_push_test_live,
} from '../../api/push_admin';
import type {
  PushAudienceInput,
  PushHistoryItem,
  PushSendResult,
  PushStatus,
} from '../../api/push_admin';
import { prepareImageDataUrl } from '../../lib/image_upload';
// P1.1 — panelin "effektiv qayda" xülasəsi POS-un işlətdiyi mühərrikin EYNİSİ
// ilə hesablanır (`src/lib/loyalty.ts` = `loyalty_accrual.py` güzgüsü). Burada
// ayrı düstur yazsaydıq panel bir rəqəm göstərib kassa başqasını yazardı — yəni
// P0.4-də təmizlədiyimiz "saxta vəd" problemi geri qayıdardı.
import {
  computePointsEarned,
  weekdayIso,
  MAX_LOYALTY_TIERS,
  FALLBACK_TIER_COLOR,
  // P1.3 — hədiyyə kataloqunun normalizeri `settings.ts`-də DEYİL, burada yaşayır:
  // müştəri tətbiqi (`api/crm.ts`) də onu çağırır və tək fayllı customer bundle
  // `settings.ts` → `db_sim` + `client` + finance zəncirini içinə çəkməməlidir.
  MAX_LOYALTY_REWARDS,
  MAX_REWARD_POINTS_COST,
  MAX_REWARD_STOCK_LIMIT,
  normCustomerAppRewards,
  normRewardId,
} from '../../lib/loyalty';
// Hədiyyə sətri konkret menyu məhsuluna bağlana bilər — seçim siyahısı üçün.
// `get_menu_items_live` hər iki rejimdə işləyir (backend yoxdursa lokal DB).
import { get_menu_items_live } from '../../api/menu';
import type { CustomerAppReward, CustomerAppTier } from '../../types/pos';

const CRM_MEMBER_TYPES = [
  { value: 'golden', label: 'Golden (5%)', discount: 5 },
  { value: 'platinum', label: 'Platinum (10%)', discount: 10 },
  { value: 'elite', label: 'Elite (20%)', discount: 20 },
  { value: 'thermos', label: 'Thermos (20%)', discount: 20 },
  { value: 'ikram', label: 'Ikram (100%)', discount: 100 },
  { value: 'telebe', label: 'Tələbə (15%)', discount: 15 },
];

/* ── P1.4e — push blokunun kiçik köməkçiləri ──────────────────────────────
   Seqment "imzası": ön baxış cavabının HANSI seqment üçün alındığını yadda
   saxlayır. P0.4 qaydası ("panel 412 alıcı yazıb 30 nəfərə göndərməsin") yalnız
   göndərmə anında keçərlidir, ona görə admin seqmenti dəyişəndə köhnə rəqəm
   ekranda qalmamalıdır — imza uyğun gəlmirsə say "hesablanır" kimi göstərilir. */
const pushSpecKey = (segment: string, value: string, days: string, minStars: string) =>
  `${segment}|${value.trim()}|${days.trim()}|${minStars.trim()}`;

/** `push_deliveries.status` → rəng. `skipped` **uğur deyil** (P0.7). */
const PUSH_STATUS_STYLE: Record<string, string> = {
  sent: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  partial: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  skipped: 'border-slate-600 bg-slate-800/60 text-slate-300',
  failed: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
};

const PUSH_KIND_LABELS: Record<string, [string, string, string]> = {
  event: ['Hadisə', 'Событие', 'Event'],
  test: ['Test', 'Тест', 'Test'],
  broadcast: ['Kütləvi', 'Массовая', 'Broadcast'],
};

// P1.1 — P0.4-də bu fayldaki `NotAppliedBadge` dörd sahəni "tətbiqdə hələ
// işləmir" kimi nişanlayırdı: `earn_rate_per_azn`, `min_purchase_for_earn`,
// `first_purchase_bonus`, `double_points_days`. Artıq hər dördü həm backend
// (`app/services/loyalty_accrual.py` → `pos.py::create_sale`), həm lokal rejim
// (`src/lib/loyalty.ts` → `src/api/pos.ts::calculate_total`) tərəfindən
// OXUNUR, ona görə nişan həmin sahələrdən silindi.
//
// P1.2c — nişan geri qayıtdı, amma yalnız BİR sahə üçün: tier `discount_percent`.
// O, `operations.py::_norm_customer_app_tiers`-də normalizə olunub saxlanılır,
// lakin `pos.py` satış endirimini oxuyarkən ona baxmır. Sahəni redaktordan
// çıxarmaq olmaz (PATCH merge üst-səviyyə açar granulyarlığındadır → hər save
// onu 0-a endirərdi), ona görə saxlanılır və dürüst nişanlanır.
function NotAppliedBadge({ lang }: { lang: string }) {
  return (
    <span
      className="ml-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200"
      title={tx(lang,
        'Dəyər saxlanılır, lakin kassa hesablamasında hələ işlədilmir.',
        'Значение сохраняется, но пока не используется при расчёте на кассе.',
        'The value is stored but not used in the checkout calculation yet.')}
    >
      {tx(lang, 'tətbiqdə hələ işləmir', 'пока не применяется', 'not applied yet')}
    </span>
  );
}

export default function CustomerAppPanel() {
  const { user, lang, notify } = useAppStore();
  const tenantId = user?.tenant_id || 'tenant_default';
  const colorPresets = ['#14b8a6', '#22d3ee', '#7c3aed', '#f97316', '#facc15', '#ef4444', '#111827', '#ec4899'];
  const [success, setSuccess] = useState('');
  const [joinQr, setJoinQr] = useState('');
  const [branches, setBranches] = useState<any[]>([]);
  const [branchForm, setBranchForm] = useState({
    name: '',
    address: '',
    phone: '',
    latitude: '',
    longitude: '',
    open_hour: '8',
    close_hour: '23',
    is_default: false,
  });
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaignForm, setCampaignForm] = useState({
    name: '', start_time: '10:00', end_time: '22:00',
    discount_percent: '10', days_of_week: [1,2,3,4,5] as number[],
    categories: 'ALL', is_active: true
  });
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  // P0.5 — logo `customer_app_settings`-in içində DEYİL; o `BusinessProfile.logo_url`
  // sütunudur və yalnız `PUT /business-profile` ilə yazılır. Həmin endpoint bütün
  // sahələri (VÖEN, ƏDV dərəcəsi, NKA nömrəsi, fiskal açar) payload-dan tam
  // əvəzləyir — buradan yalnız logo göndərmək fiskal məlumatı silərdi. Ona görə
  // burada logo yalnız OXUNUR və istifadəçi Biznes profilinə yönləndirilir.
  const [brandLogoUrl, setBrandLogoUrl] = useState('');

  // P1.2 — tier nərdivanı artıq bu paneldən REDAKTƏ olunur.
  //
  // ⚠️ PATCH merge **üst səviyyə açar** granulyarlığındadır: `tiers` göndərilirsə
  // bütün nərdivan əvəzlənir. Ona görə hər sətir altı sahəni də daşımalıdır,
  // yoxsa normalizerin defaultları saxlanmış dəyəri səssizcə silər — məsələn
  // `discount_percent` redaktorda görünmürsə, hər save onu 0-a endirər.
  //
  // Boş massiv "yüklənməyib" deməkdir: `save()` onda `tiers` göndərmir, çünki
  // `_norm_customer_app_tiers([])` defaultlara qaytarır — GET uğursuz olsa
  // tenant-ın nərdivanı bir save ilə itərdi.
  const [tiers, setTiers] = useState<CustomerAppTier[]>([]);

  // P1.3 — hədiyyə kataloqu.
  //
  // ⚠️ `tiers`-dən FƏRQLİ olaraq boş massiv qanuni vəziyyətdir: backend onu
  // "kataloq yoxdur" kimi oxuyur və köhnə tək hədiyyə (`reward_name` +
  // `reward_threshold`) bir sətir kimi işləyir. Ona görə "yükləndi?" yoxlaması
  // uzunluqla APARILA BİLMƏZ — ayrı flag saxlanılır, yoxsa GET uğursuz olanda
  // ilk save tenant-ın kataloqunu silərdi.
  const [rewards, setRewards] = useState<CustomerAppReward[]>([]);
  const [rewardsLoaded, setRewardsLoaded] = useState(false);
  // Məhsul seçicisi üçün menyu. Yüklənməsə seçici "istənilən məhsul"a düşür,
  // amma saxlanmış id itmir (aşağıda tanınmayan id üçün ayrı option verilir).
  const [menuItems, setMenuItems] = useState<Array<{ id: string; item_name: string; category: string }>>([]);

  /* ── P1.4e — push bloku ────────────────────────────────────────────────
     `pushStatus` bir sorğuda hər şeyi gətirir: konfiqurasiya diaqnozu, ayarlar,
     abunəçi sayları, seqment kataloqu, gündəlik hədd və mətn limitləri. Panel
     bunların heç birini özü hesablamır — yoxsa iki mənbə yaranar. */
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushStatusError, setPushStatusError] = useState('');
  const [pushSaving, setPushSaving] = useState(false);
  // ⚠️ `rest_api_key` HEÇ VAXT serverin cavabından doldurulmur: `/push/status`
  // açarı yalnız icazəsi olan rola açır, digərinə boş sətir verir. Formaya boş
  // sətir yazıb geri PATCH etsək açar silinərdi — ona görə sahə "yeni dəyər"
  // sahəsidir və boşdursa payload-a düşmür. Silmək üçün ayrı düymə var.
  const [pushForm, setPushForm] = useState({
    onesignal_app_id: '',
    rest_api_key: '',
    enabled: true,
    event_push_enabled: true,
    broadcast_enabled: false,
    broadcast_daily_limit: '3',
  });

  // Kütləvi bildiriş yazıcısı. `days` / `min_stars` SƏTİRDİR: boş buraxılanda
  // `null` göndərilir və normalizer seqmentin defaultunu qoyur (`new` → 30,
  // qalanı → 60). Rəqəmə çevirib 0 göndərsək "0 gün" heç kimi seçərdi.
  const [pushCompose, setPushCompose] = useState({
    title: '', body: '', url: '',
    segment: 'all', value: '', days: '', min_stars: '',
  });
  const [pushAudience, setPushAudience] = useState<{ key: string; data: PushStatus['subscribers'] } | null>(null);
  const [pushAudienceBusy, setPushAudienceBusy] = useState(false);
  const [pushAudienceError, setPushAudienceError] = useState('');
  const [pushSending, setPushSending] = useState(false);
  const [pushLastSend, setPushLastSend] = useState<PushSendResult | null>(null);
  const [pushTestCard, setPushTestCard] = useState('');
  const [pushTesting, setPushTesting] = useState(false);
  const [pushHistory, setPushHistory] = useState<PushHistoryItem[]>([]);
  const [pushHistoryKind, setPushHistoryKind] = useState('');

  const [form, setForm] = useState({

    enabled: true,
    registration_mode: 'full' as 'simple' | 'lightweight' | 'full',
    program_mode: 'points' as 'points' | 'cashback',
    layout_preset: 'rewards' as 'rewards' | 'cashback' | 'playful',
    consent_text: 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.',
    join_customer_type: 'golden',
    join_discount_percent: '5',
    app_name: 'Loyalty Club',
    hero_title: 'Xoş gəldiniz',
    hero_subtitle: 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
    hero_image_url: '',
    background_image_url: '',
    background_color: '#0b1220',
    points_label: 'Ulduz',
    reward_name: 'Reward',
    reward_threshold: '10',
    reward_description: '10 ulduza 1 pulsuz içki',
    reward_card_style: 'rounded' as 'rounded' | 'soft-square' | 'glass',
    cashback_percent: '5',
    primary_color: '#facc15',
    accent_color: '#22d3ee',
    show_qr_card: true,
    show_wallet: true,
    ai_barista_enabled: false,
    ai_falci_enabled: false,
    show_campaigns: true,
    show_history: true,
    show_notifications: true,
    campaigns_require_online: false,
    campaign_activation_minutes: '15',
    earn_rate_per_azn: '2',
    min_purchase_for_earn: '0',
    birthday_enabled: false,
    birthday_bonus_points: '10',
    first_purchase_bonus: '5',
    double_points_days: [] as number[],
    // P1.1 — qazanma keçidləri. Hər üçü qəsdən sönülü/köhnə davranışla başlayır,
    // çünki yuxarıdaki `earn_rate_per_azn: 2`, `first_purchase_bonus: 5` və tier
    // `multiplier: 1.5` mövcud tenant-ların blobunda ARTIQ saxlanılıb — qapısız
    // qoşulsa hər kafe xəbərsiz "1 AZN = 2 ulduz"-a keçərdi.
    earn_basis: 'per_drink' as 'per_drink' | 'per_azn',
    first_purchase_bonus_enabled: false,
    tier_multiplier_enabled: false,
  });

  useEffect(() => {
    void (async () => {
      try {
        const settings = await get_settings_live(tenantId);
        const c = settings.customer_app_settings || ({} as any);
        setForm((prev) => ({
          ...prev,
          enabled: Boolean(c.enabled ?? true),
          registration_mode: (c.registration_mode === 'simple' || c.registration_mode === 'lightweight') ? c.registration_mode : 'full',
          program_mode: c.program_mode === 'cashback' ? 'cashback' : 'points',
          layout_preset: c.layout_preset === 'cashback' || c.layout_preset === 'playful' ? c.layout_preset : 'rewards',
          consent_text: String(c.consent_text || prev.consent_text),
          join_customer_type: String(c.join_customer_type || prev.join_customer_type || 'golden'),
          join_discount_percent: String(c.join_discount_percent || prev.join_discount_percent || '5'),
          app_name: String(c.app_name || prev.app_name),
          hero_title: String(c.hero_title || prev.hero_title),
          hero_subtitle: String(c.hero_subtitle || prev.hero_subtitle),
          hero_image_url: String(c.hero_image_url || ''),
          background_image_url: String(c.background_image_url || ''),
          background_color: String(c.background_color || prev.background_color),
          points_label: String(c.points_label || prev.points_label),
          reward_name: String(c.reward_name || prev.reward_name),
          reward_threshold: String(c.reward_threshold || prev.reward_threshold),
          reward_description: String(c.reward_description || prev.reward_description),
          reward_card_style: c.reward_card_style === 'soft-square' || c.reward_card_style === 'glass' ? c.reward_card_style : 'rounded',
          cashback_percent: String(c.cashback_percent || prev.cashback_percent),
          primary_color: String(c.primary_color || prev.primary_color),
          accent_color: String(c.accent_color || prev.accent_color),
          show_qr_card: Boolean(c.show_qr_card ?? true),
          show_wallet: Boolean(c.show_wallet ?? true),
          ai_barista_enabled: Boolean(c.ai_barista_enabled),
          ai_falci_enabled: Boolean(c.ai_falci_enabled),
          show_campaigns: Boolean(c.show_campaigns ?? true),
          show_history: Boolean(c.show_history ?? true),
          show_notifications: Boolean(c.show_notifications ?? true),
          campaigns_require_online: Boolean(c.campaigns_require_online),
          campaign_activation_minutes: String(c.campaign_activation_minutes || 15),
          earn_rate_per_azn: String(c.earn_rate_per_azn ?? 2),
          min_purchase_for_earn: String(c.min_purchase_for_earn ?? 0),
          birthday_enabled: Boolean(c.birthday_enabled ?? false),
          // P0.2 — kanonik açar `birthday_bonus_points`; köhnə tenant-da yalnız
          // `birthday_bonus_stars` ola bilər, ona görə fallback saxlanılır.
          birthday_bonus_points: String(c.birthday_bonus_points ?? c.birthday_bonus_stars ?? 10),
          first_purchase_bonus: String(c.first_purchase_bonus ?? 5),
          double_points_days: Array.isArray(c.double_points_days) ? c.double_points_days : [],
          // P1.1 — tanınmayan dəyər köhnə davranışa düşür (accrual mühərriki də belə edir).
          earn_basis: c.earn_basis === 'per_azn' ? 'per_azn' : 'per_drink',
          first_purchase_bonus_enabled: Boolean(c.first_purchase_bonus_enabled ?? false),
          tier_multiplier_enabled: Boolean(c.tier_multiplier_enabled ?? false),
        }));
        // P1.2 — nərdivan yoxdursa serverin defaultunu göstəririk (uydurma yox:
        // `normCustomerAppTiers` boş girişdə backend-in verdiyi eyni siyahını qurur).
        setTiers(Array.isArray(c.tiers) && c.tiers.length ? normCustomerAppTiers(c.tiers) : cloneDefaultCustomerAppTiers());
        // P1.3 — kataloq boş ola bilər; `rewardsLoaded` yalnız GET uğurlu olanda
        // qalxır, çünki save `rewards`-ı məhz bu flag-a görə göndərir.
        setRewards(normCustomerAppRewards(c.rewards));
        setRewardsLoaded(true);
      } catch (e: any) {
        notify('error', e?.message || 'Customer app settings yüklənmədi');
      }
      // Logo ayrı mənbədəndir (Biznes profili) — uğursuzluq ayarların
      // yüklənməsini pozmasın deyə ayrı try/catch.
      try {
        const profile = await get_business_profile_live(tenantId);
        setBrandLogoUrl(String((profile as any)?.logo_url || '').trim());
      } catch {
        setBrandLogoUrl('');
      }
    })();
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    const joinUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/?join=1&club=${encodeURIComponent(form.join_customer_type)}&discount=${encodeURIComponent(form.join_discount_percent)}`
      : '';
    if (!joinUrl) return;
    void QRCode.toDataURL(joinUrl, { width: 220, margin: 1 }).then((url) => {
      if (!cancelled) setJoinQr(url);
    }).catch(() => {
      if (!cancelled) setJoinQr('');
    });
    return () => {
      cancelled = true;
    };
  }, [form.join_customer_type, form.join_discount_percent]);

  // P1.3 — hədiyyə sətrinin məhsul seçicisi. Uğursuzluq paneli bloklamır: seçici
  // boş qalır, saxlanmış `menu_item_id` isə olduğu kimi göndərilir.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const items = await get_menu_items_live(tenantId);
        if (cancelled) return;
        setMenuItems((items || []).map((row: any) => ({
          id: String(row?.id || ''),
          item_name: String(row?.item_name || ''),
          category: String(row?.category || ''),
        })).filter((row) => row.id));
      } catch {
        if (!cancelled) setMenuItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const flash = (msg: string) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(''), 2500);
  };


  const loadCampaigns = async () => {
    try {
      const res = await list_campaigns_admin_live(tenantId);
      setCampaigns(res || []);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Kampaniyalar yüklənə bilmədi', 'Не удалось загрузить кампании', 'Could not load campaigns'));
    }
  };

  useEffect(() => {
    void loadCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  /* ── P1.4e — push yükləyiciləri ────────────────────────────────────────── */

  const applyPushStatus = (st: PushStatus) => {
    setPushStatus(st);
    setPushStatusError('');
    setPushForm({
      onesignal_app_id: String(st.onesignal_app_id || ''),
      // Açar QƏSDƏN boş qalır: serverin cavabındaki dəyər maskalanmış ola bilər
      // və onu geri göndərmək açarı korlayardı. Vəziyyət `_set` bayrağı ilə
      // göstərilir, dəyişmək üçün admin yeni açar yazır.
      rest_api_key: '',
      enabled: Boolean(st.settings?.enabled),
      event_push_enabled: Boolean(st.settings?.event_push_enabled),
      broadcast_enabled: Boolean(st.settings?.broadcast_enabled),
      broadcast_daily_limit: String(st.settings?.broadcast_daily_limit ?? 0),
    });
    // Seqment kataloqu serverdən gəlir; seçilmiş seqment siyahıda yoxdursa
    // (köhnə vəziyyət) `all`-a qaytarırıq, yoxsa preview həmişə boş qayıdar.
    setPushCompose((prev) => {
      const keys = (st.segments || []).map((s) => String(s.key));
      return keys.includes(prev.segment) ? prev : { ...prev, segment: 'all', value: '' };
    });
  };

  const loadPushStatus = async () => {
    try {
      applyPushStatus(await get_push_status_live());
    } catch (e: any) {
      setPushStatus(null);
      setPushStatusError(String(e?.message || tx(lang, 'Push vəziyyəti yüklənmədi', 'Не удалось загрузить статус push', 'Could not load push status')));
    }
  };

  const loadPushHistory = async (kind?: string) => {
    try {
      const res = await get_push_history_live(PUSH_HISTORY_LIMIT, kind ?? pushHistoryKind);
      setPushHistory(Array.isArray(res?.items) ? res.items : []);
    } catch {
      // Tarixçə ikinci dərəcəlidir — uğursuzluq bloku bağlamır.
      setPushHistory([]);
    }
  };

  useEffect(() => {
    void loadPushStatus();
    void loadPushHistory(pushHistoryKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, pushHistoryKind]);

  const pushComposeKey = pushSpecKey(
    pushCompose.segment, pushCompose.value, pushCompose.days, pushCompose.min_stars,
  );
  /** Seqment sahələrindən `PushAudienceInput`. Boş sahə → `null` (default işləyir). */
  const pushAudienceInput = (): PushAudienceInput => ({
    segment: pushCompose.segment,
    value: pushCompose.value.trim(),
    days: pushCompose.days.trim() === '' ? null : Number(pushCompose.days),
    min_stars: pushCompose.min_stars.trim() === '' ? null : Number(pushCompose.min_stars),
  });

  /* Avtomatik ön baxış. P0.4: göndərmə düyməsinin yanındaki rəqəm HƏMİŞƏ cari
     seqmentə aid olmalıdır. Ona görə cavab `pushComposeKey` ilə birlikdə saxlanır
     və admin sahəni dəyişən kimi köhnə rəqəm "hesablanır"-a çevrilir — panel
     412 yazıb 30 nəfərə göndərə bilməz. */
  useEffect(() => {
    if (!pushStatus) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPushAudienceBusy(true);
      void preview_push_audience_live(pushAudienceInput())
        .then((res) => {
          if (cancelled) return;
          setPushAudience({ key: pushComposeKey, data: res.audience });
          setPushAudienceError('');
        })
        .catch((e: any) => {
          if (cancelled) return;
          setPushAudience(null);
          setPushAudienceError(String(e?.message || tx(lang, 'Ön baxış alınmadı', 'Предпросмотр не получен', 'Preview failed')));
        })
        .finally(() => {
          if (!cancelled) setPushAudienceBusy(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushComposeKey, tenantId, Boolean(pushStatus)]);

  /** Ekranda göstərilə bilən say — imza uyğun gəlmirsə `null`. */
  const pushAudienceFresh = pushAudience && pushAudience.key === pushComposeKey ? pushAudience.data : null;
  /* Hansı əlavə sahələr lazımdır — serverin seqment kataloqu deyir, panel
     bilmir. Yeni seqment backend-də əlavə olunanda bu blok özü uyğunlaşır. */
  const pushSegment = (pushStatus?.segments || []).find((s) => String(s.key) === pushCompose.segment) || null;
  /* Göndərməni əvvəlcədən bağlayan səbəb. Backend nərdivanı ilə EYNİ sıradadır
     (əsas açar → kütləvi açar → konfiqurasiya → hədd), sadəcə admin düyməni
     basmadan səbəbi görsün. Yekun qərar yenə serverdədir. */
  const pushSendBlockReason = (): string => {
    if (!pushStatus) return tx(lang, 'Vəziyyət yüklənir…', 'Загрузка статуса…', 'Loading status…');
    if (!pushStatus.settings.enabled) return tx(lang, 'Push bildirişləri söndürülüb.', 'Push-уведомления отключены.', 'Push notifications are disabled.');
    if (!pushStatus.settings.broadcast_enabled) return tx(lang, 'Kütləvi bildiriş söndürülüb.', 'Массовые уведомления отключены.', 'Broadcasts are disabled.');
    if (!pushStatus.config.ok) return pushStatus.config.reason || tx(lang, 'Konfiqurasiya natamam.', 'Конфигурация неполная.', 'Configuration incomplete.');
    if (pushStatus.broadcast.daily_limit <= 0) return tx(lang, 'Gündəlik hədd 0-dır.', 'Дневной лимит 0.', 'Daily limit is 0.');
    if (pushStatus.broadcast.remaining <= 0) return tx(lang, `Gündəlik hədd doldu (${pushStatus.broadcast.used_today}/${pushStatus.broadcast.daily_limit}).`, `Дневной лимит исчерпан (${pushStatus.broadcast.used_today}/${pushStatus.broadcast.daily_limit}).`, `Daily limit reached (${pushStatus.broadcast.used_today}/${pushStatus.broadcast.daily_limit}).`);
    if (!pushCompose.body.trim()) return tx(lang, 'Bildiriş mətni boşdur.', 'Текст пуст.', 'Body is empty.');
    if (pushAudienceFresh && pushAudienceFresh.recipients <= 0) return tx(lang, 'Bu seqmentdə çatdırıla bilən abunəçi yoxdur.', 'В этом сегменте нет доставляемых подписчиков.', 'No deliverable subscribers in this segment.');
    return '';
  };
  const pushBlocked = pushSendBlockReason();

  /* ── P1.4e — push əməliyyatları ────────────────────────────────────────── */

  const savePushSettings = async () => {
    setPushSaving(true);
    try {
      const patch: PushSettingsPatch = {
        enabled: pushForm.enabled,
        event_push_enabled: pushForm.event_push_enabled,
        broadcast_enabled: pushForm.broadcast_enabled,
        broadcast_daily_limit: Number(pushForm.broadcast_daily_limit || 0),
        onesignal_app_id: pushForm.onesignal_app_id.trim(),
      };
      // Açar YALNIZ admin yeni dəyər yazanda göndərilir. Boş sahə "dəyişmə"
      // deməkdir, "sil" demək deyil — silmə ayrı düymədədir.
      const typedKey = pushForm.rest_api_key.trim();
      if (typedKey) patch.onesignal_rest_api_key = typedKey;
      await update_push_settings_live(patch);
      await loadPushStatus();
      flash(tx(lang, 'Push ayarları yadda saxlandı', 'Настройки push сохранены', 'Push settings saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Push ayarları saxlanmadı', 'Не удалось сохранить', 'Could not save'));
    } finally {
      setPushSaving(false);
    }
  };

  const clearPushRestKey = async () => {
    if (!window.confirm(tx(lang,
      'REST API açarı silinsin? Silinəndən sonra tenant öz OneSignal hesabından göndərə bilməyəcək (platforma açarı varsa ona qayıdacaq).',
      'Удалить REST API ключ? После этого отправка через аккаунт заведения прекратится.',
      'Delete the REST API key? Sending from this tenant account will stop.'))) return;
    setPushSaving(true);
    try {
      await update_push_settings_live({ clear_onesignal_rest_api_key: true });
      await loadPushStatus();
      flash(tx(lang, 'REST API açarı silindi', 'REST API ключ удалён', 'REST API key cleared'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Açar silinmədi', 'Не удалось удалить ключ', 'Could not clear the key'));
    } finally {
      setPushSaving(false);
    }
  };

  const sendPushBroadcast = async () => {
    setPushSending(true);
    try {
      // Təsdiq pəncərəsindəki rəqəm TƏZƏ olmalıdır: imza köhnədirsə (admin
      // sahəni dəyişib gözləmədən basıb) ön baxışı yenidən çağırırıq. Uydurma
      // rəqəmlə təsdiq istəmək P0.4-ün pozulmasıdır.
      let audienceNow = pushAudienceFresh;
      if (!audienceNow) {
        const preview = await preview_push_audience_live(pushAudienceInput());
        audienceNow = preview.audience;
        setPushAudience({ key: pushComposeKey, data: preview.audience });
        setPushAudienceError('');
      }
      const question = tx(lang,
        `Bildiriş ${audienceNow.recipients} nəfərə göndərilsin? (${audienceNow.label})`,
        `Отправить уведомление ${audienceNow.recipients} получателям? (${audienceNow.label})`,
        `Send the notification to ${audienceNow.recipients} recipients? (${audienceNow.label})`);
      if (!window.confirm(question)) return;
      const res = await send_push_broadcast_live({
        title: pushCompose.title.trim(),
        body: pushCompose.body.trim(),
        url: pushCompose.url.trim(),
        audience: pushAudienceInput(),
      });
      setPushLastSend(res);
      // `success === false` real haldır (lokal rejim, natamam konfiqurasiya,
      // provayder xətası) — səssiz keçmək P0.7-nin pozulmasıdır.
      if (res.success) flash(tx(lang, `Göndərildi: ${res.result.accepted}`, `Отправлено: ${res.result.accepted}`, `Sent: ${res.result.accepted}`));
      else notify('error', res.result.error || tx(lang, 'Göndərilmədi', 'Не отправлено', 'Not sent'));
      await Promise.all([loadPushStatus(), loadPushHistory(pushHistoryKind)]);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Bildiriş göndərilmədi', 'Уведомление не отправлено', 'Notification not sent'));
    } finally {
      setPushSending(false);
    }
  };

  const sendPushTestNow = async () => {
    setPushTesting(true);
    try {
      const res = await send_push_test_live({
        title: pushCompose.title.trim(),
        body: pushCompose.body.trim(),
        card_id: pushTestCard.trim(),
      });
      setPushLastSend(res);
      if (res.success) flash(tx(lang, 'Test bildirişi göndərildi', 'Тестовое уведомление отправлено', 'Test notification sent'));
      else notify('error', res.result.error || tx(lang, 'Test göndərilmədi', 'Тест не отправлен', 'Test not sent'));
      await loadPushHistory(pushHistoryKind);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Test göndərilmədi', 'Тест не отправлен', 'Test not sent'));
    } finally {
      setPushTesting(false);
    }
  };

  const startEditCampaign = (c: any) => {
    setEditingCampaignId(c.id);
    setCampaignForm({
      name: c.name || '',
      start_time: c.start_time || '10:00',
      end_time: c.end_time || '22:00',
      discount_percent: String(c.discount_percent ?? 10),
      days_of_week: Array.isArray(c.days_of_week) ? c.days_of_week : [1,2,3,4,5],
      categories: c.categories || 'ALL',
      is_active: Boolean(c.is_active),
    });
  };

  const saveCampaign = async () => {
    if (!campaignForm.name.trim()) {
      notify('error', tx(lang, 'Kampaniya adı boş ola bilməz', 'Название кампании не может быть пустым', 'Campaign name is required'));
      return;
    }
    const payload = {
      name: campaignForm.name.trim(),
      start_time: campaignForm.start_time,
      end_time: campaignForm.end_time,
      discount_percent: Number(campaignForm.discount_percent),
      days_of_week: campaignForm.days_of_week,
      categories: campaignForm.categories.trim() || 'ALL',
      is_active: campaignForm.is_active,
    };
    try {
      if (editingCampaignId) {
        await update_campaign_live(editingCampaignId, payload, tenantId);
      } else {
        await create_campaign_live(payload, tenantId);
      }
      setCampaignForm({ name: '', start_time: '10:00', end_time: '22:00', discount_percent: '10', days_of_week: [1,2,3,4,5], categories: 'ALL', is_active: true });
      setEditingCampaignId(null);
      await loadCampaigns();
      flash(tx(lang, 'Kampaniya yadda saxlanıldı', 'Кампания сохранена', 'Campaign saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Kampaniya saxlanıla bilmədi', 'Не удалось сохранить кампанию', 'Could not save campaign'));
    }
  };

  const removeCampaign = async (campaignId: string) => {
    if (typeof window !== 'undefined' && !window.confirm(tx(lang, 'Bu kampaniyanı silmək istəyirsiniz?', 'Удалить эту кампанию?', 'Delete this campaign?'))) {
      return;
    }
    try {
      await delete_campaign_live(campaignId, tenantId);
      await loadCampaigns();
      flash(tx(lang, 'Kampaniya silindi', 'Кампания удалена', 'Campaign deleted'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Kampaniya silinə bilmədi', 'Не удалось удалить кампанию', 'Could not delete campaign'));
    }
  };

  const loadBranches = async () => {

    try {
      const res = await list_branches_live(tenantId);
      setBranches(res?.branches || []);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Filiallar yüklənə bilmədi', 'Не удалось загрузить филиалы', 'Could not load branches'));
    }
  };

  useEffect(() => {
    void loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const startEditBranch = (b: any) => {
    setEditingBranchId(b.id);
    setBranchForm({
      name: b.name || '',
      address: b.address || '',
      phone: b.phone || '',
      latitude: b.latitude != null ? String(b.latitude) : '',
      longitude: b.longitude != null ? String(b.longitude) : '',
      open_hour: String(b.open_hour ?? 8),
      close_hour: String(b.close_hour ?? 23),
      is_default: Boolean(b.is_default),
    });
  };

  const saveBranch = async () => {
    if (!branchForm.name.trim()) {
      notify('error', tx(lang, 'Filial adı boş ola bilməz', 'Название филиала не может быть пустым', 'Branch name is required'));
      return;
    }
    const payload = {
      name: branchForm.name.trim(),
      address: branchForm.address.trim() || undefined,
      phone: branchForm.phone.trim() || undefined,
      latitude: branchForm.latitude.trim() ? Number(branchForm.latitude) : null,
      longitude: branchForm.longitude.trim() ? Number(branchForm.longitude) : null,
      open_hour: Number(branchForm.open_hour || 8),
      close_hour: Number(branchForm.close_hour || 23),
      is_default: branchForm.is_default,
    };
    try {
      if (editingBranchId) {
        await update_branch_live(tenantId, editingBranchId, payload);
      } else {
        await create_branch_live(tenantId, payload);
      }
      setBranchForm({ name: '', address: '', phone: '', latitude: '', longitude: '', open_hour: '8', close_hour: '23', is_default: false });
      setEditingBranchId(null);
      await loadBranches();
      flash(tx(lang, 'Filial yadda saxlanıldı', 'Филиал сохранен', 'Branch saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Filial saxlanıla bilmdi', 'Не удалось сохранить филиал', 'Could not save branch'));
    }
  };

  const removeBranch = async (branchId: string) => {
    if (typeof window !== 'undefined' && !window.confirm(tx(lang, 'Bu filialı silmək istəyirsiniz?', 'Удалить этот филиал?', 'Delete this branch?'))) {
      return;
    }
    try {
      await delete_branch_live(tenantId, branchId);
      await loadBranches();
      flash(tx(lang, 'Filial silindi', 'Филиал удален', 'Branch deleted'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Filal silinə bilmdi', 'Не удалось удалить филиал', 'Could not delete branch'));
    }
  };

  const handleImage = async (field: 'hero_image_url' | 'background_image_url', file?: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await prepareImageDataUrl(file);
      setForm((prev) => ({ ...prev, [field]: dataUrl }));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Şəkil yüklənmədi', 'Изображение не загрузилось', 'Image upload failed'));
    }
  };

  /* ── P1.2 — nərdivan redaktoru ──────────────────────────────────────
     Redaktə zamanı sətirlər NORMALIZE EDİLMİR: istifadəçi "150" yazarkən
     hər hərfdən sonra sıralama dəyişsə sətir gözünün altından qaçar.
     Normalizer yalnız ön baxışda (`tiersPreview`) və save-də işləyir. */

  const slugTierKey = (raw: string) => raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);

  const patchTier = (index: number, patch: Partial<CustomerAppTier>) => {
    setTiers((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const patchTierLabel = (index: number, langKey: 'az' | 'ru' | 'en', value: string) => {
    setTiers((prev) => prev.map((row, i) => (i === index ? { ...row, label: { ...row.label, [langKey]: value } } : row)));
  };

  const addTier = () => {
    setTiers((prev) => {
      if (prev.length >= MAX_LOYALTY_TIERS) return prev;
      const maxThreshold = prev.reduce((max, row) => Math.max(max, Number(row.threshold) || 0), 0);
      return [...prev, {
        key: '',
        label: { az: '', ru: '', en: '' },
        threshold: maxThreshold + 100,
        color: FALLBACK_TIER_COLOR,
        multiplier: 1,
        discount_percent: 0,
      }];
    });
  };

  const removeTier = (index: number) => {
    // Ən azı bir pillə qalmalıdır: boş nərdivan normalizerdə defaultlara qaytarır,
    // yəni "hamısını sildim" nəticəsi gözlənilməz olardı.
    setTiers((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const resetTiers = () => {
    if (typeof window !== 'undefined' && !window.confirm(tx(lang,
      'Nərdivan default pillələrə (Bürünc / Gümüş / Qızıl) qaytarılsın?',
      'Вернуть уровни к значениям по умолчанию (Бронза / Серебро / Золото)?',
      'Reset the ladder to the default tiers (Bronze / Silver / Gold)?'))) {
      return;
    }
    setTiers(cloneDefaultCustomerAppTiers());
  };

  /* ── P1.3 — hədiyyə kataloqu redaktoru ───────────────────────────────
     Tier redaktoru ilə eyni qayda: sətirlər YAZARKƏN normalizə olunmur
     (normalizer `points_cost`-a görə sıralayır — hər rəqəmdən sonra sətir
     yerini dəyişsə redaktə mümkünsüz olar). Normalizer yalnız ön baxışda
     (`rewardsPreview`) və save-də işləyir. */

  const menuItemName = (id: string): string => {
    const found = menuItems.find((row) => row.id === String(id || ''));
    return found ? found.item_name : '';
  };

  const patchReward = (index: number, patch: Partial<CustomerAppReward>) => {
    setRewards((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const patchRewardText = (
    index: number,
    field: 'title' | 'description',
    langKey: 'az' | 'ru' | 'en',
    value: string,
  ) => {
    setRewards((prev) => prev.map((row, i) => (
      i === index ? { ...row, [field]: { ...(row[field] || { az: '', ru: '', en: '' }), [langKey]: value } } : row
    )));
  };

  const addReward = () => {
    setRewards((prev) => {
      if (prev.length >= MAX_LOYALTY_REWARDS) return prev;
      // id texnikidir və claim-lər ona görə tapılır, ona görə boş buraxmırıq:
      // boş id-li sətir serverdə səssizcə atılır (tier açarından fərqli olaraq
      // burada "defaultlara qayıt" davranışı yoxdur — sətir sadəcə yox olur).
      const used = new Set(prev.map((row) => normRewardId(row.id)));
      let n = prev.length + 1;
      while (used.has(`reward-${n}`)) n += 1;
      const baseCost = Math.max(1, Math.trunc(Number(form.reward_threshold) || 10));
      return [...prev, {
        id: `reward-${n}`,
        title: { az: '', ru: '', en: '' },
        description: { az: '', ru: '', en: '' },
        points_cost: baseCost,
        menu_item_id: '',
        active: true,
        stock_limit: 0,
      }];
    });
  };

  const removeReward = (index: number) => {
    setRewards((prev) => prev.filter((_, i) => i !== index));
  };

  // Kataloq boşdursa tətbiq köhnə tək hədiyyəni göstərir. Bu düymə həmin
  // hədiyyəni kataloqun BİRİNCİ sətrinə çevirir ki, tenant sıfırdan yazmasın.
  const seedRewardCatalogFromLegacy = () => {
    const name = String(form.reward_name || '').trim() || 'Reward';
    const desc = String(form.reward_description || '').trim();
    setRewards([{
      id: 'reward-1',
      title: { az: name, ru: name, en: name },
      description: { az: desc, ru: desc, en: desc },
      points_cost: Math.max(1, Math.trunc(Number(form.reward_threshold) || 10)),
      menu_item_id: '',
      active: true,
      stock_limit: 0,
    }]);
  };

  const clearRewardCatalog = () => {
    if (typeof window !== 'undefined' && !window.confirm(tx(lang,
      'Kataloq tam silinsin? Tətbiq yenidən köhnə tək hədiyyəni (Reward adı + hədd) göstərəcək.',
      'Удалить весь каталог? Приложение снова покажет одну старую награду (название + порог).',
      'Delete the whole catalogue? The app will fall back to the single legacy reward (name + threshold).'))) {
      return;
    }
    setRewards([]);
  };

  const save = async () => {
    await update_customer_app_settings_live({
      enabled: form.enabled,
      registration_mode: form.registration_mode,
      program_mode: form.program_mode,
      layout_preset: form.layout_preset,
      consent_text: form.consent_text,
      join_customer_type: form.join_customer_type,
      join_discount_percent: Number(form.join_discount_percent || 0),
      app_name: form.app_name,
      hero_title: form.hero_title,
      hero_subtitle: form.hero_subtitle,
      hero_image_url: form.hero_image_url,
      background_image_url: form.background_image_url,
      background_color: form.background_color,
      points_label: form.points_label,
      reward_name: form.reward_name,
      reward_threshold: Number(form.reward_threshold || 10),
      reward_description: form.reward_description,
      reward_card_style: form.reward_card_style,
      cashback_percent: Number(form.cashback_percent || 5),
      primary_color: form.primary_color,
      accent_color: form.accent_color,
      show_qr_card: form.show_qr_card,
      show_wallet: form.show_wallet,
      ai_barista_enabled: form.ai_barista_enabled,
      ai_falci_enabled: form.ai_falci_enabled,
      show_campaigns: form.show_campaigns,
      show_history: form.show_history,
      show_notifications: form.show_notifications,
      campaigns_require_online: form.campaigns_require_online,
      campaign_activation_minutes: Number(form.campaign_activation_minutes || 15),
      earn_rate_per_azn: Number(form.earn_rate_per_azn),
      min_purchase_for_earn: Number(form.min_purchase_for_earn),
      birthday_enabled: form.birthday_enabled,
      birthday_bonus_points: Number(form.birthday_bonus_points),
      first_purchase_bonus: Number(form.first_purchase_bonus),
      double_points_days: form.double_points_days,
      // P1.1 — qazanma keçidləri.
      earn_basis: form.earn_basis,
      first_purchase_bonus_enabled: form.first_purchase_bonus_enabled,
      tier_multiplier_enabled: form.tier_multiplier_enabled,
      // P1.2 — nərdivan. Normalize edilmiş halda göndərilir ki, panelin ön
      // baxışı ilə serverin saxladığı eyni olsun. Boş massiv göndərilmir:
      // backend onu "default qaytar" kimi oxuyur (yuxarıdaki state şərhi).
      ...(tiers.length ? { tiers: normCustomerAppTiers(tiers) } : {}),
      // P1.3 — hədiyyə kataloqu. Burada BOŞ MASSİV də göndərilir (tiers-dən
      // fərqli): backend onu "kataloq yoxdur, köhnə tək hədiyyə işləsin" kimi
      // oxuyur. Qoruyucu uzunluq deyil, `rewardsLoaded` flag-ıdır.
      ...(rewardsLoaded ? { rewards: normCustomerAppRewards(rewards) } : {}),
    });
    // Serverin tətbiq etdiyi qaydalar (sıralama, ən aşağı pillə = 0, atılan
    // sətirlər) dərhal ekranda görünsün — yoxsa panel saxlanmayan sətri göstərər.
    if (tiers.length) setTiers(normCustomerAppTiers(tiers));
    if (rewardsLoaded) setRewards(normCustomerAppRewards(rewards));
    flash(tx(lang, 'Customer app dizaynı yadda saxlanıldı', 'Дизайн customer app сохранен', 'Customer app design saved'));
  };

  const applyPreset = (preset: 'rewards' | 'cashback' | 'playful') => {
    if (preset === 'cashback') {
      setForm((prev) => ({
        ...prev,
        layout_preset: 'cashback',
        program_mode: 'cashback',
        app_name: 'Cashback Club',
        hero_title: 'Cashback balansın hazırdır',
        hero_subtitle: 'Hər alışda qazan, tətbiqdən izləmək rahat olsun.',
        consent_text: 'Mən cashback klubuna qoşulmağa və hesabımın yaradılmasına razıyam.',
        background_color: '#062c2d',
        points_label: 'Cashback',
        reward_name: 'Cashback Bonus',
        reward_description: 'Balansını növbəti alışda istifadə et',
        reward_card_style: 'soft-square',
        primary_color: '#14b8a6',
        accent_color: '#0f172a',
      }));
      return;
    }
    if (preset === 'playful') {
      setForm((prev) => ({
        ...prev,
        layout_preset: 'playful',
        program_mode: 'points',
        app_name: 'Fun Club',
        hero_title: 'Bonus və sürprizlər burada',
        hero_subtitle: 'Reward, QR, oyun və əyləncə bir yerdə.',
        consent_text: 'Mən loyalty və fun zonaya qoşulmağa razıyam.',
        background_color: '#1f1235',
        points_label: 'Ulduz',
        reward_name: 'Sürpriz Reward',
        reward_description: 'Bonuslarını topla və claim et',
        reward_card_style: 'glass',
        primary_color: '#ec4899',
        accent_color: '#7c3aed',
        ai_barista_enabled: true,
        ai_falci_enabled: true,
      }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      layout_preset: 'rewards',
      program_mode: 'points',
      app_name: 'Loyalty Club',
      hero_title: 'Xoş gəldiniz',
      hero_subtitle: 'Reward, QR və kampaniyalar bir yerdə.',
      consent_text: 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.',
      background_color: '#0b1220',
      points_label: 'Ulduz',
      reward_name: 'Reward',
      reward_description: 'Topla və kassada istifadə et',
      reward_card_style: 'rounded',
      primary_color: '#facc15',
      accent_color: '#22d3ee',
    }));
  };

  const handleJoinTypeChange = (nextType: string) => {
    const selected = CRM_MEMBER_TYPES.find((item) => item.value === nextType);
    setForm((prev) => ({
      ...prev,
      join_customer_type: nextType,
      join_discount_percent: String(selected?.discount ?? prev.join_discount_percent),
    }));
  };

  const downloadJoinQr = () => {
    if (!joinQr || typeof document === 'undefined') return;
    const link = document.createElement('a');
    link.href = joinQr;
    link.download = `${tenantId}-cashier-join-qr.png`;
    link.click();
  };

  // ── P0.3 — ön baxış fonu real tətbiqin qaydası ilə ────────────────────────
  // `CustomerApp.tsx` `#0b1220`-ni "seçilməmiş" sentinel kimi sayır (backend-in
  // öz default-udur), o halda tətbiqin isti qradienti qalır. Ön baxış da eyni
  // qaydanı işlətməlidir, yoxsa panel real olmayan nəticə vəd edir.
  const previewBgIsDefault = String(form.background_color || '').trim().toLowerCase() === '#0b1220';
  const previewBgStyle: React.CSSProperties = form.background_image_url
    ? {
        backgroundColor: previewBgIsDefault ? '#160D07' : form.background_color,
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.78)), url(${form.background_image_url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : previewBgIsDefault
      ? { background: 'linear-gradient(180deg, #2A1A10 0%, #160D07 100%)' }
      : { backgroundColor: form.background_color };

  // ── P0.4 — ön baxış yalnız tətbiqin REAL oxuduğu sahələri göstərir ────────
  // Möhür sayı `reward_threshold`-dan gəlir (HomeTab-da eyni qayda, P0.3);
  // çox böyük hədd ön baxışı doldurmasın deyə 10-da kəsilir.
  const previewThreshold = Math.max(1, Math.min(60, Number(form.reward_threshold) || 10));
  const previewStampCount = Math.min(10, previewThreshold);

  // Tətbiqin alt naviqasiyası ilə eyni siyahı və eyni şərt
  // (`CustomerApp.tsx:1764-1775`) — AI tab-ı yalnız Barista/Falçı açıq olanda.
  const previewTabs: Array<{ key: string; label: string; icon: React.ReactNode }> = [
    { key: 'home', label: tx(lang, 'Ana', 'Главная', 'Home'), icon: <Home size={13} /> },
    { key: 'order', label: tx(lang, 'Menyu', 'Меню', 'Menu'), icon: <Coffee size={13} /> },
    { key: 'offers', label: tx(lang, 'Kampaniya', 'Кампании', 'Offers'), icon: <Gift size={13} /> },
    { key: 'feedback', label: tx(lang, 'Rəy', 'Отзыв', 'Feedback'), icon: <MessageSquare size={13} /> },
    ...(form.ai_barista_enabled || form.ai_falci_enabled
      ? [{ key: 'ai', label: 'AI', icon: <Sparkles size={13} /> }]
      : []),
    { key: 'profile', label: tx(lang, 'Profil', 'Профиль', 'Profile'), icon: <UserRound size={13} /> },
  ];

  // ── P1.1 — "effektiv qayda" xülasəsi ─────────────────────────────────────
  // Nümunə çek qəsdən SABİTDİR (3 içki / 12.00 AZN): məqsəd ayarın nəticəsini
  // müqayisə etməkdir, real satışı təxmin etmək deyil. Hesablama POS-un işlətdiyi
  // funksiyanın eynisidir, ona görə burada görünən rəqəm kassada da çıxır.
  const EARN_EXAMPLE_DRINKS = 3;
  const EARN_EXAMPLE_TOTAL = 12;
  const earnUnit = String(form.points_label || 'Ulduz').trim() || 'Ulduz';
  const earnPreviewSettings: Record<string, unknown> = {
    earn_basis: form.earn_basis,
    earn_rate_per_azn: Number(form.earn_rate_per_azn || 0),
    min_purchase_for_earn: Number(form.min_purchase_for_earn || 0),
    first_purchase_bonus: Number(form.first_purchase_bonus || 0),
    first_purchase_bonus_enabled: form.first_purchase_bonus_enabled,
    tier_multiplier_enabled: form.tier_multiplier_enabled,
    double_points_days: form.double_points_days,
  };
  const earnExampleCtx = {
    drinkQty: EARN_EXAMPLE_DRINKS,
    eligibleTotal: EARN_EXAMPLE_TOTAL,
    weekday: weekdayIso(),
  };
  const earnPreviewRepeat = computePointsEarned(earnPreviewSettings, { ...earnExampleCtx, tierMultiplier: 1 });
  const earnPreviewFirst = computePointsEarned(earnPreviewSettings, { ...earnExampleCtx, isFirstPurchase: true, tierMultiplier: 1 });
  // Nərdivanın ən yüksək çarpanlı pilləsi — keçidin real təsirini göstərmək üçün.
  const topTier = tiers.reduce<Record<string, any> | null>((best, row) => {
    const m = Number(row?.multiplier);
    if (!Number.isFinite(m)) return best;
    return best === null || m > Number(best?.multiplier || 0) ? row : best;
  }, null);
  const topTierMultiplier = Number(topTier?.multiplier || 1);
  const topTierLabel = String(topTier?.label?.[lang] || topTier?.label?.az || topTier?.key || '').trim();
  const earnPreviewTopTier = computePointsEarned(earnPreviewSettings, { ...earnExampleCtx, tierMultiplier: topTierMultiplier });
  // Dərəcə sahəsinin altındaki ipucu da mühərriklə hesablanır: `Math.floor(12 * 0.3)`
  // tipli sadə hesab float tələsinə düşür və kassadan fərqli rəqəm göstərə bilər.
  const earnRateHint = computePointsEarned(
    { earn_basis: 'per_azn', earn_rate_per_azn: Number(form.earn_rate_per_azn || 0) },
    { eligibleTotal: EARN_EXAMPLE_TOTAL },
  ).earned;

  /* ── P1.2 — nərdivanın "server nə saxlayacaq" ön baxışı ──────────────
     Panel öz yoxlamasını yazsaydı nərdivanın beşinci nüsxəsi yaranardı;
     burada save-in göndərdiyi EYNİ normalizer çağırılır. */
  const tiersPreview = tiers.length ? normCustomerAppTiers(tiers) : [];
  const tierKeys = tiers.map((row) => slugTierKey(String(row.key || '')));
  const emptyKeyCount = tierKeys.filter((k) => !k).length;
  const duplicateTierKeys = Array.from(
    new Set(tierKeys.filter((k) => k && tierKeys.filter((other) => other === k).length > 1)),
  );
  // Bütün sətirlər açarsızdırsa normalizer defaultlara qaytarır — bunu demədən
  // save etmək istifadəçinin nərdivanını gözlənilmədən silmiş olardı.
  const tiersFallBackToDefaults = tiers.length > 0 && emptyKeyCount === tiers.length;
  const lowestTierForcedToZero =
    tiersPreview.length > 0 &&
    Math.min(...tiers.map((row) => Math.max(0, Math.trunc(Number(row.threshold) || 0)))) !== 0;

  /* ── P1.3 — kataloqun "server nə saxlayacaq" ön baxışı ───────────────
     Save-in göndərdiyi EYNİ normalizer çağırılır (`_norm_customer_app_rewards`
     güzgüsü), ona görə panelin göstərdiyi sıra və dəyərlər serverdəki ilə üst-üstə
     düşür. Tier-dən iki fərq var: (1) təkrarlanan id DEDUPE olunur, çünki claim-lər
     id ilə tapılır; (2) boş massiv "defaultlara qayıt" deyil, "kataloq yoxdur"dur. */
  const rewardsPreview = normCustomerAppRewards(rewards);
  const rewardIds = rewards.map((row) => normRewardId(row.id));
  const emptyRewardIdCount = rewardIds.filter((id) => !id).length;
  const duplicateRewardIds = Array.from(
    new Set(rewardIds.filter((id) => id && rewardIds.filter((other) => other === id).length > 1)),
  );
  const droppedRewardCount = Math.max(0, rewards.length - rewardsPreview.length);
  const activeRewardRows = rewardsPreview.filter((row) => row.active !== false);
  const allRewardsInactive = rewardsPreview.length > 0 && activeRewardRows.length === 0;
  // Kassa `reward_threshold`-a çatanda pulsuz içkini AVTOMATİK yazır
  // (`pos.py::create_sale`), kataloqun ən ucuz sətri isə müştəriyə göstərilən
  // qiymətdir. İkisi fərqlidirsə müştəri "8 ulduza hədiyyə" görür, kassa isə
  // 10-da verir — ona görə bu fərq açıq deyilir.
  const rewardThresholdValue = Math.max(1, Math.trunc(Number(form.reward_threshold) || 0));
  const cheapestRewardCost = activeRewardRows.length ? activeRewardRows[0].points_cost : 0;
  const rewardThresholdMismatch = cheapestRewardCost > 0 && cheapestRewardCost !== rewardThresholdValue;
  // Bağlı məhsul menyudan silinibsə kassa köhnə davranışa (ən ucuz sətir) düşür.
  const orphanRewardLinks = menuItems.length
    ? rewardsPreview.filter((row) => row.menu_item_id && !menuItemName(row.menu_item_id)).length
    : 0;

  return (
    <div className="space-y-6">

      <div className="metal-panel overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700/70 p-6">
          <Palette className="text-cyan-300" size={22} />
          <div>
            <h1 className="text-2xl font-black tracking-wide text-slate-100">{tx(lang, 'Customer App Dizaynı', 'Дизайн Customer App', 'Customer App Design')}</h1>
            <p className="text-xs text-slate-400">{tenantId}</p>
          </div>
        </div>
        {success ? <div className="border-b border-emerald-400/20 bg-emerald-500/10 px-6 py-3 text-sm text-emerald-200">{success}</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 space-y-6">
      <div className="metal-panel p-6 space-y-4">
        <div className="space-y-3">
          {/* P0.3 — adlar dürüstləşdirildi: bunlar layout mühərriki deyil, sahə doldurma
              qısayollarıdır (ad, hero mətni, rənglər, reward adı və s. birdən yazılır).
              `layout_preset` yalnız hansı düymənin seçili qaldığını yadda saxlayır. */}
          <div className="text-sm font-semibold text-slate-200">{tx(lang, 'Sürətli başlanğıc dəstləri', 'Наборы для быстрого старта', 'Quick-start bundles')}</div>
          <div className="text-[11px] leading-snug text-slate-500">
            {tx(lang,
              'Bir kliklə ad, hero mətni, rənglər və reward adlarını birlikdə doldurur. Hər sahəni sonra ayrıca dəyişə bilərsiniz.',
              'Одним кликом заполняет название, текст hero, цвета и названия reward. Каждое поле потом можно изменить.',
              'Fills the app name, hero text, colors and reward labels in one click. Every field stays individually editable.')}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <button type="button" onClick={() => applyPreset('rewards')} className={`rounded-2xl border p-4 text-left ${form.layout_preset === 'rewards' ? 'border-cyan-300 bg-cyan-400/10' : 'border-slate-700/70 bg-slate-950/30'}`}>
              <div className="font-bold text-slate-100">Rewards</div>
              <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Ulduz toplama mətnləri, standart fon, sarı-mavi rənglər', 'Тексты для сбора звёзд, стандартный фон, жёлто-синий', 'Star-collection copy, default background, yellow/cyan')}</div>
            </button>
            <button type="button" onClick={() => applyPreset('cashback')} className={`rounded-2xl border p-4 text-left ${form.layout_preset === 'cashback' ? 'border-cyan-300 bg-cyan-400/10' : 'border-slate-700/70 bg-slate-950/30'}`}>
              <div className="font-bold text-slate-100">Cashback</div>
              <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Cashback rejimi, balans mətnləri, yaşıl fon', 'Режим cashback, тексты баланса, зелёный фон', 'Cashback mode, balance copy, teal background')}</div>
            </button>
            <button type="button" onClick={() => applyPreset('playful')} className={`rounded-2xl border p-4 text-left ${form.layout_preset === 'playful' ? 'border-cyan-300 bg-cyan-400/10' : 'border-slate-700/70 bg-slate-950/30'}`}>
              <div className="font-bold text-slate-100">Playful</div>
              <div className="mt-1 text-xs text-slate-400">{tx(lang, 'AI Barista + Falçı açılır, çəhrayı-bənövşəyi rənglər', 'Включает AI Barista + Falçı, розово-фиолетовый', 'Turns on AI Barista + Falçı, pink/violet palette')}</div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))} />
            <span>{tx(lang, 'Customer app aktiv olsun', 'Включить customer app', 'Enable customer app')}</span>
          </label>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Proqram tipi', 'Тип программы', 'Program mode')}</label>
            <select className="neon-input" value={form.program_mode} onChange={(e) => setForm((prev) => ({ ...prev, program_mode: e.target.value as 'points' | 'cashback' }))}>
              <option value="points">{tx(lang, 'Point / Ulduz sistemi', 'Баллы / звезды', 'Points / stars program')}</option>
              <option value="cashback">{tx(lang, 'Cashback sistemi', 'Система cashback', 'Cashback program')}</option>
            </select>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'App adı', 'Название приложения', 'App name')}</label>
            <input className="neon-input" value={form.app_name} onChange={(e) => setForm((prev) => ({ ...prev, app_name: e.target.value }))} />
          </div>
          {/* P0.5 — logo burada YAZILMIR. Səbəb: logo Biznes profilinin sütunudur və
              onun endpoint-i bütün fiskal sahələri (VÖEN, ƏDV, NKA) üzərinə yazır. */}
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Logo', 'Логотип', 'Logo')}</label>
            <div className="flex items-center gap-3">
              {brandLogoUrl ? (
                <img src={brandLogoUrl} alt="logo" className="h-12 w-12 rounded-xl object-cover border border-white/15" />
              ) : (
                <div className="h-12 w-12 rounded-xl border border-dashed border-white/20 flex items-center justify-center text-lg opacity-60">☕</div>
              )}
              <p className="text-[11px] leading-snug opacity-70">
                {brandLogoUrl
                  ? tx(lang,
                      'Müştəri tətbiqi bu logonu göstərir. Dəyişmək üçün: Ayarlar → Biznes profili.',
                      'Приложение показывает этот логотип. Изменить: Настройки → Профиль бизнеса.',
                      'The customer app shows this logo. To change it: Settings → Business profile.')
                  : tx(lang,
                      'Logo yüklənməyib — tətbiqdə ☕ ikonu görünür. Yükləmək üçün: Ayarlar → Biznes profili.',
                      'Логотип не загружен — в приложении отображается ☕. Загрузить: Настройки → Профиль бизнеса.',
                      'No logo uploaded — the app shows a ☕ icon. Upload it in Settings → Business profile.')}
              </p>
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Başlıq', 'Заголовок', 'Hero title')}</label>
            <input className="neon-input" value={form.hero_title} onChange={(e) => setForm((prev) => ({ ...prev, hero_title: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Qısa izah', 'Краткое описание', 'Hero subtitle')}</label>
            <input className="neon-input" value={form.hero_subtitle} onChange={(e) => setForm((prev) => ({ ...prev, hero_subtitle: e.target.value }))} />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Müştəri razılaşma mətni', 'Текст согласия клиента', 'Customer consent text')}</label>
            <textarea className="neon-input min-h-28" value={form.consent_text} onChange={(e) => setForm((prev) => ({ ...prev, consent_text: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Balans adı', 'Название баланса', 'Balance label')}</label>
            <input className="neon-input" value={form.points_label} onChange={(e) => setForm((prev) => ({ ...prev, points_label: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Reward adı', 'Название награды', 'Reward name')}</label>
            <input className="neon-input" value={form.reward_name} onChange={(e) => setForm((prev) => ({ ...prev, reward_name: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Reward həddi', 'Порог награды', 'Reward threshold')}</label>
            <input className="neon-input" type="number" min={1} value={form.reward_threshold} onChange={(e) => setForm((prev) => ({ ...prev, reward_threshold: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Cashback %', 'Cashback %', 'Cashback %')}</label>
            <input className="neon-input" type="number" min={0} value={form.cashback_percent} onChange={(e) => setForm((prev) => ({ ...prev, cashback_percent: e.target.value }))} />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Reward izahı', 'Описание награды', 'Reward description')}</label>
            <input className="neon-input" value={form.reward_description} onChange={(e) => setForm((prev) => ({ ...prev, reward_description: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Reward kart dizaynı', 'Стиль карточки награды', 'Reward card style')}</label>
            <select className="neon-input" value={form.reward_card_style} onChange={(e) => setForm((prev) => ({ ...prev, reward_card_style: e.target.value as 'rounded' | 'soft-square' | 'glass' }))}>
              <option value="rounded">{tx(lang, 'Reward kartı: Yumru', 'Карточка: круглая', 'Reward card: rounded')}</option>
              <option value="soft-square">{tx(lang, 'Reward kartı: Soft square', 'Карточка: soft square', 'Reward card: soft square')}</option>
              <option value="glass">{tx(lang, 'Reward kartı: Glass', 'Карточка: glass', 'Reward card: glass')}</option>
            </select>
          </div>
          <label className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3">
            <div className="mb-2 text-sm text-slate-300">{tx(lang, 'Primary rəng', 'Primary цвет', 'Primary color')}</div>
            <div className="flex items-center gap-3">
              <input type="color" value={form.primary_color} onChange={(e) => setForm((prev) => ({ ...prev, primary_color: e.target.value }))} className="h-12 w-16 cursor-pointer rounded-lg border border-slate-600 bg-transparent p-1" />
              <div className="rounded-full px-3 py-1 text-xs font-semibold text-slate-100" style={{ backgroundColor: form.primary_color }}>{form.primary_color}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {colorPresets.map((color) => (
                <button
                  key={`primary_${color}`}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, primary_color: color }))}
                  className="h-8 w-8 rounded-full border-2 border-white/20"
                  style={{ backgroundColor: color }}
                  aria-label={`Primary ${color}`}
                />
              ))}
            </div>
          </label>
          <label className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3">
            <div className="mb-2 text-sm text-slate-300">{tx(lang, 'Accent rəng', 'Accent цвет', 'Accent color')}</div>
            <div className="flex items-center gap-3">
              <input type="color" value={form.accent_color} onChange={(e) => setForm((prev) => ({ ...prev, accent_color: e.target.value }))} className="h-12 w-16 cursor-pointer rounded-lg border border-slate-600 bg-transparent p-1" />
              <div className="rounded-full px-3 py-1 text-xs font-semibold text-slate-100" style={{ backgroundColor: form.accent_color }}>{form.accent_color}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {colorPresets.map((color) => (
                <button
                  key={`accent_${color}`}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, accent_color: color }))}
                  className="h-8 w-8 rounded-full border-2 border-white/20"
                  style={{ backgroundColor: color }}
                  aria-label={`Accent ${color}`}
                />
              ))}
            </div>
          </label>
          <label className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3">
            <div className="mb-2 text-sm text-slate-300">{tx(lang, 'Ümumi arxa fon rəngi', 'Цвет общего фона', 'Global background color')}</div>
            <div className="flex items-center gap-3">
              <input type="color" value={form.background_color} onChange={(e) => setForm((prev) => ({ ...prev, background_color: e.target.value }))} className="h-12 w-16 cursor-pointer rounded-lg border border-slate-600 bg-transparent p-1" />
              <div className="rounded-full px-3 py-1 text-xs font-semibold text-slate-100" style={{ backgroundColor: form.background_color }}>{form.background_color}</div>
            </div>
            {/* P0.3 — ayarın real davranışı açıq yazılır: sentinel + yalnız tünd tema */}
            <div className="mt-2 text-[11px] leading-snug text-slate-500">
              {previewBgIsDefault
                ? tx(lang,
                    '#0b1220 = "seçilməmiş". Tətbiq öz standart fonunu göstərir.',
                    '#0b1220 = «не выбрано». Приложение показывает свой стандартный фон.',
                    '#0b1220 means "not set" — the app keeps its own default background.')
                : tx(lang,
                    'Yalnız tünd temada tətbiq olunur (işıqlı temada mətn oxunmaz olardı).',
                    'Применяется только в тёмной теме (в светлой текст стал бы нечитаемым).',
                    'Applies in dark theme only (light theme text would become unreadable).')}
            </div>
          </label>
          <div className="space-y-2">
            <div className="text-sm text-slate-300">{tx(lang, 'Loyallıq kartının şəkli', 'Изображение карты лояльности', 'Loyalty card image')}</div>
            {/* P0.4 — ad dürüstləşdirildi. Bu şəkil hero-nun arxasında deyil,
                ana səhifədəki loyallıq kartının fonunda işlənir
                (`HomeTab.tsx:622-624`). Açar adı `hero_image_url` olaraq qalır —
                onu dəyişmək mövcud tenant ayarlarını itirərdi. */}
            <input className="neon-input" value={form.hero_image_url} onChange={(e) => setForm((prev) => ({ ...prev, hero_image_url: e.target.value }))} placeholder={tx(lang, 'Şəkil URL və ya data URL', 'URL или data URL', 'Image URL or data URL')} />
            <input className="neon-input" type="file" accept="image/*" onChange={(e) => handleImage('hero_image_url', e.target.files?.[0])} />
            {form.hero_image_url ? <img src={form.hero_image_url} alt="hero preview" className="h-24 w-full rounded-xl object-cover" /> : null}
            <div className="text-[11px] leading-snug text-slate-500">
              {tx(lang,
                'Ana səhifədəki kartın fonu kimi göstərilir, üzərinə tündləşdirici qradient qoyulur.',
                'Показывается как фон карты на главной, поверх накладывается затемняющий градиент.',
                'Rendered as the home-screen card background, under a darkening gradient.')}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-slate-300">{tx(lang, 'Arxa fon şəkli', 'Фоновое изображение', 'Background image')}</div>
            <input className="neon-input" value={form.background_image_url} onChange={(e) => setForm((prev) => ({ ...prev, background_image_url: e.target.value }))} placeholder={tx(lang, 'Şəkil URL və ya data URL', 'URL или data URL', 'Image URL or data URL')} />
            <input className="neon-input" type="file" accept="image/*" onChange={(e) => handleImage('background_image_url', e.target.files?.[0])} />
            {form.background_image_url ? <img src={form.background_image_url} alt="background preview" className="h-24 w-full rounded-xl object-cover" /> : null}
          </div>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-lg font-bold text-slate-100">
          <UserCheck size={18} />
          {tx(lang, 'Qeydiyyat Axını', 'Поток регистрации', 'Registration Flow')}
        </div>
        <p className="text-sm text-slate-400">
          {tx(lang, 
            'Müştəri ilk QR skanda nə qədər məlumat verməlidir?',
            'Какие данные клиент вводит при первом сканировании?',
            'How much info does a customer provide on first QR scan?'
          )}
        </p>
        <div className="grid grid-cols-1 gap-3">
          {/* 3 mode cards */}
          {([
            {
              value: 'simple',
              icon: '⚡',
              titleAz: 'Sadə (Anonim)',
              titleRu: 'Простой (Аноним)',
              titleEn: 'Simple (Anonymous)',
              descAz: 'Yalnız razılaşma → Bitdi. Ad, email tələb olunmur.',
              descRu: 'Только согласие → Готово. Имя и email не требуются.',
              descEn: 'Consent only → Done. No name or email required.',
            },
            {
              value: 'lightweight',
              icon: '👤',
              titleAz: 'Orta (Ad məcburi)',
              titleRu: 'Средний (Имя обязательно)',
              titleEn: 'Lightweight (Name required)',
              descAz: 'Razılaşma + Ad → Bitdi. Email tələb olunmur.',
              descRu: 'Согласие + Имя → Готово. Email не требуется.',
              descEn: 'Consent + Name → Done. No email required.',
            },
            {
              value: 'full',
              icon: '✉️',
              titleAz: 'Tam (Ad + Email)',
              titleRu: 'Полный (Имя + Email)',
              titleEn: 'Full (Name + Email)',
              descAz: 'Razılaşma + Ad + Email → Bitdi. Email dublikat hesabları bloklar.',
              descRu: 'Согласие + Имя + Email → Готово. Email блокирует дубликаты.',
              descEn: 'Consent + Name + Email → Done. Email prevents duplicate accounts.',
            },
          ] as const).map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setForm(prev => ({ ...prev, registration_mode: mode.value }))}
              className={`rounded-2xl border p-4 text-left transition ${
                form.registration_mode === mode.value
                  ? 'border-cyan-300 bg-cyan-400/10'
                  : 'border-slate-700/70 bg-slate-950/30 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{mode.icon}</span>
                <span className="font-bold text-slate-100">{tx(lang, mode.titleAz, mode.titleRu, mode.titleEn)}</span>
                {form.registration_mode === mode.value && (
                  <span className="ml-auto rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">Seçilib</span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-400">{tx(lang, mode.descAz, mode.descRu, mode.descEn)}</p>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button onClick={() => { void save(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">
            {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
          </button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-lg font-bold text-slate-100"><Star size={18} /> {tx(lang, 'Qazanma Qaydaları / Earn Rules', 'Правила заработка / Earn Rules', 'Earn Rules')}</div>
        {/* P1.1 — xülasə artıq statik mətn deyil, hesablanmış nəticədir: menecer
            yadda saxlamadan da ayarın kassada nə edəcəyini görür. */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3 space-y-1.5 text-[11px] leading-snug text-slate-300">
          <div className="font-bold uppercase tracking-wide text-slate-200">{tx(lang, 'Effektiv qayda', 'Действующее правило', 'Effective rule')}</div>
          <div>
            {form.earn_basis === 'per_azn'
              ? tx(lang,
                  `Hər 1 AZN = ${form.earn_rate_per_azn || 0} ${earnUnit} (kəsr hissə aşağıya yuvarlaqlaşdırılır).`,
                  `Каждый 1 AZN = ${form.earn_rate_per_azn || 0} ${earnUnit} (дробная часть округляется вниз).`,
                  `Each 1 AZN = ${form.earn_rate_per_azn || 0} ${earnUnit} (fractions are rounded down).`)
              : tx(lang,
                  `Hər içki = 1 ${earnUnit}; çek məbləği nəticəyə təsir etmir.`,
                  `Каждый напиток = 1 ${earnUnit}; сумма чека не влияет.`,
                  `Each drink = 1 ${earnUnit}; the bill amount does not matter.`)}
            {` ${form.reward_threshold || 10} ${earnUnit} = 1 ${form.reward_name}.`}
          </div>
          <div className="text-slate-400">
            {tx(lang, 'Nümunə', 'Пример', 'Example')}: 3 {tx(lang, 'içki', 'напитка', 'drinks')} / 12.00 AZN{' → '}
            <b className="text-cyan-200">{earnPreviewRepeat.earned} {earnUnit}</b>
            {earnPreviewRepeat.blockedByMinimum
              ? ` (${tx(lang, 'minimum alış həddinin altında', 'ниже минимальной суммы', 'below the minimum purchase')})`
              : earnPreviewRepeat.doubleDayApplied
                ? ` (${tx(lang, 'bugün 2x gündür', 'сегодня день 2x', 'today is a 2x day')})`
                : ''}
          </div>
          {form.first_purchase_bonus_enabled && earnPreviewFirst.firstPurchaseBonus > 0 ? (
            <div className="text-slate-400">
              {tx(lang, 'Həmin çek ilk alışdır', 'Тот же чек как первая покупка', 'Same bill as a first purchase')}{' → '}
              <b className="text-cyan-200">{earnPreviewFirst.earned} {earnUnit}</b>
            </div>
          ) : null}
          {form.tier_multiplier_enabled && topTierMultiplier !== 1 && topTierLabel ? (
            <div className="text-slate-400">
              {tx(lang, 'Həmin çek', 'Тот же чек', 'Same bill')} — {topTierLabel} (×{topTierMultiplier}){' → '}
              <b className="text-cyan-200">{earnPreviewTopTier.earned} {earnUnit}</b>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Qazanma bazası', 'База начисления', 'Earn basis')}</label>
            <select
              className="neon-input"
              value={form.earn_basis}
              onChange={(e) => setForm((prev) => ({ ...prev, earn_basis: e.target.value === 'per_azn' ? 'per_azn' : 'per_drink' }))}
            >
              <option value="per_drink">{tx(lang, 'İçki sayına görə — 1 içki = 1 xal (köhnə qayda)', 'По количеству напитков — 1 напиток = 1 балл (старое правило)', 'Per drink — 1 drink = 1 point (legacy rule)')}</option>
              <option value="per_azn">{tx(lang, 'Çek məbləğinə görə — AZN × dərəcə', 'По сумме чека — AZN × ставка', 'Per AZN — amount × rate')}</option>
            </select>
            <div className="mt-1 text-xs text-slate-500">
              {tx(lang,
                'Dəyişdirdikdə mövcud balanslar toxunulmur — yalnız bundan sonraki satışlar yeni qayda ilə hesablanır.',
                'При смене существующие балансы не меняются — новое правило применяется только к будущим продажам.',
                'Changing this does not touch existing balances — only future sales use the new rule.')}
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, '1 AZN = neçə xal?', '1 AZN = сколько баллов?', 'Earn rate per AZN')}</label>
            <input className="neon-input" type="number" step="any" min={0} value={form.earn_rate_per_azn} disabled={form.earn_basis !== 'per_azn'} onChange={(e) => setForm((prev) => ({ ...prev, earn_rate_per_azn: e.target.value }))} />
            <div className="mt-1 text-xs text-slate-500">
              {form.earn_basis === 'per_azn'
                ? `12.00 AZN → ${earnRateHint} ${earnUnit}`
                : tx(lang, 'Yalnız "Çek məbləğinə görə" bazasında işləyir.', 'Работает только с базой "По сумме чека".', 'Only used with the per-AZN basis.')}
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Minimum alış məbləği', 'Мин. сумма покупки', 'Min purchase for earn')}</label>
            <input className="neon-input" type="number" step="any" min={0} value={form.min_purchase_for_earn} onChange={(e) => setForm((prev) => ({ ...prev, min_purchase_for_earn: e.target.value }))} />
            <div className="mt-1 text-xs text-slate-500">
              {Number(form.min_purchase_for_earn) > 0
                ? tx(lang,
                    `${form.min_purchase_for_earn} AZN-dən aşağı çeklərdə heç nə qazanılmır — ilk alış bonusu da verilmir.`,
                    `С чеков ниже ${form.min_purchase_for_earn} AZN ничего не начисляется — бонус за первую покупку тоже.`,
                    `Bills below ${form.min_purchase_for_earn} AZN earn nothing — not even the first purchase bonus.`)
                : tx(lang, '0 = məhdudiyyət yoxdur.', '0 = без ограничения.', '0 = no limit.')}
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Ad günü bonusu', 'Бонус на день рождения', 'Birthday bonus points')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              max={1000}
              value={form.birthday_bonus_points}
              disabled={!form.birthday_enabled}
              onChange={(e) => setForm((prev) => ({ ...prev, birthday_bonus_points: e.target.value }))}
            />
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.birthday_enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, birthday_enabled: e.target.checked }))}
              />
              <span>{tx(lang, 'Ad günü bonusu avtomatik verilsin', 'Автоматически начислять бонус на день рождения', 'Grant birthday bonus automatically')}</span>
            </label>
            <div className="mt-1 text-xs text-slate-500">
              {form.birthday_enabled
                ? tx(
                    lang,
                    `Hər müştəriyə ildə bir dəfə +${form.birthday_bonus_points || 0} ${form.points_label} və bildiriş göndərilir.`,
                    `Каждому клиенту раз в год +${form.birthday_bonus_points || 0} ${form.points_label} и уведомление.`,
                    `Each customer gets +${form.birthday_bonus_points || 0} ${form.points_label} once a year, plus a notification.`,
                  )
                : tx(lang, 'Söndürülüb — heç bir bonus verilmir.', 'Отключено — бонус не начисляется.', 'Disabled — no bonus is granted.')}
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'İlk alış bonusu', 'Бонус за первую покупку', 'First purchase bonus')}</label>
            <input className="neon-input" type="number" min={0} max={1000} value={form.first_purchase_bonus} disabled={!form.first_purchase_bonus_enabled} onChange={(e) => setForm((prev) => ({ ...prev, first_purchase_bonus: e.target.value }))} />
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.first_purchase_bonus_enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, first_purchase_bonus_enabled: e.target.checked }))}
              />
              <span>{tx(lang, 'İlk alış bonusu verilsin', 'Начислять бонус за первую покупку', 'Grant the first purchase bonus')}</span>
            </label>
            <div className="mt-1 text-xs text-slate-500">
              {form.first_purchase_bonus_enabled
                ? tx(lang,
                    `Kartda heç vaxt ${earnUnit} olmayıbsa, ilk qazanma çekində +${form.first_purchase_bonus || 0} ${earnUnit} əlavə olunur (bonus 2x və pillə çarpanına düşmür).`,
                    `Если на карте никогда не было ${earnUnit}, к первому чеку добавляется +${form.first_purchase_bonus || 0} ${earnUnit} (бонус не умножается).`,
                    `If the card never held ${earnUnit}, the first earning bill adds +${form.first_purchase_bonus || 0} ${earnUnit} (the bonus is not multiplied).`)
                : tx(lang, 'Söndürülüb — bonus verilmir.', 'Отключено — бонус не начисляется.', 'Disabled — no bonus is granted.')}
            </div>
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, '2x Xal günləri', 'Дни двойных баллов', 'Double points days')}</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {[{ id: 1, az: 'B.E', ru: 'Пн', en: 'Mon' }, { id: 2, az: 'Ç.A', ru: 'Вт', en: 'Tue' }, { id: 3, az: 'Ç', ru: 'Ср', en: 'Wed' }, { id: 4, az: 'C.A', ru: 'Чт', en: 'Thu' }, { id: 5, az: 'C', ru: 'Пт', en: 'Fri' }, { id: 6, az: 'Ş', ru: 'Сб', en: 'Sat' }, { id: 7, az: 'B', ru: 'Вс', en: 'Sun' }].map((d) => (
                <label key={d.id} className={`cursor-pointer rounded-lg px-3 py-1 text-sm font-semibold border ${form.double_points_days.includes(d.id) ? 'border-cyan-300 bg-cyan-500/20 text-cyan-200' : 'border-slate-700 bg-slate-900/50 text-slate-400'}`}>
                  <input type="checkbox" className="hidden" checked={form.double_points_days.includes(d.id)} onChange={(e) => {
                    const next = e.target.checked ? [...form.double_points_days, d.id] : form.double_points_days.filter(x => x !== d.id);
                    setForm(p => ({ ...p, double_points_days: next }));
                  }} />
                  {tx(lang, d.az, d.ru, d.en)}
                </label>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {form.double_points_days.length
                ? tx(lang,
                    'Seçilmiş günlərdə baza qazanma 2 dəfə artır (bonuslar yox, yalnız baza).',
                    'В выбранные дни базовое начисление умножается на 2 (только база, без бонусов).',
                    'On the selected days the base earning is doubled (base only, not bonuses).')
                : tx(lang, 'Heç bir gün seçilməyib — 2x tətbiq olunmur.', 'Дни не выбраны — 2x не применяется.', 'No days selected — 2x is not applied.')}
            </div>
          </div>
          {/* P1.1 keçidi + P1.2 nərdivana istiqamət. Nərdivanın özü aşağıdaki
              ayrı kartda redaktə olunur — burada yalnız qazanmaya təsir edən açar var. */}
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Pillə (tier) çarpanı', 'Множитель уровня', 'Tier multiplier')}</label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.tier_multiplier_enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, tier_multiplier_enabled: e.target.checked }))}
              />
              <span>{tx(lang, 'Müştərinin pilləsi qazanmaya tətbiq olunsun', 'Применять уровень клиента к начислению', 'Apply the customer tier to earning')}</span>
            </label>
            <div className="mt-1 text-xs text-slate-500">
              {tiers.length
                ? tiers
                    .map((t) => `${String(t?.label?.[lang as 'az' | 'ru' | 'en'] || t?.label?.az || t?.key || '?')} ${Number(t?.threshold) || 0}+ ×${Number(t?.multiplier) || 1}`)
                    .join('  ·  ')
                : tx(lang, 'Nərdivan tapılmadı — default pillələr işləyir.', 'Уровни не найдены — работают значения по умолчанию.', 'No ladder found — defaults apply.')}
            </div>
            <div className="text-xs text-slate-500">
              {form.tier_multiplier_enabled
                ? tx(lang,
                    'Çarpan yalnız baza + 2x-dən sonra tətbiq olunur; nəticə aşağıya yuvarlaqlaşdırılır.',
                    'Множитель применяется после базы и 2x; результат округляется вниз.',
                    'The multiplier is applied after base and 2x; the result is rounded down.')
                : tx(lang,
                    'Söndürülüb — bütün müştərilər eyni qazanır. Nərdivan yenə də tətbiqdə görünür.',
                    'Отключено — все клиенты начисляют одинаково. Уровни всё равно видны в приложении.',
                    'Disabled — every customer earns the same. The ladder is still shown in the app.')}
            </div>
            <div className="text-[11px] leading-snug text-slate-500">
              {tx(lang,
                'Pillələrin adı, həddi, rəngi və çarpanı aşağıdaki «Səviyyə nərdivanı» kartından redaktə olunur.',
                'Название, порог, цвет и множитель уровней редактируются в карточке «Уровни» ниже.',
                'Tier names, thresholds, colors and multipliers are edited in the “Loyalty tiers” card below.')}
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={() => { void save(); }} className="glossy-gold rounded-xl px-5 py-2 text-sm font-bold">
            {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
          </button>
        </div>
      </div>

      {/* ── P1.2 — Səviyyə nərdivanı (tier) redaktoru ─────────────────────
          Audit §3.5 / §4.2: nərdivan beş yerdə hardcoded idi və heç birindən
          redaktə olunmurdu. Yazma yeri artıq tək: `customer_app_settings.tiers`. */}
      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-lg font-bold text-slate-100">
          <Star className="text-amber-300" size={18} />
          {tx(lang, 'Səviyyə nərdivanı (tier)', 'Уровни (tier)', 'Loyalty tiers')}
        </div>
        <p className="text-sm text-slate-400">
          {tx(lang,
            'Pillə müştərinin ümumi (lifetime) ulduz sayına görə AVTOMATİK hesablanır — kassir onu əl ilə seçmir. Müştəri tətbiqin ana və profil ekranında öz pilləsini və növbəti pilləyə qalan məsafəni görür.',
            'Уровень вычисляется АВТОМАТИЧЕСКИ по общему (lifetime) количеству звёзд — кассир его не выбирает. Клиент видит свой уровень и остаток до следующего на главном экране и в профиле.',
            'The tier is derived AUTOMATICALLY from the customer’s lifetime stars — the cashier does not pick it. Customers see their tier and the distance to the next one on the home and profile screens.')}
        </p>
        <div className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3 text-[11px] leading-relaxed text-slate-400">
          {tx(lang,
            'Server yadda saxlayarkən: sətirlər həddə görə sıralanır, ən aşağı pillənin həddi məcburi 0 olur (yoxsa yeni müştəri pilləsiz qalar), açarı boş olan sətir atılır, maksimum 12 pillə saxlanılır.',
            'При сохранении сервер: сортирует строки по порогу, принудительно ставит 0 самому нижнему уровню (иначе новый клиент останется без уровня), отбрасывает строки без ключа и хранит максимум 12 уровней.',
            'On save the server sorts rows by threshold, forces the lowest tier to 0 (otherwise a new customer has no tier), drops rows with an empty key, and keeps at most 12 tiers.')}
        </div>
        {tiersFallBackToDefaults ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {tx(lang,
              'Heç bir sətirin açarı yoxdur — bu halda server default nərdivanı (Bürünc / Gümüş / Qızıl) yazacaq.',
              'Ни у одной строки нет ключа — сервер запишет уровни по умолчанию (Бронза / Серебро / Золото).',
              'No row has a key — the server will store the default ladder (Bronze / Silver / Gold).')}
          </div>
        ) : null}
        {emptyKeyCount > 0 && !tiersFallBackToDefaults ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {tx(lang,
              `${emptyKeyCount} sətrin açarı boşdur və saxlanılmayacaq.`,
              `У ${emptyKeyCount} строк пустой ключ — они не сохранятся.`,
              `${emptyKeyCount} row(s) have an empty key and will not be stored.`)}
          </div>
        ) : null}
        {duplicateTierKeys.length ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {tx(lang,
              `Təkrarlanan açar: ${duplicateTierKeys.join(', ')}. Server hər ikisini saxlayır, amma tətbiqdə hansının görünəcəyi həddən asılı olur — açarları unikal edin.`,
              `Дублирующийся ключ: ${duplicateTierKeys.join(', ')}. Сервер сохранит оба, но в приложении покажется тот, что подходит по порогу — сделайте ключи уникальными.`,
              `Duplicate key: ${duplicateTierKeys.join(', ')}. The server keeps both, but which one shows depends on the threshold — make keys unique.`)}
          </div>
        ) : null}
        {lowestTierForcedToZero ? (
          <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-3 text-xs text-cyan-200">
            {tx(lang,
              'Ən aşağı pillənin həddi 0 deyil — server onu save zamanı 0-a endirəcək.',
              'Порог самого нижнего уровня не 0 — сервер выставит 0 при сохранении.',
              'The lowest tier’s threshold is not 0 — the server will set it to 0 on save.')}
          </div>
        ) : null}
        <div className="space-y-2">
          {tiers.map((row, index) => (
            <div key={index} className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span
                  className="h-6 w-6 shrink-0 rounded-full border border-white/20"
                  style={{ backgroundColor: String(row.color || FALLBACK_TIER_COLOR) }}
                />
                <div className="text-sm font-semibold text-slate-200">
                  {String(row.label?.az || row.key || tx(lang, 'Yeni pillə', 'Новый уровень', 'New tier'))}
                </div>
                <button
                  type="button"
                  onClick={() => removeTier(index)}
                  disabled={tiers.length <= 1}
                  title={tiers.length <= 1
                    ? tx(lang, 'Ən azı bir pillə qalmalıdır', 'Должен остаться хотя бы один уровень', 'At least one tier must remain')
                    : tx(lang, 'Pilləni sil', 'Удалить уровень', 'Delete tier')}
                  className="ml-auto rounded-xl border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Açar (key)', 'Ключ (key)', 'Key')}</label>
                  <input
                    className="neon-input"
                    value={String(row.key || '')}
                    placeholder="bronze"
                    onChange={(e) => patchTier(index, { key: slugTierKey(e.target.value) })}
                  />
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Ad (AZ)', 'Название (AZ)', 'Name (AZ)')}</label>
                  <input className="neon-input" value={String(row.label?.az || '')} onChange={(e) => patchTierLabel(index, 'az', e.target.value)} />
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Ad (RU)', 'Название (RU)', 'Name (RU)')}</label>
                  <input className="neon-input" value={String(row.label?.ru || '')} onChange={(e) => patchTierLabel(index, 'ru', e.target.value)} />
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Ad (EN)', 'Название (EN)', 'Name (EN)')}</label>
                  <input className="neon-input" value={String(row.label?.en || '')} onChange={(e) => patchTierLabel(index, 'en', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Hədd (ümumi ulduz)', 'Порог (всего звёзд)', 'Threshold (lifetime stars)')}</label>
                  <input
                    className="neon-input"
                    type="number"
                    min={0}
                    max={1000000}
                    value={String(Number(row.threshold) || 0)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      patchTier(index, { threshold: Number.isFinite(n) ? Math.min(1000000, Math.max(0, Math.trunc(n))) : 0 });
                    }}
                  />
                  {index === 0 ? (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {tx(lang, 'Ən aşağı pillə həmişə 0 olur.', 'Самый нижний уровень всегда 0.', 'The lowest tier is always 0.')}
                    </div>
                  ) : null}
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Qazanma çarpanı', 'Множитель начисления', 'Earn multiplier')}</label>
                  <input
                    className="neon-input"
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={String(Number(row.multiplier) || 0)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      patchTier(index, { multiplier: Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 1 });
                    }}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">
                    {form.tier_multiplier_enabled
                      ? tx(lang, 'Aktivdir.', 'Активно.', 'Active.')
                      : tx(lang, '«Pillə çarpanı» keçidi söndürülüb — hazırda tətbiq olunmur.', 'Переключатель «Множитель уровня» выключен — сейчас не применяется.', 'The “Tier multiplier” switch is off — not applied right now.')}
                  </div>
                </div>
                {/* P1.2c — sahə saxlanılır, amma kassa onu OXUMUR. Nişan olmasa
                    tenant "Qızıl 10% endirim alır" sanar; endirim yığılma qaydası
                    P1.6-dır (`customer.discount_percent` + kampaniya + əl ilə). */}
                <div className="field-stack">
                  <label className="field-label">
                    {tx(lang, 'Pillə endirimi %', 'Скидка уровня %', 'Tier discount %')}
                    <NotAppliedBadge lang={lang} />
                  </label>
                  <input
                    className="neon-input"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={String(Number(row.discount_percent) || 0)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      patchTier(index, { discount_percent: Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0 });
                    }}
                  />
                  <div className="mt-1 text-[11px] leading-snug text-slate-500">
                    {tx(lang,
                      'Dəyər saxlanılır, amma kassada hələ tətbiq olunmur. Satış endirimi müştəri kartındaki endirim faizindən və kampaniyalardan gəlir.',
                      'Значение сохраняется, но на кассе пока не применяется. Скидка в продаже берётся из карточки клиента и кампаний.',
                      'The value is stored but not applied at checkout yet. Sale discounts come from the customer record and campaigns.')}
                  </div>
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Rəng', 'Цвет', 'Color')}</label>
                  <input
                    type="color"
                    className="h-12 w-16 cursor-pointer rounded-lg border border-slate-600 bg-transparent p-1"
                    value={String(row.color || FALLBACK_TIER_COLOR)}
                    onChange={(e) => patchTier(index, { color: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={addTier}
            disabled={tiers.length >= MAX_LOYALTY_TIERS}
            className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-xs font-bold text-slate-200 disabled:opacity-40"
          >
            <Plus size={14} />
            {tx(lang, 'Pillə əlavə et', 'Добавить уровень', 'Add tier')}
          </button>
          <button
            type="button"
            onClick={resetTiers}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300"
          >
            {tx(lang, 'Defaultlara qaytar', 'Сбросить к значениям по умолчанию', 'Reset to defaults')}
          </button>
          <span className="text-xs text-slate-500">
            {tiers.length} / {MAX_LOYALTY_TIERS}
          </span>
        </div>
        {tiersPreview.length ? (
          <div className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3">
            <div className="mb-2 text-sm text-slate-300">
              {tx(lang, 'Save-dən sonra saxlanacaq nərdivan', 'Уровни, которые сохранятся после Save', 'The ladder that will be stored after Save')}
            </div>
            <div className="flex flex-wrap gap-2">
              {tiersPreview.map((row) => (
                <span
                  key={row.key}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-slate-100"
                  style={{ backgroundColor: `${row.color}33`, border: `1px solid ${row.color}` }}
                >
                  {String(row.label?.[lang as 'az' | 'ru' | 'en'] || row.label?.az || row.key)} · {row.threshold}+ · ×{row.multiplier}
                  {Number(row.discount_percent) ? ` · ${row.discount_percent}%` : ''}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex justify-end">
          <button type="button" onClick={() => { void save(); }} className="glossy-gold rounded-xl px-5 py-2 text-sm font-bold">
            {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
          </button>
        </div>
      </div>

      {/* ── P1.3 — Hədiyyə kataloqu ────────────────────────────────────────
          Audit §3.6: "hədiyyə" tək bir ad + hədd sahəsi idi, ona görə tenant
          bir neçə hədiyyə verə bilmirdi. Yazma yeri artıq tək:
          `customer_app_settings.rewards`. */}
      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-lg font-bold text-slate-100">
          <Gift className="text-pink-300" size={18} />
          {tx(lang, 'Hədiyyə kataloqu', 'Каталог наград', 'Reward catalogue')}
        </div>
        <p className="text-sm text-slate-400">
          {tx(lang,
            'Bir neçə hədiyyə təyin edin: hər sətrin öz xal qiyməti, istəyə görə konkret məhsul bağlantısı, aktiv/deaktiv keçidi və stok limiti var. Müştəri tətbiqdə xalı çatan sətri seçib kod alır, kassir kodu satışda yandırır.',
            'Задайте несколько наград: у каждой строки своя цена в баллах, при желании привязка к конкретному товару, переключатель активности и лимит запаса. Клиент выбирает доступную строку в приложении и получает код, кассир списывает его при продаже.',
            'Define several rewards: each row has its own point cost, an optional link to a specific product, an active toggle and a stock limit. The customer picks an affordable row in the app and gets a code that the cashier burns at checkout.')}
        </p>
        <div className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3 text-[11px] leading-relaxed text-slate-400">
          {tx(lang,
            'Server yadda saxlayarkən: sətirlər xal qiymətinə görə sıralanır, id-si boş olan sətir atılır, təkrarlanan id-nin yalnız BİRİNCİSİ saxlanılır (claim-lər id ilə tapılır), maksimum 20 sətir saxlanılır. Stok sayı blobda deyil — verilmiş kodlardan hesablanır.',
            'При сохранении сервер: сортирует строки по цене в баллах, отбрасывает строки с пустым id, из дублирующихся id оставляет только ПЕРВУЮ (заявки находятся по id), хранит максимум 20 строк. Количество запаса не хранится в настройках — считается по выданным кодам.',
            'On save the server sorts rows by point cost, drops rows with an empty id, keeps only the FIRST of duplicate ids (claims resolve by id), and stores at most 20 rows. Stock usage is not stored in settings — it is counted from issued codes.')}
        </div>
        {rewardsPreview.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-3 text-xs text-cyan-200">
            <span className="min-w-0 flex-1">
              {tx(lang,
                `Kataloq boşdur — tətbiq köhnə tək hədiyyəni göstərir: «${String(form.reward_name || 'Reward')}», ${rewardThresholdValue} ${String(form.points_label || 'Ulduz')}. Bu qanuni haldır, sətir əlavə etmək məcburi deyil.`,
                `Каталог пуст — приложение показывает одну старую награду: «${String(form.reward_name || 'Reward')}», ${rewardThresholdValue} ${String(form.points_label || 'Ulduz')}. Это допустимо, добавлять строки не обязательно.`,
                `The catalogue is empty — the app shows the single legacy reward: “${String(form.reward_name || 'Reward')}”, ${rewardThresholdValue} ${String(form.points_label || 'Ulduz')}. That is a valid state; adding rows is optional.`)}
            </span>
            <button
              type="button"
              onClick={seedRewardCatalogFromLegacy}
              className="shrink-0 rounded-xl border border-cyan-300/50 bg-cyan-400/10 px-3 py-1.5 font-bold text-cyan-100"
            >
              {tx(lang, 'Köhnə hədiyyədən sətir yarat', 'Создать строку из старой награды', 'Seed a row from the legacy reward')}
            </button>
          </div>
        ) : null}
        {emptyRewardIdCount > 0 ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {tx(lang,
              `${emptyRewardIdCount} sətrin id-si boşdur — server onları atacaq (tier-dən fərqli: default kataloq yoxdur, sətir sadəcə yox olur).`,
              `У ${emptyRewardIdCount} строк пустой id — сервер их отбросит (в отличие от уровней, каталога по умолчанию нет — строка просто исчезнет).`,
              `${emptyRewardIdCount} row(s) have an empty id — the server will drop them (unlike tiers there is no default catalogue, the row simply disappears).`)}
          </div>
        ) : null}
        {duplicateRewardIds.length ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            {tx(lang,
              `Təkrarlanan id: ${duplicateRewardIds.join(', ')}. Server yalnız birinci sətri saxlayacaq — id-ləri unikal edin.`,
              `Дублирующийся id: ${duplicateRewardIds.join(', ')}. Сервер сохранит только первую строку — сделайте id уникальными.`,
              `Duplicate id: ${duplicateRewardIds.join(', ')}. The server keeps only the first row — make the ids unique.`)}
          </div>
        ) : null}
        {droppedRewardCount > 0 && !emptyRewardIdCount && !duplicateRewardIds.length ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {tx(lang,
              `${droppedRewardCount} sətir saxlanılmayacaq — maksimum ${MAX_LOYALTY_REWARDS} hədiyyə dəstəklənir.`,
              `${droppedRewardCount} строк не сохранится — поддерживается максимум ${MAX_LOYALTY_REWARDS} наград.`,
              `${droppedRewardCount} row(s) will not be stored — at most ${MAX_LOYALTY_REWARDS} rewards are supported.`)}
          </div>
        ) : null}
        {allRewardsInactive ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            {tx(lang,
              'Bütün sətirlər deaktivdir — müştəri “Aktiv hədiyyə yoxdur” xətası alacaq və heç nə tələb edə bilməyəcək.',
              'Все строки неактивны — клиент получит ошибку «Нет активных наград» и не сможет ничего запросить.',
              'Every row is inactive — the customer gets an “no active reward” error and cannot claim anything.')}
          </div>
        ) : null}
        {rewardThresholdMismatch ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <span className="min-w-0 flex-1">
              {tx(lang,
                `Ən ucuz aktiv hədiyyə ${cheapestRewardCost} xaldır, «Reward həddi» isə ${rewardThresholdValue}. Kassa hədd dolduqca pulsuz içkini AVTOMATİK yazır, kataloq isə müştəriyə göstərilən qiymətdir — ikisi fərqli qalarsa müştəri bir rəqəm görüb kassada başqasını eşidəcək.`,
                `Самая дешёвая активная награда — ${cheapestRewardCost} баллов, а «Порог награды» — ${rewardThresholdValue}. Касса начисляет бесплатный напиток АВТОМАТИЧЕСКИ по порогу, каталог — это цена для клиента; при расхождении клиент увидит одно число, а на кассе услышит другое.`,
                `The cheapest active reward costs ${cheapestRewardCost} points while “Reward threshold” is ${rewardThresholdValue}. The till auto-grants the free drink at the threshold, whereas the catalogue is the price shown to the customer — leaving them different means the customer sees one number and hears another at the counter.`)}
            </span>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, reward_threshold: String(cheapestRewardCost) }))}
              className="shrink-0 rounded-xl border border-amber-300/50 bg-amber-400/10 px-3 py-1.5 font-bold text-amber-100"
            >
              {tx(lang, `Həddi ${cheapestRewardCost} et`, `Сделать порог ${cheapestRewardCost}`, `Set threshold to ${cheapestRewardCost}`)}
            </button>
          </div>
        ) : null}
        {orphanRewardLinks > 0 ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {tx(lang,
              `${orphanRewardLinks} sətir menyuda olmayan məhsula bağlıdır. Kassa belə halda köhnə davranışa düşür: endirim səbətin ən ucuz sətrinə tətbiq olunur (kod “yanmadan” qalmasın deyə).`,
              `${orphanRewardLinks} строк привязаны к товару, которого нет в меню. Касса в этом случае возвращается к старому поведению: скидка применяется к самой дешёвой позиции корзины (чтобы код не «сгорел» напрасно).`,
              `${orphanRewardLinks} row(s) point at a product that is no longer on the menu. In that case the till falls back to the old behaviour: the discount lands on the cheapest cart line (so the code is never stuck).`)}
          </div>
        ) : null}
        <div className="space-y-2">
          {rewards.map((row, index) => {
            const rowId = normRewardId(row.id);
            const linkedName = menuItemName(String(row.menu_item_id || ''));
            return (
            <div key={index} className={`rounded-2xl border p-4 space-y-3 ${row.active === false ? 'border-slate-800 bg-slate-900/20 opacity-70' : 'border-slate-700/60 bg-slate-900/40'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Gift size={16} className={row.active === false ? 'text-slate-500' : 'text-pink-300'} />
                <div className="text-sm font-semibold text-slate-200">
                  {String(row.title?.az || rowId || tx(lang, 'Yeni hədiyyə', 'Новая награда', 'New reward'))}
                </div>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                  {Math.max(1, Math.trunc(Number(row.points_cost) || 0))} {String(form.points_label || 'Ulduz')}
                </span>
                {row.menu_item_id ? (
                  <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[10px] font-bold text-cyan-200">
                    <Coffee size={10} className="mr-1 inline" />
                    {linkedName || String(row.menu_item_id)}
                  </span>
                ) : null}
                {Number(row.stock_limit) > 0 ? (
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                    {tx(lang, 'limit', 'лимит', 'limit')} {Math.trunc(Number(row.stock_limit))}
                  </span>
                ) : null}
                <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <input
                    type="checkbox"
                    checked={row.active !== false}
                    onChange={(e) => patchReward(index, { active: e.target.checked })}
                  />
                  <span>{tx(lang, 'Aktiv', 'Активна', 'Active')}</span>
                </label>
                <button
                  type="button"
                  onClick={() => removeReward(index)}
                  title={tx(lang, 'Hədiyyəni sil', 'Удалить награду', 'Delete reward')}
                  className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'id (texniki)', 'id (технический)', 'id (technical)')}</label>
                  <input
                    className="neon-input"
                    value={String(row.id || '')}
                    placeholder="free-latte"
                    onChange={(e) => patchReward(index, { id: normRewardId(e.target.value) })}
                  />
                  <div className="mt-1 text-[11px] leading-snug text-slate-500">
                    {tx(lang,
                      'Verilmiş kodlar bu id ilə bağlanır — dəyişsəniz köhnə kodlar bu sətri tapmaz.',
                      'Выданные коды привязаны к этому id — при изменении старые коды не найдут строку.',
                      'Issued codes are bound to this id — changing it orphans the codes already out there.')}
                  </div>
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Ad (AZ)', 'Название (AZ)', 'Name (AZ)')}</label>
                  <input className="neon-input" value={String(row.title?.az || '')} onChange={(e) => patchRewardText(index, 'title', 'az', e.target.value)} />
                  <div className="mt-1 text-[11px] leading-snug text-slate-500">
                    {tx(lang, 'Boş qalsa server id-ni ad kimi yazır.', 'Если пусто, сервер запишет id как название.', 'If empty the server stores the id as the name.')}
                  </div>
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Ad (RU)', 'Название (RU)', 'Name (RU)')}</label>
                  <input className="neon-input" value={String(row.title?.ru || '')} onChange={(e) => patchRewardText(index, 'title', 'ru', e.target.value)} placeholder={String(row.title?.az || '')} />
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Ad (EN)', 'Название (EN)', 'Name (EN)')}</label>
                  <input className="neon-input" value={String(row.title?.en || '')} onChange={(e) => patchRewardText(index, 'title', 'en', e.target.value)} placeholder={String(row.title?.az || '')} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="field-stack">
                  <label className="field-label">
                    {tx(lang, 'Xal qiyməti', 'Цена в баллах', 'Point cost')}
                  </label>
                  <input
                    className="neon-input"
                    type="number"
                    min={1}
                    max={MAX_REWARD_POINTS_COST}
                    value={String(Number(row.points_cost) || 0)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      patchReward(index, {
                        points_cost: Number.isFinite(n)
                          ? Math.min(MAX_REWARD_POINTS_COST, Math.max(1, Math.trunc(n)))
                          : rewardThresholdValue,
                      });
                    }}
                  />
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Bağlı məhsul', 'Привязанный товар', 'Linked product')}</label>
                  <select
                    className="neon-input"
                    value={String(row.menu_item_id || '')}
                    onChange={(e) => patchReward(index, { menu_item_id: e.target.value })}
                  >
                    <option value="">{tx(lang, 'İstənilən məhsul', 'Любой товар', 'Any product')}</option>
                    {row.menu_item_id && !linkedName ? (
                      <option value={String(row.menu_item_id)}>
                        {String(row.menu_item_id)} — {tx(lang, 'menyuda tapılmadı', 'нет в меню', 'not on the menu')}
                      </option>
                    ) : null}
                    {menuItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.category ? `${item.category} · ` : ''}{item.item_name}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] leading-snug text-slate-500">
                    {row.menu_item_id
                      ? tx(lang,
                          'Kassa endirimi məhz bu məhsula tətbiq edir; səbətdə o məhsul yoxdursa kodu qəbul etmir.',
                          'Касса применит скидку именно к этому товару; если его нет в корзине, код не примется.',
                          'The till applies the discount to this product; if it is not in the cart the code is rejected.')
                      : tx(lang,
                          'Boş = kassa səbətin ən ucuz sətrini pulsuz edir (köhnə davranış).',
                          'Пусто = касса делает бесплатной самую дешёвую позицию корзины (старое поведение).',
                          'Empty = the till makes the cheapest cart line free (legacy behaviour).')}
                  </div>
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'Stok limiti', 'Лимит запаса', 'Stock limit')}</label>
                  <input
                    className="neon-input"
                    type="number"
                    min={0}
                    max={MAX_REWARD_STOCK_LIMIT}
                    value={String(Number(row.stock_limit) || 0)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      patchReward(index, {
                        stock_limit: Number.isFinite(n) ? Math.min(MAX_REWARD_STOCK_LIMIT, Math.max(0, Math.trunc(n))) : 0,
                      });
                    }}
                  />
                  {/* Sayğac ayarların içində saxlanılmır: istifadə olunmuş say
                      `RewardClaim` sətirlərindən (PENDING + REDEEMED) hesablanır.
                      Ona görə limiti azaltmaq artıq verilmiş kodları ləğv etmir. */}
                  <div className="mt-1 text-[11px] leading-snug text-slate-500">
                    {Number(row.stock_limit) > 0
                      ? tx(lang,
                          'Verilmiş kodlar (gözləyən + istifadə olunmuş) sayılır. Limiti azaltsanız artıq verilmiş kodlar qüvvədə qalır, sadəcə yenisi verilmir.',
                          'Считаются выданные коды (ожидающие + использованные). При снижении лимита уже выданные коды остаются в силе, просто новые не выдаются.',
                          'Issued codes (pending + redeemed) count against it. Lowering the limit keeps already issued codes valid, it only stops new ones.')
                      : tx(lang, '0 = limitsiz.', '0 = без лимита.', '0 = unlimited.')}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'İzah (AZ)', 'Описание (AZ)', 'Description (AZ)')}</label>
                  <input className="neon-input" value={String(row.description?.az || '')} onChange={(e) => patchRewardText(index, 'description', 'az', e.target.value)} />
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'İzah (RU)', 'Описание (RU)', 'Description (RU)')}</label>
                  <input className="neon-input" value={String(row.description?.ru || '')} onChange={(e) => patchRewardText(index, 'description', 'ru', e.target.value)} placeholder={String(row.description?.az || '')} />
                </div>
                <div className="field-stack">
                  <label className="field-label">{tx(lang, 'İzah (EN)', 'Описание (EN)', 'Description (EN)')}</label>
                  <input className="neon-input" value={String(row.description?.en || '')} onChange={(e) => patchRewardText(index, 'description', 'en', e.target.value)} placeholder={String(row.description?.az || '')} />
                </div>
              </div>
            </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={addReward}
            disabled={rewards.length >= MAX_LOYALTY_REWARDS}
            className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-xs font-bold text-slate-200 disabled:opacity-40"
          >
            <Plus size={14} />
            {tx(lang, 'Hədiyyə əlavə et', 'Добавить награду', 'Add reward')}
          </button>
          {rewards.length ? (
            <button
              type="button"
              onClick={clearRewardCatalog}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300"
            >
              {tx(lang, 'Kataloqu boşalt', 'Очистить каталог', 'Clear catalogue')}
            </button>
          ) : null}
          <span className="text-xs text-slate-500">
            {rewards.length} / {MAX_LOYALTY_REWARDS}
          </span>
        </div>
        {rewardsPreview.length ? (
          <div className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3">
            <div className="mb-2 text-sm text-slate-300">
              {tx(lang, 'Save-dən sonra saxlanacaq kataloq', 'Каталог, который сохранится после Save', 'The catalogue that will be stored after Save')}
            </div>
            <div className="flex flex-wrap gap-2">
              {rewardsPreview.map((row) => (
                <span
                  key={row.id}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${row.active === false ? 'border-slate-700 bg-slate-900/60 text-slate-500 line-through' : 'border-pink-400/40 bg-pink-400/10 text-pink-100'}`}
                >
                  {String(row.title?.[lang as 'az' | 'ru' | 'en'] || row.title?.az || row.id)} · {row.points_cost} {String(form.points_label || 'Ulduz')}
                  {row.menu_item_id ? ` · ${menuItemName(row.menu_item_id) || row.menu_item_id}` : ''}
                  {row.stock_limit > 0 ? ` · ${tx(lang, 'limit', 'лимит', 'limit')} ${row.stock_limit}` : ''}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex justify-end">
          <button type="button" onClick={() => { void save(); }} className="glossy-gold rounded-xl px-5 py-2 text-sm font-bold">
            {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
          </button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <div className="text-lg font-bold text-slate-100">{tx(lang, 'Kassadakı onboarding QR', 'QR для кассы', 'Cashier onboarding QR')}</div>
        <p className="text-sm text-slate-400">{tx(lang, 'Bu QR-ni çap edib kassaya qoyun. İlk skanda razılaşma çıxacaq, qəbul edən müştəriyə sistem avtomatik unikal QR kart yaradacaq.', 'Распечатайте этот QR и поставьте на кассу. При первом скане покажется согласие, после подтверждения клиенту создастся уникальная QR-карта.', 'Print this QR and place it at the cashier. On first scan the customer sees consent, then gets a unique QR card automatically.')}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            {tx(lang, 'Klub üzvü tipi', 'Тип клубного участника', 'Club member type')}
            <select className="neon-input mt-1" value={form.join_customer_type} onChange={(e) => handleJoinTypeChange(e.target.value)}>
              {CRM_MEMBER_TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            {tx(lang, 'Başlanğıc endirim %', 'Стартовая скидка %', 'Starting discount %')}
            <input className="neon-input mt-1" type="number" min={0} max={100} value={form.join_discount_percent} onChange={(e) => setForm((prev) => ({ ...prev, join_discount_percent: e.target.value }))} />
          </label>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-700/70 bg-white p-5 text-slate-900">
          {joinQr ? <img src={joinQr} alt="join qr" className="h-52 w-52 rounded-2xl" /> : null}
          <div className="text-center text-xs font-semibold text-slate-700">
            {tx(lang, 'CRM tipi', 'CRM тип', 'CRM type')}: {form.join_customer_type} ({form.join_discount_percent}%)
          </div>
          <div className="text-center text-xs text-slate-500">{typeof window !== 'undefined' ? `${window.location.origin}/?join=1&club=${encodeURIComponent(form.join_customer_type)}&discount=${encodeURIComponent(form.join_discount_percent)}` : ''}</div>
          <button type="button" onClick={downloadJoinQr} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
            {tx(lang, 'QR yüklə', 'Скачать QR', 'Download QR')}
          </button>
        </div>
      </div>



      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-lg font-bold text-slate-100"><Calendar size={18} /> {tx(lang, 'Kampaniyalar / Campaigns', 'Кампании / Campaigns', 'Campaigns / Happy Hours')}</div>
        
        <div className="space-y-2">
          {campaigns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700/70 p-4 text-sm text-slate-400">
              {tx(lang, 'Hələ kampaniya yoxdur — aşağıdan əlavə edin.', 'Кампаний пока нет — добавьте ниже.', 'No campaigns yet — add one below.')}
            </div>
          ) : campaigns.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/70 bg-slate-900/40 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-100">{c.name}</span>
                  {!c.is_active ? <span className="rounded-full bg-rose-400/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">İnaktiv</span> : <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Aktiv</span>}
                  <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">{c.discount_percent}% endirim</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  <Clock size={12} className="inline mr-1" /> {c.start_time} - {c.end_time}
                </div>
                <div className="mt-1 flex gap-1">
                   {(Array.isArray(c.days_of_week) ? c.days_of_week : []).map((d: number) => {
                     const dayNames: any = { 1: {az: 'B.E', ru: 'Пн', en: 'Mon'}, 2: {az: 'Ç.A', ru: 'Вт', en: 'Tue'}, 3: {az: 'Ç', ru: 'Ср', en: 'Wed'}, 4: {az: 'C.A', ru: 'Чт', en: 'Thu'}, 5: {az: 'C', ru: 'Пт', en: 'Fri'}, 6: {az: 'Ş', ru: 'Сб', en: 'Sat'}, 7: {az: 'B', ru: 'Вс', en: 'Sun'} };
                     return <span key={d} className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300">{tx(lang, dayNames[d]?.az || '', dayNames[d]?.ru || '', dayNames[d]?.en || '')}</span>;
                   })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => startEditCampaign(c)} className="rounded-xl border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-xs font-bold text-slate-200">
                  {tx(lang, 'Düzəlt', 'Изменить', 'Edit')}
                </button>
                <button type="button" onClick={() => removeCampaign(c.id)} className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-200">
            {editingCampaignId ? tx(lang, 'Kampaniyanı düzəlt', 'Изменить кампанию', 'Edit campaign') : (
              <span className="inline-flex items-center gap-1"><Plus size={14} /> {tx(lang, 'Yeni kampaniya', 'Новая кампания', 'New campaign')}</span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="field-stack form-card md:col-span-2">
              <span className="field-label">{tx(lang, 'Kampaniya adı *', 'Название *', 'Name *')}</span>
              <input className="neon-input" value={campaignForm.name} onChange={(e) => setCampaignForm((p) => ({ ...p, name: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Başlanğıc saat', 'Время начала', 'Start time')}</span>
              <input type="time" className="neon-input" value={campaignForm.start_time} onChange={(e) => setCampaignForm((p) => ({ ...p, start_time: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Bitiş saat', 'Время конца', 'End time')}</span>
              <input type="time" className="neon-input" value={campaignForm.end_time} onChange={(e) => setCampaignForm((p) => ({ ...p, end_time: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Endirim %', 'Скидка %', 'Discount %')}</span>
              <input className="neon-input" type="number" min={0} max={100} value={campaignForm.discount_percent} onChange={(e) => setCampaignForm((p) => ({ ...p, discount_percent: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Kateqoriyalar', 'Категории', 'Categories')}</span>
              <input className="neon-input" value={campaignForm.categories} onChange={(e) => setCampaignForm((p) => ({ ...p, categories: e.target.value }))} />
            </label>
            <div className="field-stack form-card md:col-span-2">
              <span className="field-label">{tx(lang, 'Günlər', 'Дни', 'Days')}</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {[{ id: 1, az: 'B.E', ru: 'Пн', en: 'Mon' }, { id: 2, az: 'Ç.A', ru: 'Вт', en: 'Tue' }, { id: 3, az: 'Ç', ru: 'Ср', en: 'Wed' }, { id: 4, az: 'C.A', ru: 'Чт', en: 'Thu' }, { id: 5, az: 'C', ru: 'Пт', en: 'Fri' }, { id: 6, az: 'Ş', ru: 'Сб', en: 'Sat' }, { id: 7, az: 'B', ru: 'Вс', en: 'Sun' }].map((d) => (
                  <label key={d.id} className={`cursor-pointer rounded-lg px-3 py-1 text-sm font-semibold border ${campaignForm.days_of_week.includes(d.id) ? 'border-cyan-300 bg-cyan-500/20 text-cyan-200' : 'border-slate-700 bg-slate-900/50 text-slate-400'}`}>
                    <input type="checkbox" className="hidden" checked={campaignForm.days_of_week.includes(d.id)} onChange={(e) => {
                      const next = e.target.checked ? [...campaignForm.days_of_week, d.id] : campaignForm.days_of_week.filter(x => x !== d.id);
                      setCampaignForm(p => ({ ...p, days_of_week: next }));
                    }} />
                    {tx(lang, d.az, d.ru, d.en)}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
              <input type="checkbox" checked={campaignForm.is_active} onChange={(e) => setCampaignForm((p) => ({ ...p, is_active: e.target.checked }))} />
              <span>{tx(lang, 'Aktivdir', 'Активно', 'Is active')}</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { void saveCampaign(); }} className="glossy-gold rounded-xl px-5 py-2 text-sm font-bold">
              {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
            </button>
            {editingCampaignId ? (
              <button type="button" onClick={() => { setEditingCampaignId(null); setCampaignForm({ name: '', start_time: '10:00', end_time: '22:00', discount_percent: '10', days_of_week: [1,2,3,4,5], categories: 'ALL', is_active: true }); }} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300">
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-lg font-bold text-slate-100"><MapPin size={18} /> {tx(lang, 'Filiallar', 'Филиалы', 'Branches')}</div>
        <p className="text-sm text-slate-400">{tx(lang, 'Customer app-də göstərilən götürmə mağazaları. Boş olarsa tenant-ın özü istifadə olunur.', 'Магазины выдачи в customer app. Если пусто — используется сам tenant.', 'Pickup stores shown in the customer app. Falls back to the tenant itself when empty.')}</p>

        <div className="space-y-2">
          {branches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700/70 p-4 text-sm text-slate-400">
              {tx(lang, 'Hələ filial yoxdur — aşağıdan əlavə edin.', 'Филиалов пока нет — добавьте ниже.', 'No branches yet — add one below.')}
            </div>
          ) : branches.map((b: any) => (
            <div key={b.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/70 bg-slate-900/40 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-100">{b.name}</span>
                  {b.is_default ? <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">DEFAULT</span> : null}
                  {!b.is_active ? <span className="rounded-full bg-rose-400/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">OFF</span> : null}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-400">
                  {[b.address, b.phone].filter(Boolean).join(' · ') || '—'}
                  {b.latitude != null && b.longitude != null ? ` · ${Number(b.latitude).toFixed(4)}, ${Number(b.longitude).toFixed(4)}` : ''}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{`${b.open_hour ?? 8}:00 – ${b.close_hour ?? 23}:00`}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => startEditBranch(b)} className="rounded-xl border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-xs font-bold text-slate-200">
                  {tx(lang, 'Düzəlt', 'Изменить', 'Edit')}
                </button>
                <button type="button" onClick={() => removeBranch(b.id)} className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-200">
            {editingBranchId ? tx(lang, 'Filialı düzəlt', 'Изменить филиал', 'Edit branch') : (
              <span className="inline-flex items-center gap-1"><Plus size={14} /> {tx(lang, 'Yeni filial', 'Новый филиал', 'New branch')}</span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="field-stack form-card md:col-span-2">
              <span className="field-label">{tx(lang, 'Ad *', 'Название *', 'Name *')}</span>
              <input className="neon-input" value={branchForm.name} onChange={(e) => setBranchForm((p) => ({ ...p, name: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Ünvan', 'Адрес', 'Address')}</span>
              <input className="neon-input" value={branchForm.address} onChange={(e) => setBranchForm((p) => ({ ...p, address: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Telefon', 'Телефон', 'Phone')}</span>
              <input className="neon-input" value={branchForm.phone} onChange={(e) => setBranchForm((p) => ({ ...p, phone: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Enlem (latitude)', 'Широта', 'Latitude')}</span>
              <input className="neon-input" type="number" step="any" value={branchForm.latitude} onChange={(e) => setBranchForm((p) => ({ ...p, latitude: e.target.value }))} placeholder="40.4093" />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Uzunluq (longitude)', 'Долгота', 'Longitude')}</span>
              <input className="neon-input" type="number" step="any" value={branchForm.longitude} onChange={(e) => setBranchForm((p) => ({ ...p, longitude: e.target.value }))} placeholder="49.8671" />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Açılış (saat)', 'Открытие (час)', 'Open (hour)')}</span>
              <input className="neon-input" type="number" min={0} max={23} value={branchForm.open_hour} onChange={(e) => setBranchForm((p) => ({ ...p, open_hour: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Bağlanış (sa)', 'Закрытие (час)', 'Close (hour)')}</span>
              <input className="neon-input" type="number" min={0} max={23} value={branchForm.close_hour} onChange={(e) => setBranchForm((p) => ({ ...p, close_hour: e.target.value }))} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
              <input type="checkbox" checked={branchForm.is_default} onChange={(e) => setBranchForm((p) => ({ ...p, is_default: e.target.checked }))} />
              <span>{tx(lang, 'Default filial (ilk sırada)', 'Филиал по умолчанию (первый)', 'Default branch (listed first)')}</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { void saveBranch(); }} className="glossy-gold rounded-xl px-5 py-2 text-sm font-bold">
              {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
            </button>
            {editingBranchId ? (
              <button type="button" onClick={() => { setEditingBranchId(null); setBranchForm({ name: '', address: '', phone: '', latitude: '', longitude: '', open_hour: '8', close_hour: '23', is_default: false }); }} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300">
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
            ) : null}
          </div>
        </div>
      </div>


      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-lg font-bold text-slate-100"><Sparkles size={18} /> {tx(lang, 'Fun & AI Widgetlər', 'Fun & AI виджеты', 'Fun & AI widgets')}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_qr_card} onChange={(e) => setForm((prev) => ({ ...prev, show_qr_card: e.target.checked }))} />
            <span>{tx(lang, 'QR kartı göstər', 'Показывать QR-карту', 'Show QR card')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_wallet} onChange={(e) => setForm((prev) => ({ ...prev, show_wallet: e.target.checked }))} />
            <span>{tx(lang, 'Balans kartını göstər', 'Показывать баланс', 'Show wallet balance')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_campaigns} onChange={(e) => setForm((prev) => ({ ...prev, show_campaigns: e.target.checked }))} />
            <span>{tx(lang, 'Kampaniyaları göstər', 'Показывать кампании', 'Show campaigns')}</span>
          </label>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-200">{tx(lang, 'Kampaniya yoxlanışı', 'Проверка кампании', 'Campaign validation')}</div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.campaigns_require_online} onChange={(e) => setForm((prev) => ({ ...prev, campaigns_require_online: e.target.checked }))} />
            <span>{tx(lang, 'Skan üçün internet tələb et (offline-da kampaniya bağlanır)', 'Требовать интернет для сканирования (офлайн кампании отключены)', 'Require internet for scans (campaigns disabled offline)')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <span className="shrink-0">{tx(lang, 'Pəncərə (dəq)', 'Окно (мин)', 'Window (min)')}:</span>
            <input className="neon-input w-24" type="number" min={1} value={form.campaign_activation_minutes} onChange={(e) => setForm((prev) => ({ ...prev, campaign_activation_minutes: e.target.value }))} />
            <span className="text-xs text-slate-500">{tx(lang, 'Aktivasiya pəncərəsinin uzunluğu (default 15)', 'Длина окна активации (по умолчанию 15)', 'Activation window length (default 15)')}</span>
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_history} onChange={(e) => setForm((prev) => ({ ...prev, show_history: e.target.checked }))} />
            <span>{tx(lang, 'Tarixçəni göstər', 'Показывать историю', 'Show history')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_notifications} onChange={(e) => setForm((prev) => ({ ...prev, show_notifications: e.target.checked }))} />
            <span>{tx(lang, 'Bildirişləri göstər', 'Показывать уведомления', 'Show notifications')}</span>
            {/* P1.4e — bu açar tətbiqin İÇİNDƏKİ bildiriş siyahısını göstərir;
                telefonа push göndərməyə aşağıdaki "Bildirişlər" bloku baxır. */}
            <span className="text-[11px] text-slate-500">{tx(lang, '(tətbiq içindəki siyahı, push deyil)', '(список внутри приложения, не push)', '(in-app list, not push)')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.ai_barista_enabled} onChange={(e) => setForm((prev) => ({ ...prev, ai_barista_enabled: e.target.checked }))} />
            <span>{tx(lang, 'AI Barista aktiv olsun', 'Включить AI Barista', 'Enable AI Barista')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={form.ai_falci_enabled} onChange={(e) => setForm((prev) => ({ ...prev, ai_falci_enabled: e.target.checked }))} />
            <span>{tx(lang, 'AI Falçı aktiv olsun', 'Включить AI Falçı', 'Enable AI Fortune Teller')}</span>
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={() => { void save(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      {/* ── P1.4e — Bildirişlər (push) ──────────────────────────────────────
          Bu blok tenant-ı platforma env-indən azad edir: öz OneSignal cütünü
          yazır, hadisə/kütləvi bildirişləri ayrıca söndürür, seqment seçib
          alıcı sayını GÖNDƏRMƏDƏN ƏVVƏL görür və nəticəni tarixçədə tapır. */}
      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-lg font-bold text-slate-100">
            <Bell size={18} /> {tx(lang, 'Bildirişlər (Push)', 'Уведомления (Push)', 'Notifications (Push)')}
          </div>
          {pushStatus ? (
            <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${pushStatus.config.ok ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/40 bg-amber-500/10 text-amber-200'}`}>
              {pushStatus.config.ok
                ? tx(lang, `Hazır (${pushStatus.config.source === 'tenant' ? 'öz hesab' : 'platforma'})`, `Готово (${pushStatus.config.source === 'tenant' ? 'свой аккаунт' : 'платформа'})`, `Ready (${pushStatus.config.source === 'tenant' ? 'own account' : 'platform'})`)
                : tx(lang, 'Konfiqurasiya natamam', 'Конфигурация неполная', 'Configuration incomplete')}
            </span>
          ) : null}
        </div>

        {pushStatusError ? (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200">{pushStatusError}</div>
        ) : null}

        {/* Diaqnoz serverdən gəlir — panel öz mətnini uydurmur. */}
        {pushStatus && !pushStatus.config.ok && pushStatus.config.reason ? (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
            {pushStatus.config.reason}
          </div>
        ) : null}

        {pushStatus?.local_mode ? (
          <div className="rounded-xl border border-slate-600 bg-slate-800/60 p-3 text-xs text-slate-300">
            {tx(lang,
              'Lokal (demo) rejim: bildirişlər HEÇ KİMƏ çatmır — göndərmə cəhdi tarixçədə «ötürüldü» kimi yazılır. Real göndərmə üçün backend qoşulmalıdır.',
              'Локальный режим: уведомления никому не доходят — попытка пишется в историю как «пропущено».',
              'Local mode: notifications reach nobody — the attempt is logged as “skipped”.')}
          </div>
        ) : null}

        {pushStatus ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {([
              [tx(lang, 'Abunə', 'Подписки', 'Subscribed'), pushStatus.subscribers.with_token],
              [tx(lang, 'Çatdırıla bilən', 'Доставляемые', 'Deliverable'), pushStatus.subscribers.recipients],
              [tx(lang, 'Çatdırılmayan', 'Недоставляемые', 'Undeliverable'), pushStatus.subscribers.undeliverable],
              [tx(lang, 'Müştəri (cəmi)', 'Клиентов всего', 'Customers total'), pushStatus.subscribers.total],
            ] as Array<[string, number]>).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
                <div className="text-[11px] text-slate-400">{label}</div>
                <div className="text-lg font-bold text-slate-100">{value}</div>
              </div>
            ))}
          </div>
        ) : null}
        {pushStatus?.subscribers.note ? (
          <div className="text-[11px] text-slate-400">{pushStatus.subscribers.note}</div>
        ) : null}

        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-sm font-semibold text-slate-200">{tx(lang, 'OneSignal hesabı', 'Аккаунт OneSignal', 'OneSignal account')}</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-300">
              <span className="block text-xs text-slate-400">App ID</span>
              <input className="neon-input w-full" value={pushForm.onesignal_app_id} placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(e) => setPushForm((prev) => ({ ...prev, onesignal_app_id: e.target.value }))} />
              <span className="block text-[11px] text-slate-500">{tx(lang, 'Brauzer SDK-sı bunu açıq şəkildə istifadə edir — sirr deyil.', 'Браузерный SDK использует его открыто — это не секрет.', 'The browser SDK uses this openly — not a secret.')}</span>
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              <span className="block text-xs text-slate-400">
                REST API {tx(lang, 'açarı', 'ключ', 'key')}
                {pushStatus?.settings.onesignal_rest_api_key_set
                  ? <span className="ml-2 text-emerald-300">{tx(lang, '• yazılıb', '• задан', '• set')}</span>
                  : <span className="ml-2 text-slate-500">{tx(lang, '• boşdur', '• пусто', '• empty')}</span>}
              </span>
              <input className="neon-input w-full" type="password" autoComplete="new-password" value={pushForm.rest_api_key}
                placeholder={tx(lang, 'Dəyişmək üçün yeni açar yaz', 'Введите новый ключ, чтобы изменить', 'Type a new key to change')}
                onChange={(e) => setPushForm((prev) => ({ ...prev, rest_api_key: e.target.value }))} />
              <span className="block text-[11px] text-slate-500">{tx(lang, 'Açar heç vaxt geri göstərilmir. Sahə boş qalsa mövcud açar dəyişmir.', 'Ключ никогда не показывается. Пустое поле не меняет ключ.', 'The key is never shown back. An empty field leaves it unchanged.')}</span>
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={pushForm.enabled} onChange={(e) => setPushForm((prev) => ({ ...prev, enabled: e.target.checked }))} />
              <span>{tx(lang, 'Push aktiv (əsas açar)', 'Push включён (главный)', 'Push enabled (master)')}</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={pushForm.event_push_enabled} onChange={(e) => setPushForm((prev) => ({ ...prev, event_push_enabled: e.target.checked }))} />
              <span>{tx(lang, 'Hadisə bildirişləri', 'Событийные', 'Event pushes')}</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={pushForm.broadcast_enabled} onChange={(e) => setPushForm((prev) => ({ ...prev, broadcast_enabled: e.target.checked }))} />
              <span>{tx(lang, 'Kütləvi bildiriş', 'Массовые', 'Broadcast')}</span>
            </label>
          </div>
          <div className="text-[11px] text-slate-500">
            {tx(lang,
              'Hadisə bildirişləri: satışdan sonra ulduz/keşbek, hədiyyə təsdiqi, sifariş hazırlanır/hazırdır, ad günü. Əsas açar sönülü olsa heç biri getmir.',
              'Событийные: звёзды/кэшбэк после продажи, подтверждение подарка, статус заказа, день рождения.',
              'Event pushes: stars/cashback after a sale, reward claim, order preparing/ready, birthday.')}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm text-slate-300">
              <span className="block text-xs text-slate-400">{tx(lang, 'Gündəlik kütləvi hədd', 'Дневной лимит массовых', 'Daily broadcast limit')}</span>
              <input className="neon-input w-28" type="number" min={0} max={pushStatus?.broadcast.max_daily_limit ?? 20}
                value={pushForm.broadcast_daily_limit}
                onChange={(e) => setPushForm((prev) => ({ ...prev, broadcast_daily_limit: e.target.value }))} />
            </label>
            {/* Hədd 0 = TAM BLOK (limitsiz deyil) — səhv oxunmasın deyə yazılır. */}
            <span className="text-[11px] text-slate-500">
              {tx(lang, '0 yazsanız kütləvi bildiriş tam bağlanır (limitsiz demək deyil).', '0 полностью блокирует массовые (не «без лимита»).', '0 blocks broadcasts entirely (not “unlimited”).')}
              {pushStatus ? ` ${tx(lang, 'Bu gün', 'Сегодня', 'Today')}: ${pushStatus.broadcast.used_today}/${pushStatus.broadcast.daily_limit}` : ''}
            </span>
            <div className="ml-auto flex gap-2">
              {pushStatus?.settings.onesignal_rest_api_key_set ? (
                <button onClick={() => { void clearPushRestKey(); }} disabled={pushSaving}
                  className="rounded-xl border border-rose-400/40 px-4 py-2 text-sm font-semibold text-rose-200 disabled:opacity-50">
                  {tx(lang, 'Açarı sil', 'Удалить ключ', 'Clear key')}
                </button>
              ) : null}
              <button onClick={() => { void savePushSettings(); }} disabled={pushSaving}
                className="glossy-gold rounded-xl px-6 py-2 font-bold disabled:opacity-50">
                {pushSaving ? tx(lang, 'Saxlanır…', 'Сохранение…', 'Saving…') : tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Send size={15} /> {tx(lang, 'Kütləvi bildiriş göndər', 'Отправить массовое уведомление', 'Send a broadcast')}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-300">
              <span className="block text-xs text-slate-400">
                {tx(lang, 'Başlıq', 'Заголовок', 'Title')}
                <span className="ml-1 text-slate-500">{pushCompose.title.length}/{pushStatus?.limits.title ?? 80}</span>
              </span>
              <input className="neon-input w-full" maxLength={pushStatus?.limits.title ?? 80} value={pushCompose.title}
                placeholder={tx(lang, 'Bugün 2 qat ulduz!', 'Сегодня двойные звёзды!', 'Double stars today!')}
                onChange={(e) => setPushCompose((prev) => ({ ...prev, title: e.target.value }))} />
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              <span className="block text-xs text-slate-400">{tx(lang, 'Keçid (istəyə görə)', 'Ссылка (необязательно)', 'Link (optional)')}</span>
              <input className="neon-input w-full" value={pushCompose.url} placeholder="https://…"
                onChange={(e) => setPushCompose((prev) => ({ ...prev, url: e.target.value }))} />
              <span className="block text-[11px] text-slate-500">{tx(lang, 'Yalnız https:// qəbul olunur.', 'Только https://', 'Only https:// is accepted.')}</span>
            </label>
          </div>
          <label className="block space-y-1 text-sm text-slate-300">
            <span className="block text-xs text-slate-400">
              {tx(lang, 'Mətn', 'Текст', 'Body')}
              <span className="ml-1 text-slate-500">{pushCompose.body.length}/{pushStatus?.limits.body ?? 240}</span>
            </span>
            <textarea className="neon-input w-full" rows={2} maxLength={pushStatus?.limits.body ?? 240} value={pushCompose.body}
              placeholder={tx(lang, 'Kafeyə gəl, hər alışa 2 qat ulduz yazılır.', 'Заходите — двойные звёзды за каждую покупку.', 'Drop by — double stars on every purchase.')}
              onChange={(e) => setPushCompose((prev) => ({ ...prev, body: e.target.value }))} />
          </label>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm text-slate-300">
              <span className="block text-xs text-slate-400">{tx(lang, 'Kimə', 'Кому', 'Audience')}</span>
              <select className="neon-input w-full" value={pushCompose.segment}
                onChange={(e) => setPushCompose((prev) => ({ ...prev, segment: e.target.value, value: '' }))}>
                {(pushStatus?.segments || [{ key: 'all', label: tx(lang, 'Hamı', 'Все', 'Everyone') } as any]).map((seg) => (
                  <option key={String(seg.key)} value={String(seg.key)}>{String(seg.label || seg.key)}</option>
                ))}
              </select>
            </label>
            {pushSegment?.needs_value ? (
              <label className="space-y-1 text-sm text-slate-300">
                <span className="block text-xs text-slate-400">{tx(lang, 'Səviyyə', 'Уровень', 'Tier')}</span>
                <select className="neon-input w-full" value={pushCompose.value}
                  onChange={(e) => setPushCompose((prev) => ({ ...prev, value: e.target.value }))}>
                  <option value="">{tx(lang, '— seç —', '— выбрать —', '— select —')}</option>
                  {(pushStatus?.tiers || []).map((t) => (
                    <option key={String(t.key)} value={String(t.key)}>{String((t.label as any) || t.key)}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {pushSegment?.needs_days ? (
              <label className="space-y-1 text-sm text-slate-300">
                <span className="block text-xs text-slate-400">{tx(lang, 'Gün', 'Дней', 'Days')}</span>
                <input className="neon-input w-full" type="number" min={1} max={pushStatus?.limits.max_days ?? 365}
                  value={pushCompose.days} placeholder={String(pushSegment.default_days)}
                  onChange={(e) => setPushCompose((prev) => ({ ...prev, days: e.target.value }))} />
              </label>
            ) : null}
            {pushSegment?.needs_min_stars ? (
              <label className="space-y-1 text-sm text-slate-300">
                <span className="block text-xs text-slate-400">{tx(lang, 'Min. bal', 'Мин. баллов', 'Min. points')}</span>
                <input className="neon-input w-full" type="number" min={1} value={pushCompose.min_stars} placeholder="1"
                  onChange={(e) => setPushCompose((prev) => ({ ...prev, min_stars: e.target.value }))} />
              </label>
            ) : null}
          </div>

          {/* Alıcı sayı. İki rəqəm göstərilir: seqmentə uyğun müştəri və REAL
              çatdırıla bilən — tək rəqəm 412 nəfərə çatacağı illüziyasını verərdi. */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/40 p-3">
            <UserCheck size={16} className="text-slate-400" />
            {pushAudienceError ? (
              <span className="text-sm text-rose-200">{pushAudienceError}</span>
            ) : pushAudienceFresh ? (
              <>
                <span className="text-sm text-slate-200">
                  <b className="text-lg text-slate-50">{pushAudienceFresh.recipients}</b> {tx(lang, 'nəfərə gedəcək', 'получателей', 'recipients')}
                </span>
                <span className="text-[11px] text-slate-400">
                  {tx(lang, 'seqmentə uyğun', 'подходят', 'matched')}: {pushAudienceFresh.matched} · {tx(lang, 'abunə', 'подписаны', 'subscribed')}: {pushAudienceFresh.with_token}
                  {pushAudienceFresh.undeliverable > 0 ? ` · ${tx(lang, 'çatdırılmayan', 'недоставляемые', 'undeliverable')}: ${pushAudienceFresh.undeliverable}` : ''}
                  {pushAudienceFresh.capped ? ` · ${tx(lang, 'hədd tətbiq olundu', 'применён лимит', 'capped')}` : ''}
                </span>
                <span className="text-[11px] text-slate-500">{pushAudienceFresh.label}</span>
              </>
            ) : (
              <span className="text-sm text-slate-400">{pushAudienceBusy ? tx(lang, 'Hesablanır…', 'Считаем…', 'Calculating…') : tx(lang, 'Alıcı sayı hesablanır…', 'Считаем получателей…', 'Counting recipients…')}</span>
            )}
          </div>

          {pushBlocked ? (
            <div className="rounded-xl border border-slate-600 bg-slate-800/50 p-2 text-xs text-slate-300">{pushBlocked}</div>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-2">
              <label className="space-y-1 text-sm text-slate-300">
                <span className="block text-xs text-slate-400">{tx(lang, 'Test: kart nömrəsi', 'Тест: номер карты', 'Test: card number')}</span>
                <input className="neon-input w-40" value={pushTestCard} placeholder="1001"
                  onChange={(e) => setPushTestCard(e.target.value)} />
              </label>
              {/* Test göndərmə `broadcast_enabled`-dan ASILI DEYİL — admin kütləvi
                  açarı qaldırmadan öz kartında yoxlaya bilməlidir. */}
              <button onClick={() => { void sendPushTestNow(); }} disabled={pushTesting || !pushTestCard.trim() || !pushCompose.body.trim()}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-50">
                {pushTesting ? tx(lang, 'Göndərilir…', 'Отправка…', 'Sending…') : tx(lang, 'Test göndər', 'Отправить тест', 'Send test')}
              </button>
            </div>
            <button onClick={() => { void sendPushBroadcast(); }} disabled={pushSending || !!pushBlocked}
              className="glossy-gold rounded-xl px-6 py-2 font-bold disabled:opacity-50">
              {pushSending ? tx(lang, 'Göndərilir…', 'Отправка…', 'Sending…') : tx(lang, 'Hamıya göndər', 'Отправить', 'Send broadcast')}
            </button>
          </div>

          {/* Sonuncu nəticə — «ötürüldü» də göstərilir, çünki o uğur deyil. */}
          {pushLastSend ? (
            <div className={`rounded-xl border p-3 text-xs ${PUSH_STATUS_STYLE[pushLastSend.result.status] || PUSH_STATUS_STYLE.failed}`}>
              <div className="font-semibold">
                {tx(lang, 'Sonuncu göndərmə', 'Последняя отправка', 'Last send')}: {pushLastSend.result.status}
                {' · '}{tx(lang, 'cəhd', 'попытки', 'attempted')}: {pushLastSend.result.attempted}
                {' · '}{tx(lang, 'qəbul', 'принято', 'accepted')}: {pushLastSend.result.accepted}
                {pushLastSend.result.failed ? ` · ${tx(lang, 'uğursuz', 'ошибок', 'failed')}: ${pushLastSend.result.failed}` : ''}
              </div>
              {pushLastSend.result.error ? <div className="mt-1 opacity-90">{pushLastSend.result.error}</div> : null}
            </div>
          ) : null}

        </div>

        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Clock size={15} /> {tx(lang, 'Göndərilmə tarixçəsi', 'История отправок', 'Delivery history')}
            </div>
            <select className="neon-input w-40 text-xs" value={pushHistoryKind} onChange={(e) => setPushHistoryKind(e.target.value)}>
              <option value="">{tx(lang, 'Hamısı', 'Все', 'All')}</option>
              {Object.keys(PUSH_KIND_LABELS).map((k) => (
                <option key={k} value={k}>{tx(lang, PUSH_KIND_LABELS[k][0], PUSH_KIND_LABELS[k][1], PUSH_KIND_LABELS[k][2])}</option>
              ))}
            </select>
            <button onClick={() => { void loadPushHistory(pushHistoryKind); }}
              className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-300">
              {tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
            </button>
            <span className="text-[11px] text-slate-500">{tx(lang, `sonuncu ${PUSH_HISTORY_LIMIT} sətir`, `последние ${PUSH_HISTORY_LIMIT}`, `last ${PUSH_HISTORY_LIMIT} rows`)}</span>
          </div>
          {pushHistory.length === 0 ? (
            <div className="text-xs text-slate-500">{tx(lang, 'Hələ göndərilmə yoxdur.', 'Отправок пока нет.', 'No deliveries yet.')}</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900/90 text-slate-400">
                  <tr>
                    <th className="py-1 pr-2">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
                    <th className="py-1 pr-2">{tx(lang, 'Növ', 'Тип', 'Kind')}</th>
                    <th className="py-1 pr-2">{tx(lang, 'Mətn', 'Текст', 'Message')}</th>
                    <th className="py-1 pr-2">{tx(lang, 'Alıcı', 'Получ.', 'Recip.')}</th>
                    <th className="py-1">{tx(lang, 'Nəticə', 'Результат', 'Result')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pushHistory.map((row) => {
                    const kindLabel = PUSH_KIND_LABELS[String(row.kind)];
                    return (
                      <tr key={String(row.id)} className="border-t border-slate-800 align-top">
                        <td className="py-1.5 pr-2 whitespace-nowrap text-slate-400">
                          {String(row.created_at || '').replace('T', ' ').slice(0, 16)}
                        </td>
                        <td className="py-1.5 pr-2 whitespace-nowrap text-slate-300">
                          {kindLabel ? tx(lang, kindLabel[0], kindLabel[1], kindLabel[2]) : String(row.kind || '')}
                          {row.event ? <span className="block text-[10px] text-slate-500">{String(row.event)}</span> : null}
                          {row.segment ? <span className="block text-[10px] text-slate-500">{String(row.segment)}{row.segment_value ? `:${String(row.segment_value)}` : ''}</span> : null}
                        </td>
                        <td className="py-1.5 pr-2 text-slate-300">
                          <span className="block font-semibold">{String(row.title || '—')}</span>
                          <span className="block text-[10px] text-slate-500">{String(row.body || '')}</span>
                          {row.error ? <span className="block text-[10px] text-amber-300">{String(row.error)}</span> : null}
                        </td>
                        <td className="py-1.5 pr-2 whitespace-nowrap text-slate-300">
                          {Number(row.accepted || 0)}/{Number(row.recipients || 0)}
                          {Number(row.failed || 0) > 0 ? <span className="block text-[10px] text-rose-300">✕{Number(row.failed)}</span> : null}
                        </td>
                        <td className="py-1.5">
                          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${PUSH_STATUS_STYLE[String(row.status)] || PUSH_STATUS_STYLE.failed}`}>
                            {String(row.status || '')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>



      </div>

        </div>

      <div className="lg:col-span-5">
        <div className="sticky top-6 mx-auto max-w-xs">
          <div className="text-xs text-center text-slate-400 mb-2 font-semibold"><Eye size={12} className="inline mb-0.5" /> {tx(lang, 'Canlı Ön Baxış', 'Превью', 'Live Preview')}</div>
          <div className="rounded-[40px] border-[8px] border-slate-700 bg-slate-900 overflow-hidden shadow-2xl relative" style={previewBgStyle}>
            {/* Status bar */}
            <div className="px-4 py-2 flex justify-between text-[9px] text-slate-400">
              <span>9:41</span><span>●●●</span>
            </div>
            {/* Hero — fon artıq gövdədən gəlir (P0.3), hero şəffafdır */}
            <div className="px-4 pt-6 pb-8 text-center">
              {/* P0.4 — `hero_image_url` əvvəl burada dairəvi avatar kimi
                  göstərilirdi; tətbiqdə isə loyallıq kartının fonudur
                  (`HomeTab.tsx:622-624`), ona görə aşağıya köçürüldü. */}
              <div className="text-xs font-black text-white mb-1 drop-shadow-md">{form.app_name || 'Loyalty Club'}</div>
              <div className="text-base font-black text-white leading-tight drop-shadow-md">{form.hero_title}</div>
              <div className="text-[10px] text-white/90 mt-1 drop-shadow-md">{form.hero_subtitle}</div>
              {/* P0.4 — əvvəl burada `registration_mode` nişanı vardı. Tətbiqin
                  ana səhifəsində belə nişan YOXDUR (o ayar yalnız qoşulma
                  ekranındaki sahələri müəyyən edir), ona görə çıxarıldı və
                  çərçivənin altında ayrıca izah kimi verilir. */}
            </div>
            {/* Reward card */}
            <div className="mx-3 -mt-4 mb-3 p-3 shadow-lg relative bg-slate-800" style={{
              ...(form.hero_image_url
                ? {
                    backgroundImage: `linear-gradient(180deg, rgba(26,67,41,0.2), rgba(13,11,10,0.95)), url(${form.hero_image_url})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : { backgroundColor: form.primary_color + '22' }),
              border: `1px solid ${form.primary_color}44`,
              borderRadius: form.reward_card_style === 'rounded' ? '24px' : form.reward_card_style === 'soft-square' ? '12px' : '16px',
              backdropFilter: form.reward_card_style === 'glass' ? 'blur(8px)' : 'none'
            }}>
              <div className="text-[9px] text-slate-300 uppercase tracking-wider">{form.points_label}</div>
              <div className="text-2xl font-black" style={{ color: form.primary_color }}>0</div>
              {/* P0.4 — tətbiqin ana səhifəsində möhür şəbəkəsi `reward_threshold`-dan
                  qurulur (P0.3). Ön baxışda ən təsirli ayar görünmürdü. */}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {Array.from({ length: previewStampCount }).map((_, i) => (
                  <span key={i} className="h-2 w-2 rounded-full border" style={{ borderColor: form.primary_color + '66' }} />
                ))}
                {previewThreshold > previewStampCount ? (
                  <span className="text-[8px] font-bold text-slate-400">+{previewThreshold - previewStampCount}</span>
                ) : null}
              </div>
              <div className="text-[9px] text-slate-400 mt-1">{form.reward_description}</div>
            </div>
            {/* Tab bar — P0.4: real tab siyahısı (`CustomerApp.tsx:1764-1775`).
                Əvvəl burada 4 uydurma emoji vardı (🏠🎁📋👤): nə sayı, nə
                ardıcıllığı tətbiqlə uyğun gəlmirdi. AI tab-ı yalnız Barista və
                ya Falçı açıq olanda görünür — tətbiqdə də eyni şərtlədir. */}
            <div className="flex justify-around py-3 border-t border-slate-700/50 mt-12 bg-slate-900/80">
              {previewTabs.map((tab, i) => (
                <div key={tab.key} className={`flex flex-col items-center gap-0.5 ${i === 0 ? 'text-slate-200' : 'text-slate-500'}`}>
                  {tab.icon}
                  <span className="text-[7px] font-semibold leading-none">{tab.label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* P0.4 — çərçivənin altındaki izahlar: bunlar ana səhifədə deyil,
              başqa ekranlarda təsir edir, ona görə telefonun içində göstərilmir. */}
          <div className="mt-2 space-y-1 text-[10px] leading-snug text-slate-500">
            <div>
              <span className="font-semibold text-slate-400">{tx(lang, 'Qoşulma ekranı:', 'Экран регистрации:', 'Join screen:')}</span>{' '}
              {form.registration_mode === 'simple'
                ? tx(lang, 'yalnız razılıq — ad/email soruşulmur', 'только согласие — без имени/email', 'consent only — no name/email')
                : form.registration_mode === 'lightweight'
                  ? tx(lang, 'ad soruşulur', 'запрашивается имя', 'name is requested')
                  : tx(lang, 'ad + email soruşulur', 'запрашиваются имя и email', 'name + email are requested')}
            </div>
            <div>
              {tx(lang,
                'Ön baxış siz yazdıqca yenilənir. Müştəri tətbiqi yalnız "Yadda saxla"-dan sonra, tətbiq yenidən açıldıqda dəyişir.',
                'Превью обновляется по мере ввода. Клиентское приложение меняется только после «Сохранить» и повторного открытия.',
                'The preview updates as you type. The customer app changes only after Save, on its next open.')}
            </div>
          </div>
        </div>
      </div>

      </div>
    </div>
  );
}
