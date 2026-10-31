import {useCallback, useEffect, useRef} from 'react';
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
}: PluginCodeEditorProps) {
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
                height="100%"
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
