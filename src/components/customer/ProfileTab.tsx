import React from 'react';
import {
  Bell, Check, CreditCard, Gift, Headphones, HelpCircle,
  LogOut, MessageCircle, MessageSquare, Moon, Pencil, Phone, Shield, Store, Sun, Trash2, TrendingUp, Wallet, X
} from 'lucide-react';
import { tx } from '../../i18n';
import { Haptic } from '../../lib/customer_utils';
import { FALLBACK_TIER_COLOR, fallbackTierLabel } from '../../lib/loyalty';
import { APP_BUILD, APP_VERSION } from '../../lib/app_version';
import SimpleAreaChart from './SimpleAreaChart';

type Props = {
  safeLang: string;
  customer: any;
  notifications: any[];
  history: any[];
  chartData: Array<{ date: string; amount: number }>;
  primaryColor: string;
  isLight?: boolean;
  themeMode?: 'light' | 'dark';
  onToggleTheme?: (mode: 'light' | 'dark') => void;
  setLang: (lang: any) => void;
  markRead: (id: string) => void | Promise<void>;
  designMode?: 'classic' | 'retro';
  onSaveProfile?: (updates: { name?: string; birth_date?: string }) => Promise<void> | void;
  /** F5.5 — App Store 5.1.1: tətbiq daxilində hesab silmə. */
  onDeleteAccount?: () => Promise<void> | void;
  /** E6.1 — sessiyadan çıxış. Möhürlər/balans qalır, yenidən OTP ilə girmək mümkündür. */
  onLogout?: () => Promise<void> | void;
  /** E6.1 — hüquqi səhifə (xarici brauzerdə açılır). */
  onOpenLegal?: (kind: 'privacy' | 'terms') => void;
  /** E6.1 — məxfilik/şərtlər URL-i hələ host olunmayıbsa true → sətir "hazırlanır" göstərir. */
  legalPending?: boolean;
  /** E6.1 — dəstək əlaqəsi (branding-dən gəlir). */
  supportPhone?: string;
  supportAddress?: string;
  companyName?: string;
  /** Cüzdan məlumatı (balans, möhür) — Cüzdan artıq Profilin içindədir. */
  wallet?: any;
  /** Profil "QR göstər" düyməsi — tam ekran QR modalını açır. */
  onShowQr?: () => void;
  /** Seçilmiş filial adı (Kart & ödəniş bölməsində göstərilir). */
  storeName?: string;
  /** Dəstək bölməsindən rəy ekranını açır. */
  onOpenFeedback?: () => void;
  /** P4.1 — kanal razılığı dəyişimi. Uğursuz olsa xəta atır, açar geri qaytarılır. */
  onTogglePref?: (changes: { push?: boolean; email?: boolean; sms?: boolean }) => Promise<void> | void;
};

export default function ProfileTab({
  safeLang, customer, notifications, history, chartData, primaryColor, wallet, onShowQr,
  storeName = '', onOpenFeedback, onTogglePref,
  setLang, markRead, isLight = false, themeMode = 'dark', onToggleTheme,
  designMode = 'classic', onSaveProfile, onDeleteAccount,
  onLogout, onOpenLegal, legalPending = false, supportPhone = '', supportAddress = '', companyName = ''
}: Props) {
  const [editing, setEditing] = React.useState(false);
  const [editName, setEditName] = React.useState('');
  const [editBirth, setEditBirth] = React.useState('');
  const [saveError, setSaveError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState('');
  // E6.1 — çıxış təsdiqi ayrı state-dir: silmə ilə qarışmasın (biri geri
  // qaytarıla bilər, digəri yox).
  const [confirmLogoutOpen, setConfirmLogoutOpen] = React.useState(false);
  // P4.1 — kanal razılığı. Backend-də ÜÇ real sütun var
  // (`push_opt_in`/`email_opt_in`/`sms_opt_in`), ona görə vitrin də üç kanal
  // göstərir: əvvəlki "Sifariş hazırdır / Təkliflər / Möhür" üçlüsü əslində
  // BİR `push_opt_in` sütunu idi, yəni bir açarı söndürmək digərini də
  // söndürərdi — istifadəçiyə yalan vəd.
  const sessionPrefs = (customer as any)?.push_prefs;
  const [prefs, setPrefs] = React.useState<{ [k: string]: boolean }>(() => ({
    push: sessionPrefs?.push !== false,
    email: sessionPrefs?.email === true,
    sms: sessionPrefs?.sms === true,
    autoTopUp: true,
  }));
  const [prefsError, setPrefsError] = React.useState('');
  // Sessiya asinxron gəlir (`push_prefs` sonradan dolur) — mount-da oxunan
  // dəyər köhnə qala bilər, ona görə server dəyişəndə açarları yeniləyirik.
  React.useEffect(() => {
    if (!sessionPrefs) return;
    setPrefs((p) => ({
      ...p,
      push: sessionPrefs.push !== false,
      email: sessionPrefs.email === true,
      sms: sessionPrefs.sms === true,
    }));
  }, [sessionPrefs?.push, sessionPrefs?.email, sessionPrefs?.sms]);
  const todayIso = new Date().toISOString().split('T')[0];

  // P4.1 — açar dəyişəndə serverə yaz (valideyn `onTogglePref` ilə, çünki
  // sessiya tokeni orada yaşayır). Uğursuz yazma seçimi geri qaytarır ki, UI
  // ilə server səssizcə ayrılmasın. `autoTopUp` hələ serverdə yoxdur — lokal qalır.
  const togglePref = async (key: 'push' | 'email' | 'sms', next: boolean) => {
    const before = prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    setPrefsError('');
    try {
      if (next) await Haptic.light();
      else await Haptic.medium();
      await onTogglePref?.({ [key]: next });
    } catch (e: any) {
      setPrefs((p) => ({ ...p, [key]: before }));
      setPrefsError(String(e?.message || tx(safeLang, 'Yadda saxlanmadı', 'Не сохранено', 'Could not save')));
      await Haptic.error();
    }
  };

  const startEdit = () => {
    setEditName(String(customer?.name || ''));
    setEditBirth(String(customer?.birth_date || ''));
    setSaveError('');
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const updates: { name?: string; birth_date?: string } = {};
      const newName = editName.trim();
      const newBirth = editBirth.trim();
      if (newName && newName !== String(customer?.name || '')) updates.name = newName;
      if (newBirth !== String(customer?.birth_date || '')) updates.birth_date = newBirth;
      if (onSaveProfile) await onSaveProfile(updates);
      setEditing(false);
      await Haptic.success();
    } catch (e: any) {
      setSaveError(String(e?.message || tx(safeLang, 'Yadda saxlanmadı', 'Не удалось сохранить', 'Could not save')));
      await Haptic.error();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!onDeleteAccount) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDeleteAccount();
      await Haptic.success();
    } catch (e: any) {
      setDeleteError(String(e?.message || tx(safeLang, 'Hesab silinə bilmədi', 'Не удалось удалить аккаунт', 'Could not delete account')));
      await Haptic.error();
      setConfirmDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  // E6.1 — çıxış. Backend çağırışı yoxdur: sessiya lokal silinir, möhürlər və
  // balans serverdə qalır (istifadəçi OTP ilə geri qayıdır).
  const confirmLogout = async () => {
    if (!onLogout) return;
    setConfirmLogoutOpen(false);
    await Haptic.success();
    await onLogout();
  };

  const inputCls = isLight
    ? 'w-full rounded-xl border border-black/10 bg-white/80 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#F48C24]/40'
    : 'w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-[#F48C24]/40';

  const textPrimary  = isLight ? 'text-[#16120e]' : 'text-[#f5f1ea]';

  const tier: any = customer?.tier || null;
  const tierColor = String(tier?.color || FALLBACK_TIER_COLOR);
  const tierLabel = (tier?.label?.[safeLang] as string) || tier?.label?.en || customer?.type || fallbackTierLabel(safeLang);

  const unreadCount = notifications.filter((n: any) => !n.is_read).length;
  const walletStars = Number(wallet?.stars_balance ?? 0);
  const last4 = String(customer?.card_id || '').slice(-4);
  const joinedYear = customer?.created_at ? new Date(customer.created_at).getFullYear() : null;

  // Sətir ikonu — referansdakı 28x28 yumşaq kvadrat (.si)
  const Si = ({ tone = '', children }: { tone?: '' | 'orange' | 'green' | 'blue' | 'red'; children: React.ReactNode }) => (
    <span className={`cust-si ${tone}`}>{children}</span>
  );

  return (
    <div className={`space-y-6 ${isLight ? '' : 'cust-dark'}`}>
      {/* v3 .pbg — fon indi CustomerApp şell-ində, tab keçidində dəyişir. */}

      {/* ── Şəxsi kart (.mecard) ─────────────────────────────── */}
      <section className="cust-mecard cust-glass">
        <div className="cust-top">
          <div className="cust-ava">
            {customer?.name ? String(customer.name).charAt(0).toUpperCase() : 'M'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={`cust-nm ${textPrimary} truncate`}>
              {customer.name || tx(safeLang, 'Müştəri', 'Клиент', 'Customer')}
            </div>
            <div className="cust-ph">{customer.card_id}</div>
            <span className="cust-tier" style={{ background: `${tierColor}26`, color: tierColor }}>
              {tierLabel}
            </span>
          </div>
          <div className="cust-id">
            № {last4}
            {joinedYear && (<><br />{joinedYear}-dən</>)}
          </div>
        </div>
      </section>

      {/* ── Statistika (.stats) ──────────────────────────────── */}
      <div className="cust-stats">
        {[
          { value: walletStars, label: tx(safeLang, 'Möhür', 'Штампы', 'Stamps') },
          { value: `${walletStars}.00`, label: tx(safeLang, 'Balans ₼', 'Баланс ₼', 'Balance ₼') },
          { value: Number(wallet?.coupons_count ?? 0), label: tx(safeLang, 'Kupon', 'Купоны', 'Coupons') },
        ].map((s, i) => (
          <div key={i} className="cust-stat cust-glass">
            <span className={`sv2 ${textPrimary}`}>{s.value}</span>
            <span className="sl2">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Əsas düymələr (.quick) ───────────────────────────── */}
      <div className="cust-quick">
        <button type="button" className="cust-pill solid"
          onClick={async () => { await Haptic.light(); onShowQr?.(); }}>
          {tx(safeLang, 'QR göstər', 'Показать QR', 'Show QR')}
        </button>
        <button type="button" className="cust-pill ghost">
          {tx(safeLang, 'Wallet-ə əlavə et', 'В Wallet', 'Add to Wallet')}
        </button>
      </div>

      {/* ── Hesab ────────────────────────────────────────────── */}
      <div className="cust-secttl">{tx(safeLang, 'Hesab', 'Аккаунт', 'Account')}</div>
      <div className="cust-grp cust-glass">
        <button type="button" className="cust-srow" onClick={startEdit}>
          <Si tone="blue"><Pencil size={14} /></Si>
          <span className="cust-sm">
            <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Ad və doğum tarixi', 'Имя и дата рождения', 'Name & birth date')}</span>
            <span className="cust-sd">
              {customer.name || '—'}
              {customer.birth_date ? ` · ${customer.birth_date}` : ''}
            </span>
          </span>
          <span className="cust-ch">›</span>
        </button>
        <div className="cust-srow" style={{ cursor: 'default' }}>
          <Si tone="blue"><Phone size={14} /></Si>
          <span className="cust-sm">
            <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Telefon nömrəsi', 'Номер телефона', 'Phone number')}</span>
            <span className="cust-sd">{tx(safeLang, 'Dəyişmək üçün SMS kodu tələb olunur', 'Для смены нужен SMS-код', 'Changing requires an SMS code')}</span>
          </span>
        </div>
        <div className="cust-srow" style={{ cursor: 'default' }}>
          <Si><CreditCard size={14} /></Si>
          <span className="cust-sm">
            <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Üzvlük kartı', 'Карта лояльности', 'Membership card')}</span>
            <span className="cust-sd">{tx(safeLang, 'Kassada göstər və ya skan et', 'Покажите на кассе', 'Show or scan at the counter')}</span>
          </span>
          <span className="cust-sv">№ {last4}</span>
        </div>
      </div>

      {/* Ad / doğum tarixi redaktəsi */}
      {editing && (
        <div className="cust-grp cust-glass" style={{ padding: 16 }}>
          <div className="space-y-3">
            <div>
              <label className="cust-sd" style={{ marginBottom: 6, display: 'block' }}>
                {tx(safeLang, 'Adınız', 'Ваше имя', 'Your name')}
              </label>
              <input type="text" maxLength={60} value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={tx(safeLang, 'Məs. Aysel', 'Напр. Айсель', 'e.g. Aysel')}
                className={inputCls} />
            </div>
            <div>
              <label className="cust-sd" style={{ marginBottom: 6, display: 'block' }}>
                {tx(safeLang, 'Doğum tarixi (istəyə bağlı — boş buraxın silmək üçün)', 'Дата рождения (необязательно — оставьте пустым, чтобы удалить)', 'Birth date (optional — leave empty to remove)')}
              </label>
              <input type="date" value={editBirth} max={todayIso}
                onChange={(e) => setEditBirth(e.target.value)}
                className={inputCls} />
            </div>
            {saveError && <p className="text-xs text-rose-400">{saveError}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button type="button" disabled={saving} onClick={saveEdit}
                className="flex items-center gap-1.5 rounded-xl bg-[#F48C24] px-4 py-2 text-xs font-bold text-white transition active:scale-95 disabled:opacity-50">
                <Check size={12} />
                {saving ? '...' : tx(safeLang, 'Yadda saxla', 'Сохранить', 'Save')}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition active:scale-95 ${isLight ? 'border-black/10 text-slate-600' : 'border-white/10 text-white/60'}`}>
                <X size={12} />
                {tx(safeLang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tətbiq görünüşü (.seginrow) ──────────────────────── */}
      <div className="cust-secttl">{tx(safeLang, 'Tətbiq görünüşü', 'Внешний вид', 'App appearance')}</div>
      <div className="cust-grp cust-glass">
        {onToggleTheme && (
          <div className="cust-seginrow">
            <span className="sl">
              <b className={textPrimary}>{tx(safeLang, 'Görünüş', 'Тема', 'Appearance')}</b>
              <span>{isLight ? tx(safeLang, 'İşıqlı tema', 'Светлая тема', 'Light theme') : tx(safeLang, 'Qaranlıq tema', 'Тёмная тема', 'Dark theme')}</span>
            </span>
            <div className="cust-seg cust-glass--inline">
              <button type="button" aria-selected={isLight}
                onClick={async () => { await Haptic.light(); onToggleTheme('light'); }}
                className="flex items-center justify-center"><Sun size={13} /></button>
              <button type="button" aria-selected={!isLight}
                onClick={async () => { await Haptic.light(); onToggleTheme('dark'); }}
                className="flex items-center justify-center"><Moon size={13} /></button>
            </div>
          </div>
        )}
        <div className="cust-seginrow">
          <span className="sl">
            <b className={textPrimary}>{tx(safeLang, 'Dil', 'Язык', 'Language')}</b>
            <span>{safeLang === 'az' ? 'Azərbaycan dili' : safeLang === 'ru' ? 'Русский язык' : 'English'}</span>
          </span>
          <div className="cust-seg cust-glass--inline">
            {(['az', 'en', 'ru'] as const).map((l) => (
              <button key={l} type="button" aria-selected={safeLang === l}
                onClick={async () => { await Haptic.light(); setLang(l); }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bildirişlər ──────────────────────────────────────── */}
      <div className="cust-secttl flex items-center gap-2">
        {tx(safeLang, 'Bildirişlər', 'Уведомления', 'Notifications')}
        {unreadCount > 0 && (
          <span className="rounded-full bg-[#F48C24] px-1.5 py-0.5 text-[9px] font-bold text-white not-italic tracking-normal">
            {unreadCount}
          </span>
        )}
      </div>
      <div className="cust-grp cust-glass">
        {/* iOS açar (.sw). Üç kanal = backend-dəki üç sütun
            (`push_opt_in` / `email_opt_in` / `sms_opt_in`). */}
        {([
          { key: 'push' as const, icon: <Bell size={14} />, sn: tx(safeLang, 'Push bildirişləri', 'Push-уведомления', 'Push notifications'), sd: tx(safeLang, 'Sifariş, möhür və kampaniya xəbərləri tətbiqdə', 'Заказы, штампы и акции в приложении', 'Orders, stamps and offers in the app') },
          { key: 'email' as const, icon: <Gift size={14} />, sn: tx(safeLang, 'E-poçt təklifləri', 'Предложения по e-mail', 'Email offers'), sd: tx(safeLang, 'Kampaniyaları e-poçtla al', 'Получать кампании на e-mail', 'Get campaigns by email') },
          { key: 'sms' as const, icon: <MessageCircle size={14} />, sn: tx(safeLang, 'SMS təklifləri', 'Предложения по SMS', 'SMS offers'), sd: tx(safeLang, 'Kampaniyaları SMS-lə al', 'Получать кампании по SMS', 'Get campaigns by SMS') },
        ]).map((row) => (
          <div key={row.key} className="cust-srow" style={{ cursor: 'default' }}>
            <span className="cust-si orange">{row.icon}</span>
            <span className="cust-sm">
              <span className={`cust-sn ${textPrimary}`}>{row.sn}</span>
              <span className="cust-sd">{row.sd}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[row.key]}
              aria-label={row.sn}
              className="cust-sw"
              onClick={() => void togglePref(row.key, !prefs[row.key])}
            />
          </div>
        ))}
        {prefsError && (
          <div className="cust-srow" style={{ cursor: 'default' }}>
            <Si tone="red"><X size={14} /></Si>
            <span className="cust-sm">
              <span className="cust-sd" style={{ color: '#ef4444' }}>{prefsError}</span>
            </span>
          </div>
        )}
      </div>

      {/* Bildiriş jurnalı — gələn mesajlar */}
      <div className="cust-secttl">{tx(safeLang, 'Gələn bildirişlər', 'Входящие уведомления', 'Inbox')}</div>
      <div className="cust-grp cust-glass">
        {notifications.length === 0 ? (
          <div className="cust-srow" style={{ cursor: 'default' }}>
            <Si tone="orange"><Bell size={14} /></Si>
            <span className="cust-sm">
              <span className="cust-sd">{tx(safeLang, 'Yeni bildiriş yoxdur', 'Нет новых уведомлений', 'No new notifications')}</span>
            </span>
          </div>
        ) : notifications.map((row: any) => (
          <button key={row.id} type="button"
            onClick={async () => { await Haptic.light(); if (!row.is_read) void markRead(row.id); }}
            className="cust-srow">
            <Si tone="orange">{row.is_read ? <Bell size={14} /> : <span className="h-2 w-2 rounded-full bg-[#F48C24]" />}</Si>
            <span className="cust-sm">
              <span className={`cust-sn ${textPrimary}`} style={{ whiteSpace: 'normal' }}>{row.message}</span>
              <span className="cust-sd">{new Date(row.created_at).toLocaleString()}</span>
            </span>
            {!row.is_read && <span className="cust-ch">›</span>}
          </button>
        ))}
      </div>

      {/* ── Kart & ödəniş ────────────────────────────────────── */}
      <div className="cust-secttl">{tx(safeLang, 'Kart və ödəniş', 'Карта и оплата', 'Card & payment')}</div>
      <div className="cust-grp cust-glass">
        <div className="cust-srow" style={{ cursor: 'default' }}>
          <Si tone="green"><Store size={14} /></Si>
          <span className="cust-sm">
            <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Sevimli filial', 'Любимый филиал', 'Favourite branch')}</span>
            <span className="cust-sd">{tx(safeLang, 'Sifarişlər üçün default filial', 'Филиал по умолчанию', 'Default branch for orders')}</span>
          </span>
          <span className="cust-sv">{storeName || '—'}</span>
          <span className="cust-ch">›</span>
        </div>
        <div className="cust-srow" style={{ cursor: 'default' }}>
          <Si tone="green"><Wallet size={14} /></Si>
          <span className="cust-sm">
            <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Apple Wallet kartı', 'Карта Apple Wallet', 'Apple Wallet pass')}</span>
            <span className="cust-sd">{tx(safeLang, 'Loyallıq kartını Wallet-ə əlavə et', 'Добавить карту в Wallet', 'Add the loyalty card to Wallet')}</span>
          </span>
          <span className="cust-sv">{tx(safeLang, 'Əlavə et', 'Добавить', 'Add')}</span>
          <span className="cust-ch">›</span>
        </div>
        <div className="cust-srow" style={{ cursor: 'default' }}>
          <Si tone="green"><CreditCard size={14} /></Si>
          <span className="cust-sm">
            <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Balans avtomatik artırma', 'Автопополнение баланса', 'Auto top-up balance')}</span>
            <span className="cust-sd">{tx(safeLang, '12 ₼-dən aşağı düşəndə xatırlat', 'Напомним при балансе ниже 12 ₼', 'Remind when below 12 ₼')}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.autoTopUp}
            aria-label={tx(safeLang, 'Balans avtomatik artırma', 'Автопополнение баланса', 'Auto top-up balance')}
            className="cust-sw"
            onClick={async () => { await Haptic.light(); setPrefs((p) => ({ ...p, autoTopUp: !p.autoTopUp })); }}
          />
        </div>
      </div>

      {/* ── Alış dinamikası ──────────────────────────────────── */}
      {chartData.length > 1 && (
        <div className="cust-grp cust-glass" style={{ padding: 18 }}>
          <div className={`mb-3 flex items-center gap-2 text-[13px] font-semibold ${textPrimary}`}>
            <TrendingUp size={15} className="text-emerald-500" />
            {tx(safeLang, 'Alış dinamikası', 'Динамика покупок', 'Purchase dynamics')}
          </div>
          <SimpleAreaChart data={chartData} primaryColor={primaryColor} safeLang={safeLang} />
        </div>
      )}

      {/* ── Sifariş tarixçəsi ────────────────────────────────── */}
      <div className="cust-secttl">{tx(safeLang, 'Sifariş tarixçəsi', 'История заказов', 'Order history')}</div>
      <div className="cust-grp cust-glass">
        {history.length === 0 ? (
          <div className="cust-srow" style={{ cursor: 'default' }}>
            <Si><Gift size={14} /></Si>
            <span className="cust-sm">
              <span className="cust-sd">{tx(safeLang, 'Hələ sifariş tarixçəsi yoxdur', 'История покупок пока пуста', 'No purchase history yet')}</span>
            </span>
          </div>
        ) : history.map((row: any) => {
          const formattedDate = new Date(row.created_at).toLocaleDateString(
            safeLang === 'az' ? 'az-AZ' : safeLang === 'ru' ? 'ru-RU' : 'en-US',
            { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
          );
          const itemsCount = (row.items || []).reduce((n: number, i: any) => n + Number(i.qty || 1), 0);
          return (
            <div key={row.id} className="cust-srow" style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <Si><Gift size={14} /></Si>
              <span className="cust-sm">
                <span className={`cust-sn ${textPrimary}`}>{formattedDate}</span>
                <span className="cust-sd" style={{ whiteSpace: 'normal' }}>
                  {itemsCount} {tx(safeLang, 'məhsul', 'поз.', 'items')} · {row.payment_method}
                </span>
              </span>
              <span className="cust-sv" style={{ maxWidth: 80, color: '#F48C24', fontWeight: 700 }}>
                ₼ {Number(row.total || 0).toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Dəstək ───────────────────────────────────────────── */}
      <div className="cust-secttl">{tx(safeLang, 'Dəstək', 'Поддержка', 'Support')}</div>
      <div className="cust-grp cust-glass">
        {companyName && (
          <div className="cust-srow" style={{ cursor: 'default' }}>
            <Si><Store size={14} /></Si>
            <span className="cust-sm">
              <span className={`cust-sn ${textPrimary}`}>{companyName}</span>
              {supportAddress && <span className="cust-sd">{supportAddress}</span>}
            </span>
          </div>
        )}
        {supportPhone && (
          <a href={`tel:${supportPhone.replace(/\s+/g, '')}`}
            onClick={async () => { await Haptic.light(); }}
            className="cust-srow">
            <Si><Headphones size={14} /></Si>
            <span className="cust-sm">
              <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Bizimlə əlaqə', 'Связаться с нами', 'Contact us')}</span>
              <span className="cust-sd">{supportPhone}</span>
            </span>
            <span className="cust-sv">{tx(safeLang, 'Zəng et', 'Позвонить', 'Call')}</span>
            <span className="cust-ch">›</span>
          </a>
        )}
        <div className="cust-srow" style={{ cursor: 'default' }}>
          <Si><HelpCircle size={14} /></Si>
          <span className="cust-sm">
            <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Tez-tez verilən suallar', 'Частые вопросы', 'FAQ')}</span>
            <span className="cust-sd">{tx(safeLang, 'Möhür, balans, sifariş necə işləyir', 'Как работают штампы, баланс, заказы', 'How stamps, balance and orders work')}</span>
          </span>
          <span className="cust-ch">›</span>
        </div>
        {onOpenFeedback && (
          <button type="button" className="cust-srow"
            onClick={async () => { await Haptic.light(); onOpenFeedback(); }}>
            <Si><MessageSquare size={14} /></Si>
            <span className="cust-sm">
              <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Rəy göndər', 'Отправить отзыв', 'Send feedback')}</span>
              <span className="cust-sd">{tx(safeLang, 'Təklifiniz var? Yazın', 'Есть предложение? Напишите', 'Have a suggestion? Tell us')}</span>
            </span>
            <span className="cust-ch">›</span>
          </button>
        )}
      </div>

      {/* ── Hüquqi ───────────────────────────────────────────── */}
      <div className="cust-secttl">{tx(safeLang, 'Hüquqi', 'Правовая информация', 'Legal')}</div>
      <div className="cust-grp cust-glass">
        {([
          { kind: 'privacy' as const, label: tx(safeLang, 'Məxfilik siyasəti', 'Политика конфиденциальности', 'Privacy policy') },
          { kind: 'terms' as const, label: tx(safeLang, 'İstifadə şərtləri', 'Условия использования', 'Terms of use') },
        ]).map(({ kind, label }) => {
          const disabled = legalPending || !onOpenLegal;
          return (
            <button key={kind} type="button" disabled={disabled}
              onClick={async () => { await Haptic.light(); onOpenLegal?.(kind); }}
              className="cust-srow">
              <Si><Shield size={14} /></Si>
              <span className="cust-sm">
                <span className={`cust-sn ${textPrimary}`}>{label}</span>
              </span>
              {disabled && <span className="cust-sv">{tx(safeLang, 'hazırlanır', 'готовится', 'pending')}</span>}
              <span className="cust-ch">›</span>
            </button>
          );
        })}
      </div>
      <p className="cust-verfoot">
        {companyName || 'Emalat Coffee'} · {APP_VERSION} ({APP_BUILD})
      </p>

      {/* ── Hesab əməliyyatları ──────────────────────────────── */}
      {(onLogout || onDeleteAccount) && (
        <div className="cust-secttl">{tx(safeLang, 'Hesab əməliyyatları', 'Действия с аккаунтом', 'Account actions')}</div>
      )}
      <div className="cust-grp cust-glass" style={{ marginBottom: 8 }}>
        {onLogout && (
          <button type="button" className="cust-srow" onClick={() => setConfirmLogoutOpen(!confirmLogoutOpen)}>
            <Si><LogOut size={14} /></Si>
            <span className="cust-sm">
              <span className={`cust-sn ${textPrimary}`}>{tx(safeLang, 'Çıxış', 'Выйти', 'Sign out')}</span>
              <span className="cust-sd">{tx(safeLang, 'Möhürləriniz və balansınız qalır', 'Штампы и баланс сохранятся', 'Your stamps and balance stay')}</span>
            </span>
            <span className="cust-ch">›</span>
          </button>
        )}
        {onDeleteAccount && (
          <button type="button" className="cust-srow cust-danger" onClick={() => { setDeleteError(''); setConfirmDeleteOpen(!confirmDeleteOpen); }}>
            <Si tone="red"><Trash2 size={14} /></Si>
            <span className="cust-sm">
              <span className="cust-sn">{tx(safeLang, 'Hesabı sil', 'Удалить аккаунт', 'Delete account')}</span>
              <span className="cust-sd">{tx(safeLang, 'Geri qaytarıla bilməz', 'Нельзя отменить', 'Cannot be undone')}</span>
            </span>
            <span className="cust-ch">›</span>
          </button>
        )}
      </div>

      {/* Çıxış təsdiqi */}
      {confirmLogoutOpen && onLogout && (
        <div className="cust-grp cust-glass" style={{ padding: 16, marginTop: -12 }}>
          <p className={`text-[12px] font-semibold ${textPrimary}`}>
            {tx(safeLang, 'Çıxış etmək istədiyinizə əminsiniz?', 'Вы уверены, что хотите выйти?', 'Are you sure you want to sign out?')}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirmLogoutOpen(false)}
              className={`flex-1 rounded-xl py-2 text-[12px] font-bold ${isLight ? 'bg-black/5 text-slate-700' : 'bg-white/10 text-white'}`}>
              {tx(safeLang, 'Ləğv et', 'Отмена', 'Cancel')}
            </button>
            <button type="button" onClick={confirmLogout}
              className="flex-1 rounded-xl bg-[#F48C24] py-2 text-[12px] font-bold text-white transition active:scale-[0.98]">
              {tx(safeLang, 'Bəli, çıxış et', 'Да, выйти', 'Yes, sign out')}
            </button>
          </div>
        </div>
      )}

      {/* Silmə təsdiqi */}
      {confirmDeleteOpen && onDeleteAccount && !deleting && (
        <div className="cust-grp cust-glass" style={{ padding: 16, marginTop: -12 }}>
          <p className={`text-[12px] font-semibold ${textPrimary}`}>
            {tx(safeLang, 'Hesabınızı silmək istədiyinizə əminsiniz? Bu əməliyyat geri qaytarıla bilməz.',
              'Вы уверены, что хотите удалить аккаунт? Это действие нельзя отменить.',
              'Are you sure you want to delete your account? This cannot be undone.')}
          </p>
          {deleteError && <p className="mt-2 text-[11px] text-red-500">{deleteError}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirmDeleteOpen(false)}
              className={`flex-1 rounded-xl py-2 text-[12px] font-bold ${isLight ? 'bg-black/5 text-slate-700' : 'bg-white/10 text-white'}`}>
              {tx(safeLang, 'Ləğv et', 'Отмена', 'Cancel')}
            </button>
            <button type="button" onClick={confirmDelete}
              className="flex-1 rounded-xl bg-red-500 py-2 text-[12px] font-bold text-white transition active:scale-[0.98]">
              {tx(safeLang, 'Bəli, sil', 'Да, удалить', 'Yes, delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
