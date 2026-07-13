import { describe, expect, it } from 'vitest'
import { assessCalibrationAction, buildCalibration, checkFraming, getCalibrationActions, matchesCalibrationAction } from '../../src/motion/calibration'
import { poseSample } from '../support/pose-sample'

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
    const calibration = buildCalibration([poseSample(0)], 'seated')
    if (!calibration.ok) throw new Error('calibration failed')

    expect(assessCalibrationAction(
      calibration.profile,
      poseSample(80, { hidden: [15] }),
      'seated',
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

  it('uses reach for half-body and squat for full-body step five', () => {
    expect(getCalibrationActions('seated')).toEqual(['lean-left', 'lean-right', 'duck', 'hands-up', 'reach'])
    expect(getCalibrationActions('standing')).toEqual(['lean-left', 'lean-right', 'duck', 'hands-up', 'squat'])
  })

  it('builds mode-specific baseline geometry', () => {
    const seated = buildCalibration([poseSample(0, { changes: { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.7 }, 24: { x: 0.9 } } })], 'seated')
    const standing = buildCalibration([poseSample(0)], 'standing')
    if (!seated.ok || !standing.ok) throw new Error('calibration failed')

    expect(seated.profile).toMatchObject({ torsoCenterX: 0.4, hipY: null, kneeY: null })
    expect(standing.profile).toMatchObject({ torsoCenterX: 0.5, hipY: 0.7, kneeY: 0.9 })
  })

  it('matches each prompted action using mode-specific landmarks', () => {
    const seated = buildCalibration([poseSample(0)], 'seated')
    const standing = buildCalibration([poseSample(0)], 'standing')
    if (!seated.ok || !standing.ok) throw new Error('calibration failed')

    expect(matchesCalibrationAction(seated.profile, poseSample(1, { changes: { 11: { x: 0.34 }, 12: { x: 0.54 } } }), 'seated', 'lean-left')).toBe(true)
    expect(matchesCalibrationAction(seated.profile, poseSample(1, { changes: { 15: { x: 0.1 } } }), 'seated', 'reach')).toBe(false)
    expect(matchesCalibrationAction(seated.profile, poseSample(1, { changes: { 15: { x: 0.1 }, 16: { x: 0.9 } } }), 'seated', 'reach')).toBe(true)
    expect(matchesCalibrationAction(standing.profile, poseSample(1, { changes: { 23: { y: 0.76 }, 24: { y: 0.76 } } }), 'standing', 'squat')).toBe(true)
  })

  it.each([0.35, 0.4, 0.5])('accepts realistic bilateral reach at shoulder width %s', shoulderWidth => {
    const leftShoulderX = 0.5 - shoulderWidth / 2
    const rightShoulderX = 0.5 + shoulderWidth / 2
    const calibration = buildCalibration([poseSample(0, {
      changes: { 11: { x: leftShoulderX }, 12: { x: rightShoulderX } },
    })], 'seated')
    if (!calibration.ok) throw new Error('calibration failed')

    expect(matchesCalibrationAction(calibration.profile, poseSample(1, {
      changes: {
        11: { x: leftShoulderX },
        12: { x: rightShoulderX },
        15: { x: 0.5 - shoulderWidth * 0.8 },
        16: { x: 0.5 + shoulderWidth * 0.8 },
      },
    }), 'seated', 'reach')).toBe(true)
  })

  it('rejects one-arm reach and bilateral reach with insufficient span', () => {
    const calibration = buildCalibration([poseSample(0, {
      changes: { 11: { x: 0.3 }, 12: { x: 0.7 } },
    })], 'seated')
    if (!calibration.ok) throw new Error('calibration failed')

    expect(matchesCalibrationAction(calibration.profile, poseSample(1, {
      changes: { 11: { x: 0.3 }, 12: { x: 0.7 }, 15: { x: 0.18 }, 16: { x: 0.7 } },
    }), 'seated', 'reach')).toBe(false)
    expect(matchesCalibrationAction(calibration.profile, poseSample(2, {
      changes: { 11: { x: 0.3 }, 12: { x: 0.7 }, 15: { x: 0.28 }, 16: { x: 0.72 } },
    }), 'seated', 'reach')).toBe(false)
  })

  it('does not match an action when its required landmark is unavailable', () => {
    const calibration = buildCalibration([poseSample(0)], 'seated')
    if (!calibration.ok) throw new Error('calibration failed')

    expect(matchesCalibrationAction(calibration.profile, poseSample(1, { hidden: [15], changes: { 15: { x: 0.1 } } }), 'seated', 'reach')).toBe(false)
  })
})
