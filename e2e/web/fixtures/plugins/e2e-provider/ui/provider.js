var __tabularis_plugin__ = function ProviderFixture({context}) {
    const api = __TABULARIS_API__;
    const account = api.usePluginAccount('e2e-provider');
    const workspace = api.usePluginWorkspace('e2e-provider');
    const modal = api.usePluginModal();
    const rpc = api.usePluginRpc('e2e-provider', context.connectionId);
    const [result, setResult] = React.useState('');
    const [source, setSource] = React.useState('const revision = 1;');
    const [database, setDatabase] = React.useState('main');
    const [language, setLanguage] = React.useState('javascript');
    const [accountLoaded, setAccountLoaded] = React.useState(false);
    api.usePluginEvent(
        'e2e-provider',
        'resource-changed',
        React.useCallback((detail) => {
            setResult(`event:${detail.marker}`);
        }, []),
    );
    if (context.__tabularisSlot === 'connection-modal.setup') {
        // A short first state, like a provider still loading its account, then the long form.
        if (!accountLoaded)
            return React.createElement(
                'div',
                {'data-testid': 'provider-account-loading', className: 'p-4 text-primary'},
                React.createElement(
                    'button',
                    {
                        'data-testid': 'provider-load-account',
                        className: 'rounded-lg bg-accent-primary px-3 py-2 text-inverse',
                        onClick: () => setAccountLoaded(true),
                    },
                    'Load provider account',
                ),
            );
        return React.createElement(
            'div',
            {'data-testid': 'provider-long-setup', className: 'p-4 text-primary'},
            React.createElement(
                'h3',
                {className: 'text-sm font-semibold'},
                'Provider account import',
            ),
            React.createElement('div', {style: {height: 300}}, 'Choose an existing database'),
            React.createElement(api.PluginSelect, {
                ariaLabel: 'Provider database',
                value: database,
                options: [
                    {value: 'main', label: 'Main database'},
                    {value: 'neondb', label: 'Disposable database'},
                ],
                onChange: setDatabase,
            }),
            React.createElement('output', {'data-testid': 'provider-database'}, database),
            React.createElement('div', {style: {height: 600}}, 'Existing provider services'),
            React.createElement(
                'button',
                {
                    'data-testid': 'provider-import-footer',
                    className: 'rounded-lg bg-accent-primary px-3 py-2 text-inverse',
                    onClick: () => setResult('import-ready'),
                },
                'Import connection',
            ),
            React.createElement('output', {'data-testid': 'provider-import-result'}, result),
        );
    }
    if (context.workspaceId) {
        const content = React.createElement(
            'div',
            {style: {height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column'}},
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
            React.createElement(api.PluginSelect, {
                ariaLabel: 'Provider source language',
                value: language,
                options: [
                    {value: 'javascript', label: 'JavaScript'},
                    {value: 'typescript', label: 'TypeScript'},
                ],
                onChange: setLanguage,
            }),
            React.createElement(
                'div',
                {style: {flex: '1 1 0%', minHeight: 240}},
                React.createElement(api.PluginCodeEditor, {
                    value: source,
                    language,
                    fileName: language === 'typescript' ? 'index.ts' : 'index.js',
                    onChange: setSource,
                    label: 'Provider source editor',
                }),
            ),
        );
        return React.createElement(
            api.PluginWorkspaceShell,
            {title: 'Provider workspace'},
            content,
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
