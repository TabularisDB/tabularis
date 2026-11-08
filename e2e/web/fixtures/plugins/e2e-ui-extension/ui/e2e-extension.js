var __tabularis_plugin__ = function E2eUiExtension() {
    const connection = __TABULARIS_API__.usePluginConnection();
    return React.createElement(
        'span',
        {
            'data-testid': 'e2e-ui-extension',
            'data-api-version': '0.1.1',
            'data-connection-id': connection.connectionId ?? '',
            style: {fontSize: '10px', padding: '0 4px'},
        },
        'E2E UI extension loaded',
    );
};
