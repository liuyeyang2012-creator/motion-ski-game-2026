import { describe, expect, it } from 'vitest'
import {
  buildCalibration,
  CALIBRATION_SAMPLES_PER_STEP,
  CALIBRATION_TOTAL_SAMPLES,
  getCalibrationPrompt,
  validateCalibrationActions,
} from '../../src/motion/calibration'
import { MotionDetector } from '../../src/motion/motion-detector'
import type { CalibrationProfile } from '../../src/motion/calibration'
import type { MotionEvent } from '../../src/motion/motion-detector'
import { poseSample } from '../support/pose-sample'

const moveFace = (capturedAt: number, dx: number, dy = 0) => poseSample(capturedAt, {
  changes: Object.fromEntries([0, 2, 5, 7, 8].map(index => [index, {
    x: poseSample(0).landmarks[index].x + dx,
    y: poseSample(0).landmarks[index].y + dy,
  }])),
})

const standingProfile: CalibrationProfile = {
  shoulderWidth: 0.2,
  torsoCenterX: 0.5,
  headY: 0.2,
  wristY: 0.65,
  hipY: 0.7,
  kneeY: 0.9,
  headControl: null,
}

const seatedHeadProfile: CalibrationProfile = {
  ...standingProfile,
  hipY: null,
  kneeY: null,
  headControl: {
    neutral: {
      shoulderWidth: 0.2,
      shoulderCenterX: 0.5,
      shoulderCenterY: 0.4,
      noseOffsetX: 0,
      noseOffsetY: -1,
      supportOffsetX: 0,
      supportOffsetY: -1.025,
      confidence: 1,
    },
    thresholds: {
      'turn-left': 0.1,
      'turn-right': 0.1,
      'look-up': 0.08,
      'look-down': 0.08,
    },
    directions: {
      'turn-left': -1,
      'turn-right': 1,
      'look-up': -1,
      'look-down': 1,
    },
  },
}

const leanSample = (capturedAt: number) => poseSample(capturedAt, {
  changes: { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } },
})

const handsUpSample = (capturedAt: number) => poseSample(capturedAt, {
  changes: { 15: { y: 0.3 }, 16: { y: 0.3 } },
})

const duckSample = (capturedAt: number) => poseSample(capturedAt, { changes: { 0: { y: 0.3 } } })

const attemptTurnLeft = (detector: MotionDetector, startedAt: number): MotionEvent[] =>
  [moveFace(startedAt, 0.04), moveFace(startedAt + 140, 0.04)]
    .flatMap(sample => detector.update(sample))

const fireTurnLeft = (detector: MotionDetector, startedAt: number): MotionEvent => {
  const event = attemptTurnLeft(detector, startedAt)
    .find(candidate => candidate.type === 'turn-left')
  if (!event) throw new Error('turn-left did not fire')
  return event
}

const holdTurnStrength = (
  detector: MotionDetector,
  startedAt: number,
  thresholdRatio: number,
  durationMs: number,
): MotionEvent[] => {
  const dx = 0.02 * thresholdRatio
  return [moveFace(startedAt, dx), moveFace(startedAt + durationMs, dx)]
    .flatMap(sample => detector.update(sample))
}

describe('motion calibration and detection', () => {
  it('reports missing hips instead of producing a full-body baseline', () => {
    const result = buildCalibration([poseSample(0, { changes: { 23: { visibility: 0.2 }, 24: { visibility: 0.2 } } })], 'standing')
    expect(result).toEqual({ ok: false, issue: 'hips-not-visible' })
  })

  it('emits seated head controls and no seated lean or hands-up events', () => {
    const detector = new MotionDetector(seatedHeadProfile, 'seated')
    const samples = [
      moveFace(0, 0.04), moveFace(140, 0.04),
      poseSample(360), poseSample(560),
      moveFace(640, 0, -0.03), moveFace(760, 0, -0.03),
      poseSample(980), poseSample(1_180),
      moveFace(1_260, 0, 0.03), moveFace(1_460, 0, 0.03),
    ]

    const types = samples.flatMap(sample => detector.update(sample)).map(event => event.type)

    expect(types).toContain('turn-left')
    expect(types).toContain('head-up')
    expect(types).toContain('head-down')
    expect(types).not.toContain('lean-left')
    expect(types).not.toContain('hands-up')
  })

  it('requires neutral before the same seated head action can fire again', () => {
    const detector = new MotionDetector(seatedHeadProfile, 'seated')
    const held = [moveFace(0, 0.04), moveFace(140, 0.04), moveFace(280, 0.04), moveFace(420, 0.04)]

    expect(held.flatMap(sample => detector.update(sample)).filter(event => event.type === 'turn-left')).toHaveLength(1)
  })

  it('does not re-arm at 70 percent strength and re-arms only inside the 45 percent neutral zone', () => {
    const detector = new MotionDetector(seatedHeadProfile, 'seated')
    const first = fireTurnLeft(detector, 0)
    const notNeutral = holdTurnStrength(detector, first.occurredAt + 200, 0.70, 240)
    const blocked = attemptTurnLeft(detector, first.occurredAt + 500)

    expect([...notNeutral, ...blocked].filter(event => event.type === 'turn-left')).toHaveLength(0)

    holdTurnStrength(detector, first.occurredAt + 900, 0.40, 180)
    expect(fireTurnLeft(detector, first.occurredAt + 1_200).type).toBe('turn-left')
  })

  it('accepts a quick head-up transition but rejects slow vertical drift', () => {
    const quick = new MotionDetector(seatedHeadProfile, 'seated')
    expect([
      poseSample(0), moveFace(120, 0, -0.03), moveFace(220, 0, -0.03),
    ].flatMap(sample => quick.update(sample)).some(event => event.type === 'head-up')).toBe(true)

    const slow = new MotionDetector(seatedHeadProfile, 'seated')
    expect([
      poseSample(0), moveFace(250, 0, -0.008), moveFace(500, 0, -0.016),
      moveFace(750, 0, -0.024), moveFace(1_000, 0, -0.03),
    ].flatMap(sample => slow.update(sample)).some(event => event.type === 'head-up')).toBe(false)
  })

  it('projects seated actions onto their recorded directions', () => {
    const reversedProfile: CalibrationProfile = {
      ...seatedHeadProfile,
      headControl: {
        ...seatedHeadProfile.headControl!,
        directions: {
          'turn-left': 1,
          'turn-right': -1,
          'look-up': 1,
          'look-down': -1,
        },
      },
    }
    const detector = new MotionDetector(reversedProfile, 'seated')
    const types = [
      moveFace(0, -0.04), moveFace(140, -0.04),
      poseSample(360), poseSample(560),
      moveFace(640, 0.04), moveFace(780, 0.04),
      poseSample(1_000), poseSample(1_200),
      moveFace(1_280, 0, 0.03), moveFace(1_380, 0, 0.03),
      poseSample(1_600), poseSample(1_800),
      moveFace(1_880, 0, -0.03), moveFace(2_080, 0, -0.03),
    ].flatMap(sample => detector.update(sample)).map(event => event.type)

    expect(types).toEqual(['turn-left', 'turn-right', 'head-up', 'head-down'])
  })

  it('requires the core face and shoulders plus at least one usable ear for seated events', () => {
    const withHidden = (sample: ReturnType<typeof poseSample>, hidden: number[]) => {
      const landmarks = sample.landmarks.map(point => ({ ...point }))
      for (const index of hidden) landmarks[index].visibility = 0
      return { ...sample, landmarks }
    }
    const oneEar = new MotionDetector(seatedHeadProfile, 'seated')
    const oneEarEvents = [moveFace(0, 0.04), moveFace(140, 0.04)]
      .map(sample => withHidden(sample, [8]))
      .flatMap(sample => oneEar.update(sample))
    expect(oneEarEvents.map(event => event.type)).toEqual(['turn-left'])

    const noEars = new MotionDetector(seatedHeadProfile, 'seated')
    const noEarEvents = [moveFace(0, 0.04), moveFace(140, 0.04)]
      .map(sample => withHidden(sample, [7, 8]))
      .flatMap(sample => noEars.update(sample))
    expect(noEarEvents).toEqual([])
  })

  it('emits no legacy seated body events when headControl is absent', () => {
    const detector = new MotionDetector({ ...standingProfile, headControl: null }, 'seated')

    expect([
      leanSample(0), leanSample(140),
      handsUpSample(400), handsUpSample(540),
      duckSample(800), duckSample(940),
    ].flatMap(sample => detector.update(sample))).toEqual([])
  })

  it('emits a held standing lean once and rearms after neutral', () => {
    const detector = new MotionDetector(standingProfile, 'standing')
    const events = [
      leanSample(200), leanSample(340),
      poseSample(500), poseSample(680),
      leanSample(720), leanSample(860),
    ].flatMap(value => detector.update(value).map(event => event.type))
    expect(events).toEqual(['lean-left', 'lean-left'])
  })

  it('never emits squat in seated mode', () => {
    const calibration = buildCalibration([0, 40, 80, 120, 160].map(time => poseSample(time)), 'seated')
    if (!calibration.ok) throw new Error('calibration failed')
    const detector = new MotionDetector(calibration.profile, 'seated')
    const events = [poseSample(200, { changes: { 23: { y: 0.82 }, 24: { y: 0.82 } } }), poseSample(340, { changes: { 23: { y: 0.82 }, 24: { y: 0.82 } } })]
      .flatMap(value => detector.update(value))
    expect(events.map(event => event.type)).not.toContain('squat')
  })

  it('does not emit a standing squat when hips are hidden', () => {
    const profile: CalibrationProfile = {
      shoulderWidth: 0.2,
      torsoCenterX: 0.5,
      headY: 0.2,
      wristY: 0.65,
      hipY: 0.7,
      kneeY: 0.9,
    }
    const detector = new MotionDetector(profile, 'standing')
    const hiddenSquat = (capturedAt: number) => poseSample(capturedAt, {
      hidden: [23, 24],
      changes: { 23: { y: 0.82 }, 24: { y: 0.82 } },
    })

    const events = [hiddenSquat(200), hiddenSquat(340)]
      .flatMap(sample => detector.update(sample))

    expect(events.map(event => event.type)).not.toContain('squat')
  })

  it('requires a numeric standing hip baseline before detecting squat', () => {
    const profile: CalibrationProfile = {
      shoulderWidth: 0.2,
      torsoCenterX: 0.5,
      headY: 0.2,
      wristY: 0.65,
      hipY: null,
      kneeY: null,
    }
    const detector = new MotionDetector(profile, 'standing')
    const squat = (capturedAt: number) => poseSample(capturedAt, {
      changes: { 23: { y: 0.82 }, 24: { y: 0.82 } },
    })

    const events = [squat(200), squat(340)].flatMap(sample => detector.update(sample))

    expect(events.map(event => event.type)).not.toContain('squat')
  })

  it('rejects non-finite profile baselines instead of crossing motion thresholds', () => {
    const profile: CalibrationProfile = {
      shoulderWidth: 0.2,
      torsoCenterX: 0.5,
      headY: 0.2,
      wristY: 0.65,
      hipY: 0.7,
      kneeY: 0.9,
    }
    const cases: Array<{ field: 'torsoCenterX' | 'headY' | 'hipY'; value: number; style: 'standing'; sample: ReturnType<typeof poseSample> }> = [
      { field: 'torsoCenterX', value: Number.NaN, style: 'standing', sample: leanSample(0) },
      { field: 'torsoCenterX', value: Number.POSITIVE_INFINITY, style: 'standing', sample: leanSample(0) },
      { field: 'headY', value: Number.NaN, style: 'standing', sample: duckSample(0) },
      { field: 'headY', value: Number.NEGATIVE_INFINITY, style: 'standing', sample: duckSample(0) },
      { field: 'hipY', value: Number.NaN, style: 'standing', sample: poseSample(0, { changes: { 23: { y: 0.82 }, 24: { y: 0.82 } } }) },
      { field: 'hipY', value: Number.POSITIVE_INFINITY, style: 'standing', sample: poseSample(0, { changes: { 23: { y: 0.82 }, 24: { y: 0.82 } } }) },
      { field: 'hipY', value: Number.NEGATIVE_INFINITY, style: 'standing', sample: poseSample(0, { changes: { 23: { y: 0.82 }, 24: { y: 0.82 } } }) },
    ]

    for (const entry of cases) {
      const detector = new MotionDetector({ ...profile, [entry.field]: entry.value }, entry.style)
      const events = [
        { ...entry.sample, capturedAt: 200 },
        { ...entry.sample, capturedAt: 340 },
      ].flatMap(sample => detector.update(sample))
      expect(events, entry.field).toEqual([])
    }
  })

  it('rejects non-finite landmark coordinates for every affected motion', () => {
    const baseProfile: CalibrationProfile = {
      shoulderWidth: 0.2,
      torsoCenterX: 0.5,
      headY: 0.2,
      wristY: 0.65,
      hipY: 0.7,
      kneeY: 0.9,
    }
    const cases = [
      { name: 'lean NaN', profile: baseProfile, style: 'standing' as const, changes: { 11: { x: Number.NaN } } },
      { name: 'lean', profile: baseProfile, style: 'standing' as const, changes: { 11: { x: Number.NEGATIVE_INFINITY } } },
      { name: 'duck NaN', profile: baseProfile, style: 'standing' as const, changes: { 0: { y: Number.NaN } } },
      { name: 'duck', profile: baseProfile, style: 'standing' as const, changes: { 0: { y: Number.POSITIVE_INFINITY } } },
      { name: 'hands-up', profile: baseProfile, style: 'standing' as const, changes: { 15: { y: Number.NEGATIVE_INFINITY }, 16: { y: Number.NEGATIVE_INFINITY } } },
      { name: 'reach', profile: baseProfile, style: 'standing' as const, changes: { 15: { x: Number.NEGATIVE_INFINITY }, 16: { x: Number.POSITIVE_INFINITY } } },
      { name: 'squat', profile: baseProfile, style: 'standing' as const, changes: { 23: { y: Number.POSITIVE_INFINITY }, 24: { y: Number.POSITIVE_INFINITY } } },
    ]

    for (const entry of cases) {
      const detector = new MotionDetector(entry.profile, entry.style)
      const events = [200, 340]
        .map(capturedAt => poseSample(capturedAt, { changes: entry.changes }))
        .flatMap(sample => detector.update(sample))
      expect(events, entry.name).toEqual([])
    }
  })

  it('still emits every normal motion with finite inputs', () => {
    const baseProfile: CalibrationProfile = {
      shoulderWidth: 0.2,
      torsoCenterX: 0.5,
      headY: 0.2,
      wristY: 0.65,
      hipY: 0.7,
      kneeY: 0.9,
    }
    const cases = [
      { expected: 'lean-left', profile: baseProfile, style: 'standing' as const, changes: { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } } },
      { expected: 'duck', profile: baseProfile, style: 'standing' as const, changes: { 0: { y: 0.3 } } },
      { expected: 'hands-up', profile: baseProfile, style: 'standing' as const, changes: { 15: { y: 0.3 }, 16: { y: 0.3 } } },
      { expected: 'reach-left', profile: baseProfile, style: 'standing' as const, changes: { 15: { x: 0.1 }, 16: { x: 0.9 } } },
      { expected: 'reach-right', profile: baseProfile, style: 'standing' as const, changes: { 15: { x: 0.1 }, 16: { x: 0.9 } } },
      { expected: 'squat', profile: baseProfile, style: 'standing' as const, changes: { 23: { y: 0.82 }, 24: { y: 0.82 } } },
    ]

    for (const entry of cases) {
      const detector = new MotionDetector(entry.profile, entry.style)
      const events = [200, 340]
        .map(capturedAt => poseSample(capturedAt, { changes: entry.changes }))
        .flatMap(sample => detector.update(sample))
      expect(events.map(event => event.type), entry.expected).toContain(entry.expected)
    }
  })

  it('rejects motionless prompted calibration actions', () => {
    const samples = Array.from({ length: 60 }, (_, index) => poseSample(index * 80))
    const calibration = buildCalibration(samples.slice(0, 15), 'standing')
    if (!calibration.ok) throw new Error('calibration failed')
    expect(validateCalibrationActions(calibration.profile, samples, 'standing')).toEqual({ ok: false, issue: 'lean-left-missing' })
  })

  it('retries calibration when the pose is lost for most of the sequence', () => {
    const samples = Array.from({ length: 60 }, (_, index) => poseSample(index * 80))
    for (let index = 20; index < 60; index += 1) samples[index] = { capturedAt: index * 80, landmarks: [] }
    const calibration = buildCalibration(samples.slice(0, 15), 'standing')
    if (!calibration.ok) throw new Error('calibration failed')
    expect(validateCalibrationActions(calibration.profile, samples, 'standing')).toEqual({ ok: false, issue: 'pose-lost' })
  })

  it('keeps each prompted action visible long enough to follow', () => {
    expect(CALIBRATION_SAMPLES_PER_STEP).toBeGreaterThanOrEqual(20)
    expect(getCalibrationPrompt(25, 'seated')).toBe('第 1/5 步 · 保持头部居中')
    expect(getCalibrationPrompt(49, 'seated')).toContain('第 1/5 步')
    expect(getCalibrationPrompt(50, 'seated')).toBe('第 2/5 步 · 向左转头')
    expect(getCalibrationPrompt(75, 'seated')).toBe('第 3/5 步 · 向右转头')
    expect(getCalibrationPrompt(100, 'seated')).toBe('第 4/5 步 · 抬头')
    expect(getCalibrationPrompt(125, 'seated')).toBe('第 5/5 步 · 低头')
  })

  it('tolerates a briefly lost pose when all prompted actions are completed', () => {
    const samples = Array.from({ length: CALIBRATION_TOTAL_SAMPLES }, (_, index) => poseSample(index * 80))
    const step = CALIBRATION_SAMPLES_PER_STEP
    for (let index = step; index < step * 2; index += 1) samples[index] = poseSample(index * 80)
    for (let index = step * 2; index < step * 3; index += 1) {
      samples[index] = moveFace(index * 80, 0.04)
    }
    for (let index = step * 3; index < step * 4; index += 1) samples[index] = moveFace(index * 80, -0.04)
    for (let index = step * 4; index < step * 5; index += 1) samples[index] = moveFace(index * 80, 0, -0.03)
    for (let index = step * 5; index < step * 6; index += 1) samples[index] = moveFace(index * 80, 0, 0.03)
    samples[step * 3 + 2] = { capturedAt: (step * 3 + 2) * 80, landmarks: [] }

    const calibration = buildCalibration(samples.slice(0, step), 'seated')
    if (!calibration.ok) throw new Error('calibration failed')
    expect(validateCalibrationActions(calibration.profile, samples, 'seated')).toEqual({ ok: true })
  })
})
