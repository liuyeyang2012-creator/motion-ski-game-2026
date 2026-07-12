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
