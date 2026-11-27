import { currentLang } from '../preferences'
import dictionary from './en.json'

/**
 * English for an interface written in Arabic.
 *
 * The pages keep their Arabic text in the code (Arabic stays the source and the default). With
 * English chosen, this layer translates what the browser shows: every text node and the
 * placeholder, aria-label, title and alt attributes, as React renders and updates them. Text the
 * user typed (form values) and records (names, case titles) are never in the dictionary, so they
 * stay as written. Dates, times and amounts use LOCALE.
 */
export const LANG = currentLang()
export const IS_EN = LANG === 'en'
/** For Intl formatters: Arabic with Latin digits, or British English (day month year). */
export const LOCALE = IS_EN ? 'en-GB' : 'ar-PS-u-nu-latn'

const EXACT = dictionary as Record<string, string>
const ARABIC = /[؀-ۿ]/

const n = (value: string) => (value === '1' ? '' : 's')

/** Texts built from variables: [Arabic pattern, English]. Checked when no exact entry matches. */
const PATTERNS: [RegExp, string | ((...groups: string[]) => string)][] = [
  [/^(\d+) طلبات جديدة بانتظار قرارك$/, '$1 new requests awaiting your decision'],
  [/^طلب جديد واحد بانتظار قرارك$/, 'One new request awaiting your decision'],
  [/^طلبان جديدان بانتظار قرارك$/, 'Two new requests awaiting your decision'],
  [/^لديك (\d+) مهام مفتوحة، منها (\d+) متأخرة، و(\d+) قضايا قيد العمل\.$/, (_, a, b, c) => `You have ${a} open task${n(a)}, ${b} overdue, and ${c} active case${n(c)}.`],
  [/^لديك (\d+) مهام مفتوحة، و(\d+) قضايا قيد العمل\.$/, (_, a, c) => `You have ${a} open task${n(a)} and ${c} active case${n(c)}.`],
  [/^(\d+) أشهر$/, (_, a) => `${a} month${n(a)}`],
  [/^(\d+) شهراً$/, (_, a) => `${a} month${n(a)}`],
  [/^(\d+) محامين$/, '$1 lawyers'],
  [/^(\d+) محامياً$/, '$1 lawyers'],
  [/^وفّر (\d+)%$/, 'Save $1%'],
  [/^خصم الاشتراك السنوي (\d+)%$/, 'Yearly discount $1%'],
  [/^\(بعد خصم (\d+)%\)$/, '(after a $1% discount)'],
  [/^(.+) لكل محامٍ شهرياً · خصم (\d+)% على الاشتراك السنوي · مهلة السماح (.+) بعد انتهاء الاشتراك$/, '$1 per lawyer per month · $2% off the yearly subscription · $3 grace period after it ends'],
  [/^(\d+) أيام$/, (_, a) => `${a} day${n(a)}`],
  [/^(\d+) يوماً$/, (_, a) => `${a} day${n(a)}`],
  [/^(\d+) عقد$/, (_, a) => `${a} contract${n(a)}`],
  [/^لديك جلسة (.+?) في القضية (\S+) غداً الساعة (.+)\.$/, 'You have a $1 hearing in case $2 tomorrow at $3.'],
  [/^لديك جلسة (.+?) في القضية (\S+) اليوم الساعة (.+)\.$/, 'You have a $1 hearing in case $2 today at $3.'],
  [/^لديك مهمة في القضية (\S+) موعد إنجازها غداً الساعة (.+)\.$/, 'You have a task in case $1 due tomorrow at $2.'],
  [/^لديك مهمة موعد إنجازها غداً الساعة (.+)\.$/, 'You have a task due tomorrow at $1.'],
  [/^لديك (.+?)(?: في القضية (\S+))? اليوم الساعة (.+)\.$/, (_, _kind, number, time) => `You have an appointment${number ? ` in case ${number}` : ''} today at ${time}.`],
  [/^ينتهي التوكيل رقم (\S+) (.+)\. جدّده أو استبدله حتى لا تبقى قضاياه دون توكيل ساري\.$/, (_, number, when) => `Power of attorney ${number} expires ${when === 'اليوم' ? 'today' : when === 'غداً' ? 'tomorrow' : when.replace(/خلال (\d+) يوماً/, 'in $1 days')}. Renew or replace it so its cases are not left without one.`],
  [/^عُهدة (.+?) — متبقٍّ (.+)$/, "$1's custody — $2 left"],
  [/^مصاريف عُهدة (.+)$/, "Expenses of $1's custody"],
  [/^عُهدة (.+)$/, "$1's custody"],
  [/^كشف (.+)$/, '$1 ledger'],
  [/^شهراً بشهر \((.+)\)$/, 'Month by month ($1)'],
  [/^سُجّل المصروف، لكن تعذّر رفع الإيصال: (.+) أرفقه لاحقاً\.$/, 'The expense was recorded, but the receipt could not be uploaded: $1 Attach it later.'],
  [/^ربحية القضية \((.+)\)$/, 'Case profitability ($1)'],
  [/^نسبة التحصيل (\d+)%$/, 'Collection rate $1%'],
  [/^سجلّ (.+)$/, "$1's record"],
  [/^راتب (.+) — (\d{4}-\d{2})$/, "$1's salary — $2"],
  [/^حُضّرت (\d+) كشوف رواتب جديدة\.$/, '$1 new payslips prepared.'],
  [/^(\d+) كشوف ما زالت مسودات\.$/, '$1 payslips are still drafts.'],
  [/^· المتبقي من إجازتك السنوية (\d+)$/, '· $1 annual leave days left'],
  [/^· (\d+) بانتظار القرار$/, '· $1 awaiting decision'],
  [/^(\d+) بانتظار القرار$/, '$1 awaiting decision'],
  [/^(\d+) أيام عمل \(دون أيام الجمعة\)$/, (_, a) => `${a} working day${n(a)} (Fridays not counted)`],
  [/^إجازة (.+)$/, '$1 leave'],
  [/^طلب أحد أعضاء الفريق إجازة لمدة (\d+) يوم عمل، وهو بانتظار قرارك\.$/, 'A team member requested $1 working days of leave, awaiting your decision.'],
  [/^حُفظت الصفحة، لكن تعذّر رفع الشعار: (.+)$/, 'The page was saved, but the logo could not be uploaded: $1'],
  [/^· يفضّل: (.+)$/, '· prefers: $1'],
  [/^(\d+) طلبات جديدة\.$/, '$1 new requests.'],
  [/^أصبح موكّلاً: (.+)$/, 'Became a client: $1'],
  [/^سبب التأجيل: (.+)$/, 'Reason for postponement: $1'],
  [/^(\d+) أوراق بانتظار التبليغ\.$/, '$1 papers awaiting delivery.'],
  [/^حُفظت الورقة، لكن تعذّر رفع الملف: (.+) أعد المحاولة\.$/, 'The paper was saved, but the file could not be uploaded: $1 Try again.'],
  [/^أجندة (.+)$/, "$1's agenda"],
  [/^تبليغ إلى (.+)$/, 'Notice to $1'],
  [/^(\d+) توكيل$/, (_, a) => `${a} power${n(a)} of attorney`],
  [/^(\d+) توكيل · (.+)$/, (_, a, b) => `${a} power${n(a)} of attorney · ${b}`],
  [/^(\d+) توكيلات تنتهي خلال 30 يوماً\.$/, '$1 powers of attorney expire within 30 days.'],
  [/^ينتهي خلال (\d+) يوماً$/, (_, a) => `Expires in ${a} day${n(a)}`],
  [/^حُفظ التوكيل، لكن تعذّر رفع الصورة: (.+) أعد المحاولة\.$/, 'The power of attorney was saved, but the scan could not be uploaded: $1 Try again.'],
  [/^(\d+) قضية$/, (_, a) => `${a} case${n(a)}`],
  [/^(\d+) موكّل$/, (_, a) => `${a} client${n(a)}`],
  [/^(.+) من (\d+)$/, '$1 of $2'],
  [/^(.+) من المكتب$/, '$1 from the office'],
  [/^(.+) يمكنك التواصل مع إدارة المنصّة مباشرة\.$/, '$1 You can contact the platform team directly.'],
  [/^(.+) — (\d+) يوماً$/, (_, a, b) => `${a} — ${b} day${n(b)}`],
  [/^· أُغلقت (.+)$/, '· closed $1'],
  [/^آخر موعد: (.+)$/, 'Deadline: $1'],
  [/^أعدّ هذه الورقة مساعد ذكي \((.+)\) من بيانات ملف القضية فقط\./, 'This sheet was prepared by an AI assistant ($1) from the case file only. Items marked “Unverified” are inferences not based on the file. The sheet is an aid that doesn’t replace the lawyer’s review, and it isn’t shown to the client.'],
  [/^أنجز: (.+)$/, 'Complete: $1'],
  [/^أولوية (.+)$/, '$1 priority'],
  [/^أُرسل الرد إلى بريد (.+)، ونُقلت الرسالة إلى «قيد المتابعة»\.$/, 'The reply was emailed to $1, and the message moved to “In progress”.'],
  [/^إلغاء الفاتورة (.+)؟$/, 'Cancel invoice $1?'],
  [/^ادفع (.+) بالبطاقة$/, 'Pay $1 by card'],
  [/^اعتماد دفعة (.+) وتجديد اشتراكه (.+)؟$/, 'Approve the payment from $1 and renew their subscription $2?'],
  [/^الأجر اليومي \(الشهري ÷ (\d+)\) × عدد الأيام غير المستعملة\.$/, 'Daily wage (monthly ÷ $1) × unused days.'],
  [/^الإشعارات: (\d+) غير مقروءة$/, 'Notifications: $1 unread'],
  [/^الاشتراك الشهري (.+) · مهلة السماح (.+) بعد انتهاء الاشتراك$/, 'Monthly subscription $1 · $2 grace period after it ends'],
  [/^الصورة (\d+) من (\d+): (.+)$/, 'Picture $1 of $2: $3'],
  [/^الصورة (\d+) من (\d+)$/, 'Picture $1 of $2'],
  [/^المبلغ المستلم \((.+)\)$/, 'Amount received ($1)'],
  [/^المبلغ \((.+)\)$/, 'Amount ($1)'],
  [/^المسؤول: (.+)$/, 'Assignee: $1'],
  [/^انتهى (.+) · يتوقف بعد (.+)$/, 'Ended $1 · stops after $2'],
  [/^انتهى اشتراك المكتب\. يتوقف العمل بعد (.+) إن لم يُجدَّد(.*)$/, 'The office’s subscription has ended. Work stops after $1 unless it’s renewed$2'],
  [/^انتهى في (.+)\. يعمل المكتب خلال مهلة السماح، ويتوقف بعد (.+) إن لم يُجدَّد\.$/, 'Ended on $1. The office works during the grace period and stops after $2 unless it’s renewed.'],
  [/^باقي (\d+) يوماً$/, (_, a) => `${a} day${n(a)} left`],
  [/^بطلب من (.+)$/, 'Requested by $1'],
  [/^بعد (\d+) أيام$/, (_, a) => `In ${a} day${n(a)}`],
  [/^تاريخ الحكم (.+)\. المدة (\d+) يوماً حسب (.+)\. محسوبة بأداة المهل في قضيتي، وتجب مراجعتها\.$/, 'Judgment date $1. Period: $2 days under $3. Calculated with Qadiyati’s deadline tool; please verify.'],
  [/^تسجيل دفعة — (.+)$/, 'Record payment — $1'],
  [/^حتى (.+) · بقي (.+)$/, 'Until $1 · $2 left'],
  [/^حُفظ الرد على رسالة (.+) ونُقلت إلى «قيد المتابعة»، لكن البريد غير مفعّل على الخادم فلم يُرسل\. راسله على (.+) مباشرة\.$/, 'The reply to $1 was saved and moved to “In progress”, but email isn’t enabled on the server, so it wasn’t sent. Write to $2 directly.'],
  [/^دفعة على الفاتورة (.+)$/, 'Payment on invoice $1'],
  [/^رفض طلب (.+)$/, 'Reject the request from $1'],
  [/^سجلّ الدفعات — (.+)$/, 'Payment history — $1'],
  [/^قاعة (.+)$/, 'Courtroom $1'],
  [/^قدّم الطلب (.+)$/, 'Applied $1'],
  [/^للجلسة بتاريخ (.+) · $/, 'For the hearing on $1 · '],
  [/^متأخرة (\d+) يوم$/, (_, a) => `${a} day${n(a)} overdue`],
  [/^متوقف منذ (.+)$/, 'Suspended since $1'],
  [/^محكمة (.+)$/, '$1 Court'],
  [/^مع (.+)$/, 'With $1'],
  [/^نسخ (.+)$/, 'Copy $1'],
  [/^نُقلت رسالة (.+) إلى «(.+)»\.$/, (_, a, b) => `${a}'s message moved to “${EXACT[b] ?? b}”.`],
  [/^هذا الحساب يدخل من ملف «(.+)»\.$/, (_, a) => `This account signs in from the “${EXACT[a] ?? a}” file.`],
  [/^هوية\/تسجيل: (.+)$/, 'ID/registration: $1'],
  [/^ينتهي اشتراك المكتب بعد (.+)\.$/, 'The office’s subscription ends in $1.'],
  [/^ينتهي في (.+)، بعد (.+)\.$/, 'Ends on $1, in $2.'],
  [/^(\d+) بنود$/, (_, a) => `${a} item${n(a)}`],
  // Notifications: written by the server in Arabic and stored, so old ones translate too.
  [/^رقم ([\d/\\-]+)$/, 'No. $1'],
  [/^«(.+)»$/, '“$1”'],
  [/^أصبحت حالة قضيتك (.+): (.+)\.$/, 'Your case $1 is now: $2.'],
  [/^أصبحت حالة القضية (.+): (.+)\.$/, 'Case $1 is now: $2.'],
  [/^أُضيفت ملاحظة جديدة على القضية (.+)\.$/, 'A new note was added to case $1.'],
  [/^كتب مكتبك تحديثاً جديداً على قضيتك (.+)\.$/, 'Your office wrote a new update on your case $1.'],
  [/^رُفع مستند جديد إلى القضية (.+)\.$/, 'A new document was uploaded to case $1.'],
  [/^شارك مكتبك معك مستنداً جديداً في قضيتك (.+)\.$/, 'Your office shared a new document with you in your case $1.'],
  [/^أُسندت إليك القضية (.+)\.$/, 'Case $1 was assigned to you.'],
  [/^أضاف مكتبك القضية (.+) إلى حسابك، ويمكنك متابعتها من بوابتك\.$/, 'Your office added case $1 to your account; you can follow it from your portal.'],
  [/^وصلتك رسالة جديدة من (.+)\.$/, 'You have a new message from $1.'],
  [/^سُجّلت دفعة اشتراك لمكتبك، والاشتراك فعّال(?: حتى (.+))?\.$/, (_, until) => `A subscription payment was recorded for your office; the subscription is active${until ? ` until ${translate(until)}` : ''}.`],
  [/^دفع (.+) اشتراكه إلكترونياً(?: حتى (.+))?\.$/, (_, who, until) => `${translate(who)} paid their subscription online${until ? ` until ${translate(until)}` : ''}.`],
  [/^ينتهي اشتراك مكتبك في (.+)\. جدّده قبل ذلك حتى لا يتوقف عمل المكتب بعد انتهاء مهلة السماح\.$/, 'Your office’s subscription ends on $1. Renew it before then so the office doesn’t stop after the grace period.'],
  [/^أرسل (.+) طلب دفع اشتراك \((.+)\) بقيمة (.+)\. راجعه واعتمده أو ارفضه\.$/, '$1 sent a subscription payment request ($2) for $3. Review it, then approve or reject it.'],
  [/^أرسل (.+) رسالة إلى إدارة المنصّة(?: \((.+)\))? من نافذة المساعدة\.$/, (_, who, topic) => `${translate(who)} sent a message to the platform team${topic ? ` (${translate(topic)})` : ''} from the help window.`],
  // The reason is what the platform team typed: shown as written.
  [/^رفضت إدارة المنصّة طلب دفع الاشتراك\. السبب: (.+)$/, (_, reason) => `The platform team rejected the subscription payment request. Reason: ${reason}`],
  [/^قُبلت دعوة وانضمّ عضو جديد إلى مكتبك بصفة (.+)\.$/, 'An invitation was accepted: a new member joined your office as $1.'],
  [/^سُجّل مكتب جديد باسم «(.+)» وينتظر قرارك\.$/, 'A new office, “$1”, registered and is awaiting your decision.'],
  [/^(.+) — قضيتي$/, '$1 — Qadiyati'],
  // Dates written by the server ("26 تشرين الثاني 2026").
  [/^(\d{1,2}) (كانون الثاني|شباط|آذار|نيسان|أيار|حزيران|تموز|آب|أيلول|تشرين الأول|تشرين الثاني|كانون الأول) (\d{4})$/, (_, day, month, year) => `${day} ${MONTHS[month]} ${year}`],
  [/^(.+) — (.+)$/, (_, a, b) => `${translate(a)} — ${translate(b)}`],
  [/^(.+)، (.+)$/, (_, a, b) => `${translate(a)}, ${translate(b)}`],
  // An office decision is sent as "<office name>: <decision>".
  [/^([^:]+): (.+)$/, (_, a, b) => `${a}: ${translate(b)}`],
]

const MONTHS: Record<string, string> = {
  'كانون الثاني': 'January', شباط: 'February', آذار: 'March', نيسان: 'April', أيار: 'May', حزيران: 'June',
  تموز: 'July', آب: 'August', أيلول: 'September', 'تشرين الأول': 'October', 'تشرين الثاني': 'November', 'كانون الأول': 'December',
}

/** Short weekday headers of the calendar (its narrow layout cuts the Arabic names). */
const SHORT_DAYS: Record<string, string> = { سب: 'Sat', أح: 'Sun', اث: 'Mon', ثل: 'Tue', أر: 'Wed', خم: 'Thu', جم: 'Fri' }

/** English for one Arabic text, or the text itself when there's nothing to translate. */
export function translate(text: string): string {
  if (!ARABIC.test(text)) return text
  const core = text.replace(/\s+/g, ' ').trim()
  let english: string | undefined = EXACT[core] ?? SHORT_DAYS[core]
  if (english === undefined) {
    for (const [pattern, replacement] of PATTERNS) {
      const match = core.match(pattern)
      if (!match) continue
      // The variable parts are translated too when they are known texts (labels, statuses);
      // names and other records have no entry and come through as written.
      english =
        typeof replacement === 'string'
          ? replacement.replace(/\$(\d)/g, (_, index: string) => translate(match[Number(index)] ?? ''))
          : replacement(...(match as unknown as string[]))
      break
    }
  }
  if (english === undefined) return text
  // Keep the spacing around the text, which separates it from its neighbours.
  const lead = /^\s/.test(text) ? ' ' : ''
  const trail = /\s$/.test(text) ? ' ' : ''
  return lead + english + trail
}

const ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt'] as const
const SKIP = 'script, style, textarea, [contenteditable="true"], [data-no-translate]'

function translateElement(element: Element) {
  if (element.closest(SKIP)) return
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (value && ARABIC.test(value)) {
      const english = translate(value)
      if (english !== value) element.setAttribute(name, english)
    }
  }
}

function translateText(node: Text) {
  const parent = node.parentElement
  if (!parent || parent.closest(SKIP)) return
  const value = node.nodeValue ?? ''
  if (!ARABIC.test(value)) return
  const english = translate(value)
  if (english !== value) node.nodeValue = english
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text)
  if (root.nodeType !== Node.ELEMENT_NODE) return
  translateElement(root as Element)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node as Text)
    else translateElement(node as Element)
  }
}

/** Starts translating the page into English, now and as it changes. Does nothing in Arabic. */
export function startTranslation() {
  if (!IS_EN) return
  translateTree(document.body)
  document.title = translate(document.title)
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateText(mutation.target as Text)
      else if (mutation.type === 'attributes') translateElement(mutation.target as Element)
      else mutation.addedNodes.forEach(translateTree)
    }
    if (ARABIC.test(document.title)) document.title = translate(document.title)
  }).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  })
}
