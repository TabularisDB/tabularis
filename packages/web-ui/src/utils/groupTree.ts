import type { ConnectionGroup } from "../contexts/DatabaseContext";

export interface GroupTreeEntry {
  group: ConnectionGroup;
  depth: number;
}

/**
 * Flatten a flat list of connection groups into DFS (parent-before-children)
 * order, tagging each entry with its nesting depth. Children are sorted by
 * `sort_order`. This is the single source of truth for rendering the group
 * hierarchy anywhere a flat list of rows is needed (context menus, dropdowns).
 */
export function flattenGroupTree(groups: ConnectionGroup[]): GroupTreeEntry[] {
  const byParent = new Map<string | null, ConnectionGroup[]>();
  for (const g of groups) {
    const key = g.parent_id ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(g);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.sort_order - b.sort_order);
  }

  const result: GroupTreeEntry[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const group of byParent.get(parentId) ?? []) {
      result.push({ group, depth });
      walk(group.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}
