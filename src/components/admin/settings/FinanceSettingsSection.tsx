import React, { useState, useMemo } from 'react';
import { tx } from '../../../i18n';
import { YIELD_PRESETS } from './types';
import type { BankCommissionState, FinancePolicyState, YieldManagementState } from './types';

export interface FinanceSettingsSectionProps {
  lang: string;
  saveButtonClass: string;
  renderPanelSuccess: (panelId: string) => React.ReactNode;

  // Bank commission
  bankCommission: BankCommissionState;
  setBankCommission: React.Dispatch<React.SetStateAction<BankCommissionState>>;
  saveBankCommission: () => Promise<void>;

  // Finance policy
  financePolicy: FinancePolicyState;
  setFinancePolicy: React.Dispatch<React.SetStateAction<FinancePolicyState>>;
  saveFinancePolicy: () => Promise<void>;

  // Yield management
  yieldManagement: YieldManagementState;
  setYieldManagement: React.Dispatch<React.SetStateAction<YieldManagementState>>;
  saveYieldManagement: () => Promise<void>;

  // Inventory catalog for yield tracked items selection
  inventoryCatalog: any[];
}

export function FinanceSettingsSection({
  lang,
  saveButtonClass,
  renderPanelSuccess,
  bankCommission,
  setBankCommission,
  saveBankCommission,
  financePolicy,
  setFinancePolicy,
  saveFinancePolicy,
  yieldManagement,
  setYieldManagement,
  saveYieldManagement,
  inventoryCatalog,
}: FinanceSettingsSectionProps) {
  // Local UI state for yield inventory search/selection
  const [yieldInventorySearch, setYieldInventorySearch] = useState('');
  const [yieldInventoryCandidate, setYieldInventoryCandidate] = useState('');

  // Computed inventory lists for yield section
  const suggestedYieldItems = useMemo(
    () =>
      inventoryCatalog.filter((item: any) => {
        const hay = `${String(item?.name || '')} ${String(item?.category || '')}`.toLowerCase();
        return (
          hay.includes('dönər') ||
          hay.includes('doner') ||
          hay.includes('dana') ||
          hay.includes('mal ') ||
          hay.includes('mal əti') ||
          hay.includes('toyuq') ||
          hay.includes('chicken')
        );
      }),
    [inventoryCatalog],
  );

  const preferredYieldInventory = useMemo(
    () =>
      inventoryCatalog.filter((item: any) => {
        const hay = `${String(item?.name || '')} ${String(item?.category || '')}`.toLowerCase();
        return (
          hay.includes('dönər') ||
          hay.includes('doner') ||
          hay.includes('ət') ||
          hay.includes('et') ||
          hay.includes('dana') ||
          hay.includes('mal ') ||
          hay.includes('mal əti') ||
          hay.includes('toyuq') ||
          hay.includes('chicken') ||
          hay.includes('shawarma') ||
          hay.includes('gyro') ||
          hay.includes('kebab')
        );
      }),
    [inventoryCatalog],
  );

  const remainingYieldInventory = useMemo(
    () =>
      inventoryCatalog.filter(
        (item: any) => !preferredYieldInventory.some((preferred: any) => preferred.id === item.id || preferred.name === item.name),
      ),
    [inventoryCatalog, preferredYieldInventory],
  );

  const selectableYieldInventory = useMemo(
    () =>
      [...preferredYieldInventory, ...remainingYieldInventory].filter(
        (item: any) => !yieldManagement.tracked_items.some((row) => row.inventory_name === item.name),
      ),
    [preferredYieldInventory, remainingYieldInventory, yieldManagement.tracked_items],
  );

  const filteredYieldInventory = useMemo(() => {
    const normalizedSearch = String(yieldInventorySearch || '').trim().toLowerCase();
    return selectableYieldInventory.filter((item: any) => {
      if (!normalizedSearch) return true;
      const hay = `${String(item?.name || '')} ${String(item?.category || '')}`.toLowerCase();
      return hay.includes(normalizedSearch);
    });
  }, [selectableYieldInventory, yieldInventorySearch]);

  // Yield helper functions
  const applyYieldPreset = (meatType: 'beef' | 'chicken') => {
    const preset = YIELD_PRESETS[meatType];
    setYieldManagement((prev) => ({
      ...prev,
      ...(meatType === 'beef'
        ? {
            beef_ratio: preset.ratio,
            beef_loss_min_percent: preset.min,
            beef_loss_max_percent: preset.max,
          }
        : {
            chicken_ratio: preset.ratio,
            chicken_loss_min_percent: preset.min,
            chicken_loss_max_percent: preset.max,
          }),
      tracked_items: prev.tracked_items.map((row) =>
        row.meat_type === meatType ? { ...row, raw_to_ready_ratio: preset.ratio } : row,
      ),
    }));
  };

  const applySmartYieldSuggestion = (inventoryName: string) => {
    const hay = String(inventoryName || '').toLowerCase();
    const meatType: 'beef' | 'chicken' =
      hay.includes('toyuq') || hay.includes('chicken') ? 'chicken' : 'beef';
    const ratio =
      meatType === 'chicken'
        ? yieldManagement.chicken_ratio || YIELD_PRESETS.chicken.ratio
        : yieldManagement.beef_ratio || YIELD_PRESETS.beef.ratio;
    setYieldManagement((prev) => {
      const existing = prev.tracked_items.find((row) => row.inventory_name === inventoryName);
      if (existing) {
        return {
          ...prev,
          tracked_items: prev.tracked_items.map((row) =>
            row.inventory_name === inventoryName
              ? { ...row, enabled: true, meat_type: meatType, raw_to_ready_ratio: ratio }
              : row,
          ),
        };
      }
      return {
        ...prev,
        tracked_items: [
          ...prev.tracked_items,
          {
            inventory_name: inventoryName,
            enabled: true,
            meat_type: meatType,
            raw_to_ready_ratio: ratio,
          },
        ],
      };
    });
  };

  const addYieldTrackedInventory = () => {
    const inventoryName = String(yieldInventoryCandidate || '').trim();
    if (!inventoryName) return;
    applySmartYieldSuggestion(inventoryName);
    setYieldInventoryCandidate('');
  };

  const removeYieldTrackedInventory = (inventoryName: string) => {
    setYieldManagement((prev) => ({
      ...prev,
      tracked_items: prev.tracked_items.filter((row) => row.inventory_name !== inventoryName),
    }));
  };

  return (
    <>
      <div id="sec-bankfee" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Bank Faiz Ayarları', 'Настройки банковских комиссий', 'Bank Fee Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Hər tenant öz bank faizlərini özü müəyyən edə bilər. Kartla edilən satış və kartdan çıxan/köçürülən pul üçün faizlər ayrıdır.',
            'Каждый tenant может сам задать банковские комиссии. Для карточных продаж и вывода/перевода с карты проценты разделены.',
            'Each tenant can define its own bank fee rules. Card sales and money moved out of card balance are configured separately.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Kartla satış faizi (%)', 'Комиссия за карточную продажу (%)', 'Card sale fee (%)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={bankCommission.card_sale_percent}
              onChange={(e) => setBankCommission((prev) => ({ ...prev, card_sale_percent: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Kartdan çıxış/köçürmə faizi (%)', 'Комиссия за вывод/перевод с карты (%)', 'Card transfer-out fee (%)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={bankCommission.card_transfer_percent}
              onChange={(e) => setBankCommission((prev) => ({ ...prev, card_transfer_percent: e.target.value }))}
            />
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-xs text-slate-300">
          {tx(
            lang,
            'Məntiq: kassada adi kart ödənişi üçün bir faiz, kartdan kassaya və ya borca köçürmə üçün ayrıca faiz tətbiq olunur. Kassadan karta, kassadan seyfə kimi hərəkətlərdə kart çıxışı olmadığı üçün bu faiz avtomatik tətbiq olunmur.',
            'Логика: для обычной карточной оплаты в кассе один процент, для перевода/вывода с карты — отдельный. Для касса->карта и касса->сейф комиссия не применяется автоматически.',
            'Logic: regular card sales use one percentage, while money moved out of card balance uses another. Cash->card and cash->safe do not get this fee automatically.',
          )}
        </div>
        {renderPanelSuccess('bank')}
        <div className="flex justify-end">
          <button onClick={() => { void saveBankCommission(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div id="sec-finance" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Maliyyə qayda ayarları', 'Настройки финансовой policy', 'Finance Policy Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Təsdiq, uyğunlaşdırma və risk xəbərdarlığı qaydalarını tenant səviyyəsində buradan idarə edin. Bu ayarlar Maliyyə modulunda təsdiq qutusu və xəbərdarlıq mexanizmi üçün istifadə olunur.',
            'Управляйте правилами approval, reconciliation и risk alert на уровне tenant. Эти настройки используются в Finance approval inbox и alert engine.',
            'Manage approval, reconciliation, and risk alert rules per tenant. These settings drive the Finance approval inbox and alert engine.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Böyük transfer limiti (AZN)', 'Лимит крупного перевода (AZN)', 'Large transfer threshold (AZN)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={financePolicy.large_transfer_threshold_azn}
              onChange={(e) => setFinancePolicy((prev) => ({ ...prev, large_transfer_threshold_azn: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Uyğunlaşdırma xəbərdarlıq həddi (AZN)', 'Порог reconciliation alert (AZN)', 'Reconciliation alert threshold (AZN)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={financePolicy.reconciliation_variance_alert_azn}
              onChange={(e) => setFinancePolicy((prev) => ({ ...prev, reconciliation_variance_alert_azn: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Mənfi balans alert toleransı (AZN)', 'Толеранс alert отрицательного баланса (AZN)', 'Negative balance alert tolerance (AZN)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={financePolicy.negative_balance_alert_azn}
              onChange={(e) => setFinancePolicy((prev) => ({ ...prev, negative_balance_alert_azn: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Təsdiq rolları', 'Роли approval', 'Approval roles')}</label>
            <input
              className="neon-input"
              value={financePolicy.approver_roles}
              onChange={(e) => setFinancePolicy((prev) => ({ ...prev, approver_roles: e.target.value }))}
              placeholder="manager, admin, finance_admin, super_admin"
            />
            <div className="field-hint">{tx(lang, 'Vergüllə ayırın.', 'Разделяйте запятыми.', 'Separate with commas.')}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[
            ['investor_repayment_requires_approval', tx(lang, 'Investor ödənişi approval tələb etsin', 'Выплата инвестору требует approval', 'Investor repayment requires approval')],
            ['cash_adjustment_requires_approval', tx(lang, 'Cash adjustment approval tələb etsin', 'Cash adjustment требует approval', 'Cash adjustment requires approval')],
            ['reversal_requires_approval', tx(lang, 'Reversal approval tələb etsin', 'Reversal требует approval', 'Reversal requires approval')],
            ['reconciliation_adjustment_requires_approval', tx(lang, 'Reconciliation adjustment approval tələb etsin', 'Reconciliation adjustment требует approval', 'Reconciliation adjustment requires approval')],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm font-bold text-slate-200">
              <input
                type="checkbox"
                checked={Boolean((financePolicy as any)[key])}
                onChange={(e) => setFinancePolicy((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
        {renderPanelSuccess('finance_policy')}
        <div className="flex justify-end">
          <button onClick={() => { void saveFinancePolicy(); }} className={saveButtonClass}>{tx(lang, 'Maliyyə policy saxla', 'Сохранить finance policy', 'Save finance policy')}</button>
        </div>
      </div>

      <div id="sec-yield" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Standart İtki Faizi', 'Настройки yield management', 'Yield management')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Dönər və oxşar məhsullarda hazır porsiya satışını çiy xammal sərfinə çevirin. Gün sonu faktiki fərq icazə verilən həddi keçərsə, sistem bunu israf və ya şübhəli fərq kimi qeyd edir.',
            'Преобразуйте продажу готовой порции в расход сырого мяса. В конце дня система пометит отклонение выше tolerance как waste/scam.',
            'Convert ready-portion sales into raw-meat consumption. At day end, variance beyond tolerance is flagged as waste/scam.',
          )}
        </p>
        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={yieldManagement.enabled}
            onChange={(e) => setYieldManagement((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          {tx(lang, 'Standart itki faizi aktiv olsun', 'Включить yield management', 'Enable yield management')}
        </label>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            className="neon-input"
            type="number"
            min={0}
            step="0.01"
            value={yieldManagement.variance_tolerance_percent}
            onChange={(e) => setYieldManagement((prev) => ({ ...prev, variance_tolerance_percent: e.target.value }))}
            placeholder={tx(lang, 'İcazə verilən fərq (%)', 'Допустимое отклонение (%)', 'Variance tolerance (%)')}
          />
          <input
            className="neon-input"
            type="number"
            min={1}
            step="0.01"
            value={yieldManagement.beef_ratio}
            onChange={(e) => setYieldManagement((prev) => ({ ...prev, beef_ratio: e.target.value }))}
            placeholder={tx(lang, 'Mal əti üçün çiy / hazır nisbəti', 'Ratio говядины', 'Beef ratio')}
          />
          <input
            className="neon-input"
            type="number"
            min={1}
            step="0.01"
            value={yieldManagement.chicken_ratio}
            onChange={(e) => setYieldManagement((prev) => ({ ...prev, chicken_ratio: e.target.value }))}
            placeholder={tx(lang, 'Toyuq əti üçün çiy / hazır nisbəti', 'Ratio курицы', 'Chicken ratio')}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-100">{tx(lang, 'Mal əti standartı', 'Стандарт говядины', 'Beef standard')}</div>
              <button type="button" onClick={() => applyYieldPreset('beef')} className="neon-btn rounded-lg px-3 py-1 text-xs">
                {tx(lang, 'Standartı tətbiq et', 'Применить стандарт', 'Apply preset')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="neon-input" type="number" min={0} step="0.01" value={yieldManagement.beef_loss_min_percent} onChange={(e) => setYieldManagement((prev) => ({ ...prev, beef_loss_min_percent: e.target.value }))} placeholder={tx(lang, 'Min itki %', 'Мин потеря %', 'Min loss %')} />
              <input className="neon-input" type="number" min={0} step="0.01" value={yieldManagement.beef_loss_max_percent} onChange={(e) => setYieldManagement((prev) => ({ ...prev, beef_loss_max_percent: e.target.value }))} placeholder={tx(lang, 'Max itki %', 'Макс потеря %', 'Max loss %')} />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-100">{tx(lang, 'Toyuq standartı', 'Стандарт курицы', 'Chicken standard')}</div>
              <button type="button" onClick={() => applyYieldPreset('chicken')} className="neon-btn rounded-lg px-3 py-1 text-xs">
                {tx(lang, 'Standartı tətbiq et', 'Применить стандарт', 'Apply preset')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="neon-input" type="number" min={0} step="0.01" value={yieldManagement.chicken_loss_min_percent} onChange={(e) => setYieldManagement((prev) => ({ ...prev, chicken_loss_min_percent: e.target.value }))} placeholder={tx(lang, 'Min itki %', 'Мин потеря %', 'Min loss %')} />
              <input className="neon-input" type="number" min={0} step="0.01" value={yieldManagement.chicken_loss_max_percent} onChange={(e) => setYieldManagement((prev) => ({ ...prev, chicken_loss_max_percent: e.target.value }))} placeholder={tx(lang, 'Max itki %', 'Макс потеря %', 'Max loss %')} />
            </div>
          </div>
        </div>
        {suggestedYieldItems.length > 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
            <div className="font-semibold text-emerald-200">{tx(lang, 'Ağıllı inventar təklifləri', 'Умные подсказки по инвентарю', 'Smart inventory suggestions')}</div>
            <p className="text-xs text-emerald-100/80">
              {tx(
                lang,
                'Sistem adı üzrə dönər, mal əti və toyuq məhsullarını avtomatik təklif edir. Bir kliklə izlənən inventara əlavə edə bilərsiniz.',
                'Система автоматически предлагает позиции по названию. Вы можете добавить их в отслеживаемый список одним кликом.',
                'The system suggests likely doner/beef/chicken inventory by name. Add them to tracked inventory with one click.',
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestedYieldItems.map((item: any) => {
                const alreadyTracked = yieldManagement.tracked_items.some((row) => row.inventory_name === item.name);
                return (
                  <button
                    key={`suggest-${item.id || item.name}`}
                    type="button"
                    disabled={alreadyTracked}
                    onClick={() => applySmartYieldSuggestion(String(item.name || ''))}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      alreadyTracked
                        ? 'border-slate-600/60 bg-slate-800/60 text-slate-400'
                        : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20'
                    }`}
                  >
                    {item.name}
                    {alreadyTracked ? ` · ${tx(lang, 'əlavə edilib', 'добавлено', 'added')}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 space-y-3">
          <div className="font-semibold text-slate-100">{tx(lang, 'İzlənəcək inventar', 'Отслеживаемый инвентарь', 'Tracked inventory')}</div>
          <p className="text-xs text-slate-400">
            {tx(
              lang,
              'Bura yalnız çiy ət kimi ciddi yield izləmək istədiyiniz məhsulları əlavə edin. Meyvə-tərəvəz üçün yalnız ayrıca gündəlik itki auditi aparırsınızsa istifadə etmək məntiqlidir.',
              'Сюда добавляйте только позиции, по которым реально нужен yield-аудит. Для овощей и фруктов имеет смысл только при отдельном ежедневном учете потерь.',
              'Add only inventory that truly needs yield audit, such as raw meat. For fruit and vegetables, use this only if you run a separate daily waste audit.',
            )}
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              className="neon-input"
              value={yieldInventorySearch}
              onChange={(e) => setYieldInventorySearch(e.target.value)}
              placeholder={tx(lang, 'Məhsul axtar...', 'Поиск товара...', 'Search inventory...')}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
            <select
              className="neon-input"
              value={yieldInventoryCandidate}
              onChange={(e) => setYieldInventoryCandidate(e.target.value)}
            >
              <option value="">{tx(lang, 'Anbardan məhsul seçin', 'Выберите товар со склада', 'Select inventory item')}</option>
              {preferredYieldInventory.length > 0 ? (
                <optgroup label={tx(lang, 'Ət / dönər üçün uyğun məhsullar', 'Подходящие мясные позиции', 'Preferred meat items')}>
                  {filteredYieldInventory
                    .filter((item: any) => preferredYieldInventory.some((preferred: any) => preferred.id === item.id || preferred.name === item.name))
                    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')))
                    .map((item: any) => (
                      <option key={item.id || item.name} value={String(item.name || '')}>
                        {item.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {remainingYieldInventory.length > 0 ? (
                <optgroup label={tx(lang, 'Digər inventar', 'Прочий инвентарь', 'Other inventory')}>
                  {filteredYieldInventory
                    .filter((item: any) => remainingYieldInventory.some((rest: any) => rest.id === item.id || rest.name === item.name))
                    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')))
                    .map((item: any) => (
                      <option key={item.id || item.name} value={String(item.name || '')}>
                        {item.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </select>
            <button type="button" onClick={addYieldTrackedInventory} className="glossy-gold rounded-xl px-4 py-2 font-bold">
              {tx(lang, 'Siyahıya əlavə et', 'Добавить в список', 'Add to list')}
            </button>
          </div>
          <div className="space-y-2">
            {yieldManagement.tracked_items.length === 0 ? (
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-3 text-sm text-slate-400">
                {tx(lang, 'Hələ izlənən inventar seçilməyib', 'Пока не выбрана отслеживаемая позиция', 'No tracked inventory selected yet')}
              </div>
            ) : (
              yieldManagement.tracked_items.map((tracked) => (
                <div key={tracked.inventory_name} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-700/50 bg-slate-900/40 p-3 md:grid-cols-[1fr_120px_130px_auto] md:items-center">
                  <div className="text-sm text-slate-200">{tracked.inventory_name}</div>
                  <select
                    className="neon-input"
                    value={tracked.meat_type || 'beef'}
                    onChange={(e) =>
                      setYieldManagement((prev) => ({
                        ...prev,
                        tracked_items: prev.tracked_items.map((row) =>
                          row.inventory_name === tracked.inventory_name ? { ...row, meat_type: e.target.value as 'beef' | 'chicken' } : row,
                        ),
                      }))
                    }
                  >
                    <option value="beef">{tx(lang, 'Mal əti', 'Говядина', 'Beef')}</option>
                    <option value="chicken">{tx(lang, 'Toyuq əti', 'Курица', 'Chicken')}</option>
                  </select>
                  <input
                    className="neon-input"
                    type="number"
                    min={1}
                    step="0.01"
                    value={tracked.raw_to_ready_ratio || ''}
                    onChange={(e) =>
                      setYieldManagement((prev) => ({
                        ...prev,
                        tracked_items: prev.tracked_items.map((row) =>
                          row.inventory_name === tracked.inventory_name ? { ...row, raw_to_ready_ratio: e.target.value } : row,
                        ),
                      }))
                    }
                    placeholder={tx(lang, 'Çiy / hazır nisbəti', 'Соотношение сырой / готовой', 'Raw ratio')}
                  />
                  <button
                    type="button"
                    onClick={() => removeYieldTrackedInventory(tracked.inventory_name)}
                    className="rounded-lg border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10"
                  >
                    {tx(lang, 'Çıxar', 'Убрать', 'Remove')}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        {renderPanelSuccess('yield')}
        <div className="flex justify-end">
          <button onClick={() => { void saveYieldManagement(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>
    </>
  );
}
