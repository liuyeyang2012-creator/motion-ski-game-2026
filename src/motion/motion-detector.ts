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
    if (sample.confidence < 0.6 || !Number.isFinite(this.profile.shoulderWidth) || this.profile.shoulderWidth <= 0) return []
    const point = (index: number) => sample.landmarks[index]
    const visible = (index: number) => (point(index)?.visibility ?? 0) >= 0.6
    const shouldersVisible = visible(11) && visible(12)
    const headVisible = visible(0)
    const handsVisible = visible(15) && visible(16)
    const hipsVisible = this.style === 'standing' && visible(23) && visible(24)
    const canCalculateLean = shouldersVisible && (this.style === 'seated' || hipsVisible)
    const centerX = canCalculateLean
      ? this.style === 'standing'
        ? (point(11).x + point(12).x + point(23).x + point(24).x) / 4
        : (point(11).x + point(12).x) / 2
      : null
    const lean = centerX === null ? 0 : (centerX - this.profile.torsoCenterX) / this.profile.shoulderWidth
    const duck = headVisible ? (point(0).y - this.profile.headY) / this.profile.shoulderWidth : 0
    const canSquat = hipsVisible && typeof this.profile.hipY === 'number'
    const squat = canSquat
      ? ((point(23).y + point(24).y) / 2 - this.profile.hipY!) / this.profile.shoulderWidth
      : 0
    const handsUp = shouldersVisible && handsVisible && point(15).y < point(11).y && point(16).y < point(12).y
    const conditions: Partial<Record<MotionType, boolean>> = {
      'lean-left': canCalculateLean && lean < -MOTION_THRESHOLDS.leanRatio,
      'lean-right': canCalculateLean && lean > MOTION_THRESHOLDS.leanRatio,
      duck: headVisible && duck > MOTION_THRESHOLDS.duckRatio,
      squat: canSquat && squat > MOTION_THRESHOLDS.squatRatio,
      'hands-up': handsUp,
      'reach-left': shouldersVisible && handsVisible && point(15).x < point(11).x - this.profile.shoulderWidth,
      'reach-right': shouldersVisible && handsVisible && point(16).x > point(12).x + this.profile.shoulderWidth,
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
