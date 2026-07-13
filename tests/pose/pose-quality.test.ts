import { describe, expect, it } from 'vitest'
import { assessLandmarks, hasTrackingPose } from '../../src/pose/pose-quality'
import { poseSample } from '../support/pose-sample'

describe('pose quality', () => {
  it('accepts upper-body tracking when every lower-body point is hidden', () => {
    const sample = poseSample(0, { hidden: Array.from({ length: 16 }, (_, index) => index + 17) })

    expect(hasTrackingPose(sample, 'seated')).toBe(true)
    expect(hasTrackingPose(sample, 'standing')).toBe(false)
  })

  it('reports only the missing required landmarks', () => {
    const result = assessLandmarks(poseSample(0, { hidden: [15, 23] }), [11, 12, 15, 16])

    expect(result).toEqual({ ok: false, missing: [15], confidence: 0 })
  })
})
