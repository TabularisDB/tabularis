import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {RelatedRecordsPanel} from '@/components/ui/RelatedRecordsPanel';

vi.mock('lucide-react', () => ({
    X: () => null,
    ExternalLink: () => null,
    RefreshCw: () => null,
    AlertCircle: () => null,
    GripHorizontal: () => null,
}));

vi.mock('@/hooks/useReferencedRecord', () => ({
    useReferencedRecord: () => ({result: null, error: null, isLoading: false, loadRecord: vi.fn()}),
}));

describe('RelatedRecordsPanel', () => {
    const fk = {
        name: 'fk_parent',
        column_name: 'parent_id',
        ref_table: 'parents',
        ref_column: 'id',
    };

    it.each([
        ['sales', 'public', 'sales.parents'],
        ['public', 'public', 'parents'],
        [undefined, 'public', 'parents'],
    ])(
        'labels the target table when referenced schema is %s and source schema is %s',
        (refSchema, schema, label) => {
            render(
                <RelatedRecordsPanel
                    activeFkQuery={{fk: {...fk, ref_schema: refSchema}, value: 1}}
                    connectionId="conn"
                    schema={schema}
                    onClose={vi.fn()}
                    onNavigateToTab={vi.fn()}
                />,
            );

            expect(screen.getByTitle(label)).toHaveTextContent(label);
        },
    );
});
