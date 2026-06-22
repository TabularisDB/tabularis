// Import polyfills first to make Buffer available globally
import './polyfills';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { I18nProvider } from '@lingui/react';
import { i18n, dynamicActivate, detectLocale } from './i18n/lingui';
import { refreshFromCdn, isOtaEnabled, getOtaIntervalMinutes } from './i18n/ota';
import { DatabaseProvider } from './contexts/DatabaseProvider';
import { SettingsProvider } from './contexts/SettingsProvider';
import { SavedQueriesProvider } from './contexts/SavedQueriesProvider';
import { QueryHistoryProvider } from './contexts/QueryHistoryProvider';
import { EditorProvider } from './contexts/EditorProvider';
import { ThemeProvider } from './contexts/ThemeProvider';
import { UpdateProvider } from './contexts/UpdateProvider';

void (async () => {
  const locale = detectLocale();
  await dynamicActivate(locale);
  // Phase-2 OTA: overlay the latest CDN translations on top of the bundled
  // catalog (non-blocking — bundled text is already active), then poll. The
  // self-rescheduling tick re-reads the enabled flag + interval each time, so
  // changing them in Settings takes effect without a restart.
  if (isOtaEnabled()) void refreshFromCdn(locale);
  const scheduleOta = () => {
    setTimeout(() => {
      if (isOtaEnabled()) void refreshFromCdn(i18n.locale);
      scheduleOta();
    }, getOtaIntervalMinutes() * 60_000);
  };
  scheduleOta();
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <UpdateProvider>
        <ThemeProvider>
          <SettingsProvider>
            <DatabaseProvider>
              <SavedQueriesProvider>
                <QueryHistoryProvider>
                  <EditorProvider>
                    <I18nProvider i18n={i18n}>
                      <App />
                    </I18nProvider>
                  </EditorProvider>
                </QueryHistoryProvider>
              </SavedQueriesProvider>
            </DatabaseProvider>
          </SettingsProvider>
        </ThemeProvider>
      </UpdateProvider>
    </React.StrictMode>,
  );
})();
