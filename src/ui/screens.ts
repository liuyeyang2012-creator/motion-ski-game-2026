import type { PlayStyle, SessionKind } from '../app/types'
import type { MotionType } from '../motion/motion-detector'

export interface SetupChoice { playStyle: PlayStyle; sessionKind: SessionKind }
export interface ResultView {
  score: number; distance: number; bestCombo: number; collisions: number; activeMs: number
  motionCounts: Partial<Record<MotionType, number>>
}

const privacy = '<p class="privacy">🔒 摄像头画面仅在本机识别，不上传、不保存</p>'

export function renderWelcome(root: HTMLElement, onStart: () => void): void {
  root.innerHTML = `<div class="screen welcome"><div class="brand">SNOWBREAK</div><div class="mountain-mark">▲</div><p class="eyebrow">工作间隙 · 动一动</p><h1>体感滑雪</h1><p class="lead">侧身、低头、抬手<br>用身体穿过雪山赛道</p><button class="primary" data-testid="start">开始滑雪</button>${privacy}<p class="safety">开始前请清理身边障碍，身体不适请立即停止。</p></div>`
  root.querySelector('button')!.addEventListener('click', onStart)
}

export function renderSetup(root: HTMLElement, defaults: SetupChoice, onSubmit: (choice: SetupChoice) => void): void {
  root.innerHTML = `<form class="screen setup"><p class="eyebrow">准备上雪道</p><h2>选择体感方式</h2><div class="choice-grid">
    <label class="choice"><input type="radio" name="playStyle" value="seated" ${defaults.playStyle === 'seated' ? 'checked' : ''}><strong>坐姿模式</strong><span>侧身 · 低头 · 抬手</span></label>
    <label class="choice"><input type="radio" name="playStyle" value="standing" ${defaults.playStyle === 'standing' ? 'checked' : ''}><strong>站立模式</strong><span>增加安全下蹲动作</span></label></div>
    <h2>本局时长</h2><div class="session-row">
    <label><input type="radio" name="sessionKind" value="quick" ${defaults.sessionKind === 'quick' ? 'checked' : ''}><span>30 秒<br><small>快速局</small></span></label>
    <label><input type="radio" name="sessionKind" value="standard" ${defaults.sessionKind === 'standard' ? 'checked' : ''}><span>2 分钟<br><small>标准局</small></span></label>
    <label><input type="radio" name="sessionKind" value="endless" ${defaults.sessionKind === 'endless' ? 'checked' : ''}><span>∞<br><small>无限局</small></span></label></div>
    <button class="primary" type="submit">开始校准</button>${privacy}</form>`
  root.querySelector('form')!.addEventListener('submit', event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    onSubmit({ playStyle: form.get('playStyle') as PlayStyle, sessionKind: form.get('sessionKind') as SessionKind })
  })
}

export function renderMessage(root: HTMLElement, title: string, body: string): void {
  root.innerHTML = `<div class="screen message"><div class="scan-ring"></div><p class="eyebrow">摄像头校准</p><h2>${title}</h2><p class="lead">${body}</p>${privacy}</div>`
}

export function renderResults(root: HTMLElement, result: ResultView, onReplay: () => void): void {
  const side = (result.motionCounts['lean-left'] ?? 0) + (result.motionCounts['lean-right'] ?? 0)
  root.innerHTML = `<div class="screen results"><p class="eyebrow">顺利冲线</p><h2>本局成绩</h2><div class="score">${result.score.toLocaleString()}</div><div class="stats"><span><b>${Math.round(result.distance)}</b> 米</span><span><b>${result.bestCombo}</b> 最高连击</span><span><b>${result.collisions}</b> 次碰撞</span></div><section class="activity"><h3>本次身体活动</h3><p>侧身 ${side} 次 · 低头 ${result.motionCounts.duck ?? 0} 次</p><p>抬手 ${result.motionCounts['hands-up'] ?? 0} 次 · ${Math.round(result.activeMs / 1000)} 秒</p></section><p class="encourage">肩颈和身体已经活动开了，休息一下再继续工作吧。</p><button class="primary">再滑一次</button></div>`
  root.querySelector('button')!.addEventListener('click', onReplay)
}
