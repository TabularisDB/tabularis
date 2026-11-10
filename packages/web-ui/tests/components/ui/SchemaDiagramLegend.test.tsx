import {render, screen, fireEvent} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {SchemaDiagramLegend} from '@/components/ui/SchemaDiagramLegend';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));

describe('SchemaDiagramLegend', () => {
    it('associates each legend trigger with its own content', () => {
        render(
            <>
                <SchemaDiagramLegend />
                <SchemaDiagramLegend />
            </>,
        );
        const triggers = screen.getAllByRole('button', {name: /legend/i});
        const ids = triggers.map((trigger) => trigger.getAttribute('aria-controls'));
        expect(new Set(ids).size).toBe(2);
        for (const trigger of triggers) {
            fireEvent.click(trigger);
            expect(
                document.getElementById(trigger.getAttribute('aria-controls')!),
            ).toHaveTextContent('Primary Key');
        }
    });

    it('renders collapsed by default with accessible attributes', () => {
        render(<SchemaDiagramLegend />);

        const trigger = screen.getByRole('button', {name: /legend/i});
        expect(trigger).toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Primary Key')).not.toBeInTheDocument();
        expect(screen.queryByText('Foreign Key')).not.toBeInTheDocument();
        expect(screen.queryByText('Relationship')).not.toBeInTheDocument();
    });

    it('expands when clicked and displays accurate PK, FK and relationship items', () => {
        render(<SchemaDiagramLegend />);

        const trigger = screen.getByRole('button', {name: /legend/i});
        fireEvent.click(trigger);

        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Primary Key')).toBeInTheDocument();
        expect(screen.getByText('Unique column identifying rows in the table')).toBeInTheDocument();
        expect(screen.getByText('Foreign Key')).toBeInTheDocument();
        expect(
            screen.getByText('References a primary or unique key in another table'),
        ).toBeInTheDocument();
        expect(screen.getByText('Relationship')).toBeInTheDocument();
        expect(
            screen.getByText('Foreign key reference connecting child and parent tables'),
        ).toBeInTheDocument();

        // Clicking again collapses the legend
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Primary Key')).not.toBeInTheDocument();
    });

    it('collapses on Escape key when open', () => {
        render(<SchemaDiagramLegend />);

        const trigger = screen.getByRole('button', {name: /legend/i});
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        fireEvent.keyDown(window, {key: 'Escape'});
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Primary Key')).not.toBeInTheDocument();
    });
});
