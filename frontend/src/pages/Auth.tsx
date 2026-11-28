import { Building2, Scale, UserRound, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { homeOf, PATHS, useAuth, usableOffices } from '@/auth/auth'
import { api, ApiError, DEMO, messageOf } from '@/lib/api'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/lib/demo'
import type { Portal } from '@/lib/types'
import { Slideshow } from '@/ui/Slideshow'
import { Button, buttonClass, cn, Field, Logo, PaperClip, Stamp } from '@/ui/kit'
import { PreferenceControls } from '@/ui/Preferences'

/* ───────────────────────── shared desk ───────────────────────── */

const AuthDesk = ({ children }: { children: ReactNode }) => (
  <div className="desk relative flex min-h-dvh flex-col">
    <Slideshow controls={false} />
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
      <Link to={PATHS.home} aria-label="قضيتي — الرئيسية">
        <Logo onDesk />
      </Link>
      <div className="flex items-center gap-3">
        <PreferenceControls onDesk />
        <Link to={PATHS.home} className="text-sm text-paper/70 transition-colors hover:text-paper">
          العودة للرئيسية
        </Link>
      </div>
    </header>
    <main className="relative z-10 flex flex-1 items-center justify-center px-5 pt-6 pb-16">{children}</main>
  </div>
)

const PORTALS: Record<Portal, { name: string; title: string; body: string; icon: LucideIcon; tab: string; formTitle: string }> = {
  owner: {
    name: 'صاحب مكتب',
    title: 'إدارة مكتبك وفريقك',
    body: 'لأصحاب المكاتب ومدير المنصّة.',
    icon: Building2,
    tab: 'bg-stamp text-paper',
    formTitle: 'دخول صاحب المكتب',
  },
  staff: {
    name: 'محامٍ أو مساعد',
    title: 'العمل على قضاياك',
    body: 'لأعضاء المكتب الذين انضمّوا بدعوة.',
    icon: Scale,
    tab: 'bg-stamp-blue text-paper',
    formTitle: 'دخول فريق المكتب',
  },
  client: {
    name: 'موكّل',
    title: 'متابعة قضيتك',
    body: 'لموكّلي المكتب.',
    icon: UserRound,
    tab: 'bg-stamp-green text-paper',
    formTitle: 'دخول الموكّلين',
  },
}
const PORTAL_KEYS = ['owner', 'staff', 'client'] as const
const isPortal = (value: unknown): value is Portal => PORTAL_KEYS.includes(value as Portal)

/* ───────────────────────── chooser: the file drawer ───────────────────────── */

/** Three folders standing in a drawer. Each one rises when pointed at and opens its sign-in form. */
export const LoginChooser = () => (
  <AuthDesk>
    <div className="w-full max-w-4xl">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <h1 className="text-4xl text-paper">أيّ ملف تفتح؟</h1>
        <p className="mt-2 text-paper/70">اختر ما يصفك لتصل إلى نموذج الدخول المناسب.</p>
      </motion.div>

      <ul className="mt-20 grid gap-x-6 gap-y-16 sm:grid-cols-3">
        {PORTAL_KEYS.map((key, index) => {
          const { name, title, body, icon: Icon, tab } = PORTALS[key]
          return (
            <motion.li
              key={key}
              initial={{ opacity: 0, y: 120, rotate: 0 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 80, damping: 13, delay: 0.15 + index * 0.12 }}
            >
              <Link
                to={PATHS.loginOf(key)}
                className="group relative block h-64 transition-transform duration-500 ease-spring hover:-translate-y-4 focus-visible:-translate-y-4"
              >
                <span className={cn('tab-cut absolute -top-7 right-5 flex h-8 w-36 items-center justify-center rounded-t-md text-sm font-semibold', tab)}>
                  {name}
                </span>
                <span className="manila absolute inset-0 rounded-md" />
                <span className="paper absolute inset-x-4 top-3 block h-48 p-4 transition-transform duration-500 ease-spring group-hover:-translate-y-10">
                  <span className="block font-doc text-xl font-bold text-ink">{title}</span>
                  <span className="mt-1 block text-sm text-ink-soft">{body}</span>
                </span>
                <span className="manila absolute inset-x-0 bottom-0 flex h-[58%] flex-col items-center justify-center gap-2 rounded-md">
                  <Icon className="size-11 text-ink/70" strokeWidth={1.4} aria-hidden="true" />
                  <span className="text-sm font-semibold text-ink">افتح الملف</span>
                </span>
              </Link>
            </motion.li>
          )
        })}
      </ul>

      <p className="mt-12 text-center text-sm text-paper/70">
        مكتبك غير مسجّل بعد؟{' '}
        <Link to={PATHS.register} className="font-semibold text-paper underline underline-offset-4 hover:underline">
          سجّل مكتبك
        </Link>
        <span className="mt-1 block">المحامون والموكّلون ينضمّون برابط دعوة من صاحب المكتب.</span>
      </p>
    </div>
  </AuthDesk>
)

/* ───────────────────────── the paper form ───────────────────────── */

type Verdict = { kind: 'ok' | 'no'; text: string } | null

/** A form sheet clipped inside a manila folder. The verdict stamp lands on it after submitting. */
const FormSheet = ({
  tab,
  tabClass = 'manila text-ink',
  title,
  subtitle,
  verdict,
  children,
  wide = false,
}: {
  tab: string
  tabClass?: string
  title: string
  subtitle?: string
  verdict: Verdict
  children: ReactNode
  wide?: boolean
}) => (
  <motion.div
    initial={{ opacity: 0, y: 70, rotate: 0 }}
    animate={{ opacity: 1, y: 0, rotate: 0 }}
    transition={{ type: 'spring', stiffness: 85, damping: 14 }}
    className={cn('relative w-full', wide ? 'max-w-2xl' : 'max-w-md')}
  >
    <span className={cn('tab-cut absolute -top-8 right-8 flex h-9 w-40 items-center justify-center rounded-t-md text-sm font-semibold', tabClass)}>
      {tab}
    </span>
    <div className="manila rounded-md p-3 sm:p-4">
      <div
        key={verdict?.kind === 'no' ? verdict.text : 'sheet'}
        className={cn('paper relative px-6 py-8 sm:px-9', verdict?.kind === 'no' && 'animate-[shake_0.45s]')}
      >
        <PaperClip className="absolute -top-5 left-8 h-14" />
        <h1 className="text-3xl text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        <AnimatePresence>
          {verdict && (
            <Stamp
              key={verdict.text}
              slam="mount"
              tone={verdict.kind === 'ok' ? 'green' : 'red'}
              rotate={verdict.kind === 'ok' ? -4 : 4}
              className="pointer-events-none absolute top-6 left-16 text-2xl"
            >
              {verdict.kind === 'ok' ? 'مُصرّح بالدخول' : 'مرفوض'}
            </Stamp>
          )}
        </AnimatePresence>
        {verdict?.kind === 'no' && (
          <p role="alert" className="mt-5 border-s-4 border-stamp bg-stamp/8 px-3 py-2 text-sm text-stamp">
            {verdict.text}
          </p>
        )}
      </div>
    </div>
  </motion.div>
)

/* ───────────────────────── sign in ───────────────────────── */

export const Login = () => {
  const { portal } = useParams()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<Verdict>(null)

  if (!isPortal(portal)) return <Navigate to={PATHS.login} replace />
  const { formTitle, name, tab } = PORTALS[portal]

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password) {
      setVerdict({ kind: 'no', text: 'اكتب البريد الإلكتروني وكلمة المرور.' })
      return
    }
    setBusy(true)
    setVerdict(null)
    try {
      const session = await login({ email: email.trim(), password, remember, portal })
      setVerdict({ kind: 'ok', text: 'ok' })
      // Let the stamp land before the page turns.
      window.setTimeout(() => void navigate(homeOf(session), { replace: true }), 900)
    } catch (error) {
      const wrong = error instanceof ApiError && error.code === 'WRONG_PORTAL'
      const allowed = wrong ? ((error.details as { portals?: Portal[] } | null)?.portals ?? []) : []
      setVerdict({
        kind: 'no',
        text: wrong && allowed[0] ? `هذا الحساب يدخل من ملف «${PORTALS[allowed[0]].name}».` : messageOf(error),
      })
      setBusy(false)
    }
  }

  const fillDemo = (address: string) => {
    setEmail(address)
    setPassword(DEMO_PASSWORD)
    setVerdict(null)
  }

  return (
    <AuthDesk>
      <div className="flex w-full max-w-3xl flex-col items-center gap-8 lg:flex-row lg:items-start lg:justify-center">
        <FormSheet tab={name} tabClass={tab} title={formTitle} subtitle="املأ النموذج ثم اختمه." verdict={verdict}>
          <form onSubmit={submit} noValidate className="space-y-5">
            <Field
              label="البريد الإلكتروني"
              name="email"
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="name@office.ps"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Field
              label="كلمة المرور"
              name="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <div className="flex items-center justify-between text-sm">
              <label className="flex cursor-pointer items-center gap-2 text-ink-soft">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="size-4 accent-ink" />
                تذكّرني على هذا الجهاز
              </label>
              <Link to={PATHS.forgot} className="font-semibold text-stamp-blue underline-offset-4 hover:underline">
                نسيت كلمة المرور؟
              </Link>
            </div>
            <Button type="submit" variant="stamp" size="lg" disabled={busy} className="w-full">
              {busy ? 'يُختم…' : 'اختم وادخل'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-soft">
            <Link to={PATHS.login} className="underline-offset-4 hover:underline">
              اختر ملفاً آخر
            </Link>
            {portal === 'owner' && (
              <>
                {' · '}
                <Link to={PATHS.register} className="font-semibold text-stamp underline-offset-4 hover:underline">
                  سجّل مكتبك
                </Link>
              </>
            )}
          </p>
        </FormSheet>

        {DEMO && (
          <motion.aside
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 180, damping: 13, delay: 0.5 }}
            className="w-56 shrink-0 border-t-4 border-stamp bg-paper p-4 shadow-paper lg:mt-10"
          >
            <p className="font-doc text-xl font-bold text-ink">وضع تجريبي</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">بيانات وهمية داخل المتصفح. اضغط لتعبئة النموذج:</p>
            <div className="mt-3 space-y-1.5">
              <button type="button" onClick={() => fillDemo(DEMO_ACCOUNTS[portal])} className="block w-full border border-ink/30 px-2 py-1.5 text-start text-xs font-semibold text-ink hover:bg-ink/5">
                {name}
              </button>
              {portal === 'staff' && (
                <button type="button" onClick={() => fillDemo(DEMO_ACCOUNTS.accountant)} className="block w-full border border-ink/30 px-2 py-1.5 text-start text-xs font-semibold text-ink hover:bg-ink/5">
                  محاسب المكتب
                </button>
              )}
              {portal === 'owner' && (
                <button type="button" onClick={() => fillDemo(DEMO_ACCOUNTS.platform)} className="block w-full border border-ink/30 px-2 py-1.5 text-start text-xs font-semibold text-ink hover:bg-ink/5">
                  مدير المنصّة
                </button>
              )}
            </div>
          </motion.aside>
        )}
      </div>
    </AuthDesk>
  )
}

/* ───────────────────────── register an office ───────────────────────── */

const EMPTY = { name: '', email: '', personalEmail: '', password: '', office: '', phone: '', city: '', license: '', bar: '' }

export const Register = () => {
  const { refresh, session } = useAuth()
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<Partial<typeof EMPTY>>({})
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<Verdict>(null)
  const [done, setDone] = useState(false)

  const bind = (key: keyof typeof EMPTY) => ({
    name: key,
    value: values[key],
    error: errors[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value })),
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const found: Partial<typeof EMPTY> = {}
    if (!session) {
      if (values.name.trim().length < 3) found.name = 'اكتب اسمك الكامل.'
      if (!/^\S+@\S+\.\S+$/.test(values.email)) found.email = 'بريد إلكتروني غير صالح.'
      if (values.password.length < 8) found.password = '8 أحرف على الأقل.'
    }
    if (values.personalEmail.trim() && !/^\S+@\S+\.\S+$/.test(values.personalEmail.trim())) found.personalEmail = 'بريد إلكتروني غير صالح.'
    if (values.office.trim().length < 3) found.office = 'اكتب اسم المكتب.'
    if (values.phone.trim().length < 7) found.phone = 'اكتب رقم الهاتف.'
    if (!values.city.trim()) found.city = 'اكتب المدينة.'
    if (!values.bar.trim()) found.bar = 'اكتب رقم النقابة.'
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    setVerdict(null)
    try {
      if (!session) {
        await api.post('/auth/sign-up/email', { name: values.name.trim(), email: values.email.trim(), password: values.password })
      }
      await api.post('/offices', {
        // The sign-in email is the office email; the server falls back to it for a signed-in owner.
        office: {
          name: values.office.trim(),
          phone: values.phone.trim(),
          city: values.city.trim(),
          ...(!session && { email: values.email.trim() }),
          ...(values.personalEmail.trim() && { personal_email: values.personalEmail.trim() }),
          ...(values.license.trim() && { license_number: values.license.trim() }),
        },
        lawyer: { bar_number: values.bar.trim() },
      })
      await refresh()
      setDone(true)
    } catch (error) {
      setVerdict({ kind: 'no', text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  if (done) return <Navigate to={PATHS.onboarding} replace />

  return (
    <AuthDesk>
      <FormSheet tab="طلب تسجيل مكتب" title="طلب تسجيل مكتب محاماة" subtitle="يراجع مدير المنصّة الطلب قبل تفعيل المكتب." verdict={verdict} wide>
        <form onSubmit={submit} noValidate>
          {!session && (
            <fieldset>
              <legend className="font-doc text-xl font-bold text-ink">أولاً: صاحب الطلب</legend>
              <div className="mt-3 grid gap-5 sm:grid-cols-2">
                <Field label="الاسم الكامل" autoComplete="name" {...bind('name')} className="sm:col-span-2" />
                <Field label="البريد الإلكتروني للمكتب" type="email" dir="ltr" autoComplete="email" hint="تدخل به، وعليه تصلك رسائل الموقع." {...bind('email')} />
                <Field label="كلمة المرور" type="password" dir="ltr" autoComplete="new-password" hint="8 أحرف على الأقل." {...bind('password')} />
              </div>
            </fieldset>
          )}
          <fieldset className={cn(!session && 'mt-8')}>
            <legend className="font-doc text-xl font-bold text-ink">{session ? 'بيانات المكتب' : 'ثانياً: المكتب'}</legend>
            <div className="mt-3 grid gap-5 sm:grid-cols-2">
              <Field label="اسم المكتب" {...bind('office')} className="sm:col-span-2" />
              <Field label="هاتف المكتب" dir="ltr" inputMode="tel" {...bind('phone')} />
              <Field label="المدينة" {...bind('city')} />
              <Field label="رقم العضوية في نقابة المحامين" dir="ltr" {...bind('bar')} />
              <Field label="رقم ترخيص المكتب (اختياري)" dir="ltr" {...bind('license')} />
              <Field label="بريد إلكتروني شخصي (اختياري)" type="email" dir="ltr" autoComplete="off" hint="للتواصل معك شخصياً عند الحاجة فقط." {...bind('personalEmail')} className="sm:col-span-2" />
            </div>
          </fieldset>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <Link to={PATHS.login} className="text-sm text-ink-soft underline-offset-4 hover:underline">
              لديّ حساب بالفعل
            </Link>
            <Button type="submit" variant="stamp" size="lg" disabled={busy}>
              {busy ? 'يُرسل…' : 'أرسل الطلب'}
            </Button>
          </div>
        </form>
      </FormSheet>
    </AuthDesk>
  )
}

/* ───────────────────────── forgot password ───────────────────────── */

export const Forgot = () => {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<Verdict>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setVerdict(null)
    try {
      await api.post('/auth/request-password-reset', { email: email.trim(), redirectTo: `${location.origin}/reset-password` })
      setSent(true)
    } catch (error) {
      setVerdict({ kind: 'no', text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthDesk>
      <FormSheet tab="استعادة الحساب" title="نسيت كلمة المرور؟" subtitle="نرسل رابط إعادة التعيين إلى بريدك." verdict={verdict}>
        {sent ? (
          <div>
            <Stamp slam="mount" tone="blue" className="text-2xl">
              أُرسل
            </Stamp>
            <p className="mt-4 leading-relaxed text-ink-soft">إن كان البريد مسجّلاً لدينا فسيصلك الرابط خلال دقائق. الرابط صالح لساعة واحدة.</p>
            <Link to={PATHS.login} className={cn(buttonClass('line'), 'mt-6')}>
              العودة للدخول
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <Field label="البريد الإلكتروني" name="email" type="email" dir="ltr" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <div className="flex items-center justify-between gap-4">
              <Link to={PATHS.login} className="text-sm text-ink-soft underline-offset-4 hover:underline">
                العودة للدخول
              </Link>
              <Button type="submit" variant="ink" disabled={busy || !email.trim()}>
                {busy ? 'يُرسل…' : 'أرسل الرابط'}
              </Button>
            </div>
          </form>
        )}
      </FormSheet>
    </AuthDesk>
  )
}

/* ───────────────────────── waiting for review ───────────────────────── */

/** Shown to a signed-in account with no usable office: the request is on the reviewer's desk. */
export const Onboarding = () => {
  const { session, logout, selectOffice } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const usable = usableOffices(session)
  const pending = session?.memberships.find((entry) => entry.office_status === 'pending')

  const enter = async (officeId: string) => {
    setBusy(true)
    try {
      const next = await selectOffice(officeId)
      void navigate(homeOf(next), { replace: true })
    } finally {
      setBusy(false)
    }
  }

  if (usable.length > 1) {
    return (
      <AuthDesk>
        <FormSheet tab="اختيار المكتب" title="أيّ مكتب تدخل؟" verdict={null}>
          <p className="leading-relaxed text-ink-soft">أنت عضو في أكثر من مكتب. اختر المكتب الذي تريد العمل فيه الآن.</p>
          <div className="mt-6 grid gap-3">
            {usable.map((office) => (
              <Button key={office.office_id} variant="line" disabled={busy} onClick={() => void enter(office.office_id)}>
                {office.office_name}
                {office.office_city ? ` — ${office.office_city}` : ''}
              </Button>
            ))}
          </div>
          <div className="mt-6">
            <Button variant="line" onClick={() => void logout().then(() => navigate(PATHS.login))}>
              تسجيل الخروج
            </Button>
          </div>
        </FormSheet>
      </AuthDesk>
    )
  }

  return (
    <AuthDesk>
      <FormSheet tab="حالة الطلب" title={pending ? pending.office_name : 'لا يوجد مكتب على حسابك'} verdict={null}>
        <Stamp slam="mount" tone="blue" delay={0.4} className="text-2xl">
          قيد المراجعة
        </Stamp>
        <p className="mt-4 leading-relaxed text-ink-soft">
          {pending || DEMO
            ? 'وصل طلبك إلى مدير المنصّة. عند اعتماده تدخل إلى مكتبك من صفحة الدخول نفسها.'
            : 'سجّل مكتباً جديداً، أو اطلب رابط دعوة من صاحب مكتبك.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {!pending && (
            <Link to={PATHS.register} className={buttonClass('ink')}>
              سجّل مكتباً
            </Link>
          )}
          <Button variant="line" onClick={() => void logout().then(() => navigate(PATHS.login))}>
            تسجيل الخروج
          </Button>
        </div>
      </FormSheet>
    </AuthDesk>
  )
}

/* ───────────────────────── reset password ───────────────────────── */

/** Opened from the emailed link: `/reset-password?token=…` (or `?error=INVALID_TOKEN`). */
export const ResetPassword = () => {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [verdict, setVerdict] = useState<Verdict>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) return setVerdict({ kind: 'no', text: 'كلمة المرور 8 أحرف على الأقل.' })
    if (password !== confirm) return setVerdict({ kind: 'no', text: 'كلمتا المرور غير متطابقتين.' })
    setBusy(true)
    setVerdict(null)
    try {
      await api.post('/auth/reset-password', { token, newPassword: password })
      setDone(true)
    } catch (error) {
      setVerdict({ kind: 'no', text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthDesk>
      <FormSheet tab="كلمة مرور جديدة" title="عيّن كلمة مرور جديدة" verdict={verdict}>
        {!token ? (
          <div>
            <p className="leading-relaxed text-ink-soft">رابط إعادة التعيين غير صالح أو انتهت مدته. اطلب رابطاً جديداً.</p>
            <Link to={PATHS.forgot} className={cn(buttonClass('ink'), 'mt-6')}>
              اطلب رابطاً جديداً
            </Link>
          </div>
        ) : done ? (
          <div>
            <Stamp slam="mount" tone="green" className="text-2xl">
              تم التغيير
            </Stamp>
            <p className="mt-4 leading-relaxed text-ink-soft">سُجّل خروج الحساب من كل الأجهزة الأخرى. ادخل الآن بكلمة المرور الجديدة.</p>
            <Link to={PATHS.login} className={cn(buttonClass('ink'), 'mt-6')}>
              تسجيل الدخول
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5">
            <Field label="كلمة المرور الجديدة" name="password" type="password" dir="ltr" autoComplete="new-password" hint="8 أحرف على الأقل." value={password} onChange={(event) => setPassword(event.target.value)} />
            <Field label="أعد كتابتها" name="confirm" type="password" dir="ltr" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            <Button type="submit" variant="stamp" size="lg" disabled={busy} className="w-full">
              {busy ? 'تُحفظ…' : 'احفظ كلمة المرور'}
            </Button>
          </form>
        )}
      </FormSheet>
    </AuthDesk>
  )
}

/* ───────────────────────── invitation ───────────────────────── */

type InvitationPreview = {
  office_name: string
  office_active: boolean
  role: 'lawyer' | 'assistant' | 'client'
  email_hint: string
  state: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at: string
}
const INVITED_AS = { lawyer: 'محامٍ', assistant: 'مساعد قانوني', client: 'موكّل' } as const

/** Opened from an invitation link. Accepting needs a signed-in account with the invited email. */
export const Invitation = () => {
  const { token = '' } = useParams()
  const { session, status, refresh } = useAuth()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [missing, setMissing] = useState(false)
  const [bar, setBar] = useState('')
  const [account, setAccount] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<Verdict>(null)

  useEffect(() => {
    api
      .get<{ invitation: InvitationPreview }>(`/invitations/${encodeURIComponent(token)}`)
      .then(({ data }) => setPreview(data.invitation))
      .catch(() => setMissing(true))
  }, [token])

  const usable = preview?.state === 'pending' && preview.office_active

  const accept = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setVerdict(null)
    try {
      if (!session) {
        await api.post('/auth/sign-up/email', { name: account.name.trim(), email: account.email.trim(), password: account.password })
      }
      await api.post(`/invitations/${encodeURIComponent(token)}/accept`, preview?.role === 'lawyer' ? { bar_number: bar.trim() } : {})
      const next = await refresh()
      void navigate(homeOf(next), { replace: true })
    } catch (error) {
      await refresh()
      setVerdict({ kind: 'no', text: messageOf(error) })
      setBusy(false)
    }
  }

  return (
    <AuthDesk>
      <FormSheet tab="دعوة انضمام" title={preview ? preview.office_name : 'دعوة انضمام'} verdict={verdict}>
        {missing ? (
          <p className="leading-relaxed text-ink-soft">رابط الدعوة غير صالح أو انتهت مدته. اطلب من صاحب المكتب دعوة جديدة.</p>
        ) : !preview || status === 'loading' ? (
          <p className="text-ink-soft">تُفتح الدعوة…</p>
        ) : !usable ? (
          <p className="leading-relaxed text-ink-soft">هذه الدعوة لم تعد صالحة: استُخدمت أو أُلغيت أو انتهت مدتها. اطلب من صاحب المكتب دعوة جديدة.</p>
        ) : (
          <form onSubmit={accept} noValidate className="space-y-5">
            <p className="leading-relaxed text-ink-soft">
              دُعيت للانضمام بصفة <strong className="text-ink">{INVITED_AS[preview.role]}</strong>. الدعوة مرسلة إلى <bdi className="font-semibold text-ink">{preview.email_hint}</bdi>.
            </p>
            {session ? (
              <p className="border-s-4 border-stamp-blue bg-paper-shade px-3 py-2 text-sm text-ink">
                ستُقبل الدعوة بحساب <bdi className="font-semibold">{session.user.email}</bdi>.
              </p>
            ) : (
              <fieldset className="space-y-4">
                <legend className="font-doc text-xl font-bold text-ink">أنشئ حسابك</legend>
                <Field label="الاسم الكامل" name="name" autoComplete="name" value={account.name} onChange={(event) => setAccount({ ...account, name: event.target.value })} />
                <Field label="البريد الإلكتروني (الذي وصلته الدعوة)" name="email" type="email" dir="ltr" autoComplete="email" value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value })} />
                <Field label="كلمة المرور" name="password" type="password" dir="ltr" autoComplete="new-password" hint="8 أحرف على الأقل." value={account.password} onChange={(event) => setAccount({ ...account, password: event.target.value })} />
              </fieldset>
            )}
            {preview.role === 'lawyer' && <Field label="رقم العضوية في نقابة المحامين" name="bar" dir="ltr" value={bar} onChange={(event) => setBar(event.target.value)} />}
            <Button type="submit" variant="stamp" size="lg" className="w-full" disabled={busy || (preview.role === 'lawyer' && !bar.trim()) || (!session && (account.name.trim().length < 3 || !account.email.trim() || account.password.length < 8))}>
              {busy ? 'يُقبل…' : 'اقبل الدعوة'}
            </Button>
            {!session && (
              <p className="text-center text-sm text-ink-soft">
                لديك حساب؟{' '}
                <Link to={PATHS.login} className="font-semibold text-stamp-blue underline-offset-4 hover:underline">
                  ادخل أولاً ثم افتح الرابط من جديد
                </Link>
              </p>
            )}
          </form>
        )}
      </FormSheet>
    </AuthDesk>
  )
}
