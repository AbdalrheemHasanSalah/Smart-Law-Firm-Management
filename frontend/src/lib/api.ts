import axios, { isAxiosError } from 'axios'
import { demoAdapter } from './demo'

export const DEMO = (import.meta.env.VITE_DEMO ?? 'true') !== 'false'
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

/** Arabic wording for every error code the backend (or Better Auth) can send. */
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  INVALID_EMAIL_OR_PASSWORD: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  ACCOUNT_INACTIVE: 'هذا الحساب موقوف. تواصل مع مدير المكتب.',
  EMAIL_TAKEN: 'هذا البريد مسجّل من قبل.',
  USER_ALREADY_EXISTS: 'هذا البريد مسجّل من قبل.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'هذا البريد مسجّل من قبل.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
  NO_ACTIVE_OFFICE: 'لا يوجد مكتب نشط لهذه الجلسة.',
  OFFICE_PENDING: 'طلب المكتب ما زال قيد المراجعة.',
  OFFICE_INACTIVE: 'هذا المكتب غير مفعّل.',
  MEMBERSHIP_SUSPENDED: 'عضويتك في هذا المكتب موقوفة.',
  REGISTRATION_PENDING: 'لديك طلب مكتب قيد المراجعة بالفعل.',
  BAR_NUMBER_TAKEN: 'رقم النقابة مسجّل لحساب آخر.',
  BAR_NUMBER_MISMATCH: 'رقم النقابة لا يطابق المسجّل على حسابك.',
  INVITATION_INVALID: 'رابط الدعوة غير صالح أو انتهت مدته.',
  INVITATION_EMAIL_MISMATCH: 'هذه الدعوة أُرسلت إلى بريد إلكتروني آخر.',
  ALREADY_MEMBER: 'أنت عضو في هذا المكتب بالفعل.',
  LAST_LAWYER: 'لا يمكن إزالة المحامي الوحيد في القضية. أسند محامياً آخر أولاً ثم أزله.',
  SUBSCRIPTION_EXPIRED: 'انتهى اشتراك المكتب ومهلة السماح. يعود العمل بعد تجديد الاشتراك.',
  ONLINE_PAYMENTS_DISABLED: 'الدفع الإلكتروني غير مفعّل حالياً.',
  PAYMENT_PROVIDER_ERROR: 'تعذّر فتح صفحة الدفع. حاول مجدداً بعد قليل.',
  WRONG_PORTAL: 'هذا الحساب لا يدخل من هذه الصفحة. اختر نوع الحساب الصحيح.',
  RESET_TOKEN_INVALID: 'رابط إعادة التعيين غير صالح أو انتهت مدته.',
  INVALID_TOKEN: 'رابط إعادة التعيين غير صالح أو انتهت مدته.',
  UNAUTHORIZED: 'انتهت الجلسة. سجّل الدخول من جديد.',
  FORBIDDEN: 'لا تملك صلاحية هذا الإجراء.',
  NOT_FOUND: 'العنصر المطلوب غير موجود.',
  VALIDATION: 'تحقّق من البيانات المدخلة.',
  PAYMENT_REQUEST_OPEN: 'لديك طلب دفع بانتظار المراجعة. انتظر قرار الإدارة أو ألغِ الطلب الحالي.',
  POA_NUMBER_TAKEN: 'هذا الرقم مسجّل لتوكيل آخر في المكتب.',
  PAYMENT_REQUEST_REVIEWED: 'رُوجع هذا الطلب من قبل.',
  ALREADY_SAVED: 'هذا العنصر محفوظ في مكتبة المكتب من قبل.',
  ALREADY_LINKED: 'هذا المرجع مربوط بالقضية من قبل.',
  IMPORT_INVALID: 'في الملف أخطاء، ولم يُستورد منه شيء. راجع القائمة أدناه.',
  AI_REFUSED: 'اعتذر المساعد الذكي عن إعداد هذه الورقة. راجع محتوى الملف أو حدّد تركيزاً مختلفاً.',
  AI_LIMIT_REACHED: 'انتهى رصيد التحليلات بالذكاء الاصطناعي لهذا الشهر. يتجدد أول الشهر القادم.',
  TASKS_ALREADY_CREATED: 'أُنشئت المهام من هذا المحضر من قبل.',
  AI_BUSY: 'المساعد الذكي مشغول الآن. أعد المحاولة بعد دقيقة.',
  NETWORK: 'تعذّر الاتصال بالخادم. تأكّد أن الباك إند يعمل.',
  SERVER: 'حدث خطأ في الخادم. أعد المحاولة بعد قليل.',
}

const codeOfStatus = (status: number) =>
  status === 401
    ? 'UNAUTHORIZED'
    : status === 403
      ? 'FORBIDDEN'
      : status === 404
        ? 'NOT_FOUND'
        : status === 429
          ? 'RATE_LIMITED'
          : status >= 500
            ? 'SERVER'
            : 'VALIDATION'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null = null,
    readonly details: unknown = null,
  ) {
    super(MESSAGES[code] ?? MESSAGES.SERVER)
    this.name = 'ApiError'
  }
}

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error
  if (isAxiosError(error)) {
    if (!error.response) return new ApiError('NETWORK')
    const { status, data } = error.response
    const bodyCode = (data as { code?: unknown } | null)?.code
    const code = typeof bodyCode === 'string' && bodyCode in MESSAGES ? bodyCode : codeOfStatus(status)
    return new ApiError(code, status, data)
  }
  return new ApiError('SERVER')
}

export const messageOf = (error: unknown) => toApiError(error).message

let onUnauthorized: () => void = () => undefined
export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler
}

/** One HTTP client for the whole app. In demo mode the requests never leave the browser. */
export const api = axios.create({
  baseURL: API_URL,
  timeout: 15_000,
  withCredentials: true,
  ...(DEMO ? { adapter: demoAdapter } : {}),
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = toApiError(error)
    const url = (error as { config?: { url?: string } }).config?.url ?? ''
    if (apiError.code === 'UNAUTHORIZED' && !url.startsWith('/auth/') && url !== '/me') onUnauthorized()
    return Promise.reject(apiError)
  },
)
