// JSON can carry lone UTF-16 surrogates, but UTF-8 silently replaces them with U+FFFD.
const unpaired = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const wellFormedUnicode = (text: string): boolean => !unpaired.test(text);
/** Preserve invalid code units visibly rather than lose them during UTF-8 encoding. */
export function escapeInvalidUnicode(text: string): string {
  return text.replace(new RegExp(unpaired.source, "g"), char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
