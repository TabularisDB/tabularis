var __tabularis_plugin__ = function E2eSaveFile() {
    const [status, setStatus] = React.useState('idle');
    const save = () =>
        __TABULARIS_API__
            .saveFile({
                data: new TextEncoder().encode('saved by a sandboxed plugin'),
                suggestedName: '../e2e-saved.txt',
                mimeType: 'text/plain',
            })
            .then(
                (saved) => setStatus(saved ? 'saved' : 'cancelled'),
                (error) => setStatus(error.message),
            );
    return React.createElement(
        'button',
        {
            'data-testid': 'e2e-save-file',
            'data-status': status,
            onClick: save,
        },
        'Save plugin file',
    );
};
