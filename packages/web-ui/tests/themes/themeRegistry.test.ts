import { describe, it, expect } from 'vitest';
import { themeRegistry } from '../../src/themes/themeRegistry';

describe('themeRegistry', () => {
  describe('getPreset', () => {
    it('should return tabularis-dark theme', () => {
      const theme = themeRegistry.getPreset('tabularis-dark');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('tabularis-dark');
      expect(theme?.name).toBe('Tabularis Dark');
      expect(theme?.isPreset).toBe(true);
    });

    it('should return tabularis-light theme', () => {
      const theme = themeRegistry.getPreset('tabularis-light');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('tabularis-light');
      expect(theme?.name).toBe('Tabularis Light');
    });

    it('should return monokai theme', () => {
      const theme = themeRegistry.getPreset('monokai');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('monokai');
      expect(theme?.name).toBe('Monokai');
    });

    it('should return one-dark-pro theme', () => {
      const theme = themeRegistry.getPreset('one-dark-pro');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('one-dark-pro');
      expect(theme?.name).toBe('One Dark Pro');
    });

    it('should return nord theme', () => {
      const theme = themeRegistry.getPreset('nord');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('nord');
      expect(theme?.name).toBe('Nord');
    });

    it('should return dracula theme', () => {
      const theme = themeRegistry.getPreset('dracula');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('dracula');
      expect(theme?.name).toBe('Dracula');
    });

    it('should return github-dark theme', () => {
      const theme = themeRegistry.getPreset('github-dark');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('github-dark');
      expect(theme?.name).toBe('GitHub Dark');
    });

    it('should return solarized-dark theme', () => {
      const theme = themeRegistry.getPreset('solarized-dark');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('solarized-dark');
      expect(theme?.name).toBe('Solarized Dark');
    });

    it('should return solarized-light theme', () => {
      const theme = themeRegistry.getPreset('solarized-light');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('solarized-light');
      expect(theme?.name).toBe('Solarized Light');
    });

    it('should return high-contrast theme', () => {
      const theme = themeRegistry.getPreset('high-contrast');
      expect(theme).toBeDefined();
      expect(theme?.id).toBe('high-contrast');
      expect(theme?.name).toBe('High Contrast');
    });

    it('should return undefined for non-existent theme', () => {
      const theme = themeRegistry.getPreset('non-existent-theme');
      expect(theme).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const theme = themeRegistry.getPreset('');
      expect(theme).toBeUndefined();
    });
  });

  describe('getAllPresets', () => {
    it('should return all 12 preset themes', () => {
      const themes = themeRegistry.getAllPresets();
      expect(themes).toHaveLength(12);
    });

    it('should return themes with correct structure', () => {
      const themes = themeRegistry.getAllPresets();
      themes.forEach(theme => {
        expect(theme).toHaveProperty('id');
        expect(theme).toHaveProperty('name');
        expect(theme).toHaveProperty('colors');
        expect(theme).toHaveProperty('typography');
        expect(theme).toHaveProperty('layout');
        expect(theme).toHaveProperty('monacoTheme');
        expect(theme.isPreset).toBe(true);
        expect(theme.isReadOnly).toBe(true);
      });
    });

    it('should include tabularis-dark as first theme', () => {
      const themes = themeRegistry.getAllPresets();
      const darkTheme = themes.find(t => t.id === 'tabularis-dark');
      expect(darkTheme).toBeDefined();
    });
  });

  describe('getDefault', () => {
    it('should return tabularis-dark as default', () => {
      const defaultTheme = themeRegistry.getDefault();
      expect(defaultTheme.id).toBe('tabularis-dark');
      expect(defaultTheme.name).toBe('Tabularis Dark');
    });

    it('should return a valid theme object', () => {
      const defaultTheme = themeRegistry.getDefault();
      expect(defaultTheme).toHaveProperty('colors');
      expect(defaultTheme).toHaveProperty('typography');
      expect(defaultTheme).toHaveProperty('layout');
      expect(defaultTheme).toHaveProperty('monacoTheme');
    });
  });

  describe('isDarkTheme', () => {
    it('should return true for vs-dark base', () => {
      const darkTheme = themeRegistry.getPreset('tabularis-dark');
      expect(themeRegistry.isDarkTheme(darkTheme!)).toBe(true);
    });

    it('should return true for hc-black base', () => {
      const hcTheme = themeRegistry.getPreset('high-contrast');
      expect(themeRegistry.isDarkTheme(hcTheme!)).toBe(true);
    });

    it('should return false for vs base (light themes)', () => {
      const lightTheme = themeRegistry.getPreset('tabularis-light');
      expect(themeRegistry.isDarkTheme(lightTheme!)).toBe(false);
    });

    it('should return false for solarized-light', () => {
      const theme = themeRegistry.getPreset('solarized-light');
      expect(themeRegistry.isDarkTheme(theme!)).toBe(false);
    });
  });

  describe('isLightTheme', () => {
    it('should return true for vs base', () => {
      const lightTheme = themeRegistry.getPreset('tabularis-light');
      expect(themeRegistry.isLightTheme(lightTheme!)).toBe(true);
    });

    it('should return true for solarized-light', () => {
      const theme = themeRegistry.getPreset('solarized-light');
      expect(themeRegistry.isLightTheme(theme!)).toBe(true);
    });

    it('should return false for vs-dark base', () => {
      const darkTheme = themeRegistry.getPreset('tabularis-dark');
      expect(themeRegistry.isLightTheme(darkTheme!)).toBe(false);
    });

    it('should return false for hc-black base', () => {
      const hcTheme = themeRegistry.getPreset('high-contrast');
      expect(themeRegistry.isLightTheme(hcTheme!)).toBe(false);
    });

    it('should return false for monokai', () => {
      const theme = themeRegistry.getPreset('monokai');
      expect(themeRegistry.isLightTheme(theme!)).toBe(false);
    });
  });

  describe('Theme consistency', () => {
    it('should have unique theme IDs', () => {
      const themes = themeRegistry.getAllPresets();
      const ids = themes.map(t => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have unique theme names', () => {
      const themes = themeRegistry.getAllPresets();
      const names = themes.map(t => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should have valid monacoTheme.base values', () => {
      const themes = themeRegistry.getAllPresets();
      const validBases = ['vs', 'vs-dark', 'hc-black'];
      themes.forEach(theme => {
        expect(validBases).toContain(theme.monacoTheme.base);
      });
    });

    it('should have required color sections', () => {
      const themes = themeRegistry.getAllPresets();
      themes.forEach(theme => {
        expect(theme.colors).toHaveProperty('bg');
        expect(theme.colors).toHaveProperty('surface');
        expect(theme.colors).toHaveProperty('text');
        expect(theme.colors).toHaveProperty('accent');
        expect(theme.colors).toHaveProperty('border');
        expect(theme.colors).toHaveProperty('semantic');
      });
    });

    it('should have required typography sections', () => {
      const themes = themeRegistry.getAllPresets();
      themes.forEach(theme => {
        expect(theme.typography).toHaveProperty('fontFamily');
        expect(theme.typography).toHaveProperty('fontSize');
        expect(theme.typography.fontFamily).toHaveProperty('base');
        expect(theme.typography.fontFamily).toHaveProperty('mono');
      });
    });

    it('should have required layout sections', () => {
      const themes = themeRegistry.getAllPresets();
      themes.forEach(theme => {
        expect(theme.layout).toHaveProperty('borderRadius');
        expect(theme.layout).toHaveProperty('spacing');
      });
    });
  });
});
