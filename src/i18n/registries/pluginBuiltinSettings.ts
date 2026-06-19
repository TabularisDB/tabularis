import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

/**
 * Keyed by `${pluginId}.${def.key}.label` and `${pluginId}.${def.key}.description`
 * to mirror the i18next key shape used at the call sites.
 */
export const pluginBuiltinSettings: Record<string, MessageDescriptor> = {
  "mysql.maxAllowedPacket.label": msg`Max Allowed Packet`,
  "mysql.maxAllowedPacket.description": msg`Maximum packet size used by the MySQL connector.`,
  "mysql.socketTimeout.label": msg`Socket Timeout`,
  "mysql.socketTimeout.description": msg`Socket timeout in milliseconds.`,
  "mysql.connectTimeout.label": msg`Connect Timeout`,
  "mysql.connectTimeout.description": msg`Connection timeout in milliseconds.`,
  "mysql.timezone.label": msg`Timezone`,
  "mysql.timezone.description": msg`Session timezone sent to MySQL after connect.`,
};
