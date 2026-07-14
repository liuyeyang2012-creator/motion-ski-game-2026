import { describe, expect, it, vi } from 'vitest'
import type { CalibrationSnapshot } from '../../src/motion/calibration-session'
import { getCalibrationInstruction, renderCalibration } from '../../src/ui/calibration-view'

const snapshot = (overrides: Partial<CalibrationSnapshot> = {}): CalibrationSnapshot => ({
  phase: 'action',
  modelMode: 'standard',
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

  it.each([
    ['model-check', 'standard', '识别组件加载中', '首次加载可能需要一些时间'],
    ['model-error', 'standard', '普通模式未能启动', '兼容模式重试'],
    ['model-check', 'compatibility', '兼容模式加载中', '请保持竖屏'],
    ['model-error', 'compatibility', '兼容模式未能启动', '再次尝试兼容模式'],
  ] as const)('renders %s copy for %s mode', (phase, modelMode, title, detail) => {
    const root = document.createElement('section')

    renderCalibration(root, snapshot({ phase, modelMode, action: null }), actions)

    expect(root.textContent).toContain(title)
    expect(root.textContent).toContain(detail)
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

  it.each([
    ['face-neutral', '正脸'],
    ['turn-left', '向左转头'],
    ['turn-right', '向右转头'],
    ['look-up', '抬头'],
    ['look-down', '低头'],
  ] as const)('renders the %s instruction', (action, instruction) => {
    expect(getCalibrationInstruction(snapshot({ action, completedActions: [] }))).toBe(instruction)
  })

  it.each([
    ['move-closer', '请靠近手机一些'],
    ['move-back', '请离手机远一些'],
    ['center-head', '请将头部移到引导框中央'],
    ['shoulders-moving', '请只转头，双肩保持不动'],
    ['turn-left-more', '请再向左转一点'],
    ['turn-right-more', '请再向右转一点'],
    ['look-up-more', '请再抬头一点'],
    ['look-down-more', '请再低头一点'],
  ] as const)('renders the %s correction', (feedback, correction) => {
    const root = document.createElement('section')

    renderCalibration(root, snapshot({ action: 'turn-left', feedback, completedActions: [] }))

    expect(root.querySelector('.calibration-feedback')?.textContent).toBe(correction)
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
