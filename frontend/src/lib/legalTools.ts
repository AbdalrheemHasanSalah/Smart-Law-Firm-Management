/**
 * Palestinian legal toolkit: the rules and the arithmetic behind the tools page.
 *
 * Every legal number lives here, next to the law it comes from, so it can be checked and corrected
 * in one place. The page always shows that results are a guide and must be verified by a lawyer.
 */

/* ───────────────────────── appeal deadlines ───────────────────────── */

export type DeadlineRule = {
  key: string
  label: string
  days: number
  /** The law the period comes from, shown under the result. */
  source: string
}

export const DEADLINE_RULES: readonly DeadlineRule[] = [
  {
    key: 'civil_appeal',
    label: 'استئناف حكم مدني أو تجاري (صلح أو بداية)',
    days: 30,
    source: 'قانون أصول المحاكمات المدنية والتجارية رقم 2 لسنة 2001',
  },
  {
    key: 'civil_cassation',
    label: 'الطعن بالنقض في حكم مدني أو تجاري',
    days: 40,
    source: 'قانون أصول المحاكمات المدنية والتجارية رقم 2 لسنة 2001',
  },
  {
    key: 'criminal_appeal',
    label: 'استئناف حكم جزائي',
    days: 15,
    source: 'قانون الإجراءات الجزائية رقم 3 لسنة 2001',
  },
  {
    key: 'criminal_cassation',
    label: 'الطعن بالنقض في حكم جزائي',
    days: 40,
    source: 'قانون الإجراءات الجزائية رقم 3 لسنة 2001',
  },
]

/** The official weekly holiday: when a period ends on it, the last day moves to the next day. */
const WEEKLY_HOLIDAY = 5 // Friday (0 = Sunday)

/** A calendar day as a UTC date, so adding days never shifts with daylight saving. */
const parseDay = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}
const toDayString = (date: Date) => date.toISOString().slice(0, 10)
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000)

export type DeadlineResult = {
  /** Last day to file, as YYYY-MM-DD. */
  lastDay: string
  /** True when the last day fell on the weekly holiday and was moved. */
  movedFromHoliday: boolean
  /** Whole days from today until the last day (negative once it has passed). */
  daysLeft: number
}

/**
 * The period starts the day after the judgment (or its notification), so the last day is the
 * judgment day plus the period. A last day that falls on the weekly holiday moves to the next day.
 */
export const computeDeadline = (judgmentDay: string, rule: DeadlineRule, extendOverHoliday: boolean, today = new Date()): DeadlineResult => {
  let last = addDays(parseDay(judgmentDay), rule.days)
  let movedFromHoliday = false
  if (extendOverHoliday && last.getUTCDay() === WEEKLY_HOLIDAY) {
    last = addDays(last, 1)
    movedFromHoliday = true
  }
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return {
    lastDay: toDayString(last),
    movedFromHoliday,
    daysLeft: Math.round((last.getTime() - todayUtc) / 86_400_000),
  }
}

/** A one-event calendar file for the deadline, for people who keep their own calendar. */
export const deadlineIcs = (title: string, lastDay: string, description: string) => {
  const day = lastDay.replaceAll('-', '')
  const next = toDayString(addDays(parseDay(lastDay), 1)).replaceAll('-', '')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const escape = (text: string) => text.replace(/[\\,;]/g, (match) => `\\${match}`).replace(/\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Qadiyati//Legal tools//AR',
    'BEGIN:VEVENT',
    `UID:${day}-${Math.random().toString(36).slice(2)}@qadiyati`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${next}`,
    `SUMMARY:${escape(title)}`,
    `DESCRIPTION:${escape(description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-P3D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

/* ───────────────────────── labour rights (Labour Law No. 7 of 2000) ───────────────────────── */

export const LABOR_SOURCE = 'قانون العمل الفلسطيني رقم 7 لسنة 2000'

/** Days in a month for turning a monthly wage into a daily one. */
const DAYS_PER_MONTH = 30
/** Arbitrary dismissal: two months' wage per year of service, capped at two years' wage. */
const DISMISSAL_MONTHS_PER_YEAR = 2
const DISMISSAL_CAP_MONTHS = 24
/** Annual leave: two weeks a year, three for hazardous work or after five years. */
const LEAVE_DAYS_STANDARD = 14
const LEAVE_DAYS_EXTENDED = 21
const LEAVE_EXTENDED_AFTER_YEARS = 5

export type LaborInput = {
  monthlyWage: number
  startDay: string
  endDay: string
  unusedLeaveDays: number
  noticeGiven: boolean
  arbitraryDismissal: boolean
}

export type LaborLine = { key: string; label: string; amount: number; note: string }

export type LaborResult = {
  serviceYears: number
  /** Service as whole years, months and days, for display. */
  service: { years: number; months: number; days: number }
  annualLeaveDays: number
  lines: LaborLine[]
  total: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

const serviceParts = (start: Date, end: Date) => {
  let years = end.getUTCFullYear() - start.getUTCFullYear()
  let months = end.getUTCMonth() - start.getUTCMonth()
  let days = end.getUTCDate() - start.getUTCDate()
  if (days < 0) {
    months -= 1
    days += new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate()
  }
  if (months < 0) {
    years -= 1
    months += 12
  }
  return { years, months, days }
}

export const computeLaborRights = (input: LaborInput): LaborResult | null => {
  const start = parseDay(input.startDay)
  const end = parseDay(input.endDay)
  if (!(input.monthlyWage > 0) || end.getTime() <= start.getTime()) return null

  const service = serviceParts(start, end)
  // Whole years and months count exactly; leftover days as a share of a year.
  const serviceYears = service.years + service.months / 12 + service.days / 365
  const dailyWage = input.monthlyWage / DAYS_PER_MONTH
  const lines: LaborLine[] = []

  // End-of-service award: one month's wage for each year, fractions in proportion, after a full year.
  if (serviceYears >= 1) {
    lines.push({
      key: 'end_of_service',
      label: 'مكافأة نهاية الخدمة',
      amount: round2(input.monthlyWage * serviceYears),
      note: 'أجر شهر عن كل سنة خدمة، وتُحسب كسور السنة بنسبتها. تُستحق بعد إتمام سنة.',
    })
  }

  if (!input.noticeGiven) {
    lines.push({
      key: 'notice',
      label: 'بدل الإشعار',
      amount: round2(input.monthlyWage),
      note: 'أجر شهر بدل الإشعار إذا انتهى العقد دون إشعار مسبق.',
    })
  }

  if (input.arbitraryDismissal) {
    const months = Math.min(DISMISSAL_MONTHS_PER_YEAR * serviceYears, DISMISSAL_CAP_MONTHS)
    lines.push({
      key: 'arbitrary_dismissal',
      label: 'تعويض الفصل التعسفي',
      amount: round2(input.monthlyWage * months),
      note: 'أجر شهرين عن كل سنة خدمة، على ألا يزيد عن أجر سنتين.',
    })
  }

  if (input.unusedLeaveDays > 0) {
    lines.push({
      key: 'leave',
      label: 'بدل الإجازات السنوية غير المستعملة',
      amount: round2(dailyWage * input.unusedLeaveDays),
      note: `الأجر اليومي (الشهري ÷ ${DAYS_PER_MONTH}) × عدد الأيام غير المستعملة.`,
    })
  }

  return {
    serviceYears,
    service,
    annualLeaveDays: serviceYears >= LEAVE_EXTENDED_AFTER_YEARS ? LEAVE_DAYS_EXTENDED : LEAVE_DAYS_STANDARD,
    lines,
    total: round2(lines.reduce((sum, line) => sum + line.amount, 0)),
  }
}

/* ───────────────────────── official links ───────────────────────── */

export const OFFICIAL_LINKS = [
  {
    title: 'بوابة الخدمات الإلكترونية — ميزان',
    body: 'مجلس القضاء الأعلى: متابعة الدعاوى والجلسات والتبليغات.',
    href: 'https://courts.gov.ps/EServices2020/account/login',
  },
  {
    title: 'مجلس القضاء الأعلى',
    body: 'الموقع الرسمي للمحاكم الفلسطينية وأخبارها وتعاميمها.',
    href: 'https://www.courts.gov.ps/',
  },
  {
    title: 'وزارة العدل',
    body: 'خدمات الوزارة والتشريعات والنماذج الرسمية.',
    href: 'https://moj.pna.ps/',
  },
  {
    title: 'نقابة المحامين النظاميين',
    body: 'شؤون العضوية والتدريب وتعاميم النقابة.',
    href: 'https://palestinebar.ps/',
  },
  {
    title: 'مقام — موسوعة القوانين والأحكام',
    body: 'موسوعة القوانين وأحكام المحاكم الفلسطينية من جامعة النجاح الوطنية.',
    href: 'https://maqam.najah.edu/',
  },
] as const
