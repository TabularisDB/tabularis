import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    name: string;
    bin: Record<string, string>;
};

describe('package bin', () => {
    // `npm create`, `pnpm create`, `npx` and `pnpm dlx` run the only bin, or the
    // bin named after the unscoped package name when the package has several.
    // Without it they fail with "could not determine executable to run" and
    // ERR_PNPM_DLX_MULTIPLE_BINS.
    it('names the scaffolder after the unscoped package name', () => {
        const unscoped = manifest.name.replace(/^@[^/]+\//, '');
        expect(unscoped).toBe('create-plugin');
        expect(manifest.bin[unscoped]).toBe('./dist/cli.js');
    });

    it('keeps the existing tabularis-create-plugin and tabularis-theme bins', () => {
        expect(manifest.bin['tabularis-create-plugin']).toBe('./dist/cli.js');
        expect(manifest.bin['tabularis-theme']).toBe('./dist/theme.js');
    });
});
