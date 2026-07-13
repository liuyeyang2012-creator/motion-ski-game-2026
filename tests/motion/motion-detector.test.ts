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
import { poseSample } from '../support/pose-sample'

describe('motion calibration and detection', () => {
  it('reports missing hips instead of producing a full-body baseline', () => {
    const result = buildCalibration([poseSample(0, { changes: { 23: { visibility: 0.2 }, 24: { visibility: 0.2 } } })], 'standing')
    expect(result).toEqual({ ok: false, issue: 'hips-not-visible' })
  })

  it('emits a held lean once and rearms after neutral', () => {
    const calibration = buildCalibration([0, 40, 80, 120, 160].map(time => poseSample(time)), 'seated')
    if (!calibration.ok) throw new Error('calibration failed')
    const detector = new MotionDetector(calibration.profile, 'seated')
    const events = [
      poseSample(200, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } } }),
      poseSample(340, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } } }),
      poseSample(500), poseSample(680),
      poseSample(720, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } } }),
      poseSample(860, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } } }),
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

  it('detects seated upper-body motion without lower-body landmarks', () => {
    const profile: CalibrationProfile = {
      shoulderWidth: 0.2,
      torsoCenterX: 0.5,
      headY: 0.2,
      wristY: 0.65,
      hipY: null,
      kneeY: null,
    }
    const detector = new MotionDetector(profile, 'seated')
    const upperBodyLean = (capturedAt: number) => {
      const sample = poseSample(capturedAt, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 } } })
      return { ...sample, landmarks: sample.landmarks.slice(0, 17) }
    }

    const events = [upperBodyLean(200), upperBodyLean(340)]
      .flatMap(sample => detector.update(sample))

    expect(events.map(event => event.type)).toEqual(['lean-left'])
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
    const cases: Array<{ field: 'torsoCenterX' | 'headY' | 'hipY'; value: number; style: 'seated' | 'standing'; sample: ReturnType<typeof poseSample> }> = [
      { field: 'torsoCenterX', value: Number.NaN, style: 'seated', sample: poseSample(0) },
      { field: 'torsoCenterX', value: Number.POSITIVE_INFINITY, style: 'seated', sample: poseSample(0) },
      { field: 'headY', value: Number.NaN, style: 'seated', sample: poseSample(0) },
      { field: 'headY', value: Number.NEGATIVE_INFINITY, style: 'seated', sample: poseSample(0) },
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
    const seatedProfile: CalibrationProfile = {
      shoulderWidth: 0.2,
      torsoCenterX: 0.5,
      headY: 0.2,
      wristY: 0.65,
      hipY: null,
      kneeY: null,
    }
    const standingProfile = { ...seatedProfile, hipY: 0.7, kneeY: 0.9 }
    const cases = [
      { name: 'lean NaN', profile: seatedProfile, style: 'seated' as const, changes: { 11: { x: Number.NaN } } },
      { name: 'lean', profile: seatedProfile, style: 'seated' as const, changes: { 11: { x: Number.NEGATIVE_INFINITY } } },
      { name: 'duck NaN', profile: seatedProfile, style: 'seated' as const, changes: { 0: { y: Number.NaN } } },
      { name: 'duck', profile: seatedProfile, style: 'seated' as const, changes: { 0: { y: Number.POSITIVE_INFINITY } } },
      { name: 'hands-up', profile: seatedProfile, style: 'seated' as const, changes: { 15: { y: Number.NEGATIVE_INFINITY }, 16: { y: Number.NEGATIVE_INFINITY } } },
      { name: 'reach', profile: seatedProfile, style: 'seated' as const, changes: { 15: { x: Number.NEGATIVE_INFINITY }, 16: { x: Number.POSITIVE_INFINITY } } },
      { name: 'squat', profile: standingProfile, style: 'standing' as const, changes: { 23: { y: Number.POSITIVE_INFINITY }, 24: { y: Number.POSITIVE_INFINITY } } },
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
    const seatedProfile: CalibrationProfile = {
      shoulderWidth: 0.2,
      torsoCenterX: 0.5,
      headY: 0.2,
      wristY: 0.65,
      hipY: null,
      kneeY: null,
    }
    const standingProfile = { ...seatedProfile, hipY: 0.7, kneeY: 0.9 }
    const cases = [
      { expected: 'lean-left', profile: seatedProfile, style: 'seated' as const, changes: { 11: { x: 0.3 }, 12: { x: 0.5 } } },
      { expected: 'duck', profile: seatedProfile, style: 'seated' as const, changes: { 0: { y: 0.3 } } },
      { expected: 'hands-up', profile: seatedProfile, style: 'seated' as const, changes: { 15: { y: 0.3 }, 16: { y: 0.3 } } },
      { expected: 'reach-left', profile: seatedProfile, style: 'seated' as const, changes: { 15: { x: 0.1 }, 16: { x: 0.9 } } },
      { expected: 'reach-right', profile: seatedProfile, style: 'seated' as const, changes: { 15: { x: 0.1 }, 16: { x: 0.9 } } },
      { expected: 'squat', profile: standingProfile, style: 'standing' as const, changes: { 23: { y: 0.82 }, 24: { y: 0.82 } } },
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
    for (let index = 20; index < 60; index += 1) samples[index] = { capturedAt: index * 80, landmarks: [], confidence: 0 }
    const calibration = buildCalibration(samples.slice(0, 15), 'standing')
    if (!calibration.ok) throw new Error('calibration failed')
    expect(validateCalibrationActions(calibration.profile, samples, 'standing')).toEqual({ ok: false, issue: 'pose-lost' })
  })

  it('keeps each prompted action visible long enough to follow', () => {
    expect(CALIBRATION_SAMPLES_PER_STEP).toBeGreaterThanOrEqual(20)
    expect(getCalibrationPrompt(25, 'seated')).toContain('第 1/5 步')
    expect(getCalibrationPrompt(49, 'seated')).toContain('第 1/5 步')
    expect(getCalibrationPrompt(50, 'seated')).toContain('第 2/5 步')
  })

  it('tolerates a briefly lost pose when all prompted actions are completed', () => {
    const samples = Array.from({ length: CALIBRATION_TOTAL_SAMPLES }, (_, index) => poseSample(index * 80))
    const step = CALIBRATION_SAMPLES_PER_STEP
    for (let index = step; index < step * 2; index += 1) {
      samples[index] = poseSample(index * 80, { changes: { 11: { x: 0.32 }, 12: { x: 0.52 }, 23: { x: 0.35 }, 24: { x: 0.49 } } })
    }
    for (let index = step * 2; index < step * 3; index += 1) {
      samples[index] = poseSample(index * 80, { changes: { 11: { x: 0.48 }, 12: { x: 0.68 }, 23: { x: 0.51 }, 24: { x: 0.65 } } })
    }
    for (let index = step * 3; index < step * 4; index += 1) samples[index] = poseSample(index * 80, { changes: { 0: { y: 0.28 } } })
    for (let index = step * 4; index < step * 5; index += 1) samples[index] = poseSample(index * 80, { changes: { 15: { y: 0.3 }, 16: { y: 0.3 } } })
    for (let index = step * 5; index < step * 6; index += 1) samples[index] = poseSample(index * 80, { changes: { 15: { x: 0.1 }, 16: { x: 0.9 } } })
    samples[step * 3 + 2] = { capturedAt: (step * 3 + 2) * 80, landmarks: [], confidence: 0 }

    const calibration = buildCalibration(samples.slice(0, step), 'seated')
    if (!calibration.ok) throw new Error('calibration failed')
    expect(validateCalibrationActions(calibration.profile, samples, 'seated')).toEqual({ ok: true })
  })
})
