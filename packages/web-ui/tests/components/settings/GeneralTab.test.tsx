import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {GeneralTab} from '@/components/settings/GeneralTab';

const {updateSetting, settingsState} = vi.hoisted(() => ({
    updateSetting: vi.fn(),
    settingsState: {} as {nullDisplay?: 'default' | 'parenthesized' | 'emptySet' | 'empty'},
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: settingsState, updateSetting}),
}));

describe('GeneralTab', () => {
    beforeEach(() => {
        updateSetting.mockClear();
        delete settingsState.nullDisplay;
    });

    describe('NULL display (#1300)', () => {
        it('selects the default NULL label when nothing is saved', () => {
            render(<GeneralTab />);
            expect(screen.getByRole('button', {name: 'dataGrid.null'})).toHaveAttribute(
                'aria-pressed',
                'true',
            );
            expect(screen.getByRole('button', {name: '∅'})).toHaveAttribute(
                'aria-pressed',
                'false',
            );
        });

        it('saves the chosen NULL display', () => {
            render(<GeneralTab />);
            fireEvent.click(screen.getByRole('button', {name: '∅'}));
            expect(updateSetting).toHaveBeenCalledWith('nullDisplay', 'emptySet');

            fireEvent.click(screen.getByRole('button', {name: 'settings.nullDisplayEmpty'}));
            expect(updateSetting).toHaveBeenCalledWith('nullDisplay', 'empty');
        });

        it('shows the saved NULL display as selected', () => {
            settingsState.nullDisplay = 'parenthesized';
            render(<GeneralTab />);
            expect(screen.getByRole('button', {name: '(null)'})).toHaveAttribute(
                'aria-pressed',
                'true',
            );
        });
    });
});
