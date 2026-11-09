/**
 * Bundles Monaco with the app instead of letting @monaco-editor/react fetch
 * it from the jsDelivr CDN at runtime, so the editor works offline and the
 * shipped version is the one pinned in package.json.
 *
 * Loaded through ensureMonaco only when an editor or SQL preview needs it.
 */
import * as monaco from 'monaco-editor';
import {loader} from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import {configurePluginCodeLanguage} from './utils/pluginCodeLanguage';
import {installMonacoInputAreaSelectionFix} from './utils/monacoInputArea';

self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
        if (label === 'javascript' || label === 'typescript') return new TypeScriptWorker();
        // SQL/plaintext use the base editor worker; config uses the JSON service.
        return label === 'json' ? new JsonWorker() : new EditorWorker();
    },
};

loader.config({monaco});
configurePluginCodeLanguage(monaco);

installMonacoInputAreaSelectionFix();

export {monaco};
