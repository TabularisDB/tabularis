import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import type {Settings} from '@/contexts/SettingsContext';

let settings: Partial<Settings> = {};
let databaseState: Record<string, unknown> = {};

vi.mock('@/hooks/useSettings', () => ({useSettings: () => ({settings})}));
vi.mock('@/hooks/useDatabase', () => ({useDatabase: () => databaseState}));
vi.mock('@/hooks/useDrivers', () => ({useDrivers: () => ({allDrivers: []})}));

import {ConnectionColorBar} from '@/components/layout/ConnectionColorBar';

const bar = () => screen.queryByTestId('connection-color-bar');

describe('ConnectionColorBar', () => {
    beforeEach(() => {
        settings = {connectionColorBar: true};
        databaseState = {activeConnectionId: null, activeDriver: null, connections: []};
    });

    it('renders nothing when the setting is off', () => {
        settings = {connectionColorBar: false};
        render(<ConnectionColorBar />);
        expect(bar()).toBeNull();
    });

    it('uses the theme accent when no connection is selected', () => {
        render(<ConnectionColorBar />);
        expect(bar()?.getAttribute('style')).toContain('var(--accent-primary)');
    });

    it('uses the active connection accent color', () => {
        databaseState = {
            activeConnectionId: 'c1',
            activeDriver: 'postgres',
            connections: [
                {
                    id: 'c1',
                    params: {driver: 'postgres'},
                    appearance: {accentColor: '#f97316'},
                },
            ],
        };
        render(<ConnectionColorBar />);
        expect(bar()?.getAttribute('style')).toContain('#f97316');
    });
});
