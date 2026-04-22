import React, { useMemo, useState } from 'react';
import { MessageCircleQuestion, Send, X } from 'lucide-react';
import { tx } from '../i18n';
import { buildHelpAnswer, type HelpLang } from '../lib/help_assistant';

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
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>(() => [seedMessage(lang)]);

  React.useEffect(() => {
    setMessages([seedMessage(lang)]);
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

  const ask = async () => {
    const raw = String(question || '').trim();
    if (!raw || loading) return;
    const userMsg: HelpMessage = { id: `u_${Date.now()}`, role: 'user', text: raw };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');
    setLoading(true);
    try {
      const out = buildHelpAnswer(raw, lang, currentModule);
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
    <div className="fixed inset-0 z-[100] flex items-end justify-end bg-black/40 p-3 md:p-6">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-cyan-300/30 bg-slate-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
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

        <div className="max-h-[55vh] space-y-3 overflow-y-auto px-4 py-4">
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

        <div className="border-t border-slate-700/70 px-4 py-3">
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
      </div>
    </div>
  );
}

