import { apiRequest } from './client';

export interface BackgroundAgentInsight {
  id: string;
  type: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export async function fetch_agent_insights(): Promise<BackgroundAgentInsight[]> {
  try {
    const res = await apiRequest<{ success: boolean; insights: BackgroundAgentInsight[] }>(
      '/api/v1/ops/agent/insights',
      { method: 'GET', tenantId: null }
    );
    return res?.insights || [];
  } catch (error) {
    console.error('Failed to fetch agent insights', error);
    return [];
  }
}

export async function mark_agent_insight_read(id: string): Promise<void> {
  try {
    await apiRequest(`/api/v1/ops/agent/insights/${id}/read`, {
      method: 'POST',
      tenantId: null,
    });
  } catch (error) {
    console.error('Failed to mark insight read', error);
  }
}

export async function generate_ai_recipe_api(item_name: string): Promise<string> {
  try {
    const res = await apiRequest<{ success: boolean; recipe: string }>(
      '/api/v1/ops/agent/recipe/generate',
      {
        method: 'POST',
        tenantId: null,
        body: { item_name }
      }
    );
    return res?.recipe || '';
  } catch (error) {
    console.error('Failed to generate AI recipe', error);
    throw error;
  }
}

export async function chat_with_agent(messages: { role: string; content: string }[], lang: string): Promise<string> {
  try {
    const res = await apiRequest<{ success: boolean; reply: string }>(
      '/api/v1/ops/agent/chat',
      {
        method: 'POST',
        tenantId: null,
        body: { messages, lang }
      }
    );
    return res?.reply || '';
  } catch (error) {
    console.error('Failed to chat with agent', error);
    throw error;
  }
}
