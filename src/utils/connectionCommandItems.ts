import type { CommandConnection } from "../types/commands";
import type { PaletteItem } from "../types/palette";

interface CreateConnectionCommandItemsOptions {
  activeConnectionId: string | null;
  connections: CommandConnection[];
  group: string;
  switchConnection: (connectionId: string) => void;
}

export function createConnectionCommandItems({
  activeConnectionId,
  connections,
  group,
  switchConnection,
}: CreateConnectionCommandItemsOptions): PaletteItem[] {
  return connections
    .filter((connection) => connection.id !== activeConnectionId)
    .map((connection) => {
      const description = [
        connection.driver,
        connection.database,
        connection.host,
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        id: `connection.switch:${connection.id}`,
        title: connection.name,
        description,
        group,
        keywords: [
          "switch",
          "connection",
          connection.driver,
          connection.database,
          connection.host,
        ].filter((keyword): keyword is string => Boolean(keyword)),
        icon: "command",
        primaryAction: {
          id: "switch",
          label: connection.name,
          execute: () => switchConnection(connection.id),
        },
      };
    });
}
