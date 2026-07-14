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

  it('allows only known pose fixtures when the build gate is enabled', async () => {
    const { parsePoseFixture } = await import('../src/main')

    expect(parsePoseFixture('?poseFixture=seated-soft-success', true)).toBe('seated-soft-success')
    expect(parsePoseFixture('?poseFixture=standing-soft-success', true)).toBe('standing-soft-success')
    expect(parsePoseFixture('?poseFixture=arbitrary', true)).toBeUndefined()
    expect(parsePoseFixture('?poseFixture=seated-soft-success', false)).toBeUndefined()
  })
})
