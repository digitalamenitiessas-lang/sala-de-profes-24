// Modelo de IA para todas las llamadas a OpenRouter. Se puede cambiar sin tocar
// código con la variable OPENROUTER_MODEL (ids en https://openrouter.ai/models).
// anthropic/claude-sonnet-4 dejó de existir en OpenRouter (404, nov/2026; visto
// en Santa Fe, 86a3473): por defecto va Sonnet 5.5. Sonnet 5.5 razona siempre y
// no acepta temperature: el chat de La Vieja ya manda reasoning bajo, sin
// temperature y con margen de tokens. Las otras llamadas (briefing, análisis
// de ventas, mermas, pedidos, prioridades de stock, plan de producción y /ask)
// todavía mandan temperature con topes de 200-1024 tokens: probarlas con una
// clave real y adaptarlas igual que el chat.
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-5.5'

// Encabezados que OpenRouter usa para identificar la app en su panel.
export const OPENROUTER_APP_HEADERS = {
  'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://sala-de-profes-24.vercel.app',
  'X-Title': 'Sala de Profes 24',
} as const
