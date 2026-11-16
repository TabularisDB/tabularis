import type {CSSProperties} from 'react';
import {useTheme} from './useTheme';
import {buildCategoricalSeries, radiusToPixels} from '@/utils/chartPalette';

export interface ChartPalette {
    /** Series colors, cycled in order (notebook charts). */
    series: string[];
    /** De-duplicated, colour-blind-checked series order (result charts). */
    categorical: string[];
    grid: string;
    tick: string;
    /** Axis rule, one step stronger than the grid. */
    axis: string;
    /** Chart background, used for the ring around line markers. */
    surface: string;
    /** Hover band behind a bar category. */
    cursor: string;
    tooltipBackground: string;
    tooltipBorder: string;
    tooltipText: string;
    radius: string;
    /** Rounded data-end of bars, following the theme's small radius (0 on square themes). */
    barRadius: number;
}

/** Chart colors follow the active theme so every palette keeps its own accents. */
export function useChartPalette(): ChartPalette {
    const {currentTheme} = useTheme();
    const {colors} = currentTheme;
    const {accent, semantic, bg, border, text, surface} = colors;
    return {
        series: [
            accent.primary,
            accent.success,
            accent.warning,
            accent.error,
            accent.secondary,
            semantic.boolean,
            accent.info,
            semantic.string,
        ],
        categorical: buildCategoricalSeries(colors),
        grid: border.subtle,
        tick: text.muted,
        axis: border.default,
        surface: bg.base,
        cursor: surface.hover,
        tooltipBackground: bg.tooltip,
        tooltipBorder: border.default,
        tooltipText: text.primary,
        radius: currentTheme.layout.borderRadius.base,
        barRadius: radiusToPixels(currentTheme.layout.borderRadius.sm),
    };
}

export function chartTooltipStyle(palette: ChartPalette): CSSProperties {
    return {
        backgroundColor: palette.tooltipBackground,
        border: `1px solid ${palette.tooltipBorder}`,
        borderRadius: palette.radius,
        color: palette.tooltipText,
        fontSize: 11,
    };
}
