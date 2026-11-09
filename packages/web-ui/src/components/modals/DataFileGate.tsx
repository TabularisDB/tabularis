import {useEffect, useState, type DragEvent as ReactDragEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {FileSpreadsheet} from 'lucide-react';
import {useDrivers} from '@/hooks/useDrivers';
import {useOpenDataFile} from '@/hooks/useOpenDataFile';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {usePluginRegistry} from '@/hooks/usePluginRegistry';
import {
    DATA_FILE_PLUGIN_ID,
    isFileDrag,
    OPEN_DATA_FILE_EVENT,
    type DataFileInput,
} from '@/utils/dataFiles';
import {OpenDataFileModal} from './OpenDataFileModal';

/**
 * Opens data files from anywhere in the app: listens for
 * `requestOpenDataFiles()` and, in the browser, for files dropped onto the
 * window. Mounted once in the main layout, so it shows over any current page.
 */
export function DataFileGate() {
    const {t} = useTranslation();
    const platform = usePlatformCapabilities();
    const {stage, open, installAndOpen, dismiss} = useOpenDataFile();
    const {allDrivers} = useDrivers();
    const {plugins} = usePluginRegistry();
    const [dropActive, setDropActive] = useState(false);
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
