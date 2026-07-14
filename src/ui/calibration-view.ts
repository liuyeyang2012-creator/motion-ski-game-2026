import type { CalibrationSnapshot } from '../motion/calibration-session'
import type { CalibrationAction, CalibrationFeedbackCode } from '../motion/calibration'
import { renderHeadCalibrationGuide } from './head-calibration-guide'
import { renderPoseOverlay } from './pose-overlay'

const actionInstructions: Record<CalibrationAction, string> = {
  'face-neutral': '正脸',
  'turn-left': '向左转头',
  'turn-right': '向右转头',
  'look-up': '抬头',
  'look-down': '低头',
  'lean-left': '向左侧身',
  'lean-right': '向右侧身',
  duck: '轻轻低头',
  'hands-up': '抬起双手',
  reach: '向两侧伸展手臂',
  squat: '缓慢下蹲',
}

const feedbackCopy: Record<CalibrationFeedbackCode, string> = {
  'body-not-found': '请站到高亮框内',
  'head-missing': '请调整手机，让头部进入画面',
  'shoulders-missing': '请把双肩放入高亮框',
  'move-closer': '请靠近手机一些',
  'move-back': '请离手机远一些',
  'center-head': '请将头部移到引导框中央',
  'shoulders-moving': '请只转头，双肩保持不动',
  'turn-left-more': '请再向左转一点',
  'turn-right-more': '请再向右转一点',
  'look-up-more': '请再抬头一点',
  'look-down-more': '请再低头一点',
  'left-hand-missing': '请让左手进入画面',
  'right-hand-missing': '请让右手进入画面',
  'hips-missing': '请调整手机，让髋部进入画面',
  'knees-missing': '请稍微后退，让膝盖进入画面',
  'move-left': '身体已识别，请再向左一点',
  'move-right': '身体已识别，请再向右一点',
  'lower-head': '头部已识别，请再低一点',
  'raise-left-hand': '右手已识别，请抬高左手',
  'raise-right-hand': '左手已识别，请抬高右手',
  'spread-hands': '双手已识别，请再向两侧伸展',
  'lower-hips': '身体已识别，请缓慢下蹲',
  hold: '动作正确，保持一下',
}

export interface CalibrationViewActions {
  onRetryModel(): void
  onRetryBody(): void
  onRetryAction(): void
  onUseRecommended(): void
}

const noActions: CalibrationViewActions = {
  onRetryModel: () => {},
  onRetryBody: () => {},
  onRetryAction: () => {},
  onUseRecommended: () => {},
}

export function getCalibrationInstruction(snapshot: CalibrationSnapshot): string {
  if (snapshot.phase === 'step-success') return '校准成功'
  if (snapshot.phase === 'camera-check') return '正在打开摄像头'
  if (snapshot.phase === 'model-check') {
    return snapshot.modelMode === 'compatibility' ? '兼容模式加载中' : '识别组件加载中'
  }
  if (snapshot.phase === 'model-error') {
    return snapshot.modelMode === 'compatibility' ? '兼容模式未能启动' : '普通模式未能启动'
  }
  if (snapshot.phase === 'complete') return '准备完成'
  if (snapshot.phase === 'baseline') {
    return snapshot.style === 'seated' ? '请正对手机' : '保持自然姿势'
  }
  if (snapshot.phase === 'body-check' && snapshot.feedback) return feedbackCopy[snapshot.feedback]
  if (snapshot.action) return actionInstructions[snapshot.action]
  return snapshot.style === 'standing' ? '让全身进入高亮框' : '让上半身进入高亮框'
}

export function renderCalibration(
  root: HTMLElement,
  snapshot: CalibrationSnapshot,
  actions: CalibrationViewActions = noActions,
): void {
  const successful = snapshot.phase === 'step-success'
  const screen = element('section', `calibration-screen${successful ? ' success' : ''}`)
  if (snapshot.style === 'standing' && snapshot.latestLandmarks.length > 0) {
    screen.append(renderPoseOverlay(snapshot.latestLandmarks, snapshot.requiredIndices))
  }
  const shade = element('div', 'calibration-shade')
  shade.setAttribute('aria-hidden', 'true')

  const frameClass = snapshot.style === 'standing'
    ? 'calibration-frame full-body'
    : 'calibration-frame half-body head-guide-frame'
  const frame = element('div', frameClass)
  frame.setAttribute('aria-hidden', 'true')
  if (snapshot.style === 'seated') {
    frame.append(renderHeadCalibrationGuide({
      headRecognized: snapshot.headRecognized,
      shouldersRecognized: snapshot.shouldersRecognized,
    }))
  }
  if (successful) frame.append(element('span', 'calibration-check', '✓'))

  const status = element('div', 'calibration-status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.append(element('p', 'calibration-stage', getStageCopy(snapshot)))
  status.append(element('h1', 'calibration-instruction', getCalibrationInstruction(snapshot)))

  if (snapshot.style === 'seated' && (snapshot.phase === 'baseline' || snapshot.phase === 'action')) {
    const recognition = element('div', 'calibration-status-chips')
    recognition.append(
      recognitionChip('头部', snapshot.headRecognized),
      recognitionChip('双肩', snapshot.shouldersRecognized),
    )
    status.append(recognition)
  }

  if (snapshot.feedback && snapshot.phase === 'action') {
    status.append(element('p', 'calibration-feedback', feedbackCopy[snapshot.feedback]))
  }

  const progress = element('div', 'calibration-progress')
  const progressFill = element('i')
  const progressValue = successful ? 1 : clamp(snapshot.holdProgress)
  progressFill.style.setProperty('--calibration-progress', `${progressValue * 100}%`)
  progress.append(progressFill)
  status.append(progress)

  if (snapshot.completedActions.length > 0) {
    const completed = element('div', 'calibration-completed')
    for (const action of snapshot.completedActions) completed.append(element('span', '', `✓ ${actionInstructions[action]}`))
    status.append(completed)
  }

  if (snapshot.phase === 'model-error') {
    const retryLabel = snapshot.modelMode === 'compatibility'
      ? '再次尝试兼容模式'
      : '兼容模式重试'
    status.append(actionButton(retryLabel, 'retry-model', actions.onRetryModel))
  } else if (snapshot.canRecover) {
    const recovery = element('div', 'calibration-recovery')
    recovery.append(
      actionButton('重新识别', 'retry-action', actions.onRetryAction),
      actionButton('使用推荐灵敏度', 'use-recommended', actions.onUseRecommended),
    )
    status.append(recovery)
  } else {
    const help = snapshot.phase === 'model-check' && snapshot.modelMode === 'standard'
      ? '首次加载可能需要一些时间，请保持竖屏。'
      : snapshot.style === 'seated' && snapshot.phase === 'baseline'
        ? '请将头部和双肩置于引导框内，保持正对手机。'
      : snapshot.phase === 'action'
        ? '动作正确时进度会增加，短暂识别不稳不会清零。'
        : '请保持竖屏，并让身体处在光线充足的位置。'
    status.append(element('p', 'calibration-help', help))
  }

  screen.append(shade, frame, status)
  root.replaceChildren(screen)
}

function recognitionChip(label: string, recognized: boolean): HTMLSpanElement {
  return element(
    'span',
    `calibration-status-chip status-chip${recognized ? ' recognized' : ''}`,
    `${label}${recognized ? '已识别' : '待识别'}`,
  )
}

function getStageCopy(snapshot: CalibrationSnapshot): string {
  if (snapshot.phase === 'camera-check') return '摄像头自检 1/3'
  if (snapshot.phase === 'model-check' || snapshot.phase === 'model-error') return '识别组件自检 2/3'
  if (snapshot.phase === 'body-check' || snapshot.phase === 'baseline') return '人体识别 2/3'
  if (snapshot.phase === 'complete') return '动作校准 5/5'
  return `动作校准 ${Math.min(5, snapshot.stepIndex + 1)}/5`
}

function actionButton(label: string, action: string, handler: () => void): HTMLButtonElement {
  const button = element('button', 'calibration-action', label)
  button.type = 'button'
  button.dataset.action = action
  button.addEventListener('click', handler)
  return button
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
