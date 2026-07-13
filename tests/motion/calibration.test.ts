import { describe, expect, it } from 'vitest'
import { buildCalibration, checkFraming, getCalibrationActions, matchesCalibrationAction } from '../../src/motion/calibration'
import { poseSample } from '../support/pose-sample'

describe('mode-specific calibration', () => {
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

  it('does not match an action when its required landmark is unavailable', () => {
    const calibration = buildCalibration([poseSample(0)], 'seated')
    if (!calibration.ok) throw new Error('calibration failed')

    expect(matchesCalibrationAction(calibration.profile, poseSample(1, { hidden: [15], changes: { 15: { x: 0.1 } } }), 'seated', 'reach')).toBe(false)
  })
})
