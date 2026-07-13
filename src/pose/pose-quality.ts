import type { PlayStyle } from '../app/types'
import type { PoseSample } from './types'

export const MIN_LANDMARK_VISIBILITY = 0.5

export function landmarkIsUsable(
  sample: PoseSample,
  index: number,
  threshold = MIN_LANDMARK_VISIBILITY,
): boolean {
  const point = sample.landmarks[index]
  return Boolean(point)
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.visibility)
    && point.visibility >= threshold
}

export function assessLandmarks(
  sample: PoseSample,
  indices: readonly number[],
  threshold = MIN_LANDMARK_VISIBILITY,
): { ok: boolean; missing: number[]; confidence: number } {
  const missing = indices.filter(index => !landmarkIsUsable(sample, index, threshold))
  const confidence = indices.length > 0 && missing.length === 0
    ? Math.min(...indices.map(index => sample.landmarks[index].visibility))
    : 0
  return { ok: missing.length === 0, missing, confidence }
}

export function hasTrackingPose(sample: PoseSample, style: PlayStyle): boolean {
  const required = style === 'standing' ? [0, 11, 12, 23, 24] : [0, 11, 12]
  return assessLandmarks(sample, required).ok
}
