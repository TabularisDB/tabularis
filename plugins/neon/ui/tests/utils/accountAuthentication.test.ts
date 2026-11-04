// @vitest-environment jsdom
import {selectOption} from '../support/select';
import {createElement} from 'react';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AccountAuthentication} from '../../src/components/AccountAuthentication';
import {ManagementAccountForm} from '../../src/components/ManagementAccountForm';

const {prepare, connect, call, copyText, openUrl, t} = vi.hoisted(() => ({
    prepare: vi.fn(),
    connect: vi.fn(),
    call: vi.fn(),
    copyText: vi.fn(),
    openUrl: vi.fn(),
    t: (key: string) => key,
}));
vi.mock('@tabularis/plugin-api', async () => {
    const {PluginSelect} = await import('@/components/plugins/PluginSelect');
    return {
        PluginSelect,
        // Deliberately unstable account identity: status must not restart on each render.
        usePluginAccount: () => ({prepare, connect, call}),
        usePluginTranslation: () => t,
        copyText,
        openUrl,
    };
});
const absent = {
    installed: false,
    version: null,
    authenticated: false,
    canReuse: false,
    profile: null,
};
const installed = {...absent, installed: true, version: '8.15.1'};
const waiting = {
    id: 'job-one',
    status: 'waiting',
    browserOpened: false,
    authUrl: 'https://oauth2.neon.tech/oauth2/auth?state=private-sign-in-state',
};
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return {promise, resolve};
}
function show() {
    const connected = vi.fn(),
        keyConnected = vi.fn();
    const view = render(
        createElement(AccountAuthentication, {
            onCliConnected: connected,
            onApiKeyConnected: keyConnected,
        }),
    );
    return {...view, connected, keyConnected};
}
async function ready() {
    await waitFor(() => expect(screen.queryByText('account.cli.checking')).toBeNull());
}

describe('Neon CLI account authentication', () => {
    it('lets the user select and reuse a named CLI profile', async () => {
        prepare.mockImplementation(async (method: string, args?: {profile?: string}) => {
            if (method === 'account_cli_status')
                return {
                    ...installed,
                    profiles: ['DEFAULT', 'work'],
                    profile: args?.profile ?? 'DEFAULT',
                    canReuse: args?.profile === 'work',
                    authenticated: args?.profile === 'work',
                };
            if (method === 'account_cli_use') return {profile: args?.profile};
            return null;
        });
        const view = show();
        await ready();
        selectOption(screen.getByLabelText('account.cli.profile'), 'work');
        await waitFor(() =>
            expect(screen.getByRole('button', {name: 'account.cli.useSignedIn'})).toBeDefined(),
        );
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.useSignedIn'}));
        await waitFor(() => expect(view.connected).toHaveBeenCalledWith('work'));
        expect(prepare).toHaveBeenCalledWith('account_cli_use', {profile: 'work'});
    });
    it('shows upgrade help instead of a failing sign-in button for unsupported CLI versions', async () => {
        prepare.mockResolvedValue({
            ...installed,
            version: '7.0.0',
            reasonCode: 'unsupported-version',
        });
        show();
        await ready();
        expect(screen.getByText('account.cli.unsupportedVersion')).toBeDefined();
        expect(screen.queryByRole('button', {name: 'account.cli.signIn'})).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.install'}));
        expect(screen.getByText('npm install -g neon@latest')).toBeDefined();
    });
    it('explains protected profiles and offers a separate CLI sign-in', async () => {
        prepare.mockResolvedValue({...installed, reasonCode: 'keyring'});
        show();
        await ready();
        expect(screen.getByText('account.cli.keyringProfile')).toBeDefined();
        expect(screen.getByRole('button', {name: 'account.cli.signIn'})).toBeDefined();
        expect(screen.queryByRole('button', {name: 'account.cli.useSignedIn'})).toBeNull();
    });
    beforeEach(() => {
        vi.resetAllMocks();
        copyText.mockResolvedValue(undefined);
        openUrl.mockResolvedValue(undefined);
        prepare.mockImplementation(async (method: string) => {
            if (method === 'account_cli_status') return absent;
            if (method === 'account_cli_login_start' || method === 'account_cli_login_poll')
                return waiting;
            return null;
        });
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('detects without starting a login and shows explicit install help and key fallback', async () => {
        const {keyConnected} = show();
        await ready();
        expect(prepare).toHaveBeenCalledExactlyOnceWith('account_cli_status');
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.install'}));
        expect(screen.getByText('npm install -g neon@latest')).toBeDefined();
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.copyInstall'}));
        await waitFor(() => expect(copyText).toHaveBeenCalledWith('npm install -g neon@latest'));
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.installGuide'}));
        expect(openUrl).toHaveBeenCalledWith('https://neon.com/docs/cli/install');
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.useApiKey'}));
        const input = screen.getByLabelText('account.apiKey');
        expect(input.getAttribute('type')).toBe('password');
        fireEvent.change(input, {target: {value: 'secret-api-key'}});
        fireEvent.submit(input.closest('form')!);
        expect(keyConnected).toHaveBeenCalledWith('secret-api-key', expect.any(Function));
        expect(openUrl).toHaveBeenCalledTimes(1);
    });
    it('links management access with only the CLI profile and checks the saved project', async () => {
        prepare.mockImplementation(async (method: string) =>
            method === 'account_cli_status'
                ? {...installed, authenticated: true, canReuse: true, profile: 'DEFAULT'}
                : {profile: 'DEFAULT'},
        );
        connect.mockResolvedValue(undefined);
        call.mockResolvedValue({branches: []});
        const completed = vi.fn();
        render(
            createElement(ManagementAccountForm, {
                projectId: 'saved-project',
                onConnected: completed,
            }),
        );
        await ready();
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.useSignedIn'}));
        await waitFor(() => expect(completed).toHaveBeenCalledOnce());
        expect(connect).toHaveBeenCalledExactlyOnceWith({NEON_CLI_AUTH: 'DEFAULT'});
        expect(call).toHaveBeenCalledExactlyOnceWith('account_branches', {
            projectId: 'saved-project',
        });
    });
    it('keeps management auth open when project access is denied and hides raw server errors', async () => {
        prepare.mockImplementation(async (method: string) =>
            method === 'account_cli_status'
                ? {...installed, authenticated: true, canReuse: true, profile: 'DEFAULT'}
                : {profile: 'DEFAULT'},
        );
        connect.mockResolvedValue(undefined);
        call.mockRejectedValue(new Error('Bearer private-token'));
        const completed = vi.fn();
        const {container} = render(
            createElement(ManagementAccountForm, {
                projectId: 'saved-project',
                onConnected: completed,
            }),
        );
        await ready();
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.useSignedIn'}));
        await waitFor(() =>
            expect(screen.getByRole('alert').textContent).toBe('account.cli.connectFailed'),
        );
        expect(completed).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain('private-token');
    });
    it('rechecks after installation without automatically opening a browser', async () => {
        show();
        await ready();
        prepare.mockResolvedValue(installed);
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.recheck'}));
        await waitFor(() =>
            expect(screen.getByRole('button', {name: 'account.cli.signIn'})).toBeDefined(),
        );
        expect(openUrl).not.toHaveBeenCalled();
        expect(prepare).toHaveBeenCalledTimes(2);
    });
    it('requires a click to reuse a signed-in CLI account and passes only its profile', async () => {
        prepare.mockImplementation(async (method: string) =>
            method === 'account_cli_status'
                ? {...installed, authenticated: true, canReuse: true, profile: 'DEFAULT'}
                : {profile: 'DEFAULT'},
        );
        const {connected} = show();
        await ready();
        expect(connected).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.useSignedIn'}));
        await waitFor(() => expect(connected).toHaveBeenCalledWith('DEFAULT'));
        expect(prepare).toHaveBeenCalledWith('account_cli_use', {profile: 'DEFAULT'});
        expect(openUrl).not.toHaveBeenCalled();
    });
    it('opens the host browser once per login, supports reopen, polls completion, and never renders the URL', async () => {
        prepare.mockImplementation(async (method: string) => {
            if (method === 'account_cli_status') return installed;
            return waiting;
        });
        const {container, connected} = show();
        await ready();
        vi.useFakeTimers();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'account.cli.signIn'}));
        });
        expect(openUrl).toHaveBeenCalledExactlyOnceWith(waiting.authUrl);
        expect(container.textContent).not.toContain('private-sign-in-state');
        expect(container.innerHTML).not.toContain(waiting.authUrl);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(openUrl).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.reopen'}));
        expect(openUrl).toHaveBeenCalledTimes(2);
        prepare.mockResolvedValue({...waiting, status: 'complete', profile: 'tabularis-one'});
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(connected).toHaveBeenCalledWith('tabularis-one');
        expect(prepare).toHaveBeenCalledWith('account_cli_login_poll', {id: 'job-one'});
    });
    it('does not open a second browser when the backend already opened it', async () => {
        prepare.mockImplementation(async (method: string) =>
            method === 'account_cli_status' ? installed : {...waiting, browserOpened: true},
        );
        show();
        await ready();
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.signIn'}));
        await waitFor(() => expect(screen.getByText('account.cli.finishSignIn')).toBeDefined());
        expect(openUrl).not.toHaveBeenCalled();
    });
    it.each([
        'http://oauth2.neon.tech/oauth2/auth',
        'https://evil.example/oauth2/auth',
        'https://console.neon.tech/oauth2/auth',
        'https://oauth2.neon.tech/other',
        'https://user:password@oauth2.neon.tech/oauth2/auth',
        'https://oauth2.neon.tech/oauth2/auth#secret',
    ])('rejects unexpected sign-in URL %s', async (authUrl) => {
        prepare.mockImplementation(async (method: string) =>
            method === 'account_cli_status' ? installed : {...waiting, authUrl},
        );
        show();
        await ready();
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.signIn'}));
        await waitFor(() =>
            expect(screen.getByRole('alert').textContent).toBe('account.cli.loginFailed'),
        );
        expect(openUrl).not.toHaveBeenCalled();
        expect(prepare).toHaveBeenCalledWith('account_cli_login_cancel', {id: 'job-one'});
    });
    it('cancels a late start after unmount without opening the browser or linking an account', async () => {
        const pending = deferred<typeof waiting>();
        prepare.mockImplementation((method: string) =>
            method === 'account_cli_status'
                ? Promise.resolve(installed)
                : method === 'account_cli_login_start'
                  ? pending.promise
                  : Promise.resolve(null),
        );
        const {unmount, connected} = show();
        await ready();
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.signIn'}));
        unmount();
        await act(async () => {
            pending.resolve(waiting);
        });
        expect(prepare).toHaveBeenCalledWith('account_cli_login_cancel', {id: 'job-one'});
        expect(openUrl).not.toHaveBeenCalled();
        expect(connected).not.toHaveBeenCalled();
    });
    it('ignores an old completed poll when the user switches to API key', async () => {
        const poll = deferred<typeof waiting & {profile: string}>();
        prepare.mockImplementation((method: string) =>
            Promise.resolve(
                method === 'account_cli_status'
                    ? installed
                    : method === 'account_cli_login_start'
                      ? waiting
                      : method === 'account_cli_login_poll'
                        ? poll.promise
                        : null,
            ),
        );
        const {connected} = show();
        await ready();
        vi.useFakeTimers();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'account.cli.signIn'}));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        fireEvent.click(screen.getByRole('button', {name: 'account.cli.useApiKey'}));
        await act(async () => {
            poll.resolve({...waiting, status: 'complete', profile: 'stale'});
        });
        expect(connected).not.toHaveBeenCalled();
        expect(screen.getByLabelText('account.apiKey')).toBeDefined();
        expect(prepare).toHaveBeenCalledWith('account_cli_login_cancel', {id: 'job-one'});
    });
    it('times out bounded login, cancels its job and retains the API-key fallback', async () => {
        prepare.mockImplementation(async (method: string) =>
            method === 'account_cli_status' ? installed : waiting,
        );
        show();
        await ready();
        vi.useFakeTimers();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'account.cli.signIn'}));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(180_000);
        });
        expect(screen.getByRole('alert').textContent).toBe('account.cli.timeout');
        expect(prepare).toHaveBeenCalledWith('account_cli_login_cancel', {id: 'job-one'});
        expect(screen.getByRole('button', {name: 'account.cli.useApiKey'})).toBeDefined();
    });
    it('shows a safe actionable error without rendering raw CLI output or credentials', async () => {
        prepare.mockRejectedValue(new Error('Bearer secret-token https://private-cli-url.example'));
        const {container} = show();
        await ready();
        expect(screen.getByRole('alert').textContent).toBe('account.cli.detectFailed');
        expect(container.textContent).not.toMatch(/secret-token|private-cli-url/);
        expect(screen.getByRole('button', {name: 'account.cli.useApiKey'})).toBeDefined();
    });
});
