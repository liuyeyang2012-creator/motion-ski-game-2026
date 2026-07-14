import { assessLandmarks, landmarkIsUsable } from '../pose/pose-quality'
import type { PoseSample } from '../pose/types'

export const HEAD_REQUIRED_INDICES = [0, 2, 5, 7, 8, 11, 12] as const

export const HEAD_SHOULDER_WIDTH_MIN = 0.16
export const HEAD_SHOULDER_WIDTH_MAX = 0.44
export const HEAD_NOSE_CENTER_X_MIN = 0.34
export const HEAD_NOSE_CENTER_X_MAX = 0.66
export const HEAD_NOSE_CENTER_Y_MIN = 0.10
export const HEAD_NOSE_CENTER_Y_MAX = 0.34
export const HEAD_SHOULDER_CENTER_X_MIN = 0.30
export const HEAD_SHOULDER_CENTER_X_MAX = 0.70
export const HEAD_SHOULDER_CENTER_Y_MIN = 0.30
export const HEAD_SHOULDER_CENTER_Y_MAX = 0.62
export const HEAD_NOSE_SHOULDER_GAP_MIN = 0.10

const SHOULDER_STABILITY_RATIO = 0.12
const SUPPORT_STRENGTH_RATIO = 0.35
const NEUTRAL_THRESHOLD_RATIO = 0.45

export type HeadCalibrationAction = 'face-neutral' | 'turn-left' | 'turn-right' | 'look-up' | 'look-down'
export type HeadMotionAction = Exclude<HeadCalibrationAction, 'face-neutral'>
export type HeadFeedbackCode =
  | 'head-missing' | 'shoulders-missing' | 'move-closer' | 'move-back'
  | 'center-head' | 'shoulders-moving' | 'turn-left-more' | 'turn-right-more'
  | 'look-up-more' | 'look-down-more' | 'hold'

export interface HeadPoseMetrics {
  shoulderWidth: number
  shoulderCenterX: number
  shoulderCenterY: number
  noseOffsetX: number
  noseOffsetY: number
  supportOffsetX: number
  supportOffsetY: number
  confidence: number
}

export interface HeadControlProfile {
  neutral: HeadPoseMetrics
  thresholds: Record<HeadMotionAction, number>
  directions: Record<HeadMotionAction, -1 | 0 | 1>
}

export interface HeadAssessment {
  ok: boolean
  recordable: boolean
  feedback: HeadFeedbackCode
  confidence: number
  strength: number
  headRecognized: boolean
  shouldersRecognized: boolean
}

export interface HeadGameSignals {
  trackable: boolean
  confidence: number
  strengths: Record<HeadMotionAction, number>
  triggered: Record<HeadMotionAction, boolean>
  neutral: Record<HeadMotionAction, boolean>
}

export type HeadControlProfileResult =
  | { ok: true; profile: HeadControlProfile }
  | { ok: false; profile: null; feedback: HeadFeedbackCode }

const DEFAULT_THRESHOLD: Record<HeadMotionAction, number> = {
  'turn-left': 0.10,
  'turn-right': 0.10,
  'look-up': 0.08,
  'look-down': 0.08,
}

const MIN_THRESHOLD: Record<HeadMotionAction, number> = {
  'turn-left': 0.07,
  'turn-right': 0.07,
  'look-up': 0.055,
  'look-down': 0.055,
}

const MAX_THRESHOLD: Record<HeadMotionAction, number> = {
  'turn-left': 0.22,
  'turn-right': 0.22,
  'look-up': 0.18,
  'look-down': 0.18,
}

const ACTIONS: readonly HeadMotionAction[] = ['turn-left', 'turn-right', 'look-up', 'look-down']

const feedbackFor = (action: HeadMotionAction): HeadFeedbackCode => `${action}-more`

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const emptyBooleanMap = (): Record<HeadMotionAction, boolean> => ({
  'turn-left': false,
  'turn-right': false,
  'look-up': false,
  'look-down': false,
})

const emptyStrengthMap = (): Record<HeadMotionAction, number> => ({
  'turn-left': 0,
  'turn-right': 0,
  'look-up': 0,
  'look-down': 0,
})

const unavailableAssessment = (
  feedback: HeadFeedbackCode,
  headRecognized: boolean,
  shouldersRecognized: boolean,
): HeadAssessment => ({
  ok: false,
  recordable: false,
  feedback,
  confidence: 0,
  strength: 0,
  headRecognized,
  shouldersRecognized,
})

interface MetricsResult {
  metrics: HeadPoseMetrics | null
  headRecognized: boolean
  shouldersRecognized: boolean
}

function readMetrics(sample: PoseSample, requireBothEars: boolean): MetricsResult {
  const shoulders = assessLandmarks(sample, [11, 12])
  const coreFace = assessLandmarks(sample, [0, 2, 5])
  const usableEars = [7, 8].filter(index => landmarkIsUsable(sample, index))
  const earsRecognized = requireBothEars ? usableEars.length === 2 : usableEars.length >= 1
  const headRecognized = coreFace.ok && earsRecognized
  if (!shoulders.ok || !headRecognized) {
    return { metrics: null, headRecognized, shouldersRecognized: shoulders.ok }
  }

  const shoulderWidth = Math.abs(sample.landmarks[12].x - sample.landmarks[11].x)
  if (!Number.isFinite(shoulderWidth) || shoulderWidth <= 0) {
    return { metrics: null, headRecognized, shouldersRecognized: false }
  }

  const mirroredX = (index: number) => 1 - sample.landmarks[index].x
  const shoulderCenterX = (mirroredX(11) + mirroredX(12)) / 2
  const shoulderCenterY = (sample.landmarks[11].y + sample.landmarks[12].y) / 2
  const supportIndices = [2, 5, ...usableEars]
  const supportCenterX = supportIndices.reduce((sum, index) => sum + mirroredX(index), 0) / supportIndices.length
  const supportCenterY = supportIndices.reduce((sum, index) => sum + sample.landmarks[index].y, 0) / supportIndices.length
  const confidenceIndices = [0, 2, 5, ...usableEars, 11, 12]
  const confidence = assessLandmarks(sample, confidenceIndices).confidence
  const metrics: HeadPoseMetrics = {
    shoulderWidth,
    shoulderCenterX,
    shoulderCenterY,
    noseOffsetX: (mirroredX(0) - shoulderCenterX) / shoulderWidth,
    noseOffsetY: (sample.landmarks[0].y - shoulderCenterY) / shoulderWidth,
    supportOffsetX: (supportCenterX - shoulderCenterX) / shoulderWidth,
    supportOffsetY: (supportCenterY - shoulderCenterY) / shoulderWidth,
    confidence,
  }
  if (Object.values(metrics).some(value => !Number.isFinite(value))) {
    return { metrics: null, headRecognized: false, shouldersRecognized: shoulders.ok }
  }
  return { metrics, headRecognized: true, shouldersRecognized: true }
}

function metricsAreValid(metrics: HeadPoseMetrics | null | undefined): metrics is HeadPoseMetrics {
  if (!metrics || typeof metrics !== 'object') return false
  return Number.isFinite(metrics.shoulderWidth)
    && metrics.shoulderWidth > 0
    && Object.values(metrics).every(Number.isFinite)
}

function profileIsValid(profile: HeadControlProfile | null | undefined): profile is HeadControlProfile {
  if (!profile || typeof profile !== 'object'
    || !metricsAreValid(profile.neutral)
    || !profile.thresholds || typeof profile.thresholds !== 'object'
    || !profile.directions || typeof profile.directions !== 'object') return false
  return ACTIONS.every(action => Number.isFinite(profile.thresholds[action]) && profile.thresholds[action] > 0)
    && ACTIONS.every(action => profile.directions[action] === -1
      || profile.directions[action] === 0
      || profile.directions[action] === 1)
}

function shouldersAreStable(neutral: HeadPoseMetrics, current: HeadPoseMetrics): boolean {
  return Math.hypot(
    current.shoulderCenterX - neutral.shoulderCenterX,
    current.shoulderCenterY - neutral.shoulderCenterY,
  ) <= neutral.shoulderWidth * SHOULDER_STABILITY_RATIO
}

function actionAxis(action: HeadMotionAction): 'x' | 'y' {
  return action === 'turn-left' || action === 'turn-right' ? 'x' : 'y'
}

function rawDeltas(neutral: HeadPoseMetrics, current: HeadPoseMetrics, axis: 'x' | 'y') {
  return axis === 'x'
    ? {
        primary: current.noseOffsetX - neutral.noseOffsetX,
        support: current.supportOffsetX - neutral.supportOffsetX,
      }
    : {
        primary: current.noseOffsetY - neutral.noseOffsetY,
        support: current.supportOffsetY - neutral.supportOffsetY,
      }
}

function supportAgrees(primary: number, support: number): boolean {
  return primary !== 0
    && support !== 0
    && Math.sign(primary) === Math.sign(support)
    && Math.abs(support) >= Math.abs(primary) * SUPPORT_STRENGTH_RATIO
}

function pairedAction(action: HeadMotionAction): HeadMotionAction {
  if (action === 'turn-left') return 'turn-right'
  if (action === 'turn-right') return 'turn-left'
  if (action === 'look-up') return 'look-down'
  return 'look-up'
}

function expectedDirection(profile: HeadControlProfile, action: HeadMotionAction): -1 | 0 | 1 {
  const ownDirection = profile.directions[action]
  if (ownDirection !== 0) return ownDirection
  const pairedDirection = profile.directions[pairedAction(action)]
  return pairedDirection === 0 ? 0 : pairedDirection === 1 ? -1 : 1
}

export function assessHeadFraming(sample: PoseSample): HeadAssessment {
  const result = readMetrics(sample, true)
  if (!result.headRecognized) {
    return unavailableAssessment('head-missing', false, result.shouldersRecognized)
  }
  if (!result.shouldersRecognized || !result.metrics) {
    return unavailableAssessment('shoulders-missing', true, false)
  }

  const metrics = result.metrics
  if (metrics.shoulderWidth < HEAD_SHOULDER_WIDTH_MIN) {
    return { ...unavailableAssessment('move-closer', true, true), confidence: metrics.confidence }
  }
  if (metrics.shoulderWidth > HEAD_SHOULDER_WIDTH_MAX) {
    return { ...unavailableAssessment('move-back', true, true), confidence: metrics.confidence }
  }

  const noseCenterX = metrics.shoulderCenterX + metrics.noseOffsetX * metrics.shoulderWidth
  const noseCenterY = metrics.shoulderCenterY + metrics.noseOffsetY * metrics.shoulderWidth
  const centered = noseCenterX >= HEAD_NOSE_CENTER_X_MIN
    && noseCenterX <= HEAD_NOSE_CENTER_X_MAX
    && noseCenterY >= HEAD_NOSE_CENTER_Y_MIN
    && noseCenterY <= HEAD_NOSE_CENTER_Y_MAX
    && metrics.shoulderCenterX >= HEAD_SHOULDER_CENTER_X_MIN
    && metrics.shoulderCenterX <= HEAD_SHOULDER_CENTER_X_MAX
    && metrics.shoulderCenterY >= HEAD_SHOULDER_CENTER_Y_MIN
    && metrics.shoulderCenterY <= HEAD_SHOULDER_CENTER_Y_MAX
    && metrics.shoulderCenterY - noseCenterY >= HEAD_NOSE_SHOULDER_GAP_MIN
  if (!centered) {
    return { ...unavailableAssessment('center-head', true, true), confidence: metrics.confidence }
  }
  return {
    ok: true,
    recordable: true,
    feedback: 'hold',
    confidence: metrics.confidence,
    strength: 0,
    headRecognized: true,
    shouldersRecognized: true,
  }
}

export function buildHeadControlProfile(samples: PoseSample[]): HeadControlProfileResult {
  if (samples.length === 0) return { ok: false, profile: null, feedback: 'head-missing' }
  const usable = samples
    .map(sample => ({ assessment: assessHeadFraming(sample), result: readMetrics(sample, true) }))
    .filter(entry => entry.assessment.ok && entry.result.metrics !== null)
  if (usable.length < Math.ceil(samples.length * 0.6)) {
    const feedback = samples.map(assessHeadFraming).find(assessment => !assessment.ok)?.feedback ?? 'head-missing'
    return { ok: false, profile: null, feedback }
  }

  const metrics = usable.map(entry => entry.result.metrics!)
  const neutral: HeadPoseMetrics = {
    shoulderWidth: median(metrics.map(value => value.shoulderWidth)),
    shoulderCenterX: median(metrics.map(value => value.shoulderCenterX)),
    shoulderCenterY: median(metrics.map(value => value.shoulderCenterY)),
    noseOffsetX: median(metrics.map(value => value.noseOffsetX)),
    noseOffsetY: median(metrics.map(value => value.noseOffsetY)),
    supportOffsetX: median(metrics.map(value => value.supportOffsetX)),
    supportOffsetY: median(metrics.map(value => value.supportOffsetY)),
    confidence: median(metrics.map(value => value.confidence)),
  }
  return {
    ok: true,
    profile: {
      neutral,
      thresholds: { ...DEFAULT_THRESHOLD },
      directions: {
        'turn-left': 0,
        'turn-right': 0,
        'look-up': 0,
        'look-down': 0,
      },
    },
  }
}

export function assessHeadAction(
  profile: HeadControlProfile,
  sample: PoseSample,
  action: HeadMotionAction,
): HeadAssessment {
  const result = readMetrics(sample, false)
  if (!result.headRecognized) {
    return unavailableAssessment('head-missing', false, result.shouldersRecognized)
  }
  if (!result.shouldersRecognized || !result.metrics) {
    return unavailableAssessment('shoulders-missing', true, false)
  }
  if (!profileIsValid(profile)) return unavailableAssessment('head-missing', true, true)

  const metrics = result.metrics
  if (!shouldersAreStable(profile.neutral, metrics)) {
    return {
      ...unavailableAssessment('shoulders-moving', true, true),
      confidence: metrics.confidence,
    }
  }

  const { primary, support } = rawDeltas(profile.neutral, metrics, actionAxis(action))
  const expected = expectedDirection(profile, action)
  const directionCorrect = expected === 0 || Math.sign(primary) === expected
  const recordable = supportAgrees(primary, support) && directionCorrect
  const ok = recordable && Math.abs(primary) >= profile.thresholds[action]
  return {
    ok,
    recordable,
    feedback: ok ? 'hold' : feedbackFor(action),
    confidence: metrics.confidence,
    strength: primary,
    headRecognized: true,
    shouldersRecognized: true,
  }
}

export function recordHeadThreshold(
  profile: HeadControlProfile,
  action: HeadMotionAction,
  signedStrength: number,
): HeadControlProfile {
  const finiteStrength = Number.isFinite(signedStrength) ? signedStrength : 0
  const value = Math.min(MAX_THRESHOLD[action], Math.max(MIN_THRESHOLD[action], Math.abs(finiteStrength) * 0.7))
  const direction = finiteStrength < 0 ? -1 : finiteStrength > 0 ? 1 : 0
  return {
    ...profile,
    thresholds: { ...profile.thresholds, [action]: value },
    directions: { ...profile.directions, [action]: direction },
  }
}

export function assessHeadGameConditions(
  profile: HeadControlProfile,
  sample: PoseSample,
): HeadGameSignals {
  const unavailable = (): HeadGameSignals => ({
    trackable: false,
    confidence: 0,
    strengths: emptyStrengthMap(),
    triggered: emptyBooleanMap(),
    neutral: emptyBooleanMap(),
  })
  if (!profileIsValid(profile)) return unavailable()
  const result = readMetrics(sample, false)
  if (!result.metrics || !result.headRecognized || !result.shouldersRecognized) return unavailable()
  if (!shouldersAreStable(profile.neutral, result.metrics)) return unavailable()

  const yaw = rawDeltas(profile.neutral, result.metrics, 'x')
  const pitch = rawDeltas(profile.neutral, result.metrics, 'y')
  if (![yaw.primary, yaw.support, pitch.primary, pitch.support].every(Number.isFinite)) return unavailable()

  const strengths = emptyStrengthMap()
  const triggered = emptyBooleanMap()
  const neutral = emptyBooleanMap()
  for (const action of ACTIONS) {
    const delta = actionAxis(action) === 'x' ? yaw : pitch
    const direction = profile.directions[action]
    const projected = direction === 0 ? 0 : delta.primary * direction
    strengths[action] = projected
    triggered[action] = direction !== 0
      && supportAgrees(delta.primary, delta.support)
      && projected >= profile.thresholds[action]
    neutral[action] = Math.abs(delta.primary) <= profile.thresholds[action] * NEUTRAL_THRESHOLD_RATIO
  }
  return {
    trackable: true,
    confidence: result.metrics.confidence,
    strengths,
    triggered,
    neutral,
  }
}
