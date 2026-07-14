import './style.css'
import { AppController, type PoseFixtureMode } from './app/app-controller'

const POSE_FIXTURES: readonly PoseFixtureMode[] = [
  'seated-quick-success',
  'seated-soft-success',
  'seated-stuck-action',
  'seated-body-only',
  'standing-soft-success',
]

export function parsePoseFixture(search: string, enabled: boolean): PoseFixtureMode | undefined {
  if (!enabled) return undefined
  const value = new URLSearchParams(search).get('poseFixture')
  return POSE_FIXTURES.find(fixture => fixture === value)
}

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
    const fixtureMode = parsePoseFixture(
      location.search,
      import.meta.env.DEV || import.meta.env.MODE === 'pages',
    )
    if (screen) new AppController({ root: screen, storage: localStorage, fixtureMode }).start()
  }
}
