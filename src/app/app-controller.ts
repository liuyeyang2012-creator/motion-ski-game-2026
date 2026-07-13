import { CameraController } from '../camera/camera-controller'
import { advanceGame, createGame } from '../game/game-engine'
import type { GameState } from '../game/types'
import { CalibrationSession, type CalibrationSnapshot } from '../motion/calibration-session'
import { MotionDetector, type MotionEvent } from '../motion/motion-detector'
import { createDirectPoseClient, DirectPoseClient } from '../pose/direct-pose-client'
import { LifecycleMonitor, type LifecycleEvent } from '../platform/lifecycle'
import type { PoseSample } from '../pose/types'
import { hasTrackingPose } from '../pose/pose-quality'
import { SkiRenderer } from '../render/ski-renderer'
import { loadRecords, recordResult, saveRecords } from '../storage/player-records'
import { renderCalibration, type CalibrationViewActions } from '../ui/calibration-view'
import { renderMessage, renderResults, renderResume, renderSetup, renderWelcome, type SetupChoice } from '../ui/screens'

interface Options { root: HTMLElement; storage: Pick<Storage, 'getItem' | 'setItem'>; fixtureMode?: boolean }

export function getCameraErrorCopy(error: unknown, secureContext: boolean): { title: string; body: string } {
  if (!secureContext || !navigator.mediaDevices?.getUserMedia) {
    return { title: '手机摄像头需要 HTTPS', body: '当前局域网地址是普通 HTTP，手机浏览器会禁用摄像头。请改用 HTTPS 测试地址。' }
  }
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return { title: '需要摄像头权限', body: '请在浏览器设置中允许摄像头，然后刷新页面重试。' }
  }
  return { title: '摄像头暂时不可用', body: '请关闭其他占用摄像头的应用，或改用最新版手机浏览器。' }
}

export function shouldCapturePose(calibrating: boolean, gameStatus?: GameState['status']): boolean {
  return calibrating || gameStatus === 'playing'
}

export function shouldVibrate(previous: CalibrationSnapshot, next: CalibrationSnapshot): boolean {
  return previous.phase !== 'step-success' && next.phase === 'step-success'
}

function createSeatedFixtureSamples(): PoseSample[] {
  const sample = (capturedAt: number, changes: Record<number, Partial<{ x: number; y: number }>> = {}): PoseSample => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
    Object.assign(landmarks[0], { x: 0.5, y: 0.2 })
    Object.assign(landmarks[11], { x: 0.4, y: 0.4 })
    Object.assign(landmarks[12], { x: 0.6, y: 0.4 })
    Object.assign(landmarks[15], { x: 0.4, y: 0.65 })
    Object.assign(landmarks[16], { x: 0.6, y: 0.65 })
    Object.assign(landmarks[23], { x: 0.43, y: 0.7 })
    Object.assign(landmarks[24], { x: 0.57, y: 0.7 })
    Object.assign(landmarks[25], { x: 0.43, y: 0.9 })
    Object.assign(landmarks[26], { x: 0.57, y: 0.9 })
    for (const [index, change] of Object.entries(changes)) Object.assign(landmarks[Number(index)], change)
    return { capturedAt, landmarks }
  }
  const action = (start: number, changes: Record<number, Partial<{ x: number; y: number }>>) => [
    ...Array.from({ length: 6 }, (_, index) => sample(start + index * 80, changes)),
    sample(start + 850),
  ]

  return [
    ...Array.from({ length: 8 }, (_, index) => sample(index * 100)),
    ...action(800, { 11: { x: 0.3 }, 12: { x: 0.5 } }),
    ...action(1750, { 11: { x: 0.5 }, 12: { x: 0.7 } }),
    ...action(2700, { 0: { y: 0.3 } }),
    ...action(3650, { 15: { y: 0.3 }, 16: { y: 0.3 } }),
    ...action(4600, { 15: { x: 0.1 }, 16: { x: 0.9 } }),
  ]
}

export class AppController {
  private root: HTMLElement
  private storage: Pick<Storage, 'getItem' | 'setItem'>
  private camera: CameraController | null = null
  private calibrationSession: CalibrationSession | null = null
  private detector: MotionDetector | null = null
  private game: GameState | null = null
  private renderer: SkiRenderer | null = null
  private poseClient: DirectPoseClient | null = null
  private choice: SetupChoice = { playStyle: 'seated', sessionKind: 'quick' }
  private pendingMotions: MotionEvent[] = []
  private captureFrame = 0
  private gameFrame = 0
  private lastFrame = 0
  private lastInference = 0
  private lifecycle = new LifecycleMonitor(event => this.onLifecycle(event))
  private fixtureMode: boolean
  private countdownTimer = 0
  private calibrating = false
  private pregameInterrupted = false
  private poseInitialization = 0

  constructor(options: Options) { this.root = options.root; this.storage = options.storage; this.fixtureMode = options.fixtureMode ?? false }

  start(): void {
    this.lifecycle.attach()
    const records = loadRecords(this.storage)
    this.choice = { playStyle: records.lastPlayStyle, sessionKind: records.lastSessionKind }
    renderWelcome(this.root, () => this.showSetup())
  }

  private showSetup(): void {
    renderSetup(this.root, this.choice, choice => { this.choice = choice; void this.beginCalibration() })
  }

  private async beginCalibration(): Promise<void> {
    const video = document.querySelector<HTMLVideoElement>('#camera-preview')
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    if (!video || !canvas) return
    this.stopCurrentCamera(video)
    this.poseClient?.dispose()
    this.poseClient = null
    window.clearTimeout(this.countdownTimer)
    this.detector = null
    this.game = null
    this.pendingMotions = []
    this.calibrating = true
    this.pregameInterrupted = false
    const session = new CalibrationSession(this.choice.playStyle)
    this.calibrationSession = session
    document.body.classList.add('calibrating')
    this.renderCalibrationSession(session)
    this.renderer = new SkiRenderer(canvas)
    this.renderer.resize(canvas.clientWidth || 390, canvas.clientHeight || 844, Math.min(devicePixelRatio || 1, 2))
    if (this.fixtureMode) {
      session.cameraReady()
      session.modelReady()
      for (const sample of createSeatedFixtureSamples()) this.onPose(sample)
      return
    }
    const camera = new CameraController()
    const cameraTarget = document.createElement('video')
    cameraTarget.muted = true
    cameraTarget.playsInline = true
    this.camera = camera
    try {
      const stream = await camera.start(cameraTarget)
      if (!this.isCurrentCalibration(session)) {
        camera.stop()
        cameraTarget.srcObject = null
        return
      }
      video.srcObject = stream
      await video.play()
      cameraTarget.srcObject = null
      session.cameraReady()
      this.renderCalibrationSession(session)
    } catch (error) {
      cameraTarget.srcObject = null
      if (!this.isCurrentCalibration(session)) {
        camera.stop()
        return
      }
      this.clearCalibrationState()
      camera.stop(video)
      if (this.camera === camera) this.camera = null
      const copy = getCameraErrorCopy(error, window.isSecureContext)
      renderMessage(this.root, copy.title, copy.body)
      return
    }
    if (!this.isCurrentCalibration(session)) {
      camera.stop()
      return
    }
    await this.initializePoseForCalibration(session, video)
  }

  private async initializePoseForCalibration(session: CalibrationSession, video?: HTMLVideoElement): Promise<void> {
    const preview = video ?? document.querySelector<HTMLVideoElement>('#camera-preview') ?? undefined
    if (!preview || !this.isCurrentCalibration(session)) return
    const initialization = ++this.poseInitialization
    session.beginModelLoading()
    this.renderCalibrationSession(session)
    this.poseClient?.dispose()
    this.poseClient = null
    try {
      let client: DirectPoseClient | null = null
      client = await createDirectPoseClient(
        document.baseURI,
        sample => {
          if (this.isCurrentCalibration(session) && client !== null && this.poseClient === client) this.onPose(sample)
        },
        () => {
          if (!this.isCurrentCalibration(session) || client === null || this.poseClient !== client) return
          client.dispose()
          this.poseClient = null
          session.modelFailed()
          this.renderCalibrationSession(session)
        },
      )
      if (!this.isCurrentCalibration(session) || initialization !== this.poseInitialization) {
        client.dispose()
        return
      }
      this.poseClient = client
      session.modelReady()
      this.renderCalibrationSession(session)
      this.lastInference = 0
      cancelAnimationFrame(this.captureFrame)
      this.captureFrame = requestAnimationFrame(time => this.captureLoop(time, preview))
    } catch {
      if (!this.isCurrentCalibration(session) || initialization !== this.poseInitialization) return
      session.modelFailed()
      this.renderCalibrationSession(session)
    }
  }

  private async captureLoop(time: number, video: HTMLVideoElement): Promise<void> {
    if (shouldCapturePose(this.calibrating && !this.detector, this.game?.status)) {
      if (time - this.lastInference >= 80 && video.readyState >= 2) {
        this.lastInference = time
        this.poseClient?.detect(video, performance.now())
      }
      this.captureFrame = requestAnimationFrame(next => { void this.captureLoop(next, video) })
    }
  }

  private onPose(sample: PoseSample): void {
    if (this.calibrating) {
      const session = this.calibrationSession
      if (!session) return
      const previous = session.snapshot()
      const next = session.update(sample)
      this.renderCalibrationSession(session)
      if (shouldVibrate(previous, next)) {
        try { navigator.vibrate?.(35) } catch { /* Haptics are optional. */ }
      }
      if (next.phase === 'complete' && next.profile && !this.detector) {
        this.detector = new MotionDetector(next.profile, this.choice.playStyle)
        renderMessage(this.root, '校准完成', '3 · 2 · 1，准备出发！')
        this.countdownTimer = window.setTimeout(() => this.startGame(), 900)
      }
      return
    }
    if (!this.detector || this.game?.status !== 'playing') return
    if (!hasTrackingPose(sample, this.choice.playStyle)) {
      this.pauseForReposition('请重新进入画面')
      return
    }
    this.pendingMotions.push(...this.detector.update(sample))
  }

  private calibrationViewActions(session: CalibrationSession): CalibrationViewActions {
    return {
      onRetryModel: () => { void this.initializePoseForCalibration(session) },
      onRetryBody: () => {
        session.restartBodyCheck()
        this.renderCalibrationSession(session)
      },
      onRetryAction: () => {
        session.retryCurrentAction()
        this.renderCalibrationSession(session)
      },
      onUseRecommended: () => {
        const previous = session.snapshot()
        session.useRecommendedSensitivity()
        const next = session.snapshot()
        this.renderCalibrationSession(session)
        if (shouldVibrate(previous, next)) {
          try { navigator.vibrate?.(35) } catch { /* Haptics are optional. */ }
        }
      },
    }
  }

  private renderCalibrationSession(session: CalibrationSession): void {
    if (!this.isCurrentCalibration(session)) return
    renderCalibration(this.root, session.snapshot(), this.calibrationViewActions(session))
  }

  private clearCalibrationState(): void {
    this.calibrating = false
    this.calibrationSession = null
    document.body.classList.remove('calibrating')
    window.clearTimeout(this.countdownTimer)
  }

  private isCurrentCalibration(session: CalibrationSession): boolean {
    return this.calibrating && this.calibrationSession === session
  }

  private stopCurrentCamera(video?: HTMLVideoElement): void {
    const camera = this.camera
    camera?.stop(video)
    if (this.camera === camera) this.camera = null
  }

  private startGame(): void {
    if (this.pregameInterrupted || !this.detector) return
    this.clearCalibrationState()
    this.root.innerHTML = '<div class="game-hint">侧身变道 · 低头过门 · 抬手加速</div>'
    this.game = createGame({ ...this.choice, seed: Date.now() })
    if (this.fixtureMode && this.choice.sessionKind === 'quick') {
      this.game.elapsedMs = 29_900
      this.game.motionCounts = { 'lean-left': 3, duck: 2, 'hands-up': 1 }
      this.game.score = 900
      this.game.bestCombo = 7
      this.game.distance = 320
    }
    this.lastFrame = performance.now()
    cancelAnimationFrame(this.captureFrame)
    const video = document.querySelector<HTMLVideoElement>('#camera-preview')
    if (!this.fixtureMode && video) this.captureFrame = requestAnimationFrame(time => { void this.captureLoop(time, video) })
    this.gameFrame = requestAnimationFrame(time => this.gameLoop(time))
  }

  private gameLoop(time: number): void {
    if (!this.game || !this.renderer) return
    const rawDelta = time - this.lastFrame
    const delta = Math.min(50, rawDelta)
    this.renderer.recordFrameDuration(rawDelta)
    this.lifecycle.addActiveTime(delta)
    this.lastFrame = time
    const result = advanceGame(this.game, delta, this.pendingMotions.splice(0))
    this.game = result.state
    this.renderer.render(this.game)
    if (this.game.status === 'finished') { this.finishGame(); return }
    this.gameFrame = requestAnimationFrame(next => this.gameLoop(next))
  }

  private onLifecycle(event: LifecycleEvent): void {
    if (event === 'backgrounded') this.pauseForReposition('已切换到其他应用')
    if (event === 'foregrounded' && this.game?.status === 'paused') this.showResume('重新确认位置')
    if (event === 'landscape') {
      document.body.classList.add('landscape-blocked')
      window.clearTimeout(this.countdownTimer); cancelAnimationFrame(this.captureFrame); this.camera?.pause()
      if (this.game) this.pauseForReposition('请将手机旋转为竖屏')
      else if (this.calibrating) {
        this.pregameInterrupted = true
        this.clearCalibrationState()
        const video = document.querySelector<HTMLVideoElement>('#camera-preview')
        this.stopCurrentCamera(video ?? undefined)
        this.poseClient?.dispose(); this.poseClient = null; this.detector = null
      }
    }
    if (event === 'portrait') {
      document.body.classList.remove('landscape-blocked')
      if (!this.game && this.pregameInterrupted) { this.pregameInterrupted = false; this.showSetup() }
    }
    if (event === 'rest-due') {
      const notice = document.createElement('div')
      notice.className = 'rest-notice'
      notice.textContent = '已经活动 5 分钟，建议休息一下。'
      notice.addEventListener('click', () => notice.remove())
      document.body.append(notice)
    }
  }

  private pauseForReposition(reason: string): void {
    if (this.game?.status !== 'playing') return
    this.game = { ...this.game, status: 'paused' }
    cancelAnimationFrame(this.gameFrame); cancelAnimationFrame(this.captureFrame); this.camera?.pause()
    this.showResume(reason)
  }

  private showResume(reason: string): void {
    renderResume(this.root, reason, () => { void this.resumeGame() })
  }

  private async resumeGame(): Promise<void> {
    if (!this.game) return
    const video = document.querySelector<HTMLVideoElement>('#camera-preview')
    if (!this.fixtureMode && video) await this.camera?.resume(video)
    renderMessage(this.root, '准备继续', '3 · 2 · 1')
    window.setTimeout(() => {
      if (!this.game) return
      this.root.innerHTML = '<div class="game-hint">侧身变道 · 低头过门 · 抬手加速</div>'
      this.game = { ...this.game, status: 'playing' }
      this.lastFrame = performance.now()
      if (!this.fixtureMode && video) this.captureFrame = requestAnimationFrame(time => { void this.captureLoop(time, video) })
      this.gameFrame = requestAnimationFrame(time => this.gameLoop(time))
    }, 900)
  }

  private finishGame(): void {
    if (!this.game) return
    this.clearCalibrationState()
    cancelAnimationFrame(this.gameFrame)
    cancelAnimationFrame(this.captureFrame)
    this.stopCurrentCamera(document.querySelector<HTMLVideoElement>('#camera-preview') ?? undefined)
    this.poseClient?.dispose()
    const sessionResult = { score: this.game.score, bestCombo: this.game.bestCombo, activeMs: this.game.elapsedMs, ...this.choice }
    saveRecords(this.storage, recordResult(loadRecords(this.storage), sessionResult))
    renderResults(this.root, { ...this.game, activeMs: this.game.elapsedMs }, () => this.showSetup())
  }
}
