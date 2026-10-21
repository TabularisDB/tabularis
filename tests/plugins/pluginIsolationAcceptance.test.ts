/// <reference types="node" />
/// <reference types="vitest/globals" />

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectFile = (path: string): string => readFileSync(resolve(projectRoot, path), 'utf8');

describe('plugin isolation acceptance contract', () => {
    it('sets a restrictive app CSP and a guest CSP that blocks fetch connections', () => {
        const tauri = JSON.parse(projectFile('src-tauri/tauri.conf.json')) as {
            app: {
                security: {
                    csp: Record<string, string> | null;
                    dangerousDisableAssetCspModification?: string[];
                };
            };
        };
        const csp = tauri.app.security.csp;

        expect(csp).not.toBeNull();
        expect(csp).toMatchObject({
            'default-src': "'self'",
            'script-src': "'self'",
            'worker-src': "'self' blob:",
            'connect-src':
                'ipc: http://ipc.localhost https://raw.githubusercontent.com https://oauth2.googleapis.com',
            'img-src': expect.stringContaining('https:'),
            'frame-src': 'tabularis-plugin: http://tabularis-plugin.localhost',
            'object-src': "'none'",
        });
        expect(tauri.app.security.dangerousDisableAssetCspModification).toContain('style-src');

        const protocol = projectFile('src-tauri/src/plugins/sandbox_protocol.rs');
        expect(protocol).toMatch(/sandbox allow-scripts/);
        expect(protocol).toMatch(/connect-src 'none'/);
        expect(protocol).toMatch(/frame-src 'none'/);
    });

    it('defaults connection exports to no secrets and requires confirmation', () => {
        const commands = projectFile('src-tauri/src/commands.rs');
        const connectionsPage = projectFile('src/pages/Connections.tsx');
        const start = commands.indexOf('pub async fn export_connections_payload');
        const end = commands.indexOf('\n}\n', start);
        const functionBody = commands.slice(start, end);

        expect(functionBody).toContain('include_secrets.unwrap_or(false)');
        expect(functionBody).toContain('confirmation_title.unwrap_or_else');
        expect(functionBody).toContain('blocking_show()');
        expect(functionBody).toContain('SECRET_EXPORT_CANCELLED');
        expect(functionBody).toContain('export_connections_payload_unconfirmed');
        expect(connectionsPage).toMatch(/includeSecrets:\s*mode\s*!==\s*["']noSecrets["']/);
        for (const locale of [
            'en',
            'de',
            'es',
            'fr',
            'it',
            'ja',
            'ko',
            'pt-BR',
            'ru',
            'tl',
            'zh',
        ]) {
            const translations = JSON.parse(projectFile(`src/i18n/locales/${locale}.json`)) as {
                connections: {exportSecretsConfirmation?: Record<string, string>};
            };
            expect(translations.connections.exportSecretsConfirmation).toEqual(
                expect.objectContaining({
                    title: expect.any(String),
                    message: expect.any(String),
                    export: expect.any(String),
                    cancel: expect.any(String),
                }),
            );
        }
    });

    it('limits guest RPC to documented, validated capabilities', () => {
        const host = projectFile('src/plugins/sandbox/SandboxedPluginFrame.tsx');
        const transport = projectFile('src/plugins/sandbox/connectFrame.ts');
        const guest = projectFile('packages/plugin-guest/src/runtime.ts');
        const apiTypes = projectFile('packages/plugin-api/src/types.ts');

        for (const method of [
            'api.query',
            'api.toast',
            'api.setting.set',
            'api.openUrl',
            'api.oauth.googleToken',
            'slot.onDatabaseChange',
            'slot.setExtraField',
            'slot.setCredentialFieldsHidden',
            'slot.setSecretField',
            'ui.modal',
        ]) {
            expect(host).toMatch(new RegExp(`["']${method.replaceAll('.', '\\.')}["']`));
        }
        expect(host).toContain('isReadOnlyQuery(query)');
        expect(host).toContain('execute_plugin_read_only_query');
        expect(host).toContain('setSecretField');
        expect(host).toContain('100dvh');
        expect(host).toMatch(/pluginId !== ["']google-sheets["']/);
        expect(host).toContain('https://oauth2.googleapis.com/token');
        expect(host).toContain('Unsupported Google OAuth token field');
        expect(host).toContain('serializePluginSlotContext');
        expect(host).toContain('plugins[pluginId]');
        expect(host).toContain('65_536');
        expect(host).toContain('Only HTTP and HTTPS URLs can be opened');
        expect(transport).toContain('Object.hasOwn(handlers, method)');
        expect(transport).toMatch(/throw new Error\(["']method_not_allowed["']\)/);

        const backend = projectFile('src-tauri/src/commands.rs');
        expect(backend).toContain('execute_read_only_query(&params, &query, None, 1');
        expect(backend).toContain('classify_query_kind_for_capabilities(');
        expect(projectFile('src-tauri/src/drivers/driver_trait.rs')).toContain(
            'async fn execute_read_only_query(',
        );
        expect(projectFile('src-tauri/src/drivers/sqlite/mod.rs')).toContain(
            'PRAGMA query_only = ON',
        );
        expect(projectFile('src-tauri/src/drivers/postgres/mod.rs')).toContain('BEGIN READ ONLY');
        expect(projectFile('src-tauri/src/drivers/mysql/mod.rs')).toContain(
            'START TRANSACTION READ ONLY',
        );

        for (const api of [
            'usePluginConnection',
            'usePluginQuery',
            'usePluginToast',
            'usePluginSetting',
            'usePluginTranslation',
            'usePluginModal',
            'usePluginTheme',
            'openUrl',
        ]) {
            expect(guest).toContain(api);
            expect(apiTypes).toContain(api);
        }
        expect(guest).toContain('__TABULARIS_API__');
        expect(guest).toContain('GuestModalContext');
        expect(guest).toMatch(/callHost\(["']ui\.modal["'], modal !== null\)/);
        expect(guest).toContain('applyGuestTheme');
        expect(guest).toMatch(/callHost\(["']api\.compatibility\.legacyGoogleOAuth["']\)/);
        expect(guest).toContain('exchangeGoogleOAuthToken');
        expect(guest).toContain('getHost: () => guestApi');
        expect(projectFile('src-tauri/resources/guest/__guest__.html')).toContain('__runtime__.js');
        expect(projectFile('src-tauri/resources/guest/__guest__.html')).toContain('__host.css__');
        expect(projectFile('src-tauri/src/plugins/sandbox_protocol.rs')).toContain(
            '"__runtime__.js"',
        );
        expect(projectFile('src-tauri/src/plugins/sandbox_protocol.rs')).not.toContain(
            '"runtime.js" |',
        );
        expect(guest).not.toMatch(/@tauri-apps\/api\/core/);
        expect(guest).not.toMatch(/\binvoke\s*\(/);
        expect(guest).not.toContain('__TAURI__');
        expect(guest).not.toContain('not available in sandbox API');
    });

    it('loads UI and EXPLAIN bundles in guest frames without eval', () => {
        const slots = projectFile('src/contexts/PluginSlotProvider.tsx');
        const uiFrame = projectFile('src/plugins/sandbox/SandboxedPluginFrame.tsx');
        const explain = projectFile('src/utils/pluginExplainLoader.ts');

        expect(slots).toContain('SandboxedPluginFrame');
        expect(slots).not.toMatch(/new Function\s*\(/);
        expect(uiFrame).toContain('sandbox="allow-scripts"');
        expect(explain).toMatch(/pluginFrameUrl\(pluginId, modulePath, ["']explain["']\)/);
        expect(explain).not.toMatch(/new Function\s*\(/);
        expect(explain).not.toContain('evaluateBundle');
    });

    it('documents UI and EXPLAIN plugin migration', () => {
        const uiDesign = projectFile('plugins/UI_SANDBOX_DESIGN.md');
        const explainDesign = projectFile('plugins/EXPLAIN_SANDBOX_DESIGN.md');
        const guide = projectFile('plugins/PLUGIN_GUIDE.md');
        const apiReadme = projectFile('packages/plugin-api/README.md');
        const apiVersion = projectFile('packages/plugin-api/src/version.ts');

        expect(uiDesign).toContain('setSetting` and `setSettings` now');
        expect(uiDesign).toContain('render within the plugin iframe');
        expect(explainDesign).toContain('asynchronous');
        expect(explainDesign).toContain('migration');
        expect(guide).toContain('UI_SANDBOX_DESIGN.md');
        expect(apiReadme).toContain('has no direct Tauri `invoke` access');
        expect(apiVersion).toMatch(/API_VERSION = ["']0\.4\.0["']/);
        expect(apiVersion).toMatch(/MIN_HOST_VERSION = ["']0\.4\.0["']/);
        expect(uiDesign).toContain('database-enforced read-only context');
        expect(uiDesign).toContain('Related connection-export hardening');
        expect(uiDesign).toContain('exchangeGoogleOAuthToken');
        expect(uiDesign).toContain('Google BigQuery 0.2.0');
        expect(uiDesign).toContain('full-viewport overlay');
        expect(uiDesign).toContain('navigating\nits own iframe');
    });
});
