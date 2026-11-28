import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeAccident, computePeriod, type AccidentInput } from './legalTools.ts'

const injury: AccidentInput = {
  kind: 'injury', accidentDay: '2025-03-10', disabilityPercent: 0, hospitalNights: 0, surgeryWithStay: false,
  dependantsSharePercent: 0, monthlyIncome: 0, sectorAverageWage: 0, futureYears: 0, immediateDiscountPercent: 0,
}
const amount = (result: ReturnType<typeof computeAccident>, key: string) => result!.lines.find((line) => line.key === key)?.amount

test('the period between two dates counts years, months and days, either way round', () => {
  assert.deepEqual(computePeriod('2024-01-31', '2025-03-01'), { years: 1, months: 1, days: 1, totalDays: 395, weeks: 56, reversed: false })
  const back = computePeriod('2025-03-01', '2024-01-31')
  assert.equal(back?.reversed, true)
  assert.equal(back?.totalDays, 395)
  assert.equal(computePeriod('2025-02-30', '2025-03-01')?.totalDays, 1, 'an impossible date rolls over like the deadline tool')
  assert.equal(computePeriod('', '2025-03-01'), null)
  assert.deepEqual(computePeriod('2023-05-15', '2026-05-14'), { years: 2, months: 11, days: 29, totalDays: 1095, weeks: 156, reversed: false })
  assert.deepEqual(computePeriod('2024-02-29', '2025-02-28'), { years: 1, months: 0, days: 0, totalDays: 365, weeks: 52, reversed: false })
})

test('art. 152: 50 dinars per 1% disability, 40 per hospital night, 500 for surgery with a stay', () => {
  const result = computeAccident({ ...injury, disabilityPercent: 12, hospitalNights: 5, surgeryWithStay: true })
  assert.equal(amount(result, 'moral_disability'), 600)
  assert.equal(amount(result, 'moral_hospital'), 200)
  assert.equal(amount(result, 'moral_surgery'), 500)
  assert.equal(result!.moralTotal, 1300)
})

test('art. 152(4): with no disability, stay or surgery, up to 500 dinars', () => {
  const result = computeAccident(injury)
  assert.equal(result!.lines.length, 1)
  assert.equal(result!.lines[0]!.upTo, true)
  assert.equal(result!.moralTotal, 500)
})

test('art. 153: non-material damages stop at 10,000 dinars', () => {
  const result = computeAccident({ ...injury, disabilityPercent: 100, hospitalNights: 150, surgeryWithStay: true })
  assert.equal(result!.moralTotal, 10_000)
  assert.equal(amount(result, 'moral_cap'), 10_000 - (5000 + 6000 + 500))
})

test('art. 154: heirs get half the ceiling less the dependants\' share', () => {
  assert.equal(computeAccident({ ...injury, kind: 'death', dependantsSharePercent: 0 })!.moralTotal, 5000)
  assert.equal(computeAccident({ ...injury, kind: 'death', dependantsSharePercent: 25 })!.moralTotal, 3750)
  const death = computeAccident({ ...injury, kind: 'death', monthlyIncome: 3000 })
  assert.equal(death!.materialTotal, 0, 'the death head has no earnings lines here')
  assert.equal(death!.urgentMaxTotal, null)
})

test('art. 155: income above twice the sector average is not counted', () => {
  const result = computeAccident({ ...injury, monthlyIncome: 9000, sectorAverageWage: 3505 })
  assert.equal(result!.cappedMonthlyWage, 7010)
  assert.equal(result!.wageWasCapped, true)
  assert.equal(computeAccident({ ...injury, monthlyIncome: 3000, sectorAverageWage: 3505 })!.wageWasCapped, false)
})

test('art. 156: temporary disability at 100% of the daily wage, for two years at most', () => {
  const short = computeAccident({ ...injury, monthlyIncome: 3000, temporaryUntilDay: '2025-04-09' })
  assert.equal(amount(short, 'temporary'), 3000)
  const long = computeAccident({ ...injury, monthlyIncome: 3000, temporaryUntilDay: '2028-01-01' })
  assert.equal(amount(long, 'temporary'), 100 * 730, 'two years from 2025-03-10 is 730 days')
})

test('art. 157: future loss uses the years and discount the lawyer enters', () => {
  const result = computeAccident({ ...injury, monthlyIncome: 3000, disabilityPercent: 20, futureYears: 10, immediateDiscountPercent: 25 })
  assert.equal(amount(result, 'permanent'), 3000 * 0.2 * 12 * 10 * 0.75)
  assert.equal(amount(computeAccident({ ...injury, monthlyIncome: 3000, disabilityPercent: 20 }), 'permanent'), undefined, 'no years, no line')
})

test('art. 159: three years from the accident, or from a final report that came later', () => {
  assert.equal(computeAccident(injury)!.limitationDay, '2028-03-10')
  const late = computeAccident({ ...injury, finalReportDay: '2028-06-01' })
  assert.equal(late!.limitationDay, '2031-06-01')
  assert.equal(late!.limitationFromReport, true)
  assert.equal(computeAccident({ ...injury, finalReportDay: '2026-01-01' })!.limitationFromReport, false)
})

test('arts. 160 and 165: urgent payments at the capped wage, twelve at most', () => {
  const result = computeAccident({ ...injury, monthlyIncome: 9000, sectorAverageWage: 3505 })
  assert.equal(result!.urgentMonthly, 7010)
  assert.equal(result!.urgentMaxTotal, 84_120)
})
