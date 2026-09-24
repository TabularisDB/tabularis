import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { useEditorTheme } from '../../src/hooks/useEditorTheme';
import { ThemeContext, type ThemeContextType } from '../../src/contexts/ThemeContext';
import {
  SettingsContext,
  DEFAULT_SETTINGS,
  type SettingsContextType,
  type Settings,
} from '../../src/contexts/SettingsContext';
import type { Theme, ThemeSettings } from '../../src/types/theme';

const makeTheme = (id: string): Theme => ({
  id,
  name: id,
  isPreset: false,
  isReadOnly: false,
  colors: {} as Theme['colors'],
  typography: {} as Theme['typography'],
  layout: {} as Theme['layout'],
  monacoTheme: { base: 'vs-dark', inherit: true },
});

const uiTheme = makeTheme('ui-theme');
const dedicatedTheme = makeTheme('dedicated-editor-theme');

const themeSettings: ThemeSettings = {
  activeThemeId: 'ui-theme',
  followSystemTheme: false,
  lightThemeId: 'tabularis-light',
  darkThemeId: 'tabularis-dark',
  customThemes: [],
};

const makeThemeContext = (): ThemeContextType => ({
  currentTheme: uiTheme,
  settings: themeSettings,
  allThemes: [uiTheme, dedicatedTheme],
  isLoading: false,
  setTheme: vi.fn(),
  createCustomTheme: vi.fn(),
  updateCustomTheme: vi.fn(),
  deleteCustomTheme: vi.fn(),
  duplicateTheme: vi.fn(),
  importTheme: vi.fn(),
  exportTheme: vi.fn(),
  updateSettings: vi.fn(),
});

const makeSettingsContext = (settings: Settings): SettingsContextType => ({
  settings,
  updateSetting: vi.fn(),
  isLoading: false,
});

const renderWithProviders = (settings: Settings) => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(
      ThemeContext.Provider,
      { value: makeThemeContext() },
      React.createElement(
        SettingsContext.Provider,
        { value: makeSettingsContext(settings) },
        children,
      ),
    );

  return renderHook(() => useEditorTheme(), { wrapper });
};

describe('useEditorTheme', () => {
  it('returns the current UI theme when no editor theme override is set', () => {
    const { result } = renderWithProviders({ ...DEFAULT_SETTINGS, editorTheme: undefined });
    expect(result.current.id).toBe('ui-theme');
  });

  it('returns the dedicated editor theme when the override is set', () => {
    const { result } = renderWithProviders({
      ...DEFAULT_SETTINGS,
      editorTheme: 'dedicated-editor-theme',
    });
    expect(result.current.id).toBe('dedicated-editor-theme');
  });

  it('falls back to the current UI theme when the override points to a missing theme', () => {
    const { result } = renderWithProviders({
      ...DEFAULT_SETTINGS,
      editorTheme: 'deleted-theme',
    });
    expect(result.current.id).toBe('ui-theme');
  });

  it('throws when used outside the providers', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useEditorTheme());
    }).toThrow();

    consoleSpy.mockRestore();
  });
});
