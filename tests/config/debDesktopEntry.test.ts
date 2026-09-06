import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const tauriConfig = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'src-tauri/tauri.conf.json'), 'utf8'),
);

describe('Debian desktop entry', () => {
  it('preserves the deep-link URL and stable application identity', () => {
    expect(tauriConfig.productName).toBe('tabularis');
    expect(tauriConfig.bundle.category).toBe('DeveloperTool');
    expect(tauriConfig.bundle.linux.deb.desktopTemplate).toBe('deb/tabularis.desktop');

    const template = readFileSync(
      resolve(repositoryRoot, 'src-tauri', tauriConfig.bundle.linux.deb.desktopTemplate),
      'utf8',
    );

    expect(template).toContain('Name=Tabularis\n');
    expect(template).toContain('StartupWMClass=tabularis\n');
    expect(template).toContain('Exec={{{exec}}} %u\n');
    expect(template).toContain('Categories={{{categories}}}\n');
    expect(template).toContain('MimeType=x-scheme-handler/tabularis;\n');

    const placeholders = [...template.matchAll(/\{\{\{(\w+)\}\}\}/g)].map(
      ([, name]) => name,
    );
    expect(placeholders.sort()).toEqual(['categories', 'comment', 'exec', 'icon']);
  });
});
