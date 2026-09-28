'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Coffee,
  Send,
  Bot,
  User,
  Sparkles,
  Loader2,
  Check,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProfileContext } from '@/lib/hooks/use-profile'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  actionProposal?: ActionProposal
  actionExecuted?: boolean
}

type ActionProposal = {
  intent: string
  items?: { name: string; quantity: string }[]
  message?: string
  urgency?: string
}

// ---------------------------------------------------------------------------
// Simple markdown renderer for bot messages
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="mb-1 mt-3 text-xs font-bold first:mt-0">{parseBoldAndEmoji(line.slice(4))}</h4>)
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="mb-1.5 mt-3 text-sm font-bold first:mt-0">{parseBoldAndEmoji(line.slice(3))}</h3>)
      continue
    }

    // List items
    if (line.startsWith('- ')) {
      elements.push(
        <div key={i} className="flex gap-1.5 py-0.5 pl-1">
          <span className="shrink-0 text-[10px] leading-relaxed">•</span>
          <span>{parseBoldAndEmoji(line.slice(2))}</span>
        </div>
      )
      continue
    }

    // Numbered list
    const numMatch = line.match(/^(\d+)\.\s(.+)/)
    if (numMatch) {
      elements.push(
        <div key={i} className="flex gap-1.5 py-0.5 pl-1">
          <span className="shrink-0 font-semibold text-[#006d5a]">{numMatch[1]}.</span>
          <span>{parseBoldAndEmoji(numMatch[2])}</span>
        </div>
      )
      continue
    }

    // Empty line = spacer
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-1.5" />)
      continue
    }

    // Regular paragraph
    elements.push(<p key={i} className="py-0.5">{parseBoldAndEmoji(line)}</p>)
  }

  return <>{elements}</>
}

function parseBoldAndEmoji(text: string): React.ReactNode {
  // Parse **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    return part
  })
}

// ---------------------------------------------------------------------------
// Preguntas sugeridas por rol
// ---------------------------------------------------------------------------

type SuggestedQuestion = { label: string; question: string }

const SUGGESTED_ENCARGADO: SuggestedQuestion[] = [
  { label: '📋 Resumen del día', question: 'Dame un resumen ejecutivo del día: asistencia, stock crítico, pedidos pendientes y avisos urgentes.' },
  { label: '👥 ¿Quién trabaja?', question: '¿Quién está trabajando hoy y quién tiene turno programado?' },
  { label: '🔴 Stock crítico', question: '¿Qué items de stock general y barra están en rojo o hay que pedir urgente?' },
  { label: '☕ Estado de barra', question: '¿Cómo está el stock de barra y hay pedidos pendientes?' },
  { label: '⚠️ Avisos urgentes', question: '¿Qué avisos urgentes hay activos?' },
  { label: '🛒 Qué hay que pedir', question: '¿Qué productos necesito pedir, a qué proveedor y con qué urgencia?' },
]

const SUGGESTED_BARISTA: SuggestedQuestion[] = [
  { label: '☕ Stock de barra', question: '¿Cómo está el stock de barra hoy? ¿Qué falta?' },
  { label: '🔴 Qué hay que pedir', question: '¿Qué items de barra están bajos y necesito pedir?' },
  { label: '📦 Pedidos pendientes', question: '¿Hay pedidos de barra pendientes?' },
  { label: '👥 ¿Quién trabaja?', question: '¿Quién está trabajando hoy en barra?' },
  { label: '⚠️ Avisos', question: '¿Hay avisos importantes para mí?' },
]

const SUGGESTED_COCINA: SuggestedQuestion[] = [
  { label: '👨‍🍳 Tareas pendientes', question: '¿Qué tareas del checklist de cocina están pendientes?' },
  { label: '📋 Estado del turno', question: '¿Cómo va el turno de cocina hoy?' },
  { label: '🥩 Stock cocina', question: '¿Qué items de stock están bajos que necesito para cocinar?' },
  { label: '📖 Recetas', question: '¿Qué recetas tenemos disponibles?' },
  { label: '⚠️ Avisos', question: '¿Hay avisos importantes para cocina?' },
  { label: '👥 ¿Quién trabaja?', question: '¿Quién está trabajando hoy en cocina?' },
]

const SUGGESTED_RUNNER: SuggestedQuestion[] = [
  { label: '⏰ Mi turno', question: '¿Cuál es mi turno hoy y mañana?' },
  { label: '👥 ¿Quién trabaja?', question: '¿Quiénes están trabajando hoy?' },
  { label: '⚠️ Avisos', question: '¿Hay avisos importantes para mí?' },
]

function getSuggestedQuestions(role?: string): SuggestedQuestion[] {
  switch (role) {
    case 'encargado': return SUGGESTED_ENCARGADO
    case 'barista': return SUGGESTED_BARISTA
    case 'chef':
    case 'cocina': return SUGGESTED_COCINA
    case 'runner': return SUGGESTED_RUNNER
    default: return SUGGESTED_RUNNER
  }
}

function getRoleGreeting(role?: string): string {
  switch (role) {
    case 'encargado': return 'Preguntame nomás lo que necesités saber del local.'
    case 'barista': return 'Preguntame sobre la barra, el stock de cafetería o los pedidos.'
    case 'chef': return 'Preguntame sobre la cocina, recetas, checklists o el stock.'
    case 'cocina': return 'Preguntame sobre la cocina, las tareas pendientes o las recetas.'
    case 'runner': return 'Preguntame sobre tus turnos, horarios o los avisos del equipo.'
    default: return 'Preguntame lo que necesités saber.'
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AsistentePage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // -------------------------------------------------------------------------
  // Auto-scroll al ultimo mensaje
  // -------------------------------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  // -------------------------------------------------------------------------
  // Enviar mensaje
  // -------------------------------------------------------------------------

  async function handleSend(text?: string) {
    const messageText = (text ?? input).trim()
    if (!messageText || isThinking) return

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
      // Build conversation history for context
      const history = [...messages, userMessage]
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, history }),
      })

      if (!res.ok) {
        throw new Error('Error en la respuesta del servidor')
      }

      const data = await res.json()

      const botMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response ?? 'No pude procesar tu consulta.',
        timestamp: new Date(),
        actionProposal: data.actionProposal ?? undefined,
        actionExecuted: data.actionExecuted ?? undefined,
      }

      setMessages((prev) => [...prev, botMessage])
    } catch {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          'Hubo un error al procesar tu consulta. Por favor, intenta de nuevo.',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsThinking(false)
      // Refocus el input
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  async function handleConfirmAction(proposal: ActionProposal) {
    if (isThinking) return

    setIsThinking(true)
    setMessages((prev) => [...prev.map((msg) => (
      msg.actionProposal && !msg.actionExecuted ? { ...msg, actionProposal: undefined } : msg
    )), {
      id: crypto.randomUUID(),
      role: 'user',
      content: 'Confirmado',
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
      })

      const data = await res.json()
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response ?? 'No pude ejecutar la acción.',
        timestamp: new Date(),
        actionExecuted: data.actionExecuted ?? false,
      }])
    } catch {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Hubo un error al ejecutar la acción. Intentá de nuevo.',
        timestamp: new Date(),
      }])
    } finally {
      setIsThinking(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function handleCancelAction() {
    setMessages((prev) => [...prev.map((msg) => (
      msg.actionProposal && !msg.actionExecuted ? { ...msg, actionProposal: undefined } : msg
    )), {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Cancelado. No hice ningún cambio.',
      timestamp: new Date(),
    }])
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-[#a39e97]">
          <Loader2 className="size-8 animate-spin text-[#006d5a]" />
          <p className="text-sm font-medium">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#a39e97]">
          No tienes acceso a esta seccion.
        </p>
      </div>
    )
  }

  const suggestedQuestions = getSuggestedQuestions(profile.role)

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col px-1 sm:px-0"
      style={{ height: 'calc(100svh - 10rem)' }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-3 sm:mb-5 sm:gap-3.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-[#f0f7f5] sm:size-11">
          <Coffee className="size-4 text-[#006d5a] sm:size-5" />
        </div>
        <div>
          <h1 className="font-display text-lg font-semibold tracking-tight text-[#3d2c24] sm:text-xl">
            La Vieja de Historia
          </h1>
          <p className="section-label mt-0.5 text-[10px] sm:text-xs">
            Tu asistente tucumana del café ☕
          </p>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-[#ebe6df] bg-[#faf8f5] p-3 sm:space-y-5 sm:p-5">
        {/* Welcome state */}
        {messages.length === 0 && !isThinking && (
          <div className="flex flex-col items-center justify-center gap-4 py-8 sm:gap-6 sm:py-14">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-[#f0f7f5] sm:size-18">
              <Sparkles className="size-6 text-[#006d5a] sm:size-8" />
            </div>
            <div className="text-center px-2">
              <p className="font-display text-base font-semibold text-[#3d2c24] sm:text-lg">
                ¡Hola {profile.first_name}, che!
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-[#a39e97] sm:mt-2 sm:text-sm">
                Soy La Vieja de Historia, tu asistente del café.{' '}
                {getRoleGreeting(profile.role)}
              </p>
            </div>

            {/* Suggested question pills */}
            <div className="flex flex-wrap justify-center gap-2 px-2 sm:gap-2.5 sm:px-4">
              {suggestedQuestions.map((sq) => (
                <button
                  key={sq.question}
                  onClick={() => handleSend(sq.question)}
                  className="rounded-full border border-[#ebe6df] bg-[#fefcf9] px-3 py-1.5 text-[11px] font-medium text-[#006d5a] transition-colors hover:bg-[#f0f7f5] sm:px-4 sm:py-2 sm:text-xs"
                >
                  {sq.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-end gap-3 ${
              msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {/* Avatar */}
            <div
              className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                msg.role === 'user'
                  ? 'bg-[#006d5a] text-white'
                  : 'border border-[#ebe6df] bg-[#fefcf9] text-[#006d5a]'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="size-3.5" />
              ) : (
                <Bot className="size-3.5" />
              )}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[85%] px-3 py-2.5 text-[13px] leading-relaxed sm:max-w-[80%] sm:px-4 sm:py-3 sm:text-sm ${
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

              {msg.actionProposal && !msg.actionExecuted && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleConfirmAction(msg.actionProposal!)}
                    disabled={isThinking}
                    className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#005a4a] disabled:opacity-50"
                  >
                    <Check className="size-3" />
                    Confirmar
                  </button>
                  <button
                    onClick={handleCancelAction}
                    disabled={isThinking}
                    className="flex items-center gap-1 rounded-lg border border-[#ebe6df] px-3 py-1.5 text-xs font-medium text-[#a39e97] transition-colors hover:bg-[#f3efe9] disabled:opacity-50"
                  >
                    <X className="size-3" />
                    Cancelar
                  </button>
                </div>
              )}

              {msg.actionExecuted && (
                <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-[#006d5a]">
                  <Check className="size-3" />
                  Acción ejecutada
                </div>
              )}

              <p
                className={`mt-1.5 text-[10px] ${
                  msg.role === 'user'
                    ? 'text-white/50'
                    : 'text-[#a39e97]'
                }`}
              >
                {msg.timestamp.toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        ))}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="flex items-end gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#ebe6df] bg-[#fefcf9] text-[#006d5a]">
              <Bot className="size-3.5" />
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-[#ebe6df] bg-[#fefcf9] px-5 py-3.5">
              <span className="size-1.5 animate-bounce rounded-full bg-[#006d5a] [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-[#006d5a] [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-[#006d5a] [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {/* Suggested questions after response */}
        {messages.length > 0 && !isThinking && (
          <div className="flex flex-wrap gap-1.5 pt-2 sm:gap-2">
            {suggestedQuestions.slice(0, 4).map((sq) => (
              <button
                key={sq.question}
                onClick={() => handleSend(sq.question)}
                className="rounded-full border border-[#ebe6df] bg-[#fefcf9] px-2.5 py-1 text-[10px] font-medium text-[#006d5a] transition-colors hover:bg-[#f0f7f5] sm:px-3 sm:py-1.5 sm:text-[11px]"
              >
                {sq.label}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area — sticky above bottom nav */}
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-[#ebe6df] bg-white p-2 shadow-sm sm:mt-4 sm:gap-3 sm:p-3">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pregunta sobre el local..."
          disabled={isThinking}
          className="flex-1 rounded-xl border-[#ebe6df] bg-[#faf8f5] text-sm placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]/20"
        />
        <Button
          size="icon"
          onClick={() => handleSend()}
          disabled={!input.trim() || isThinking}
          aria-label="Enviar mensaje"
          className="size-9 shrink-0 rounded-full bg-[#006d5a] text-white shadow-sm hover:bg-[#005a4a] disabled:opacity-40 sm:size-10"
        >
          {isThinking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
