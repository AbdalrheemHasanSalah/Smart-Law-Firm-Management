/**
 * Arabic text rules for the legal library: normalization, search terms, and the periods and
 * penalties quoted from an article. Pure functions, no database.
 *
 * normalizeArabic() must stay identical to legal_normalize() in migration 0016, which builds
 * the search index: a word normalized here has to match the same word normalized there.
 */

const LETTERS_FROM = 'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩';
const LETTERS_TO = 'اااايهوي0123456789';
const LETTER_MAP = new Map([...LETTERS_FROM].map((letter, index) => [letter, LETTERS_TO[index]]));
/** Harakat (U+064B–U+0652), the superscript alef and tatweel. */
const MARKS = /[ً-ْٰـ]/g;
/** Leading clitics, longest first; stripped only when three or more letters remain. */
const CLITICS = /^(وال|بال|كال|فال|لل|ال|و|ف|ب|ل|ك)(?=[ء-ي]{3,}$)/;
const WORD = /[ء-يa-zA-Z0-9]+/g;

/** Words too common to help a search. Compared after normalization. */
const STOPWORDS = new Set(
  [
    'من', 'في', 'على', 'الى', 'إلى', 'عن', 'مع', 'ما', 'ماذا', 'هل', 'لم', 'لن', 'لا', 'ان', 'أن', 'إن', 'او', 'أو', 'ثم',
    'هو', 'هي', 'هم', 'انا', 'نحن', 'هذا', 'هذه', 'ذلك', 'تلك', 'الذي', 'التي', 'كان', 'كانت', 'قد', 'منذ', 'بعد', 'قبل',
    'عند', 'كل', 'اي', 'أي', 'كيف', 'متى', 'لماذا', 'اين', 'أين', 'يا', 'بين', 'حتى', 'اذا', 'إذا', 'لي', 'له', 'لها',
    'عليه', 'عليها', 'فيه', 'فيها', 'به', 'بها', 'ولا', 'وما', 'او', 'غير', 'بلا', 'دون', 'شي', 'شيء', 'اريد', 'أريد',
  ].map((word) => normalizeArabic(word))
);

export const MAX_QUERY_TERMS = 12;

/** One spelling for hamza forms, taa marbuta and alef maqsura, Latin digits, no diacritics. */
export function normalizeArabic(text) {
  if (typeof text !== 'string') return '';
  let result = '';
  for (const letter of text) result += LETTER_MAP.get(letter) ?? letter;
  return result.replace(MARKS, '');
}

/** A normalized word without its leading clitics: "والايجار" → "ايجار". */
export function stripClitics(word) {
  return word.replace(CLITICS, '');
}

/** The distinct search words of a text: normalized, clitics stripped, stopwords dropped. */
export function searchWords(text) {
  const words = normalizeArabic(text).match(WORD) ?? [];
  const seen = new Set();
  for (const raw of words) {
    if (STOPWORDS.has(raw)) continue;
    const word = stripClitics(raw.toLowerCase());
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    seen.add(word);
  }
  return [...seen];
}

/**
 * A tsquery string that matches any of the words, each as a prefix ("اجر:*" also matches
 * "اجره"). Words are reduced to letters and digits above, so nothing in them is tsquery syntax.
 * Returns null when no usable word is left.
 */
export function toPrefixQuery(words) {
  const usable = words.filter((word) => /^[ء-يa-z0-9]+$/.test(word)).slice(0, MAX_QUERY_TERMS);
  if (usable.length === 0) return null;
  return usable.map((word) => `${word}:*`).join(' | ');
}

/* ───────────── periods and penalties, quoted only as the text states them ───────────── */

const NUMBER_WORDS =
  '(?:\\d+|واحد|واحدة|اثنين|اثنتين|ثلاث|ثلاثة|أربع|أربعة|خمس|خمسة|ست|ستة|سبع|سبعة|ثماني|ثمانية|ثمان|تسع|تسعة|عشر|عشرة|' +
  'خمسة عشر|عشرين|ثلاثين|أربعين|خمسين|ستين|تسعين)';
const UNITS =
  '(?:يوما|يوماً|يوم|أيام|ايام|يومين|ساعة|ساعات|ساعتين|أسبوع|أسابيع|أسبوعين|شهر|شهرا|شهراً|أشهر|شهور|شهرين|سنة|سنوات|سنتين|عام|أعوام|عامين)';
/** "ثلاثين يوماً", "30 يوماً", or a dual on its own ("شهرين"). */
const PERIOD = new RegExp(`(?:${NUMBER_WORDS}\\s+${UNITS}|(?:يومين|أسبوعين|شهرين|سنتين|عامين|ساعتين))`, 'u');
const PENALTY = /(يعاقب|يُعاقب|عقوبة|بالحبس|بالسجن|بالغرامة|بالأشغال|بالإعدام|غرامة لا تقل|غرامة لا تزيد)/u;
const SENTENCE_BREAK = /(?<=[.؛;\n])\s*/u;
const MAX_QUOTE = 400;
const MAX_QUOTES = 5;

function sentencesOf(text) {
  return String(text ?? '')
    .split(SENTENCE_BREAK)
    .map((part) => part.trim())
    .filter(Boolean);
}

const quote = (sentence) => (sentence.length > MAX_QUOTE ? `${sentence.slice(0, MAX_QUOTE - 1)}…` : sentence);
/** Tested without diacritics, quoted with them: the quote is always the article's own text. */
const states = (pattern) => (sentence) => pattern.test(sentence.replace(MARKS, ''));

/**
 * The sentences of an article that state a period, exactly as written. Nothing is computed:
 * when the text names no period, the result is empty.
 */
export function quotedPeriods(text) {
  return sentencesOf(text).filter(states(PERIOD)).slice(0, MAX_QUOTES).map(quote);
}

/** The sentences of an article that state a penalty, exactly as written. */
export function quotedPenalties(text) {
  return sentencesOf(text).filter(states(PENALTY)).slice(0, MAX_QUOTES).map(quote);
}
