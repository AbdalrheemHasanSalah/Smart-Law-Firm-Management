/**
 * Built-in skeletons for contracts, pleadings and letters: the sections a document of the kind
 * usually has, with fields filled from the case ({{client_name}}…) and gaps the lawyer completes
 * by hand ([…]). They hold no legal text, article numbers or clauses of their own: a lawyer writes
 * the substance and reviews every draft before it is used.
 *
 * Fields (also usable in an office's own templates):
 *   {{client_name}} {{client_national_id}} {{client_address}} {{client_phone}}
 *   {{opponent_name}} {{opponent_national_id}}
 *   {{case_number}} {{case_title}} {{court_name}}
 *   {{office_name}} {{lawyer_name}} {{today}}
 */

export const TEMPLATE_FIELDS = [
  'client_name', 'client_national_id', 'client_address', 'client_phone',
  'opponent_name', 'opponent_national_id',
  'case_number', 'case_title', 'court_name',
  'office_name', 'lawyer_name', 'today',
];

const REVIEW_NOTE = '[هيكل للمراجعة: أكمل ما بين الأقواس المربعة واكتب البنود بما يناسب الحالة، وراجع المسودة كاملة قبل استعمالها.]';

const parties = (first, second) => `الفريق الأول (${first}): {{client_name}}، رقم الهوية {{client_national_id}}، العنوان: {{client_address}}.
الفريق الثاني (${second}): [الاسم]، رقم الهوية [الرقم]، العنوان: [العنوان].`;

const contract = (title, first, second, articles) => `${title}

${REVIEW_NOTE}

إنه في يوم {{today}} تم الاتفاق بين كل من:
${parties(first, second)}

${articles.map((article, index) => `المادة (${index + 1}): ${article}
[…]`).join('\n\n')}

التوقيعات:
الفريق الأول: ………………        الفريق الثاني: ………………
الشهود: ………………        ………………`;

const BUILTIN = [
  {
    key: 'contract_sale',
    kind: 'contract',
    title: 'عقد بيع',
    body: contract('عقد بيع', 'البائع', 'المشتري', ['التمهيد ويُعدّ جزءاً من العقد', 'المبيع وأوصافه', 'الثمن وطريقة دفعه', 'التسليم وموعده ومكانه', 'التزامات البائع', 'التزامات المشتري', 'نقل الملكية والتسجيل', 'الإخلال بالعقد', 'حل النزاعات والاختصاص', 'نسخ العقد']),
  },
  {
    key: 'contract_lease',
    kind: 'contract',
    title: 'عقد إيجار',
    body: contract('عقد إيجار', 'المؤجر', 'المستأجر', ['التمهيد', 'المأجور وأوصافه', 'مدة الإيجار وبدايتها', 'الأجرة وطريقة دفعها', 'التأمين', 'الصيانة والإصلاحات', 'استعمال المأجور والتأجير من الباطن', 'إنهاء العقد وتسليم المأجور', 'حل النزاعات والاختصاص']),
  },
  {
    key: 'contract_employment',
    kind: 'contract',
    title: 'عقد عمل',
    body: contract('عقد عمل', 'صاحب العمل', 'العامل', ['طبيعة العمل والمسمى الوظيفي', 'مكان العمل', 'مدة العقد وفترة التجربة', 'الأجر وموعد دفعه', 'ساعات العمل والإجازات', 'التزامات صاحب العمل', 'التزامات العامل', 'إنهاء العقد والإشعار', 'حل النزاعات']),
  },
  {
    key: 'contract_agency',
    kind: 'contract',
    title: 'عقد وكالة أو تفويض',
    body: contract('عقد وكالة', 'الموكّل', 'الوكيل', ['موضوع الوكالة وحدودها', 'صلاحيات الوكيل', 'مدة الوكالة', 'الأجر إن وُجد', 'التزامات الوكيل وتقديم الحساب', 'عزل الوكيل وتنحيه', 'حل النزاعات']),
  },
  {
    key: 'contract_partnership',
    kind: 'contract',
    title: 'عقد شراكة',
    body: contract('عقد شراكة', 'الشريك الأول', 'الشريك الثاني', ['اسم الشراكة وغرضها', 'رأس المال وحصة كل شريك', 'إدارة الشراكة والصلاحيات', 'توزيع الأرباح والخسائر', 'السجلات والحسابات', 'انسحاب شريك أو انضمام آخر', 'حل الشراكة وتصفيتها', 'حل النزاعات']),
  },
  {
    key: 'contract_contracting',
    kind: 'contract',
    title: 'عقد مقاولة',
    body: contract('عقد مقاولة', 'صاحب العمل', 'المقاول', ['موضوع المقاولة والمخططات والمواصفات', 'المواد ومن يوفّرها', 'قيمة المقاولة ودفعاتها', 'مدة التنفيذ والتأخير', 'الإشراف والاستلام', 'الضمان', 'التعديلات والأعمال الإضافية', 'فسخ العقد', 'حل النزاعات']),
  },
  {
    key: 'contract_settlement',
    kind: 'contract',
    title: 'اتفاقية تسوية',
    body: contract('اتفاقية تسوية', 'الطرف الأول', 'الطرف الثاني', ['موضوع النزاع وتاريخه', 'مبلغ التسوية أو موضوعها', 'طريقة الدفع والأقساط', 'إسقاط الدعاوى والمطالبات', 'الإخلال بالاتفاقية', 'السرية', 'التوقيع والنفاذ']),
  },
  {
    key: 'contract_loan',
    kind: 'contract',
    title: 'عقد قرض',
    body: contract('عقد قرض', 'المقرض', 'المقترض', ['مبلغ القرض وعملته', 'تسليم المبلغ', 'السداد ومواعيده', 'الضمانات', 'التأخر في السداد', 'حل النزاعات']),
  },
  {
    key: 'pleading_claim',
    kind: 'pleading',
    title: 'لائحة دعوى',
    body: `لدى {{court_name}} الموقرة

${REVIEW_NOTE}

المدّعي: {{client_name}}، رقم الهوية {{client_national_id}}، العنوان: {{client_address}}.
وكيله: {{lawyer_name}} — {{office_name}}.

المدّعى عليه: {{opponent_name}}، رقم الهوية {{opponent_national_id}}، العنوان: [العنوان].

موضوع الدعوى: [الموضوع].
قيمة الدعوى: [القيمة].

الوقائع:
1. […]
2. […]

الأسانيد القانونية:
[تُذكر من نصوص المكتبة القانونية بعد التحقق من سريانها.]

البيّنات:
[…]

الطلبات:
لكل ما تقدّم، يلتمس المدّعي من المحكمة الموقرة:
1. […]
2. تضمين المدّعى عليه الرسوم والمصاريف وأتعاب المحاماة.

وتفضلوا بقبول فائق الاحترام،
وكيل المدّعي
{{today}}`,
  },
  {
    key: 'pleading_reply',
    kind: 'pleading',
    title: 'لائحة جوابية',
    body: `لدى {{court_name}} الموقرة
في الدعوى رقم {{case_number}}

${REVIEW_NOTE}

المدّعى عليه (المستجيب): {{client_name}}، وكيله: {{lawyer_name}}.
المدّعي: {{opponent_name}}.

أولاً: الدفوع الشكلية:
1. […]

ثانياً: الرد على الوقائع:
1. ينكر المدّعى عليه ما ورد في البند […] من لائحة الدعوى، والصحيح […].

ثالثاً: الدفوع الموضوعية:
1. […]

البيّنات:
[…]

الطلبات:
لكل ما تقدّم، يلتمس المدّعى عليه ردّ الدعوى وتضمين المدّعي الرسوم والمصاريف وأتعاب المحاماة.

وكيل المدّعى عليه
{{today}}`,
  },
  {
    key: 'letter_notice',
    kind: 'letter',
    title: 'كتاب إنذار',
    body: `التاريخ: {{today}}

${REVIEW_NOTE}

إلى: {{opponent_name}}
العنوان: [العنوان]

الموضوع: إنذار

بالوكالة عن موكّلنا {{client_name}}، نُنذركم بما يلي:
1. […]
2. […]

ونطلب منكم […] خلال مدة [المدة] من تاريخ تبلّغكم هذا الإنذار، وإلا سنضطر إلى اتخاذ الإجراءات القانونية اللازمة دون إنذار آخر.

{{lawyer_name}}
{{office_name}}`,
  },
];

export const BUILTIN_TEMPLATES = Object.freeze(BUILTIN.map((template) => Object.freeze({ ...template, builtin: true })));

export const builtinTemplate = (key) => BUILTIN_TEMPLATES.find((template) => template.key === key) ?? null;

/** The template with its fields replaced; a field with no value is left as a gap to fill. */
export function fillTemplate(body, values) {
  return body.replace(/\{\{([a-z_]+)\}\}/g, (match, field) => {
    if (!TEMPLATE_FIELDS.includes(field)) return match;
    const value = values[field];
    return typeof value === 'string' && value.trim() ? value.trim() : '[…]';
  });
}
