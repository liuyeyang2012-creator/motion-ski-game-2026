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
    if (sample.confidence < 0.6 || sample.landmarks.length < 27) return []
    const point = (index: number) => sample.landmarks[index]
    const centerX = (point(11).x + point(12).x + point(23).x + point(24).x) / 4
    const hipY = (point(23).y + point(24).y) / 2
    const lean = (centerX - this.profile.torsoCenterX) / this.profile.shoulderWidth
    const duck = (point(0).y - this.profile.headY) / this.profile.shoulderWidth
    const squat = this.profile.hipY === null ? 0 : (hipY - this.profile.hipY) / this.profile.shoulderWidth
    const handsUp = point(15).y < point(11).y && point(16).y < point(12).y
    const conditions: Partial<Record<MotionType, boolean>> = {
      'lean-left': lean < -MOTION_THRESHOLDS.leanRatio,
      'lean-right': lean > MOTION_THRESHOLDS.leanRatio,
      duck: duck > MOTION_THRESHOLDS.duckRatio,
      squat: this.style === 'standing' && squat > MOTION_THRESHOLDS.squatRatio,
      'hands-up': handsUp,
      'reach-left': point(15).x < point(11).x - this.profile.shoulderWidth,
      'reach-right': point(16).x > point(12).x + this.profile.shoulderWidth,
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
