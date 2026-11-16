import {render, screen} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {SidebarColumnItem} from '@/components/layout/sidebar/SidebarColumnItem';
import type {TableColumn} from '@/types/schema';

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({}),
}));

vi.mock('@/hooks/useAlert', () => ({
    useAlert: () => ({showAlert: vi.fn()}),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({call: vi.fn()}),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

const baseColumn: TableColumn = {
    name: 'name',
    data_type: 'varchar',
    is_pk: false,
    is_nullable: true,
    is_auto_increment: false,
};

const renderColumn = (column: Partial<TableColumn>) =>
    render(
        <SidebarColumnItem
            column={{...baseColumn, ...column}}
            tableName="users"
            connectionId="conn-1"
            driver="mysql"
            onRefresh={vi.fn()}
            onEdit={vi.fn()}
        />,
    );

describe('SidebarColumnItem', () => {
    it('shows the full column type when the driver reports one', () => {
        renderColumn({data_type: 'varchar', full_type: 'varchar(255)'});

        expect(screen.getByText('varchar(255)')).toBeInTheDocument();
        expect(screen.queryByText('varchar')).not.toBeInTheDocument();
    });

    it('puts the full type in a tooltip so a truncated type stays readable', () => {
        renderColumn({
            name: 'created_at',
            data_type: 'timestamp with time zone',
            full_type: 'timestamp(3) with time zone',
        });

        const type = screen.getByText('timestamp(3) with time zone');
        expect(type).toHaveAttribute('title', 'timestamp(3) with time zone');
        expect(type).toHaveClass('truncate');
    });

    it('appends the reported length or precision for drivers without a full type', () => {
        renderColumn({
            name: 'price',
            data_type: 'numeric',
            numeric_precision: 10,
            numeric_scale: 2,
        });

        expect(screen.getByText('numeric(10,2)')).toBeInTheDocument();
    });

    it('falls back to data_type for plain types', () => {
        renderColumn({name: 'bio', data_type: 'text'});

        expect(screen.getByText('text')).toBeInTheDocument();
    });
});
