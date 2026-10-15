import { describe, it, expect } from 'vitest';
import {
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  validateFontSize,
  getProviderLabel,
  isPresetFont,
  isValidApiKeyFormat,
  formatRoadmapFeature,
} from '../../src/utils/settingsUI';
import type { AiProvider } from '../../src/contexts/SettingsContext';

describe('settingsUI', () => {
  describe('validateFontSize', () => {
    it('should validate font sizes within bounds', () => {
      expect(validateFontSize(14)).toBe(true);
      expect(validateFontSize(MIN_FONT_SIZE)).toBe(true);
      expect(validateFontSize(MAX_FONT_SIZE)).toBe(true);
    });

    it('should reject font sizes below minimum', () => {
      expect(validateFontSize(9)).toBe(false);
      expect(validateFontSize(0)).toBe(false);
      expect(validateFontSize(-5)).toBe(false);
    });

    it('should reject font sizes above maximum', () => {
      expect(validateFontSize(21)).toBe(false);
      expect(validateFontSize(100)).toBe(false);
    });

    it('should reject non-integer values', () => {
      expect(validateFontSize(14.5)).toBe(false);
      expect(validateFontSize(13.9)).toBe(false);
    });

    it('should reject NaN', () => {
      expect(validateFontSize(NaN)).toBe(false);
    });
  });

  describe('getProviderLabel', () => {
    it('should return correct label for OpenAI', () => {
      expect(getProviderLabel('openai' as AiProvider)).toBe('OpenAI');
    });

    it('should return correct label for Anthropic', () => {
      expect(getProviderLabel('anthropic' as AiProvider)).toBe('Anthropic');
    });

    it('should return correct label for OpenRouter', () => {
      expect(getProviderLabel('openrouter' as AiProvider)).toBe('OpenRouter');
    });

    it('should return correct label for MiniMax', () => {
      expect(getProviderLabel('minimax' as AiProvider)).toBe('MiniMax');
    });

    it('should capitalize unknown providers', () => {
      expect(getProviderLabel('custom' as AiProvider)).toBe('Custom');
      expect(getProviderLabel('test' as AiProvider)).toBe('Test');
    });
  });

  describe('isPresetFont', () => {
    const availableFonts = [
      { name: 'System', label: 'System Default' },
      { name: 'Roboto', label: 'Roboto' },
      { name: 'JetBrains Mono', label: 'JetBrains Mono' },
    ] as const;

    it('should return true for preset fonts', () => {
      expect(isPresetFont('System', availableFonts)).toBe(true);
      expect(isPresetFont('Roboto', availableFonts)).toBe(true);
      expect(isPresetFont('JetBrains Mono', availableFonts)).toBe(true);
    });

    it('should return false for custom fonts', () => {
      expect(isPresetFont('Arial', availableFonts)).toBe(false);
      expect(isPresetFont('Comic Sans', availableFonts)).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isPresetFont('system', availableFonts)).toBe(false);
      expect(isPresetFont('ROBOTO', availableFonts)).toBe(false);
    });

    it('should handle empty font list', () => {
      expect(isPresetFont('System', [])).toBe(false);
    });
  });

  describe('isValidApiKeyFormat', () => {
    it('should validate typical OpenAI keys', () => {
      expect(isValidApiKeyFormat('sk-1234567890abcdef')).toBe(true);
    });

    it('should validate typical Anthropic keys', () => {
      expect(isValidApiKeyFormat('sk-ant-1234567890')).toBe(true);
    });

    it('should validate keys with hyphens and underscores', () => {
      expect(isValidApiKeyFormat('api_key-123_456')).toBe(true);
    });

    it('should validate keys with colons and dots', () => {
      expect(isValidApiKeyFormat('key:123.456')).toBe(true);
    });

    it('should reject keys shorter than 10 characters', () => {
      expect(isValidApiKeyFormat('sk-123')).toBe(false);
      expect(isValidApiKeyFormat('key')).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(isValidApiKeyFormat('')).toBe(false);
    });

    it('should reject keys with invalid characters', () => {
      expect(isValidApiKeyFormat('sk-1234567890@#$')).toBe(false);
      expect(isValidApiKeyFormat('sk-1234 5678')).toBe(false);
    });

    it('should trim whitespace before validating', () => {
      expect(isValidApiKeyFormat('  sk-1234567890  ')).toBe(true);
    });
  });

  describe('formatRoadmapFeature', () => {
    it('should format completed feature', () => {
      const result = formatRoadmapFeature('Multi-database support', true);

      expect(result).toEqual({
        label: 'Multi-database support',
        status: 'completed',
        icon: '✓',
      });
    });

    it('should format pending feature', () => {
      const result = formatRoadmapFeature('Database Export', false);

      expect(result).toEqual({
        label: 'Database Export',
        status: 'pending',
        icon: '○',
      });
    });

    it('should handle long labels', () => {
      const longLabel = 'This is a very long feature description that should still work';
      const result = formatRoadmapFeature(longLabel, true);

      expect(result.label).toBe(longLabel);
      expect(result.status).toBe('completed');
    });

    it('should handle empty labels', () => {
      const result = formatRoadmapFeature('', false);

      expect(result.label).toBe('');
      expect(result.status).toBe('pending');
      expect(result.icon).toBe('○');
    });
  });

  describe('Constants', () => {
    it('should export correct font size bounds', () => {
      expect(MIN_FONT_SIZE).toBe(10);
      expect(MAX_FONT_SIZE).toBe(20);
    });

    it('should have valid bounds range', () => {
      expect(MAX_FONT_SIZE).toBeGreaterThan(MIN_FONT_SIZE);
      expect(MAX_FONT_SIZE - MIN_FONT_SIZE).toBeGreaterThanOrEqual(5);
    });
  });
});
