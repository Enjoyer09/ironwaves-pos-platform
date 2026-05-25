import React, { useMemo, useState, useEffect, useRef } from 'react';
import { MessageCircleQuestion, Send, X, Bot } from 'lucide-react';
import { tx } from '../i18n';
import { chat_with_agent } from '../api/agent_api';

export type HelpLang = 'az' | 'ru' | 'en';

type HelpMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
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
    'Salam! Mən IronWaves POS sisteminin süni intellekt köməkçisiyəm. Bütün təlimatları öyrənmişəm. Sizə necə kömək edə bilərəm?',
    'Привет! Я ИИ-ассистент системы IronWaves POS. Я изучил все инструкции. Чем могу помочь?',
    'Hi! I am the IronWaves POS AI assistant. I have learned all the manuals. How can I help you?',
  ),
});

export default function HelpAssistant({ open, onClose, lang, currentModule }: Props) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>(() => [seedMessage(lang)]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll to bottom when messages change
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const placeholder = useMemo(
    () =>
      tx(
        lang,
        'Məsələn: Z-hesabatı necə çıxarım?',
        'Например: Как снять Z-отчет?',
        'For example: How do I print a Z-report?',
      ),
    [lang],
  );

  const ask = async () => {
    const raw = String(question || '').trim();
    if (!raw || loading) return;
    
    const userMsg: HelpMessage = { id: `u_${Date.now()}`, role: 'user', text: raw };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setQuestion('');
    setLoading(true);
    
    try {
      // Send chat history to backend
      const apiMessages = updatedMessages
        .filter(m => m.id !== 'seed') // Optional: skip seed, or send it for context
        .map(m => ({
          role: m.role,
          content: m.text
        }));
        
      const replyText = await chat_with_agent(apiMessages, lang);
      
      const botMsg: HelpMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        text: replyText,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (e) {
      const errorMsg: HelpMessage = {
        id: `e_${Date.now()}`,
        role: 'assistant',
        text: tx(
          lang, 
          'Bağışlayın, xəta baş verdi. Zəhmət olmasa bir az sonra təkrar cəhd edin.',
          'Извините, произошла ошибка. Пожалуйста, попробуйте позже.',
          'Sorry, an error occurred. Please try again later.'
        )
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 md:p-6 backdrop-blur-sm">
      <div className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-cyan-400/40 bg-slate-950/95 shadow-[0_0_80px_rgba(34,211,238,0.15)]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/70 bg-slate-900/50 px-6 py-4">
          <div className="flex items-center gap-3 text-cyan-300">
            <Bot size={24} />
            <div>
              <div className="text-lg font-bold">
                {tx(lang, 'AI Köməkçi', 'AI Ассистент', 'AI Assistant')}
              </div>
              <div className="text-xs text-slate-400">
                IronWaves POS {currentModule ? `- ${currentModule}` : ''}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-700 bg-slate-800/50 p-2 text-slate-300 hover:border-slate-500 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Chat Area */}
        <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
          <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="mr-3 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-950 border border-cyan-800">
                    <Bot size={16} className="text-cyan-400" />
                  </div>
                )}
                
                <div
                  className={`max-w-[85%] whitespace-pre-line rounded-2xl px-5 py-3 text-[15px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-cyan-600 text-white rounded-tr-sm shadow-md'
                      : 'border border-slate-700 bg-slate-800/80 text-slate-200 rounded-tl-sm shadow-md'
                  }`}
                >
                  {msg.text}
                </div>
                
                {msg.role === 'user' && (
                  <div className="ml-3 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 border border-slate-700">
                    <div className="text-xs font-bold text-slate-400">ME</div>
                  </div>
                )}
              </div>
            ))}
            
            {loading && (
              <div className="flex justify-start">
                <div className="mr-3 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-950 border border-cyan-800">
                  <Bot size={16} className="text-cyan-400" />
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-slate-700 bg-slate-800/80 px-5 py-4 shadow-md">
                  <div className="flex gap-1.5">
                    <div className="h-2 w-2 animate-bounce rounded-full bg-cyan-500 [animation-delay:-0.3s]"></div>
                    <div className="h-2 w-2 animate-bounce rounded-full bg-cyan-500 [animation-delay:-0.15s]"></div>
                    <div className="h-2 w-2 animate-bounce rounded-full bg-cyan-500"></div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Input Area */}
          <div className="mt-4 pt-4 border-t border-slate-800">
            <div className="relative flex items-center">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void ask();
                }}
                className="w-full rounded-xl border border-slate-600 bg-slate-900 py-4 pl-5 pr-14 text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-all shadow-inner"
                placeholder={placeholder}
                autoFocus
              />
              <button 
                onClick={() => void ask()} 
                disabled={loading || !question.trim()} 
                className="absolute right-2 flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-600 text-white transition-colors hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500"
              >
                <Send size={18} className={question.trim() && !loading ? 'translate-x-[-1px] translate-y-[1px]' : ''} />
              </button>
            </div>
            <div className="mt-2 text-center text-[10px] text-slate-500 uppercase tracking-widest">
              AI Köməkçi • Bütün suallarınızı cavablamağa hazırdır
            </div>
          </div>
        </div>
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.5);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(34, 211, 238, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(34, 211, 238, 0.4);
        }
      `}</style>
    </div>
  );
}
