'use client'

import { useRef, useState, useCallback } from 'react'

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mimeRef = useRef('audio/webm')

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Safari records audio/mp4; Chrome/Firefox audio/webm
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      mimeRef.current = mime
      // 64 kbps is plenty for speech and keeps long recordings small — a 7-min
      // note is ~3 MB instead of ~7 MB. Prevents oversized-upload failures.
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: mime })
        setBlob(b)
        setPreviewUrl(URL.createObjectURL(b))
        stream.getTracks().forEach(t => t.stop())
      }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch {
      setError('Microphone access denied — check browser permissions.')
    }
  }, [])

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    recorderRef.current?.stop()
    setRecording(false)
  }, [])

  const reset = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (recorderRef.current && recording) recorderRef.current.stop()
    setRecording(false)
    setBlob(null)
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setElapsed(0)
    setError(null)
  }, [recording])

  // File for upload, with the right extension for the recorded container
  const toFile = useCallback(() => {
    if (!blob) return null
    const ext = mimeRef.current === 'audio/mp4' ? 'm4a' : 'webm'
    return new File([blob], `recording.${ext}`, { type: mimeRef.current })
  }, [blob])

  return { recording, blob, previewUrl, elapsed, error, start, stop, reset, toFile }
}
