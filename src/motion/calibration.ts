import type { PlayStyle } from '../app/types'
import { assessLandmarks, landmarkIsUsable } from '../pose/pose-quality'
import type { PoseSample } from '../pose/types'
import {
  assessHeadAction,
  assessHeadFraming,
  buildHeadControlProfile,
  HEAD_REQUIRED_INDICES,
  recordHeadThreshold,
} from './head-control'
import type { HeadCalibrationAction, HeadControlProfile, HeadFeedbackCode, HeadMotionAction } from './head-control'

export type CalibrationAction =
  | HeadCalibrationAction
  | 'lean-left' | 'lean-right' | 'duck' | 'hands-up' | 'reach' | 'squat'
export type FramingIssue = 'pose-lost' | 'head-not-visible' | 'shoulders-not-visible' | 'hands-not-visible' | 'lower-body-not-visible'
export type FramingResult = { ok: true } | { ok: false; issue: FramingIssue }

export interface CalibrationProfile {
  shoulderWidth: number
  torsoCenterX: number
  headY: number
  wristY: number
  hipY: number | null
  kneeY: number | null
  headControl?: HeadControlProfile | null
}

export type CalibrationIssue = 'not-enough-samples' | 'shoulders-not-visible' | 'hips-not-visible' | 'head-not-visible'
export type CalibrationResult = { ok: true; profile: CalibrationProfile } | { ok: false; issue: CalibrationIssue }
export type ActionCalibrationIssue =
  | 'pose-lost' | 'face-neutral-missing' | 'turn-left-missing' | 'turn-right-missing'
  | 'look-up-missing' | 'look-down-missing' | 'lean-left-missing' | 'lean-right-missing'
  | 'duck-missing' | 'hands-up-missing' | 'squat-missing' | 'reach-missing'
export type CalibrationFeedbackCode = HeadFeedbackCode
  | 'body-not-found'
  | 'left-hand-missing'
  | 'right-hand-missing'
  | 'hips-missing'
  | 'knees-missing'
  | 'move-left'
  | 'move-right'
  | 'lower-head'
  | 'raise-left-hand'
  | 'raise-right-hand'
  | 'spread-hands'
  | 'lower-hips'

export interface CalibrationAssessment {
  ok: boolean
  feedback: CalibrationFeedbackCode
  requiredIndices: readonly number[]
  confidence: number
}

export const CALIBRATION_SAMPLES_PER_STEP = 25
export const CALIBRATION_TOTAL_SAMPLES = CALIBRATION_SAMPLES_PER_STEP * 6

const HEAD_CALIBRATION_ACTIONS = [
  'face-neutral', 'turn-left', 'turn-right', 'look-up', 'look-down',
] as const satisfies readonly HeadCalibrationAction[]

const isHeadCalibrationAction = (action: CalibrationAction): action is HeadCalibrationAction => (
  (HEAD_CALIBRATION_ACTIONS as readonly CalibrationAction[]).includes(action)
)

export const getCalibrationActions = (style: PlayStyle): readonly CalibrationAction[] => style === 'seated'
  ? HEAD_CALIBRATION_ACTIONS
  : ['lean-left', 'lean-right', 'duck', 'hands-up', 'squat']

const calibrationPrompts = {
  seated: ['保持头部居中', '向左转头', '向右转头', '抬头', '低头'],
  standing: ['向左侧身', '向右侧身', '轻轻低头', '抬起双手', '缓慢下蹲'],
} as const

export function getCalibrationPrompt(sampleCount: number, style: PlayStyle): string | null {
  const actionIndex = Math.floor(sampleCount / CALIBRATION_SAMPLES_PER_STEP) - 1
  const prompt = calibrationPrompts[style][actionIndex]
  return prompt ? `第 ${actionIndex + 1}/5 步 · ${prompt}` : null
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}
const isVisible = (sample: PoseSample, index: number) => landmarkIsUsable(sample, index)

export function requiredLandmarksFor(style: PlayStyle, action: CalibrationAction | null): readonly number[] {
  if (style === 'seated' && action !== null && isHeadCalibrationAction(action)) return HEAD_REQUIRED_INDICES
  if (action === 'duck') return [0, 11, 12]
  if (action === 'hands-up' || action === 'reach') return [11, 12, 15, 16]
  if (action === 'squat') return [23, 24, 25, 26]
  if (action === 'lean-left' || action === 'lean-right') {
    return style === 'standing' ? [11, 12, 23, 24] : [11, 12]
  }
  return style === 'standing' ? [0, 11, 12, 23, 24] : [0, 11, 12]
}

export function checkFraming(sample: PoseSample, style: PlayStyle): FramingResult {
  if (sample.landmarks.length === 0) return { ok: false, issue: 'pose-lost' }
  if (!isVisible(sample, 0)) return { ok: false, issue: 'head-not-visible' }
  if (!isVisible(sample, 11) || !isVisible(sample, 12)) return { ok: false, issue: 'shoulders-not-visible' }
  if (style === 'standing' && (!isVisible(sample, 23) || !isVisible(sample, 24))) {
    return { ok: false, issue: 'lower-body-not-visible' }
  }
  return { ok: true }
}

export function buildCalibration(samples: PoseSample[], style: PlayStyle): CalibrationResult {
  if (samples.length === 0) return { ok: false, issue: 'not-enough-samples' }
  const shouldersVisible = (sample: PoseSample) => isVisible(sample, 11) && isVisible(sample, 12)
  const hipsVisible = (sample: PoseSample) => isVisible(sample, 23) && isVisible(sample, 24)
  const headVisible = (sample: PoseSample) => isVisible(sample, 0)
  const minimumUsable = Math.ceil(samples.length * 0.6)
  if (samples.filter(shouldersVisible).length < minimumUsable) return { ok: false, issue: 'shoulders-not-visible' }
  if (style === 'standing' && samples.filter(hipsVisible).length < minimumUsable) return { ok: false, issue: 'hips-not-visible' }
  if (samples.filter(headVisible).length < minimumUsable) return { ok: false, issue: 'head-not-visible' }
  const usableSamples = samples.filter(sample => checkFraming(sample, style).ok)
  if (usableSamples.length < minimumUsable) return { ok: false, issue: 'not-enough-samples' }

  const standing = style === 'standing'
  const headControlResult = standing ? null : buildHeadControlProfile(usableSamples)
  if (headControlResult && !headControlResult.ok) return { ok: false, issue: 'head-not-visible' }
  const shoulderWidths = usableSamples.map(sample => Math.abs(sample.landmarks[12].x - sample.landmarks[11].x))
  return {
    ok: true,
    profile: {
      shoulderWidth: median(shoulderWidths),
      torsoCenterX: median(usableSamples.map(sample => standing
        ? (sample.landmarks[11].x + sample.landmarks[12].x + sample.landmarks[23].x + sample.landmarks[24].x) / 4
        : (sample.landmarks[11].x + sample.landmarks[12].x) / 2)),
      headY: median(usableSamples.map(sample => sample.landmarks[0].y)),
      wristY: median(usableSamples.map(sample => isVisible(sample, 15) && isVisible(sample, 16)
        ? (sample.landmarks[15].y + sample.landmarks[16].y) / 2
        : (sample.landmarks[11].y + sample.landmarks[12].y) / 2
          + Math.abs(sample.landmarks[12].x - sample.landmarks[11].x))),
      hipY: standing ? median(usableSamples.map(sample => (sample.landmarks[23].y + sample.landmarks[24].y) / 2)) : null,
      kneeY: standing && usableSamples.some(sample => isVisible(sample, 25) && isVisible(sample, 26))
        ? median(usableSamples
          .filter(sample => isVisible(sample, 25) && isVisible(sample, 26))
          .map(sample => (sample.landmarks[25].y + sample.landmarks[26].y) / 2))
        : null,
      headControl: standing ? null : headControlResult!.profile,
    },
  }
}

export function assessCalibrationAction(
  profile: CalibrationProfile,
  sample: PoseSample,
  style: PlayStyle,
  action: CalibrationAction,
): CalibrationAssessment {
  const requiredIndices = requiredLandmarksFor(style, action)
  if (style === 'seated') {
    if (!isHeadCalibrationAction(action) || !profile.headControl) {
      return { ok: false, feedback: 'body-not-found', requiredIndices, confidence: 0 }
    }
    const assessment = action === 'face-neutral'
      ? assessHeadFraming(sample)
      : assessHeadAction(profile.headControl, sample, action)
    return {
      ok: assessment.ok,
      feedback: assessment.feedback,
      requiredIndices,
      confidence: assessment.confidence,
    }
  }
  if (sample.landmarks.length === 0 || !getCalibrationActions(style).includes(action)) {
    return { ok: false, feedback: 'body-not-found', requiredIndices, confidence: 0 }
  }
  const quality = assessLandmarks(sample, requiredIndices)
  if (!quality.ok) {
    const firstMissing = quality.missing[0]
    const feedback: CalibrationFeedbackCode = firstMissing === 0
      ? 'head-missing'
      : firstMissing === 11 || firstMissing === 12
        ? 'shoulders-missing'
        : firstMissing === 15
          ? 'left-hand-missing'
          : firstMissing === 16
            ? 'right-hand-missing'
            : firstMissing === 23 || firstMissing === 24
              ? 'hips-missing'
              : 'knees-missing'
    return { ok: false, feedback, requiredIndices, confidence: 0 }
  }

  const shoulderCenterX = (sample.landmarks[11]?.x + sample.landmarks[12]?.x) / 2
  const torsoCenterX = style === 'standing'
    ? (sample.landmarks[11].x + sample.landmarks[12].x + sample.landmarks[23].x + sample.landmarks[24].x) / 4
    : shoulderCenterX
  let ok = false
  let feedback: CalibrationFeedbackCode
  if (action === 'lean-left') {
    ok = torsoCenterX < profile.torsoCenterX - profile.shoulderWidth * 0.2
    feedback = ok ? 'hold' : 'move-left'
  } else if (action === 'lean-right') {
    ok = torsoCenterX > profile.torsoCenterX + profile.shoulderWidth * 0.2
    feedback = ok ? 'hold' : 'move-right'
  } else if (action === 'duck') {
    ok = sample.landmarks[0].y > profile.headY + profile.shoulderWidth * 0.2
    feedback = ok ? 'hold' : 'lower-head'
  } else if (action === 'hands-up') {
    const leftRaised = sample.landmarks[15].y < sample.landmarks[11].y
    const rightRaised = sample.landmarks[16].y < sample.landmarks[12].y
    ok = leftRaised && rightRaised
    feedback = ok ? 'hold' : !leftRaised ? 'raise-left-hand' : 'raise-right-hand'
  } else if (action === 'reach') {
    const wristSpan = sample.landmarks[16].x - sample.landmarks[15].x
    ok = sample.landmarks[15].x < sample.landmarks[11].x
      && sample.landmarks[16].x > sample.landmarks[12].x
      && wristSpan >= profile.shoulderWidth * 1.5
    feedback = ok ? 'hold' : 'spread-hands'
  } else {
    ok = profile.hipY !== null
      && (sample.landmarks[23].y + sample.landmarks[24].y) / 2 > profile.hipY + profile.shoulderWidth * 0.25
    feedback = ok ? 'hold' : 'lower-hips'
  }
  return { ok, feedback, requiredIndices, confidence: quality.confidence }
}

export function matchesCalibrationAction(profile: CalibrationProfile, sample: PoseSample, style: PlayStyle, action: CalibrationAction): boolean {
  return assessCalibrationAction(profile, sample, style, action).ok
}

export function validateCalibrationActions(profile: CalibrationProfile, samples: PoseSample[], style: PlayStyle): { ok: true } | { ok: false; issue: ActionCalibrationIssue } {
  const usable = (sample: PoseSample) => sample.landmarks.length >= 27
  if (samples.filter(usable).length < samples.length * 0.6) return { ok: false, issue: 'pose-lost' }
  const actionSamples = (actionIndex: number) => samples
    .slice(CALIBRATION_SAMPLES_PER_STEP * (actionIndex + 1), CALIBRATION_SAMPLES_PER_STEP * (actionIndex + 2))
    .filter(usable)
  const actions = getCalibrationActions(style)
  if (style === 'seated') {
    let headControl = profile.headControl
    if (!headControl) return { ok: false, issue: 'face-neutral-missing' }
    const issues: Record<HeadCalibrationAction, ActionCalibrationIssue> = {
      'face-neutral': 'face-neutral-missing',
      'turn-left': 'turn-left-missing',
      'turn-right': 'turn-right-missing',
      'look-up': 'look-up-missing',
      'look-down': 'look-down-missing',
    }
    for (const [index, action] of HEAD_CALIBRATION_ACTIONS.entries()) {
      if (action === 'face-neutral') {
        if (!actionSamples(index).some(sample => assessHeadFraming(sample).ok)) {
          return { ok: false, issue: issues[action] }
        }
        continue
      }
      const evidence = actionSamples(index)
        .map(sample => assessHeadAction(headControl!, sample, action as HeadMotionAction))
        .find(assessment => assessment.ok)
      if (!evidence) return { ok: false, issue: issues[action] }
      headControl = recordHeadThreshold(headControl, action, evidence.strength)
    }
    return { ok: true }
  }
  const issues: Record<CalibrationAction, ActionCalibrationIssue> = {
    'face-neutral': 'face-neutral-missing',
    'turn-left': 'turn-left-missing',
    'turn-right': 'turn-right-missing',
    'look-up': 'look-up-missing',
    'look-down': 'look-down-missing',
    'lean-left': 'lean-left-missing',
    'lean-right': 'lean-right-missing',
    duck: 'duck-missing',
    'hands-up': 'hands-up-missing',
    reach: 'reach-missing',
    squat: 'squat-missing',
  }
  for (const [index, action] of actions.entries()) {
    if (!actionSamples(index).some(sample => assessCalibrationAction(profile, sample, style, action).ok)) {
      return { ok: false, issue: issues[action] }
    }
  }
  return { ok: true }
}
