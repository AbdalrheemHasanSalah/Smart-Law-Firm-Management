import {
  Briefcase,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  ListChecks,
  MessagesSquare,
  Receipt,
  Scale,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion, useScroll, useSpring, useTransform } from 'motion/react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { PATHS } from '@/auth/auth'
import type { Portal } from '@/lib/types'
import { PhotoBackdrop, Slideshow } from '@/ui/Slideshow'
import { buttonClass, cn, Logo, Marker, SlideIn, Stamp } from '@/ui/kit'

/* ───────────────────────── header ───────────────────────── */

const NAV = [
  ['#features', 'ما في النظام'],
  ['#roles', 'الأدوار'],
  ['#steps', 'كيف تبدأ'],
  ['#faq', 'أسئلة شائعة'],
] as const

/** The only place with the sign-in and register buttons, always in reach while scrolling. */
const Header = () => {
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24 })
  return (
    <header className="sticky top-0 z-40 border-b border-paper/10 bg-desk-deep/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link to={PATHS.home} aria-label="قضيتي — الرئيسية">
          <Logo onDesk />
        </Link>
        <nav aria-label="أقسام الصفحة" className="hidden items-center gap-7 text-sm text-paper/80 md:flex">
          {NAV.map(([href, label]) => (
            <a key={href} href={href} className="transition-colors hover:text-paper">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to={PATHS.login} className={buttonClass('paperline', 'sm')}>
            تسجيل الدخول
          </Link>
          <Link to={PATHS.register} className={buttonClass('stamp', 'sm')}>
            سجّل مكتبك
          </Link>
        </div>
      </div>
      {/* reading progress: a red thread along the edge */}
      <motion.div style={{ scaleX: progress }} className="h-[3px] origin-right bg-stamp" />
    </header>
  )
}

/* ───────────────────────── hero ───────────────────────── */

const rise = { hidden: { opacity: 0, y: 24 }, shown: { opacity: 1, y: 0 } }

const PROMISES = ['بيانات كل مكتب معزولة عن غيره', 'صلاحيات حسب دور كل عضو', 'بوابة خاصة لكل موكّل']

const Hero = () => (
  <section className="desk relative overflow-hidden">
    <Slideshow />
    <div className="relative z-10 mx-auto flex min-h-[32rem] max-w-6xl items-center px-5 pt-12 pb-24 lg:min-h-[36rem]">
      <motion.div
        initial="hidden"
        animate="shown"
        variants={{ shown: { transition: { staggerChildren: 0.12 } } }}
        className="max-w-xl"
      >
        <motion.p variants={rise} className="inline-block rounded-full border border-paper/30 bg-desk/40 px-4 py-1.5 text-xs font-semibold text-paper backdrop-blur-sm">
          نظام إدارة مكاتب المحاماة
        </motion.p>
        <motion.h1 variants={rise} className="mt-5 text-[2.5rem] text-paper sm:text-5xl lg:text-[3.4rem]">
          كل ما يخصّ القضية،
          <br />
          في <span className="marker" data-on="true">مكان واحد</span>.
        </motion.h1>
        <motion.p variants={rise} className="mt-4 max-w-lg leading-relaxed text-paper/80">
          قضيتي يجمع عمل مكتب المحاماة في نظام واحد: ملفات القضايا وأطرافها، جلسات المحاكم ومواعيد
          الموكّلين، المستندات والعقود، مهام الفريق، والفواتير. صاحب المكتب يرى كل شيء، والمحامي يرى
          قضاياه، والموكّل يتابع قضيته من بوابته.
        </motion.p>
        <motion.ul variants={rise} className="mt-6 space-y-2">
          {PROMISES.map((promise) => (
            <li key={promise} className="flex items-center gap-2.5 text-sm text-paper">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-stamp">
                <Check className="size-3" strokeWidth={3} aria-hidden="true" />
              </span>
              {promise}
            </li>
          ))}
        </motion.ul>
      </motion.div>
    </div>
  </section>
)

/* ───────────────────────── features ───────────────────────── */

const FEATURES: { icon: LucideIcon; title: string; body: string; points: string[] }[] = [
  {
    icon: Briefcase,
    title: 'القضايا',
    body: 'ملف كامل لكل قضية من فتحها حتى إغلاقها.',
    points: ['رقم القضية ونوعها ومحكمتها', 'الأطراف والفريق المسند إليها', 'حالتها وأولويتها وملاحظاتها'],
  },
  {
    icon: Users,
    title: 'الموكّلون',
    body: 'سجلّ لكل موكّل، فرداً كان أو شركة.',
    points: ['بيانات التواصل والعنوان', 'قضاياه وعقوده في مكان واحد', 'ربط حسابه ببوابة الموكّل'],
  },
  {
    icon: CalendarDays,
    title: 'الجلسات والمواعيد',
    body: 'جدول واحد لجلسات المحاكم ومواعيد المكتب.',
    points: ['موعد الجلسة ومحكمتها وقاعتها', 'نتيجة كل جلسة بعد انعقادها', 'مواعيد الموكّلين والأطراف الأخرى'],
  },
  {
    icon: FileText,
    title: 'المستندات والعقود',
    body: 'اللوائح والعقود والوكالات محفوظة داخل قضيتها.',
    points: ['رفع ملفات PDF وتنزيلها', 'تحديد من يرى كل مستند', 'متابعة حالة العقد حتى توقيعه'],
  },
  {
    icon: ListChecks,
    title: 'المهام',
    body: 'يعرف كل عضو ما المطلوب منه اليوم.',
    points: ['مهمة لها صاحب وموعد إنجاز', 'أولوية من منخفضة إلى عاجلة', 'ربط المهمة بقضيتها'],
  },
  {
    icon: Receipt,
    title: 'الفواتير والمدفوعات',
    body: 'حساب كل موكّل واضح للمكتب وله.',
    points: ['فاتورة لكل موكّل أو قضية', 'تسجيل كل دفعة على فاتورتها', 'ما سُدّد وما بقي في أي وقت'],
  },
  {
    icon: MessagesSquare,
    title: 'الرسائل والإشعارات',
    body: 'تواصل المكتب مع موكّليه داخل النظام.',
    points: ['مراسلة بين المحامي وموكّله', 'تنبيه عند كل تحديث على القضية', 'تذكير بالجلسات والمواعيد القريبة'],
  },
]

const Features = () => (
  <section id="features" className="scroll-mt-16 bg-paper-shade px-5 py-16">
    <div className="mx-auto max-w-6xl">
      <h2 className="text-3xl text-ink sm:text-4xl">
        ما الذي تجده في <Marker>قضيتي</Marker>؟
      </h2>
      <p className="mt-2 max-w-xl text-ink-soft">سبعة أقسام تغطي يوم المكتب كله، وكل قسم مرتبط بالآخر.</p>
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body, points }, index) => (
          <li key={title} className={cn(index === FEATURES.length - 1 && 'sm:col-span-2 lg:col-span-3')}>
            <SlideIn delay={(index % 3) * 0.08} className="h-full">
              <article className="group relative h-full overflow-hidden rounded-lg border border-ink/10 bg-paper p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1.5 hover:shadow-paper">
                {/* a red line drawn across the top on hover */}
                <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 origin-right scale-x-0 bg-stamp transition-transform duration-500 ease-smooth group-hover:scale-x-100" />
                <span className="grid size-11 place-items-center rounded-lg bg-desk text-paper transition-colors duration-300 group-hover:bg-stamp">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-2xl text-ink">{title}</h3>
                <p className="mt-1 text-sm text-ink-soft">{body}</p>
                <ul className="mt-4 space-y-1.5 border-t border-ink/10 pt-4">
                  {points.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm text-ink">
                      <Check className="mt-0.5 size-4 shrink-0 text-stamp" aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            </SlideIn>
          </li>
        ))}
      </ul>
    </div>
  </section>
)

/* ───────────────────────── roles ───────────────────────── */

const ROLES: { name: string; body: string; icon: LucideIcon; tab: string; portal: Portal; can: string[] }[] = [
  {
    name: 'صاحب المكتب',
    body: 'يدير المكتب كله.',
    icon: Building2,
    tab: 'bg-stamp text-paper',
    portal: 'owner',
    can: ['يدعو المحامين والموكّلين', 'يفتح القضايا ويسندها للفريق', 'يوزّع المهام ويتابع إنجازها', 'يتابع الفواتير والمدفوعات'],
  },
  {
    name: 'المحامي',
    body: 'يعمل على القضايا المسندة إليه.',
    icon: Scale,
    tab: 'bg-stamp-blue text-paper',
    portal: 'staff',
    can: ['يحدّث حالة قضاياه وملاحظاتها', 'يرفع المستندات والعقود', 'ينجز مهامه في مواعيدها', 'يراسل موكّليه'],
  },
  {
    name: 'الموكّل',
    body: 'يتابع قضيته دون اتصال هاتفي.',
    icon: UserRound,
    tab: 'bg-stamp-green text-paper',
    portal: 'client',
    can: ['يرى حالة قضيته وآخر تحديث', 'يطّلع على ما شاركه المكتب معه', 'يعرف مواعيد جلساته', 'يرى فواتيره وما سدّده'],
  },
]

const Roles = () => (
  <section id="roles" className="desk relative scroll-mt-16 px-5 py-16">
    <PhotoBackdrop photo={2} />
    <div className="relative z-10 mx-auto max-w-6xl">
      <h2 className="text-3xl text-paper sm:text-4xl">ثلاثة أدوار، وكلٌّ يرى ما يخصّه.</h2>
      <p className="mt-2 max-w-xl text-paper/70">الصلاحيات يحدّدها الدور، فلا يطّلع أحد على ما ليس له.</p>
      <ul className="mt-14 grid gap-x-6 gap-y-14 md:grid-cols-3">
        {ROLES.map(({ name, body, icon: Icon, tab, portal, can }, index) => (
          <li key={name}>
            <SlideIn delay={index * 0.1} className="relative h-full">
              <span className={cn('tab-cut absolute -top-8 right-5 flex h-8 w-36 items-center justify-center rounded-t-md text-sm font-semibold', tab)}>
                {name}
              </span>
              <article className="flex h-full flex-col rounded-lg bg-paper p-6 shadow-paper transition-transform duration-300 hover:-translate-y-1.5">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-full bg-paper-shade text-ink">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <p className="font-semibold text-ink">{body}</p>
                </div>
                <ul className="mt-4 flex-1 space-y-2">
                  {can.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-ink-soft">
                      <Check className="mt-0.5 size-4 shrink-0 text-stamp" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link to={PATHS.loginOf(portal)} className="mt-5 text-sm font-semibold text-stamp underline-offset-4 hover:underline">
                  صفحة دخول {name} ←
                </Link>
              </article>
            </SlideIn>
          </li>
        ))}
      </ul>
    </div>
  </section>
)

/* ───────────────────────── steps ───────────────────────── */

const STEPS = [
  { title: 'تسجّل مكتبك', body: 'تنشئ حسابك وتكتب اسم المكتب ومدينته وهاتفه ورقم عضويتك في النقابة.', stamp: 'وارد', tone: 'blue' as const },
  { title: 'يُراجَع الطلب', body: 'نتحقق من البيانات ونعتمد المكتب. حتى ذلك الحين يبقى الطلب «قيد المراجعة».', stamp: 'مُعتمد', tone: 'red' as const },
  { title: 'تدعو فريقك وموكّليك', body: 'ترسل رابط دعوة لكل محامٍ وموكّل. الرابط صالح أسبوعاً ويُستخدم مرة واحدة.', stamp: 'مفتوح', tone: 'green' as const },
]

/** Three steps; a red thread is drawn between them as the section is scrolled. */
const Steps = () => {
  const ref = useRef<HTMLOListElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.6'] })
  const thread = useTransform(scrollYProgress, [0, 1], [0, 1])
  return (
    <section id="steps" className="scroll-mt-16 bg-paper-shade px-5 py-16">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl text-ink sm:text-4xl">
          من الطلب إلى <Marker>أول قضية</Marker>.
        </h2>
        <ol ref={ref} className="relative mt-12 grid gap-8 md:grid-cols-3">
          <motion.span aria-hidden="true" style={{ scaleX: thread }} className="absolute inset-x-0 top-9 hidden h-0.5 origin-right bg-stamp md:block" />
          {STEPS.map(({ title, body, stamp, tone }, index) => (
            <li key={title} className="relative">
              <SlideIn delay={index * 0.15} className="h-full">
                <div className="relative h-full rounded-lg bg-paper p-6 pt-8 shadow-paper">
                  <span className="absolute -top-4 right-6 grid size-9 place-items-center rounded-full bg-ink font-doc text-xl font-bold text-paper">
                    {index + 1}
                  </span>
                  <h3 className="text-2xl text-ink">{title}</h3>
                  <p className="mt-2 min-h-18 leading-relaxed text-ink-soft">{body}</p>
                  <Stamp slam="view" tone={tone} delay={0.35 + index * 0.25} className="mt-3 text-lg">
                    {stamp}
                  </Stamp>
                </div>
              </SlideIn>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ───────────────────────── questions ───────────────────────── */

const FAQ = [
  {
    q: 'هل ترى المكاتب الأخرى بيانات مكتبي؟',
    a: 'لا. كل مكتب معزول تماماً: قضاياه وموكّلوه ومستنداته لا تظهر إلا لأعضائه، والعزل مطبّق في قاعدة البيانات نفسها لا في الواجهة فقط.',
  },
  {
    q: 'كيف ينضمّ المحامون والموكّلون إلى مكتبي؟',
    a: 'برابط دعوة يرسله صاحب المكتب إلى بريدهم. لا يستطيع أحد الانضمام إلى مكتبك من تلقاء نفسه، والرابط لا يعمل إلا للبريد الذي أُرسل إليه.',
  },
  {
    q: 'ماذا يرى الموكّل بالضبط؟',
    a: 'قضاياه هو فقط، والتحديثات التي يختار المكتب إظهارها له، والمستندات التي شاركها المكتب معه. الملاحظات الداخلية للفريق لا تظهر له أبداً.',
  },
  {
    q: 'من يحدّد من يرى المستند؟',
    a: 'من يرفعه. لكل مستند مستوى وصول: مقيّد، أو لفريق القضية، أو مشارَك مع الموكّل.',
  },
  {
    q: 'هل يستطيع الشخص نفسه العمل في أكثر من مكتب؟',
    a: 'نعم. الحساب واحد، ويختار المكتب الذي يعمل عليه بعد الدخول، ولكل مكتب صلاحياته المستقلة.',
  },
]

const Questions = () => {
  const [open, setOpen] = useState(0)
  return (
    <section id="faq" className="desk relative scroll-mt-16 px-5 py-16">
      <PhotoBackdrop photo={1} strength={0.22} />
      <div className="relative z-10 mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
        <div>
          <h2 className="text-3xl text-paper sm:text-4xl">أسئلة تُطرح قبل التسجيل.</h2>
          <p className="mt-2 text-paper/70">عن الخصوصية والصلاحيات وطريقة الانضمام.</p>
        </div>
        <ul className="space-y-3">
          {FAQ.map(({ q, a }, index) => {
            const isOpen = open === index
            return (
              <li key={q} className="overflow-hidden rounded-lg bg-paper">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? -1 : index)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start font-semibold text-ink"
                >
                  {q}
                  <ChevronDown className={cn('size-5 shrink-0 text-stamp transition-transform duration-300', isOpen && 'rotate-180')} aria-hidden="true" />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <p className="border-t border-ink/10 px-5 py-4 leading-relaxed text-ink-soft">{a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

/* ───────────────────────── footer ───────────────────────── */

const Footer = () => (
  <footer className="bg-desk-deep px-5 py-8">
    <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-paper/60">
      <Logo onDesk />
      <nav aria-label="روابط التذييل" className="flex flex-wrap gap-5">
        {NAV.map(([href, label]) => (
          <a key={href} href={href} className="transition-colors hover:text-paper">
            {label}
          </a>
        ))}
      </nav>
      <p>© {new Date().getFullYear()} قضيتي. جميع الحقوق محفوظة.</p>
    </div>
  </footer>
)

const Landing = () => (
  <div className="min-h-dvh">
    <Header />
    <main>
      <Hero />
      <Features />
      <Roles />
      <Steps />
      <Questions />
    </main>
    <Footer />
  </div>
)

export default Landing
