import {readFileSync} from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import {expect, it} from 'vitest';

it('ships actual shared component utilities, theme colors and bounded form scrolling without font requests', () => {
    const css = readFileSync(
        path.join(process.cwd(), 'src-tauri/resources/guest/host.css'),
        'utf8',
    );
    const stylesheet = postcss.parse(css);
    const declarations = new Map<string, string[]>();
    stylesheet.walkRules((rule) => {
        const values: string[] = [];
        rule.walkDecls((decl) => {
            values.push(`${decl.prop}:${decl.value}`);
        });
        declarations.set(rule.selector, [...(declarations.get(rule.selector) ?? []), ...values]);
    });
    expect(declarations.get('.fixed')).toContain('position:fixed');
    expect(declarations.get('.w-full')).toContain('width:100%');
    expect(declarations.get('.bg-base')).toContain('background-color:var(--bg-base)');
    // #root keeps its natural height so the host hears it grow; the frame's viewport scrolls.
    expect(declarations.get('#root')).toContain('display:flow-root');
    expect(declarations.get('#root')?.some((decl) => decl.startsWith('max-height:'))).toBe(false);
    expect(declarations.get('#root')).not.toContain('overflow:auto');
    expect(css).not.toContain('@font-face');
    expect(css).not.toContain("url('/fonts/");
});
