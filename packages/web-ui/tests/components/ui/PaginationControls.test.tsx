import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {PaginationControls} from '@/components/ui/PaginationControls';
import type {Pagination} from '@/types/editor';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => {
            const templates: Record<string, string> = {
                'editor.pageOf': 'Page {{current}} of {{total}}',
                'editor.page': 'Page {{current}}',
            };
            let result = templates[key] ?? key;
            if (options) {
                for (const [name, value] of Object.entries(options)) {
                    result = result.replaceAll(`{{${name}}}`, String(value));
                }
            }
            return result;
        },
        i18n: {language: 'en', changeLanguage: vi.fn()},
    }),
}));

function pagination(overrides: Partial<Pagination> = {}): Pagination {
    return {
        page: 1,
        page_size: 100,
        total_rows: 12000,
        has_more: true,
        ...overrides,
    };
}

function setup(overrides: Partial<Pagination> = {}, isLoading = false) {
    const onPageChange = vi.fn();
    const view = render(
        <PaginationControls
            pagination={pagination(overrides)}
            isLoading={isLoading}
            onPageChange={onPageChange}
        />,
    );
    const input = screen.getByRole('textbox', {name: 'pagination.pageNumber'});
    return {onPageChange, input, ...view};
}

function typePage(input: HTMLElement, value: string) {
    fireEvent.change(input, {target: {value}});
}

describe('PaginationControls page jump', () => {
    it('shows the current page inside the Page N of M label', () => {
        const {input} = setup();
        expect(input).toHaveValue('1');
        expect(input).toHaveClass('focus-visible:outline-focus');
        expect(input.previousElementSibling).toHaveTextContent('Page');
        expect(input.nextElementSibling).toHaveTextContent('of 120');
    });

    it('shows Page N when the total is unknown', () => {
        const {input} = setup({page: 3, total_rows: null});
        expect(input).toHaveValue('3');
        expect(input.previousElementSibling).toHaveTextContent('Page');
        expect(input.nextElementSibling).toBeNull();
    });

    it('loads the typed page on Enter', () => {
        const {input, onPageChange} = setup();
        typePage(input, '40');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onPageChange).toHaveBeenCalledTimes(1);
        expect(onPageChange).toHaveBeenCalledWith(40);
        expect(input).toHaveValue('40');
    });

    it('clamps a page above the last page', () => {
        const {input, onPageChange} = setup();
        typePage(input, '999');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onPageChange).toHaveBeenCalledWith(120);
        expect(input).toHaveValue('120');
    });

    it('clamps a page below 1', () => {
        const {input, onPageChange} = setup({page: 4});
        typePage(input, '0');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onPageChange).toHaveBeenCalledWith(1);
        expect(input).toHaveValue('1');
    });

    it('does not reload the page that is already showing', () => {
        const {input, onPageChange} = setup({page: 4});
        typePage(input, '004');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onPageChange).not.toHaveBeenCalled();
        expect(input).toHaveValue('4');
    });

    it('reverts empty or invalid text on Enter', () => {
        const {input, onPageChange} = setup({page: 4});
        typePage(input, '');
        fireEvent.keyDown(input, {key: 'Enter'});
        typePage(input, 'abc');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onPageChange).not.toHaveBeenCalled();
        expect(input).toHaveValue('4');
    });

    it('restores the current page on Escape', () => {
        const {input, onPageChange} = setup({page: 4});
        typePage(input, '9');
        fireEvent.keyDown(input, {key: 'Escape'});
        expect(onPageChange).not.toHaveBeenCalled();
        expect(input).toHaveValue('4');
    });

    it('restores the current page on blur without Enter', () => {
        const {input, onPageChange} = setup({page: 4});
        typePage(input, '9');
        fireEvent.blur(input);
        expect(onPageChange).not.toHaveBeenCalled();
        expect(input).toHaveValue('4');
    });

    it('accepts any positive page when the total is unknown', () => {
        const {input, onPageChange} = setup({page: 2, total_rows: null});
        typePage(input, '80');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onPageChange).toHaveBeenCalledWith(80);
    });

    it('rejects a non-positive page when the total is unknown', () => {
        const {input, onPageChange} = setup({page: 2, total_rows: null});
        typePage(input, '0');
        fireEvent.keyDown(input, {key: 'Enter'});
        typePage(input, '-5');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onPageChange).not.toHaveBeenCalled();
        expect(input).toHaveValue('2');
    });

    it('keeps the requested page while loading, then follows a successful result', () => {
        const {input, onPageChange, rerender} = setup({page: 1});
        typePage(input, '40');
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onPageChange).toHaveBeenCalledWith(40);

        rerender(
            <PaginationControls
                pagination={pagination({page: 1})}
                isLoading
                onPageChange={onPageChange}
            />,
        );
        expect(input).toHaveValue('40');
        expect(input).toBeDisabled();

        rerender(
            <PaginationControls
                pagination={pagination({page: 40})}
                isLoading={false}
                onPageChange={onPageChange}
            />,
        );
        expect(input).toHaveValue('40');
        expect(input).toBeEnabled();
    });

    it('reverts a jump that finishes without changing the page', () => {
        const {input, onPageChange, rerender} = setup({page: 1});
        typePage(input, '40');
        fireEvent.keyDown(input, {key: 'Enter'});
        rerender(
            <PaginationControls
                pagination={pagination({page: 1})}
                isLoading
                onPageChange={onPageChange}
            />,
        );
        rerender(
            <PaginationControls
                pagination={pagination({page: 1})}
                isLoading={false}
                onPageChange={onPageChange}
            />,
        );
        expect(input).toHaveValue('1');
    });

    it('still moves with the next and last buttons', () => {
        const {onPageChange} = setup({page: 2});
        fireEvent.click(screen.getByRole('button', {name: 'pagination.nextPage'}));
        expect(onPageChange).toHaveBeenCalledWith(3);
        fireEvent.click(screen.getByRole('button', {name: 'pagination.lastPage'}));
        expect(onPageChange).toHaveBeenCalledWith(120);
    });

    it('disables the field while results are loading', () => {
        const {input} = setup({}, true);
        expect(input).toBeDisabled();
    });
});
