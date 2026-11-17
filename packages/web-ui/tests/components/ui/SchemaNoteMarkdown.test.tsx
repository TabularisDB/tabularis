import {describe, expect, it} from 'vitest';
import {render} from '@testing-library/react';
import {SchemaNoteMarkdown} from '@/components/ui/SchemaNoteMarkdown';

describe('SchemaNoteMarkdown', () => {
    it('renders ordinary Markdown', () => {
        const {container} = render(
            <SchemaNoteMarkdown content={'**4** means `captured`\n\n- a\n- b'} />,
        );
        expect(container.querySelector('strong')?.textContent).toBe('4');
        expect(container.querySelector('code')?.textContent).toBe('captured');
        expect(container.querySelectorAll('li')).toHaveLength(2);
    });

    it('drops raw HTML, scripts and event handlers', () => {
        const {container} = render(
            <SchemaNoteMarkdown
                content={
                    'before <script>window.__pwned = 1</script> <img src=x onerror="alert(1)"> ' +
                    '<iframe src="https://example.com"></iframe><b onclick="alert(1)">bold</b> after'
                }
            />,
        );
        expect(container.querySelector('script, iframe, b, [onerror], [onclick]')).toBeNull();
        expect(container.innerHTML).not.toContain('onerror');
        expect(container.textContent).toContain('before');
        expect(container.textContent).toContain('after');
    });

    it('never renders navigable links or remote images', () => {
        const {container} = render(
            <SchemaNoteMarkdown
                content={
                    '[click](javascript:alert(1)) [site](https://example.com) <https://auto.example> ' +
                    '![tracker](https://example.com/pixel.png)'
                }
            />,
        );
        expect(container.querySelector('a, img')).toBeNull();
        expect(container.innerHTML).not.toContain('javascript:alert');
        expect(container.textContent).toContain('click');
        expect(container.textContent).toContain('[tracker]');
    });
});
