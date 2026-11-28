import QRCode from 'qrcode'
import { Printer, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { messageOf } from '@/lib/api'
import { LOGO_AVAILABLE, dualDate, formatCode, logoUrl, registerPrint, useLetterhead, verifyUrl, type PrintKind } from '@/lib/printing'
import { Button, cn } from './kit'

/**
 * The unified print engine: every printable paper of the office goes through this sheet, so
 * they all carry the same letterhead, dates, page numbers (from the print stylesheet) and
 * verification block. Drafts print with a "مسودة" watermark and no code.
 */

/** The QR code of a verification address, drawn as inline SVG. */
const QrCode = ({ value }: { value: string }) => {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      .then((markup) => !cancelled && setSvg(markup))
      .catch(() => !cancelled && setSvg(null))
    return () => {
      cancelled = true
    }
  }, [value])
  // The markup comes from the QR library for a URL we built, never from user content.
  return svg ? <span aria-label="رمز QR للتحقق من المستند" role="img" className="block size-20 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} /> : null
}

const LetterheadBlock = () => {
  const letterhead = useLetterhead()
  const [logoFailed, setLogoFailed] = useState(false)
  const data = letterhead.data
  if (!data) return null
  const lines = [data.address, data.phone ? `هاتف: ${data.phone}` : null, data.email, data.license_number ? `رقم الترخيص: ${data.license_number}` : null].filter(Boolean)
  return (
    <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-3">
      <div>
        <p className="font-doc text-2xl font-bold text-ink" data-no-translate>{data.display_name}</p>
        {data.subtitle && <p className="text-sm text-ink-soft" data-no-translate>{data.subtitle}</p>}
        {lines.length > 0 && <p className="mt-1 text-xs text-ink-soft" data-no-translate>{lines.join(' · ')}</p>}
      </div>
      {data.has_logo && LOGO_AVAILABLE && !logoFailed && (
        <img src={logoUrl()} alt="" onError={() => setLogoFailed(true)} className="max-h-20 max-w-32 shrink-0 object-contain" />
      )}
    </header>
  )
}

export type PrintSheetProps = {
  kind: PrintKind
  title: string
  /** A line under the title: the case, the client, the period… */
  subtitle?: ReactNode
  /** The code this paper was issued with, when it already has one (a final document). */
  code?: string | null
  /** Draws the "مسودة" watermark and leaves the verification block out. */
  draft?: boolean
  /** Where the issued code of the latest print goes (see usePrintWithCode). */
  sheetRef?: RefObject<HTMLElement | null>
  children: ReactNode
  className?: string
}

export const PrintSheet = ({ kind: _kind, title, subtitle, code, draft = false, sheetRef, children, className }: PrintSheetProps) => {
  const dates = dualDate()
  const letterhead = useLetterhead()
  return (
    <article ref={sheetRef as RefObject<HTMLElement>} className={cn('print-sheet paper rounded-md p-6 sm:p-8', draft && 'print-draft', className)}>
      <LetterheadBlock />
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-doc text-2xl font-bold text-ink">{title}</h2>
          {subtitle && <div className="mt-0.5 text-sm text-ink-soft">{subtitle}</div>}
        </div>
        <p className="text-start text-xs leading-relaxed text-ink-soft" data-no-translate>
          {dates.gregorian}
          <br />
          {dates.hijri}
        </p>
      </div>
      <div className="mt-5">{children}</div>
      <footer className="print-footer mt-8 border-t border-rule pt-3 text-xs text-ink-soft">
        {letterhead.data?.footer_text && <p className="mb-2" data-no-translate>{letterhead.data.footer_text}</p>}
        {!draft && code ? (
          <div className="flex items-center gap-4">
            <QrCode value={verifyUrl(code)} />
            <div className="space-y-0.5">
              <p className="flex items-center gap-1 font-semibold text-ink">
                <ShieldCheck className="size-3.5 text-stamp-green" aria-hidden="true" />
                رمز التحقق: <bdi dir="ltr" className="font-mono tracking-wider">{formatCode(code)}</bdi>
              </p>
              <p>للتحقق من صدور هذا المستند عن المكتب، امسح الرمز أو افتح:</p>
              <p dir="ltr" className="font-mono text-[0.7rem]">{verifyUrl(code)}</p>
            </div>
          </div>
        ) : draft ? (
          <p>مسودة غير معتمدة: لا تحمل رمز تحقق.</p>
        ) : null}
      </footer>
    </article>
  )
}

/**
 * Printing a screen's paper with a code: the sheet's text is fingerprinted on the server, the
 * code comes back and is drawn on the sheet, then the browser prints. Returns the code shown and
 * a print button's handler.
 */
export const usePrintWithCode = (kind: PrintKind) => {
  const sheetRef = useRef<HTMLElement | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const print = useCallback(async () => {
    const element = sheetRef.current
    if (!element) return
    setBusy(true)
    setError(null)
    try {
      // The text without the verification block itself, which is what the code then certifies.
      const footer = element.querySelector('.print-footer')
      const text = (element.innerText ?? '').replace(footer instanceof HTMLElement ? footer.innerText : '', '').trim()
      const issued = await registerPrint(kind, text)
      setCode(issued.code)
      // Let React draw the code and QR before the print dialog opens.
      await new Promise((resolve) => window.setTimeout(resolve, 150))
      window.print()
    } catch (problem) {
      setError(messageOf(problem))
    } finally {
      setBusy(false)
    }
  }, [kind])
  /** Forgets the code when the sheet shows another document, so no paper carries another's code. */
  const reset = useCallback(() => {
    setCode(null)
    setError(null)
  }, [])
  return { sheetRef, code, print, busy, error, reset }
}

/** The print button that issues a code, for a sheet using usePrintWithCode. */
export const PrintButton = ({ onPrint, busy, error, label = 'اطبع مع رمز تحقق' }: { onPrint: () => void; busy: boolean; error: string | null; label?: string }) => (
  <span className="no-print inline-flex flex-col items-end gap-1">
    <Button variant="ink" size="sm" onClick={onPrint} disabled={busy}>
      <Printer className="size-4" aria-hidden="true" />
      {busy ? 'يُجهَّز…' : label}
    </Button>
    {error && <span role="alert" className="text-xs text-stamp">{error}</span>}
  </span>
)
