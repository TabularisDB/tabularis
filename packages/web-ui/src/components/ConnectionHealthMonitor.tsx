import {useEffect, useCallback} from 'react';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router-dom';
import {useAlert} from '@/hooks/useAlert';
import {useToast} from '@/hooks/useToast';

/**
 * Headless component that reports backend connection health: a toast while a
 * failed connection is recovered, and an alert when it is lost. Must be
 * rendered inside AlertProvider, ToastProvider and BrowserRouter.
 */
export function ConnectionHealthMonitor() {
    const client = useTabularisClient();
    const {showAlert} = useAlert();
    const {showToast} = useToast();
    const {t} = useTranslation();
    const navigate = useNavigate();

    const goToConnections = useCallback(() => {
        navigate('/connections');
    }, [navigate]);

    useEffect(() => {
        const unlisten = client.subscribe('connection-health-failed', (event) => {
            const {error} = event;
            showAlert(`${t('healthCheck.connectionLost')}: ${error}`, {
                kind: 'error',
                title: t('healthCheck.title'),
                onClose: goToConnections,
            });
        });
        return () => {
            unlisten.then((fn) => fn());
        };
    }, [client, showAlert, t, goToConnections]);

    useEffect(() => {
        const unlisten = client.subscribe('connection-lifecycle', (event) => {
            if (event.state === 'reconnecting') {
                showToast(t('healthCheck.reconnecting'), {kind: 'warning'});
            } else if (event.releasedSessions > 0) {
                showToast(t('healthCheck.reconnectedSessionsReset'), {
                    kind: 'warning',
                    duration: 0,
                });
            } else {
                showToast(t('healthCheck.reconnected'), {kind: 'success'});
            }
        });
        return () => {
            unlisten.then((fn) => fn());
        };
    }, [client, showToast, t]);

    return null;
}
