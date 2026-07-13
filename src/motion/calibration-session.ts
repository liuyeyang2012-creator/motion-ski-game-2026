import type { PlayStyle } from '../app/types'
import { assessLandmarks } from '../pose/pose-quality'
import type { PoseLandmark, PoseSample } from '../pose/types'
import {
  assessCalibrationAction,
  buildCalibration,
  checkFraming,
  getCalibrationActions,
  requiredLandmarksFor,
} from './calibration'
import type {
  CalibrationAction,
  CalibrationFeedbackCode,
  CalibrationProfile,
  FramingIssue,
} from './calibration'

const REQUIRED_EVIDENCE_MS = 500
const MAX_SAMPLE_DELTA_MS = 120
const MISS_DECAY_RATE = 0.35
const ACTION_RECOVERY_MS = 8_000
const SUCCESS_DISPLAY_MS = 450
const MINIMUM_BASELINE_SAMPLES = 8
const MINIMUM_BASELINE_SPAN_MS = 800

export type CalibrationPhase =
  | 'camera-check'
  | 'model-check'
  | 'model-error'
  | 'body-check'
  | 'baseline'
  | 'action'
  | 'step-success'
  | 'complete'

export interface CalibrationSnapshot {
  phase: CalibrationPhase
  style: PlayStyle
  stepIndex: number
  totalSteps: 5
  completedSteps: number
  completedActions: readonly CalibrationAction[]
  action: CalibrationAction | null
  holdProgress: number
  framingIssue: FramingIssue | null
  feedback: CalibrationFeedbackCode | null
  requiredIndices: readonly number[]
  latestLandmarks: PoseLandmark[]
  canRecover: boolean
  profile: CalibrationProfile | null
}

export class CalibrationSession {
  private readonly style: PlayStyle
  private readonly actions: readonly CalibrationAction[]
  private phase: CalibrationPhase = 'camera-check'
  private stepIndex = 0
  private completedSteps = 0
  private baselineSamples: PoseSample[] = []
  private profile: CalibrationProfile | null = null
  private evidenceMs = 0
  private successAt: number | null = null
  private actionStartedAt: number | null = null
  private feedback: CalibrationFeedbackCode | null = null
  private framingIssue: FramingIssue | null = null
  private latestLandmarks: PoseLandmark[] = []
  private lastCapturedAt = 0
  private previousCapturedAt = 0

  constructor(style: PlayStyle) {
    this.style = style
    this.actions = getCalibrationActions(style)
  }

  cameraReady(): CalibrationSnapshot {
    if (this.phase === 'camera-check') this.phase = 'model-check'
    return this.snapshot()
  }

  beginModelLoading(): CalibrationSnapshot {
    if (this.phase !== 'complete') this.phase = 'model-check'
    return this.snapshot()
  }

  modelReady(): CalibrationSnapshot {
    if (this.phase === 'model-check' || this.phase === 'model-error') {
      this.phase = this.profile ? 'action' : 'body-check'
      this.feedback = this.profile ? this.feedback : 'body-not-found'
    }
    return this.snapshot()
  }

  modelFailed(): CalibrationSnapshot {
    if (this.phase !== 'complete') this.phase = 'model-error'
    return this.snapshot()
  }

  restartBodyCheck(): CalibrationSnapshot {
    if (!this.profile) {
      this.phase = 'body-check'
      this.baselineSamples = []
      this.feedback = 'body-not-found'
    }
    return this.snapshot()
  }

  retryCurrentAction(): CalibrationSnapshot {
    if (this.phase === 'action') {
      this.evidenceMs = 0
      this.actionStartedAt = this.lastCapturedAt
    }
    return this.snapshot()
  }

  useRecommendedSensitivity(): CalibrationSnapshot {
    if (this.phase === 'action' && this.profile) this.confirmCurrentStep()
    return this.snapshot()
  }

  update(sample: PoseSample): CalibrationSnapshot {
    const deltaMs = this.previousCapturedAt === 0
      ? MAX_SAMPLE_DELTA_MS
      : Math.max(0, Math.min(MAX_SAMPLE_DELTA_MS, sample.capturedAt - this.previousCapturedAt))
    this.previousCapturedAt = sample.capturedAt
    this.lastCapturedAt = sample.capturedAt
    this.latestLandmarks = sample.landmarks

    if (this.phase === 'complete' || this.phase === 'camera-check' || this.phase === 'model-check' || this.phase === 'model-error') {
      return this.snapshot()
    }

    if (this.phase === 'step-success') {
      if (this.successAt !== null && sample.capturedAt - this.successAt >= SUCCESS_DISPLAY_MS) this.advanceAfterSuccess()
      return this.snapshot()
    }

    if (this.phase === 'body-check') {
      const required = requiredLandmarksFor(this.style, null)
      const quality = assessLandmarks(sample, required)
      if (!quality.ok) {
        this.setMissingFeedback(sample)
        return this.snapshot()
      }
      this.phase = 'baseline'
      this.baselineSamples = [sample]
      this.feedback = 'hold'
      this.framingIssue = null
      return this.snapshot()
    }

    if (this.phase === 'baseline') {
      const framing = checkFraming(sample, this.style)
      if (!framing.ok) {
        this.framingIssue = framing.issue
        this.setMissingFeedback(sample)
        return this.snapshot()
      }
      this.framingIssue = null
      this.feedback = 'hold'
      this.baselineSamples.push(sample)
      const first = this.baselineSamples[0]
      if (this.baselineSamples.length >= MINIMUM_BASELINE_SAMPLES
        && sample.capturedAt - first.capturedAt >= MINIMUM_BASELINE_SPAN_MS) {
        const calibration = buildCalibration(this.baselineSamples, this.style)
        if (calibration.ok) {
          this.profile = calibration.profile
          this.phase = 'action'
          this.actionStartedAt = sample.capturedAt
          this.evidenceMs = 0
          this.feedback = this.actions[0] === 'lean-left' ? 'move-left' : null
        }
      }
      return this.snapshot()
    }

    if (this.phase === 'action' && this.profile) {
      const action = this.actions[this.stepIndex]
      const assessment = assessCalibrationAction(this.profile, sample, this.style, action)
      this.feedback = assessment.feedback
      this.framingIssue = assessment.feedback === 'body-not-found' ? 'pose-lost' : null
      this.updateEvidence(assessment.ok, deltaMs)
      if (this.evidenceMs >= REQUIRED_EVIDENCE_MS) this.confirmCurrentStep()
    }
    return this.snapshot()
  }

  snapshot(): CalibrationSnapshot {
    const action = this.phase === 'action' || this.phase === 'step-success'
      ? this.actions[this.stepIndex]
      : null
    const requiredIndices = requiredLandmarksFor(this.style, action)
    const baselineProgress = this.phase === 'baseline' && this.baselineSamples.length > 0
      ? Math.min(1, Math.max(0, (this.lastCapturedAt - this.baselineSamples[0].capturedAt) / MINIMUM_BASELINE_SPAN_MS))
      : 0
    return {
      phase: this.phase,
      style: this.style,
      stepIndex: this.stepIndex,
      totalSteps: 5,
      completedSteps: this.completedSteps,
      completedActions: this.actions.slice(0, this.completedSteps),
      action,
      holdProgress: this.phase === 'action' ? this.evidenceMs / REQUIRED_EVIDENCE_MS : baselineProgress,
      framingIssue: this.framingIssue,
      feedback: this.feedback,
      requiredIndices,
      latestLandmarks: this.latestLandmarks,
      canRecover: this.phase === 'action'
        && this.actionStartedAt !== null
        && this.lastCapturedAt - this.actionStartedAt >= ACTION_RECOVERY_MS,
      profile: this.profile,
    }
  }

  private updateEvidence(matches: boolean, deltaMs: number): void {
    this.evidenceMs = matches
      ? Math.min(REQUIRED_EVIDENCE_MS, this.evidenceMs + deltaMs)
      : Math.max(0, this.evidenceMs - deltaMs * MISS_DECAY_RATE)
  }

  private confirmCurrentStep(): void {
    this.phase = 'step-success'
    this.completedSteps = this.stepIndex + 1
    this.successAt = this.lastCapturedAt
    this.evidenceMs = 0
    this.feedback = 'hold'
  }

  private advanceAfterSuccess(): void {
    if (this.stepIndex === this.actions.length - 1) {
      this.phase = 'complete'
    } else {
      this.stepIndex += 1
      this.phase = 'action'
      this.actionStartedAt = this.lastCapturedAt
      this.feedback = this.actions[this.stepIndex] === 'lean-right' ? 'move-right' : null
    }
    this.successAt = null
  }

  private setMissingFeedback(sample: PoseSample): void {
    const required = requiredLandmarksFor(this.style, null)
    const missing = assessLandmarks(sample, required).missing[0]
    this.feedback = sample.landmarks.length === 0
      ? 'body-not-found'
      : missing === 0
        ? 'head-missing'
        : missing === 11 || missing === 12
          ? 'shoulders-missing'
          : 'hips-missing'
  }
}
