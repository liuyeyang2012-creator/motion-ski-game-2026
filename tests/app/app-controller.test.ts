import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalibrationPhase, CalibrationSnapshot } from '../../src/motion/calibration-session'
import type { LifecycleEvent } from '../../src/platform/lifecycle'

const dependencies = vi.hoisted(() => ({
  camera: {
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  },
  cameraInstances: [] as Array<{
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
  }>,
  createPoseClient: vi.fn(),
}))

vi.mock('../../src/camera/camera-controller', () => ({
  CameraController: class {
    start = vi.fn((...args: unknown[]) => dependencies.camera.start(...args))
    stop = vi.fn((...args: unknown[]) => dependencies.camera.stop(...args))
    pause = vi.fn((...args: unknown[]) => dependencies.camera.pause(...args))
    resume = vi.fn((...args: unknown[]) => dependencies.camera.resume(...args))

    constructor() { dependencies.cameraInstances.push(this) }
  },
}))

vi.mock('../../src/pose/direct-pose-client', () => ({
  createDirectPoseClient: dependencies.createPoseClient,
}))

vi.mock('../../src/render/ski-renderer', () => ({
  SkiRenderer: class {
    resize = vi.fn()
    recordFrameDuration = vi.fn()
    render = vi.fn()
  },
}))

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

function startCalibration(): { controller: AppController; root: HTMLElement } {
  document.body.innerHTML = '<video id="camera-preview"></video><canvas id="game-canvas"></canvas><section id="screen-layer"></section>'
  const root = document.querySelector<HTMLElement>('#screen-layer')!
  const controller = new AppController({ root, storage: localStorage })
  controller.start()
  ;(root.querySelector('[data-testid="start"]') as HTMLButtonElement).click()
  ;(root.querySelector('form') as HTMLFormElement).requestSubmit()
  return { controller, root }
}

function interruptPregame(controller: AppController): void {
  ;(controller as unknown as { onLifecycle(event: LifecycleEvent): void }).onLifecycle('landscape')
}

function setPortrait(controller: AppController): void {
  ;(controller as unknown as { onLifecycle(event: LifecycleEvent): void }).onLifecycle('portrait')
}

beforeEach(() => {
  dependencies.cameraInstances.length = 0
  dependencies.camera.start.mockReset().mockResolvedValue({} as MediaStream)
  dependencies.camera.stop.mockReset()
  dependencies.camera.pause.mockReset()
  dependencies.camera.resume.mockReset().mockResolvedValue(undefined)
  dependencies.createPoseClient.mockReset()
  document.body.className = ''
})

afterEach(() => { vi.restoreAllMocks() })

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

describe('calibration async lifecycle', () => {
  it.each(['resolve', 'reject'] as const)('keeps attempt two active when attempt one settles late via %s', async settlement => {
    const attemptOne = deferred<MediaStream>()
    const attemptTwoPose = deferred<{ detect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>()
    dependencies.camera.start
      .mockReturnValueOnce(attemptOne.promise)
      .mockResolvedValueOnce({} as MediaStream)
    dependencies.createPoseClient.mockReturnValueOnce(attemptTwoPose.promise)
    const { controller, root } = startCalibration()
    const firstCamera = dependencies.cameraInstances.find(camera => camera.start.mock.calls.length === 1)!

    interruptPregame(controller)
    setPortrait(controller)
    ;(root.querySelector('form') as HTMLFormElement).requestSubmit()
    await vi.waitFor(() => expect(dependencies.createPoseClient).toHaveBeenCalledOnce())
    const secondCamera = dependencies.cameraInstances.find(camera => camera !== firstCamera && camera.start.mock.calls.length === 1)
    const secondStopsBeforeSettlement = secondCamera?.stop.mock.calls.length
    const firstStopsBeforeSettlement = firstCamera.stop.mock.calls.length
    const activeView = root.innerHTML

    if (settlement === 'resolve') attemptOne.resolve({} as MediaStream)
    else attemptOne.reject(new Error('attempt one failed late'))
    await vi.waitFor(() => expect(firstCamera.stop).toHaveBeenCalledTimes(firstStopsBeforeSettlement + 1))

    expect(secondCamera).toBeDefined()
    expect(secondCamera?.stop).toHaveBeenCalledTimes(secondStopsBeforeSettlement ?? 0)
    expect(document.body.classList.contains('calibrating')).toBe(true)
    expect(root.innerHTML).toBe(activeView)
    expect(root.querySelector('.game-hint')).toBeNull()
    expect(dependencies.createPoseClient).toHaveBeenCalledOnce()
  })

  it('stops a camera that starts after pregame interruption without creating pose capture', async () => {
    const pendingCamera = deferred<MediaStream>()
    dependencies.camera.start.mockReturnValueOnce(pendingCamera.promise)
    const { controller, root } = startCalibration()
    interruptPregame(controller)
    const interruptedView = root.innerHTML
    const stopsBeforeSettlement = dependencies.camera.stop.mock.calls.length

    pendingCamera.resolve({} as MediaStream)
    await vi.waitFor(() => expect(dependencies.camera.stop).toHaveBeenCalledTimes(stopsBeforeSettlement + 1))

    expect(root.innerHTML).toBe(interruptedView)
    expect(dependencies.createPoseClient).not.toHaveBeenCalled()
    expect(root.querySelector('.game-hint')).toBeNull()
  })

  it('ignores a camera failure that settles after pregame interruption', async () => {
    const pendingCamera = deferred<MediaStream>()
    dependencies.camera.start.mockReturnValueOnce(pendingCamera.promise)
    const { controller, root } = startCalibration()
    interruptPregame(controller)
    const interruptedView = root.innerHTML
    const stopsBeforeSettlement = dependencies.camera.stop.mock.calls.length

    pendingCamera.reject(new DOMException('denied', 'NotAllowedError'))
    await vi.waitFor(() => expect(dependencies.camera.stop).toHaveBeenCalledTimes(stopsBeforeSettlement + 1))

    expect(root.innerHTML).toBe(interruptedView)
    expect(dependencies.createPoseClient).not.toHaveBeenCalled()
    expect(document.body.classList.contains('calibrating')).toBe(false)
  })

  it('disposes a pose client that resolves after pregame interruption without scheduling capture', async () => {
    const pendingPoseClient = deferred<{ detect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>()
    const client = { detect: vi.fn(), dispose: vi.fn() }
    dependencies.createPoseClient.mockReturnValueOnce(pendingPoseClient.promise)
    const animationFrame = vi.spyOn(globalThis, 'requestAnimationFrame')
    const { controller, root } = startCalibration()
    await vi.waitFor(() => expect(dependencies.createPoseClient).toHaveBeenCalledOnce())
    interruptPregame(controller)
    const interruptedView = root.innerHTML

    pendingPoseClient.resolve(client)
    await vi.waitFor(() => expect(client.dispose).toHaveBeenCalledOnce())

    expect(root.innerHTML).toBe(interruptedView)
    expect(animationFrame).not.toHaveBeenCalled()
    expect(document.body.classList.contains('calibrating')).toBe(false)
  })

  it('ignores a pose client failure that settles after pregame interruption', async () => {
    const pendingPoseClient = deferred<never>()
    dependencies.createPoseClient.mockReturnValueOnce(pendingPoseClient.promise)
    const animationFrame = vi.spyOn(globalThis, 'requestAnimationFrame')
    const { controller, root } = startCalibration()
    await vi.waitFor(() => expect(dependencies.createPoseClient).toHaveBeenCalledOnce())
    interruptPregame(controller)
    const interruptedView = root.innerHTML

    pendingPoseClient.reject(new Error('initialization failed'))
    await Promise.resolve()
    await Promise.resolve()

    expect(root.innerHTML).toBe(interruptedView)
    expect(animationFrame).not.toHaveBeenCalled()
    expect(document.body.classList.contains('calibrating')).toBe(false)
  })
})

describe('camera errors', () => {
  it('explains that LAN HTTP cannot use a phone camera', () => {
    expect(getCameraErrorCopy(new TypeError('mediaDevices missing'), false).title).toBe('手机摄像头需要 HTTPS')
  })
})
