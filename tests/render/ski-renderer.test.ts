import { describe, expect, it, vi } from 'vitest'
import {
  getObstacleVisual,
  getPlayerTransform,
  projectObstacle,
  shouldDrawHeadControlSkier,
  SkiRenderer,
} from '../../src/render/ski-renderer'
import { createGame } from '../../src/game/game-engine'

describe('ski renderer', () => {
  it('maps head-control motions to their distinct obstacle visuals', () => {
    expect(getObstacleVisual('turn-left')).toBe('lane')
    expect(getObstacleVisual('turn-right')).toBe('lane')
    expect(getObstacleVisual('head-up')).toBe('jump')
    expect(getObstacleVisual('head-down')).toBe('duck')
  })

  it('moves the seated skier for jump and duck feedback', () => {
    const neutral = getPlayerTransform({ action: 'neutral', lane: 0, width: 390, height: 844 })
    const jump = getPlayerTransform({ action: 'jump', lane: 0, width: 390, height: 844 })
    const duck = getPlayerTransform({ action: 'duck', lane: 0, width: 390, height: 844 })

    expect(jump.y).toBeLessThan(neutral.y)
    expect(duck.scaleY).toBeLessThan(1)
  })

  it('adds the head-control skier only for seated play', () => {
    expect(shouldDrawHeadControlSkier('seated')).toBe(true)
    expect(shouldDrawHeadControlSkier('standing')).toBe(false)
  })

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

  it('degrades visual quality when the rolling frame budget is exceeded', () => {
    const canvas = { width: 390, height: 844, getContext: () => ({ clearRect() {}, createLinearGradient: () => ({ addColorStop() {} }) }) } as unknown as HTMLCanvasElement
    const renderer = new SkiRenderer(canvas)
    for (let index = 0; index < 120; index++) renderer.recordFrameDuration(30)
    expect(renderer.getQuality()).toBe('medium')
    for (let index = 0; index < 120; index++) renderer.recordFrameDuration(30)
    expect(renderer.getQuality()).toBe('low')
  })

  it('keeps logical viewport dimensions after DPR resize', () => {
    const context = { setTransform() {} } as unknown as CanvasRenderingContext2D
    const canvas = { width: 390, height: 844, getContext: () => context } as unknown as HTMLCanvasElement
    const renderer = new SkiRenderer(canvas)
    renderer.resize(390, 844, 2)
    expect(renderer.getViewport()).toEqual({ width: 390, height: 844 })
    expect(canvas.width).toBe(780)
  })
})
