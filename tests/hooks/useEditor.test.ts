import { describe, it, expect, vi } from 'vitest';
import { useEditor } from '../../src/hooks/useEditor';
import { EditorContext, type EditorContextType } from '../../src/contexts/EditorContext';
import { renderHook } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import type { Tab } from '../../src/types/editor';

describe('useEditor', () => {
  it('should throw error when used outside EditorProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      renderHook(() => useEditor());
    }).toThrow('useEditor must be used within an EditorProvider');
    
    consoleSpy.mockRestore();
  });

  it('should return context value when used within EditorProvider', () => {
    const mockTab: Tab = {
      id: 'tab-1',
      title: 'Console 1',
      type: 'console',
      query: 'SELECT * FROM users',
      result: null,
      error: '',
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: 'conn-123',
    };

    const mockContextValue: EditorContextType = {
      tabs: [mockTab],
      activeTabId: 'tab-1',
      activeTab: mockTab,
      addTab: vi.fn(),
      openNotebook: vi.fn(),
      closeTab: vi.fn(),
      closeAllTabs: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToLeft: vi.fn(),
      closeTabsToRight: vi.fn(),
      updateTab: vi.fn(),
      setActiveTabId: vi.fn(),
      getSchema: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(EditorContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useEditor(), { wrapper });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe('tab-1');
    expect(result.current.activeTab?.title).toBe('Console 1');
    expect(result.current.activeTab?.query).toBe('SELECT * FROM users');
  });

  it('should handle empty tabs', () => {
    const mockContextValue: EditorContextType = {
      tabs: [],
      activeTabId: null,
      activeTab: null,
      addTab: vi.fn(),
      closeTab: vi.fn(),
      closeAllTabs: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToLeft: vi.fn(),
      closeTabsToRight: vi.fn(),
      updateTab: vi.fn(),
      setActiveTabId: vi.fn(),
      getSchema: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(EditorContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useEditor(), { wrapper });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.activeTab).toBeNull();
  });

  it('should provide all tab management functions', () => {
    const mockContextValue: EditorContextType = {
      tabs: [],
      activeTabId: null,
      activeTab: null,
      addTab: vi.fn(),
      closeTab: vi.fn(),
      closeAllTabs: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToLeft: vi.fn(),
      closeTabsToRight: vi.fn(),
      updateTab: vi.fn(),
      setActiveTabId: vi.fn(),
      getSchema: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(EditorContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useEditor(), { wrapper });

    expect(typeof result.current.addTab).toBe('function');
    expect(typeof result.current.closeTab).toBe('function');
    expect(typeof result.current.closeAllTabs).toBe('function');
    expect(typeof result.current.closeOtherTabs).toBe('function');
    expect(typeof result.current.closeTabsToLeft).toBe('function');
    expect(typeof result.current.closeTabsToRight).toBe('function');
    expect(typeof result.current.updateTab).toBe('function');
    expect(typeof result.current.setActiveTabId).toBe('function');
    expect(typeof result.current.getSchema).toBe('function');
  });
});
