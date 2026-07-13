import { describe, expect, it } from 'vitest'
import {
  buildCalibration,
  CALIBRATION_SAMPLES_PER_STEP,
  CALIBRATION_TOTAL_SAMPLES,
  getCalibrationPrompt,
  validateCalibrationActions,
} from '../../src/motion/calibration'
import { MotionDetector } from '../../src/motion/motion-detector'
import type { PoseSample } from '../../src/pose/types'

function sample(at: number, changes: Record<number, Partial<{ x: number; y: number; visibility: number }>> = {}): PoseSample {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
  landmarks[0] = { x: 0.5, y: 0.2, z: 0, visibility: 1 }
  landmarks[11] = { x: 0.4, y: 0.4, z: 0, visibility: 1 }
  landmarks[12] = { x: 0.6, y: 0.4, z: 0, visibility: 1 }
  landmarks[15] = { x: 0.4, y: 0.65, z: 0, visibility: 1 }
  landmarks[16] = { x: 0.6, y: 0.65, z: 0, visibility: 1 }
  landmarks[23] = { x: 0.43, y: 0.7, z: 0, visibility: 1 }
  landmarks[24] = { x: 0.57, y: 0.7, z: 0, visibility: 1 }
  landmarks[25] = { x: 0.43, y: 0.9, z: 0, visibility: 1 }
  landmarks[26] = { x: 0.57, y: 0.9, z: 0, visibility: 1 }
  for (const [index, change] of Object.entries(changes)) Object.assign(landmarks[Number(index)], change)
  return { capturedAt: at, landmarks, confidence: 0.95 }
}

describe('motion calibration and detection', () => {
  it('reports missing hips instead of producing a baseline', () => {
    const result = buildCalibration([sample(0, { 23: { visibility: 0.2 }, 24: { visibility: 0.2 } })], 'seated')
    expect(result).toEqual({ ok: false, issue: 'hips-not-visible' })
  })

  it('emits a held lean once and rearms after neutral', () => {
    const calibration = buildCalibration([0, 40, 80, 120, 160].map(time => sample(time)), 'seated')
    if (!calibration.ok) throw new Error('calibration failed')
    const detector = new MotionDetector(calibration.profile, 'seated')
    const events = [
      sample(200, { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } }),
      sample(340, { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } }),
      sample(500), sample(680),
      sample(720, { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } }),
      sample(860, { 11: { x: 0.3 }, 12: { x: 0.5 }, 23: { x: 0.33 }, 24: { x: 0.47 } }),
    ].flatMap(value => detector.update(value).map(event => event.type))
    expect(events).toEqual(['lean-left', 'lean-left'])
  })

  it('never emits squat in seated mode', () => {
    const calibration = buildCalibration([0, 40, 80, 120, 160].map(time => sample(time)), 'seated')
    if (!calibration.ok) throw new Error('calibration failed')
    const detector = new MotionDetector(calibration.profile, 'seated')
    const events = [sample(200, { 23: { y: 0.82 }, 24: { y: 0.82 } }), sample(340, { 23: { y: 0.82 }, 24: { y: 0.82 } })]
      .flatMap(value => detector.update(value))
    expect(events.map(event => event.type)).not.toContain('squat')
  })

  it('rejects motionless prompted calibration actions', () => {
    const samples = Array.from({ length: 60 }, (_, index) => sample(index * 80))
    const calibration = buildCalibration(samples.slice(0, 15), 'standing')
    if (!calibration.ok) throw new Error('calibration failed')
    expect(validateCalibrationActions(calibration.profile, samples, 'standing')).toEqual({ ok: false, issue: 'lean-left-missing' })
  })

  it('retries calibration when the pose is lost for most of the sequence', () => {
    const samples = Array.from({ length: 60 }, (_, index) => sample(index * 80))
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
    const samples = Array.from({ length: CALIBRATION_TOTAL_SAMPLES }, (_, index) => sample(index * 80))
    const step = CALIBRATION_SAMPLES_PER_STEP
    for (let index = step; index < step * 2; index += 1) {
      samples[index] = sample(index * 80, { 11: { x: 0.32 }, 12: { x: 0.52 }, 23: { x: 0.35 }, 24: { x: 0.49 } })
    }
    for (let index = step * 2; index < step * 3; index += 1) {
      samples[index] = sample(index * 80, { 11: { x: 0.48 }, 12: { x: 0.68 }, 23: { x: 0.51 }, 24: { x: 0.65 } })
    }
    for (let index = step * 3; index < step * 4; index += 1) samples[index] = sample(index * 80, { 0: { y: 0.28 } })
    for (let index = step * 4; index < step * 5; index += 1) samples[index] = sample(index * 80, { 15: { y: 0.3 }, 16: { y: 0.3 } })
    for (let index = step * 5; index < step * 6; index += 1) samples[index] = sample(index * 80, { 15: { x: 0.1 }, 16: { x: 0.9 } })
    samples[step * 3 + 2] = { capturedAt: (step * 3 + 2) * 80, landmarks: [], confidence: 0 }

    const calibration = buildCalibration(samples.slice(0, step), 'seated')
    if (!calibration.ok) throw new Error('calibration failed')
    expect(validateCalibrationActions(calibration.profile, samples, 'seated')).toEqual({ ok: true })
  })
})
