import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Delete, Globe2, Minimize2, CornerDownLeft, ArrowBigUpDash } from 'lucide-react';
import { tx } from '../i18n';

type KeyboardLang = 'az' | 'ru' | 'en';
type KeyboardTarget = HTMLInputElement | HTMLTextAreaElement;

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
    if (['number', 'date', 'time', 'datetime-local', 'month', 'week', 'checkbox', 'radio', 'range', 'file', 'color', 'hidden'].includes(type)) {
      return false;
    }
  }
  return true;
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
  const start = target.selectionStart ?? current.length;
  const end = target.selectionEnd ?? current.length;
  const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
  setNativeValue(target, next);
  const cursor = start + text.length;
  window.requestAnimationFrame(() => {
    target.focus();
    target.setSelectionRange(cursor, cursor);
  });
}

function backspaceAtCursor(target: KeyboardTarget) {
  const current = String(target.value || '');
  const start = target.selectionStart ?? current.length;
  const end = target.selectionEnd ?? current.length;
  if (start === 0 && end === 0) return;
  if (start !== end) {
    const next = `${current.slice(0, start)}${current.slice(end)}`;
    setNativeValue(target, next);
    window.requestAnimationFrame(() => {
      target.focus();
      target.setSelectionRange(start, start);
    });
    return;
  }
  const next = `${current.slice(0, start - 1)}${current.slice(end)}`;
  setNativeValue(target, next);
  const cursor = Math.max(0, start - 1);
  window.requestAnimationFrame(() => {
    target.focus();
    target.setSelectionRange(cursor, cursor);
  });
}

export default function VirtualKeyboard({ lang }: { lang: KeyboardLang }) {
  const [visible, setVisible] = useState(false);
  const [layout, setLayout] = useState<KeyboardLang>(lang);
  const [shift, setShift] = useState(false);
  const [targetMeta, setTargetMeta] = useState<{ label: string; type: string }>({ label: '', type: 'text' });
  const targetRef = useRef<KeyboardTarget | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLayout(lang);
  }, [lang]);

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      if (!isKeyboardTarget(event.target)) return;
      targetRef.current = event.target;
      setTargetMeta({
        label: event.target.getAttribute('data-original-placeholder') || event.target.getAttribute('placeholder') || '',
        type: event.target instanceof HTMLInputElement ? String(event.target.type || 'text') : 'textarea',
      });
      setVisible(true);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const nextTarget = event.target;
      if (rootRef.current?.contains(nextTarget as Node)) return;
      if (isKeyboardTarget(nextTarget)) return;
      if ((nextTarget as HTMLElement | null)?.closest?.('.virtual-keyboard-host')) return;
      targetRef.current = null;
      setVisible(false);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);

  const rows = useMemo(() => {
    const current = LETTER_LAYOUTS[layout];
    return [DIGIT_ROW, ...current, PUNCTUATION_ROW].map((row) =>
      row.map((key) => (shift ? key.toLocaleUpperCase(layout) : key)),
    );
  }, [layout, shift]);

  const pressKey = (value: string) => {
    const target = targetRef.current;
    if (!target) return;
    insertAtCursor(target, value);
    if (shift) setShift(false);
  };

  const onMouseDownKey = (event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault();
  };

  if (!visible) return null;

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
              {targetMeta.label || tx(lang, 'Mətn daxil edin', 'Введите текст', 'Enter text')}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
          {rows.map((row, rowIndex) => (
            <div key={`row_${rowIndex}`} className="grid grid-cols-10 gap-2 md:grid-cols-12">
              {row.map((key) => (
                <button
                  key={`${rowIndex}_${key}`}
                  onMouseDown={onMouseDownKey}
                  onTouchStart={onMouseDownKey}
                  onClick={() => pressKey(key)}
                  className="min-h-12 rounded-2xl border border-slate-700 bg-slate-900 px-2 text-lg font-black text-slate-100 shadow-[0_8px_20px_rgba(0,0,0,0.25)]"
                >
                  {key}
                </button>
              ))}
            </div>
          ))}

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
                insertAtCursor(target, '\n');
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
        </div>
      </div>
    </div>
  );
}
