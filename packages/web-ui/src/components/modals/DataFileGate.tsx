import {useEffect, useRef, useState, type DragEvent as ReactDragEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {FileSpreadsheet} from 'lucide-react';
import {useDrivers} from '@/hooks/useDrivers';
import {useOpenDataFile} from '@/hooks/useOpenDataFile';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {usePluginRegistry} from '@/hooks/usePluginRegistry';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {
    DATA_FILE_PLUGIN_ID,
    dataFileFromPath,
    isFileDrag,
    OPEN_DATA_FILE_EVENT,
    type DataFileInput,
} from '@/utils/dataFiles';
import {OpenDataFileModal} from './OpenDataFileModal';

/**
 * Opens data files from anywhere in the app: listens for
 * `requestOpenDataFiles()`, for files dropped onto the browser window and, on
 * desktop, for files the system hands over ("Open with" in a file manager, a
 * path on the command line). Mounted once in the main layout, so it shows over
 * any current page.
 */
export function DataFileGate() {
    const {t} = useTranslation();
    const platform = usePlatformCapabilities();
    const {stage, open, installAndOpen, dismiss} = useOpenDataFile();
    const {allDrivers} = useDrivers();
    const {plugins} = usePluginRegistry();
    const client = useTabularisClient();
    const [dropActive, setDropActive] = useState(false);
    const isDesktop = platform.negotiation.environment === 'tauri';
    const openRef = useRef(open);
    useEffect(() => {
        openRef.current = open;
    }, [open]);

    useEffect(() => {
        if (!isDesktop) return;
        let disposed = false;
        let unlisten: (() => void) | undefined;
        const collect = () => {
            client
                .call('consume_pending_data_files', undefined)
                .then((paths) => {
                    if (disposed || paths.length === 0) return;
                    void openRef.current(paths.map(dataFileFromPath));
                })
                .catch((error: unknown) => {
                    console.warn('Failed to collect data files from the system:', error);
                });
        };
        client
            .subscribe('tabularis://open-data-files', collect)
            .then((cleanup) => {
                if (disposed) cleanup();
                else unlisten = cleanup;
            })
            .catch((error: unknown) => {
                console.warn('Failed to listen for data files from the system:', error);
            });
        // A launch that started the app delivered its files before this mounted.
        collect();
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [client, isDesktop]);
    // The desktop webview hands dropped files to the page without a path, and
    // its native handler stays off to keep in-app drags working.
    const acceptsDrops = platform.negotiation.environment === 'browser';

    useEffect(() => {
        const handler = (event: Event) => {
            const files = (event as CustomEvent<readonly DataFileInput[] | undefined>).detail;
            void open(files);
        };
        window.addEventListener(OPEN_DATA_FILE_EVENT, handler);
        return () => window.removeEventListener(OPEN_DATA_FILE_EVENT, handler);
    }, [open]);

    useEffect(() => {
        if (!acceptsDrops) return;
        const onDragOver = (event: DragEvent) => {
            if (!isFileDrag(event.dataTransfer?.types)) return;
            // Without this the browser navigates to the dropped file.
            event.preventDefault();
            setDropActive(true);
        };
        window.addEventListener('dragover', onDragOver);
        return () => window.removeEventListener('dragover', onDragOver);
    }, [acceptsDrops]);

    const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDropActive(false);
        const files = Array.from(event.dataTransfer.files, (file) => ({
            name: file.name,
            blob: file,
        }));
        if (files.length > 0) void open(files);
    };

    const pluginName =
        allDrivers.find((driver) => driver.id === DATA_FILE_PLUGIN_ID)?.name ??
        plugins.find((plugin) => plugin.id === DATA_FILE_PLUGIN_ID)?.name ??
        DATA_FILE_PLUGIN_ID;

    return (
        <>
            {dropActive && (
                <div
                    role="presentation"
                    className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setDropActive(false)}
                    onDrop={handleDrop}
                >
                    <div className="pointer-events-none flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-focus bg-elevated px-10 py-8 shadow-2xl">
                        <FileSpreadsheet size={32} className="text-accent" aria-hidden="true" />
                        <p className="text-base font-medium text-primary">
                            {t('dataFiles.dropTitle')}
                        </p>
                        <p className="text-xs text-secondary">{t('dataFiles.dropHint')}</p>
                    </div>
                </div>
            )}
            {stage.kind !== 'idle' && !(stage.kind === 'opening' && stage.quiet) && (
                <OpenDataFileModal
                    isOpen
                    onClose={dismiss}
                    stage={stage}
                    pluginName={pluginName}
                    onInstall={() => void installAndOpen()}
                />
            )}
        </>
    );
}
