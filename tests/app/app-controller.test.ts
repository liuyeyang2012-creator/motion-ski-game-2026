import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalibrationSession, type CalibrationPhase, type CalibrationSnapshot } from '../../src/motion/calibration-session'
import type { LifecycleEvent } from '../../src/platform/lifecycle'
import { poseSample } from '../support/pose-sample'

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
    private stream: MediaStream | null = null
    start = vi.fn(async (video: HTMLVideoElement) => {
      const stream = await dependencies.camera.start(video)
      this.stream = stream
      if (!Object.prototype.hasOwnProperty.call(video, 'srcObject')) {
        Object.defineProperty(video, 'srcObject', { configurable: true, writable: true, value: null })
      }
      video.srcObject = stream
      await video.play()
      return stream
    })
    stop = vi.fn((video?: HTMLVideoElement) => {
      ;(this.stream as (MediaStream & { getTracks?: () => Array<{ stop(): void }> }) | null)?.getTracks?.().forEach(track => track.stop())
      this.stream = null
      if (video) video.srcObject = null
      dependencies.camera.stop(video)
    })
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

import {
  AppController,
  createFixtureSamples,
  getCameraErrorCopy,
  getGameHint,
  initializePoseClientWithTimeout,
  PoseInitializationTimeoutError,
  shouldCapturePose,
  shouldVibrate,
} from '../../src/app/app-controller'

function calibrationSnapshot(phase: CalibrationPhase): CalibrationSnapshot {
  return {
    phase,
    modelMode: 'standard',
    style: 'seated',
    stepIndex: 0,
    totalSteps: 5,
    completedSteps: phase === 'step-success' ? 1 : 0,
    completedActions: phase === 'step-success' ? ['turn-left'] : [],
    action: phase === 'action' || phase === 'step-success' ? 'turn-left' : null,
    holdProgress: 0,
    framingIssue: null,
    feedback: null,
    requiredIndices: [11, 12],
    latestLandmarks: [],
    headRecognized: false,
    shouldersRecognized: false,
    canRecover: false,
    profile: null,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

function fakeStream(): { stream: MediaStream; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn()
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop }
}

function headMovement(capturedAt: number, dx = 0, dy = 0) {
  const base = poseSample(0)
  return poseSample(capturedAt, {
    changes: Object.fromEntries([0, 2, 5, 7, 8].map(index => [index, {
      x: base.landmarks[index].x + dx,
      y: base.landmarks[index].y + dy,
    }])),
  })
}

function feedHeadAction(session: CalibrationSession, start: number, dx = 0, dy = 0): void {
  for (let time = start; time <= start + 480; time += 80) session.update(headMovement(time, dx, dy))
}

function seatedSessionAtFinalSuccess(): { session: CalibrationSession; successAt: number } {
  const session = new CalibrationSession('seated')
  session.cameraReady(); session.modelReady()
  for (let time = 0; time <= 960; time += 80) session.update(poseSample(time))
  session.tick(1_600)
  feedHeadAction(session, 1_680, 0.04); session.tick(2_800)
  feedHeadAction(session, 2_880, -0.04); session.tick(4_000)
  feedHeadAction(session, 4_080, 0, -0.03); session.tick(5_200)
  feedHeadAction(session, 5_280, 0, 0.03)
  return { session, successAt: 5_680 }
}

function startCalibration(): { controller: AppController; root: HTMLElement } {
  document.body.innerHTML = '<video id="camera-preview"></video><canvas id="game-canvas"></canvas><section id="screen-layer"></section>'
  Object.defineProperty(document.querySelector<HTMLVideoElement>('#camera-preview')!, 'srcObject', {
    configurable: true,
    writable: true,
    value: null,
  })
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
  vi.spyOn(HTMLVideoElement.prototype, 'play').mockResolvedValue(undefined)
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

  it('uses head controls for seated hints and full-body controls for standing hints', () => {
    expect(getGameHint('seated')).toBe('转头变道 · 抬头跳跃 · 低头躲避')
    expect(getGameHint('standing')).toBe('侧身变道 · 低头过门 · 抬手加速')
  })
})

describe('deterministic fixture calibration', () => {
  it('completes seated calibration with a head-control profile', () => {
    const session = new CalibrationSession('seated')
    session.cameraReady(); session.modelReady()

    for (const sample of createFixtureSamples('seated-soft-success', 'seated')) session.update(sample)

    expect(session.snapshot()).toMatchObject({ phase: 'complete', style: 'seated' })
    expect(session.snapshot().profile?.headControl).not.toBeNull()
  })

  it('completes standing calibration with full-body landmarks and no head-control profile', () => {
    const session = new CalibrationSession('standing')
    session.cameraReady(); session.modelReady()

    for (const sample of createFixtureSamples('standing-soft-success', 'standing')) session.update(sample)

    expect(session.snapshot()).toMatchObject({ phase: 'complete', style: 'standing' })
    expect(session.snapshot().profile?.headControl).toBeNull()
    expect(session.snapshot().profile?.hipY).not.toBeNull()
  })

  it('does not let body-only seated evidence recommend a skipped head step', () => {
    const session = new CalibrationSession('seated')
    session.cameraReady(); session.modelReady()

    for (const sample of createFixtureSamples('seated-body-only', 'seated')) session.update(sample)
    expect(session.snapshot()).toMatchObject({ phase: 'action', action: 'turn-left', canRecover: true })

    session.useRecommendedSensitivity()

    expect(session.snapshot()).toMatchObject({ phase: 'action', action: 'turn-left', completedSteps: 1 })
  })
})

describe('pose capture lifecycle', () => {
  it('continues inference while the game is playing after calibration', () => {
    expect(shouldCapturePose(false, 'playing')).toBe(true)
    expect(shouldCapturePose(false, 'finished')).toBe(false)
  })

  it('ticks calibration time and renders only recovery or success state changes without a pose result', async () => {
    const root = document.createElement('section')
    const controller = new AppController({ root, storage: localStorage })
    const harness = controller as unknown as {
      calibrating: boolean
      calibrationSession: CalibrationSession | null
      detector: null
      captureLoop(time: number, video: HTMLVideoElement): Promise<void>
      renderCalibrationSession(session: CalibrationSession): void
    }
    harness.calibrating = true
    harness.detector = null
    const render = vi.spyOn(harness, 'renderCalibrationSession').mockImplementation(() => {})
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1)
    const video = document.createElement('video')

    const neutral = new CalibrationSession('seated')
    neutral.cameraReady(); neutral.modelReady(); neutral.update(poseSample(0))
    harness.calibrationSession = neutral
    const neutralTick = vi.spyOn(neutral, 'tick')

    await harness.captureLoop(5_999, video)
    expect(neutralTick).toHaveBeenLastCalledWith(5_999)
    expect(render).not.toHaveBeenCalled()

    await harness.captureLoop(6_000, video)
    expect(neutral.snapshot().canRecover).toBe(true)
    expect(render).toHaveBeenCalledOnce()

    const success = new CalibrationSession('seated')
    success.cameraReady(); success.modelReady()
    for (let time = 0; time <= 960; time += 80) success.update(poseSample(time))
    harness.calibrationSession = success
    const successTick = vi.spyOn(success, 'tick')
    render.mockClear()

    await harness.captureLoop(1_559, video)
    expect(successTick).toHaveBeenLastCalledWith(1_559)
    expect(success.snapshot()).toMatchObject({ phase: 'step-success', action: 'face-neutral' })
    expect(render).not.toHaveBeenCalled()

    await harness.captureLoop(1_560, video)
    expect(success.snapshot()).toMatchObject({ phase: 'action', action: 'turn-left' })
    expect(render).toHaveBeenCalledOnce()
  })

  it('finishes calibration when the final success advances without another pose result', async () => {
    vi.useFakeTimers()
    try {
      const root = document.createElement('section')
      const storage = { getItem: vi.fn(() => null), setItem: vi.fn() }
      const controller = new AppController({ root, storage })
      const harness = controller as unknown as {
        calibrating: boolean
        calibrationSession: CalibrationSession | null
        detector: unknown | null
        captureLoop(time: number, video: HTMLVideoElement): Promise<void>
        onPose(sample: ReturnType<typeof poseSample>): void
      }
      const { session, successAt } = seatedSessionAtFinalSuccess()
      expect(session.snapshot()).toMatchObject({ phase: 'step-success', action: 'look-down' })
      harness.calibrating = true
      harness.calibrationSession = session
      harness.detector = null
      vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1)
      const video = document.createElement('video')

      await harness.captureLoop(successAt + 599, video)
      expect(harness.detector).toBeNull()

      await harness.captureLoop(successAt + 600, video)
      expect(session.snapshot().phase).toBe('complete')
      expect(harness.detector).not.toBeNull()
      expect((harness.detector as unknown as { profile: { headControl?: unknown } }).profile.headControl).not.toBeNull()
      expect(root.querySelector('.screen.message')).not.toBeNull()
      expect(storage.setItem).toHaveBeenCalledOnce()

      const detector = harness.detector
      harness.onPose(poseSample(successAt + 601))
      expect(harness.detector).toBe(detector)
      expect(storage.setItem).toHaveBeenCalledOnce()
      expect(root.querySelector('.screen.message')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('calibration haptics', () => {
  it('vibrates only when entering step success', () => {
    expect(shouldVibrate(calibrationSnapshot('action'), calibrationSnapshot('step-success'))).toBe(true)
    expect(shouldVibrate(calibrationSnapshot('step-success'), calibrationSnapshot('step-success'))).toBe(false)
    expect(shouldVibrate(calibrationSnapshot('body-check'), calibrationSnapshot('action'))).toBe(false)
    expect(shouldVibrate(calibrationSnapshot('action'), calibrationSnapshot('body-check'))).toBe(false)
    expect(shouldVibrate(calibrationSnapshot('step-success'), calibrationSnapshot('action'))).toBe(false)
  })
})

describe('pose initialization timeout', () => {
  it('times out a pose initialization that never settles', async () => {
    vi.useFakeTimers()
    try {
      const pending = deferred<{ dispose(): void }>()
      const result = initializePoseClientWithTimeout(pending.promise)
      const rejected = expect(result).rejects.toBeInstanceOf(PoseInitializationTimeoutError)

      await vi.advanceTimersByTimeAsync(15_000)

      await rejected
    } finally {
      vi.useRealTimers()
    }
  })

  it('disposes a pose client that resolves after its timeout', async () => {
    vi.useFakeTimers()
    try {
      const pending = deferred<{ dispose(): void }>()
      const client = { dispose: vi.fn() }
      const result = initializePoseClientWithTimeout(pending.promise)
      const rejected = expect(result).rejects.toBeInstanceOf(PoseInitializationTimeoutError)

      await vi.advanceTimersByTimeAsync(15_000)
      await rejected
      pending.resolve(client)
      await Promise.resolve()

      expect(client.dispose).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('calibration async lifecycle', () => {
  it('shows camera, model, then body readiness without entering action early', async () => {
    const pendingPose = deferred<{ detect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>()
    dependencies.createPoseClient.mockReturnValueOnce(pendingPose.promise)
    const { controller, root } = startCalibration()

    await vi.waitFor(() => expect(root.textContent).toContain('识别组件加载中'))
    pendingPose.resolve({ detect: vi.fn(), dispose: vi.fn() })
    await vi.waitFor(() => expect(root.textContent).toContain('请站到高亮框内'))
    interruptPregame(controller)
  })

  it('retries model loading without reopening the camera', async () => {
    const compatibilityPose = deferred<{ detect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>()
    dependencies.createPoseClient
      .mockRejectedValueOnce(new Error('load failed'))
      .mockReturnValueOnce(compatibilityPose.promise)
    const { controller, root } = startCalibration()

    await vi.waitFor(() => expect(root.textContent).toContain('普通模式未能启动'))
    const retry = root.querySelector('[data-action="retry-model"]') as HTMLButtonElement
    retry.click()

    expect(root.textContent).toContain('兼容模式加载中')
    expect(root.querySelector('[data-action="retry-model"]')).toBeNull()
    expect(dependencies.createPoseClient).toHaveBeenCalledTimes(2)
    expect(dependencies.createPoseClient.mock.calls[0]?.[4]).toEqual({ mode: 'standard' })
    expect(dependencies.createPoseClient.mock.calls[1]?.[4]).toEqual({ mode: 'compatibility' })
    expect(dependencies.camera.start).toHaveBeenCalledOnce()
    compatibilityPose.resolve({ detect: vi.fn(), dispose: vi.fn() })
    interruptPregame(controller)
  })

  it('leaves model loading after fifteen seconds when initialization never settles', async () => {
    vi.useFakeTimers()
    try {
      dependencies.createPoseClient.mockReturnValueOnce(deferred<never>().promise)
      const { root } = startCalibration()
      await vi.advanceTimersByTimeAsync(0)
      expect(dependencies.createPoseClient).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(15_000)

      expect(root.textContent).toContain('普通模式未能启动')
      expect(root.querySelector('[data-action="retry-model"]')?.textContent).toBe('兼容模式重试')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['resolve', 'reject'] as const)('keeps attempt two active when attempt one settles late via %s', async settlement => {
    const attemptOnePlay = deferred<void>()
    const attemptOne = fakeStream()
    const attemptTwo = fakeStream()
    const attemptTwoPose = deferred<{ detect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>()
    dependencies.camera.start
      .mockResolvedValueOnce(attemptOne.stream)
      .mockResolvedValueOnce(attemptTwo.stream)
    dependencies.createPoseClient.mockReturnValueOnce(attemptTwoPose.promise)
    const play = vi.mocked(HTMLVideoElement.prototype.play)
    play.mockReturnValueOnce(attemptOnePlay.promise).mockResolvedValue(undefined)
    const { controller, root } = startCalibration()
    await vi.waitFor(() => expect(play).toHaveBeenCalledOnce())
    const firstCamera = dependencies.cameraInstances.find(camera => camera.start.mock.calls.length === 1)!

    interruptPregame(controller)
    setPortrait(controller)
    ;(root.querySelector('form') as HTMLFormElement).requestSubmit()
    await vi.waitFor(() => expect(dependencies.createPoseClient).toHaveBeenCalledOnce())
    const secondCamera = dependencies.cameraInstances.find(camera => camera !== firstCamera && camera.start.mock.calls.length === 1)
    const secondStopsBeforeSettlement = secondCamera?.stop.mock.calls.length
    const firstStopsBeforeSettlement = firstCamera.stop.mock.calls.length
    const activeView = root.innerHTML
    const preview = document.querySelector<HTMLVideoElement>('#camera-preview')!
    expect(preview.srcObject).toBe(attemptTwo.stream)

    if (settlement === 'resolve') attemptOnePlay.resolve()
    else attemptOnePlay.reject(new Error('attempt one failed late'))
    await vi.waitFor(() => expect(firstCamera.stop).toHaveBeenCalledTimes(firstStopsBeforeSettlement + 1))

    expect(secondCamera).toBeDefined()
    expect(secondCamera?.stop).toHaveBeenCalledTimes(secondStopsBeforeSettlement ?? 0)
    expect(preview.srcObject).toBe(attemptTwo.stream)
    expect(attemptOne.stop).toHaveBeenCalledOnce()
    expect(attemptTwo.stop).not.toHaveBeenCalled()
    expect(document.body.classList.contains('calibrating')).toBe(true)
    expect(root.innerHTML).toBe(activeView)
    expect(root.querySelector('.game-hint')).toBeNull()
    expect(dependencies.createPoseClient).toHaveBeenCalledOnce()
  })

  it('attaches the current stream to the real preview and handles preview play failure', async () => {
    const current = fakeStream()
    dependencies.camera.start.mockResolvedValueOnce(current.stream)
    const play = vi.mocked(HTMLVideoElement.prototype.play)
    play.mockImplementation(function (this: HTMLMediaElement) {
      return this.id === 'camera-preview' ? Promise.reject(new Error('preview play failed')) : Promise.resolve()
    })
    const { root } = startCalibration()

    await vi.waitFor(() => expect(current.stop).toHaveBeenCalledOnce())

    const preview = document.querySelector<HTMLVideoElement>('#camera-preview')!
    expect(root.querySelector('.screen.message')).not.toBeNull()
    expect(play.mock.instances.some(instance => instance !== preview)).toBe(true)
    expect(play.mock.instances.filter(instance => instance === preview)).toHaveLength(1)
    expect(preview.srcObject).toBeNull()
    expect(current.stop).toHaveBeenCalledOnce()
    expect(document.body.classList.contains('calibrating')).toBe(false)
    expect(dependencies.createPoseClient).not.toHaveBeenCalled()
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
