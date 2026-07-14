import { describe, expect, it } from 'vitest'
import { assessCalibrationAction, buildCalibration, checkFraming, getCalibrationActions, matchesCalibrationAction } from '../../src/motion/calibration'
import { poseSample } from '../support/pose-sample'

const moveFace = (capturedAt: number, dx: number, dy = 0) => poseSample(capturedAt, {
  changes: Object.fromEntries([0, 2, 5, 7, 8].map(index => [index, {
    x: poseSample(0).landmarks[index].x + dx,
    y: poseSample(0).landmarks[index].y + dy,
  }])),
})

describe('mode-specific calibration', () => {
  it('ignores hidden legs and hands in the seated baseline', () => {
    const samples = [0, 80, 160, 240, 320].map(time => poseSample(time, {
      hidden: [15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
    }))

    expect(buildCalibration(samples, 'seated').ok).toBe(true)
  })

  it('uses a median baseline instead of an outlier-sensitive average', () => {
    const samples = [0.49, 0.5, 0.51, 0.5, 0.9].map((center, index) => poseSample(index * 80, {
      changes: { 11: { x: center - 0.1 }, 12: { x: center + 0.1 } },
    }))
    const result = buildCalibration(samples, 'seated')
    if (!result.ok) throw new Error('calibration failed')

    expect(result.profile.torsoCenterX).toBeCloseTo(0.5)
  })

  it('asks for only the missing hand during hands-up', () => {
    const calibration = buildCalibration([poseSample(0)], 'standing')
    if (!calibration.ok) throw new Error('calibration failed')

    expect(assessCalibrationAction(
      calibration.profile,
      poseSample(80, { hidden: [15] }),
      'standing',
      'hands-up',
    )).toMatchObject({
      ok: false,
      feedback: 'left-hand-missing',
      requiredIndices: [11, 12, 15, 16],
    })
  })

  it('accepts half-body framing when hips and knees are absent', () => {
    const sample = poseSample(0, { hidden: [23, 24, 25, 26] })
    expect(checkFraming(sample, 'seated')).toEqual({ ok: true })
    expect(buildCalibration([sample], 'seated').ok).toBe(true)
  })

  it('requires hips and knees for full-body framing', () => {
    const sample = poseSample(0, { hidden: [23, 24, 25, 26] })
    expect(checkFraming(sample, 'standing')).toEqual({ ok: false, issue: 'lower-body-not-visible' })
  })

  it('uses head actions for half-body and preserves full-body actions', () => {
    expect(getCalibrationActions('seated')).toEqual([
      'face-neutral', 'turn-left', 'turn-right', 'look-up', 'look-down',
    ])
    expect(getCalibrationActions('standing')).toEqual(['lean-left', 'lean-right', 'duck', 'hands-up', 'squat'])
  })

  it('builds mode-specific baseline geometry', () => {
    const seated = buildCalibration([poseSample(0, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.7 }, 24: { x: 0.9 } } })], 'seated')
    const standing = buildCalibration([poseSample(0)], 'standing')
    if (!seated.ok || !standing.ok) throw new Error('calibration failed')

    expect(seated.profile).toMatchObject({ torsoCenterX: 0.4, hipY: null, kneeY: null })
    expect(seated.profile.headControl).toBeTruthy()
    expect(standing.profile).toMatchObject({ torsoCenterX: 0.5, hipY: 0.7, kneeY: 0.9, headControl: null })
  })

  it('matches each prompted action using mode-specific landmarks', () => {
    const seated = buildCalibration([poseSample(0)], 'seated')
    const standing = buildCalibration([poseSample(0)], 'standing')
    if (!seated.ok || !standing.ok) throw new Error('calibration failed')

    expect(matchesCalibrationAction(seated.profile, moveFace(1, 0.04), 'seated', 'turn-left')).toBe(true)
    expect(matchesCalibrationAction(seated.profile, moveFace(2, 0, -0.03), 'seated', 'look-up')).toBe(true)
    expect(matchesCalibrationAction(standing.profile, poseSample(1, { changes: { 23: { y: 0.76 }, 24: { y: 0.76 } } }), 'standing', 'squat')).toBe(true)
  })

  it('does not match a head action when its required face support is unavailable', () => {
    const calibration = buildCalibration([poseSample(0)], 'seated')
    if (!calibration.ok) throw new Error('calibration failed')

    expect(matchesCalibrationAction(calibration.profile, moveFace(1, 0.04, 0), 'seated', 'turn-left')).toBe(true)
    expect(matchesCalibrationAction(
      calibration.profile,
      poseSample(1, { hidden: [7, 8], changes: { 0: { x: 0.54 }, 2: { x: 0.51 }, 5: { x: 0.57 } } }),
      'seated',
      'turn-left',
    )).toBe(false)
  })
})
