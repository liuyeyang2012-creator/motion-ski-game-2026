import { describe, expect, it, vi } from 'vitest'
import { renderResults, renderResume, renderSetup, renderWelcome } from '../../src/ui/screens'

describe('game screens', () => {
  it('renders privacy-first welcome and start action', () => {
    const root = document.createElement('section')
    renderWelcome(root, vi.fn())
    expect(root.textContent).toContain('体感滑雪')
    expect(root.textContent).toContain('转动头部、活动身体')
    expect(root.textContent).toContain('不上传、不保存')
    expect(root.querySelector('button')?.textContent).toContain('开始滑雪')
  })

  it('renders both play styles and all session lengths', () => {
    const root = document.createElement('section')
    renderSetup(root, { playStyle: 'seated', sessionKind: 'quick' }, vi.fn())
    expect(root.querySelectorAll('input[name="playStyle"]')).toHaveLength(2)
    expect(root.querySelectorAll('input[name="sessionKind"]')).toHaveLength(3)
    expect(root.textContent).toContain('转头变道 · 抬头跳跃 · 低头躲避')
    expect(root.textContent).toContain('侧身 · 低头 · 抬手 · 安全下蹲')
  })

  it('renders seated head-control activity counts', () => {
    const root = document.createElement('section')
    renderResults(root, {
      playStyle: 'seated',
      score: 900,
      distance: 320,
      bestCombo: 7,
      collisions: 1,
      activeMs: 30_000,
      motionCounts: { 'turn-left': 2, 'turn-right': 1, 'head-up': 2, 'head-down': 1 },
    }, vi.fn())
    expect(root.textContent).toContain('900')
    expect(root.textContent).toContain('本次身体活动')
    expect(root.textContent).toContain('转头变道 3 次')
    expect(root.textContent).toContain('跳跃 2 次')
    expect(root.textContent).toContain('俯身 1 次')
  })

  it('retains standing full-body activity counts', () => {
    const root = document.createElement('section')
    renderResults(root, {
      playStyle: 'standing',
      score: 900,
      distance: 320,
      bestCombo: 7,
      collisions: 1,
      activeMs: 30_000,
      motionCounts: { 'lean-left': 2, 'lean-right': 1, duck: 2, 'hands-up': 1, squat: 1 },
    }, vi.fn())
    expect(root.textContent).toContain('侧身 3 次')
    expect(root.textContent).toContain('低头 2 次')
    expect(root.textContent).toContain('抬手 1 次')
    expect(root.textContent).toContain('下蹲 1 次')
  })

  it('offers an explicit position-confirm action after a pause', () => {
    const root = document.createElement('section')
    renderResume(root, '重新进入画面', vi.fn())
    expect(root.querySelector('button')?.textContent).toContain('位置已调整好')
  })
})
