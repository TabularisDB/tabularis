import {computeDropdownPosition, type TriggerRect, type DropdownPosition} from './dropdownPosition';

/** A sandbox's visible area can be smaller than its iframe's layout viewport. */
export function pluginSelectPosition(rect: TriggerRect): DropdownPosition {
    const style = document.documentElement.style;
    const rawTop = Number.parseFloat(style.getPropertyValue('--tabularis-plugin-visible-top'));
    const rawBottom = Number.parseFloat(
        style.getPropertyValue('--tabularis-plugin-visible-bottom'),
    );
    const top = Number.isFinite(rawTop) ? Math.max(0, rawTop) : 0;
    const bottom = Number.isFinite(rawBottom)
        ? Math.min(window.innerHeight, rawBottom)
        : window.innerHeight;
    const position = computeDropdownPosition(
        {...rect, top: rect.top - top, bottom: rect.bottom - top},
        Math.max(0, bottom - top),
    );
    return {...position, top: position.top + top};
}
