import React, { useState } from 'react';
import { useAppStore } from '../../store';
import { analyze_business, inventory_audit, security_audit, update_api_key } from '../../api/ai_manager';
import { Bot, TrendingUp, ShieldAlert, PackageSearch, Loader2 } from 'lucide-react';
import { tx } from '../../i18n';

export default function AIManagerPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';

  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeAudit, setActiveAudit] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');

  const saveApiKey = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    update_api_key(apiKey);
    notify('success', tx(lang, 'API Key yadda saxlanıldı!', 'API ключ сохранен!'));
  };

  const handleAudit = async (type: 'business' | 'inventory' | 'security') => {
    if (!apiKey) {
      notify('error', tx(lang, 'Zəhmət olmasa əvvəlcə Gemini API Key daxil edin.', 'Сначала введите Gemini API ключ.'));
      return;
    }
    setLoading(true);
    setActiveAudit(type);
    setAiResponse(null);

    try {
      let response = '';
      
      const date_from = new Date();
      date_from.setDate(date_from.getDate() - 30);
      const to_str = new Date().toISOString();
      const from_str = date_from.toISOString();

      // Asinxron API simulyasiyası çağırışları
      if (type === 'business') {
        response = await analyze_business({ date_from: from_str, date_to: to_str, tenant_id });
      } else if (type === 'inventory') {
        response = await inventory_audit(tenant_id);
      } else if (type === 'security') {
        response = await security_audit({ date_from: from_str, date_to: to_str });
      }
      
      // Süni intellekt effekti vermək üçün kiçik gecikmə
      setTimeout(() => {
        setAiResponse(response);
        setLoading(false);
      }, 1500);
      
    } catch (err) {
      setAiResponse(tx(lang, 'Süni İntellekt analiz edərkən xəta yarandı.', 'Произошла ошибка при анализе AI.'));
      setLoading(false);
    }
  };

  return (
    <div className="text-slate-100">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
            <Bot className="text-indigo-500" size={32} />
            {tx(lang, 'AI Menecer', 'AI менеджер')}
          </h1>
          <p className="text-slate-300 mt-1">{tx(lang, 'Süni İntellekt əsaslı biznes, anbar və təhlükəsizlik analizləri', 'AI-анализ бизнеса, склада и безопасности')}</p>
        </div>
      </div>

      <div className="metal-panel p-6 rounded-xl border border-slate-700/70 flex gap-4 items-center mb-8">
        <div className="flex-1">
          <label className="block text-sm text-slate-300 font-bold mb-1">Gemini API Key</label>
          <input 
            type="password" 
            value={apiKey} 
            onChange={e => setApiKey(e.target.value)} 
            placeholder="AIzaSy..." 
            className="neon-input"
          />
        </div>
          <button onClick={saveApiKey} className="glossy-gold px-6 py-2 mt-5 rounded-lg font-semibold">{tx(lang, 'Yadda Saxla', 'Сохранить')}</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <button 
          onClick={() => handleAudit('business')}
          className={`p-6 rounded-2xl border transition-all text-left flex flex-col gap-4 ${activeAudit === 'business' ? 'border-indigo-400/70 bg-indigo-500/15' : 'border-slate-700/70 bg-slate-900/35 hover:border-indigo-300/60'}`}
        >
          <div className="w-12 h-12 bg-indigo-400/20 text-indigo-200 rounded-xl flex items-center justify-center border border-indigo-300/30">
            <TrendingUp size={24} />
          </div>
          <div>
             <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Biznes Analizi', 'Анализ бизнеса')}</h3>
             <p className="text-sm text-slate-300 mt-1">{tx(lang, 'Son 30 günün satışları, qazancı və müştəri tendensiyaları', 'Продажи, прибыль и тренды клиентов за 30 дней')}</p>
          </div>
        </button>

        <button 
          onClick={() => handleAudit('inventory')}
          className={`p-6 rounded-2xl border transition-all text-left flex flex-col gap-4 ${activeAudit === 'inventory' ? 'border-orange-400/70 bg-orange-500/15' : 'border-slate-700/70 bg-slate-900/35 hover:border-orange-300/60'}`}
        >
          <div className="w-12 h-12 bg-orange-400/20 text-orange-200 rounded-xl flex items-center justify-center border border-orange-300/30">
            <PackageSearch size={24} />
          </div>
          <div>
             <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Anbar Auditi', 'Аудит склада')}</h3>
             <p className="text-sm text-slate-300 mt-1">{tx(lang, 'Tükənməkdə olan malların və zay məhsulların analizi', 'Анализ заканчивающихся и списанных товаров')}</p>
          </div>
        </button>

        <button 
          onClick={() => handleAudit('security')}
          className={`p-6 rounded-2xl border transition-all text-left flex flex-col gap-4 ${activeAudit === 'security' ? 'border-red-400/70 bg-red-500/15' : 'border-slate-700/70 bg-slate-900/35 hover:border-red-300/60'}`}
        >
          <div className="w-12 h-12 bg-red-400/20 text-red-200 rounded-xl flex items-center justify-center border border-red-300/30">
            <ShieldAlert size={24} />
          </div>
          <div>
             <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Təhlükəsizlik Auditi', 'Аудит безопасности')}</h3>
             <p className="text-sm text-slate-300 mt-1">{tx(lang, 'Şübhəli ləğvlər (VOID), kassa fərqləri və personal hərəkətləri', 'Подозрительные VOID, разницы кассы и действия персонала')}</p>
          </div>
        </button>
      </div>

      <div className="metal-panel rounded-2xl border border-slate-700/70 min-h-[300px] flex flex-col">
        <div className="p-4 border-b border-slate-700/70 bg-slate-900/35 rounded-t-2xl">
          <h2 className="font-bold text-slate-100 flex items-center gap-2">
            <Bot size={20} className="text-indigo-500" />
            {tx(lang, 'Süni İntellekt Hesabatı', 'Отчет искусственного интеллекта')}
          </h2>
        </div>
        <div className="p-8 flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 mt-12">
              <Loader2 size={40} className="animate-spin text-indigo-500" />
               <p>{tx(lang, 'Məlumatlar toplanır və Gemini AI tərəfindən analiz edilir...', 'Собираются данные и анализируются Gemini AI...')}</p>
            </div>
          ) : aiResponse ? (
            <div className="prose max-w-none text-slate-200 whitespace-pre-line leading-relaxed">
              {aiResponse}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 mt-12">
              <Bot size={64} className="text-slate-500" />
               <p>{tx(lang, 'Zəhmət olmasa yuxarıdan bir audit növü seçin', 'Выберите тип аудита выше')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
