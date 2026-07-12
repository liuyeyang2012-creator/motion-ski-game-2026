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
})
