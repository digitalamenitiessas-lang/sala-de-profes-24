/**
 * School bell sound using the Web Audio API.
 * No external files needed — synthesizes a realistic bell ring.
 */

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  return audioCtx
}

/**
 * Play a classic school bell sound (two-tone ring).
 * Uses Web Audio API oscillators to create a metallic bell timbre.
 */
export function playSchoolBell(): void {
  try {
    const ctx = getAudioContext()

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    const now = ctx.currentTime

    // --- Bell strike 1 (higher pitch) ---
    playBellStrike(ctx, now, 830, 0.35)
    playBellStrike(ctx, now + 0.08, 1245, 0.2)

    // --- Bell strike 2 (lower pitch, slightly delayed) ---
    playBellStrike(ctx, now + 0.5, 830, 0.3)
    playBellStrike(ctx, now + 0.58, 1245, 0.15)

    // --- Third ring for emphasis ---
    playBellStrike(ctx, now + 1.0, 830, 0.25)
    playBellStrike(ctx, now + 1.08, 1245, 0.12)
  } catch {
    // Silently fail if audio is not available
  }
}

function playBellStrike(
  ctx: AudioContext,
  startTime: number,
  frequency: number,
  volume: number,
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  // Bell-like waveform: combination of sine harmonics
  osc.type = 'sine'
  osc.frequency.setValueAtTime(frequency, startTime)

  // Slight frequency drop to simulate metallic resonance
  osc.frequency.exponentialRampToValueAtTime(frequency * 0.98, startTime + 0.5)

  // Bell envelope: fast attack, medium decay
  gain.gain.setValueAtTime(0, startTime)
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(startTime)
  osc.stop(startTime + 0.9)
}

// ---------------------------------------------------------------------------
// Custom event for notification badge updates
// ---------------------------------------------------------------------------

/** Dispatch this event when a notification is marked as read */
export function dispatchNotificationRead(): void {
  window.dispatchEvent(new CustomEvent('notification-read'))
}

/** Listen for notification-read events */
export function onNotificationRead(callback: () => void): () => void {
  window.addEventListener('notification-read', callback)
  return () => window.removeEventListener('notification-read', callback)
}
