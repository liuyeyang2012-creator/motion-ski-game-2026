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

export const CALIBRATION_SAMPLES_PER_STEP = 25
export const CALIBRATION_TOTAL_SAMPLES = CALIBRATION_SAMPLES_PER_STEP * 6

const calibrationPrompts = {
  seated: ['向左侧身', '向右侧身', '轻轻低头', '抬起双手', '向两侧伸展手臂'],
  standing: ['向左侧身', '向右侧身', '轻轻低头', '抬起双手', '缓慢下蹲'],
} as const

export function getCalibrationPrompt(sampleCount: number, style: PlayStyle): string | null {
  const actionIndex = Math.floor(sampleCount / CALIBRATION_SAMPLES_PER_STEP) - 1
  const prompt = calibrationPrompts[style][actionIndex]
  return prompt ? `第 ${actionIndex + 1}/5 步 · ${prompt}` : null
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

export function buildCalibration(samples: PoseSample[], _style: PlayStyle): CalibrationResult {
  if (samples.length === 0) return { ok: false, issue: 'not-enough-samples' }
  const shouldersVisible = (sample: PoseSample) => (sample.landmarks[11]?.visibility ?? 0) >= 0.6 && (sample.landmarks[12]?.visibility ?? 0) >= 0.6
  const hipsVisible = (sample: PoseSample) => (sample.landmarks[23]?.visibility ?? 0) >= 0.6 && (sample.landmarks[24]?.visibility ?? 0) >= 0.6
  const headVisible = (sample: PoseSample) => (sample.landmarks[0]?.visibility ?? 0) >= 0.6
  const minimumUsable = Math.ceil(samples.length * 0.6)
  if (samples.filter(shouldersVisible).length < minimumUsable) return { ok: false, issue: 'shoulders-not-visible' }
  if (samples.filter(hipsVisible).length < minimumUsable) return { ok: false, issue: 'hips-not-visible' }
  if (samples.filter(headVisible).length < minimumUsable) return { ok: false, issue: 'head-not-visible' }
  const usableSamples = samples.filter(sample => shouldersVisible(sample) && hipsVisible(sample) && headVisible(sample))
  if (usableSamples.length < minimumUsable) return { ok: false, issue: 'not-enough-samples' }

  return {
    ok: true,
    profile: {
      shoulderWidth: average(usableSamples.map(sample => Math.abs(sample.landmarks[12].x - sample.landmarks[11].x))),
      torsoCenterX: average(usableSamples.map(sample => (sample.landmarks[11].x + sample.landmarks[12].x + sample.landmarks[23].x + sample.landmarks[24].x) / 4)),
      headY: average(usableSamples.map(sample => sample.landmarks[0].y)),
      hipY: average(usableSamples.map(sample => (sample.landmarks[23].y + sample.landmarks[24].y) / 2)),
      wristY: average(usableSamples.map(sample => (sample.landmarks[15].y + sample.landmarks[16].y) / 2)),
    },
  }
}

export function validateCalibrationActions(profile: CalibrationProfile, samples: PoseSample[], style: PlayStyle): { ok: true } | { ok: false; issue: ActionCalibrationIssue } {
  const usable = (sample: PoseSample) => sample.confidence >= 0.6 && sample.landmarks.length >= 27
  if (samples.filter(usable).length < samples.length * 0.6) return { ok: false, issue: 'pose-lost' }
  const actionSamples = (actionIndex: number) => samples
    .slice(CALIBRATION_SAMPLES_PER_STEP * (actionIndex + 1), CALIBRATION_SAMPLES_PER_STEP * (actionIndex + 2))
    .filter(usable)
  const center = (sample: PoseSample) => (sample.landmarks[11].x + sample.landmarks[12].x + sample.landmarks[23].x + sample.landmarks[24].x) / 4
  if (!actionSamples(0).some(sample => center(sample) < profile.torsoCenterX - profile.shoulderWidth * 0.2)) return { ok: false, issue: 'lean-left-missing' }
  if (!actionSamples(1).some(sample => center(sample) > profile.torsoCenterX + profile.shoulderWidth * 0.2)) return { ok: false, issue: 'lean-right-missing' }
  if (!actionSamples(2).some(sample => sample.landmarks[0].y > profile.headY + profile.shoulderWidth * 0.2)) return { ok: false, issue: 'duck-missing' }
  if (!actionSamples(3).some(sample => sample.landmarks[15].y < sample.landmarks[11].y && sample.landmarks[16].y < sample.landmarks[12].y)) return { ok: false, issue: 'hands-up-missing' }
  if (style === 'standing') {
    if (!actionSamples(4).some(sample => (sample.landmarks[23].y + sample.landmarks[24].y) / 2 > profile.hipY + profile.shoulderWidth * 0.25)) return { ok: false, issue: 'squat-missing' }
  } else if (!actionSamples(4).some(sample => sample.landmarks[15].x < sample.landmarks[11].x - profile.shoulderWidth || sample.landmarks[16].x > sample.landmarks[12].x + profile.shoulderWidth)) return { ok: false, issue: 'reach-missing' }
  return { ok: true }
}
