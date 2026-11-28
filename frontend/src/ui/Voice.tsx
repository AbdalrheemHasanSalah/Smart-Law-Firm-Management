import { Mic, MicOff, Send, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { messageOf } from '@/lib/api'
import { MAX_SECONDS, canDictate, canRecord, formatDuration, uploadVoice, useDictation, useVoiceRecorder, voiceUrl, type VoiceClip } from '@/lib/voice'
import { Button, cn } from './kit'

/**
 * Microphone button that types what is said into a field. Hidden where the browser has no
 * dictation (Firefox). The note under it says where the audio goes.
 */
export const DictateButton = ({ onText, className }: { onText: (text: string) => void; className?: string }) => {
  const dictation = useDictation(onText)
  if (!canDictate()) return null
  return (
    <span className={cn('inline-flex flex-col items-start gap-1', className)}>
      <button
        type="button"
        onClick={dictation.listening ? dictation.stop : dictation.start}
        aria-pressed={dictation.listening}
        aria-label={dictation.listening ? 'أوقف الكتابة بالصوت' : 'اكتب بالصوت'}
        title="يعالج المتصفح الصوت عبر خدمة الإملاء لديه (Google في Chrome، وMicrosoft في Edge، وApple في Safari)."
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
          dictation.listening ? 'animate-pulse bg-stamp text-paper' : 'border border-ink/20 text-ink-soft hover:border-ink hover:text-ink',
        )}
      >
        {dictation.listening ? <MicOff className="size-3.5" aria-hidden="true" /> : <Mic className="size-3.5" aria-hidden="true" />}
        {dictation.listening ? 'أوقف' : 'اكتب بالصوت'}
      </button>
      {dictation.listening && dictation.interim && <span className="text-xs text-ink-faint" aria-live="polite">{dictation.interim}…</span>}
      {dictation.error && <span role="alert" className="text-xs text-stamp">{dictation.error}</span>}
    </span>
  )
}

/** Plays a stored recording. */
export const VoicePlayer = ({ clip, className }: { clip: VoiceClip; className?: string }) => {
  const source = voiceUrl(clip.clip_id)
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {source ? (
        <>
          <audio controls preload="metadata" src={source} className="h-9 max-w-full" aria-label={`رسالة صوتية مدتها ${formatDuration(clip.duration_seconds)}`} />
          {/* Chrome's WebM recordings carry no length, so its player shows 0:00 until played. */}
          <span className="text-xs tabular-nums opacity-70" aria-hidden="true">{formatDuration(clip.duration_seconds)}</span>
        </>
      ) : (
        <span className="text-xs text-ink-faint">رسالة صوتية ({formatDuration(clip.duration_seconds)}) — لا تُشغَّل في وضع التجربة بعد إعادة تحميل الصفحة</span>
      )}
    </span>
  )
}

/**
 * Record → listen → send, up to two minutes. `onSend` receives the uploaded clip and does the
 * sending (a message, a note); the recorder resets when it succeeds.
 */
export const VoiceRecorder = ({ onSend, sendLabel = 'أرسل', disabled = false }: { onSend: (clip: VoiceClip) => Promise<unknown>; sendLabel?: string; disabled?: boolean }) => {
  const recorder = useVoiceRecorder()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!canRecord()) return null
  const { state } = recorder

  const send = async () => {
    if (state.status !== 'ready') return
    setBusy(true)
    setError(null)
    try {
      const clip = await uploadVoice(state.blob, state.seconds)
      await onSend(clip)
      recorder.discard()
    } catch (problem) {
      setError(messageOf(problem))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.status === 'recording' ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-stamp" aria-live="polite">
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-stamp" />
            {formatDuration(state.seconds)} / {formatDuration(MAX_SECONDS)}
          </span>
          <Button variant="ink" size="sm" onClick={recorder.stop}>
            <Square className="size-3.5" aria-hidden="true" />
            أنهِ التسجيل
          </Button>
          <Button variant="ghost" size="sm" onClick={recorder.discard} aria-label="ألغِ التسجيل">
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </>
      ) : state.status === 'ready' ? (
        <>
          <audio controls src={state.url} className="h-9 max-w-full" aria-label="استمع إلى التسجيل قبل إرساله" />
          <Button variant="ink" size="sm" disabled={busy || disabled} onClick={() => void send()}>
            <Send className="size-3.5" aria-hidden="true" />
            {busy ? 'يُرسل…' : sendLabel}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={recorder.discard} aria-label="احذف التسجيل">
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </>
      ) : (
        <Button variant="line" size="sm" disabled={disabled} onClick={() => void recorder.start()} aria-label="سجّل رسالة صوتية">
          <Mic className="size-4" aria-hidden="true" />
          رسالة صوتية
        </Button>
      )}
      {state.status === 'error' && <span role="alert" className="text-xs text-stamp">{state.message}</span>}
      {error && <span role="alert" className="text-xs text-stamp">{error}</span>}
    </div>
  )
}
