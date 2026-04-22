import React, { useMemo, useState } from 'react';
import { BookOpen, MessageCircleQuestion, Search, Send, X } from 'lucide-react';
import { tx } from '../i18n';
import { buildHelpAnswer, getManualEntries, type HelpLang } from '../lib/help_assistant';

type HelpMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: string[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  lang: HelpLang;
  currentModule: string;
};

const seedMessage = (lang: HelpLang): HelpMessage => ({
  id: 'seed',
  role: 'assistant',
  text: tx(
    lang,
    'Salam. Sualını yaz, sənə əvvəlcə User Manual-dan, sonra global əməliyyat tövsiyələrindən cavab verim.',
    'Привет. Напишите вопрос — сначала отвечу по User Manual, затем добавлю общие операционные рекомендации.',
    'Hi. Ask your question and I will answer using the User Manual first, then add global operational guidance.',
  ),
});

export default function HelpAssistant({ open, onClose, lang, currentModule }: Props) {
  const [question, setQuestion] = useState('');
  const [manualQuery, setManualQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>(() => [seedMessage(lang)]);
  const manualEntries = useMemo(() => getManualEntries(lang), [lang]);
  const [selectedManualId, setSelectedManualId] = useState<string>(manualEntries[0]?.id || '');

  React.useEffect(() => {
    setMessages([seedMessage(lang)]);
    const nextEntries = getManualEntries(lang);
    setSelectedManualId(nextEntries[0]?.id || '');
  }, [lang]);

  const placeholder = useMemo(
    () =>
      tx(
        lang,
        'Məsələn: “Tenant not configured” çıxır, nə yoxlayım?',
        'Например: «Tenant not configured», что проверить?',
        'For example: “Tenant not configured”, what should I check?',
      ),
    [lang],
  );
  const filteredEntries = useMemo(() => {
    const q = manualQuery.trim().toLowerCase();
    if (!q) return manualEntries;
    return manualEntries.filter((entry) =>
      `${entry.title} ${entry.content}`.toLowerCase().includes(q),
    );
  }, [manualEntries, manualQuery]);

  const selectedManual = useMemo(
    () => manualEntries.find((entry) => entry.id === selectedManualId) || filteredEntries[0] || manualEntries[0],
    [manualEntries, filteredEntries, selectedManualId],
  );

  const ask = async () => {
    const raw = String(question || '').trim();
    if (!raw || loading) return;
    const userMsg: HelpMessage = { id: `u_${Date.now()}`, role: 'user', text: raw };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');
    setLoading(true);
    try {
      const out = buildHelpAnswer(raw, lang, currentModule);
      if (out.sources.length > 0) {
        const firstSource = out.sources[0];
        const match = manualEntries.find((entry) => entry.title === firstSource);
        if (match) setSelectedManualId(match.id);
      }
      const botMsg: HelpMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        text: out.answer,
        sources: out.sources,
      };
      setMessages((prev) => [...prev, botMsg]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 md:p-6">
      <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-cyan-300/30 bg-slate-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3 md:px-5">
          <div className="flex items-center gap-2 text-cyan-200">
            <MessageCircleQuestion size={18} />
            <span className="text-sm font-semibold">
              {tx(lang, 'Help Assistant', 'Help Assistant', 'Help Assistant')}
            </span>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-600 px-2 py-1 text-slate-300 hover:border-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.2fr_1fr]">
          <section className="flex min-h-0 flex-col border-b border-slate-700/70 p-4 lg:border-b-0 lg:border-r lg:border-slate-700/70">
            <div className="max-h-[58vh] min-h-0 flex-1 space-y-3 overflow-y-auto">
              {messages.map((msg) => (
                <div key={msg.id} className={msg.role === 'user' ? 'text-right' : ''}>
                  <div
                    className={
                      msg.role === 'user'
                        ? 'ml-10 inline-block rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-3 py-2 text-left text-sm text-cyan-50'
                        : 'mr-10 inline-block rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-left text-sm text-slate-100'
                    }
                  >
                    <div className="whitespace-pre-line">{msg.text}</div>
                    {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 text-xs text-slate-400">
                        {tx(lang, 'Mənbə', 'Источник', 'Source')}: {msg.sources.join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="text-xs text-slate-400">
                  {tx(lang, 'Cavab hazırlanır...', 'Готовлю ответ...', 'Preparing answer...')}
                </div>
              )}
            </div>
            <div className="mt-4 border-t border-slate-700/70 pt-3">
              <div className="flex items-center gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void ask();
                  }}
                  className="neon-input h-11 flex-1"
                  placeholder={placeholder}
                />
                <button onClick={() => void ask()} disabled={loading} className="neon-btn h-11 px-3 disabled:opacity-60">
                  <Send size={16} />
                </button>
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-col p-4">
            <div className="mb-3 flex items-center gap-2 text-cyan-200">
              <BookOpen size={16} />
              <span className="text-sm font-semibold">{tx(lang, 'User Manual', 'User Manual', 'User Manual')}</span>
            </div>
            <div className="relative mb-3">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                className="neon-input h-10 w-full pl-9"
                placeholder={tx(lang, 'Manual-da axtar', 'Поиск по manual', 'Search manual')}
              />
            </div>
            <div className="mb-3 flex gap-2 overflow-x-auto">
              {filteredEntries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setSelectedManualId(entry.id)}
                  className={
                    selectedManual?.id === entry.id
                      ? 'rounded-full border border-cyan-300/45 bg-cyan-400/18 px-3 py-1 text-xs font-semibold text-cyan-100'
                      : 'rounded-full border border-slate-600/70 bg-slate-900/60 px-3 py-1 text-xs text-slate-300'
                  }
                >
                  {entry.title}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-700/70 bg-slate-900/70 p-3">
              {selectedManual ? (
                <>
                  <div className="text-sm font-semibold text-slate-100">{selectedManual.title}</div>
                  <div className="mt-2 whitespace-pre-line text-sm text-slate-300">{selectedManual.content}</div>
                </>
              ) : (
                <div className="text-sm text-slate-400">
                  {tx(lang, 'Manual bölməsi tapılmadı.', 'Раздел manual не найден.', 'Manual entry not found.')}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
