import {renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    ProductionGuardContext,
    snoozedConnectionIds,
    useProductionGuard,
} from '@/hooks/useProductionGuard';
import type {ReactNode} from 'react';

const mocks = vi.hoisted(() => ({
    connection: {
        id: 'connection',
        name: 'Production',
        environment: 'production',
        params: {read_only: true},
    },
    showAlert: vi.fn(),
    request: vi.fn(async () => true),
}));
vi.mock('@/hooks/useDatabase', () => ({useDatabase: () => ({connections: [mocks.connection]})}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: mocks.showAlert})}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));

function wrapper({children}: {children: ReactNode}) {
    return (
        <ProductionGuardContext.Provider value={mocks.request}>
            {children}
        </ProductionGuardContext.Provider>
    );
}

describe('read-only policy and the production guard', () => {
    afterEach(() => {
        mocks.connection.params.read_only = true;
        mocks.connection.environment = 'production';
        snoozedConnectionIds.clear();
        vi.clearAllMocks();
    });

    it('blocks writes even when production confirmation is snoozed', async () => {
        snoozedConnectionIds.add('connection');
        const {result} = renderHook(useProductionGuard, {wrapper});
        expect(await result.current('connection', 'DELETE FROM items')).toBe(false);
        expect(mocks.showAlert).toHaveBeenCalledWith('readOnly.writeBlocked', {kind: 'warning'});
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('blocks non-SQL mutations on development connections without a provider', async () => {
        mocks.connection.environment = 'development';
        const {result} = renderHook(useProductionGuard);
        expect(await result.current('connection')).toBe(false);
    });

    it('allows reads without prompting', async () => {
        const {result} = renderHook(useProductionGuard, {wrapper});
        expect(await result.current('connection', 'SELECT * FROM items')).toBe(true);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('retains the PR473 production confirmation when read-only mode is off', async () => {
        mocks.connection.params.read_only = false;
        const {result} = renderHook(useProductionGuard, {wrapper});
        expect(await result.current('connection', 'DELETE FROM items')).toBe(true);
        expect(mocks.request).toHaveBeenCalledWith('connection', 'Production', 'DELETE FROM items');
        expect(mocks.showAlert).not.toHaveBeenCalled();
    });
});
