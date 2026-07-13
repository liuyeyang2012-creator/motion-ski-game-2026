import type { PlayStyle } from '../app/types'
import type { PoseSample } from '../pose/types'
import {
  buildCalibration,
  checkFraming,
  getCalibrationActions,
  matchesCalibrationAction,
} from './calibration'
import type { CalibrationAction, CalibrationProfile, FramingIssue } from './calibration'

const ACTION_HOLD_MS = 400
const SUCCESS_DISPLAY_MS = 450
const POSE_LOSS_RECOVERY_MS = 1500
const MINIMUM_BASELINE_SAMPLES = 8
const MINIMUM_BASELINE_SPAN_MS = 600

export type CalibrationPhase = 'framing' | 'baseline' | 'action' | 'step-success' | 'complete'

export interface CalibrationSnapshot {
  phase: CalibrationPhase
  style: PlayStyle
  stepIndex: number
  totalSteps: 5
  completedSteps: number
  action: CalibrationAction | null
  holdProgress: number
  framingIssue: FramingIssue | null
  profile: CalibrationProfile | null
}

export class CalibrationSession {
  private readonly style: PlayStyle
  private readonly actions: readonly CalibrationAction[]
  private phase: CalibrationPhase = 'framing'
  private stepIndex = 0
  private completedSteps = 0
  private baselineSamples: PoseSample[] = []
  private profile: CalibrationProfile | null = null
  private candidateAt: number | null = null
  private successAt: number | null = null
  private poseLostAt: number | null = null
  private framingIssue: FramingIssue | null = null
  private lastCapturedAt = 0

  constructor(style: PlayStyle) {
    this.style = style
    this.actions = getCalibrationActions(style)
  }

  update(sample: PoseSample): CalibrationSnapshot {
    this.lastCapturedAt = sample.capturedAt
    if (this.phase === 'complete') return this.snapshot()

    const framing = checkFraming(sample, this.style)
    if (!framing.ok) {
      this.candidateAt = null
      this.framingIssue = framing.issue
      this.poseLostAt ??= sample.capturedAt
      if (sample.capturedAt - this.poseLostAt >= POSE_LOSS_RECOVERY_MS) this.phase = 'framing'
      return this.snapshot()
    }

    this.framingIssue = null
    this.poseLostAt = null

    if (this.phase === 'framing') {
      if (this.profile) {
        if (this.successAt !== null) this.advanceAfterSuccess()
        else this.phase = 'action'
      } else {
        this.phase = 'baseline'
        this.baselineSamples = []
      }
    }

    if (this.phase === 'baseline') {
      if (!isNeutralSample(sample, this.style)) return this.snapshot()
      this.baselineSamples.push(sample)
      const firstSample = this.baselineSamples[0]
      if (
        this.baselineSamples.length >= MINIMUM_BASELINE_SAMPLES
        && sample.capturedAt - firstSample.capturedAt >= MINIMUM_BASELINE_SPAN_MS
      ) {
        const calibration = buildCalibration(this.baselineSamples, this.style)
        if (calibration.ok) {
          this.profile = calibration.profile
          this.phase = 'action'
        }
      }
      return this.snapshot()
    }

    if (this.phase === 'step-success') {
      if (this.successAt !== null && sample.capturedAt - this.successAt >= SUCCESS_DISPLAY_MS) {
        this.advanceAfterSuccess()
      }
      return this.snapshot()
    }

    if (this.phase === 'action' && this.profile) {
      const action = this.actions[this.stepIndex]
      if (!matchesCalibrationAction(this.profile, sample, this.style, action)) {
        this.candidateAt = null
        return this.snapshot()
      }

      this.candidateAt ??= sample.capturedAt
      if (sample.capturedAt - this.candidateAt >= ACTION_HOLD_MS) {
        this.phase = 'step-success'
        this.completedSteps = this.stepIndex + 1
        this.successAt = sample.capturedAt
        this.candidateAt = null
      }
    }

    return this.snapshot()
  }

  snapshot(): CalibrationSnapshot {
    const action = (this.phase === 'action' || this.phase === 'step-success')
      ? this.actions[this.stepIndex]
      : null
    const holdProgress = this.phase === 'action' && this.candidateAt !== null
      ? Math.min(1, Math.max(0, (this.lastCapturedAt - this.candidateAt) / ACTION_HOLD_MS))
      : 0

    return {
      phase: this.phase,
      style: this.style,
      stepIndex: this.stepIndex,
      totalSteps: 5,
      completedSteps: this.completedSteps,
      action,
      holdProgress,
      framingIssue: this.framingIssue,
      profile: this.profile,
    }
  }

  private advanceAfterSuccess(): void {
    if (this.stepIndex === this.actions.length - 1) {
      this.phase = 'complete'
    } else {
      this.stepIndex += 1
      this.phase = 'action'
    }
    this.successAt = null
  }
}

function isNeutralSample(sample: PoseSample, style: PlayStyle): boolean {
  const head = sample.landmarks[0]
  const leftShoulder = sample.landmarks[11]
  const rightShoulder = sample.landmarks[12]
  const leftWrist = sample.landmarks[15]
  const rightWrist = sample.landmarks[16]
  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x)
  if (shoulderWidth <= 0) return false

  const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2
  const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2
  const alignedWithHead = Math.abs(head.x - shoulderCenterX) <= shoulderWidth * 0.3
  const headAboveShoulders = head.y <= shoulderCenterY - shoulderWidth * 0.6
  const handsAtRest = leftWrist.y > leftShoulder.y
    && rightWrist.y > rightShoulder.y
    && leftWrist.x >= leftShoulder.x - shoulderWidth * 0.75
    && rightWrist.x <= rightShoulder.x + shoulderWidth * 0.75
  if (!alignedWithHead || !headAboveShoulders || !handsAtRest) return false

  const leftHip = sample.landmarks[23]
  const rightHip = sample.landmarks[24]
  const hipsVisible = leftHip.visibility >= 0.6 && rightHip.visibility >= 0.6
  if (hipsVisible) {
    const hipCenterX = (leftHip.x + rightHip.x) / 2
    if (Math.abs(hipCenterX - shoulderCenterX) > shoulderWidth * 0.3) return false
  }

  if (style === 'standing') {
    const leftKnee = sample.landmarks[25]
    const rightKnee = sample.landmarks[26]
    const hipY = (leftHip.y + rightHip.y) / 2
    const kneeY = (leftKnee.y + rightKnee.y) / 2
    if (kneeY - hipY < shoulderWidth * 0.8) return false
  }

  return true
}
