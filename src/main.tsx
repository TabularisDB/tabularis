// Import polyfills first to make Buffer available globally
import './polyfills';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import './i18n/config';
import { DatabaseProvider } from './contexts/DatabaseProvider';
import { ToastProvider } from './contexts/ToastProvider';
import { SettingsProvider } from './contexts/SettingsProvider';
import { SavedQueriesProvider } from './contexts/SavedQueriesProvider';
import { QueryHistoryProvider } from './contexts/QueryHistoryProvider';
import { EditorProvider } from './contexts/EditorProvider';
import { ThemeProvider } from './contexts/ThemeProvider';
import { UpdateProvider } from './contexts/UpdateProvider';
import { ProductionGuardProvider } from './contexts/ProductionGuardContext';
import { TabularisClient } from './api/client';
import { TauriTransport } from './api/transports/tauriTransport';
import { TabularisClientProvider } from './contexts/TabularisClientProvider';

const tabularisClient = new TabularisClient(new TauriTransport());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TabularisClientProvider client={tabularisClient}>
      <UpdateProvider>
        <ThemeProvider>
          <SettingsProvider>
            <ToastProvider>
              <DatabaseProvider>
                <SavedQueriesProvider>
                  <QueryHistoryProvider>
                    <EditorProvider>
                      <ProductionGuardProvider>
                        <App />
                      </ProductionGuardProvider>
                    </EditorProvider>
                  </QueryHistoryProvider>
                </SavedQueriesProvider>
              </DatabaseProvider>
            </ToastProvider>
          </SettingsProvider>
        </ThemeProvider>
      </UpdateProvider>
    </TabularisClientProvider>
  </React.StrictMode>,
);
