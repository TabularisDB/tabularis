import {useDatabase} from '@/hooks/useDatabase';
import {useDrivers} from '@/hooks/useDrivers';
import {useSettings} from '@/hooks/useSettings';
import {resolveConnectionBarColor} from '@/utils/connectionColorBar';
import {getConnectionAccent} from '@/utils/driverUI';

/**
 * Thick bar along the very bottom of the window in a brighter version of the
 * active connection's color, so connections are easy to tell apart. Opt-in via
 * the `connectionColorBar` setting.
 */
export const ConnectionColorBar = () => {
    const {settings} = useSettings();
    const {activeConnectionId, activeDriver, connections} = useDatabase();
    const {allDrivers} = useDrivers();

    if (!settings.connectionColorBar) return null;

    const connection = activeConnectionId
        ? connections.find((c) => c.id === activeConnectionId)
        : undefined;
    const accent = activeConnectionId
        ? getConnectionAccent(
              connection,
              allDrivers.find((d) => d.id === (connection?.params.driver ?? activeDriver)),
          )
        : null;

    return (
        <div
            aria-hidden="true"
            data-testid="connection-color-bar"
            className="h-2.5 shrink-0"
            style={{backgroundColor: resolveConnectionBarColor(accent)}}
        />
    );
};
