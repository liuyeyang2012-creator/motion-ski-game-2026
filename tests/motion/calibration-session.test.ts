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

  it('does not roll back a confirmed step when pose is lost during success display', () => {
    const session = readyHalfBodySession()
    for (let time = 800; time <= 1200; time += 80) session.update(leftLean(time))
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', stepIndex: 0, completedSteps: 1 })

    session.update(poseSample(1300, { hidden: [0, 11, 12, 15, 16] }))
    session.update(poseSample(2900, { hidden: [0, 11, 12, 15, 16] }))
    expect(session.snapshot()).toMatchObject({ phase: 'framing', stepIndex: 0, completedSteps: 1 })

    session.update(poseSample(3000))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 1, completedSteps: 1 })
  })

  it('does not collect a sustained lean as neutral baseline', () => {
    const session = new CalibrationSession('seated')
    for (let time = 0; time <= 800; time += 80) session.update(leftLean(time))
    expect(session.snapshot()).toMatchObject({ phase: 'baseline', profile: null })

    for (let time = 880; time <= 1520; time += 80) session.update(poseSample(time))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 0, completedSteps: 0 })
    expect(session.snapshot().profile?.torsoCenterX).toBe(0.5)

    for (let time = 1600; time <= 2080; time += 80) session.update(poseSample(time))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 0, completedSteps: 0 })
  })

  it('rejects a centered-looking upper body that is shifted left of the guide frame', () => {
    const session = new CalibrationSession('seated')
    const shiftedLeft = (time: number) => poseSample(time, {
      hidden: [23, 24, 25, 26],
      changes: { 0: { x: 0.4 }, 11: { x: 0.3 }, 12: { x: 0.5 } },
    })
    for (let time = 0; time <= 800; time += 80) session.update(shiftedLeft(time))
    expect(session.snapshot()).toMatchObject({ phase: 'baseline', profile: null })

    for (let time = 880; time <= 1520; time += 80) {
      session.update(poseSample(time, { hidden: [23, 24, 25, 26] }))
    }
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 0 })
    expect(session.snapshot().profile?.torsoCenterX).toBe(0.5)
  })

  it('accepts centered full-body samples as neutral baseline', () => {
    const session = new CalibrationSession('standing')
    for (let time = 0; time <= 640; time += 80) session.update(poseSample(time))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 0 })
    expect(session.snapshot().profile).not.toBeNull()
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
