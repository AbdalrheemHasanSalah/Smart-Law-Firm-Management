/**
 * Arabic text rules shared by the legal library screens and the demo backend. No imports, no
 * DOM: a React Native client reuses it as is. The same rules run on the server
 * (backend/src/services/legalText.js) and in the database (legal_normalize in migration 0018).
 */

const LETTERS_FROM = 'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩'
const LETTERS_TO = 'اااايهوي0123456789'
const LETTER_MAP = new Map([...LETTERS_FROM].map((letter, index) => [letter, LETTERS_TO[index]!]))
const MARKS = /[ً-ْٰـ]/g
const CLITICS = /^(وال|بال|كال|فال|لل|ال|و|ف|ب|ل|ك)(?=[ء-ي]{3,}$)/
const WORD = /[ء-يa-zA-Z0-9]+/g
/** Words too common to help a search, as on the server. */
const STOPWORDS = new Set(
  ['من', 'في', 'على', 'الى', 'عن', 'مع', 'ما', 'ماذا', 'هل', 'لم', 'لن', 'لا', 'ان', 'او', 'ثم', 'هو', 'هي', 'هذا', 'هذه', 'ذلك', 'الذي', 'التي', 'كان', 'قد', 'منذ', 'بعد', 'قبل', 'عند', 'كل', 'اي', 'كيف', 'متى', 'بين', 'حتى', 'اذا', 'له', 'لها', 'به', 'بها', 'دون', 'بدون', 'غير'],
)

/** One spelling for hamza forms, taa marbuta and alef maqsura, Latin digits, no diacritics. */
export const normalizeArabic = (text: string) => {
  let result = ''
  for (const letter of text) result += LETTER_MAP.get(letter) ?? letter
  return result.replace(MARKS, '')
}

/** Normalized words without leading clitics ("والإيجار" → "ايجار"), at least two letters each. */
export const searchStems = (text: string) =>
  [...new Set(
    (normalizeArabic(text).match(WORD) ?? [])
      .filter((word) => !STOPWORDS.has(word))
      .map((word) => word.toLowerCase().replace(CLITICS, ''))
      .filter((word) => word.length >= 2 && !STOPWORDS.has(word)),
  )]

/** Whether a text contains a word starting with one of the stems, ignoring spelling variants. */
export const mentionsAny = (text: string, stems: string[]) => {
  const words = searchStems(text)
  return stems.some((stem) => words.some((word) => word.startsWith(stem)))
}
