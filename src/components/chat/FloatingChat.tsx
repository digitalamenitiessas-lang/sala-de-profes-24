'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Coffee,
  Send,
  Bot,
  User,
  Sparkles,
  Loader2,
  X,
  Check,
  Mic,
  MicOff,
} from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { AnimatePresence, motion } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionProposal = {
  intent: string
  items?: { name: string; quantity: string }[]
  message?: string
  urgency?: string
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  actionProposal?: ActionProposal
  actionExecuted?: boolean
}

// ---------------------------------------------------------------------------
// Markdown renderer (lightweight)
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="mb-1 mt-2.5 text-xs font-bold first:mt-0">{parseBold(line.slice(4))}</h4>)
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="mb-1 mt-2.5 text-[13px] font-bold first:mt-0">{parseBold(line.slice(3))}</h3>)
      continue
    }
    if (line.startsWith('- ')) {
      elements.push(
        <div key={i} className="flex gap-1.5 py-0.5 pl-1">
          <span className="shrink-0 text-[10px] leading-relaxed">•</span>
          <span>{parseBold(line.slice(2))}</span>
        </div>,
      )
      continue
    }
    const numMatch = line.match(/^(\d+)\.\s(.+)/)
    if (numMatch) {
      elements.push(
        <div key={i} className="flex gap-1.5 py-0.5 pl-1">
          <span className="shrink-0 font-semibold text-[#006d5a]">{numMatch[1]}.</span>
          <span>{parseBold(numMatch[2])}</span>
        </div>,
      )
      continue
    }
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />)
      continue
    }
    elements.push(<p key={i} className="py-0.5">{parseBold(line)}</p>)
  }

  return <>{elements}</>
}

function parseBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    return part
  })
}

// ---------------------------------------------------------------------------
// Suggested questions by role
// ---------------------------------------------------------------------------

type SQ = { label: string; question: string }

const SQ_ENCARGADO: SQ[] = [
  { label: '📋 Resumen', question: 'Dame un resumen ejecutivo del día: asistencia, stock crítico, pedidos pendientes y avisos urgentes.' },
  { label: '👥 Equipo', question: '¿Quién está trabajando hoy y quién tiene turno programado?' },
  { label: '🔴 Stock', question: '¿Qué items de stock general y barra están en rojo o hay que pedir urgente?' },
  { label: '🛒 Pedidos', question: '¿Qué productos necesito pedir, a qué proveedor y con qué urgencia?' },
]

const SQ_BARISTA: SQ[] = [
  { label: '☕ Stock', question: '¿Cómo está el stock de barra hoy? ¿Qué falta?' },
  { label: '📦 Pedidos', question: '¿Hay pedidos de barra pendientes?' },
  { label: '🛒 Pedir', question: 'Necesito leche entera 10lt y café 2kg' },
]

const SQ_COCINA: SQ[] = [
  { label: '🥩 Stock', question: '¿Qué items de stock cocina están bajos?' },
  { label: '🛒 Pedir', question: 'Necesito 5kg de nalga y 3kg de morrón' },
  { label: '📖 Recetas', question: '¿Cómo se hace el lomo LVE?' },
  { label: '⚠️ Reportar', question: 'La freidora no enciende bien' },
]

const SQ_RUNNER: SQ[] = [
  { label: '⏰ Mi turno', question: '¿Cuál es mi turno hoy y mañana?' },
  { label: '⚠️ Avisos', question: '¿Hay avisos importantes para mí?' },
]

function getSuggested(role?: string): SQ[] {
  switch (role) {
    case 'encargado': case 'socio': return SQ_ENCARGADO
    case 'barista': return SQ_BARISTA
    case 'chef': case 'cocina': return SQ_COCINA
    default: return SQ_RUNNER
  }
}

function getGreeting(role?: string): string {
  switch (role) {
    case 'encargado': case 'socio': return 'Preguntame nomás lo que necesités saber del local.'
    case 'barista': return 'Preguntame sobre la barra, stock o pedidos.'
    case 'chef': case 'cocina': return 'Preguntame sobre cocina, recetas o stock.'
    default: return 'Preguntame lo que necesités saber.'
  }
}

// ---------------------------------------------------------------------------
// FloatingChat Component
// ---------------------------------------------------------------------------

export function FloatingChat() {
  const { profile } = useProfileContext()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = sessionStorage.getItem('chat-messages')
      if (!saved) return []
      const parsed = JSON.parse(saved) as ChatMessage[]
      return parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
    } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [isListening, setIsListening] = useState(false)
  const isListeningRef = useRef(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Persist messages to sessionStorage
  useEffect(() => {
    if (messages.length > 0) {
      try { sessionStorage.setItem('chat-messages', JSON.stringify(messages.slice(-20))) } catch { /* full storage */ }
    }
  }, [messages])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200)
      setHasUnread(false)
    }
  }, [open])

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsThinking(false)
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Mensaje cancelado.',
        timestamp: new Date(),
      },
    ])
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const handleSend = useCallback(async (text?: string) => {
    const messageText = (text ?? input).trim()
    if (!messageText || isThinking) return

    // Abort any previous in-flight request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsThinking(true)

    try {
      const history = [...messages, userMessage]
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, history }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error('Error')

      const data = await res.json()

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.response ?? 'No pude procesar tu consulta.',
          timestamp: new Date(),
          actionProposal: data.actionProposal ?? undefined,
          actionExecuted: data.actionExecuted ?? undefined,
        },
      ])

      if (!open) setHasUnread(true)
    } catch (err) {
      // If aborted by user, don't add error message (handleCancel already did)
      if (err instanceof DOMException && err.name === 'AbortError') return

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Hubo un error. Intentá de nuevo.',
          timestamp: new Date(),
        },
      ])
    } finally {
      if (!controller.signal.aborted) {
        setIsThinking(false)
        setTimeout(() => inputRef.current?.focus(), 100)
      }
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [input, isThinking, messages, open])

  // Confirm an action proposal
  const handleConfirmAction = useCallback(async (proposal: ActionProposal) => {
    if (isThinking) return

    // Abort any previous in-flight request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsThinking(true)

    // Add user confirmation message
    setMessages(prev => [...prev.map((msg) => (
      msg.actionProposal && !msg.actionExecuted ? { ...msg, actionProposal: undefined } : msg
    )), {
      id: crypto.randomUUID(),
      role: 'user',
      content: '✅ Confirmado',
      timestamp: new Date(),
    }])

    try {
      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'confirmar acción',
          confirmAction: proposal,
        }),
        signal: controller.signal,
      })

      const data = await res.json()

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response ?? 'Acción ejecutada.',
        timestamp: new Date(),
        actionExecuted: data.actionExecuted ?? false,
      }])
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Hubo un error al ejecutar la acción. Intentá de nuevo.',
        timestamp: new Date(),
      }])
    } finally {
      if (!controller.signal.aborted) {
        setIsThinking(false)
      }
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [isThinking])

  // Cancel an action proposal
  const handleCancelAction = useCallback(() => {
    setMessages(prev => [...prev.map((msg) => (
      msg.actionProposal && !msg.actionExecuted ? { ...msg, actionProposal: undefined } : msg
    )), {
      id: crypto.randomUUID(),
      role: 'user',
      content: '❌ Cancelar',
      timestamp: new Date(),
    }, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Dale, no hay drama. Si necesitás algo más, decime nomás.',
      timestamp: new Date(),
    }])
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Voice input via Web Speech API
  const [supportsVoice, setSupportsVoice] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const W = window as any
    setSupportsVoice(!!(W.SpeechRecognition ?? W.webkitSpeechRecognition))
  }, [])

  const toggleVoice = useCallback(() => {
    if (isListening) {
      // User pressed mic button to STOP → stop recognition and send
      isListeningRef.current = false
      recognitionRef.current?.stop()
      setIsListening(false)
      // Send whatever was transcribed
      setInput(prev => {
        if (prev.trim()) {
          setTimeout(() => handleSend(prev.trim()), 100)
        }
        return prev
      })
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const W = window as any
    const SpeechRecognition = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setInput('(Tu navegador no soporta voz)')
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.lang = 'es-AR'
      recognition.continuous = true      // Keep listening until user stops
      recognition.interimResults = true   // Show words as they're spoken
      recognition.maxAlternatives = 1
      recognitionRef.current = recognition

      recognition.onstart = () => {
        isListeningRef.current = true
        setIsListening(true)
        setInput('')
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        // Build full transcript from all results (continuous mode accumulates)
        const transcript = Array.from(event.results)
          .map(r => r[0].transcript)
          .join('')

        setInput(transcript)
        // Don't auto-send — user controls when to stop via mic button
      }

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'not-allowed') {
          setIsListening(false)
          setInput('⚠️ Permití el micrófono en tu navegador')
        } else if (event.error === 'no-speech') {
          // In continuous mode, no-speech is normal during pauses — keep listening
        } else if (event.error === 'aborted') {
          // User stopped — normal
          setIsListening(false)
        } else {
          setIsListening(false)
          setInput(`Error de voz: ${event.error}`)
        }
      }

      recognition.onend = () => {
        // In continuous mode, browser may stop recognition after silence.
        // If user hasn't explicitly stopped, restart automatically.
        // Use ref (not state) to avoid stale closure.
        if (isListeningRef.current) {
          try {
            recognition.start()
          } catch {
            isListeningRef.current = false
            setIsListening(false)
          }
        }
      }

      recognition.start()
    } catch {
      setIsListening(false)
      setInput('Error al iniciar el micrófono')
    }
  }, [isListening, handleSend])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      abortRef.current?.abort()
    }
  }, [])

  if (!profile) return null

  const suggested = getSuggested(profile.role)

  return (
    <>
      {/* FAB button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-20 left-4 z-50 flex size-12 items-center justify-center rounded-full bg-[#006d5a] text-white shadow-lg shadow-[#006d5a]/25 transition-transform hover:scale-105 active:scale-95 sm:bottom-28 sm:left-6"
            aria-label="Abrir asistente"
          >
            <Coffee className="size-5" />
            {/* Unread dot */}
            {hasUnread && (
              <span className="absolute -right-0.5 -top-0.5 flex size-3.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ea504c] opacity-75" />
                <span className="relative inline-flex size-3.5 rounded-full bg-[#ea504c]" />
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-[#ebe6df] bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.08)] sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-[380px] sm:rounded-2xl sm:border sm:shadow-2xl sm:shadow-black/10"
            style={{ height: 'min(calc(100svh - 5rem), 600px)' }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-[#ebe6df] bg-[#006d5a] px-4 py-3 rounded-t-2xl">
              <div className="flex size-8 items-center justify-center rounded-lg bg-white/15">
                <Coffee className="size-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-white">La Vieja de Historia</h3>
                <p className="text-[10px] text-white/60">Asistente del café ☕</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex size-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Cerrar chat"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {/* Welcome */}
              {messages.length === 0 && !isThinking && (
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-[#f0f7f5]">
                    <Sparkles className="size-6 text-[#006d5a]" />
                  </div>
                  <div className="text-center">
                    <p className="font-display text-base font-semibold text-[#3d2c24]">
                      ¡Hola {profile.first_name}, che!
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#a39e97]">
                      {getGreeting(profile.role)}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5 px-2">
                    {suggested.map((sq) => (
                      <button
                        key={sq.question}
                        onClick={() => handleSend(sq.question)}
                        className="rounded-full border border-[#ebe6df] bg-[#fefcf9] px-3 py-1.5 text-[11px] font-medium text-[#006d5a] transition-colors hover:bg-[#f0f7f5]"
                      >
                        {sq.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages */}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${
                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  <div
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                      msg.role === 'user'
                        ? 'bg-[#006d5a] text-white'
                        : 'border border-[#ebe6df] bg-[#fefcf9] text-[#006d5a]'
                    }`}
                  >
                    {msg.role === 'user' ? <User className="size-3" /> : <Bot className="size-3" />}
                  </div>
                  <div
                    className={`max-w-[80%] px-3 py-2 text-[13px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'rounded-2xl rounded-br-md bg-[#006d5a] text-white'
                        : 'rounded-2xl rounded-bl-md border border-[#ebe6df] bg-[#fefcf9] text-[#3d2c24]'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="whitespace-pre-wrap">{renderMarkdown(msg.content)}</div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}

                    {/* Action confirmation buttons */}
                    {msg.actionProposal && !msg.actionExecuted && (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleConfirmAction(msg.actionProposal!)}
                          disabled={isThinking}
                          className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#005a4a] active:scale-95 disabled:opacity-50"
                        >
                          <Check className="size-3" />
                          Confirmar
                        </button>
                        <button
                          onClick={handleCancelAction}
                          className="rounded-lg border border-[#ebe6df] px-3 py-1.5 text-xs font-medium text-[#a39e97] transition-colors hover:bg-[#f3efe9]"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}

                    {/* Action executed badge */}
                    {msg.actionExecuted && (
                      <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-[#006d5a]">
                        <Check className="size-3" />
                        Acción ejecutada
                      </div>
                    )}

                    <p className={`mt-1 text-[9px] ${msg.role === 'user' ? 'text-white/40' : 'text-[#a39e97]'}`}>
                      {msg.timestamp.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}

              {/* Thinking */}
              {isThinking && (
                <div className="flex items-end gap-2">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[#ebe6df] bg-[#fefcf9] text-[#006d5a]">
                    <Bot className="size-3" />
                  </div>
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-[#ebe6df] bg-[#fefcf9] px-4 py-2.5">
                    <span className="size-1.5 animate-bounce rounded-full bg-[#006d5a] [animation-delay:0ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-[#006d5a] [animation-delay:150ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-[#006d5a] [animation-delay:300ms]" />
                    <button
                      onClick={handleCancel}
                      className="ml-2 flex items-center gap-1 rounded-full border border-[#ebe6df] bg-white px-2 py-0.5 text-[10px] font-medium text-[#a39e97] transition-colors hover:border-[#ea504c]/40 hover:text-[#ea504c]"
                    >
                      <X className="size-2.5" />
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Quick questions after messages */}
              {messages.length > 0 && !isThinking && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {suggested.slice(0, 3).map((sq) => (
                    <button
                      key={sq.question}
                      onClick={() => handleSend(sq.question)}
                      className="rounded-full border border-[#ebe6df] bg-[#fefcf9] px-2.5 py-1 text-[10px] font-medium text-[#006d5a] transition-colors hover:bg-[#f0f7f5]"
                    >
                      {sq.label}
                    </button>
                  ))}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 border-t border-[#ebe6df] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl sm:pb-3">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? 'Escuchando...' : 'Preguntá algo...'}
                disabled={isThinking}
                className={`flex-1 rounded-xl border bg-[#faf8f5] px-3 py-2 text-sm placeholder:text-[#a39e97] focus:outline-none focus:ring-2 disabled:opacity-50 ${
                  isListening
                    ? 'border-[#ea504c] ring-2 ring-[#ea504c]/30 placeholder:text-[#ea504c]'
                    : 'border-[#ebe6df] focus:border-[#006d5a] focus:ring-[#006d5a]/20'
                }`}
              />
              {/* Mic button */}
              {supportsVoice && (
                <button
                  onClick={toggleVoice}
                  disabled={isThinking}
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-40 ${
                    isListening
                      ? 'bg-[#ea504c] text-white shadow-md animate-pulse'
                      : 'bg-[#f3efe9] text-[#a39e97] hover:bg-[#ebe6df] hover:text-[#3d2c24]'
                  }`}
                  aria-label={isListening ? 'Dejar de escuchar' : 'Hablar'}
                >
                  {isListening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                </button>
              )}
              {/* Send button */}
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isThinking}
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#006d5a] text-white shadow-sm transition-colors hover:bg-[#005a4a] disabled:opacity-40"
                aria-label="Enviar"
              >
                {isThinking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
