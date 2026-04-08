import React from 'react';
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  ChartColumnBig,
  ChefHat,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  QrCode,
  Receipt,
  ShieldCheck,
  Store,
  Table2,
  Users,
  Wallet,
} from 'lucide-react';
import { get_public_landing_settings_live } from '../api/settings';

const demoUrl = 'https://demo.ironwaves.store';

const NAV_ITEMS = [
  { label: 'Məhsul', href: '#mehsul' },
  { label: 'Necə işləyir', href: '#nece-isleyir' },
  { label: 'Funksiyalar', href: '#funksiyalar' },
  { label: 'Sahələr', href: '#saheler' },
  { label: 'Demo', href: '#demo' },
] as const;

const TRUST_ITEMS = [
  { label: 'Masa xidməti', note: 'Raund məntiqi və owner lock ilə' },
  { label: 'Mətbəx axını', note: 'KDS statusları və gecikmə görünüşü' },
  { label: 'Kassa nəzarəti', note: 'X / Z-Hesabat və uyğunlaşdırma ilə' },
  { label: 'Canlı dashboard', note: 'Alert, KPI və açıq hesab görünüşü' },
];

const PROBLEMS = [
  'Sifarişlər mətbəxə gedir, amma kim nəyi dəyişdiyini sonradan tapmaq olmur.',
  'Masalar dolur, amma hansı hesab açıqdır, hansı masa gecikir qarışır.',
  'Kassa, depozit, investor və gündəlik xərc bir-birinə qarışır.',
  'Menecer problemə gec çatır, çünki kritik xəbərdarlıq bir yerdə görünmür.',
];

const SOLUTIONS = [
  'Masalar modulunda raund məntiqi, statuslu item axını və audit izi saxlanılır.',
  'KDS ekranında hazırlanan, hazır olan, ləğv tələb olunan və yenidən düzəldilən item-lər ayrı görünür.',
  'Maliyyə nəzarət mərkəzində kassa, seyf, investor borcu, depozit və jurnal bir sistemdə işləyir.',
  'Dashboard menecerə açıq check, kitchen load, cash fərqi və anomaliyaları bir baxışda göstərir.',
];

const MODULES = [
  { icon: CreditCard, title: 'POS', text: 'Sürətli satış, split ödəniş, çek axını və kassir üçün touch-first iş masası.' },
  { icon: Table2, title: 'Masalar', text: 'Masa açılışı, raund göndərişi, servis izləmə, hesab bağlama və təmizlik axını.' },
  { icon: ChefHat, title: 'Mətbəx ekranı', text: 'SENT, hazırlanır, hazırdır, servis edildi və düzəliş statusları bir axında görünür.' },
  { icon: Wallet, title: 'Maliyyə', text: 'Mədaxil, xərc, transfer, investor ödənişi, uyğunlaşdırma və maliyyə jurnalı bir mərkəzdədir.' },
  { icon: LayoutDashboard, title: 'Dashboard', text: 'Kritik xəbərdarlıqlar, KPI-lar, açıq hesablar və canlı əməliyyat görünüşü.' },
  { icon: ChartColumnBig, title: 'Analitika', text: 'Satış ritmi, top məhsullar, orta çek və qərar üçün lazım olan rəqəmlər.' },
  { icon: Receipt, title: 'Z-Hesabat / X-Hesabat', text: 'Növbə açılışı, sayılmış kassa, fərq və gündəlik bağlanış nəzarəti.' },
  { icon: Users, title: 'CRM / Loyallıq', text: 'Kartlar, rewards, cashback, kampaniyalar və daimi müştəri axını.' },
  { icon: QrCode, title: 'QR Menu', text: 'Müştəri telefonundan menyuya baxır, qiymət və məhsul şəkilləri dərhal görünür.' },
  { icon: ClipboardList, title: 'Loglar və audit', text: 'Kim nə etdi, nə vaxt etdi və hansı status dəyişdi sualları cavabsız qalmır.' },
];

const FLOW = [
  {
    step: '1',
    title: 'Satışı və ya masanı açın',
    text: 'Al-apar müştəri üçün POS, masa qonağı üçün Masalar modulunda açıq check axını başlayır.',
  },
  {
    step: '2',
    title: 'Sifarişi raund kimi göndərin',
    text: 'Göndərilməmiş item-lər mətbəxə ayrıca raund kimi gedir və əvvəlki sifarişlərdən ayrılır.',
  },
  {
    step: '3',
    title: 'Hazır məhsulu və hesabı idarə edin',
    text: 'KDS statusları, servis xətti, düzəliş, ləğv, hesabdan sil və israf nəzarətli qaydada işləyir.',
  },
  {
    step: '4',
    title: 'Dashboard və maliyyədən nəzarəti tamamlayın',
    text: 'Menecer kassa fərqini, kitchen delay-i, açıq check-ləri və maliyyə jurnalını bir platformadan izləyir.',
  },
];

const INDUSTRIES = ['Restoran', 'Coffee shop', 'Fast food', 'Dönər', 'Retail', 'Food court'];

const WHY_ITEMS = [
  'Bir platformada tam nəzarət: POS, masa, mətbəx, maliyyə və CRM ayrı-ayrı sistemlərə bölünmür.',
  'Audit izi və loglar: mətbəxə gedən item izsiz silinmir, status həyat dövrü saxlanılır.',
  'Depozit və öhdəlik məntiqi: masa depoziti, investor borcu və daxili transferlər qarışmır.',
  'Masa və mətbəx üçün uyğun axın: restoran ritminə uyğun raund, servis və KDS məntiqi qurulub.',
  'Menecer üçün real dashboard: kritik alert, KPI və açıq əməliyyatlar qərar verməyə kömək edir.',
  'Azərbaycan bazarına uyğun dil və axın: terminologiya yerli iş prosesinə uyğunlaşdırılıb.',
];

function SectionIntro({ eyebrow, title, body, align = 'left' }: { eyebrow: string; title: string; body: string; align?: 'left' | 'center' }) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      <div className="text-xs font-black uppercase tracking-[0.28em] text-sky-700">{eyebrow}</div>
      <h2 className="mt-4 text-3xl font-black leading-tight text-slate-950 md:text-5xl">{title}</h2>
      <p className="mt-4 text-base leading-8 text-slate-600 md:text-lg">{body}</p>
    </div>
  );
}

function SurfaceCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[30px] border border-slate-200/80 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.07)] ${className}`}>
      {children}
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[720px]">
      <div className="absolute -left-10 top-10 h-48 w-48 rounded-full bg-sky-200/70 blur-3xl" />
      <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-indigo-200/70 blur-3xl" />
      <div className="absolute bottom-4 left-16 h-40 w-40 rounded-full bg-amber-200/70 blur-3xl" />

      <div className="relative rounded-[38px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_30px_90px_rgba(15,23,42,0.10)] backdrop-blur">
        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-[#0d1420] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex items-center justify-between border-b border-white/8 bg-[#111a29] px-5 py-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-cyan-300">iRonWaves POS</div>
              <div className="mt-1 text-sm font-semibold text-white">İdarəetmə platforması</div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              Canlı nəzarət
            </div>
          </div>

          <div className="grid gap-4 bg-[radial-gradient(circle_at_top,#172132_0%,#0c1320_65%)] p-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[24px] border border-white/8 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Masalar</div>
                      <div className="mt-2 text-lg font-black text-white">Açıq masa axını</div>
                    </div>
                    <Table2 className="text-cyan-300" size={20} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {[
                      { label: 'Masa 1', tone: 'bg-violet-500/20 text-violet-200', sub: 'Aktiv check' },
                      { label: 'Masa 2', tone: 'bg-emerald-500/20 text-emerald-200', sub: 'Boş' },
                      { label: 'Masa 4', tone: 'bg-amber-500/20 text-amber-200', sub: 'Rezerv' },
                      { label: 'Masa 6', tone: 'bg-rose-500/20 text-rose-200', sub: 'Servisə hazır' },
                    ].map((table) => (
                      <div key={table.label} className="rounded-2xl border border-white/8 bg-[#131d2e] p-3">
                        <div className="text-sm font-black text-white">{table.label}</div>
                        <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${table.tone}`}>{table.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Dashboard</div>
                      <div className="mt-2 text-lg font-black text-white">Kritik xəbərdarlıqlar</div>
                    </div>
                    <BellRing className="text-amber-300" size={20} />
                  </div>
                  <div className="mt-4 space-y-3">
                    {[
                      ['Kassa fərqi', '5.00 ₼', 'text-rose-200 bg-rose-500/15'],
                      ['Kitchen delay', '3 sifariş', 'text-amber-200 bg-amber-500/15'],
                      ['Pending approval', '2 əməliyyat', 'text-sky-200 bg-sky-500/15'],
                    ].map(([label, value, tone]) => (
                      <div key={label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-[#131d2e] px-3 py-3">
                        <div className="text-sm font-semibold text-slate-200">{label}</div>
                        <div className={`rounded-full px-2.5 py-1 text-xs font-black ${tone}`}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[26px] border border-white/8 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">POS və KDS</div>
                    <div className="mt-2 text-lg font-black text-white">Sifariş mətbəxə itkisiz gedir</div>
                  </div>
                  <ChefHat className="text-violet-300" size={20} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-2xl border border-white/8 bg-[#131d2e] p-3">
                    <div className="grid grid-cols-3 gap-3">
                      {['Dönər', 'Ayran', 'Kartof', 'Amerikano', 'Su', 'Cheeseburger'].map((item, idx) => (
                        <div key={item} className="rounded-2xl border border-white/8 bg-[#0f1726] p-3">
                          <div className={`h-12 rounded-xl ${idx % 3 === 0 ? 'bg-amber-300/25' : idx % 3 === 1 ? 'bg-sky-300/20' : 'bg-rose-300/20'}`} />
                          <div className="mt-2 text-xs font-black text-slate-100">{item}</div>
                          <div className="text-[11px] text-slate-400">{(idx + 4).toFixed(2)} ₼</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-[#131d2e] p-3">
                    <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Mətbəx statusları</div>
                    <div className="mt-3 space-y-2">
                      {[
                        ['Raund 1', 'Hazırlanır', 'bg-sky-500/15 text-sky-200'],
                        ['Raund 2', 'Hazırdır', 'bg-emerald-500/15 text-emerald-200'],
                        ['Düzəliş', 'STOP / Ləğv', 'bg-amber-500/15 text-amber-200'],
                      ].map(([title, badge, tone]) => (
                        <div key={title} className="rounded-2xl border border-white/8 bg-[#0f1726] p-3">
                          <div className="text-sm font-black text-white">{title}</div>
                          <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${tone}`}>{badge}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[26px] border border-white/8 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Maliyyə</div>
                    <div className="mt-2 text-lg font-black text-white">Pul axını nəzarətdədir</div>
                  </div>
                  <Wallet className="text-emerald-300" size={20} />
                </div>
                <div className="mt-4 grid gap-3">
                  {[
                    ['Nağd kassa', '1,245 ₼'],
                    ['Bank / Kart', '2,410 ₼'],
                    ['Aktiv depozitlər', '85 ₼'],
                    ['Investor borcu', '300 ₼'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-[#131d2e] px-3 py-3">
                      <div className="text-sm text-slate-300">{label}</div>
                      <div className="text-sm font-black text-white">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[26px] border border-white/8 bg-white/5 p-4">
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Niyə bu hiss edilir</div>
                <div className="mt-3 space-y-3">
                  {[
                    'Sifariş itmir',
                    'Masa axını qarışmır',
                    'Mətbəx gecikməsi görünür',
                    'Kassa və öhdəliklər izlənir',
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-[#131d2e] px-3 py-3">
                      <BadgeCheck size={18} className="text-emerald-300" />
                      <span className="text-sm font-semibold text-slate-200">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenCard({
  title,
  body,
  image,
  mock,
}: {
  title: string;
  body: string;
  image?: string;
  mock?: React.ReactNode;
}) {
  return (
    <SurfaceCard className="overflow-hidden">
      <div className="bg-[linear-gradient(180deg,#eff6ff,#f8fafc)] p-4">
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
          {image ? (
            <img src={image} alt={title} className="h-72 w-full object-cover object-top" />
          ) : (
            <div className="h-72 w-full bg-[#0d1420] p-4">{mock}</div>
          )}
        </div>
      </div>
      <div className="p-6">
        <h3 className="text-2xl font-black text-slate-950">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-600">{body}</p>
      </div>
    </SurfaceCard>
  );
}

function TablesMock() {
  return (
    <div className="grid h-full grid-cols-2 gap-3">
      {[
        ['Masa 1', 'Aktiv check', 'bg-violet-500/20 text-violet-200'],
        ['Masa 2', 'Boş', 'bg-emerald-500/20 text-emerald-200'],
        ['Masa 3', 'Rezerv', 'bg-amber-500/20 text-amber-200'],
        ['Masa 4', 'Servisə hazır', 'bg-rose-500/20 text-rose-200'],
      ].map(([label, status, tone]) => (
        <div key={label} className="rounded-[22px] border border-white/8 bg-[#121c2d] p-4">
          <div className="text-base font-black text-white">{label}</div>
          <div className={`mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-bold ${tone}`}>{status}</div>
        </div>
      ))}
    </div>
  );
}

function DashboardMock() {
  return (
    <div className="grid h-full gap-3">
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Bu gün satış', '4,280 ₼'],
          ['Açıq check', '7'],
          ['Kitchen load', '68%'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[20px] border border-white/8 bg-[#121c2d] p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
            <div className="mt-2 text-xl font-black text-white">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid flex-1 gap-3 md:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[22px] border border-white/8 bg-[#121c2d] p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Canlı satışlar</div>
          <div className="mt-3 space-y-2">
            {['Amerikano — 6.00 ₼', 'Dönər — 7.00 ₼', 'Ayran — 2.00 ₼'].map((row) => (
              <div key={row} className="rounded-xl border border-white/8 bg-[#0f1726] px-3 py-2 text-sm text-slate-200">{row}</div>
            ))}
          </div>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-[#121c2d] p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Xəbərdarlıqlar</div>
          <div className="mt-3 space-y-2">
            {['Kassa fərqi', 'Kitchen delay', 'Pending approval'].map((row, idx) => (
              <div key={row} className={`rounded-xl px-3 py-2 text-sm font-semibold ${idx === 0 ? 'bg-rose-500/15 text-rose-200' : idx === 1 ? 'bg-amber-500/15 text-amber-200' : 'bg-sky-500/15 text-sky-200'}`}>{row}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KdsMock() {
  return (
    <div className="grid h-full gap-3 md:grid-cols-3">
      {[
        ['Yeni', 'Masa 2 · Raund 1', '2 dönər, 1 ayran'],
        ['Hazırlanır', 'Masa 4 · Raund 2', '1 burger, 1 kartof'],
        ['Hazırdır', 'Masa 1 · Raund 3', '2 latte'],
      ].map(([title, subtitle, items], idx) => (
        <div key={title} className="rounded-[22px] border border-white/8 bg-[#121c2d] p-3">
          <div className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${idx === 0 ? 'bg-sky-500/15 text-sky-200' : idx === 1 ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{title}</div>
          <div className="mt-3 text-sm font-black text-white">{subtitle}</div>
          <div className="mt-2 text-sm text-slate-300">{items}</div>
        </div>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const [landingSettings, setLandingSettings] = React.useState<any>(null);
  const [form, setForm] = React.useState({
    fullName: '',
    businessName: '',
    phone: '',
    businessType: 'restoran',
    note: '',
  });

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await get_public_landing_settings_live();
        if (mounted) setLandingSettings(data || null);
      } catch {
        // local baked copy is enough
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const heroTitle = landingSettings?.hero_title_az || 'Restoranınızı bir platformadan idarə edin';
  const heroBody =
    landingSettings?.hero_body_az ||
    'POS, masalar, mətbəx, maliyyə, dashboard və analitika bir sistemdə işləsin. Sifariş itirmədən, kassa nəzarətini itirmədən, gündəlik əməliyyatı bir ekrandan idarə edin.';
  const primaryCta = landingSettings?.primary_cta_az || 'Demoya keç';
  const secondaryCta = landingSettings?.secondary_cta_az || 'Ətraflı bax';
  const contactEmail = landingSettings?.contact_email || 'hello@ironwaves.store';
  const contactPhone = landingSettings?.contact_phone || '+994 50 000 00 00';
  const contactWhatsapp = landingSettings?.contact_whatsapp || '';

  const demoMessage = React.useMemo(() => {
    return [
      'Demo sorğusu',
      `Ad: ${form.fullName || '-'}`,
      `Biznes adı: ${form.businessName || '-'}`,
      `Telefon: ${form.phone || '-'}`,
      `Obyekt növü: ${form.businessType || '-'}`,
      `Qeyd: ${form.note || '-'}`,
    ].join('\n');
  }, [form]);

  const handleDemoRequest = (event: React.FormEvent) => {
    event.preventDefault();
    const whatsappDigits = String(contactWhatsapp || '').replace(/\D/g, '');
    if (whatsappDigits) {
      window.open(`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(demoMessage)}`, '_blank');
      return;
    }
    window.location.href = `mailto:${contactEmail}?subject=${encodeURIComponent('iRonWaves POS demo sorğusu')}&body=${encodeURIComponent(demoMessage)}`;
  };

  return (
    <div className="min-h-[100dvh] overflow-y-auto bg-[#f7f9fc] text-slate-900">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_20%),radial-gradient(circle_at_80%_10%,rgba(99,102,241,0.12),transparent_24%),linear-gradient(180deg,#ffffff_0%,#f7f9fc_44%,#edf3ff_100%)]" />

        <div className="relative mx-auto max-w-7xl px-6 md:px-10 xl:px-14">
          <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/88 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-[linear-gradient(180deg,#0f172a,#1e293b)] text-xl font-black text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                  IW
                </div>
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.28em] text-sky-700">iRonWaves POS</div>
                  <div className="text-lg font-black text-slate-950 md:text-xl">Restoran idarəetmə platforması</div>
                </div>
              </div>

              <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-600 lg:flex">
                {NAV_ITEMS.map((item) => (
                  <a key={item.label} href={item.href} className="transition hover:text-sky-700">
                    {item.label}
                  </a>
                ))}
              </nav>

              <a
                href={demoUrl}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#0f172a,#1e293b)] px-5 py-3 text-sm font-bold text-white shadow-[0_16px_34px_rgba(15,23,42,0.18)] transition hover:translate-y-[-1px]"
              >
                {primaryCta}
              </a>
            </div>
          </header>

          <section className="grid gap-12 pb-16 pt-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:pt-16">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black uppercase tracking-[0.28em] text-sky-700">
                <ShieldCheck size={14} />
                Bir platformada tam nəzarət
              </div>

              <h1 className="mt-8 text-5xl font-black leading-[0.98] text-slate-950 md:text-7xl">{heroTitle}</h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-600 md:text-lg">{heroBody}</p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={demoUrl}
                  className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#0f172a,#1e293b)] px-7 py-3 text-base font-bold text-white shadow-[0_18px_36px_rgba(15,23,42,0.18)] transition hover:translate-y-[-1px]"
                >
                  {primaryCta}
                </a>
                <a
                  href="#mehsul"
                  className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white px-7 py-3 text-base font-semibold text-slate-800 transition hover:border-sky-300 hover:text-sky-700"
                >
                  {secondaryCta}
                </a>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  ['Sifariş itmir', 'Raund məntiqi və mətbəx statusları ilə'],
                  ['Kassa nəzarəti itmir', 'Maliyyə, uyğunlaşdırma və jurnal bir yerdə'],
                ].map(([title, note]) => (
                  <div key={title} className="rounded-[24px] border border-slate-200/80 bg-white/85 p-4 shadow-[0_16px_38px_rgba(15,23,42,0.05)]">
                    <div className="text-sm font-black text-slate-950">{title}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">{note}</div>
                  </div>
                ))}
              </div>
            </div>

            <ProductPreview />
          </section>

          <section className="grid gap-4 pb-20 md:grid-cols-2 xl:grid-cols-4">
            {TRUST_ITEMS.map((item) => (
              <SurfaceCard key={item.label} className="p-6">
                <div className="text-lg font-black text-slate-950">{item.label}</div>
                <div className="mt-3 text-sm leading-7 text-slate-600">{item.note}</div>
              </SurfaceCard>
            ))}
          </section>

          <section id="mehsul" className="pb-20">
            <div className="grid gap-8 lg:grid-cols-2">
              <SurfaceCard className="overflow-hidden bg-[linear-gradient(180deg,#0f172a,#111827)] p-8 text-white">
                <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Problem</div>
                <h2 className="mt-4 text-3xl font-black md:text-5xl">Restoran içində ən çox qarışan hissələr</h2>
                <div className="mt-8 space-y-4">
                  {PROBLEMS.map((item) => (
                    <div key={item} className="rounded-[22px] border border-white/10 bg-white/6 p-4 text-sm leading-7 text-slate-200">
                      {item}
                    </div>
                  ))}
                </div>
              </SurfaceCard>

              <SurfaceCard className="p-8">
                <div className="text-xs font-black uppercase tracking-[0.28em] text-sky-700">Həll</div>
                <h2 className="mt-4 text-3xl font-black text-slate-950 md:text-5xl">iRonWaves bunları bir axına çevirir</h2>
                <div className="mt-8 space-y-4">
                  {SOLUTIONS.map((item) => (
                    <div key={item} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            </div>
          </section>

          <section id="funksiyalar" className="pb-20">
            <SectionIntro
              eyebrow="Əsas modullar"
              title="Tək POS yox, tam idarəetmə platforması"
              body="Sistem restoran sahibinin, menecerin, kassirin və mətbəxin gündəlik ritmini eyni platformada birləşdirir."
            />

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {MODULES.map((item) => (
                <SurfaceCard key={item.title} className="p-6">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-[linear-gradient(180deg,#e0f2fe,#dbeafe)] text-sky-800">
                    <item.icon size={24} />
                  </div>
                  <h3 className="mt-5 text-2xl font-black text-slate-950">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
                </SurfaceCard>
              ))}
            </div>
          </section>

          <section id="nece-isleyir" className="pb-20">
            <SectionIntro
              eyebrow="Necə işləyir"
              title="Əməliyyat axını aydın, sürətli və nəzarətlidir"
              body="Sistem restoranı qarışıq ekrandan yox, mərhələli və iz buraxan iş axınından idarə etməyə kömək edir."
              align="center"
            />

            <div className="mt-10 grid gap-5 lg:grid-cols-4">
              {FLOW.map((item) => (
                <SurfaceCard key={item.step} className="p-6">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-xl font-black text-white">
                    {item.step}
                  </div>
                  <h3 className="mt-5 text-2xl font-black text-slate-950">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
                </SurfaceCard>
              ))}
            </div>
          </section>

          <section className="pb-20">
            <SectionIntro
              eyebrow="Ekranlar"
              title="Komandanın hər rolu üçün ayrıca iş sahəsi"
              body="Masalar, dashboard, maliyyə və KDS ekranları bir-biri ilə əlaqəlidir. Menecer hər şeyi görür, komanda isə öz ritmində işləyir."
            />

            <div className="mt-10 grid gap-6 xl:grid-cols-2">
              <ScreenCard
                title="Masalar"
                body="Masa açılışı, raund göndərişi, servisə hazır məhsullar və hesab bağlama eyni axında işləyir."
                mock={<TablesMock />}
              />
              <ScreenCard
                title="Dashboard"
                body="Kritik alert-lər, canlı satışlar, açıq check-lər və əməliyyat yükü menecerə real vəziyyəti göstərir."
                mock={<DashboardMock />}
              />
              <ScreenCard
                title="Maliyyə"
                body="Nağd kassa, bank, seyf, aktiv depozitlər, uyğunlaşdırma və jurnal bir nəzarət mərkəzində toplanır."
                image="/landing/finance-screen.png"
              />
              <ScreenCard
                title="Mətbəx ekranı"
                body="Yeni raundlar, hazırlananlar, hazır olanlar və düzəliş tələb olunan item-lər mətbəxə aydın görünür."
                mock={<KdsMock />}
              />
            </div>
          </section>

          <section id="saheler" className="pb-20">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <SectionIntro
                eyebrow="Kimlər üçün"
                title="Fərqli obyekt formatları üçün uyğunlaşdırıla bilir"
                body="Sistem bir kassa məhsulu kimi yox, fərqli iş ritmlərinə uyğunlaşdırılan idarəetmə platforması kimi düşünülüb."
              />
              <SurfaceCard className="p-8">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {INDUSTRIES.map((item) => (
                    <div key={item} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-5">
                      <div className="flex items-center gap-3">
                        <Store size={18} className="text-sky-700" />
                        <span className="text-base font-black text-slate-950">{item}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            </div>
          </section>

          <section className="pb-20">
            <SectionIntro
              eyebrow="Niyə iRonWaves"
              title="Bu platforma niyə real restoran üçün uyğundur"
              body="Məqsəd yalnız satış almaq deyil. Məqsəd odur ki, sahibkar nəzarəti itirməsin, komanda isə işi qarışdırmadan sürətləndirə bilsin."
            />

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {WHY_ITEMS.map((item) => (
                <SurfaceCard key={item} className="p-6">
                  <div className="flex items-start gap-3">
                    <BadgeCheck size={20} className="mt-1 shrink-0 text-emerald-600" />
                    <p className="text-sm leading-7 text-slate-700">{item}</p>
                  </div>
                </SurfaceCard>
              ))}
            </div>
          </section>

          <section id="demo" className="pb-24">
            <div className="overflow-hidden rounded-[38px] border border-slate-200/80 bg-[linear-gradient(135deg,#0f172a,#111827,#1e293b)] p-8 text-white shadow-[0_28px_80px_rgba(15,23,42,0.20)] md:p-10">
              <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-start">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Demo CTA</div>
                  <h2 className="mt-4 text-4xl font-black leading-tight md:text-5xl">Restoranınıza uyğun demo alın</h2>
                  <p className="mt-5 text-sm leading-8 text-slate-300 md:text-base">
                    Sistemi canlı görün. POS, masalar, mətbəx, maliyyə və dashboard axınının sizin obyektə necə oturduğunu birlikdə baxaq.
                  </p>

                  <div className="mt-8 grid gap-4">
                    {[
                      ['Masa axını üçün demo', 'Ofisiant, mətbəx və hesab bağlama ritmini canlı görün.'],
                      ['Maliyyə nəzarəti üçün demo', 'Kassa, depozit, investor və uyğunlaşdırma məntiqini yoxlayın.'],
                      ['Menecer görünüşü üçün demo', 'Dashboard, alert və jurnal hissəsinin qərara necə kömək etdiyini görün.'],
                    ].map(([title, note]) => (
                      <div key={title} className="rounded-[24px] border border-white/10 bg-white/6 p-4">
                        <div className="font-black text-white">{title}</div>
                        <div className="mt-2 text-sm leading-7 text-slate-300">{note}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <SurfaceCard className="p-6 md:p-8">
                  <div className="text-sm font-black uppercase tracking-[0.24em] text-sky-700">Demo formu</div>
                  <form className="mt-6 grid gap-4" onSubmit={handleDemoRequest}>
                    <label className="block">
                      <div className="text-sm font-semibold text-slate-700">Ad</div>
                      <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.fullName} onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))} placeholder="Adınızı yazın" />
                    </label>
                    <label className="block">
                      <div className="text-sm font-semibold text-slate-700">Biznes adı</div>
                      <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.businessName} onChange={(e) => setForm((prev) => ({ ...prev, businessName: e.target.value }))} placeholder="Obyektinizin adı" />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <div className="text-sm font-semibold text-slate-700">Telefon</div>
                        <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="+994..." />
                      </label>
                      <label className="block">
                        <div className="text-sm font-semibold text-slate-700">Obyekt növü</div>
                        <select className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.businessType} onChange={(e) => setForm((prev) => ({ ...prev, businessType: e.target.value }))}>
                          <option value="restoran">Restoran</option>
                          <option value="coffee-shop">Coffee shop</option>
                          <option value="fast-food">Fast food</option>
                          <option value="doner">Dönər</option>
                          <option value="retail">Retail</option>
                          <option value="food-court">Food court</option>
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      <div className="text-sm font-semibold text-slate-700">Qısa qeyd</div>
                      <textarea className="mt-2 min-h-[130px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.note} onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))} placeholder="Hazırda neçə kassanız, neçə masanız və ya hansı modula daha çox ehtiyacınız olduğunu yazın" />
                    </label>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button type="submit" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#0f172a,#1e293b)] px-6 py-3 text-base font-bold text-white shadow-[0_16px_34px_rgba(15,23,42,0.16)]">
                        Demo istə
                        <ArrowRight size={18} />
                      </button>
                      <a href={demoUrl} className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3 text-base font-semibold text-slate-800">
                        Demoya keç
                      </a>
                    </div>

                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
                      Əlaqə: <span className="font-semibold text-slate-900">{contactEmail}</span>
                      {contactPhone ? <span className="ml-2 font-semibold text-slate-900">{contactPhone}</span> : null}
                    </div>
                  </form>
                </SurfaceCard>
              </div>
            </div>
          </section>

          <footer className="border-t border-slate-200/80 py-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.24em] text-sky-700">iRonWaves POS</div>
                <div className="mt-2 text-sm text-slate-600">Restoranınızı bir platformadan idarə edin.</div>
              </div>

              <div className="flex flex-wrap gap-4 text-sm font-semibold text-slate-600">
                {NAV_ITEMS.map((item) => (
                  <a key={item.label} href={item.href} className="transition hover:text-sky-700">
                    {item.label}
                  </a>
                ))}
                <a href={`mailto:${contactEmail}`} className="transition hover:text-sky-700">Əlaqə</a>
              </div>

              <div className="text-sm text-slate-500">© {new Date().getFullYear()} iRonWaves POS</div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
