export type AiProvider = 'google' | 'openai' | 'anthropic' | 'openrouter' | 'xai' | 'huggingface' | 'ollama' | 'ollama_freeapi' | 'opencode' | 'freemodel' | 'unknown';

export type AiDetectionResult = {
  provider: AiProvider;
  model: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
};

export const DEFAULT_MODEL_BY_PROVIDER: Record<AiProvider, string> = {
  google: 'gemini-1.5-flash',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  openrouter: 'openrouter/auto',
  xai: 'grok-2-latest',
  huggingface: 'mistralai/Mistral-7B-Instruct-v0.3',
  ollama: 'gpt-oss:20b',
  ollama_freeapi: 'llama3.2:3b',
  opencode: 'deepseek-v4-flash',
  freemodel: 'claude-sonnet-4-20250514',
  unknown: 'auto',
};

export function providerLabel(provider: AiProvider): string {
  const map: Record<AiProvider, string> = {
    google: 'Google',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    openrouter: 'OpenRouter',
    xai: 'xAI',
    huggingface: 'Hugging Face',
    ollama: 'Ollama Cloud',
    ollama_freeapi: 'OllamaFreeAPI (Experimental)',
    opencode: 'OpenCode Platform',
    freemodel: 'FreeModel.dev',
    unknown: 'Unknown',
  };
  return map[provider];
}

export function detectAiConfigFromApiKey(value: string): AiDetectionResult {
  const apiKey = String(value || '').trim();
  if (!apiKey) {
    return {
      provider: 'unknown',
      model: DEFAULT_MODEL_BY_PROVIDER.unknown,
      confidence: 'low',
      reason: 'Empty key',
    };
  }

  if (/^AIza[0-9A-Za-z\-_]{20,}$/.test(apiKey)) {
    return {
      provider: 'google',
      model: DEFAULT_MODEL_BY_PROVIDER.google,
      confidence: 'high',
      reason: 'Google key format detected (AIza...)',
    };
  }
  if (/^sk-ant-[A-Za-z0-9\-_]+$/.test(apiKey)) {
    return {
      provider: 'anthropic',
      model: DEFAULT_MODEL_BY_PROVIDER.anthropic,
      confidence: 'high',
      reason: 'Anthropic key format detected (sk-ant-...)',
    };
  }
  if (/^sk-or-v1-[A-Za-z0-9\-_]+$/.test(apiKey)) {
    return {
      provider: 'openrouter',
      model: DEFAULT_MODEL_BY_PROVIDER.openrouter,
      confidence: 'high',
      reason: 'OpenRouter key format detected (sk-or-v1-...)',
    };
  }
  if (/^xai-[A-Za-z0-9\-_]+$/.test(apiKey)) {
    return {
      provider: 'xai',
      model: DEFAULT_MODEL_BY_PROVIDER.xai,
      confidence: 'high',
      reason: 'xAI key format detected (xai-...)',
    };
  }
  if (/^hf_[A-Za-z0-9\-_]+$/.test(apiKey)) {
    return {
      provider: 'huggingface',
      model: DEFAULT_MODEL_BY_PROVIDER.huggingface,
      confidence: 'high',
      reason: 'Hugging Face key format detected (hf_...)',
    };
  }
  if (/^ollama[_\-][A-Za-z0-9\-_]+$/i.test(apiKey)) {
    return {
      provider: 'ollama',
      model: DEFAULT_MODEL_BY_PROVIDER.ollama,
      confidence: 'high',
      reason: 'Ollama API key format detected',
    };
  }
  if (/^(fre|fm|FRE|FM)[_\-][A-Za-z0-9\-_]+$/i.test(apiKey)) {
    return {
      provider: 'freemodel',
      model: DEFAULT_MODEL_BY_PROVIDER.freemodel,
      confidence: 'high',
      reason: 'FreeModel.dev key format detected',
    };
  }
  if (/^ol[a-z0-9][A-Za-z0-9\-_]{12,}$/i.test(apiKey) || /ollama/i.test(apiKey)) {
    return {
      provider: 'ollama',
      model: DEFAULT_MODEL_BY_PROVIDER.ollama,
      confidence: 'medium',
      reason: 'Ollama-like key signature detected',
    };
  }
  if (/^sk-(proj-|live-|test-|[A-Za-z0-9]).+/.test(apiKey)) {
    return {
      provider: 'openai',
      model: DEFAULT_MODEL_BY_PROVIDER.openai,
      confidence: 'medium',
      reason: 'OpenAI-like key format detected (sk-...)',
    };
  }

  return {
    provider: 'unknown',
    model: DEFAULT_MODEL_BY_PROVIDER.unknown,
    confidence: 'low',
    reason: 'Provider signature not recognized',
  };
}

export function canRunGeminiRemote(provider: AiProvider): boolean {
  return provider === 'google';
}
