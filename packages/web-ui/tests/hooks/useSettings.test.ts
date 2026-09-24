import { describe, it, expect, vi } from 'vitest';
import { useSettings } from '../../src/hooks/useSettings';
import { SettingsContext, DEFAULT_SETTINGS, type Settings } from '../../src/contexts/SettingsContext';
import { renderHook } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import type { SettingsContextType } from '../../src/contexts/SettingsContext';

describe('useSettings', () => {
  it('should throw error when used outside SettingsProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      renderHook(() => useSettings());
    }).toThrow('useSettings must be used within a SettingsProvider');
    
    consoleSpy.mockRestore();
  });

  it('should return context value when used within SettingsProvider', () => {
    const mockSettings: Settings = {
      ...DEFAULT_SETTINGS,
      resultPageSize: 100,
      language: 'it',
    };

    const mockContextValue: SettingsContextType = {
      settings: mockSettings,
      updateSetting: vi.fn(),
      isLoading: false,
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(SettingsContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.settings.resultPageSize).toBe(100);
    expect(result.current.settings.language).toBe('it');
    expect(result.current.isLoading).toBe(false);
    expect(typeof result.current.updateSetting).toBe('function');
  });

  it('should provide default settings when none specified', () => {
    const mockContextValue: SettingsContextType = {
      settings: DEFAULT_SETTINGS,
      updateSetting: vi.fn(),
      isLoading: true,
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(SettingsContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.settings.resultPageSize).toBe(500);
    expect(result.current.settings.language).toBe('auto');
    expect(result.current.settings.aiEnabled).toBe(false);
    expect(result.current.settings.aiOllamaPort).toBe(11434);
    expect(result.current.isLoading).toBe(true);
  });
});
