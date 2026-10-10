/**
 * Settings UI utilities
 * Extracted from Settings.tsx for testability
 */

import type { AiProvider } from '../contexts/SettingsContext';

/**
 * Font size bounds
 */
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 20;

/**
 * Validate font size input
 * @param size - Font size in pixels
 * @returns True if font size is valid
 */
export function validateFontSize(size: number): boolean {
  return Number.isInteger(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE;
}

/**
 * Get a human-readable label for an AI provider
 * @param id - AI provider ID
 * @returns Display label
 */
export function getProviderLabel(id: AiProvider): string {
  switch (id) {
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
    case 'openrouter':
      return 'OpenRouter';
    case 'ollama':
      return 'Ollama';
    case 'custom-openai':
      return 'OpenAI Compatible';
    case 'minimax':
      return 'MiniMax';
    default:
      return String(id).charAt(0).toUpperCase() + String(id).slice(1);
  }
}

/**
 * Check if a font family is a predefined preset
 * @param fontFamily - Font family name
 * @param availableFonts - List of available font presets
 * @returns True if font is a preset
 */
export function isPresetFont(
  fontFamily: string,
  availableFonts: ReadonlyArray<{ name: string; label: string }>
): boolean {
  return availableFonts.some((f) => f.name === fontFamily);
}

/**
 * Check if an API key appears to be valid (basic format check)
 * @param key - API key to validate
 * @returns True if key appears valid
 */
export function isValidApiKeyFormat(key: string): boolean {
  const trimmed = key.trim();
  // API keys should be at least 10 characters and contain alphanumeric/special chars
  return trimmed.length >= 10 && /^[A-Za-z0-9_\-:.]+$/.test(trimmed);
}

/**
 * Format a roadmap feature for display
 * @param label - Feature label
 * @param done - Whether the feature is completed
 * @returns Formatted display object
 */
export function formatRoadmapFeature(label: string, done: boolean): {
  label: string;
  status: 'completed' | 'pending';
  icon: '✓' | '○';
} {
  return {
    label,
    status: done ? 'completed' : 'pending',
    icon: done ? '✓' : '○',
  };
}
