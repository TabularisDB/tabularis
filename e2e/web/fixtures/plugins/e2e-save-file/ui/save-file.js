var __tabularis_plugin__ = function E2eSaveFile() {
    const [status, setStatus] = React.useState('idle');
    const [focusStatus, setFocusStatus] = React.useState('idle');
    const save = (suggestedName, update) =>
        __TABULARIS_API__
            .saveFile({
                data: new TextEncoder().encode('saved by a sandboxed plugin'),
                suggestedName,
                mimeType: 'text/plain',
            })
            .then(
                (saved) => update(saved ? 'saved' : 'cancelled'),
                (error) => update(error.message),
            );
    // Once armed, saves as soon as the frame gets focus, without an interaction in
    // the plugin, as a plugin could after the host moves focus to its frame.
    React.useEffect(() => {
        if (focusStatus !== 'armed') return undefined;
        const onFocus = () => {
            setFocusStatus('saving');
            save('e2e-focus.txt', setFocusStatus);
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [focusStatus]);
    return React.createElement(
        'div',
        null,
        React.createElement(
            'button',
            {
                'data-testid': 'e2e-save-file',
                'data-status': status,
                onClick: () => save('../e2e-saved.txt', setStatus),
            },
            'Save plugin file',
        ),
        React.createElement(
            'button',
            {
                'data-testid': 'e2e-save-on-focus',
                'data-status': focusStatus,
                onClick: () => setFocusStatus('armed'),
            },
            'Save on next focus',
        ),
    );
};
