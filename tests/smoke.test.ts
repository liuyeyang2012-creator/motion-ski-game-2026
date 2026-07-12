import { describe, expect, it } from 'vitest'

describe('mobile shell', () => {
  it('mounts the game, camera, and status regions', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const { mountShell } = await import('../src/main')
    mountShell(document.querySelector('#app')!)

    expect(document.querySelector('#game-canvas')).toBeInstanceOf(HTMLCanvasElement)
    expect(document.querySelector('#camera-preview')).toBeInstanceOf(HTMLVideoElement)
    expect(document.querySelector('[role="status"]')?.textContent).toContain('准备')
  })
})
