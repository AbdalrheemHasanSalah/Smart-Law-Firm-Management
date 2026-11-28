/**
 * Tafqeet (تفقيط): an amount written out in Arabic words, as it appears on contracts, receipts
 * and statements: "فقط ألف وخمسمائة دينار لا غير".
 *
 * The counted noun follows the number as Arabic grammar requires:
 *   1 → دينار واحد · 2 → ديناران · 3–10 → ثلاثة دنانير · 11–99 → أحد عشر ديناراً
 *   100, 1000… (and any number whose last two digits are 00, 01 or 02) → مائة دينار
 * Numbers counting a masculine noun take the opposite gender form for 3–10 (ثلاثة دنانير), and
 * a feminine noun such as أغورة takes the masculine form (ثلاث أغورات). Pure functions, no imports,
 * so a React Native client reuses it and the tests run on plain Node.
 */

export type Gender = 'masculine' | 'feminine'

/** The four forms a counted noun takes: one, two, 3–10, and 11–99 (accusative). */
type NounForms = { one: string; two: string; few: string; many: string; gender: Gender }

type CurrencyWords = { unit: NounForms; sub: NounForms; subPerUnit: number }

export const CURRENCY_WORDS: Record<'ILS' | 'JOD' | 'USD', CurrencyWords> = {
  ILS: {
    unit: { one: 'شيكل', two: 'شيكلان', few: 'شواكل', many: 'شيكلاً', gender: 'masculine' },
    sub: { one: 'أغورة', two: 'أغورتان', few: 'أغورات', many: 'أغورة', gender: 'feminine' },
    subPerUnit: 100,
  },
  JOD: {
    unit: { one: 'دينار', two: 'ديناران', few: 'دنانير', many: 'ديناراً', gender: 'masculine' },
    sub: { one: 'فلس', two: 'فلسان', few: 'فلوس', many: 'فلساً', gender: 'masculine' },
    subPerUnit: 1000,
  },
  USD: {
    unit: { one: 'دولار', two: 'دولاران', few: 'دولارات', many: 'دولاراً', gender: 'masculine' },
    sub: { one: 'سنت', two: 'سنتان', few: 'سنتات', many: 'سنتاً', gender: 'masculine' },
    subPerUnit: 100,
  },
}

/* For a masculine counted noun the units 3–9 are written with ة; for a feminine one, without. */
const UNITS_FOR_MASCULINE = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة']
const UNITS_FOR_FEMININE = ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع']
const TENS = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

/** 1–99 counting a noun of the given gender. */
function belowHundred(value: number, gender: Gender): string {
  const units = gender === 'masculine' ? UNITS_FOR_MASCULINE : UNITS_FOR_FEMININE
  if (value < 10) return units[value]!
  if (value === 10) return gender === 'masculine' ? 'عشرة' : 'عشر'
  if (value < 20) {
    const ten = gender === 'masculine' ? 'عشر' : 'عشرة'
    if (value === 11) return `${gender === 'masculine' ? 'أحد' : 'إحدى'} ${ten}`
    if (value === 12) return `${gender === 'masculine' ? 'اثنا' : 'اثنتا'} ${ten}`
    return `${units[value - 10]} ${ten}`
  }
  const unit = value % 10
  const tens = TENS[Math.floor(value / 10)]!
  if (unit === 0) return tens
  const first = unit === 1 ? (gender === 'masculine' ? 'واحد' : 'إحدى') : units[unit]!
  return `${first} و${tens}`
}

/** 1–999. `construct` writes مئتان as مئتا before a scale noun (مئتا ألف). */
function belowThousand(value: number, gender: Gender, construct = false): string {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  const parts: string[] = []
  if (hundreds) parts.push(hundreds === 2 && rest === 0 && construct ? 'مئتا' : HUNDREDS[hundreds]!)
  if (rest) parts.push(belowHundred(rest, gender))
  return parts.join(' و')
}

const SCALES: NounForms[] = [
  { one: 'ألف', two: 'ألفان', few: 'آلاف', many: 'ألفاً', gender: 'masculine' },
  { one: 'مليون', two: 'مليونان', few: 'ملايين', many: 'مليوناً', gender: 'masculine' },
  { one: 'مليار', two: 'ملياران', few: 'مليارات', many: 'ملياراً', gender: 'masculine' },
]

/** A count with its noun: "ديناران", "ثلاثة دنانير", "أحد عشر ديناراً", "مائة دينار". */
function counted(value: number, noun: NounForms, { saySingleOne = false } = {}): string {
  if (value === 1) return saySingleOne ? `${noun.one} ${noun.gender === 'masculine' ? 'واحد' : 'واحدة'}` : noun.one
  if (value === 2) return noun.two
  const lastTwo = value % 100
  const words = numberWords(value, noun.gender, true)
  if (lastTwo >= 3 && lastTwo <= 10) return `${words} ${noun.few}`
  if (lastTwo >= 11) return `${words} ${noun.many}`
  return `${words} ${noun.one}`
}

/**
 * A whole number in words, for counting a noun of the given gender (0 is "صفر").
 * Up to 999,999,999,999.
 */
export function numberWords(value: number, gender: Gender = 'masculine', beforeNoun = false): string {
  if (!Number.isInteger(value) || value < 0 || value > 999_999_999_999) throw new RangeError('Out of range for tafqeet.')
  if (value === 0) return 'صفر'
  const groups: number[] = []
  for (let rest = value; rest > 0; rest = Math.floor(rest / 1000)) groups.push(rest % 1000)
  // The last group with a value: when the counted noun follows it directly, a scale word is in
  // construct state: ألفا دينار (not ألفان)، اثنا عشر ألف دينار (not ألفاً).
  const lowest = groups.findIndex((group) => group > 0)
  const parts: string[] = []
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!
    if (!group) continue
    if (index === 0) {
      parts.push(belowThousand(group, gender, beforeNoun))
    } else {
      const scale = SCALES[index - 1]!
      const construct = beforeNoun && index === lowest
      if (group === 1) parts.push(scale.one)
      else if (group === 2) parts.push(construct ? scale.two.slice(0, -1) : scale.two)
      else {
        const lastTwo = group % 100
        const words = belowThousand(group, 'masculine', true)
        const noun = lastTwo >= 3 && lastTwo <= 10 ? scale.few : lastTwo >= 11 && !construct ? scale.many : scale.one
        parts.push(`${words} ${noun}`)
      }
    }
  }
  return parts.join(' و')
}

/**
 * The amount in words for a currency: "فقط ألف وخمسمائة دينار وخمسمائة فلس لا غير".
 * Returns null for an unsupported currency or a negative or too large amount.
 */
export function tafqeet(amount: number, currency: string): string | null {
  const words = CURRENCY_WORDS[currency as keyof typeof CURRENCY_WORDS]
  if (!words || !Number.isFinite(amount) || amount < 0 || amount > 999_999_999_999) return null
  // Rounded to the smallest unit first, so 10.999 JOD is 10 dinars and 999 fils, never 1000 fils.
  const totalSub = Math.round(amount * words.subPerUnit)
  const whole = Math.floor(totalSub / words.subPerUnit)
  const sub = totalSub % words.subPerUnit
  const parts: string[] = []
  if (whole > 0) parts.push(counted(whole, words.unit, { saySingleOne: true }))
  if (sub > 0) parts.push(counted(sub, words.sub, { saySingleOne: true }))
  if (parts.length === 0) parts.push(`صفر ${words.unit.one}`)
  return `فقط ${parts.join(' و')} لا غير`
}
