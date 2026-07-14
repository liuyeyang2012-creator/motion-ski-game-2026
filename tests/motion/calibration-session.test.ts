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

  it('tracks the active model loading mode through failure', () => {
    const session = new CalibrationSession('seated')

    expect(session.cameraReady().modelMode).toBe('standard')
    expect(session.beginModelLoading('compatibility').modelMode).toBe('compatibility')
    expect(session.modelFailed()).toMatchObject({ phase: 'model-error', modelMode: 'compatibility' })
  })

  it('completes seated neutral left right up and down in visible order', () => {
    const session = new CalibrationSession('seated')
    session.cameraReady()
    session.modelReady()

    feedNeutral(session, 0)
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', action: 'face-neutral', completedSteps: 1 })
    session.update(poseSample(1_600))
    expect(session.snapshot()).toMatchObject({ phase: 'action', action: 'turn-left', stepIndex: 1 })

    feedHeadAction(session, 1_680, { dx: 0.04 })
    advanceSuccess(session, 2_800)
    expect(session.snapshot().action).toBe('turn-right')

    feedHeadAction(session, 2_880, { dx: -0.04 })
    advanceSuccess(session, 4_000)
    expect(session.snapshot().action).toBe('look-up')

    feedHeadAction(session, 4_080, { dy: -0.03 })
    advanceSuccess(session, 5_200)
    expect(session.snapshot().action).toBe('look-down')

    feedHeadAction(session, 5_280, { dy: 0.03 })
    advanceSuccess(session, 6_400)
    expect(session.snapshot()).toMatchObject({ phase: 'complete', completedSteps: 5 })
    expect(session.snapshot().profile?.headControl).not.toBeNull()
    expect(session.snapshot().profile?.headControl?.directions).toEqual({
      'turn-left': -1,
      'turn-right': 1,
      'look-up': -1,
      'look-down': 1,
    })
  })

  it('accumulates about one second of neutral evidence and decays one bad frame', () => {
    const session = startedSession('seated')
    for (let time = 100; time <= 1_000; time += 100) session.update(poseSample(time))

    expect(session.snapshot()).toMatchObject({ phase: 'baseline', action: 'face-neutral' })
    expect(session.snapshot().holdProgress).toBeCloseTo(0.9)

    session.update(poseSample(1_100, { hidden: [7, 8] }))
    expect(session.snapshot().phase).toBe('baseline')
    expect(session.snapshot().holdProgress).toBeGreaterThan(0)
    expect(session.snapshot().holdProgress).toBeLessThan(0.9)

    session.update(poseSample(1_200))
    session.update(poseSample(1_300))
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', action: 'face-neutral', completedSteps: 1 })
  })

  it('offers recovery after six seconds during neutral or an action', () => {
    const neutral = new CalibrationSession('seated')
    neutral.cameraReady(); neutral.modelReady()
    neutral.update(poseSample(0))
    neutral.tick(6_100)
    expect(neutral.snapshot().canRecover).toBe(true)

    const action = readySeatedHeadSession()
    action.tick(8_000)
    expect(action.snapshot().canRecover).toBe(true)
  })

  it('retries only the current step and applies a bounded recommended profile', () => {
    const session = readySeatedHeadSession()
    const completedBefore = session.snapshot().completedActions
    session.tick(8_000)
    session.retryCurrentAction()
    expect(session.snapshot()).toMatchObject({ completedActions: completedBefore, holdProgress: 0, canRecover: false })

    session.tick(14_100)
    session.update(subthresholdRecordableHeadTurn(14_120))
    session.useRecommendedSensitivity()
    expect(session.snapshot().phase).toBe('step-success')
    expect(session.snapshot().profile?.headControl?.directions['turn-left']).not.toBe(0)
    expect(session.snapshot().profile?.headControl?.thresholds['turn-left']).toBe(0.07)
  })

  it('uses the largest absolute recordable strength while preserving its sign', () => {
    const session = readySeatedHeadSession()
    session.update(headMovement(1_680, { dx: 0.014 }))
    session.update(headMovement(1_760, { dx: -0.018 }))

    session.useRecommendedSensitivity()

    expect(session.snapshot().profile?.headControl).toMatchObject({
      thresholds: { 'turn-left': 0.07 },
      directions: { 'turn-left': 1 },
    })
  })

  it.each([
    ['missing face landmarks', (capturedAt: number) => poseSample(capturedAt, { hidden: [0, 2, 5, 7, 8] })],
    ['moving shoulders', shouldersMovingSample],
    ['conflicting face support', conflictingSupportSample],
  ])('does not recommend-complete an action with %s', (_label, unsafeSample) => {
    const session = readySeatedHeadSession()
    session.update(unsafeSample(7_000))
    session.tick(8_000)
    session.useRecommendedSensitivity()
    expect(session.snapshot()).toMatchObject({ phase: 'action', canRecover: true })
    expect(session.snapshot().profile?.headControl?.directions['turn-left']).toBe(0)
  })

  it('does not recommend-complete a paired action from wrong-direction evidence', () => {
    const session = readySeatedHeadSession()
    feedHeadAction(session, 1_680, { dx: 0.04 })
    session.tick(2_800)
    expect(session.snapshot()).toMatchObject({ phase: 'action', action: 'turn-right', completedSteps: 2 })

    session.update(headMovement(8_000, { dx: 0.04 }))
    session.tick(8_800)
    session.useRecommendedSensitivity()

    expect(session.snapshot()).toMatchObject({ phase: 'action', action: 'turn-right', canRecover: true })
    expect(session.snapshot().profile?.headControl?.directions['turn-right']).toBe(0)
  })

  it('does not recommend-complete neutral without valid framed evidence', () => {
    const session = startedSession('seated')
    session.update(poseSample(0))
    session.tick(6_100)
    session.retryCurrentAction()

    session.useRecommendedSensitivity()

    expect(session.snapshot()).toMatchObject({
      phase: 'baseline',
      action: 'face-neutral',
      completedSteps: 0,
      feedback: 'head-missing',
    })
  })

  it('advances from success after 600 ms even when no new pose sample arrives', () => {
    const { session, successAt } = readySeatedHeadSessionAtSuccess()
    const action = session.snapshot().action
    session.tick(successAt + 599)
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', action })
    session.tick(successAt + 600)
    expect(session.snapshot()).toMatchObject({ phase: 'action' })
    expect(session.snapshot().action).not.toBe(action)
  })

  it('reports seated head and shoulder recognition using the active step visibility rule', () => {
    const session = startedSession('seated')
    session.update(poseSample(0))
    session.update(poseSample(80, { hidden: [8] }))
    expect(session.snapshot()).toMatchObject({ headRecognized: false, shouldersRecognized: true })

    feedNeutral(session, 160)
    session.tick(1_800)
    for (let time = 1_880; time <= 2_280; time += 80) {
      session.update(headMovement(time, { dx: 0.04 }, [8]))
    }
    expect(session.snapshot()).toMatchObject({
      phase: 'step-success',
      action: 'turn-left',
      headRecognized: true,
      shouldersRecognized: true,
    })
  })

  it('keeps corrective framing feedback when head and shoulders are recognized', () => {
    const session = startedSession('seated')

    session.update(poseSample(0, { changes: { 11: { x: 0.44 }, 12: { x: 0.56 } } }))

    expect(session.snapshot()).toMatchObject({
      phase: 'body-check',
      feedback: 'move-closer',
      framingIssue: null,
      headRecognized: true,
      shouldersRecognized: true,
    })
  })

  it('keeps most action progress across one bad frame', () => {
    const session = readySeatedHeadSession()
    session.update(headMovement(1_680, { dx: 0.04 }))
    session.update(headMovement(1_760, { dx: 0.04 }))
    session.update(poseSample(1_840))

    expect(session.snapshot().holdProgress).toBeGreaterThan(0.2)
  })

  it('retains recommended-sensitivity completion for a standing action', () => {
    const session = startedSession('standing')
    for (let time = 0; time <= 960; time += 80) session.update(poseSample(time))
    session.update(poseSample(9000))

    expect(session.snapshot().canRecover).toBe(true)
    session.useRecommendedSensitivity()
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', completedSteps: 1 })
  })

  it('does not advance for time or the wrong action', () => {
    const session = readySeatedHeadSession()
    for (let time = 1_680; time <= 2_320; time += 80) session.update(headMovement(time, { dy: -0.03 }))
    expect(session.snapshot()).toMatchObject({ phase: 'action', action: 'turn-left', stepIndex: 1 })
  })

  it('confirms an action after 500 ms of accumulated matching', () => {
    const session = readySeatedHeadSession()
    for (let time = 1_680; time <= 2_000; time += 80) session.update(headMovement(time, { dx: 0.04 }))
    expect(session.snapshot().phase).toBe('action')
    session.update(headMovement(2_080, { dx: 0.04 }))
    expect(session.snapshot().phase).toBe('step-success')
  })

  it('does not treat a large sample gap as completed hold time', () => {
    const session = readySeatedHeadSession()
    session.update(headMovement(1_680, { dx: 0.04 }))
    session.update(headMovement(5_000, { dx: 0.04 }))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 1 })
    expect(session.snapshot().holdProgress).toBeLessThan(1)

    for (let time = 5_080; time <= 5_400; time += 80) session.update(headMovement(time, { dx: 0.04 }))
    expect(session.snapshot().phase).toBe('step-success')
  })

  it('keeps completed steps after background suspension and requires the current step afresh', () => {
    const session = sessionWithFirstStepCompleted()
    session.update(turnLeft(2000))
    session.update(turnLeft(6000))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 1, completedSteps: 1 })

    for (let time = 6080; time <= 6400; time += 80) session.update(turnLeft(time))
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', stepIndex: 1, completedSteps: 2 })
  })

  it('keeps completed steps after pose loss longer than 1500 ms', () => {
    const session = sessionWithFirstStepCompleted()
    session.update(poseSample(3000, { hidden: [0, 11, 12, 15, 16] }))
    session.update(poseSample(4600, { hidden: [0, 11, 12, 15, 16] }))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 1, completedSteps: 1 })
  })

  it('does not roll back a confirmed step when pose is lost during success display', () => {
    const session = readySeatedHeadSession()
    feedHeadAction(session, 1_680, { dx: 0.04 })
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', stepIndex: 1, completedSteps: 2 })

    session.update(poseSample(2_160, { hidden: [0, 11, 12, 15, 16] }))
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', stepIndex: 1, completedSteps: 2 })

    session.update(poseSample(3000))
    expect(session.snapshot()).toMatchObject({ phase: 'action', stepIndex: 2, completedSteps: 2 })
  })

  it('collects a relaxed baseline without strict hand geometry', () => {
    const session = startedSession('seated')
    for (let time = 0; time <= 960; time += 80) {
      session.update(poseSample(time, { hidden: [15, 16, 23, 24, 25, 26] }))
    }
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', action: 'face-neutral', completedSteps: 1 })
    expect(session.snapshot().profile?.torsoCenterX).toBe(0.5)
  })

  it('accepts a visible upper body without strict guide-center geometry', () => {
    const session = startedSession('seated')
    const shiftedLeft = (time: number) => poseSample(time, {
      hidden: [23, 24, 25, 26],
      changes: { 0: { x: 0.4 }, 11: { x: 0.3 }, 12: { x: 0.5 } },
    })
    for (let time = 0; time <= 960; time += 80) session.update(shiftedLeft(time))
    expect(session.snapshot()).toMatchObject({ phase: 'step-success', action: 'face-neutral', completedSteps: 1 })
    expect(session.snapshot().profile?.torsoCenterX).toBe(0.4)
  })

  it('accepts centered full-body samples as neutral baseline', () => {
    const session = startedSession('standing')
    for (let time = 0; time <= 960; time += 80) session.update(poseSample(time))
    expect(session.snapshot()).toMatchObject({
      phase: 'action',
      action: 'lean-left',
      stepIndex: 0,
      completedSteps: 0,
    })
    expect(session.snapshot().profile).not.toBeNull()
  })
})

function startedSession(style: 'seated' | 'standing'): CalibrationSession {
  const session = new CalibrationSession(style)
  session.cameraReady()
  session.modelReady()
  return session
}

function turnLeft(time: number) {
  return poseSample(time, {
    changes: Object.fromEntries([0, 2, 5, 7, 8].map(index => [index, {
      x: poseSample(0).landmarks[index].x + 0.04,
    }])),
  })
}

function feedNeutral(session: CalibrationSession, start: number): void {
  for (let time = start; time <= start + 960; time += 80) session.update(poseSample(time))
}

function feedHeadAction(
  session: CalibrationSession,
  start: number,
  movement: { dx?: number; dy?: number },
): void {
  for (let time = start; time <= start + 480; time += 80) {
    const base = poseSample(0)
    session.update(poseSample(time, {
      changes: Object.fromEntries([0, 2, 5, 7, 8].map(index => [index, {
        x: base.landmarks[index].x + (movement.dx ?? 0),
        y: base.landmarks[index].y + (movement.dy ?? 0),
      }])),
    }))
  }
}

function headMovement(
  capturedAt: number,
  movement: { dx?: number; dy?: number },
  hidden: number[] = [],
) {
  const base = poseSample(0)
  return poseSample(capturedAt, {
    hidden,
    changes: Object.fromEntries([0, 2, 5, 7, 8].map(index => [index, {
      x: base.landmarks[index].x + (movement.dx ?? 0),
      y: base.landmarks[index].y + (movement.dy ?? 0),
    }])),
  })
}

function readySeatedHeadSession(): CalibrationSession {
  const session = startedSession('seated')
  feedNeutral(session, 0)
  session.tick(1_600)
  return session
}

function readySeatedHeadSessionAtSuccess(): { session: CalibrationSession; successAt: number } {
  const session = readySeatedHeadSession()
  feedHeadAction(session, 1_680, { dx: 0.04 })
  return { session, successAt: 2_080 }
}

function subthresholdRecordableHeadTurn(capturedAt: number) {
  return headMovement(capturedAt, { dx: 0.014 })
}

function shouldersMovingSample(capturedAt: number) {
  const base = poseSample(0)
  return poseSample(capturedAt, {
    changes: Object.fromEntries([0, 2, 5, 7, 8, 11, 12].map(index => [index, {
      x: base.landmarks[index].x + 0.04,
    }])),
  })
}

function conflictingSupportSample(capturedAt: number) {
  const base = poseSample(0)
  return poseSample(capturedAt, {
    changes: {
      0: { x: base.landmarks[0].x + 0.04 },
      ...Object.fromEntries([2, 5, 7, 8].map(index => [index, {
        x: base.landmarks[index].x - 0.04,
      }])),
    },
  })
}

function advanceSuccess(session: CalibrationSession, now: number): void {
  session.tick(now)
}

function sessionWithFirstStepCompleted(): CalibrationSession {
  return readySeatedHeadSession()
}
