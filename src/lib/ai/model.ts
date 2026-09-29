// Modelo de IA para todas las llamadas a OpenRouter. Se puede cambiar sin tocar
// código con la variable OPENROUTER_MODEL (ids en https://openrouter.ai/models).
// Ojo al pasar a Claude Sonnet 5 o posterior: rechazan temperature (400) y
// razonan por defecto dentro de max_tokens, y las llamadas mandan temperature
// con topes de 200-1024 tokens. Probar con una clave real antes de cambiarlo.
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4'

// Encabezados que OpenRouter usa para identificar la app en su panel.
export const OPENROUTER_APP_HEADERS = {
  'HTTP-Referer': 'https://sala-de-profes-24.vercel.app',
  'X-Title': 'Sala de Profes 24',
} as const
