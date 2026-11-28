import { useQuery } from '@tanstack/react-query'
import { Bell, BellOff, CheckCheck, ExternalLink, FileDown, FolderInput, MessageCircle, Paperclip, Send, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, messageOf } from '@/lib/api'
import { formatDate, formatTime } from '@/lib/labels'
import {
  CHANNEL,
  DELIVERY_STATUS,
  FILE_STATUS,
  NOTICE_KIND,
  checkFile,
  fetchNoticeDraft,
  formatSize,
  latestDeliveries,
  sharedFileUrl,
  uploadSharedFile,
  useAcknowledge,
  useCaseNotices,
  useHandleFile,
  useIncomingFiles,
  useMyFiles,
  useMyNotices,
  usePushState,
  useRecordWhatsApp,
  useSendNotice,
  useSendToOffice,
  useTogglePush,
  type Attachment,
  type NoticeKind,
} from '@/lib/portalLink'
import type { CaseRelationships, LegalCase } from '@/lib/types'
import { appendText } from '@/lib/voice'
import { useCaseHearings } from '@/lib/hearings'
import { FormActions, Modal, SelectField, TextArea } from '@/ui/forms'
import { Button, cn, Field } from '@/ui/kit'
import { Empty, Failed, Loading, Pill } from '@/ui/Shell'
import { DictateButton } from '@/ui/Voice'

const LINK = 'text-xs font-semibold underline-offset-4 hover:underline disabled:opacity-50'

/* ───────────────────────── push on this device ───────────────────────── */

/** Turns push notifications on or off for this device; says why when it cannot. */
export const PushToggle = ({ className }: { className?: string }) => {
  const push = usePushState()
  const toggle = useTogglePush()
  if (!push.data || push.data.state === 'unsupported') return null
  const { state, publicKey } = push.data
  const error = toggle.isError ? ((toggle.error as Error).message === 'push-denied' ? 'لم تسمح بالإشعارات. فعّلها من إعدادات المتصفح لهذا الموقع.' : messageOf(toggle.error)) : null
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-paper px-4 py-3', className)}>
      <p className="flex items-center gap-2 text-sm text-ink">
        {state === 'on' ? <Bell className="size-4 text-stamp-green" aria-hidden="true" /> : <BellOff className="size-4 text-ink-soft" aria-hidden="true" />}
        {state === 'on'
          ? 'الإشعارات مفعّلة على هذا الجهاز: تصلك المواعيد والرسائل حتى والموقع مغلق.'
          : state === 'denied'
            ? 'الإشعارات محظورة على هذا الجهاز من إعدادات المتصفح.'
            : state === 'off-server'
              ? 'الإشعارات الفورية غير مفعّلة على الخادم بعد.'
              : 'فعّل الإشعارات لتصلك المواعيد والرسائل حتى والموقع مغلق.'}
      </p>
      {(state === 'on' || state === 'off') && (
        <Button variant={state === 'on' ? 'line' : 'ink'} size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate({ enable: state !== 'on', publicKey })}>
          {toggle.isPending ? '…' : state === 'on' ? 'أوقف الإشعارات' : 'فعّل الإشعارات على هذا الجهاز'}
        </Button>
      )}
      {error && <p role="alert" className="w-full text-xs text-stamp">{error}</p>}
    </div>
  )
}

/* ───────────────────────── client: send files ───────────────────────── */

export const SendToOffice = ({ cases }: { cases: LegalCase[] }) => {
  const send = useSendToOffice()
  const mine = useMyFiles()
  const [caseId, setCaseId] = useState(cases[0]?.case_id ?? '')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  if (cases.length === 0) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!file) return
    send.mutate(
      { file, caseId, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setFile(null)
          setNote('')
          if (input.current) input.current.value = ''
        },
      },
    )
  }

  return (
    <section className="mt-10">
      <h2 className="mb-1 text-xl text-ink">أرسل مستندات لمكتبك</h2>
      <p className="mb-3 text-sm text-ink-soft">صوّر المستند بهاتفك أو اختر ملفاً (صورة أو PDF حتى 10 ميغابايت)، فيصل إلى فريق قضيتك.</p>
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-rule bg-paper p-4">
        {cases.length > 1 && (
          <SelectField label="القضية" name="send_case" value={caseId} onChange={(event) => setCaseId(event.target.value)} options={cases.map((row) => [row.case_id, `${row.case_number} — ${row.title}`] as const)} />
        )}
        <div>
          <label htmlFor="send-file" className="block text-xs font-semibold text-ink-soft">الملف</label>
          <input
            id="send-file"
            ref={input}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            capture="environment"
            onChange={(event) => {
              const picked = event.target.files?.[0] ?? null
              setProblem(picked ? checkFile(picked) : null)
              setFile(picked && !checkFile(picked) ? picked : null)
            }}
            className="mt-1 block w-full text-sm text-ink file:me-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper"
          />
          {problem && <p role="alert" className="mt-1 text-xs text-stamp">{problem}</p>}
        </div>
        <TextArea label="ملاحظة للمكتب (اختياري)" name="send_note" rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
        <DictateButton onText={(spoken) => setNote((current) => appendText(current, spoken))} />
        <FormActions error={send.isError ? messageOf(send.error) : null}>
          {send.isSuccess && !file && <span role="status" className="text-sm text-stamp-green">وصل الملف إلى مكتبك.</span>}
          <Button type="submit" variant="ink" disabled={!file || !caseId || send.isPending}>
            <Upload className="size-4" aria-hidden="true" />
            {send.isPending ? 'يُرسل…' : 'أرسل'}
          </Button>
        </FormActions>
      </form>
      {mine.data && mine.data.length > 0 && (
        <ul className="mt-3 divide-y divide-rule rounded-lg border border-rule bg-paper">
          {mine.data.map((entry) => (
            <li key={entry.file_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <span>
                <span className="text-ink" dir="auto">{entry.file_name}</span>
                <span className="text-xs text-ink-faint"> · {entry.case_number} · {formatDate(entry.created_at)}</span>
              </span>
              <Pill tone={FILE_STATUS[entry.status].tone}>{FILE_STATUS[entry.status].text}</Pill>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ───────────────────────── client: official notices ───────────────────────── */

export const MyNotices = () => {
  const notices = useMyNotices()
  const acknowledge = useAcknowledge()
  if (!notices.data || notices.data.length === 0) return null
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xl text-ink">إشعارات رسمية من مكتبك</h2>
      <ul className="space-y-3">
        {notices.data.map((notice) => (
          <li key={notice.notice_id} className={cn('rounded-lg border p-4', notice.acknowledged_at ? 'border-rule bg-paper' : 'border-stamp/40 bg-stamp/5')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold text-ink">{notice.title}</p>
              <Pill tone={notice.kind === 'judgment' ? 'red' : 'blue'}>{NOTICE_KIND[notice.kind]}</Pill>
            </div>
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink">{notice.body}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
              <span>{formatDate(notice.sent_at)} {formatTime(notice.sent_at)} · {notice.sent_by.full_name}</span>
              {notice.acknowledged_at ? (
                <span className="inline-flex items-center gap-1 font-semibold text-stamp-green">
                  <CheckCheck className="size-4" aria-hidden="true" />
                  اطّلعت عليه في {formatDate(notice.acknowledged_at)}
                </span>
              ) : (
                <Button variant="ink" size="sm" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(notice.notice_id)}>اطّلعت عليه</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ───────────────────────── staff: files from the client ───────────────────────── */

/** A link that opens a shared file in a new tab. */
export const FileLink = ({ fileId, name, className }: { fileId: string; name: string; className?: string }) => {
  const url = sharedFileUrl(fileId)
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-1 underline-offset-4 hover:underline', className)} dir="auto">
      <FileDown className="size-4 shrink-0" aria-hidden="true" />
      {name}
    </a>
  ) : (
    <span className={cn('inline-flex items-center gap-1', className)} dir="auto"><FileDown className="size-4" aria-hidden="true" />{name}</span>
  )
}

export const IncomingFiles = ({ caseId }: { caseId: string }) => {
  const files = useIncomingFiles(caseId)
  const handle = useHandleFile()
  if (!files.data || files.data.length === 0) return null
  const waiting = files.data.filter((entry) => entry.status === 'new').length
  return (
    <section className="mb-6 rounded-lg border border-stamp-blue/30 bg-stamp-blue/5 p-4">
      <h3 className="mb-2 flex items-center gap-2 text-lg text-ink">
        <FolderInput className="size-5 text-stamp-blue" aria-hidden="true" />
        واردة من الموكّل
        {waiting > 0 && <Pill tone="blue">{waiting === 1 ? 'ملف واحد ينتظر' : `${waiting} ملفات تنتظر`}</Pill>}
      </h3>
      <ul className="divide-y divide-rule">
        {files.data.map((entry) => (
          <li key={entry.file_id} className="flex flex-wrap items-start justify-between gap-3 py-2">
            <div className="text-sm">
              <FileLink fileId={entry.file_id} name={entry.file_name} className="font-semibold text-stamp-blue" />
              <p className="text-xs text-ink-soft">{entry.client_name} · {formatDate(entry.created_at)} {formatTime(entry.created_at)} · {formatSize(entry.size_bytes)}</p>
              {entry.note && <p className="mt-1 text-sm text-ink">«{entry.note}»</p>}
            </div>
            {entry.status === 'new' ? (
              <div className="flex gap-3">
                <button type="button" disabled={handle.isPending} onClick={() => handle.mutate({ fileId: entry.file_id, action: 'move' })} className={cn(LINK, 'text-stamp-green')}>انقل إلى مستندات القضية</button>
                <button type="button" disabled={handle.isPending} onClick={() => handle.mutate({ fileId: entry.file_id, action: 'dismiss' })} className={cn(LINK, 'text-ink-soft')}>استبعد</button>
              </div>
            ) : (
              <Pill tone={FILE_STATUS[entry.status].tone}>{entry.status === 'moved' ? 'نُقل إلى المستندات' : 'مستبعد'}</Pill>
            )}
          </li>
        ))}
      </ul>
      {handle.isError && <p role="alert" className="mt-2 text-sm text-stamp">{messageOf(handle.error)}</p>}
      <p className="mt-2 text-xs text-ink-faint">الصور تُحفظ في المستندات كملف PDF.</p>
    </section>
  )
}

/* ───────────────────────── messages: attachments ───────────────────────── */

/** The paperclip of a conversation: uploads one file and hands its id to send. */
export const AttachButton = ({ onSend }: { onSend: (fileId: string) => Promise<unknown> }) => {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pick = async (file: File | undefined) => {
    if (!file) return
    const problem = checkFile(file)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const uploaded = await uploadSharedFile(file, 'message')
      await onSend(uploaded.file_id)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <input ref={input} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={(event) => void pick(event.target.files?.[0])} aria-hidden="true" tabIndex={-1} />
      <Button variant="line" size="sm" disabled={busy} onClick={() => input.current?.click()} aria-label="أرفق ملفاً">
        <Paperclip className="size-4" aria-hidden="true" />
        {busy ? 'يُرفع…' : 'مرفق'}
      </Button>
      {error && <span role="alert" className="text-xs text-stamp">{error}</span>}
    </span>
  )
}

/** A file in a chat bubble; staff can move a client's file into a case's documents. */
export const AttachmentView = ({ attachment, mine, staffCanMove }: { attachment: Attachment; mine: boolean; staffCanMove: boolean }) => {
  const [moving, setMoving] = useState(false)
  return (
    <div className="mb-1 space-y-1">
      <FileLink fileId={attachment.file_id} name={attachment.file_name} className={cn('text-sm font-semibold', mine ? 'text-paper' : 'text-stamp-blue')} />
      <p className={cn('text-[0.68rem]', mine ? 'text-paper/60' : 'text-ink-faint')}>
        {formatSize(attachment.size_bytes)}
        {staffCanMove && attachment.status === 'new' && (
          <>
            {' · '}
            <button type="button" onClick={() => setMoving(true)} className="font-semibold underline-offset-4 hover:underline">أضفه إلى مستندات قضية</button>
          </>
        )}
        {attachment.status === 'moved' && ' · في مستندات القضية'}
      </p>
      {moving && <MoveDialog fileId={attachment.file_id} onClose={() => setMoving(false)} />}
    </div>
  )
}

const MoveDialog = ({ fileId, onClose }: { fileId: string; onClose: () => void }) => {
  const cases = useQuery({ queryKey: ['cases', ''], queryFn: async () => (await api.get<{ cases: LegalCase[] }>('/cases', { params: { pageSize: 50 } })).data.cases })
  const handle = useHandleFile()
  const [caseId, setCaseId] = useState('')
  return (
    <Modal open onClose={onClose} title="إضافة الملف إلى مستندات قضية">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          handle.mutate({ fileId, action: 'move', caseId }, { onSuccess: onClose })
        }}
        className="space-y-4"
      >
        <SelectField
          label="القضية"
          name="move_case"
          required
          value={caseId}
          onChange={(event) => setCaseId(event.target.value)}
          options={[['', cases.isPending ? 'يُحمَّل…' : 'اختر قضية'], ...(cases.data ?? []).map((row) => [row.case_id, `${row.case_number} — ${row.title}`] as const)]}
        />
        <p className="text-xs text-ink-faint">يجب أن يكون الموكّل طرفاً في القضية المختارة. الصورة تُحفظ كملف PDF.</p>
        <FormActions error={handle.isError ? messageOf(handle.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={!caseId || handle.isPending}>{handle.isPending ? 'يُضاف…' : 'أضف'}</Button>
        </FormActions>
      </form>
    </Modal>
  )
}

/* ───────────────────────── staff: official notices on a case ───────────────────────── */

const NewNotice = ({ caseId, open, onClose }: { caseId: string; open: boolean; onClose: () => void }) => {
  const relationships = useQuery({
    queryKey: ['relationships', caseId],
    enabled: open,
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${caseId}/relationships`)).data.relationships,
  })
  const hearings = useCaseHearings(caseId)
  const send = useSendNotice(caseId)
  const [clientId, setClientId] = useState('')
  const [kind, setKind] = useState<NoticeKind>('hearing')
  const [hearingId, setHearingId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const parties = relationships.data?.clients ?? []
  const upcoming = (hearings.data ?? []).filter((hearing) => hearing.status === 'scheduled')

  useEffect(() => {
    if (!open) return
    send.reset()
    setClientId(parties.length === 1 ? parties[0]!.client_id : '')
    setKind('hearing')
    setHearingId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parties.length])

  // The suggested text follows the choices until the lawyer edits it.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchNoticeDraft(caseId, { kind, clientId: clientId || undefined, hearingId: hearingId || undefined })
      .then((draft) => {
        if (cancelled) return
        setTitle(draft.title)
        setBody(draft.body)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, caseId, kind, clientId, hearingId])

  return (
    <Modal open={open} onClose={onClose} title="إشعار رسمي للموكّل" wide>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          send.mutate({ client_id: clientId, kind, ...(kind === 'hearing' && hearingId ? { hearing_id: hearingId } : {}), title: title.trim(), body: body.trim() }, { onSuccess: onClose })
        }}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="الموكّل" name="notice_client" required value={clientId} onChange={(event) => setClientId(event.target.value)} options={[['', 'اختر الموكّل'], ...parties.map((party) => [party.client_id, party.full_name_or_org] as const)]} />
          <SelectField label="النوع" name="notice_kind" value={kind} onChange={(event) => setKind(event.target.value as NoticeKind)} options={Object.entries(NOTICE_KIND) as [NoticeKind, string][]} />
        </div>
        {kind === 'hearing' && (
          <SelectField
            label="الجلسة"
            name="notice_hearing"
            value={hearingId}
            onChange={(event) => setHearingId(event.target.value)}
            options={[['', upcoming.length ? 'اختر الجلسة' : 'لا جلسات قادمة مسجّلة'], ...upcoming.map((hearing) => [hearing.hearing_id, `${formatDate(hearing.hearing_at)} ${formatTime(hearing.hearing_at)} — ${hearing.hearing_type}`] as const)]}
          />
        )}
        <Field label="العنوان" name="notice_title" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
        <TextArea label="نص الإشعار" name="notice_body" required rows={6} maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} />
        <p className="text-xs text-ink-faint">يصل إلى بوابة الموكّل وإشعارات جهازه وبريده، ويُجهَّز للإرسال على واتساب. يُسجَّل كل ذلك مع وقت اطّلاعه.</p>
        <FormActions error={send.isError ? messageOf(send.error) : null}>
          <Button variant="line" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="ink" disabled={!clientId || !title.trim() || !body.trim() || send.isPending}>
            <Send className="size-4" aria-hidden="true" />
            {send.isPending ? 'يُرسل…' : 'أرسل الإشعار'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  )
}

export const CaseNotices = ({ caseId }: { caseId: string }) => {
  const notices = useCaseNotices(caseId)
  const record = useRecordWhatsApp(caseId)
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-soft">إشعارات رسمية للموكّل بموعد جلسة أو صدور حكم، مع سجل ما وصل على كل قناة ووقت اطّلاعه.</p>
        <Button variant="ink" size="sm" onClick={() => setOpen(true)}>
          <Send className="size-4" aria-hidden="true" />
          إشعار جديد
        </Button>
      </div>
      {notices.isPending ? (
        <Loading />
      ) : notices.isError ? (
        <Failed error={notices.error} />
      ) : notices.data.length === 0 ? (
        <Empty>لم يُرسل أي إشعار رسمي في هذه القضية بعد.</Empty>
      ) : (
        <ul className="space-y-3">
          {notices.data.map((notice) => {
            const whatsappSent = (notice.deliveries ?? []).some((entry) => entry.channel === 'whatsapp' && entry.status === 'sent')
            return (
              <li key={notice.notice_id} className="rounded-lg border border-rule bg-paper p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{notice.title}</p>
                    <p className="text-xs text-ink-soft">إلى {notice.client_name} · {formatDate(notice.sent_at)} {formatTime(notice.sent_at)} · {notice.sent_by.full_name}</p>
                  </div>
                  {notice.acknowledged_at ? (
                    <Pill tone="green">اطّلع في {formatDate(notice.acknowledged_at)}</Pill>
                  ) : (
                    <Pill tone="ink">لم يطّلع بعد</Pill>
                  )}
                </div>
                <p className="mt-2 text-sm whitespace-pre-line text-ink">{notice.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-2">
                  {latestDeliveries(notice.deliveries).map((entry) => (
                    <span key={entry.channel} className="text-xs text-ink-soft">
                      {CHANNEL[entry.channel]}: <Pill tone={DELIVERY_STATUS[entry.status].tone}>{DELIVERY_STATUS[entry.status].text}</Pill>
                    </span>
                  ))}
                </div>
                {notice.whatsapp_url && !whatsappSent && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <a href={notice.whatsapp_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-[#1f8f4d] px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">
                      <MessageCircle className="size-4" aria-hidden="true" />
                      أرسل على واتساب
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                    <button type="button" disabled={record.isPending} onClick={() => record.mutate(notice.notice_id)} className={cn(LINK, 'text-stamp-green')}>
                      أرسلته — سجّل ذلك
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {record.isError && <p role="alert" className="text-sm text-stamp">{messageOf(record.error)}</p>}
      <NewNotice caseId={caseId} open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

