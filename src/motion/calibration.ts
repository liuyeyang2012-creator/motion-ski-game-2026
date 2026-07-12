import type { PlayStyle } from '../app/types'
import type { PoseSample } from '../pose/types'

export interface CalibrationProfile {
  shoulderWidth: number
  torsoCenterX: number
  headY: number
  hipY: number
  wristY: number
}

export type CalibrationIssue = 'not-enough-samples' | 'shoulders-not-visible' | 'hips-not-visible' | 'head-not-visible'
export type CalibrationResult = { ok: true; profile: CalibrationProfile } | { ok: false; issue: CalibrationIssue }
export type ActionCalibrationIssue = 'pose-lost' | 'lean-left-missing' | 'lean-right-missing' | 'duck-missing' | 'hands-up-missing' | 'squat-missing' | 'reach-missing'

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

export function buildCalibration(samples: PoseSample[], _style: PlayStyle): CalibrationResult {
  if (samples.length === 0) return { ok: false, issue: 'not-enough-samples' }
  if (samples.some(sample => (sample.landmarks[11]?.visibility ?? 0) < 0.6 || (sample.landmarks[12]?.visibility ?? 0) < 0.6)) {
    return { ok: false, issue: 'shoulders-not-visible' }
  }
  if (samples.some(sample => (sample.landmarks[23]?.visibility ?? 0) < 0.6 || (sample.landmarks[24]?.visibility ?? 0) < 0.6)) {
    return { ok: false, issue: 'hips-not-visible' }
  }
  if (samples.some(sample => (sample.landmarks[0]?.visibility ?? 0) < 0.6)) return { ok: false, issue: 'head-not-visible' }

  return {
    ok: true,
    profile: {
      shoulderWidth: average(samples.map(sample => Math.abs(sample.landmarks[12].x - sample.landmarks[11].x))),
      torsoCenterX: average(samples.map(sample => (sample.landmarks[11].x + sample.landmarks[12].x + sample.landmarks[23].x + sample.landmarks[24].x) / 4)),
      headY: average(samples.map(sample => sample.landmarks[0].y)),
      hipY: average(samples.map(sample => (sample.landmarks[23].y + sample.landmarks[24].y) / 2)),
      wristY: average(samples.map(sample => (sample.landmarks[15].y + sample.landmarks[16].y) / 2)),
    },
  }
}

export function validateCalibrationActions(profile: CalibrationProfile, samples: PoseSample[], style: PlayStyle): { ok: true } | { ok: false; issue: ActionCalibrationIssue } {
  if (samples.some(sample => sample.confidence < 0.6 || sample.landmarks.length < 27)) return { ok: false, issue: 'pose-lost' }
  const center = (sample: PoseSample) => (sample.landmarks[11].x + sample.landmarks[12].x + sample.landmarks[23].x + sample.landmarks[24].x) / 4
  if (!samples.slice(15, 25).some(sample => center(sample) < profile.torsoCenterX - profile.shoulderWidth * 0.2)) return { ok: false, issue: 'lean-left-missing' }
  if (!samples.slice(25, 35).some(sample => center(sample) > profile.torsoCenterX + profile.shoulderWidth * 0.2)) return { ok: false, issue: 'lean-right-missing' }
  if (!samples.slice(35, 45).some(sample => sample.landmarks[0].y > profile.headY + profile.shoulderWidth * 0.2)) return { ok: false, issue: 'duck-missing' }
  if (!samples.slice(45, 55).some(sample => sample.landmarks[15].y < sample.landmarks[11].y && sample.landmarks[16].y < sample.landmarks[12].y)) return { ok: false, issue: 'hands-up-missing' }
  if (style === 'standing') {
    if (!samples.slice(55).some(sample => (sample.landmarks[23].y + sample.landmarks[24].y) / 2 > profile.hipY + profile.shoulderWidth * 0.25)) return { ok: false, issue: 'squat-missing' }
  } else if (!samples.slice(55).some(sample => sample.landmarks[15].x < sample.landmarks[11].x - profile.shoulderWidth || sample.landmarks[16].x > sample.landmarks[12].x + profile.shoulderWidth)) return { ok: false, issue: 'reach-missing' }
  return { ok: true }
}
