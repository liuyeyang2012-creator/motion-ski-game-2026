import type { PlayStyle, SessionKind } from '../app/types'
import type { MotionEvent, MotionType } from '../motion/motion-detector'
import { GAME_CONFIG, SESSION_DURATION } from './config'
import type { GameEvent, GameState, Obstacle } from './types'

function seeded(seed: number): () => number {
  let value = seed >>> 0
  return () => ((value = (value * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000)
}

function makeObstacles(style: PlayStyle, kind: SessionKind, seed: number): Obstacle[] {
  const random = seeded(seed)
  const duration = SESSION_DURATION[kind] ?? 300_000
  const motions: MotionType[] = style === 'standing'
    ? ['lean-left', 'lean-right', 'duck', 'hands-up', 'squat']
    : ['lean-left', 'lean-right', 'duck', 'hands-up']
  const obstacles: Obstacle[] = []
  for (let at = 3_000, id = 1; at < duration; at += 2_600, id++) {
    const warmup = at < 10_000
    const available = warmup ? motions.slice(0, 2) : motions
    obstacles.push({
      id, appearsAt: at,
      lane: (Math.floor(random() * 3) - 1) as -1 | 0 | 1,
      requiredMotion: available[Math.floor(random() * available.length)],
      warningLeadMs: 1500 + Math.floor(random() * 501),
    })
  }
  return obstacles
}

export function createGame(options: { playStyle: PlayStyle; sessionKind: SessionKind; seed: number }): GameState {
  return {
    ...options, status: 'playing', elapsedMs: 0, score: 0, combo: 0, bestCombo: 0,
    speed: GAME_CONFIG.baseSpeed, collisions: 0, severeCollisions: 0, distance: 0,
    obstacles: makeObstacles(options.playStyle, options.sessionKind, options.seed), motionCounts: {}, resolvedObstacleIds: [],
  }
}

export function advanceGame(
  current: GameState,
  deltaMs: number,
  motions: MotionEvent[],
  debug: { forceCollision?: boolean; forceSevereCollision?: boolean } = {},
): { state: GameState; events: GameEvent[] } {
  if (current.status !== 'playing') return { state: current, events: [] }
  const state: GameState = { ...current, motionCounts: { ...current.motionCounts }, resolvedObstacleIds: [...current.resolvedObstacleIds] }
  const events: GameEvent[] = []
  state.elapsedMs += Math.max(0, deltaMs)
  state.distance += state.speed * (Math.max(0, deltaMs) / 1000)
  for (const motion of motions) {
    const target = state.obstacles.find(obstacle =>
      !state.resolvedObstacleIds.includes(obstacle.id) &&
      obstacle.requiredMotion === motion.type &&
      obstacle.appearsAt - state.elapsedMs <= obstacle.warningLeadMs &&
      obstacle.appearsAt - state.elapsedMs >= -200,
    )
    if (!target) continue
    state.resolvedObstacleIds.push(target.id)
    state.combo += 1
    state.bestCombo = Math.max(state.bestCombo, state.combo)
    state.score += 100 * Math.max(1, state.combo)
    state.motionCounts[motion.type] = (state.motionCounts[motion.type] ?? 0) + 1
    state.speed = Math.min(GAME_CONFIG.maxSpeed, state.speed + 0.15)
    events.push({ type: 'motion', motion })
  }
  const missed = state.obstacles.filter(obstacle => !state.resolvedObstacleIds.includes(obstacle.id) && obstacle.appearsAt <= state.elapsedMs)
  for (const obstacle of missed) {
    state.resolvedObstacleIds.push(obstacle.id)
    state.collisions += 1
    state.combo = 0
    state.speed = Math.max(GAME_CONFIG.baseSpeed * 0.5, state.speed * GAME_CONFIG.collisionSpeedFactor)
    if (state.sessionKind === 'endless') state.severeCollisions += 1
    events.push({ type: 'collision' })
  }
  if (debug.forceCollision || debug.forceSevereCollision) {
    state.collisions += 1
    state.combo = 0
    state.speed = Math.max(GAME_CONFIG.baseSpeed * 0.5, state.speed * GAME_CONFIG.collisionSpeedFactor)
    if (debug.forceSevereCollision && state.sessionKind === 'endless') state.severeCollisions += 1
    events.push({ type: 'collision' })
  }
  const duration = SESSION_DURATION[state.sessionKind]
  if ((duration !== null && state.elapsedMs >= duration) || (state.sessionKind === 'endless' && state.severeCollisions >= 3)) {
    state.status = 'finished'
    events.push({ type: 'finished' })
  }
  return { state, events }
}
