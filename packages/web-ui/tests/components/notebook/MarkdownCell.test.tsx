import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import en from '@/i18n/locales/en.json';
import {MarkdownCell} from '@/components/notebook/MarkdownCell';
import type {NotebookCell} from '@/types/notebook';

function resolveKey(obj: Record<string, unknown>, path: string): string {
    const parts = path.split('.');
    let cur: unknown = obj;
    for (const part of parts) {
        if (cur && typeof cur === 'object' && part in cur) {
            cur = (cur as Record<string, unknown>)[part];
        } else {
            return path;
        }
    }
    return typeof cur === 'string' ? cur : path;
}

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) => {
            let text = resolveKey(en as unknown as Record<string, unknown>, key);
            if (params) {
                for (const [k, v] of Object.entries(params)) {
                    text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
                }
            }
            return text;
        },
    }),
}));

function makeSqlCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
    return {
        id: 'sql-1',
        type: 'sql',
        content: 'SELECT 1 AS total',
        result: null,
        ...overrides,
    };
}

function makeMdCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
    return {
        id: 'md-1',
        type: 'markdown',
        content: '',
        isPreview: true,
        ...overrides,
    };
}

describe('MarkdownCell scalar interpolation', () => {
    it('interpolates scalar values and re-renders when output changes without issuing queries', () => {
        const sqlCell = makeSqlCell({
            result: {
                columns: ['total', 'zero', 'flag', 'precise', 'unicode'],
                rows: [[42, 0, false, '99999999999999999999.123456', 'Café ☕']],
                affected_rows: 0,
            },
        });
        const mdCell = makeMdCell({
            content:
                'Total: {{value:cell_1.total}}, Zero: {{value:cell_1.zero}}, Flag: {{value:cell_1.flag}}, Precise: {{value:cell_1.precise}}, Uni: {{value:cell_1.unicode}}',
        });

        const {rerender} = render(
            <MarkdownCell
                cell={mdCell}
                cells={[sqlCell, mdCell]}
                onContentChange={vi.fn()}
                onTogglePreview={vi.fn()}
            />,
        );

        expect(
            screen.getByText(
                'Total: 42, Zero: 0, Flag: false, Precise: 99999999999999999999.123456, Uni: Café ☕',
            ),
        ).toBeInTheDocument();

        // Update cell output and verify re-render without queries
        const updatedSqlCell = makeSqlCell({
            result: {
                columns: ['total', 'zero', 'flag', 'precise', 'unicode'],
                rows: [[108, 0, false, '99999999999999999999.123456', 'Café ☕']],
                affected_rows: 0,
            },
        });

        rerender(
            <MarkdownCell
                cell={mdCell}
                cells={[updatedSqlCell, mdCell]}
                onContentChange={vi.fn()}
                onTogglePreview={vi.fn()}
            />,
        );

        expect(
            screen.getByText(
                'Total: 108, Zero: 0, Flag: false, Precise: 99999999999999999999.123456, Uni: Café ☕',
            ),
        ).toBeInTheDocument();
    });

    it('inserts Markdown and HTML payloads as inert text without parsing or executing them', () => {
        const sqlCell = makeSqlCell({
            result: {
                columns: ['payload'],
                rows: [['**not bold** <script>alert(1)</script> <img src=x onerror=alert(1)>']],
                affected_rows: 0,
            },
        });
        const mdCell = makeMdCell({
            content: 'Value: {{value:cell_1.payload}}',
        });

        const {container} = render(
            <MarkdownCell
                cell={mdCell}
                cells={[sqlCell, mdCell]}
                onContentChange={vi.fn()}
                onTogglePreview={vi.fn()}
            />,
        );

        expect(container.querySelector('strong')).toBeNull();
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(
            screen.getByText(
                'Value: **not bold** <script>alert(1)</script> <img src=x onerror=alert(1)>',
            ),
        ).toBeInTheDocument();
    });

    it('does not interpolate scalar references inside inline code or fenced code blocks', () => {
        const sqlCell = makeSqlCell({
            result: {columns: ['total'], rows: [[42]], affected_rows: 0},
        });
        const mdCell = makeMdCell({
            content: 'Use `{{value:cell_1.total}}` to show {{value:cell_1.total}}.',
        });

        render(
            <MarkdownCell
                cell={mdCell}
                cells={[sqlCell, mdCell]}
                onContentChange={vi.fn()}
                onTogglePreview={vi.fn()}
            />,
        );

        expect(screen.getByText('{{value:cell_1.total}}')).toBeInTheDocument();
        expect(screen.getByText(/to show 42\./)).toBeInTheDocument();
    });

    it('distinguishes SQL NULL from missing values and shows actionable placeholders', () => {
        const sqlCell = makeSqlCell({
            result: {columns: ['val'], rows: [[null]], affected_rows: 0},
        });
        const notRunCell = makeSqlCell({id: 'sql-2', result: null});
        const mdCell = makeMdCell({
            content:
                'Null: {{value:cell_1.val}} | Missing: {{value:cell_1.nope}} | NotRun: {{value:cell_2.x}} | Bad: {{value:invalid}}',
        });

        render(
            <MarkdownCell
                cell={mdCell}
                cells={[sqlCell, notRunCell, mdCell]}
                onContentChange={vi.fn()}
                onTogglePreview={vi.fn()}
            />,
        );

        const nullEl = screen.getByText('NULL');
        expect(nullEl).toHaveAttribute('data-scalar-state', 'null');
        expect(screen.getByText('[Cell 1: missing column "nope"]')).toBeInTheDocument();
        expect(screen.getByText('[Cell 2: not run]')).toBeInTheDocument();
        expect(screen.getByText('[invalid reference: {{value:invalid}}]')).toBeInTheDocument();
    });

    it('communicates outdated source output when SQL cell query changed since last run', () => {
        const sqlCell = makeSqlCell({
            content: 'SELECT 999 AS total',
            result: {columns: ['total'], rows: [[42]], affected_rows: 0},
            history: [
                {
                    query: 'SELECT 42 AS total',
                    result: {columns: ['total'], rows: [[42]], affected_rows: 0},
                    executionTime: 10,
                    timestamp: 1000,
                },
            ],
        });
        const mdCell = makeMdCell({content: 'Revenue: {{value:cell_1.total}}'});

        render(
            <MarkdownCell
                cell={mdCell}
                cells={[sqlCell, mdCell]}
                onContentChange={vi.fn()}
                onTogglePreview={vi.fn()}
            />,
        );

        expect(screen.getByText('(outdated)')).toBeInTheDocument();
        expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('provides autocomplete suggestions on {{ and toggles syntax help in edit mode', () => {
        const sqlCell = makeSqlCell({
            name: 'revenue',
            result: {columns: ['total'], rows: [[42]], affected_rows: 0},
        });
        const mdCell = makeMdCell({isPreview: false, content: ''});
        const onContentChange = vi.fn();

        const {rerender} = render(
            <MarkdownCell
                cell={mdCell}
                cells={[sqlCell, mdCell]}
                onContentChange={onContentChange}
                onTogglePreview={vi.fn()}
            />,
        );

        const textarea = screen.getByPlaceholderText(
            'Write Markdown here...',
        ) as HTMLTextAreaElement;
        fireEvent.change(textarea, {target: {value: 'Total: {{', selectionStart: 9}});

        rerender(
            <MarkdownCell
                cell={{...mdCell, content: 'Total: {{'}}
                cells={[sqlCell, {...mdCell, content: 'Total: {{'}]}
                onContentChange={onContentChange}
                onTogglePreview={vi.fn()}
            />,
        );

        const listbox = screen.getByRole('listbox', {name: 'Scalar reference suggestions'});
        expect(listbox).toBeInTheDocument();

        fireEvent.keyDown(textarea, {key: 'Enter'});
        expect(onContentChange).toHaveBeenCalledWith('Total: {{value:cell_1.total}}');

        const helpBtn = screen.getByRole('button', {
            name: 'Toggle scalar reference syntax help',
        });
        fireEvent.click(helpBtn);
        expect(
            screen.getByText(/Reference a single-row SQL cell value in Markdown/),
        ).toBeInTheDocument();
    });
});
