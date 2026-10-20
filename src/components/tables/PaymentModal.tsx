import React, { useState } from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import { useAppStore } from '../../store';
import { Banknote, CreditCard, Split, Tag, Check, X } from 'lucide-react';
import {
  buildEqualSplitParts,
  getMaxSplitCount,
  normalizeSplitCount,
  rebalanceSplitParts,
  type SplitPart,
  type BillBreakdown,
} from '../../utils/tables/paymentUtils';

const TABLE_DISCOUNT_PRESETS = [5, 10, 15, 20, 25, 30, 50] as const;

export interface PaymentModalProps {
  lang: string;
  table: any;
  breakdown: BillBreakdown;
  paymentMethod: 'Nəğd' | 'Kart' | 'Split';
  tableDiscountPercent: string;
  tableDiscountReason: string;
  splitCash: string;
  splitCount: string;
  splitParts: SplitPart[];
  onPaymentMethodChange: (m: 'Nəğd' | 'Kart' | 'Split') => void;
  onDiscountChange: (value: number | string) => void;
  onDiscountReasonChange: (reason: string) => void;
  onSplitCashChange: (cash: string) => void;
  onSplitCountChange: (count: string) => void;
  onSplitPartsChange: (parts: SplitPart[]) => void;
  onSettle: () => void;
  onCancel: () => void;
}

export default function PaymentModal(props: PaymentModalProps) {
  const {
    lang, table, breakdown, paymentMethod, tableDiscountPercent, tableDiscountReason,
    splitCash, splitCount, splitParts,
    onPaymentMethodChange, onDiscountChange, onDiscountReasonChange,
    onSplitCashChange, onSplitCountChange, onSplitPartsChange,
    onSettle, onCancel,
  } = props;

  const { itemsTotal, discountPercent, discountAmount, serviceFee, deposit, finalTotal, dueNow, splitBasis, guestCount } = breakdown;
  const participantCount = normalizeSplitCount(table, splitCount, splitCount);
  const currentRole = useAppStore((s) => String(s.user?.role || '').toLowerCase());
  const canApplyDiscount = ['admin', 'manager', 'super_admin'].includes(currentRole);
  const [showDiscountPanel, setShowDiscountPanel] = useState(() => Number(tableDiscountPercent || 0) > 0);

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/75 backdrop-blur-xs p-0 md:items-center md:p-4" onClick={onCancel}>
      <div
        className="metal-panel w-full max-w-lg max-h-[94dvh] overflow-y-auto rounded-t-[28px] p-5 md:rounded-3xl shadow-2xl border border-slate-700/80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />

        {/* Header: Table Label + Due Now Total */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {tx(lang, 'Hesabı Bağla · Ödəniş Ekranı', 'Оплата счёта', 'Checkout & Payment')}
            </div>
            <h3 className="text-xl font-black text-white mt-0.5">{table.label}</h3>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {tx(lang, 'Ödəniləcək Yekun', 'К оплате', 'Amount Due')}
            </div>
            <div className="text-2xl font-black text-amber-400 tabular-nums">
              {dueNow.toFixed(2)} ₼
            </div>
          </div>
        </div>

        {/* Compact Bill Breakdown */}
        <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-xs text-slate-300 space-y-1 tabular-nums">
          <div className="flex justify-between">
            <span>{tx(lang, 'Sifariş cəmi', 'Сумма заказа', 'Items subtotal')}</span>
            <span className="font-semibold text-slate-200">{itemsTotal.toFixed(2)} ₼</span>
          </div>
          {discountAmount.greaterThan(0) && (
            <div className="flex justify-between text-amber-300 font-semibold">
              <span>{tx(lang, `Endirim (-${discountPercent.toFixed(0)}%)`, `Скидка (-${discountPercent.toFixed(0)}%)`, `Discount (-${discountPercent.toFixed(0)}%)`)}</span>
              <span>-{discountAmount.toFixed(2)} ₼</span>
            </div>
          )}
          {serviceFee.greaterThan(0) && (
            <div className="flex justify-between">
              <span>{tx(lang, 'Servis haqqı', 'Сервисный сбор', 'Service fee')}</span>
              <span>+{serviceFee.toFixed(2)} ₼</span>
            </div>
          )}
          {deposit.greaterThan(0) && (
            <div className="flex justify-between text-cyan-300">
              <span>{tx(lang, 'Öncədən depozit', 'Депозит', 'Deposit paid')}</span>
              <span>-{deposit.toFixed(2)} ₼</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-800/80 pt-1.5 text-sm font-black text-white">
            <span>{tx(lang, 'Yekun hesab', 'Итоговый счёт', 'Final bill')}</span>
            <span className="text-emerald-400">{finalTotal.toFixed(2)} ₼</span>
          </div>
        </div>

        {/* Manager Discount Toggle & Presets */}
        {canApplyDiscount && (
          <div className="mt-3">
            {!showDiscountPanel && Number(tableDiscountPercent || 0) === 0 ? (
              <button
                type="button"
                onClick={() => setShowDiscountPanel(true)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800/80 hover:text-amber-300 transition"
              >
                <span className="flex items-center gap-1.5">
                  <Tag size={14} className="text-amber-400" />
                  <span>{tx(lang, 'Menecer Endirimi əlavə et (%)', 'Добавить скидку менеджера (%)', 'Add Manager Discount (%)')}</span>
                </span>
                <span className="text-slate-400">+</span>
              </button>
            ) : (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                    <Tag size={13} />
                    {tx(lang, 'Endirim faizi', 'Процент скидки', 'Discount %')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onDiscountChange(0);
                      setShowDiscountPanel(false);
                    }}
                    className="text-[11px] font-bold text-slate-300 hover:text-white px-2 py-0.5 rounded bg-slate-900/60"
                  >
                    {tx(lang, 'Sıfırla', 'Сбросить', 'Reset')}
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {TABLE_DISCOUNT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onDiscountChange(preset)}
                      className={`h-9 rounded-xl border text-xs font-black transition active:scale-95 tabular-nums ${
                        Number(tableDiscountPercent) === preset
                          ? 'border-amber-200 bg-amber-400 text-slate-950 shadow-sm'
                          : 'border-amber-300/25 bg-slate-950/50 text-amber-100 hover:border-amber-300/60'
                      }`}
                    >
                      {preset}%
                    </button>
                  ))}
                </div>
                {Number(tableDiscountPercent) > 0 && (
                  <input
                    type="text"
                    value={tableDiscountReason}
                    onChange={(e) => onDiscountReasonChange(e.target.value)}
                    placeholder={tx(lang, 'Endirim səbəbi (məs. Daimi müştəri)', 'Причина скидки', 'Discount reason')}
                    className="neon-input !min-h-9 h-9 w-full text-xs"
                    required
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Large Touch Payment Method Selector */}
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            {tx(lang, 'Ödəniş üsulunu seçin', 'Выберите способ оплаты', 'Select payment method')}
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => onPaymentMethodChange('Nəğd')}
              className={`flex flex-col items-center justify-center gap-1 h-16 rounded-2xl border-2 font-black text-xs sm:text-sm transition active:scale-95 taktil-target ${
                paymentMethod === 'Nəğd'
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200 shadow-lg shadow-emerald-500/15'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              <Banknote size={20} className={paymentMethod === 'Nəğd' ? 'text-emerald-300' : 'text-slate-400'} />
              <span>{tx(lang, 'Nəğd', 'Наличные', 'Cash')}</span>
            </button>

            <button
              type="button"
              onClick={() => onPaymentMethodChange('Kart')}
              className={`flex flex-col items-center justify-center gap-1 h-16 rounded-2xl border-2 font-black text-xs sm:text-sm transition active:scale-95 taktil-target ${
                paymentMethod === 'Kart'
                  ? 'border-sky-400 bg-sky-500/20 text-sky-200 shadow-lg shadow-sky-500/15'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              <CreditCard size={20} className={paymentMethod === 'Kart' ? 'text-sky-300' : 'text-slate-400'} />
              <span>{tx(lang, 'Kart / POS', 'Карта / POS', 'Card / POS')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onPaymentMethodChange('Split');
                const count = normalizeSplitCount(table, splitCount, splitCount);
                onSplitCountChange(String(count));
                onSplitPartsChange(buildEqualSplitParts(count, splitBasis));
              }}
              className={`flex flex-col items-center justify-center gap-1 h-16 rounded-2xl border-2 font-black text-xs sm:text-sm transition active:scale-95 taktil-target ${
                paymentMethod === 'Split'
                  ? 'border-amber-400 bg-amber-500/20 text-amber-200 shadow-lg shadow-amber-500/15'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              <Split size={20} className={paymentMethod === 'Split' ? 'text-amber-300' : 'text-slate-400'} />
              <span>{tx(lang, 'Hissəli / Split', 'Разделить', 'Split Bill')}</span>
            </button>
          </div>
        </div>

        {/* Cash Denomination & Change Calculator */}
        {paymentMethod === 'Nəğd' && (() => {
          const cashPaid = new Decimal(Number(splitCash) || 0);
          const change = cashPaid.greaterThan(dueNow) ? cashPaid.minus(dueNow) : new Decimal(0);
          const exact = dueNow.toNumber();
          const presets: number[] = [exact];
          [5, 10, 20, 50, 100].forEach((val) => { if (val > exact && presets.length < 5) presets.push(val); });
          while (presets.length < 5) {
            const last = presets[presets.length - 1] || exact;
            presets.push(last <= 5 ? 10 : last <= 10 ? 20 : last <= 20 ? 50 : last <= 50 ? 100 : last + 50);
          }
          return (
            <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300">
                  {tx(lang, 'Müştəridən alınan nəğd pul', 'Полученные наличные', 'Cash received')}
                </label>
                {cashPaid.greaterThan(0) && (
                  <button
                    type="button"
                    onClick={() => onSplitCashChange('0')}
                    className="text-[11px] font-bold text-amber-400 hover:text-amber-300"
                  >
                    {tx(lang, 'Təmizlə', 'Сброс', 'Clear')}
                  </button>
                )}
              </div>

              {/* Quick Touch Banknote Buttons */}
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  onClick={() => onSplitCashChange(dueNow.toFixed(2))}
                  className={`h-10 rounded-xl border text-xs font-black transition active:scale-95 ${
                    cashPaid.equals(dueNow) && splitCash !== '0'
                      ? 'border-emerald-400 bg-emerald-400 text-slate-950'
                      : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {tx(lang, 'Dəqiq', 'Точно', 'Exact')}
                </button>
                {presets.slice(1).map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => onSplitCashChange(val.toFixed(2))}
                    className={`h-10 rounded-xl border text-xs font-black transition active:scale-95 tabular-nums ${
                      Number(splitCash) === val
                        ? 'border-amber-300 bg-amber-400 text-slate-950'
                        : 'border-slate-700/80 bg-slate-900 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {val} ₼
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  className="neon-input flex-1 h-11 text-base font-black text-white tabular-nums"
                  type="number"
                  step="0.01"
                  min="0"
                  value={splitCash === '0' ? '' : splitCash}
                  placeholder={dueNow.toFixed(2)}
                  onChange={(e) => onSplitCashChange(e.target.value || '0')}
                />
                <div className="flex flex-col items-end justify-center rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 h-11 min-w-[135px]">
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    {tx(lang, 'Qalıq (Sdaca)', 'Сдача', 'Change')}
                  </span>
                  <span className={`text-sm font-black tabular-nums ${cashPaid.greaterThan(dueNow) ? 'text-emerald-400' : 'text-slate-200'}`}>
                    {change.toFixed(2)} ₼
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Split Bill Section */}
        {paymentMethod === 'Split' && (() => {
          const partsTotal = splitParts.reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0)).toDecimalPlaces(2);
          const diff = splitBasis.minus(partsTotal).toDecimalPlaces(2);
          return (
            <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-300">
                  {tx(lang, 'Neçə hissəyə bölünsün?', 'На сколько частей разделить?', 'Split into how many parts?')} ({guestCount} {tx(lang, 'qonaq', 'гостей', 'guests')})
                </span>
                <div className="flex items-center gap-1">
                  {[2, 3, 4, 5].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        const norm = normalizeSplitCount(table, c, splitCount);
                        onSplitCountChange(String(norm));
                        onSplitPartsChange(buildEqualSplitParts(norm, splitBasis));
                      }}
                      className={`h-8 w-8 rounded-lg text-xs font-black transition ${
                        participantCount === c
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {(splitParts.length === participantCount ? splitParts : buildEqualSplitParts(participantCount, splitBasis)).map((part, idx) => (
                  <div key={`split_part_${idx}`} className="grid grid-cols-[1fr_110px] gap-2">
                    <input
                      className="neon-input !min-h-10 h-10 text-sm font-bold tabular-nums"
                      type="number"
                      min={0}
                      step="0.01"
                      value={part.amount}
                      onChange={(e) => {
                        const next = splitParts.length === participantCount ? [...splitParts] : buildEqualSplitParts(participantCount, splitBasis);
                        onSplitPartsChange(rebalanceSplitParts(next, splitBasis, idx, e.target.value));
                      }}
                      placeholder={`${tx(lang, 'Hissə', 'Часть', 'Part')} ${idx + 1}`}
                    />
                    <select
                      className="neon-input !min-h-10 h-10 text-xs font-bold"
                      value={part.method}
                      onChange={(e) => {
                        const next = splitParts.length === participantCount ? [...splitParts] : buildEqualSplitParts(participantCount, splitBasis);
                        next[idx] = { ...next[idx], method: e.target.value as 'Nəğd' | 'Kart' };
                        onSplitPartsChange(next);
                      }}
                    >
                      <option value="Nəğd">{tx(lang, 'Nəğd', 'Наличные', 'Cash')}</option>
                      <option value="Kart">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800/80 tabular-nums">
                <span>{tx(lang, 'Bölünəcək məbləğ', 'Сумма к разделению', 'Amount to split')}: {splitBasis.toFixed(2)} ₼</span>
                <span className={diff.abs().greaterThan(0.01) ? 'text-rose-300 font-bold' : 'text-emerald-300 font-bold'}>
                  {tx(lang, 'Fərq', 'Разница', 'Diff')}: {diff.toFixed(2)} ₼
                </span>
              </div>
            </div>
          );
        })()}

        {/* Bottom Primary CTA Row */}
        <div className="mt-5 flex items-center gap-2.5">
          <button
            type="button"
            className="flex h-13 items-center justify-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800/90 px-5 text-sm font-bold text-slate-200 hover:bg-slate-700 active:scale-95 transition"
            onClick={onCancel}
          >
            <X size={16} />
            <span>{tx(lang, 'Geri', 'Назад', 'Back')}</span>
          </button>
          <button
            type="button"
            className="flex h-13 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-emerald-500 px-6 text-base font-black text-slate-950 shadow-lg shadow-emerald-500/25 hover:brightness-105 active:scale-[0.98] transition taktil-target"
            onClick={onSettle}
          >
            <Check size={20} />
            <span>{tx(lang, 'Ödənişi Tamamla', 'Завершить оплату', 'Complete Payment')}</span>
            <span className="rounded-lg bg-slate-950/15 px-2 py-0.5 text-sm font-black tabular-nums">
              {dueNow.toFixed(2)} ₼
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
