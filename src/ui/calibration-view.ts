import type { CalibrationSnapshot } from '../motion/calibration-session'
import type { CalibrationAction, FramingIssue } from '../motion/calibration'

const actionInstructions: Record<CalibrationAction, string> = {
  'lean-left': '向左侧身',
  'lean-right': '向右侧身',
  duck: '轻轻低头',
  'hands-up': '抬起双手',
  reach: '向两侧伸展手臂',
  squat: '缓慢下蹲',
}

const framingInstructions: Record<FramingIssue, string> = {
  'head-not-visible': '请调整手机角度，让头部进入框内',
  'shoulders-not-visible': '请把双肩放入高亮框',
  'hands-not-visible': '请把双手放入高亮框',
  'lower-body-not-visible': '请稍微后退，让髋部和膝盖进入框内',
  'pose-lost': '请回到高亮框中央',
}

export function getCalibrationInstruction(snapshot: CalibrationSnapshot): string {
  if (snapshot.phase === 'step-success') return '校准成功'
  if (snapshot.framingIssue) return framingInstructions[snapshot.framingIssue]
  if (snapshot.action) return actionInstructions[snapshot.action]
  if (snapshot.phase === 'baseline') return '保持自然姿势'
  if (snapshot.phase === 'complete') return '准备完成'
  return snapshot.style === 'standing' ? '让全身进入高亮框' : '让上半身进入高亮框'
}

export function renderCalibration(root: HTMLElement, snapshot: CalibrationSnapshot): void {
  const successful = snapshot.phase === 'step-success'
  const screen = element('section', `calibration-screen${successful ? ' success' : ''}`)
  const shade = element('div', 'calibration-shade')
  shade.setAttribute('aria-hidden', 'true')

  const frame = element('div', `calibration-frame ${snapshot.style === 'standing' ? 'full-body' : 'half-body'}`)
  frame.setAttribute('aria-hidden', 'true')
  if (successful) frame.append(element('span', 'calibration-check', '✓'))

  const status = element('div', 'calibration-status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  status.append(element('p', 'calibration-step', `第 ${snapshot.stepIndex + 1}/${snapshot.totalSteps} 步`))
  status.append(element('h1', 'calibration-instruction', getCalibrationInstruction(snapshot)))

  const progress = element('div', 'calibration-progress')
  const progressFill = element('i')
  const progressValue = successful ? 1 : clamp(snapshot.holdProgress)
  progressFill.style.setProperty('--calibration-progress', `${progressValue * 100}%`)
  progress.append(progressFill)
  status.append(progress)
  status.append(element('p', 'calibration-help', '识别到动作后会自动进入下一步，无需点击。'))

  screen.append(shade, frame, status)
  root.replaceChildren(screen)
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
