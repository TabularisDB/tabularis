import type {EditorCommands} from '@/types/commands';
import type {Tab} from '@/types/editor';

interface CreateActiveEditorCommandsOptions {
    tabType: Tab['type'];
    hasConnection: boolean;
    hasRunnableQuery: boolean;
    isReadOnly: boolean;
    isLoading: boolean;
    canSaveSqlFile: boolean;
    statementCount: number;
    aiEnabled: boolean;
    labels: {
        run: string;
        runAll: string;
        saveSqlFile: string;
        closeTab: string;
        aiGenerate: string;
        aiExplain: string;
    };
    actions: {
        run: () => void | Promise<void>;
        runAll: () => void | Promise<void>;
        saveSqlFile: () => void | Promise<void>;
        closeTab: () => void | Promise<void>;
        aiGenerate: () => void;
        aiExplain: () => void;
    };
}

export function createActiveEditorCommands({
    tabType,
    hasConnection,
    hasRunnableQuery,
    isReadOnly,
    isLoading,
    canSaveSqlFile,
    statementCount,
    aiEnabled,
    labels,
    actions,
}: CreateActiveEditorCommandsOptions): EditorCommands {
    const closeTabCommand: EditorCommands = {
        closeTab: {label: labels.closeTab, execute: actions.closeTab},
    };
    const saveSqlFileCommand: EditorCommands =
        tabType === 'console' && canSaveSqlFile
            ? {
                  saveSqlFile: {
                      label: labels.saveSqlFile,
                      execute: actions.saveSqlFile,
                  },
              }
            : {};
    const aiCommands: EditorCommands =
        aiEnabled && hasConnection && tabType === 'console'
            ? {
                  aiGenerate: {label: labels.aiGenerate, execute: actions.aiGenerate},
                  ...(hasRunnableQuery
                      ? {aiExplain: {label: labels.aiExplain, execute: actions.aiExplain}}
                      : {}),
              }
            : {};

    const canRun =
        hasConnection &&
        hasRunnableQuery &&
        !isReadOnly &&
        !isLoading &&
        tabType !== 'notebook' &&
        tabType !== 'users';

    if (!canRun) return {...closeTabCommand, ...saveSqlFileCommand, ...aiCommands};

    return {
        ...closeTabCommand,
        ...saveSqlFileCommand,
        ...aiCommands,
        run: {label: labels.run, execute: actions.run},
        ...(tabType === 'console' && statementCount > 1
            ? {runAll: {label: labels.runAll, execute: actions.runAll}}
            : {}),
    };
}
