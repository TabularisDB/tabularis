/**
 * "Export table to SQL" and "Import table from SQL" for the command palette
 * (#709). The explorer sidebar owns both modals and knows the selected node,
 * so it registers what the two commands do for its connection, and the
 * palette offers them for the active connection.
 */

export interface TableTransferCommand {
    /** Shown next to the command: the table, or the import target. */
    description?: string;
    run: () => void;
}

export interface TableTransferCommands {
    exportTable?: TableTransferCommand;
    importTable?: TableTransferCommand;
}

type Listener = () => void;

export interface TableTransferCommandStore {
    get: (connectionId: string | null) => TableTransferCommands | undefined;
    /** Returns the cleanup; only the current owner of the entry clears it. */
    register: (connectionId: string, commands: TableTransferCommands) => () => void;
    subscribe: (listener: Listener) => () => void;
}

export function createTableTransferCommandStore(): TableTransferCommandStore {
    const entries = new Map<string, TableTransferCommands>();
    const listeners = new Set<Listener>();
    const notify = () => listeners.forEach((listener) => listener());

    return {
        get: (connectionId) => (connectionId ? entries.get(connectionId) : undefined),
        register: (connectionId, commands) => {
            entries.set(connectionId, commands);
            notify();
            return () => {
                if (entries.get(connectionId) !== commands) return;
                entries.delete(connectionId);
                notify();
            };
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export const tableTransferCommandStore = createTableTransferCommandStore();
