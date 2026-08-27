import React, { useState, useMemo } from 'react';
import { tx } from '../../i18n';
import {
  getTenantNotePresets,
  saveTenantNotePreset,
  removeTenantNotePreset,
  recordNoteUsage,
  getSmartTopNotes,
} from '../../lib/order_note_presets';

type OrderNoteModalProps = {
  itemName: string;
  initialNote: string;
  lang: string;
  tenantId?: string;
  settingsPresets?: string[];
  onSave: (note: string) => void | Promise<void>;
  onClose: () => void;
};

const tapFeedback = () => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.(8);
    }
  } catch {}
};

export default function OrderNoteModal({
  itemName,
  initialNote,
  lang,
  tenantId = '',
  settingsPresets,
  onSave,
  onClose,
}: OrderNoteModalProps) {
  const [noteText, setNoteText] = useState(initialNote || '');
  const [presets, setPresets] = useState<string[]>(() => getTenantNotePresets(tenantId, settingsPresets));
  const [saving, setSaving] = useState(false);

  const smartTopNotes = useMemo(() => {
    return getSmartTopNotes(tenantId, presets, 6);
  }, [tenantId, presets]);

  const selectedTags = useMemo(() => {
    return noteText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [noteText]);

  const toggleTag = (tag: string) => {
    tapFeedback();
    const cleanTag = tag.trim();
    const isSelected = selectedTags.some((t) => t.toLowerCase() === cleanTag.toLowerCase());
    let nextText = '';
    if (isSelected) {
      nextText = selectedTags.filter((t) => t.toLowerCase() !== cleanTag.toLowerCase()).join(', ');
    } else {
      nextText = [...selectedTags, cleanTag].join(', ');
    }
    setNoteText(nextText);
  };

  const handleAddCustomPreset = (tagToAdd?: string) => {
    const target = String(tagToAdd || noteText || '').trim();
    if (!target) return;
    tapFeedback();
    const firstTag = target.split(',')[0].trim();
    if (!firstTag) return;
    const updated = saveTenantNotePreset(tenantId, firstTag);
    setPresets(updated);
  };

  const handleRemovePreset = (e: React.MouseEvent, tagToRemove: string) => {
    e.stopPropagation();
    tapFeedback();
    const updated = removeTenantNotePreset(tenantId, tagToRemove);
    setPresets(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanNote = noteText.trim();
      if (cleanNote) {
        recordNoteUsage(tenantId, cleanNote);
      }
      await onSave(cleanNote);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Determine if the current typed note can be pinned as a new custom preset
  const canPinNote = useMemo(() => {
    const raw = noteText.trim();
    if (!raw || raw.length < 2) return false;
    const firstPiece = raw.split(',')[0].trim();
    return Boolean(firstPiece && !presets.some((p) => p.toLowerCase() === firstPiece.toLowerCase()));
  }, [noteText, presets]);

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md flex flex-col rounded-t-2xl sm:rounded-2xl bg-slate-950 border border-slate-700/60 shadow-2xl max-h-[85vh] sm:max-h-[90vh] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black uppercase tracking-wider text-yellow-400">✎ {tx(lang, 'Qeyd və Modifikator', 'Примечание и Модификатор', 'Note & Modifier')}</span>
            </div>
            <div className="text-sm font-black text-slate-100 mt-0.5 truncate max-w-[240px]">{itemName}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 active:scale-95 taktil-target"
          >
            ✕
          </button>
        </div>

      {/* Body scroll */}
      <div className="mt-3 flex-1 min-h-0 overflow-y-auto space-y-3.5 pr-0.5 scrollbar-none">
        {/* Input box */}
        <div>
          <div className="relative flex items-center">
            <input
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={tx(lang, 'Sifariş qeydi daxil edin...', 'Введите примечание...', 'Type order note...')}
              className="neon-input h-11 w-full text-sm font-bold pr-9 focus:ring-yellow-300/20"
              autoFocus
            />
            {noteText && (
              <button
                type="button"
                onClick={() => setNoteText('')}
                className="absolute right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Pin / Save as Preset button if custom word typed */}
          {canPinNote && (
            <button
              type="button"
              onClick={() => handleAddCustomPreset()}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-yellow-400/90 hover:text-yellow-300 active:scale-95 transition"
            >
              <span>+ &quot;{noteText.split(',')[0].trim()}&quot;</span>
              <span className="underline">{tx(lang, 'şablonlara əlavə et (Pin)', 'добавить в шаблоны', 'add as preset')}</span>
            </button>
          )}
        </div>

        {/* Smart / Frequently Used Notes (if any learned) */}
        {smartTopNotes.length > 0 && (
          <div>
            <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-amber-400 mb-1.5">
              <span>🔥</span>
              <span>{tx(lang, 'Tez-tez İstifadə Olunanlar (Smart)', 'Часто используемые', 'Frequently Used')}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {smartTopNotes.map((tag) => {
                const isSelected = selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-xl border px-2.5 py-1.5 text-xs font-black transition active:scale-95 taktil-target ${
                      isSelected
                        ? 'border-amber-400 bg-amber-400/20 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.2)]'
                        : 'border-amber-500/30 bg-amber-950/20 text-amber-200/80 hover:border-amber-400/50'
                    }`}
                  >
                    + {tag}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Business Presets Grid */}
        <div>
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
            <span>📌 {tx(lang, 'Biznes Şablonları', 'Шаблоны заведения', 'Business Presets')}</span>
            <span className="text-[9px] text-slate-500 font-medium">({presets.length} {tx(lang, 'seçim', 'вариантов', 'options')})</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {presets.map((mod) => {
              const isSelected = selectedTags.some((t) => t.toLowerCase() === mod.toLowerCase());
              return (
                <div
                  key={mod}
                  onClick={() => toggleTag(mod)}
                  className={`group relative min-h-[42px] flex items-center justify-between rounded-xl border py-2 px-2.5 cursor-pointer transition select-none taktil-target ${
                    isSelected
                      ? 'border-yellow-400 bg-yellow-400/10 text-yellow-300 font-black shadow-sm'
                      : 'border-slate-800 bg-slate-900/60 text-slate-300 font-bold hover:border-slate-700'
                  }`}
                >
                  <span className="truncate text-xs">{mod}</span>
                  <button
                    type="button"
                    title={tx(lang, 'Şablonu sil', 'Удалить шаблон', 'Delete preset')}
                    onClick={(e) => handleRemovePreset(e, mod)}
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-400 text-slate-500 text-[11px] px-1 transition"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

        {/* Bottom Actions */}
        <div className="mt-3 border-t border-slate-800 pt-3 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800/80 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 active:scale-95 taktil-target"
          >
            {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-xl bg-gradient-to-b from-yellow-400 to-amber-500 py-2.5 text-xs font-black text-slate-950 shadow-md shadow-yellow-500/10 active:scale-95 hover:brightness-105 taktil-target disabled:opacity-50"
          >
            {tx(lang, 'Yadda Saxla', 'Сохранить', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
