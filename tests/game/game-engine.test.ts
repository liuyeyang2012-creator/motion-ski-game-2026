import { describe, expect, it } from 'vitest'
import { advanceGame, createGame } from '../../src/game/game-engine'

describe('game engine', () => {
  it('ends quick and standard sessions at their exact durations', () => {
    expect(advanceGame(createGame({ playStyle: 'seated', sessionKind: 'quick', seed: 1 }), 30_000, []).state.status).toBe('finished')
    expect(advanceGame(createGame({ playStyle: 'standing', sessionKind: 'standard', seed: 1 }), 120_000, []).state.status).toBe('finished')
  })

  it('keeps timed sessions running after collisions', () => {
    const state = createGame({ playStyle: 'seated', sessionKind: 'quick', seed: 1 })
    state.combo = 8
    const result = advanceGame(state, 1_000, [], { forceCollision: true })
    expect(result.state.status).toBe('playing')
    expect(result.state.combo).toBe(0)
    expect(result.state.speed).toBeLessThan(state.speed)
  })

  it('ends endless mode on the third severe collision', () => {
    let state = createGame({ playStyle: 'standing', sessionKind: 'endless', seed: 1 })
    for (let count = 0; count < 3; count++) state = advanceGame(state, 100, [], { forceSevereCollision: true }).state
    expect(state.status).toBe('finished')
  })

  it('never schedules squat obstacles for seated mode', () => {
    const state = createGame({ playStyle: 'seated', sessionKind: 'standard', seed: 4 })
    expect(state.obstacles.some(obstacle => obstacle.requiredMotion === 'squat')).toBe(false)
    expect(state.obstacles.every(obstacle => obstacle.warningLeadMs >= 1500 && obstacle.warningLeadMs <= 2000)).toBe(true)
  })

  it('rewards only a matching warned action and collides on a missed obstacle', () => {
    let state = createGame({ playStyle: 'seated', sessionKind: 'quick', seed: 2 })
    state.obstacles = [{ id: 1, appearsAt: 2_000, lane: 0, requiredMotion: 'duck', warningLeadMs: 1_500 }]
    state = advanceGame(state, 700, [{ type: 'hands-up', occurredAt: 700, confidence: 0.9 }]).state
    expect(state.score).toBe(0)
    state = advanceGame(state, 900, [{ type: 'duck', occurredAt: 1_600, confidence: 0.9 }]).state
    expect(state.score).toBeGreaterThan(0)
    expect(state.collisions).toBe(0)

    let missed = createGame({ playStyle: 'standing', sessionKind: 'endless', seed: 2 })
    missed.obstacles = [{ id: 9, appearsAt: 1_000, lane: 0, requiredMotion: 'squat', warningLeadMs: 1_500 }]
    missed = advanceGame(missed, 1_100, []).state
    expect(missed.collisions).toBe(1)
    expect(missed.severeCollisions).toBe(1)
  })

  it('uses player lane to avoid a lane obstacle', () => {
    let state = createGame({ playStyle: 'seated', sessionKind: 'quick', seed: 3 })
    state.obstacles = [{ id: 4, appearsAt: 1_000, lane: 0, requiredMotion: 'lean-left', warningLeadMs: 1_500 }]
    state = advanceGame(state, 700, [{ type: 'lean-left', occurredAt: 700, confidence: 0.9 }]).state
    state = advanceGame(state, 400, []).state
    expect(state.playerLane).toBe(-1)
    expect(state.collisions).toBe(0)
  })

  it('does not score an unrelated action for an already-safe lane obstacle', () => {
    let state = createGame({ playStyle: 'seated', sessionKind: 'quick', seed: 3 })
    state.playerLane = -1
    state.obstacles = [{ id: 8, appearsAt: 1_000, lane: 0, requiredMotion: 'lean-left', warningLeadMs: 1_500 }]
    state = advanceGame(state, 700, [{ type: 'duck', occurredAt: 700, confidence: 0.9 }]).state
    expect(state.score).toBe(0)
    expect(state.resolvedObstacleIds).not.toContain(8)
  })
})
