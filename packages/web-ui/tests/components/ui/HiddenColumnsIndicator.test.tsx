import {describe, it, expect, vi} from 'vitest';
import {useState} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {HiddenColumnsIndicator} from '@/components/ui/HiddenColumnsIndicator';

// The shared mock drops options; these tests read the count.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: {count?: number}) =>
            options?.count === undefined ? key : `${key}:${options.count}`,
        i18n: {language: 'en', changeLanguage: vi.fn()},
    }),
    initReactI18next: {type: '3rdParty', init: vi.fn()},
}));

const columns = ['id', 'customer_id', 'created_by', 'updated_at'];

function Host({
    initial,
    onChange = vi.fn(),
}: {
    initial: ReadonlySet<number>;
    onChange?: () => void;
}) {
    const [hidden, setHidden] = useState(initial);
    return (
        <HiddenColumnsIndicator
            columns={columns}
            hidden={hidden}
            onChange={(next) => {
                setHidden(next);
                onChange();
            }}
        />
    );
}

const chip = () => screen.getByRole('button', {name: /dataGrid\.columnVisibility\.hiddenLabel/});

describe('HiddenColumnsIndicator', () => {
    it('renders nothing while no column is hidden', () => {
        const {container} = render(<Host initial={new Set()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows how many columns are hidden and names them on hover', () => {
        render(<Host initial={new Set([3, 2])} />);
        expect(chip()).toHaveTextContent('dataGrid.columnVisibility.hiddenCount:2');
        expect(chip()).toHaveAccessibleName('dataGrid.columnVisibility.hiddenLabel:2');
        expect(chip()).toHaveAttribute('title', 'created_by, updated_at');
        expect(chip()).toHaveAttribute('aria-haspopup', 'dialog');
        expect(chip()).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens the column list, which shows a column again', () => {
        render(<Host initial={new Set([2, 3])} />);
        fireEvent.click(chip());

        const dialog = screen.getByRole('dialog', {name: 'dataGrid.columnVisibility.title'});
        expect(chip()).toHaveAttribute('aria-expanded', 'true');
        expect(chip()).toHaveAttribute('aria-controls', dialog.id);

        fireEvent.click(screen.getByRole('checkbox', {name: 'created_by'}));
        expect(chip()).toHaveTextContent('dataGrid.columnVisibility.hiddenCount:1');
    });

    it('closes the list when the chip is pressed again', () => {
        render(<Host initial={new Set([1])} />);
        fireEvent.click(chip());
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        fireEvent.mouseDown(chip());
        fireEvent.click(chip());
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(chip()).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps the list open after Show all removes the chip', () => {
        render(<Host initial={new Set([0, 1])} />);
        fireEvent.click(chip());
        fireEvent.click(screen.getByRole('button', {name: 'dataGrid.columnVisibility.showAll'}));

        expect(screen.queryByRole('button', {name: /hiddenLabel/})).toBeNull();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(
            screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked),
        ).toBe(true);
    });

    it('lists at most eight names in its tooltip', () => {
        const many = Array.from({length: 12}, (_, i) => `c${i}`);
        render(
            <HiddenColumnsIndicator
                columns={many}
                hidden={new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])}
                onChange={vi.fn()}
            />,
        );
        expect(chip()).toHaveAttribute('title', 'c0, c1, c2, c3, c4, c5, c6, c7, …');
    });
});
