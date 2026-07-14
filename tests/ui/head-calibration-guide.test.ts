import { describe, expect, it } from 'vitest'
import { renderHeadCalibrationGuide } from '../../src/ui/head-calibration-guide'

describe('head calibration guide', () => {
  it('renders a human outline with exactly five weak markers', () => {
    const guide = renderHeadCalibrationGuide({ headRecognized: true, shouldersRecognized: true })
    expect(guide.classList.contains('head-calibration-guide')).toBe(true)
    expect(guide.querySelector('[data-outline="human-head-shoulders"]')).not.toBeNull()
    expect(guide.querySelectorAll('[data-guide-point]')).toHaveLength(5)
    expect(guide.querySelectorAll('circle')).toHaveLength(5)
    expect([...guide.querySelectorAll('[data-guide-point]')].map(node => node.getAttribute('data-guide-point'))).toEqual([
      'head-top', 'left-cheek', 'right-cheek', 'left-shoulder', 'right-shoulder',
    ])
  })

  it('draws a closed face and a neck flowing into naturally sloped shoulders', () => {
    const guide = renderHeadCalibrationGuide({ headRecognized: false, shouldersRecognized: false })
    const headPath = guide.querySelector('.head-guide-outline.head')?.getAttribute('d') ?? ''
    const shoulderPath = guide.querySelector('.head-guide-outline.shoulders')?.getAttribute('d') ?? ''

    expect(guide.getAttribute('viewBox')).toBe('0 0 300 360')
    expect(headPath.trim().endsWith('Z')).toBe(true)
    expect(headPath).toContain('150 187')
    expect(headPath).toContain('86 123')
    expect(headPath).toContain('214 123')
    expect(shoulderPath).toContain('M 123 176')
    expect(shoulderPath).toContain('123 223')
    expect(shoulderPath).toContain('M 177 176')
    expect(shoulderPath).toContain('177 223')
    expect(shoulderPath).toContain('15 318')
    expect(shoulderPath).toContain('285 318')
    expect((285 - 15) / (214 - 86)).toBeGreaterThanOrEqual(1.8)
    expect((285 - 15) / (214 - 86)).toBeLessThanOrEqual(2.2)
    expect([...guide.querySelectorAll('.head-guide-point')].map(point => point.getAttribute('r')))
      .toEqual(['7', '7', '7', '7', '7'])
  })

  it('recognizes head and shoulder regions independently', () => {
    const headOnly = renderHeadCalibrationGuide({ headRecognized: true, shouldersRecognized: false })

    expect(headOnly.querySelector('.head-guide-outline.head')?.classList.contains('recognized')).toBe(true)
    expect(headOnly.querySelector('.head-guide-outline.shoulders')?.classList.contains('recognized')).toBe(false)
    expect(headOnly.querySelectorAll('.head-guide-point.recognized')).toHaveLength(3)

    const shouldersOnly = renderHeadCalibrationGuide({ headRecognized: false, shouldersRecognized: true })
    expect(shouldersOnly.querySelector('.head-guide-outline.head')?.classList.contains('recognized')).toBe(false)
    expect(shouldersOnly.querySelector('.head-guide-outline.shoulders')?.classList.contains('recognized')).toBe(true)
    expect(shouldersOnly.querySelectorAll('.head-guide-point.recognized')).toHaveLength(2)
  })
})
