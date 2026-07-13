import type { PoseSample } from '../../src/pose/types'

export function poseSample(capturedAt: number, options: { hidden?: number[]; changes?: Record<number, Partial<{ x: number; y: number; visibility: number }>> } = {}): PoseSample {
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
  for (const index of options.hidden ?? []) landmarks[index].visibility = 0
  for (const [index, change] of Object.entries(options.changes ?? {})) Object.assign(landmarks[Number(index)], change)
  return { capturedAt, landmarks, confidence: 0.95 }
}
