import React, { useState } from 'react';
import { tx } from '../../i18n';
import { normalizeOrderItemStatus, itemActionNeedsManager, itemActionLabel } from '../../utils/tables/tableUtils';

interface ItemActionModalProps {
  target: { item: any; action: string };
  lang: string;
  onClose: () => void;
  onConfirm: (params: {
    action: string;
    reason: string;
    reason_code: string;
    quantity_delta?: number;
    manager_password?: string;
    remake_note?: string;
  }) => Promise<void>;
}

export default function ItemActionModal({ target, lang, onClose, onConfirm }: ItemActionModalProps) {
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('guest_changed_mind');
  const [quantityDelta, setQuantityDelta] = useState('1');
  const [managerPassword, setManagerPassword] = useState('');

  const actionStatus = normalizeOrderItemStatus(target.item?.status || 'DRAFT');
  const quickAction = actionStatus === 'DRAFT';
  const actionName = String(target.action || '').toUpperCase();
  const actionRequiresManager = itemActionNeedsManager(actionName, actionStatus);
  const needsReason = !quickAction;
  const quantityMax = Math.max(1, Number(target.item?.qty || 1));

  const labels = {
    decrease: tx(lang, 'Azalt', 'Уменьшить', 'Reduce'),
    void_: tx(lang, 'Ləğv et', 'Отменить', 'Cancel'),
    comp: tx(lang, 'Hesabdan sil', 'Списать из счета', 'Comp'),
    waste: tx(lang, 'İsraf', 'Списание', 'Waste'),
    remake: tx(lang, 'Yenidən düzəlt', 'Переделать', 'Correct'),
  };

  return (
    <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/70 p-4">
      <div className="metal-panel w-full max-w-lg p-5">
        <h3 className="text-lg font-bold text-slate-100">
          {tx(lang, 'Item əməliyyatı', 'Операция по позиции', 'Item action')} · {target.item?.item_name}
        </h3>
        <div className="mt-2 text-sm text-slate-300">
          {quickAction
            ? tx(lang, 'Bu item hələ hazırlanma mərhələsinə keçməyib. Sürətli düzəliş admin şifrəsiz işləyəcək.', 'Эта позиция еще не перешла в приготовление. Быстрое изменение пройдет без пароля админа.', 'This item has not moved into prep yet. Quick change will work without admin password.')
            : tx(lang, 'Seçilmiş action audit log-a yazılacaq və item izsiz silinməyəcək.', 'Выбранное действие попадет в аудит, позиция не исчезнет бесследно.', 'The selected action will be logged and the item will not disappear without trace.')}
        </div>
        <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-300">
          <div className="flex justify-between"><span>{tx(lang, 'Cari status', 'Текущий статус', 'Current status')}</span><span>{target.item?.status || '-'}</span></div>
          <div className="mt-1 flex justify-between"><span>{tx(lang, 'Action', 'Действие', 'Action')}</span><span>{itemActionLabel(target.action, labels)}</span></div>
        </div>
        {actionName === 'DECREASE' && !quickAction && (
          <label className="mt-4 block text-sm text-slate-300">
            {tx(lang, 'Azaldılacaq miqdar', 'Количество для уменьшения', 'Quantity to reduce')}
            <input
              type="number"
              min={1}
              max={quantityMax}
              className="neon-input mt-1"
              value={quantityDelta}
              onChange={(e) => setQuantityDelta(String(Math.max(1, Math.min(quantityMax, Number(e.target.value || 1)))))}
            />
          </label>
        )}
        {needsReason && (
          <div className="mt-4 grid gap-3">
            <label className="block text-sm text-slate-300">
              {tx(lang, 'Səbəb tipi', 'Тип причины', 'Reason type')}
              <select className="neon-input mt-1" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                <option value="wrong_entry">{tx(lang, 'Səhv daxil edilib', 'Ошибочно введено', 'Wrong entry')}</option>
                <option value="guest_changed_mind">{tx(lang, 'Müştəri fikrini dəyişdi', 'Гость передумал', 'Guest changed mind')}</option>
                <option value="duplicate">{tx(lang, 'Dublikat sifariş', 'Дубликат заказа', 'Duplicate order')}</option>
                <option value="kitchen_mistake">{tx(lang, 'Mətbəx səhvi', 'Ошибка кухни', 'Kitchen mistake')}</option>
                <option value="other">{tx(lang, 'Digər', 'Другое', 'Other')}</option>
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              {tx(lang, 'Qeyd', 'Заметка', 'Note')}
              <textarea className="neon-input mt-1 min-h-[84px]" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
        )}
        {actionRequiresManager && (
          <label className="mt-3 block text-sm text-slate-300">
            {tx(lang, 'Manager/Admin şifrəsi', 'Пароль менеджера/админа', 'Manager/Admin password')}
            <input type="password" className="neon-input mt-1" value={managerPassword} onChange={(e) => setManagerPassword(e.target.value)} />
          </label>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="neon-btn rounded-lg px-4 py-2" onClick={onClose}>
            {tx(lang, 'Bağla', 'Закрыть', 'Close')}
          </button>
          <button
            type="button"
            className="glossy-gold rounded-lg px-4 py-2 font-semibold"
            onClick={async () => {
              const nextReason = quickAction
                ? tx(lang, 'Sürətli düzəliş', 'Быстрое изменение', 'Quick change')
                : (reason.trim() || itemActionLabel(target.action, labels));
              await onConfirm({
                action: target.action,
                reason: nextReason,
                reason_code: reasonCode,
                quantity_delta: actionName === 'DECREASE' ? Math.max(1, Math.min(quantityMax, Number(quantityDelta || 1))) : undefined,
                manager_password: actionRequiresManager ? managerPassword.trim() : undefined,
                remake_note: target.action === 'REMAKE' ? nextReason : undefined,
              });
            }}
          >
            {tx(lang, 'Təsdiqlə', 'Подтвердить', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
