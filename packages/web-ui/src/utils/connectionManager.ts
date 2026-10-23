import type {SavedConnection, ConnectionData, ConnectionGroup} from '@/contexts/DatabaseContext';

export interface ConnectionStatus {
    id: string;
    name: string;
    driver: string;
    database: string;
    host?: string;
    sshEnabled: boolean;
    k8sEnabled: boolean;
    ssmEnabled: boolean;
    isOpen: boolean;
    isActive: boolean;
    isConnecting: boolean;
    isConnected: boolean;
    error?: string;
}

/** Build a ConnectionStatus from raw connection data */
export function buildConnectionStatus(
    conn: SavedConnection,
    isOpen: boolean,
    isActive: boolean,
    data: ConnectionData | undefined,
): ConnectionStatus {
    return {
        id: conn.id,
        name: conn.name,
        driver: conn.params.driver,
        database: Array.isArray(conn.params.database)
            ? conn.params.database[0]
            : conn.params.database,
        host: conn.params.host,
        sshEnabled: conn.params.ssh_enabled ?? false,
        k8sEnabled: conn.params.k8s_enabled ?? false,
        ssmEnabled: conn.params.ssm_enabled ?? false,
        isOpen,
        isActive,
        isConnecting: data?.isConnecting ?? false,
        isConnected: data?.isConnected ?? false,
        error: data?.error,
    };
}

/** Split connections into open and closed */
export function partitionConnections(connections: ConnectionStatus[]): {
    openConnections: ConnectionStatus[];
    closedConnections: ConnectionStatus[];
} {
    return {
        openConnections: connections.filter((c) => c.isOpen),
        closedConnections: connections.filter((c) => !c.isOpen),
    };
}

/** CSS class for the connection button in the narrow sidebar */
export function getConnectionItemClass(isActive: boolean): string {
    // Active state is conveyed by the enlarged driver badge + rail indicator,
    // not by a button background
    return isActive ? 'text-accent' : 'text-secondary hover:text-primary';
}

/** CSS class for the status dot inside the connection button */
export function getStatusDotClass(isActive: boolean, hasError: boolean): string {
    if (hasError) return 'bg-accent-error';
    return isActive ? 'bg-accent-success' : 'bg-accent-success/70';
}

/**
 * Returns the IDs of open connections whose driver matches any of the given driver IDs.
 * Used when disabling or uninstalling a plugin to determine which connections must be closed.
 */
export function findConnectionsForDrivers(
    openConnectionIds: string[],
    connectionDataMap: Record<string, {driver: string} | undefined>,
    driverIds: string[],
): string[] {
    return openConnectionIds.filter((id) => {
        const driver = connectionDataMap[id]?.driver;
        return driver !== undefined && driverIds.includes(driver);
    });
}

export interface SidebarFolder<T> {
    group: ConnectionGroup;
    path: string;
    ancestorIds: string[];
    connections: T[];
}

export function groupSidebarConnections<T extends {id: string}>(
    ordered: T[],
    savedConnections: SavedConnection[],
    groups: ConnectionGroup[],
): {folders: SidebarFolder<T>[]; ungrouped: T[]} {
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const groupIdOf = new Map(savedConnections.map((c) => [c.id, c.group_id]));
    const byGroup = new Map<string, T[]>();
    const ungrouped: T[] = [];
    for (const conn of ordered) {
        const groupId = groupIdOf.get(conn.id);
        if (groupId && groupById.has(groupId)) {
            byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), conn]);
        } else {
            ungrouped.push(conn);
        }
    }

    const parentOf = (g: ConnectionGroup) =>
        g.parent_id && groupById.has(g.parent_id) ? g.parent_id : null;
    const folders: SidebarFolder<T>[] = [];
    const visit = (parentId: string | null, parentPath: string, ancestorIds: string[]) => {
        const children = groups
            .filter((g) => parentOf(g) === parentId)
            .sort((a, b) => a.sort_order - b.sort_order);
        for (const group of children) {
            const path = parentPath ? `${parentPath} / ${group.name}` : group.name;
            const connections = byGroup.get(group.id);
            if (connections) folders.push({group, path, ancestorIds, connections});
            visit(group.id, path, [...ancestorIds, group.id]);
        }
    };
    visit(null, '', []);

    // Groups in a parent cycle are unreachable from the root; keep their connections visible.
    const shown = new Set(folders.map((f) => f.group.id));
    const unreachable = groups
        .filter((g) => byGroup.has(g.id) && !shown.has(g.id))
        .sort((a, b) => a.sort_order - b.sort_order);
    for (const group of unreachable) {
        folders.push({
            group,
            path: group.name,
            ancestorIds: [],
            connections: byGroup.get(group.id)!,
        });
    }
    return {folders, ungrouped};
}
