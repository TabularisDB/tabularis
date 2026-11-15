import {useCallback, useEffect, useId, useRef} from 'react';
import type {BeforeMount} from '@monaco-editor/react';
import {MonacoEditor} from '@/components/ui/LazyMonaco';
import {useEditorTheme} from '@/hooks/useEditorTheme';
import {useSettings} from '@/hooks/useSettings';
import {loadMonacoTheme} from '@/themes/themeUtils';
import {getMonacoThemeId} from '@/themes/themeRuntime';
import {getFontCSS} from '@/utils/settings';
import {EDITOR_FONT_SIZE_DEFAULT} from '@/utils/editorFontSize';
import type {PluginCodeEditorProps} from '@/types/pluginResources';

/** General code editing shares Monaco and user preferences without SQL commands. */
export function PluginCodeEditor({
    value,
    onChange,
    language = 'javascript',
    readOnly = false,
    label,
    fileName,
    onDiagnostics,
}: PluginCodeEditorProps) {
    const modelId = useId();
    const extension = {javascript: 'js', typescript: 'ts', json: 'json', plaintext: 'txt'}[
        language
    ];
    const path = `file:///tabularis-plugins/${encodeURIComponent(modelId)}/${encodeURIComponent(fileName ?? `index.${extension}`)}`;
    const theme = useEditorTheme();
    const {settings} = useSettings();
    const monaco = useRef<Parameters<BeforeMount>[0] | null>(null);
    const beforeMount = useCallback<BeforeMount>(
        (instance) => {
            monaco.current = instance;
            loadMonacoTheme(theme, instance);
        },
        [theme],
    );
    useEffect(() => {
        if (monaco.current) loadMonacoTheme(theme, monaco.current);
    }, [theme]);
    return (
        <div
            className="h-full min-h-[240px] min-w-0 overflow-hidden border border-default"
            role={label ? 'region' : undefined}
            aria-label={label}
        >
            <MonacoEditor
                key={path}
                height="100%"
                path={path}
                onValidate={(markers) =>
                    onDiagnostics?.(
                        markers.map((marker) => ({
                            severity:
                                marker.severity === 8
                                    ? 'error'
                                    : marker.severity === 4
                                      ? 'warning'
                                      : 'info',
                            message: marker.message,
                            line: marker.startLineNumber,
                            column: marker.startColumn,
                        })),
                    )
                }
                language={language}
                value={value}
                onChange={(next) => onChange(next ?? '')}
                beforeMount={beforeMount}
                theme={getMonacoThemeId(theme.id)}
                options={{
                    readOnly,
                    domReadOnly: readOnly,
                    ariaLabel: label,
                    automaticLayout: true,
                    renderValidationDecorations: 'on',
                    wordWrap: 'on',
                    padding: {top: 10, bottom: 10},
                    scrollbar: {alwaysConsumeMouseWheel: false},
                    bracketPairColorization: {enabled: true},
                    formatOnPaste: true,
                    formatOnType: true,
                    minimap: {enabled: false},
                    scrollBeyondLastLine: false,
                    fontSize: settings.editorFontSize ?? EDITOR_FONT_SIZE_DEFAULT,
                    fontFamily: getFontCSS(settings.editorFontFamily ?? 'JetBrains Mono'),
                    tabSize: 2,
                }}
            />
        </div>
    );
}
