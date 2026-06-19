// Import polyfills first to make Buffer available globally
import './polyfills';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { I18nProvider } from '@lingui/react';
import { i18n, dynamicActivate, detectLocale } from './i18n/lingui';
import { DatabaseProvider } from './contexts/DatabaseProvider';
import { SettingsProvider } from './contexts/SettingsProvider';
import { SavedQueriesProvider } from './contexts/SavedQueriesProvider';
import { QueryHistoryProvider } from './contexts/QueryHistoryProvider';
import { EditorProvider } from './contexts/EditorProvider';
import { ThemeProvider } from './contexts/ThemeProvider';
import { UpdateProvider } from './contexts/UpdateProvider';

void (async () => {
  await dynamicActivate(detectLocale());
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
