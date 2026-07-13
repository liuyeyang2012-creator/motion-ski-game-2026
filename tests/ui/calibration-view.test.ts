import { describe, expect, it, vi } from 'vitest'
import type { CalibrationSnapshot } from '../../src/motion/calibration-session'
import { getCalibrationInstruction, renderCalibration } from '../../src/ui/calibration-view'

const snapshot = (overrides: Partial<CalibrationSnapshot> = {}): CalibrationSnapshot => ({
  phase: 'action',
  style: 'seated',
  stepIndex: 1,
  totalSteps: 5,
  completedSteps: 1,
  completedActions: ['lean-left'],
  action: 'lean-right',
  holdProgress: 0.6,
  framingIssue: null,
  feedback: 'move-right',
  requiredIndices: [11, 12],
  latestLandmarks: [],
  canRecover: false,
  profile: null,
  ...overrides,
})

describe('calibration view', () => {
  const actions = {
    onRetryModel: vi.fn(),
    onRetryBody: vi.fn(),
    onRetryAction: vi.fn(),
    onUseRecommended: vi.fn(),
  }

  it('shows model and body self-check stages before action calibration', () => {
    const root = document.createElement('section')

    renderCalibration(root, snapshot({ phase: 'model-check', action: null }), actions)
    expect(root.textContent).toContain('识别组件加载中')

    renderCalibration(root, snapshot({ phase: 'body-check', action: null, feedback: 'body-not-found' }), actions)
    expect(root.textContent).toContain('人体识别 2/3')
    expect(root.textContent).toContain('请站到高亮框内')
  })

  it('offers retry and recommended sensitivity after timeout', () => {
    const root = document.createElement('section')
    renderCalibration(root, snapshot({ canRecover: true }), actions)

    ;(root.querySelector('[data-action="use-recommended"]') as HTMLButtonElement).click()

    expect(actions.onUseRecommended).toHaveBeenCalledOnce()
  })

  it('renders the current half-body action', () => {
    const root = document.createElement('section')

    renderCalibration(root, snapshot())

    expect(root.querySelector('.calibration-screen')).not.toBeNull()
    expect(root.querySelector('.calibration-shade')).not.toBeNull()
    expect(root.querySelector('.calibration-frame.half-body')).not.toBeNull()
    expect(root.querySelector('.calibration-stage')?.textContent).toContain('动作校准 2/5')
    expect(root.querySelector('h1, h2')?.textContent).toBe('向右侧身')
    expect(root.querySelector('.calibration-status[role="status"][aria-live="polite"]')).not.toBeNull()
    expect(root.textContent).toContain('短暂识别不稳不会清零')
  })

  it('reflects hold progress in the progress fill custom property', () => {
    const root = document.createElement('section')

    renderCalibration(root, snapshot({ holdProgress: 0.6 }))

    expect(root.querySelector('.calibration-progress > i')).not.toBeNull()
    expect((root.querySelector('.calibration-progress > i') as HTMLElement).style.getPropertyValue('--calibration-progress')).toBe('60%')
  })

  it('renders a full-body frame with actionable lower-body guidance', () => {
    const root = document.createElement('section')
    const value = snapshot({ style: 'standing', phase: 'body-check', action: null, framingIssue: 'lower-body-not-visible', feedback: 'hips-missing' })

    renderCalibration(root, value)

    expect(root.querySelector('.calibration-frame.full-body')).not.toBeNull()
    expect(getCalibrationInstruction(value)).toBe('请调整手机，让髋部进入画面')
    expect(root.textContent).toContain(getCalibrationInstruction(value))
  })

  it('shows success treatment only during step success and retains completed progress', () => {
    const root = document.createElement('section')

    renderCalibration(root, snapshot({ phase: 'step-success', completedSteps: 2, holdProgress: 0 }))

    expect(root.querySelector('.calibration-screen.success')).not.toBeNull()
    expect(root.textContent).toContain('✓')
    expect(root.textContent).toContain('校准成功')
    expect((root.querySelector('.calibration-progress > i') as HTMLElement).style.getPropertyValue('--calibration-progress')).toBe('100%')

    renderCalibration(root, snapshot())
    expect(root.querySelector('.calibration-screen.success')).toBeNull()
    expect(root.querySelector('.calibration-check')).toBeNull()
    expect(root.textContent).not.toContain('校准成功')
  })

  it('keeps the success instruction when framing is lost during step success', () => {
    const value = snapshot({ phase: 'step-success', completedSteps: 2, holdProgress: 0, framingIssue: 'pose-lost' })
    const root = document.createElement('section')

    renderCalibration(root, value)

    expect(getCalibrationInstruction(value)).toBe('校准成功')
    expect(root.querySelector('.calibration-instruction')?.textContent).toBe('校准成功')
    expect(root.textContent).not.toContain('请回到高亮框中央')
  })
})
