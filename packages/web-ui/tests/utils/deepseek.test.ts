import {describe, it, expect} from 'vitest';
import type {AiProvider} from '@/contexts/SettingsContext';
import {getProviderLabel} from '@/utils/settingsUI';
import {detectAIProviderFromKeys} from '@/utils/settings';

describe('DeepSeek AI Provider Integration', () => {
    describe('Provider type', () => {
        it('should accept deepseek as a valid AiProvider', () => {
            const provider: AiProvider = 'deepseek';
            expect(provider).toBe('deepseek');
        });

        it('should be distinct from other providers', () => {
            const providers: AiProvider[] = [
                'openai',
                'anthropic',
                'openrouter',
                'ollama',
                'custom-openai',
                'minimax',
                'deepseek',
            ];
            const unique = new Set(providers);
            expect(unique.size).toBe(providers.length);
        });
    });

    describe('Provider label', () => {
        it('should return DeepSeek label', () => {
            expect(getProviderLabel('deepseek')).toBe('DeepSeek');
        });

        it('should not be confused with other providers', () => {
            expect(getProviderLabel('deepseek')).not.toBe('OpenAI');
            expect(getProviderLabel('deepseek')).not.toBe('Anthropic');
            expect(getProviderLabel('deepseek')).not.toBe('OpenRouter');
        });
    });

    describe('Auto-detection priority', () => {
        it('should detect deepseek when only deepseek key is available', () => {
            const keyStatus: Record<AiProvider, boolean> = {
                openai: false,
                anthropic: false,
                openrouter: false,
                minimax: false,
                deepseek: true,
                ollama: false,
                'custom-openai': false,
            };
            const models: Record<string, string[]> = {
                deepseek: ['deepseek-chat', 'deepseek-reasoner'],
            };

            const result = detectAIProviderFromKeys(keyStatus, models);
            expect(result.provider).toBe('deepseek');
            expect(result.model).toBe('deepseek-chat');
        });

        it('should prefer openai over deepseek', () => {
            const keyStatus: Record<AiProvider, boolean> = {
                openai: true,
                anthropic: false,
                openrouter: false,
                minimax: false,
                deepseek: true,
                ollama: false,
                'custom-openai': false,
            };
            const models: Record<string, string[]> = {
                openai: ['gpt-4o'],
                deepseek: ['deepseek-chat'],
            };

            const result = detectAIProviderFromKeys(keyStatus, models);
            expect(result.provider).toBe('openai');
        });

        it('should prefer minimax over deepseek', () => {
            const keyStatus: Record<AiProvider, boolean> = {
                openai: false,
                anthropic: false,
                openrouter: false,
                minimax: true,
                deepseek: true,
                ollama: false,
                'custom-openai': false,
            };
            const models: Record<string, string[]> = {
                minimax: ['MiniMax-M3'],
                deepseek: ['deepseek-chat'],
            };

            const result = detectAIProviderFromKeys(keyStatus, models);
            expect(result.provider).toBe('minimax');
        });

        it('should return null model when deepseek models list is empty', () => {
            const keyStatus: Record<AiProvider, boolean> = {
                openai: false,
                anthropic: false,
                openrouter: false,
                minimax: false,
                deepseek: true,
                ollama: false,
                'custom-openai': false,
            };
            const models: Record<string, string[]> = {};

            const result = detectAIProviderFromKeys(keyStatus, models);
            expect(result.provider).toBe('deepseek');
            expect(result.model).toBeNull();
        });
    });
});
