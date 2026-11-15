var __tabularis_plugin__ = function ProviderFixture({context}) {
    const api = __TABULARIS_API__;
    const account = api.usePluginAccount('e2e-provider');
    const workspace = api.usePluginWorkspace('e2e-provider');
    const modal = api.usePluginModal();
    const rpc = api.usePluginRpc('e2e-provider', context.connectionId);
    const [result, setResult] = React.useState('');
    const [source, setSource] = React.useState('const revision = 1;');
    api.usePluginEvent(
        'e2e-provider',
        'resource-changed',
        React.useCallback((detail) => {
            setResult(`event:${detail.marker}`);
        }, []),
    );
    if (context.workspaceId) {
        return React.createElement(
            'div',
            {style: {height: '100%'}},
            React.createElement(
                'p',
                {'data-testid': 'provider-workspace'},
                'Provider workspace ready',
            ),
            React.createElement('p', {'data-testid': 'provider-source'}, source),
            React.createElement(
                'button',
                {
                    'data-testid': 'provider-publish',
                    onClick: () =>
                        api.publishPluginEvent('e2e-provider', 'resource-changed', {
                            marker: 'sibling-refresh-ok',
                        }),
                },
                'Refresh sibling provider views',
            ),
            React.createElement(
                'button',
                {
                    'data-testid': 'provider-modal',
                    onClick: () =>
                        modal.openModal({
                            title: 'Provider confirmation',
                            content: React.createElement(
                                'button',
                                {
                                    'data-testid': 'provider-confirm',
                                    onClick: () => modal.closeModal(),
                                },
                                'Confirm provider action',
                            ),
                        }),
                },
                'Open provider dialog',
            ),
            React.createElement(api.PluginDataGrid, {
                columns: ['revision'],
                rows: [['native-grid-ok']],
                connectionId: context.connectionId,
                label: 'Provider result grid',
            }),
            React.createElement(
                'div',
                {style: {height: '260px'}},
                React.createElement(api.PluginCodeEditor, {
                    value: source,
                    onChange: setSource,
                    label: 'Provider source editor',
                }),
            ),
        );
    }
    if (context.connectionId) {
        return React.createElement(
            'div',
            null,
            React.createElement(
                'button',
                {
                    'data-testid': 'provider-call',
                    onClick: () =>
                        rpc
                            .call('provider_status')
                            .then((value) => setResult(JSON.stringify(value)))
                            .catch((error) => setResult(error.message)),
                },
                'Check provider connection',
            ),
            React.createElement('output', {'data-testid': 'provider-result'}, result),
            React.createElement(
                'button',
                {
                    'data-testid': 'provider-open',
                    onClick: () =>
                        workspace.openWorkspace({
                            id: 'services',
                            title: 'Provider services',
                            connectionId: context.connectionId,
                        }),
                },
                'Open provider workspace',
            ),
            React.createElement(
                'button',
                {
                    'data-testid': 'provider-open-other',
                    onClick: () =>
                        workspace.openWorkspace({
                            id: 'other',
                            title: 'Provider other',
                            connectionId: context.connectionId,
                        }),
                },
                'Open other provider workspace',
            ),
        );
    }
    return React.createElement(
        'div',
        null,
        React.createElement(
            'button',
            {
                'data-testid': 'provider-prepare',
                onClick: () =>
                    account
                        .prepare('provider_status')
                        .then((value) => setResult(JSON.stringify(value)))
                        .catch((error) => setResult(error.message)),
            },
            'Check provider account setup',
        ),
        React.createElement('output', {'data-testid': 'provider-result'}, result),
    );
};
