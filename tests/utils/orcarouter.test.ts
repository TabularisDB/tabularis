import { describe, it, expect } from 'vitest';
import type { AiProvider } from '../../src/contexts/SettingsContext';
import { getProviderLabel } from '../../src/utils/settingsUI';
import { detectAIProviderFromKeys } from '../../src/utils/settings';

describe('OrcaRouter AI Provider Integration', () => {
  describe('Provider type', () => {
    it('should accept orcarouter as a valid AiProvider', () => {
      const provider: AiProvider = 'orcarouter';
      expect(provider).toBe('orcarouter');
    });

    it('should be distinct from other providers', () => {
      const providers: AiProvider[] = ['openai', 'anthropic', 'openrouter', 'orcarouter', 'ollama', 'custom-openai', 'minimax'];
      const unique = new Set(providers);
      expect(unique.size).toBe(providers.length);
    });
  });

  describe('Provider label', () => {
    it('should return OrcaRouter label', () => {
      expect(getProviderLabel('orcarouter')).toBe('OrcaRouter');
    });

    it('should not be confused with other providers', () => {
      expect(getProviderLabel('orcarouter')).not.toBe('OpenAI');
      expect(getProviderLabel('orcarouter')).not.toBe('Anthropic');
      expect(getProviderLabel('orcarouter')).not.toBe('OpenRouter');
      expect(getProviderLabel('orcarouter')).not.toBe('MiniMax');
    });
  });

  describe('Auto-detection priority', () => {
    it('should detect orcarouter when only orcarouter key is available', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: false,
        openrouter: false,
        orcarouter: true,
        minimax: false,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        orcarouter: ['orcarouter/auto', 'openai/gpt-5.5', 'openai/gpt-5.6-luna'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('orcarouter');
      expect(result.model).toBe('orcarouter/auto');
    });

    it('should prefer openai over orcarouter', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: true,
        anthropic: false,
        openrouter: false,
        orcarouter: true,
        minimax: false,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        openai: ['gpt-5.5'],
        orcarouter: ['orcarouter/auto'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('openai');
    });

    it('should prefer minimax over orcarouter', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: false,
        openrouter: false,
        orcarouter: true,
        minimax: true,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        minimax: ['MiniMax-M3'],
        orcarouter: ['orcarouter/auto'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('minimax');
    });

    it('should return null model when orcarouter models list is empty', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: false,
        openrouter: false,
        orcarouter: true,
        minimax: false,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {};

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('orcarouter');
      expect(result.model).toBeNull();
    });
  });
});
