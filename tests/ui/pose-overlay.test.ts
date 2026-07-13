import { describe, expect, it } from 'vitest'
import { projectPosePoint, renderPoseOverlay } from '../../src/ui/pose-overlay'
import { poseSample } from '../support/pose-sample'

describe('pose overlay', () => {
  it('mirrors MediaPipe x coordinates to match the front camera', () => {
    expect(projectPosePoint({ x: 0.2, y: 0.3, z: 0, visibility: 1 })).toEqual({ x: 80, y: 30 })
  })

  it('colors required stable points green and missing required points yellow', () => {
    const sample = poseSample(0, { hidden: [15] })
    const svg = renderPoseOverlay(sample.landmarks, [11, 12, 15, 16])

    expect(svg.querySelector('[data-landmark="11"]')?.classList.contains('stable')).toBe(true)
    expect(svg.querySelector('[data-landmark="15"]')?.classList.contains('missing')).toBe(true)
  })
})
