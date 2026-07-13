import { describe, expect, it } from 'vitest'
import { CalibrationSession } from '../../src/motion/calibration-session'
import { poseSample } from '../support/pose-sample'

describe('CalibrationSession', () => {
  it('does not advance for time or the wrong action', () => {
    const session = new CalibrationSession('seated')
    for (let time = 0; time <= 800; time += 80) session.update(poseSample(time))
    expect(session.snapshot().phase).toBe('action')
    expect(session.snapshot().stepIndex).toBe(0)
    for (let time = 880; time <= 1520; time += 80) session.update(poseSample(time, { changes: { 0: { y: 0.3 } } }))
    expect(session.snapshot().stepIndex).toBe(0)
  })

  it('confirms an action only after 400 ms of continuous matching', () => {
    const session = readyHalfBodySession()
    session.update(leftLean(1000))
    session.update(leftLean(1320))
    expect(session.snapshot().phase).toBe('action')
    session.update(leftLean(1400))
    expect(session.snapshot().phase).toBe('step-success')
  })

  it('keeps completed steps after pose loss longer than 1500 ms', () => {
    const session = sessionWithFirstStepCompleted()
    session.update(poseSample(3000, { hidden: [0, 11, 12, 15, 16] }))
    session.update(poseSample(4600, { hidden: [0, 11, 12, 15, 16] }))
    expect(session.snapshot()).toMatchObject({ phase: 'framing', stepIndex: 1, completedSteps: 1 })
  })
})

function readyHalfBodySession(): CalibrationSession {
  const session = new CalibrationSession('seated')
  for (let time = 0; time <= 640; time += 80) session.update(poseSample(time))
  return session
}

function leftLean(time: number) {
  return poseSample(time, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 } } })
}

function sessionWithFirstStepCompleted(): CalibrationSession {
  const session = readyHalfBodySession()
  for (let time = 800; time <= 1200; time += 80) session.update(leftLean(time))
  session.update(poseSample(1650))
  return session
}
