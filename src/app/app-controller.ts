import { CameraController } from '../camera/camera-controller'
import { advanceGame, createGame } from '../game/game-engine'
import type { GameState } from '../game/types'
import { buildCalibration } from '../motion/calibration'
import { MotionDetector, type MotionEvent } from '../motion/motion-detector'
import { PoseClient } from '../pose/pose-client'
import type { PoseSample } from '../pose/types'
import { SkiRenderer } from '../render/ski-renderer'
import { loadRecords, recordResult, saveRecords } from '../storage/player-records'
import { renderMessage, renderResults, renderSetup, renderWelcome, type SetupChoice } from '../ui/screens'

interface Options { root: HTMLElement; storage: Pick<Storage, 'getItem' | 'setItem'> }

export class AppController {
  private root: HTMLElement
  private storage: Pick<Storage, 'getItem' | 'setItem'>
  private camera = new CameraController()
  private samples: PoseSample[] = []
  private detector: MotionDetector | null = null
  private game: GameState | null = null
  private renderer: SkiRenderer | null = null
  private poseClient: PoseClient | null = null
  private choice: SetupChoice = { playStyle: 'seated', sessionKind: 'quick' }
  private pendingMotions: MotionEvent[] = []
  private frame = 0
  private lastFrame = 0
  private lastInference = 0

  constructor(options: Options) { this.root = options.root; this.storage = options.storage }

  start(): void {
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
    renderMessage(this.root, '请调整位置', this.choice.playStyle === 'standing' ? '后退一点，让肩膀、髋部和膝盖进入画面' : '坐直身体，让肩膀和髋部进入画面')
    try {
      await this.camera.start(video)
      video.style.opacity = '0.2'
      const worker = new Worker(new URL('../pose/pose-worker.ts', import.meta.url), { type: 'module' })
      this.poseClient = new PoseClient(worker, sample => this.onPose(sample))
      this.poseClient.start()
      this.renderer = new SkiRenderer(canvas)
      this.samples = []
      this.lastInference = 0
      this.frame = requestAnimationFrame(time => this.captureLoop(time, video))
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError'
      renderMessage(this.root, denied ? '需要摄像头权限' : '摄像头暂时不可用', denied ? '请在浏览器设置中允许摄像头，然后刷新页面重试。' : '请确认使用最新版手机浏览器，并关闭其他占用摄像头的应用。')
    }
  }

  private async captureLoop(time: number, video: HTMLVideoElement): Promise<void> {
    if (!this.game && this.samples.length < 15 || this.game?.status === 'playing') {
      if (time - this.lastInference >= 80 && video.readyState >= 2) {
        this.lastInference = time
        const bitmap = await createImageBitmap(video)
        this.poseClient?.detect(bitmap, performance.now())
      }
      this.frame = requestAnimationFrame(next => { void this.captureLoop(next, video) })
    }
  }

  private onPose(sample: PoseSample): void {
    if (!this.detector) {
      this.samples.push(sample)
      if (this.samples.length < 15) return
      const calibration = buildCalibration(this.samples, this.choice.playStyle)
      if (!calibration.ok) {
        const copy = calibration.issue === 'hips-not-visible' ? '请后退一点，让肩膀和髋部进入画面' : '请保持身体稳定，并改善环境光'
        renderMessage(this.root, '还差一点', copy)
        this.samples = []
        return
      }
      this.detector = new MotionDetector(calibration.profile, this.choice.playStyle)
      renderMessage(this.root, '校准完成', '3 · 2 · 1，准备出发！')
      window.setTimeout(() => this.startGame(), 900)
      return
    }
    this.pendingMotions.push(...this.detector.update(sample))
  }

  private startGame(): void {
    this.root.innerHTML = '<div class="game-hint">侧身变道 · 低头过门 · 抬手加速</div>'
    this.game = createGame({ ...this.choice, seed: Date.now() })
    this.lastFrame = performance.now()
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(time => this.gameLoop(time))
  }

  private gameLoop(time: number): void {
    if (!this.game || !this.renderer) return
    const delta = Math.min(50, time - this.lastFrame)
    this.lastFrame = time
    const result = advanceGame(this.game, delta, this.pendingMotions.splice(0))
    this.game = result.state
    this.renderer.render(this.game)
    if (this.game.status === 'finished') { this.finishGame(); return }
    this.frame = requestAnimationFrame(next => this.gameLoop(next))
  }

  private finishGame(): void {
    if (!this.game) return
    cancelAnimationFrame(this.frame)
    this.camera.stop(document.querySelector<HTMLVideoElement>('#camera-preview') ?? undefined)
    this.poseClient?.dispose()
    const sessionResult = { score: this.game.score, bestCombo: this.game.bestCombo, activeMs: this.game.elapsedMs, ...this.choice }
    saveRecords(this.storage, recordResult(loadRecords(this.storage), sessionResult))
    renderResults(this.root, { ...this.game, activeMs: this.game.elapsedMs }, () => this.showSetup())
  }
}
