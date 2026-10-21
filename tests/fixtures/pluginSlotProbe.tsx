import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import i18n from 'i18next';
import { invoke } from '@tauri-apps/api/core';
import { PluginSlotProvider } from '../../src/contexts/PluginSlotProvider';
import { SettingsContext, DEFAULT_SETTINGS } from '../../src/contexts/SettingsContext';
import type { SlotName } from '../../src/types/pluginSlots';

/** Load plugin manifests and render their sandboxed iframe slots. */
export async function renderWithSlotProbe(children: ReactNode, slots: SlotName[]) {
  if (!i18n.isInitialized) {
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } });
  }
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'get_plugin_manifest') {
      return {
        id: 'context-probe',
        name: 'Context probe',
        version: '1.0.0',
        ui_extensions: ['postgres', 'mysql', undefined].flatMap(driver => slots.map(slot => ({
          slot, driver, module: `${driver ?? 'unfiltered'}.js`,
        }))),
      };
    }
    if (command === 'read_plugin_file' && args && 'filePath' in args) {
      const filePath = String(args.filePath);
      if (filePath.startsWith('locales/')) return '{}';
      throw new Error(`Unexpected plugin file read: ${filePath}`);
    }
    throw new Error(`Unexpected probe command: ${command}`);
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={{
      settings: { ...DEFAULT_SETTINGS, activeExternalDrivers: ['context-probe'] },
      updateSetting: vi.fn(), isLoading: false,
    }}>
      <PluginSlotProvider>{children}</PluginSlotProvider>
    </SettingsContext.Provider>
  );
  return render(children, { wrapper });
}
