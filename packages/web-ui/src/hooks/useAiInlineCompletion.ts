import {useContext, useEffect} from 'react';
import {TabularisClientContext} from '@/contexts/TabularisClientContext';
import {useSettings} from './useSettings';
import type {SqlDiagnosticsTarget} from './useSqlDiagnostics';
import {installAiInlineCompletion, type AiInlineContext} from '@/utils/aiInlineCompletion';

export function useAiInlineCompletion(
    target: SqlDiagnosticsTarget | null,
    context?: AiInlineContext,
) {
    const client = useContext(TabularisClientContext);
    const {settings} = useSettings();
    const {aiEnabled, aiInlineCompletionEnabled, aiProvider, aiModel} = settings;
    const editor = target?.editor;
    const monaco = target?.monaco;
    const key = context
        ? JSON.stringify([
              context.key,
              settings.aiOllamaPort,
              settings.aiCustomOpenaiUrl,
              settings.aiCustomOpenaiModel,
          ])
        : undefined;
    const schema = context?.schema;
    const dialect = context?.dialect;
    useEffect(() => {
        if (
            !client ||
            !editor ||
            !monaco ||
            !aiEnabled ||
            !aiInlineCompletionEnabled ||
            !aiProvider ||
            key === undefined ||
            schema === undefined ||
            dialect === undefined
        )
            return;
        const registration = installAiInlineCompletion(editor, monaco, client, {
            key,
            schema,
            dialect,
            provider: aiProvider,
            model: aiModel ?? '',
        });
        return () => registration.dispose();
    }, [
        client,
        editor,
        monaco,
        aiEnabled,
        aiInlineCompletionEnabled,
        aiProvider,
        aiModel,
        key,
        schema,
        dialect,
    ]);
}
