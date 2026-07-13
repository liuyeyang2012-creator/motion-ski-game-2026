import { describe, expect, it } from 'vitest'
import { CalibrationSession } from '../../src/motion/calibration-session'
import { poseSample } from '../support/pose-sample'

describe('CalibrationSession', () => {
  it('exposes camera, model, and body readiness in order', () => {
    const session = new CalibrationSession('seated')

    expect(session.snapshot().phase).toBe('camera-check')
    expect(session.cameraReady().phase).toBe('model-check')
    expect(session.modelReady().phase).toBe('body-check')
  })

  it('keeps most action progress across one bad frame', () => {
    const session = readyHalfBodySession()
    session.update(leftLean(1000))
    session.update(leftLean(1160))
    session.update(poseSample(1240))

    expect(session.snapshot().holdProgress).toBeGreaterThan(0.2)
  })

  it('offers recovery after eight seconds and skips only the current action', () => {
    const session = readyHalfBodySession()
    session.update(poseSample(9000))

    expect(session.snapshot().canRecover).toBe(true)
    session.useRecommendedSensitivity()
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', completedSteps: 1 })
  })

  it('does not advance for time or the wrong action', () => {
    const session = startedSession('seated')
    for (let time = 0; time <= 960; time += 80) session.update(poseSample(time))
    expect(session.snapshot().phase).toBe('action')
    expect(session.snapshot().stepIndex).toBe(0)
    for (let time = 1040; time <= 1680; time += 80) session.update(poseSample(time, { changes: { 0: { y: 0.3 } } }))
    expect(session.snapshot().stepIndex).toBe(0)
  })

  it('confirms an action after 500 ms of accumulated matching', () => {
    const session = readyHalfBodySession()
    for (let time = 1000; time <= 1320; time += 80) session.update(leftLean(time))
    expect(session.snapshot().phase).toBe('action')
    session.update(leftLean(1400))
    expect(session.snapshot().phase).toBe('step-success')
  })

  it('does not treat a large sample gap as completed hold time', () => {
    const session = readyHalfBodySession()
    session.update(leftLean(1000))
    session.update(leftLean(5000))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 0 })
    expect(session.snapshot().holdProgress).toBeLessThan(1)

    for (let time = 5080; time <= 5400; time += 80) session.update(leftLean(time))
    expect(session.snapshot().phase).toBe('step-success')
  })

  it('keeps completed steps after background suspension and requires the current step afresh', () => {
    const session = sessionWithFirstStepCompleted()
    session.update(rightLean(2000))
    session.update(rightLean(6000))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 1, completedSteps: 1 })

    for (let time = 6080; time <= 6400; time += 80) session.update(rightLean(time))
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', stepIndex: 1, completedSteps: 2 })
  })

  it('keeps completed steps after pose loss longer than 1500 ms', () => {
    const session = sessionWithFirstStepCompleted()
    session.update(poseSample(3000, { hidden: [0, 11, 12, 15, 16] }))
    session.update(poseSample(4600, { hidden: [0, 11, 12, 15, 16] }))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 1, completedSteps: 1 })
  })

  it('does not roll back a confirmed step when pose is lost during success display', () => {
    const session = readyHalfBodySession()
    for (let time = 1000; time <= 1400; time += 80) session.update(leftLean(time))
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', stepIndex: 0, completedSteps: 1 })

    session.update(poseSample(1500, { hidden: [0, 11, 12, 15, 16] }))
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', stepIndex: 0, completedSteps: 1 })

    session.update(poseSample(3000))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 1, completedSteps: 1 })
  })

  it('collects a relaxed baseline without strict hand geometry', () => {
    const session = startedSession('seated')
    for (let time = 0; time <= 960; time += 80) {
      session.update(poseSample(time, { hidden: [15, 16, 23, 24, 25, 26] }))
    }
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 0, completedSteps: 0 })
    expect(session.snapshot().profile?.torsoCenterX).toBe(0.5)
  })

  it('accepts a visible upper body without strict guide-center geometry', () => {
    const session = startedSession('seated')
    const shiftedLeft = (time: number) => poseSample(time, {
      hidden: [23, 24, 25, 26],
      changes: { 0: { x: 0.4 }, 11: { x: 0.3 }, 12: { x: 0.5 } },
    })
    for (let time = 0; time <= 960; time += 80) session.update(shiftedLeft(time))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 0 })
    expect(session.snapshot().profile?.torsoCenterX).toBe(0.4)
  })

  it('accepts centered full-body samples as neutral baseline', () => {
    const session = startedSession('standing')
    for (let time = 0; time <= 960; time += 80) session.update(poseSample(time))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 0 })
    expect(session.snapshot().profile).not.toBeNull()
  })
})

function readyHalfBodySession(): CalibrationSession {
  const session = startedSession('seated')
  for (let time = 0; time <= 800; time += 80) session.update(poseSample(time))
  return session
}

function startedSession(style: 'seated' | 'standing'): CalibrationSession {
  const session = new CalibrationSession(style)
  session.cameraReady()
  session.modelReady()
  return session
}

function leftLean(time: number) {
  return poseSample(time, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 } } })
}

function rightLean(time: number) {
  return poseSample(time, { changes: { 11: { x: 0.5 }, 12: { x: 0.7 } } })
}

function sessionWithFirstStepCompleted(): CalibrationSession {
  const session = readyHalfBodySession()
  for (let time = 1000; time <= 1400; time += 80) session.update(leftLean(time))
  session.update(poseSample(1900))
  return session
}
