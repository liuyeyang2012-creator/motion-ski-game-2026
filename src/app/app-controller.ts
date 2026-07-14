import { CameraController } from '../camera/camera-controller'
import { advanceGame, createGame } from '../game/game-engine'
import type { GameEvent, GameState, Obstacle } from '../game/types'
import {
  CalibrationSession,
  type CalibrationModelMode,
  type CalibrationSnapshot,
} from '../motion/calibration-session'
import { MotionDetector, type MotionEvent } from '../motion/motion-detector'
import { createDirectPoseClient, DirectPoseClient } from '../pose/direct-pose-client'
import { LifecycleMonitor, type LifecycleEvent } from '../platform/lifecycle'
import type { PoseSample } from '../pose/types'
import { hasTrackingPose } from '../pose/pose-quality'
import { getObstacleVisual, SkiRenderer } from '../render/ski-renderer'
import { loadRecords, recordResult, saveRecords } from '../storage/player-records'
import { saveCalibrationProfile } from '../storage/calibration-profiles'
import { renderCalibration, type CalibrationViewActions } from '../ui/calibration-view'
import { renderMessage, renderResults, renderResume, renderSetup, renderWelcome, type SetupChoice } from '../ui/screens'
import type { PlayStyle } from './types'

export type PoseFixtureMode =
  | 'seated-quick-success'
  | 'seated-soft-success'
  | 'seated-stuck-action'
  | 'seated-body-only'
  | 'standing-soft-success'
interface Options { root: HTMLElement; storage: Pick<Storage, 'getItem' | 'setItem'>; fixtureMode?: boolean | PoseFixtureMode }

export const POSE_INITIALIZATION_TIMEOUT_MS = 15_000
export const FIXTURE_FRAME_INTERVAL_MS = 40

export function getGameHint(style: PlayStyle): string {
  return style === 'seated'
    ? '转头变道 · 抬头跳跃 · 低头躲避'
    : '侧身变道 · 低头过门 · 抬手加速'
}

export class PoseInitializationTimeoutError extends Error {
  constructor() {
    super('Pose initialization timed out')
    this.name = 'PoseInitializationTimeoutError'
  }
}

export function initializePoseClientWithTimeout<T extends { dispose(): void }>(
  task: Promise<T>,
  timeoutMs = POSE_INITIALIZATION_TIMEOUT_MS,
): Promise<T> {
  let timedOut = false
  let timer = 0
  task.then(client => {
    if (timedOut) client.dispose()
  }).catch(() => {})
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      timedOut = true
      reject(new PoseInitializationTimeoutError())
    }, timeoutMs)
  })
  return Promise.race([task, timeout]).finally(() => window.clearTimeout(timer))
}

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

type FixtureChanges = Record<number, Partial<{ x: number; y: number }>>

function createFixtureSample(capturedAt: number, changes: FixtureChanges = {}, hidden: number[] = []): PoseSample {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
  Object.assign(landmarks[0], { x: 0.5, y: 0.2 })
  Object.assign(landmarks[2], { x: 0.47, y: 0.18 })
  Object.assign(landmarks[5], { x: 0.53, y: 0.18 })
  Object.assign(landmarks[7], { x: 0.43, y: 0.21 })
  Object.assign(landmarks[8], { x: 0.57, y: 0.21 })
  Object.assign(landmarks[11], { x: 0.4, y: 0.4 })
  Object.assign(landmarks[12], { x: 0.6, y: 0.4 })
  Object.assign(landmarks[15], { x: 0.4, y: 0.65 })
  Object.assign(landmarks[16], { x: 0.6, y: 0.65 })
  Object.assign(landmarks[23], { x: 0.43, y: 0.7 })
  Object.assign(landmarks[24], { x: 0.57, y: 0.7 })
  Object.assign(landmarks[25], { x: 0.43, y: 0.9 })
  Object.assign(landmarks[26], { x: 0.57, y: 0.9 })
  for (const index of hidden) landmarks[index].visibility = 0
  for (const [index, change] of Object.entries(changes)) Object.assign(landmarks[Number(index)], change)
  return { capturedAt, landmarks }
}

function fixtureAction(start: number, nextStepAt: number, changes: FixtureChanges): PoseSample[] {
  return [
    createFixtureSample(start, changes),
    createFixtureSample(start + 80, changes),
    { capturedAt: start + 160, landmarks: [] },
    ...Array.from({ length: 5 }, (_, index) => createFixtureSample(start + 240 + index * 80, changes)),
    createFixtureSample(nextStepAt),
  ]
}

function faceChanges(dx = 0, dy = 0): FixtureChanges {
  const neutral = createFixtureSample(0)
  return Object.fromEntries([0, 2, 5, 7, 8].map(index => [index, {
    x: neutral.landmarks[index].x + dx,
    y: neutral.landmarks[index].y + dy,
  }]))
}

function createSeatedFixtureSamples(): PoseSample[] {
  return [
    ...Array.from({ length: 13 }, (_, index) => createFixtureSample(
      index * 80,
      {},
      [15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
    )),
    createFixtureSample(1_600),
    ...fixtureAction(1_680, 2_880, faceChanges(0.04)),
    ...fixtureAction(2_960, 4_160, faceChanges(-0.04)),
    ...fixtureAction(4_240, 5_440, faceChanges(0, -0.03)),
    ...fixtureAction(5_520, 6_720, faceChanges(0, 0.03)),
  ]
}

function createStandingFixtureSamples(): PoseSample[] {
  const moveTorso = (dx: number): FixtureChanges => Object.fromEntries(
    [11, 12, 23, 24].map(index => [index, { x: createFixtureSample(0).landmarks[index].x + dx }]),
  )
  return [
    ...Array.from({ length: 11 }, (_, index) => createFixtureSample(index * 80)),
    ...fixtureAction(880, 2_080, moveTorso(-0.06)),
    ...fixtureAction(2_160, 3_360, moveTorso(0.06)),
    ...fixtureAction(3_440, 4_640, { 0: { y: 0.28 } }),
    ...fixtureAction(4_720, 5_920, { 15: { y: 0.28 }, 16: { y: 0.28 } }),
    ...fixtureAction(6_000, 7_200, { 23: { y: 0.82 }, 24: { y: 0.82 } }),
  ]
}

function createStuckFixtureSamples(): PoseSample[] {
  const readyForTurn = createSeatedFixtureSamples().slice(0, 14)
  const neutral = readyForTurn[readyForTurn.length - 1]
  const faceIndices = new Set([0, 2, 5, 7, 8])
  const subthresholdTurn: PoseSample = {
    capturedAt: 1_680,
    landmarks: neutral.landmarks.map((landmark, index) => faceIndices.has(index)
      ? { ...landmark, x: landmark.x + 0.014 }
      : { ...landmark }),
  }
  const stalled: PoseSample = {
    capturedAt: 7_600,
    landmarks: neutral.landmarks.map(landmark => ({ ...landmark })),
  }
  return [...readyForTurn, subthresholdTurn, stalled]
}

function createBodyOnlyFixtureSamples(): PoseSample[] {
  const readyForTurn = createSeatedFixtureSamples().slice(0, 14)
  return [
    ...readyForTurn,
    createFixtureSample(1_680, {
      11: { x: 0.44 }, 12: { x: 0.64 },
      23: { x: 0.47 }, 24: { x: 0.61 },
    }),
    createFixtureSample(7_600),
  ]
}

export function createFixtureSamples(mode: PoseFixtureMode, style: PlayStyle): PoseSample[] {
  if (style === 'standing') return createStandingFixtureSamples()
  if (mode === 'seated-stuck-action') return createStuckFixtureSamples()
  if (mode === 'seated-body-only') return createBodyOnlyFixtureSamples()
  return createSeatedFixtureSamples()
}

function createSeatedQuickFixtureObstacles(): Obstacle[] {
  return [
    { id: 1, appearsAt: 700, lane: 0, requiredMotion: 'turn-left', warningLeadMs: 1_500 },
    { id: 2, appearsAt: 1_400, lane: -1, requiredMotion: 'turn-right', warningLeadMs: 1_500 },
    { id: 3, appearsAt: 2_200, lane: 0, requiredMotion: 'head-up', warningLeadMs: 1_500 },
    { id: 4, appearsAt: 3_000, lane: 0, requiredMotion: 'head-down', warningLeadMs: 1_500 },
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
  private fixtureMode: PoseFixtureMode | null
  private countdownTimer = 0
  private calibrating = false
  private pregameInterrupted = false
  private poseInitialization = 0
  private fixtureTimers: number[] = []
  private fixtureCalibrationSuccesses: number[] = []

  constructor(options: Options) {
    this.root = options.root
    this.storage = options.storage
    this.fixtureMode = options.fixtureMode === true ? 'seated-soft-success' : options.fixtureMode || null
  }

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
    this.clearFixtureTimers()
    this.poseClient?.dispose()
    this.poseClient = null
    window.clearTimeout(this.countdownTimer)
    this.detector = null
    this.game = null
    this.pendingMotions = []
    this.calibrating = true
    this.pregameInterrupted = false
    this.resetFixtureDiagnostics()
    const session = new CalibrationSession(this.choice.playStyle)
    this.calibrationSession = session
    document.body.classList.add('calibrating')
    this.renderCalibrationSession(session)
    this.renderer = new SkiRenderer(canvas)
    this.renderer.resize(canvas.clientWidth || 390, canvas.clientHeight || 844, Math.min(devicePixelRatio || 1, 2))
    if (this.fixtureMode) {
      session.cameraReady()
      session.modelReady()
      const samples = createFixtureSamples(this.fixtureMode, this.choice.playStyle)
      samples.forEach((sample, index) => this.fixtureTimers.push(window.setTimeout(
        () => this.onPose(sample),
        index * FIXTURE_FRAME_INTERVAL_MS,
      )))
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

  private async initializePoseForCalibration(
    session: CalibrationSession,
    video?: HTMLVideoElement,
    mode: CalibrationModelMode = 'standard',
  ): Promise<void> {
    const preview = video ?? document.querySelector<HTMLVideoElement>('#camera-preview') ?? undefined
    if (!preview || !this.isCurrentCalibration(session)) return
    const initialization = ++this.poseInitialization
    session.beginModelLoading(mode)
    this.renderCalibrationSession(session)
    this.poseClient?.dispose()
    this.poseClient = null
    try {
      let client: DirectPoseClient | null = null
      client = await initializePoseClientWithTimeout(createDirectPoseClient(
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
        undefined,
        { mode },
      ))
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
    if (this.calibrating && !this.detector && this.calibrationSession) {
      const session = this.calibrationSession
      const previous = session.snapshot()
      const next = session.tick(time)
      if (previous.phase !== next.phase
        || previous.action !== next.action
        || previous.canRecover !== next.canRecover) {
        this.renderCalibrationSession(session)
      }
      this.finishCalibrationIfComplete(next)
    }
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
      if (this.detector) return
      const session = this.calibrationSession
      if (!session) return
      const previous = session.snapshot()
      const next = session.update(sample)
      this.renderCalibrationSession(session)
      if (shouldVibrate(previous, next)) {
        try { navigator.vibrate?.(35) } catch { /* Haptics are optional. */ }
      }
      this.finishCalibrationIfComplete(next)
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
      onRetryModel: () => { void this.initializePoseForCalibration(session, undefined, 'compatibility') },
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
    const snapshot = session.snapshot()
    this.recordFixtureCalibrationSuccess(snapshot)
    renderCalibration(this.root, snapshot, this.calibrationViewActions(session))
  }

  private fixtureShell(): HTMLElement | null {
    if (!this.fixtureMode) return null
    return this.root.closest('.app-shell') as HTMLElement | null
  }

  private resetFixtureDiagnostics(): void {
    this.fixtureCalibrationSuccesses = []
    const shell = this.fixtureShell()
    if (!shell) return
    for (const attribute of [
      'data-fixture-last-motion',
      'data-fixture-resolved-obstacle',
      'data-fixture-collisions',
      'data-fixture-player-action',
      'data-fixture-player-lane',
    ]) shell.removeAttribute(attribute)
    shell.dataset.fixtureCalibrationSuccesses = ''
  }

  private recordFixtureCalibrationSuccess(snapshot: CalibrationSnapshot): void {
    if (snapshot.phase !== 'step-success'
      || this.fixtureCalibrationSuccesses.includes(snapshot.completedSteps)) return
    this.fixtureCalibrationSuccesses.push(snapshot.completedSteps)
    const shell = this.fixtureShell()
    if (shell) shell.dataset.fixtureCalibrationSuccesses = this.fixtureCalibrationSuccesses.join(',')
  }

  private recordFixtureGameState(): void {
    const shell = this.fixtureShell()
    if (!shell || !this.game) return
    shell.dataset.fixtureCollisions = String(this.game.collisions)
    shell.dataset.fixturePlayerAction = this.game.playerAction
    shell.dataset.fixturePlayerLane = String(this.game.playerLane)
  }

  private recordFixtureGameEvent(previous: GameState, events: GameEvent[]): void {
    const shell = this.fixtureShell()
    if (!shell || !this.game) return
    shell.dataset.fixtureCollisions = String(this.game.collisions)
    const motion = events.find(event => event.type === 'motion')?.motion
    if (!motion) return
    shell.dataset.fixtureLastMotion = motion.type
    shell.dataset.fixturePlayerAction = this.game.playerAction
    shell.dataset.fixturePlayerLane = String(this.game.playerLane)
    const previouslyResolved = new Set(previous.resolvedObstacleIds)
    const newlyResolved = new Set(this.game.resolvedObstacleIds.filter(id => !previouslyResolved.has(id)))
    const visual = getObstacleVisual(motion.type)
    const obstacle = previous.obstacles.find(candidate => newlyResolved.has(candidate.id)
      && getObstacleVisual(candidate.requiredMotion) === visual)
    if (obstacle) shell.dataset.fixtureResolvedObstacle = getObstacleVisual(obstacle.requiredMotion)
  }

  private scheduleSeatedQuickFixtureGame(): void {
    const schedule = (delay: number, samples: PoseSample[]) => {
      samples.forEach((sample, index) => this.fixtureTimers.push(window.setTimeout(
        () => this.onPose(sample),
        delay + index * FIXTURE_FRAME_INTERVAL_MS,
      )))
    }
    schedule(150, [
      createFixtureSample(8_000),
      createFixtureSample(8_080, faceChanges(0.04)),
      createFixtureSample(8_240, faceChanges(0.04)),
      createFixtureSample(8_320),
      createFixtureSample(8_480),
    ])
    schedule(900, [
      createFixtureSample(9_000),
      createFixtureSample(9_080, faceChanges(-0.04)),
      createFixtureSample(9_240, faceChanges(-0.04)),
      createFixtureSample(9_320),
      createFixtureSample(9_480),
    ])
    schedule(1_650, [
      createFixtureSample(10_000),
      createFixtureSample(10_080, faceChanges(0, -0.03)),
      createFixtureSample(10_160, faceChanges(0, -0.03)),
      createFixtureSample(10_240),
      createFixtureSample(10_400),
    ])
    schedule(2_400, [
      createFixtureSample(11_000),
      createFixtureSample(11_080, faceChanges(0, 0.03)),
      createFixtureSample(11_280, faceChanges(0, 0.03)),
      createFixtureSample(11_360),
      createFixtureSample(11_520),
    ])
    this.fixtureTimers.push(window.setTimeout(() => {
      if (this.game?.status === 'playing') this.game.elapsedMs = 29_950
    }, 3_300))
  }

  private clearFixtureTimers(): void {
    for (const timer of this.fixtureTimers) window.clearTimeout(timer)
    this.fixtureTimers = []
  }

  private finishCalibrationIfComplete(snapshot: CalibrationSnapshot): void {
    if (snapshot.phase !== 'complete' || !snapshot.profile || this.detector) return
    saveCalibrationProfile(this.storage, this.choice.playStyle, snapshot.profile)
    this.detector = new MotionDetector(snapshot.profile, this.choice.playStyle)
    renderMessage(this.root, '校准完成', '3 · 2 · 1，准备出发！')
    this.countdownTimer = window.setTimeout(() => this.startGame(), 900)
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
    this.clearFixtureTimers()
    this.root.innerHTML = `<div class="game-hint">${getGameHint(this.choice.playStyle)}</div>`
    this.game = createGame({ ...this.choice, seed: Date.now() })
    if (this.fixtureMode && this.choice.sessionKind === 'quick' && this.fixtureMode !== 'seated-quick-success') {
      this.game.motionCounts = this.choice.playStyle === 'seated'
        ? { 'turn-left': 2, 'turn-right': 1, 'head-up': 2, 'head-down': 1 }
        : { 'lean-left': 3, duck: 2, 'hands-up': 1, squat: 1 }
      this.game.score = 900
      this.game.bestCombo = 7
      this.game.distance = 320
    }
    if (this.fixtureMode === 'seated-quick-success' && this.choice.playStyle === 'seated') {
      this.game.obstacles = createSeatedQuickFixtureObstacles()
    }
    this.recordFixtureGameState()
    this.lastFrame = performance.now()
    cancelAnimationFrame(this.captureFrame)
    const video = document.querySelector<HTMLVideoElement>('#camera-preview')
    if (!this.fixtureMode && video) this.captureFrame = requestAnimationFrame(time => { void this.captureLoop(time, video) })
    this.gameFrame = requestAnimationFrame(time => this.gameLoop(time))
    if (this.fixtureMode === 'seated-quick-success' && this.choice.playStyle === 'seated') {
      this.scheduleSeatedQuickFixtureGame()
    } else if (this.fixtureMode && this.choice.sessionKind === 'quick') {
      this.fixtureTimers.push(window.setTimeout(() => {
        if (this.game?.status === 'playing') this.game.elapsedMs = 29_950
      }, 1_000))
    }
  }

  private gameLoop(time: number): void {
    if (!this.game || !this.renderer) return
    const rawDelta = time - this.lastFrame
    const delta = Math.min(50, rawDelta)
    this.renderer.recordFrameDuration(rawDelta)
    this.lifecycle.addActiveTime(delta)
    this.lastFrame = time
    const previous = this.game
    const result = advanceGame(previous, delta, this.pendingMotions.splice(0))
    this.game = result.state
    this.recordFixtureGameEvent(previous, result.events)
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
      this.root.innerHTML = `<div class="game-hint">${getGameHint(this.choice.playStyle)}</div>`
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
    this.clearFixtureTimers()
    this.stopCurrentCamera(document.querySelector<HTMLVideoElement>('#camera-preview') ?? undefined)
    this.poseClient?.dispose()
    const sessionResult = { score: this.game.score, bestCombo: this.game.bestCombo, activeMs: this.game.elapsedMs, ...this.choice }
    saveRecords(this.storage, recordResult(loadRecords(this.storage), sessionResult))
    renderResults(this.root, { ...this.game, activeMs: this.game.elapsedMs }, () => this.showSetup())
  }
}
