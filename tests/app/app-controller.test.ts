import { describe, expect, it } from 'vitest'
import type { CalibrationPhase, CalibrationSnapshot } from '../../src/motion/calibration-session'
import { AppController, getCameraErrorCopy, shouldCapturePose, shouldVibrate } from '../../src/app/app-controller'

function calibrationSnapshot(phase: CalibrationPhase): CalibrationSnapshot {
  return {
    phase,
    style: 'seated',
    stepIndex: 0,
    totalSteps: 5,
    completedSteps: phase === 'step-success' ? 1 : 0,
    action: phase === 'action' || phase === 'step-success' ? 'lean-left' : null,
    holdProgress: 0,
    framingIssue: null,
    profile: null,
  }
}

describe('AppController', () => {
  it('moves from welcome to setup and preserves local defaults', () => {
    const root = document.createElement('section')
    const controller = new AppController({ root, storage: localStorage })
    controller.start()
    ;(root.querySelector('[data-testid="start"]') as HTMLButtonElement).click()
    expect(root.textContent).toContain('选择体感方式')
    expect((root.querySelector('input[value="seated"]') as HTMLInputElement).checked).toBe(true)
  })
})

describe('pose capture lifecycle', () => {
  it('continues inference while the game is playing after calibration', () => {
    expect(shouldCapturePose(false, 'playing')).toBe(true)
    expect(shouldCapturePose(false, 'finished')).toBe(false)
  })
})

describe('calibration haptics', () => {
  it('vibrates only when entering step success', () => {
    expect(shouldVibrate(calibrationSnapshot('action'), calibrationSnapshot('step-success'))).toBe(true)
    expect(shouldVibrate(calibrationSnapshot('step-success'), calibrationSnapshot('step-success'))).toBe(false)
    expect(shouldVibrate(calibrationSnapshot('framing'), calibrationSnapshot('action'))).toBe(false)
    expect(shouldVibrate(calibrationSnapshot('action'), calibrationSnapshot('framing'))).toBe(false)
    expect(shouldVibrate(calibrationSnapshot('step-success'), calibrationSnapshot('action'))).toBe(false)
  })
})

describe('camera errors', () => {
  it('explains that LAN HTTP cannot use a phone camera', () => {
    expect(getCameraErrorCopy(new TypeError('mediaDevices missing'), false).title).toBe('手机摄像头需要 HTTPS')
  })
})
