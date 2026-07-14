import { describe, expect, it } from 'vitest'
import {
  assessHeadAction,
  assessHeadFraming,
  assessHeadGameConditions,
  buildHeadControlProfile,
  HEAD_NOSE_CENTER_X_MAX,
  HEAD_NOSE_CENTER_X_MIN,
  HEAD_NOSE_CENTER_Y_MAX,
  HEAD_NOSE_CENTER_Y_MIN,
  HEAD_NOSE_SHOULDER_GAP_MIN,
  HEAD_SHOULDER_CENTER_X_MAX,
  HEAD_SHOULDER_CENTER_X_MIN,
  HEAD_SHOULDER_CENTER_Y_MAX,
  HEAD_SHOULDER_CENTER_Y_MIN,
  HEAD_SHOULDER_WIDTH_MAX,
  HEAD_SHOULDER_WIDTH_MIN,
  recordHeadThreshold,
} from '../../src/motion/head-control'
import type { HeadControlProfile } from '../../src/motion/head-control'
import { poseSample } from '../support/pose-sample'

const moveFace = (capturedAt: number, dx: number, dy = 0) => poseSample(capturedAt, {
  changes: Object.fromEntries([0, 2, 5, 7, 8].map(index => [index, {
    x: poseSample(0).landmarks[index].x + dx,
    y: poseSample(0).landmarks[index].y + dy,
  }])),
})

const withShoulderWidth = (sample: ReturnType<typeof poseSample>, width: number) => poseSample(sample.capturedAt, {
  changes: {
    11: { x: 0.5 - width / 2 },
    12: { x: 0.5 + width / 2 },
  },
})

describe('head control geometry', () => {
  it('keeps the framing bounds explicit for device tuning', () => {
    expect({
      shoulderWidth: [HEAD_SHOULDER_WIDTH_MIN, HEAD_SHOULDER_WIDTH_MAX],
      noseX: [HEAD_NOSE_CENTER_X_MIN, HEAD_NOSE_CENTER_X_MAX],
      noseY: [HEAD_NOSE_CENTER_Y_MIN, HEAD_NOSE_CENTER_Y_MAX],
      shoulderX: [HEAD_SHOULDER_CENTER_X_MIN, HEAD_SHOULDER_CENTER_X_MAX],
      shoulderY: [HEAD_SHOULDER_CENTER_Y_MIN, HEAD_SHOULDER_CENTER_Y_MAX],
      noseShoulderGap: HEAD_NOSE_SHOULDER_GAP_MIN,
    }).toEqual({
      shoulderWidth: [0.16, 0.44],
      noseX: [0.34, 0.66],
      noseY: [0.10, 0.34],
      shoulderX: [0.30, 0.70],
      shoulderY: [0.30, 0.62],
      noseShoulderGap: 0.10,
    })
  })

  it('accepts a centered neutral face with visible eyes ears and shoulders', () => {
    expect(assessHeadFraming(poseSample(0))).toMatchObject({
      ok: true,
      headRecognized: true,
      shouldersRecognized: true,
    })
  })

  it.each([
    [0.12, 'move-closer'],
    [0.48, 'move-back'],
  ] as const)('reports distance feedback for shoulder width %s', (width, feedback) => {
    expect(assessHeadFraming(withShoulderWidth(poseSample(0), width))).toMatchObject({ ok: false, feedback })
  })

  it('reports center-head when the otherwise valid face is outside the guide region', () => {
    expect(assessHeadFraming(moveFace(0, 0.22))).toMatchObject({ ok: false, feedback: 'center-head' })
  })

  it('requires the face support points instead of accepting the nose alone', () => {
    expect(assessHeadFraming(poseSample(0, { hidden: [2, 5, 7, 8] }))).toMatchObject({
      ok: false,
      feedback: 'head-missing',
    })
  })

  it('recognizes player-left turn from mirrored nose and face motion with stable shoulders', () => {
    const profile = buildHeadControlProfile([poseSample(0), poseSample(80)]).profile!
    expect(assessHeadAction(profile, moveFace(160, 0.04), 'turn-left')).toMatchObject({ ok: true })
  })

  it('rejects whole-body translation as a head turn', () => {
    const profile = buildHeadControlProfile([poseSample(0), poseSample(80)]).profile!
    const shifted = poseSample(160, {
      changes: Object.fromEntries([0, 2, 5, 7, 8, 11, 12].map(index => [index, {
        x: poseSample(0).landmarks[index].x + 0.04,
      }])),
    })
    expect(assessHeadAction(profile, shifted, 'turn-left')).toMatchObject({
      ok: false,
      recordable: false,
      feedback: 'shoulders-moving',
    })
  })

  it('recognizes look-up and look-down with face support and stable shoulders', () => {
    const profile = buildHeadControlProfile([poseSample(0), poseSample(80)]).profile!
    expect(assessHeadAction(profile, moveFace(160, 0, -0.03), 'look-up').ok).toBe(true)
    expect(assessHeadAction(profile, moveFace(240, 0, 0.03), 'look-down').ok).toBe(true)
  })

  it('rejects whole-body vertical translation as pitch', () => {
    const profile = buildHeadControlProfile([poseSample(0), poseSample(80)]).profile!
    const shifted = poseSample(160, {
      changes: Object.fromEntries([0, 2, 5, 7, 8, 11, 12].map(index => [index, {
        y: poseSample(0).landmarks[index].y - 0.03,
      }])),
    })
    expect(assessHeadAction(profile, shifted, 'look-up')).toMatchObject({
      ok: false,
      recordable: false,
      feedback: 'shoulders-moving',
    })
  })

  it('records demonstrated signs and requires the paired action to be opposite', () => {
    let profile = buildHeadControlProfile([poseSample(0), poseSample(80)]).profile!
    profile = recordHeadThreshold(profile, 'turn-left', -0.14)
    expect(profile.directions['turn-left']).toBe(-1)
    expect(assessHeadAction(profile, moveFace(160, 0.04), 'turn-right').ok).toBe(false)
    expect(assessHeadAction(profile, moveFace(240, -0.04), 'turn-right').ok).toBe(true)
  })

  it('personalizes thresholds with the exact bounded formula', () => {
    const baseline = buildHeadControlProfile([poseSample(0)]).profile!
    expect(recordHeadThreshold(baseline, 'turn-left', 0.01).thresholds['turn-left']).toBe(0.07)
    expect(recordHeadThreshold(baseline, 'turn-right', 1).thresholds['turn-right']).toBe(0.22)
    expect(recordHeadThreshold(baseline, 'look-up', 0.1).thresholds['look-up']).toBeCloseTo(0.07)
    expect(recordHeadThreshold(baseline, 'look-down', Number.NaN)).toMatchObject({
      thresholds: { 'look-down': 0.055 },
      directions: { 'look-down': 0 },
    })
  })

  it('projects game signals onto each demonstrated direction', () => {
    let profile = buildHeadControlProfile([poseSample(0)]).profile!
    profile = recordHeadThreshold(profile, 'turn-left', -0.14)
    profile = recordHeadThreshold(profile, 'turn-right', 0.14)
    profile = recordHeadThreshold(profile, 'look-up', -0.1)
    profile = recordHeadThreshold(profile, 'look-down', 0.1)

    const left = assessHeadGameConditions(profile, moveFace(160, 0.04))
    expect(left).toMatchObject({
      trackable: true,
      triggered: { 'turn-left': true, 'turn-right': false },
    })
    expect(assessHeadGameConditions(profile, poseSample(240)).neutral).toEqual({
      'turn-left': true,
      'turn-right': true,
      'look-up': true,
      'look-down': true,
    })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('safely rejects a required non-finite coordinate %s', coordinate => {
    const malformedNeutral = poseSample(0, { changes: { 2: { x: coordinate } } })
    expect(() => assessHeadFraming(malformedNeutral)).not.toThrow()
    expect(assessHeadFraming(malformedNeutral)).toMatchObject({ ok: false, recordable: false })

    const profile = buildHeadControlProfile([poseSample(0)]).profile!
    const malformedAction = poseSample(80, { changes: { 11: { y: coordinate } } })
    expect(() => assessHeadAction(profile, malformedAction, 'look-up')).not.toThrow()
    expect(assessHeadAction(profile, malformedAction, 'look-up')).toMatchObject({ ok: false, recordable: false })
    expect(assessHeadGameConditions(profile, malformedAction)).toMatchObject({
      trackable: false,
      triggered: {
        'turn-left': false,
        'turn-right': false,
        'look-up': false,
        'look-down': false,
      },
    })
  })

  it('returns safe all-false game signals for an incomplete profile', () => {
    const incomplete = {} as HeadControlProfile

    expect(() => assessHeadGameConditions(incomplete, poseSample(0))).not.toThrow()
    expect(assessHeadGameConditions(incomplete, poseSample(0))).toEqual({
      trackable: false,
      confidence: 0,
      strengths: { 'turn-left': 0, 'turn-right': 0, 'look-up': 0, 'look-down': 0 },
      triggered: { 'turn-left': false, 'turn-right': false, 'look-up': false, 'look-down': false },
      neutral: { 'turn-left': false, 'turn-right': false, 'look-up': false, 'look-down': false },
    })
  })
})
