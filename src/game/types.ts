import type { PlayStyle, SessionKind } from '../app/types'
import type { MotionEvent, MotionType } from '../motion/motion-detector'

export type GameStatus = 'playing' | 'paused' | 'finished'
export interface Obstacle { id: number; appearsAt: number; lane: -1 | 0 | 1; requiredMotion: MotionType; warningLeadMs: number }
export interface GameState {
  playStyle: PlayStyle; sessionKind: SessionKind; status: GameStatus
  elapsedMs: number; score: number; combo: number; bestCombo: number
  speed: number; collisions: number; severeCollisions: number; distance: number
  obstacles: Obstacle[]; motionCounts: Partial<Record<MotionType, number>>
}
export interface GameEvent { type: 'collision' | 'finished' | 'motion'; motion?: MotionEvent }
