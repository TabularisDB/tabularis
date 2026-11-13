import {describe, it, expect} from 'vitest';
import {buildFixQueryPrompt} from '@/utils/aiFixPrompt';

describe('aiFixPrompt', () => {
    describe('buildFixQueryPrompt', () => {
        it('combines the error and the failed SQL', () => {
            expect(
                buildFixQueryPrompt('SELECT nme FROM users', 'column "nme" does not exist'),
            ).toBe(
                'Fix this query. It failed with: column "nme" does not exist\n\nSELECT nme FROM users',
            );
        });

        it('drops error details after the first blank line', () => {
            const prompt = buildFixQueryPrompt('SELECT 1', 'syntax error\n\nat line 1\nstack');
            expect(prompt).toBe('Fix this query. It failed with: syntax error\n\nSELECT 1');
        });

        it('trims surrounding whitespace', () => {
            expect(buildFixQueryPrompt('  SELECT 1;\n', '  boom \n')).toBe(
                'Fix this query. It failed with: boom\n\nSELECT 1;',
            );
        });
    });
});
