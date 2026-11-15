/**
 * Outgoing email through Resend's HTTP API (no SDK: Node's fetch is enough).
 *
 * Configure RESEND_API_KEY and MAIL_FROM to send. Without a key nothing is sent: outside
 * production the message is written to the console so the flows can be exercised locally, and
 * callers learn from the return value that no email left, so the UI can say so honestly.
 */
const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

const ROLE_NAMES = {
  lawyer: { ar: 'محامٍ', en: 'lawyer' },
  assistant: { ar: 'مساعد', en: 'assistant' },
  client: { ar: 'موكّل', en: 'client' },
};

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mailConfig(env = process.env) {
  return {
    apiKey: env.RESEND_API_KEY || '',
    from: env.MAIL_FROM || 'Qadiyati <onboarding@resend.dev>',
    production: env.NODE_ENV === 'production',
    quiet: env.NODE_ENV === 'test',
  };
}

/**
 * Sends one email. Resolves to true when the provider accepted it and false otherwise; it never
 * throws, so a mail outage cannot undo the invitation or reset that triggered it.
 */
export async function sendMail({ to, subject, html, text }, { env = process.env, fetchImpl = fetch } = {}) {
  const config = mailConfig(env);
  if (!config.apiKey) {
    if (config.production) console.warn('Email not sent: RESEND_API_KEY is not configured.');
    else if (!config.quiet) console.info(`[dev mail] To: ${to}\nSubject: ${subject}\n${text}`);
    return false;
  }
  try {
    const response = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: config.from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Email provider refused the message (HTTP ${response.status}).`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Email could not be sent.', { name: error?.name ?? 'Error' });
    return false;
  }
}

/** One message in Arabic (right to left) followed by English, since the reader's language is unknown. */
function bilingualHtml({ arabic, english, url, buttonAr, buttonEn }) {
  const link = escapeHtml(url);
  const button = (label) =>
    `<a href="${link}" style="display:inline-block;background:#2b372d;color:#faf7f1;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a>`;
  return `<!doctype html>
<html><body style="margin:0;background:#faf7f1;font-family:Tahoma,Arial,sans-serif;color:#22241f">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-size:22px;font-weight:700;color:#2b372d;margin:0 0 24px">قضيتي · Qadiyati</p>
<div dir="rtl" style="text-align:right;line-height:1.8">${arabic}<p>${button(buttonAr)}</p></div>
<hr style="border:none;border-top:1px solid #e4dccd;margin:28px 0">
<div dir="ltr" style="text-align:left;line-height:1.6">${english}<p>${button(buttonEn)}</p></div>
<p dir="ltr" style="font-size:12px;color:#6b6354;margin-top:28px;word-break:break-all">${link}</p>
</div></body></html>`;
}

export function invitationEmail({ officeName, role, url }) {
  const roleName = ROLE_NAMES[role] ?? { ar: role, en: role };
  const office = escapeHtml(officeName);
  return {
    subject: `دعوة للانضمام إلى ${officeName} — Invitation to join ${officeName}`,
    html: bilingualHtml({
      arabic: `<p>دعاك <strong>${office}</strong> للانضمام إلى مساحة عمله على قضيتي بصفة <strong>${roleName.ar}</strong>.</p>
<p>افتح الرابط وأنشئ حسابك بهذا البريد نفسه. الرابط صالح لمدة 7 أيام ولمرة واحدة.</p>`,
      english: `<p><strong>${office}</strong> invited you to its workspace on Qadiyati as a <strong>${roleName.en}</strong>.</p>
<p>Open the link and create your account with this same email. The link is valid for 7 days and a single use.</p>`,
      url,
      buttonAr: 'قبول الدعوة',
      buttonEn: 'Accept the invitation',
    }),
    text: `${officeName} دعاك للانضمام إلى قضيتي بصفة ${roleName.ar}.\n${officeName} invited you to Qadiyati as a ${roleName.en}.\n\n${url}\n\nالرابط صالح لمدة 7 أيام. Valid for 7 days.`,
  };
}

export function passwordResetEmail({ url }) {
  return {
    subject: 'استعادة كلمة المرور — Reset your Qadiyati password',
    html: bilingualHtml({
      arabic: `<p>طلبتَ تعيين كلمة مرور جديدة لحسابك على قضيتي. الرابط صالح لمدة ساعة واحدة.</p>
<p>إن لم تطلب ذلك فتجاهل هذه الرسالة، ولن يتغيّر شيء في حسابك.</p>`,
      english: `<p>You asked to set a new password for your Qadiyati account. The link is valid for one hour.</p>
<p>If you didn't ask for this, ignore this email and nothing will change.</p>`,
      url,
      buttonAr: 'تعيين كلمة مرور جديدة',
      buttonEn: 'Set a new password',
    }),
    text: `استعادة كلمة المرور / Reset your password (valid for one hour):\n\n${url}`,
  };
}
