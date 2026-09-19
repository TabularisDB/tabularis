import type { SyntheticEvent } from 'react';
import { Shield, PlugZap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SavedConnection } from '../../contexts/DatabaseContext';
import type { PluginManifest } from '../../types/plugins';
import type { ConnectionTag } from '../../types/tags';
import { usePluginRegistry } from '../../hooks/usePluginRegistry';
import { Chip } from '../ui/Chip';
import { UpdateTooltip } from '../ui/UpdateTooltip';
import { PluginUpdateIndicator } from '../plugins/PluginUpdateIndicator';
import { TagChips } from './TagChips';
import { EnvironmentBadge } from './EnvironmentBadge';

export interface ConnectionChipsProps {
  conn: SavedConnection;
  driverManifest?: PluginManifest;
  isDriverEnabled: boolean;
  tags: ConnectionTag[];
}

const stopCardEvents = {
  onClick: (event: SyntheticEvent) => event.stopPropagation(),
  onMouseDown: (event: SyntheticEvent) => event.stopPropagation(),
  onDoubleClick: (event: SyntheticEvent) => event.stopPropagation(),
  onContextMenu: (event: SyntheticEvent) => event.stopPropagation(),
};

/**
 * The attribute chips of a saved connection, in a fixed order shared by the
 * grid card and the list row: driver facts first (name, deprecation, pending
 * update), then where it lives (environment, tags), then how it is reached
 * (SSH, K8s, SSM), then anything blocking it (plugin disabled).
 */
export const ConnectionChips = ({ conn, driverManifest, isDriverEnabled, tags }: ConnectionChipsProps) => {
  const { t } = useTranslation();
  const { updates } = usePluginRegistry();
  const driverUpdate = updates.find(plugin => plugin.id === conn.params.driver);

  return (
    <>
      <Chip className="capitalize">{conn.params.driver}</Chip>
      {driverManifest?.deprecated && (
        <Chip
          tone="warning"
          title={driverManifest.deprecated.removal_date
            ? t("connections.deprecatedTooltipDate", {
                replacement: driverManifest.deprecated.replacement_id ?? "",
                date: driverManifest.deprecated.removal_date,
              })
            : t("connections.deprecatedTooltip", {
                replacement: driverManifest.deprecated.replacement_id ?? "",
              })}
        >
          {t("connections.deprecated")}
        </Chip>
      )}
      {driverUpdate && (
        <UpdateTooltip
          label={t("update.badges.driverTooltip", {
            name: driverUpdate.name,
            version: driverUpdate.latest_version,
          })}
        >
          <Link
            to="/settings?tab=plugins&filter=updates"
            aria-label={t("update.badges.driverUpdate")}
            {...stopCardEvents}
            className="inline-flex rounded-full focus-visible:outline focus-visible:outline-accent-primary"
          >
            <PluginUpdateIndicator version={driverUpdate.latest_version} />
          </Link>
        </UpdateTooltip>
      )}
      <EnvironmentBadge environment={conn.environment} />
      <TagChips tagIds={conn.tag_ids} tags={tags} />
      {conn.params.ssh_enabled && (
        <Chip tone="success" icon={<Shield size={8} />}>SSH</Chip>
      )}
      {conn.params.k8s_enabled && (
        <Chip tone="primary" icon={<Shield size={8} />}>K8s</Chip>
      )}
      {conn.params.ssm_enabled && (
        <Chip tone="neutral" icon={<Shield size={8} />}>SSM</Chip>
      )}
      {!isDriverEnabled && (
        <Chip tone="warning" icon={<PlugZap size={8} />}>{t('connections.pluginDisabled')}</Chip>
      )}
    </>
  );
};
