import {useCallback, useEffect, useRef, useState} from 'react';
import {openUrl, usePluginAccount} from '@tabularis/plugin-api';

interface CliStatus {
    profiles?: string[];
    reasonCode?: 'missing' | 'unsupported-version' | 'keyring' | 'signed-out' | 'unavailable';
    installed: boolean;
    version: string | null;
    authenticated: boolean;
    canReuse: boolean;
    profile: string | null;
}
interface LoginJob {
    id: string;
    status: 'waiting' | 'complete' | 'failed';
    authUrl?: string;
    browserOpened: boolean;
    profile?: string;
}
type Phase = 'checking' | 'idle' | 'starting' | 'waiting' | 'connecting';

export function useCliAuthentication(onConnected: (profile: string) => Promise<void> | void) {
    const account = usePluginAccount('neon');
    // Setup belongs to this mounted form; host re-renders must not restart detection or login.
    const [prepare] = useState(() => account.prepare);
    const [status, setStatus] = useState<CliStatus>();
    const [selectedProfile, setSelectedProfile] = useState<string>();
    const [phase, setPhase] = useState<Phase>('checking');
    const [error, setError] = useState<string>();
    const [authUrl, setAuthUrl] = useState<string>();
    const mounted = useRef(false);
    const epoch = useRef(0);
    const activeJob = useRef<string | undefined>(undefined);
    const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const deadlineTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const stop = useCallback(() => {
        epoch.current += 1;
        clearTimeout(pollTimer.current);
        clearTimeout(deadlineTimer.current);
        const id = activeJob.current;
        activeJob.current = undefined;
        if (id) void prepare('account_cli_login_cancel', {id}).catch(() => undefined);
    }, [prepare]);
    const recheck = useCallback(
        async (profile = selectedProfile) => {
            stop();
            const request = epoch.current;
            setPhase('checking');
            setError(undefined);
            setAuthUrl(undefined);
            if (profile) setSelectedProfile(profile);
            try {
                const detected = await (profile
                    ? prepare<CliStatus>('account_cli_status', {profile})
                    : prepare<CliStatus>('account_cli_status'));
                if (mounted.current && request === epoch.current) setStatus(detected);
            } catch {
                if (mounted.current && request === epoch.current)
                    setError('account.cli.detectFailed');
            } finally {
                if (mounted.current && request === epoch.current) setPhase('idle');
            }
        },
        [prepare, selectedProfile, stop],
    );
    useEffect(() => {
        mounted.current = true;
        let current = true;
        const request = epoch.current;
        void prepare<CliStatus>('account_cli_status')
            .then((detected) => {
                if (current && request === epoch.current) {
                    setStatus(detected);
                    setPhase('idle');
                }
            })
            .catch(() => {
                if (current && request === epoch.current) {
                    setError('account.cli.detectFailed');
                    setPhase('idle');
                }
            });
        return () => {
            current = false;
            mounted.current = false;
            stop();
        };
    }, [prepare, stop]);
    const cancel = useCallback(() => {
        stop();
        setPhase('idle');
        setAuthUrl(undefined);
    }, [stop]);
    const reuse = async () => {
        stop();
        const request = epoch.current;
        setPhase('connecting');
        setError(undefined);
        try {
            const result = await prepare<{profile: string}>(
                'account_cli_use',
                status?.profile ? {profile: status.profile} : {},
            );
            if (mounted.current && request === epoch.current) await onConnected(result.profile);
        } catch {
            if (mounted.current && request === epoch.current) setError('account.cli.connectFailed');
        } finally {
            if (mounted.current && request === epoch.current) setPhase('idle');
        }
    };
    const start = async () => {
        stop();
        const request = epoch.current;
        const current = () => mounted.current && request === epoch.current;
        setPhase('starting');
        setError(undefined);
        setAuthUrl(undefined);
        const fail = (key: string) => {
            if (!current()) return;
            stop();
            setPhase('idle');
            setAuthUrl(undefined);
            setError(key);
        };
        deadlineTimer.current = setTimeout(() => fail('account.cli.timeout'), 180_000);
        let opened = false;
        const accept = async (job: LoginJob): Promise<void> => {
            if (!current()) {
                if (job.status === 'waiting') {
                    void prepare('account_cli_login_cancel', {id: job.id}).catch(() => undefined);
                }
                return;
            }
            activeJob.current = job.id;
            if (job.status === 'failed') return fail('account.cli.loginFailed');
            if (job.status === 'complete') {
                if (!job.profile) return fail('account.cli.loginFailed');
                clearTimeout(deadlineTimer.current);
                activeJob.current = undefined;
                setPhase('connecting');
                setAuthUrl(undefined);
                await onConnected(job.profile);
                if (current()) setPhase('idle');
                return;
            }
            setPhase('waiting');
            if (job.authUrl) {
                // The backend validates the CLI URL too. Never expose it as text or log it.
                const url = new URL(job.authUrl);
                if (
                    url.protocol !== 'https:' ||
                    url.username ||
                    url.password ||
                    url.port ||
                    url.hostname !== 'oauth2.neon.tech' ||
                    url.pathname !== '/oauth2/auth' ||
                    url.hash
                ) {
                    return fail('account.cli.loginFailed');
                }
                setAuthUrl(job.authUrl);
                if (!opened) {
                    opened = true;
                    if (!job.browserOpened)
                        await openUrl(job.authUrl).catch(() => {
                            if (current()) setError('account.cli.browserFailed');
                        });
                }
            }
            if (current()) {
                pollTimer.current = setTimeout(() => {
                    void prepare<LoginJob>('account_cli_login_poll', {id: job.id})
                        .then(accept)
                        .catch(() => fail('account.cli.loginFailed'));
                }, 1500);
            }
        };
        try {
            await accept(await prepare<LoginJob>('account_cli_login_start', {}));
        } catch {
            fail('account.cli.loginFailed');
        }
    };
    const reopen = async () => {
        if (!authUrl) return;
        try {
            await openUrl(authUrl);
        } catch {
            if (mounted.current) setError('account.cli.browserFailed');
        }
    };
    return {status, selectedProfile, phase, error, authUrl, recheck, reuse, start, cancel, reopen};
}
