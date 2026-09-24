import { describe, it, expect, vi } from 'vitest';
import { useTheme } from '../../src/hooks/useTheme';
import { ThemeContext } from '../../src/contexts/ThemeContext';
import { renderHook } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import type { Theme, ThemeSettings } from '../../src/types/theme';
import type { ThemeContextType } from '../../src/contexts/ThemeContext';

describe('useTheme', () => {
  it('should throw error when used outside ThemeProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      renderHook(() => useTheme());
    }).toThrow('useTheme must be used within a ThemeProvider');
    
    consoleSpy.mockRestore();
  });

  it('should return context value when used within ThemeProvider', () => {
    const mockTheme: Theme = {
      id: 'test-theme',
      name: 'Test Theme',
      isPreset: false,
      isReadOnly: false,
      colors: {} as Theme['colors'],
      typography: {} as Theme['typography'],
      layout: {} as Theme['layout'],
      monacoTheme: { base: 'vs-dark', inherit: true },
    };

    const mockSettings: ThemeSettings = {
      activeThemeId: 'test-theme',
      followSystemTheme: false,
      lightThemeId: 'tabularis-light',
      darkThemeId: 'tabularis-dark',
      customThemes: [],
    };

    const mockContextValue: ThemeContextType = {
      currentTheme: mockTheme,
      settings: mockSettings,
      allThemes: [],
      isLoading: false,
      setTheme: vi.fn(),
      createCustomTheme: vi.fn(),
      updateCustomTheme: vi.fn(),
      deleteCustomTheme: vi.fn(),
      duplicateTheme: vi.fn(),
      importTheme: vi.fn(),
      exportTheme: vi.fn(),
      updateSettings: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(ThemeContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.currentTheme.id).toBe('test-theme');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.settings.activeThemeId).toBe('test-theme');
  });
});
