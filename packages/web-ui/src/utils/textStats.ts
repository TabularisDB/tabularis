export interface TextStats {
    /** Unicode code points (not UTF-16 code units, not grapheme clusters). */
    characters: number;
    /** Logical lines; empty text has none. */
    lines: number;
    /** Size of the text when encoded as UTF-8. */
    bytes: number;
}

/**
 * Measures `text` in a single pass without allocating an encoded copy, so it
 * stays cheap for large values.
 *
 * - `\r\n`, `\n` and a lone `\r` each count as one line separator, and a
 *   nonempty text ending in a separator has a trailing empty line.
 * - A lone surrogate counts as one character and 3 bytes, which matches what
 *   `TextEncoder` produces (U+FFFD).
 */
export function computeTextStats(text: string): TextStats {
    if (text.length === 0) return {characters: 0, lines: 0, bytes: 0};

    let characters = 0;
    let bytes = 0;
    let lines = 1;

    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i);
        characters++;

        if (unit < 0x80) {
            bytes += 1;
            if (unit === 0x0a) {
                lines++;
            } else if (unit === 0x0d) {
                if (text.charCodeAt(i + 1) === 0x0a) {
                    i++;
                    bytes += 1;
                    characters++;
                }
                lines++;
            }
        } else if (unit < 0x800) {
            bytes += 2;
        } else if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                i++;
                bytes += 4;
            } else {
                bytes += 3;
            }
        } else {
            bytes += 3;
        }
    }

    return {characters, lines, bytes};
}
