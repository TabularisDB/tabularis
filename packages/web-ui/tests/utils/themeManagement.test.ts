import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_THEME_SETTINGS,
  OLD_THEME_SETTINGS_KEY,
  generateCustomThemeId,
  createCustomTheme,
  duplicateTheme,
  updateTheme,
  importTheme,
  exportTheme,
  migrateThemeFromLocalStorage,
  detectSystemTheme,
  getDefaultThemeIdForSystem,
  findThemeById,
  filterPresetThemes,
  filterCustomThemes,
  addCustomTheme,
  removeCustomTheme,
  updateCustomThemeInList,
  canDeleteTheme,
  canEditTheme,
  isActiveTheme,
  getSystemThemeId,
  type ThemeMigrationResult,
} from '../../src/utils/themeManagement';
import type { Theme, ThemeSettings } from '../../src/types/theme';

describe('themeManagement', () => {
  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };

  const matchMediaMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', localStorageMock);
    // Default to light mode for tests
    matchMediaMock.mockReturnValue({ matches: false });
    vi.stubGlobal('matchMedia', matchMediaMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const createMockTheme = (overrides: Partial<Theme> = {}): Theme => ({
    id: 'test-theme',
    name: 'Test Theme',
    isPreset: false,
    isReadOnly: false,
    colors: {
      bg: { base: '#000', elevated: '#111', overlay: '#222', input: '#333', tooltip: '#444' },
      surface: { primary: '#555', secondary: '#666', tertiary: '#777', hover: '#888', active: '#999', disabled: '#aaa' },
      text: { primary: '#bbb', secondary: '#ccc', muted: '#ddd', disabled: '#eee', accent: '#fff', inverse: '#000' },
      accent: { primary: '#111', secondary: '#222', success: '#333', warning: '#444', error: '#555', info: '#666' },
      border: { subtle: '#777', default: '#888', strong: '#999', focus: '#aaa' },
      semantic: { string: '#bbb', number: '#ccc', boolean: '#ddd', date: '#eee', null: '#fff', primaryKey: '#111', foreignKey: '#222', index: '#333', connectionActive: '#444', connectionInactive: '#555', modified: '#666', deleted: '#777', new: '#888' },
    },
    typography: {
      fontFamily: { base: 'system-ui', mono: 'monospace' },
      fontSize: { xs: '10px', sm: '12px', base: '14px', lg: '16px', xl: '18px' },
    },
    layout: {
      borderRadius: { sm: '2px', base: '4px', lg: '8px', xl: '12px' },
      spacing: { xs: '2px', sm: '4px', base: '8px', lg: '12px', xl: '16px' },
    },
    monacoTheme: { base: 'vs-dark', inherit: true },
    ...overrides,
  });

  describe('DEFAULT_THEME_SETTINGS', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_THEME_SETTINGS.activeThemeId).toBe('tabularis-dark');
      expect(DEFAULT_THEME_SETTINGS.followSystemTheme).toBe(false);
      expect(DEFAULT_THEME_SETTINGS.lightThemeId).toBe('tabularis-light');
      expect(DEFAULT_THEME_SETTINGS.darkThemeId).toBe('tabularis-dark');
      expect(DEFAULT_THEME_SETTINGS.customThemes).toEqual([]);
    });
  });

  describe('generateCustomThemeId', () => {
    it('should generate id with custom- prefix and timestamp', () => {
      const id = generateCustomThemeId();
      expect(id).toMatch(/^custom-\d+-\d+$/);
    });

    it('should generate unique ids', () => {
      const id1 = generateCustomThemeId();
      const id2 = generateCustomThemeId();
      expect(id1).not.toBe(id2);
    });

    it('should use timestamp in id', () => {
      const before = Date.now();
      const id = generateCustomThemeId();
      const after = Date.now();
      const timestamp = parseInt(id.replace('custom-', ''));
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('createCustomTheme', () => {
    it('should create custom theme from base theme', () => {
      const baseTheme = createMockTheme({ id: 'base', name: 'Base Theme', isPreset: true });
      const custom = createCustomTheme(baseTheme, 'My Custom Theme');
      
      expect(custom.name).toBe('My Custom Theme');
      expect(custom.isPreset).toBe(false);
      expect(custom.isReadOnly).toBe(false);
      expect(custom.id).toMatch(/^custom-/);
      expect(custom.createdAt).toBeDefined();
      expect(custom.updatedAt).toBeDefined();
    });

    it('should preserve colors from base theme', () => {
      const baseTheme = createMockTheme({ colors: { ...createMockTheme().colors, bg: { ...createMockTheme().colors.bg, base: '#custom' } } });
      const custom = createCustomTheme(baseTheme, 'Custom');
      
      expect(custom.colors.bg.base).toBe('#custom');
    });

    it('should use provided id if given', () => {
      const baseTheme = createMockTheme();
      const custom = createCustomTheme(baseTheme, 'Custom', 'my-specific-id');
      
      expect(custom.id).toBe('my-specific-id');
    });
  });

  describe('duplicateTheme', () => {
    it('should create duplicate of theme with new name', () => {
      const theme = createMockTheme({ id: 'original', name: 'Original' });
      const duplicate = duplicateTheme(theme, 'Copy of Original');
      
      expect(duplicate.name).toBe('Copy of Original');
      expect(duplicate.id).not.toBe('original');
      expect(duplicate.isPreset).toBe(false);
    });

    it('should preserve all theme properties except id and name', () => {
      const theme = createMockTheme({
        colors: { ...createMockTheme().colors, bg: { ...createMockTheme().colors.bg, base: '#unique' } },
      });
      const duplicate = duplicateTheme(theme, 'Copy');
      
      expect(duplicate.colors.bg.base).toBe('#unique');
      expect(duplicate.typography).toEqual(theme.typography);
      expect(duplicate.layout).toEqual(theme.layout);
    });
  });

  describe('updateTheme', () => {
    it('should update theme properties', () => {
      const theme = createMockTheme({ name: 'Old Name' });
      const updated = updateTheme(theme, { name: 'New Name' });
      
      expect(updated.name).toBe('New Name');
    });

    it('should throw when trying to update preset theme', () => {
      const presetTheme = createMockTheme({ isPreset: true });
      
      expect(() => updateTheme(presetTheme, { name: 'New Name' })).toThrow(
        'Cannot modify preset themes'
      );
    });

    it('should update updatedAt timestamp', () => {
      const theme = createMockTheme({ updatedAt: '2023-01-01' });
      const before = Date.now();
      const updated = updateTheme(theme, { name: 'New' });
      const after = Date.now();
      const updatedTime = new Date(updated.updatedAt!).getTime();
      
      expect(updatedTime).toBeGreaterThanOrEqual(before);
      expect(updatedTime).toBeLessThanOrEqual(after);
    });
  });

  describe('importTheme', () => {
    it('should parse and import theme JSON', () => {
      const theme = createMockTheme({ id: 'imported', name: 'Imported Theme' });
      const json = JSON.stringify(theme);
      const imported = importTheme(json);
      
      expect(imported.name).toBe('Imported Theme');
      expect(imported.isPreset).toBe(false);
      expect(imported.id).toMatch(/^custom-/);
    });

    it('should use provided id if given', () => {
      const theme = createMockTheme();
      const json = JSON.stringify(theme);
      const imported = importTheme(json, 'specific-id');
      
      expect(imported.id).toBe('specific-id');
    });

    it('should set createdAt and updatedAt to now', () => {
      const theme = createMockTheme({ createdAt: '2023-01-01', updatedAt: '2023-01-01' });
      const json = JSON.stringify(theme);
      const imported = importTheme(json);
      
      expect(imported.createdAt).not.toBe('2023-01-01');
      expect(imported.updatedAt).not.toBe('2023-01-01');
    });
  });

  describe('exportTheme', () => {
    it('should export theme as formatted JSON', () => {
      const theme = createMockTheme({ name: 'Export Test' });
      const exported = exportTheme(theme);
      
      const parsed = JSON.parse(exported);
      expect(parsed.name).toBe('Export Test');
    });

    it('should export with 2-space indentation', () => {
      const theme = createMockTheme();
      const exported = exportTheme(theme);
      
      expect(exported).toContain('\n  "');
    });
  });

  describe('migrateThemeFromLocalStorage', () => {
    it('should not migrate when backend has theme', () => {
      const result: ThemeMigrationResult = migrateThemeFromLocalStorage('tabularis-dark');
      
      expect(result.migrated).toBe(false);
      expect(result.themeId).toBe('tabularis-dark');
    });

    it('should migrate from localStorage when backend is empty', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify({ activeThemeId: 'monokai' }));
      
      const result = migrateThemeFromLocalStorage(undefined);
      
      expect(result.migrated).toBe(true);
      expect(result.themeId).toBe('monokai');
    });

    it('should return null when no localStorage data', () => {
      localStorageMock.getItem.mockReturnValue(null);
      
      const result = migrateThemeFromLocalStorage(undefined);
      
      expect(result.migrated).toBe(false);
      expect(result.themeId).toBeNull();
    });

    it('should handle parse errors', () => {
      localStorageMock.getItem.mockReturnValue('invalid');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = migrateThemeFromLocalStorage(undefined);
      
      expect(result.migrated).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('detectSystemTheme', () => {
    it('should return dark when system prefers dark', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockReturnValue({ matches: true }),
      });
      
      const result = detectSystemTheme();
      
      expect(result).toBe('dark');
    });

    it('should return light when system prefers light', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
      });
      
      const result = detectSystemTheme();
      
      expect(result).toBe('light');
    });

    it('should default to dark on server', () => {
      vi.stubGlobal('window', undefined);
      
      const result = detectSystemTheme();
      
      expect(result).toBe('dark');
    });
  });

  describe('getDefaultThemeIdForSystem', () => {
    it('should return tabularis-dark for dark mode', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockReturnValue({ matches: true }),
      });
      
      const result = getDefaultThemeIdForSystem();
      
      expect(result).toBe('tabularis-dark');
    });

    it('should return tabularis-light for light mode', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
      });
      
      const result = getDefaultThemeIdForSystem();
      
      expect(result).toBe('tabularis-light');
    });
  });

  describe('findThemeById', () => {
    const presets: Theme[] = [
      createMockTheme({ id: 'preset-1', name: 'Preset 1', isPreset: true }),
      createMockTheme({ id: 'preset-2', name: 'Preset 2', isPreset: true }),
    ];
    const customs: Theme[] = [
      createMockTheme({ id: 'custom-1', name: 'Custom 1' }),
      createMockTheme({ id: 'custom-2', name: 'Custom 2' }),
    ];

    it('should find theme in presets', () => {
      const result = findThemeById('preset-1', presets, customs);
      
      expect(result?.name).toBe('Preset 1');
    });

    it('should find theme in custom themes', () => {
      const result = findThemeById('custom-1', presets, customs);
      
      expect(result?.name).toBe('Custom 1');
    });

    it('should return undefined when theme not found', () => {
      const result = findThemeById('non-existent', presets, customs);
      
      expect(result).toBeUndefined();
    });
  });

  describe('filterPresetThemes', () => {
    it('should return only preset themes', () => {
      const themes: Theme[] = [
        createMockTheme({ id: '1', isPreset: true }),
        createMockTheme({ id: '2', isPreset: false }),
        createMockTheme({ id: '3', isPreset: true }),
      ];
      
      const result = filterPresetThemes(themes);
      
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(['1', '3']);
    });
  });

  describe('filterCustomThemes', () => {
    it('should return only custom themes', () => {
      const themes: Theme[] = [
        createMockTheme({ id: '1', isPreset: true }),
        createMockTheme({ id: '2', isPreset: false }),
        createMockTheme({ id: '3', isPreset: false }),
      ];
      
      const result = filterCustomThemes(themes);
      
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(['2', '3']);
    });
  });

  describe('addCustomTheme', () => {
    it('should add theme to list', () => {
      const existing: Theme[] = [createMockTheme({ id: '1' })];
      const newTheme = createMockTheme({ id: '2' });
      
      const result = addCustomTheme(existing, newTheme);
      
      expect(result).toHaveLength(2);
      expect(result[1].id).toBe('2');
    });
  });

  describe('removeCustomTheme', () => {
    it('should remove theme by id', () => {
      const themes: Theme[] = [
        createMockTheme({ id: '1' }),
        createMockTheme({ id: '2' }),
        createMockTheme({ id: '3' }),
      ];
      
      const result = removeCustomTheme(themes, '2');
      
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(['1', '3']);
    });
  });

  describe('updateCustomThemeInList', () => {
    it('should update theme in list', () => {
      const themes: Theme[] = [
        createMockTheme({ id: '1', name: 'Old' }),
        createMockTheme({ id: '2', name: 'Two' }),
      ];
      const updated = createMockTheme({ id: '1', name: 'New' });
      
      const result = updateCustomThemeInList(themes, updated);
      
      expect(result[0].name).toBe('New');
      expect(result[1].name).toBe('Two');
    });
  });

  describe('canDeleteTheme', () => {
    it('should return true for custom themes', () => {
      const theme = createMockTheme({ isPreset: false });
      expect(canDeleteTheme(theme)).toBe(true);
    });

    it('should return false for preset themes', () => {
      const theme = createMockTheme({ isPreset: true });
      expect(canDeleteTheme(theme)).toBe(false);
    });
  });

  describe('canEditTheme', () => {
    it('should return true for custom themes', () => {
      const theme = createMockTheme({ isPreset: false });
      expect(canEditTheme(theme)).toBe(true);
    });

    it('should return false for preset themes', () => {
      const theme = createMockTheme({ isPreset: true });
      expect(canEditTheme(theme)).toBe(false);
    });
  });

  describe('isActiveTheme', () => {
    it('should return true when theme is active', () => {
      expect(isActiveTheme('tabularis-dark', 'tabularis-dark')).toBe(true);
    });

    it('should return false when theme is not active', () => {
      expect(isActiveTheme('tabularis-dark', 'tabularis-light')).toBe(false);
    });
  });

  describe('getSystemThemeId', () => {
    it('should return dark theme id for dark mode', () => {
      const settings: ThemeSettings = {
        ...DEFAULT_THEME_SETTINGS,
        darkThemeId: 'dark-custom',
        lightThemeId: 'light-custom',
      };
      
      const result = getSystemThemeId(true, settings);
      
      expect(result).toBe('dark-custom');
    });

    it('should return light theme id for light mode', () => {
      const settings: ThemeSettings = {
        ...DEFAULT_THEME_SETTINGS,
        darkThemeId: 'dark-custom',
        lightThemeId: 'light-custom',
      };
      
      const result = getSystemThemeId(false, settings);
      
      expect(result).toBe('light-custom');
    });
  });
});
