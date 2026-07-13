import type { PlayStyle } from '../app/types'
import type { PoseSample } from '../pose/types'
import type { CalibrationProfile } from './calibration'

export type MotionType = 'lean-left' | 'lean-right' | 'duck' | 'squat' | 'hands-up' | 'reach-left' | 'reach-right' | 'pose-lost'
export interface MotionEvent { type: MotionType; occurredAt: number; confidence: number }

export const MOTION_THRESHOLDS = Object.freeze({ holdMs: 120, neutralMs: 160, leanRatio: 0.35, duckRatio: 0.35, squatRatio: 0.45 })

interface GateState { candidateAt: number | null; active: boolean; neutralAt: number | null }

export class MotionDetector {
  private gates = new Map<MotionType, GateState>()
  private profile: CalibrationProfile
  private style: PlayStyle

  constructor(profile: CalibrationProfile, style: PlayStyle) {
    this.profile = profile
    this.style = style
  }

  update(sample: PoseSample): MotionEvent[] {
    if (
      !Number.isFinite(sample.confidence)
      || sample.confidence < 0.6
      || !Number.isFinite(sample.capturedAt)
      || !Number.isFinite(this.profile.shoulderWidth)
      || this.profile.shoulderWidth <= 0
    ) return []
    const point = (index: number) => sample.landmarks[index]
    const visible = (index: number) => Number.isFinite(point(index)?.visibility) && point(index).visibility >= 0.6
    const finite = (index: number, coordinate: 'x' | 'y') => visible(index) && Number.isFinite(point(index)[coordinate])
    const handsVisible = visible(15) && visible(16)
    const hipsVisible = this.style === 'standing' && visible(23) && visible(24)
    const shouldersXFinite = finite(11, 'x') && finite(12, 'x')
    const canCalculateLean = Number.isFinite(this.profile.torsoCenterX)
      && shouldersXFinite
      && (this.style === 'seated' || (hipsVisible && finite(23, 'x') && finite(24, 'x')))
    const centerX = canCalculateLean
      ? this.style === 'standing'
        ? (point(11).x + point(12).x + point(23).x + point(24).x) / 4
        : (point(11).x + point(12).x) / 2
      : null
    const lean = centerX === null ? 0 : (centerX - this.profile.torsoCenterX) / this.profile.shoulderWidth
    const canDuck = Number.isFinite(this.profile.headY) && finite(0, 'y')
    const duck = canDuck ? (point(0).y - this.profile.headY) / this.profile.shoulderWidth : 0
    const canSquat = Number.isFinite(this.profile.hipY) && hipsVisible && finite(23, 'y') && finite(24, 'y')
    const squat = canSquat
      ? ((point(23).y + point(24).y) / 2 - this.profile.hipY!) / this.profile.shoulderWidth
      : 0
    const handsYFinite = handsVisible && finite(15, 'y') && finite(16, 'y')
      && finite(11, 'y') && finite(12, 'y')
    const handsUp = handsYFinite && point(15).y < point(11).y && point(16).y < point(12).y
    const reachXFinite = shouldersXFinite && handsVisible && finite(15, 'x') && finite(16, 'x')
    const conditions: Partial<Record<MotionType, boolean>> = {
      'lean-left': canCalculateLean && Number.isFinite(lean) && lean < -MOTION_THRESHOLDS.leanRatio,
      'lean-right': canCalculateLean && Number.isFinite(lean) && lean > MOTION_THRESHOLDS.leanRatio,
      duck: canDuck && Number.isFinite(duck) && duck > MOTION_THRESHOLDS.duckRatio,
      squat: canSquat && Number.isFinite(squat) && squat > MOTION_THRESHOLDS.squatRatio,
      'hands-up': handsUp,
      'reach-left': reachXFinite && point(15).x < point(11).x - this.profile.shoulderWidth,
      'reach-right': reachXFinite && point(16).x > point(12).x + this.profile.shoulderWidth,
    }
    const events: MotionEvent[] = []
    for (const [type, condition] of Object.entries(conditions) as [MotionType, boolean][]) {
      const event = this.updateGate(type, condition, sample.capturedAt, sample.confidence)
      if (event) events.push(event)
    }
    return events
  }

  reset(): void { this.gates.clear() }

  private updateGate(type: MotionType, condition: boolean, now: number, confidence: number): MotionEvent | null {
    const gate = this.gates.get(type) ?? { candidateAt: null, active: false, neutralAt: null }
    this.gates.set(type, gate)
    if (condition) {
      gate.neutralAt = null
      if (gate.active) return null
      gate.candidateAt ??= now
      if (now - gate.candidateAt >= MOTION_THRESHOLDS.holdMs) {
        gate.active = true
        return { type, occurredAt: now, confidence }
      }
      return null
    }
    gate.candidateAt = null
    if (!gate.active) return null
    gate.neutralAt ??= now
    if (now - gate.neutralAt >= MOTION_THRESHOLDS.neutralMs) {
      gate.active = false
      gate.neutralAt = null
    }
    return null
  }
}
