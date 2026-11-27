import { CalendarPlus, FileCheck2, Gavel, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PATHS, personaOf, useAuth } from '@/auth/auth'
import { DEMO, messageOf } from '@/lib/api'
import {
  ATTACHMENT_TYPES,
  attachmentUrl,
  closingDateLabel,
  DELIVERY_STATUS,
  MAX_ATTACHMENT_BYTES,
  NOTICE_TYPE,
  useCourtNotices,
  useSaveCourtNotice,
  type CourtNotice,
  type CourtNoticeInput,
  type DeliveryStatus,
  type NoticeType,
} from '@/lib/courtNotices'
import {
  canRecordOutcome,
  HEARING_STATUS,
  OUTCOME_CHOICES,
  useCaseHearings,
  useRecordOutcome,
  type HearingLogEntry,
  type HearingOutcomeStatus,
} from '@/lib/hearings'
import { formatDate, formatDay, formatTime } from '@/lib/labels'
import { useAuthorizableLawyers } from '@/lib/powersOfAttorney'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill } from '@/ui/Shell'

const LINK = 'text-xs font-semibold underline-offset-4 hover:underline'

/* ───────────────────────── session log ───────────────────────── */

const pad = (value: number) => String(value).padStart(2, '0')
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** Records what happened at a hearing: held, postponed (to a next date) or cancelled. */
const OutcomeForm = ({ hearing, onClose }: { hearing: HearingLogEntry | null; onClose: () => void }) => {
  const me = useAuth().session?.user.user_id
  const lawyers = useAuthorizableLawyers(hearing !== null)
  const record = useRecordOutcome()
  const [status, setStatus] = useState<HearingOutcomeStatus>('completed')
  const [outcome, setOutcome] = useState('')
  const [attendee, setAttendee] = useState('')
  const [nextDate, setNextDate] = useState('')
  const [nextTime, setNextTime] = useState('09:00')
  const [reason, setReason] = useState('')
  const [room, setRoom] = useState('')

  useEffect(() => {
    if (!hearing) return
    record.reset()
    setStatus(hearing.status === 'scheduled' ? 'completed' : (hearing.status as HearingOutcomeStatus))
    setOutcome(hearing.outcome ?? '')
    setAttendee(hearing.attended_by_user_id ?? me ?? '')
    setNextDate('')
    setNextTime(hearing ? `${pad(new Date(hearing.hearing_at).getHours())}:${pad(new Date(hearing.hearing_at).getMinutes())}` : '09:00')
    setReason(hearing.postponement_reason ?? '')
    setRoom('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hearing?.hearing_id])

  if (!hearing) return <Modal open={false} onClose={onClose} title="">{null}</Modal>
  const postponed = status === 'postponed'
  const nextAt = postponed && nextDate ? new Date(`${nextDate}T${nextTime}`) : null
  const tooEarly = nextAt !== null && nextAt.getTime() <= new Date(hearing.hearing_at).getTime()
  const attendeeOptions = (lawyers.data ?? []).map((lawyer) => [lawyer.user_id, lawyer.full_name] as const)
  // The current attendee may be an assistant, who is not among the lawyers listed.
  const knownAttendee = !attendee || attendeeOptions.some(([id]) => id === attendee)

  return (
    <Modal open onClose={onClose} title="نتيجة الجلسة" wide>
      <p className="-mt-2 mb-4 text-sm text-ink-soft">
        جلسة {hearing.hearing_type} · <bdi>{formatDay(hearing.hearing_at)} {formatTime(hearing.hearing_at)}</bdi>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          record.mutate(
            {
              hearingId: hearing.hearing_id,
              input: {
                status,
                outcome: outcome.trim() || null,
                attended_by_user_id: status === 'cancelled' ? null : attendee || null,
                ...(postponed
                  ? { postponement_reason: reason.trim() || null, ...(nextAt ? { postponed_to: nextAt.toISOString(), next_court_room: room.trim() || null } : {}) }
                  : {}),
              },
            },
            { onSuccess: onClose },
          )
        }}
        className="space-y-4"
      >
        <fieldset>
          <legend className="block text-xs font-semibold text-ink-soft">ماذا حدث؟</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {OUTCOME_CHOICES.map(([value, label]) => (
              <label key={value} className={cn('cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold', status === value ? 'border-stamp bg-stamp/10 text-ink' : 'border-ink/20 text-ink-soft')}>
                <input type="radio" name="hearing_status" value={value} checked={status === value} onChange={() => setStatus(value)} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {status !== 'cancelled' && (
          <SelectField
            label="المحامي الحاضر"
            name="attended_by"
            value={attendee}
            onChange={(event) => setAttendee(event.target.value)}
            options={[['', 'غير محدّد'], ...(knownAttendee ? [] : [[attendee, hearing.attended_by_name ?? '—'] as const]), ...attendeeOptions]}
          />
        )}
        <TextArea
          label={status === 'completed' ? 'القرار أو ما جرى في الجلسة' : status === 'postponed' ? 'ما جرى في الجلسة (اختياري)' : 'سبب الإلغاء (اختياري)'}
          name="outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
        />
        {postponed && (
          <div className="space-y-4 rounded-md border border-ink/15 p-3">
            <Field label="سبب التأجيل" name="postponement_reason" placeholder="غياب الخصم، تقديم بيّنات، طلب مهلة…" value={reason} onChange={(event) => setReason(event.target.value)} />
            {hearing.next_hearing_id ? (
              <p className="text-sm text-ink-soft">أُجّلت هذه الجلسة إلى جلسة لاحقة. غيّر موعدها من التقويم.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="الجلسة القادمة" name="next_date" type="date" dir="ltr" min={localDate(new Date(hearing.hearing_at))} value={nextDate} onChange={(event) => setNextDate(event.target.value)} error={tooEarly ? 'قبل هذه الجلسة' : undefined} />
                  <Field label="الساعة" name="next_time" type="time" dir="ltr" value={nextTime} onChange={(event) => setNextTime(event.target.value)} />
                  <Field label="القاعة (اختياري)" name="next_room" placeholder={hearing.court_room ?? ''} value={room} onChange={(event) => setRoom(event.target.value)} />
                </div>
                <p className="text-xs text-ink-faint">تُضاف الجلسة القادمة إلى ملف القضية والتقويم تلقائياً. اترك التاريخ فارغاً إن لم يُحدَّد بعد.</p>
              </>
            )}
          </div>
        )}
        <FormActions error={record.isError ? messageOf(record.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={tooEarly || record.isPending}>
            {record.isPending ? 'يُحفظ…' : 'احفظ النتيجة'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  )
}

/** The case's sessions in order, each with its outcome, and the way to record the next one. */
export const CaseHearings = ({ caseId }: { caseId: string }) => {
  const owner = personaOf(useAuth().session) === 'owner'
  const hearings = useCaseHearings(caseId)
  const [recording, setRecording] = useState<HearingLogEntry | null>(null)
  const now = Date.now()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">سجلّ جلسات القضية بالترتيب: ما جرى في كل جلسة، ومن حضرها، وإلى متى أُجّلت.</p>
        {owner && (
          <Link to={`${PATHS.office}/calendar`} className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            جدولة جلسة من التقويم
          </Link>
        )}
      </div>
      {hearings.isPending ? (
        <Loading />
      ) : hearings.isError ? (
        <Failed error={hearings.error} />
      ) : hearings.data.length === 0 ? (
        <Empty>لا جلسات في هذه القضية بعد.</Empty>
      ) : (
        <ol className="relative space-y-4 border-s-2 border-rule ps-5">
          {hearings.data.map((hearing) => {
            const label = HEARING_STATUS[hearing.status]
            const due = hearing.status === 'scheduled' && new Date(hearing.hearing_at).getTime() < now
            return (
              <li key={hearing.hearing_id} className="relative">
                <span className={cn('absolute -start-[27px] top-1.5 grid size-4 place-items-center rounded-full border-2 border-paper', hearing.status === 'scheduled' ? 'bg-stamp-blue' : hearing.status === 'completed' ? 'bg-stamp-green' : 'bg-ink-faint')} aria-hidden="true" />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      <Gavel className="me-1 inline size-4 text-stamp" aria-hidden="true" />
                      جلسة {hearing.hearing_type} · <bdi>{formatDay(hearing.hearing_at)} {formatTime(hearing.hearing_at)}</bdi>
                    </p>
                    <p className="text-xs text-ink-soft">
                      {[hearing.court_name && `محكمة ${hearing.court_name}`, hearing.court_room && `قاعة ${hearing.court_room}`, hearing.attended_by_name && `حضرها ${hearing.attended_by_name}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Pill tone={label.tone}>{label.text}</Pill>
                    {canRecordOutcome(hearing) && (
                      <button type="button" onClick={() => setRecording(hearing)} className={cn(LINK, due ? 'text-stamp' : 'text-stamp-blue')}>
                        {hearing.status === 'scheduled' ? 'سجّل النتيجة' : 'عدّل النتيجة'}
                      </button>
                    )}
                  </div>
                </div>
                {due && <p className="mt-1 text-xs font-semibold text-stamp">مضى موعد الجلسة ولم تُسجَّل نتيجتها.</p>}
                {hearing.outcome && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{hearing.outcome}</p>}
                {hearing.status === 'postponed' && (
                  <p className="mt-1 text-sm text-ink-soft">
                    {hearing.postponement_reason ? `سبب التأجيل: ${hearing.postponement_reason}` : 'أُجّلت'}
                    {hearing.next_hearing_at && <> · إلى <bdi>{formatDay(hearing.next_hearing_at)} {formatTime(hearing.next_hearing_at)}</bdi></>}
                  </p>
                )}
                {hearing.notes && <p className="mt-1 text-xs text-ink-faint">{hearing.notes}</p>}
              </li>
            )
          })}
        </ol>
      )}
      <OutcomeForm hearing={recording} onClose={() => setRecording(null)} />
    </div>
  )
}

/* ───────────────────────── court notices ───────────────────────── */

const EMPTY_NOTICE = { notice_type: 'notification' as NoticeType, recipient: '', bailiff_office: '', sent_on: '', delivery_status: 'pending' as DeliveryStatus, delivered_on: '', notes: '' }

const NoticeForm = ({ caseId, notice, open, onClose }: { caseId: string; notice: CourtNotice | null; open: boolean; onClose: () => void }) => {
  const save = useSaveCourtNotice()
  const [values, setValues] = useState(EMPTY_NOTICE)
  const [file, setFile] = useState<File | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    save.reset()
    setFile(null)
    setSavedId(null)
    setLocalError(null)
    setValues(notice
      ? { notice_type: notice.notice_type, recipient: notice.recipient ?? '', bailiff_office: notice.bailiff_office ?? '', sent_on: notice.sent_on, delivery_status: notice.delivery_status, delivered_on: notice.delivered_on ?? '', notes: notice.notes ?? '' }
      : { ...EMPTY_NOTICE, sent_on: localDate(new Date()) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, notice?.notice_id])
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((current) => ({ ...current, [key]: value }))
  const closingLabel = closingDateLabel(values.delivery_status)
  const badDate = Boolean(closingLabel && values.delivered_on && values.sent_on && values.delivered_on < values.sent_on)
  const ready = values.sent_on && (!closingLabel || values.delivered_on) && !badDate

  const submit = () => {
    setLocalError(null)
    if (file && (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type) || file.size > MAX_ATTACHMENT_BYTES)) {
      setLocalError('الملف يجب أن يكون PDF أو PNG أو JPG، حتى 5 ميغابايت.')
      return
    }
    const input: CourtNoticeInput = {
      case_id: caseId,
      notice_type: values.notice_type,
      recipient: values.recipient.trim() || null,
      bailiff_office: values.bailiff_office.trim() || null,
      sent_on: values.sent_on,
      delivery_status: values.delivery_status,
      delivered_on: closingLabel ? values.delivered_on : null,
      notes: values.notes.trim() || null,
    }
    save.mutate(
      { noticeId: notice?.notice_id ?? savedId ?? undefined, input, file: file ? { blob: file, type: file.type } : null },
      {
        onSuccess: ({ saved, uploadError }) => {
          if (uploadError) {
            setSavedId(saved.notice_id)
            setLocalError(`حُفظت الورقة، لكن تعذّر رفع الملف: ${messageOf(uploadError)} أعد المحاولة.`)
            return
          }
          onClose()
        },
      },
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={notice ? 'تحديث ورقة المحضر' : 'ورقة محضر جديدة'} wide>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <SelectField label="نوع الورقة" name="notice_type" value={values.notice_type} onChange={(event) => set('notice_type', event.target.value as NoticeType)} options={Object.entries(NOTICE_TYPE)} />
        <Field label="المبلَّغ إليه" name="recipient" placeholder="الخصم، الشاهد، الجهة…" value={values.recipient} onChange={(event) => set('recipient', event.target.value)} />
        <Field label="دائرة المحضرين" name="bailiff_office" placeholder="محضرو محكمة صلح نابلس…" value={values.bailiff_office} onChange={(event) => set('bailiff_office', event.target.value)} />
        <Field label="تاريخ الإرسال" name="sent_on" type="date" dir="ltr" required value={values.sent_on} onChange={(event) => set('sent_on', event.target.value)} />
        <SelectField label="حالة التبليغ" name="delivery_status" value={values.delivery_status} onChange={(event) => set('delivery_status', event.target.value as DeliveryStatus)} options={Object.entries(DELIVERY_STATUS).map(([value, label]) => [value, label.text] as const)} />
        {closingLabel ? (
          <Field label={closingLabel} name="delivered_on" type="date" dir="ltr" required min={values.sent_on || undefined} value={values.delivered_on} onChange={(event) => set('delivered_on', event.target.value)} error={badDate ? 'قبل تاريخ الإرسال' : undefined} />
        ) : (
          <div />
        )}
        <TextArea label="ملاحظات" name="notice_notes" className="sm:col-span-2" value={values.notes} onChange={(event) => set('notes', event.target.value)} />
        <div className="sm:col-span-2">
          <label htmlFor="notice-file" className="block text-xs font-semibold text-ink-soft">
            {notice?.has_attachment ? 'استبدال صورة الورقة' : 'صورة الورقة'} (PDF أو صورة، حتى 5 ميغابايت، اختياري)
          </label>
          <input id="notice-file" type="file" accept={ATTACHMENT_TYPES.join(',')} onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-ink file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper" />
        </div>
        <div className="sm:col-span-2">
          <FormActions error={localError ?? (save.isError ? messageOf(save.error) : null)}>
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant="ink" disabled={!ready || save.isPending}>
              {save.isPending ? 'يُحفظ…' : savedId && !notice ? 'أعد رفع الملف' : 'احفظ'}
            </Button>
          </FormActions>
        </div>
      </form>
    </Modal>
  )
}

/** The bailiff papers of a case and where each one stands. */
export const CaseNotices = ({ caseId }: { caseId: string }) => {
  const notices = useCourtNotices({ caseId })
  const [editing, setEditing] = useState<CourtNotice | 'new' | null>(null)
  const pending = (notices.data ?? []).filter((notice) => notice.delivery_status === 'pending').length
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          أوراق المحضرين المرسلة في هذه القضية: التبليغات ومذكرات الحضور وتبليغ الأحكام وأوراق التنفيذ.
          {pending > 0 && <span className="ms-1 font-semibold text-stamp-blue">{pending === 1 ? 'ورقة واحدة بانتظار التبليغ.' : `${pending} أوراق بانتظار التبليغ.`}</span>}
        </p>
        <Button variant="ink" size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden="true" />
          ورقة محضر جديدة
        </Button>
      </div>
      {notices.isPending ? (
        <Loading />
      ) : notices.isError ? (
        <Failed error={notices.error} />
      ) : notices.data.length === 0 ? (
        <Empty>لا أوراق محضرين في هذه القضية بعد.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b-2 border-ink">
                {['الورقة', 'المبلَّغ إليه', 'الإرسال', 'الحالة', ''].map((head) => (
                  <th key={head} scope="col" className="pe-4 pb-2 text-start text-xs font-semibold text-ink-soft">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {notices.data.map((notice) => {
                const label = DELIVERY_STATUS[notice.delivery_status]
                return (
                  <tr key={notice.notice_id} className="border-b border-rule align-top">
                    <td className="py-3 pe-4 text-sm text-ink">
                      <p className="font-semibold">{NOTICE_TYPE[notice.notice_type]}</p>
                      {notice.bailiff_office && <p className="text-xs text-ink-soft">{notice.bailiff_office}</p>}
                      {notice.notes && <p className="mt-1 text-xs text-ink-faint">{notice.notes}</p>}
                    </td>
                    <td className="py-3 pe-4 text-sm text-ink">{notice.recipient ?? '—'}</td>
                    <td className="py-3 pe-4 text-sm whitespace-nowrap text-ink-soft">{formatDate(notice.sent_on)}</td>
                    <td className="py-3 pe-4 text-sm">
                      <Pill tone={label.tone}>{label.text}</Pill>
                      {notice.delivered_on && <p className="mt-1 text-xs text-ink-soft">{formatDate(notice.delivered_on)}</p>}
                    </td>
                    <td className="py-3 text-end whitespace-nowrap">
                      <div className="flex flex-col items-end gap-1">
                        {notice.has_attachment && (DEMO ? (
                          <span className="text-xs text-ink-faint">صورة (تجريبي)</span>
                        ) : (
                          <a href={attachmentUrl(notice.notice_id)} target="_blank" rel="noreferrer" className={cn(LINK, 'inline-flex items-center gap-1 text-stamp-blue')}>
                            <FileCheck2 className="size-4" aria-hidden="true" />
                            الصورة
                          </a>
                        ))}
                        <button type="button" onClick={() => setEditing(notice)} className={cn(LINK, 'text-stamp-blue')}>تحديث</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <NoticeForm caseId={caseId} notice={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </div>
  )
}
