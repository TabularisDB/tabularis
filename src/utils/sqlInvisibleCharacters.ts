/** Characters copied from rich text that can change SQL parsing without being visible. */
const ZERO_WIDTH_OR_DIRECTIONAL = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const TYPOGRAPHIC_QUOTES = /[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F]/g;
const WIDE_PUNCTUATION: Record<string, string> = {
  '，': ',', '；': ';', '：': ':', '（': '(', '）': ')',
  '＝': '=', '．': '.', '＋': '+', '－': '-', '＊': '*', '／': '/',
};

/** Clean pasted SQL text on explicit user request, never during typing.
 * Keep line breaks and tabs, so this does not change statement layout.
 * Text inside quoted SQL literals is also changed, which is why the operation
 * is an undoable editor action rather than an automatic rewrite.
 */
export function cleanSqlInvisibleCharacters(text: string): string {
  return text
    .replace(ZERO_WIDTH_OR_DIRECTIONAL, '')
    .replace(/[\u00A0\u202F\u3000]/g, ' ')
    .replace(TYPOGRAPHIC_QUOTES, (character) =>
      '\u2018\u2019\u201A\u201B'.includes(character) ? "'" : '"')
    .replace(/[，；：（）＝．＋－＊／]/g, (character) => WIDE_PUNCTUATION[character]);
}
