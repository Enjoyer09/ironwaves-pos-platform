import { apiRequest, isBackendEnabled } from './client';

export type PlatformAiModel = {
  id: string;
  name: string;
  provider?: string;
};

export type PlatformAiModelsResponse = {
  success: boolean;
  provider: 'opencode';
  default_model: string;
  models: PlatformAiModel[];
};

export async function get_platform_ai_models(): Promise<PlatformAiModelsResponse> {
  if (!isBackendEnabled()) {
    return {
      success: true,
      provider: 'opencode',
      default_model: 'deepseek-v4-flash',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash Free', provider: 'OpenCode Zen' },
        { id: 'glm-5', name: 'GLM 5', provider: 'OpenCode Zen' },
        { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', provider: 'OpenCode Zen' },
      ],
    };
  }
  return apiRequest<PlatformAiModelsResponse>('/api/v1/ops/ai/opencode/models', {
    tenantId: null,
    timeoutMs: 15000,
  });
}

export async function platform_ai_generate(args: {
  model?: string;
  prompt: string;
  system?: string;
  temperature?: number;
  max_tokens?: number;
  timeout_seconds?: number;
}): Promise<string> {
  if (!isBackendEnabled()) {
    throw new Error('OpenCode Platform AI üçün backend aktiv olmalıdır.');
  }
  const response = await apiRequest<{ text?: string }>('/api/v1/ops/ai/opencode/generate', {
    method: 'POST',
    tenantId: null,
    timeoutMs: Math.max(10000, Number(args.timeout_seconds || 45) * 1000),
    body: {
      model: args.model,
      prompt: args.prompt,
      system: args.system || '',
      temperature: args.temperature ?? 0.2,
      max_tokens: args.max_tokens ?? 800,
      timeout_seconds: args.timeout_seconds ?? 45,
    },
  });
  return String(response?.text || '').trim();
}
