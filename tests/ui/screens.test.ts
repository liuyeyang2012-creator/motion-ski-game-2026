import { describe, expect, it, vi } from 'vitest'
import { renderResults, renderSetup, renderWelcome } from '../../src/ui/screens'

describe('game screens', () => {
  it('renders privacy-first welcome and start action', () => {
    const root = document.createElement('section')
    renderWelcome(root, vi.fn())
    expect(root.textContent).toContain('体感滑雪')
    expect(root.textContent).toContain('不上传、不保存')
    expect(root.querySelector('button')?.textContent).toContain('开始滑雪')
  })

  it('renders both play styles and all session lengths', () => {
    const root = document.createElement('section')
    renderSetup(root, { playStyle: 'seated', sessionKind: 'quick' }, vi.fn())
    expect(root.querySelectorAll('input[name="playStyle"]')).toHaveLength(2)
    expect(root.querySelectorAll('input[name="sessionKind"]')).toHaveLength(3)
  })

  it('renders game and activity results together', () => {
    const root = document.createElement('section')
    renderResults(root, { score: 900, distance: 320, bestCombo: 7, collisions: 1, activeMs: 30_000, motionCounts: { 'lean-left': 3, duck: 2 } }, vi.fn())
    expect(root.textContent).toContain('900')
    expect(root.textContent).toContain('本次身体活动')
    expect(root.textContent).toContain('侧身 3 次')
  })
})
