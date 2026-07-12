import { describe, expect, it } from 'vitest'
import { AppController } from '../../src/app/app-controller'

describe('AppController', () => {
  it('moves from welcome to setup and preserves local defaults', () => {
    const root = document.createElement('section')
    const controller = new AppController({ root, storage: localStorage })
    controller.start()
    ;(root.querySelector('[data-testid="start"]') as HTMLButtonElement).click()
    expect(root.textContent).toContain('选择体感方式')
    expect((root.querySelector('input[value="seated"]') as HTMLInputElement).checked).toBe(true)
  })
})
