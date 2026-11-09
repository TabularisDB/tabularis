import {useCallback, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router-dom';
import {PLUGIN_INSTALL_DEADLINE_MS} from '@/api/pluginLifecycle';
import type {OpenedDataFile} from '@/api/contract';
import {buildEditorRoute} from '@/routing';
import type {PluginManifest} from '@/types/plugins';
import {
    classifyDataFiles,
    dataFileDialogExtensions,
    DATA_FILE_PLUGIN_ID,
    prepareDataFileSource,
    type DataFileInput,
} from '@/utils/dataFiles';
import {createQueryableObjectRequests} from '@/utils/databaseObjectActions';
import {toErrorMessage} from '@/utils/errors';
import {useDatabase} from './useDatabase';
import {useDrivers} from './useDrivers';
import {usePlatformCapabilities} from './usePlatformCapabilities';
import {useSettings} from './useSettings';
import {useTabularisClient} from './useTabularisClient';

/** How long an open may take before the dialog says it is still working. */
const OPENING_NOTICE_DELAY_MS = 400;

export type OpenDataFileStage =
    | {readonly kind: 'idle'}
    /** No registered driver opens these files: the user decides whether to install one. */
    | {readonly kind: 'plugin-required'; readonly files: readonly DataFileInput[]}
    | {readonly kind: 'installing'; readonly files: readonly DataFileInput[]}
    | {
          readonly kind: 'opening';
          readonly files: readonly DataFileInput[];
          /** Nothing is shown yet: a file that opens at once should not flash a dialog. */
          readonly quiet: boolean;
      }
    | {
          readonly kind: 'error';
          readonly files: readonly DataFileInput[];
          readonly message: string;
          /** The plugin install failed, so it can be tried again. */
          readonly retryInstall?: boolean;
      };

export interface OpenDataFile {
    readonly stage: OpenDataFileStage;
    /** Opens `files`, or lets the user pick one when omitted. */
    readonly open: (files?: readonly DataFileInput[]) => Promise<void>;
    /** Installs the suggested plugin, then opens the files that were waiting for it. */
    readonly installAndOpen: () => Promise<void>;
    /** Leaves the current prompt or error. Ignored while work is running. */
    readonly dismiss: () => void;
}

/**
 * Opens data files (CSV, Parquet, ...) as tables of the data file workspace
 * connection, on desktop (host path) and in the browser (upload). When no
 * registered driver declares the format, it stops at `plugin-required` until
 * the user accepts installing the suggested plugin.
 */
export function useOpenDataFile(): OpenDataFile {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const navigate = useNavigate();
    const {connect, loadConnections, refreshViews, switchConnection, openConnectionIds} =
        useDatabase();
    const {updateSetting} = useSettings();
    const {refresh: refreshDrivers} = useDrivers();
    const [stage, setStage] = useState<OpenDataFileStage>({kind: 'idle'});
    const busy = useRef(false);

    const openReady = useCallback(
        async (
            files: readonly DataFileInput[],
            drivers: readonly PluginManifest[],
            quiet: boolean,
        ) => {
            setStage({kind: 'opening', files, quiet});
            const reveal = setTimeout(
                () =>
                    setStage((current) =>
                        current.kind === 'opening' ? {...current, quiet: false} : current,
                    ),
                OPENING_NOTICE_DELAY_MS,
            );
            let opened: OpenedDataFile | undefined;
            let failure: {error: unknown} | undefined;
            try {
                for (const file of files) {
                    const source = await prepareDataFileSource(client, platform, file);
                    opened = await client.call('open_data_file', {
                        ...source,
                        workspaceName: t('dataFiles.workspaceName'),
                    });
                }
            } catch (error) {
                failure = {error};
            } finally {
                clearTimeout(reveal);
            }
            // Files opened before a failure are in the workspace already: show
            // them, then report the file that did not open.
            if (!opened) {
                if (failure) throw failure.error;
                return;
            }

            await loadConnections();
            if (openConnectionIds.includes(opened.connectionId)) {
                await refreshViews(opened.connectionId);
                switchConnection(opened.connectionId);
            } else {
                await connect(opened.connectionId);
            }
            const driver = drivers.find((candidate) => candidate.id === opened.driver);
            // Straight to the connection's own editor route: `/editor` redirects
            // there and remounts the editor, which drops a query already running.
            navigate(buildEditorRoute(opened.connectionId), {
                state: createQueryableObjectRequests({
                    connectionId: opened.connectionId,
                    driver: driver ?? opened.driver,
                    objectName: opened.table,
                }).open,
            });
            if (failure) throw failure.error;
        },
        [
            client,
            connect,
            loadConnections,
            navigate,
            openConnectionIds,
            platform,
            refreshViews,
            switchConnection,
            t,
        ],
    );

    /** Runs one step of the flow, turning a failure into the `error` stage. */
    const run = useCallback(
        async (files: readonly DataFileInput[], step: () => Promise<OpenDataFileStage>) => {
            if (busy.current) return;
            busy.current = true;
            try {
                setStage(await step());
            } catch (error) {
                setStage({kind: 'error', files, message: toErrorMessage(error)});
            } finally {
                busy.current = false;
            }
        },
        [],
    );

    const open = useCallback(
        async (requested?: readonly DataFileInput[]) => {
            await run(requested ?? [], async () => {
                const drivers = await client.call('get_registered_drivers', undefined);
                let files = requested;
                if (!files) {
                    const chosen = await platform.chooseInputFile({
                        title: t('dataFiles.open'),
                        filters: [
                            {
                                name: t('dataFiles.fileFilter'),
                                extensions: dataFileDialogExtensions(drivers),
                            },
                        ],
                    });
                    if (!chosen) return {kind: 'idle'};
                    files = [chosen];
                }
                const support = classifyDataFiles(files, drivers);
                if (support.unknown.length > 0) {
                    return {
                        kind: 'error',
                        files,
                        message: t('dataFiles.unsupported', {
                            files: support.unknown.map((file) => file.name).join(', '),
                        }),
                    };
                }
                if (support.needsDriver.length > 0) return {kind: 'plugin-required', files};
                await openReady(files, drivers, true);
                return {kind: 'idle'};
            });
        },
        [client, openReady, platform, run, t],
    );

    const installAndOpen = useCallback(async () => {
        const canInstall =
            stage.kind === 'plugin-required' || (stage.kind === 'error' && stage.retryInstall);
        if (!canInstall) return;
        const {files} = stage;
        await run(files, async () => {
            setStage({kind: 'installing', files});
            try {
                await client.call(
                    'install_plugin',
                    {pluginId: DATA_FILE_PLUGIN_ID},
                    {deadlineMs: PLUGIN_INSTALL_DEADLINE_MS},
                );
            } catch (error) {
                return {kind: 'error', files, message: toErrorMessage(error), retryInstall: true};
            }
            // An absent preference already enables every installed external driver.
            await updateSetting('activeExternalDrivers', (active) =>
                active == null ? active : Array.from(new Set([...active, DATA_FILE_PLUGIN_ID])),
            );
            refreshDrivers();
            const drivers = await client.call('get_registered_drivers', undefined);
            const support = classifyDataFiles(files, drivers);
            if (support.needsDriver.length > 0) {
                return {
                    kind: 'error',
                    files,
                    message: t('dataFiles.pluginCannotOpen', {
                        files: support.needsDriver.map((file) => file.name).join(', '),
                    }),
                };
            }
            await openReady(files, drivers, false);
            return {kind: 'idle'};
        });
    }, [client, openReady, refreshDrivers, run, stage, t, updateSetting]);

    const dismiss = useCallback(() => {
        if (!busy.current) setStage({kind: 'idle'});
    }, []);

    return {stage, open, installAndOpen, dismiss};
}
