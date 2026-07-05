/**
 * PaymentModal — Table check settlement modal.
 * Renders discount controls, payment method selection, cash/split inputs, and settle button.
 * All business logic (settle API call, receipt generation) is delegated via onSettle callback.
 */
import React from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import {
  buildEqualSplitParts,
  getMaxSplitCount,
  normalizeSplitCount,
  rebalanceSplitParts,
  type SplitPart,
  type BillBreakdown,
} from '../../utils/tables/paymentUtils';

const TABLE_DISCOUNT_PRESETS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const;

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

  const { itemsTotal, discountPercent, discountAmount, discountedItemsTotal, serviceFee, deposit, finalTotal, dueNow, splitBasis, guestCount, depositPerGuestShare } = breakdown;
  const participantCount = normalizeSplitCount(table, splitCount, splitCount);

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
      <div className="metal-panel w-full max-w-md rounded-t-[28px] p-5 md:rounded-2xl">
        <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />
        <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Open check hesabını bağla', 'Закрыть открытый чек', 'Close open check')}</h3>
        <div className="mt-3 text-sm text-slate-300">
          {table.label} - {finalTotal.toFixed(2)} ₼ ({tx(lang, 'əlavə ödəniş', 'доплата', 'extra due')}: {dueNow.toFixed(2)} ₼)
        </div>

        {/* Bill breakdown */}
        <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-300">
          <div className="flex justify-between"><span>{tx(lang, 'Sifariş cəmi', 'Сумма заказа', 'Items total')}</span><span>{itemsTotal.toFixed(2)} ₼</span></div>
          {discountAmount.greaterThan(0) && (
            <>
              <div className="mt-1 flex justify-between text-amber-200"><span>{tx(lang, `Endirim (${discountPercent.toFixed(0)}%)`, `Скидка (${discountPercent.toFixed(0)}%)`, `Discount (${discountPercent.toFixed(0)}%)`)}</span><span>-{discountAmount.toFixed(2)} ₼</span></div>
              <div className="mt-1 flex justify-between"><span>{tx(lang, 'Endirimdən sonra', 'После скидки', 'After discount')}</span><span>{discountedItemsTotal.toFixed(2)} ₼</span></div>
            </>
          )}
          <div className="mt-1 flex justify-between"><span>{tx(lang, 'Servis haqqı', 'Сервисный сбор', 'Service fee')}</span><span>{serviceFee.toFixed(2)} ₼</span></div>
          <div className="mt-1 flex justify-between"><span>{tx(lang, 'Depozit', 'Депозит', 'Deposit')}</span><span>{deposit.toFixed(2)} ₼</span></div>
          <div className="mt-1 flex justify-between font-semibold text-slate-100"><span>{tx(lang, 'Yekun hesab', 'Итоговый счет', 'Final bill')}</span><span>{finalTotal.toFixed(2)} ₼</span></div>
          <div className="mt-1 flex justify-between text-emerald-200"><span>{tx(lang, 'Hazırda alınacaq', 'К оплате сейчас', 'Due now')}</span><span>{dueNow.toFixed(2)} ₼</span></div>
        </div>

        {/* Discount section */}
        <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-400/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-100">{tx(lang, 'Endirim tətbiq et', 'Применить скидку', 'Apply discount')}</div>
            <select className="neon-input max-w-[132px] py-2 text-sm" value={tableDiscountPercent} onChange={(e) => onDiscountChange(e.target.value)}>
              <option value="0">{tx(lang, 'Endirim yox', 'Без скидки', 'No discount')}</option>
              {TABLE_DISCOUNT_PRESETS.map((preset) => (<option key={preset} value={preset}>{preset}%</option>))}
            </select>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {TABLE_DISCOUNT_PRESETS.map((preset) => (
              <button key={preset} type="button" onClick={() => onDiscountChange(preset)} className={`rounded-lg border px-2 py-2 text-xs font-black transition ${Number(tableDiscountPercent) === preset ? 'border-amber-200 bg-amber-300 text-slate-950' : 'border-amber-300/25 bg-slate-950/25 text-amber-100 hover:border-amber-200/70'}`}>{preset}%</button>
            ))}
          </div>
          {Number(tableDiscountPercent) > 0 && (
            <div className="mt-3">
              <input type="text" value={tableDiscountReason} onChange={(e) => onDiscountReasonChange(e.target.value)} placeholder={tx(lang, 'Endirim səbəbi (məs. Müştəri məmnuniyyəti)', 'Причина скидки', 'Discount reason')} className="neon-input h-10 w-full text-xs" required />
            </div>
          )}
          <button type="button" className="mt-2 text-xs font-semibold text-slate-300 hover:text-white" onClick={() => onDiscountChange(0)}>{tx(lang, 'Endirimi sıfırla', 'Сбросить скидку', 'Reset discount')}</button>
        </div>

        {/* Payment method */}
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{tx(lang, 'Ödəniş ssenarisi', 'Сценарий оплаты', 'Payment scenario')}</div>
          <div className="grid grid-cols-3 gap-2">
            {(['Nəğd', 'Kart', 'Split'] as const).map((m) => (
              <button key={m} onClick={() => { onPaymentMethodChange(m); if (m === 'Split') { const count = normalizeSplitCount(table, splitCount, splitCount); onSplitCountChange(String(count)); onSplitPartsChange(buildEqualSplitParts(count, splitBasis)); } }} className={`pay-btn h-11 ${paymentMethod === m ? 'pay-btn-active' : ''}`}>
                {m === 'Nəğd' ? tx(lang, 'Tam nəğd', 'Полностью наличными', 'All cash') : m === 'Kart' ? tx(lang, 'Tam kart', 'Полностью картой', 'All card') : tx(lang, 'Split ödə', 'Split оплата', 'Split payment')}
              </button>
            ))}
          </div>
        </div>

        {/* Cash section */}
        {paymentMethod === 'Nəğd' && (() => {
          const cashPaid = new Decimal(Number(splitCash) || 0);
          const change = cashPaid.greaterThan(dueNow) ? cashPaid.minus(dueNow) : new Decimal(0);
          const exact = dueNow.toNumber();
          const presets: number[] = [exact];
          [5, 10, 20, 50, 100].forEach((val) => { if (val > exact && presets.length < 5) presets.push(val); });
          while (presets.length < 5) { const last = presets[presets.length - 1] || exact; presets.push(last <= 5 ? 10 : last <= 10 ? 20 : last <= 20 ? 50 : last <= 50 ? 100 : last + 50); }
          return (
            <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">{tx(lang, 'Müştəridən alınan nəğd pul', 'Полученные наличные', 'Cash received')}</label>
              <div className="flex gap-2">
                <input className="neon-input flex-1 h-11 text-base font-bold text-white" type="number" step="0.01" min="0" value={splitCash === '0' ? '' : splitCash} placeholder={dueNow.toFixed(2)} onChange={(e) => onSplitCashChange(e.target.value || '0')} />
                <button type="button" onClick={() => onSplitCashChange(dueNow.toFixed(2))} className="rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-bold text-slate-200 taktil-target active:scale-95">{tx(lang, 'Dəqiq', 'Точно', 'Exact')}</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {presets.slice(1).map((val) => (
                  <button key={val} type="button" onClick={() => onSplitCashChange(val.toFixed(2))} className={`flex-1 min-w-[50px] rounded-lg border py-1.5 px-2 text-xs font-black transition taktil-target active:scale-95 ${Number(splitCash) === val ? 'border-amber-200 bg-amber-300 text-slate-950' : 'border-slate-700/60 bg-slate-800/40 text-slate-350 hover:bg-slate-800/70'}`}>{val} ₼</button>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-slate-800/50 pt-2 text-sm">
                <span className="font-semibold text-slate-400">{tx(lang, 'Qalıq pul', 'Сдача', 'Change')}</span>
                <span className={`text-base font-black ${cashPaid.greaterThan(dueNow) ? 'text-emerald-400 animate-pulse' : 'text-slate-100'}`}>{change.toFixed(2)} ₼</span>
              </div>
            </div>
          );
        })()}

        {/* Split section */}
        {paymentMethod === 'Split' && (() => {
          const partsTotal = splitParts.reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0)).toDecimalPlaces(2);
          const diff = splitBasis.minus(partsTotal).toDecimalPlaces(2);
          return (
            <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
              <div className="mb-3 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
                <div className="flex justify-between gap-3"><span>{tx(lang, 'Qonaq sayı', 'Количество гостей', 'Guest count')}</span><span>{guestCount}</span></div>
                <div className="mt-1 flex justify-between gap-3"><span>{tx(lang, 'Depozit (cəmi)', 'Депозит (итого)', 'Deposit total')}</span><span>{deposit.toFixed(2)} ₼</span></div>
                <div className="mt-1 flex justify-between gap-3"><span>{tx(lang, '1 qonaq üçün depozit payı', 'Доля депозита на 1 гостя', 'Deposit share per guest')}</span><span>{depositPerGuestShare.toFixed(2)} ₼</span></div>
                <div className="mt-1 flex justify-between gap-3"><span>{tx(lang, 'Servis haqqı', 'Сервисный сбор', 'Service fee')}</span><span>{serviceFee.toFixed(2)} ₼</span></div>
              </div>
              <label className="block text-sm text-slate-300">
                {tx(lang, 'Check neçə hissəyə bölünsün?', 'На сколько частей разделить чек?', 'How many parts?')}
                <input className="neon-input mt-2" type="number" min={2} max={getMaxSplitCount(table)} value={splitCount} onChange={(e) => { const c = normalizeSplitCount(table, e.target.value, splitCount); onSplitCountChange(String(c)); onSplitPartsChange(buildEqualSplitParts(c, splitBasis)); }} />
              </label>
              <div className="mt-3 space-y-2">
                {(splitParts.length === participantCount ? splitParts : buildEqualSplitParts(participantCount, splitBasis)).map((part, idx) => (
                  <div key={`split_part_${idx}`} className="grid grid-cols-[1fr_120px] gap-2">
                    <input className="neon-input" type="number" min={0} step="0.01" value={part.amount} onChange={(e) => { const next = splitParts.length === participantCount ? [...splitParts] : buildEqualSplitParts(participantCount, splitBasis); onSplitPartsChange(rebalanceSplitParts(next, splitBasis, idx, e.target.value)); }} placeholder={`${tx(lang, 'Hissə', 'Часть', 'Part')} ${idx + 1}`} />
                    <select className="neon-input" value={part.method} onChange={(e) => { const next = splitParts.length === participantCount ? [...splitParts] : buildEqualSplitParts(participantCount, splitBasis); next[idx] = { ...next[idx], method: e.target.value as 'Nəğd' | 'Kart' }; onSplitPartsChange(next); }}>
                      <option value="Nəğd">{tx(lang, 'Nəğd', 'Наличные', 'Cash')}</option>
                      <option value="Kart">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <span>{tx(lang, 'Bölünəcək məbləğ', 'Сумма к разделению', 'Amount to split')}: {splitBasis.toFixed(2)} ₼</span>
                <span className={diff.abs().greaterThan(0.01) ? 'text-rose-300' : 'text-emerald-300'}>{tx(lang, 'Fərq', 'Разница', 'Diff')}: {diff.toFixed(2)} ₼</span>
              </div>
            </div>
          );
        })()}

        {/* Action buttons */}
        <div className="mt-4 flex justify-end gap-2">
          <button className="neon-btn rounded-lg px-4 py-2" onClick={onCancel}>{tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}</button>
          <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={onSettle}>{tx(lang, 'Bağla', 'Закрыть', 'Settle')}</button>
        </div>
      </div>
    </div>
  );
}
