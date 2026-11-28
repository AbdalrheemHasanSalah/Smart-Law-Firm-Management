import assert from 'node:assert/strict'
import { test } from 'node:test'
import { numberWords, tafqeet } from './tafqeet.ts'

test('numbers counting a masculine noun', () => {
  const cases: [number, string][] = [
    [3, 'ثلاثة'], [10, 'عشرة'], [11, 'أحد عشر'], [12, 'اثنا عشر'], [13, 'ثلاثة عشر'], [20, 'عشرون'],
    [21, 'واحد وعشرون'], [22, 'اثنان وعشرون'], [99, 'تسعة وتسعون'], [100, 'مائة'], [200, 'مئتان'], [305, 'ثلاثمائة وخمسة'],
    [1000, 'ألف'], [1500, 'ألف وخمسمائة'], [2000, 'ألفان'], [3000, 'ثلاثة آلاف'], [11000, 'أحد عشر ألفاً'],
    [21500, 'واحد وعشرون ألفاً وخمسمائة'], [200000, 'مئتا ألف'], [1000000, 'مليون'], [2500000, 'مليونان وخمسمائة ألف'],
  ]
  for (const [value, words] of cases) assert.equal(numberWords(value), words, String(value))
})

test('numbers counting a feminine noun', () => {
  const cases: [number, string][] = [[1, 'واحدة'], [3, 'ثلاث'], [8, 'ثماني'], [10, 'عشر'], [11, 'إحدى عشرة'], [12, 'اثنتا عشرة'], [13, 'ثلاث عشرة'], [21, 'إحدى وعشرون'], [28, 'ثماني وعشرون']]
  for (const [value, words] of cases) assert.equal(numberWords(value, 'feminine'), words, String(value))
})

test('amounts with their currency, in the forms Arabic grammar requires', () => {
  const cases: [number, string, string][] = [
    [1, 'JOD', 'فقط دينار واحد لا غير'],
    [2, 'JOD', 'فقط ديناران لا غير'],
    [3, 'JOD', 'فقط ثلاثة دنانير لا غير'],
    [10, 'USD', 'فقط عشرة دولارات لا غير'],
    [15, 'ILS', 'فقط خمسة عشر شيكلاً لا غير'],
    [100, 'JOD', 'فقط مائة دينار لا غير'],
    [200, 'JOD', 'فقط مئتا دينار لا غير'],
    [1500, 'JOD', 'فقط ألف وخمسمائة دينار لا غير'],
    [2000, 'USD', 'فقط ألفا دولار لا غير'],
    [12000, 'ILS', 'فقط اثنا عشر ألف شيكل لا غير'],
    [1250.5, 'JOD', 'فقط ألف ومئتان وخمسون ديناراً وخمسمائة فلس لا غير'],
    [7.03, 'ILS', 'فقط سبعة شواكل وثلاث أغورات لا غير'],
    [0.5, 'ILS', 'فقط خمسون أغورة لا غير'],
    [0.01, 'USD', 'فقط سنت واحد لا غير'],
    [10.9999, 'JOD', 'فقط أحد عشر ديناراً لا غير'],
    [0, 'JOD', 'فقط صفر دينار لا غير'],
  ]
  for (const [amount, currency, words] of cases) assert.equal(tafqeet(amount, currency), words, `${amount} ${currency}`)
  assert.equal(tafqeet(5, 'EUR'), null)
  assert.equal(tafqeet(-1, 'JOD'), null)
})
