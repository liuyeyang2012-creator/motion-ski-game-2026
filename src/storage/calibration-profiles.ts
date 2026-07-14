import type { PlayStyle } from '../app/types'
import type { CalibrationProfile } from '../motion/calibration'
import type { HeadControlProfile, HeadMotionAction, HeadPoseMetrics } from '../motion/head-control'

const STORAGE_KEY = 'motion-ski.calibration.v1'
type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>
export type CalibrationProfiles = Partial<Record<PlayStyle, CalibrationProfile>>

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFinite(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

const HEAD_ACTIONS: readonly HeadMotionAction[] = ['turn-left', 'turn-right', 'look-up', 'look-down']
const NEUTRAL_METRICS: readonly (keyof HeadPoseMetrics)[] = [
  'shoulderWidth',
  'shoulderCenterX',
  'shoulderCenterY',
  'noseOffsetX',
  'noseOffsetY',
  'supportOffsetX',
  'supportOffsetY',
  'confidence',
]

function parseHeadControl(value: unknown): HeadControlProfile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!record.neutral || typeof record.neutral !== 'object'
    || !record.thresholds || typeof record.thresholds !== 'object'
    || !record.directions || typeof record.directions !== 'object') return null
  const neutral = record.neutral as Record<string, unknown>
  const thresholds = record.thresholds as Record<string, unknown>
  const directions = record.directions as Record<string, unknown>
  if (NEUTRAL_METRICS.some(metric => !isFiniteNumber(neutral[metric]))
    || (neutral.shoulderWidth as number) <= 0
    || HEAD_ACTIONS.some(action => !isFiniteNumber(thresholds[action]))
    || HEAD_ACTIONS.some(action => directions[action] !== -1
      && directions[action] !== 0
      && directions[action] !== 1)) return null
  return {
    neutral: Object.fromEntries(NEUTRAL_METRICS.map(metric => [metric, neutral[metric]])) as unknown as HeadPoseMetrics,
    thresholds: Object.fromEntries(HEAD_ACTIONS.map(action => [action, thresholds[action]])) as Record<HeadMotionAction, number>,
    directions: Object.fromEntries(HEAD_ACTIONS.map(action => [action, directions[action]])) as Record<HeadMotionAction, -1 | 0 | 1>,
  }
}

function parseProfile(value: unknown, style: PlayStyle): CalibrationProfile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isFiniteNumber(record.shoulderWidth) || record.shoulderWidth <= 0
    || !isFiniteNumber(record.torsoCenterX)
    || !isFiniteNumber(record.headY)
    || !isFiniteNumber(record.wristY)
    || !isNullableFinite(record.hipY)
    || !isNullableFinite(record.kneeY)) return null
  const headControl = parseHeadControl(record.headControl)
  if (style === 'seated' && !headControl) return null
  if (record.headControl !== undefined && record.headControl !== null && !headControl) return null
  return {
    shoulderWidth: record.shoulderWidth,
    torsoCenterX: record.torsoCenterX,
    headY: record.headY,
    wristY: record.wristY,
    hipY: record.hipY,
    kneeY: record.kneeY,
    headControl,
  }
}

export function loadCalibrationProfiles(storage: Pick<RecordStorage, 'getItem'>): CalibrationProfiles {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || typeof value !== 'object') return {}
    const seated = parseProfile(value.seated, 'seated')
    const standing = parseProfile(value.standing, 'standing')
    return { ...(seated ? { seated } : {}), ...(standing ? { standing } : {}) }
  } catch {
    return {}
  }
}

export function saveCalibrationProfile(
  storage: RecordStorage,
  style: PlayStyle,
  profile: CalibrationProfile,
): void {
  const profiles = loadCalibrationProfiles(storage)
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ ...profiles, [style]: profile })) } catch { /* Calibration remains usable in memory. */ }
}
