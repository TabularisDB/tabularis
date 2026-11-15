import type {PluginNativeRect} from '@/types/pluginNative';

/** Intersect a guest placeholder with its viewport and scrolling ancestors. */
export function getPluginNativeBounds(element: HTMLElement): {
    rect: PluginNativeRect;
    modal: boolean;
} {
    const bounds = element.getBoundingClientRect();
    let left = Math.max(0, bounds.left);
    let top = Math.max(0, bounds.top);
    let right = Math.min(window.innerWidth, bounds.right);
    let bottom = Math.min(window.innerHeight, bounds.bottom);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX || style.overflow);
        const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow);
        const box = parent.getBoundingClientRect();
        if (clipsX) {
            left = Math.max(left, box.left + parent.clientLeft);
            right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
        }
        if (clipsY) {
            top = Math.max(top, box.top + parent.clientTop);
            bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight);
        }
    }
    const clamp = (value: number, size: number) => Math.min(size, Math.max(0, value));
    return {
        modal: !!element.closest('[data-tabularis-guest-modal]'),
        rect: {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            clip: {
                left: clamp(left - bounds.left, bounds.width),
                right: clamp(bounds.right - right, bounds.width),
                top: clamp(top - bounds.top, bounds.height),
                bottom: clamp(bounds.bottom - bottom, bounds.height),
            },
        },
    };
}
