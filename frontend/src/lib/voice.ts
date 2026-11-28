/**
 * Voice: recording and playing voice messages, and dictation (speech to text).
 *
 * The browser's MediaRecorder and SpeechRecognition sit behind two small adapters
 * (`createRecorder`, `createDictation`). A React Native client replaces only those two with the
 * phone's own recorder and dictation; the upload, the limits and the hooks stay as they are.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, API_URL, DEMO } from './api'

export const MAX_SECONDS = 120
export type VoiceClip = { clip_id: string; duration_seconds: number }

/** "1:05" */
export const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/* ───────────── playback ───────────── */

/** Demo mode has no server: recordings stay in this page as object URLs. */
const demoClips = new Map<string, string>()

export const voiceUrl = (clipId: string) => (DEMO ? demoClips.get(clipId) ?? '' : `${API_URL}/voice/${clipId}`)

/* ───────────── upload ───────────── */

/** Uploads a finished recording; attach the returned clip_id to a message or a note. */
export const uploadVoice = async (blob: Blob, seconds: number): Promise<VoiceClip> => {
  const duration = Math.min(MAX_SECONDS, Math.max(1, Math.round(seconds)))
  if (DEMO) {
    const clip = { clip_id: `vc-${Math.random().toString(36).slice(2, 9)}-${duration}`, duration_seconds: duration }
    demoClips.set(clip.clip_id, URL.createObjectURL(blob))
    return clip
  }
  const type = blob.type.split(';')[0] || 'audio/webm'
  const { data } = await api.post<{ clip: VoiceClip }>('/voice', blob, {
    headers: { 'Content-Type': type, 'X-Duration-Seconds': String(duration) },
    timeout: 60_000,
  })
  return data.clip
}

/* ───────────── recording adapter (web) ───────────── */

type Recorder = { stop: () => void; cancel: () => void }

/** The first container this browser records: WebM/Opus, Ogg/Opus, then MP4 (Safari). */
const recordingType = () => {
  if (typeof MediaRecorder === 'undefined') return null
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

export const canRecord = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && recordingType() !== null

async function createRecorder(onDone: (blob: Blob) => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const type = recordingType()
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
  const chunks: Blob[] = []
  let cancelled = false
  recorder.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data)
  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop())
    if (!cancelled) onDone(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }))
  }
  recorder.start()
  return {
    stop: () => recorder.state !== 'inactive' && recorder.stop(),
    cancel: () => {
      cancelled = true
      if (recorder.state !== 'inactive') recorder.stop()
    },
  }
}

export type RecorderState =
  | { status: 'idle' }
  | { status: 'recording'; seconds: number }
  | { status: 'ready'; blob: Blob; seconds: number; url: string }
  | { status: 'error'; message: string }

/** Records up to MAX_SECONDS, stopping by itself at the limit; then the recording can be sent or discarded. */
export const useVoiceRecorder = () => {
  const [state, setState] = useState<RecorderState>({ status: 'idle' })
  const recorder = useRef<Recorder | null>(null)
  const started = useRef(0)
  const timer = useRef<number | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
  }

  const stop = useCallback(() => recorder.current?.stop(), [])

  const start = useCallback(async () => {
    try {
      recorder.current = await createRecorder((blob) => {
        clearTimer()
        const seconds = Math.min(MAX_SECONDS, (Date.now() - started.current) / 1000)
        setState(seconds < 1 ? { status: 'idle' } : { status: 'ready', blob, seconds, url: URL.createObjectURL(blob) })
      })
      started.current = Date.now()
      setState({ status: 'recording', seconds: 0 })
      timer.current = window.setInterval(() => {
        const seconds = (Date.now() - started.current) / 1000
        if (seconds >= MAX_SECONDS) recorder.current?.stop()
        else setState({ status: 'recording', seconds })
      }, 250)
    } catch {
      setState({ status: 'error', message: 'تعذّر الوصول إلى الميكروفون. اسمح للموقع باستعماله من إعدادات المتصفح.' })
    }
  }, [])

  const discard = useCallback(() => {
    clearTimer()
    recorder.current?.cancel()
    setState((current) => {
      if (current.status === 'ready') URL.revokeObjectURL(current.url)
      return { status: 'idle' }
    })
  }, [])

  useEffect(() => () => {
    clearTimer()
    recorder.current?.cancel()
  }, [])

  return { state, start, stop, discard }
}

/* ───────────── dictation adapter (web) ───────────── */

type SpeechResultEvent = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

const speechConstructor = () => {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
}

export const canDictate = () => speechConstructor() !== null

/** Arabic as spoken in Palestine; the browser falls back to its nearest Arabic. */
export const DICTATION_LANGUAGE = 'ar-PS'

/**
 * Dictation: each finished phrase is handed to `onText`; `interim` shows what is being heard.
 * The audio is processed by the browser's own speech service (Google in Chrome, Microsoft in
 * Edge, Apple in Safari), which the screens say next to the microphone.
 */
export const useDictation = (onText: (text: string) => void) => {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognition = useRef<SpeechRecognitionLike | null>(null)
  const latest = useRef(onText)
  latest.current = onText

  const stop = useCallback(() => recognition.current?.stop(), [])

  const start = useCallback(() => {
    const Speech = speechConstructor()
    if (!Speech) return
    setError(null)
    const engine = new Speech()
    engine.lang = DICTATION_LANGUAGE
    engine.continuous = true
    engine.interimResults = true
    engine.onresult = (event) => {
      let pending = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]!
        if (result.isFinal) latest.current(result[0].transcript.trim())
        else pending += result[0].transcript
      }
      setInterim(pending)
    }
    engine.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setError('اسمح للموقع باستعمال الميكروفون لتعمل الكتابة بالصوت.')
      else if (event.error !== 'no-speech' && event.error !== 'aborted') setError('توقفت الكتابة بالصوت. أعد المحاولة.')
    }
    engine.onend = () => {
      setListening(false)
      setInterim('')
    }
    recognition.current = engine
    engine.start()
    setListening(true)
  }, [])

  useEffect(() => () => recognition.current?.stop(), [])

  return { listening, interim, error, start, stop }
}

/** Adds dictated text to what is already typed, with one space or line between them. */
export const appendText = (current: string, addition: string) => {
  if (!addition) return current
  if (!current.trim()) return addition
  return /\s$/.test(current) ? `${current}${addition}` : `${current} ${addition}`
}
