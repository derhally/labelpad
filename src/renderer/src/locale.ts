/**
 * UI text is written in US English. On computers set to a Commonwealth
 * English locale, spell() swaps in British spellings, so "Center" reads
 * "Centre" there. Wrap any UI string that contains one of these words.
 */
const BRITISH_LOCALES = /^en-(GB|AU|NZ|IE|ZA|IN|SG|HK|MT|CY|NG|KE|PK)\b/i;

export const usesBritishSpelling = (navigator.languages?.[0] ?? navigator.language ?? "").match(BRITISH_LOCALES) !== null;

const WORDS: [us: RegExp, gb: string][] = [
  [/\bCenter/g, "Centre"],
  [/\bcenter/g, "centre"],
  [/\bColor/g, "Colour"],
  [/\bcolor/g, "colour"],
  [/\bGray/g, "Grey"],
  [/\bgray/g, "grey"],
];

export function spell(text: string): string {
  return usesBritishSpelling ? WORDS.reduce((t, [us, gb]) => t.replace(us, gb), text) : text;
}
