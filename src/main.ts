import './style.css'
import { AppController } from './app/app-controller'

export function mountShell(root: Element): void {
  root.innerHTML = `
    <main class="app-shell">
      <video id="camera-preview" muted playsinline aria-label="摄像头取景"></video>
      <canvas id="game-canvas" width="720" height="1280" aria-label="滑雪游戏画面"></canvas>
      <section id="screen-layer"></section>
      <p class="sr-only" role="status" aria-live="polite">准备开始</p>
    </main>`
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('#app')
  if (root) {
    mountShell(root)
    const screen = document.querySelector<HTMLElement>('#screen-layer')
    const fixtureMode = import.meta.env.DEV && new URLSearchParams(location.search).get('poseFixture') === 'seated-quick-success'
    if (screen) new AppController({ root: screen, storage: localStorage, fixtureMode }).start()
  }
}
