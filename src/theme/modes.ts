import { oldModeTokens } from './tokens/old';
import { newModeTokens } from './tokens/new';

export type UiMode = 'old' | 'new';

export const themeTokensByMode = {
  old: oldModeTokens,
  new: newModeTokens,
} as const;

export function cleanUiMode(value: unknown): UiMode {
  return String(value || '').trim().toLowerCase() === 'new' ? 'new' : 'old';
}

