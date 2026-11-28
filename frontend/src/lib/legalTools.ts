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

/** The start day moved on by whole months, kept on the last day of a shorter month (31 Jan + 1 month = 28 Feb). */
const addMonthsClamped = (date: Date, months: number) => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), last))
  return target
}

/** Whole years and months from the start, then the days left over to the end. */
const serviceParts = (start: Date, end: Date) => {
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
  if (addMonthsClamped(start, months).getTime() > end.getTime()) months -= 1
  const days = Math.round((end.getTime() - addMonthsClamped(start, months).getTime()) / 86_400_000)
  return { years: Math.floor(months / 12), months: months % 12, days }
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

/* ───────────────────────── period between two dates ───────────────────────── */

export type PeriodResult = {
  years: number
  months: number
  days: number
  totalDays: number
  weeks: number
  /** True when the second date is before the first; the period is then counted the other way round. */
  reversed: boolean
}

/** The exact time between two calendar days, in years, months and days and as a total of days. */
export const computePeriod = (fromDay: string, toDay: string): PeriodResult | null => {
  const first = validDay(fromDay)
  const second = validDay(toDay)
  if (!first || !second) return null
  const reversed = second.getTime() < first.getTime()
  const [start, end] = reversed ? [second, first] : [first, second]
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return { ...serviceParts(start, end), totalDays, weeks: Math.floor(totalDays / 7), reversed }
}

/* ───────────────────────── road accidents (Insurance Law No. 20 of 2005) ───────────────────────── */

export const ACCIDENT_SOURCE = 'قانون التأمين رقم 20 لسنة 2005، المواد 152–160 و165 (لم يعدّلها القرار بقانون رقم 41 لسنة 2018)'

/** Art. 152: non-material damage, in Jordanian dinars. */
const MORAL_PER_DISABILITY_PERCENT = 50
const MORAL_PER_HOSPITAL_NIGHT = 40
const MORAL_SURGERY = 500
/** Art. 152(4): when none of the above applies, up to this much. */
const MORAL_OTHERWISE_UP_TO = 500
/** Art. 153: the ceiling on all non-material damages. */
const MORAL_CAP = 10_000
/** Art. 154: the heirs receive half of the art. 153 ceiling. */
const DEATH_SHARE_OF_CAP = 0.5
/** Art. 155: income above twice the average wage of the injured person's sector is not counted. */
const WAGE_CAP_MULTIPLE = 2
/** Art. 156: temporary disability is paid in full for at most two years from the accident. */
const TEMPORARY_MAX_YEARS = 2
/** Art. 159: the claim lapses after three years. */
const LIMITATION_YEARS = 3
/** Art. 165: urgent monthly payments stop at twelve. */
const URGENT_MAX_PAYMENTS = 12
/** Turning a monthly wage into a daily one, as the labour tool does. Practice, not the insurance law. */
const DAYS_PER_MONTH_FOR_DAILY_WAGE = 30

const addYears = (date: Date, years: number) => {
  const target = new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), last))
  return target
}

export type AccidentInput = {
  kind: 'injury' | 'death'
  accidentDay: string
  /** Art. 159: the day the final medical report was obtained, if any. */
  finalReportDay?: string
  /** Permanent disability, 0–100. */
  disabilityPercent: number
  hospitalNights: number
  surgeryWithStay: boolean
  /** Art. 154: the dependants' share of the estate under the inheritance certificate, 0–100. */
  dependantsSharePercent: number
  /** The injured person's monthly income before the accident (art. 160: the three months before it). */
  monthlyIncome: number
  /** Art. 155: the average wage of their sector from the latest PCBS bulletin. */
  sectorAverageWage: number
  /** The last day of temporary disability, if any. */
  temporaryUntilDay?: string
  /** Art. 157 leaves the method to practice: the years of future loss counted and the discount for paying now. */
  futureYears: number
  immediateDiscountPercent: number
}

export type AccidentLine = { key: string; label: string; amount: number; currency: 'JOD' | 'wage'; note: string; upTo?: boolean }

export type AccidentResult = {
  lines: AccidentLine[]
  /** Non-material damages are in dinars; loss of earnings is in the wage's currency. */
  moralTotal: number
  materialTotal: number
  cappedMonthlyWage: number | null
  wageWasCapped: boolean
  /** Art. 159. */
  limitationDay: string
  limitationFromReport: boolean
  /** Art. 160 and 165: the largest urgent monthly payment and the most paid in urgent payments. */
  urgentMonthly: number | null
  urgentMaxTotal: number | null
}

function validDay(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = parseDay(value)
  return Number.isNaN(date.getTime()) ? null : date
}
const clampPercent = (value: number) => Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100)
const dinars = (value: number) => value.toLocaleString('en')

const moralLines = (input: AccidentInput): AccidentLine[] => {
  if (input.kind === 'death') {
    const share = clampPercent(input.dependantsSharePercent)
    const full = MORAL_CAP * DEATH_SHARE_OF_CAP
    return [{
      key: 'death',
      label: 'ما يُدفع للورثة عن الوفاة',
      amount: round2(full * (1 - share / 100)),
      currency: 'JOD',
      note: `المادة 154: خمسون بالمائة من سقف المادة 153 (${dinars(full)} دينار) مطروحاً منه حصة الورثة المعالين (${share}%) وفق حجة حصر الإرث.`,
    }]
  }
  const disability = clampPercent(input.disabilityPercent)
  const nights = Math.max(Math.floor(input.hospitalNights || 0), 0)
  const parts: AccidentLine[] = []
  if (disability > 0) {
    parts.push({ key: 'moral_disability', label: 'ضرر معنوي عن العجز الدائم', amount: round2(disability * MORAL_PER_DISABILITY_PERCENT), currency: 'JOD', note: `المادة 152(1): ${MORAL_PER_DISABILITY_PERCENT} ديناراً × ${disability}% عجز دائم.` })
  }
  if (nights > 0) {
    parts.push({ key: 'moral_hospital', label: 'ضرر معنوي عن المكوث في المشفى', amount: nights * MORAL_PER_HOSPITAL_NIGHT, currency: 'JOD', note: `المادة 152(2): ${MORAL_PER_HOSPITAL_NIGHT} ديناراً × عدد الليالي (${nights}).` })
  }
  if (input.surgeryWithStay) {
    parts.push({ key: 'moral_surgery', label: 'ضرر معنوي عن العمليات الجراحية', amount: MORAL_SURGERY, currency: 'JOD', note: `المادة 152(3): ${MORAL_SURGERY} دينار عن العملية أو العمليات التي استلزمت المكوث في المشفى.` })
  }
  if (parts.length === 0) {
    return [{ key: 'moral_other', label: 'ضرر معنوي (لا عجز ولا مكوث ولا عملية)', amount: MORAL_OTHERWISE_UP_TO, currency: 'JOD', upTo: true, note: `المادة 152(4): تعويض لا يزيد عن ${MORAL_OTHERWISE_UP_TO} دينار، تقدّره المحكمة.` }]
  }
  const sum = parts.reduce((total, line) => total + line.amount, 0)
  if (sum > MORAL_CAP) {
    parts.push({ key: 'moral_cap', label: 'تخفيض إلى سقف الضرر المعنوي', amount: round2(MORAL_CAP - sum), currency: 'JOD', note: `المادة 153: لا يزيد مجموع الضرر المعنوي عن ${dinars(MORAL_CAP)} دينار.` })
  }
  return parts
}

const earningsLines = (input: AccidentInput, accident: Date, monthly: number): AccidentLine[] => {
  const lines: AccidentLine[] = []
  const until = validDay(input.temporaryUntilDay)
  if (until && until.getTime() > accident.getTime()) {
    const limit = addYears(accident, TEMPORARY_MAX_YEARS)
    const capped = until.getTime() > limit.getTime()
    const days = Math.round(((capped ? limit : until).getTime() - accident.getTime()) / 86_400_000)
    lines.push({
      key: 'temporary',
      label: 'العجز المؤقت',
      amount: round2((monthly / DAYS_PER_MONTH_FOR_DAILY_WAGE) * days),
      currency: 'wage',
      note: `المادة 156: 100% من الأجر اليومي × عدد الأيام (${days})${capped ? ' (بلغت حدّ السنتين من تاريخ الحادث)' : ''}. الأجر اليومي = الشهري ÷ ${DAYS_PER_MONTH_FOR_DAILY_WAGE} (عُرف، لا نص).`,
    })
  }
  const disability = clampPercent(input.disabilityPercent)
  const years = Math.max(input.futureYears || 0, 0)
  if (disability > 0 && years > 0) {
    const discount = clampPercent(input.immediateDiscountPercent)
    lines.push({
      key: 'permanent',
      label: 'فقدان المقدرة على الكسب المستقبلي',
      amount: round2(monthly * (disability / 100) * 12 * years * (1 - discount / 100)),
      currency: 'wage',
      note: `الأجر بعد سقف المادة 155 × ${disability}% × 12 شهراً × عدد السنوات (${years})، ناقص ${discount}% مقابل الدفع الفوري (المادة 157). عدد السنوات ونسبة الخصم يحددهما المحامي بحسب العمل القضائي؛ القانون لا يضع لهما معادلة.`,
    })
  }
  return lines
}

export const computeAccident = (input: AccidentInput): AccidentResult | null => {
  const accident = validDay(input.accidentDay)
  if (!accident) return null

  const income = input.monthlyIncome > 0 ? input.monthlyIncome : 0
  const cap = input.sectorAverageWage > 0 ? input.sectorAverageWage * WAGE_CAP_MULTIPLE : Infinity
  const cappedMonthlyWage = income ? round2(Math.min(income, cap)) : null
  const injury = input.kind === 'injury'

  const moral = moralLines(input)
  const material = injury && cappedMonthlyWage ? earningsLines(input, accident, cappedMonthlyWage) : []

  const report = validDay(input.finalReportDay)
  const fromAccident = addYears(accident, LIMITATION_YEARS)
  const limitationFromReport = Boolean(report && report.getTime() > fromAccident.getTime())

  return {
    lines: [...moral, ...material],
    moralTotal: round2(moral.reduce((sum, line) => sum + line.amount, 0)),
    materialTotal: round2(material.reduce((sum, line) => sum + line.amount, 0)),
    cappedMonthlyWage,
    wageWasCapped: income > cap,
    limitationDay: toDayString(limitationFromReport && report ? addYears(report, LIMITATION_YEARS) : fromAccident),
    limitationFromReport,
    urgentMonthly: injury ? cappedMonthlyWage : null,
    urgentMaxTotal: injury && cappedMonthlyWage ? round2(cappedMonthlyWage * URGENT_MAX_PAYMENTS) : null,
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
