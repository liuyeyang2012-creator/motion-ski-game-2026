import type { GameState } from '../game/types'

export type QualityLevel = 'high' | 'medium' | 'low'

export interface Projection { x: number; y: number; scale: number }

export function projectObstacle(lane: number, depth: number, width: number, height: number): Projection {
  const clamped = Math.max(0, Math.min(1, depth))
  const scale = 0.18 + clamped * 1.15
  return {
    x: width / 2 + lane * width * (0.08 + clamped * 0.2),
    y: height * (0.32 + clamped * 0.58),
    scale,
  }
}

export class SkiRenderer {
  private context: CanvasRenderingContext2D
  private quality: QualityLevel = 'high'
  private canvas: HTMLCanvasElement
  private frameDurations: number[] = []
  private logicalWidth: number
  private logicalHeight: number

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.logicalWidth = canvas.width
    this.logicalHeight = canvas.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D unavailable')
    this.context = context
  }

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.logicalWidth = width
    this.logicalHeight = height
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  setQuality(level: QualityLevel): void { this.quality = level }
  getQuality(): QualityLevel { return this.quality }
  getViewport(): { width: number; height: number } { return { width: this.logicalWidth, height: this.logicalHeight } }

  recordFrameDuration(durationMs: number): void {
    this.frameDurations.push(durationMs)
    if (this.frameDurations.length < 120) return
    const average = this.frameDurations.reduce((sum, value) => sum + value, 0) / this.frameDurations.length
    this.frameDurations = []
    if (this.quality === 'high' && average > 20) this.quality = 'medium'
    else if (this.quality === 'medium' && average > 28) this.quality = 'low'
  }

  render(state: Readonly<GameState>): void {
    const { context: ctx } = this
    const width = this.logicalWidth
    const height = this.logicalHeight
    ctx.clearRect(0, 0, width, height)
    const sky = ctx.createLinearGradient(0, 0, 0, height)
    sky.addColorStop(0, '#50b9ea')
    sky.addColorStop(0.48, '#d9f5ff')
    sky.addColorStop(1, '#ffffff')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height)

    this.drawMountains(width, height)
    this.drawSlope(width, height)
    const visible = state.obstacles.filter(obstacle => obstacle.appearsAt - state.elapsedMs < 4_000 && obstacle.appearsAt - state.elapsedMs > -600)
    for (const obstacle of visible) {
      const depth = 1 - Math.max(0, obstacle.appearsAt - state.elapsedMs) / 4_000
      this.drawObstacle(obstacle.lane, depth, width, height, obstacle.requiredMotion)
    }
    if (this.quality !== 'low') this.drawSnow(width, height, state.elapsedMs)
    this.drawHud(state, width)
  }

  dispose(): void {}

  private drawMountains(width: number, height: number): void {
    const ctx = this.context
    ctx.fillStyle = '#b8dfec'
    ctx.beginPath(); ctx.moveTo(0, height * 0.42); ctx.lineTo(width * 0.22, height * 0.16); ctx.lineTo(width * 0.45, height * 0.42); ctx.lineTo(width * 0.68, height * 0.12); ctx.lineTo(width, height * 0.42); ctx.closePath(); ctx.fill()
  }

  private drawSlope(width: number, height: number): void {
    const ctx = this.context
    ctx.fillStyle = '#f5fdff'
    ctx.beginPath(); ctx.moveTo(width * 0.42, height * 0.32); ctx.lineTo(width * 0.58, height * 0.32); ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = '#9ddcf0'; ctx.lineWidth = 3
    for (const lane of [-1, 1]) { ctx.beginPath(); ctx.moveTo(width / 2, height * 0.32); ctx.lineTo(width / 2 + lane * width * 0.28, height); ctx.stroke() }
  }

  private drawObstacle(lane: number, depth: number, width: number, height: number, motion: string): void {
    const ctx = this.context
    const point = projectObstacle(lane, depth, width, height)
    ctx.save(); ctx.translate(point.x, point.y); ctx.scale(point.scale, point.scale)
    ctx.shadowBlur = this.quality === 'low' ? 0 : 16; ctx.shadowColor = '#16405c55'
    ctx.fillStyle = motion === 'hands-up' ? '#66e3ff' : '#174d39'
    ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(-36, 16); ctx.lineTo(36, 16); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#6b462d'; ctx.fillRect(-7, 12, 14, 35); ctx.restore()
    ctx.shadowBlur = 0
  }

  private drawSnow(width: number, height: number, time: number): void {
    const ctx = this.context
    ctx.fillStyle = '#ffffffaa'
    for (let index = 0; index < (this.quality === 'high' ? 28 : 12); index++) {
      const x = (index * 83 + time * 0.05) % width
      const y = (index * 137 + time * 0.09) % height
      ctx.beginPath(); ctx.arc(x, y, 2 + (index % 3), 0, Math.PI * 2); ctx.fill()
    }
  }

  private drawHud(state: Readonly<GameState>, width: number): void {
    const ctx = this.context
    ctx.fillStyle = '#09283ddd'; ctx.font = '700 28px system-ui'; ctx.textAlign = 'left'; ctx.fillText(`${Math.round(state.distance)} m`, 24, 48)
    ctx.textAlign = 'right'; ctx.fillText(`${state.score}`, width - 24, 48)
  }
}
