import { describe, it, expect } from 'vitest';
import type { AiProvider } from '../../src/contexts/SettingsContext';
import { getProviderLabel } from '../../src/utils/settingsUI';
import { detectAIProviderFromKeys } from '../../src/utils/settings';

describe('MiniMax AI Provider Integration', () => {
  describe('Provider type', () => {
    it('should accept minimax as a valid AiProvider', () => {
      const provider: AiProvider = 'minimax';
      expect(provider).toBe('minimax');
    });

    it('should be distinct from other providers', () => {
      const providers: AiProvider[] = ['openai', 'anthropic', 'openrouter', 'ollama', 'custom-openai', 'minimax'];
      const unique = new Set(providers);
      expect(unique.size).toBe(providers.length);
    });
  });

  describe('Provider label', () => {
    it('should return MiniMax label', () => {
      expect(getProviderLabel('minimax')).toBe('MiniMax');
    });

    it('should not be confused with other providers', () => {
      expect(getProviderLabel('minimax')).not.toBe('OpenAI');
      expect(getProviderLabel('minimax')).not.toBe('Anthropic');
      expect(getProviderLabel('minimax')).not.toBe('OpenRouter');
    });
  });

  describe('Auto-detection priority', () => {
    it('should detect minimax when only minimax key is available', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: false,
        openrouter: false,
        minimax: true,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        minimax: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('minimax');
      expect(result.model).toBe('MiniMax-M3');
    });

    it('should prefer openai over minimax', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: true,
        anthropic: false,
        openrouter: false,
        minimax: true,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        openai: ['gpt-4o'],
        minimax: ['MiniMax-M2.7'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('openai');
    });

    it('should prefer anthropic over minimax', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: true,
        openrouter: false,
        minimax: true,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        anthropic: ['claude-3.5-sonnet'],
        minimax: ['MiniMax-M2.7'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('anthropic');
    });

    it('should select M3 as default model', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: false,
        openrouter: false,
        minimax: true,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        minimax: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.model).toBe('MiniMax-M3');
    });

    it('should return null model when minimax models list is empty', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: false,
        openrouter: false,
        minimax: true,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {};

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('minimax');
      expect(result.model).toBeNull();
    });
  });
});
