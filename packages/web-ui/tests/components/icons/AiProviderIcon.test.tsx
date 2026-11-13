import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fireEvent, render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {AiProviderIcon} from '@/components/icons/AiProviderIcon';

vi.unmock('lucide-react');

describe('AI provider icons', () => {
    it('renders package artwork without replacing its colors with a monochrome mask', () => {
        const src = 'data:image/svg+xml;base64,PHN2Zy8+';
        const {container} = render(<AiProviderIcon src={src} size={26} />);
        const icon = container.firstElementChild;
        expect(icon).toHaveClass('text-primary');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveStyle({width: '26px', height: '26px'});
        expect(container.querySelector('img')).toHaveAttribute('src', src);
        expect(container.querySelector('[style*="mask"]')).toBeNull();
    });

    it('preserves external artwork and shows a visible fallback when loading fails', () => {
        const {container, rerender} = render(
            <AiProviderIcon src="https://example.test/first.svg" />,
        );
        fireEvent.error(container.querySelector('img')!);
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('svg')).not.toBeNull();
        rerender(<AiProviderIcon src="https://example.test/second.svg" />);
        expect(container.querySelector('img')).toHaveAttribute(
            'src',
            'https://example.test/second.svg',
        );
    });

    it.each([
        'openai',
        'custom-openai',
        'anthropic',
        'minimax',
        'ollama',
        'openrouter',
        'requesty',
    ])('%s embeds valid colored artwork from the package SVG', (id) => {
        const directory = resolve('plugins/ai-assistants/packages', id);
        const svg = readFileSync(resolve(directory, 'icon.svg'), 'utf8');
        const manifest = JSON.parse(readFileSync(resolve(directory, '.tabularium'), 'utf8')) as {
            icon: string;
        };
        expect(Buffer.from(manifest.icon.split(',')[1], 'base64').toString()).toBe(svg);
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(document.querySelector('parsererror')).toBeNull();
        expect(svg).not.toMatch(
            /\b(?:strokeWidth|strokeLinecap|strokeLinejoin|fillRule|clipRule)=/,
        );
        expect(svg).not.toContain('#64748b');
        expect(new Set(svg.match(/#[\da-f]{6}/gi)).size).toBeGreaterThan(1);
        const artwork = document.querySelector('svg svg')!;
        if (id === 'openrouter') {
            expect(artwork.getAttribute('stroke')).toBeTruthy();
            expect(document.querySelector('path')?.getAttribute('stroke-width')).toBe('90');
        }
        if (id === 'requesty') {
            expect(artwork.getAttribute('stroke')).toBeTruthy();
            expect(artwork.getAttribute('fill')).toBe('none');
            expect(document.querySelector('rect')).not.toBeNull();
        }
    });
});
