import { describe, expect, it, vi } from 'vitest'
import { projectObstacle, SkiRenderer } from '../../src/render/ski-renderer'
import { createGame } from '../../src/game/game-engine'

describe('ski renderer', () => {
  it('projects near obstacles larger than distant obstacles', () => {
    expect(projectObstacle(0, 0.9, 390, 844).scale).toBeGreaterThan(projectObstacle(0, 0.2, 390, 844).scale)
  })

  it('draws the course before obstacles and removes decoration at low quality', () => {
    const calls: string[] = []
    const context = {
      clearRect: vi.fn(() => calls.push('clear')),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(() => calls.push('background')),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
      fill: vi.fn(() => calls.push('shape')), stroke: vi.fn(), arc: vi.fn(),
      save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      fillText: vi.fn(), setTransform: vi.fn(),
      shadowBlur: 0, shadowColor: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
      font: '', textAlign: '', globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D
    const canvas = { width: 390, height: 844, getContext: () => context } as unknown as HTMLCanvasElement
    const renderer = new SkiRenderer(canvas)
    renderer.setQuality('low')
    renderer.render(createGame({ playStyle: 'seated', sessionKind: 'quick', seed: 1 }))

    expect(calls[0]).toBe('clear')
    expect(calls).toContain('background')
    expect(context.shadowBlur).toBe(0)
  })
})
