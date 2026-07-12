import type { SessionKind } from '../app/types'

export const SESSION_DURATION: Record<SessionKind, number | null> = {
  quick: 30_000,
  standard: 120_000,
  endless: null,
}

export const GAME_CONFIG = Object.freeze({ baseSpeed: 12, maxSpeed: 28, collisionSpeedFactor: 0.65 })
