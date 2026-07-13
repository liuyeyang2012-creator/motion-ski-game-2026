import { MIN_LANDMARK_VISIBILITY } from '../pose/pose-quality'
import type { PoseLandmark } from '../pose/types'

const SVG_NS = 'http://www.w3.org/2000/svg'
const CONNECTIONS = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
] as const

export function projectPosePoint(point: PoseLandmark): { x: number; y: number } {
  return { x: (1 - point.x) * 100, y: point.y * 100 }
}

export function renderPoseOverlay(
  landmarks: PoseLandmark[],
  requiredIndices: readonly number[],
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.classList.add('pose-overlay')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  const required = new Set(requiredIndices)

  for (const [fromIndex, toIndex] of CONNECTIONS) {
    const from = landmarks[fromIndex]
    const to = landmarks[toIndex]
    if (!from || !to) continue
    const start = projectPosePoint(from)
    const end = projectPosePoint(to)
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(start.x))
    line.setAttribute('y1', String(start.y))
    line.setAttribute('x2', String(end.x))
    line.setAttribute('y2', String(end.y))
    const isRequired = required.has(fromIndex) || required.has(toIndex)
    const isStable = from.visibility >= MIN_LANDMARK_VISIBILITY
      && to.visibility >= MIN_LANDMARK_VISIBILITY
    line.classList.add(isRequired ? (isStable ? 'stable' : 'missing') : 'optional')
    svg.append(line)
  }

  const supported = new Set<number>([0, ...CONNECTIONS.flat()])
  for (const index of supported) {
    const point = landmarks[index]
    if (!point) continue
    const projected = projectPosePoint(point)
    const circle = document.createElementNS(SVG_NS, 'circle')
    circle.dataset.landmark = String(index)
    circle.setAttribute('cx', String(projected.x))
    circle.setAttribute('cy', String(projected.y))
    circle.setAttribute('r', '1.4')
    circle.classList.add(required.has(index)
      ? (point.visibility >= MIN_LANDMARK_VISIBILITY ? 'stable' : 'missing')
      : 'optional')
    svg.append(circle)
  }
  return svg
}
