import { CameraController } from '../camera/camera-controller'
import { advanceGame, createGame } from '../game/game-engine'
import type { GameState } from '../game/types'
import {
  buildCalibration,
  CALIBRATION_SAMPLES_PER_STEP,
  CALIBRATION_TOTAL_SAMPLES,
  getCalibrationPrompt,
  validateCalibrationActions,
} from '../motion/calibration'
import { MotionDetector, type MotionEvent } from '../motion/motion-detector'
import { createDirectPoseClient, DirectPoseClient } from '../pose/direct-pose-client'
import { LifecycleMonitor, type LifecycleEvent } from '../platform/lifecycle'
import type { PoseSample } from '../pose/types'
import { SkiRenderer } from '../render/ski-renderer'
import { loadRecords, recordResult, saveRecords } from '../storage/player-records'
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

export class AppController {
  private root: HTMLElement
  private storage: Pick<Storage, 'getItem' | 'setItem'>
  private camera = new CameraController()
  private samples: PoseSample[] = []
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
    this.camera.stop(video)
    this.poseClient?.dispose()
    this.detector = null
    this.calibrating = true
    this.pregameInterrupted = false
    renderMessage(this.root, '请调整位置', this.choice.playStyle === 'standing' ? '后退一点，让肩膀、髋部和膝盖进入画面' : '坐直身体，让肩膀和髋部进入画面')
    if (this.fixtureMode) {
      this.renderer = new SkiRenderer(canvas)
      this.renderer.resize(canvas.clientWidth || 390, canvas.clientHeight || 844, Math.min(devicePixelRatio || 1, 2))
      this.countdownTimer = window.setTimeout(() => this.startGame(), 50)
      return
    }
    try {
      await this.camera.start(video)
    } catch (error) {
      this.camera.stop(video)
      const copy = getCameraErrorCopy(error, window.isSecureContext)
      renderMessage(this.root, copy.title, copy.body)
      return
    }
    video.style.opacity = '0.2'
    try {
      renderMessage(this.root, '正在启动体感识别', '第一次载入可能需要几秒，请保持在画面中央')
      this.poseClient = await createDirectPoseClient(
        document.baseURI,
        sample => this.onPose(sample),
        () => this.stopCalibrationWithError('体感识别遇到问题，请刷新页面后重试'),
      )
      this.renderer = new SkiRenderer(canvas)
      this.renderer.resize(canvas.clientWidth || 390, canvas.clientHeight || 844, Math.min(devicePixelRatio || 1, 2))
      this.samples = []
      this.lastInference = 0
      this.captureFrame = requestAnimationFrame(time => this.captureLoop(time, video))
    } catch {
      this.stopCalibrationWithError('识别组件加载失败，请检查网络后刷新页面重试')
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
    if (!this.detector) {
      this.samples.push(sample)
      if (this.samples.length >= CALIBRATION_SAMPLES_PER_STEP && this.samples.length % CALIBRATION_SAMPLES_PER_STEP === 0) {
        const prompt = getCalibrationPrompt(this.samples.length, this.choice.playStyle)
        if (prompt) renderMessage(this.root, '动作校准', prompt)
      }
      if (this.samples.length < CALIBRATION_TOTAL_SAMPLES) return
      const calibration = buildCalibration(this.samples.slice(0, CALIBRATION_SAMPLES_PER_STEP), this.choice.playStyle)
      if (!calibration.ok) {
        const copy = calibration.issue === 'hips-not-visible' ? '请后退一点，让肩膀和髋部进入画面' : '请保持身体稳定，并改善环境光'
        renderMessage(this.root, '还差一点', copy)
        this.samples = []
        return
      }
      const actions = validateCalibrationActions(calibration.profile, this.samples, this.choice.playStyle)
      if (!actions.ok) {
        renderMessage(this.root, '动作还不够清楚', '请按提示稍微加大动作幅度，我们重新校准一次。')
        this.samples = []
        return
      }
      this.detector = new MotionDetector(calibration.profile, this.choice.playStyle)
      renderMessage(this.root, '校准完成', '3 · 2 · 1，准备出发！')
      this.countdownTimer = window.setTimeout(() => this.startGame(), 900)
      return
    }
    if (sample.confidence < 0.6) {
      this.pauseForReposition('请重新进入画面')
      return
    }
    this.pendingMotions.push(...this.detector.update(sample))
  }

  private stopCalibrationWithError(message: string): void {
    if (!this.calibrating) return
    this.calibrating = false
    cancelAnimationFrame(this.captureFrame)
    this.camera.stop(document.querySelector<HTMLVideoElement>('#camera-preview') ?? undefined)
    this.poseClient?.dispose()
    this.poseClient = null
    renderMessage(this.root, '体感识别未能启动', message)
  }

  private startGame(): void {
    if (this.pregameInterrupted) return
    this.calibrating = false
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
      window.clearTimeout(this.countdownTimer); cancelAnimationFrame(this.captureFrame); this.camera.pause()
      if (this.game) this.pauseForReposition('请将手机旋转为竖屏')
      else if (this.calibrating) {
        this.pregameInterrupted = true
        this.calibrating = false
        this.samples = []
        const video = document.querySelector<HTMLVideoElement>('#camera-preview')
        this.camera.stop(video ?? undefined)
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
    cancelAnimationFrame(this.gameFrame); cancelAnimationFrame(this.captureFrame); this.camera.pause()
    this.showResume(reason)
  }

  private showResume(reason: string): void {
    renderResume(this.root, reason, () => { void this.resumeGame() })
  }

  private async resumeGame(): Promise<void> {
    if (!this.game) return
    const video = document.querySelector<HTMLVideoElement>('#camera-preview')
    if (!this.fixtureMode && video) await this.camera.resume(video)
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
    cancelAnimationFrame(this.gameFrame)
    cancelAnimationFrame(this.captureFrame)
    this.camera.stop(document.querySelector<HTMLVideoElement>('#camera-preview') ?? undefined)
    this.poseClient?.dispose()
    const sessionResult = { score: this.game.score, bestCombo: this.game.bestCombo, activeMs: this.game.elapsedMs, ...this.choice }
    saveRecords(this.storage, recordResult(loadRecords(this.storage), sessionResult))
    renderResults(this.root, { ...this.game, activeMs: this.game.elapsedMs }, () => this.showSetup())
  }
}
