import type * as Monaco from 'monaco-editor';

// Keep Node declarations local and versioned with the host, including offline use.
const nodeTypes = import.meta.glob<string>(
    [
        '../../../../node_modules/@types/node/**/*.d.ts',
        '!../../../../node_modules/@types/node/ts*/**',
        '../../../../node_modules/undici-types/*.d.ts',
    ],
    {query: '?raw', import: 'default', eager: true},
);
const configured = new WeakSet<typeof Monaco>();

export function configurePluginCodeLanguage(monaco: typeof Monaco): void {
    if (configured.has(monaco)) return;
    configured.add(monaco);
    const ts = monaco.typescript;
    for (const defaults of [ts.javascriptDefaults, ts.typescriptDefaults]) {
        defaults.setCompilerOptions({
            allowJs: true,
            checkJs: true,
            noEmit: true,
            skipLibCheck: true,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            allowSyntheticDefaultImports: true,
            esModuleInterop: true,
            types: ['node'],
        });
        defaults.setDiagnosticsOptions({noSyntaxValidation: false, noSemanticValidation: false});
        for (const [path, content] of Object.entries(nodeTypes)) {
            defaults.addExtraLib(content, `file:///${path.slice(path.indexOf('node_modules/'))}`);
        }
    }
}
