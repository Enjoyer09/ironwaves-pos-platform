import React from 'react';
import { tx } from '../../../i18n';
import { detectAiConfigFromApiKey, providerLabel as aiProviderLabel } from '../../../lib/ai_config';

export interface AISettingsSectionProps {
  lang: string;
  saveButtonClass: string;
  renderPanelSuccess: (panelId: string) => React.ReactNode;
  aiApiKey: string;
  setAiApiKey: (value: string) => void;
  saveAiApiKey: () => Promise<void>;
  menuCatalog: any[];
  inventoryCatalog: any[];
}

export function AISettingsSection({
  lang,
  saveButtonClass,
  renderPanelSuccess,
  aiApiKey,
  setAiApiKey,
  saveAiApiKey,
  menuCatalog,
  inventoryCatalog,
}: AISettingsSectionProps) {
  return (
    <div id="sec-ai" className="metal-panel p-6 space-y-4">
      <h2 className="text-xl font-bold text-slate-100">🤖 {tx(lang, 'AI Resept Konfiqurasiyası', 'AI Конфигурация рецептов', 'AI Recipe Configuration')}</h2>
      <p className="text-sm text-slate-400">
        {tx(lang, 'Resept AI agenti üçün API key konfiqurasiyası. Key formatına görə provider avtomatik tanınır.', 'Конфигурация API key для AI агента рецептов. Провайдер определяется автоматически по формату ключа.', 'API key configuration for the recipe AI agent. Provider is auto-detected from key format.')}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300">{tx(lang, 'AI API Key', 'AI API Key', 'AI API Key')}</label>
          <input className="neon-input w-full" type="password" value={aiApiKey} onChange={(e) => { setAiApiKey(e.target.value); }} placeholder="API key (FreeModel, Gemini, OpenRouter...)" />
          <p className="text-[10px] text-slate-500">{tx(lang, 'Key formatına görə provider avtomatik tanınır', 'Провайдер определяется автоматически', 'Provider is auto-detected from key format')}</p>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300">{tx(lang, 'Aşkarlanan provider', 'Определённый провайдер', 'Detected provider')}</label>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-4 py-3 text-sm text-slate-200">
            {aiApiKey ? `${aiProviderLabel(detectAiConfigFromApiKey(aiApiKey).provider)} · ${detectAiConfigFromApiKey(aiApiKey).model}` : tx(lang, 'Key daxil edilməyib', 'Ключ не введён', 'No key entered')}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-200/90 space-y-1">
        <div className="font-bold">{tx(lang, 'Dəstəklənən providerlər:', 'Поддерживаемые провайдеры:', 'Supported providers:')}</div>
        <div>• <strong>FreeModel.dev</strong> — Claude, GPT (pulsuz kredit)</div>
        <div>• <strong>Google Gemini</strong> — AIza... key</div>
        <div>• <strong>OpenRouter</strong> — sk-or-v1-... key</div>
        <div>• <strong>OpenAI</strong> — sk-... key</div>
        <div>• <strong>Anthropic</strong> — sk-ant-... key</div>
      </div>
      {renderPanelSuccess('ai')}
      <div className="flex justify-end">
        <button onClick={() => { void saveAiApiKey(); }} className={saveButtonClass}>
          {tx(lang, 'Saxla', 'Сохранить', 'Save')}
        </button>
      </div>
    </div>
  );
}
