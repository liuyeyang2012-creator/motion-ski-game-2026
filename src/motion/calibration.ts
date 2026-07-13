import type { PlayStyle } from '../app/types'
import type { PoseSample } from '../pose/types'

export type CalibrationAction = 'lean-left' | 'lean-right' | 'duck' | 'hands-up' | 'reach' | 'squat'
export type FramingIssue = 'pose-lost' | 'head-not-visible' | 'shoulders-not-visible' | 'hands-not-visible' | 'lower-body-not-visible'
export type FramingResult = { ok: true } | { ok: false; issue: FramingIssue }

export interface CalibrationProfile {
  shoulderWidth: number
  torsoCenterX: number
  headY: number
  wristY: number
  hipY: number | null
  kneeY: number | null
}

export type CalibrationIssue = 'not-enough-samples' | 'shoulders-not-visible' | 'hips-not-visible' | 'head-not-visible'
export type CalibrationResult = { ok: true; profile: CalibrationProfile } | { ok: false; issue: CalibrationIssue }
export type ActionCalibrationIssue = 'pose-lost' | 'lean-left-missing' | 'lean-right-missing' | 'duck-missing' | 'hands-up-missing' | 'squat-missing' | 'reach-missing'

export const CALIBRATION_SAMPLES_PER_STEP = 25
export const CALIBRATION_TOTAL_SAMPLES = CALIBRATION_SAMPLES_PER_STEP * 6

export const getCalibrationActions = (style: PlayStyle): readonly CalibrationAction[] => style === 'seated'
  ? ['lean-left', 'lean-right', 'duck', 'hands-up', 'reach']
  : ['lean-left', 'lean-right', 'duck', 'hands-up', 'squat']

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
const isVisible = (sample: PoseSample, index: number) => (sample.landmarks[index]?.visibility ?? 0) >= 0.6

export function checkFraming(sample: PoseSample, style: PlayStyle): FramingResult {
  if (sample.confidence < 0.6 || sample.landmarks.length === 0) return { ok: false, issue: 'pose-lost' }
  if (!isVisible(sample, 0)) return { ok: false, issue: 'head-not-visible' }
  if (!isVisible(sample, 11) || !isVisible(sample, 12)) return { ok: false, issue: 'shoulders-not-visible' }
  if (!isVisible(sample, 15) || !isVisible(sample, 16)) return { ok: false, issue: 'hands-not-visible' }
  if (style === 'standing' && !([23, 24, 25, 26] as const).every(index => isVisible(sample, index))) {
    return { ok: false, issue: 'lower-body-not-visible' }
  }
  return { ok: true }
}

export function buildCalibration(samples: PoseSample[], style: PlayStyle): CalibrationResult {
  if (samples.length === 0) return { ok: false, issue: 'not-enough-samples' }
  const shouldersVisible = (sample: PoseSample) => isVisible(sample, 11) && isVisible(sample, 12)
  const lowerBodyVisible = (sample: PoseSample) => ([23, 24, 25, 26] as const).every(index => isVisible(sample, index))
  const headVisible = (sample: PoseSample) => isVisible(sample, 0)
  const minimumUsable = Math.ceil(samples.length * 0.6)
  if (samples.filter(shouldersVisible).length < minimumUsable) return { ok: false, issue: 'shoulders-not-visible' }
  if (style === 'standing' && samples.filter(lowerBodyVisible).length < minimumUsable) return { ok: false, issue: 'hips-not-visible' }
  if (samples.filter(headVisible).length < minimumUsable) return { ok: false, issue: 'head-not-visible' }
  const usableSamples = samples.filter(sample => checkFraming(sample, style).ok)
  if (usableSamples.length < minimumUsable) return { ok: false, issue: 'not-enough-samples' }

  const standing = style === 'standing'
  return {
    ok: true,
    profile: {
      shoulderWidth: average(usableSamples.map(sample => Math.abs(sample.landmarks[12].x - sample.landmarks[11].x))),
      torsoCenterX: average(usableSamples.map(sample => standing
        ? (sample.landmarks[11].x + sample.landmarks[12].x + sample.landmarks[23].x + sample.landmarks[24].x) / 4
        : (sample.landmarks[11].x + sample.landmarks[12].x) / 2)),
      headY: average(usableSamples.map(sample => sample.landmarks[0].y)),
      wristY: average(usableSamples.map(sample => (sample.landmarks[15].y + sample.landmarks[16].y) / 2)),
      hipY: standing ? average(usableSamples.map(sample => (sample.landmarks[23].y + sample.landmarks[24].y) / 2)) : null,
      kneeY: standing ? average(usableSamples.map(sample => (sample.landmarks[25].y + sample.landmarks[26].y) / 2)) : null,
    },
  }
}

export function matchesCalibrationAction(profile: CalibrationProfile, sample: PoseSample, style: PlayStyle, action: CalibrationAction): boolean {
  if (sample.confidence < 0.6 || !getCalibrationActions(style).includes(action)) return false
  const required = action === 'duck'
    ? [0]
    : action === 'hands-up' || action === 'reach'
      ? [11, 12, 15, 16]
      : action === 'squat'
        ? [23, 24]
        : style === 'standing'
          ? [11, 12, 23, 24]
          : [11, 12]
  if (!required.every(index => isVisible(sample, index))) return false

  const shoulderCenterX = (sample.landmarks[11]?.x + sample.landmarks[12]?.x) / 2
  const torsoCenterX = style === 'standing'
    ? (sample.landmarks[11].x + sample.landmarks[12].x + sample.landmarks[23].x + sample.landmarks[24].x) / 4
    : shoulderCenterX
  if (action === 'lean-left') return torsoCenterX < profile.torsoCenterX - profile.shoulderWidth * 0.2
  if (action === 'lean-right') return torsoCenterX > profile.torsoCenterX + profile.shoulderWidth * 0.2
  if (action === 'duck') return sample.landmarks[0].y > profile.headY + profile.shoulderWidth * 0.2
  if (action === 'hands-up') return sample.landmarks[15].y < sample.landmarks[11].y && sample.landmarks[16].y < sample.landmarks[12].y
  if (action === 'reach') return sample.landmarks[15].x < sample.landmarks[11].x - profile.shoulderWidth && sample.landmarks[16].x > sample.landmarks[12].x + profile.shoulderWidth
  return profile.hipY !== null && (sample.landmarks[23].y + sample.landmarks[24].y) / 2 > profile.hipY + profile.shoulderWidth * 0.25
}

export function validateCalibrationActions(profile: CalibrationProfile, samples: PoseSample[], style: PlayStyle): { ok: true } | { ok: false; issue: ActionCalibrationIssue } {
  const usable = (sample: PoseSample) => sample.confidence >= 0.6 && sample.landmarks.length >= 27
  if (samples.filter(usable).length < samples.length * 0.6) return { ok: false, issue: 'pose-lost' }
  const actionSamples = (actionIndex: number) => samples
    .slice(CALIBRATION_SAMPLES_PER_STEP * (actionIndex + 1), CALIBRATION_SAMPLES_PER_STEP * (actionIndex + 2))
    .filter(usable)
  const actions = getCalibrationActions(style)
  const issues: Record<CalibrationAction, ActionCalibrationIssue> = {
    'lean-left': 'lean-left-missing',
    'lean-right': 'lean-right-missing',
    duck: 'duck-missing',
    'hands-up': 'hands-up-missing',
    reach: 'reach-missing',
    squat: 'squat-missing',
  }
  for (const [index, action] of actions.entries()) {
    if (!actionSamples(index).some(sample => matchesCalibrationAction(profile, sample, style, action))) {
      return { ok: false, issue: issues[action] }
    }
  }
  return { ok: true }
}
