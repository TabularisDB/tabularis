/**
 * Opens the browser's own picker (calendar, clock) for a date-like input.
 *
 * `showPicker()` is missing on older engines and throws when the input is
 * disabled, read-only or the call is not user initiated. The field can still be
 * typed into in all of those cases, so a failure is not an error worth showing.
 */
export function openNativePicker(input: HTMLInputElement): void {
    if (typeof input.showPicker !== 'function') return;
    try {
        input.showPicker();
    } catch {
        // Typing into the field still works without the picker.
    }
}
