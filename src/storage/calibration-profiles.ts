import type { PlayStyle } from '../app/types'
import type { CalibrationProfile } from '../motion/calibration'

const STORAGE_KEY = 'motion-ski.calibration.v1'
type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>
export type CalibrationProfiles = Partial<Record<PlayStyle, CalibrationProfile>>

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFinite(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function parseProfile(value: unknown): CalibrationProfile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isFiniteNumber(record.shoulderWidth) || record.shoulderWidth <= 0
    || !isFiniteNumber(record.torsoCenterX)
    || !isFiniteNumber(record.headY)
    || !isFiniteNumber(record.wristY)
    || !isNullableFinite(record.hipY)
    || !isNullableFinite(record.kneeY)) return null
  return {
    shoulderWidth: record.shoulderWidth,
    torsoCenterX: record.torsoCenterX,
    headY: record.headY,
    wristY: record.wristY,
    hipY: record.hipY,
    kneeY: record.kneeY,
  }
}

export function loadCalibrationProfiles(storage: Pick<RecordStorage, 'getItem'>): CalibrationProfiles {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || typeof value !== 'object') return {}
    const seated = parseProfile(value.seated)
    const standing = parseProfile(value.standing)
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
