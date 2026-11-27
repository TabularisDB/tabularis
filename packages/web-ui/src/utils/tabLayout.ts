export type TabLayout = 'horizontal' | 'vertical';

export const DEFAULT_TAB_LAYOUT: TabLayout = 'horizontal';

/** Normalizes a stored `tabLayout` setting, falling back to horizontal for anything unknown. */
export function resolveTabLayout(value: unknown): TabLayout {
    return value === 'vertical' ? 'vertical' : DEFAULT_TAB_LAYOUT;
}
