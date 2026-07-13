import { describe, expect, it } from 'vitest'
import type { CalibrationSnapshot } from '../../src/motion/calibration-session'
import { getCalibrationInstruction, renderCalibration } from '../../src/ui/calibration-view'

const snapshot = (overrides: Partial<CalibrationSnapshot> = {}): CalibrationSnapshot => ({
  phase: 'action',
  style: 'seated',
  stepIndex: 1,
  totalSteps: 5,
  completedSteps: 1,
  action: 'lean-right',
  holdProgress: 0.6,
  framingIssue: null,
  profile: null,
  ...overrides,
})

describe('calibration view', () => {
  it('renders the current half-body action', () => {
    const root = document.createElement('section')

    renderCalibration(root, snapshot())

    expect(root.querySelector('.calibration-screen')).not.toBeNull()
    expect(root.querySelector('.calibration-shade')).not.toBeNull()
    expect(root.querySelector('.calibration-frame.half-body')).not.toBeNull()
    expect(root.querySelector('.calibration-step')?.textContent).toContain('第 2/5 步')
    expect(root.querySelector('h1, h2')?.textContent).toBe('向右侧身')
    expect(root.querySelector('.calibration-status[role="status"][aria-live="polite"]')).not.toBeNull()
    expect(root.textContent).toContain('自动')
  })

  it('reflects hold progress in the progress fill custom property', () => {
    const root = document.createElement('section')

    renderCalibration(root, snapshot({ holdProgress: 0.6 }))

    expect(root.querySelector('.calibration-progress > i')).not.toBeNull()
    expect((root.querySelector('.calibration-progress > i') as HTMLElement).style.getPropertyValue('--calibration-progress')).toBe('60%')
  })

  it('renders a full-body frame with actionable lower-body guidance', () => {
    const root = document.createElement('section')
    const value = snapshot({ style: 'standing', phase: 'framing', action: null, framingIssue: 'lower-body-not-visible' })

    renderCalibration(root, value)

    expect(root.querySelector('.calibration-frame.full-body')).not.toBeNull()
    expect(getCalibrationInstruction(value)).toBe('请稍微后退，让髋部和膝盖进入框内')
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
    expect(root.textContent).not.toContain('✓')
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
