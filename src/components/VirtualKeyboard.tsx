import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Delete, Minimize2, CornerDownLeft, ArrowBigUpDash } from 'lucide-react';
import { tx } from '../i18n';

type KeyboardLang = 'az' | 'ru' | 'en';
type KeyboardTarget = HTMLInputElement | HTMLTextAreaElement;
type KeyboardMode = 'alpha' | 'numeric' | 'pin';
type TargetMeta = { label: string; type: string; sensitive: boolean };

const DIGIT_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const PUNCTUATION_ROW = ['-', '/', ':', '@', '.', ',', '_'];

const LETTER_LAYOUTS: Record<KeyboardLang, string[][]> = {
  az: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'ü', 'ğ'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ə'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', 'ç', 'ş', 'ı'],
  ],
  ru: [
    ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
    ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
    ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю'],
  ],
  en: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  ],
};

function isKeyboardTarget(node: EventTarget | null): node is KeyboardTarget {
  if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement)) return false;
  if (!node.classList.contains('neon-input')) return false;
  if (node.disabled || node.readOnly) return false;
  if (node.dataset.virtualKeyboard === 'off') return false;
  if (node instanceof HTMLInputElement) {
    const type = String(node.type || 'text').toLowerCase();
    if (['date', 'time', 'datetime-local', 'month', 'week', 'checkbox', 'radio', 'range', 'file', 'color', 'hidden'].includes(type)) {
      return false;
    }
  }
  return true;
}

function canUseSelection(target: KeyboardTarget) {
  return !(target instanceof HTMLInputElement && ['number', 'tel', 'email'].includes(String(target.type || '').toLowerCase()));
}

function setNativeValue(target: KeyboardTarget, value: string) {
  const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) descriptor.set.call(target, value);
  else target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertAtCursor(target: KeyboardTarget, text: string) {
  const current = String(target.value || '');
  const supportsSelection = canUseSelection(target);
  const start = supportsSelection ? (target.selectionStart ?? current.length) : current.length;
  const end = supportsSelection ? (target.selectionEnd ?? current.length) : current.length;
  const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
  setNativeValue(target, next);
  const cursor = start + text.length;
  window.requestAnimationFrame(() => {
    target.focus();
    if (supportsSelection) {
      target.setSelectionRange(cursor, cursor);
    }
  });
}

function backspaceAtCursor(target: KeyboardTarget) {
  const current = String(target.value || '');
  const supportsSelection = canUseSelection(target);
  const start = supportsSelection ? (target.selectionStart ?? current.length) : current.length;
  const end = supportsSelection ? (target.selectionEnd ?? current.length) : current.length;
  if (start === 0 && end === 0) return;
  if (start !== end) {
    const next = `${current.slice(0, start)}${current.slice(end)}`;
    setNativeValue(target, next);
    window.requestAnimationFrame(() => {
      target.focus();
      if (supportsSelection) {
        target.setSelectionRange(start, start);
      }
    });
    return;
  }
  const next = `${current.slice(0, start - 1)}${current.slice(end)}`;
  setNativeValue(target, next);
  const cursor = Math.max(0, start - 1);
  window.requestAnimationFrame(() => {
    target.focus();
    if (supportsSelection) {
      target.setSelectionRange(cursor, cursor);
    }
  });
}

function detectKeyboardMode(target: KeyboardTarget): KeyboardMode {
  const placeholder = String(target.getAttribute('data-original-placeholder') || target.getAttribute('placeholder') || '').toLowerCase();
  const inputMode = String((target as HTMLInputElement).inputMode || '').toLowerCase();
  const type = target instanceof HTMLInputElement ? String(target.type || 'text').toLowerCase() : 'textarea';

  if (target.dataset.virtualKeyboardMode === 'numeric') return 'numeric';
  if (target.dataset.virtualKeyboardMode === 'pin') return 'pin';
  if (type === 'number' || type === 'tel' || inputMode === 'numeric' || inputMode === 'decimal') return 'numeric';
  if (placeholder.includes('pin')) return 'pin';
  return 'alpha';
}

function appendValue(target: KeyboardTarget, value: string) {
  setNativeValue(target, `${String(target.value || '')}${value}`);
  window.requestAnimationFrame(() => target.focus());
}

export default function VirtualKeyboard({ lang, enabled = true }: { lang: KeyboardLang; enabled?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [layout, setLayout] = useState<KeyboardLang>(lang);
  const [shift, setShift] = useState(false);
  const [mode, setMode] = useState<KeyboardMode>('alpha');
  const [targetMeta, setTargetMeta] = useState<TargetMeta>({ label: '', type: 'text', sensitive: false });
  const targetRef = useRef<KeyboardTarget | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const typedValueRef = useRef('');

  useEffect(() => {
    setLayout(lang);
  }, [lang]);

  useEffect(() => {
    if (!enabled) {
      targetRef.current = null;
      setVisible(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !visible) {
      window.dispatchEvent(new CustomEvent('virtual-keyboard-visibility', { detail: { visible: false, height: 0 } }));
      return;
    }
    const notifyInset = () => {
      const height = Math.max(0, Number(rootRef.current?.offsetHeight || 0));
      window.dispatchEvent(new CustomEvent('virtual-keyboard-visibility', { detail: { visible: true, height } }));
    };
    notifyInset();
    const timer = window.setTimeout(notifyInset, 120);
    return () => {
      window.clearTimeout(timer);
      window.dispatchEvent(new CustomEvent('virtual-keyboard-visibility', { detail: { visible: false, height: 0 } }));
    };
  }, [enabled, visible]);

  useEffect(() => {
    if (!enabled || !visible) return;
    const target = targetRef.current;
    if (!target) return;
    const timeoutId = window.setTimeout(() => {
      try {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      } catch {
        // no-op
      }
    }, 80);
    return () => window.clearTimeout(timeoutId);
  }, [enabled, visible]);

  useEffect(() => {
    if (!enabled) return;
    const handleFocusIn = (event: FocusEvent) => {
      if (!isKeyboardTarget(event.target)) return;
      targetRef.current = event.target;
      typedValueRef.current = event.target.value || '';
      setMode(detectKeyboardMode(event.target));
      setTargetMeta({
        label: event.target.getAttribute('data-original-placeholder') || event.target.getAttribute('placeholder') || '',
        type: event.target instanceof HTMLInputElement ? String(event.target.type || 'text') : 'textarea',
        sensitive: event.target instanceof HTMLInputElement && String(event.target.type || 'text').toLowerCase() === 'password',
      });
      setVisible(true);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const nextTarget = event.target;
      if (rootRef.current?.contains(nextTarget as Node)) return;
      if (isKeyboardTarget(nextTarget)) return;
      if ((nextTarget as HTMLElement | null)?.closest?.('.virtual-keyboard-host')) return;
      targetRef.current = null;
      typedValueRef.current = '';
      setVisible(false);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [enabled]);

  const alphaRows = useMemo(() => {
    const current = LETTER_LAYOUTS[layout];
    return [DIGIT_ROW, ...current, PUNCTUATION_ROW].map((row) =>
      row.map((key) => (shift ? key.toLocaleUpperCase(layout) : key)),
    );
  }, [layout, shift]);

  const numericRows = useMemo(() => {
    if (mode === 'pin') {
      return [
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
        ['0'],
      ];
    }
    return [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      [targetMeta.type === 'tel' ? '+' : '.', '0', '-'],
    ];
  }, [mode, targetMeta.type]);

  const syncTypedValue = (target: KeyboardTarget) => {
    const currentVal = target.value || '';
    const trackedVal = typedValueRef.current;
    
    const isSameNumeric = (() => {
      if (currentVal === trackedVal) return true;
      if (!currentVal || !trackedVal) return false;
      if (trackedVal.endsWith('.') && trackedVal.slice(0, -1) === currentVal) return true;
      if (trackedVal.endsWith('.0') && trackedVal.slice(0, -2) === currentVal) return true;
      return false;
    })();
    
    if (!isSameNumeric) {
      typedValueRef.current = currentVal;
    }
  };

  const pressKey = (value: string) => {
    const target = targetRef.current;
    if (!target) return;
    if (mode === 'numeric' || mode === 'pin') {
      syncTypedValue(target);
      typedValueRef.current = `${typedValueRef.current}${value}`;
      setNativeValue(target, typedValueRef.current);
      window.requestAnimationFrame(() => target.focus());
    } else {
      insertAtCursor(target, value);
    }
    if (shift) setShift(false);
  };

  const onMouseDownKey = (event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault();
  };

  if (!enabled || !visible) return null;

  return (
    <div
      ref={rootRef}
      className="virtual-keyboard-host fixed inset-x-0 bottom-0 z-[130] border-t border-slate-700/70 bg-slate-950/96 shadow-[0_-24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
    >
      <div className="mx-auto w-full max-w-[1400px] px-3 py-3 md:px-4">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">
              {tx(lang, 'Virtual klaviatura', 'Виртуальная клавиатура', 'Virtual keyboard')}
            </div>
            <div className="mt-1 truncate text-sm font-bold text-slate-200">
              {targetMeta.sensitive
                ? tx(lang, 'Təhlükəsiz şifrə sahəsi', 'Защищенное поле пароля', 'Secure password field')
                : targetMeta.label || tx(lang, 'Mətn daxil edin', 'Введите текст', 'Enter text')}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              {targetMeta.sensitive
                ? tx(lang, 'Simvollar gizli saxlanılır. Lazım olduqda ABC və 123 arasında keçin.', 'Символы остаются скрытыми. При необходимости переключайтесь между ABC и 123.', 'Characters stay hidden. Switch between ABC and 123 when needed.')
                : tx(lang, 'Toxunaraq yazın.', 'Печатайте касанием.', 'Type with touch.')}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {targetMeta.sensitive && (
              <button
                onMouseDown={onMouseDownKey}
                onTouchStart={onMouseDownKey}
                onClick={() => setMode((prev) => (prev === 'alpha' ? 'numeric' : 'alpha'))}
                className="min-h-11 rounded-2xl border border-slate-700 bg-slate-900 px-4 text-sm font-black text-slate-100"
              >
                {mode === 'alpha' ? '123' : 'ABC'}
              </button>
            )}
            {(['az', 'ru', 'en'] as KeyboardLang[]).map((langKey) => (
              <button
                key={langKey}
                onMouseDown={onMouseDownKey}
                onTouchStart={onMouseDownKey}
                onClick={() => setLayout(langKey)}
                className={`min-h-11 rounded-2xl px-4 text-sm font-black ${layout === langKey ? 'bg-yellow-400 text-slate-950' : 'border border-slate-700 bg-slate-900 text-slate-100'}`}
              >
                {langKey.toUpperCase()}
              </button>
            ))}
            <button
              onMouseDown={onMouseDownKey}
              onTouchStart={onMouseDownKey}
              onClick={() => setVisible(false)}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-4 text-sm font-black text-slate-100"
            >
              <Minimize2 size={16} />
              <span>{tx(lang, 'Bağla', 'Закрыть', 'Close')}</span>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {(mode === 'alpha' ? alphaRows : numericRows).map((row, rowIndex) => (
            <div
              key={`row_${rowIndex}`}
              className={mode === 'alpha' ? 'grid grid-cols-10 gap-2 md:grid-cols-12' : 'grid grid-cols-3 gap-3 md:max-w-[420px]'}
            >
              {row.map((key) => (
                <button
                  key={`${rowIndex}_${key}`}
                  onMouseDown={onMouseDownKey}
                  onTouchStart={onMouseDownKey}
                  onClick={() => pressKey(key)}
                  className={`${mode === 'alpha' ? 'min-h-12 text-lg' : 'min-h-16 text-2xl'} rounded-2xl border border-slate-700 bg-slate-900 px-2 font-black text-slate-100 shadow-[0_8px_20px_rgba(0,0,0,0.25)]`}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}

          {mode === 'alpha' ? (
            <div className="grid grid-cols-12 gap-2">
              <button
                onMouseDown={onMouseDownKey}
                onTouchStart={onMouseDownKey}
                onClick={() => setShift((prev) => !prev)}
                className={`col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-black ${shift ? 'border-yellow-300 bg-yellow-400 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-100'}`}
              >
                <ArrowBigUpDash size={16} />
                <span>{tx(lang, 'Shift', 'Shift', 'Shift')}</span>
              </button>
              <button
                onMouseDown={onMouseDownKey}
                onTouchStart={onMouseDownKey}
                onClick={() => pressKey(' ')}
                className="col-span-6 min-h-12 rounded-2xl border border-slate-700 bg-slate-900 text-base font-black text-slate-100"
              >
                {tx(lang, 'Boşluq', 'Пробел', 'Space')}
              </button>
              <button
                onMouseDown={onMouseDownKey}
                onTouchStart={onMouseDownKey}
                onClick={() => {
                  const target = targetRef.current;
                  if (!target) return;
                  if (target instanceof HTMLTextAreaElement) {
                    insertAtCursor(target, '\n');
                    return;
                  }
                  target.blur();
                  setVisible(false);
                }}
                className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-3 text-sm font-black text-slate-100"
              >
                <CornerDownLeft size={16} />
                <span>{tx(lang, 'Enter', 'Enter', 'Enter')}</span>
              </button>
              <button
                onMouseDown={onMouseDownKey}
                onTouchStart={onMouseDownKey}
                onClick={() => {
                  const target = targetRef.current;
                  if (!target) return;
                  backspaceAtCursor(target);
                }}
                className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-400/35 bg-rose-950/40 px-3 text-sm font-black text-rose-100"
              >
                <Delete size={16} />
                <span>{tx(lang, 'Sil', 'Удалить', 'Backspace')}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 md:max-w-[420px]">
              <button
                onMouseDown={onMouseDownKey}
                onTouchStart={onMouseDownKey}
                onClick={() => {
                  const target = targetRef.current;
                  if (!target) return;
                  syncTypedValue(target);
                  if (typedValueRef.current.length > 0) {
                    typedValueRef.current = typedValueRef.current.slice(0, -1);
                    setNativeValue(target, typedValueRef.current);
                  }
                  window.requestAnimationFrame(() => target.focus());
                }}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-rose-400/35 bg-rose-950/40 px-3 text-base font-black text-rose-100"
              >
                <Delete size={16} />
                <span>{tx(lang, 'Sil', 'Удалить', 'Backspace')}</span>
              </button>
              <button
                onMouseDown={onMouseDownKey}
                onTouchStart={onMouseDownKey}
                onClick={() => {
                  const target = targetRef.current;
                  if (!target) return;
                  target.blur();
                  setVisible(false);
                }}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-3 text-base font-black text-slate-100"
              >
                <CornerDownLeft size={16} />
                <span>{tx(lang, 'Hazırdır', 'Готово', 'Done')}</span>
              </button>
              <button
                onMouseDown={onMouseDownKey}
                onTouchStart={onMouseDownKey}
                onClick={() => setMode('alpha')}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-3 text-base font-black text-slate-100"
              >
                <span>{tx(lang, 'ABC', 'ABC', 'ABC')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
