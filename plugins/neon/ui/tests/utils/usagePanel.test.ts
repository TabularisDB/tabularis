// @vitest-environment jsdom
import {createElement} from 'react';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {UsagePanel} from '../../src/UsagePanel';
import type {UsageSnapshot} from '../../src/types/usage';
const {management} = vi.hoisted(() => ({
    management: {
        scope: {projectId: 'project-one', branchId: 'br-one'} as {
            projectId: string;
            branchId: string;
        } | null,
        call: vi.fn(),
        pending: false,
        error: undefined,
        connectAccount: vi.fn(),
    },
}));
vi.mock('../../src/hooks/useNeonManagement', () => ({useNeonManagement: () => management}));
vi.mock('@tabularis/plugin-api', () => ({
    usePluginTranslation: () => (key: string) => (key === 'usage.locale' ? 'en' : key),
}));
afterEach(cleanup);
function snapshot(): UsageSnapshot {
    return {
        fetchedAt: '2026-11-04T12:00:00Z',
        project: {id: 'project-one', name: 'Example'},
        branch: {id: 'br-one', name: 'production'},
        organization: {id: 'org-one', name: 'Team', plan: 'launch', status: 'ready'},
        billingPeriod: {from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z'},
        window: null,
        limits: [
            {
                id: 'logical_size_bytes',
                scope: 'branch',
                used: 110,
                limit: 100,
                limitStatus: 'finite',
                unit: 'bytes',
                period: 'current',
            },
        ],
        history: {
            project: {
                status: 'unavailable',
                reason: 'access_or_plan',
                values: {} as UsageSnapshot['history']['project']['values'],
                reportedThrough: null,
            },
            branch: {
                status: 'no_data',
                values: {} as UsageSnapshot['history']['branch']['values'],
                reportedThrough: null,
            },
        },
        budget: {
            organizationId: 'org-one',
            status: 'ready',
            limitCents: null,
            spentCents: null,
            currency: null,
            enforcement: 'notification_only',
        },
    };
}
beforeEach(() => {
    vi.clearAllMocks();
    management.scope = {projectId: 'project-one', branchId: 'br-one'};
    management.call.mockResolvedValue(snapshot());
});
describe('Usage & limits', () => {
    it('shows scope, a real quota warning and explicit missing invoice/consumption information', async () => {
        render(createElement(UsagePanel, {connectionId: 'saved'}));
        await waitFor(() => expect(management.call).toHaveBeenCalledWith('account_usage'));
        expect((await screen.findByRole('alert')).textContent).toContain('usage.exceeded');
        expect(screen.getAllByText('usage.budgetNotSet').length).toBeGreaterThan(0);
        expect(screen.getByText('usage.invoiceUnavailable')).toBeDefined();
        expect(screen.getAllByText(/usage.reasons.access_or_plan/).length).toBeGreaterThan(0);
        expect(screen.getAllByText('production').length).toBeGreaterThan(0);
    });
    it('does not paint usage from another connection scope', async () => {
        management.call.mockResolvedValue({
            ...snapshot(),
            project: {id: 'foreign-project', name: 'Hidden other project'},
        });
        render(createElement(UsagePanel, {connectionId: 'saved'}));
        await screen.findByText('usage.scopeMismatch');
        expect(screen.queryByText('Hidden other project')).toBeNull();
    });
    it('asks for account access instead of requiring a service API-key variable', () => {
        management.scope = null;
        render(createElement(UsagePanel, {connectionId: 'saved'}));
        expect(screen.getByRole('button', {name: 'usage.connectAccount'})).toBeDefined();
        expect(management.call).not.toHaveBeenCalled();
    });
});
